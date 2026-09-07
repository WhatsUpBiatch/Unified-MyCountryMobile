"""What a number's own hours and a menu's own hours do to a call, proved
without a database, a clock or a phone.

`build_inbound_dialplan` is driven directly with a fake DID row, and the
generated XML is what is asserted on - the bridge, the voicemail script, the
ivr application - because that is what the switch runs. The clock is taken
out of the picture: `business_hours_state` is replaced by a stand-in that
reads the answer off a `_state` key in whichever hours block it is handed, so
"the company is closed and the number is open" is a fact of the test, not of
the wall clock.

Usage: python3 test_line_hours.py <path to patched dialplan_service.py>
(the file's sibling modules channel_limit.py and queue_media.py must be
importable, so run it from a directory that has them, or set PYTHONPATH).
"""

import importlib.util
import json
import os
import sys
import types
import unittest

# The service imports pymysql at module level and only opens a connection from
# main(), so a stub is enough to import it and drive the generator with a fake.
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

DB = "mcm_test"
COMPANY = "co-1"
DOMAIN = "test.mycountrymobile.com"
DID = "15550000001"
IVR = "ivr-uuid-1"

OPEN, CLOSED, UNKNOWN = dps.OPERATIONAL_HOURS_OPEN, dps.OPERATIONAL_HOURS_CLOSED, dps.OPERATIONAL_HOURS_UNKNOWN


def fake_business_hours_state(operational_hours, now_utc=None):
    """The stand-in clock: the block says what it is. No `_state` is what a
    block with no hours answers for real - unknown."""
    hours = dps._as_object(operational_hours)
    return hours.get("_state", UNKNOWN) if isinstance(hours, dict) else UNKNOWN


class FakeCursor:
    """Just enough of a pymysql DictCursor to answer every query the inbound
    path makes, so the REAL query path is exercised.

    `sections`   company_settings rows, section -> value
    `ivrs`       uuid -> settings (str is a JSON column as pymysql hands it
                 back; dict is already parsed); a uuid not present is no row
    `ivr_boom`   an exception to raise on the ivrs query instead
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
        if "company_settings" in sql:
            c.counts["company_settings"] += 1
            section = params[0]
            self._row = {"settings": c.sections[section]} if section in c.sections else None
        elif "user_template" in sql:
            c.counts["user_template"] += 1
            self._row = None
        elif ".ivrs WHERE uuid" in sql:
            c.counts["ivrs"] += 1
            c.ivr_queries.append((sql, params))
            if c.ivr_boom is not None:
                raise c.ivr_boom
            uuid = params[0]
            self._row = {"settings": c.ivrs[uuid]} if uuid in c.ivrs else None
        elif "FROM did_numbers" in sql or "SELECT licenses FROM companies" in sql:
            # One number before the licence rule, one licence after: two
            # channels either way, so the expected limit line does not move.
            c.counts["did_numbers"] += 1
            self._row = {"n": 1, "licenses": 1}
        else:
            raise AssertionError("unexpected query: %s" % sql)

    def fetchone(self):
        return self._row


class FakeConnection:
    def __init__(self, sections=None, ivrs=None, ivr_boom=None):
        self.sections = sections or {}
        self.ivrs = ivrs or {}
        self.ivr_boom = ivr_boom
        self.counts = {"company_settings": 0, "user_template": 0, "ivrs": 0, "did_numbers": 0}
        self.ivr_queries = []

    def cursor(self):
        return FakeCursor(self)


LOGS = []


def capture_log(level, msg, **kwargs):
    LOGS.append(dict(kwargs, level=level, msg=msg))


def use(company=UNKNOWN, ivrs=None, ivr_boom=None):
    """A fresh fake database with the company in the given state, every cache
    emptied, the clock replaced and the log captured."""
    conn = FakeConnection(sections={"operational_hours": {"_state": company}}, ivrs=ivrs, ivr_boom=ivr_boom)
    dps.get_db = lambda: conn
    dps.business_hours_state = fake_business_hours_state
    dps.log = capture_log
    # Queue lookups live in MongoDB and are not what is under test here.
    dps.queue_closed_route = lambda *a, **k: ("", "")
    dps.queue_audio_actions = lambda *a, **k: ([], [])
    for cache in (dps._hours_cache, dps._hours_cache_time, dps._ivr_hours_cache, dps._ivr_hours_cache_time,
                  dps._ring_cache, dps._ring_cache_time, dps._recording_cache, dps._recording_cache_time,
                  getattr(dps, "_licence_count_cache", getattr(dps, "_number_count_cache", {})), getattr(dps, "_licence_count_cache_time", getattr(dps, "_number_count_cache_time", {})), dps._company_settings_missing):
        cache.clear()
    del LOGS[:]
    return conn


def number_hours(state, action=None):
    """The number's `condition.operational_hours` as the screen saves it."""
    block = {
        "type": "weekly",
        "value": {"monday": {"open": True, "start": "09:00", "end": "17:00"}},
        "holidays": [],
        "regional": {"timezone": {"label": "Sydney", "value": "Australia/Sydney"}},
        "_state": state,
    }
    if action is not None:
        block["closed_hour_action"] = action
    return block


