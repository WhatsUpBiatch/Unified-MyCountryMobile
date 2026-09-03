require 'config'
lunajson = require 'lunajson'


function dial_string(dialstring, timeout)
    timeout = timeout or 30;
    call_record = call_record or "N";
    call_record_alert = call_record_alert or "N";
    call_credit = call_credit or -1;
    session:setVariable("call_timeout",timeout);
    session:setVariable("continue_on_fail","true");
    session:setVariable("ringback",session:getVariable("us-ring"));
    session:execute("bridge",dialstring);
    dialstatus = session:getVariable("originate_disposition");
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] dialstatus  =>"..tostring(dialstatus).."\n");
    return dialstatus;
end

function phoneForward(phone, sip_trunk, timeout, call_credit, call_record, call_record_alert, recording_path)
    dialstring = "[^^:$${x_sip_outbound}:absolute_codec_string=pcma]sofia/internal/"..phone.."@"..sip_trunk..session:getVariable("x_path");
    if(call_credit > 0) then
        dialstatus = dial_string(dialstring, timeout, call_credit*60, call_record, call_record_alert, recording_path);
    else
        freeswitch.consoleLog("notice", "Low Balance \n");
    end
    session:setVariable("phone",phone);
    freeswitch.consoleLog("notice", "dialstatus=>"..tostring(dialstatus).."\n");
    return dialstatus;
end

function extensionForward(exten, timeout)
    session:execute("unset","sip_h_X-Outbound");
    dialstatus = dial_string(exten, timeout);
    return dialstatus;
end

function getDIDDetails(uniquecode, destination_number, caller_id_number)
    url_string = ""
    if(uniquecode ~=  '') then
        url_string = "uniquecode=" .. uniquecode;
    end

    if(destination_number ~=  '') then
        if(url_string ~=  "") then
            url_string =  url_string.."&didNumber=" .. destination_number;
        else
            url_string = "didNumber=" .. destination_number;
        end
    end

    if(caller_id_number ~=  '') then
        if(url_string ~=  "") then
            url_string =  url_string.."&cli=" .. caller_id_number;
        else
            url_string = "cli=" .. caller_id_number;
        end
    end

    local result =  curl(fs_office_info .. "?" .. url_string);
    return lunajson.decode( result )
end

function getcallrouting(uniquecode)
    local result =  curl(fs_get_inbound_details .. "?didNumber=" .. uniquecode);
    return lunajson.decode( result )
end

function getSipUsers(uniquecode)
    local result =  curl(fs_get_sip_users .. "?uniquecode=" .. uniquecode);
    return lunajson.decode( result )
end

function getCallerInfo(domain, user_extension, number)
    local result =  curl(fs_get_caller_info .. "?user=" .. user_extension.."&domain=" .. domain.."&number=" .. number);
    return lunajson.decode( result )
end

function getGroupUsers(uniquecode,teamID)
    local result =  curl(fs_get_group_users .. "?uniquecode=" .. uniquecode.. "&teamID=" .. teamID);
    return lunajson.decode( result )
end

function getCallerName(uniquecode,phone_number)
    local result =  curl(fs_get_contact_info .. "?uniquecode=" .. uniquecode .. "&number=" .. phone_number);
    return lunajson.decode( result )
end

function getIVRDetails(uniquecode,ivrID)
    local result =  curl(fs_get_ivr_info .. "?uniquecode=" .. uniquecode .. "&ivrID=" .. ivrID);
    return lunajson.decode( result )
end

function getDownloadUrl(uniquecode,objectName)
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] getDownloadUrl"..fs_get_ivr_info .. "?uniquecode=" .. uniquecode .. "&objectName=" .. objectName .." \n");
    local result =  curl(fs_download_url .. "?uniquecode=" .. uniquecode .. "&objectName=" .. objectName);
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] getDownloadUrl"..result .." \n");
    return lunajson.decode( result )
end

function getUploadUrl(parameters)
    local result =  curl(fs_get_upload_url .. "?uniquecode=" .. parameters["uniquecode"] .. "&content_type=" .. urlencode(parameters["content_type"]).."&filesize=" .. parameters["filesize"] .. "&filename=" .. parameters["filename"]);
    return lunajson.decode( result )
