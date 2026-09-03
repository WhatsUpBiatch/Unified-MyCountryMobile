lunajson = require "lunajson"

local CURL_CONNECT_TIMEOUT = 2
local CURL_MAX_TIME = 8

-- Function to generate UUID
local function generateUUID()
  local template ='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return string.gsub(template, '[xy]', function (c)
    local v = (c == 'x') and math.random(0, 0xf) or math.random(8, 0xb)
    return string.format('%x', v)
  end)
end

local function urlEncode(value)
  local str = tostring(value or "")
  str = string.gsub(str, "\n", "\r\n")
  str = string.gsub(str, "([^%w%-_%.~])", function(c)
    return string.format("%%%02X", string.byte(c))
  end)
  return str
end

local function trimString(s)
  if s == nil then
    return ""
  end
  return (string.gsub(s, "^%s*(.-)%s*$", "%1"))
end

function curl(cmd)
local curlcmd = string.format(
  "/usr/bin/curl --silent --show-error --globoff --connect-timeout %d --max-time %d '%s' 2>&1",
  CURL_CONNECT_TIMEOUT,
  CURL_MAX_TIME,
  cmd
)
freeswitch.consoleLog("notice", "LINE [" .. debug.getinfo(1).currentline .. "] curlcmd=>" .. curlcmd .. "\n")
local handle = io.popen(curlcmd)
local result = handle:read("*a")
local ok, _, exitCode = handle:close()
if not ok then
freeswitch.consoleLog("err", "LINE [" .. debug.getinfo(1).currentline .. "] curl failed, exitCode=>" .. tostring(exitCode) .. " output=>" .. tostring(result) .. "\n")
return ""
end
freeswitch.consoleLog("notice","LINE [" .. debug.getinfo(1).currentline .. "] curlresult=>" .. tostring(result) .. "\n")
return result
end
function curl_result(result)
local body = trimString(result)
if body == "" then
return { success = false }
end
local ok, decoded = pcall(lunajson.decode, body)
if not ok or type(decoded) ~= "table" then
freeswitch.consoleLog("err", "LINE [" .. debug.getinfo(1).currentline .. "] invalid json response=>" .. tostring(body) .. "\n")
return { success = false }
end
return decoded
end

function trim(s)
return (string.gsub(s, "^%s*(.-)%s*$", "%1"))
end

function systemCommand(cmd)
freeswitch.consoleLog("notice", "LINE [" .. debug.getinfo(1).currentline .. "] systemCommand=>" .. cmd .. "\n")
local handle = io.popen(cmd)
local result = handle:read("*a")
handle:close()
freeswitch.consoleLog("notice", "LINE [" .. debug.getinfo(1).currentline .. "] systemCommand=>" .. result .. "\n")
return result
end

function pickValue(value, fallback)
if value == nil or value == "" or value == "INVALID COMMAND!" or value == "_undef_" then
return fallback
end
return value
end

api = freeswitch.API()
dnid = pickValue(session:getVariable("did_number"), pickValue(session:getVariable("sip_h_X-DID"), session:getVariable("destination_number")))
callerID = session:getVariable("caller_id_number")
uniqueID = session:getVariable("uuid")
forwardType = string.lower(session:getVariable("forward_type"))
forwardValue = session:getVariable("forward_value")
ft = session:getVariable("sip_h_X-ForwardType")
fn = session:getVariable("sip_h_X-ForwardName")
fv = session:getVariable("sip_h_X-ForwardValue")
company_uuid = session:getVariable("company_uuid")
sessionId = session:getVariable("sip_h_X-cid") 
nextContext = session:getVariable("ai_next_context")
nextExtension = session:getVariable("ai_next_extension")
aiUserId = session:getVariable("ai_user_id") or ""
aiAPIKey = session:getVariable("ai_api_key") or ""
aiAgentId = session:getVariable("ai_agent_id") or ""
aiAgentName = session:getVariable("ai_agent_name") or fn or ""
dataSessionId =   generateUUID()
conversationSessionId =  generateUUID()
dataAgentId = session:getVariable("ai_data_agent_uuid") or ""
detailsToCollect = session:getVariable("ai_details_to_collect") or ""
conversationAgentId = session:getVariable("ai_conversation_agent_uuid") or aiAgentId
aiLanguage = session:getVariable("ai_language") or ""
aiAgentVoice = session:getVariable("ai_agent_voice") or ""

if detailsToCollect == "[]" or detailsToCollect == "" then
dataAgentId = ""
end

freeswitch.consoleLog("notice", "aiUserId=>" .. tostring(aiUserId) .. "\n")
freeswitch.consoleLog("notice", "aiAPIKey=>" .. tostring(aiAPIKey) .. "\n")
freeswitch.consoleLog("notice", "aiAgentId=>" .. tostring(aiAgentId) .. "\n")
freeswitch.consoleLog("notice", "dataAgentId=>" .. tostring(dataAgentId) .. "\n")
freeswitch.consoleLog("notice", "detailsToCollect=>" .. tostring(detailsToCollect) .. "\n")
freeswitch.consoleLog("notice", "dnid=>" .. dnid .. "\n")
freeswitch.consoleLog("notice", "callerID=>" .. callerID .. "\n")
freeswitch.consoleLog("notice", "uuid=>" .. uniqueID .. "\n")
freeswitch.consoleLog("notice", "forwardType=>" .. tostring(forwardType) .. "\n")
freeswitch.consoleLog("notice", "forwardValue=>" .. tostring(forwardValue) .. "\n")
freeswitch.consoleLog("notice", "sessionId=>" .. tostring(sessionId) .. "\n")  
 

local result =
curl("http://localhost:7555/startCall?callTo=" .. urlEncode(dnid) .. "&callFrom=" .. urlEncode(callerID) .. "&callerUniqueId=" .. urlEncode(uniqueID) .. "&context=" .. urlEncode(forwardType) .. "&extension=" .. urlEncode(forwardValue) .. "&aiAPIKey=" .. urlEncode(aiAPIKey) .. "&aiUserId=" .. urlEncode(aiUserId) .. "&dataSessionId=" .. urlEncode(dataSessionId) .. "&conversationSessionId=" .. urlEncode(conversationSessionId) .. "&dataAgentId=" .. urlEncode(dataAgentId) .. "&detailsToCollect=" .. urlEncode(detailsToCollect) .. "&conversationAgentId=" .. urlEncode(conversationAgentId) .. "&aiLanguage=" .. urlEncode(aiLanguage) .. "&aiAgentVoice=" .. urlEncode(aiAgentVoice) .. "&company_uuid=" .. urlEncode(company_uuid))

local res = curl_result(result)

if (res["success"] == true) then
    session:answer()
    session:setVariable("forward_type",ft);
    session:setVariable("forward_name",fn);
    session:setVariable("forward_value",fv);
    session:setVariable("agent_extension", conversationAgentId);
    session:setVariable("agent_name", aiAgentName);
    session:setVariable("cc_agent_display_name", aiAgentName);
    session:transfer(uniqueID, "XML", "ai-conference")
end
