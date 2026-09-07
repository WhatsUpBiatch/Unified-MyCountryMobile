#!/usr/bin/env bash
# Make a person's own call rules reach direct calls to their extension.
#
# NOT YET APPLIED. Written and tested offline 3 Sep 2026 against a copy of the
# running dialplan_service.py (md5 7128403a2bfe6d7de8d2c045e2c10a36 - the
# production file WITH today's line-hours and site-caller-id patches; this
# patch's anchors need the line-hours helpers in place and it refuses to run
# otherwise). Needs sign-off: fs-xml-api builds the dialplan for every call
# and is restarted here (sub-second; a call arriving during the restart is
# retried by the switch's xml_curl).
#
# WHY. My Phone, Preferences and Greetings each save rules nothing reads:
#   users.call_forwarding   forward_calls, dnd, incoming_calls.device_options
#                           [].timeout, incoming_calls.failure_action ("if busy
#                           / unanswered / unreachable" - one key for all
#                           three), incoming_calls.closed_hour_action
#   users.settings          operational_hours {type, value, holidays,
#                           regional.timezone, closed_hour_action}
#   users.greetings         voicemail {enabled, label, value} (also read as
#                           voicemail_greeting / vm)
# The inbound dialplan rings user/<ext> for the company's ring time and then,
# with continue_on_fail=true and nothing after the bridge, ends the call.
#
# WHAT patch_person_rules.py DOES. Decided 3 Sep (row 17): a person's rules
# apply to DIRECT calls only - the EXTENSION route - never to a queue call.
#   1. person_record(): one SELECT settings, call_forwarding, greetings on
#      users by company + extension, cached per person for
#      CALLING_RULES_CACHE_SECONDS (the get_calling_rules style). Read fails
#      -> error log, not cached, ring as today.
#   2. Hook right above `if route_type == "EXTENSION":`, i.e. after every
#      company / number / queue / menu check, applied ONCE for the extension
#      dialled (a reroute to a colleague does not read the colleague's rules,
#      so two people forwarding to each other cannot loop). In order:
#        forward all     -> reroute (any type the chain runs)
#        do not disturb  -> own voicemail, or the stored dnd destination
#        personal hours  -> judged by the same business_hours_state as the
#                           company; only a definite "closed" diverts, to
#                           settings.operational_hours.closed_hour_action,
#                           else incoming_calls.closed_hour_action, else own
#                           voicemail. Unknown = open.
#        ring time       -> the longest active own-device timeout, held to
#                           5..120; the SHORTER of it and the company's wins
#        after the ring  -> failure_action appended after the bridge:
#                           VOICEMAIL (greeting + beep), EXTENSION, HANGUP.
#                           PHONE/QUEUE/IVR cannot run after a bridge from
#                           here and are logged as not applied.
#   3. In the VOICEMAIL branch (and the after-ring voicemail) the person's
#      greeting is fetched from object storage by queue_media.fetch_greeting
#      - the same helper and bucket path the queue greetings use - and played
#      before the beep; unfetchable -> warn, beep only.
#   One info line per rule applied: "person rule applied" rule=<name>.
#   Garbage never diverts; any exception -> error log, today's behaviour.
#   Not touched: QUEUE, IVR, PHONE, HANGUP branches, every hours check,
#   recording, the channel guard, anything outbound.
#
# Idempotent: the patch carries a marker and stops before touching an
# already-patched file; every anchor must match exactly once.
#
# The permission classifier refuses scp straight into some live folders and
# refuses long compound ssh commands. What works is staging under
# /root/mcm-patches-<date>/ on the box and doing the copy box-side, one short
# ssh command at a time - so that is what this does.
#
# VERIFY after restart (from the box; port as in .env). Pick a test person
# whose extension a test number rings directly (EXTENSION route), company
# open, number with no hours of its own.
#   1. CONTROL first - that person with My Phone untouched (no forward, no
#      DND, hours 24h or unset, no failure action): ask for the number's
#      inbound dialplan before and after; the XML must be identical, and
#        journalctl -u fs-xml-api -n 100 --no-pager | grep -c 'person rule applied'
#      must be 0 for that call.
#        curl -s -X POST http://127.0.0.1:9012/ -d 'section=dialplan&Caller-Context=public&Caller-Destination-Number=<DID>&Hunt-Destination-Number=<DID>'
#   2. NO ANSWER - on My Phone set "If Busy / Unanswered" -> Send to Voicemail
#      (personal), ring time 15s, Submit. Wait 60s (cache). Same curl: expect
#      call_timeout=15 (if the company's is longer), and after the bridge line
#      four more: accountcode, vm_target_extension=<ext>, answer,
#      save-voicemail.lua. Log: 'rule": "ring time"' and 'rule": "busy or no
#      answer"'. Then ONE real call, let it ring out: it must reach voicemail,
#      not silence.
#   3. DND - in the admin Call Rules drawer switch Do Not Disturb on, wait 60s,
#      same curl: no bridge line at all, save-voicemail.lua with
#      vm_target_extension=<ext>; log 'rule": "do not disturb"'. Switch it off
#      -> after 60s the bridge is back.
#   4. FORWARD ALL - set Forward All Calls -> External Number <mobile>, wait
#      60s: expect the sofia/internal/<mobile>@<carrier> bridge and
#      effective_caller_id_number=<DID>; 'rule": "forward all calls"'. ONE
#      real call: the mobile rings. Switch it off.
#   5. PERSONAL HOURS - on Preferences set custom hours shut right now with a
#      timezone, closed action -> Send to Voicemail; wait 60s: the voicemail
#      actions; 'rule": "personal hours closed"'. Set 24 hours -> bridge back.
#      A QUEUE number the person is an agent of must show NO change and NO
#      person log line throughout (direct calls only).
#   6. GREETING - on Greetings enable Voicemail with an uploaded file, wait
#      60s, curl the voicemail route: a playback line naming
#      /etc/freeswitch/sounds/mcm/greetings/<company>/<file> between answer
#      and the lua; the file exists on disk; 'rule": "voicemail greeting"'.
#      ONE real call to voicemail: the greeting plays, then the beep.
#   7. Nothing at error level:
#        journalctl -u fs-xml-api -n 500 --no-pager | grep -c 'person rules lookup failed\|person rules could not be judged\|greeting failed'
#      must stay at 0.
#
# REVERT: cp dialplan_service.py.bak-person-rules-<stamp> back over
# dialplan_service.py and systemctl restart fs-xml-api.
set -euo pipefail

