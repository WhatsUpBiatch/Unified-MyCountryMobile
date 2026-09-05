# notifications-media — voicemail alerts, library delete ownership, the open default

**NOT DEPLOYED.** Source changes only, in `/root/UCAAS/mcm-repos/{default-api,tenant-api}`
(uncommitted working tree) with this folder as the portable copy. Nothing in here
has been built on a box, restarted, or retested against a live call.

Three server-side fixes from the 3 Sep 2026 account-pages audit
(`docs/audit-2026-09-03/appendix-a-account-pages.md`):

| | audit | what |
|---|---|---|
| A | row 22, Notifications (P1) | one column, one flat shape for a person's notification choices; voicemail emails can be sent again |
| B | row 24, Media library delete (P2) | deleting a recording now needs the caller's company AND (admin OR the uploader); uploads keep the type the client chose |
| C | "open default" decision | a rule whose old `override` flag is absent is open, not locked |

Tests: `bash backend-patches/notifications-media/tests/run.sh` (30 pass) and
`bash backend-patches/company-settings/tests/run.sh` (47 pass). No database, no network.

## A. Notifications: one column, one shape

### What was wrong

The Notifications page saved `{ notification_settings: { voicemail: {...}, missed: {...},
sms: {...}, forgot_password: {...} } }` — wrapped one level — and
`AuthController.updateUserSetting` stored that wrapper as-is in `users.notification_settings`.
Three readers then disagreed about where the choices were:

- tenant-api `CallListRepository.sendVoicemail` sent `user.settings.notification_settings`
  to notification-api. default-api's `getSendVoicemailData` copies the column onto
  `settings`, so for a person who had saved the page this was the inner object, and for a
  person who never had it was `undefined`. notification-api's Joi schema
  (`notification-api/src/schema/Notification.ts`) requires `notification_settings` to be an
  object, so the never-saved case was a 400 before the controller ran; and the controller
  (`NotificationController.notificationSend`) reads `notification_settings[type]` and answers
  400 "Notification settings not found for type: voicemail" when the key is missing.
- default-api `SmsController.sendNotification` read `column.notification_settings[type]`
  (the wrapped shape only).
- default-api `UserController.upateNotificationSettings` (`PUT /api/user/update-settings`,
  unused by the website) wrote the FLAT shape — so any row it ever touched was invisible to
  the reader above.

### The decision

`users.notification_settings` is the one column. Its shape is FLAT:

```json
{
  "voicemail":       { "email": true,  "socket": true,  "sms": false, "push": true, "phone": "" },
  "missed":          { "email": false, "socket": true,  "sms": true,  "push": false, "phone": "+1555..." },
  "sms":             { "email": false, "socket": true,  "sms": false, "push": true, "phone": "" },
  "forgot_password": { "email": true,  "socket": false, "sms": true,  "push": false }
}
```

That is exactly what notification-api reads (`notification_settings[type].email|socket|sms|push`).

### What changed

**New, byte-identical in both services** — `src/helpers/notificationSettings.ts`
(no imports; a test checks the copies match):

- `flattenNotificationSettings(raw)` — accepts the flat object, the old wrapper (up to 4
  deep), or either as a JSON string; returns the flat object or `null` when nothing usable.
- `notificationSettingsForSend(raw, type, payload, fallback?)` — the object to send to
  notification-api, with `[type]` guaranteed present. A person who never chose gets every
  channel the payload carries — the rule `SmsController.sendNotification` has always applied
  to an unset event, so someone who never opened the page keeps getting voicemail emails.
- `smsRecipientFor(raw, type, accountPhone)` — the number typed for that event, else the
  account phone.

**default-api**

| file | lines | what |
|---|---|---|
| `src/controllers/AuthController.ts` | import at 10; new branch at 3934-3952 (`updateUserSetting`) | `key === "notification_settings"` is flattened before `User.update`; an older web build's wrapped body is accepted and stored flat; a body with no usable choice is refused with a message |
| `src/controllers/SmsController.ts` | import at 26; 1641-1653 (`sendNotification`); 1776-1779 | `sendNotification` builds the per-type object with `notificationSettingsForSend` instead of poking `column.notification_settings[type]`; the send uses `user.notification_settings` (flat) |

**tenant-api**

| file | lines | what |
|---|---|---|
| `src/repositories/CallListRepository.ts` | import at 9; 3193-3196 (try), 3215-3217 (`storedChoices`), 3295-3297 (sms `to`), 3305-3315 (settings for send), 3326-3332 (per-person catch) | reads `user.notification_settings ?? user.settings` through the helper; one person's failure no longer aborts the whole batch (a `null` is pushed in their slot so default-api's index-based read stays aligned); text alerts go to the per-event phone |
| `src/interfaces/CallListRequest.ts` | 176-181 | `notification_settings?` added to `ISendVoicemailUserData`, comment on `settings` |