def action(kind="VOICEMAIL", value="1001", enabled=True, **extra):
    block = {"type": kind, "value": value, "enabled": enabled, "personal": False,
             "type_label": kind.title(), "value_label": "Target %s" % value}
    block.update(extra)
    return block


def did_row(route=("EXTENSION", "1001"), closed_hours=None, condition="default", number=None):
    """A DID row as lookup_did returns it. `condition` "default" means the
    number's own hours block from `number`; anything else is stored verbatim."""
    forward = {
        "call_handling": {
            "business_hours": {"type": route[0], "value": route[1], "label": "Day", "name": "Day"},
        },
    }
    if closed_hours is not None:
        forward["call_handling"]["closed_hours"] = closed_hours
    if condition == "default":
        forward["condition"] = {"operational_hours": number} if number is not None else {}
    else:
        forward["condition"] = condition
    return {"forward_call_actions": json.dumps(forward), "company_uuid": COMPANY, "db_name": DB}


def build(row):
    return dps.build_inbound_dialplan({"Caller-Destination-Number": DID}, row, DOMAIN)


def logged(msg_part):
    return [entry for entry in LOGS if msg_part in entry["msg"]]


# What each destination looks like in the XML the switch runs.
RINGS_EXTENSION = 'data="user/%s_web@%s,user/%s@%s"'
VOICEMAIL_FOR = 'data="vm_target_extension=%s"'
RUNS_MENU = 'application="ivr" data="%s"'
RUNS_QUEUE = 'data="sip_h_X-Queue=%s"'


