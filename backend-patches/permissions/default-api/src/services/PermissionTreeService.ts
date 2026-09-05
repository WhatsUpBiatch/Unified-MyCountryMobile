/* Find the permission tree that applies to the signed-in person.
 *
 * The reading and the decision live in helpers/permissionTree.ts (pure). This
 * file does the lookups, in the order that file documents:
 *
 *   custom role  -> custom_roles.permission (this company's row)
 *   system role  -> role_features (company's plan + role)
 *                -> roles.permission (the PREDEFINED row)
 *                -> users.permission (carried on req.auth)
 *                -> role_features for the platform's default plan
 *
 * Which role the person holds comes from RoleResolverService, so the same
 * resolution the People rules use (custom_role_uuid -> parent, role_uuid, a
 * uuid in users.role, a bare key in users.role) is used here too. The free-text
 * role string is never compared on its own.
 *
 * CACHE. Trees are cached per company for 30 seconds. A role edit therefore
 * takes up to half a minute to reach the server's decision, which is shorter
 * than the time the website takes to notice (it re-reads /api/user/info on the
 * next page load). Keyed by the thing that was looked up, so two people on the
 * same custom role share one lookup.
 */

import CustomRole from "@/models/CustomRole";
import Role from "@/models/Role";
import RoleFeature from "@/models/RoleFeature";
import Plan from "@/models/Plan";
import { IAuth } from "@/interfaces/IRequest";
import RoleResolverService from "@/services/RoleResolverService";
import { SystemRoleKey } from "@/helpers/roleGuard";
import {
    ChosenTree,
    evaluatePermission,
    PermissionDecision,
    selectTree,
    TreeCandidate,
} from "@/helpers/permissionTree";

export const TREE_CACHE_MS = 30 * 1000;

interface CacheEntry {
    at: number;
    value: unknown;
}

const cache = new Map<string, Map<string, CacheEntry>>();

const companyCache = (company_uuid: string): Map<string, CacheEntry> => {
    let entries = cache.get(company_uuid);
    if (!entries) {
        entries = new Map();
        cache.set(company_uuid, entries);
    }
    return entries;
};

async function cached<T>(company_uuid: string, key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    const entries = companyCache(company_uuid);
    const hit = entries.get(key);
    if (hit && now - hit.at < TREE_CACHE_MS) return hit.value as T;
    const value = await load();
    entries.set(key, { at: now, value });
    return value;
}

export interface CallerPermissionContext {
    systemRole: SystemRoleKey | null;
    roleUuid: string | null;
    customRoleUuid: string | null;
    chosen: ChosenTree;
}

export default class PermissionTreeService {
    /** Forget every cached tree, or only one company's. */
    static clearCache(company_uuid?: string): void {
        if (company_uuid) cache.delete(company_uuid);
        else cache.clear();
    }

    /** custom_roles.permission for a role of this company, or null. */
    static async customRoleTree(custom_role_uuid: string, company_uuid: string): Promise<unknown> {
        return cached(company_uuid, `custom:${custom_role_uuid}`, async () => {
            const row: any = await CustomRole.findOne({
                where: { uuid: custom_role_uuid, company_uuid },
                attributes: ["uuid", "permission"],
                raw: true,
            });
            return row?.permission ?? null;
        });
    }

    /** role_features.permission for (plan, role), or null. */
    static async planRoleTree(plan_uuid: string, role_uuid: string, company_uuid: string): Promise<unknown> {
        return cached(company_uuid, `plan:${plan_uuid}:${role_uuid}`, async () => {
            const row: any = await RoleFeature.findOne({
                where: { plan_uuid, role_uuid },
                attributes: ["uuid", "permission"],
                raw: true,
            });
            return row?.permission ?? null;
        });
    }

    /** roles.permission on the role row itself, or null. */
    static async roleRowTree(role_uuid: string, company_uuid: string): Promise<unknown> {
        return cached(company_uuid, `role:${role_uuid}`, async () => {
            const row: any = await Role.findOne({
                where: { uuid: role_uuid },
                attributes: ["uuid", "permission"],
                raw: true,
            });
            return row?.permission ?? null;
        });
    }

    /**
     * The platform's default tree for a system role: the role_features row
     * PlansController seeds for the default plan. Null when there is none.
     */
    static async defaultPlanRoleTree(role_uuid: string, company_uuid: string): Promise<unknown> {
        return cached(company_uuid, `default:${role_uuid}`, async () => {
            const plan: any = await Plan.findOne({
                where: { is_default: 1, status: "A" } as any,
                attributes: ["uuid"],
                order: [["created_at", "DESC"]],
                raw: true,
            });
            if (!plan?.uuid) return null;
            const row: any = await RoleFeature.findOne({
                where: { plan_uuid: plan.uuid, role_uuid },
                attributes: ["uuid", "permission"],
                raw: true,
            });
            return row?.permission ?? null;
        });
    }

    /** Resolve the caller and pick the tree that applies to them. */
    static async contextForCaller(auth: IAuth): Promise<CallerPermissionContext> {
        const identity = await RoleResolverService.resolveCaller(auth);
        const company_uuid = String(auth.company_uuid ?? "");
        const customRoleUuid = identity.customRoleUuid ? String(identity.customRoleUuid) : null;

        /* The PREDEFINED row for the resolved key is the id role_features and
           roles.permission are keyed on; identity.roleUuid may be empty when the
           person was resolved through a custom role's parent. */
        let roleUuid: string | null = identity.roleUuid ? String(identity.roleUuid) : null;
        if (identity.systemRole) {
            const { byKey } = await RoleResolverService.systemRoles();
            roleUuid = byKey.get(identity.systemRole)?.uuid ?? roleUuid;
        }

        /* The owner needs no tree; do not spend four queries finding one. */
        if (identity.systemRole === "ADMIN") {
            return { systemRole: "ADMIN", roleUuid, customRoleUuid, chosen: { source: "none", tree: null } };
        }

        const candidates: TreeCandidate[] = [];
        if (customRoleUuid) {
            candidates.push({ source: "custom_role", tree: await this.customRoleTree(customRoleUuid, company_uuid) });
        }
        if (roleUuid) {
            const plan_uuid = String(auth.plan_uuid ?? "").trim();
            if (plan_uuid) {
                candidates.push({ source: "plan_role_feature", tree: await this.planRoleTree(plan_uuid, roleUuid, company_uuid) });
            }
            candidates.push({ source: "system_role", tree: await this.roleRowTree(roleUuid, company_uuid) });
        }
        candidates.push({ source: "user", tree: auth.permission ?? null });
        if (roleUuid) {
            candidates.push({ source: "default_plan", tree: await this.defaultPlanRoleTree(roleUuid, company_uuid) });
        }

        return { systemRole: identity.systemRole, roleUuid, customRoleUuid, chosen: selectTree(candidates) };
    }

    /** The whole question in one call: may this caller do `key`? */
    static async decide(
        auth: IAuth,
        key: string,
        options: { isSelf?: boolean; selfKey?: string } = {},
    ): Promise<{ decision: PermissionDecision; context: CallerPermissionContext }> {
        const context = await this.contextForCaller(auth);
        const decision = evaluatePermission({
            systemRole: context.systemRole,
            tree: context.chosen.tree,
            key,
            isSelf: options.isSelf,
            selfKey: options.selfKey,
        });
        return { decision, context };
    }
}
