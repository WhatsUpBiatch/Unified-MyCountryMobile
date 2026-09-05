# My Account · People · Roles — audit, 3 September 2026

Internal engineering note. Reference products are studied, never named in the product.
Checked against: the code on `main` (byte-identical to the live branch for these folders),
the running API build on the production box, the production database (read-only), the live
call router, and the live screens signed in as an administrator of Sk3Group.

Evidence appendices with file:line for every claim: `docs/audit-2026-09-03/appendix-a-account-pages.md`,
`appendix-b-people-roles.md`, `appendix-c-reference-model.md`. Tracker rows P4–P10 in
`docs/admin-audit-tracker.md`. This note supersedes the My Account and People sections of
`docs/account-users-numbers-review.md` (29 Aug) and `docs/people-and-teams-sheet.md` (31 Aug).

---

## 0. The three things that matter most

**1. The role self-escalation hole is open again.** On 29 August a guard was patched into the
running API: only an admin may change a role, nobody may change their own, only the account
owner may grant owner. It was applied to the compiled file only. On 31 August at 16:17 that
file was rebuilt from source, which never had the guard. The running build (started 2 Sep
13:48) has none of it: `callerMayAssignRoles` 0, `isSelfEdit` 0, in both source and dist.
Today any signed-in person, including a "Call reviewer", can make themselves or any colleague
an account owner with one API call. Recipes in section 4.3. Proven by reading the running
build; not exercised live, because that would mean escalating a production account.

**2. Apart from the outbound caller ID, nothing a person sets in My Account changes a call.**
The live call router evaluates company hours and queue hours, never a person's own hours. It
reads the recording mode from the company's "Company Default" row, never from the person.
Personal greetings, forwarding, display number, transcription and notifications are read by
nothing. Preferences shows six cards with no badge; My Phone is the only honest page.

**3. There is one gate on the server and it is a free-text column.** `users.role` is a
36-character string with no enum. Custom roles copy their *name* into it, so live rows hold
"Custom Sub-Admin", "New role" and eight raw uuids alongside ADMIN/MANAGER/AGENT/SUB-ADMIN.
Every server-side check is a string compare against those four words. A custom role named
ADMIN makes its holders owners; a role named anything else makes them nobody.

---

## 1. How the section is built

### 1.1 Routes and components

| Sidebar | Path | Component | Guard |
|---|---|---|---|
| My Account › Profile | `/admin-settings/account/profile` | `pages/settings/basic-info` | signed in (Submit needs People-admin permission, see 2.1) |
| My Account › Preferences | `…/account/preferences` | `pages/settings/general` — the admin drawer's settings step with `origin: general_settings` | signed in |
| My Account › My Phone | `…/account/phone` | `pages/settings/phone` — the admin drawer's call-rules step | signed in |
| My Account › Notifications | `…/account/notifications` | `pages/settings/notification` | signed in |
| My Account › Greetings | `…/account/greetings` | `pages/settings/greetings` | `settings.action.greeting.view` |
| My Account › Media Files | `…/account/media/{greetings,prompts,voicemail}` | `pages/greetings/greetings-content` | signed in |
| My Account › Security & Privacy | `…/account/security` | `pages/settings/security` | signed in |
| (no entry) Video | `…/account/video` | `pages/settings/video` | `video.IS_SHOW` |
| People › People | `/admin-settings/people` | `pages/directory/people` | `account_setting.access.USER.action.view` |
| People › Roles | `/admin-settings/roles` | `pages/directory/roles` | `adminOnly` |
| (no entry) Access control, Capability matrix, Default permissions, Admin scope | `/admin-settings/{…}` | `pages/admin-settings/roles/*` | `adminOnly` |

Old `/settings/*` and `/admin-settings/users/*` paths redirect. Two files are dead code,
imported nowhere: `admin-settings/people/index.tsx` (615 lines) and `admin-settings/roles/index.tsx`
(373 lines). Both still say "Users › Extension" and "Users › Role". The same People and Roles
components also render at `/directory?view=people|roles`, and `/directory` has no route guard.

### 1.2 Where the data lives

Everything personal is one row in `users` (main DB): `first_name`, `last_name`, `job_title`,
`profile`, `caller_id`, `extension`, `lang`, `timezone`, and four JSON blobs: `settings`,
`notification_settings`, `greetings`, `call_forwarding`. Two write paths:

