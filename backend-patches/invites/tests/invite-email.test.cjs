/* helpers/inviteEmail.ts: the e-mail body never carries a password. */
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

test("the body has the name, the inviter, the company, the link and the 3 days", () => {
  const html = e.buildInviteEmailHtml(input);
  assert.match(html, /Hello Sam Jones,/);
  assert.match(html, /Ada Admin has added you to Testers &amp; Co\./);
  assert.ok(html.includes('href="https://unified.mycountrymobile.com/accept-invite?token=abc123"'));
  assert.match(html, /works for 3 days/);
});

test("the body never contains a password, an extension or the e-mail address", () => {
  const html = e.buildInviteEmailHtml({ ...input, password: "Secret123!", email: "sam@example.com", extension: 1234 });
  assert.doesNotMatch(html, /password:/i);
  assert.doesNotMatch(html, /Secret123!/);
  assert.doesNotMatch(html, /sam@example\.com/);
  assert.doesNotMatch(html, /1234/);
  /* "password" appears only in the sentences about choosing one. */
  const mentions = html.match(/password/gi) || [];
  assert.ok(mentions.length >= 1);
  assert.doesNotMatch(html, /\{\{/);
});

test("html in names and links is escaped", () => {
  const html = e.buildInviteEmailHtml({
    ...input,
    name: '<img src=x onerror=alert(1)>',
    inviterName: null,
    link: 'https://x/accept-invite?token=a"onmouseover="evil',
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
  assert.doesNotMatch(html, /token=a"onmouseover/);
  assert.match(html, /token=a&quot;onmouseover/);
  assert.match(html, /You have been added to Testers &amp; Co\./);
});

test("one day reads as a day", () => {
  assert.match(e.buildInviteEmailHtml({ ...input, hours: 24 }), /works for 1 day\./);
  assert.match(e.buildInviteEmailHtml({ ...input, hours: 72 }), /works for 3 days\./);
});

test("the subject names the company, then the project, then nothing", () => {
  assert.equal(e.inviteEmailSubject("Testers & Co", "MCM"), "You have been invited to join Testers & Co");
  assert.equal(e.inviteEmailSubject("", "MCM"), "You have been invited to join MCM");
  assert.equal(e.inviteEmailSubject(null, null), "You have been invited");
});

test("the migration loads and is forward and backward", () => {
  const m = require(path.join(process.env.BUILD_DIR, "migration.js"));
  assert.equal(typeof m.up, "function");
  assert.equal(typeof m.down, "function");
});
