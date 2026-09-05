#!/usr/bin/env bash
# Recording is OFF unless a company's admin turns it on.
#
# APPLIED 1 Sep 2026 11:41 UTC to mcm-new. This file is the record of what was
# done and how to undo it; the edit itself was made inline.
#
# WHY
#
# At 11:09 the same morning a patch made recording the default for every tenant
# (DEFAULT_RECORDING_MODE = "all"). Nobody had opted in. Worse, the recording
# announcement plays but the recorder never starts - the dialplan names its lua
# scripts bare and FreeSWITCH looks for a bare name in
# /usr/share/freeswitch/scripts, which is empty here (all 18 scripts are in
# /etc/freeswitch/scripts). So every caller on every tenant was told the call
# was being recorded and no recording was made.
#
# Recording somebody who never asked is the expensive mistake, not missing a
# recording somebody wanted. So the default goes back to off and an admin turns
# it on per company.
#
# THE CHANGE - one constant:
#
#   DEFAULT_RECORDING_MODE = "all"   ->   "off"
#
# This restores exactly the pre-11:09 opt-in semantics. Walk the three paths:
# no settings row -> mode stays "off"; enabled false -> "off"; enabled true with
# a valid value -> that value; enabled true with a blank or unknown value ->
# falls back to the default, now "off".
#
# EVIDENCE IT IS LIVE
#
#   file mtime 11:40:41.541, service started 11:41:08 - a 27s gap, so the
#   running process definitely read the edited file. (The 11:09 patch could not
#   be separated this way; it had to be proved by probing the service.)
#
#   Behavioural probe of the running service, POST 127.0.0.1:9000/v1/dialplan:
#
#     inbound  12135103420  start_record=0  announcement=0  routed=1
#     inbound  14422129488  start_record=0  announcement=0  routed=1
#     inbound  12568081021  start_record=1  announcement=1  routed=2   <- control
#     outbound  (1000 -> +91...)  start_record=0  announcement=0  routed=1
#
#   The `routed` column is the control that the zero is a real "off" and not a
#   broken response - every probe still returns a bridging dialplan.
#
#   12568081021 is TestersCompany2, which has genuinely turned recording on in
#   its own user_template. It is the second control: a zero everywhere would
#   have meant the lookup was broken rather than answering "off".
#
# STILL OPEN AFTER THIS - see F9 in docs/admin-audit-tracker.md
#
#   1. The lua script path. Any company that DOES opt in still hears the
#      announcement and still gets no recording. The same bug is waiting for
#      save-voicemail.lua and callcenter-queue.lua.
#   2. Turning recording on only works if the template is named exactly
#      "Company Default"; the UI lets an admin name it anything.
#   3. Nothing checks server-side who may listen to a recording.
#
#   Do 3 before letting audio actually flow.
#
# REVERT
#
#   ssh root@142.93.121.121 "cp /opt/fs-xml-api-1.2.5/dialplan_service.py.bak-recdefaultoff-20260901-114041 \
#     /opt/fs-xml-api-1.2.5/dialplan_service.py && systemctl restart fs-xml-api"
