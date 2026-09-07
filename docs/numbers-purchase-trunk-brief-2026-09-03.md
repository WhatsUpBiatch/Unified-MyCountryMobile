# Numbers module — purchase, trunk assignment, and DB integrity

Build brief + shared tracker for a two-session build: **Agent-1.1** (215 — this repo,
frontend) and **Agent-1.2** (121 — `default-api` backend + the shared MySQL database).
Coordinating session: this one.

**Status legend** (see `run-the-audit-loop`): OPEN → CLAIMED → CONFIRMED / HONEST / WONTFIX.
Only the auditor (whichever side did *not* build the item, or the coordinating session)
may move a row to CONFIRMED, and only on a retest they ran themselves — never on the
builder's own report.

---

## 0. Correction before anything else — read this first

The task that produced this brief described the split as "db and frontend on 215,
APIs backend on 121." That does not match what tonight's work independently verified,
repeatedly, against the live boxes:

- **121 (`mcm-new`) hosts both the database and `default-api`.** Confirmed by direct
  SSH + MySQL queries against it all night, and by an earlier task's own explicit
  instruction: *"Do not attempt this from 215; it has neither the mysql client nor
  network access to the database."*
- **215 is frontend-only** — this repo (`mycountrymobile-web`), built and deployed as
  static assets. It has no DB credentials and no network path to the database.

So the split below is **121 = database + backend (all of it), 215 = frontend only**.
If "db on 215" meant something else — a local cache, a different datastore, a plan to
move something — say so explicitly before Agent-1.1 is asked to touch anything DB-shaped,
because right now it structurally cannot.

---

## 1. What's already true, verified tonight — do not re-derive, do not rebuild

- Three real DIDWW numbers were purchased directly against DIDWW's v3 API tonight
  (the app's own buy flow is item B1) and manually linked into `did_numbers`:
  `+12135107512` (Sk3Group), `+16059713935` (Sushil Company), `+15155814131`
  (TestersCompany). All three are confirmed trunked to DIDWW's real "unified" trunk
  (`30842888-2407-49d5-8dcc-6858aa7023ef`, host `142.93.121.121`) — verified by
  querying that trunk's DID list directly, not by trusting a success response.
- **The read side is already correct — leave it alone:**
  - `POST /api/numbers/list` → `DidController.list` (Admin > Numbers > All numbers):
    scopes by `company_uuid`/`role`, correct LEFT JOINs, no bug found.
  - `POST /api/did/user-assigned` → `DidController.getUserAssignedDid` (Settings >
    "How calls reach you" > Direct number, same list the dialler's caller-ID picker
    reads): scopes by `company_uuid` + `user_uuid`, response shape traced end to end
    (`paginate()` → `sendSuccess` → `data.data.result.rows`), deployed dist matches
    source exactly. No bug found here either.
  - Both were traced fresh tonight in response to "I can't see the new number" — the
    likely explanation there was a stale 5-minute React Query cache
    (`src/App.tsx` queryClient defaults), not a backend defect. If either screen is
    *still* wrong after a hard refresh once B1–B4 below are done, that's new
    information — don't assume the earlier trace was wrong, re-trace it.
- Confirmed the migration convention: timestamped files in `default-api/migrations/`
  (not the `tenant/` subfolder — `did_numbers` is a main-DB table), e.g.
  `20260903120000-fix-users-role-system-key.js`. `did_numbers` was created by
  `20260506110015-sync-did-numbers-table.js`.

## 2. What was reported but NOT independently verified by this session

- **UPDATE (121, this session, later pass):** the "wrong path" theory in B1's original
  framing does not hold up — full trace done, see the rewritten B1 for the real call
  chain and the two concrete bugs found in it. Still genuinely unverified: whether the
  404 a user actually sees traces to the stale-`available_did_id` hypothesis in B1
  point 4. That needs a live, timed purchase attempt to confirm — this session has no
  browser/UI access to run one.
- **B2's env var is not "stale," it's a different real trunk.** Agent-1.2 checked
  DIDWW's `voice_in_trunks` list directly: `ab98da32-501f-4647-ab4d-4963404056c6` (what
  `DIDWW_VOICE_TRUNK` points at today) is a genuine, named trunk called **"ucaas"** —
  not a typo or leftover, an actual different trunk, presumably correct for a different
  deployment. `30842888-...` ("unified") is the one this deployment needs. Worth
  understanding *why* two trunks exist before just swapping the env var, in case
  "ucaas" is still load-bearing somewhere else.
