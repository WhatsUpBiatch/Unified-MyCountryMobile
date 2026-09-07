/* The three calls behind the trusted-devices card.
 *
 * Kept beside the screen rather than in services/api because the endpoints
 * are new (default-api: routers/trustedDeviceRoute.ts) and not every server
 * has them yet. The list call is a quiet probe: a 404 means "this server does
 * not offer it" and the card says so, instead of the interceptor's generic
 * red toast. Anything else is a real failure and is shown as one. */

import { apiClient, type CustomAxiosRequestConfig } from '@/services/api/axios';
import { isEndpointAbsent } from '@/lib/company-settings-api';
import { normaliseDeviceList, type TrustedDeviceList } from './trusted-devices-logic';

export const TRUSTED_DEVICES_QUERY_KEY = ['security', 'trusted-devices'];

const LIST_URL = '/api/security/devices/list';
const REVOKE_URL = '/api/security/devices/revoke';
const REVOKE_ALL_URL = '/api/security/devices/revoke-all';

export type TrustedDevicesOutcome = { kind: 'ok'; list: TrustedDeviceList } | { kind: 'absent' };

export const listTrustedDevices = async (): Promise<TrustedDevicesOutcome> => {
  try {
    const response = await apiClient({
      method: 'POST',
      url: LIST_URL,
      data: {},
      hideToastOnError: true,
    } as CustomAxiosRequestConfig);
    return { kind: 'ok', list: normaliseDeviceList(response) };
  } catch (error: any) {
    if (isEndpointAbsent(error)) return { kind: 'absent' };
    throw error;
  }
};

export const revokeTrustedDevice = (id: string) =>
  apiClient({ method: 'POST', url: REVOKE_URL, data: { id } });

export const revokeAllTrustedDevices = () =>
  apiClient({ method: 'POST', url: REVOKE_ALL_URL, data: {} });

/* What a failed list should say. The interceptor was told to stay quiet, so
   the card carries the words itself. */
export const describeListError = (error: any): string => {
  const status = Number(error?.response?.status);
  const serverMessage = error?.response?.data?.message;
  if (typeof serverMessage === 'string' && serverMessage.trim()) return serverMessage;
  if (!Number.isFinite(status)) return 'Could not reach the server. Check your connection and try again.';
  return `Could not load your devices (${status}). Try again in a moment.`;
};
