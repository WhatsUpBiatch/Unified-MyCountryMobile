/* Route-level "administrators only".
 *
 * Sits in front of the routes that add, remove or re-role people, manage roles,
 * or edit the company template. Each handler still runs the per-target rules
 * from helpers/roleGuard.ts (own role, owner-only); this only settles the one
 * question that has no target: is the caller an administrator at all?
 *
 * The decision is on the caller's resolved system role, never on the free-text
 * users.role string. A caller whose role cannot be resolved is refused.
 */

import { NextFunction, Response } from "express";
import { IAuth, IRequest } from "@/interfaces/IRequest";
import RoleResolverService from "@/services/RoleResolverService";
import { decideAdminAction } from "@/helpers/roleGuard";

export const RequireAdminRole = async (req: IRequest, res: Response, next: NextFunction): Promise<any> => {
    const auth = req.auth as IAuth | undefined;
    if (!auth?.uuid || !auth?.company_uuid) {
        return res.status(401).json({ success: false, message: "Un-authenticate or deleted User" });
    }

    try {
        const caller = await RoleResolverService.resolveCaller(auth);
        const decision = decideAdminAction({ caller });
        if (!decision.ok) {
            return res.status(decision.status).json({ success: false, message: decision.message });
        }
        return next();
    } catch (error: any) {
        console.error("RequireAdminRole: could not resolve the caller's role:", error?.message || error);
        return res.status(403).json({
            success: false,
            message: "Your role could not be checked, so this change was not made. Please try again.",
        });
    }
};
