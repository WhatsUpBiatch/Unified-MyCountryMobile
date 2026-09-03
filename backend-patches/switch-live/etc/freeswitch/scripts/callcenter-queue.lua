-- callcenter-queue.lua
-- FreeSWITCH queue handler using fs-callcenter API for agent selection
-- Lua executes when context="queue" in dialplan

require 'config'
require 'functions'
lunajson = require 'lunajson'

-- Get caller info first - handle multiple possible variable names
local caller_uuid = session:getVariable("Unique-ID") or session:getVariable("uuid") or session:getVariable("call_uuid") or "unknown"
local caller_name = session:getVariable("effective_caller_id_name") or session:getVariable("caller_id_name") or "Unknown"
local caller_number = session:getVariable("effective_caller_id_number") or session:getVariable("caller_id_number") or session:getVariable("caller_number") or "unknown"
local channel_uuid = session:getVariable("call-uuid") or session:getVariable("Unique-ID") or session:getVariable("uuid") or "unknown"
local sip_call_id =  session:getVariable("sip_h_X-cid") or "" 
local queue_call_uuid = caller_uuid or channel_uuid or "unknown"
 

local caller_is_vip = nil

if session and session:ready() then
    caller_is_vip = session:getVariable("is_vip") or nil
end

local caller_is_vip_str = caller_is_vip and "true" or "false"

-- Get queue information from FreeSWITCH variables
local queue_uuid = session:getVariable("sip_h_X-Queue") or "unknown"
local queue_name = session:getVariable("cc_queue_name") or "unknown"
local queue_exten = session:getVariable("cc_queue_exten") or "unknown"
local queue_domain = session:getVariable("sip_h_X-Domain") or ""
local queue_did_number = session:getVariable("sip_h_X-DID") or session:getVariable("did_number") or ""
local queue_key = queue_uuid
local queue_forward_name = session:getVariable("forward_name")
  or session:getVariable("sip_h_X-ForwardName")
  or session:getVariable("cc_queue_name")
  or queue_name
  or ""
local original_forward_type = session:getVariable("sip_h_X-ForwardType") or session:getVariable("forward_type") or ""
local original_forward_value = session:getVariable("sip_h_X-ForwardValue") or session:getVariable("forward_value") or ""

-- Mark this call as originating from queue for tracking throughout call lifecycle
session:setVariable("cc_queue_call", "true")
session:setVariable("cc_queue_id", queue_key)

freeswitch.consoleLog("notice", "CALLCENTER QUEUE HANDLER: caller_uuid=[" .. caller_uuid .. "] caller_number=[" .. caller_number .. "] queue_name=[" .. queue_name .. "] queue_uuid=[" .. queue_uuid .. "] queue_key=[" .. queue_key .. "] queue_call_uuid=[" .. tostring(queue_call_uuid or "") .. "] x_cid=[" .. tostring(sip_call_id or "") .. "]\n")

-- Get queue settings from FreeSWITCH variables (set by queue config)
local ring_strategy = session:getVariable("cc_ring_strategy") or "random"
local queue_timeout = tonumber(session:getVariable("cc_queue_timeout")) or 60
local queue_exit_destination = nil
-- Declared here, assigned far below. `wait_for_agents_with_moh` calls this on
-- timeout and it is defined after that function, so without this line the call
-- compiles as a global lookup, finds nil, and the caller is dropped with an
-- error instead of being sent where the queue says to send them.
local take_queue_exit
local no_agent_timeout = tonumber(session:getVariable("cc_no_agent_timeout")) or 5
local call_timeout = tonumber(session:getVariable("cc_call_timeout")) or 45
local configured_hold_media = session:getVariable("cc_hold_music") or session:getVariable("cc_moh_override") or session:getVariable("cc_moh_file") or "ivr-to_wait_stay_on_the_line"
local configured_waiting_media = session:getVariable("cc_waiting_media") or ""
local configured_no_agent_media = session:getVariable("cc_no_agent_available_media") or ""
local configured_all_busy_media = session:getVariable("cc_all_agent_busy_media") or ""
local default_ivr_media_dir = "/usr/share/freeswitch/sounds/en/us/callie/ivr/"

local function resolve_media_file(value, fallback)
  if value == nil or value == "" or value == "moh-filename.wav" then
    return fallback
  end

  local normalized = tostring(value)
  if string.find(normalized, "://", 1, true) or string.sub(normalized, 1, 1) == "/" then
    return normalized
  end

  if not string.find(normalized, "/", 1, true) then
    if not string.find(normalized, "%.[%a%d]+$") then
      normalized = normalized .. ".wav"
    end
    return default_ivr_media_dir .. normalized
  end

  return normalized
end

local hold_media = resolve_media_file(configured_hold_media, default_ivr_media_dir .. "ivr-to_wait_stay_on_the_line.wav")
local waiting_media = resolve_media_file(configured_waiting_media, hold_media)
local no_agent_media = resolve_media_file(configured_no_agent_media, "")
local all_agent_busy_media = resolve_media_file(configured_all_busy_media, "")
-- The tone while an agent's phone rings. This borrowed the waiting message,
-- so the ring tone chosen on the Media tab did nothing at all. It falls back
-- to the waiting message when none is chosen, which is what used to happen
-- for everybody.
local ringback_tone = resolve_media_file(session:getVariable("cc_ring_tone"), waiting_media)

-- The message played over and over while somebody waits, as opposed to the
-- waiting message, which is the hold audio itself. Both were offered on the
-- Media tab and neither the recording nor its interval ever reached here.
local repeat_media = resolve_media_file(session:getVariable("cc_repeat_media"), "")
local repeat_interval = tonumber(session:getVariable("cc_repeat_interval")) or 0
local repeat_last_played = 0

-- Get wrap-up time from FreeSWITCH variable (set by fs-xml-api from queue settings)
-- Default to 15 seconds if not set or 0
local wrapup_time = tonumber(session:getVariable("cc_wrapup_time")) or 0
if wrapup_time <= 0 then
  wrapup_time = 15  -- Default to 15 seconds
end

session:setVariable("hold_music", hold_media)
session:setVariable("cc_hold_music", hold_media)
session:setVariable("cc_moh_override", hold_media)
-- session:execute("export", "nolocal:hold_music=" .. hold_media)
-- session:execute("export", "nolocal:cc_hold_music=" .. hold_media)
-- session:execute("export", "nolocal:cc_moh_override=" .. hold_media)
freeswitch.consoleLog("notice", "QUEUE SETTINGS: ring_strategy=[" .. ring_strategy .. "] queue_timeout=[" .. queue_timeout .. "] call_timeout=[" .. call_timeout .. "] wrapup_time=[" .. wrapup_time .. "] hold_media=[" .. hold_media .. "] waiting_media=[" .. waiting_media .. "] ringback=[" .. ringback_tone .. "]\n")

