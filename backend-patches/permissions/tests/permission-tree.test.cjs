"use strict";
/* The tree reader, one case per rule in README.md. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const p = require(path.join(process.env.BUILD_DIR, "permissionTree.js"));

const PEOPLE_EDIT = "account_setting.access.USER.action.edit";
const PEOPLE_DELETE = "account_setting.access.USER.action.delete";
const LISTEN = "reports.action.call_recording_listen";

/* The shape the website saves: { plan_features: { module: { access|action } } } */
const customTree = {
  plan_features: {
    account_setting: {
      access: { USER: { IS_SHOW: true, action: { view: true, add: false, edit: true, delete: false } } },
    },
    reports: { action: { call: true, sms: false, call_recording_listen: false } },
    phone_system_action: { access: { IVR: true }, action: { view: true, add: true, edit: true } },
  },
};

const t = (tree) => p.unwrapPlanFeatures(tree);

test("unwrapPlanFeatures: string JSON, double plan_features, and the whisper alias", () => {
  const doubled = { plan_features: customTree };
  assert.equal(p.readPermission(t(doubled), PEOPLE_EDIT), true);
  assert.equal(p.readPermission(t(JSON.stringify(customTree)), PEOPLE_EDIT), true);
  const old = { plan_features: { monitoring_features: { action: { wishper: true } } } };
  assert.equal(p.readPermission(t(old), "monitoring_features.action.whisper"), true);
  assert.deepEqual(t(null), {});
  assert.deepEqual(t("not json"), {});
});

test("readPermission walks the dotted path and only trusts a boolean-ish leaf", () => {
  const tree = t(customTree);
  assert.equal(p.readPermission(tree, PEOPLE_EDIT), true);
  assert.equal(p.readPermission(tree, PEOPLE_DELETE), false);
  assert.equal(p.readPermission(tree, "account_setting.access.USER.action.nope"), undefined);
  assert.equal(p.readPermission(tree, "account_setting.access.USER"), undefined, "an object is not a permission");
  assert.equal(p.readPermission(tree, "account_setting.access.user.action.edit"), undefined, "case matters, as on the website");
  assert.equal(p.readPermission(t({ plan_features: { x: { action: { y: 1 } } } }), "x.action.y"), true);
  assert.equal(p.readPermission(t({ plan_features: { x: { action: { y: "false" } } } }), "x.action.y"), false);
  assert.equal(p.readPermission(null, PEOPLE_EDIT), undefined);
  assert.equal(p.readPermission(tree, ""), undefined);
});

test("the account owner passes everything, tree or no tree", () => {
  assert.deepEqual(p.evaluatePermission({ systemRole: "ADMIN", tree: null, key: PEOPLE_DELETE }), { ok: true, reason: "owner" });
  assert.deepEqual(p.evaluatePermission({ systemRole: "ADMIN", tree: t(customTree), key: PEOPLE_DELETE }), { ok: true, reason: "owner" });
});

test("a custom role: key true passes, key false refuses", () => {
  const tree = t(customTree);
  assert.deepEqual(p.evaluatePermission({ systemRole: "MANAGER", tree, key: PEOPLE_EDIT }), { ok: true, reason: "granted" });
  const r = p.evaluatePermission({ systemRole: "MANAGER", tree, key: PEOPLE_DELETE });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "refused");
  assert.equal(r.message, p.DENY_MESSAGES.refused);
  const listen = p.evaluatePermission({ systemRole: "AGENT", tree, key: LISTEN });
  assert.equal(listen.ok, false);
  assert.equal(listen.reason, "refused");
});

