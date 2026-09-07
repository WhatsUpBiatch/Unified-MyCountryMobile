require("functions");

api = freeswitch.API();
uniqueID = session:getVariable("uuid");
office_id = session:getVariable("office_id");
timezone = session:getVariable("office_timezone");

voicemail_read(office_id, timezone);
