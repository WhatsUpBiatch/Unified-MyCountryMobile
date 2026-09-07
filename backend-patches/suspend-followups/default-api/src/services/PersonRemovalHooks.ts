/* What happens on the switch and in the queues when a person is removed.
 *
 * Removal is `User.destroy({ where: { uuid, company_uuid }, transaction })` in
 * UserController.deleteUser (a soft delete: users is paranoid). That
 * controller is off limits for this change, so the follow-ups hang off the
 * model instead: User.ts registers `afterBulkDestroy` -> this file. It fires
 * for every bulk destroy of users, wherever it is called from, which is what
 * we want: a removed person should always lose their phone and their queue
 * seats.
 *
 * Both follow-ups are best effort and run AFTER the transaction commits
 * (Sequelize's transaction.afterCommit), so a rolled-back removal kicks
 * nobody. They never throw into the delete.
 *
 *   1. RegistrationKickService.kickRegistration(extension, domain)
 *      - drop the phone's registration now rather than at its next REGISTER.
 *   2. QueueMembershipService.setMembership(..., "suspend", reason "removed")
 *      - mark them in every queue so the agent service stops offering them;
 *        the marker keeps a 72-hour restore exact. The purge (DeletedUserService)
 *        turns that into "remove" once the window closes.
 *
 * A destroy whose `where` names no single uuid (a whole-company wipe) is
 * logged and skipped: those paths delete the company's queues as well.
 */

import { sequelize } from "@/config/database";
import RegistrationKickService, { domainFromDbName } from "@/services/RegistrationKickService";
import QueueMembershipService from "@/services/QueueMembershipService";

export interface RemovalTarget {
    uuid: string;
    company_uuid: string | null;
}

/** The one person a `destroy({ where })` names, or null when it names none or many. Pure. */
export function targetFromWhere(where: any): RemovalTarget | null {
    if (!where || typeof where !== "object") return null;
    const uuid = where.uuid;
    if (typeof uuid !== "string" || !uuid.trim()) return null;
    const company = where.company_uuid;
    return { uuid: uuid.trim(), company_uuid: typeof company === "string" && company.trim() ? company.trim() : null };
}

export default class PersonRemovalHooks {
    /** Sequelize `afterBulkDestroy` hook for the User model. Never throws. */
    static afterBulkDestroy(options: any): void {
        try {
            if (options?.hooks === false) return;
            const target = targetFromWhere(options?.where);
            if (!target) {
                console.log("PersonRemovalHooks: bulk destroy without a single uuid - no phone kick, no queue change");
                return;
            }
            const run = () => {
                void PersonRemovalHooks.onRemoved(target).catch((error: any) => {
                    console.error("PersonRemovalHooks: follow-ups failed:", error?.message || error);
                });
            };
            const transaction = options?.transaction;
            if (transaction && typeof transaction.afterCommit === "function") transaction.afterCommit(run);
            else setImmediate(run);
        } catch (error: any) {
            console.error("PersonRemovalHooks: hook error:", error?.message || error);
        }
    }

    /** Look the removed row up (it is soft-deleted, so plain SQL) and run both follow-ups. */
    static async onRemoved(target: RemovalTarget): Promise<void> {
        const [rows]: any = await sequelize.query(
            "SELECT u.uuid, u.company_uuid, u.extension, c.db_name FROM users u " +
                "LEFT JOIN companies c ON c.uuid = u.company_uuid WHERE u.uuid = :uuid" +
                (target.company_uuid ? " AND u.company_uuid = :company_uuid" : "") +
                " LIMIT 1",
            { replacements: { uuid: target.uuid, company_uuid: target.company_uuid } },
        );
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row) {
            console.log(`PersonRemovalHooks: removed user ${target.uuid} not found for follow-ups`);
            return;
        }
        const company_uuid = String(row.company_uuid ?? target.company_uuid ?? "");
        const domain = domainFromDbName(row.db_name);
        const context = `(removed, company ${company_uuid})`;

        await Promise.all([
            RegistrationKickService.kickRegistration(row.extension, domain, context),
            QueueMembershipService.setMembership(
                QueueMembershipService.systemActor(company_uuid, String(row.db_name ?? ""), domain),
                target.uuid,
                "suspend",
                { extension: row.extension, reason: "removed" },
                context,
            ),
        ]);
    }
}
