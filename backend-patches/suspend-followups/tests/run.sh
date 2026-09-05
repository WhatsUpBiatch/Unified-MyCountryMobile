#!/usr/bin/env bash
# Bundle the pure parts to CommonJS and run the unit tests. No database, no
# switch, no network: axios and the Sequelize connection are replaced by stubs
# so the best-effort paths (timeout, 404 from an old build) can be exercised.
#
#   bash backend-patches/suspend-followups/tests/run.sh
#
# esbuild comes from the website's node_modules (vite ships it).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPOS="${MCM_REPOS:-/root/UCAAS/mcm-repos}"
WEB="${MCM_WEB:-$(cd "$HERE/../../.." && pwd)}"
ESBUILD="$WEB/node_modules/.bin/esbuild"
BUILD_DIR="${BUILD_DIR:-$(mktemp -d /tmp/suspend-followups-tests.XXXXXX)}"
[ -x "$ESBUILD" ] || { echo "esbuild not found at $ESBUILD"; exit 1; }

mkdir -p "$BUILD_DIR/stubs"
cat > "$BUILD_DIR/stubs/axios.js" <<'JS'
// Test double: every call goes to whatever the test installed on global.__axios.
const stub = {
  post: (...args) => global.__axios.post(...args),
  create: () => stub,
};
module.exports = stub;
JS
cat > "$BUILD_DIR/stubs/database.js" <<'JS'
module.exports = { sequelize: { query: (...args) => global.__sequelize.query(...args) } };
JS

bundle() { # <source> <outname> [extra esbuild args]
  local src="$1" out="$2"; shift 2
  "$ESBUILD" "$src" --bundle --platform=node --format=cjs --target=node18 \
    --outfile="$BUILD_DIR/$out.js" --log-level=warning \
    --alias:axios="$BUILD_DIR/stubs/axios.js" \
    --alias:@/config/database="$BUILD_DIR/stubs/database.js" "$@"
}

bundle "$REPOS/esl-manager/src/utils/registrationFlush.ts"            registrationFlush
bundle "$REPOS/default-api/src/services/RegistrationKickService.ts"   RegistrationKickService
bundle "$REPOS/default-api/src/services/QueueMembershipService.ts"    QueueMembershipService
bundle "$REPOS/default-api/src/services/PersonRemovalHooks.ts"        PersonRemovalHooks
bundle "$REPOS/campaign-api/src/services/queueMembership.ts"          queueMembership
echo "bundled to $BUILD_DIR"

BUILD_DIR="$BUILD_DIR" node --test "$HERE"/*.test.cjs
