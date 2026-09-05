#!/usr/bin/env python3
"""Queue agent service - answers the one question a waiting caller depends on:
who should this call ring right now?

When somebody calls a queue, the switch answers, plays hold music, and asks a
service on this port which phone to ring. It asks again every couple of seconds
until somebody picks up or the caller gives up. Nothing was ever listening, so
every queued call waited out its timeout and rang nobody. This is that service.

It reads the queue records the product actually writes: when an admin edits a
queue on the website, that is saved to MongoDB, and this reads the same place.
There is no copy, no sync and no second version of the truth to drift.

It sits directly on the call path, so the rules it lives by are:

  * It never fails loudly. Every answer is a well-formed one, even when the
    database is unreachable - a caller hears hold music and keeps waiting,
    instead of the call dropping.
  * "Nobody is free" is a normal answer, not an error. The switch expects an
    empty list and handles it by holding the caller.
  * It answers fast. A person is on the line while this runs, so every query is
    small and indexed, every database call has a hard time limit, and repeated
    questions inside a few seconds are answered from memory.
"""

import datetime
import json
import os
import random
import re
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

# Imported the forgiving way on purpose, and for two reasons. The rules in this
# file can then be tested on any machine, with no database driver installed. And
# on a machine where the driver is missing the service still starts and still
# answers - a caller waits on hold instead of the line going dead.
try:
    from pymongo import MongoClient
except ImportError:  # pragma: no cover - exercised only where the driver is absent
    MongoClient = None
try:
    from bson import ObjectId
except ImportError:  # pragma: no cover
    ObjectId = None


LISTEN_ADDR = os.environ.get("HTTP_LISTEN_ADDR", "127.0.0.1:9006")
# The switch and the event manager both ask for "localhost". On this box that can
# resolve to either the IPv4 or the IPv6 loopback, and a caller that picks the one
# we are not listening on is simply refused. Answering on both removes that coin toss.
LISTEN_HOST6 = os.environ.get("HTTP_LISTEN_HOST6", "::1")

MONGODB_URI = os.environ.get("MONGODB_URI", "")
MONGODB_DATABASE = os.environ.get("MONGODB_DATABASE", "mycountrymobile_db")
BASE_DOMAIN = os.environ.get("BASE_DOMAIN", "mycountrymobile.com")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "info")

# Hard limits on every database call. The switch has no time limit of its own on
# the request it makes here, so a database that stops answering would otherwise
# hold a real caller on a silent line. These caps are what make that impossible.
DB_TIMEOUT_MS = int(os.environ.get("DB_TIMEOUT_MS", "2000"))
DB_POOL_MAX = int(os.environ.get("DB_POOL_MAX", "8"))

# How long an answer may be reused. Several callers waiting in the same queue ask
# the same question every couple of seconds; answering them from one lookup keeps
# the database quiet without anyone noticing a stale answer.
AGENT_CACHE_SECONDS = float(os.environ.get("AGENT_CACHE_SECONDS", "2"))

# A queue can be set up so the first group of people are tried first and a wider
# group is added if nobody picks up. How long each of those rounds lasts is not
# recorded anywhere in this platform, so it is one setting here for every queue.
ACD_STEP_SECONDS = float(os.environ.get("ACD_STEP_SECONDS", "15"))

# How long we remember what we already tried for one caller. Long enough to cover
# the longest queue wait, short enough that memory cannot creep up over days.
CALL_MEMORY_SECONDS = float(os.environ.get("CALL_MEMORY_SECONDS", "3600"))
CALL_MEMORY_MAX = int(os.environ.get("CALL_MEMORY_MAX", "5000"))

# Somebody who has missed their limit of calls stops being offered new ones. That
# count is only trusted while it is recent - an old count left behind by a restart
# or a bad day must not lock somebody out of their queue for good.
NO_ANSWER_WINDOW_SECONDS = float(os.environ.get("NO_ANSWER_WINDOW_SECONDS", "3600"))

# Optional. Left empty, the service trusts anything that can reach it - which is
# only this machine, because it listens on the loopback address alone. The switch
# and the event manager send different tokens, so anything set here must list both.
AUTH_TOKENS = [t.strip() for t in os.environ.get("AUTH_TOKENS", "").split(",") if t.strip()]

QUEUES = "queues"
AGENTS = "agents"
TIERS = "tiers"


def log(level, msg, **kwargs):
    if level == "debug" and LOG_LEVEL != "debug":
        return
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    entry = {"level": level, "@timestamp": ts, "msg": msg}
    entry.update(kwargs)
    print(json.dumps(entry, default=str), flush=True)


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

