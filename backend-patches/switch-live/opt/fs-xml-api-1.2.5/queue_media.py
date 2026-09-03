"""The audio a queue caller actually hears.

Every queue screen offers a welcome message, hold music, a waiting message and
two "nobody can take it" messages. Eight queues have one saved. None of them has
ever played, and the reason is a gap rather than a bug: the switch script reads
the audio off channel variables - `cc_hold_music`, `cc_waiting_media`,
`cc_no_agent_available_media`, `cc_all_agent_busy_media` - and the dialplan set
none of them. So every caller got FreeSWITCH's stock hold loop no matter what
the admin chose.

The second half of the gap is where the files are. Greetings are uploaded to
Wasabi, not to the switch, and the media API refuses an unauthenticated request.
FreeSWITCH has no http cache module loaded, so it cannot stream a URL either. It
can only play a file on disk, and the one directory it shares with the host is
`/etc/freeswitch`. So the audio is fetched once, written under there, and played
from disk from then on.

Everything here fails open. A greeting that cannot be fetched leaves its
variable unset, and the script then falls back to the default it always used - a
caller hearing stock hold music is a disappointment, a caller hearing silence
because a playback pointed at a missing file is a dead call.
"""
import os

# Inside `/etc/freeswitch`, which is the one host directory mounted into the
# FreeSWITCH container. Anywhere else is invisible to the switch.
GREETING_CACHE_DIR = "/etc/freeswitch/sounds/mcm/greetings"

# Which saved greeting drives which channel variable the queue script reads.
# `welcome` is absent on purpose: the script has no variable for it, so it is
# played by the dialplan before the script runs. See `welcome_file`.
MEDIA_VARIABLES = {
    "hold": "cc_hold_music",
    "waiting": "cc_waiting_media",
    "no_agent_available": "cc_no_agent_available_media",
    "all_agent_busy": "cc_all_agent_busy_media",
    # The tone a caller hears while an agent's phone is ringing. The script used
    # the waiting message for this, so choosing one here did nothing.
    "ring_tone": "cc_ring_tone",
    # Played over and over while somebody waits - "you are still in the queue" -
    # as opposed to the waiting message, which is the hold audio itself.
    "delay": "cc_repeat_media",
}

REPEAT_INTERVAL_VARIABLE = "cc_repeat_interval"
REPEAT_INTERVAL_DEFAULT = 60
REPEAT_INTERVAL_MIN = 10
REPEAT_INTERVAL_MAX = 600

# A filename is a uuid plus an extension. Anything else is refused rather than
# cleaned up: these values are interpolated into a dialplan and then into a
# shell-free but still string-built playback path, and a name containing a
# slash, a space or a quote has no business being either.
_ALLOWED = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")


def safe_name(value):
    """A media filename that is safe to put in a path, or None."""
    text = str(value or "").strip()
    if not text or len(text) > 128:
        return None
    if any(ch not in _ALLOWED for ch in text):
        return None
    if text.startswith(".") or ".." in text:
        return None
    if "." not in text:
        return None
    return text


def enabled_media(queue):
    """{slot: filename} for every greeting this queue has switched on.

    A slot switched on with nothing chosen is left out - it is a half-finished
    setting, not an instruction to play silence.
    """
    if not isinstance(queue, dict):
        return {}
    settings = queue.get("settings")
    media = settings.get("media") if isinstance(settings, dict) else None
    if not isinstance(media, dict):
        return {}

    out = {}
    for slot, block in media.items():
        if not isinstance(block, dict):
            continue
        if not block.get("enabled"):
            continue
        name = safe_name(block.get("value"))
        if name:
            out[slot] = name
    return out


def cache_path(company_uuid, file_name):
    """Where this file lives once fetched, or None if either part is unusable."""
    company = safe_name(company_uuid + ".x") if company_uuid else None
    name = safe_name(file_name)
    if not company or not name:
        return None
    return os.path.join(GREETING_CACHE_DIR, company[:-2], name)


