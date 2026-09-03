fs_media_api_addr = "https://api.mycountrymobile.com/api/media";
fs_server_api_addr = "https://api.mycountrymobile.com/api/v1";
fs_conf_url = "conference.meet-dev.mycountrymobile.com";
 
recording_path="/opt/call-recordings/tmp/";
voicemail_greeting_path="/usr/share/freeswitch/sounds/custom/en/voicemail_greeting/";
away_greeting_path="/usr/share/freeswitch/sounds/custom/en/away_greeting/";
voicemail_folders_path="/usr/share/freeswitch/storage/voicemail/default/";
ivr_folder_path="/usr/share/freeswitch/sounds/custom/en/ivr/";
sounds_dir = "/usr/share/freeswitch/sounds/en/us/callie/";
base_dir = "/opt/call-recordings/";  -- mounted host path; /usr/share/freeswitch/ is NOT mounted, files there vanish on container restart
timeout = 30;
uuid = "";
sip_trunk = "sip.telnyx.com";

-- Where the internal API lives, and the shared secret the switch uses to
-- prove it is the switch. The same secret PrivateCallAuth already checks
-- for the other internal calls.
fs_internal_api_addr = "https://api.mycountrymobile.com/api/internal";
fs_internal_key = "<REDACTED: PRIVATE_CALL_SECRET, read from /var/www/prod/default-api/.env on the server>";

recording_announcement_path="/etc/freeswitch/sounds/mcm/recording-announcement.wav";
