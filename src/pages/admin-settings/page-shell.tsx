import type { ReactNode } from 'react';
import { Crumbs, type Crumb } from '@/components/mcm/crumbs';
import { McmIconSprite } from '@/components/mcm/icons';
import '@/components/mcm/mcm-page.css';

/**
 * The shape every Admin list page takes.
 *
 * Admin screens open with a breadcrumb strip — "Numbers › Number In Use" — with
 * both halves rendered at the same weight, and a search box crammed in beside
 * it. This gives them the console's page head instead: a real title, a line
 * saying what the screen is for, and a separate bar for search and actions.
 *
 * It deliberately does *not* replace `TableManager`. That component carries
 * server-side paging, sorting and the search plumbing these pages depend on;
 * swapping it out to gain a nicer table would trade real behaviour for looks.
 * The table styling comes from `.mcm-admin table` in the design system.
 */

export const AdminPage = ({
  crumbs,
  section,
  title,
  description,
  actions,
  filters,
  children,
}: {
  /** The trail above the title, if this screen wants one. Optional, so the
      screens that have never had crumbs are unchanged. */
  crumbs?: Crumb[];
  /** The area this screen belongs to, e.g. "Numbers". */
  section?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
}) => (
  <section className="mcm-adminpage">
    <McmIconSprite />
    <div className="mcm-adminpage-head">
      <div className="mcm-adminpage-title">
        {crumbs?.length ? <Crumbs items={crumbs} /> : null}
        {/* The eyebrow says the area in one word; the trail says the whole path
            and can be walked back up. A screen passing crumbs does not need
            both. */}
        {section && !crumbs?.length ? (
          <div className="mcm-adminpage-eyebrow">{section}</div>
        ) : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="mcm-adminpage-actions">{actions}</div> : null}
    </div>
    {filters ? <div className="mcm-adminpage-bar">{filters}</div> : null}
    <div className="mcm-adminpage-body">
      {/* Same card the Directory tables sit in, so the two areas read as one
          product rather than a styled header bolted onto a bare table. */}
      <div className="panel-card">
        <div className="tbl-wrap">{children}</div>
      </div>
    </div>
  </section>
);

export default AdminPage;
