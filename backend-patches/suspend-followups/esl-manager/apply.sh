#!/usr/bin/env bash
# Install the registration-flush route into esl-manager on mcm-new (142.93.121.121).
#
# NOT RUN. Needs sign-off: esl-manager is the switch's event manager and is
# restarted here (calls in progress are untouched; live dashboards may miss
# the hangup of a call that ends during the few seconds of restart).
#
#   bash backend-patches/suspend-followups/esl-manager/apply.sh
#
# Same shape as backend-patches/esl-manager/apply.sh: back up, copy, patch,
# build, restart, check, and roll back on any failure. Idempotent.
set -euo pipefail

HOST=${1:-mcm-new}
DIR=/opt/esl-manager
STAMP=$(date +%Y%m%d-%H%M%S)
HERE="$(cd "$(dirname "$0")" && pwd)"

say() { printf '\n=== %s\n' "$1"; }
[ -f "$HERE/src/utils/registrationFlush.ts" ] || { echo "run from the repo; $HERE/src missing"; exit 1; }

say "1/7  Backing up (stamp $STAMP)"
ssh "$HOST" "cd $DIR && cp lib/index.js lib/index.js.bak-$STAMP && cp src/app.ts src/app.ts.bak-$STAMP && echo '    backups written'"

say "2/7  Copying the two new files"
ssh "$HOST" "mkdir -p $DIR/src/utils $DIR/src/controllers"
scp -q "$HERE/src/utils/registrationFlush.ts" "$HOST:$DIR/src/utils/registrationFlush.ts"
scp -q "$HERE/src/controllers/RegistrationController.ts" "$HOST:$DIR/src/controllers/RegistrationController.ts"
scp -q "$HERE/patch_app_registrations.py" "$HOST:/root/patch_app_registrations.py"

say "3/7  Adding the routes to app.ts"
ssh "$HOST" "python3 /root/patch_app_registrations.py $DIR"

rollback() {
  ssh "$HOST" "cd $DIR \
    && mv src/app.ts.bak-$STAMP src/app.ts \
    && rm -f src/utils/registrationFlush.ts src/controllers/RegistrationController.ts \
    && mv lib/index.js.bak-$STAMP lib/index.js \
    && systemctl restart esl-manager"
}

say "4/7  Building"
if ! ssh "$HOST" "cd $DIR && npm run build 2>&1 | tail -15"; then
  say "BUILD FAILED -- rolling back"; rollback; exit 1
fi

say "5/7  Restarting"
ssh "$HOST" "systemctl restart esl-manager && sleep 5 && systemctl is-active esl-manager"

say "6/7  Health check"
if [ "$(ssh "$HOST" "systemctl is-active esl-manager" || true)" != "active" ]; then
  say "SERVICE UNHEALTHY -- rolling back"; rollback; exit 1
fi

say "7/7  Route check (no extension -> 400 with the reason; proves the route exists)"
ssh "$HOST" "curl -sS --max-time 5 -X POST http://127.0.0.1:5555/registrations/flush -H 'Content-Type: application/json' -d '{}'; echo"

cat <<EOF

Done. Backups on the server, stamped $STAMP:
  $DIR/lib/index.js.bak-$STAMP
  $DIR/src/app.ts.bak-$STAMP

To undo:  bash backend-patches/suspend-followups/esl-manager/rollback.sh $STAMP

VERIFY (control first): register a test extension from a softphone, then
  curl -s "http://127.0.0.1:5555/registrations?extension=<ext>&domain=<domain>"   # shows it
  suspend the person on the People screen (or POST /api/person/suspend/<uuid>)
  curl -s "http://127.0.0.1:5555/registrations?extension=<ext>&domain=<domain>"   # found: []
  docker exec mcm-freeswitch fs_cli -x "sofia status profile internal reg <ext>@<domain>"   # 0 items
  journalctl -u esl-manager -n 5 | grep RegistrationController.flush
CONTROL: suspend a person on a box where esl-manager was NOT redeployed ->
  default-api logs "NOT flushed ... old build" and the registration stays
  until its next REGISTER.
EOF
