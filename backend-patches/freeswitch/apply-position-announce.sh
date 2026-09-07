#!/usr/bin/env bash
#
# "You are caller number N" - switch half.
#
# APPLIED 2 Sep 2026 19:03 on mcm-new by hand, step by step (backup callcenter-queue.lua.bak-position-20260902-190353; 104 prompts in place).
# Prepared 2 Sep 2026. Needs sign-off: callcenter-queue.lua
# runs for every queue call. FreeSWITCH reads it fresh per call, so there is
# no restart - the next queue call runs the new script. A syntax error would
# break every queue call, which is why the script is checked twice below,
# once locally and once by FreeSWITCH itself.
#
# Puts the recorded prompts under /etc/freeswitch/sounds/mcm/queue (the one
# tree the container can see, and the one that survives it being recreated)
# and patches the script. Run from the web box with the prompts rendered
# (see sounds/make-prompts.sh); it copies them over.
#
# VERIFY: the next call into a queue with the setting on, with one other
# caller already waiting, hears "You are caller number 2 ..." about ten
# seconds after joining, then every <interval> seconds. In the switch log:
#   docker logs mcm-freeswitch 2>&1 | grep "Told caller"
# CONTROL: a queue with the setting off logs no such line and the caller
# hears exactly what they heard before.
# The line itself can be watched live:
#   docker exec mcm-freeswitch fs_cli -x "hash_dump db queue_line_<queue id>"
#
# REVERT: cp callcenter-queue.lua.bak-position-<stamp> back. Nothing to restart.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOST=${1:-mcm-new}
PROMPTS="$HERE/sounds/deploy"
SCRIPT=/etc/freeswitch/scripts/callcenter-queue.lua
STAMP=$(date +%Y%m%d-%H%M%S)

test -d "$PROMPTS/digits" || { echo "render the prompts first: $HERE/sounds/make-prompts.sh"; exit 1; }
test "$(ls "$PROMPTS/digits" | wc -l)" -eq 100

# 1. prompts
ssh "$HOST" "mkdir -p /etc/freeswitch/sounds/mcm/queue/digits"
rsync -a "$PROMPTS/" "$HOST:/etc/freeswitch/sounds/mcm/queue/"
ssh "$HOST" 'docker exec mcm-freeswitch ls /etc/freeswitch/sounds/mcm/queue/digits | wc -l'   # must print 100 from INSIDE the container

# 2. script, checked before it goes live
scp -q "$HOST:$SCRIPT" "/tmp/callcenter-queue.$STAMP.lua"
python3 "$HERE/patch_position_announce.py" "/tmp/callcenter-queue.$STAMP.lua"
luac -p "/tmp/callcenter-queue.$STAMP.lua"
ssh "$HOST" "cp -a $SCRIPT $SCRIPT.bak-position-$STAMP"
scp -q "/tmp/callcenter-queue.$STAMP.lua" "$HOST:$SCRIPT"
ssh "$HOST" "chmod 755 $SCRIPT"
# FreeSWITCH's own parse: a complaint that `session` is nil means it compiled.
ssh "$HOST" 'docker exec mcm-freeswitch fs_cli -x "luarun /etc/freeswitch/scripts/callcenter-queue.lua"' | head -3
echo "backup on $HOST: $SCRIPT.bak-position-$STAMP"
