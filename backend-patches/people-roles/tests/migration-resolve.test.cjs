"use strict";
/* The data-fix migration's resolver, run against the live shapes without a database. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const m = require(path.join(process.env.BUILD_DIR, "migration.js"));

const ADMIN = "11111111-1111-1111-1111-111111111111";
const SUB = "22222222-2222-2222-2222-222222222222";
const MANAGER = "33333333-3333-3333-3333-333333333333";
const AGENT = "44444444-4444-4444-4444-444444444444";
const CUSTOM_OK = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CUSTOM_BAD_PARENT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CUSTOM_OTHER_CO = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const lookup = {
  systemByUuid: new Map([[ADMIN, "ADMIN"], [SUB, "SUB-ADMIN"], [MANAGER, "MANAGER"], [AGENT, "AGENT"]]),
  customByUuid: new Map([
    [CUSTOM_OK, { role_uuid: SUB, company_uuid: "co1" }],
    [CUSTOM_BAD_PARENT, { role_uuid: "not-a-system-role", company_uuid: "co1" }],
    [CUSTOM_OTHER_CO, { role_uuid: SUB, company_uuid: "co2" }],
  ]),
};

const row = (o) => ({ uuid: "u", company_uuid: "co1", role: null, role_uuid: null, custom_role_uuid: null, ...o });

test("rows already holding a key are skipped (idempotent)", () => {
  for (const key of m.SYSTEM_ROLE_KEYS) {
    assert.deepEqual(m.resolveRow(row({ role: key }), lookup), { action: "skip" });
  }
});

test("custom role name in users.role -> the parent system key", () => {
  const d = m.resolveRow(row({ role: "Custom Sub-Admin", custom_role_uuid: CUSTOM_OK, role_uuid: SUB }), lookup);
  assert.deepEqual(d, { action: "update", role: "SUB-ADMIN", role_uuid: SUB, via: "custom_role_uuid" });
});

test("a custom role named ADMIN resolves to its real parent, not to ADMIN", () => {
  const d = m.resolveRow(row({ role: "ADMIN ", custom_role_uuid: CUSTOM_OK, role_uuid: SUB }), lookup);
  assert.equal(d.action, "update");
  assert.equal(d.role, "SUB-ADMIN");
});

test("role_uuid alone -> the system key", () => {
  assert.deepEqual(m.resolveRow(row({ role: "New role", role_uuid: MANAGER }), lookup), { action: "update", role: "MANAGER", via: "role_uuid" });
});

test("users.role holding a system role uuid fills role_uuid too", () => {
  const d = m.resolveRow(row({ role: AGENT }), lookup);
  assert.deepEqual(d, { action: "update", role: "AGENT", role_uuid: AGENT, custom_role_uuid: null, via: "role text is a system role uuid" });
});

test("users.role holding a custom role uuid fills both ids", () => {
  const d = m.resolveRow(row({ role: CUSTOM_OK }), lookup);
  assert.deepEqual(d, { action: "update", role: "SUB-ADMIN", role_uuid: SUB, custom_role_uuid: CUSTOM_OK, via: "role text is a custom role uuid" });
});

test("wrong case or spacing is normalised", () => {
  assert.deepEqual(m.resolveRow(row({ role: " admin " }), lookup), { action: "update", role: "ADMIN", via: "normalised text" });
  assert.deepEqual(m.resolveRow(row({ role: "sub_admin" }), lookup), { action: "update", role: "SUB-ADMIN", via: "normalised text" });
});

test("a dangling custom_role_uuid falls through to role_uuid", () => {
  const d = m.resolveRow(row({ role: "gone", custom_role_uuid: "dddddddd-dddd-dddd-dddd-dddddddddddd", role_uuid: AGENT }), lookup);
  assert.deepEqual(d, { action: "update", role: "AGENT", via: "role_uuid" });
});

test("rows that cannot be resolved are reported, never touched", () => {
  assert.equal(m.resolveRow(row({ role: "New role" }), lookup).action, "report");
  assert.equal(m.resolveRow(row({ role: null }), lookup).action, "report");
  assert.equal(m.resolveRow(row({ role: "x", custom_role_uuid: CUSTOM_BAD_PARENT }), lookup).action, "report");
  assert.equal(m.resolveRow(row({ role: "x", custom_role_uuid: CUSTOM_OTHER_CO }), lookup).action, "report");
  assert.match(m.resolveRow(row({ role: "x", custom_role_uuid: CUSTOM_OTHER_CO }), lookup).reason, /another company/);
  assert.equal(m.resolveRow(row({ role: "ffffffff-ffff-ffff-ffff-ffffffffffff" }), lookup).action, "report");
});

test("the migration module exposes up/down and down is a no-op", async () => {
  assert.equal(typeof m.up, "function");
  assert.equal(await m.down(), undefined);
});
