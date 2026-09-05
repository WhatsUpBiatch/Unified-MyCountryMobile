/* helpers/inviteToken.ts: token, hash, expiry, password rule, cooldown. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { createHash } = require("crypto");

const t = require(path.join(process.env.BUILD_DIR, "inviteToken.js"));

test("a fresh token is 32 random bytes as hex, and only its sha256 is stored", () => {
  const issued = t.issueInviteToken(new Date("2026-09-03T10:00:00Z"));
  assert.match(issued.token, /^[0-9a-f]{64}$/);
  assert.equal(issued.tokenHash, createHash("sha256").update(issued.token).digest("hex"));
  assert.notEqual(issued.tokenHash, issued.token);
  assert.equal(t.hashInviteToken(issued.token), issued.tokenHash);
});

test("two tokens never repeat", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(t.issueInviteToken().token);
  assert.equal(seen.size, 200);
});

test("sha256 matches a known vector", () => {
  assert.equal(
    t.hashInviteToken("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("token shape is checked before any lookup", () => {
  assert.equal(t.tokenLooksValid("a".repeat(64)), true);
  assert.equal(t.tokenLooksValid("A".repeat(64)), false);
  assert.equal(t.tokenLooksValid("a".repeat(63)), false);
  assert.equal(t.tokenLooksValid(""), false);
  assert.equal(t.tokenLooksValid(null), false);
  assert.equal(t.tokenLooksValid(42), false);
  assert.equal(t.tokenLooksValid({ length: 64 }), false);
});

test("the link lasts 72 hours from when it was made", () => {
  const now = new Date("2026-09-03T10:00:00Z");
  assert.equal(t.INVITE_TTL_HOURS, 72);
  assert.equal(t.inviteExpiry(now).toISOString(), "2026-09-06T10:00:00.000Z");
  const issued = t.issueInviteToken(now);
  assert.equal(issued.expiresAt.toISOString(), "2026-09-06T10:00:00.000Z");
});

test("expiry: one second before is fine, the moment itself is expired, garbage is expired", () => {
  const exp = new Date("2026-09-06T10:00:00Z");
  assert.equal(t.isInviteExpired(exp, new Date("2026-09-06T09:59:59Z")), false);
  assert.equal(t.isInviteExpired(exp, new Date("2026-09-06T10:00:00Z")), true);
  assert.equal(t.isInviteExpired(exp, new Date("2026-09-07T10:00:00Z")), true);
  assert.equal(t.isInviteExpired("2026-09-06 10:00:00", new Date("2026-09-06T09:00:00Z")), false);
  assert.equal(t.isInviteExpired(null), true);
  assert.equal(t.isInviteExpired("not a date"), true);
});

test("constant-time hash compare", () => {
  const a = t.hashInviteToken("x");
  assert.equal(t.hashesMatch(a, a), true);
  assert.equal(t.hashesMatch(a, t.hashInviteToken("y")), false);
  assert.equal(t.hashesMatch(a, a.slice(0, 10)), false);
  assert.equal(t.hashesMatch("", ""), false);
});

test("password rule: 12+ characters, not the e-mail, no edge spaces", () => {
  const email = "Sam.Jones@example.com";
  assert.equal(t.INVITE_MIN_PASSWORD_LENGTH, 12);
  assert.deepEqual(t.validateInvitePassword("correct horse", email), { ok: true });
  assert.equal(t.validateInvitePassword("elevenchars", email).ok, false);
  assert.equal(t.validateInvitePassword("twelve chars", email).ok, true);
  assert.equal(t.validateInvitePassword("sam.jones@example.com", email).ok, false);
  assert.equal(t.validateInvitePassword("SAM.JONES@EXAMPLE.COM", email).ok, false);
  assert.equal(t.validateInvitePassword(" padded password", email).ok, false);
  assert.equal(t.validateInvitePassword("", email).ok, false);
  assert.equal(t.validateInvitePassword(undefined, email).ok, false);
  assert.equal(t.validateInvitePassword(123456789012, email).ok, false);
  assert.equal(t.validateInvitePassword("twelve chars", null).ok, true);
  assert.match(t.validateInvitePassword("short", email).message, /12 characters/);
});

test("the throw-away password fits the create validator and is never the same twice", () => {
  const a = t.randomTemporaryPassword();
  const b = t.randomTemporaryPassword();
  assert.equal(a.length, 24);
  assert.ok(a.length >= 6 && a.length <= 30);
  assert.notEqual(a, b);
  assert.match(a, /[A-Z]/);
  assert.match(a, /[a-z]/);
  assert.match(a, /[0-9]/);
  assert.match(a, /[^A-Za-z0-9]/);
});

test("the link points at /accept-invite on the website, whatever the base looks like", () => {
  assert.equal(
    t.buildInviteLink("https://unified.mycountrymobile.com", "abc"),
    "https://unified.mycountrymobile.com/accept-invite?token=abc",
  );
  assert.equal(
    t.buildInviteLink("https://unified.mycountrymobile.com///", "abc"),
    "https://unified.mycountrymobile.com/accept-invite?token=abc",
  );
  assert.equal(t.buildInviteLink("http://x", "a b&c"), "http://x/accept-invite?token=a%20b%26c");
});

test("resend cooldown: 60 seconds per person", () => {
  const now = new Date("2026-09-03T10:01:00Z");
  assert.equal(t.RESEND_COOLDOWN_SECONDS, 60);
  assert.equal(t.resendWaitSeconds(null, now), 0);
  assert.equal(t.resendWaitSeconds(new Date("2026-09-03T10:00:00Z"), now), 0);
  assert.equal(t.resendWaitSeconds(new Date("2026-09-03T10:00:30Z"), now), 30);
  assert.equal(t.resendWaitSeconds(new Date("2026-09-03T10:00:59Z"), now), 59);
  assert.equal(t.resendWaitSeconds("garbage", now), 0);
});
