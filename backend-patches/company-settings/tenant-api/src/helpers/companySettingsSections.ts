/* The shape of the `company_settings` table, and how the old record maps onto it.
 *
 * WHAT CHANGES
 *
 * Every company-wide setting used to live in one row of `user_template` named
 * "Company Default": a `settings` JSON blob with one top-level key per admin screen
 * (`operational_hours`, `recording`, `company_security`, ...) and a `greetings` blob
 * beside it. Ten screens rewrote the whole blob, so two admins saving different
 * screens at the same time overwrote each other, and nothing recorded who changed
 * what.
 *
 * `company_settings` is one row per section instead: the `settings` key becomes the
 * section name, the value becomes that row's JSON. `greetings` is a section like any
 * other. Each row carries a version and every save writes a history row.
 *
 * WHAT THIS FILE IS
 *
 * The pure part: the section-name rule, the split of an old record into rows, and the
 * fold of rows back into the object shape the rest of the platform already reads.
 * No database, no clock, so it can be tested with plain objects.
 */

/* Lower-case, starts with a letter, underscores and digits allowed, 2 to 64
   characters. Every existing top-level key in the blob already fits this. */
export const SECTION_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

export const GREETINGS_SECTION = "greetings";

export const isValidSectionName = (section: unknown): section is string =>
    typeof section === "string" && SECTION_NAME_RE.test(section);

export interface SectionRow {
    section: string;
    settings: any;
}

/* The column is declared as JSON but has been written as a JSON string in places,
   so both shapes turn up. Anything unreadable becomes an empty object. */
export const toObject = (value: unknown): Record<string, any> => {
    if (!value) return {};
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch (error) {
            return {};
        }
    }
    if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
    return {};
};

/* A section's value must be JSON that is an object or an array. Scalars and null are
   refused: a section is a screen's whole record, never a single value. */
export const isValidSectionSettings = (value: unknown): boolean =>
    value !== null && typeof value === "object";

export interface SplitResult {
    rows: SectionRow[];
    /* Top-level keys of the old blob that could not become a section because their
       name does not fit the rule. Reported, never silently dropped. */
    skipped: string[];
}

/**
 * Split one "Company Default" record into rows.
 *
 * One row per top-level key of `settings`, plus one `greetings` row when the
 * greetings blob has anything in it. A `settings` key literally named `greetings`
 * would collide with that row; the greetings blob wins, because that is what the
 * platform has always read greetings from, and the collision is reported in
 * `skipped`.
 */
export const splitTemplateIntoSections = (settings: unknown, greetings: unknown): SplitResult => {
    const rows: SectionRow[] = [];
    const skipped: string[] = [];

    const settingsObject = toObject(settings);
    const greetingsObject = toObject(greetings);
    const hasGreetings = Object.keys(greetingsObject).length > 0;

    Object.keys(settingsObject).forEach((key) => {
        const value = settingsObject[key];
        if (!isValidSectionName(key) || (key === GREETINGS_SECTION && hasGreetings)) {
            skipped.push(key);
            return;
        }
        if (!isValidSectionSettings(value)) {
            skipped.push(key);
            return;
        }
        rows.push({ section: key, settings: value });
    });

    if (hasGreetings) {
        rows.push({ section: GREETINGS_SECTION, settings: greetingsObject });
    }

    return { rows, skipped };
};

export interface FoldedSettings {
    settings: Record<string, any>;
    greetings: Record<string, any>;
}

/**
 * The reverse: rows back into the `{ settings, greetings }` pair every existing
 * reader of the company record expects. Used so the policy code can read
 * `company_settings` and the old template row through one shape.
 */
export const foldSectionsIntoTemplate = (rows: SectionRow[]): FoldedSettings => {
    const settings: Record<string, any> = {};
    let greetings: Record<string, any> = {};

    (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!row || !isValidSectionName(row.section)) return;
        const value = typeof row.settings === "string" ? safeParse(row.settings) : row.settings;
        if (row.section === GREETINGS_SECTION) {
            greetings = toObject(value);
            return;
        }
        settings[row.section] = value;
    });

    return { settings, greetings };
};

const safeParse = (value: string): any => {
    try {
        return JSON.parse(value);
    } catch (error) {
        return value;
    }
};
