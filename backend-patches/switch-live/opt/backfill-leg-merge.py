#!/usr/bin/env python3
"""One-time backfill: merge existing unmerged bridge_uuid pairs in call_history
(inserted by cdr-ingest.py before it could merge legs) using the same
carrier/user classification and merge_fields() logic as the live ingester.

Usage: backfill-leg-merge.py [--apply]
       without --apply it reports what it would do, writing nothing.
"""
import sys
import importlib.util

sys.path.insert(0, "/opt")
spec = importlib.util.spec_from_file_location("cdr_ingest", "/opt/cdr-ingest.py")
cdr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdr)

APPLY = "--apply" in sys.argv


def main():
    env = cdr.load_env(cdr.ENV_FILE)
    main_db = cdr.connect(env)
    with main_db.cursor() as cur:
        cur.execute("select uuid, db_name from companies where db_name is not null and db_name <> ''")
        dbs = sorted({r["db_name"] for r in cur.fetchall()})

    totals = {"merged": 0, "ambiguous": 0, "missing_file": 0}

    for db in dbs:
        conn = cdr.connect(env, db)
        with conn.cursor() as cur:
            cur.execute("""
                select a.id as id_a, a.xml_cdr_uuid as uuid_a, a.bridge_uuid as bridge_a,
                       b.id as id_b, b.xml_cdr_uuid as uuid_b
                from call_history a
                join call_history b on a.bridge_uuid = b.xml_cdr_uuid
                where a.b_leg_uuid is null and b.b_leg_uuid is null
                  and a.bridge_uuid is not null and a.bridge_uuid <> ''
                  and a.id < b.id
            """)
            pairs = cur.fetchall()

        if not pairs:
            continue

        print(f"-- {db}: {len(pairs)} unmerged pair(s) --")
        for p in pairs:
            file_a = cdr.find_leg_file(p["uuid_a"])
            file_b = cdr.find_leg_file(p["uuid_b"])
            if not file_a or not file_b:
                print(f"  id {p['id_a']}/{p['id_b']}: SKIP, original file missing "
                      f"(a={file_a is not None} b={file_b is not None})")
                totals["missing_file"] += 1
                continue

            leg_a, leg_b = cdr.parse(file_a), cdr.parse(file_b)
            role_a, role_b = cdr.leg_role(leg_a), cdr.leg_role(leg_b)
            if {role_a, role_b} != {"carrier", "user"}:
                print(f"  id {p['id_a']}/{p['id_b']}: SKIP, ambiguous roles ({role_a}, {role_b})")
                totals["ambiguous"] += 1
                continue

            carrier = leg_a if role_a == "carrier" else leg_b
            user = leg_a if role_a == "user" else leg_b
            merged = cdr.merge_fields(carrier, user)
            keep_id, drop_id = p["id_a"], p["id_b"]
            keep_uuid, drop_uuid = p["uuid_a"], p["uuid_b"]

            print(f"  id {keep_id} <- merge id {drop_id}: dir={merged['direction']} "
                  f"caller={merged['caller_id_number']} dest={merged['destination_number']} "
                  f"name={merged['contact_name']} status={merged['status']}")

            if APPLY:
                with conn.cursor() as cur:
                    set_clause = ", ".join(f"`{c}` = %s" for c in cdr.MERGE_COLS)
                    cur.execute(
                        f"update call_history set {set_clause}, `b_leg_uuid` = %s where id = %s",
                        [merged[c] for c in cdr.MERGE_COLS] + [drop_uuid, keep_id],
                    )
                    cur.execute("delete from call_history where id = %s", (drop_id,))
            totals["merged"] += 1

    print()
    print(f"merged:        {totals['merged']}")
    print(f"ambiguous:     {totals['ambiguous']}")
    print(f"missing file:  {totals['missing_file']}")
    if not APPLY:
        print("DRY RUN - nothing written")


if __name__ == "__main__":
    main()
