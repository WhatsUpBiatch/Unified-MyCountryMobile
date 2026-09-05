# Build project — Make the settings real (Agent 1)

**Prepared:** 2026-08-31 by the orchestrator (mycountrymobile-web-11), from the
control-checked audits. **Status: DRAFT — dispatches to Agent 1 on user approval.**

**The one-line mission:** the portal already saves almost everything correctly;
the switch and backend read almost none of it. This project wires the stored
settings into real behaviour, in the order that unblocks the most.

**Relationship to other documents (read, don't restate):**
- `docs/agent1-parity-build-brief.md` — the portal-side parity brief (58 items).
  This project is its enforcement-side companion. Its §0 ground rules apply here.
- `docs/company-security-build-plan.md` — Phase 5 items continue that plan.
- `docs/company-build-list.md` — the control-checked evidence behind Phases 1–4.
- `docs/admin-audit-tracker.md` — the state machine. Every item below has (or
  gets) a tracker row; states move only per `run-the-audit-loop`.

## Ground rules (read every item against these)

1. **Nothing is finished on your say-so.** You set CLAIMED with evidence;
   only Agent 3's retest sets CONFIRMED. Every item's Test column is the retest
   Agent 3 will run — build with it in mind.
2. **Don't ship a control without its consumer.** If an item lands the consumer
   for a stored setting, flip its badge to `active` **in the same commit**. If
   behaviour isn't landing yet, the badge stays honest. The pattern is
   `SettingCard`'s `status` / `enforced` / `enforcementNote` — reuse it, never
   invent a second one.
3. **Merge, never replace** on the shared "Company Default" template row and on
   `forward_call_actions` — use the namespaced-merge save path C1 established.
4. **One session per file area; claim files in chat before editing.** Live
   collisions have already happened three times. Currently claimed:
   `dialplan_service.py` (you, business hours). Agent 2's pending user-run
   scripts touch `fs-xml-api` (F3) and FreeSWITCH config (F1) — reconcile
   ordering with the orchestrator before both land.
5. **Call-path writes the sandbox refuses** → hand the user a one-command
   script following `backend-patches/*/apply.sh` (backup, apply, restart,
   health-check, auto-rollback). Remember `ssh host "bash -s -- --apply" < file`.
6. **fs-xml-api caches one DB connection without autocommit** — after any edit,
   restart the service and verify mtime < process start, or new data stays
   invisible.
7. **Never write the reference product's name** into code, UI text, comments,
   or migration names.
8. **Verify the security port before any backend rebuild.** Commit `2cc920d`
   (your port of the two dist-only fixes) is CLAIMED, not CONFIRMED. Before the
   first deploy built from source, diff the built output against the running
   dist for the AuthMiddleware log routes and the own-role guard.

## Phase 0 — unblockers (destinations must exist before routing to them)

| ID | Today | Build | Files | Data shape | Test (Agent 3 will run this) |
|---|---|---|---|---|---|
| E0 | **In flight — yours already.** Dialplan never checks the clock; every call takes the in-hours route | Clock check + after-hours branch (your current claim; equals tracker F5) | `/opt/fs-xml-api-1.2.5/dialplan_service.py` on mcm-new | `call_handling.business_hours` + `closed_hours` (both already stored/parsed by `releaseDidForwarding`) | An after-hours test call routes to the closed destination; an in-hours control call routes normally; service restarted after edit (rule 6) |
| E1 | **No voicemail exists at the switch.** `mod_voicemail` commented out (`modules.conf.xml` line 26); zero `.wav` ever. Every "then what" falls back to a destination that isn't there | Investigate why it was disabled, load it, wire the VOICEMAIL branch to it for real | `/etc/freeswitch/autoload_configs/modules.conf.xml`, voicemail.conf (already serves 200) | n/a | `show application | grep '^voicemail'` non-empty; an unanswered test call leaves a message; a `.wav` exists in the store |
| E2 | **CORRECTED 1 Sep (Agent 1's live audit):** there are TWO queue engines. `mod_callcenter` loads but its config is an empty `<queues/>` stub that routes nothing; the REAL engine is `/opt/queue-agent-service/queue_agent_service.py`, reading queues from **MongoDB** (not MySQL — `call_queues` is empty in every tenant DB; searching MySQL/dialplan gives the wrong answer). 5 of 24 queue-screen settings work (all 7 ring strategies, tiered widening, duty tracking, wrap-up, hold music); 17 are stored-only | Await the user's engine ruling (retire mod_callcenter vs consolidate). Meanwhile Agent 1 is adding the three no-answer exits (`no_agent_available`, `all_agent_busy`, `closed_hour_action`) then `max_wait_time` to the live engine | `queue_agent_service.py` (claimed by Agent 1, 1 Sep) | Queue settings blob per queue in MongoDB | A call to a queue with all agents signed out follows the configured exit instead of waiting forever; a staffed control queue rings normally |
| E3 | IVR is one missing branch from working (tracker F3): app available, config 200, admin UI complete, dialplan never invokes it. User-run script `backend-patches/fs-xml-api/apply-ivr-route.sh` exists — **same file as your E0 claim; agree order first** | Branch emitting `{"application":"ivr","data":<menu_name>}` — via the script or folded into your E0 edit | `dialplan_service.py` | IVR route type on the DID's forward actions | Calling an IVR number plays the menu; keypress routes; a non-IVR control number still routes as before |

## Phase 1 — honesty labels (an afternoon; do between/alongside Phase 0 waits)

| ID | Today | Build | Files | Data shape | Test |
|---|---|---|---|---|---|
| E4 | Ring time badged `active`; switch hardcodes 30/60/30 | Badge → `app-only` + note the switch still rings a fixed time (flip back in E8's commit) | `company-ring-time.tsx` | n/a | Screen shows the honest badge; note names the fixed timing |
| E5 | Two Calling transfer switches claim people "are stopped" — true in-app only; a registered SIP device bypasses | Scope the wording to this app | `company-calling-permissions.tsx` | n/a | Wording verified on the live page |
| E6 | Phone rules, Greetings, Holidays carry **no badge at all** and reach the switch for nothing | Add honest badges (worse than a wrong badge — admins assume they work) | `company-rules-form.tsx`, holiday/greeting pages | n/a | Each section shows its badge on the live page |
| E7 | The two screens where an admin *builds* the permission tree say nothing about it being advisory (tracker P1 — "smallest fix in the audit") | Same warning the describing screens already carry | `directory/roles.tsx`, `roles/add-new-role/role-permissions/index.tsx` | n/a | Both live screens carry the warning |

## Phase 2 — routing: the remaining "who rings / then what"

| ID | Today | Build | Files | Data shape | Test |
|---|---|---|---|---|---|
| E8 | Ring duration hardcoded (`call_timeout=30/60/30`, lines 255/285/327) | Read the stored value; flip E4's badge back to `active` in the same commit | `dialplan_service.py`; `company_ring_time` in the Company Default row | seconds int | Set 15s; caller reaches "then what" at ~15s not 30; control: unset company falls back to default |
| E9 | Only EXTENSION and VOICEMAIL branches exist; queue/department/IVR route types log "unhandled" and the call fails (tracker F4). Nine of eleven forwarding options can't connect | QUEUE and DEPARTMENT branches (IVR is E3). Gate on E1/E2 destinations existing | `dialplan_service.py` | route `type`/`value` pairs already stored per DID | Each route type connects a test call; an unknown type fails gracefully, not silently |
| E10 | DND stops nothing; personal call rules never affect a call; the app even renders a precedence order that doesn't exist (tracker M3+P2+P3 — one root cause) | Directory service/dialplan reads `do_not_disturb` and personal forwarding before building the dial string; fix the precedence text to match what's built | directory service, `dialplan_service.py`, `call-rules/index.tsx:324` | `do_not_disturb` bool, forwarding rules on the user row | DND set → call goes to voicemail (needs E1); DND clear control rings; forwarding rule honoured |
| E11 | Calling restrictions enforced only in the browser; the dialplan bridges any non-extension to the carrier; a registered SIP device bypasses everything (tracker D1 — "the money one") | Country/permission check in the dialplan builder before the outbound bridge, reading the stored company calling permissions | `dialplan_service.py`; `company_calling_permissions` | country allow-list + permission flags | A barred-destination call from a **registered SIP device** is refused; an allowed control call completes |
| E12 | A mistyped 3–5 digit extension matching no user falls through and is dialled to the carrier as a real call (D2) | Fail the call on no-match instead of bridging | `dialplan_service.py` | n/a | Dialling a non-existent extension returns an error tone, not a carrier call |
| E13 | `force_transfer_context=xfer` points at `/etc/freeswitch/scripts/xfer.lua`, which does not exist (D3). Blast radius unknown | Establish blast radius first, then either restore the scripts or repoint the context | `vars.xml`, scripts dir | n/a | A transfer completes; scripts dir listing matches config |

## Phase 3 — media: recording, greetings, transcription

| ID | Class | Today | Build | Test |
|---|---|---|---|---|
| E14 | **Regression** (22 Aug per your own note — diff the old build; the old behaviour is the spec) | Four recording scripts reference only each other; nothing invokes `record_session`; zero recordings ever | Automatic + on-demand recording with the two announcements, honouring the stored recording policy and Policies' access rules | A call with recording on produces a file; announce plays; recording off control produces none |
| E15 | Gap | Greetings/hold music stored, never played | Welcome + hold music once a route plays anything (needs E2 for queue hold) | Caller to a greeting-configured number hears it; control without one hears default |
| E15b | Gap — **root cause, do first in this phase** | Hold music, queue welcome, waiting announcements, recording announcements and IVR audio ALL point at a media container holding **zero audio files** of any format (Agent 1, 1 Sep). One storage fix unblocks all five consumers | Fix the media store: make uploads land there and the switch read from there; seed defaults | An uploaded greeting appears in the container and plays on a test call; the container listing is non-empty |
| E16 | Gap | Nothing transcribes; **and nothing bills for it** (work-order item 9 — confirmed missing while AI metering 7/8 and MMS 10 are BUILT: do not touch those) | Transcription pipeline + metering through the same helper pattern as SMS/MMS | A transcribed call yields text AND a charge; transcription-off control yields neither |

## Phase 4 — security & money (continues `docs/company-security-build-plan.md`)

| ID | Today | Build | Test |
|---|---|---|---|
| E17 | MFA storage/TOTP/backup codes built on `feat/mfa-storage` (78 tests), local only; login never asks; screen honestly coming-soon | Run the migration, wire enrolment+challenge into login, deploy, unlock the Security screen (same-commit badge rule) | Login with MFA-enabled test user demands the code; wrong code refused; exception-list user skips |
| E18 | IP allowlist saved, never checked | Enforce in AuthMiddleware per the security plan | Sign-in from a non-listed IP refused for that company; control company unaffected |
| E19 | No company change log at all (the plan's C5 — new `company_events` table; follow the existing migration convention, name a recent migration as the example before writing one) | Table + writes from the settings save paths + the filterable screen | A settings change appears in the log with actor and timestamp |
| E20 | `fix/buy-license-server-side-amount` branch compiles, undeployed — customers can still set their own price via `payment.charge_amount` | Deploy it (respecting ground rule 8 first) | A tampered charge_amount is ignored server-side; the correct price is charged |
| E21 | Releasing a number soft-deletes locally only; DIDWW keeps billing (tracker N1/X1) | Call the wholesale-API release path (`DidwwHelper` plumbing exists) from `releaseDid()`; mind N3's two-dialect trap — establish which client before wiring | Release a test number; carrier portal/API shows it gone; DB soft-delete control still intact |

SAML (security plan C3) is deliberately **deferred** — biggest lift, lowest current demand. Recorded here so nobody "discovers" it.

## Phase 5 — appended 2 Sep (handoffs from outside the Company loop)

| ID | Today | Build | Files | Test |
|---|---|---|---|---|
| E22 | Contact saves silently drop social fields — validation refuses what the model can't store anyway | **Three changes, all together** (partial application re-breaks it): widen social + `.unknown(true)` in `createContactValidation` AND in `bulkContactItemSchema` (both `src/schemas/Contact.ts`), plus the three fields added to `contactSocialSchema` in `src/models/tenant/ContactModel.ts` | contact-api on the .215 box | **Save-and-reopen, not status codes**: create a contact with the social fields, re-fetch, read the stored document directly (contacts live in per-tenant Mongo DBs); include the bulk route as its own case |
| E22b | `Validator.ts` returns only the first refusal, hiding the other two | Deliberately DEFERRED — returning all details changes the error shape the website parses. Own item, never folded into E22 | contact-api `Validator.ts` + website error parsing | n/a until scheduled |
| E23 | `/var/www/prod/contact-api/.env` has unquoted values — `DB_CONNECTION_STR` splits on its `&` when sourced, and the Mongo URI (with credentials) leaked into a session transcript once already | Quote the values. (Rotating that DB password stays the user's call — previously deferred by the user, not re-raised here) | contact-api `.env` on .215 | Sourcing the file yields the full unsplit URI; service restarts clean |
| E24 | campaign-api pacing deploy still outstanding | Separate bundle with its own prompt — **do not merge with E22** | campaign-api | Per its own bundle's verification |

## Do not rebuild (verified working — leave alone)

Sites CRUD; plans/billing alignment; AI reply/minute metering and renewal reset
(the reset is a spread helper return — greps for column names find nothing and
that's fine); MMS rate cards; identity/address verification (genuinely wired to
the carrier); C1–C5 fixes; the parity brief's §0.7 list (Apply to people,
profile fields, policy lock notes, per-device ring modelling,
transcription/AI-monitoring interlock, idle timeout); M2's ProtectedRoute
wrappers (checked — not a hole).

## What this brief did NOT verify

- Which box(es) actually run `dialplan_service.py` — records say mcm-switch,
  you verified mcm-new. Reconcile before assuming a fix covers all traffic.
- Commit `2cc920d`'s port completeness (ground rule 8).
- Whether N2's two forwarding writes land on the same row (tracker says prove
  it on a live record first).
- Agent 3's A1–A8 Company audit is still running — its report may append items.
  Anything it bounces follows the normal loop: Agent 2 re-plans, you rebuild.
