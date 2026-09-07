# default-api: source parity with the running dist (3 Sep 2026)

Goal: `npx tsc && npx tsc-alias` from `/root/UCAAS/mcm-repos/default-api`
must reproduce every behaviour that is live in
`/var/www/prod/default-api/dist` on mcm-new (api2), so a rebuild no longer
silently drops hand-applied patches.

Reference used: a byte copy of the live dist taken 3 Sep 2026, at
`scratchpad/box/default-api/dist-live/` (including every `*.bak-*` beside the
patched files, which is how each hunk below was attributed: the `.bak` chain
was diffed link by link).

Nothing was deployed, committed, stashed or checked out. `src/controllers/UserController.ts`
was not touched (another agent owns it).

## Hunks ported into the TypeScript source

| # | Live-only hunk | Where it now lives in `src/` | From which patch / .bak | Status |
|---|---|---|---|---|
| 1 | Two new requires in `AuthController.js` (`checkIpAllowlist`, `ipAllowlistEnforcementEnabled`) | `src/controllers/AuthController.ts` imports | `patch_login_ip_allowlist.py` (= `.bak-ipallowlist-20260902-103020` -> `.bak-role-20260902-133752`) | ported by running the TS patch script |
| 2 | `login()`: after `findCompany` is confirmed, refuse with 403 `IP_NOT_ALLOWED` when the company allowlist denies `clientIp` | `src/controllers/AuthController.ts` `login()` | same as 1 | ported |
| 3 | `userRole: findUser.role` inside that call | same block | `.bak-role-20260902-133752` -> live (the "role" hand-edit) | ported (the TS patch script already carried it, mis-indented; indentation fixed in the mirror) |
| 4 | `verifyOtpLegacy()` and `verifyOtp()`: master OTP is no longer dead in production; it works only from an address in `MASTER_OTP_ALLOWED_IPS` (`*` = any), a correct code from elsewhere is refused and logged `[MASTER_OTP] rejected`, a used bypass is logged `[MASTER_OTP] bypass used` | `src/controllers/AuthController.ts`, both methods (identical block) | `.bak.masterotp-20260901-072432` -> `.bak-trusteddevice-20260901-074903` (the allow-list gate + "bypass used" log) and `.bak-otpdiag-20260901-080437` -> `.bak-optin-20260901-080924` (the "rejected" log) | ported. **Security note, read below.** |
| 5 | Two new requires in `AuthMiddleware.js` | `src/middlewares/AuthMiddleware.ts` imports | `patch_auth_middleware_ip_allowlist.py` (= `.bak-ipallowlist-20260902-103020` -> `.bak-role-20260902-133752`) | ported by running the TS patch script |
| 6 | `auth()`: after the "Un-authenticate or deleted User" guard, re-check the allowlist on every request; on deny destroy the `DeviceSecurity` session row and answer 403 `IP_NOT_ALLOWED` | `src/middlewares/AuthMiddleware.ts` `auth()` | same as 5 | ported |
| 7 | `userRole: user.role` inside that call | same block | `.bak-role-20260902-133752` -> live | ported (indentation fixed) |
| 8 | New file `lib/ip-allowlist.js` | `src/lib/ip-allowlist.ts` | `backend-patches/default-api/src/lib/ip-allowlist.ts` (copied in) | rebuilt JS is byte-identical to live |
| 9 | New file `services/IpAllowlistService.js` | `src/services/IpAllowlistService.ts` | `backend-patches/default-api/src/services/IpAllowlistService.ts` (copied in; already carries `userRole`) | byte-identical to live |
| 10 | New file `middlewares/ipAllowlistFeatureFlag.js` | `src/middlewares/ipAllowlistFeatureFlag.ts` | copied in | byte-identical to live |
| 11 | New file `middlewares/IpAllowlistApiGuard.js` (present on the box, mounted nowhere) | `src/middlewares/IpAllowlistApiGuard.ts` | copied in | byte-identical to live |
| 12 | New file `models/CompanySecurityAuditLog.js` | `src/models/CompanySecurityAuditLog.ts` + `src/models/request/ICompanySecurityAuditLogAttributes.ts` | copied in | byte-identical to live |
| 13 | Migration for `company_security_audit_logs` | `migrations/20260902000000-sync-company-security-audit-log-table.js` | copied in from `backend-patches/default-api/migrations/` | not part of dist; included so a fresh checkout can create the table |

