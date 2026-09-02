import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from queue_media import (  # noqa: E402
    MEDIA_VARIABLES,
    cache_path,
    enabled_media,
    media_actions,
    safe_name,
    welcome_actions,
)

passed = 0


def check(what, fn):
    global passed
    fn()
    passed += 1
    print("  ok  " + what)


COMPANY = "828a44f5-1ac8-4181-bc3f-6444f4a15ef7"
WAITING = "f9950b16-f47b-4f6b-9a20-3e710548edbb.mp3"

QUEUE = {
    "settings": {
        "media": {
            "welcome": {"enabled": True, "value": "welcome-file.wav"},
            "hold": {"enabled": False, "value": "never-chosen.mp3"},
            "waiting": {"enabled": True, "value": WAITING},
            "ring_tone": {"enabled": True, "value": "ring.wav"},
            "no_agent_available": {"enabled": True, "value": ""},
        }
    }
}

ok_fetch = lambda c, n: "/etc/freeswitch/sounds/mcm/greetings/%s/%s" % (c, n)
no_fetch = lambda c, n: None


def _enabled():
    got = enabled_media(QUEUE)
    assert got == {"welcome": "welcome-file.wav", "waiting": WAITING, "ring_tone": "ring.wav"}, got


check("only greetings switched on WITH a file chosen count", _enabled)


def _off_is_off():
    # 'hold' is switched off even though a file is chosen
    assert "hold" not in enabled_media(QUEUE)
    # 'no_agent_available' is on but empty - half finished, not an instruction
    assert "no_agent_available" not in enabled_media(QUEUE)


check("CONTROL a chosen-but-off file and an on-but-empty slot are both skipped", _off_is_off)


def _actions():
    acts = media_actions(QUEUE, COMPANY, ok_fetch)
    datas = [a["data"] for a in acts]
    # waiting and ring_tone are both switched on in the fixture; hold is off and
    # no_agent_available is on but empty, so neither appears.
    assert len(acts) == 2, datas
    assert any(d.startswith("cc_waiting_media=/etc/freeswitch/") for d in datas), datas
    assert all(a["application"] == "set" for a in acts)


check("the waiting message is pointed at the variable the script reads", _actions)


def _unmapped_slot_is_skipped():
    # A slot with no variable in MEDIA_VARIABLES must produce no action at all,
    # rather than a set of something the script never reads. (The ring tone used
    # to be this case; it now has cc_ring_tone, so an invented slot stands in.)
    q = {"settings": {"media": {"not_a_real_slot": {"enabled": True, "value": "x.wav"}}}}
    assert media_actions(q, COMPANY, ok_fetch) == []


check("a greeting the script cannot use produces no action rather than a bad one", _unmapped_slot_is_skipped)


def _fail_open():
    assert media_actions(QUEUE, COMPANY, no_fetch) == []
    assert welcome_actions(QUEUE, COMPANY, no_fetch) == []


check("CONTROL audio that cannot be fetched sets nothing, so the default still plays", _fail_open)


def _never_empty():
    for a in media_actions(QUEUE, COMPANY, ok_fetch):
        assert not a["data"].endswith("="), a
        assert "=" in a["data"]


check("no variable is ever set to an empty path", _never_empty)


def _welcome():
    acts = welcome_actions(QUEUE, COMPANY, ok_fetch)
    assert len(acts) == 1 and acts[0]["application"] == "playback", acts
    assert acts[0]["data"].endswith("welcome-file.wav")
    # and it must not also appear as a variable
    assert not any("welcome" in a["data"] for a in media_actions(QUEUE, COMPANY, ok_fetch))


check("the welcome is played once, and is not also set as a variable", _welcome)


def _names():
    assert safe_name("abc-123.mp3") == "abc-123.mp3"
    for bad in ("../../etc/passwd", "a/b.mp3", "he llo.mp3", 'x".wav', "", None, "noextension"):
        assert safe_name(bad) is None, bad


check("a filename with a slash, a space, a quote or dots is refused", _names)


def _path():
    p = cache_path(COMPANY, WAITING)
    assert p == "/etc/freeswitch/sounds/mcm/greetings/%s/%s" % (COMPANY, WAITING), p
    assert cache_path("", WAITING) is None
    assert cache_path(COMPANY, "../x.mp3") is None


check("the cache path stays under the directory the switch can see", _path)


def _junk():
    for junk in (None, {}, {"settings": None}, {"settings": {"media": "nope"}}, []):
        assert enabled_media(junk) == {}
        assert media_actions(junk, COMPANY, ok_fetch) == []


check("a malformed queue record yields nothing rather than throwing", _junk)


