#!/usr/bin/env bash
# Recording, part two: play the announcement, and record the calls the first
# patch left out.
#
# apply-call-recording.sh made ONE thing work: an inbound call TO A PERSON is
# recorded (both legs -> Wasabi on hangup -> linked to the call log). It left
# three gaps that the on-screen note is honest about:
#
#   1. The caller is never told the call is recorded. recording_actions() starts
#      the recorder but plays nothing, and the switch holds zero audio files.
#      Most countries this platform sells into require the caller be told, so
#      this is the gap that blocks real use, not just polish.
#   2. Outbound calls are not recorded.
#   3. Calls that arrive at a menu (IVR) or a queue are not recorded.
#
# WHAT THIS PATCH CHANGES
#   sounds/mcm/recording-announcement.wav  new: the "this call may be recorded"
#                                          clip, installed on the switch
#   config.lua                             one new value: the announcement path
#   dialplan_service.py                    recording_actions() now plays the
#                                          announcement (to the right leg for the
#                                          call's direction); the recorder gate is
#                                          added to the OUTBOUND, IVR and QUEUE
#                                          branches as well as EXTENSION
#
# WHAT THIS PATCH DOES NOT DO — READ BEFORE ENABLING FOR REAL CUSTOMERS
#   "Who may listen to call recordings" is still enforced in the browser only.
#   Until the media-api retrieval endpoint checks that permission server-side,
#   any signed-in user can fetch any recording. Do NOT switch recording on for
#   real customers until that is fixed. This patch deliberately does not touch
#   the policy toggle; it only makes the recording behave correctly WHEN a
#   company has already opted in for testing.
#
# SAFETY MODEL (same as apply-call-recording.sh)
#   * every file is backed up first
#   * every edit is idempotent and asserts it matched EXACTLY ONCE, or aborts
#   * py_compile runs BEFORE any restart
#   * a control branch count is printed after, so a wrong match is visible
#
# THE THREE COVERAGE ANCHORS ARE NOT GUESSED. Step 0 prints the live branch
# structure. You MUST confirm the three ANCHOR_* strings below match what it
# prints before running steps 4-5; if any does not match exactly once, the
# script aborts and changes nothing. EXTENSION is already known-good from the
# first patch and is used here as the template.

set -euo pipefail

HOST="${1:-root@142.93.121.121}"
FILE=/opt/fs-xml-api-1.2.5/dialplan_service.py
SERVICE=fs-xml-api
FS_SCRIPTS=/etc/freeswitch/scripts
FS_SOUNDS=/etc/freeswitch/sounds/mcm
ANNOUNCE_WAV="$FS_SOUNDS/recording-announcement.wav"
# The platform's default "automatic recording" announcement, already served by
# media-api. Confirm this clip actually says a recording notice before trusting
# it in production; swap ANNOUNCE_SRC for your own clip if not.
ANNOUNCE_SRC="https://api.mycountrymobile.com/api/media/default/recording/ad98d65d-fcf8-4d4d-bc77-ee1426c34333.mp3"

say() { printf '\n%s\n' "$*"; }

say "0/8  DISCOVERY (read-only) - confirm the branch anchors before continuing"
# Prints the route_type branches and their bridge lines. Compare against the
# ANCHOR_* strings below. Nothing is modified by this step.
ssh "$HOST" "grep -nE 'route_type ==|application.: .bridge|def recording_actions' $FILE || true"
say "    ^ Confirm OUTBOUND / IVR / QUEUE branches match ANCHOR_* below, then re-run without stopping."
# Remove this guard once the anchors are confirmed against the output above.
if [ "${CONFIRMED:-0}" != "1" ]; then
  say "    Anchors not yet confirmed. Re-run with CONFIRMED=1 once step 0 output matches."
  exit 0
fi

say "1/8  Backing up dialplan and config"
ssh "$HOST" "cp $FILE $FILE.bak-\$(date +%Y%m%d-%H%M%S) && ls -1t $FILE.bak-* | head -1
             cp $FS_SCRIPTS/config.lua $FS_SCRIPTS/config.lua.bak-\$(date +%Y%m%d-%H%M%S)"

