/* Reads and writes one company's own record - name and postal address.
 *
 * The company is always the one on the caller's session. Nothing here takes
 * a uuid from a request body, so a company admin cannot reach another
 * company's row through this service.
 *
 * Writes go through `Company.update` with only the keys the validator
 * accepted. Sequelize strips `undefined` before writing, and the validator
 * never produces `undefined` for a sent key, so an omitted field stays as it
 * was and a sent field is written exactly.
 *
 * Change log
 * ----------
 * The main database has no audit table for companies (the per-section
 * `company_settings_history` lives in each tenant database, reached through
 * tenant-api, and records settings sections, not the companies row). Rather
 * than invent a table for six columns, every real change writes one JSON
 * line to the service log, prefixed `[company-self]`, with who, which
 * company, and each field's old and new value. `pm2 logs default-api` or
 * `grep '\[company-self\]'` finds them. A save that changes nothing is
 * logged as such and does not touch the row. */

/* Relative on purpose: a compiled copy of this file works even if it is
   dropped into dist by hand without tsc-alias. */
import Company from "../models/Company";
import {
    COMPANY_SELF_READ_COLUMNS,
    CompanySelfInput,
    changedCompanyFields,
    pickCompanySelf,
} from "./companySelfLogic";

export interface CompanySelfRow {
    uuid: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postal_code: string | null;
    updated_at: string | Date | null;
}

export interface CompanySelfActor {
    uuid: string;
    email?: string;
    ip?: string;
}

export const readSelfCompany = async (companyUuid: string): Promise<CompanySelfRow | null> => {
    const row: any = await Company.findOne({
        where: { uuid: companyUuid },
        attributes: [...COMPANY_SELF_READ_COLUMNS],
        raw: true,
    });
    return (pickCompanySelf(row) as CompanySelfRow | null) || null;
};

export interface WriteSelfCompanyResult {
    row: CompanySelfRow;
    changed: string[];
}

export const writeSelfCompany = async (
    companyUuid: string,
    values: Partial<CompanySelfInput>,
    actor: CompanySelfActor,
): Promise<WriteSelfCompanyResult | null> => {
    const before = await readSelfCompany(companyUuid);
    if (!before) return null;

    const diff = changedCompanyFields(before, values);
    if (!diff.length) {
        console.info(`[company-self] ${JSON.stringify({ at: new Date().toISOString(), company_uuid: companyUuid, by: actor.uuid, email: actor.email, ip: actor.ip, changed: [] })}`);
        return { row: before, changed: [] };
    }

    /* Only the keys the validator accepted, and only those that differ. */
    const data: Partial<CompanySelfInput> = {};
    for (const { field, to } of diff) (data as any)[field] = to;

    const [count] = await Company.update(data as any, { where: { uuid: companyUuid } });
    if (count === 0) return null;

    console.info(`[company-self] ${JSON.stringify({
        at: new Date().toISOString(),
        company_uuid: companyUuid,
        by: actor.uuid,
        email: actor.email,
        ip: actor.ip,
        changed: diff,
    })}`);

    const after = await readSelfCompany(companyUuid);
    return after ? { row: after, changed: diff.map((d) => d.field) } : null;
};
