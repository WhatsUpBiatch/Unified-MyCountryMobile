require 'config'
lunajson = require 'lunajson'

function uploadCallRecording(callData)
    raw_file_path = callData["raw_file_path"];
	uniquecode = callData["accountcode"];
	
    filename = callData["call_record_file"]; 
    parameters = {};
    parameters.content_type = "audio/mpeg";
    parameters.description = "Call Recording";
    parameters.category_name = "Call Recording";
    parameters.uniquecode = uniquecode;
    parameters.path2 = raw_file_path..filename;
    parameters.filename = filename
    
    uploadResult = uploadFile(parameters);
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd uploadResult=>"..uploadResult.."\n");
    if(uploadResult ~= "Uploading Error!!!") then
        update_call_record = updateCallRecording(callData['accountcode'], callData['uuid'], callData['domain'], uploadResult);
        return true;
    else
        return "Updating Error!!!";
    end
end

function get_upload_url(parameters)
    local cmd = "/usr/bin/curl --location --request POST '"..fs_upload_url.."' --header 'Content-Type: application/json' -d '{\"upload_type\":\"audio\",\"contentType\":\"audio/mpeg\",\"customer_uniquecode\":\""..parameters['uniquecode'].."\",\"recording_filename\":\""..parameters['filename'].."\"}'";
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] ***cmd-> "..cmd.."\n");
    local handle = io.popen(cmd);
    local result = handle:read("*a");
    handle:close();
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd result=>"..result.."\n");
    return lunajson.decode( result )
end

function uploadFile(parameters)
    result_upload_url = get_upload_url(parameters);
    local cmd = "/usr/bin/curl -X PUT --url '"..result_upload_url["url"].."'  --header 'Content-Type: audio/mpeg' -T '"..parameters['path2'].."'";
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] ***cmd-> "..cmd.."\n");
    local handle = io.popen(cmd);
    local result = handle:read("*a");
    handle:close();
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd result=>"..result.."\n");
    if(result == nil or result == '') then
        return result_upload_url["file_name"];
    else
        return "Uploading Error!!!";
    end;
end
