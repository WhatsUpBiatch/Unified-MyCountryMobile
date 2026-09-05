#!/usr/bin/env bash
# Install live queue figures into esl-manager on mcm-new (142.93.121.121).
#
# Run from the repo root:   bash backend-patches/esl-manager/apply.sh
#
# esl-manager sits in the live call path, so this script is written to fail
# safe: it backs up first, verifies at every step, and rolls back automatically
# if the build fails or the service does not come back healthy. It is also
# idempotent -- running it twice changes nothing the second time.
set -euo pipefail

HOST=mcm-new
DIR=/opt/esl-manager
STAMP=$(date +%Y%m%d-%H%M%S)
SRC="$(dirname "$0")/src/controllers/QueueStatsController.ts"

say() { printf '\n=== %s\n' "$1"; }

[ -f "$SRC" ] || { echo "cannot find $SRC -- run from the repo root"; exit 1; }

say "1/7  Backing up (stamp $STAMP)"
ssh "$HOST" "cd $DIR \
  && cp lib/index.js lib/index.js.bak-$STAMP \
  && cp src/controllers/CallCenterController.ts src/controllers/CallCenterController.ts.bak-$STAMP \
  && cp src/app.ts src/app.ts.bak-$STAMP \
  && echo '    backups written'"

say "2/7  Copying the new controller"
scp -q "$SRC" "$HOST:$DIR/src/controllers/QueueStatsController.ts"

say "3/7  Applying the two hooks"
ssh "$HOST" "cd $DIR && python3 - <<'PY'
import io, sys

# ---- CallCenterController.ts -------------------------------------------------
p = 'src/controllers/CallCenterController.ts'
s = io.open(p, encoding='utf-8').read()

if 'QueueStatsController' in s:
    print('    hooks already present, skipping')
else:
    s = s.replace(
        'import { ESLController } from \"./ESLController\";',
        'import { ESLController } from \"./ESLController\";\n'
        'import { QueueStatsController } from \"./QueueStatsController\";',
        1)

    anchor = '        // Publish to NATS as callcenter.events'
    if anchor not in s:
        sys.exit('    ANCHOR MISSING in CallCenterController.ts -- aborting')

    hook = '''        // Live queue figures. Every entry point inside QueueStatsController is
        // wrapped and never throws: a statistics counter must not be able to
        // drop a real call.
        if (ccEvent.call_type === \"queue\" && ccEvent.type === \"call-start\") {
          QueueStatsController.onQueueStart(ccEvent.queue, ccEvent.call_uuid);
        } else if (ccEvent.type === \"member-queue-end\") {
          QueueStatsController.onQueueEnd(ccEvent.call_uuid);
        } else if (ccEvent.type === \"bridge-agent-start\") {
          QueueStatsController.onAgentOnCall(ccEvent.queue, ccEvent.agentName, ccEvent.call_uuid);
        } else if (ccEvent.type === \"bridge-agent-end\" || ccEvent.type === \"bridge-failed\") {
          QueueStatsController.onAgentAvailable(ccEvent.queue, ccEvent.agentName);
        }

'''
    s = s.replace(anchor, hook + anchor, 1)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('    CallCenterController.ts hooked')

# ---- app.ts ------------------------------------------------------------------
p = 'src/app.ts'
s = io.open(p, encoding='utf-8').read()

if 'QueueStatsController' in s:
    print('    endpoints already present, skipping')
else:
    s = s.replace(
        'import { CallController } from \"./controllers/CallController\";',
        'import { CallController } from \"./controllers/CallController\";\n'
        'import { QueueStatsController } from \"./controllers/QueueStatsController\";',
        1)

    anchor = '// ============ TRANSCRIPTION ENDPOINTS ============'
    if anchor not in s:
        sys.exit('    ANCHOR MISSING in app.ts -- aborting')

    routes = '''// ============ LIVE QUEUE FIGURES ============
// Read-only. How many are waiting, and how long a call usually takes.
// \`trustworthy\` false means the numbers must NOT be read out to a caller.

app.get(\"/queue-stats\", (_req, res) => res.json(QueueStatsController.allStats()));
app.get(\"/queue-stats/:queue\", (req, res) =>
  res.json(QueueStatsController.statsFor(req.params.queue)),
);

'''
    s = s.replace(anchor, routes + anchor, 1)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('    app.ts endpoints added')
PY"

say "4/7  Building"
if ! ssh "$HOST" "cd $DIR && npm run build 2>&1 | tail -15"; then
  say "BUILD FAILED -- rolling back"
  ssh "$HOST" "cd $DIR \
    && mv src/controllers/CallCenterController.ts.bak-$STAMP src/controllers/CallCenterController.ts \
    && mv src/app.ts.bak-$STAMP src/app.ts \
    && rm -f src/controllers/QueueStatsController.ts \
    && mv lib/index.js.bak-$STAMP lib/index.js"
  echo "rolled back. Service untouched."
  exit 1
fi

say "5/7  Restarting"
ssh "$HOST" "systemctl restart esl-manager && sleep 5 && systemctl is-active esl-manager"

say "6/7  Health check"
HEALTH=$(ssh "$HOST" "systemctl is-active esl-manager" || true)
if [ "$HEALTH" != "active" ]; then
  say "SERVICE UNHEALTHY -- rolling back"
  ssh "$HOST" "cd $DIR \
    && mv src/controllers/CallCenterController.ts.bak-$STAMP src/controllers/CallCenterController.ts \
    && mv src/app.ts.bak-$STAMP src/app.ts \
    && rm -f src/controllers/QueueStatsController.ts \
    && mv lib/index.js.bak-$STAMP lib/index.js \
    && systemctl restart esl-manager"
  echo "rolled back and restarted."
  exit 1
fi
echo "    service active"

say "7/7  Endpoint check"
ssh "$HOST" "curl -sS --max-time 5 http://127.0.0.1:5555/queue-stats | head -c 400; echo"

cat <<EOF

Done. Backups on the server, stamped $STAMP:
  $DIR/lib/index.js.bak-$STAMP
  $DIR/src/controllers/CallCenterController.ts.bak-$STAMP
  $DIR/src/app.ts.bak-$STAMP

To undo:
  bash backend-patches/esl-manager/rollback.sh $STAMP

Next: watch memory across one busy day, and compare the waiting count against
what the switch reports on a real queue BEFORE the website is pointed at it.
EOF
