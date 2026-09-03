--[[
  Send a finished call recording to storage, then tell the API which call it
  belongs to.

  Run from the dialplan as a hangup hook, so there is NO session by the time
  this executes - everything it needs arrives as arguments.

      api_hangup_hook=lua upload_recording.lua <call_uuid> <company_uuid>

  Why not the upload code already in functions.lua: that aims at fs_upload_url,
  a name defined nowhere, using a multipart shape from an API that no longer
  exists. This uses the presigned flow the platform actually serves today - ask
  for a URL, PUT the file, then link it to the call.

  Nothing here is fatal. A hangup hook that throws leaves FreeSWITCH logging a
  Lua error on every call, and a lost recording must not become a lost call.
]]

require "config"

local call_uuid = argv[1]
local company_uuid = argv[2]

local function log(level, message)
  freeswitch.consoleLog(level, "[upload_recording] " .. tostring(message) .. "\n")
end

if not call_uuid or call_uuid == "" or not company_uuid or company_uuid == "" then
  log("warning", "called without a call uuid or company uuid - nothing to do")
  return
end

local path = recording_path .. call_uuid .. ".wav"

-- Nothing was recorded for this call. The ordinary case for most calls, so it
-- is quiet rather than a warning.
local handle = io.open(path, "rb")
if not handle then
  return
end
local size = handle:seek("end")
handle:close()

-- A file this small is silence or a truncated write. Uploading it would put a
-- useless recording on a call and make somebody listen to nothing to find out.
if not size or size < 4096 then
  log("notice", "recording for " .. call_uuid .. " is only " .. tostring(size) .. " bytes - discarding")
  os.remove(path)
  return
end

local function shell_quote(value)
  return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function run(command)
  local pipe = io.popen(command)
  if not pipe then return nil end
  local output = pipe:read("*a")
  pipe:close()
  return output
end

-- 1. Ask for somewhere to put it.
local ask = table.concat({
  "/etc/freeswitch/scripts/curl -s --max-time 30 -X POST",
  shell_quote(fs_media_api_addr .. "/direct/upload/url"),
  "-H 'Content-Type: application/json'",
  "-H " .. shell_quote("Authorization: Bearer " .. fs_internal_key),
  "-d " .. shell_quote(string.format(
    '{"uuid":"%s","type":"recording","file_name":"%s.wav"}', company_uuid, call_uuid)),
}, " ")

local ask_result = run(ask)
if not ask_result or ask_result == "" then
  log("err", "no answer when asking for an upload url for " .. call_uuid)
  return
end

local ok, decoded = pcall(function() return lunajson.decode(ask_result) end)
if not ok or type(decoded) ~= "table" then
  log("err", "could not read the upload url response for " .. call_uuid)
  return
end

local result = decoded.data and decoded.data.data and decoded.data.data.result
if not result then
  result = decoded.data and decoded.data.result
end
if not result or not result.url or not result.file_name then
  log("err", "upload url response had no url for " .. call_uuid)
  return
end

-- 2. Put the file there. -f so curl reports a failing status as an error rather
--    than writing the error page and exiting zero, which would look like success.
local put = table.concat({
  "/etc/freeswitch/scripts/curl -s -f --max-time 300 -X PUT",
  shell_quote(result.url),
  "-H 'Content-Type: audio/wav'",
  "-T " .. shell_quote(path),
  "-o /dev/null -w '%{http_code}'",
}, " ")

local code = run(put)
if not code or not tostring(code):match("^2%d%d") then
  -- Left on disk on purpose. A failed upload that also deletes the file loses
  -- the recording twice over, and this one can be retried by hand.
  log("err", "storage refused the recording for " .. call_uuid .. " (http " .. tostring(code) .. ") - file kept at " .. path)
  return
end

-- 3. Tell the API which call it belongs to. Until this lands the file exists
--    and nothing can find it.
local attach = table.concat({
  "/etc/freeswitch/scripts/curl -s --max-time 30 -X POST",
  shell_quote(fs_internal_api_addr .. "/call-recording"),
  "-H 'Content-Type: application/json'",
  "-H " .. shell_quote("Authorization: Bearer " .. fs_internal_key),
  "-d " .. shell_quote(string.format(
    '{"call_uuid":"%s","company_uuid":"%s","file_name":"%s"}',
    call_uuid, company_uuid, result.file_name)),
}, " ")

local attach_result = run(attach) or ""
if attach_result:find('"success":true', 1, true) then
  os.remove(path)
  log("notice", "recording for " .. call_uuid .. " stored and linked")
else
  -- The file is safely in storage; only the link failed. Keeping the local copy
  -- would waste disk for nothing, but the failure has to be visible or the
  -- recording is silently unreachable.
  os.remove(path)
  log("err", "recording for " .. call_uuid .. " was stored but could not be linked to the call: " .. attach_result)
end
