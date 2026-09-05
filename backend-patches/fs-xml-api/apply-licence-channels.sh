#!/usr/bin/env bash
# Concurrent calls follow licences, not numbers.
#
# WHAT: company_number_count() in dialplan_service.py counted active
# did_numbers; it becomes company_licence_count() reading companies.licenses.
# channel_limit.py keeps the same arithmetic (count + 1, capped at 500, fails
# open) and only its wording changes. Nothing else on the call path moves.
#
# EFFECT, first restart: every customer's cap becomes licences + 1. Checked
# 3 Sep 2026 against the live table - most customers gain channels (they hold
# more licences than numbers); two lose one (a5bd159a TestersCompany2 6->5,
# e351422b 3->2). Capanicus (EXPIRED, 2001 licences) is held at the 500 cap.
#
# VERIFY after apply:
#   1. journalctl -u fs-xml-api -n 200 | grep -c 'licence count lookup failed'
#      must stay 0.
#   2. Ring Sushil Company (+14422129488). The log line for that call must read
#      "channel limit applied ... limit=6" (5 licences + 1), where it read
#      limit=4 before.
#   3. Control: place a seventh simultaneous call to that company; it must
#      get busy. Six must connect.
#
# ROLLBACK: cp the two .bak-licence-channels-<stamp> files back over
# $DIR/dialplan_service.py and $DIR/channel_limit.py, then
# systemctl restart fs-xml-api.
set -euo pipefail

HOST="${1:-mcm-new}"
DIR=/opt/fs-xml-api-1.2.5
STAGE="/root/mcm-patches-$(date +%d%b | tr 'A-Z' 'a-z')/licence-channels"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. The files as they run right now, plus what they import at load time.
for f in dialplan_service.py channel_limit.py channel_limit_test.py queue_media.py; do
  ssh "$HOST" "cat $DIR/$f" > "$WORK/$f"
done
mkdir -p "$WORK/patched"
cp "$WORK/dialplan_service.py" "$WORK/channel_limit.py" "$WORK/queue_media.py" "$WORK/patched/"

# 2. Patch the copies. The patch asserts every anchor exactly once, refuses an
#    already-patched file, writes .bak beside each copy and py_compiles.
python3 "$HERE/patch_licence_channels.py" "$WORK/patched"

# 3. Control first: the suite must FAIL on the unpatched files, or the patch
#    is not doing what it claims. Then it must pass on the patched ones.
if PYTHONPATH="$WORK" python3 "$HERE/test_licence_channels.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "the tests pass unpatched - already applied, or the tests are wrong" >&2
  exit 1
fi
PYTHONPATH="$WORK/patched" python3 "$HERE/test_licence_channels.py" "$WORK/patched/dialplan_service.py"
# The allowance module's own suite (lives on the box) must still pass on the
# reworded module - the arithmetic is unchanged and this proves it.
(cd "$WORK/patched" && cp "$WORK/channel_limit_test.py" . && python3 channel_limit_test.py)
# And nothing that already worked may stop working.
for t in test_person_rules test_line_hours test_site_caller_id test_company_settings test_holidays; do
  PYTHONPATH="$WORK/patched" python3 "$HERE/$t.py" "$WORK/patched/dialplan_service.py"
done

# 4. Stage on the box, then copy box-side. Each ssh is one short command.
ssh "$HOST" "mkdir -p $STAGE"
scp "$WORK/patched/dialplan_service.py" "$WORK/patched/channel_limit.py" "$HOST:$STAGE/"
ssh "$HOST" "python3 -m py_compile $STAGE/dialplan_service.py && python3 -m py_compile $STAGE/channel_limit.py"
for f in dialplan_service.py channel_limit.py; do
  ssh "$HOST" "cp -p $DIR/$f $DIR/$f.bak-licence-channels-$STAMP"
done
for f in dialplan_service.py channel_limit.py; do
  ssh "$HOST" "cp $STAGE/$f $DIR/$f && chmod 644 $DIR/$f"
done
ssh "$HOST" "systemctl restart fs-xml-api"
sleep 3
if ! ssh "$HOST" "systemctl is-active fs-xml-api" >/dev/null; then
  echo "fs-xml-api did not come back - rolling back" >&2
  for f in dialplan_service.py channel_limit.py; do
    ssh "$HOST" "cp -p $DIR/$f.bak-licence-channels-$STAMP $DIR/$f"
  done
  ssh "$HOST" "systemctl restart fs-xml-api; systemctl is-active fs-xml-api"
  exit 1
fi
ssh "$HOST" "systemctl show fs-xml-api -p ExecMainStartTimestamp"
ssh "$HOST" "md5sum $DIR/dialplan_service.py $STAGE/dialplan_service.py $DIR/channel_limit.py $STAGE/channel_limit.py"

echo "backups: $DIR/{dialplan_service,channel_limit}.py.bak-licence-channels-$STAMP"
echo "staged:  $HOST:$STAGE/"
echo "NEXT: run the VERIFY steps at the top of this file."