class A_NumberClosedCompanyOpen(unittest.TestCase):
    def test_the_numbers_own_destination_is_used(self):
        use(company=OPEN)
        xml = build(did_row(number=number_hours(CLOSED, action("VOICEMAIL", "2002"))))
        self.assertIn(VOICEMAIL_FOR % "2002", xml)
        self.assertNotIn(RINGS_EXTENSION % ("1001", DOMAIN, "1001", DOMAIN), xml)

    def test_which_side_closed_it_is_logged(self):
        use(company=OPEN)
        build(did_row(number=number_hours(CLOSED, action())))
        self.assertEqual([e["closed_by"] for e in logged("outside opening hours") if "closed_by" in e], ["number"])
        self.assertEqual(logged("using the closed-hours destination")[0]["source"], "number hours")

    def test_the_numbers_destination_beats_call_handling(self):
        use(company=OPEN)
        xml = build(did_row(number=number_hours(CLOSED, action("EXTENSION", "3003")),
                            closed_hours={"type": "VOICEMAIL", "value": "1001"}))
        self.assertIn(RINGS_EXTENSION % ("3003", DOMAIN, "3003", DOMAIN), xml)
        self.assertNotIn(VOICEMAIL_FOR % "1001", xml)

    def test_a_number_can_send_after_hours_callers_to_a_queue(self):
        use(company=OPEN)
        xml = build(did_row(number=number_hours(CLOSED, action("QUEUE", "5f0000000000000000000001"))))
        self.assertIn(RUNS_QUEUE % "5f0000000000000000000001", xml)
        # The queue's display name follows the route, as it does for call_handling.
        self.assertIn('cc_queue_name=Target 5f0000000000000000000001', xml)

    def test_the_type_is_compared_upper_cased(self):
        use(company=OPEN)
        xml = build(did_row(number=number_hours(CLOSED, action("voicemail", "2002"))))
        self.assertIn(VOICEMAIL_FOR % "2002", xml)

    def test_a_number_can_hang_up(self):
        use(company=OPEN)
        xml = build(did_row(number=number_hours(CLOSED, action("HANGUP", "HANGUP"))))
        self.assertIn('application="hangup" data="NORMAL_CLEARING"', xml)


class B_CompanyClosedNumberOpen(unittest.TestCase):
    """Exactly what happens today."""

    def test_call_handling_closed_hours_is_used(self):
        use(company=CLOSED)
        xml = build(did_row(number=number_hours(OPEN),
                            closed_hours={"type": "VOICEMAIL", "value": "1001"}))
        self.assertIn(VOICEMAIL_FOR % "1001", xml)
        self.assertEqual(logged("using the closed-hours destination")[0]["source"], "call handling")
        self.assertEqual([e["closed_by"] for e in logged("outside opening hours") if "closed_by" in e], ["company"])

    def test_the_numbers_own_action_is_still_the_first_preference(self):
        # The preference order does not depend on who shut the call. A number
        # open by its own clock is closed all the same because the company is,
        # and "when this number is closed, send callers here" is the most
        # specific thing its owner said - so that is where they go.
        use(company=CLOSED)
        xml = build(did_row(number=number_hours(OPEN, action("EXTENSION", "3003")),
                            closed_hours={"type": "VOICEMAIL", "value": "1001"}))
        self.assertIn(RINGS_EXTENSION % ("3003", DOMAIN, "3003", DOMAIN), xml)
        self.assertEqual(logged("using the closed-hours destination")[0]["source"], "number hours")

    def test_extension_goes_to_voicemail_without_a_destination(self):
        use(company=CLOSED)
        xml = build(did_row(number=number_hours(OPEN)))
        self.assertIn(VOICEMAIL_FOR % "1001", xml)
        self.assertTrue(logged("no destination set, using voicemail"))

    def test_both_closed_is_logged_as_both(self):
        use(company=CLOSED)
        build(did_row(number=number_hours(CLOSED)))
        self.assertEqual([e["closed_by"] for e in logged("outside opening hours") if "closed_by" in e],
                         ["company and number"])


class C_BothOpen(unittest.TestCase):
    def test_the_route_is_unchanged(self):
        use(company=OPEN)
        xml = build(did_row(number=number_hours(OPEN, action("VOICEMAIL", "2002")),
                            closed_hours={"type": "VOICEMAIL", "value": "1001"}))
        self.assertIn(RINGS_EXTENSION % ("1001", DOMAIN, "1001", DOMAIN), xml)
        self.assertNotIn("vm_target_extension", xml)
        self.assertFalse(logged("outside opening hours"))

    def test_a_menu_runs_when_everything_is_open(self):
        use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(OPEN, action())}})
        xml = build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertIn(RUNS_MENU % IVR, xml)


