#!/usr/bin/env python3
"""Load FreeSWITCH CDR files into each tenant's call_history table.

FreeSWITCH writes one .cdr.xml per call LEG to /opt/call-recordings/cdr — a
bridged call is always two files (an internal/user-facing leg and a leg that
actually touches the phone network), cross-referencing each other's uuid via
<bridge_uuid>. Left unmerged, one real call showed up as two separate rows,
each carrying only half the truth: the carrier leg has the real external
number but a garbled "other side" (routing-prefixed for outbound, a WebRTC
session token for inbound); the user leg has the real agent name and a clean
number but a garbled "other side" the other way. This merges the pair into one
row using whichever leg actually knows each fact.

Design notes:
  * Routing is by company_uuid from the CDR, resolved against companies.db_name.
    The domain (sip_h_X-Domain / sip_from_host) is only a fallback, because some
    legs carry an IP host rather than a tenant domain.
  * Leg role (carrier vs user) is decided by whether either SIP host on the leg
    is a known carrier IP — NOT by the "a_" filename prefix, which flips which
    leg it labels depending on call direction (confirmed on real inbound vs
    outbound pairs). If both legs (or neither) look like the carrier, the pair
    is ambiguous and is left as two separate rows rather than guessed at.
  * Legs are correlated by <bridge_uuid> when present, falling back to
    <signal_bond> when it is not. bridge_uuid is only set once a call actually
    bridges (media connects) — a missed, cancelled, or failed call never gets
    one on either leg, so it could never be matched to its sibling and showed
    up as two permanently-separate rows (one of them showing a WebRTC session
    token like "s2bshi0f" as if it were a real number). signal_bond is set at
    call-SETUP time regardless of outcome, and is confirmed (on real declined
    and cancelled pairs) to point from one leg to the other's uuid the same
    way bridge_uuid does. bridge_uuid always wins when both are present, so
    every already-working bridged-call merge is completely unaffected by this
    - only calls that never bridged newly become matchable.
  * A leg with a correlation uuid whose partner hasn't arrived yet is inserted
    solo (with b_leg_uuid pointing at the expected partner) so the call is
    never invisible while waiting; when the partner file does arrive, it
    merges its facts into that same row instead of inserting a second one.
    b_leg_uuid is an existing, previously-unused column - no schema change.
  * The real end-reason for a failed/declined/cancelled call is decided by
    preferring whichever leg's hangup_cause is NOT the generic NORMAL_CLEARING
    (that is what the "innocent" side reports when its bridge partner is the
    one that actually hung up) — verified against real CALL_REJECTED and
    ORIGINATOR_CANCEL pairs. "Was it answered" is independent of hangup_cause:
    true if EITHER leg has a real answer_stamp.
  * Idempotent: a file whose own uuid is already recorded as a row's
    xml_cdr_uuid OR b_leg_uuid is treated as done, so a re-run cannot
    double-count or double-merge. Safe to run on a timer.
  * Files are moved, never deleted - processed/ or skipped/ - so nothing is
    lost and a bad run can be replayed.

Usage:  cdr_ingest.py [--apply] [--limit N]
        without --apply it parses and reports, writing nothing.
"""

import os
import re
import sys
import glob
import json
import shutil
import socket as socketlib
import urllib.parse
import xml.etree.ElementTree as ET

import pymysql

CDR_DIR = "/opt/call-recordings/cdr"
DONE_DIR = os.path.join(CDR_DIR, "processed")
SKIP_DIR = os.path.join(CDR_DIR, "skipped")
ENV_FILE = "/var/www/prod/default-api/.env"
BASE_DOMAIN = "mycountrymobile.com"
NATS_HOST, NATS_PORT = "127.0.0.1", 4222

# Fields the live-push payload carries - a subset of COLS plus the row id,
# shaped to match what the frontend's existing toCallRow() already reads from
# a report/phone-call-list row, so no separate parsing path is needed there.
PUSH_FIELDS = ["xml_cdr_uuid", "b_leg_uuid", "direction", "caller_id_number",
               "destination_number", "display_caller_number", "extension",
               "contact_name", "status", "hangup_cause", "start_stamp",
               "answer_stamp", "end_stamp", "duration", "billsec", "is_missed"]


def room_key_for(db_name):
    """The tenant-domain room every browser session already joins - derived
    from db_name rather than a leg's own domain_name field, which can be
    missing on carrier legs. Matches the "<id>.mycountrymobile.com" shape
    esl-manager and socket-presence-api already key rooms by."""
    tenant = db_name[4:] if db_name.startswith("mcm_") else db_name
    return f"{tenant}.{BASE_DOMAIN}"


