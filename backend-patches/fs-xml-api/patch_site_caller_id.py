"""Make a location's caller-ID rule reach the outbound call.

WHY. Company > Locations lets an administrator choose, per location, what the
people there show when they call out:

    caller_id_type   screen label           meaning
    MAIN             "Company main number"  show the company's main number,
                                            not the person's own
    CUSTOM           "Custom name"          show `caller_id_name` as the name
    BLANK            "Withheld"             caller ID withheld

The rule is saved on `sites` (main database, beside `users` and
`did_numbers`) and nothing on the switch ever read it. The outbound dialplan
in dialplan_service.py takes the person's own `users.caller_id`, or the
company's first active number, or the extension - and that is what every call
shows whatever the location says.

WHAT IT DOES. Three things, all inside the outbound path:

  1. `site_caller_id_rule(site_uuid, company_uuid)` beside `get_caller_did`:
     one SELECT on `sites` by uuid AND company (a site uuid from another
     company is ignored, not trusted), cached per location for
     CALLING_RULES_CACHE_SECONDS. Anything going wrong returns None, logged
     at error, so the call goes out exactly as it does today. Returns
     {"type": "MAIN"|"CUSTOM"|"BLANK", "name": str} or None.

  2. `site_caller_id_actions(rule, caller_id, company_uuid)`: the extra set
     actions the rule adds and the number the call goes out with.
       CUSTOM  effective_caller_id_name = the trimmed name (empty: nothing)
       MAIN    effective_caller_id_number = get_caller_did(company) (none:
               nothing); the same number goes in the From of the bridge
       BLANK   origination_privacy=hide_name:hide_number, sip_h_Privacy=id,
               effective_caller_id_name=Anonymous; the number is KEPT because
               carriers need a real number in From/P-Asserted-Identity - the
               privacy header is what withholds it
     Each applied rule logs one info line and sets `mcm_site_caller_id` on the
     channel so the rule is visible in the dialplan XML and on the call.

  3. In `build_user_dialplan`, after the country check (which judges the
     person's own number - untouched) and before the carrier leg is built:
     the rule is read, the extra actions are spliced in immediately after the
     existing effective_caller_id_name / effective_caller_id_number sets, and
     for MAIN `caller_id` is rebound so the existing number set, the log line
     and the bridge's sip_from_uri all carry the same number. No existing
     action is removed or reordered; recording and refusal logic untouched.

Internal extension-to-extension calls are left alone: they show the
extension, and the rule is about what the outside world sees.

Anchors live only inside `get_caller_did` and `build_user_dialplan`, all
above `build_inbound_dialplan`, so this and the inbound patch being written at
the same time apply in either order. The patch checks that itself.

Idempotent: a marker comment records that the helper is present, and a second
run stops before touching anything. Every anchor must match exactly once or
the patch refuses to write.
"""

import io
import os
import py_compile
import shutil
import sys
import time

PATH = sys.argv[1]
MARKER = "# site_caller_id: a location's caller-ID rule reaches the outbound call"

with io.open(PATH, encoding="utf-8") as handle:
    text = handle.read()

if MARKER in text:
    print("already applied: %s" % PATH)
    raise SystemExit(0)


# --- 1. the helpers, placed right after get_caller_did, which MAIN uses -----

ANCHOR_HELPER = '''def get_caller_did(company_uuid):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT did_number FROM did_numbers
                WHERE company_uuid = %s AND status = 'A'
                ORDER BY id LIMIT 1
            """, (company_uuid,))
            row = cur.fetchone()
        return row["did_number"] if row else None
    except Exception as e:
        log("error", f"caller DID lookup error: {e}")
        return None
'''

