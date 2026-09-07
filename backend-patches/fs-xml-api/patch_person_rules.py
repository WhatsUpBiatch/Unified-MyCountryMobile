"""Make a person's own call rules reach direct calls to their extension.

WHY. Three personal screens store rules that nothing on the switch reads:

  * My Phone (and the admin Call Rules drawer) saves `users.call_forwarding`:
    forward-all, do-not-disturb, the ring time per device and "if busy /
    unanswered / unreachable" (one destination for all three - the screen's
    Busy switch is commented out, so there is one stored key for both).
  * Preferences saves `users.settings.operational_hours`: the person's own
    hours, holidays, timezone and a `closed_hour_action`, in the same shape
    the company block uses. My Phone also saves a `closed_hour_action` under
    `incoming_calls`, so both places are read.
  * Greetings saves `users.greetings.voicemail`: the person's own voicemail
    greeting, a media file living in object storage.

`build_inbound_dialplan` rings `user/<ext>` for the company's ring time and
then, with `continue_on_fail=true` and nothing after the bridge, ends the
call. So a person who set "when I don't answer, voicemail" is hung up on, a
person on do-not-disturb still rings, and a personal greeting is never heard.

WHAT IT DOES. Decided 3 Sep 2026 (row 17): a person's rules apply to DIRECT
calls only - the EXTENSION route - never to queue calls. So the hook sits
immediately above `if route_type == "EXTENSION":`, after every company,
number, queue and menu check, and reads nothing at all for any other route.

  1. `person_record(company_uuid, extension)`: one SELECT of `settings`,
     `call_forwarding`, `greetings` on `users` by company and extension, cached
     per (company, extension) for CALLING_RULES_CACHE_SECONDS, exactly as
     `get_calling_rules` reads `settings.international_calling`. A failed read
     is logged at error, not cached, and answers None - today's behaviour.

  2. `person_call_plan(record, own_ext, company_seconds)`: what the rules
     say, in the order the reference products apply them:
       forward all   `call_forwarding.forward_calls` enabled with a type and
                     value -> the call is rerouted there before it rings.
       do not disturb `call_forwarding.dnd` true -> the person's own
                     voicemail; or, if `dnd` is stored as an enabled
                     {type, value} block, that destination.
       personal hours `settings.operational_hours` judged by the SAME
                     `business_hours_state` the company uses. Only a definite
                     "closed" diverts: to `settings.operational_hours.
                     closed_hour_action`, else `call_forwarding.incoming_calls.
                     closed_hour_action` (each only if enabled with type and
                     value), else the person's own voicemail. No hours, an
                     unusable timezone, garbage -> "unknown" -> open.
       ring time     the longest `timeout` among the person's own ACTIVE
                     device rows in `incoming_calls.device_options` (rows
                     whose `value` is their own extension), held to
                     RING_SECONDS_MIN..MAX; the SHORTER of that and the
                     company's ring time wins. No usable value -> company.
       after ring    `incoming_calls.failure_action` (busy, unanswered and
                     unreachable share this one key) enabled with a type and
                     value -> appended AFTER the bridge, where
                     `continue_on_fail=true` already lets the call carry on:
                     VOICEMAIL (the same actions the VOICEMAIL branch runs,
                     greeting included), EXTENSION (a second bridge), HANGUP.
                     Other types cannot be run after a bridge from here and
                     are logged as not applied.
     A reroute falls into the ordinary route-type chain below the hook, so
     wherever the rule points - voicemail, a colleague, an outside number, a
     queue, a menu - the existing branch takes it. Rules are applied ONCE, for
     the extension originally dialled: a reroute to a colleague does not then
     read the colleague's rules, so two people forwarding to each other
     cannot loop. A rule pointing at the person's own extension is ignored
     (forward-all) or becomes their voicemail (do-not-disturb, closed).

  3. `person_greeting_actions(company_uuid, extension)`: in the VOICEMAIL
     branch, and in the after-ring voicemail, `greetings.voicemail` (also
     read as `voicemail_greeting` and `vm`) enabled with a value is fetched
     from object storage through queue_media's `fetch_greeting` - the same
     helper, same bucket path, that queue greetings use - and played before
     the beep. The recording script plays only a tone, so nothing doubles up.
     A file that cannot be fetched is logged and the beep plays as today.

Every rule that changes a call logs one info line, "person rule applied",
naming the rule. Unknown or garbage never diverts; any exception anywhere in
the hook logs at error and the call goes exactly as it does today.

Not touched: the QUEUE, IVR, PHONE and HANGUP branches, the company, number,
queue and menu hours checks, recording, the channel guard, anything outbound.

Idempotent: a marker comment records that the helpers are present, and a
second run stops before touching anything. Every anchor must match exactly
once or the patch refuses to write. The anchors assume the line-hours patch
of 3 Sep 2026 is already in the file (its helper `ivr_operational_hours` is
where the new helpers are placed), which is the production file today.
"""

