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
 * SCOPE - the third question, asked after the tree passes and only on routes
 * that act on a target person: "is that person inside the caller's admin
 * scope?" (helpers/adminScope.ts, services/AdminScopeService.ts). A location
 * admin reaches the people at their locations; a group admin the members of
 * their groups; everybody else, and the owner, the whole company. It uses the
 * same mode switch and the same log line, with `reason: "scope"`, so the
 * report-mode log answers both questions at once. RequireInScope() is the
 * scope check alone, for routes that have no tree key (restore, suspend,
 * reactivate).
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
import AdminScopeService from "@/services/AdminScopeService";
import { applyMode, permissionMode, PermissionMode } from "@/helpers/permissionTree";

export interface RequirePermissionOptions {
    /**
     * For routes that act on one person: return the target's uuid. When it is
     * the caller's own uuid the "self" rule applies (an explicit `...self` key
     * in the tree decides; otherwise acting on yourself is allowed). May return
     * an array for a bulk route; every uuid is then scope-checked.
     */
    target?: (req: IRequest) => unknown;
    /** The key that governs "on myself"; defaults to the sibling `self` key. */
    selfKey?: string;
    /** Only check when this is true (e.g. a media route, only for recordings). */
    when?: (req: IRequest) => boolean;
    /** Skip the scope question even though a target is given. */
    skipScope?: boolean;
}

const targetUuids = (raw: unknown): string[] => {
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((item) => String(item ?? "").trim()).filter(Boolean);
};

const routeOf = (req: IRequest): string => `${req.method} ${(req.originalUrl || "").split("?")[0]}`;

/**
 * The scope question for every target uuid. Returns null when all pass;
 * otherwise the express answer (403 in enforce mode) or, in report mode, null
 * after writing the log line. Throws on a lookup failure - the caller decides
 * what a failure means under the mode.
 */
async function checkScope(
    req: IRequest,
    res: Response,
    auth: IAuth,
    key: string,
    mode: PermissionMode,
    targets: string[],
): Promise<Response | null> {
    for (const targetUuid of targets) {
        if (targetUuid === String(auth.uuid).trim()) continue;
        const { decision, context } = await AdminScopeService.decide(auth, targetUuid);
        if (decision.ok) continue;

        const outcome = applyMode(decision, mode, key);
        if (!outcome.pass) return res.status(outcome.status).json(outcome.body);
        console.warn(
            "permissionGuard: report mode, would have refused",
            JSON.stringify({
                user: auth.uuid,
                company: auth.company_uuid,
                role: context.callerRole,
                key,
                reason: "scope",
                scope_reason: decision.reason,
                scope_level: context.scope?.level ?? null,
                target: targetUuid,
                target_site: context.target?.site_uuid ?? null,
                target_groups: context.target?.group_uuids ?? [],
                route: routeOf(req),
            }),
        );
    }
    return null;
}

export const RequirePermission = (key: string, options: RequirePermissionOptions = {}) => {
    return async (req: IRequest, res: Response, next: NextFunction): Promise<any> => {
        const auth = req.auth as IAuth | undefined;
        if (!auth?.uuid || !auth?.company_uuid) {
            return res.status(401).json({ success: false, message: "Un-authenticate or deleted User" });
        }

        if (options.when && !options.when(req)) return next();

        const mode = permissionMode(process.env.PERMISSION_ENFORCE);
        const rawTarget = options.target ? options.target(req) : undefined;
        const targets = targetUuids(rawTarget);
        /* "Self" is a single-person route acting on the caller. A bulk route
           whose list happens to hold only the caller is not a self-edit. */
        const isSelf = !Array.isArray(rawTarget) && targets.length === 1 && targets[0] === String(auth.uuid).trim();

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
                        route: routeOf(req),
                    }),
                );
            }

            /* The tree said yes (or report mode let it through). Now: is the
               target inside the caller's scope? The owner and self never are
               looked up (AdminScopeService.decide answers those without a query). */
            if (targets.length && !options.skipScope) {
                const refused = await checkScope(req, res, auth, key, mode, targets);
                if (refused) return refused;
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

/**
 * The scope question alone, for routes that act on a person but have no
 * tree key (restore, suspend, reactivate - see ../../backend-patches/permissions/README.md
 * for why those got no key). `key` is only a label for the log and the 403.
 */
export const RequireInScope = (key: string, target: (req: IRequest) => unknown) => {
    return async (req: IRequest, res: Response, next: NextFunction): Promise<any> => {
        const auth = req.auth as IAuth | undefined;
        if (!auth?.uuid || !auth?.company_uuid) {
            return res.status(401).json({ success: false, message: "Un-authenticate or deleted User" });
        }
        const mode = permissionMode(process.env.PERMISSION_ENFORCE);
        const targets = targetUuids(target(req));
        if (!targets.length) return next();
        try {
            const refused = await checkScope(req, res, auth, key, mode, targets);
            if (refused) return refused;
            return next();
        } catch (error: any) {
            console.error("permissionGuard: scope check failed:", error?.message || error);
            if (mode === "enforce") {
                return res.status(403).json({
                    success: false,
                    message: "Your admin scope could not be checked, so this was not allowed. Please try again.",
                    permission: key,
                });
            }
            return next();
        }
    };
};

export default RequirePermission;
