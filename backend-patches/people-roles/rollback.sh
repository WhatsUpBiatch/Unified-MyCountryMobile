#!/usr/bin/env bash
# Undo apply.sh on a SOURCE tree: restore the five edited files from the backup
# apply.sh made and remove the six added files. Then rebuild and restart.
#
#   bash rollback.sh <default-api dir> <backup dir>
set -euo pipefail
API="${1:?default-api dir}"; BACKUP="${2:?backup dir made by apply.sh}"
for f in src/controllers/UserController.ts src/controllers/Roles/index.ts src/routers/userRoute.ts src/routers/rolesRoute.ts src/routers/TenantRouter/tenantUserTemplate.ts; do
  cp "$BACKUP/$f" "$API/$f"
done
rm -f "$API/src/helpers/roleGuard.ts" "$API/src/helpers/removalRouting.ts" \
      "$API/src/services/RoleResolverService.ts" "$API/src/services/DeletedUserService.ts" \
      "$API/src/middlewares/RoleGuard.ts" \
      "$API/migrations/20260903120000-fix-users-role-system-key.js"
echo "rolled back. The data-fix migration is NOT reversed: users.role now holds system keys, which is what the old code compared against anyway."
