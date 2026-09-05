#!/usr/bin/env bash
# Install the queue agent service.
#
# NOT RUN. Nothing on any server has been changed by the person who wrote this.
#
#   bash backend-patches/queue-agent-service/apply.sh mcm-switch
#
# The switch asks this service which phone to ring on every single queued call,
# so the script is written to fail safe: it checks before it changes anything,
# it can be run twice with no harm, and it puts the old version back if the
# service does not come up healthy.
#
# It does NOT install the database driver. That is one apt command on a
# production box and it is left as a deliberate, separate decision - see step 1
# below, which checks for it and stops with the exact command to run.
set -euo pipefail

HOST="${1:-mcm-switch}"
DIR=/opt/queue-agent-service
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
STAMP=$(date +%Y%m%d-%H%M%S)

say() { printf '\n=== %s\n' "$1"; }

[ -f "$SRC_DIR/queue_agent_service.py" ] || { echo "cannot find the service next to this script"; exit 1; }

say "0/8  Checking the tests pass here first"
python3 "$SRC_DIR/tests/queue_agent_service_test.py" >/dev/null 2>&1 \
  || { echo "tests failed locally -- nothing has been sent to $HOST"; exit 1; }
echo "    tests pass"

say "1/8  Checking $HOST can talk to the queue records"
ssh "$HOST" "mkdir -p $DIR
  python3 -c 'import pymongo' 2>/dev/null && echo '    pymongo is present' || {
    echo
    echo '    STOP. The MongoDB driver is not installed on this machine.'
    echo '    A human must decide to install it. There is no pip3 on this box,'
    echo '    so use the system package:'
    echo
    echo '        apt-get install -y python3-pymongo python3-dnspython'
    echo
    echo '    python3-dnspython is only needed for a mongodb+srv:// address.'
    echo '    Then run this script again.'
    exit 1
  }"

if ssh "$HOST" "test -f $DIR/queue_agent_service.py"; then
  say "2/8  Backing up the version already there (stamp $STAMP)"
  ssh "$HOST" "cp $DIR/queue_agent_service.py $DIR/queue_agent_service.py.bak-$STAMP && echo '    backed up'"
else
  say "2/8  Nothing there yet, nothing to back up"
fi

say "3/8  Copying the service"
scp -q "$SRC_DIR/queue_agent_service.py" "$HOST:$DIR/queue_agent_service.py"

say "4/8  Settings file"
# The connection line is copied from the dialplan service that is already
# running, so the two can never point at different databases.
ssh "$HOST" "if [ -f $DIR/.env ]; then
  echo '    .env already exists, left alone'
else
  URI=\$(grep '^MONGODB_URI=' /opt/fs-xml-api-1.2.5/.env | cut -d= -f2-)
  DB=\$(grep '^MONGODB_DATABASE=' /opt/fs-xml-api-1.2.5/.env | cut -d= -f2-)
  if [ -z \"\$URI\" ]; then echo '    could not read MONGODB_URI from the dialplan service'; exit 1; fi
  {
    echo \"MONGODB_URI=\$URI\"
    echo \"MONGODB_DATABASE=\${DB:-mycountrymobile_db}\"
    echo 'HTTP_LISTEN_ADDR=127.0.0.1:9006'
    echo 'HTTP_LISTEN_HOST6=::1'
    echo 'BASE_DOMAIN=mycountrymobile.com'
    echo 'LOG_LEVEL=info'
    echo 'DB_TIMEOUT_MS=2000'
  } > $DIR/.env
  chmod 600 $DIR/.env
  echo '    .env written'
fi"

say "5/8  Service unit"
scp -q "$SRC_DIR/queue-agent-service.service" "$HOST:/etc/systemd/system/queue-agent-service.service"
ssh "$HOST" "systemctl daemon-reload && systemctl enable queue-agent-service >/dev/null 2>&1 && echo '    enabled'"

say "6/8  Starting"
ssh "$HOST" "systemctl restart queue-agent-service && sleep 3 && systemctl is-active queue-agent-service"

say "7/8  Health check"
HEALTH=$(ssh "$HOST" "curl -sS --max-time 5 http://127.0.0.1:9006/health || true")
echo "    $HEALTH"
case "$HEALTH" in
  *'"ok"'*) echo "    healthy" ;;
  *)
    say "NOT HEALTHY -- putting it back"
    ssh "$HOST" "systemctl stop queue-agent-service || true
      if [ -f $DIR/queue_agent_service.py.bak-$STAMP ]; then
        mv $DIR/queue_agent_service.py.bak-$STAMP $DIR/queue_agent_service.py
        systemctl start queue-agent-service
      else
        systemctl disable queue-agent-service || true
      fi"
    echo "rolled back."
    exit 1
    ;;
esac

say "8/8  Asking it about a real queue"
# Confirms it reached the database and read the records, not just that it is up.
# An empty agents list is a good answer: it means nobody on that queue is free.
ssh "$HOST" "journalctl -u queue-agent-service -n 5 --no-pager | grep -i 'MongoDB connection' || echo '    no connection line in the log yet'
  curl -sS --max-time 5 'http://127.0.0.1:9006/api/callcenter/queues/health-check/agents?strategy=ring-all' | head -c 400; echo"

cat <<EOF

Done on $HOST.

The event manager (esl-manager) runs on both the switch and the API box, and
both ask for this service on their own machine. Run this again with the other
host name to cover the second one.

To undo:
  bash backend-patches/queue-agent-service/rollback.sh $HOST $STAMP
EOF
