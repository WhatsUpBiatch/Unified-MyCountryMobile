/**
 * A busy floor, for the sandbox only.
 *
 * Waiting callers, agents on calls and presence all arrive over the socket, and
 * the sandbox has no socket behind it — so every live figure on Home and
 * Performance sat at zero and every agent read "Offline". The pages were
 * correct and unreadable: you cannot judge a queue board, a service level or a
 * status table against a floor where nothing is happening.
 *
 * This builds a plausible floor and hands it to the socket context in place of
 * the real feed. It is gated on `import.meta.env.MODE === 'mock'` at the call
 * site, which Vite replaces with a literal, so the whole module drops out of a
 * production build.
 *
 * The queues and people are read back from the mock API rather than written
 * down here: the calls have to carry the same queue uuids and extensions the
 * rest of the app is reading, or they attach to nothing. Hard-coding them would
 * have gone stale the first time the mock's fixtures moved.
 */
import { callQueueList, getUserList } from '@/services/api';

export type DemoFloor = {
  liveCalls: any[];
  presence: any[];
  /* The per-queue stats feed. Separate from the calls: service level, calls
     handled, average wait and the available-agent count all ride on this one,
     keyed by queue name, which is why seeding the calls alone still left the
     board reading "Unstaffed" with no service level. */
  queueStats: any[];
};

const FIRST_NAMES = [
  'Marta',
  'Owen',
  'Priya',
  'Tomas',
  'Chloe',
  'Idris',
  'Nadia',
  'Felix',
  'Rosa',
  'Sami',
];
const LAST_NAMES = [
  'Bauer',
  'Okoro',
  'Nair',
  'Alvarez',
  'Fontaine',
  'Haddad',
  'Petrov',
  'Lindqvist',
  'Marino',
  'Yusuf',
];

/** Deterministic, so a reload shows the same floor and screenshots compare. */
const pick = <T,>(list: T[], seed: number) => list[seed % list.length];

const phone = (seed: number) => `+1 415 555 ${String(1000 + ((seed * 137) % 8999)).slice(0, 4)}`;

/**
 * How the floor is shaped. Deliberately uneven: a queue in real trouble, one
 * merely busy, one quiet, one with nobody on it. A floor where every queue
 * looks the same tells you nothing about whether the screen works.
 */
const SHAPE = [
  { waiting: 4, onCall: 2, oldestWaitSecs: 214 }, // past the breach mark
  { waiting: 2, onCall: 3, oldestWaitSecs: 71 },
  { waiting: 1, onCall: 2, oldestWaitSecs: 24 },
  { waiting: 0, onCall: 1, oldestWaitSecs: 0 },
  { waiting: 0, onCall: 0, oldestWaitSecs: 0 },
  { waiting: 1, onCall: 1, oldestWaitSecs: 38 },
];

