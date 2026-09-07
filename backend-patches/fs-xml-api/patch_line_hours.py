"""Honour the opening hours saved on a number and on an IVR menu.

WHY. Two screens store hours that nothing reads:

  * Numbers > call handling saves the number's own hours as
    `forward_call_actions.condition.operational_hours` - the same shape as the
    company block (`type`, `value`, `holidays`, `regional.timezone`) plus a
    `closed_hour_action` {type, value, enabled, ...} saying where to send a
    caller while the number is shut.
  * Phone systems > IVR menus saves the menu's own hours as
    `ivrs.settings.operational_hours`, same shape, same `closed_hour_action`.

`build_inbound_dialplan` asks only the company's hours. So a branch line set to
close at five keeps ringing until head office shuts, and a menu that says
"after six, go to voicemail" plays its daytime options all night.

WHAT IT DOES, in `build_inbound_dialplan`:

  1. The call is closed if EITHER the company's hours OR the number's own hours
     say closed. Which one shut it is logged (`closed_by`). When closed, the
     destination is chosen most-specific first:
        the number's `closed_hour_action` (enabled, with a type and a value)
        -> the existing `call_handling.closed_hours` block
        -> the existing EXTENSION -> VOICEMAIL fallback
        -> ring through, with the existing "no closed-hours destination" line.
  2. A number routed to an IVR asks the menu's own hours, in the same place the
     queue check already asks the queue's. A menu that is shut and has an
     enabled destination is rerouted to it; the reroute then falls into the
     ordinary route-type chain (EXTENSION, VOICEMAIL, QUEUE, PHONE, HANGUP...),
     which sits entirely below this point, so no branch has to move. A menu
     that is shut with no destination runs as it does today, said out loud.
     The menu's settings row is cached per (db, uuid) for
     CALLING_RULES_CACHE_SECONDS like every other lookup on the call path.

The rule everywhere is the one the file already has: only a definite "closed"
changes a call. No hours, an unusable timezone, an unreadable block, a failed
read - all "unknown", and the call connects exactly as it does today. Guessing
"closed" sends a real caller to voicemail on a working day.

Not touched: how the company's hours are read, the queue check, recording,
the channel guard, anything outbound.

Idempotent: a marker comment records that the helpers are present, and a
second run stops before touching anything. Every anchor must match exactly
once or the patch refuses to write.
"""

import io
import os
import py_compile
import shutil
import sys
import time

PATH = sys.argv[1]
MARKER = "# line_hours: a number's and a menu's own hours are honoured"

with io.open(PATH, encoding="utf-8") as handle:
    text = handle.read()

if MARKER in text:
    print("already applied: %s" % PATH)
    raise SystemExit(0)


# --- 1. the helpers, placed right after company_operational_hours ------------

ANCHOR_HELPERS = '''    _hours_cache[db_name] = hours
    _hours_cache_time[db_name] = now
    return hours


_recording_cache = {}
_recording_cache_time = {}
'''

