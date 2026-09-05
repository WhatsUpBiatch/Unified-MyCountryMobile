"""What a location's caller-ID rule must do to an outbound call, proved
without a database or a phone call.

Every case drives the REAL build_user_dialplan against a fake database and
reads the XML it hands the switch, because the dialplan is the only thing the
switch sees. The rule is a courtesy to the person being called; the one thing
it must never do is change or stop a call for a company that set no rule, or
whose lookup failed - so half of these cases check that nothing moved.

Usage: python3 test_site_caller_id.py <path to patched dialplan_service.py>
(the file's sibling modules channel_limit.py and queue_media.py must be
importable, so run it from a directory that has them, or set PYTHONPATH).
"""

import importlib.util
import os
import re
import sys
import types
import unittest

# The service imports pymysql at module level and only opens a connection from
# main(), so a stub is enough to import it and drive the dialplan with a fake.
if "pymysql" not in sys.modules:
    stub = types.ModuleType("pymysql")
    stub.cursors = types.ModuleType("pymysql.cursors")
    stub.cursors.DictCursor = object
    sys.modules["pymysql"] = stub
    sys.modules["pymysql.cursors"] = stub.cursors

TARGET = sys.argv[1] if len(sys.argv) > 1 else "dialplan_service.patched.py"
sys.path.insert(0, os.path.dirname(os.path.abspath(TARGET)))
spec = importlib.util.spec_from_file_location("dps", TARGET)
dps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dps)

COMPANY = "co-1111"
OTHER_COMPANY = "co-9999"
SITE = "site-aaaa"
DOMAIN = "acme.mycountrymobile.com"
DEST = "14155550100"
MAIN_DID = "18005550199"
PERSONAL = "12125550123"

PROVIDER = {"uuid": "prov-1", "name": "carrier", "host_ip_outbound": "10.0.0.9",
            "add_prefix": "", "remove_prefix": ""}


class FakeCursor:
    """Just enough of a pymysql DictCursor to route the queries the outbound
    path makes, so the REAL query path is exercised, not a stub that agrees
    with itself.

    `sites`  list of rows {uuid, company_uuid, caller_id_type, caller_id_name};
             the lookup is honoured only when BOTH uuid and company match,
             exactly as the WHERE clause on the real table would
    `did`    the company's first active number, or None for a company with none
    `boom`   an exception to raise on the sites query instead
    Everything else (company settings, the person's own settings) answers
    "nothing set", which is recording off, no calling restriction.
    """

    def __init__(self, conn):
        self.conn = conn
        self._row = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        c = self.conn
        if "FROM sites" in sql:
            c.counts["sites"] += 1
            if c.boom is not None:
                raise c.boom
            site_uuid, company_uuid = params
            self._row = None
            for row in c.sites:
                if row["uuid"] == site_uuid and row["company_uuid"] == company_uuid:
                    self._row = {"caller_id_type": row.get("caller_id_type"),
                                 "caller_id_name": row.get("caller_id_name")}
        elif "FROM did_numbers" in sql:
            c.counts["did"] += 1
            self._row = {"did_number": c.did} if c.did else None
        elif "FROM providers" in sql:
            self._row = dict(PROVIDER)
        elif "company_settings" in sql or "user_template" in sql:
            self._row = None
        elif "FROM users" in sql:
            self._row = {"settings": None}
        else:
            raise AssertionError("unexpected query: %s" % sql)

    def fetchone(self):
        return self._row


class FakeConnection:
    def __init__(self, sites=(), did=MAIN_DID, boom=None):
        self.sites = list(sites)
        self.did = did
        self.boom = boom
        self.counts = {"sites": 0, "did": 0}

    def cursor(self):
        return FakeCursor(self)


LOGS = []


def use(**kw):
    """Point the module at a fresh fake database and empty every cache, so one
    test cannot answer from what the last one read. Log lines are collected
    rather than printed, so a test can say what was logged."""
    conn = FakeConnection(**kw)
    dps.get_db = lambda: conn
    del LOGS[:]
    dps.log = lambda level, msg, **fields: LOGS.append((level, msg, fields))
    for cache in (dps._site_caller_id_cache, dps._site_caller_id_time,
                  dps._recording_cache, dps._recording_cache_time,
                  dps._calling_rules_cache, dps._calling_rules_time,
                  dps._company_settings_missing):
        cache.clear()
    dps._cached_provider = None
    dps._provider_cache_time = 0
    return conn


