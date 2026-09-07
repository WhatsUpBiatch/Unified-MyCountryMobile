#!/usr/bin/env python3
"""After every answered queue call, tell the agent service who took it and for
how long - and send the caller's number with every poll.

Two routing features depend on facts the switch alone knows and never passed
on: how long an agent actually talked (the "least talk time" strategy sorted
on a figure that was 0 for everybody) and which agent a caller spoke to last
(the "send them back to the same person" setting). The service already
accepts bookkeeping reports; this adds one, `handled`, sent once per answered
call from the same place the bridge result is already recorded, in both ring
modes. Talk time is measured from `bridge_epoch`, which the switch stamps on
the caller's channel the moment the two legs join; when that is missing the
report carries 0 and adds nothing.

The caller's number also travels with each agent lookup (`caller=`), which is
what lets the service prefer the last agent. Everything fails towards the old
behaviour: a failed report is a log line, never a dropped call.

Idempotent. Usage: patch_report_handled.py /etc/freeswitch/scripts/callcenter-queue.lua
Requires patch_position_announce.py to have been applied first.
"""
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "/etc/freeswitch/scripts/callcenter-queue.lua"
src = open(PATH).read()

if "local function report_handled" in src:
    print("already applied")
    sys.exit(0)
if "announce_position" not in src:
    raise SystemExit("apply patch_position_announce.py first")

def replace_once(old, new, what):
    global src
    n = src.count(old)
    if n != 1:
        raise SystemExit("anchor for %s matched %d times, expected 1" % (what, n))
    src = src.replace(old, new)

# 1. The caller's number rides along with the lookup.
replace_once(
    '''  if call_timeout and call_timeout > 0 then
    table.insert(query_params, "call_timeout=" .. urlencode(tostring(call_timeout)))
  end
''',
    '''  if call_timeout and call_timeout > 0 then
    table.insert(query_params, "call_timeout=" .. urlencode(tostring(call_timeout)))
  end
  -- So the service can send a repeat caller back to whoever they spoke to
  -- last, when the queue asks for that.
  if caller_number and caller_number ~= "" and caller_number ~= "unknown" then
    table.insert(query_params, "caller=" .. urlencode(caller_number))
  end
''',
    "lookup params",
)

# 2. The report itself, beside the no-answer report it mirrors.
replace_once(
    '''-- Function to record agent no-answer event
local function record_agent_no_answer(agent_name, domain, queue_id)
''',
    '''-- Seconds the caller and the agent were actually joined. The switch stamps
-- bridge_epoch on the caller's channel when the legs join; the bridge app only
-- returns once they part, so "now minus then" is the talk time.
local function talk_seconds_now()
  local joined = tonumber(session:getVariable("bridge_epoch")) or 0
  if joined <= 0 then
    return 0
  end
  local talk = os.time() - joined
  if talk < 0 then
    return 0
  end
  return talk
end

-- After an answered call: who took it, for how long, and from which number.
-- The only source of talk time the routing service has, and what lets it send
-- this caller back to the same person next time. A failure here is a log
-- line; the call is already over.
local function report_handled(agent_name, domain, queue_id)
  local extension = string.match(tostring(agent_name or ""), "^([^@]+)") or tostring(agent_name or "")
  extension = string.gsub(extension, "_web", "")
  extension = string.gsub(extension, "_hw", "")
  -- Ring-all cannot always tell who picked up; "unknown" is not a person.
  if extension == "" or extension == "unknown" then
    return
  end

  local talk = talk_seconds_now()
  local url = "http://localhost:9006/api/callcenter/agents/handled"
  local payload = lunajson.encode({
    ["extension"] = extension,
    ["domain"] = domain,
    ["queue_id"] = queue_id or "",
    ["talk_time_seconds"] = talk,
    ["caller_number"] = caller_number or ""
  })

  local ok, err = pcall(curl, url, "POST", payload)
  if ok then
    freeswitch.consoleLog("notice", "Reported handled call: agent=[" .. extension .. "] talk=" .. talk .. "s caller=[" .. tostring(caller_number) .. "]\\n")
  else
    freeswitch.consoleLog("warn", "Could not report the handled call for [" .. extension .. "]: " .. tostring(err) .. "\\n")
  end
end

-- Function to record agent no-answer event
local function record_agent_no_answer(agent_name, domain, queue_id)
''',
    "report function",
)

# 3. One-at-a-time mode: right after the bridge is stamped as answered.
replace_once(
    '''    local bridge_uuid = session:getVariable("bridge_uuid") or "unknown"
    stamp_queue_bridge_vars(bridge_uuid, answered_epoch, agent.name, agent_extension, display_name)
    
    -- Publish wrap-up required event for ESL-Manager to handle (only for answered calls)
''',
    '''    local bridge_uuid = session:getVariable("bridge_uuid") or "unknown"
    stamp_queue_bridge_vars(bridge_uuid, answered_epoch, agent.name, agent_extension, display_name)
    report_handled(agent.name, queue_domain, queue_key)

    -- Publish wrap-up required event for ESL-Manager to handle (only for answered calls)
''',
    "single-agent report",
)

# 4. Ring-all mode: after the answering agent has been worked out and stamped.
replace_once(
    '''    stamp_queue_bridge_vars(      bridge_uuid,      answered_epoch,      answering_agent,      answering_agent_info.extension or "",      answering_agent_display or ""    )
''',
    '''    stamp_queue_bridge_vars(      bridge_uuid,      answered_epoch,      answering_agent,      answering_agent_info.extension or "",      answering_agent_display or ""    )
    report_handled(answering_agent, queue_domain, queue_key)
''',
    "ring-all report",
)

open(PATH, "w").write(src)
print("patched", PATH)
