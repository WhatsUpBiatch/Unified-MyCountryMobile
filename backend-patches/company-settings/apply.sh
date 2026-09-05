#!/usr/bin/env bash
# Apply the company-settings change to a tenant-api and a default-api SOURCE tree.
#
#   bash backend-patches/company-settings/apply.sh [--check] [--build] \
#        [TENANT_API_DIR] [DEFAULT_API_DIR]
#
# Defaults to the source mirror at /root/UCAAS/mcm-repos. This script never
# connects to a server: point it at a checkout, then build and restart that
# checkout yourself (the README says how). It refuses to run if the lines it
# edits are not where it expects them, backs the edited files up first, and
# running it twice changes nothing the second time.
#
#   --check   only verify anchors and that the patches would apply; change nothing
#   --build   after applying, run the service's own build (needs node_modules)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK=0
BUILD=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --build) BUILD=1 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
TENANT="${POSITIONAL[0]:-/root/UCAAS/mcm-repos/tenant-api}"
DEFAULT="${POSITIONAL[1]:-/root/UCAAS/mcm-repos/default-api}"
STAMP=$(date +%Y%m%d-%H%M%S)

say() { printf '\n=== %s\n' "$1"; }
stop() { printf '\n    STOP. %s\n' "$1"; exit 1; }

# The exact lines the two patches hook onto. If any is missing, somebody has
# changed the file since this patch was written and it must be re-made, not forced.
ANCHORS_TENANT=(
  'import { UserTemplateController } from "@/controllers/UserTemplateController";'
  '    public user_template = new UserTemplateController();'
  '            `${this.path}/user/template/info/:uuid`,'
)
ANCHORS_DEFAULT_TENANTROUTE=(
  'import tenantForwardingActionRoute from "./TenantRouter/tenantForwardingAction";'
  'tenantRoute.use(tenantForwardingActionRoute);'
)
ANCHORS_DEFAULT_USERROUTE=(
  'import { PrivateCallAuth } from "@/middlewares/PrivateCallAuth";'
  'userRoute.post("/update/:uuid?", auth, catchErrors(Main.update));'
)
ANCHORS_DEFAULT_USERCTRL=(
  'import CommonHelper from "@/helpers/CommonHelper";'
  '                            await CommonHelper.generateDefaultGeneralSetting('
)

need_file() { [ -f "$1" ] || stop "$1 is missing"; }
has_line() { grep -qF -- "$2" "$1"; }

check_anchors() {
  local file="$1"; shift
  for line in "$@"; do
    has_line "$file" "$line" || stop "$file does not contain the line this patch hooks onto:
       $line
    Re-make the patch against the current file instead of running this."
  done
}

say "1/6  Checking both trees are what this patch was written against"
for f in src/routers/api.ts src/controllers/UserTemplateController.ts src/middlewares/TenantAuthMiddleware.ts src/config/database.ts; do need_file "$TENANT/$f"; done
for f in src/routers/tenantRoute.ts src/routers/userRoute.ts src/controllers/UserController.ts src/services/TenantApiService.ts src/models/User.ts; do need_file "$DEFAULT/$f"; done

ALREADY_T=0; ALREADY_D=0
has_line "$TENANT/src/routers/api.ts" "CompanySettingsController" && ALREADY_T=1
has_line "$DEFAULT/src/routers/tenantRoute.ts" "tenantCompanySettingsRoute" && ALREADY_D=1
if [ "$ALREADY_T" = 1 ] && [ "$ALREADY_D" = 1 ]; then
  echo "    already applied in both trees -- nothing to do."
  exit 0
fi
[ "$ALREADY_T" = 1 ] && stop "tenant-api already has this patch but default-api does not. Apply default-api by hand from default-api.patch."
[ "$ALREADY_D" = 1 ] && stop "default-api already has this patch but tenant-api does not. Apply tenant-api by hand from tenant-api.patch."

check_anchors "$TENANT/src/routers/api.ts" "${ANCHORS_TENANT[@]}"
check_anchors "$DEFAULT/src/routers/tenantRoute.ts" "${ANCHORS_DEFAULT_TENANTROUTE[@]}"
check_anchors "$DEFAULT/src/routers/userRoute.ts" "${ANCHORS_DEFAULT_USERROUTE[@]}"
check_anchors "$DEFAULT/src/controllers/UserController.ts" "${ANCHORS_DEFAULT_USERCTRL[@]}"

# The generateDefaultGeneralSetting call must appear exactly once, or the
# seeding hook could land on the wrong call.
N=$(grep -c "await CommonHelper.generateDefaultGeneralSetting(" "$DEFAULT/src/controllers/UserController.ts" || true)
[ "$N" = 1 ] || stop "expected exactly one generateDefaultGeneralSetting call in UserController.ts, found $N"

