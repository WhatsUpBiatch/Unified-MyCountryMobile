"""Move DID reservation onto DIDWW v3, so "Add Number" stops returning 422.

Applied to the COMPILED dist/controllers/DID/DidwwControllerOwn.js on api2.

Why this exists
---------------
Most of this controller was migrated to DIDWW's v3 API, but `reservation` was
not: it still POSTs to `${DID_WW_URL}reservation`, which is the old in-house
wholesale dialect. Against v3 that path does not exist, so DIDWW answers
`404 Route Not Found`, the catch block turns it into `sendError`, and the
browser shows "Something went wrong (422)" the moment you press Add Number.

Confirmed against the live API with the account's own key:

    GET /v3/did_reservations  -> 200
    GET /v3/reservation       -> 404 Route Not Found

v3 reserves ONE available_did per reservation, as a JSON:API document:

    { "data": { "type": "did_reservations",
                "relationships": { "available_did": {
                    "data": { "type": "available_dids", "id": "<id>" } } } } }

The screen sends `available_did_id` as an ARRAY (it lets you tick more than one
number), so this loops and returns a row per reservation. `country_iso` is
still accepted and ignored - v3 does not need it, and the screen still sends
it.

Note the header swap: v3 wants `application/vnd.api+json` (WW_HEADER), not the
plain JSON `WW_HEADER2` the old dialect used.

Still on the old dialect after this patch, and still broken for the same
reason - each needs its own migration:
  * `reservationQuantity` -> POST reservation/quantity
  * `release`             -> POST release
  * `createOrderNEW`      -> POST order   (v3: POST orders)
  * `list`                -> POST number/list  (v3: GET dids)
Separately, the real purchase path `createOrder` has its provider call
commented out entirely, so a paid order never reaches DIDWW.
"""

import io
import sys

TARGET_DEFAULT = "/var/www/prod/default-api/dist/controllers/DID/DidwwControllerOwn.js"

OLD = '''                const { available_did_id, country_iso } = req.body;
                const response = yield axios_1.default.post(`${wwConfig_1.DID_WW_URL}reservation`, {
                    available_did_id, country_iso //send in body
                }, {
                    headers: didHelper_1.WW_HEADER2,
                });
                const regions = response.data.data;
                return _super.sendSuccess.call(this, res, globalResponse_1.default.SUCCESS, { rows: regions });'''

NEW = '''                const { available_did_id } = req.body;
                // v3 reserves one available_did per reservation, and the screen
                // sends an array because it lets you tick more than one number.
                const didIds = (Array.isArray(available_did_id)
                    ? available_did_id
                    : (available_did_id ? [available_did_id] : []))
                    .map((v) => String(v || "").trim())
                    .filter(Boolean);
                if (!didIds.length) {
                    return _super.sendError.call(this, res, "No numbers were selected to reserve.");
                }
                const reservations = [];
                for (const didId of didIds) {
                    const body = {
                        data: {
                            type: "did_reservations",
                            relationships: {
                                available_did: { data: { type: "available_dids", id: didId } },
                            },
                        },
                    };
                    // WW_HEADER, not WW_HEADER2: v3 speaks application/vnd.api+json.
                    const rsp = yield axios_1.default.post(`${wwConfig_1.DID_WW_URL}did_reservations`, body, {
                        headers: didHelper_1.WW_HEADER,
                    });
                    const created = (rsp.data && rsp.data.data) || {};
                    const attrs = created.attributes || {};
                    reservations.push({
                        id: created.id,
                        reservation_id: created.id,
                        available_did_id: didId,
                        expire_at: attrs.expire_at,
                        expires_at: attrs.expire_at,
                    });
                }
                return _super.sendSuccess.call(this, res, globalResponse_1.default.SUCCESS, { rows: reservations });'''


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_DEFAULT
    text = io.open(target, encoding="utf-8").read()

    if "did_reservations" in text:
        raise SystemExit("already applied - did_reservations is present")

    count = text.count(OLD)
    if count != 1:
        raise SystemExit("reservation anchor matched %d times, expected 1" % count)

    io.open(target, "w", encoding="utf-8").write(text.replace(OLD, NEW))
    print("patched %s" % target)


if __name__ == "__main__":
    main()
