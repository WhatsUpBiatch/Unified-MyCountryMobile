#!/usr/bin/env bash
# Undo apply.sh on a default-api SOURCE tree.
#
#   bash rollback.sh <default-api dir> <backup dir written by apply.sh>
#
# Puts the four edited files back from the backup and removes the three new
# files. On the box (dist only) do the same by hand: restore the four
# *.bak-permissions-* files, delete the three new dist files, pm2 restart.
set -euo pipefail

API="${1:-/root/UCAAS/mcm-repos/default-api}"
BACKUP="${2:?backup dir (from apply.sh) required}"
[ -d "$BACKUP" ] || { echo "no such backup: $BACKUP"; exit 1; }

for f in src/routers/userRoute.ts src/routers/mediaRoute.ts src/routers/TenantRouter/tenantUserTemplate.ts src/routers/TenantRouter/tenantCompanySettings.ts; do
  [ -f "$BACKUP/$f" ] && cp "$BACKUP/$f" "$API/$f" && echo "restored $f"
done
for f in src/helpers/permissionTree.ts src/services/PermissionTreeService.ts src/middlewares/PermissionGuard.ts; do
  rm -f "$API/$f" && echo "removed $f"
done
( cd "$API" && npx tsc --noEmit -p . ) && echo "tsc: ok"
