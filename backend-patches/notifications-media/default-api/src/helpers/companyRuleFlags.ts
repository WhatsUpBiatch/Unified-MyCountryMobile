/* The company's rules, read the way the website reads them.
 *
 * This is a straight port of two files from the web portal:
 *
 *   src/lib/company-policy.ts      (POLICY_FIELDS - which settings a company may govern,
 *                                   and where the flag sits in the stored record)
 *   src/lib/company-rule-flags.ts  (readRuleFlags - what a rule's flags mean, including
 *                                   how a record that only carries the old `override`
 *                                   flag is to be understood)
 *
 * It must stay faithful to them: the website decides what an admin sees and what a
 * person's phone gets, and this file decides what the server will refuse. If the two
 * ever disagree, an admin will be shown a lock the server does not hold, or the
 * server will refuse a change the screen said was allowed.
 *
 * THE MODEL, IN ONE PARAGRAPH
 *
 * Each governed setting carries two independent booleans on its node in the company
 * record: `apply` ("put this company value onto the person") and `locked` ("the
 * person may not change it themselves"). Older records carry only `override`, which
 * used to mean both things at once. It is read back like this:
 *
 *   override: true                          apply   , open
 *   override: false (explicitly stored)     skip    , locked
 *   override absent / undefined / null      skip    , open
 *
 * The first two reproduce exactly what the product did before the flags were split.
 * The third is the "open default" decision: a company that never said anything about
 * a setting governs nothing there, so a company that never set a single flag locks
 * nothing at all. Nothing here writes to a database, so every function is testable
 * on its own with plain objects.
 *
 * IDENTICAL COPIES
 *
 * The same file is kept in tenant-api and default-api (both under src/helpers/). It
 * has no imports on purpose so it can be copied byte for byte; the patch bundle's
 * apply script checks the two copies match.
 */

/* The settings a company rule can be set on, and where the flag sits in the stored
   record. Keys are the names callers use; paths are what the company page writes.
   Anything absent from this map is not governed. Verbatim from company-policy.ts. */
export const POLICY_FIELDS = {
    voicemail: "voicemail_pin.override",
    recording: "recording.override",
    transcription: "transcription.override",
    ai_call_monitoring: "ai_call_monitoring.override",
    display_number: "display_number.override",
    business_hours: "operational_hours.override",
    regional: "operational_hours.regional.override",
    role: "role.override",
} as const;

export type PolicyField = keyof typeof POLICY_FIELDS;

const LEGACY_FLAG_KEY = "override";
const APPLY_KEY = "apply";
const LOCKED_KEY = "locked";

/* The three flag keys never describe a person; they describe the rule. They are
   dropped whenever a company node is copied onto a person or compared for a lock. */
export const RULE_FLAG_KEYS: readonly string[] = [APPLY_KEY, LOCKED_KEY, LEGACY_FLAG_KEY];

export interface RuleFlags {
    /* Put the company's value for this setting onto the person. */
    apply: boolean;
    /* The person may not change this setting on their own phone. */
    locked: boolean;
}

export interface RuleFlagsRead extends RuleFlags {
    /* True when the record carries only the old `override` flag, so both values above
       were inferred rather than read. */
    isLegacy: boolean;
}

/* Either a POLICY_FIELDS key ('recording') or a path into the settings object, with or
   without the trailing flag ('recording', 'recording.override'). */
export type RuleFieldRef = PolicyField | string;

export const readPath = (source: any, path: string): any =>
    path.split(".").reduce((value, key) => (value == null ? value : value[key]), source);

/* Clones only the nodes along the path, so the caller's object is never touched and
   everything off the path stays shared. A non-object on the way down is replaced with
   an object: there is nowhere else to hang the rest of the path. */
export const setPath = (source: any, path: string, value: any): any => {
    const [head, ...rest] = path.split(".");
    const base: any = Array.isArray(source)
        ? [...source]
        : source && typeof source === "object"
            ? { ...source }
            : {};
    base[head] = rest.length ? setPath(source?.[head], rest.join("."), value) : value;
    return base;
};

const stripLegacyFlag = (path: string): string =>
    path.endsWith(`.${LEGACY_FLAG_KEY}`) ? path.slice(0, -(LEGACY_FLAG_KEY.length + 1)) : path;

/* POLICY_FIELDS points at the flag; the flags live on the node that holds it, so the
   node path is that with the trailing `.override` taken off. */
