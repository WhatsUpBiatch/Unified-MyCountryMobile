/* The line that opens a company settings section.
 *
 * All nine tabs had one of four different treatments: five set a plain 18px
 * paragraph with no icon, Emergency address used a 16px h5 with tracking and an
 * inline pin, Holidays put its icon in a 40px tile, and Phone rules and
 * Greetings had no heading at all — so moving along the strip changed the size
 * of the title, whether there was an icon, and sometimes whether the screen
 * named itself.
 *
 * One component instead. The icon is the section's own, but its size, its tile
 * and its distance from the words are the same on every tab, which is what lets
 * the eye stay still while the content behind it changes.
 */

import type { ReactNode } from 'react';

interface SectionHeadingProps {
  /* The section's icon, already sized by the caller's lucide element. */
  icon: ReactNode;
  title: string;
  description: ReactNode;
  /* Buttons that belong to the section as a whole — Holidays keeps Add holiday
     and Save up here. They sit at the far end of the same row. */
  actions?: ReactNode;
}

export const SectionHeading = ({ icon, title, description, actions }: SectionHeadingProps) => (
  <div className="cs-heading">
    <span className="cs-heading-icon" aria-hidden="true">
      {icon}
    </span>
    <div className="cs-heading-text">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
    {actions ? <div className="cs-heading-actions">{actions}</div> : null}
  </div>
);

export default SectionHeading;
