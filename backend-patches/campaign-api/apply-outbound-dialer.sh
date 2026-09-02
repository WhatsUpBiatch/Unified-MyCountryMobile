#!/usr/bin/env bash
#
# Deploy campaign-api with the server-side outbound dialer.
#
# Prepared 2 Sep 2026. Needs sign-off: campaign-api is restarted (a few
# seconds of refused saves; calls in progress are not touched).
#
# THE SOURCE IS THE CHANGE: branch `feat/outbound-dialer` on
# /root/UCAAS/mcm-repos/campaign-api (on top of feat/queue-settings-and-tiers).
# It adds src/services/dialer/* (pacing rules with tests, the live board, the
# engine), a NATS subscribe/publish helper, pacing keys on the campaign
# schema, queues for progressive campaigns, a tenant-wide start/pause
# broadcast, and POST /api/v1/campaign/live/snapshot.
#
# ENGINE SWITCHES (in /var/www/prod/campaign-api/.env):
#   DIALER_ENGINE_ENABLED=false  -> old browser-driven behaviour, nothing dials from the server
#   DIALER_DRY_RUN=true          -> engine runs, boards update, but no originate is sent
# Pass DRY_RUN=1 to this script to add DIALER_DRY_RUN=true on first deploy.
#
# ORDER: fs-xml-api campaign context and the esl-manager ROUTE_API_URL fix
# before this, or server-placed calls will be answered into nothing / never
# leave the box. Website flag SERVER_DIALS_PROGRESSIVE after this.
#
# VERIFY after restart:
#   pm2 logs campaign-api --lines 20 --nostream | grep dialer   -> "[dialer] engine started"
#   Start a progressive campaign with one agent joined and available; within
#   a few seconds: pm2 logs show nothing about errors, the campaign monitor
#   page shows "Dialling normally" and a call row; the agent's phone rings.
#   CONTROL: pause the campaign -> the board says "Paused" within 2 s and no
#   new rows appear.
#
# REVERT:
#   ssh mcm-new 'cp /var/www/prod/campaign-api/dist/src/index.js.bak-dialer-<stamp> \
#                   /var/www/prod/campaign-api/dist/src/index.js && pm2 restart campaign-api'
set -euo pipefail
HOST=${1:-mcm-new}
REPO=/root/UCAAS/mcm-repos/campaign-api
BRANCH=feat/outbound-dialer
BUNDLE=/var/www/prod/campaign-api/dist/src/index.js
ENV=/var/www/prod/campaign-api/.env
STAMP=$(date +%Y%m%d-%H%M%S)

cd "$REPO"
test "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" || { echo "checkout $BRANCH first"; exit 1; }
test -z "$(git status --short src)" || { echo "uncommitted changes in src - commit or stash first"; exit 1; }
npx ts-node --transpile-only src/services/dialer/pacing.test.ts | tail -1
rm -rf dist
npm run build >/dev/null
node --check dist/src/index.js
grep -q "campaign-live-stats" dist/src/index.js
grep -q "live/snapshot" dist/src/index.js

ssh "$HOST" "cp -a $BUNDLE $BUNDLE.bak-dialer-$STAMP && echo backup: $BUNDLE.bak-dialer-$STAMP"
scp -q dist/src/index.js "$HOST:$BUNDLE.new"
if [ "${DRY_RUN:-0}" = "1" ]; then
  ssh "$HOST" "grep -q '^DIALER_DRY_RUN=' $ENV || printf '\nDIALER_DRY_RUN=true\n' >> $ENV; sed -i 's/^DIALER_DRY_RUN=.*/DIALER_DRY_RUN=true/' $ENV"
else
  ssh "$HOST" "sed -i 's/^DIALER_DRY_RUN=.*/DIALER_DRY_RUN=false/' $ENV || true"
fi
ssh "$HOST" "node --check $BUNDLE.new && mv $BUNDLE.new $BUNDLE && chown www-data:www-data $BUNDLE && pm2 restart campaign-api --update-env >/dev/null && sleep 4 && pm2 describe campaign-api | grep -E 'status|restarts' | head -2 && pm2 logs campaign-api --lines 40 --nostream 2>/dev/null | grep -i dialer | tail -3"
echo "deployed $(git rev-parse --short HEAD) to $HOST"
