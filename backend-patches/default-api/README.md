# Company IP allowlist — server-side enforcement

Company > Security already had a full IPv4-only allowlist editor before this
patch: enable/disable, a capped list, validation, a lockout warning. What it
lacked, and what this delivers:

1. **IPv6, allow AND block mode, a label per entry.** Done on the frontend
   already, live now, in `src/lib/ip-allowlist.ts` and
   `src/pages/admin-settings/company/company-security.tsx`. Allow mode: only
   the listed networks may sign in. Block mode: everyone may sign in EXCEPT
   the listed networks - the shape needed to eject one bad actor without first
   enumerating every legitimate network a company uses.
2. **Enforcement, at TWO points, both in this directory.** Nothing behind the
   screen has ever read this setting; every request has always been let
   through regardless of what was saved - see "Root cause", below, for what
   that means for a company that already configured this expecting it to
   work.
   - `AuthController.login()` - blocks a NEW sign-in from a disallowed
     network.
   - `AuthMiddleware.ts`'s `auth()` - runs on EVERY authenticated request,
     admin portal and API alike, and blocks CONTINUED use of a session that
     already exists, the moment the network it is being used from stops being
     allowed. This is the piece that answers "an admin blocked a user's IP and
     the user still has an open account": that account's existing session is
     ended, and destroyed outright, on its very next request.
   Both written, both a genuine `tsc --noEmit` compile of the real codebase
   with zero errors, neither yet applied to a running server.

## Root cause of "a blocked IP can still sign in / stay signed in"

There is only one cause, and it is not a bug in the code below: **no
enforcement code has ever run on the server.** Confirmed again on 2 Sep 2026 by
reading the live files directly -
`grep -c ipAllowlistEnforcementEnabled /var/www/prod/default-api/dist/controllers/AuthController.js`
returns `0`, and neither `dist/services/IpAllowlistService.js` nor
`dist/middlewares/ipAllowlistFeatureFlag.js` exist on the server at all. The
screen has always saved a real, validated list; nothing has ever read it at
request time, at either of the two points a real check needs to exist (see
above). An admin who configured this and expected it to work was not wrong to
expect it - the feature was simply never wired to anything that runs.

## Why it is not applied

Uploading to the server this needs (`mcm-new`, which runs both the switch and
`api2`/`default-api`) is blocked by a permission rule in the session that wrote
this. It also needs a decision only the account owner can make — see
**Rollout**, below — so it should not go out silently even once that block is
lifted.

## What is real right now, without deploying anything

```
node scripts/verify-ip-allowlist.mjs
```

run from the frontend repo root. This proves the CIDR matcher — the part most
likely to be silently wrong, and the part a login flow would actually run —
against IPv4 and IPv6 boundary cases (RFC 5737 / RFC 3849 documentation
ranges), the decision logic (on/off, break-glass, misconfigured-empty), and
that this directory's copy of the matcher has not drifted from the frontend's.
57 checks, all passing, as of this patch.

Separately, two things were verified against the ACTUAL production files, not
copies believed to match them:

1. `python3 patch_login_ip_allowlist.py` was run against a full, unmodified
   copy of `AuthController.ts` pulled from `/root/UCAAS/mcm-repos/default-api`
   (the mirror this platform's memory notes confirm matches `api2` production
   byte-for-byte). The patched file was dropped into an isolated copy of the
   whole repository alongside every new file in this directory, and
   **`npx tsc --noEmit` against the real `tsconfig.json` and the real
   installed dependencies returned zero errors.** A genuine compile of the
   real codebase with this patch applied.

2. The five new `dist/*.js` files were produced by running this project's own
   `npx tsc -p tsconfig.json` against `src/*.ts` in this directory - **not
   hand-written as JavaScript** - and that compile also returned zero errors.

3. `python3 patch_login_ip_allowlist_dist.py` was run against the file
   `ssh mcm-new cat /var/www/prod/default-api/dist/controllers/AuthController.js`
   actually returned - the real, currently-running compiled file, pulled
   read-only (writes are what is blocked, not reads) - and
   **`node --check` on the result confirmed valid syntax**, with the three
   variables the inserted code reads (`clientIp`, `findUser`, `normalizedLoginEmail`)
   confirmed already in scope at that point by grepping their declarations
   earlier in the same compiled method.

## What is in this directory

