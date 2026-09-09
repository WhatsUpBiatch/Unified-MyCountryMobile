import type { McmIconName } from '@/components/mcm/icons';
import { isMonitoringCallForForwardValue } from '@/pages/monitoring/live-call-helpers';
import { formatSecsToClock } from '@/pages/performance/format';
import type { LiveQueue } from '@/hooks/use-live-contact-centre';

/**
 * "Needs you now" — the artifact's Home opens with a ranked list of things
 * that are wrong right now, not a wall of charts. The artifact filled it with
 * scripted examples; these are the same four shapes derived from live data.
 *
 * Rules:
 *   - only facts the platform actually reports; nothing inferred or invented
 *   - critical before warning, and within a tier the worst number first
 *   - every item carries somewhere to go, so the list is a work queue
 */

export type AttentionLevel = 'crit' | 'warn';

export type AttentionItem = {
  id: string;
  level: AttentionLevel;
  icon: McmIconName;
  title: string;
  detail: string;
  action: { label: string; to: string; primary?: boolean };
};

/** Service-level target the queue tables elsewhere in the app score against. */
const SLA_TARGET = 80;
/** Longest-wait threshold the Performance KPI band already calls "breaching".
    Exported because the queue board draws its breach mark at the same number -
    a second copy of it on Home would be a second definition of "late". */
export const LONGEST_WAIT_BREACH_SECS = 120;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const buildAttentionItems = ({
  queues,
  activeQueueCalls,
  waitingCalls,
  longestWaitSecs,
  liveSlaByName,
  usersOnlineStatus,
  onlineAgentsCount,
  voicemails,
  missedCalls,
}: {
  queues: LiveQueue[];
  activeQueueCalls: any[];
  waitingCalls: any[];
  longestWaitSecs: number;
  liveSlaByName: Record<string, number>;
  usersOnlineStatus: any[];
  onlineAgentsCount: number;
  voicemails: number;
  missedCalls: number;
}): AttentionItem[] => {
  const items: AttentionItem[] = [];

  // 1. Queues under the service-level target, worst first.
  const breaching = queues
    .map((queue) => ({ queue, sla: liveSlaByName[String(queue.name || '').toLowerCase()] }))
    .filter(
      (entry): entry is { queue: LiveQueue; sla: number } =>
        typeof entry.sla === 'number' && entry.sla < SLA_TARGET,
    )
    .sort((a, b) => a.sla - b.sla);

  breaching.forEach(({ queue, sla }) => {
    const queueCalls = activeQueueCalls.filter((call: any) =>
      isMonitoringCallForForwardValue(call, queue.uuid),
    );
    const queueWaiting = queueCalls.filter((call: any) => call?.status === 'waiting').length;
    items.push({
      id: `sla-${queue.uuid}`,
      level: sla < SLA_TARGET / 2 ? 'crit' : 'warn',
      icon: 'trend',
      title: `${queue.name} is breaching service level`,
      detail: `${Math.round(sla)}% against an ${SLA_TARGET}% target, with ${plural(
        queueWaiting,
        'call',
      )} waiting and ${plural(queue.membersCount, 'agent')} assigned.`,
      action: { label: 'Open queues', to: '/performance' },
    });
  });

  // 2. Somebody has been holding longer than the breach threshold.
  if (longestWaitSecs > LONGEST_WAIT_BREACH_SECS) {
    items.push({
      id: 'longest-wait',
      level: 'crit',
      icon: 'clock',
      title: `Someone has been waiting ${formatSecsToClock(longestWaitSecs)}`,
      detail: `${plural(waitingCalls.length, 'caller')} in queue right now. The longest is past the ${formatSecsToClock(
        LONGEST_WAIT_BREACH_SECS,
      )} breach mark.`,
      action: { label: 'Watch live', to: '/performance', primary: true },
    });
  }

  // 3. Calls are queueing with nobody logged in to take them.
  if (waitingCalls.length > 0 && onlineAgentsCount === 0) {
    items.push({
      id: 'no-agents',
      level: 'crit',
      icon: 'user',
      title: 'Calls are queueing with no agents online',
      detail: `${plural(waitingCalls.length, 'caller')} waiting and nobody logged in to answer.`,
      action: { label: 'Open call', to: '/phone', primary: true },
    });
  }

  // 4. Agents online but marked unavailable while a queue is backing up.
  const unavailable = usersOnlineStatus.filter((user: any) => {
    const status = String(user?.status || '').toLowerCase();
    return user?.online && ['dnd', 'do_not_disturb', 'do-not-disturb', 'busy'].includes(status);
  }).length;

  if (waitingCalls.length > 0 && unavailable > 0) {
    items.push({
      id: 'unavailable-agents',
      level: 'warn',
      icon: 'user',
      title: `${plural(unavailable, 'agent')} online but unavailable`,
      detail: `Set to busy or do-not-disturb while ${plural(
        waitingCalls.length,
        'caller',
      )} ${waitingCalls.length === 1 ? 'is' : 'are'} waiting.`,
      action: { label: 'Check', to: '/performance' },
    });
  }

  /* 5. The backlog. Everything above is the state of the floor this second,
        which meant Home could say "all clear" over forty voicemails nobody had
        listened to - people who did reach out and have not been called back.
        A quiet queue is not the same as nothing to do, and Home's headline
        claims the second one. Warn, not crit: it is work waiting, not a call
        breaching right now. */
  const backlog = Math.max(0, voicemails) + Math.max(0, missedCalls);
  if (backlog > 0) {
    items.push({
      id: 'backlog',
      level: 'warn',
      icon: 'phone',
      title: `${plural(backlog, 'caller')} to get back to`,
      detail: [
        voicemails > 0 ? plural(voicemails, 'voicemail') : '',
        missedCalls > 0 ? `${plural(missedCalls, 'missed call')}` : '',
      ]
        .filter(Boolean)
        .join(' and ')
        .concat(' today, still unanswered.'),
      action: { label: 'Open the call log', to: '/phone' },
    });
  }

  const rank: Record<AttentionLevel, number> = { crit: 0, warn: 1 };
  return items.sort((a, b) => rank[a.level] - rank[b.level]);
};
