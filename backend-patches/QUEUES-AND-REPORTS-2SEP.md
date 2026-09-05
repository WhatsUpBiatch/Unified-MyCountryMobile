# Queues and reports — the server-side half, ready to apply

Prepared 2 September 2026 against the Phone System Build Plan. The website
half is built and deployed separately (see the commit on `feat/queues-reports`).
**All four were applied on mcm-new on 2 Sep 2026 between 19:00 and 19:04**, on
the owner's go-ahead, and the website flag was flipped and deployed at 19:08.
What follows is the record of what each does and how to revert it.

## What each piece does

| # | Piece | Files | Restarts | Plan item |
|---|---|---|---|---|
| 1 | campaign-api accepts `waiting`, `after_call`, `escalation`, member `tier` + `rating`; writes real tier levels — **in the Bitbucket source**, branch `feat/queue-settings-and-tiers` (2b74561), built with the project's own webpack | `campaign-api/apply-queue-settings.sh` (builds from the branch and ships the bundle; `patch_queue_settings_bundle.py` is the superseded bundle-edit, kept as a record) | `pm2 restart campaign-api` | Ring tiers ("one line") + unblocks every stored-only setting; also drops the competitor CORS origin (plan ask #5) |
| 2 | dialplan sets `cc_announce_position` / `cc_announce_interval` from the queue record | `fs-xml-api/patch_position_announce.py`, `apply-position-announce.sh` | `systemctl restart fs-xml-api` | Position in line |
| 3 | the queue script counts the line in mod_hash and speaks the number | `freeswitch/patch_position_announce.py`, `apply-position-announce.sh`, `sounds/make-prompts.sh` | none (read per call) | Position in line |
| 4 | agent service widens on the queue's own timer, or not at all | `queue-agent-service/patch_escalation_settings.py`, `apply-escalation-settings.sh` | `systemctl restart queue-agent-service` | Ring tiers |

## Order

1. `freeswitch/apply-position-announce.sh mcm-new` — prompts + script. Inert
   until the dialplan sends the variable.
2. `fs-xml-api/apply-position-announce.sh` — on mcm-new. Inert until a queue
   record carries `waiting.announce_position`.
3. `campaign-api/apply-queue-settings.sh` — on mcm-new. From here the service
   stores what the website sends.
4. `queue-agent-service/apply-escalation-settings.sh` — on mcm-new.
5. Website: set `QUEUE_SERVICE_ACCEPTS_EXTENDED_SETTINGS = true` in
   `src/pages/admin-settings/phone-systems/call-queue/constant.ts`, build,
   deploy. This is the switch that starts sending the settings and turns the
   badges from "coming soon" to live. **Never before step 3.**

Steps 1–4 are each safe alone and safe to revert alone; every script leaves a
dated backup beside the file it changed and says how to put it back.

## What was proven off-box

- campaign-api: `npm run build` from the branch compiles; `tsc --noEmit` is
  clean; the bundle passes `node --check`. Diffed module by module against
  production (86 modules): boilerplate apart, production is the OLDER build —
  the repo adds the developers' later work (campaign-delete cleanup, wrap-up
  event, queueAgentStatus) and removes `portal.dialphone.ai` from CORS.
  Pull request: https://bitbucket.org/mycountry/campaign-api/pull-requests/new?source=feat/queue-settings-and-tiers
- fs-xml-api: the existing 30 `queue_media_test.py` checks still pass on the
  patched file, plus: on → `cc_announce_position=1` and the interval; off, or
  a non-boolean, → nothing; interval clamped to 30–600 and reusing the
  repeating-message interval when one is set.
- freeswitch: `luac -p` passes on the patched script (and, as a control, on
  the original); join/leave/announce hooks land at the four intended points.
- agent service: with three people on tiers 1/2/3 and a 30 s step, the first
  poll names one, 31 s names two, 61 s names three; widening off names all
  three on the first poll; the untouched default still steps at 15 s.

## What has NOT been proven, and how to

Nobody has yet heard a queue speak a position, because no real call has been
placed through a queue since the work began. The retest for the whole set is
one call:

1. Queue with "Tell them where they are in the line" on, saved after step 5.
2. Agent signed out. Call the queue's number from phone A, then from phone B.
3. About 10 s in, B hears "You are caller number 2 in the queue…"; A hears
   "You are next in line". `docker logs mcm-freeswitch | grep "Told caller"`
   shows both.
4. Hang up A. On B's next announcement it hears "next in line".
5. Control: a queue with the setting off — silence where the announcement
   would be, no "Told caller" line.

## Prompts

Rendered with espeak-ng (`freeswitch/sounds/make-prompts.sh`, deterministic;
not committed — 2.4 MB of WAV). The voice is a synthetic one. If a recorded
human voice is wanted, replace the files in
`/etc/freeswitch/sounds/mcm/queue/` with the same names; the script does not
care how they were made. An Azure Speech key exists on mcm-new (used by the AI
receptionist) and would give a natural voice for the same 104 short files —
that is a decision about using a production credential, so it was not made here.

## Second wave, 2 Sep evening — least talk time, last agent, rating, service level

| Piece | Files | What it proves off-box |
|---|---|---|
| Queue script reports each answered call (`handled`: agent, talk seconds from `bridge_epoch`, caller number) and sends `caller=` with every poll | `freeswitch/patch_report_handled.py` (on top of the position patch) | `luac -p`; hooks land in both ring modes; "unknown" answering agent is skipped |
| Agent service: `handled` adds talk time (the only place that does, so no double count); remembers caller → agent in `queue_last_agents`; prefers the last agent once when the queue asks; first ring honours `minimum_rating` while widening is on, waived if it would empty the ring | `queue-agent-service/patch_talk_last_agent_rating.py`, `apply-talk-last-agent-rating.sh` | 14 checks: bar held/dropped/waived, off when widening is off, window and mode for last agent, `handled` increments only talk time |
| Performance → Queues: "Service level" measured from the call log against the queue's own target ("80% in 20 s"), green/red against it; falls back to the live 20 s figure when no target is set | website `use-call-stats.ts`, `use-live-contact-centre.ts`, `queue-rows.ts`, `queues-activity-tab.tsx` | tsc + eslint clean |

Retest for the wave: one answered queue call, then the agent record's `talk_time`
> 0; call again from the same number with last-agent on → the same agent rings
first (service log says so); set a member's rating below the bar with widening
on → they are held back for the first ring only.