-- Initialize CDR variables for call tracking
-- cc_cause: tracks call outcome ("offered", "answered", "abandoned")
-- cc_agent_bridged: tracks if agent was successfully bridged ("true" or "false")
-- cc_queue_joined_epoch: timestamp when call entered the queue (Unix epoch)
-- cc_queue_answered_epoch: timestamp when call was answered by agent (Unix epoch)
local current_epoch = os.time()
session:setVariable("cc_cause", "offered")
session:setVariable("cc_agent_bridged", "false")
session:setVariable("cc_queue_joined_epoch", tostring(current_epoch))
session:setVariable("cc_queue_answered_epoch", "0")

-- Function to publish custom callcenter events
local function publish_event(event_type, event_data)
  -- Build event with proper FreeSWITCH event format
  local event_table = {
    ["Event-Subclass"] = "callcenter::queue",
    ["callcenter_event_type"] = tostring(event_type or "unknown"),
    ["queue"] = tostring(queue_key or "unknown"),
    ["queue_uuid"] = tostring(queue_uuid or "unknown"),
    ["queue_name"] = tostring(queue_name or ""),
    ["domain"] = tostring(queue_domain or "default.com"),
    ["did_number"] = tostring(queue_did_number or ""),
    ["member_uuid"] = tostring(caller_uuid or "unknown"),
    ["channel_uuid"] = tostring(channel_uuid or "unknown"),
    ["sip_call_id"] = tostring(sip_call_id or ""), 
    ["caller_number"] = tostring(caller_number or "unknown"),
    ["caller_name"] = tostring(caller_name or "Unknown"),
    ["forward_type"] = "QUEUE",
    ["forward_value"] = tostring(queue_key or ""),
    ["forward_name"] = tostring(queue_forward_name or ""),
    ["is_vip"] = caller_is_vip_str
  }

  -- Add event-specific data
  if event_data then
    for key, value in pairs(event_data) do
      event_table[key] = tostring(value or "")
    end
  end

  -- Fire the event using sendEvent API
  freeswitch.consoleLog("notice", "Publishing custom event: " .. event_type .. "\n")

  -- Create event with proper headers
  local event = freeswitch.Event("CUSTOM", "callcenter::queue")

  -- Add all fields as headers
  for key, value in pairs(event_table) do
    event:addHeader(key, value)
  end

  -- Fire the event
  event:fire()

  freeswitch.consoleLog("notice", "Event fired to ESL: " .. event_type .. " with channel_uuid=[" .. tostring(channel_uuid) .. "] sip_call_id=[" .. tostring(sip_call_id) .. "]\n")
end

local function stamp_queue_bridge_vars(bridge_uuid, answered_epoch, agent_name, agent_extension, agent_display_name)
  if not bridge_uuid or bridge_uuid == "" or bridge_uuid == "unknown" then
    return
  end

  local api = freeswitch.API()
  local bridged_vars = {
    cc_queue_call = "true",
    cc_queue_id = tostring(queue_key or ""),
    cc_queue_name = tostring(queue_name or ""),
    cc_queue_exten = tostring(queue_exten or ""),
    cc_cause = "answered",
    cc_agent_bridged = "true",
    cc_queue_joined_epoch = tostring(current_epoch),
    cc_queue_answered_epoch = tostring(answered_epoch or "0"),
    cc_agent = tostring(agent_extension or ""),
    agent_extension = tostring(agent_extension or ""),
    agent_name = tostring(agent_display_name or "")
  }

  for key, value in pairs(bridged_vars) do
    api:executeString("uuid_setvar " .. bridge_uuid .. " " .. key .. " " .. value)
  end
end

local function resolve_agent_extension(agent)
  if not agent then
    return ""
  end

  local direct_extension = tostring(agent.extension or "")
  if direct_extension ~= "" then
    return direct_extension
  end

  local agent_name = tostring(agent.name or "")
  if agent_name ~= "" then
    local from_name = string.match(agent_name, "^([^@]+)") or agent_name
    from_name = string.gsub(from_name, "_web$", "")
    from_name = string.gsub(from_name, "_hw$", "")
    if from_name ~= "" then
      return from_name
    end
  end

  local agent_contact = tostring(agent.contact or "")
  if agent_contact ~= "" then
    local from_contact =
      string.match(agent_contact, "user/([^@]+)@")
      or string.match(agent_contact, "sip:([^@]+)@")
      or string.match(agent_contact, "^([^@]+)@")
      or ""

    from_contact = string.gsub(from_contact, "_web$", "")
    from_contact = string.gsub(from_contact, "_hw$", "")
    if from_contact ~= "" then
      return from_contact
    end
  end

  return ""
end

-- Function to call fs-callcenter API using HTTP
local function get_available_agents(queue, strategy)
  local url = "http://localhost:9006/api/callcenter/queues/" .. queue .. "/agents"
  local query_params = {}

  if strategy and strategy ~= "" then
    table.insert(query_params, "strategy=" .. urlencode(strategy))
  end
  if queue_call_uuid and queue_call_uuid ~= "" then
    table.insert(query_params, "call_uuid=" .. urlencode(queue_call_uuid))
  end
  if call_timeout and call_timeout > 0 then
    table.insert(query_params, "call_timeout=" .. urlencode(tostring(call_timeout)))
  end
  -- So the service can send a repeat caller back to whoever they spoke to
  -- last, when the queue asks for that.
  if caller_number and caller_number ~= "" and caller_number ~= "unknown" then
    table.insert(query_params, "caller=" .. urlencode(caller_number))
  end
  if #query_params > 0 then
    url = url .. "?" .. table.concat(query_params, "&")
  end

  freeswitch.consoleLog("notice", "Querying fs-callcenter API: " .. url .. " (strategy=[" .. tostring(strategy) .. "] queue_call_uuid=[" .. tostring(queue_call_uuid or "") .. "] x_cid=[" .. tostring(sip_call_id or "") .. "])\n")

  -- Use the curl function from functions.lua which handles HTTP requests properly
  local response = curl(url)

  if not response or string.len(response) == 0 then
    freeswitch.consoleLog("err", "Empty response from fs-callcenter API\n")
    return nil
  end

  freeswitch.consoleLog("notice", "fs-callcenter response: " .. response .. "\n")

  -- Parse JSON response
  local ok, data = pcall(lunajson.decode, response)
  if not ok then
    freeswitch.consoleLog("err", "Failed to parse fs-callcenter response: " .. response .. "\n")
    return nil
  end

  -- The service also says what this queue should do when nobody picks up, and
  -- how long to wait. Both were saved by the product all along and ignored here:
  -- the wait was hardcoded to sixty seconds and the exit was never read, so a
  -- caller was hung up on whatever the queue had been set to do.
  if data.exit and data.exit.type and data.exit.value then
    queue_exit_destination = {
      type = tostring(data.exit.type),
      value = tostring(data.exit.value),
    }
  end
  local told_timeout = tonumber(data.queue_timeout)
  if told_timeout and told_timeout > 0 then
    queue_timeout = told_timeout
  end

  return data.agents or {}
