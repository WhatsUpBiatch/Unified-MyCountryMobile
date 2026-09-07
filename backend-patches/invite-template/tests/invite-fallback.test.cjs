/* helpers/inviteEmail.ts: the template variables and the fallback decision. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const e = require(path.join(process.env.BUILD_DIR, "inviteEmail.js"));

const input = {
  name: "Sam Jones",
  inviterName: "Ada Admin",
  companyName: "Testers & Co",
  projectName: "MCM",
  link: "https://unified.mycountrymobile.com/accept-invite?token=abc123",
  hours: 72,
};

test("buildInviteTemplateData: exactly the five variables the template reads, raw (unescaped)", () => {
  const data = e.buildInviteTemplateData(input);
  assert.deepEqual(Object.keys(data).sort(), ["company_name", "invite_link", "inviter_name", "name", "ttl_days"]);
  assert.deepEqual(data, {
    name: "Sam Jones",
    inviter_name: "Ada Admin",
    company_name: "Testers & Co",
    invite_link: "https://unified.mycountrymobile.com/accept-invite?token=abc123",
    ttl_days: 3,
  });
});

test("buildInviteTemplateData: fallbacks - 'there', project name, 1 day, empty inviter", () => {
  const data = e.buildInviteTemplateData({ ...input, name: "  ", inviterName: null, companyName: "", hours: 24 });
  assert.equal(data.name, "there");
  assert.equal(data.inviter_name, "");
  assert.equal(data.company_name, "MCM");
  assert.equal(data.ttl_days, 1);
  assert.equal(e.buildInviteTemplateData({ ...input, hours: 36 }).ttl_days, 2);
  assert.equal(e.buildInviteTemplateData({ ...input, hours: 1 }).ttl_days, 1);
});

test("buildInviteTemplateData never carries a password, an extension or an e-mail address", () => {
  const data = e.buildInviteTemplateData({ ...input, password: "Secret123!", email: "sam@example.com", extension: 1234 });
  const json = JSON.stringify(data);
  assert.doesNotMatch(json, /Secret123!|sam@example\.com|1234|password|extension|email/);
});

test("the plain fallback body and the template data agree on the link and the days", () => {
  const data = e.buildInviteTemplateData(input);
  const html = e.buildInviteEmailHtml(input);
  assert.ok(html.includes(`href="${data.invite_link}"`));
  assert.match(html, new RegExp(`works for ${data.ttl_days} days`));
});

/* What SmsController.sendNotification returns is notification-api's
   data.result: an array of { channel, result }. */
test("inviteEmailWent: a 2xx e-mail result means it went (SMTP number, SendGrid string)", () => {
  assert.equal(e.inviteEmailWent([{ channel: "email", result: { status: 200, body: "250 OK" } }]), true);
  assert.equal(e.inviteEmailWent([{ channel: "email", result: { status: "202", body: "" } }]), true);
  assert.equal(e.inviteEmailWent([{ channel: "socket", result: {} }, { channel: "email", result: { status: 200 } }]), true);
});

test("inviteEmailWent: `false` is what a build without the template answers - fall back", () => {
  assert.equal(e.inviteEmailWent([{ channel: "email", result: false }]), false);
});

test("inviteEmailWent: no answer, no e-mail channel, or a bad status - fall back", () => {
  assert.equal(e.inviteEmailWent(undefined), false);
  assert.equal(e.inviteEmailWent(null), false);
  assert.equal(e.inviteEmailWent([]), false);
  assert.equal(e.inviteEmailWent({}), false);
  assert.equal(e.inviteEmailWent("ok"), false);
  assert.equal(e.inviteEmailWent([{ channel: "socket", result: { status: 200 } }]), false);
  assert.equal(e.inviteEmailWent([{ channel: "email", result: { status: 500, body: "boom" } }]), false);
  assert.equal(e.inviteEmailWent([{ channel: "email", result: { status: "nope" } }]), false);
  assert.equal(e.inviteEmailWent([{ channel: "email", result: true }]), false);
  assert.equal(e.inviteEmailWent([{ channel: "email" }]), false);
  assert.equal(e.inviteEmailWent([null, { channel: "email", result: false }]), false);
});

test("INVITE_TEMPLATE_NAME is the body notification-api maps to inviteLink.html", () => {
  assert.equal(e.INVITE_TEMPLATE_NAME, "INVITE_LINK");
});
