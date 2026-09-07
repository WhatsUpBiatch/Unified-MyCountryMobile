/* The rules for what a person may change about themselves, with no database
   and no imports so they can be unit-tested and shared word for word with the
   screen.

   Five fields, nothing else. Role, email, extension, site: not here, on
   purpose. `/api/user/update` takes a whole record and lets a body carry a
   role; this endpoint takes five named strings and drops everything else on
   the floor. */

export const FIRST_NAME_MAX = 50;
export const LAST_NAME_MAX = 50;
/* users.job_title is varchar(30) and the database is strict. */
export const JOB_TITLE_MAX = 30;
export const PRONOUNS_MAX = 40;
export const INTERFACE_LANGUAGE_MAX = 10;

export const SELF_PROFILE_FIELDS = ["first_name", "last_name", "job_title", "pronouns", "interface_language"] as const;
export type SelfProfileField = (typeof SELF_PROFILE_FIELDS)[number];

export interface SelfProfileInput {
    first_name?: string;
    last_name?: string;
    job_title?: string | null;
    pronouns?: string | null;
    interface_language?: string | null;
}

export type SanitiseResult = { ok: true; values: Partial<SelfProfileInput> } | { ok: false; message: string };

/* Language tags like "en", "en-US", "pt-BR": letters, an optional region. */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

const cleanText = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();

/* Only the keys that were sent are returned, so a screen that saves two fields
   does not blank the other three. `null` (or an empty string) on an optional
   field means "clear it". */
export const sanitiseSelfProfile = (body: unknown): SanitiseResult => {
    const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const values: Partial<SelfProfileInput> = {};

    if ("first_name" in raw) {
        const v = cleanText(raw.first_name);
        if (v.length < 2) return { ok: false, message: "First name needs at least 2 characters." };
        if (v.length > FIRST_NAME_MAX) return { ok: false, message: `First name can be at most ${FIRST_NAME_MAX} characters.` };
        values.first_name = v;
    }
    if ("last_name" in raw) {
        const v = cleanText(raw.last_name);
        if (v.length < 2) return { ok: false, message: "Last name needs at least 2 characters." };
        if (v.length > LAST_NAME_MAX) return { ok: false, message: `Last name can be at most ${LAST_NAME_MAX} characters.` };
        values.last_name = v;
    }
    if ("job_title" in raw) {
        const v = cleanText(raw.job_title);
        if (v.length > JOB_TITLE_MAX) return { ok: false, message: `Job title can be at most ${JOB_TITLE_MAX} characters.` };
        values.job_title = v || null;
    }
    if ("pronouns" in raw) {
        const v = cleanText(raw.pronouns);
        if (v.length > PRONOUNS_MAX) return { ok: false, message: `Pronouns can be at most ${PRONOUNS_MAX} characters.` };
        values.pronouns = v || null;
    }
    if ("interface_language" in raw) {
        const v = cleanText(raw.interface_language);
        if (v && (v.length > INTERFACE_LANGUAGE_MAX || !LANGUAGE_TAG.test(v))) {
            return { ok: false, message: "Interface language must be a short code like en or en-US." };
        }
        values.interface_language = v || null;
    }

    if (!Object.keys(values).length) {
        return { ok: false, message: "Nothing to save. Send at least one of: " + SELF_PROFILE_FIELDS.join(", ") + "." };
    }
    return { ok: true, values };
};

/* The two new columns, as the guard and the migration both need them. One
   definition so they cannot drift. */
export const SELF_PROFILE_NEW_COLUMNS: ReadonlyArray<{ name: "pronouns" | "interface_language"; sql: string }> = [
    { name: "pronouns", sql: "VARCHAR(40) NULL" },
    { name: "interface_language", sql: "VARCHAR(10) NULL" },
];

export const missingColumns = (present: Iterable<string>): string[] => {
    const have = new Set(Array.from(present, (c) => String(c).toLowerCase()));
    return SELF_PROFILE_NEW_COLUMNS.filter((c) => !have.has(c.name)).map((c) => c.name);
};