export const RULE_NODE_PATHS = Object.fromEntries(
    Object.entries(POLICY_FIELDS).map(([field, path]) => [field, stripLegacyFlag(path)]),
) as Record<PolicyField, string>;

export const RULE_FIELDS = Object.keys(POLICY_FIELDS) as PolicyField[];

/* `hasOwnProperty` rather than `in`: a caller passing a raw path of "constructor" or
   "toString" would otherwise match Object.prototype and read the wrong node. */
export const ruleNodePath = (field: RuleFieldRef): string =>
    Object.prototype.hasOwnProperty.call(RULE_NODE_PATHS, field)
        ? RULE_NODE_PATHS[field as PolicyField]
        : stripLegacyFlag(field);

/* What an old record means.

   `override: true` - the value was copied onto people and the control stayed enabled:
   apply, not locked. `override: false` - an admin turned the switch off: nothing
   copied, control disabled: skip, locked. Both are kept exactly as they were.

   The flag being ABSENT used to read the same as `false`, because the old readers
   tested `=== true`. That is the case this function now reads differently: absent
   means the company never said anything about this setting, so nothing is copied and
   nothing is locked. A value that is not a boolean at all - null from a JSON column,
   a string from a hand edit - is treated as absent for the same reason: nobody chose
   it. Verbatim from the website's company-rule-flags.ts. */
const legacyFlags = (override: unknown): RuleFlags => {
    if (override === true) return { apply: true, locked: false };
    if (override === false) return { apply: false, locked: true };
    return { apply: false, locked: false };
};

/* What a new record writes back into the old flag: `apply` is the half that changes
   data, so `apply` is the half `override` carries. See the website file for the full
   reasoning; it is not repeated here because the server never writes this flag. */
export const legacyOverrideFor = ({ apply }: RuleFlags): boolean => apply;

/* A settings object of null/undefined means no company record was found at all, which
   the website treats as "the company governs nothing" - everything editable, nothing
   copied. That is skip+open. */
export const readRuleFlags = (settings: any, field: RuleFieldRef): RuleFlagsRead => {
    if (settings == null) return { apply: false, locked: false, isLegacy: false };

    const nodePath = ruleNodePath(field);
    const node = readPath(settings, nodePath);

    /* `node` can be a bare boolean: `transcription` and `ai_call_monitoring` were plain
       booleans before they grew flags and both shapes are still in the data. Indexing a
       boolean is undefined rather than an error, so it falls through to the legacy read. */
    const apply = node?.[APPLY_KEY];
    const locked = node?.[LOCKED_KEY];
    const explicitApply = typeof apply === "boolean" ? apply : null;
    const explicitLocked = typeof locked === "boolean" ? locked : null;

    const fallback = legacyFlags(node?.[LEGACY_FLAG_KEY]);

    return {
        apply: explicitApply ?? fallback.apply,
        locked: explicitLocked ?? fallback.locked,
        isLegacy: explicitApply === null && explicitLocked === null,
    };
};

/* Returns a new settings object; the input is never mutated. Both new flags and a
   consistent `override` are written together. Kept for parity with the website;
   the server does not currently call it. */
export const writeRuleFlags = (
    settings: any,
    field: RuleFieldRef,
    { apply, locked }: RuleFlags,
): any => {
    const nodePath = ruleNodePath(field);
    const current = readPath(settings, nodePath);

    const node: any =
        current && typeof current === "object" && !Array.isArray(current)
            ? { ...current }
            : current == null
                ? {}
                : { enabled: current };

    node[APPLY_KEY] = apply;
    node[LOCKED_KEY] = locked;
    node[LEGACY_FLAG_KEY] = legacyOverrideFor({ apply, locked });

    return setPath(settings, nodePath, node);
};

/* One line of plain English per combination. */
export const describeRuleFlags = ({ apply, locked }: RuleFlags): string => {
    if (apply && locked) return "Everyone gets the company setting and cannot change it.";
    if (apply) return "Everyone starts with the company setting and may change it.";
    if (locked) return "The company setting is not applied, and people cannot change theirs.";
    return "The company has no rule here. People keep and may change their own setting.";
};

/* ---------------------------------------------------------------------------------
 * Server-side use of the flags: seeding a person, and refusing a change.
 * ------------------------------------------------------------------------------- */

