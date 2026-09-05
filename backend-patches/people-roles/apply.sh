#!/usr/bin/env bash
# Apply the people-roles change to a default-api SOURCE tree.
#
#   bash apply.sh --check <default-api dir>      # dry run: does the patch fit?
#   bash apply.sh [--build] <default-api dir>    # copy new files, apply the patch, type-check
#
# Refuses if a file it would add already exists or the patch does not apply
# cleanly. Safe to run twice: the second run sees the marker and stops.
# Production has no src (see README), so on the box use the dist/ files instead.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK=0; BUILD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --build) BUILD=1 ;;
    *) API="$1" ;;
  esac
  shift
done
API="${API:-/root/UCAAS/mcm-repos/default-api}"
[ -f "$API/package.json" ] || { echo "not a default-api tree: $API"; exit 1; }

if grep -q "RequireAdminRole" "$API/src/routers/userRoute.ts" 2>/dev/null; then
  echo "already applied (RequireAdminRole is wired into userRoute.ts) - nothing to do"; exit 0
fi

NEW=(
  src/helpers/roleGuard.ts
  src/helpers/removalRouting.ts
  src/services/RoleResolverService.ts
  src/services/DeletedUserService.ts
  src/middlewares/RoleGuard.ts
  migrations/20260903120000-fix-users-role-system-key.js
)
for f in "${NEW[@]}"; do
  [ -e "$API/$f" ] && { echo "refusing: $API/$f already exists"; exit 1; }
done

# The patch carries the new files too, so a plain --check covers everything.
( cd "$API" && git apply --check "$HERE/default-api.patch" )
echo "patch fits"
[ "$CHECK" = 1 ] && exit 0

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$API/.bak-people-roles-$STAMP"
mkdir -p "$BACKUP"
for f in src/controllers/UserController.ts src/controllers/Roles/index.ts src/routers/userRoute.ts src/routers/rolesRoute.ts src/routers/TenantRouter/tenantUserTemplate.ts; do
  mkdir -p "$BACKUP/$(dirname "$f")"; cp "$API/$f" "$BACKUP/$f"
done
echo "backup of the edited files: $BACKUP"

( cd "$API" && git apply "$HERE/default-api.patch" )
echo "applied"

( cd "$API" && npx tsc --noEmit -p . ) && echo "tsc: ok"

if [ "$BUILD" = 1 ]; then
  ( cd "$API" && npx tsc && npx tsc-alias ) && echo "built dist/"
fi
