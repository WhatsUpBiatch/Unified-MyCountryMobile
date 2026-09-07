# company_settings — one row per section, with a change log

**DEPLOYED to mcm-new (api2) on 3 Sep 2026, 06:31-06:52 UTC.** Verified on a real
tenant (mcm_1785312032037): `list` returned 13 sections at version 1 by
"migration", `get` returned the recording section, a stale `version` got 409, a
USER-role save got 403, a bad section name got 400, `history` had rows, `policy`
reported `source: company_settings`. Public route answers 401 without a token
(a wrong path answers 404), so the proxy is mounted.

**The lock middleware runs in REPORT mode** (`COMPANY_POLICY_LOCK` unset). It logs
`companyPolicyLock: report mode, would have refused {...}` to the default-api log
instead of sending 403. Reason: a person's own settings page rewrites several of
the governed objects on every save, and a false 403 there would stop every
non-admin from saving anything. Set `COMPANY_POLICY_LOCK=enforce` in
`/var/www/prod/default-api/.env` and `pm2 restart default-api` once the log has
stayed quiet for a few days of real use.

Rollback on the box: tenant-api `dist.bak-company-settings-20260903-063156` and
`src/routers/api.ts.bak-company-settings-20260903-063156`; default-api
`*.bak-company-settings-20260903-063744` beside the three edited dist files (the
five new files can simply be deleted); switch
`/opt/fs-xml-api-1.2.5/dialplan_service.py.bak-company-settings-20260903-064304`.
Staged copies under `/root/mcm-patches-03sep/company-settings/`.

Source lives in `/root/UCAAS/mcm-repos/{tenant-api,default-api}` as uncommitted
working-tree changes; this folder is the portable copy.

## 3 Sep 2026, later: the open default

`companyRuleFlags.ts` (all four copies: both services and both bundle copies)
now reads a rule that carries only the old `override` flag like this:

| stored                                | apply | locked |
|---------------------------------------|-------|--------|
| `override: true`                      | yes   | no     |
| `override: false` (explicitly stored) | no    | yes    |
| absent / `undefined` / `null`         | no    | no     |

New-style `apply` / `locked` keys still win when present. Before this, an
absent flag read as locked, so a company that had never touched a policy
switch locked every governed setting for every non-admin. Now such a company
locks nothing: `CompanyPolicyLock` finds no violations and `applyCompanyRules`
seeds nothing, which is what "the company never said anything" should mean.
The website's `company-rule-flags.ts` made the same change first; the test
`the server reads the legacy flag exactly as the website does` keeps the two
in step. Staged with the notifications-media bundle
(`backend-patches/notifications-media/`), which carries the same file.

## What this is, in plain words

Every company-wide setting today sits in one row of the tenant table
`user_template`, named "Company Default": one big JSON blob with a key per admin
screen, plus a second blob for greetings. Ten screens each rewrite the whole blob.
Two admins saving different screens at the same time overwrite each other, and
nothing anywhere records who changed what.

This replaces that with a table called `company_settings`: one row per section
(`recording`, `company_security`, `greetings`, ...), a version number on each row,
and a second table `company_settings_history` that gets a row on every save. The
old template row is left exactly as it is, so every existing screen keeps working
until it is moved over.

It also makes the server honour the company rules for the first time. Until now
"apply this to everyone" and "nobody may change this" were only enforced by the
browser, which any signed-in person can bypass with one request.

## What changes

### tenant-api (owns the tables)

| file | what |
|---|---|
| `src/helpers/companyRuleFlags.ts` | **new** — pure port of the website's `company-policy.ts` + `company-rule-flags.ts`, plus `applyCompanyRules` / `lockedFieldViolations` for the server |
| `src/helpers/companySettingsSections.ts` | **new** — section-name rule, split of the old blob into rows, fold back |
| `src/helpers/companyDefaults.ts` | **new to the source tree** — the earlier patch's reader of the "Company Default" row; already live on mcm-new, never committed. Used as the fallback |
| `src/repositories/CompanySettingsRepository.ts` | **new** — table creation on first use, list/get/save/history, lazy migration, `effective()` |
| `src/controllers/CompanySettingsController.ts` | **new** — the five endpoints |
| `src/routers/api.ts` | **edited** — 1 import, 1 field, 5 routes after `user/template/info/:uuid` |