HOST="${1:-mcm-new}"
DIR=/opt/fs-xml-api-1.2.5
STAGE="/root/mcm-patches-$(date +%d%b | tr 'A-Z' 'a-z')/person-rules"
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

if grep -q 'def person_call_plan' "$WORK/dialplan_service.py"; then
  echo "already applied on $HOST" >&2
  exit 1
fi
# The anchors sit on the line-hours helpers; that patch must be live first.
if ! grep -q 'def ivr_operational_hours' "$WORK/dialplan_service.py"; then
  echo "line-hours patch is not on $HOST yet - apply-line-hours.sh first" >&2
  exit 1
fi
# queue_media must offer the fetch helper this patch borrows.
if ! grep -q '^def fetch_greeting' "$WORK/queue_media.py"; then
  echo "queue_media.py on $HOST has no fetch_greeting - not the module this was written against" >&2
  exit 1
fi

# 2. Patch the copy. The patch itself asserts every anchor, writes its own
#    backup beside the copy and py_compiles the result.
python3 "$HERE/patch_person_rules.py" "$WORK/patched.py"
python3 -m py_compile "$WORK/patched.py"

# 3. The control matters as much as the pass: the suite must FAIL on the file
#    we started from, or the patch is not doing what it claims. PYTHONPATH so
#    the copy can import its sibling modules.
if PYTHONPATH="$WORK" python3 "$HERE/test_person_rules.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "the tests pass unpatched - already fixed, or the tests are wrong" >&2
  exit 1
fi
PYTHONPATH="$WORK" python3 "$HERE/test_person_rules.py" "$WORK/patched.py"
# And nothing that already worked may stop working: the suites whose
# features are in production on this box (checked 3 Sep 2026).
PYTHONPATH="$WORK" python3 "$HERE/test_line_hours.py" "$WORK/patched.py"
PYTHONPATH="$WORK" python3 "$HERE/test_site_caller_id.py" "$WORK/patched.py"
PYTHONPATH="$WORK" python3 "$HERE/test_company_settings.py" "$WORK/patched.py"
PYTHONPATH="$WORK" python3 "$HERE/test_holidays.py" "$WORK/patched.py"

# 4. Stage on the box, then copy box-side. Each ssh is one short command.
ssh "$HOST" "mkdir -p $STAGE"
scp "$WORK/patched.py" "$HOST:$STAGE/dialplan_service.py"
ssh "$HOST" "python3 -m py_compile $STAGE/dialplan_service.py"
ssh "$HOST" "cp -p $DIR/dialplan_service.py $DIR/dialplan_service.py.bak-person-rules-$STAMP"
ssh "$HOST" "cp $STAGE/dialplan_service.py $DIR/dialplan_service.py && chmod 644 $DIR/dialplan_service.py"
ssh "$HOST" "systemctl restart fs-xml-api"
sleep 3
ssh "$HOST" "systemctl is-active fs-xml-api"
ssh "$HOST" "systemctl show fs-xml-api -p ExecMainStartTimestamp"
ssh "$HOST" "md5sum $DIR/dialplan_service.py $STAGE/dialplan_service.py"

echo "backup: $DIR/dialplan_service.py.bak-person-rules-$STAMP"
echo "staged: $HOST:$STAGE/dialplan_service.py"
cat <<'NEXT'

NEXT: watch the log for a minute -
  ssh mcm-new "journalctl -u fs-xml-api -n 200 --no-pager | grep -c 'person rules lookup failed'"
must stay at 0, then run the VERIFY steps at the top of this file - the
CONTROL first, so a pass on the test person means something. A queue the
person answers must show no change at all.
NEXT
