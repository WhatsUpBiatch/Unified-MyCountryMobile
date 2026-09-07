# Suspend follow-ups: kick the phone, leave the queues

**NOT DEPLOYED. Nothing here has been run against a server, a switch or a
database.** Built 3 Sep 2026 as uncommitted working-tree edits in
`/root/UCAAS/mcm-repos/{default-api,esl-manager,campaign-api}`; this folder is
the portable copy. Follows `backend-patches/person-states/` (same day), whose
README ends with exactly these two gaps.

## What was still wrong after person-states

Suspending (or removing) a person set `users.status`, ended their sessions,
and - once the switch patches are applied - made the directory refuse their
**next** REGISTER. Two things stayed as they were:

1. **The phone they already had registered kept working** until its
   registration expired on its own (the phone re-registers every 30-60 min).
   Until then it rang, and it could place calls.
2. **They stayed in every queue's agent list.** `endAllSessions()` marks their
   agent rows "Logged Out", which the agent service does not ring, but nothing
   in the queue record said they were off, a re-save of the queue from the
   website rebuilt their agent row as "On Break", and nothing ever took them
   out when they were gone for good.

## What this does, in plain words

| Moment | Phone (A) | Queues (B) |
|---|---|---|
| **Suspend** | ask esl-manager to run `sofia profile internal flush_inbound_reg <ext>@<domain>` for `<ext>` and `<ext>_web` (and any other `<ext>_x` the switch lists) | ask campaign-api to stamp `suspended_member {at, reason}` on their entry in every queue of the company, set their agent rows "Logged Out" + the marker, mark their tier rows |
| **Reactivate** | nothing (they register again themselves) | marker off, exactly; agent rows stay "Logged Out" until they sign in, as always |
| **Remove** | same flush, after the removal's transaction commits | same marker, reason `removed` - so a 72-hour restore is exact |
| **Restore from Removed** | nothing | marker off |
| **72-hour purge** | nothing | member entry, agent rows and tier rows deleted |

**Every one of these is best effort.** One HTTP request each, a hard 3-second
cap, the result logged, never thrown. Suspend and remove still succeed when
esl-manager or campaign-api is down, old, or slow; the phone then lapses at its
next REGISTER as before, and the agent rows are still "Logged Out" from
`endAllSessions()`. What best effort costs: at most 3 s added to a suspend
(the two calls run side by side), and a log line saying `NOT flushed` /
`NOT done` with the reason.

## Which services, which files

### default-api (source `/root/UCAAS/mcm-repos/default-api`, live on mcm-new)

New, copied whole (`default-api/src/services/`):

* `RegistrationKickService.ts` - `kickRegistration(extension, domain, context)`,
  reusable from anywhere. POSTs `{extension, domain}` to
  `ESL_MANAGER_URL` (default `http://127.0.0.1:5555`) `/registrations/flush`,
  3 s, optional `ESL_MANAGER_API_TOKEN` as a Bearer. Pure helpers:
  `domainFromDbName` (the AuthMiddleware formula: `db_name` minus `mcm_` plus
  `DOMAIN_SUFFIX`, `@` -> `.`), `kickRequest`, `outcomeFromReply`.
* `QueueMembershipService.ts` - `setMembership(actor, user_uuid, action,
  {extension, reason}, context)` -> campaign-api
  `POST /api/v1/campaign/queue/member/state` on `CAMPAIGN_PORT`, with the same
  `X-User-*` identity headers `CampaignApiService` sends, 3 s.
  `systemActor(company_uuid, db_name, domain)` is the identity used where no
  administrator is on the request (the delete hook, the purge).
* `PersonRemovalHooks.ts` - **the delete path without touching
  UserController.** `User.destroy({ where: { uuid, company_uuid }, transaction })`
  fires the model's `afterBulkDestroy`; the hook waits for
  `transaction.afterCommit`, looks the soft-deleted row up with plain SQL
  (`users` joined to `companies` for `db_name`), and runs the kick and the
  queue marking. A destroy naming no single uuid (a company wipe) is logged and
  skipped. Never throws into the delete.

Hunks in existing files - `default-api/patch_suspend_followups_src.py`
(anchored, asserted, idempotent; run twice here):

