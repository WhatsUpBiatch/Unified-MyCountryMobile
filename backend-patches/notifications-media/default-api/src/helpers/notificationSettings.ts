/* A person's notification choices: one column, one shape.
 *
 * THE COLUMN
 *
 * `users.notification_settings` (main database, JSON) is the only place a person's
 * choices live. Its shape is FLAT: one key per event, each holding the channels the
 * person wants for that event.
 *
 *   {
 *     voicemail:       { email: true,  socket: true,  sms: false, push: true, phone: "" },
 *     missed:          { email: false, socket: true,  sms: false, push: false, phone: "" },
 *     sms:             { email: false, socket: true,  sms: false, push: true, phone: "" },
 *     forgot_password: { email: true,  socket: false, sms: true,  push: false }
 *   }
 *
 * That is exactly the object notification-api's `notification/send` reads: it takes
 * `notification_settings[type]` and looks at `.email`, `.socket`, `.sms`, `.push`
 * (NotificationController.notificationSend). The website's Notifications page and the
 * older `PUT /api/user/update-settings` writer both produce this per-event shape.
 *
 * WHY THIS FILE EXISTS
 *
 * Until 3 Sep 2026 the website posted the object wrapped one level deeper -
 * `{ notification_settings: { voicemail: ... } }` - and `updateUserSetting` stored
 * that wrapper as-is. Readers then disagreed about where the choices were: one read
 * `column.notification_settings.voicemail`, one read `settings.notification_settings`,
 * one sent the column straight to notification-api, which answered 400 "Notification
 * settings not found for type: voicemail" because `column.voicemail` did not exist.
 * Voicemail emails stopped.
 *
 * Every reader and the one writer now go through here. `flattenNotificationSettings`
 * accepts every shape that is in the data or that an older web build still posts and
 * returns the flat one; `notificationSettingsForSend` builds the object notification-api
 * wants for one event, filling an event the person never chose with the rule the
 * platform already used elsewhere (SmsController.sendNotification): every channel the
 * payload carries. Nothing here touches a database or the network.
 *
 * IDENTICAL COPIES
 *
 * The same file is kept in tenant-api and default-api (both under src/helpers/). It has
 * no imports on purpose so it can be copied byte for byte; a test checks the copies match.
 */

/* The events a person can be told about. `forgot_password` is written by the website
   on every save (always email+sms) and never shown; it is kept so nothing else has to
   special-case it. */
export const NOTIFICATION_EVENTS: readonly string[] = ["voicemail", "missed", "sms", "forgot_password"];

/* The ways a notification can arrive. `socket` is the in-browser alert ("Web Alert"
   on the page), `push` the mobile app. */
export const NOTIFICATION_CHANNELS: readonly string[] = ["email", "socket", "sms", "push"];

/* The key the old nested shape wrapped everything in. */
const WRAPPER_KEY = "notification_settings";

/* How many wrappers to peel. Real data has at most one; a hand edit or a double save
   could have two. Anything deeper is not a settings object. */
const MAX_WRAPPER_DEPTH = 4;

export interface ChannelChoice {
    email: boolean;
    socket: boolean;
    sms: boolean;
    push: boolean;
    /* The number text alerts go to for this event; the page keeps one per event. */
    phone?: string;
}

export type NotificationSettings = { [event: string]: ChannelChoice };

const isPlainObject = (value: any): boolean =>
    !!value && typeof value === "object" && !Array.isArray(value);

/* true / "true" / "YES" / "Y" / "1" / 1 mean on; everything else is off. */
export const asChannelFlag = (value: any): boolean => {
    if (value === true) return true;
    if (typeof value === "number") return value !== 0;
    if (typeof value !== "string") return false;
    const word = value.trim().toUpperCase();
    return word === "TRUE" || word === "YES" || word === "Y" || word === "1";
};

/* A JSON column read through a driver that did not parse it, or a body posted as a
   string, both arrive as text. Anything that is not valid JSON is returned untouched. */
export const parseJsonIfString = (raw: any): any => {
    if (typeof raw !== "string") return raw;
    const text = raw.trim();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (error) {
        return raw;
    }
};

/* An entry is a choice when it is an object that says something about at least one
   channel (or carries a phone number). A stray key holding something else - a general
   settings object passed in by mistake, a label - is not a choice and is dropped. */
const isChannelChoice = (value: any): boolean =>
    isPlainObject(value) &&
    (NOTIFICATION_CHANNELS.some((channel) => value[channel] !== undefined) || value.phone !== undefined);