def _variables_are_the_ones_the_script_reads():
    # Named here so a rename on either side breaks a test rather than the audio.
    assert MEDIA_VARIABLES["hold"] == "cc_hold_music"
    assert MEDIA_VARIABLES["waiting"] == "cc_waiting_media"
    assert MEDIA_VARIABLES["no_agent_available"] == "cc_no_agent_available_media"
    assert MEDIA_VARIABLES["all_agent_busy"] == "cc_all_agent_busy_media"


check("the variable names match the ones callcenter-queue.lua reads", _variables_are_the_ones_the_script_reads)

print("\n  %d checks passed" % passed)

# --- ring strategy: the setting that never reached the switch ---------------
from queue_media import queue_behaviour_actions, queue_strategy, queue_wrapup_seconds  # noqa: E402

def _strategy_shapes():
    assert queue_strategy({"settings": {"ring_strategy": {"label": "Ring All", "value": "ring-all"}}}) == "ring-all"
    assert queue_strategy({"settings": {"ring_strategy": "round-robin"}}) == "round-robin"
    assert queue_strategy({"settings": {"ring_strategy": {"value": {"value": "top-down"}}}}) == "top-down"
check("the strategy is read from every shape the form has stored", _strategy_shapes)

def _strategy_junk():
    for bad in ({}, {"settings": {}}, {"settings": {"ring_strategy": None}},
                {"settings": {"ring_strategy": {"value": "not-a-strategy"}}}, None):
        assert queue_strategy(bad) == "", bad
check("CONTROL an unknown strategy is dropped, never forwarded as an override", _strategy_junk)

def _every_ui_option_survives():
    # Every option the queue screen offers must come through, or picking it does nothing.
    for v in ("ring-all", "longest-idle-agent", "round-robin", "top-down",
              "agent-with-least-talk-time", "agent-with-fewest-calls", "random"):
        assert queue_strategy({"settings": {"ring_strategy": {"value": v}}}) == v, v
check("every strategy the queue screen offers is passed through", _every_ui_option_survives)

def _behaviour():
    acts = queue_behaviour_actions({"settings": {"ring_strategy": {"value": "ring-all"}, "wrapup_time": 30}})
    assert [a["data"] for a in acts] == ["cc_ring_strategy=ring-all", "cc_wrapup_time=30"], acts
check("the strategy and wrap-up are set as the variables the script reads", _behaviour)

def _wrapup_bounds():
    assert queue_wrapup_seconds({"settings": {"wrapup_time": 0}}) == 0
    assert queue_wrapup_seconds({"settings": {"wrapup_time": -5}}) == 0
    assert queue_wrapup_seconds({"settings": {"wrapup_time": 99999}}) == 0
    assert queue_wrapup_seconds({"settings": {"wrapup_time": "45"}}) == 45
check("a nonsense wrap-up leaves the script's own default alone", _wrapup_bounds)

print("\n  %d checks passed in total" % passed)

# --- the cap on how many callers wait, which never did anything -------------
from queue_media import MAX_CALLERS_VARIABLE, queue_max_callers  # noqa: E402

def _both_shapes():
    assert queue_max_callers({"settings": {"ring_strategy": {"max_wait_time": {"callers": 5}}}}) == 5
    assert queue_max_callers({"settings": {"ring_strategy": {"max_wait_time": {"callers": {"label": 5, "value": 5}}}}}) == 5
    assert queue_max_callers({"settings": {"ring_strategy": {"max_wait_time": {"callers": "12"}}}}) == 12
check("the cap is read whether it was saved as a number or a dropdown pair", _both_shapes)

def _no_cap():
    # Blank, zero or nonsense means no cap - never "hold nobody"
    for bad in ({}, {"settings": {}}, {"settings": {"ring_strategy": {}}},
                {"settings": {"ring_strategy": {"max_wait_time": {"callers": 0}}}},
                {"settings": {"ring_strategy": {"max_wait_time": {"callers": ""}}}},
                {"settings": {"ring_strategy": {"max_wait_time": {"callers": -3}}}}, None):
        assert queue_max_callers(bad) == 0, bad
check("CONTROL a blank or zero cap means no cap, never a queue that holds nobody", _no_cap)

def _cap_action():
    acts = queue_behaviour_actions({"settings": {"ring_strategy": {"value": "ring-all", "max_wait_time": {"callers": 5}}}})
    assert any(a["data"] == "%s=5" % MAX_CALLERS_VARIABLE for a in acts), acts
    # and no cap emits no action at all, so the script keeps its own behaviour
    acts2 = queue_behaviour_actions({"settings": {"ring_strategy": {"value": "ring-all"}}})
    assert not any(MAX_CALLERS_VARIABLE in a["data"] for a in acts2), acts2
check("the cap is passed to the switch, and absent when there is none", _cap_action)

print("\n  %d checks passed in total" % passed)

# --- a queue's own opening hours, which nothing has ever read ---------------
from queue_media import queue_closed_route, queue_hours  # noqa: E402
import queue_media as _qm  # noqa: E402

