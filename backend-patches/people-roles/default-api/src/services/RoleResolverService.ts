/* Turn what a user row (or a request) says about a role into a system role key.
 *
 * `users.role` is free text. Custom roles used to copy their NAME into it, so
 * live rows hold things like "Custom Sub-Admin", "New role" and raw uuids, and
 * a custom role named ADMIN made its holder the account owner. Nothing that
 * decides authorisation may read that column first any more.
 *
 * Resolution order, for a person:
 *   1. custom_role_uuid -> custom_roles.role_uuid -> roles.name  (the parent system role)
 *   2. role_uuid        -> roles.name                            (a system role directly)
 *   3. users.role, only if it is already one of the four keys    (fallback, logged)
 * Anything else resolves to null, and helpers/roleGuard.ts fails closed on null.
 *
 * The four PREDEFINED roles are cached for a minute: they are shared by every
 * company and never change at runtime.
 */

import Role from "@/models/Role";
import CustomRole from "@/models/CustomRole";
import { IAuth } from "@/interfaces/IRequest";
import {
    isUuidLike,
    normaliseSystemRole,
    RoleIdentity,
    RequestedRole,
    SystemRoleKey,
} from "@/helpers/roleGuard";

const SYSTEM_ROLE_CACHE_MS = 60 * 1000;

interface SystemRoleRow {
    uuid: string;
    name: string;
    key: SystemRoleKey;
}

let cache: { at: number; byUuid: Map<string, SystemRoleRow>; byKey: Map<SystemRoleKey, SystemRoleRow> } | null = null;

export interface RoleSourceRow {
    uuid: string;
    role?: string | null;
    role_uuid?: string | null;
    custom_role_uuid?: string | null;
}

export interface ResolvedRequestedRole extends RequestedRole {
    /** What the screens show: the custom role's own name, or the system key. */
    label: string;
}

export type RequestedRoleResult =
    | { ok: true; role: ResolvedRequestedRole }
    | { ok: false; message: string };

export default class RoleResolverService {
    /** The PREDEFINED roles table rows whose names are system keys. */
    static async systemRoles(force = false): Promise<{ byUuid: Map<string, SystemRoleRow>; byKey: Map<SystemRoleKey, SystemRoleRow> }> {
        if (!force && cache && Date.now() - cache.at < SYSTEM_ROLE_CACHE_MS) return cache;

        const rows: any[] = await Role.findAll({
            where: { company_uuid: "PREDEFINED" },
            attributes: ["uuid", "name"],
            raw: true,
        });

        const byUuid = new Map<string, SystemRoleRow>();
        const byKey = new Map<SystemRoleKey, SystemRoleRow>();
        for (const row of rows) {
            const key = normaliseSystemRole(row?.name);
            if (!key) continue;
            const entry = { uuid: String(row.uuid), name: String(row.name), key };
            byUuid.set(entry.uuid, entry);
            if (!byKey.has(key)) byKey.set(key, entry);
        }
        cache = { at: Date.now(), byUuid, byKey };
        return cache;
    }

    static clearCache(): void {
        cache = null;
    }

    /** role_uuid -> system key, or null if it is not one of the PREDEFINED roles. */
    static async systemRoleFromRoleUuid(role_uuid: unknown): Promise<SystemRoleKey | null> {
        const id = String(role_uuid ?? "").trim();
        if (!id) return null;
        const { byUuid } = await this.systemRoles();
        if (byUuid.has(id)) return byUuid.get(id)!.key;

        /* Not in the cache: either a stale cache or a company-created row in
           `roles` (the old /role/upsert path). Look once more, uncached. */
        const row: any = await Role.findOne({ where: { uuid: id }, attributes: ["uuid", "name", "company_uuid"], raw: true });
        if (!row) return null;
        if (String(row.company_uuid) === "PREDEFINED") {
            this.clearCache();
            return normaliseSystemRole(row.name);
        }
        return null;
    }

    /** The system role a custom role hangs off, scoped to the company. */
    static async customRoleParent(custom_role_uuid: unknown, company_uuid: string): Promise<{ customRoleUuid: string; name: string; parentRoleUuid: string; systemRole: SystemRoleKey | null } | null> {
        const id = String(custom_role_uuid ?? "").trim();
        if (!id) return null;
        const row: any = await CustomRole.findOne({
            where: { uuid: id, company_uuid },
            attributes: ["uuid", "name", "role_uuid"],
            raw: true,
        });
        if (!row) return null;
        return {
            customRoleUuid: String(row.uuid),
            name: String(row.name ?? ""),
            parentRoleUuid: String(row.role_uuid ?? ""),
            systemRole: await this.systemRoleFromRoleUuid(row.role_uuid),
        };
    }

