"""How many calls one customer may have up at once.

The carrier cannot answer this question. DIDWW caps concurrency per number
(`capacity_limit`) and per account (a shared capacity group), and it has no idea
our customers exist - every number we buy sits under one account. "These ten
numbers, belonging to this one customer, share eleven channels" is not
expressible there, so it has to be enforced here, on the switch, where the
company that owns the dialled number is already known.

The rule is commercial, not technical: a customer gets one channel per number
they have bought, plus one. One number answers two calls at once; ten numbers
answer eleven. The spare is deliberate - it is what stops a single-number
customer sounding engaged to the second caller of the day.

Everything here fails open. A limit that cannot be worked out must not become a
limit of zero: that would silently reject every call to that customer, which is
far worse than briefly allowing one too many.
"""

# The realm the counters live under in mod_hash. Every company shares the realm
# and is told apart by its uuid, so one `limit_usage hash <realm> <uuid>` reads
# a single customer's live call count.
LIMIT_REALM = "company_channels"

# One spare channel on top of the numbers bought. See the module docstring.
SPARE_CHANNELS = 1

# Nothing legitimate reaches this. It exists so a bad row - a count read as a
# huge number - cannot turn into an effectively unlimited allowance and quietly
# undo the whole policy.
MAX_ALLOWANCE = 500


def _as_count(value):
    """A number of DIDs, or None when the value cannot be trusted."""
    if isinstance(value, bool):
        return None
    try:
        count = int(value)
    except (TypeError, ValueError):
        return None
    return count if count >= 0 else None


def channel_allowance(number_count, spare=SPARE_CHANNELS):
    """How many simultaneous calls this customer may have.

    Returns None when the count is missing or nonsense, and None means "do not
    limit this call" everywhere downstream - never "allow none".
    """
    count = _as_count(number_count)
    if count is None:
        return None

    allowance = count + spare
    if allowance < 1:
        return None
    return min(allowance, MAX_ALLOWANCE)


def limit_actions(company_uuid, number_count, busy="!USER_BUSY"):
    """The dialplan action that counts this call against the customer's limit.

    mod_hash increments on the way in and releases when the channel hangs up, so
    nothing has to be cleaned up afterwards. A destination beginning with `!`
    means "hang up with this cause" - a caller past the limit hears engaged,
    which is the honest telephony answer and what a carrier expects.

    An empty list is returned whenever the limit cannot be applied safely, so a
    caller can always write `limit_actions(...) + actions` without checking.
    """
    uuid = str(company_uuid or "").strip()
    if not uuid:
        return []

    allowance = channel_allowance(number_count)
    if allowance is None:
        return []

    # A uuid with a space in it would split the command and change its meaning,
    # so anything unexpected is refused rather than escaped.
    if any(ch.isspace() for ch in uuid):
        return []

    return [
        {
            "application": "limit",
            "data": "hash %s %s %d %s" % (LIMIT_REALM, uuid, allowance, busy),
        }
    ]
