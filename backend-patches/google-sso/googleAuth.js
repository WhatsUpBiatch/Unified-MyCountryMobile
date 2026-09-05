/**
 * POST /api/auth/google   —  "Sign in with Google" for unified.mycountrymobile.com
 * ---------------------------------------------------------------------------
 * Drop this into default-api and register the route (see README-google-sso.md).
 * The Google ID-token verification is COMPLETE. The three places that touch YOUR
 * data model are marked  // >>> WIRE:  — plug in the SAME helpers /api/login uses.
 *
 * Contract with the frontend (already deployed):
 *   Request  body : { credential, device_type, device_id, version }
 *   Response body : return the EXACT SAME success payload your /api/login (or
 *                   verify-otp) returns — the web app reuses finishSignIn(), which
 *                   reads: token, email, payment_verified, free_did, company_uuid,
 *                   plan_uuid. Skip password + OTP; Google is the second factor.
 *
 * npm i google-auth-library
 */
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  '285675733526-2o55qj8ogir1d5qfl9jugpccmg4o96mb.apps.googleusercontent.com';

// JIT auto-create policy. Comma-separated allowed email domains, e.g.
// GOOGLE_SSO_ALLOWED_DOMAINS="mycountrymobile.com,acme.com"  ('*' = any domain).
const ALLOWED_DOMAINS = String(process.env.GOOGLE_SSO_ALLOWED_DOMAINS || 'mycountrymobile.com')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
const AUTO_CREATE = String(process.env.GOOGLE_SSO_AUTO_CREATE || 'true') === 'true';
const DEFAULT_ROLE = process.env.GOOGLE_SSO_DEFAULT_ROLE || 'agent';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function domainAllowed(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return ALLOWED_DOMAINS.includes('*') || ALLOWED_DOMAINS.includes(domain);
}

async function googleAuthHandler(req, res) {
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ success: false, message: 'Missing Google credential' });
    }

    // 1) Verify the Google ID token (signature, audience, expiry) — done for you.
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Invalid Google token' });
    }

    const email = (payload.email || '').toLowerCase();
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    if (!email || !emailVerified) {
      return res.status(401).json({ success: false, message: 'Google email not verified' });
    }

    // 2) Find the user by email.  >>> WIRE: use the SAME lookup /api/login uses.
    // let user = await findUserByEmail(email);
    let user = null; // <-- replace

    // 3) Just-in-time create if allowed.
    if (!user) {
      if (!AUTO_CREATE || !domainAllowed(email)) {
        return res.status(403).json({
          success: false,
          message: 'No account for this email. Contact your administrator.',
        });
      }
      // >>> WIRE: create the user in the correct tenant with DEFAULT_ROLE, e.g.
      // user = await createUserFromSso({
      //   email,
      //   name: payload.name,
      //   picture: payload.picture,
      //   role: DEFAULT_ROLE,
      //   company_uuid: /* decide tenant: single default, or map by email domain */,
      //   auth_provider: 'google',
      // });
      return res.status(501).json({
        success: false,
        message: 'JIT user creation not wired yet (see // >>> WIRE in googleAuth.js)',
      });
    }

    // 4) Issue the app JWT + build the login response.
    // >>> WIRE: reuse the EXACT token signing + payload builder /api/login returns
    // on success, so the frontend finishSignIn() routes identically.
    // const token = signAppJwt(user);
    // const responseBody = buildLoginSuccessPayload(user, token); // {result:{auth:{...}, token}}
    // return res.status(200).json(responseBody);

    return res.status(501).json({
      success: false,
      message: 'Token issuance not wired yet (see // >>> WIRE in googleAuth.js)',
    });
  } catch (err) {
    console.error('google-auth error', err);
    return res.status(500).json({ success: false, message: 'Google sign-in failed' });
  }
}

module.exports = { googleAuthHandler };
