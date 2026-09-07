# People and Roles audit — 3 Sep 2026

Read-only audit of the People section (People, Roles, the four access-control screens,
Directory people/roles, the /department pages) against the backend TypeScript source at
/root/UCAAS/mcm-repos. Nothing was changed. Every claim below is from reading source;
nothing was exercised live, so anything marked "check live" still needs a retest.

Paths are abbreviated: `web/` = /root/mycountrymobile-web/src, `api/` =
/root/UCAAS/mcm-repos/default-api/src, `tenant/` = /root/UCAAS/mcm-repos/tenant-api/src.

## 0. Branch check and the "zero needs a control" table

`git diff main feat/queues-reports --stat -- src/pages/admin-settings/people
src/pages/admin-settings/roles src/pages/directory src/pages/departments src/lib` returns
**nothing**. Control: the full `git diff main feat/queues-reports --stat` shows 39 files,
+2031/−671 (reports sidebar, router, queue files). So the People/Roles/Directory/
Departments/lib code is byte-identical on both branches; this audit applies to the live
site.

| Looked for | Found | Control in the same scope |
|---|---|---|
| Permission middleware in `api/middlewares` (grep -i permission) | 0 | 396 routes wrapped in `auth` across `api/routers` |
| Callers of `Roles.checkUserPermission` (backend + frontend) | 0 + 0 | the route itself is registered at `api/routers/rolesRoute.ts:23` |
| Controllers reading `req.auth.role` / `userData.role` | 1 (`api/controllers/UserController.ts:1845`) plus 7 destructured-`role` reads listed in B.3 | — |
| Callers of `writeRuleFlags` outside `web/lib` | 0 | `readRuleFlags` has 14 call sites in `web/pages/admin-settings/people/update-forwarding/index.tsx` |
| Writers of `role.override` (POLICY_FIELDS.role) | 0 (only the definition, `web/lib/company-policy.ts:40`) | `recording.override` is written at `web/pages/admin-settings/templates/user-settings/add-edit-user-settings/settings/index.tsx:201` and read at `web/components/common-settings/index.tsx:433-443` |
| Import / invite-token / resend / deactivate in the People UI | 0 | `deleteMember` has 8 hits in the same folders |
| Imports of the legacy list pages `admin-settings/people/index.tsx` and `admin-settings/roles/index.tsx` | 0 | `update-forwarding` is imported by 3 other pages |
| Tenant-facing code setting `users.status = 'INACTIVE'` | 0 | 5 cron writes (`api/controllers/CronController.ts:1248,1952,2023,2137,2158`) and the platform-admin `Admin/CompanyController.ts:1083-1090` |
| `x-db-name`/role header consumed by tenant-api | `X-User-role` sent at `api/services/TenantApiService.ts:148,199` | — |

## 1. What renders where (router)

| Nav entry | Path | Component | Guard |
|---|---|---|---|
| People ▸ People | `/admin-settings/people` | `web/pages/directory/people.tsx` (DirectoryPeople) | permission `account_setting.access.USER.action.view` (`web/router/index.tsx:816-822`) |
| People ▸ Roles | `/admin-settings/roles` | `web/pages/directory/roles.tsx` (DirectoryRoles) | `adminOnly` (`router/index.tsx:834-836`) |
| (not in nav) | `/admin-settings/access-control` | `roles/access-control/index.tsx` | adminOnly (`:843`) |
| (not in nav) | `/admin-settings/capability-matrix` | `roles/capability-matrix/index.tsx` | adminOnly (`:850`) |
| (not in nav, on purpose) | `/admin-settings/admin-scope` | `roles/admin-scope/index.tsx` | adminOnly (`:858`); sidebar comment explains why it is hidden (`web/pages/admin-settings/sidebar/index.tsx:132-139`) |
| (not in nav) | `/admin-settings/default-permissions` | `roles/default-permissions/index.tsx` | adminOnly (`:867`) |
| old links | `/admin-settings/users/extension`, `/users/role`, `/users/department` | redirects (`router:871-882`) | — |
| Directory | `/directory?view=people|roles|groups…` | `web/pages/directory/index.tsx:43-49` — the **same** People and Roles components | none on `/directory` itself (`router:479-482`) |
| "Full record" | `/department/extension/:id`, `/department/organization/:id` | `web/pages/departments/*` (`router:509-545`) | USER view / DEPARTMENT view |

`adminOnly` means `user_info.role === 'ADMIN'` (`web/router/protected-route.tsx:57-59`,
`web/hooks/rbac.tsx:58`). The sidebar shows People to anyone with the USER view permission
and Roles only to ADMIN (`sidebar/index.tsx:106-131`). The three "step" screens
(access-control, default-permissions, capability-matrix) are reachable only by URL, by the
AreaNav strip on each other, or by route prefetch; the Roles page itself does not render
the strip (`directory/roles.tsx` has no AreaNav import), so step 2 → step 3 has no link.

