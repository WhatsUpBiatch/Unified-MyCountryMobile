/* lockedFieldViolations compares the MATERIAL value of each locked rule, not the
 * whole sub-object. This file proves the one thing that matters for switching the
 * middleware from `report` to `enforce`: a person who changed nothing governed is
 * never refused, and a person who did change something governed always is.
 *
 * The "stored" shape is what CommonHelper.generateDefaultGeneralSetting writes for
 * a fresh person (default-api/src/helpers/CommonHelper.ts ~1418-1515). The
 * "incoming" shape is produced by running that record through the people screen's
 * page-load hydration and its onSubmit transform (src/pages/admin-settings/people/
 * update-forwarding/index.tsx), both copied below rather than invented, with the
 * helpers they call (getHolidaysFormVal / getHolidaysPayload from src/lib/utils.ts)
 * and CUSTOM_HOURS_SCHEDULE_OPTIONS read out of src/constants/forwarding-consts.ts.
 *
 * Run with:  bash backend-patches/company-settings/tests/run.sh
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const BUILD_DIR = process.env.BUILD_DIR;
if (!BUILD_DIR) throw new Error("BUILD_DIR not set; use tests/run.sh");

const { lockedFieldViolations, materialValueForRule, RULE_FIELDS } = require(
    path.join(BUILD_DIR, "companyRuleFlags.js"),
);

const WEB = "/root/mycountrymobile-web";

/* ---- Real shapes, copied from the code that produces them ------------------ */

/* src/constants/forwarding-consts.ts, read from the file so it cannot drift. */
const CUSTOM_HOURS_SCHEDULE_OPTIONS = (() => {
    const src = fs.readFileSync(path.join(WEB, "src/constants/forwarding-consts.ts"), "utf8");
    const m = src.match(/export const CUSTOM_HOURS_SCHEDULE_OPTIONS = (\{[\s\S]*?\n\});/);
    assert.ok(m, "could not find CUSTOM_HOURS_SCHEDULE_OPTIONS in forwarding-consts.ts");
    // eslint-disable-next-line no-new-func
    return new Function(`return (${m[1]});`)();
})();

/* src/lib/utils.ts getHolidaysPayload / getHolidaysFormVal, verbatim. */
const getHolidaysPayload = (holidays = []) =>
    holidays.map((item) => ({
        title: item?.title || "",
        from: item?.from || "",
        to: item?.to || "",
        type: item?.type?.value || "",
        type_label: item?.type?.label || "",
        name: item?.value?.name || "",
        value: item?.value?.value || "",
        personal: item?.personal || "",
    }));

const getHolidaysFormVal = (holidays = []) =>
    holidays?.map((item) => ({
        title: item?.title || "",
        from: item?.from || "",
        to: item?.to || "",
        type: { label: item?.type_label || "", value: item?.type || "" },
        value: { label: item?.name || "", value: item?.value || "", name: item?.name || "" },
        personal: item?.personal || false,
    }));

/* CommonHelper.generateDefaultGeneralSetting for a person in India, role AGENT,
   extension 101. Sound-file names and labels are exactly what the server writes. */
const storedDefault = () => ({
    role: { label: "AGENT", value: "role-agent-uuid" },
    group: { label: "", value: "" },
    recording: {
        on_demand: {
            enabled: false,
            recording_on: "ad98d65d-fcf8-4d4d-bc77-ee1426c34331.mp3",
            recording_Off: "ad98d65d-fcf8-4d4d-bc77-ee1426c34332.mp3",
        },
        automatic: {
            enabled: false,
            label: "All",
            value: "all",
            recording_on: "ad98d65d-fcf8-4d4d-bc77-ee1426c34333.mp3",
        },
    },
    operational_hours: {
        regional: {
            country: { name: "India", label: "India", value: "India" },
            timezone: { label: "Asia/Kolkata", value: "Asia/Kolkata" },
            country_code: { name: "India", label: "India (+91)", value: "IN" },
            time_format: 12,
        },
        type: "24_hours",
        value: {
            monday: { open: true, start: "10:00", end: "23:00", is_checked: false },
            tuesday: { open: true, start: "10:00", end: "23:00", is_checked: false },
            wednesday: { open: true, start: "10:00", end: "23:00", is_checked: false },
            thursday: { open: true, start: "10:00", end: "23:00", is_checked: false },
            friday: { open: true, start: "10:00", end: "23:00", is_checked: false },
            saturday: { open: false, start: "", end: "", is_checked: false },
            sunday: { open: false, start: "", end: "", is_checked: false },
        },
        holidays: [],
        closed_hour_action: {
            type: "VOICEMAIL",
            label: "Asha Rao",
            value: 101,
            enabled: true,
            personal: true,
            type_label: "Send to Voicemail",
            value_label: "Select",
        },
    },
    voicemail_pin: { users: [], value: "", voicemail_to_text: "NO" },
    display_number: {
        incoming: { label: "Yes", value: true },
        masking: { type: "N", label: "None", value: "" },
        show_number_if_blocked: "NO",
    },
});

