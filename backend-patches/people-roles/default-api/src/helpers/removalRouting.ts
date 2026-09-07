/* What happens to call routing when a person is removed.
 *
 * Before: any number that forwarded to the person had its WHOLE
 * `forward_call_actions` and `settings` set to null (hours, recording, media,
 * caller-id display - everything), and every colleague whose personal
 * forwarding pointed at the person was silently repointed at whoever clicked
 * delete. Both are wrong. This file removes only the one target - the removed
 * person - and leaves everything else in the record as it was.
 *
 * Pure functions over the stored JSON shapes, so they can be unit tested
 * without a database. The controller reads, calls these, and writes back only
 * when `changed` is true.
 *
 * What "remove the one target" means per slot:
 *
 *   Number (did_numbers.forward_call_actions)
 *     call_handling.business_hours                 -> slot emptied (type/value/label "")
 *     call_handling.business_hours.missed_call_action -> removed
 *     call_handling.closed_hours                   -> removed
 *     condition.operational_hours.closed_hour_action -> slot emptied
 *     condition.operational_hours.holidays[n]      -> that holiday's target emptied
 *     (the same slots under a top-level operational_hours, the group shape)
 *   An empty slot is what a freshly bought number has: "no destination set".
 *   It is NOT replaced with voicemail, because a number has no mailbox of its
 *   own on this switch - VOICEMAIL always needs a person's extension
 *   (dialplan: vm_target_extension). Pointing it at somebody else's mailbox
 *   would be inventing a destination the owner never chose.
 *
 *   Colleague (users.call_forwarding)
 *     forward_calls (forward all my calls to X)    -> switched off, target emptied
 *     incoming_calls.device_options[]              -> the entry for X removed
 *     incoming_calls.failure_action (no answer)    -> back to the colleague's OWN voicemail
 *     incoming_calls.closed_hour_action            -> back to the colleague's OWN voicemail
 *   The colleague's own mailbox is the one fallback the data shape supports
 *   honestly: it is exactly what generateCallForwarding gives a new person.
 */

export interface StripResult<T> {
    value: T;
    changed: boolean;
    /** Dotted paths of the slots that were touched, for the log and the reply. */
    cleared: string[];
}

