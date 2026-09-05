#!/usr/bin/env python3
"""Three routing facts the queue promised and never had.

1. TALK TIME. "Agent with least talk time" sorted on `talk_time`, which was 0
   for all 37 agents - so it silently behaved as Top Down. The event manager
   reports call-end with a talk time of 0 because the switch never tells it
   how long the leg lasted. The queue script now reports each handled call
   itself (action `handled`, with the seconds it measured), and only that
   action adds talk time, so nothing is counted twice.

2. LAST AGENT. A repeat caller can be sent back to whoever they spoke to
   last. The same `handled` report writes (domain, queue, caller number ->
   agent, when) to `queue_last_agents`. On the next call the switch sends the
   caller number with its poll; if the queue's after-call setting asks for it
   and that agent is free and still on this queue, they ring first, alone,
   once. If they do not pick up, or are busy, routing carries on as normal -
   holding a caller for one person is a choice this product does not make.
   `QUEUE_MEMBERS_ONLY` looks for the last agent on THIS queue;
   `ANY_AGENT` for the caller's last agent on any queue in the company, who
   must still be a member here to be rung (there is nobody else to dial).

3. RATING. The queue editor rates each member 0-100 for this queue's work
   and "minimum rating in the first ring" sits under widening. Both were
   stored and ignored. Now, while widening is on, the first ring skips anyone
   rated below the minimum; the wider rings drop the requirement - widen,
   don't fail. If the filter would leave nobody, it is ignored rather than
   leaving a caller with no one, and the log says so. Unrated means 100.

Idempotent. Usage: patch_talk_last_agent_rating.py /opt/queue-agent-service/queue_agent_service.py
Requires patch_escalation_settings.py to have been applied first.
"""
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "/opt/queue-agent-service/queue_agent_service.py"
src = open(PATH).read()

if "def remember_last_agent(" in src:
    print("already applied")
    sys.exit(0)
if "def queue_escalation(" not in src:
    raise SystemExit("apply patch_escalation_settings.py first")

def replace_once(old, new, what):
    global src
    n = src.count(old)
    if n != 1:
        raise SystemExit("anchor for %s matched %d times, expected 1" % (what, n))
    src = src.replace(old, new)

# --- the queue record now needs its members (for ratings) -------------------
replace_once(
    '''QUEUE_FIELDS = {
    "_id": 1, "name": 1, "extension": 1, "domain": 1, "type": 1,
    "settings": 1, "wrap_seconds": 1, "max_wait_time": 1,
}
''',
    '''QUEUE_FIELDS = {
    "_id": 1, "name": 1, "extension": 1, "domain": 1, "type": 1,
    "settings": 1, "wrap_seconds": 1, "max_wait_time": 1, "members": 1,
}

LAST_AGENTS = "queue_last_agents"
''',
    "queue fields",
)

# --- readers for the two settings, the ratings map, and the last-agent store --
replace_once(
    '''ESCALATION_STEP_MIN = 15
ESCALATION_STEP_MAX = 600
''',
    '''ESCALATION_STEP_MIN = 15
ESCALATION_STEP_MAX = 600

LAST_AGENT_MODES = ("QUEUE_MEMBERS_ONLY", "ANY_AGENT")
LAST_AGENT_WINDOW_MAX_HOURS = 720


def queue_last_agent_setting(queue):
    """(mode, window_seconds) from the queue's after-call block; ("", 0) when off."""
    settings = queue.get("settings") if isinstance(queue, dict) else None
    after = settings.get("after_call") if isinstance(settings, dict) else None
    block = after.get("last_agent") if isinstance(after, dict) else None
    if not isinstance(block, dict):
        return "", 0
    mode = str(block.get("mode") or "").strip().upper()
    if mode not in LAST_AGENT_MODES:
        return "", 0
    hours = _as_int(block.get("window_hours"), 24)
    hours = max(1, min(LAST_AGENT_WINDOW_MAX_HOURS, hours))
    return mode, hours * 3600


def queue_min_rating(queue):
    """The lowest rating allowed in the first ring, 0 when there is no bar."""
    settings = queue.get("settings") if isinstance(queue, dict) else None
    block = settings.get("escalation") if isinstance(settings, dict) else None
    if not isinstance(block, dict):
        return 0
    return max(0, min(100, _as_int(block.get("minimum_rating"), 0)))


def member_ratings(queue):
    """{extension: rating} for this queue's members. Unrated is 100: a queue that
    has never rated anybody must behave exactly as before."""
    ratings = {}
    members = queue.get("members") if isinstance(queue, dict) else None
    if isinstance(members, str):
        try:
            members = json.loads(members)
        except Exception:
            members = None
    for member in members or []:
        if not isinstance(member, dict):
            continue
        extension = strip_device_suffix(str(member.get("extension") or member.get("value") or "").strip())
        if not extension:
            continue
        raw = member.get("rating")
        ratings[extension] = 100 if raw is None or raw == "" else max(0, min(100, _as_int(raw, 100)))
    return ratings


def rating_of(row, ratings):
    extension = strip_device_suffix(split_agent_name(str(row.get("name") or ""))[0])
    return ratings.get(extension, 100) if ratings else 100


def remember_last_agent(domain, queue_id, caller, agent_name, now):
    """Write down who took this caller's call, so they can be asked for again."""
    caller = str(caller or "").strip()
    if not caller or caller == "unknown" or not agent_name or not domain:
        return False
    try:
        get_database()[LAST_AGENTS].update_one(
            {"domain": domain, "queue_id": str(queue_id or ""), "caller": caller},
            {"$set": {"agent": agent_name, "at": int(now)}},
            upsert=True,
        )
        return True
    except Exception as e:
        log("error", "could not remember the last agent", caller=caller, error=str(e))
        return False


def last_agent_for(domain, queue_id, caller, mode, window_seconds, now):
    """The agent this caller spoke to last, within the window, or None."""
    caller = str(caller or "").strip()
    if not caller or caller == "unknown" or not mode or window_seconds <= 0:
        return None
    query = {"domain": domain, "caller": caller, "at": {"$gte": int(now) - int(window_seconds)}}
    if mode == "QUEUE_MEMBERS_ONLY":
        query["queue_id"] = str(queue_id or "")
    try:
        rows = find_docs(LAST_AGENTS, query, {"_id": 0, "agent": 1, "at": 1}, limit=20)
    except Exception as e:
        log("error", "last agent lookup failed", caller=caller, error=str(e))
        return None
    rows = sorted(rows or [], key=lambda r: _as_int(r.get("at")), reverse=True)
    return str(rows[0].get("agent") or "") or None if rows else None
''',
    "settings readers",
)

