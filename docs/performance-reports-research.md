# Performance reports: what shows, what does not, and what to build

Research pass, 2 Sep 2026, against the live system on mcm-new. Every count in
here came from the running databases or the CDR archive, not from reading code.
Where I could not confirm something, it says so rather than guessing.

The ask: `/performance` should show **all** calls — WebRTC, campaign, queue,
everything — across Calls, Inbound and Outbound. And on
`?view=queues-activity`, every inbound queue that has been set up should
appear, with the same being true of campaigns on Campaign Activity.

---

## 1. How the page gets its numbers today

Three separate data paths feed one screen, and they do not agree with each
other. This is the root of most of what follows.

| Surface | Endpoint | Reads |
|---|---|---|
| Reports → Call History | `/api/tenant/report/call-list` | `<tenant>.call_history` (MySQL) |
| Reports → Outbound | `/api/tenant/report/call-list` + `direction=Outbound` filter | same table |
| Reports → **Inbound** | `/api/tenant/report/inbound-calls` — **a different endpoint** | same table |
| Queues Activity | `/api/call-queue/list` → campaign-api `queue/list` | `queues` (MongoDB) |
| Campaign Activity | `/api/campaign/list` | `campaigns` (MongoDB) |

`call_history` is filled by `/opt/cdr-ingest.py`, which parses FreeSWITCH CDR
files and runs every 60 seconds. Confirmed healthy at the time of writing:
timer `active`/`enabled`, **277 processed**, **1 skipped**, **0 pending**.

**Inbound and Outbound do not share a code path.** Outbound passes a direction
filter to the generic list endpoint; Inbound calls a dedicated endpoint that
defaults to `direction = "Inbound"` and rejects any direction value outside
`Inbound | Missed | Voicemail`. Anything changed for one must be changed twice.

---

## 2. What is genuinely captured

Real and current. `call_history` across all tenants, newest rows 1 Sep 14:02:

| Tenant | Inbound | Outbound | Local |
|---|---|---|---|
| TestersCompany2 | 222 | 320 | 37 |
| Sushil Company | 22 | 103 | 5 |
| TestersCompany | 51 | 19 | 4 |
| MCM | 2 | 87 | 29 |
| UCaaS 3 | 9 | 28 | 3 |
| *(10 smaller tenants)* | 16 | 100 | 1 |

The CDR archive shows only two contexts — `internal` 171, `public` 106 — and
two directions, `inbound` 142 / `outbound` 135. So **every call that reaches
FreeSWITCH is captured**, WebRTC softphone calls included. The softphone is not
a special case: a browser call is an `internal` context CDR like any other.

---

## 3. The gaps, worst first

### 3.1 Queues Activity shows one queue in eight

`QueueRepository` filters `type: 'QUEUE'` in **every** query (lines 133, 141,
257, 351, 781). The `queues` collection holds **16 records: 8 `QUEUE` and 8
`CAMPAIGN`** — campaigns get a backing queue record in the same collection.

For TestersCompany2 that means **1 of its 8 queue records is visible**:

```
6a897c00da433e7e71a94c18  QUEUE     Ucaas Test        ext=9331   <- the only one shown
6a72eda070a608dae4ed0985  CAMPAIGN  Camp 003          ext=2882
6a796c7846ba79de22f87a4d  CAMPAIGN  Camp 004          ext=7964
6a7ac4aae3433008f9431209  CAMPAIGN  Camp 11 aug       ext=5943
6a7dacee57fc28db094dbf9f  CAMPAIGN  India Full Day 3  ext=1361
6a7db46006ddfc67d934bef5  CAMPAIGN  India Full Day 3  ext=2343
6a7dacf557fc28db094dc032  CAMPAIGN  India Full Day 6  ext=2783
6a7db46206ddfc67d934bf83  CAMPAIGN  India Full Day 6  ext=4357
```

This is the single biggest reason the tab looks empty.

### 3.2 A live number routes callers into a queue that does not exist

DID **12568081021** routes to queue **`6a71e1ff70a608dae4ecfd24`**, named
"test callqueue", extension 7928 — confirmed by asking the running dialplan
service for that number's call plan.

