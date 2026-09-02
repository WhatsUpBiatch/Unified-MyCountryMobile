#!/usr/bin/env python3
"""Checks for the campaign context in dialplan_service.py.

Usage: python3 campaign_context_test.py /path/to/patched/dialplan_service.py

Loads the service with its database drivers stubbed out, so it runs on any
machine, and exercises build_campaign_dialplan and the context dispatch.
"""
import importlib.util
import os
import sys
import types

PATH = sys.argv[1] if len(sys.argv) > 1 else "/opt/fs-xml-api-1.2.5/dialplan_service.py"
SERVICE_DIR = os.path.dirname(os.path.abspath(PATH))
sys.path.insert(0, SERVICE_DIR)

# Drivers the module imports at load time; none are used by what is tested here.
for name in ("pymysql", "pymysql.cursors", "pymongo", "bson"):
    if name not in sys.modules:
        module = types.ModuleType(name)
        if name == "pymysql":
            module.cursors = types.ModuleType("pymysql.cursors")
        if name == "bson":
            class ObjectId(str):  # noqa: N801 - mirrors the real class name
                def __init__(self, value):
                    if len(str(value)) != 24:
                        raise ValueError("bad id")
            module.ObjectId = ObjectId
        sys.modules[name] = module

spec = importlib.util.spec_from_file_location("dialplan_service", PATH)
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

QUEUE_ID = "6a7db46006ddfc67d934bef5"
RECORD = {"_id": QUEUE_ID, "name": "India Full Day 3", "extension": "2343",
          "company_uuid": "a5bd159a-cdfd-42fc-9a8b-6b04a1ba8ff5",
          "domain": "1785312032037.mycountrymobile.com", "type": "CAMPAIGN"}


class FakeCollection:
    def find_one(self, query, projection=None):
        if query.get("_id") == QUEUE_ID:
            return dict(RECORD)
        if query.get("extension") == "2343":
            return dict(RECORD)
        return None


import queue_media  # noqa: E402  (the service imported it, so it is importable)

queue_media._queues_collection = lambda: FakeCollection()
service.queue_audio_actions = lambda queue_id, company, log=None: (
    [{"application": "playback", "data": "welcome.wav"}],
    [{"application": "set", "data": "cc_ring_strategy=ring-all"}],
)
service.company_recording_policy = lambda db_name: "all"
service.should_record = lambda mode, direction: True
service.recording_actions = lambda company, direction="inbound": [{"application": "set", "data": "record_it=%s" % direction}]

checks = 0


def check(name, condition):
    global checks
    if not condition:
        print("FAIL %s" % name)
        sys.exit(1)
    checks += 1
    print("ok   %s" % name)


params = {
    "Caller-Context": "campaign",
    "Caller-Destination-Number": "outbound",
    "variable_sip_h_X-ForwardValue": QUEUE_ID,
    "variable_sip_h_X-CampaignUuid": "6a7db46006ddfc67d934beff",
    "variable_sip_h_X-CampaignName": "India%20Full%20Day%203",
    "variable_sip_h_X-ContactNumber": "919569009930",
    "variable_sip_h_X-Domain": "1785312032037.mycountrymobile.com",
    "variable_company_uuid": RECORD["company_uuid"],
}

xml = service.build_campaign_dialplan(params, "1785312032037.mycountrymobile.com")
check("answers in the campaign context, extension outbound",
      '<context name="campaign">' in xml and 'name="outbound"' in xml)
check("hands the queue's own id to the queue script", "sip_h_X-Queue=%s" % QUEUE_ID in xml)
check("names the queue for reporting", "cc_queue_name=India Full Day 3" in xml and "cc_queue_exten=2343" in xml)
check("runs the queue script last", xml.rstrip().rfind("callcenter-queue.lua") > xml.rfind("cc_queue_timeout"))
check("carries the queue's welcome and behaviour audio", "welcome.wav" in xml and "cc_ring_strategy=ring-all" in xml)
check("records as an outbound call when the company records", "record_it=outbound" in xml)
check("bounds how long an answered customer waits", "cc_queue_timeout=45" in xml)

# The originator of an older campaign may send the queue's extension instead of its id.
xml_ext = service.build_campaign_dialplan(
    dict(params, **{"variable_sip_h_X-ForwardValue": "2343@1785312032037.mycountrymobile.com"}),
    "1785312032037.mycountrymobile.com",
)
check("accepts extension@domain as the queue key", "sip_h_X-Queue=%s" % QUEUE_ID in xml_ext)

xml_none = service.build_campaign_dialplan(dict(params, **{"variable_sip_h_X-ForwardValue": "nope"}), "x.mycountrymobile.com")
check("a call with no queue is hung up with a reason, not parked",
      "hangup" in xml_none and "NO_ROUTE_DESTINATION" in xml_none and "callcenter-queue.lua" not in xml_none)

# Control: the service never recorded before this leg answered (no record when policy says no).
service.should_record = lambda mode, direction: False
xml_norec = service.build_campaign_dialplan(params, "1785312032037.mycountrymobile.com")
check("control: no recording actions when the company does not record", "record_it=" not in xml_norec)

# Dispatch: the request handler routes the new context.
source = open(PATH).read()
check("the request handler dispatches context campaign", 'elif context == "campaign":' in source)
check("the untouched contexts are still dispatched",
      'if context in ("internal", "default")' in source and 'elif context == "public"' in source)

print("\n%d campaign-context checks passed" % checks)
