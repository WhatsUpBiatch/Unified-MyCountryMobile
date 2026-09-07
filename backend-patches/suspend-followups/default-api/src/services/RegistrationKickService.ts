/* Kick a person's phone off the switch the moment they are suspended or removed.
 *
 * The directory service refuses a REGISTER from anyone who is not ACTIVE, but
 * a registration that already exists lasts until the phone's next REGISTER,
 * which can be an hour away. Until then the phone still rings and still
 * places calls. esl-manager (the switch's event manager, port 5555 on the
 * same box as this API) holds the ESL connection, so this asks it to run
 *
 *     sofia profile internal flush_inbound_reg <ext>@<domain>
 *
 * for every SIP user of that extension (the desk phone `1000` and the browser
 * phone `1000_web`). See esl-manager's RegistrationController.
 *
 * BEST EFFORT. This must never block or fail a suspend or a removal: one
 * request, 3 s hard cap, the outcome logged, never thrown. If esl-manager is
 * not there (or is an old build without the route) the person is still
 * suspended; their phone lapses at its next REGISTER exactly as before.
 */

import axios from "axios";

export const KICK_TIMEOUT_MS = 3000;

export interface KickOutcome {
    ok: boolean;
    extension: string;
    domain: string;
    /** SIP users the switch confirmed flushed ("+OK"). */
    flushed: string[];
    /** Registrations that were on the switch before the flush. */
    found: number;
    /** Why it did not (fully) happen: transport, HTTP status, or the switch's reply. */
    reason?: string;
}

/** Where esl-manager answers. It listens on 5555 on the box that runs it. */
export function eslManagerUrl(env: NodeJS.ProcessEnv = process.env): string {
    return String(env.ESL_MANAGER_URL || "http://127.0.0.1:5555").replace(/\/+$/, "");
}

/**
 * The SIP domain for a company, the same way AuthMiddleware derives it:
 * `db_name` minus the `mcm_` prefix, plus DOMAIN_SUFFIX, `@` -> `.`.
 * Pure; empty when db_name is empty.
 */
export function domainFromDbName(db_name: unknown, suffix: unknown = process.env.DOMAIN_SUFFIX): string {
    const base = String(db_name ?? "").trim();
    if (!base) return "";
    return base.replace("mcm_", "").concat(String(suffix ?? "")).replace("@", ".");
}

/** The request body esl-manager expects; null when there is nothing to flush. */
export function kickRequest(extension: unknown, domain: unknown): { extension: string; domain: string } | null {
    const ext = String(extension ?? "").trim();
    const dom = String(domain ?? "").trim().toLowerCase();
    if (!ext || !dom) return null;
    if (!/^[A-Za-z0-9._+-]+$/.test(ext) || !/^[A-Za-z0-9._-]+$/.test(dom)) return null;
    return { extension: ext, domain: dom };
}

/** Turn esl-manager's answer into a KickOutcome. Pure. */
export function outcomeFromReply(extension: string, domain: string, status: number, body: any): KickOutcome {
    const flushed: string[] = Array.isArray(body?.flushed) ? body.flushed.map(String) : [];
    const found = Array.isArray(body?.found) ? body.found.length : 0;
    if (status === 404) {
        return { ok: false, extension, domain, flushed, found, reason: "esl-manager has no /registrations/flush route (old build) - redeploy it" };
    }
    if (status === 401) {
        return { ok: false, extension, domain, flushed, found, reason: "esl-manager refused the token (ESL_MANAGER_API_TOKEN differs)" };
    }
    if (status < 200 || status >= 300) {
        return { ok: false, extension, domain, flushed, found, reason: `esl-manager answered HTTP ${status}` };
    }
    if (body?.ok === true) return { ok: true, extension, domain, flushed, found };
    const failed = Array.isArray(body?.failed) ? body.failed.map((f: any) => `${f?.user}: ${f?.reply}`).join("; ") : "";
    return { ok: false, extension, domain, flushed, found, reason: body?.error || failed || "switch did not confirm the flush" };
}

export default class RegistrationKickService {
    /**
     * Flush every registration of `extension@domain`. Never throws; the
     * outcome is logged with `context` (who/why) and returned.
     */
    static async kickRegistration(extension: unknown, domain: unknown, context = ""): Promise<KickOutcome> {
        const request = kickRequest(extension, domain);
        if (!request) {
            const outcome: KickOutcome = { ok: false, extension: String(extension ?? ""), domain: String(domain ?? ""), flushed: [], found: 0, reason: "no extension or domain to flush" };
            console.log(`RegistrationKickService: skipped ${context} - ${outcome.reason}`);
            return outcome;
        }

        let outcome: KickOutcome;
        try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            const token = String(process.env.ESL_MANAGER_API_TOKEN || "").trim();
            if (token) headers.Authorization = `Bearer ${token}`;
            const response = await axios.post(`${eslManagerUrl()}/registrations/flush`, request, {
                timeout: KICK_TIMEOUT_MS,
                headers,
                validateStatus: () => true,
            });
            outcome = outcomeFromReply(request.extension, request.domain, response.status, response.data);
        } catch (error: any) {
            const code = error?.code ? ` (${error.code})` : "";
            outcome = {
                ok: false,
                extension: request.extension,
                domain: request.domain,
                flushed: [],
                found: 0,
                reason: `esl-manager unreachable${code}: ${error?.message || error}`,
            };
        }

        const tag = outcome.ok ? "flushed" : "NOT flushed";
        console.log(
            `RegistrationKickService: ${tag} ${request.extension}@${request.domain} ${context} - found ${outcome.found}, flushed [${outcome.flushed.join(",")}]${outcome.reason ? `, reason: ${outcome.reason}` : ""}`,
        );
        return outcome;
    }
}
