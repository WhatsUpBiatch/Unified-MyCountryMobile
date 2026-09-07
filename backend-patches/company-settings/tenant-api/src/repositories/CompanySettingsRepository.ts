/* One row per section, a version on each, and a history row for every save.
 *
 * WHY RAW SQL
 *
 * The Sequelize model classes in this service are shared and re-pointed at whichever
 * company's database was used last (`Model.init` is called per request). That is
 * tolerable inside one request but not for a table that is read on the user update
 * path of another service. Plain parameterised queries against the per-tenant
 * `Sequelize` instance avoid the shared class entirely, the same choice
 * `helpers/companyDefaults.ts` made.
 *
 * WHY THE TABLES ARE CREATED HERE
 *
 * Tenant migrations only run when a tenant database is first created
 * (`default-api/src/services/TenantDatabaseService.ts`). Nothing re-runs them on the
 * nineteen databases that already exist, so a new table has to make itself. The
 * `CREATE TABLE IF NOT EXISTS` below runs once per process per tenant, the first time
 * the table is touched. The migration file in default-api carries the same DDL for
 * new tenants.
 *
 * VERSIONS
 *
 * `version` starts at 1 and goes up by one on every save. A caller that read version
 * N and sends `version: N` with its save is refused with a conflict if the row has
 * moved on, so two admins editing the same screen no longer overwrite each other in
 * silence. A caller that sends no version gets the old last-writer-wins behaviour,
 * which every existing screen relies on until it is taught to send one.
 */

import { QueryTypes, Sequelize, Transaction } from "sequelize";
import getSequelizeInstance from "@/config/database";
import {
    COMPANY_DEFAULT_TEMPLATE_NAME,
    fetchCompanyDefaults,
} from "@/helpers/companyDefaults";
import {
    FoldedSettings,
    SectionRow,
    foldSectionsIntoTemplate,
    isValidSectionName,
    isValidSectionSettings,
    splitTemplateIntoSections,
} from "@/helpers/companySettingsSections";

export const MIGRATION_ACTOR = "migration";

export interface CompanySettingsRow {
    section: string;
    settings: any;
    version: number;
    updated_at: Date | string | null;
    updated_by: string | null;
    updated_by_name: string | null;
}

export interface CompanySettingsHistoryRow {
    id: number;
    section: string;
    settings: any;
    version: number;
    changed_by: string | null;
    changed_by_name: string | null;
    changed_at: Date | string | null;
}

export interface ListResult {
    sections: { [section: string]: CompanySettingsRow };
    migrated_from_template: boolean;
}

export interface EffectiveSettings extends FoldedSettings {
    /* Where the answer came from, so a caller can say so in a log or a screen. */
    source: "company_settings" | "user_template" | "none";
}

/* Raised for the two outcomes the controller turns into a status code. */
export class CompanySettingsError extends Error {
    constructor(
        message: string,
        public status: number,
        public current?: CompanySettingsRow | null,
        public detail?: any,
    ) {
        super(message);
        this.name = "CompanySettingsError";
    }
}

/* utf8mb4_unicode_ci matches the user_template migration this table sits beside. */
const CREATE_COMPANY_SETTINGS_SQL =
    "CREATE TABLE IF NOT EXISTS `company_settings` (" +
    "`id` INT UNSIGNED NOT NULL AUTO_INCREMENT, " +
    "`section` VARCHAR(64) NOT NULL, " +
    "`settings` JSON NOT NULL, " +
    "`version` INT UNSIGNED NOT NULL DEFAULT 1, " +
    "`updated_by` VARCHAR(36) NULL, " +
    "`updated_by_name` VARCHAR(120) NULL, " +
    "`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
    "`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
    "PRIMARY KEY (`id`), " +
    "UNIQUE KEY `company_settings_section` (`section`)" +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

const CREATE_COMPANY_SETTINGS_HISTORY_SQL =
    "CREATE TABLE IF NOT EXISTS `company_settings_history` (" +
    "`id` INT UNSIGNED NOT NULL AUTO_INCREMENT, " +
    "`section` VARCHAR(64) NOT NULL, " +
    "`settings` JSON NOT NULL, " +
    "`version` INT UNSIGNED NOT NULL, " +
    "`changed_by` VARCHAR(36) NULL, " +
    "`changed_by_name` VARCHAR(120) NULL, " +
    "`changed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
    "PRIMARY KEY (`id`), " +
    "KEY `company_settings_history_section` (`section`, `changed_at`)" +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