def media_actions(queue, company_uuid, fetch):
    """Dialplan actions that point the queue script at this queue's own audio.

    `fetch(company_uuid, file_name) -> local path or None` does the downloading,
    and is passed in so the decision of *what* to play stays testable without a
    network or a disk.

    Slots whose audio cannot be produced are skipped silently rather than set to
    an empty string: the script treats "unset" as "use the default", and an empty
    value would be a filename it then fails to open.
    """
    actions = []
    for slot, name in sorted(enabled_media(queue).items()):
        variable = MEDIA_VARIABLES.get(slot)
        if not variable:
            continue
        path = fetch(company_uuid, name)
        if not path:
            continue
        actions.append({"application": "set", "data": "%s=%s" % (variable, path)})
    return actions


def welcome_actions(queue, company_uuid, fetch):
    """The greeting played once, before the caller joins the line.

    Separate from the rest because the script has no variable for it - it is a
    plain playback the dialplan performs first, and it has to come after `answer`
    or there is no channel to play down.
    """
    name = enabled_media(queue).get("welcome")
    if not name:
        return []
    path = fetch(company_uuid, name)
    if not path:
        return []
    return [{"application": "playback", "data": path}]


# ---------------------------------------------------------------------------
# Fetching. Kept apart from the decisions above so the rules stay testable
# without a network, and so a failure here can only ever mean "no audio", never
# a broken call.

_WASABI = {}


def _wasabi_client():
    """One client, built on first use from the media API's own credentials."""
    if _WASABI:
        return _WASABI.get("client"), _WASABI.get("bucket")

    _WASABI["client"] = None
    _WASABI["bucket"] = None
    try:
        env = {}
        for line in open("/var/www/prod/media-api/.env"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k] = v.strip().strip('"').strip("'")

        import boto3
        from botocore.config import Config

        endpoint = env["WASABI_ENDPOINT"]
        if not endpoint.startswith("http"):
            endpoint = "https://" + endpoint

        _WASABI["client"] = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=env["WASABI_KEYS"],
            aws_secret_access_key=env["WASABI_SECRETS"],
            region_name=env["WASABI_BUCKET_REGION"],
            # Short and non-retrying on purpose: this runs while a caller is
            # waiting for the dialplan. Stock hold music now beats correct hold
            # music in four seconds' time.
            config=Config(connect_timeout=2, read_timeout=4, retries={"max_attempts": 1}),
        )
        _WASABI["bucket"] = env["WASABI_BUCKET"]
    except Exception:
        pass
    return _WASABI.get("client"), _WASABI.get("bucket")


def fetch_greeting(company_uuid, file_name, log=None):
    """The local path for this greeting, fetching it once if need be, or None.

    Written to the final path only after a complete download, via a temporary
    file, so a call interrupted half way cannot leave a truncated audio file
    that every later call then plays.
    """
    path = cache_path(company_uuid, file_name)
    if not path:
        return None
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path

    client, bucket = _wasabi_client()
    if not client or not bucket:
        return None

    # A company's own recording lives under its uuid; the ones the platform
    # ships for everybody live under , which is where the
    # media API's getDefaultPresignedUrl reads them from too. Both are tried,
    # company first, because a company that recorded its own greeting means
    # that one - and without the second key every stock greeting fetched
    # nothing and the caller heard only the beep.
    keys = [
        "%s/greeting/%s" % (company_uuid, file_name),
        "default/recording/%s" % file_name,
    ]
    try:
        body = None
        for key in keys:
            try:
                obj = client.get_object(Bucket=bucket, Key=key)
                body = obj["Body"].read()
                if body:
                    break
            except Exception:
                continue
        if not body:
            return None
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, path)
        if log:
            log("info", "cached queue greeting", file=file_name, bytes=len(body))
        return path
    except Exception as e:
        if log:
            log("warn", "queue greeting could not be fetched, using the default: %s" % e)
        return None


# ---------------------------------------------------------------------------
# The queue record itself. The dialplan knows the queue id from the number's
# routing, but the audio lives on the queue, which is in MongoDB rather than the
# MySQL this service otherwise reads. Cached briefly, because this runs on the
# call path and a queue's greetings do not change between two rings.

