# Invites: new people get a link and choose their own password

**NOT DEPLOYED.** Source changes sit in `/root/UCAAS/mcm-repos/default-api`
(uncommitted working-tree edits, on top of the same day's company-settings,
people-roles and person-state work - never revert those) and in the website
tree `/root/mycountrymobile-web` (uncommitted). This folder is the portable
copy: the two patches, the new files, the built `dist/` files, the migration,
the scripts and the unit tests. Audit row 3 of
`docs/audit-2026-09-03/my-account-people-roles-fix-sheet.xlsx`; the evidence is
`docs/audit-2026-09-03/appendix-b-people-roles.md` A.3.

## What was wrong, in plain words

When an administrator added a person, the server made up a password (or took
the one the administrator typed) and **e-mailed it in plain text**
(`UserController.addMember`, the `ADD_MEMBER_NOTIFICATION` template, which
prints `Password: {{password}}`). Anyone who could read that mailbox - now or
years later - could log in as that person. There was no invite, no expiry, no
way to send it again, and the reply to the browser carried every new row
**including the bcrypt hash**.

## What it does now

1. Adding a person creates the row exactly as before, but with a random
   throw-away password nobody ever sees, and `status = PENDING`. Login refuses
   anything but `ACTIVE`, so the row cannot be used yet.
2. The person gets an e-mail with a link:
   `https://<the company's website>/accept-invite?token=<64 hex>`. The e-mail
   carries their name, who added them, the company and the link. **No
   password, no e-mail address, no extension.** The link works for **72 hours**.
3. The link opens a public page. It shows their name and e-mail and asks for a
   password twice: **12 or more characters, not their e-mail address**. On
   success the password is stored with the same bcrypt hashing the login and
   forgot-password paths use, `status` becomes `ACTIVE`, the link is marked
   used, and the page sends them to the login screen.
4. The People list shows "Invite sent, not accepted yet" (or "Invite link
   expired") under such a person and offers **Resend invite** (administrators
   only, one per person per minute). Resending makes a new link; older links
   for that person stop working.

