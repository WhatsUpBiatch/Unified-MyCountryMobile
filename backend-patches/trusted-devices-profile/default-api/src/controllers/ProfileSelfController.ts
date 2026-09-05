/* The signed-in person's own profile: five fields, their own row.
 *
 *   POST /api/profile/self          -> the five fields as stored
 *   POST /api/profile/update-self   -> save any of them, get all five back
 *
 * The row is always the caller's (req.auth.uuid). No uuid in the body or the
 * path is read, so this cannot edit a colleague. No role, email, extension or
 * site is accepted, so it cannot be used to climb; compare `/api/user/update`,
 * which takes a whole record.
 *
 * `/api/user/info` builds user_info from a fixed attributes list in
 * UserController.info, which is off-limits to this change, so the two new
 * fields are read through /self rather than expected on user_info. */

import { Response } from "express";
import BaseController from "./BaseController";
import { sendSuccess } from "../helpers/responseHelper";
import { IAuth, IRequest } from "../interfaces/IRequest";
import { sanitiseSelfProfile } from "../services/profileSelfLogic";
import { readSelfProfile, writeSelfProfile } from "../services/ProfileSelfService";

export default class ProfileSelfController extends BaseController {
    public async self(req: IRequest, res: Response) {
        const { uuid } = req.auth as IAuth;
        const row = await readSelfProfile(uuid);
        if (!row) return super.sendError(res, "Your account could not be found.", null, 404);
        return sendSuccess(res, "Success", row);
    }

    public async updateSelf(req: IRequest, res: Response) {
        const { uuid } = req.auth as IAuth;
        const checked = sanitiseSelfProfile(req.body);
        if (!checked.ok) return super.sendError(res, checked.message, null, 422);

        const row = await writeSelfProfile(uuid, checked.values);
        if (!row) return super.sendError(res, "Your account could not be found.", null, 404);
        return sendSuccess(res, "Profile saved.", { ...row, saved: Object.keys(checked.values) });
    }
}