end

-- Seconds the caller and the agent were actually joined. The switch stamps
-- bridge_epoch on the caller's channel when the legs join; the bridge app only
-- returns once they part, so "now minus then" is the talk time.
local function talk_seconds_now()
  local joined = tonumber(session:getVariable("bridge_epoch")) or 0
  if joined <= 0 then
    return 0
  end
  local talk = os.time() - joined
  if talk < 0 then
    return 0
  end
  return talk
end

-- After an answered call: who took it, for how long, and from which number.
-- The only source of talk time the routing service has, and what lets it send
-- this caller back to the same person next time. A failure here is a log
-- line; the call is already over.
local function report_handled(agent_name, domain, queue_id)
  local extension = string.match(tostring(agent_name or ""), "^([^@]+)") or tostring(agent_name or "")
  extension = string.gsub(extension, "_web", "")
  extension = string.gsub(extension, "_hw", "")
  -- Ring-all cannot always tell who picked up; "unknown" is not a person.
  if extension == "" or extension == "unknown" then
    return
  end

  local talk = talk_seconds_now()
  local url = "http://localhost:9006/api/callcenter/agents/handled"
  local payload = lunajson.encode({
    ["extension"] = extension,
    ["domain"] = domain,
    ["queue_id"] = queue_id or "",
    ["talk_time_seconds"] = talk,
    ["caller_number"] = caller_number or ""
  })

  local ok, err = pcall(curl, url, "POST", payload)
  if ok then
    freeswitch.consoleLog("notice", "Reported handled call: agent=[" .. extension .. "] talk=" .. talk .. "s caller=[" .. tostring(caller_number) .. "]\n")
  else
    freeswitch.consoleLog("warn", "Could not report the handled call for [" .. extension .. "]: " .. tostring(err) .. "\n")
  end
end

-- Function to record agent no-answer event
local function record_agent_no_answer(agent_name, domain, queue_id)
  -- Extract extension from agent_name (format: extension@domain)
  local extension = string.match(agent_name, "^([^@]+)")
  if not extension then
    extension = agent_name
  end

  -- Strip device suffixes
  extension = string.gsub(extension, "_web", "")
  extension = string.gsub(extension, "_hw", "")

  local url = "http://localhost:9006/api/callcenter/agents/no-answer"
  local payload = lunajson.encode({
    ["extension"] = extension,
    ["domain"] = domain,
    ["queue_id"] = queue_id or ""
  })

  freeswitch.consoleLog("notice", "Recording agent no-answer: " .. agent_name .. "\n")
  local response = curl(url, "POST", payload)
  freeswitch.consoleLog("notice", "No-answer recorded for [" .. agent_name .. "]\n")
end

local function build_agent_dialstring(agent_contact, leg_timeout, agent_display_name, agent_extension)
  if not agent_contact or agent_contact == "" then
    return ""
  end

  local contact = tostring(agent_contact)
  local bridge_forward_type = "QUEUE"
  local bridge_forward_value = tostring(queue_key or "")

  if string.upper(tostring(original_forward_type or "")) == "CAMPAIGN" then
    bridge_forward_type = tostring(original_forward_type)
    bridge_forward_value = tostring(original_forward_value or "")
  end

  local queue_headers = string.format(
    "sip_h_X-ForwardType=QUEUE,sip_h_X-ForwardValue=%s,leg_timeout=%d",
    bridge_forward_value,
    leg_timeout
  )

  if bridge_forward_type ~= "QUEUE" then
    queue_headers = string.format(
      "sip_h_X-ForwardType=%s,sip_h_X-ForwardValue=%s,leg_timeout=%d",
      bridge_forward_type,
      bridge_forward_value,
      leg_timeout
    )
  end

  if agent_extension and agent_extension ~= "" then
    local normalized_extension = tostring(agent_extension)
    queue_headers = queue_headers
      .. ",cc_agent=" .. normalized_extension
      .. ",agent_extension=" .. normalized_extension
  end

  -- Add agent display name as both a regular channel variable and SIP header
  -- so ESL bridge events can resolve it from variable_agent_name.
  if agent_display_name and agent_display_name ~= "" then
    queue_headers = queue_headers
      .. ",agent_name=" .. agent_display_name
  end

  if string.sub(contact, 1, 1) == "[" or string.sub(contact, 1, 1) == "{" then
    return contact
  end

  return string.format("[%s]%s", queue_headers, contact)
end

local function execute_bridge_attempt(dialstring, bridge_timeout)
  if not dialstring or dialstring == "" then
    freeswitch.consoleLog("err", "Skipping bridge attempt because dialstring is empty\n")
    return nil
  end

  session:execute("unset", "sip_h_X-Outbound")
  return dial_string(dialstring, bridge_timeout or call_timeout)
end

local wait_media_active = false
local wait_media_last_started = 0
local wait_media_refresh_interval = tonumber(session:getVariable("cc_waiting_media_refresh")) or 3
local wait_media_silence_ms = tonumber(session:getVariable("cc_waiting_media_silence_ms")) or 500
local agent_lookup_jitter_max_ms = tonumber(session:getVariable("cc_agent_lookup_jitter_ms")) or 120

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
  for line in string.gmatch(dump, "[^\r\n]+") do
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

local function trim(value)
  if value == nil then
    return ""
  end

  return tostring(value):gsub("^%s+", ""):gsub("%s+$", "")
end
 

local function normalize_strategy(value)
  local normalized = string.lower(trim(value))
  normalized = string.gsub(normalized, "_", "-")
  normalized = string.gsub(normalized, "%s+", "-")

  if normalized == "" or normalized == "linear" or normalized == "call-linear" or normalized == "sequentially-by-agent-order" then
    return "top-down"
  end
  if normalized == "ringall" then
    return "ring-all"
  end
  if normalized == "longest-idle" then
    return "longest-idle-agent"
  end
  if normalized == "least-talk-time" or normalized == "least-talk" then
    return "agent-with-least-talk-time"
  end
  if normalized == "fewest-calls" or normalized == "fewest-call" then
    return "agent-with-fewest-calls"
  end
  return normalized
end

ring_strategy = normalize_strategy(ring_strategy)