def site(kind, name=None, company=COMPANY, uuid=SITE):
    return {"uuid": uuid, "company_uuid": company, "caller_id_type": kind, "caller_id_name": name}


def person(site_uuid=SITE, caller_id=PERSONAL):
    return {"uuid": "user-1", "extension": "1001", "first_name": "Ann", "last_name": "Lee",
            "name": "Ann Lee", "caller_id": caller_id, "company_uuid": COMPANY,
            "site_uuid": site_uuid}


def dial(user=None):
    params = {"Caller-Destination-Number": DEST, "Hunt-Destination-Number": DEST,
              "Caller-Context": "default"}
    return dps.build_user_dialplan(params, user or person(), DOMAIN)


def actions(xml):
    """The (application, data) pairs in the order the switch will run them."""
    return re.findall(r'<action application="([^"]+)" data="([^"]*)" />', xml)


def datas(xml):
    return [d for _a, d in actions(xml)]


def value(xml, variable):
    """The LAST value a set/export gives a variable - what later actions see."""
    found = None
    for _app, data in actions(xml):
        if data.startswith(variable + "="):
            found = data[len(variable) + 1:]
    return found


def bridge_from(xml):
    m = re.search(r"sip_from_uri=sip:([^@]+)@", xml)
    return m.group(1) if m else None


def rule_logs():
    return [(level, fields) for level, msg, fields in LOGS if msg == "site caller-id rule applied"]


class A_NothingMovesWithoutARule(unittest.TestCase):
    def test_no_location_on_the_person(self):
        conn = use(sites=[site("CUSTOM", "Sales Desk")])
        xml = dial(person(site_uuid=None))
        self.assertEqual(value(xml, "effective_caller_id_name"), "Ann Lee")
        self.assertEqual(value(xml, "effective_caller_id_number"), PERSONAL)
        self.assertEqual(bridge_from(xml), PERSONAL)
        self.assertIsNone(value(xml, "mcm_site_caller_id"))
        self.assertEqual(conn.counts["sites"], 0)   # no site, no query

    def test_location_row_does_not_exist(self):
        conn = use(sites=[])
        xml = dial()
        self.assertEqual(value(xml, "effective_caller_id_name"), "Ann Lee")
        self.assertEqual(value(xml, "effective_caller_id_number"), PERSONAL)
        self.assertIsNone(value(xml, "mcm_site_caller_id"))
        self.assertEqual(conn.counts["sites"], 1)

    def test_location_with_no_rule_or_an_unknown_one(self):
        for kind in (None, "", "  ", "SOMETHING_NEW"):
            use(sites=[site(kind, "Sales Desk")])
            xml = dial()
            self.assertEqual(value(xml, "effective_caller_id_name"), "Ann Lee", kind)
            self.assertEqual(value(xml, "effective_caller_id_number"), PERSONAL, kind)
            self.assertIsNone(value(xml, "mcm_site_caller_id"), kind)

    def test_a_location_belonging_to_another_company_is_ignored(self):
        # The person's site_uuid points at a row owned by a different company.
        use(sites=[site("CUSTOM", "Somebody Else", company=OTHER_COMPANY)])
        xml = dial()
        self.assertEqual(value(xml, "effective_caller_id_name"), "Ann Lee")
        self.assertIsNone(value(xml, "mcm_site_caller_id"))

    def test_the_lookup_raising_changes_nothing(self):
        conn = use(sites=[site("BLANK")], boom=Exception(2013, "Lost connection to MySQL server"))
        xml = dial()
        self.assertEqual(value(xml, "effective_caller_id_name"), "Ann Lee")
        self.assertEqual(value(xml, "effective_caller_id_number"), PERSONAL)
        self.assertNotIn("sip_h_Privacy=id", datas(xml))
        self.assertNotIn("origination_privacy=hide_name:hide_number", datas(xml))
        self.assertIsNone(value(xml, "mcm_site_caller_id"))
        self.assertEqual(rule_logs(), [])
        errors = [msg for level, msg, _f in LOGS if level == "error"]
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("site caller-id lookup failed", errors[0])
        # A failure is not remembered: the next call tries again.
        dial()
        self.assertEqual(conn.counts["sites"], 2)

    def test_the_dialplan_is_byte_identical_to_a_rule_less_one(self):
        use(sites=[])
        without_row = dial()
        use(sites=[site(None)])
        empty_rule = dial()
        self.assertEqual(without_row, empty_rule)


