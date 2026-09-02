/* The one list of company settings sections.
 *
 * The router builds its child routes from this, and the sub-navigation builds
 * its links from it, so a section cannot exist in one and be missing from the
 * other. Adding a section means adding one row here and one route.
 *
 * `path` is relative to /admin-settings/company — the layout links there and
 * the router mounts the sections there, so the two cannot drift apart.
 */

export interface CompanySection {
  path: string;
  label: string;
}

export const COMPANY_SECTIONS: CompanySection[] = [
  { path: 'phone-rules', label: 'Phone rules' },
  { path: 'greetings', label: 'Greetings' },
  { path: 'emergency-address', label: 'Emergency address' },
  { path: 'holidays', label: 'Holidays' },
  { path: 'messaging', label: 'Messaging' },
  { path: 'policies', label: 'Policies' },
  { path: 'security', label: 'Security' },
];

/* Where /admin-settings/company/rules-era links and the bare /company path
   should land. Kept as a constant so the redirects and the router agree. */
export const COMPANY_DEFAULT_SECTION = 'phone-rules';

/* The address of the phone rules section.
 *
 * The sidebar's "Company Rules" entry, the summary card's Edit button and the
 * setup guide's "Call handling" step all pointed at Policies, which holds
 * recording consent and data retention — not the hours, ring time and voicemail
 * those three describe. Anyone following them landed on the wrong screen. They
 * now share this one constant, so a future move cannot separate them again. */
/* The address this whole area hangs off. Exported so the layout, the trail and
   the section buttons all measure from the same string. */
export const COMPANY_ROOT = '/admin-settings/company';

export const COMPANY_RULES_PATH = `${COMPANY_ROOT}/${COMPANY_DEFAULT_SECTION}`;
