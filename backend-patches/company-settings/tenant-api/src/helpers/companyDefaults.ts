/* The company's own rules, read from the company's own database.
 *
 * WHERE THE RULES LIVE
 *
 * There was never a table for "the rule for everyone". Rather than add one, the
 * website keeps company-wide settings on a reserved row of the existing
 * `user_template` table, named exactly "Company Default". Its `settings` column
 * is a free-form JSON blob and each screen writes its own named section into it:
 * `company_policies`, `company_security`, `admin_scopes`, `cost_centres` and so
 * on. Nothing here invents a column or an endpoint; it reads that row.
 *
 * THE BUG THIS FIXES, WHICH IS NOT THEORETICAL
 *
 * The list this row is fetched through only ever returns rows the person asking
 * created. So a second admin opening Company info saw nothing, was told "nothing
 * saved yet", and saved a second "Company Default" row of their own. The
 * company's rules then sat split across two records, neither admin able to see
 * the other's, and nothing able to say which was the real one.
 *
 * On 30 August 2026 that had already happened to two of the nineteen live
 * companies. On one of them the call-recording and voicemail rules were on one
 * row and the holiday and policy rules were on the other.
 *
 * So this file does two things:
 *
 *   it reads every row called "Company Default", not just one, and
 *   it folds them into a single answer, most recently saved wins.
 *
 * Nothing is deleted and nothing is written. The older copy simply stops being
 * consulted, because it always loses the fold. Once an admin saves again from any
 * screen, the folded answer is written back to one row and the split heals
 * itself. A human can tidy the leftover row afterwards, at their leisure.
 *
 * WHY IT NEVER THROWS
 *
 * This is read on the request path. A company record that cannot be read must
 * mean "no rules have been set", which is how the platform behaves today — never
 * an error, and never a refusal. Every function below returns a safe empty answer
 * rather than raising.
 */

import { QueryTypes } from "sequelize";
import getSequelizeInstance from "@/config/database";

/** The reserved row name. The website uses this exact string. */
export const COMPANY_DEFAULT_TEMPLATE_NAME = "Company Default";

/** One "Company Default" row, folded from however many were found. */
export interface CompanyDefaults {
    /** The row a save should be written back to: the most recently saved one. */
    uuid: string;
    name: string;
    settings: Record<string, any>;
    greetings: Record<string, any>;
    created_by: string | null;
    updated_at: Date | string | null;
    /** How many rows were folded together. More than one means a split record. */
    sourceRowCount: number;
}

/* How long a company's rules are held before being read again. They change
   perhaps twice a year and are consulted on every call-log request, so a minute
   of staleness costs nothing and saves a query per request. Saving from any
   screen clears this straight away, so an admin never sees their own change
   arrive late. */
const CACHE_TTL_MS = 60 * 1000;

/* When the database will not answer, the empty result is held only briefly. Long
   enough to stop a broken database being asked once per request, short enough
   that the real rules come back almost as soon as it recovers. */
const FAILURE_CACHE_TTL_MS = 10 * 1000;

interface CacheEntry {
    value: CompanyDefaults | null;
    expiresAt: number;
}

const cache: { [tenantDbName: string]: CacheEntry } = {};

/* The column is declared as JSON but has been written as a JSON string in places,
   so both shapes turn up. Anything unreadable becomes an empty object, which
   every reader already treats as "nothing set". */
