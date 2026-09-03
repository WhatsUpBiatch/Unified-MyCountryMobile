import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { callList } from '@/services/api';

/**
 * Shared date-ranged call stats, derived from the call log (CDR).
 *
 * Why this exists: the per-queue REST report (`callLogQueueList`) reads
 * near-zero for "today" — the app's own shipped Queue report calls it with no
 * date filter at all — and the live socket queue feed only carries a
 * right-now snapshot. Neither matched the call volume actually visible in
 * Call History, which is why Performance showed empty cards and tables while
 * real calls were being handled. `callList` is the real CDR, so every
 * date-ranged number is derived from it here, once, and shared.
 */

const CDR_LIMIT = 1000;
const REFRESH_MS = 15000;

/** Accepts a number of seconds or an "HH:MM:SS" string. */
const parseSeconds = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  if (!trimmed.includes(':')) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
  }
  const parts = trimmed.split(':').map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const seconds = parts.reduceRight(
    (total, part, index) => total + part * Math.pow(60, parts.length - 1 - index),
    0,
  );
  return Math.max(0, Math.floor(seconds));
};

const toSeconds = (primary: unknown, fallback: unknown): number =>
  parseSeconds(primary) ?? parseSeconds(fallback) ?? 0;

export const callTalkSeconds = (row: any) => toSeconds(row?.billsectotal, row?.billsec);
export const callTotalSeconds = (row: any) => toSeconds(row?.durationtotal, row?.duration);
/**
 * How long the caller waited before somebody picked up.
 *
 * `waitsec` is the switch's own measurement and the figure Call History
 * already shows. It is preferred here; the subtraction is kept only as a
 * fallback for rows the switch never accounted for. The difference is not
 * cosmetic — on a held or transferred call, duration minus talk is not the
 * wait, and every service-level and speed-of-answer figure is built on this.
 */
export const callWaitSeconds = (row: any) => {
  const stored = parseSeconds(row?.waitsec);
  if (stored !== null) return stored;
  return Math.max(0, callTotalSeconds(row) - callTalkSeconds(row));
};

const isInbound = (row: any) => String(row?.direction || '').toLowerCase() === 'inbound';
/** Matches Call History's own "Missed" rule. */
export const isMissedCall = (row: any) =>
  isInbound(row) && callTalkSeconds(row) === 0 && !row?.is_voicemail;

/**
 * Which queue a call belongs to. Mirrors `isMonitoringCallForForwardValue`,
 * which accepts several id fields because the platform is not consistent
 * about which one it populates.
 */
const queueKeyOf = (row: any): string => {
  const candidate = [row?.forward_value, row?.forward_uuid, row?.queue_uuid, row?.queue_id].find(
    (value) => value !== null && value !== undefined && String(value).trim() !== '',
  );
  return candidate === undefined ? '' : String(candidate).trim();
};

export type QueueCallStats = {
  total: number;
  answered: number;
  missed: number;
  avgWaitSec: number | null;
  avgHandleSec: number | null;
};

export const useCallStats = (selectedRange: { from: string; to: string }) => {
  const { data, isPending } = useQuery({
    queryKey: ['sharedCallStats', selectedRange?.from, selectedRange?.to],
    queryFn: () => callList({ page: 1, limit: CDR_LIMIT, filter_date: selectedRange }),
    select: (res: any) => {
      const result = res?.data?.data?.result || {};
      return {
        rows: Array.isArray(result?.rows) ? result.rows : [],
        callStats: result?.call_stats || null,
        totalCount: Number(result?.totalItems ?? result?.total ?? 0) || 0,
      };
    },
    refetchInterval: REFRESH_MS,
    enabled: Boolean(selectedRange?.from && selectedRange?.to),
  });

  const rows = data?.rows;
  const callStats = data?.callStats;
  const totalCount = data?.totalCount;

  return useMemo(() => {
    const safeRows: any[] = rows || [];
    const stats = callStats || null;
    const count = totalCount || 0;

    // Headline volume comes from the server-side aggregate so it stays correct
    // even when the row sample below is capped.
    const totalCalls = Number(stats?.total_calls ?? 0) || 0;
    const missedCalls = Number(stats?.missed_calls ?? 0) || 0;
    const answeredCalls = Math.max(0, totalCalls - missedCalls);

    // Per-queue breakdown has no server-side aggregate, so it's grouped from
    // the CDR rows and flagged as sampled when the range exceeds one page.
    const working: Record<
      string,
      { total: number; answered: number; missed: number; waitTotal: number; handleTotal: number }
    > = {};

    let waitTotal = 0;
    let waitCount = 0;
    let handleTotal = 0;
    let handleCount = 0;
    let totalCharge = 0;

    safeRows.forEach((row: any) => {
      const talk = callTalkSeconds(row);
      const wait = callWaitSeconds(row);

      totalCharge += Number(row?.chargeTotal) || Number(row?.charge) || 0;

      // Speed of answer is the average wait of the calls somebody answered.
      // Averaging abandoned calls into it drags the figure toward zero, so the
      // more calls fail instantly the healthier it would read — backwards.
      if (talk > 0) {
        handleTotal += talk;
        handleCount += 1;
        waitTotal += wait;
        waitCount += 1;
      }

      if (String(row?.forward_type || '').toUpperCase() !== 'QUEUE') return;
      const queueKey = queueKeyOf(row);
      if (!queueKey) return;

      if (!working[queueKey]) {
        working[queueKey] = { total: 0, answered: 0, missed: 0, waitTotal: 0, handleTotal: 0 };
      }
      const bucket = working[queueKey];
      bucket.total += 1;
      if (isMissedCall(row)) bucket.missed += 1;
      // Same rule as the headline figure above: wait is only averaged over the
      // calls that were actually answered.
      if (talk > 0) {
        bucket.answered += 1;
        bucket.handleTotal += talk;
        bucket.waitTotal += wait;
      }
    });

    const byQueueUuid: Record<string, QueueCallStats> = {};
    Object.entries(working).forEach(([queueKey, bucket]) => {
      byQueueUuid[queueKey] = {
        total: bucket.total,
        answered: bucket.answered,
        missed: bucket.missed,
        avgWaitSec: bucket.answered ? bucket.waitTotal / bucket.answered : null,
        avgHandleSec: bucket.answered ? bucket.handleTotal / bucket.answered : null,
      };
    });

    return {
      isPending,
      rows: safeRows,
      callStats: stats,
      totalCalls,
      missedCalls,
      answeredCalls,
      inboundCalls: Number(stats?.inbound_calls ?? 0) || 0,
      outboundCalls: Number(stats?.outbound_calls ?? 0) || 0,
      voicemailCalls: Number(stats?.voicemail ?? 0) || 0,
      abandonRate: totalCalls ? (missedCalls / totalCalls) * 100 : null,
      avgWaitSec: waitCount ? waitTotal / waitCount : null,
      avgHandleSec: handleCount ? handleTotal / handleCount : null,
      totalCharge,
      byQueueUuid,
      /** True when the range holds more calls than the single page pulled. */
      isQueueBreakdownSampled: count > safeRows.length,
      sampledRowCount: safeRows.length,
      totalCount: count,
    };
  }, [rows, callStats, totalCount, isPending]);
};
