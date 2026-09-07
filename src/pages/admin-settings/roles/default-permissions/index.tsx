/* Default permissions — what a person should be able to do on their first day.
 *
 * Adding somebody today asks for a role and nothing else, and whatever that role
 * happens to hold is what they get. Nothing in the product ever decided what a
 * role *should* hold, so the roles that ship grant almost the same thing to
 * everybody: an agent's role and an administrator's role differ by two tick
 * boxes out of a hundred and forty, both about call logs. Every other tick box,
 * billing included, is on for both.
 *
 * This screen is where that gets decided. For each kind of person it works out
 * the permissions they should start with, says why each group of capabilities
 * sits where it does, shows how far the company's current role is from that, and
 * offers to write it down as a role that can then be picked when adding people.
 *
 * The rules and the reasoning live in `lib/role-permission-defaults.ts` with
 * their own tests. This file is only the part somebody touches.
 *
 * Two things it is careful to be honest about, because an administrator who
 * believes otherwise would find out the wrong way:
 *
 *   Permissions decide what the app puts on screen. The platform does not check
 *   them when it answers a request, so a tighter role is a tidier product, not a
 *   locked one. The card says so.
 *
 *   A permission applies to the whole company. There is no column saying which
 *   office or team somebody looks after, so "manager" here means the routing of
 *   every team rather than of theirs. See Admin scope next door, which records
 *   the missing half.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, UserPlus } from 'lucide-react';

import CustomSelect from '@/components/custom/custom-select';
import Loader from '@/components/custom/loader';
import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import { Button } from '@/components/ui/button';
import { AdminPage } from '@/pages/admin-settings/page-shell';
import { AreaNav } from '@/pages/admin-settings/roles/area-nav';
import { extractPlanFeatures, useCompanyFeatures } from '@/hooks/rbac';
import { handleAlert } from '@/lib/utils';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  saveCompanyDefaults,
} from '@/lib/company-defaults';
import { upsertCustomRole, userRolesList } from '@/services/api';
import {
  NEW_PERSON_ROLE_KEY,
  PER_PERSON_GAPS,
  SCOPE_LABEL,
  TIER_ORDER,
  buildDefaultPermission,
  comparePermissions,
  readNewPersonRole,
  tierForRoleName,
  tierInfo,
  type RoleTier,
} from '@/lib/role-permission-defaults';

/** A role as the platform's list hands it back. */
interface PlatformRole {
  uuid?: string;
  role_uuid?: string;
  name?: string;
  description?: string;
  company_uuid?: string;
  type?: string;
  permission?: unknown;
}

const isSystemRole = (role: PlatformRole) => role?.company_uuid === 'PREDEFINED';

/* The id a role travels under. A custom role is identified by its own uuid and a
   system role by its `role_uuid`, and the two role pickers already in the
   product both branch on `type` — so this one does too, or the id saved here
   would not match the one the Add person form looks for. */
const roleIdOf = (role: PlatformRole): string =>
  String((String(role?.type || '').toLowerCase() === 'custom' ? role?.uuid : role?.role_uuid) || '');

/* The name the recommended role is written down under. It is deliberately not
   the system role's own name: a company that already has "MANAGER" should end up
   with a second, tighter role beside it rather than a silent replacement they
   cannot undo. */
const suggestedName = (tier: RoleTier) => tierInfo(tier).label;

