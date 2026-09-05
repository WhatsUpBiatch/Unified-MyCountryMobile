#!/usr/bin/env bash
# Undo backend-patches/tenant-api/apply.sh.
#
#   bash backend-patches/tenant-api/rollback.sh 20260830-141500
#
# The stamp is the one apply.sh printed when it finished. Run
# `ssh mcm-new "ls -d /var/www/prod/tenant-api/dist.bak-*"` if you have lost it.
set -euo pipefail

HOST=mcm-new
DIR=/var/www/prod/tenant-api
STAMP="${1:-}"

[ -n "$STAMP" ] || { echo "usage: bash backend-patches/tenant-api/rollback.sh <stamp>"; exit 1; }

say() { printf '\n=== %s\n' "$1"; }

say "Checking the backups are there"
ssh "$HOST" "cd $DIR \
  && test -d dist.bak-$STAMP \
  && test -f src/routers/api.ts.bak-$STAMP \
  && test -f src/repositories/UserTemplateRepository.ts.bak-$STAMP \
  && echo '    all three found'"

say "Putting the files back"
ssh "$HOST" "cd $DIR \
  && rm -f src/helpers/companyDefaults.ts \
  && rm -f src/helpers/recordingAccess.ts \
  && rm -f src/middlewares/RecordingAccessFilter.ts \
  && mv src/routers/api.ts.bak-$STAMP src/routers/api.ts \
  && mv src/repositories/UserTemplateRepository.ts.bak-$STAMP src/repositories/UserTemplateRepository.ts \
  && rm -rf dist && mv dist.bak-$STAMP dist \
  && echo '    restored'"

say "Restarting"
ssh "$HOST" "pm2 restart tenant-api >/dev/null && sleep 5 && pm2 describe tenant-api | grep -E 'status' | head -1"

say "Health check"
PROBE=$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST http://127.0.0.1:3001/api/v1/user/template/listing" || true)
echo "    /user/template/listing with no company header answered $PROBE (400 is correct)"

echo
echo "Rolled back. Nothing from this patch is left on the server."
