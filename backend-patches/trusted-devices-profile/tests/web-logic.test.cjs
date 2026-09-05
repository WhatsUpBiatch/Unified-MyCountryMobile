"use strict";
/* Website side: which row is "This device", the wording per row, and the
   language list the Profile page may honestly offer. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const W = require(path.join(process.env.BUILD_DIR, "trusted-devices-logic.js"));
const Lang = require(path.join(process.env.BUILD_DIR, "interface-languages.js"));

const NOW = new Date("2026-09-03T12:00:00.000Z");
const iso = (daysFromNow) => new Date(NOW.getTime() + daysFromNow * 86_400_000).toISOString();

const row = (over = {}) => ({
  id: "dev-a",
  device_id: "dev-a",
  session_uuid: "s-1",
  label: "Chrome on Windows",
  device_type: "W",
  ip_address: null,
  user_agent: null,
  app_version: null,
  first_seen: iso(-10),
  last_seen: iso(-1),
  signed_in: true,
  trusted: false,
  trusted_since: null,
  trusted_until: null,
  is_current: false,
  ...over,
});

test("This device: matched by the browser's device id, by the session uuid, or by the server's flag", () => {
  assert.equal(W.isThisDevice(row(), { localDeviceId: "dev-a" }), true);
  assert.equal(W.isThisDevice(row(), { sessionUuid: "s-1" }), true);
  assert.equal(W.isThisDevice(row({ is_current: true }), {}), true);
  assert.equal(W.isThisDevice(row(), { localDeviceId: "dev-b", sessionUuid: "s-9" }), false);
  /* An empty local id must never match a row with an empty device id. */
  assert.equal(W.isThisDevice(row({ device_id: null, session_uuid: null }), { localDeviceId: "", sessionUuid: "" }), false);
});

test("sortDevices puts this device first, then newest last_seen", () => {
  const rows = [
    row({ id: "old", device_id: "old", session_uuid: "s-old", last_seen: iso(-9) }),
    row({ id: "new", device_id: "new", session_uuid: "s-new", last_seen: iso(-0.5) }),
    row({ id: "me", device_id: "me", session_uuid: "s-me", last_seen: iso(-30) }),
  ];
  assert.deepEqual(W.sortDevices(rows, { localDeviceId: "me" }).map((r) => r.id), ["me", "new", "old"]);
});

test("describeTrust says what the next sign-in will do", () => {
  assert.equal(W.describeTrust(row(), NOW), "Not trusted: asks for a code at sign-in.");
  assert.equal(W.describeTrust(row({ trusted: true, trusted_until: iso(12.2) }), NOW), "Trusted for 13 more days: skips the code at sign-in.");
  assert.equal(W.describeTrust(row({ trusted: true, trusted_until: iso(0.4) }), NOW), "Trusted for 1 more day: skips the code at sign-in.");
  assert.equal(W.describeTrust(row({ trusted: true, trusted_until: iso(-1) }), NOW), "Trust has run out: asks for a code at sign-in.");
  assert.equal(W.describeTrust(row({ trusted: true, trusted_until: null }), NOW), "Trusted: skips the code at sign-in.");
});

test("daysLeft rounds up and never goes negative", () => {
  assert.equal(W.daysLeft(iso(2.1), NOW), 3);
  assert.equal(W.daysLeft(iso(-5), NOW), 0);
  assert.equal(W.daysLeft(null, NOW), null);
  assert.equal(W.daysLeft("junk", NOW), null);
});

test("twoStepLabel is Active only when the server says enforced", () => {
  assert.equal(W.twoStepLabel({ enforced: true }), "Active");
  assert.equal(W.twoStepLabel({ enforced: false }), "Off");
  assert.equal(W.twoStepLabel(null), "Off");
});

test("normaliseDeviceList unwraps the API envelope and never yields a non-array", () => {
  const body = { data: { data: { message: "Success", result: { two_step: { enforced: true }, current_session_uuid: "s-1", devices: [row()] } } } };
  const list = W.normaliseDeviceList(body);
  assert.equal(list.devices.length, 1);
  assert.equal(list.current_session_uuid, "s-1");
  assert.equal(list.two_step.enforced, true);
  assert.deepEqual(W.normaliseDeviceList({}).devices, []);
  assert.deepEqual(W.normaliseDeviceList(null).devices, []);
  assert.equal(W.normaliseDeviceList({ result: { devices: "nope" } }).devices.length, 0);
});

test("countOtherDevices leaves this device out", () => {
  const rows = [row({ id: "a", device_id: "a" }), row({ id: "b", device_id: "b" }), row({ id: "c", device_id: "c" })];
  assert.equal(W.countOtherDevices(rows, { localDeviceId: "b" }), 2);
  assert.equal(W.countOtherDevices([], { localDeviceId: "b" }), 0);
});

test("the language list offers only what the console can show: English, no translations yet", () => {
  assert.deepEqual(Lang.INTERFACE_LANGUAGES, [{ value: "en", label: "English" }]);
  assert.equal(Lang.HAS_TRANSLATIONS, false);
  assert.equal(Lang.DEFAULT_INTERFACE_LANGUAGE, "en");
  assert.equal(Lang.isSupportedLanguage("en"), true);
  assert.equal(Lang.isSupportedLanguage("fr"), false);
  assert.deepEqual(Lang.languageOption("fr"), { value: "en", label: "English" });
  assert.deepEqual(Lang.languageOption(null), { value: "en", label: "English" });
});

test("pronouns are cleaned to the column's 40 characters and the placeholder shows the suggestions", () => {
  assert.equal(Lang.PRONOUNS_MAX, 40);
  assert.equal(Lang.cleanPronouns("  they /   them "), "they / them");
  assert.equal(Lang.cleanPronouns("x".repeat(50)).length, 40);
  assert.equal(Lang.cleanPronouns(null), "");
  assert.equal(Lang.PRONOUNS_PLACEHOLDER, "e.g. she/her, he/him, they/them");
});
