/* What each kind of person can do — the whole access model on one page.
 *
 * Before this existed, the only way to find out what a role meant was to open it
 * and read a hundred and forty tick boxes, which tells you what a role holds but
 * never why. An administrator deciding who should be what needs the opposite:
 * the shape first, the tick boxes later.
 *
 * So this page is a table. Down the side, every capability in the product,
 * grouped by the part of the product it belongs to. Across the top, the six
 * kinds of person. Every cell is a yes or a no. Above it are the five principles
 * that decide which cell gets which, because the principles are the part worth
 * remembering — somebody who has read those five lines can work out the answer
 * for a capability that is not on the table yet.
 *
 * The table is generated from the same rules the default permissions are
 * generated from. A table typed out by hand beside the rules would start correct
 * and drift within a month, and then this page would be confidently explaining a
 * model nobody was using.
 *
 * It describes the model, so it saves nothing and has no buttons. What it says
 * about enforcement is on the card, and it is the same thing every screen in
 * this area says: these permissions decide what the app puts on screen, and the
 * platform does not check them when it answers a request.
 */

import { Fragment, useMemo } from 'react';
import { Check, Minus, ScrollText, Table2 } from 'lucide-react';

import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import { AdminPage } from '@/pages/admin-settings/page-shell';
import { AreaNav } from '@/pages/admin-settings/roles/area-nav';
import {
  PRINCIPLES,
  SCOPE_LABEL,
  TIER_ORDER,
  capabilityMatrix,
  tierInfo,
} from '@/lib/role-permission-defaults';

/* A yes and a no, told apart by shape as well as by colour — a table read at a
   glance by somebody who cannot distinguish green from grey still has to work. */
const Cell = ({ allowed, label }: { allowed: boolean; label: string }) => (
  <td className="mcm-cap-c">
    <span className={`mcm-cap-m${allowed ? ' is-yes' : ''}`} title={label}>
      {allowed ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
      <span className="sr-only">{label}</span>
    </span>
  </td>
);

const CapabilityMatrixPage = () => {
  const sections = useMemo(() => capabilityMatrix(), []);
  const tiers = useMemo(() => TIER_ORDER.map((tier) => tierInfo(tier)), []);

  return (
    <AdminPage
      section="People"
      title="What each role can do"
      description="Every capability in the product, and which kind of person gets it. Read the five principles above the table and the rest follows from them."
      actions={<AreaNav current="/admin-settings/capability-matrix" />}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <SettingCard
          title="The five things that decide the split"
          icon={<ScrollText className="h-4 w-4" />}
          description="Run these five questions over any capability, in this order, and the answer is the row in the table below. They matter more than the table: a capability added next year can be placed with them."
        >
          {PRINCIPLES.map((principle, index) => (
            <SettingRow
              key={principle.id}
              label={`${index + 1}. ${principle.title}`}
              description={principle.statement}
            />
          ))}
        </SettingCard>

        <SettingCard
          title="The six kinds of person"
          icon={<Table2 className="h-4 w-4" />}
          description="Each one is named after how far it reaches, not after how senior anybody is. A Group admin is not a junior administrator — they are an administrator of one group."
          status="app-only"
          note={
            <>
              This table is the model rather than a report on your company. What your own roles
              hold is on the Roles screen.
            </>
          }
        >
          {tiers.map((tier) => (
            <SettingRow
              key={tier.tier}
              label={tier.label}
              control={<span className="mcm-scope">{SCOPE_LABEL[tier.scope]}</span>}
              description={
                <>
                  <strong>Reaches: {SCOPE_LABEL[tier.scope].toLowerCase()}.</strong>{' '}
                  {tier.description} {tier.boundary}
                  {tier.scope === 'location' || tier.scope === 'department' ? (
                    <>
                      {' '}
                      Which {tier.scope === 'location' ? 'locations' : 'groups'} is not stored
                      yet, so today this reaches all of them.
                    </>
                  ) : null}
                </>
              }
            />
          ))}
        </SettingCard>

        <SettingCard
          title="Capability by role"
          icon={<Table2 className="h-4 w-4" />}
          description="A tick means this kind of person gets it by default. A dash means it is held back on purpose — hover any row heading for the reason."
          status="app-only"
          note="This table is the model rather than a report on your company. What your own roles actually hold is on the Roles screen, and Default permissions shows how far each one has drifted from this."
        >
          {/* Wide on purpose: seven columns do not fold onto a phone, so the
              table scrolls inside its own box rather than the whole page moving
              sideways underneath the reader.

              The capability column is pinned. Scrolled two columns right, every
              row became six identical ticks with no way to tell which
              capability they belonged to — the one thing the reader is holding
              in their head is exactly the thing that had left the screen. */}
          <div className="mcm-cap-wrap">
            <table className="mcm-cap">
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  {tiers.map((tier) => (
                    <th scope="col" key={tier.tier} title={tier.description}>
                      <span>{tier.label}</span>
                      <span className="mcm-cap-scope">{SCOPE_LABEL[tier.scope]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <Fragment key={section.area}>
                    <tr className="mcm-cap-sec">
                      <td colSpan={tiers.length + 1}>
                        <b>{section.title}</b>
                        <span>{section.blurb}</span>
                      </td>
                    </tr>
                    {section.rows.map((row) => (
                      <tr key={row.rule.id}>
                        <th scope="row">
                          <b>{row.rule.title}</b>
                          <span>{row.rule.why}</span>
                        </th>
                        {row.cells.map((cell) => (
                          <Cell
                            key={cell.tier}
                            allowed={cell.allowed}
                            label={`${tierInfo(cell.tier).label}: ${cell.allowed ? 'yes' : 'no'}`}
                          />
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </SettingCard>
      </div>
    </AdminPage>
  );
};

export default CapabilityMatrixPage;