# --- the planner: the first ring can require a rating --------------------------
replace_once(
    '''def decide_ring(rows, tiers, strategy, waited_seconds, already_tried=(),
                now=None, step_seconds=None, wrap_default=0, widen=True):
''',
    '''def decide_ring(rows, tiers, strategy, waited_seconds, already_tried=(),
                now=None, step_seconds=None, wrap_default=0, widen=True,
                ratings=None, min_rating=0):
''',
    "decide_ring signature",
)
replace_once(
    '''    ordered = order_agents(ringable, strategy, tiers, now)
''',
    '''    # The first ring may ask for a minimum rating. Only the first: the wider
    # rings exist precisely to drop a requirement when the best people cannot
    # answer. And never to the point of nobody - a bar that empties the ring is
    # ignored, and the reason says so.
    rating_note = ""
    if widen and min_rating > 0 and step_index == 0 and ringable:
        qualified = [r for r in ringable if rating_of(r, ratings) >= min_rating]
        if qualified:
            skipped = len(ringable) - len(qualified)
            if skipped:
                rating_note = " (%d rated under %d held back for the first ring)" % (skipped, min_rating)
            ringable = qualified
        else:
            rating_note = " (nobody free is rated %d or above, so the bar was waived)" % min_rating

    ordered = order_agents(ringable, strategy, tiers, now)
''',
    "rating filter",
)
replace_once(
    '''        "reason": explain(rows, ordered, strategy, step_index, len(levels),
                          skipped_as_tried, now, wrap_default),
    }
''',
    '''        "reason": explain(rows, ordered, strategy, step_index, len(levels),
                          skipped_as_tried, now, wrap_default) + rating_note,
    }
''',
    "reason note",
)

# --- the poll: prefer the last agent, once, then carry on ------------------------
replace_once(
    '''        widen, step_seconds = queue_escalation(queue)
        decision = decide_ring(
            rows, tiers, strategy, waited,
            already_tried=tried_names(entry, call_timeout, started),
            now=now,
            step_seconds=step_seconds,
            wrap_default=queue_wrap_seconds(queue),
            widen=widen,
        )
        chosen = decision["agents"]
''',
    '''        widen, step_seconds = queue_escalation(queue)
        tried = tried_names(entry, call_timeout, started)
        decision = decide_ring(
            rows, tiers, strategy, waited,
            already_tried=tried,
            now=now,
            step_seconds=step_seconds,
            wrap_default=queue_wrap_seconds(queue),
            widen=widen,
            ratings=member_ratings(queue),
            min_rating=queue_min_rating(queue),
        )
        chosen = decision["agents"]

        # A repeat caller goes back to whoever they spoke to last - if the queue
        # asks for it, and only if that person is free and has not already been
        # rung for this call. One attempt, alone; then normal routing.
        caller = (query.get("caller") or [""])[0]
        mode, window_seconds = queue_last_agent_setting(queue)
        if mode and caller and chosen:
            _, queue_domain = split_agent_name(queue_key)
            queue_domain = queue_domain or str(queue.get("domain") or "")
            preferred = last_agent_for(queue_domain, (queue or {}).get("_id") or queue_key,
                                       caller, mode, window_seconds, now)
            if preferred and preferred not in tried:
                match = [r for r in chosen if r.get("name") == preferred]
                if match:
                    chosen = match
                    decision["agents"] = match
                    decision["rings_together"] = False
                    decision["reason"] = ("Ringing %s first: they took this caller's last call. " % preferred) + decision["reason"]
''',
    "planner call",
)

# --- the report the switch makes after every answered call ---------------------
replace_once(
    '''AGENT_ACTIONS = (
    "state", "status", "call-end", "call-start", "call-complete",
    "wrapup-start", "no-answer",
)
''',
    '''AGENT_ACTIONS = (
    "state", "status", "call-end", "call-start", "call-complete",
    "wrapup-start", "no-answer", "handled",
)
''',
    "actions",
)
replace_once(
    '''        elif action == "no-answer":
            assignments["last_offered_call"] = now
            increments["no_answer_count"] = 1
''',
    '''        elif action == "no-answer":
            assignments["last_offered_call"] = now
            increments["no_answer_count"] = 1
        elif action == "handled":
            # The switch's own report: this person took this caller's call and
            # spoke for this long. The only place talk time is ever added, so
            # the event manager's call-end (which carries none) cannot double it.
            talk = _as_int(body.get("talk_time_seconds"))
            if talk > 0:
                increments["talk_time"] = talk
            remember_last_agent(domain, queue_id, body.get("caller_number"), name, now)
''',
    "handled action",
)

open(PATH, "w").write(src)
print("patched", PATH)
