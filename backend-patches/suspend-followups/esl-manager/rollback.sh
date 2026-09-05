#!/usr/bin/env bash
# Put esl-manager back the way apply.sh found it.  bash rollback.sh <stamp> [host]
set -euo pipefail
STAMP=${1:?stamp, e.g. 20260903-120000}
HOST=${2:-mcm-new}
DIR=/opt/esl-manager
ssh "$HOST" "cd $DIR \
  && mv src/app.ts.bak-$STAMP src/app.ts \
  && rm -f src/utils/registrationFlush.ts src/controllers/RegistrationController.ts \
  && mv lib/index.js.bak-$STAMP lib/index.js \
  && systemctl restart esl-manager && sleep 3 && systemctl is-active esl-manager"
echo "rolled back to $STAMP"
