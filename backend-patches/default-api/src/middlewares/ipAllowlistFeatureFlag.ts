/* Whether enforcement is switched on at all, independent of what any one
 * company has configured.
 *
 * A per-company setting says a company WANTS this; this environment variable
 * says the platform is ready to enforce it for anyone. The two are separate on
 * purpose - this is the gradual-rollout switch. Every existing company already
 * has `settings.company_security.ip_allowlist.enabled` sitting in their
 * record from the Security screen (defaulted to `false`, and the screen
 * refuses to save `true` with an empty list) - if this file's check were
 * skipped, deploying it would be the moment enforcement went live for every
 * company that had ever experimented with the screen, not just the ones an
 * operator chose to roll it out to.
 *
 * Unset or anything other than the literal string "true" means off. A typo in
 * an env var must not silently turn a safety feature on for the whole
 * platform - the fail-safe direction here is "not enforced", matching every
 * other uncertain case in `evaluateIpAllowlist`. */
export const ipAllowlistEnforcementEnabled = (): boolean =>
    String(process.env.IP_ALLOWLIST_ENFORCEMENT_ENABLED || "").trim() === "true";
