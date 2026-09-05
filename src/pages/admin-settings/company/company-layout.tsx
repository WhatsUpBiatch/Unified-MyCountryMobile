/* The frame around every company settings screen.
 *
 * These nine screens used to be one page holding `activeSection` in state, so
 * all nine shared a single URL. Nothing could be linked to, a reload always
 * landed back on the first section, the back button skipped the whole area, and
 * one permission guarded the lot — including Security, which sits behind the
 * phone-system permission and therefore opens for anyone who can view the phone
 * system.
 *
 * Each section is now a route. This component holds only what they share: the
 * heading, the sub-navigation, and the outlet the section renders into. The nav
 * is built from the same table the router uses, so a section cannot appear in
 * one and not the other.
 *
 * The heading and the switcher are one header block (`cs-head` + `tabnav` in
 * mcm-page.css) rather than a heading followed by a separate strip. The row is
 * not in a container of its own: it sits on the header's surface, and the
 * header's closing hairline is the line the tabs stand on, with the open
 * section marked by a 3px accent rule laid over that hairline. Twelve sections
 * do not fit across a laptop, so the row scrolls sideways — by wheel, by
 * dragging, by keyboard focus, or with the chevron that appears at whichever
 * end still has sections behind it.
 *
 * The strip itself is `TabRail` in components/mcm, shared with the Numbers
 * views so the two areas cannot drift into two nearly-identical controls.
 */

import { useMemo } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

import { Crumbs } from '@/components/mcm/crumbs';
import { TabRail } from '@/components/mcm/tab-rail';
import { useUser } from '@/hooks/use-user';
import { COMPANY_ROOT, COMPANY_RULES_PATH, COMPANY_SECTIONS } from './company-sections';

import '@/components/mcm/mcm-page.css';

const SECTION_LABELS = new Map(COMPANY_SECTIONS.map((section) => [section.path, section.label]));

/* A slug turned back into words, for a screen nested inside a section. Sections
   themselves never come through here — their wording is the one in
   COMPANY_SECTIONS, so the crumb and the tab cannot say different things. */
const humanise = (slug: string) => slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/* A record's id, not a place with a name. A crumb reading "8f3c-…" tells nobody
   anything, so these are left out of the trail and the screen they belong to
   ends it instead. */
const IS_ID = /^\d+$|^[0-9a-f]{8}-[0-9a-f]{4}-/i;

const CompanyLayout = () => {
  const { user } = useUser();
  const { pathname } = useLocation();

  const companyName =
    user?.company_info?.company_name || user?.user_info?.company_name || 'your company';

  /* The trail below Company, read off the address rather than kept in a second
     list. The first segment is the open section; anything after it is a screen
     inside that section, and it appears in the trail on its own the day such a
     route is added — nobody has to remember to come back here for it. */
  const trail = useMemo(() => {
    const rest = pathname.startsWith(`${COMPANY_ROOT}/`)
      ? pathname.slice(COMPANY_ROOT.length + 1)
      : '';
    let href = COMPANY_ROOT;
    return rest
      .split('/')
      .filter((segment) => segment && !IS_ID.test(segment))
      .map((segment) => {
        href += `/${segment}`;
        return { href, label: SECTION_LABELS.get(segment) ?? humanise(segment) };
      });
  }, [pathname]);

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--ground)]">
      {/* Title, description and section switcher are one block on one surface.
          The tabs used to sit below this header on the page ground, which made
          them the only band of grey between the white header and the white
          content — so the row read as a container nobody had drawn. Sharing the
          header's surface means the row needs no box of its own, and the
          header's hairline becomes the line the tabs sit on. */}
      <header className="cs-head">
        {/* The full path down to the open section, and past it if that section
            ever holds screens of its own. */}
        <Crumbs
          items={[
            { label: 'Admin settings', to: '/admin-settings' },
            /* Named and addressed exactly as the sidebar entry that leads
               here, from the one constant both read, so the two cannot come
               to say different things or point at different screens. */
            { label: 'Company Rules', to: COMPANY_RULES_PATH },
            ...trail.map((crumb) => ({ label: crumb.label, to: crumb.href })),
          ]}
        />

        <h1 className="cs-title">Company Phone Preferences</h1>
        <p className="cs-sub">The phone rules for {companyName}, kept in one place.</p>

        <TabRail
          items={COMPANY_SECTIONS.map((section) => ({
            to: `${COMPANY_ROOT}/${section.path}`,
            label: section.label,
          }))}
          ariaLabel="Company settings"
        />
      </header>

      {/* Same 12px inset as the header above, so the title, the tabs and the
          content below all sit on one left edge. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-4">
        <Outlet />
      </div>
    </section>
  );
};

export default CompanyLayout;
