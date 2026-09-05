# Permissions: the role's tick-boxes, read on the server (fix sheet row 32)

**NOT DEPLOYED.** Source changes sit in `/root/UCAAS/mcm-repos/default-api` as
uncommitted working-tree edits, on top of the same day's people-roles,
company-settings and media changes (never revert those). This folder is the
portable copy: the patch, the new files, the built `dist/` files, and the unit
tests. Audit row 32 of `docs/audit-2026-09-03/my-account-people-roles-fix-sheet.xlsx`;
the evidence is in `docs/audit-2026-09-03/appendix-b-people-roles.md` B.1-B.3.

## What was wrong, in plain words

An administrator builds a role on Roles > Add role: a tree of tick-boxes
("can add people", "can delete people", "can listen to recordings"...). The
website reads that tree to decide which buttons to show. **No server route read
it at all** (appendix B.2: zero middleware hits against 396 `auth` routes). So
every box was decorative: untick "delete people" for a role and its holders
lose the button, but the delete request still works if sent by hand.

The 3 Sep people-roles change (`../people-roles/`) added the first server-side
question: *is the caller an administrator at all?* (`RequireAdminRole`, on the
resolved system role). This change adds the second question on top of it: *did
the caller's role get this particular box ticked?*

## What it does

`RequirePermission(key)` (`src/middlewares/PermissionGuard.ts`) sits on a route
after `auth` and after `RequireAdminRole` where one is wired. It:

1. resolves the caller's role the same way the People rules do
   (`RoleResolverService`: `custom_role_uuid` → parent, `role_uuid`, a uuid in
   `users.role`, a bare key in `users.role`; never the free-text string alone);
