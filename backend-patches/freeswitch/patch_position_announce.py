#!/usr/bin/env python3
"""Tell a waiting caller where they are in the line - the switch half.

The dialplan now sets `cc_announce_position=1` and `cc_announce_interval=N`
when a queue's admin has switched the announcement on (see
backend-patches/fs-xml-api/patch_position_announce.py). This teaches
callcenter-queue.lua what to do with them.

How the line is counted. mod_hash is already loaded and already counts this
queue's callers for the cap. Here each waiting caller writes its own entry -
realm `queue_line_<queue id>`, key = the call uuid, value = the second they
joined - and a caller's place is one more than the number of entries that
joined before it. The entry is written when hold audio starts and removed the
moment the caller is offered to an agent, so somebody being rung is not
counted by the people behind them (they are, for all practical purposes,
next). A failed ring puts the caller back with the ORIGINAL join time, so they
keep their place rather than going to the back.

Entries older than the queue's own timeout are ignored and deleted when met.
Nobody legitimately waits longer than the timeout, so an older entry can only
be a call the script never cleaned up after; without this one crash would
leave every later caller hearing a number one too high, for ever.

What is spoken. FreeSWITCH's `say` needs a sound library the switch does not
have, so the numbers are recorded files under /etc/freeswitch/sounds/mcm/queue
(1-100, plus four phrases). Beyond 100 the caller hears a true sentence with
no number in it rather than a wrong number. Played the same way the repeating
message is - broadcast over the hold audio, which is then held off one refresh
so the two do not talk over each other.

Off unless the dialplan says otherwise, and every step fails towards silence:
a missing file, a hash error or an unreadable dump means no announcement, not
a dropped call.

Idempotent. Usage: patch_position_announce.py /etc/freeswitch/scripts/callcenter-queue.lua
Then: luac -p <file> locally, and on the box
  docker exec mcm-freeswitch fs_cli -x "luarun /etc/freeswitch/scripts/callcenter-queue.lua"
  (a complaint about `session` being nil means it compiled - see RUNNING-CODE.md)
"""
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "/etc/freeswitch/scripts/callcenter-queue.lua"
src = open(PATH).read()

if "announce_position" in src:
    print("already applied")
    sys.exit(0)

def replace_once(old, new, what):
    global src
    n = src.count(old)
    if n != 1:
        raise SystemExit("anchor for %s matched %d times, expected 1" % (what, n))
    src = src.replace(old, new)

# 1. Settings and state, beside the other wait-media state.
replace_once(
    '''local agent_lookup_jitter_max_ms = tonumber(session:getVariable("cc_agent_lookup_jitter_ms")) or 120
''',
    '''local agent_lookup_jitter_max_ms = tonumber(session:getVariable("cc_agent_lookup_jitter_ms")) or 120

-- "You are caller number N." On only when the dialplan says this queue wants
-- it. The line is counted in mod_hash so every caller in the queue shares one
-- list; see the header of patch_position_announce.py for the whole design.
local announce_position = (session:getVariable("cc_announce_position") or "") == "1"
local announce_interval = tonumber(session:getVariable("cc_announce_interval")) or 60
if announce_interval < 30 then announce_interval = 30 end
-- The first announcement comes this long after the caller starts waiting: the
-- welcome has only just finished, and a number spoken over it is lost.
local announce_first_after = 10
local announce_last_played = 0
local position_realm = "queue_line_" .. queue_key
local position_joined = os.time()
local position_sounds = "/etc/freeswitch/sounds/mcm/queue/"
local position_max_spoken = 100
local in_line = false

local function join_line()
  if not announce_position or in_line then return end
  local api = freeswitch.API()
  api:executeString(string.format("hash insert/%s/%s/%d", position_realm, caller_uuid, position_joined))
  in_line = true
end

local function leave_line()
  if not announce_position or not in_line then return end
  local api = freeswitch.API()
  api:executeString(string.format("hash delete/%s/%s", position_realm, caller_uuid))
  in_line = false
end

-- One more than the number of callers who joined this queue's line before us.
-- Entries older than the queue timeout are leftovers from a script that never
-- got to clean up, so they are dropped rather than counted.
local function line_position()
  local api = freeswitch.API()
  local dump = api:executeString("hash_dump db " .. position_realm) or ""
  local prefix = "D/" .. position_realm .. "_"
  local now = os.time()
  local stale_after = queue_timeout + 60
  local ahead = 0
  for line in string.gmatch(dump, "[^\\r\\n]+") do
    if string.sub(line, 1, #prefix) == prefix then
      local key, value = string.match(string.sub(line, #prefix + 1), "^([^/]+)/(.*)$")
      local joined = tonumber(value)
      if key and joined and key ~= caller_uuid then
        if (now - joined) > stale_after then
          api:executeString(string.format("hash delete/%s/%s", position_realm, key))
        elseif joined < position_joined or (joined == position_joined and key < caller_uuid) then
          ahead = ahead + 1
        end
      end
    end
  end
  return ahead + 1
end

local function position_media(position)
  if position <= 1 then
    return position_sounds .. "position-next.wav"
  end
  if position > position_max_spoken then
    return position_sounds .. "position-many.wav"
  end
  return string.format("file_string://%sposition-intro.wav!%sdigits/%d.wav!%sposition-outro.wav",
    position_sounds, position_sounds, position, position_sounds)
end
''',
    "state block",
)

