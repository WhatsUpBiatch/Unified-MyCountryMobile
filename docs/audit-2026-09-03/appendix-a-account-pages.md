# "My Account" audit — the seven personal pages

Audited 3 Sep 2026 against `main` of /root/mycountrymobile-web, the backend source at
/root/UCAAS/mcm-repos, and the code that is actually running on the switch
(/root/mycountrymobile-web/backend-patches/**/running/, see backend-patches/RUNNING-CODE.md).

Paths below are absolute unless they begin with `src/` (= /root/mycountrymobile-web/src/),
`default-api/` (= /root/UCAAS/mcm-repos/default-api/src/), `tenant-api/`,
`notification-api/` (same root), or `running/` (= backend-patches/fs-xml-api/running/).

---

## 0. Branch check: `main` vs `feat/queues-reports`

`git diff main feat/queues-reports --stat -- src/pages/settings src/pages/greetings src/components/common-settings src/lib/company-policy.ts`
prints nothing: **zero differences** in any file this audit covers. The 39 files that do
differ are all queues/reports/dialpad work (`src/pages/reports/**`, `src/pages/performance/**`,
`src/pages/admin-settings/phone-systems/call-queue/**`, `src/pages/phone/console/stage-column.tsx`,
`src/router/index.tsx` +5 lines, backend-patches). So what is described here is what the live
site ships for these pages.

## 0.1 The one fact that shapes everything below

Two switch services decide what a caller experiences, and **both are Python files that live only
on the server** (RUNNING-CODE.md lines 1-30):

- `running/dialplan_service.py` (2007 lines) — routes every inbound and outbound call.
- `running/directory_service.py` (214 lines) — answers FreeSWITCH's "who is extension X".

The Go repositories `fs-xml-api` and `fs-directory-manager` in /root/UCAAS/mcm-repos are a
different implementation and **are not what runs**. Where a Go file would have read a setting,
that is noted as "(Go, not live)"; it is not evidence that the setting works.

What the live switch reads from a person's `users` row:

| Column / key | dialplan_service.py | directory_service.py |
|---|---|---|
| `extension, first_name, last_name, caller_id, company_uuid, site_uuid` | SELECT at 114-121 and 135-142 | SELECT at 121-122 (+ `password`) |
| `settings.international_calling` | 1537-1539 | — |
| `caller_id` (outbound caller ID) | 1564, 1640, 1651 | — (template puts the extension in `caller_id_number`, line 40) |
| `settings.*` anything else | **0** | **0** |
| `greetings` | **0** (`"greetings"` 0 hits) | **0**; template hard-codes `vm-enabled=false`, `vm-password=1234` (31-32) |
| `call_forwarding` | **0** (`call_forwarding`, `forward_calls`, `failure_action`, `device_options`, `closed_hour_action`, `dnd` all 0) | **0**; dial-string is `sofia_contact(*/user@domain)` (25-33) — rings whatever is registered |
| `notification_settings` | 0 | 0 |
| `socket_status` | 0 | 0 |

Controls for the zero rule (same files): `caller_id` 13 hits, `holidays` 10, `recording` 30,
`operational_hours` 5 — all of which resolve to the **company** record
(`company_operational_hours(db_name)` at 1708, `company_recording_policy(db_name)` at 1391
which reads `user_template WHERE name = 'Company Default'` at 1411-1414), never to the person's.

---

## 1. Profile  (`/admin-settings/account/profile`)

Files: `src/pages/settings/basic-info/index.tsx`, `how-calls-reach-you.tsx`,
`call-setup-guide.tsx`, `profile-update-payload.ts`; shared form
`src/pages/admin-settings/people/update-forwarding/basic-information/index.tsx`.
Route: `src/router/index.tsx:715`. Page heading still says **"Basic Info"** (index.tsx:179)
while the sidebar says "Profile" (sidebar/index.tsx:85).

### 1.1 Controls

**Card "How calls reach you"** (how-calls-reach-you.tsx, read-only)
- Extension (`user_info.extension`, 112)
- Direct number (`user_info.phone`, 117-123) — hint "Outside callers reach you on this number"
- Location (`site_detail.name`, 128) — hint "Your hours run on {timezone}" (129) where timezone =
  `settings.operational_hours.regional.timezone.value || site.timezone` (90-91)
- "When someone calls you" banner, green/amber, from `evaluateUser({call_forwarding})` (81-84,
  `src/lib/call-standard.ts`)
- "Callers hear: {voicemail greeting label}" (150-155)

**Card: photo + form** (index.tsx 203-323, BasicInformation)
- Profile photo: upload (cropper) / remove (204-283)
- Identity: First Name, Last Name (required 2-50, index.tsx:23-28), Job Title (maxLength 80,
  basic-information:125-133)
- Workplace: Location select — **disabled** (`isSiteDisabled={true}`, index.tsx:305), Extension
  "Read only"
- Contact: Phone (disabled PhoneInput, country 'us'), Email "Read only"
- Submit — rendered only when `basicInfoAccess?.edit` (index.tsx:308), where
  `basicInfoAccess = plan_features.account_setting.USER.action` (40-42)

**Card "How your calls reach you"** (call-setup-guide.tsx, read-only checklist, pill "All set" /
"N to finish")
1. Your extension
2. Numbers that ring you — from `POST /api/did/user-assigned` (`useGetAssignedDIDNumbers`,
   `src/hooks/common.ts:76-92`)
3. When you do not answer — `call_forwarding.incoming_calls.failure_action` (216-218)
4. What callers hear — `greetings.voicemail` (220-221)

### 1.2 API

| Action | Frontend | HTTP | Backend |
|---|---|---|---|
| Load | `getUserDetails` (index.tsx:52-56; services/api/index.tsx:16-21) | `GET /api/user/info` (routes.tsx:6-8) | `default-api/routers/userRoute.ts:26` → `controllers/UserController.ts:102 info()`; root keys `user_info, call_forwarding, settings, greetings, notification_settings, socket_status, assigned_did, device_token` at 300-321 |
| Save | `userProfileUpdate` (index.tsx:58; api:1218-1226 appends `/uuid`) | `POST /api/user/update/:uuid?` (routes.tsx:665-667) | `userRoute.ts:46` → `UserController.ts:1765 update()`; `User.update(...)` at 1956 |
| Photo URL | `mediaUploadUrl` type `profile` (index.tsx:108-112) | `POST /api/media/upload/url` (routes 200-202) | `routers/mediaRoute.ts:19` → `controllers/Media/MediaController.ts:13` → media-api `upload/url`; then browser `PUT` to the signed URL (index.tsx:117-120) |
| Numbers | `getAssignDidList` | `POST /api/did/user-assigned` (routes 256-258) | `routers/didRoute.ts:103` → `controllers/DID/DidController.ts:1400` (`DIDNumber` where `user_uuid`) |

