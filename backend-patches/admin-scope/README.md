# Admin scope: who an administrator may act on (fix sheet row 33)

**NOT DEPLOYED.** Source changes sit in `/root/UCAAS/mcm-repos/default-api` and
`/root/mycountrymobile-web` as uncommitted working-tree edits, on top of the
same day's people-roles, person-states and permissions changes (never revert
those). This folder is the portable copy: the patch, the new files, the built
`dist/` files, the web files and the unit tests. Audit row 33 of
`docs/audit-2026-09-03/my-account-people-roles-fix-sheet.xlsx`; the evidence
is appendix B section B.1 (`settings.admin_scopes`: "a real save whose result
nothing reads") and appendix C section 2 (the reference model: company /
regional / office scope on a grant).

## What was wrong, in plain words

A role says what somebody may do: edit people, remove people. It says nothing
about *whom*. So the admin of one location could edit, remove or suspend
somebody at another location, and the person looking after Sales could do the
same to Support.

The website had an "Admin scope" screen for this, hidden from the sidebar. It
saved a list of scopes into `settings.admin_scopes` on the Company Default
template. **Nothing read it** - not the server, not another screen. The screen
said "Coming soon" on its face, which was honest, but it also meant the whole
thing was a note to self.

## What it is now

Scope is a property of the grant, written on the person:

```
users.settings.admin_scope = {
  level:          'company' | 'location' | 'group',
  location_uuids: [ sites.uuid, ... ],        // read only when level = location
  group_uuids:    [ ring_groups.uuid, ... ]   // read only when level = group
}
```

"Location admin, in Delhi." "Group admin, for Sales." No key (or a key that
does not parse) means **company-wide**, which is what every administrator has
today - nothing changes for anybody until a scope is written down. Groups are
the tenant's departments: the `ring_groups` table in the tenant database
(tenant-api `DepartmentModel`), columns `uuid`, `name`, `members` (a JSON array
of `{ user_uuid, ... }`), `manager` (`{ user_uuid }`, counted as a member).

### The rules (`src/helpers/adminScope.ts`, pure, tested)

Acting on a person (`decideScopeAccess`), in order:

1. The account owner (ADMIN) is never scoped.
2. Acting on yourself is never scoped (the tree's self rule already applies).
3. No scope, or level `company`: allowed.
4. Level `location`: the target's `users.site_uuid` must be one of
   `location_uuids`. A target with **no site is refused** - guessing "probably
   mine" is how an administrator edits somebody in another city.
5. Level `group`: the target must be a member of one of `group_uuids`. A
   target in no group is refused.
6. A location/group scope with an empty list covers nobody (refused, with a
   message that says to ask the owner).

Setting a scope (`decideScopeChange`), in order:

1. A caller whose role cannot be resolved is refused. Fail closed.
2. Nobody changes their own scope - not even the owner.
3. Only the account owner (ADMIN) and an account admin (MANAGER) set scope.
4. A MANAGER who is themselves scoped sets nobody's scope (otherwise a
   location admin hands out reach they do not have).
5. The owner is never scoped, so nothing is written on the owner.
6. Only the owner changes a MANAGER's scope.
7. Scope is written on administrators only (MANAGER, SUB-ADMIN, or a custom
   role hanging off one). An AGENT administers nobody.

Then the value (`checkScopeValue`): a known level; for `location` at least one
uuid and every uuid a site of this company; for `group` at least one uuid and
every uuid a department of this tenant. The lists the level does not use are
dropped before writing, so a stale location list cannot come back later.

All comparisons are on the RESOLVED system role (`RoleResolverService`), never
on the free-text `users.role` string.

### Enforcement (`src/middlewares/PermissionGuard.ts`)

`RequirePermission(key, { target })` now asks a third question after the tree
passes: is every target uuid inside the caller's scope? Same `PERMISSION_ENFORCE`
switch, same log line, with `reason: "scope"`:

| `PERMISSION_ENFORCE` | scope refusal | log line |
|---|---|---|
| unset / `report` (default) | goes through | `permissionGuard: report mode, would have refused {user, company, role, key, reason:"scope", scope_reason, scope_level, target, target_site, target_groups, route}` |
| `enforce` | `403 { success:false, message, permission:<key> }` | none |

`scope_reason` is one of `outside_location`, `no_location`, `outside_group`,
`no_group`, `empty_scope`. Read the log before flipping to enforce: a run of
`no_location` means people without a site, not administrators overreaching.

`RequireInScope(label, target)` is the scope question alone, for routes that
have no tree key (the permissions README explains why restore, suspend and
reactivate got none).

A lookup failure (database away, tenant-api away for a group scope) lets the
request through in report mode and refuses it in enforce mode, so enforce is
never quietly open.