# 2. Speak it on the wait-media timer, next to the repeating message.
replace_once(
    '''local function refresh_wait_media()
  -- Before the early returns below: the repeating message is its own recording
  -- on its own timer, and must still play when the hold audio is a blocking
  -- stream or absent entirely.
  play_repeat_media()
''',
    '''-- "You are caller number N", on its own timer. Skipped on a poll where the
-- repeating message has just played, so the caller is never told two things at
-- once. Any failure here is silence, never a dropped call.
local function play_position()
  if not announce_position or not in_line or not session:ready() then
    return
  end

  local now = os.time()
  if announce_last_played == 0 then
    announce_last_played = now - announce_interval + announce_first_after
    return
  end
  if (now - announce_last_played) < announce_interval then
    return
  end
  if repeat_last_played == now then
    return
  end

  local ok, position = pcall(line_position)
  if not ok or not position then
    freeswitch.consoleLog("warn", "Could not count the queue line for [" .. caller_uuid .. "]: " .. tostring(position) .. "\\n")
    announce_last_played = now
    return
  end

  local api = freeswitch.API()
  api:executeString(string.format("uuid_broadcast %s playback::%s aleg", caller_uuid, position_media(position)))
  announce_last_played = now
  wait_media_last_started = now
  freeswitch.consoleLog("notice", "Told caller [" .. caller_uuid .. "] they are number " .. position .. " in queue [" .. queue_key .. "]\\n")
end

local function refresh_wait_media()
  -- Before the early returns below: the repeating message is its own recording
  -- on its own timer, and must still play when the hold audio is a blocking
  -- stream or absent entirely.
  play_repeat_media()
  play_position()
''',
    "refresh hook",
)

# 3. In the line while holding; out of it the moment an agent is tried.
replace_once(
    '''local function start_wait_media()
  if wait_media_active or not session:ready() then
    return
  end
''',
    '''local function start_wait_media()
  join_line()
  if wait_media_active or not session:ready() then
    return
  end
''',
    "start hook",
)
replace_once(
    '''local function stop_wait_media()
  if not wait_media_active then
    return
  end
''',
    '''local function stop_wait_media()
  leave_line()
  if not wait_media_active then
    return
  end
''',
    "stop hook",
)

# 4. Whatever way the script ends, the caller is out of the line.
replace_once(
    '''if session:ready() then
  local result = handle_queue()
''',
    '''if session:ready() then
  local result = handle_queue()
  leave_line()
''',
    "exit hook",
)

open(PATH, "w").write(src)
print("patched", PATH)
