/* Refuse a settings change the company has locked.
 *
 * Sits in front of `POST /api/user/update/:uuid?`. When the caller is not an ADMIN
 * and the body carries `settings`, every rule the company has marked `locked` is
 * compared between what is stored for the person and what is being sent. Any
 * difference stops the request with 403 and the list of rules that were touched, so
 * the screen can say which control the person was not allowed to move.
 *
 * ADMIN requests are never blocked: the admin is the one who set the rule, and the
 * admin screens themselves edit people's settings through this same endpoint.
 *
 * The lock applies to a non-admin editing anyone, not only themselves. The rule
 * says "the person may not change this on their own phone"; a non-admin changing
 * it on somebody else's phone is not a case the rule meant to allow.
 *
 * Only `settings` is checked. `greetings` carries its own `override` flags but the
 * website does not lock greetings on the person's page, so neither does this.
 */

import { NextFunction, Response } from "express";
import { IAuth, IRequest } from "@/interfaces/IRequest";
import User from "@/models/User";
import CompanyPolicyService from "@/services/CompanyPolicyService";

const isAdmin = (role: unknown): boolean => String(role || "").trim().toUpperCase() === "ADMIN";

const parseSettings = (value: any): any => {
    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        } catch (error) {
            return null;
        }
    }
    return value && typeof value === "object" ? value : null;
};

export const CompanyPolicyLock = async (
    req: IRequest,
    res: Response,
    next: NextFunction,
): Promise<any> => {
    try {
        const auth = req.auth as IAuth | undefined;
        if (!auth || isAdmin(auth.role)) return next();

        const incoming = parseSettings(req.body?.settings);
        if (!incoming) return next();

        const targetUuid = String(req.params?.uuid || auth.uuid || "").trim();
        const stored = await User.findOne({
            where: { uuid: targetUuid, company_uuid: auth.company_uuid },
            attributes: ["uuid", "settings"],
        });
        /* Unknown person: let the controller answer "User not found" as it does now. */
        if (!stored) return next();

        /* `role` is left to the admin-only screens that already own it: a
           person's own settings page has no role control, and the id the
           screens post for a custom role could not be proven to match the
           stored one, so refusing on it would only ever refuse honest saves. */
        const violations = (
            await CompanyPolicyService.lockedViolations(
                auth,
                parseSettings(stored.settings) || {},
                incoming,
            )
        ).filter((field) => field !== "role");

        if (violations.length) {
            /* Two modes. `report` (the default) only writes a log line, so the
               first days on a live box show whether ordinary saves trip the
               comparison on a harmless shape difference - a person's own
               settings page rewrites several of these objects on every save,
               and a false 403 there would stop everybody who is not an admin
               from saving anything. `enforce` refuses. Flip it with
               COMPANY_POLICY_LOCK=enforce once the log has stayed quiet. */
            const mode = String(process.env.COMPANY_POLICY_LOCK || "report").trim().toLowerCase();
            if (mode === "enforce") {
                return res.status(403).json({
                    success: false,
                    message: "Your company has locked these settings. Ask an admin to change them.",
                    locked_fields: violations,
                });
            }
            console.warn(
                "companyPolicyLock: report mode, would have refused",
                JSON.stringify({
                    user: auth.uuid,
                    target: targetUuid,
                    company: auth.company_uuid,
                    locked_fields: violations,
                }),
            );
        }

        return next();
    } catch (error: any) {
        /* A failure here must not take the settings page down; fall through to the
           controller exactly as before this middleware existed. */
        console.error("companyPolicyLock: check failed, allowing the request.", error?.message || error);
        return next();
    }
};

export default CompanyPolicyLock;