* `src/services/PersonStateService.ts` - `suspend()` calls `afterSuspend()`
  (kick + mark, in parallel) after `endAllSessions()` and reports
  `phone_flushed` / `queues_touched` in its result; `reactivate()` restores
  the seats. Post-patch copy: `PersonStateService.ts.after-patch`.
* `src/services/DeletedUserService.ts` - `restore()` restores the seats after
  its commit; `purgeExpired()` removes them for good. Post-patch copy beside it.
* `src/models/User.ts` - the `afterBulkDestroy` hook (see
  `user-model-hook.patch`; that diff also shows the person-states ENUM hunk
  from earlier today, which is not this bundle's).

**Not edited:** `UserController.ts`, `AuthController.ts`.

Env (optional, all have defaults): `ESL_MANAGER_URL`, `ESL_MANAGER_API_TOKEN`.
`CAMPAIGN_PORT` and `DOMAIN_SUFFIX` are already set on every box.

Gate: `npx tsc --noEmit -p .` - clean (exit 0).

Compiled for the live box (`default-api/dist/`, built with the project's own
`tsc && tsc-alias`, zero `@/` left, `node --check` clean on all six):

    dist/services/RegistrationKickService.js   copy whole (new)
    dist/services/QueueMembershipService.js    copy whole (new)
    dist/services/PersonRemovalHooks.js        copy whole (new)
    dist/services/PersonStateService.js        copy whole - supersedes person-states/dist/services/PersonStateService.js
    dist/services/DeletedUserService.js        copy whole - supersedes people-roles' compiled copy
    dist/patch_user_model_dist.py              patch models/User.js IN PLACE (never copy it whole)

`patch_user_model_dist.py` was proven against a reconstructed pre-change copy:
its output is byte-identical to the tsc compile, idempotent, `node --check`
clean. As with person-states, the live file could not be read from here; the
script asserts its anchors and refuses otherwise.

### esl-manager (source `/root/UCAAS/mcm-repos/esl-manager`; runs at `/opt/esl-manager` on mcm-new, systemd unit `esl-manager`, built with `npm run build` = webpack -> `lib/index.js`, HTTP on 5555)

**esl-manager had no way to flush a registration**, so this adds one. It must
be **redeployed** for item A to do anything; until then default-api logs
`NOT flushed ... esl-manager has no /registrations/flush route (old build)`.

* `src/utils/registrationFlush.ts` - new, pure: `candidateUsers` (`1000`,
  `1000_web`), `parseRegistrations` (the `sofia status profile X reg` listing),
  `planFlush` (the exact `sofia profile internal flush_inbound_reg
  <user>@<domain>` per user, refusing anything unsafe in an ESL argument),
  `flushSucceeded` (`+OK`).
* `src/controllers/RegistrationController.ts` - new: `flush()` lists first (so
  the log says what was really on the switch), then flushes through the
  existing `ESLController.api()` (which answers `""` when the ESL link is
  down - reported, not thrown). `list()` is read-only. Profile from
  `FS_REGISTRATION_PROFILE`, default `internal` - the profile phones register
  on (5066); `inbound`/public (4066) is the carrier side and has no
  registrations.
* `src/app.ts` - `POST /registrations/flush {extension, domain[, profile]}` and
  `GET /registrations?extension=&domain=`. **Auth: the same as every existing
  route in this service, which is none** (`/start-trans`, `/testing`,
  `/transfer-uuid` are open on loopback). Added on top: if
  `ESL_MANAGER_API_TOKEN` is set in `/opt/esl-manager/.env`, both routes
  require it as a Bearer (and default-api must carry the same value).
  `patch_app_registrations.py` applies the hunk (anchored, idempotent; its
  output equals the working tree byte for byte); `src/app.ts.after-patch` is
  the result.
* `apply.sh` (**not run**) - the same fail-safe shape as
  `backend-patches/esl-manager/apply.sh`: back up, copy, patch, build,
  restart, health-check, roll back on any failure. `rollback.sh <stamp>`.

Gate: `tsc --noEmit -p .` with default-api's `node_modules` symlinked in (the
service has none here; symlink removed after): 6 errors, all pre-existing
"cannot find module" (`ws`, `modesl`, `@reduxjs/toolkit`, the speech SDKs are
not in that tree), none in the new or touched files.

