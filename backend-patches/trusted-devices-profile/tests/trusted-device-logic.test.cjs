"use strict";
/* API side: folding sessions and OTP trust rows into one device list, the
   revoke id grammar, and the two-step wording. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const L = require(path.join(process.env.BUILD_DIR, "trustedDeviceLogic.js"));

const NOW = new Date("2026-09-03T12:00:00.000Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const session = (over = {}) => ({
  uuid: "s-1",
  device_id: "dev-a",
  device_type: "W",
  ip_address: "203.0.113.5",
  user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  version: "1.2.9",
  created_at: daysAgo(10),
  updated_at: daysAgo(1),
  ...over,
});

test("describeUserAgent names the common browsers and platforms, and never returns empty", () => {
  assert.equal(L.describeUserAgent(session().user_agent), "Chrome on Windows");
  assert.equal(L.describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"), "Safari on Mac");
  assert.equal(L.describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0"), "Firefox on Linux");
  assert.equal(L.describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36 Edg/128.0"), "Edge on Windows");
  assert.equal(L.describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"), "Safari on iPhone or iPad");
  assert.equal(L.describeUserAgent(null, "A"), "Android app");
  assert.equal(L.describeUserAgent("", "I"), "iPhone app");
  assert.equal(L.describeUserAgent("okhttp/4.9", null), "okhttp/4.9");
  assert.equal(L.describeUserAgent(null, null), "Unknown device");
});

test("a signed-in device with a verified code inside the window is trusted, with an expiry", () => {
  const rows = L.mergeDevices([session()], [{ device_id: "dev-a", verified_at: daysAgo(5) }], {
    trustDays: 30,
    currentSessionUuid: "s-1",
    now: NOW,
  });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.id, "dev-a");
  assert.equal(r.signed_in, true);
  assert.equal(r.trusted, true);
  assert.equal(r.is_current, true);
  assert.equal(r.trusted_since, daysAgo(5));
  assert.equal(r.trusted_until, new Date(Date.parse(daysAgo(5)) + 30 * 86_400_000).toISOString());
  /* first_seen is the earliest of session start and the verified code. */
  assert.equal(r.first_seen, daysAgo(10));
});

test("a verified code outside the window does not make a device trusted", () => {
  const rows = L.mergeDevices([session()], [{ device_id: "dev-a", verified_at: daysAgo(31) }], {
    trustDays: 30,
    now: NOW,
  });
  assert.equal(rows[0].trusted, false);
  assert.equal(rows[0].trusted_until, null);
});

test("a trusted device with no session still appears, marked signed out", () => {
  const rows = L.mergeDevices([], [{ device_id: "dev-z", verified_at: daysAgo(2) }], { trustDays: 30, now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].signed_in, false);
  assert.equal(rows[0].trusted, true);
  assert.equal(rows[0].id, "dev-z");
});

test("a session without a device id gets a session: id and cannot be trusted", () => {
  const rows = L.mergeDevices([session({ uuid: "s-old", device_id: null })], [], { trustDays: 30, now: NOW });
  assert.equal(rows[0].id, "session:s-old");
  assert.equal(rows[0].device_id, null);
  assert.equal(rows[0].trusted, false);
});

test("two sessions for one device id collapse into one row, current first", () => {
  const rows = L.mergeDevices(
    [
      session({ uuid: "s-1", device_id: "dev-a", updated_at: daysAgo(3) }),
      session({ uuid: "s-2", device_id: "dev-a", updated_at: daysAgo(1), ip_address: "198.51.100.9" }),
      session({ uuid: "s-3", device_id: "dev-b", updated_at: daysAgo(0) }),
    ],
    [],
    { trustDays: 30, currentSessionUuid: "s-2", now: NOW },
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "dev-a");
  assert.equal(rows[0].is_current, true);
  assert.equal(rows[0].session_uuid, "s-2");
  assert.equal(rows[0].ip_address, "198.51.100.9");
  assert.equal(rows[1].id, "dev-b");
});

test("without a current session, rows sort by last seen, newest first", () => {
  const rows = L.mergeDevices(
    [session({ uuid: "a", device_id: "d1", updated_at: daysAgo(5) }), session({ uuid: "b", device_id: "d2", updated_at: daysAgo(1) })],
    [],
    { trustDays: 30, now: NOW },
  );
  assert.deepEqual(rows.map((r) => r.id), ["d2", "d1"]);
});

test("parseRevokeId tells devices from id-less sessions and rejects junk", () => {
  assert.deepEqual(L.parseRevokeId(" dev-a "), { kind: "device", deviceId: "dev-a" });
  assert.deepEqual(L.parseRevokeId("session:3f2b6b0e-1b6e-4b7e-9e2a-1a2b3c4d5e6f"), {
    kind: "session",
    sessionUuid: "3f2b6b0e-1b6e-4b7e-9e2a-1a2b3c4d5e6f",
  });
  assert.equal(L.parseRevokeId("").kind, "invalid");
  assert.equal(L.parseRevokeId(undefined).kind, "invalid");
  assert.equal(L.parseRevokeId("session:not-a-uuid").kind, "invalid");
  assert.equal(L.parseRevokeId("x".repeat(201)).kind, "invalid");
});

test("describeTwoStep is always enforced and carries the window and the address", () => {
  const s = L.describeTwoStep(30, "a@b.co");
  assert.equal(s.enforced, true);
  assert.equal(s.method, "email_code");
  assert.equal(s.trust_days, 30);
  assert.match(s.reason, /a@b\.co/);
  assert.match(s.reason, /30 days/);
  assert.match(L.describeTwoStep(7).reason, /emailed, unless/);
});

test("readTrustDays falls back to 30 on junk and honours a valid override", () => {
  assert.equal(L.readTrustDays(undefined), 30);
  assert.equal(L.readTrustDays(""), 30);
  assert.equal(L.readTrustDays("abc"), 30);
  assert.equal(L.readTrustDays("0"), 30);
  assert.equal(L.readTrustDays("14"), 14);
});

test("emailVariants covers the address as typed and lower-cased, once each", () => {
  assert.deepEqual(L.emailVariants("A@B.co"), ["A@B.co", "a@b.co"]);
  assert.deepEqual(L.emailVariants("a@b.co"), ["a@b.co"]);
  assert.deepEqual(L.emailVariants("  "), []);
  assert.deepEqual(L.emailVariants(null), []);
});
