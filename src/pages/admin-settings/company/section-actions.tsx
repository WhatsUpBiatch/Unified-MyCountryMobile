/* The buttons that close a company settings section.
 *
 * Every section ends the same way: a way back, and the button that saves. They
 * live here rather than being written out twice per screen, so the wording, the
 * size and the order cannot drift apart across twelve tabs the way they had —
 * eight different save labels at two sizes, and no way back from any of them.
 */

import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { COMPANY_ROOT, COMPANY_SECTIONS } from './company-sections';

/* One section back along the tab strip: from Holidays to Emergency address, and
 * so on down the row.
 *
 * Not browser history. `navigate(-1)` goes wherever the person happened to come
 * from — the sidebar, the setup guide, a link in a support reply — so the same
 * button led somewhere different on every visit and told you nothing about
 * where it would land. Reading the strip instead makes it one predictable step,
 * and it is the strip's own order, so adding or moving a section carries the
 * button with it.
 */
export const BackButton = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const target = useMemo(() => {
    /* The section is the first segment after the area root; anything deeper is
       a screen inside that section and still belongs to it. */
    const rest = pathname.startsWith(`${COMPANY_ROOT}/`)
      ? pathname.slice(COMPANY_ROOT.length + 1)
      : '';
    const current = rest.split('/')[0];
    const index = COMPANY_SECTIONS.findIndex((section) => section.path === current);
    /* From the first section there is no section before it, so the step is out
       of the area rather than along it. */
    if (index <= 0) return '/admin-settings';
    return `${COMPANY_ROOT}/${COMPANY_SECTIONS[index - 1].path}`;
  }, [pathname]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="cs-btn-outline"
      onClick={() => navigate(target)}
    >
      Back
    </Button>
  );
};

/* Holds the pair together at the end of a row, so the gap between them stays
 * tighter than the gap between them and whatever note sits to their left. */
export const SectionActions = ({ children }: { children: React.ReactNode }) => (
  <div className="cs-actions">
    <BackButton />
    {children}
  </div>
);

export default SectionActions;
