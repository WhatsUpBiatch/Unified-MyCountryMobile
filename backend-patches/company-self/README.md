# company-self: a company admin can change their own company name and address

**NOT DEPLOYED.** Built and gated on 3 Sep 2026 in the source mirror
(`/root/UCAAS/mcm-repos/default-api`, uncommitted) and the website working tree
(`/root/mycountrymobile-web`, uncommitted). Nothing has been built for dist, copied
to a server, or restarted. This folder is the portable copy.

## What this is, in plain words

Every company has one row in the main database table `companies`. It holds the
company's name and postal address. Invoices and number purchases read that row.

Until now a customer admin could not change it, or even see all of it. The only
two endpoints that touched the row, `/api/admin/company/info/:uuid` and
`/api/admin/company/upsert`, sit behind the platform-staff check, so every
customer got a 401 from them - and a 401 used to log the customer out. The
Company page worked around that by keeping a copy of the name and address in the
company settings row (`settings.company_identity`), which is not what invoices
read. So a customer could fix the name on screen and still get invoices with the
old name.

This adds two tenant-scoped routes that read and write the real row:

| route | who | does |
|---|---|---|
| `POST /api/company/self` | signed-in admin | returns the caller's own row: `uuid, name, address, city, state, country, postal_code, updated_at` |
| `POST /api/company/self/update` | signed-in admin | body `{name?, address?, city?, state?, country?, postal_code?}`; writes only the keys sent; returns the row plus `changed: [...]` |

The company is always the one on the session (`req.auth.company_uuid`). No uuid is
read from the body or the path, so an admin cannot reach another company.

Both routes sit behind the normal tenant `auth` middleware and then
`RequireAdminRole` (`src/middlewares/RoleGuard.ts`): a non-admin gets 403.

### What can and cannot be changed

Six columns: `name, address, city, state, country, postal_code`. Anything else in
the body is dropped silently: `plan_features`, `allow_country`, `stripe_token`,
`db_name`, `amount`, `credits`, `plan_uuid` cannot be sent here. The response
never returns them either.

### Rules (the validator, `src/services/companySelfLogic.ts`)

Sizes come from the columns, because MySQL is strict and one character over
fails the whole save:

| field | rule |
|---|---|
| name | 2 to 100 characters (the column is VARCHAR(100)); cannot be cleared |
| address | up to 100; empty clears |
| city | up to 35; empty clears |
| state | ISO subdivision code as the website's list gives it: 1-10 letters/digits (`MH`, `CA`, `ENG`, `13`); upper-cased; empty clears |
| country | ISO 3166-1 two-letter code (`IN`, `US`); upper-cased; empty clears |
| postal_code | 1-10 letters, digits, spaces, dashes; empty clears |

The brief said name 2-120. The column is 100, so 100 is the cap.

Signup stores country and state as codes (`IN`, `MH`) - see the website's
country/state selects and the eighteen existing rows - so the validator takes
codes, not names.

Only keys that were sent are written. Sequelize strips `undefined`, and the
validator never produces `undefined` for a sent key, so an omitted field stays
exactly as it was. A save whose values match the row is a no-op: the row is not
touched and the response says "Nothing has changed."

### Change log

The main database has no audit table for companies. `company_settings_history`
lives in each tenant database (through tenant-api) and records settings
sections, not the companies row. Rather than add a table for six columns, every
real change writes one JSON line to the default-api log:

```
[company-self] {"at":"2026-09-03T10:00:00.000Z","company_uuid":"...","by":"<user uuid>","email":"...","ip":"...","changed":[{"field":"name","from":"Old","to":"New"}]}
```

`pm2 logs default-api | grep '\[company-self\]'` finds them. A no-change save is
logged with `"changed":[]`.

## The website

`src/pages/admin-settings/company/company-record.tsx` now asks
`POST /api/company/self` first.

- Server has the route: the card shows the real row, saves go to
  `/api/company/self/update` only, the toast says "Company details saved.", and
  the amber "cannot be changed from here yet / separate billing record" panel is
  never shown. The "use the default location's name" fallback is not used either,
  because the row carries the name.
- Server answers 404 (or a 200 whose body is not this API): the card falls back
  to the old path for the rest of the session - the `company_identity` copy in
  the settings row, plus one best-effort call to the admin upsert. The amber panel
  shows only there, and only after the admin route has actually refused a save.