HELPER = ANCHOR_HELPER + '''

''' + MARKER + '''
#
# Company > Locations offers three rules per location, saved on `sites` in
# the main database beside `users` and `did_numbers`:
#   MAIN    "Company main number" - show the company's main number, not the
#           person's own
#   CUSTOM  "Custom name"         - show `caller_id_name` as the name
#   BLANK   "Withheld"            - caller ID withheld
# Anything else (NULL, '', an unknown word) is "no rule": the call goes out
# exactly as it does today. Cached per location because this sits on the
# critical path of every outbound call.
_site_caller_id_cache = {}
_site_caller_id_time = {}
SITE_CALLER_ID_TYPES = ("MAIN", "CUSTOM", "BLANK")
# What a withheld call shows as its name. The number is kept on purpose:
# carriers need a real number in From / P-Asserted-Identity, and it is the
# privacy header, not a missing number, that withholds it from the callee.
WITHHELD_CALLER_NAME = "Anonymous"


def _caller_id_text(value):
    """A name as it may safely appear in the dialplan XML this service hands
    the switch. build_internal_xml does not escape attribute values, so the
    four characters that would break the document are dropped rather than
    passed through."""
    text = str(value or "").strip()
    return re.sub(r'[<>&"]', "", text).strip()


def site_caller_id_rule(site_uuid, company_uuid):
    """The caller-ID rule of one location: {"type": ..., "name": ...} or None
    where there is no location, no rule, or the lookup fails.

    None must always mean "what happens today". The rule is a courtesy to the
    callee; a database hiccup silencing a company's outbound calls would be
    the far worse failure, so nothing here is allowed to raise.

    The company is part of the WHERE so a `users.site_uuid` pointing at some
    other company's location is ignored rather than trusted.
    """
    if not site_uuid or not company_uuid:
        return None
    key = "%s:%s" % (company_uuid, site_uuid)
    now = time.time()
    if key in _site_caller_id_cache and (now - _site_caller_id_time.get(key, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _site_caller_id_cache[key]
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT caller_id_type, caller_id_name FROM sites
                WHERE uuid = %s AND company_uuid = %s
                LIMIT 1
            """, (site_uuid, company_uuid))
            row = cur.fetchone()
    except Exception as e:
        # Not cached: the next call tries again, and until then goes out as
        # today.
        log("error", "site caller-id lookup failed, leaving caller id as it is: %s" % e,
            site=site_uuid, company=company_uuid)
        return None
    rule = None
    if row:
        rule_type = str(row.get("caller_id_type") or "").strip().upper()
        if rule_type in SITE_CALLER_ID_TYPES:
            rule = {"type": rule_type, "name": _caller_id_text(row.get("caller_id_name"))}
    # "No site" and "no rule" are cached too - they are the common case and
    # cost a query per call otherwise.
    _site_caller_id_cache[key] = rule
    _site_caller_id_time[key] = now
    return rule


def site_caller_id_actions(rule, caller_id, company_uuid):
    """What the rule adds to the outbound dialplan: (extra actions, the number
    the call goes out with). The caller splices the actions in right after
    the effective_caller_id_* sets, so everything after them - recording,
    the bridge - sees the final values. An empty list and the same number
    means the rule changed nothing."""
    if not rule:
        return [], caller_id
    rule_type = rule.get("type")

    if rule_type == "CUSTOM":
        name = _caller_id_text(rule.get("name"))
        if not name:
            return [], caller_id
        log("info", "site caller-id rule applied", rule="CUSTOM", name=name, number=caller_id)
        return [
            {"application": "set", "data": "mcm_site_caller_id=CUSTOM"},
            {"application": "set", "data": f"effective_caller_id_name={name}"},
        ], caller_id

    if rule_type == "MAIN":
        main_number = get_caller_did(company_uuid)
        if not main_number:
            return [], caller_id
        log("info", "site caller-id rule applied", rule="MAIN", number=main_number, was=caller_id)
        # The caller rebinds caller_id to main_number, so the existing
        # effective_caller_id_number set and the bridge's From both carry it.
        return [
            {"application": "set", "data": "mcm_site_caller_id=MAIN"},
        ], main_number

    if rule_type == "BLANK":
        log("info", "site caller-id rule applied", rule="BLANK", number=caller_id)
        # export, not set, so the privacy request reaches the carrier leg the
        # bridge creates - the same way the outbound X- headers travel.
        return [
            {"application": "set", "data": "mcm_site_caller_id=BLANK"},
            {"application": "export", "data": "origination_privacy=hide_name:hide_number"},
            {"application": "export", "data": "sip_h_Privacy=id"},
            {"application": "set", "data": f"effective_caller_id_name={WITHHELD_CALLER_NAME}"},
        ], caller_id

    return [], caller_id
'''