class D_NumberClosedWithNoUsableAction(unittest.TestCase):
    def test_a_disabled_action_falls_to_call_handling(self):
        use(company=OPEN)
        xml = build(did_row(number=number_hours(CLOSED, action("EXTENSION", "3003", enabled=False)),
                            closed_hours={"type": "VOICEMAIL", "value": "1001"}))
        self.assertIn(VOICEMAIL_FOR % "1001", xml)
        self.assertEqual(logged("using the closed-hours destination")[0]["source"], "call handling")

    def test_an_absent_enabled_flag_is_off(self):
        # The screen writes `enabled: undefined` when the box was never
        # touched, and JSON drops the key.
        use(company=OPEN)
        block = {"type": "EXTENSION", "value": "3003"}
        xml = build(did_row(number=number_hours(CLOSED, block), closed_hours={"type": "VOICEMAIL", "value": "1001"}))
        self.assertIn(VOICEMAIL_FOR % "1001", xml)

    def test_an_empty_type_or_value_falls_to_call_handling(self):
        for bad in (action("", "3003"), action("EXTENSION", ""), action("EXTENSION", None), action(" ", " ")):
            use(company=OPEN)
            xml = build(did_row(number=number_hours(CLOSED, bad), closed_hours={"type": "VOICEMAIL", "value": "1001"}))
            self.assertIn(VOICEMAIL_FOR % "1001", xml, bad)

    def test_then_voicemail_for_an_extension(self):
        use(company=OPEN)
        xml = build(did_row(number=number_hours(CLOSED, action("EXTENSION", "3003", enabled=False))))
        self.assertIn(VOICEMAIL_FOR % "1001", xml)
        self.assertTrue(logged("no destination set, using voicemail"))

    def test_then_ring_through_for_a_menu(self):
        use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(OPEN)}})
        xml = build(did_row(route=("IVR", IVR), number=number_hours(CLOSED, action(enabled=False))))
        self.assertIn(RUNS_MENU % IVR, xml)
        self.assertTrue(logged("no closed-hours destination for this route type"))

    def test_then_ring_through_for_a_queue(self):
        use(company=OPEN)
        xml = build(did_row(route=("QUEUE", "5f0000000000000000000001"), number=number_hours(CLOSED)))
        self.assertIn(RUNS_QUEUE % "5f0000000000000000000001", xml)
        self.assertTrue(logged("no closed-hours destination for this route type"))


class E_MenuClosed(unittest.TestCase):
    def test_its_own_destination_wins_voicemail(self):
        use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(CLOSED, action("VOICEMAIL", "4004"))}})
        xml = build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertIn(VOICEMAIL_FOR % "4004", xml)
        self.assertNotIn(RUNS_MENU % IVR, xml)
        self.assertEqual(logged("the menu itself is closed, using its own destination")[0]["closed_type"], "VOICEMAIL")

    def test_its_own_destination_wins_extension(self):
        use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(CLOSED, action("EXTENSION", "4004"))}})
        xml = build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertIn(RINGS_EXTENSION % ("4004", DOMAIN, "4004", DOMAIN), xml)

    def test_its_own_destination_wins_queue(self):
        use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(CLOSED, action("QUEUE", "5f0000000000000000000002"))}})
        xml = build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertIn(RUNS_QUEUE % "5f0000000000000000000002", xml)

    def test_settings_stored_as_json_text(self):
        settings = json.dumps({"operational_hours": number_hours(CLOSED, action("VOICEMAIL", "4004"))})
        use(company=OPEN, ivrs={IVR: settings})
        xml = build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertIn(VOICEMAIL_FOR % "4004", xml)

    def test_a_menu_reached_through_the_numbers_closed_action_is_also_checked(self):
        # Number shut -> its action says "go to the menu" -> the menu is shut
        # too and says "voicemail". The caller lands in voicemail.
        use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(CLOSED, action("VOICEMAIL", "4004"))}})
        xml = build(did_row(number=number_hours(CLOSED, action("IVR", IVR))))
        self.assertIn(VOICEMAIL_FOR % "4004", xml)

    def test_the_query_names_the_tenant_database(self):
        conn = use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(CLOSED, action())}})
        build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        sql, params = conn.ivr_queries[0]
        self.assertIn("`%s`.ivrs" % DB, sql)
        self.assertEqual(params, (IVR,))


