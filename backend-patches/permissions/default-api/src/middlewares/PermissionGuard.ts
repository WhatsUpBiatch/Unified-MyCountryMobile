/* Route-level "does your role's permission tree allow this?"
 *
 *   userRoute.delete("/delete/:uuid", auth, RequireAdminRole,
 *       RequirePermission("account_setting.access.USER.action.delete"), ...)
 *
 * Runs after `auth` (it needs req.auth) and, where one is wired, after
 * RequireAdminRole: that guard answers "is the caller an administrator at all",
 * this one answers "did the administrator's role get this particular box
 * ticked". Both are needed; neither replaces the other.
 *
 * The tree, its sources and the decision are in helpers/permissionTree.ts and
 * services/PermissionTreeService.ts. The account owner (ADMIN) passes
 * everything. A caller whose role cannot be resolved is refused.
 *
 * MODES - the same switch shape as CompanyPolicyLock:
 *   PERMISSION_ENFORCE unset / "report"  log "would have refused", let it through
 *   PERMISSION_ENFORCE=enforce           answer 403 { message, permission }
 *
 * Report is the default on purpose. Some of these routes (/api/user/list is
 * the obvious one) are read by screens that have nothing to do with the People
 * page, and the trees seeded for the built-in roles have never been checked
 * against real traffic. A few days of the log line show which keys real roles
 * are missing before anything is refused.
 *
 * A failure inside the check (database away, role table unreadable) lets the
 * request through in report mode and refuses it in enforce mode, so enforce is
 * never quietly open.
 */

import { NextFunction, Response } from "express";
import { IAuth, IRequest } from "@/interfaces/IRequest";
import PermissionTreeService from "@/services/PermissionTreeService";
import { applyMode, permissionMode } from "@/helpers/permissionTree";

export interface RequirePermissionOptions {
    /**
     * For routes that act on one person: return the target's uuid. When it is
     * the caller's own uuid the "self" rule applies (an explicit `...self` key
     * in the tree decides; otherwise acting on yourself is allowed).
     */
    target?: (req: IRequest) => unknown;
    /** The key that governs "on myself"; defaults to the sibling `self` key. */
    selfKey?: string;
    /** Only check when this is true (e.g. a media route, only for recordings). */
    when?: (req: IRequest) => boolean;
}

export const RequirePermission = (key: string, options: RequirePermissionOptions = {}) => {
    return async (req: IRequest, res: Response, next: NextFunction): Promise<any> => {
        const auth = req.auth as IAuth | undefined;
        if (!auth?.uuid || !auth?.company_uuid) {
            return res.status(401).json({ success: false, message: "Un-authenticate or deleted User" });
        }

        if (options.when && !options.when(req)) return next();

        const mode = permissionMode(process.env.PERMISSION_ENFORCE);
        const rawTarget = options.target ? options.target(req) : "";
        const targetUuid = String((Array.isArray(rawTarget) ? rawTarget[0] : rawTarget) ?? "").trim();
        const isSelf = !!targetUuid && targetUuid === String(auth.uuid).trim();

        try {
            const { decision, context } = await PermissionTreeService.decide(auth, key, {
                isSelf,
                selfKey: options.selfKey,
            });
            const outcome = applyMode(decision, mode, key);

            if (!outcome.pass) {
                return res.status(outcome.status).json(outcome.body);
            }
            if (outcome.log && !decision.ok) {
                console.warn(
                    "permissionGuard: report mode, would have refused",
                    JSON.stringify({
                        user: auth.uuid,
                        company: auth.company_uuid,
                        role: context.systemRole,
                        role_uuid: context.roleUuid,
                        custom_role_uuid: context.customRoleUuid,
                        tree_source: context.chosen.source,
                        key,
                        reason: decision.reason,
                        self: isSelf,
                        route: `${req.method} ${(req.originalUrl || "").split("?")[0]}`,
                    }),
                );
            }
            return next();
        } catch (error: any) {
            console.error("permissionGuard: check failed:", error?.message || error);
            if (mode === "enforce") {
                return res.status(403).json({
                    success: false,
                    message: "Your permissions could not be checked, so this was not allowed. Please try again.",
                    permission: key,
                });
            }
            return next();
        }
    };
};

export default RequirePermission;
