/* Invite links for new people.
 *
 * A new person never receives a password. They receive a link; the link opens
 * the public /accept-invite page; there they choose their own password. The
 * link works for INVITE_TTL_HOURS (72). An administrator can send a fresh one.
 *
 * What is stored: user_invites(user_uuid, company_uuid, token_hash, expires_at,
 * accepted_at, created_by, created_at). token_hash is sha256(token); the token
 * is only ever in the e-mail. The table is created here on first use so a box
 * that never runs migrations still works.
 *
 * Mail goes through SmsController.sendNotification - the same path as
 * forgot-password - as the branded INVITE_LINK template, with the plain HTML
 * body from helpers/inviteEmail.ts as the fallback when the notification-api
 * on the box does not have that template.
 */

import { Op, Transaction } from "sequelize";
import { hash } from "bcryptjs";
import { sequelize } from "@/config/database";
import User from "@/models/User";
import Company from "@/models/Company";
import UserInvite from "@/models/UserInvite";
import CommonHelper from "@/helpers/CommonHelper";
import { SmsController } from "@/controllers/SmsController";
import {
    buildInviteLink,
    hashInviteToken,
    INVITE_TTL_HOURS,
    isInviteExpired,
    issueInviteToken,
    resendWaitSeconds,
    tokenLooksValid,
    validateInvitePassword,
} from "@/helpers/inviteToken";
import {
    buildInviteEmailHtml,
    buildInviteTemplateData,
    INVITE_TEMPLATE_NAME,
    inviteEmailSubject,
    inviteEmailWent,
} from "@/helpers/inviteEmail";

