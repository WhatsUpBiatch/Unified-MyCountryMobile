#!/usr/bin/env python3
"""One-time backfill: merge existing unmerged call_history pairs that never
bridged (bridge_uuid empty on both legs) using signal_bond, re-parsed from
each row's original CDR file since signal_bond isn't a stored DB column.

Usage: backfill-signal-bond.py [--apply]
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

    totals = {"merged": 0, "ambiguous": 0, "no_partner": 0, "missing_file": 0}

    for db in dbs:
        conn = cdr.connect(env, db)
        with conn.cursor() as cur:
            # candidates: rows the ingester wrote (has xml_cdr_uuid), never merged
            # (b_leg_uuid is null), and never bridged (bridge_uuid empty) - those
            # are exactly the ones last time's bridge_uuid-only backfill could not
            # have touched.
            cur.execute("""
                select id, xml_cdr_uuid from call_history
                where b_leg_uuid is null
                  and xml_cdr_uuid is not null and xml_cdr_uuid <> ''
                  and (bridge_uuid is null or bridge_uuid = '')
            """)
            candidates = {r["xml_cdr_uuid"]: r["id"] for r in cur.fetchall()}

        if not candidates:
            continue

        # re-parse each candidate's original file to get its correlation uuid
        parsed = {}
        for uuid in list(candidates):
            path = cdr.find_leg_file(uuid)
            if not path:
                continue
            try:
                parsed[uuid] = cdr.parse(path)
            except Exception:
                continue

        done = set()
        pairs = []
        for uuid, leg in parsed.items():
            if uuid in done:
                continue
            corr = leg["_correlation_uuid"]
            if not corr or corr not in candidates or corr not in parsed:
                continue
            if corr in done:
                continue
            pairs.append((uuid, corr))
            done.add(uuid)
            done.add(corr)

        if not pairs:
            continue

        print(f"-- {db}: {len(pairs)} newly-correlatable pair(s) --")
        for uuid_a, uuid_b in pairs:
            leg_a, leg_b = parsed[uuid_a], parsed[uuid_b]
            role_a, role_b = cdr.leg_role(leg_a), cdr.leg_role(leg_b)
            id_a, id_b = candidates[uuid_a], candidates[uuid_b]
            if {role_a, role_b} != {"carrier", "user"}:
                print(f"  id {id_a}/{id_b}: SKIP, ambiguous roles ({role_a}, {role_b})")
                totals["ambiguous"] += 1
                continue

            carrier = leg_a if role_a == "carrier" else leg_b
            user = leg_a if role_a == "user" else leg_b
            merged = cdr.merge_fields(carrier, user)
            keep_id, drop_id = min(id_a, id_b), max(id_a, id_b)
            drop_uuid = uuid_b if keep_id == id_a else uuid_a

            print(f"  id {keep_id} <- merge id {drop_id}: dir={merged['direction']} "
                  f"caller={merged['caller_id_number']} dest={merged['destination_number']} "
                  f"display={merged['display_caller_number']} status={merged['status']}")

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
    if not APPLY:
        print("DRY RUN - nothing written")


if __name__ == "__main__":
    main()