The owner, self, and a company-wide caller are answered without touching the
target at all. A target uuid that is not in the company is passed through: the
handler's own "person not found" answers that, and a scope refusal would only
leak that the uuid exists elsewhere.

### Route -> scope check

| route | guard added | target | tree key still checked |
|---|---|---|---|
| `POST /api/user/update/:uuid?` | already had `target` - scope now runs on it | `:uuid` (or self) | edit |
| `DELETE /api/user/delete/:uuid` | `target` added to RequirePermission | `:uuid` | delete |
| `POST /api/user/assign-role-bulk-users` | `target` added: `body.users` | every uuid in the list | edit |
| `POST /api/user/restore/:uuid` | `RequireInScope` | `:uuid` | none (no key exists) |
| `POST /api/person/suspend/:uuid` | `RequireInScope` | `:uuid` | none |
| `POST /api/person/reactivate/:uuid` | `RequireInScope` | `:uuid` | none |
| `POST /api/user/list` | **not blocked** - see the TODO below | - | view |

A bulk route whose list happens to hold only the caller is not a self-edit;
the tree's self rule applies to single-person routes only. (Same answer as
before for the bulk route; the change makes it explicit.)

### New endpoints (`src/controllers/AdminScopeController.ts`, `src/routers/adminScopeRoute.ts`, mounted at `/api/person`)

| route | guards | body / answer |
|---|---|---|
| `POST /api/person/scope/:uuid` | auth, RequireAdminRole, then the seven rules above in the service | `{ level, location_uuids?, group_uuids? }` -> `{ uuid, admin_scope }`; 403 with the rule's message; 422 with `problems[]` for a bad value; 404 person not found |
| `POST /api/person/scope` | auth | `{ rows: [{ uuid, system_role, admin_scope }] }` for every person in the company - the People list and the scope screen join on uuid |

The write merges into the existing `settings` blob (never replaces the rest
of it) and drops that person from the cache.

### Cache (`src/services/AdminScopeService.ts`)

Per company, 30 seconds, same window as the permission tree: the person row
(site, role columns, scope), the tenant's groups with member uuids, the
company's site uuids. The caller's scope is read from their **row**, not from
`req.auth` - the session carries the row as it was at login, and a scope set
an hour ago must apply now. Groups are read through tenant-api
`department/listing` (200 a page, up to 10 pages) rather than `tenantDb()`,
which opens a fresh pool per call and must not sit on a per-request path.

### TODO: narrowing `/api/user/list` (not done, on purpose)

`UserController` is not to be edited today. The helper is written and waiting:

```ts
const { filter, where } = await AdminScopeService.scopeFilterFor(req.auth);
// where: null                              -> no narrowing (owner / company-wide)
//        { site_uuid: { [Op.in]: [...] } } -> location scope
//        { uuid: { [Op.in]: [...] } }      -> group scope (members of the groups + the caller)
//        { uuid: <caller> }                -> a scope that covers nobody
```

When `UserController.list` may be touched: spread `where` into its `where`
(it already builds one from `filter`/`search`), behind the same
`PERMISSION_ENFORCE` flag, and log the row counts with and without the filter
in report mode first. Thirteen website files read that list for pickers that
have nothing to do with the People page (assign-users, departments, chat and
transfer), which is why it is not blocked here.

## The website

| file | what |
|---|---|
| `src/lib/admin-scope.ts` | **rewritten** to the server's model: `normaliseScope`, `scopeSuffix` ("Delhi", "Delhi, Mumbai", "Delhi +2"), `describeScope`, `checkScope`, `canSetScope` (the same seven rules, same order), `reachOf` |
| `src/pages/admin-settings/roles/admin-scope/index.tsx` | **rewritten**: lists every administrator the server resolves to MANAGER / SUB-ADMIN with their role and scope; Change opens Company / Locations (multi-select of sites) / Groups (multi-select of departments); saves through `POST /api/person/scope/:uuid`; shows how many people the draft reaches and what is wrong with it; Change is disabled with the reason when the rules refuse |
| `src/pages/admin-settings/sidebar/index.tsx` | Admin scope **un-hidden** under People, after Roles; shown to the owner and to account admins (`IS_ACCOUNT_ADMIN`, new optional third argument of `adminSettingArr`) |
| `src/pages/admin-settings/admin-home/index.tsx` | passes the same flag, so the admin home search finds the screen |
| `src/pages/admin-settings/roles/area-nav.tsx` | step 4, "Admin scope - who each administrator reaches" |
| `src/router/index.tsx` | route guard changed from `adminOnly` to the people-edit permission, so an account admin (who may set scope) can open it; the screen is read-only for anybody the rules refuse |
| `src/pages/directory/people-rows.ts`, `people.tsx` | one `POST /api/person/scope` per roster refresh, joined by uuid; the Role cell reads "Location admin · Delhi" / "Group admin · Sales +1"; no suffix for company-wide |
| `src/services/api/routes.tsx`, `index.tsx` | `PERSON_SCOPE_SET`, `PERSON_SCOPES`; `setPersonScope`, `getPersonScopes` |

