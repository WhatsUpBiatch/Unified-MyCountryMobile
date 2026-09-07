"""Who the directory service lets onto the switch, proved without a database.

Five people ask to register (sip_auth) and to be rung (user_call): one ACTIVE,
one SUSPENDED, one PENDING, one INACTIVE, and one removed (deleted_at set,
status still ACTIVE - which is what a soft delete leaves behind). Only the
first may get a directory entry; the others must get the same "not found"
answer a missing extension gets, with one info line saying which state
refused them. A genuinely missing extension keeps its warning.

The suite must FAIL on the unpatched file: there the SQL did the filtering and
the fake cursor (which cannot run SQL) hands every row back, so a suspended
person registers - exactly the shape of the bug for a removed person.

Usage: python3 test_directory_person_state.py <path to patched directory_service.py>
"""

import importlib.util
import io
import json
import sys
import types
import unittest

if "pymysql" not in sys.modules:
    stub = types.ModuleType("pymysql")
    stub.cursors = types.ModuleType("pymysql.cursors")
    stub.cursors.DictCursor = object
    sys.modules["pymysql"] = stub
    sys.modules["pymysql.cursors"] = stub.cursors

TARGET = sys.argv[1] if len(sys.argv) > 1 else "directory_service.patched.py"
spec = importlib.util.spec_from_file_location("dsvc", TARGET)
dsvc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dsvc)

DOMAIN = "acme.mycountrymobile.com"


def person(status="ACTIVE", deleted_at=None, ext="1001"):
    return {
        "extension": ext, "uuid": "u-" + ext, "name": "Ada Lovelace", "caller_id": "",
        "company_uuid": "c-1", "password": "pw", "status": status, "deleted_at": deleted_at,
    }


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        self.conn.queries.append((sql, params))

    def fetchone(self):
        return self.conn.row


class FakeConnection:
    def __init__(self, row):
        self.row = row
        self.queries = []
        self.closed = False

    def cursor(self):
        return FakeCursor(self)

    def close(self):
        self.closed = True


def use(row):
    conn = FakeConnection(row)
    dsvc.get_db_connection = lambda: conn
    dsvc.LOG = []
    dsvc.log = lambda level, msg: dsvc.LOG.append((level, msg))
    return conn


def post(action, user):
    """Drive do_POST the way the switch does, returning the XML it sent back."""
    handler = dsvc.DirectoryHandler.__new__(dsvc.DirectoryHandler)
    body = "action=%s&domain=%s&user=%s" % (action, DOMAIN, user)
    handler.headers = {"Content-Length": str(len(body))}
    handler.rfile = io.BytesIO(body.encode("utf-8"))
    handler.wfile = io.BytesIO()
    handler.send_response = lambda code: None
    handler.send_header = lambda k, v: None
    handler.end_headers = lambda: None
    handler.do_POST()
    return handler.wfile.getvalue().decode("utf-8")


class A_ActivePersonStillWorks(unittest.TestCase):
    def test_sip_auth_returns_the_directory_entry(self):
        conn = use(person())
        xml = post("sip_auth", "1001")
        self.assertIn('<user id="1001">', xml)
        self.assertIn('value="pw"', xml)
        self.assertTrue(conn.closed)

    def test_user_call_returns_the_directory_entry(self):
        use(person())
        xml = post("user_call", "1001_web")
        self.assertIn('<user id="1001_web">', xml)
        self.assertIn('name="user_uuid" value="u-1001"', xml)

    def test_the_web_suffix_is_still_stripped_before_the_query(self):
        conn = use(person())
        post("sip_auth", "1001_web")
        self.assertEqual(conn.queries[-1][1], ("mcm_acme", "1001"))

    def test_refusals_are_not_logged_for_an_active_person(self):
        use(person())
        post("sip_auth", "1001")
        self.assertFalse([m for _l, m in dsvc.LOG if "person refused" in m])


