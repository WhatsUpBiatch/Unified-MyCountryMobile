/* The screens that decide access, in the order they should be used.
 *
 * They were built one at a time and ended up as unrelated entries in the
 * sidebar, so an administrator landing on any one of them had no way of knowing
 * there were more, or which came first. Access is not several settings; it is
 * one decision made in four steps, and the steps have an order:
 *
 *   1. Understand the kinds of person, and what each is meant to be able to do.
 *   2. Set what a role can do.
 *   3. Choose what a brand-new person starts on.
 *
 *   4. Say how far each administrator reaches: the whole company, chosen
 *      locations, or chosen groups.
 *
 * This strip sits at the top of each of them and says where you are in that
 * order. It is deliberately the same list on every screen, in the same order,
 * with the current one marked: the shape of the area should be learnable from
 * any one of its pages. Only step 2 (Roles) is in the sidebar, so the strip is
 * the only way from Roles to steps 1 and 3 and to the reference table — which
 * is why the Roles page must render it too.
 */

import { useNavigate } from 'react-router-dom';

export interface AreaStep {
  step: number;
  title: string;
  path: string;
  /** What this step decides, in a few words. */
  purpose: string;
}

export const ACCESS_STEPS: AreaStep[] = [
  {
    step: 1,
    title: 'How access works',
    path: '/admin-settings/access-control',
    purpose: 'The kinds of person and what each one is for',
  },
  {
    step: 2,
    title: 'Roles',
    path: '/admin-settings/roles',
    purpose: 'What a role can do',
  },
  {
    step: 3,
    title: 'Default permissions',
    path: '/admin-settings/default-permissions',
    purpose: 'What a new person starts on',
  },
  {
    step: 4,
    title: 'Admin scope',
    path: '/admin-settings/admin-scope',
    purpose: 'Who each administrator reaches',
  },
];

/** The reference table. Not a step: it explains the model and decides nothing.
    It is not in the sidebar either, so the strip carries it as a last entry. */
export const MATRIX_PATH = '/admin-settings/capability-matrix';

const REFERENCE: AreaStep = {
  step: 0,
  title: 'Reference table',
  path: MATRIX_PATH,
  purpose: 'What each kind of person can do, side by side',
};

/**
 * The strip. `current` is the path of the screen showing it, so the step you are
 * on is marked rather than offered as a link to itself.
 */
export const AreaNav = ({ current }: { current: string }) => {
  const navigate = useNavigate();

  return (
    <nav className="mcm-asteps" aria-label="Access control steps">
      {ACCESS_STEPS.map((item) => {
        const here = item.path === current;
        return (
          <button
            key={item.path}
            type="button"
            title={item.purpose}
            aria-current={here ? 'step' : undefined}
            onClick={() => navigate(item.path)}
            className={`mcm-astep${here ? ' is-here' : ''}`}
          >
            <span className="mcm-astep-n" aria-hidden="true">
              {item.step}
            </span>
            {item.title}
          </button>
        );
      })}
      {/* Not a step, so it sits past the rule rather than in the count. */}
      <span className="mcm-asteps-sep" aria-hidden="true" />
      <button
        type="button"
        aria-current={REFERENCE.path === current ? 'page' : undefined}
        title={REFERENCE.purpose}
        onClick={() => navigate(REFERENCE.path)}
        className={`mcm-astep is-ref${REFERENCE.path === current ? ' is-here' : ''}`}
      >
        {REFERENCE.title}
      </button>
    </nav>
  );
};

export default AreaNav;