Note: esl-manager also runs on mcm-switch and mcm-ucaas3 (the agent-service
README). Each box's default-api talks to its own loopback esl-manager, so
this needs redeploying on every box whose portal should kick phones.

### campaign-api (source `/root/UCAAS/mcm-repos/campaign-api`; live bundle `/var/www/prod/campaign-api/dist/src/index.js` on mcm-new under pm2)

**campaign-api had no endpoint that touches one person across queues**, so
this adds one. It must be **redeployed** (a source build, per
`campaign-api-source-is-stale`: never edit the bundle) for item B to do
anything; until then default-api logs `NOT done ... campaign-api has no
queue/member/state route (old build)`.

* `src/services/queueMembership.ts` - new, pure: `applyToMembers` (suspend /
  restore / remove on the roster, first marker wins, input never mutated),
  `agentUpdateFor`, `tierUpdateFor`, `carryMarkers`, `agentStatusForMember`.
* `patch_member_state_src.py` (anchored, idempotent; applies cleanly to
  **both** `feat/outbound-dialer` (the checkout, c16f4e9) and
  `feat/queue-settings-and-tiers` (2b74561, what production is built from) -
  proven on copies of both) adds:
  * `QueueRepository.setMemberState()` - finds the company's queues that list
    the person (`members.user_uuid` or the older `members.value`), rewrites
    `members` through the transform, updates/deletes the `agents` rows
    (`queue_uuid` + `user_detail.user_uuid`) and the `tiers` rows
    (`<queue ext>@<domain>` / `<member ext>@<domain>`). One queue at a time,
    each finished before the next.
  * `QueueRepository.upsert()` - **carries an existing marker over a re-save**
    (the website sends the roster back without it) and starts a marked
    member's rebuilt agent row as "Logged Out" instead of "On Break". Without
    this, editing a queue would quietly un-suspend somebody.
  * `QueueController.memberState`, `memberStateValidation` (Joi), route
    `POST queue/member/state` behind `Auth` + `RequireAdmin`; `userSchema`
    tolerates `suspended_member` on a member the website sends back.
  * `member-state.patch` is the same change as a git diff, for review.

Gate: `npx tsc --noEmit --skipLibCheck -p .` - clean (exit 0).

**Deploy:** the owner commits these hunks to the branch production is built
from and runs `backend-patches/campaign-api/apply-queue-settings.sh` (or
its outbound-dialer equivalent). Nothing here commits, checks out or stashes.

### queue-agent-service (`/opt/queue-agent-service/queue_agent_service.py` on mcm-new and mcm-switch, systemd `queue-agent-service`) - optional, belt and braces

`patch_suspended_member.py` - two hunks: `"suspended_member": 1` in
`AGENT_FIELDS` (it is a projection; without this the marker is never read) and
`is_ringable()` returns False when the marker is present. With it, a suspended
person is never offered a call **whatever their status says** - e.g. if the
socket login path ever set them "Available" again. Without it, they are still
not rung, because campaign-api sets them "Logged Out"; this closes the one
remaining way back in. Proven with a control: on the unpatched running copy
`tests/queue_agent_suspended_member_test.py` fails (2 of 5), on the patched
copy 5/5 pass, and the existing 60-test suite still passes. `restart
queue-agent-service` after applying. The copies under
`backend-patches/queue-agent-service/` are left untouched (`running/` is the
record of production).

### Who actually "offers" an agent

The callcenter-config-shim answers `callcenter.conf` with an **empty** queue
list; it never renders agents or tiers. What decides who rings is
`queue-agent-service` reading the `agents` + `tiers` rows campaign-api
writes. So "stop offering them" means those rows, which is what B changes.

## Tests (offline; `bash tests/run.sh`, `python3 tests/queue_agent_suspended_member_test.py`)

32 node:test checks in five files, bundled with esbuild with axios and the DB
connection replaced by stubs, so the best-effort paths are exercised too:

