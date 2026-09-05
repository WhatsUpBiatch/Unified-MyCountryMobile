# Invite template: a branded invite e-mail, and the platform admin's add-member sends a link too

**NOT DEPLOYED.** Source changes sit in `/root/UCAAS/mcm-repos/default-api`
and `/root/UCAAS/mcm-repos/notification-api` (uncommitted working-tree edits).
Builds on the **invites** bundle (`../invites/README.md`): that one must be on
the box first. This folder is the portable copy: two patches, the changed
files, the four built `dist/` files for default-api, the tests, the scripts.

## What was wrong, in plain words

1. The invite e-mail (invites bundle, 3 Sep) was plain HTML with no logo, no
   company colours and no footer, because notification-api had no invite
   template and adding one meant a notification-api deploy.
2. The old `ADD_MEMBER_NOTIFICATION` template still printed
   `Password: {{password}}`. The tenant add-member no longer calls it, but the
   template itself could still e-mail a password to anyone who did.
3. The **platform admin portal**'s add-member
   (`default-api src/controllers/Admin/UserController.ts`, `POST
   /api/admin/user/add-member/:company_uuid`) was that caller: it took the
   password the operator typed, created the row `ACTIVE`, and e-mailed the
   password in clear through `ADD_MEMBER_NOTIFICATION`. It also sent the
   bcrypt hash back to the browser.

## What it does now

### A. The branded invite mail

notification-api gets a new template `INVITE_LINK`
(`src/templates/ucaas/inviteLink.html`). Same page as the forgot-password
mail: logo, divider, icon, Poppins, the company's `primary_color` button,
support line, "Best regards", social icons, store badges, footer. The body:

> **You have been invited**
> Hello *name*,
> *Inviter* has added you to *Company*. To get started, choose your own password.
> [ **Choose your password** ]
> If the button does not work, copy this address into your browser: *link*
> This link works for **3 days**. After that, ask the person who added you to
> send a new one. If you were not expecting this, you can ignore this e-mail.
> Nothing changes until you choose a password.

No password, no extension, no e-mail address anywhere in it. With no inviter
name it says "You have been added to *Company*"; with no company name it uses
the portal's project name.

`UserInviteService.sendInviteEmail` now sends `template: true, body:
"INVITE_LINK"` with the variables `name`, `inviter_name`, `company_name`,
`invite_link`, `ttl_days` (`helpers/inviteEmail.ts` `buildInviteTemplateData`).
`SmsController.sendNotification` adds the logo, colours, project name,
support e-mail and the rest to every mail, as it does for forgot-password.

**The fallback.** notification-api never says "unknown template" as an error:
`EmailService.compileTemplate` throws "Email template not found", `smtpEmail`
/ `sendGridEmail` catch that and return `false`, and `notification/send`
answers **200** with `result: [{ channel: "email", result: false }]`. So
`sendInviteEmail` reads that answer (`inviteEmailWent`): a 2xx e-mail result
(`{status: 200}` from SMTP, `{status: "202"}` from SendGrid) means sent; `false`
- or no e-mail entry, or a non-2xx status - means it sends the **same mail
again with `template: false`** and the plain HTML body from
`buildInviteEmailHtml`, which every notification-api build sends as-is. Only
if that second attempt also fails does it report "not sent" (the People list
then offers Resend invite). So default-api can go first, notification-api
later, and invites keep going out either way; once the template is on the box,
the branded one is what arrives. The console warns once per fallback with
notification-api's answer, so a box still on the plain mail is visible in the
log.

`ADD_MEMBER_NOTIFICATION` keeps its layout but the password line now reads
"Password: To get started, choose your own password using the invite link we
sent you." (`{{password}}` is gone from the file), the intro says "Here are
your account details", and the "change your password after first login" tip
is replaced. Nothing in any repo calls it any more (checked: the only caller
was the admin add-member below), but if something did, it could not print a
password.

