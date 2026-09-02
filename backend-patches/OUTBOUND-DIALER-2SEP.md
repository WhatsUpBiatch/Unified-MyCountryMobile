# Outbound campaigns: audit and the dialer build, 2 September 2026

Plain-English record of what the campaign feature at
`/campaign/all-campaigns` actually did, what was built today, what is live,
and what still needs the owner's go-ahead. Reference product: the outbound
campaign model every large contact-centre platform uses (preview, progressive,
predictive; a live campaigns dashboard with connect rate, abandon rate, idle
agents, outstanding calls, progress; per-campaign interactions view). The
mirrored reference articles are in the session scratchpad under `genesys-kb/`.

## 1. What the audit found (before today)

| Area | What the screen implied | What actually happened |
|---|---|---|
| Start button | Starts dialling | Flipped one database field. Nothing dialled. The "state changed" socket event was sent to an empty list (it looked up a member field that does not exist), so agents never heard about a pause either. |
| Predictive dialer | Server dials ahead of agents | The agent's **browser** asked for one lead every 30 s while idle. One call per open tab, no over-dial, no abandon control, stops when the tab closes. |
| Server originate | Places the call on the switch | Never worked on production: the originator looks up the carrier at `127.0.0.1:8003`, and nothing listens there (the rate service runs on **9004**). Every attempt died before reaching the switch. |
| Answered leg | Reaches the campaign's agents | The switch asks the dialplan service for context `campaign`; the service only knew `internal/default/public`. A server-placed call would have been answered and dropped. |
| Progressive | Server dials one contact per idle agent | Identical to preview with the countdown set to zero; the browser dialled. |
| Preview | Agent sees the record, dials | Works (76 real calls on one tenant on 14 Aug). Lead reservation, retries and attempts are real. |
| Pacing settings | Ratio, abandon cap, lines | Did not exist anywhere. |
| Answering machine detection | Hang up / voicemail on machine | Stored, shipped to the originator, dropped there. The switch has no detection module wired. Still true today; the form now says so. |
| Campaign monitor page | Live | Load-once. The list carried a green "live" badge over data that never refreshed. |
| Call outcome write-back | CDR updates the lead | The only writer on production was the browser's own report. The Go call-centre service that posts CDRs is not deployed on mcm-new; `live_calls` is empty on every tenant. |

Production data: 13 campaigns across 3 tenants, all CALL type; 78 campaign
call-log rows in total, all from browser-dialled preview campaigns.

## 2. What was built

### campaign-api (source, branch `feat/outbound-dialer`, commits 55850c8 + 8f06cde)

A **dialer engine** inside the service (`src/services/dialer/`):

- `pacing.ts` — the rules, pure functions with 15 tests
  (`npx ts-node --transpile-only src/services/dialer/pacing.test.ts`):
  - preview: server never dials;
  - progressive: one call per idle agent, minus calls already on the way;
  - predictive: `idle agents × calls-per-agent`, where calls-per-agent =
    safety multiplier ÷ measured connect rate, capped by the campaign's
    "max calls per free agent". The multiplier drops 0.1 whenever the
    abandon rate is over the campaign's cap and creeps up 0.05 while well
    under it (bounded 0.3–1.0). A line ceiling and a per-tick burst cap
    apply on top;
  - health: running / waiting for agents / waiting for contacts / outside
    hours / line limit / paused / stopping / completed;
  - calling window: the campaign's own dates, holidays, weekday hours and
    timezone (no hours configured = always open);
  - outcome from the switch: answered (reached an agent), abandoned
    (answered, no agent in time), no answer, busy, failed.
- `CampaignLiveState.ts` — per-campaign live board: every call's state
  (dialling → ringing → answered/waiting → ringing agent → talking → ended),
  run counters, agent duty rows, lead counts, and a 40-line "what just
  happened" feed.
