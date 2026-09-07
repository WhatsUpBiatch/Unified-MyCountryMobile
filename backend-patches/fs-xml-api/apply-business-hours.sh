#!/usr/bin/env bash
# Make the switch check the clock before ringing an office.
#
# WHAT IS WRONG TODAY
#
# The dialplan reads call_handling.business_hours and routes by its `type`, but
# never looks at what time it is. A call at 2am is treated exactly like one at
# 2pm: it rings the same desk phone in an empty office until it gives up.
# Opening hours are saved, shown in the admin screens, and have never once
# affected a call.
#
# WHAT THIS CHANGES
#
# When a company is definitively CLOSED and the number points at an extension,
# the call goes to that extension's voicemail instead of ringing an empty room.
# It reuses the existing VOICEMAIL branch rather than adding a new path, so the
# code that actually handles the call is already proven in production.
#
# WHAT IT DELIBERATELY DOES NOT DO
#
# Only EXTENSION routes are diverted. A number pointed at an IVR or a queue is
# left alone, because there is no stored "closed hours" target to send it to and
# inventing one would be guessing at what the owner wanted.
#
# Nothing changes unless the answer is a definite "closed". Missing settings, a
# timezone that will not resolve, times that will not parse, or a shape this was
# not written for all answer "unknown", and unknown behaves exactly as today.
# Wrongly refusing a call inside business hours is lost business; wrongly
# connecting one outside them is a nuisance. The uncertainty is spent on the
# side that keeps calls flowing.
#
# BLAST RADIUS, MEASURED BEFORE WRITING THIS
#
# Of 19 companies, two have opening hours saved at all. One of those is set to
# "24 hours", which is always open and never diverts. So exactly one company can
# be affected by this change.
#
# The decision logic is tested separately in test_business_hours.py - 34 cases,
# including a timezone behind UTC where the local DAY differs from the UTC day,
# which is the case a naive implementation gets wrong.

set -euo pipefail

HOST="${1:-root@142.93.121.121}"
FILE=/opt/fs-xml-api-1.2.5/dialplan_service.py
SERVICE=fs-xml-api

say() { printf '\n%s\n' "$*"; }

say "1/6  Backing up the current dialplan"
ssh "$HOST" "cp $FILE $FILE.bak-\$(date +%Y%m%d-%H%M%S) && ls -1t $FILE.bak-* | head -1"

say "2/6  Adding the opening-hours decision"
ssh "$HOST" "python3 - <<'PY'
import io, re
path = '$FILE'
s = io.open(path, encoding='utf-8').read()

if 'def business_hours_state(' in s:
    print('    already applied - nothing to do')
    raise SystemExit(0)

anchor = 'def get_calling_rules(db_name, company_uuid, user_uuid):'
if s.count(anchor) != 1:
    raise SystemExit('ABORT: expected one %r, found %d' % (anchor, s.count(anchor)))

block = '''OPERATIONAL_HOURS_OPEN = \"open\"
OPERATIONAL_HOURS_CLOSED = \"closed\"
OPERATIONAL_HOURS_UNKNOWN = \"unknown\"

_HOURS_DAYS = [\"monday\", \"tuesday\", \"wednesday\", \"thursday\", \"friday\", \"saturday\", \"sunday\"]

_hours_cache = {}
_hours_cache_time = {}


def _parse_hhmm(text):
    \"\"\"\"09:30\" -> 570 minutes past midnight. None if it is not a time.\"\"\"
    if not isinstance(text, str):
        return None
    parts = text.strip().split(\":\")
    if len(parts) != 2:
        return None
    try:
        hours, minutes = int(parts[0]), int(parts[1])
    except (TypeError, ValueError):
        return None
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        return None
    return hours * 60 + minutes


def _holiday_dates(holidays):
    \"\"\"Several plausible stored shapes are accepted rather than assumed.
    Anything unreadable is skipped - a holiday nobody can parse must not turn
    into a closed day by accident.\"\"\"
    out = set()
    if not isinstance(holidays, list):
        return out
    for entry in holidays:
        raw = None
        if isinstance(entry, str):
            raw = entry
        elif isinstance(entry, dict):
            for key in (\"date\", \"day\", \"value\", \"start\"):
                if isinstance(entry.get(key), str):
                    raw = entry[key]
                    break
        if not raw:
            continue
        try:
            out.add(datetime.date.fromisoformat(raw.strip()[:10]))
        except ValueError:
            continue
    return out


def business_hours_state(operational_hours, now_utc=None):
    \"\"\"Is the company open right now: \"open\", \"closed\", or \"unknown\".

    The third answer carries the weight. A company with no hours set, a
    timezone that will not resolve, or times that will not parse must not be
    guessed at - guessing \"closed\" sends a real caller to voicemail during
    business hours and nobody finds out until a customer complains. Every
    uncertain case answers \"unknown\", and the caller connects as it does today.
    \"\"\"
    settings = _as_object(operational_hours)
    if not settings:
        return OPERATIONAL_HOURS_UNKNOWN

    kind = str(settings.get(\"type\") or \"\").strip().lower()
    if not kind:
        return OPERATIONAL_HOURS_UNKNOWN
    if kind in (\"24_hours\", \"24hours\", \"24\"):
        return OPERATIONAL_HOURS_OPEN
    if kind != \"weekly\":
        return OPERATIONAL_HOURS_UNKNOWN

    tz_name = str((_as_object(_as_object(settings.get(\"regional\")).get(\"timezone\"))).get(\"value\") or \"\").strip()
    if not tz_name or ZoneInfo is None:
        return OPERATIONAL_HOURS_UNKNOWN
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        return OPERATIONAL_HOURS_UNKNOWN

    if now_utc is None:
        now_utc = datetime.datetime.now(datetime.timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=datetime.timezone.utc)
    local = now_utc.astimezone(tz)

    if local.date() in _holiday_dates(settings.get(\"holidays\")):
        return OPERATIONAL_HOURS_CLOSED

    day = _as_object(_as_object(settings.get(\"value\")).get(_HOURS_DAYS[local.weekday()]))
    if not day:
        return OPERATIONAL_HOURS_UNKNOWN
    if not day.get(\"open\"):
        return OPERATIONAL_HOURS_CLOSED

    start = _parse_hhmm(day.get(\"start\"))
    end = _parse_hhmm(day.get(\"end\"))
    if start is None or end is None or start == end:
        return OPERATIONAL_HOURS_UNKNOWN

    minutes = local.hour * 60 + local.minute
    if start < end:
        return OPERATIONAL_HOURS_OPEN if start <= minutes < end else OPERATIONAL_HOURS_CLOSED
    # end before start means the day runs past midnight, e.g. 22:00 to 06:00.
    return OPERATIONAL_HOURS_OPEN if (minutes >= start or minutes < end) else OPERATIONAL_HOURS_CLOSED


def company_operational_hours(db_name):
    \"\"\"The company's opening hours, from the same reserved settings record the
    ring time and calling rules come from. Cached briefly, because this sits on
    the path of every inbound call. Any failure returns nothing, which the
    caller reads as \"unknown\" and therefore as today's behaviour.\"\"\"
    if not db_name:
        return {}
    now = time.time()
    if db_name in _hours_cache and (now - _hours_cache_time.get(db_name, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _hours_cache[db_name]

    hours = {}
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                \"SELECT settings FROM \`%s\`.user_template WHERE name = %%s LIMIT 1\" % db_name,
                (COMPANY_DEFAULT_TEMPLATE,),
            )
            row = cur.fetchone() or {}
            hours = _as_object(_as_object(row.get(\"settings\")).get(\"operational_hours\"))
    except Exception as e:
        log(\"error\", \"opening hours lookup failed, treating as unknown: %s\" % e)
        return {}

    _hours_cache[db_name] = hours
    _hours_cache_time[db_name] = now
    return hours


'''