/* Mirrors migrations/20260903150000-create-user-invites-table.js. */
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`user_invites\` (
  \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`user_uuid\` VARCHAR(36) NOT NULL,
  \`company_uuid\` VARCHAR(36) NOT NULL,
  \`token_hash\` CHAR(64) NOT NULL,
  \`expires_at\` DATETIME NOT NULL,
  \`accepted_at\` DATETIME NULL DEFAULT NULL,
  \`created_by\` VARCHAR(36) NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`user_invites_token_hash\` (\`token_hash\`),
  KEY \`user_invites_user_uuid_created_at\` (\`user_uuid\`, \`created_at\`),
  KEY \`user_invites_company_uuid_accepted_at\` (\`company_uuid\`, \`accepted_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

export type InviteState = "ok" | "invalid" | "expired" | "accepted";

export interface InviteInspection {
    ok: boolean;
    state: InviteState;
    expired: boolean;
    name?: string;
    email?: string;
}

export interface PendingInviteRow {
    user_uuid: string;
    email: string;
    first_name: string;
    last_name: string;
    sent_at: Date;
    expires_at: Date;
    expired: boolean;
}

interface InviteTarget {
    uuid: string;
    company_uuid: string;
    first_name: string;
    last_name: string;
    email: string;
    status?: string | null;
}

export class UserInviteError extends Error {
    public status: number;
    constructor(message: string, status: number = 422) {
        super(message);
        this.status = status;
    }
}

let tableReady: Promise<void> | null = null;

export default class UserInviteService {
    public static readonly TTL_HOURS = INVITE_TTL_HOURS;

    /* Once per process. Safe to call on every request. */
    public static ensureTable(): Promise<void> {
        if (!tableReady) {
            tableReady = sequelize.query(CREATE_TABLE_SQL).then(() => undefined).catch((error) => {
                tableReady = null;
                throw error;
            });
        }
        return tableReady;
    }

    /* Make a new link for this person. Older un-accepted links stop working. */
    public static async createInvite(
        user: InviteTarget,
        createdBy: string | null,
        transaction?: Transaction,
    ): Promise<{ token: string; expiresAt: Date }> {
        await UserInviteService.ensureTable();
        const now = new Date();
        const issued = issueInviteToken(now);
        await UserInvite.update(
            { expires_at: now },
            { where: { user_uuid: user.uuid, accepted_at: null, expires_at: { [Op.gt]: now } }, transaction },
        );
        await UserInvite.create(
            {
                user_uuid: user.uuid,
                company_uuid: user.company_uuid,
                token_hash: issued.tokenHash,
                expires_at: issued.expiresAt,
                created_by: createdBy,
            },
            { transaction },
        );
        return { token: issued.token, expiresAt: issued.expiresAt };
    }

    /* Build and send the e-mail. Never throws: a mail failure must not undo a
       created person - the admin can press "Resend". Returns whether it went.

       Two attempts at most. First the branded template (template: true, body
       INVITE_LINK, the variables from buildInviteTemplateData). notification-api
       answers 200 either way; if its e-mail channel reports `false` - which is
       what a build without the template answers - the same mail goes again
       with template: false and the plain HTML body, which every build sends
       as-is. A second failure is a real mail failure and is reported as such. */
    public static async sendInviteEmail(
        user: InviteTarget,
        token: string,
        req: any,
        inviterName?: string | null,
    ): Promise<boolean> {
        try {
            const company: any = await Company.findOne({
                where: { uuid: user.company_uuid },
                attributes: ["uuid", "name"],
                include: [{ association: "websiteSettings", attributes: ["uuid", "regards"], required: false }],
            });
            const websiteUrl = await CommonHelper.getWebsiteUrl(user.company_uuid);
            const link = buildInviteLink(websiteUrl, token);
            const companyName = company?.name ?? null;
            const projectName = company?.websiteSettings?.regards ?? null;
            const input = {
                name: `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim(),
                inviterName: inviterName ?? null,
                companyName,
                projectName,
                link,
                hours: INVITE_TTL_HOURS,
            };
            const subject = inviteEmailSubject(companyName, projectName);
            const send = (email_notification: Record<string, unknown>) =>
                SmsController.sendNotification(
                    { type: "user_invite", email_notification, socket_notification: null, sms_notification: null },
                    user.email,
                    null,
                    req,
                    user.company_uuid ?? null,
                );

            const templated = await send({
                subject,
                body: INVITE_TEMPLATE_NAME,
                template: true,
                data: buildInviteTemplateData(input),
            });
            if (inviteEmailWent(templated)) {
                return true;
            }
            console.warn(
                `UserInviteService: template ${INVITE_TEMPLATE_NAME} did not send to ${user.email} (notification-api answered ${JSON.stringify(templated)}); sending the plain body instead`,
            );
            const plain = await send({
                subject,
                body: buildInviteEmailHtml(input),
                template: false,
                data: {},
            });
            return inviteEmailWent(plain);
        } catch (error: any) {
            console.error(`UserInviteService: invite e-mail to ${user.email} failed:`, error?.message || error);
            return false;
        }
    }

    /* The public "what is this link?" question. Never says why a token is bad
       beyond invalid / expired / already used. */
    public static async inspect(token: unknown): Promise<InviteInspection> {
        await UserInviteService.ensureTable();
        if (!tokenLooksValid(token)) {
            return { ok: false, state: "invalid", expired: false };
        }
        const invite = await UserInvite.findOne({ where: { token_hash: hashInviteToken(token) } });
        if (!invite) {
            return { ok: false, state: "invalid", expired: false };
        }
        const user: any = await User.findOne({
            where: { uuid: invite.user_uuid, company_uuid: invite.company_uuid },
            attributes: ["uuid", "first_name", "last_name", "email", "status"],
        });
        if (!user) {
            return { ok: false, state: "invalid", expired: false };
        }
        const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
        if (invite.accepted_at) {
            return { ok: false, state: "accepted", expired: false, name, email: user.email };
        }
        if (isInviteExpired(invite.expires_at)) {
            return { ok: false, state: "expired", expired: true, name, email: user.email };
        }
        return { ok: true, state: "ok", expired: false, name, email: user.email };
    }

    /* Set the person's own password and switch them on. Same hashing as the
       login path (bcrypt, cost 10 - AuthController.verifyPassword does exactly
       this). Note for the switch: sip-user-data-api hands users.password (this
       hash) to FreeSWITCH as the SIP secret, so the SIP secret changes here too;
       the softphone picks the new one up at its next login. */
    public static async accept(token: unknown, password: unknown): Promise<{ email: string; name: string }> {
        const state = await UserInviteService.inspect(token);
        if (!state.ok) {
            const message =
                state.state === "expired"
                    ? "This link has expired. Ask the person who added you to send a new one."
                    : state.state === "accepted"
                        ? "This link has already been used. You can log in with your password."
                        : "This link is not valid.";
            throw new UserInviteError(message, state.state === "expired" ? 410 : 404);
        }
        const check = validateInvitePassword(password, state.email);
        if (!check.ok) {
            throw new UserInviteError(check.message ?? "Please choose a different password.");
        }
        if (await CommonHelper.isBreachedPassword(String(password))) {
            throw new UserInviteError("This password has been found in a data breach. Please choose a different password.");
        }

        const tokenHash = hashInviteToken(token as string);
        const now = new Date();
        const hashed = await hash(String(password), 10);

        await sequelize.transaction(async (transaction) => {
            /* Claim the row first; two clicks on the same link cannot both win. */
            const [claimed] = await UserInvite.update(
                { accepted_at: now },
                { where: { token_hash: tokenHash, accepted_at: null, expires_at: { [Op.gt]: now } }, transaction },
            );
            if (claimed !== 1) {
                throw new UserInviteError("This link has already been used. You can log in with your password.", 404);
            }
            const invite = await UserInvite.findOne({ where: { token_hash: tokenHash }, transaction });
            await User.update(
                { password: hashed, status: "ACTIVE" },
                { where: { uuid: invite!.user_uuid, company_uuid: invite!.company_uuid }, transaction },
            );
            /* Any other open link for this person is now pointless. */
            await UserInvite.update(
                { expires_at: now },
                { where: { user_uuid: invite!.user_uuid, accepted_at: null, expires_at: { [Op.gt]: now } }, transaction },
            );
        });

        return { email: state.email as string, name: state.name as string };
    }

    /* Administrator sends a fresh link to a colleague who has not accepted yet. */
    public static async resend(
        userUuid: string,
        caller: { uuid: string; company_uuid: string; first_name?: string; last_name?: string },
        req: any,
    ): Promise<{ email: string; expiresAt: Date; sent: boolean }> {
        await UserInviteService.ensureTable();
        const user: any = await User.findOne({
            where: { uuid: userUuid, company_uuid: caller.company_uuid },
            attributes: ["uuid", "company_uuid", "first_name", "last_name", "email", "status"],
        });
        if (!user) {
            throw new UserInviteError("That person is not in your company.", 404);
        }
        const latest = await UserInvite.findOne({
            where: { user_uuid: user.uuid },
            order: [["created_at", "DESC"]],
        });
        if (latest?.accepted_at) {
            throw new UserInviteError("This person has already chosen a password. There is nothing to resend.", 409);
        }
        if (!latest && String(user.status ?? "") !== "PENDING") {
            throw new UserInviteError("This person already has a password. There is nothing to resend.", 409);
        }
        const wait = resendWaitSeconds(latest?.created_at ?? null);
        if (wait > 0) {
            throw new UserInviteError(`An invite was sent a moment ago. Please wait ${wait} seconds.`, 429);
        }
        const { token, expiresAt } = await UserInviteService.createInvite(user, caller.uuid);
        const inviter = `${caller.first_name ?? ""} ${caller.last_name ?? ""}`.trim() || null;
        const sent = await UserInviteService.sendInviteEmail(user, token, req, inviter);
        return { email: user.email, expiresAt, sent };
    }

    /* People in the company whose newest invite has not been accepted. Feeds
       the "Resend invite" button on the People list. */
    public static async pendingForCompany(companyUuid: string): Promise<PendingInviteRow[]> {
        await UserInviteService.ensureTable();
        const rows = await UserInvite.findAll({
            where: { company_uuid: companyUuid },
            order: [["created_at", "DESC"]],
            attributes: ["user_uuid", "accepted_at", "expires_at", "created_at"],
        });
        const newestPerUser = new Map<string, UserInvite>();
        for (const row of rows) {
            if (!newestPerUser.has(row.user_uuid)) newestPerUser.set(row.user_uuid, row);
        }
        const pendingUuids = [...newestPerUser.values()].filter((r) => !r.accepted_at).map((r) => r.user_uuid);
        if (!pendingUuids.length) return [];
        const users: any[] = await User.findAll({
            where: { uuid: { [Op.in]: pendingUuids }, company_uuid: companyUuid },
            attributes: ["uuid", "email", "first_name", "last_name"],
        });
        return users.map((u) => {
            const inv = newestPerUser.get(u.uuid)!;
            return {
                user_uuid: u.uuid,
                email: u.email,
                first_name: u.first_name,
                last_name: u.last_name,
                sent_at: inv.created_at,
                expires_at: inv.expires_at,
                expired: isInviteExpired(inv.expires_at),
            };
        });
    }
}
