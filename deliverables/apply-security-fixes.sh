#!/usr/bin/env bash
#
# Applies both default-api security fixes to 142.93.121.121, restarts the
# service, and proves the new code is actually running.
#
# RUN THIS ON THE WEB SERVER (the box holding /root/mycountrymobile-web), not on
# the API server. The `mcm-new` alias is defined in /root/.ssh/config here.
#
#   bash scripts/apply-security-fixes.sh          # report only, changes nothing
#   bash scripts/apply-security-fixes.sh --apply  # patch, restart, verify
#
# Report mode is worth running first. It tells you what would change without
# touching anything.

set -uo pipefail
HOST=mcm-new
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILE=/var/www/prod/default-api/dist/controllers/AuthController.js

run() {  # run() <script> [--apply]
  local script="$1" arg="${2:-}"
  if [ -n "$arg" ]; then
    ssh -o BatchMode=yes "$HOST" "bash -s -- $arg" < "$HERE/$script"
  else
    ssh -o BatchMode=yes "$HOST" 'bash -s' < "$HERE/$script"
  fi
}

echo "target: $HOST (142.93.121.121) — backend for unified.mycountrymobile.com"
echo "mode:   $([ $APPLY = 1 ] && echo 'APPLY — will patch and restart' || echo 'report only')"
echo
echo "############ 1. roles: cross-customer delete/update ############"
run fix-role-tenant-scope.sh $([ $APPLY = 1 ] && echo --apply)
echo
echo "############ 2. filter injection ############"
run fix-filter-injection.sh $([ $APPLY = 1 ] && echo --apply)
echo

if [ $APPLY = 0 ]; then
  echo "Nothing was changed. Re-run with --apply when you are ready."
  exit 0
fi

echo "############ 3. restart ############"
ssh -o BatchMode=yes "$HOST" "pm2 restart default-api" 2>&1 | tail -3
echo
echo "############ 4. is the new code actually running? ############"
# The check that matters: a patched file with an older process means the fix
# is sitting on disk doing nothing. That is exactly what happened last time.
ssh -o BatchMode=yes "$HOST" "
  sleep 4
  PID=\$(pm2 pid default-api 2>/dev/null)
  F=\$(stat -c %Y $FILE)
  P=\$(date -d \"\$(ps -o lstart= -p \$PID)\" +%s 2>/dev/null)
  echo \"    file:    \$(date -u -d @\$F '+%F %T UTC')\"
  echo \"    process: \$(date -u -d @\$P '+%F %T UTC')\"
  if [ -n \"\$P\" ] && [ \"\$P\" -ge \"\$F\" ]; then
    echo '    LIVE — the patched code is running'
  else
    echo '    STALE — the patch is NOT running. Restart did not take.'
  fi
  echo
  echo '    pm2 status:'
  pm2 list 2>/dev/null | grep -E 'default-api' | sed 's/^/    /'
"
echo
echo "If anything went wrong, every patched file has a .bak-<timestamp> beside it."
echo "Restore with:  ssh $HOST \"cp <file>.bak-<stamp> <file> && pm2 restart default-api\""
