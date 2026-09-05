#!/usr/bin/env python3
"""Menu key presses reach their target, and departments ring.

WHAT WAS WRONG
When a caller presses a key on a menu, the menu (built by the configuration
service) transfers the same call into a context named after the target type -
queue, extension, number, voicemail, ivr, message, department - with the
target as the destination number. The router answered only "public" and
"internal". Every other context got "not found", so every key press dropped
the call. A number pointed straight at a department fell through for a second
reason: no DEPARTMENT route type existed at all.

WHAT THIS DOES (dialplan_service.py only)
  1. The request handler answers the transfer contexts by handing the call to
     the existing inbound builder with a synthetic route - the same code that
     already routes a number to a queue, a person, voicemail, a menu or an
     outside number. Two differences, both deliberate: the channel limit is
     not applied again (the call already holds its slot), and opening hours
     are not re-judged (the caller is already inside the company's routing;
     re-judging would send an after-hours caller straight back into the menu
     that just answered them).
  2. The menu branch keeps the dialled number on the channel so the queue and
     the reports still see it after the transfer.
  3. Two new route types: GREETING (play a recording, end the call) and
     DEPARTMENT (ring the members - all at once, or in order - for the
     department's timeout, then fall over to its failover target through the
     same contexts). DEPARTMENT works from a menu key and from a number.
  4. The returned XML names the context the switch asked about; the switch
     accepts nothing else.

Usage: patch_ivr_transfers.py <dialplan_service.py>
Every anchor must match exactly once. Refuses an already-patched file, writes
a .bak beside the file and py_compiles the result. Needs the licence-channels
patch in place (it anchors on that line).
"""
import os
import py_compile
import shutil
import sys

