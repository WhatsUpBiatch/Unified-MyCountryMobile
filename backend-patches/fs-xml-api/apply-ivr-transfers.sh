#!/usr/bin/env bash
# Menu key presses reach their target, and departments ring.
#
# WHAT: dialplan_service.py answers the contexts a menu key transfers into
# (queue, extension, number, voicemail, ivr, message, department) by reusing
# the inbound routing, and gains two route types: GREETING and DEPARTMENT.
# Details in patch_ivr_transfers.py. Needs the licence-channels patch live.
#
# VERIFY after apply (no phone needed for 1-2):
#   1. journalctl -u fs-xml-api -n 100 | grep -c Traceback   -> 0
#   2. Ask the router what a key press to the test queue does:
#        curl -s -X POST http://127.0.0.1:9000/ -d 'section=dialplan&Caller-Context=queue&Caller-Destination-Number=6a71e1ff70a608dae4ecfd24&Hunt-Destination-Number=6a71e1ff70a608dae4ecfd24&variable_domain_name=1785312032037.mycountrymobile.com' | grep -c 'callcenter-queue.lua'
#      -> 1  (before this patch: 0, "not found")
#   3. Real call: ring TestersCompany2's number that points at "IVR SALEs",
#      press 4 -> the queue answers; press 1 -> extension 1794 rings;
#      press 5 -> the SAles department rings its members.
#
# ROLLBACK: cp $DIR/dialplan_service.py.bak-ivr-transfers-<stamp> back over
# $DIR/dialplan_service.py, then systemctl restart fs-xml-api.
set -euo pipefail

HOST="${1:-mcm-new}"
DIR=/opt/fs-xml-api-1.2.5
STAGE="/root/mcm-patches-$(date +%d%b | tr 'A-Z' 'a-z')/ivr-transfers"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. The files as they run right now, plus what the service imports.
for f in dialplan_service.py channel_limit.py queue_media.py; do
  ssh "$HOST" "cat $DIR/$f" > "$WORK/$f"
done
mkdir -p "$WORK/patched"
cp "$WORK/dialplan_service.py" "$WORK/channel_limit.py" "$WORK/queue_media.py" "$WORK/patched/"

# 2. Patch the copy. Every anchor asserted once; refuses a patched file.
python3 "$HERE/patch_ivr_transfers.py" "$WORK/patched/dialplan_service.py"

# 3. Control first: the suite must FAIL on the unpatched file.
if PYTHONPATH="$WORK" python3 "$HERE/test_ivr_transfers.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "the tests pass unpatched - already applied, or the tests are wrong" >&2
  exit 1
fi
PYTHONPATH="$WORK/patched" python3 "$HERE/test_ivr_transfers.py" "$WORK/patched/dialplan_service.py"
# Nothing that already worked may stop working.
for t in test_licence_channels test_person_rules test_line_hours test_site_caller_id test_company_settings test_holidays; do
  PYTHONPATH="$WORK/patched" python3 "$HERE/$t.py" "$WORK/patched/dialplan_service.py"
done

# 4. Stage on the box, then copy box-side. Each ssh is one short command.
ssh "$HOST" "mkdir -p $STAGE"
scp "$WORK/patched/dialplan_service.py" "$HOST:$STAGE/dialplan_service.py"
ssh "$HOST" "python3 -m py_compile $STAGE/dialplan_service.py"
ssh "$HOST" "cp -p $DIR/dialplan_service.py $DIR/dialplan_service.py.bak-ivr-transfers-$STAMP"
ssh "$HOST" "cp $STAGE/dialplan_service.py $DIR/dialplan_service.py && chmod 644 $DIR/dialplan_service.py"
ssh "$HOST" "systemctl restart fs-xml-api"
sleep 3
if ! ssh "$HOST" "systemctl is-active fs-xml-api" >/dev/null; then
  echo "fs-xml-api did not come back - rolling back" >&2
  ssh "$HOST" "cp -p $DIR/dialplan_service.py.bak-ivr-transfers-$STAMP $DIR/dialplan_service.py"
  ssh "$HOST" "systemctl restart fs-xml-api; systemctl is-active fs-xml-api"
  exit 1
fi
ssh "$HOST" "systemctl show fs-xml-api -p ExecMainStartTimestamp"
ssh "$HOST" "md5sum $DIR/dialplan_service.py $STAGE/dialplan_service.py"

echo "backup: $DIR/dialplan_service.py.bak-ivr-transfers-$STAMP"
echo "staged: $HOST:$STAGE/dialplan_service.py"
echo "NEXT: run the VERIFY steps at the top of this file."
