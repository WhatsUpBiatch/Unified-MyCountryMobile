#!/usr/bin/env bash
# Enforce Company > Security's IP allowlist at sign-in.
#
# NOT YET APPLIED. Every write to mcm-new is blocked by a permission rule in
# the session that wrote this. Everything below has been verified as far as it
# can be without that access - see README.md's "What is real right now"
# section for exactly what was run and what it proved.
#
# THIS TAKES THE DIST-ONLY PATH, NOT A REBUILD, and that is a deliberate,
# load-bearing choice - read README.md before changing it. Production's
# compiled AuthController.js carries at least one hand-applied fix
# ("Device already verified", the trusted-device 30-day OTP skip) that exists
# NOWHERE in the source mirror this patch was written against, and other
# recent fixes exist only in that mirror's uncommitted working tree. A `tsc`
# rebuild from anywhere except that exact tree, right now, would silently drop
# what is live. So this drops five already-compiled .js files next to the ones
# already running and patches TWO more in place - AuthController.js (blocks a
# new sign-in from a disallowed network) and AuthMiddleware.js (blocks EVERY
# subsequent request of a session already in progress, the moment the network
# it started from stops being allowed) - the same way those existing
# hand-patches were made. Neither .ts source file is touched, `tsc` does not
# run, and nothing is restarted that does not have to be.
#
# The five new files were not hand-written as JavaScript: they are the real
# output of this project's own `tsc -p tsconfig.json` run against the
# TypeScript in src/, using the project's own installed dependencies. See
# README.md for how that was verified (a full `tsc --noEmit` against the real
# tsconfig, in an isolated copy of the whole repository, returned zero
# errors).
set -euo pipefail

HOST="${1:-mcm-new}"
DIST_ROOT=/var/www/prod/default-api/dist
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

LOGIN_TARGET="$DIST_ROOT/controllers/AuthController.js"
SESSION_TARGET="$DIST_ROOT/middlewares/AuthMiddleware.js"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ssh "$HOST" "cat $LOGIN_TARGET" > "$WORK/AuthController.js"
ssh "$HOST" "cat $SESSION_TARGET" > "$WORK/AuthMiddleware.js"
cp "$WORK/AuthController.js" "$WORK/AuthController.patched.js"
cp "$WORK/AuthMiddleware.js" "$WORK/AuthMiddleware.patched.js"

if grep -q ipAllowlistEnforcementEnabled "$WORK/AuthController.js"; then
  echo "already applied - AuthController.js already references ipAllowlistEnforcementEnabled" >&2
  exit 1
fi
if grep -q ipAllowlistEnforcementEnabled "$WORK/AuthMiddleware.js"; then
  echo "already applied - AuthMiddleware.js already references ipAllowlistEnforcementEnabled" >&2
  exit 1
fi

python3 "$HERE/patch_login_ip_allowlist_dist.py" "$WORK/AuthController.patched.js"
python3 "$HERE/patch_auth_middleware_ip_allowlist_dist.py" "$WORK/AuthMiddleware.patched.js"

# node --check is a syntax check, not a full type-check - the type-check
# already happened when dist/*.js was compiled from src/*.ts (see README.md).
# What this proves is that the ANCHOR-BASED EDIT into each live file did not
# corrupt it.
node --check "$WORK/AuthController.patched.js"
node --check "$WORK/AuthMiddleware.patched.js"

echo "Diff of AuthController.js (new sign-ins):"
diff -u "$WORK/AuthController.js" "$WORK/AuthController.patched.js" || true
echo
echo "Diff of AuthMiddleware.js (every authenticated request, existing sessions included):"
diff -u "$WORK/AuthMiddleware.js" "$WORK/AuthMiddleware.patched.js" || true
echo
read -r -p "Apply BOTH of these to $HOST ? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Aborted - nothing was changed on $HOST." >&2
  exit 1
fi

# 1. back up and drop in the five new compiled files.
ssh "$HOST" "mkdir -p $DIST_ROOT/lib $DIST_ROOT/services $DIST_ROOT/middlewares"
for rel in lib/ip-allowlist.js services/IpAllowlistService.js middlewares/ipAllowlistFeatureFlag.js middlewares/IpAllowlistApiGuard.js models/CompanySecurityAuditLog.js; do
  if ssh "$HOST" "test -f $DIST_ROOT/$rel"; then
    ssh "$HOST" "cp -p $DIST_ROOT/$rel $DIST_ROOT/$rel.bak-ipallowlist-$STAMP"
  fi
  scp "$HERE/dist/$rel" "$HOST:$DIST_ROOT/$rel"
done

# 2. back up and patch both live files in place.
# The pre-move syntax check is done against a ".cjs"-suffixed copy, not
# ".new" - recent Node versions pick the module system by file extension and
# no longer fall back to CommonJS for an extension they do not recognise, so
# "AuthController.js.new" throws ERR_UNKNOWN_FILE_EXTENSION even though the
# file itself is valid CommonJS. ".cjs" is unambiguous either way.
ssh "$HOST" "cp -p $LOGIN_TARGET $LOGIN_TARGET.bak-ipallowlist-$STAMP"
scp "$WORK/AuthController.patched.js" "$HOST:$LOGIN_TARGET.new.cjs"
ssh "$HOST" "node --check $LOGIN_TARGET.new.cjs && mv $LOGIN_TARGET.new.cjs $LOGIN_TARGET"

ssh "$HOST" "cp -p $SESSION_TARGET $SESSION_TARGET.bak-ipallowlist-$STAMP"
scp "$WORK/AuthMiddleware.patched.js" "$HOST:$SESSION_TARGET.new.cjs"
ssh "$HOST" "node --check $SESSION_TARGET.new.cjs && mv $SESSION_TARGET.new.cjs $SESSION_TARGET"

# 3. the migration - creates company_security_audit_logs, additive only.
echo
echo "Files are in place. The migration has NOT been run automatically - run it"
echo "from the default-api deployment (not this script), with its own review:"
echo "  npx sequelize-cli db:migrate --migrations-path migrations \\"
echo "    (after copying 20260902000000-sync-company-security-audit-log-table.js"
echo "     and the CompanySecurityAuditLog model into the deployed source tree,"
echo "     or by running scripts/migrations/syncModelByTable(\"company_security_audit_logs\")"
echo "     directly if this deployment does not use sequelize-cli migrations)."
echo
echo "Enforcement itself is STILL OFF - the feature flag is unset. Nothing pushed"
echo "by this script changes any login until an operator explicitly sets"
echo "  IP_ALLOWLIST_ENFORCEMENT_ENABLED=true"
echo "in default-api's environment and restarts it. See README.md's Rollout"
echo "section before doing that."
echo
echo "backups on $HOST:"
echo "  $LOGIN_TARGET.bak-ipallowlist-$STAMP"
echo "  $SESSION_TARGET.bak-ipallowlist-$STAMP"
echo "  $DIST_ROOT/{lib,services,middlewares,models}/*.bak-ipallowlist-$STAMP (where a file already existed)"
