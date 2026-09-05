#!/usr/bin/env bash
# Apply the notifications-media change to a tenant-api and a default-api SOURCE tree.
#
#   bash backend-patches/notifications-media/apply.sh [--check] [TENANT_API_DIR] [DEFAULT_API_DIR]
#
# Defaults to the source mirror at /root/UCAAS/mcm-repos. Never connects to a server.
# Copies the three helper files (byte-identical in both services) and applies the
# two patches with `patch -p1`. Backs up every file it changes as
# *.bak-notifications-media-<stamp>. `--check` verifies the patches would apply and
# changes nothing.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
TENANT="${POSITIONAL[0]:-/root/UCAAS/mcm-repos/tenant-api}"
DEFAULT="${POSITIONAL[1]:-/root/UCAAS/mcm-repos/default-api}"
STAMP=$(date +%Y%m%d-%H%M%S)

say() { printf '\n=== %s\n' "$1"; }
stop() { printf '\n    STOP. %s\n' "$1"; exit 1; }

HELPERS=(notificationSettings.ts mediaOwnership.ts companyRuleFlags.ts)

say "bundle copies agree"
for f in "${HELPERS[@]}"; do
  cmp -s "$HERE/tenant-api/src/helpers/$f" "$HERE/default-api/src/helpers/$f" \
    || stop "the two copies of $f in this bundle differ"
done

say "patches apply cleanly"
# The patches carry the helper files too (as new-file hunks), so a tree that has the
# helpers already will report those hunks as already applied; -N makes that a no-op.
for pair in "$TENANT:tenant-api.patch" "$DEFAULT:default-api.patch"; do
  dir="${pair%%:*}"; patchfile="${pair##*:}"
  [ -d "$dir/src" ] || stop "$dir/src is missing"
  ( cd "$dir" && patch -p1 --dry-run -N < "$HERE/$patchfile" >/dev/null ) \
    || stop "$patchfile does not apply cleanly to $dir (already applied, or the file moved on)"
  echo "    $patchfile: ok against $dir"
done

[ "$CHECK" = 1 ] && { echo; echo "check only: nothing changed"; exit 0; }

say "backing up and applying"
for pair in "$TENANT:tenant-api.patch" "$DEFAULT:default-api.patch"; do
  dir="${pair%%:*}"; patchfile="${pair##*:}"
  for f in $(grep '^+++ b/' "$HERE/$patchfile" | sed 's#^+++ b/##'); do
    [ -f "$dir/$f" ] && cp "$dir/$f" "$dir/$f.bak-notifications-media-$STAMP" || true
  done
  ( cd "$dir" && patch -p1 -N < "$HERE/$patchfile" )
done

say "helper copies (byte for byte)"
for f in "${HELPERS[@]}"; do
  cp "$HERE/tenant-api/src/helpers/$f" "$TENANT/src/helpers/$f"
  cp "$HERE/default-api/src/helpers/$f" "$DEFAULT/src/helpers/$f"
  cmp -s "$TENANT/src/helpers/$f" "$DEFAULT/src/helpers/$f" || stop "$f differs between services after copy"
done

echo
echo "done. Now: tsc --noEmit in both services, then bash $HERE/tests/run.sh"