**That id exists in no MongoDB collection.** Searched every collection by `_id`
and by `queue`: zero hits. Control: the eight ids above were all found the same
way in the same run, so the search works.

The queue-agent service still answers for it (`strategy: ring-all`, *"Nobody can
take it right now - 2 signed out"*), so it is resolving members from `tiers`
without a queue record. Calls to that number can therefore never be attributed
to any queue on the tab, because the tab lists queue records.

### 3.3 AI calls are in a different database and appear nowhere

- `livekit_agent_sessions` — **101 documents**
- `livekit_agent_daily_analytics` — **38 documents**

None of this is in `call_history`, so none of it reaches Calls, Inbound or
Outbound. Separately, the dialplan has **no `AI` route type branch** (handled:
EXTENSION, VOICEMAIL, IVR, QUEUE, PHONE, HANGUP), so a number pointed at an AI
receptionist fails the call outright — see F4 in the audit tracker.

### 3.4 Internal calls are excluded by design

Both report paths carry `direction != 'local'`. There are **78 `Local` rows**
across tenants. Extension-to-extension calls appear in neither Inbound nor
Outbound, and in no total. Whether that is wanted is a product decision, but
today it is silent — nothing on the screen says internal calls are omitted.

### 3.5 Campaign calls — not confirmed either way

Campaign records exist in MongoDB: `campaigns` 13, `campaign_analytics` 13,
`campaign_member_analytics` 21, `campaign_event_logs` 16, `campaign_agent_activities` 0.
Campaign types: all `CALL`; statuses PROCESSING 3, NEW 3, PAUSE 4, COMPLETED 3;
dial methods PREVIEW 7, PROGRESSIVE 3, PREDICTIVE 3.

**I did not establish whether a dialled campaign call also lands in
`call_history`.** It should, if the dialler originates through FreeSWITCH — but
"should" is not evidence and the CDR archive carries no campaign marker to
count. This needs one campaign call placed and traced before anything is built
on the assumption.

### 3.6 Campaign Activity itself looks correct

`campaignList` is scoped by `company_uuid` with no status or type exclusion, and
the page asks for 100 against 13 existing. So all six of TestersCompany2's
campaigns should already appear. **Unverified in the browser** — worth one look
before treating it as a defect.

### 3.7 Role scoping quietly narrows the list

`Agent`, `InvitedAgent` and `AgencyStaff` see only rows matching their own
extension. Correct behaviour, but it means "calls are missing" from an agent's
login is not the same complaint as from an admin's, and the two need separating
before anyone investigates.

---

## 4. What to build

Ordered by value against effort. Items 1 and 2 are most of the visible win.

**1. Show campaign queues on Queues Activity.**
Stop filtering `type: 'QUEUE'` in `QueueRepository`; accept both types and carry
`type` through to the row so the table can label and group them. TestersCompany2
goes from 1 visible queue to 8. *Retest:* the tab lists 8 for that tenant, each
labelled with its type, and a tenant with only real queues is unchanged.

**2. Reunite the two report paths.**
Give Inbound the same generic endpoint Outbound uses, or make the dedicated
endpoint accept the same filter set. Today a fix has to be written twice and
they drift. *Retest:* Inbound and Outbound totals for one tenant and range add
up to the Call History total for the same range, minus whatever internal-call
decision is made in item 4.

**3. Bring AI calls into the reports.**
101 sessions exist and are invisible. Either the ingester learns to write
`livekit_agent_sessions` into `call_history` with a distinguishing direction or
type, or the report unions the two sources. The first keeps one table as the
answer to "what happened on the phones", which is worth more than the second.
*Retest:* an AI call appears in Calls, with the AI agent identified.

**4. Decide what happens to internal calls, then say it on screen.**
78 rows are silently dropped. Either include them with a type of their own, or
state plainly that internal calls are not counted. Silence is the only wrong
answer. *Retest:* the count matches the stated rule either way.

**5. Fix the orphaned queue, and stop it recurring.**
Repoint DID 12568081021 at a queue that exists, and make deleting a queue either
refuse while a number points at it, or repoint that number. *Retest:* the DID's
call plan names a queue id that is present in the collection.

**6. Confirm campaign calls reach `call_history` before building anything on it.**
Place one campaign call, then look for its CDR and its row. If it is missing,
that is a separate ingestion defect and needs its own item.

---

## 5. Verify against this before calling any of it done

- `call_history` row counts per tenant per direction, before and after.
- The Queues Activity tab row count against
  `db.queues.count({company_uuid: ..., type: {$in: ['QUEUE','CAMPAIGN']}})`.
- A control tenant that was already correct must not change.
- The CDR ingester still reports 0 pending and 0 unparsable after any change to
  it — it is the only thing writing `call_history`, and breaking it stops every
  report at once.

---

# Ring strategies: which of the six actually work

Separate question, researched 2 Sep 2026 against the live queue-agent service
and the live agent records. The dropdown offers six.

## The wiring is correct

The screen's stored values (`src/.../call-queue/constant.ts`) match the switch's
canonical names exactly — `ring-all`, `longest-idle-agent`, `round-robin`,
`top-down`, `agent-with-least-talk-time`, `agent-with-fewest-calls`. The service
also normalises every older spelling it has ever used (`ringall`, `linear`,
`call-linear`, `sequentially-by-agent-order`, `longest-idle`, `least-talk`), so
an old queue keeps working. Nothing is lost between the screen and the switch.

`order_agents()` in `/opt/queue-agent-service/queue_agent_service.py` implements
each one as a real sort, on the figure that defines it:

| Strategy | Sorts on | Works? |
|---|---|---|
| Ring All | nothing — rings everyone together | **Yes** |
| Top Down | tier level, then position | **Yes** |
| Longest Idle Agent | `last_bridge_end` | **Yes** |
| Round Robin | `last_offered_call` | **Yes** |
| Agent With Fewest Calls | `calls_answered` | **Yes** |
| Agent With Least Talk Time | `talk_time` | **No — see below** |

## Agent With Least Talk Time cannot work

Checked all **37 agent records**. Eight have genuine activity — `calls_answered`
between 1 and 6, matching `total_calls`, and real `last_bridge_end` /
`last_offered_call` timestamps. So the counters that the other strategies need
are being written.

**`talk_time` is 0 on all 37, and so is `total_talk_time`** — including for the
agent who has answered six calls. Nothing anywhere records how long anybody has
been talking.

A sort where every key is equal is not a sort. It ties on every comparison and
falls through to the tie-breaker, which is tier order — so choosing this
strategy gives you **Top Down**, silently, under a different name.

Two others are honest by comparison: Longest Idle Agent and Round Robin also
read zero for the 29 agents who have never taken a call, but that is correct —
somebody who has never been offered a call *should* sort as most idle.

## And the preview was describing the wrong strategy

`ring-preview.tsx` read `settings.ring_strategy.type`. That path is **written
nowhere in the form** — every other reference, the select included, uses
`settings.ring_strategy.value`. So the read was always `undefined`, and the
"What a caller would experience" walkthrough fell back to its default,
`all-at-once`. **It described Ring All whichever strategy you picked.** With Ring
All selected it looked right by coincidence, which is why it survived.

Fixed. The preview now reads the path the select writes.

Also corrected in the same pass: the preview mapped
`agent-with-least-talk-time` to `longest-idle-first`, which would have shown a
caller experience that cannot happen. It now maps to `in-order`, matching what
the switch really does with it.

## What the customer now reads

Every strategy already had a plain-English line under the dropdown
(`DEPARTMENT_RING_STRATEGY_DESC`), and they are good. The only change needed was
truthfulness: Agent With Least Talk Time now says it is not working yet, why,
and which two strategies to use instead for the same goal.

## To make Least Talk Time real

Something has to write talk time onto the agent record when a call ends. The
figure exists on the call — `billsec` is already in `call_history` — and
`upload_recording.lua` already fires as a hangup hook, so there is a place that
runs at the right moment with the right ids to hand. *Retest:* answer two calls
of clearly different lengths on two agents, confirm `talk_time` differs, then
confirm the shorter-talking agent is offered the next call.