export const buildDemoFloor = async (): Promise<DemoFloor> => {
  const [queueRes, userRes] = await Promise.all([
    callQueueList({ page: 1, limit: 200, filters: [], search: '' }),
    getUserList({ page: 1, limit: 200 }),
  ]);

  const queues: any[] = (queueRes as any)?.data?.data?.result?.rows || [];
  const users: any[] = (userRes as any)?.data?.data?.result?.rows || [];
  const extensions = users
    .map((user) => String(user?.extension || '').trim())
    .filter(Boolean);

  /* Queue membership records a user_uuid; a call is matched to an agent by
     extension. Without this bridge the demo put live calls on agents who were
     not in the queue - which showed up as an "Unstaffed 0/0" queue that
     somehow had somebody answering a call in it. */
  const extensionByUserUuid = new Map<string, string>();
  users.forEach((user) => {
    const uuid = String(user?.uuid || user?.user_uuid || '');
    const extension = String(user?.extension || '').trim();
    if (uuid && extension) extensionByUserUuid.set(uuid, extension);
  });

  const membersOf = (queue: any): string[] => {
    try {
      const parsed =
        typeof queue?.members === 'string' ? JSON.parse(queue.members || '[]') : queue?.members;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((member: any) => extensionByUserUuid.get(String(member?.user_uuid || '')) || '')
        .filter(Boolean);
    } catch {
      return [];
    }
  };

  if (!queues.length || !extensions.length) {
    return { liveCalls: [], presence: [], queueStats: [] };
  }

  const now = Date.now();
  const liveCalls: any[] = [];
  /* Extensions already busy on a call, so presence below does not also claim
     they are sitting available. */
  const onCallExtensions = new Set<string>();
  let seed = 0;

  queues.forEach((queue, queueIndex) => {
    const shape = SHAPE[queueIndex % SHAPE.length];
    const queueUuid = String(queue?.uuid || '');
    const queueMembers = membersOf(queue);
    /* Nobody in the queue means nobody answering calls in it. Callers can
       still be waiting - that is exactly what an unstaffed queue looks like,
       and it is worth being able to see. */
    const onCall = queueMembers.length ? Math.min(shape.onCall, queueMembers.length) : 0;

    /* Callers on hold. Spread between the oldest and now, so the queue board's
       wait rail has a spread to draw rather than one value repeated. */
    for (let i = 0; i < shape.waiting; i++) {
      const ageSecs = Math.round(
        shape.oldestWaitSecs * (1 - i / Math.max(1, shape.waiting)) + 5,
      );
      seed += 1;
      liveCalls.push({
        uuid: `demo-wait-${queueIndex}-${i}`,
        status: 'waiting',
        direction: 'inbound',
        queue_uuid: queueUuid,
        forward_value: queueUuid,
        forward_type: 'QUEUE',
        contact_name: `${pick(FIRST_NAMES, seed)} ${pick(LAST_NAMES, seed * 3)}`,
        caller_number: phone(seed),
        caller_id_number: phone(seed),
        start_time: now - ageSecs * 1000,
      });
    }

    /* Calls in progress, each pinned to a real extension so the agent table
       and the queue's "interacting" count agree with one another. */
    for (let i = 0; i < onCall; i++) {
      seed += 1;
      const extension = queueMembers[i % queueMembers.length];
      onCallExtensions.add(extension);
      const talkingSecs = 40 + ((seed * 53) % 400);
      liveCalls.push({
        uuid: `demo-live-${queueIndex}-${i}`,
        status: i === 0 && queueIndex === 1 ? 'on_hold' : 'answered',
        direction: 'inbound',
        queue_uuid: queueUuid,
        forward_value: queueUuid,
        forward_type: 'QUEUE',
        agent_extension: extension,
        contact_name: `${pick(FIRST_NAMES, seed * 7)} ${pick(LAST_NAMES, seed)}`,
        caller_number: phone(seed),
        caller_id_number: phone(seed),
        start_time: now - (talkingSecs + 6) * 1000,
        answered_time: now - talkingSecs * 1000,
      });
    }
  });

  /* Presence. Roughly two thirds of the roster signed in — a floor where
     everybody is available is as unrealistic as one where nobody is, and the
     attention list has a rule about agents sitting on do-not-disturb while
     callers wait, which needs somebody actually doing that. */
  const presence = extensions.map((extension, index) => {
    if (onCallExtensions.has(extension)) return { userId: extension, online: true, status: 'busy' };
    if (index % 3 === 2) return { userId: extension, online: false, status: 'offline' };
    if (index % 7 === 4) return { userId: extension, online: true, status: 'dnd' };
    return { userId: extension, online: true, status: 'available' };
  });

  /* Per-queue stats, shaped to match the calls above: the queue that is four
     minutes behind reports the service level to go with it, and the available
     count never exceeds the queue's own membership. */
  const queueStats = queues.map((queue, queueIndex) => {
    const shape = SHAPE[queueIndex % SHAPE.length];
    const members = (() => {
      try {
        const parsed =
          typeof queue?.members === 'string' ? JSON.parse(queue.members || '[]') : queue?.members;
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    })();
    /* Falls with the backlog rather than being a number of its own - a queue
       four minutes deep reporting 96% would be the board contradicting
       itself. */
    const sla = Math.max(38, 99 - shape.waiting * 9 - Math.round(shape.oldestWaitSecs / 12));
    /* A queue with nobody in it took no calls, so it has no service level to
       report. Handing one back anyway had the board showing an unstaffed queue
       at 99% - a score for calls that never happened. Leaving the key off is
       what the reader expects: the screen prints an em dash. */
    const idle = members === 0;
    return {
      uuid: queue?.uuid,
      name: queue?.name,
      ...(idle ? {} : { sla_within_20_sec_percent: sla }),
      total_calls: idle ? 0 : 40 + queueIndex * 23 + shape.onCall * 7,
      avg_wait_time_sec: idle ? 0 : Math.round(shape.oldestWaitSecs / 3) + 4,
      available_count: Math.max(0, Math.min(members, shape.onCall + (queueIndex % 2 === 0 ? 2 : 1))),
    };
  });

  return { liveCalls, presence, queueStats };
};
