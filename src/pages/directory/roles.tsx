import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteCustomRole, getUserList, userRolesList } from '@/services/api';
import { handleAlert } from '@/lib/utils';
import { useUser } from '@/hooks/use-user';
import { Ic } from '@/components/mcm/icons';
import SideDrawer from '@/components/custom/side-drawer';
import AlertConfirm from '@/components/custom/alert-confirm';
import AddNewRole from '@/pages/admin-settings/roles/add-new-role';
import AssignUsersModal from '@/pages/admin-settings/roles/assign-users-modal';
import { AreaNav } from '@/pages/admin-settings/roles/area-nav';
import {
  OWNER_ROLE_KEY,
  isOwnerRole,
  roleDisplayDescription,
  roleDisplayName,
} from '@/pages/admin-settings/roles/role-names';
import { DirectoryPage, EmptyRow, SearchChip } from './page-shell';

/**
 * Directory ▸ Roles — what people are allowed to do.
 *
 * The console version of the Admin roles list, reading the same
 * `userRolesList` and reusing the platform's own create/edit and assign-users
 * flows. Admin ▸ People ▸ Roles renders this too, so there is one screen rather
 * than two that drift apart.
 *
 * THE OWNER ROW
 *
 * The list endpoint builds its "system" rows from the plan's role_features
 * table, and the platform only ever writes role_features for AGENT, SUB-ADMIN
 * and MANAGER — so the owner role (stored as ADMIN) never comes back, and the
 * one role that the server actually enforces was the one role this screen did
 * not show. When it is missing it is added here, read-only, with a head count
 * from the user list. If a future build does return it, the server's row wins.
 */

type Role = {
  uuid?: string;
  role_uuid?: string;
  name?: string;
  description?: string;
  company_uuid?: string;
  type?: string;
  user_count?: number;
  users_count?: number;
  total_users?: number;
  usersCount?: number;
  users?: unknown[];
};

/** The count arrives under one of several keys depending on the endpoint. */
const usersOn = (role: Role) =>
  role?.user_count ??
  role?.users_count ??
  role?.total_users ??
  role?.usersCount ??
  (Array.isArray(role?.users) ? role.users.length : 0) ??
  0;

/** Whether the count is known at all, tested against the same keys `usersOn`
    reads. The owner row hid its number behind a check on `user_count` alone —
    so a server answering with `users_count`, which `usersOn` accepts happily,
    printed a dash with the real figure sitting one key over. Two functions
    disagreeing about where the count lives is exactly the drift this file's
    own comment warns about. */
const hasUserCount = (role: Role) =>
  role?.user_count !== undefined ||
  role?.users_count !== undefined ||
  role?.total_users !== undefined ||
  role?.usersCount !== undefined ||
  Array.isArray(role?.users);

/** A predefined role belongs to the platform and cannot be edited or removed. */
const isSystemRole = (role: Role) => role?.company_uuid === 'PREDEFINED';