/* update-forwarding/index.tsx page load (the non-template path, ~662-757): what
   the form holds after opening a person. `selectedRole` is the roleList entry
   matched by role_uuid. Company rules are read with the same legacy fallback the
   helper uses: a bare boolean on a person's record reads as apply:false. */
const readApply = (node) =>
    node && typeof node === "object" && typeof node.apply === "boolean"
        ? node.apply
        : node?.override === true;

const hydrate = (settingsData, selectedRole) => {
    const settings = { ...settingsData };
    settings.role = {
        label: selectedRole?.name || "",
        value: selectedRole?.type === "custom" ? selectedRole?.uuid : selectedRole?.role_uuid,
    };
    settings.display_number = {
        ...settings.display_number,
        masking: {
            ...settings.display_number?.masking,
            type: {
                label: settingsData?.display_number?.masking?.label || "",
                value: settingsData?.display_number?.masking?.type || "",
            },
        },
    };
    settings.operational_hours = {
        ...settings.operational_hours,
        holidays:
            settingsData?.operational_hours?.holidays && settingsData?.operational_hours?.holidays?.length
                ? getHolidaysFormVal(settingsData?.operational_hours?.holidays)
                : [],
        closed_hour_action: {
            type: {
                label: settingsData?.operational_hours?.closed_hour_action?.type_label || "",
                value: settingsData?.operational_hours?.closed_hour_action?.type || "",
            },
            value: {
                label: settingsData?.operational_hours?.closed_hour_action?.value_label || "",
                value: settingsData?.operational_hours?.closed_hour_action?.value || "",
            },
            enabled: settingsData?.operational_hours?.closed_hour_action?.enabled,
            personal: settingsData?.operational_hours?.closed_hour_action?.personal,
        },
    };
    settings.transcription = readApply(settingsData?.transcription)
        ? settingsData?.transcription?.enabled
        : false;
    settings.ai_call_monitoring = readApply(settingsData?.ai_call_monitoring)
        ? settingsData?.ai_call_monitoring?.enabled
        : false;
    return settings;
};

/* update-forwarding/index.tsx onSubmit (~288-332) followed by removeOverride. */
const RULE_FLAG_KEYS = ["override", "apply", "locked"];
const removeOverride = (obj) => {
    if (Array.isArray(obj)) return obj.map(removeOverride);
    if (typeof obj === "object" && obj !== null) {
        return Object.fromEntries(
            Object.entries(obj)
                .filter(([key]) => !RULE_FLAG_KEYS.includes(key))
                .map(([key, value]) => [key, removeOverride(value)]),
        );
    }
    return obj;
};

const onSubmit = (settings) => {
    const {
        display_number: { masking = {}, incoming = {}, show_number_if_blocked = "NO" } = {},
        role = {},
        operational_hours = {},
        ...restSettings
    } = settings;
    const tempSettings = {
        ...restSettings,
        display_number: {
            incoming,
            masking: { type: masking?.type?.value, label: masking?.type?.label, value: masking?.value },
            show_number_if_blocked,
        },
        role: { label: role?.label, value: role?.value },
        operational_hours: {
            type: operational_hours?.type,
            value: operational_hours?.value || CUSTOM_HOURS_SCHEDULE_OPTIONS,
            holidays: operational_hours?.holidays?.length
                ? getHolidaysPayload(operational_hours.holidays)
                : [],
            regional: {
                country: operational_hours?.regional?.country,
                timezone: operational_hours?.regional?.timezone,
                time_format: operational_hours?.regional?.time_format,
                country_code: operational_hours?.regional?.country_code,
            },
            closed_hour_action: {
                type: operational_hours?.closed_hour_action?.type?.value,
                value: operational_hours?.closed_hour_action?.value?.value,
                enabled: operational_hours?.closed_hour_action?.enabled,
                personal: operational_hours?.closed_hour_action?.personal,
                type_label: operational_hours?.closed_hour_action?.type?.label,
                value_label: operational_hours?.closed_hour_action?.value?.label,
            },
        },
    };
    return removeOverride(tempSettings);
};