- `POST /api/update-user-setting {key, value}` — the caller's own row only; validator allows
  `settings | notification_settings | greetings | call_forwarding`; the blob itself is not
  checked. Used by Preferences, Notifications, Greetings, My Phone.
- `POST /api/user/update/:uuid?` — whole-record replace, any target in the company, `auth`
  only. Used by Profile (own row), the avatar presence menu, and the admin's person drawer.
  Three whole-record writers means a stale tab overwrites another screen's save.

Company rules live in the tenant DB, `user_template` row named exactly "Company Default".

**What the running switch reads** (`/opt/fs-xml-api-1.2.5/dialplan_service.py` and
`directory_service.py`, the Python services that actually run; the Go repos would have read
more and do not run): from a person — `extension`, name, `caller_id`, `site_uuid`,
`settings.international_calling`. Zero reads of `call_forwarding`, `device_options`, `dnd`,
`greetings`, `ring_tone`, `voicemail_pin`, `display_number`, `transcription`,
`notification_settings`, `time_format` (controls in the same file: `caller_id` 13,
`holidays` 10, `recording` 30 — all company-level). The directory template hard-codes
`vm-enabled=false`, `vm-password=1234`.

### 1.3 Live facts from production (read-only queries, 3 Sep)

| Fact | Value |
|---|---|
| Companies / live people / soft-deleted people | 22 / 2,067 / 2,014 (2,001 of them one bulk test company) |
| Distinct strings in `users.role` (live rows) | 9 — ADMIN 22, SUB-ADMIN 32, MANAGER 1,993, AGENT 2, "Custom Sub-Admin" 5, "Custom Subadmin" 4, "New role" 1, SUB-ADMIN uuid 7, MANAGER uuid 1 |
| Predefined roles | 4: ADMIN (`display=0`, hidden from the Roles list), MANAGER, SUB-ADMIN, AGENT |
| Custom roles | 6, across 6 companies |
| `users.permission` populated | 0 of 2,067 |
| `users.timezone` populated | 0 of 2,067 (Preferences writes `settings.operational_hours.regional.timezone`) |
| `users.lang` | "en" on all 2,067 |
| `job_title` / photo / `caller_id` filled | 2 / 1 / 18 of 2,067 |
| Sessions (`devices_securities`) | 102 rows, all web, 47 people |
| `users.status` | ACTIVE 2,064, INACTIVE 3, PENDING 0 — no tenant screen ever writes INACTIVE or PENDING |

---

## 2. My Account, screen by screen

**Works** = saved and acted on · **App only** = the browser acts, nothing behind it re-checks ·
**Stored only** = saved, read by nothing · **Missing** = no control exists.

### 2.1 Profile

Live heading "Basic Info"; sidebar says "Profile". Cards: *How calls reach you*, *Identity*
(names, job title, photo), *Workplace* (copy: "Which **site** this **user** belongs to").

| Control | Saved to | Read by | State |
|---|---|---|---|
| First / last name | `users` via `/api/user/update` (full-record write, correctly rebuilt from the loaded record) | directory; caller name on the switch | Works |
| Job title | `users.job_title` | directory | Works — but the column is varchar(30) and the field allows 80, so a long title fails the whole save; used by 2 of 2,067 |
| Photo | Wasabi, URL in `users.profile` | console avatars | Works — until an admin saves the person drawer, which nulls it (3.4) |
| **Submit itself** | — | — | Rendered only with `account_setting.USER.action.edit`, the People-admin permission. **A non-admin cannot change their own name or photo.** |
| Extension, direct number, location | read-only | — | Correct: identity is admin-owned (rule 1) |
| "How calls reach you" panel | — | — | Untruthful in three places: green "covered / All set" claims voicemail coverage the switch never applies; "Direct number" shows the sign-up mobile (`user_info.phone`) while the checklist reads real DIDs; "Your hours run on {timezone}" — the person's timezone drives nothing |
| Pronouns, language, personal E911 address | — | — | Missing (both references have them) |

### 2.2 Preferences

Live heading "General". Subtitle sends people to "Phone System → Preferences", which does not
exist; company rules are under Company → Company Rules. Six cards, no badges (the
"coming soon" flag in the shared editor renders only for `origin === 'queue'`).

