uuid = env:getHeader("uuid");
domain = env:getHeader("sip_h_X-Domain");
didNumber = env:getHeader("sip_h_X-DID");

call_received = env:getHeader("call_received");
call_dialed = env:getHeader("call_dialed");
if(env:getHeader("vm_msgfile") ~= nil) then vm_msgfile = env:getHeader("vm_msgfile") else vm_msgfile = '' end;

if(env:getHeader("effective_caller_id_number") ~= nil) then from = env:getHeader("effective_caller_id_number") else from = '' end;
if(env:getHeader("forward_type") ~= nil) then type = env:getHeader("forward_type") else type = '' end;
if(env:getHeader("forward_value") ~= nil) then forward_value = env:getHeader("forward_value") else forward_value = '' end;
if(env:getHeader("forward_name") ~= nil) then name = env:getHeader("forward_name") else name = '' end;
if(env:getHeader("accountcode") ~= nil) then accountcode = env:getHeader("accountcode") else accountcode = '' end;
-- Grab a specific channel variable
if(env:getHeader("start_stamp") ~= nil) then start_stamp = env:getHeader("start_stamp") else start_stamp = '' end;
if(env:getHeader("answer_stamp") ~= nil) then answer_stamp = env:getHeader("answer_stamp") else answer_stamp = '' end;
if(env:getHeader("end_stamp") ~= nil) then end_stamp = env:getHeader("end_stamp") else bridge_uuid = '' end;
if(env:getHeader("duration") ~= nil) then duration = env:getHeader("duration") else duration = '' end;
if(env:getHeader("billsec") ~= nil) then billsec = env:getHeader("billsec") else billsec = '' end; 
if(env:getHeader("is_voicemail") ~= nil) then is_voicemail = env:getHeader("is_voicemail") else is_voicemail = '' end;


if (is_voicemail != "Y" and billsec == 0) then
    local cmd = "/usr/bin/curl --location --request POST Content-Type: application/json -d '{\"domain\":\""..domain.."\",\"type\":\""..type.."\",\"value\":\""..value.."\",\"name\":\""..name.."\",\"from\":\""..from.."\",\"didNumber\":\""..didNumber.."\",\"time\":\""..start_stamp.."\",\"accountcode\":\""..accountcode.."\",}' http://example.com/api/books";

    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] ***cmd-> "..cmd.."\n");
    local handle = io.popen(cmd);
    local result = handle:read("*a");
    handle:close();
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd result=>"..result.."\n"); 
end