### Hunks that were ALREADY in source before this pass (nothing to port)

| Live hunk | .bak that introduced it | Where it already sits in `src/` |
|---|---|---|
| Trusted device: skip the OTP when this email + device_id verified one within `TRUSTED_DEVICE_DAYS` (default 30), answer `"Device already verified"` | `.bak-trusteddevice-20260901-074903` -> `.bak-otpdiag-20260901-080437` | `AuthController.ts` `sendOtp()` (uncommitted working-tree change, by another agent) |
| Opt-in: that skip only happens when the login screen sent `remember_device: true` | `.bak-optin-20260901-080924` -> `.bak-ipallowlist-20260902-092959` | same block, plus `remember_device` in `validators/AuthValidator.ts` |
| `Recording/index.ts` ("blegfix" + "livepush" .baks) | `index.js.bak-20260902-065807-blegfix`, `index.js.bak-20260903-052559-livepush` | `src/controllers/Recording/index.ts`, uncommitted. **Confirmed**: the only difference between the rebuilt JS and live is `const net = require("net")` (hand-written) versus tsc's `__importStar(require("net"))` helper, which is the same thing for a CommonJS built-in. Behaviour identical. |
| `helpers/stunHelper.js` (TURN_URLS list) | `.bak-turnurls-20260901-110438` | already in source; rebuilt file is identical to live |
| `middlewares/CompanyPolicyLock.js`, `helpers/companyRuleFlags.js` ("material" .baks, 3 Sep) | `.bak-material-20260903-072342` | CompanyPolicyLock rebuilt identical to live. companyRuleFlags: source is AHEAD of live (see below), not behind |

### Origin unknown

None. Every live-only line was attributed to a `.bak` step and, through it, to a
named patch.

## Security note on hunk 4 (master OTP)

Before 1 Sep 07:24 the running dist had the source's rule
`masterOtp = isProduction ? "" : MASTER_OTP` - the bypass was dead in
production. The `.bak.masterotp-20260901-072432` step replaced that with the
IP-allow-listed version, and project memory
(`master-otp-disabled-in-production.md`) records that `MASTER_OTP_ALLOWED_IPS`
now holds 17 addresses and the bypass is used daily by staff.

This pass ports the LIVE rule, because the task is "a rebuild must not change
live behaviour". It means the source now says: in production a fixed shared
code is a valid second factor from those 17 addresses. If the owner wants the
bypass dead again, it is one line in each of the two methods:
`const masterOtp = isProduction ? "" : String(process.env.MASTER_OTP || "").trim();`
plus deleting the allow-list lines, not an env edit. That is a decision for the
owner, flagged here so it is not made by accident in either direction.

## Where source is AHEAD of live (not live-only; not touched here)

A rebuild will also ship these. They are the other agent's in-flight,
uncommitted work in the mirror and are listed only so nobody mistakes them for
missing patches:

