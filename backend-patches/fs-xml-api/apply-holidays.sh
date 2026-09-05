#!/usr/bin/env bash
# Make company holidays actually close a line.
#
# Two defects, both in the opening-hours block of dialplan_service.py:
#
#   1. The holiday date was read off the keys `date`/`day`/`value`/`start`. A
#      stored holiday has none of them - it is `{title, from, to, type, ...}`,
#      and its `value` holds the ACTION (an extension number), not a day. So
#      every holiday in the system silently missed, and an extension that
#      happened to look like a date could shut a line on a working day.
#      patch_holidays.py reads `from`..`to`, fills in the days between, honours
#      "repeats every year", and merges in the list the Company > Holidays
#      screen saves under `settings.company_holidays`.
#
#   2. The check ran after the schedule branch, so a company on "open 24 hours"
#      never observed a holiday, and one that had never filled in a timetable
#      never observed one either. patch_order.py moves it in front.
#
# Idempotent by refusal: each patch aborts unless it finds exactly one match for
# the text it replaces, so a second run on an already-patched file stops rather
# than corrupting it.
#
# Verified live on mcm-new 1 Sep 2026: 25/25 offline tests against the deployed
# file, and the three tenants that have real holiday data resolve correctly.
set -euo pipefail

HOST="${1:-mcm-new}"
DIR=/opt/fs-xml-api-1.2.5
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

scp "$HOST:$DIR/dialplan_service.py" "$WORK/dialplan_service.py"
cp "$WORK/dialplan_service.py" "$WORK/patched.py"

python3 "$HERE/patch_holidays.py" "$WORK/patched.py"
python3 "$HERE/patch_order.py"    "$WORK/patched.py"
python3 -m py_compile "$WORK/patched.py"

# The control matters as much as the pass: the same suite must fail on the file
# we started from, or the patch is not doing what it claims.
if python3 "$HERE/test_holidays.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "the tests pass unpatched - this file is already fixed, or the tests are wrong" >&2
  exit 1
fi
python3 "$HERE/test_holidays.py" "$WORK/patched.py"

scp "$WORK/patched.py" "$HOST:$DIR/dialplan_service.py.new"
ssh "$HOST" "cd $DIR \
  && cp -p dialplan_service.py dialplan_service.py.bak-holidays-$STAMP \
  && python3 -m py_compile dialplan_service.py.new \
  && mv dialplan_service.py.new dialplan_service.py \
  && chmod 644 dialplan_service.py \
  && systemctl restart fs-xml-api \
  && sleep 3 \
  && systemctl is-active fs-xml-api \
  && systemctl show fs-xml-api -p ExecMainStartTimestamp \
  && stat -c '%y %n' dialplan_service.py"

echo "backup: $DIR/dialplan_service.py.bak-holidays-$STAMP"
