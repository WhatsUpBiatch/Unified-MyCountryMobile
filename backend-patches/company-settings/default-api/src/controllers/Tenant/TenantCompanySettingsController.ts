/* Proxies for the company settings endpoints in tenant-api.
 *
 * Same shape as TenantUserTemplateController: the caller's auth record supplies the
 * tenant database name and the identity headers, the body goes through untouched,
 * and the tenant service's reply is handed straight back. Reached by the browser as
 * `/api/tenant/user/company-settings/{list|get|save|history|policy}`.
 *
 * One difference. TenantApiService turns any non-200 reply into a TenantApiError
 * that keeps the status and message but drops the body, and a refused save (409)
 * needs its body: it carries the row somebody else saved, which is what the screen
 * shows the admin so they can decide. So on a 409 this asks tenant-api for the
 * current row and returns it alongside the message.
 */

import { Response } from "express";
import BaseController from "../BaseController";
import { IAuth, IRequest } from "@/interfaces/IRequest";
import { TenantApiError, TenantApiService } from "@/services/TenantApiService";

const BASE = "user/company-settings";

const passThrough = async (
    req: IRequest,
    res: Response,
    endpoint: string,
    body: any,
): Promise<Response> => {
    const { db_name } = req.auth as IAuth;
    try {
        const tenantApiResponse = await TenantApiService.callTenantApi(
            db_name,
            `${BASE}/${endpoint}`,
            "POST",
            body,
            req?.auth,
        );
        return res.status(200).json(tenantApiResponse.data);
    } catch (error) {
        if (error instanceof TenantApiError) {
            return res.status(error.statusCode).json({
                message: error.message,
                service: error?.service,
            });
        }
        return res.status(500).json({ message: "Something went wrong" });
    }
};

export default class TenantCompanySettingsController extends BaseController {
    public async list(req: IRequest, res: Response) {
        return passThrough(req, res, "list", req.body || {});
    }

    public async get(req: IRequest, res: Response) {
        return passThrough(req, res, "get", req.body || {});
    }

    public async history(req: IRequest, res: Response) {
        return passThrough(req, res, "history", req.body || {});
    }

    public async policy(req: IRequest, res: Response) {
        return passThrough(req, res, "policy", {});
    }

    public async save(req: IRequest, res: Response) {
        const { db_name } = req.auth as IAuth;
        const body = req.body || {};
        try {
            const tenantApiResponse = await TenantApiService.callTenantApi(
                db_name,
                `${BASE}/save`,
                "POST",
                body,
                req?.auth,
            );
            return res.status(200).json(tenantApiResponse.data);
        } catch (error) {
            if (error instanceof TenantApiError) {
                let current: any = null;
                if (error.statusCode === 409 && body?.section) {
                    try {
                        const currentResponse = await TenantApiService.callTenantApi(
                            db_name,
                            `${BASE}/get`,
                            "POST",
                            { section: body.section },
                            req?.auth,
                        );
                        current = currentResponse?.data?.data?.result ?? null;
                    } catch (readError) {
                        current = null;
                    }
                }
                return res.status(error.statusCode).json({
                    message: error.message,
                    service: error?.service,
                    ...(error.statusCode === 409 ? { conflict: true, current } : {}),
                });
            }
            return res.status(500).json({ message: "Something went wrong" });
        }
    }
}