HELPERS = '''    _hours_cache[db_name] = hours
    _hours_cache_time[db_name] = now
    return hours


''' + MARKER + '''

def number_operational_hours(forward_actions):
    """The opening hours saved on the number itself, or {} if it keeps none.

    Numbers > call handling stores them under `condition.operational_hours`,
    in the same shape as the company block, so `business_hours_state` reads
    them unchanged. Anything missing or malformed is {}, which that function
    answers "unknown" - and unknown never diverts a call.
    """
    try:
        hours = _as_object(_as_object(_as_object(forward_actions).get("condition")).get("operational_hours"))
    except Exception:
        return {}
    return hours if isinstance(hours, dict) else {}


def closed_hour_action_route(operational_hours):
    """Where a line sends callers while it is shut, or None.

    Read off the `closed_hour_action` block that the number, menu and queue
    screens all save in the same shape. Only an action that is switched on
    AND has both a type and a value counts: a type with no value is not a
    destination, and sending a call at one drops it. The result is shaped
    like a call_handling block (`type`, `value`, `label`, `name`) so the
    route-type branches below can read it exactly as they read the number's
    own routing.
    """
    action = _as_object(_as_object(operational_hours).get("closed_hour_action"))
    if not isinstance(action, dict) or not action.get("enabled"):
        return None
    kind = str(action.get("type") or "").strip().upper()
    value = str(action.get("value") or "").strip()
    if not kind or not value:
        return None
    label = str(action.get("value_label") or "")
    return {"type": kind, "value": value, "label": label, "name": label}


_ivr_hours_cache = {}
_ivr_hours_cache_time = {}


def ivr_operational_hours(db_name, ivr_uuid):
    """A menu's own opening hours, from `ivrs.settings.operational_hours`.

    Cached briefly per (database, menu), because this runs on the path of
    every call into a menu. Missing, unreadable or unreachable all return {},
    which the caller reads as "unknown" and therefore as today's behaviour:
    the menu runs.
    """
    uuid = str(ivr_uuid or "").strip()
    if not db_name or not uuid:
        return {}
    key = (db_name, uuid)
    now = time.time()
    if key in _ivr_hours_cache and (now - _ivr_hours_cache_time.get(key, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _ivr_hours_cache[key]

    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("SELECT settings FROM `%s`.ivrs WHERE uuid = %%s LIMIT 1" % db_name, (uuid,))
            row = cur.fetchone() or {}
        hours = _as_object(_as_object(row.get("settings")).get("operational_hours"))
        if not isinstance(hours, dict):
            hours = {}
    except Exception as e:
        log("error", "menu hours lookup failed, treating the menu as open: %s" % e, db=db_name, ivr=uuid)
        return {}

    _ivr_hours_cache[key] = hours
    _ivr_hours_cache_time[key] = now
    return hours


_recording_cache = {}
_recording_cache_time = {}
'''


# --- 2. the open/closed decision in build_inbound_dialplan -------------------

OLD_CLOSED = '''    if business_hours_state(company_operational_hours(db_name)) == OPERATIONAL_HOURS_CLOSED:
        # What the owner configured for out of hours, if anything.
        closed_block = _as_object(call_handling.get("closed_hours"))
        closed_type = str(closed_block.get("type") or "").strip().upper()
        closed_value = closed_block.get("value") or ""

        if closed_type and closed_value:
            log("info", "outside opening hours, using the closed-hours destination",
                did=dest, closed_type=closed_type)
            route_type = closed_type
            route_value = closed_value
'''

NEW_CLOSED = '''    #
    # The number keeps hours of its own as well (Numbers > call handling), and
    # until now nothing read them. Either the company or the number saying
    # "closed" is enough: a branch line can shut while head office is open, and
    # a company holiday shuts every line. The number's block carries its own
    # timezone, so a line in one city owned by a company in another closes on
    # its own clock.
    company_closed = business_hours_state(company_operational_hours(db_name)) == OPERATIONAL_HOURS_CLOSED
    number_hours = number_operational_hours(forward_actions)
    try:
        number_closed = business_hours_state(number_hours) == OPERATIONAL_HOURS_CLOSED
    except Exception as e:
        log("error", "number hours could not be judged, treating as open: %s" % e, did=dest)
        number_closed = False

    if company_closed or number_closed:
        log("info", "outside opening hours", did=dest,
            closed_by=" and ".join(name for name, shut in (("company", company_closed),
                                                             ("number", number_closed)) if shut))

        # Where to send the caller, most specific first: the destination set on
        # the number's own hours screen, then the closed-hours block of the
        # number's call handling, then (below) voicemail for a number that
        # rings a person.
        number_route = closed_hour_action_route(number_hours)
        if number_route:
            closed_block = number_route
            closed_source = "number hours"
        else:
            closed_block = _as_object(call_handling.get("closed_hours"))
            closed_source = "call handling"
        closed_type = str(closed_block.get("type") or "").strip().upper()
        closed_value = closed_block.get("value") or ""

        if closed_type and closed_value:
            log("info", "outside opening hours, using the closed-hours destination",
                did=dest, closed_type=closed_type, source=closed_source)
            route_type = closed_type
            route_value = closed_value
'''


