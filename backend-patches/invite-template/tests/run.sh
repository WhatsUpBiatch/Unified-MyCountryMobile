#!/usr/bin/env bash
# Unit tests for the invite template bundle. No database, no server.
#
#   bash backend-patches/invite-template/tests/run.sh
#
# Bundles default-api's helpers/inviteEmail.ts to CommonJS with esbuild (from
# the website's node_modules; tsc from default-api as the fallback) and renders
# notification-api's real template files with Handlebars - the same renderer
# notification-api uses (EmailService.compileTemplate). Handlebars is looked
# for in notification-api's and default-api's node_modules, then $HANDLEBARS_DIR;
# if none has it, it is installed once into the scratch build dir (needs the
# npm registry).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPOS="${MCM_REPOS:-/root/UCAAS/mcm-repos}"
API="$REPOS/default-api"
NOTIF="$REPOS/notification-api"
WEB="${MCM_WEB:-/root/mycountrymobile-web}"
ESBUILD="$WEB/node_modules/.bin/esbuild"
TSC="$API/node_modules/.bin/tsc"
BUILD_DIR="${BUILD_DIR:-$(mktemp -d /tmp/invite-template-tests.XXXXXX)}"

HELPER="$API/src/helpers/inviteEmail.ts"

if [ -x "$ESBUILD" ]; then
  "$ESBUILD" "$HELPER" --bundle --platform=node --format=cjs --target=node18 \
    --outfile="$BUILD_DIR/inviteEmail.js" --log-level=warning
  echo "bundled with esbuild to $BUILD_DIR"
elif [ -x "$TSC" ]; then
  "$TSC" "$HELPER" --outDir "$BUILD_DIR" --module commonjs --target es2017 \
    --lib es2017,dom --esModuleInterop --skipLibCheck --types node
  echo "compiled with tsc to $BUILD_DIR"
else
  echo "neither esbuild ($ESBUILD) nor tsc ($TSC) found"; exit 1
fi

HB=""
for cand in "${HANDLEBARS_DIR:-}" "$NOTIF/node_modules/handlebars" "$API/node_modules/handlebars" "$BUILD_DIR/node_modules/handlebars"; do
  if [ -n "$cand" ] && [ -f "$cand/package.json" ]; then HB="$cand"; break; fi
done
if [ -z "$HB" ]; then
  echo "handlebars not found locally; installing 4.7.8 into $BUILD_DIR"
  ( cd "$BUILD_DIR" && npm install --no-audit --no-fund --silent handlebars@4.7.8 >/dev/null )
  HB="$BUILD_DIR/node_modules/handlebars"
fi
echo "handlebars: $HB ($(node -e "console.log(require('$HB').VERSION)"))"

BUILD_DIR="$BUILD_DIR" HANDLEBARS_DIR="$HB" TEMPLATES_DIR="$NOTIF/src/templates/ucaas" \
  node --test "$HERE"/*.test.cjs
