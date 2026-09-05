#!/usr/bin/env bash
#
# "You are caller number N" - dialplan half.
#
# APPLIED 2 Sep 2026 19:00 on mcm-new (backup queue_media.py.bak-position-20260902-190054).
# Prepared 2 Sep 2026. Needs sign-off: fs-xml-api builds the
# dialplan for every inbound call and is restarted here (sub-second; a call
# arriving during the restart is retried by the switch's xml_curl).
#
# Reads settings.waiting.announce_position off the queue record and sets
# cc_announce_position / cc_announce_interval for the queue script. Does
# nothing for a queue that has not switched it on. The switch half is
# ../freeswitch/apply-position-announce.sh; apply that one first so the
# script is ready when the variable arrives (harmless either way - the script
# ignores a variable it does not know, and the dialplan sets nothing when the
# record has no `waiting` block).
#
# VERIFY: ask the running service for a queue number's dialplan and look for
# the variable:
#   curl -s -X POST http://127.0.0.1:8081/ -d 'section=dialplan&Caller-Destination-Number=<DID>&Hunt-Destination-Number=<DID>&Caller-Context=public' \
#     | grep -o 'cc_announce_[a-z]*=[0-9]*'
#   -> cc_announce_position=1 and cc_announce_interval=<n> for a queue with
#      the switch on; CONTROL: nothing for a queue with it off.
#   (port and fields: check `grep -n listen /opt/fs-xml-api-1.2.5/.env` first)
#
# REVERT: cp queue_media.py.bak-<stamp> back, systemctl restart fs-xml-api.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET=/opt/fs-xml-api-1.2.5/queue_media.py
STAMP=$(date +%Y%m%d-%H%M%S)

test -f "$TARGET"
cp -a "$TARGET" "$TARGET.bak-position-$STAMP"
echo "backup: $TARGET.bak-position-$STAMP"
python3 "$HERE/patch_position_announce.py" "$TARGET"
python3 -m py_compile "$TARGET"
( cd /opt/fs-xml-api-1.2.5 && python3 queue_media_test.py | tail -1 )
systemctl restart fs-xml-api
sleep 1
systemctl is-active fs-xml-api