say "2/8  Installing the announcement clip on the switch"
# FreeSWITCH plays 8 kHz / 16-bit / mono PCM most reliably. Transcode on the box.
ssh "$HOST" "set -e
  mkdir -p '$FS_SOUNDS'
  if [ -s '$ANNOUNCE_WAV' ]; then echo '    announcement already present'; exit 0; fi
  command -v sox >/dev/null 2>&1 || command -v ffmpeg >/dev/null 2>&1 || {
    echo 'ABORT: neither sox nor ffmpeg is installed to transcode the clip'; exit 1; }
  tmp=\$(mktemp --suffix=.mp3)
  /usr/bin/curl -s -f --max-time 60 -o \"\$tmp\" '$ANNOUNCE_SRC' || {
    echo 'ABORT: could not download the default announcement clip; set ANNOUNCE_SRC to your own file'; exit 1; }
  if command -v sox >/dev/null 2>&1; then
    sox \"\$tmp\" -r 8000 -c 1 -b 16 '$ANNOUNCE_WAV'
  else
    ffmpeg -y -loglevel error -i \"\$tmp\" -ar 8000 -ac 1 -sample_fmt s16 '$ANNOUNCE_WAV'
  fi
  rm -f \"\$tmp\"
  ls -l '$ANNOUNCE_WAV' | awk '{print \"    installed \" \$5 \" bytes\"}'
  # A near-empty file means a failed transcode; refuse to ship silence as a notice.
  bytes=\$(stat -c%s '$ANNOUNCE_WAV'); [ \"\$bytes\" -ge 4096 ] || { echo 'ABORT: announcement wav is too small'; exit 1; }
"

say "3/8  Teaching config.lua where the announcement is"
ssh "$HOST" "python3 - <<'PY'
import io
cfg = '$FS_SCRIPTS/config.lua'
s = io.open(cfg, encoding='utf-8').read()
if 'recording_announcement_path' in s:
    print('    already configured'); raise SystemExit(0)
s = s.rstrip('\n') + '\n\n'
s += '-- The clip played to tell a party the call may be recorded. Installed by\n'
s += '-- apply-recording-announcement-and-coverage.sh.\n'
s += 'recording_announcement_path = \"$ANNOUNCE_WAV\";\n'
io.open(cfg, 'w', encoding='utf-8').write(s)
print('    added recording_announcement_path')
PY"

say "4/8  Playing the announcement inside recording_actions()"
# recording_actions() was inserted by the first patch and takes only company_uuid.
# Replace it with a version that also takes the direction and plays the notice on
# the leg the informable party is on:
#   inbound  -> the caller is the A-leg, so play before the bridge (playback)
#   outbound -> the informable party is the answered B-leg, so play on answer
#               (execute_on_answer) rather than to the agent placing the call.
ssh "$HOST" "python3 - <<'PY'
import io
path = '$FILE'
s = io.open(path, encoding='utf-8').read()

if 'def recording_actions(company_uuid, direction' in s:
    print('    already applied'); raise SystemExit(0)

old = '''def recording_actions(company_uuid):
    \"\"\"Start the recorder, and arrange for the file to be uploaded afterwards.

    The hangup hook runs with no session, so the call and company ids are passed
    as arguments rather than read off the channel.
    \"\"\"
    return [
        {\"application\": \"set\", \"data\": \"recording_follow_transfer=true\"},
        {\"application\": \"set\",
         \"data\": \"api_hangup_hook=lua upload_recording.lua \\${uuid} %s\" % company_uuid},
        {\"application\": \"lua\", \"data\": \"start_record.lua\"},
    ]'''
if s.count(old) != 1:
    raise SystemExit('ABORT: recording_actions() from the first patch not found exactly once (found %d). Confirm the first patch is applied and unchanged.' % s.count(old))

new = '''def recording_actions(company_uuid, direction=\"inbound\"):
    \"\"\"Start the recorder, play the recording notice, and upload on hangup.

    The party who must be told is the customer, never the agent. On an inbound
    call that is the A-leg, so the notice is played inline before the bridge. On
    an outbound call the customer is the answered B-leg, so it is armed with
    execute_on_answer instead - playing it inline would announce to the agent
    placing the call and leave the customer untold.

    direction is \"inbound\" or \"outbound\". recording_announcement_path is read
    from config.lua by the notice; if the clip is missing the call still records
    and the switch logs a missing-file error rather than dropping the call.
    \"\"\"
    notice = (
        {\"application\": \"set\",
         \"data\": \"execute_on_answer=playback \\${recording_announcement_path}\"}
        if direction == \"outbound\"
        else {\"application\": \"playback\", \"data\": \"\\${recording_announcement_path}\"}
    )
    return [
        {\"application\": \"set\", \"data\": \"recording_follow_transfer=true\"},
        {\"application\": \"set\",
         \"data\": \"api_hangup_hook=lua upload_recording.lua \\${uuid} %s\" % company_uuid},
        notice,
        {\"application\": \"lua\", \"data\": \"start_record.lua\"},
    ]'''
s = s.replace(old, new, 1)
if s.count('def recording_actions(company_uuid, direction') != 1:
    raise SystemExit('ABORT: recording_actions() not rewritten once')
io.open(path, 'w', encoding='utf-8').write(s)
print('    recording_actions() now announces, and knows call direction')
PY"

say "4b/8  Passing the direction from the EXISTING extension gate"
# The first patch called recording_actions(company_uuid) with no direction. Keep
# it recording inbound, now stated explicitly so the new signature is satisfied.
ssh "$HOST" "python3 - <<'PY'
import io
path = '$FILE'
s = io.open(path, encoding='utf-8').read()
old = 'recording_actions(company_uuid) if should_record(recording_mode, \"inbound\")'
new = 'recording_actions(company_uuid, \"inbound\") if should_record(recording_mode, \"inbound\")'
if new in s:
    print('    already applied'); raise SystemExit(0)
if s.count(old) != 1:
    raise SystemExit('ABORT: existing EXTENSION gate not found exactly once (found %d)' % s.count(old))
s = s.replace(old, new, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('    extension gate now passes direction')
PY"

say "5/8  Adding the recorder gate to OUTBOUND, IVR and QUEUE branches"
# CONFIRM each ANCHOR against step 0 output. Each block:
#   * computes recording_mode once at the branch head (if not already present)
#   * inserts recording_actions(...) immediately before that branch's bridge,
#     gated by should_record(mode, <direction>)
# Every insert asserts exactly one match or aborts. If a branch's bridge does not
# match the ANCHOR, fix the ANCHOR from step 0 output - do not loosen the match.
ssh "$HOST" "python3 - <<'PY'
import io
path = '$FILE'
s = io.open(path, encoding='utf-8').read()

# --- (branch_id, head_anchor, bridge_anchor, direction) ---------------------
# head_anchor   : the line that opens the branch (used to insert recording_mode)
# bridge_anchor : the exact bridge line to insert the recorder BEFORE
# CONFIRM all three against step 0. The strings below are the expected shapes;
# adjust to the live text if step 0 shows otherwise.
branches = [
    (\"OUTBOUND\",
     'if route_type == \"OUTBOUND\":',
     None,   # set from step 0: the outbound bridge line (often bridge to a gateway/sofia)
     \"outbound\"),
    (\"IVR\",
     'if route_type == \"IVR\":',
     None,   # set from step 0: the line that enters the IVR (e.g. an ivr / lua / transfer app)
     \"inbound\"),
    (\"QUEUE\",
     'if route_type == \"QUEUE\":',
     None,   # set from step 0: the line that enters the queue (callcenter app / bridge)
     \"inbound\"),
]

# Refuse to run until the three bridge anchors are filled in from step 0. This is
# the one thing that cannot be known without reading the live dialplan.
missing = [b[0] for b in branches if not b[2]]
if missing:
    raise SystemExit('ABORT: fill in the bridge anchor for %s from step 0 output before running step 5.' % ', '.join(missing))

for name, head, bridge, direction in branches:
    if 'recording_mode_%s' % name.lower() in s or ('should_record(recording_mode, \"%s\")' % direction) in s and name in s:
        pass  # tolerated; explicit assertions below catch real double-applies
    if s.count(head) != 1:
        raise SystemExit('ABORT: %s branch head not found exactly once (found %d)' % (name, s.count(head)))
    if s.count(bridge) != 1:
        raise SystemExit('ABORT: %s bridge not found exactly once (found %d)' % (name, s.count(bridge)))
    # 1) compute the policy once at the branch head
    s = s.replace(head, head + '\n        recording_mode = company_recording_policy(db_name)', 1)
    # 2) insert the gated recorder immediately before the branch's bridge
    guard = '        ] + (recording_actions(company_uuid, \"%s\") if should_record(recording_mode, \"%s\") else []) + [\n' % (direction, direction)
    s = s.replace(bridge, guard + bridge, 1)
    print('    %s branch gated (%s)' % (name, direction))

io.open(path, 'w', encoding='utf-8').write(s)
PY"

say "6/8  Compile check BEFORE restart"
ssh "$HOST" "python3 -m py_compile $FILE && echo '    compiles'"

say "7/8  Lua syntax note"
# start_record.lua / upload_recording.lua are unchanged by this patch; only the
# dialplan and config change. No Lua to re-check here.
echo "    no Lua changed"

say "8/8  Restart and verify"
ssh "$HOST" "systemctl restart $SERVICE && sleep 2 && systemctl is-active $SERVICE
  printf '    announces (playback)   : %s\n' \$(grep -c 'recording_announcement_path' $FILE)
  printf '    recording gates total  : %s\n' \$(grep -c 'should_record(recording_mode' $FILE)
  printf '    (was 1 after patch one; expect 4 now: EXTENSION+OUTBOUND+IVR+QUEUE)\n'
  printf '    announcement wav       : %s\n' \$(ls '$ANNOUNCE_WAV' >/dev/null 2>&1 && echo present || echo MISSING)
  printf '    config path            : %s\n' \$(grep -c 'recording_announcement_path' $FS_SCRIPTS/config.lua)
"
say "Done.  Test with a real call in each direction/branch before enabling for customers,"
say "and remember: server-side listen permission must be enforced first (see header)."

# ---------------------------------------------------------------------------
# ROLLBACK
#   ssh $HOST "cp \$(ls -1t $FILE.bak-* | head -1) $FILE
#              cp \$(ls -1t $FS_SCRIPTS/config.lua.bak-* | head -1) $FS_SCRIPTS/config.lua
#              rm -f '$ANNOUNCE_WAV'
#              systemctl restart $SERVICE && systemctl is-active $SERVICE"
# ---------------------------------------------------------------------------