test("a missing key is not permission", () => {
  const r = p.evaluatePermission({ systemRole: "MANAGER", tree: t(customTree), key: "reports.action.call_recording_delete" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing");
});

test("a role with no tree at all is refused", () => {
  const r = p.evaluatePermission({ systemRole: "AGENT", tree: null, key: PEOPLE_EDIT });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_tree");
  const r2 = p.evaluatePermission({ systemRole: "AGENT", tree: {}, key: PEOPLE_EDIT });
  assert.equal(r2.reason, "no_tree");
});

test("an unknown / unresolvable role is refused (fail closed)", () => {
  const r = p.evaluatePermission({ systemRole: null, tree: null, key: PEOPLE_EDIT });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unresolved_role");
  assert.equal(r.message, p.DENY_MESSAGES.unresolved_role);
  /* ...unless a custom tree exists for it: then the tree decides. */
  assert.equal(p.evaluatePermission({ systemRole: null, tree: t(customTree), key: PEOPLE_EDIT }).ok, true);
  assert.equal(p.evaluatePermission({ systemRole: null, tree: t(customTree), key: PEOPLE_DELETE }).ok, false);
});

test("default tree fallback: the first non-empty candidate wins, in order", () => {
  const planTree = { plan_features: { account_setting: { access: { USER: { action: { edit: false } } } } } };
  const defaultTree = { plan_features: { account_setting: { access: { USER: { action: { edit: true } } } } } };

  /* System role with a seeded row for the company's plan: that row. */
  let chosen = p.selectTree([
    { source: "plan_role_feature", tree: planTree },
    { source: "system_role", tree: null },
    { source: "user", tree: null },
    { source: "default_plan", tree: defaultTree },
  ]);
  assert.equal(chosen.source, "plan_role_feature");
  assert.equal(p.readPermission(chosen.tree, PEOPLE_EDIT), false);

  /* No stored tree for the role: the platform default for that role. */
  chosen = p.selectTree([
    { source: "plan_role_feature", tree: null },
    { source: "system_role", tree: "{}" },
    { source: "user", tree: {} },
    { source: "default_plan", tree: defaultTree },
  ]);
  assert.equal(chosen.source, "default_plan");
  assert.equal(p.readPermission(chosen.tree, PEOPLE_EDIT), true);

  /* A custom role's own tree beats everything after it. */
  chosen = p.selectTree([
    { source: "custom_role", tree: customTree },
    { source: "plan_role_feature", tree: planTree },
  ]);
  assert.equal(chosen.source, "custom_role");

  /* A custom role whose permission column is empty falls to the parent's tree. */
  chosen = p.selectTree([
    { source: "custom_role", tree: null },
    { source: "plan_role_feature", tree: planTree },
  ]);
  assert.equal(chosen.source, "plan_role_feature");

  /* Nothing anywhere. */
  chosen = p.selectTree([{ source: "custom_role", tree: null }, { source: "default_plan", tree: undefined }]);
  assert.deepEqual(chosen, { source: "none", tree: null });
});

test("self versus other: yourself is allowed unless the tree says otherwise", () => {
  const noEdit = t({ plan_features: { account_setting: { access: { USER: { action: { edit: false } } } } } });
  /* Another person: the edit box decides. */
  assert.equal(p.evaluatePermission({ systemRole: "AGENT", tree: noEdit, key: PEOPLE_EDIT, isSelf: false }).ok, false);
  /* Yourself, no self key in the tree: allowed. */
  assert.deepEqual(p.evaluatePermission({ systemRole: "AGENT", tree: noEdit, key: PEOPLE_EDIT, isSelf: true }), { ok: true, reason: "self" });
  /* Yourself, no tree at all, but a resolved role: still allowed. */
  assert.deepEqual(p.evaluatePermission({ systemRole: "AGENT", tree: null, key: PEOPLE_EDIT, isSelf: true }), { ok: true, reason: "self" });
  /* Yourself, the tree carries an explicit self box: it decides. */
  const selfNo = t({ plan_features: { account_setting: { access: { USER: { action: { edit: true, self: false } } } } } });
  const selfYes = t({ plan_features: { account_setting: { access: { USER: { action: { edit: false, self: true } } } } } });
  assert.equal(p.evaluatePermission({ systemRole: "AGENT", tree: selfNo, key: PEOPLE_EDIT, isSelf: true }).ok, false);
  assert.deepEqual(p.evaluatePermission({ systemRole: "AGENT", tree: selfYes, key: PEOPLE_EDIT, isSelf: true }), { ok: true, reason: "self_key" });
  /* An explicit selfKey option is honoured. */
  const custom = t({ plan_features: { account_setting: { access: { PROFILE: { action: { edit: false } } } } } });
  assert.equal(p.evaluatePermission({ systemRole: "AGENT", tree: custom, key: PEOPLE_EDIT, isSelf: true, selfKey: "account_setting.access.PROFILE.action.edit" }).ok, false);
  /* Unresolvable caller acting on "self" is still refused: no role, no tree. */
  assert.equal(p.evaluatePermission({ systemRole: null, tree: null, key: PEOPLE_EDIT, isSelf: true }).ok, false);
  assert.equal(p.selfKeyFor(PEOPLE_EDIT), "account_setting.access.USER.action.self");
});

test("report mode lets a refusal through with a log line; enforce answers 403 {message, permission}", () => {
  assert.equal(p.permissionMode(undefined), "report");
  assert.equal(p.permissionMode(""), "report");
  assert.equal(p.permissionMode("report"), "report");
  assert.equal(p.permissionMode("nonsense"), "report");
  assert.equal(p.permissionMode("enforce"), "enforce");
  assert.equal(p.permissionMode(" ENFORCE "), "enforce");

  const refused = p.evaluatePermission({ systemRole: "AGENT", tree: t(customTree), key: PEOPLE_DELETE });
  const granted = p.evaluatePermission({ systemRole: "AGENT", tree: t(customTree), key: PEOPLE_EDIT });

  assert.deepEqual(p.applyMode(refused, "report", PEOPLE_DELETE), { pass: true, log: true });
  assert.deepEqual(p.applyMode(granted, "report", PEOPLE_EDIT), { pass: true, log: false });
  assert.deepEqual(p.applyMode(granted, "enforce", PEOPLE_EDIT), { pass: true, log: false });
  assert.deepEqual(p.applyMode(refused, "enforce", PEOPLE_DELETE), {
    pass: false,
    status: 403,
    body: { success: false, message: p.DENY_MESSAGES.refused, permission: PEOPLE_DELETE },
  });
});
