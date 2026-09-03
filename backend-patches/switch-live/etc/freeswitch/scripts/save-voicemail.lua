require("functions");

api = freeswitch.API();
accountcode = session:getVariable("accountcode");
uniqueid = session:getVariable("uuid");

voicemail_save(accountcode, uniqueid);