def nats_publish(subject, payload_dict):
    """Minimal, dependency-free NATS publish (fire-and-forget, no nats-py
    dependency). Never raises - a failure here is a missed live-UI nudge, not
    a reason to fail call ingestion; the row is already durably written by
    the time this is called."""
    try:
        data = json.dumps(payload_dict).encode("utf-8")
        with socketlib.create_connection((NATS_HOST, NATS_PORT), timeout=1.0) as sock:
            sock.settimeout(1.0)
            sock.recv(4096)  # drain the server's INFO line
            sock.sendall(b'CONNECT {"verbose":false,"pedantic":false}\r\n')
            sock.sendall(f"PUB {subject} {len(data)}\r\n".encode("utf-8") + data + b"\r\n")
    except Exception as exc:
        print(f"  [live push failed, non-fatal]: {exc}")


def push_call_update(db, row_id, fields):
    payload = {k: fields.get(k) for k in PUSH_FIELDS}
    payload["id"] = row_id
    nats_publish("socket.emitRoom", {
        "socketId": room_key_for(db),
        "emitter": "call-history-updated",
        "payload": payload,
    })

# Signaling IPs of carriers this platform actually uses. A leg touching one of
# these on either side is the carrier-facing leg of the pair. Extend this set
# if a new carrier/trunk host shows up - see [[didww-inbound-routing]].
CARRIER_HOSTS = {
    "46.19.210.19", "46.19.209.14", "46.19.210.14", "46.19.212.14", "46.19.213.14",  # DIDWW
    "38.147.130.91", "54.229.21.111",  # 46 Labs
}


def load_env(path):
    env = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def connect(env, db=None):
    return pymysql.connect(
        host=env["DB_HOST"], port=int(env.get("DB_PORT", 3306)),
        user=env["DB_USER"], password=env["DB_PASSWORD"],
        database=db or env["DB_NAME"], charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor, autocommit=True,
        ssl={"ssl": {}},
    )


def dec(v):
    """CDR values are URL-encoded: '2026-09-01%2008%3A41%3A17', 'sushil%20yadav'."""
    if v is None:
        return None
    return urllib.parse.unquote_plus(v)


def field(root, name):
    el = root.find(f".//{name}")
    if el is None or el.text is None:
        return None
    val = dec(el.text).strip()
    return val or None


def cut(v, n):
    """Columns are narrow (caller_id_number is varchar(16)); never overflow."""
    if v is None:
        return None
    return v[:n]


def parse(path):
    """Full raw leg data: DB-column fields plus the extra facts (caller name,
    SIP hosts, signal_bond) needed to classify and merge the pair. Extra keys
    are simply ignored by the COLS-driven insert/update."""
    root = ET.parse(path).getroot()
    g = lambda n: field(root, n)

    uuid = g("uuid")
    if not uuid:
        return None

    domain = g("sip_h_X-Domain") or g("sip_from_host") or g("sip_to_host")
    if domain and not re.match(r"^\d+\.[a-z]", domain):
        domain = None  # an IP host, not a tenant

    start, answer, end = g("start_stamp"), g("answer_stamp"), g("end_stamp")
    hangup = g("hangup_cause")
    direction = (g("direction") or "").capitalize() or None

    # The report screen groups calls by display_caller_number (the other
    # party's number). Leaving it null collapses every call into one row.
    # This is the single-leg fallback, used when a pair can't be merged.
    display_caller_number = None
    if direction == "Inbound":
        display_caller_number = g("caller_id_number")
    elif direction == "Outbound":
        display_caller_number = g("destination_number")

    # A call that never got an answer_stamp was not picked up.
    answered = bool(answer)
    status = "COMPLETED" if answered else (hangup or "NO_ANSWER")

    bridge_uuid = cut(g("bridge_uuid"), 36)
    signal_bond = cut(g("signal_bond"), 36)

    return {
        "xml_cdr_uuid": cut(uuid, 36),
        "domain_name": cut(domain, 50),
        "accountcode": cut(g("company_uuid") or g("accountcode"), 50),
        "context": cut(g("context"), 20),
        "direction": cut(direction, 10),
        "caller_id_number": cut(g("caller_id_number"), 16),
        "destination_number": cut(g("destination_number"), 100),
        "extension": cut(g("caller_id_number"), 16),
        "start_stamp": start,
        "answer_stamp": answer,
        "end_stamp": end,
        "duration": int(g("duration") or 0),
        "billsec": int(g("billsec") or 0),
        "hangup_cause": cut(hangup, 20),
        "sipcall_id": cut(g("sip_call_id") or uuid, 40),
        "is_missed": 0 if answered else 1,
        "is_voicemail": 0,
        "status": cut(status, 30),
        "bridge_uuid": bridge_uuid,
        "display_caller_number": cut(display_caller_number, 16),
        "contact_name": cut(g("caller_id_name"), 30),
        "b_leg_uuid": None,
        # not DB columns - used only for leg classification / correlation
        "_sip_from_host": g("sip_from_host"),
        "_sip_to_host": g("sip_to_host"),
        # the uuid to look for a partner by: bridge_uuid only exists once a
        # call actually connects, so a call that never bridged falls back to
        # signal_bond, which is set at call setup regardless of outcome.
        "_correlation_uuid": bridge_uuid or signal_bond,
    }


