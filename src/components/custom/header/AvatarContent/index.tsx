import { useUser } from '@/hooks/use-user';
import { useState } from 'react';
import { Icon } from '@/assets/icons/icon';
import { useNavigate } from 'react-router-dom';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useMyPresence } from '@/hooks/use-my-presence';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { presenceStatusArray, statusImageLookup } from '../constants';
import CustomAvatar from '../../custom-avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import packageJson from '../../../../../package.json';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logout, updateMemberForwading, userUpdateStatus } from '@/services/api';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import { getRoutePrefetchHandlers } from '@/router/route-prefetch';
import { mergeCallForwarding } from '@/lib/call-forwarding-record';

const AvatarContent = ({ setProfileState }: any) => {
  const { user, handleRemoveUser } = useUser();
  const [showPresence, setShowPresence] = useState(false);
  const firstName = user?.user_info?.first_name || '';
  const lastName = user?.user_info?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const phone = user?.user_info?.phone ? String(user.user_info.phone) : '';
  const queryClient: any = useQueryClient();

  const { socketEventsManager, disconnectSocket } = useSocketEvents();
  const navigate = useNavigate();
  // Resolved in one place so the header chip and this menu always agree.
  const { status: effectiveSocketStatus } = useMyPresence();

  const { mutate: mutateUpdateMember } = useMutation({
    mutationFn: updateMemberForwading,
    onSuccess: () => {
      invalidateGlobalUsersDirectory(queryClient);
    },
  });

  function statusChangeEvent(status: string, timeObj: any = undefined) {
    socketEventsManager?.emit(
      'user-presence-update',
      {
        doc: {
          userId: user?.user_info?.extension,
          domain: user?.sip_credentials?.domain,
          uuid: user?.uuid,
          status: status,
          onCall: false,
          timeObj,
        },
      },
      (response: any) => {
        console.log('User-presence-update:', response);
      },
    );
  }

  const { mutate: mutateUserUpdateStatus } = useMutation({
    mutationFn: userUpdateStatus,
    onSuccess: (data, variables) => {
      console.log('data', data, variables);
      queryClient.invalidateQueries(['getUsersDetails']);
      statusChangeEvent(variables?.socket_status, {
        holiday_start_date: null,
        holiday_end_date: null,
      });
    },
  });

  const handleUserCallRules = (status: string) => {
    const userInfo = user?.user_info || {};
    /* Presence is the only key this menu owns. The rest of the record — the
       forwarding rules and the do-not-disturb flag — is carried through, so
       changing your availability does not delete it. */
    const callRuleRequest = mergeCallForwarding(user?.call_forwarding, { status });
    const rolePayloadKey = userInfo?.custom_role_uuid ? 'custom_role_uuid' : 'role_uuid';
    const payload = {
      first_name: userInfo?.first_name || '',
      last_name: userInfo?.last_name || '',
      job_title: userInfo?.job_title || '',
      caller_id: userInfo?.caller_id || '',
      site_uuid: userInfo?.site_uuid || '',
      profile: userInfo?.profile || '',
      [rolePayloadKey]: userInfo?.custom_role_uuid || userInfo?.role_uuid || null,
      call_forwarding: callRuleRequest,
      uuid: user?.uuid,
      userID: user?.uuid,
    };
    mutateUpdateMember(payload);
  };

  // const myStatus =
  //   usersOnlineStatus?.find((item: any) => item?.userId === user?.user_info?.extension)?.status ||
  //   'online';

  const handleStatusChange = async (status: string) => {
    if (effectiveSocketStatus === status) return;
    handleUserCallRules(status);
    mutateUserUpdateStatus({ socket_status: status });
    setShowPresence(false);
    setProfileState(false);
  };

  const { mutate: logoutMutate } = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Disconnect socket first to prevent any socket events from firing
      disconnectSocket();
      // Small delay to ensure socket cleanup completes before clearing user data
      setTimeout(() => {
        handleRemoveUser();
      }, 100);
    },
  });

  const logoutDevice = async () => {
    const payload = {
      type: 'single',
      device_securities: [user?.device_token],
      user_uuid: user?.uuid,
    };
    logoutMutate(payload);
  };
  return (
    <div className="flex flex-col gap-2 px-3  pb-2">
      <div className="flex flex-col gap-2 mt-2">
        <div className="flex gap-2 items-center justify-between edit-container">
          <div className="flex gap-2 text-gray-700 items-center text-sm w-full justify-center">
            <CustomAvatar
              name={fullName}
              size="80"
              extension={user?.user_info?.extension}
              image={user?.user_info?.profile}
              isActivityInfo={false}
            />
          </div>
        </div>
        <div className="flex gap-2 items-center justify-between edit-container">
          <div className="flex gap-2 text-gray-700 items-center text-sm">
            <Icon name="UserLine" className="w-4 h-4 " />
            <p className=" truncate max-w-50">{fullName}</p>
          </div>
        </div>
        <div className="flex gap-2 items-center text-gray-700 center text-sm">
          <Icon name="LetterLine" className="w-4 h-4 " />
          <span className="truncate max-w-50">{user?.user_info?.email || ''}</span>
        </div>
        <div className="flex gap-2 text-gray-700 items-center text-sm">
          <Icon name="Grid" className="w-4 h-4 " />
          <p className="truncate max-w-50">{user?.user_info?.extension}</p>
        </div>
        <div className="flex gap-2 items-center text-sm justify-between">
          <div className="flex gap-2 text-gray-700 items-center">
            <Icon name="PhoneLine" className="w-4 h-4 " />
            <p className="truncate max-w-50">
              {phone.startsWith('+') ? phone : phone ? `+${phone}` : ''}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator />

        <Popover open={showPresence} onOpenChange={(val) => setShowPresence(val)}>
          <PopoverTrigger>
            <span className="cursor-pointer flex gap-2 items-center">
              <div>{statusImageLookup[effectiveSocketStatus] ?? statusImageLookup['online']}</div>
              <div className="capitalize text-sm text-gray-700">
                {effectiveSocketStatus === 'dnd' ? 'DND' : effectiveSocketStatus}
              </div>
            </span>
          </PopoverTrigger>
          <PopoverContent className="p-1 flex flex-col gap-1" side="left" align="start">
            {presenceStatusArray.map((status) => {
              const isActive = effectiveSocketStatus === status?.value;
              return (
                <div
                  className={`flex items-center gap-2 w-full cursor-pointer px-2 rounded-md ${isActive ? 'bg-ucass-active-bg' : 'hover:bg-gray-200'}`}
                  onClick={() => handleStatusChange(status.value)}
                >
                  <div className="w-4 h-4">{statusImageLookup[status.value]}</div>
                  <div className="p-2 ">
                    <div className="text-sm">{status.title}</div>
                    <div className="text-xs">{status.description}</div>
                  </div>
                </div>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>

      <DropdownMenuSeparator />
      <div className="flex flex-col gap-2 mt-2">
        <div
          className="text-sm text-gray-700 cursor-pointer hover:text-primary"
          {...getRoutePrefetchHandlers('/admin-settings/account/basic-info')}
          onClick={() => {
            navigate('/admin-settings/account/basic-info');
            setProfileState(false);
          }}
        >
          My Profile
        </div>
        <div
          className="text-sm text-gray-700 cursor-pointer hover:text-primary"
          onClick={(val) => setProfileState(val ? 'changePassword' : null)}
        >
          Change Password
        </div>
        <button
          onClick={() => {
            logoutDevice();
          }}
          className="text-sm cursor-pointer text-red-700 flex justify-start"
        >
          Sign out
        </button>
        <DropdownMenuSeparator />
        <p className="text-xs text-gray-700 cursor-pointer text-right">v{packageJson.version}</p>
      </div>
    </div>
  );
};

export default AvatarContent;
