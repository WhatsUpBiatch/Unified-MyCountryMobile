/* Admin scope — who an administrator is allowed to administer.
 *
 * A role answers "what can this person do": edit a user, buy a number, listen
 * to a recording. It does not answer the second question every company with
 * more than one location asks: to whom? Until scope existed the answer was
 * "everybody": the admin of one location could edit somebody at another.
 *
 * Scope is a property of the grant, and it lives on the person's own record:
 *
 *   users.settings.admin_scope = { level, location_uuids, group_uuids }
 *
 *   company    the whole company — what every administrator has today, and what
 *              an absent scope means
 *   location   the people at the chosen locations
 *   group      the members of the chosen groups (departments), wherever they sit
 *
 * The server owns the rules (default-api helpers/adminScope.ts): it decides who
 * may set a scope and, on every request that acts on a person, whether that
 * person is inside the caller's scope. What is here is the same model written
 * for the screen, so the screen refuses what the server would refuse instead
 * of letting somebody find out from a 403.
 *
 * The server check runs in REPORT mode until it is switched on: it writes down
 * what it would have refused and lets the request through. The screen says so.
 */

export type ScopeLevel = 'company' | 'location' | 'group';

export interface AdminScope {
  level: ScopeLevel;
  location_uuids: string[];
  group_uuids: string[];
}

export type SystemRole = 'ADMIN' | 'MANAGER' | 'SUB-ADMIN' | 'AGENT' | null;

/** One row of POST /api/person/scope. */
export interface ScopeRow {
  uuid: string;
  system_role: SystemRole;
  admin_scope: AdminScope | null;
}

export interface LevelInfo {
  level: ScopeLevel;
  label: string;
  /** One sentence an administrator can read and act on. */
  description: string;
}

export const LEVELS: LevelInfo[] = [
  {
    level: 'company',
    label: 'Whole company',
    description: 'Every location, every group and every person. This is what everybody has today.',
  },
  {
    level: 'location',
    label: 'Chosen locations',
    description:
      'The people at the locations you pick. One location for a location admin, several for somebody who covers a region.',
  },
  {
    level: 'group',
    label: 'Chosen groups',
    description: 'The members of the groups you pick, wherever those people sit.',
  },
];