_QUEUE_CACHE = {}
_QUEUE_CACHE_AT = {}
QUEUE_CACHE_SECONDS = 60

_MONGO = {}


def _queues_collection():
    if _MONGO:
        return _MONGO.get("collection")
    _MONGO["collection"] = None
    try:
        env = {}
        for line in open("/opt/fs-xml-api-1.2.5/.env"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k] = v.strip().strip('"').strip("'")
        from pymongo import MongoClient

        client = MongoClient(env["MONGODB_URI"], serverSelectionTimeoutMS=2000,
                             connectTimeoutMS=2000, socketTimeoutMS=3000)
        _MONGO["collection"] = client[env["MONGODB_DATABASE"]]["queues"]
    except Exception:
        pass
    return _MONGO.get("collection")


def queue_record(queue_id, log=None):
    """The queue this call is heading into, or None.

    None every time anything goes wrong - a bad id, mongo unreachable, a queue
    that no longer exists. The caller then sets no audio variables and the
    script plays what it always played.
    """
    import time

    key = str(queue_id or "").strip()
    if not key:
        return None

    now = time.time()
    if key in _QUEUE_CACHE and (now - _QUEUE_CACHE_AT.get(key, 0)) < QUEUE_CACHE_SECONDS:
        return _QUEUE_CACHE[key]

    collection = _queues_collection()
    if collection is None:
        return None

    try:
        from bson import ObjectId

        record = collection.find_one(
            {"_id": ObjectId(key)},
            {"settings.media": 1, "settings.ring_strategy": 1, "settings.wrapup_time": 1,
             "settings.operational_hours": 1,
             "settings.waiting": 1,
             "company_uuid": 1},
        )
    except Exception as e:
        if log:
            log("warn", "queue media lookup failed, using default audio: %s" % e)
        return None

    _QUEUE_CACHE[key] = record
    _QUEUE_CACHE_AT[key] = now
    return record


def queue_audio_actions(queue_id, company_uuid, log=None):
    """Everything the dialplan should add for this queue's own audio.

    Returns (welcome_playbacks, variable_sets). Empty lists whenever anything is
    missing, so the caller can always splice them in unconditionally.
    """
    record = queue_record(queue_id, log=log)
    if not record:
        return [], []

    company = str(record.get("company_uuid") or company_uuid or "").strip()
    if not company:
        return [], []

    fetch = lambda c, n: fetch_greeting(c, n, log=log)  # noqa: E731
    audio = media_actions(record, company, fetch)

    # Only sent when the recording itself made it through. An interval pointing
    # at audio that could not be fetched would have the script waking up on a
    # timer to play nothing.
    interval = queue_repeat_interval(record)
    if interval and any(a["data"].startswith(MEDIA_VARIABLES["delay"] + "=") for a in audio):
        audio.append(
            {"application": "set", "data": "%s=%d" % (REPEAT_INTERVAL_VARIABLE, interval)}
        )

    return welcome_actions(record, company, fetch), queue_behaviour_actions(record) + audio


# ---------------------------------------------------------------------------
# The ring strategy, and why it has to be sent explicitly.
#
# `callcenter-queue.lua` reads `cc_ring_strategy` and, finding nothing, falls
# back to "random". It then passes that to the lookup service as an explicit
# parameter - and an explicit parameter beats the strategy stored on the queue.
# So every queue rang its agents in a random order, one at a time, whatever the
# admin had chosen. "Ring All" never rang everybody.
#
# Setting the variable from the queue record is the whole fix: the script keeps
# its default for anything that arrives without one, and a queue that has an
# answer gets its own.

STRATEGY_VARIABLE = "cc_ring_strategy"
WRAPUP_VARIABLE = "cc_wrapup_time"
MAX_CALLERS_VARIABLE = "cc_max_callers"

