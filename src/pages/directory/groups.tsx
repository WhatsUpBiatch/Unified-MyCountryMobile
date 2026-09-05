import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getDepartmentList } from '@/services/api';
import CustomAvatar from '@/components/custom/custom-avatar';
import { Ic } from '@/components/mcm/icons';
import SideDrawer from '@/components/custom/side-drawer';
import { useCompanyFeatures } from '@/hooks/rbac';
import NewDepartment from '@/pages/admin-settings/phone-systems/departments/new-department';
import { DirectoryPage, EmptyRow, SearchChip } from './page-shell';

/**
 * Directory ▸ Groups — the departments people belong to.
 *
 * The console's Groups view; the platform calls the same records Departments.
 * Reads the existing `getDepartmentList`, so the data and permissions are
 * unchanged — only the presentation is the console's.
 */

const parseMembers = (members: unknown): any[] => {
  try {
    const parsed = typeof members === 'string' ? JSON.parse((members as string) || '[]') : members;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const managerName = (manager: unknown) => {
  try {
    const parsed = typeof manager === 'string' ? JSON.parse((manager as string) || '{}') : manager;
    const value = parsed as any;
    const name = `${value?.first_name || ''} ${value?.last_name || ''}`.trim();
    return name || value?.name || '';
  } catch {
    return '';
  }
};

const Groups = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  /* Same gate the Department page puts on New Department. */
  const { features } = useCompanyFeatures();
  const phoneSystem = features?.plan_features?.phone_system_action;
  const canCreateGroup = Boolean(phoneSystem?.access?.DEPARTMENT && phoneSystem?.action?.add);

  const { data: rows = [], isPending } = useQuery({
    /* The platform's department writes invalidate ['getDepartmentList']; keying
       this list anything else meant a newly created group never appeared. */
    queryKey: ['getDepartmentList', 'directoryGroups'],
    queryFn: () => getDepartmentList({ page: 1, limit: 200 }),
    select: (res: any) => res?.data?.data?.result?.rows || [],
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row: any) =>
      [row?.name, row?.extension, managerName(row?.manager)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [rows, search]);

  return (
    <DirectoryPage
      title="Groups"
      description="Teams that answer calls together. Each group has an extension, a manager and the people in it."
      actions={
        canCreateGroup ? (
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            <Ic n="plus" />
            New group
          </button>
        ) : null
      }
      filters={
        <>
          <SearchChip value={search} onChange={setSearch} placeholder="Search groups" />
          <span className="fchip live" style={{ marginLeft: 'auto' }}>
            <span className="num">{rows.length}</span> groups
          </span>
        </>
      }
    >
      <table>
        <thead>
          <tr>
            <th>Group</th>
            <th>Manager</th>
            <th>People</th>
            <th>Extension</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {isPending ? (
            <EmptyRow span={5} message="Loading groups…" />
          ) : visible.length ? (
            visible.map((row: any) => {
              const members = parseMembers(row?.members);
              const manager = managerName(row?.manager);
              return (
                <tr key={row?.uuid}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <CustomAvatar name={row?.name || 'Group'} size="30" />
                      <span style={{ fontWeight: 700 }}>{row?.name || '—'}</span>
                    </span>
                  </td>
                  <td>{manager || <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                  <td>
                    <span className="tag acc num">{members.length}</span>
                  </td>
                  <td className="num">{row?.extension || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="mini"
                      onClick={() => navigate(`/department/organization/${row?.uuid}`)}
                    >
                      <Ic n="chev" size={12} />
                      Open
                    </button>
                  </td>
                </tr>
              );
            })
          ) : (
            <EmptyRow
              span={5}
              message={rows.length ? 'No groups match that search.' : 'No groups yet.'}
            />
          )}
        </tbody>
      </table>

      {/* The platform's own department form, opened in place. `rowData` empty
          means create rather than edit. */}
      {creating && (
        <SideDrawer
          isOpen={creating}
          title="Create group"
          width="min(920px, 78vw)"
          isTab={false}
          enableResponsive
          headerClassName="min-h-8 px-4 sm:px-5"
          handleClose={() => setCreating(false)}
          content={<NewDepartment rowData={{}} setDrawerState={setCreating} />}
        />
      )}
    </DirectoryPage>
  );
};

export default Groups;
