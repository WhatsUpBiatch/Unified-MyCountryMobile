# People and roles: who may change whom, free-text roles, the e-mail probe, and what removing a person does

**NOT DEPLOYED.** Source changes sit in `/root/UCAAS/mcm-repos/default-api` as
uncommitted working-tree edits, on top of the same day's company-settings and
recording changes (never revert those). This folder is the portable copy: the
patch, the new files, the built `dist/` files, the data-fix migration and its
runner, and the unit tests. Audit rows 1, 2, 4 and 28 of
`docs/audit-2026-09-03/my-account-people-roles-fix-sheet.xlsx`; the file:line
evidence is in `docs/audit-2026-09-03/appendix-b-people-roles.md` A.3, A.5, B.3-B.5, E.

## What was wrong, in plain words

1. **Anyone could make themselves the account owner (P0).** The routes that
   change a person's role, add or remove people, or edit roles carried only
   "is signed in". A guard added on 29 Aug lived in the compiled file only and
   was lost on the next build.
2. **The role column is free text (P0).** Custom roles copied their NAME into
   `users.role`; live rows hold "Custom Sub-Admin", "New role" and raw uuids.
   Every server check compares that column with "ADMIN", so a custom role
   *named* ADMIN made its holders the owner, and rows holding a uuid were
   locked out of things they should see.
3. **The "is this e-mail taken?" check had no company filter (P1).** Any
   signed-in person could learn whether an address exists on another tenant.
4. **Removing a person blanked whole numbers and gave their calls to the admin
   (P1).** Any number that forwarded to them lost ALL its routing; colleagues'
   forwards were repointed at whoever clicked delete; the e-mail stayed
   reserved forever; and there was no way to see or undo a removal.

## The role rules (helpers/roleGuard.ts)

All decisions are on the **resolved system role** - never on the free-text
`users.role`, never on a role's display name. The resolver
(`services/RoleResolverService.ts`) goes `custom_role_uuid` → its parent
`roles` row → key; else `role_uuid` → key; else a uuid sitting in `users.role`
(the pre-migration shape) → key; else `users.role` only if it already IS one
of the four keys. Anything else is `null`, and every rule fails closed on null.

| # | Rule | Who is refused | Reply |
|---|------|----------------|-------|
| 1 | A caller whose role cannot be resolved may do nothing administrative | unresolvable caller | 403 "Your role could not be determined…" |
| 2 | Nobody changes their **own** role. A self-edit that repeats the current role is not a change: the role fields are dropped and everything else saves | anyone, including the owner | 403 "You cannot change your own role…" |
| 3 | Only an **administrator** (ADMIN, MANAGER, SUB-ADMIN) changes a role, adds people, removes people, manages roles or the company template, lists or restores removed people | AGENT, unresolved | 403 "Only an administrator can…" |
| 4 | Only the **owner** (ADMIN) grants the owner role - on update, bulk assign and add-member alike | MANAGER, SUB-ADMIN | 403 "Only the account owner can make someone the account owner." |
| 5 | Only the owner changes (or edits) an owner's account | MANAGER, SUB-ADMIN | 403 "Only the account owner can change/edit the account owner's…" |
| 6 | The owner cannot be removed; nobody can remove themselves | everyone | 403 "The account owner cannot be removed." / "You cannot remove yourself." |
| 7 | Editing another person's non-role fields needs an administrator; editing yourself never does | AGENT editing a colleague | 403 "Only an administrator can edit another person." |

Vocabulary, as the product's own labels put it: ADMIN = account owner,
MANAGER = account admin, SUB-ADMIN = people admin, AGENT = call reviewer.
`ADMIN_ROLES` is one exported constant if the set should be tightened.

The four built-in names are now reserved: a custom role may not be called
ADMIN/MANAGER/SUB-ADMIN/AGENT, and a custom role's parent (`role_uuid`) must
be one of the PREDEFINED rows.

## What changes, file by file

### default-api source

| file | what |
|---|---|
| `src/helpers/roleGuard.ts` | **new**, pure: the seven rules above, one `decide*` function per question |
| `src/helpers/removalRouting.ts` | **new**, pure: take ONE extension out of a number's / a colleague's routing; the 72-hour window; e-mail tombstone |
| `src/services/RoleResolverService.ts` | **new**: uuid → system role, cached PREDEFINED roles, request-shape resolver |
| `src/services/DeletedUserService.ts` | **new**: list-deleted, restore, lazy purge |
| `src/middlewares/RoleGuard.ts` | **new**: `RequireAdminRole` for the routes |
| `migrations/20260903120000-fix-users-role-system-key.js` | **new**: the one-off data fix (below) |
| `src/controllers/UserController.ts` | **edited**: `delete` (guard + targeted routing removal + no repointing), `listDeleted`, `restore`, `addMember` (guard, system-key role, company-scoped duplicate check, purge), `update` (guard, no `settings.role.label` → role, system-key role), `validateUser` (company filter, phone actually sanitised), `assignBulkRoleToUser` (guard per target before any write, system-key role) |
| `src/controllers/Roles/index.ts` | **edited**: `upsertCustomRole` refuses built-in names and non-system parents |
| `src/routers/userRoute.ts` | **edited**: `RequireAdminRole` on add-member, delete, assign-role-bulk-users; new `POST /user/list-deleted`, `POST /user/restore/:uuid` |
| `src/routers/rolesRoute.ts` | **edited**: `RequireAdminRole` on role upsert/delete, custom upsert/remove |
| `src/routers/TenantRouter/tenantUserTemplate.ts` | **edited**: `RequireAdminRole` on template upsert/delete |

