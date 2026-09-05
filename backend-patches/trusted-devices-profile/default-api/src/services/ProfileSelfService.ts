/* Reads and writes the signed-in person's own five profile fields.
 *
 * Why raw SQL and not the User model
 * ----------------------------------
 * `pronouns` and `interface_language` are new columns. Declaring them on the
 * User model would make Sequelize SELECT them in every `User.findOne` that has
 * no attributes list - and if a server ran that build before the migration,
 * every one of those queries, login included, would fail with "unknown
 * column". Keeping the two columns out of the model means the rest of the API
 * cannot notice them, and this service is the only code that reads them, after
 * a guard has made sure they exist.
 *
 * The guard
 * ---------
 * The first call on each process looks at `users` and adds whichever of the two
 * columns is missing (the migration does the same and is the proper way; the
 * guard covers a server where the migration was not run). The check is cached
 * as a promise so two requests arriving together share one ALTER. If the
 * columns still cannot be found afterwards - no ALTER privilege, say - the
 * request fails with a clear message rather than saving three fields and
 * silently dropping two. */

import { QueryTypes } from "sequelize";
import { sequelize } from "@/config/database";
import { SELF_PROFILE_NEW_COLUMNS, SelfProfileInput, missingColumns } from "./profileSelfLogic";

let ensured: Promise<void> | null = null;

const columnsOfUsers = async (): Promise<string[]> => {
    const described: any = await sequelize.getQueryInterface().describeTable("users");
    return Object.keys(described || {});
};

export const ensureSelfProfileColumns = (): Promise<void> => {
    if (!ensured) {
        ensured = (async () => {
            const missing = missingColumns(await columnsOfUsers());
            for (const name of missing) {
                const def = SELF_PROFILE_NEW_COLUMNS.find((c) => c.name === name);
                if (!def) continue;
                try {
                    await sequelize.query(`ALTER TABLE \`users\` ADD COLUMN \`${def.name}\` ${def.sql}`);
                    console.warn(`[profile-self] added users.${def.name} (the migration had not been run)`);
                } catch (err: any) {
                    /* A parallel process may have added it a moment ago. */
                    if (!/duplicate column/i.test(String(err?.message || err))) throw err;
                }
            }
            const still = missingColumns(await columnsOfUsers());
            if (still.length) {
                throw new Error(`users.${still.join(", users.")} missing and could not be added; run the migration.`);
            }
        })().catch((err) => {
            /* Do not cache a failure: the next request tries again. */
            ensured = null;
            throw err;
        });
    }
    return ensured;
};

/* For tests and for a process that knows the migration just ran. */
export const resetSelfProfileColumnsCheck = (): void => {
    ensured = null;
};

export interface SelfProfileRow {
    uuid: string;
    first_name: string;
    last_name: string;
    job_title: string | null;
    pronouns: string | null;
    interface_language: string | null;
}

export const readSelfProfile = async (userUuid: string): Promise<SelfProfileRow | null> => {
    await ensureSelfProfileColumns();
    const rows: any[] = await sequelize.query(
        "select uuid, first_name, last_name, job_title, pronouns, interface_language from users where uuid = ? and deleted_at is null limit 1",
        { replacements: [userUuid], type: QueryTypes.SELECT },
    );
    return (rows[0] as SelfProfileRow) || null;
};

export const writeSelfProfile = async (userUuid: string, values: Partial<SelfProfileInput>): Promise<SelfProfileRow | null> => {
    await ensureSelfProfileColumns();
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, value] of Object.entries(values)) {
        sets.push(`\`${key}\` = ?`);
        params.push(value ?? null);
    }
    if (sets.length) {
        sets.push("`updated_at` = now()");
        params.push(userUuid);
        await sequelize.query(`update users set ${sets.join(", ")} where uuid = ? and deleted_at is null`, {
            replacements: params,
        });
    }
    return readSelfProfile(userUuid);
};
