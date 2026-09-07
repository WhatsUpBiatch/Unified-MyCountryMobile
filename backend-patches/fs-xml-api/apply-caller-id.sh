#!/usr/bin/env bash
# Make the two caller-ID permissions on Company > Calling change a real call.
#
# NOT YET APPLIED. Written and tested 1 Sep 2026; uploading to the switch is
# blocked by a permission rule in the session that wrote it.
#
# WHY THE SCREEN SAYS "COMING SOON" TODAY. Both switches have been stored since
# that page shipped, and the outbound dialplan sets
#
#     effective_caller_id_number = <the number on the user's own record>
#
# and looks at nothing else. The app's caller-ID picker already offers group
# numbers when the company allows it (src/hooks/use-group-caller-id-options.ts,
# which is real and reads live data) - the switch simply overwrites the choice
# on the way out. That is the whole gap.
#
# WHAT THIS ADDS
#
#   caller_id.allow_office_or_group_number
#       The number the handset presented is used, but ONLY after it is checked
#       against the company's own active DIDs. The app decides which of those to
#       show a given person; the switch is what stops a handset presenting a
#       number belonging to another company. Refusing at the switch is the only
#       refusal that counts - anything the client is trusted for can be forged.
#
#   caller_id.allow_hidden
#       origination_privacy=hide_name:hide_number, a Privacy: id header, and
#       privacy=yes - three spellings because carriers honour different ones and
#       rarely say which. The number itself still travels: carriers need one for
#       billing and for emergency calls, and what changes is that the far end is
#       told not to show it.
#
# Number matching is on digits, with a country code allowed in front, and a
# 10-digit floor so an extension or a short code cannot match the tail of a real
# number. The same number is stored as +14155550123, 14155550123 and 4155550123
# in different places here, and which screen happened to save it must not decide
# whether the permission works.
#
# Anything uncertain - permission absent or not exactly `true`, number not
# recognised, lookup failed - falls through to exactly today's behaviour. A
# caller ID that silently becomes somebody else's is worse than one that never
# changes.
set -euo pipefail

HOST="${1:-mcm-new}"
DIR=/opt/fs-xml-api-1.2.5
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ssh "$HOST" "cat $DIR/dialplan_service.py" > "$WORK/dialplan_service.py"
cp "$WORK/dialplan_service.py" "$WORK/patched.py"

if grep -q resolve_outbound_caller_id "$WORK/dialplan_service.py"; then
  echo "already applied" >&2
  exit 1
fi

python3 "$HERE/patch_caller_id.py" "$WORK/patched.py"
python3 -m py_compile "$WORK/patched.py"

# The control matters as much as the pass.
if python3 "$HERE/test_caller_id.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "the tests pass unpatched - already fixed, or the tests are wrong" >&2
  exit 1
fi
python3 "$HERE/test_caller_id.py" "$WORK/patched.py"
python3 "$HERE/test_holidays.py" "$WORK/patched.py"

scp "$WORK/patched.py" "$HOST:$DIR/dialplan_service.py.new"
ssh "$HOST" "cd $DIR \
  && cp -p dialplan_service.py dialplan_service.py.bak-callerid-$STAMP \
  && python3 -m py_compile dialplan_service.py.new \
  && mv dialplan_service.py.new dialplan_service.py \
  && chmod 644 dialplan_service.py \
  && systemctl restart fs-xml-api \
  && sleep 3 \
  && systemctl is-active fs-xml-api"

echo "backup: $DIR/dialplan_service.py.bak-callerid-$STAMP"
cat <<'NEXT'

VERIFY:
  1. turn both switches on at Company > Calling and save
  2. from the app, pick a group number in the caller-ID picker and call a mobile
     - the mobile should show the GROUP number
  3. pick the withhold option and call the same mobile
     - it should show as withheld / unknown
  4. turn both switches off, repeat 2 and 3
     - both should fall back to the caller's own number, shown

Then drop the two COMING SOON badges on the Calling screen and redeploy.
NEXT
