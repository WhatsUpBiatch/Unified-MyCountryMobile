/* The pure part of "trusted devices": no database, no Express, no imports.
 *
 * What a trusted device IS on this platform
 * -----------------------------------------
 * `/send-otp` (AuthController.sendOtp) skips the emailed code when the `otp`
 * table holds a row for this email + this device_id with verified = 1 and a
 * created_at inside the last TRUSTED_DEVICE_DAYS (default 30) - and the
 * person ticked "remember this device". `/login` reads the same kind of row to
 * decide whether it may hand out a token straight away. So trust lives in
 * `otp`, keyed by device_id, and it is per email address.
 *
 * Sessions live somewhere else: `devices_securities` holds one row per signed-in
 * device (also keyed by device_id, plus the session's own uuid). A device can
 * be signed in without being trusted (it passed a code more than 30 days ago,
 * or never ticked the box) and can be trusted without being signed in (the
 * person signed out, but the verified row is still inside the window).
 *
 * The screen wants one list. `mergeDevices` folds both sources by device_id,
 * and everything here is testable without a server (see
 * backend-patches/trusted-devices-profile/tests).
 */

export interface SessionRow {
    uuid: string;
    device_id: string | null;
    device_type?: string | null;
    ip_address?: string | null;
    user_agent?: string | null;
    version?: string | null;
    created_at?: Date | string | null;
    updated_at?: Date | string | null;
}

export interface TrustRow {
    device_id: string;
    /* The newest verified row's created_at for that device. */
    verified_at: Date | string;
}

export interface TrustedDeviceEntry {
    /* What the revoke endpoint takes. The device_id where there is one, else
       "session:<uuid>" for an old row that never recorded a device id. */
    id: string;
    device_id: string | null;
    session_uuid: string | null;
    label: string;
    device_type: string | null;
    ip_address: string | null;
    user_agent: string | null;
    app_version: string | null;
    first_seen: string | null;
    last_seen: string | null;
    signed_in: boolean;
    trusted: boolean;
    trusted_since: string | null;
    trusted_until: string | null;
    is_current: boolean;
}

export const SESSION_ID_PREFIX = "session:";

