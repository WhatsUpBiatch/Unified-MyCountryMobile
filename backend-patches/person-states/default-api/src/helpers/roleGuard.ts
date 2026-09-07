/* Who may change whose role - the one place the rules live.
 *
 * Every role-changing route (person update, bulk assign, add member, delete,
 * custom-role upsert/remove, role upsert/remove, company template upsert/delete,
 * list-deleted, restore, suspend, reactivate) asks this file before it writes. Until now those
 * routes carried only "is signed in", so any person on the account could make
 * themselves the account owner with one request. A guard was added on 29 Aug
 * but lived only in the compiled file and was lost on the next build; this is
 * the source-tree version.
 *
 * Everything here is pure: no database, no express. The comparison is on the
 * RESOLVED system role - the four built-in keys - never on the free-text
 * `users.role` string, and never on a role's display name. Resolving a person
 * (role_uuid / custom_role_uuid -> parent system role) is the job of
 * services/RoleResolverService.ts; this file only decides.
 *
 * Vocabulary, as the product shows it:
 *   ADMIN      account owner  - one per company, created at signup
 *   MANAGER    account admin
 *   SUB-ADMIN  people admin
 *   AGENT      call reviewer
 *
 * The rules, in the order they are checked:
 *   1. A caller whose role cannot be resolved is refused. Fail closed.
 *   2. Nobody changes their own role. A self-edit that repeats the current role
 *      is not a change: the role part is dropped and the rest saves.
 *   3. Only an administrator (ADMIN, MANAGER, SUB-ADMIN) changes a role, adds
 *      or removes a person, or manages roles and the company template.
 *   4. Only the account owner grants the owner role, and only the owner may
 *      change (or edit) an owner's account.
 *   5. The owner cannot be removed; nobody can remove themselves.
 */