### default-api (proxies, and the user create/update paths)

| file | what |
|---|---|
| `src/helpers/companyRuleFlags.ts` | **new** — byte-identical copy of the tenant-api file (checked by a test and by apply.sh) |
| `src/controllers/Tenant/TenantCompanySettingsController.ts` | **new** — proxies, same shape as TenantUserTemplateController |
| `src/routers/TenantRouter/tenantCompanySettings.ts` | **new** — mounts the five proxies |
| `src/services/CompanyPolicyService.ts` | **new** — reads the folded rules from tenant-api (30 s cache, fails open) |
| `src/middlewares/CompanyPolicyLock.ts` | **new** — refuses a non-admin's change to a locked field |
| `migrations/tenant/20260903000000-create-company-settings-tables.js` | **new** — the same two tables, for tenant databases created from now on |
| `src/routers/tenantRoute.ts` | **edited** — 2 lines |
| `src/routers/userRoute.ts` | **edited** — lock middleware on `POST /user/update/:uuid?` |
| `src/controllers/UserController.ts` | **edited** — one call in `addMember`, after the default settings are generated |

Deliberately **not** touched: `tenant-api/src/repositories/CallListRepository.ts`
and `default-api/src/controllers/Recording/index.ts` (another change owns them).

## The API, as built

All POST, all through `/api/tenant/...` on default-api, which forwards to
`/api/v1/...` on tenant-api with the usual identity headers. Replies use the
service's envelope: `{ success, data: { message, result } }` on success,
`{ success: false, error: { message, ... } }` from tenant-api on failure
(`{ message, service }` when the proxy itself maps an error).

| endpoint | body | who | result |
|---|---|---|---|
| `user/company-settings/list` | — | anyone signed in | `{ sections: { [section]: { section, settings, version, updated_at, updated_by, updated_by_name } }, migrated_from_template }` |
| `user/company-settings/get` | `{ section }` | anyone | one row, or 404 |
| `user/company-settings/save` | `{ section, settings, version? }` | **ADMIN only** (403 otherwise) | the saved row (version bumped). 409 if `version` is given and is not the stored version; the proxy adds `conflict: true, current: <row>` |
| `user/company-settings/history` | `{ section, limit? }` | anyone | `{ section, rows: [ { id, section, settings, version, changed_by, changed_by_name, changed_at } ] }` newest first, default 50, max 500 |
| `user/company-settings/policy` | — | anyone | `{ source: 'company_settings' \| 'user_template' \| 'none', settings, greetings, rules: { [field]: { apply, locked, isLegacy } } }` |

Rules:

- Section names must match `^[a-z][a-z0-9_]{1,63}$`; anything else is 400.
  `greetings` is a section like any other.
- `settings` must be a JSON object or array; scalars and null are 400.
- Saving without `version` is last-writer-wins, as today. Sending the version you
  read makes the save refuse if someone else got there first.
- Every save writes a history row in the same transaction, so the log cannot
  disagree with the table. `updated_by` is the caller's uuid, `updated_by_name`
  their display name from the `X-User-name` header.

### Lazy migration

On `list`, if `company_settings` is empty and a "Company Default" row exists, the
blob is split into one row per top-level key plus a `greetings` row, all at
version 1 with `updated_by = 'migration'`, and the reply says
`migrated_from_template: true`. Keys whose names do not fit the rule are logged
and skipped, never silently dropped. The template row is not touched. (If two or
more "Company Default" rows exist — a real bug on two live tenants — the fold from
`companyDefaults.ts` picks the newest section by section, as the earlier patch does.)

### Tables

Created by tenant-api on first use (`CREATE TABLE IF NOT EXISTS`, once per tenant
per process) because tenant migrations only ever run when a tenant database is
first created. The migration file carries the same DDL for new tenants and is
idempotent. `utf8mb4_unicode_ci`, like `user_template`.

```
company_settings          id, section VARCHAR(64) UNIQUE, settings JSON, version INT UNSIGNED DEFAULT 1,
                          updated_by VARCHAR(36), updated_by_name VARCHAR(120), created_at, updated_at
company_settings_history  id, section, settings JSON, version, changed_by, changed_by_name, changed_at
                          KEY (section, changed_at)
```