_client = None
_client_lock = threading.Lock()


def get_database():
    """One shared connection to the queue records.

    The driver keeps its own set of connections and shares them safely between
    requests, so several waiting callers are served side by side rather than
    queueing behind each other.
    """
    global _client
    if MongoClient is None:
        raise RuntimeError("the MongoDB driver (python3-pymongo) is not installed")
    if not MONGODB_URI:
        raise RuntimeError("MONGODB_URI is not set")
    client = _client
    if client is None:
        with _client_lock:
            if _client is None:
                _client = MongoClient(
                    MONGODB_URI,
                    # Every one of these is a hard stop. Together they mean no
                    # request to this service can hang, whatever the database does.
                    serverSelectionTimeoutMS=DB_TIMEOUT_MS,
                    connectTimeoutMS=DB_TIMEOUT_MS,
                    socketTimeoutMS=DB_TIMEOUT_MS,
                    maxPoolSize=DB_POOL_MAX,
                    retryReads=True,
                    appname="queue-agent-service",
                )
            client = _client
    return client[MONGODB_DATABASE]


def find_docs(collection, query, projection=None, limit=0, sort=None):
    cursor = get_database()[collection].find(query, projection)
    if sort:
        cursor = cursor.sort(sort)
    if limit:
        cursor = cursor.limit(limit)
    return list(cursor)


def find_one_doc(collection, query, projection=None):
    return get_database()[collection].find_one(query, projection)


def update_doc(collection, query, changes):
    result = get_database()[collection].update_one(query, changes)
    return bool(getattr(result, "matched_count", 0))


def reference_values(key, oid=None):
    """Every form one reference can take.

    A queue is pointed at by its own record reference. That reference is stored
    as a database id, but arrives from the switch as plain text, and older
    records elsewhere hold it as text too. Looking for both costs nothing and
    means a queue is never missed on a technicality.
    """
    key = (key or "").strip()
    if not key:
        return []
    values = [key]
    factory = oid if oid is not None else ObjectId
    if factory is not None and re.fullmatch(r'[0-9a-fA-F]{24}', key):
        try:
            values.insert(0, factory(key))
        except Exception:
            pass
    return values


AGENT_FIELDS = {
    "_id": 0, "queue_uuid": 1, "name": 1, "contact": 1, "user_detail": 1, "type": 1,
    "status": 1, "state": 1, "max_no_answer": 1, "wrap_up_time": 1,
    "last_bridge_start": 1, "last_bridge_end": 1, "last_offered_call": 1,
    "last_status_change": 1, "no_answer_count": 1, "calls_answered": 1,
    "talk_time": 1, "ready_time": 1,
}

QUEUE_FIELDS = {
    "_id": 1, "name": 1, "extension": 1, "domain": 1, "type": 1,
    "settings": 1, "wrap_seconds": 1, "max_wait_time": 1,
}


def load_queue(queue_key):
    """The queue's own record. Used for the settings the switch does not send:
    how long somebody spends writing up notes, and the ring order to fall back on."""
    ident, domain = split_agent_name(queue_key)
    values = reference_values(queue_key)
    if not values:
        return None
    try:
        row = find_one_doc(QUEUES, {"_id": {"$in": values}}, QUEUE_FIELDS)
        if row:
            return row
        # Not a record reference, so it is being called by its extension. The
        # company's domain is part of the lookup because two companies can each
        # have a queue on the same extension number.
        query = {"extension": ident}
        if domain:
            query["domain"] = domain
        return find_one_doc(QUEUES, query, QUEUE_FIELDS)
    except Exception as e:
        log("error", "queue lookup failed", queue=queue_key, error=str(e))
        return None


def load_tiers(queue_idents):
    """Who is in this queue and in what order.

    Returns a lookup of person to their round and position. Empty means everybody
    in the queue is treated as equal, which is how a simple queue behaves.
    """
    if not queue_idents:
        return {}
    try:
        rows = find_docs(
            TIERS,
            {"queue": {"$in": list(queue_idents)}},
            {"_id": 0, "agent": 1, "level": 1, "position": 1, "state": 1},
        )
    except Exception as e:
        log("error", "tier lookup failed", queues=list(queue_idents), error=str(e))
        return {}
    tiers = {}
    for row in rows:
        name = (row.get("agent") or "").strip()
        if name:
            tiers[name] = {
                "level": _as_int(row.get("level")),
                "position": _as_int(row.get("position")),
                "state": (row.get("state") or "").strip(),
            }
    return tiers


