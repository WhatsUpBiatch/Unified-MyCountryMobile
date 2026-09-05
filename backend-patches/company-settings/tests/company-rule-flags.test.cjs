/* Unit tests for tenant-api/src/helpers/companyRuleFlags.ts.
 *
 * Run with:  bash backend-patches/company-settings/tests/run.sh
 * (compiles the two pure helpers to CommonJS in a scratch dir, then runs node:test).
 *
 * The build dir is passed in BUILD_DIR. No database, no network.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const BUILD_DIR = process.env.BUILD_DIR;
if (!BUILD_DIR) throw new Error("BUILD_DIR not set; use tests/run.sh");

const flags = require(path.join(BUILD_DIR, "companyRuleFlags.js"));
const {
    POLICY_FIELDS,
    RULE_NODE_PATHS,
    readRuleFlags,
    writeRuleFlags,
    applyCompanyRules,
    lockedFieldViolations,
    companyValueForRule,
    stripRuleFlags,
    APPLY_FIELDS,
} = flags;

/* ---- The port must not drift from the website ------------------------------ */

test("POLICY_FIELDS matches the frontend's company-policy.ts byte for byte", () => {
    const src = fs.readFileSync("/root/mycountrymobile-web/src/lib/company-policy.ts", "utf8");
    const m = src.match(/export const POLICY_FIELDS = (\{[\s\S]*?\}) as const;/);
    assert.ok(m, "could not find POLICY_FIELDS in the frontend file");
    // eslint-disable-next-line no-new-func
    const frontend = new Function(`return (${m[1]});`)();
    assert.deepEqual(POLICY_FIELDS, frontend);
});

test("the two service copies of companyRuleFlags.ts are identical", () => {
    const a = fs.readFileSync("/root/UCAAS/mcm-repos/tenant-api/src/helpers/companyRuleFlags.ts", "utf8");
    const b = fs.readFileSync("/root/UCAAS/mcm-repos/default-api/src/helpers/companyRuleFlags.ts", "utf8");
    assert.equal(a, b);
});

/* ---- readRuleFlags: same answers as the frontend ---------------------------- */

test("no company record at all: nothing applied, nothing locked, not legacy", () => {
    assert.deepEqual(readRuleFlags(null, "recording"), { apply: false, locked: false, isLegacy: false });
    assert.deepEqual(readRuleFlags(undefined, "recording"), { apply: false, locked: false, isLegacy: false });
});

test("legacy override:true reads as apply+open; an explicit false as skip+locked", () => {
    assert.deepEqual(readRuleFlags({ recording: { override: true } }, "recording"), { apply: true, locked: false, isLegacy: true });
    assert.deepEqual(readRuleFlags({ recording: { override: false } }, "recording"), { apply: false, locked: true, isLegacy: true });
});

test("the open default: an absent override is skip+open, not skip+locked", () => {
    /* The company never said anything about this setting, so it governs nothing there. */
    assert.deepEqual(readRuleFlags({ recording: {} }, "recording"), { apply: false, locked: false, isLegacy: true });
    assert.deepEqual(readRuleFlags({}, "recording"), { apply: false, locked: false, isLegacy: true });
    assert.deepEqual(readRuleFlags({ recording: { automatic: { enabled: true } } }, "recording"), { apply: false, locked: false, isLegacy: true });
    /* Not a boolean at all: null from a JSON column, a string from a hand edit. Nobody chose it. */
    assert.deepEqual(readRuleFlags({ recording: { override: null } }, "recording"), { apply: false, locked: false, isLegacy: true });
    assert.deepEqual(readRuleFlags({ recording: { override: undefined } }, "recording"), { apply: false, locked: false, isLegacy: true });
    assert.deepEqual(readRuleFlags({ recording: { override: "true" } }, "recording"), { apply: false, locked: false, isLegacy: true });
});

