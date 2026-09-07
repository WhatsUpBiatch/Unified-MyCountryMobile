/* Removed people: the 72-hour window, the list, restore, and the purge.
 *
 * Removing a person is a soft delete (users is a paranoid model: deleted_at is
 * set, the row stays). That is unchanged. What was missing:
 *
 *   - nothing ever freed the e-mail: users.email is UNIQUE and the removed row
 *     kept it, so the address could never be used for a new person;
 *   - there was no way to see who was removed, or to bring them back.
 *
 * So: a removed person can be listed and restored for RESTORE_WINDOW_HOURS.
 * After that the row is purged - it stays for reports that join on it, but its
 * e-mail is rewritten to a tombstone and its phone cleared, which frees both.
 * The purge is lazy (run on the paths that care: add person, validate, list,
 * restore) so it needs no cron and is safe on a box that runs no crons.
 */

import { Op, Transaction } from "sequelize";
import { sequelize } from "@/config/database";
import User from "@/models/User";
import CompanyLicense from "@/models/CompanyLicense";
import Company from "@/models/Company";
import {
    isTombstonedEmail,
    isWithinRestoreWindow,
    restoreDeadline,
    RESTORE_WINDOW_HOURS,
    tombstoneEmail,
} from "@/helpers/removalRouting";

export interface DeletedUserRow {
    uuid: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    extension: number | null;
    role: string | null;
    role_uuid: string | null;
    custom_role_uuid: string | null;
    site_uuid: string | null;
    deleted_at: Date;
    restore_until: Date;
}

export type RestoreResult =
    | { ok: true; user: any; licence: "reused" | "created" }
    | { ok: false; status: number; message: string };

export default class DeletedUserService {
    /** Rewrite the e-mail and clear the phone of rows removed longer ago than the window. */
    static async purgeExpired(company_uuid: string): Promise<number> {
        const cutoff = new Date(Date.now() - RESTORE_WINDOW_HOURS * 60 * 60 * 1000);
        const rows: any[] = await User.findAll({
            where: {
                company_uuid,
                deleted_at: { [Op.ne]: null, [Op.lt]: cutoff } as any,
            },
            attributes: ["uuid", "email", "phone", "deleted_at"],
            paranoid: false,
            raw: true,
        });

        let purged = 0;
        for (const row of rows) {
            if (isTombstonedEmail(row.email)) continue;
            const email = tombstoneEmail(String(row.email ?? ""), String(row.uuid));
            await User.update(
                { email, phone: null } as any,
                { where: { uuid: row.uuid, company_uuid }, paranoid: false, hooks: false } as any,
            );
            console.log(`DeletedUserService: purged user ${row.uuid} (removed ${new Date(row.deleted_at).toISOString()}) - e-mail freed`);
            purged++;
        }
        return purged;
    }

    /** People removed within the window, newest first. */
    static async listDeleted(company_uuid: string): Promise<DeletedUserRow[]> {
        await this.purgeExpired(company_uuid);
        const cutoff = new Date(Date.now() - RESTORE_WINDOW_HOURS * 60 * 60 * 1000);
        const rows: any[] = await User.findAll({
            where: {
                company_uuid,
                deleted_at: { [Op.ne]: null, [Op.gte]: cutoff } as any,
            },
            attributes: [
                "uuid", "first_name", "last_name", "email", "phone", "extension",
                "role", "role_uuid", "custom_role_uuid", "site_uuid", "deleted_at",
            ],
            order: [["deleted_at", "DESC"]],
            paranoid: false,
            raw: true,
        });

        return rows
            .filter((row) => !isTombstonedEmail(row.email))
            .map((row) => ({ ...row, restore_until: restoreDeadline(row.deleted_at) }));
    }

    /**
     * Bring a removed person back. Restores the row, gives them a licence
     * (a free one if there is one, otherwise a new one if the plan has room).
     * Routing that was cleared when they were removed is NOT put back - it was
     * removed from other people's records, and there is no copy of it.
     */
    static async restore(company_uuid: string, uuid: string): Promise<RestoreResult> {
        await this.purgeExpired(company_uuid);

        const row: any = await User.findOne({
            where: { uuid, company_uuid },
            paranoid: false,
        });
        if (!row || !row.deleted_at) {
            return { ok: false, status: 404, message: "No removed person with that id was found." };
        }
        if (isTombstonedEmail(row.email) || !isWithinRestoreWindow(row.deleted_at)) {
            return { ok: false, status: 410, message: `That person was removed more than ${RESTORE_WINDOW_HOURS} hours ago and can no longer be restored. Add them again as a new person.` };
        }

        /* Their e-mail and extension are still theirs (the soft-deleted row kept
           both, and both are unique), so nothing else can have taken them. */

        const company: any = await Company.findOne({ where: { uuid: company_uuid }, attributes: ["uuid", "licenses"], raw: true });
        const activeUsers = await User.count({ where: { company_uuid } });
        const licences = Number(company?.licenses ?? 0);

        const freeLicence: any = await CompanyLicense.findOne({
            where: { company_uuid, user_uuid: null },
        });
        if (!freeLicence && activeUsers >= licences) {
            return {
                ok: false,
                status: 409,
                message: `No free licence: ${activeUsers} of ${licences} in use. Buy a licence or remove somebody else first.`,
            };
        }

        const transaction: Transaction = await sequelize.transaction();
        try {
            await row.restore({ transaction });

            let licence: "reused" | "created";
            if (freeLicence) {
                await freeLicence.update({ user_uuid: uuid, is_license_revoked: false }, { transaction });
                licence = "reused";
            } else {
                await CompanyLicense.create({ user_uuid: uuid, company_uuid } as any, { transaction });
                licence = "created";
            }

            await transaction.commit();
            const restored: any = await User.findOne({
                where: { uuid, company_uuid },
                attributes: ["uuid", "first_name", "last_name", "email", "extension", "role", "role_uuid", "custom_role_uuid", "status"],
                raw: true,
            });
            console.log(`DeletedUserService: restored user ${uuid} for company ${company_uuid} (licence ${licence})`);
            return { ok: true, user: restored, licence };
        } catch (error: any) {
            await transaction.rollback();
            return { ok: false, status: 500, message: error?.message || "Restore failed" };
        }
    }
}
