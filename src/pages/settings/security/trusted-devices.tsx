/* Two cards for Security & Privacy: "Two-step sign-in" and "Trusted devices".
 *
 * Two-step sign-in on this platform is a code emailed at sign-in, and the
 * server has no switch for it - it is on for everyone. The card says Active
 * and repeats the server's own one-line reason, so the screen and the login
 * path can never disagree about the rule.
 *
 * A trusted device is one that passed a code recently and was told to skip
 * it next time (the "Skip the code on this device" box on the sign-in form).
 * Trust lives in the server's OTP rows, not in the session list, which is why
 * these rows are not the same as the "signed in as you" sessions further down
 * the page. Revoke deletes the trust, so the next sign-in from that device
 * asks for a code again; for any device other than this one it also ends the
 * session.
 *
 * Three honest states while loading: "Checking..." until the server answers,
 * then the list, "No trusted devices", or - on a server without the endpoint -
 * a Coming soon note. Zero rows are never shown as a fact before the answer
 * arrives. */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LucideMonitor, LucideShieldCheck, LucideSmartphone, LogOut, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import Loader from '@/components/custom/loader';
import { useUser } from '@/hooks/use-user';
import { getDeviceId, handleAlert } from '@/lib/utils';
import { NotAppliedFlag, LiveFlag } from '@/pages/settings/not-applied-note';
import '@/components/mcm/mcm-page.css';

import {
  TRUSTED_DEVICES_QUERY_KEY,
  describeListError,
  listTrustedDevices,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
} from './trusted-devices-api';
import {
  countOtherDevices,
  describeTrust,
  formatWhen,
  isThisDevice,
  sortDevices,
  twoStepLabel,
  type TrustedDeviceRow,
} from './trusted-devices-logic';

