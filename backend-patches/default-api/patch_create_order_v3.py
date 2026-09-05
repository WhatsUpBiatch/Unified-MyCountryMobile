"""Move the real number purchase onto DIDWW v3, so buying a number works.

Applied to the COMPILED dist/controllers/DID/DidwwControllerOwn.js on api2.

The bug
-------
`createOrderInternal` - the function the paid purchase path actually calls
(`DidController.buyVirtualDid` -> `createOrderInternal`) - POSTed to
`${DID_WW_URL}order`, which is the old in-house wholesale dialect. Against
DIDWW v3 that path does not exist:

    GET /v3/order   -> 404 Route Not Found
    GET /v3/orders  -> 200

so every purchase threw and was logged as
"Sorry, we are unable to process your request at the moment." in
`wholesale_api_logs` (ids 60-64 on 3 Sep). This is the same class of bug as
`reservation`, fixed earlier the same day - the v3 migration simply missed
several call sites.

Confusingly, `didHelper.placeDidOrder` in the SAME codebase already builds a
correct v3 order. It is used by other paths; `createOrderInternal` never
called it. This patch makes `createOrderInternal` speak v3 directly, in the
same JSON:API shape:

    { data: { type: "orders",
              attributes: { allow_back_ordering: false,
                            items: [ { type: "did_order_items",
                                       attributes: { available_did_id, sku_id } } ] } } }

v3 needs a `sku_id` per number, which the old dialect did not, so each id is
resolved through `findDID` first - the same helper the rest of the purchase
path uses.

The old payload's `callback_url`, `smsEnabled`, `campaignId` and `a2p` are
in-house extras with no v3 equivalent. They are dropped from the request but
kept in the audit row, so the log still records what was asked for.

Header note, the easy thing to miss: v3 wants `WW_HEADER`
(`application/vnd.api+json`), not the plain-JSON `WW_HEADER2` the old dialect
used.
"""

import io
import sys

TARGET_DEFAULT = "/var/www/prod/default-api/dist/controllers/DID/DidwwControllerOwn.js"

OLD = """            try {
                const response = yield axios_1.default.post(`${wwConfig_1.DID_WW_URL}order`, payload, { headers: didHelper_1.WW_HEADER2 });
                yield WholesaleApiLog_1.default.create({
                    user_uuid: userData.uuid,
                    company_uuid: userData.company_uuid,
                    action: "createOrderInternal",
                    request_payload: payload,
                    response_payload: response.data,
                    success: true,
                });
                return response.data;
            }"""

NEW = """            try {
                // v3 orders, not the old in-house `order` path - see the patch
                // header. Each number needs its SKU, which only findDID knows.
                const wantedIds = (Array.isArray(available_did_id) ? available_did_id : [available_did_id])
                    .map((v) => String(v || "").trim())
                    .filter(Boolean);
                if (!wantedIds.length) {
                    throw new Error("No numbers were selected to order.");
                }
                const orderItems = [];
                for (const wantedId of wantedIds) {
                    const found = yield (0, didHelper_1.findDID)(wantedId);
                    if (!found || !found.sku) {
                        throw new Error("That number is no longer available. Please choose another.");
                    }
                    orderItems.push({
                        type: "did_order_items",
                        attributes: { available_did_id: wantedId, sku_id: found.sku },
                    });
                }
                const v3Payload = {
                    data: {
                        type: "orders",
                        attributes: { allow_back_ordering: false, items: orderItems },
                    },
                };
                // WW_HEADER, not WW_HEADER2: v3 speaks application/vnd.api+json.
                const response = yield axios_1.default.post(`${wwConfig_1.DID_WW_URL}orders`, v3Payload, { headers: didHelper_1.WW_HEADER });
                yield WholesaleApiLog_1.default.create({
                    user_uuid: userData.uuid,
                    company_uuid: userData.company_uuid,
                    action: "createOrderInternal",
                    // The original payload is kept in the audit row so the log
                    // still shows what the product asked for, including the
                    // in-house extras v3 has no place for.
                    request_payload: Object.assign({}, payload, { v3: v3Payload }),
                    response_payload: response.data,
                    success: true,
                });
                // The caller checks `information.status === 200` and
                // `information.data.length`, which the old dialect returned.
                // v3 answers with a single order document, so it is reshaped
                // here rather than loosening the check at the call site.
                const created = (response.data && response.data.data) || null;
                return { status: 200, data: created ? [created] : [], order: response.data };
            }"""


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_DEFAULT
    text = io.open(target, encoding="utf-8").read()

    if "type: \"orders\"" in text and "createOrderInternal" in text and "v3Payload" in text:
        raise SystemExit("already applied")

    count = text.count(OLD)
    if count != 1:
        raise SystemExit("anchor matched %d times, expected 1" % count)

    io.open(target, "w", encoding="utf-8").write(text.replace(OLD, NEW))
    print("patched %s" % target)


if __name__ == "__main__":
    main()