local function compute_lookup_jitter_ms()
  if agent_lookup_jitter_max_ms <= 0 then
    return 0
  end

  local source = tostring(queue_call_uuid or caller_uuid or channel_uuid or "")
  if source == "" then
    return 0
  end

  local hash = 0
  for index = 1, string.len(source) do
    hash = (hash + (string.byte(source, index) * index)) % (agent_lookup_jitter_max_ms + 1)
  end

  return hash
end

local function apply_initial_agent_lookup_jitter()
  local jitter_ms = compute_lookup_jitter_ms()
  if jitter_ms <= 0 or not session:ready() then
    return
  end

  freeswitch.consoleLog("notice", "Applying queue lookup jitter of [" .. tostring(jitter_ms) .. "] ms for call_uuid=[" .. tostring(queue_call_uuid or "") .. "] queue=[" .. tostring(queue_key or "") .. "]\n")
  session:execute("sleep", tostring(jitter_ms))
end

local function resolve_agent_timeout(agent)
  if agent and agent.user_detail then
    local agent_timeout = tonumber(agent.user_detail.timeout)
    if agent_timeout and agent_timeout > 0 then
      return agent_timeout
    end
  end

  return call_timeout
end

local function queue_wait_media_playback()
  if waiting_media == "" or not session:ready() then
    return
  end

  local api = freeswitch.API()
  local padded_waiting_media = string.format(
    "file_string://silence_stream://%d!%s!silence_stream://%d",
    wait_media_silence_ms,
    waiting_media,
    wait_media_silence_ms
  )
  local playback_app = "playback::" .. padded_waiting_media
  local response = api:executeString(string.format("uuid_broadcast %s %s aleg", caller_uuid, playback_app))
  wait_media_last_started = os.time()
  freeswitch.consoleLog("notice", "Queued queue wait media playback for [" .. caller_uuid .. "] app=[" .. playback_app .. "] response=[" .. tostring(response) .. "]\n")
end

local function is_blocking_wait_media(media)
  local normalized = string.lower(tostring(media or ""))
  return string.find(normalized, "local_stream://", 1, true) == 1
end

local function start_wait_media()
  join_line()
  if wait_media_active or not session:ready() then
    return
  end

  session:setVariable("ringback", ringback_tone)
  wait_media_active = true
  if waiting_media ~= "" and not is_blocking_wait_media(waiting_media) then
    queue_wait_media_playback()
  elseif is_blocking_wait_media(waiting_media) then
    freeswitch.consoleLog("notice", "Queue waiting media [" .. waiting_media .. "] is a blocking stream source, skipping active playback and relying on polling/ringback only for [" .. caller_uuid .. "]\n")
  else
    freeswitch.consoleLog("notice", "Queue waiting media is empty for [" .. caller_uuid .. "], relying on ringback only\n")
  end
end

-- "You are still in the queue", on a timer. Played over the hold audio and then
-- the hold audio is held off for one refresh, so the two do not talk over each
-- other.
local function play_repeat_media()
  if repeat_media == "" or repeat_interval <= 0 or not session:ready() then
    return
  end

  local now = os.time()
  if repeat_last_played == 0 then
    -- Start the clock on the first poll rather than announcing the moment
    -- somebody arrives: they have only just heard the greeting.
    repeat_last_played = now
    return
  end

  if (now - repeat_last_played) < repeat_interval then
    return
  end

  local api = freeswitch.API()
  api:executeString(string.format("uuid_broadcast %s playback::%s aleg", caller_uuid, repeat_media))
  repeat_last_played = now
  wait_media_last_started = now
  freeswitch.consoleLog("notice", "Played the repeating message for [" .. caller_uuid .. "] (every " .. repeat_interval .. "s)\n")
end

-- "You are caller number N", on its own timer. Skipped on a poll where the
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
    freeswitch.consoleLog("warn", "Could not count the queue line for [" .. caller_uuid .. "]: " .. tostring(position) .. "\n")
    announce_last_played = now
    return
  end

  local api = freeswitch.API()
  api:executeString(string.format("uuid_broadcast %s playback::%s aleg", caller_uuid, position_media(position)))
  announce_last_played = now
  wait_media_last_started = now
  freeswitch.consoleLog("notice", "Told caller [" .. caller_uuid .. "] they are number " .. position .. " in queue [" .. queue_key .. "]\n")
end

local function refresh_wait_media()
  -- Before the early returns below: the repeating message is its own recording
  -- on its own timer, and must still play when the hold audio is a blocking
  -- stream or absent entirely.
  play_repeat_media()
  play_position()

  if not wait_media_active or waiting_media == "" or not session:ready() or is_blocking_wait_media(waiting_media) then
    return
  end

  if (os.time() - wait_media_last_started) >= wait_media_refresh_interval then
    queue_wait_media_playback()
  end
end

local function stop_wait_media()
  leave_line()
  if not wait_media_active then
    return
  end
  local api = freeswitch.API()
  local response = api:executeString(string.format("uuid_break %s all", caller_uuid))
  wait_media_active = false
  wait_media_last_started = 0
  freeswitch.consoleLog("notice", "Queue wait media state cleared for [" .. caller_uuid .. "] response=[" .. tostring(response) .. "]\n")
end

local function is_session_answered()
  local ok, answered = pcall(function() return session:answered() end)
  if ok and answered then
    return true
  end

  local answer_state = string.lower(tostring(session:getVariable("Answer-State") or session:getVariable("answer_state") or ""))
  local channel_call_state = string.upper(tostring(session:getVariable("Channel-Call-State") or session:getVariable("channel_call_state") or ""))

  return answer_state == "answered" or channel_call_state == "ACTIVE"
end

local function ensure_answered_for_queue()
  if not session:ready() then
    return false
  end

  if not is_session_answered() then
    freeswitch.consoleLog("notice", "Queue A-leg not answered yet, answering before queue attempts for [" .. caller_uuid .. "]\n")
    session:answer()
  end

  return session:ready()
end

local function prime_waiting_media_before_first_attempt()
  if not ensure_answered_for_queue() then
    return false
  end

  start_wait_media()

  local initial_waiting_media_ms = tonumber(session:getVariable("cc_initial_waiting_media_ms")) or 1200
  if initial_waiting_media_ms > 0 and session:ready() then
    session:execute("sleep", tostring(initial_waiting_media_ms))
  end

  refresh_wait_media()
  return session:ready()
end

