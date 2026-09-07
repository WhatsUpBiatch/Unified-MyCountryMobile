/* The trail above a page title.
 *
 * Lifted out of the company settings layout so other admin areas can carry the
 * same one rather than each writing its own. Every step but the last is a link,
 * so the trail is a way back up and not only a label; the last carries
 * `aria-current="page"`, which is what a screen reader reads as "you are here".
 *
 * Styling lives in mcm-page.css under `.cs-crumbs`.
 */

import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  /* Absent on the last step — where you already are is not a link. */
  to?: string;
}

export const Crumbs = ({ items }: { items: Crumb[] }) => (
  <nav className="cs-crumbs" aria-label="Breadcrumb">
    <ol>
      {items.map((crumb, index) => (
        <li key={`${crumb.label}-${index}`}>
          {crumb.to && index < items.length - 1 ? (
            <Link to={crumb.to}>{crumb.label}</Link>
          ) : (
            <span aria-current={index === items.length - 1 ? 'page' : undefined}>{crumb.label}</span>
          )}
        </li>
      ))}
    </ol>
  </nav>
);

export default Crumbs;