NEW_CODE = '''# ---------------------------------------------------------------------------
# Menu key presses and department ringing.
#
# When a caller presses a key, the menu transfers the same call into a context
# named after the target type - queue, extension, number, voicemail, ivr,
# message, department - with the target as the destination number. The routing
# for each of those targets already exists in the inbound path, so a
# transferred call is handed to it as if a number pointed straight at the
# target, with two differences: no channel limit is applied again (the call
# already holds its slot), and opening hours are not re-judged (the caller is
# already inside the company's routing; re-judging would send an after-hours
# caller straight back into the menu that just answered them).
# ---------------------------------------------------------------------------

TRANSFER_CONTEXTS = {
    "queue": "QUEUE",
    "extension": "EXTENSION",
    "number": "PHONE",
    "voicemail": "VOICEMAIL",
    "ivr": "IVR",
    "message": "GREETING",
    "department": "DEPARTMENT",
    "ai": "AI",
}

# The context a route type transfers into - the same table read the other way.
# Used when a department's ring fails over to another target.
CONTEXT_FOR_ROUTE = {route: ctx for ctx, route in TRANSFER_CONTEXTS.items() if route != "AI"}
CONTEXT_FOR_ROUTE["NUMBER"] = "number"
CONTEXT_FOR_ROUTE["MESSAGE"] = "message"

DEPARTMENT_DEFAULT_TIMEOUT = 20
DEPARTMENT_TIMEOUT_RANGE = (5, 120)

_company_by_db_cache = {}
_company_by_db_cache_time = {}


def company_uuid_for_db(db_name):
    """The company that owns a tenant database, or None if it cannot be read."""
    name = str(db_name or "").strip()
    if not name:
        return None
    now = time.time()
    if name in _company_by_db_cache and (now - _company_by_db_cache_time.get(name, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _company_by_db_cache[name]
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("SELECT uuid FROM companies WHERE db_name = %s LIMIT 1", (name,))
            row = cur.fetchone() or {}
            uuid = str(row.get("uuid") or "").strip() or None
    except Exception as e:
        log("error", "company lookup by database failed: %s" % e, db=name)
        return None
    _company_by_db_cache[name] = uuid
    _company_by_db_cache_time[name] = now
    return uuid


def department_record(db_name, uuid):
    """A department (ring group) row from the tenant database, or None."""
    name = str(db_name or "").strip()
    key = str(uuid or "").strip()
    if not name or not key or not re.match(r"^[A-Za-z0-9_]+$", name):
        return None
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT uuid, name, extension, members, forward_call_actions FROM `%s`.ring_groups WHERE uuid = %%s LIMIT 1" % name,
                (key,),
            )
            row = cur.fetchone()
    except Exception as e:
        log("error", "department lookup failed: %s" % e, department=key)
        return None
    if not row:
        return None
    members = row.get("members")
    if isinstance(members, str):
        try:
            members = json.loads(members)
        except Exception:
            members = []
    return {
        "uuid": key,
        "name": str(row.get("name") or "").replace('"', ""),
        "extension": str(row.get("extension") or ""),
        "members": members if isinstance(members, list) else [],
        "settings": _as_object(row.get("forward_call_actions")),
    }


def department_dial_string(members, strategy, domain):
    """Who rings, and how. Ring all: everyone at once. Anything else: one after
    another, in the order the members were listed."""
    legs = []
    for member in members:
        ext = str((member.get("value") if isinstance(member, dict) else member) or "").strip()
        if ext:
            legs.append(f"user/{ext}_web@{domain},user/{ext}@{domain}")
    if not legs:
        return ""
    if str(strategy or "ring_all").strip().lower() == "ring_all":
        return ",".join(legs)
    return "|".join(legs)


def department_timeout(settings):
    handling = _as_object(settings.get("call_handling"))
    try:
        seconds = int(handling.get("timeout") or DEPARTMENT_DEFAULT_TIMEOUT)
    except (TypeError, ValueError):
        seconds = DEPARTMENT_DEFAULT_TIMEOUT
    low, high = DEPARTMENT_TIMEOUT_RANGE
    return max(low, min(high, seconds))


def failover_actions(route):
    """After the members did not answer: hand the call to the failover target
    through the same contexts a menu key uses. Nothing configured: nothing."""
    block = _as_object(route)
    kind = str(block.get("type") or "").strip().upper()
    value = str(block.get("value") or "").strip()
    if kind == "HANGUP":
        return [{"application": "hangup", "data": "NORMAL_CLEARING"}]
    context = CONTEXT_FOR_ROUTE.get(kind)
    if not context or not value:
        return []
    return [{"application": "transfer", "data": f"{value} XML {context}"}]


def build_transfer_dialplan(params, context, dest, domain):
    """A call a menu key (or a department failover) transferred into one of
    the TRANSFER_CONTEXTS. Routed by the inbound builder as if a number pointed
    straight at the target; see the note above."""
    route_type = TRANSFER_CONTEXTS.get(context)
    value = str(dest or "").strip()
    if route_type == "AI":
        log("warn", "menu key points at an AI callback, which the switch cannot run", value=value)
        return NOT_FOUND_TPL
    if not route_type or not value:
        log("warn", "transfer with no destination", context=context)
        return NOT_FOUND_TPL

    company_uuid = str(params.get("variable_company_uuid")
                       or params.get("variable_sip_h_X-Billing-Owner-UUID") or "").strip()
    db_name = ""
    if domain:
        db_name = DATABASE_PREFIX + str(domain).split(".")[0]
    if not company_uuid and db_name:
        company_uuid = company_uuid_for_db(db_name) or ""
    if not company_uuid or not db_name:
        log("error", "transfer cannot be placed, company unknown", context=context, value=value, domain=domain)
        return NOT_FOUND_TPL

    # The number the caller dialled, kept on the channel by the menu branch.
    original_did = str(params.get("variable_sip_h_X-DID") or "").strip() or value
    forward_name = str(params.get("variable_forward_name") or "").strip()
    route = {"type": route_type, "value": value, "label": forward_name, "name": forward_name}
    synthetic_row = {
        "forward_call_actions": {"call_handling": {"business_hours": route}},
        "company_uuid": company_uuid,
        "db_name": db_name,
    }
    handed = dict(params)
    handed["Caller-Destination-Number"] = original_did
    handed["Hunt-Destination-Number"] = original_did
    log("info", "menu key transfer", context=context, route_type=route_type, value=value,
        did=original_did, company=company_uuid)
    xml = build_inbound_dialplan(handed, synthetic_row, domain, transfer=True)
    # The switch only accepts a dialplan for the context it asked about.
    return xml.replace('<context name="public">', '<context name="%s">' % context, 1)


'''

NEW_BRANCHES = '''    if route_type in ("GREETING", "MESSAGE"):
        # Play a recording, then end the call. The file is the tenant's own
        # greeting, fetched into the mounted sounds directory exactly as a
        # queue's welcome message is.
        file_name = str(route_value or "").strip()
        path = fetch_greeting(company_uuid, file_name, log=log) if file_name else None
        actions = [
            {"application": "set", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            {"application": "answer", "data": ""},
        ]
        if path:
            actions.append({"application": "playback", "data": path})
        else:
            log("warn", "greeting could not be fetched, ending the call", did=dest, file=file_name)
        actions.append({"application": "hangup", "data": "NORMAL_CLEARING"})
        return build_internal_xml("public", f"greeting-{dest}", channel_guard + actions)
    if route_type == "DEPARTMENT":
        group = department_record(db_name, route_value)
        if not group:
            log("warn", "department not found", did=dest, department=route_value)
            return NOT_FOUND_TPL
        settings = group["settings"]
        strategy = str(settings.get("ring_strategy") or "ring_all")
        timeout = department_timeout(settings)
        dial = department_dial_string(group["members"], strategy, domain)
        after = failover_actions(_as_object(settings.get("call_handling")).get("failover"))
        if not dial:
            log("warn", "department has no members", did=dest, department=group["name"])
            if not after:
                return NOT_FOUND_TPL
        welcome = _as_object(_as_object(settings.get("media")).get("welcome"))
        welcome_actions = []
        if welcome.get("enabled") and welcome.get("value"):
            path = fetch_greeting(company_uuid, str(welcome.get("value")), log=log)
            if path:
                welcome_actions = [{"application": "answer", "data": ""},
                                   {"application": "playback", "data": path}]
        actions = [
            {"application": "set", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            {"application": "set", "data": f"sip_h_X-Billing-Owner-UUID={company_uuid}"},
            {"application": "set", "data": "sip_h_X-ForwardType=DEPARTMENT"},
            {"application": "set", "data": f"sip_h_X-ForwardValue={route_value}"},
            {"application": "set", "data": f"sip_h_X-ForwardName={group['name']}"},
            {"application": "set", "data": f"call_timeout={timeout}"},
            {"application": "set", "data": "continue_on_fail=true"},
            {"application": "set", "data": "hangup_after_bridge=true"},
        ] + welcome_actions + (
            recording_actions(company_uuid) if should_record(company_recording_policy(db_name), "inbound") else []
        )
        if dial:
            actions.append({"application": "bridge", "data": dial})
        actions += after
        log("info", "department rings", did=dest, department=group["name"],
            members=len(group["members"]), strategy=strategy, timeout=timeout)
        return build_internal_xml("public", f"department-{dest}", channel_guard + actions)
'''

