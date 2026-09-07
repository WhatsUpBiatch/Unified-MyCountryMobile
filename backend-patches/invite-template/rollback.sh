#!/usr/bin/env bash
# Undo apply.sh on the two source trees (reverse both patches).
#   bash rollback.sh <mcm-repos dir>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPOS="${1:?usage: $0 <mcm-repos dir>}"
for svc in default-api notification-api; do
  ( cd "$REPOS/$svc" && git apply -R --check "$HERE/$svc.patch" && git apply -R "$HERE/$svc.patch" ) && echo "$svc.patch: reversed"
done