### 1.3 What is written

`UserController.update` (1772-1830, 1937-1956) writes `users.first_name, last_name, profile
(TEXT), job_title, settings, greetings, caller_id, call_forwarding, role, role_uuid,
custom_role_uuid` (model `default-api/models/User.ts:126,131,146,197,211`). It has **no partial
mode**: `profile` is set to `null` when absent (1793), and the payload builder therefore echoes
the whole record back — `settings`, `greetings`, `call_forwarding`, `caller_id`, `site_uuid`,
role (profile-update-payload.ts:405-429).

### 1.4 Downstream readers

- `first_name/last_name`: read by both live switch services for `caller_id_name`
  (running/dialplan_service.py:114-121; running/directory_service.py:121-122,39). Live.
- `profile`: read by the portal only (`src/components/custom/custom-avatar.tsx:35` builds
  `/api/media/{company}/{type}/{file}`). Switch: 0. Control in same scope: `extension` 21 files
  in the Go tree, `u.extension` in both Python services.
- `job_title`: **0 readers anywhere outside the portal** (mcm-repos grep: fs-xml-api 0,
  lua 0, tenant-api 0, notification-api 0; portal shows it in `src/pages/directory/people-rows.ts`
  and the roster export). Control: `first_name` in the same grep — dozens.
- `site_uuid`: selected by the live dialplan (114-121) but the field is disabled on this page.

### 1.5 Badges and claims — are they true?

- **"When someone calls you" green tick / "Callers are sent to your voicemail" / "All set"**:
  not true. The switch reads no part of `call_forwarding` (§0.1). A person can be shown "All set"
  and still have unanswered calls end in silence; equally the amber "Nothing is set, so callers
  are hung up on" is not what decides it either. The sibling page My Phone already says so
  ("Coming soon — these rules are saved, but calls are not routed by them yet", call-rules/
  index.tsx:247-250); this page says the opposite.
- **"Direct number — Outside callers reach you on this number"** (how-calls-reach-you.tsx:115-123)
  shows `user_info.phone`, the sign-up mobile number — not a DID. The checklist directly beneath
  reads the real assigned numbers (call-setup-guide.tsx:211,235-246). A person with no DID and a
  mobile on file sees "Outside callers reach you on this number" and, three cards down, "No
  outside number points here yet".
- **"Your hours run on {timezone}"**: the live dialplan evaluates the *company's* hours
  (`company_operational_hours(db_name)`, running/dialplan_service.py:1708, 1279-1315). The
  person's timezone drives nothing.
- **"Callers hear: {greeting}" / "Your greeting: …"**: `greetings` is read by nothing live
  (§0.1; directory template `vm-enabled=false`, directory_service.py:31).
- "Read only" pills on Extension/Phone/Email: true.
- "Set when the user was created" (basic-information:169): true.

### 1.6 Logical problems

1. **Submit hidden behind the People-admin permission.** `basicInfoAccess?.edit` is
   `account_setting.USER.action.edit` (index.tsx:40-42, 308) — the same key that gates the
   *People* menu and pages (sidebar/index.tsx:112; router:523, 828;
   `src/lib/role-permission-defaults.ts:455-464` classifies `account_setting`+`user`+write as an
   admin scope). A person whose role lacks People-write sees the form and no Submit: they cannot
   change their own name or photo. `role-permission-defaults.ts:324` says the opposite is the
   intent ("A person's own settings are theirs").
2. **`job_title` column is 30 chars, the field allows 80.** `User.ts:126`
   `job_title: STRING(30)`; `basic-information:131 maxLength={80}`. On DigitalOcean's strict
   `sql_mode` a 31-80 char title makes the whole profile save fail (name, photo included).
3. **Role escalation through this page's endpoint.** `UserController.update:1825-1830` sets
   `users.role` from `body.settings.role.label` with no check on who is asking; the only guard is
   that an *existing* ADMIN target may only be edited by that same admin (1845-1850). The Profile
   payload echoes `settings` back verbatim (profile-update-payload.ts:407,427). Any signed-in
   person can `POST /api/update-user-setting {key:"settings", value:{role:{label:"ADMIN"}}}`
   (allowed by `default-api/validators/AuthValidator.ts:203-215`) and then press Submit on
   Profile — or call `POST /api/user/update` directly — and become ADMIN. `users.role` is the real
   authorization gate in this platform (memory: rbac is advisory). Same endpoint lets any person
   edit any colleague: `/update/:uuid?` scopes only by `company_uuid` (1840-1843).
4. **Whole-record write from a two-field form.** Because the endpoint nulls what it does not
   receive (1793), the page must resend `settings`, `greetings`, `call_forwarding`. Three other
   writers do the same (avatar presence menu `src/components/custom/header/AvatarContent/index.tsx:
   72-91` sends name, job title, caller_id, site, profile and role just to change presence;
   admin editor `people/update-forwarding/index.tsx:409-414`). A stale tab overwrites another
   screen's save.
5. **Location is disabled here and nowhere else self-service**: the person cannot fix their own
   location; the admin editor can (basic-information default `isSiteDisabled=false`).
6. **Two panels answer the same question differently** (see 1.5, Direct number).
7. Phone/Email "managed on the user's own account" (basic-information:178) — this *is* the
   person's own account and they cannot change either here. No page in My Account edits phone or
   email (grep: no writer of `users.email/phone` under `src/pages/settings`).
8. Vocabulary vs `src/pages/directory/NAMING.md`: "Which **site** this **user** belongs to"
   (basic-information:141), "when the **user** was created" (169), "the **user**'s own account"
   (178). Should be Location / Person.
9. Hardcoded: `PhoneInput country={'us'}` (basic-information:188); image validation message
   names jpg/jpeg/png but `accept="image/*"` (index.tsx:78-83, 280).