const toObject = (value: unknown): Record<string, any> => {
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

/* Oldest first, so a plain left-to-right merge leaves the newest value on top.
   A row with no date sorts oldest, because a row nobody can date is the one least
   safe to let win. */
const byUpdatedAtAscending = (left: any, right: any): number => {
    const leftTime = new Date(left?.updated_at || 0).getTime() || 0;
    const rightTime = new Date(right?.updated_at || 0).getTime() || 0;
    return leftTime - rightTime;
};

/**
 * Fold however many "Company Default" rows were found into one answer.
 *
 * Pure — no database, no clock, no surprises — so the folding rule can be tested
 * on its own.
 *
 * The fold is by top-level section: `company_policies` from the newest row that
 * has one, `company_security` from the newest row that has one, and so on. It is
 * deliberately not a deep merge. Each screen owns its whole section and writes it
 * whole, so mixing two versions of one section field by field would produce a
 * setting nobody ever chose.
 */
export const mergeCompanyDefaultRows = (rows: any[]): CompanyDefaults | null => {
    if (!Array.isArray(rows) || !rows.length) return null;

    const ordered = rows.slice().sort(byUpdatedAtAscending);
    const newest = ordered[ordered.length - 1];

    const settings: Record<string, any> = {};
    const greetings: Record<string, any> = {};

    ordered.forEach((row) => {
        Object.assign(settings, toObject(row?.settings));
        Object.assign(greetings, toObject(row?.greetings));
    });

    return {
        uuid: String(newest?.uuid || ""),
        name: COMPANY_DEFAULT_TEMPLATE_NAME,
        settings,
        greetings,
        created_by: newest?.created_by ? String(newest.created_by) : null,
        updated_at: newest?.updated_at || null,
        sourceRowCount: ordered.length,
    };
};

/**
 * Read the company's rules straight from its database, skipping the cache.
 *
 * Used where an admin must see what they just saved. Returns null when there is
 * no company record, and also when the database could not be reached — the
 * caller cannot tell the two apart on purpose, because both mean the same thing
 * to it: carry on exactly as before.
 */
export const fetchCompanyDefaults = async (
    tenantDbName: string,
): Promise<CompanyDefaults | null> => {
    if (!tenantDbName) return null;

    try {
        const sequelize = getSequelizeInstance(tenantDbName);

        /* A plain query rather than the Sequelize model on purpose. The model
           class in this service is shared and re-pointed at whichever company's
           database was used last, which is safe enough inside one request but not
           worth the risk from a helper that many requests reach. */
        const rows = (await sequelize.query(
            "SELECT uuid, name, settings, greetings, created_by, updated_at " +
                "FROM user_template WHERE name = :name",
            {
                replacements: { name: COMPANY_DEFAULT_TEMPLATE_NAME },
                type: QueryTypes.SELECT,
            },
        )) as any[];

        return mergeCompanyDefaultRows(rows);
    } catch (error) {
        /* Logged, never raised. A company whose rules cannot be read is treated
           as a company that has not set any, which is today's behaviour. */
        console.error(
            `companyDefaults: could not read the company record for ${tenantDbName}.`,
            (error as any)?.message || error,
        );
        return null;
    }
};

/**
 * The same read, held for a minute.
 *
 * This is the one the request path uses.
 */
export const readCompanyDefaults = async (
    tenantDbName: string,
): Promise<CompanyDefaults | null> => {
    if (!tenantDbName) return null;

    const cached = cache[tenantDbName];
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;

    const value = await fetchCompanyDefaults(tenantDbName);
    cache[tenantDbName] = {
        value,
        expiresAt: now + (value ? CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
    };

    return value;
};

/**
 * Forget what was read, so the next read goes to the database.
 *
 * Called after anything saves a template, so an admin who changes a rule sees it
 * take effect on their very next request rather than up to a minute later.
 * Passing no name forgets every company, which is what a bulk change would want.
 */
export const invalidateCompanyDefaults = (tenantDbName?: string): void => {
    if (tenantDbName) {
        delete cache[tenantDbName];
        return;
    }
    Object.keys(cache).forEach((key) => delete cache[key]);
};

/**
 * Put the one true "Company Default" row into a template list.
 *
 * The list query this joins onto only returns rows the person asking created,
 * which is right for the presets people make for themselves and wrong for the
 * company's own rules. This adds the folded company row so every admin sees the
 * same one, and so the next save updates it instead of making another copy.
 *
 * It only ever adds or replaces. It never removes anything and never raises, so
 * if the extra read fails the list comes back exactly as it would have.
 *
 * `nameFilter` is whatever the caller asked to filter names by, so a search for
 * something else does not get the company row pushed into it.
 */
export const withCompanyDefaultRow = async (
    tenantDbName: string,
    rows: any[],
    page: number,
    nameFilter?: string,
): Promise<{ rows: any[]; added: number }> => {
    const safeRows = Array.isArray(rows) ? rows : [];

    try {
        /* Only ever on the first page. Injecting a row into page four would push
           everything after it along and hand back a duplicate. */
        if (Number(page || 1) !== 1) return { rows: safeRows, added: 0 };

        /* Respect a name search. The list matches names loosely, so this does too. */
        const filter = String(nameFilter || "").trim().toLowerCase();
        if (filter && COMPANY_DEFAULT_TEMPLATE_NAME.toLowerCase().indexOf(filter) === -1) {
            return { rows: safeRows, added: 0 };
        }

        const merged = await fetchCompanyDefaults(tenantDbName);
        if (!merged || !merged.uuid) return { rows: safeRows, added: 0 };

        /* If this admin's own copy is already in the list, swap it for the folded
           one so they edit the shared record rather than their private half. */
        const existingIndex = safeRows.findIndex(
            (row: any) => String(row?.name || "") === COMPANY_DEFAULT_TEMPLATE_NAME,
        );

        if (existingIndex !== -1) {
            const next = safeRows.slice();
            next[existingIndex] = merged;
            return { rows: next, added: 0 };
        }

        return { rows: [merged].concat(safeRows), added: 1 };
    } catch (error) {
        console.error(
            `companyDefaults: could not add the company record to the template list for ${tenantDbName}.`,
            (error as any)?.message || error,
        );
        return { rows: safeRows, added: 0 };
    }
};
