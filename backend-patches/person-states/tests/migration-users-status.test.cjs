// node tests/migration-users-status.test.cjs  (from backend-patches/person-states)
const assert = require("assert");
const path = require("path");
const MIGRATION = process.env.MIGRATION || "/root/UCAAS/mcm-repos/default-api/migrations/20260903150000-users-status-suspended.js"; // the copy beside this test sits under an ESM package.json, so load it from the API tree (or point MIGRATION at a .cjs copy)
const m = require(MIGRATION);

const live = { COLUMN_TYPE: "enum('EXPIRED','ACTIVE','INACTIVE','PENDING')", IS_NULLABLE: "YES", COLUMN_DEFAULT: "PENDING" };

assert.deepStrictEqual(m.enumValues(live.COLUMN_TYPE), ["EXPIRED", "ACTIVE", "INACTIVE", "PENDING"]);
assert.strictEqual(m.enumValues("varchar(20)"), null, "a varchar is not widened");
assert.deepStrictEqual(m.enumValues("enum('IT''S','X')"), ["IT'S", "X"], "escaped quote survives");

assert.deepStrictEqual(m.widenedValues(["EXPIRED", "ACTIVE", "INACTIVE", "PENDING"]), ["EXPIRED", "ACTIVE", "INACTIVE", "PENDING", "SUSPENDED"]);
assert.deepStrictEqual(m.widenedValues(["ACTIVE", "SUSPENDED"]), ["ACTIVE", "SUSPENDED", "EXPIRED", "INACTIVE", "PENDING"], "existing order kept, missing appended");

assert.strictEqual(
  m.alterStatement(live, m.widenedValues(m.enumValues(live.COLUMN_TYPE))),
  "ALTER TABLE `users` MODIFY COLUMN `status` ENUM('EXPIRED','ACTIVE','INACTIVE','PENDING','SUSPENDED') NULL DEFAULT 'PENDING'",
);
assert.strictEqual(
  m.alterStatement({ ...live, IS_NULLABLE: "NO", COLUMN_DEFAULT: null }, ["ACTIVE"]),
  "ALTER TABLE `users` MODIFY COLUMN `status` ENUM('ACTIVE') NOT NULL",
  "NOT NULL with no default stays that way",
);
assert.strictEqual(
  m.alterStatement({ ...live, IS_NULLABLE: "YES", COLUMN_DEFAULT: null }, ["ACTIVE"]),
  "ALTER TABLE `users` MODIFY COLUMN `status` ENUM('ACTIVE') NULL DEFAULT NULL",
);
// down: the value is dropped, nothing else moves
assert.strictEqual(
  m.alterStatement(live, ["EXPIRED", "ACTIVE", "INACTIVE", "PENDING", "SUSPENDED"].filter((v) => v !== "SUSPENDED")),
  "ALTER TABLE `users` MODIFY COLUMN `status` ENUM('EXPIRED','ACTIVE','INACTIVE','PENDING') NULL DEFAULT 'PENDING'",
);
console.log("migration-users-status: 8 checks ok");
