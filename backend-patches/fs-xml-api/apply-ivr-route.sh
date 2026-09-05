#!/usr/bin/env bash
# Let an inbound number actually reach an IVR menu.
#
#   bash backend-patches/fs-xml-api/apply-ivr-route.sh
#
# build_inbound_dialplan handles exactly two route types, EXTENSION and
# VOICEMAIL. Everything else falls through to "unhandled route type" and the
# caller gets a dead line. So an admin can build a complete IVR menu, save it,
# point a number at it, and every caller hears nothing.
#
# Everything else for IVR is already in place and was checked before writing
# this:
#   * FreeSWITCH has the ivr application  -> "ivr,Run an ivr menu,<menu_name>"
#   * ivr.conf returns HTTP 200 from the config service (callcenter.conf 400s,
#     which is a separate problem and the reason queues stay broken)
#   * the config template names each menu by UUID:  name="{{ .Uuid }}"
#   * the admin UI stores an IVR route as the IVR's UUID:  value: ivr?.uuid
# So the menu name the dialplan must pass is exactly route_value. That match is
# the whole reason this is a four-line change and not a lookup.
#
# This is the inbound call path, so the edit is strictly additive: a new branch
# placed before the existing fall-through. EXTENSION and VOICEMAIL are not
# touched. A number pointed at an IVR is already dead, so the worst case is that
# it stays dead.
#
# QUEUE and DEPARTMENT are deliberately NOT added here. A queue branch would do
# nothing while mod_callcenter fails to load, and how a department should ring
# has not been established -- guessing at either would be writing call routing
# on a hunch.
set -euo pipefail

HOST=mcm-new
FILE=/opt/fs-xml-api-1.2.5/dialplan_service.py
STAMP=$(date +%Y%m%d-%H%M%S)

say() { printf '\n=== %s\n' "$1"; }

say "1/5  Backing up (stamp $STAMP)"
ssh "$HOST" "cp $FILE $FILE.bak-$STAMP && echo '    $FILE.bak-$STAMP'"

say "2/5  Adding the IVR branch"
ssh "$HOST" "python3 - <<'PY'
import io, sys
p = '$FILE'
s = io.open(p, encoding='utf-8').read()

if 'route_type == \"IVR\"' in s:
    print('    already present, nothing to do')
    sys.exit(0)

anchor = '    log(\"warn\", \"unhandled route type\", route_type=route_type, did=dest)'
if anchor not in s:
    sys.exit('    ANCHOR MISSING -- aborting, file not changed')

branch = '''    if route_type == \"IVR\":
        # route_value is the IVR's UUID, and the generated ivr.conf names each
        # menu by that same UUID, so it is passed straight through.
        actions = [
            {\"application\": \"set\", \"data\": f\"sip_h_X-Domain={domain}\"},
            {\"application\": \"set\", \"data\": f\"company_uuid={company_uuid}\"},
            {\"application\": \"set\", \"data\": f\"sip_h_X-Billing-Owner-UUID={company_uuid}\"},
            {\"application\": \"answer\", \"data\": \"\"},
            {\"application\": \"ivr\", \"data\": route_value},
        ]
        return build_internal_xml(\"public\", f\"ivr-{dest}\", actions)

'''
s = s.replace(anchor, branch + anchor, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('    branch added')
PY"

say "3/5  Syntax check"
if ! ssh "$HOST" "python3 -m py_compile $FILE && echo '    compiles'"; then
  say "SYNTAX ERROR -- rolling back"
  ssh "$HOST" "mv $FILE.bak-$STAMP $FILE"
  echo "rolled back. Nothing changed."
  exit 1
fi

say "4/5  Restarting the dialplan service"
ssh "$HOST" "systemctl restart fs-xml-api 2>/dev/null || pm2 restart fs-xml-api 2>/dev/null || echo '    NOTE: could not restart automatically -- restart it by hand'"

say "5/5  Checking it still answers"
ssh "$HOST" "sleep 3; curl -sS -o /dev/null -w '    dialplan service -> %{http_code}\n' --max-time 5 http://localhost:9000/ || echo '    no response -- check the service'"

cat <<EOF

Done. Backup: $FILE.bak-$STAMP

To undo:
  ssh $HOST "mv $FILE.bak-$STAMP $FILE && systemctl restart fs-xml-api"

TEST THIS BEFORE TRUSTING IT:
  1. Point a spare number at an IVR menu in the admin screens.
  2. Call it. You should hear the menu greeting.
  3. Press a key and check it goes where the menu says.
  4. Call a number pointed at an EXTENSION and one at VOICEMAIL, to confirm
     the paths that already worked still do.

Step 4 matters most. This edits the function every inbound call goes through.
EOF
