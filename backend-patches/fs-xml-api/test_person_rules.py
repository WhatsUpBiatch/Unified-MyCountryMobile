"""What a person's own call rules do to a direct call, proved without a
database, a clock, object storage or a phone.

`build_inbound_dialplan` is driven with a fake DID row pointing at one
extension, and the XML it hands the switch is what is asserted on - the
bridge, its call_timeout, what follows the bridge, the voicemail script and
the playback before it. The clock is taken out of the picture the way
test_line_hours.py does it: `business_hours_state` is replaced by a stand-in
that reads the answer off a `_state` key in whichever hours block it is
handed. Object storage is a stand-in too: `fetch_greeting` is replaced by a
function that returns a path, None, or raises, as each case needs.

Half of these cases check that nothing moved: a person with no rules, with
garbage rules, or whose row could not be read must ring exactly as today -
and the suite must FAIL on the unpatched file (the control).

Usage: python3 test_person_rules.py <path to patched dialplan_service.py>
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
EXT = "1001"
OTHER = "2002"
FILE = "3f2a9c1e-aaaa-bbbb-cccc-000000000001.mp3"
FETCHED = "/etc/freeswitch/sounds/mcm/greetings/co-1/" + FILE

PROVIDER = {"uuid": "prov-1", "name": "carrier", "host_ip_outbound": "10.0.0.9",
            "add_prefix": "", "remove_prefix": ""}

OPEN, CLOSED, UNKNOWN = dps.OPERATIONAL_HOURS_OPEN, dps.OPERATIONAL_HOURS_CLOSED, dps.OPERATIONAL_HOURS_UNKNOWN


def fake_business_hours_state(operational_hours, now_utc=None):
    """The stand-in clock: the block says what it is. No `_state` is what a
    block with no hours answers for real - unknown."""
    hours = dps._as_object(operational_hours)
    return hours.get("_state", UNKNOWN) if isinstance(hours, dict) else UNKNOWN


class FakeCursor:
    """Just enough of a pymysql DictCursor to answer every query the inbound
    path makes, so the REAL query path is exercised.

    `sections`  company_settings rows, section -> value
    `users`     (company_uuid, extension) -> row {settings, call_forwarding,
                greetings}; a str value is a JSON column as pymysql hands it
                back, a dict is already parsed; a key not present is no row
    `user_boom` an exception to raise on the users query instead
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
        elif "FROM users" in sql:
            c.counts["users"] += 1
            c.user_queries.append((sql, params))
            if c.user_boom is not None:
                raise c.user_boom
            self._row = c.users.get(tuple(params))
        elif "FROM did_numbers" in sql or "SELECT licenses FROM companies" in sql:
            # One number before the licence rule, one licence after: two
            # channels either way, so the expected limit line does not move.
            c.counts["did_numbers"] += 1
            self._row = {"n": 1, "licenses": 1}
        elif "FROM providers" in sql:
            self._row = dict(PROVIDER)
        else:
            raise AssertionError("unexpected query: %s" % sql)

    def fetchone(self):
        return self._row


class FakeConnection:
    def __init__(self, sections=None, users=None, user_boom=None):
        self.sections = sections or {}
        self.users = users or {}
        self.user_boom = user_boom
        self.counts = {"company_settings": 0, "user_template": 0, "users": 0, "did_numbers": 0}
        self.user_queries = []

    def cursor(self):
        return FakeCursor(self)


LOGS = []


def capture_log(level, msg, **kwargs):
    LOGS.append(dict(kwargs, level=level, msg=msg))


FETCHES = []


def fetch_ok(company_uuid, file_name, log=None):
    FETCHES.append((company_uuid, file_name))
    return "/etc/freeswitch/sounds/mcm/greetings/%s/%s" % (company_uuid, file_name)


def fetch_none(company_uuid, file_name, log=None):
    FETCHES.append((company_uuid, file_name))
    return None


def fetch_boom(company_uuid, file_name, log=None):
    FETCHES.append((company_uuid, file_name))
    raise RuntimeError("bucket unreachable")


def use(person=None, company_seconds=None, company=OPEN, user_boom=None, fetch=fetch_ok, ext=EXT):
    """A fresh fake database holding one person (`person` = their row, or
    None for no row), every cache emptied, the clock and object storage
    replaced and the log captured."""
    sections = {"operational_hours": {"_state": company}}
    if company_seconds is not None:
        sections["company_ring_time"] = {"seconds": company_seconds}
    users = {(COMPANY, ext): person} if person is not None else {}
    conn = FakeConnection(sections=sections, users=users, user_boom=user_boom)
    dps.get_db = lambda: conn
    dps.business_hours_state = fake_business_hours_state
    dps.log = capture_log
    dps.fetch_greeting = fetch
    dps._cached_provider = None
    dps._provider_cache_time = 0
    # Queue lookups live in MongoDB and are not what is under test here.
    dps.queue_closed_route = lambda *a, **k: ("", "")
    dps.queue_audio_actions = lambda *a, **k: ([], [])
    for cache in (dps._hours_cache, dps._hours_cache_time, dps._ivr_hours_cache, dps._ivr_hours_cache_time,
                  dps._ring_cache, dps._ring_cache_time, dps._recording_cache, dps._recording_cache_time,
                  getattr(dps, "_licence_count_cache", getattr(dps, "_number_count_cache", {})), getattr(dps, "_licence_count_cache_time", getattr(dps, "_number_count_cache_time", {})), dps._company_settings_missing,
                  dps._person_cache, dps._person_cache_time):
        cache.clear()
    del LOGS[:]
    del FETCHES[:]
    return conn


