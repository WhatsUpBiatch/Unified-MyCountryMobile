/* Reading a role's permission tree - the pure part.
 *
 * An administrator builds a tree of tick-boxes for a role (Roles > Add role).
 * The website reads that tree to decide which buttons and pages to show. Until
 * now no server route read it at all, so every tick-box was decorative: a
 * person could untick "delete people" in the browser and still send the delete
 * request by hand. This file is the server's reader of the same tree.
 *
 * THE TREE. What the website saves (`roles/add-new-role/index.tsx`) is
 *
 *   { plan_features: { account_setting: { access: { USER: { action: { view, add,
 *     edit, delete, ... } } } }, reports: { action: { call, sms,
 *     call_recording_listen } }, phone_system_action: { access: {...},
 *     action: { view, add, ... } }, ... } }
 *
 * and the website reads it by walking a dotted path
 * (`router/protected-route.tsx`): `account_setting.access.USER.action.edit`
 * means plan_features → account_setting → access → USER → action → edit. Only
 * the boolean at the end counts. A missing key is NOT permission - the website
 * says the same in so many words - so a role that never had the key is refused,
 * not waved through.
 *
 * WHERE THE TREE COMES FROM (services/PermissionTreeService.ts loads, this file
 * only chooses and reads):
 *   custom role      -> custom_roles.permission                 (its own tree)
 *   system role      -> role_features.permission for the company's plan,
 *                       else roles.permission on the PREDEFINED row,
 *                       else users.permission on the person,
 *                       else role_features.permission for the platform's
 *                       default plan (what PlansController seeds)
 *   ADMIN            -> no tree needed: the account owner passes everything,
 *                       exactly as the website gives ADMIN the whole plan tree.
 *   nothing resolves -> refused. Fail closed.
 *
 * That order is the website's (`hooks/rbac.tsx`: custom_role_data.permission ??
 * role_data.permission ?? users.permission) with the default-plan tree added
 * at the end so a system role on a plan that never got its rows seeded is not
 * locked out of everything.
 *
 * SELF VERSUS OTHER. A route that acts on a person (edit) is asked twice: is
 * the caller acting on their own record? If the tree carries an explicit
 * `<...>.action.self` boolean it decides; the trees seeded today do not, and
 * then acting on yourself is always allowed - the People rules
 * (helpers/roleGuard.ts) already say editing yourself needs no administrator.
 *
 * REPORT / ENFORCE. Same two modes as CompanyPolicyLock: `report` (the default)
 * writes a log line saying what would have been refused; `enforce` refuses.
 *
 * Everything here is pure: no database, no express, no imports.
 */

export type PermissionTree = Record<string, any>;

export type SystemRoleKeyLike = "ADMIN" | "SUB-ADMIN" | "MANAGER" | "AGENT" | null;

/** Where a tree came from, for the log line. */
export type TreeSource =
    | "custom_role"
    | "plan_role_feature"
    | "system_role"
    | "user"
    | "default_plan"
    | "none";

export interface TreeCandidate {
    source: TreeSource;
    tree: unknown;
}

export interface ChosenTree {
    source: TreeSource;
    tree: PermissionTree | null;
}

