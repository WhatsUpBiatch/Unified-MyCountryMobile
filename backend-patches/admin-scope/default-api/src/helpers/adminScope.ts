/* Admin scope - WHO an administrator may act on. The pure part.
 *
 * A role (helpers/permissionTree.ts) answers "what may this person do": edit
 * people, delete people. It has no answer for "to whom", so a role that may
 * edit people may edit everybody in the company. This is the second half:
 * scope is a property of the grant. "Location admin, in Delhi." "Group admin,
 * for Sales."
 *
 * WHERE IT LIVES. On the person's own row:
 *
 *   users.settings.admin_scope = {
 *     level:          'company' | 'location' | 'group',
 *     location_uuids: string[],   // sites.uuid, only read when level = location
 *     group_uuids:    string[],   // ring_groups.uuid (the tenant's departments),
 *                                 // only read when level = group
 *   }
 *
 * No key, or a key that does not parse, means company-wide - which is what
 * every administrator has today, so nothing changes for anybody until a scope
 * is written down.
 *
 * THE DECISION (decideScopeAccess), in order:
 *   1. The account owner (ADMIN) is never scoped.
 *   2. Acting on yourself is never scoped (the tree's self rule already applies).
 *   3. No scope, or level = company: allowed.
 *   4. level = location: the target's site_uuid must be one of location_uuids.
 *      A target with no site is refused - guessing "probably mine" is how an
 *      administrator edits somebody in another city.
 *   5. level = group: the target must be a member of one of group_uuids.
 *
 * WHO MAY SET A SCOPE (decideScopeChange):
 *   1. A caller whose role cannot be resolved is refused. Fail closed.
 *   2. Nobody changes their own scope.
 *   3. Only the account owner (ADMIN) and an account admin (MANAGER) set scope.
 *   4. A caller who is themselves scoped (not company-wide) sets nobody's scope:
 *      otherwise a location admin hands out reach they do not have.
 *   5. The owner is never scoped, so no scope is written on the owner.
 *   6. Only the owner changes a MANAGER's scope.
 *   7. Scope is written on administrators only (MANAGER, SUB-ADMIN, or a custom
 *      role hanging off one of them). An AGENT administers nobody.
 *
 * Everything here is pure: no database, no express, no imports.
 */

export type ScopeLevel = "company" | "location" | "group";

export const SCOPE_LEVELS: ReadonlyArray<ScopeLevel> = ["company", "location", "group"];

export interface AdminScope {
    level: ScopeLevel;
    location_uuids: string[];
    group_uuids: string[];
}

export type ScopeRoleKey = "ADMIN" | "SUB-ADMIN" | "MANAGER" | "AGENT" | null;

/** What the decision needs to know about the person being acted on. */
export interface ScopeTarget {
    uuid: string;
    /** users.site_uuid; null / empty when the person has no location. */
    site_uuid?: string | null;
    /** The ring_groups (departments) the person is a member of. */
    group_uuids?: string[];
}

export type ScopeDenyReason =
    | "outside_location" /* target's site is not one of the caller's locations */
    | "no_location" /* target has no site, and the caller is location-scoped */
    | "outside_group" /* target is in none of the caller's groups */
    | "no_group" /* target is in no group at all, and the caller is group-scoped */
    | "empty_scope"; /* a location/group scope with nothing in it covers nobody */

export type ScopeAllowReason = "owner" | "self" | "company" | "location" | "group";

export type ScopeDecision =
    | { ok: true; reason: ScopeAllowReason }
    | { ok: false; reason: ScopeDenyReason; message: string };

export const SCOPE_DENY_MESSAGES: Record<ScopeDenyReason, string> = {
    outside_location: "That person is at a location you do not manage.",
    no_location: "That person has no location set, so a location admin cannot change them. Set their location first.",
    outside_group: "That person is not in a group you manage.",
    no_group: "That person is not in any group, so a group admin cannot change them.",
    empty_scope: "Your admin scope covers nobody. Ask the account owner to check it.",
};

const isUuidLike = (value: unknown): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());