class F_MenuClosedWithNoDestination(unittest.TestCase):
    def test_the_menu_still_runs(self):
        for block in (number_hours(CLOSED), number_hours(CLOSED, action(enabled=False)),
                      number_hours(CLOSED, action("", "")), number_hours(CLOSED, action("VOICEMAIL", ""))):
            use(company=OPEN, ivrs={IVR: {"operational_hours": block}})
            xml = build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
            self.assertIn(RUNS_MENU % IVR, xml, block)
            self.assertTrue(logged("no closed-hours destination, running the menu"), block)


class G_MenuReadFails(unittest.TestCase):
    def test_a_failed_read_runs_the_menu(self):
        use(company=OPEN, ivr_boom=Exception(2013, "Lost connection"))
        xml = build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertIn(RUNS_MENU % IVR, xml)
        self.assertEqual(logged("menu hours lookup failed")[0]["level"], "error")

    def test_a_menu_with_no_row_runs(self):
        use(company=OPEN, ivrs={})
        xml = build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertIn(RUNS_MENU % IVR, xml)

    def test_a_menu_with_no_hours_runs(self):
        for settings in ({}, {"operational_hours": None}, {"operational_hours": "junk"}, "{not json", None, []):
            use(company=OPEN, ivrs={IVR: settings})
            xml = build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
            self.assertIn(RUNS_MENU % IVR, xml, settings)

    def test_a_failed_read_is_not_cached(self):
        conn = use(company=OPEN, ivr_boom=Exception(2013, "Lost connection"))
        build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertEqual(conn.counts["ivrs"], 2)

    def test_a_clock_that_throws_on_the_menu_runs_the_menu(self):
        use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(CLOSED, action())}})
        real = dps.business_hours_state

        def clock(hours, now_utc=None):
            if dps._as_object(hours).get("closed_hour_action"):
                raise RuntimeError("no tz database")
            return real(hours, now_utc)
        dps.business_hours_state = clock
        xml = build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertIn(RUNS_MENU % IVR, xml)
        self.assertEqual(logged("menu hours could not be judged")[0]["level"], "error")


class H_MissingOrGarbageCondition(unittest.TestCase):
    """Unknown never diverts."""

    def test_no_condition_block(self):
        use(company=OPEN)
        xml = build(did_row(condition=None))
        self.assertIn(RINGS_EXTENSION % ("1001", DOMAIN, "1001", DOMAIN), xml)
        self.assertFalse(logged("outside opening hours"))

    def test_rubbish_condition_blocks(self):
        for junk in ("garbage", 42, [], [1, 2], {"operational_hours": "x"}, {"operational_hours": []},
                     {"operational_hours": 7}, {"operational_hours": {"closed_hour_action": action()}}):
            use(company=OPEN)
            xml = build(did_row(condition=junk))
            self.assertIn(RINGS_EXTENSION % ("1001", DOMAIN, "1001", DOMAIN), xml, junk)
            self.assertFalse(logged("outside opening hours"), junk)

    def test_the_helper_itself(self):
        self.assertEqual(dps.number_operational_hours(None), {})
        self.assertEqual(dps.number_operational_hours("junk"), {})
        self.assertEqual(dps.number_operational_hours({"condition": "junk"}), {})
        self.assertEqual(dps.number_operational_hours({"condition": {"operational_hours": [1]}}), {})
        self.assertEqual(dps.number_operational_hours({"condition": {"operational_hours": {"type": "24_hours"}}}),
                         {"type": "24_hours"})

    def test_the_real_clock_reads_the_numbers_block_as_the_companys(self):
        # The stand-in clock is for the routing tests; the block the screen
        # saves must also satisfy the real one. 24 hours is open, and a
        # weekly timetable with no timezone is unknown.
        use(company=OPEN)
        real = dps.business_hours_state
        spec.loader.exec_module(dps)  # a fresh copy of the real function
        try:
            self.assertEqual(dps.business_hours_state({"type": "24_hours"}), OPEN)
            self.assertEqual(dps.business_hours_state({"type": "weekly", "value": {}, "regional": {}}), UNKNOWN)
        finally:
            dps.business_hours_state = real


