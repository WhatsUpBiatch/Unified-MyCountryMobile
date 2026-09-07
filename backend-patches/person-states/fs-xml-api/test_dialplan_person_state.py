"""What the inbound dialplan does with a number that rings a person who is
not there, proved without a database.

A number rings extension 1001 directly. The person is ACTIVE, SUSPENDED,
PENDING, removed, or unknown to the database. Only ACTIVE (and unknown, which
must behave as today) may reach the bridge. The others go to the number's
closed-hours destination when one is set, else to 1001's voicemail, with one
info line saying so. A read failure rings as today. Every other route type is
untouched.

Everything the builder reads that is not the person's state is stubbed to a
fixed answer, so the only database path exercised is the new one.

The suite must FAIL on the unpatched file: it has no person_switch_state and
bridges a suspended person.

Usage: python3 test_dialplan_person_state.py <path to patched dialplan_service.py>
(channel_limit.py and queue_media.py must be importable: PYTHONPATH=<dir>).
"""

import importlib.util
import os
import sys
import types
import unittest

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

COMPANY = "c-1"
DB = "mcm_acme"
DOMAIN = "acme.mycountrymobile.com"
DID = "12025550100"


class FakeCursor:
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
        if c.boom is not None:
            raise c.boom
        if "SELECT status, deleted_at FROM users" in sql:
            self._row = c.person
        else:
            raise AssertionError("unexpected query on the call path: %s" % sql.strip()[:80])

    def fetchone(self):
        return self._row


class FakeConnection:
    def __init__(self, person=None, boom=None):
        self.person = person
        self.boom = boom
        self.queries = []

    def cursor(self):
        return FakeCursor(self)


def use(person=None, boom=None):
    conn = FakeConnection(person=person, boom=boom)
    dps.get_db = lambda: conn
    dps.LOG = []
    dps.log = lambda level, msg, **kw: dps.LOG.append((level, msg, kw))
    # Everything else the builder reads, pinned so only the new read hits "the database".
    dps.limit_actions = lambda *a, **k: []
    dps.company_number_count = lambda *a, **k: 1
    dps.company_operational_hours = lambda *a, **k: None
    dps.number_operational_hours = lambda *a, **k: None
    dps.business_hours_state = lambda *a, **k: "unknown"
    dps.closed_hour_action_route = lambda *a, **k: None
    dps.person_record = lambda *a, **k: None
    dps.person_greeting_actions = lambda *a, **k: []
    dps.company_ring_seconds = lambda *a, **k: 30
    dps.company_recording_policy = lambda *a, **k: "off"
    dps.should_record = lambda *a, **k: False
    dps.company_on_demand_enabled = lambda *a, **k: False
    dps.queue_closed_route = lambda *a, **k: (None, None)
    dps.queue_audio_actions = lambda *a, **k: ([], [])
    dps.ivr_operational_hours = lambda *a, **k: None
    for cache in (dps._person_state_cache, dps._person_state_time):
        cache.clear()
    return conn


def did_row(route_type="EXTENSION", route_value="1001", closed=None):
    handling = {"business_hours": {"type": route_type, "value": route_value}}
    if closed:
        handling["closed_hours"] = closed
    return {
        "company_uuid": COMPANY,
        "db_name": DB,
        "forward_call_actions": {"call_handling": handling},
    }


def build(**kw):
    return dps.build_inbound_dialplan({"Caller-Destination-Number": DID}, did_row(**kw), DOMAIN)


def person(status="ACTIVE", deleted_at=None):
    return {"status": status, "deleted_at": deleted_at}


def unavailable_lines():
    return [(m, kw) for level, m, kw in dps.LOG if level == "info" and m.startswith("person unavailable")]


class A_ActiveAndUnknownRingAsToday(unittest.TestCase):
    def test_active_person_is_bridged(self):
        use(person("ACTIVE"))
        xml = build()
        self.assertIn("user/1001_web@%s,user/1001@%s" % (DOMAIN, DOMAIN), xml)
        self.assertNotIn("save-voicemail.lua", xml)
        self.assertEqual(unavailable_lines(), [])

    def test_a_row_with_no_status_rings_as_today(self):
        use({"status": None, "deleted_at": None})
        xml = build()
        self.assertIn("user/1001_web@", xml)
        self.assertEqual(unavailable_lines(), [])

    def test_unknown_person_rings_as_today(self):
        # No row at all: nothing to decide on, so nothing changes.
        use(None)
        xml = build()
        self.assertIn("user/1001_web@", xml)
        self.assertEqual(unavailable_lines(), [])

    def test_read_failure_rings_as_today_and_is_logged(self):
        use(person("SUSPENDED"), boom=Exception(2013, "Lost connection"))
        xml = build()
        self.assertIn("user/1001_web@", xml)
        self.assertTrue([m for level, m, _ in dps.LOG if level == "error" and "person state lookup failed" in m])

    def test_the_state_is_the_only_query_on_the_call_path(self):
        conn = use(person("ACTIVE"))
        build()
        self.assertEqual(len(conn.queries), 1)
        self.assertEqual(conn.queries[0][1], (COMPANY, "1001"))