s = s.replace(anchor, block + anchor, 1)

# zoneinfo, imported defensively so an old interpreter degrades to \"unknown\"
# rather than stopping the service from starting at all.
imp_anchor = 'import datetime\n'
if s.count(imp_anchor) != 1:
    raise SystemExit('ABORT: expected one datetime import, found %d' % s.count(imp_anchor))
s = s.replace(imp_anchor, imp_anchor + 'try:\n    from zoneinfo import ZoneInfo\nexcept ImportError:\n    ZoneInfo = None\n', 1)

# The diversion itself, right after the inbound call is logged.
log_anchor = '    log(\"info\", \"inbound call\", did=dest, route_type=route_type, route_value=route_value, domain=domain)'
if s.count(log_anchor) != 1:
    raise SystemExit('ABORT: expected one inbound log line, found %d' % s.count(log_anchor))

divert = log_anchor + '''

    # Outside opening hours, a number pointed at a desk phone goes to that
    # extension'\\''s voicemail rather than ringing an empty office. Only
    # EXTENSION is diverted: there is no stored closed-hours target for an IVR
    # or a queue, and inventing one would be guessing.
    #
    # Only a definite \"closed\" diverts. \"unknown\" - no hours set, an
    # unresolvable timezone, unparseable times - behaves exactly as before.
    if route_type == \"EXTENSION\":
        hours_state = business_hours_state(company_operational_hours(db_name))
        if hours_state == OPERATIONAL_HOURS_CLOSED:
            log(\"info\", \"outside opening hours, diverting to voicemail\",
                did=dest, extension=route_value)
            route_type = \"VOICEMAIL\"'''

s = s.replace(log_anchor, divert, 1)

if s.count('def business_hours_state(') != 1:
    raise SystemExit('ABORT: decision function not inserted exactly once')
if s.count('diverting to voicemail') != 1:
    raise SystemExit('ABORT: diversion not inserted exactly once')

io.open(path, 'w', encoding='utf-8').write(s)
print('    inserted')
PY"

say "3/6  Checking it still compiles BEFORE anything restarts"
ssh "$HOST" "python3 -m py_compile $FILE && echo '    compiles'"

say "4/6  Restarting the service"
ssh "$HOST" "systemctl restart $SERVICE && sleep 2 && systemctl is-active $SERVICE"

say "5/6  Proving the running process is newer than the file"
ssh "$HOST" "
  ls -l --time-style=+%H:%M:%S $FILE | awk '{print \"    file:    \" \$6}'
  ps -o lstart= -p \$(pgrep -f dialplan_service.py | head -1) | sed 's/^/    process: /'
"

say "6/6  Confirming the change is in the running file, with a control"
ssh "$HOST" "
  printf '    business_hours_state : %s\n' \$(grep -c 'def business_hours_state' $FILE)
  printf '    diversion            : %s\n' \$(grep -c 'diverting to voicemail' $FILE)
  printf '    control (QUEUE)      : %s\n' \$(grep -c 'route_type == \"QUEUE\"' $FILE)
"

say "Done. Opening hours are now checked before an extension is rung."
