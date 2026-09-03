-- on_demand_recording.lua

-- Function: Enable on-demand dual-leg recording with DTMF triggers
function enable_on_demand_dual_leg_recording(session)
    if not session:ready() then
      freeswitch.consoleLog("WARNING", "Session not ready.\n")
      return
    end
    
    local uuid = session:get_uuid()
    local record_dir = session:getVariable("call_record_path")
    local a_file = session:getVariable("call_record_file")
    local b_uuid = session:getVariable("bridge_to")
    
      -- Retry in case bridge_uuid is not yet available
    -- for i = 1, 8 do
    --     if b_uuid and b_uuid ~= "" then break end
    --     session:sleep(1000)
    --     b_uuid = session:getVariable("bridge_to")
    -- end

    -- session:execute("info")  -- Logs everything: headers, variables, codecs, etc.

  
    local a_file = record_dir .."/".. a_file
    local b_file = record_dir .. "/b_uuid" .. ".wav"

    -- A-leg recording: bind DTMF *2 to start, *3 to stop
    -- Bind *2 to start recording
    session:execute("bind_meta_app", "2 b i exec:uuid_record " .. uuid .. " start " .. a_file .. " both")
    session:execute("bind_meta_app", "3 b i exec:uuid_record " .. uuid .. " stop " .. a_file)

    -- Export B-leg bind using variable expansion
    session:execute("export", "bind_meta_app=2 b i exec:uuid_record ${uuid} start " .. b_file .. " both")
    session:execute("export", "bind_meta_app=3 b i exec:uuid_record ${uuid} stop " .. b_file)

    session:execute("set", "RECORD_READ_ONLY=true")
    session:execute("export", "RECORD_READ_ONLY=true")
  
    freeswitch.consoleLog("INFO", "On-demand recording enabled. Press 2 to start, 3 to stop.\n")
  end
  
  -- MAIN ENTRY (called from dialplan)
  if session:ready() then
    enable_on_demand_dual_leg_recording(session)
  else
    freeswitch.consoleLog("INFO", "Call not ready or already terminated.\n")
  end
  