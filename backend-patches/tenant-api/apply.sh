#!/usr/bin/env bash
# Install the company-rules changes into tenant-api on mcm-new (142.93.121.121).
#
# Run from the repo root:   bash backend-patches/tenant-api/apply.sh
#
# tenant-api answers the call logs, the contacts and the phone screens, so this
# script is written to fail safe. It refuses to start if the files on the server
# are not the ones this patch was written against, backs everything up first,
# and puts it all back automatically if the build fails or the service does not
# come back. Running it twice changes nothing the second time.
set -euo pipefail

HOST=mcm-new
DIR=/var/www/prod/tenant-api
STAMP=$(date +%Y%m%d-%H%M%S)
HERE="$(cd "$(dirname "$0")" && pwd)"

# What the two edited files looked like when this patch was written. If either
# has changed on the server since, somebody else has been in there and this
# patch would silently throw their work away.
EXPECT_API_TS=49b535e8bc4d742c0d75017ce53b4cbc1c871ac9440f6993327865a60d241dcc
EXPECT_TEMPLATE_TS=4dd4bba5f5d599a042d712a6a87e99d52cdd391ff918e4c67a31aee4f2c7ec26

# What this patch's own copies of those files hash to, so a half-applied run can
# be told apart from a fresh one.
PATCHED_API_TS=$(sha256sum "$HERE/src/routers/api.ts" | cut -d' ' -f1)
PATCHED_TEMPLATE_TS=$(sha256sum "$HERE/src/repositories/UserTemplateRepository.ts" | cut -d' ' -f1)

say() { printf '\n=== %s\n' "$1"; }

for f in src/helpers/companyDefaults.ts \
         src/helpers/recordingAccess.ts \
         src/middlewares/RecordingAccessFilter.ts \
         src/routers/api.ts \
         src/repositories/UserTemplateRepository.ts; do
  [ -f "$HERE/$f" ] || { echo "missing $HERE/$f -- run from the repo root"; exit 1; }
done

say "1/8  Checking the server is where this patch expects it"
LIVE_API=$(ssh "$HOST" "sha256sum $DIR/src/routers/api.ts | cut -d' ' -f1")
LIVE_TEMPLATE=$(ssh "$HOST" "sha256sum $DIR/src/repositories/UserTemplateRepository.ts | cut -d' ' -f1")

if [ "$LIVE_API" = "$PATCHED_API_TS" ] && [ "$LIVE_TEMPLATE" = "$PATCHED_TEMPLATE_TS" ]; then
  echo "    already applied -- nothing to do."
  exit 0
fi

if [ "$LIVE_API" != "$EXPECT_API_TS" ]; then
  echo "    STOP. $DIR/src/routers/api.ts is not the file this patch was written against."
  echo "    expected $EXPECT_API_TS"
  echo "    found    $LIVE_API"
  echo "    Somebody has changed it. Re-make the patch against the current file rather"
  echo "    than running this, or their change will be lost."
  exit 1
fi

if [ "$LIVE_TEMPLATE" != "$EXPECT_TEMPLATE_TS" ]; then
  echo "    STOP. $DIR/src/repositories/UserTemplateRepository.ts is not the file this"
  echo "    patch was written against."
  echo "    expected $EXPECT_TEMPLATE_TS"
  echo "    found    $LIVE_TEMPLATE"
  exit 1
fi
echo "    both files match. Safe to go on."

say "2/8  Backing up (stamp $STAMP)"
ssh "$HOST" "cd $DIR \
  && cp -a dist dist.bak-$STAMP \
  && cp src/routers/api.ts src/routers/api.ts.bak-$STAMP \
  && cp src/repositories/UserTemplateRepository.ts src/repositories/UserTemplateRepository.ts.bak-$STAMP \
  && echo '    backups written'"

say "3/8  Copying the new files"
scp -q "$HERE/src/helpers/companyDefaults.ts"              "$HOST:$DIR/src/helpers/companyDefaults.ts"
scp -q "$HERE/src/helpers/recordingAccess.ts"              "$HOST:$DIR/src/helpers/recordingAccess.ts"
scp -q "$HERE/src/middlewares/RecordingAccessFilter.ts"    "$HOST:$DIR/src/middlewares/RecordingAccessFilter.ts"
echo "    3 new files"

say "4/8  Copying the two changed files"
scp -q "$HERE/src/routers/api.ts"                          "$HOST:$DIR/src/routers/api.ts"
scp -q "$HERE/src/repositories/UserTemplateRepository.ts"  "$HOST:$DIR/src/repositories/UserTemplateRepository.ts"
echo "    2 changed files"

# Put everything back exactly as it was. Used by every failure below.
undo() {
  ssh "$HOST" "cd $DIR \
    && rm -f src/helpers/companyDefaults.ts src/helpers/recordingAccess.ts src/middlewares/RecordingAccessFilter.ts \
    && mv src/routers/api.ts.bak-$STAMP src/routers/api.ts \
    && mv src/repositories/UserTemplateRepository.ts.bak-$STAMP src/repositories/UserTemplateRepository.ts \
    && rm -rf dist && mv dist.bak-$STAMP dist"
}

say "5/8  Building"
if ! ssh "$HOST" "cd $DIR && npx tsc && npx tsc-alias" ; then
  say "BUILD FAILED -- putting everything back"
  undo
  echo "rolled back. The running service was never touched."
  exit 1
fi
echo "    built"

say "6/8  Restarting"
ssh "$HOST" "pm2 restart tenant-api >/dev/null && sleep 5 && pm2 describe tenant-api | grep -E 'status' | head -1"

say "7/8  Health check"
# tenant-api has no health endpoint. Asking a real route with no company header
# must answer 400 with its own message -- which proves the process is up, the
# router is mounted, and the new filter let the request through.
PROBE=$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST http://127.0.0.1:3001/api/v1/user/template/listing" || true)
if [ "$PROBE" != "400" ]; then
  say "SERVICE NOT ANSWERING AS EXPECTED (got '$PROBE', wanted '400') -- putting everything back"
  undo
  ssh "$HOST" "cd $DIR && pm2 restart tenant-api >/dev/null && sleep 5 && pm2 describe tenant-api | grep -E 'status' | head -1"
  echo "rolled back and restarted."
  exit 1
fi
echo "    answering normally"

say "8/8  Smoke test against the build that is now live"
scp -q "$HERE/tests/filter-smoke-test.cjs" "$HOST:$DIR/filter-smoke-test.cjs"
ssh "$HOST" "cd $DIR && node filter-smoke-test.cjs $DIR/dist; rm -f $DIR/filter-smoke-test.cjs"

cat <<EOF

Done. Backups on the server, stamped $STAMP:
  $DIR/dist.bak-$STAMP
  $DIR/src/routers/api.ts.bak-$STAMP
  $DIR/src/repositories/UserTemplateRepository.ts.bak-$STAMP

To undo:
  bash backend-patches/tenant-api/rollback.sh $STAMP

Now do the two checks in the README under "Proving it works on a real company",
before telling anybody the recording rule is switched on.
EOF