| Card | Saved to (`users.settings.…`) | Read by the call router | State |
|---|---|---|---|
| Regional settings | `operational_hours.regional` | no (router uses company/site timezone) | Stored only |
| Business hours, holidays, closed-hours action | `operational_hours` | **no** — router evaluates `company_operational_hours(db)` (line 1708) and queue hours (1750) | Stored only |
| Automatic & on-demand call recording | `recording` | no — router reads `user_template` "Company Default" (1414-1420) | Stored only |
| Automatic transcription | `transcription` | no | Stored only |
| AI call monitoring | `ai_call_monitoring` | no | Stored only |
| Display number | `display_number` | no | Stored only |

Three more problems on the same page:

- **Submit deletes the one key that works.** Save rewrites the whole `settings` column from
  the form's hydration list; `settingsInitialState` has no `international_calling` (control:
  `recording` 4), so an admin's per-person international-calling rule — the single
  person-level key the router reads — is gone after the person's first Submit.
- Hidden cards (Voicemail settings, Role, Group) are still hydrated and saved back;
  `time_format` is saved as 12 with no control.
- The company lock is browser-only: `/api/update-user-setting` never compares against the
  Company Default. And because `override` defaults to false, **creating the Company Default
  row for any reason** (saving Admin scope, Default permissions, a holiday) **locks every
  governed card for every person** until an admin visits Phone rules and turns "Let people
  change this themselves" on, card by card.

Recording is configurable on four screens (personal Preferences, Company Rules, Company
Policies `call_recording.mode`, Company bulk settings). Only Company Rules'
`settings.recording.automatic` is read.

### 2.3 My Phone

The honest screen: "Coming soon — these rules are saved, but calls are not routed by them
yet." Forward All Calls, Incoming Calls ("Saved, not applied yet"), Outgoing Calls. Still:

- "3 devices are switched on" counts device categories with `status: true` in the saved
  rule, not registered phones; ATA and Mobile rows are synthesised whether or not a device
  exists.
- The blanket "not applied" covers Default Caller ID, which **is** applied (dialplan line 1564)
  — the one setting here that works is labelled as if it did not.
- The banner "Voicemail is not saved yet… Press Submit to apply it" is false.
- Submit also posts `status` to `/api/user/update-status`, which writes presence twice
  (`socket_status` and `call_forwarding.status`) and flips the person's queue rows to
  "On Break" when status ≠ online. A phone-settings save changes queue state.
- Saved with no control on the page: `default_fax_id`, `default_text_id`, `ring_out`, `region`.

### 2.4 Notifications

Honest banner: voicemail and missed-call alerts stopped 24 August; SMS never sent. 3 event
types × 4 channels, saved as `{notification_settings:{…}}` **inside** the
`notification_settings` column; `forgot_password` forced on every save. Why they can never be
sent from this shape: the only consumer reads `user.settings.notification_settings` — the
other column — and notification-api rejects the request without it. An unused
`PUT /api/user/update-settings` writes a third, flat shape. Security-alert emails are sent
and have no switch on the page.

### 2.5 Greetings

Four toggles — welcome, hold music, voicemail, ring tone — saved to `users.greetings`. None
of the four is played by anything live. Three spellings of the keys exist (`welcome/hold`
here, `welcome_greeting/on_hold_music` in the admin drawer, `welcome/hold/voicemail` in the
Go struct; no reader of `ring_tone` anywhere). Page copy "the recordings callers hear on your
extension … falls back to the account default" is false.

### 2.6 Media Files

"Audio this account can use for greetings, IVR prompts and voicemail." This is the
**company-wide** library (tenant `greeting` table) under My Account: Add, Edit, Delete, tabs
Greetings / Prompts / Voicemail. Delete has no owner check within the company, so any person
with the plan permission can delete queue or IVR audio; every upload is filed under type
`greeting`. On Sk3Group the four files are system-seeded "Default …" voicemail prompts with
Edit/Delete greyed. A company resource under a personal menu is a placement error (rule 1).

### 2.7 Security & Privacy

| Control | State |
|---|---|
| Change password | Works — but the copy "Everything already signed in stays signed in" is false: the server logs out every device including the current one. A password change also changes the SIP secret the directory serves (the switch uses the bcrypt hash as the SIP password) — not mentioned |
| Sign out my other devices / everywhere | Works; scoped to the caller since 29 Aug |
| Session list | Works; all sessions are web today |
| Two-step sign-in | Missing on screen. The backend already does email OTP with a 30-day trusted-device skip (`AuthController.ts:2095`); the person cannot see or revoke a trusted device |
| Login history / security events | Missing (`company_security_audit_logs` has 550 rows and no screen) |
| Copy: "To sign someone else out, an administrator does that from Users" | No such control exists on People |