/* Which tenants this process has already checked. A failed check is not remembered,
   so a database that was briefly unreachable gets checked again next time. */
const ensured: { [tenantDbName: string]: true } = {};

/**
 * Make sure both tables exist. Idempotent; safe to call on every request because it
 * only reaches the database once per tenant per process.
 */
export const ensureCompanySettingsTables = async (
    sequelize: Sequelize,
    tenantDbName?: string,
): Promise<void> => {
    const key = tenantDbName || (sequelize as any)?.config?.database || "";
    if (key && ensured[key]) return;
    await sequelize.query(CREATE_COMPANY_SETTINGS_SQL);
    await sequelize.query(CREATE_COMPANY_SETTINGS_HISTORY_SQL);
    if (key) ensured[key] = true;
};

/* MySQL hands a JSON column back as a string on some driver versions and as an
   object on others. Read both. */
const parseJson = (value: any): any => {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch (error) {
        return value;
    }
};

const toRow = (raw: any): CompanySettingsRow => ({
    section: String(raw?.section || ""),
    settings: parseJson(raw?.settings),
    version: Number(raw?.version || 0),
    updated_at: raw?.updated_at ?? null,
    updated_by: raw?.updated_by ?? null,
    updated_by_name: raw?.updated_by_name ?? null,
});

const toHistoryRow = (raw: any): CompanySettingsHistoryRow => ({
    id: Number(raw?.id || 0),
    section: String(raw?.section || ""),
    settings: parseJson(raw?.settings),
    version: Number(raw?.version || 0),
    changed_by: raw?.changed_by ?? null,
    changed_by_name: raw?.changed_by_name ?? null,
    changed_at: raw?.changed_at ?? null,
});

const ROW_COLUMNS = "section, settings, version, updated_at, updated_by, updated_by_name";

/* How long the folded answer is held for the policy read on the user update path.
   Saves clear it straight away, so an admin never sees their own change arrive late. */
const EFFECTIVE_TTL_MS = 30 * 1000;
const effectiveCache: { [tenantDbName: string]: { value: EffectiveSettings; expiresAt: number } } = {};

export const invalidateEffectiveSettings = (tenantDbName?: string): void => {
    if (tenantDbName) {
        delete effectiveCache[tenantDbName];
        return;
    }
    Object.keys(effectiveCache).forEach((key) => delete effectiveCache[key]);
};

export class CompanySettingsRepository {
    private static async connect(tenantDbName: string): Promise<Sequelize> {
        const sequelize = getSequelizeInstance(tenantDbName);
        await ensureCompanySettingsTables(sequelize, tenantDbName);
        return sequelize;
    }

    private static async selectAll(sequelize: Sequelize, transaction?: Transaction): Promise<CompanySettingsRow[]> {
        const rows = (await sequelize.query(
            `SELECT ${ROW_COLUMNS} FROM company_settings ORDER BY section ASC`,
            { type: QueryTypes.SELECT, transaction },
        )) as any[];
        return rows.map(toRow);
    }

    private static async selectOne(
        sequelize: Sequelize,
        section: string,
        transaction?: Transaction,
        forUpdate: boolean = false,
    ): Promise<CompanySettingsRow | null> {
        const rows = (await sequelize.query(
            `SELECT ${ROW_COLUMNS} FROM company_settings WHERE section = :section${forUpdate ? " FOR UPDATE" : ""}`,
            { replacements: { section }, type: QueryTypes.SELECT, transaction },
        )) as any[];
        return rows.length ? toRow(rows[0]) : null;
    }

    private static async insertHistory(
        sequelize: Sequelize,
        row: { section: string; settings: any; version: number; changed_by: string | null; changed_by_name: string | null },
        transaction?: Transaction,
    ): Promise<void> {
        await sequelize.query(
            "INSERT INTO company_settings_history (section, settings, version, changed_by, changed_by_name) " +
                "VALUES (:section, :settings, :version, :changed_by, :changed_by_name)",
            {
                replacements: {
                    section: row.section,
                    settings: JSON.stringify(row.settings),
                    version: row.version,
                    changed_by: row.changed_by,
                    changed_by_name: row.changed_by_name,
                },
                type: QueryTypes.INSERT,
                transaction,
            },
        );
    }