class B_UnavailablePersonGoesToVoicemail(unittest.TestCase):
    def voicemail(self, row):
        use(row)
        xml = build()
        self.assertNotIn("<action application=\"bridge\"", xml)
        self.assertNotIn("user/1001_web@", xml)
        self.assertIn("vm_target_extension=1001", xml)
        self.assertIn("save-voicemail.lua", xml)
        lines = unavailable_lines()
        self.assertEqual(len(lines), 1, "exactly one info line")
        self.assertEqual(lines[0][1]["extension"], "1001")
        return lines[0]

    def test_suspended(self):
        m, kw = self.voicemail(person("SUSPENDED"))
        self.assertEqual(kw["state"], "SUSPENDED")
        self.assertIn("voicemail", m)

    def test_pending(self):
        self.assertEqual(self.voicemail(person("PENDING"))[1]["state"], "PENDING")

    def test_inactive_and_expired_count_as_suspended(self):
        self.assertEqual(self.voicemail(person("INACTIVE"))[1]["state"], "SUSPENDED")
        self.assertEqual(self.voicemail(person("EXPIRED"))[1]["state"], "SUSPENDED")

    def test_removed_even_though_status_is_active(self):
        self.assertEqual(self.voicemail(person("ACTIVE", deleted_at="2026-09-03 08:00:00"))[1]["state"], "REMOVED")

    def test_closed_hours_pointing_at_the_same_person_still_means_voicemail(self):
        use(person("SUSPENDED"))
        xml = build(closed={"type": "EXTENSION", "value": "1001"})
        self.assertIn("vm_target_extension=1001", xml)
        self.assertNotIn("user/1001_web@", xml)


class C_NumbersClosedHoursDestinationWins(unittest.TestCase):
    def test_voicemail_of_another_person(self):
        use(person("SUSPENDED"))
        xml = build(closed={"type": "VOICEMAIL", "value": "1002"})
        self.assertIn("vm_target_extension=1002", xml)
        self.assertNotIn("user/1001_web@", xml)
        m, kw = unavailable_lines()[0]
        self.assertIn("closed-hours destination", m)
        self.assertEqual(kw["to_type"], "VOICEMAIL")

    def test_a_colleague_is_rung_instead(self):
        use(person("SUSPENDED"))
        xml = build(closed={"type": "EXTENSION", "value": "1002"})
        self.assertIn("user/1002_web@", xml)
        self.assertNotIn("user/1001_web@", xml)

    def test_a_menu_is_run_instead(self):
        use(person("REMOVED"))
        xml = build(closed={"type": "IVR", "value": "menu-uuid"})
        self.assertIn('application="ivr"', xml)
        self.assertIn("menu-uuid", xml)
        self.assertNotIn("user/1001_web@", xml)

    def test_a_hangup_destination_is_honoured(self):
        use(person("SUSPENDED"))
        xml = build(closed={"type": "HANGUP", "value": "1"})
        self.assertNotIn("user/1001_web@", xml)
        self.assertNotIn("save-voicemail.lua", xml)

    def test_an_incomplete_closed_block_falls_back_to_voicemail(self):
        use(person("SUSPENDED"))
        xml = build(closed={"type": "QUEUE", "value": ""})
        self.assertIn("vm_target_extension=1001", xml)


class D_OtherRouteTypesUntouched(unittest.TestCase):
    def test_a_voicemail_number_does_not_read_the_state(self):
        conn = use(person("SUSPENDED"))
        xml = build(route_type="VOICEMAIL")
        self.assertIn("vm_target_extension=1001", xml)
        self.assertEqual(conn.queries, [])
        self.assertEqual(unavailable_lines(), [])

    def test_a_menu_number_does_not_read_the_state(self):
        conn = use(person("SUSPENDED"))
        build(route_type="IVR", route_value="menu-uuid")
        self.assertEqual(conn.queries, [])


class E_CacheAndHelper(unittest.TestCase):
    def test_state_is_cached_per_person(self):
        conn = use(person("SUSPENDED"))
        build()
        build()
        self.assertEqual(len(conn.queries), 1)

    def test_pure_helper(self):
        f = dps.person_state_of
        self.assertIsNone(f(None))
        self.assertEqual(f(person("ACTIVE")), "ACTIVE")
        self.assertEqual(f(person(" active ")), "ACTIVE")
        self.assertEqual(f(person("PENDING")), "PENDING")
        self.assertEqual(f(person("SUSPENDED")), "SUSPENDED")
        self.assertEqual(f(person("INACTIVE")), "SUSPENDED")
        self.assertIsNone(f(person("")), "no status is not a decision")
        self.assertIsNone(f(person(None)))
        self.assertIsNone(f({"settings": {}}), "a row without the column rings as today")
        self.assertEqual(f(person("ACTIVE", "x")), "REMOVED")
        self.assertEqual(f({"status": "", "deleted_at": "x"}), "REMOVED")

    def test_registered_phone_identity_excludes_removed_people(self):
        # The two reads that give a registered phone its identity.
        import inspect
        for fn in (dps.lookup_user, dps.lookup_user_by_extension):
            src = inspect.getsource(fn)
            self.assertIn("u.status = 'ACTIVE' AND u.deleted_at IS NULL", src, fn.__name__)


if __name__ == "__main__":
    unittest.main(argv=sys.argv[:1], verbosity=1)