### B. The platform admin's add-member sends the invite link

`Admin/UserController.addMember` now does what the tenant add-member does:

- `password` in the body is **optional** (`createUserValidatorAdmin`,
  `validators/UserValidator.ts`). Left out or empty: the row gets a random
  throw-away password (`randomTemporaryPassword`, bcrypt-hashed like before)
  and `status = PENDING`. Login refuses anything but `ACTIVE`, so the row
  cannot be used until the person accepts the link. Typed: the breach check
  and hashing run as before and the row is `ACTIVE`; that person gets the
  link too and can pick their own.
- After the row is created: `UserInviteService.createInvite(user,
  admin.uuid)` and `sendInviteEmail(user, token, req, <admin's name>)`. The
  inviter shown in the mail is the platform admin's `first_name last_name`
  (or `name`) from the `admins` row `AdminMiddleware` puts on `req.auth`. A
  mail failure does not undo the person; the reply says so.
- The reply no longer carries the bcrypt hash. It is the row (minus
  `password`) plus `invite: { sent, expires_at, status }`, with the message
  "User added. We sent them a link to choose a password. It works for 3
  days." or "User added, but the invite e-mail to x could not be sent. A
  company administrator can use "Resend invite" on the People list."
- `ADD_MEMBER_NOTIFICATION`, `generatePassword` and `SmsController` are gone
  from that file. Licence count, duplicate e-mail/phone/extension checks and
  the role lookup are unchanged.

The admin portal (`admin-portal` repo, `Members/AddMemberDrawer.tsx`) still
has a required password field in its form; it keeps working (typed password
= `ACTIVE` row + link). Making that field optional in the admin portal is a
separate front-end change, not in this bundle.

## What changes, file by file

### notification-api (templates only - no TypeScript touched)

| file | what |
|---|---|
| `src/templates/ucaas/inviteLink.html` | **new**: the `INVITE_LINK` template (`INVITE_LINK` -> `inviteLink` by `CommonHelper.toCamelCase`, folder `ucaas` from `template_folder: 'UCAAS'` that `SmsController` always sends) |
| `src/templates/ucaas/addMemberNotification.html` | **edited**, 3 lines: no `{{password}}` |

### default-api source

| file | what |
|---|---|
| `src/helpers/inviteEmail.ts` | **edited** (invites bundle file): `INVITE_TEMPLATE_NAME`, `InviteTemplateData`, `buildInviteTemplateData()`, `inviteEmailWent()`; the plain body `buildInviteEmailHtml()` and `inviteEmailSubject()` unchanged |
| `src/services/UserInviteService.ts` | **edited** (invites bundle file): `sendInviteEmail` sends the template, falls back to the plain body, returns whether the e-mail channel actually went |
| `src/validators/UserValidator.ts` | **edited**, 1 line: `createUserValidatorAdmin.password` optional |
| `src/controllers/Admin/UserController.ts` | **edited**: `addMember` as described; imports swapped |

Not touched, by rule: `src/controllers/UserController.ts` (tenant),
`src/controllers/AuthController.ts`, `src/app.ts`.