The card on the screen says, in plain words: *"Saved now. Enforced on the
server in report mode until switched on: the server writes down what it would
have refused, and does not refuse it yet. The account owner always covers the
whole company."*

The old `settings.admin_scopes` list on the Company Default template is not
read any more and is not migrated: it was never acted on, and the people on it
should be re-entered on the new screen (a few rows at most - the screen was
hidden).

## What changes, file by file

### default-api source

| file | what |
|---|---|
| `src/helpers/adminScope.ts` | **new**, pure, no imports: the two rule lists, `normaliseAdminScope`, `scopeFromSettings`, `checkScopeValue`, `scopeFilter` |
| `src/services/AdminScopeService.ts` | **new**: the lookups, the 30 s cache, `decide`, `setScope`, `listScopes`, `scopeFilterFor` |
| `src/controllers/AdminScopeController.ts` | **new** |
| `src/routers/adminScopeRoute.ts` | **new** |
| `src/middlewares/PermissionGuard.ts` | **edited**: the scope question after the tree; `target` may be a list; `RequireInScope`; `skipScope` |
| `src/helpers/permissionTree.ts` | **edited**: `applyMode` takes any `{ok, message}` decision (structural), nothing else |
| `src/routers/userRoute.ts` | **edited**: delete, restore, assign-role-bulk-users |
| `src/routers/personStateRoute.ts` | **edited**: suspend, reactivate |
| `src/app.ts` | **edited**: import + `app.use("/api/person", adminScopeRoute)` |

Not touched: `UserController.ts`, `AuthController.ts`, `RoleGuard.ts`,
`RoleResolverService.ts`, `roleGuard.ts`, `PermissionTreeService.ts`.

`default-api.patch` is the diff for the five edited files against the copies
the sibling bundles ship (`../permissions/default-api/src/...`,
`../person-states/default-api/src/routers/personStateRoute.ts`), which are
exactly the pre-change working tree; `git apply --check -R` against the
working tree passes, so the patch is exactly this change and nothing else.

### The dist files this produces (what actually goes to the box)

Production default-api has **no `src/`**: it is deployed by copying built
files one by one. `dist/` here was built from the working tree with `tsc` +
`tsc-alias` into a scratch dir (zero `require("@/…")` left - checked in all
eight files):

| dist file | new / replaces | also carries |
|---|---|---|
| `dist/helpers/adminScope.js` | new | - |
| `dist/services/AdminScopeService.js` | new | requires `services/RoleResolverService`, `helpers/roleGuard` (people-roles), `services/TenantApiService`, `models/Site`, `models/CustomRole` |
| `dist/controllers/AdminScopeController.js` | new | - |
| `dist/routers/adminScopeRoute.js` | new | requires `middlewares/RoleGuard` (people-roles) |
| `dist/middlewares/PermissionGuard.js` | replaces the permissions copy | diffed: only this change |
| `dist/helpers/permissionTree.js` | replaces the permissions copy | diffed: only `applyMode`'s signature (4 lines) |
| `dist/routers/userRoute.js` | replaces the permissions copy | diffed against `../permissions/dist/routers/userRoute.js`: only this change |
| `dist/routers/personStateRoute.js` | replaces the person-states copy | diffed against `../person-states/dist/routers/personStateRoute.js`: only this change |
| `dist/patch_admin_scope_dist.py` | the two-line `app.js` mount | anchors on the person-states mount; proven byte-identical to the tsc output |

`app.js` is deliberately **not** shipped whole: the working tree's `app.ts`
also mounts invites, profile, trusted devices and company-self, and a router
that requires a missing file stops default-api at start. The script adds the
two lines and nothing else.

**Order matters.** People-roles, person-states and permissions must be on the
box first (this replaces two of their files and anchors on a third).

## Verification done here

- `cd default-api && npx tsc --noEmit -p .` -> exit 0.
- `bash tests/run.sh` -> **14 tests, 14 pass**: absent / junk / unknown level
  read as company-wide; the unused list and junk ids dropped; the owner never
  scoped; self never scoped; absent and company reach everybody; location in /
  out / no site / empty; group in / out / no group / empty, site ignored;
  the scope refusal through `applyMode` in report and enforce with the exact
  403 body; `scopeFilter` for every level (caller always kept on their own
  list); setting a scope: unresolved caller, own scope, non-admin caller,
  scoped MANAGER, owner target, MANAGER target by a MANAGER, non-admin
  target; `checkScopeValue` shape and existence.