class B_CustomName(unittest.TestCase):
    def test_the_name_is_shown_and_the_number_kept(self):
        xml = (use(sites=[site("CUSTOM", "  Acme Sales  ")]), dial())[1]
        self.assertEqual(value(xml, "effective_caller_id_name"), "Acme Sales")
        self.assertEqual(value(xml, "effective_caller_id_number"), PERSONAL)
        self.assertEqual(bridge_from(xml), PERSONAL)
        self.assertEqual(value(xml, "mcm_site_caller_id"), "CUSTOM")
        self.assertEqual(rule_logs(), [("info", {"rule": "CUSTOM", "name": "Acme Sales", "number": PERSONAL})])

    def test_the_override_comes_right_after_the_existing_sets(self):
        use(sites=[site("CUSTOM", "Acme Sales")])
        d = datas(dial())
        own = d.index("effective_caller_id_name=Ann Lee")
        number = d.index("effective_caller_id_number=" + PERSONAL)
        custom = d.index("effective_caller_id_name=Acme Sales")
        billable = d.index("sip_h_X-Billable=Y")
        self.assertEqual(number, own + 1)             # existing pair untouched
        self.assertLess(number, custom)               # override after them
        self.assertLess(custom, billable)             # and before what follows
        self.assertEqual(d[-1][:len("{sip_h_X-Outbound=Y")], "{sip_h_X-Outbound=Y")

    def test_an_empty_name_changes_nothing(self):
        for name in (None, "", "   "):
            use(sites=[site("CUSTOM", name)])
            xml = dial()
            self.assertEqual(value(xml, "effective_caller_id_name"), "Ann Lee", repr(name))
            self.assertIsNone(value(xml, "mcm_site_caller_id"), repr(name))

    def test_characters_that_would_break_the_xml_are_dropped(self):
        use(sites=[site("CUSTOM", 'Acme "Sales" <Team> & Co')])
        doc = dial()
        self.assertEqual(value(doc, "effective_caller_id_name"), "Acme Sales Team  Co")
        # The document still parses as the switch will read it.
        import xml.dom.minidom
        xml.dom.minidom.parseString(doc)


class C_CompanyMainNumber(unittest.TestCase):
    def test_the_main_number_replaces_the_personal_one_everywhere(self):
        conn = use(sites=[site("MAIN")], did=MAIN_DID)
        xml = dial()
        self.assertEqual(value(xml, "effective_caller_id_number"), MAIN_DID)
        self.assertEqual(bridge_from(xml), MAIN_DID)          # From matches
        self.assertNotIn("effective_caller_id_number=" + PERSONAL, datas(xml))
        self.assertEqual(value(xml, "effective_caller_id_name"), "Ann Lee")  # name kept
        self.assertEqual(value(xml, "mcm_site_caller_id"), "MAIN")
        self.assertEqual(conn.counts["did"], 1)
        self.assertEqual(rule_logs(), [("info", {"rule": "MAIN", "number": MAIN_DID, "was": PERSONAL})])

    def test_a_company_with_no_number_is_left_alone(self):
        use(sites=[site("MAIN")], did=None)
        xml = dial()
        self.assertEqual(value(xml, "effective_caller_id_number"), PERSONAL)
        self.assertEqual(bridge_from(xml), PERSONAL)
        self.assertIsNone(value(xml, "mcm_site_caller_id"))

    def test_a_person_with_no_number_of_their_own(self):
        # Today such a person already shows the company number; MAIN must not
        # change that, and must not fall through to the extension.
        use(sites=[site("MAIN")], did=MAIN_DID)
        xml = dial(person(caller_id=None))
        self.assertEqual(value(xml, "effective_caller_id_number"), MAIN_DID)
        self.assertEqual(bridge_from(xml), MAIN_DID)


class D_Withheld(unittest.TestCase):
    def test_privacy_is_requested_and_the_number_kept(self):
        use(sites=[site("BLANK")])
        xml = dial()
        d = datas(xml)
        self.assertIn("origination_privacy=hide_name:hide_number", d)
        self.assertIn("sip_h_Privacy=id", d)
        self.assertEqual(value(xml, "effective_caller_id_name"), "Anonymous")
        self.assertEqual(value(xml, "effective_caller_id_number"), PERSONAL)
        self.assertEqual(bridge_from(xml), PERSONAL)
        self.assertEqual(value(xml, "mcm_site_caller_id"), "BLANK")
        self.assertEqual(rule_logs(), [("info", {"rule": "BLANK", "number": PERSONAL})])

    def test_the_privacy_request_travels_to_the_carrier_leg(self):
        # export, like the outbound X- headers, not a set the bridge would
        # leave behind on the caller's own leg.
        use(sites=[site("BLANK")])
        apps = dict((data, app) for app, data in actions(dial()))
        self.assertEqual(apps["sip_h_Privacy=id"], "export")
        self.assertEqual(apps["origination_privacy=hide_name:hide_number"], "export")
        self.assertEqual(apps["sip_h_X-Billable=Y"], "export")   # the pattern followed

    def test_privacy_sits_after_the_existing_sets_and_before_the_bridge(self):
        use(sites=[site("BLANK")])
        d = datas(dial())
        number = d.index("effective_caller_id_number=" + PERSONAL)
        privacy = d.index("sip_h_Privacy=id")
        anonymous = d.index("effective_caller_id_name=Anonymous")
        billable = d.index("sip_h_X-Billable=Y")
        self.assertLess(number, privacy)
        self.assertLess(privacy, billable)
        self.assertLess(anonymous, billable)


