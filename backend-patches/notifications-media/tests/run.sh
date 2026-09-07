#!/usr/bin/env bash
# Compile the two pure helpers to CommonJS and run the unit tests. No database.
#
#   bash backend-patches/notifications-media/tests/run.sh
#
# Uses the TypeScript compiler from default-api's node_modules (tenant-api has no
# node_modules in the source checkout). Output goes to a scratch dir.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPOS="${MCM_REPOS:-/root/UCAAS/mcm-repos}"
TSC="$REPOS/default-api/node_modules/.bin/tsc"
BUILD_DIR="${BUILD_DIR:-$(mktemp -d /tmp/notifications-media-tests.XXXXXX)}"

[ -x "$TSC" ] || { echo "tsc not found at $TSC"; exit 1; }

"$TSC" \
  "$REPOS/tenant-api/src/helpers/notificationSettings.ts" \
  "$REPOS/tenant-api/src/helpers/mediaOwnership.ts" \
  --outDir "$BUILD_DIR" --module commonjs --target es2017 --lib es2017,dom \
  --esModuleInterop --skipLibCheck --strict --types node

echo "compiled to $BUILD_DIR"
BUILD_DIR="$BUILD_DIR" node --test "$HERE"/*.test.cjs
