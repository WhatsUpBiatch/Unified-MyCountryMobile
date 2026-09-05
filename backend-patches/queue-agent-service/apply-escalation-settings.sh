#!/usr/bin/env bash
#
# Widen the ring on the queue's own terms.
#
# APPLIED 2 Sep 2026 19:01 on mcm-new (backup queue_agent_service.py.bak-escalation-20260902-190122).
# Prepared 2 Sep 2026. Needs sign-off: the agent service is
# asked on every queue poll who should ring; it is restarted here (about a
# second; the switch treats a failed poll as "nobody free yet" and asks again).
#
# Reads settings.escalation {enabled, widen_after_seconds} off the queue
# record. Off -> everyone rings from the first attempt regardless of tier.
# On -> tiers are added after the admin's number of seconds. Absent -> exactly
# today's behaviour. Depends on campaign-api accepting `escalation` and
# writing real tier levels (../campaign-api/apply-queue-settings.sh).
#
# VERIFY: with a queue on Ring All, two members on tier 1 and 2, widening on
# at 30 s: the first poll's JSON names only the tier-1 person and
# "changes_in_seconds": 30; a poll 31 s into the same call names both.
# CONTROL: the same queue with widening off names both on the first poll.
#   curl -s "http://127.0.0.1:<port>/queue/<queue key>/agents?strategy=ring-all&call_uuid=test-$(date +%s)"
#
# REVERT: cp queue_agent_service.py.bak-escalation-<stamp> back, restart.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET=/opt/queue-agent-service/queue_agent_service.py
STAMP=$(date +%Y%m%d-%H%M%S)

test -f "$TARGET"
cp -a "$TARGET" "$TARGET.bak-escalation-$STAMP"
echo "backup: $TARGET.bak-escalation-$STAMP"
python3 "$HERE/patch_escalation_settings.py" "$TARGET"
python3 -m py_compile "$TARGET"
systemctl restart queue-agent-service
sleep 1
systemctl is-active queue-agent-service
