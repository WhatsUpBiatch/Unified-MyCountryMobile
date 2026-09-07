import { Button } from '@/components/ui/button';
import { useUser } from '@/hooks/use-user';
import { handleAlert } from '@/lib/utils';
import { deviceSecurityList, logout } from '@/services/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LucideMonitor, LucideShieldCheck, LucideTablet, LogOut } from 'lucide-react';
import Loader from '@/components/custom/loader';
import { SearchLine } from '@/assets/icons';
import { useState, useMemo } from 'react';
import '@/components/mcm/mcm-page.css';
import useDebounce from '@/hooks/use-debounce';
import ChangePassword from '@/pages/change-password';
import { KeyRound } from 'lucide-react';
import TrustedDevices from './trusted-devices';


/* A user-agent string, said the way a person would say it.

   These rows exist so somebody can recognise a session or fail to. A 130-
   character UA string is not something anybody recognises, so the browser and
   the machine are pulled to the front and the raw string kept underneath for
   when the summary is not enough.

   Deliberately simple: substring tests in the order that resolves the
   ambiguities (Edge and Opera both say "Chrome"; Chrome says "Safari"), and no
   library for four lines of matching. Anything it cannot place keeps the raw
   string, which is the honest fallback — a wrong guess about which device is
   yours is worse on this page than no guess. */
const describeClient = (ua?: string): { label: string } => {
  const value = String(ua || '');
  if (!value) return { label: 'Unknown device' };

  /* The phone app names itself, so it never has to be inferred. */
  if (/MyCountryMobile/i.test(value)) {
    const os = /iPhone|iOS/i.test(value) ? 'iPhone' : /Android/i.test(value) ? 'Android' : 'mobile';
    return { label: `Phone app on ${os}` };
  }

  const browser = /Edg\//i.test(value)
    ? 'Edge'
    : /OPR\//i.test(value)
      ? 'Opera'
      : /Chrome\//i.test(value)
        ? 'Chrome'
        : /Firefox\//i.test(value)
          ? 'Firefox'
          : /Safari\//i.test(value)
            ? 'Safari'
            : '';

  const os = /Windows/i.test(value)
    ? 'Windows'
    : /Mac OS X|Macintosh/i.test(value)
      ? 'macOS'
      : /Android/i.test(value)
        ? 'Android'
        : /iPhone|iPad|iOS/i.test(value)
          ? 'iOS'
          : /Linux/i.test(value)
            ? 'Linux'
            : '';

  if (browser && os) return { label: `${browser} on ${os}` };
  if (browser) return { label: browser };
  if (os) return { label: os };
  return { label: value };
};

/* How long ago, in words. */
const timeAgo = (iso: string): string => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
};

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
    <section className="mcm-adminpage mcm-sec">
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">My account</div>
          <h1>Security &amp; Privacy</h1>
          <p>Your password, and every device currently signed in as you.</p>
        </div>
      </div>

      <div className="mcm-sec-body">
        <div className="mcm-setrow">
          <div className="mcm-setrow-t">
            <span className="mcm-setrow-mark" aria-hidden="true">
              <KeyRound size={15} strokeWidth={2} />
            </span>
            <div>
              <b>Password</b>
              {/* The server signs out every session, this one included, the moment
                  the password changes (changePassword calls logOutUser with
                  type "all"), and the same password is what the phone app
                  registers with. Both are said here so nobody is surprised by a
                  sign-in screen or a phone that stops ringing. */}
              <p>
                Change the password you sign in with. You will need your current one. Saving a new
                password signs you out everywhere, including this device, and your phone app will
                need the new password too.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => setIsChangePasswordOpen(true)}>
            Change password
          </Button>
        </div>

        {/* Two-step sign-in status and the devices allowed to skip the code.
            Own account only; reads and revokes through /api/security/devices. */}
        <TrustedDevices />

        <div className="mcm-setrow is-risky">
          <div className="mcm-setrow-t">
            <span className="mcm-setrow-mark is-risky" aria-hidden="true">
              <LogOut size={15} strokeWidth={2} />
            </span>
            <div>
              <b>Sign out everywhere</b>
              <p>
                Ends every session signed in as you &mdash; useful if you have lost a phone or used
                a shared computer.
              </p>
            </div>
          </div>
          <div className="mcm-sec-acts">
            <Button
              variant="destructiveOutline"
              onClick={handleLogoutExcept}
              disabled={!currentUserUuid}
            >
              <LogOut className="w-4 h-4" />
              Other devices only
            </Button>
            <Button
              variant="destructiveOutline"
              onClick={handleLogoutAll}
              disabled={!currentUserUuid}
            >
              <LogOut className="w-4 h-4" />
              Everywhere
            </Button>
          </div>
        </div>

        <section className="mcm-sec-sessions">
          <div className="mcm-sec-sessh">
            <div>
              <h2>
                Signed in
                <span>{ownDevices?.length || 0}</span>
              </h2>
              <p>
                Every device and browser signed into your account. Sign out of anything you do not
                recognise, or anything on a shared computer.
              </p>
            </div>
            <div className="mcm-faq-search">
              <SearchLine className="size-4" />
              <input
                type="text"
                placeholder="Search sessions"
                aria-label="Search sessions"
                value={search}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.startsWith(' ')) return;
                  setSearch(e.target.value);
                }}
              />
            </div>
          </div>

          {isLoading ? (
            <div className="mcm-sec-blank">
              <Loader variant="blue" />
            </div>
          ) : !ownDevices?.length ? (
            <div className="mcm-sec-blank">
              {search ? `No session matches “${search}”.` : 'No other sessions are signed in.'}
            </div>
          ) : (
            <ul className="mcm-sec-list">
              {ownDevices.map((item: any) => {
                const isCurrent = user?.device_token === item?.uuid;
                const client = describeClient(item?.user_agent);
                return (
                  <li className={`mcm-sec-row ${isCurrent ? 'is-current' : ''}`} key={item?.uuid}>
                    <span className="mcm-sec-mark" aria-hidden="true">
                      {item?.device_type === 'W' ? (
                        <LucideMonitor className="w-4 h-4" />
                      ) : (
                        <LucideTablet className="w-4 h-4" />
                      )}
                    </span>

                    <div className="mcm-sec-main">
                      <div className="mcm-sec-t">
                        {/* The name and browser, not the raw user-agent. Every
                            row on this page belongs to the same person, so the
                            avatar, name and email that used to lead each one
                            were identical four times over and pushed the only
                            things that differ — which machine, which browser,
                            which address — into small grey text. */}
                        <b>{client.label}</b>
                        {isCurrent ? (
                          <span className="mcm-sec-now">
                            <LucideShieldCheck className="w-3 h-3" />
                            This device
                          </span>
                        ) : null}
                      </div>
                      <div className="mcm-sec-meta">
                        <span>{item?.ip_address || 'Address unknown'}</span>
                        {item?.last_active_at ? (
                          <>
                            <i aria-hidden="true" />
                            <span>Last used {timeAgo(item.last_active_at)}</span>
                          </>
                        ) : null}
                      </div>
                      {/* Kept, because an unrecognised session is judged on the
                          detail — but as the small print it is, not the
                          headline it was. */}
                      <p className="mcm-sec-ua" title={item?.user_agent}>
                        {item?.user_agent}
                      </p>
                    </div>

                    {isCurrent ? null : (
                      <Button
                        variant={'outline'}
                        size="sm"
                        onClick={() => logoutDevice('single', item)}
                      >
                        Sign out
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <ChangePassword modalState={isChangePasswordOpen} setModalState={setIsChangePasswordOpen} />
    </section>
    );
};

export default Security;