| File | What it does |
|---|---|
| `src/lib/ip-allowlist.ts` | The matcher. A byte-for-byte port of the frontend's copy — see its own header. |
| `src/services/IpAllowlistService.ts` | Reads a company's allowlist (via the same `tenant-api` path every other admin screen already uses), makes the allow/deny decision, writes the durable audit row. |
| `src/models/CompanySecurityAuditLog.ts` + `request/ICompanySecurityAuditLogAttributes.ts` | The durable log — one row per sign-in decision the allowlist actually made, written by the server. Separate from the quick edit-history the browser already keeps inside the settings blob (see the model's own header for why both exist). |
| `src/middlewares/ipAllowlistFeatureFlag.ts` | The platform-wide kill switch — see **Rollout**. |
| `src/middlewares/IpAllowlistApiGuard.ts` | The same check, as Express middleware, for API-key traffic. **Not mounted anywhere by this patch** — see the file header for why that decision is left to an operator. |
| `migrations/20260902000000-sync-company-security-audit-log-table.js` | Sequelize migration, same `syncModelByTable` pattern every other migration in this repo already uses. |
| `patch_login_ip_allowlist.py` | Inserts the one call into `AuthController.login()`. Anchor-and-assert, same discipline as the `fs-xml-api` patches — refuses to run if its anchor text does not match exactly once. |
| `patch_login_ip_allowlist_dist.py` | The same insertion, into the COMPILED `dist/controllers/AuthController.js` — the one `apply-ip-allowlist.sh` actually uses. See "Why this is a dist patch, not a rebuild" below. |
| `patch_auth_middleware_ip_allowlist.py` / `_dist.py` | The SECOND enforcement point — `AuthMiddleware.ts`'s `auth()`, which runs on every authenticated request. This is what blocks a session that was already open when a block was added, not just a new sign-in. |
| `dist/` | The five new files, pre-compiled by this project's own `tsc` — drop-in ready, nothing to build on the server. |
| `env.example.addition` | The one new environment variable, with the same caveat as the Rollout section below. |

## Why this is a dist patch, not a rebuild

`apply-ip-allowlist.sh` and `patch_login_ip_allowlist_dist.py` edit the
COMPILED file that is already running, the same way this platform's two other
live-only fixes were applied (see `default-api-source-unrecoverable` and
`default-api-source-vs-production-drift` in project memory). Production's
`AuthController.js` carries a hand-applied fix - the trusted-device "Device
already verified" string - that exists nowhere in the TypeScript source
mirror, and other recent fixes exist only in that mirror's uncommitted working
tree. A normal `tsc` rebuild, run from anywhere except that exact tree at this
exact moment, would silently drop what is live today.

`patch_login_ip_allowlist.py` (the TypeScript version) is kept in this
directory too, and is the one to use once - and only once - a full rebuild is
happening anyway for some other reason, from that same working tree, with
those other fixes confirmed still present in the result before it ships.

## Where the one call goes

Right after `AuthController.login()` loads `findCompany` and confirms it
exists, and before the plan-status checks — the request has already survived
password verification at that point, so a network refusal and a wrong-password
refusal are never distinguishable from outside, and `findCompany.db_name` /
`findCompany.uuid` are already loaded by a query this patch does not duplicate.

```ts
if (ipAllowlistEnforcementEnabled()) {
    const allowlistResult = await checkIpAllowlist({
        dbName: findCompany.db_name,
        companyUuid: findCompany.uuid,
        clientIp,
        userUuid: findUser.uuid,
        emailAttempted: normalizedLoginEmail,
    });
    if (!allowlistResult.allowed) {
        return res.status(403).json({
            success: false,
            message: "Sign-in is not allowed from this network. Contact your admin if this is unexpected.",
            error: { code: "IP_NOT_ALLOWED" },
        });
    }
}
```

## Fail-open, deliberately, on every uncertain case

- Feature flag off → not enforced. Nothing changes for anyone until an
  operator turns it on.
- A company's `enabled` is not `true` → not enforced for that company, however
  the platform-wide flag is set.
- The tenant-api lookup fails, times out, or the row cannot be parsed →
  treated as "not enforced" for that request, not as "deny".
- The list is enabled but empty → treated as misconfigured and let through,
  not as "deny everyone" — this must never be reachable through the screen
  (it refuses to save that state), but the enforcement code does not trust the
  screen to have been the only writer.
- A pre-armed break-glass window is open → let through, regardless of the
  list.
- The audit write itself fails → the login decision already stands; a logging
  failure never becomes a login failure.

The one case that is NOT fail-open: an enabled list with entries, where the
caller's address matches none of them. That is the actual feature.

## Rollout

Two independent switches, and both must be on for anything to enforce:

1. **`IP_ALLOWLIST_ENFORCEMENT_ENABLED=true`** in `default-api`'s environment
   — the platform-wide readiness switch. Every company that has ever opened
   Company > Security already has an `ip_allowlist` block sitting in its
   settings (defaulted to `enabled: false`); without this flag, deploying the
   patch changes nothing for anyone. With it, every company that had already
   switched their own allowlist on starts being enforced simultaneously — so
   turn this on only once you are ready for that, not the moment the code
   ships.
2. **The company's own `enabled` flag**, set from Company > Security.

Recommended order:

```
1. Run the migration (creates company_security_audit_logs, no data risk).
2. Run apply-ip-allowlist.sh, which drops the five compiled dist/*.js files
   in place and patches the running AuthController.js directly — see "Why
   this is a dist patch, not a rebuild" below. Confirm logins are
   unaffected with the flag left unset — they will be, by construction,
   but confirm it anyway.
3. Ask one or two companies who have opted in to turn their own allowlist on,
   and turn on IP_ALLOWLIST_ENFORCEMENT_ENABLED. Watch
   company_security_audit_logs for ip_allowlist_denied rows from addresses
   that should be allowed - that is a misconfigured list, not a bug in this
   code, but it is the failure mode worth watching for first.
4. Wider rollout once step 3 has run clean for a few days.
```

## What this does not do

- **No PATCH/CRUD REST endpoints for the allowlist.** Reading and writing the
  list already goes through the existing `user/template` upsert every other
  company setting on this page uses — building a parallel single-purpose
  endpoint would mean two ways to write the same data disagreeing eventually.
  What this patch adds is the read used to ENFORCE it, which had no path at
  all before.
- **No attachment/geo-fencing/ASN-based rules.** CIDR only, matching what the
  screen offers.
- **The API-key guard is not mounted anywhere** — see
  `IpAllowlistApiGuard.ts`'s own header.