const agentRole = { name: "Agent", type: "system", role_uuid: "role-agent-uuid", uuid: "row-uuid" };

/* Every rule locked, nothing applied: the strictest company there is. */
const lockAll = () => ({
    voicemail_pin: { apply: false, locked: true },
    recording: { apply: false, locked: true },
    transcription: { apply: false, locked: true },
    ai_call_monitoring: { apply: false, locked: true },
    display_number: { apply: false, locked: true },
    operational_hours: { apply: false, locked: true, regional: { apply: false, locked: true } },
    role: { apply: false, locked: true },
});

const lockOnly = (...fields) => {
    const s = lockAll();
    const off = { apply: false, locked: false };
    if (!fields.includes("voicemail")) s.voicemail_pin = off;
    if (!fields.includes("recording")) s.recording = off;
    if (!fields.includes("transcription")) s.transcription = off;
    if (!fields.includes("ai_call_monitoring")) s.ai_call_monitoring = off;
    if (!fields.includes("display_number")) s.display_number = off;
    if (!fields.includes("business_hours")) s.operational_hours = { ...s.operational_hours, ...off };
    if (!fields.includes("regional")) s.operational_hours.regional = off;
    if (!fields.includes("role")) s.role = off;
    return s;
};

/* A fresh person opened and saved untouched. */
const untouchedSave = () => {
    const stored = storedDefault();
    return { stored, incoming: onSubmit(hydrate(stored, agentRole)) };
};

/* ---- The headline: an untouched save is never refused ----------------------- */

test("a fresh person opened and saved untouched trips no lock at all", () => {
    const { stored, incoming } = untouchedSave();
    /* Sanity: the two shapes really do differ, or this test proves nothing. The
       old whole-object comparison refused this exact save on business_hours. */
    assert.notDeepEqual(incoming, stored);
    assert.notDeepEqual(incoming.operational_hours.closed_hour_action, stored.operational_hours.closed_hour_action);
    assert.equal(incoming.operational_hours.closed_hour_action.label, undefined, "the screen drops the label the server stored");
    assert.deepEqual(lockedFieldViolations(lockAll(), stored, incoming), []);
});

test("the same untouched save on a weekly schedule with a holiday is also clean", () => {
    const stored = storedDefault();
    stored.operational_hours.type = "weekly";
    stored.operational_hours.holidays = [
        { title: "Diwali", from: "2026-11-08", to: "2026-11-09", type: "VOICEMAIL", type_label: "Send to Voicemail", name: "", value: "", personal: true },
    ];
    const incoming = onSubmit(hydrate(stored, agentRole));
    assert.deepEqual(lockedFieldViolations(lockAll(), stored, incoming), []);
});

test("nothing locked: nothing is ever reported, even for a real change", () => {
    const { stored, incoming } = untouchedSave();
    incoming.voicemail_pin.value = "4321";
    incoming.role.value = "role-manager-uuid";
    assert.deepEqual(lockedFieldViolations(lockOnly(), stored, incoming), []);
    assert.deepEqual(lockedFieldViolations(null, stored, incoming), [], "no company record at all");
    /* A company record with no flags at all IS "no rules": the legacy read of an
       absent `override` is open (the open default, see company-rule-flags.test.cjs),
       so a company that never set a flag reports nothing even for real changes. */
    assert.deepEqual(lockedFieldViolations({}, stored, incoming), []);
    /* Only an explicitly stored `override: false` locks. */
    assert.deepEqual(lockedFieldViolations({ voicemail_pin: { override: false } }, stored, incoming), ["voicemail"]);
});

