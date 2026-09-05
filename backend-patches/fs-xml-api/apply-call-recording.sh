#!/usr/bin/env bash
# Make calls actually record.
#
# Everything this needs already existed and none of it was connected:
#   * start_record.lua records both legs to /opt/call-recordings/tmp/<uuid>.wav
#   * the media API hands out presigned upload URLs, proven working
#   * a new /api/internal/call-recording links a file to its call
#   * the company's recording policy is stored and readable
#
# What was missing was the dialplan ever asking for any of it, plus two
# undefined names in config.lua that made the old upload code dead.
#
# WHAT CHANGES
#   config.lua          two new values: the internal API address and its key
#   upload_recording.lua  new: upload after hangup, then link to the call
#   dialplan_service.py   reads the company recording policy; on an EXTENSION
#                         call that should be recorded, starts the recorder and
#                         sets a hangup hook to upload it
#
# SCOPE, MEASURED FIRST
# Two companies have a recording setting stored and exactly one has it switched
# on, so one company's calls change behaviour. Everyone else is untouched
# because the policy reader returns "do not record" for anything it cannot read.
#
# The direction is honoured: a policy of "incoming" records inbound calls only.
# Anything unreadable means no recording, which is the safe direction here -
# recording a call that should not be recorded is a legal problem, while missing
# one is an inconvenience.

set -euo pipefail

HOST="${1:-root@142.93.121.121}"
FILE=/opt/fs-xml-api-1.2.5/dialplan_service.py
SERVICE=fs-xml-api
FS_SCRIPTS=/etc/freeswitch/scripts

say() { printf '\n%s\n' "$*"; }

say "1/7  Backing up the dialplan and config"
ssh "$HOST" "cp $FILE $FILE.bak-\$(date +%Y%m%d-%H%M%S) && ls -1t $FILE.bak-* | head -1
             cp $FS_SCRIPTS/config.lua $FS_SCRIPTS/config.lua.bak-\$(date +%Y%m%d-%H%M%S)"

say "2/7  Teaching config.lua where the internal API is"
# The secret is read from the API's own .env on the box and never printed.
ssh "$HOST" "python3 - <<'PY'
import io, re
cfg = '$FS_SCRIPTS/config.lua'
s = io.open(cfg, encoding='utf-8').read()

if 'fs_internal_key' in s:
    print('    already configured')
    raise SystemExit(0)