import io
import os
import py_compile
import shutil
import sys
import time

PATH = sys.argv[1]
MARKER = "# person_rules: a person's own call rules reach direct calls to them"

with io.open(PATH, encoding="utf-8") as handle:
    text = handle.read()

if MARKER in text:
    print("already applied: %s" % PATH)
    raise SystemExit(0)


# --- 1. the greeting fetch helper, borrowed from the queue audio module ------

ANCHOR_IMPORT = '''from queue_media import queue_audio_actions, queue_closed_route
'''

IMPORT = '''from queue_media import queue_audio_actions, queue_closed_route, fetch_greeting, safe_name
'''


# --- 2. the helpers, placed right after ivr_operational_hours ----------------

ANCHOR_HELPERS = '''    _ivr_hours_cache[key] = hours
    _ivr_hours_cache_time[key] = now
    return hours


_recording_cache = {}
_recording_cache_time = {}
'''

HELPERS = '''    _ivr_hours_cache[key] = hours
    _ivr_hours_cache_time[key] = now
    return hours


''' + MARKER + '''
#
# Read off the person's own row: `settings.operational_hours` (Preferences),
# `call_forwarding` (My Phone / the admin Call Rules drawer) and `greetings`
# (Greetings). Applied to DIRECT calls only - the EXTENSION route - never to a
# queue call. Cached per (company, extension) because this runs on the path of
# every call to a person.
_person_cache = {}
_person_cache_time = {}

# The destination types the route chain below the hook knows how to run.
PERSON_ROUTE_TYPES = ("VOICEMAIL", "EXTENSION", "PHONE", "QUEUE", "IVR", "HANGUP")
# The ones that can also run AFTER a failed bridge, from inside the same
# extension. A queue or a menu needs the answer/script sequence of its own
# branch; a carrier leg needs a provider lookup. Those are rerouted before the
# ring (forward-all, do-not-disturb, closed) but not after it.
PERSON_AFTER_RING_TYPES = ("VOICEMAIL", "EXTENSION", "HANGUP")
# What a stored value may look like: an extension, a uuid, a Mongo id, an
# E.164 number. build_internal_xml does not escape attribute values, so
# anything else is refused rather than passed into the document.
_PERSON_VALUE_RE = re.compile(r"^[A-Za-z0-9+_.@-]{1,64}$")


def person_record(company_uuid, extension):
    """The person's stored rules: {"settings", "call_forwarding", "greetings"}
    each parsed to an object, or None where there is no such person or the
    read failed. None must always mean "what happens today".
    """
    ext = str(extension or "").strip()
    if not company_uuid or not ext:
        return None
    key = (company_uuid, ext)
    now = time.time()
    if key in _person_cache and (now - _person_cache_time.get(key, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _person_cache[key]
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT settings, call_forwarding, greetings FROM users
                WHERE company_uuid = %s AND extension = %s AND status = 'ACTIVE'
                LIMIT 1
            """, (company_uuid, ext))
            row = cur.fetchone()
    except Exception as e:
        # Not cached: the next call tries again, and until then rings as today.
        log("error", "person rules lookup failed, ringing as today: %s" % e,
            company=company_uuid, extension=ext)
        return None
    record = None
    if row:
        record = {}
        for column in ("settings", "call_forwarding", "greetings"):
            value = _as_object(row.get(column))
            record[column] = value if isinstance(value, dict) else {}
    # "No such person" is cached too - it costs a query per call otherwise.
    _person_cache[key] = record
    _person_cache_time[key] = now
    return record


def _person_value(value):
    text = str(value or "").strip()
    return text if _PERSON_VALUE_RE.match(text) else ""


def _person_dict(value):
    """A stored block as a dict, or {} - a list, a number or bad JSON where an
    object was expected is "nothing set", not an error."""
    value = _as_object(value)
    return value if isinstance(value, dict) else {}


def person_route(action, own_ext, allowed=PERSON_ROUTE_TYPES):
    """A stored destination block {type, value, enabled, personal, ...} as a
    route {"type", "value", "label", "name"} the branch chain can run, or
    None. Only a block that is switched on AND has a known type AND a value
    counts. Two things the screens do are read back: a VOICEMAIL block marked
    `personal` may carry an empty value and means the person's own voicemail;
    a HANGUP block needs no value at all.
    """
    action = _person_dict(action)
    if not action.get("enabled"):
        return None
    kind = str(action.get("type") or "").strip().upper()
    if kind not in allowed:
        return None
    value = _person_value(action.get("value"))
    if not value and kind == "VOICEMAIL" and action.get("personal"):
        value = _person_value(own_ext)
    if not value and kind == "HANGUP":
        value = "HANGUP"
    if not value:
        return None
    label = str(action.get("value_label") or action.get("label") or action.get("name") or "")
    return {"type": kind, "value": value, "label": label, "name": label}


def _own_voicemail(own_ext):
    return {"type": "VOICEMAIL", "value": own_ext, "label": "", "name": ""}


def person_ring_seconds(forwarding, own_ext, company_seconds):
    """The shorter of the person's own ring time and the company's.

    The person's is the longest `timeout` among their own ACTIVE device rows
    (`value` == their extension; colleague rows are somebody else's phone)
    held to RING_SECONDS_MIN..MAX. One bridge rings every device at once, so
    the device that asked for the most time gets it - an under-ring loses a
    call, an over-ring does not. Returns (seconds, person_seconds or None).
    """
    incoming = _person_dict(_person_dict(forwarding).get("incoming_calls"))
    devices = incoming.get("device_options")
    longest = None
    if isinstance(devices, list):
        for row in devices:
            if not isinstance(row, dict) or not row.get("status"):
                continue
            if str(row.get("value") or "").strip() != own_ext:
                continue
            try:
                seconds = int(str(row.get("timeout") or "").strip())
            except (TypeError, ValueError):
                continue
            if not (RING_SECONDS_MIN <= seconds <= RING_SECONDS_MAX):
                continue
            if longest is None or seconds > longest:
                longest = seconds
    if longest is None:
        return company_seconds, None
    return min(longest, company_seconds), longest


def person_call_plan(record, own_ext, company_seconds):
    """What this person's own rules say about a direct call to them.

    {"reroute": route or None, "rule": the rule that rerouted or None,
     "ring_seconds": int, "person_seconds": int or None,
     "after_ring": route or None, "after_ring_skipped": type or None}

    Never raises: anything unreadable is "no rule", and the caller wraps this
    in its own guard besides.
    """
    plan = {"reroute": None, "rule": None, "ring_seconds": company_seconds,
            "person_seconds": None, "after_ring": None, "after_ring_skipped": None}
    own_ext = _person_value(own_ext)
    if not isinstance(record, dict) or not own_ext:
        return plan
    settings = _person_dict(record.get("settings"))
    forwarding = _person_dict(record.get("call_forwarding"))
    incoming = _person_dict(forwarding.get("incoming_calls"))

    # 1. Forward all calls - "checked first" on the screen.
    route = person_route(forwarding.get("forward_calls"), own_ext)
    if route and not (route["type"] == "EXTENSION" and route["value"] == own_ext):
        plan["reroute"], plan["rule"] = route, "forward all calls"
        return plan

    # 2. Do not disturb. Stored as a plain true by every screen today; an
    # enabled {type, value} block is read as a destination should one appear.
    dnd = forwarding.get("dnd")
    if dnd is True or (isinstance(dnd, dict) and dnd.get("enabled")):
        route = person_route(dnd, own_ext) if isinstance(dnd, dict) else None
        if not route or (route["type"] == "EXTENSION" and route["value"] == own_ext):
            route = _own_voicemail(own_ext)
        plan["reroute"], plan["rule"] = route, "do not disturb"
        return plan

    # 3. The person's own hours. Same judge as the company's; only a definite
    # "closed" diverts.
    hours = _person_dict(settings.get("operational_hours"))
    if hours and business_hours_state(hours) == OPERATIONAL_HOURS_CLOSED:
        route = (person_route(hours.get("closed_hour_action"), own_ext)
                 or person_route(incoming.get("closed_hour_action"), own_ext))
        if not route or (route["type"] == "EXTENSION" and route["value"] == own_ext):
            route = _own_voicemail(own_ext)
        plan["reroute"], plan["rule"] = route, "personal hours closed"
        return plan

    # 4. The call rings. How long, and what happens if nobody picks up.
    plan["ring_seconds"], plan["person_seconds"] = person_ring_seconds(forwarding, own_ext, company_seconds)
    failure = _person_dict(incoming.get("failure_action"))
    route = person_route(failure, own_ext, allowed=PERSON_AFTER_RING_TYPES)
    if route and not (route["type"] == "EXTENSION" and route["value"] == own_ext):
        plan["after_ring"] = route
    elif not route:
        kind = str(failure.get("type") or "").strip().upper()
        if failure.get("enabled") and kind in PERSON_ROUTE_TYPES and kind not in PERSON_AFTER_RING_TYPES:
            plan["after_ring_skipped"] = kind
    return plan


def person_greeting_actions(company_uuid, extension):
    """The playback of the person's own voicemail greeting, or [] for the
    plain beep. Read as `greetings.voicemail`, `voicemail_greeting` or `vm`,
    whichever is present; fetched once from object storage by the same helper
    the queue greetings use and played from disk after that.
    """
    try:
        record = person_record(company_uuid, extension)
        greetings = _person_dict(record.get("greetings")) if isinstance(record, dict) else {}
        block = None
        for key in ("voicemail", "voicemail_greeting", "vm"):
            candidate = _person_dict(greetings.get(key))
            if candidate:
                block = candidate
                break
        if not block or not block.get("enabled"):
            return []
        name = safe_name(block.get("value"))
        if not name:
            return []
        path = fetch_greeting(company_uuid, name, log=log)
        if not path:
            log("warn", "personal voicemail greeting could not be fetched, playing the beep only",
                extension=extension, file=name)
            return []
        log("info", "person rule applied", rule="voicemail greeting", extension=extension, file=name)
        return [{"application": "playback", "data": path}]
    except Exception as e:
        log("error", "personal voicemail greeting failed, playing the beep only: %s" % e,
            extension=extension)
        return []


def person_after_ring_actions(route, own_ext, domain, company_uuid):
    """What runs after the bridge to the person has failed - busy, no answer,
    not registered - for a route person_call_plan allowed there."""
    if not route:
        return []
    kind, value = route["type"], route["value"]
    if kind == "VOICEMAIL":
        return [
            {"application": "set", "data": f"accountcode={company_uuid}"},
            {"application": "set", "data": f"vm_target_extension={value}"},
            {"application": "answer", "data": ""},
        ] + person_greeting_actions(company_uuid, value) + [
            {"application": "lua", "data": FS_SCRIPTS + "save-voicemail.lua"},
        ]
    if kind == "EXTENSION":
        return [{"application": "bridge", "data": f"user/{value}_web@{domain},user/{value}@{domain}"}]
    if kind == "HANGUP":
        return [{"application": "hangup", "data": "NORMAL_CLEARING"}]
    return []


_recording_cache = {}
_recording_cache_time = {}
'''


