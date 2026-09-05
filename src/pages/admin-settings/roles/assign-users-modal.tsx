import { CloseIcon, SearchLine } from '@/assets/icons';
import CustomAvatar from '@/components/custom/custom-avatar';
import Loader from '@/components/custom/loader';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { handleAlert } from '@/lib/utils';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import { assignRoleBulkUsers } from '@/services/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FC, useEffect, useMemo, useRef, useState } from 'react';
import useDebounce from '@/hooks/use-debounce';
import { usePaginatedUsers } from '@/hooks/use-paginated-users';
import { roleDisplayName } from '@/pages/admin-settings/roles/role-names';

interface AssignUsersModalProps {
  open: boolean;
  roleData: any;
  setOpen: (state: boolean) => void;
}

const AssignUsersModal: FC<AssignUsersModalProps> = ({ open, roleData, setOpen }) => {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const queryClient: any = useQueryClient();

  const roleName = roleData?.name || roleData?.role_data?.name || roleData?.role || 'Role';
  const roleType = String(roleData?.type || roleData?.role_data?.type || '').toLowerCase();
  const isSystemRole =
    roleData?.company_uuid === 'PREDEFINED' ||
    roleData?.role_data?.company_uuid === 'PREDEFINED' ||
    roleType === 'predefined' ||
    roleType === 'system';
  const selectedRoleUUID = isSystemRole
    ? roleData?.role_uuid || roleData?.role_data?.role_uuid || ''
    : roleData?.uuid || roleData?.role_data?.uuid || roleData?.role_uuid || '';

  const {
    users: usersList = [],
    isLoading,
    fetchNextPage,
    hasNextPage = false,
    isFetchingNextPage,
  } = usePaginatedUsers({
    search: debouncedSearch,
    enabled: open,
    queryKey: ['assignRoleUsersList'],
  });

  // Pull the next page in as the bottom of the list comes into view.
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries?.[0]?.isIntersecting) fetchNextPage();
      },
      { rootMargin: '120px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, usersList?.length]);

  const { mutate: mutateAssignRoleBulkUsers, isPending: isAssignPending } = useMutation({
    mutationFn: assignRoleBulkUsers,
    onSuccess: (data: any) => {
      handleAlert({
        text: data?.data?.data?.message || 'People assigned to the role',
        type: 'success',
      });
      queryClient.invalidateQueries(['rolesList']);
      queryClient.invalidateQueries(['assignRoleUsersList']);
      invalidateGlobalUsersDirectory(queryClient);
      handleClose();
    },
    onError: (error: any) => {
      handleAlert({
        text: error?.response?.data?.message || 'Could not assign people to the role.',
        type: 'error',
      });
    },
  });

  const getRoleBadgeClass = (name: string) => {
    const normalized = String(name || '').toUpperCase();
    if (normalized === 'ADMIN')
      return 'text-ucass-active border-ucass-active-bg bg-ucass-active-bg';
    if (normalized === 'SUB-ADMIN') return 'text-indigo-700 border-indigo-200 bg-indigo-50';
    if (normalized === 'MANAGER') return 'text-amber-700 border-amber-200 bg-amber-50';
    if (normalized === 'AGENT') return 'text-slate-700 border-slate-200 bg-slate-50';
    if (normalized.includes('SUPPORT')) return 'text-emerald-700 border-emerald-200 bg-emerald-50';
    if (normalized.includes('SALES')) return 'text-rose-700 border-rose-200 bg-rose-50';
    return 'text-gray-700 border-gray-200 bg-gray-50';
  };

  const getCurrentRoleName = (item: any) =>
    item?.custom_role_data?.name || item?.role_data?.name || item?.role || 'N/A';

  const isAdminRole = (name: string) => String(name || '').toUpperCase() === 'ADMIN';

  // Filtering is done by the API now, so the list renders exactly what came back.
  const filteredUsers = usersList;

  const allVisibleUserIds = filteredUsers
    ?.filter((item: any) => !isAdminRole(getCurrentRoleName(item)))
    .map((item: any) => item?.uuid)
    .filter(Boolean);
  const isAllChecked =
    allVisibleUserIds?.length > 0 &&
    allVisibleUserIds.every((userId: string) => selectedUserIds.includes(userId));

  const isUserAssignedToCurrentRole = (item: any) => {
    if (!selectedRoleUUID) return false;
    const userRoleUUID = isSystemRole
      ? item?.role_uuid || item?.role_data?.role_uuid
      : item?.custom_role_uuid || item?.custom_role_data?.uuid || item?.role_uuid;
    return userRoleUUID === selectedRoleUUID;
  };

  const alreadyAssignedIds = useMemo(() => {
    if (!usersList?.length || !selectedRoleUUID) return new Set<string>();
    return new Set<string>(
      usersList
        .filter((item: any) => {
          const name = getCurrentRoleName(item);
          if (isAdminRole(name)) return false;
          return isUserAssignedToCurrentRole(item);
        })
        .map((item: any) => item?.uuid),
    );
  }, [usersList, selectedRoleUUID, isSystemRole]);

  const handleToggleUser = (userId: string, disabled = false) => {
    if (disabled) return;
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const handleSelectAll = () => {
    if (isAllChecked) {
      setSelectedUserIds((prev) =>
        prev.filter((id) => !allVisibleUserIds.includes(id) || alreadyAssignedIds.has(id)),
      );
    } else {
      const merged = Array.from(new Set([...selectedUserIds, ...allVisibleUserIds]));
      setSelectedUserIds(merged);
    }
  };

  useEffect(() => {
    if (open && alreadyAssignedIds.size > 0) {
      setSelectedUserIds((prev) => {
        const merged = Array.from(new Set([...prev, ...Array.from(alreadyAssignedIds)]));
        return merged.length === prev.length ? prev : merged;
      });
    }
  }, [open, alreadyAssignedIds]);

  useEffect(() => {
    const adminUserIds = new Set(
      usersList
        ?.filter((item: any) => isAdminRole(getCurrentRoleName(item)))
        .map((item: any) => item?.uuid)
        .filter(Boolean),
    );
    if (adminUserIds.size === 0) return;

    setSelectedUserIds((prev) => {
      const next = prev.filter((id) => !adminUserIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [usersList]);

  const handleClose = () => {
    setSearch('');
    setSelectedUserIds([]);
    setOpen(false);
  };

  const handleAssign = () => {
    if (!selectedRoleUUID) {
      handleAlert({ text: 'Unable to identify role for assignment.', type: 'error' });
      return;
    }
    if (!selectedUserIds?.length) {
      handleAlert({ text: 'Pick at least one person.', type: 'error' });
      return;
    }

    mutateAssignRoleBulkUsers({
      role_uuid: selectedRoleUUID,
      users: selectedUserIds,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(val) => (!val ? handleClose() : setOpen(true))}>
      <DialogContent
        className="w-[760px] max-w-[calc(100%-2rem)] p-0 gap-0"
        showCloseButton={false}
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div className="flex flex-col gap-1">
            <h4 className="text-gray-900 text-lg font-semibold">Assign people to a role</h4>
            <p className="text-sm text-gray-500">
              Choosing people for{' '}
              <span className="text-primary text-sm">{roleDisplayName(roleName)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-900 cursor-pointer"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-gray-700 font-semibold text-sm">
            <Checkbox checked={isAllChecked} onCheckedChange={handleSelectAll} />
            <span>
              Select All ({allVisibleUserIds?.length || 0}
              {hasNextPage ? ' loaded' : ''})
            </span>
          </div>
          <div className="w-[260px]">
            <Input
              placeholder="Search people..."
              className="pl-10"
              IconPosition="left-0 pl-3 inset-y-0"
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                if (value.startsWith(' ')) return;
                setSearch(value);
              }}
              Icon={<SearchLine className="text-gray-500" />}
            />
          </div>
        </div>

        <div className="max-h-[calc(100vh-300px)] overflow-y-auto p-3 flex flex-col gap-1.5">
          {isLoading ? (
            <div className="w-full min-h-[150px] flex items-center justify-center">
              <Loader variant="blue" />
            </div>
          ) : filteredUsers?.length > 0 ? (
            filteredUsers?.map((item: any) => {
              const currentRoleName = getCurrentRoleName(item);
              const isCurrentRoleAdmin = isAdminRole(currentRoleName);
              const fullName =
                `${item?.first_name || ''}${item?.last_name ? ` ${item?.last_name}` : ''}`.trim() ||
                item?.email;
              const alreadyInRole = !isCurrentRoleAdmin && alreadyAssignedIds.has(item?.uuid);
              const isSelected = alreadyInRole || selectedUserIds.includes(item?.uuid);
              const isDisabled = isCurrentRoleAdmin || alreadyInRole;

              return (
                <div
                  key={item?.uuid}
                  className={`w-full rounded-xl px-2 text-sm py-1 flex items-center justify-between border border-transparent ${
                    isDisabled
                      ? 'opacity-60 cursor-not-allowed'
                      : isSelected
                        ? 'bg-gray-50'
                        : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={isSelected}
                      disabled={isDisabled}
                      onCheckedChange={() => handleToggleUser(item?.uuid, isDisabled)}
                    />
                    <CustomAvatar name={fullName} size="36" showPresence={false} />
                    <div className="flex flex-col">
                      <p className="text-gray-900 font-semibold text-md leading-tight">
                        {fullName}
                      </p>
                      <p className="text-xs text-gray-500">Ext : {item?.extension || '--'}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-gray-400 font-semibold">
                      Current Role
                    </p>
                    <span
                      className={`uppercase tracking-[0.08em] text-[11px] font-semibold px-2.5 py-1 rounded-md border ${getRoleBadgeClass(currentRoleName)}`}
                    >
                      {roleDisplayName(currentRoleName)}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="w-full min-h-[180px] flex items-center justify-center text-sm text-gray-500">
              No people found.
            </div>
          )}

          {!isLoading && hasNextPage ? (
            <div ref={loadMoreRef} className="w-full flex items-center justify-center py-3">
              {isFetchingNextPage ? (
                <Loader variant="blue" size="sm" />
              ) : (
                <Button type="button" variant="transparent" onClick={() => fetchNextPage()}>
                  Load more
                </Button>
              )}
            </div>
          ) : null}
        </div>

        <div className="border-t border-gray-200 bg-gray-50 px-6 text-sm py-4 flex items-center justify-between rounded-b-lg">
          <p className="text-gray-600 font-medium">
            <span className="text-gray-900">{selectedUserIds.length}</span>{' '}
            {selectedUserIds.length === 1 ? 'person' : 'people'} selected
          </p>
          <div className="flex items-center gap-4">
            <Button type="button" variant="transparent" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleAssign}
              disabled={isAssignPending || selectedUserIds?.length === 0}
            >
              {isAssignPending ? <Loader variant="white" size="sm" /> : 'Assign'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AssignUsersModal;
