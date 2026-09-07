#!/usr/bin/env bash
# Undo an install of the queue agent service.
#
#   bash backend-patches/queue-agent-service/rollback.sh mcm-switch 20260830-120000
#
# With a stamp, the version from that stamp is put back. Without one, the
# service is stopped and switched off entirely, which returns the machine to
# exactly how it was before: nothing listening on port 9006.
set -euo pipefail

HOST="${1:-mcm-switch}"
STAMP="${2:-}"
DIR=/opt/queue-agent-service

if [ -n "$STAMP" ]; then
  echo "Putting back the version stamped $STAMP on $HOST"
  ssh "$HOST" "test -f $DIR/queue_agent_service.py.bak-$STAMP \
    && mv $DIR/queue_agent_service.py.bak-$STAMP $DIR/queue_agent_service.py \
    && systemctl restart queue-agent-service \
    && sleep 2 && systemctl is-active queue-agent-service"
else
  echo "Stopping and switching off the service on $HOST"
  ssh "$HOST" "systemctl stop queue-agent-service || true
    systemctl disable queue-agent-service || true
    echo 'stopped. Port 9006 is free again.'"
fi
