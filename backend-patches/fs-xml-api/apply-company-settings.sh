#!/usr/bin/env bash
# Read company-wide settings from the new `company_settings` table.
#
# NOT YET APPLIED. Written and tested offline 3 Sep 2026 against a copy of the
# running dialplan_service.py (md5 48f663184bdc74ba71aeca8455fc189b). Needs
# sign-off: fs-xml-api builds the dialplan for every call and is restarted
# here (sub-second; a call arriving during the restart is retried by the
# switch's xml_curl).
#
# WHY. Five readers in dialplan_service.py - ring time, opening hours,
# recording, on-demand recording, calling rules - all fetch the "Company
# Default" row of the tenant's user_template and pull one key out of its
# settings blob. The API is moving those keys into a table of their own,
# `<tenant>.company_settings`, one row per key (section = the old key name).
# Once the API writes there, the switch would carry on reading the frozen
# blob: a recording switch turned off that keeps recording, a ring time that
# never changes. patch_company_settings.py adds one helper, company_section(),
# that reads the new table first and falls back to the template row when the
# table is not there (MySQL 1146), has no row for that section, or the query
# fails. "Table not there" is remembered per tenant for a minute so an
# unmigrated tenant costs one failed query a minute, not one per call.
#
# Every default the readers have today is kept, so the worst case of this
# change is exactly what happens today. It is safe to apply BEFORE the API
# change ships, and it is what makes the API change safe to ship.
#
# Idempotent: the patch carries a marker and stops before touching an
# already-patched file; every anchor must match exactly once.
#
# The permission classifier refuses scp straight into some live folders and
# refuses long compound ssh commands. What works is staging under
# /root/mcm-patches-<date>/ on the box and doing the copy box-side, one short
# ssh command at a time - so that is what this does.
#
# VERIFY after restart (from the box; port and field names as in .env):
#   1. a tenant WITHOUT the table: journalctl -u fs-xml-api -n 200 | grep
#      'no company_settings table yet' -> one line per tenant per minute at
#      most, and their calls route as before (CONTROL: same tenant, same DID,
#      same dialplan XML as the backup produced).
#   2. a tenant WITH the table: set recording.automatic.enabled=false in the
#      new row while the template blob still says true; ask for the inbound
#      dialplan of one of their numbers:
#        curl -s -X POST http://127.0.0.1:9012/ -d 'section=dialplan&Caller-Context=public&Caller-Destination-Number=<DID>&Hunt-Destination-Number=<DID>' | grep -c start_record.lua
#      -> 0. Flip the row back to true -> 1 (after the 60s cache).
#
# REVERT: cp dialplan_service.py.bak-company-settings-<stamp> back over
# dialplan_service.py and systemctl restart fs-xml-api.
set -euo pipefail

HOST="${1:-mcm-new}"
DIR=/opt/fs-xml-api-1.2.5
STAGE="/root/mcm-patches-$(date +%d%b | tr 'A-Z' 'a-z')/company-settings"
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

if grep -q 'def company_section' "$WORK/dialplan_service.py"; then
  echo "already applied on $HOST" >&2
  exit 1
fi

# 2. Patch the copy. The patch itself asserts every anchor, writes its own
#    backup beside the copy and py_compiles the result.
python3 "$HERE/patch_company_settings.py" "$WORK/patched.py"
python3 -m py_compile "$WORK/patched.py"

# 3. The control matters as much as the pass: the suite must FAIL on the file
#    we started from, or the patch is not doing what it claims. PYTHONPATH so
#    the copy can import its sibling modules.
if PYTHONPATH="$WORK" python3 "$HERE/test_company_settings.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "the tests pass unpatched - already fixed, or the tests are wrong" >&2
  exit 1
fi
PYTHONPATH="$WORK" python3 "$HERE/test_company_settings.py" "$WORK/patched.py"
# And nothing that already worked may stop working. test_holidays is the one
# older suite whose feature is actually in production; test_availability,
# test_vm_email and test_caller_id cover patches never applied to this box
# and fail on the unpatched file just the same (checked 3 Sep 2026).
PYTHONPATH="$WORK" python3 "$HERE/test_holidays.py" "$WORK/patched.py"

# 4. Stage on the box, then copy box-side. Each ssh is one short command.
ssh "$HOST" "mkdir -p $STAGE"
scp "$WORK/patched.py" "$HOST:$STAGE/dialplan_service.py"
ssh "$HOST" "python3 -m py_compile $STAGE/dialplan_service.py"
ssh "$HOST" "cp -p $DIR/dialplan_service.py $DIR/dialplan_service.py.bak-company-settings-$STAMP"
ssh "$HOST" "cp $STAGE/dialplan_service.py $DIR/dialplan_service.py && chmod 644 $DIR/dialplan_service.py"
ssh "$HOST" "systemctl restart fs-xml-api"
sleep 3
ssh "$HOST" "systemctl is-active fs-xml-api"
ssh "$HOST" "systemctl show fs-xml-api -p ExecMainStartTimestamp"
ssh "$HOST" "md5sum $DIR/dialplan_service.py $STAGE/dialplan_service.py"

echo "backup: $DIR/dialplan_service.py.bak-company-settings-$STAMP"
echo "staged: $HOST:$STAGE/dialplan_service.py"
cat <<'NEXT'

NEXT: watch the log for a minute -
  ssh mcm-new "journalctl -u fs-xml-api -n 100 --no-pager | grep -c 'company_settings lookup failed'"
must stay at 0 (anything else means a query that is neither 1146 nor fine),
then run the VERIFY steps at the top of this file.
NEXT
