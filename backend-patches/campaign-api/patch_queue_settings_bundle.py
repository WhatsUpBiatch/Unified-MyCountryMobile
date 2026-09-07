#!/usr/bin/env python3
"""Let campaign-api accept the queue settings the website already has.

campaign-api ships as one webpack bundle with each module inside an
eval("...") string. Its queue validator (src/schemas/queue.ts) lists exactly
which keys `settings` and each member may carry, and refuses anything else -
so the website has had to strip three whole blocks it collects (`waiting`,
`after_call`, `escalation`) and two member fields (`tier`, `rating`) before
every save, or the save failed outright. Nothing the admin chose in those
blocks ever reached the record, and everything downstream that would read
them read nothing.

This adds them to the validator with the same bounds the website enforces, and
makes one more change in the same module set: tiers were written with a
hard-coded `level: 1` for every member, which is why "widen the ring" could
never widen. The member's own tier is now written.

The edit is done on the escaped text inside the eval string, so newlines are
`\\n` and quotes are `\\"`. Every anchor must match exactly once; if the bundle
has changed, this refuses rather than guessing. Idempotent.

Usage: patch_queue_settings_bundle.py /path/to/index.js
Then:  node --check /path/to/index.js
"""
import sys

PATH = sys.argv[1]
src = open(PATH).read()

MARK = "waiting: joi_1.default.object({\\n        announce_position"
if MARK in src:
    print("already applied")
    sys.exit(0)

def replace_once(old, new, what):
    global src
    n = src.count(old)
    if n != 1:
        raise SystemExit("anchor for %s matched %d times, expected 1" % (what, n))
    src = src.replace(old, new)

# --- 1. settings: three optional blocks, bounded like the website's limits ---
old = (
    "    media: joi_1.default.object({\\n"
    "        welcome: joi_1.default.object({\\n"
)
new = (
    "    // Accepted since 2 Sep 2026. Optional, so a queue saved by an older\\n"
    "    // client still validates. Bounds mirror WAITING_LIMITS, ESCALATION_LIMITS\\n"
    "    // and AFTER_CALL_LIMITS on the website so the two ends cannot disagree.\\n"
    "    waiting: joi_1.default.object({\\n"
    "        announce_position: joi_1.default.boolean().optional(),\\n"
    "        announce_wait_time: joi_1.default.boolean().optional(),\\n"
    "        callback: joi_1.default.object({\\n"
    "            enabled: joi_1.default.boolean().optional(),\\n"
    "            offer_after_callers: joi_1.default.number().integer().min(0).max(500).optional(),\\n"
    "            offer_after_minutes: joi_1.default.number().integer().min(0).max(300).optional(),\\n"
    "            max_attempts: joi_1.default.number().integer().min(1).max(10).optional(),\\n"
    "            retry_after_minutes: joi_1.default.number().integer().min(1).max(240).optional(),\\n"
    "            expires_after_hours: joi_1.default.number().integer().min(1).max(168).optional()\\n"
    "        }).optional()\\n"
    "    }).optional(),\\n"
    "    escalation: joi_1.default.object({\\n"
    "        enabled: joi_1.default.boolean().optional(),\\n"
    "        widen_after_seconds: joi_1.default.number().integer().min(15).max(600).optional(),\\n"
    "        minimum_rating: joi_1.default.number().integer().min(0).max(100).optional()\\n"
    "    }).optional(),\\n"
    "    after_call: joi_1.default.object({\\n"
    "        wrapup_prompt: joi_1.default.string().valid('OPTIONAL', 'MANDATORY', 'MANDATORY_TIMEOUT', 'MANDATORY_FORCED_TIMEOUT', 'AGENT_REQUESTED').optional(),\\n"
    "        last_agent: joi_1.default.object({\\n"
    "            mode: joi_1.default.string().valid('DISABLED', 'QUEUE_MEMBERS_ONLY', 'ANY_AGENT').optional(),\\n"
    "            window_hours: joi_1.default.number().integer().min(1).max(720).optional()\\n"
    "        }).optional(),\\n"
    "        service_level: joi_1.default.object({\\n"
    "            enabled: joi_1.default.boolean().optional(),\\n"
    "            percent: joi_1.default.number().integer().min(1).max(100).optional(),\\n"
    "            seconds: joi_1.default.number().integer().min(1).max(600).optional()\\n"
    "        }).optional()\\n"
    "    }).optional(),\\n"
    "    media: joi_1.default.object({\\n"
    "        welcome: joi_1.default.object({\\n"
)
replace_once(old, new, "settings schema")

# The marker the idempotence check looks for must now be present.
assert MARK in src

# --- 2. members: a tier and a rating per person ---
old = (
    "    skills: joi_1.default.array().items(joi_1.default.string()).optional(),\\n"
    "    timeout: joi_1.default.number().optional()\\n"
    "});\\nexports.createQueueValidation"
)
new = (
    "    skills: joi_1.default.array().items(joi_1.default.string()).optional(),\\n"
    "    timeout: joi_1.default.number().optional(),\\n"
    "    // Which ring this person is in when the queue widens (1 rings first),\\n"
    "    // and how well they handle this queue's work, 0-100. Both website-set.\\n"
    "    tier: joi_1.default.number().integer().min(1).max(3).optional(),\\n"
    "    rating: joi_1.default.number().min(0).max(100).optional()\\n"
    "});\\nexports.createQueueValidation"
)
replace_once(old, new, "member schema")

# --- 3. tiers: write the member's tier, not 1 for everybody ---
old = (
    "                    position: index,\\n"
    "                    level: 1,\\n"
    "                    state: 'Ready'\\n"
)
new = (
    "                    position: index,\\n"
    "                    // The member's own tier. It was a constant 1 here, so the\\n"
    "                    // escalation engine - which reads this level - could never\\n"
    "                    // find a second ring to widen to.\\n"
    "                    level: Math.min(3, Math.max(1, Math.floor(Number(member?.tier) || 1))),\\n"
    "                    state: 'Ready'\\n"
)
replace_once(old, new, "tier level")

open(PATH, "w").write(src)
print("patched", PATH)