COLS = ["xml_cdr_uuid", "domain_name", "accountcode", "context", "direction",
        "caller_id_number", "destination_number", "extension", "start_stamp",
        "answer_stamp", "end_stamp", "duration", "billsec", "hangup_cause",
        "sipcall_id", "is_missed", "is_voicemail", "status", "bridge_uuid",
        "display_caller_number", "contact_name", "b_leg_uuid"]

# Fields a merge is allowed to overwrite on the already-inserted row.
MERGE_COLS = ["direction", "caller_id_number", "destination_number",
              "display_caller_number", "extension", "contact_name",
              "start_stamp", "answer_stamp", "end_stamp", "duration",
              "billsec", "hangup_cause", "status", "is_missed"]


def leg_role(leg):
    if leg["_sip_from_host"] in CARRIER_HOSTS or leg["_sip_to_host"] in CARRIER_HOSTS:
        return "carrier"
    return "user"


def merge_fields(carrier, user):
    """Combine one carrier-facing leg and one user-facing leg of the same
    call into the single row the UI should show."""
    direction = carrier["direction"] or user["direction"]

    if direction == "Inbound":
        caller_id_number = carrier["caller_id_number"]
        destination_number = carrier["destination_number"]
        display_caller_number = carrier["caller_id_number"]
    else:  # Outbound
        caller_id_number = carrier["caller_id_number"]
        destination_number = user["destination_number"]
        display_caller_number = user["destination_number"]

    extension = (user["caller_id_number"] or "").replace("_web", "") or None
    contact_name = user["contact_name"] or carrier["contact_name"]

    starts = [s for s in [carrier["start_stamp"], user["start_stamp"]] if s]
    ends = [e for e in [carrier["end_stamp"], user["end_stamp"]] if e]
    answers = [a for a in [carrier["answer_stamp"], user["answer_stamp"]] if a]
    start_stamp = min(starts) if starts else None
    end_stamp = max(ends) if ends else None
    answer_stamp = min(answers) if answers else None
    answered = bool(answer_stamp)

    # The real reason it ended: whichever side isn't the generic teardown
    # NORMAL_CLEARING is the one that actually explains it (declined,
    # cancelled, busy, no route, temporary failure).
    c_cause, u_cause = carrier["hangup_cause"], user["hangup_cause"]
    if c_cause and c_cause != "NORMAL_CLEARING":
        hangup_cause = c_cause
    elif u_cause and u_cause != "NORMAL_CLEARING":
        hangup_cause = u_cause
    else:
        hangup_cause = c_cause or u_cause

    status = "COMPLETED" if answered else (hangup_cause or "NO_ANSWER")
    duration = max(carrier["duration"] or 0, user["duration"] or 0)
    billsec = max(carrier["billsec"] or 0, user["billsec"] or 0)

    return {
        "direction": cut(direction, 10),
        "caller_id_number": cut(caller_id_number, 16),
        "destination_number": cut(destination_number, 100),
        "display_caller_number": cut(display_caller_number, 16),
        "extension": cut(extension, 16),
        "contact_name": cut(contact_name, 30),
        "start_stamp": start_stamp,
        "answer_stamp": answer_stamp,
        "end_stamp": end_stamp,
        "duration": duration,
        "billsec": billsec,
        "hangup_cause": cut(hangup_cause, 20),
        "status": cut(status, 30),
        "is_missed": 0 if answered else 1,
    }


def find_leg_file(uuid):
    matches = glob.glob(os.path.join(DONE_DIR, f"*{uuid}*.cdr.xml"))
    return matches[0] if matches else None


