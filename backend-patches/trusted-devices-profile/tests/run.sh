#!/usr/bin/env bash
# Bundle the pure helpers to CommonJS and run the unit tests. No database, no
# browser, no server.
#
#   bash backend-patches/trusted-devices-profile/tests/run.sh
#
# Four import-free modules are tested: two from the API (device merging and
# the five-field profile rules) and two from the website (this-device
# matching and the language list). esbuild comes from the website's
# node_modules (vite ships it); tsc from default-api is the fallback. The
# migration is plain JS and is loaded straight from source.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPOS="${MCM_REPOS:-/root/UCAAS/mcm-repos}"
API="$REPOS/default-api"
WEB="${MCM_WEB:-$(cd "$HERE/../../.." && pwd)}"
ESBUILD="$WEB/node_modules/.bin/esbuild"
TSC="$API/node_modules/.bin/tsc"
BUILD_DIR="${BUILD_DIR:-$(mktemp -d /tmp/trusted-devices-profile-tests.XXXXXX)}"

MODULES=(
  "$API/src/services/trustedDeviceLogic.ts"
  "$API/src/services/profileSelfLogic.ts"
  "$WEB/src/pages/settings/security/trusted-devices-logic.ts"
  "$WEB/src/pages/settings/basic-info/interface-languages.ts"
)

if [ -x "$ESBUILD" ]; then
  for f in "${MODULES[@]}"; do
    "$ESBUILD" "$f" --bundle --platform=node --format=cjs --target=node18 \
      --outfile="$BUILD_DIR/$(basename "${f%.ts}").js" --log-level=warning
  done
  echo "bundled with esbuild to $BUILD_DIR"
elif [ -x "$TSC" ]; then
  "$TSC" "${MODULES[@]}" --outDir "$BUILD_DIR" --module commonjs --target es2019 \
    --lib es2019,dom --esModuleInterop --skipLibCheck --types node
  echo "compiled with tsc to $BUILD_DIR"
else
  echo "neither esbuild ($ESBUILD) nor tsc ($TSC) found"; exit 1
fi

cp "$API/migrations/20260903151500-add-users-pronouns-interface-language.js" "$BUILD_DIR/migration.js"

BUILD_DIR="$BUILD_DIR" node --test "$HERE"/*.test.cjs
