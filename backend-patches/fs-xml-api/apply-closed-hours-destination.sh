#!/usr/bin/env bash
# Honour a configured closed-hours destination, not just voicemail.
#
# The first pass diverted an out-of-hours EXTENSION call to that extension's
# voicemail, because no number in the database has a closed-hours destination
# set. True, but incomplete: `call_handling.closed_hours` is a real key the API
# already reads in two places, so a number CAN carry its own after-hours target
# - a menu, a queue, another extension - and when it does, that is what the
# owner asked for and voicemail is not.
#
# Order after this lands:
#   1. Outside hours with a closed_hours destination -> use it, whatever it is
#   2. Outside hours without one, ringing a person   -> that person's voicemail
#   3. Otherwise                                     -> exactly as before
#
# biz_hours is repointed at the closed_hours block too, because the QUEUE branch
# reads the queue's display name from it. Left pointing at the open-hours block,
# an after-hours caller would land in a queue labelled with the daytime name.
#
# Unchanged: only a definite "closed" does anything. "unknown" still behaves
# exactly as it did before any of this landed.

set -euo pipefail

HOST="${1:-root@142.93.121.121}"
FILE=/opt/fs-xml-api-1.2.5/dialplan_service.py
SERVICE=fs-xml-api

say() { printf '\n%s\n' "$*"; }

say "1/5  Backing up"
ssh "$HOST" "cp $FILE $FILE.bak-\$(date +%Y%m%d-%H%M%S) && ls -1t $FILE.bak-* | head -1"

say "2/5  Replacing the closed-hours branch"
ssh "$HOST" "python3 - <<'PY'
import io
path = '$FILE'
s = io.open(path, encoding='utf-8').read()

if 'closed_hours' in s:
    print('    already applied - nothing to do')
    raise SystemExit(0)

old = '''    if route_type == \"EXTENSION\":
        hours_state = business_hours_state(company_operational_hours(db_name))
        if hours_state == OPERATIONAL_HOURS_CLOSED:
            log(\"info\", \"outside opening hours, diverting to voicemail\",
                did=dest, extension=route_value)
            route_type = \"VOICEMAIL\"'''

if s.count(old) != 1:
    raise SystemExit('ABORT: expected one first-pass branch, found %d' % s.count(old))

new = '''    if business_hours_state(company_operational_hours(db_name)) == OPERATIONAL_HOURS_CLOSED:
        # What the owner configured for out of hours, if anything.
        closed_block = _as_object(call_handling.get(\"closed_hours\"))
        closed_type = str(closed_block.get(\"type\") or \"\").strip().upper()
        closed_value = closed_block.get(\"value\") or \"\"

        if closed_type and closed_value:
            log(\"info\", \"outside opening hours, using the closed-hours destination\",
                did=dest, closed_type=closed_type)
            route_type = closed_type
            route_value = closed_value
            # The QUEUE branch reads the queue's display name off this block, so
            # it has to follow the route. Left pointing at the open-hours block,
            # an after-hours caller would land in a queue named for the daytime
            # one.
            biz_hours = closed_block

        elif route_type == \"EXTENSION\":
            # Nothing configured, and the number rings a person. Their voicemail
            # beats ringing an empty desk.
            log(\"info\", \"outside opening hours, no destination set, using voicemail\",
                did=dest, extension=route_value)
            route_type = \"VOICEMAIL\"

        else:
            # A menu or a queue with no closed-hours destination. Nothing to
            # infer, so it rings through as it does today - said out loud rather
            # than failing quietly.
            log(\"info\", \"outside opening hours but no closed-hours destination for this route type\",
                did=dest, route_type=route_type)'''

s = s.replace(old, new, 1)

# Count the LOG lines, not the phrase - it also appears in a comment, which is
# what made the first version of this check fire on a correct patch.
if s.count('outside opening hours, using the closed-hours destination') != 1:
    raise SystemExit('ABORT: destination log line not inserted once')
if s.count('outside opening hours but no closed-hours destination') != 1:
    raise SystemExit('ABORT: fall-through log line not inserted once')
if s.count('using voicemail') != 1:
    raise SystemExit('ABORT: voicemail fallback not inserted once')

io.open(path, 'w', encoding='utf-8').write(s)
print('    replaced')
PY"

say "3/5  Compile check BEFORE restart"
ssh "$HOST" "python3 -m py_compile $FILE && echo '    compiles'"

say "4/5  Restart"
ssh "$HOST" "systemctl restart $SERVICE && sleep 2 && systemctl is-active $SERVICE"

say "5/5  Process newer than file, and markers present with a control"
ssh "$HOST" "
  ls -l --time-style=+%H:%M:%S $FILE | awk '{print \"    file:    \" \$6}'
  ps -o lstart= -p \$(pgrep -f dialplan_service.py | head -1) | sed 's/^/    process: /'
  printf '    closed_hours reads   : %s\n' \$(grep -c 'closed_hours' $FILE)
  printf '    voicemail fallback   : %s\n' \$(grep -c 'using voicemail' $FILE)
  printf '    control (QUEUE)      : %s\n' \$(grep -c 'route_type == \"QUEUE\"' $FILE)
"
say "Done."
