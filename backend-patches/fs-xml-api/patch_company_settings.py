"""Read company-wide settings from `company_settings`, falling back to the
"Company Default" template row.

WHY. Five readers in dialplan_service.py fetch the same reserved row -

    SELECT settings FROM `<tenant>`.user_template WHERE name = 'Company Default'

- and each pulls one top-level key out of the blob:

    company_ring_seconds        settings.company_ring_time
    company_operational_hours   settings.operational_hours + settings.company_holidays
    company_recording_policy    settings.recording
    company_on_demand_enabled   settings.recording
    get_calling_rules           settings.company_calling_permissions

The API is moving those keys into a table of their own in the same tenant
database, one row per former key:

    company_settings (section VARCHAR(64) UNIQUE, settings JSON, version INT, updated_at)

so section 'recording' holds what used to be settings['recording'], and so on.
Once the API writes there, the template blob stops being updated and every one
of these readers would go on serving whatever the company last saved before
the move - a recording switch turned off that keeps recording, a ring time that
never changes. This patch makes the switch read the new table first.

WHAT IT DOES. One helper, `company_section(db_name, section)`:

  1. `SELECT settings FROM <db>.company_settings WHERE section = %s`. A row
     means the answer.
  2. If the table is not there (MySQL 1146), the row is absent, or the query
     fails for any other reason, read the template row and return
     settings.get(section) - exactly what the readers do today.
  3. "Table not there" is remembered per tenant for CALLING_RULES_CACHE_SECONDS,
     so a tenant that has not been migrated costs one failed query a minute,
     not one per call.

The five readers call the helper instead of running the query inline. Every
default, range check, cache and log line they have today is kept: a failure in
the fallback query raises out of the helper into the reader's own `except`,
which is where today's defaults (recording off, ring 30s, allow the call, hours
unknown) come from. The dialplan cannot fail closed because of this change -
the worst case is what happens today.

Idempotent: a marker comment records that the helper is present, and a second
run stops before touching anything. Every anchor must match exactly once or
the patch refuses to write.
"""

import io
import os
import py_compile
import shutil
import sys
import time

PATH = sys.argv[1]
MARKER = "# company_settings: sections are read through company_section()"

with io.open(PATH, encoding="utf-8") as handle:
    text = handle.read()

if MARKER in text:
    print("already applied: %s" % PATH)
    raise SystemExit(0)


# --- 1. the helper, placed just after the constants it uses -----------------

ANCHOR_HELPER = '''def _as_object(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return value or {}
'''

HELPER = ANCHOR_HELPER + '''

''' + MARKER + '''
#
# A tenant that has not been given the table yet is remembered here, so the
# lookup that is known to fail is skipped for CALLING_RULES_CACHE_SECONDS
# rather than tried on every call. db_name -> the time the table was missing.
_company_settings_missing = {}

# MySQL's code for "table doesn't exist". pymysql raises it as args[0].
MYSQL_NO_SUCH_TABLE = 1146


def _mysql_error_code(exc):
    args = getattr(exc, "args", None) or ()
    return args[0] if args and isinstance(args[0], int) else None


def company_section(db_name, section):
    """One company-wide setting, e.g. 'recording', 'operational_hours'.

    Read from `<db>.company_settings`, the table the API writes company
    settings to now, one row per section. Where that table has not arrived
    yet, or has no row for this section, the value comes from the same place
    it always did: the top-level key of that name on the "Company Default"
    template row. So a tenant migrated yesterday, one migrated next week and
    one never migrated all read correctly through the one function.

    Returns the parsed JSON for the section, or None where nobody has set it.
    Only the fallback read is allowed to raise: a failure there reaches the
    caller's own `except`, which is where today's defaults live. A failure on
    the new table never does - it just means "read the old place".
    """
    if not db_name:
        return None
    conn = get_db()
    now = time.time()
    missing_at = _company_settings_missing.get(db_name)
    if missing_at is None or (now - missing_at) >= CALLING_RULES_CACHE_SECONDS:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT settings FROM `%s`.company_settings WHERE section = %%s LIMIT 1" % db_name,
                    (section,),
                )
                row = cur.fetchone()
            _company_settings_missing.pop(db_name, None)
            # A row with a NULL value is "not set here", not "set to nothing".
            if row and row.get("settings") is not None:
                return _as_object(row.get("settings"))
        except Exception as e:
            if _mysql_error_code(e) == MYSQL_NO_SUCH_TABLE:
                if missing_at is None:
                    log("info", "no company_settings table yet, reading the template row", db=db_name)
                _company_settings_missing[db_name] = now
            else:
                log("error", "company_settings lookup failed, reading the template row: %s" % e,
                    db=db_name, section=section)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
            (COMPANY_DEFAULT_TEMPLATE,),
        )
        row = cur.fetchone() or {}
    return _as_object(row.get("settings")).get(section)
'''


