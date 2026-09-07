import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getDepartmentList, getPersonScopes, getPersonStates, getUserList } from '@/services/api';
import { normaliseScope, scopeSuffix } from '@/lib/admin-scope';
import { useGetSite } from '@/hooks/common';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useLiveContactCentre, KPI_REFRESH_MS } from '@/hooks/use-live-contact-centre';
import { handleDate } from '@/components/custom/date-dropdown/constant';
import { getAgentLiveState } from '@/pages/performance/agent-rows';
import { roleDisplayName } from '@/pages/admin-settings/roles/role-names';

/**
 * The organisation roster, as the console's People page reads it.
 *
 * The platform stores the pieces separately — the user list, department
 * membership, queue membership and live presence all arrive from different
 * places — so this assembles one row per person from all four. Presence reuses
 * `getAgentLiveState` from Performance rather than re-deriving it, so a person
 * cannot show as Available here and On Call there.
 *
 * Location comes from the site a user is assigned to (`site.name`), which is
 * what the platform calls the same thing.
 *
 * TWO WAYS TO READ IT
 *
 * People (the list page) reads one page at a time — `POST /api/user/list` has
 * always taken `page`/`limit`/`search` and returned `total`/`totalPages`, and
 * asking for one page of 50 is what every other list in the product does. The
 * old single request for 500 rows silently cut off any company bigger than
 * that, and the export button then called the cut-off list "everybody".
 *
 * Favourites and Locations still need the whole roster in one go (to find the
 * pinned people, and to count heads per location), so calling the hook with no
 * query keeps the old single-request shape. That request is still capped at
 * ROSTER_LIMIT; the cap is now written down here rather than hidden.
 */

export type PresenceTone = 'good' | 'busy' | 'warn' | 'idle';

/**
 * What a person's account is, as distinct from their live presence.
 *
 *   PENDING    invited, has not signed in yet
 *   ACTIVE     normal
 *   SUSPENDED  an administrator switched them off: signed out everywhere and
 *              cannot sign in. The phone follows once the switch update is applied.
 *   REMOVED    removed, restorable for 72 hours (the Removed tab)
 *
 * `/api/user/list` does not carry the stored status, so the states come from
 * one extra request (`POST /api/person/state`) and are joined here by uuid.
 * A person the states request does not know is `null`, never assumed Active.
 */
export type PersonState = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

/** How each state reads on screen, and the honest note behind it. */
export const PERSON_STATE_LABEL: Record<PersonState, { label: string; tone: PresenceTone; note: string }> = {
  PENDING: {
    label: 'Pending',
    tone: 'warn',
    note: 'Invited, has not signed in yet. Cannot sign in until the invitation is accepted.',
  },
  ACTIVE: { label: 'Active', tone: 'good', note: 'Can sign in and use their phone.' },
  SUSPENDED: {
    label: 'Suspended',
    tone: 'busy',
    note: 'Login blocked and the phone is blocked: it cannot register, and calls to their extension go to voicemail or the closed-hours destination of the number.',
  },
  REMOVED: { label: 'Removed', tone: 'idle', note: 'Removed. Can be restored for 72 hours.' },
};

export type PersonRow = {
  uuid: string;
  name: string;
  initials: string;
  image?: string;
  email: string;
  /** The stored role name — an authorisation key, never shown as is. */
  role: string;
  /** The role as a person should read it: "Location admin", not "MANAGER". */
  roleLabel: string;
  /** Who the role reaches, when it is not the whole company: "Delhi", "Sales +1".
      Empty for everybody else, so the column stays quiet where nothing is set. */
  scopeSuffix: string;
  department: string;
  extension: string;
  /** The site's name — in most tenants this reads like a company name. */
  location: string;
  /** "City, Country" for that site, so the location reads as a place. */
  locationPlace: string;
  jobTitle: string;
  phone: string;
  /** Outbound number assigned to the user; blank until one is assigned. */
  callerId: string;
  skills: string[];
  /** Live state from the socket — On Call, Offline, Available… */
  presence: string;
  /** The availability stored against the person, which an admin can change. */
  availability: string;
  tone: PresenceTone;
  /** Pending / Active / Suspended. Null until the states request has answered. */
  state: PersonState | null;
  /** The untouched user record, for surfaces that expect the platform shape. */
  raw: any;
};