class E_TheLookupItself(unittest.TestCase):
    def test_one_query_per_location_per_interval(self):
        conn = use(sites=[site("CUSTOM", "Acme")])
        for _ in range(5):
            dial()
        self.assertEqual(conn.counts["sites"], 1)
        # The absence of a rule is cached the same way - it is the common case.
        conn = use(sites=[])
        for _ in range(5):
            dial()
        self.assertEqual(conn.counts["sites"], 1)

    def test_the_cache_expires(self):
        conn = use(sites=[site("CUSTOM", "Acme")])
        dial()
        key = "%s:%s" % (COMPANY, SITE)
        dps._site_caller_id_time[key] -= dps.CALLING_RULES_CACHE_SECONDS + 1
        dial()
        self.assertEqual(conn.counts["sites"], 2)

    def test_the_rule_shape(self):
        use(sites=[site("custom ", "  Acme  ")])   # case and whitespace tolerated
        self.assertEqual(dps.site_caller_id_rule(SITE, COMPANY), {"type": "CUSTOM", "name": "Acme"})
        use(sites=[site("BLANK")])
        self.assertEqual(dps.site_caller_id_rule(SITE, COMPANY), {"type": "BLANK", "name": ""})
        use(sites=[site("MAIN")])
        self.assertIsNone(dps.site_caller_id_rule(SITE, OTHER_COMPANY))
        self.assertIsNone(dps.site_caller_id_rule(None, COMPANY))
        self.assertIsNone(dps.site_caller_id_rule(SITE, None))

    def test_the_actions_helper_never_raises_on_odd_input(self):
        use(sites=[])
        self.assertEqual(dps.site_caller_id_actions(None, PERSONAL, COMPANY), ([], PERSONAL))
        self.assertEqual(dps.site_caller_id_actions({}, PERSONAL, COMPANY), ([], PERSONAL))
        self.assertEqual(dps.site_caller_id_actions({"type": "ODD"}, PERSONAL, COMPANY), ([], PERSONAL))


class F_TheFileItself(unittest.TestCase):
    def test_nothing_was_removed_or_reordered_in_the_outbound_actions(self):
        with open(TARGET, encoding="utf-8") as handle:
            source = handle.read()
        # From the outbound log line (the internal-call block above it has
        # its own effective_caller_id sets) down to the inbound function.
        outbound = source[source.index('log("info", "outbound call"'):source.index("def build_inbound_dialplan(")]
        expected = [
            'effective_caller_id_name={caller_name}',
            'effective_caller_id_number={caller_id}',
            '] + site_actions + [',
            'sip_h_X-Billable=Y',
            'sip_h_X-Billing-Owner-UUID={company_uuid}',
            'sip_h_X-Outbound=Y',
            'sip_h_X-Outbound-Row-Owner={company_uuid}',
            'provider_uuid=',
            'call_timeout=60',
            'continue_on_fail=true',
            'hangup_after_bridge=true',
            'recording_actions(company_uuid, "outbound")',
            'ondemand_actions(company_uuid, "self")',
            'sip_from_uri=sip:{caller_id}@{SERVER_IP}',
        ]
        positions = [outbound.index(s) for s in expected]
        self.assertEqual(positions, sorted(positions))

    def test_the_inbound_half_is_untouched_by_name(self):
        with open(TARGET, encoding="utf-8") as handle:
            source = handle.read()
        inbound = source[source.index("def build_inbound_dialplan("):]
        self.assertNotIn("site_caller_id", inbound)
        self.assertNotIn("site_actions", inbound)


if __name__ == "__main__":
    unittest.main(argv=sys.argv[:1], verbosity=2)