- Any other failure (500, 403, dropped connection) is shown, not papered over
  with the settings copy. Same rule as `lib/company-defaults.ts`.

Detection lives in the new `src/lib/company-self.ts`, shaped like
`company-defaults.ts`: one probe per session, shared between callers.

Two small fixes came with it:

- The country, state and city selects called `setValue` without `shouldDirty`,
  so those three fields were never counted as edited and were never sent. They
  are now.
- "Edit details" is disabled until the server has said which door is open, so
  the form never seeds from the wrong record.

Files changed on the website (also in `web.patch`):

- `src/pages/admin-settings/company/company-record.tsx` (rewritten)
- `src/lib/company-self.ts` (new)
- `src/services/api/index.tsx` (`fetchCompanySelf`, `updateCompanySelf`)
- `src/services/api/routes.tsx` (`COMPANY_SELF`, `COMPANY_SELF_UPDATE`)

The website is NOT built. Build it the usual way (see the memory note on per-portal
builds) once the API is live; before that the page simply falls back, so shipping
the website first is safe.

## Files in this folder

```
README.md                                       this file
apply.sh                                        copies the four source files into a default-api tree and mounts the route in src/app.ts (--check to dry-run)
default-api-app.patch                           the two-line src/app.ts change, as a unified diff
default-api/src/services/companySelfLogic.ts    the validator (pure, no imports)
default-api/src/services/CompanySelfService.ts  read + write + log line
default-api/src/controllers/CompanySelfController.ts
default-api/src/routers/companySelfRoute.ts
web.patch                                       the website change
tests/run.sh                                    bundles the validator and runs node:test
tests/company-self-logic.test.cjs               13 tests
```

## Gates run on 3 Sep 2026

| gate | result |
|---|---|
| `npx tsc --noEmit -p .` in default-api | exit 0 |
| `npx tsc --noEmit -p tsconfig.app.json` in the website | exit 0 |
| `npx eslint` on the four changed website files | exit 0 |
| `bash tests/run.sh` | 13 pass, 0 fail |
| `bash apply.sh --check` against the mirror | anchors present, files identical |

## How to deploy (not done)

1. Source is already in `/root/UCAAS/mcm-repos/default-api`. For any other
   checkout: `bash backend-patches/company-self/apply.sh /path/to/default-api`.
   It needs `src/middlewares/RoleGuard.ts` to exist already (the people-roles
   bundle).
2. Build there: `npm run build` (`tsc && tsc-alias`).
3. Copy these dist files to the server's `/var/www/prod/default-api/dist/`,
   keeping a `.bak-company-self-<stamp>` of `app.js` first:

   ```
   dist/app.js                                  (changed: one import, one app.use)
   dist/services/companySelfLogic.js            (new)
   dist/services/CompanySelfService.js          (new)
   dist/controllers/CompanySelfController.js    (new)
   dist/routers/companySelfRoute.js             (new)
   ```

   `CompanySelfService.js` imports `../models/Company` with a relative path on
   purpose, so it loads even if copied without tsc-alias. `dist/app.js` must come
   from the build, not a hand edit, because it carries every other route.
4. `pm2 restart default-api`.
5. Prove it, with a control:
   - no token: `curl -s -X POST https://<api>/api/company/self` -> 401 (a wrong
     path such as `/api/company/selfx` -> 404, which shows the mount is there)
   - admin token: `-> 200` with the row; the `name` must match
     `select name from companies where uuid=...`
   - USER-role token: `-> 403`
   - `POST /api/company/self/update` with `{"name":"A"}` -> 422; with
     `{"country":"India"}` -> 422; with `{"postal_code":"400002"}` -> 200 and
     `select postal_code from companies where uuid=...` shows 400002; then put
     the old value back
   - `pm2 logs default-api | grep '\[company-self\]'` shows the two lines
   - a second admin's token must return that admin's own company, not the first
6. Then build and ship the website per portal.

## Rollback

- API: restore `dist/app.js` from the `.bak-company-self-<stamp>` copy and
  delete the four new dist files; `pm2 restart default-api`. Source: delete the
  four files under `src/` and restore `src/app.ts` from its backup (or
  `patch -R -p1 < default-api-app.patch`).
- Website: `git apply -R backend-patches/company-self/web.patch` and rebuild.
  Nothing else on the website depends on the new module. With the API rolled
  back and the website still shipped, the page falls back to the settings-row
  path on its own (the probe gets a 404).

No migration, no new table, no schema change.
