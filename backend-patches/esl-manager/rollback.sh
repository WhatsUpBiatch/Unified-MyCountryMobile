#!/usr/bin/env bash
# Undo the queue-figures change.   bash backend-patches/esl-manager/rollback.sh <STAMP>
set -euo pipefail
STAMP="${1:?usage: rollback.sh <STAMP>}"
HOST=mcm-new
DIR=/opt/esl-manager
ssh "$HOST" "cd $DIR \
  && mv src/controllers/CallCenterController.ts.bak-$STAMP src/controllers/CallCenterController.ts \
  && mv src/app.ts.bak-$STAMP src/app.ts \
  && rm -f src/controllers/QueueStatsController.ts \
  && mv lib/index.js.bak-$STAMP lib/index.js \
  && systemctl restart esl-manager && sleep 4 && systemctl is-active esl-manager"
echo "rolled back to $STAMP"