/* One event's choice, every channel coerced to a boolean, the phone kept as text. */
export const normaliseChannelChoice = (value: any): ChannelChoice => {
    const source = isPlainObject(value) ? value : {};
    const choice: ChannelChoice = {
        email: asChannelFlag(source.email),
        socket: asChannelFlag(source.socket),
        sms: asChannelFlag(source.sms),
        push: asChannelFlag(source.push),
    };
    if (source.phone !== undefined && source.phone !== null) {
        choice.phone = String(source.phone).trim();
    }
    return choice;
};

/* Peel the old wrapper(s). `{ notification_settings: X }` where X is an object means
   X; a wrapper holding nothing usable means nothing. Stops as soon as the object
   carries an event key, so a person who (oddly) has an event called
   "notification_settings" is not unwrapped into it. */
const unwrap = (raw: any): any => {
    let node = raw;
    for (let depth = 0; depth < MAX_WRAPPER_DEPTH; depth += 1) {
        if (!isPlainObject(node)) return node;
        const hasEvent = NOTIFICATION_EVENTS.some((event) => isChannelChoice(node[event]));
        if (hasEvent) return node;
        const inner = node[WRAPPER_KEY];
        if (inner === undefined) return node;
        node = parseJsonIfString(inner);
    }
    return node;
};

/**
 * The flat shape, from whatever is stored or posted.
 *
 * Accepts: the flat object; the old `{ notification_settings: {...} }` wrapper (any
 * depth up to MAX_WRAPPER_DEPTH); either of those as a JSON string. Keeps every key
 * whose value looks like a channel choice - the four known events and any other the
 * caller stores (notification-api reads by type name, so an extra event such as
 * `security_alert` must survive). Returns null when there is nothing usable at all:
 * null, undefined, "", a non-object, or an object with no choice in it.
 */
export const flattenNotificationSettings = (raw: any): NotificationSettings | null => {
    const node = unwrap(parseJsonIfString(raw));
    if (!isPlainObject(node)) return null;

    const flat: NotificationSettings = {};
    Object.keys(node).forEach((key) => {
        if (key === WRAPPER_KEY) return;
        const value = parseJsonIfString(node[key]);
        if (!isChannelChoice(value)) return;
        flat[key] = normaliseChannelChoice(value);
    });

    return Object.keys(flat).length ? flat : null;
};

/* True when the value is (or parses to) the old wrapped shape. For logs and tests. */
export const isLegacyNestedShape = (raw: any): boolean => {
    const node = parseJsonIfString(raw);
    if (!isPlainObject(node)) return false;
    if (NOTIFICATION_EVENTS.some((event) => isChannelChoice(node[event]))) return false;
    return isPlainObject(parseJsonIfString(node[WRAPPER_KEY]));
};

/* Which channels a `notification/send` payload actually carries. A channel the
   payload has no content for cannot be sent whatever the person chose. */
export const channelsCarriedByPayload = (payload: any): ChannelChoice => ({
    email: !!payload?.email_notification,
    socket: !!payload?.socket_notification,
    sms: !!payload?.sms_notification,
    push: !!(payload?.device_notification || payload?.push_notification),
});

/**
 * The `notification_settings` object to send to notification-api for one event.
 *
 * The person's flat choices, with the entry for `type` guaranteed present: their own
 * choice when they made one, otherwise every channel the payload carries. That
 * fallback is the rule default-api's SmsController has always applied to an event a
 * person never set; it is what "no preference" has meant on this platform, so a
 * person who never opened the Notifications page keeps getting voicemail emails.
 *
 * Pass `fallback` to use a different rule for the unset case (for example, nothing
 * at all: `{ email: false, socket: false, sms: false, push: false }`).
 */
export const notificationSettingsForSend = (
    raw: any,
    type: string,
    payload?: any,
    fallback?: ChannelChoice,
): NotificationSettings => {
    const flat = flattenNotificationSettings(raw) || {};
    const chosen = flat[type];
    return {
        ...flat,
        [type]: chosen ? chosen : fallback ? normaliseChannelChoice(fallback) : channelsCarriedByPayload(payload),
    };
};

/* The number a text alert for `type` should go to: the one the person typed for that
   event on the page, else the account phone the caller passes in, else nothing. */
export const smsRecipientFor = (raw: any, type: string, accountPhone?: string | null): string => {
    const flat = flattenNotificationSettings(raw);
    const chosen = flat?.[type]?.phone;
    if (chosen && chosen.trim()) return chosen.trim();
    return accountPhone ? String(accountPhone).trim() : "";
};
