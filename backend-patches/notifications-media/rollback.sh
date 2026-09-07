#!/usr/bin/env bash
# Undo apply.sh in a SOURCE tree: put back the newest *.bak-notifications-media-* copies
# and remove the two helper files this change introduced. companyRuleFlags.ts is
# restored from its backup (it existed before). Never connects to a server.
#
#   bash backend-patches/notifications-media/rollback.sh [TENANT_API_DIR] [DEFAULT_API_DIR]
set -euo pipefail
TENANT="${1:-/root/UCAAS/mcm-repos/tenant-api}"
DEFAULT="${2:-/root/UCAAS/mcm-repos/default-api}"

for dir in "$TENANT" "$DEFAULT"; do
  echo "=== $dir"
  find "$dir/src" -name '*.bak-notifications-media-*' | sort | while read -r bak; do
    orig="${bak%.bak-notifications-media-*}"
    cp "$bak" "$orig" && echo "    restored $orig"
  done
  for f in notificationSettings.ts mediaOwnership.ts; do
    [ -f "$dir/src/helpers/$f" ] && rm "$dir/src/helpers/$f" && echo "    removed src/helpers/$f" || true
  done
done
echo "done. companyRuleFlags.ts is back to the previous (absent = locked) read only if a backup existed."