const DefaultPermissionsPage = () => {
  const queryClient: any = useQueryClient();
  const { companyPlanFeatures } = useCompanyFeatures();
  const [chosenRole, setChosenRole] = useState<string>('');
  const [openTier, setOpenTier] = useState<RoleTier | null>(null);

  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['useRolesListQueryFn'],
    queryFn: () => userRolesList({}),
    select: (res: any) => (res?.data?.data?.result?.rows || []) as PlatformRole[],
  });

  const { data: stored, isLoading: storedLoading } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
  });

  useEffect(() => {
    setChosenRole(readNewPersonRole((stored as any)?.settings?.[NEW_PERSON_ROLE_KEY]));
  }, [stored]);

  /* Every default is measured against the company's own plan, so a company that
     has not bought a feature never sees a recommendation that claims to grant
     it. */
  const plan = useMemo(() => extractPlanFeatures(companyPlanFeatures), [companyPlanFeatures]);

  const defaults = useMemo(
    () =>
      TIER_ORDER.map((tier) => ({
        tier,
        info: tierInfo(tier),
        result: buildDefaultPermission(plan, tier),
      })),
    [plan],
  );

  /* The company's own role for each kind of person, matched on the name the
     platform uses. A company role with a name of its own is left alone — a wrong
     guess here would propose the wrong permissions for real people. */
  const roleForTier = useMemo(() => {
    const map = new Map<RoleTier, PlatformRole>();
    (roles as PlatformRole[]).forEach((role) => {
      // A role already written down by this screen wins over the system one.
      const tier = tierForRoleName(role?.name);
      if (!tier) return;
      const existing = map.get(tier);
      if (!existing || (isSystemRole(existing) && !isSystemRole(role))) map.set(tier, role);
    });
    return map;
  }, [roles]);

  const roleOptions = useMemo(
    () =>
      (roles as PlatformRole[]).map((role) => ({
        label: `${role?.name || 'Unnamed role'}${isSystemRole(role) ? ' (system)' : ''}`,
        value: roleIdOf(role),
      })),
    [roles],
  );

  const chosen = roleOptions.find((option) => option.value === chosenRole) || null;

  const { mutate: saveCompany, isPending: savingCompany } = useMutation({
    mutationFn: saveCompanyDefaults,
    onSuccess: () => {
      handleAlert({ text: 'Saved. New people will start on this role.', type: 'success' });
      queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
    },
  });

  /* Everything else on the company record travels through untouched — writing
     only this key would delete the rest. */
  const persistChosenRole = (next: string) => {
    saveCompany({
      uuid: (stored as any)?.uuid,
      settings: { ...((stored as any)?.settings || {}), [NEW_PERSON_ROLE_KEY]: next },
      greetings: (stored as any)?.greetings ?? {},
    });
  };

  const { mutate: writeRole, isPending: writingRole } = useMutation({
    mutationFn: upsertCustomRole,
    onSuccess: () => {
      handleAlert({ text: 'Role saved. It can now be picked when adding people.', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['useRolesListQueryFn'] });
      queryClient.invalidateQueries(['rolesList']);
      queryClient.invalidateQueries(['useRolesList', false]);
    },
  });

  /* Writing a recommendation down needs a system role to base it on, which is
     what the platform's own upsert expects. The one whose name matches this kind
     of person is used where there is one, and the first system role otherwise. */
  const baseRoleUuid = (tier: RoleTier): string => {
    const system = (roles as PlatformRole[]).find(
      (role) => isSystemRole(role) && tierForRoleName(role?.name) === tier,
    );
    const fallback = (roles as PlatformRole[]).find(isSystemRole);
    return String(system?.role_uuid || fallback?.role_uuid || '');
  };

  const applyDefault = (tier: RoleTier) => {
    const entry = defaults.find((item) => item.tier === tier);
    const base = baseRoleUuid(tier);
    if (!entry || !base) {
      handleAlert({
        text: 'This company has no system role to base a new one on, so it cannot be written down here.',
        type: 'error',
      });
      return;
    }

    const existing = roleForTier.get(tier);
    const target = existing && !isSystemRole(existing) ? existing : null;

    writeRole({
      name: target?.name || suggestedName(tier),
      description: entry.info.description,
      permission: { plan_features: entry.result.permission },
      role_uuid: base,
      ...(target?.uuid ? { uuid: target.uuid } : {}),
    });
  };

  const loading = rolesLoading || storedLoading;

  return (
    <AdminPage
      section="People"
      title="Default permissions"
      description="Step 3 of four. What each kind of person should be able to do on their first day, and why. Write a recommendation down as a role, then pick it when adding people."
      actions={<AreaNav current="/admin-settings/default-permissions" />}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {loading ? (
          <Loader />
        ) : (
          <>
            <SettingCard
              title="Which role a new person starts on"
              icon={<UserPlus className="h-4 w-4" />}
              description="Choose one here and it is filled in on the Add person form, with your reason shown beside it. Leave it empty and the form falls back to the narrowest role on the account rather than to nothing — but a fallback is a guess, and this is the answer."
              aside={
                <Button
                  type="button"
                  variant="primary"
                  disabled={savingCompany}
                  onClick={() => persistChosenRole(chosenRole)}
                >
                  {savingCompany ? 'Saving…' : 'Save'}
                </Button>
              }
            >
              <SettingRow
                label="Role for a new person"
                description="Filled in on the Add person form, along with a line saying what that role allows and a caution when it reaches past the person holding it. Whoever is adding somebody can still change it before saving, so this is a starting point rather than a restriction. An administrator is never filled in automatically — that is always a decision somebody makes on purpose."
              >
                <CustomSelect
                  options={roleOptions}
                  value={chosen}
                  isClearable
                  placeholder="Not chosen — the form falls back to the narrowest role"
                  handleChange={(option: any) => setChosenRole(String(option?.value || ''))}
                />
              </SettingRow>
            </SettingCard>

            <SettingCard
              title="What each kind of person should get"
              icon={<ShieldCheck className="h-4 w-4" />}
              description="Six kinds of person, worked out from your plan. Each one lists what it is given and what is deliberately held back, with the reason."
              status="app-only"
              note={
                <>
                  There is no setting yet for which office or team somebody looks after, so a
                  manager&rsquo;s permissions reach every team. Admin scope, next door, is where
                  that will live.
                </>
              }
            >
              {/* One block per kind of person, not a settings row.

                  SettingRow puts a label left, a control right and anything
                  else full-width underneath — which for these six meant the
                  name floated on its own line, the two buttons sat a paragraph
                  below the sentence they act on, and the opened reasoning (up
                  to forty rules) unrolled as one flat run of bold-led
                  paragraphs. These are records with a header, a state and a
                  drawer, so they are built as that. */}
              <div className="mcm-tiers">
                {defaults.map(({ tier, info, result }) => {
                  const existing = roleForTier.get(tier);
                  const differences = existing
                    ? comparePermissions(extractPlanFeatures(existing.permission), result.permission)
                    : [];
                  const extra = differences.filter((item) => item.kind === 'extra').length;
                  const missing = differences.filter((item) => item.kind === 'missing').length;
                  const isOpen = openTier === tier;

                  return (
                    <section className={`mcm-tier${isOpen ? ' is-open' : ''}`} key={tier}>
                      <header className="mcm-tier-h">
                        <div className="mcm-tier-id">
                          <b>{info.label}</b>
                          <span className="mcm-scope">{SCOPE_LABEL[info.scope]}</span>
                        </div>
                        <div className="mcm-tier-acts">
                          <button
                            type="button"
                            className="mcm-tier-why"
                            aria-expanded={isOpen}
                            onClick={() => setOpenTier(isOpen ? null : tier)}
                          >
                            {isOpen ? 'Hide the reasons' : 'Why this split'}
                          </button>
                          <Button
                            type="button"
                            variant="primary"
                            disabled={writingRole || result.total === 0}
                            onClick={() => applyDefault(tier)}
                          >
                            {existing && !isSystemRole(existing) ? 'Update this role' : 'Create role'}
                          </Button>
                        </div>
                      </header>

                      <p className="mcm-tier-d">
                        {info.description} <strong>{info.boundary}</strong>
                      </p>

                      {/* What the recommendation comes to, and how far the
                          company's own role is from it. The count on its own
                          said nothing about whether anything needed doing. */}
                      <div className="mcm-tier-stats">
                        <span className="mcm-tier-stat">
                          <b>
                            {result.granted} of {result.total}
                          </b>{' '}
                          things your plan offers
                        </span>
                        {existing ? (
                          differences.length === 0 ? (
                            <span className="mcm-tier-drift is-match">
                              &ldquo;{existing.name}&rdquo; already matches
                            </span>
                          ) : (
                            <>
                              {extra > 0 ? (
                                <span className="mcm-tier-drift is-extra">{extra} to take away</span>
                              ) : null}
                              {missing > 0 ? (
                                <span className="mcm-tier-drift is-missing">{missing} missing</span>
                              ) : null}
                              <span className="mcm-tier-of">
                                from &ldquo;{existing.name}&rdquo;
                                {isSystemRole(existing)
                                  ? ' — a system role, so it is left as it is'
                                  : ''}
                              </span>
                            </>
                          )
                        ) : (
                          <span className="mcm-tier-drift is-none">No role for this kind yet</span>
                        )}
                      </div>

                      {isOpen ? (
                        <div className="mcm-tier-body">
                          <div className="mcm-why">
                            <h4 className="is-yes">What they are given</h4>
                            <ul>
                              {result.allowed.map((rule) => (
                                <li key={rule.id}>
                                  <b>{rule.title}</b>
                                  <span>{rule.why}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {result.withheld.length > 0 ? (
                            <div className="mcm-why">
                              <h4 className="is-no">What is held back, and why</h4>
                              <ul>
                                {result.withheld.map((rule) => (
                                  <li key={rule.id}>
                                    <b>{rule.title}</b>
                                    <span>{rule.why}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {result.undecided.length > 0 ? (
                            <div className="mcm-why">
                              <h4>Not decided here</h4>
                              <p>
                                Your plan includes {result.undecided.length} thing
                                {result.undecided.length === 1 ? '' : 's'} these rules do not
                                recognise, so {result.undecided.length === 1 ? 'it is' : 'they are'}{' '}
                                switched off rather than guessed at. Turn{' '}
                                {result.undecided.length === 1 ? 'it' : 'them'} on by hand on the
                                Roles screen if this kind of person needs{' '}
                                {result.undecided.length === 1 ? 'it' : 'them'}:{' '}
                                {result.undecided.join(', ')}.
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </SettingCard>

            <SettingCard
              title="What a role cannot say here"
              icon={<KeyRound className="h-4 w-4" />}
              description="Some things belong to one named person rather than to their role, because one person needs them and the rest of the team does not. A person record here has nowhere to keep them."
              status="coming-soon"
              note="Coming soon. They are listed here so nobody spends an afternoon looking for a switch that is not there. Each one needs a place on the person record before it can be set at all."
            >
              {PER_PERSON_GAPS.map((gap) => (
                <SettingRow
                  key={gap.id}
                  label={gap.label}
                  description={gap.why}
                  status="coming-soon"
                />
              ))}
            </SettingCard>
          </>
        )}
      </div>
    </AdminPage>
  );
};

export default DefaultPermissionsPage;