Two whole files are dead: `web/pages/admin-settings/people/index.tsx` (UsersExtension,
615 lines) and `web/pages/admin-settings/roles/index.tsx` (UserRoles, 373 lines) are
imported nowhere (control above). They still carry the old vocabulary ("Users ›
Extension", "Users › Role") but nobody sees them.

## A. PEOPLE page

### A.1 Columns, filters, data source

`web/pages/directory/people.tsx:275-284`: Person (name, job title, email), Role, Groups,
Location (+ city/country), Numbers (extension + caller ID), ACD skills (queue memberships),
Presence (own row gets an availability select, `:339-353`), Contact (action buttons).
Filters `:243-264`: Groups, Location, Presence, free-text search; an "N available" chip.
Header: Groups link, **Export N** (CSV built in the browser, `:180-199`), **Invite person**.

Rows come from `usePeopleRows` (`web/pages/directory/people-rows.ts:85-90`):
`getUserList({page:1, limit:500})` → `POST /api/user/list` (`web/services/api/routes.tsx:80`)
→ `api/controllers/UserController.ts:602-814` (`users` joined to `sites`, `roles` +
`role_features` for the plan, `custom_roles`, `did_numbers`). **Hard cap of 500** — a company
with more people is silently truncated and the export button still says "everybody".
Groups come from `POST /api/tenant/department/list` (`routes.tsx:212` →
`api/routers/TenantRouter/tenantDepartment.ts:92` → tenant-api). tenant-api filters that
list by the caller's role string: a non-ADMIN only sees departments they created, manage,
or belong to (`tenant/repositories/DepartmentRepository.ts:20-28`), so the Groups column is
partial for a non-admin viewer.

### A.2 Every action, its endpoint, handler and table

| Action (people.tsx line) | Shown when | HTTP | Handler | Tables touched | Completes server-side? |
|---|---|---|---|---|---|
| Call / Message / Video (`:375-410`) | always | dialer / messenger / meeting | — | — | yes (other modules) |
| Favourite (`:357-374`) | always | none | — | localStorage | frontend-only |
| Edit (`:411-421`) | `isAdmin && userAccess.edit` (`:66`) | `POST /api/user/update/:uuid` (`routes.tsx:667`, `updateMemberForwading` `api/index.tsx:432`) | `UserController.update` `:1765-1965` | `users` (first/last, profile, job_title, settings, greetings, caller_id, call_forwarding, role, role_uuid, custom_role_uuid) then `profileAndRoleUpdates` fans out to tenant/socket/calendar/video (`api/helpers/CommonHelper.ts:2003+`) | yes |
| Activity (`:422-432`) | `isAdmin` | navigates `/activity/:id` (`router:1890`) | — | — | yes |
| Change role (`:433-443`) | `isAdmin && row.role != ADMIN` (`:114-115`) | `POST /api/user/assign-role-bulk-users` (`routes.tsx:916`) | `assignBulkRoleToUser` `:2687-2807` | `users.role` (= role NAME), `role_uuid`, `custom_role_uuid`, `settings.role` | yes |
| Remove caller ID (`:444-454`) | `canAssignCallerId && callerId` | `POST /api/did/remove-assign-did` (`routes.tsx:727`) | `api/routers/didRoute.ts:93 removeAssignedDid` | `did_numbers` | yes |
| Remove person (`:457-467`) | `userAccess.delete && not self` (`:74`) | `DELETE /api/user/delete/:uuid` (`routes.tsx:771`) | `UserController.delete` `:889-1168` | see A.5 | yes |
| Assign caller ID (`:468-478`) | `canAssignCallerId` | `assignNumberUser` (`assign-caller-id-modal.tsx:57`) → `/api/did/assign-did` / `assign-number` (`routes.tsx:723,857`; `didRoute.ts:90`) | DID controller | `did_numbers.user_uuid`, `users.caller_id` | yes (numbers audit owns the detail) |
| Invite person (`:233-238`) | `userAccess.add && not trial` (`:73`) | `POST /api/user/add-member` (`routes.tsx:526`) | `UserController.addMember` `:1194-1741` | see A.3 | yes |
| Export N (`:219-232`) | always | none | — | — | frontend-only CSV of the (≤500, filtered) rows |
| Availability select (`:339-353`) | own row | `POST /api/user/update-status` (`routes.tsx:400`) | `updateUserStatus` `:2809-2889` | `users.socket_status`, `call_forwarding.status`, Mongo `queue_agents` → "On Break" | yes |

There is **no bulk select** on People. Bulk role assignment lives on Roles ▸ Assign Users
(`roles/assign-users-modal.tsx`, same endpoint). Bulk settings live under Company ▸ Bulk
settings (`company/company-bulk-settings.tsx:300` calls `updateMemberForwading` once per
person). There is **no import**, **no invitation token, no "resend invite"**, and **no
disable/deactivate** anywhere in these screens (control table). "Invite person" is a
create-with-password flow.

### A.3 "Add person" end to end

Step 1 `people/add-users/add-user-info/index.tsx`: up to 10 rows (`MAX_USERS` `:325`), each
first/last/email/phone/role/extension; extension is a random 4-digit number
(`generateNewExtension` `:440-444`) and every field is checked as you type through
`POST /api/user/validate` (`routes.tsx:684` → `UserController.validateUser` `:2606-2644`).
Role defaults from `decideInviteRole` (`web/lib/invite-role.ts:231-287`) using the company's
saved `new_person_default_role` (`:90-96`). A Location (`site`) is required
(`add-users/schema.ts:30-35`). Licence maths `:169-209`. Step 2 `setup-options/index.tsx`:
one password for all / one each / "Send via Email" (no password sent; server generates one).

Submit → `addMember` (`add-users/index.tsx:169-184`; note `role: role?.label` — the NAME is
sent, comment at `:173-179`) → `POST /api/user/add-member` → `UserController.addMember`:

* validates each row with `createUserValidator` (`api/validators/UserValidator.ts:95-111`):
  `role` is `Joi.string().required()` — **any string**; `role_uuid`/`custom_role_uuid` optional.
* bcrypt-hashes the password (`:1229-1233`), breached-password check (`:1242`).
* duplicate email/phone check is **across all companies** (`:1250-1263` — no
  `company_uuid`); extension uniqueness is per company (`:1265-1270`).
* custom role → parent system role (`:1271-1300`).
* licence check against `companies.licenses` (`:1358-1388`); Stripe charge if short
  (`:1410-1513`, 3-D Secure round-trip handled by the drawer `add-users/index.tsx:53-57,238-247`).
* `User.bulkCreate` with `status: 'ACTIVE'` (`:1310`, `:1523`), one `company_licenses` row per
  person (`:1553-1567`), default `settings` from `generateDefaultGeneralSetting` (`:1590-1607`),
  default `call_forwarding` from `generateCallForwarding` (`:1313-1316`).
* e-mails **the plain-text password** to each new person (`:1669-1694`) and a socket/SMS
  notification to the admin (`:1696-1726`).
* the drawer then offers "Assign Now" for a number (`add-users/index.tsx:334-363`).

**SIP extension / device provisioning.** `addMember` calls **no** switch-side service
(grep for directory-manager/sip-user in UserController: 0 hits; the only `createCredentials`
call is TURN credentials in `info()` `:234`, `api/helpers/stunHelper.ts:36-49`). Provisioning
is implicit: the switch services read the `users` table directly.
`sip-user-data-api/internal/datastore/mysql/sipuserdata.go:41` selects
`users.uuid, extension, password` where `companies.db_name = ? AND extension = ? AND
deleted_at IS NULL` and hands `users.password` to the switch as the SIP secret — i.e. the
**bcrypt hash of the login password** is the SIP password. `fs-directory-manager/internal/
datastore/mysql/sipuser.go:18` and `group.go:27` resolve extension → name/caller_id the same
way, **without** a `deleted_at` filter. So the extension "exists" the instant the row exists;
whether it can register and receive calls is the switch-side story already recorded in
memory (RTP, ICE, fs-directory) and is out of scope here. Not verified live.

`validateUser` is a **cross-tenant oracle**: for `type: email|phone` there is no company
filter (`:2615-2621`), so any signed-in user can probe whether an e-mail or phone exists on
any other tenant. The frontend even distinguishes the two cases in its wording
(`add-user-info/index.tsx:265-274`, `explainTakenEmail` "belongs outside this company").

### A.4 Edit (Update Forwarding drawer)

`people/update-forwarding/index.tsx`, four steps (Basic → Settings & permissions → Media →
Call rules). Save from any step (`handleSaveNow` `:227-260`) builds the payload at
`:398-417` and posts to `/api/user/update/:uuid`. Server `update()`:

* `obj.profile = profile ?? null` (`:1791`) and the drawer payload **never sends `profile`**
  → **every save from this drawer wipes the person's avatar**. High confidence from source;
  check live.
* role is taken from `settings.role.label` when it is not a uuid (`:1825-1831`) **or** from
  `role_uuid`/`custom_role_uuid` (`:1851-1926`); the frontend picks the key by whether the
  label is one of MANAGER/ADMIN/AGENT/SUB-ADMIN (`update-forwarding/index.tsx:410-412`).
* the only authorisation is "an ADMIN target may be modified only by itself" (`:1844-1849`).
  There is no check that the **caller** may edit people.
* transcription / AI monitoring round trip: on open the drawer sets
  `settings.transcription = readRuleFlags(personSettings,'transcription').apply ? … : false`
  (`:748-759`); on save `removeOverride` strips `override/apply/locked` (`:453-466`). A person
  record therefore never carries the flag → `apply` reads as legacy-false → **the toggle
  reopens as OFF whatever was stored**, and the next save writes OFF. (`readRuleFlags` on a
  bare boolean also falls through to legacy, `web/lib/company-rule-flags.ts:159-167`.) Check
  live.
* Call rules step says on its face that nothing in the call path reads them
  (`call-rules/index.tsx:201-218, 247-250`).
* Basic step: Location change also fills timezone/country from the site
  (`basic-information/index.tsx:64-79`); extension/phone/email are read-only.

### A.5 Delete — what actually happens (`UserController.delete` `:889-1168`)

* Refuses if the target's `users.role` is `ADMIN` (`:912-914`). No check on the caller.
* `User.destroy` on a `paranoid` model (`api/models/User.ts:246`) → **soft delete**
  (`deleted_at` set). The `email` column is `unique` (`User.ts:124`) and the soft-deleted row
  still occupies it, so re-adding the same address later will hit the DB constraint
  (`addMember`'s own check uses the paranoid scope and will not see the old row) — likely
  failure, check live.
* Sessions destroyed (`device_securities` `:930-936`) → immediate logout.
* Licence freed (`company_licenses.user_uuid = null` `:938-949`).
* Numbers **assigned to** the person: `user_uuid=null, type='P', forward_call_actions=null,
  settings=null` (`:951-965`).
* Numbers that **forward to** the person's extension (business-hours or closed-hours value):
  `forward_call_actions` and `settings` set to **null entirely** (`:969-994`) — the whole
  number loses all its routing, not just the one target.
* Colleagues whose personal forwarding points at the extension are rewritten to point at
  **the extension of whoever clicked delete** (`:1011-1091`) — an odd choice; the deleting
  admin silently inherits the deleted person's forwards.
* Mongo queues: agent rows nulled/"Logged Out", queue `members`/`manager` pruned
  (`CommonHelper.cleanupDeletedUserReferences` `api/helpers/CommonHelper.ts:2175+`).
* Socket `account-delete` (`:1097`); tenant DB: department members/manager and the
  department's forward actions cleaned (`tenant/repositories/DepartmentRepository.ts:249-330`,
  route `tenant/routers/api.ts:442`), IVR `delete-member-status` (`:1134-1147`).
* **Voicemails: nothing** (0 voicemail references in the delete path; control: the file has
  voicemail notification code at `:1977-1995`). Recordings, call history, contacts: untouched.
* sip-user-data-api stops answering for the extension (`deleted_at IS NULL`); the
  fs-directory-manager lookup does not filter `deleted_at`, so directory lookups can still
  resolve a deleted extension. Check live.

The frontend adds a removal-impact dialog (`web/components/mcm/removal-warning.tsx`,
`web/lib/removal-impact.ts:342-343`) that blocks only "locks-you-out"/"refused"; it is
advisory and browser-side.

### A.6 What a person's status means

`users.status ENUM('EXPIRED','ACTIVE','INACTIVE','PENDING')`, default `PENDING`
(`api/models/User.ts:136`), but every tenant-side creation writes `ACTIVE` (`addMember`
`:1310`; signup `AuthController.ts:1334,1787,3291`). **No tenant screen or tenant API ever
sets INACTIVE or PENDING** — only platform-admin `Admin/CompanyController.ts:1083-1090`
(whole company) and expiry crons (control table). So "invited" and "disabled" do not exist
as per-person states. What INACTIVE would do if set: login refused
(`AuthController.ts:592-596`), every API call 403 (`api/middlewares/AuthMiddleware.ts:162-163`),
but **calls are not blocked**: `sipuserdata.go:41` does not read `status`, so the phone
still registers and rings. The "Presence/Availability" shown on People is
`call_forwarding.status`/`socket_status` (`people-rows.ts:155-168`), a different thing.

## B. ROLES pages

### B.1 What each screen stores and where

| Screen | Reads | Writes | Table |
|---|---|---|---|
| Roles list (`directory/roles.tsx:59-63`) | `POST /api/user/role/list` (`routes.tsx:231`) → `Roles.getRoleList` (`api/controllers/Roles/index.ts:254-411`): system roles = `role_features` rows for the plan joined to `roles` (display=true unless `admin_display`), plus this company's `custom_roles`; user counts from `users.role_uuid`/`custom_role_uuid` | Delete → `DELETE /api/user/role/custom/remove/:uuid` (`Roles:217-226`) | `roles`, `role_features`, `custom_roles` |
| Add / edit / duplicate role (`roles/add-new-role/index.tsx:70-87`) | company plan tree (`hooks/rbac.tsx`) as the menu | `POST /api/user/role/custom/upsert` (`Roles.upsertCustomRole:163-215`): `name, description, role_uuid (parent), permission {plan_features}` | `custom_roles` |
| Assign users (`roles/assign-users-modal.tsx:194-197`) | `/api/user/list` | `POST /api/user/assign-role-bulk-users` | `users.role, role_uuid, custom_role_uuid, settings.role` |
| Default permissions (`roles/default-permissions/index.tsx`) | roles list + Company Default template | (a) `new_person_default_role` into the Company Default template settings (`:159-165` → `saveCompanyDefaults` → `POST /api/tenant/user/template/upsert` `routes.tsx:834` → `api/routers/TenantRouter/tenantUserTemplate.ts:79` → tenant DB `user_template`); (b) "Create role" → `upsertCustomRole` with a computed permission tree (`:202-208`) | tenant `user_template`, `custom_roles` |
| Admin scope (`roles/admin-scope/index.tsx:58,180-187`) | people, sites, departments, Company Default | `settings.admin_scopes` on the Company Default template | tenant `user_template` |
| How access works (`roles/access-control/index.tsx`) | constants | nothing (`:17-18`) | — |
| Capability matrix (`roles/capability-matrix/index.tsx`) | `capabilityMatrix()` from `web/lib/role-permission-defaults.ts:908` | nothing | — |

Who READS these:
* the permission JSON — **frontend only**: `useCompanyFeatures` (`web/hooks/rbac.tsx:55-76`:
  ADMIN gets the company plan tree, everyone else `custom_role_data.permission ??
  role_data.permission ?? users.permission`), `ProtectedRoute` (`protected-route.tsx:61-84`),
  sidebar visibility, and per-screen `userAccess?.x` flags. Backend: `UserController.info`
  returns it (`:294-297`) and `Roles.checkUserPermission` (`:413-471`) would return it, but
  that endpoint has **zero callers** (control table).
* `new_person_default_role` — read only by `add-user-info/index.tsx:90-96`.
* `admin_scopes` — read only by the Admin scope page itself; `canActOn`
  (`web/lib/admin-scope.ts:233`) is called by nothing outside that lib (the sidebar comment
  `sidebar/index.tsx:132-139` says the same).

### B.2 The claim "the permission tree is never enforced server-side" — CONFIRMED

* No middleware reads permissions (0 hits; control 396 `auth`-guarded routes).
* `AuthMiddleware` (`api/middlewares/AuthMiddleware.ts:25-209`) checks JWT, device session,
  `users.status === 'ACTIVE'`, company plan status, and — the one role check — that a
  `PLAN_RENEW` token belongs to an `ADMIN` (`:155`). It never loads `role_data`/`custom_role`.
* tenant-api's `TenantAuthMiddleware` (`tenant/middlewares/TenantAuthMiddleware.ts:115-146`)
  trusts headers; default-api forwards `X-User-role: user.role` — the raw `users.role`
  string (`api/services/TenantApiService.ts:148,199`).

### B.3 Every server-side role check found (all compare the `users.role` string)

default-api:
* `middlewares/AuthMiddleware.ts:155` — `user.role !== "ADMIN"` → plan-renew token refused.
* `controllers/UserController.ts:290` — non-ADMIN does not receive `plan_features_temp` in `/api/user/info`.
* `controllers/UserController.ts:912` — target `ADMIN` cannot be deleted.
* `controllers/UserController.ts:1844-1849` — target `ADMIN` may be updated only by itself (caller's `users.role` compared).
* `controllers/UserController.ts:3273` — non-ADMIN sees only their own device sessions.
* `controllers/UserController.ts:823` — finds "the" ADMIN of a company (queue lookups).
* `controllers/DID/DidController.ts:179` and `:1525` — `role === "AGENT"` restricts number list/count to own numbers.
* `controllers/MetaController.ts:344` — non-ADMIN Meta onboarding notifies the ADMINs.
* `controllers/AuthController.ts:560`, `:869` — expired plan: only ADMIN gets a renew token.
* `controllers/Admin/Admin.ts:177` — platform "login as" only for ADMIN/SUB-ADMIN.
* `controllers/Admin/CompanyController.ts:1083` — platform admin (de)activating a company via its ADMIN user.

tenant-api:
* `repositories/DepartmentRepository.ts:20`, `:84` — non-ADMIN sees only departments they created/manage/belong to.
* `repositories/DepartmentRepository.ts:231,236` — role-based department list: MANAGER = managed departments, ADMIN = all, **anything else = undefined** (no rows).
* `utils/callHistoryFilter.ts:11` — `AGENT` sees only calls touching their extension.

That is the whole server-side authorisation model: ADMIN vs not, plus AGENT/MANAGER
narrowing in three places. `SUB-ADMIN` is never checked outside the platform-admin
"login as" path.

### B.4 Role strings: schema vs what the frontend offers

* Schema: `users.role` is `STRING(36)` with default `"ADMIN"` (`api/models/User.ts:119`) —
  **free text, no enum**. A person created with an empty role becomes ADMIN by default (the
  frontend guards against that, `web/lib/invite-role.ts:302-311`).
* The only enums: `admin_notifications.role ENUM('GLOBAL','ADMIN','SUB-ADMIN','MANAGER','AGENT')`
  (`api/models/Admin/AdminNotification.ts:47`); `users.created_by ENUM('ADMIN','COMPANY')`
  (`User.ts:235`); `CreatedByEnum2.SUPER_ADMIN` (`api/interfaces/IUser.ts:7`) is a creator
  tag, never a user role.
* Predefined `roles` rows referenced in code: ADMIN, SUB-ADMIN, MANAGER, AGENT
  (`api/controllers/Admin/PlansController.ts:246,275,1089`; `Roles/index.ts:57`).
* Frontend offers whatever `/api/user/role/list` returns (system roles with `display=true`
  for the plan + custom roles). Three vocabularies are shown for the same things:
  raw names (MANAGER, AGENT…) in the Role Change modal (`role-change-modal.tsx:45-49`), the
  Add person form (`add-user-info/index.tsx:642-647`) and Assign Users; display names
  "Account owner / Account admin / People admin / Call reviewer"
  (`web/lib/role-display-names.ts:29-46`) only on the Roles list; presets "Account owner,
  People admin, Account admin, Call reviewer, Call flow builder" (`roles/add-new-role/
  role-presets.ts:66-97`); and the six tiers "Company Admin, Location Admin, Department
  Admin, Supervisor, Agent, User" (`web/lib/role-permission-defaults.ts:169-227`) on the three
  step screens. An admin cannot match "Account admin" on Roles with "MANAGER" in the Change
  role dialog.

### B.5 Can a custom role change what the server allows? Yes — through its NAME only, and that is a hole

The permission JSON changes nothing server-side (B.2). But both role-assignment paths copy
the custom role's **name** into `users.role`: `assignBulkRoleToUser` (`:2747`, `:2790`) and
`update()` (`:1871`, `:1925`). So a custom role named `ADMIN` makes every holder a
server-side ADMIN (passes every check in B.3, including the delete guard, the
update guard, and tenant-api's "see everything" branches). The frontend agrees with it
(`people-rows.ts:138`, `people/index.tsx:124-125` treat `custom_role_data.name` first).
A custom role named `AGENT` conversely narrows the holder's number list.

The routes involved carry only `auth` — no caller-role check — so any signed-in person can:
1. `POST /api/user/assign-role-bulk-users {role_uuid:<ADMIN role uuid>, users:[self]}`
   (`:2687-2807`; the ADMIN role uuid is listed by `GET /api/user/role/predefined/list`,
   `rolesRoute.ts:12`). Nothing excludes the ADMIN role or an ADMIN target — so the account
   owner can also be **demoted** this way. The UI hides both (`assign-users-modal.tsx:102-108`).
2. `POST /api/user/update` (no uuid = self) with `{settings:{role:{label:"ADMIN"}}}` →
   `obj.role = "ADMIN"` (`:1825-1831`); the ADMIN guard at `:1844` looks at the target's
   *current* role, so a non-admin target passes.
3. `POST /api/user/role/custom/upsert` to create a role named `ADMIN`, then (1).
4. `POST /api/user/add-member` with `role:"ADMIN", role_uuid:<ADMIN uuid>` to mint a new
   ADMIN account (validator allows any role string, `UserValidator.ts:106`).
5. `DELETE /api/user/delete/:uuid` on any non-ADMIN colleague; `POST /api/user/update/:uuid`
   on any non-ADMIN colleague; `POST /api/tenant/user/template/upsert` to rewrite the
   Company Default rule / admin scopes / default role (`tenantUserTemplate.ts:79`, auth only).

`/api/update-user-setting` (used by My Phone) is safe from (2): its validator only allows
`settings|notification_settings|greetings|call_forwarding` (`api/validators/AuthValidator.ts:203-215`)
and it writes only the caller's own row (`AuthController.ts:3919-3958`) — but it does accept
a `settings` blob containing `role`, which nothing reads for authorisation. All of this is
from source; none of it was exercised.

## C. Relationship to the Company pages and the person editor

### C.1 Where "the company rule" lives

The company level is a reserved tenant `user_template` row named "Company Default"
(`web/lib/company-defaults.ts:23,58-70`; list `POST /api/tenant/user/template/list`
`routes.tsx:207`, save `/upsert` `:834`). Ten-plus screens write into the same row through
`saveCompanyDefaults({only})`:
* Company ▸ Phone rules / Greetings (`company/company-rules-form.tsx:121-123`) write
  `operational_hours, recording, display_number, transcription, ai_call_monitoring,
  greetings`, each node carrying an `override` flag from the "Let people change this
  themselves" switch (`templates/user-settings/add-edit-user-settings/settings/index.tsx:84,
  143,174,201,227,250,283`).
* Company policies (`company/company-policies.tsx:41,370`) writes only
  `settings.company_policies.*` (voicemail transcription default, international calling
  default…).
* Default permissions writes `new_person_default_role`; Admin scope writes `admin_scopes`.
* `company-record.tsx` is different: it edits the **company row** via
  `/api/admin/company/upsert` (`:9,98`), not the template.
* `company-bulk-settings.tsx` writes **per person** via `updateMemberForwading` (`:300`).

### C.2 apply / locked flags (`web/lib/company-rule-flags.ts`)

The four-state model (apply × locked) exists only in the reader. `writeRuleFlags` has zero
callers outside the lib (control table); every screen still writes the single `override`.
So every record is "legacy": `apply = override`, `locked = !override`
(`company-rule-flags.ts:120`). "Everyone gets it and cannot change it" is still unsayable.

### C.3 Is the rule honoured?

**Admin editing a person (Update Forwarding):** No lock. `CommonSettingPermission` is opened
with `origin: 'user_extension'` (`update-forwarding/index.tsx:991`), and the lock applies
only when `origin === 'general_settings'` (`web/components/common-settings/index.tsx:109-125`);
the form context has no `lockedFields` (`:129`). Company values are copied onto the person
only (a) on first-time setup, and only the two `company_policies` defaults
(`:649-681`, `web/lib/company-new-user-defaults.ts`), plus device ring time; or (b) when the
admin explicitly picks a template (`seSettingsData` `:809-868` uses `.apply`). Otherwise the
person's stored values win. That is the designed behaviour (comment `:109-111`), but it
means a company rule that is "locked" is still freely editable by any admin, per person.

**New person:** the server never reads the Company Default (`addMember` builds settings from
`generateDefaultGeneralSetting`, `:1590-1607`). The frontend seeds only when the person is
later opened in the drawer (isFirstTimeSetup). A person never opened in the drawer never
receives the company defaults. The only company input at creation time is the default role
(`add-user-info:90-96`).

**The person's own My Phone page** (`web/pages/settings/general/index.tsx`, origin
`general_settings`): `useCompanyPolicy` becomes active the moment a Company Default row
exists (`web/lib/company-policy.ts:66`), and `allows(field)` is `!locked`, i.e. `override ===
true`. Because `OverrideRow` defaults to false (`web/lib/user-settings-template-form.ts:159`)
and any screen can create the row (saving Admin scope, Default permissions, holidays…),
**creating the row for any reason locks every governed field on every person's My Phone**
until an admin visits Phone rules and switches each "Let people change this themselves" on.
And the lock is browser-only: `/api/update-user-setting` writes the whole `settings` blob
for the caller with no comparison to the company rule (`AuthController.ts:3949-3958`).

**`role.override` in POLICY_FIELDS** (`web/lib/company-policy.ts:40`): written by nobody;
read only by `settings/general/index.tsx:34-36`, which puts `role` into `lockedFields`
(always locked, because the node is absent), but the schema consults `lockedFields` only for
`regional`, `business_hours`, `display_number` (`update-forwarding/schema.ts:58-75,104-106`)
and the Role card is shown only when `isShowRole` is passed, which happens only in the
admin drawer (`update-forwarding/index.tsx:993`). So `role.override` is dead: no writer, and
its read changes nothing. (Control: `recording.override` is both written and read.)

## D. Vocabulary check against `web/pages/directory/NAMING.md`

Rule 4: "A label never shows a wire word." User-visible labels still using retired words
(dead legacy pages excluded, then listed separately):

**Site**
* `web/pages/departments/users-list/user-details.tsx:216` — field label `Site`.
* `web/pages/admin-settings/people/add-users/schema.ts:31-35` — error text "Site is required".
* `web/pages/admin-settings/people/update-forwarding/basic-information/index.tsx:141` — "Which site this user belongs to."
* `web/pages/admin-settings/phone-systems/departments/index.tsx:103` — column `Site` (Groups admin list).

**Department**
* `web/pages/departments/index.tsx:364` title "Users / Groups"; `:388,:497` "Create Department"; `:487` "Start by adding some departments."
* `web/pages/departments/department-list/department-details.tsx:117` "Start by adding some departments."; `:129` "Create Department"; `:192` "Department Manager"; `:328` "No members found in this departments"; `:353` "Update Department (…)".
* `web/pages/departments/users-list/index.tsx:127` — "No Department Found" shown on the **People** tab (wrong noun and wrong tab).
* `web/pages/admin-settings/roles/admin-scope/index.tsx:240` "chosen departments"; `:432` "Departments they manage"; `:438` "No departments yet. Add one under Phone System"; `web/lib/admin-scope.ts:95-97` tier "Chosen departments".
* `web/pages/admin-settings/roles/access-control/index.tsx:49,51,111-113,157`; `capability-matrix/index.tsx:85,105` — "departments"/"Department Admin".
* `web/lib/role-permission-defaults.ts:189` tier label "Department Admin" (shown on three screens).
* `web/pages/directory/groups.tsx:71` "the same records Admin calls Departments" (deliberate, but a wire word on screen).
* `web/pages/admin-settings/phone-systems/departments/index.tsx:62,239` "Department Name", "Department".

**User / Users**
* `web/pages/directory/people.tsx` — clean.
* `web/pages/admin-settings/people/add-users/index.tsx:152` step "Add User Info"; `:106` toast "Member created successfully"; `:357` "Member created successfully. Please go to Extensions to assign the DID number." (Member + Extension-for-a-human in one line).
* `web/pages/admin-settings/people/add-users/add-user-info/index.tsx:504` button "Add Users"; `:384,395` "Maximum of 10 users…"; `:411-412` "You can only add N more users".
* `web/pages/admin-settings/people/add-users/setup-options/index.tsx:106` column label "User".
* `web/pages/admin-settings/people/update-forwarding/index.tsx:279` toast "User updated successfully!"; `:939` fallback name "User".
* `web/pages/admin-settings/people/update-forwarding/basic-information/index.tsx:141,169,178` "this user", "when the user was created", "the user's own account".
* `web/pages/admin-settings/people/add-users/assign-caller-id-modal.tsx:215` "Assigned to User"; `:361` "currently assigned to User".
* `web/pages/admin-settings/roles/assign-users-modal.tsx:208` "Assign Users to Role"; `:232` "Search users..."; `:321` "user(s) selected"; `:71` toast.
* `web/pages/departments/index.tsx:378` "Add New User"; `:455` "Start by adding some users."; `:529` drawer "Add Users"; `users-list/index.tsx:89` "Unknown User", `:111,119` "adding some users" / "Add User"; `user-details.tsx:44` "Member deleted successfully", `:124,133` "adding some users" / "Add User".
* `web/lib/role-permission-defaults.ts:226` tier label "User".

**Member**
* `add-users/index.tsx:106,357`; `user-details.tsx:44`; `department-details.tsx:259,328` "Members" (as a group's member list — NAMING allows `members` as a payload field, not a label).

**Extension meaning a human**
* `add-users/index.tsx:357` "go to Extensions to assign the DID number".
* `web/pages/departments/*` route segment `/department/extension/:id` is the URL for a person's record (`router:509-519`; linked from Directory as "Full record", `people.tsx:506`).
* `user-details.tsx:152` a person with no name shows as "Unknown Contact".

**Lead** — none found in these folders (control: NAMING.md itself and the campaign pages use it).

**Legacy, unrouted files** still carrying "Users › Extension" / "Users › Role", "Add Users",
"Assign Caller Id": `web/pages/admin-settings/people/index.tsx:162,420-424,458,502`,
`web/pages/admin-settings/roles/index.tsx:113,151,261-265,293`.

## E. Logical problems

**Any signed-in person can do administrator things on the server (UI hides, API allows).**
See B.5. The routes `/api/user/add-member`, `/api/user/update/:uuid`, `/api/user/delete/:uuid`,
`/api/user/assign-role-bulk-users`, `/api/user/role/custom/upsert|remove`,
`/api/tenant/user/template/upsert` carry only `auth` (`api/routers/userRoute.ts:37-56`,
`rolesRoute.ts:14-22`, `TenantRouter/tenantUserTemplate.ts:79`). The frontend's
`IS_ADMIN`/`userAccess` gates are the only gates. This is the same fact as the memory note
"rbac is advisory", now with the specific escalation recipes.

**Admin-only for no reason (frontend).**
* Directory People "Edit" needs `isAdmin && userAccess.edit` (`people.tsx:66`) and "Change
  role" needs `isAdmin` (`:114-115`). A custom role holding `account_setting.USER.edit` —
  exactly what the "People admin" preset grants — still cannot edit anyone. Meanwhile
  "Remove" honours the permission **without** `isAdmin` (`:74`): a non-admin People admin
  can delete a colleague but cannot rename them.
* "Activity" button is `isAdmin` only (`:422`).
* The Roles list is `adminOnly` even to read (`router:834-836`); the Directory copy at
  `/directory?view=roles` has **no route guard** at all (`router:479-482`) and only hides the
  buttons (`roles.tsx:96,146`).

**Duplicated screens.**
* People: `/admin-settings/people` and `/directory?view=people` are the same component;
  `/department/extension/:id` (`web/pages/departments`) is a third, older list+detail with
  its own Edit/Delete/Assign Number and a read-only card that labels the location `Site`.
  The dead `admin-settings/people/index.tsx` is a fourth.
* Roles: `/admin-settings/roles` = `/directory?view=roles`; dead `admin-settings/roles/index.tsx`.
* Groups: `/admin-settings/phone/departments` (DirectoryGroups), `/department/organization`,
  and `phone-systems/departments` (under `shared-line`, `router:1160-1168`).

**Dead or misleading buttons.**
* `user-details.tsx:126-134` "Add User" sets `drawerState.addUser`, but that page renders
  only `isEdit` / `isAssignNumber` drawers (`:315-350`) — the button does nothing.
* `users-list/index.tsx:127` empty state on the People tab reads "No Department Found".
* AreaNav step 2 points at `/admin-settings/roles`, which does not render the strip, so the
  four-step tour dead-ends at step 2; steps 1, 3 and the matrix are not in the sidebar.
* Admin scope: a real save whose result nothing reads (screen says "Coming soon").
* Update Forwarding ▸ Call rules: saved, "not applied yet" (honest, `call-rules/index.tsx:218`).
* Directory People "Export N" says "everybody" when unfiltered but the list is capped at
  500 (`people-rows.ts:87`).

**Settings that save but nothing reads.**
* `settings.admin_scopes` (Company Default) — `canActOn` uncalled.
* `role.override` — never written; read has no effect (C.3).
* `apply`/`locked` — never written (C.2).
* `users.settings.role` — written by `assignBulkRoleToUser` (`:2783-2786`) and the drawer;
  read back only for display; the real gate is `users.role`.
* `users.permission` column — third fallback in `rbac.tsx:60-63`, written by nothing in
  these flows.
* Custom role `permission` JSON — read by the browser only (B.2).
* `new_person_default_role` — read only by the Add form's default (fine, but the
  Default-permissions page implies more).

**Behaviour that will surprise an admin.**
* Every save from the person drawer nulls the avatar (A.4).
* Transcription / AI monitoring toggles cannot survive a round trip through the drawer (A.4).
* Deleting a person blanks the full routing of any number that forwarded to them and
  repoints colleagues' forwards at the deleting admin (A.5).
* Creating the Company Default row for any reason locks every governed field on every
  staff member's My Phone page (C.3).
* Deleted people's e-mail addresses are probably not reusable (soft delete + unique index, A.5).
* New people's passwords are e-mailed in plain text (A.3).
* `/api/user/validate` leaks whether an e-mail/phone exists on other tenants (A.3).
* The Groups column on People is partial for non-admin viewers (A.1).
* Three different names for the same role across the People screens (B.4).
* A company role named `ADMIN` or `AGENT` silently changes server behaviour (B.5).

## What I did not do
* No live request was sent; the escalation paths and the avatar/transcription bugs are
  read from source and need a control test on a test tenant before being called confirmed.
* The number-assignment modals (`assign-caller-id-modal`, `individual-assign-number`,
  `multiple-assign-number`) were traced only to their route names; they belong to the
  Numbers audit.
* The switch-side services were read only far enough to answer "does add-person provision
  the extension" (it does not call them; they read `users` directly).