test("the server reads the legacy flag exactly as the website does", () => {
    /* The three-line truth table in the website file is the contract; the port must not drift. */
    const src = fs.readFileSync("/root/mycountrymobile-web/src/lib/company-rule-flags.ts", "utf8");
    const m = src.match(/const legacyFlags = \(override: unknown\): RuleFlags => \{([\s\S]*?)\n\};/);
    assert.ok(m, "could not find legacyFlags in the frontend file");
    const body = m[1];
    assert.match(body, /override === true\) return \{ apply: true, locked: false \}/);
    assert.match(body, /override === false\) return \{ apply: false, locked: true \}/);
    assert.match(body, /return \{ apply: false, locked: false \};\s*$/);
});

test("explicit flags win over override, and all four combinations are sayable", () => {
    const s = (apply, locked) => ({ recording: { apply, locked, override: !apply } });
    assert.deepEqual(readRuleFlags(s(true, true), "recording"), { apply: true, locked: true, isLegacy: false });
    assert.deepEqual(readRuleFlags(s(true, false), "recording"), { apply: true, locked: false, isLegacy: false });
    assert.deepEqual(readRuleFlags(s(false, true), "recording"), { apply: false, locked: true, isLegacy: false });
    assert.deepEqual(readRuleFlags(s(false, false), "recording"), { apply: false, locked: false, isLegacy: false });
});

test("a half-written node honours the flag present and infers the other from override", () => {
    const r = readRuleFlags({ recording: { apply: true, override: false } }, "recording");
    assert.deepEqual(r, { apply: true, locked: true, isLegacy: false });
});

test("a bare boolean node (old transcription shape) falls through to the legacy read", () => {
    /* A bare boolean carries no override at all, so it is the open default. */
    assert.deepEqual(readRuleFlags({ transcription: true }, "transcription"), { apply: false, locked: false, isLegacy: true });
});

test("nested paths and raw path refs both resolve", () => {
    const s = { operational_hours: { regional: { apply: true, locked: true } } };
    assert.equal(RULE_NODE_PATHS.regional, "operational_hours.regional");
    assert.deepEqual(readRuleFlags(s, "regional"), { apply: true, locked: true, isLegacy: false });
    assert.deepEqual(readRuleFlags(s, "operational_hours.regional.override"), { apply: true, locked: true, isLegacy: false });
});

test("a raw path of 'constructor' does not read Object.prototype", () => {
    /* Object.prototype.constructor is a function; reading `.override` off it gives
       undefined, which is now the open default, so the observable answer is the same
       as for a missing node. The point of the test is that it does not throw and
       does not find a flag that is not there. */
    assert.deepEqual(readRuleFlags({}, "constructor"), { apply: false, locked: false, isLegacy: true });
    assert.deepEqual(readRuleFlags({ constructor: { override: false } }, "constructor"), { apply: false, locked: true, isLegacy: true });
});

test("writeRuleFlags keeps override consistent and never mutates its input", () => {
    const input = { recording: { automatic: { enabled: true } } };
    const out = writeRuleFlags(input, "recording", { apply: true, locked: true });
    assert.deepEqual(out.recording, { automatic: { enabled: true }, apply: true, locked: true, override: true });
    assert.deepEqual(input, { recording: { automatic: { enabled: true } } });
    const bare = writeRuleFlags({ transcription: true }, "transcription", { apply: false, locked: false });
    assert.deepEqual(bare.transcription, { enabled: true, apply: false, locked: false, override: false });
});

/* ---- Server-side: seeding a new person ------------------------------------- */

const company = {
    recording: { apply: true, locked: true, override: true, automatic: { enabled: true, value: "all" } },
    transcription: { enabled: true, apply: true, locked: false },
    ai_call_monitoring: { enabled: false, override: true },
    voicemail_pin: { override: false, value: "1234" },
    display_number: { apply: false, locked: false, masking: { type: "N" } },
    operational_hours: {
        apply: true,
        locked: false,
        type: "custom",
        regional: { apply: true, locked: true, override: true, timezone: { value: "Europe/London" } },
    },
    role: { apply: true, locked: true, label: "AGENT", value: "role-uuid" },
};

