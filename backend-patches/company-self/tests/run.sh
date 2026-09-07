#!/usr/bin/env bash
# Bundle the pure validator to CommonJS and run the unit tests. No database,
# no browser, no server.
#
#   bash backend-patches/company-self/tests/run.sh
#
# esbuild comes from the website's node_modules (vite ships it); tsc from
# default-api is the fallback.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPOS="${MCM_REPOS:-/root/UCAAS/mcm-repos}"
API="$REPOS/default-api"
WEB="${MCM_WEB:-$(cd "$HERE/../../.." && pwd)}"
ESBUILD="$WEB/node_modules/.bin/esbuild"
TSC="$API/node_modules/.bin/tsc"
BUILD_DIR="${BUILD_DIR:-$(mktemp -d /tmp/company-self-tests.XXXXXX)}"

MODULES=(
  "$API/src/services/companySelfLogic.ts"
)

if [ -x "$ESBUILD" ]; then
  for f in "${MODULES[@]}"; do
    "$ESBUILD" "$f" --bundle --platform=node --format=cjs --target=node18 \
      --outfile="$BUILD_DIR/$(basename "${f%.ts}").js" --log-level=warning
  done
  echo "bundled with esbuild to $BUILD_DIR"
elif [ -x "$TSC" ]; then
  "$TSC" "${MODULES[@]}" --outDir "$BUILD_DIR" --module commonjs --target es2019 \
    --lib es2019 --esModuleInterop --skipLibCheck --types node
  echo "compiled with tsc to $BUILD_DIR"
else
  echo "neither esbuild ($ESBUILD) nor tsc ($TSC) found"; exit 1
fi

BUILD_DIR="$BUILD_DIR" node --test "$HERE"/*.test.cjs
