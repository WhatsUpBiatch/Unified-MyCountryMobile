import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listDeletedMembers, restoreMember } from '@/services/api';
import { handleAlert } from '@/lib/utils';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import AlertConfirm from '@/components/custom/alert-confirm';
import CustomAvatar from '@/components/custom/custom-avatar';
import { Ic } from '@/components/mcm/icons';
import { roleDisplayName } from '@/pages/admin-settings/roles/role-names';
import { EmptyRow } from './page-shell';

/**
 * Directory ▸ People ▸ Removed — people removed in the last 72 hours.
 *
 * Removing a person is a soft delete: the record stays, and for 72 hours an
 * administrator can bring it back with one click. After that the e-mail and
 * phone are freed and the person has to be added again from scratch. This
 * tab is the only place that window is visible.
 *
 * Restore puts the person back with their extension, e-mail and role, and
 * gives them a licence. It does NOT put back any call routing that pointed
 * at them (a number that forwarded to them, a menu key, a queue seat) — that
 * was removed from other people's records when they were removed, and there
 * is no copy of it. The reply says so, and so does the confirm dialog.
 *
 * Reads `POST /api/user/list-deleted`, restores with `POST /api/user/restore/:uuid`.
 * Both are administrators-only on the server; `canRestore` only hides the
 * button from people the server would refuse anyway.
 */

export type RemovedPerson = {
  uuid: string;
  name: string;
  email: string;
  extension: string;
  roleLabel: string;
  removedAt: Date | null;
  restoreUntil: Date | null;
  raw: any;
};

const toRow = (row: any): RemovedPerson => {
  const name = `${row?.first_name || ''} ${row?.last_name || ''}`.trim() || 'Unknown';
  const role = row?.role || '';
  return {
    uuid: String(row?.uuid || ''),
    name,
    email: row?.email || '',
    extension: String(row?.extension || ''),
    roleLabel: role ? roleDisplayName(role) : '—',
    removedAt: row?.deleted_at ? new Date(row.deleted_at) : null,
    restoreUntil: row?.restore_until ? new Date(row.restore_until) : null,
    raw: row,
  };
};

/** "2 days 3 hours" / "40 minutes" / "less than a minute", from now to `until`. */
export const timeLeft = (until: Date | null, now: Date = new Date()): string => {
  if (!until) return '—';
  const ms = until.getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'less than a minute';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} hour${hours === 1 ? '' : 's'}` : ''}`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}${mins ? ` ${mins} min` : ''}`;
  return `${mins} min`;
};

const when = (date: Date | null) =>
  date ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const RemovedPeople = ({ canRestore }: { canRestore: boolean }) => {
  const queryClient = useQueryClient();
  const [restoring, setRestoring] = useState<RemovedPerson | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['directoryRemovedPeople'],
    queryFn: listDeletedMembers,
    select: (res: any) => {
      const result = res?.data?.data?.result || {};
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      return {
        rows: rows.map(toRow) as RemovedPerson[],
        windowHours: Number(result?.restore_window_hours) || 72,
      };
    },
    retry: false,
  });

  const rows = data?.rows || [];
  const windowHours = data?.windowHours || 72;

  const { mutate: restore, isPending } = useMutation({
    mutationKey: ['restoreMember'],
    mutationFn: restoreMember,
    onSuccess: ({ data: reply }: any) => {
      queryClient.invalidateQueries({ queryKey: ['directoryRemovedPeople'] });
      queryClient.invalidateQueries({ queryKey: ['directoryPeople'] });
      queryClient.invalidateQueries({ queryKey: ['directoryPersonStates'] });
      queryClient.invalidateQueries({ queryKey: ['fetchUsersList'] });
      invalidateGlobalUsersDirectory(queryClient);
      handleAlert({ text: reply?.data?.message || 'Person restored', type: 'success' });
      setRestoring(null);
    },
    /* No onError: the API client toasts every failed request already. */
  });

  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', padding: '10px 12px 0' }}>
        People removed in the last {windowHours} hours. Restore brings back their extension,
        e-mail and role. Call routing that pointed at them is not put back.
      </p>
      <table>
        <thead>
          <tr>
            <th>Person</th>
            <th>Role</th>
            <th>Extension</th>
            <th>Removed</th>
            <th>Restore within</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <EmptyRow span={6} message="Loading removed people…" />
          ) : isError ? (
            <EmptyRow
              span={6}
              message="Could not load removed people. Only an administrator can see this list."
            />
          ) : rows.length ? (
            rows.map((row) => (
              <tr key={row.uuid}>
                <td>
                  <span className="flex items-center gap-2.5">
                    <CustomAvatar name={row.name} size="30" />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700, display: 'block' }}>{row.name}</span>
                      {row.email ? (
                        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{row.email}</span>
                      ) : null}
                    </span>
                  </span>
                </td>
                <td>{row.roleLabel}</td>
                <td className="num">{row.extension || '—'}</td>
                <td>{when(row.removedAt)}</td>
                <td title={row.restoreUntil ? `Until ${when(row.restoreUntil)}` : undefined}>
                  {timeLeft(row.restoreUntil)}
                </td>
                <td>
                  {canRestore ? (
                    <button
                      type="button"
                      className="mini solid"
                      title={`Restore ${row.name}`}
                      aria-label={`Restore ${row.name}`}
                      onClick={() => setRestoring(row)}
                    >
                      <Ic n="refresh" size={12} />
                      Restore
                    </button>
                  ) : (
                    <span style={{ color: 'var(--ink-4)' }}>—</span>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <EmptyRow span={6} message={`Nobody has been removed in the last ${windowHours} hours.`} />
          )}
        </tbody>
      </table>

      <AlertConfirm
        {...{
          apiLoading: isPending,
          open: Boolean(restoring),
          setOpen: (value: boolean) => !value && setRestoring(null),
          onConfirm: () => restoring?.uuid && restore(restoring.uuid),
          onCancel: () => setRestoring(null),
          onClose: () => setRestoring(null),
          confirmBtnText: 'Restore',
          closeBtnText: 'Cancel',
          descriptionTextComp: (
            <div className="text-md">
              Restore <strong>{restoring?.name}</strong>? They get their extension
              {restoring?.extension ? ` (${restoring.extension})` : ''}, e-mail and role back, and a
              licence. Any call routing that pointed at them is not put back — set it again if you
              need it.
            </div>
          ),
        }}
      />
    </>
  );
};

export default RemovedPeople;