# The pure helper is shipped twice and must be the same file.
cmp -s "$HERE/tenant-api/src/helpers/companyRuleFlags.ts" "$HERE/default-api/src/helpers/companyRuleFlags.ts" \
  || stop "the two copies of companyRuleFlags.ts in this bundle differ"

for f in src/helpers/companyRuleFlags.ts src/helpers/companySettingsSections.ts src/repositories/CompanySettingsRepository.ts src/controllers/CompanySettingsController.ts; do
  [ -e "$TENANT/$f" ] && stop "$TENANT/$f already exists; this looks half-applied. Compare it with the bundle's copy before continuing."
done
for f in src/helpers/companyRuleFlags.ts src/controllers/Tenant/TenantCompanySettingsController.ts src/routers/TenantRouter/tenantCompanySettings.ts src/services/CompanyPolicyService.ts src/middlewares/CompanyPolicyLock.ts; do
  [ -e "$DEFAULT/$f" ] && stop "$DEFAULT/$f already exists; this looks half-applied. Compare it with the bundle's copy before continuing."
done

say "2/6  Dry-running both patches"
# companyDefaults.ts is already live on mcm-new from the earlier tenant-api patch,
# so it may or may not exist in the target; the patch is filtered accordingly.
if [ -e "$TENANT/src/helpers/companyDefaults.ts" ]; then
  if cmp -s "$TENANT/src/helpers/companyDefaults.ts" "$HERE/tenant-api/src/helpers/companyDefaults.ts"; then
    echo "    companyDefaults.ts already present and identical -- leaving it alone."
    EXCLUDE_DEFAULTS="--exclude=src/helpers/companyDefaults.ts"
  else
    stop "$TENANT/src/helpers/companyDefaults.ts exists but differs from this bundle's copy. Reconcile it first."
  fi
else
  EXCLUDE_DEFAULTS=""
fi

( cd "$TENANT"  && git apply --check $EXCLUDE_DEFAULTS "$HERE/tenant-api.patch" )  || stop "tenant-api.patch does not apply cleanly to $TENANT"
( cd "$DEFAULT" && git apply --check "$HERE/default-api.patch" ) || stop "default-api.patch does not apply cleanly to $DEFAULT"
echo "    both patches apply."

if [ "$CHECK" = 1 ]; then
  say "--check given: nothing changed."
  exit 0
fi

say "3/6  Backing up the four edited files (stamp $STAMP)"
BK="$HERE/backup-$STAMP"; mkdir -p "$BK/tenant-api" "$BK/default-api"
cp "$TENANT/src/routers/api.ts" "$BK/tenant-api/api.ts"
cp "$DEFAULT/src/routers/tenantRoute.ts" "$BK/default-api/tenantRoute.ts"
cp "$DEFAULT/src/routers/userRoute.ts" "$BK/default-api/userRoute.ts"
cp "$DEFAULT/src/controllers/UserController.ts" "$BK/default-api/UserController.ts"
echo "    $BK"

say "4/6  Applying"
( cd "$TENANT"  && git apply $EXCLUDE_DEFAULTS "$HERE/tenant-api.patch" )
( cd "$DEFAULT" && git apply "$HERE/default-api.patch" )
echo "    applied."

say "5/6  Type-checking (skipped where node_modules is absent)"
if [ -d "$TENANT/node_modules" ]; then
  ( cd "$TENANT" && npx tsc --noEmit -p . ) || { echo "    tenant-api tsc FAILED. Roll back with rollback.sh $BK"; exit 1; }
  echo "    tenant-api: clean"
else
  echo "    tenant-api: no node_modules here, not checked"
fi
if [ -d "$DEFAULT/node_modules" ]; then
  ( cd "$DEFAULT" && npx tsc --noEmit -p . ) || { echo "    default-api tsc FAILED. Roll back with rollback.sh $BK"; exit 1; }
  echo "    default-api: clean"
else
  echo "    default-api: no node_modules here, not checked"
fi

say "6/6  Build"
if [ "$BUILD" = 1 ]; then
  ( cd "$TENANT"  && npx tsc && npx tsc-alias ) || { echo "    tenant-api build FAILED"; exit 1; }
  ( cd "$DEFAULT" && npx tsc && npx tsc-alias ) || { echo "    default-api build FAILED"; exit 1; }
  echo "    both built into dist/ (tsc + tsc-alias, so no @/ aliases survive)."
else
  echo "    --build not given. On the server: cd <service> && npx tsc && npx tsc-alias && pm2 restart <service>"
fi

cat <<EOF

Done. Nothing has been restarted and no server was touched by this script.
Next, on the box that runs these services (tenant-api first, then default-api):
  1. cd /var/www/prod/tenant-api  && npx tsc && npx tsc-alias && pm2 restart tenant-api
  2. cd /var/www/prod/default-api && npx tsc && npx tsc-alias && pm2 restart default-api
  3. POST /api/tenant/user/company-settings/list as an admin: expect
     migrated_from_template: true the first time and false after.
Rollback: bash $HERE/rollback.sh $BK
EOF