class B_EveryOtherStateIsRefused(unittest.TestCase):
    def refused(self, row, action):
        use(row)
        xml = post(action, "1001")
        self.assertIn('<result status="not found" />', xml, "%s should be refused on %s" % (row, action))
        self.assertNotIn("<user id=", xml)
        lines = [m for level, m in dsvc.LOG if level == "info" and "person refused on the switch" in m]
        self.assertEqual(len(lines), 1, "exactly one info line per refusal")
        return lines[0]

    def test_suspended_cannot_register(self):
        line = self.refused(person("SUSPENDED"), "sip_auth")
        self.assertIn("state=SUSPENDED", line)
        self.assertIn("action=sip_auth", line)
        self.assertIn("ext=1001", line)

    def test_suspended_is_not_rung(self):
        line = self.refused(person("SUSPENDED"), "user_call")
        self.assertIn("action=user_call", line)

    def test_pending_cannot_register(self):
        self.assertIn("state=PENDING", self.refused(person("PENDING"), "sip_auth"))

    def test_inactive_cannot_register(self):
        self.assertIn("state=INACTIVE", self.refused(person("INACTIVE"), "sip_auth"))

    def test_removed_person_cannot_register_even_though_status_is_active(self):
        line = self.refused(person("ACTIVE", deleted_at="2026-09-03 08:00:00"), "sip_auth")
        self.assertIn("state=REMOVED", line)

    def test_removed_person_is_not_rung(self):
        self.assertIn("state=REMOVED", self.refused(person("ACTIVE", deleted_at="2026-09-03 08:00:00"), "user_call"))

    def test_the_query_no_longer_filters_in_sql(self):
        # The decision is in code so the log can name the state; the SQL must
        # therefore hand every row back, and select what the decision needs.
        conn = use(person("SUSPENDED"))
        post("sip_auth", "1001")
        sql = conn.queries[-1][0]
        self.assertNotIn("u.status = 'ACTIVE'", sql)
        self.assertIn("u.status", sql)
        self.assertIn("u.deleted_at", sql)


class C_MissingAndOtherPathsUnchanged(unittest.TestCase):
    def test_missing_extension_keeps_its_warning(self):
        use(None)
        xml = post("sip_auth", "9999")
        self.assertIn('<result status="not found" />', xml)
        self.assertTrue([m for level, m in dsvc.LOG if level == "warn" and "User not found" in m])
        self.assertFalse([m for _l, m in dsvc.LOG if "person refused" in m])

    def test_database_error_is_not_found_not_a_crash(self):
        def boom():
            raise RuntimeError("db down")
        dsvc.get_db_connection = boom
        dsvc.LOG = []
        dsvc.log = lambda level, msg: dsvc.LOG.append((level, msg))
        xml = post("sip_auth", "1001")
        self.assertIn('<result status="not found" />', xml)
        self.assertTrue([m for level, m in dsvc.LOG if level == "error"])

    def test_gateways_lookup_still_gets_the_empty_domain(self):
        use(person())
        handler = dsvc.DirectoryHandler.__new__(dsvc.DirectoryHandler)
        body = "purpose=gateways&key_value=%s" % DOMAIN
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body.encode("utf-8"))
        handler.wfile = io.BytesIO()
        handler.send_response = lambda code: None
        handler.send_header = lambda k, v: None
        handler.end_headers = lambda: None
        handler.do_POST()
        self.assertIn("<users/>", handler.wfile.getvalue().decode("utf-8"))


class D_TheDecisionItself(unittest.TestCase):
    def test_pure_helper(self):
        f = dsvc.person_switch_refusal
        self.assertIsNone(f(None))
        self.assertIsNone(f(person()))
        self.assertIsNone(f(person(" active ")))
        self.assertEqual(f(person("SUSPENDED")), "SUSPENDED")
        self.assertEqual(f(person("pending")), "PENDING")
        self.assertEqual(f(person("ACTIVE", deleted_at="x")), "REMOVED")
        self.assertEqual(f(person("SUSPENDED", deleted_at="x")), "REMOVED")
        self.assertEqual(f(person("")), "UNKNOWN")
        self.assertEqual(f(person(None)), "UNKNOWN")


if __name__ == "__main__":
    unittest.main(argv=sys.argv[:1], verbosity=1)
