#!/usr/bin/env bash
# Apply the invite-template bundle to the two source trees.
#
#   bash apply.sh --check <mcm-repos dir>     # dry run: do both patches apply?
#   bash apply.sh [--build] <mcm-repos dir>   # apply; --build also type-checks default-api
#
# <mcm-repos dir> holds default-api/ and notification-api/ side by side
# (/root/UCAAS/mcm-repos). Needs the invites bundle (../invites) applied first:
# this patch edits helpers/inviteEmail.ts and services/UserInviteService.ts,
# which that bundle creates.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK=0; BUILD=0
for a in "$@"; do case "$a" in --check) CHECK=1 ;; --build) BUILD=1 ;; esac; done
REPOS="${@: -1}"
[ -d "$REPOS/default-api/src" ] && [ -d "$REPOS/notification-api/src" ] || { echo "usage: $0 [--check|--build] <mcm-repos dir>"; exit 1; }

for svc in notification-api default-api; do
  ( cd "$REPOS/$svc" && git apply --check "$HERE/$svc.patch" ) && echo "$svc.patch: applies cleanly"
done
[ "$CHECK" = 1 ] && exit 0

for svc in notification-api default-api; do
  ( cd "$REPOS/$svc" && git apply "$HERE/$svc.patch" ) && echo "$svc.patch: applied"
done

if [ "$BUILD" = 1 ]; then
  ( cd "$REPOS/default-api" && npx tsc --noEmit -p . ) && echo "default-api tsc: ok"
fi
echo "done. Tests: bash $HERE/tests/run.sh"
