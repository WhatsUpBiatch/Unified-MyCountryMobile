"""Refuse the phone of a person who is not ACTIVE, or who has been removed,
in the FreeSWITCH directory service.

WHY. The switch asks this service two questions about a person: "may this
phone register?" (sip_auth) and "where is this person so I can ring them?"
(user_call). Both were answered by one lookup whose SQL already said
`u.status = 'ACTIVE'` - so a SUSPENDED or PENDING person was refused - but it
never looked at `deleted_at`. Removing a person is a soft delete (the row
stays, deleted_at is set, status stays ACTIVE), so a removed person's phone
went on registering, ringing and making calls for as long as their softphone
kept its password. And when the status was anything else, the only trace was
the same "User not found" warning a mistyped extension gets, so nobody could
tell a suspended person from a missing one.

WHAT IT DOES.
  1. The lookup selects `u.status` and `u.deleted_at` and no longer filters on
     status in SQL, so the refusal can say WHY.
  2. `person_switch_refusal(row)` - pure - returns None for a live ACTIVE row,
     "REMOVED" when deleted_at is set, otherwise the status (SUSPENDED,
     PENDING, INACTIVE, EXPIRED). The refused row is dropped before it ever
     reaches the XML, so sip_auth and user_call both get the existing
     "not found" answer - the switch's own 403 on register, and a failed
     bridge on a call (the dialplan patch beside this one stops the call
     reaching the bridge at all).
  3. One info line per refusal:
       person refused on the switch: ext=1001, state=SUSPENDED, db_name=..., action=sip_auth
  4. `lookup_sip_user` takes the action, so the line can say which question
     was refused. The one caller passes it.

Nothing else changes: the XML templates, the gateways/network-list branch,
the DSN parsing, the not-found path for a genuinely missing extension.

A registration that already exists when the person is suspended stays in the
switch's registration table until it expires or the phone re-registers (the
switch re-asks this service on every REGISTER). The API patch ends their
sessions at once; the phone follows within its register interval. Flushing
it sooner needs an ESL call from the API, which is not part of this change.

Usage: python3 patch_directory_person_state.py path/to/directory_service.py
Idempotent: a file carrying the marker is left alone; every anchor must
match exactly once or nothing is written. A backup is written beside the
file and the result is compiled before it is kept.
"""

import io
import os
import py_compile
import shutil
import sys
import time

PATH = sys.argv[1]
MARKER = "# person_states: a person who is not ACTIVE, or is removed, has no phone"

with io.open(PATH, encoding="utf-8") as handle:
    text = handle.read()

if MARKER in text:
    print("already applied: %s" % PATH)
    raise SystemExit(0)

OLD_DEF = '''def lookup_sip_user(domain, username):
    username = re.sub(r'_(web|mobile|pstn)$', '', username)
    domain_part = domain.replace(f".{BASE_DOMAIN}", "")
    db_name = f"{DATABASE_PREFIX}{domain_part}"

    query = """
        SELECT u.extension, u.uuid, CONCAT(u.first_name, ' ', u.last_name) AS name,
               u.caller_id, u.company_uuid, u.password
        FROM users u
        JOIN companies c ON c.uuid = u.company_uuid
        WHERE c.db_name = %s AND u.extension = %s AND u.status = 'ACTIVE'
        LIMIT 1
    """
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute(query, (db_name, username))
            row = cursor.fetchone()
        conn.close()
        if row:
            log("info", f"Found user: ext={row['extension']}, name={row['name']}, db_name={db_name}")
        else:
            log("warn", f"User not found: ext={username}, db_name={db_name}, domain={domain}")
        return row
'''

NEW_DEF = MARKER + '''
#
# Removing a person is a soft delete: the row stays with deleted_at set and
# status still ACTIVE. Suspending sets status = 'SUSPENDED'; an invite not yet
# accepted is 'PENDING'. None of them may register or be rung. The decision is
# made here, in code, rather than in the SQL, so the log can say which it was.
def person_switch_refusal(row):
    """None when the person may use the phone; otherwise the reason, as the
    product names the state: REMOVED, SUSPENDED, PENDING, INACTIVE, EXPIRED."""
    if not row:
        return None
    if row.get("deleted_at"):
        return "REMOVED"
    status = str(row.get("status") or "").strip().upper()
    if status == "ACTIVE":
        return None
    return status or "UNKNOWN"


def lookup_sip_user(domain, username, action=""):
    username = re.sub(r'_(web|mobile|pstn)$', '', username)
    domain_part = domain.replace(f".{BASE_DOMAIN}", "")
    db_name = f"{DATABASE_PREFIX}{domain_part}"

    query = """
        SELECT u.extension, u.uuid, CONCAT(u.first_name, ' ', u.last_name) AS name,
               u.caller_id, u.company_uuid, u.password, u.status, u.deleted_at
        FROM users u
        JOIN companies c ON c.uuid = u.company_uuid
        WHERE c.db_name = %s AND u.extension = %s
        LIMIT 1
    """
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute(query, (db_name, username))
            row = cursor.fetchone()
        conn.close()
        refusal = person_switch_refusal(row)
        if refusal:
            log("info", f"person refused on the switch: ext={row['extension']}, state={refusal}, db_name={db_name}, action={action or 'lookup'}")
            return None
        if row:
            log("info", f"Found user: ext={row['extension']}, name={row['name']}, db_name={db_name}")
        else:
            log("warn", f"User not found: ext={username}, db_name={db_name}, domain={domain}")
        return row
'''

OLD_CALL = '''        if action in ("sip_auth", "user_call", "") and domain and user:
            row = lookup_sip_user(domain, user)
'''
NEW_CALL = '''        if action in ("sip_auth", "user_call", "") and domain and user:
            row = lookup_sip_user(domain, user, action)
'''

EDITS = (
    (OLD_DEF, NEW_DEF, "lookup_sip_user"),
    (OLD_CALL, NEW_CALL, "do_POST call site"),
)

for old, _new, label in EDITS:
    count = text.count(old)
    if count != 1:
        raise SystemExit("no single match for %s (found %d) - nothing written" % (label, count))

for old, new, _label in EDITS:
    text = text.replace(old, new)

backup = "%s.bak-person-states-%s" % (PATH, time.strftime("%Y%m%d-%H%M%S"))
shutil.copy2(PATH, backup)

with io.open(PATH, "w", encoding="utf-8") as handle:
    handle.write(text)

try:
    py_compile.compile(PATH, doraise=True)
except py_compile.PyCompileError as e:
    shutil.copy2(backup, PATH)
    raise SystemExit("patched file does not compile, original restored: %s" % e)

print("patched %s (backup %s)" % (PATH, os.path.basename(backup)))
