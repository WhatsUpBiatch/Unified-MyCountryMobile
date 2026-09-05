/* user_invites: one row per invite link sent to a new person.
 *
 * Only the sha256 of the token is stored (token_hash); the token itself lives
 * in the e-mail and nowhere else. A person can have several rows (each
 * "Resend" adds one); the newest un-accepted row is the live one.
 *
 * Main database, next to `users`. The table is created on first use by
 * UserInviteService.ensureTable (CREATE TABLE IF NOT EXISTS) and by the
 * migration 20260903150000-create-user-invites-table.js; the two definitions
 * must stay identical.
 */

import { Model, DataTypes, Optional } from "sequelize";
import { sequelize } from "../config/database";

export interface IUserInvite {
    id: number;
    user_uuid: string;
    company_uuid: string;
    token_hash: string;
    expires_at: Date;
    accepted_at: Date | null;
    created_by: string | null;
    created_at: Date;
}

export type UserInviteCreation = Optional<IUserInvite, "id" | "accepted_at" | "created_by" | "created_at">;

class UserInvite extends Model<IUserInvite, UserInviteCreation> implements IUserInvite {
    public id!: number;
    public user_uuid!: string;
    public company_uuid!: string;
    public token_hash!: string;
    public expires_at!: Date;
    public accepted_at!: Date | null;
    public created_by!: string | null;
    public created_at!: Date;
}

UserInvite.init(
    {
        id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        user_uuid: { type: DataTypes.STRING(36), allowNull: false },
        company_uuid: { type: DataTypes.STRING(36), allowNull: false },
        token_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        accepted_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
        created_by: { type: DataTypes.STRING(36), allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
        sequelize,
        modelName: "UserInvite",
        tableName: "user_invites",
        timestamps: false,
        indexes: [
            { fields: ["user_uuid", "created_at"] },
            { fields: ["company_uuid", "accepted_at"] },
        ],
    },
);

export default UserInvite;