# --- 2. company_ring_seconds --------------------------------------------------

OLD_RING = '''    seconds = fallback
    try:
        if db_name:
            conn = get_db()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
                    (COMPANY_DEFAULT_TEMPLATE,),
                )
                row = cur.fetchone() or {}
                settings = _as_object(row.get("settings"))
                block = _as_object(settings.get("company_ring_time"))
                value = int(block.get("seconds") or 0)
                if RING_SECONDS_MIN <= value <= RING_SECONDS_MAX:
                    seconds = value
    except Exception as e:
        log("error", "ring time lookup failed, using the default: %s" % e)
        return fallback
'''

NEW_RING = '''    seconds = fallback
    try:
        if db_name:
            block = _as_object(company_section(db_name, "company_ring_time"))
            value = int(block.get("seconds") or 0)
            if RING_SECONDS_MIN <= value <= RING_SECONDS_MAX:
                seconds = value
    except Exception as e:
        log("error", "ring time lookup failed, using the default: %s" % e)
        return fallback
'''


# --- 3. company_operational_hours --------------------------------------------

OLD_HOURS = '''    hours = {}
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
                (COMPANY_DEFAULT_TEMPLATE,),
            )
            row = cur.fetchone() or {}
            settings = _as_object(row.get("settings"))
            hours = dict(_as_object(settings.get("operational_hours")))
            # Company > Holidays keeps its list under its own key, separate from
            # the holidays typed into the opening-hours dialog. Both are the
            # company saying "we are shut on this day", so both are honoured and
            # neither overwrites the other.
            declared = settings.get("company_holidays")
            declared_items = declared.get("items") if isinstance(declared, dict) else declared
            if isinstance(declared_items, list) and declared_items:
                existing = hours.get("holidays")
                hours["holidays"] = (existing if isinstance(existing, list) else []) + declared_items
    except Exception as e:
        log("error", "opening hours lookup failed, treating as unknown: %s" % e)
        return {}
'''

NEW_HOURS = '''    hours = {}
    try:
        hours = dict(_as_object(company_section(db_name, "operational_hours")))
        # Company > Holidays keeps its list under its own key, separate from
        # the holidays typed into the opening-hours dialog. Both are the
        # company saying "we are shut on this day", so both are honoured and
        # neither overwrites the other. It is its own section in the new
        # table, just as it was its own key on the template row.
        declared = company_section(db_name, "company_holidays")
        declared_items = declared.get("items") if isinstance(declared, dict) else declared
        if isinstance(declared_items, list) and declared_items:
            existing = hours.get("holidays")
            hours["holidays"] = (existing if isinstance(existing, list) else []) + declared_items
    except Exception as e:
        log("error", "opening hours lookup failed, treating as unknown: %s" % e)
        return {}
'''


# --- 4. company_recording_policy ---------------------------------------------

OLD_RECORDING = '''    mode = DEFAULT_RECORDING_MODE
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
                (COMPANY_DEFAULT_TEMPLATE,),
            )
            row = cur.fetchone() or {}
            settings = _as_object(row.get("settings"))
            automatic = _as_object(_as_object(settings.get("recording")).get("automatic"))
            if "enabled" in automatic:
                if automatic.get("enabled") is True:
                    value = str(automatic.get("value") or "").strip().lower()
                    mode = value if value in ("all", "incoming", "outgoing") else DEFAULT_RECORDING_MODE
                else:
                    mode = "off"
    except Exception as e:
        log("error", "recording policy lookup failed, not recording: %s" % e)
        return "off"
'''