# "You are caller number N" while somebody waits. The script counts the line
# with mod_hash and speaks the number from files under /etc/freeswitch/sounds;
# all the dialplan says is whether this queue wants it and how often.
ANNOUNCE_POSITION_VARIABLE = "cc_announce_position"
ANNOUNCE_INTERVAL_VARIABLE = "cc_announce_interval"
# Between the first and second announcement, and each one after. Under thirty
# seconds it is nagging; over a few minutes the caller has forgotten they were
# told.
ANNOUNCE_INTERVAL_DEFAULT = 60
ANNOUNCE_INTERVAL_MIN = 30
ANNOUNCE_INTERVAL_MAX = 600

# The spellings the switch and the service both understand. Anything outside
# this is dropped rather than passed on: an unknown value would be forwarded to
# the service as an override and quietly beat the stored setting, which is the
# exact bug this exists to fix.
KNOWN_STRATEGIES = {
    "ring-all",
    "top-down",
    "round-robin",
    "longest-idle-agent",
    "agent-with-least-talk-time",
    "agent-with-fewest-calls",
    "random",
}


def queue_strategy(queue):
    """The ring strategy saved on this queue, or '' if there is not a usable one."""
    if not isinstance(queue, dict):
        return ""
    settings = queue.get("settings")
    if not isinstance(settings, dict):
        return ""
    block = settings.get("ring_strategy")
    if isinstance(block, dict):
        value = block.get("value")
        # Stored as {label, value} by the form, but older records hold the bare
        # string under the same key.
        if isinstance(value, dict):
            value = value.get("value")
    else:
        value = block
    text = str(value or "").strip().lower().replace("_", "-").replace(" ", "-")
    return text if text in KNOWN_STRATEGIES else ""


def queue_wrapup_seconds(queue):
    """Wrap-up seconds saved on this queue, or 0 to leave the script's default."""
    if not isinstance(queue, dict):
        return 0
    settings = queue.get("settings")
    if not isinstance(settings, dict):
        return 0
    try:
        seconds = int(settings.get("wrapup_time") or 0)
    except (TypeError, ValueError):
        return 0
    return seconds if 0 < seconds <= 3600 else 0


def queue_behaviour_actions(queue):
    """Set actions for how this queue rings, and what follows a call."""
    actions = []
    strategy = queue_strategy(queue)
    if strategy:
        actions.append({"application": "set", "data": "%s=%s" % (STRATEGY_VARIABLE, strategy)})
    wrapup = queue_wrapup_seconds(queue)
    if wrapup:
        actions.append({"application": "set", "data": "%s=%d" % (WRAPUP_VARIABLE, wrapup)})
    callers = queue_max_callers(queue)
    if callers:
        actions.append({"application": "set", "data": "%s=%d" % (MAX_CALLERS_VARIABLE, callers)})
    interval = queue_announce_interval(queue)
    if interval:
        actions.append({"application": "set", "data": "%s=1" % ANNOUNCE_POSITION_VARIABLE})
        actions.append({"application": "set", "data": "%s=%d" % (ANNOUNCE_INTERVAL_VARIABLE, interval)})
    return actions


def queue_announce_position(queue):
    """True when this queue's admin switched on "tell them where they are"."""
    if not isinstance(queue, dict):
        return False
    settings = queue.get("settings")
    waiting = settings.get("waiting") if isinstance(settings, dict) else None
    if not isinstance(waiting, dict):
        return False
    return waiting.get("announce_position") is True


def queue_announce_interval(queue):
    """Seconds between position announcements, or 0 when the queue does not want them.

    The screen has no interval control of its own; the repeating-message
    interval is reused when one is set, because a caller who is told their
    place and played a reminder on two different clocks hears a muddle. Bounds
    are clamped rather than refused, as everywhere else in this file.
    """
    if not queue_announce_position(queue):
        return 0
    settings = queue.get("settings") if isinstance(queue, dict) else None
    media = settings.get("media") if isinstance(settings, dict) else None
    block = media.get("delay") if isinstance(media, dict) else None
    raw = block.get("interval_seconds") if isinstance(block, dict) else None
    try:
        seconds = int(raw)
    except (TypeError, ValueError):
        return ANNOUNCE_INTERVAL_DEFAULT
    if seconds < ANNOUNCE_INTERVAL_MIN:
        return ANNOUNCE_INTERVAL_MIN
    if seconds > ANNOUNCE_INTERVAL_MAX:
        return ANNOUNCE_INTERVAL_MAX
    return seconds