const toIso = (value: Date | string | null | undefined): string | null => {
    if (value === null || value === undefined || value === "") return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const earliest = (a: string | null, b: string | null): string | null => {
    if (!a) return b;
    if (!b) return a;
    return a < b ? a : b;
};

const latest = (a: string | null, b: string | null): string | null => {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
};

export const addDays = (iso: string, days: number): string =>
    new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

/* A short human label from a browser user-agent string. Deliberately small:
   the five browsers and five platforms people actually sign in from. Anything
   else falls back to the device type, never to an empty string, so the row
   always has a name. */
export const describeUserAgent = (ua: string | null | undefined, deviceType?: string | null): string => {
    const s = String(ua || "");
    let browser = "";
    if (/Edg\//.test(s)) browser = "Edge";
    else if (/OPR\/|Opera/.test(s)) browser = "Opera";
    else if (/Firefox\//.test(s)) browser = "Firefox";
    else if (/Chrome\//.test(s) && !/Chromium/.test(s)) browser = "Chrome";
    else if (/Safari\//.test(s) && /Version\//.test(s)) browser = "Safari";

    let platform = "";
    if (/Windows/.test(s)) platform = "Windows";
    else if (/iPhone|iPad|iPod/.test(s)) platform = "iPhone or iPad";
    else if (/Mac OS X|Macintosh/.test(s)) platform = "Mac";
    else if (/Android/.test(s)) platform = "Android";
    else if (/Linux/.test(s)) platform = "Linux";

    if (browser && platform) return `${browser} on ${platform}`;
    if (browser) return browser;
    if (platform) return platform;

    switch (String(deviceType || "").toUpperCase()) {
        case "A":
            return "Android app";
        case "I":
            return "iPhone app";
        case "D":
            return "Desktop app";
        case "W":
            return "Web browser";
        default:
            return s.trim() ? s.trim().slice(0, 40) : "Unknown device";
    }
};

export interface MergeOptions {
    trustDays: number;
    /* devices_securities.uuid of the session making the request. */
    currentSessionUuid?: string | null;
    /* `now` is a parameter so the tests are not clock-dependent. */
    now?: Date;
}

/* One entry per device_id (plus one per id-less session), newest activity
   first, the current device always at the top. */
export const mergeDevices = (
    sessions: SessionRow[],
    trust: TrustRow[],
    { trustDays, currentSessionUuid, now = new Date() }: MergeOptions,
): TrustedDeviceEntry[] => {
    const byId = new Map<string, TrustedDeviceEntry>();
    const nowIso = now.toISOString();

    for (const s of sessions) {
        const deviceId = s.device_id ? String(s.device_id).trim() : "";
        const key = deviceId || `${SESSION_ID_PREFIX}${s.uuid}`;
        const created = toIso(s.created_at);
        const updated = toIso(s.updated_at);
        const isCurrent = !!currentSessionUuid && s.uuid === currentSessionUuid;

        const existing = byId.get(key);
        if (existing) {
            /* Two sessions for one device id (saveDeviceSession keeps just one,
               but old rows exist). Keep the newer session as the face of the
               row and widen the seen window. */
            existing.first_seen = earliest(existing.first_seen, created);
            existing.last_seen = latest(existing.last_seen, updated || created);
            existing.is_current = existing.is_current || isCurrent;
            if (isCurrent || (updated || created || "") > (existing.last_seen || "")) {
                existing.session_uuid = s.uuid;
                existing.ip_address = s.ip_address ?? existing.ip_address;
                existing.user_agent = s.user_agent ?? existing.user_agent;
                existing.app_version = s.version ?? existing.app_version;
            }
            continue;
        }

        byId.set(key, {
            id: key,
            device_id: deviceId || null,
            session_uuid: s.uuid,
            label: describeUserAgent(s.user_agent, s.device_type),
            device_type: s.device_type ?? null,
            ip_address: s.ip_address ?? null,
            user_agent: s.user_agent ?? null,
            app_version: s.version ?? null,
            first_seen: created,
            last_seen: updated || created,
            signed_in: true,
            trusted: false,
            trusted_since: null,
            trusted_until: null,
            is_current: isCurrent,
        });
    }

    for (const t of trust) {
        const deviceId = String(t.device_id || "").trim();
        if (!deviceId) continue;
        const since = toIso(t.verified_at);
        if (!since) continue;
        const until = addDays(since, trustDays);
        /* The SQL already limits to the window, but the boundary is re-checked
           here so a row that slipped through (clock skew, a wider query) is
           never shown as trusted when the login path would not honour it. */
        if (until <= nowIso) continue;

        const existing = byId.get(deviceId);
        if (existing) {
            existing.trusted = true;
            existing.trusted_since = since;
            existing.trusted_until = until;
            existing.first_seen = earliest(existing.first_seen, since);
            continue;
        }
        byId.set(deviceId, {
            id: deviceId,
            device_id: deviceId,
            session_uuid: null,
            label: "Device that passed a code",
            device_type: null,
            ip_address: null,
            user_agent: null,
            app_version: null,
            first_seen: since,
            last_seen: since,
            signed_in: false,
            trusted: true,
            trusted_since: since,
            trusted_until: until,
            is_current: false,
        });
    }

    return Array.from(byId.values()).sort((a, b) => {
        if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
        return (b.last_seen || "").localeCompare(a.last_seen || "");
    });
};

/* Which rows a revoke id points at. Pure, so the controller's branching is
   tested rather than trusted. */
export type RevokeTarget =
    | { kind: "device"; deviceId: string }
    | { kind: "session"; sessionUuid: string }
    | { kind: "invalid"; reason: string };

export const parseRevokeId = (raw: unknown): RevokeTarget => {
    const id = String(raw ?? "").trim();
    if (!id) return { kind: "invalid", reason: "Say which device to revoke." };
    if (id.length > 200) return { kind: "invalid", reason: "That device id is too long." };
    if (id.startsWith(SESSION_ID_PREFIX)) {
        const uuid = id.slice(SESSION_ID_PREFIX.length).trim();
        if (!/^[0-9a-f-]{36}$/i.test(uuid)) return { kind: "invalid", reason: "That session id is not valid." };
        return { kind: "session", sessionUuid: uuid };
    }
    return { kind: "device", deviceId: id };
};

/* The rule the login path applies today, in one sentence, with the number it
   uses. There is no per-company or per-person switch for the second factor
   anywhere in AuthController: a code is always required unless the device is
   trusted. If that ever changes, this is the one place the screen's wording
   comes from. */
export interface TwoStepStatus {
    enforced: boolean;
    method: "email_code";
    trust_days: number;
    reason: string;
}

export const describeTwoStep = (trustDays: number, email?: string | null): TwoStepStatus => {
    const where = email ? ` to ${email}` : "";
    return {
        enforced: true,
        method: "email_code",
        trust_days: trustDays,
        reason: `Every sign-in needs your password and a code emailed${where}, unless the device is trusted. Trust lasts ${trustDays} days.`,
    };
};

export const readTrustDays = (raw: string | undefined, fallback = 30): number => {
    const n = parseInt(String(raw ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

/* The address forms the otp rows may have been written under. sendOtp lower-
   cases and trims; the older login path used the address as typed. Both are
   deleted so a row written either way cannot survive a revoke. */
export const emailVariants = (email: string | null | undefined): string[] => {
    const raw = String(email ?? "").trim();
    if (!raw) return [];
    const lower = raw.toLowerCase();
    return lower === raw ? [raw] : [raw, lower];
};
