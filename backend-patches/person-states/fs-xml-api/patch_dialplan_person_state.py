"""Stop the inbound dialplan ringing a person who is SUSPENDED, PENDING or
removed; send the caller to the number's closed-hours destination, or that
person's voicemail, instead.

WHY. build_inbound_dialplan() ends, for a number that rings a person, with

    bridge user/<ext>_web@<domain>,user/<ext>@<domain>

and nothing between the route decision and that bridge reads the person's
status. Every helper that does read it (person_record, lookup_user) selects
`status = 'ACTIVE'` and simply returns None for anyone else - which means
"apply no rules", not "do not ring". So a suspended person's extension was
still bridged; with the directory patch beside this one the switch then
finds no such user, the bridge fails, continue_on_fail runs whatever the
person's after-ring action was (usually nothing) and the caller hears
silence and a hang-up. Same for a removed person: the row is soft-deleted
with status still ACTIVE, so even the ACTIVE filters let them through.

WHAT IT DOES.
  1. person_switch_state(company_uuid, extension): one SELECT of status and
     deleted_at by company + extension, cached per person for
     CALLING_RULES_CACHE_SECONDS like the other per-person reads. Returns
     "ACTIVE", "SUSPENDED", "PENDING", "REMOVED" (deleted_at set), or None
     when there is no such person or the read failed. None must always mean
     "what happens today" - a database blip must not divert a call.
  2. A hook right above the final `if route_type == "EXTENSION":` branch,
     i.e. after the company, number, queue, menu and person-rules checks, for
     whichever extension is about to be bridged (the person dialled, or the
     colleague a forward-all rule chose). When the state is not ACTIVE:
       - the number's closed-hours block (call_handling.closed_hours) is used
         if it names a destination that is not this same extension;
       - otherwise the call goes to VOICEMAIL for that extension, through the
         existing branch (greeting if any, beep, save-voicemail.lua).
     One info line: "person unavailable" state=<state> to=<where>.
     The person's ring-time and after-ring rules are dropped: there is no
     ring.
  3. lookup_user() and lookup_user_by_extension() - the two reads that give a
     REGISTERED phone its identity for outbound and internal calls - gain
     `AND u.deleted_at IS NULL`, so a removed person whose phone is still
     registered (registrations live until they expire) cannot place calls.
     They already refused every non-ACTIVE status.

Not touched: QUEUE, IVR, PHONE, HANGUP branches; every hours check; the
person-rules logic itself; recording; the channel guard; anything outbound
beyond the two identity reads in (3). A queue that lists a suspended person
as an agent is the queue script's business (callcenter-queue.lua asks
queue-agent-service, not this file).

Written against dialplan_service.py md5 bd2aeb1f65c86704b4b57312fb1ac99c -
the running file WITH the 3 Sep person-rules patch; the hook sits on that
patch's anchors and refuses to run without it.

Usage: python3 patch_dialplan_person_state.py path/to/dialplan_service.py
Idempotent: marker checked first; every anchor must match the stated number
of times or nothing is written; backup beside the file; compiled before kept.
"""

import io
import os
import py_compile
import shutil
import sys
import time

PATH = sys.argv[1]
MARKER = "# person_states: a person who is not ACTIVE, or is removed, does not ring"

with io.open(PATH, encoding="utf-8") as handle:
    text = handle.read()

if MARKER in text:
    print("already applied: %s" % PATH)
    raise SystemExit(0)


# --- 1. the state read, placed just above person_record() ------------------

ANCHOR_HELPER = '''def person_record(company_uuid, extension):
    """The person's stored rules: {"settings", "call_forwarding", "greetings"}'''

