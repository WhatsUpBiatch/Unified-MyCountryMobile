local uuid = session:get_uuid()
local api = freeswitch.API()
local path = "/opt/call-recordings/tmp/" .. uuid .. ".wav"
api:execute("uuid_record", uuid .. " stop " .. path)