# --- 3. the hook and the EXTENSION branch in build_inbound_dialplan ----------

OLD_EXTENSION = '''    if route_type == "EXTENSION":
        target_ext = route_value
        recording_mode = company_recording_policy(db_name)
        actions = [
            {"application": "set", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            {"application": "set", "data": f"sip_h_X-Billing-Owner-UUID={company_uuid}"},
            {"application": "set", "data": f"call_timeout={company_ring_seconds(db_name, company_uuid)}"},
            {"application": "set", "data": "continue_on_fail=true"},
            {"application": "set", "data": "hangup_after_bridge=true"},
        ] + (recording_actions(company_uuid) if should_record(recording_mode, "inbound") else []) + (ondemand_actions(company_uuid, "peer") if company_on_demand_enabled(db_name) else []) + [
            {"application": "bridge", "data": f"user/{target_ext}_web@{domain},user/{target_ext}@{domain}"},
        ]
        return build_internal_xml("public", f"inbound-{dest}", channel_guard + actions)
'''

NEW_EXTENSION = '''    # person_rules: a call that has come through every company, number, queue
    # and menu check and is about to ring one person is the ONE place that
    # person's own rules apply (decided 3 Sep 2026: direct calls only, never
    # queue calls). Forward-all, do-not-disturb and the person's own closed
    # hours reroute the call into the branch chain below, once, for the
    # extension originally dialled; the ring time and the after-ring
    # destination shape the EXTENSION branch itself. Anything unreadable, and
    # any exception, leaves the call exactly as it is today.
    ring_seconds = None
    after_ring = []
    if route_type == "EXTENSION":
        try:
            own_ext = str(route_value or "").strip()
            plan = person_call_plan(person_record(company_uuid, own_ext), own_ext,
                                    company_ring_seconds(db_name, company_uuid))
            if plan["reroute"]:
                log("info", "person rule applied", rule=plan["rule"], did=dest, extension=own_ext,
                    to_type=plan["reroute"]["type"], to_value=plan["reroute"]["value"])
                route_type, route_value = plan["reroute"]["type"], plan["reroute"]["value"]
                # The QUEUE branch names the queue off this block, as it does
                # for the number's own closed-hours route.
                biz_hours = plan["reroute"]
            else:
                if plan["person_seconds"] is not None and plan["ring_seconds"] != company_ring_seconds(db_name, company_uuid):
                    log("info", "person rule applied", rule="ring time", did=dest, extension=own_ext,
                        seconds=plan["ring_seconds"], person=plan["person_seconds"])
                ring_seconds = plan["ring_seconds"]
                if plan["after_ring"]:
                    log("info", "person rule applied", rule="busy or no answer", did=dest, extension=own_ext,
                        to_type=plan["after_ring"]["type"], to_value=plan["after_ring"]["value"])
                    after_ring = person_after_ring_actions(plan["after_ring"], own_ext, domain, company_uuid)
                elif plan["after_ring_skipped"]:
                    log("info", "person's busy/no-answer destination cannot run after the ring yet, ending as today",
                        did=dest, extension=own_ext, to_type=plan["after_ring_skipped"])
        except Exception as e:
            log("error", "person rules could not be judged, ringing as today: %s" % e,
                did=dest, extension=route_value)
            ring_seconds = None
            after_ring = []

    if route_type == "EXTENSION":
        target_ext = route_value
        recording_mode = company_recording_policy(db_name)
        actions = [
            {"application": "set", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            {"application": "set", "data": f"sip_h_X-Billing-Owner-UUID={company_uuid}"},
            {"application": "set", "data": f"call_timeout={ring_seconds or company_ring_seconds(db_name, company_uuid)}"},
            {"application": "set", "data": "continue_on_fail=true"},
            {"application": "set", "data": "hangup_after_bridge=true"},
        ] + (recording_actions(company_uuid) if should_record(recording_mode, "inbound") else []) + (ondemand_actions(company_uuid, "peer") if company_on_demand_enabled(db_name) else []) + [
            {"application": "bridge", "data": f"user/{target_ext}_web@{domain},user/{target_ext}@{domain}"},
        ] + after_ring
        return build_internal_xml("public", f"inbound-{dest}", channel_guard + actions)
'''


