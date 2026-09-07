#!/usr/bin/env bash
# Send an email when somebody leaves a voicemail.
#
# NOT YET APPLIED. Written and tested 1 Sep 2026; uploading to the switch was
# blocked by a permission rule in the session that wrote it. The card on
# Company > Ringing & voicemail says so in its note rather than promising mail
# that does not arrive.
#
# WHAT WAS ALREADY THERE, so this is one hop and not a project:
#
#   * notification-api runs on the switch and answers
#     POST 127.0.0.1:3002/api/v1/send-email  { email, subject, body }
#     Verified live: an empty body returns 422 "Email is a required".
#     Bound to loopback, so the switch can call it and nothing off-box can.
#   * Its SMTP is configured against Gmail (smtp.gmail.com:587), sending as
#     notifications@mycountrymobile.com.
#   * voicemail_save() in functions.lua already holds everything the mail needs
#     by the time the caller hangs up.
#
# THE MISSING HOP: voicemail_save() writes the file and stops. It tells nothing
# that a message arrived.
#
# TWO HALVES, and the split matters:
#
#   dialplan_service.py  decides WHO the mail goes to and puts the answer on the
#                        channel as `vm_notify_email` / `vm_notify_attach`. It
#                        has the database connection, the cache and every other
#                        company setting read on the call path, so the decision
#                        belongs there - and it is covered by 11 tests in
#                        test_vm_email.py.
#
#   voicemail-email.lua  looks nothing up. It reads those two variables and
#                        makes one request. An earlier draft did the lookup in
#                        lua and needed an HTTP endpoint that does not exist.
#
# It cannot fail a call: every step wrapped, curl times out in 5 seconds, errors
# logged and swallowed. The caller has already gone by then.
#
# ATTACHMENTS ARE NOT SENT, even when the card asks for one. /send-email takes
# only { email, subject, body } - there is no attachment field. The lua logs that
# it was asked and sends the notice without the audio. Honouring it means
# extending notification-api and rebuilding it, which is not something to smuggle
# in here.
set -euo pipefail

HOST="${1:-mcm-new}"
CONTAINER=mcm-freeswitch
SCRIPTS=/etc/freeswitch/scripts
DIR=/opt/fs-xml-api-1.2.5
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------- 1. dialplan
ssh "$HOST" "cat $DIR/dialplan_service.py" > "$WORK/dialplan_service.py"
cp "$WORK/dialplan_service.py" "$WORK/patched.py"

if grep -q voicemail_notify_actions "$WORK/dialplan_service.py"; then
  echo "already applied - dialplan_service.py already resolves the recipient" >&2
  exit 1
fi

python3 "$HERE/patch_vm_email.py" "$WORK/patched.py"
python3 -m py_compile "$WORK/patched.py"

# The control matters as much as the pass: the suite must fail on the file we
# started from, or the patch is not doing what it claims.
if python3 "$HERE/test_vm_email.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "the tests pass unpatched - already fixed, or the tests are wrong" >&2
  exit 1
fi
python3 "$HERE/test_vm_email.py" "$WORK/patched.py"
# Nothing else on the call path may move.
python3 "$HERE/test_holidays.py" "$WORK/patched.py"

# ------------------------------------------------------------------- 2. lua
luac5.1 -p "$HERE/voicemail-email.lua" 2>/dev/null || echo "note: no luac5.1 here, lua not syntax checked"

# ---------------------------------------------------------------- 3. install
scp "$WORK/patched.py" "$HOST:$DIR/dialplan_service.py.new"
scp "$HERE/voicemail-email.lua" "$HOST:/tmp/voicemail-email.lua"

ssh "$HOST" "set -e
  cd $DIR
  cp -p dialplan_service.py dialplan_service.py.bak-vmemail-$STAMP
  python3 -m py_compile dialplan_service.py.new
  mv dialplan_service.py.new dialplan_service.py
  chmod 644 dialplan_service.py

  docker cp /tmp/voicemail-email.lua $CONTAINER:$SCRIPTS/voicemail-email.lua
  rm -f /tmp/voicemail-email.lua

  docker exec $CONTAINER cp -p $SCRIPTS/functions.lua $SCRIPTS/functions.lua.bak-vmemail-$STAMP

  # The require, and the one call. Inserted after the line that decides the
  # message is worth keeping, so a hang-up under 3 seconds never sends mail.
  docker exec $CONTAINER python3 - <<'PY'
import io
p = '/etc/freeswitch/scripts/functions.lua'
t = io.open(p, encoding='utf-8').read()

if 'voicemail_email' in t:
    raise SystemExit('already applied - functions.lua already calls voicemail_email')

OLD = '''        if(tonumber(message_length) >= 3) then
            session:setVariable(\"is_voicemail\",\"Y\");'''
NEW = '''        if(tonumber(message_length) >= 3) then
            session:setVariable(\"is_voicemail\",\"Y\");
            -- Never allowed to fail the call: the caller has already hung up.
            pcall(voicemail_email, session,
                  session:getVariable(\"vm_target_extension\"),
                  session:getVariable(\"effective_caller_id_number\"),
                  message_length, vm_msgfile);'''

if t.count(OLD) != 1:
    raise SystemExit('no single match for the insertion point (found %d)' % t.count(OLD))

t = t.replace(OLD, NEW)
t = 'require(\"voicemail-email\");\n' + t
io.open(p, 'w', encoding='utf-8').write(t)
print('functions.lua patched')
PY

  systemctl restart fs-xml-api
  sleep 3
  systemctl is-active fs-xml-api
  docker exec $CONTAINER fs_cli -x 'reloadxml' | head -1
"

echo
echo "backups:"
echo "  $DIR/dialplan_service.py.bak-vmemail-$STAMP"
echo "  (in container) $SCRIPTS/functions.lua.bak-vmemail-$STAMP"
echo
cat <<'NEXT'
VERIFY, in this order:
  1. turn the card on at Company > Ringing & voicemail and save
  2. leave a real voicemail on a test extension, longer than 3 seconds
  3. docker exec mcm-freeswitch fs_cli -x 'console loglevel info'
     and watch for "[voicemail-email] sent to ..."
  4. confirm the mail arrives
  5. leave a 1-second message and confirm NOTHING is sent

Then swap the card's amber note for a plain one and redeploy the site.
NEXT
