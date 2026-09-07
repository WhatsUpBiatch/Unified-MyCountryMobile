/* Flushing a phone's registration off the switch. Pure: no ESL, no network.
 *
 * WHY. The directory service refuses a REGISTER from anyone who is not ACTIVE,
 * but a registration that already exists lasts until the phone's next REGISTER
 * (up to an hour). A suspended or removed person's phone therefore keeps
 * ringing, and keeps placing calls, for that long. FreeSWITCH can drop a
 * registration on demand:
 *
 *     sofia profile <profile> flush_inbound_reg <user>@<domain>
 *
 * which removes every registration for that user at that domain (mod_sofia
 * matches on sip_user + sip_host when the argument carries an '@'). It is not
 * a "reboot": the phone is not told anything, its next REGISTER is simply
 * refused by the directory as it would be anyway.
 *
 * One extension registers under more than one SIP user on this platform. The
 * dialplan bridges `user/<ext>_web@<domain>,user/<ext>@<domain>` (the browser
 * phone is `<ext>_web`), so both names are flushed, plus any other
 * `<ext>_<suffix>` user the listing reports.
 */

export interface Registration {
    callId: string;
    user: string;
    contact: string;
    agent: string;
    status: string;
}

export interface FlushPlan {
    profile: string;
    domain: string;
    /** SIP user names to flush: the extension, the browser variant, any listed variant. */
    users: string[];
    /** One `sofia profile ... flush_inbound_reg ...` argument per user, in order. */
    commands: Array<{ command: "sofia"; arg: string }>;
}

/** `1000` -> `1000`, `1000_web`; case and spaces tidied, anything else refused. */
export function candidateUsers(extension: string | number): string[] {
    const ext = String(extension ?? "").trim();
    if (!/^[A-Za-z0-9._+-]+$/.test(ext)) return [];
    return [ext, `${ext}_web`];
}

/** A registered SIP user that belongs to this extension: `1000`, `1000_web`, `1000_anything`. */
export function belongsToExtension(user: string, extension: string): boolean {
    const u = String(user ?? "").trim();
    const ext = String(extension ?? "").trim();
    if (!u || !ext) return false;
    return u === ext || u.startsWith(`${ext}_`);
}

/**
 * Parse `sofia status profile <p> reg [<user>@<domain>]` output. Each
 * registration is a block of `Key:   value` lines; the first key is Call-ID.
 * Unknown keys are ignored, a malformed block is skipped, an empty or `-ERR`
 * answer gives an empty list.
 */
export function parseRegistrations(text: string): Registration[] {
    const out: Registration[] = [];
    if (!text || /^-ERR/i.test(text.trim())) return out;
    let current: Partial<Registration> | null = null;
    const flush = () => {
        if (current && current.callId && current.user) {
            out.push({
                callId: current.callId,
                user: current.user,
                contact: current.contact ?? "",
                agent: current.agent ?? "",
                status: current.status ?? "",
            });
        }
        current = null;
    };
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) {
            flush();
            continue;
        }
        const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const value = m[2].trim();
        if (key === "call-id") {
            flush();
            current = { callId: value };
            continue;
        }
        if (!current) continue;
        if (key === "user") current.user = value;
        else if (key === "contact") current.contact = value;
        else if (key === "agent") current.agent = value;
        else if (key === "status") current.status = value;
    }
    flush();
    return out;
}

/** `1000@1757576519531.mycountrymobile.com` -> `1000`. */
export function userPart(aor: string): string {
    const s = String(aor ?? "").trim();
    const at = s.indexOf("@");
    return at >= 0 ? s.slice(0, at) : s;
}

/** Only characters that are safe inside an ESL argument. */
export function safeToken(value: string): boolean {
    return /^[A-Za-z0-9._+-]+$/.test(String(value ?? ""));
}

/**
 * Everything to send, given what the listing reported. The two standard
 * names are always flushed (a listing can fail, and flushing a user with no
 * registration is a harmless "+OK"); any other listed `<ext>_x` name is added.
 */
export function planFlush(
    extension: string | number,
    domain: string,
    profile: string,
    listed: Registration[] = [],
): FlushPlan | null {
    const ext = String(extension ?? "").trim();
    const dom = String(domain ?? "").trim().toLowerCase();
    const prof = String(profile ?? "").trim();
    const base = candidateUsers(ext);
    if (!base.length || !safeToken(dom) || !safeToken(prof)) return null;

    const users = [...base];
    for (const reg of listed) {
        const user = userPart(reg.user);
        if (belongsToExtension(user, ext) && safeToken(user) && !users.includes(user)) users.push(user);
    }
    return {
        profile: prof,
        domain: dom,
        users,
        commands: users.map((user) => ({
            command: "sofia" as const,
            arg: `profile ${prof} flush_inbound_reg ${user}@${dom}`,
        })),
    };
}

/** The listing command for one user. */
export function listArg(profile: string, user: string, domain: string): string {
    return `status profile ${profile} reg ${user}@${domain}`;
}

/** What FreeSWITCH says when it did the flush. */
export function flushSucceeded(reply: string): boolean {
    return /^\+OK/i.test(String(reply ?? "").trim());
}