class I_TheMenuReadIsCached(unittest.TestCase):
    def test_one_query_per_menu_per_interval(self):
        conn = use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(OPEN)}})
        for _ in range(5):
            build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertEqual(conn.counts["ivrs"], 1)

    def test_read_again_after_the_interval(self):
        conn = use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(OPEN)}})
        build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        dps._ivr_hours_cache_time[(DB, IVR)] -= dps.CALLING_RULES_CACHE_SECONDS + 1
        build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        self.assertEqual(conn.counts["ivrs"], 2)

    def test_cached_per_menu_and_per_tenant(self):
        conn = use(company=OPEN, ivrs={IVR: {}, "ivr-2": {}})
        build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        build(did_row(route=("IVR", "ivr-2"), number=number_hours(OPEN)))
        build(did_row(route=("IVR", IVR), number=number_hours(OPEN)))
        other = dict(did_row(route=("IVR", IVR), number=number_hours(OPEN)), db_name="mcm_other")
        build(other)
        self.assertEqual(conn.counts["ivrs"], 3)

    def test_a_change_shows_after_the_interval(self):
        conn = use(company=OPEN, ivrs={IVR: {"operational_hours": number_hours(OPEN)}})
        self.assertIn(RUNS_MENU % IVR, build(did_row(route=("IVR", IVR), number=number_hours(OPEN))))
        conn.ivrs[IVR] = {"operational_hours": number_hours(CLOSED, action("VOICEMAIL", "4004"))}
        self.assertIn(RUNS_MENU % IVR, build(did_row(route=("IVR", IVR), number=number_hours(OPEN))))
        dps._ivr_hours_cache_time[(DB, IVR)] -= dps.CALLING_RULES_CACHE_SECONDS + 1
        self.assertIn(VOICEMAIL_FOR % "4004", build(did_row(route=("IVR", IVR), number=number_hours(OPEN))))


class J_NothingElseMoved(unittest.TestCase):
    def test_the_channel_guard_and_recording_are_still_there(self):
        use(company=OPEN)
        xml = build(did_row(number=number_hours(CLOSED, action("EXTENSION", "3003"))))
        self.assertIn('application="limit" data="hash company_channels', xml)
        self.assertIn('data="call_timeout=', xml)

    def test_an_unhandled_closed_type_still_takes_the_unhandled_path(self):
        use(company=OPEN)
        # DEPARTMENT used to be the example here; it has been routable since the
        # ivr-transfers patch (3 Sep 2026), so a type nobody handles stands in.
        xml = build(did_row(number=number_hours(CLOSED, action("PAGER", "pg-1"))))
        self.assertEqual(xml, dps.NOT_FOUND_TPL)
        self.assertEqual(logged("unhandled route type")[0]["route_type"], "PAGER")

    def test_no_forward_actions_is_still_not_found(self):
        use(company=OPEN)
        self.assertEqual(build({"forward_call_actions": None, "company_uuid": COMPANY, "db_name": DB}),
                         dps.NOT_FOUND_TPL)

    def test_the_marker_is_present_once(self):
        with open(TARGET, encoding="utf-8") as handle:
            source = handle.read()
        self.assertEqual(source.count("line_hours: a number's and a menu's own hours are honoured"), 1)
        self.assertEqual(source.count(".ivrs WHERE uuid"), 1)


if __name__ == "__main__":
    unittest.main(argv=sys.argv[:1], verbosity=2)