The existing hunks in `CallListRepository.ts` (the `transcript_file_url` change, five places)
were kept untouched; `tenant-api.patch` carries only this change on top of them.

**Not touched, on purpose**: `UserController.ts` (another agent's file). Its
`upateNotificationSettings` already writes flat; its `getSendVoicemailData` still copies the
column onto `settings`, which the reader here understands either way; its `info()` still
returns the raw column (see "what the website must do" below).

### What the website must do (not done here)

`src/pages/settings/notification/index.tsx:43` loads the form from
`userInfoData.notification_settings.notification_settings`. Once this API change is live
the column is flat, so that line must read `userInfoData.notification_settings` (and fall
back to the nested key for a row not yet rewritten). Without that change the page opens
with every switch off, and a save would then store every switch off. The page's post at
lines 59-68 may keep the wrapper or drop it; the server accepts both.

### Also seen, not fixed

- `CallListRepository.ts:3284` builds the voicemail link as
  `${MAIN_API_URL}/media/${user.uuid}/recording/${vmfile}` — the media route is
  `/api/media/:uuid/:type/:file` and files are stored under the company uuid, not the
  person's. The email will go out; its link is probably wrong. Separate item.
- `SmsController.ts:2729-2735` (push by domain+extension) builds its own defaults on
  `user.settings` for a user loaded without that column; it never read the column, so it is
  unchanged.

## B. Media library: who may delete

### What was wrong

`DELETE /api/tenant/greeting/delete` (the row) and `DELETE /api/media/delete` (the file)
asked nobody who was calling. Any signed-in person with the plan's delete permission could
remove any recording in the company — the ones queues and IVRs play included — and the file
route did not check that the company uuid in the body was the caller's. Uploads were always
filed as `greeting` (the website hardcodes it on the upload URL; the row create already
honoured the client's type).

### The rule

> The file must belong to the caller's company, AND the caller is an admin OR the person
> who uploaded it. Stock recordings (`is_default`) are never deleted.

Both calls apply it against the same `ivrfiles` row, so the answer is the same whichever
call comes first.

### What changed

**New, byte-identical in both services** — `src/helpers/mediaOwnership.ts`:
`LIBRARY_TYPES` (greeting/prompt/voicemail), `normaliseLibraryType`, `isAdminRole`,
`libraryDeleteDecision(caller, row)`, `fileBelongsToCaller(caller, pathUuid)`.

**tenant-api**

| file | lines | what |
|---|---|---|
| `src/repositories/IvrFilesRepository.ts` | 5, 28-30, 143-159 (`findByFilename`), 166-215 (`deleteGreeting`) | `createGreeting` stores `normaliseLibraryType(type)` (client's choice when it is a library type, else `greeting`); `findByFilename` new; `deleteGreeting` now takes the caller (`{ user_uuid, role }`), loads the row, refuses 403 by the rule, and returns `{ deleted, uuid, filename, type, user_uuid }` instead of a bare count |
| `src/controllers/IvrFilesController.ts` | 6, 118-124, 142-166 | passes the caller from the `X-User-*` headers; new `greetingByFilename` |
| `src/routers/api.ts` | 79-83 | `POST /api/v1/greeting/by-filename` (TenantAuthMiddleware) |
| `src/interfaces/requests/IvrFilesRequest.ts` | 37-45 | `IvrFilesCaller`, `IvrFilesByFilenameRequest` |

**default-api**

| file | lines | what |
|---|---|---|
| `src/controllers/Media/MediaController.ts` | imports 11-17; `deleteFile` 481-575 | 401 without auth; 422 without uuid/type/file_name; 403 unless the uuid is the caller's company (or own uuid); for library types asks tenant-api `greeting/by-filename` and applies `libraryDeleteDecision` (a failed lookup is 503, not a pass); every other type is admin-only |
| `src/controllers/Tenant/TenantController.ts` | `greetingDelete` 1300, file removal 1323-1351 | after tenant-api removes the row, deletes `<company>/greeting/<filename>` (and `<company>/<type>/<filename>` if different) from the bucket, best effort, logged — while the file name is still known |

**Untouched**: `GET /api/media/direct/...` (the known unauthenticated route) and media-api
itself (it has no caller identity; the check belongs in default-api, which does).

### Effect on the website

`greetings-content/index.tsx` deletes the row, then the file. For an admin the second call
is a harmless no-op (S3 delete of a missing key succeeds). For a non-admin uploader the
second call now gets 403 "This file is not in the library" because the row is already gone
and the server took the file down itself; the page already catches and only logs that. The
page can drop its second call once this is live.

## C. The open default

`src/helpers/companyRuleFlags.ts` — four copies kept byte-identical (default-api, tenant-api,
and both under `backend-patches/company-settings/`; the company-settings test checks it):

| stored | apply | locked |
|---|---|---|
| `override: true` | yes | no |
| `override: false` (explicitly stored) | no | yes |
| absent / `undefined` / `null` / non-boolean | no | no |

New-style `apply` / `locked` keys still win. Lines 17-31 (header), 116-132 (`legacyFlags`),
156 (the call). The website's `src/lib/company-rule-flags.ts` made the same change first;
the test "the server reads the legacy flag exactly as the website does" keeps them in step.

`CompanyPolicyLock` and `CompanyPolicyService` needed no code change: a company that never
set a flag now yields no violations from `lockedFieldViolations` and no seeding from
`applyCompanyRules`, so the middleware lets the save through (in both `report` and
`enforce` mode) and a new person gets plain defaults. That is the intended meaning of "the
company never said anything". Tests flipped: `company-rule-flags.test.cjs` ("`{}` locks
everything" → open, plus null/string/`constructor` cases and a "never set a flag locks
nothing" case) and `locked-comparison.test.cjs:285-290`. The `companyRuleFlags.ts` section
inside `company-settings/{default-api,tenant-api}.patch` was regenerated.

## Apply

Source first (this never touches a server):

```bash
bash backend-patches/notifications-media/apply.sh --check   # verify only
bash backend-patches/notifications-media/apply.sh           # copy helpers, apply patches
```

Then build and check: `cd default-api && npx tsc --noEmit -p .`; for tenant-api symlink
default-api's `node_modules` and run `npx tsc --noEmit -p . --types node`, then remove the
symlink. Run both test suites.

### default-api on the box (no `src` there — dist files copied one by one)

Build locally with the service's own build (`npm run build` = `tsc && tsc-alias`; the
alias step is what turns `@/helpers/...` into relative paths — a file copied without it
loads under `tsc --noEmit` and crashes the service on restart). Then copy exactly these:

| dist file | status |
|---|---|
| `dist/helpers/notificationSettings.js` | new |
| `dist/helpers/mediaOwnership.js` | new |
| `dist/helpers/companyRuleFlags.js` | changed (C) |
| `dist/controllers/AuthController.js` | changed (A) |
| `dist/controllers/SmsController.js` | changed (A) |
| `dist/controllers/Media/MediaController.js` | changed (B) |
| `dist/controllers/Tenant/TenantController.js` | changed (B) |

Back each existing one up beside itself (`*.bak-notifications-media-<stamp>`) before
copying, then `pm2 restart default-api`. Stage under `/root/mcm-patches-<date>/` on the box;
direct copies into `/var/www/prod` are blocked. **Warning**: `dist/controllers/UserController.js`
must NOT be copied from a local build while the other agent's role work is in progress there
— the local `UserController.ts` currently does not compile (`custom_role_uuid` typed
`string | null`, line 2780), which is their in-flight change, not this one.

### tenant-api on the box (has `src`; rebuilt there)

Copy the patched `src/` files (or run `apply.sh` against the box's `src`), then the
service's own build and restart. Files that change in its `dist/`: `helpers/notificationSettings.js`,
`helpers/mediaOwnership.js`, `helpers/companyRuleFlags.js`, `repositories/CallListRepository.js`,
`repositories/IvrFilesRepository.js`, `controllers/IvrFilesController.js`, `routers/api.js`
(plus `.d.ts` for the two interface files).

Order: tenant-api first (default-api's new file-delete check calls the new
`greeting/by-filename` route; until tenant-api has it, a non-admin's library delete would
get 503 "Could not check who owns this recording").

## Rollback

`bash backend-patches/notifications-media/rollback.sh` restores the `.bak-notifications-media-*`
copies `apply.sh` made and removes the two new helper files, in a source tree. On a box,
put the backed-up dist files back and restart. Data: rows written flat stay flat; every
reader here (and `SmsController`) understands both shapes, but the OLD `SmsController` and
the OLD tenant-api reader do not understand flat, so a rollback of the code after people
have saved the page returns those people to the "400 not found for type" state. The safe
rollback order is therefore: website first (back to reading the nested key), then the API.

## Retest, once deployed

1. Save the Notifications page as a non-admin; `SELECT notification_settings FROM users
   WHERE uuid=...` shows the flat object with no `notification_settings` key inside it.
2. Leave a voicemail for that extension; the person gets the email (and the socket alert);
   the default-api log shows no "Notification settings not found" line. Control: a person
   whose column is NULL also gets the email (payload-carried channels).
3. As a non-admin, delete a recording another person uploaded: 403 with the reason; the row
   and the file are both still there. As the uploader: both gone. As an admin: both gone.
   A stock recording: 403 for everyone. A `uuid` of another company in the body: 403.
4. A company whose "Company Default" row has no `override`/`apply`/`locked` anywhere: a
   non-admin saves a changed recording setting and the default-api log shows no
   `companyPolicyLock: report mode, would have refused` line.
