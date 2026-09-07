# Google SSO — backend patch (default-api)

The **frontend is already built and deployed** to `unified.mycountrymobile.com`:
a "Sign in with Google" button on the login page sends `{ credential, device_type,
device_id, version }` to `POST /api/auth/google` and then reuses the existing
`finishSignIn()` path. Only the backend endpoint remains.

## 1. Install
```bash
cd /var/www/prod/default-api      # adjust to your default-api path
npm i google-auth-library
```

## 2. Add the handler
Copy `googleAuth.js` into default-api (e.g. `controllers/` or `routes/`).

## 3. Register the route
Wherever `/api/login` is registered, add:
```js
const { googleAuthHandler } = require('./googleAuth'); // adjust path
app.post('/api/auth/google', googleAuthHandler);
```

## 4. Wire the 3 hooks in googleAuth.js  (marked `// >>> WIRE:`)
Reuse the SAME helpers `/api/login` already uses:
1. **Find user by email** — your existing user lookup.
2. **JIT create** (only if no user) — create in the right tenant with the default
   role. Decide the tenant: a single default company, or map by email domain.
3. **Issue JWT + response** — reuse the exact token signing and the success payload
   builder `/api/login` (or verify-otp) returns, so the web app routes identically.
   The response must contain, somewhere the frontend can find them: `token`, and an
   `auth`/result object with `email`, `payment_verified`, `free_did`, `company_uuid`,
   `plan_uuid`.

## 5. Environment
```
GOOGLE_CLIENT_ID=285675733526-2o55qj8ogir1d5qfl9jugpccmg4o96mb.apps.googleusercontent.com
GOOGLE_SSO_ALLOWED_DOMAINS=mycountrymobile.com      # comma-separated; '*' = any
GOOGLE_SSO_AUTO_CREATE=true
GOOGLE_SSO_DEFAULT_ROLE=agent
```

## 6. Restart
```bash
pm2 restart default-api
```

## Notes
- **No client secret is used** — the ID-token flow verifies against Google's public
  keys with the Client ID as audience. (You can rotate the `GOCSPX-…` secret; it is
  not needed here.)
- Google is treated as the second factor, so the password + OTP steps are skipped.
- Security: the handler rejects unverified emails and (for new users) any email
  whose domain is not in `GOOGLE_SSO_ALLOWED_DOMAINS`.
- The authorized JavaScript origin `https://unified.mycountrymobile.com` must be set
  on the Google OAuth client (done on your end).
