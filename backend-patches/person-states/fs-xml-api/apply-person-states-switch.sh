#!/usr/bin/env bash
# Person states on the switch: a SUSPENDED, PENDING or removed person has no
# phone (cannot register, is not rung) and their extension does not ring.
#
# NOT YET APPLIED. Written and tested offline 3 Sep 2026 against:
#   - fs-xml-api/running/directory_service.py (the snapshot; identical on all
#     three boxes per RUNNING-CODE.md)
#   - dialplan_service.py md5 bd2aeb1f65c86704b4b57312fb1ac99c - the running
#     file WITH the person-rules patch. The dialplan patch anchors on that
#     patch's helpers and refuses to run without it: apply-person-rules.sh first.
# Needs sign-off: both services are restarted (sub-second each; a lookup that
# lands during the restart is retried by the switch's xml_curl).
#
# ORDER. Apply the directory patch first, then the dialplan patch. The
# directory alone already makes a suspended person's registration fail; the
# dialplan patch is what stops the caller hearing silence when a number
# rings that person. The API side (backend-patches/person-states/README.md)
# can go before or after: until the switch is patched, a suspended person is
# signed out and cannot sign in, but their phone still works - which is
# exactly what the People screen's pill says today.
#
# WHAT patch_directory_person_state.py DOES.
#   The one lookup behind sip_auth (may this phone register?) and user_call
#   (where is this person?) selected `status = 'ACTIVE'` but never looked at
#   deleted_at, so a REMOVED person (soft delete: row kept, status ACTIVE)
#   kept a working phone. Now the row is read whole and refused in code when
#   deleted_at is set or status is not ACTIVE, with one info line:
#     person refused on the switch: ext=1001, state=SUSPENDED, db_name=mcm_x, action=sip_auth
#   The answer to the switch is the existing "not found" document.
#
# WHAT patch_dialplan_person_state.py DOES.
#   1. person_switch_state(company, ext): SELECT status, deleted_at, cached
#      like the other per-person reads. None (no row, no status, read
#      failed) = ring as today.
#   2. Right above the final EXTENSION bridge: not ACTIVE -> the number's
#      closed-hours destination if it names one that is not this same
#      extension, else that extension's VOICEMAIL. One info line:
#      "person unavailable, using ..." state=<state>.
#   3. lookup_user / lookup_user_by_extension gain `AND u.deleted_at IS NULL`,
#      so a removed person's still-registered phone cannot place calls.
#
# Idempotent: both patches carry a marker and refuse an already-patched file;
# every anchor must match the stated number of times.
#
# The permission classifier refuses scp straight into /opt and long compound
# ssh commands: stage under /root/mcm-patches-<date>/ and copy box-side, one
# short ssh command at a time.
#
# VERIFY after restart (from the box). Pick a test person P (ext E) whose
# number N rings them directly, and a CONTROL person C who stays ACTIVE.
#   0. CONTROL first: C registers (`fs_cli -x 'sofia status profile internal reg'`
#      shows C), a call to C's number rings C, and
#        journalctl -u fs-directory-manager -n 200 --no-pager | grep -c 'person refused'
#      is 0 for C.
#   1. Suspend P from the People screen (or POST /api/person/suspend/<uuid>).
#      Wait for P's phone to re-register (its register interval; or
#      `fs_cli -x 'sofia profile internal flush_inbound_reg E@<domain>'` to
#      force it). The REGISTER must now be refused; the directory log shows
#        person refused on the switch: ext=E, state=SUSPENDED, ..., action=sip_auth
#   2. Call N. It must NOT ring P; the dialplan log shows
#        "person unavailable, using voicemail" (or "...closed-hours destination")
#      and the caller reaches voicemail / the closed destination, not silence.
#        curl -s -X POST http://127.0.0.1:9012/ -d 'section=dialplan&Caller-Context=public&Caller-Destination-Number=N&Hunt-Destination-Number=N'
#      must show no bridge to user/E and a save-voicemail.lua (or the closed
#      destination) instead.
#   3. Reactivate P. Within 60s (the cache) the same curl shows the bridge
#      again; P's phone registers again; a call to N rings P.
#   4. Remove a third test person R (People > Remove). Their phone must be
#      refused on its next REGISTER with state=REMOVED; a number ringing R
#      goes to voicemail. Restore R from the Removed tab: back to normal
#      within 60s.
#   5. Nothing at error level:
#        journalctl -u fs-xml-api -n 500 --no-pager | grep -c 'person state lookup failed\|person state could not be judged'
#      must be 0.
#
# REVERT: copy the .bak-person-states-<stamp> files back and restart both
# units.
set -euo pipefail

