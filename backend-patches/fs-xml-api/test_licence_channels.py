#!/usr/bin/env python3
"""Concurrent calls follow licences, not numbers.

Run against a dialplan_service.py:  test_licence_channels.py <path>
The service imports sibling modules (channel_limit, queue_media) at load
time, so run it with PYTHONPATH pointing at the directory holding the copy
under test. The suite must FAIL on the unpatched file - that is the control.
"""
import importlib
import importlib.util
import inspect
import sys
import types
import unittest

TARGET = sys.argv[1] if len(sys.argv) > 1 else "dialplan_service.py"


def _load(path):
    # The service imports its database driver and friends at module level and
    # only opens a connection from main(). Stub whatever is missing here so
    # the copy imports; the tests never touch a real database.
    for _ in range(12):
        spec = importlib.util.spec_from_file_location("dps", path)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
            return mod
        except ModuleNotFoundError as e:
            name = e.name
            if name in sys.modules:
                raise
            stub = types.ModuleType(name)
            stub.__path__ = []
            sys.modules[name] = stub
    raise RuntimeError("could not import %s" % path)


dps = _load(TARGET)
channel_limit = importlib.import_module("channel_limit")


class FakeCursor:
    def __init__(self, rows, log):
        self.rows, self.log = rows, log

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params):
        self.log.append((sql, params))

    def fetchone(self):
        return self.rows


class FakeConn:
    def __init__(self, rows, log):
        self.rows, self.log = rows, log

    def cursor(self):
        return FakeCursor(self.rows, self.log)


def fake_db(rows, log):
    def get_db():
        if isinstance(rows, Exception):
            raise rows
        return FakeConn(rows, log)
    return get_db


class LicenceRule(unittest.TestCase):
    def setUp(self):
        dps._licence_count_cache.clear()
        dps._licence_count_cache_time.clear()

    def test_the_count_is_licences_not_numbers(self):
        self.assertTrue(hasattr(dps, "company_licence_count"))
        self.assertFalse(hasattr(dps, "company_number_count"))
        src = inspect.getsource(dps.company_licence_count)
        self.assertIn("SELECT licenses FROM companies", src)
        self.assertNotIn("did_numbers", src)

    def test_the_call_path_uses_it(self):
        with open(TARGET) as fh:
            text = fh.read()
        self.assertIn("limit_actions(company_uuid, company_licence_count(company_uuid))", text)
        self.assertNotIn("company_number_count", text)

    def test_five_licences_read_as_five(self):
        log = []
        dps.get_db = fake_db({"licenses": 5}, log)
        self.assertEqual(dps.company_licence_count("c-1"), 5)
        self.assertEqual(log[0][1], ("c-1",))

    def test_no_licences_is_zero_not_none(self):
        # A company with nothing bought still gets the spare channel; only a
        # failed read leaves the call unlimited.
        dps.get_db = fake_db({"licenses": None}, [])
        self.assertEqual(dps.company_licence_count("c-2"), 0)
        self.assertEqual(channel_limit.channel_allowance(0), 1)

    def test_a_failed_read_fails_open(self):
        dps.get_db = fake_db(RuntimeError("db down"), [])
        self.assertIsNone(dps.company_licence_count("c-3"))
        self.assertEqual(channel_limit.limit_actions("c-3", None), [])

    def test_the_read_is_cached(self):
        log = []
        dps.get_db = fake_db({"licenses": 3}, log)
        dps.company_licence_count("c-4")
        dps.company_licence_count("c-4")
        self.assertEqual(len(log), 1)

    def test_three_licences_answer_four_calls(self):
        # The owner's rule, stated in their words: three licences, four calls.
        self.assertEqual(channel_limit.channel_allowance(3), 4)
        actions = channel_limit.limit_actions("c-5", 3)
        self.assertEqual(actions[0]["data"].split()[3], "4")

    def test_a_runaway_row_is_capped(self):
        # Capanicus holds 2001 licences on an expired plan.
        self.assertEqual(channel_limit.channel_allowance(2001), 500)

    def test_the_allowance_module_no_longer_says_numbers(self):
        # "per number" still appears once, correctly, about the carrier's own
        # cap; the rule sentence is what must have changed.
        self.assertIn("one channel per\nlicence they have bought", channel_limit.__doc__)
        self.assertNotIn("one channel per number", channel_limit.__doc__)
        self.assertIn("licence_count", inspect.signature(channel_limit.limit_actions).parameters)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=1)
