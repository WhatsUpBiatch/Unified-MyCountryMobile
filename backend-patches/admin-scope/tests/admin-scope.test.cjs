"use strict";
/* The scope rules, one case per line of the two rule lists in README.md. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const s = require(path.join(process.env.BUILD_DIR, "adminScope.js"));
const p = require(path.join(process.env.BUILD_DIR, "permissionTree.js"));

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const DELHI = U(1), MUMBAI = U(2), SALES = U(3), SUPPORT = U(4);
const ME = U(7), THEM = U(8);

const locationScope = (...ids) => ({ level: "location", location_uuids: ids, group_uuids: [] });
const groupScope = (...ids) => ({ level: "group", location_uuids: [], group_uuids: ids });
const company = { level: "company", location_uuids: [], group_uuids: [] };

const target = (extra = {}) => ({ uuid: THEM, site_uuid: DELHI, group_uuids: [SALES], ...extra });
const access = (callerRole, scope, t = target()) =>
  s.decideScopeAccess({ callerRole, callerUuid: ME, scope, target: t });

test("normaliseAdminScope: absent, junk and unknown levels read as company-wide (null)", () => {
  assert.equal(s.normaliseAdminScope(undefined), null);
  assert.equal(s.normaliseAdminScope(null), null);
  assert.equal(s.normaliseAdminScope("not json"), null);
  assert.equal(s.normaliseAdminScope({ level: "office" }), null);
  assert.equal(s.normaliseAdminScope([]), null);
  assert.deepEqual(s.normaliseAdminScope({ level: "COMPANY" }), company);
  assert.deepEqual(s.normaliseAdminScope(JSON.stringify(locationScope(DELHI))), locationScope(DELHI));
});

test("normaliseAdminScope: the list the level does not use is dropped; junk ids are dropped", () => {
  const raw = { level: "location", location_uuids: [DELHI, " ", DELHI, "nope", 12], group_uuids: [SALES] };
  assert.deepEqual(s.normaliseAdminScope(raw), locationScope(DELHI));
  assert.deepEqual(s.scopeFromSettings({ admin_scope: groupScope(SALES), other: 1 }), groupScope(SALES));
  assert.deepEqual(s.scopeFromSettings('{"admin_scope":{"level":"group","group_uuids":["' + SALES + '"]}}'), groupScope(SALES));
  assert.equal(s.scopeFromSettings({ role: { label: "ADMIN" } }), null);
});

test("the account owner is never scoped", () => {
  assert.deepEqual(access("ADMIN", locationScope(MUMBAI)), { ok: true, reason: "owner" });
  assert.deepEqual(access("ADMIN", groupScope(SUPPORT), target({ group_uuids: [] })), { ok: true, reason: "owner" });
});

test("acting on yourself is never scoped", () => {
  const me = target({ uuid: ME, site_uuid: MUMBAI, group_uuids: [] });
  assert.deepEqual(access("MANAGER", locationScope(DELHI), me), { ok: true, reason: "self" });
  assert.deepEqual(access("SUB-ADMIN", groupScope(SUPPORT), me), { ok: true, reason: "self" });
  assert.deepEqual(access("AGENT", groupScope(SUPPORT), me), { ok: true, reason: "self" });
});

test("no scope, or level company, reaches everybody (today's behaviour)", () => {
  assert.deepEqual(access("MANAGER", null), { ok: true, reason: "company" });
  assert.deepEqual(access("SUB-ADMIN", company, target({ site_uuid: null, group_uuids: [] })), { ok: true, reason: "company" });
  assert.deepEqual(access(null, null), { ok: true, reason: "company" }, "scope adds no refusal of its own for an unresolved role - the tree already did");
});

test("location scope: the target's site must be one of mine; no site is a refusal", () => {
  assert.deepEqual(access("MANAGER", locationScope(DELHI)), { ok: true, reason: "location" });
  assert.deepEqual(access("MANAGER", locationScope(MUMBAI, DELHI)), { ok: true, reason: "location" });
  const out = access("MANAGER", locationScope(MUMBAI));
  assert.equal(out.ok, false);
  assert.equal(out.reason, "outside_location");
  assert.equal(out.message, s.SCOPE_DENY_MESSAGES.outside_location);
  const none = access("MANAGER", locationScope(DELHI), target({ site_uuid: null }));
  assert.equal(none.ok, false);
  assert.equal(none.reason, "no_location");
  const empty = access("MANAGER", locationScope());
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, "empty_scope");
});

test("group scope: the target must be a member of one of my groups", () => {
  assert.deepEqual(access("SUB-ADMIN", groupScope(SALES)), { ok: true, reason: "group" });
  assert.deepEqual(access("SUB-ADMIN", groupScope(SUPPORT, SALES), target({ group_uuids: [SUPPORT] })), { ok: true, reason: "group" });
  const out = access("SUB-ADMIN", groupScope(SUPPORT));
  assert.equal(out.ok, false);
  assert.equal(out.reason, "outside_group");
  const none = access("SUB-ADMIN", groupScope(SUPPORT), target({ group_uuids: [] }));
  assert.equal(none.ok, false);
  assert.equal(none.reason, "no_group");
  assert.equal(none.message, s.SCOPE_DENY_MESSAGES.no_group);
  assert.equal(access("SUB-ADMIN", groupScope()).reason, "empty_scope");
  /* The site is irrelevant to a group admin. */
  assert.equal(access("SUB-ADMIN", groupScope(SALES), target({ site_uuid: MUMBAI })).ok, true);
});