def action(kind="VOICEMAIL", value=EXT, enabled=True, personal=False, **extra):
    block = {"type": kind, "value": value, "enabled": enabled, "personal": personal,
             "type_label": kind.title(), "value_label": "Target %s" % value, "name": "Target %s" % value}
    block.update(extra)
    return block


def device(timeout="30", status=True, value=EXT, kind="web"):
    return {"type": kind, "status": status, "label": "%s secs" % timeout, "value": value,
            "name": "Person", "timeout": timeout, "isDefault": False}


def hours(state, closed_action=None):
    """`settings.operational_hours` as Preferences saves it."""
    block = {
        "type": "weekly",
        "value": {"monday": {"open": True, "start": "09:00", "end": "17:00"}},
        "holidays": [],
        "regional": {"timezone": {"label": "Sydney", "value": "Australia/Sydney"}},
        "_state": state,
    }
    if closed_action is not None:
        block["closed_hour_action"] = closed_action
    return block


def person(forward=None, dnd=None, devices=None, failure=None, closed=None, settings=None,
           greetings=None, as_json=False, ring_type="sequential"):
    """A users row. Each part is stored exactly as the screens write it."""
    forwarding = {"status": "online", "outgoing_calls": {"enabled": False}}
    if forward is not None:
        forwarding["forward_calls"] = forward
    if dnd is not None:
        forwarding["dnd"] = dnd
    incoming = {"enabled": True, "type": ring_type}
    if devices is not None:
        incoming["device_options"] = devices
    if failure is not None:
        incoming["failure_action"] = failure
    if closed is not None:
        incoming["closed_hour_action"] = closed
    forwarding["incoming_calls"] = incoming
    row = {"settings": settings if settings is not None else {},
           "call_forwarding": forwarding,
           "greetings": greetings if greetings is not None else {}}
    if as_json:
        row = {k: json.dumps(v) for k, v in row.items()}
    return row


def did_row(route=("EXTENSION", EXT), closed_hours=None):
    forward = {
        "call_handling": {
            "business_hours": {"type": route[0], "value": route[1], "label": "Day", "name": "Day"},
        },
        "condition": {},
    }
    if closed_hours is not None:
        forward["call_handling"]["closed_hours"] = closed_hours
    return {"forward_call_actions": json.dumps(forward), "company_uuid": COMPANY, "db_name": DB}


def build(row=None):
    return dps.build_inbound_dialplan({"Caller-Destination-Number": DID}, row or did_row(), DOMAIN)


def logged(msg_part, **match):
    out = []
    for entry in LOGS:
        if msg_part in entry["msg"] and all(entry.get(k) == v for k, v in match.items()):
            out.append(entry)
    return out


def rules_applied():
    return [e["rule"] for e in logged("person rule applied")]


def actions_of(xml):
    """The (application, data) pairs the switch would run, in order."""
    out = []
    for line in xml.splitlines():
        line = line.strip()
        if line.startswith('<action application="'):
            app = line.split('application="', 1)[1].split('"', 1)[0]
            data = line.split('data="', 1)[1].rsplit('"', 1)[0]
            out.append((app, data))
    return out


# What the switch ran for a direct call to EXT before this patch, with the
# company ring time at its default: the control every "nothing moved" case
# is measured against.
def plain_extension_actions(seconds=dps.RING_SECONDS_DEFAULT, ext=EXT):
    return [
        ("limit", "hash company_channels co-1 2 !USER_BUSY"),
        ("set", "sip_h_X-Domain=%s" % DOMAIN),
        ("set", "company_uuid=%s" % COMPANY),
        ("set", "sip_h_X-Billing-Owner-UUID=%s" % COMPANY),
        ("set", "call_timeout=%d" % seconds),
        ("set", "continue_on_fail=true"),
        ("set", "hangup_after_bridge=true"),
        ("bridge", "user/%s_web@%s,user/%s@%s" % (ext, DOMAIN, ext, DOMAIN)),
    ]