test("stripRuleFlags removes apply/locked/override at every depth", () => {
    assert.deepEqual(stripRuleFlags(company.operational_hours), {
        type: "custom",
        regional: { timezone: { value: "Europe/London" } },
    });
});

test("companyValueForRule: objects lose their flags, bare-boolean rules become the enabled bit", () => {
    assert.deepEqual(companyValueForRule(company, "recording"), { automatic: { enabled: true, value: "all" } });
    assert.equal(companyValueForRule(company, "transcription"), true);
    assert.equal(companyValueForRule(company, "ai_call_monitoring"), false);
    assert.equal(companyValueForRule({ transcription: true }, "transcription"), true);
    assert.equal(companyValueForRule({}, "recording"), undefined);
});

test("applyCompanyRules seeds only rules with apply on, never role, and does not mutate", () => {
    const defaults = {
        role: { label: "MANAGER", value: "manager-uuid" },
        recording: { automatic: { enabled: false } },
        transcription: false,
        ai_call_monitoring: false,
        voicemail_pin: { value: "0000" },
        display_number: { masking: { type: "X" } },
        operational_hours: { type: "24_hours", regional: { timezone: { value: "America/Adak" } } },
    };
    const snapshot = JSON.stringify(defaults);
    const { settings, applied } = applyCompanyRules(company, defaults);

    assert.deepEqual(applied, ["regional", "business_hours", "recording", "transcription", "ai_call_monitoring"]);
    assert.deepEqual(settings.role, { label: "MANAGER", value: "manager-uuid" }, "role must never be seeded");
    assert.deepEqual(settings.recording, { automatic: { enabled: true, value: "all" } });
    assert.equal(settings.transcription, true);
    assert.equal(settings.ai_call_monitoring, false, "legacy override:true on a bare-boolean rule seeds .enabled");
    assert.deepEqual(settings.voicemail_pin, { value: "0000" }, "override:false is skip");
    assert.deepEqual(settings.display_number, { masking: { type: "X" } }, "apply:false is skip");
    assert.deepEqual(settings.operational_hours, {
        type: "custom",
        regional: { timezone: { value: "Europe/London" } },
    });
    assert.equal(JSON.stringify(defaults), snapshot);
    assert.equal(APPLY_FIELDS.indexOf("role"), -1);
});

test("applyCompanyRules: regional alone applies inside untouched hours", () => {
    const c = { operational_hours: { regional: { apply: true, timezone: "UTC" }, apply: false, locked: false, type: "x" } };
    const { settings, applied } = applyCompanyRules(c, { operational_hours: { type: "24_hours", regional: { timezone: "A" } } });
    assert.deepEqual(applied, ["regional"]);
    assert.deepEqual(settings.operational_hours, { type: "24_hours", regional: { timezone: "UTC" } });
});

test("applyCompanyRules: the caller's explicit value wins over the company value", () => {
    const { settings } = applyCompanyRules(company, { recording: { automatic: { enabled: false } } }, { recording: { automatic: { enabled: false, value: "mine" } } });
    assert.deepEqual(settings.recording, { automatic: { enabled: false, value: "mine" } });
});

test("applyCompanyRules with no company record returns the defaults unchanged", () => {
    const defaults = { recording: { a: 1 } };
    assert.deepEqual(applyCompanyRules(null, defaults), { settings: { recording: { a: 1 } }, applied: [] });
});

/* ---- Server-side: refusing a locked change -------------------------------- */

