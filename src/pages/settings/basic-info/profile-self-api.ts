/* The person's own five profile fields, on a server that may not have the
 * endpoint yet.
 *
 *   POST /api/profile/self          read
 *   POST /api/profile/update-self   write (first_name, last_name, job_title,
 *                                   pronouns, interface_language)
 *
 * Same feature-detection shape as src/lib/company-defaults.ts: the first call
 * of the session probes quietly, a 404 marks the endpoint absent for the rest
 * of the session and the Profile page falls back to the old whole-record
 * save (which cannot carry pronouns or language - the page says so). Any
 * other failure is a real one and is thrown. */

import { apiClient, type CustomAxiosRequestConfig } from '@/services/api/axios';
import { isEndpointAbsent } from '@/lib/company-settings-api';

export const SELF_PROFILE_QUERY_KEY = ['profile', 'self'];

const SELF_URL = '/api/profile/self';
const UPDATE_SELF_URL = '/api/profile/update-self';

export interface SelfProfile {
  uuid?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string | null;
  pronouns?: string | null;
  interface_language?: string | null;
}

export type SelfProfileStore = 'unknown' | 'present' | 'absent';

let store: SelfProfileStore = 'unknown';

export const getSelfProfileStore = (): SelfProfileStore => store;

/* For tests. */
export const resetSelfProfileDetection = (): void => {
  store = 'unknown';
};

const unwrap = (response: any): SelfProfile | null => {
  const result = response?.data?.data?.result ?? response?.data?.result ?? null;
  return result && typeof result === 'object' ? (result as SelfProfile) : null;
};

/* null means "this server has no such endpoint"; an empty profile is never
   null, it is an object with empty fields. */
export const fetchSelfProfile = async (): Promise<SelfProfile | null> => {
  if (store === 'absent') return null;
  try {
    const response = await apiClient({
      method: 'POST',
      url: SELF_URL,
      data: {},
      hideToastOnError: true,
    } as CustomAxiosRequestConfig);
    store = 'present';
    return unwrap(response) || {};
  } catch (error: any) {
    if (store === 'unknown' && isEndpointAbsent(error)) {
      store = 'absent';
      return null;
    }
    throw error;
  }
};

export type UpdateSelfOutcome = { kind: 'saved'; profile: SelfProfile; message: string } | { kind: 'absent' };

export const updateSelfProfile = async (values: SelfProfile): Promise<UpdateSelfOutcome> => {
  if (store === 'unknown') {
    /* A save before any read: decide the store the way a read would, so the
       save never goes to an endpoint that is not there. */
    if ((await fetchSelfProfile()) === null) return { kind: 'absent' };
  }
  if (store === 'absent') return { kind: 'absent' };

  const response = await apiClient({ method: 'POST', url: UPDATE_SELF_URL, data: values });
  return {
    kind: 'saved',
    profile: unwrap(response) || {},
    message: response?.data?.data?.message || 'Profile saved.',
  };
};
