/* The company's own record - name and postal address - and which door it
 * comes through.
 *
 * Newer servers have `/api/company/self` and `/api/company/self/update`: the
 * caller's own `companies` row, read and written by that company's admins.
 * Older servers do not. On those, the only endpoints that touch the row sit
 * under /api/admin behind the platform-staff check, so the company page keeps
 * a copy of the name and address in the company settings row instead.
 *
 * The first read of a session asks the new endpoint. If the server says "no
 * such route" (404, or a 200 whose body is not this API), the old settings
 * copy is used for the rest of the session. Any other failure - a 500, a 403,
 * a dropped connection - is thrown and shown, never papered over with the
 * settings copy, because the settings copy may be months stale on a server
 * that has moved on.
 *
 * Same shape as lib/company-defaults.ts on purpose, so the two stores are
 * detected the same way. */

import { fetchCompanySelf, updateCompanySelf } from '@/services/api';
import { isEndpointAbsent, unwrapResult } from '@/lib/company-settings-api';

export interface CompanySelfRecord {
  uuid: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  updated_at?: string | null;
}

/* What a save sends: strings only. An empty string clears an optional field
   on the server; a key left out is left alone. */
export type CompanySelfEditableField =
  | 'name'
  | 'address'
  | 'city'
  | 'state'
  | 'country'
  | 'postal_code';
export type CompanySelfChanges = Partial<Record<CompanySelfEditableField, string>>;

/* What a read resolves with. `absent` means the server has no such endpoint
   and the caller should use the settings-row copy. */
export type CompanySelfOutcome =
  | { source: 'self'; record: CompanySelfRecord }
  | { source: 'absent' };

export type CompanySelfStore = 'unknown' | 'self' | 'absent';

let store: CompanySelfStore = 'unknown';

/* Several parts of the page may ask at once on load; the probe runs once. */
let inflight: Promise<CompanySelfOutcome> | null = null;

export const getCompanySelfStore = (): CompanySelfStore => store;

/* For tests, and for any future "check again" affordance. */
export const resetCompanySelfDetection = (): void => {
  store = 'unknown';
  inflight = null;
};

const isPlainObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/* The shape check the detection relies on: this API always returns a uuid
   and a name. A body without both is not this API, whatever its status. */
export const isCompanySelfRecord = (value: unknown): value is CompanySelfRecord =>
  isPlainObject(value) && typeof value.uuid === 'string' && typeof value.name === 'string';

const probe = async (): Promise<CompanySelfOutcome> => {
  let body: unknown;
  try {
    body = unwrapResult(await fetchCompanySelf());
  } catch (error: any) {
    if (store !== 'self' && isEndpointAbsent(error)) return { source: 'absent' };
    throw error;
  }
  if (isCompanySelfRecord(body)) return { source: 'self', record: body };
  /* A 200 that is not this API - a catch-all route, a proxy's index page -
     counts as absent, but only while the store is still being decided. Once
     the endpoint has answered properly, a wrong body is a fault. */
  if (store !== 'self') return { source: 'absent' };
  throw new Error('The company record came back in a shape this app does not understand.');
};

export const fetchCompanySelfRecord = async (): Promise<CompanySelfOutcome> => {
  if (store === 'absent') return { source: 'absent' };
  if (!inflight) {
    inflight = probe().finally(() => {
      inflight = null;
    });
  }
  const outcome = await inflight;
  store = outcome.source;
  return outcome;
};

/* Saves only the keys given. The server writes only those and leaves the
   rest as they are, and it answers with the whole row as it now stands. */
export const saveCompanySelfRecord = async (
  changes: CompanySelfChanges,
): Promise<CompanySelfRecord> => {
  const body = unwrapResult(await updateCompanySelf(changes));
  if (!isCompanySelfRecord(body)) {
    throw new Error('The company record came back in a shape this app does not understand.');
  }
  store = 'self';
  return body;
};

export const COMPANY_SELF_QUERY_KEY = ['company-self'];