def plain_voicemail_actions(ext=EXT):
    return [
        ("limit", "hash company_channels co-1 2 !USER_BUSY"),
        ("set", "sip_h_X-Domain=%s" % DOMAIN),
        ("set", "company_uuid=%s" % COMPANY),
        ("set", "accountcode=%s" % COMPANY),
        ("set", "vm_target_extension=%s" % ext),
        ("answer", ""),
        ("lua", dps.FS_SCRIPTS + "save-voicemail.lua"),
    ]


RINGS = 'data="user/%s_web@%s,user/%s@%s"'
VOICEMAIL_FOR = 'data="vm_target_extension=%s"'
RUNS_QUEUE = 'data="sip_h_X-Queue=%s"'
RUNS_MENU = 'application="ivr" data="%s"'


class A_NoRules(unittest.TestCase):
    """The XML is byte-for-byte what it was before the patch."""

    def test_a_person_with_an_empty_record(self):
        use(person=person())
        self.assertEqual(actions_of(build()), plain_extension_actions())
        self.assertEqual(rules_applied(), [])

    def test_a_person_with_null_columns(self):
        use(person={"settings": None, "call_forwarding": None, "greetings": None})
        self.assertEqual(actions_of(build()), plain_extension_actions())

    def test_no_such_person(self):
        use(person=None)
        self.assertEqual(actions_of(build()), plain_extension_actions())
        self.assertEqual(rules_applied(), [])

    def test_every_rule_present_but_switched_off(self):
        use(person=person(forward=action("PHONE", "14155550100", enabled=False), dnd=False,
                          failure=action("VOICEMAIL", EXT, enabled=False),
                          settings={"operational_hours": hours(CLOSED, action("VOICEMAIL", EXT, enabled=False))},
                          greetings={"voicemail": {"enabled": False, "value": FILE}}))
        # Closed personal hours with no enabled action is still a rule: own
        # voicemail. Everything else off must leave the ring alone, so test
        # the closed case separately and here keep the hours open.
        use(person=person(forward=action("PHONE", "14155550100", enabled=False), dnd=False,
                          failure=action("VOICEMAIL", EXT, enabled=False),
                          settings={"operational_hours": hours(OPEN)},
                          greetings={"voicemail": {"enabled": False, "value": FILE}}))
        self.assertEqual(actions_of(build()), plain_extension_actions())
        self.assertEqual(rules_applied(), [])

    def test_the_company_ring_time_still_applies(self):
        use(person=person(), company_seconds=45)
        self.assertEqual(actions_of(build()), plain_extension_actions(45))


class B_DoNotDisturb(unittest.TestCase):
    def test_dnd_goes_straight_to_own_voicemail(self):
        use(person=person(dnd=True))
        xml = build()
        self.assertIn(VOICEMAIL_FOR % EXT, xml)
        self.assertNotIn(RINGS % (EXT, DOMAIN, EXT, DOMAIN), xml)
        self.assertEqual(actions_of(xml), plain_voicemail_actions())
        self.assertEqual(rules_applied(), ["do not disturb"])
        self.assertEqual(logged("person rule applied")[0]["to_type"], "VOICEMAIL")

    def test_dnd_with_a_stored_destination(self):
        use(person=person(dnd=action("EXTENSION", OTHER)))
        xml = build()
        self.assertIn(RINGS % (OTHER, DOMAIN, OTHER, DOMAIN), xml)
        self.assertNotIn(VOICEMAIL_FOR % EXT, xml)
        self.assertEqual(rules_applied(), ["do not disturb"])

    def test_dnd_with_a_destination_to_a_number(self):
        use(person=person(dnd=action("PHONE", "14155550100")))
        xml = build()
        self.assertIn("sofia/internal/14155550100@10.0.0.9", xml)
        self.assertEqual(rules_applied(), ["do not disturb"])

    def test_dnd_block_pointing_at_own_extension_is_voicemail(self):
        use(person=person(dnd=action("EXTENSION", EXT)))
        self.assertEqual(actions_of(build()), plain_voicemail_actions())

    def test_dnd_block_switched_off_rings(self):
        use(person=person(dnd=action("EXTENSION", OTHER, enabled=False)))
        self.assertEqual(actions_of(build()), plain_extension_actions())

    def test_dnd_false_or_rubbish_rings(self):
        for dnd in (False, None, "yes", "true", 1, [], [True], "dnd"):
            use(person=person(dnd=dnd))
            self.assertEqual(actions_of(build()), plain_extension_actions(), dnd)
            self.assertEqual(rules_applied(), [], dnd)

    def test_dnd_beats_the_no_answer_rule(self):
        use(person=person(dnd=True, failure=action("EXTENSION", OTHER)))
        self.assertEqual(actions_of(build()), plain_voicemail_actions())


