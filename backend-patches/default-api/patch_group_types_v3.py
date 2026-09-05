"""Move the DID Type list onto DIDWW v3, so picking a country works again.

Applied to the COMPILED dist/controllers/DID/DidwwControllerOwn.js on api2.

The bug
-------
`groupTypes` POSTed to `${DID_WW_URL}group/type`, the old in-house wholesale
dialect. On v3 that path does not exist, so DIDWW answered 404, the catch
turned it into `sendError`, and the browser showed
"Something went wrong (422)" the moment a country was chosen - before any
number could be picked. Seen in nginx as:

    GET /api/didw/group-types?country_iso=US -> 422

Same class of bug as `reservation` and `createOrderInternal`, both fixed the
same day: the v3 migration missed several call sites.

v3 exposes the list as `did_group_types` (Global, Local, Mobile, National,
Shared Cost, Toll-free) and the shape the screen needs is `{ id, name }`,
which is exactly what `attributes.name` gives.

One difference worth stating: the old endpoint took a `country_iso` and the v3
resource is a single global list, so the country is no longer part of this
request. Nothing downstream breaks - the next call
(`did_groups`, in `groupList`) already filters by country AND type, so a type
with no numbers in that country simply shows an empty table rather than a
wrong one. Narrowing the list properly would mean walking every did_group for
the country, which for the US is dozens of requests to populate one dropdown.

The list is the same for everybody and changes about never, so it is cached in
process for an hour.
"""

import io
import sys

TARGET_DEFAULT = "/var/www/prod/default-api/dist/controllers/DID/DidwwControllerOwn.js"

OLD = """                const response = yield axios_1.default.post(`${wwConfig_1.DID_WW_URL}group/type`, { country_iso }, {
                    headers: didHelper_1.WW_HEADER2,"""

NEW = """                // v3: a single global `did_group_types` list. See the patch
                // header for why the country is no longer sent.
                void country_iso;
                const nowMs = Date.now();
                if (DidwwControllerOwn._groupTypeCache &&
                    (nowMs - DidwwControllerOwn._groupTypeCache.at) < 3600000) {
                    return _super.sendSuccess.call(this, res, globalResponse_1.default.SUCCESS, { rows: DidwwControllerOwn._groupTypeCache.rows });
                }
                const gtResp = yield axios_1.default.get(`${wwConfig_1.DID_WW_URL}did_group_types`, {
                    headers: didHelper_1.WW_HEADER,
                    params: { "page[size]": 100 },
                });
                const gtRows = (gtResp.data.data || []).map((g) => ({
                    id: g.id,
                    name: ((g.attributes || {}).name) || "",
                }));
                DidwwControllerOwn._groupTypeCache = { rows: gtRows, at: nowMs };
                return _super.sendSuccess.call(this, res, globalResponse_1.default.SUCCESS, { rows: gtRows });
                // eslint-disable-next-line no-unreachable
                const response = yield axios_1.default.post(`${wwConfig_1.DID_WW_URL}group/type`, { country_iso }, {
                    headers: didHelper_1.WW_HEADER2,"""

CACHE_INIT = "DidwwControllerOwn._groupTypeCache = null;\n"


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_DEFAULT
    text = io.open(target, encoding="utf-8").read()

    if "_groupTypeCache" in text:
        raise SystemExit("already applied")

    count = text.count(OLD)
    if count != 1:
        raise SystemExit("anchor matched %d times, expected 1" % count)
    text = text.replace(OLD, NEW)

    marker = "exports.default ="
    at = text.rindex(marker)
    text = text[:at] + CACHE_INIT + text[at:]

    io.open(target, "w", encoding="utf-8").write(text)
    print("patched %s" % target)


if __name__ == "__main__":
    main()