    /**
     * Copy the "Company Default" template row into sections, once.
     *
     * Only when the table is empty. The template row is left exactly as it was: the
     * old screens keep reading it until each is moved over, and nothing is lost if
     * this has to be rolled back. Returns how many rows were written.
     */
    static migrateFromTemplate = async (tenantDbName: string, sequelize: Sequelize): Promise<number> => {
        const template = await fetchCompanyDefaults(tenantDbName);
        if (!template) return 0;

        const { rows, skipped } = splitTemplateIntoSections(template.settings, template.greetings);
        if (skipped.length) {
            console.warn(
                `companySettings: ${tenantDbName} template keys not migrated (bad section name): ${skipped.join(", ")}`,
            );
        }
        if (!rows.length) return 0;

        const transaction = await sequelize.transaction();
        try {
            /* Somebody may have saved a section while this request was reading the
               template. Re-check under the transaction and stand down if so. */
            const existing = (await sequelize.query(
                "SELECT COUNT(*) AS n FROM company_settings FOR UPDATE",
                { type: QueryTypes.SELECT, transaction },
            )) as any[];
            if (Number(existing?.[0]?.n || 0) > 0) {
                await transaction.rollback();
                return 0;
            }

            for (const row of rows) {
                await sequelize.query(
                    "INSERT INTO company_settings (section, settings, version, updated_by, updated_by_name) " +
                        "VALUES (:section, :settings, 1, :updated_by, :updated_by_name)",
                    {
                        replacements: {
                            section: row.section,
                            settings: JSON.stringify(row.settings),
                            updated_by: MIGRATION_ACTOR,
                            updated_by_name: `Copied from ${COMPANY_DEFAULT_TEMPLATE_NAME}`,
                        },
                        type: QueryTypes.INSERT,
                        transaction,
                    },
                );
                await CompanySettingsRepository.insertHistory(
                    sequelize,
                    {
                        section: row.section,
                        settings: row.settings,
                        version: 1,
                        changed_by: MIGRATION_ACTOR,
                        changed_by_name: `Copied from ${COMPANY_DEFAULT_TEMPLATE_NAME}`,
                    },
                    transaction,
                );
            }

            await transaction.commit();
            invalidateEffectiveSettings(tenantDbName);
            return rows.length;
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    };

    static list = async (tenantDbName: string): Promise<ListResult> => {
        const sequelize = await CompanySettingsRepository.connect(tenantDbName);

        let rows = await CompanySettingsRepository.selectAll(sequelize);
        let migrated = false;

        if (!rows.length) {
            const written = await CompanySettingsRepository.migrateFromTemplate(tenantDbName, sequelize);
            if (written > 0) {
                migrated = true;
                rows = await CompanySettingsRepository.selectAll(sequelize);
            }
        }

        const sections: { [section: string]: CompanySettingsRow } = {};
        rows.forEach((row) => {
            sections[row.section] = row;
        });

        return { sections, migrated_from_template: migrated };
    };

    static get = async (tenantDbName: string, section: string): Promise<CompanySettingsRow | null> => {
        if (!isValidSectionName(section)) {
            throw new CompanySettingsError("Invalid section name", 400);
        }
        const sequelize = await CompanySettingsRepository.connect(tenantDbName);
        return CompanySettingsRepository.selectOne(sequelize, section);
    };

    /**
     * Upsert one section.
     *
     * With `expectedVersion` set, the save is refused (409, current row attached)
     * unless the stored version still matches. Without it, the save always lands.
     * Either way the version goes up by one and a history row is written in the same
     * transaction, so the log can never disagree with the table.
     */
    static save = async (
        tenantDbName: string,
        section: string,
        settings: any,
        actor: { uuid: string | null; name: string | null },
        expectedVersion?: number | null,
    ): Promise<CompanySettingsRow> => {
        if (!isValidSectionName(section)) {
            throw new CompanySettingsError("Invalid section name", 400);
        }
        if (!isValidSectionSettings(settings)) {
            throw new CompanySettingsError("settings must be a JSON object or array", 400);
        }
        if (
            expectedVersion !== undefined &&
            expectedVersion !== null &&
            (!Number.isInteger(expectedVersion) || expectedVersion < 0)
        ) {
            throw new CompanySettingsError("version must be a non-negative integer", 400);
        }

        const sequelize = await CompanySettingsRepository.connect(tenantDbName);
        const transaction = await sequelize.transaction();

        try {
            const current = await CompanySettingsRepository.selectOne(sequelize, section, transaction, true);
            const currentVersion = current ? current.version : 0;

            if (
                expectedVersion !== undefined &&
                expectedVersion !== null &&
                expectedVersion !== currentVersion
            ) {
                await transaction.rollback();
                throw new CompanySettingsError(
                    `This section was changed by someone else (you have version ${expectedVersion}, the server has ${currentVersion}). Reload and try again.`,
                    409,
                    current,
                );
            }

            const nextVersion = currentVersion + 1;
            const updatedBy = actor.uuid ? String(actor.uuid).slice(0, 36) : null;
            const updatedByName = actor.name ? String(actor.name).slice(0, 120) : null;
            const json = JSON.stringify(settings);

            if (current) {
                await sequelize.query(
                    "UPDATE company_settings SET settings = :settings, version = :version, " +
                        "updated_by = :updated_by, updated_by_name = :updated_by_name, updated_at = CURRENT_TIMESTAMP " +
                        "WHERE section = :section",
                    {
                        replacements: { settings: json, version: nextVersion, updated_by: updatedBy, updated_by_name: updatedByName, section },
                        type: QueryTypes.UPDATE,
                        transaction,
                    },
                );
            } else {
                await sequelize.query(
                    "INSERT INTO company_settings (section, settings, version, updated_by, updated_by_name) " +
                        "VALUES (:section, :settings, :version, :updated_by, :updated_by_name)",
                    {
                        replacements: { section, settings: json, version: nextVersion, updated_by: updatedBy, updated_by_name: updatedByName },
                        type: QueryTypes.INSERT,
                        transaction,
                    },
                );
            }

            await CompanySettingsRepository.insertHistory(
                sequelize,
                { section, settings, version: nextVersion, changed_by: updatedBy, changed_by_name: updatedByName },
                transaction,
            );

            await transaction.commit();
            invalidateEffectiveSettings(tenantDbName);

            const saved = await CompanySettingsRepository.selectOne(sequelize, section);
            if (!saved) throw new CompanySettingsError("Saved row could not be read back", 500);
            return saved;
        } catch (error) {
            if (!(error instanceof CompanySettingsError)) {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    /* already rolled back or committed */
                }
            }
            throw error;
        }
    };