class C_PersonalHours(unittest.TestCase):
    def test_closed_uses_the_preferences_closed_action(self):
        use(person=person(settings={"operational_hours": hours(CLOSED, action("EXTENSION", OTHER))}))
        xml = build()
        self.assertIn(RINGS % (OTHER, DOMAIN, OTHER, DOMAIN), xml)
        self.assertEqual(rules_applied(), ["personal hours closed"])

    def test_closed_falls_to_the_my_phone_closed_action(self):
        use(person=person(settings={"operational_hours": hours(CLOSED)},
                          closed=action("PHONE", "14155550100")))
        xml = build()
        self.assertIn("sofia/internal/14155550100@10.0.0.9", xml)
        self.assertEqual(rules_applied(), ["personal hours closed"])

    def test_preferences_action_beats_my_phone_action(self):
        use(person=person(settings={"operational_hours": hours(CLOSED, action("EXTENSION", OTHER))},
                          closed=action("PHONE", "14155550100")))
        self.assertIn(RINGS % (OTHER, DOMAIN, OTHER, DOMAIN), build())

    def test_closed_with_no_action_is_own_voicemail(self):
        use(person=person(settings={"operational_hours": hours(CLOSED)}))
        self.assertEqual(actions_of(build()), plain_voicemail_actions())
        self.assertEqual(rules_applied(), ["personal hours closed"])

    def test_closed_with_a_disabled_or_empty_action_is_own_voicemail(self):
        for bad in (action("EXTENSION", OTHER, enabled=False), action("", OTHER), action("EXTENSION", ""),
                    action("DEPARTMENT", "dep-1"), "junk", [], {"enabled": True}):
            use(person=person(settings={"operational_hours": hours(CLOSED, bad)}))
            self.assertEqual(actions_of(build()), plain_voicemail_actions(), bad)

    def test_closed_to_a_queue(self):
        use(person=person(settings={"operational_hours": hours(CLOSED, action("QUEUE", "5f0000000000000000000001"))}))
        xml = build()
        self.assertIn(RUNS_QUEUE % "5f0000000000000000000001", xml)
        self.assertIn("cc_queue_name=Target 5f0000000000000000000001", xml)

    def test_closed_to_a_menu(self):
        use(person=person(settings={"operational_hours": hours(CLOSED, action("IVR", "ivr-1"))}))
        self.assertIn(RUNS_MENU % "ivr-1", build())

    def test_closed_to_hang_up(self):
        use(person=person(settings={"operational_hours": hours(CLOSED, action("HANGUP", ""))}))
        self.assertIn('application="hangup" data="NORMAL_CLEARING"', build())

    def test_personal_voicemail_with_an_empty_value(self):
        # The screens write value '' for "my own voicemail" when `personal`.
        use(person=person(settings={"operational_hours": hours(CLOSED, action("VOICEMAIL", "", personal=True))}))
        self.assertEqual(actions_of(build()), plain_voicemail_actions())

    def test_open_is_unchanged(self):
        use(person=person(settings={"operational_hours": hours(OPEN, action("EXTENSION", OTHER))}))
        self.assertEqual(actions_of(build()), plain_extension_actions())
        self.assertEqual(rules_applied(), [])

    def test_unknown_is_open(self):
        for block in (hours(UNKNOWN, action("EXTENSION", OTHER)), {"type": "weekly"}, {}, None, "junk", [], 7):
            use(person=person(settings={"operational_hours": block}))
            self.assertEqual(actions_of(build()), plain_extension_actions(), block)

    def test_the_real_clock_reads_the_persons_block(self):
        # The stand-in is for routing; the block Preferences saves must also
        # satisfy the real judge: 24 hours is open, a timetable with no
        # timezone is unknown, and a person on holiday today is closed.
        use(person=person())
        spec.loader.exec_module(dps)
        try:
            self.assertEqual(dps.business_hours_state({"type": "24_hours"}), OPEN)
            self.assertEqual(dps.business_hours_state({"type": "weekly", "value": {}, "regional": {}}), UNKNOWN)
            import datetime
            today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
            self.assertEqual(dps.business_hours_state({"type": "24_hours", "holidays": [{"date": today}]}), CLOSED)
        finally:
            dps.business_hours_state = fake_business_hours_state

    def test_a_clock_that_throws_rings_as_today(self):
        use(person=person(settings={"operational_hours": hours(CLOSED)}))

        def clock(hours_block, now_utc=None):
            if dps._as_object(hours_block).get("_state") is not None and "regional" in dps._as_object(hours_block):
                raise RuntimeError("no tz database")
            return fake_business_hours_state(hours_block, now_utc)
        dps.business_hours_state = clock
        self.assertEqual(actions_of(build()), plain_extension_actions())
        self.assertEqual(logged("person rules could not be judged")[0]["level"], "error")

    def test_company_closed_still_wins_before_the_person_is_asked(self):
        # Today's behaviour: the company is shut, an EXTENSION number goes to
        # voicemail. The person's forward-all is not consulted.
        conn = use(person=person(forward=action("PHONE", "14155550100")), company=CLOSED)
        self.assertEqual(actions_of(build()), plain_voicemail_actions())
        self.assertEqual(rules_applied(), [])

    def test_a_number_closed_to_a_person_reaches_that_persons_rules(self):
        # The company's closed-hours block points at EXT; EXT is on DND.
        use(person=person(dnd=True), company=CLOSED)
        xml = build(did_row(route=("IVR", "ivr-9"), closed_hours={"type": "EXTENSION", "value": EXT}))
        self.assertEqual(actions_of(xml), plain_voicemail_actions())
        self.assertEqual(rules_applied(), ["do not disturb"])


