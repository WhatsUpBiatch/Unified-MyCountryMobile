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
  /* Ringing & voicemail removed 3 Sep 2026, at the customer's request, and
   * this is the SECOND removal - it was taken out once, restored by another
   * change on the reasoning below, and taken out again. Read both halves
   * before moving it either way.
   *
   * WHY IT WAS RESTORED: the switch reads how long a phone rings, and this
   * page is where that is set. Removing the row does not stop the switch
   * honouring whatever ring time is already stored - it stops anyone changing
   * it from the product.
   *
   * WHY IT IS OUT ANYWAY: the customer asked twice. The route and the page
   * are untouched, so /admin-settings/company/voicemail still opens if typed,
   * which is the escape hatch if a ring time needs changing before this is
   * settled. */
  { path: 'emergency-address', label: 'Emergency address' },
  { path: 'holidays', label: 'Holidays' },
  /* Calling was removed again on 3 Sep 2026, at the customer's request, having
     been restored here for the reason above.
   *
   * KNOW WHAT THIS COSTS BEFORE PUTTING IT BACK OR LEAVING IT OUT. The switch
   * reads `company_calling_permissions.international_calling` on the outbound
   * path (dialplan_service.py:1999), and `company-calling-permissions.tsx` is
   * the ONLY screen that writes that key - Policies writes a different
   * `international_calling` under its own key, and does not reach this one. So
   * with this row gone, whichever countries are allowed today stays enforced
   * and nobody can change it from the product. The route and the page are
   * untouched, so /admin-settings/company/calling still opens if typed. */
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