-- Function to bridge call to single agent
local function bridge_to_agent(agent, queue_domain)
  -- Agent is now an object with {name, contact, user_detail} 
  -- originate_timeout: time to wait for answer (in seconds)
  -- leg_timeout: max duration of the leg (in seconds)
  local attempt_timeout = resolve_agent_timeout(agent)
  local leg_timeout = attempt_timeout
  -- Extract display name from user_detail if available, otherwise use agent name
  local first_name = ""
  local last_name = ""
  local name = ""
    if agent and agent.user_detail then
        first_name = agent.user_detail.first_name or ""
        last_name = agent.user_detail.last_name or ""
        name = agent.user_detail.name or ""
    end
  
  local display_name = (first_name .. " " .. last_name):gsub("^%s+", ""):gsub("%s+$", "")

  if display_name == "" then
      display_name = tostring(name or ""):gsub("^%s+", ""):gsub("%s+$", "")
  end

  local agent_extension = resolve_agent_extension(agent)
  local dialstring = build_agent_dialstring(agent.contact, leg_timeout, display_name, agent_extension)

  freeswitch.consoleLog("notice", "Bridging to agent [" .. agent.name .. "] and [" .. agent_extension .. "] (display: [" .. display_name .. "]) with contact [" .. dialstring .. "]\n")
  session:setVariable("cc_agent", agent_extension)
  session:setVariable("agent_extension", agent_extension)
  session:setVariable("agent_name", display_name)  -- Store display name for bridge event
  session:setVariable("call_timeout", tostring(attempt_timeout))
  session:setVariable("continue_on_fail", "true")

  -- Publish agent assignment event with both agent name and display name
  publish_event("member-offered", {
    agent_name = display_name,
    agent_extension = agent_extension, 
    strategy = ring_strategy
  })

  -- Execute bridge
  local dialstatus = execute_bridge_attempt(dialstring, attempt_timeout)

  local disposition = session:getVariable("originate_disposition")
  local bridge_cause = session:getVariable("BRIDGE_HANGUP_CAUSE") or session:getVariable("last_bridge_result") or "UNKNOWN"
  local bridge_status = session:getVariable("bridge_to_hangup_cause") or session:getVariable("originate_cause") or "UNKNOWN"

  -- Log all bridge-related variables for debugging
  freeswitch.consoleLog("notice", "BRIDGE_ATTEMPT: agent=[" .. agent.name .. "]\n")
  freeswitch.consoleLog("notice", "  originate_disposition=[" .. tostring(disposition) .. "]\n")
  freeswitch.consoleLog("notice", "  BRIDGE_HANGUP_CAUSE=[" .. tostring(bridge_cause) .. "]\n")
  freeswitch.consoleLog("notice", "  bridge_to_hangup_cause=[" .. tostring(bridge_status) .. "]\n")

  -- Check if bridge was successful: if we got past the bridge execute, it likely succeeded
  -- Bridge fails only on specific failure causes
  local bridge_succeeded = false

  if bridge_cause == "SUCCESS" or bridge_cause == "NORMAL_CLEARING" then
    bridge_succeeded = true
  elseif bridge_cause == "NONE" or bridge_cause == "UNKNOWN" then
    -- If hangup cause is NONE or UNKNOWN, check if call duration > 0 (call was connected)
    local call_duration = tonumber(session:getVariable("call_duration")) or 0
    if call_duration > 0 then
      bridge_succeeded = true
    end
  elseif bridge_cause ~= "NO_ANSWER" and bridge_cause ~= "BUSY" and bridge_cause ~= "REJECT" and bridge_cause ~= "CALL_REJECTED" and bridge_cause ~= "NO_USER_RESPONSE" then
    -- If it's not a known failure cause, assume it succeeded
    bridge_succeeded = true
  end

  freeswitch.consoleLog("notice", "  bridge_cause=[" .. tostring(bridge_cause) .. "]\n")
  freeswitch.consoleLog("notice", "  bridge_succeeded=[" .. tostring(bridge_succeeded) .. "]\n")

  -- Set cc_cause and cc_agent_bridged variables based on bridge result
  if bridge_succeeded then
    local answered_epoch = tostring(os.time())
    session:setVariable("cc_cause", "answered")
    session:setVariable("cc_agent_bridged", "true")
    session:setVariable("cc_queue_answered_epoch", answered_epoch)
    session:setVariable("cc_agent", agent_extension)
    local bridge_uuid = session:getVariable("bridge_uuid") or "unknown"
    stamp_queue_bridge_vars(bridge_uuid, answered_epoch, agent.name, agent_extension, display_name)
    report_handled(agent.name, queue_domain, queue_key)

    -- Publish wrap-up required event for ESL-Manager to handle (only for answered calls)
    publish_event("agent-wrapup-required", {
      agent_name = display_name,
      agent_extension = agent_extension,
      wrapup_duration = tostring(wrapup_time),
      cc_cause = "answered",
      member_uuid = caller_uuid,
      queue_id = queue_key,
      channel_uuid = channel_uuid,
      sip_call_id = sip_call_id
    })
  else
    session:setVariable("cc_cause", "abandoned")
    session:setVariable("cc_agent_bridged", "false")
    publish_event("bridge-failed", {
      call_uuid = queue_call_uuid,
      agent_name = display_name,
      agent_extension = agent_extension,
      queue_id = queue_key,
      cause = bridge_cause,
      channel_uuid = channel_uuid,
      sip_call_id = sip_call_id
    })
    -- Do NOT publish wrap-up for failed/abandoned attempts - agent doesn't need to wrap-up if never answered
  end

  -- Determine if we should retry
  local should_retry = false
  if  not bridge_succeeded then
    should_retry = true
  end

  return { succeeded = bridge_succeeded, should_retry = should_retry, disposition = disposition, cause = bridge_cause }
end

