# Trusted devices, two-step status, pronouns and interface language

Fix-sheet rows 5 and 12 (3 Sep 2026). Built in source, compiled, type-checked
and unit-tested. **Not deployed, not committed.** Nothing here has run on a
server.

## What and why

### Row 5: two-step sign-in status and trusted devices (Security & Privacy)

The platform has had a 30-day "skip the code on this device" since 1 Sep,
and the Security & Privacy page had no way to see which devices could skip
it or to take that back. The audit (appendix A §7.5-2) called it out.

**What a trusted device is on this platform.** `AuthController.sendOtp`
skips the emailed code when the `otp` table holds a row for this email +
`device_id` with `verified = 1` and `created_at` inside `TRUSTED_DEVICE_DAYS`
(default 30), and the person ticked "remember this device". `/login` reads
the same kind of row before handing out a token. So trust lives in `otp`,
keyed by `device_id`; sessions live in `devices_securities`, also keyed by
`device_id`. A device can be signed in and not trusted, or trusted and signed
out. The list endpoint folds both into one row per device.

**Revoke** deletes the `otp` rows for that email + device_id - the exact rows
both readers look at - so the next sign-in from that device asks for a code
again. For any device other than the one pressing the button it also ends
the session (`devices_securities` rows for that device_id). The current
session is never ended by a revoke: the person is using it.

**Two-step status.** There is no per-company or per-person switch for the
second factor anywhere in AuthController; a code is always required unless
the device is trusted. The endpoint says so as `{ enforced: true, method:
"email_code", trust_days, reason }` and the card shows **Active** with that
one-line reason. If a switch is ever added, `describeTwoStep` in
`services/trustedDeviceLogic.ts` is the one place to change.

New endpoints (own rows only; user and email come from `req.auth`, never
from the body):

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/security/devices/list` | `{}` | `{ two_step, current_session_uuid, devices[] }` - each device: `id, device_id, session_uuid, label, device_type, ip_address, user_agent, app_version, first_seen, last_seen, signed_in, trusted, trusted_since, trusted_until, is_current` |
| POST | `/api/security/devices/revoke` | `{ id }` (a `device_id`, or `session:<uuid>` for an old id-less session) | `{ id, trust_removed, sessions_ended }` |
| POST | `/api/security/devices/revoke-all` | `{}` | `{ trust_removed, sessions_ended }` - every other session ended, all trust forgotten |

Website (`src/pages/settings/security/`): two cards above "Sign out
everywhere". "Two-step sign-in" shows Active / Off and the reason.
"Trusted devices" lists rows with **This device** (matched on the browser's
`ucaas-device-id` from localStorage, the session uuid the API returns as
`device_token`, or the server's `is_current`), Trusted / Not trusted /
Signed out pills, IP, browser, first and last seen, trusted-until, a
**Revoke** per row and **Sign out of all other devices**. While loading it
says "Checking…"; then the list, "No trusted devices", or - on a server
without the endpoint (a 404) - a Coming soon note pointing at the sessions
list below. Zero rows are never shown before the server has answered.

### Row 12: pronouns and interface language (Profile)

Two new columns, `users.pronouns VARCHAR(40) NULL` and
`users.interface_language VARCHAR(10) NULL`, and an endpoint that lets a
person change **only** their own `first_name, last_name, job_title (30),
pronouns, interface_language`. No role, no email, no uuid in the body or
path; compare `/api/user/update`, which takes a whole record and a role.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/profile/self` | `{}` | the five fields as stored (+ `uuid`) |
| POST | `/api/profile/update-self` | any of the five | the five fields after the save, plus `saved: [...]` naming what was written |

Rules (`services/profileSelfLogic.ts`): names 2-50, job title ≤ 30,
pronouns ≤ 40, language a tag like `en` / `en-US` (≤ 10). Only the keys sent
are written, so a partial save is partial. Whitespace is collapsed. An empty
optional field clears it.

**The columns are deliberately not on the User model.** If they were,
Sequelize would SELECT them in every `User.findOne` with no attributes list,
and a build that reached a server before the migration would break login.
Only `ProfileSelfService` reads them, with raw SQL, after a first-use guard
has made sure they exist (it runs `describeTable('users')` once per process
and ADDs whichever is missing; a failure is not cached, so the next request
tries again; if a column still cannot be found the request fails with a
clear message rather than dropping two fields silently).