# --- 4. the personal greeting in the VOICEMAIL branch ------------------------

OLD_VOICEMAIL = '''            {"application": "set", "data": f"vm_target_extension={target_ext}"},
            {"application": "answer", "data": ""},
            # Not the `voicemail` application: mod_voicemail is not loaded on
            # this system and cannot be. This is the path the old generator
            # used, and it needs no module and no sound files - the beep is a
            # generated tone.
            {"application": "lua", "data": FS_SCRIPTS + "save-voicemail.lua"},
        ]
        return build_internal_xml("public", f"voicemail-{dest}", channel_guard + actions)
'''

NEW_VOICEMAIL = '''            {"application": "set", "data": f"vm_target_extension={target_ext}"},
            {"application": "answer", "data": ""},
        # person_rules: the person's own greeting, if they saved one and it
        # can be fetched, played before the beep. Otherwise the beep alone,
        # as today.
        ] + person_greeting_actions(company_uuid, target_ext) + [
            # Not the `voicemail` application: mod_voicemail is not loaded on
            # this system and cannot be. This is the path the old generator
            # used, and it needs no module and no sound files - the beep is a
            # generated tone.
            {"application": "lua", "data": FS_SCRIPTS + "save-voicemail.lua"},
        ]
        return build_internal_xml("public", f"voicemail-{dest}", channel_guard + actions)
'''


