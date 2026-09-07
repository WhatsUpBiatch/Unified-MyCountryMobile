"""Show every NPA-NXX prefix for a region, formatted as "(205) 419".

Applied to the COMPILED dist/controllers/DID/DidwwControllerOwn.js on api2.

Why this exists
---------------
The "Area Code" field asked DIDWW for `nanpa_prefixes` with `page[size]: 100`
and took whatever came back. Two consequences:

  * A region with more than 100 prefixes lost the rest. Alabama has 413 and its
    first 100 are ALL in area code 205, so 251/256/334/659 sat on pages 2-5
    where nothing ever looked. Hawaii worked only because it has 53 and fitted
    on one page.
  * `groupList` read `nanpa_prefix_id` off the request and never used it, so
    choosing an area code changed nothing in the table underneath.

DIDWW caps `page[size]` at 100 - asking for 200 is a 400 "size exceeds maximum
page size of 100" - so a big region genuinely needs many requests: California
has 4100 prefixes, or 41 pages. Pages are therefore fetched 8 at a time and the
finished list is cached per region for five minutes.

The row `id` is deliberately the digits ("205419") rather than DIDWW's internal
prefix id: nothing downstream wants that id, and `groupList` needs the area code
back out of the value to filter on.
"""

import io
import sys

TARGET_DEFAULT = "/var/www/prod/default-api/dist/controllers/DID/DidwwControllerOwn.js"

PREFIX_BLOCK_START = "                // Area codes now come from did_groups, not nanpa_prefixes."
PREFIX_BLOCK_END = (
    "                return _super.sendSuccess.call(this, res, "
    "globalResponse_1.default.SUCCESS, { rows: regions });"
)

NEW_PREFIX_BODY = '''                // Every NPA-NXX prefix for this region, shown as "(205) 419".
                //
                // DIDWW caps page[size] at 100, and a big region has thousands
                // - California alone has 4100, so 41 requests. The previous
                // version asked for one page and stopped, which is why Alabama
                // only ever offered 205: its first 100 prefixes are all in that
                // area code and the rest sat on pages nothing ever fetched.
                //
                // Pages are fetched 8 at a time rather than one after another,
                // and the finished list is cached per region for five minutes,
                // so reopening the dropdown or reselecting a state costs
                // nothing.
                const cacheKey = String(country_iso || "") + "|" + String(region_id || "");
                const cachedPrefixes = DidwwControllerOwn._prefixCache.get(cacheKey);
                if (cachedPrefixes && (Date.now() - cachedPrefixes.at) < 300000) {
                    return _super.sendSuccess.call(this, res, globalResponse_1.default.SUCCESS, { rows: cachedPrefixes.rows });
                }
                const baseParams = Object.assign({ "page[size]": 100 }, region_id ? { "filter[region.id]": region_id } : {});
                const fetchPrefixPage = (pageNo) => axios_1.default
                    .get(wwConfig_1.DID_WW_URL + "nanpa_prefixes", {
                        headers: didHelper_1.WW_HEADER,
                        params: Object.assign({}, baseParams, { "page[number]": pageNo }),
                    })
                    .then((r) => r.data)
                    .catch(() => ({ data: [] }));

                const firstPage = yield fetchPrefixPage(1);
                const totalRecords = Number(((firstPage.meta || {}).total_records) || 0);
                // 200 pages is 20000 prefixes - far above any real region, and a
                // hard stop so a surprising total can never spin forever.
                const totalPages = Math.min(Math.ceil(totalRecords / 100) || 1, 200);

                const collectedPrefixes = (firstPage.data || []).slice();
                const PREFIX_CONCURRENCY = 8;
                for (let nextPage = 2; nextPage <= totalPages; nextPage += PREFIX_CONCURRENCY) {
                    const batchNumbers = [];
                    for (let n = nextPage; n < nextPage + PREFIX_CONCURRENCY && n <= totalPages; n++) {
                        batchNumbers.push(n);
                    }
                    const pages = yield Promise.all(batchNumbers.map(fetchPrefixPage));
                    pages.forEach((pg) => { collectedPrefixes.push.apply(collectedPrefixes, (pg.data || [])); });
                }

                const regions = collectedPrefixes
                    .map((r) => {
                        const a = r.attributes || {};
                        const npa = String(a.npa || "").trim();
                        const nxx = String(a.nxx || "").trim();
                        const digits = npa + nxx;
                        const pretty = (npa && nxx) ? ("(" + npa + ") " + nxx) : digits;
                        return {
                            // The digits, not DIDWW's internal row id: nothing
                            // downstream wants that id, and groupList needs the
                            // area code back out of this value to filter on.
                            id: digits,
                            npa: npa,
                            nxx: nxx,
                            npanxx: pretty,
                            digits: digits,
                            prefix: digits,
                            name: pretty,
                        };
                    })
                    .filter((r) => r.digits)
                    .sort((a, b) => a.digits.localeCompare(b.digits));

                DidwwControllerOwn._prefixCache.set(cacheKey, { rows: regions, at: Date.now() });
                return _super.sendSuccess.call(this, res, globalResponse_1.default.SUCCESS, { rows: regions });'''

OLD_GROUP_FILTER = '''                const wantedPrefix = String(nanpa_prefix_id || "").trim();
                const matching = wantedPrefix
                    ? collected.filter((g) => String(((g.attributes || {}).prefix) || "").trim() === wantedPrefix)
                    : collected;'''

NEW_GROUP_FILTER = '''                // The dropdown sends 6 digits (NPA + NXX) but did_groups are
                // area-code level, so only the first three can be matched. A
                // caller who picked "(205) 419" gets every 205 group, which is
                // the finest filter this data actually supports.
                const wantedDigits = String(nanpa_prefix_id || "").replace(/[^0-9]/g, "");
                const wantedNpa = wantedDigits.slice(0, 3);
                const matching = wantedNpa
                    ? collected.filter((g) => String(((g.attributes || {}).prefix) || "").trim() === wantedNpa)
                    : collected;'''

CACHE_INIT = "DidwwControllerOwn._prefixCache = new Map();\n"


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_DEFAULT
    text = io.open(target, encoding="utf-8").read()

    if "_prefixCache" in text:
        raise SystemExit("already applied - _prefixCache is present")

    start = text.index(PREFIX_BLOCK_START)
    end = text.index(PREFIX_BLOCK_END, start) + len(PREFIX_BLOCK_END)
    text = text[:start] + NEW_PREFIX_BODY + text[end:]

    count = text.count(OLD_GROUP_FILTER)
    if count != 1:
        raise SystemExit("groupList filter anchor matched %d times, expected 1" % count)
    text = text.replace(OLD_GROUP_FILTER, NEW_GROUP_FILTER)

    marker = "exports.default ="
    at = text.rindex(marker)
    text = text[:at] + CACHE_INIT + text[at:]

    io.open(target, "w", encoding="utf-8").write(text)
    print("patched %s" % target)


if __name__ == "__main__":
    main()
