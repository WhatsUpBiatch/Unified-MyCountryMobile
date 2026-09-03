-- outbound_call_failure_handler.lua
-- Handles outbound call failures and plays appropriate messages
-- Usage: lua:/etc/freeswitch/scripts/outbound_call_failure_handler.lua

local function log(level, msg)
  freeswitch.consoleLog(level, "[CALL_FAILURE] " .. msg .. "\n")
end

-- Base audio path configuration
local AUDIO_BASE_PATH = "/usr/share/freeswitch/sounds/custom/en/ivr/"

-- Combined message mapping for both DIALSTATUS and SIP codes
local FAILURE_MESSAGES = {
  -- DIALSTATUS codes
  ["INVALID_INPUT"] = "ivr-invalid_input.mp3",
  ["NO_PACKAGE_FOUND"] = "ivr-no_package.mp3",
  ["NO_RATE"] = "ivr-no_rate.mp3",
  ["BLOCKED_DESTINATION"] = "ivr-blocked_destination.mp3",
  ["NOT_AVAILABLE"] = "ivr-not_available.mp3",
  ["UNKNOWN_ERR"] = "ivr-bad_request.mp3",
  ["LOW_BALANCE"] = "ivr-low_balance.mp3",
  ["IN_ACTIVE_DESTINATION"] = "ivr-inactive_destination.mp3",
  ["NO_ANSWER"] = "ivr-no_answer.mp3",
  ["NOANSWER"] = "ivr-no_answer.mp3",
  ["BUSY"] = "ivr-busy_here.mp3",
  ["CANCEL"] = "ivr-call_cancelled.mp3",
  ["CONGESTION"] = "ivr-congestion.mp3",
  ["CHANUNAVAIL"] = "ivr-channel_unavailable.mp3",
  
  -- SIP error codes
  ["400"] = "ivr-bad_request.mp3",
  ["404"] = "ivr-number_not_found.mp3",
  ["480"] = "ivr-temporarily_unavailable.mp3",
  ["486"] = "ivr-busy_here.mp3",
  ["487"] = "ivr-request_terminated.mp3",
  ["488"] = "ivr-not_acceptable.mp3",
  ["500"] = "ivr-server_error.mp3",
  ["502"] = "ivr-bad_gateway.mp3",
  ["503"] = "ivr-service_unavailable.mp3",
  ["603"] = "ivr-call_declined.mp3",
  ["604"] = "ivr-does_not_exist.mp3"
}

-- Default fallback message
local DEFAULT_MESSAGE = "ivr-server_error.mp3"

-- Function to play audio file using early media (without answering)
local function playMessage(session, audio_file)
  if not session or not session:ready() then
    log("ERROR", "Session not ready for playing message")
    return
  end
  
  local full_audio_path = AUDIO_BASE_PATH .. audio_file
  log("INFO", "Playing audio via early media: " .. full_audio_path)
  
  -- Provide early media without answering the call
  session:execute("pre_answer")
  
  -- Play the audio file
  session:execute("playback", full_audio_path)
  
  -- Add a brief pause after the message
  session:execute("sleep", "1000")
end

-- Function to get failure message
local function getFailureMessage(error_code)
  return FAILURE_MESSAGES[error_code] or DEFAULT_MESSAGE
end

-- Main execution
if not session or not session:ready() then
  log("ERROR", "Session not available or not ready")
  return
end

-- Get failure information from session variables
local dialstatus = session:getVariable("dialstatus") or ""
local sip_term_status = session:getVariable("sip_term_status") or ""
local hangup_cause = session:getVariable("hangup_cause") or ""

-- Extract SIP code if available
local sip_code = sip_term_status:match("(%d+)") or ""

log("INFO", "=== CALL FAILURE ANALYSIS ===")
log("INFO", "dialstatus: " .. dialstatus)
log("INFO", "sip_term_status: " .. sip_term_status)
log("INFO", "sip_code: " .. sip_code)
log("INFO", "hangup_cause: " .. hangup_cause)

-- If dialstatus indicates the call was successful/answered, do NOT play a failure message.
local ds_up = (dialstatus or ""):upper()
if ds_up == "SUCCESS" or ds_up == "ANSWERED" or ds_up == "ANSWER" then
  log("INFO", "Dialstatus indicates success/answered (" .. (dialstatus or "") .. "), skipping failure playback")
  -- Mark that no failure message was played and record the reason for reporting
  session:execute("set", "call_failure_message_played=false")
  session:execute("set", "call_failure_reason=" .. (dialstatus or ""))
  return
end

-- Determine error code (priority: SIP code > DIALSTATUS)
local error_code = (sip_code ~= "" and sip_code) or (dialstatus ~= "" and dialstatus) or "DEFAULT"
local audio_file = getFailureMessage(error_code)

log("INFO", "Selected error code: " .. error_code)
log("INFO", "Playing audio file via early media: " .. audio_file)

-- Play message using early media (no need for additional sleep here)
playMessage(session, audio_file)

-- Set session variables for reporting
session:execute("set", "call_failure_message_played=true")
session:execute("set", "call_failure_reason=" .. error_code)

-- Hangup the call after playing the message
session:execute("hangup", "NORMAL_CLEARING")

log("INFO", "Call failure handler completed")
return