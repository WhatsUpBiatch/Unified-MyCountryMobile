-- dual_leg_record.lua 

local api = freeswitch.API()

local function log(level, msg)
  freeswitch.consoleLog(level, "[DUALREC] " .. msg .. "\n")
end

-- Function to generate UUID
local function generateUUID()
  local template ='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return string.gsub(template, '[xy]', function (c)
    local v = (c == 'x') and math.random(0, 0xf) or math.random(8, 0xb)
    return string.format('%x', v)
  end)
end

-- Function to get agent extension from B-leg channel
local function getAgentExtensionFromBridge(session)
    if not session or not session:ready() then
        return ""
    end

    local bridge_uuid = session:getVariable("bridge_uuid")
    if bridge_uuid and bridge_uuid ~= "" then
        -- Try to get variables from the bridged channel
        local cmd = "uuid_getvar " .. bridge_uuid .. " destination_number"
        local result = api:executeString(cmd)
        if result and result ~= "" and result ~= "_undef_" then
            return result
        end
        
        -- Try other variables from bridged channel
        cmd = "uuid_getvar " .. bridge_uuid .. " sip_to_user"
        result = api:executeString(cmd)
        if result and result ~= "" and result ~= "_undef_" then
            return result
        end
    end
    
    return ""
end

-- Function to wait for bridge and get bridge UUID
local function waitForBridge(session, max_wait_ms)
    local wait_time = 0
    local check_interval = 100 -- Check every 100ms
    
    while wait_time < max_wait_ms do
        local bridge_uuid = session:getVariable("bridge_uuid")
        if bridge_uuid and bridge_uuid ~= "" and bridge_uuid ~= "_undef_" then
            log("INFO", "Bridge established after " .. wait_time .. "ms, bridge_uuid: " .. bridge_uuid)
            return bridge_uuid
        end
        
        session:execute("sleep", tostring(check_interval))
        wait_time = wait_time + check_interval
        
        -- Check if session is still valid
        if not session:ready() then
            log("ERROR", "Session ended while waiting for bridge")
            return nil
        end
    end
    
    log("ERROR", "Bridge not established within " .. max_wait_ms .. "ms")
    return nil
end

-- Read args
local dir      = argv[1]
local uuid = argv[2]
local direction = argv[3] 
local caller_source = argv[4] -- Optional: indicates if called from record_with_prompt.lua

-- Function to get session variable via API when session is not available
local function getSessionVar(var_name)
  if session and session:ready() then
    return session:getVariable(var_name)
  else
    -- Use API to get variable when session is not available
    local cmd = "uuid_getvar " .. uuid .. " " .. var_name
    local result = api:executeString(cmd)
    if result == "_undef_" or result == "" then
      return nil
    end
    return result
  end
end

-- Only wait for bridge if NOT called from record_with_prompt.lua AND session is available
local bridge_uuid = nil
if caller_source ~= "record_with_prompt" and session and session:ready() then
    -- Wait for bridge to be established (for FreeSWITCH 1.10 compatibility)
    log("INFO", "Waiting for bridge to be established...")
    bridge_uuid = waitForBridge(session, 5000) -- Wait up to 5 seconds
else
    log("INFO", "Called from record_with_prompt.lua or no session - skipping bridge wait")
    -- Get bridge UUID directly if available
    bridge_uuid = getSessionVar("bridge_uuid")
    if bridge_uuid and bridge_uuid ~= "" and bridge_uuid ~= "_undef_" then
        log("INFO", "Bridge UUID found: " .. bridge_uuid)
    else
        log("INFO", "No bridge UUID available yet")
        bridge_uuid = nil
    end
end


-- Convert direction to lowercase for case-insensitive comparison
if direction then
  direction = string.lower(direction)
end

-- Print all session variables for debugging
-- if session and session:ready() then
--   log("INFO", "=== ALL SESSION VARIABLES (DUAL_LEG_RECORD) ===")
--   session:execute("info")
--   log("INFO", "=== END SESSION VARIABLES (DUAL_LEG_RECORD) ===")
-- end

local agent_extension = "" 
  
-- Get agent extension based on call direction
if direction == "outbound" then
    agent_extension = getSessionVar("username") or ""
    log("INFO", "Outbound call - using username for agent extension")
else
    -- For inbound calls, get agent extension from bridged user
    log("INFO", "Inbound call - getting agent extension from bridged user")  
    agent_extension = getSessionVar("Caller-Destination-Number") or ""
end
  
