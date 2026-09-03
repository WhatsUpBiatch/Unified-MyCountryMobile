# switch-live — the code that exists only on the production server

Copied from 142.93.121.121 (mcm-new) on 3 September 2026. Until this commit these
files had no copy anywhere: the call router, the queue engine, the agent lookup,
the directory service, the config shim, the CDR ingester, the recording tools,
and the FreeSWITCH / Kamailio configuration. ~30 `.bak-<date>` files sat beside
them as the only history.

Paths mirror the server:

    opt/fs-xml-api-1.2.5/dialplan_service.py   the call router (:9000) — every call decision
    opt/fs-xml-api-1.2.5/queue_media.py        queue audio fetch (reads Wasabi directly)
    opt/fs-xml-api-1.2.5/channel_limit.py      per-customer concurrency cap
    opt/queue-agent-service/                   agent lookup for queues (:9006)
    opt/callcenter-config-shim/                configuration shim (:9002 → :9012)
    opt/fs-directory-manager/directory_service.py   SIP directory (:9001)
    opt/cdr-ingest*.py, backfill-*.py          CDR → call_history
    opt/recording-upload.sh, recording-control/  recordings
    opt/kamailio-live-calls/                   live-calls monitor
    etc/freeswitch/scripts/*.lua               queue engine, voicemail, recording
    etc/freeswitch/vars.xml, autoload_configs/, dialplan/
    etc/kamailio/*.cfg, include/
    systemd/                                   the unit files

Excluded on purpose: `.env` files, certificates, `kamailio.db`, compiled
binaries, `*.bak*`, runtime data. Two secrets inside otherwise-source files are
redacted and marked: `fs_internal_key` in `scripts/config.lua` and
`default_password` in `vars.xml`. Restore them from the server's env before
deploying.

The Go services of the same names in Bitbucket (fs-xml-api,
fs-directory-manager) are NOT what runs. The Python in this directory is.

Rule from here: edit these here, commit, deploy with a script. No more `.bak`.
