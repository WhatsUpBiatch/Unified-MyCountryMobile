local dialstring = session:getVariable("mcm_bridge_dialstring") or ""

if dialstring == "" then
  session:setVariable("DIALSTATUS", "UNAVAILABLE")
  return
end

session:setVariable("mcm_bridge_child_cause", "")
session:execute("bridge", dialstring)

local disposition = session:getVariable("originate_disposition") or ""
local bridge_cause = session:getVariable("BRIDGE_HANGUP_CAUSE") or session:getVariable("last_bridge_result") or ""
local child_cause = session:getVariable("mcm_bridge_child_cause") or ""
local disposition_upper = string.upper(tostring(disposition))
local bridge_cause_upper = string.upper(tostring(bridge_cause))

freeswitch.consoleLog("notice", "[bridge_with_status] originate_disposition=[" .. tostring(disposition) .. "] BRIDGE_HANGUP_CAUSE=[" .. tostring(bridge_cause) .. "] child_cause=[" .. tostring(child_cause) .. "]\n")

local resolved = bridge_cause
if bridge_cause_upper == "" or bridge_cause_upper == "NONE" or bridge_cause_upper == "UNKNOWN" or bridge_cause_upper == "FAILURE" then
  if disposition_upper == "FAILURE" and child_cause ~= "" then
    resolved = child_cause
  else
    resolved = disposition
  end
elseif resolved == "" or resolved == "NONE" or resolved == "UNKNOWN" or resolved == "FAILURE" then
  resolved = disposition
end

local resolved_upper = string.upper(tostring(resolved))
if resolved_upper == "" or resolved_upper == "NONE" or resolved_upper == "UNKNOWN" or resolved_upper == "SUCCESS" or resolved_upper == "NORMAL_CLEARING" then
  return
end

if resolved_upper == "FAILURE" then
  return
end

session:setVariable("DIALSTATUS", resolved_upper)
