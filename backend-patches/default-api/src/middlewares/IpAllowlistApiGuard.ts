/* The API-key surface's own copy of the allowlist check.
 *
 * `checkIpAllowlist` (see `IpAllowlistService.ts`) is called directly from
 * `AuthController.login` because a session login and an API-key request start
 * from different information - login has an email and a password to resolve a
 * company from; an API-key request has the key. This file is the second
 * caller, wired in as ordinary Express middleware rather than an inline call,
 * because a middleware is what an existing API-key route can be given without
 * its handler needing to know this feature exists.
 *
 * NOT MOUNTED ANYWHERE BY THIS PATCH. Api-key authentication in this codebase
 * lives behind more than one entry point (grep for how `AuthMiddleware.ts` and
 * `PrivateCallAuth.ts` each resolve a caller before this was written), and
 * deciding WHICH of those should gain a network restriction - and whether a
 * server-to-server integration that has never needed one should suddenly get
 * one - is a product decision, not a default this patch should make silently.
 * Mount this on the specific router(s) an operator chooses, after confirming
 * with them which API-key traffic is expected to originate outside a
 * company's own office network today (webhook receivers and third-party
 * integrations very often do, deliberately).
 *
 * Usage once mounted:
 *
 *   router.use("/some/api-key/route", ipAllowlistApiGuard);
 *
 * expects `req.auth` (or a resolved company context earlier middleware
 * attaches) to already carry `company_uuid` and, for the audit log, `uuid`.
 */

import { NextFunction, Request, Response } from "express";
import CommonHelper from "@/helpers/CommonHelper";
import { checkIpAllowlist } from "@/services/IpAllowlistService";
import { ipAllowlistEnforcementEnabled } from "./ipAllowlistFeatureFlag";
import Company from "@/models/Company";

export const ipAllowlistApiGuard = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    if (!ipAllowlistEnforcementEnabled()) return next();

    const auth: any = (req as any).auth;
    const companyUuid = auth?.company_uuid;
    if (!companyUuid) return next();

    try {
        const company = await Company.findOne({
            where: { uuid: companyUuid },
            attributes: ["db_name"],
        });
        if (!company?.db_name) return next();

        const clientIp = await CommonHelper.getClientIp(req);
        const result = await checkIpAllowlist({
            dbName: company.db_name,
            companyUuid,
            clientIp,
            userUuid: auth?.uuid || null,
        });

        if (!result.allowed) {
            return res.status(403).json({
                success: false,
                message: "This request is not allowed from this network.",
                error: { code: "IP_NOT_ALLOWED" },
            });
        }
        return next();
    } catch {
        // Same fail-open rule as the login path: a broken CHECK must not
        // become an outage for every API-key call this company makes.
        return next();
    }
};
