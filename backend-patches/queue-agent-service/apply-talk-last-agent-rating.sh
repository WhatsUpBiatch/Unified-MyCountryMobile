#!/usr/bin/env bash
# Talk time, last-agent routing and the first-ring rating bar - agent service half.
# Run ON mcm-new. Requires apply-escalation-settings.sh applied first.
# VERIFY: after one answered queue call,
#   mongosh ... --eval 'db.agents.find({name:"<ext>@<domain>"},{talk_time:1,calls_answered:1})'
#   shows talk_time > 0, and db.queue_last_agents holds {caller, agent, at}.
#   Then, with "send them back to the person they spoke to last" on, the next
#   poll for that caller logs "Ringing <agent> first: they took this caller's last call".
# REVERT: cp queue_agent_service.py.bak-talk-<stamp> back, restart.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET=/opt/queue-agent-service/queue_agent_service.py
STAMP=$(date +%Y%m%d-%H%M%S)
cp -a "$TARGET" "$TARGET.bak-talk-$STAMP"; echo "backup: $TARGET.bak-talk-$STAMP"
python3 "$HERE/patch_talk_last_agent_rating.py" "$TARGET"
python3 -m py_compile "$TARGET"
systemctl restart queue-agent-service; sleep 1; systemctl is-active queue-agent-service