-- If still empty, try to get from bridge channel directly
if agent_extension == "" then
    if session and session:ready() then
        agent_extension = getAgentExtensionFromBridge(session)
    else
        -- Try to get from bridge using API
        if bridge_uuid and bridge_uuid ~= "" then
            local cmd = "uuid_getvar " .. bridge_uuid .. " destination_number"
            local result = api:executeString(cmd)
            if result and result ~= "" and result ~= "_undef_" then
                agent_extension = result
            end
        end
    end
end

-- Generate new UUID for filename and create custom basename
local generated_uuid = generateUUID()
local custom_uuid = uuid.."_" .. generated_uuid .. "_" .. agent_extension

-- Validate inputs
if not dir or dir == "" then
  log("ERR", "Recording directory not provided")
  return
end
if not uuid or uuid == "" then
  log("ERR", "No session UUID available")
  return
end

log("INFO", "Recording with agent extension: " .. agent_extension)
log("INFO", "Generated UUID: " .. generated_uuid)
log("INFO", "custom_uuid: " .. custom_uuid)
log("INFO", "Caller source: " .. (caller_source or "direct"))
log("INFO", "Bridge UUID: " .. (bridge_uuid or "not found"))

if direction == "outbound" then
    -- Build file paths
    local caller_file = string.format("%s/%s_caller.wav", dir, custom_uuid)
    local agent_file  = string.format("%s/%s_agent.wav", dir, custom_uuid)

    log("INFO", "    caller_file: " .. caller_file)
    log("INFO", "    agent_file: " .. agent_file) 
    
    if bridge_uuid and bridge_uuid ~= "" then
        -- Record caller from A-leg (what caller says)
        local cmd1 = string.format("uuid_record %s start %s write", uuid, caller_file)
        -- Record agent from B-leg (what agent says)  
        local cmd2 = string.format("uuid_record %s start %s write", bridge_uuid, agent_file)
        
        log("NOTICE", "Starting caller recording (A-leg write) -> " .. caller_file)
        local r1 = api:executeString(cmd1)
        log("INFO", "uuid_record response (A-leg): " .. tostring(r1))

        log("NOTICE", "Starting agent recording (B-leg write) -> " .. agent_file)
        local r2 = api:executeString(cmd2)
        log("INFO", "uuid_record response (B-leg): " .. tostring(r2))

         
        -- Additional option: Record from B-leg as well for comparison
        local agent_bleg_file = string.format("%s/%s_agent_bleg.wav", dir, custom_uuid)
        local cmd3 = string.format("uuid_record %s start %s write", bridge_uuid, agent_bleg_file)
        log("NOTICE", "Starting agent B-leg recording -> " .. agent_bleg_file)
        local r3 = api:executeString(cmd3)
        log("INFO", "uuid_record response (B-leg write): " .. tostring(r3))
    else
        log("ERROR", "No bridge_uuid available - cannot record separate legs")
        -- Fallback to single channel recording using API
        local mixed_file = string.format("%s/%s.wav", dir, uuid)
        local cmd = string.format("uuid_record %s start %s both", uuid, mixed_file)
        local result = api:executeString(cmd)
        log("NOTICE", "Fallback: Starting mixed recording via API -> " .. mixed_file)
        log("INFO", "API result: " .. tostring(result))
    end
else
    -- Build file paths for inbound
    local caller_file = string.format("%s/%s_caller.wav", dir, custom_uuid) 
    local agent_file = string.format("%s/%s_agent.wav", dir, custom_uuid)

    log("INFO", "    caller_file: " .. caller_file) 
    log("INFO", "    agent_file: " .. agent_file)
    
    if bridge_uuid and bridge_uuid ~= "" then
        -- Record caller from A-leg (what caller says)
        local cmd1 = string.format("uuid_record %s start %s write", uuid, caller_file)
        -- Record agent from B-leg (what agent says)
        local cmd2 = string.format("uuid_record %s start %s write", bridge_uuid, agent_file)
        
        log("NOTICE", "Starting caller recording (A-leg write) -> " .. caller_file)
        local r1 = api:executeString(cmd1)
        log("INFO", "uuid_record response (A-leg): " .. tostring(r1))

        log("NOTICE", "Starting agent recording (B-leg write) -> " .. agent_file)
        local r2 = api:executeString(cmd2)
        log("INFO", "uuid_record response (B-leg): " .. tostring(r2))
    else
        log("ERROR", "No bridge_uuid available - cannot record separate legs")
        -- Fallback to single channel recording using API
        local mixed_file = string.format("%s/%s_mixed.wav", dir, custom_uuid)
        local cmd = string.format("uuid_record %s start %s both", uuid, mixed_file)
        local result = api:executeString(cmd)
        log("NOTICE", "Fallback: Starting mixed recording via API -> " .. mixed_file)
        log("INFO", "API result: " .. tostring(result))
    end
end
return