test("a scope refusal goes through the same report/enforce switch as the tree", () => {
  const refused = access("MANAGER", locationScope(MUMBAI));
  assert.deepEqual(p.applyMode(refused, "report", "k"), { pass: true, log: true });
  assert.deepEqual(p.applyMode(refused, "enforce", "account_setting.access.USER.action.delete"), {
    pass: false,
    status: 403,
    body: { success: false, message: s.SCOPE_DENY_MESSAGES.outside_location, permission: "account_setting.access.USER.action.delete" },
  });
  assert.deepEqual(p.applyMode(access("MANAGER", locationScope(DELHI)), "enforce", "k"), { pass: true, log: false });
  assert.equal(p.permissionMode(undefined), "report");
});

test("scopeFilter: what the People list would be narrowed to", () => {
  const f = (role, scope, members) => s.scopeFilter({ callerRole: role, callerUuid: ME, scope, groupMemberUuids: members });
  assert.deepEqual(f("ADMIN", locationScope(DELHI)), { kind: "all" });
  assert.deepEqual(f("MANAGER", null), { kind: "all" });
  assert.deepEqual(f("MANAGER", company), { kind: "all" });
  assert.deepEqual(f("MANAGER", locationScope(DELHI, MUMBAI)), { kind: "sites", site_uuids: [DELHI, MUMBAI] });
  assert.deepEqual(f("MANAGER", locationScope()), { kind: "none" });
  assert.deepEqual(f("SUB-ADMIN", groupScope(SALES), [THEM]), { kind: "users", user_uuids: [THEM, ME] }, "the caller always stays on their own list");
  assert.deepEqual(f("SUB-ADMIN", groupScope(SALES), [THEM, ME]), { kind: "users", user_uuids: [THEM, ME] });
  assert.deepEqual(f("SUB-ADMIN", groupScope()), { kind: "none" });
});

/* Who may set a scope. */
const actor = (uuid, systemRole, scope = null) => ({ uuid, systemRole, scope });
const owner = actor(U(1), "ADMIN");
const manager = actor(U(2), "MANAGER");
const scopedManager = actor(U(3), "MANAGER", locationScope(DELHI));
const subAdmin = actor(U(4), "SUB-ADMIN");
const agent = actor(U(5), "AGENT");
const unknown = actor(U(6), null);
const change = (caller, target) => s.decideScopeChange({ caller, target });

test("setting a scope: an unresolved caller is refused (fail closed)", () => {
  assert.deepEqual(change(unknown, subAdmin), { ok: false, status: 403, message: s.SCOPE_CHANGE_MESSAGES.UNRESOLVED_CALLER });
});

test("setting a scope: nobody changes their own - not even the owner", () => {
  assert.equal(change(owner, owner).message, s.SCOPE_CHANGE_MESSAGES.OWN_SCOPE);
  assert.equal(change(manager, manager).message, s.SCOPE_CHANGE_MESSAGES.OWN_SCOPE);
});

test("setting a scope: only the owner and an account admin; a scoped account admin sets nobody's", () => {
  assert.equal(change(subAdmin, agent).message, s.SCOPE_CHANGE_MESSAGES.NOT_ALLOWED);
  assert.equal(change(agent, subAdmin).message, s.SCOPE_CHANGE_MESSAGES.NOT_ALLOWED);
  assert.equal(change(scopedManager, subAdmin).message, s.SCOPE_CHANGE_MESSAGES.CALLER_SCOPED);
  assert.deepEqual(change(actor(U(9), "MANAGER", company), subAdmin), { ok: true });
});

test("setting a scope: never on the owner; only the owner on an account admin; admins only", () => {
  assert.equal(change(manager, owner).message, s.SCOPE_CHANGE_MESSAGES.OWNER_TARGET);
  assert.equal(change(owner, manager).ok, true);
  assert.equal(change(manager, actor(U(9), "MANAGER")).message, s.SCOPE_CHANGE_MESSAGES.MANAGER_TARGET);
  assert.equal(change(manager, subAdmin).ok, true);
  assert.equal(change(owner, subAdmin).ok, true);
  assert.equal(change(owner, agent).message, s.SCOPE_CHANGE_MESSAGES.NOT_AN_ADMIN);
  assert.equal(change(owner, unknown).message, s.SCOPE_CHANGE_MESSAGES.NOT_AN_ADMIN);
});

test("checkScopeValue: shape and existence", () => {
  const known = { locations: [DELHI, MUMBAI], groups: [SALES] };
  assert.deepEqual(s.checkScopeValue({ level: "company" }, known), { scope: company, problems: [] });
  assert.deepEqual(s.checkScopeValue({ level: "location", location_uuids: [DELHI] }, known), { scope: locationScope(DELHI), problems: [] });
  assert.equal(s.checkScopeValue({ level: "region" }, known).problems[0].field, "level");
  assert.equal(s.checkScopeValue({}, known).scope, null);
  assert.equal(s.checkScopeValue({ level: "location", location_uuids: [] }, known).problems[0].field, "location_uuids");
  const missing = s.checkScopeValue({ level: "location", location_uuids: [SUPPORT] }, known);
  assert.equal(missing.problems.length, 1);
  assert.match(missing.problems[0].message, /do not exist/);
  assert.equal(s.checkScopeValue({ level: "group", group_uuids: [SALES] }, known).problems.length, 0);
  assert.equal(s.checkScopeValue({ level: "group", group_uuids: [SUPPORT] }, known).problems[0].field, "group_uuids");
  /* company level ignores whatever lists came along */
  assert.deepEqual(s.checkScopeValue({ level: "company", location_uuids: [SUPPORT] }, known).scope, company);
});
