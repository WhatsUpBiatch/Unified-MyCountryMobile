/* Drop a person's phone registrations off the switch, on request from the API.
 *
 * Called by default-api the moment a person is suspended or removed (see
 * PersonStateService and the User model hook there). The directory already
 * refuses a new REGISTER from a non-ACTIVE person; this ends the one that
 * already exists so the phone stops that second rather than at its next
 * re-registration.
 *
 * Best effort by design: every step is wrapped, nothing here throws to the
 * caller, and the answer always says what was found and what was flushed so
 * the API can log it. The ESL connection may be down (ESLController.api then
 * answers ""), in which case the reply says so and `flushed` is 0.
 */

import { ESLController } from "./ESLController";
import {
    Registration,
    flushSucceeded,
    listArg,
    parseRegistrations,
    planFlush,
} from "../utils/registrationFlush";

/** The profile phones register on. `internal` on every box today. */
export const REGISTRATION_PROFILE = (process.env.FS_REGISTRATION_PROFILE || "internal").trim();

export interface FlushRequest {
    extension?: string | number;
    domain?: string;
    /** Optional override; defaults to FS_REGISTRATION_PROFILE / internal. */
    profile?: string;
}

export interface FlushResult {
    ok: boolean;
    profile: string;
    extension: string;
    domain: string;
    /** Registrations the switch listed before the flush, per SIP user. */
    found: Array<{ user: string; contact: string; agent: string; callId: string }>;
    /** Users flushed with a "+OK" from the switch. */
    flushed: string[];
    /** Users whose flush did not come back "+OK", with the reply. */
    failed: Array<{ user: string; reply: string }>;
    error?: string;
}

export class RegistrationController {
    /** What is registered for an extension right now. Read-only. */
    public static async list(request: FlushRequest): Promise<{ ok: boolean; found: Registration[]; error?: string }> {
        const plan = planFlush(request?.extension ?? "", request?.domain ?? "", request?.profile || REGISTRATION_PROFILE);
        if (!plan) return { ok: false, found: [], error: "extension and domain are required" };
        const found: Registration[] = [];
        for (const user of plan.users) {
            found.push(...parseRegistrations(await ESLController.api("sofia", listArg(plan.profile, user, plan.domain))));
        }
        return { ok: true, found };
    }

    public static async flush(request: FlushRequest): Promise<FlushResult> {
        const extension = String(request?.extension ?? "").trim();
        const domain = String(request?.domain ?? "").trim();
        const profile = String(request?.profile || REGISTRATION_PROFILE).trim();
        const result: FlushResult = { ok: false, profile, extension, domain, found: [], flushed: [], failed: [] };

        const first = planFlush(extension, domain, profile);
        if (!first) {
            result.error = "extension and domain are required (letters, digits, . _ + - only)";
            return result;
        }

        try {
            /* List first so the log says what was actually on the switch, and so
               any extra `<ext>_x` user is flushed too. A failed listing is not
               fatal: the two standard names are flushed regardless. */
            const listed: Registration[] = [];
            for (const user of first.users) {
                listed.push(...parseRegistrations(await ESLController.api("sofia", listArg(profile, user, domain))));
            }
            result.found = listed.map((r) => ({ user: r.user, contact: r.contact, agent: r.agent, callId: r.callId }));

            const plan = planFlush(extension, domain, profile, listed) || first;
            for (let i = 0; i < plan.commands.length; i++) {
                const reply = await ESLController.api(plan.commands[i].command, plan.commands[i].arg);
                if (flushSucceeded(reply)) result.flushed.push(plan.users[i]);
                else result.failed.push({ user: plan.users[i], reply: String(reply || "").trim() || "no answer from ESL" });
            }
            result.ok = result.failed.length === 0;
            if (!result.ok && result.failed.every((f) => f.reply === "no answer from ESL")) {
                result.error = "ESL connection is down; nothing was flushed";
            }
        } catch (err: any) {
            result.error = err?.message || String(err);
        }

        console.log(
            `RegistrationController.flush ${extension}@${domain} profile=${profile} found=${result.found.length} flushed=[${result.flushed.join(",")}] failed=${result.failed.length}${result.error ? ` error=${result.error}` : ""}`,
        );
        return result;
    }
}