    static history = async (
        tenantDbName: string,
        section: string,
        limit: number = 50,
    ): Promise<CompanySettingsHistoryRow[]> => {
        if (!isValidSectionName(section)) {
            throw new CompanySettingsError("Invalid section name", 400);
        }
        const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
        const sequelize = await CompanySettingsRepository.connect(tenantDbName);
        const rows = (await sequelize.query(
            "SELECT id, section, settings, version, changed_by, changed_by_name, changed_at " +
                "FROM company_settings_history WHERE section = :section ORDER BY id DESC LIMIT :limit",
            { replacements: { section, limit: safeLimit }, type: QueryTypes.SELECT },
        )) as any[];
        return rows.map(toHistoryRow);
    };

    /**
     * The company's rules as one `{ settings, greetings }` object, for the code that
     * seeds and locks a person's settings.
     *
     * `company_settings` first; when it is empty, the folded "Company Default"
     * template row; when there is neither, empty objects. Never throws: on the user
     * update path an unreadable company record must mean "no rules", which is what
     * the platform did before this existed.
     */
    static effective = async (tenantDbName: string): Promise<EffectiveSettings> => {
        const empty: EffectiveSettings = { source: "none", settings: {}, greetings: {} };
        if (!tenantDbName) return empty;

        const cached = effectiveCache[tenantDbName];
        const now = Date.now();
        if (cached && cached.expiresAt > now) return cached.value;

        let value: EffectiveSettings = empty;
        try {
            const sequelize = await CompanySettingsRepository.connect(tenantDbName);
            const rows = await CompanySettingsRepository.selectAll(sequelize);
            if (rows.length) {
                const folded = foldSectionsIntoTemplate(rows as SectionRow[]);
                value = { source: "company_settings", ...folded };
            } else {
                const template = await fetchCompanyDefaults(tenantDbName);
                if (template) {
                    value = { source: "user_template", settings: template.settings, greetings: template.greetings };
                }
            }
        } catch (error) {
            console.error(
                `companySettings: could not read the company rules for ${tenantDbName}.`,
                (error as any)?.message || error,
            );
            return empty;
        }

        effectiveCache[tenantDbName] = { value, expiresAt: now + EFFECTIVE_TTL_MS };
        return value;
    };
}