- Website: `npx tsc --noEmit -p tsconfig.app.json` -> 0 errors in any touched
  file. The run reports 7 errors in `src/pages/dashboard/home/index.tsx`
  (`meter` on `Kpi`) and `src/pages/admin-settings/numbers/number-list/index.tsx`
  (unused `Link`) - both files are modified in the shared working tree by a
  parallel session and are not touched here. `npx eslint` on the ten touched
  files -> 0 errors, 0 warnings.
- `default-api.patch`: `git apply --check -R` against the working tree passes.
- `dist/patch_admin_scope_dist.py`: run on a copy of the built `app.js` with
  the two lines removed -> output identical to the tsc build; a second run
  reports SKIP.
- `apply.sh --check` on the working tree reports "already applied", as it should.

Not done, because it needs a database or a server: **no request has been
sent.** In particular:

- the tenant-api `department/listing` response shape (`data.data.result.rows`,
  `members[].user_uuid`, `manager.user_uuid`) was read from the tenant-api
  source and the website's own reader, not from a live answer;
- whether `User.update({ settings: <object> })` round-trips through the JSON
  column the same way `UserController.update` writes it (it passes the parsed
  object when the client sent an object; the same shape is used here);
- the two-phone test: as a MANAGER scoped to Delhi, `DELETE /api/user/delete/<person in Mumbai>`
  -> in report mode a log line with `reason:"scope", scope_reason:"outside_location"`
  and a 200; in enforce mode a 403 `{ message: "That person is at a location you do not manage.", permission: "account_setting.access.USER.action.delete" }`;
  the same MANAGER on a person in Delhi -> 200 and no line; the owner on
  anybody -> 200 and no line.

## Known edges, written down rather than hidden

- `POST /api/user/update` writes the whole `settings` blob the client sends
  (`UserController.update`, not editable today). `/api/user/list` returns
  `settings`, so the People drawer round-trips `admin_scope` untouched; a
  client that builds `settings` from scratch would wipe a scope. When
  `UserController` may be edited: preserve `settings.admin_scope` on update
  unless the caller is allowed to set it.
- A group scope depends on tenant-api answering. If it does not, report mode
  lets the request through and logs `permissionGuard: scope check failed`;
  enforce mode refuses with "Your admin scope could not be checked".
- A person whose `site_uuid` is empty is invisible to every location admin.
  The screen's "What this reaches" counts them ("N have no location set and
  are left out") so the owner sees it before it bites.
- The old `settings.admin_scopes` list on the Company Default template is
  left as is and ignored.

## Apply

Source tree: `bash apply.sh --check <default-api dir>` then
`bash apply.sh [--build] <default-api dir>`. Website: the ten files under
`web/src/` are the working-tree versions; copy them over the same paths.

Production box (no src):

1. Make sure people-roles, person-states and permissions are on the box
   (`dist/services/RoleResolverService.js`, `dist/routers/personStateRoute.js`,
   `dist/middlewares/PermissionGuard.js` exist).
2. Back up the four replaced dist files beside themselves
   (`*.bak-admin-scope-<stamp>`).
3. Stage under `/root/mcm-patches-03sep/admin-scope/` (direct scp into
   `/var/www/prod` is blocked), then copy the eight `dist/` files into
   `/var/www/prod/default-api/dist/…` and run
   `python3 patch_admin_scope_dist.py /var/www/prod/default-api/dist`.
4. Leave `PERMISSION_ENFORCE` unset (report). `pm2 restart default-api`.
5. Build and ship the website from the branch the live site is built from
   (see memory: live site is built from `feat/queues-reports`, not `main`).
6. Set one scope on the screen; confirm `POST /api/person/scope` returns it
   and the People list shows the suffix. Then the two-phone test above and
   `pm2 logs default-api | grep '"reason":"scope"'`.
7. When the log has stayed quiet for real use, `PERMISSION_ENFORCE=enforce`
   (this switches on the tree check from row 32 at the same time - they share
   the flag on purpose), restart, retest.

## Rollback

Box: put the four backed-up dist files back, delete the four new ones, restore
`app.js` from the `.bak-admin-scope-*` the script made, `pm2 restart default-api`.
Or, without touching files: unset `PERMISSION_ENFORCE` (report mode changes no
answer, only adds a log line) - the new endpoints keep working either way.
Source: `bash rollback.sh <api> <backup dir>`. Scopes already written stay in
`users.settings.admin_scope`; nothing reads them once the files are gone.