- Whether the Add Number wizard shows a raw error, a silent failure, or something else
  when B1's bug fires — not checked tonight (all three purchases went around the UI
  entirely, straight to DIDWW's API). See F2.

## 3. Ground rules — apply to every item below, both sides

1. **Nothing is finished on the builder's own say-so.** Mark your own items CLAIMED,
   never CONFIRMED. The other side (or this coordinating session) retests and
   confirms. Report CLAIMED in the shared channel with what you'd want the retester
   to check — don't make them re-derive your test plan.
2. **A purchase that "succeeds" but lands on the wrong trunk is worse than one that
   visibly fails.** B1 and B2 are sequenced together for this reason — do not
   consider B1 done until B2's trunk check has run against a real purchase made
   through the fixed flow, not against tonight's three manually-linked numbers.
3. **Schema changes need a migration, not a hand-edit.** Follow the convention in
   §1. Update the Sequelize model (`DIDNumber.ts`) in the same change as any migration
   that adds a constraint — models and migrations drifting apart is exactly the kind
   of gap B5 already found once (a column the model selects that nothing ever wrote).
4. **Never write "DIDWW" into any user-facing string.** Internal code, comments, env
   vars, this document — fine. UI copy, error messages a customer could see — say
   "the carrier" or "your number provider," not the vendor name.
5. **If you find something adjacent that looks wrong, add it as a new row with OPEN
   status and your initials — don't fix it inline inside another item's diff.** Scope
   creep inside one PR is exactly what produced the four-call-sites problem B1 is
   about to untangle.

## 4. Items — 121 (Agent-1.2: database + `default-api` backend)

### B1 — OPEN — REVISED after full code trace (121, this session) — Buy-a-number is
### split across two calls, and the real purchase step has two live bugs, not a wrong path
**Correction to the original framing:** The "/order vs /orders" theory does not hold up.
Full trace of the live call chain, source-verified line by line:

1. Frontend `PaymentModal` (`add-number-new/modal/payment-modal/index.tsx`) fires
   `didCreateOrder` → `POST /api/didw/create-order` → `DidwwControllerOwn.createOrder`
   (`controllers/DID/DidwwControllerOwn.ts:612`). For `type==='stripe'`, this **only
   authorizes the Stripe payment** — the actual DID-purchase code that used to live
   here (call `findDID`, `placeDidOrder`, create the `DIDNumber` row) is commented out
   (lines ~782-834), and the function returns "payment authorized, processing" without
   buying anything. This *looks* deliberate — the real purchase is a separate second
   call — but the dead code was left in place instead of removed, which is exactly how
   the confusion started.
2. Frontend then fires `didCompleteProcess` → `POST /api/did/complete-did-process` →
   `DidController.completeDidProcess` (`DidController.ts:2196`) → delegates to
   `CommonHelper.buyDidProcess` (`helpers/CommonHelper.ts:1550`). **This is the actual,
   live purchase path.** It calls `findDID(currentDidId)` then
   `placeDidOrder(findValue.id, findValue.sku)` — `placeDidOrder` already posts to the
   *correct* `${DID_WW_URL}orders` (plural). No wrong-path bug found anywhere in this
   chain.
3. **Two real bugs found directly in `buyDidProcess` (`CommonHelper.ts:1550-1631`):**
   - Line 1583: `// const addTrunkValue = await addTrunk(didUniqueId); //commented APR-P`
     — trunk assignment is not just pointed at the wrong ID (B2), it **never runs at
     all** on this path. Confirms and extends B2: even after B1 is otherwise fixed, a
     purchase through this exact code never touches a trunk.
   - Lines 1608-1609: `monthly_cost: 0.0, setup_cost: 0.0` — hardcoded to zero
     regardless of the real SKU price. Every number bought through the app would bill
     wrong. New finding, filed as B7.