/* ---- Per field: same in a different shape / real change / not sent ---------- */

test("voicemail: PIN and voicemail-to-text are material, users and shape are not", () => {
    const { stored, incoming } = untouchedSave();
    const co = lockOnly("voicemail");
    incoming.voicemail_pin = { value: "", voicemail_to_text: "NO", users: ["a", "b"] };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "users list is display only");
    incoming.voicemail_pin = { value: undefined, voicemail_to_text: false };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "'' vs undefined, NO vs false");
    stored.voicemail_pin = { value: "1234", voicemail_to_text: "YES" };
    incoming.voicemail_pin = { value: " 1234 ", voicemail_to_text: true };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "trimmed PIN, YES vs true");

    incoming.voicemail_pin = { value: "9999", voicemail_to_text: "YES" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["voicemail"], "PIN changed");
    incoming.voicemail_pin = { value: "1234", voicemail_to_text: "NO" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["voicemail"], "voicemail-to-text changed");

    incoming.voicemail_pin = { users: [] };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "no material leaf sent");
    delete incoming.voicemail_pin;
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "node absent");
});

test("recording: the two switches and the direction while automatic is on", () => {
    const { stored, incoming } = untouchedSave();
    const co = lockOnly("recording");
    /* The form's idle default direction is "incoming" where the server keeps "all";
       with automatic off neither matters. */
    incoming.recording = { automatic: { enabled: false, value: "incoming", label: "Incoming" }, on_demand: { enabled: false } };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "direction ignored while off");
    stored.recording.automatic = { enabled: true, value: "all", label: "All", recording_on: "x.mp3" };
    incoming.recording = { automatic: { enabled: "true", value: "ALL" }, on_demand: { enabled: "false" } };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "case and string booleans");

    incoming.recording = { automatic: { enabled: true, value: "incoming" }, on_demand: { enabled: false } };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["recording"], "direction changed while on");
    incoming.recording = { automatic: { enabled: false, value: "all" }, on_demand: { enabled: false } };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["recording"], "automatic switched off");
    incoming.recording = { automatic: { enabled: true, value: "all" }, on_demand: { enabled: true } };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["recording"], "on-demand switched on");

    incoming.recording = { automatic: { recording_on: "x.mp3" }, on_demand: {} };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "only sound files sent");
    incoming.recording = {};
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "empty node");
});

test("transcription and ai_call_monitoring: bare boolean, {enabled} and YES/NO all agree", () => {
    for (const field of ["transcription", "ai_call_monitoring"]) {
        const { stored, incoming } = untouchedSave();
        const co = lockOnly(field);
        /* The default record has no node for either; the page posts false. */
        assert.equal(stored[field], undefined);
        assert.equal(incoming[field], false);
        assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], `${field}: nothing stored, false sent`);

        stored[field] = true;
        for (const same of [true, { enabled: true }, "YES", "true"]) {
            incoming[field] = same;
            assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], `${field}: ${JSON.stringify(same)} is still on`);
        }
        for (const changed of [false, { enabled: false }, "NO"]) {
            incoming[field] = changed;
            assert.deepEqual(lockedFieldViolations(co, stored, incoming), [field], `${field}: ${JSON.stringify(changed)} turns it off`);
        }
        stored[field] = { enabled: false, override: false };
        incoming[field] = { enabled: true };
        assert.deepEqual(lockedFieldViolations(co, stored, incoming), [field], `${field}: object shape, turned on`);

        for (const empty of [undefined, null, "", {}]) {
            incoming[field] = empty;
            assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], `${field}: ${JSON.stringify(empty)} is not sent`);
        }
    }
});

