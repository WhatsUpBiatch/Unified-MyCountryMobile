/* Access control — the front door to the four screens that decide who can do what.
 *
 * The pieces were built one at a time, and ended up as four sidebar entries with
 * nothing joining them: Roles, Admin scope, Default permissions, and the
 * capability table. An administrator landing on any one of them had no way of
 * knowing there were three more, which came first, or that the four together are
 * one decision rather than four settings.
 *
 * This screen is that decision written down in order:
 *
 *   1. Decide which kind of person somebody is.
 *   2. Set what that kind of person can do.
 *   3. Choose what a brand-new person starts on.
 *   4. Set how far it reaches.
 *
 * Each step says what it decides, what happens if it is skipped, and opens the
 * screen that does it. Nothing is saved here — it is a map, and a map that saved
 * things would be a fifth place to look.
 *
 * The tiers are shown too, because step 1 is a decision an administrator has to
 * make in their head before any screen can help them, and it is the one they are
 * most likely to get wrong: the names look like a seniority ladder and are
 * actually a statement about reach.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Compass, Layers, Users } from 'lucide-react';

import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import { Button } from '@/components/ui/button';
import { AdminPage } from '@/pages/admin-settings/page-shell';
import { ACCESS_STEPS, AreaNav, MATRIX_PATH } from '@/pages/admin-settings/roles/area-nav';
import { SCOPE_LABEL, TIER_ORDER, tierInfo } from '@/lib/role-permission-defaults';

/** What each step decides, and what goes wrong when it is skipped. */
const STEP_NOTES: Record<string, { decides: string; ifSkipped: string }> = {
  '/admin-settings/access-control': {
    decides: 'Which of the six kinds of person somebody is.',
    ifSkipped:
      'Everybody ends up an administrator, because that is the widest role and the one that never blocks anybody.',
  },
  '/admin-settings/roles': {
    decides: 'What a role can do — the tick boxes behind the name.',
    ifSkipped:
      'The roles that ship all grant nearly the same thing, so the name on somebody’s record means very little.',
  },
  '/admin-settings/admin-scope': {
    decides: 'How far a role reaches — which locations or groups an administrator covers.',
    ifSkipped:
      'Every administrator covers the whole company, so the person who runs one location can change another.',
  },
  '/admin-settings/default-permissions': {
    decides: 'What a brand-new person starts on, and what the recommended set is for each kind.',
    ifSkipped:
      'Whoever is adding people picks a role from memory, and a wrong pick is invisible afterwards.',
  },
};

const AccessControlPage = () => {
  const navigate = useNavigate();
  const tiers = useMemo(() => TIER_ORDER.map((tier) => tierInfo(tier)), []);

  return (
    <AdminPage
      section="People"
      title="How access works"
      description="Who can do what, in four steps. Start here, then work down: the later steps assume the earlier ones have been answered."
      actions={<AreaNav current="/admin-settings/access-control" />}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <SettingCard
          title="The four steps, in order"
          icon={<Compass className="h-4 w-4" />}
          description="Access is one decision made in four places. Doing them out of order still works, but each one is easier once the one above it is settled. Only Roles is in the sidebar; the strip at the top of each step leads to the others."
        >
          {/* A numbered list, not a settings list.

              These four are an order to work through, and SettingRow drew them
              as four unrelated settings: the step number was typed into the
              label ("Step 2 — Roles") and the two things that matter about each
              one — what it decides, and what breaks when it is skipped — ran
              together as one paragraph of bold-led prose. The number is a rail
              here, and the two facts are two lines with their own headings, so
              the shape of the decision is visible before any of it is read. */}
          <ol className="mcm-amap">
            {ACCESS_STEPS.map((item) => {
              const note = STEP_NOTES[item.path];
              const here = item.path === '/admin-settings/access-control';
              return (
                <li key={item.path} className={`mcm-amap-i${here ? ' is-here' : ''}`}>
                  <span className="mcm-amap-n" aria-hidden="true">
                    {item.step}
                  </span>
                  <div className="mcm-amap-t">
                    <b>{item.title}</b>
                    <p>
                      <span className="mcm-amap-k">Decides</span>
                      {note.decides}
                    </p>
                    <p className="is-risk">
                      <span className="mcm-amap-k">If skipped</span>
                      {note.ifSkipped}
                    </p>
                  </div>
                  {here ? (
                    <span className="mcm-amap-you">You are here</span>
                  ) : (
                    <button
                      type="button"
                      className="mcm-amap-go"
                      onClick={() => navigate(item.path)}
                    >
                      Open
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </SettingCard>

        <SettingCard
          title="Step 1 — the kinds of person"
          icon={<Users className="h-4 w-4" />}
          description="Each name says how far that kind of person reaches, not how senior they are. Somebody who runs two groups and somebody who runs the company do the same sorts of thing to different sets of people."
          status="coming-soon"
          note={
            <>
              Coming soon: reach. There is no record yet of which locations or groups somebody
              looks after, so a Location admin&rsquo;s permissions currently apply to every
              location. The Admin scope screen is where you write it down, ready for the day it
              arrives. The permissions themselves decide what a person sees inside this app; the
              server checks only whether someone is the Account owner.
            </>
          }
          aside={
            <Button type="button" variant="primary" onClick={() => navigate(MATRIX_PATH)}>
              See the full table
            </Button>
          }
        >
          {tiers.map((tier) => (
            <SettingRow
              key={tier.tier}
              label={tier.label}
              description={
                <>
                  <strong>Reaches: {SCOPE_LABEL[tier.scope].toLowerCase()}.</strong>{' '}
                  {tier.description}
                </>
              }
              control={
                <span className="mcm-scope">{SCOPE_LABEL[tier.scope]}</span>
              }
            />
          ))}
        </SettingCard>

        <SettingCard
          title="Where a person’s access actually comes from"
          icon={<Layers className="h-4 w-4" />}
          description="Three things stack up. Knowing which one to change saves opening all four screens to find out why somebody cannot see a button."
        >
          <SettingRow
            label="1. The company’s plan"
            description="The ceiling. Nothing can be granted that the company has not bought, so a tick box missing here is missing for everybody, administrators included."
          />
          <SettingRow
            label="2. The role on the person’s record"
            description="What that person may do, within the ceiling. Set on the Roles screen, chosen when somebody is added, and changeable afterwards from the People list."
          />
          <SettingRow
            label="3. How far the role reaches"
            description="Which locations or groups it applies to. Written down on the Admin scope screen, and nothing acts on it yet, so today every role reaches the whole company."
            status="coming-soon"
          />
        </SettingCard>
      </div>
    </AdminPage>
  );
};

export default AccessControlPage;
