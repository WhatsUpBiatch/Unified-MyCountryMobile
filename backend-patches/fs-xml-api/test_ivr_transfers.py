#!/usr/bin/env python3
"""Menu key presses reach their target, and departments ring.

Run against a dialplan_service.py:  test_ivr_transfers.py <path>
Run it with PYTHONPATH pointing at the directory holding the copy under test
(the service imports channel_limit and queue_media at load time). The suite
must FAIL on the unpatched file - that is the control.
"""
import collections
import importlib.util
import json
import os
import sys
import types
import unittest

# The service imports its database driver at module level and only opens a
# connection from main(); a stub is enough to import it.
if "pymysql" not in sys.modules:
    stub = types.ModuleType("pymysql")
    stub.cursors = types.ModuleType("pymysql.cursors")
    stub.cursors.DictCursor = object
    sys.modules["pymysql"] = stub
    sys.modules["pymysql.cursors"] = stub.cursors

TARGET = sys.argv[1] if len(sys.argv) > 1 else "dialplan_service.py"
sys.path.insert(0, os.path.dirname(os.path.abspath(TARGET)))
spec = importlib.util.spec_from_file_location("dps", TARGET)
dps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dps)

DB = "mcm_test"
COMPANY = "co-1"
DOMAIN = "test.mycountrymobile.com"
DID = "15550000001"
QUEUE_ID = "6a71e1ff70a608dae4ecfd24"
DEPARTMENT = "17a81efd-c21e-4484-8a9c-b035ce4497d6"
OPEN, CLOSED, UNKNOWN = dps.OPERATIONAL_HOURS_OPEN, dps.OPERATIONAL_HOURS_CLOSED, dps.OPERATIONAL_HOURS_UNKNOWN


def fake_business_hours_state(operational_hours, now_utc=None):
    hours = dps._as_object(operational_hours)
    return hours.get("_state", UNKNOWN) if isinstance(hours, dict) else UNKNOWN


def department_row(members=("1794", "1000"), strategy="ring_all", timeout=10,
                   failover=("VOICEMAIL", "1000"), welcome=None):
    settings = {
        "media": {"welcome": {"enabled": bool(welcome), "value": welcome or ""},
                  "hold": {"enabled": False, "value": ""}},
        "recording": {"automatic": {"enabled": False}},
        "call_handling": {"timeout": timeout,
                          "failover": {"type": failover[0], "value": failover[1]} if failover else {}},
        "ring_strategy": strategy,
    }
    return {
        "uuid": DEPARTMENT, "name": "SAles", "extension": "8969",
        "members": json.dumps([{"value": m, "label": "Person %s" % m, "user_uuid": "u-%s" % m} for m in members]),
        "forward_call_actions": json.dumps(settings),
    }


class FakeCursor:
    """Just enough of a DictCursor to answer every query the inbound path and
    the transfer path make, so the REAL query path is exercised."""
    def __init__(self, conn):
        self.conn = conn
        self._row = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        c = self.conn
        c.queries.append((sql, params))
        if "ring_groups" in sql:
            c.counts["ring_groups"] += 1
            self._row = c.departments.get(params[0])
        elif "FROM companies WHERE db_name" in sql:
            c.counts["company_by_db"] += 1
            self._row = {"uuid": COMPANY} if params[0] == DB else None
        elif "company_settings" in sql:
            section = params[0]
            self._row = {"settings": c.sections[section]} if section in c.sections else None
        elif "user_template" in sql:
            self._row = None
        elif ".ivrs WHERE uuid" in sql:
            self._row = None
        elif "FROM did_numbers" in sql or "SELECT licenses FROM companies" in sql:
            c.counts["limit"] += 1
            self._row = {"n": 1, "licenses": 1}
        elif "FROM users" in sql:
            self._row = None
        elif "FROM providers" in sql:
            self._row = collections.defaultdict(str, host_ip_outbound="10.9.9.9", prefix="")
        else:
            raise AssertionError("unexpected query: %s" % sql)

    def fetchone(self):
        return self._row