NEW_RECORDING = '''    mode = DEFAULT_RECORDING_MODE
    try:
        automatic = _as_object(_as_object(company_section(db_name, "recording")).get("automatic"))
        if "enabled" in automatic:
            if automatic.get("enabled") is True:
                value = str(automatic.get("value") or "").strip().lower()
                mode = value if value in ("all", "incoming", "outgoing") else DEFAULT_RECORDING_MODE
            else:
                mode = "off"
    except Exception as e:
        log("error", "recording policy lookup failed, not recording: %s" % e)
        return "off"
'''


# --- 5. company_on_demand_enabled --------------------------------------------

OLD_ON_DEMAND = '''    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
                (COMPANY_DEFAULT_TEMPLATE,),
            )
            row = cur.fetchone() or {}
            settings = _as_object(row.get("settings"))
            on_demand = _as_object(_as_object(settings.get("recording")).get("on_demand"))
            return on_demand.get("enabled") is True
    except Exception as e:
        log("error", "on-demand policy lookup failed: %s" % e)
        return False
'''

NEW_ON_DEMAND = '''    try:
        on_demand = _as_object(_as_object(company_section(db_name, "recording")).get("on_demand"))
        return on_demand.get("enabled") is True
    except Exception as e:
        log("error", "on-demand policy lookup failed: %s" % e)
        return False
'''


# --- 6. get_calling_rules ------------------------------------------------------

OLD_RULES = '''        with conn.cursor() as cur:
            # The company rule sits in that company's own database.
            if db_name:
                cur.execute(
                    "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1" % db_name,
                    (COMPANY_DEFAULT_TEMPLATE,),
                )
                row = cur.fetchone() or {}
                settings = _as_object(row.get("settings"))
                block = _as_object(
                    (settings.get("company_calling_permissions") or {}).get("international_calling")
                )
'''

NEW_RULES = '''        with conn.cursor() as cur:
            # The company rule sits in that company's own database.
            if db_name:
                block = _as_object(
                    (company_section(db_name, "company_calling_permissions") or {}).get("international_calling")
                )
'''


EDITS = (
    (ANCHOR_HELPER, HELPER, "helper anchor (_as_object)"),
    (OLD_RING, NEW_RING, "company_ring_seconds"),
    (OLD_HOURS, NEW_HOURS, "company_operational_hours"),
    (OLD_RECORDING, NEW_RECORDING, "company_recording_policy"),
    (OLD_ON_DEMAND, NEW_ON_DEMAND, "company_on_demand_enabled"),
    (OLD_RULES, NEW_RULES, "get_calling_rules"),
)

# Every anchor is checked before anything is replaced, so a file that matches
# five of six is left exactly as it was.
for old, _new, label in EDITS:
    count = text.count(old)
    if count != 1:
        raise SystemExit("no single match for %s (found %d) - nothing written" % (label, count))

for old, new, _label in EDITS:
    text = text.replace(old, new)

# Nothing else may still run the template query inline: the whole point is
# one place that knows where company settings live.
INLINE = "SELECT settings FROM `%s`.user_template WHERE name = %%s LIMIT 1"
if text.count(INLINE) != 1:
    raise SystemExit("expected exactly one template query left (the helper's), found %d - nothing written"
                     % text.count(INLINE))

backup = "%s.bak-company-settings-%s" % (PATH, time.strftime("%Y%m%d-%H%M%S"))
shutil.copy2(PATH, backup)

with io.open(PATH, "w", encoding="utf-8") as handle:
    handle.write(text)

try:
    py_compile.compile(PATH, doraise=True)
except py_compile.PyCompileError as e:
    shutil.copy2(backup, PATH)
    raise SystemExit("patched file does not compile, original restored: %s" % e)

print("patched %s (backup %s)" % (PATH, os.path.basename(backup)))
