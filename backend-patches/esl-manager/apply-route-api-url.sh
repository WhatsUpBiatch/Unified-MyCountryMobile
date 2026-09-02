#!/usr/bin/env bash
#
# Point the originator at the rate service that actually runs.
#
# Prepared 2 Sep 2026. Needs sign-off: esl-manager is the switch's event
# manager; restarting it drops its in-memory view of calls in progress for a
# few seconds (calls themselves are untouched; live dashboards may miss the
# hangup of a call that ends during the restart).
#
# WHY. Before every campaign originate, esl-manager POSTs the lead's number to
# ROUTE_API_URL for the carrier and the rate. The default is
# http://127.0.0.1:8003/v1/rates, and nothing listens on 8003 on this box, so
# every originate died with "Failed to fetch call routes (network)" before
# reaching the switch. The same service answers on :9004 (call-manager-api,
# systemd, up since 28 Aug) with exactly the shape esl-manager expects;
# proven with a sample lead on 2 Sep.
#
# VERIFY: journalctl -u esl-manager -f while the dialer places a call:
#   "Originating call with carrier: <uuid>" and "Originate result: +OK <uuid>"
#   CONTROL (before): "originateCall: network error fetching callroutes API".
#
# REVERT: remove the ROUTE_API_URL line from /opt/esl-manager/.env and
#   systemctl restart esl-manager.
set -euo pipefail
ENV=/opt/esl-manager/.env
STAMP=$(date +%Y%m%d-%H%M%S)
test -f "$ENV"
cp -a "$ENV" "$ENV.bak-$STAMP"
echo "backup: $ENV.bak-$STAMP"
curl -sf -m 5 -X POST http://127.0.0.1:9004/v1/rates -d 'type=number&number=12025550100&domain=&callerId=&companyUuid=' -o /dev/null \
  || { echo "rate service on :9004 did not answer; not changing anything"; exit 1; }
if grep -q '^ROUTE_API_URL=' "$ENV"; then
  sed -i 's#^ROUTE_API_URL=.*#ROUTE_API_URL=http://127.0.0.1:9004/v1/rates#' "$ENV"
else
  printf '\n# Rate/route lookup for campaign originates (call-manager-api). Nothing listens on the old :8003 default.\nROUTE_API_URL=http://127.0.0.1:9004/v1/rates\n' >> "$ENV"
fi
grep '^ROUTE_API_URL=' "$ENV"
systemctl restart esl-manager
sleep 2
systemctl is-active esl-manager