- `DialerEngine.ts` — the 2-second ticker. For every running CALL
  campaign: checks the calling window, counts idle agents from the
  campaign queue's agent rows (same duty rule the queue's own agent service
  uses, plus a live browser session so a crashed tab cannot leave a ghost
  "Available"), counts due leads, claims the next leads oldest-due-first
  (skipping and flagging do-not-call numbers), publishes each originate on
  the existing `campaign-system-events-response` contract with a SIP call
  id it chose, follows the switch's `callcenter.*` events, writes each
  outcome back through the same `contactActivityCallSave` rule the CDR
  webhook uses (attempts, retries, call log, analytics), auto-completes the
  campaign when nothing is left, recovers leads stuck IN_PROCESS after a
  crash, and pushes the board to the tenant's browsers on
  `campaign-live-stats`.
- Env switches: `DIALER_ENGINE_ENABLED=false` keeps the old behaviour;
  `DIALER_DRY_RUN=true` runs everything except the originate.
- Also: progressive campaigns now get a queue + agent rows like predictive;
  start/pause/complete is broadcast to the whole tenant; pacing keys accepted
  on `dialerSetting`; `POST /api/v1/campaign/live/snapshot`; the old browser
  lead request no longer hands out a lead when the engine is on (it just
  wakes the engine), so an agent cannot be dialled for twice.
- `src/dialer-standalone.ts` — a bounded dry-run soak entry (see §4).

Built with the project's webpack; `tsc --noEmit --skipLibCheck` clean;
`node --check` on the bundle passes.

### fs-xml-api (switch dialplan, mcm-new) — `backend-patches/fs-xml-api/`

`patch_campaign_context.py` adds context `campaign`: reads the queue id off
the `X-ForwardValue` header the originator stamps on the leg and hands the
answered customer to the campaign's queue exactly as an inbound number
routed to that queue (same audio, recording rule and queue script). A call
with no findable queue is hung up with `NO_ROUTE_DESTINATION` rather than
parked on silence. 12 checks in `campaign_context_test.py` pass on the
patched copy and fail on the unpatched one (control). Apply with
`apply-campaign-context.sh`.

### esl-manager (originator, mcm-new) — `backend-patches/esl-manager/`

`apply-route-api-url.sh` sets `ROUTE_API_URL=http://127.0.0.1:9004/v1/rates`
in `/opt/esl-manager/.env`. Proven on 2 Sep with a real lead number: the
service on 9004 answers with exactly the carrier/rate shape the originator
expects (carrier 38.147.130.91, prefix 77701, India Cellular $0.02).

### Website (live on unified.mycountrymobile.com since 20:39, 2 Sep)

Branch `feat/outbound-dialer-ui2` (commit a046ecf) on top of
`feat/queues-reports`, which is what the running site is built from (main is
five commits behind it). Deployed from the session worktree with the other
session's in-flight call-history edits included; the only UI string that
disappeared versus the previous build is "Pacing is not measured yet",
which is now false.

- **Campaign monitor** (eye icon): a Live tab with the health line, calls in
  flight (contact, state, agent, time), this run's counters and rates
  against the abandon cap, contact-list progress by state, the event feed;
  the Agents tab shows idle / on call / wrapping up / offline live; the
  Outcomes tab keeps the stored analytics and refreshes after every call.
  Until the engine reports, the Live tab says so instead of showing zeros.
- **Campaign list**: each running row shows its health and "N calls up,
  M idle of K"; the decorative "live" badge is real now (only when boards
  arrive).
- **Campaign form**: a Pacing block for progressive (line ceiling) and
  predictive (line ceiling, max calls per free agent, abandon rate cap,
  abandon threshold in seconds). The answering-machine switch is labelled
  "saved, not enforced by the switch yet".
- **Agent runtime**: progressive campaigns behave like predictive (go
  available, wait for the call) behind `SERVER_DIALS_PROGRESSIVE` in
  `src/lib/campaign-dial-mode.ts`, **currently `false`**. Admin pause /
  complete now reaches the agent's dialer directly.