def load_agents(queue_id=None, names=None):
    """The people attached to a queue, with the counters that decide who is next."""
    try:
        if queue_id is not None:
            values = reference_values(queue_id) if isinstance(queue_id, str) else [queue_id]
            if not values:
                return []
            return find_docs(AGENTS, {"queue_uuid": {"$in": values}}, AGENT_FIELDS)
        if names:
            return find_docs(AGENTS, {"name": {"$in": list(names)}}, AGENT_FIELDS)
        return []
    except Exception as e:
        log("error", "agent lookup failed", queue=queue_id, error=str(e))
        return []


def load_agent_by_name(name):
    try:
        return find_one_doc(AGENTS, {"name": name}, AGENT_FIELDS)
    except Exception as e:
        log("error", "agent by name lookup failed", agent=name, error=str(e))
        return None


def update_agent(name, queue_id, assignments, increments=None):
    """Record what just happened to somebody, without ever interrupting a call.

    Everything here is bookkeeping. If it fails, the worst outcome is that the
    next routing decision is made on slightly older figures, so a failure is
    logged and swallowed rather than passed back to whoever reported it.
    """
    if not name:
        return False
    changes = {}
    if assignments:
        changes["$set"] = assignments
    if increments:
        changes["$inc"] = increments
    if not changes:
        return False
    query = {"name": name}
    if queue_id:
        values = reference_values(queue_id)
        if values:
            query["queue_uuid"] = {"$in": values}
    try:
        return update_doc(AGENTS, query, changes)
    except Exception as e:
        log("error", "agent update failed", agent=name, error=str(e))
        return False


# ---------------------------------------------------------------------------
# Reading what the database holds about one person
# ---------------------------------------------------------------------------

AVAILABLE_STATUSES = ("available", "available (on demand)", "available on demand")
BREAK_STATUSES = ("on break", "onbreak", "break")
LOGGED_OUT_STATUSES = ("logged out", "loggedout", "logged off")
ON_CALL_STATUSES = ("on queue call", "in a queue call", "on call")
ON_CALL_STATES = ("in a queue call", "receiving", "busy", "on a call", "on-a-call")

AVAILABLE = "available"
BUSY = "busy"
ON_A_CALL = "on-a-call"
WRAPPING_UP = "wrapping-up"
OFF_DUTY = "off-duty"


