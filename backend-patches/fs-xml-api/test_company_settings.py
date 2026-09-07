"""Where a company-wide setting is read from, proved without a database.

The five readers (ring time, opening hours, recording, on-demand recording,
calling rules) must give the same answer whether a tenant has been moved to
the `company_settings` table, has not, or has nothing set anywhere. Every case
here is one of those three tenants asking one of those five questions, plus
the failure paths - because the one thing this change must never do is fail
a call that connects today.

Usage: python3 test_company_settings.py <path to patched dialplan_service.py>
(the file's sibling modules channel_limit.py and queue_media.py must be
importable, so run it from a directory that has them, or copy them beside it).
"""

import importlib.util
import json
import os
import sys
import types
import unittest

# The service imports pymysql at module level and only opens a connection from
# main(), so a stub is enough to import it and drive the readers with a fake.
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
NO_SUCH_TABLE = 1146


class FakeCursor:
    """Just enough of a pymysql DictCursor to route the three queries the
    readers make, so the REAL query path is exercised, not a stub that agrees
    with itself.

    `sections`  None  -> the company_settings table does not exist (1146)
                dict  -> section -> stored value (str is a JSON column as
                         pymysql hands it back; dict/list is already parsed;
                         None is a row whose value is NULL)
    `template`  the Company Default blob (str or dict), or None for no row
    `user`      the users.settings blob for the calling-rules person read
    `boom`      an exception to raise on the company_settings query instead
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
            if c.boom is not None:
                raise c.boom
            if c.sections is None:
                raise Exception(NO_SUCH_TABLE, "Table '%s.company_settings' doesn't exist" % DB)
            section = params[0]
            self._row = {"settings": c.sections[section]} if section in c.sections else None
        elif "user_template" in sql:
            c.counts["user_template"] += 1
            if c.template_boom is not None:
                raise c.template_boom
            self._row = {"settings": c.template} if c.template is not None else None
        elif "FROM users" in sql:
            c.counts["users"] += 1
            self._row = {"settings": c.user}
        else:
            raise AssertionError("unexpected query: %s" % sql)

    def fetchone(self):
        return self._row


class FakeConnection:
    def __init__(self, sections=None, template=None, user=None, boom=None, template_boom=None):
        self.sections = sections
        self.template = template
        self.user = user
        self.boom = boom
        self.template_boom = template_boom
        self.counts = {"company_settings": 0, "user_template": 0, "users": 0}

    def cursor(self):
        return FakeCursor(self)


def use(**kw):
    """Point the module at a fresh fake database and empty every cache, so one
    test cannot answer from what the last one read."""
    conn = FakeConnection(**kw)
    dps.get_db = lambda: conn
    for cache in (dps._ring_cache, dps._ring_cache_time, dps._hours_cache, dps._hours_cache_time,
                  dps._recording_cache, dps._recording_cache_time,
                  dps._calling_rules_cache, dps._calling_rules_time,
                  dps._company_settings_missing):
        cache.clear()
    return conn


# The same five settings, as a template blob (old) and as sections (new). The
# values differ on purpose so a test can tell which place was read.
OLD = {
    "company_ring_time": {"seconds": 45},
    "operational_hours": {"type": "24_hours", "holidays": ["2026-12-25"]},
    "company_holidays": {"items": [{"from": "2026-01-01", "to": "2026-01-01"}]},
    "recording": {"automatic": {"enabled": True, "value": "incoming"}, "on_demand": {"enabled": True}},
    "company_calling_permissions": {"international_calling": {"restricted": True, "countries": ["GB"]}},
}
NEW = {
    "company_ring_time": {"seconds": 20},
    "operational_hours": {"type": "weekly", "holidays": ["2026-12-26"]},
    "company_holidays": {"items": [{"from": "2026-07-04", "to": "2026-07-04"}]},
    "recording": {"automatic": {"enabled": True, "value": "all"}, "on_demand": {"enabled": False}},
    "company_calling_permissions": {"international_calling": {"restricted": True, "countries": ["US", "CA"]}},
}


def read_everything():
    return {
        "ring": dps.company_ring_seconds(DB, "co-1"),
        "hours": dps.company_operational_hours(DB),
        "recording": dps.company_recording_policy(DB),
        "on_demand": dps.company_on_demand_enabled(DB),
        "rules": dps.get_calling_rules(DB, "co-1", "user-1"),
    }


class A_TheNewTableIsRead(unittest.TestCase):
    def test_every_reader_takes_its_section_from_company_settings(self):
        conn = use(sections=NEW, template=OLD)
        got = read_everything()
        self.assertEqual(got["ring"], 20)
        self.assertEqual(got["hours"]["type"], "weekly")
        self.assertEqual(got["recording"], "all")
        self.assertIs(got["on_demand"], False)
        self.assertTrue(got["rules"]["restricted"])
        self.assertEqual(got["rules"]["company_countries"], {"US", "CA"})
        # And the template row was not consulted at all.
        self.assertEqual(conn.counts["user_template"], 0)

    def test_a_section_missing_from_the_table_falls_back_on_its_own(self):
        # Half-migrated: the table exists but only some sections have rows.
        partial = {"recording": NEW["recording"]}
        use(sections=partial, template=OLD)
        self.assertEqual(dps.company_recording_policy(DB), "all")   # new
        self.assertEqual(dps.company_ring_seconds(DB, "co-1"), 45)  # old

    def test_a_null_value_is_not_set_here(self):
        use(sections={"company_ring_time": None}, template=OLD)
        self.assertEqual(dps.company_ring_seconds(DB, "co-1"), 45)

    def test_the_new_table_wins_even_when_it_says_off(self):
        # The migration's whole risk: an old blob says "record", the new row
        # says "do not". The new row is the truth.
        off = {"recording": {"automatic": {"enabled": False, "value": "all"}}}
        use(sections=off, template=OLD)
        self.assertEqual(dps.company_recording_policy(DB), "off")


class B_NoTableYet(unittest.TestCase):
    def test_1146_falls_back_to_the_template_row(self):
        conn = use(sections=None, template=OLD)
        got = read_everything()
        self.assertEqual(got["ring"], 45)
        self.assertEqual(got["hours"]["type"], "24_hours")
        self.assertEqual(got["recording"], "incoming")
        self.assertIs(got["on_demand"], True)
        self.assertTrue(got["rules"]["restricted"])
        self.assertEqual(got["rules"]["company_countries"], {"GB"})
        self.assertGreater(conn.counts["user_template"], 0)

    def test_the_missing_table_is_tried_once_per_interval_not_once_per_call(self):
        conn = use(sections=None, template=OLD)
        for _ in range(5):
            dps.company_on_demand_enabled(DB)      # this reader has no cache of its own
        self.assertEqual(conn.counts["company_settings"], 1)
        self.assertEqual(conn.counts["user_template"], 5)

    def test_the_table_is_looked_for_again_after_the_interval(self):
        conn = use(sections=None, template=OLD)
        dps.company_on_demand_enabled(DB)
        dps._company_settings_missing[DB] -= dps.CALLING_RULES_CACHE_SECONDS + 1
        dps.company_on_demand_enabled(DB)
        self.assertEqual(conn.counts["company_settings"], 2)

    def test_a_table_that_appears_is_picked_up_after_the_interval(self):
        conn = use(sections=None, template=OLD)
        self.assertIs(dps.company_on_demand_enabled(DB), True)
        conn.sections = NEW                       # the migration ran
        self.assertIs(dps.company_on_demand_enabled(DB), True)   # still inside the interval
        dps._company_settings_missing[DB] -= dps.CALLING_RULES_CACHE_SECONDS + 1
        self.assertIs(dps.company_on_demand_enabled(DB), False)  # now read from the table
        self.assertNotIn(DB, dps._company_settings_missing)

    def test_the_absence_is_remembered_per_tenant(self):
        conn = use(sections=None, template=OLD)
        dps.company_on_demand_enabled("mcm_a")
        dps.company_on_demand_enabled("mcm_b")
        dps.company_on_demand_enabled("mcm_a")
        self.assertEqual(conn.counts["company_settings"], 2)


class C_NothingSetAnywhere(unittest.TestCase):
    """The defaults every tenant gets today, unchanged."""

    def check_defaults(self, got):
        self.assertEqual(got["ring"], dps.RING_SECONDS_DEFAULT)
        self.assertEqual(got["hours"], {})
        self.assertEqual(dps.business_hours_state(got["hours"]), dps.OPERATIONAL_HOURS_UNKNOWN)
        self.assertEqual(got["recording"], "off")
        self.assertIs(got["on_demand"], False)
        self.assertEqual(got["rules"], {"restricted": False, "company_countries": set(),
                                        "person_allowed": None, "person_countries": set()})

    def test_no_table_and_no_template_row(self):
        use(sections=None, template=None)
        self.check_defaults(read_everything())

    def test_an_empty_table_and_no_template_row(self):
        use(sections={}, template=None)
        self.check_defaults(read_everything())

    def test_an_empty_table_and_an_empty_template_blob(self):
        use(sections={}, template={})
        self.check_defaults(read_everything())

    def test_no_database_name_at_all(self):
        conn = use(sections=NEW, template=OLD)
        self.assertEqual(dps.company_ring_seconds("", "co-1"), dps.RING_SECONDS_DEFAULT)
        self.assertEqual(dps.company_operational_hours(""), {})
        self.assertEqual(dps.company_recording_policy(""), "off")
        self.assertIs(dps.company_on_demand_enabled(""), False)
        self.assertIsNone(dps.company_section("", "recording"))
        self.assertEqual(conn.counts["company_settings"], 0)


class D_JsonStringOrParsed(unittest.TestCase):
    """pymysql hands a JSON column back as text; a dict is what a converter or
    a hand-written record gives. Both must read the same."""

    def test_sections_stored_as_json_text(self):
        use(sections={k: json.dumps(v) for k, v in NEW.items()}, template=None)
        got = read_everything()
        self.assertEqual(got["ring"], 20)
        self.assertEqual(got["recording"], "all")
        self.assertEqual(got["rules"]["company_countries"], {"US", "CA"})

    def test_sections_already_parsed(self):
        use(sections=NEW, template=None)
        got = read_everything()
        self.assertEqual(got["ring"], 20)
        self.assertEqual(got["recording"], "all")

    def test_the_template_blob_as_json_text(self):
        use(sections=None, template=json.dumps(OLD))
        self.assertEqual(dps.company_ring_seconds(DB, "co-1"), 45)
        self.assertEqual(dps.company_recording_policy(DB), "incoming")

    def test_unreadable_json_in_the_table_is_not_a_setting(self):
        # `_as_object` turns it into {}, the same as an absent key today.
        use(sections={"recording": "{not json", "company_ring_time": "[["}, template=None)
        self.assertEqual(dps.company_recording_policy(DB), "off")
        self.assertEqual(dps.company_ring_seconds(DB, "co-1"), dps.RING_SECONDS_DEFAULT)


class E_RingSecondsRangeStillHolds(unittest.TestCase):
    def test_out_of_range_from_the_new_table_is_the_default(self):
        for bad in (0, 4, 121, 500, -30, "abc", None, "", {"nested": 1}):
            use(sections={"company_ring_time": {"seconds": bad}}, template=OLD)
            self.assertEqual(dps.company_ring_seconds(DB, "co-%r" % (bad,)),
                             dps.RING_SECONDS_DEFAULT, bad)

    def test_the_edges_are_still_inclusive(self):
        use(sections={"company_ring_time": {"seconds": dps.RING_SECONDS_MIN}}, template=None)
        self.assertEqual(dps.company_ring_seconds(DB, "lo"), dps.RING_SECONDS_MIN)
        use(sections={"company_ring_time": {"seconds": dps.RING_SECONDS_MAX}}, template=None)
        self.assertEqual(dps.company_ring_seconds(DB, "hi"), dps.RING_SECONDS_MAX)

    def test_a_numeric_string_still_counts(self):
        use(sections={"company_ring_time": {"seconds": "25"}}, template=None)
        self.assertEqual(dps.company_ring_seconds(DB, "str"), 25)

    def test_a_caller_supplied_fallback_is_still_honoured(self):
        use(sections={}, template=None)
        self.assertEqual(dps.company_ring_seconds(DB, "fb", fallback=12), 12)


class F_HolidaysStillMerge(unittest.TestCase):
    def test_both_lists_when_hours_come_from_the_new_table(self):
        use(sections=NEW, template=OLD)
        hours = dps.company_operational_hours(DB)
        self.assertEqual(hours["holidays"], ["2026-12-26", {"from": "2026-07-04", "to": "2026-07-04"}])

    def test_the_declared_list_may_be_a_bare_list(self):
        sections = dict(NEW, company_holidays=[{"from": "2026-07-04", "to": "2026-07-04"}])
        use(sections=sections, template=None)
        hours = dps.company_operational_hours(DB)
        self.assertEqual(len(hours["holidays"]), 2)

    def test_the_declared_list_when_hours_have_none_of_their_own(self):
        sections = {"operational_hours": {"type": "24_hours"}, "company_holidays": NEW["company_holidays"]}
        use(sections=sections, template=None)
        hours = dps.company_operational_hours(DB)
        self.assertEqual(hours["holidays"], [{"from": "2026-07-04", "to": "2026-07-04"}])

    def test_each_half_can_come_from_a_different_place(self):
        # Hours migrated, the holiday list not yet.
        use(sections={"operational_hours": NEW["operational_hours"]}, template=OLD)
        hours = dps.company_operational_hours(DB)
        self.assertEqual(hours["holidays"], ["2026-12-26", {"from": "2026-01-01", "to": "2026-01-01"}])

    def test_an_empty_declared_list_changes_nothing(self):
        for declared in ({"items": []}, [], {}, None, "junk"):
            use(sections=dict(NEW, company_holidays=declared), template=None)
            self.assertEqual(dps.company_operational_hours(DB)["holidays"], ["2026-12-26"], declared)

    def test_the_merged_hours_still_close_the_day(self):
        import datetime
        use(sections=NEW, template=OLD)
        hours = dps.company_operational_hours(DB)
        always = dict(hours, type="24_hours", regional={"timezone": {"value": "UTC"}})
        at = datetime.datetime.fromisoformat("2026-07-04T11:00:00+00:00")
        self.assertEqual(dps.business_hours_state(always, at), dps.OPERATIONAL_HOURS_CLOSED)

    def test_the_old_blob_still_merges_when_there_is_no_table(self):
        use(sections=None, template=OLD)
        hours = dps.company_operational_hours(DB)
        self.assertEqual(hours["holidays"], ["2026-12-25", {"from": "2026-01-01", "to": "2026-01-01"}])


class G_NothingFailsClosed(unittest.TestCase):
    def test_an_unexpected_error_on_the_new_table_reads_the_old_place(self):
        conn = use(sections=NEW, template=OLD, boom=Exception(2013, "Lost connection"))
        self.assertEqual(dps.company_recording_policy(DB), "incoming")
        # And it is not mistaken for a missing table: the next call tries again.
        self.assertNotIn(DB, dps._company_settings_missing)
        dps._recording_cache.clear()
        dps.company_recording_policy(DB)
        self.assertEqual(conn.counts["company_settings"], 2)

    def test_an_error_with_no_code_is_not_a_missing_table_either(self):
        use(sections=NEW, template=OLD, boom=RuntimeError("no args shape"))
        self.assertEqual(dps.company_ring_seconds(DB, "co-1"), 45)
        self.assertNotIn(DB, dps._company_settings_missing)

    def test_both_reads_failing_gives_todays_defaults(self):
        use(sections=None, template=None, template_boom=Exception(2013, "Lost connection"))
        got = read_everything()
        self.assertEqual(got["ring"], dps.RING_SECONDS_DEFAULT)
        self.assertEqual(got["hours"], {})
        self.assertEqual(got["recording"], "off")
        self.assertIs(got["on_demand"], False)
        self.assertFalse(got["rules"]["restricted"])

    def test_a_connection_that_cannot_be_opened_gives_todays_defaults(self):
        use(sections=NEW, template=OLD)

        def no_db():
            raise Exception(2003, "Can't connect")
        dps.get_db = no_db
        got = read_everything()
        self.assertEqual(got["ring"], dps.RING_SECONDS_DEFAULT)
        self.assertEqual(got["hours"], {})
        self.assertEqual(got["recording"], "off")
        self.assertIs(got["on_demand"], False)
        self.assertFalse(got["rules"]["restricted"])

    def test_the_readers_own_caches_still_work(self):
        conn = use(sections=NEW, template=OLD)
        for _ in range(3):
            dps.company_ring_seconds(DB, "co-1")
            dps.company_operational_hours(DB)
            dps.company_recording_policy(DB)
            dps.get_calling_rules(DB, "co-1", "user-1")
        # ring 1 + hours 2 + recording 1 + rules 1 = 5 section reads, once each.
        self.assertEqual(conn.counts["company_settings"], 5)


class H_TheHelperItself(unittest.TestCase):
    def test_returns_none_for_a_section_nobody_set(self):
        use(sections={}, template={})
        self.assertIsNone(dps.company_section(DB, "recording"))
        use(sections=None, template=None)
        self.assertIsNone(dps.company_section(DB, "recording"))

    def test_returns_the_parsed_section(self):
        use(sections={"recording": json.dumps({"a": 1})}, template=None)
        self.assertEqual(dps.company_section(DB, "recording"), {"a": 1})

    def test_the_error_code_reader(self):
        self.assertEqual(dps._mysql_error_code(Exception(1146, "x")), 1146)
        self.assertIsNone(dps._mysql_error_code(Exception("x")))
        self.assertIsNone(dps._mysql_error_code(Exception()))
        self.assertIsNone(dps._mysql_error_code(None))

    def test_only_the_helper_runs_the_template_query(self):
        with open(TARGET, encoding="utf-8") as handle:
            source = handle.read()
        self.assertEqual(source.count("user_template WHERE name"), 1)
        self.assertEqual(source.count("company_settings WHERE section"), 1)


if __name__ == "__main__":
    unittest.main(argv=sys.argv[:1], verbosity=2)