class FakeConnection:
    def __init__(self, sections=None, departments=None):
        self.sections = sections or {}
        self.departments = departments or {}
        self.counts = collections.Counter()
        self.queries = []

    def cursor(self):
        return FakeCursor(self)


LOGS = []


def capture_log(level, msg, **kwargs):
    LOGS.append(dict(kwargs, level=level, msg=msg))


def use(company=OPEN, departments=None):
    """A fresh fake database, every cache emptied, the clock and the log replaced."""
    conn = FakeConnection(sections={"operational_hours": {"_state": company}}, departments=departments)
    dps.get_db = lambda: conn
    dps.business_hours_state = fake_business_hours_state
    dps.log = capture_log
    dps.queue_closed_route = lambda *a, **k: ("", "")
    dps.queue_audio_actions = lambda *a, **k: ([], [])
    dps.fetch_greeting = lambda company, name, log=None: "/etc/freeswitch/sounds/mcm/greetings/%s/%s" % (company, name)
    dps.get_outbound_provider = lambda: collections.defaultdict(str, host_ip_outbound="10.9.9.9")
    for name in dir(dps):
        if name.endswith("_cache") or name.endswith("_cache_time"):
            value = getattr(dps, name)
            if isinstance(value, dict):
                value.clear()
    del LOGS[:]
    return conn


def transfer(context, value, **extra):
    params = {
        "Caller-Destination-Number": value,
        "Hunt-Destination-Number": value,
        "Caller-Context": context,
        "variable_domain_name": DOMAIN,
        "variable_company_uuid": COMPANY,
        "variable_sip_h_X-DID": DID,
        "variable_forward_name": "Sales line",
    }
    params.update(extra)
    return dps.build_transfer_dialplan(params, context, value, DOMAIN)


def did_row(route):
    forward = {"call_handling": {"business_hours": {"type": route[0], "value": route[1], "label": "Day", "name": "Day"}}}
    return {"forward_call_actions": json.dumps(forward), "company_uuid": COMPANY, "db_name": DB}


def build(row):
    return dps.build_inbound_dialplan({"Caller-Destination-Number": DID}, row, DOMAIN)


def logged(msg_part):
    return [e for e in LOGS if msg_part in e["msg"]]


NOT_FOUND = '<result status="not found" />'
RINGS = 'user/%s_web@%s,user/%s@%s'