def _as_int(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_json(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8", "replace")
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except ValueError:
            return {}
    return {}


def split_agent_name(name):
    """Split "1000@example.com" into the extension and the company it belongs to."""
    text = (name or "").strip()
    if "@" in text:
        left, right = text.split("@", 1)
        return left.strip(), right.strip()
    return text, ""


def strip_device_suffix(extension):
    """The same person answers on a desk phone and in the browser, and each device
    adds its own tag to the name. The person is the same either way."""
    return re.sub(r'_(web|hw|mobile|pstn)$', '', extension or "")


def resolve_extension(row, user_detail):
    """Work out somebody's extension exactly the way the switch does, so the number
    shown on screen and the number that actually rings can never disagree."""
    detail_ext = str(user_detail.get("extension") or "").strip()
    if detail_ext:
        return detail_ext
    from_name = strip_device_suffix(split_agent_name(row.get("name"))[0])
    if from_name:
        return from_name
    contact = str(row.get("contact") or "")
    match = (re.search(r'user/([^@]+)@', contact)
             or re.search(r'sip:([^@]+)@', contact)
             or re.match(r'^([^@]+)@', contact))
    if match:
        return strip_device_suffix(match.group(1))
    return ""


def queue_wrap_seconds(queue):
    """How long somebody spends writing up notes after a call on this queue.

    It is set per queue, not per person: every agent record on this platform
    holds nought, and the real number lives on the queue. Reading only the agent
    record would mean nobody was ever given time to finish their notes.
    """
    if not queue:
        return 0
    settings = queue.get("settings") if isinstance(queue.get("settings"), dict) else {}
    return _as_int(settings.get("wrapup_time")) or _as_int(queue.get("wrap_seconds"))


def queue_ring_strategy(queue):
    """The ring order saved against the queue, used only when the switch does not
    say which one it wants."""
    if not queue:
        return ""
    settings = queue.get("settings") if isinstance(queue.get("settings"), dict) else {}
    strategy = settings.get("ring_strategy")
    if isinstance(strategy, dict):
        return str(strategy.get("value") or "")
    return str(strategy or "")


def wrap_seconds_for(row, wrap_default=0):
    return _as_int(row.get("wrap_up_time")) or _as_int(wrap_default)


def duty_state(row, now, wrap_default=0):
    """What somebody is doing right now, in the same words the rest of the product
    uses. Being free is not the same as being on duty for this queue: somebody can
    be at their desk and deliberately not taking queue calls, which is why "busy"
    and "signed out" are different answers.

    Anything we do not recognise is treated as not available. Ringing a phone
    nobody is sitting at costs the caller another half minute of hold music, so an
    unfamiliar label is the safer thing to skip.
    """
    status = (row.get("status") or "").strip().lower()
    state = (row.get("state") or "").strip().lower()

    if status in LOGGED_OUT_STATUSES or state in LOGGED_OUT_STATUSES:
        return OFF_DUTY
    if status in ON_CALL_STATUSES or state in ON_CALL_STATES:
        return ON_A_CALL
    if status in BREAK_STATUSES:
        return BUSY
    if status in AVAILABLE_STATUSES:
        wrap = wrap_seconds_for(row, wrap_default)
        last_end = _as_int(row.get("last_bridge_end"))
        if wrap > 0 and last_end > 0 and now < last_end + wrap:
            return WRAPPING_UP
        return AVAILABLE
    return OFF_DUTY


def seconds_until_free(row, now, wrap_default=0):
    """How long until somebody finishing their notes can be rung again."""
    if duty_state(row, now, wrap_default) != WRAPPING_UP:
        return None
    remaining = _as_int(row.get("last_bridge_end")) + wrap_seconds_for(row, wrap_default) - now
    return remaining if remaining > 0 else 0


def missed_too_many(row, now):
    """Somebody whose phone has been left ringing too many times in a row stops
    being offered calls, so callers are not sent to a desk nobody is at.

    The count is only believed while it is fresh. A stale count from a bad
    afternoon last week must not quietly remove somebody from their queue.
    """
    limit = _as_int(row.get("max_no_answer"))
    if limit <= 0:
        return False
    count = _as_int(row.get("no_answer_count"))
    if count < limit:
        return False
    last_change = _as_int(row.get("last_status_change"))
    if last_change > 0 and (now - last_change) > NO_ANSWER_WINDOW_SECONDS:
        return False
    return True


def is_ringable(row, now, wrap_default=0):
    if not str(row.get("contact") or "").strip():
        return False
    if missed_too_many(row, now):
        return False
    return duty_state(row, now, wrap_default) == AVAILABLE


def agent_payload(row):
    """The shape the switch reads.

    Two fields are load bearing. The switch prints the name straight into its log
    line, so a missing name stops the call dead; and it dials the contact, so an
    empty contact is a call that rings nowhere. Both are always filled in here,
    and nothing is ever sent as an empty value.
    """
    detail = _as_json(row.get("user_detail"))
    extension = resolve_extension(row, detail)
    name = str(row.get("name") or "").strip()
    if not name:
        name = extension or "unknown"
    payload = {
        "name": name,
        "contact": str(row.get("contact") or "").strip(),
        "extension": extension,
        "status": str(row.get("status") or "").strip(),
        "state": str(row.get("state") or "").strip(),
    }
    if detail:
        clean = {}
        for key, value in detail.items():
            if value is None:
                continue
            clean[key] = value
        if clean:
            payload["user_detail"] = clean
    return payload


# ---------------------------------------------------------------------------
# The decision itself
# ---------------------------------------------------------------------------

RING_ALL = "ring-all"


def normalize_strategy(value):
    """Accept every spelling of a ring strategy the product has ever used, and
    settle on one name for each. Written to match the switch exactly, so the same
    queue behaves the same way whichever side asks the question."""
    text = (value or "").strip().lower()
    text = re.sub(r'[\s_]+', '-', text)
    if text in ("", "linear", "call-linear", "sequentially-by-agent-order"):
        return "top-down"
    if text == "ringall":
        return RING_ALL
    if text == "longest-idle":
        return "longest-idle-agent"
    if text in ("least-talk-time", "least-talk"):
        return "agent-with-least-talk-time"
    if text in ("fewest-calls", "fewest-call"):
        return "agent-with-fewest-calls"
    return text


def order_agents(rows, strategy, tiers, now):
    """Put the eligible people in the order they should be tried.

    The order is the whole difference between one queue and another, so each
    strategy sorts on the figure that actually defines it rather than on a
    convenient stand-in.
    """
    def tier_key(row):
        tier = tiers.get(row.get("name")) or {}
        return (tier.get("level", 0), tier.get("position", 0), str(row.get("name") or ""))

    ordered = list(rows)
    if strategy == "longest-idle-agent":
        # Whoever has been off the phone longest goes first, so the work spreads
        # instead of landing on the same person all morning.
        ordered.sort(key=lambda r: (_as_int(r.get("last_bridge_end")), tier_key(r)))
    elif strategy == "agent-with-least-talk-time":
        ordered.sort(key=lambda r: (_as_int(r.get("talk_time")), tier_key(r)))
    elif strategy == "agent-with-fewest-calls":
        ordered.sort(key=lambda r: (_as_int(r.get("calls_answered")), tier_key(r)))
    elif strategy == "round-robin":
        ordered.sort(key=lambda r: (_as_int(r.get("last_offered_call")), tier_key(r)))
    elif strategy == "random":
        random.shuffle(ordered)
    else:
        # Top down, and anything unrecognised: the order the queue was set up in.
        ordered.sort(key=tier_key)
    return ordered


def decide_ring(rows, tiers, strategy, waited_seconds, already_tried=(),
                now=None, step_seconds=None, wrap_default=0):
    """Who this caller should ring right now, and why.

    A queue can widen: the first group is tried first, and a wider group is added
    if nobody picks up. People are added, never swapped out, so the first group
    keeps ringing - that is what stops a specialist queue going unanswered
    because the one expert is busy.
    """
    now = int(now if now is not None else time.time())
    step_seconds = ACD_STEP_SECONDS if step_seconds is None else step_seconds
    strategy = normalize_strategy(strategy)
    rings_together = strategy == RING_ALL

    levels = sorted({(tiers.get(r.get("name")) or {}).get("level", 0) for r in rows})
    if not levels:
        levels = [0]
    if step_seconds > 0:
        step_index = int(max(0, waited_seconds) // step_seconds)
    else:
        step_index = 0
    step_index = min(step_index, len(levels) - 1)
    open_level = levels[step_index]

    ringable = []
    for row in rows:
        level = (tiers.get(row.get("name")) or {}).get("level", 0)
        if level > open_level:
            continue
        if is_ringable(row, now, wrap_default):
            ringable.append(row)

    ordered = order_agents(ringable, strategy, tiers, now)

    # One person at a time means exactly that: somebody whose phone we have just
    # left ringing for this caller is passed over for the next attempt. Without
    # this the switch would be handed the same person again and again until the
    # caller gave up.
    skipped_as_tried = 0
    if not rings_together and already_tried:
        fresh = [r for r in ordered if r.get("name") not in already_tried]
        skipped_as_tried = len(ordered) - len(fresh)
        # Everybody has had a turn. Starting the list again is better than telling
        # the caller nobody is there, because somebody may have hung up by now.
        if fresh:
            ordered = fresh

    candidates = []
    if step_seconds > 0 and step_index < len(levels) - 1:
        candidates.append(int((step_index + 1) * step_seconds - waited_seconds))
    for row in rows:
        remaining = seconds_until_free(row, now, wrap_default)
        if remaining:
            candidates.append(int(remaining))
    candidates = [c for c in candidates if c and c > 0]
    changes_in = min(candidates) if candidates else None

    return {
        "agents": ordered,
        "rings_together": rings_together,
        "step": step_index + 1,
        "steps": len(levels),
        "changes_in_seconds": changes_in,
        "reason": explain(rows, ordered, strategy, step_index, len(levels),
                          skipped_as_tried, now, wrap_default),
    }


def explain(rows, ordered, strategy, step_index, step_count, skipped_as_tried, now,
            wrap_default=0):
    """Say in plain words why the list looks like this, so somebody reading the
    log can see what the queue did without reading the code."""
    if ordered:
        names = [str(r.get("name") or "someone") for r in ordered]
        who = ", ".join(names[:4]) + ("" if len(names) <= 4 else " and %d more" % (len(names) - 4))
        how = ("Ringing %d together" % len(ordered)) if strategy == RING_ALL else "Trying one at a time, in this order"
        prefix = "Round %d of %d: " % (step_index + 1, step_count) if step_count > 1 else ""
        tail = " (%d already tried on this call)" % skipped_as_tried if skipped_as_tried else ""
        return "%s%s: %s.%s" % (prefix, how, who, tail)
    if not rows:
        return "Nobody is in this queue at all."
    states = [duty_state(r, now, wrap_default) for r in rows]
    wrapping = states.count(WRAPPING_UP)
    on_call = states.count(ON_A_CALL)
    on_break = states.count(BUSY)
    signed_out = states.count(OFF_DUTY)
    missed = sum(1 for r in rows if missed_too_many(r, now))
    parts = [text for text in (
        "%d finishing notes" % wrapping if wrapping else "",
        "%d on a call" % on_call if on_call else "",
        "%d on a break" % on_break if on_break else "",
        "%d signed out" % signed_out if signed_out else "",
        "%d passed over for missed calls" % missed if missed else "",
    ) if text]
    if not parts:
        return "Nobody in this queue can take the call right now."
    return "Nobody can take it right now - " + ", ".join(parts) + "."


# ---------------------------------------------------------------------------
# Short-lived memory
# ---------------------------------------------------------------------------

_agent_cache = {}
_cache_lock = threading.Lock()

_calls = {}
_calls_lock = threading.Lock()


def cached_queue_agents(queue_key, loader, now=None):
    now = now if now is not None else time.time()
    with _cache_lock:
        hit = _agent_cache.get(queue_key)
        if hit and hit[0] > now:
            return hit[1]
    answer = loader(queue_key)
    with _cache_lock:
        _agent_cache[queue_key] = (now + AGENT_CACHE_SECONDS, answer)
        if len(_agent_cache) > 2000:
            for key in [k for k, v in _agent_cache.items() if v[0] <= now]:
                _agent_cache.pop(key, None)
    return answer


def call_memory(call_uuid, now=None):
    """What we already know about this caller: when they joined, and whose phone we
    have already left ringing for them."""
    now = now if now is not None else time.time()
    if not call_uuid or call_uuid == "unknown":
        return {"first_seen": now, "tried": {}}
    with _calls_lock:
        entry = _calls.get(call_uuid)
        if entry is None:
            entry = {"first_seen": now, "tried": {}}
            _calls[call_uuid] = entry
        return entry


def remember_offer(call_uuid, names, now=None):
    now = now if now is not None else time.time()
    if not call_uuid or call_uuid == "unknown" or not names:
        return
    with _calls_lock:
        entry = _calls.setdefault(call_uuid, {"first_seen": now, "tried": {}})
        for name in names:
            entry["tried"][name] = now


def prune_calls(now=None):
    """Forget callers who are long gone. Memory has to stay flat on a service that
    is never restarted."""
    now = now if now is not None else time.time()
    with _calls_lock:
        stale = [k for k, v in _calls.items() if now - v.get("first_seen", now) > CALL_MEMORY_SECONDS]
        for key in stale:
            _calls.pop(key, None)
        if len(_calls) > CALL_MEMORY_MAX:
            oldest = sorted(_calls.items(), key=lambda kv: kv[1].get("first_seen", 0))
            for key, _ in oldest[: len(_calls) - CALL_MEMORY_MAX]:
                _calls.pop(key, None)
    return len(stale)


def tried_names(entry, call_timeout, now=None):
    """Whose phone we have left ringing for this caller recently enough that trying
    them again would just repeat the same wait."""
    now = now if now is not None else time.time()
    window = max(float(call_timeout or 0), 10.0) * 2
    return {name for name, when in (entry.get("tried") or {}).items() if now - when <= window}


# ---------------------------------------------------------------------------
# Putting a queue together with the people in it
# ---------------------------------------------------------------------------

def queue_identifiers(queue_key, queue_row):
    """Every name this queue is known by, because the switch may send any of them:
    its own reference, its extension, or the extension and company together."""
    idents = []
    key = (queue_key or "").strip()
    if key:
        idents.append(key)
    if queue_row:
        for value in (queue_row.get("_id"), queue_row.get("extension"), queue_row.get("name")):
            value = str(value or "").strip()
            if value and value not in idents:
                idents.append(value)
        extension = str(queue_row.get("extension") or "").strip()
        domain = str(queue_row.get("domain") or "").strip()
        if extension and domain:
            joined = "%s@%s" % (extension, domain)
            if joined not in idents:
                idents.append(joined)
    return idents


def load_queue_roster(queue_key):
    """Everyone in a queue, the queue's own settings, and the order they sit in.

    The direct link from a person to their queue is tried first because it is the
    one that always exists and is the one the database is indexed for. The
    separate running-order records are used where they exist and skipped where
    they do not.
    """
    queue_row = load_queue(queue_key)
    idents = queue_identifiers(queue_key, queue_row)

    queue_id = (queue_row or {}).get("_id") or queue_key
    rows = load_agents(queue_id=queue_id)

    tiers = load_tiers(idents)
    if not rows and tiers:
        rows = load_agents(names=sorted(tiers.keys()))
    return rows, tiers, (queue_row or {})


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

EMPTY_ANSWER = {"agents": []}

AGENT_ACTIONS = (
    "state", "status", "call-end", "call-start", "call-complete",
    "wrapup-start", "no-answer",
)


class QueueAgentHandler(BaseHTTPRequestHandler):
    server_version = "queue-agent-service"
    protocol_version = "HTTP/1.1"

    # -- plumbing ----------------------------------------------------------

    def log_message(self, fmt, *args):
        pass

    def _send(self, payload, code=200):
        body = json.dumps(payload, default=str).encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            log("error", "failed to write response", error=str(e))

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            return {}
        if length <= 0:
            return {}
        try:
            raw = self.rfile.read(length).decode("utf-8", "replace")
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    def _authorised(self):
        if not AUTH_TOKENS:
            return True
        header = self.headers.get("Authorization", "")
        token = header[7:].strip() if header.lower().startswith("bearer ") else header.strip()
        return token in AUTH_TOKENS

    # -- routing -----------------------------------------------------------

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def _handle(self, method):
        """One way in and out for every request.

        Everything is wrapped, because the caller on the other end of this is a
        person on hold. A mistake in here must cost them a moment of hold music,
        never their call.
        """
        try:
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            query = parse_qs(parsed.query)

            if path in ("/health", "/liveness", "/api/callcenter/health"):
                self._send({"status": "ok"})
                return

            if not self._authorised():
                # Still a shaped answer: the switch cannot read a refusal, and a
                # refusal it cannot read would sound to a caller like a dead line.
                log("warn", "rejected an unauthorised request", path=path)
                self._send(EMPTY_ANSWER, 401)
                return

            match = re.match(r'^/api/callcenter/queues/(.+)/agents$', path)
            if match and method == "GET":
                self._queue_agents(unquote(match.group(1)), query)
                return

            match = re.match(r'^/api/callcenter/agents/([^/]+)$', path)
            if match:
                tail = unquote(match.group(1))
                if tail in AGENT_ACTIONS:
                    self._agent_action(tail, method)
                    return
                if method == "GET":
                    self._agent_detail(tail)
                    return

            self._send({"error": "not found", "agents": []}, 404)
        except Exception as e:
            log("error", "unhandled request failure", path=self.path, error=str(e))
            # Deliberately a normal, empty answer. The switch reads this as "nobody
            # is free just now" and keeps the caller waiting, which is exactly what
            # should happen while something here is broken.
            self._send(EMPTY_ANSWER)

    # -- the endpoint the switch asks on every poll ------------------------

    def _queue_agents(self, queue_key, query):
        started = time.time()
        now = int(started)
        strategy = (query.get("strategy") or [""])[0]
        call_uuid = (query.get("call_uuid") or [""])[0]
        call_timeout = _as_int((query.get("call_timeout") or ["0"])[0], 0)

        entry = call_memory(call_uuid, started)
        waited = max(0.0, started - entry.get("first_seen", started))

        try:
            rows, tiers, queue = cached_queue_agents(queue_key, load_queue_roster, started)
        except Exception as e:
            log("error", "could not read the queue", queue=queue_key, error=str(e))
            rows, tiers, queue = [], {}, {}

        # The switch normally says how the queue should ring. When it does not,
        # the queue's own saved setting is used rather than a guess.
        if not (strategy or "").strip():
            strategy = queue_ring_strategy(queue)

        decision = decide_ring(
            rows, tiers, strategy, waited,
            already_tried=tried_names(entry, call_timeout, started),
            now=now,
            wrap_default=queue_wrap_seconds(queue),
        )
        chosen = decision["agents"]

        # Only the people actually about to be rung are remembered as tried. When
        # they all ring together there is no next one to move on to, so nothing is
        # written down and the same group is offered again next time.
        if not decision["rings_together"] and chosen:
            remember_offer(call_uuid, [chosen[0].get("name")], started)

        payload = {
            "agents": [agent_payload(r) for r in chosen],
            "queue": queue_key,
            "strategy": normalize_strategy(strategy),
            "rings_together": decision["rings_together"],
            "step": decision["step"],
            "steps": decision["steps"],
            "count": len(chosen),
            "changes_in_seconds": decision["changes_in_seconds"],
            "reason": decision["reason"],
        }
        log("info", "queue lookup",
            queue=queue_key, strategy=payload["strategy"], call_uuid=call_uuid,
            waited=int(waited), in_queue=len(rows), offered=len(chosen),
            ms=int((time.time() - started) * 1000), reason=payload["reason"])
        self._send(payload)

    # -- bookkeeping endpoints --------------------------------------------

    def _agent_action(self, action, method):
        """Everything the event manager tells us about a person: they went on a
        call, they came off one, they are writing up notes, they missed a call.

        These keep the picture of who is free honest between calls. They answer
        the same way whatever happens, because the sender does not act on the
        reply and must never be left waiting on it.
        """
        body = self._body()
        now = int(time.time())
        extension = strip_device_suffix(str(body.get("extension") or "").strip())
        domain = str(body.get("domain") or "").strip()
        queue_id = str(body.get("queue_id") or "").strip()
        name = "%s@%s" % (extension, domain) if extension and domain else ""

        if not name:
            # The switch's own missed-call report arrives with nothing in it: the
            # helper it uses to make web requests quietly drops the details. There
            # is nothing to record, and saying so is more useful than failing.
            log("warn", "agent update with nobody named", action=action, method=method)
            self._send({"ok": True, "recorded": False,
                        "reason": "no extension and domain were sent, so there was nobody to record this against"})
            return

        assignments = {"last_status_change": now}
        increments = {}

        if action == "state":
            state = str(body.get("state") or "").strip()
            if state:
                assignments["state"] = state
        elif action == "status":
            status = str(body.get("status") or "").strip()
            state = str(body.get("state") or "").strip()
            if status:
                assignments["status"] = status
            if state:
                assignments["state"] = state
        elif action == "call-start":
            assignments["last_bridge_start"] = now
            # Answering clears the run of missed calls. Without this, a person who
            # stepped away for one afternoon would be passed over for good.
            assignments["no_answer_count"] = 0
            increments["calls_answered"] = 1
        elif action == "call-end":
            assignments["last_bridge_end"] = now
            talk = _as_int(body.get("talk_time_seconds"))
            if talk > 0:
                increments["talk_time"] = talk
        elif action == "call-complete":
            assignments["last_bridge_end"] = now
        elif action == "wrapup-start":
            wrap = _as_int(body.get("wrapup_duration"))
            assignments["last_bridge_end"] = now
            if wrap > 0:
                assignments["wrap_up_time"] = wrap
        elif action == "no-answer":
            assignments["last_offered_call"] = now
            increments["no_answer_count"] = 1

        recorded = update_agent(name, queue_id, assignments, increments)
        # The answer just changed for this queue, so the short-lived copy is dropped
        # rather than left to go stale for a couple of seconds.
        with _cache_lock:
            _agent_cache.clear()
        log("info", "agent update", action=action, agent=name, queue=queue_id, recorded=recorded)
        self._send({"ok": True, "recorded": recorded, "agent": name, "action": action})

    def _agent_detail(self, agent_name):
        """One person's record, used to put a real name on screen instead of an
        extension number."""
        row = load_agent_by_name(agent_name)
        if not row:
            self._send({"error": "agent not found"}, 404)
            return
        self._send(agent_payload(row))


# ---------------------------------------------------------------------------
# Start-up
# ---------------------------------------------------------------------------

class _V6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def _housekeeping():
    while True:
        time.sleep(300)
        try:
            removed = prune_calls()
            if removed:
                log("debug", "forgot finished calls", removed=removed)
        except Exception as e:
            log("error", "housekeeping failed", error=str(e))


def main():
    host, port = LISTEN_ADDR.rsplit(":", 1)
    host = host if host and host != "localhost" else "127.0.0.1"
    port = int(port)

    # Both of these are wrong-but-survivable on purpose. Refusing to start would
    # leave the port dead, which is the exact problem this service exists to fix.
    # Started and answering "nobody is free" is the better of the two failures,
    # and it says so loudly in the log every time it is asked.
    if MongoClient is None:
        log("error", "the MongoDB driver is missing - install python3-pymongo. "
                     "Until then every queue will be answered as nobody free")
    if not MONGODB_URI:
        log("error", "MONGODB_URI is not set - every queue will be answered as nobody free")

    try:
        database = get_database()
        database.command("ping")
        log("info", "MongoDB connection verified OK", database=MONGODB_DATABASE,
            queues=database[QUEUES].estimated_document_count(),
            agents=database[AGENTS].estimated_document_count())
    except Exception as e:
        log("error", "MongoDB connection failed at start-up", error=str(e))

    threading.Thread(target=_housekeeping, daemon=True).start()

    servers = []
    primary = ThreadingHTTPServer((host, port), QueueAgentHandler)
    primary.daemon_threads = True
    servers.append(primary)
    log("info", "queue agent service listening", address="%s:%d" % (host, port))

    if LISTEN_HOST6:
        try:
            secondary = _V6Server((LISTEN_HOST6, port), QueueAgentHandler)
            secondary.daemon_threads = True
            servers.append(secondary)
            log("info", "queue agent service listening", address="[%s]:%d" % (LISTEN_HOST6, port))
        except Exception as e:
            log("warn", "could not also listen on the IPv6 loopback", error=str(e))

    for server in servers[1:]:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
