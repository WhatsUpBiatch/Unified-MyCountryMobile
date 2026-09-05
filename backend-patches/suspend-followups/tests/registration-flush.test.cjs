// esl-manager: building the flush commands from what the switch reports.
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require(`${process.env.BUILD_DIR}/registrationFlush.js`);

const LISTING = `Registrations:
=================================================================================================
Call-ID:    a1b2c3-webrtc
User:       1000_web@1757576519531.mycountrymobile.com
Contact:    "" <sip:1000_web@10.0.0.5:51234;transport=wss;rtcweb-breaker=no>
Agent:      MCM Web 1.2
Status:     Registered(WSS)(unknown) EXP(2026-09-03 12:00:00) EXPSECS(3400)
Ping-Status: Reachable
Host:       mcm-new
IP:         203.0.113.9
Port:       51234
Auth-User:  1000_web
Auth-Realm: 1757576519531.mycountrymobile.com
MWI-Account: 1000_web@1757576519531.mycountrymobile.com

Call-ID:    d4e5f6-desk
User:       1000@1757576519531.mycountrymobile.com
Contact:    "Desk" <sip:1000@198.51.100.7:5060;transport=udp>
Agent:      Yealink SIP-T46S
Status:     Registered(UDP)(unknown) EXP(2026-09-03 12:30:00) EXPSECS(1800)

Total items returned: 2
=================================================================================================
`;

test("candidate users: the extension and its browser phone", () => {
  assert.deepEqual(m.candidateUsers("1000"), ["1000", "1000_web"]);
  assert.deepEqual(m.candidateUsers(1000), ["1000", "1000_web"]);
  assert.deepEqual(m.candidateUsers(" 1000 "), ["1000", "1000_web"]);
  assert.deepEqual(m.candidateUsers(""), []);
  assert.deepEqual(m.candidateUsers("10 00; sofia"), [], "shell-ish input is refused");
});

test("parse: two registrations, every field", () => {
  const regs = m.parseRegistrations(LISTING);
  assert.equal(regs.length, 2);
  assert.equal(regs[0].callId, "a1b2c3-webrtc");
  assert.equal(regs[0].user, "1000_web@1757576519531.mycountrymobile.com");
  assert.match(regs[0].contact, /transport=wss/);
  assert.equal(regs[0].agent, "MCM Web 1.2");
  assert.equal(regs[1].callId, "d4e5f6-desk");
  assert.equal(regs[1].agent, "Yealink SIP-T46S");
});

test("parse: nothing registered, an error, garbage", () => {
  assert.deepEqual(m.parseRegistrations("Registrations:\n=====\nTotal items returned: 0\n"), []);
  assert.deepEqual(m.parseRegistrations("-ERR no such profile"), []);
  assert.deepEqual(m.parseRegistrations(""), []);
  assert.deepEqual(m.parseRegistrations("User: 1000@x\nContact: y\n"), [], "a block with no Call-ID is not a registration");
});

test("plan: the two standard names are always flushed, on the internal profile", () => {
  const plan = m.planFlush("1000", "1757576519531.mycountrymobile.com", "internal");
  assert.deepEqual(plan.users, ["1000", "1000_web"]);
  assert.deepEqual(plan.commands, [
    { command: "sofia", arg: "profile internal flush_inbound_reg 1000@1757576519531.mycountrymobile.com" },
    { command: "sofia", arg: "profile internal flush_inbound_reg 1000_web@1757576519531.mycountrymobile.com" },
  ]);
});

test("plan: an extra registered variant of the extension is flushed too; other extensions are not", () => {
  const listed = m.parseRegistrations(LISTING).concat([
    { callId: "x", user: "1000_mobile@1757576519531.mycountrymobile.com", contact: "", agent: "", status: "" },
    { callId: "y", user: "10001@1757576519531.mycountrymobile.com", contact: "", agent: "", status: "" },
    { callId: "z", user: "2000_web@1757576519531.mycountrymobile.com", contact: "", agent: "", status: "" },
  ]);
  const plan = m.planFlush("1000", "1757576519531.mycountrymobile.com", "internal", listed);
  assert.deepEqual(plan.users, ["1000", "1000_web", "1000_mobile"]);
  assert.equal(plan.commands.length, 3);
});

test("plan: unsafe domain or profile is refused, domain is lower-cased", () => {
  assert.equal(m.planFlush("1000", "x.com; reboot", "internal"), null);
  assert.equal(m.planFlush("1000", "x.com", "internal flush_inbound_reg"), null);
  assert.equal(m.planFlush("", "x.com", "internal"), null);
  assert.equal(m.planFlush("1000", "X.MyCountryMobile.com", "internal").domain, "x.mycountrymobile.com");
});

test("listing command and the switch's answer", () => {
  assert.equal(m.listArg("internal", "1000_web", "x.com"), "status profile internal reg 1000_web@x.com");
  assert.equal(m.flushSucceeded("+OK flushing all registrations matching specified call_id\n"), true);
  assert.equal(m.flushSucceeded("-ERR Invalid Profile"), false);
  assert.equal(m.flushSucceeded(""), false);
});
