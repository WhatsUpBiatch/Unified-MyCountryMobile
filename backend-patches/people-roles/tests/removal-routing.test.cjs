"use strict";
/* Removing one target from routing, and the 72-hour window. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const r = require(path.join(process.env.BUILD_DIR, "removalRouting.js"));

const numberRouting = () => ({
  condition: {
    operational_hours: {
      regional: { timezone: { value: "Europe/London" } },
      type: "custom",
      holidays: [
        { name: "Xmas", type: "EXTENSION", value: "1001" },
        { name: "Easter", type: "EXTENSION", value: "1002" },
      ],
      closed_hour_action: { type: "VOICEMAIL", value: "1001", personal: true, type_label: "Send to Voicemail", value_label: "Alice" },
    },
    recording: { enabled: true },
    display_number: { incoming: { value: true } },
    caller_id: "",
  },
  call_handling: {
    business_hours: {
      type: "EXTENSION",
      value: 1001,
      label: "Alice",
      name: "Alice",
      missed_call_action: { type: "VOICEMAIL", value: "1001", personal: true },
    },
    closed_hours: { type: "EXTENSION", value: "1001" },
  },
  media: { welcome: { enabled: true, value: "w.mp3" }, hold: { enabled: false, value: "" }, voicemail: { enabled: true, value: "" } },
});

test("number: only the removed extension's slots are emptied; everything else stays", () => {
  const out = r.stripExtensionFromNumberRouting(numberRouting(), 1001);
  assert.equal(out.changed, true);
  assert.deepEqual(out.cleared.sort(), [
    "call_handling.business_hours",
    "call_handling.business_hours.missed_call_action",
    "call_handling.closed_hours",
    "condition.operational_hours.closed_hour_action",
    "condition.operational_hours.holidays[0]",
  ].sort());
  const v = out.value;
  assert.equal(v.call_handling.business_hours.type, "");
  assert.equal(v.call_handling.business_hours.value, "");
  assert.equal(v.call_handling.business_hours.missed_call_action, undefined);
  assert.equal(v.call_handling.closed_hours, undefined);
  assert.equal(v.condition.operational_hours.closed_hour_action.value, "");
  assert.equal(v.condition.operational_hours.closed_hour_action.personal, false);
  assert.equal(v.condition.operational_hours.holidays[0].value, "");
  // untouched
  assert.equal(v.condition.operational_hours.holidays[1].value, "1002");
  assert.deepEqual(v.condition.recording, { enabled: true });
  assert.equal(v.media.welcome.value, "w.mp3");
  assert.equal(v.condition.operational_hours.regional.timezone.value, "Europe/London");
});

test("number: a different extension changes nothing", () => {
  const out = r.stripExtensionFromNumberRouting(numberRouting(), "1002");
  assert.equal(out.changed, true); // holiday[1] is 1002
  assert.deepEqual(out.cleared, ["condition.operational_hours.holidays[1]"]);
  const none = r.stripExtensionFromNumberRouting(numberRouting(), "9999");
  assert.equal(none.changed, false);
  assert.deepEqual(none.cleared, []);
});

test("number: accepts the stored JSON string and refuses garbage", () => {
  const out = r.stripExtensionFromNumberRouting(JSON.stringify(numberRouting()), "1001");
  assert.equal(out.changed, true);
  assert.equal(r.stripExtensionFromNumberRouting("not json", "1001").changed, false);
  assert.equal(r.stripExtensionFromNumberRouting(null, "1001").value, null);
  assert.equal(r.stripExtensionFromNumberRouting(numberRouting(), "").changed, false);
});

test("number: a queue or IVR target is never mistaken for the extension", () => {
  const routing = numberRouting();
  routing.call_handling.business_hours = { type: "QUEUE", value: "q-1001-uuid", label: "Support" };
  const out = r.stripExtensionFromNumberRouting(routing, "1001");
  assert.equal(out.value.call_handling.business_hours.type, "QUEUE");
});

const personForwarding = (own) => ({
  forward_calls: { enabled: true, type: "EXTENSION", value: "1001", name: "Alice", value_label: "1001" },
  dnd: false,
  incoming_calls: {
    type: "simultaneously",
    enabled: true,
    device_options: [
      { type: "web", value: String(own), name: "Bob" },
      { type: "mobile", value: String(own), name: "Bob" },
      { type: "extension", value: "1001", name: "Alice" },
    ],
    failure_action: { type: "EXTENSION", value: "1001", name: "Alice", enabled: true },
    closed_hour_action: { type: "EXTENSION", value: "1001", name: "Alice", enabled: true },
  },
  outgoing_calls: { default_caller_id: "+441234" },
});

test("colleague: the removed extension is taken out and never replaced by the admin", () => {
  const bob = { extension: 2002, first_name: "Bob", last_name: "Jones" };
  const out = r.stripExtensionFromPersonForwarding(personForwarding(2002), "1001", bob);
  assert.equal(out.changed, true);
  assert.deepEqual(out.cleared.sort(), [
    "forward_calls",
    "incoming_calls.closed_hour_action",
    "incoming_calls.device_options",
    "incoming_calls.failure_action",
  ].sort());
  const v = out.value;
  assert.equal(v.forward_calls.enabled, false);
  assert.equal(v.forward_calls.value, "");
  assert.equal(v.incoming_calls.device_options.length, 2);
  assert.ok(v.incoming_calls.device_options.every((d) => d.value === "2002"));
  // no-answer and closed-hours fall back to Bob's OWN mailbox
  assert.equal(v.incoming_calls.failure_action.type, "VOICEMAIL");
  assert.equal(v.incoming_calls.failure_action.value, "2002");
  assert.equal(v.incoming_calls.failure_action.name, "Bob Jones");
  assert.equal(v.incoming_calls.closed_hour_action.value, "2002");
  assert.equal(v.incoming_calls.closed_hour_action.personal, true);
  // untouched
  assert.equal(v.outgoing_calls.default_caller_id, "+441234");
  assert.equal(v.incoming_calls.type, "simultaneously");
  assert.equal(JSON.stringify(v).includes('"1001"'), false, "no trace of the removed extension remains");
});

test("colleague: a record's own extension is never treated as the removed one", () => {
  const alice = { extension: 1001, first_name: "Alice", last_name: "A" };
  const out = r.stripExtensionFromPersonForwarding(personForwarding(1001), "1001", alice);
  assert.equal(out.changed, false);
});

test("colleague: numeric values match string extensions and vice versa", () => {
  const cf = personForwarding(2002);
  cf.forward_calls.value = 1001;
  const out = r.stripExtensionFromPersonForwarding(cf, 1001, { extension: "2002" });
  assert.ok(out.cleared.includes("forward_calls"));
});

test("tombstone frees the e-mail, fits the column, and is unique per row", () => {
  const long = "a".repeat(55) + "@x.io";
  const t1 = r.tombstoneEmail(long, "3f2b6b0e-1b6e-4b7e-9e2a-1a2b3c4d5e6f");
  const t2 = r.tombstoneEmail(long, "3f2b6b0e-1b6e-4b7e-9e2a-ffffffffffff");
  assert.ok(t1.length <= 60);
  assert.ok(t1.startsWith("deleted+3f2b6b0e1b6e+"));
  assert.equal(t1, t2, "same uuid prefix collides only when the first 12 hex chars match");
  const t3 = r.tombstoneEmail(long, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.notEqual(t1, t3);
  assert.equal(r.isTombstonedEmail(t1), true);
  assert.equal(r.isTombstonedEmail("bob@x.io"), false);
});

test("72-hour window", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  assert.equal(r.RESTORE_WINDOW_HOURS, 72);
  assert.equal(r.isWithinRestoreWindow(new Date("2026-09-01T12:00:01Z"), now), true);
  assert.equal(r.isWithinRestoreWindow(new Date("2026-08-31T11:59:59Z"), now), false);
  assert.equal(r.isWithinRestoreWindow(null, now), false);
  assert.equal(r.isWithinRestoreWindow("garbage", now), false);
  assert.equal(r.restoreDeadline(new Date("2026-09-01T00:00:00Z")).toISOString(), "2026-09-04T00:00:00.000Z");
});