### 2.8 Video

Routed, guarded, not in the sidebar. Promises "camera, microphone and how you join meetings";
generates a link only, in a different URL shape from the one the API stores.

Across all seven pages: query keys after save do not match the keys the pages read, so a
saved screen does not refetch what it saved. Hard-coded: US phone default, US regional
fallback, four TTS languages, announcement mp3 uuids.

---

## 3. People

### 3.1 The list

Columns: Person (name, title, email), Role, Groups, Location, Numbers, ACD skills, Presence,
Contact (ten icon actions). Filters: Groups, Location, Presence, search. Header: Groups,
Export N, Invite person. Rows from `POST /api/user/list` with a **hard cap of 500**; Export
says "everybody" at 501+. The Groups column is partial for a non-admin viewer (tenant-api
narrows departments by role string). The Role column prints the stored string (MANAGER)
while the Roles page prints "Account admin" — two vocabularies for one field.

| Action | Endpoint | Server side | Note |
|---|---|---|---|
| Call / message / video | dialer, messenger, meetings | yes | |
| Favourite | none | browser only | localStorage |
| Edit (person drawer) | `POST /api/user/update/:uuid` | yes | `isAdmin` in the UI even when the role holds `USER.edit`; the server checks nothing |
| Change role | `POST /api/user/assign-role-bulk-users` | yes | no caller check |
| Remove / assign caller ID | `/api/did/*` | yes | |
| Remove person | `DELETE /api/user/delete/:uuid` | yes | honours the permission **without** `isAdmin` — a "People admin" can delete a colleague but not rename them |
| Activity | navigates | yes | `isAdmin` only |
| Availability (own row) | `POST /api/user/update-status` | yes | presence + queue state |
| Export N | none | browser CSV | capped at 500 |

Not present anywhere: bulk select, import, invitation token, resend invite, deactivate,
suspend, move to another location, change licence, deleted-people list, restore.

### 3.2 Invite person

Up to 10 rows; random 4-digit extension; live validation via `POST /api/user/validate`; role
defaults from the company's `new_person_default_role`. Server: bcrypt, breached-password
check, licence check with a Stripe top-up, `status: 'ACTIVE'`, one `company_licenses` row
each, then **emails each person their password in plain text**. The duplicate-email check has
no company filter, so `/api/user/validate` is a cross-tenant oracle. No switch-side
provisioning call is made; the switch services read `users` directly and use the bcrypt hash
of the login password as the SIP secret.

### 3.3 Status

`users.status` has PENDING / ACTIVE / INACTIVE / EXPIRED, but every tenant path writes ACTIVE
and nothing tenant-side ever writes INACTIVE or PENDING. "Invited" and "disabled" do not exist
as per-person states. If INACTIVE were set: login refused, every API 403, **but the phone
still registers and rings** — the switch never reads `status`. "Presence" is a different field.

### 3.4 Edit (the person drawer)

- Every save **nulls the avatar**: server `obj.profile = profile ?? null` (present in the
  running build), and the drawer never sends `profile`.
- Transcription and AI-monitoring toggles reopen OFF after any save (flags stripped on save,
  `apply` read on open falls to legacy-false).
- The company lock is not applied here by design; a rule the company "locked" is freely
  editable per person by any admin.
- Company defaults reach a person only the first time an admin opens them in the drawer, or
  when a template is picked. `addMember` never reads the Company Default.

### 3.5 Remove

Soft delete, sessions destroyed, licence freed, assigned numbers unassigned. Then: any number
that *forwarded to* the person loses its **entire** routing, not the one target; colleagues
whose forwarding pointed at the person are repointed **at whoever clicked delete**; the
unique email stays reserved by the soft-deleted row, so re-inviting the address will likely
fail; nothing lists removed people and there is no restore; the directory service does not
filter `deleted_at`, so a deleted extension can still resolve on the switch.

---

## 4. Roles

### 4.1 What the five screens store

| Screen | Writes | Read by |
|---|---|---|
| Roles list | delete custom role | — |
| New / edit / duplicate role | `custom_roles.permission` | **browser only**: sidebar, `ProtectedRoute`, per-screen flags |
| Assign users | `users.role` (= role **name**), `role_uuid`, `custom_role_uuid`, `settings.role` | the server's string compares |
| Default permissions | `new_person_default_role` on Company Default | Invite form default only |
| Admin scope | `settings.admin_scopes` on Company Default | nothing (`canActOn` uncalled; screen says so, sidebar entry hidden) |
| Access control, Capability matrix | nothing | describe only |