test("display_number: masking type+value, incoming, show-if-blocked; labels never count", () => {
    const { stored, incoming } = untouchedSave();
    const co = lockOnly("display_number");
    incoming.display_number = {
        incoming: { label: "Yes", value: "true" },
        masking: { type: "None", label: "", value: undefined },
        show_number_if_blocked: "No",
    };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "None/N, 'true'/true, No/NO");
    incoming.display_number = { incoming: true, masking: { type: { value: "N", label: "None" } } };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "bare incoming, object masking type, no show flag");
    stored.display_number = { incoming: { label: "Yes", value: true }, masking: { type: "X", label: "Custom", value: "+14155550100" }, show_number_if_blocked: "Yes" };
    incoming.display_number = { incoming: { value: true }, masking: { type: "x", value: " +14155550100 " }, show_number_if_blocked: "YES" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "case and whitespace on a masked number");

    incoming.display_number = { incoming: { value: true }, masking: { type: "X", value: "+14155550199" }, show_number_if_blocked: "Yes" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["display_number"], "masked number changed");
    incoming.display_number = { incoming: { value: true }, masking: { type: "N", value: "" }, show_number_if_blocked: "Yes" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["display_number"], "masking turned off");
    incoming.display_number = { incoming: { value: false }, masking: { type: "X", value: "+14155550100" }, show_number_if_blocked: "Yes" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["display_number"], "incoming turned off");
    incoming.display_number = { incoming: { value: true }, masking: { type: "X", value: "+14155550100" }, show_number_if_blocked: "No" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["display_number"], "show-if-blocked turned off");

    incoming.display_number = { masking: { label: "Custom" }, special_number: { number: "" } };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "labels only is not sent");
});

test("business_hours: type, the week only when weekly, holidays as a set, closed action only when enabled", () => {
    const { stored, incoming } = untouchedSave();
    const co = lockOnly("business_hours");
    /* 24_hours: the schedule the website fills in does not matter at all. */
    incoming.operational_hours.value = { monday: { open: false, start: "", end: "" } };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "schedule ignored under 24_hours");
    incoming.operational_hours.type = undefined;
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "missing type reads as 24_hours");
    incoming.operational_hours.type = "24_HOURS";
    incoming.operational_hours.closed_hour_action = { type: "voicemail", value: "101", enabled: "true" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "case on type, 101 vs '101', 'true' vs true");

    incoming.operational_hours.type = "weekly";
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["business_hours"], "24_hours -> weekly");

    stored.operational_hours.type = "weekly";
    const week = { ...stored, incoming: onSubmit(hydrate(stored, agentRole)) };
    assert.deepEqual(lockedFieldViolations(co, stored, week.incoming), [], "weekly untouched");
    week.incoming.operational_hours.value = { ...week.incoming.operational_hours.value, saturday: { open: false, start: "09:00", end: "17:00", is_checked: true } };
    assert.deepEqual(lockedFieldViolations(co, stored, week.incoming), [], "times on a closed day and is_checked do not count");
    week.incoming.operational_hours.value = { ...week.incoming.operational_hours.value, monday: { open: true, from: "10:00", to: "23:00" } };
    assert.deepEqual(lockedFieldViolations(co, stored, week.incoming), [], "from/to spelling accepted");
    week.incoming.operational_hours.value = { ...week.incoming.operational_hours.value, monday: { open: true, start: "09:00", end: "23:00" } };
    assert.deepEqual(lockedFieldViolations(co, stored, week.incoming), ["business_hours"], "monday opens earlier");
    week.incoming.operational_hours.value = { ...CUSTOM_HOURS_SCHEDULE_OPTIONS, saturday: { open: true, start: "10:00", end: "12:00" } };
    assert.deepEqual(lockedFieldViolations(co, stored, week.incoming), ["business_hours"], "saturday opened");

    const h1 = { title: "Diwali", from: "2026-11-08", to: "2026-11-09", type: "VOICEMAIL", type_label: "Send to Voicemail", name: "", value: "", personal: true };
    const h2 = { title: "Holi", from: "2027-03-22", to: "2027-03-22", type: "", type_label: "", name: "", value: "", personal: "" };
    stored.operational_hours.type = "24_hours";
    stored.operational_hours.holidays = [h1, h2];
    const hol = onSubmit(hydrate(stored, agentRole));
    assert.deepEqual(lockedFieldViolations(co, stored, hol), [], "holidays round-trip through the form");
    hol.operational_hours.holidays = [{ ...h2, personal: false }, { ...h1, type_label: "x" }, { ...h1 }];
    assert.deepEqual(lockedFieldViolations(co, stored, hol), [], "order, duplicates and labels do not count");
    hol.operational_hours.holidays = [h1];
    assert.deepEqual(lockedFieldViolations(co, stored, hol), ["business_hours"], "a holiday removed");
    hol.operational_hours.holidays = [h1, { ...h2, to: "2027-03-23" }];
    assert.deepEqual(lockedFieldViolations(co, stored, hol), ["business_hours"], "a holiday's date changed");

    const closed = onSubmit(hydrate(stored, agentRole));
    closed.operational_hours.closed_hour_action = { type: "EXTENSION", value: "101", enabled: true };
    assert.deepEqual(lockedFieldViolations(co, stored, closed), ["business_hours"], "closed action type changed");
    closed.operational_hours.closed_hour_action = { type: "VOICEMAIL", value: "102", enabled: true };
    assert.deepEqual(lockedFieldViolations(co, stored, closed), ["business_hours"], "closed action target changed");
    closed.operational_hours.closed_hour_action = { type: "VOICEMAIL", value: "101", enabled: false };
    assert.deepEqual(lockedFieldViolations(co, stored, closed), ["business_hours"], "closed action disabled");
    stored.operational_hours.closed_hour_action.enabled = false;
    closed.operational_hours.closed_hour_action = { type: "EXTENSION", value: "999", enabled: false };
    assert.deepEqual(lockedFieldViolations(co, stored, closed), [], "type/value ignored while disabled");

    assert.deepEqual(lockedFieldViolations(co, stored, { operational_hours: { regional: { timezone: { value: "UTC" } } } }), [], "only regional sent: hours not sent");
    assert.deepEqual(lockedFieldViolations(co, stored, { operational_hours: {} }), [], "empty node");
});