end

function caller_id_sanitization(caller_id, begin_with)
    if(string.sub(caller_id,1,string.len(begin_with))==begin_with) then
        return caller_id;
    else
        return "+"..caller_id;
    end
 end

function getVoicemail(uniquecode)
    local result =  curl(fs_get_voicemail .. "?uniquecode=" .. uniquecode);
    return lunajson.decode( result );
end

function seenVoicemail(uniquecode,uuid)
    local result =  curl(fs_voicemail_seen .. "?uniquecode=" .. uniquecode.."&uuid="..uuid);
    return lunajson.decode( result );
end

function updateCallRecording(accountcode, uuid, domain, recording_file)
    local result = curl(fs_put_call_logs .. "?action=update&accountcode=" .. accountcode.."&xml_cdr_uuid="..uuid.."&recording_file="..recording_file.."&domain="..domain);
    return curl_result( result );
end

function logCallDetails(xml_cdr_uuid, domain_name, accountcode, context, direction, contact_uuid, is_user, caller_id_firstname, caller_id_lastname, caller_id_name, caller_id_number, caller_destination, destination_number, extension, is_voicemail, start_stamp, answer_stamp, end_stamp, duration, billsec, bridge_uuid, read_codec, read_rate, write_codec, write_rate, remote_media_ip, last_app, last_arg, waitsec, digits_dialed, hangup_cause, hangup_cause_q850, sip_hangup_disposition, dialstatus, buy_rate, sell_rate, destination, forward_type, forward_value)
    local result = curl(fs_put_call_logs .. "?action=insert&xml_cdr_uuid=" .. xml_cdr_uuid .. "&domain_name=" .. urlencode(domain_name) .. "&accountcode=" .. urlencode(accountcode) .. "&context=" .. urlencode(context) .. "&direction=" .. direction .."&contact_uuid=" .. contact_uuid .. "&is_user=" .. is_user .. "&caller_id_firstname=" .. urlencode(caller_id_firstname) .. "&caller_id_lastname=" .. urlencode(caller_id_lastname) .. "&caller_id_name=" .. urlencode(caller_id_name) .. "&caller_id_number=" .. caller_id_number.. "&caller_destination=" .. caller_destination.."&destination_number=" .. destination_number.."&extension=" .. extension.. "&is_voicemail=" .. bool_to_number(is_voicemail).."&start_stamp=" .. urlencode(start_stamp).."&answer_stamp=" .. urlencode(answer_stamp).."&end_stamp=" .. urlencode(end_stamp).."&duration=" .. duration.. "&billsec=" .. billsec.."&bridge_uuid=" .. bridge_uuid.."&read_codec=" .. read_codec.."&read_rate=" .. read_rate.."&write_codec=" .. write_codec.. "&write_rate=" .. write_rate.."&remote_media_ip=" .. remote_media_ip.."&last_app=" .. urlencode(last_app).."&last_arg=" .. urlencode(last_arg).."&waitsec=" .. waitsec.. "&digits_dialed=" .. digits_dialed.."&hangup_cause=" .. urlencode(hangup_cause).."&hangup_cause_q850=" .. urlencode(hangup_cause_q850).."&sip_hangup_disposition=" .. urlencode(sip_hangup_disposition).."&status=" .. urlencode(dialstatus).."&forward_type=" .. urlencode(forward_type).."&forward_value=" .. urlencode(forward_value));
    return curl_result( result );
end

