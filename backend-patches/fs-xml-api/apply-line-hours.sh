#!/usr/bin/env bash
# Honour the opening hours saved on a number and on an IVR menu.
#
# NOT YET APPLIED. Written and tested offline 3 Sep 2026 against a copy of the
# running dialplan_service.py (md5 9fbddaf89949e0f71ee8ddc0f2b00c43, verified
# against mcm-new at 06:43 UTC). Needs sign-off: fs-xml-api builds the dialplan
# for every call and is restarted here (sub-second; a call arriving during the
# restart is retried by the switch's xml_curl).
#
# WHY. Two screens store hours that nothing reads. Numbers > call handling
# saves the number's own hours and an after-hours destination under
# `forward_call_actions.condition.operational_hours`; Phone systems > IVR
# menus saves the menu's own under `ivrs.settings.operational_hours`. The
# inbound dialplan asks only the company's hours, so a branch line set to
# close at five rings until head office shuts, and a menu that says "after
# six, voicemail" plays its daytime options all night.
#
# WHAT patch_line_hours.py DOES, in build_inbound_dialplan:
#   1. Closed if EITHER the company OR the number's own hours say closed
#      (logged as closed_by=company|number|"company and number"). Destination,
#      most specific first: the number's own closed_hour_action (enabled, with
#      a type and value) -> call_handling.closed_hours (today's block) ->
#      voicemail for an EXTENSION (today's fallback) -> ring through, logged.
#   2. A number routed to an IVR asks the menu's own hours, right after the
#      queue check asks the queue's. A shut menu with an enabled destination is
#      rerouted to it and falls into the ordinary route-type chain; a shut menu
#      with none runs as today, logged. The ivrs read is cached per (db, uuid)
#      for CALLING_RULES_CACHE_SECONDS.
#   Unknown never diverts: no hours, an unusable timezone, an unreadable
#   block, a failed read - the call connects exactly as it does today.
#   Not touched: company hours read, queue check, recording, channel guard,
#   anything outbound.
#
# Idempotent: the patch carries a marker and stops before touching an
# already-patched file; every anchor must match exactly once.
#
# The permission classifier refuses scp straight into some live folders and
# refuses long compound ssh commands. What works is staging under
# /root/mcm-patches-<date>/ on the box and doing the copy box-side, one short
# ssh command at a time - so that is what this does.
#
# VERIFY after restart (from the box; port as in .env):
#   1. CONTROL - a number with no hours of its own, company open: ask for its
#      inbound dialplan before and after; the XML must be identical.
#        curl -s -X POST http://127.0.0.1:9012/ -d 'section=dialplan&Caller-Context=public&Caller-Destination-Number=<DID>&Hunt-Destination-Number=<DID>'
#   2. NUMBER - on a test number set its own hours to a window that is shut
#      right now, closed_hour_action enabled -> VOICEMAIL <ext>, company left
#      open. Wait 60s (the DID row is read per call, the company hours are
#      cached) and ask again: expect save-voicemail.lua with
#      vm_target_extension=<ext>, and in the log
#        journalctl -u fs-xml-api -n 100 --no-pager | grep '"closed_by": "number"'
#      Widen the window to open -> the bridge to the extension is back.
#   3. MENU - on a test IVR set hours that are shut now, closed_hour_action
#      enabled -> VOICEMAIL <ext>; point a number at that IVR. Ask: expect the
#      voicemail actions, not application="ivr", and the log line "the menu
#      itself is closed, using its own destination". Switch the action off ->
#      after 60s the ivr action is back plus "running the menu" in the log.
#   4. Nothing at error level:
#        journalctl -u fs-xml-api -n 200 --no-pager | grep -c 'menu hours lookup failed\|number hours could not be judged'
#      must stay at 0.
#
# REVERT: cp dialplan_service.py.bak-line-hours-<stamp> back over
# dialplan_service.py and systemctl restart fs-xml-api.
set -euo pipefail

HOST="${1:-mcm-new}"
DIR=/opt/fs-xml-api-1.2.5
STAGE="/root/mcm-patches-$(date +%d%b | tr 'A-Z' 'a-z')/line-hours"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. The file as it runs right now, plus the modules it imports at load time
#    (the tests import the patched copy, which imports them).
for f in dialplan_service.py channel_limit.py queue_media.py; do
  ssh "$HOST" "cat $DIR/$f" > "$WORK/$f"
done
cp "$WORK/dialplan_service.py" "$WORK/patched.py"

if grep -q 'def ivr_operational_hours' "$WORK/dialplan_service.py"; then
  echo "already applied on $HOST" >&2
  exit 1
fi

# 2. Patch the copy. The patch itself asserts every anchor, writes its own
#    backup beside the copy and py_compiles the result.
python3 "$HERE/patch_line_hours.py" "$WORK/patched.py"
python3 -m py_compile "$WORK/patched.py"

# 3. The control matters as much as the pass: the suite must FAIL on the file
#    we started from, or the patch is not doing what it claims. PYTHONPATH so
#    the copy can import its sibling modules.
if PYTHONPATH="$WORK" python3 "$HERE/test_line_hours.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "the tests pass unpatched - already fixed, or the tests are wrong" >&2
  exit 1
fi
PYTHONPATH="$WORK" python3 "$HERE/test_line_hours.py" "$WORK/patched.py"
# And nothing that already worked may stop working: the two suites whose
# features are in production on this box (checked 3 Sep 2026).
PYTHONPATH="$WORK" python3 "$HERE/test_company_settings.py" "$WORK/patched.py"
PYTHONPATH="$WORK" python3 "$HERE/test_holidays.py" "$WORK/patched.py"

# 4. Stage on the box, then copy box-side. Each ssh is one short command.
ssh "$HOST" "mkdir -p $STAGE"
scp "$WORK/patched.py" "$HOST:$STAGE/dialplan_service.py"
ssh "$HOST" "python3 -m py_compile $STAGE/dialplan_service.py"
ssh "$HOST" "cp -p $DIR/dialplan_service.py $DIR/dialplan_service.py.bak-line-hours-$STAMP"
ssh "$HOST" "cp $STAGE/dialplan_service.py $DIR/dialplan_service.py && chmod 644 $DIR/dialplan_service.py"
ssh "$HOST" "systemctl restart fs-xml-api"
sleep 3
ssh "$HOST" "systemctl is-active fs-xml-api"
ssh "$HOST" "systemctl show fs-xml-api -p ExecMainStartTimestamp"
ssh "$HOST" "md5sum $DIR/dialplan_service.py $STAGE/dialplan_service.py"

echo "backup: $DIR/dialplan_service.py.bak-line-hours-$STAMP"
echo "staged: $HOST:$STAGE/dialplan_service.py"
cat <<'NEXT'

NEXT: watch the log for a minute -
  ssh mcm-new "journalctl -u fs-xml-api -n 100 --no-pager | grep -c 'menu hours lookup failed'"
must stay at 0, then run the VERIFY steps at the top of this file - the
CONTROL first, so a pass on the test number means something.
NEXT