### The dist files this produces (what actually goes to the box)

Production default-api has **no `src/`** (see `../company-settings/README.md`):
it is deployed by copying built files one by one. `dist/` here was built from
the working tree with `tsc` + `tsc-alias` (no `@/` alias survives - checked):

| dist file | new / replaces |
|---|---|
| `dist/helpers/roleGuard.js` | new |
| `dist/helpers/removalRouting.js` | new |
| `dist/services/RoleResolverService.js` | new |
| `dist/services/DeletedUserService.js` | new |
| `dist/middlewares/RoleGuard.js` | new |
| `dist/controllers/UserController.js` | replaces |
| `dist/controllers/Roles/index.js` | replaces |
| `dist/routers/userRoute.js` | replaces |
| `dist/routers/rolesRoute.js` | replaces |
| `dist/routers/TenantRouter/tenantUserTemplate.js` | replaces |

**Caution:** `dist/controllers/UserController.js` and `dist/routers/userRoute.js`
were built from the shared working tree, so they also carry the company-settings
hook (`CompanyPolicyService.seedNewUserSettings`, `CompanyPolicyLock`) that is
already live on mcm-new since 3 Sep. Copy them onto a box that has that change;
on a box that does not, the requires for `services/CompanyPolicyService` and
`middlewares/CompanyPolicyLock` will fail at start.

Plus, outside dist: `migrations/20260903120000-fix-users-role-system-key.js`
and `run-migration.js` (a runner that needs no sequelize-cli).

## Row by row

### 1. Role escalation

Every route in appendix E's list now carries `RequireAdminRole`, and each
handler runs the per-target rules: `delete` → `decidePersonDelete`; `update`
→ `decidePersonEdit` then `decideRoleChange`; `assignBulkRoleToUser` →
`decideRoleChange` for every target **before** anything is written (one
refusal, nothing changed, the offending `user_uuid` in the reply); `addMember`
→ `decideNewMemberRole` per row. `settings.role.label` is no longer read for
the role at all (that was escalation recipe 2). An admin editing themselves
with the drawer, which always sends their current role, gets `apply=false`:
role fields dropped, everything else saved.

### 2. Free-text role

`custom_roles.role_uuid` already IS the parent system role (`allowNull:false`),
so no new column was needed. On every write path (`update`, bulk assign,
add-member) `users.role` now receives the **parent system key**; the custom
role's own name goes only to `settings.role.label`, which is display. The
checks touched in row 1 read `role_uuid` + the resolved role, with `users.role`
as the last fallback (and only when it is already a key).

**The migration** (`migrations/20260903120000-fix-users-role-system-key.js`):

- selects every `users` row (soft-deleted included, so a restore does not
  bring the old value back) whose `role` is NULL or not byte-equal to one of
  ADMIN / SUB-ADMIN / MANAGER / AGENT;
- for each, in order: `custom_role_uuid` → parent → key (refused if the custom
  role belongs to another company); `role_uuid` → key; `users.role` is itself
  a system-role uuid or a custom-role uuid → key, and `role_uuid` /
  `custom_role_uuid` are filled in; wrong case or spacing ("admin", "SUB_ADMIN")
  → normalised;
- writes only `role` (plus the ids it derived), logs `UPDATE user … role "x" ->
  "KEY" (via …)` per row, and prints a JSON summary;
- **reports** rows it cannot resolve and leaves them alone (the runner exits 3
  when any were reported);
- refuses to run if the PREDEFINED roles are missing;
- is idempotent: the second run selects nothing;
- `ROLE_FIX_DRY_RUN=1` logs every decision and writes nothing. **Run that first.**
- `down` is a no-op on purpose.

