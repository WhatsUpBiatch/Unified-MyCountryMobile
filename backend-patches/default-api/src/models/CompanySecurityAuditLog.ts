/* The durable half of the IP allowlist's audit trail.
 *
 * The Security screen already keeps a short list of admin actions - add,
 * remove, enable, disable - inside `settings.company_security.ip_allowlist`,
 * written by the browser on every save (see `company-security.tsx`). That is
 * real and live the moment this feature ships, but it can only ever record
 * what an ADMIN did, because nothing except a login attempt itself knows
 * whether a caller was let through or turned away - and an admin editing their
 * own settings blob is not a record a security review can trust, because the
 * same admin can edit it.
 *
 * This table is that record. One row per decision the allowlist actually made
 * at sign-in time - allowed, denied, let through by a break-glass window, or
 * found misconfigured - written by the server, in the same request that made
 * the decision, and never touched by the settings save path at all.
 */

import { Model, DataTypes } from "sequelize";
import { sequelize } from "@/config/database";
import {
    ICompanySecurityAuditLogAttributes,
    CompanySecurityAuditLogAttributes,
} from "./request/ICompanySecurityAuditLogAttributes";

class CompanySecurityAuditLog
    extends Model<
        ICompanySecurityAuditLogAttributes,
        CompanySecurityAuditLogAttributes
    >
    implements ICompanySecurityAuditLogAttributes
{
    public id!: number;
    public company_uuid!: string;
    public event!: string;
    public client_ip!: string;
    public user_uuid!: string | null;
    public email_attempted!: string | null;
    public matched_cidr!: string | null;
    public created_at!: Date;
}

CompanySecurityAuditLog.init(
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
        },
        company_uuid: {
            type: DataTypes.STRING(36),
            allowNull: false,
        },
        event: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        client_ip: {
            /* 45 covers the longest possible textual IPv6 address
             * (`::ffff:255.255.255.255`, or a full 8-group address), same width
             * Postgres's own inet-adjacent columns typically use. */
            type: DataTypes.STRING(45),
            allowNull: false,
        },
        user_uuid: {
            type: DataTypes.STRING(36),
            allowNull: true,
        },
        email_attempted: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        matched_cidr: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
    },
    {
        sequelize,
        modelName: "CompanySecurityAuditLog",
        tableName: "company_security_audit_logs",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: false,
        indexes: [
            /* The query a security review actually runs: this company's recent
             * denials, newest first. */
            { fields: ["company_uuid", "created_at"] },
        ],
    },
);

export default CompanySecurityAuditLog;