def main():
    apply_ = "--apply" in sys.argv
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    env = load_env(ENV_FILE)
    main_db = connect(env)

    with main_db.cursor() as cur:
        cur.execute("select uuid, db_name from companies where db_name is not null and db_name <> ''")
        by_uuid = {r["uuid"]: r["db_name"] for r in cur.fetchall()}

    files = sorted(glob.glob(os.path.join(CDR_DIR, "*.cdr.xml")))
    if limit:
        files = files[:limit]

    stats = {"inserted": 0, "merged": 0, "already": 0, "no_tenant": 0, "bad": 0}
    conns = {}

    for path in files:
        try:
            row = parse(path)
        except Exception as exc:
            print(f"  unparsable {os.path.basename(path)}: {exc}")
            stats["bad"] += 1
            continue
        if not row:
            stats["bad"] += 1
            continue

        db = by_uuid.get(row["accountcode"] or "")
        if not db and row["domain_name"]:
            tenant = row["domain_name"].split(".")[0]
            cand = f"mcm_{tenant}"
            if cand in set(by_uuid.values()):
                db = cand
        if not db:
            stats["no_tenant"] += 1
            if apply_:
                os.makedirs(SKIP_DIR, exist_ok=True)
                shutil.move(path, os.path.join(SKIP_DIR, os.path.basename(path)))
            continue

        if db not in conns:
            conns[db] = connect(env, db)
        conn = conns[db]

        with conn.cursor() as cur:
            cur.execute(
                "select 1 from call_history where xml_cdr_uuid = %s or b_leg_uuid = %s limit 1",
                (row["xml_cdr_uuid"], row["xml_cdr_uuid"]),
            )
            if cur.fetchone():
                stats["already"] += 1
                if apply_:
                    os.makedirs(DONE_DIR, exist_ok=True)
                    shutil.move(path, os.path.join(DONE_DIR, os.path.basename(path)))
                continue

            partner_row = None
            partner_raw = None
            if row["_correlation_uuid"]:
                cur.execute(
                    "select * from call_history where xml_cdr_uuid = %s limit 1",
                    (row["_correlation_uuid"],),
                )
                partner_row = cur.fetchone()
                if partner_row:
                    partner_path = find_leg_file(row["_correlation_uuid"])
                    if partner_path:
                        try:
                            partner_raw = parse(partner_path)
                        except Exception:
                            partner_raw = None

            if partner_row and partner_raw:
                role_incoming = leg_role(row)
                role_partner = leg_role(partner_raw)
                if {role_incoming, role_partner} == {"carrier", "user"}:
                    carrier = row if role_incoming == "carrier" else partner_raw
                    user = row if role_incoming == "user" else partner_raw
                    merged = merge_fields(carrier, user)
                    if apply_:
                        set_clause = ", ".join(f"`{c}` = %s" for c in MERGE_COLS)
                        cur.execute(
                            f"update call_history set {set_clause}, `b_leg_uuid` = %s where xml_cdr_uuid = %s",
                            [merged[c] for c in MERGE_COLS] + [row["xml_cdr_uuid"], row["_correlation_uuid"]],
                        )
                        os.makedirs(DONE_DIR, exist_ok=True)
                        shutil.move(path, os.path.join(DONE_DIR, os.path.basename(path)))
                        push_call_update(db, partner_row["id"],
                                          {**merged, "xml_cdr_uuid": row["_correlation_uuid"],
                                           "b_leg_uuid": row["xml_cdr_uuid"]})
                    stats["merged"] += 1
                    continue
                # ambiguous role pairing (both carrier or both user) - fall
                # through to a plain solo insert rather than guess a merge

            # b_leg_uuid stays NULL on a solo insert - pre-filling it with the
            # expected partner's uuid made the idempotency check below treat
            # the REAL partner's arrival as "already present" and skip the
            # merge entirely, permanently stranding the call as two rows (or
            # one row stuck with raw, unmerged leg data). xml_cdr_uuid alone
            # already prevents a re-processed file from double-counting.
            if apply_:
                cols = ", ".join(f"`{c}`" for c in COLS)
                marks = ", ".join(["%s"] * len(COLS))
                cur.execute(f"insert into call_history ({cols}) values ({marks})",
                            [row[c] for c in COLS])
                os.makedirs(DONE_DIR, exist_ok=True)
                shutil.move(path, os.path.join(DONE_DIR, os.path.basename(path)))
                push_call_update(db, cur.lastrowid, row)
            stats["inserted"] += 1

    verb = "inserted" if apply_ else "would insert"
    mverb = "merged" if apply_ else "would merge"
    print(f"  files seen:        {len(files)}")
    print(f"  {verb}:{' ' * (17 - len(verb))}{stats['inserted']}")
    print(f"  {mverb}:{' ' * (17 - len(mverb))}{stats['merged']}")
    print(f"  already present:   {stats['already']}")
    print(f"  no tenant (skipped): {stats['no_tenant']}")
    print(f"  unparsable:        {stats['bad']}")
    if not apply_:
        print("  DRY RUN - nothing written, no files moved")


if __name__ == "__main__":
    main()
