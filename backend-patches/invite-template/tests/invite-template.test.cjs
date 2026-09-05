/* notification-api src/templates/ucaas/inviteLink.html, rendered the way
   notification-api renders it (Handlebars, EmailService.compileTemplate), with
   the variables default-api sends (helpers/inviteEmail.ts buildInviteTemplateData)
   plus the ones SmsController.sendNotification adds to every mail. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const handlebars = require(process.env.HANDLEBARS_DIR);
const e = require(path.join(process.env.BUILD_DIR, "inviteEmail.js"));
const templatesDir = process.env.TEMPLATES_DIR;

/* notification-api CommonHelper.toCamelCase, verbatim: how `body` becomes a file name. */
const toCamelCase = (str) =>
  str.toLowerCase().split("_").map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");

const render = (file, data) => {
  const source = fs.readFileSync(path.join(templatesDir, file), "utf-8");
  return handlebars.compile(source)(data);
};

/* What SmsController.sendNotification merges in for every mail (a subset). It
   spreads the caller's data first, then sets company_name from the company row. */
const branding = {
  to_email: "sam@example.com",
  logo_url: "https://cdn.example.com/logo.png",
  website_url: "https://unified.mycountrymobile.com",
  year: 2026,
  project_name: "MCM",
  copyrights: "MCM",
  address: "1 Main St",
  location: "United States",
  support_email: "support@example.com",
  primary_color: "#1d6fe8",
  secondary_color: "#ffffff",
  requested_ip: "203.0.113.9",
  ip_geolocation: "Somewhere",
};

const input = {
  name: "Sam Jones",
  inviterName: "Ada Admin",
  companyName: "Testers & Co",
  projectName: "MCM",
  link: "https://unified.mycountrymobile.com/accept-invite?token=abc123",
  hours: 72,
};

const decodeEntities = (s) =>
  s.replace(/&#x3D;/g, "=").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#x60;/g, "`").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("the template name INVITE_LINK maps to a file that exists", () => {
  assert.equal(e.INVITE_TEMPLATE_NAME, "INVITE_LINK");
  const file = `${toCamelCase(e.INVITE_TEMPLATE_NAME)}.html`;
  assert.equal(file, "inviteLink.html");
  assert.ok(fs.existsSync(path.join(templatesDir, file)), `${file} missing in ${templatesDir}`);
});

test("the template compiles and renders name, inviter, company, button, link (twice) and the 3 days", () => {
  const html = render("inviteLink.html", { ...e.buildInviteTemplateData(input), ...branding, company_name: "Testers & Co" });
  assert.match(html, /Hello Sam Jones,/);
  assert.match(html, /Ada Admin has added you to Testers &amp; Co\./);
  assert.match(html, /Choose your password/);
  assert.match(html, /This link works for\s+<span[^>]*>3\s+days<\/span>/);
  const decoded = decodeEntities(html);
  const hrefs = decoded.match(/href="https:\/\/unified\.mycountrymobile\.com\/accept-invite\?token=abc123"/g) || [];
  assert.equal(hrefs.length, 2, "button + text link");
  assert.ok(decoded.includes(">https://unified.mycountrymobile.com/accept-invite?token=abc123</a>"), "the link is shown as text");
  assert.match(html, /<title>Choose your password - MCM<\/title>/);
  /* the branding the forgot-password template also carries */
  assert.match(html, /src="https:\/\/cdn\.example\.com\/logo\.png"/);
  assert.match(html, /support@example\.com/);
  assert.match(html, /&copy; 2026 MCM\. All rights reserved\./);
  assert.match(html, /background-color: #1d6fe8/);
  assert.doesNotMatch(html, /\{\{/);
});

test("no inviter: 'You have been added to <company>'", () => {
  const html = render("inviteLink.html", { ...e.buildInviteTemplateData({ ...input, inviterName: null }), ...branding, company_name: "Testers & Co" });
  assert.match(html, /You have been added to Testers &amp; Co\./);
  assert.doesNotMatch(html, /has added you/);
});

test("SmsController overrides company_name from the company row; when that is empty the project name is used", () => {
  const html = render("inviteLink.html", { ...e.buildInviteTemplateData(input), ...branding, company_name: null });
  assert.match(html, /Ada Admin has added you to MCM\./);
});

test("html in the name, the inviter, the company and the link is escaped", () => {
  const html = render("inviteLink.html", {
    ...e.buildInviteTemplateData({
      ...input,
      name: '<img src=x onerror=alert(1)>',
      inviterName: 'Eve "<b>" & Co',
      link: 'https://x/accept-invite?token=a"onmouseover="evil',
    }),
    ...branding,
    company_name: "<script>alert(2)</script>",
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Hello &lt;img src&#x3D;x onerror&#x3D;alert\(1\)&gt;,/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(html, /Eve &quot;&lt;b&gt;&quot; &amp; Co has added you to/);
  assert.doesNotMatch(html, /token=a"onmouseover/);
  assert.match(html, /token&#x3D;a&quot;onmouseover&#x3D;&quot;evil/);
});

test("the rendered mail never carries a password, an extension or the e-mail address", () => {
  const html = render("inviteLink.html", {
    ...e.buildInviteTemplateData(input),
    ...branding,
    company_name: "Testers & Co",
    /* even if a caller leaked these into `data`, the template never prints them */
    password: "Secret123!",
    email: "sam@example.com",
    extension: 1234,
  });
  assert.doesNotMatch(html, /Secret123!/);
  assert.doesNotMatch(html, /sam@example\.com/);
  assert.doesNotMatch(html, /1234/);
  assert.doesNotMatch(html, /Password:/);
  assert.doesNotMatch(html, /Account Details/);
  /* "password" appears only in the sentences about choosing one */
  const mentions = html.match(/password/gi) || [];
  assert.ok(mentions.length >= 2);
});

test("a missing branding variable renders empty, never a literal placeholder", () => {
  const html = render("inviteLink.html", { ...e.buildInviteTemplateData(input), company_name: "Testers & Co" });
  assert.doesNotMatch(html, /\{\{/);
  assert.match(html, /Hello Sam Jones,/);
});

test("ADD_MEMBER_NOTIFICATION no longer prints the password, even when one is passed", () => {
  assert.equal(`${toCamelCase("ADD_MEMBER_NOTIFICATION")}.html`, "addMemberNotification.html");
  const source = fs.readFileSync(path.join(templatesDir, "addMemberNotification.html"), "utf-8");
  assert.doesNotMatch(source, /\{\{\s*password\s*\}\}/);
  const html = render("addMemberNotification.html", {
    ...branding,
    name: "Sam Jones",
    email: "sam@example.com",
    password: "Secret123!",
    login_url: "https://unified.mycountrymobile.com",
  });
  assert.doesNotMatch(html, /Secret123!/);
  assert.match(html, /choose your own password using the invite link/);
  assert.match(html, /sam@example\.com/);
  assert.match(html, /href="https:\/\/unified\.mycountrymobile\.com"/);
  assert.doesNotMatch(html, /\{\{/);
});

test("the forgot-password template still renders (the layout the invite copies)", () => {
  const html = render("forgotPasswordNotification.html", { ...branding, name: "Sam", forgot_password_link: "https://x/reset?token=1" });
  assert.match(html, /Hello Sam,/);
  assert.doesNotMatch(html, /\{\{/);
});
