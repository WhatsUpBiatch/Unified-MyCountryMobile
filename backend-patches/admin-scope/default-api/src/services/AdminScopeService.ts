/* Admin scope - the lookups. The rules are in helpers/adminScope.ts (pure).
 *
 * Three things are read, each cached per company for 30 seconds - the same
 * window as the permission tree, so a scope edit reaches the server's decision
 * as fast as a role edit does:
 *
 *   person   users row: site_uuid, the role columns, settings.admin_scope
 *   groups   the tenant's departments (`ring_groups` in the tenant database,
 *            read through tenant-api `department/listing` - the tenantDb()
 *            helper opens a fresh pool per call and must not sit on a
 *            per-request path, see CompanyPolicyService). Members are the
 *            JSON `members` array, one `{ user_uuid, ... }` per person; the
 *            manager is `{ user_uuid }` and counts as a member.
 *   sites    the company's locations, for validating a scope before writing
 *
 * The caller's scope is read from their ROW, not from req.auth: the session
 * carries the row as it was at login, and a scope set an hour ago must apply
 * now.
 *
 * Nothing here decides. decide() gathers and hands to decideScopeAccess;
 * setScope() gathers and hands to decideScopeChange + checkScopeValue.
 */

import { Op } from "sequelize";
import User from "@/models/User";
import Site from "@/models/Site";
import CustomRole from "@/models/CustomRole";
import { IAuth } from "@/interfaces/IRequest";
import RoleResolverService from "@/services/RoleResolverService";
import { TenantApiService } from "@/services/TenantApiService";
import { SystemRoleKey, normaliseSystemRole, isUuidLike } from "@/helpers/roleGuard";
import {
    AdminScope,
    ScopeDecision,
    ScopeFilter,
    checkScopeValue,
    decideScopeAccess,
    decideScopeChange,
    scopeFilter,
    scopeFromSettings,
} from "@/helpers/adminScope";

export const SCOPE_CACHE_MS = 30 * 1000;

/** How many pages of departments to walk. 200 per page; 10 pages is 2,000 groups. */
const GROUP_PAGE_SIZE = 200;
const GROUP_MAX_PAGES = 10;

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
    if (hit && now - hit.at < SCOPE_CACHE_MS) return hit.value as T;
    const value = await load();
    entries.set(key, { at: now, value });
    return value;
}

const parseJson = (value: unknown): any => {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
};

export interface ScopedPerson {
    uuid: string;
    company_uuid: string;
    site_uuid: string | null;
    role: string | null;
    role_uuid: string | null;
    custom_role_uuid: string | null;
    settings: Record<string, unknown> | null;
    scope: AdminScope | null;
}

export interface GroupRecord {
    uuid: string;
    name: string;
    /** users.uuid of every member, manager included. */
    member_uuids: string[];
}

export interface ScopeContext {
    callerRole: SystemRoleKey | null;
    scope: AdminScope | null;
    target: { uuid: string; site_uuid: string | null; group_uuids: string[] } | null;
}

export type SetScopeResult =
    | { ok: true; uuid: string; scope: AdminScope }
    | { ok: false; status: number; message: string; problems?: { field: string; message: string }[] };

export interface ScopeListRow {
    uuid: string;
    system_role: SystemRoleKey | null;
    admin_scope: AdminScope | null;
}

const memberUuidsOf = (row: any): string[] => {
    const out = new Set<string>();
    const members = parseJson(row?.members);
    if (Array.isArray(members)) {
        for (const member of members) {
            const uuid = String(member?.user_uuid ?? member?.uuid ?? "").trim();
            if (uuid && isUuidLike(uuid)) out.add(uuid);
        }
    }
    const manager = parseJson(row?.manager);
    const managerUuid = String(manager?.user_uuid ?? "").trim();
    if (managerUuid && isUuidLike(managerUuid)) out.add(managerUuid);
    return Array.from(out);
};

export default class AdminScopeService {
    /** Forget every cached lookup, or only one company's. */
    static clearCache(company_uuid?: string): void {
        if (company_uuid) cache.delete(company_uuid);
        else cache.clear();
    }

    /** One person's row, as the scope decision needs it. Null when not in this company. */
    static async person(company_uuid: string, uuid: string): Promise<ScopedPerson | null> {
        const id = String(uuid ?? "").trim();
        if (!id) return null;
        return cached(company_uuid, `person:${id}`, async () => {
            const row: any = await User.findOne({
                where: { uuid: id, company_uuid },
                attributes: ["uuid", "company_uuid", "site_uuid", "role", "role_uuid", "custom_role_uuid", "settings"],
                paranoid: false,
                raw: true,
            });
            if (!row) return null;
            const settings = parseJson(row.settings);
            return {
                uuid: String(row.uuid),
                company_uuid: String(row.company_uuid),
                site_uuid: row.site_uuid ? String(row.site_uuid) : null,
                role: row.role ?? null,
                role_uuid: row.role_uuid ?? null,
                custom_role_uuid: row.custom_role_uuid ?? null,
                settings: settings && typeof settings === "object" && !Array.isArray(settings) ? settings : null,
                scope: scopeFromSettings(settings),
            } as ScopedPerson;
        });
    }