/* Which rules SEED a value onto a person, and in what order.
 *
 * This mirrors `seSettingsData` in the website's people/update-forwarding screen,
 * which is the one place the product copies company values onto a person today. Two
 * things about that list are deliberate and must be kept:
 *
 *   - `role` is never seeded. A person's role comes from `role_uuid`, and the user
 *     update path reads `settings.role.label` back into the `users.role` column, so
 *     copying the company's placeholder role node onto a person would silently
 *     change what they are allowed to do. `role` is still honoured as a LOCK.
 *   - `regional` comes before `business_hours`. `regional` sits inside
 *     `operational_hours`, so when both apply the whole-hours copy lands second and
 *     carries the regional block with it, exactly as the screen does it.
 */
export const APPLY_FIELDS: readonly PolicyField[] = [
    "regional",
    "display_number",
    "business_hours",
    "voicemail",
    "recording",
    "transcription",
    "ai_call_monitoring",
];

/* Rules whose company node is `{ enabled, ...flags }` but whose value on a person is
   the bare boolean. The website writes `settings.transcription = company.transcription
   .enabled || false`; a person's record has never held the object shape. */
const BARE_BOOLEAN_FIELDS: readonly PolicyField[] = ["transcription", "ai_call_monitoring"];

const isPlainObject = (value: any): boolean =>
    !!value && typeof value === "object" && !Array.isArray(value);

/* A company node with the rule flags taken off, recursively, so a copied
   `operational_hours` does not carry `regional.override` down onto the person. */
export const stripRuleFlags = (value: any): any => {
    if (Array.isArray(value)) return value.map(stripRuleFlags);
    if (!isPlainObject(value)) return value;
    const out: any = {};
    Object.keys(value).forEach((key) => {
        if (RULE_FLAG_KEYS.indexOf(key) !== -1) return;
        out[key] = stripRuleFlags(value[key]);
    });
    return out;
};

/* The value a person receives for one rule, in the shape the person's record uses.
   `undefined` when the company has no node there, so a caller can tell "nothing to
   copy" from "copy a falsy value". */
export const companyValueForRule = (companySettings: any, field: PolicyField): any => {
    const node = readPath(companySettings, ruleNodePath(field));
    if (node === undefined) return undefined;
    if (BARE_BOOLEAN_FIELDS.indexOf(field) !== -1) {
        if (typeof node === "boolean") return node;
        return isPlainObject(node) ? node.enabled === true : false;
    }
    return stripRuleFlags(node);
};

export interface ApplyResult {
    settings: any;
    /* The rules that put a value on the person, in the order they were applied. */
    applied: PolicyField[];
}

/**
 * Seed a person's settings from the company's rules.
 *
 * `base` is the generated default record. Every APPLY_FIELDS rule with `apply` on
 * writes the company value over it. `explicit` is whatever the caller actually sent
 * for the person; anything present there wins over both, because an admin filling in
 * a new person on purpose is not something the company default should undo. Nothing
 * passed in is mutated.
 */
export const applyCompanyRules = (
    companySettings: any,
    base: any,
    explicit?: any,
): ApplyResult => {
    let settings: any = isPlainObject(base) ? { ...base } : {};
    const applied: PolicyField[] = [];

    if (companySettings != null) {
        APPLY_FIELDS.forEach((field) => {
            if (!readRuleFlags(companySettings, field).apply) return;
            const value = companyValueForRule(companySettings, field);
            if (value === undefined) return;
            settings = setPath(settings, ruleNodePath(field), value);
            applied.push(field);
        });
    }

    if (isPlainObject(explicit)) {
        RULE_FIELDS.forEach((field) => {
            const path = ruleNodePath(field);
            const value = readPath(explicit, path);
            if (value !== undefined) settings = setPath(settings, path, value);
        });
    }

    return { settings, applied };
};

/* Key order must not count as a change: the browser and the server serialise objects
   in whatever order they were built. */
const canonical = (value: any): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (isPlainObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
};

/* ---------------------------------------------------------------------------------
 * The MATERIAL value of a governed setting.
 *
 * The stored record and the record the website posts back are never the same
 * shape, even when the person changed nothing. The server's default record
 * (CommonHelper.generateDefaultGeneralSetting) writes `time_format: 12`,
 * `show_number_if_blocked: "NO"` and a bare `value` on closed_hour_action; the
 * people screen (update-forwarding onSubmit, and buildTemplatePayload for
 * templates) posts `"12"`, `"No"`, adds `type_label`/`value_label`, fills the
 * weekly schedule with CUSTOM_HOURS_SCHEDULE_OPTIONS even when the hours are
 * "24_hours", turns a missing holiday list into `[]`, and sends `''` where the
 * server stored nothing. Comparing whole objects therefore refused honest saves.
 *
 * So each rule is reduced to the handful of leaves that change what the phone
 * does, each normalised to one spelling, and only those are compared. Labels,
 * sound-file names, `is_checked`, `personal`, `users` and anything else the
 * screen keeps for its own display are not material and never count.
 * ------------------------------------------------------------------------------- */

