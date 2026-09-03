/**
 * Service measures for a contact centre, derived from the call log.
 *
 * Three things were wrong with the way Performance measured waiting, and all
 * three are fixed here rather than in the screens that display them.
 *
 * 1. **Waiting was guessed, not read.** `use-call-stats` derived the wait as
 *    `duration - talk` under a comment saying the platform has no wait field.
 *    It does: `waitsec` is selected by the call-list query and Call History
 *    already shows it. The guess is close for a simple call and wrong for any
 *    call that was transferred or held, so the real column is preferred here
 *    and the subtraction kept only as a fallback.
 *
 * 2. **Average answer time averaged the wrong calls.** Speed of answer is the
 *    average wait of the calls somebody *answered*. Averaging abandoned calls
 *    into it drags the figure toward zero — the more calls fail instantly, the
 *    healthier the number looks, which is exactly backwards.
 *
 * 3. **Every hang-up counted as a customer giving up.** A caller who rings off
 *    within a few seconds is a misdial or a wrong number, not a service
 *    failure. Standard practice removes those from both halves of the sum, so
 *    they neither count against the centre nor pad it out.
 */

/** Seconds target for answering. 20s alongside an 80% goal is the common pair. */
export const DEFAULT_TARGET_SECONDS = 20;
/** Hang-ups faster than this are misdials, not abandonment. */
export const DEFAULT_SHORT_ABANDON_SECONDS = 5;

const toSeconds = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  if (!trimmed.includes(':')) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
  }
  const parts = trimmed.split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return Math.max(
    0,
    Math.floor(
      parts.reduceRight((total, part, i) => total + part * Math.pow(60, parts.length - 1 - i), 0),
    ),
  );
};

export const talkSeconds = (row: any): number =>
  toSeconds(row?.billsectotal) ?? toSeconds(row?.billsec) ?? 0;

const totalSeconds = (row: any): number =>
  toSeconds(row?.durationtotal) ?? toSeconds(row?.duration) ?? 0;

/**
 * How long the caller waited. The stored `waitsec` is authoritative; the old
 * subtraction stands in only when the column is absent or blank, which is what
 * the API sends for rows that never reached the switch's accounting.
 */
export const waitSeconds = (row: any): number => {
  const stored = toSeconds(row?.waitsec);
  if (stored !== null) return stored;
  return Math.max(0, totalSeconds(row) - talkSeconds(row));
};

/** Answered means a person picked it up and spoke. */
export const wasAnswered = (row: any): boolean => talkSeconds(row) > 0;

/**
 * A hang-up too quick to be a real customer decision. Measured on the whole
 * call, not the wait, so a row with no timing at all still reads as short.
 */
export const isShortAbandon = (
  row: any,
  shortAbandonSeconds: number = DEFAULT_SHORT_ABANDON_SECONDS,
): boolean => {
  if (wasAnswered(row)) return false;
  return Math.max(waitSeconds(row), totalSeconds(row)) < Math.max(0, shortAbandonSeconds);
};

export type ServiceLevelResult = {
  offered: number;
  shortAbandons: number;
  counted: number;
  answered: number;
  answeredWithinTarget: number;
  abandoned: number;
  serviceLevelPercent: number | null;
  abandonRatePercent: number | null;
  averageAnswerSeconds: number | null;
  longestWaitSeconds: number | null;
};

/**
 * The whole service picture for one set of calls, in one pass.
 *
 * Returns nulls rather than zeros when there is nothing to measure. A centre
 * that took no calls has no service level; printing "0%" for that would read
 * as total failure.
 */
export const serviceLevel = ({
  rows,
  targetSeconds = DEFAULT_TARGET_SECONDS,
  shortAbandonSeconds = DEFAULT_SHORT_ABANDON_SECONDS,
}: {
  rows: any[];
  targetSeconds?: number;
  shortAbandonSeconds?: number;
}): ServiceLevelResult => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const target = Math.max(0, targetSeconds);

  let shortAbandons = 0;
  let answered = 0;
  let answeredWithinTarget = 0;
  let abandoned = 0;
  let answeredWaitTotal = 0;
  let longestWait: number | null = null;

  safeRows.forEach((row) => {
    if (isShortAbandon(row, shortAbandonSeconds)) {
      shortAbandons += 1;
      return;
    }
    const wait = waitSeconds(row);
    if (longestWait === null || wait > longestWait) longestWait = wait;

    if (wasAnswered(row)) {
      answered += 1;
      answeredWaitTotal += wait;
      if (wait <= target) answeredWithinTarget += 1;
    } else {
      abandoned += 1;
    }
  });

  const counted = answered + abandoned;
  return {
    offered: safeRows.length,
    shortAbandons,
    counted,
    answered,
    answeredWithinTarget,
    abandoned,
    serviceLevelPercent: counted ? (answeredWithinTarget / counted) * 100 : null,
    abandonRatePercent: counted ? (abandoned / counted) * 100 : null,
    averageAnswerSeconds: answered ? answeredWaitTotal / answered : null,
    longestWaitSeconds: counted ? longestWait : null,
  };
};

export default serviceLevel;