    /**
     * Every department of the tenant with its member uuids. Read through
     * tenant-api. A tenant-api failure throws; the guard treats that like any
     * other failed check (through in report mode, refused in enforce).
     */
    static async groups(auth: IAuth): Promise<GroupRecord[]> {
        const company_uuid = String(auth.company_uuid ?? "");
        const db_name = String(auth.db_name ?? "").trim();
        if (!db_name) return [];
        return cached(company_uuid, `groups:${db_name}`, async () => {
            const out: GroupRecord[] = [];
            for (let page = 1; page <= GROUP_MAX_PAGES; page += 1) {
                const response = await TenantApiService.callTenantApi(
                    db_name,
                    "department/listing",
                    "POST",
                    { page, limit: GROUP_PAGE_SIZE },
                    auth,
                );
                const result = response?.data?.data?.result;
                const rows: any[] = Array.isArray(result?.rows) ? result.rows : [];
                for (const row of rows) {
                    const uuid = String(row?.uuid ?? "").trim();
                    if (!uuid) continue;
                    out.push({ uuid, name: String(row?.name ?? ""), member_uuids: memberUuidsOf(row) });
                }
                if (rows.length < GROUP_PAGE_SIZE) break;
            }
            return out;
        });
    }

    /** The company's location uuids. */
    static async siteUuids(company_uuid: string): Promise<string[]> {
        return cached(company_uuid, "sites", async () => {
            const rows: any[] = await Site.findAll({ where: { company_uuid }, attributes: ["uuid"], raw: true });
            return rows.map((row) => String(row.uuid));
        });
    }

    /** The groups a person belongs to. */
    static async groupsOf(auth: IAuth, uuid: string): Promise<string[]> {
        const groups = await this.groups(auth);
        return groups.filter((group) => group.member_uuids.includes(uuid)).map((group) => group.uuid);
    }

    /** The caller's role and scope, from their row (not the session). */
    static async callerContext(auth: IAuth): Promise<{ callerRole: SystemRoleKey | null; scope: AdminScope | null }> {
        const identity = await RoleResolverService.resolveCaller(auth);
        if (identity.systemRole === "ADMIN") return { callerRole: "ADMIN", scope: null };
        const row = await this.person(String(auth.company_uuid ?? ""), String(auth.uuid ?? ""));
        return { callerRole: identity.systemRole, scope: row?.scope ?? null };
    }

    /**
     * May the caller act on this target person, given the caller's scope?
     * A target that is not in the company at all is passed through here: the
     * handler's own "person not found" answers that, and a scope refusal
     * would only leak that the uuid exists elsewhere.
     */
    static async decide(auth: IAuth, targetUuid: string): Promise<{ decision: ScopeDecision; context: ScopeContext }> {
        const { callerRole, scope } = await this.callerContext(auth);
        const callerUuid = String(auth.uuid ?? "");
        const company_uuid = String(auth.company_uuid ?? "");

        /* Owner, self and company-wide need no target lookup at all. */
        if (callerRole === "ADMIN" || !scope || scope.level === "company" || callerUuid === String(targetUuid).trim()) {
            const decision = decideScopeAccess({ callerRole, callerUuid, scope, target: { uuid: targetUuid } });
            return { decision, context: { callerRole, scope, target: null } };
        }

        const row = await this.person(company_uuid, targetUuid);
        if (!row) {
            return { decision: { ok: true, reason: "company" }, context: { callerRole, scope, target: null } };
        }
        const group_uuids = scope.level === "group" ? await this.groupsOf(auth, row.uuid) : [];
        const target = { uuid: row.uuid, site_uuid: row.site_uuid, group_uuids };
        const decision = decideScopeAccess({ callerRole, callerUuid, scope, target });
        return { decision, context: { callerRole, scope, target } };
    }

