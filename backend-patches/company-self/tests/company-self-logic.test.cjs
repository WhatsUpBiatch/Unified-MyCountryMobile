/* Unit tests for default-api/src/services/companySelfLogic.ts - the rules for
 * what a company admin may change on their own `companies` row.
 *
 * Run with:  bash backend-patches/company-self/tests/run.sh
 * (bundles the pure module to CommonJS in a scratch dir, then runs node:test).
 * No database, no network. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const BUILD_DIR = process.env.BUILD_DIR;
if (!BUILD_DIR) throw new Error("BUILD_DIR not set; use tests/run.sh");

const {
    COMPANY_NAME_MAX,
    COMPANY_ADDRESS_MAX,
    COMPANY_CITY_MAX,
    COMPANY_SELF_FIELDS,
    COMPANY_SELF_READ_COLUMNS,
    sanitiseCompanySelf,
    changedCompanyFields,
    pickCompanySelf,
} = require(path.join(BUILD_DIR, "companySelfLogic.js"));

/* ---- The list of fields is the whole contract ------------------------------ */

test("exactly six editable fields, and none of them is money, plan or database", () => {
    assert.deepEqual([...COMPANY_SELF_FIELDS], ["name", "address", "city", "state", "country", "postal_code"]);
    for (const forbidden of ["plan_features", "allow_country", "stripe_token", "db_name", "amount", "credits", "plan_uuid", "licenses"]) {
        assert.ok(!COMPANY_SELF_FIELDS.includes(forbidden), forbidden);
        assert.ok(!COMPANY_SELF_READ_COLUMNS.includes(forbidden), forbidden);
    }
});

test("unknown and forbidden keys are dropped, not saved and not an error", () => {
    const r = sanitiseCompanySelf({ name: "Acme Ltd", plan_features: { x: 1 }, allow_country: ["IN"], stripe_token: "tok", db_name: "mcm_1", uuid: "someone-else" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.values, { name: "Acme Ltd" });
});

test("sizes match the columns: name and address 100, city 35, postal 10", () => {
    assert.equal(COMPANY_NAME_MAX, 100);
    assert.equal(COMPANY_ADDRESS_MAX, 100);
    assert.equal(COMPANY_CITY_MAX, 35);
    assert.equal(sanitiseCompanySelf({ name: "x".repeat(100) }).ok, true);
    assert.equal(sanitiseCompanySelf({ name: "x".repeat(101) }).ok, false);
    assert.equal(sanitiseCompanySelf({ address: "x".repeat(100) }).ok, true);
    assert.equal(sanitiseCompanySelf({ address: "x".repeat(101) }).ok, false);
    assert.equal(sanitiseCompanySelf({ city: "x".repeat(35) }).ok, true);
    assert.equal(sanitiseCompanySelf({ city: "x".repeat(36) }).ok, false);
    assert.equal(sanitiseCompanySelf({ postal_code: "1234567890" }).ok, true);
    assert.equal(sanitiseCompanySelf({ postal_code: "12345678901" }).ok, false);
});

/* ---- Name ---------------------------------------------------------------- */

test("name: at least two characters after trimming, never cleared", () => {
    assert.equal(sanitiseCompanySelf({ name: "A" }).ok, false);
    assert.equal(sanitiseCompanySelf({ name: "   " }).ok, false);
    assert.equal(sanitiseCompanySelf({ name: "" }).ok, false);
    assert.equal(sanitiseCompanySelf({ name: null }).ok, false);
    const r = sanitiseCompanySelf({ name: "  Acme   Ltd  " });
    assert.equal(r.ok, true);
    assert.equal(r.values.name, "Acme Ltd");
});

/* ---- Country and state as ISO codes ---------------------------------------- */

test("country: two letters, upper-cased; empty clears", () => {
    assert.deepEqual(sanitiseCompanySelf({ country: "in" }).values, { country: "IN" });
    assert.deepEqual(sanitiseCompanySelf({ country: "US" }).values, { country: "US" });
    assert.deepEqual(sanitiseCompanySelf({ country: "" }).values, { country: null });
    assert.deepEqual(sanitiseCompanySelf({ country: null }).values, { country: null });
    for (const bad of ["India", "USA", "1N", "I", "I-N"]) {
        const r = sanitiseCompanySelf({ country: bad });
        assert.equal(r.ok, false, bad);
        assert.match(r.message, /two-letter code/);
    }
});

test("state: the subdivision code as the website's list gives it", () => {
    for (const ok of ["MH", "CA", "ENG", "13", "05", "ARA", "ab"]) {
        const r = sanitiseCompanySelf({ state: ok });
        assert.equal(r.ok, true, ok);
        assert.equal(r.values.state, ok.toUpperCase());
    }
    assert.deepEqual(sanitiseCompanySelf({ state: "" }).values, { state: null });
    for (const bad of ["Maharashtra", "M H", "MH-", "x".repeat(11)]) {
        const r = sanitiseCompanySelf({ state: bad });
        assert.equal(r.ok, false, bad);
        assert.match(r.message, /short code/);
    }
});

test("postal code: letters, digits, spaces, dashes; must start with a letter or digit", () => {
    for (const ok of ["400001", "SW1A 1AA", "12345-6789", "K1A 0B1"]) {
        assert.equal(sanitiseCompanySelf({ postal_code: ok }).ok, true, ok);
    }
    for (const bad of [" 40000", "-1234", "40#001"]) {
        const r = sanitiseCompanySelf({ postal_code: bad });
        /* leading space is trimmed first, so " 40000" is fine; the others are not */
        if (bad === " 40000") assert.equal(r.ok, true);
        else assert.equal(r.ok, false, bad);
    }
    assert.deepEqual(sanitiseCompanySelf({ postal_code: "" }).values, { postal_code: null });
});

/* ---- Only what was sent comes back ------------------------------------------ */

test("only the keys that were sent are returned, so a one-field save leaves the rest alone", () => {
    const r = sanitiseCompanySelf({ address: "1 High Street" });
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.values), ["address"]);
    assert.ok(!("name" in r.values));
    assert.ok(!("country" in r.values));
});

