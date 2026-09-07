import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useDebounce from '@/hooks/use-debounce';
import { Ic } from '@/components/mcm/icons';
import SideDrawer from '@/components/custom/side-drawer';
import UpdateForwarding from '@/pages/admin-settings/people/update-forwarding';
import { DirectoryDrawer, DirectoryPage, EmptyRow, FilterChip, SearchChip } from './page-shell';
import CustomAvatar from '@/components/custom/custom-avatar';
import { useConsoleDialer } from '@/pages/phone/console/dial-number';
import { useInstantMeeting } from '@/hooks/use-instant-meeting';
import { PERSON_STATE_LABEL, usePeopleRows, type PersonRow } from './people-rows';
import RemovedPeople from './people-removed';
import { useDirectoryFavourites } from './use-directory-favourites';
import { useUser } from '@/hooks/use-user';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteMember, reactivateMember, removeAssignNumber, suspendMember } from '@/services/api';
import { handleAlert } from '@/lib/utils';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import AlertConfirm from '@/components/custom/alert-confirm';
import RemovalWarning, { useRemovalImpact } from '@/components/mcm/removal-warning';
import SetupGuide from '@/components/mcm/setup-guide';
import {
  PRESENCE_OPTIONS,
  presenceValueOf,
  useMyPresenceControl,
} from '@/hooks/use-presence-control';
import { useCompanyFeatures } from '@/hooks/rbac';
import RoleChangeModal from '@/pages/admin-settings/people/role-change-modal';
import AssignCallerIdModal from '@/pages/admin-settings/people/add-users/assign-caller-id-modal';
import AddUsers from '@/pages/admin-settings/people/add-users';
import { invalidateNumberLists } from '@/lib/number-list-cache';
import { buildRosterCsv, rosterFileName, toExportRow } from '@/lib/user-roster-export';

/**
 * Directory ▸ People — the organisation roster.
 *
 * Everyone in the org with their role, department, extension, the queues they
 * take (the platform's nearest thing to an ACD skill), live presence, and one
 * click to call, message or start video.
 *
 * Row actions reuse the platform's own person editor rather than inventing a
 * second one: "Edit" opens Update Forwarding, and every action is gated on the
 * plan's USER permission tree.
 *
 * WHAT THE GATES HERE ARE, AND ARE NOT
 *
 * The buttons below are hidden or shown from the role's permission tree
 * (account_setting.access.USER.action.edit / .delete). That is a browser-side
 * courtesy: it keeps people from seeing buttons that would fail or that they
 * should not use. The server does not read this tree at all — its only check
 * on these routes is the stored role string (whether the caller is ADMIN), so
 * nothing here should be described as enforcement. It is the same gate for
 * all three actions on purpose: Edit and Change role used to demand the ADMIN
 * role as well, while Remove did not, so a custom role holding the edit
 * permission could delete a colleague but not rename them.
 *
 * ONE PAGE AT A TIME
 *
 * The list is read a page at a time from the same endpoint every other list
 * uses. It used to ask for 500 rows once, and any company larger than that
 * was silently cut off — with an export button that still said "everybody".
 * Search and Location go to the server (it matches name, e-mail, extension and
 * the location's name); Groups and Presence are only known once the page has
 * arrived, so they narrow the page on screen. The export covers exactly the
 * rows on screen and its label says so.
 *
 * STATES
 *
 * Every person has a state as well as a presence: Pending (invited, not yet
 * signed in), Active, Suspended (an administrator switched them off), and
 * Removed (soft-deleted, restorable for 72 hours on the Removed tab). The
 * pill in the Status column is the state; Presence stays what it was. What
 * Suspended actually blocks today is written on the pill itself, and it must
 * stay honest: login is blocked the moment it is set, the phone only once
 * the switch update is applied.
 */

const TONE_CLASS: Record<string, string> = {
  good: 'tag pos',
  busy: 'tag neg',
  warn: 'tag warn',
  idle: 'tag neu',
};

const PAGE_SIZE = 50;