class D_ForwardAll(unittest.TestCase):
    def test_forward_to_a_number(self):
        use(person=person(forward=action("PHONE", "14155550100")))
        xml = build()
        self.assertIn("sofia/internal/14155550100@10.0.0.9", xml)
        self.assertIn('effective_caller_id_number=%s' % DID, xml)
        self.assertNotIn(RINGS % (EXT, DOMAIN, EXT, DOMAIN), xml)
        self.assertEqual(rules_applied(), ["forward all calls"])
        self.assertEqual(logged("person rule applied")[0]["to_value"], "14155550100")

    def test_forward_to_a_colleague(self):
        use(person=person(forward=action("EXTENSION", OTHER)))
        xml = build()
        self.assertIn(RINGS % (OTHER, DOMAIN, OTHER, DOMAIN), xml)
        self.assertNotIn(RINGS % (EXT, DOMAIN, EXT, DOMAIN), xml)

    def test_forward_to_a_colleague_does_not_read_the_colleagues_rules(self):
        conn = use(person=person(forward=action("EXTENSION", OTHER)))
        conn.users[(COMPANY, OTHER)] = person(forward=action("EXTENSION", EXT))  # loops back
        xml = build()
        self.assertIn(RINGS % (OTHER, DOMAIN, OTHER, DOMAIN), xml)
        self.assertEqual(conn.counts["users"], 1)
        self.assertEqual(rules_applied(), ["forward all calls"])

    def test_forward_to_voicemail_queue_menu(self):
        use(person=person(forward=action("VOICEMAIL", OTHER)))
        self.assertIn(VOICEMAIL_FOR % OTHER, build())
        use(person=person(forward=action("QUEUE", "5f0000000000000000000001")))
        self.assertIn(RUNS_QUEUE % "5f0000000000000000000001", build())
        use(person=person(forward=action("IVR", "ivr-1")))
        self.assertIn(RUNS_MENU % "ivr-1", build())

    def test_forward_to_own_extension_is_ignored(self):
        use(person=person(forward=action("EXTENSION", EXT)))
        self.assertEqual(actions_of(build()), plain_extension_actions())
        self.assertEqual(rules_applied(), [])

    def test_forward_switched_off_rings(self):
        use(person=person(forward=action("PHONE", "14155550100", enabled=False)))
        self.assertEqual(actions_of(build()), plain_extension_actions())

    def test_forward_beats_dnd_and_hours(self):
        use(person=person(forward=action("PHONE", "14155550100"), dnd=True,
                          settings={"operational_hours": hours(CLOSED)}))
        self.assertIn("sofia/internal/14155550100@10.0.0.9", build())
        self.assertEqual(rules_applied(), ["forward all calls"])

    def test_a_value_that_would_break_the_xml_is_refused(self):
        for bad in ('1415"5550100', "<script>", "a b", "x&y", "1" * 65):
            use(person=person(forward=action("PHONE", bad)))
            self.assertEqual(actions_of(build()), plain_extension_actions(), bad)