## Server-side apply and lock

The website's model, unchanged: every governed setting carries `apply` ("put the
company value on the person") and `locked` ("the person may not change it").
A record with only the old `override` flag reads as `apply = override,
locked = !override`, which is what the product did before the flags were split.
`POLICY_FIELDS` is copied verbatim and a test compares it to the frontend file.

**On create** (`addMember`): after the default settings are generated for each
new person, every rule with `apply` on writes the company value over them, in the
same order and shape the website's people screen uses. `role` is never seeded
(the user's role comes from `role_uuid`, and the update path reads
`settings.role.label` back into the `users.role` column). `transcription` and
`ai_call_monitoring` land as bare booleans from `.enabled`, as on the website.
Rule flags are stripped from what is copied. Anything the caller sent for the
person explicitly wins over both.

**On update** (`POST /user/update/:uuid?`): if the caller is not ADMIN and the body
carries `settings`, every `locked` rule is compared between the stored and
incoming value at that path (key order ignored, flags ignored). Any difference
is refused:

```
403 { success: false, message: "Your company has locked these settings. Ask an admin to change them.",
      locked_fields: ["recording", "voicemail"] }
```

Admins are never blocked. The check applies to a non-admin editing anyone, not
only themselves. If the rules cannot be read (tenant-api down), the request goes
through and the failure is logged — the alternative is every settings save on
every phone failing whenever tenant-api hiccups, and "unenforced" is what the
platform did until now.

The rules come from `company_settings` first and the "Company Default" template
row when that table is empty, via the `policy` endpoint; default-api never opens a
tenant database connection for this (its `tenantDb()` helper makes a fresh pool
per call, which would leak on a per-request path).

## Verification done here

- `cd default-api && npx tsc --noEmit -p .` → exit 0 (39 s).
- `cd tenant-api && npx tsc --noEmit -p . --types node` → exit 0. tenant-api has
  no `node_modules` in the source mirror; default-api's was symlinked in for the
  check and removed after. `--types node` is needed only because that borrowed
  tree has two stub `@types` packages (`axios`, `ioredis`) with no `index.d.ts`;
  the baseline before any change fails on exactly those two and nothing else.
- `bash tests/run.sh` → 32 tests, 32 pass (rule flags, apply, lock, split, fold,
  frontend-drift check, copy-identity check).
- Both `.patch` files apply cleanly to `HEAD` copies of the edited files, and the
  result is byte-identical to the working tree.
- The migration file loads under node.

Not done, because it needs a database or a server: no request has been made
against a running tenant-api; the lazy migration, the 409 path and the 403 path
have not been exercised end to end. The dist output has not been built (source
mirror has no node_modules for tenant-api); apply.sh has `--build` for a tree that
does.

## Apply order

1. `bash apply.sh --check` — anchors and dry-run only.
2. `bash apply.sh [--build] <tenant-api dir> <default-api dir>` — copies the new
   files, applies the four edits, type-checks. Refuses if an anchor line is
   missing, if a file it would add already exists, or if either patch does not
   apply cleanly. Safe to run twice.
3. On the server, tenant-api first (default-api's proxies and policy reader need
   it): `npx tsc && npx tsc-alias && pm2 restart tenant-api`, then the same for
   default-api. Both builds go through tsc-alias so no `@/` alias survives into
   dist.
4. As an admin, `POST /api/tenant/user/company-settings/list`: expect
   `migrated_from_template: true` once, then `false`; then check the tenant DB has
   one `company_settings` row per top-level key and a history row for each.
5. As a non-admin, save your own settings with a locked field changed: expect 403
   with `locked_fields`. Repeat with it unchanged: expect the usual 200.

Note on mcm-new: its tenant-api `src/routers/api.ts` already carries the earlier
recording-access routes (applied from `backend-patches/tenant-api`). The hunk here
anchors on the `user/template/info/:uuid` block, which that patch did not move, so
`git apply` should still fit; apply.sh will stop if it does not.

## Rollback

`bash rollback.sh <backup-dir>` restores the four edited files from the backup
apply.sh made and removes the added files, then rebuild and restart. The two
tables are left in place on purpose — they hold the change log and nothing else
reads them — and can be dropped by hand.
