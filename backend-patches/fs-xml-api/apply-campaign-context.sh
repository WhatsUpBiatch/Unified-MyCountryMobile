#!/usr/bin/env bash
#
# Server-placed campaign calls: give the answered leg a route.
#
# Prepared 2 Sep 2026. Needs sign-off: fs-xml-api builds the dialplan for
# every call and is restarted here (sub-second; a call arriving during the
# restart is retried by the switch's xml_curl).
#
# WHY. The originator dials each campaign lead with `... outbound XML campaign`.
# When the customer answers, the switch asks fs-xml-api for extension
# "outbound" in context "campaign". The service only knew internal/default
# and public, so every server-placed campaign call was answered and dropped
# ("not found"). This adds the context: it reads the campaign's queue id off
# the X-ForwardValue header and hands the call to the queue exactly as an
# inbound number routed to that queue is handled, so the campaign's agents
# ring. Inert until the dialer engine (campaign-api) places a call.
#
# VERIFY after restart (from the box):
#   curl -s -X POST http://127.0.0.1:9012/ -d 'section=dialplan&Caller-Context=campaign&Caller-Destination-Number=outbound&variable_sip_h_X-ForwardValue=<queue _id>&variable_sip_h_X-Domain=<domain>' \
#     | grep -o 'sip_h_X-Queue=[0-9a-f]*\|callcenter-queue.lua\|hangup'
#   -> sip_h_X-Queue=<id> and callcenter-queue.lua for a campaign queue id;
#      CONTROL: a made-up id gives "hangup" and no queue script.
#   (fs-xml-api listens where its .env says; 9012 behind the callcenter shim.)
#
# REVERT: cp dialplan_service.py.bak-campaign-<stamp> back, systemctl restart fs-xml-api.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET=/opt/fs-xml-api-1.2.5/dialplan_service.py
STAMP=$(date +%Y%m%d-%H%M%S)

test -f "$TARGET"
cp -a "$TARGET" "$TARGET.bak-campaign-$STAMP"
echo "backup: $TARGET.bak-campaign-$STAMP"
python3 "$HERE/patch_campaign_context.py" "$TARGET"
python3 -m py_compile "$TARGET"
python3 "$HERE/campaign_context_test.py" "$TARGET" | tail -1
systemctl restart fs-xml-api
sleep 1
systemctl is-active fs-xml-api
