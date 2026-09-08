import { Plus, SearchLine } from '@/assets/icons';
import SetupGuide from '@/components/mcm/setup-guide';
import TableManager from '@/components/custom/table-manager';
import { Button } from '@/components/ui/button';
import {
  deleteMember,
  getUserList,
  pendingInvites,
  removeAssignNumber,
  resendInvite,
} from '@/services/api';
import { FC, useState } from 'react';
import AddUsers from './add-users';
import { IUSERS } from '@/interfaces/extension-interface';
import { ColumnDef } from '@tanstack/react-table';
import UpdateForwarding from './update-forwarding';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { capitalizeFirstLetter, handleAlert } from '@/lib/utils';
import AlertConfirm from '@/components/custom/alert-confirm';
import { useUser } from '@/hooks/use-user';
import CustomAvatar from '@/components/custom/custom-avatar';
import NumberWithFlag from '@/components/custom/number-with-flag';
import SideDrawer from '@/components/custom/side-drawer';
import { Icon, IconName } from '@/assets/icons/icon';
import { useNavigate } from 'react-router-dom';
import CustomTooltip from '@/components/custom/custom-tooltip';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import useDebounce from '@/hooks/use-debounce';
import { useCompanyFeatures } from '@/hooks/rbac';
import { Picker } from '@/components/mcm/picker';

import { useSocketEvents } from '@/hooks/use-socket-events';
import {
  PRESENCE_OPTIONS,
  presenceValueOf,
  useMyPresenceControl,
} from '@/hooks/use-presence-control';
import { getAgentLiveState } from '@/pages/performance/agent-rows';
import AssignCallerIdModal from './add-users/assign-caller-id-modal';
import RoleChangeModal from './role-change-modal';
import MultipleAssignNumber from './add-users/multiple-assign-number';
import { invalidateNumberLists } from '@/lib/number-list-cache';
import { useDialpad } from '@/hooks/use-dialpad';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import { ListX, Send } from 'lucide-react';