function playmessages(filepath, filename, accountcode, takeinput)
    takeinput = takeinput or false;
    res_dtmf = nil;
    fileurl = filepath .. filename;
    extension = pathinfo(fileurl);
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] extension"..extension.."\n");
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] fileurl"..fileurl.."\n");
    os.execute("mkdir -p " .. filepath);
    if(filename ~= "") then
        if(extension == "mp3") then
            filename = string.sub(filename,0,-5);
            if(file_exists(filepath..filename .. ".wav") == false) then
                freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] Download new file \n");
                ivr_audio_url   =       getDownloadUrl(accountcode, filename..'.mp3');
                ivr_audio_url   =       ivr_audio_url['url'];
                if(download_file(fileurl,ivr_audio_url) ~= nil) then
                    cmd = '/usr/bin/ffmpeg -i '..filepath..filename..'.mp3 -acodec pcm_s16le -ac 1 -ar 8000 '..filepath..filename..'.wav';
                    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] cmd =>"..cmd.." \n");
                    os.execute(cmd); -- convert it to wav mono
                    cmd = 'rm -Rf '..filepath..filename..'.mp3'
                    os.execute(cmd);
                else
                    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] Download File Error!!!! \n");
                    no_afterhour_vm_set_flag = true;
                end
            else
                freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] File Exists \n");
            end
        else
            filename = string.sub(filename,0,-5);
            if(file_exists(fileurl) == false) then
                freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] Download new file \n");
                ivr_audio_url   =       getDownloadUrl(accountcode, filename..'.wav');
                ivr_audio_url   =       ivr_audio_url['url'];
                if(download_file(fileurl,ivr_audio_url) ~= nil) then
                    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] File downloaded successfully \n");
                else
                    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] Download File Error!!!! \n");
                    no_afterhour_vm_set_flag = true;
                end
            else
                freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] File Exists \n");
            end
        end
    else
        no_afterhour_vm_set_flag = true;
    end
    if(takeinput) then
        -- freeswitch.consoleLog("notice", filepath..filename.." \n");
        session:execute("read", "1 1 "..filepath..filename..".wav res_dtmf 5000 #");
        res_dtmf = tostring(session:getVariable("res_dtmf"));

    else
        if(no_afterhour_vm_set_flag) then
            session:execute("playback", ivr_folder_path.."vm-nobodyavail.wav"); 
            session:execute("playback", ivr_folder_path.."vm-intro.wav");
        else
            -- freeswitch.consoleLog("notice", filepath..filename.."\n");
            session:execute("playback", filepath..filename..".wav");
        end
    end
    return res_dtmf;
    
end

function playmessagesvoicemail(filepath, filename, url)

    -- freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] filepath"..filepath .." \n");
    fileurl = filepath .. filename;
    extension = pathinfo(fileurl);
    if(filename ~= "") then
        if(file_exists(filepath..filename) == false) then
            freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] Download new file \n");
            if(download_file(fileurl,url) ~= nil) then
                freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] File downloaded successfully \n");
            else
                freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] Download File Error!!!! \n");
            end
        else
            freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] File Exists \n");
        end
        session:execute("playback", filepath..filename);
    else
        freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] File url empty \n");
    end

    
end

function download_file(fileurl,url)
    local curlcmd = "/etc/freeswitch/scripts/curl -o ".. "'"..fileurl.."' '" .. url .. "'";
    -- freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd=>"..curlcmd.."\n");
    result = os.execute(curlcmd)
    return result;    
end

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
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd uploadResult=>"..uploadResult["ResponseCode"].."\n");
    if(uploadResult["ResponseCode"] == "1") then
        update_call_record = updateCallRecording(uniquecode, callData['uuid'], callData['domain'], uploadResult["filename"]);
        return true;
    else
        return "Error";
    end
end

function uploadFile(parameters)
    local cmd = "/etc/freeswitch/scripts/curl --location --request POST '"..fs_upload_url.."' --header 'Content-Type: multipart/form-data' --form 'upload_type=audio' --form 'customer_uniquecode="..parameters['uniquecode'].."' --form 'recording_filename=@"..parameters['path2'].."'";
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] ***cmd-> "..cmd.."\n");
    local handle = io.popen(cmd);
    local result = handle:read("*a");
    handle:close();
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd result=>"..result.."\n");
    return lunajson.decode( result );
end

-- function uploadCallRecording(callData)
--     raw_file_path = callData["raw_file_path"];
-- 	uniquecode = callData["accountcode"];
	
--     filename = callData["call_record_file"]; 
--     parameters = {};
--     parameters.content_type = "audio/mpeg";
--     parameters.description = "Call Recording";
--     parameters.category_name = "Call Recording";
--     parameters.uniquecode = uniquecode;
--     parameters.path2 = raw_file_path..filename;
--     parameters.filename = filename
    