class E_AfterTheRing(unittest.TestCase):
    """Busy, unanswered and unreachable share one stored key,
    `incoming_calls.failure_action`; the screen's Busy switch is commented
    out. With continue_on_fail=true the actions after the bridge run for all
    three causes."""

    def test_no_answer_to_own_voicemail(self):
        use(person=person(failure=action("VOICEMAIL", EXT)))
        acts = actions_of(build())
        self.assertEqual(acts[:8], plain_extension_actions())
        self.assertEqual(acts[8:], [
            ("set", "accountcode=%s" % COMPANY),
            ("set", "vm_target_extension=%s" % EXT),
            ("answer", ""),
            ("lua", dps.FS_SCRIPTS + "save-voicemail.lua"),
        ])
        self.assertEqual(rules_applied(), ["busy or no answer"])

    def test_no_answer_personal_voicemail_with_empty_value(self):
        use(person=person(failure=action("VOICEMAIL", "", personal=True)))
        acts = actions_of(build())
        self.assertIn(("set", "vm_target_extension=%s" % EXT), acts[8:])

    def test_busy_to_a_colleague(self):
        use(person=person(failure=action("EXTENSION", OTHER)))
        acts = actions_of(build())
        self.assertEqual(acts[:8], plain_extension_actions())
        self.assertEqual(acts[8:], [("bridge", "user/%s_web@%s,user/%s@%s" % (OTHER, DOMAIN, OTHER, DOMAIN))])

    def test_busy_to_hang_up(self):
        use(person=person(failure=action("HANGUP", "")))
        acts = actions_of(build())
        self.assertEqual(acts[8:], [("hangup", "NORMAL_CLEARING")])

    def test_no_answer_to_a_colleagues_voicemail_plays_their_greeting(self):
        conn = use(person=person(failure=action("VOICEMAIL", OTHER)))
        conn.users[(COMPANY, OTHER)] = person(greetings={"voicemail": {"enabled": True, "value": FILE}})
        acts = actions_of(build())
        self.assertIn(("playback", FETCHED), acts)
        self.assertEqual(acts.index(("playback", FETCHED)) + 1, acts.index(("lua", dps.FS_SCRIPTS + "save-voicemail.lua")))

    def test_a_destination_that_cannot_run_after_the_ring_is_logged_not_applied(self):
        for kind in ("PHONE", "QUEUE", "IVR"):
            use(person=person(failure=action(kind, "14155550100")))
            self.assertEqual(actions_of(build()), plain_extension_actions(), kind)
            self.assertEqual(logged("cannot run after the ring")[0]["to_type"], kind)
            self.assertEqual(rules_applied(), [], kind)

    def test_failure_to_own_extension_is_ignored(self):
        use(person=person(failure=action("EXTENSION", EXT)))
        self.assertEqual(actions_of(build()), plain_extension_actions())

    def test_failure_switched_off_or_rubbish(self):
        for bad in (action("VOICEMAIL", EXT, enabled=False), action("", EXT), "junk", [], 5, {"enabled": True}):
            use(person=person(failure=bad))
            self.assertEqual(actions_of(build()), plain_extension_actions(), bad)

    def test_the_bridge_still_continues_on_fail(self):
        use(person=person(failure=action("VOICEMAIL", EXT)))
        acts = actions_of(build())
        self.assertIn(("set", "continue_on_fail=true"), acts)
        self.assertLess(acts.index(("set", "continue_on_fail=true")), acts.index(("bridge", acts[7][1])))


class F_RingTime(unittest.TestCase):
    def test_the_persons_shorter_time_wins(self):
        use(person=person(devices=[device("15")]), company_seconds=40)
        self.assertEqual(actions_of(build()), plain_extension_actions(15))
        self.assertEqual(rules_applied(), ["ring time"])
        self.assertEqual(logged("person rule applied")[0]["seconds"], 15)

    def test_the_companys_shorter_time_wins(self):
        use(person=person(devices=[device("30")]), company_seconds=20)
        self.assertEqual(actions_of(build()), plain_extension_actions(20))
        self.assertEqual(rules_applied(), [])

    def test_equal_is_the_company_time_and_no_rule_logged(self):
        use(person=person(devices=[device("30")]), company_seconds=30)
        self.assertEqual(actions_of(build()), plain_extension_actions(30))
        self.assertEqual(rules_applied(), [])

    def test_no_company_setting_means_the_default_against_the_person(self):
        use(person=person(devices=[device("15")]))
        self.assertEqual(actions_of(build()), plain_extension_actions(15))

    def test_the_longest_active_own_device_is_the_persons_time(self):
        use(person=person(devices=[device("15", kind="web"), device("30", kind="mobile"),
                                   device("60", status=False, kind="pstn"),
                                   device("60", value=OTHER, kind="web")]), company_seconds=45)
        self.assertEqual(actions_of(build()), plain_extension_actions(30))

    def test_bounds(self):
        for bad in ("4", "121", "0", "-5", "", "abc", None, 30.5):
            use(person=person(devices=[device(bad)]), company_seconds=40)
            self.assertEqual(actions_of(build()), plain_extension_actions(40), bad)
        use(person=person(devices=[device("5")]), company_seconds=40)
        self.assertEqual(actions_of(build()), plain_extension_actions(5))
        use(person=person(devices=[device("120")]), company_seconds=120)
        self.assertEqual(actions_of(build()), plain_extension_actions(120))

    def test_rubbish_device_lists(self):
        for bad in ("junk", {}, [1, 2], [{"status": True}], [{"status": True, "value": EXT}], None):
            use(person=person(devices=bad), company_seconds=40)
            self.assertEqual(actions_of(build()), plain_extension_actions(40), bad)

    def test_the_persons_time_carries_into_the_after_ring_rule(self):
        use(person=person(devices=[device("15")], failure=action("VOICEMAIL", EXT)), company_seconds=40)
        acts = actions_of(build())
        self.assertEqual(acts[:8], plain_extension_actions(15))
        self.assertEqual(acts[8][1], "accountcode=%s" % COMPANY)
        self.assertEqual(sorted(rules_applied()), ["busy or no answer", "ring time"])


