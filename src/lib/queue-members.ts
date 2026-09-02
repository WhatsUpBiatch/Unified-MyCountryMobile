/**
 * Putting people on a queue, and taking them off.
 *
 * The screen could only ever hold one person. Each tick built the new list from
 * a copy of the old one captured when that row last rendered - so ticking a
 * second person spread a list that still had nobody in it, and the first person
 * vanished. One member addable, no error, nothing on screen to explain it.
 *
 * The fix is not in this file - it is that the caller must read the list at the
 * moment of the click rather than closing over it. What is here is the shape of
 * the change itself, kept pure so "adding a second person keeps the first" is
 * something proven rather than something believed.
 */

export type QueueMember = {
  value?: string;
  extension?: string;
  user_uuid?: string;
  label?: string;
  name?: string;
  email?: string;
  role?: string;
  skills?: unknown;
  [key: string]: unknown;
};

/** The identity every other check on this screen already uses. */
export const memberKey = (member: unknown): string => {
  const row = (member ?? {}) as QueueMember;
  return String(row.value ?? row.extension ?? '').trim();
};

export const isOnQueue = (list: unknown, person: unknown): boolean => {
  const key = memberKey(person) || String((person as QueueMember)?.extension ?? '').trim();
  if (!key) return false;
  return (Array.isArray(list) ? list : []).some((row) => memberKey(row) === key);
};

/**
 * The person as the queue stores them.
 *
 * `value` is the extension, because that is what every comparison on this
 * screen keys on and the one field a person always has.
 */
export const buildMember = (person: any): QueueMember | null => {
  const extension = String(person?.extension ?? person?.value ?? '').trim();
  if (!extension) return null;

  const full = person?.last_name
    ? `${person?.first_name} ${person?.last_name}`
    : person?.label || person?.first_name || '';

  return {
    label: full,
    name: full,
    value: extension,
    extension,
    email: person?.email,
    skills: person?.skills,
    role: person?.custom_role_data?.name || person?.role_data?.name || person?.role,
    /* Both spellings, because the people list is typed as carrying either and
       only one is populated at a time. Reading just one leaves every member
       with a blank id - which the save path then dedupes on, collapsing the
       whole queue to a single person. */
    user_uuid: person?.user_uuid || person?.uuid || '',
  };
};

/**
 * The list as it should be saved: one row per person, nobody lost.
 *
 * Deduping on the id alone is a trap. When the id is blank - and it is blank
 * whenever the list arrives under the other spelling - every member keys to the
 * same empty string and the whole queue collapses to whoever was last. Falling
 * back to the extension means a missing id costs nothing, because the extension
 * is what identifies a member everywhere else on this screen.
 */
export const dedupeMembers = (list: unknown): QueueMember[] => {
  const seen = new Map<string, QueueMember>();
  for (const row of (Array.isArray(list) ? list : []) as QueueMember[]) {
    const key = String(row?.user_uuid || '').trim() || memberKey(row);
    if (!key) continue;
    seen.set(key, row);
  }
  return [...seen.values()];
};

/**
 * The list after this person is added or removed.
 *
 * Always derived from the list passed in, never from anything remembered, so
 * ticking ten people in a row keeps all ten as long as the caller hands over
 * the current list each time.
 *
 * `on` forces a direction; leaving it out flips whatever the person is now.
 */
export const toggleMember = (list: unknown, person: any, on?: boolean): QueueMember[] => {
  const current: QueueMember[] = Array.isArray(list) ? [...(list as QueueMember[])] : [];
  const built = buildMember(person);
  if (!built) return current;

  const already = isOnQueue(current, built);
  const turningOn = on === undefined ? !already : on;

  if (turningOn) {
    if (already) return current;
    return [...current, built];
  }
  return current.filter((row) => memberKey(row) !== memberKey(built));
};

/** True when removing this person also leaves the queue without its manager. */
export const removesManager = (person: any, manager: unknown): boolean => {
  const extension = String(person?.extension ?? '').trim();
  if (!extension) return false;
  return String((manager as QueueMember)?.value ?? '').trim() === extension;
};

/* Who may run a queue. Agents answer calls; they do not own the queue. Kept
   here beside the membership rules so the screen and the tests read the same
   list rather than two copies that drift. */
export const MANAGER_ROLES = ['MANAGER', 'ADMIN', 'SUB-ADMIN', 'SUPER-ADMIN'];

export const roleOf = (person: any): string =>
  person?.custom_role_data?.name || person?.role_data?.name || person?.role || '';

export const canManage = (person: any): boolean =>
  MANAGER_ROLES.includes(String(roleOf(person)).toUpperCase());

/**
 * Who should be the manager, given who is on the queue.
 *
 * A queue cannot be saved without one, and the screen used to demand it as a
 * second, separate click on a column that looked dead until somebody was
 * ticked. So the first person who *can* run the queue is put in charge the
 * moment they join, and an admin who wants somebody else just clicks them.
 *
 * The choice already made always wins - this only fills a gap, so it can never
 * overrule an admin who has picked deliberately. Returns null when nobody on
 * the queue is eligible, which is a real state: a queue of agents only has
 * nobody to put in charge, and inventing one would be worse than saying so.
 */
export const chooseManager = (list: unknown, currentManager: unknown): QueueMember | null => {
  const members: QueueMember[] = Array.isArray(list) ? (list as QueueMember[]) : [];
  const chosen = memberKey(currentManager);

  if (chosen) {
    const still = members.find((row) => memberKey(row) === chosen);
    if (still && canManage(still)) return still;
  }

  return members.find((row) => canManage(row)) || null;
};

/**
 * The order people are listed in.
 *
 * The manager first, then everybody else already on the queue, then the rest.
 * Somebody looking at a queue wants to see who runs it and who is on it; the
 * people who are not on it are the ones they are least likely to want.
 *
 * Ties keep the order they arrived in, so the list does not reshuffle itself
 * while somebody is reading it.
 */
export const sortForQueue = (people: unknown, list: unknown, currentManager: unknown): any[] => {
  const rows = Array.isArray(people) ? [...(people as any[])] : [];
  const managerKey = memberKey(currentManager);

  const rank = (person: any): number => {
    const key = String(person?.extension ?? person?.value ?? '').trim();
    if (key && key === managerKey) return 0;
    return isOnQueue(list, person) ? 1 : 2;
  };

  return rows
    .map((person, index) => ({ person, index, rank: rank(person) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.person);
};
