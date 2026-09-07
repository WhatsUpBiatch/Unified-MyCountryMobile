#!/usr/bin/env bash
# Record outbound calls too, when the company's direction says so.
#
# The first pass only recorded calls coming IN to a person, while the stored
# direction has always offered all / incoming / outgoing. So a company set to
# "All" was told every call was recorded and only half of them were - the worse
# half, because outbound is usually the one somebody wanted for training or a
# dispute.
#
# The direction values are all, incoming and outgoing. NOT "both": every live
# record uses "all" and so does the gate this reuses. Worth stating because
# "both" is the obvious guess and would silently stop matching real data.
#
# Nothing changes for a company whose policy is unreadable or off - the reader
# already answers "off" in that case, which is the safe direction for recording.

set -euo pipefail

HOST="${1:-root@142.93.121.121}"
FILE=/opt/fs-xml-api-1.2.5/dialplan_service.py
SERVICE=fs-xml-api

say() { printf '\n%s\n' "$*"; }

say "1/5  Backing up"
ssh "$HOST" "cp $FILE $FILE.bak-\$(date +%Y%m%d-%H%M%S) && ls -1t $FILE.bak-* | head -1"

say "2/5  Adding the outbound recording gate"
ssh "$HOST" "python3 - <<'PY'
import io
path = '$FILE'
s = io.open(path, encoding='utf-8').read()

if 'should_record(outbound_recording_mode' in s:
    print('    already applied')
    raise SystemExit(0)

bridge = '''        {\"application\": \"bridge\", \"data\": f\"{{sip_h_X-Outbound=Y,absolute_codec_string='PCMU,PCMA',sip_route_uri=sip:127.0.0.1:5060,sip_from_uri=sip:{caller_id}@{SERVER_IP}}}sofia/internal/{formatted_dest}@{provider_ip}\"},'''
if s.count(bridge) != 1:
    raise SystemExit('ABORT: expected one outbound bridge, found %d' % s.count(bridge))

inserted = '''    ] + (recording_actions(company_uuid)
         if should_record(outbound_recording_mode, \"outbound\") else []) + [
''' + bridge

s = s.replace(bridge, inserted, 1)

# The mode has to be read before the action list is built.
anchor = '''    company_uuid = user[\"company_uuid\"]'''
if s.count(anchor) != 1:
    raise SystemExit('ABORT: expected one company_uuid assignment, found %d' % s.count(anchor))
s = s.replace(anchor, anchor + '''
    # Read once per call rather than inside the list, which is built more than
    # once on some paths. The reader caches anyway, but a call that changes its
    # mind halfway through would be worse than a slightly stale one.
    outbound_recording_mode = company_recording_policy(domain_to_dbname(domain))''', 1)

if s.count('outbound_recording_mode') != 2:
    raise SystemExit('ABORT: expected the mode declared once and used once, found %d' % s.count('outbound_recording_mode'))

io.open(path, 'w', encoding='utf-8').write(s)
print('    outbound calls now record when the direction allows it')
PY"

say "3/5  Compile check BEFORE restart"
ssh "$HOST" "python3 -m py_compile $FILE && echo '    compiles'"

say "4/5  Restart"
ssh "$HOST" "systemctl restart $SERVICE && sleep 2 && systemctl is-active $SERVICE"

say "5/5  Verify, with a control"
ssh "$HOST" "
  ls -l --time-style=+%H:%M:%S $FILE | awk '{print \"    file:    \" \$6}'
  ps -o lstart= -p \$(pgrep -f dialplan_service.py | head -1) | sed 's/^/    process: /'
  printf '    outbound gate    : %s\n' \$(grep -c 'should_record(outbound_recording_mode' $FILE)
  printf '    inbound gate     : %s\n' \$(grep -c 'should_record(recording_mode' $FILE)
  printf '    control (QUEUE)  : %s\n' \$(grep -c 'route_type == \"QUEUE\"' $FILE)
"
say "Done."