const asObject = (value: unknown): PermissionTree => {
    if (typeof value === "string") {
        try {
            return asObject(JSON.parse(value));
        } catch (error) {
            return {};
        }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? (value as PermissionTree) : {};
};

/** Is this something with at least one key in it, once parsed? */
export const isNonEmptyTree = (value: unknown): boolean => Object.keys(asObject(value)).length > 0;

/**
 * The module map the keys are written against. Mirrors the website's
 * `extractPlanFeatures`: parse a JSON string, unwrap `plan_features` up to
 * three levels (company trees are `plan_features.plan_features`, role trees
 * `permission.plan_features`), and let the misspelled `wishper` key answer for
 * `whisper` in older custom roles.
 */
export function unwrapPlanFeatures(source: unknown): PermissionTree {
    let current = asObject(source);
    for (let depth = 0; depth < 3 && "plan_features" in current; depth += 1) {
        current = asObject(current.plan_features);
    }

    const monitoring = asObject(current.monitoring_features);
    const actions = asObject(monitoring.action);
    if (!("whisper" in actions) && "wishper" in actions) {
        return {
            ...current,
            monitoring_features: { ...monitoring, action: { ...actions, whisper: actions.wishper } },
        };
    }
    return current;
}

/**
 * First candidate that holds a non-empty tree, in the order given. `none`
 * when nothing does. The caller lists candidates in the resolution order
 * described at the top of this file.
 */
export function selectTree(candidates: TreeCandidate[]): ChosenTree {
    for (const candidate of candidates) {
        if (isNonEmptyTree(candidate.tree)) {
            return { source: candidate.source, tree: unwrapPlanFeatures(candidate.tree) };
        }
    }
    return { source: "none", tree: null };
}

/** Split "a.b.c" into ["a","b","c"], dropping empty segments. */
export const keyPath = (key: string): string[] =>
    String(key ?? "")
        .split(".")
        .map((part) => part.trim())
        .filter(Boolean);

/**
 * The boolean at the end of a dotted path, or undefined when the path does not
 * reach a boolean. Case-sensitive, exactly like the website's reader. `1`/`0`
 * and "true"/"false" are read as booleans because JSON that has been through
 * MySQL and back has arrived in those shapes before.
 */
export function readPermission(tree: PermissionTree | null | undefined, key: string): boolean | undefined {
    const parts = keyPath(key);
    if (!tree || parts.length === 0) return undefined;
    let node: any = tree;
    for (const part of parts) {
        if (!node || typeof node !== "object" || !(part in node)) return undefined;
        node = node[part];
    }
    if (typeof node === "boolean") return node;
    if (node === 1 || node === "1" || node === "true") return true;
    if (node === 0 || node === "0" || node === "false") return false;
    return undefined;
}

export const hasPermissionKey = (tree: PermissionTree | null | undefined, key: string): boolean =>
    readPermission(tree, key) !== undefined;

/** `a.b.c.edit` -> `a.b.c.self`: the sibling key that would govern "on myself". */
export const selfKeyFor = (key: string): string => {
    const parts = keyPath(key);
    if (parts.length === 0) return "self";
    parts[parts.length - 1] = "self";
    return parts.join(".");
};

export type DenyReason =
    | "unresolved_role" /* the caller's role could not be worked out at all */
    | "no_tree" /* a role, but no permission tree anywhere for it */
    | "refused" /* the tree holds the key and it is false */
    | "missing"; /* the tree does not hold the key */

export type AllowReason = "owner" | "granted" | "self" | "self_key";

export type PermissionDecision =
    | { ok: true; reason: AllowReason }
    | { ok: false; reason: DenyReason; message: string };

export const DENY_MESSAGES: Record<DenyReason, string> = {
    unresolved_role: "Your role could not be determined, so this was not allowed. Ask an administrator to check your account.",
    no_tree: "Your role has no permissions set up, so this was not allowed. Ask an administrator to check the role.",
    refused: "Your role does not allow this.",
    missing: "Your role does not allow this.",
};

export interface EvaluateInput {
    /** The caller's resolved system role; null when it could not be resolved. */
    systemRole: SystemRoleKeyLike;
    /** The tree chosen for the caller (already unwrapped), or null. */
    tree: PermissionTree | null;
    /** The dotted key the route needs, e.g. account_setting.access.USER.action.delete */
    key: string;
    /** True when the route is acting on the caller's own record. */
    isSelf?: boolean;
    /** The key that governs "on myself"; defaults to the sibling `self` key. */
    selfKey?: string;
}

/**
 * The one decision. In order:
 *   1. ADMIN passes everything.
 *   2. No role and no tree: refused (unresolved).
 *   3. Acting on yourself: an explicit self key in the tree decides, else allowed.
 *   4. No tree: refused.
 *   5. The key must be present and true.
 */
export function evaluatePermission(input: EvaluateInput): PermissionDecision {
    const { systemRole, tree, key, isSelf = false } = input;
    const selfKey = input.selfKey ?? selfKeyFor(key);

    if (systemRole === "ADMIN") return { ok: true, reason: "owner" };

    if (!systemRole && !isNonEmptyTree(tree)) {
        return { ok: false, reason: "unresolved_role", message: DENY_MESSAGES.unresolved_role };
    }

    if (isSelf) {
        const own = readPermission(tree, selfKey);
        if (own === undefined) return { ok: true, reason: "self" };
        return own
            ? { ok: true, reason: "self_key" }
            : { ok: false, reason: "refused", message: DENY_MESSAGES.refused };
    }

    if (!isNonEmptyTree(tree)) {
        return { ok: false, reason: "no_tree", message: DENY_MESSAGES.no_tree };
    }

    const value = readPermission(tree, key);
    if (value === true) return { ok: true, reason: "granted" };
    if (value === false) return { ok: false, reason: "refused", message: DENY_MESSAGES.refused };
    return { ok: false, reason: "missing", message: DENY_MESSAGES.missing };
}

export type PermissionMode = "report" | "enforce";

/** PERMISSION_ENFORCE: "enforce" refuses; anything else (or unset) reports. */
export function permissionMode(raw: unknown): PermissionMode {
    return String(raw ?? "").trim().toLowerCase() === "enforce" ? "enforce" : "report";
}

export type ModeOutcome =
    | { pass: true; log: false }
    | { pass: true; log: true } /* report mode: let it through, write the line */
    | { pass: false; status: 403; body: { success: false; message: string; permission: string } };

/** What the middleware does with a decision under a mode. */
export function applyMode(decision: PermissionDecision, mode: PermissionMode, key: string): ModeOutcome {
    if (decision.ok) return { pass: true, log: false };
    if (mode === "enforce") {
        return { pass: false, status: 403, body: { success: false, message: decision.message, permission: key } };
    }
    return { pass: true, log: true };
}