-- Function to bridge to all agents (ring_all strategy)
local function bridge_all_agents(agents, queue_domain)
  if #agents == 0 then
    return "NO_ANSWER"
  end

  -- Build dialstring with all agent contacts and timeout parameters
  local attempt_timeout = call_timeout
  local dialstrings = {}
  local agent_names = {}
  local agent_extensions = {}
  local agent_display_names = {}
  local agent_info_map = {}  -- Map agent name to the full agent object with user details
  for i, agent in ipairs(agents) do
    -- Extract display name from user_detail if available
    local first_name = ""
    local last_name = ""
    local name = ""

    if agent and agent.user_detail then
        first_name = agent.user_detail.first_name or ""
        last_name = agent.user_detail.last_name or ""
        name = agent.user_detail.name or ""
    end

    local leg_timeout = resolve_agent_timeout(agent)
    if leg_timeout > attempt_timeout then
      attempt_timeout = leg_timeout
    end

    local display_name = (first_name .. " " .. last_name):gsub("^%s+", ""):gsub("%s+$", "")
    if display_name == "" then
      display_name = tostring(name or ""):gsub("^%s+", ""):gsub("%s+$", "")
    end
    local agent_extension = resolve_agent_extension(agent)
    local agent_dialstring = build_agent_dialstring(agent.contact, leg_timeout, display_name, agent_extension)
    table.insert(dialstrings, agent_dialstring)
    table.insert(agent_names, display_name)
    table.insert(agent_extensions, agent_extension)
    agent.extension = agent_extension
    agent_info_map[agent.name] = agent 
  end

  local dialstring = table.concat(dialstrings, ",")

  freeswitch.consoleLog("notice", "Ring all agents: " .. dialstring .. "\n")
  session:setVariable("cc_agents", table.concat(agent_names, ","))
  session:setVariable("call_timeout", tostring(attempt_timeout))
  session:setVariable("continue_on_fail", "true")

  -- Publish agent offer event for all agents with display names
  publish_event("member-offered", {
    agent_names = table.concat(agent_names, ","),
    agent_extensions = table.concat(agent_extensions, ","), 
    strategy = ring_strategy,
    agent_count = tostring(#agents)
  })

  -- Execute bridge
  local dialstatus = execute_bridge_attempt(dialstring, attempt_timeout)

  local disposition = session:getVariable("originate_disposition")
  local bridge_endpoint = session:getVariable("last_bridge_endpoint") or "unknown"
  local bridge_cause = session:getVariable("BRIDGE_HANGUP_CAUSE") or session:getVariable("last_bridge_result") or "UNKNOWN"
  local answering_agent = "unknown"
  local bridge_uuid = session:getVariable("bridge_uuid") or "unknown"

  -- Try to find which agent answered by matching endpoint against our agent info
  -- Extract just the user part from agent name (before @) for matching
  for agent_name, agent_info in pairs(agent_info_map) do
    local agent_user = string.match(agent_name, "^([^@]+)")  -- Extract user part
    if agent_user and string.find(bridge_endpoint, agent_user) then
      answering_agent = agent_name
      freeswitch.consoleLog("notice", "Agent matched: agent_user=[" .. agent_user .. "] (name=[" .. agent_info.name .. "] extension=[" .. tostring(agent_info.extension or "") .. "]) in endpoint=[" .. bridge_endpoint .. "]\n")
      break
    end
  end

  -- Log all bridge-related variables for debugging
  freeswitch.consoleLog("notice", "BRIDGE_ATTEMPT_RING_ALL: agents=[" .. table.concat(agent_names, ",") .. "]\n")
  freeswitch.consoleLog("notice", "  originate_disposition=[" .. tostring(disposition) .. "]\n")
  freeswitch.consoleLog("notice", "  BRIDGE_HANGUP_CAUSE=[" .. tostring(bridge_cause) .. "]\n")
  freeswitch.consoleLog("notice", "  last_bridge_endpoint=[" .. bridge_endpoint .. "]\n")

  -- Check if bridge was successful
  local bridge_succeeded = false

  if bridge_cause == "SUCCESS" then
    bridge_succeeded = true
  elseif bridge_cause == "NORMAL_CLEARING" then
    bridge_succeeded = true
  elseif bridge_cause == "NONE" or bridge_cause == "UNKNOWN" then
    -- If hangup cause is NONE or UNKNOWN, check if call duration > 0 (call was connected)
    local call_duration = tonumber(session:getVariable("call_duration")) or 0
    if call_duration > 0 then
      bridge_succeeded = true
    end
  elseif bridge_cause ~= "NO_ANSWER" and bridge_cause ~= "BUSY" and bridge_cause ~= "REJECT" and bridge_cause ~= "CALL_REJECTED" then
    -- If it's not a known failure cause, assume it succeeded
    bridge_succeeded = true
  end

  freeswitch.consoleLog("notice", "  bridge_succeeded=[" .. tostring(bridge_succeeded) .. "] answering_agent=[" .. answering_agent .. "]\n")

  -- Publish event based on bridge result
  if bridge_succeeded then
    local answered_epoch = tostring(os.time())
    session:setVariable("cc_cause", "answered")
    session:setVariable("cc_agent_bridged", "true")
    session:setVariable("cc_queue_answered_epoch", answered_epoch)
    if (not answering_agent or answering_agent == "" or answering_agent == "unknown") and #agent_names == 1 then
      answering_agent = agent_names[1]
    end

    local answering_agent_info = agent_info_map[answering_agent] or {}
    
    -- Get display name for the answering agent from user_detail
    local answering_agent_display = answering_agent
    if answering_agent_info.user_detail and answering_agent_info.user_detail.name then
      answering_agent_display = answering_agent_info.user_detail.name
    end
    if (not answering_agent_info.extension or answering_agent_info.extension == "") and answering_agent and answering_agent ~= "" and answering_agent ~= "unknown" then
      answering_agent_info.extension = string.match(answering_agent, "^([^@]+)") or answering_agent
    end
    session:setVariable("cc_agent", answering_agent_info.extension or "")
    session:setVariable("cc_agent_display_name", answering_agent_display or "")
    stamp_queue_bridge_vars(      bridge_uuid,      answered_epoch,      answering_agent,      answering_agent_info.extension or "",      answering_agent_display or ""    )
    report_handled(answering_agent, queue_domain, queue_key)
    -- Publish wrap-up required event for ESL-Manager to handle (only for answered calls)
    publish_event("agent-wrapup-required", {
      agent_name = answering_agent,
      wrapup_duration = tostring(wrapup_time),
      cc_cause = "answered",
      member_uuid = caller_uuid,
      queue_id = queue_key,
      channel_uuid = channel_uuid,
      sip_call_id = sip_call_id
    })
  else
    publish_event("bridge-failed", {
      call_uuid = queue_call_uuid,
      agent_extension = agent_extension,
      agent_name = agent_name,
      agent_extensions = agent_extensions,
      queue_id = queue_key,
      cause = bridge_cause,
      channel_uuid = channel_uuid,
      sip_call_id = sip_call_id
    })
    -- Do NOT publish wrap-up for failed attempts - agents don't need to wrap-up if bridge never happened
  end

  local should_retry = false
  if bridge_cause == "NO_ANSWER" or bridge_cause == "BUSY" or bridge_cause == "REJECT" or bridge_cause == "CALL_REJECTED" then
    should_retry = true
  end

  return { succeeded = bridge_succeeded, should_retry = should_retry, disposition = disposition or dialstatus, cause = bridge_cause }
end

-- Function to wait for agents with MOH polling
local function wait_for_agents_with_moh()
  local start_time = os.time()
  local poll_interval = 3  -- Check every 2 seconds
  local agents = nil

  freeswitch.consoleLog("notice", "Waiting for available agents, polling every " .. poll_interval .. " seconds...\n")

  -- Ensure the caller leg is answered before queue wait audio
  if not ensure_answered_for_queue() then
    freeswitch.consoleLog("warn", "Session no longer ready while trying to answer for queue wait\n")
    return nil, "CALLER_ABANDONED"
  end
  start_wait_media()

  while true do
    -- Check if session is still active
    if not session:ready() then
      freeswitch.consoleLog("warn", "Session no longer ready, exiting queue wait\n")
      stop_wait_media()
      return nil, "CALLER_ABANDONED"
    end

    -- Check elapsed time
    local elapsed_time = os.time() - start_time
    if elapsed_time >= queue_timeout then
      freeswitch.consoleLog("warn", "Queue timeout reached for [" .. queue_key .. "] after " .. elapsed_time .. " seconds\n")
      stop_wait_media()
      publish_event("member-queue-timeout", { wait_time = tostring(elapsed_time) })
      if take_queue_exit() then
        return nil, "QUEUE_EXIT_TAKEN"
      end
      return nil, "QUEUE_TIMEOUT"
    end

    -- Poll for available agents
    freeswitch.consoleLog("debug", "Polling for agents (elapsed: " .. elapsed_time .. "s)\n")
    agents = get_available_agents(queue_key, ring_strategy)

    if agents and #agents > 0 then
      stop_wait_media()
      return agents, nil
    end

    -- Sleep for poll_interval before next check
    freeswitch.consoleLog("notice", "No agents available yet, sleeping for " .. poll_interval .. " seconds before re-query\n")
    session:execute("sleep", tostring(poll_interval * 1000))
    refresh_wait_media()
  end
end

-- Send the caller where this queue says to, now that it has given up on them.
-- Each destination uses the same application the dialplan uses for it, so an
-- exit behaves exactly like reaching that place any other way.
take_queue_exit = function()
  if not queue_exit_destination then return false end
  if not session:ready() then return false end

  local kind = string.upper(queue_exit_destination.type or "")
  local value = queue_exit_destination.value or ""
  local domain = session:getVariable("sip_h_X-Domain")
                 or session:getVariable("domain_name") or ""

  freeswitch.consoleLog("notice",
    "Queue gave up; sending caller to " .. kind .. " " .. value .. "\n")

  if kind == "VOICEMAIL" then
    -- accountcode is already on the channel from the dialplan, and it is what
    -- keeps one company's voicemail separate from another's on disk.
    session:setVariable("vm_target_extension", value)
    session:execute("answer", "")
    session:execute("lua", "save-voicemail.lua")
    return true
  end

  if kind == "EXTENSION" then
    session:setVariable("continue_on_fail", "true")
    session:setVariable("hangup_after_bridge", "true")
    session:execute("bridge",
      "user/" .. value .. "_web@" .. domain .. ",user/" .. value .. "@" .. domain)
    return true
  end

  if kind == "IVR" then
    session:execute("answer", "")
    session:execute("ivr", value)
    return true
  end

  -- Anything else is left alone deliberately. Guessing a destination for a type
  -- this does not understand would send the caller somewhere nobody chose,
  -- which is worse than the hangup it would be replacing.
  freeswitch.consoleLog("warn",
    "Queue exit type " .. kind .. " is not handled here; ending as before\n")
  return false
end

-- Main queue handling logic
local function handle_queue()
  freeswitch.consoleLog("notice", "Queue handler started for [" .. queue_key .. "]\n")
  local first_attempt_media_primed = false

  -- Publish call arrival event
  publish_event("call-start", {
    call_uuid = queue_call_uuid,
    call_type = "queue",
    queue = queue_key,
    caller_number = session:getVariable("caller_id_number") or "",
  })

  apply_initial_agent_lookup_jitter()

  -- Try to get available agents immediately (pass strategy to API)
  local agents = get_available_agents(queue_key, ring_strategy)
  local wait_reason = nil

  -- How many callers this queue will hold at once. The screen has always
  -- promised that past this number a caller goes to the failover rather than
  -- joining the line, and nothing enforced it - a queue capped at five held as
  -- many as arrived.
  --
  -- Counted with mod_hash, which releases a caller's slot when they hang up, so
  -- nothing has to be tidied up afterwards. Checked here rather than at the top
  -- of the script because the failover is only known once the service has
  -- answered, and sending somebody to a destination not yet read is how a caller
  -- ends up in silence.
  local max_callers = tonumber(session:getVariable("cc_max_callers")) or 0
  if max_callers > 0 then
    local cap_api = freeswitch.API()
    local waiting = tonumber(cap_api:executeString("limit_usage hash queue_callers " .. queue_key)) or 0
    if waiting >= max_callers then
      freeswitch.consoleLog("warn", "Queue [" .. queue_key .. "] is full (" .. waiting .. "/" .. max_callers .. "), sending the caller to the failover\n")
      publish_event("member-queue-full", { waiting = tostring(waiting), cap = tostring(max_callers) })
      if take_queue_exit() then
        return "QUEUE_FULL_EXIT"
      end
      return "QUEUE_FULL"
    end
    -- Claim this caller's place. No transfer target is given: going over the cap
    -- is handled above, using the queue's own failover.
    session:execute("limit", "hash queue_callers " .. queue_key .. " " .. max_callers)
  end

  -- If no agents available, wait with MOH polling
  -- Check if we got agents or timed out
  if not agents or #agents == 0 then
    freeswitch.consoleLog("notice", "No agents immediately available, entering MOH wait loop for [" .. queue_key .. "]\n")

    -- Publish no-agents event
    publish_event("no-agents-available", { timeout_seconds = queue_timeout })

    -- Wait for agents with MOH polling (every 2 seconds)
    agents, wait_reason = wait_for_agents_with_moh()
    if wait_reason == "CALLER_ABANDONED" then
      local caller_hangup_cause = session:getVariable("hangup_cause") or "ORIGINATOR_CANCEL"
      publish_event("member-queue-end", { cause = "abandoned", hang_cause = caller_hangup_cause })
      return "CALLER_ABANDONED"
    end

    if agents and #agents > 0 then
      freeswitch.consoleLog("notice", "Agents became available after wait loop: " .. tostring(#agents) .. " agents\n")
      first_attempt_media_primed = true
    else
      freeswitch.consoleLog("warn", "Queue timeout or no agents returned for [" .. queue_key .. "]\n")

      -- Play unavailable message
      session:execute("playback", no_agent_media ~= "" and no_agent_media or "vm-no_agents.wav")

      -- Publish abandoned event
      publish_event("member-queue-end", { cause = "timeout", wait_time = tostring(queue_timeout) })

      return "QUEUE_TIMEOUT"
    end
  end

  freeswitch.consoleLog("notice", "Available agents found: " .. tostring(#agents) .. " agents\n")

  if not first_attempt_media_primed then
    if not prime_waiting_media_before_first_attempt() then
      publish_event("member-queue-end", { cause = "abandoned", hang_cause = session:getVariable("hangup_cause") or "ORIGINATOR_CANCEL" })
      return "CALLER_ABANDONED"
    end
  end
  stop_wait_media()

  -- Set MOH for bridge
  session:setVariable("ringback", ringback_tone)

  -- Apply ring strategy with retry logic
  local result
  if ring_strategy == "ring-all" then
    -- Retry ring_all until queue timeout instead of ending the caller
    -- immediately on a fast NO_ANSWER from the first originate attempt.
    local start_time = os.time()
    while true do
      local elapsed_time = os.time() - start_time
      if elapsed_time >= queue_timeout then
        freeswitch.consoleLog("notice", "Queue timeout reached after " .. elapsed_time .. " seconds for strategy [" .. ring_strategy .. "]\n")
        result = "QUEUE_TIMEOUT"
        break
      end

      if not session:ready() then
        freeswitch.consoleLog("warn", "Session hung up during [" .. ring_strategy .. "] retry loop\n")
        result = "CALLER_ABANDONED"
        break
      end

      local bridge_result = bridge_all_agents(agents, queue_domain)

      if not bridge_result then
        result = "NO_ANSWER"
      elseif bridge_result.succeeded or session:getVariable("cc_agent_bridged") == "true" then
        result = bridge_result.disposition or bridge_result.cause or "SUCCESS"
        break
      elseif not bridge_result.should_retry then
        result = bridge_result.disposition or bridge_result.cause or "UNKNOWN"
        break
      else
        result = bridge_result.cause or bridge_result.disposition or "NO_ANSWER"
      end

      local remaining_queue_time = queue_timeout - (os.time() - start_time)
      local attempt_wait = math.min(call_timeout, remaining_queue_time)
      if attempt_wait <= 0 then
        result = "QUEUE_TIMEOUT"
        break
      end

      freeswitch.consoleLog("notice", "Strategy [" .. ring_strategy .. "] returned [" .. tostring(result) .. "], waiting " .. attempt_wait .. " seconds for bridge window before retry\n")
      session:execute("sleep", tostring(attempt_wait * 1000))

      local refreshed_agents = get_available_agents(queue_key, ring_strategy)
      if refreshed_agents and #refreshed_agents > 0 then
        agents = refreshed_agents
      end
    end
  else
    local start_time = os.time()
    local bridge_result = nil
    local poll_interval = 2

    while true do
      local elapsed_time = os.time() - start_time
      if elapsed_time >= queue_timeout then
        freeswitch.consoleLog("notice", "Queue timeout reached after " .. elapsed_time .. " seconds\n")
        result = "QUEUE_TIMEOUT"
        break
      end

      freeswitch.consoleLog("notice", "Queue attempt with strategy=[" .. ring_strategy .. "] (elapsed: " .. elapsed_time .. "s / " .. queue_timeout .. "s timeout)\n")

      if not agents or #agents == 0 then 
        if not session:ready() then
          freeswitch.consoleLog("warn", "Session hung up during agent polling, exiting queue handler\n")
          result = "CALLER_ABANDONED"
          break
        end

        start_wait_media()
        session:execute("sleep", tostring(poll_interval * 1000))
        refresh_wait_media()

        elapsed_time = os.time() - start_time
        if elapsed_time >= queue_timeout then
          freeswitch.consoleLog("notice", "Queue timeout reached while waiting for agent availability\n")
          result = "QUEUE_TIMEOUT"
          break
        end

        freeswitch.consoleLog("notice", "Re-querying API for next eligible agent\n")
        agents = get_available_agents(queue_key, ring_strategy)
      end

      if agents and #agents > 0 then
        stop_wait_media()
        local agent = agents[1]

        freeswitch.consoleLog("notice", "Attempting single agent [" .. agent.name .. "] for strategy [" .. ring_strategy .. "]\n")

        if not session:ready() then
          freeswitch.consoleLog("warn", "Session hung up during retry, exiting queue handler\n")
          result = "CALLER_ABANDONED"
          break
        end

        bridge_result = bridge_to_agent(agent, queue_domain)
        agents = nil

        local call_duration = tonumber(session:getVariable("call_duration")) or 0
        local bridge_cause = bridge_result.cause

        if call_duration > 0 then
          freeswitch.consoleLog("notice", "Call connected with duration " .. call_duration .. ", exiting retry loop\n")
          result = bridge_result.disposition
          break
        end

        if bridge_cause == "SUCCESS" or bridge_cause == "NORMAL_CLEARING" then
          freeswitch.consoleLog("notice", "Bridge succeeded with cause [" .. bridge_cause .. "]\n")
          result = bridge_result.disposition
          break
        end

        if bridge_cause == "NO_ANSWER" then
          record_agent_no_answer(agent.name, queue_domain, queue_key)
          freeswitch.consoleLog("notice", "Agent did not answer, requesting next eligible agent from fs-callcenter\n")
        elseif bridge_result.should_retry then
          freeswitch.consoleLog("notice", "Retryable bridge failure [" .. tostring(bridge_cause) .. "], requesting next eligible agent from fs-callcenter\n")
        else
          freeswitch.consoleLog("notice", "Bridge failed with non-retry cause [" .. tostring(bridge_cause) .. "], ending queue loop\n")
          result = bridge_result.disposition or bridge_cause or "UNKNOWN"
          break
        end
      end
    end

    if not result then
      result = "QUEUE_TIMEOUT"
    end
  end

  freeswitch.consoleLog("notice", "Bridge result: " .. tostring(result) .. "\n")

  -- Publish call completion event
  local final_bridge_uuid = session:getVariable("bridge_uuid") or ""
  if result == "CALLER_ABANDONED" then
    publish_event("member-queue-end", {
      cause = "abandoned",
      hang_cause = session:getVariable("hangup_cause") or "ORIGINATOR_CANCEL",
      b_leg_uuid = final_bridge_uuid,
      bridge_uuid = final_bridge_uuid,
    })
  elseif result == "QUEUE_TIMEOUT" then
    publish_event("member-queue-end", { cause = "timeout", hang_cause = result, b_leg_uuid = final_bridge_uuid, bridge_uuid = final_bridge_uuid })
  elseif result ~= "NO_ANSWER" then
    publish_event("member-queue-end", { cause = "completed", hang_cause = result, duration = session:getVariable("call_duration") or 0, b_leg_uuid = final_bridge_uuid, bridge_uuid = final_bridge_uuid })
  else
    publish_event("member-queue-end", { cause = "abandoned", hang_cause = result, b_leg_uuid = final_bridge_uuid, bridge_uuid = final_bridge_uuid })
  end

  return result
end

-- Execute queue handler
if session:ready() then
  local result = handle_queue()
  leave_line()
  freeswitch.consoleLog("notice", "Queue handler completed with result: " .. tostring(result) .. "\n")
else
  freeswitch.consoleLog("err", "Session not ready\n")
end
