#!/usr/bin/env python3
"""Widen the ring on the queue's own terms.

The service already widens: tier 1 rings first and a wider tier is added after
a step. But the step was a constant from the environment (ACD_STEP_SECONDS,
15 s) and there was no way to say "do not widen at all" - so the queue editor's
"Widen the ring" switch and its "after this many seconds" field were stored
and ignored. This reads them off the queue record the service already loads.

- No escalation block on the record: exactly today's behaviour.
- Switched off: everyone on the queue rings from the first attempt, whatever
  tier they were put in. A tier is only an order to widen in; with widening off
  it must not become a way to silently exclude people.
- Switched on: the step is the admin's number, clamped to 15-600 s like the
  editor clamps it.

Idempotent. Usage: patch_escalation_settings.py /opt/queue-agent-service/queue_agent_service.py
"""
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "/opt/queue-agent-service/queue_agent_service.py"
src = open(PATH).read()

if "def queue_escalation(" in src:
    print("already applied")
    sys.exit(0)

def replace_once(old, new, what):
    global src
    n = src.count(old)
    if n != 1:
        raise SystemExit("anchor for %s matched %d times, expected 1" % (what, n))
    src = src.replace(old, new)

# 1. The planner learns to not widen.
replace_once(
    '''def decide_ring(rows, tiers, strategy, waited_seconds, already_tried=(),
                now=None, step_seconds=None, wrap_default=0):
''',
    '''def decide_ring(rows, tiers, strategy, waited_seconds, already_tried=(),
                now=None, step_seconds=None, wrap_default=0, widen=True):
''',
    "decide_ring signature",
)
replace_once(
    '''    if step_seconds > 0:
        step_index = int(max(0, waited_seconds) // step_seconds)
    else:
        step_index = 0
    step_index = min(step_index, len(levels) - 1)
''',
    '''    if not widen:
        # Widening is off for this queue: every tier is open from the start.
        step_index = len(levels) - 1
    elif step_seconds > 0:
        step_index = int(max(0, waited_seconds) // step_seconds)
    else:
        step_index = 0
    step_index = min(step_index, len(levels) - 1)
''',
    "step index",
)
replace_once(
    '''    candidates = []
    if step_seconds > 0 and step_index < len(levels) - 1:
''',
    '''    candidates = []
    if widen and step_seconds > 0 and step_index < len(levels) - 1:
''',
    "changes_in",
)

# 2. Read the queue's choice.
replace_once(
    '''def decide_ring(rows, tiers, strategy, waited_seconds, already_tried=(),''',
    '''ESCALATION_STEP_MIN = 15
ESCALATION_STEP_MAX = 600


def queue_escalation(queue):
    """(widen, step_seconds) as the queue's admin chose them.

    (True, None) when the record says nothing, which keeps the service's own
    default step; (False, None) when widening is switched off; (True, seconds)
    when it is on, with the seconds clamped to what the editor allows.
    """
    settings = queue.get("settings") if isinstance(queue, dict) else None
    block = settings.get("escalation") if isinstance(settings, dict) else None
    if not isinstance(block, dict):
        return True, None
    if block.get("enabled") is not True:
        return False, None
    seconds = _as_int(block.get("widen_after_seconds"), 0)
    if seconds <= 0:
        return True, None
    return True, max(ESCALATION_STEP_MIN, min(ESCALATION_STEP_MAX, seconds))


def decide_ring(rows, tiers, strategy, waited_seconds, already_tried=(),''',
    "queue_escalation",
)

# 3. Hand it to the planner on every poll.
replace_once(
    '''        decision = decide_ring(
            rows, tiers, strategy, waited,
            already_tried=tried_names(entry, call_timeout, started),
            now=now,
            wrap_default=queue_wrap_seconds(queue),
        )
''',
    '''        widen, step_seconds = queue_escalation(queue)
        decision = decide_ring(
            rows, tiers, strategy, waited,
            already_tried=tried_names(entry, call_timeout, started),
            now=now,
            step_seconds=step_seconds,
            wrap_default=queue_wrap_seconds(queue),
            widen=widen,
        )
''',
    "planner call",
)

open(PATH, "w").write(src)
print("patched", PATH)