test("an empty body, a non-object, or only unknown keys is 'nothing to save'", () => {
    for (const body of [{}, null, undefined, "x", 42, { plan_features: {} }]) {
        const r = sanitiseCompanySelf(body);
        assert.equal(r.ok, false);
        assert.match(r.message, /Nothing to save/);
    }
});

test("the first bad field wins and nothing is returned", () => {
    const r = sanitiseCompanySelf({ name: "Acme", country: "India" });
    assert.equal(r.ok, false);
    assert.equal(r.values, undefined);
});

/* ---- Change detection --------------------------------------------------- */

test("changedCompanyFields lists only real differences, treating empty and null alike", () => {
    const before = { name: "Acme", address: "", city: null, state: "MH", country: "IN", postal_code: "400001" };
    const diff = changedCompanyFields(before, { name: "Acme", address: null, city: "Pune", state: "MH", postal_code: "400002" });
    assert.deepEqual(diff, [
        { field: "city", from: null, to: "Pune" },
        { field: "postal_code", from: "400001", to: "400002" },
    ]);
});

test("changedCompanyFields ignores keys that were not sent and copes with no 'before'", () => {
    assert.deepEqual(changedCompanyFields({ name: "Acme" }, {}), []);
    assert.deepEqual(changedCompanyFields(null, { name: "Acme" }), [{ field: "name", from: null, to: "Acme" }]);
});

/* ---- The read shape ------------------------------------------------------ */

test("pickCompanySelf returns the safe columns only, with null for anything missing", () => {
    const row = {
        uuid: "u1", name: "Acme", address: "1 High St", city: "Pune", state: "MH", country: "IN", postal_code: "400001",
        updated_at: "2026-09-03T00:00:00Z",
        stripe_token: "tok_x", db_name: "mcm_1", plan_features: { a: 1 }, allow_country: ["IN"], amount: 12.5, credits: 3,
    };
    const picked = pickCompanySelf(row);
    assert.deepEqual(Object.keys(picked).sort(), [...COMPANY_SELF_READ_COLUMNS].sort());
    for (const secret of ["stripe_token", "db_name", "plan_features", "allow_country", "amount", "credits"]) {
        assert.ok(!(secret in picked), secret);
    }
    assert.equal(pickCompanySelf({ uuid: "u1", name: "Acme" }).address, null);
    assert.equal(pickCompanySelf(null), null);
});
