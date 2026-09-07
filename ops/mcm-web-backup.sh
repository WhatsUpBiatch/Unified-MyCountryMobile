#!/bin/bash
# Hourly off-box backup of the mycountrymobile-web repository.
#
# WHY THIS EXISTS
# The repo had no git remote of any kind: 114 commits of work existed only on
# this one server, on a disk that was 80% full and shared with 33 other sites.
# One disk failure would have taken all of it.
#
# TWO KINDS OF COPY, ON PURPOSE
#   1. A mirror push, hourly. Incremental and near-free, so the copy is never
#      more than an hour behind.
#   2. A dated bundle, daily. A mirror follows the source faithfully - which
#      means it would faithfully follow a deletion too. The bundles cannot be
#      overwritten by a later push, so there is always a point in time to go
#      back to that does not depend on the source still being sane.
#
# Each destination is handled independently: one server being unreachable must
# never stop the other being backed up.

set -uo pipefail

SRC=/root/mycountrymobile-web
DESTS="mcm-switch mcm-ucaas3"
REMOTE_DIR=/var/backups/mcm-web-repo
MIRROR="$REMOTE_DIR/mycountrymobile-web.git"
KEEP_BUNDLES=14
LOG=/var/log/mcm-web-backup.log
STAMP=$(date +%Y%m%d-%H%M%S)
TODAY=$(date +%Y%m%d)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

cd "$SRC" 2>/dev/null || { log "FAIL: $SRC is not there"; exit 1; }

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo main)
HEAD_SHA=$(git rev-list -1 HEAD 2>/dev/null)
COMMITS=$(git rev-list --count HEAD 2>/dev/null)
log "start: HEAD=$HEAD_SHA commits=$COMMITS"

for h in $DESTS; do
  # --mirror so branches that were deleted here are deleted there too; a backup
  # that quietly kept dead branches would misrepresent what the work is.
  if git push --mirror --quiet "$h:$MIRROR" 2>>"$LOG"; then
    # `git init --bare` leaves HEAD on refs/heads/master. Our branch is main, so
    # without this a clone of the backup checks out nothing and looks empty even
    # though every commit is present. The push reports success either way, which
    # is exactly why this is set on every run rather than once at creation.
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$h" \
      "git -C $MIRROR symbolic-ref HEAD refs/heads/$BRANCH" 2>>"$LOG"
    log "$h: mirror ok"
  else
    log "$h: MIRROR PUSH FAILED"
  fi

  # One immutable snapshot a day, kept for a fortnight.
  if ! ssh -o BatchMode=yes -o ConnectTimeout=15 "$h" \
        "ls $REMOTE_DIR/bundle-$TODAY-*.bundle >/dev/null 2>&1"; then
    TMP="/tmp/mcm-web-$STAMP.bundle"
    if git bundle create "$TMP" --all >/dev/null 2>&1; then
      if scp -o BatchMode=yes -o ConnectTimeout=15 -q "$TMP" "$h:$REMOTE_DIR/bundle-$STAMP.bundle"; then
        log "$h: bundle ok ($(du -h "$TMP" | cut -f1))"
        ssh -o BatchMode=yes "$h" \
          "ls -1t $REMOTE_DIR/bundle-*.bundle 2>/dev/null | tail -n +$((KEEP_BUNDLES+1)) | xargs -r rm -f" 2>>"$LOG"
      else
        log "$h: BUNDLE COPY FAILED"
      fi
      rm -f "$TMP"
    else
      log "$h: BUNDLE CREATE FAILED"
    fi
  fi
done

# GitHub, last. It is the only copy that survives all three machines being
# lost, but it is also the only one that depends on someone else's service and
# on a token that can expire - so it runs after the two that do not, and a
# failure here is logged rather than allowed to mask a successful local backup.
if git remote get-url origin >/dev/null 2>&1; then
  if git push --quiet origin --all 2>>"$LOG" && git push --quiet origin --tags 2>>"$LOG"; then
    log "github: ok"
  else
    log "github: PUSH FAILED (token expired, or no network)"
  fi
else
  log "github: no origin remote configured, skipped"
fi

log "done"
