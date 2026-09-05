#!/usr/bin/env bash
#
# Give callers on hold something to listen to.
#
# PARTLY APPLIED 1 Sep 2026 13:1x on mcm-new. The files are in place and the
# config is repointed. The last step - reloading the module - was refused by a
# permission rule in the session that did the rest, so THE STREAM IS NOT RUNNING
# YET. One command finishes it; it is at the bottom.
#
# WHAT WAS WRONG. A caller held in a queue heard silence. The chain, traced end
# to end rather than guessed:
#
#   the queue record (MongoDB, collection `queues`) sets moh_sound='$${hold_music}'
#     -> global_getvar hold_music                     = local_stream://moh
#       -> local_stream.conf.xml defines moh/8000 at $${sounds_dir}/music/8000
#         -> global_getvar sounds_dir                 = /usr/share/freeswitch/sounds
#           -> find /usr/share/freeswitch/sounds -type f = 0 FILES
#
# Control on that last one: `find /usr/share/freeswitch -type f` returns 287, so
# the search works and the tree exists - there was simply no audio in it.
# `local_stream show` answered `-ERR no reply`: no stream running at all.
#
# CORRECTION to an earlier note of mine: I said the stream name was wrong, `moh`
# versus `default`. It is not. local_stream.conf.xml defines BOTH `default` and
# `moh/8000`, and `local_stream://moh` resolves fine. The only fault was that
# both pointed at a directory with nothing in it.
#
# WHY THE FILES GO IN /etc/freeswitch AND NOT THE SOUNDS DIR. `docker inspect`
# shows the container has exactly two mounts: /etc/freeswitch and
# /opt/call-recordings. $${sounds_dir} is inside the image, so anything put
# there is lost the next time the container is recreated. Hence the config now
# points at an absolute path under the mounted tree.
#
# WHAT WAS DONE
#
#   1. Downloaded freeswitch-sounds-music-8000-1.0.52.tar.gz (14M) from
#      files.freeswitch.org - four classical guitar tracks, the standard pack.
#   2. Extracted to /etc/freeswitch/sounds/music/8000/ (18M on disk).
#      Verified from INSIDE the container: 4 files visible.
#   3. Repointed both stream directories in local_stream.conf.xml from
#      $${sounds_dir}/music/8000 to /etc/freeswitch/sounds/music/8000.
#      Backup: local_stream.conf.xml.bak-moh-<timestamp>
#      Disk after: 19G free of 48G, so 18M is not a concern.
#
# WHAT IS LEFT - run this:
#
#   ssh mcm-new 'docker exec mcm-freeswitch fs_cli -x "reloadxml"'
#   ssh mcm-new 'docker exec mcm-freeswitch fs_cli -x "unload mod_local_stream"'
#   ssh mcm-new 'docker exec mcm-freeswitch fs_cli -x "load mod_local_stream"'
#
# VERIFY - this is the whole test:
#
#   ssh mcm-new 'docker exec mcm-freeswitch fs_cli -x "local_stream show"'
#
#   It currently answers `-ERR no reply`. A pass lists a stream and a file
#   count. Anything else means the path in the config and the files on disk do
#   not agree - check both, do not assume.
#
# REVERT
#
#   ssh mcm-new 'C=/etc/freeswitch/autoload_configs/local_stream.conf.xml
#     cp $(ls -1t $C.bak-moh-* | head -1) $C'
#   then reload as above. The music files are harmless if left in place.
#
# STILL NOT DONE, and it is a separate job. A queue whose admin chose their own
# hold music still will not get it: the DID's QUEUE block carries only
# type/value/label/name/extension - no audio - so the dialplan, which reads
# MySQL, cannot pass the choice through. The natural home for that is the
# queue-agent service, which already reads the MongoDB queue record and which
# callcenter-queue.lua already calls. This change fixes the DEFAULT, so silence
# becomes music for everyone; it does not yet honour a per-queue choice.
