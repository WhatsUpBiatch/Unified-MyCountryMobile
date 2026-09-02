#!/usr/bin/env python3
"""Give server-placed campaign calls somewhere to go once the customer answers.

The originator dials a campaign lead with `... outbound XML campaign`: when the
customer picks up, the switch asks this service for the dialplan of extension
"outbound" in context "campaign". The service only knew "internal", "default"
and "public", so every server-placed campaign call was answered and then
dropped. This adds the "campaign" context: it reads the campaign's queue from
the X-ForwardValue header the originator stamped on the leg, and hands the
call to the queue exactly the way an inbound number routed to that queue is
handled - same greeting and hold audio, same recording rule, same queue
script - so the campaign's agents ring.

A campaign call that arrives with no queue, or a queue that cannot be found,
is hung up with a clear reason rather than left connected to silence.

Idempotent: running it twice changes nothing the second time.
"""
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "/opt/fs-xml-api-1.2.5/dialplan_service.py"
src = open(PATH).read()

if "def build_campaign_dialplan" in src:
    print("already applied")
    sys.exit(0)

# 1. The handler, placed after the inbound builder it borrows from.
old = '''def extract_domain(params):'''
new = '''def campaign_queue_record(queue_key):
    """Name, extension and company of the queue a campaign call is heading into.

    The originator sends the queue's record id. An older campaign may still
    carry the queue's extension number instead, so that is accepted too, with
    the domain the leg belongs to. None when nothing matches; the caller then
    ends the call rather than parking it on nothing.
    """
    from queue_media import _queues_collection

    key = str(queue_key or "").strip()
    if not key:
        return None
    collection = _queues_collection()
    if collection is None:
        return None
    projection = {"name": 1, "extension": 1, "company_uuid": 1, "domain": 1, "campaign_uuid": 1}
    try:
        from bson import ObjectId

        if len(key) == 24:
            try:
                record = collection.find_one({"_id": ObjectId(key)}, projection)
                if record:
                    return record
            except Exception:
                pass
        ident, _, domain = key.partition("@")
        query = {"extension": ident, "type": "CAMPAIGN"}
        if domain:
            query["domain"] = domain
        return collection.find_one(query, projection)
    except Exception as e:
        log("warn", "campaign queue lookup failed", queue=key, error=str(e))
        return None


def build_campaign_dialplan(params, domain):
    """The answered leg of a server-placed campaign call: drop it into the
    campaign's queue so an agent is rung, or end it cleanly."""
    queue_key = params.get("variable_sip_h_X-ForwardValue") or params.get("variable_forward_value") or ""
    company_uuid = params.get("variable_company_uuid") or params.get("variable_accountcode") or ""
    campaign_uuid = params.get("variable_sip_h_X-CampaignUuid") or ""
    campaign_name = params.get("variable_sip_h_X-CampaignName") or ""
    contact_number = params.get("variable_sip_h_X-ContactNumber") or params.get("Caller-Destination-Number", "")

    record = campaign_queue_record(queue_key)
    if not record:
        log("warn", "campaign call has no queue to land in", queue=queue_key, campaign=campaign_uuid, to=contact_number)
        return build_internal_xml("campaign", "outbound", [
            {"application": "log", "data": "WARNING campaign call with no queue (%s), hanging up" % queue_key},
            {"application": "hangup", "data": "NO_ROUTE_DESTINATION"},
        ])

    queue_uuid = str(record.get("_id"))
    queue_name = str(record.get("name") or campaign_name or queue_uuid)
    queue_exten = str(record.get("extension") or "")
    company_uuid = str(record.get("company_uuid") or company_uuid or "")
    if not domain:
        domain = str(record.get("domain") or "")
    db_name = domain_to_dbname(domain) if domain else ""

    log("info", "campaign call answered, routing to queue", campaign=campaign_uuid, queue=queue_uuid,
        queue_name=queue_name, to=contact_number, domain=domain)

    queue_welcome, queue_audio = queue_audio_actions(queue_uuid, company_uuid, log=log)

    actions = [
        {"application": "set", "data": "sip_h_X-Domain=%s" % domain},
        {"application": "set", "data": "company_uuid=%s" % company_uuid},
        {"application": "set", "data": "sip_h_X-Billing-Owner-UUID=%s" % company_uuid},
        # Read by callcenter-queue.lua: the uuid finds the queue, the rest is
        # what it reports itself as.
        {"application": "set", "data": "sip_h_X-Queue=%s" % queue_uuid},
        {"application": "set", "data": "cc_queue_name=%s" % queue_name},
        {"application": "set", "data": "cc_queue_exten=%s" % queue_exten},
        {"application": "set", "data": "sip_h_X-ForwardName=%s" % queue_name},
        # The customer is already on the line (this leg answered), so a short
        # wait is all that is acceptable before the call counts as abandoned;
        # the dialer will not have placed it unless an agent looked free.
        {"application": "set", "data": "cc_queue_timeout=45"},
        {"application": "set", "data": "cc_no_agent_timeout=10"},
    ] + queue_audio + queue_welcome + (
        recording_actions(company_uuid, direction="outbound")
        if db_name and should_record(company_recording_policy(db_name), "outbound") else []
    ) + [
        {"application": "lua", "data": FS_SCRIPTS + "callcenter-queue.lua"},
    ]
    return build_internal_xml("campaign", "outbound", actions)


def extract_domain(params):'''
assert src.count(old) == 1, "extract_domain anchor"
src = src.replace(old, new)

# 2. Dispatch the new context.
old = '''        elif context == "public" or (not context and dest):
            did_row = lookup_did(dest)'''
new = '''        elif context == "campaign":
            response = build_campaign_dialplan(params, domain)
        elif context == "public" or (not context and dest):
            did_row = lookup_did(dest)'''
assert src.count(old) == 1, "dispatch anchor"
src = src.replace(old, new)

open(PATH, "w").write(src)
print("applied")