const Roles = () => {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { pathname } = useLocation();
  const isAdmin = user?.user_info?.role === 'ADMIN';
  /* The same component serves /directory?view=roles. The access-control step
     strip belongs to the Admin area, where the other steps live. */
  const inAdminArea = pathname.startsWith('/admin-settings');

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);

  const { data: listed = [], isPending } = useQuery({
    queryKey: ['rolesList', 'directoryRoles'],
    queryFn: () => userRolesList({ page: 1, limit: 200 }),
    select: (res: any) => res?.data?.data?.result?.rows || [],
  });

  const serverHasOwner = useMemo(
    () => (listed as Role[]).some((role) => isOwnerRole(role?.name)),
    [listed],
  );

  /* How many people hold the owner role: one request for one row, reading the
     total the list endpoint already returns. Only made when the row has to be
     built here. */
  const { data: ownerCount } = useQuery({
    queryKey: ['directoryPeople', 'ownerCount'],
    queryFn: () =>
      getUserList({ page: 1, limit: 1, filter: [{ key: 'role', value: OWNER_ROLE_KEY }] }),
    select: (res: any) => Number(res?.data?.data?.result?.total),
    enabled: !isPending && !serverHasOwner,
  });

  const roles: Role[] = useMemo(() => {
    if (isPending || serverHasOwner) return listed;
    const owner: Role = {
      uuid: 'owner-role',
      name: OWNER_ROLE_KEY,
      description: '',
      company_uuid: 'PREDEFINED',
      type: 'system',
      user_count: Number.isFinite(ownerCount) ? ownerCount : undefined,
    };
    return [owner, ...listed];
  }, [listed, isPending, serverHasOwner, ownerCount]);

  const { mutate: removeRole, isPending: isDeleting } = useMutation({
    mutationFn: deleteCustomRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rolesList'] });
      handleAlert({ text: 'Role deleted', type: 'success' });
      setDeleting(null);
    },
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return roles;
    return roles.filter((role: Role) =>
      [role?.name, roleDisplayName(role?.name), role?.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [roles, search]);

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    queryClient.invalidateQueries({ queryKey: ['rolesList'] });
  };

  return (
    <>
      <DirectoryPage
        title="Roles"
        description="What each person sees in this app — and how many people hold each role."
        /* Honest about where the gate is. The tick boxes decide what this app
           shows and hides; the server checks only whether somebody is the
           Account owner. Saying "enforced" here would be untrue. */
        note={
          <>
            A role decides what a person can see and open <b>in this app</b>. The server itself
            checks only whether someone is the <b>Account owner</b>; the owner role is built in
            and cannot be changed here.
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Step 2 of the access-control tour. Steps 1 and 3 and the
                reference table are not in the sidebar, so without this strip
                the tour dead-ended here. */}
            {inAdminArea && isAdmin ? <AreaNav current="/admin-settings/roles" /> : null}
            {isAdmin ? (
              <button type="button" className="btn primary" onClick={() => setCreating(true)}>
                <Ic n="plus" />
                New role
              </button>
            ) : null}
          </div>
        }
        filters={
          <>
            <SearchChip value={search} onChange={setSearch} placeholder="Search roles" />
            <span className="fchip live" style={{ marginLeft: 'auto' }}>
              {visible.length} of {roles.length}
            </span>
          </>
        }
      >
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Type</th>
              <th>People</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              <EmptyRow span={4} message="Loading roles…" />
            ) : visible.length ? (
              visible.map((role: Role) => {
                const system = isSystemRole(role);
                const owner = isOwnerRole(role?.name);
                return (
                  <tr key={role?.uuid || role?.role_uuid || role?.name}>
                    <td>
                      {/* The stored name is an authorisation gate - the platform
                          compares role strings directly - so only the label
                          changes here, never the value. */}
                      <div className="list-row-name">{roleDisplayName(role?.name)}</div>
                      <div className="list-row-sub">
                        {roleDisplayDescription(role?.name, role?.description) || 'No description'}
                      </div>
                    </td>
                    <td>
                      <span className={system ? 'tag neu' : 'tag acc'}>
                        {owner ? 'Built in · owner' : system ? 'Built in' : 'Custom'}
                      </span>
                    </td>
                    <td className="num">
                      {owner && !hasUserCount(role) ? '—' : usersOn(role)}
                    </td>
                    <td>
                      <span className="flex items-center gap-1">
                        {/* The owner role is read-only on purpose: the server
                            decides what ADMIN can do, and assigning it from
                            here is refused by the assign dialog anyway. */}
                        {owner ? (
                          <span className="list-row-sub">Cannot be changed</span>
                        ) : null}
                        {isAdmin && !owner ? (
                          <button
                            type="button"
                            className="mini"
                            title={`Assign people to ${roleDisplayName(role?.name)}`}
                            aria-label={`Assign people to ${roleDisplayName(role?.name)}`}
                            onClick={() => setAssigning(role)}
                          >
                            <Ic n="users" size={12} />
                          </button>
                        ) : null}
                        {/* Looking at a built-in role.

                            Manager, Agent and Sub-admin showed one button —
                            assign people — and nothing else, so there was no way
                            to see what they actually permit. The drawer already
                            copes: it hides its Save button for a platform role,
                            so opening one is read-only without any extra work.
                            It simply had nothing to open it. */}
                        {isAdmin && system && !owner ? (
                          <button
                            type="button"
                            className="mini"
                            title={`See what ${roleDisplayName(role?.name)} can do`}
                            aria-label={`See what ${roleDisplayName(role?.name)} can do`}
                            onClick={() => setEditing(role)}
                          >
                            <Ic n="eye" size={12} />
                          </button>
                        ) : null}

                        {/* Copying any role into one you own.

                            A built-in role cannot be edited, and that is right:
                            its owner is the literal string PREDEFINED rather
                            than any company, so it is shared by every company on
                            the platform and changing it would change it for all
                            of them. What was missing was the way forward —
                            "Manager, but without billing" meant rebuilding it
                            from nothing.

                            Passing the role WITHOUT its uuid is what makes this
                            a copy rather than an edit: the form sends a uuid
                            only when it has one. Leaving the company off is what
                            brings the Save button back. */}
                        {isAdmin && !owner ? (
                          <button
                            type="button"
                            className="mini"
                            title={
                              system
                                ? `Make my own copy of ${roleDisplayName(role?.name)}`
                                : `Duplicate ${roleDisplayName(role?.name)}`
                            }
                            aria-label={`Duplicate ${roleDisplayName(role?.name)}`}
                            onClick={() =>
                              setEditing({
                                /* The name people see, not the one stored. A copy
                                   of Manager opened as "MANAGER (copy)" carrying
                                   "Default features for MANAGER (Ultimate)" --
                                   the platform's own wording for a role this
                                   company never named that. The list shows the
                                   friendly name; the copy has to agree with it
                                   or the rename only went half way. */
                                name: `${roleDisplayName(role?.name)} (copy)`,
                                description: roleDisplayDescription(
                                  role?.name,
                                  role?.description,
                                ),
                                permission: (role as any)?.permission,
                              } as Role)
                            }
                          >
                            <Ic n="copy" size={12} />
                          </button>
                        ) : null}

                        {/* Predefined roles belong to the platform — the
                            platform's own screen refuses these too. */}
                        {isAdmin && !system ? (
                          <button
                            type="button"
                            className="mini"
                            title={`Edit ${role?.name}`}
                            aria-label={`Edit ${role?.name}`}
                            onClick={() => setEditing(role)}
                          >
                            <Ic n="sliders" size={12} />
                          </button>
                        ) : null}
                        {isAdmin && !system ? (
                          <button
                            type="button"
                            className="mini"
                            title={`Delete ${role?.name}`}
                            aria-label={`Delete ${role?.name}`}
                            onClick={() => setDeleting(role)}
                          >
                            <Ic n="trash" size={12} />
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })
            ) : (
              <EmptyRow
                span={4}
                message={roles.length ? 'No roles match that search.' : 'No roles yet.'}
              />
            )}
          </tbody>
        </table>
      </DirectoryPage>

      {(creating || editing) && (
        <SideDrawer
          isOpen={creating || Boolean(editing)}
          /* A copy has a name but no uuid, so it is a new role being created and
             must not say "Update" — the heading is the main thing telling an
             admin whether they are about to change a role people already hold. */
          title={
            editing?.uuid
              ? `Update role (${editing?.name || ''})`
              : editing
                ? `New role (from ${editing?.name || ''})`
                : 'New role'
          }
          width="min(980px, 80vw)"
          isTab={false}
          enableResponsive
          handleClose={closeForm}
          content={
            <AddNewRole
              drawerState={creating || Boolean(editing)}
              roleData={editing || null}
              setDrawerState={closeForm}
            />
          }
        />
      )}

      {assigning ? (
        <AssignUsersModal
          open={Boolean(assigning)}
          setOpen={(value: boolean) => !value && setAssigning(null)}
          roleData={assigning}
        />
      ) : null}

      <AlertConfirm
        {...{
          apiLoading: isDeleting,
          open: Boolean(deleting),
          setOpen: (value: boolean) => !value && setDeleting(null),
          onConfirm: () => {
            const id = deleting?.uuid || deleting?.role_uuid;
            if (!id) {
              handleAlert({ text: 'This role has no id to delete.', type: 'error' });
              setDeleting(null);
              return;
            }
            removeRole(id);
          },
          onCancel: () => setDeleting(null),
          onClose: () => setDeleting(null),
          confirmBtnText: 'Delete',
          closeBtnText: 'Cancel',
          descriptionTextComp: (
            <div className="text-md">
              Delete <strong>{roleDisplayName(deleting?.name)}</strong>? People holding it will
              need another role.
            </div>
          ),
        }}
      />
    </>
  );
};

export default Roles;
