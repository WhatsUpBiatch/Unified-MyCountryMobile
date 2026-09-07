/* Person states: PENDING, ACTIVE, SUSPENDED, REMOVED.
 *
 * users.status ENUM('EXPIRED','ACTIVE','INACTIVE','PENDING') existed, but every
 * tenant-side creation wrote ACTIVE and no tenant screen or API ever changed
 * it, so "invited" and "suspended" did not exist as states a person could be
 * in. Setting INACTIVE by hand stopped the login (AuthController refuses any
 * status but ACTIVE; AuthMiddleware 403s every call) but the phone still
 * registered and rang.
 *
 * What a state means, as of 3 Sep 2026:
 *
 *   PENDING    invited, not yet accepted. Login and API refused (existing
 *              checks: anything but ACTIVE is refused). Phone refused once the
 *              switch patches in backend-patches/person-states are applied.
 *   ACTIVE     normal.
 *   SUSPENDED  an administrator switched them off. Login and API refused, every
 *              session destroyed the moment it is set (the same steps as
 *              logout "all"). Phone refused once the switch patches are
 *              applied. Reversible with one click.
 *   REMOVED    soft-deleted (deleted_at set). Restorable for 72 hours through
 *              services/DeletedUserService.ts. Derived, never stored in status.
 *
 * EXPIRED and INACTIVE stay in the column (platform-admin and expiry crons set
 * them on whole companies) and are shown as "Suspended" to the tenant, since
 * that is what they do to the person.
 *
 * The column is widened on first use (SUSPENDED added to the ENUM) because
 * the migrations in this repository are not reliably run on the live boxes.
 * The check costs one INFORMATION_SCHEMA read per process and is remembered;
 * a failed check is not remembered, so the next request tries again.
 *
 * Who may suspend whom is decided in helpers/roleGuard.ts on resolved system
 * roles, the same way removal is: an administrator, never yourself, never the
 * account owner.
 */

import { Op } from "sequelize";
import { sequelize } from "@/config/database";
import User from "@/models/User";
import DeviceSecurity from "@/models/DeviceSecurityModel";
import QueueAgentModel from "@/models/QueueAgentModel";
import { SocketApiService } from "@/services/SocketApiService";
import RoleResolverService from "@/services/RoleResolverService";
import { IAuth } from "@/interfaces/IRequest";
import { decideAdminAction, decidePersonSuspend } from "@/helpers/roleGuard";
import { RESTORE_WINDOW_HOURS } from "@/helpers/removalRouting";

export type PersonState = "PENDING" | "ACTIVE" | "SUSPENDED" | "REMOVED";

export const PERSON_STATES: ReadonlyArray<PersonState> = ["PENDING", "ACTIVE", "SUSPENDED", "REMOVED"];

/** The ENUM the column must hold. Same list as the migration of the same name. */
export const STATUS_ENUM_VALUES = ["EXPIRED", "ACTIVE", "INACTIVE", "PENDING", "SUSPENDED"] as const;

export interface PersonStateRow {
    uuid: string;
    state: PersonState;
    /** The raw column, for anyone who needs the platform value. */
    status: string | null;
    deleted_at: Date | null;
    /** Only for REMOVED: when the restore window closes. */
    restore_until?: Date | null;
}

export type StateChangeResult =
    | { ok: true; state: PersonState; previous: PersonState; sessions_ended: number; message: string }
    | { ok: false; status: number; message: string };

/** What a stored row is, in the four words the product uses. Pure. */
export function stateOf(row: { status?: unknown; deleted_at?: unknown } | null | undefined): PersonState {
    if (!row) return "REMOVED";
    if (row.deleted_at) return "REMOVED";
    const status = String(row.status ?? "").trim().toUpperCase();
    if (status === "ACTIVE") return "ACTIVE";
    if (status === "PENDING") return "PENDING";
    /* SUSPENDED, and the two platform-side values that do the same thing. */
    return "SUSPENDED";
}

