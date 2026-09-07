#!/usr/bin/env bash
# Finish the IP allowlist deployment on mcm-new.
#
# The code patches are ALREADY APPLIED (AuthController.js and AuthMiddleware.js
# both reference ipAllowlistEnforcementEnabled, and the five new dist files are
# in place). What this script does is fix a fault in those uploaded files and
# then load them.
#
# WHY THIS SCRIPT EXISTS - the bug it fixes:
#
# The five dist/*.js files currently on the server were compiled with `tsc`
# ALONE. This project's real build is `tsc && tsc-alias` (package.json:12).
# Without the tsc-alias pass, the compiled files still contain the TypeScript
# path aliases verbatim:
#
#   dist/services/IpAllowlistService.js:  require("@/lib/ip-allowlist")
#                                         require("@/services/TenantApiService")
#                                         require("@/models/CompanySecurityAuditLog")
#   dist/models/CompanySecurityAuditLog.js: require("@/config/database")
#
# Node cannot resolve "@/..." at runtime. Every other file in dist/ uses a
# relative path (dist/models/User.js:7 is `require("../config/database")`).
# AuthController.js and AuthMiddleware.js require IpAllowlistService at module
# load, so the FIRST RESTART of default-api after those files landed would have
# thrown MODULE_NOT_FOUND and taken the whole API down for every customer - not
# just this feature. The service has not restarted since 06:58 today and the
# files landed at 10:30, which is the only reason it is still up.
#
# The files this script uploads were produced by the full `tsc && tsc-alias`
# and have no "@/" left in them - verified before upload.
set -euo pipefail

HOST="${1:-mcm-new}"
DIST_ROOT=/var/www/prod/default-api/dist
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

FILES="lib/ip-allowlist.js services/IpAllowlistService.js middlewares/ipAllowlistFeatureFlag.js middlewares/IpAllowlistApiGuard.js models/CompanySecurityAuditLog.js"

echo "== 1. Refusing to ship anything that still carries an unresolved alias =="
for rel in $FILES; do
  if grep -q 'require("@/' "$HERE/dist/$rel"; then
    echo "ABORT: $rel still contains an unresolved @/ alias. Run 'npx tsc && npx tsc-alias' and try again." >&2
    exit 1
  fi
done
echo "   all $(echo $FILES | wc -w) files are alias-free."

echo
echo "== 2. Backing up and uploading =="
for rel in $FILES; do
  ssh "$HOST" "test -f $DIST_ROOT/$rel && cp -p $DIST_ROOT/$rel $DIST_ROOT/$rel.bak-alias-$STAMP || true"
  scp -q "$HERE/dist/$rel" "$HOST:$DIST_ROOT/$rel"
  echo "   $rel"
done

echo
echo "== 3. Proving the modules actually LOAD before restarting anything =="
# This is the check that would have caught the alias bug. It requires the
# entry module the patched files import, in the real deployment, with the real
# node_modules - if this passes, a restart cannot fail on module resolution.
ssh "$HOST" "cd /var/www/prod/default-api && node -e '
  require(\"./dist/services/IpAllowlistService.js\");
  require(\"./dist/middlewares/ipAllowlistFeatureFlag.js\");
  console.log(\"   both modules loaded cleanly\");
'"

echo
echo "== 4. Restarting default-api =="
echo "   (the feature flag is still unset, so this changes NO login behaviour -"
echo "    it only puts the new, correct files into the running process.)"
ssh "$HOST" "pm2 restart default-api --update-env"
sleep 3
ssh "$HOST" "pm2 list | grep default-api"

echo
echo "== DONE - enforcement is still OFF =="
echo
echo "Nothing is being blocked yet. To turn enforcement on:"
echo
echo "  1. FIX THE SAVED LIST FIRST. As saved right now, TestersCompany2"
echo "     (mcm_1785312032037) would lock EVERYONE out - see README.md."
echo "  2. ssh $HOST \"echo 'IP_ALLOWLIST_ENFORCEMENT_ENABLED=true' >> /var/www/prod/default-api/.env\""
echo "  3. ssh $HOST \"pm2 restart default-api --update-env\""
echo
echo "To roll the files back:  *.bak-alias-$STAMP  next to each file above."
