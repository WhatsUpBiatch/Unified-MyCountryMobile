/* A company rule, rebuilt around the thing an admin actually came to read.
 *
 * The old card gave four things the same weight: the group title, the current
 * value, two switches qualifying it, and a footnote. They were separated by
 * identical hairlines across the full width of the panel, so the eye had no
 * reason to land anywhere in particular — and the current value, the one fact
 * somebody opens this screen to check, was the faintest text on the card.
 *
 * This inverts that:
 *
 *   the value is the headline, in the card's own inset panel, with the button
 *   that changes it directly beside it rather than a card away;
 *
 *   the two rule switches sit together on one compact row, because they are not
 *   two more decisions about the phone system — they are one decision about who
 *   the value above reaches;
 *
 *   the footnote is quiet, and only coloured when it is carrying a warning.
 *
 * A tone can be passed per card. The colour is spent on a spine down the left
 * edge and nothing else: a card's fill must never be read as a status, because
 * status is what the badge is for.
 */

import { ReactNode } from 'react';

import './mcm-page.css';
import { SettingFlag, type SettingStatus } from './setting-card';

export type RuleTone = 'indigo' | 'violet' | 'cyan' | 'teal' | 'rose' | 'sky';

interface RuleCardProps {
  title: string;
  description?: ReactNode;
  status?: SettingStatus;
  tone?: RuleTone;
  /* The current state of this rule, as a person would say it out loud. */
  valueLabel: string;
  value: ReactNode;
  /* Why the value matters, or what is missing while it is unset. */
  valueHint?: ReactNode;
  /* The control that changes the value. Sits with it, not in the header. */
  action?: ReactNode;
  /* Shown against the value - a validation complaint, usually. */
  valueAside?: ReactNode;
  /* A control that needs the full width of the card - a picker, a list - and
     that usually appears only once the rule above is switched on. Sits between
     the value and the rule switches. */
  nested?: ReactNode;
  /* The rule switches. */
  children?: ReactNode;
  note?: ReactNode;
}

export const RuleCard = ({
  title,
  description,
  status,
  tone,
  valueLabel,
  value,
  valueHint,
  action,
  valueAside,
  nested,
  children,
  note,
}: RuleCardProps) => (
  <section className={`mcm-rule${tone ? ` is-${tone}` : ''}`}>
    <header className="mcm-rule-h">
      <div className="mcm-rule-ht">
        <div className="mcm-rule-title">
          <h3>{title}</h3>
          {status ? <SettingFlag status={status} /> : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
    </header>

    <div className="mcm-rule-state">
      <div className="mcm-rule-statet">
        <span className="mcm-rule-eyebrow">{valueLabel}</span>
        <p className="mcm-rule-value">
          {value}
          {valueAside}
        </p>
        {valueHint ? <p className="mcm-rule-hint">{valueHint}</p> : null}
      </div>
      {action ? <div className="mcm-rule-act">{action}</div> : null}
    </div>

    {nested ? <div className="mcm-rule-nested">{nested}</div> : null}

    {children ? <div className="mcm-rule-gov">{children}</div> : null}

    {note ? <p className="mcm-rule-note">{note}</p> : null}
  </section>
);

/* One switch in the governance row. Label and control sit together rather than
   at opposite ends of the panel - at full width the old rows put a switch a
   clear foot away from the words explaining it. */
export const RuleToggle = ({
  label,
  description,
  control,
}: {
  label: string;
  description?: ReactNode;
  control: ReactNode;
}) => (
  <div className="mcm-rule-toggle">
    <div className="mcm-rule-toggle-c">{control}</div>
    <div className="mcm-rule-toggle-t">
      <span>{label}</span>
      {description ? <p>{description}</p> : null}
    </div>
  </div>
);