If the administrator still types a password ("Set one password for everyone
now" / "Set a password for each person now"), the row is `ACTIVE` and that
password works as before - and the person **also** gets the invite link, so
they can choose their own. Nothing on any path e-mails a password any more.

The invite link is now the **default** choice on the Add people screen.

## The endpoints

All under `/api/invite`, all POST, mounted from `app.ts` next to `/api/user`.
Reply envelope is the usual `{ success, data: { message, result } }` /
`{ success: false, message }`.

| endpoint | body | who | reply |
|---|---|---|---|
| `/api/invite/inspect` | `{ token }` | public, same per-IP limiter as `/login` | `result: { ok, state: ok\|invalid\|expired\|accepted, expired, name?, email?, min_password_length: 12, ttl_hours: 72 }` - always 200 |
| `/api/invite/accept` | `{ token, password }` | public, same limiter | 200 `result: { ok: true, email, name }`; 422 bad password (message says why); 410 expired; 404 invalid or already used |
| `/api/invite/resend` | `{ user_uuid }` | signed in + `RequireAdminRole` (people-roles), own company only | 200 `result: { ok, email, expires_at }`; 404 not in your company; 409 already accepted / has a password; 429 within the minute |
| `/api/invite/pending` | `{}` | signed in + `RequireAdminRole` | `result: { pending: [ { user_uuid, email, first_name, last_name, sent_at, expires_at, expired } ], ttl_hours }` |

`accept` does **not** sign the person in. Login lives in `AuthController`
behind Turnstile, an OTP by e-mail and device sessions; copying that into the
invite controller would mean touching the one file this change must not touch
(see "Why the AuthController is untouched"). The page redirects to `/`
(login) with a success toast and the e-mail pre-filled in router state.

## What is stored

Table `user_invites`, main database, next to `users`:

```
id INT UNSIGNED PK, user_uuid VARCHAR(36), company_uuid VARCHAR(36),
token_hash CHAR(64) UNIQUE, expires_at DATETIME, accepted_at DATETIME NULL,
created_by VARCHAR(36) NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
KEY (user_uuid, created_at), KEY (company_uuid, accepted_at)
```

`token_hash` is `sha256(token)`; the 32-byte random token exists only in the
e-mail. A copy of the table cannot be turned into a working link. The table is
created on first use (`UserInviteService.ensureTable`, `CREATE TABLE IF NOT
EXISTS`, once per process) **and** by
`migrations/20260903150000-create-user-invites-table.js` (idempotent), so a box
that never runs migrations still works. The two definitions are identical.

## What changes, file by file

### default-api source

| file | what |
|---|---|
| `src/helpers/inviteToken.ts` | **new**, pure: token + sha256, 72 h expiry, the 12-char/not-e-mail password rule, the throw-away password, the link, the resend cooldown |
| `src/helpers/inviteEmail.ts` | **new**, pure: the e-mail HTML and subject (no template needed - see below) |
| `src/models/UserInvite.ts` | **new**: the `user_invites` model |
| `src/services/UserInviteService.ts` | **new**: ensureTable, createInvite, sendInviteEmail, inspect, accept, resend, pendingForCompany |
| `src/controllers/InviteController.ts` | **new**: the four endpoints |
| `src/routers/inviteRoute.ts` | **new**: `/inspect` `/accept` (RateLimit), `/resend` `/pending` (auth + RequireAdminRole) |
| `migrations/20260903150000-create-user-invites-table.js` | **new** |
| `src/app.ts` | **edited**, 2 lines: `import inviteRoute from "./routers/inviteRoute";` after the IdentityRoute import, and `app.use("/api/invite", inviteRoute);` right after `app.use("/api/user", userRoute);`. Not in the `.patch` (other same-day work mounts routers at the same spot, so a context diff would not fit); `apply.sh` inserts the two lines by anchor |
| `src/controllers/UserController.ts` | **edited**, `addMember` only: throw-away password instead of `generatePassword()`, `status: PENDING` when no password was typed, the invite loop in place of the `ADD_MEMBER_NOTIFICATION` loop, the bcrypt hash stripped from `createdUsers` in the reply, a reply message that says what happened to the e-mails |

`generatePassword` from `helpers/authHelper.ts` (Math.random) is no longer
imported there; `randomTemporaryPassword` uses `crypto.randomBytes`.

### website

| file | what |
|---|---|
| `src/pages/login/accept-invite/index.tsx` | **new**: the public page (loading / form / invalid / expired / already used / could-not-check states) |
| `src/router/index.tsx` | `accept-invite` added to the public children next to `reset-password` |
| `src/services/api/routes.tsx`, `src/services/api/index.tsx` | `INVITE_*` routes; `inspectInvite`, `acceptInvite`, `resendInvite`, `pendingInvites` |
| `src/pages/admin-settings/people/add-users/setup-options/index.tsx` | the three choices reworded, invite link first; "Send via Email" gone |
| `src/pages/admin-settings/people/add-users/index.tsx` | default choice `email`; fallback toast "People added. We sent them a link to choose a password. It works for 3 days."; invalidates the pending list |
| `src/pages/admin-settings/constants.ts` | `password_type` default `email` |
| `src/interfaces/extension-interface.ts` | `password_type` type gains `'email'` |
| `src/pages/admin-settings/people/index.tsx` | pending-invite query, badge under the name, **Resend invite** action |

No competitor name appears anywhere in the UI text or comments.

### The dist files this produces (what actually goes to the box)

Production default-api has **no `src/`** (see `../company-settings/README.md`):
it is deployed by copying built files one by one. `dist/` here was built from
the working tree with `tsc` + `tsc-alias` into a scratch dir; zero `require("@/…")`
left in the seven files (checked).

| dist file | new / replaces |
|---|---|
| `dist/helpers/inviteToken.js` | new |
| `dist/helpers/inviteEmail.js` | new |
| `dist/models/UserInvite.js` | new |
| `dist/services/UserInviteService.js` | new |
| `dist/controllers/InviteController.js` | new |
| `dist/routers/inviteRoute.js` | new |
| `dist/controllers/UserController.js` | replaces |

**`dist/app.js` is deliberately NOT shipped.** The live `app.js` may carry
hand-made fixes (the rate-limit allow-list was the third such find), and the
build here also contains the same-day person-state router from the shared
working tree, which the box does not have. Instead `apply-dist-app.sh` inserts
the two lines next to the existing `userRoute` lines of the live file, backs
it up first, and refuses if its anchors are missing. Checked: on a copy of the
built `app.js` with the two lines removed, the script puts back exactly the
built `app.use` line and the require.

**Caution:** `dist/controllers/UserController.js` was built from the shared
working tree, so it also requires `services/CompanyPolicyService` (live on
mcm-new since 3 Sep), and `services/RoleResolverService`,
`services/DeletedUserService`, `helpers/roleGuard`, `helpers/removalRouting`
(the **people-roles** bundle, not yet deployed). Copy the people-roles bundle's
new files first, or this file fails at `require` on start. It does **not**
require anything from the person-state work.

## Why the AuthController is untouched

The live `dist/controllers/AuthController.js` on mcm-new carries patches this
mirror does not have (master-OTP allow-list, IP allow-list). Replacing it
would silently drop them. So: nothing here edits `AuthController.ts`, no route
was added to `authRoute.ts`, and `accept` returns `{ ok: true }` instead of the
login payload.

## The e-mail, and why it is not a template

notification-api renders named templates (`ADD_MEMBER_NOTIFICATION` →
`src/templates/ucaas/addMemberNotification.html`) from its own folder, and
there is no invite template there. Adding one means a notification-api
deploy. So the invite goes through the **same mailer as forgot-password**
(`SmsController.sendNotification` → notification-api `notification/send`) with
`template: false` and the HTML from `helpers/inviteEmail.ts` as the body -
which notification-api sends as-is for both SMTP and SendGrid. The base URL
is `CommonHelper.getWebsiteUrl(company_uuid)`, exactly the one the reset link
uses, so the link lands on the same portal the company logs in on.

**No new environment variable is needed.** (`FRONTEND_URL` is not a thing in
this codebase - the website URL comes from the company's `website_settings`
row.)

A branded template (`userInviteNotification.html`) can replace the body later
without touching this code beyond `template: true, body:
"USER_INVITE_NOTIFICATION"` in `UserInviteService.sendInviteEmail`.

`notification_settings` is honoured the same way as any other type: the
person has no preference for `user_invite`, so the rule "an event the person
never chose gets every channel the payload carries" sends the e-mail.

## Note on the SIP secret

`sip-user-data-api` hands `users.password` - the bcrypt hash of the login
password - to the switch as the SIP secret (appendix A.3). Accepting an
invite rewrites that hash, so the person's SIP secret changes at that moment.
That is fine for a new person (no phone registered yet). For someone who was
given a typed password, already logged into a softphone, and then used the
link: the softphone re-registers with the new secret at its next login (login
returns `sip_credentials.password` = the current hash). Nothing here changes
how the secret is derived.

## Person status

`users.status` already exists (ENUM incl. PENDING; another change of the same
day adds SUSPENDED and a `services/PersonStateService.ts`, which this bundle
does not use or ship). New invite-only rows are written `PENDING`;
`accept` writes `ACTIVE`. Rows created with a typed password stay `ACTIVE`.

## Verification done here

- `cd default-api && npx tsc --noEmit -p .` → exit 0 (final run). An earlier
  run showed two errors in `src/models/User.ts` /
  `src/controllers/Admin/DashboardController.ts` (`"SUSPENDED"` not yet in
  `IUser.status`) from the concurrent person-state change mid-edit, not from
  this bundle; they were gone on the re-run.
- `cd mycountrymobile-web && npx tsc --noEmit -p tsconfig.app.json` → exit 0.
- `npx eslint` on the nine changed website files → exit 0.
- `bash tests/run.sh` → 17 tests, 17 pass (token shape and sha256 vector, 72 h
  expiry boundaries, constant-time compare, the password rule incl. e-mail in
  any case, the throw-away password fits the validator, the link, the cooldown;
  the e-mail body has the name/inviter/company/link/days and never a password,
  extension or address, and escapes HTML; the migration loads).
- `default-api.patch` (UserController.ts + the seven new files) applies
  cleanly (`git apply --check`) to the pre-change copy of `UserController.ts`
  and reproduces the working tree byte for byte; `web.patch` likewise for the
  eight edited website files plus the new page.
- `dist/` built with `tsc` + `tsc-alias`; `node --check` on all seven files;
  `apply-dist-app.sh` reproduces the built mount lines.

Not done, because it needs a database or a server: no request has been sent;
no e-mail has been sent; the table has not been created against real MySQL;
the accept page has not been opened in a browser. The website has **not**
been built.

## Apply

Source tree: `bash apply.sh --check <default-api dir>` then
`bash apply.sh [--build] <default-api dir>` (applies the patch, then inserts
the two `app.ts` lines by anchor). Website: `cd mycountrymobile-web && git
apply backend-patches/invites/web.patch` (the new page is inside the patch),
then build per portal as usual.

Production box (no src), in this order:

1. Make sure the people-roles bundle's new dist files are on the box
   (`helpers/roleGuard.js`, `helpers/removalRouting.js`,
   `services/RoleResolverService.js`, `services/DeletedUserService.js`,
   `middlewares/RoleGuard.js`) - `dist/controllers/UserController.js` and
   `dist/routers/inviteRoute.js` require them.
2. Stage this folder under `/root/mcm-patches-03sep/invites/` (direct scp into
   `/var/www/prod` is blocked).
3. Back up `/var/www/prod/default-api/dist/controllers/UserController.js` beside itself.
4. Copy the six **new** dist files, then `dist/controllers/UserController.js`.
5. `bash apply-dist-app.sh /var/www/prod/default-api/dist/app.js` (backs up,
   inserts two lines, `node --check`).
6. Optional - the table is created on first use anyway - run the migration:
   copy `default-api/migrations/20260903150000-create-user-invites-table.js`
   and `../people-roles/run-migration.js` next to the app's `.env`, then
   `node run-migration.js ./20260903150000-create-user-invites-table.js`.
7. `pm2 restart default-api`. Then `POST /api/invite/inspect {token:"x"}`
   without a token → 200 `{ ok:false, state:"invalid" }` (a wrong path answers
   404, so this proves the mount). `SHOW CREATE TABLE user_invites`.
8. Build and ship the website from the working tree per portal
   (`../../docs`, memory: build per portal, seed from the working tree).
9. As an admin: add a person with "Send them an invite link" → toast "People
   added. We sent them a link…"; `users.status = PENDING`; a `user_invites`
   row with a 64-char `token_hash`; the e-mail has a button and no password.
   Open the link → name and e-mail shown; an 11-char password refused; the
   e-mail address as password refused; a good one → "Your password is set",
   login page. `status = ACTIVE`, `accepted_at` set. Open the link again →
   "already used". People list: badge gone. Before accepting: badge shown,
   **Resend invite** → new row, old row `expires_at` = now, old link says
   "not valid", second click within a minute → 429.

## Rollback

Box: put the backed-up `UserController.js` and `app.js` back, delete the six
new dist files, `pm2 restart default-api`. Source: `bash rollback.sh <api>
<backup dir>`; website: `git apply -R web.patch` and delete
`src/pages/login/accept-invite/`. The `user_invites` table can stay (nothing
else reads it) or be dropped by hand. People created while this was live and
still `PENDING` cannot log in on the old build either (login always required
`ACTIVE`); set their `status` to `ACTIVE` and send them a forgot-password
link if this is rolled back with invites outstanding.
