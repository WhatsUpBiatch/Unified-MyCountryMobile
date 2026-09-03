-- Arguments: <record_path> <uuid>
local record_path = argv[1]
local uuid        = argv[2]
local action        = argv[3]

local api = freeswitch.API()

local function log(level, msg)
  freeswitch.consoleLog(level, "[RECORD_PROMPT] " .. msg .. "\n")
end

local function exec_and_log(cmd)
  local result = api:executeString(cmd)
  log("INFO", "CMD: " .. cmd .. " => " .. tostring(result))
  return tostring(result or "")
end

local function normalize_value(v)
  if not v then return "" end
  v = tostring(v)
  v = v:gsub("^%s+", ""):gsub("%s+$", "")
  if v == "_undef_" or v == "nil" or v == "false" then
    return ""
  end
  return v
end

local function stop_recording_for_uuid(target_uuid)
  target_uuid = normalize_value(target_uuid)
  if target_uuid == "" then
    return
  end

  exec_and_log(string.format("uuid_record %s stop all", target_uuid))
  -- If any recorder was started with record_session, stop those too.
  exec_and_log(string.format("uuid_broadcast %s stop_record_session::all both", target_uuid))
end

-- Function to check if dual leg recording should be triggered
local function shouldTriggerDualLegRecording()
  if not session or not session:ready() then
    return false, "", false
  end
  
  -- Print all session variables for debugging
if session and session:ready() then
  log("INFO", "=== ALL SESSION VARIABLES (DUAL_LEG_RECORD) ===")
--   session:execute("info")
  log("INFO", "=== END SESSION VARIABLES (DUAL_LEG_RECORD) ===")
end
  
  local call_dialed = session:getVariable("call_dialed") or ""
  local call_received = session:getVariable("call_received") or ""
  local sip_h_x_record = session:getVariable("sip_h_X-Record") or ""
  
  log("INFO", "call_dialed: " .. call_dialed)
  log("INFO", "call_received: " .. call_received)
  log("INFO", "sip_h_X-Record: " .. sip_h_x_record)
  
  local should_stop_current = (sip_h_x_record == "true")
  
  -- Check for outbound call condition
  if call_dialed == "Y" then
    if sip_h_x_record == "true" then
      log("INFO", "Outbound call with X-Record=true - stopping current and starting dual leg recording")
      return false, "Inbound", should_stop_current
    else
      log("INFO", "Outbound call condition met - triggering dual leg recording")
      return true, "Inbound", should_stop_current
    end 
  end
  
  -- Check for inbound call condition
  if call_received == "Y" then
    if sip_h_x_record == "true" then
      log("INFO", "Inbound call with X-Record=true - stopping current and starting dual leg recording")
      return true, "Inbound", should_stop_current
    else
      log("INFO", "Inbound call condition met - triggering dual leg recording")
      return false, "Inbound", should_stop_current
    end
  end
  
  log("INFO", "No dual leg recording conditions met")
  return false, "", false
end

-- Function to execute dual leg recording logic from dual_leg_record.lua
local function executeDualLegRecording(direction)
  if not session or not session:ready() then
    log("ERR", "Session not ready for dual leg recording")
    return
  end
  
  local recording_dir = string.match(record_path, "(.*/)")
  if not recording_dir then
    recording_dir = "/tmp/"
  end
  
  log("INFO", "Executing dual leg recording for " .. direction .. " call")
  log("INFO", "Recording directory: " .. recording_dir)
  
  -- Execute dual_leg_record.lua with proper parameters and caller source indicator
  local cmd = string.format("luarun /etc/freeswitch/scripts/dual_leg_record.lua %s %s %s record_with_prompt", recording_dir, uuid, direction)
  local result = api:executeString(cmd)
  log("INFO", "Dual leg recording result: " .. tostring(result))
end

if action == "start" then
  -- Check if dual leg recording should be triggered
  local should_record, direction, should_stop_current = shouldTriggerDualLegRecording()
  
  if should_record then
    -- Stop current recording if X-Record header indicates to do so
    if should_stop_current then
      log("INFO", "Stopping current recording due to X-Record=true")
      stop_recording_for_uuid(uuid)
      exec_and_log(string.format("uuid_silence %s 500", uuid))
    end
    -- Execute dual leg recording logic
    -- executeDualLegRecording(direction) for later
    exec_and_log(string.format("uuid_broadcast %s %s both", uuid, "ivr/ivr-begin_recording.wav"))
    -- put silence before playing Voice message
    exec_and_log(string.format("uuid_silence %s 1000", uuid))
    -- Start the recording
    exec_and_log(string.format("uuid_record %s start %s both",uuid, record_path))
  else
    -- Play a short message (blocking)
    exec_and_log(string.format("uuid_broadcast %s %s both", uuid, "ivr/ivr-begin_recording.wav"))
    -- put silence before playing Voice message
    exec_and_log(string.format("uuid_silence %s 1000", uuid))
    -- Start the recording
    exec_and_log(string.format("uuid_record %s start %s both",uuid, record_path))
  end
end

if action == "stop" then
  -- Stop all possible recording mechanisms on A leg.
  stop_recording_for_uuid(uuid)

  -- Also stop on bridge leg, because recording may have moved or started there.
  local bridge_uuid = normalize_value(exec_and_log(string.format("uuid_getvar %s bridge_uuid", uuid)))
  if bridge_uuid ~= "" and bridge_uuid ~= uuid then
    log("INFO", "Stopping recording on bridged leg: " .. bridge_uuid)
    stop_recording_for_uuid(bridge_uuid)
  else
    log("INFO", "No valid bridge UUID found for stop flow")
  end

  -- put silence before playing Voice message
  exec_and_log(string.format("uuid_silence %s 1000", uuid))
 
  -- Play a short stop message (blocking)
  exec_and_log(string.format("uuid_broadcast %s %s both", uuid, "ivr/ivr-recording_stopped.wav"))
   
end