/* `{ label, value }` pairs are what select controls bind to; the stored record
   sometimes keeps the bare value instead. Either way the value is what matters. */
const leafOf = (value: any): any => (isPlainObject(value) ? value.value : value);

const isPresent = (value: any): boolean => value !== undefined && value !== null;

const asString = (value: any): string => (isPresent(value) ? String(value).trim() : "");

const asUpper = (value: any): string => asString(value).toUpperCase();

const asLower = (value: any): string => asString(value).toLowerCase();

/* true / "true" / "YES" / "Yes" / "Y" / "1" mean on; everything else is off.
   Covers the switch that writes "Yes"/"No" and the default that stores "NO". */
const asBool = (value: any): boolean => {
    if (value === true) return true;
    if (typeof value === "number") return value !== 0;
    if (typeof value !== "string") return false;
    const word = value.trim().toUpperCase();
    return word === "TRUE" || word === "YES" || word === "Y" || word === "1";
};

/* transcription / ai_call_monitoring: a bare boolean, `{ enabled }`, or "YES"/"NO". */
const asEnabled = (value: any): boolean =>
    isPlainObject(value) ? asBool(value.enabled) : asBool(value);

/* One material reading of a rule's node. `present` says whether the caller sent
   anything at all for the rule: an incoming node that carries none of the leaves
   this rule looks at is "not sent", and is never a violation.

   Every reader answers for a node it cannot read (missing, null, wrong type) as if
   it were `{}`: a person with nothing stored behaves as "off" and "blank", so a
   save that sends "off" and "blank" back is not a change. */
interface MaterialValue {
    present: boolean;
    value: any;
}

const asNode = (node: any): any => (isPlainObject(node) ? node : {});

const materialVoicemail = (raw: any): MaterialValue => {
    const node = asNode(raw);
    const present = isPresent(node.value) || isPresent(node.voicemail_to_text);
    return {
        present,
        value: {
            pin: asString(node.value),
            voicemail_to_text: asBool(node.voicemail_to_text),
        },
    };
};

const materialRecording = (raw: any): MaterialValue => {
    const node = asNode(raw);
    const automatic = isPlainObject(node.automatic) ? node.automatic : {};
    const onDemand = isPlainObject(node.on_demand) ? node.on_demand : {};
    const present =
        isPresent(automatic.enabled) || isPresent(automatic.value) || isPresent(onDemand.enabled);
    const automaticOn = asBool(automatic.enabled);
    return {
        present,
        value: {
            automatic_enabled: automaticOn,
            /* The direction only matters while automatic recording is on; the form
               keeps "incoming" as its idle default where the server keeps "all". */
            automatic_value: automaticOn ? asLower(automatic.value) : "",
            on_demand_enabled: asBool(onDemand.enabled),
        },
    };
};

const materialToggle = (node: any): MaterialValue => {
    const present = isPlainObject(node)
        ? isPresent(node.enabled)
        : node !== undefined && node !== null && node !== "";
    return { present, value: asEnabled(node) };
};

/* "N" and "None" both mean no masking; a missing type means the same. */
const NO_MASKING = ["", "N", "NONE"];

const materialDisplayNumber = (raw: any): MaterialValue => {
    const node = asNode(raw);
    const masking = isPlainObject(node.masking) ? node.masking : {};
    const maskingType = asUpper(leafOf(masking.type));
    const incoming = leafOf(node.incoming);
    const present =
        isPresent(leafOf(masking.type)) ||
        isPresent(masking.value) ||
        isPresent(incoming) ||
        isPresent(node.show_number_if_blocked);
    const masked = NO_MASKING.indexOf(maskingType) === -1;
    return {
        present,
        value: {
            masking_type: masked ? maskingType : "N",
            masking_value: masked ? asString(masking.value) : "",
            incoming: asBool(incoming),
            show_number_if_blocked: asBool(node.show_number_if_blocked),
        },
    };
};

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const ALL_HOURS = "24_hours";