const UsersExtension: FC = () => {
  const [open, setOpen] = useState(false);
  const { makeCall, sessions } = useDialpad();

  const iamOnCall = Object.values(sessions || {}).some((session: any) => {
    const status = String(session?.status || '').toLowerCase();
    return ['ringing', 'connecting', 'confirmed', 'calling'].includes(status);
  });
  const [search, setSearch] = useState<string>('');
  const [showMultipleAssignModal, setShowMultipleAssignModal] = useState(false);
  const [multipleAssignUsers, setMultipleAssignUsers] = useState<any[]>([]);
  const debouncedSearch = useDebounce(search, 1000);
  const queryClient: any = useQueryClient();
  const { user, refetch: refetchUserApi } = useUser();
  const { ongoingLiveCalls, usersOnlineStatus, createNewChat, createPrivateChatId } =
    useSocketEvents();
  const { company_info } = user || {};
  const { features } = useCompanyFeatures();
  const { setMyPresence, isPending: isSettingPresence, myUuid } = useMyPresenceControl();
  const userAccess = features?.plan_features?.account_setting?.access?.USER?.action;
  const virtualNumbersAccess = features?.plan_features?.virtual_numbers?.action;
  const isPlanExpired = company_info?.plan_status === 'EXPIRED';
  const isTrial = company_info?.is_trial === 'Y';
  const requestedPlanInfo = user?.plan_info?.plan_requests || null;

  const [drawerState, setDrawerState] = useState<any>({
    addUser: false,
    updateForwarding: false,
    assignUser: false,
    removeAssignUser: false,
    changeRole: false,
  });
  const role =
    user?.user_info?.custom_role_data?.name ||
    user?.user_info?.role_data?.name ||
    user?.user_info?.role;
  const IS_ADMIN = role === 'ADMIN';
  const navigate = useNavigate();
  const [selectedUser, setSelectedUser] = useState<IUSERS | null>(null);

  const extension = user?.user_info?.extension;
  const isMeOnCall = usersOnlineStatus?.find((user) => user?.userId == extension)?.onCall;

  /* People who were sent an invite link and have not chosen a password yet.
     Comes from its own endpoint (the list itself does not carry status), so
     the "Resend invite" button only shows where it can do something. */
  const { data: pendingInvitesData } = useQuery({
    queryKey: ['pendingInvites'],
    queryFn: pendingInvites,
    enabled: Boolean(userAccess?.add),
    staleTime: 30 * 1000,
    retry: false,
  });
  const pendingInviteByUuid = new Map<string, { expired: boolean }>(
    (pendingInvitesData?.data?.data?.result?.pending || []).map((row: any) => [
      String(row?.user_uuid || ''),
      { expired: Boolean(row?.expired) },
    ]),
  );
  const { mutate: mutateResendInvite, isPending: isResendingInvite } = useMutation({
    mutationKey: ['resendInvite'],
    mutationFn: resendInvite,
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['pendingInvites'] });
      handleAlert({
        text:
          data?.data?.data?.message ||
          'We sent them a new link to choose a password. It works for 3 days.',
        type: 'success',
      });
    },
  });

  const { mutate: mutateDeleteUser, isPending } = useMutation({
    mutationKey: ['deleteMember'],
    mutationFn: deleteMember,
    onSuccess: ({ data }) => {
      refetchUserApi();

      queryClient.invalidateQueries({ queryKey: ['fetchUsersList'] });
      invalidateGlobalUsersDirectory(queryClient);
      handleAlert({
        text: data?.data?.message || 'User deleted successfully',
        type: 'success',
      });
      setOpen(false);
    },
  });

  const { mutate: mutateRemoveAssignDID, isPending: isPendingRemoveAssignDID } = useMutation({
    mutationFn: removeAssignNumber,
    onSuccess: (data: any) => {
      invalidateNumberLists(queryClient);
      handleAlert({
        text: data?.data?.data?.message || 'Assigned DID Removed Successfully.',
        type: 'success',
      });
      setDrawerState((prev: any) => ({
        ...prev,
        removeAssignUser: false,
        selectedDID: null,
      }));
      setSelectedUser(null);
    },
  });

  const columns: ColumnDef<IUSERS>[] = [
    {
      header: 'Name',
      accessorKey: 'first_name',
      cell: ({ row }) => {
        const data = row?.original;
        const fullName = `${data?.first_name}${data?.last_name ? ` ${data?.last_name}` : ''}`;
        const rowRole = data?.custom_role_data?.name || data?.role_data?.name || data?.role;
        const isRowAdmin = String(rowRole || '').toUpperCase() === 'ADMIN';
        return (
          <div className="flex items-center gap-2 w-full">
            <div className="flex ">
              <CustomAvatar
                name={fullName}
                showPresence
                extension={data?.extension}
                image={data?.profile}
              />
            </div>
            <div className="flex justify-between items-center  w-full">
              <div className="flex flex-col w-full justify-center">
                <div className="flex flex-col items-start ">
                  <p className="capitalize">{fullName}</p>
                  <span
                    className={`text-primary text-[10px] h-4 flex  ${IS_ADMIN && !isRowAdmin ? 'cursor-pointer hover:underline z-1' : 'z-50'} `}
                    onClick={() => {
                      if (!IS_ADMIN || isRowAdmin) return;
                      setSelectedUser(data);
                      openDrawer('changeRole');
                    }}
                  >
                    {rowRole}
                  </span>
                </div>

                <p className="text-gray-500  text-xs flex justify-between">
                  <div>{data?.email}</div>
                </p>
                {pendingInviteByUuid.has(data?.uuid) && (
                  <span
                    className={`mt-0.5 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      pendingInviteByUuid.get(data?.uuid)?.expired
                        ? 'bg-red-50 text-red-600'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {pendingInviteByUuid.get(data?.uuid)?.expired
                      ? 'Invite link expired'
                      : 'Invite sent, not accepted yet'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-2.5 py-1 min-w-[122px]">
                <div className="w-7 h-7 rounded-lg border border-primary/30 bg-white flex items-center justify-center text-primary text-base font-semibold leading-none">
                  #
                </div>
                <div className="flex flex-col gap-1 leading-tight">
                  <span className="text-[9px] font-semibold tracking-[0.08em] text-gray-500 uppercase">
                    Extension
                  </span>
                  <span className="text-gray-900 text-xs font-semibold leading-none">
                    {data?.extension}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      },
    },
    // {
    //   header: 'Phone',
    //   accessorKey: 'phone',
    //   cell: ({ getValue }) => <NumberWithFlag number={getValue()} />,
    // },
    {
      /* Two people called Sam Patel are indistinguishable in this list. The
         reference product leads with the email address for exactly that reason,
         and the row already carries it — it was fetched and thrown away. */
      header: 'Email',
      accessorKey: 'email',
      cell: ({ row }: any) => (
        <span className="text-gray-600">{row?.original?.email || '—'}</span>
      ),
    },
    {
      header: 'Caller Id',
      accessorKey: 'caller_id',
      cell: ({ getValue, row }) => {
        const data: any = row?.original || {};
        if (!getValue()) {
          return (
            <p
              className="text-primary cursor-pointer"
              onClick={() => {
                openDrawer('assignUser');
                setSelectedUser({ ...data, user_uuid: data?.user_uuid || data?.uuid });
              }}
            >
              Assign Caller Id
            </p>
          );
        }

        return <NumberWithFlag number={getValue()} />;
      },
    },
    {
      header: 'Location',
      accessorKey: 'site',
      cell: ({ row }) => row?.original?.site?.name || '---',
    },
    {
      header: 'Availability',
      accessorKey: 'availability',
      /* Same rule as Directory: the live state is shown for everyone, but only
         your own row carries a control. Availability is yours to set. */
      cell: ({ row }) => {
        const person = row?.original as any;
        const live = getAgentLiveState(person?.extension, usersOnlineStatus, []);

        if (person?.uuid !== myUuid) {
          return <span className="text-gray-500 text-xs">{live.status}</span>;
        }

        const rules =
          typeof person?.call_forwarding === 'string'
            ? (() => {
                try {
                  return JSON.parse(person.call_forwarding);
                } catch {
                  return null;
                }
              })()
            : person?.call_forwarding;

        return (
          <span onClick={(event) => event.stopPropagation()}>
            <Picker
              label="Set my availability"
              showLabel={false}
              className="mcm-presence-admin"
              disabled={isSettingPresence}
              value={presenceValueOf(rules?.status)}
              options={PRESENCE_OPTIONS.map((option) => ({
                label: String(option.label),
                value: String(option.value),
              }))}
              onChange={(option) => setMyPresence(option.value)}
            />
          </span>
        );
      },
    },
    {
      header: 'Actions',
      accessorKey: 'action',
      cell: ({ row }) => {
        const data = row?.original;
        const isLoggedInUsers = user?.uuid === row?.original?.uuid;
        const isSelf = user?.uuid === data?.uuid;
        const IS_ADMIN = user?.user_info?.role === 'ADMIN';
        const isOnCall =
          ongoingLiveCalls?.[`${data?.extension}`]?.['State'] === 'confirmed' ||
          ongoingLiveCalls?.[`${data?.extension}_hw`]?.['State'] === 'confirmed' ||
          ongoingLiveCalls?.[`${data?.extension}_web`]?.['State'] === 'confirmed'
            ? true
            : false;
        const actions = [
          role === 'ADMIN' && {
            icon: 'ActivityIcon',
            onClick: () => navigate(`/activity/${data?.uuid}`),
            className: 'bg-ucass-primary-200 text-primary hover:bg-primary hover:text-white',
            tooltipText: 'Activity',
            // access: isSelf,
          },
          userAccess?.is_call && {
            icon: 'PhoneIcon',
            onClick: () => makeCall(`${data?.extension}`),
            className: 'bg-green-100 text-green-500 hover:bg-green-500 hover:text-white',
            tooltipText: 'Call',
            access: isSelf || isMeOnCall || iamOnCall,
          },
          virtualNumbersAccess?.assign_number && {
            icon: 'PlusIcon',
            onClick: () => {
              openDrawer('assignUser');
              setSelectedUser({ ...data, user_uuid: data?.user_uuid || data?.uuid });
            },
            className: 'bg-gray-100 text-gray-900/80   hover:bg-primary hover:text-white',
            tooltipText: 'Assign Caller ID',
            access: isOnCall,
          },
          userAccess?.is_chat && {
            icon: 'MessageIcon',
            onClick: () => {
              createNewChat({ ...data });
              navigate(
                `/messenger?channel=chat&type=all&chatId=${createPrivateChatId([user?.uuid, data?.uuid])}&exact=true`,
              );
            },
            className: 'bg-gray-100 text-gray-900/80 hover:bg-primary hover:text-white',
            tooltipText: 'Chat',
            access: isSelf,
          },
          IS_ADMIN &&
            userAccess?.edit && {
              icon: 'EditStrokIcon',
              onClick: () => {
                openDrawer('updateForwarding');
                setSelectedUser(data);
              },
              className: 'bg-gray-100 text-gray-900/80 hover:bg-primary hover:text-white',
              tooltipText: 'Edit',
              access: isOnCall,
            },
          /* Only for people who have not chosen a password yet. */
          userAccess?.add &&
            pendingInviteByUuid.has(data?.uuid) && {
              tooltipText: 'Resend invite',
              customIcon: Send,
              iconClass: 'w-4 h-4',
              className: 'bg-amber-100 text-amber-700 hover:bg-amber-600 hover:text-white',
              onClick: () => mutateResendInvite({ user_uuid: data?.uuid }),
              access: isResendingInvite,
            },
          userAccess?.delete &&
            (user?.user_info?.role === 'ADMIN' || data?.role !== 'ADMIN') && {
              icon: 'TrashBin',
              onClick: () => {
                setOpen(true);
                setSelectedUser(data);
              },
              className: 'bg-red-100 text-red-500 hover:bg-red-500 hover:text-white',
              tooltipText: 'Delete',
              access: isLoggedInUsers || isOnCall,
            },

          virtualNumbersAccess?.assign_number && {
            tooltipText: 'Remove Assignment',
            customIcon: ListX,
            iconClass: 'w-5 h-5',
            className: 'bg-red-100 text-red-500 hover:bg-red-500 hover:text-white',
            onClick: () => {
              openDrawer('removeAssignUser');
              setSelectedUser(data);
            },
            access: !data?.caller_id || isOnCall,
          },
        ].filter(Boolean);

        if (!actions?.length) return '---';

        return (
          <div className="flex items-center gap-2">
            {actions?.map((action, index) => {
              const CustomActionIcon = action.customIcon;
              return (
                <CustomTooltip text={action.tooltipText} side="top">
                  <div
                    key={index}
                    className={`${action.access ? 'cursor-not-allowed bg-gray-100 text-gray-900/80' : `cursor-pointer ${action.className}`} flex items-center justify-center rounded-full w-8 h-8`}
                    onClick={() => {
                      if (!action.access) {
                        action.onClick();
                      }
                    }}
                  >
                    {CustomActionIcon ? (
                      <CustomActionIcon
                        className={`${action.iconClass || 'w-4 h-4'} ${action.access ? 'text-gray-400' : ''}`}
                      />
                    ) : (
                      <Icon
                        name={action.icon as IconName}
                        className={`${action.iconClass || 'w-4 h-4'} ${action.access ? 'text-gray-400' : ''}`}
                      />
                    )}
                  </div>
                </CustomTooltip>
              );
            })}
          </div>
        );
      },
      meta: {
        textAlign: 'center',
      },
    },
  ];

  const openDrawer = (key: keyof typeof drawerState) => {
    setDrawerState((prev: any) => ({ ...prev, [key]: true }));
  };

  const handleAddUsers = () => {
    if (isPlanExpired) {
      handleAlert({
        text: 'You cannot add users until your subscription is renewed.',
        type: 'error',
      });
      return;
    }

    if (isTrial) {
      handleAlert({
        text: 'This feature is not available in your current plan. Please upgrade',
        type: 'error',
      });
      return;
    }

    openDrawer('addUser');
  };

  return (
    <>
      <section className="w-full overflow-x-auto overflow-y-hidden">
        {/* The same guide as Company & Locations, so the thread carries through
            the sections rather than stopping at the first screen. It hides itself
            once setup is finished. */}
        <div className="px-3 pt-3">
          <SetupGuide companyInfo={user?.company_info} />
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-between p-3 border-b border-gray-200 min-h-[65px] bg-white">
          <p className="text-gray-900 font-semibold text-lg flex items-center gap-1">
            Users
            <div className="-rotate-90 text-gray-800">
              <Icon name="ChevronIcon" className="w-5 h-5" />
            </div>
            <span className="text-primary text-md">Extension</span>
          </p>
          <div className="flex gap-2 filters">
            <Input
              placeholder="Search"
              className="pl-10 w-full min-h-9 rounded-lg"
              IconPosition="left-0 pl-2 inset-y-0"
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                if (value.startsWith(' ')) return;
                setSearch(e.target.value);
              }}
              Icon={<SearchLine className=" text-gray-700" />}
            />
            {!isTrial && userAccess?.add && (
              <Button
                className=" min-h-9"
                type="button"
                variant={'outline'}
                onClick={() => {
                  if (requestedPlanInfo?.action_type == 'DOWNGRADE') {
                    handleAlert({
                      text: 'Please revoke your plan downgrade request to add users.',
                      type: 'error',
                    });
                    return;
                  } else {
                    handleAddUsers();
                  }
                }}
              >
                <Plus className="w-3 h-3" />
                Add Users
              </Button>
            )}
          </div>
        </div>
        {/* <div className="flex items-center w-full px-3 h-16 gap-2 bg-gray-100 rounded-xl border border-gray-200">
            <div className="flex justify-end w-full">
              <Input
                placeholder="Search"
                className="pl-10 w-1/3"
                IconPosition="left-0 pl-2 inset-y-0"
                value={search}
                onChange={(e) => setSearch(e.target.value.trim())}
                Icon={<SearchLine className=" text-gray-700" />}
              />
              {userAccess?.add && <Button type="button" variant={'outline'} onClick={() => handleAddUsers()}>
                <Plus className="w-3 h-3" />
                Add Users
              </Button>}
            </div>
          </div> */}
        <div className="w-full  p-3 flex flex-col gap-2">
          <p className="text-gray-900 text-sm">
            Each additional user requires a separate monthly subscription. Your monthly total will
            increase based on the features and services assigned to this new user.
          </p>
          <TableManager
            {...{
              emptyTablePlaceholder: 'Nobody here yet',
              descriptionEmptyTable:
                'Add the people who will make and take calls. Each one gets an extension and their own settings.',
              columns,
              fetcherKey: 'fetchUsersList',
              fetcherFn: getUserList,
              search: debouncedSearch,
              // extraParams: {
              //   filter: [{ key: 'first_name', value: debouncedSearch }],
              // },
            }}
          />
        </div>
      </section>
      {drawerState.addUser && (
        <SideDrawer
          isOpen={drawerState.addUser}
          title="Add Users"
          isTab={false}
          handleClose={() => setDrawerState({ addUser: false })}
          content={
            <AddUsers
              setDrawerState={(val) => setDrawerState((prev: any) => ({ ...prev, addUser: val }))}
            />
          }
        />
      )}

      {drawerState.updateForwarding && (
        <SideDrawer
          isOpen={drawerState.updateForwarding}
          title={`Update Forwarding (${capitalizeFirstLetter(selectedUser?.first_name || '')} ${selectedUser?.last_name || ''})`}
          isTab={false}
          handleClose={() => setDrawerState({ updateForwarding: false })}
          content={
            <UpdateForwarding
              drawerState={drawerState.updateForwarding}
              setDrawerState={(val) =>
                setDrawerState((prev: any) => ({ ...prev, updateForwarding: val }))
              }
              data={selectedUser}
            />
          }
        />
      )}

      <AssignCallerIdModal
        open={drawerState.assignUser}
        userData={selectedUser}
        onOpenMultipleAssignModal={(users) => {
          setMultipleAssignUsers(users || []);
          setShowMultipleAssignModal(true);
        }}
        onClose={() => {
          setDrawerState((prev: any) => ({ ...prev, assignUser: false }));
          setSelectedUser(null);
        }}
      />

      {showMultipleAssignModal && (
        <Dialog
          open={showMultipleAssignModal}
          onOpenChange={(val) => {
            setShowMultipleAssignModal(val);
            if (!val) {
              setMultipleAssignUsers([]);
            }
          }}
        >
          <DialogContent
            className="md:w-3/6 p-3 max-h-[99%] overflow-y-auto"
            showCloseButton={false}
          >
            <MultipleAssignNumber
              users={multipleAssignUsers}
              handleClose={() => {
                setShowMultipleAssignModal(false);
                setMultipleAssignUsers([]);
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      <RoleChangeModal
        open={drawerState.changeRole}
        userData={selectedUser}
        setOpen={(val) => {
          setDrawerState((prev: any) => ({ ...prev, changeRole: val }));
          if (!val) setSelectedUser(null);
        }}
      />

      <AlertConfirm
        {...{
          apiLoading: isPendingRemoveAssignDID,
          onConfirm: () => {
            mutateRemoveAssignDID({
              did_number: selectedUser?.caller_id,
            });
          },
          open: drawerState?.removeAssignUser,
          setOpen: () => {
            setDrawerState((prev: any) => ({
              ...prev,
              removeAssignUser: false,
            }));
          },
          descriptionTextComp:
            'Are you sure you want to remove the assignment of this DID number? ',
        }}
        headerText="Remove DID Assignment"
      />

      <AlertConfirm
        {...{
          apiLoading: isPending,
          onConfirm: () => {
            mutateDeleteUser(selectedUser?.uuid);
          },
          open,
          setOpen,
          headerText: 'Delete Confirmation',
          descriptionTextComp: 'Are you sure, you want to delete this user?',
        }}
      />
    </>
  );
};

export default UsersExtension;
