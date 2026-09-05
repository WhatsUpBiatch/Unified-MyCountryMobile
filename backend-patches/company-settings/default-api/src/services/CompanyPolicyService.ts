/* The company's rules, as seen from the user create and update paths.
 *
 * The `users` table lives in the main database, so seeding a new person and refusing
 * a locked change both happen here in default-api. The rules themselves live in the
 * company's own database (`company_settings`, falling back to the old "Company
 * Default" template row), which tenant-api owns. Rather than have two services read
 * the same tenant table - the `tenantDb()` helper here opens a fresh connection pool
 * on every call, which would leak on a per-request path - this asks tenant-api for
 * the folded record through the existing proxy channel and keeps it for half a
 * minute.
 *
 * FAILS OPEN, ON PURPOSE
 *
 * If tenant-api cannot answer, this returns "no rules": nothing is seeded and
 * nothing is refused. That is exactly what the platform did before this existed, and
 * the alternative - every settings save on every phone failing whenever tenant-api
 * hiccups - is worse than a lock that is briefly unenforced. The failure is logged so
 * it is not invisible.
 */

import { IAuth } from "@/interfaces/IRequest";
import { TenantApiService } from "@/services/TenantApiService";
import {
    PolicyField,
    applyCompanyRules,
    lockedFieldViolations,
} from "@/helpers/companyRuleFlags";

export interface CompanyPolicy {
    source: "company_settings" | "user_template" | "none";
    settings: any;
    greetings: any;
}

const NONE: CompanyPolicy = { source: "none", settings: null, greetings: null };

const TTL_MS = 30 * 1000;
const cache: { [dbName: string]: { value: CompanyPolicy; expiresAt: number } } = {};

export const invalidateCompanyPolicy = (dbName?: string): void => {
    if (dbName) {
        delete cache[dbName];
        return;
    }
    Object.keys(cache).forEach((key) => delete cache[key]);
};

export default class CompanyPolicyService {
    static readPolicy = async (auth: IAuth | undefined): Promise<CompanyPolicy> => {
        const dbName = String(auth?.db_name || "").trim();
        if (!dbName) return NONE;

        const cached = cache[dbName];
        const now = Date.now();
        if (cached && cached.expiresAt > now) return cached.value;

        try {
            const response = await TenantApiService.callTenantApi(
                dbName,
                "user/company-settings/policy",
                "POST",
                {},
                auth,
            );
            const result = response?.data?.data?.result;
            const value: CompanyPolicy =
                result && result.source && result.source !== "none"
                    ? { source: result.source, settings: result.settings ?? null, greetings: result.greetings ?? null }
                    : NONE;
            cache[dbName] = { value, expiresAt: now + TTL_MS };
            return value;
        } catch (error: any) {
            console.error(
                `companyPolicy: could not read the company rules for ${dbName}; treating as no rules.`,
                error?.message || error,
            );
            return NONE;
        }
    };

    /**
     * A new person's settings: the generated defaults, with every company value whose
     * rule says `apply` written over them, and anything the caller sent for the
     * person explicitly written over that.
     */
    static seedNewUserSettings = async (
        auth: IAuth | undefined,
        defaults: any,
        explicit?: any,
    ): Promise<{ settings: any; applied: PolicyField[] }> => {
        const policy = await CompanyPolicyService.readPolicy(auth);
        if (policy.source === "none") return { settings: defaults, applied: [] };
        return applyCompanyRules(policy.settings, defaults, explicit);
    };

    /**
     * Which locked rules an update would change. Empty means it may proceed.
     */
    static lockedViolations = async (
        auth: IAuth | undefined,
        storedSettings: any,
        incomingSettings: any,
    ): Promise<PolicyField[]> => {
        const policy = await CompanyPolicyService.readPolicy(auth);
        if (policy.source === "none") return [];
        return lockedFieldViolations(policy.settings, storedSettings, incomingSettings);
    };
}
