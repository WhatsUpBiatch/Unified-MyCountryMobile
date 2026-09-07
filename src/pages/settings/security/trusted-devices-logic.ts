/* The decisions behind the "Trusted devices" and "Two-step sign-in" cards,
 * kept free of React and of imports so they can be unit-tested with node:test
 * (backend-patches/trusted-devices-profile/tests).
 *
 * What the server sends (POST /api/security/devices/list) is one row per
 * device: whether it is signed in, whether it is trusted (it passed a code
 * inside the trust window, so the next sign-in skips the code), and whether it
 * is the session asking. "This device" is decided here from two things the
 * browser already holds: the device id it sends on every sign-in
 * (localStorage `ucaas-device-id`) and the session uuid the API returns as
 * `device_token` on /api/user/info. Either match is enough; the server's own
 * `is_current` is honoured too.
 */

export interface TrustedDeviceRow {
  id: string;
  device_id: string | null;
  session_uuid: string | null;
  label: string;
  device_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
  app_version: string | null;
  first_seen: string | null;
  last_seen: string | null;
  signed_in: boolean;
  trusted: boolean;
  trusted_since: string | null;
  trusted_until: string | null;
  is_current: boolean;
}

export interface TwoStepStatus {
  enforced: boolean;
  method?: string;
  trust_days?: number;
  reason?: string;
}

export interface TrustedDeviceList {
  two_step: TwoStepStatus | null;
  current_session_uuid: string | null;
  devices: TrustedDeviceRow[];
}

export interface ThisDeviceContext {
  localDeviceId?: string | null;
  sessionUuid?: string | null;
}

const clean = (v: unknown): string => String(v ?? '').trim();

export const isThisDevice = (row: TrustedDeviceRow, ctx: ThisDeviceContext): boolean => {
  if (row.is_current) return true;
  const local = clean(ctx.localDeviceId);
  if (local && clean(row.device_id) === local) return true;
  const session = clean(ctx.sessionUuid);
  if (session && clean(row.session_uuid) === session) return true;
  return false;
};

/* This device first, then most recently seen first. */
export const sortDevices = (rows: TrustedDeviceRow[], ctx: ThisDeviceContext): TrustedDeviceRow[] =>
  [...rows].sort((a, b) => {
    const ta = isThisDevice(a, ctx);
    const tb = isThisDevice(b, ctx);
    if (ta !== tb) return ta ? -1 : 1;
    return clean(b.last_seen).localeCompare(clean(a.last_seen));
  });

export const daysLeft = (untilIso: string | null | undefined, now: Date = new Date()): number | null => {
  if (!untilIso) return null;
  const t = Date.parse(untilIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - now.getTime()) / 86_400_000));
};

/* One short line per row: what happens at the next sign-in from it. */
export const describeTrust = (row: TrustedDeviceRow, now: Date = new Date()): string => {
  if (row.trusted) {
    const d = daysLeft(row.trusted_until, now);
    if (d === null) return 'Trusted: skips the code at sign-in.';
    if (d <= 0) return 'Trust has run out: asks for a code at sign-in.';
    if (d === 1) return 'Trusted for 1 more day: skips the code at sign-in.';
    return `Trusted for ${d} more days: skips the code at sign-in.`;
  }
  return 'Not trusted: asks for a code at sign-in.';
};

export const twoStepLabel = (status: TwoStepStatus | null | undefined): 'Active' | 'Off' =>
  status?.enforced ? 'Active' : 'Off';

/* The API wraps results as { data: { message, result } }. Accepts the raw
   axios response, its body, or the result itself, and always hands back the
   three fields the cards read. */
export const normaliseDeviceList = (body: unknown): TrustedDeviceList => {
  const any = body as any;
  const result = any?.data?.data?.result ?? any?.data?.result ?? any?.result ?? any ?? {};
  const devices: TrustedDeviceRow[] = Array.isArray(result?.devices) ? result.devices : [];
  const twoStep = result?.two_step && typeof result.two_step === 'object' ? result.two_step : null;
  return {
    two_step: twoStep,
    current_session_uuid: result?.current_session_uuid ? String(result.current_session_uuid) : null,
    devices,
  };
};

/* The rows the "Sign out of all other devices" button will act on, so the
   confirmation can say a number rather than "some". */
export const countOtherDevices = (rows: TrustedDeviceRow[], ctx: ThisDeviceContext): number =>
  rows.filter((r) => !isThisDevice(r, ctx)).length;

export const formatWhen = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
