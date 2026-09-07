#!/usr/bin/env bash
# Put both source trees back the way apply.sh found them.
#
#   bash backend-patches/company-settings/rollback.sh <backup-dir> [TENANT_API_DIR] [DEFAULT_API_DIR]
#
# Restores the four edited files from the backup apply.sh made and removes the
# files this patch added. companyDefaults.ts is only removed if it was added by
# this patch (apply.sh leaves an existing identical copy alone, and so does this).
# The tables in each tenant database are NOT dropped: they hold the change log,
# and the old screens never stopped reading user_template, so leaving them costs
# nothing. Drop them by hand if you must:
#   DROP TABLE company_settings_history; DROP TABLE company_settings;
set -euo pipefail

BK="${1:?usage: rollback.sh <backup-dir> [tenant-api dir] [default-api dir]}"
TENANT="${2:-/root/UCAAS/mcm-repos/tenant-api}"
DEFAULT="${3:-/root/UCAAS/mcm-repos/default-api}"
HERE="$(cd "$(dirname "$0")" && pwd)"

for f in tenant-api/api.ts default-api/tenantRoute.ts default-api/userRoute.ts default-api/UserController.ts; do
  [ -f "$BK/$f" ] || { echo "backup is missing $f"; exit 1; }
done

cp "$BK/tenant-api/api.ts"             "$TENANT/src/routers/api.ts"
cp "$BK/default-api/tenantRoute.ts"    "$DEFAULT/src/routers/tenantRoute.ts"
cp "$BK/default-api/userRoute.ts"      "$DEFAULT/src/routers/userRoute.ts"
cp "$BK/default-api/UserController.ts" "$DEFAULT/src/controllers/UserController.ts"

rm -f "$TENANT/src/helpers/companyRuleFlags.ts" \
      "$TENANT/src/helpers/companySettingsSections.ts" \
      "$TENANT/src/repositories/CompanySettingsRepository.ts" \
      "$TENANT/src/controllers/CompanySettingsController.ts"

# Only remove companyDefaults.ts if nothing else in the tree still imports it.
if [ -f "$TENANT/src/helpers/companyDefaults.ts" ] && ! grep -rq "helpers/companyDefaults" "$TENANT/src" --include=*.ts; then
  rm -f "$TENANT/src/helpers/companyDefaults.ts"
fi

rm -f "$DEFAULT/src/helpers/companyRuleFlags.ts" \
      "$DEFAULT/src/controllers/Tenant/TenantCompanySettingsController.ts" \
      "$DEFAULT/src/routers/TenantRouter/tenantCompanySettings.ts" \
      "$DEFAULT/src/services/CompanyPolicyService.ts" \
      "$DEFAULT/src/middlewares/CompanyPolicyLock.ts" \
      "$DEFAULT/migrations/tenant/20260903000000-create-company-settings-tables.js"

echo "Source trees restored from $BK. Rebuild and restart each service to make it take effect:"
echo "  cd <service> && npx tsc && npx tsc-alias && pm2 restart <service>"