- `app.js`: mounts `/api/invite`, `/api/person`, `/api/security/devices`, `/api/profile` (new routers + controllers + services: Invite, PersonState, ProfileSelf, TrustedDevice, RoleResolver, DeletedUser, UserInvite).
- `routers/mediaRoute.js`: `directTypeGuard` (fax + video_recording only) on `/direct/...` - `patch_direct_media_auth.py` ported to TS. **Live does NOT have this; the direct media route is still open on the box.**
- `validators/AuthValidator.js`: a comment only.
- `controllers/AuthController.js`: `notification_settings` flattening in the settings update.
- `middlewares/AuthMiddleware.js`: per-state refusal messages (SUSPENDED / PENDING).
- `models/User.js`: `SUSPENDED` added to the status enum.
- `controllers/Roles/index.js` + `routers/rolesRoute.js`: reserved built-in role names, parent-role check, `RoleGuard`.
- `controllers/Media/MediaController.js`, `controllers/Tenant/TenantController.js`: media ownership rule on delete; greeting delete also removes the audio object.
- `controllers/SmsController.js`: notification-settings shape change.
- `helpers/companyRuleFlags.js`: "absent flag means open" reading of legacy `override`.
- `routers/userRoute.js`, `routers/TenantRouter/tenantUserTemplate.js`: role guards on delete/add-member/assign-role/template routes.
- `controllers/UserController.js`: 281 live-side lines differ; not examined beyond confirming they are the pre-refactor shape of code the working tree has rewritten. Off limits to this pass.

## Verification

Build: `rm -rf dist && npx tsc && npx tsc-alias` in the mirror, exit 0.
Typecheck: `npx tsc --noEmit -p .`, exit 0.

`diff dist/<file> dist-live/<file> | grep -c '^[<>]'` after the port:

| File | Lines differing | What the remaining lines are |
|---|---|---|
| `controllers/AuthController.js` | 78 (was 99) | tsc emits `IpAllowlistService_1.checkIpAllowlist` where the hand patch wrote `const { checkIpAllowlist } = require(...)` (4 lines); `_a.._h` temp renumbering (5 lines); comment wording on the trusted-device and master-OTP blocks; one query and one `.split().map().filter()` chain wrapped differently; and the source-ahead `notification_settings` hunk (14 lines). No behaviour differs. |
| `middlewares/AuthMiddleware.js` | 32 (was 42) | same require-form difference (4 lines); `_a.._k` renumbering; a 3-line comment inside the ported block; and the source-ahead SUSPENDED/PENDING messages (13 lines). |
| `routers/mediaRoute.js` | 21 | entirely source-ahead (`directTypeGuard`); live has nothing extra. |
| `validators/AuthValidator.js` | 3 | a comment. |
| `controllers/Recording/index.js` | 35 | 33 lines of tsc's `__importStar` helper + `const net = require("net")` vs `__importStar(require("net"))`. Same behaviour. |
| `lib/ip-allowlist.js` | 0 | |
| `services/IpAllowlistService.js` | 0 | |
| `middlewares/ipAllowlistFeatureFlag.js` | 0 | |
| `middlewares/IpAllowlistApiGuard.js` | 0 | |
| `models/CompanySecurityAuditLog.js` | 0 | |

## Files changed in the mirror by this pass

- `src/controllers/AuthController.ts` (hunks 1-4)
- `src/middlewares/AuthMiddleware.ts` (hunks 5-7)
- new: `src/lib/ip-allowlist.ts`, `src/services/IpAllowlistService.ts`,
  `src/middlewares/ipAllowlistFeatureFlag.ts`, `src/middlewares/IpAllowlistApiGuard.ts`,
  `src/models/CompanySecurityAuditLog.ts`, `src/models/request/ICompanySecurityAuditLogAttributes.ts`,
  `migrations/20260902000000-sync-company-security-audit-log-table.js`

Small thing left alone: `patch_login_ip_allowlist.py` and
`patch_auth_middleware_ip_allowlist.py` in this directory insert the
`userRole:` line with the wrong indentation (cosmetic, compiles fine). Fixed by
hand in the mirror; the scripts themselves were not edited.

## What a rebuild-and-deploy still needs

- `IP_ALLOWLIST_ENFORCEMENT_ENABLED`, `MASTER_OTP`, `MASTER_OTP_ALLOWED_IPS`,
  `TRUSTED_DEVICE_DAYS` are already in the box's `.env`; nothing new.
- The source-ahead list above ships too. Read it before deploying.