class KeyPresses(unittest.TestCase):
    def test_every_context_the_menu_generator_emits_is_answered(self):
        # The list in the configuration service's calltype.go.
        for ctx in ("department", "ivr", "queue", "extension", "number", "voicemail", "ai", "message"):
            self.assertIn(ctx, dps.TRANSFER_CONTEXTS)

    def test_the_handler_dispatches_transfer_contexts(self):
        with open(TARGET) as fh:
            text = fh.read()
        self.assertIn("elif context in TRANSFER_CONTEXTS:", text)
        self.assertIn("build_transfer_dialplan(params, context, dest, domain)", text)

    def test_a_key_to_a_queue_joins_the_queue(self):
        use()
        xml = transfer("queue", QUEUE_ID)
        self.assertIn('data="sip_h_X-Queue=%s"' % QUEUE_ID, xml)
        self.assertIn("callcenter-queue.lua", xml)
        self.assertIn('<context name="queue">', xml)
        self.assertNotIn('<context name="public">', xml)

    def test_the_dialled_number_survives_the_transfer(self):
        use()
        xml = transfer("queue", QUEUE_ID)
        self.assertIn('data="sip_h_X-DID=%s"' % DID, xml)
        self.assertEqual(logged("menu key transfer")[0]["did"], DID)

    def test_the_queue_is_named_from_the_key_label(self):
        use()
        xml = transfer("queue", QUEUE_ID)
        self.assertIn('data="cc_queue_name=Sales line"', xml)

    def test_no_second_channel_limit_on_a_transfer(self):
        conn = use()
        xml = transfer("queue", QUEUE_ID)
        self.assertNotIn('application="limit"', xml)
        self.assertEqual(conn.counts["limit"], 0)

    def test_a_key_to_a_person_rings_them(self):
        use()
        xml = transfer("extension", "1794")
        self.assertIn(RINGS % ("1794", DOMAIN, "1794", DOMAIN), xml)
        self.assertIn('<context name="extension">', xml)

    def test_a_key_to_voicemail_records(self):
        use()
        xml = transfer("voicemail", "1000")
        self.assertIn('data="vm_target_extension=1000"', xml)
        self.assertIn("save-voicemail.lua", xml)

    def test_a_key_to_an_outside_number_dials_out(self):
        use()
        xml = transfer("number", "918149461034")
        self.assertIn('application="bridge"', xml)
        self.assertIn("918149461034", xml)
        self.assertIn('<context name="number">', xml)

    def test_a_key_to_another_menu_runs_it(self):
        use()
        xml = transfer("ivr", "ivr-uuid-2")
        self.assertIn('application="ivr" data="ivr-uuid-2"', xml)

    def test_a_key_to_a_greeting_plays_it_and_ends(self):
        use()
        xml = transfer("message", "d2c71b46.mp3")
        self.assertIn('application="playback" data="/etc/freeswitch/sounds/mcm/greetings/%s/d2c71b46.mp3"' % COMPANY, xml)
        self.assertIn('application="hangup"', xml)
        self.assertLess(xml.index('application="playback"'), xml.index('application="hangup"'))

    def test_a_greeting_that_cannot_be_fetched_still_ends_cleanly(self):
        use()
        dps.fetch_greeting = lambda *a, **k: None
        xml = transfer("message", "missing.mp3")
        self.assertNotIn('application="playback"', xml)
        self.assertIn('application="hangup"', xml)
        self.assertTrue(logged("greeting could not be fetched"))

    def test_an_ai_callback_key_is_refused_with_a_reason(self):
        use()
        xml = transfer("ai", "ab76ad1f")
        self.assertIn(NOT_FOUND, xml)
        self.assertTrue(logged("AI callback"))

    def test_after_hours_a_key_press_still_reaches_its_target(self):
        # The company is closed. The caller is already in the menu (the menu
        # was the closed-hours destination). The key must go where it points,
        # not back to the closed-hours destination.
        use(company=CLOSED)
        xml = transfer("extension", "1794")
        self.assertIn(RINGS % ("1794", DOMAIN, "1794", DOMAIN), xml)
        self.assertFalse(logged("outside opening hours"))

    def test_the_company_is_found_from_the_domain_when_the_channel_lacks_it(self):
        conn = use()
        xml = transfer("queue", QUEUE_ID, variable_company_uuid="", **{"variable_sip_h_X-Billing-Owner-UUID": ""})
        self.assertIn('data="company_uuid=%s"' % COMPANY, xml)
        self.assertEqual(conn.counts["company_by_db"], 1)

    def test_no_company_means_a_clean_refusal(self):
        use()
        params = {"Caller-Destination-Number": QUEUE_ID}
        xml = dps.build_transfer_dialplan(params, "queue", QUEUE_ID, "")
        self.assertIn(NOT_FOUND, xml)
        self.assertTrue(logged("company unknown"))

    def test_the_menu_branch_keeps_the_dialled_number(self):
        use()
        xml = build(did_row(("IVR", "ivr-uuid-1")))
        self.assertIn('data="sip_h_X-DID=%s"' % DID, xml)
        self.assertIn('application="ivr" data="ivr-uuid-1"', xml)