test("regional: timezone and country values, case-insensitive; time_format and labels never count", () => {
    const { stored, incoming } = untouchedSave();
    const co = lockOnly("regional");
    incoming.operational_hours.regional = { country: "india", timezone: "asia/kolkata", time_format: "24", country_code: {} };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "bare strings, case, time_format ignored");
    incoming.operational_hours.regional = { country: { label: "x", value: "India" }, timezone: { value: "Asia/Kolkata" }, time_format: "12" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "objects, 12 vs '12'");

    incoming.operational_hours.regional = { country: { value: "India" }, timezone: { value: "Europe/London" }, time_format: 12 };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["regional"], "timezone changed");
    incoming.operational_hours.regional = { country: { value: "Nepal" }, timezone: { value: "Asia/Kolkata" } };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["regional"], "country changed");

    incoming.operational_hours.regional = { time_format: "24", country_code: { value: "IN" }, timezone: {}, country: {} };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "no timezone/country value is not sent");
    incoming.operational_hours = { type: "24_hours" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "regional absent");
});

test("role: the value is material, the label is not", () => {
    const { stored, incoming } = untouchedSave();
    const co = lockOnly("role");
    incoming.role = { label: "Renamed Agent", value: "role-agent-uuid" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "label only");
    incoming.role = "role-agent-uuid";
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "bare string");
    incoming.role = { label: "Manager", value: "role-manager-uuid" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["role"], "role changed");
    incoming.role = { label: "Agent" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), [], "no value is not sent");
    incoming.role = { label: "", value: "" };
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["role"], "an empty value under a lock clears the role: a change");
});

/* ---- The mixed record ------------------------------------------------------- */

test("three locked rules, one real change: exactly that one is reported", () => {
    const { stored, incoming } = untouchedSave();
    const co = lockOnly("recording", "display_number", "regional");
    /* Two of the three come back in the website's shape, untouched. */
    incoming.recording.automatic.value = "incoming"; /* idle default while off */
    incoming.display_number.show_number_if_blocked = "No";
    /* The third is a real change. */
    incoming.operational_hours.regional.timezone = { label: "Europe/London", value: "Europe/London" };
    /* And an unlocked rule changed too, which must not appear. */
    incoming.voicemail_pin.value = "2468";
    assert.deepEqual(lockedFieldViolations(co, stored, incoming), ["regional"]);
});

test("materialValueForRule reports not-sent for every rule on an empty record", () => {
    for (const field of RULE_FIELDS) {
        assert.equal(materialValueForRule({}, field).present, false, field);
        assert.equal(materialValueForRule(undefined, field).present, false, field);
    }
});
