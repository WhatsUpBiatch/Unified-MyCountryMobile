import { Button } from '@/components/ui/button';
import { useUser } from '@/hooks/use-user';
import { handleAlert, capitalizeFirstLetter } from '@/lib/utils';
import { deviceSecurityList, logout } from '@/services/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LucideMonitor, LucideShieldCheck, LucideTablet, LogOut } from 'lucide-react';
import CustomAvatar from '@/components/custom/custom-avatar';
import Loader from '@/components/custom/loader';
import { Input } from '@/components/ui/input';
import { SearchLine } from '@/assets/icons';
import { useState, useMemo } from 'react';
import useDebounce from '@/hooks/use-debounce';
import ChangePassword from '@/pages/change-password';
import { KeyRound } from 'lucide-react';
import TrustedDevices from './trusted-devices';

const Security = () => {
  const { user } = useUser();
  const [search, setSearch] = useState('');
  const [selectedUserExtension, setSelectedUserExtension] = useState<string>('');
  /* The change-password dialog was written and then never mounted anywhere, so
     there has been no way to change a password from inside the console. */
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const debouncedSearch = useDebounce(search || '', 1000);

  const {
    data: loggedInUsers = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['deviceSecurityList', debouncedSearch, selectedUserExtension],
    queryFn: () =>
      deviceSecurityList({
        search: debouncedSearch,
        filter: selectedUserExtension ? [{ key: 'extension', value: [selectedUserExtension] }] : [],
      }),
    select: (data) => {
      const result = data?.data?.data?.result || [];
      // Sort to show current device first
      return result.sort((a: any, b: any) => {
        if (user?.device_token === a?.uuid) return -1;
        if (user?.device_token === b?.uuid) return 1;
        return 0;
      });
    },
  });

  /* This page is titled "your password, and every device signed in as you", and
     that is what it should show.

     It used to say the server did not check who you were targeting. That is no
     longer true, and the note is kept accurate on purpose: the three server-side
     gaps behind it are all closed and live as of 29 August 2026.
       - logout() gives a non-privileged caller `undefined` for the target, so it
         falls back to their own uuid, and the payload cannot smuggle one past it.
       - getDeviceSecurities scopes to the caller's company, and to the caller's
         own uuid unless they are an ADMIN.
       - logOutUser now refuses a target outside the admin's own company.

     The filter below stays regardless. Ending someone else's session is an
     administrative act and belongs on an admin screen, not on a page about your
     own account — so this page shows you your own devices whatever your role. */
  const currentUserUuid = `${user?.uuid || user?.user_info?.uuid || ''}`.trim();

  const ownDevices = useMemo(
    () =>
      currentUserUuid
        ? loggedInUsers.filter((item: any) => `${item?.user_uuid || ''}`.trim() === currentUserUuid)
        : loggedInUsers,
    [loggedInUsers, currentUserUuid],
  );

  const { mutate: logoutMutate } = useMutation({
    mutationFn: logout,
    onSuccess: (data) => {
      handleAlert({ text: data?.data?.data?.message, type: 'success' });
      setSelectedUserExtension('');

      refetch();
    },
  });

  const logoutDevice = (type: string = 'single', item: any) => {
    const payload = {
      type,
      device_securities: item?.uuid ? [item?.uuid] : [],
      user_uuid: item?.user_uuid || currentUserUuid,
    };
    logoutMutate(payload);
  };

  const handleLogoutAll = () => {
    if (!currentUserUuid) return;
    logoutDevice('all', { user_uuid: currentUserUuid });
  };

  const handleLogoutExcept = () => {
    if (!currentUserUuid) return;
    logoutDevice('except_himself', { user_uuid: currentUserUuid });
  };

  return (
    <section
      /* The page scrolls here. It used to be `overflow-y-hidden`, which clipped
        everything below the fold with no way to reach it. The sticky footer is
        `position: sticky; bottom: 0`, so it pins to this container rather than
        scrolling away with the content. */
      className="flex h-full min-h-0 w-full flex-col overflow-x-auto overflow-y-auto bg-gray-200/15"
    >
      <div className="flex items-center justify-between p-3 border-b border-gray-200 min-h-[65px] bg-white">
        <div>
          <p className="text-gray-900 font-semibold text-lg">Security & Privacy</p>
          <p className="text-gray-500 text-xs">
            Your password, and every device currently signed in as you.
          </p>
        </div>
      </div>
      <div className="gap-3 flex flex-col w-full min-h-full p-3">
        <div className="flex sm:flex-row flex-col sm:items-center justify-between gap-4 bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex flex-col gap-1 sm:w-1/2 w-full">
            <p className="flex items-center gap-2 text-gray-900 font-semibold text-sm">
              <KeyRound className="h-4 w-4 text-primary" />
              Password
            </p>
            {/* The server signs out every session, this one included, the moment
                the password changes (changePassword calls logOutUser with
                type "all"), and the same password is what the phone app
                registers with. Both are said here so nobody is surprised by a
                sign-in screen or a phone that stops ringing. */}
            <p className="text-gray-500 text-xs">
              Change the password you sign in with. You will need your current one. Saving a new
              password signs you out everywhere, including this device, and your phone app will need
              the new password too.
            </p>
          </div>
          <Button variant="outline" onClick={() => setIsChangePasswordOpen(true)}>
            Change password
          </Button>
        </div>
        {/* Two-step sign-in status and the devices allowed to skip the code.
            Own account only; reads and revokes through /api/security/devices. */}
        <TrustedDevices />
        <div className="flex sm:flex-row flex-col items-center justify-between gap-4 bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex flex-col gap-1 sm:w-1/2 w-full">
            <p className="text-gray-900 font-semibold text-sm">Sign out everywhere</p>
            <p className="text-gray-500 text-xs">
              Ends every session signed in as you &mdash; useful if you have lost a phone or used a
              shared computer.
            </p>
          </div>
          <div className="flex items-center gap-3 sm:flex-row flex-col sm:w-auto w-full">
            <Button
              variant="destructiveOutline"
              onClick={handleLogoutExcept}
              disabled={!currentUserUuid}
              className="whitespace-nowrap transition-all duration-200"
            >
              <LogOut className="w-4 h-4" />
              Sign out my other devices
            </Button>
            <Button
              variant="destructiveOutline"
              onClick={handleLogoutAll}
              disabled={!currentUserUuid}
              className="whitespace-nowrap transition-all duration-200"
            >
              <LogOut className="w-4 h-4" />
              Sign out everywhere
            </Button>
          </div>
        </div>
        <div className="w-full flex sm:flex-row flex-col items-center justify-between gap-5">
          <p className="text-gray-800 text-sm">
            These are sessions from devices and browsers that are successfully signed into your
            account. You can sign out of any session you don't recognize or that's from a public
            computer.
          </p>
          <div className="flex items-end sm:w-auto w-full">
            <Input
              placeholder="Search"
              className="max-w-64  pl-10"
              IconPosition="left-0 pl-2 inset-y-0"
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                if (value.startsWith(' ')) return;
                setSearch(e.target.value);
              }}
              Icon={<SearchLine className="text-gray-700" />}
            />
          </div>
        </div>
        <div className="gap-3 flex flex-col w-full pr-1">
          {isLoading ? (
            <div className="flex justify-center h-full items-center">
              <Loader variant="blue" />
            </div>
          ) : (
            ownDevices &&
            ownDevices?.map((item: any) => {
              return (
                <div
                  className="border cursor-pointer p-3 flex sm:flex-row flex-col  gap-2 rounded-lg sm:justify-between bg-white  
                  "
                >
                  <div className="flex sm:items-center xs:justify-start xs:items-start gap-3 w-full">
                    <div className="flex flex-col items-center  gap-2">
                      <CustomAvatar
                        name={
                          `${item?.user_detail?.first_name || ''} ${item?.user_detail?.last_name || ''}`.trim() ||
                          'Unknown User'
                        }
                        showPresence={true}
                        size="40"
                        image={item?.user_detail?.profile}
                        extension={item?.user_detail?.extension}
                      />
                      <span className="w-8 min-w-8 h-8 rounded-sm bg-ucass-primary-200 text-primary p-1.5 flex items-center justify-center">
                        {item?.device_type === 'W' ? (
                          <LucideMonitor className="w-4 h-4" />
                        ) : (
                          <LucideTablet className="w-4 h-4" />
                        )}
                      </span>
                    </div>
                    <div className="flex flex-col w-full gap-1">
                      <div className="flex flex-col items-start">
                        <p className="text-gray-900 font-medium text-sm">
                          {capitalizeFirstLetter(
                            `${item?.user_detail?.first_name || ''} ${item?.user_detail?.last_name || ''}`.trim(),
                          ) || 'Unknown User'}
                        </p>
                        <p className="text-gray-500 text-xs">{item?.user_detail?.email || ''}</p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <p className="text-gray-600 text-xs">User Agent: {item?.user_agent}</p>
                        <p className="text-gray-600 text-xs">IP Address: {item?.ip_address}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center">
                    {user?.device_token === item?.uuid ? (
                      <div className="inline-flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg whitespace-nowrap">
                        <LucideShieldCheck className="text-green-600 w-4 h-4" />
                        <span className="text-green-700 text-sm font-medium">Current Device</span>
                      </div>
                    ) : (
                      <Button
                        variant={'outline'}
                        onClick={() => logoutDevice('single', item)}
                        className="flex items-center justify-center"
                      >
                        Logout
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <ChangePassword modalState={isChangePasswordOpen} setModalState={setIsChangePasswordOpen} />
    </section>
  );
};

export default Security;