/** One page of the list, as the People page asks for it. */
export type PeopleQuery = {
  page: number;
  limit: number;
  /** Matched by the server against name, e-mail and extension. */
  search?: string;
  /** A location name; the server matches the site's name. 'All' means no filter. */
  location?: string;
};

/** The most the whole-roster shape will ever fetch. */
export const ROSTER_LIMIT = 500;

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '—';

/** How each live state should read on the roster. */
const TONE: Record<string, PresenceTone> = {
  'On Call': 'busy',
  Ringing: 'warn',
  'On Hold': 'warn',
  Available: 'good',
  Busy: 'busy',
  'Do Not Disturb': 'busy',
  Offline: 'idle',
};

const parseMembers = (members: unknown): any[] => {
  try {
    const parsed = typeof members === 'string' ? JSON.parse((members as string) || '[]') : members;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** What is actually posted to /api/user/list for a given query. */
const listPayload = (query?: PeopleQuery) => {
  if (!query) return { page: 1, limit: ROSTER_LIMIT };
  const search = String(query.search || '').trim();
  const location = String(query.location || '').trim();
  return {
    page: Math.max(1, query.page || 1),
    limit: query.limit || 50,
    ...(search ? { search } : {}),
    ...(location && location !== 'All'
      ? { filter: [{ key: 'site_name', value: location }] }
      : {}),
  };
};

export const usePeopleRows = (query?: PeopleQuery) => {
  const today = useMemo(() => handleDate('Today'), []);
  const { queues, activeQueueCalls } = useLiveContactCentre(today);
  const { usersOnlineStatus } = useSocketEvents();

  const payload = useMemo(
    () => listPayload(query),
    [query?.page, query?.limit, query?.search, query?.location, Boolean(query)],
  );

  const { data: page, isPending: isRosterLoading, isFetching } = useQuery({
    /* 'directoryPeople' stays the first key so the existing invalidations
       (remove person, change role, caller ID) still refresh every page. */
    queryKey: ['directoryPeople', payload],
    queryFn: () => getUserList(payload),
    select: (res: any) => res?.data?.data?.result || {},
    refetchInterval: KPI_REFRESH_MS,
    /* Keep the last page on screen while the next one loads, so paging does
       not flash an empty table. */
    placeholderData: keepPreviousData,
  });

  const roster: any[] = useMemo(() => (Array.isArray(page?.rows) ? page.rows : []), [page]);

  /* One request for every person's state, joined by uuid below. Refreshed on
     the same clock as the roster, and invalidated by suspend / reactivate /
     remove / restore. A failed request leaves every state null, and the
     screen then shows no pill rather than a wrong one. */
  const { data: stateByUuid } = useQuery({
    queryKey: ['directoryPersonStates'],
    queryFn: getPersonStates,
    select: (res: any) => {
      const map = new Map<string, PersonState>();
      const list = res?.data?.data?.result?.rows;
      (Array.isArray(list) ? list : []).forEach((row: any) => {
        const state = String(row?.state || '').toUpperCase() as PersonState;
        if (row?.uuid && state in PERSON_STATE_LABEL) map.set(String(row.uuid), state);
      });
      return map;
    },
    refetchInterval: KPI_REFRESH_MS,
    retry: false,
  });
  /* One request for every person's admin scope (POST /api/person/scope),
     joined by uuid below and shown as a suffix on the role. A failed request
     leaves every suffix empty rather than wrong. */
  const { data: scopeByUuid } = useQuery({
    queryKey: ['directoryPersonScopes'],
    queryFn: getPersonScopes,
    select: (res: any) => {
      const map = new Map<string, ReturnType<typeof normaliseScope>>();
      const list = res?.data?.data?.result?.rows;
      (Array.isArray(list) ? list : []).forEach((row: any) => {
        const scope = normaliseScope(row?.admin_scope);
        if (row?.uuid && scope) map.set(String(row.uuid), scope);
      });
      return map;
    },
    retry: false,
  });
  const total = Number(page?.total);
  const totalPages = Number(page?.totalPages);

  /* Sites carry city/country; the user row only carries the site's name. Joining
     them lets the roster show where someone actually is, not just the label
     whoever created the site happened to type. */
  const { data: sites = [] } = useGetSite();

  const { data: departments = [] } = useQuery({
    /* Same key prefix the platform invalidates, so membership changes reach
       People's Groups column instead of sitting stale. */
    queryKey: ['getDepartmentList', 'directoryDepartments'],
    queryFn: () => getDepartmentList({ page: 1, limit: 200 }),
    select: (res: any) => res?.data?.data?.result?.rows || [],
  });

  /** Names for the scope suffix: a scope holds ids, the column shows words. */
  const scopeDirectory = useMemo(
    () => ({
      locations: (sites as any[]).map((site) => ({ uuid: String(site?.uuid || ''), name: site?.name })),
      groups: departments.map((department: any) => ({
        uuid: String(department?.uuid || ''),
        name: department?.name,
      })),
    }),
    [sites, departments],
  );

  /** user uuid -> the departments they belong to */
  const departmentByUser = useMemo(() => {
    const map = new Map<string, string[]>();
    departments.forEach((department: any) => {
      parseMembers(department?.members).forEach((member: any) => {
        const key = String(member?.user_uuid || member?.uuid || '');
        if (!key) return;
        map.set(key, [...(map.get(key) || []), department?.name].filter(Boolean));
      });
    });
    return map;
  }, [departments]);

  const rows: PersonRow[] = useMemo(
    () =>
      roster.map((person: any) => {
        const name = `${person?.first_name || ''} ${person?.last_name || ''}`.trim() || 'Unknown';
        const extension = String(person?.extension || '');
        const keys = [person?.uuid, person?.user_uuid, extension].filter(Boolean).map(String);

        // Queue membership is the platform's nearest thing to an ACD skill.
        const skills = queues
          .filter((queue: any) => queue.memberKeys.some((key: string) => keys.includes(key)))
          .map((queue: any) => queue.name);

        const live = getAgentLiveState(extension, usersOnlineStatus, activeQueueCalls);
        const role = person?.custom_role_data?.name || person?.role_data?.name || person?.role || '';

        return {
          uuid: String(person?.uuid || extension || name),
          name,
          initials: initialsOf(name),
          image: person?.profile,
          email: person?.email || '',
          role: role || '—',
          roleLabel: role ? roleDisplayName(role) : '—',
          scopeSuffix: scopeSuffix(scopeByUuid?.get(String(person?.uuid)) ?? null, scopeDirectory),
          department: (departmentByUser.get(String(person?.uuid)) || []).join(', ') || '—',
          extension,
          location: person?.site?.name || '—',
          locationPlace:
            (() => {
              const site = sites.find(
                (entry: any) =>
                  entry?.uuid === person?.site_uuid || entry?.name === person?.site?.name,
              );
              return [site?.city, site?.country].filter(Boolean).join(', ');
            })() || '',
          jobTitle: person?.job_title || '',
          phone: person?.phone || person?.mobile || '',
          callerId: person?.caller_id || '',
          skills,
          presence: live.status,
          availability: (() => {
            const raw = person?.call_forwarding;
            const rules =
              typeof raw === 'string'
                ? (() => {
                    try {
                      return JSON.parse(raw);
                    } catch {
                      return null;
                    }
                  })()
                : raw;
            return rules?.status || 'online';
          })(),
          tone: TONE[live.status] || 'idle',
          state: stateByUuid?.get(String(person?.uuid)) ?? null,
          raw: person,
        };
      }),
    [roster, queues, usersOnlineStatus, activeQueueCalls, departmentByUser, sites, stateByUuid, scopeByUuid, scopeDirectory],
  );

  /** Every location the company has, for a filter that must list locations the
      current page happens not to show. */
  const locationNames = useMemo(
    () =>
      Array.from(
        new Set((sites as any[]).map((site) => String(site?.name || '')).filter(Boolean)),
      ).sort(),
    [sites],
  );

  return {
    rows,
    isLoading: isRosterLoading,
    isFetching,
    /* Fall back to what is on screen when the server sends no total, so a
       count is never shown as zero for a list that is plainly not empty. */
    total: Number.isFinite(total) ? total : rows.length,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
    locationNames,
  };
};

export default usePeopleRows;
