#!/usr/bin/env python3
"""The agent service must never ring a member carrying `suspended_member`.

    python3 tests/queue_agent_suspended_member_test.py [path/to/queue_agent_service.py]

Control first: on the UNPATCHED file the marker is ignored and the test fails.
"""
import importlib.util, os, sys, unittest

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "queue-agent-service", "running", "queue_agent_service.py")
spec = importlib.util.spec_from_file_location("qas", SRC)
svc = importlib.util.module_from_spec(spec)
sys.modules["queue_exit"] = type(sys)("queue_exit")
sys.modules["queue_exit"].queue_exit = lambda q: None
sys.modules["queue_exit"].queue_timeout_seconds = lambda q: 60
sys.modules["queue_exit"].max_callers = lambda q: 0
spec.loader.exec_module(svc)

NOW = 1_800_000_000


def available(**extra):
    row = {"name": "1000@x.mycountrymobile.com", "contact": "user/1000_web@x.mycountrymobile.com",
           "status": "Available", "state": "Waiting"}
    row.update(extra)
    return row


class SuspendedMember(unittest.TestCase):
    def test_available_person_rings(self):
        self.assertTrue(svc.is_ringable(available(), NOW))

    def test_marker_blocks_even_when_available(self):
        self.assertFalse(svc.is_ringable(available(suspended_member={"at": "2026-09-03T10:00:00Z", "reason": "suspended"}), NOW))

    def test_marker_is_projected(self):
        self.assertEqual(svc.AGENT_FIELDS.get("suspended_member"), 1)

    def test_logged_out_row_never_rang_anyway(self):
        self.assertFalse(svc.is_ringable(available(status="Logged Out", state="Logged Out"), NOW))

    def test_removed_marker_cleared_rings_again(self):
        row = available(suspended_member=None)
        self.assertTrue(svc.is_ringable(row, NOW))


if __name__ == "__main__":
    sys.argv = sys.argv[:1]
    unittest.main(verbosity=1)
