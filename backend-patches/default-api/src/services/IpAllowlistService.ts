/* Reads the company's IP allowlist and records what happened when it was
 * checked at sign-in.
 *
 * WHERE THE SETTINGS ACTUALLY LIVE. Company > Security saves this into the
 * same reserved `user_template` row every other company-wide setting on that
 * screen lives in - the row named "Company Default" - under
 * `settings.company_security.ip_allowlist`. That row is tenant-scoped and this
 * service (default-api) does not have a direct connection to tenant
 * databases; every other admin screen that reads that row does it through
 * `TenantApiService.callTenantApi(dbName, "user/template/listing", ...)`, and
 * this follows the identical path rather than inventing a second one - see
 * `TenantUserTemplateController.list` for the existing precedent.
 *
 * WHY THIS RUNS DURING LOGIN, WHERE THE USER IS NOT YET AUTHENTICATED.
 * `AuthController.login` already knows `findCompany.db_name` at exactly the
 * point this needs it - right after the password has been checked and the
 * company record loaded, before any token is issued. See
 * `AuthController.login.patch.md` for precisely where the one call goes.
 */

import { evaluateIpAllowlist, migrateLegacyAllowlist } from "@/lib/ip-allowlist";
import type { AllowlistDecision, AllowlistSettings } from "@/lib/ip-allowlist";
import { TenantApiService } from "@/services/TenantApiService";
import CompanySecurityAuditLog from "@/models/CompanySecurityAuditLog";

const COMPANY_DEFAULT_TEMPLATE_NAME = "Company Default";

/* Kept out of the request path entirely once this is hit: a company's
 * allowlist does not change every second, and re-fetching it from tenant-api
 * on every login attempt (including every failed password guess) is exactly
 * the kind of load a brute-force attempt would multiply. Mirrors the pattern
 * `CALLING_RULES_CACHE_SECONDS` already uses in the switch's own dialplan
 * service for the same reason. */
const SETTINGS_CACHE_MS = 30_000;
const settingsCache = new Map<string, { settings: AllowlistSettings; at: number }>();

const parseMaybeJson = (value: any): any => {
    if (!value) return {};
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
};

/* Any failure here - the tenant API being slow, the row not existing yet, a
 * shape nobody recognises - resolves to `{ enabled: false }`, which
 * `evaluateIpAllowlist` reads as "not enforced". A company that has never
 * touched this feature, or whose settings could not be read just now, is
 * treated exactly as it always has been: nobody is turned away by a check that
 * could not run. The alternative - failing closed when the CHECK itself
 * breaks - turns an infrastructure hiccup into an outage for every customer of
 * every company on this platform at once, which is a far worse failure mode
 * than the one this feature exists to close. */
export const getAllowlistSettings = async (
    dbName: string,
    companyUuid: string,
): Promise<AllowlistSettings> => {
    const cached = settingsCache.get(dbName);
    if (cached && Date.now() - cached.at < SETTINGS_CACHE_MS) {
        return cached.settings;
    }

    let settings: AllowlistSettings = {
        allow: { enabled: false, entries: [] },
        block: { enabled: false, entries: [] },
        audit_log: [],
    };
    try {
        const response = await TenantApiService.callTenantApi(
            dbName,
            "user/template/listing",
            "POST",
            { page: 1, limit: 200, filters: [], search: COMPANY_DEFAULT_TEMPLATE_NAME },
            { company_uuid: companyUuid },
        );
        const rows: any[] = response?.data?.data?.result?.rows || [];
        const exact = rows.find((row) => row?.name === COMPANY_DEFAULT_TEMPLATE_NAME);
        const rowSettings = parseMaybeJson(exact?.settings);
        settings = migrateLegacyAllowlist(rowSettings?.company_security?.ip_allowlist);
    } catch {
        // Deliberately swallowed - see the comment above the function.
    }

    settingsCache.set(dbName, { settings, at: Date.now() });
    return settings;
};

const eventFor = (outcome: AllowlistDecision["outcome"]): string => {
    switch (outcome) {
        case "allowed":
            return "ip_allowlist_allowed";
        case "denied":
            return "ip_allowlist_denied";
        case "break_glass":
            return "ip_allowlist_break_glass";
        case "misconfigured_empty":
            return "ip_allowlist_misconfigured";
        default:
            return "";
    }
};

/* The one call `AuthController.login` makes. Evaluates the decision, records
 * it (for every outcome except "not enforced" - a company that has never
 * turned this on does not need a row written for every ordinary login), and
 * returns whether the request may proceed.
 *
 * The audit write is fire-and-forget on purpose: a login that succeeded, or
 * was correctly refused, must not fail or slow down because the LOG of that
 * decision could not be written. If the write fails the decision itself still
 * stands - it was already made before the write was attempted. */
export const checkIpAllowlist = async (params: {
    dbName: string;
    companyUuid: string;
    clientIp: string;
    userUuid?: string | null;
    emailAttempted?: string | null;
}): Promise<{ allowed: boolean; decision: AllowlistDecision }> => {
    const { dbName, companyUuid, clientIp, userUuid = null, emailAttempted = null } = params;

    const settings = await getAllowlistSettings(dbName, companyUuid);
    const decision = evaluateIpAllowlist(settings, clientIp, new Date());

    const event = eventFor(decision.outcome);
    if (event) {
        CompanySecurityAuditLog.create({
            company_uuid: companyUuid,
            event,
            client_ip: clientIp,
            user_uuid: userUuid,
            email_attempted: emailAttempted,
            /* Which entry decided this, for either outcome now that block
             * mode exists: in allow mode a "denied" has nothing to name, but
             * in block mode it is exactly the rule that fired - useful to a
             * security review, so it is recorded when present rather than only
             * on "allowed". */
            matched_cidr: decision.outcome === "allowed" || decision.outcome === "denied"
                ? (decision.matched?.cidr ?? null)
                : null,
        }).catch(() => {
            // See the comment above: a logging failure must never surface as a
            // login failure.
        });
    }

    const allowed =
        decision.outcome === "not_enforced" ||
        decision.outcome === "break_glass" ||
        decision.outcome === "allowed" ||
        decision.outcome === "misconfigured_empty";

    return { allowed, decision };
};
