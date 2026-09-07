/* Invite links: the four endpoints under /api/invite.
 *
 * Lives in its own controller on purpose. Production default-api has no
 * source; its dist/controllers/AuthController.js carries fixes this mirror
 * does not, so nothing here touches AuthController. See
 * backend-patches/invites/README.md.
 *
 *   POST /api/invite/inspect  {token}            public   -> what this link is
 *   POST /api/invite/accept   {token, password}  public   -> set own password
 *   POST /api/invite/resend   {user_uuid}        admin    -> fresh link
 *   POST /api/invite/pending  {}                 admin    -> who has not accepted
 *
 * accept does NOT sign the person in. The login route is gated by OTP,
 * Turnstile and device sessions inside AuthController; copying that here
 * would mean duplicating the very file this change must not touch. The page
 * sends them to the login screen instead.
 */

import { Response } from "express";
import BaseController from "./BaseController";
import { IAuth, IRequest } from "@/interfaces/IRequest";
import UserInviteService, { UserInviteError } from "@/services/UserInviteService";
import { INVITE_MIN_PASSWORD_LENGTH, INVITE_TTL_HOURS } from "@/helpers/inviteToken";

export default class InviteController extends BaseController {
    constructor() {
        super();
        this.inspect = this.inspect.bind(this);
        this.accept = this.accept.bind(this);
        this.resend = this.resend.bind(this);
        this.pending = this.pending.bind(this);
    }

    public async inspect(req: IRequest, res: Response): Promise<object> {
        const { token } = (req.body ?? {}) as { token?: unknown };
        const state = await UserInviteService.inspect(token);
        return super.sendSuccess(res, "Invite checked", {
            ...state,
            min_password_length: INVITE_MIN_PASSWORD_LENGTH,
            ttl_hours: INVITE_TTL_HOURS,
        });
    }

    public async accept(req: IRequest, res: Response): Promise<object> {
        const { token, password } = (req.body ?? {}) as { token?: unknown; password?: unknown };
        try {
            const done = await UserInviteService.accept(token, password);
            return super.sendSuccess(res, "Your password is set. You can log in now.", {
                ok: true,
                email: done.email,
                name: done.name,
            });
        } catch (error: any) {
            if (error instanceof UserInviteError) {
                return super.sendError(res, error.message, { ok: false }, error.status);
            }
            console.error("InviteController.accept:", error?.message || error);
            return super.sendError(res, "Something went wrong. Please try the link again.", null, 500);
        }
    }

    public async resend(req: IRequest, res: Response): Promise<object> {
        const auth = req.auth as IAuth;
        const { user_uuid } = (req.body ?? {}) as { user_uuid?: unknown };
        const target = String(user_uuid ?? "").trim();
        if (!target) {
            return super.sendError(res, "user_uuid is required.");
        }
        try {
            const result = await UserInviteService.resend(
                target,
                { uuid: auth.uuid, company_uuid: auth.company_uuid, first_name: auth.first_name, last_name: auth.last_name },
                req,
            );
            return super.sendSuccess(
                res,
                result.sent
                    ? `We sent them a new link. It works for ${INVITE_TTL_HOURS / 24} days.`
                    : "The link was made, but the e-mail could not be sent. Please try again in a minute.",
                { ok: result.sent, email: result.email, expires_at: result.expiresAt },
            );
        } catch (error: any) {
            if (error instanceof UserInviteError) {
                return super.sendError(res, error.message, null, error.status);
            }
            console.error("InviteController.resend:", error?.message || error);
            return super.sendError(res, "The invite could not be sent. Please try again.", null, 500);
        }
    }

    public async pending(req: IRequest, res: Response): Promise<object> {
        const auth = req.auth as IAuth;
        const rows = await UserInviteService.pendingForCompany(auth.company_uuid);
        return super.sendSuccess(res, "Pending invites", { pending: rows, ttl_hours: INVITE_TTL_HOURS });
    }
}
