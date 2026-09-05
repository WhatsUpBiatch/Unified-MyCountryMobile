/* A company admin's own company record: name and postal address.
 *
 *   POST /api/company/self          -> the safe columns of the caller's own row
 *   POST /api/company/self/update   -> save any of the six fields, get the row back
 *
 * The company is always the caller's (req.auth.company_uuid, which the auth
 * middleware puts there from the session). No uuid in the body or path is
 * read, so this cannot reach another company. Only name, address, city,
 * state, country and postal_code are accepted; plan, billing, Stripe and
 * allowed-country columns are not on the list and cannot be sent here.
 *
 * Why this exists: the only endpoints that returned or changed the
 * `companies` row sat under /api/admin behind the platform-staff middleware,
 * so every customer admin got a 401 from them and the website had to keep a
 * copy of the name and address in the settings row instead. This is the
 * tenant-scoped door those routes never had. */

import { Response } from "express";
import BaseController from "./BaseController";
import { sendSuccess } from "../helpers/responseHelper";
import { IAuth, IRequest } from "../interfaces/IRequest";
import { sanitiseCompanySelf } from "../services/companySelfLogic";
import { readSelfCompany, writeSelfCompany } from "../services/CompanySelfService";

export default class CompanySelfController extends BaseController {
    public async self(req: IRequest, res: Response) {
        const { company_uuid } = req.auth as IAuth;
        const row = await readSelfCompany(company_uuid);
        if (!row) return super.sendError(res, "Your company record could not be found.", null, 404);
        return sendSuccess(res, "Success", row);
    }

    public async updateSelf(req: IRequest, res: Response) {
        const { company_uuid, uuid, email } = req.auth as IAuth;
        const checked = sanitiseCompanySelf(req.body);
        if (!checked.ok) return super.sendError(res, checked.message, null, 422);

        const saved = await writeSelfCompany(company_uuid, checked.values, {
            uuid,
            email,
            ip: req.ip,
        });
        if (!saved) return super.sendError(res, "Your company record could not be found.", null, 404);
        return sendSuccess(res, saved.changed.length ? "Company details saved." : "Nothing has changed.", {
            ...saved.row,
            changed: saved.changed,
        });
    }
}
