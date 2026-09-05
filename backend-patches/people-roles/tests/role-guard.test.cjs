"use strict";
/* The role rules, one case per row of the table in README.md. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const g = require(path.join(process.env.BUILD_DIR, "roleGuard.js"));

const person = (uuid, systemRole, extra = {}) => ({ uuid, systemRole, ...extra });
const owner = person("owner", "ADMIN");
const manager = person("mgr", "MANAGER");
const subAdmin = person("sub", "SUB-ADMIN");
const agent = person("agent", "AGENT");
const unknown = person("nobody", null);
const want = (key, customRoleUuid = null) => ({ systemRole: key, customRoleUuid });

test("normaliseSystemRole accepts the four keys in any case and spacing", () => {
  assert.equal(g.normaliseSystemRole("admin"), "ADMIN");
  assert.equal(g.normaliseSystemRole(" Sub_Admin "), "SUB-ADMIN");
  assert.equal(g.normaliseSystemRole("MANAGER"), "MANAGER");
  assert.equal(g.normaliseSystemRole("agent"), "AGENT");
  assert.equal(g.normaliseSystemRole("Custom Sub-Admin"), null);
  assert.equal(g.normaliseSystemRole("3f2b6b0e-1b6e-4b7e-9e2a-1a2b3c4d5e6f"), null);
  assert.equal(g.normaliseSystemRole(null), null);
});

test("an unresolved caller is refused everywhere (fail closed)", () => {
  assert.equal(g.decideRoleChange({ caller: unknown, target: agent, requested: want("MANAGER") }).ok, false);
  assert.equal(g.decidePersonDelete({ caller: unknown, target: agent }).ok, false);
  assert.equal(g.decideAdminAction({ caller: unknown }).ok, false);
  assert.equal(g.decideNewMemberRole({ caller: unknown, requested: want("AGENT") }).ok, false);
  assert.equal(g.decidePersonEdit({ caller: unknown, target: agent }).ok, false);
});

test("nobody changes their own role - not even the owner", () => {
  const r = g.decideRoleChange({ caller: owner, target: owner, requested: want("AGENT") });
  assert.deepEqual(r, { ok: false, status: 403, message: g.MESSAGES.OWN_ROLE });
  const r2 = g.decideRoleChange({ caller: agent, target: agent, requested: want("ADMIN") });
  assert.equal(r2.ok, false);
  assert.equal(r2.message, g.MESSAGES.OWN_ROLE);
});

test("a self-edit that repeats the current role is allowed with apply=false", () => {
  const r = g.decideRoleChange({ caller: owner, target: owner, requested: want("ADMIN") });
  assert.deepEqual(r, { ok: true, apply: false });
  const custom = person("me", "AGENT", { customRoleUuid: "c1" });
  assert.deepEqual(g.decideRoleChange({ caller: custom, target: custom, requested: want("AGENT", "c1") }), { ok: true, apply: false });
  // same parent, different custom role: that IS a change
  assert.equal(g.decideRoleChange({ caller: custom, target: custom, requested: want("AGENT", "c2") }).ok, false);
});

test("only administrators change a role", () => {
  const r = g.decideRoleChange({ caller: agent, target: person("x", "AGENT"), requested: want("MANAGER") });
  assert.deepEqual(r, { ok: false, status: 403, message: g.MESSAGES.NOT_ADMIN_ROLE });
  assert.deepEqual(g.decideRoleChange({ caller: manager, target: person("x", "AGENT"), requested: want("SUB-ADMIN") }), { ok: true, apply: true });
  assert.deepEqual(g.decideRoleChange({ caller: subAdmin, target: person("x", "AGENT"), requested: want("MANAGER") }), { ok: true, apply: true });
});

test("only the owner grants the owner role", () => {
  const r = g.decideRoleChange({ caller: manager, target: person("x", "AGENT"), requested: want("ADMIN") });
  assert.deepEqual(r, { ok: false, status: 403, message: g.MESSAGES.OWNER_GRANT });
  assert.deepEqual(g.decideRoleChange({ caller: owner, target: person("x", "AGENT"), requested: want("ADMIN") }), { ok: true, apply: true });
  assert.equal(g.decideNewMemberRole({ caller: subAdmin, requested: want("ADMIN") }).message, g.MESSAGES.OWNER_GRANT);
  assert.deepEqual(g.decideNewMemberRole({ caller: owner, requested: want("ADMIN") }), { ok: true, apply: true });
});

test("only the owner changes an owner's role (demotion)", () => {
  const secondOwner = person("owner2", "ADMIN");
  const r = g.decideRoleChange({ caller: manager, target: secondOwner, requested: want("AGENT") });
  assert.deepEqual(r, { ok: false, status: 403, message: g.MESSAGES.OWNER_TARGET });
  assert.deepEqual(g.decideRoleChange({ caller: owner, target: secondOwner, requested: want("AGENT") }), { ok: true, apply: true });
});

test("the comparison is on the resolved key, not on any name", () => {
  // a caller whose resolver produced AGENT is an agent whatever text sits in users.role
  const namedAdmin = person("sneaky", "AGENT", { roleName: "ADMIN" });
  assert.equal(g.decideRoleChange({ caller: namedAdmin, target: agent, requested: want("MANAGER") }).ok, false);
});

test("editing another person needs an administrator; editing yourself does not", () => {
  assert.deepEqual(g.decidePersonEdit({ caller: agent, target: agent }), { ok: true, apply: true });
  assert.equal(g.decidePersonEdit({ caller: agent, target: manager }).message, g.MESSAGES.NOT_ADMIN_EDIT);
  assert.deepEqual(g.decidePersonEdit({ caller: manager, target: agent }), { ok: true, apply: true });
  assert.equal(g.decidePersonEdit({ caller: manager, target: owner }).message, g.MESSAGES.OWNER_EDIT);
  assert.deepEqual(g.decidePersonEdit({ caller: owner, target: owner }), { ok: true, apply: true });
});

test("removing: administrators only, never yourself, never the owner", () => {
  assert.equal(g.decidePersonDelete({ caller: agent, target: manager }).message, g.MESSAGES.NOT_ADMIN_DELETE);
  assert.equal(g.decidePersonDelete({ caller: manager, target: manager }).message, g.MESSAGES.SELF_DELETE);
  assert.equal(g.decidePersonDelete({ caller: manager, target: owner }).message, g.MESSAGES.OWNER_DELETE);
  assert.equal(g.decidePersonDelete({ caller: owner, target: owner }).message, g.MESSAGES.SELF_DELETE);
  assert.deepEqual(g.decidePersonDelete({ caller: subAdmin, target: agent }), { ok: true, apply: true });
});

test("administrative actions (roles, template, add, list-deleted, restore)", () => {
  assert.equal(g.decideAdminAction({ caller: agent }).message, g.MESSAGES.NOT_ADMIN_MANAGE);
  assert.deepEqual(g.decideAdminAction({ caller: subAdmin }), { ok: true, apply: true });
  assert.deepEqual(g.decideAdminAction({ caller: owner }), { ok: true, apply: true });
});

test("every refusal is a 403 with a plain message", () => {
  const refusals = [
    g.decideRoleChange({ caller: agent, target: manager, requested: want("AGENT") }),
    g.decidePersonDelete({ caller: agent, target: manager }),
    g.decideAdminAction({ caller: agent }),
    g.decidePersonEdit({ caller: agent, target: manager }),
  ];
  for (const r of refusals) {
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.match(r.message, /^[A-Z][^{}]+\.$/);
  }
});
