/* Admin scope — which part of the company each administrator covers.
 *
 * The Roles screen next door answers "what may this person do". It has no answer
 * for "to whom", so a role that grants "edit user" grants it over everybody. This
 * screen writes down the second half, per person: this admin covers the whole
 * company, this one covers Delhi and Mumbai, this one covers Sales and nothing
 * else. "Location admin, in Delhi." "Group admin, for Sales."
 *
 * The scope is saved on the person's own record through POST /api/person/scope/:uuid
 * and the server reads it on every request that acts on a person (edit, remove,
 * change role, suspend, reactivate, restore). The server check runs in report
 * mode until it is switched on: it writes down what it would have refused and
 * lets the request through. The card says exactly that.
 *
 * The rules — who may set a scope, what a valid one is — are in
 * `lib/admin-scope.ts`, the same rules the server applies. This file is only the
 * part somebody touches.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ShieldCheck, Users } from 'lucide-react';

import Loader from '@/components/custom/loader';
import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AdminPage } from '@/pages/admin-settings/page-shell';
import { AreaNav } from '@/pages/admin-settings/roles/area-nav';
import { roleDisplayName } from '@/pages/admin-settings/roles/role-names';
import { handleAlert } from '@/lib/utils';
import { useUser } from '@/hooks/use-user';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { getDepartmentList, getPersonScopes, getUserList, setPersonScope, siteList } from '@/services/api';
import {
  LEVELS,
  blankScope,
  canSetScope,
  checkScope,
  describeScope,
  isScopeSaveable,
  normaliseScope,
  reachOf,
  type AdminScope,
  type Directory,
  type Person,
  type ScopeActor,
  type ScopeLevel,
  type ScopeRow,
  type SystemRole,
} from '@/lib/admin-scope';

export const PERSON_SCOPES_QUERY_KEY = ['personScopes'];

const nameOf = (person: any): string =>
  `${person?.first_name || ''} ${person?.last_name || ''}`.trim() ||
  person?.email ||
  person?.extension ||
  'Unknown';

const parseMembers = (raw: unknown): string[] => {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((member: any) => String(member?.user_uuid || member?.uuid || '')).filter(Boolean);
  } catch {
    return [];
  }
};

const toggleIn = (list: string[], uuid: string) =>
  list.includes(uuid) ? list.filter((item) => item !== uuid) : [...list, uuid];

const AdminScopePage = () => {
  const queryClient: any = useQueryClient();
  const { user } = useUser();
  const myUuid = String((user as any)?.user_info?.uuid || '');

  const [chosen, setChosen] = useState<string>('');
  const [draft, setDraft] = useState<AdminScope | null>(null);

  const { data: scopeRows = [], isLoading: scopesLoading } = useQuery({
    queryKey: PERSON_SCOPES_QUERY_KEY,
    queryFn: getPersonScopes,
    select: (res: any): ScopeRow[] => {
      const list = res?.data?.data?.result?.rows;
      return (Array.isArray(list) ? list : []).map((row: any) => ({
        uuid: String(row?.uuid || ''),
        system_role: (row?.system_role || null) as SystemRole,
        admin_scope: normaliseScope(row?.admin_scope),
      }));
    },
  });

  const { data: people = [], isLoading: peopleLoading } = useQuery({
    queryKey: ['adminScopePeople'],
    queryFn: () => fetchAllPages(getUserList),
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['adminScopeSites'],
    queryFn: () => fetchAllPages(siteList),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['getDepartmentList', 'adminScope'],
    queryFn: () => fetchAllPages(getDepartmentList),
  });

  const directory: Directory = useMemo(
    () => ({
      locations: (sites as any[]).map((site) => ({
        uuid: String(site?.uuid || ''),
        name: site?.name || 'Unnamed location',
      })),
      groups: (departments as any[]).map((department) => ({
        uuid: String(department?.uuid || ''),
        name: department?.name || 'Unnamed group',
      })),
    }),
    [sites, departments],
  );

  const roleByUuid = useMemo(() => {
    const map = new Map<string, ScopeRow>();
    scopeRows.forEach((row) => map.set(row.uuid, row));
    return map;
  }, [scopeRows]);

  /** People with their location and their group memberships attached. */
  const roster: Person[] = useMemo(() => {
    const byUser = new Map<string, string[]>();
    (departments as any[]).forEach((department) => {
      const uuid = String(department?.uuid || '');
      parseMembers(department?.members).forEach((member) => {
        byUser.set(member, [...(byUser.get(member) || []), uuid]);
      });
    });
    return (people as any[]).map((person) => ({
      uuid: String(person?.uuid || ''),
      name: nameOf(person),
      locationUuid: person?.site_uuid || null,
      groupUuids: byUser.get(String(person?.uuid || '')) || [],
    }));
  }, [people, departments]);

  const personName = (uuid: string) =>
    roster.find((person) => person.uuid === uuid)?.name || 'Somebody who has since left';

  const actorOf = (uuid: string): ScopeActor => {
    const row = roleByUuid.get(uuid);
    return { uuid, role: row?.system_role ?? null, scope: row?.admin_scope ?? null };
  };
  const me = actorOf(myUuid);

  /* The administrators: everybody the server resolves to an admin role other
     than the owner. Sorted so the ones with a scope written down come first. */
  const admins = useMemo(
    () =>
      scopeRows
        .filter((row) => row.system_role === 'MANAGER' || row.system_role === 'SUB-ADMIN')
        .map((row) => ({ ...row, name: personName(row.uuid), decision: canSetScope(me, actorOf(row.uuid)) }))
        .sort((a, b) => {
          const aHas = a.admin_scope && a.admin_scope.level !== 'company' ? 0 : 1;
          const bHas = b.admin_scope && b.admin_scope.level !== 'company' ? 0 : 1;
          return aHas - bHas || a.name.localeCompare(b.name);
        }),
    [scopeRows, roster, myUuid],
  );

  const { mutate: save, isPending } = useMutation({
    mutationFn: ({ uuid, scope }: { uuid: string; scope: AdminScope }) => setPersonScope(uuid, scope),
    onSuccess: () => {
      handleAlert({ text: 'Admin scope saved.', type: 'success' });
      queryClient.invalidateQueries({ queryKey: PERSON_SCOPES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['directoryPersonScopes'] });
      setChosen('');
      setDraft(null);
    },
    onError: (error: any) => {
      handleAlert({
        text: error?.response?.data?.message || 'The scope could not be saved.',
        type: 'error',
      });
    },
  });

  const startEditing = (uuid: string) => {
    setChosen(uuid);
    setDraft(roleByUuid.get(uuid)?.admin_scope ?? blankScope());
  };

  const problems = draft ? checkScope(draft, directory) : [];
  const chosenDecision = chosen ? canSetScope(me, actorOf(chosen)) : { allowed: false, reason: '' };
  const canSave = Boolean(draft) && isScopeSaveable(problems) && chosenDecision.allowed;
  const reach = draft ? reachOf(draft, roster) : null;

  const setLevel = (level: ScopeLevel) =>
    setDraft((current) => (current ? { ...current, level } : current));

  return (
    <AdminPage
      section="People"
      title="Admin scope"
      description="A role says what an administrator may do. This says who they may do it to: the whole company, chosen locations, or chosen groups."
      actions={<AreaNav current="/admin-settings/admin-scope" />}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {scopesLoading || peopleLoading ? (
          <Loader />
        ) : (
          <>
            <SettingCard
              title="Who administers what"
              icon={<ShieldCheck className="h-4 w-4" />}
              description={
                admins.length
                  ? 'Every administrator except the account owner. Anybody without a scope covers the whole company, which is what happens today.'
                  : 'Nobody holds an admin role yet, apart from the account owner. Give somebody one under Roles first.'
              }
              status="coming-soon"
              note={
                <>
                  Saved now. Enforced on the server in report mode until switched on: the server
                  writes down what it would have refused, and does not refuse it yet. The account
                  owner always covers the whole company.
                </>
              }
            >
              {!me.role || (me.role !== 'ADMIN' && me.role !== 'MANAGER') ? (
                <SettingRow
                  label="Read only for you"
                  description="Only the account owner or an account admin can change a scope."
                />
              ) : null}

              {admins.map((admin) => (
                <SettingRow
                  key={admin.uuid}
                  label={admin.name}
                  description={
                    <>
                      {roleDisplayName(admin.system_role || '')} · {describeScope(admin.admin_scope, directory)}
                      {admin.decision.allowed ? null : <> — {admin.decision.reason}</>}
                    </>
                  }
                  control={
                    <Button
                      type="button"
                      variant={chosen === admin.uuid ? 'primary' : 'outline'}
                      disabled={!admin.decision.allowed}
                      onClick={() => startEditing(admin.uuid)}
                    >
                      {chosen === admin.uuid ? 'Editing' : 'Change'}
                    </Button>
                  }
                />
              ))}
            </SettingCard>

            {draft && chosen ? (
              <SettingCard
                title={`How far ${personName(chosen)} reaches`}
                icon={<Users className="h-4 w-4" />}
                description="Everything inside the scope is theirs to administer. Everything outside it is not."
              >
                {/* The three levels as three choices, not three settings rows.

                    They were a label, a sentence and a bare radio thrown to the
                    far right of a full-width row — the control a screen away
                    from the words it belongs to. A whole option is the target
                    here, which is also what makes the sentence readable: it is
                    describing the thing you are about to pick. */}
                <div className="mcm-lvls" role="radiogroup" aria-label="How far they reach">
                  {LEVELS.map((item) => (
                    <label
                      key={item.level}
                      className={`mcm-lvl${draft.level === item.level ? ' is-on' : ''}`}
                    >
                      <input
                        type="radio"
                        name="admin-scope-level"
                        checked={draft.level === item.level}
                        onChange={() => setLevel(item.level)}
                      />
                      <span className="mcm-lvl-t">
                        <b>{item.label}</b>
                        <span>{item.description}</span>
                      </span>
                    </label>
                  ))}
                </div>

                {draft.level === 'location' ? (
                  <div className="mcm-pick">
                    <div className="mcm-pick-h">
                      <b>Locations they manage</b>
                      <span>
                        One for a location admin, several for somebody who covers a region.
                      </span>
                    </div>
                    {directory.locations.length === 0 ? (
                      <p className="mcm-pick-none">
                        No locations yet. Add one under Company before using this scope.
                      </p>
                    ) : (
                      <div className="mcm-pick-l">
                        {directory.locations.map((location) => (
                          <label
                            key={location.uuid}
                            className={`mcm-pick-i${
                              draft.location_uuids.includes(location.uuid) ? ' is-on' : ''
                            }`}
                          >
                            <Checkbox
                              checked={draft.location_uuids.includes(location.uuid)}
                              onCheckedChange={() =>
                                setDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        location_uuids: toggleIn(
                                          current.location_uuids,
                                          location.uuid,
                                        ),
                                      }
                                    : current,
                                )
                              }
                            />
                            <Building2 className="h-3.5 w-3.5" />
                            {location.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {draft.level === 'group' ? (
                  <div className="mcm-pick">
                    <div className="mcm-pick-h">
                      <b>Groups they manage</b>
                      <span>They reach the people in these groups, wherever those people sit.</span>
                    </div>
                    {directory.groups.length === 0 ? (
                      <p className="mcm-pick-none">
                        No groups yet. Add one under Phone System before using this scope.
                      </p>
                    ) : (
                      <div className="mcm-pick-l">
                        {directory.groups.map((group) => (
                          <label
                            key={group.uuid}
                            className={`mcm-pick-i${
                              draft.group_uuids.includes(group.uuid) ? ' is-on' : ''
                            }`}
                          >
                            <Checkbox
                              checked={draft.group_uuids.includes(group.uuid)}
                              onCheckedChange={() =>
                                setDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        group_uuids: toggleIn(current.group_uuids, group.uuid),
                                      }
                                    : current,
                                )
                              }
                            />
                            <Users className="h-3.5 w-3.5" />
                            {group.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* How many people this actually comes to. It is the answer to
                    the question the whole card is asking, and it was the last
                    grey settings row on the screen. */}
                {reach ? (
                  <div className="mcm-reach">
                    <b>
                      {draft.level === 'company' ? reach.totalPeople : reach.people}
                      <span> of {reach.totalPeople} people</span>
                    </b>
                    <p>
                      {draft.level === 'company'
                        ? 'Everybody in the company.'
                        : reach.unplaced > 0
                          ? `${reach.unplaced} ${
                              draft.level === 'location'
                                ? 'have no location set and are left out'
                                : 'are in no group and are left out'
                            }.`
                          : 'Everybody is placed, so nobody is left out by accident.'}
                    </p>
                  </div>
                ) : null}

                {problems.map((problem, index) => (
                  <p
                    key={`${problem.field}-${index}`}
                    className={`mcm-scope-p${problem.blocking ? ' is-block' : ''}`}
                  >
                    <b>{problem.blocking ? 'Needs fixing' : 'Worth knowing'}</b>
                    {problem.message}
                  </p>
                ))}

                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="transparent"
                    onClick={() => {
                      setChosen('');
                      setDraft(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!canSave || isPending}
                    onClick={() => draft && save({ uuid: chosen, scope: draft })}
                  >
                    {isPending ? 'Saving…' : 'Save scope'}
                  </Button>
                </div>
              </SettingCard>
            ) : null}
          </>
        )}
      </div>
    </AdminPage>
  );
};

export default AdminScopePage;