const cleanList = (list: unknown): string[] => {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  list.forEach((item) => {
    const value = typeof item === 'string' ? item.trim() : '';
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
};

export const isLevel = (value: unknown): value is ScopeLevel =>
  value === 'company' || value === 'location' || value === 'group';

/** A stored scope -> a scope, or null (= company-wide) when there is none. */
export const normaliseScope = (raw: unknown): AdminScope | null => {
  const source = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!source || !isLevel(source.level)) return null;
  return {
    level: source.level,
    location_uuids: source.level === 'location' ? cleanList(source.location_uuids) : [],
    group_uuids: source.level === 'group' ? cleanList(source.group_uuids) : [],
  };
};

export const companyWide = (scope: AdminScope | null | undefined): boolean =>
  !scope || scope.level === 'company';

export const blankScope = (): AdminScope => ({ level: 'company', location_uuids: [], group_uuids: [] });

export interface Directory {
  locations: { uuid: string; name?: string }[];
  groups: { uuid: string; name?: string }[];
}

const nameIn = (list: { uuid: string; name?: string }[], uuid: string): string =>
  list.find((item) => item.uuid === uuid)?.name || 'a deleted entry';

/**
 * The short form for the People list: "Delhi", "Delhi, Mumbai", "Delhi +2".
 * Empty for a company-wide scope — no suffix is the honest reading of "reaches
 * everybody", and it keeps the list quiet for the companies that never set one.
 */
export const scopeSuffix = (scope: AdminScope | null | undefined, directory: Directory): string => {
  if (companyWide(scope)) return '';
  const uuids = scope!.level === 'location' ? scope!.location_uuids : scope!.group_uuids;
  const list = scope!.level === 'location' ? directory.locations : directory.groups;
  const names = uuids.map((uuid) => nameIn(list, uuid));
  if (names.length === 0) return 'nobody';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} +${names.length - 1}`;
};

/** The long form for the scope screen. */
export const describeScope = (scope: AdminScope | null | undefined, directory: Directory): string => {
  if (companyWide(scope)) return 'Whole company';
  const uuids = scope!.level === 'location' ? scope!.location_uuids : scope!.group_uuids;
  const list = scope!.level === 'location' ? directory.locations : directory.groups;
  const what = scope!.level === 'location' ? 'location' : 'group';
  if (uuids.length === 0) return `No ${what}s chosen — covers nobody`;
  return `${uuids.length === 1 ? what : `${what}s`}: ${uuids.map((uuid) => nameIn(list, uuid)).join(', ')}`;
};

export interface ScopeProblem {
  field: 'level' | 'locations' | 'groups';
  message: string;
  /** A blocking problem means the scope cannot be saved as it stands. */
  blocking: boolean;
}

/** Everything wrong with a scope, in the order somebody would fix it. */
export const checkScope = (scope: AdminScope, directory: Directory): ScopeProblem[] => {
  const problems: ScopeProblem[] = [];

  if (scope.level === 'location') {
    if (scope.location_uuids.length === 0) {
      problems.push({
        field: 'locations',
        message: 'Pick at least one location, or this admin covers nobody at all.',
        blocking: true,
      });
    }
    const known = new Set(directory.locations.map((item) => item.uuid));
    scope.location_uuids
      .filter((uuid) => !known.has(uuid))
      .forEach((uuid) =>
        problems.push({
          field: 'locations',
          message: `A location on this list no longer exists (${uuid}). Remove it.`,
          blocking: true,
        }),
      );
    if (directory.locations.length > 0 && scope.location_uuids.length === directory.locations.length) {
      problems.push({
        field: 'level',
        message:
          'This covers every location you have, which is the same as the whole company. Choose "Whole company" so it stays true when you open the next location.',
        blocking: false,
      });
    }
  }

  if (scope.level === 'group') {
    if (scope.group_uuids.length === 0) {
      problems.push({
        field: 'groups',
        message: 'Pick at least one group, or this admin covers nobody at all.',
        blocking: true,
      });
    }
    const known = new Set(directory.groups.map((item) => item.uuid));
    scope.group_uuids
      .filter((uuid) => !known.has(uuid))
      .forEach((uuid) =>
        problems.push({
          field: 'groups',
          message: `A group on this list no longer exists (${uuid}). Remove it.`,
          blocking: true,
        }),
      );
  }

  return problems;
};

export const isScopeSaveable = (problems: ScopeProblem[]): boolean =>
  !problems.some((problem) => problem.blocking);

export interface Decision {
  allowed: boolean;
  /** A sentence that can be shown to the administrator as it is. */
  reason: string;
}

export interface ScopeActor {
  uuid: string;
  role: SystemRole;
  scope: AdminScope | null;
}

/**
 * May `me` set `them`'s scope? The same rules as the server, in the same order:
 * only the owner or an account admin; never yourself; not while you are scoped
 * yourself; never the owner; only the owner for an account admin; admins only.
 */
export const canSetScope = (me: ScopeActor, them: ScopeActor): Decision => {
  if (!me.role) {
    return { allowed: false, reason: 'Your role could not be determined.' };
  }
  if (me.uuid === them.uuid) {
    return { allowed: false, reason: 'You cannot change your own scope. Ask the account owner.' };
  }
  if (me.role !== 'ADMIN' && me.role !== 'MANAGER') {
    return { allowed: false, reason: 'Only the account owner or an account admin can set scopes.' };
  }
  if (me.role !== 'ADMIN' && !companyWide(me.scope)) {
    return {
      allowed: false,
      reason: 'Only an administrator over the whole company can set scopes.',
    };
  }
  if (them.role === 'ADMIN') {
    return { allowed: false, reason: 'The account owner always covers the whole company.' };
  }
  if (them.role === 'MANAGER' && me.role !== 'ADMIN') {
    return { allowed: false, reason: "Only the account owner can change an account admin's scope." };
  }
  if (them.role !== 'MANAGER' && them.role !== 'SUB-ADMIN') {
    return { allowed: false, reason: 'Scope applies to administrators only.' };
  }
  return { allowed: true, reason: '' };
};

export interface Person {
  uuid: string;
  name?: string;
  locationUuid?: string | null;
  groupUuids?: string[];
}

export interface Reach {
  people: number;
  /** People whose location or group the platform does not report. */
  unplaced: number;
  totalPeople: number;
}

/** How many people a scope actually reaches, counted from real records. */
export const reachOf = (scope: AdminScope, people: Person[]): Reach => {
  const list = Array.isArray(people) ? people : [];
  if (scope.level === 'company') return { people: list.length, unplaced: 0, totalPeople: list.length };

  if (scope.level === 'location') {
    const covered = new Set(scope.location_uuids);
    const unplaced = list.filter((person) => !person.locationUuid).length;
    const reached = list.filter((person) => person.locationUuid && covered.has(person.locationUuid)).length;
    return { people: reached, unplaced, totalPeople: list.length };
  }

  const covered = new Set(scope.group_uuids);
  const unplaced = list.filter((person) => !(person.groupUuids || []).length).length;
  const reached = list.filter((person) => (person.groupUuids || []).some((uuid) => covered.has(uuid))).length;
  return { people: reached, unplaced, totalPeople: list.length };
};