3b. **MAJOR REVISION (121, this session) — there are TWO independent live purchase
paths for the same button, not one.** Checked the deployed dist directly (not just
source) to settle the dist-vs-src question: `CommonHelper.js` on 121 matches TS source
exactly for `buyDidProcess` (commented-out `addTrunk` confirmed present in the running
process, not just in git). But `CommonHelper.js` also contains a *second*, more
correctly-built function, `addDidNumber` (real `monthly_cost` from `requestedData.amount`,
live `addTrunkWholesale` call, not commented out) — and it has a live caller neither
of us had traced yet: `Stripe/PaymentController.js`'s `processManualCaptureDidPurchase`,
triggered by the registered webhook `POST /webhook/payment-status` →
`paymentStatusWebhook` (`paymentRoute.js:33`), gated on Stripe metadata
`triggered_by === 'did_purchase'` and `status === 'requires_capture'`.
So for a Stripe-billed purchase, **both of these fire for the same customer action**:
`PaymentModal` synchronously calls `didCompleteProcess` → `buyDidProcess` (broken:
no trunk, $0 cost) — *and*, asynchronously, Stripe's webhook calls
`processManualCaptureDidPurchase` → `addDidNumber` (correct: real cost, live trunk
call, even if pointed at the wrong trunk per B2). **Not yet confirmed: whether this
means two DID rows get created per purchase (double-buy), whether one call fails
loudly enough to prevent the other, or whether one is dead in practice and just never
triggers.** This needs someone to trace whether `didCompleteProcess` is even reached
before the webhook fires, or watch a real purchase's logs on both paths. Filed as its
own priority under B1 — do not fix `buyDidProcess` in isolation without settling this,
fixing the wrong one of two competing paths would look like success and still be broken.
4. **Best hypothesis for an actual 404, not yet confirmed live:** `findDID` calls
   DIDWW's `available_dids/{id}` — an *ephemeral* browse-time inventory hold, not a
   durable reservation. `currentDidId` is threaded through from the original
   number-search step, all the way through identity verification, address, and
   payment — real wall-clock time. If DIDWW's hold on that specific `available_did_id`
   expires before `completeDidProcess` runs, `findDID` or `placeDidOrder` would
   legitimately 404 *from DIDWW*, and whatever wraps that error is what a user sees.
   This was not confirmed against a live browser session (no UI access from this
   session) — needs a real end-to-end timed purchase attempt to confirm or rule out.