| File | Covers |
|---|---|
| `registration-flush.test.cjs` | the two standard SIP users, a listed `_mobile` variant added and other extensions not, the listing parser on real-shaped output / `-ERR` / empty, refusal of unsafe arguments, the exact command text |
| `registration-kick.test.cjs` | domain formula, request validation, reply -> outcome (ok, partial, 404 old build, 401 token), the real `kickRegistration` with a stubbed transport: body, 3000 ms cap, timeout / refused / 404 never throw, bearer only when configured |
| `queue-membership-client.test.cjs` | identity headers match campaign-api's `Auth`, the URL, reply -> outcome, `setMembership` body / cap / never throws, clean skips without port, company or user |
| `person-removal-hooks.test.cjs` | `targetFromWhere`; the hook registers on `afterCommit` and does **nothing before the commit**; after it, one SQL lookup and both follow-ups with the right bodies and headers; no transaction -> next tick; `hooks:false`, company-wide destroys, a failed lookup: nothing runs, nothing throws |
| `queue-membership.test.cjs` | suspend / restore exact / remove; first marker wins; `value` matching; junk input; agent and tier updates; a website re-save carrying the marker and keeping the website's edits; rebuilt row status |

## Deploy order

1. **esl-manager** on mcm-new: `bash esl-manager/apply.sh` (after sign-off - it
   restarts the event manager). Safe alone: the route exists, nothing calls it.
2. **campaign-api**: commit the hunks to the production branch, source build,
   `pm2 restart campaign-api`. Safe alone: the route exists, nothing calls it;
   `upsert` now carries markers that do not exist yet.
3. **queue-agent-service** (optional): `python3
   queue-agent-service/patch_suspended_member.py
   /opt/queue-agent-service/queue_agent_service.py && systemctl restart
   queue-agent-service`, on mcm-new and mcm-switch. Safe alone: the field is
   absent, nothing changes.
4. **default-api** on mcm-new: copy the five `dist/` files, run
   `dist/patch_user_model_dist.py` on the live `models/User.js`, restart.
   This is the step that starts making the calls. Steps 1-3 first, or the log
   simply says `old build` until they land - nothing breaks either way.

Each step is safe to revert alone.

## Rollback

* default-api: `patch_user_model_dist.py` leaves `User.js.bak-suspend-followups-<stamp>`;
  copy it back, delete the three new service files, put the person-states /
  people-roles copies of `PersonStateService.js` / `DeletedUserService.js`
  back (they are the same files minus the follow-ups), restart. Or leave it:
  with esl-manager and campaign-api rolled back it degrades to two log lines.
* esl-manager: `bash esl-manager/rollback.sh <stamp>`.
* campaign-api: revert the commit and rebuild, or
  `cp index.js.bak-<stamp> index.js && pm2 restart campaign-api`. Markers
  already written stay in the queue records (harmless: an unknown key on a
  member object; `userSchema` on the old build would refuse a re-save that
  carries one, so clear them first: `db.queues.updateMany({"members.suspended_member":{$exists:true}}, {$unset:{"members.$[].suspended_member":""}})`
  and the same on `agents` / `tiers`).
* queue-agent-service: copy the `.bak-suspended-member-<stamp>` back, restart.

## What is NOT verified

No suspend has kicked a real phone and no queue record has been marked on a
real database. The retest (control first) is in `esl-manager/apply.sh`'s
VERIFY block for A; for B: with campaign-api deployed, suspend a person who is
in two queues, then
`db.queues.find({"members.user_uuid":"<uuid>"},{members:1})` shows the marker
on both, `db.agents.find({"user_detail.user_uuid":"<uuid>"})` shows
"Logged Out" + marker, a call to either queue never rings them
(`journalctl -u queue-agent-service` names everyone else), reactivate clears
the marker, and a queue re-saved from the website while they are suspended
still carries it. Control: the same on a box whose campaign-api was not
redeployed - default-api logs `old build`, the records do not change.

Other honest limits:

* The kick is by user name, not by contact: `flush_inbound_reg <user>@<domain>`
  drops every registration of that user at once, which is what is wanted; the
  listing beforehand is for the log and for catching a third `<ext>_x` name.
* `kickRegistration` is called with the **caller's** `domain` on suspend (same
  company, so the same domain) and with the company's `db_name`-derived
  domain on removal. Both are the AuthMiddleware formula.
* A removal that rolls back after `User.destroy` runs no follow-ups
  (`afterCommit`), and a person removed by a company-wide destroy gets
  neither (those paths delete the queues too).
* Restore is exact for the **seat**. Agent counters (talk time, calls
  answered) are kept through suspend/restore because the rows are updated,
  not rebuilt; a purge deletes them with the seat.
