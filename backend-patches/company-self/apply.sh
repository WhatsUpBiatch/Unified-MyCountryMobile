#!/usr/bin/env bash
# Apply the company-self change to a default-api SOURCE tree.
#
#   bash backend-patches/company-self/apply.sh [--check] [--build] [DEFAULT_API_DIR]
#
# Defaults to the source mirror at /root/UCAAS/mcm-repos/default-api. This
# script never connects to a server: point it at a checkout, then build and
# restart that checkout yourself (the README says how). It refuses to run if
# the two lines it hooks onto in src/app.ts are not there, backs app.ts up
# first, and running it twice changes nothing the second time.
#
#   --check   only verify anchors and that the files would land; change nothing
#   --build   after applying, run `npm run build` (needs node_modules)
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
API="${POSITIONAL[0]:-/root/UCAAS/mcm-repos/default-api}"
STAMP=$(date +%Y%m%d-%H%M%S)

say() { printf '\n=== %s\n' "$1"; }
stop() { printf '\n    STOP. %s\n' "$1"; exit 1; }

FILES=(
  src/services/companySelfLogic.ts
  src/services/CompanySelfService.ts
  src/controllers/CompanySelfController.ts
  src/routers/companySelfRoute.ts
)
IMPORT_ANCHOR='import cardRoute from "./routers/cardRoute";'
IMPORT_LINE='import companySelfRoute from "./routers/companySelfRoute";'
MOUNT_ANCHOR='    app.use("/api/profile", profileSelfRoute);'
MOUNT_COMMENT='    /* Own company record (name and address), company taken from the session. */'
MOUNT_LINE='    app.use("/api/company", companySelfRoute);'

say "checking $API"
[ -f "$API/src/app.ts" ] || stop "$API/src/app.ts is missing; is this a default-api source tree?"
[ -f "$API/src/middlewares/RoleGuard.ts" ] || stop "src/middlewares/RoleGuard.ts is missing; the people-roles bundle must be applied first (RequireAdminRole)."
[ -f "$API/src/models/Company.ts" ] || stop "src/models/Company.ts is missing"
for f in "${FILES[@]}"; do
  [ -f "$HERE/default-api/$f" ] || stop "$HERE/default-api/$f is missing from the bundle"
done

ALREADY=0
if grep -qF -- "$IMPORT_LINE" "$API/src/app.ts" && grep -qF -- "$MOUNT_LINE" "$API/src/app.ts"; then
  ALREADY=1
  echo "app.ts already mounts /api/company (nothing to do there)"
else
  grep -qF -- "$IMPORT_ANCHOR" "$API/src/app.ts" || stop "anchor not found in app.ts: $IMPORT_ANCHOR"
  grep -qF -- "$MOUNT_ANCHOR" "$API/src/app.ts" || stop "anchor not found in app.ts: $MOUNT_ANCHOR"
  echo "app.ts anchors present"
fi

for f in "${FILES[@]}"; do
  if [ -f "$API/$f" ]; then
    if cmp -s "$HERE/default-api/$f" "$API/$f"; then echo "same:    $f"; else echo "differs: $f (will be replaced, backup kept)"; fi
  else
    echo "new:     $f"
  fi
done

if [ "$CHECK" = 1 ]; then say "check only; nothing changed"; exit 0; fi

say "copying files"
for f in "${FILES[@]}"; do
  mkdir -p "$API/$(dirname "$f")"
  if [ -f "$API/$f" ] && ! cmp -s "$HERE/default-api/$f" "$API/$f"; then
    cp "$API/$f" "$API/$f.bak-company-self-$STAMP"
  fi
  cp "$HERE/default-api/$f" "$API/$f"
  echo "  $f"
done

if [ "$ALREADY" = 0 ]; then
  say "mounting the route in src/app.ts"
  cp "$API/src/app.ts" "$API/src/app.ts.bak-company-self-$STAMP"
  python3 - "$API/src/app.ts" "$IMPORT_ANCHOR" "$IMPORT_LINE" "$MOUNT_ANCHOR" "$MOUNT_COMMENT" "$MOUNT_LINE" <<'PY'
import sys
p, ia, il, ma, mc, ml = sys.argv[1:7]
s = open(p).read()
assert s.count(ia + "\n") == 1 and s.count(ma + "\n") == 1
s = s.replace(ia + "\n", ia + "\n" + il + "\n")
s = s.replace(ma + "\n", ma + "\n" + mc + "\n" + ml + "\n")
open(p, "w").write(s)
print("  src/app.ts patched (backup beside it)")
PY
fi

if [ "$BUILD" = 1 ]; then
  say "building"
  (cd "$API" && npm run build)
fi

say "done. Next: build, copy the dist files the README lists, restart the service."
