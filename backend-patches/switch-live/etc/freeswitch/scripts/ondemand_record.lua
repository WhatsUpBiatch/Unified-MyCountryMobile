--[[
  On-demand call recording, toggled by an agent DTMF feature code.

  Bound in the dialplan via bind_digit_action and run on the call (A-leg):
      argv[1] = "start" | "stop"

  uuid_broadcast injects the short announcement INTO the live bridge without
  tearing it down (playback would break the call), and uuid_record captures both
  legs. The hangup hook set in the dialplan uploads whatever was recorded, the
  same path automatic recording uses. Nothing here is fatal: on any problem the
  call is left untouched.
]]

local action = argv and argv[1] or nil
if not session or not session:ready() then return end

local uuid = session:get_uuid()
local api = freeswitch.API()
local dir = "/etc/freeswitch/sounds/mcm/"
local recpath = "/opt/call-recordings/tmp/" .. uuid .. ".wav"

local function log(m)
  freeswitch.consoleLog("notice", "[ondemand_record] " .. tostring(m) .. "\n")
end

if action == "start" then
  if session:getVariable("ondemand_recording") == "true" then return end
  api:executeString("uuid_broadcast " .. uuid .. " " .. dir .. "recording-on-demand-start.wav both")
  api:executeString("uuid_record " .. uuid .. " start " .. recpath .. " both")
  session:setVariable("ondemand_recording", "true")
  log("started " .. uuid)
elseif action == "stop" then
  if session:getVariable("ondemand_recording") ~= "true" then return end
  api:executeString("uuid_record " .. uuid .. " stop " .. recpath)
  api:executeString("uuid_broadcast " .. uuid .. " " .. dir .. "recording-on-demand-stop.wav both")
  session:setVariable("ondemand_recording", "false")
  log("stopped " .. uuid)
end
