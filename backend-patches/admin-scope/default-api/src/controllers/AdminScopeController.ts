/* Admin scope over HTTP. The rules live in helpers/adminScope.ts and the
   lookups in services/AdminScopeService.ts; this only reads the request and
   writes the reply. Mounted at /api/person (app.ts), beside person states. */

import { Response } from "express";
import BaseController from "./BaseController";
import { IAuth, IRequest } from "@/interfaces/IRequest";
import API_RESPONSE from "@/responses/globalResponse";
import AdminScopeService from "@/services/AdminScopeService";

const getString = (value: unknown): string => String(value ?? "").trim();

export default class AdminScopeController extends BaseController {
    /** POST /api/person/scope/:uuid - set one person's admin scope.
        Body: { level: 'company'|'location'|'group', location_uuids?: [], group_uuids?: [] }.
        Route-level RequireAdminRole, then the per-target rules in the service
        (never yourself, never the owner, only the owner for an account admin). */
    public async set(req: IRequest, res: Response): Promise<object> {
        const uuid = getString(req.params.uuid);
        if (!uuid) return super.sendError(res, "Invalid user uuid");
        const result = await AdminScopeService.setScope(req.auth as IAuth, uuid, req.body ?? {});
        if (!result.ok) return super.sendError(res, result.message, result.problems ?? null, result.status);
        return super.sendSuccess(res, "Admin scope saved.", { uuid: result.uuid, admin_scope: result.scope });
    }

    /** POST /api/person/scope - every person's resolved role and scope, for
        the People list and the Admin scope screen. /api/user/list carries
        `settings`, but not the resolved role, and its controller is not to be
        edited today; the screens read this and join by uuid. */
    public async list(req: IRequest, res: Response): Promise<object> {
        const rows = await AdminScopeService.listScopes(req.auth as IAuth);
        return super.sendSuccess(res, API_RESPONSE.SUCCESS, { rows });
    }
}
