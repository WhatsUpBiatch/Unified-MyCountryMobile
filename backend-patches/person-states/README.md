# Person states: Pending, Active, Suspended, Removed

**NOT DEPLOYED. Nothing here has been run against a server or a database.**
Fix-sheet row 27 (`docs/audit-2026-09-03/my-account-people-roles-fix-sheet.xlsx`);
the evidence is appendix B section A.6. Built 3 Sep 2026 as uncommitted
working-tree edits in `/root/UCAAS/mcm-repos/default-api` and
`/root/mycountrymobile-web`; this folder is the portable copy.

## What was wrong, in plain words

Every person is ACTIVE from the day they are created and nothing on the tenant
side ever changes that. `users.status` already had four values
(`EXPIRED, ACTIVE, INACTIVE, PENDING`) but only platform admin and the expiry
crons ever set them, on whole companies. If somebody did set a person INACTIVE
by hand, the login and the API refused them - but **the phone did not**: the
directory service's lookup did say `status = 'ACTIVE'`, yet it never looked at
`deleted_at`, and the dialplan bridged the extension regardless of status. So:

* there was no "suspend this person" anywhere in the product;
* a **removed** person (soft delete: row kept, `deleted_at` set, status still
  ACTIVE) kept a working phone: it registered, it rang, it could place calls;
* a number pointed at a suspended or removed person rang into silence.

## The four states

| State | Stored as | Login / API | Phone (switch) | Set by |
|---|---|---|---|---|
| **Pending** | `status='PENDING'` | refused, "waiting to be activated" | refused once the switch patches are applied | invite flow (default of the column) |
| **Active** | `status='ACTIVE'` | allowed | allowed | creation, Reactivate |
| **Suspended** | `status='SUSPENDED'` (new) | refused, "has been suspended"; every session ended the moment it is set | refused once the switch patches are applied; extension goes to voicemail / the number's closed action | Suspend on People |
| **Removed** | `deleted_at` set | refused (row invisible) | refused once the switch patches are applied | Remove; restorable 72 h from the Removed tab |

`EXPIRED` and `INACTIVE` stay in the column (platform-side) and are shown to the
tenant as Suspended, because that is what they do to the person.

**Login and API were already refused for any non-ACTIVE status** (`AuthController`
lines 593/930, `AuthMiddleware` line 162). Adding SUSPENDED to the ENUM is
what makes the state exist; the patches here add the plain-words messages, the
endpoints, the screen, and the switch enforcement.

## What changes, file by file

### default-api (source, `/root/UCAAS/mcm-repos/default-api`)

New files (copied whole under `default-api/src/`):

* `src/services/PersonStateService.ts` - the rules. `stateOf(row)` (pure),
  `ensureStatusColumn()` (first-use guard: one `INFORMATION_SCHEMA` read per
  process, `ALTER TABLE users MODIFY COLUMN status ENUM(...)` only if SUSPENDED
  is missing, keeping nullability and default; a failed check is retried, never
  remembered), `suspend()`, `reactivate()`, `endAllSessions()` (the "all" branch
  of `AuthController.logOutUser`, step for step - it is a static on the
  controller, so the four steps are repeated rather than the controller imported
  into a service), `stateOf(company, uuid)`, `statesForCompany(company)`.
* `src/controllers/PersonStateController.ts`, `src/routers/personStateRoute.ts`
  mounted at `/api/person` in `app.ts`:
  * `POST /api/person/suspend/:uuid` - `auth` + `RequireAdminRole` + per-target `decidePersonSuspend`
  * `POST /api/person/reactivate/:uuid` - `auth` + `RequireAdminRole` + `decideAdminAction`
  * `POST /api/person/state/:uuid` - `auth`; one person, removed included
  * `POST /api/person/state` - `auth`; every person's state. **Why:** `/api/user/list`
    does not return `status` and `UserController.ts` was off limits today, so the
    People screen reads states here and joins them by uuid.
* `src/helpers/roleGuard.ts` - **supersedes the people-roles copy** (same file plus
  `decidePersonSuspend` and three messages). Rules for suspend are the rules for
  remove: an administrator, never yourself, never the account owner.
* `migrations/20260903150000-users-status-suspended.js` - explicit, idempotent
  ALTER (not `syncModelByTable`, which would rewrite every drifted column).
  `down` refuses while anyone is SUSPENDED.