**This supersedes** `../invites/default-api/src/helpers/inviteEmail.ts`,
`../invites/default-api/src/services/UserInviteService.ts` and the two
matching files in `../invites/dist/`. The invites bundle's copies are left as
they were (they are that bundle's snapshot); ship the ones here on top.

### The dist files (default-api; production has no `src/`)

Built from the working tree with `tsc` + `tsc-alias` into a scratch dir; zero
`require("@/...")` left; `node --check` passes on all four.

| dist file | replaces | requires (relative) |
|---|---|---|
| `dist/helpers/inviteEmail.js` | the invites bundle's copy | nothing |
| `dist/services/UserInviteService.js` | the invites bundle's copy | `helpers/inviteEmail`, `helpers/inviteToken`, `models/UserInvite` (invites bundle), `config/database`, `controllers/SmsController`, `helpers/CommonHelper`, `models/Company`, `models/User` |
| `dist/controllers/Admin/UserController.js` | the live file | `helpers/inviteToken`, `services/UserInviteService` (invites bundle), `validators/UserValidator`, `helpers/CommonHelper`, `models/*`, `utils/paginate` |
| `dist/validators/UserValidator.js` | the live file | nothing new |

**Caution on `validators/UserValidator.js`:** the live dist may carry hand
patches (the live `AuthValidator.js` does - see the source-vs-production
memory). Before copying, `diff` the live file against this one: the only
difference should be the one `password:` line inside
`createUserValidatorAdmin`. If there is more, do not copy; change that one
line in the live file by hand instead.

**Caution on `controllers/Admin/UserController.js`:** built from the shared
working tree; it requires nothing from the same-day people-roles /
person-state / company-settings work, only the invites bundle's files.

## How notification-api is deployed

From the repo (`/root/UCAAS/mcm-repos/notification-api`): `npm run build` is
**webpack** (`webpack.config.js`): it bundles `src/server.ts` into one file
`dist/src/index.js` and `CopyWebpackPlugin` copies `src/templates/` to
`dist/templates/`. `package.json` `main` / `npm start` is `node
dist/src/index.js`; pm2 runs that (README: `pm2 start dist/src/index.js
--name mycountrymobile-notification-api`). At runtime `EmailService` opens
`path.resolve(__dirname, "../templates/<folder>/<name>.html")` with
`__dirname` = `dist/src`, i.e. **`dist/templates/ucaas/<name>.html`**, and
reads it with `fs.readFileSync` on **every send** - no cache, so a new or
changed template file is picked up **without a restart**.

On mcm-new the service is `/var/www/prod/notification-api` (loopback port
`NOTIFICATION_PORT`, SMTP creds in its `.env` - see the voicemail-email
memory). The 2 Sep source-vs-production audit built this repo and diffed it
against that box: **0 fragments differ**, so the repo and the box run the
same build. Whether the box keeps a `src/` next to `dist/` was **not
checked here** (no ssh in this task); the deploy steps below cover both
cases. The other services' READMEs describe default-api as dist-only; the
company-settings README shows tenant-api with a `src/`.

Because only two `.html` files change, **no rebuild and no restart of
notification-api is needed**: copy the files into `dist/templates/ucaas/`
(and into `src/templates/ucaas/` too if that folder exists, so a later
`npm run build` on the box does not lose them).

## Verification done here

- `cd default-api && npx tsc --noEmit -p .` -> exit 0.
- notification-api type-check with default-api's `node_modules` symlinked in
  (`npx tsc --noEmit -p . --types node`), symlink removed after: **5 errors,
  all `TS2307 Cannot find module`** for `firebase-admin`, `@sendgrid/mail`,
  `handlebars`, `googleapis` - packages default-api does not have. No
  TypeScript file in notification-api is changed by this bundle, so that is
  the baseline, not a regression. (Without `--types node` tsc stops earlier
  on two stub `@types` dirs, `axios` and `ioredis`, for the same reason.)
- `bash tests/run.sh` -> **17 tests, 17 pass**. The template tests render the
  **real** `inviteLink.html` / `addMemberNotification.html` /
  `forgotPasswordNotification.html` with **Handlebars 4.7.8** - the renderer
  notification-api uses - fed by the real `buildInviteTemplateData()`
  (esbuild-bundled from `inviteEmail.ts`) plus the branding fields
  `SmsController.sendNotification` merges in: name / inviter / company /
  button / the link twice (href + text) / "3 days" / title / logo / support /
  footer; the no-inviter and no-company branches; HTML in name, inviter,
  company and link is escaped (`<img` -> `&lt;img`, `=` -> `&#x3D;`, `"` ->
  `&quot;`); a leaked `password` / `email` / `extension` in `data` never
  renders; no `{{` survives even with branding missing; `ADD_MEMBER` never
  prints the password; `INVITE_LINK` maps to `inviteLink.html` through the
  copied `toCamelCase`. The fallback tests cover `buildInviteTemplateData`
  (exactly five keys, fallbacks, never a secret) and `inviteEmailWent`
  (2xx number and string -> sent; `false`, no array, no e-mail entry, 5xx,
  `true`, missing result -> fall back).
- `bash ../invites/tests/run.sh` (the old plain-body tests) -> 17 pass on the
  edited helper.
- Both patches reverse-apply cleanly (`git apply -R --check`) against the
  working trees, so they reproduce them byte for byte; both forward-apply on
  a copy of the pre-change files and produce the staged copies.
- `dist/`: built with `tsc` + `tsc-alias`; `node --check` on all four; no
  alias requires.

Not done, because it needs a server, a database or a mailbox: no request
has been sent; no e-mail has been rendered by the **live** notification-api;
the fallback has not been exercised against a real 200/`false` answer; the
admin portal has not added a person. The visual result of `inviteLink.html`
in a mail client has not been looked at.

## Apply

Source trees: `bash apply.sh --check /root/UCAAS/mcm-repos` then `bash
apply.sh [--build] /root/UCAAS/mcm-repos` (needs the invites bundle applied
first). Undo: `bash rollback.sh /root/UCAAS/mcm-repos`.

Production, in this order (default-api first is fine - the fallback covers
the gap; notification-api first is also fine - the template just sits unused
until default-api asks for it):

1. The invites bundle must already be on the box (`../invites/README.md`
   steps 1-7), or `dist/services/UserInviteService.js` and
   `dist/controllers/Admin/UserController.js` fail at `require` on start.
2. Stage this folder under `/root/mcm-patches-03sep/invite-template/`
   (direct scp into `/var/www/prod` is blocked).
3. **notification-api**: `ls /var/www/prod/notification-api/dist/templates/ucaas/`
   (expect `forgotPasswordNotification.html` etc.). Back up
   `addMemberNotification.html` beside itself. Copy `inviteLink.html` and
   `addMemberNotification.html` from `notification-api/src/templates/ucaas/`
   here into that folder. If `/var/www/prod/notification-api/src/templates/ucaas/`
   exists, copy them there too. No restart.
4. **default-api**: back up `dist/services/UserInviteService.js`,
   `dist/helpers/inviteEmail.js`, `dist/controllers/Admin/UserController.js`,
   `dist/validators/UserValidator.js` beside themselves. `diff` the live
   `UserValidator.js` against `dist/validators/UserValidator.js` here (see
   the caution above). Copy the four files. `pm2 restart default-api`.
5. Check: as a company admin, add a person with "Send them an invite link".
   The mail that arrives has the logo, the company colour button "Choose your
   password", the link as text, "3 days", no password. default-api's log has
   **no** "did not send ... sending the plain body instead" line. (If step 3
   was skipped, the plain mail arrives and that warning is in the log - the
   fallback proved.) `SHOW` the `user_invites` row as before.
6. Check B: from the admin portal, add a member to a company **without** a
   password (or with one). Reply has no `password` field, has
   `invite.sent: true`; `users.status` is `PENDING` (or `ACTIVE` with a typed
   password); the same branded mail arrives with the platform admin's name
   as the inviter; the link works as in the invites README step 9.

## Rollback

Box: put the backed-up files back (`addMemberNotification.html`, the four
default-api dist files), delete `dist/templates/ucaas/inviteLink.html` (or
leave it - nothing calls it once the old `UserInviteService.js` is back),
`pm2 restart default-api`. Source: `bash rollback.sh /root/UCAAS/mcm-repos`.
People the admin portal added while this was live and still `PENDING`
cannot log in on the old build (login always required `ACTIVE`): set their
`status` to `ACTIVE` and send them a forgot-password link.