Website (`src/pages/settings/basic-info/`): a new **About you** section on
the Profile form with Pronouns (free text, 40, placeholder "e.g. she/her,
he/him, they/them") and Interface language. The console has no translation
layer (no i18next / react-intl / lingui anywhere in `src`), so the only
language offered is English, the field wears **Coming soon**, and the note
says the choice is saved for when more languages are ready. Save goes to
`update-self` when the server has it; a changed photo still goes through the
old whole-record write because the photo is not one of the five. On a
server without the endpoint (first call 404s, remembered for the session,
same pattern as `src/lib/company-defaults.ts`) the old write carries name
and title as before, the two new fields are locked with a note, and a save
that had pronouns or a language in it says they were not saved.

## Files

### default-api (source, under `/root/UCAAS/mcm-repos/default-api`)

New:
- `src/controllers/TrustedDeviceController.ts`
- `src/controllers/ProfileSelfController.ts`
- `src/routers/trustedDeviceRoute.ts`
- `src/routers/profileSelfRoute.ts`
- `src/services/TrustedDeviceService.ts` (database) and `src/services/trustedDeviceLogic.ts` (pure)
- `src/services/ProfileSelfService.ts` (database + column guard) and `src/services/profileSelfLogic.ts` (pure)
- `migrations/20260903151500-add-users-pronouns-interface-language.js`

Edited: `src/app.ts` - two imports and two `app.use` lines next to
`siteRoute` (`/api/security/devices`, `/api/profile`). `patch_app_routes.py`
makes exactly that edit on either `src/app.ts` or `dist/app.js`.

Copies of all new source files are in `default-api/` here, and
`default-api.patch` is the same as a unified diff (new files only; app.ts is
the script's job because the shared working tree carries other changes).

### Exact dist files to copy (compiled by `tsc` + `tsc-alias`, no `@/` left)

```
dist/controllers/TrustedDeviceController.js
dist/controllers/ProfileSelfController.js
dist/routers/trustedDeviceRoute.js
dist/routers/profileSelfRoute.js
dist/services/TrustedDeviceService.js
dist/services/trustedDeviceLogic.js
dist/services/ProfileSelfService.js
dist/services/profileSelfLogic.js
```

plus `python3 patch_app_routes.py <install>/dist/app.js`. `apply.sh` does
all of it, refuses to overwrite a file that already exists, checks for a
leftover `@/` require, copies and runs the migration, and restarts with pm2.

### Migration

`20260903151500-add-users-pronouns-interface-language.js`: adds each column
only if `users` lacks it; safe to run twice. `down` drops only the columns
it finds. Run with `npx sequelize-cli db:migrate` in the install directory
(needs ALTER on `users`). If it is not run, the endpoint's guard does the
ALTER on first use and logs `[profile-self] added users.<col>`.

### Website (`/root/mycountrymobile-web`)

New: `src/pages/settings/security/trusted-devices-logic.ts`,
`trusted-devices-api.ts`, `trusted-devices.tsx`;
`src/pages/settings/basic-info/interface-languages.ts`, `profile-self-api.ts`.
Edited: `src/pages/settings/security/index.tsx` (mounts the cards),
`src/pages/settings/basic-info/profile-form.tsx` (About you section),
`src/pages/settings/basic-info/index.tsx` (schema, self-profile read, the
two-path save). `web/web.patch` is the unified diff. The website was NOT
built.

## Rollback

`bash rollback.sh <install>`: restores `dist/app.js` from the backup
`patch_app_routes.py` made, deletes the eight files, restarts. The columns
stay (nothing else reads them and dropping them loses what people typed);
`npx sequelize-cli db:migrate:undo --name 20260903151500-add-users-pronouns-interface-language.js`
drops them if wanted. On the website, revert the three edited files and
delete the five new ones; the Profile page and Security page then behave as
before.

## Gates, as run on 3 Sep 2026

- default-api `npx tsc --noEmit -p .`: exit 0 (a run mid-way showed three
  errors from another agent's in-flight `personStateRoute` / `SUSPENDED`
  work, none in these files; clean on the re-run).
- website `npx tsc --noEmit -p tsconfig.app.json`: exit 0.
- website `npx eslint src/pages/settings/security src/pages/settings/basic-info`: exit 0.
- `bash tests/run.sh`: 29 tests, 29 pass (device merging, revoke id grammar,
  two-step wording, the five-field rules, the migration's add/skip/drop with
  a fake queryInterface, this-device matching, row wording, the language list).

## Things to know before deploying

1. **The login path may be deleting the rows trust depends on.** In source,
   `AuthController.login` (around lines 688-719) destroys every `otp` row for
   the email + device_id right after it finds a verified one and issues a
   token - and `/send-otp` is called by the sign-in page *after* `/login`.
   Read literally, a trusted device would work once and then be forgotten.
   The 1 Sep note says the skip works in production, so either the live dist
   differs from this source at that spot or the flow is not what it looks
   like. Not changed here (AuthController is off-limits) and not verifiable
   without a live sign-in. Whatever the truth, `revoke` is correct: it deletes
   the rows both readers consult.
2. **`revoke-all` deletes unverified `otp` rows too** (all rows for the
   email). A code in flight for a sign-in happening right now is
   invalidated; that is the intended meaning of "sign out of all other
   devices".
3. Two other migrations in the working tree use the `20260903150000`
   prefix; this one is `20260903151500` so ordering is unambiguous.
4. The Security page still has the older sessions list further down, from
   `/api/user/device-securities`. The new card explains the difference
   (signed in vs allowed to skip the code) rather than replacing it.