Hunks in existing files (`default-api/patch_person_states_src.py`, anchored,
idempotent; proven on a copy of HEAD's four files):

* `src/app.ts` - import + `app.use("/api/person", personStateRoute)`
* `src/models/User.ts`, `src/interfaces/IUser.ts` - `'SUSPENDED'` in the union and the ENUM
* `src/middlewares/AuthMiddleware.ts` - the non-ACTIVE 403 says which state it is

**Not edited:** `UserController.ts`, `AuthController.ts` (as instructed).

Gate: `npx tsc --noEmit -p .` - clean (exit 0).

### default-api (compiled, for the live box) - `dist/`

Copy whole (compiled with the project's own `tsc && tsc-alias`; zero `@/` left):

    dist/services/PersonStateService.js
    dist/controllers/PersonStateController.js
    dist/routers/personStateRoute.js
    dist/helpers/roleGuard.js          <- supersedes backend-patches/people-roles/dist/helpers/roleGuard.js

Patch in place (never copy these files whole - the live ones carry hand-applied
fixes that a fresh compile does not have):

    python3 dist/patch_person_states_dist.py  <dist root>            # app.js, middlewares/AuthMiddleware.js, models/User.js
    python3 dist/patch_login_person_state_dist.py <dist>/controllers/AuthController.js

Both assert their anchors (the login one expects its block **twice**: `login()`
and `loginCRM()`) and refuse otherwise; both are idempotent. **Honesty note:**
the anchors were verified against a local compile of the 3 Sep source and a
reconstructed pre-change copy - not against the live file, which cannot be
read from here. That is what the assertions are for. Also: the repository's
`dist/` was regenerated by something at 08:41 on 3 Sep while this was being
built (it now contains the person-state files); it is not tracked by git and
is not the live tree, so nothing here depends on it.

Then `pm2 restart` (or whatever restarts default-api on that box). The first
suspend/reactivate call widens the column if the migration has not run.

### The migration

Either `npx sequelize-cli db:migrate` from the API root, or let the service do
it on first use. To run it alone without sequelize-cli, the people-roles
`run-migration.js` accepts a path:
`node backend-patches/people-roles/run-migration.js backend-patches/person-states/default-api/migrations/20260903150000-users-status-suspended.js`.
It logs the exact ALTER it runs; running it twice does nothing the second time.

### The switch (`fs-xml-api/`)

Two patches, in this order, via `apply-person-states-switch.sh` (documented,
**not run**; needs sign-off because both services restart):

1. `patch_directory_person_state.py` on `/opt/fs-directory-manager/directory_service.py`
   (the `running/` snapshot is identical on all three boxes). Refuses
   `sip_auth` and `user_call` for anyone whose `deleted_at` is set or whose
   status is not ACTIVE, with the existing "not found" answer and one info line
   `person refused on the switch: ext=…, state=SUSPENDED|PENDING|REMOVED|…, action=…`.
   Restart `fs-directory-manager`.
2. `patch_dialplan_person_state.py` on `/opt/fs-xml-api-1.2.5/dialplan_service.py`
   (written against md5 `bd2aeb1f…`, the running file WITH the person-rules
   patch; it anchors on that patch and refuses without it). Right above the
   EXTENSION bridge: not ACTIVE → the number's closed-hours destination if it
   names one that is not this same extension, else that extension's voicemail;
   one info line `person unavailable, using …`. Also `AND u.deleted_at IS NULL`
   on the two registered-phone identity reads. Restart `fs-xml-api`.

Empty/NULL status on the dialplan side means "ring as today" (fail open, like
every read on the call path); on the directory side it is refused (that is
what the old SQL did). Deliberate.

**What the switch patches do not do:** flush an existing registration at the
moment of suspension (it lapses at the phone's next REGISTER; an ESL
`flush_inbound_reg` from the API is the follow-up), and take a suspended person
out of a queue's agent list (that is `callcenter-queue.lua` / queue-agent-service).

### Web (`/root/mycountrymobile-web`)

`web/web.patch` (git diff of the four touched files + the new one) and
`web/people-removed.tsx`:

* `src/services/api/routes.tsx`, `index.tsx` - `suspendMember`, `reactivateMember`,
  `getPersonStates`, `listDeletedMembers`, `restoreMember`.
* `src/pages/directory/people-rows.ts` - `PersonState`, `PERSON_STATE_LABEL`
  (label, tone, and the honest note), one `POST /api/person/state` per page
  joined by uuid; `state` is `null` until that request answers, and the screen
  shows no pill for null rather than guessing Active.
* `src/pages/directory/people.tsx` - a **Status** column with the pill; Suspend
  (pause icon) / Reactivate (play icon) on the row, same browser-side gate as
  Remove (delete permission, never yourself, never the owner, only once the
  state is known), each behind a confirm dialog; a **People | Removed** tab strip;
  the state in the person drawer.
* `src/pages/directory/people-removed.tsx` (new) - the Removed tab: people removed
  in the last 72 hours, when, how long is left, Restore with a confirm that says
  routing is not put back.

The Suspended pill's note reads **"Login blocked; phone blocked once the switch
update is applied."** Change it in `PERSON_STATE_LABEL.SUSPENDED.note` after the
switch patches are live. No competitor names anywhere.

Gates: `npx tsc --noEmit -p tsconfig.app.json` - 0 errors in the touched files
(3 errors exist in `src/lib/company-self.ts` / `company-record.tsx`, another
session's in-progress files); `npx eslint` on the five touched files - clean.
The website was **not built**.

## Verification done here (offline only)

| Check | Result |
|---|---|
| `test_directory_person_state.py` on the unpatched snapshot (control) | FAILED (7 failures, 1 error) - as it must |
| same, on the patched copy | 15/15 OK; patch idempotent |
| `test_dialplan_person_state.py` on the unpatched snapshot (control) | FAILED (1 failure, 19 errors) - as it must |
| same, on the patched copy | 20/20 OK; patch idempotent |
| existing dialplan suites on the patched copy: line_hours, site_caller_id, company_settings, holidays, business_hours | all OK |
| `test_person_rules.py` on the patched copy | 76/77; the one failure is `test_cached_per_person_and_per_company`, a **count** of `FROM users` queries (4 vs 3) - the state read is one more query. Every behaviour assertion passes. `test_caller_id`, `test_availability`, `test_vm_email` fail identically on the unpatched snapshot (older file versions) - pre-existing |
| `tests/migration-users-status.test.cjs` | 8 checks OK (ENUM parsing, widening, NULL/NOT NULL, default kept, `down` statement) |
| `PersonStateService` pure exports loaded from the compiled dist | `stateOf`: ACTIVE→ACTIVE, PENDING→PENDING, SUSPENDED/INACTIVE→SUSPENDED, deleted→REMOVED; `widenStatement` emits the same ALTER as the migration and `null` once widened |
| `patch_login_person_state_dist.py` | applies (2 sites), `node --check` OK, idempotent |
| `patch_person_states_dist.py` on reconstructed pre-change copies | applies; `AuthMiddleware.js` result byte-identical to the tsc compile; `node --check` OK on all three; idempotent |
| `patch_person_states_src.py` on HEAD's four files | applies; idempotent |

**Not verified:** anything live. No suspend has been performed on a real
account, no phone has been refused, no call has gone to voicemail because of
this. The apply script's VERIFY block is the retest, control first.

## Apply order

1. API: copy the four `dist/` files, run the two dist patch scripts, restart.
   (Column widens itself on the first suspend; or run the migration first.)
2. Web: apply `web.patch`, add `people-removed.tsx`, build per portal.
3. Switch: `apply-person-states-switch.sh mcm-new` after sign-off, then the
   VERIFY steps, then change the pill note and rebuild the site.

Steps 1-2 are safe before 3 and honest: the pill says the phone is not yet
blocked.

## Rollback

* Switch: copy the `.bak-person-states-<stamp>` files back over
  `directory_service.py` and `dialplan_service.py`, restart both units.
* API: the dist scripts leave `.bak-person-states-<stamp>` beside each file;
  copy back, delete the four new dist files, restart. The widened ENUM can stay
  (harmless); to remove it, reactivate every suspended person and run the
  migration's `down` (it refuses otherwise).
* Web: `git checkout` the four files, delete `people-removed.tsx`, rebuild.
  With the API rolled back the states request 404s, every state is `null`, and
  the screen shows no pill and no Suspend button - it degrades to today.
