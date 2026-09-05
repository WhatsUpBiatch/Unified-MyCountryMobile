#!/usr/bin/env bash
# Undo apply.sh on a SOURCE tree: put the backed-up files back, delete the new ones.
#
#   bash rollback.sh <default-api dir> <backup dir made by apply.sh>
#
# On the production box (no src) see README "Rollback": restore the *.bak files
# beside the dist files, delete the five new dist files, restart.
set -euo pipefail
API="${1:?default-api dir}"
BACKUP="${2:?backup dir (.bak-admin-scope-<stamp>)}"
[ -d "$BACKUP/src" ] || { echo "not an apply.sh backup: $BACKUP"; exit 1; }

for f in src/app.ts src/routers/userRoute.ts src/routers/personStateRoute.ts src/middlewares/PermissionGuard.ts src/helpers/permissionTree.ts; do
  [ -f "$BACKUP/$f" ] && cp "$BACKUP/$f" "$API/$f"
done
rm -f "$API/src/helpers/adminScope.ts" "$API/src/services/AdminScopeService.ts" \
      "$API/src/controllers/AdminScopeController.ts" "$API/src/routers/adminScopeRoute.ts"
echo "rolled back; run: cd $API && npx tsc --noEmit -p ."
