/* A person's seat in a queue when they are suspended, restored, or gone.
 *
 * Pure functions over the records campaign-api owns. A queue record carries
 * `members` (the roster the website edits); each save also rebuilds one
 * `agents` row per member (what the switch's agent service rings) and one
 * `tiers` row (their ring round). Suspending a person must stop the agent
 * service offering them without losing their seat, so:
 *
 *   suspend  the member entry stays and gains `suspended_member`
 *            { at, reason }; the agent row is set "Logged Out" (which the
 *            agent service never rings) and carries the same marker; the
 *            tier row carries the marker.
 *   restore  the marker comes off all three. The agent row stays "Logged
 *            Out": they are not signed in yet, and signing in sets it the
 *            way it always has.
 *   remove   the member entry, the agent row and the tier row are deleted.
 *            Used by the 72-hour purge, when a restore is no longer possible.
 *
 * A marker already present is left as it is (the first reason and time are
 * the true ones), so calling suspend twice, or suspend then remove-and-mark,
 * changes nothing the second time.
 */

export type MembershipAction = "suspend" | "restore" | "remove";

export const MEMBERSHIP_ACTIONS: ReadonlyArray<MembershipAction> = ["suspend", "restore", "remove"];

export interface SuspendedMarker {
    at: string;
    reason: string;
}

export const MARKER_FIELD = "suspended_member";

/** The member entry that is this person. Entries are objects with `user_uuid` (older saves used `value`). */
export function memberMatches(member: any, user_uuid: string): boolean {
    if (!member || typeof member !== "object") return false;
    const target = String(user_uuid ?? "").trim();
    if (!target) return false;
    return String(member.user_uuid ?? "").trim() === target || String(member.value ?? "").trim() === target;
}

export function marker(now: Date, reason: string): SuspendedMarker {
    return { at: now.toISOString(), reason: String(reason || "suspended") };
}

export interface MembersResult {
    members: any[];
    /** Entries that are this person. */
    matched: any[];
    /** How many entries actually changed. */
    changed: number;
}

/** The roster after the action. Never mutates the input. */
export function applyToMembers(members: any, user_uuid: string, action: MembershipAction, now: Date, reason = ""): MembersResult {
    const list: any[] = Array.isArray(members) ? members : [];
    const out: any[] = [];
    const matched: any[] = [];
    let changed = 0;
    for (const entry of list) {
        if (!memberMatches(entry, user_uuid)) {
            out.push(entry);
            continue;
        }
        matched.push(entry);
        if (action === "remove") {
            changed++;
            continue;
        }
        if (action === "suspend") {
            if (entry[MARKER_FIELD]) {
                out.push(entry);
            } else {
                out.push({ ...entry, [MARKER_FIELD]: marker(now, reason) });
                changed++;
            }
            continue;
        }
        /* restore */
        if (entry[MARKER_FIELD]) {
            const { [MARKER_FIELD]: _gone, ...rest } = entry;
            out.push(rest);
            changed++;
        } else {
            out.push(entry);
        }
    }
    return { members: out, matched, changed };
}

/** The Mongo update for this person's `agents` row(s) in one queue; null means delete them. */
export function agentUpdateFor(action: MembershipAction, now: Date, reason = ""): Record<string, any> | null {
    if (action === "remove") return null;
    if (action === "suspend") {
        return {
            $set: {
                status: "Logged Out",
                state: "Logged Out",
                last_status_change: Math.floor(now.getTime() / 1000),
                [MARKER_FIELD]: marker(now, reason),
            },
        };
    }
    return { $unset: { [MARKER_FIELD]: "" } };
}

/** The Mongo update for this person's `tiers` row(s) in one queue; null means delete them. */
export function tierUpdateFor(action: MembershipAction, now: Date, reason = ""): Record<string, any> | null {
    if (action === "remove") return null;
    if (action === "suspend") return { $set: { [MARKER_FIELD]: marker(now, reason) } };
    return { $unset: { [MARKER_FIELD]: "" } };
}

/**
 * On a queue save the website sends the roster back without knowing about
 * markers. Carry each existing marker onto the incoming entry for the same
 * person, so re-saving a queue never quietly un-suspends somebody.
 */
export function carryMarkers(existing: any, incoming: any): any[] {
    const list: any[] = Array.isArray(incoming) ? incoming : [];
    const had: any[] = Array.isArray(existing) ? existing : [];
    const markers = new Map<string, SuspendedMarker>();
    for (const entry of had) {
        if (entry && typeof entry === "object" && entry[MARKER_FIELD]) {
            const key = String(entry.user_uuid ?? entry.value ?? "").trim();
            if (key) markers.set(key, entry[MARKER_FIELD]);
        }
    }
    if (!markers.size) return list;
    return list.map((entry) => {
        if (!entry || typeof entry !== "object" || entry[MARKER_FIELD]) return entry;
        const key = String(entry.user_uuid ?? entry.value ?? "").trim();
        const found = key ? markers.get(key) : undefined;
        return found ? { ...entry, [MARKER_FIELD]: found } : entry;
    });
}

/** The status a rebuilt agent row starts in: a suspended member is never offered. */
export function agentStatusForMember(member: any): { status: string; state: string } {
    if (member && typeof member === "object" && member[MARKER_FIELD]) return { status: "Logged Out", state: "Logged Out" };
    return { status: "On Break", state: "Idle" };
}

/** `1000@1757576519531.mycountrymobile.com` - the agent name the tier row keys on. */
export function agentName(extension: unknown, domain: unknown): string {
    return `${String(extension ?? "").trim()}@${String(domain ?? "").trim()}`;
}