/** Trim, drop blanks and non-uuids, de-duplicate, keep order. */
export const cleanUuidList = (list: unknown): string[] => {
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of list) {
        const value = String(item ?? "").trim();
        if (!value || !isUuidLike(value) || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
};

const asObject = (value: unknown): Record<string, unknown> | null => {
    if (typeof value === "string") {
        try {
            return asObject(JSON.parse(value));
        } catch (error) {
            return null;
        }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
};

export const isScopeLevel = (value: unknown): value is ScopeLevel =>
    (SCOPE_LEVELS as ReadonlyArray<string>).includes(String(value ?? "").trim().toLowerCase());

/**
 * `users.settings.admin_scope` as stored -> a scope, or null when there is
 * none worth reading (absent, unparseable, unknown level). Null means
 * company-wide. The lists the level does not use are dropped so a stale
 * location list cannot come back when the level changes.
 */
export function normaliseAdminScope(raw: unknown): AdminScope | null {
    const source = asObject(raw);
    if (!source) return null;
    const level = String(source.level ?? "").trim().toLowerCase();
    if (!isScopeLevel(level)) return null;
    return {
        level,
        location_uuids: level === "location" ? cleanUuidList(source.location_uuids) : [],
        group_uuids: level === "group" ? cleanUuidList(source.group_uuids) : [],
    };
}

/** The whole `settings` blob -> the scope on it, or null. */
export function scopeFromSettings(settings: unknown): AdminScope | null {
    const source = asObject(settings);
    return source ? normaliseAdminScope(source.admin_scope) : null;
}

/** Company-wide, whether written down or absent. */
export const isCompanyWide = (scope: AdminScope | null | undefined): boolean => !scope || scope.level === "company";

export interface ScopeAccessInput {
    /** The caller's resolved system role; null when it could not be resolved. */
    callerRole: ScopeRoleKey;
    callerUuid: string;
    /** The caller's scope; null = company-wide. */
    scope: AdminScope | null;
    target: ScopeTarget;
}

const same = (a: unknown, b: unknown): boolean => String(a ?? "").trim() === String(b ?? "").trim();

/** May the caller, given their scope, act on this target person at all? */
export function decideScopeAccess(input: ScopeAccessInput): ScopeDecision {
    const { callerRole, callerUuid, scope, target } = input;

    if (callerRole === "ADMIN") return { ok: true, reason: "owner" };
    if (same(callerUuid, target.uuid)) return { ok: true, reason: "self" };
    if (isCompanyWide(scope)) return { ok: true, reason: "company" };

    if (scope!.level === "location") {
        if (scope!.location_uuids.length === 0) {
            return { ok: false, reason: "empty_scope", message: SCOPE_DENY_MESSAGES.empty_scope };
        }
        const site = String(target.site_uuid ?? "").trim();
        if (!site) return { ok: false, reason: "no_location", message: SCOPE_DENY_MESSAGES.no_location };
        return scope!.location_uuids.includes(site)
            ? { ok: true, reason: "location" }
            : { ok: false, reason: "outside_location", message: SCOPE_DENY_MESSAGES.outside_location };
    }

    /* group */
    if (scope!.group_uuids.length === 0) {
        return { ok: false, reason: "empty_scope", message: SCOPE_DENY_MESSAGES.empty_scope };
    }
    const memberships = cleanUuidList(target.group_uuids);
    if (memberships.length === 0) return { ok: false, reason: "no_group", message: SCOPE_DENY_MESSAGES.no_group };
    return memberships.some((uuid) => scope!.group_uuids.includes(uuid))
        ? { ok: true, reason: "group" }
        : { ok: false, reason: "outside_group", message: SCOPE_DENY_MESSAGES.outside_group };
}

/** Who a scope filter for a list should let through. `all` = no filter. */
export type ScopeFilter =
    | { kind: "all" }
    | { kind: "sites"; site_uuids: string[] }
    | { kind: "users"; user_uuids: string[] }
    | { kind: "none" };

/**
 * The list-side twin of decideScopeAccess: what /api/user/list should be
 * narrowed to. `users` carries the members of the caller's groups (resolved by
 * the service); the caller themselves is always included so the list never
 * loses the person reading it.
 */
export function scopeFilter(input: {
    callerRole: ScopeRoleKey;
    callerUuid: string;
    scope: AdminScope | null;
    /** For a group scope: every member uuid of the caller's groups. */
    groupMemberUuids?: string[];
}): ScopeFilter {
    const { callerRole, callerUuid, scope } = input;
    if (callerRole === "ADMIN" || isCompanyWide(scope)) return { kind: "all" };
    if (scope!.level === "location") {
        return scope!.location_uuids.length ? { kind: "sites", site_uuids: [...scope!.location_uuids] } : { kind: "none" };
    }
    if (!scope!.group_uuids.length) return { kind: "none" };
    const members = cleanUuidList(input.groupMemberUuids);
    const me = String(callerUuid ?? "").trim();
    if (me && !members.includes(me)) members.push(me);
    return { kind: "users", user_uuids: members };
}

/* ------------------------------------------------------------------------ */
/* Setting a scope                                                           */
/* ------------------------------------------------------------------------ */

export interface ScopeIdentity {
    uuid: string;
    systemRole: ScopeRoleKey;
    /** The caller's own scope; only read for the caller. */
    scope?: AdminScope | null;
}

export type ScopeChangeDecision = { ok: true } | { ok: false; status: 403; message: string };

export const SCOPE_CHANGE_MESSAGES = {
    UNRESOLVED_CALLER: "Your role could not be determined, so this change was not made. Ask an administrator to check your account.",
    OWN_SCOPE: "You cannot change your own admin scope. Ask the account owner to do it.",
    NOT_ALLOWED: "Only the account owner or an account admin can set an admin scope.",
    CALLER_SCOPED: "Only an administrator over the whole company can set admin scopes.",
    OWNER_TARGET: "The account owner always covers the whole company. Their scope cannot be changed.",
    MANAGER_TARGET: "Only the account owner can change an account admin's scope.",
    NOT_AN_ADMIN: "Admin scope applies to administrators only. Give this person an admin role first.",
} as const;

const refuse = (message: string): ScopeChangeDecision => ({ ok: false, status: 403, message });

/** May `caller` set `target`'s scope? (The value itself is checked separately.) */
export function decideScopeChange(args: { caller: ScopeIdentity; target: ScopeIdentity }): ScopeChangeDecision {
    const { caller, target } = args;

    if (!caller.systemRole) return refuse(SCOPE_CHANGE_MESSAGES.UNRESOLVED_CALLER);
    if (same(caller.uuid, target.uuid)) return refuse(SCOPE_CHANGE_MESSAGES.OWN_SCOPE);
    if (caller.systemRole !== "ADMIN" && caller.systemRole !== "MANAGER") return refuse(SCOPE_CHANGE_MESSAGES.NOT_ALLOWED);
    if (caller.systemRole !== "ADMIN" && !isCompanyWide(caller.scope ?? null)) return refuse(SCOPE_CHANGE_MESSAGES.CALLER_SCOPED);
    if (target.systemRole === "ADMIN") return refuse(SCOPE_CHANGE_MESSAGES.OWNER_TARGET);
    if (target.systemRole === "MANAGER" && caller.systemRole !== "ADMIN") return refuse(SCOPE_CHANGE_MESSAGES.MANAGER_TARGET);
    if (target.systemRole !== "MANAGER" && target.systemRole !== "SUB-ADMIN") return refuse(SCOPE_CHANGE_MESSAGES.NOT_AN_ADMIN);

    return { ok: true };
}

export interface ScopeValueProblem {
    field: "level" | "location_uuids" | "group_uuids";
    message: string;
}

/**
 * Is a requested scope value well-formed and does everything it names exist?
 * `knownLocations` / `knownGroups` are the company's own ids. Returns the
 * problems in the order somebody would fix them; empty = fine.
 */
export function checkScopeValue(
    raw: unknown,
    known: { locations: string[]; groups: string[] },
): { scope: AdminScope | null; problems: ScopeValueProblem[] } {
    const problems: ScopeValueProblem[] = [];
    const source = asObject(raw) ?? {};
    const level = String(source.level ?? "").trim().toLowerCase();
    if (!isScopeLevel(level)) {
        problems.push({ field: "level", message: "Choose Company, Locations or Groups." });
        return { scope: null, problems };
    }
    const scope = normaliseAdminScope({ ...source, level })!;

    if (level === "location") {
        if (scope.location_uuids.length === 0) {
            problems.push({ field: "location_uuids", message: "Pick at least one location, or this admin covers nobody." });
        }
        const unknown = scope.location_uuids.filter((uuid) => !known.locations.includes(uuid));
        if (unknown.length) {
            problems.push({ field: "location_uuids", message: `These locations do not exist in your company: ${unknown.join(", ")}.` });
        }
    }
    if (level === "group") {
        if (scope.group_uuids.length === 0) {
            problems.push({ field: "group_uuids", message: "Pick at least one group, or this admin covers nobody." });
        }
        const unknown = scope.group_uuids.filter((uuid) => !known.groups.includes(uuid));
        if (unknown.length) {
            problems.push({ field: "group_uuids", message: `These groups do not exist in your company: ${unknown.join(", ")}.` });
        }
    }
    return { scope, problems };
}