The four-step "access is one decision" tour dead-ends at step 2: the Roles page does not
render the step strip, and steps 1, 3 and the matrix are not in the sidebar.

### 4.2 Server-side authorisation, in full

No permission middleware (0 hits; control: 396 routes wrapped in `auth`);
`checkUserPermission` exists and has zero callers. The whole model is string compares on
`users.role`:

- ADMIN vs everyone: plan-renew token; `plan_features_temp`; "an ADMIN cannot be deleted";
  "an ADMIN account may be modified only by itself"; device-session visibility; tenant-api
  "see all departments"; platform "login as".
- AGENT: number list and call history narrowed to own extension.
- MANAGER: department list narrowed to managed departments; **any other string → none**.
- SUB-ADMIN: never checked outside platform "login as".

`users.role` is `STRING(36)`, default "ADMIN", no enum. Custom-role assignment copies the
role's **name** into it. A company role named ADMIN grants owner rights everywhere; "Custom
Sub-Admin" (five live people) is invisible to every check.

### 4.3 The escalation recipes (routes carry `auth` only; none exercised live)

1. `POST /api/user/assign-role-bulk-users {role_uuid: <ADMIN uuid>, users: [me]}` — the uuid
   is public via `GET /api/user/role/predefined/list`. Nothing excludes the ADMIN role or an
   ADMIN target, so the owner can also be demoted.
2. `POST /api/user/update` (no uuid = me) with `{settings: {role: {label: "ADMIN"}}}` → the
   server writes `obj.role = "ADMIN"`; the only guard looks at the target's *current* role.
   Profile uses this endpoint and echoes `settings` back.
3. `POST /api/user/role/custom/upsert` to create a role named ADMIN, then recipe 1.
4. `POST /api/user/add-member` with `role: "ADMIN"` to mint a new owner.
5. `DELETE /api/user/delete/:uuid` and `POST /api/user/update/:uuid` on any non-ADMIN
   colleague; `POST /api/tenant/user/template/upsert` to rewrite the Company Default rule.

The 29 Aug guard closed 1, 2 and 4 and is gone (section 0). The other two dist-only guards
from that week survived because they were ported to source: the own-role edit block
(`callerOwnRoleUuids`, twice in the running Roles controller) and auth on the log routes.

### 4.4 Naming

Four vocabularies for the same roles: stored strings (MANAGER, AGENT) in the Change-role
dialog, Invite form and Assign users; "Account owner / Account admin / People admin / Call
reviewer" on the Roles list only; five presets including "Call flow builder" in New role;
six tiers ("Company Admin … Supervisor, Agent, User") on the three step screens.

One rename is wrong for a contact centre: AGENT is shown as **"Call reviewer — listens to
recordings and reads reports"**. On the server AGENT is the role narrowed to its own numbers
and own calls — exactly an agent. Renaming the one role a contact centre is built on into a
QA role hides it. ADMIN is hidden from the Roles list (`display=0`), so the owner's own role
is not listed.

---

## 5. Does it line up with Company and Company Rules?

The intended shape (`company-rule-flags.ts`) is the reference model: the company sets a
default, may lock it, the person edits inside the envelope. What exists:

| Piece | Status |
|---|---|
| Company Default row, one per tenant | exists; created lazily by whichever screen saves first |
| `override` per rule ("Let people change this themselves") | written by Phone rules / Greetings; default **off** |
| `apply` / `locked` split | reader exists; **no writer** — every record is legacy; "everyone gets it and cannot change it" still unsayable |
| Lock on the person's Preferences | browser only |
| Lock in the admin's person drawer | not applied |
| Company value seeded onto a new person | not by the server; only on first drawer open or template pick |
| Scope (company → location → person) | company only |
| `role.override` in `POLICY_FIELDS` | no writer; read changes nothing — dead |
| Router reads from the company row | 5 keys: hours, holidays, recording mode, ring seconds, international calling |
| Router reads from the person | 1 key: `international_calling` — and Preferences' Submit deletes it |

Three levels are implied — company rule, admin per person, the person. One works (company →
router), one saves (person), and the lock between them is honoured by the browser alone.

---

## 6. Vocabulary drift (NAMING.md rule 4: a label never shows a wire word)