/** "enum('A','B')" -> ["A","B"]; anything else -> null. */
export function enumValues(columnType: unknown): string[] | null {
    const m = /^enum\((.*)\)$/i.exec(String(columnType ?? "").trim());
    if (!m) return null;
    return m[1].split(",").map((part) => part.trim().replace(/^'(.*)'$/, "$1").replace(/''/g, "'"));
}

/** The MODIFY that adds the missing values and keeps nullability and default. */
export function widenStatement(column: { COLUMN_TYPE: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null }): string | null {
    const current = enumValues(column.COLUMN_TYPE);
    if (!current) return null;
    const missing = STATUS_ENUM_VALUES.filter((v) => !current.includes(v));
    if (!missing.length) return null;
    const list = current.concat(missing).map((v) => `'${v.replace(/'/g, "''")}'`).join(",");
    const nullable = String(column.IS_NULLABLE).toUpperCase() === "YES" ? "NULL" : "NOT NULL";
    const def =
        column.COLUMN_DEFAULT === null || column.COLUMN_DEFAULT === undefined
            ? nullable === "NULL" ? " DEFAULT NULL" : ""
            : ` DEFAULT '${String(column.COLUMN_DEFAULT).replace(/'/g, "''")}'`;
    return `ALTER TABLE \`users\` MODIFY COLUMN \`status\` ENUM(${list}) ${nullable}${def}`;
}

let columnChecked = false;

export default class PersonStateService {
    /** Make sure users.status can hold SUSPENDED. Once per process; a failure is retried next time. */
    static async ensureStatusColumn(): Promise<void> {
        if (columnChecked) return;
        const [rows]: any = await sequelize.query(
            "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS " +
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'",
        );
        const column = Array.isArray(rows) ? rows[0] : null;
        if (!column) throw new Error("users.status column not found");
        const sql = widenStatement(column);
        if (sql) {
            console.log(`PersonStateService: widening users.status - ${sql}`);
            await sequelize.query(sql);
        }
        columnChecked = true;
    }

    /** For tests and for a process that must re-check after a rollback. */
    static resetColumnCheck(): void {
        columnChecked = false;
    }

    /** One person's state, removed people included. Null when no such person in this company. */
    static async stateOf(company_uuid: string, uuid: string): Promise<PersonStateRow | null> {
        const row: any = await User.findOne({
            where: { uuid, company_uuid },
            attributes: ["uuid", "status", "deleted_at"],
            paranoid: false,
            raw: true,
        });
        if (!row) return null;
        return this.toRow(row);
    }

    /** Every person in the company: the live ones plus those removed within the window. */
    static async statesForCompany(company_uuid: string): Promise<PersonStateRow[]> {
        const cutoff = new Date(Date.now() - RESTORE_WINDOW_HOURS * 60 * 60 * 1000);
        const rows: any[] = await User.findAll({
            where: {
                company_uuid,
                [Op.or]: [{ deleted_at: null }, { deleted_at: { [Op.gte]: cutoff } }],
            } as any,
            attributes: ["uuid", "status", "deleted_at"],
            paranoid: false,
            raw: true,
        });
        return rows.map((row) => this.toRow(row));
    }

    private static toRow(row: any): PersonStateRow {
        const state = stateOf(row);
        const out: PersonStateRow = {
            uuid: String(row.uuid),
            state,
            status: row.status ?? null,
            deleted_at: row.deleted_at ?? null,
        };
        if (state === "REMOVED" && row.deleted_at) {
            out.restore_until = new Date(new Date(row.deleted_at).getTime() + RESTORE_WINDOW_HOURS * 60 * 60 * 1000);
        }
        return out;
    }