# --- 3. the menu's own hours, right after the queue's --------------------------

OLD_QUEUE_CHECK = '''        if queue_closed_type and queue_closed_value:
            log("info", "the queue itself is closed, using its own destination",
                did=dest, queue=route_value, closed_type=queue_closed_type)
            route_type, route_value = queue_closed_type, queue_closed_value

    if route_type == "EXTENSION":
        target_ext = route_value
'''

NEW_QUEUE_CHECK = '''        if queue_closed_type and queue_closed_value:
            log("info", "the queue itself is closed, using its own destination",
                did=dest, queue=route_value, closed_type=queue_closed_type)
            route_type, route_value = queue_closed_type, queue_closed_value

    # A menu may keep its own hours in just the same way - "after six, go to
    # voicemail" while the company itself is still open - and, like the queue's,
    # they were read by nothing. Same rule: only a menu that is shut AND has an
    # enabled destination is diverted. A shut menu with nothing configured runs
    # exactly as it does today. Every route-type branch sits below this point,
    # so wherever the menu points - a person, voicemail, a queue, an outside
    # number - the reroute reaches it.
    if route_type == "IVR":
        try:
            menu_hours = ivr_operational_hours(db_name, route_value)
            if business_hours_state(menu_hours) == OPERATIONAL_HOURS_CLOSED:
                menu_route = closed_hour_action_route(menu_hours)
                if menu_route:
                    log("info", "the menu itself is closed, using its own destination",
                        did=dest, ivr=route_value, closed_type=menu_route["type"])
                    route_type, route_value = menu_route["type"], menu_route["value"]
                    biz_hours = menu_route
                else:
                    log("info", "the menu itself is closed but has no closed-hours destination, running the menu",
                        did=dest, ivr=route_value)
        except Exception as e:
            log("error", "menu hours could not be judged, running the menu: %s" % e,
                did=dest, ivr=route_value)

    if route_type == "EXTENSION":
        target_ext = route_value
'''


EDITS = (
    (ANCHOR_HELPERS, HELPERS, "helper anchor (end of company_operational_hours)"),
    (OLD_CLOSED, NEW_CLOSED, "open/closed decision in build_inbound_dialplan"),
    (OLD_QUEUE_CHECK, NEW_QUEUE_CHECK, "queue check in build_inbound_dialplan"),
)

# Every anchor is checked before anything is replaced, so a file that matches
# two of three is left exactly as it was.
for old, _new, label in EDITS:
    count = text.count(old)
    if count != 1:
        raise SystemExit("no single match for %s (found %d) - nothing written" % (label, count))

for old, new, _label in EDITS:
    text = text.replace(old, new)

# The helpers must land above their first use, and the menu check must land
# above the branch chain it reroutes into - or the reroute reaches nothing.
if text.index("def number_operational_hours(") > text.index("def build_inbound_dialplan("):
    raise SystemExit("helpers landed below build_inbound_dialplan - nothing written")
if text.index("the menu itself is closed, using its own destination") > text.index(
        '    if route_type == "EXTENSION":\n        target_ext = route_value'):
    raise SystemExit("menu check landed below the route-type chain - nothing written")

backup = "%s.bak-line-hours-%s" % (PATH, time.strftime("%Y%m%d-%H%M%S"))
shutil.copy2(PATH, backup)

with io.open(PATH, "w", encoding="utf-8") as handle:
    handle.write(text)

try:
    py_compile.compile(PATH, doraise=True)
except py_compile.PyCompileError as e:
    shutil.copy2(backup, PATH)
    raise SystemExit("patched file does not compile, original restored: %s" % e)

print("patched %s (backup %s)" % (PATH, os.path.basename(backup)))