- **Site**: Profile "Workplace" card, Invite error "Site is required", person drawer, old
  person detail page, Groups admin list column.
- **Department**: `pages/departments/*`, Admin scope, Access control, Capability matrix, tier
  "Department Admin"; the People tab's empty state reads "No Department Found".
- **User / Users / Member**: Invite steps ("Add User Info", "Add Users", "Member created
  successfully… go to **Extensions** to assign the DID number"), drawer toast, Assign users
  modal, Security page ("from Users"), old departments pages.
- **Extension as a human**: `/department/extension/:id` is the URL of a person's "Full record".

---

## 7. What the references decide differently, and the rules to place things by

Full text with article citations in appendix C.

1. **Identity above preference.** Email, number, extension, licence, location, role are
   admin-owned; name, photo, title, pronouns, language, timezone, greeting, ring behaviour,
   notifications are person-owned, and one reference states flatly that office admins
   *cannot* change a person's personal profile — only a logged proxy login can. Ours: the
   admin drawer edits everything personal and wipes the photo; the person cannot save their
   own name without an admin permission.
2. **Self and other are two permissions**, even on the same field. Ours: one component, the
   subject implicit in the route, one endpoint for both.
3. **Three admin levers stack — default → allow → lock — most specific scope wins.** Ours:
   one flag doing two jobs, company scope only, lock in the browser only.
4. **Configure > supervise > participate.** A supervisor acts on live calls and people and
   configures nothing. Ours: no supervisor role on the server; star codes go to the carrier.
5. **Scope is a property of the grant, not the role.** Ours: Admin scope saves a shape
   nothing reads.
6. **The availability ladder.** Global DND is the person's alone; per-group Active is the
   group admin's; queue duty is the queue admin's. Ours: one `socket_status` field, and a
   phone-settings save flips queue state.
7. **Buy at company, assign per person.** Ours matches.
8. **Delete is a state with a grace period.** Ours: soft delete already happens; no list, no
   restore, email reserved forever, routing fan-out destroys other numbers' rules.
9. **Carrier and contract truth sit above the top admin.** Ours matches: number and extension
   are read-only on Profile.

---

## 8. What to do, in order

1. **Close the escalation, in source.** Port the 29 Aug rule set into `update`,
   `assignBulkRoleToUser`, `addMember`, plus a caller check on `delete`, `role/custom/*`
   and `tenant/user/template/upsert`. Compare on `role_uuid`, never on the name; stop copying
   the custom role's name into `users.role`. Needs the API deploy go-ahead.
2. **Website fixes that can ship today:** badge the five stored-only cards on Preferences
   (My Phone's pattern); fix the "Preferences" heading and the pointer to Company Rules; add
   `international_calling` to the hydration list so Submit stops deleting it; drop the People
   -admin permission from Profile's Submit; send `profile` from the drawer; read transcription
   and AI monitoring as plain booleans; correct the four false copy lines (voicemail
   "covered", "Everything stays signed in", "administrator does that from Users", Greetings
   fallback); label Default Caller ID as the one thing on My Phone that works.
3. **Move Media Files** to Phone System next to IVR; keep a Greetings entry under My Account
   that opens the library filtered to the person's own files; add an owner check on delete.
4. **One role vocabulary**, decided with the contact-centre model: Account owner / Location
   admin / Group admin / Supervisor / Agent, scope on the grant. Un-hide the owner role; stop
   calling AGENT "Call reviewer".
5. **Notifications**: pick one column and one shape; wire the consumer; then remove the banner.
6. **Make the person's hours and greetings real on the router, or keep saying they are not.**
   Product decision first: do a person's hours apply to direct calls only (both references)
   or also to queue calls (neither)?
7. **People states**: Pending, Active, Suspended (blocks login *and* registration), Removed
   with a 72-hour restore and a reserved-numbers list. Backend.
8. **Security screen**: trusted devices, login events, two-step control.
9. **Fix the delete fan-out**: remove only the one target; never repoint colleagues at the
   deleting admin.
10. Then: vocabulary sweep, the 500 cap, cross-tenant `validate`, plain-text password email,
    pronouns, language, personal E911, query-key refetches.

## 9. What was not verified

- No escalation recipe was run against production. Evidence is the running build's code.
- The avatar wipe, the transcription round-trip and the `international_calling` deletion are
  read from source and the running build, not reproduced on a test tenant.
- The number-assignment modals belong to the Numbers audit and were traced to route names only.