class G_VoicemailGreeting(unittest.TestCase):
    def test_present_and_fetched(self):
        use(person=person(greetings={"voicemail": {"enabled": True, "label": "My greeting", "value": FILE}}))
        acts = actions_of(build(did_row(route=("VOICEMAIL", EXT))))
        self.assertEqual(acts, plain_voicemail_actions()[:6] + [("playback", FETCHED)] + plain_voicemail_actions()[6:])
        self.assertEqual(FETCHES, [(COMPANY, FILE)])
        self.assertEqual(rules_applied(), ["voicemail greeting"])

    def test_absent(self):
        for greetings in ({}, None, {"welcome": {"enabled": True, "value": FILE}}, "junk", [],
                          {"voicemail": {"enabled": False, "value": FILE}},
                          {"voicemail": {"enabled": True, "value": ""}},
                          {"voicemail": {"enabled": True}}, {"voicemail": "x"}):
            use(person=person(greetings=greetings))
            self.assertEqual(actions_of(build(did_row(route=("VOICEMAIL", EXT)))), plain_voicemail_actions(), greetings)
            self.assertEqual(FETCHES, [], greetings)

    def test_the_other_spellings(self):
        for key in ("voicemail_greeting", "vm"):
            use(person=person(greetings={key: {"enabled": True, "value": FILE}}))
            self.assertIn(("playback", FETCHED), actions_of(build(did_row(route=("VOICEMAIL", EXT)))), key)

    def test_fetch_fails(self):
        use(person=person(greetings={"voicemail": {"enabled": True, "value": FILE}}), fetch=fetch_none)
        self.assertEqual(actions_of(build(did_row(route=("VOICEMAIL", EXT)))), plain_voicemail_actions())
        self.assertEqual(logged("could not be fetched")[0]["level"], "warn")
        self.assertEqual(rules_applied(), [])

    def test_fetch_raises(self):
        use(person=person(greetings={"voicemail": {"enabled": True, "value": FILE}}), fetch=fetch_boom)
        self.assertEqual(actions_of(build(did_row(route=("VOICEMAIL", EXT)))), plain_voicemail_actions())
        self.assertEqual(logged("greeting failed")[0]["level"], "error")

    def test_an_unsafe_file_name_is_never_fetched(self):
        for bad in ("../../etc/passwd", "a b.mp3", "noext", "x/y.mp3", ".hidden.mp3", 'q".mp3'):
            use(person=person(greetings={"voicemail": {"enabled": True, "value": bad}}))
            self.assertEqual(actions_of(build(did_row(route=("VOICEMAIL", EXT)))), plain_voicemail_actions(), bad)
            self.assertEqual(FETCHES, [], bad)

    def test_the_greeting_plays_when_dnd_sends_the_call_to_voicemail(self):
        use(person=person(dnd=True, greetings={"voicemail": {"enabled": True, "value": FILE}}))
        acts = actions_of(build())
        self.assertIn(("playback", FETCHED), acts)
        self.assertEqual(sorted(rules_applied()), ["do not disturb", "voicemail greeting"])

    def test_the_greeting_plays_after_an_unanswered_ring(self):
        use(person=person(failure=action("VOICEMAIL", EXT), greetings={"voicemail": {"enabled": True, "value": FILE}}))
        acts = actions_of(build())
        self.assertEqual(acts[8:], [
            ("set", "accountcode=%s" % COMPANY),
            ("set", "vm_target_extension=%s" % EXT),
            ("answer", ""),
            ("playback", FETCHED),
            ("lua", dps.FS_SCRIPTS + "save-voicemail.lua"),
        ])

    def test_no_such_person_is_the_plain_beep(self):
        use(person=None)
        self.assertEqual(actions_of(build(did_row(route=("VOICEMAIL", EXT)))), plain_voicemail_actions())


class H_GarbageAndFailure(unittest.TestCase):
    def test_garbage_columns_ring_as_today(self):
        for junk in ("garbage", "{not json", 42, [], [1], {"forward_calls": "x"}, {"incoming_calls": []},
                     {"incoming_calls": {"failure_action": [1]}}, {"dnd": {"type": "EXTENSION", "value": OTHER}},
                     {"dnd": "true"}, {"forward_calls": {"enabled": True}}):
            use(person={"settings": junk, "call_forwarding": junk, "greetings": junk})
            self.assertEqual(actions_of(build()), plain_extension_actions(), junk)
            self.assertEqual(rules_applied(), [], junk)
            self.assertFalse([e for e in LOGS if e["level"] == "error"], junk)

    def test_columns_stored_as_json_text(self):
        use(person=person(dnd=True, as_json=True))
        self.assertEqual(actions_of(build()), plain_voicemail_actions())

    def test_the_users_read_raises(self):
        conn = use(person=person(dnd=True), user_boom=Exception(2013, "Lost connection"))
        self.assertEqual(actions_of(build()), plain_extension_actions())
        self.assertEqual(logged("person rules lookup failed")[0]["level"], "error")
        self.assertEqual(rules_applied(), [])
        # Not cached: the next call tries again.
        build()
        self.assertEqual(conn.counts["users"], 2)

    def test_the_plan_itself_raises(self):
        use(person=person(dnd=True))
        real = dps.person_call_plan
        dps.person_call_plan = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
        try:
            self.assertEqual(actions_of(build()), plain_extension_actions())
            self.assertEqual(logged("person rules could not be judged")[0]["level"], "error")
        finally:
            dps.person_call_plan = real

    def test_the_query_is_scoped_to_the_company(self):
        conn = use(person=person())
        build()
        sql, params = conn.user_queries[0]
        self.assertIn("company_uuid = %s AND extension = %s", sql)
        self.assertIn("status = 'ACTIVE'", sql)
        self.assertEqual(params, (COMPANY, EXT))