export const SYSTEM_ROLE_KEYS = ["ADMIN", "SUB-ADMIN", "MANAGER", "AGENT"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/** The account owner. There is meant to be exactly one per company. */
export const OWNER_ROLE: SystemRoleKey = "ADMIN";

/** Roles allowed to run the People and Roles screens on the server side.
    Mirrors what the product's own labels promise: "account admin" and
    "people admin" both administer people. AGENT never does. */
export const ADMIN_ROLES: ReadonlyArray<SystemRoleKey> = ["ADMIN", "MANAGER", "SUB-ADMIN"];

export interface RoleIdentity {
    uuid: string;
    /** null when it could not be resolved from role_uuid / custom_role_uuid / a valid users.role. */
    systemRole: SystemRoleKey | null;
    roleUuid?: string | null;
    customRoleUuid?: string | null;
}

export interface RequestedRole {
    systemRole: SystemRoleKey | null;
    roleUuid?: string | null;
    customRoleUuid?: string | null;
}

export type RoleDecision =
    | { ok: true; /** false = a self-edit repeating the current role: drop the role fields, save the rest. */ apply: boolean }
    | { ok: false; status: 403; message: string };

const refuse = (message: string): RoleDecision => ({ ok: false, status: 403, message });
const allow = (apply = true): RoleDecision => ({ ok: true, apply });

export const MESSAGES = {
    UNRESOLVED_CALLER: "Your role could not be determined, so this change was not made. Ask an administrator to check your account.",
    OWN_ROLE: "You cannot change your own role. Ask another administrator to do it.",
    NOT_ADMIN_ROLE: "Only an administrator can change a person's role.",
    NOT_ADMIN_EDIT: "Only an administrator can edit another person.",
    NOT_ADMIN_MANAGE: "Only an administrator can do this.",
    OWNER_GRANT: "Only the account owner can make someone the account owner.",
    OWNER_TARGET: "Only the account owner can change the account owner's role.",
    OWNER_EDIT: "Only the account owner can edit the account owner's account.",
    OWNER_DELETE: "The account owner cannot be removed.",
    SELF_DELETE: "You cannot remove yourself.",
    NOT_ADMIN_DELETE: "Only an administrator can remove a person.",
    OWNER_SUSPEND: "The account owner cannot be suspended.",
    SELF_SUSPEND: "You cannot suspend yourself.",
    NOT_ADMIN_SUSPEND: "Only an administrator can suspend or reactivate a person.",
} as const;

/** "admin", " Admin ", "SUB_ADMIN" -> the key; anything else -> null. */
export function normaliseSystemRole(value: unknown): SystemRoleKey | null {
    const key = String(value ?? "").trim().toUpperCase().replace(/_/g, "-");
    return (SYSTEM_ROLE_KEYS as ReadonlyArray<string>).includes(key) ? (key as SystemRoleKey) : null;
}

export function isUuidLike(value: unknown): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

export function isAdminRole(role: SystemRoleKey | null | undefined): boolean {
    return !!role && ADMIN_ROLES.includes(role);
}

export function isOwnerRole(role: SystemRoleKey | null | undefined): boolean {
    return role === OWNER_ROLE;
}

const same = (a: unknown, b: unknown): boolean => String(a ?? "").trim() === String(b ?? "").trim();

/** Is the requested role the one the person already holds? Compared on the
    resolved system role AND on the custom role id, so "swap my custom role
    for a different custom role under the same parent" still counts as a change. */
export function isSameRole(current: RoleIdentity, requested: RequestedRole): boolean {
    if (current.systemRole !== requested.systemRole) return false;
    return same(current.customRoleUuid, requested.customRoleUuid);
}

/** May `caller` set `target`'s role to `requested`? */
export function decideRoleChange(args: {
    caller: RoleIdentity;
    target: RoleIdentity;
    requested: RequestedRole;
}): RoleDecision {
    const { caller, target, requested } = args;

    if (!caller.systemRole) return refuse(MESSAGES.UNRESOLVED_CALLER);

    if (same(caller.uuid, target.uuid)) {
        /* Editing yourself: the role part is either a no-op (dropped) or a refusal. */
        return isSameRole(target, requested) ? allow(false) : refuse(MESSAGES.OWN_ROLE);
    }

    if (!isAdminRole(caller.systemRole)) return refuse(MESSAGES.NOT_ADMIN_ROLE);

    if (isOwnerRole(requested.systemRole) && !isOwnerRole(caller.systemRole)) {
        return refuse(MESSAGES.OWNER_GRANT);
    }

    if (isOwnerRole(target.systemRole) && !isOwnerRole(caller.systemRole)) {
        return refuse(MESSAGES.OWNER_TARGET);
    }

    return allow(true);
}

/** May `caller` edit `target`'s non-role fields (name, settings, forwarding...)? */
export function decidePersonEdit(args: { caller: RoleIdentity; target: RoleIdentity }): RoleDecision {
    const { caller, target } = args;

    if (same(caller.uuid, target.uuid)) return allow(true);

    if (!caller.systemRole) return refuse(MESSAGES.UNRESOLVED_CALLER);
    if (!isAdminRole(caller.systemRole)) return refuse(MESSAGES.NOT_ADMIN_EDIT);
    if (isOwnerRole(target.systemRole) && !isOwnerRole(caller.systemRole)) {
        return refuse(MESSAGES.OWNER_EDIT);
    }

    return allow(true);
}

/** May `caller` remove `target`? */
export function decidePersonDelete(args: { caller: RoleIdentity; target: RoleIdentity }): RoleDecision {
    const { caller, target } = args;

    if (same(caller.uuid, target.uuid)) return refuse(MESSAGES.SELF_DELETE);
    if (!caller.systemRole) return refuse(MESSAGES.UNRESOLVED_CALLER);
    if (!isAdminRole(caller.systemRole)) return refuse(MESSAGES.NOT_ADMIN_DELETE);
    if (isOwnerRole(target.systemRole)) return refuse(MESSAGES.OWNER_DELETE);

    return allow(true);
}

/** May `caller` suspend `target` (block their login and their phone)? The same
    shape as removing them: an administrator, never yourself, never the owner.
    Reactivating uses decideAdminAction - there is no "self" or "owner" case,
    because neither can be suspended in the first place. */
export function decidePersonSuspend(args: { caller: RoleIdentity; target: RoleIdentity }): RoleDecision {
    const { caller, target } = args;

    if (same(caller.uuid, target.uuid)) return refuse(MESSAGES.SELF_SUSPEND);
    if (!caller.systemRole) return refuse(MESSAGES.UNRESOLVED_CALLER);
    if (!isAdminRole(caller.systemRole)) return refuse(MESSAGES.NOT_ADMIN_SUSPEND);
    if (isOwnerRole(target.systemRole)) return refuse(MESSAGES.OWNER_SUSPEND);

    return allow(true);
}

/** May `caller` do an administrative thing that has no single target: manage
    roles, edit the company template, add people, list or restore removed people? */
export function decideAdminAction(args: { caller: RoleIdentity }): RoleDecision {
    const { caller } = args;

    if (!caller.systemRole) return refuse(MESSAGES.UNRESOLVED_CALLER);
    if (!isAdminRole(caller.systemRole)) return refuse(MESSAGES.NOT_ADMIN_MANAGE);

    return allow(true);
}

/** May `caller` create a NEW person holding `requested`? (No target yet.) */
export function decideNewMemberRole(args: { caller: RoleIdentity; requested: RequestedRole }): RoleDecision {
    const { caller, requested } = args;

    const admin = decideAdminAction({ caller });
    if (!admin.ok) return admin;

    if (isOwnerRole(requested.systemRole) && !isOwnerRole(caller.systemRole)) {
        return refuse(MESSAGES.OWNER_GRANT);
    }

    return allow(true);
}