--     uploadResult = uploadFile(parameters);
--     freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd uploadResult=>"..uploadResult.."\n");
--     if(uploadResult ~= "Uploading Error!!!") then
--         update_call_record = updateCallRecording(callData['accountcode'], callData['uuid'], callData['domain'], uploadResult);
--         return true;
--     else
--         return "Updating Error!!!";
--     end

-- end

function get_upload_url(parameters)
    local cmd = "/etc/freeswitch/scripts/curl --location --request POST '"..fs_upload_url.."' --header 'Content-Type: application/json' -d '{\"upload_type\":\"audio\",\"contentType\":\"audio/mpeg\",\"customer_uniquecode\":\""..parameters['uniquecode'].."\",\"recording_filename\":\""..parameters['filename'].."\"}'";
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] ***cmd-> "..cmd.."\n");
    local handle = io.popen(cmd);
    local result = handle:read("*a");
    handle:close();
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd result=>"..result.."\n");
    return lunajson.decode( result )
end

-- function uploadFile(parameters)
--     result_upload_url = get_upload_url(parameters);
--     local cmd = "/etc/freeswitch/scripts/curl -X PUT --url '"..result_upload_url["url"].."'  --header 'Content-Type: audio/mpeg' -T '"..parameters['path2'].."'";
--     freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] ***cmd-> "..cmd.."\n");
--     local handle = io.popen(cmd);
--     local result = handle:read("*a");
--     handle:close();
--     freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd result=>"..result.."\n");
--     if(result == nil or result == '') then
--         return result_upload_url["file_name"];
--     else
--         return "Uploading Error!!!";
--     end;
-- end

-- voicemail function
function voicemail_save(uniquecode, uniqueid)

	if(session ~= nil) then
        --answer the session
        if (session:ready()) then
            session:answer();
        end

        voicemail_dir = base_dir.."storage/voicemail/default/"..uniquecode;
        freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] voicemail_dir =>"..voicemail_dir.."\n");
        vm_message_ext = 'wav';
        os.execute("mkdir -p " .. voicemail_dir);
        max_len_seconds = 300;
        silence_threshold = 30;
        silence_seconds = 5;
        session:streamFile("tone_stream://L=1;%(1000, 0, 640)");
        start_epoch = os.time();
        result = session:recordFile(voicemail_dir.."/msg_"..uniqueid.."."..vm_message_ext, max_len_seconds, silence_threshold, silence_seconds);
        stop_epoch = os.time();
        session:streamFile(sounds_dir.."voicemail/vm-goodbye.wav");
        message_length = stop_epoch - start_epoch;
        message_length_formatted = format_seconds(message_length);
        vm_msgfile = "msg_"..uniqueid.."."..vm_message_ext;
        session:setVariable("vm_duration", message_length);
        session:setVariable("voicemail_dir", voicemail_dir.."/");
        session:setVariable("vm_msgfile", vm_msgfile);
        
        if(tonumber(message_length) >= 3) then
            session:setVariable("is_voicemail","Y");
        else
            os.remove(voicemail_dir..vm_msgfile);   -- remove VM from server
        end
    end

end

function voicemail_read(uniquecode,timezone)

    main_menu(uniquecode,timezone);

end

function make_dialstring(user_exten)
    local dialstring = "{^^:presence_id="..user_exten..":absolute_codec_string='pcmu,opus':sip_h_X-WebRTC=true:media_webrtc=true}sofia/internal/sip:"..user_exten..";fs_path=sip:${distributor sipcore ${sofia profile internal gwlist down}}";
    
    return dialstring;
end

