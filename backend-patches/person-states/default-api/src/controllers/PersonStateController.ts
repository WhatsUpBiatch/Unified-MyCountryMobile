/* Person states over HTTP. All the rules live in services/PersonStateService.ts
   and helpers/roleGuard.ts; this only reads the request and writes the reply. */

import { Response } from "express";
import BaseController from "./BaseController";
import { IAuth, IRequest } from "@/interfaces/IRequest";
import API_RESPONSE from "@/responses/globalResponse";
import PersonStateService from "@/services/PersonStateService";

const getString = (value: unknown): string => String(value ?? "").trim();

export default class PersonStateController extends BaseController {
    /** POST /api/person/suspend/:uuid - administrators only (route-level RequireAdminRole plus the per-target rule). */
    public async suspend(req: IRequest, res: Response): Promise<object> {
        const uuid = getString(req.params.uuid);
        if (!uuid) return super.sendError(res, "Invalid user uuid");
        const result = await PersonStateService.suspend(req.auth as IAuth, uuid);
        if (!result.ok) return super.sendError(res, result.message, null, result.status);
        return super.sendSuccess(res, result.message, {
            uuid,
            state: result.state,
            previous: result.previous,
            sessions_ended: result.sessions_ended,
        });
    }

    /** POST /api/person/reactivate/:uuid - administrators only. */
    public async reactivate(req: IRequest, res: Response): Promise<object> {
        const uuid = getString(req.params.uuid);
        if (!uuid) return super.sendError(res, "Invalid user uuid");
        const result = await PersonStateService.reactivate(req.auth as IAuth, uuid);
        if (!result.ok) return super.sendError(res, result.message, null, result.status);
        return super.sendSuccess(res, result.message, { uuid, state: result.state, previous: result.previous });
    }

    /** POST /api/person/state/:uuid - one person's state (removed people included). */
    public async state(req: IRequest, res: Response): Promise<object> {
        const uuid = getString(req.params.uuid);
        if (!uuid) return super.sendError(res, "Invalid user uuid");
        const { company_uuid } = req.auth as IAuth;
        const row = await PersonStateService.stateOf(company_uuid, uuid);
        if (!row) return super.sendError(res, "Person not found.", null, 404);
        return super.sendSuccess(res, API_RESPONSE.SUCCESS, row);
    }

    /** POST /api/person/state - every person's state, for the People list.
        The list endpoint (/api/user/list) does not return `status`, and its
        controller is not to be edited today, so the screen reads states here
        and joins them by uuid. */
    public async states(req: IRequest, res: Response): Promise<object> {
        const { company_uuid } = req.auth as IAuth;
        const rows = await PersonStateService.statesForCompany(company_uuid);
        return super.sendSuccess(res, API_RESPONSE.SUCCESS, { rows });
    }
}