**Build:** Once the 404 source is confirmed (stale hold vs. something else), fix at
that point. Regardless, remove the commented-out dead code in `createOrder`, fix the
zero-cost bug (B7 — split out, may be done separately), and do not restore trunk
assignment here — that's B2, sequence together, same as before.
**Files:** `default-api/src/controllers/DID/DidwwControllerOwn.ts` (`createOrder`,
lines ~612-889 — note `createOrder2` at line 891 is a *third*, seemingly newer/unused
implementation calling `createOrderInternal` + `CommonHelper.addDidNumber` — confirm
whether it's live anywhere before touching it, don't assume it's dead), `DidController.ts`
(`completeDidProcess`, line 2196), `CommonHelper.ts` (`buyDidProcess`, line 1550).
**Test:** Purchase one real US number through the app's own Add Number UI end to end,
timing each step. Confirm success in the UI AND a `did_numbers` row appears with no
manual SQL AND the row has a non-zero `monthly_cost`. Keep it small — real charge.

### B7 — OPEN — new, found during B1's trace — Purchases always bill $0.00
**Wrong today:** `CommonHelper.buyDidProcess` (`CommonHelper.ts:1608-1609`) hardcodes
`monthly_cost: 0.0, setup_cost: 0.0` on every `DIDNumber` row it creates, regardless
of the SKU actually purchased.
**Build:** Use the real price from the SKU DIDWW returned during search/reservation
(same value `findDID`'s response or the reservation step already carries — do not
re-fetch, thread it through).
**Files:** `default-api/src/helpers/CommonHelper.ts` (`buyDidProcess`).
**Test:** A number bought through the app shows the SKU's real monthly/setup price in
`did_numbers`, not zero.

### B8 — CLAIMED (edge containment only, code fix still OPEN) — two unauthenticated
### endpoints can place real orders — NOT equally dangerous, and gates B1
**CONTAINED at 08:49 UTC 2026-09-04** (Agent-1.2, nginx-only, no app code touched):
`location ~* ^/api/(purchase-did|didw/order)/?$ { return 403; }` added to the api2
server block in `/etc/nginx/conf.d/ucaas-lb.conf` (backup:
`ucaas-lb.conf.bak-b8lockdown-20260904-084959`), case-insensitive + optional trailing
slash on purpose since Express itself tolerates both. Verified: both paths (plus
`/API/Purchase-DID`, `/api/didw/order/`) return 403 through nginx; `didw/create-order`
and `did/purchase` still 401 as normal; `group-types`/`country-list` still 200 — the
legitimate browse endpoints are untouched. Real containment, not theatre — confirmed
port 3000 only binds locally reachable via nginx (ufw default-drops everything else).
**This is containment, not a fix — the routes are still unauthenticated at the
application layer.** Do not mark this row CONFIRMED until `auth` middleware (or
deletion) lands in source and is retested independently of the nginx block.

**The two endpoints are not equally dangerous — verified against prod source:**
- `POST /api/purchase-did` (`AuthController.js:3025`, routed `authRoute.js:74`, no
  middleware): reads **nothing** from the request — no token, no body, no user. An
  empty POST calls `getSkuID()` and posts a real order to the carrier's `/v3/orders`
  (correct plural, valid base URL) with `allow_back_ordering:true, qty 1`. **This one
  was genuinely live and loopable**: anyone could buy a number, billed to this
  account, attached to no user, untraceable to who did it.
- `POST /api/didw/order` (`DidwwControllerOwn.js:482`, routed `didWRoute.js:23`,
  comment "used for testing", no middleware): needs a non-empty `available_did_id[]`
  and posts to `${DID_WW_URL}order` — **singular**, not a real carrier v3 route — so it
  currently 404s and cannot spend money. **This is the actual origin of the original
  "/order vs /orders" theory** — it was never in the live purchase path (B1), it's in
  this dead-but-reachable test endpoint.

**Critical ordering constraint, from Agent-1.2 — sequence B8's code fix before B1:**
`/api/didw/order`'s 404 is the *only* thing currently protecting it — it's wrong-path,
not unauthenticated-and-safe. If B1's fix repoints the base URL DIDWW calls use
correctly, and B8's code fix hasn't landed first, this unauthenticated endpoint goes
from "broken" to "live and unauthenticated" in the same change. **B1 is not done, ever,
while `/api/didw/order` is still reachable without auth — check this explicitly before
closing B1, not just before closing B8.**

**Exposure:** nginx logs 25 Aug–4 Sep show zero requests to either path — no sign of
exploitation. Frontend call-site check (this session, 215): grepped the entire
`mycountrymobile-web` source tree for both `purchase-did` and `didw/order` (multiple
casings) — **zero hits for either.** Only `didw/create-order` (a different, legitimate
endpoint, part of B1's real chain) appears anywhere in the frontend. Nothing in this
codebase's UI calls either vulnerable route. Combined with Agent-1.2's log evidence,
this points at "delete the route" over "add auth middleware" for both — neither has a
known legitimate caller, frontend or otherwise.
**Build:** Land the application-layer fix — delete both routes if nothing depends on
them (recommended, given zero callers found on both sides), or add `auth` middleware
if a legitimate caller turns up that this session and Agent-1.2 both missed. Do this
**before** touching B1.
**Files:** `default-api/src/routers/didWRoute.ts` (or `.js` — confirm which is the
live artifact, see the dist-vs-src note elsewhere in this doc) line ~23,
`default-api/src/routers/authRoute.ts`/`.js` line ~74, `AuthController` (`purchaseDid`),
`DidwwControllerOwn` (`createOrderNEW`, referenced by `/order`).
**Test:** `curl -i -X POST https://api2.mycountrymobile.com/api/purchase-did -d '{}'`
and the same for `/api/didw/order` — expect 401 (not 403 from nginx, not 200) once the
code fix lands, proving the application itself now rejects it independent of the edge
block. Then re-run B1's retest and confirm both still reject with the app running the
fixed order-placement code.
**Priority:** urgent, and blocking — nothing in B1 ships until this row's code fix
(not just the nginx containment) is CONFIRMED.

### B2 — CLAIMED (Agent-1.2, 2026-09-04 09:37 UTC, owner-authorised) — Trunk
### auto-assignment points at the wrong trunk — NOT YET CONFIRMED, real-purchase test still owed
**Independently verified by this session (121, read-only), matches Agent-1.2's report
exactly:**
- `default-api/.env:38` now reads `DIDWW_VOICE_TRUNK=30842888-2407-49d5-8dcc-6858aa7023ef`
  (was `ab98da32-...`/"ucaas"). Backup `.env.bak-b2trunk-20260904-093758` present on disk.
- `pm2 describe default-api`: online, 95 restarts (was 91), uptime 5m at check time —
  consistent with Agent-1.2's timeline, not just a claim.
- B8 containment still intact after the restart: `purchase-did` → 403, `didw/order` →
  403, `didw/create-order` → 401. Re-curled myself, not taken on trust.
**Still open, not CONFIRMED:** the actual proof — a real purchase landing on
`30842888-...` per DIDWW's own API, not the app's success response (see AG1.2-f below
for exactly why the app's response can't be trusted as evidence). Agent-1.2 flagged
this explicitly as needing spend approval and did not do it themselves. **Decision for
the user, not either agent session: authorize one real, cheap test purchase to close
this out, or hold.** See end of this message.
**Two behaviour changes flagged by Agent-1.2, worth knowing before the retest, not bugs:**
1. Caller-ID format changes from raw to E.164 for numbers landing on "unified" vs
   "ucaas" — inherent to being on the correct trunk, matches the 4 DIDs already there,
   but is a visible change.
2. The 4 existing "unified" DIDs carry no `capacity_pool`; `addTrunk` sets
   `capacity_pool=63e445e1` ("Standard") alongside the trunk. That exact combination
   has never been exercised — account has 61 DIDs, all assigned, no spare to rehearse
   on. Expected to work (same shape succeeded for ucaas+Standard on row 31) but
   unproven. **This is what the real-purchase test in the row above actually needs to
   confirm**, not just the trunk id.
**Rollback, one command, on 121:**
`cp /var/www/prod/default-api/.env.bak-b2trunk-20260904-093758 /var/www/prod/default-api/.env && pm2 restart default-api --update-env`

**Original finding, for context:** Neither `DIDWW_VOICE_TRUNK` (`ab98da32-501f-4647-ab4d-4963404056c6`)
nor `DIDWW_VOICE_TRUNK_WHOLESALE` (`fee437bc-7f31-422f-8451-e094e872ca52`) — the two
trunk IDs the app's own code currently uses — match the real "unified" trunk
(`30842888-2407-49d5-8dcc-6858aa7023ef`, confirmed by reading it directly off a
working number's `voice_in_trunk` relationship on DIDWW's own API). A number bought
through a fixed B1 would still land on the wrong trunk and silently never ring.
**Build:** Point trunk assignment at the correct ID. Better than hardcoding a second
UUID that can drift again the same way: have the code look up the trunk by name
(`"unified"`) via DIDWW's `voice_in_trunks` list at startup or purchase time, and fail
loudly if it doesn't find exactly one match, instead of trusting an env var nobody
re-checks.
**Files:** `default-api/.env` (or wherever the lookup moves to),
`default-api/src/helpers/didHelper.ts` (`addTrunk`, `addTrunkWholesale` — see B1 point
3b: there are now two live purchase paths, `buyDidProcess` (addTrunk commented out
entirely) and `addDidNumber` (calls `addTrunkWholesale` live, pointed at the wrong ID)
— fix both, they need different treatment, not "the one that's live," both are).
**Correction (Agent-1.2), then a scope correction on top of it (this session, verified
against the exact lines):** an earlier claim that `addTrunk` is never called anywhere
was a bad grep against compiled output (`addTrunk(` doesn't match minified
`(0, didHelper_1.addTrunk)(id)`) — it IS called live. But `DidwwControllerOwn.js:1110`
is **inside `buyFreeVirtualNumber` (function starts line 1080)** — the *free* virtual
number flow, not the paid DID purchase path this brief is otherwise about. Confirmed
by reading the function boundary directly, not inferred. So: three purchase-adjacent
functions now traced with `addTrunk`/`addTrunkWholesale` calls (`buyDidProcess` —
commented out, `addDidNumber` — live via `addTrunkWholesale`, `buyFreeVirtualNumber` —
live via `addTrunk`), and they're for two different products (paid vs. free numbers).
`DidwwController.js:433` (a *different* class from `DidwwControllerOwn`) not yet
checked by this session — don't assume it's paid-flow-relevant either without
checking, given the pattern so far of same-sounding names meaning different things.
**Entitlement evidence (Agent-1.2, read-only, no consumer entitled to "ucaas"):** only
one provisioned DID sits on the "ucaas" trunk (row 31, company `d1718d40-...` /
TestersCompany) — and that same company also owns a DID on "unified" (row 34, one of
tonight's three manual inserts). Same tenant, one number per trunk: a defect signature,
not an entitlement boundary. Also: the "unified" trunk id appears **nowhere in code or
env**, yet 4 DIDs are correctly bound to it — someone has been correcting these by hand
in the carrier portal (this session did exactly that, twice, tonight, for the same
reason: nothing automated points at it). Caveat stated by Agent-1.2 and worth
repeating: this reasons over the 5 surviving DIDs only, so it lowers B2's risk from
"unknown" to "small and named," not to zero — it can't see consumers who haven't
purchased recently.
**Data shape:** DIDWW `voice_in_trunks` resource, `attributes.name === "unified"`.
**Test:** After B1's real purchase, `GET` the new DID's `voice_in_trunk` relationship
directly from DIDWW's v3 API (not the app's own DB) and confirm it resolves to
`30842888-2407-49d5-8dcc-6858aa7023ef`. Do not consider this confirmed from the app's
success response alone — that's exactly the failure mode this item exists to catch.

### B3 — OPEN — No reconciliation between DIDWW and `did_numbers`
**Wrong today:** Any number that exists at the carrier but not in `did_numbers` (every
purchase tonight, and anything bought by hand before B1 lands) is invisible to the
product until someone runs SQL by hand.
**Build:** A reconciliation job or admin-triggered action: list this account's real
DIDs from DIDWW (`GET /v3/dids`), diff against `did_numbers.did_number`, and
flag/create rows for anything missing. **Normalize the number format before
comparing** — DIDWW returns bare digits (`16059713935`), `did_numbers.did_number`
stores a leading `+` (`+16059713935`).
**Files:** New — a scheduled job or admin endpoint in `default-api`.
**Data shape:** DIDWW `dids.attributes.number` (no `+`) vs `did_numbers.did_number`
(with `+`).
**Test:** Run it against the live account. It must report zero gaps for the three
numbers already linked tonight (no duplicates created), and correctly flag a gap if
you temporarily rename or soft-delete one of their `did_numbers` rows in a scratch
copy — don't test against production data destructively.

### B4 — OPEN — No DB-level protection against a duplicate `did_number`
**Wrong today:** `SHOW INDEX FROM did_numbers` (run tonight) shows only a **non-unique**
`(company_uuid, did_number)` index. Nothing in the schema stops the same number being
inserted twice — it's prevented only by whoever's running the SQL being careful, which
is exactly why the manual-insert brief tonight had to say "do not re-run this."
**Build:** A migration adding a unique index. **Decide first, don't assume:** unique
on `did_number` alone, or on `(did_number, status)` if a released-then-repurchased
number needs to coexist with a terminated row for the same number — check whether
`status='D'` (or however release is represented) rows for a reused number currently
exist before picking. Update `DIDNumber.ts` in the same change. Handle the resulting
constraint-violation error path in whatever inserts into this table (B1's fixed flow,
B3's reconciliation job) with a clear message — don't let it surface as a raw 500.
**Files:** New migration in `default-api/migrations/` (main folder, not `tenant/`),
following `20260903120000-fix-users-role-system-key.js`'s naming;
`default-api/src/models/DIDNumber.ts`.
**Test:** Attempt to insert two rows with the same `did_number` directly via SQL (in
a non-production copy) and confirm the second is rejected by MySQL itself, not merely
caught in application code.

### B5 — OPEN — `did_status_response` is selected but never written
**Wrong today:** `DidController.list`'s query explicitly selects
`did_status_response`, but it is `NULL` on every row in the table — checked directly
tonight, not just on the three new rows.
**Build:** Decide: either wire it to store the raw DIDWW order/DID response JSON at
insert time (useful for support/audit — "what did the carrier actually say when we
bought this"), or drop the column and its reference in `list` if it's genuinely dead.
Don't leave it half-built either way.
**Files:** `default-api/src/controllers/DID/DidController.ts` (wherever B1's fixed
insert happens), or a migration to drop the column if that's the decision.
**Test:** After B1's purchase, `did_status_response` for that row contains real DIDWW
response JSON — or the column is gone from both the migration history and the model,
your choice, but not left in the current half-state.

### B6 — OPEN — low priority, do not block B1–B4 on this
**Wrong today:** `findDIDNew` in `didHelper.ts` posts to `${DID_WW_URL}number/list`,
which is not a real DIDWW v3 endpoint and appears to be dead code from an earlier
integration attempt.
**Build:** Grep for call sites. If genuinely unused, delete it.
**Files:** `default-api/src/helpers/didHelper.ts`.
**Test:** Zero call sites remain, `tsc --noEmit` stays clean.

### AG1.2-e — OPEN — SEVERE, new (Agent-1.2, 2026-09-04) — 14 of 19 provisioned DIDs
### don't exist at the carrier, active in the UI, cannot ring
**Wrong today:** Reconciled `did_numbers` against the carrier's own API. Of 19 rows
carrying a carrier `did_id`, 4 resolve to trunk "unified", 1 to "ucaas", and **14
return `HTTP 404 "Record not found"`** — verified twice, individually, a second apart,
to rule out rate-limiting; not soft-deleted (`status='A'`, `deleted_at IS NULL` on all
14). Row ids: 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 21, 22, 28, 30, across 9 companies.
Ongoing, not legacy: row 28 = Aug 29, row 30 = Sep 1. These customers see an active
number in the UI that cannot receive a call.
Two distinct partial-write patterns produce this, both leaving `status='A'`: rows
23-27 have a carrier order id but no `did_id`; rows 29, 32, 33, 34 have a `did_id` but
no order id — **more than one code path writes an incomplete row and still marks it
Active.** (Rows 32-34 are the three from tonight's manual inserts — flagged here for
visibility, not as a defect: those three were verified against the carrier at
insert time, see §1. Worth Agent-1.2 double-checking they're not being swept into the
"incomplete" bucket by a query that only checks for a missing `did_id`, since theirs
*is* present.)
**Do not bulk-update these rows.** Until "released at carrier, never reconciled" can
be told apart from "never provisioned, row written anyway," a blind status flip
destroys the evidence needed to tell them apart. This needs its own investigation
before any fix — likely connects to B1 (same broken/duplicate purchase paths writing
incomplete records) but is reported separately because of severity and because a wrong
guess here (e.g., silently releasing/hiding a number that's actually fine) is worse
than leaving it open a little longer.
**Files:** not yet scoped — depends on which of B1's now-two purchase paths (see B1
point 3b) produced which rows; needs that resolved first, or independent investigation
into rows 23-27 and 29/32-34's creation path (check `did_order_id` vs `did_id`
presence against which controller/function was live on each row's `created_at` date).
**Test:** No fix test yet — this is a fresh OPEN row, not ready to build against.
**Priority:** severe, customer-visible, flagged to the user directly below.

### AG1.2-f — OPEN — root cause, filed not fixed (Agent-1.2, verified independently
### by this session against the exact deployed lines) — one purchase-adjacent function
### always reports success, even on total failure — but check the scope before assuming
### it explains AG1.2-e
**Wrong today, confirmed:** `DidwwControllerOwn.js`, catch block ending ~line 1123:
```
catch (error) {
    // errorCount++;
    // errorMessage += `\n${error?.message || error}`;
    console.error("ERROR===========>", error);
    responseObj = { success: true, message: error?.message };
```
Read directly off the deployed file. Real, and exactly as bad as it sounds — this
function returns `success: true` on every thrown error, no exceptions.
**Scope correction, important:** this catch block is inside **`buyFreeVirtualNumber`**
(function starts line 1080) — the *free* virtual number flow, not the paid DID
purchase path AG1.2-e's 14 phantom rows came from. Checked the two functions that
*are* on the paid path: `CommonHelper.buyDidProcess`'s catch block correctly sets
`success = false`; `createOrderInternal`'s (used by `addDidNumber`'s webhook path)
also correctly sets `success: false`. **So this specific bug, as located, doesn't
directly explain AG1.2-e's partial-write pattern** — that connection was a reasonable
hypothesis but doesn't hold on the exact lines. It may still be *a* contributing
pattern if `buyFreeVirtualNumber` writes `DIDNumber` rows the same way (not yet
checked) — someone should verify whether any of AG1.2-e's 14 dead rows have `type`
or other markers indicating they came from the free-number flow specifically, before
ruling it out entirely.
**Build:** Fix `buyFreeVirtualNumber`'s catch block to report the real failure — do
not fix inside B1's diff, this is a free-number bug, not a paid-purchase bug, per the
scope correction above; give it its own row/PR so it doesn't get bundled with and lost
inside B1's larger change.
**Files:** `default-api/src/controllers/DID/DidwwControllerOwn.ts`
(`buyFreeVirtualNumber`).
**Test:** Trigger a free-number claim with a deliberately invalid input and confirm
the API response has `success: false` with the real error message, not a masked
success.

## 5. Items — 215 (Agent-1.1: frontend, this repo)

### F1 — WONTFIX (verify only) — Numbers list and "How calls reach you" are already correct
**Reason recorded:** Both screens were traced end to end tonight (query, response
shape, deployed build) with no bug found — see §1. Decided by this session.
**What Agent-1.1 does:** Once B1–B4 land on 121, log in as one of the three test
accounts and confirm the relevant number is visible on both screens after a hard
refresh. If it is not, that's new information — reopen as a fresh item, don't assume
tonight's trace was wrong, re-trace it against whatever changed.

### F2 — OPEN — Unverified: what does the Add Number wizard show when B1's bug fires?
**Wrong today:** Not established. All three purchases tonight went directly against
DIDWW's API, bypassing the UI entirely, so nobody has seen what a real user sees when
this fails right now.
**Build:** Check it. If it's a raw error, a silent failure, or a confusing generic
message, that's its own defect — file it as a new row. If B1 is going to take a while
to land, consider a temporary honest label ("Number purchase is temporarily
unavailable — contact support") rather than leaving whatever's there now, per this
codebase's existing pattern for flagging not-yet-working capability honestly (check
`docs/` for how other in-progress features are labeled before inventing a new pattern).
**Files:** `src/pages/admin-settings/numbers/all-numbers/add-number-new/` (and the
`add-number-2/` variant — confirm which one is actually live, there appear to be two).
**Test:** Attempt a real purchase through the UI before B1 lands, screenshot what the
user sees, and confirm it's at minimum not misleading (doesn't imply success).

---

## 6. Reporting back to the coordinating session

- Update this file's row status directly (OPEN/CLAIMED/CONFIRMED/HONEST/WONTFIX) as
  you go — this file is the source of truth, not a chat message.
- Send a message alongside any status change pointing at the row and the evidence,
  not just "done."
- If you disagree with an item's scope, priority, or the §0 correction, say so in a
  new row or a note under the relevant item — don't silently reinterpret it.