/* The schedule keeps `start`/`end` (CUSTOM_HOURS_SCHEDULE_OPTIONS); `from`/`to` are
   accepted too. A closed day's times do not matter, so they are blanked. */
const materialSchedule = (schedule: any): any => {
    const days: any = {};
    const source = isPlainObject(schedule) ? schedule : {};
    WEEKDAYS.forEach((day) => {
        const entry = isPlainObject(source[day]) ? source[day] : {};
        const open = asBool(entry.open);
        days[day] = {
            open,
            from: open ? asString(entry.start !== undefined ? entry.start : entry.from) : "",
            to: open ? asString(entry.end !== undefined ? entry.end : entry.to) : "",
        };
    });
    return days;
};

/* A holiday is its dates and its name; type/target labels and `personal` are not
   what decides whether the day is closed. Order and duplicates do not count. */
const materialHolidays = (holidays: any): string[] => {
    if (!Array.isArray(holidays)) return [];
    const seen: Record<string, true> = {};
    holidays.forEach((item) => {
        if (!isPlainObject(item)) return;
        const key = `${asString(item.from)}|${asString(item.to)}|${asString(item.title)}`;
        if (key === "||") return;
        seen[key] = true;
    });
    return Object.keys(seen).sort();
};

const materialBusinessHours = (raw: any): MaterialValue => {
    const node = asNode(raw);
    const closed = isPlainObject(node.closed_hour_action) ? node.closed_hour_action : {};
    const present =
        isPresent(node.type) ||
        isPresent(node.value) ||
        isPresent(node.holidays) ||
        isPresent(leafOf(closed.type)) ||
        isPresent(leafOf(closed.value)) ||
        isPresent(closed.enabled);
    const type = asLower(node.type) || ALL_HOURS;
    const closedOn = asBool(closed.enabled);
    return {
        present,
        value: {
            type,
            /* The week only matters when the clock is consulted at all. */
            schedule: type === ALL_HOURS ? null : materialSchedule(node.value),
            holidays: materialHolidays(node.holidays),
            closed_hour_action: closedOn
                ? { type: asUpper(leafOf(closed.type)), value: asUpper(leafOf(closed.value)) }
                : null,
        },
    };
};

const materialRegional = (raw: any): MaterialValue => {
    const node = asNode(raw);
    const timezone = leafOf(node.timezone);
    const country = leafOf(node.country);
    return {
        present: isPresent(timezone) || isPresent(country),
        value: { timezone: asLower(timezone), country: asLower(country) },
    };
};

const materialRole = (node: any): MaterialValue => {
    const value = leafOf(node);
    return { present: isPresent(value), value: asString(value) };
};

const MATERIAL_READERS: Record<PolicyField, (node: any) => MaterialValue> = {
    voicemail: materialVoicemail,
    recording: materialRecording,
    transcription: materialToggle,
    ai_call_monitoring: materialToggle,
    display_number: materialDisplayNumber,
    business_hours: materialBusinessHours,
    regional: materialRegional,
    role: materialRole,
};

/* Exported so a test (or a log line) can show what the comparison actually saw. */
export const materialValueForRule = (settings: any, field: PolicyField): MaterialValue =>
    MATERIAL_READERS[field](readPath(settings, ruleNodePath(field)));

/**
 * The locked rules an incoming settings object would change.
 *
 * Compares the MATERIAL value (see above) of the incoming node against the stored
 * node for each locked rule. A rule the incoming object carries nothing for is not
 * a change - the update path only touches what it is sent. A locked rule where the
 * person had nothing stored and now sends something that behaves differently from
 * nothing IS a change: the company said hands off. Sending back the same behaviour
 * in a different shape is never a change.
 *
 * Returns the offending rule names; empty means the update may go ahead.
 */
export const lockedFieldViolations = (
    companySettings: any,
    storedSettings: any,
    incomingSettings: any,
): PolicyField[] => {
    if (companySettings == null || !isPlainObject(incomingSettings)) return [];

    const violations: PolicyField[] = [];
    RULE_FIELDS.forEach((field) => {
        if (!readRuleFlags(companySettings, field).locked) return;
        const incoming = materialValueForRule(incomingSettings, field);
        if (!incoming.present) return;
        const stored = materialValueForRule(storedSettings, field);
        if (canonical(stored.value) !== canonical(incoming.value)) violations.push(field);
    });

    return violations;
};
