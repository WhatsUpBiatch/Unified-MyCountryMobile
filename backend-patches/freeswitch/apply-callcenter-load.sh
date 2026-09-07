#!/usr/bin/env bash
# Make mod_callcenter load. This is the first domino for anything queue-shaped:
# no queue can even be TESTED until the module is running.
#
#   bash backend-patches/freeswitch/apply-callcenter-load.sh
#
# WHAT IS WRONG
# mod_callcenter asks for callcenter.conf over xml_curl at module load. Every
# config request goes to fs-configuration-manager on :9002. That endpoint
# returns 400 with an empty body for callcenter.conf, and the module gives up.
#
# WHY IT 400s
# The service has a template for callcenter.conf and tries to render it. At
# module-load time FreeSWITCH sends no queue and no domain, so the lookup finds
# nothing and it falls to its not-found path -- whose template path is an empty
# string, so it opens "" and errors. That path is inside the compiled binary and
# there is no source for it, so it cannot be fixed directly.
#
# THE FIX, AND WHY IT IS SAFE
# Sections the service has NO template for behave differently and correctly:
#   conference.conf -> 200 with an empty body
# FreeSWITCH treats an empty result as "nothing from the network" and falls back
# to the local file in autoload_configs. That is exactly how mod_conference gets
# its config today, and mod_conference is loaded and working. So the mechanism is
# not a theory -- there is a working example of it on this box right now.
#
# So: put a local callcenter.conf.xml in place, and move the broken template
# aside so callcenter.conf behaves like conference.conf. The module then loads
# from local config.
#
# WHAT THIS DOES NOT DO
# It does not make queues route calls. Queues still need (a) agents and tiers,
# which the template never rendered anyway, and (b) a dialplan branch that sends
# a caller into a queue -- neither exists. What it does is get the module running
# so callcenter_config works and queue behaviour becomes testable at all.
#
# The local config starts with NO queues, so nothing routes differently the
# moment this runs. Queues are added afterwards, deliberately.
set -euo pipefail

HOST=mcm-new
TPL=/opt/fs-configuration-manager/templates/callcenter.conf.xml
LOCAL=/etc/freeswitch/autoload_configs/callcenter.conf.xml
STAMP=$(date +%Y%m%d-%H%M%S)

say() { printf '\n=== %s\n' "$1"; }
rollback() {
  say "ROLLING BACK"
  ssh "$HOST" "mv -f $TPL.disabled-$STAMP $TPL 2>/dev/null || true; \
               rm -f $LOCAL; \
               systemctl restart fs-configuration-manager" || true
  echo "rolled back."
}

say "0/7  Before: what does the endpoint say now?"
ssh "$HOST" "curl -sS -o /dev/null -w '    callcenter.conf -> %{http_code}  (expect 400)\n' -X POST http://localhost:9002/v1/configuration -d 'section=configuration&key_value=callcenter.conf'"

say "1/7  Writing the local config (no queues yet, on purpose)"
ssh "$HOST" "cat > $LOCAL <<'XML'
<configuration name=\"callcenter.conf\" description=\"CallCenter\">
  <!-- Local config so mod_callcenter can load.

       It used to come from fs-configuration-manager over xml_curl, which
       returns 400 for this file at module-load time: FreeSWITCH sends no queue
       or domain then, the service's template renders nothing, and its not-found
       path is an empty string. The module never loaded, so no queue in the
       product has ever routed a call.

       Deliberately starts with NO queues, so putting this in place changes no
       routing on its own. Add queues afterwards with:
         callcenter_config queue load <name>
       or by restoring template rendering once the service is fixed. -->
  <settings>
  </settings>

  <queues>
  </queues>

  <agents>
  </agents>

  <tiers>
  </tiers>
</configuration>
XML
echo '    written'"

say "2/7  Disabling the broken template"
ssh "$HOST" "cp $TPL $TPL.disabled-$STAMP && rm -f $TPL && echo '    saved as $TPL.disabled-$STAMP'"

say "3/7  Restarting the configuration service"
ssh "$HOST" "systemctl restart fs-configuration-manager && sleep 3 && systemctl is-active fs-configuration-manager"

say "4/7  Endpoint should now answer 200"
CODE=$(ssh "$HOST" "curl -sS -o /dev/null -w '%{http_code}' -X POST http://localhost:9002/v1/configuration -d 'section=configuration&key_value=callcenter.conf'")
echo "    callcenter.conf -> $CODE"
if [ "$CODE" != "200" ]; then say "STILL NOT 200"; rollback; exit 1; fi

say "5/7  Control: a section that already worked must still work"
ssh "$HOST" "curl -sS -o /dev/null -w '    ivr.conf -> %{http_code}  (must stay 200)\n' -X POST http://localhost:9002/v1/configuration -d 'section=configuration&key_value=ivr.conf'"

say "6/7  Loading the module"
ssh "$HOST" "docker exec mcm-freeswitch fs_cli -x 'load mod_callcenter' 2>&1 | head -3"

say "7/7  Did it load?"
LOADED=$(ssh "$HOST" "docker exec mcm-freeswitch fs_cli -x 'show modules' 2>/dev/null | grep -ci callcenter" || echo 0)
echo "    callcenter in module list: $LOADED  (1 = loaded)"
ssh "$HOST" "docker exec mcm-freeswitch fs_cli -x 'callcenter_config queue list' 2>&1 | head -3"

if [ "$LOADED" = "0" ]; then
  say "MODULE STILL WILL NOT LOAD"
  echo "The endpoint is fixed but something else is stopping it. Rolling back so"
  echo "the box is exactly as it was; send me the output above."
  rollback
  exit 1
fi

cat <<EOF

Loaded. Backup: $TPL.disabled-$STAMP

To undo:
  ssh $HOST "mv -f $TPL.disabled-$STAMP $TPL && rm -f $LOCAL && systemctl restart fs-configuration-manager && docker exec mcm-freeswitch fs_cli -x 'unload mod_callcenter'"

WHAT THIS DID AND DID NOT DO
  Did:     the module runs, and callcenter_config answers, so queue behaviour
           can be tested for the first time.
  Did not: make queues route calls. There are no queues, no agents and no tiers
           loaded, and the dialplan still has no branch that sends a caller into
           a queue. Nothing about call routing changed today.

CHECK BEFORE TRUSTING IT
  1. Make a normal call to an extension. Nothing should have changed.
  2. Make a call to a number pointed at voicemail. Same.
  Loading a module should not disturb either, but this is a live switch.
EOF
