local primary_parent_uuid = argv[1] or ""
local fallback_parent_uuid = argv[2] or ""
local child_uuid = argv[3] or ""
local hangup_cause = string.upper((argv[4] or ""):gsub("^%s+", ""):gsub("%s+$", ""))
local answer_epoch = argv[5] or ""
local bridge_uuid = argv[6] or ""

local parent_uuid = primary_parent_uuid
if parent_uuid == "" then
  parent_uuid = fallback_parent_uuid
end

if parent_uuid == "" or hangup_cause == "" or hangup_cause == "NONE" or hangup_cause == "UNKNOWN" or hangup_cause == "FAILURE" then
  return
end

local function cause_priority(cause)
  if cause == "ORIGINATOR_CANCEL" then
    return 100
  end
  if cause == "USER_BUSY" then
    return 90
  end
  if cause == "CALL_REJECTED" or cause == "MANDATORY_IE_MISSING" then
    return 80
  end
  if cause == "ALLOTTED_TIMEOUT" or cause == "NO_ANSWER" or cause == "NOANSWER" or cause == "NO_USER_RESPONSE" or cause == "SUBSCRIBER_ABSENT" then
    return 70
  end
  if cause == "UNALLOCATED_NUMBER" or cause == "NO_ROUTE_DESTINATION" or cause == "RECOVERY_ON_TIMER_EXPIRE" or cause == "NUMBER_CHANGED" then
    return 60
  end
  if cause == "NORMAL_CLEARING" or cause == "SUCCESS" then
    return 0
  end
  return 10
end

local api = freeswitch.API()
local existing_cause = tostring(api:executeString("uuid_getvar " .. parent_uuid .. " mcm_bridge_child_cause") or "")
existing_cause = existing_cause:gsub("^%s+", ""):gsub("%s+$", "")
if existing_cause == "_undef_" then
  existing_cause = ""
end

local new_priority = cause_priority(hangup_cause)
local existing_priority = cause_priority(string.upper(existing_cause))

if new_priority <= 0 or existing_priority >= new_priority then
  freeswitch.consoleLog("notice", "[bridge_bleg_report] skip parent_uuid=[" .. parent_uuid .. "] child_uuid=[" .. child_uuid .. "] cause=[" .. hangup_cause .. "] existing=[" .. existing_cause .. "] answer_epoch=[" .. tostring(answer_epoch) .. "] bridge_uuid=[" .. tostring(bridge_uuid) .. "]\n")
  return
end

api:executeString("uuid_setvar " .. parent_uuid .. " mcm_bridge_child_cause " .. hangup_cause)
freeswitch.consoleLog("notice", "[bridge_bleg_report] parent_uuid=[" .. parent_uuid .. "] child_uuid=[" .. child_uuid .. "] cause=[" .. hangup_cause .. "] answer_epoch=[" .. tostring(answer_epoch) .. "] bridge_uuid=[" .. tostring(bridge_uuid) .. "]\n")
