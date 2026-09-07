/* Take a suspended or removed person out of every queue's agent list, and put
 * them back on reactivate or restore.
 *
 * Queues are owned by campaign-api (MongoDB `queues.members`, plus the
 * `agents` and `tiers` rows the switch's agent service reads). This API does
 * not write those records itself; it asks campaign-api, the way every other
 * queue change goes, on the endpoint added for this:
 *
 *     POST /api/v1/campaign/queue/member/state
 *     { user_uuid, extension?, action: "suspend" | "restore" | "remove", reason? }
 *
 * "suspend" keeps the member entry and stamps `suspended_member` on it (and on
 * the agent and tier rows) so "restore" is exact; "remove" takes the entries
 * out for good (used by the 72-hour purge, when a restore is no longer
 * possible).
 *
 * BEST EFFORT. One request, 3 s cap, outcome logged, never thrown: the person
 * is suspended whatever happens here. If campaign-api is an older build
 * without the route, the reply says so in the log. Even then the agent
 * service will not ring them - endAllSessions() marks their agent rows
 * "Logged Out" - but they would still be listed as a member.
 */

import axios from "axios";
import { IAuth } from "@/interfaces/IRequest";

export const MEMBERSHIP_TIMEOUT_MS = 3000;

export type MembershipAction = "suspend" | "restore" | "remove";

export interface MembershipOutcome {
    ok: boolean;
    action: MembershipAction;
    user_uuid: string;
    queues_touched: number;
    reason?: string;
}

/** The identity headers campaign-api's Auth middleware reads (same set CampaignApiService sends). */
export function campaignHeaders(user: Partial<IAuth> & { db_name?: string }): Record<string, string> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-db-name": String(user?.db_name ?? ""),
        "X-User-company_uuid": String(user?.company_uuid ?? ""),
        "X-User-role": String(user?.role ?? ""),
        "X-User-user_uuid": String(user?.uuid ?? ""),
    };
    if (user?.domain) headers["X-User-domain"] = String(user.domain);
    if (user?.extension !== undefined && user?.extension !== null) headers["X-User-extension"] = String(user.extension);
    const username = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
    if (username) headers["X-User-username"] = username;
    return headers;
}

/** Where campaign-api answers, the same way CampaignApiService finds it. */
export function campaignUrl(env: NodeJS.ProcessEnv = process.env): string {
    return `http://localhost:${env.CAMPAIGN_PORT}/api/v1/campaign/queue/member/state`;
}

/** Turn campaign-api's reply into an outcome. Pure. */
export function outcomeFromReply(action: MembershipAction, user_uuid: string, status: number, body: any): MembershipOutcome {
    const data = body?.data ?? body;
    const queues_touched = Number(data?.queues_touched ?? 0) || 0;
    if (status === 404) {
        return { ok: false, action, user_uuid, queues_touched, reason: "campaign-api has no queue/member/state route (old build) - redeploy it" };
    }
    if (status === 401 || status === 403) {
        return { ok: false, action, user_uuid, queues_touched, reason: `campaign-api refused the identity headers (HTTP ${status})` };
    }
    if (status < 200 || status >= 300 || body?.success === false) {
        const message = body?.error?.message || body?.message || `HTTP ${status}`;
        return { ok: false, action, user_uuid, queues_touched, reason: String(message) };
    }
    return { ok: true, action, user_uuid, queues_touched };
}

export default class QueueMembershipService {
    /**
     * Ask campaign-api to mark / restore / remove `user_uuid` in every queue of
     * the caller's company. `actor` supplies the identity headers: the admin
     * doing the suspending, or a synthetic system identity for the delete hook
     * and the purge. Never throws.
     */
    static async setMembership(
        actor: Partial<IAuth> & { db_name?: string },
        user_uuid: string,
        action: MembershipAction,
        extra: { extension?: string | number | null; reason?: string } = {},
        context = "",
    ): Promise<MembershipOutcome> {
        const target = String(user_uuid ?? "").trim();
        if (!target || !actor?.company_uuid || !actor?.db_name) {
            const outcome: MembershipOutcome = { ok: false, action, user_uuid: target, queues_touched: 0, reason: "missing user, company or db_name" };
            console.log(`QueueMembershipService: skipped ${action} ${context} - ${outcome.reason}`);
            return outcome;
        }
        if (!process.env.CAMPAIGN_PORT) {
            const outcome: MembershipOutcome = { ok: false, action, user_uuid: target, queues_touched: 0, reason: "CAMPAIGN_PORT is not set" };
            console.log(`QueueMembershipService: skipped ${action} ${context} - ${outcome.reason}`);
            return outcome;
        }

        let outcome: MembershipOutcome;
        try {
            const response = await axios.post(
                campaignUrl(),
                {
                    user_uuid: target,
                    extension: extra.extension === undefined || extra.extension === null ? undefined : String(extra.extension),
                    action,
                    reason: extra.reason,
                },
                { headers: campaignHeaders(actor), timeout: MEMBERSHIP_TIMEOUT_MS, validateStatus: () => true },
            );
            outcome = outcomeFromReply(action, target, response.status, response.data);
        } catch (error: any) {
            const code = error?.code ? ` (${error.code})` : "";
            outcome = { ok: false, action, user_uuid: target, queues_touched: 0, reason: `campaign-api unreachable${code}: ${error?.message || error}` };
        }

        console.log(
            `QueueMembershipService: ${outcome.ok ? "done" : "NOT done"} ${action} for ${target} ${context} - ${outcome.queues_touched} queue(s)${outcome.reason ? `, reason: ${outcome.reason}` : ""}`,
        );
        return outcome;
    }

    /** The identity used when no administrator is on the request (delete hook, purge). */
    static systemActor(company_uuid: string, db_name: string, domain?: string): Partial<IAuth> & { db_name: string } {
        return { uuid: "system:person-state", company_uuid, db_name, role: "ADMIN", domain: domain ?? "" } as any;
    }
}
