/* The rules for what a company admin may change about their own company.
   No database, no imports, so the rules can be unit-tested on their own.

   Six columns of the `companies` row, and nothing else:
   name, address, city, state, country, postal_code.

   Everything else on that row - plan, billing, Stripe, allowed countries,
   plan features, db_name - is not on this list, so a body that sends it is
   simply ignored. Compare `/api/admin/company/upsert`, which is for platform
   staff and takes plan_features and allow_country too.

   Sizes come from the columns themselves (src/models/Company.ts), because the
   database is strict and a value one character too long fails the whole
   save: name VARCHAR(100), address VARCHAR(100), city/state/country
   VARCHAR(35), postal_code VARCHAR(10).

   Country and state are stored as ISO codes, because that is what signup
   writes ("IN", "MH") and what the website's selects send. Country must be a
   two-letter ISO 3166-1 code. State is the subdivision part of an ISO 3166-2
   code as the website's country/state list gives it: usually letters ("MH",
   "CA"), sometimes digits ("13" for a Japanese prefecture, "05"), up to ten
   characters. Both are upper-cased before checking so "in" and "IN" are the
   same thing. Cities have no code and are stored by name. */

export const COMPANY_NAME_MIN = 2;
export const COMPANY_NAME_MAX = 100;
export const COMPANY_ADDRESS_MAX = 100;
export const COMPANY_CITY_MAX = 35;
export const COMPANY_POSTAL_CODE_MAX = 10;

export const COMPANY_SELF_FIELDS = ["name", "address", "city", "state", "country", "postal_code"] as const;
export type CompanySelfField = (typeof COMPANY_SELF_FIELDS)[number];

/* What `/api/company/self` returns. `uuid` and `updated_at` are read-only. */
export const COMPANY_SELF_READ_COLUMNS = ["uuid", "name", "address", "city", "state", "country", "postal_code", "updated_at"] as const;

export interface CompanySelfInput {
    name?: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postal_code?: string | null;
}

export type CompanySelfSanitiseResult =
    | { ok: true; values: Partial<CompanySelfInput> }
    | { ok: false; message: string };

const COUNTRY_CODE = /^[A-Z]{2}$/;
const STATE_CODE = /^[A-Z0-9]{1,10}$/;
/* Letters, digits, spaces and a dash cover every postal format in use
   ("400001", "SW1A 1AA", "12345-6789"). */
const POSTAL_CODE = /^[A-Za-z0-9][A-Za-z0-9 -]{0,9}$/;

const cleanText = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();

/* Only the keys that were sent come back, so a screen saving one field does
   not blank the other five. On the optional fields, an empty string or null
   means "clear it"; the name can never be cleared. Unknown keys are dropped. */
export const sanitiseCompanySelf = (body: unknown): CompanySelfSanitiseResult => {
    const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const values: Partial<CompanySelfInput> = {};

    if ("name" in raw) {
        const v = cleanText(raw.name);
        if (v.length < COMPANY_NAME_MIN) return { ok: false, message: `Company name needs at least ${COMPANY_NAME_MIN} characters.` };
        if (v.length > COMPANY_NAME_MAX) return { ok: false, message: `Company name can be at most ${COMPANY_NAME_MAX} characters.` };
        values.name = v;
    }
    if ("address" in raw) {
        const v = cleanText(raw.address);
        if (v.length > COMPANY_ADDRESS_MAX) return { ok: false, message: `Street address can be at most ${COMPANY_ADDRESS_MAX} characters.` };
        values.address = v || null;
    }
    if ("city" in raw) {
        const v = cleanText(raw.city);
        if (v.length > COMPANY_CITY_MAX) return { ok: false, message: `City can be at most ${COMPANY_CITY_MAX} characters.` };
        values.city = v || null;
    }
    if ("state" in raw) {
        const v = cleanText(raw.state).toUpperCase();
        if (v && !STATE_CODE.test(v)) return { ok: false, message: "State must be a short code like MH or CA." };
        values.state = v || null;
    }
    if ("country" in raw) {
        const v = cleanText(raw.country).toUpperCase();
        if (v && !COUNTRY_CODE.test(v)) return { ok: false, message: "Country must be a two-letter code like IN or US." };
        values.country = v || null;
    }
    if ("postal_code" in raw) {
        const v = cleanText(raw.postal_code);
        if (v && !POSTAL_CODE.test(v)) {
            return { ok: false, message: `Postal code can be at most ${COMPANY_POSTAL_CODE_MAX} letters, digits, spaces or dashes.` };
        }
        values.postal_code = v || null;
    }

    if (!Object.keys(values).length) {
        return { ok: false, message: "Nothing to save. Send at least one of: " + COMPANY_SELF_FIELDS.join(", ") + "." };
    }
    return { ok: true, values };
};

/* Which of the accepted values actually differ from the row as it is now.
   Used for the change log line and for the `changed` list in the response,
   so saving the same value twice is recorded as no change. Compares as
   strings with empty and null treated alike, because that is how the
   columns hold them. */
export const changedCompanyFields = (
    before: Partial<Record<CompanySelfField, unknown>> | null | undefined,
    values: Partial<CompanySelfInput>,
): Array<{ field: CompanySelfField; from: string | null; to: string | null }> => {
    const norm = (v: unknown): string | null => {
        const s = String(v ?? "").trim();
        return s ? s : null;
    };
    const out: Array<{ field: CompanySelfField; from: string | null; to: string | null }> = [];
    for (const field of COMPANY_SELF_FIELDS) {
        if (!(field in values)) continue;
        const from = norm(before?.[field]);
        const to = norm((values as any)[field]);
        if (from !== to) out.push({ field, from, to });
    }
    return out;
};

/* Only the read-safe columns, whatever the row object carries. */
export const pickCompanySelf = (row: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
    if (!row || typeof row !== "object") return null;
    const out: Record<string, unknown> = {};
    for (const col of COMPANY_SELF_READ_COLUMNS) out[col] = row[col] ?? null;
    return out;
};
