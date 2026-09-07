/* Unit tests for tenant-api/src/helpers/companySettingsSections.ts - the split of the
 * old "Company Default" blob into rows, and the fold back. Run via tests/run.sh. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const BUILD_DIR = process.env.BUILD_DIR;
if (!BUILD_DIR) throw new Error("BUILD_DIR not set; use tests/run.sh");

const {
    SECTION_NAME_RE,
    isValidSectionName,
    isValidSectionSettings,
    splitTemplateIntoSections,
    foldSectionsIntoTemplate,
    toObject,
} = require(path.join(BUILD_DIR, "companySettingsSections.js"));

test("section names: lower-case, letter first, 2-64 chars", () => {
    for (const ok of ["ab", "recording", "company_ring_time", "a1", "operational_hours", "x".repeat(64)]) {
        assert.ok(isValidSectionName(ok), ok);
    }
    for (const bad of ["", "a", "A", "Recording", "1abc", "has-dash", "has space", "x".repeat(65), null, 42, "greetings ", "../etc"]) {
        assert.ok(!isValidSectionName(bad), String(bad));
    }
    assert.ok(SECTION_NAME_RE instanceof RegExp);
});

test("section settings must be an object or array", () => {
    assert.ok(isValidSectionSettings({}));
    assert.ok(isValidSectionSettings([]));
    assert.ok(!isValidSectionSettings(null));
    assert.ok(!isValidSectionSettings("x"));
    assert.ok(!isValidSectionSettings(5));
    assert.ok(!isValidSectionSettings(undefined));
});

test("every key the product writes today is a valid section name", () => {
    const known = [
        "operational_hours", "recording", "display_number", "transcription", "ai_call_monitoring",
        "voicemail_pin", "voicemail_notify", "role", "company_holidays", "company_policies",
        "company_security", "company_messaging", "company_calling_permissions", "company_ring_time",
        "company_identity", "company_logo", "emergency_address", "company_profile_fields",
        "admin_scopes", "cost_centres", "greetings",
    ];
    known.forEach((k) => assert.ok(isValidSectionName(k), k));
});

test("split: one row per top-level key plus a greetings row; nothing is dropped silently", () => {
    const settings = {
        recording: { apply: true, automatic: { enabled: true } },
        operational_hours: { type: "24_hours" },
        company_holidays: [{ date: "2026-12-25" }],
        transcription: true,             // scalar: cannot be a section
        "Bad-Name": { x: 1 },            // name fails the rule
    };
    const greetings = { welcome_greeting: { enabled: true, override: false } };

    const { rows, skipped } = splitTemplateIntoSections(settings, greetings);

    assert.deepEqual(rows.map((r) => r.section), ["recording", "operational_hours", "company_holidays", "greetings"]);
    assert.deepEqual(rows[0].settings, { apply: true, automatic: { enabled: true } });
    assert.deepEqual(rows[2].settings, [{ date: "2026-12-25" }]);
    assert.deepEqual(rows[3].settings, greetings);
    assert.deepEqual(skipped, ["transcription", "Bad-Name"]);
});

test("split: JSON-string blobs (the column has been written both ways) are read", () => {
    const { rows } = splitTemplateIntoSections(JSON.stringify({ recording: { a: 1 } }), JSON.stringify({ ring_tone: { value: "x" } }));
    assert.deepEqual(rows, [
        { section: "recording", settings: { a: 1 } },
        { section: "greetings", settings: { ring_tone: { value: "x" } } },
    ]);
});

test("split: empty greetings produce no greetings row; a settings key named greetings then survives", () => {
    const a = splitTemplateIntoSections({ recording: {} }, {});
    assert.deepEqual(a.rows.map((r) => r.section), ["recording"]);
    const b = splitTemplateIntoSections({ greetings: { from: "settings" } }, null);
    assert.deepEqual(b.rows, [{ section: "greetings", settings: { from: "settings" } }]);
});

test("split: a settings key named greetings loses to the real greetings blob and is reported", () => {
    const { rows, skipped } = splitTemplateIntoSections({ greetings: { from: "settings" } }, { from: "blob" });
    assert.deepEqual(rows, [{ section: "greetings", settings: { from: "blob" } }]);
    assert.deepEqual(skipped, ["greetings"]);
});

test("split: unreadable input is an empty result, never a throw", () => {
    assert.deepEqual(splitTemplateIntoSections("{not json", "[]"), { rows: [], skipped: [] });
    assert.deepEqual(splitTemplateIntoSections(null, undefined), { rows: [], skipped: [] });
    assert.deepEqual(toObject([1, 2]), {});
});

test("fold: rows go back to the { settings, greetings } shape; a split round-trips", () => {
    const settings = { recording: { a: 1 }, company_security: { ip_allowlist: [] } };
    const greetings = { voicemail: { enabled: false } };
    const { rows } = splitTemplateIntoSections(settings, greetings);
    assert.deepEqual(foldSectionsIntoTemplate(rows), { settings, greetings });
});

test("fold: JSON-string row values are parsed, bad section names are ignored, no rows is empty", () => {
    const folded = foldSectionsIntoTemplate([
        { section: "recording", settings: JSON.stringify({ a: 1 }) },
        { section: "Nope", settings: { b: 2 } },
        { section: "greetings", settings: JSON.stringify({ g: 1 }) },
    ]);
    assert.deepEqual(folded, { settings: { recording: { a: 1 } }, greetings: { g: 1 } });
    assert.deepEqual(foldSectionsIntoTemplate([]), { settings: {}, greetings: {} });
    assert.deepEqual(foldSectionsIntoTemplate(null), { settings: {}, greetings: {} });
});
