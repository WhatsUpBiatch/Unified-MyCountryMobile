#!/usr/bin/env bash
# Bundle the pure tree reader to CommonJS and run the unit tests. No database.
#
#   bash backend-patches/permissions/tests/run.sh
#
# esbuild comes from the website's node_modules (vite ships it); the helper
# imports nothing, so a plain bundle is enough. Falls back to tsc from
# default-api if esbuild is missing. Output goes to a scratch dir.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPOS="${MCM_REPOS:-/root/UCAAS/mcm-repos}"
API="$REPOS/default-api"
WEB="${MCM_WEB:-/root/mycountrymobile-web}"
ESBUILD="$WEB/node_modules/.bin/esbuild"
TSC="$API/node_modules/.bin/tsc"
BUILD_DIR="${BUILD_DIR:-$(mktemp -d /tmp/permissions-tests.XXXXXX)}"

HELPERS=(
  "$API/src/helpers/permissionTree.ts"
)

if [ -x "$ESBUILD" ]; then
  for f in "${HELPERS[@]}"; do
    "$ESBUILD" "$f" --bundle --platform=node --format=cjs --target=node18 \
      --outfile="$BUILD_DIR/$(basename "${f%.ts}").js" --log-level=warning
  done
  echo "bundled with esbuild to $BUILD_DIR"
elif [ -x "$TSC" ]; then
  "$TSC" "${HELPERS[@]}" --outDir "$BUILD_DIR" --module commonjs --target es2017 \
    --lib es2017,dom --esModuleInterop --skipLibCheck --types node
  echo "compiled with tsc to $BUILD_DIR"
else
  echo "neither esbuild ($ESBUILD) nor tsc ($TSC) found"; exit 1
fi

BUILD_DIR="$BUILD_DIR" node --test "$HERE"/*.test.cjs