EDITS = (
    (ANCHOR_IMPORT, IMPORT, "queue_media import line"),
    (ANCHOR_HELPERS, HELPERS, "helper anchor (end of ivr_operational_hours)"),
    (OLD_EXTENSION, NEW_EXTENSION, "EXTENSION branch in build_inbound_dialplan"),
    (OLD_VOICEMAIL, NEW_VOICEMAIL, "VOICEMAIL branch in build_inbound_dialplan"),
)

# Every anchor is checked before anything is replaced, so a file that matches
# three of four is left exactly as it was.
for old, _new, label in EDITS:
    count = text.count(old)
    if count != 1:
        raise SystemExit("no single match for %s (found %d) - nothing written" % (label, count))

# The two dialplan anchors must be inside build_inbound_dialplan, and the
# helpers above it; `re` must already be imported for the value pattern.
INBOUND = "def build_inbound_dialplan("
if text.count(INBOUND) != 1:
    raise SystemExit("cannot find build_inbound_dialplan - nothing written")
inbound_at = text.index(INBOUND)
if text.index(ANCHOR_HELPERS) >= inbound_at:
    raise SystemExit("helper anchor sits below build_inbound_dialplan - nothing written")
for old, _new, label in EDITS[2:]:
    if text.index(old) < inbound_at:
        raise SystemExit("%s sits above build_inbound_dialplan - nothing written" % label)
if "\nimport re\n" not in text:
    raise SystemExit("re is not imported - nothing written")

for old, new, _label in EDITS:
    text = text.replace(old, new)

# The hook must land above the branch it feeds, and the helpers above the hook.
if text.index("def person_call_plan(") > text.index("plan = person_call_plan("):
    raise SystemExit("helpers landed below their first use - nothing written")
if text.index("plan = person_call_plan(") > text.index('        target_ext = route_value\n        recording_mode = company_recording_policy(db_name)'):
    raise SystemExit("hook landed below the EXTENSION branch - nothing written")

backup = "%s.bak-person-rules-%s" % (PATH, time.strftime("%Y%m%d-%H%M%S"))
shutil.copy2(PATH, backup)

with io.open(PATH, "w", encoding="utf-8") as handle:
    handle.write(text)

try:
    py_compile.compile(PATH, doraise=True)
except py_compile.PyCompileError as e:
    shutil.copy2(backup, PATH)
    raise SystemExit("patched file does not compile, original restored: %s" % e)

print("patched %s (backup %s)" % (PATH, os.path.basename(backup)))