2. finds the tree that applies to them, in the website's own order
   (`hooks/rbac.tsx`), plus one fallback at the end:

   | role | tree |
   |---|---|
   | custom role | `custom_roles.permission` (its own tree; an empty column falls through to the parent's) |
   | system role | `role_features.permission` for (company's plan, role) — what `PlansController.autoAssignRolePermissions` seeds |
   | ↳ else | `roles.permission` on the PREDEFINED row |
   | ↳ else | `users.permission` on the person (carried on `req.auth`) |
   | ↳ else | `role_features.permission` for the platform's **default plan** (`plans.is_default = 1`) and that role |
   | ADMIN | no tree needed: the account owner passes everything (the website gives ADMIN the whole plan tree for the same reason) |
   | nothing resolves | refused |

3. reads the dotted key by walking the tree exactly as
   `router/protected-route.tsx` does: `account_setting.access.USER.action.edit`
   = `plan_features → account_setting → access → USER → action → edit`. Only a
   boolean at the end counts. **A missing key is not permission** (the website
   says the same).
4. self versus other: a route that acts on a person passes `target`. When the
   target is the caller, an explicit `<...>.action.self` boolean in the tree
   decides; the trees seeded today have no such key, and then acting on
   yourself is always allowed (the People rules already say editing yourself
   needs no administrator).
5. answers `403 { success:false, message, permission:<key> }` when refused —
   in enforce mode. In report mode it logs and lets the request through.

Trees are cached per company for 30 seconds (`PermissionTreeService`). A role
edit therefore reaches the server's decision within half a minute, which is
sooner than the website notices (it re-reads `/api/user/info` on the next
page load).

## The two modes (`PERMISSION_ENFORCE`)

Same pattern as `CompanyPolicyLock` / `COMPANY_POLICY_LOCK`:

| `PERMISSION_ENFORCE` | refused request | log line |
|---|---|---|
| unset / `report` (default) | goes through | `permissionGuard: report mode, would have refused {user, company, role, role_uuid, custom_role_uuid, tree_source, key, reason, self, route}` |
| `enforce` | `403 {message, permission}` | none |

`reason` in the log is one of `unresolved_role`, `no_tree`, `refused`
(key present, false), `missing` (key absent from the tree). That last value is
the one to read before flipping to enforce: a key that shows `missing` for a
built-in role means the seeded tree never had it, and enforcing would refuse
everyone on that role, not only the ones an admin unticked.

A failure inside the check (database away) lets the request through in report
mode and refuses it (403) in enforce mode, so enforce is never quietly open.

Report is the default because `/api/user/list` is read by 13 website files,
most of them nothing to do with the People page (assign-users dialog,
departments, chat and transfer pickers). Whether the seeded AGENT / MANAGER /
SUB-ADMIN trees carry `account_setting.access.USER.action.view = true` has not
been checked against the live `role_features` rows (no database from here).
A few days of the log answer that before anyone is refused.

## Route → key

| route | existing guard | added | key | self |
|---|---|---|---|---|
| `POST /api/user/list` | auth | RequirePermission | `account_setting.access.USER.action.view` | — |
| `POST /api/user/add-member` | auth, RequireAdminRole | RequirePermission | `account_setting.access.USER.action.add` | — |
| `POST /api/user/update/:uuid?` | auth, CompanyPolicyLock | RequirePermission (before the lock) | `account_setting.access.USER.action.edit` | target = `:uuid` or the caller when absent; self allowed unless the tree has `...action.self=false` |
| `DELETE /api/user/delete/:uuid` | auth, RequireAdminRole | RequirePermission | `account_setting.access.USER.action.delete` | — (deleting yourself is refused by the People rules anyway) |
| `POST /api/user/assign-role-bulk-users` | auth, RequireAdminRole | RequirePermission | `account_setting.access.USER.action.edit` — the tree has **no "assign role" box**; changing a role is an edit of the person | — |
| `POST /api/tenant/user/template/upsert/:uuid?` | auth, RequireAdminRole | RequirePermission | `phone_system_action.action.edit` | — |
| `DELETE /api/tenant/user/template/delete/:uuid` | auth, RequireAdminRole | RequirePermission | `phone_system_action.action.edit` | — |
| `POST /api/tenant/user/company-settings/save` | auth (tenant-api refuses a non-admin role string) | RequirePermission | `phone_system_action.action.edit` | — |
| `GET /api/media/:uuid/:type/:file_name` | auth + company check in the controller | RequirePermission, only when `:type` is `recording` | `reports.action.call_recording_listen` | — (a recording file name carries no person; the "own calls" answer lives in `company_policies.recording_access`, not in the tree) |

### Routes named in the row that got NO key, and why

| route | why |
|---|---|
| Roles list / upsert / delete (`rolesRoute.ts`: `/role/list`, `/role/custom/list`, `/role/custom/upsert`, `/role/custom/remove/:uuid`, `/role/upsert`, `/role/delete/:uuid`) | The tree has **no role-management key** (checked: `interfaces/IPlan.ts` FeatureFlags, the website's `router/index.tsx` — the Roles pages are `adminOnly`, and no `roles`/`ROLE` node is read anywhere). Left on `RequireAdminRole` (writes) / `auth` (lists — the add-person form reads the role list for anyone who may add people). Not guessed. |
| Recording **list** | There is no recording-specific list route. The Call recordings page reads the same `POST /api/tenant/report/call-list` / `call-history` as every other call-log page, and those are gated on the website by `reports.action.call`, not `call_recording_listen`. Putting the listen key on the list would refuse call history to a role that may see calls but not hear them; putting `reports.action.call` on it is a different row (the phone console's recent-calls column reads the same endpoint for people with no reports access at all). Left as is, and listed here. |
| Recording **delete** (`DELETE /api/media/delete` with `type: recording`; `DELETE /api/tenant/report/call-list/delete/:uuid`) | The tree has **no recording-delete key**: `reports.action` holds `call`, `sms`, `call_recording_listen` only (website reads, `IPlan.ts`). `media/delete` already refuses a non-ADMIN role string for non-library types (`MediaController.deleteFile`). Not guessed. |
| `POST /api/user/list-deleted`, `POST /api/user/restore/:uuid` | Not in the row; the closest boxes are `delete`/`add` but neither means "see and undo removals". Left on `RequireAdminRole`. |

### One key to confirm in the log before enforce

`phone_system_action.action.edit`. The website reads `phone_system_action.action.view`
and `.action.add` (`pages/departments/index.tsx`, `directory/groups.tsx`,
`router/index.tsx`), so the live tree has a flat `action` block under
`phone_system_action` — but `edit` itself is not read by any website file, and
the TypeScript interface (`IPlan.ts`, older) nests `action.edit` under
`access.IVR|QUEUE|DEPARTMENT` instead. If the seeded trees lack the flat
`edit`, the log shows `reason: "missing"` on the three template / settings
routes for every non-owner administrator; that is the signal to either seed
the key or move those routes to a key that exists. It was wired as asked, with
this caveat rather than a guess at a different key.

## What changes, file by file

### default-api source

| file | what |
|---|---|
| `src/helpers/permissionTree.ts` | **new**, pure, no imports: `unwrapPlanFeatures` (the website's reader, ported), `selectTree` (the fallback order), `readPermission`, `evaluatePermission` (the decision), `permissionMode` / `applyMode` (report vs enforce) |
| `src/services/PermissionTreeService.ts` | **new**: the lookups (custom_roles, role_features, roles, users.permission, default plan), the 30 s per-company cache, `decide(auth, key, {isSelf, selfKey})` |
| `src/middlewares/PermissionGuard.ts` | **new**: `RequirePermission(key, { target?, selfKey?, when? })` |
| `src/routers/userRoute.ts` | **edited**: list, add-member, update, delete, assign-role-bulk-users |
| `src/routers/mediaRoute.ts` | **edited**: the authenticated media route, recordings only |
| `src/routers/TenantRouter/tenantUserTemplate.ts` | **edited**: template upsert, delete |
| `src/routers/TenantRouter/tenantCompanySettings.ts` | **edited**: company-settings save |

Not touched: `UserController.ts`, `AuthController.ts`, `rolesRoute.ts`,
`Roles/index.ts`, `RoleGuard.ts`, `RoleResolverService.ts`, `roleGuard.ts`.

### The dist files this produces (what actually goes to the box)

Production default-api has **no `src/`** (see `../company-settings/README.md`):
it is deployed by copying built files one by one. `dist/` here was built from
the working tree with `tsc` + `tsc-alias` into a scratch dir (zero `require("@/…")`
left — checked in all seven files):

| dist file | new / replaces | also carries |
|---|---|---|
| `dist/helpers/permissionTree.js` | new | — |
| `dist/services/PermissionTreeService.js` | new | requires `services/RoleResolverService`, `helpers/roleGuard` (people-roles bundle) |
| `dist/middlewares/PermissionGuard.js` | new | — |
| `dist/routers/userRoute.js` | replaces | the people-roles router (`RequireAdminRole`, list-deleted, restore) and `CompanyPolicyLock` (live). Diffed against `../people-roles/dist/routers/userRoute.js`: the only difference is this change |
| `dist/routers/TenantRouter/tenantUserTemplate.js` | replaces | the people-roles router. Same diff check: only this change |
| `dist/routers/TenantRouter/tenantCompanySettings.js` | replaces | the company-settings router (live on mcm-new since 3 Sep) |
| `dist/routers/mediaRoute.js` | replaces | the direct-media-auth change (already in the repo's own `dist/`; diff against it shows only this change) |

**Order matters.** `PermissionTreeService.js` requires `RoleResolverService.js`
and `helpers/roleGuard.js`, and the two routers require `middlewares/RoleGuard.js`;
all three come from `../people-roles/dist/` and are **not yet on the box**. Copy
the people-roles bundle first, or copy those three files alongside this one.
A router that requires a missing file stops default-api at start.

## Verification done here

- `cd default-api && npx tsc --noEmit -p .` → exit 0.
- `bash tests/run.sh` → 10 tests, 10 pass: unwrap (string JSON, doubled
  `plan_features`, whisper alias); path walk (case, object-not-boolean, 1/0 and
  "true"/"false"); ADMIN passes with and without a tree; custom role key true /
  false; missing key; no tree; unresolved role (and a custom tree still
  deciding for a null parent); the fallback order incl. default plan; self vs
  other with and without an explicit `self` key and with `selfKey`; report vs
  enforce and the exact 403 body.
- `default-api.patch` applies cleanly to the pre-change working tree and
  reproduces it byte for byte (checked in a scratch copy).
- `dist/` built from the working tree; the four router files diffed against
  the bundles they replace (above).

Not done, because it needs a database or a server: no request has been sent;
the live `role_features` trees for AGENT / MANAGER / SUB-ADMIN have not been
read, so which keys they actually carry (`view`, flat `phone_system_action.action.edit`)
is unconfirmed — that is exactly what report mode is for.

## Apply

Source tree: `bash apply.sh --check <default-api dir>` then
`bash apply.sh [--build] <default-api dir>`.

Production box (no src):

1. Make sure the people-roles bundle is on the box (`dist/services/RoleResolverService.js`,
   `dist/helpers/roleGuard.js`, `dist/middlewares/RoleGuard.js` exist).
2. Back up the four replaced dist files beside themselves
   (`*.bak-permissions-<stamp>`).
3. Copy the seven `dist/` files into `/var/www/prod/default-api/dist/…`
   (stage under `/root/mcm-patches-03sep/permissions/` first; direct scp into
   `/var/www/prod` is blocked).
4. Leave `PERMISSION_ENFORCE` unset (report). `pm2 restart default-api`.
5. Watch the log: `pm2 logs default-api | grep permissionGuard`. Sort the
   lines by `key` and `reason`. `missing` on a built-in role = seed the key
   or change the route's key; `refused` = the admin's own choice, working.
6. When the log has stayed quiet for real use, add `PERMISSION_ENFORCE=enforce`
   to `/var/www/prod/default-api/.env`, restart, and retest: as an AGENT whose
   role has `delete` unticked, `DELETE /api/user/delete/<colleague>` → 403
   `{message:"Your role does not allow this.", permission:"account_setting.access.USER.action.delete"}`;
   the same AGENT `POST /api/user/update` (no uuid) → 200; as the owner,
   everything → 200 as before.

## Rollback

Box: put the four backed-up dist files back, delete the three new ones,
`pm2 restart default-api`. Or, without touching files: unset
`PERMISSION_ENFORCE` (report mode changes no answer, only adds a log line).
Source: `bash rollback.sh <api> <backup dir>`.