10. `queryClient.invalidateQueries(['getUsersDetails','getUserDetailsQueryFn'], {exact:true})`
    (index.tsx:65) invalidates a two-element key that no query uses; the page's own key is
    `['getUserDetailsQueryFn']`, so after Submit the screen keeps the pre-save server copy until
    reload (the same pattern is on Preferences 71, Greetings 69, My Phone 64).

### 1.7 Mixed concerns

- Job title, location, extension, DID assignment are admin/provisioning data shown on a
  personal page; only name and photo are personal. The checklist's actions send the person to
  admin screens (`/admin-settings/people`, `/admin-settings/numbers/in-use`, call-setup-guide.tsx:
  232, 246) which a non-admin cannot open.

---

## 2. Preferences  (`/admin-settings/account/preferences`)

File: `src/pages/settings/general/index.tsx` (heading prop default "General", 23); editor
`src/components/common-settings/index.tsx` with `origin='general_settings'`, `IS_ADMIN={false}`,
`isEditable={true}` (general:238-256).

### 2.1 Controls (cards, top to bottom)

- Company-lock banner (common-settings:262-267) when a governed field is locked.
- **Regional Settings** → dialog `regional-dialog/index.tsx`: Country (select), Country Code
  (derived, read-only), Timezone (select). Time Format is commented out (699-720) but still
  saved as `12` (general:160-163).
- **Voicemail Settings** — hidden (`isShowVoicemail` not passed; general:253 is commented). The
  dialog would offer "Shared Voicemail" co-recipients (multi-select of extensions) and
  "Voicemail to text" (voicemail-dialog:908-940). Its data is still hydrated and saved
  (general:196-201).
- **Business Hours** → `BussinessHoursModal`: 24 hours / weekly schedule, "Custom Days"
  (holidays) table (common-settings:585-597), closed-hours action.
- **Automatic & On Demand Call Recording** (only if plan feature
  `advance_call_management.access.RECORDING`, common-settings:421) → dialog
  `automatic-call-recording/index.tsx`: Automatic switch, Recording Direction (All/Incoming/
  Outgoing), On-demand switch, three audio players for announcements.
- **Automatic Transcription** switch and **AI Call Monitoring** switch (only if
  `...TRANSCRIPTION`, 449); one forces the other (466-501).
- **Display Number** → dialog `display-number-dialog/index.tsx`: Incoming number Yes/No,
  Masking (Strip/Replace/Prefix/End/None + value), "If number is blocked or unknown, show my
  number instead" switch.
- **Role** card — hidden (`isShowRole` default false) but `settings.role` and `settings.group`
  are hydrated and saved (general:193-194).
- Submit (disabled while the company rule loads, general:262-268).

### 2.2 API

| | |
|---|---|
| Load | `GET /api/user/info` → root `settings` (general:58-62, 146-215) |
| Save | `POST /api/update-user-setting {key:'settings', value}` (general:119-123; routes.tsx:669-671) → `default-api/routers/authRoute.ts:155-159` → `controllers/AuthController.ts:3919 updateUserSetting()`; `User.update({[key]: value})` 3949-3958 — **replaces the whole `users.settings` JSON column** |
| Company rule | `POST /api/tenant/user/template/list` search "Company Default" (`src/lib/company-defaults.ts:274-286`; routes 205-207) → `routers/TenantRouter/tenantUserTemplate.ts:8` → tenant-api `user_template` |

### 2.3 Downstream readers, key by key (live code only; control = `caller_id` 13 / `holidays` 10 hits in the same file)