const People = () => {
  const navigate = useNavigate();
  const { dial } = useConsoleDialer();
  const { startVideoCall, isStarting } = useInstantMeeting();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [location, setLocation] = useState('All');
  const [page, setPage] = useState(1);

  /* A new search or location starts from the first page again. */
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, location]);

  const { rows, isLoading, isFetching, total, totalPages, locationNames } = usePeopleRows({
    page,
    limit: PAGE_SIZE,
    search: debouncedSearch,
    location,
  });

  const { user } = useUser();
  const { setMyPresence, isPending: isSettingPresence, myUuid } = useMyPresenceControl();
  const { features } = useCompanyFeatures();

  /* Browser-side only — see the note at the top of the file. The server's gate
     on every one of these routes is the stored role string, not this tree. */
  const userAccess = features?.plan_features?.account_setting?.access?.USER?.action;
  const isAdmin = user?.user_info?.role === 'ADMIN';
  const canEdit = Boolean(userAccess?.edit);
  const canAssignCallerId = Boolean(
    features?.plan_features?.virtual_numbers?.action?.assign_number,
  );

  /* Trial accounts and people without the add permission don't get an invite
     button that would fail. */
  const canInvite = Boolean(userAccess?.add) && user?.company_info?.is_trial !== 'Y';
  const canDelete = Boolean(userAccess?.delete);

  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<PersonRow | null>(null);

  /* Before anybody is removed, find what still points at them — a queue they
     are the last agent on, a menu key, a number forwarded to their extension.
     Only one page of the roster is on screen now, and "is this the last
     administrator?" needs everybody, so the check fetches its own list. */
  const removal = useRemovalImpact((deleting?.raw ?? null) as any, Boolean(deleting));
  const [unassigning, setUnassigning] = useState<PersonRow | null>(null);

  const { mutate: removePerson, isPending: isDeletingPerson } = useMutation({
    mutationKey: ['deleteMember'],
    mutationFn: deleteMember,
    onSuccess: ({ data }: any) => {
      queryClient.invalidateQueries({ queryKey: ['fetchUsersList'] });
      queryClient.invalidateQueries({ queryKey: ['directoryPeople'] });
      invalidateGlobalUsersDirectory(queryClient);
      handleAlert({ text: data?.data?.message || 'Person removed', type: 'success' });
      setDeleting(null);
    },
  });

  /* Suspend / reactivate. The server decides who may (an administrator,
     never yourself, never the account owner); these only hide the buttons
     from people it would refuse. Every failed request is toasted by the API
     client, so there is no onError here. */
  const [suspending, setSuspending] = useState<PersonRow | null>(null);
  const [reactivating, setReactivating] = useState<PersonRow | null>(null);
  const afterStateChange = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['directoryPersonStates'] });
    queryClient.invalidateQueries({ queryKey: ['directoryPeople'] });
    queryClient.invalidateQueries({ queryKey: ['fetchUsersList'] });
    handleAlert({ text: message, type: 'success' });
  };
  const { mutate: suspendPerson, isPending: isSuspending } = useMutation({
    mutationKey: ['suspendMember'],
    mutationFn: suspendMember,
    onSuccess: ({ data }: any) => {
      afterStateChange(data?.data?.message || 'Person suspended');
      setSuspending(null);
    },
  });
  const { mutate: reactivatePerson, isPending: isReactivating } = useMutation({
    mutationKey: ['reactivateMember'],
    mutationFn: reactivateMember,
    onSuccess: ({ data }: any) => {
      afterStateChange(data?.data?.message || 'Person reactivated');
      setReactivating(null);
    },
  });

  const { mutate: removeCallerId, isPending: isUnassigning } = useMutation({
    mutationFn: removeAssignNumber,
    onSuccess: (data: any) => {
      invalidateNumberLists(queryClient);
      queryClient.invalidateQueries({ queryKey: ['directoryPeople'] });
      handleAlert({
        text: data?.data?.data?.message || 'Caller ID removed',
        type: 'success',
      });
      setUnassigning(null);
    },
  });

  /* Anyone with the edit permission may change a role, except the owner's.
     The role-change dialog refuses the owner role too. Browser-side only. */
  const canChangeRoleOf = (row: PersonRow) =>
    canEdit && String(row.role || '').toUpperCase() !== 'ADMIN';

  /* Same shape as Remove: the delete permission, never yourself, never the
     owner. Only once the state is known — a null state means the states
     request has not answered, and a button that acts on a guess is worse
     than none. */
  const canSuspendOf = (row: PersonRow) =>
    canDelete &&
    row.uuid !== myUuid &&
    String(row.role || '').toUpperCase() !== 'ADMIN' &&
    row.state !== null;

  /* People, or the people removed in the last 72 hours. */
  const [tab, setTab] = useState<'people' | 'removed'>('people');

  const [changingRole, setChangingRole] = useState<PersonRow | null>(null);
  const [assigningCallerId, setAssigningCallerId] = useState<PersonRow | null>(null);
  const [inviting, setInviting] = useState(false);

  const [department, setDepartment] = useState('All');
  const { isFavourite, toggleFavourite } = useDirectoryFavourites();
  const [presence, setPresence] = useState('Any');
  const [open, setOpen] = useState<PersonRow | null>(null);
  const [editing, setEditing] = useState<PersonRow | null>(null);

  /* One entry per group, not one per combination a person happens to be in.
     `row.department` is the joined string — "Billing, Retention" for somebody
     in two — so adding it whole put "Billing, Retention" in the menu as though
     it were a group, next to "Billing" and "Retention" themselves. A tenant
     with a handful of groups got a list the length of its distinct
     memberships. The export below already split on the same separator. */
  const departments = useMemo(() => {
    const found = new Set<string>();
    rows.forEach((row) => {
      if (row.department === '—') return;
      row.department
        .split(', ')
        .map((name) => name.trim())
        .filter(Boolean)
        .forEach((name) => found.add(name));
    });
    return ['All', ...Array.from(found).sort()];
  }, [rows]);

  /* Every location the company has, not just the ones on this page — otherwise
     picking one would make the others vanish from the list. */
  const locations = useMemo(() => ['All', ...locationNames], [locationNames]);

  const presences = useMemo(() => {
    const found = new Set<string>();
    rows.forEach((row) => found.add(row.presence));
    return ['Any', ...Array.from(found).sort()];
  }, [rows]);

  /* Search and location already went to the server; this narrows the page
     that came back by the two filters the server does not know about. */
  const visible = useMemo(
    () =>
      rows.filter((row) => {
        /* Membership, not string equality: somebody in "Billing, Retention"
           belongs to Billing, and comparing the whole string excluded them
           from it. */
        if (
          department !== 'All' &&
          !row.department
            .split(', ')
            .map((name) => name.trim())
            .includes(department)
        ) {
          return false;
        }
        if (presence !== 'Any' && row.presence !== presence) return false;
        return true;
      }),
    [rows, department, presence],
  );

  const onQueue = rows.filter((row) => row.tone === 'good').length;

  const pageFirst = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const pageLast = Math.min(page * PAGE_SIZE, total);
  const pageIsEverybody = totalPages <= 1 && !debouncedSearch.trim() && location === 'All';
  const exportIsEverybody = pageIsEverybody && visible.length === rows.length;

  /* Take the roster away as a spreadsheet.
   *
   * The platform has no export of any kind for people, so this is built here
   * out of the list already on screen. It exports exactly the rows on screen —
   * this page, after the filters — and never claims more: a file labelled
   * "everybody" that quietly holds one page of fifty is worse than no export.
   * The button says how many rows are in it and what they are.
   *
   * The file starts with a byte-order mark because otherwise a spreadsheet
   * opening it on Windows reads the accents in people's names as rubbish. */
  const exportRoster = () => {
    const csv = buildRosterCsv(
      visible.map((row) =>
        toExportRow(
          row.raw,
          row.department && row.department !== '—' ? row.department.split(', ') : [],
        ),
      ),
    );
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = rosterFileName(
      user?.company_info?.company_name || user?.user_info?.company_name,
      new Date().toISOString(),
    );
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <DirectoryPage
        title="People"
        description="Everyone in the organisation, with live presence, skills and one-click contact."
        actions={
          <>
            <button
              type="button"
              className="btn ghost"
              onClick={() => navigate('/directory?view=groups')}
            >
              <Ic n="users" />
              Groups
            </button>
            {/* The count is in the label on purpose: filters and paging are
                on this page, and a button that just says "Export" invites
                somebody to file one page as the whole company. */}
            <button
              type="button"
              className="btn ghost"
              disabled={!visible.length}
              title={
                exportIsEverybody
                  ? `Download everybody (${visible.length}) as a spreadsheet`
                  : `Downloads the ${visible.length} people shown on this page, not the whole company (${total})`
              }
              onClick={exportRoster}
            >
              <Ic n="dl" />
              {exportIsEverybody
                ? `Export all ${visible.length}`
                : `Export ${visible.length} on this page`}
            </button>
            {canInvite ? (
              <button type="button" className="btn primary" onClick={() => setInviting(true)}>
                <Ic n="plus" />
                Invite person
              </button>
            ) : null}
          </>
        }
        filters={
          <>
            <FilterChip
              label="Groups"
              value={department}
              options={departments}
              onChange={setDepartment}
            />
            <FilterChip
              label="Location"
              value={location}
              options={locations}
              onChange={setLocation}
            />
            <FilterChip
              label="Presence"
              value={presence}
              options={presences}
              onChange={setPresence}
            />
            <SearchChip value={search} onChange={setSearch} placeholder="Search people" />
            <span className="fchip" style={{ marginLeft: 'auto' }}>
              {total ? (
                <>
                  Showing <span className="num">{pageFirst}</span>–
                  <span className="num">{pageLast}</span> of <span className="num">{total}</span>
                </>
              ) : (
                'Nobody to show'
              )}
            </span>
            <span className="fchip live">
              <span className="num">{onQueue}</span> available on this page
            </span>
          </>
        }
      >
        {/* A new admin adding their first people is exactly who needs to see
            how far through setup they are. The guide hides itself once
            everything is done, so an established account never sees it. */}
        {/* Shut by default here. This page's subject is the roster, and an
            expanded five-step company checklist pushed the first person about
            700px down — a screenful of somebody else's task before the thing
            you came for. It stays one click from open, and still disappears
            for good once setup is done or dismissed. */}
        <SetupGuide companyInfo={user?.company_info} defaultExpanded={false} />

        {/* Two views of the same roster: the people here now, and the people
            removed in the last 72 hours who can still be brought back. */}
        <div
          className="flex items-center gap-1"
          role="tablist"
          aria-label="People or removed people"
          style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)' }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'people'}
            className={tab === 'people' ? 'mini solid' : 'mini'}
            onClick={() => setTab('people')}
          >
            <Ic n="users" size={12} />
            People
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'removed'}
            className={tab === 'removed' ? 'mini solid' : 'mini'}
            title="People removed in the last 72 hours, who can still be restored"
            onClick={() => setTab('removed')}
          >
            <Ic n="trash" size={12} />
            Removed
          </button>
        </div>

        {tab === 'removed' ? (
          <RemovedPeople canRestore={canDelete} />
        ) : (
        <table className="mcm-roster">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Status</th>
              <th>Groups</th>
              <th>Location</th>
              <th>Numbers</th>
              <th>ACD skills</th>
              <th>Presence</th>
              <th>Contact</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyRow span={9} message="Loading the roster…" />
            ) : visible.length ? (
              visible.map((row: PersonRow) => (
                <tr key={row.uuid}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <CustomAvatar name={row.name} image={row.image} size="30" />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 700, display: 'block' }}>{row.name}</span>
                        {row.jobTitle ? (
                          <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block' }}>
                            {row.jobTitle}
                          </span>
                        ) : null}
                        {row.email ? (
                          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{row.email}</span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  {/* The friendly name, never the stored MANAGER/AGENT string;
                      the same map every other role screen reads. The suffix is
                      the admin scope, when one is set: "Location admin · Delhi". */}
                  <td>
                    {row.roleLabel}
                    {row.scopeSuffix ? (
                      <span style={{ fontSize: 11, color: 'var(--ink-4)' }}> · {row.scopeSuffix}</span>
                    ) : null}
                  </td>
                  {/* The account's state, not their presence. The note on the
                      pill says exactly what the state blocks today. Nothing is
                      shown until the states request has answered. */}
                  <td>
                    {row.state ? (
                      <span
                        className={TONE_CLASS[PERSON_STATE_LABEL[row.state].tone] || 'tag neu'}
                        title={PERSON_STATE_LABEL[row.state].note}
                      >
                        {PERSON_STATE_LABEL[row.state].label}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--ink-4)' }}>—</span>
                    )}
                  </td>
                  <td>{row.department}</td>
                  <td className="loc">
                    <span style={{ display: 'block' }} title={row.location}>
                      {row.location}
                    </span>
                    {row.locationPlace ? (
                      <span
                        style={{ fontSize: 11, color: 'var(--ink-4)' }}
                        title={row.locationPlace}
                      >
                        {row.locationPlace}
                      </span>
                    ) : null}
                  </td>
                  {/* Extension is the internal number, caller ID the outbound
                      one people outside the org actually see. Both belong here;
                      the personal phone stays in the drawer. */}
                  <td className="num">
                    <span style={{ display: 'block' }}>{row.extension || '—'}</span>
                    {row.callerId ? (
                      <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{row.callerId}</span>
                    ) : null}
                  </td>
                  {/* A person can sit in several queues, so this is the cell
                      most likely to run long. One line, with the rest on
                      hover, rather than a cell that doubles the row's height
                      for everybody else. */}
                  <td className="skills" title={row.skills.join(', ')}>
                    {row.skills.length ? (
                      row.skills.join(', ')
                    ) : (
                      <span style={{ color: 'var(--ink-4)' }}>—</span>
                    )}
                  </td>
                  {/* Your own row gets a control; everyone else's shows only the
                      live state. Availability is yours to set and nobody else's,
                      so there is nothing to display or imply on their rows. */}
                  <td onClick={(event) => event.stopPropagation()}>
                    <span className={TONE_CLASS[row.tone] || 'tag neu'}>{row.presence}</span>
                    {row.uuid === myUuid ? (
                      <select
                        className="mcm-presence-set"
                        aria-label="Set my availability"
                        value={presenceValueOf(row.availability)}
                        disabled={isSettingPresence}
                        onChange={(event) => setMyPresence(event.target.value)}
                      >
                        {PRESENCE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </td>
                  <td>
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        className={`mini${isFavourite('person', row.uuid) ? ' mcm-fav-on' : ''}`}
                        title={
                          isFavourite('person', row.uuid)
                            ? `Remove ${row.name} from favourites`
                            : `Add ${row.name} to favourites`
                        }
                        aria-label={
                          isFavourite('person', row.uuid)
                            ? `Remove ${row.name} from favourites`
                            : `Add ${row.name} to favourites`
                        }
                        aria-pressed={isFavourite('person', row.uuid)}
                        onClick={() => toggleFavourite('person', row.uuid)}
                      >
                        <Ic n="star" size={12} fill={isFavourite('person', row.uuid)} />
                      </button>
                      <button
                        type="button"
                        className="mini"
                        title={`Call ${row.name}`}
                        aria-label={`Call ${row.name}`}
                        disabled={!row.extension}
                        onClick={() =>
                          row.extension && dial(row.extension, { forceRefreshContactInfo: true })
                        }
                      >
                        <Ic n="phone" size={12} />
                      </button>
                      <button
                        type="button"
                        className="mini"
                        title={`Message ${row.name}`}
                        aria-label={`Message ${row.name}`}
                        onClick={() => navigate(`/messenger?chatId=${row.uuid}&chatType=chat`)}
                      >
                        <Ic n="chat" size={12} />
                      </button>
                      <button
                        type="button"
                        className="mini"
                        title={`Start video with ${row.name}`}
                        aria-label={`Start video with ${row.name}`}
                        disabled={isStarting}
                        onClick={() =>
                          startVideoCall(
                            { user_uuid: row.uuid, name: row.name, email: row.email },
                            `Call with ${row.name}`,
                          )
                        }
                      >
                        <Ic n="video" size={12} />
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          className="mini"
                          title={`Edit ${row.name}`}
                          aria-label={`Edit ${row.name}`}
                          onClick={() => setEditing(row)}
                        >
                          <Ic n="sliders" size={12} />
                        </button>
                      ) : null}
                      {isAdmin ? (
                        <button
                          type="button"
                          className="mini"
                          title={`${row.name}'s activity`}
                          aria-label={`${row.name}'s activity`}
                          onClick={() => navigate(`/activity/${row.uuid}`)}
                        >
                          <Ic n="clock" size={12} />
                        </button>
                      ) : null}
                      {canChangeRoleOf(row) ? (
                        <button
                          type="button"
                          className="mini"
                          title={`Change ${row.name}'s role`}
                          aria-label={`Change ${row.name}'s role`}
                          onClick={() => setChangingRole(row)}
                        >
                          <Ic n="shield" size={12} />
                        </button>
                      ) : null}
                      {canSuspendOf(row) && row.state !== 'SUSPENDED' ? (
                        <button
                          type="button"
                          className="mini"
                          title={`Suspend ${row.name}`}
                          aria-label={`Suspend ${row.name}`}
                          onClick={() => setSuspending(row)}
                        >
                          <Ic n="pause" size={12} />
                        </button>
                      ) : null}
                      {canSuspendOf(row) && row.state === 'SUSPENDED' ? (
                        <button
                          type="button"
                          className="mini"
                          title={`Reactivate ${row.name}`}
                          aria-label={`Reactivate ${row.name}`}
                          onClick={() => setReactivating(row)}
                        >
                          <Ic n="play" size={12} />
                        </button>
                      ) : null}
                      {canAssignCallerId && row.callerId ? (
                        <button
                          type="button"
                          className="mini"
                          title={`Remove ${row.name}'s caller ID`}
                          aria-label={`Remove ${row.name}'s caller ID`}
                          onClick={() => setUnassigning(row)}
                        >
                          <Ic n="x" size={12} />
                        </button>
                      ) : null}
                      {/* Anyone with the delete permission can remove a person;
                          never yourself. The server refuses to delete the
                          owner whoever asks. Browser-side gate, like the rest. */}
                      {canDelete && row.uuid !== myUuid ? (
                        <button
                          type="button"
                          className="mini"
                          title={`Remove ${row.name}`}
                          aria-label={`Remove ${row.name}`}
                          onClick={() => setDeleting(row)}
                        >
                          <Ic n="trash" size={12} />
                        </button>
                      ) : null}
                      {canAssignCallerId ? (
                        <button
                          type="button"
                          className="mini"
                          title={`Assign a caller ID to ${row.name}`}
                          aria-label={`Assign a caller ID to ${row.name}`}
                          onClick={() => setAssigningCallerId(row)}
                        >
                          <Ic n="vm" size={12} />
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyRow
                span={9}
                message={
                  rows.length
                    ? 'Nobody on this page matches those filters.'
                    : debouncedSearch.trim() || location !== 'All'
                      ? 'Nobody matches that search.'
                      : 'No people yet.'
                }
              />
            )}
          </tbody>
        </table>
        )}

        {/* One page at a time. The page you are on, out of how many, with the
            two buttons that move it; nothing else, because nothing else is
            needed to get to any person. */}
        {tab === 'people' && totalPages > 1 ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2"
            style={{ padding: '10px 12px', borderTop: '1px solid var(--line)' }}
          >
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Page {page} of {totalPages}
              {isFetching ? ' · loading…' : ''}
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                className="btn ghost"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Next
              </button>
            </span>
          </div>
        ) : null}

        {open ? (
          <DirectoryDrawer
            title={open.name}
            onClose={() => setOpen(null)}
            footer={
              <>
                <button type="button" className="btn ghost" onClick={() => setOpen(null)}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => navigate(`/department/extension/${open.uuid}`)}
                >
                  <Ic n="user" />
                  Full record
                </button>
                {canEdit ? (
                  <button type="button" className="btn primary" onClick={() => setEditing(open)}>
                    <Ic n="sliders" />
                    Edit
                  </button>
                ) : null}
              </>
            }
          >
            <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
              <CustomAvatar name={open.name} image={open.image} size="44" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{open.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{open.roleLabel}</div>
              </div>
              <span
                className={`${TONE_CLASS[open.tone] || 'tag neu'}`}
                style={{ marginLeft: 'auto' }}
              >
                {open.presence}
              </span>
            </div>

            <div className="kv">
              <span className="k">Status</span>
              <span className="v">
                {open.state
                  ? `${PERSON_STATE_LABEL[open.state].label} · ${PERSON_STATE_LABEL[open.state].note}`
                  : '—'}
              </span>
            </div>

            <div className="kv">
              <span className="k">Groups</span>
              <span className="v">{open.department}</span>
            </div>
            <div className="kv">
              <span className="k">Job title</span>
              <span className="v">{open.jobTitle || '—'}</span>
            </div>
            <div className="kv">
              <span className="k">Location</span>
              <span className="v">
                {open.location}
                {open.locationPlace ? ` · ${open.locationPlace}` : ''}
              </span>
            </div>
            <div className="kv">
              <span className="k">Extension</span>
              <span className="v num">{open.extension || '—'}</span>
            </div>
            <div className="kv">
              <span className="k">Email</span>
              <span className="v">{open.email || '—'}</span>
            </div>
            <div className="kv">
              <span className="k">Caller ID</span>
              <span className="v">{open.callerId || 'Not assigned'}</span>
            </div>
            <div className="kv">
              <span className="k">Phone</span>
              <span className="v num">{open.phone || '—'}</span>
            </div>
            <div className="kv">
              <span className="k">ACD skills</span>
              <span className="v">{open.skills.length ? open.skills.join(', ') : '—'}</span>
            </div>

            <div className="ac-acts" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="mini solid"
                disabled={!open.extension}
                onClick={() =>
                  open.extension && dial(open.extension, { forceRefreshContactInfo: true })
                }
              >
                <Ic n="phone" size={12} />
                Call
              </button>
              <button
                type="button"
                className="mini"
                onClick={() => navigate(`/messenger?chatId=${open.uuid}&chatType=chat`)}
              >
                <Ic n="chat" size={12} />
                Message
              </button>
              <button
                type="button"
                className="mini"
                disabled={isStarting}
                onClick={() =>
                  startVideoCall(
                    { user_uuid: open.uuid, name: open.name, email: open.email },
                    `Call with ${open.name}`,
                  )
                }
              >
                <Ic n="video" size={12} />
                Video
              </button>
            </div>
          </DirectoryDrawer>
        ) : null}
      </DirectoryPage>

      {/* The platform's own add-user flow, opened in place rather than
          bouncing to Admin — the console keeps you in Directory. */}
      {inviting && (
        <SideDrawer
          isOpen={inviting}
          title="Invite people"
          width="min(1180px, 88vw)"
          isTab={false}
          handleClose={() => setInviting(false)}
          content={<AddUsers setDrawerState={() => setInviting(false)} />}
        />
      )}

      <AlertConfirm
        {...{
          apiLoading: isDeletingPerson,
          open: Boolean(deleting),
          setOpen: (value: boolean) => !value && setDeleting(null),
          onConfirm: () => deleting?.raw?.uuid && removePerson(deleting.raw.uuid),
          onCancel: () => setDeleting(null),
          onClose: () => setDeleting(null),
          confirmBtnText: 'Remove them',
          closeBtnText: 'Cancel',
          /* Off only for the finding that cannot be undone from inside the
             product — losing your last administrator. Everything else is a
             judgement the admin is entitled to make. */
          confirmBtnDisabled: removal.blocked || removal.loading,
          className: 'w-full sm:w-2/3 md:w-1/2 lg:w-2/5 p-3',
          descriptionTextComp: (
            <RemovalWarning
              impacts={removal.impacts}
              loading={removal.loading}
              incomplete={removal.incomplete}
              name={deleting?.name || 'this person'}
            />
          ),
        }}
      />

      <AlertConfirm
        {...{
          apiLoading: isUnassigning,
          open: Boolean(unassigning),
          setOpen: (value: boolean) => !value && setUnassigning(null),
          onConfirm: () =>
            unassigning?.callerId && removeCallerId({ did_number: unassigning.callerId }),
          onCancel: () => setUnassigning(null),
          onClose: () => setUnassigning(null),
          confirmBtnText: 'Remove',
          closeBtnText: 'Cancel',
          descriptionTextComp: (
            <div className="text-md">
              Remove <strong>{unassigning?.callerId}</strong> from {unassigning?.name}? The number
              stays on the account and can be assigned again.
            </div>
          ),
        }}
      />

      <AlertConfirm
        {...{
          apiLoading: isSuspending,
          open: Boolean(suspending),
          setOpen: (value: boolean) => !value && setSuspending(null),
          onConfirm: () => suspending?.uuid && suspendPerson(suspending.uuid),
          onCancel: () => setSuspending(null),
          onClose: () => setSuspending(null),
          confirmBtnText: 'Suspend',
          closeBtnText: 'Cancel',
          descriptionTextComp: (
            <div className="text-md">
              Suspend <strong>{suspending?.name}</strong>? They are signed out everywhere at
              once and cannot sign in until you reactivate them. Their phone stops working once
              the switch update is applied. Nothing is deleted: their extension, e-mail, role and
              settings stay as they are.
            </div>
          ),
        }}
      />

      <AlertConfirm
        {...{
          apiLoading: isReactivating,
          open: Boolean(reactivating),
          setOpen: (value: boolean) => !value && setReactivating(null),
          onConfirm: () => reactivating?.uuid && reactivatePerson(reactivating.uuid),
          onCancel: () => setReactivating(null),
          onClose: () => setReactivating(null),
          confirmBtnText: 'Reactivate',
          closeBtnText: 'Cancel',
          descriptionTextComp: (
            <div className="text-md">
              Reactivate <strong>{reactivating?.name}</strong>? They can sign in again straight
              away.
            </div>
          ),
        }}
      />

      <RoleChangeModal
        open={Boolean(changingRole)}
        userData={changingRole?.raw}
        setOpen={(val: boolean) => {
          if (!val) setChangingRole(null);
        }}
      />

      {/* The Extension page normalises the key before handing the record over,
          because the modal expects `user_uuid` and the roster carries `uuid`. */}
      <AssignCallerIdModal
        open={Boolean(assigningCallerId)}
        userData={
          assigningCallerId
            ? {
                ...assigningCallerId.raw,
                user_uuid: assigningCallerId.raw?.user_uuid || assigningCallerId.raw?.uuid,
              }
            : null
        }
        onClose={() => setAssigningCallerId(null)}
      />

      {/* An explicit width matters: without one SideDrawer falls back to
          `calc(100% - 21rem)`, which is ~1660px on a wide screen — far more
          than a four-step form needs, and it buries the page behind it. */}
      {editing ? (
        <SideDrawer
          isOpen={Boolean(editing)}
          title={`Edit ${editing.name}`}
          width="min(1080px, 82vw)"
          enableResponsive
          responsiveWidth="96vw"
          responsiveBreakpoint={1024}
          handleClose={() => setEditing(null)}
          content={
            <UpdateForwarding
              drawerState
              setDrawerState={() => setEditing(null)}
              data={editing.raw}
              setTabData={() => undefined}
            />
          }
        />
      ) : null}
    </>
  );
};

export default People;
