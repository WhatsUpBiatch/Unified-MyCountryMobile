#!/usr/bin/env bash
#
# Deploy campaign-api from its Bitbucket source, with the queue-settings change.
#
# APPLIED 2 Sep 2026 19:04 on mcm-new (source build of 2b74561; backup index.js.bak-20260902-190359).
# Prepared 2 Sep 2026. Needs sign-off: campaign-api owns
# queues and campaigns and is restarted here (a few seconds of refused saves;
# calls in progress are not touched - the switch never talks to this service).
#
# THE SOURCE IS THE CHANGE. Branch `feat/queue-settings-and-tiers` on
# bitbucket.org:mycountry/campaign-api (commit 2b74561) declares `waiting`,
# `after_call`, `escalation` and `regional` on settings, tolerates keys the
# schema has not been taught, accepts a member's `tier` and `rating`, and
# writes each member's real tier level for the agent service. The old
# patch_queue_settings_bundle.py (hand-editing the deployed bundle) is kept
# only as a record; do not use both.
#
# WHAT ELSE A SOURCE BUILD CHANGES. Production (built 13 Aug) is OLDER than
# the repo (mirrored 31 Aug). A fresh build also brings the developers' later
# work: campaign-delete cleanup jobs, a wrap-up-ended event, the
# queueAgentStatus endpoint, wrap_up_end handling - and drops the competitor
# origin `https://portal.dialphone.ai` from CORS, which the build plan asked
# for anyway. Everything else in the 86-module diff is boilerplate (a helper
# emitted by a newer TypeScript, and the package name in sourceURL comments).
# Reviewed module by module on 2 Sep; see QUEUES-AND-REPORTS-2SEP.md.
#
# ORDER: this before the website flag QUEUE_SERVICE_ACCEPTS_EXTENDED_SETTINGS.
#
# VERIFY after restart:
#   pm2 describe campaign-api | grep -E "status|restarts"
#   pm2 logs campaign-api --lines 30 --nostream        # no crash loop, no NATS/Redis errors
#   Save a queue from the website with "Tell them where they are in the line"
#   on (needs the flag flipped), then read it back:
#   curl -s -X POST https://api2.mycountrymobile.com/api/call-queue/info \
#        -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
#        -d '{"uuid":"<queue id>"}' | grep -o '"waiting":{[^}]*}'
#   -> must contain "announce_position":true
#   CONTROL: an untouched queue shows no "waiting" key.
#
# REVERT:
#   ssh mcm-new 'cp /var/www/prod/campaign-api/dist/src/index.js.bak-<stamp> \
#                   /var/www/prod/campaign-api/dist/src/index.js && pm2 restart campaign-api'
#   and set the website flag back to false.
set -euo pipefail
HOST=${1:-mcm-new}
REPO=/root/UCAAS/mcm-repos/campaign-api
BRANCH=feat/queue-settings-and-tiers
BUNDLE=/var/www/prod/campaign-api/dist/src/index.js
STAMP=$(date +%Y%m%d-%H%M%S)

cd "$REPO"
test "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" || { echo "checkout $BRANCH first"; exit 1; }
test -z "$(git status --short src)" || { echo "uncommitted changes in src - commit or stash first"; exit 1; }
rm -rf dist
npm run build >/dev/null
node --check dist/src/index.js
grep -q "tier: joi_1.default.number().integer().min(1).max(3)" dist/src/index.js
! grep -q "portal.dialphone.ai" dist/src/index.js

ssh "$HOST" "cp -a $BUNDLE $BUNDLE.bak-$STAMP && echo backup: $BUNDLE.bak-$STAMP"
scp -q dist/src/index.js "$HOST:$BUNDLE.new"
ssh "$HOST" "node --check $BUNDLE.new && mv $BUNDLE.new $BUNDLE && chown www-data:www-data $BUNDLE && pm2 restart campaign-api --update-env >/dev/null && sleep 3 && pm2 describe campaign-api | grep -E 'status|restarts' | head -2"
echo "deployed $(git rev-parse --short HEAD) to $HOST"