Once it has run, the untouched checks listed in appendix B.3 (`AuthMiddleware`,
`DidController`, tenant-api's department/call-history filters) become correct
too, because the column they compare finally holds what they expect.

### 4. E-mail probe

`validateUser` adds `company_uuid` to every lookup (it was already there for
extension). The only caller is the Add-person form (`services/api/index.tsx` →
`add-user-info/index.tsx`); signup does not use this route, checked. The
phone branch also now actually uses the sanitised number (before, the result
was discarded). Residual: `users.email` is unique platform-wide, so
`addMember` must still refuse an address that exists on another tenant; it
now does so with a neutral "cannot be used for a new person" instead of
"already exists", but the refusal itself still tells a determined caller
something. The frontend wording "belongs outside this company" should go.

### 28. Removing a person

`delete` now:

- reads each number whose `forward_call_actions` mentions the extension and
  calls `stripExtensionFromNumberRouting`: `business_hours`,
  `missed_call_action`, `closed_hours`, `closed_hour_action` and any holiday
  pointing at the person are **emptied**; hours, media, recording, display
  number, caller-id and every other target stay. An emptied slot is
  `type:"" value:""` - the same as a freshly bought number. It is **not**
  replaced with voicemail: on this switch VOICEMAIL always needs a person's
  extension (`vm_target_extension`); a number has no mailbox of its own, so
  "voicemail of the number" would be inventing a target;
- reads each colleague whose `call_forwarding` mentions the extension and
  calls `stripExtensionFromPersonForwarding`: "forward all my calls" is
  switched off; the device entry is removed; "no answer" and "closed hours"
  fall back to the **colleague's own** mailbox (exactly what
  `generateCallForwarding` gives a new person). **Nothing is ever repointed at
  the person doing the removing**;
- passes `logged_user_extension: null` to tenant-api's
  `department/delete-member-status` and `ivr/delete-member-status`, so they no
  longer repoint a group's or menu's forward at the admin. They still drop the
  person from members/manager. A forward they can no longer repoint is left
  as it was - emptying it needs a tenant-api change (not in this bundle);
- replies with `routing_cleared` (which numbers/people, which slots) and logs it.

Soft delete itself is unchanged. New:

- `POST /api/user/list-deleted` (admin) → people removed in the last 72 hours
  with `restore_until`;
- `POST /api/user/restore/:uuid` (admin) → restores the row and gives it a
  licence (a free one, else a new one if the plan has room, else 409). 410
  after the window. Routing cleared at removal is **not** put back - there is
  no copy of it - and the reply says so;
- **purge**: rows removed more than 72 hours ago get their e-mail rewritten to
  `deleted+<uuid fragment>+<original>` (fits the 60-char column) and phone set
  to NULL, which frees both. The row stays for reports that join on it. The
  purge is lazy - run at add-member, e-mail validate, list-deleted and restore
  - so it needs no cron and works on boxes where crons are off.

## Verification done here

- `cd default-api && npx tsc --noEmit -p .` → exit 0.
- `bash tests/run.sh` → 31 tests, 31 pass (role rules; routing strip on the
  live JSON shapes; tombstone and window; the migration's resolver against
  every live shape, including "custom role named ADMIN").
- `default-api.patch` applies cleanly to the pre-change working tree and
  reproduces it byte for byte (checked in a scratch copy).
- `dist/` built from the working tree with `tsc` + `tsc-alias` into a scratch
  dir; zero `require("@/…")` left in the ten files.

Not done, because it needs a database or a server: no request has been sent;
the migration has not been run against real rows (the dry run is the next
step); `restore` and the purge have not been exercised end to end.

## Apply

Source tree: `bash apply.sh --check <default-api dir>` then
`bash apply.sh [--build] <default-api dir>`.

Production box (no src):

1. Back up the five replaced dist files beside themselves.
2. Copy the ten `dist/` files into `/var/www/prod/default-api/dist/…` (stage
   under `/root/mcm-patches-03sep/people-roles/` first; direct scp into
   `/var/www/prod` is blocked).
3. Copy `default-api/migrations/20260903120000-fix-users-role-system-key.js`
   and `run-migration.js` next to the app's `.env`, then
   `ROLE_FIX_DRY_RUN=1 node run-migration.js ./20260903120000-fix-users-role-system-key.js`
   and read the report. When it is clean, run it without the variable. It is
   safe to run before or after the restart: the resolver understands the
   pre-migration rows too.
4. `pm2 restart default-api`.
5. As an AGENT: `POST /api/user/assign-role-bulk-users {role_uuid:<ADMIN uuid>, users:[self]}`
   → 403 "You cannot change your own role…". `POST /api/user/update` with
   `{settings:{role:{label:"ADMIN"}}}` → 200 and `users.role` unchanged.
   As a MANAGER: assign ADMIN to a colleague → 403 "Only the account owner…".
   As the owner: delete yourself → 403; delete a colleague whose extension a
   number forwards to → 200 with `routing_cleared`, and the number keeps its
   hours/media. `POST /api/user/list-deleted` shows them; `restore` brings
   them back.

## Rollback

Box: put the five backed-up dist files back, delete the five new ones,
`pm2 restart default-api`. Source: `bash rollback.sh <api> <backup dir>`.
The migration is not reversed: it leaves `users.role` holding exactly the
strings the old code compared against, so the old build is happier with it,
not worse.
