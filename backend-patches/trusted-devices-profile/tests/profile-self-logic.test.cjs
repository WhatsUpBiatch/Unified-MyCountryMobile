"use strict";
/* API side: what a person may change about themselves, and the column guard. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const P = require(path.join(process.env.BUILD_DIR, "profileSelfLogic.js"));
const migration = require(path.join(process.env.BUILD_DIR, "migration.js"));

test("only the five fields survive; role, email and uuid are dropped on the floor", () => {
  const r = P.sanitiseSelfProfile({
    first_name: " Ada ",
    last_name: "Lovelace",
    job_title: "Engineer",
    pronouns: "she/her",
    interface_language: "en",
    role: "ADMIN",
    email: "x@y.z",
    uuid: "someone-else",
    settings: { role: { label: "ADMIN" } },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.values, {
    first_name: "Ada",
    last_name: "Lovelace",
    job_title: "Engineer",
    pronouns: "she/her",
    interface_language: "en",
  });
});

test("only the keys that were sent come back, so a partial save is partial", () => {
  const r = P.sanitiseSelfProfile({ pronouns: "they/them" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.values, { pronouns: "they/them" });
});

test("empty optional fields clear; empty names are refused", () => {
  assert.deepEqual(P.sanitiseSelfProfile({ pronouns: "", job_title: "  ", interface_language: null }).values, {
    pronouns: null,
    job_title: null,
    interface_language: null,
  });
  assert.equal(P.sanitiseSelfProfile({ first_name: "" }).ok, false);
  assert.equal(P.sanitiseSelfProfile({ last_name: "A" }).ok, false);
});

test("the column limits are enforced: 30 job title, 40 pronouns, 10 language", () => {
  assert.equal(P.sanitiseSelfProfile({ job_title: "x".repeat(30) }).ok, true);
  assert.equal(P.sanitiseSelfProfile({ job_title: "x".repeat(31) }).ok, false);
  assert.equal(P.sanitiseSelfProfile({ pronouns: "x".repeat(40) }).ok, true);
  assert.equal(P.sanitiseSelfProfile({ pronouns: "x".repeat(41) }).ok, false);
  assert.equal(P.sanitiseSelfProfile({ first_name: "x".repeat(51) }).ok, false);
  assert.equal(P.sanitiseSelfProfile({ interface_language: "en-US" }).ok, true);
  assert.equal(P.sanitiseSelfProfile({ interface_language: "pt-BR" }).ok, true);
  assert.equal(P.sanitiseSelfProfile({ interface_language: "english" }).ok, false);
  assert.equal(P.sanitiseSelfProfile({ interface_language: "e" }).ok, false);
  assert.equal(P.sanitiseSelfProfile({ interface_language: "en_US" }).ok, false);
});

test("whitespace inside a value is collapsed, not just trimmed", () => {
  assert.equal(P.sanitiseSelfProfile({ pronouns: "  she /  her " }).values.pronouns, "she / her");
});

test("a body with none of the five fields is refused with a helpful message", () => {
  const r = P.sanitiseSelfProfile({ role: "ADMIN" });
  assert.equal(r.ok, false);
  assert.match(r.message, /first_name, last_name, job_title, pronouns, interface_language/);
  assert.equal(P.sanitiseSelfProfile(null).ok, false);
  assert.equal(P.sanitiseSelfProfile("text").ok, false);
});

test("missingColumns is case-insensitive and lists only what is absent", () => {
  assert.deepEqual(P.missingColumns(["uuid", "first_name"]), ["pronouns", "interface_language"]);
  assert.deepEqual(P.missingColumns(["PRONOUNS", "first_name"]), ["interface_language"]);
  assert.deepEqual(P.missingColumns(["pronouns", "interface_language"]), []);
});

test("the migration and the guard agree on the two columns and their sizes", () => {
  assert.deepEqual(
    migration.COLUMNS.map((c) => c.name),
    P.SELF_PROFILE_NEW_COLUMNS.map((c) => c.name),
  );
  assert.equal(migration.COLUMNS.find((c) => c.name === "pronouns").type, "VARCHAR(40)");
  assert.equal(migration.COLUMNS.find((c) => c.name === "interface_language").type, "VARCHAR(10)");
  assert.match(P.SELF_PROFILE_NEW_COLUMNS.find((c) => c.name === "pronouns").sql, /VARCHAR\(40\)/);
  assert.match(P.SELF_PROFILE_NEW_COLUMNS.find((c) => c.name === "interface_language").sql, /VARCHAR\(10\)/);
  assert.equal(P.PRONOUNS_MAX, 40);
  assert.equal(P.INTERFACE_LANGUAGE_MAX, 10);
});

test("the migration adds only missing columns and drops only present ones", async () => {
  const run = [];
  const fakeQI = (present) => ({
    describeTable: async () => Object.fromEntries(present.map((c) => [c, {}])),
    sequelize: { query: async (sql) => run.push(sql) },
  });

  await migration.up(fakeQI(["uuid", "pronouns"]));
  assert.equal(run.length, 1);
  assert.match(run[0], /ADD COLUMN `interface_language` VARCHAR\(10\) NULL/);

  run.length = 0;
  await migration.up(fakeQI(["uuid", "pronouns", "interface_language"]));
  assert.equal(run.length, 0);

  run.length = 0;
  await migration.down(fakeQI(["uuid", "pronouns"]));
  assert.equal(run.length, 1);
  assert.match(run[0], /DROP COLUMN `pronouns`/);
});