    /**
     * Switch a person off. Their sessions are destroyed the same way logout
     * "all" does it (AuthController.logOutUser with type "all" - a static on
     * the controller, so the steps are repeated here rather than the controller
     * imported into a service): tell the socket service, delete the sessions,
     * and mark them logged out of every queue.
     */
    static async suspend(caller: IAuth, uuid: string): Promise<StateChangeResult> {
        const company_uuid = caller.company_uuid;
        const target: any = await User.findOne({ where: { uuid, company_uuid } });
        if (!target) return { ok: false, status: 404, message: "Person not found." };

        const decision = decidePersonSuspend({
            caller: await RoleResolverService.resolveCaller(caller),
            target: await RoleResolverService.resolveIdentity(target, company_uuid),
        });
        if (!decision.ok) return { ok: false, status: decision.status, message: decision.message };

        const previous = stateOf(target);
        if (previous === "SUSPENDED" && String(target.status).toUpperCase() === "SUSPENDED") {
            return { ok: true, state: "SUSPENDED", previous, sessions_ended: 0, message: "That person is already suspended." };
        }

        await this.ensureStatusColumn();
        await User.update({ status: "SUSPENDED" } as any, { where: { uuid, company_uuid } });
        const sessions_ended = await this.endAllSessions(uuid);

        console.log(
            `PersonStateService: ${caller.uuid} suspended ${uuid} (company ${company_uuid}, was ${previous}, ${sessions_ended} session(s) ended)`,
        );
        return {
            ok: true,
            state: "SUSPENDED",
            previous,
            sessions_ended,
            message: "Person suspended. They are signed out everywhere and cannot sign in.",
        };
    }

    /** Switch a person back on: SUSPENDED (or PENDING, INACTIVE) -> ACTIVE. */
    static async reactivate(caller: IAuth, uuid: string): Promise<StateChangeResult> {
        const company_uuid = caller.company_uuid;
        const decision = decideAdminAction({ caller: await RoleResolverService.resolveCaller(caller) });
        if (!decision.ok) return { ok: false, status: decision.status, message: decision.message };

        const target: any = await User.findOne({ where: { uuid, company_uuid }, paranoid: false });
        if (!target) return { ok: false, status: 404, message: "Person not found." };
        if (target.deleted_at) {
            return { ok: false, status: 409, message: "That person was removed. Restore them from the Removed tab instead." };
        }

        const previous = stateOf(target);
        if (previous === "ACTIVE") {
            return { ok: true, state: "ACTIVE", previous, sessions_ended: 0, message: "That person is already active." };
        }
        if (String(target.status).toUpperCase() === "EXPIRED") {
            return {
                ok: false,
                status: 409,
                message: "That account expired with the company plan. Renew the plan to bring people back.",
            };
        }

        await this.ensureStatusColumn();
        await User.update({ status: "ACTIVE" } as any, { where: { uuid, company_uuid } });

        console.log(`PersonStateService: ${caller.uuid} reactivated ${uuid} (company ${company_uuid}, was ${previous})`);
        return {
            ok: true,
            state: "ACTIVE",
            previous,
            sessions_ended: 0,
            message: "Person reactivated. They can sign in again.",
        };
    }

    /** The "all" branch of AuthController.logOutUser, step for step. Returns how many sessions went. */
    static async endAllSessions(user_uuid: string): Promise<number> {
        const whereCond = { user_uuid };
        const sessions = await DeviceSecurity.findAll({ where: whereCond });
        if (sessions.length) {
            try {
                await SocketApiService.callSocketApi("publish-event", "POST", sessions);
            } catch (error: any) {
                /* The sessions are still destroyed below; the socket just is not told. */
                console.error("PersonStateService: socket publish-event failed:", error?.message || error);
            }
        }
        await DeviceSecurity.destroy({ where: whereCond });

        const escaped = user_uuid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        try {
            await QueueAgentModel.updateMany(
                {
                    $or: [
                        { "user_detail.user_uuid": user_uuid },
                        { user_detail: { $type: "string", $regex: escaped } },
                    ],
                },
                { $set: { status: "Logged Out", state: "Logged Out" } },
            );
        } catch (error: any) {
            console.error("PersonStateService: queue agent logout failed:", error?.message || error);
        }
        return sessions.length;
    }
}