function main_menu (uniquecode,timezone)
    
    default_language = "en"
    if (uniquecode) then
        --clear the value
        dtmf_digits = '';
        --flush dtmf digits from the input buffer
        session:flushDigits();
        --new voicemail count
        if (session:ready()) then
            session:answer();
            new_messages = getVoicemail(uniquecode);
            msg_count = 0;
            for k, v in pairs(new_messages["data"]) do
                msg_count = msg_count + 1;
            end
            freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] getVoicemail >: " .. msg_count .. "\n");            
            freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] default_language >: " .. tostring(session:getVariable("default_language")) .. "\n");
            if(msg_count > 0) then
                session:streamFile("silence_stream://1000");
                session:streamFile(sounds_dir.."voicemail/vm-you_have.wav");
                session:say(msg_count, default_language, "number", "pronounced");
                session:streamFile(sounds_dir.."voicemail/vm-new.wav");
                if (msg_count > 1) then
                    session:streamFile(sounds_dir.."voicemail/vm-messages.wav");
                else
                    session:streamFile(sounds_dir.."voicemail/vm-message.wav");
                end
                os.execute("mkdir -p " .. voicemail_folders_path..uniquecode);
                session:streamFile(sounds_dir.."voicemail/vm-first.wav");
                counter = msg_count;
                while(counter > 0) 
                do     
                    if (not session:ready()) then
                        break;
                    end
                    session:streamFile(sounds_dir.."voicemail/vm-message.wav");
                    -- session:streamFile(sounds_dir.."voicemail/vm-received.wav");
                    -- vm_date = new_messages["data"][counter]['start_datetime'];
                    -- freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] vm_date >: " .. vm_date .. "\n");
                    -- freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] timezone >: " .. timezone .. "\n");
                    -- vm_date = convertTimezone(vm_date, 'UTC', timezone);
                    -- session:streamFile(sounds_dir.."voicemail/on.wav");
                    -- date = date_create(vm_date);
                    -- epoch  = date_format(date, 'U');
                    -- freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] epoch >: " .. epoch .. "\n");                         
                    -- agi->exec("SayUnixTime", epoch.",,QIMP");
                    session:say("1648208919", default_language, "CURRENT_DATE_TIME", "pronounced");
                    recording_media_uuid = new_messages["data"][counter]['recording_media_uuid'];
                    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] recording_media_uuid >: " .. recording_media_uuid .. "\n");
                    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] getVoicemail  counter >: " .. new_messages["data"][counter]['uuid'] .. "\n");
                            
    
                    -- // Mark message as seen
                    seenVoicemail(uniquecode, new_messages["data"][counter]['uuid']);
                    voicemailurl       =       getDownloadUrl(uniquecode, recording_media_uuid);
                    voicemail_file     =       explode("/",voicemailurl['url']);
                    voicemail_file     =       explode("?",voicemail_file[4]);
                    voicemail_file     =       voicemail_file[1];
                    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."]  >: " .. voicemail_folders_path..uniquecode.."/"..voicemail_file .. "\n");    
                    if(voicemail_file ~= "") then
                        playmessagesvoicemail(voicemail_folders_path..uniquecode.."/", voicemail_file, voicemailurl['url']);
                            
                        no_action_input = 3;
                        repeat
                            if (not session:ready()) then
                                break;
                            end
                            res_dtmf = "nil";
                            freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."]  no_action_input =>: " .. no_action_input .."\n");
                            -- // Take input
                            session:execute("read", "1 1 "..sounds_dir.."voicemail/vm-repeat-and-next.wav".." res_dtmf 3s000 #");
                            res_dtmf = tostring(session:getVariable("res_dtmf"));

                            freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."]  Take input >= " .. res_dtmf .. "\n");
                                if(res_dtmf == '5') then
                                        playmessagesvoicemail(voicemail_folders_path, voicemail_file, voicemailurl['url']);
                                elseif(res_dtmf == '6') then
                                    break;
                                end  
                            no_action_input = no_action_input -1;
                        until(no_action_input < 0);
                    end
                    counter = counter - 1;
                end
                session:streamFile(sounds_dir.."voicemail/vm-nomore.wav");
            end
        end
    end
end

--------

function curl(cmd)
    local curlcmd = "/etc/freeswitch/scripts/curl -H 'Authorization: Bearer YWRtaW46c29tZVN1cGVyU2VjcmV0' '" .. cmd .. "'";
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd=>"..curlcmd.."\n");
    local handle = io.popen(curlcmd);
    local result = handle:read("*a");
    handle:close();
    freeswitch.consoleLog("notice", "LINE ["..debug.getinfo(1).currentline.."] curlcmd=>"..result.."\n");
    return result;    