| Key | dialplan_service.py | directory_service.py | lua (backend-patches/freeswitch/running) | tenant-api | notification-api |
|---|---|---|---|---|---|
| `operational_hours.regional.*` (person) | 0 — `regional` 1 hit, inside `business_hours_state` applied to the **company** object (1279-1315) | 0 | 0 | 0 | 0 |
| `operational_hours.type/value/holidays/closed_hour_action` (person) | 0 — `closed_hour_action` 0; hours come from `company_operational_hours(db_name)` 1708 and the queue's own record 1748-1755 | 0 | 0 | `DepartmentRepository.ts:354,373`, `IvrRepository.ts:314-316` read a *department's*/*IVR's* settings, not a person's | 0 |
| `recording.*` (person) | 0 — `company_recording_policy` reads `user_template 'Company Default'` `settings.recording.automatic` (1411-1424) | 0 | 0 | 0 | 0 |
| `transcription`, `ai_call_monitoring` | 0 | 0 | 0 | 0 | 0 |
| `display_number.*`, `masking`, `show_number_if_blocked` | 0 | 0 | 0 | 0 | 0 |
| `voicemail_pin.*`, `voicemail_to_text` | 0 | 0 (template `vm-password=1234`, line 32) | 0 | 0 | 0 |
| `time_format` | 0 | 0 | 0 | 0 | 0 |
| `role`, `group` | 0 (but see §1.6-3: `role.label` becomes `users.role` on the next `/api/user/update`) | | | | |
| `international_calling` | **read** 1537-1539 — the only person-level key the switch honours | | | | |

So: of the seven visible cards, **none** changes what a caller or callee experiences. The only
live per-person key in `settings` has **no control on this page** (see 2.5-1).

### 2.4 Badges and claims

- Cards carry **no status flag** on this page. `SettingFlag status="coming-soon"` is rendered
  only when `origin === 'queue'` (common-settings:117, 455, 481, 511). A person sees Recording,
  Transcription, AI Call Monitoring and Display Number as ordinary live settings.
- Subtitle "Company-wide rules live under **Phone System → Preferences**" (general:226-227) and
  the lock banner "An administrator can change them under Phone System → Preferences"
  (common-settings:264-265): no such menu item. The sidebar's only "Preferences" is this page
  (sidebar/index.tsx:86); the company rule lives at Company → **Company Rules**
  (sidebar:51,66; `src/pages/admin-settings/company/company-rules-form.tsx`).
- "Set by your company, so you cannot change it here" (common-settings:89): true on screen only —
  see 2.5-3.
- "24 Hours, all times" / weekday summary: describes stored data only.

### 2.5 Logical problems

1. **Save drops `international_calling`.** The form hydrates a fixed list of keys (general:146-215),
   `settingsInitialState` (`src/pages/admin-settings/constants.ts:119`) has no
   `international_calling`, and Submit writes `watch('settings')` over the whole column
   (general:79-123; AuthController 3949-3958). An admin's per-person international rule (set via
   common-settings `isShowInternationalCalling`, 542-583, on the admin editor) is deleted the
   first time the person presses Submit here — and that is the one key the switch reads.
2. **Company Default keys are wiped too** if they ever land on a person's row (the same overwrite).
3. **The company lock is client-side only.** `updateUserSetting` (3919-3960) does not consult
   `user_template`; a direct POST bypasses every greyed-out card.
4. **Hidden cards still write.** Voicemail settings, role and group are saved from a form the
   person cannot see (general:193-201). `settings.role.label` then feeds `users.role` on the next
   Profile save (§1.6-3).
5. **Recording is configured in four places, and the switch reads a fifth spelling of one of
   them**: this page (`users.settings.recording`), Company Rules
   (`user_template 'Company Default'.settings.recording` — the one `company_recording_policy`
   reads, 1411-1424), Company Policies (`company_policies.call_recording.mode`,
   `company-policies.tsx:101,184-186`), Company bulk settings (`company-bulk-settings.tsx:94-114`),
   and the admin person editor. Only Company Rules is live.
6. **Business hours/holidays exist per person, per company (Company & Locations, Company
   Holidays, Away dates `company-away-dates.tsx:8-17` which writes into
   `settings.operational_hours.holidays`), per number, per department, per queue.** The live
   dialplan evaluates company hours (1708) and queue hours (1748-1755). A person's own hours,
   holidays and closed-hours action are decorative.
7. **`time_format` is saved but there is no control** (regional-dialog 699-720 commented;
   general:160-163 default 12).
8. **Recording dialog is company vocabulary on a personal page**: "record all calls made to a
   particular user or group extension", "Enable your users to record" (automatic-call-recording:
   83-84, 118); announcement players point at hardcoded public files
   (`/recording-announcement.mp3?v=2` 90, `/recording-on-demand-start.mp3` 124, `-stop` 132) and
   the saved `recording_on/recording_Off` filenames are hardcoded UUID.mp3 strings (63, 109-110,
   constants.ts:731-738) that nothing plays.
9. **Regional dialog falls back to the United States** when nothing resolves
   (regional-dialog:509-514 `getCountryByIsoCode('US')`).
10. Vocabulary: voicemail dialog "Select **co recipients** … check your voicemail" (911-912),
    options labelled `Name / ext`; recording dialog "user", "group extension".
11. Duplicate dialogs: `src/pages/admin-settings/templates/user-settings/add-edit-user-settings/
    settings/{voicemail-dialog,display-number-dialog}` are second copies of the same dialogs.
12. `settings.group` is saved but no screen anywhere sets it (grep `settings.group` → general:194
    and role-dialog cancel only).

### 2.6 Mixed concerns

Recording policy, transcription, AI monitoring, display-number masking and the role are
company/compliance decisions; on the reference products they are policy, not preference. Here
they sit on the person's page with no flag, while the genuinely personal keys (timezone, own
hours) are not read by the switch.

---

## 3. My Phone  (`/admin-settings/account/phone`)

Files: `src/pages/settings/phone/index.tsx`, `schema.ts`; editor
`src/pages/admin-settings/people/update-forwarding/call-rules/index.tsx` (+ `device-options.tsx`,
`add-coworker.tsx`), `src/components/custom/forwarding-actions.tsx`.

### 3.1 Controls

- Banner "Voicemail is not saved yet … Press Submit to apply it." (phone:470-479) when
  `incoming_calls.failure_action.type` is empty.
- "When someone calls you now" summary, always amber (call-rules:201-238).
- Note "Coming soon — these rules are saved, but calls are not routed by them yet." (247-250).
- **Forward All Calls** switch ("Checked first") + destination
  (`ForwardingActions` types: Forward to Queue, Send to Voicemail, Play an Announcement,
  Forward to Extension, Forward to External Number, Forward to IVR, Forward to Group, Forward
  to Call Queue, Hangup — forwarding-actions.tsx:31-75; note "Queue" appears twice, 31 and 70).
- **Incoming Calls** ("Saved, not applied yet"): Ring mode (Ring in order / Ring all at once,
  `RING_MODE_OPTIONS`), device table Active / Name (Desktop, Mobile, ATA Device, or a coworker)
  / Ring For (`RINGING_OPTIONS` 30s…), drag to reorder (device-options.tsx), **"If Busy /
  Unanswered / Unreachable"** destination.
- **Outgoing Calls**: Default Caller ID (select of assigned DIDs, call-rules:636-663).
- Hidden/dead: Busy switch (304-327 commented), Add Coworker (570-583 commented),
  Do Not Disturb (read in the summary 196 but no control on this page; the admin drawer has it).
- Submit.

### 3.2 API

| | |
|---|---|
| Load | `GET /api/user/info` → `call_forwarding` (phone:21-25, 234-445) |
| Save | `POST /api/update-user-setting {key:'call_forwarding', value}` (phone:161-164,183) → `AuthController.updateUserSetting:3919`; **side effect** 3933-3946: `users.caller_id = sanitize(outgoing_calls.default_caller_id)`; then whole `users.call_forwarding` replaced 3949-3958 |
| Also on Submit | `POST /api/user/update-status {socket_status}` (phone:182, 219-233; routes 398-400) → `userRoute.ts:79` → `UserController.updateUserStatus:2809`: writes `users.socket_status` and `call_forwarding.status` (2832-2833, 2866-2876) and sets every `QueueAgentModel` row for the person to `On Break/Idle` when status ≠ online (2841-2864) |
| Also on Submit | socket `user-presence-update` broadcast (phone:168-180) |
| Caller-ID options | `POST /api/did/user-assigned` (via CallRules, call-rules:55) |

Written keys: `forward_calls, status, incoming_calls{enabled,type,device_options[],failure_action,
closed_hour_action?}, outgoing_calls{enabled,default_caller_id,default_fax_id,default_text_id,
ring_out,region}` (phone:91-157), merged over the stored record by `mergeCallForwarding`
(`src/lib/call-forwarding-record.ts:48-61`) so `dnd` survives.

### 3.3 Downstream

- `call_forwarding.*`: **0** in running/dialplan_service.py, 0 in running/directory_service.py
  (dial-string is `sofia_contact`, 25-33), 0 in callcenter-queue.lua, 0 in notification-api.
  tenant-api's three `failure_action` hits are the department/IVR forwarding controllers
  (`DepartmentController.ts:31`, `ForwardingActionController.ts:31`, `IvrRepository.ts:350`),
  not the person. (Go, not live: `fs-xml-api/internal/datastore/datastore.go:75-92` parses
  `forward_calls/dnd/incoming_calls/outgoing_calls` and `exten.go:41` honours `dnd`.)
- `users.caller_id` (the side-write): **live** — running/dialplan_service.py:1564
  `caller_id = user.get("caller_id") or get_caller_did(...)` → `effective_caller_id_number` 1640,
  `sip_from_uri` 1651. Also returned to the webphone as `sip_credentials.caller_id`
  (UserController.ts:253-259; `src/context/dialpad-context.tsx:758`).
- `socket_status`: read by socket-presence-api (`AuthRepository.ts:284,321`) for presence, not by
  the live call path (dialplan 0).

### 3.4 Badges and claims

- "Coming soon — these rules are saved, but calls are not routed by them yet" and "Saved, not
  applied yet": **true**, and the only honest statement in My Account about call rules.
- "Voicemail is not saved yet … unanswered and rejected calls are hung up on instead. Press
  Submit to apply it." (phone:470-479): **false in its conclusion** — Submit stores it; nothing
  applies it. It also contradicts the "Coming soon" note 20 lines below.
- The "not applied" banner covers **Outgoing Calls → Default Caller ID** too, which *is* applied
  (3.3). A person reading the banner will not trust the one control that works.
- "Checked first" rank on Forward All Calls: a precedence that does not run.
- Description under the failure action: "if it is unset the switch simply ends the call and the
  caller hears silence" (call-rules:593) — the switch does not read it when set either.

### 3.5 Logical problems

1. **Pressing Submit changes presence and queue state.** `callRules.status` has no control on
   this page (hydrated at 356/443) yet Submit posts it to `update-status`, which flips the
   person's queue agent rows to On Break if the stored status is anything but online
   (UserController 2841-2864) and broadcasts presence. Saving a ring time can log an agent out of
   their queues.
2. **Presence is stored twice** (`users.socket_status` and `call_forwarding.status`, both written
   by `updateUserStatus` 2866-2876) and written by four screens (My Phone, avatar menu
   `AvatarContent:72-91` via `/api/user/update`, `src/hooks/use-presence-control.ts:115-122` via
   `update-user-setting`, admin editor).
3. **Two writers of the same record with different key sets**: this page vs the admin Call Rules
   drawer (`update-forwarding/index.tsx:409`) — documented in call-forwarding-record.ts:1-28; the
   merge mitigates but the admin drawer cannot see `status` and this page cannot see `dnd`.
4. **Saved with no control**: `default_fax_id`, `default_text_id`, `ring_out`, `region`
   (phone:152-155), `status` (107).
5. `closed_hour_action` is only written when the person's own hours are not 24h
   (phone:129-147) — but the switch evaluates *company* hours, so the person's after-hours rule
   is keyed to the wrong clock even in intent.
6. Device list: "ATA Device" (`DEVICE_TYPE_NAME_CONST.pstn`, constants.ts:333-337) is shown for
   every person whether or not an ATA exists; Mobile/Desktop rows are synthesised when absent
   (phone:267-289, 291-319). Nothing checks what is registered.
7. Default Caller ID options are the person's assigned DIDs only; a company/office number cannot
   be chosen even though `apply-caller-id.sh` (backend-patches/fs-xml-api:19-26) describes
   `caller_id.allow_office_or_group_number` and `allow_hidden` — company flags with no personal
   control.
8. Vocabulary: "coworker" (call-rules:72, add-coworker), "Forward to Group" ok, two "Queue"
   entries (forwarding-actions:31,70).
9. Validation asks for ≥ 8 digits on PHONE targets only (schema.ts:518-526); no E.164 check.

### 3.6 Mixed concerns

Default Caller ID (a number-ownership decision) and the failure action for calls to *this
person* are personal; ring strategy for coworkers, ATA devices and the "Region" for outgoing
calls are provisioning. The page is honest that none of it routes, except the one that does.

---

## 4. Notifications  (`/admin-settings/account/notifications`)

Files: `src/pages/settings/notification/index.tsx`, `src/pages/settings/constant.ts`.

### 4.1 Controls

Banner: "Voicemail and missed-call alerts have stopped. They worked until 24 August … Text
message alerts have never been sent." (381-386). Then one card per event (constant.ts:472-501):
**Voicemail Notifications**, **Missed Calls Notifications**, **SMS Notifications** — each with
four switches: Email, Web Alert, SMS (+ `PhoneInput country='us'` and "will be charged once
they are switched on"), Mobile Alert (constant.ts:465-470). SMS-about-SMS is disabled (424).
Badge "You will not be told" when all four are off (404-408). Submit.

### 4.2 API

| | |
|---|---|
| Load | `GET /api/user/info` → root `notification_settings.notification_settings` (293-297, 319) |
| Save | `POST /api/update-user-setting {key:'notification_settings', value:{notification_settings:{voicemail,missed,sms,forgot_password}}}` (334-349) → `AuthController.updateUserSetting:3919` → `users.notification_settings` JSON (User.ts:158) — note the value is **nested one level** |
| Not used | `PUT /api/user/update-settings` (`userRoute.ts:41-45` → `UserController.upateNotificationSettings:1967-2010`) writes a **flat** `{voicemail,missed,sms,forgot_password}` — a second, incompatible writer that no frontend route references (routes.tsx: no match) |

`forgot_password` is forced to `{email:true,sms:true}` on every save (339-344); the person is
never shown it.

### 4.3 Downstream

- `notification-api/controllers/NotificationController.ts:113-160`: takes
  `notification_settings` **from the request body** and reads `notificationSettings[type]`
  (141) — a flat shape. `security_alert` gets built-in defaults (141-148).
- The only voicemail caller: `tenant-api/repositories/CallListRepository.ts:3295` posts
  `notification_settings: user?.settings?.notification_settings` — read from `settings`, not from
  the `notification_settings` column, and from a `users[]` array supplied by the caller of
  `sendVoicemail` (`ReportController.ts:482-485`; loop at 3041-3044). Even if that array carried
  the column, the value is nested (`{notification_settings:{voicemail…}}`), so
  `notificationSettings['voicemail']` is undefined and the API answers 400 "Notification settings
  not found for type" (NotificationController 150-158). The page's choices cannot reach a sender
  by this path.
- `missed`: no producer anywhere (dialplan 0, lua 0; the page's own comment 374-380 says the
  missed-call lua is unwired and syntactically broken).
- `sms`: no producer reads it (sms-api not grepped here; tenant-api 0 for `notification_settings`
  outside 3295).
- `push`/"Mobile Alert": notification-api forwards to FIREBASE (tenant-api 3286-3289 builds
  `device_notification`), same dead path.
- `security_alert` (login alerts) **is** sent (`default-api/helpers/CommonHelper.ts:3178-3210`,
  `AlertController.ts:22`) but there is no switch for it on this page.
- Controls: `notification_settings` — notification-api 2 files, tenant-api 1; `email` in
  notification-api: many.

### 4.4 Badges and claims

- The stopped/never-sent banner: true and precise.
- "You will not be told": true for the wrong reason — they will not be told either way.
- "Sent to your account email address", "Push notification on the mobile app": describe intent.
- "Charged per message": nothing is metered because nothing is sent.

### 4.5 Logical problems

1. Shape mismatch across three writers/readers (nested column vs flat PUT vs flat reader) — 4.2/4.3.
2. `queryClient.invalidateQueries({queryKey:['userInfo']})` (308) — the page's own query key is
   `getUserDetailsForNotification`; nothing refetches after save.
3. A security alert preference exists server-side and is not offered.
4. `constant.ts:460 NOTIFICATION_SETTINGS_BREADCRUM` is dead.
5. No company-level counterpart exists for notification policy (company pages: 0 hits for
   `notification_settings`), so nothing to duplicate — but also no admin can see a person's
   choices.
6. SMS phone defaults to `user_info.phone` (428-433) and each event stores its own `phone`
   (443): three copies of one number.

---

## 5. Greetings  (`/admin-settings/account/greetings`)

Files: `src/pages/settings/greetings/index.tsx`; editor
`src/pages/admin-settings/people/update-forwarding/greetings/index.tsx` →
`src/components/common-greetings/index.tsx` → `src/components/custom/greeting-select.tsx`.
Guard: permission `settings.action.greeting.view` (router:741).

### 5.1 Controls

One card "Media — The audio callers hear on this extension. Anything left unset falls back to the
account default." (greetings/index.tsx:247-250) with four rows, each "Do you want to add
"{X} message" ?" switch + a select of recordings + an upload shortcut (not for ring tone):
Welcome, On hold music (hidden on the Starter plan, common-greetings:37-39), Voicemail, Ring tone.
Submit. Value required when the switch is on (update-forwarding/schema.ts:282-299,389-396).

### 5.2 API

| | |
|---|---|
| Load | `GET /api/user/info` → `greetings` (54-58); hydration accepts both `welcome/hold` and `welcome_greeting/on_hold_music` (109-124) |
| Save | `POST /api/update-user-setting {key:'greetings', value:{welcome,voicemail,ring_tone,hold}}` each `{enabled,label,value}` (76-90) → `users.greetings` (User.ts:197) |
| Options | `POST /api/tenant/greeting/list` (hooks/common.ts:45-49; routes 251-253) — company library, filtered client-side by `type` |

### 5.3 Downstream

- running/dialplan_service.py: `"greetings"` **0**, `ring_tone` 0, `"voicemail"` 0; `welcome`
  2 and `hold` 5 hits are queue media (`queue_audio_actions`, 1813-1820; queue_media.py).
- running/directory_service.py: `vm-enabled=false` (31) — FreeSWITCH's own voicemail is off for
  every person, so a personal voicemail greeting has nowhere to play.
- callcenter-queue.lua: `cc_hold_music`/`cc_ring_tone` (58, 92, 108) are queue variables.
- (Go, not live: `fs-xml-api/.../dialplan.go:194` `Media.Voicemail`, `number.go:48-52`
  `Media.Hold`, struct keys `welcome/hold/voicemail` in `datastore.go:251-260`; **no `ring_tone`
  anywhere**.)
- Control: `hold_music` in the queue lua 6 hits, `caller_id_number` 2.

**None of the four personal greetings is heard by anyone today.**

### 5.4 Badges and claims

- "The recordings callers hear on your extension" (page subtitle 150-151) and "The audio callers
  hear on this extension. Anything left unset falls back to the account default." — neither is
  true; there is no fallback logic in the live dialplan for a person.
- No status flag on the card.

### 5.5 Logical problems

1. **Three spellings of one record.** This page writes `welcome`/`hold`; the admin person editor
   writes `welcome_greeting`/`on_hold_music` (`update-forwarding/index.tsx:391-395`); the Go
   reader expects `welcome`/`hold`; the personal page reads both. A record saved by an admin is
   invisible to any reader that uses the Go keys.
2. Duplicated at company level (Company Rules → Greetings tab, `company-rules-form.tsx:29,205`
   using the *templates* copy of the editor) and in the admin person editor; neither is applied
   to calls.
3. "Ring tone" is offered as something *callers* hear (card text) — a ring tone is what the
   callee hears; no reader exists for it at all.
4. Upload from inside a slot always files the recording under type `greeting` (add-greeting:145-156),
   so a voicemail recorded from the Voicemail slot lands in the Greetings list and is filtered
   out of the Voicemail select (`GreetingNotification` maps voicemail → `voicemailList`,
   update-forwarding/greetings/index.tsx:197-205).
5. `hasHydratedGreetingsRef` (45, 102, 126) means a refetch after save never rehydrates; fine
   for this session, but stale after another tab saves.
6. Vocabulary: "extension" used for the person ("on your extension") — allowed by NAMING.md only
   when it means the number; here it means the person.

---

## 6. Media Files  (`/admin-settings/account/media[/greetings|prompts|voicemail]`)

Files: `src/pages/greetings/greetings-content/index.tsx`, `add-greeting/*`, `edit-greeting/`,
`constant.ts`; also mounted standalone at `/greetings` (`src/pages/greetings/index.tsx`,
`sidebar/index.tsx`). Route: router:745-758.

### 6.1 Controls

Header "Media Files › {Greeting|Prompt|Voicemail|All}", type tabs All / Greetings / Prompts /
Voicemail (74-79), Search, **Add** (only with `plan_features.settings.action.greeting.add`,
279). Table: Name, Size, Type, Duration, Created At, Action = Play / Edit (rename only,
edit-greeting:535-540) / Delete — Edit and Delete need `.edit` / `.delete` (189, 199) and are
disabled on `is_default` rows (197, 207).
Add panel tabs: Choose File (drag/drop, audio only), Record (MediaRecorder), Text to Speech
(Language — 4 hardcoded: Hindi, English US, Spanish, Arabic, text-to-speech.tsx:576-581; Voice
list from API; textarea ≤ 500 chars filtered to the script), then Name and Type (select when on
"All", fixed otherwise).

### 6.2 API

| Action | HTTP | default-api | Then |
|---|---|---|---|
| List | `POST /api/tenant/greeting/list` | `routers/tenantRoute.ts:43` → `controllers/Tenant/TenantController.ts:1016 greetingList` | tenant-api `greeting/listing` → `repositories/IvrFilesRepository.ts:99-120`: `where` = `type` + name search only; table `ivrfiles` in the tenant DB (`models/GreetingModel.ts:76`) |
| Create row | `POST /api/tenant/greeting/create` (add-greeting:176-192) | `tenantRoute.ts:41` → `TenantController.ts:975 createIvrFile` | `IvrFilesRepository.ts:20-28` (`user_uuid` = creator, `type` default `greeting`, `is_default`) |
| Rename | `POST /api/tenant/greeting/update` | `tenantRoute.ts:42` → `updateIvrFile:1730` | tenant-api |
| Delete row | `DELETE /api/tenant/greeting/delete` | `tenantRoute.ts:47` → `greetingDelete:1300` | `IvrFilesRepository.ts:149-153` `destroy where uuid` — no owner check |
| Delete file | `DELETE /api/media/delete` `{uuid:company, type:'greeting', file_name}` (greetings-content:113-119) | `mediaRoute.ts:45` → `MediaController.ts:474 deleteFile` | media-api |
| Upload URL | `POST /api/media/upload/url` `{uuid:company, type:'greeting'}` (add-greeting:152-156) | `mediaRoute.ts:19` → `MediaController.ts:13` (checks plan storage) | media-api signed URL; browser `PUT` |
| TTS | `POST /api/tenant/greeting/upload-v2` (add-greeting:201-209; routes 592-594) | `tenantRoute.ts:45` → `greetingUploadV2:1100` | tenant-api |
| Voices | `POST /api/tenant/greeting/voice-list` | `tenantRoute.ts:44` → `greetingVoiceList:1057` | tenant-api (Azure voices model exists, `models/AzureTtsVoice.ts`) |
| Company language | `fetchCompanyDefaults` → `settings.company_policies.default_language` (text-to-speech.tsx:647-652) | | |

Playback: `${MEDIA_URL}/{company}/greeting/{filename}` or
`/api/media/default/recording/{filename}` for `DEFAULT_RECORDING_UUIDS` (176-178).

### 6.3 Downstream

Files are inert until a slot points at them. Live consumers of the library: queue media
(`running/queue_media.py`, dialplan 1813-1820), IVR prompts (dialplan `ivr` route 1795-1803).
Personal slots (§5) consume nothing. `type` is a label only — every file is stored under
`/greeting/` (add-greeting:145-156 and the comment at greetings-content:107-112).

### 6.4 Badges and claims

- Blurbs "Recordings callers hear when they reach you", "Recordings played when a call goes to
  voicemail" (83-88): only true for queue/IVR use.
- `is_default` lock on edit/delete: true.

### 6.5 Logical problems

1. **This is the company's library, not the person's.** The listing has no `user_uuid` filter
   (IvrFilesRepository 99-120) and delete has no owner check (149-153). Under "My Account" a
   person with the plan permission can rename or delete recordings used by queues and IVRs.
2. Same page is mounted twice (`/greetings` and `/admin-settings/account/media`); the standalone
   sidebar hard-codes `/greetings` (sidebar/index.tsx:412) directly under a comment that says it
   is mounted under two bases (386-389).
3. Type naming drift: sidebar "Prompt" vs tab "Prompts" (sidebar:406 / greetings-content:77);
   header shows singular `capitalizeFirstLetter(type)`.
4. Delete leaves the file when the row delete succeeds and the media delete fails (113-126,
   logged only) — by design, but storage is metered against the plan
   (MediaController 13-60 checks `free_storage`/`extra_storage_space`).
5. Hardcoded languages (4) vs the company default language list which "offers more languages
   than this screen can speak" (text-to-speech.tsx:642-646).
6. Duration is measured in the browser (add-greeting:163-174); a file the browser cannot decode
   is stored with duration 0.
7. Vocabulary: fine ("recording", "greeting"); the standalone area is titled "Greetings" while
   the account entry is "Media Files" — two names for one screen.

### 6.6 Mixed concerns

Entirely a company asset library under a personal heading; the reference products keep the
company audio library under Admin and give a person only their own voicemail greeting.

---

## 7. Security & Privacy  (`/admin-settings/account/security`)

Files: `src/pages/settings/security/index.tsx`, `src/pages/change-password/index.tsx`, `schema.ts`.

### 7.1 Controls

- **Password** card → "Change password" dialog: Old Password, New Password (8+, upper, lower,
  digit, special, no spaces, ≠ old — schema.ts:12-21), Confirm Password.
- **Sign out everywhere** card: "Sign out my other devices", "Sign out everywhere".
- Device list: Search; per row avatar/name/email, User Agent, IP Address, device icon
  (monitor for `W`, tablet for anything else, 380-384), **"Current Device"** badge or **Logout**.

### 7.2 API

| | |
|---|---|
| Devices | `POST /api/user/device-securities {search, filter}` (205-210; routes 1119-1121) → `userRoute.ts:90-94` → `UserController.getDeviceSecurities:3209` — scoped to `company_uuid`, and to own `uuid` unless role ADMIN (3273-3275); attributes 3279-3288; frontend re-filters to own uuid (239-245) |
| Logout | `POST /api/logout {type: single|except_himself|all, device_securities[], user_uuid}` (258-275; routes 1123-1125) → `authRoute.ts:126-131` → `AuthController.logout:1078-1114` (except_himself computes the other sessions by token, 1090-1106) → `logOutUser:3964` (`devices_securities` rows) |
| Password | `POST /api/change-password` (change-password:498; routes 851-853) → `authRoute.ts:136-140` → `AuthController.changePassword:3642`: verifies old (3668), breached-password check (3671-3673), hashes (3674-3683), **then logs out every device including the current one** (3686-3694, `type:"all"`) |

Storage: `devices_securities` (`models/DeviceSecurityModel.ts`: token, device_id, device_token,
device_type A/I/W/D, ip_address, user_agent, version, created_at, updated_at). Password:
`users.password`.

### 7.3 Downstream

- Password: read by the SIP directory (`running/directory_service.py:121-122,30` puts
  `users.password` into the FreeSWITCH directory as the SIP password) — so a password change
  also changes the softphone registration secret. Not mentioned on screen.
- Sessions: `AuthMiddleware.ts` resolves the token to a `devices_securities` row and exposes
  `current_device_uuid` (182), returned as `device_token` by `info()` (UserController 321).

### 7.4 Badges and claims

- **"Everything already signed in stays signed in — use the device list below to end those."**
  (295-297): **false**. `changePassword` calls `logOutUser({type:"all"})` unconditionally
  (3686-3694); the person is signed out of this tab too.
- "Current Device": true (`user.device_token === item.uuid`, both the `devices_securities` uuid).
- "Sign out my other devices" / "Sign out everywhere": true.
- Subtitle "Your password, and every device currently signed in as you": true, with the caveat
  that no sign-in *time* is shown although `created_at/updated_at` are stored.
- "To sign someone else out, an administrator does that from **Users**" (308-309): wire word;
  not verified that such an admin action exists.

### 7.5 Logical problems

1. Password-change copy contradicts the server (7.4).
2. No MFA / trusted-device / login-alert controls. The platform has a 30-day trusted-device OTP
   skip and a master OTP in production (memory), and sends `security_alert` notifications
   (CommonHelper 3178-3210), yet this page offers no way to see trusted devices, revoke them, or
   choose alert channels. The company page carries MFA "Coming soon", idle timeout "In this app
   only", SSO "Coming soon" (`company-security.tsx:708-1019`).
3. `selectedUserExtension` filter state (194, 205-209) is dead — never set to a value — and
   would send `{key:'extension', value:[array]}` which the backend turns into `LIKE '%…%'` on an
   array (3260-3264).
4. Device rows show no timestamp and no "last active"; `version` is fetched and not shown.
5. Old password has no complexity check (schema commented 4-10) — correct, but the 8+ rule for the
   new one is not shown until it fails.
6. Change-password dialog `w-1/4` fixed width (change-password:519).
7. Vocabulary: "Users" (308), "Logout" button vs "Sign out" cards.

---

## 8. Video  (`/admin-settings/account/video`, routed, not in the sidebar)

`src/pages/settings/video/index.tsx`; guard `video.IS_SHOW` + `video.action.view` (router:723-733).
Controls: "Personal meeting" — link display + copy, or "The private meeting link has not been
generated yet" + **Generate**.
API: `POST /api/v1/meeting/permanent-link` and `POST /api/v1/meeting/generate-private-link`
(routes 673-679) → `routers/smsV1Route.ts:149-158` → `controllers/VideoController.ts:748/708` →
video-api `MeetingController.ts:590/566`, stored on `MeetingModel.privateLink`
(video-api/src/models/MeetingModel.ts:62; repository 2867 builds `${MAIN_API_URL}/meeting/{uuid}`).
Problems: subtitle "Your camera, microphone and how you join meetings" (462-463) — there are no
such controls; the page builds `${origin}/video-meet?meetCode=` while the API stores a different
URL shape; unreachable from navigation.

---

## 9. Cross-cutting findings

1. **Nothing on the personal pages reaches a caller except Default Caller ID.** Of every key the
   seven pages write (`settings.*` except `international_calling`, `greetings.*`,
   `call_forwarding.*`, `notification_settings.*`, `profile`, `job_title`), the live switch reads
   only `users.caller_id` (written as a side effect of My Phone) and `first/last_name`. The pages
   flag this honestly only on My Phone and Notifications; Profile, Preferences and Greetings
   present the same data as live.
2. **Whole-column and whole-row writes everywhere.** `/api/update-user-setting` replaces a JSON
   column; `/api/user/update` replaces the row. Each page rehydrates a fixed key list, so any key
   another screen or an admin wrote is deleted on the next Submit — concretely
   `settings.international_calling` (the one live key) on Preferences.
3. **Self-service role escalation** via `/api/user/update` (§1.6-3). Highest-priority finding.
4. **Company locks are decorative server-side**; `updateUserSetting` has no policy check.
5. **The same setting lives in up to five places** (recording; hours/holidays; greetings; presence),
   with the switch reading a company-level record for the first two and nothing for the third.
6. **Label pointing at a menu that does not exist** ("Phone System → Preferences", two places).
7. **NAMING.md drift on personal pages**: site (basic-information:141), user (141, 169, 178,
   automatic-call-recording:83, 118), Users (security:308), co recipients (voicemail-dialog:911),
   coworker (call-rules).
8. **Hardcoded**: US phone default (2 places), US regional fallback, 4 TTS languages, recording
   announcement filenames and UUID `.mp3` names, ring-time options, `forgot_password` channels,
   `time_format=12`, `vm-password=1234` on the switch.
9. **Query-key mismatches** after save on Profile (65), Preferences (71), Greetings (69),
   My Phone (64), Notifications (308) — the screens do not refetch what they just saved.
10. **Media Files and (in effect) Greetings are company-level surfaces** under a personal heading;
    Profile's Location/Extension/Numbers and Preferences' Recording/Transcription/Display-number
    are admin/policy surfaces under a personal heading; the genuinely personal items (own voicemail
    greeting, own fallback, own timezone, own alerts) are the ones that do not work.