OPEN = lambda h: False
SHUT = lambda h: True

def _stub_record(record):
    _qm._QUEUE_CACHE["stub"] = record
    import time as _t
    _qm._QUEUE_CACHE_AT["stub"] = _t.time()

WEEKLY_WITH_ACTION = {"settings": {"operational_hours": {
    "type": "weekly",
    "closed_hour_action": {"enabled": True, "type": "VOICEMAIL", "value": "1000"}}}}

def _shut_with_answer():
    _stub_record(WEEKLY_WITH_ACTION)
    assert queue_closed_route("stub", SHUT) == ("VOICEMAIL", "1000")
check("a queue shut with an answer of its own sends the caller there", _shut_with_answer)

def _open_changes_nothing():
    _stub_record(WEEKLY_WITH_ACTION)
    assert queue_closed_route("stub", OPEN) == ("", "")
check("CONTROL an open queue is left completely alone", _open_changes_nothing)

def _shut_without_answer():
    _stub_record({"settings": {"operational_hours": {"type": "weekly",
                  "closed_hour_action": {"enabled": False, "type": "VOICEMAIL", "value": "1000"}}}})
    assert queue_closed_route("stub", SHUT) == ("", "")
check("a shut queue with the action switched OFF keeps ringing, not silence", _shut_without_answer)

def _24h_untouched():
    # Every queue on the platform today is 24 hours - this must be a no-op for them
    _stub_record({"settings": {"operational_hours": {"type": "24_hours",
                  "closed_hour_action": {"enabled": False, "type": "HANGUP", "value": "HANGUP"}}}})
    assert queue_closed_route("stub", SHUT) == ("", "")
    assert queue_closed_route("stub", OPEN) == ("", "")
check("CONTROL every queue as configured today is unaffected either way", _24h_untouched)

def _no_hours():
    _stub_record({"settings": {}})
    assert queue_closed_route("stub", SHUT) == ("", "")
    assert queue_hours({}) == {}
check("a queue keeping no hours of its own is left alone", _no_hours)

def _clock_failure_is_open():
    def boom(h): raise RuntimeError("no timezone")
    _stub_record(WEEKLY_WITH_ACTION)
    assert queue_closed_route("stub", boom) == ("", "")
check("CONTROL if the clock cannot be judged the queue counts as open", _clock_failure_is_open)

print("\n  %d checks passed in total" % passed)

# --- ring tone and the repeating message ------------------------------------
from queue_media import (  # noqa: E402
    REPEAT_INTERVAL_MAX, REPEAT_INTERVAL_MIN, REPEAT_INTERVAL_VARIABLE, queue_repeat_interval,
)

def _ring_tone_now_mapped():
    q = {"settings": {"media": {"ring_tone": {"enabled": True, "value": "tone.wav"}}}}
    acts = media_actions(q, COMPANY, ok_fetch)
    assert any(a["data"].startswith("cc_ring_tone=") for a in acts), acts
check("the ring tone now has a variable of its own, not the waiting message", _ring_tone_now_mapped)

def _repeat_mapped():
    q = {"settings": {"media": {"delay": {"enabled": True, "value": "still-waiting.mp3", "interval_seconds": 45}}}}
    acts = media_actions(q, COMPANY, ok_fetch)
    assert any(a["data"].startswith("cc_repeat_media=") for a in acts), acts
    assert queue_repeat_interval(q) == 45
check("the repeating message and its interval are both read", _repeat_mapped)

def _interval_off_when_message_off():
    q = {"settings": {"media": {"delay": {"enabled": False, "value": "x.mp3", "interval_seconds": 45}}}}
    assert queue_repeat_interval(q) == 0
    q2 = {"settings": {"media": {"delay": {"enabled": True, "value": "", "interval_seconds": 45}}}}
    assert queue_repeat_interval(q2) == 0
check("CONTROL an interval with no recording is not a setting, so it is 0", _interval_off_when_message_off)

def _interval_bounds():
    mk = lambda n: {"settings": {"media": {"delay": {"enabled": True, "value": "x.mp3", "interval_seconds": n}}}}
    assert queue_repeat_interval(mk(3)) == REPEAT_INTERVAL_MIN      # badgering -> raised to the floor
    assert queue_repeat_interval(mk(99999)) == REPEAT_INTERVAL_MAX
    assert queue_repeat_interval(mk("30")) == 30
check("an interval that would badger the caller is raised to the floor", _interval_bounds)

def _interval_only_with_audio():
    # audio that cannot be fetched must not leave an interval behind
    q = {"settings": {"media": {"delay": {"enabled": True, "value": "x.mp3", "interval_seconds": 45}}}}
    acts = media_actions(q, COMPANY, no_fetch)
    assert acts == []
check("CONTROL no recording fetched means no interval either", _interval_only_with_audio)

print("\n  %d checks passed in total" % passed)
