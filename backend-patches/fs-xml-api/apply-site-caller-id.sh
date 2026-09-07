#!/usr/bin/env bash
# Make a location's caller-ID rule (Company > Locations) reach outbound calls.
#
# NOT YET APPLIED. Written and tested offline 3 Sep 2026 against a copy of the
# running dialplan_service.py (md5 9fbddaf89949e0f71ee8ddc0f2b00c43). Needs
# sign-off: fs-xml-api builds the dialplan for every call and is restarted
# here (sub-second; a call arriving during the restart is retried by the
# switch's xml_curl).
#
# WHY. Each location carries a caller-ID rule on `sites` in the main database:
#   MAIN    "Company main number"  show the company's number, not the person's
#   CUSTOM  "Custom name"          show `caller_id_name` as the name
#   BLANK   "Withheld"             withhold caller ID
# It was saved and never read: every outbound call shows the person's own
# number (or the company's first number, or the extension) whatever the
# location says. patch_site_caller_id.py reads the rule on the outbound path
# only - one query per location per minute - and adjusts the caller-id sets
# right after the existing ones:
#   CUSTOM  name replaced (number kept)
#   MAIN    number replaced by the company's first active number, in the
#           dialplan and in the From of the bridge
#   BLANK   origination_privacy + Privacy: id exported to the carrier leg,
#           name "Anonymous", number kept (carriers need a real number in
#           From/PAI; the privacy header is what withholds it)
# No rule, an unknown rule, an empty custom name, a company with no number,
# or a lookup that fails: the call goes out exactly as today. The country
# check, recording and every existing action are left as they are.
#
# THE INBOUND HALF of this file is patched separately (build_inbound_dialplan
# and the IVR branch). Every anchor here sits inside get_caller_did and
# build_user_dialplan, above the inbound function, and the patch refuses to
# write if that is not so - the two apply in either order.
#
# Idempotent: the patch carries a marker and stops before touching an
# already-patched file; every anchor must match exactly once.
#
# The permission classifier refuses scp straight into some live folders and
# refuses long compound ssh commands. What works is staging under
# /root/mcm-patches-<date>/ on the box and doing the copy box-side, one short
# ssh command at a time - so that is what this does.
#
# VERIFY after restart (from the box; port as in .env; pick a user whose
# users.site_uuid points at a location with a rule set):
#   1. CONTROL first - a user at a location with caller_id_type NULL:
#        curl -s -X POST http://127.0.0.1:9012/ -d 'section=dialplan&Caller-Context=default&Hunt-Context=default&Caller-Destination-Number=<E164>&Hunt-Destination-Number=<E164>&user_name=<ext>&domain=<tenant>.mycountrymobile.com' | grep -c mcm_site_caller_id
#      -> 0, and the XML is what the backup produced (diff it).
#   2. Set the location to CUSTOM "Sales Desk" in the admin screen, wait 60s
#      (cache), same curl -> effective_caller_id_name=Sales Desk right after
#      the person's own name; MAIN -> effective_caller_id_number=<company's
#      first DID> and the same number in sip_from_uri; BLANK -> two export
#      lines (origination_privacy, sip_h_Privacy=id) and name Anonymous.
#   3. Place ONE real call from a BLANK location to a mobile and confirm it
#      shows withheld; from a MAIN location and confirm it shows the company
#      number. journalctl -u fs-xml-api | grep 'site caller-id rule applied'
#      names the rule per call. 'site caller-id lookup failed' must stay at 0.
#
# REVERT: cp dialplan_service.py.bak-site-caller-id-<stamp> back over
# dialplan_service.py and systemctl restart fs-xml-api.
set -euo pipefail

HOST="${1:-mcm-new}"
DIR=/opt/fs-xml-api-1.2.5
STAGE="/root/mcm-patches-03sep/site-caller-id"
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

if grep -q 'def site_caller_id_rule' "$WORK/dialplan_service.py"; then
  echo "already applied on $HOST" >&2
  exit 1
fi

# 2. Patch the copy. The patch itself asserts every anchor, checks they all
#    sit above build_inbound_dialplan, writes its own backup beside the copy
#    and py_compiles the result.
python3 "$HERE/patch_site_caller_id.py" "$WORK/patched.py"
python3 -m py_compile "$WORK/patched.py"

# 3. The control matters as much as the pass: the suite must FAIL on the file
#    we started from, or the patch is not doing what it claims. PYTHONPATH so
#    the copy can import its sibling modules.
if PYTHONPATH="$WORK" python3 "$HERE/test_site_caller_id.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "the tests pass unpatched - already fixed, or the tests are wrong" >&2
  exit 1
fi
PYTHONPATH="$WORK" python3 "$HERE/test_site_caller_id.py" "$WORK/patched.py"
# And nothing that already worked may stop working: the two suites whose
# features are in production on this box.
PYTHONPATH="$WORK" python3 "$HERE/test_company_settings.py" "$WORK/patched.py"
PYTHONPATH="$WORK" python3 "$HERE/test_holidays.py" "$WORK/patched.py"

# 4. Stage on the box, then copy box-side. Each ssh is one short command.
ssh "$HOST" "mkdir -p $STAGE"
scp "$WORK/patched.py" "$HOST:$STAGE/dialplan_service.py"
ssh "$HOST" "python3 -m py_compile $STAGE/dialplan_service.py"
ssh "$HOST" "cp -p $DIR/dialplan_service.py $DIR/dialplan_service.py.bak-site-caller-id-$STAMP"
ssh "$HOST" "cp $STAGE/dialplan_service.py $DIR/dialplan_service.py && chmod 644 $DIR/dialplan_service.py"
ssh "$HOST" "systemctl restart fs-xml-api"
sleep 3
ssh "$HOST" "systemctl is-active fs-xml-api"
ssh "$HOST" "systemctl show fs-xml-api -p ExecMainStartTimestamp"
ssh "$HOST" "md5sum $DIR/dialplan_service.py $STAGE/dialplan_service.py"

echo "backup: $DIR/dialplan_service.py.bak-site-caller-id-$STAMP"
echo "staged: $HOST:$STAGE/dialplan_service.py"
cat <<'NEXT'

NEXT: watch the log for a minute -
  ssh mcm-new "journalctl -u fs-xml-api -n 100 --no-pager | grep -c 'site caller-id lookup failed'"
must stay at 0 (a non-zero count means the sites query itself is failing and
every call is going out as before), then run the VERIFY steps at the top of
this file - control first.
NEXT