## 3. Deploy order (needs the owner's go-ahead; nothing below is applied)

1. `backend-patches/fs-xml-api/apply-campaign-context.sh` on mcm-new
   (sub-second restart of fs-xml-api). Inert until a server call is placed.
2. `backend-patches/esl-manager/apply-route-api-url.sh` on mcm-new (restart
   of esl-manager; a few seconds of blind spot on live dashboards, calls
   untouched).
3. `DRY_RUN=1 backend-patches/campaign-api/apply-outbound-dialer.sh` — the
   engine runs, boards appear on the website, nothing dials. Watch
   `pm2 logs campaign-api | grep dialer` for "engine started" and no errors.
4. Same script without `DRY_RUN` once step 5 has been done at least once in
   dry run.
5. Website: set `SERVER_DIALS_PROGRESSIVE = true`, rebuild, deploy. **Never
   before step 4**, or progressive agents wait for calls nobody places.

Each script backs up what it changes and says how to put it back.

## 4. Retest (what nobody has seen yet)

The dry-run soak was prepared but **not run**: starting an extra node
process on production was refused by the session's permission rules. To run
it by hand (45 s, dials nothing, pushes boards for the three running
preview campaigns so the monitor page lights up):

```
scp /root/UCAAS/mcm-repos/campaign-api/dist/src/dialer-standalone.js mcm-new:/root/mcm-patches-2sep/
ssh mcm-new 'cd /var/www/prod/campaign-api && SOAK_MS=45000 NODE_PATH=/var/www/prod/campaign-api/node_modules node /root/mcm-patches-2sep/dialer-standalone.js'
```

(Rebuild that file first with
`npx webpack --config webpack.config.js --entry ./src/dialer-standalone.ts --output-filename dialer-standalone.js`
from the repo; `npm run build` overwrites `dist/`.)

The real test, after steps 1–4, is one progressive campaign with one lead
and one agent:

1. Agent opens My Campaigns, joins the campaign, and is "Available".
2. Supervisor starts the campaign and opens the monitor. Within 2 s the
   health line reads "Dialling normally" and a row appears as Dialling →
   Ringing.
3. The lead's phone rings from the campaign's caller ID. On answer the row
   goes to "Answered, waiting for agent", the agent's phone rings, the row
   goes to "Talking" with the agent's name.
4. Hang up. The row shows "Ended · Answered 0:NN", the lead's outcome
   appears under Outcomes within a few seconds, and the campaign completes
   when the list is empty.
5. Controls: pause mid-run → "Paused" within 2 s and no new rows; an agent
   on break → "Waiting for agents"; a campaign outside its hours → "Outside
   calling hours" and no dial.
6. Predictive: two agents, ten leads, abandon cap 3%. The board's "calls per
   agent" starts near 2.3 and moves with the connect rate; an answered call
   that hangs up before an agent counts under "Abandoned before an agent".

## 5. Still open, in order of pain

- **Answering machine detection**: stored only. The switch has no AMD
  module loaded; the originator drops the setting. Needs `mod_avmd` (or a
  carrier-side AMD) plus an `execute_on_answer` in the originator's exports.
- **No-answer timeout**: the originator hard-codes 45 s ring; the campaign's
  "max ring time" is not read. Needs a one-line change in esl-manager's
  exports (`originate_timeout`), which means rebuilding that service.
- **Abandoned-call message**: an answered customer with no free agent hears
  the queue's hold audio for up to 45 s, then is dropped. Regulated markets
  expect a short recorded message; the queue script would need a
  campaign-specific "no agent" media.
- **Per-customer channel limit**: inbound calls count against the
  numbers+1 cap; server-placed campaign calls do not yet.
- **Scheduled callbacks**: agent-scheduled callbacks are dialled when due,
  but only in list order with everything else; no separate "scheduled
  interactions" view.
- **Single instance**: the engine assumes one campaign-api process (pm2
  runs one). A second instance would need a lock.
- **Old browser-driven progressive** stays until the flag is flipped.
