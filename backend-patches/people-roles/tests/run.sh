#!/usr/bin/env bash
# Bundle the pure helpers to CommonJS and run the unit tests. No database.
#
#   bash backend-patches/people-roles/tests/run.sh
#
# esbuild comes from the website's node_modules (vite ships it); the helpers
# import nothing from the API, so a plain bundle is enough. Falls back to tsc
# from default-api if esbuild is missing. Output goes to a scratch dir.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPOS="${MCM_REPOS:-/root/UCAAS/mcm-repos}"
API="$REPOS/default-api"
WEB="${MCM_WEB:-/root/mycountrymobile-web}"
ESBUILD="$WEB/node_modules/.bin/esbuild"
TSC="$API/node_modules/.bin/tsc"
BUILD_DIR="${BUILD_DIR:-$(mktemp -d /tmp/people-roles-tests.XXXXXX)}"

HELPERS=(
  "$API/src/helpers/roleGuard.ts"
  "$API/src/helpers/removalRouting.ts"
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

# The migration is plain JS; its pure resolver is tested straight from source.
cp "$API/migrations/20260903120000-fix-users-role-system-key.js" "$BUILD_DIR/migration.js"

BUILD_DIR="$BUILD_DIR" node --test "$HERE"/*.test.cjs