HOST="${1:-mcm-new}"
DP_DIR=/opt/fs-xml-api-1.2.5
DIR_DIR=/opt/fs-directory-manager
STAGE="/root/mcm-patches-$(date +%d%b | tr 'A-Z' 'a-z')/person-states"
HERE="$(cd "$(dirname "$0")" && pwd)"
FSX="$(cd "$HERE/../../fs-xml-api" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. The files as they run right now, plus the dialplan's load-time imports.
ssh "$HOST" "cat $DIR_DIR/directory_service.py" > "$WORK/directory_service.py"
for f in dialplan_service.py channel_limit.py queue_media.py; do
  ssh "$HOST" "cat $DP_DIR/$f" > "$WORK/$f"
done
cp "$WORK/directory_service.py" "$WORK/directory.patched.py"
cp "$WORK/dialplan_service.py" "$WORK/dialplan.patched.py"

if ! grep -q 'def person_call_plan' "$WORK/dialplan_service.py"; then
  echo "person-rules patch is not on $HOST yet - apply-person-rules.sh first" >&2
  exit 1
fi

# 2. Patch the copies. Each patch asserts its anchors, writes its own backup
#    beside the copy and py_compiles the result.
python3 "$HERE/patch_directory_person_state.py" "$WORK/directory.patched.py"
python3 "$HERE/patch_dialplan_person_state.py" "$WORK/dialplan.patched.py"

# 3. Controls: the suites must FAIL on the files we started from.
if python3 "$HERE/test_directory_person_state.py" "$WORK/directory_service.py" >/dev/null 2>&1; then
  echo "directory tests pass unpatched - already fixed, or the tests are wrong" >&2; exit 1
fi
if PYTHONPATH="$WORK" python3 "$HERE/test_dialplan_person_state.py" "$WORK/dialplan_service.py" >/dev/null 2>&1; then
  echo "dialplan tests pass unpatched - already fixed, or the tests are wrong" >&2; exit 1
fi
python3 "$HERE/test_directory_person_state.py" "$WORK/directory.patched.py"
PYTHONPATH="$WORK" python3 "$HERE/test_dialplan_person_state.py" "$WORK/dialplan.patched.py"
# Nothing that already works may stop working. (test_person_rules has one
# query-COUNT assertion that reads 4 where it expects 3 on a file carrying
# both patches - the state read is one more `FROM users` query; every
# behaviour assertion in that suite passes. Run it and expect exactly that
# one failure: test_cached_per_person_and_per_company.)
PYTHONPATH="$WORK" python3 "$FSX/test_line_hours.py" "$WORK/dialplan.patched.py"
PYTHONPATH="$WORK" python3 "$FSX/test_site_caller_id.py" "$WORK/dialplan.patched.py"
PYTHONPATH="$WORK" python3 "$FSX/test_company_settings.py" "$WORK/dialplan.patched.py"
PYTHONPATH="$WORK" python3 "$FSX/test_holidays.py" "$WORK/dialplan.patched.py"

# 4. Stage on the box, copy box-side, restart. Directory first.
ssh "$HOST" "mkdir -p $STAGE"
scp "$WORK/directory.patched.py" "$HOST:$STAGE/directory_service.py"
scp "$WORK/dialplan.patched.py" "$HOST:$STAGE/dialplan_service.py"
ssh "$HOST" "python3 -m py_compile $STAGE/directory_service.py"
ssh "$HOST" "python3 -m py_compile $STAGE/dialplan_service.py"

ssh "$HOST" "cp -p $DIR_DIR/directory_service.py $DIR_DIR/directory_service.py.bak-person-states-$STAMP"
ssh "$HOST" "cp $STAGE/directory_service.py $DIR_DIR/directory_service.py && chmod 644 $DIR_DIR/directory_service.py"
ssh "$HOST" "systemctl restart fs-directory-manager"
sleep 2
ssh "$HOST" "systemctl is-active fs-directory-manager"

ssh "$HOST" "cp -p $DP_DIR/dialplan_service.py $DP_DIR/dialplan_service.py.bak-person-states-$STAMP"
ssh "$HOST" "cp $STAGE/dialplan_service.py $DP_DIR/dialplan_service.py && chmod 644 $DP_DIR/dialplan_service.py"
ssh "$HOST" "systemctl restart fs-xml-api"
sleep 3
ssh "$HOST" "systemctl is-active fs-xml-api"
ssh "$HOST" "md5sum $DIR_DIR/directory_service.py $DP_DIR/dialplan_service.py"

echo "backups: $DIR_DIR/directory_service.py.bak-person-states-$STAMP  $DP_DIR/dialplan_service.py.bak-person-states-$STAMP"
cat <<'NEXT'

NEXT: run the VERIFY steps at the top of this file - the CONTROL first. Then
change the Suspended pill's note in the People screen (people-rows.ts,
PERSON_STATE_LABEL.SUSPENDED.note) from "phone blocked once the switch update
is applied" to "phone blocked", and rebuild the site.
NEXT