const matches = (slotValue: unknown, extension: string): boolean =>
    String(slotValue ?? "").trim() !== "" && String(slotValue ?? "").trim() === extension;

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseJsonObject(raw: unknown): Record<string, any> | null {
    if (isObject(raw)) return raw;
    if (typeof raw !== "string" || !raw.trim()) return null;
    try {
        const parsed = JSON.parse(raw);
        return isObject(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/** Empty a destination slot in place, keeping keys the screens expect. */
function emptySlot(slot: Record<string, any>): void {
    slot.type = "";
    slot.value = "";
    if ("label" in slot) slot.label = "";
    if ("name" in slot) slot.name = "";
    if ("extension" in slot) delete slot.extension;
    if ("value_label" in slot) slot.value_label = "";
    if ("type_label" in slot) slot.type_label = "";
    if ("personal" in slot) slot.personal = false;
}

/**
 * Remove one extension from a number's routing. Works on a parsed object or the
 * stored JSON string; returns the object either way (the caller stringifies).
 */
export function stripExtensionFromNumberRouting(
    raw: unknown,
    extension: string | number,
): StripResult<Record<string, any> | null> {
    const ext = String(extension ?? "").trim();
    const actions = parseJsonObject(raw);
    const cleared: string[] = [];
    if (!actions || !ext) return { value: actions, changed: false, cleared };

    const bh = actions?.call_handling?.business_hours;
    if (isObject(bh)) {
        if (matches(bh.value, ext)) {
            emptySlot(bh);
            cleared.push("call_handling.business_hours");
        }
        if (isObject(bh.missed_call_action) && matches(bh.missed_call_action.value, ext)) {
            delete bh.missed_call_action;
            cleared.push("call_handling.business_hours.missed_call_action");
        }
    }

    const closedHours = actions?.call_handling?.closed_hours;
    if (isObject(closedHours) && matches(closedHours.value, ext)) {
        delete actions.call_handling.closed_hours;
        cleared.push("call_handling.closed_hours");
    }

    const hoursBlocks: Array<[string, any]> = [
        ["condition.operational_hours", actions?.condition?.operational_hours],
        ["operational_hours", actions?.operational_hours],
    ];
    for (const [path, hours] of hoursBlocks) {
        if (!isObject(hours)) continue;
        if (isObject(hours.closed_hour_action) && matches(hours.closed_hour_action.value, ext)) {
            emptySlot(hours.closed_hour_action);
            cleared.push(`${path}.closed_hour_action`);
        }
        if (Array.isArray(hours.holidays)) {
            hours.holidays.forEach((holiday: any, index: number) => {
                if (isObject(holiday) && matches(holiday.value, ext)) {
                    holiday.value = "";
                    if ("name" in holiday) holiday.name = "";
                    if ("value_label" in holiday) holiday.value_label = "";
                    cleared.push(`${path}.holidays[${index}]`);
                }
            });
        }
    }

    return { value: actions, changed: cleared.length > 0, cleared };
}

export interface ForwardingOwner {
    extension: string | number;
    first_name?: string | null;
    last_name?: string | null;
}

function ownVoicemail(owner: ForwardingOwner): Record<string, any> {
    const fullName = `${owner.first_name ?? ""} ${owner.last_name ?? ""}`.trim();
    return {
        type: "VOICEMAIL",
        label: fullName,
        value: String(owner.extension),
        name: fullName,
        enabled: true,
        personal: true,
        type_label: "Send to Voicemail",
        value_label: "Select",
    };
}

/**
 * Remove one extension from a colleague's personal call forwarding. `owner` is
 * the colleague whose record this is - the fallback for "no answer" and
 * "closed hours" is their own mailbox, never the caller's.
 */
export function stripExtensionFromPersonForwarding(
    raw: unknown,
    extension: string | number,
    owner: ForwardingOwner,
): StripResult<Record<string, any> | null> {
    const ext = String(extension ?? "").trim();
    const cf = parseJsonObject(raw);
    const cleared: string[] = [];
    if (!cf || !ext) return { value: cf, changed: false, cleared };

    /* Never treat the owner's own extension as the removed one: a person's
       record points at itself in several places by design. */
    if (String(owner.extension ?? "").trim() === ext) return { value: cf, changed: false, cleared };

    if (isObject(cf.forward_calls) && matches(cf.forward_calls.value, ext)) {
        cf.forward_calls.enabled = false;
        cf.forward_calls.value = "";
        if ("name" in cf.forward_calls) cf.forward_calls.name = "";
        if ("value_label" in cf.forward_calls) cf.forward_calls.value_label = "Select";
        cleared.push("forward_calls");
    }

    const incoming = cf.incoming_calls;
    if (isObject(incoming)) {
        if (Array.isArray(incoming.device_options)) {
            const before = incoming.device_options.length;
            incoming.device_options = incoming.device_options.filter(
                (device: any) => !(isObject(device) && matches(device.value, ext)),
            );
            if (incoming.device_options.length !== before) cleared.push("incoming_calls.device_options");
        }
        if (isObject(incoming.failure_action) && matches(incoming.failure_action.value, ext)) {
            incoming.failure_action = ownVoicemail(owner);
            cleared.push("incoming_calls.failure_action");
        }
        if (isObject(incoming.closed_hour_action) && matches(incoming.closed_hour_action.value, ext)) {
            incoming.closed_hour_action = ownVoicemail(owner);
            cleared.push("incoming_calls.closed_hour_action");
        }
    }

    return { value: cf, changed: cleared.length > 0, cleared };
}

/* ---------- soft-delete window and purge ---------- */

/** How long a removed person can be brought back. After this the row is purged
    (its email and phone are freed) and it no longer appears in list-deleted. */
export const RESTORE_WINDOW_HOURS = 72;

export const TOMBSTONE_PREFIX = "deleted+";

/** users.email is STRING(60) and UNIQUE, and the soft-deleted row keeps it, so
    the address could never be used again. The purge rewrites it to something
    that cannot collide and cannot be logged in with. Truncated to the column,
    with the uuid fragment kept so two purged rows never share a tombstone. */
export function tombstoneEmail(email: string, uuid: string, maxLength = 60): string {
    const fragment = String(uuid ?? "").replace(/-/g, "").slice(0, 12) || "unknown";
    const head = `${TOMBSTONE_PREFIX}${fragment}+`;
    const room = Math.max(0, maxLength - head.length);
    return head + String(email ?? "").slice(0, room);
}

export function isTombstonedEmail(email: unknown): boolean {
    return String(email ?? "").startsWith(TOMBSTONE_PREFIX);
}

export function restoreDeadline(deletedAt: Date | string, hours = RESTORE_WINDOW_HOURS): Date {
    const base = new Date(deletedAt);
    return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

export function isWithinRestoreWindow(deletedAt: Date | string | null | undefined, now = new Date(), hours = RESTORE_WINDOW_HOURS): boolean {
    if (!deletedAt) return false;
    const base = new Date(deletedAt);
    if (Number.isNaN(base.getTime())) return false;
    return restoreDeadline(base, hours).getTime() > now.getTime();
}