def queue_max_callers(queue):
    """How many callers this queue will hold at once, or 0 for no cap.

    The screen has always promised that past this number a new caller goes to
    the failover instead of joining the line. Nothing enforced it, so a queue
    capped at five held as many as arrived.

    Stored two ways depending on when the queue was saved - a bare number, or
    the {label, value} pair the dropdown produces - so both are accepted.
    """
    if not isinstance(queue, dict):
        return 0
    settings = queue.get("settings")
    if not isinstance(settings, dict):
        return 0
    strategy = settings.get("ring_strategy")
    if not isinstance(strategy, dict):
        return 0
    block = strategy.get("max_wait_time")
    if not isinstance(block, dict):
        return 0

    raw = block.get("callers")
    if isinstance(raw, dict):
        raw = raw.get("value")
    try:
        callers = int(raw)
    except (TypeError, ValueError):
        return 0

    # A cap of zero would mean "hold nobody", which no admin means by leaving a
    # field blank, so it reads as no cap. The ceiling matches the form's own.
    return callers if 1 <= callers <= 500 else 0


def queue_hours(queue):
    """This queue's own opening hours, or {} if it keeps none."""
    if not isinstance(queue, dict):
        return {}
    settings = queue.get("settings")
    if not isinstance(settings, dict):
        return {}
    hours = settings.get("operational_hours")
    return hours if isinstance(hours, dict) else {}


def queue_closed_route(queue_id, closed_state_of, log=None):
    """Where a caller should go because *this queue* is shut, or ("", "").

    A queue can keep different hours from the company that owns it - support
    open late while the office is dark - and until now a queue's own hours were
    read by nothing at all.

    `closed_state_of(hours) -> bool` is passed in rather than imported so the
    clock logic stays in the one place that already owns it, and so this stays
    testable without a timezone database.

    Returns nothing at all unless the queue is shut AND has an enabled action
    with somewhere to send them. A queue that is shut with no answer of its own
    keeps ringing exactly as it does today: inventing a destination for it would
    be guessing, and guessing sends callers into silence.
    """
    record = queue_record(queue_id, log=log)
    if not record:
        return "", ""

    hours = queue_hours(record)
    if not hours:
        return "", ""

    try:
        if not closed_state_of(hours):
            return "", ""
    except Exception as e:
        if log:
            log("warn", "queue hours could not be judged, treating as open: %s" % e)
        return "", ""

    action = hours.get("closed_hour_action")
    if not isinstance(action, dict) or not action.get("enabled"):
        return "", ""

    kind = str(action.get("type") or "").strip().upper()
    value = str(action.get("value") or "").strip()
    if not kind or not value:
        return "", ""
    return kind, value


def queue_repeat_interval(queue):
    """How often the repeating message plays, in seconds, or 0 if it should not.

    Zero whenever the message itself is off, because an interval without a
    recording is not a setting - and a repeat every N seconds of nothing would
    just break the hold audio on a timer.

    Anything under the floor is raised to it rather than refused. A caller
    interrupted every three seconds is being badgered, and that is more likely a
    typo than an intention.
    """
    if "delay" not in enabled_media(queue):
        return 0

    settings = queue.get("settings") if isinstance(queue, dict) else None
    media = settings.get("media") if isinstance(settings, dict) else None
    block = media.get("delay") if isinstance(media, dict) else None
    raw = block.get("interval_seconds") if isinstance(block, dict) else None

    try:
        seconds = int(raw)
    except (TypeError, ValueError):
        return REPEAT_INTERVAL_DEFAULT

    if seconds < REPEAT_INTERVAL_MIN:
        return REPEAT_INTERVAL_MIN
    if seconds > REPEAT_INTERVAL_MAX:
        return REPEAT_INTERVAL_MAX
    return seconds
