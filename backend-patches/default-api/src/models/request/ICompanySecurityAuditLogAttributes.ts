export interface ICompanySecurityAuditLogAttributes {
    id?: number;
    company_uuid: string;
    /* 'ip_allowlist_allowed' | 'ip_allowlist_denied' | 'ip_allowlist_break_glass'
     * | 'ip_allowlist_misconfigured'. A string, not an enum, so a new decision
     * outcome never needs a migration to be logged - see `evaluateIpAllowlist`
     * in `src/lib/ip-allowlist.ts` for the full set this feature writes today. */
    event: string;
    client_ip: string;
    user_uuid: string | null;
    email_attempted: string | null;
    /* The CIDR entry that matched, when the event was an allow. Null for
     * everything else - there is nothing to name for a denial. */
    matched_cidr: string | null;
    created_at?: Date;
}

export type CompanySecurityAuditLogAttributes = Omit<
    ICompanySecurityAuditLogAttributes,
    "id" | "created_at"
>;