    /** What a stored person actually is. */
    static async resolveIdentity(row: RoleSourceRow, company_uuid: string): Promise<RoleIdentity> {
        const identity: RoleIdentity = {
            uuid: String(row.uuid),
            systemRole: null,
            roleUuid: row.role_uuid ?? null,
            customRoleUuid: row.custom_role_uuid ?? null,
        };

        if (row.custom_role_uuid) {
            const custom = await this.customRoleParent(row.custom_role_uuid, company_uuid);
            if (custom?.systemRole) {
                identity.systemRole = custom.systemRole;
                return identity;
            }
        }

        if (row.role_uuid) {
            const key = await this.systemRoleFromRoleUuid(row.role_uuid);
            if (key) {
                identity.systemRole = key;
                return identity;
            }
        }

        /* About half the live rows carry a role UUID in the text column with
           no role_uuid beside it. Until the data-fix migration has run, read it
           as the id it is (system role, or a custom role of this company). */
        const text = String(row.role ?? "").trim();
        if (isUuidLike(text)) {
            const key = await this.systemRoleFromRoleUuid(text);
            if (key) {
                identity.systemRole = key;
                identity.roleUuid = text;
                return identity;
            }
            const custom = await this.customRoleParent(text, company_uuid);
            if (custom?.systemRole) {
                identity.systemRole = custom.systemRole;
                identity.roleUuid = custom.parentRoleUuid;
                identity.customRoleUuid = custom.customRoleUuid;
                return identity;
            }
        }

        /* Fallback: the free-text column, but only when it already IS a key.
           "Custom Sub-Admin" resolves to nothing. */
        const fallback = normaliseSystemRole(row.role);
        if (fallback) {
            console.warn(`RoleResolverService: user ${row.uuid} resolved from users.role text ("${row.role}") - role_uuid/custom_role_uuid did not resolve`);
            identity.systemRole = fallback;
        }
        return identity;
    }

    static async resolveCaller(auth: IAuth): Promise<RoleIdentity> {
        return this.resolveIdentity(
            {
                uuid: auth.uuid,
                role: auth.role,
                role_uuid: auth.role_uuid ?? null,
                custom_role_uuid: auth.custom_role_uuid ?? null,
            },
            auth.company_uuid,
        );
    }

    /**
     * What a request is asking a person to become. Accepts the shapes the
     * screens send today: custom_role_uuid, role_uuid (a system role, or - for
     * older screens - a custom role's uuid), or a bare `role` name that is one
     * of the four keys. Returns null role when nothing role-like was sent.
     */
    static async resolveRequestedRole(
        input: { role_uuid?: unknown; custom_role_uuid?: unknown; role?: unknown },
        company_uuid: string,
    ): Promise<RequestedRoleResult | { ok: true; role: null }> {
        const customId = String(input.custom_role_uuid ?? "").trim();
        const roleId = String(input.role_uuid ?? "").trim();
        const roleName = String(input.role ?? "").trim();

        if (customId) {
            const custom = await this.customRoleParent(customId, company_uuid);
            if (!custom) return { ok: false, message: "Custom role does not exist" };
            if (!custom.systemRole) return { ok: false, message: "System role not assigned to custom role" };
            return {
                ok: true,
                role: { systemRole: custom.systemRole, roleUuid: custom.parentRoleUuid, customRoleUuid: custom.customRoleUuid, label: custom.name },
            };
        }

        if (roleId) {
            const key = await this.systemRoleFromRoleUuid(roleId);
            if (key) {
                const { byKey } = await this.systemRoles();
                return { ok: true, role: { systemRole: key, roleUuid: byKey.get(key)?.uuid ?? roleId, customRoleUuid: null, label: key } };
            }
            /* Backward compatibility: a custom role's uuid arriving in role_uuid. */
            const custom = await this.customRoleParent(roleId, company_uuid);
            if (!custom) return { ok: false, message: "Role does not exist" };
            if (!custom.systemRole) return { ok: false, message: "System role not assigned to custom role" };
            return {
                ok: true,
                role: { systemRole: custom.systemRole, roleUuid: custom.parentRoleUuid, customRoleUuid: custom.customRoleUuid, label: custom.name },
            };
        }

        if (roleName) {
            const key = normaliseSystemRole(roleName);
            if (!key) return { ok: false, message: "Role does not exist. Send the role's id, not its name." };
            const { byKey } = await this.systemRoles();
            const row = byKey.get(key);
            if (!row) return { ok: false, message: `System role ${key} is not configured on this platform.` };
            return { ok: true, role: { systemRole: key, roleUuid: row.uuid, customRoleUuid: null, label: key } };
        }

        return { ok: true, role: null };
    }
}
