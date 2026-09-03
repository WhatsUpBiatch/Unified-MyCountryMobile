import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from channel_limit import channel_allowance, limit_actions, LIMIT_REALM, MAX_ALLOWANCE

passed = 0
def check(what, fn):
    global passed
    fn(); passed += 1; print("  ok  " + what)

# ---- the commercial rule the owner stated: one per number, plus one
check("one number answers two calls at once", lambda: (_ for _ in ()).throw(AssertionError()) if channel_allowance(1) != 2 else None)
check("ten numbers answer eleven", lambda: None if channel_allowance(10) == 11 else (_ for _ in ()).throw(AssertionError(str(channel_allowance(10)))))
check("two numbers answer three", lambda: None if channel_allowance(2) == 3 else (_ for _ in ()).throw(AssertionError()))
check("a customer with no numbers still gets one", lambda: None if channel_allowance(0) == 1 else (_ for _ in ()).throw(AssertionError()))

# ---- fail open: an unknown count must never become a limit of zero
def _fail_open():
    for bad in (None, "", "abc", -1, -50, [], {}, True, False):
        assert channel_allowance(bad) is None, "%r became %r" % (bad, channel_allowance(bad))
check("CONTROL an unreadable count yields no limit, never zero", _fail_open)

def _fail_open_actions():
    for bad in (None, "", "abc", -1):
        assert limit_actions("c-1", bad) == [], repr(bad)
check("CONTROL an unreadable count produces no dialplan action at all", _fail_open_actions)

check("a missing company produces no action", lambda: None if limit_actions("", 5) == [] and limit_actions(None, 5) == [] else (_ for _ in ()).throw(AssertionError()))

def _spaces():
    assert limit_actions("c 1", 5) == []
    assert limit_actions("c\t1", 5) == []
check("a uuid with whitespace is refused rather than escaped", _spaces)

# ---- the action itself
def _shape():
    acts = limit_actions("a5bd159a-cdfd-42fc-9a8b-6b04a1ba8ff5", 5)
    assert len(acts) == 1, acts
    assert acts[0]["application"] == "limit"
    assert acts[0]["data"] == "hash %s a5bd159a-cdfd-42fc-9a8b-6b04a1ba8ff5 6 !USER_BUSY" % LIMIT_REALM, acts[0]["data"]
check("the action counts against the company and hangs up as busy past the limit", _shape)

def _five_numbers():
    acts = limit_actions("c-1", 5)
    assert " 6 " in acts[0]["data"], acts[0]["data"]
check("a customer with five numbers is allowed six calls", _five_numbers)

def _ceiling():
    assert channel_allowance(10**9) == MAX_ALLOWANCE
    assert channel_allowance(MAX_ALLOWANCE + 100) == MAX_ALLOWANCE
check("an absurd count is capped rather than becoming unlimited", _ceiling)

def _prependable():
    actions = [{"application": "bridge", "data": "user/1000"}]
    assert limit_actions(None, None) + actions == actions
    combined = limit_actions("c-1", 2) + actions
    assert combined[0]["application"] == "limit"
    assert combined[-1]["application"] == "bridge"
check("the result is always prependable, limit first and bridge last", _prependable)

def _control_would_catch():
    # If the rule were wrongly written as "one channel per number", this differs.
    assert channel_allowance(10) != 10, "a plain per-number rule would give 10"
    assert channel_allowance(1) != 1
check("CONTROL the +1 really is applied, not a plain per-number rule", _control_would_catch)

print("\n  %d checks passed" % passed)