# --- 2. read the rule once the call is allowed and before the leg is built --

ANCHOR_LOG = '''    log("info", "outbound call", src=caller_ext, dst=dest, domain=domain,
        caller_id=caller_id, provider=provider["name"],
        formatted=formatted_dest, provider_ip=provider_ip)
'''

RULE_THEN_LOG = '''    # site_caller_id: the location's rule. Read after the country check, which
    # judges the person's OWN number and is left as it is, and before the
    # carrier leg is built, so the log line, the effective_caller_id_number
    # set and the From of the bridge all carry the number the rule chose.
    site_actions, caller_id = site_caller_id_actions(
        site_caller_id_rule(user.get("site_uuid"), company_uuid), caller_id, company_uuid)

''' + ANCHOR_LOG


# --- 3. splice the rule's actions in right after the existing caller-id sets

ANCHOR_SETS = '''        {"application": "set", "data": f"effective_caller_id_name={caller_name}"},
        {"application": "set", "data": f"effective_caller_id_number={caller_id}"},
        {"application": "export", "data": f"sip_h_X-Billable=Y"},
'''

SETS_THEN_RULE = '''        {"application": "set", "data": f"effective_caller_id_name={caller_name}"},
        {"application": "set", "data": f"effective_caller_id_number={caller_id}"},
    ] + site_actions + [
        {"application": "export", "data": f"sip_h_X-Billable=Y"},
'''


EDITS = (
    (ANCHOR_HELPER, HELPER, "helper anchor (get_caller_did)"),
    (ANCHOR_LOG, RULE_THEN_LOG, "outbound log line in build_user_dialplan"),
    (ANCHOR_SETS, SETS_THEN_RULE, "caller-id sets in build_user_dialplan"),
)

# Every anchor is checked before anything is replaced, so a file that matches
# two of three is left exactly as it was.
for old, _new, label in EDITS:
    count = text.count(old)
    if count != 1:
        raise SystemExit("no single match for %s (found %d) - nothing written" % (label, count))

# The inbound half of this file is being patched separately. Every anchor here
# must sit above build_inbound_dialplan, or the two patches could collide.
INBOUND = "def build_inbound_dialplan("
if text.count(INBOUND) != 1:
    raise SystemExit("cannot find build_inbound_dialplan - nothing written")
inbound_at = text.index(INBOUND)
for old, _new, label in EDITS:
    if text.index(old) >= inbound_at:
        raise SystemExit("%s sits inside or below build_inbound_dialplan - nothing written" % label)
# And the two dialplan anchors must be inside build_user_dialplan itself.
user_at = text.index("def build_user_dialplan(")
for old, _new, label in EDITS[1:]:
    if not (user_at < text.index(old) < inbound_at):
        raise SystemExit("%s is not inside build_user_dialplan - nothing written" % label)

for old, new, _label in EDITS:
    text = text.replace(old, new)

backup = "%s.bak-site-caller-id-%s" % (PATH, time.strftime("%Y%m%d-%H%M%S"))
shutil.copy2(PATH, backup)

with io.open(PATH, "w", encoding="utf-8") as handle:
    handle.write(text)

try:
    py_compile.compile(PATH, doraise=True)
except py_compile.PyCompileError as e:
    shutil.copy2(backup, PATH)
    raise SystemExit("patched file does not compile, original restored: %s" % e)

print("patched %s (backup %s)" % (PATH, os.path.basename(backup)))
