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
  <td className="px-3 py-2 text-center align-middle">
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
        allowed ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
      }`}
      title={label}
    >
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
              sideways underneath the reader. */}
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-3 py-2 text-left font-semibold text-gray-900">Capability</th>
                  {tiers.map((tier) => (
                    <th
                      key={tier.tier}
                      className="px-3 py-2 text-center font-semibold text-gray-900"
                      title={tier.description}
                    >
                      <span className="block">{tier.label}</span>
                      <span className="block text-[11px] font-normal text-gray-500">
                        {SCOPE_LABEL[tier.scope]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <Fragment key={section.area}>
                    <tr className="bg-gray-50">
                      <td
                        colSpan={tiers.length + 1}
                        className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-700"
                      >
                        {section.title}
                        <span className="ml-2 font-normal normal-case tracking-normal text-gray-500">
                          {section.blurb}
                        </span>
                      </td>
                    </tr>
                    {section.rows.map((row) => (
                      <tr key={row.rule.id} className="border-b border-gray-100">
                        <td className="px-3 py-2 align-top">
                          <span className="font-medium text-gray-900">{row.rule.title}</span>
                          <span className="block text-xs text-gray-600">{row.rule.why}</span>
                        </td>
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
