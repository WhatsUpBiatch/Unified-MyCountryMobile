// campaign-api: the roster / agent / tier transforms for suspend, restore, remove.
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require(`${process.env.BUILD_DIR}/queueMembership.js`);

const NOW = new Date("2026-09-03T10:00:00.000Z");
const alice = { extension: "1001", name: "Alice", user_uuid: "u-alice", value: "u-alice", tier: 1 };
const bob = { extension: "1002", name: "Bob", user_uuid: "u-bob", value: "u-bob", tier: 2 };
const roster = [alice, bob];

test("suspend: marks only that person, keeps the seat, does not mutate the input", () => {
  const r = m.applyToMembers(roster, "u-alice", "suspend", NOW, "suspended");
  assert.equal(r.changed, 1);
  assert.equal(r.matched.length, 1);
  assert.equal(r.members.length, 2);
  assert.deepEqual(r.members[0].suspended_member, { at: "2026-09-03T10:00:00.000Z", reason: "suspended" });
  assert.equal(r.members[0].tier, 1, "the rest of the entry is kept");
  assert.equal(r.members[1].suspended_member, undefined);
  assert.equal(roster[0].suspended_member, undefined, "input untouched");
});

test("suspend twice: the first marker wins, nothing changes the second time", () => {
  const once = m.applyToMembers(roster, "u-alice", "suspend", NOW, "suspended").members;
  const twice = m.applyToMembers(once, "u-alice", "suspend", new Date("2026-09-04T00:00:00Z"), "removed");
  assert.equal(twice.changed, 0);
  assert.equal(twice.members[0].suspended_member.reason, "suspended");
});

test("restore: takes the marker off exactly; a person without one is left alone", () => {
  const marked = m.applyToMembers(roster, "u-alice", "suspend", NOW).members;
  const r = m.applyToMembers(marked, "u-alice", "restore", NOW);
  assert.equal(r.changed, 1);
  assert.deepEqual(r.members, roster, "back to the original roster, field for field");
  assert.equal(m.applyToMembers(roster, "u-bob", "restore", NOW).changed, 0);
});

test("remove: drops the entry", () => {
  const r = m.applyToMembers(roster, "u-bob", "remove", NOW);
  assert.equal(r.changed, 1);
  assert.deepEqual(r.members, [alice]);
});

test("matching: user_uuid or the older value field; strings and junk never match", () => {
  assert.equal(m.memberMatches({ value: "u-x" }, "u-x"), true);
  assert.equal(m.memberMatches({ user_uuid: "u-x" }, "u-x"), true);
  assert.equal(m.memberMatches("u-x", "u-x"), false);
  assert.equal(m.memberMatches({ user_uuid: "u-x" }, ""), false);
  assert.equal(m.applyToMembers("not a list", "u-x", "suspend", NOW).members.length, 0);
  assert.equal(m.applyToMembers(null, "u-x", "suspend", NOW).changed, 0);
});

test("agent row: suspend -> Logged Out + marker; restore -> marker off, status untouched; remove -> delete", () => {
  const s = m.agentUpdateFor("suspend", NOW, "suspended");
  assert.equal(s.$set.status, "Logged Out");
  assert.equal(s.$set.state, "Logged Out");
  assert.equal(s.$set.last_status_change, Math.floor(NOW.getTime() / 1000));
  assert.deepEqual(s.$set.suspended_member, { at: "2026-09-03T10:00:00.000Z", reason: "suspended" });
  assert.deepEqual(m.agentUpdateFor("restore", NOW), { $unset: { suspended_member: "" } });
  assert.equal(m.agentUpdateFor("remove", NOW), null);
});

test("tier row: marker on / off / delete", () => {
  assert.deepEqual(m.tierUpdateFor("suspend", NOW, "removed"), { $set: { suspended_member: { at: "2026-09-03T10:00:00.000Z", reason: "removed" } } });
  assert.deepEqual(m.tierUpdateFor("restore", NOW), { $unset: { suspended_member: "" } });
  assert.equal(m.tierUpdateFor("remove", NOW), null);
});

test("re-saving a queue from the website carries the marker over, so nobody is quietly un-suspended", () => {
  const existing = m.applyToMembers(roster, "u-alice", "suspend", NOW).members;
  const fromWebsite = [{ ...bob }, { ...alice, tier: 3 }]; // reordered, edited, no marker
  const carried = m.carryMarkers(existing, fromWebsite);
  assert.deepEqual(carried[1].suspended_member, existing[0].suspended_member);
  assert.equal(carried[1].tier, 3, "the website's edit is kept");
  assert.equal(carried[0].suspended_member, undefined);
  assert.deepEqual(m.carryMarkers(roster, fromWebsite), fromWebsite, "no markers, same list back");
  assert.deepEqual(m.carryMarkers(undefined, fromWebsite), fromWebsite);
});

test("rebuilt agent row starts Logged Out for a marked member, On Break otherwise", () => {
  assert.deepEqual(m.agentStatusForMember({ ...alice, suspended_member: { at: "x", reason: "y" } }), { status: "Logged Out", state: "Logged Out" });
  assert.deepEqual(m.agentStatusForMember(alice), { status: "On Break", state: "Idle" });
});

test("agent name is extension@domain", () => {
  assert.equal(m.agentName(1001, " acme.mycountrymobile.com "), "1001@acme.mycountrymobile.com");
});
