#!/usr/bin/env bash
# Honour the dates set on each line, not only the company's.
#
# NOT YET APPLIED. Written and tested on 1 Sep 2026; the upload to the switch was
# blocked by a permission rule in the session that wrote it, so the live service
# still runs the company-holidays-only version. The screen that depends on this
# (Company > Away dates) says so in amber rather than promising a phone will stay
# quiet while it still rings. When this is applied, swap that amber block for the
# green one and redeploy the site.
#
# WHAT IT ADDS, on top of apply-holidays.sh:
#
#   * The NUMBER's own opening hours, alongside the company's. Either saying
#     closed is enough - a branch line shuts for its own holiday while head
#     office stays open, and a company holiday shuts every line regardless.
#
#   * The PERSON being rung: their own opening hours and holidays, and an away
#     period (annual leave). Applied both to a call arriving on a number that
#     rings them and to a colleague dialling their extension, because being on
#     leave does not stop at the front door. The away period is read from
#     `users.settings.away` - where the portal writes it, since /api/user/update
#     passes `settings` through untouched - and from the `holiday_start_date` /
#     `holiday_end_date` columns, which have existed all along and are written by
#     nothing. Both ends are required: a start with no end would take somebody
#     off the phones permanently the first time an admin set one and moved on.
#
#   * The IVR MENU's own opening hours, so a support line can stop taking calls
#     at six while the office works on.
#
# CALL QUEUES ARE NOT INCLUDED, deliberately. There is no queue table anywhere in
# this MySQL instance - a queue's record travels inside the number's
# `forward_call_actions`, and its agent list lives outside the database - so
# there is nothing here to read. Half-building it would be worse than the gap.
#
# The existing rule is kept throughout: only a definite "closed" changes a call.
# No hours, an unusable timezone, an unreadable date - all behave exactly as they
# do today and the call connects. Guessing "closed" sends a real caller to
# voicemail on a working day, and nobody finds out until a customer complains.
#
# Run apply-holidays.sh FIRST. These patches stack on that one and will refuse to
# apply otherwise, because the text they replace will not match.
#
# Idempotent by refusal: each patch aborts unless it finds exactly one match for
# the text it replaces, so a second run stops rather than corrupting the file.
set -euo pipefail

HOST="${1:-mcm-new}"
DIR=/opt/fs-xml-api-1.2.5
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

scp "$HOST:$DIR/dialplan_service.py" "$WORK/dialplan_service.py"
cp "$WORK/dialplan_service.py" "$WORK/patched.py"

python3 "$HERE/patch_lines.py"  "$WORK/patched.py"
python3 "$HERE/patch_routes.py" "$WORK/patched.py"
python3 -m py_compile "$WORK/patched.py"

# The control matters as much as the pass: the same suite must fail on the file
# we started from, or the patch is not doing what it claims.
if python3 "$HERE/test_availability.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "the tests pass unpatched - this file is already fixed, or the tests are wrong" >&2
  exit 1
fi
python3 "$HERE/test_availability.py" "$WORK/patched.py"
# The company-holiday behaviour must survive untouched.
python3 "$HERE/test_holidays.py" "$WORK/patched.py"

scp "$WORK/patched.py" "$HOST:$DIR/dialplan_service.py.new"
ssh "$HOST" "cd $DIR \
  && cp -p dialplan_service.py dialplan_service.py.bak-lines-$STAMP \
  && python3 -m py_compile dialplan_service.py.new \
  && mv dialplan_service.py.new dialplan_service.py \
  && chmod 644 dialplan_service.py \
  && systemctl restart fs-xml-api \
  && sleep 3 \
  && systemctl is-active fs-xml-api \
  && systemctl show fs-xml-api -p ExecMainStartTimestamp \
  && stat -c '%y %n' dialplan_service.py"

echo "backup: $DIR/dialplan_service.py.bak-lines-$STAMP"
echo
echo "NEXT: flip the amber block in src/pages/admin-settings/company/company-away-dates.tsx"
echo "      back to the green one, rebuild, and redeploy the site."
