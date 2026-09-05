#!/usr/bin/env bash
# Apply the invites change to a default-api SOURCE tree.
#
#   bash apply.sh --check <default-api dir>      # dry run: does the patch fit?
#   bash apply.sh [--build] <default-api dir>    # apply the patch (new files included), type-check
#
# Refuses if a file it would add already exists or the patch does not apply
# cleanly. Safe to run twice: the second run sees the marker and stops.
# Production has no src (see README): on the box use the dist/ files and
# apply-dist-app.sh instead.
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

if grep -q "inviteRoute" "$API/src/app.ts" 2>/dev/null; then
  echo "already applied (inviteRoute is mounted in app.ts) - nothing to do"; exit 0
fi

NEW=(
  src/helpers/inviteToken.ts
  src/helpers/inviteEmail.ts
  src/models/UserInvite.ts
  src/services/UserInviteService.ts
  src/controllers/InviteController.ts
  src/routers/inviteRoute.ts
  migrations/20260903150000-create-user-invites-table.js
)
for f in "${NEW[@]}"; do
  [ -e "$API/$f" ] && { echo "refusing: $API/$f already exists"; exit 1; }
done

# The patch carries the new files too, so a plain --check covers everything
# except the two app.ts lines, whose anchors are checked here.
( cd "$API" && git apply --check "$HERE/default-api.patch" )
grep -q 'import identityRoute from "./routers/IdentityRoute";' "$API/src/app.ts" || { echo "app.ts anchor 1 missing"; exit 1; }
grep -q 'app.use("/api/user", userRoute);' "$API/src/app.ts" || { echo "app.ts anchor 2 missing"; exit 1; }
echo "patch fits"
[ "$CHECK" = 1 ] && exit 0

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$API/.bak-invites-$STAMP"
mkdir -p "$BACKUP/src/controllers"
cp "$API/src/controllers/UserController.ts" "$BACKUP/src/controllers/"
cp "$API/src/app.ts" "$BACKUP/src/"
echo "backup of the two edited files: $BACKUP"

( cd "$API" && git apply "$HERE/default-api.patch" )
echo "applied UserController.ts and the new files"

# app.ts is not in the patch: other same-day changes mount routers at the same
# spot, so a context diff would not fit. Insert the two lines by anchor instead
# (the same thing apply-dist-app.sh does to the live dist/app.js).
python3 - "$API/src/app.ts" <<'PYEOF'
import sys
p = sys.argv[1]; s = open(p).read()
a = 'import identityRoute from "./routers/IdentityRoute";\n'
b = '    app.use("/api/user", userRoute);\n'
assert a in s and b in s, "app.ts anchors not found"
s = s.replace(a, a + 'import inviteRoute from "./routers/inviteRoute";\n', 1)
s = s.replace(b, b + '    /* Invite links for new people (own controller: AuthController stays untouched). */\n    app.use("/api/invite", inviteRoute);\n', 1)
open(p, 'w').write(s)
PYEOF
echo "mounted /api/invite in app.ts"

( cd "$API" && npx tsc --noEmit -p . ) && echo "tsc: ok"

if [ "$BUILD" = 1 ]; then
  ( cd "$API" && npx tsc && npx tsc-alias ) && echo "built dist/"
fi
