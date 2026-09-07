#!/usr/bin/env bash
# Undo apply.sh on a SOURCE tree: put the two edited files back from the
# backup apply.sh made, delete the added files.
#
#   bash rollback.sh <default-api dir> <backup dir>
set -euo pipefail
API="${1:?default-api dir}"; BACKUP="${2:?backup dir made by apply.sh}"
cp "$BACKUP/src/controllers/UserController.ts" "$API/src/controllers/UserController.ts"
cp "$BACKUP/src/app.ts" "$API/src/app.ts"
rm -f "$API/src/helpers/inviteToken.ts" "$API/src/helpers/inviteEmail.ts" \
      "$API/src/models/UserInvite.ts" "$API/src/services/UserInviteService.ts" \
      "$API/src/controllers/InviteController.ts" "$API/src/routers/inviteRoute.ts" \
      "$API/migrations/20260903150000-create-user-invites-table.js"
echo "rolled back; rebuild (npx tsc && npx tsc-alias) and restart"
