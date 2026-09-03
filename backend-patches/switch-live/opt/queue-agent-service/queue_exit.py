"""The queue's own answer to 'what happens if nobody picks up'.

Read from the queue record, where the product has been saving it all along:

    settings.ring_strategy.max_wait_time = {
        "callers": 10,
        "queue_timeout": "60",
        "after_max_wait_time": {"type": "VOICEMAIL", "value": "1000"}
    }

Twelve of the twenty live queues have this filled in, and until now nothing read
it. A caller who reached a queue with nobody on duty waited out a hardcoded
sixty seconds and was then hung up on, whatever the queue had been told to do.

Nested under ring_strategy rather than at the top level, which is why searching
the record for 'after_max_wait_time' or 'queue_timeout' finds nothing and gives
the wrong answer about whether the feature exists.
"""


def _as_int(value, default=0):
    try:
        n = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return n


def _as_object(value):
    return value if isinstance(value, dict) else {}


def max_wait_block(queue):
    """The saved 'longest anyone waits' settings, wherever they live."""
    settings = _as_object(_as_object(queue).get("settings"))
    strategy = _as_object(settings.get("ring_strategy"))
    return _as_object(strategy.get("max_wait_time"))


def queue_timeout_seconds(queue, fallback=60):
    """How long a caller may wait before the queue gives up on them.

    The switch has been defaulting to sixty seconds because nothing ever told it
    otherwise. Anything unreadable or out of range keeps that default rather than
    inventing a number: a queue that suddenly gives up after two seconds because
    a field held junk would be a worse failure than one that waits as it always
    has.
    """
    seconds = _as_int(max_wait_block(queue).get("queue_timeout"), 0)
    if 5 <= seconds <= 3600:
        return seconds
    return fallback


def max_callers(queue):
    """How many people may wait at once. 0 means no limit was set."""
    n = _as_int(max_wait_block(queue).get("callers"), 0)
    return n if n > 0 else 0


def queue_exit(queue):
    """Where a caller goes when the queue gives up, or None if nowhere is set.

    Returned as the same {type, value} shape the rest of the platform uses for a
    forwarding destination, so the switch can hand it to the code that already
    knows how to reach an extension, a voicemail box, a menu or another queue.

    None is a real answer and means 'nothing was configured', which is different
    from 'configured to hang up'. The caller of this must not invent a
    destination for None - today's behaviour is the honest fallback.
    """
    block = _as_object(max_wait_block(queue).get("after_max_wait_time"))
    kind = str(block.get("type") or "").strip().upper()
    value = str(block.get("value") or "").strip()

    if not kind or not value:
        return None

    return {
        "type": kind,
        "value": value,
        # Kept because the product stores it and voicemail routing needs to know
        # whether it means a person's own box or a shared one.
        "personal": bool(block.get("personal")),
    }