class Departments(unittest.TestCase):
    def test_ring_all_rings_every_member_at_once(self):
        use(departments={DEPARTMENT: department_row()})
        xml = transfer("department", DEPARTMENT)
        self.assertIn('application="bridge" data="%s,%s"' % (RINGS % ("1794", DOMAIN, "1794", DOMAIN),
                                                            RINGS % ("1000", DOMAIN, "1000", DOMAIN)), xml)
        self.assertIn('data="call_timeout=10"', xml)
        self.assertIn('<context name="department">', xml)
        self.assertIn('data="sip_h_X-ForwardName=SAles"', xml)

    def test_in_order_rings_one_after_another(self):
        use(departments={DEPARTMENT: department_row(strategy="sequential")})
        xml = transfer("department", DEPARTMENT)
        self.assertIn('application="bridge" data="%s|%s"' % (RINGS % ("1794", DOMAIN, "1794", DOMAIN),
                                                            RINGS % ("1000", DOMAIN, "1000", DOMAIN)), xml)

    def test_no_answer_falls_over_to_the_failover_target(self):
        use(departments={DEPARTMENT: department_row(failover=("VOICEMAIL", "1000"))})
        xml = transfer("department", DEPARTMENT)
        self.assertIn('data="continue_on_fail=true"', xml)
        self.assertIn('application="transfer" data="1000 XML voicemail"', xml)
        self.assertLess(xml.index('application="bridge"'), xml.index('application="transfer"'))

    def test_failover_to_a_phone_uses_the_number_context(self):
        use(departments={DEPARTMENT: department_row(failover=("PHONE", "918149461034"))})
        xml = transfer("department", DEPARTMENT)
        self.assertIn('application="transfer" data="918149461034 XML number"', xml)

    def test_no_failover_means_the_ring_is_the_end(self):
        use(departments={DEPARTMENT: department_row(failover=None)})
        xml = transfer("department", DEPARTMENT)
        self.assertNotIn('application="transfer"', xml)

    def test_a_welcome_message_plays_before_ringing(self):
        use(departments={DEPARTMENT: department_row(welcome="hello.mp3")})
        xml = transfer("department", DEPARTMENT)
        self.assertIn('application="playback" data="/etc/freeswitch/sounds/mcm/greetings/%s/hello.mp3"' % COMPANY, xml)
        self.assertLess(xml.index('application="playback"'), xml.index('application="bridge"'))

    def test_the_timeout_is_kept_within_reason(self):
        use(departments={DEPARTMENT: department_row(timeout=0)})
        self.assertIn('data="call_timeout=20"', transfer("department", DEPARTMENT))
        use(departments={DEPARTMENT: department_row(timeout=900)})
        self.assertIn('data="call_timeout=120"', transfer("department", DEPARTMENT))

    def test_a_department_with_no_members_goes_straight_to_failover(self):
        use(departments={DEPARTMENT: department_row(members=(), failover=("VOICEMAIL", "1000"))})
        xml = transfer("department", DEPARTMENT)
        self.assertNotIn('application="bridge"', xml)
        self.assertIn('application="transfer" data="1000 XML voicemail"', xml)
        self.assertTrue(logged("no members"))

    def test_an_unknown_department_is_refused_with_a_reason(self):
        use(departments={})
        xml = transfer("department", "nope")
        self.assertIn(NOT_FOUND, xml)
        self.assertTrue(logged("department not found"))

    def test_a_number_pointed_at_a_department_rings_it_too(self):
        use(departments={DEPARTMENT: department_row()})
        xml = build(did_row(("DEPARTMENT", DEPARTMENT)))
        self.assertIn('application="bridge"', xml)
        self.assertIn(RINGS % ("1794", DOMAIN, "1794", DOMAIN), xml)
        # From a number the channel limit still applies - this is the way in.
        self.assertIn('application="limit"', xml)

    def test_the_tenant_database_name_is_checked_before_it_is_used_in_sql(self):
        use()
        self.assertIsNone(dps.department_record("mcm_x; DROP", DEPARTMENT))


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=1)
