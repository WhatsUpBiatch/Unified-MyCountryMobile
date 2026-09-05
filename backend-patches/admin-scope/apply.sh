#!/usr/bin/env bash
# Apply the admin-scope change to a default-api SOURCE tree.
#
#   bash apply.sh --check <default-api dir>      # dry run: does the patch fit?
#   bash apply.sh [--build] <default-api dir>    # copy new files, apply the patch, type-check
#
# Needs the people-roles, person-states and permissions changes already in the
# tree (RequireAdminRole, RoleResolverService, personStateRoute, RequirePermission).
# Refuses if a file it would add already exists or the patch does not apply
# cleanly. Safe to run twice: the second run sees the marker and stops.
# Production has no src (see README); on the box use dist/.
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

if grep -q "adminScopeRoute" "$API/src/app.ts" 2>/dev/null; then
  echo "already applied (adminScopeRoute is mounted in app.ts) - nothing to do"; exit 0
fi
for need in src/services/RoleResolverService.ts src/routers/personStateRoute.ts src/middlewares/PermissionGuard.ts; do
  [ -f "$API/$need" ] || { echo "missing $need; apply ../people-roles, ../person-states and ../permissions first"; exit 1; }
done

NEW=(
  src/helpers/adminScope.ts
  src/services/AdminScopeService.ts
  src/controllers/AdminScopeController.ts
  src/routers/adminScopeRoute.ts
)
for f in "${NEW[@]}"; do
  [ -e "$API/$f" ] && { echo "refusing: $API/$f already exists"; exit 1; }
done

( cd "$API" && git apply --check "$HERE/default-api.patch" )
echo "patch fits"
[ "$CHECK" = 1 ] && exit 0

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$API/.bak-admin-scope-$STAMP"
mkdir -p "$BACKUP"
for f in src/app.ts src/routers/userRoute.ts src/routers/personStateRoute.ts src/middlewares/PermissionGuard.ts src/helpers/permissionTree.ts; do
  mkdir -p "$BACKUP/$(dirname "$f")"; cp "$API/$f" "$BACKUP/$f"
done
echo "backup of the edited files: $BACKUP"

for f in "${NEW[@]}"; do
  mkdir -p "$API/$(dirname "$f")"; cp "$HERE/default-api/$f" "$API/$f"
done
( cd "$API" && git apply "$HERE/default-api.patch" )
echo "applied"

( cd "$API" && npx tsc --noEmit -p . ) && echo "tsc: ok"

if [ "$BUILD" = 1 ]; then
  ( cd "$API" && npx tsc && npx tsc-alias ) && echo "built dist/"
fi