    /**
     * What /api/user/list should be narrowed to for this caller. Not applied
     * anywhere yet (UserController is not to be edited today); the People list
     * can call this and add `where` to its query. `where` is a Sequelize where
     * fragment on the users table, or null for "no filter".
     */
    static async scopeFilterFor(auth: IAuth): Promise<{ filter: ScopeFilter; where: Record<string, unknown> | null }> {
        const { callerRole, scope } = await this.callerContext(auth);
        let groupMemberUuids: string[] = [];
        if (scope?.level === "group" && callerRole !== "ADMIN") {
            const groups = await this.groups(auth);
            groupMemberUuids = groups.filter((g) => scope.group_uuids.includes(g.uuid)).flatMap((g) => g.member_uuids);
        }
        const filter = scopeFilter({ callerRole, callerUuid: String(auth.uuid ?? ""), scope, groupMemberUuids });
        switch (filter.kind) {
            case "all":
                return { filter, where: null };
            case "sites":
                return { filter, where: { site_uuid: { [Op.in]: filter.site_uuids } } };
            case "users":
                return { filter, where: { uuid: { [Op.in]: filter.user_uuids } } };
            default:
                /* A scope that covers nobody: only the caller. */
                return { filter, where: { uuid: String(auth.uuid ?? "") } };
        }
    }

    /** Write a scope on a person. Rules: decideScopeChange, then checkScopeValue. */
    static async setScope(auth: IAuth, targetUuid: string, raw: unknown): Promise<SetScopeResult> {
        const company_uuid = String(auth.company_uuid ?? "");
        const caller = await RoleResolverService.resolveCaller(auth);
        const callerRow = caller.systemRole === "ADMIN" ? null : await this.person(company_uuid, String(auth.uuid));

        const target = await this.person(company_uuid, targetUuid);
        if (!target) return { ok: false, status: 404, message: "Person not found." };
        const targetIdentity = await RoleResolverService.resolveIdentity(
            { uuid: target.uuid, role: target.role, role_uuid: target.role_uuid, custom_role_uuid: target.custom_role_uuid },
            company_uuid,
        );

        const decision = decideScopeChange({
            caller: { uuid: caller.uuid, systemRole: caller.systemRole, scope: callerRow?.scope ?? null },
            target: { uuid: target.uuid, systemRole: targetIdentity.systemRole },
        });
        if (!decision.ok) return { ok: false, status: decision.status, message: decision.message };

        const level = String((raw as any)?.level ?? "").trim().toLowerCase();
        const known = {
            locations: level === "location" ? await this.siteUuids(company_uuid) : [],
            groups: level === "group" ? (await this.groups(auth)).map((group) => group.uuid) : [],
        };
        const { scope, problems } = checkScopeValue(raw, known);
        if (!scope || problems.length) {
            return { ok: false, status: 422, message: problems[0]?.message ?? "That scope is not valid.", problems };
        }

        /* Merge into the existing settings blob: never replace the rest of it. */
        const settings = { ...(target.settings ?? {}), admin_scope: scope };
        await User.update({ settings } as any, { where: { uuid: target.uuid, company_uuid } });
        companyCache(company_uuid).delete(`person:${target.uuid}`);

        console.log(
            `AdminScopeService: ${auth.uuid} set scope of ${target.uuid} (company ${company_uuid}) to ${JSON.stringify(scope)}`,
        );
        return { ok: true, uuid: target.uuid, scope };
    }

    /**
     * Every live person's resolved system role and scope, for the People list
     * and the Admin scope screen. Roles are resolved in memory from one read
     * of the company's custom roles, so a large company costs three queries,
     * not one per person.
     */
    static async listScopes(auth: IAuth): Promise<ScopeListRow[]> {
        const company_uuid = String(auth.company_uuid ?? "");
        const [users, customRoles, { byUuid }] = await Promise.all([
            User.findAll({
                where: { company_uuid },
                attributes: ["uuid", "role", "role_uuid", "custom_role_uuid", "settings"],
                raw: true,
            }) as Promise<any[]>,
            CustomRole.findAll({ where: { company_uuid }, attributes: ["uuid", "role_uuid"], raw: true }) as Promise<any[]>,
            RoleResolverService.systemRoles(),
        ]);
        const customParent = new Map<string, string>();
        for (const row of customRoles) customParent.set(String(row.uuid), String(row.role_uuid ?? ""));

        const roleOf = (row: any): SystemRoleKey | null => {
            const viaCustom = row.custom_role_uuid ? byUuid.get(customParent.get(String(row.custom_role_uuid)) ?? "")?.key : null;
            if (viaCustom) return viaCustom;
            const viaRole = row.role_uuid ? byUuid.get(String(row.role_uuid))?.key : null;
            if (viaRole) return viaRole;
            const text = String(row.role ?? "").trim();
            if (isUuidLike(text)) {
                const direct = byUuid.get(text)?.key;
                if (direct) return direct;
                const parent = byUuid.get(customParent.get(text) ?? "")?.key;
                if (parent) return parent;
            }
            return normaliseSystemRole(text);
        };

        return users.map((row) => ({
            uuid: String(row.uuid),
            system_role: roleOf(row),
            admin_scope: scopeFromSettings(parseJson(row.settings)),
        }));
    }
}