HELPER = MARKER + '''
#
# Suspended (status SUSPENDED), invited but not yet accepted (PENDING) and
# removed (deleted_at set - a soft delete leaves status ACTIVE) people must
# not be rung. Read here, once per person per CALLING_RULES_CACHE_SECONDS.
# None means "no such person, no status on the row, or the read failed" and
# must leave the call exactly as it is today.
_person_state_cache = {}
_person_state_time = {}

PERSON_STATE_ACTIVE = "ACTIVE"


def person_state_of(row):
    """The state a users row is in, as the product names it. Pure."""
    if not row:
        return None
    if row.get("deleted_at"):
        return "REMOVED"
    status = str(row.get("status") or "").strip().upper()
    if not status:
        # No status at all is not a decision. Ring as today rather than
        # silently diverting a person whose row is merely odd.
        return None
    if status == PERSON_STATE_ACTIVE:
        return PERSON_STATE_ACTIVE
    if status == "PENDING":
        return "PENDING"
    return "SUSPENDED"


def person_switch_state(company_uuid, extension):
    ext = str(extension or "").strip()
    if not company_uuid or not ext:
        return None
    key = (company_uuid, ext)
    now = time.time()
    if key in _person_state_cache and (now - _person_state_time.get(key, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _person_state_cache[key]
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT status, deleted_at FROM users
                WHERE company_uuid = %s AND extension = %s
                LIMIT 1
            """, (company_uuid, ext))
            row = cur.fetchone()
    except Exception as e:
        log("error", "person state lookup failed, ringing as today: %s" % e,
            company=company_uuid, extension=ext)
        return None
    state = person_state_of(row)
    _person_state_cache[key] = state
    _person_state_time[key] = now
    return state


''' + ANCHOR_HELPER


# --- 2. the hook, right above the EXTENSION bridge --------------------------

ANCHOR_HOOK = '''    if route_type == "EXTENSION":
        target_ext = route_value
        recording_mode = company_recording_policy(db_name)
'''

HOOK = '''    # person_states: whichever extension is about to be bridged - the one
    # dialled, or the colleague a forward-all rule picked - must be ACTIVE. A
    # suspended, invited-only or removed person has no phone on the switch
    # (the directory refuses them), so ringing them is a guaranteed failure
    # that ends in silence. The number's own closed-hours destination is the
    # admin's stated answer for "nobody is here"; failing that, the person's
    # voicemail. No ring means no ring-time and no after-ring rule.
    if route_type == "EXTENSION":
        try:
            own_ext = str(route_value or "").strip()
            person_state = person_switch_state(company_uuid, own_ext)
            if person_state and person_state != PERSON_STATE_ACTIVE:
                closed_block = _as_object(call_handling.get("closed_hours"))
                closed_type = str(closed_block.get("type") or "").strip().upper()
                closed_value = closed_block.get("value") or ""
                if closed_type and closed_value and not (closed_type == "EXTENSION" and str(closed_value).strip() == own_ext):
                    log("info", "person unavailable, using the number's closed-hours destination",
                        did=dest, extension=own_ext, state=person_state, to_type=closed_type, to_value=closed_value)
                    route_type, route_value = closed_type, closed_value
                    biz_hours = closed_block
                else:
                    log("info", "person unavailable, using voicemail",
                        did=dest, extension=own_ext, state=person_state)
                    route_type = "VOICEMAIL"
                ring_seconds = None
                after_ring = []
        except Exception as e:
            log("error", "person state could not be judged, ringing as today: %s" % e,
                did=dest, extension=route_value)

''' + ANCHOR_HOOK


# --- 3. a removed person's registered phone gets no identity ----------------

OLD_IDENTITY = "                WHERE c.db_name = %s AND u.extension = %s AND u.status = 'ACTIVE'\n"
NEW_IDENTITY = "                WHERE c.db_name = %s AND u.extension = %s AND u.status = 'ACTIVE' AND u.deleted_at IS NULL\n"

EDITS = (
    (ANCHOR_HELPER, HELPER, "person_record anchor (person-rules patch present?)", 1),
    (ANCHOR_HOOK, HOOK, "EXTENSION bridge branch", 1),
    (OLD_IDENTITY, NEW_IDENTITY, "lookup_user / lookup_user_by_extension WHERE", 2),
)

for old, _new, label, expected in EDITS:
    count = text.count(old)
    if count != expected:
        raise SystemExit("%s: found %d, expected %d - nothing written" % (label, count, expected))

for old, new, _label, _expected in EDITS:
    text = text.replace(old, new)

backup = "%s.bak-person-states-%s" % (PATH, time.strftime("%Y%m%d-%H%M%S"))
shutil.copy2(PATH, backup)

with io.open(PATH, "w", encoding="utf-8") as handle:
    handle.write(text)

try:
    py_compile.compile(PATH, doraise=True)
except py_compile.PyCompileError as e:
    shutil.copy2(backup, PATH)
    raise SystemExit("patched file does not compile, original restored: %s" % e)

print("patched %s (backup %s)" % (PATH, os.path.basename(backup)))
