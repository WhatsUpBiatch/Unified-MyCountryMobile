#!/usr/bin/env python3
"""Concurrent calls follow licences, not numbers.

The old rule gave a customer one channel per active number plus one. The
owner's rule is different: a licence is what buys a channel. Three licences
mean four calls at once, and an extra phone line bought without a licence adds
nothing. `companies.licenses` is the figure the customer is shown as
"purchased" and the one the API raises on every licence purchase, so after
this patch the switch and the bill agree.

Two files change:
  dialplan_service.py  company_number_count() becomes company_licence_count(),
                       reading companies.licenses instead of counting
                       did_numbers; its one call site follows.
  channel_limit.py     the docstring and parameter names stop saying "number".
                       The arithmetic (count + 1, capped at 500, fail open) is
                       untouched.

Usage: patch_licence_channels.py <dir holding both files>
Every anchor must match exactly once; the patch refuses an already-patched
file, writes a .bak beside each file, and py_compiles the results.
"""
import os
import py_compile
import shutil
import sys

OLD_FUNC = '''def company_number_count(company_uuid):
    """How many numbers this customer has, or None if it cannot be counted.

    None is not zero. A count that fails must leave the call unlimited rather
    than limited to nothing, so the failure path returns None and the caller
    then adds no limit at all. `status = 'A'` is the same test the DID lookup on
    this call path already uses, so "a number they own" means one thing here.
    """
    uuid = str(company_uuid or "").strip()
    if not uuid:
        return None

    now = time.time()
    if uuid in _number_count_cache and (now - _number_count_cache_time.get(uuid, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _number_count_cache[uuid]

    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS n FROM did_numbers WHERE company_uuid = %s AND status = 'A'",
                (uuid,),
            )
            row = cur.fetchone() or {}
            count = int(row.get("n") or 0)
    except Exception as e:
        log("error", "number count lookup failed, call left unlimited: %s" % e)
        return None

    _number_count_cache[uuid] = count
    _number_count_cache_time[uuid] = now
    return count
'''

NEW_FUNC = '''def company_licence_count(company_uuid):
    """How many licences this customer has bought, or None if it cannot be read.

    Concurrency follows licences, not numbers. Three licences answer four calls
    at once; a phone line bought without a licence adds nothing. The figure is
    `companies.licenses`: it is what the customer is shown as "purchased" and
    what the API raises on every licence purchase, so the switch and the bill
    agree.

    None is not zero. A read that fails must leave the call unlimited rather
    than limited to nothing, so the failure path returns None and the caller
    then adds no limit at all. A company with no licences at all still gets
    the spare channel, exactly as a company with no numbers did before.
    """
    uuid = str(company_uuid or "").strip()
    if not uuid:
        return None

    now = time.time()
    if uuid in _licence_count_cache and (now - _licence_count_cache_time.get(uuid, 0)) < CALLING_RULES_CACHE_SECONDS:
        return _licence_count_cache[uuid]

    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT licenses FROM companies WHERE uuid = %s",
                (uuid,),
            )
            row = cur.fetchone() or {}
            count = int(row.get("licenses") or 0)
    except Exception as e:
        log("error", "licence count lookup failed, call left unlimited: %s" % e)
        return None

    _licence_count_cache[uuid] = count
    _licence_count_cache_time[uuid] = now
    return count
'''

DIALPLAN_EDITS = [
    (OLD_FUNC, NEW_FUNC),
    ("_number_count_cache = {}\n", "_licence_count_cache = {}\n"),
    ("_number_count_cache_time = {}\n", "_licence_count_cache_time = {}\n"),
    ("    channel_guard = limit_actions(company_uuid, company_number_count(company_uuid))\n",
     "    channel_guard = limit_actions(company_uuid, company_licence_count(company_uuid))\n"),
]

LIMIT_EDITS = [
    ('''The rule is commercial, not technical: a customer gets one channel per number
they have bought, plus one. One number answers two calls at once; ten numbers
answer eleven. The spare is deliberate - it is what stops a single-number
customer sounding engaged to the second caller of the day.
''',
     '''The rule is commercial, not technical: a customer gets one channel per
licence they have bought, plus one. One licence answers two calls at once; ten
licences answer eleven. A phone line bought without a licence adds nothing.
The spare is deliberate - it is what stops a single-licence customer sounding
engaged to the second caller of the day.
'''),
    ("# One spare channel on top of the numbers bought. See the module docstring.\n",
     "# One spare channel on top of the licences bought. See the module docstring.\n"),
    ('    """A number of DIDs, or None when the value cannot be trusted."""\n',
     '    """A number of licences, or None when the value cannot be trusted."""\n'),
    ("def channel_allowance(number_count, spare=SPARE_CHANNELS):\n",
     "def channel_allowance(licence_count, spare=SPARE_CHANNELS):\n"),
    ("    count = _as_count(number_count)\n", "    count = _as_count(licence_count)\n"),
    ('def limit_actions(company_uuid, number_count, busy="!USER_BUSY"):\n',
     'def limit_actions(company_uuid, licence_count, busy="!USER_BUSY"):\n'),
    ("    allowance = channel_allowance(number_count)\n",
     "    allowance = channel_allowance(licence_count)\n"),
]


def apply(path, edits, already):
    with open(path) as fh:
        text = fh.read()
    if already in text:
        sys.exit("%s: already patched, refusing to run twice" % path)
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            sys.exit("%s: anchor found %d times, expected 1:\n%s" % (path, n, old[:120]))
        text = text.replace(old, new)
    shutil.copy2(path, path + ".bak")
    with open(path, "w") as fh:
        fh.write(text)
    py_compile.compile(path, doraise=True)
    print("patched %s (%d edits)" % (os.path.basename(path), len(edits)))


def main(argv):
    if len(argv) != 2:
        sys.exit(__doc__)
    d = argv[1]
    dp = os.path.join(d, "dialplan_service.py")
    cl = os.path.join(d, "channel_limit.py")
    # channel_limit.py's own body may still say number_count once inside
    # limit_actions; that use is covered by the explicit edit below.
    apply(dp, DIALPLAN_EDITS, "def company_licence_count(")
    apply(cl, LIMIT_EDITS, "def channel_allowance(licence_count")


if __name__ == "__main__":
    main(sys.argv)