secret = ''
for line in io.open('/var/www/prod/default-api/.env', encoding='utf-8'):
    line = line.strip()
    if line.startswith('PRIVATE_CALL_SECRET='):
        secret = line.split('=', 1)[1].strip().strip('\"').strip(\"'\")
        break
if not secret:
    raise SystemExit('ABORT: PRIVATE_CALL_SECRET is not set in the API env')

s = s.rstrip('\n') + '\n\n'
s += '-- Where the internal API lives, and the shared secret the switch uses to\n'
s += '-- prove it is the switch. The same secret PrivateCallAuth already checks\n'
s += '-- for the other internal calls.\n'
s += 'fs_internal_api_addr = \"https://api.mycountrymobile.com/api/internal\";\n'
s += 'fs_internal_key = \"' + secret + '\";\n'
io.open(cfg, 'w', encoding='utf-8').write(s)
print('    added fs_internal_api_addr and fs_internal_key (%d chars, not shown)' % len(secret))
PY"

say "3/7  Installing the upload script"
scp -q upload_recording.lua "$HOST:$FS_SCRIPTS/upload_recording.lua"
ssh "$HOST" "chmod 0755 $FS_SCRIPTS/upload_recording.lua && ls -l $FS_SCRIPTS/upload_recording.lua | awk '{print \"    \" \$5 \" bytes\"}'"

say "4/7  Teaching the dialplan to read the recording policy"
ssh "$HOST" "python3 - <<'PY'
import io
path = '$FILE'
s = io.open(path, encoding='utf-8').read()

if 'def company_recording_policy(' in s:
    print('    already applied')
    raise SystemExit(0)

anchor = 'def get_calling_rules(db_name, company_uuid, user_uuid):'
if s.count(anchor) != 1:
    raise SystemExit('ABORT: expected one %r, found %d' % (anchor, s.count(anchor)))

block = '''_recording_cache = {}
_recording_cache_time = {}


def company_recording_policy(db_name):
    \"\"\"Whether this company records calls, and which direction.

    Returns one of \"off\", \"all\", \"incoming\", \"outgoing\".

    Anything missing, unreadable, or a shape this was not written for returns
    \"off\". That is the safe direction here and it is the opposite of the
    opening-hours rule: recording a call that should not have been recorded is a
    legal problem in most of the countries this platform sells into, while
    failing to record one is an inconvenience. So uncertainty means do not.
    \"\"\"
    if not db_name:
        return \"off\"

    now = time.time()
    if db_name in _recording_cache and (now - _recording_cache_time.get(db_name, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _recording_cache[db_name]

    mode = \"off\"
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                \"SELECT settings FROM \`%s\`.user_template WHERE name = %%s LIMIT 1\" % db_name,
                (COMPANY_DEFAULT_TEMPLATE,),
            )
            row = cur.fetchone() or {}
            settings = _as_object(row.get(\"settings\"))
            automatic = _as_object(_as_object(settings.get(\"recording\")).get(\"automatic\"))
            if automatic.get(\"enabled\") is True:
                value = str(automatic.get(\"value\") or \"\").strip().lower()
                if value in (\"all\", \"incoming\", \"outgoing\"):
                    mode = value
    except Exception as e:
        log(\"error\", \"recording policy lookup failed, not recording: %s\" % e)
        return \"off\"

    _recording_cache[db_name] = mode
    _recording_cache_time[db_name] = now
    return mode


def should_record(mode, direction):
    \"\"\"direction is \"inbound\" or \"outbound\".\"\"\"
    if mode == \"all\":
        return True
    if mode == \"incoming\":
        return direction == \"inbound\"
    if mode == \"outgoing\":
        return direction == \"outbound\"
    return False


def recording_actions(company_uuid):
    \"\"\"Start the recorder, and arrange for the file to be uploaded afterwards.

    The hangup hook runs with no session, so the call and company ids are passed
    as arguments rather than read off the channel.
    \"\"\"
    return [
        {\"application\": \"set\", \"data\": \"recording_follow_transfer=true\"},
        {\"application\": \"set\",
         \"data\": \"api_hangup_hook=lua upload_recording.lua \${uuid} %s\" % company_uuid},
        {\"application\": \"lua\", \"data\": \"start_record.lua\"},
    ]


'''

s = s.replace(anchor, block + anchor, 1)

if s.count('def company_recording_policy(') != 1:
    raise SystemExit('ABORT: policy reader not inserted once')
io.open(path, 'w', encoding='utf-8').write(s)
print('    policy reader added')
PY"

say "5/7  Starting the recorder on inbound extension calls"
ssh "$HOST" "python3 - <<'PY'
import io
path = '$FILE'
s = io.open(path, encoding='utf-8').read()

# Check for the GATE, not the helper. The first version looked for
# recording_actions(company_uuid), which step 4 has just inserted as a function
# definition - so this step decided its own work was already done and skipped
# it, leaving the policy reader in place and nothing calling it.
if 'should_record(recording_mode' in s:
    print('    already applied')
    raise SystemExit(0)

anchor = '''    if route_type == \"EXTENSION\":
        target_ext = route_value
        actions = ['''
if s.count(anchor) != 1:
    raise SystemExit('ABORT: expected one EXTENSION branch, found %d' % s.count(anchor))

replacement = '''    if route_type == \"EXTENSION\":
        target_ext = route_value
        recording_mode = company_recording_policy(db_name)
        actions = ['''
s = s.replace(anchor, replacement, 1)

# Insert the recorder actions immediately before the bridge on that branch.
bridge = '''            {\"application\": \"bridge\", \"data\": f\"user/{target_ext}_web@{domain},user/{target_ext}@{domain}\"},'''
if s.count(bridge) != 1:
    raise SystemExit('ABORT: expected one extension bridge, found %d' % s.count(bridge))

s = s.replace(bridge, '''        ] + (recording_actions(company_uuid) if should_record(recording_mode, \"inbound\") else []) + [
''' + bridge, 1)

if s.count('should_record(recording_mode') != 1:
    raise SystemExit('ABORT: recording gate not inserted once')
io.open(path, 'w', encoding='utf-8').write(s)
print('    inbound extension calls now record when the policy says so')
PY"

say "6/7  Compile check BEFORE restart"
ssh "$HOST" "python3 -m py_compile $FILE && echo '    compiles'"

say "7/7  Restart and verify"
ssh "$HOST" "systemctl restart $SERVICE && sleep 2 && systemctl is-active $SERVICE
  ls -l --time-style=+%H:%M:%S $FILE | awk '{print \"    file:    \" \$6}'
  ps -o lstart= -p \$(pgrep -f dialplan_service.py | head -1) | sed 's/^/    process: /'
  printf '    policy reader   : %s\n' \$(grep -c 'def company_recording_policy' $FILE)
  printf '    recording gate  : %s\n' \$(grep -c 'should_record(recording_mode' $FILE)
  printf '    control (QUEUE) : %s\n' \$(grep -c 'route_type == \"QUEUE\"' $FILE)
  printf '    upload script   : %s\n' \$(ls $FS_SCRIPTS/upload_recording.lua >/dev/null 2>&1 && echo present || echo MISSING)
"
say "Done."
