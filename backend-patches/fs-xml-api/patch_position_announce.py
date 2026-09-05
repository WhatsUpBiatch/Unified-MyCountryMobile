#!/usr/bin/env python3
"""Tell a waiting caller where they are in the line.

The queue editor has offered "Tell them where they are in the line" for a
while. It stored the admin's choice and nothing read it - the dialplan never
told the switch, and the switch never counted anybody. This is the dialplan
half: read `settings.waiting.announce_position` off the queue record and hand
it to the queue script as a channel variable, the same way ring strategy,
wrap-up and the caller cap already travel.

The counting and the speaking live in callcenter-queue.lua (see
backend-patches/freeswitch/patch_position_announce.py). This file only says
whether the queue wants it, and how often.

Idempotent: running it twice changes nothing the second time.
"""
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "/opt/fs-xml-api-1.2.5/queue_media.py"
src = open(PATH).read()

if "ANNOUNCE_POSITION_VARIABLE" in src:
    print("already applied")
    sys.exit(0)

# 1. The queue record must carry the waiting block, or there is nothing to read.
old = '''             "settings.operational_hours": 1,
             "company_uuid": 1},'''
new = '''             "settings.operational_hours": 1,
             "settings.waiting": 1,
             "company_uuid": 1},'''
assert src.count(old) == 1, "queue_record projection anchor"
src = src.replace(old, new)

# 2. Constants beside the ones they belong with.
old = 'MAX_CALLERS_VARIABLE = "cc_max_callers"\n'
new = '''MAX_CALLERS_VARIABLE = "cc_max_callers"

# "You are caller number N" while somebody waits. The script counts the line
# with mod_hash and speaks the number from files under /etc/freeswitch/sounds;
# all the dialplan says is whether this queue wants it and how often.
ANNOUNCE_POSITION_VARIABLE = "cc_announce_position"
ANNOUNCE_INTERVAL_VARIABLE = "cc_announce_interval"
# Between the first and second announcement, and each one after. Under thirty
# seconds it is nagging; over a few minutes the caller has forgotten they were
# told.
ANNOUNCE_INTERVAL_DEFAULT = 60
ANNOUNCE_INTERVAL_MIN = 30
ANNOUNCE_INTERVAL_MAX = 600
'''
assert src.count(old) == 1, "constants anchor"
src = src.replace(old, new)

# 3. Read the setting, and emit it with the other behaviour variables.
old = '''    callers = queue_max_callers(queue)
    if callers:
        actions.append({"application": "set", "data": "%s=%d" % (MAX_CALLERS_VARIABLE, callers)})
    return actions
'''
new = '''    callers = queue_max_callers(queue)
    if callers:
        actions.append({"application": "set", "data": "%s=%d" % (MAX_CALLERS_VARIABLE, callers)})
    interval = queue_announce_interval(queue)
    if interval:
        actions.append({"application": "set", "data": "%s=1" % ANNOUNCE_POSITION_VARIABLE})
        actions.append({"application": "set", "data": "%s=%d" % (ANNOUNCE_INTERVAL_VARIABLE, interval)})
    return actions


def queue_announce_position(queue):
    """True when this queue's admin switched on "tell them where they are"."""
    if not isinstance(queue, dict):
        return False
    settings = queue.get("settings")
    waiting = settings.get("waiting") if isinstance(settings, dict) else None
    if not isinstance(waiting, dict):
        return False
    return waiting.get("announce_position") is True


def queue_announce_interval(queue):
    """Seconds between position announcements, or 0 when the queue does not want them.

    The screen has no interval control of its own; the repeating-message
    interval is reused when one is set, because a caller who is told their
    place and played a reminder on two different clocks hears a muddle. Bounds
    are clamped rather than refused, as everywhere else in this file.
    """
    if not queue_announce_position(queue):
        return 0
    settings = queue.get("settings") if isinstance(queue, dict) else None
    media = settings.get("media") if isinstance(settings, dict) else None
    block = media.get("delay") if isinstance(media, dict) else None
    raw = block.get("interval_seconds") if isinstance(block, dict) else None
    try:
        seconds = int(raw)
    except (TypeError, ValueError):
        return ANNOUNCE_INTERVAL_DEFAULT
    if seconds < ANNOUNCE_INTERVAL_MIN:
        return ANNOUNCE_INTERVAL_MIN
    if seconds > ANNOUNCE_INTERVAL_MAX:
        return ANNOUNCE_INTERVAL_MAX
    return seconds
'''
assert src.count(old) == 1, "behaviour actions anchor"
src = src.replace(old, new)

open(PATH, "w").write(src)
print("patched", PATH)