EDITS = [
    # 1. The builder learns it is routing a transferred call.
    ("def build_inbound_dialplan(params, did_row, domain):\n",
     "def build_inbound_dialplan(params, did_row, domain, transfer=False):\n"),
    # 2. No second channel limit on a call that already holds its slot.
    ("    channel_guard = limit_actions(company_uuid, company_licence_count(company_uuid))\n",
     "    channel_guard = [] if transfer else limit_actions(company_uuid, company_licence_count(company_uuid))\n"),
    # 3. Opening hours are judged once, on the way in - never on a key press.
    ("    if company_closed or number_closed:\n",
     "    if (company_closed or number_closed) and not transfer:\n"),
    # 4. The menu keeps the dialled number on the channel for after the transfer.
    ('''    if route_type == "IVR":
        # route_value is the IVR's UUID, and the generated ivr.conf names each
        # menu by that same UUID, so it is passed straight through.
        actions = [
            {"application": "set", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            {"application": "set", "data": f"sip_h_X-Billing-Owner-UUID={company_uuid}"},
            {"application": "answer", "data": ""},
''',
     '''    if route_type == "IVR":
        # route_value is the IVR's UUID, and the generated ivr.conf names each
        # menu by that same UUID, so it is passed straight through.
        actions = [
            {"application": "set", "data": f"sip_h_X-Domain={domain}"},
            {"application": "set", "data": f"company_uuid={company_uuid}"},
            {"application": "set", "data": f"sip_h_X-Billing-Owner-UUID={company_uuid}"},
            {"application": "set", "data": f"sip_h_X-DID={dest}"},
            {"application": "answer", "data": ""},
'''),
    # 5. Two new route types, ahead of HANGUP.
    ('''    if route_type == "HANGUP":
        # The owner chose not to take calls on this number. Refusing plainly is
''',
     NEW_BRANCHES + '''    if route_type == "HANGUP":
        # The owner chose not to take calls on this number. Refusing plainly is
'''),
    # 6. The handler answers the transfer contexts.
    ('''        elif context == "public" or (not context and dest):
            did_row = lookup_did(dest)
            if did_row:
                response = build_inbound_dialplan(params, did_row, domain)
            else:
                log("debug", "DID not found", dest=dest)
''',
     '''        elif context == "public" or (not context and dest):
            did_row = lookup_did(dest)
            if did_row:
                response = build_inbound_dialplan(params, did_row, domain)
            else:
                log("debug", "DID not found", dest=dest)
        elif context in TRANSFER_CONTEXTS:
            response = build_transfer_dialplan(params, context, dest, domain)
'''),
    # 7. The new code itself, just above the builder.
    ("def build_inbound_dialplan(params, did_row, domain, transfer=False):\n",
     NEW_CODE + "def build_inbound_dialplan(params, did_row, domain, transfer=False):\n"),
]


def main(argv):
    if len(argv) != 2:
        sys.exit(__doc__)
    path = argv[1]
    with open(path) as fh:
        text = fh.read()
    if "def build_transfer_dialplan(" in text:
        sys.exit("%s: already patched, refusing to run twice" % path)
    if "company_licence_count" not in text:
        sys.exit("%s: the licence-channels patch is not in this file; apply it first" % path)
    for old, new in EDITS:
        n = text.count(old)
        if n != 1:
            sys.exit("%s: anchor found %d times, expected 1:\n%s" % (path, n, old[:160]))
        text = text.replace(old, new)
    shutil.copy2(path, path + ".bak")
    with open(path, "w") as fh:
        fh.write(text)
    py_compile.compile(path, doraise=True)
    print("patched %s (%d edits)" % (os.path.basename(path), len(EDITS)))


if __name__ == "__main__":
    main(sys.argv)