test("lockedFieldViolations: a changed locked field is reported, an unchanged one is not", () => {
    const stored = { recording: { automatic: { enabled: true, value: "all" } }, role: { label: "AGENT", value: "agent-uuid" }, transcription: true };
    const same = { recording: { automatic: { value: "all", enabled: true } }, role: { label: "AGENT", value: "agent-uuid" }, transcription: false };
    assert.deepEqual(lockedFieldViolations(company, stored, same), [], "key order is not a change; transcription is not locked");

    /* Material changes: automatic recording switched off, the role's value swapped.
       (A role label alone is not material; see locked-comparison.test.cjs.) */
    const changed = { recording: { automatic: { enabled: false, value: "all" } }, role: { label: "ADMIN", value: "admin-uuid" } };
    assert.deepEqual(lockedFieldViolations(company, stored, changed), ["recording", "role"]);
});

test("lockedFieldViolations: a field absent from the incoming body is not a change", () => {
    const stored = { recording: { automatic: { enabled: true } } };
    assert.deepEqual(lockedFieldViolations(company, stored, { display_number: { masking: { type: "Z" } } }), []);
});

test("lockedFieldViolations: nothing stored but something sent under a lock is a change", () => {
    /* Nothing stored behaves as "recording off"; sending "off" in any shape is the
       same behaviour and is not a change, sending "on" is. */
    assert.deepEqual(lockedFieldViolations(company, {}, { recording: { automatic: { enabled: false } } }), []);
    assert.deepEqual(lockedFieldViolations(company, {}, { recording: { automatic: { enabled: true, value: "all" } } }), ["recording"]);
});

test("lockedFieldViolations: legacy override:false locks (voicemail_pin), override:true does not", () => {
    const stored = { voicemail_pin: { value: "1234" }, ai_call_monitoring: false };
    const incoming = { voicemail_pin: { value: "9999" }, ai_call_monitoring: true };
    assert.deepEqual(lockedFieldViolations(company, stored, incoming), ["voicemail"]);
});

test("lockedFieldViolations: flags on either side are ignored when comparing", () => {
    const stored = { recording: { automatic: { enabled: true }, override: true } };
    const incoming = { recording: { automatic: { enabled: true } } };
    assert.deepEqual(lockedFieldViolations(company, stored, incoming), []);
});

test("lockedFieldViolations: a company that never set a flag locks nothing", () => {
    /* The old "Company Default" template row of a company that never touched the
       policy switches: every governed node is there with its values but no flag
       anywhere. Before the open default every one of these read as locked. */
    const neverSet = {
        recording: { automatic: { enabled: true, value: "all" } },
        transcription: true,
        ai_call_monitoring: false,
        voicemail_pin: { value: "1234" },
        display_number: { masking: { type: "N" } },
        operational_hours: { type: "24_hours", regional: { timezone: { value: "UTC" } } },
        role: { label: "AGENT", value: "agent-uuid" },
    };
    const stored = { recording: { automatic: { enabled: false } }, voicemail_pin: { value: "0000" }, role: { label: "AGENT", value: "agent-uuid" } };
    const incoming = {
        recording: { automatic: { enabled: true, value: "all" } },
        transcription: true,
        ai_call_monitoring: true,
        voicemail_pin: { value: "9999" },
        display_number: { masking: { type: "X", value: "1" } },
        operational_hours: { type: "custom", regional: { timezone: { value: "Europe/Paris" } } },
        role: { label: "ADMIN", value: "admin-uuid" },
    };
    assert.deepEqual(lockedFieldViolations(neverSet, stored, incoming), []);
    assert.deepEqual(lockedFieldViolations({}, stored, incoming), []);
    /* ...and it seeds nothing either. */
    assert.deepEqual(applyCompanyRules(neverSet, { recording: { a: 1 } }), { settings: { recording: { a: 1 } }, applied: [] });
});

test("lockedFieldViolations: no company record or non-object body means nothing is refused", () => {
    assert.deepEqual(lockedFieldViolations(null, {}, { recording: 1 }), []);
    assert.deepEqual(lockedFieldViolations(company, {}, "not an object"), []);
});