end
 
function tableHasKey(table,key)
    return table[key] ~= nil
end

function Split(s, delimiter)
    result = {};
    for match in (s..delimiter):gmatch("(.-)"..delimiter) do
        table.insert(result, match);
    end
    return result;
end

function is_array(elem)
 if(type(elem) == "table") then
    return true;
 else
    return false;
 end
end

-- function explode(delimiter, s)
--     result = {};
--     for match in (s..delimiter):gmatch("(.-)"..delimiter) do
--         table.insert(result, match);f
--     end
--     return result;
-- end

function explode ( seperator, str ) 
    local pos, arr = 0, {}
    for st, sp in function() return string.find( str, seperator, pos, true ) end do -- for each divider found
        table.insert( arr, string.sub( str, pos, st-1 ) ) -- attach chars left of current divider
        pos = sp + 1 -- jump past current divider
    end
    table.insert( arr, string.sub( str, pos ) ) -- attach chars right of last divider
    return arr
end

function pathinfo(url)
    local str = url
  local temp = ""
  local result = "" -- ! Remove the dot here to ONLY get the extension, eg. jpg without a dot. The dot is added because Download() expects a file type with a dot.

  for i = str:len(), 1, -1 do
    if str:sub(i,i) ~= "." then
      temp = temp..str:sub(i,i)
    else
      break
    end
  end

  -- Reverse order of full file name
  for j = temp:len(), 1, -1 do
    result = result..temp:sub(j,j)
  end

  return result
end

function basename(str)
	local name = string.gsub(str, "(.*/)(.*)", "%2")
	return name
end

function file_exists(name)
    local f=io.open(name,"r")
    if f~=nil then io.close(f) return true else return false end
end

function urlencode (str)
    if str ~= nil then
        str = string.gsub (str, "([^0-9a-zA-Z !'()*._~-])", -- locale independent
        function (c) return string.format ("%%%02X", string.byte(c)) end)
        str = string.gsub (str, " ", "+")
    else 
        str = string.gsub ("", "([^0-9a-zA-Z !'()*._~-])", -- locale independent
        function (c) return string.format ("%%%02X", string.byte(c)) end) 
    end

    return str
 end

 function urldecode (str)
    str = string.gsub (str, "+", " ")
    str = string.gsub (str, "%%(%x%x)", function(h) return string.char(tonumber(h,16)) end)
    return str
 end

 function count (data)
    -- if not data == nil then
        return table.getn(data);
    -- else
    --     return 0;
    -- end
    
 end

 function filesize (fileurl)
    local file = io.open(fileurl,"r")
    local current = file:seek()      -- get current position
    local size = file:seek("end")    -- get file size
    file:seek("set", current)        -- restore position
    file:close()
    return size
end

function curl_result(resutl)
    
     if(tostring(result) ~= "nil") then
         return lunajson.decode( result )
     else
        data = '{"success": false}';
        return lunajson.decode( data );
     end
end

function format_seconds(seconds)
    local seconds = tonumber(seconds);
    if seconds == 0 then
        return "00:00:00";
    else
        hours = string.format("%02.f", math.floor(seconds/3600));
        minutes = string.format("%02.f", math.floor(seconds/60 - (hours*60)));
        seconds = string.format("%02.f", math.floor(seconds - hours*3600 - minutes *60));
        return string.format("%02d:%02d:%02d", hours, minutes, seconds);
    end
end

function mysplit (inputstr, sep)
    freeswitch.consoleLog("notice", "LINE["..debug.getinfo(1).currentline.."]inputstr=>"..tostring(inputstr)..tostring(sep).."\n")
    if sep == nil then
       sep = "%s"
    end
    local t={}
    for str in string.gmatch(inputstr, "([^"..sep.."]+)") do
       table.insert(t, str)
    end
    return t
 end

function bool_to_number(value)
    return value and 1 or 0
  end