class I_TheReadIsCached(unittest.TestCase):
    def test_one_query_per_person_per_interval(self):
        conn = use(person=person(dnd=True))
        for _ in range(5):
            build()
        self.assertEqual(conn.counts["users"], 1)

    def test_no_such_person_is_cached_too(self):
        conn = use(person=None)
        for _ in range(3):
            build()
        self.assertEqual(conn.counts["users"], 1)

    def test_the_greeting_shares_the_cache(self):
        conn = use(person=person(failure=action("VOICEMAIL", EXT), greetings={"voicemail": {"enabled": True, "value": FILE}}))
        build()
        build(did_row(route=("VOICEMAIL", EXT)))
        self.assertEqual(conn.counts["users"], 1)

    def test_read_again_after_the_interval(self):
        conn = use(person=person())
        build()
        dps._person_cache_time[(COMPANY, EXT)] -= dps.CALLING_RULES_CACHE_SECONDS + 1
        build()
        self.assertEqual(conn.counts["users"], 2)

    def test_cached_per_person_and_per_company(self):
        conn = use(person=person())
        conn.users[(COMPANY, OTHER)] = person()
        build()
        build(did_row(route=("EXTENSION", OTHER)))
        build()
        other = dict(did_row(), company_uuid="co-2")
        build(other)
        # Three person-rule reads plus one identity read added by the
        # person-state patch (deleted_at IS NULL on the registered phone).
        self.assertEqual(conn.counts["users"], 4)

    def test_a_change_shows_after_the_interval(self):
        conn = use(person=person())
        self.assertEqual(actions_of(build()), plain_extension_actions())
        conn.users[(COMPANY, EXT)] = person(dnd=True)
        self.assertEqual(actions_of(build()), plain_extension_actions())
        dps._person_cache_time[(COMPANY, EXT)] -= dps.CALLING_RULES_CACHE_SECONDS + 1
        self.assertEqual(actions_of(build()), plain_voicemail_actions())


class J_NothingElseMoved(unittest.TestCase):
    def test_a_queue_call_never_reads_the_person(self):
        conn = use(person=person(dnd=True, forward=action("PHONE", "14155550100")))
        xml = build(did_row(route=("QUEUE", "5f0000000000000000000001")))
        self.assertIn(RUNS_QUEUE % "5f0000000000000000000001", xml)
        self.assertEqual(conn.counts["users"], 0)
        self.assertEqual(rules_applied(), [])

    def test_a_menu_and_an_outside_number_never_read_the_person(self):
        conn = use(person=person(dnd=True))
        self.assertIn(RUNS_MENU % "ivr-1", build(did_row(route=("IVR", "ivr-1"))))
        self.assertIn("sofia/internal/14155550100@10.0.0.9", build(did_row(route=("PHONE", "14155550100"))))
        self.assertIn('application="hangup"', build(did_row(route=("HANGUP", "HANGUP"))))
        self.assertEqual(conn.counts["users"], 0)

    def test_the_channel_guard_and_recording_are_still_there(self):
        use(person=person(failure=action("VOICEMAIL", EXT)))
        xml = build()
        self.assertIn('application="limit" data="hash company_channels', xml)
        self.assertIn('data="call_timeout=', xml)

    def test_no_forward_actions_is_still_not_found(self):
        use(person=person(dnd=True))
        self.assertEqual(build({"forward_call_actions": None, "company_uuid": COMPANY, "db_name": DB}),
                         dps.NOT_FOUND_TPL)

    def test_the_marker_is_present_once(self):
        with open(TARGET, encoding="utf-8") as handle:
            source = handle.read()
        self.assertEqual(source.count("person_rules: a person's own call rules reach direct calls to them"), 1)
        self.assertEqual(source.count("SELECT settings, call_forwarding, greetings FROM users"), 1)
        # The QUEUE, IVR, PHONE and HANGUP branches are the text they were.
        self.assertEqual(source.count("person_"), source.count("person_", 0, source.index('    if route_type == "IVR":\n        # route_value is the IVR')))


if __name__ == "__main__":
    unittest.main(argv=sys.argv[:1], verbosity=2)