const Card = ({
  title,
  badge,
  intro,
  aside,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  intro: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) => (
  <div className="flex flex-col gap-3 bg-white p-4 rounded-lg border border-gray-200">
    <div className="flex sm:flex-row flex-col sm:items-center justify-between gap-4">
      <div className="flex flex-col gap-1 sm:w-2/3 w-full">
        <p className="flex items-center gap-2 text-gray-900 font-semibold text-sm">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {title}
          {badge}
        </p>
        <p className="text-gray-500 text-xs">{intro}</p>
      </div>
      {aside}
    </div>
    {children}
  </div>
);

const DeviceRow = ({
  row,
  thisDevice,
  onRevoke,
  busy,
}: {
  row: TrustedDeviceRow;
  thisDevice: boolean;
  onRevoke: (row: TrustedDeviceRow) => void;
  busy: boolean;
}) => {
  const isPhone = row.device_type === 'A' || row.device_type === 'I';
  return (
    <div className="border p-3 flex sm:flex-row flex-col gap-2 rounded-lg sm:justify-between bg-white">
      <div className="flex items-start gap-3 w-full">
        <span className="w-8 min-w-8 h-8 rounded-sm bg-ucass-primary-200 text-primary p-1.5 flex items-center justify-center">
          {isPhone ? <LucideSmartphone className="w-4 h-4" /> : <LucideMonitor className="w-4 h-4" />}
        </span>
        <div className="flex flex-col gap-0.5 w-full">
          <p className="text-gray-900 font-medium text-sm flex items-center gap-2 flex-wrap">
            {row.label}
            {thisDevice ? (
              <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium">
                <LucideShieldCheck className="w-3.5 h-3.5" /> This device
              </span>
            ) : null}
            {row.trusted ? (
              <span className="mcm-setcard-badge is-on">Trusted</span>
            ) : (
              <span className="mcm-setcard-badge is-off">Not trusted</span>
            )}
            {row.signed_in ? null : <span className="mcm-setcard-badge is-off">Signed out</span>}
          </p>
          <p className="text-gray-600 text-xs">{describeTrust(row)}</p>
          {row.ip_address ? <p className="text-gray-600 text-xs">IP address: {row.ip_address}</p> : null}
          {row.user_agent ? <p className="text-gray-500 text-xs break-all">Browser: {row.user_agent}</p> : null}
          <p className="text-gray-500 text-xs">
            {row.first_seen ? `First seen ${formatWhen(row.first_seen)}` : ''}
            {row.first_seen && row.last_seen ? ' · ' : ''}
            {row.last_seen ? `Last seen ${formatWhen(row.last_seen)}` : ''}
            {row.trusted && row.trusted_until ? ` · Trusted until ${formatWhen(row.trusted_until)}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onRevoke(row)}
          className="flex items-center justify-center whitespace-nowrap"
          title={
            thisDevice
              ? 'You stay signed in here, but the next sign-in from this device asks for a code.'
              : 'Signs this device out and asks it for a code next time.'
          }
        >
          Revoke
        </Button>
      </div>
    </div>
  );
};

const TrustedDevices = () => {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const ctx = useMemo(
    () => ({
      localDeviceId: getDeviceId(),
      sessionUuid: user?.device_token ? String(user.device_token) : null,
    }),
    [user?.device_token],
  );

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: TRUSTED_DEVICES_QUERY_KEY,
    queryFn: listTrustedDevices,
    retry: false,
  });

  const rows = useMemo(
    () => (data?.kind === 'ok' ? sortDevices(data.list.devices, ctx) : []),
    [data, ctx],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: TRUSTED_DEVICES_QUERY_KEY });
    /* The sessions list further down the page shares the rows this touches. */
    queryClient.invalidateQueries({ queryKey: ['deviceSecurityList'] });
  };

  const { mutate: revokeOne, isPending: revoking } = useMutation({
    mutationFn: (row: TrustedDeviceRow) => revokeTrustedDevice(row.id),
    onMutate: (row) => setPendingId(row.id),
    onSuccess: (res) => {
      handleAlert({ text: res?.data?.data?.message || 'Device revoked.', type: 'success' });
    },
    onSettled: () => {
      setPendingId(null);
      refresh();
    },
  });

  const { mutate: revokeAll, isPending: revokingAll } = useMutation({
    mutationFn: revokeAllTrustedDevices,
    onSuccess: (res) => {
      handleAlert({ text: res?.data?.data?.message || 'Other devices signed out.', type: 'success' });
    },
    onSettled: refresh,
  });

  const others = countOtherDevices(rows, ctx);
  const twoStep = data?.kind === 'ok' ? data.list.two_step : null;
  const absent = data?.kind === 'absent';

  const twoStepBadge = isLoading ? null : absent ? (
    <NotAppliedFlag>Coming soon</NotAppliedFlag>
  ) : twoStepLabel(twoStep) === 'Active' ? (
    <LiveFlag>Active</LiveFlag>
  ) : (
    <span className="mcm-setcard-badge is-off">Off</span>
  );

  return (
    <>
      <Card
        title="Two-step sign-in"
        badge={twoStepBadge}
        intro={
          isLoading
            ? 'Checking…'
            : absent
              ? 'This server does not report the rule yet. Sign-in still asks for a code emailed to you.'
              : isError
                ? describeListError(error)
                : twoStep?.reason ||
                  'Every sign-in needs your password and a code emailed to you, unless the device is trusted.'
        }
      />

      <Card
        title="Trusted devices"
        intro={
          <>
            A trusted device passed a code recently and was told to skip it next time. Revoke one and
            its next sign-in asks for a code again. The sessions list further down shows who is
            signed in right now; this shows who can sign in without a code.
          </>
        }
        aside={
          <Button
            variant="destructiveOutline"
            className="whitespace-nowrap"
            disabled={isLoading || absent || isError || revokingAll || others === 0}
            onClick={() => revokeAll()}
            title={others === 0 ? 'No other devices to sign out.' : `Signs out ${others} other device(s).`}
          >
            <LogOut className="w-4 h-4" />
            {revokingAll ? 'Signing out…' : 'Sign out of all other devices'}
          </Button>
        }
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-gray-500 text-xs py-2">
            <Loader variant="blue" size="sm" /> Checking…
          </div>
        ) : absent ? (
          <p className="mcm-notsaved" role="status">
            <strong>Coming soon</strong>
            <span>
              This server cannot list trusted devices yet. Until it can, use the sessions list below to
              sign a device out.
            </span>
          </p>
        ) : isError ? (
          <div className="flex items-center justify-between gap-3 text-xs text-red-700">
            <span>{describeListError(error)}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-gray-500 text-xs py-1">No trusted devices.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <DeviceRow
                key={row.id}
                row={row}
                thisDevice={isThisDevice(row, ctx)}
                onRevoke={revokeOne}
                busy={revoking && pendingId === row.id}
              />
            ))}
          </div>
        )}
      </Card>
    </>
  );
};

export default TrustedDevices;
