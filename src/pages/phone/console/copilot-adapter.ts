/* ============================================================================
 * COPILOT ADAPTER — the console's AI layer, in one swappable file.
 *
 * The design artifact shows a live copilot: enrichment ticker, pre-call brief,
 * inline copilot cards, "say this next", sentiment / talk-ratio meters and a
 * quality checklist. Only some of that has a real backend today, so every
 * value produced here carries a `source` describing where it came from:
 *
 *   'live'     — real data from the platform (SIP session, CRM lookup, ASR).
 *   'derived'  — computed in the browser from live data (no server model).
 *   'stub'     — placeholder shape; NO backend exists for this yet.
 *
 * The UI renders that provenance verbatim in the little `.src` chips, so an
 * agent can always tell platform truth from a generated suggestion. When the
 * backing services land, replace the `stub` producers below and the console
 * needs no other change.
 *
 * Already wired to real services elsewhere in the console (not stubbed here):
 *   - live transcript ....... DialpadContext session.transcriptionMessages
 *   - Ask Copilot ........... dialpadAiSocket ('question'/'answer') + AiInfo
 *   - notes ................. getAllNotes / saveNoteInLeadContact
 *   - dispositions .......... getDispositions
 *   - history ............... callListById / contactActivityList
 *   - contact / screen pop .. session.contactInfo, queueMetaData, liveCallData
 * ==========================================================================*/

import type { DialpadSession, DialpadTranscriptMessage } from '@/context/dialpad-context';

export type CopilotSource = 'live' | 'derived' | 'stub';

export type CopilotCite = [string, string];

export type CopilotCard = {
  id: string;
  kind: 'context' | 'lookup' | 'billing' | 'risk' | 'compliance';
  level?: 'crit' | 'warn';
  title: string;
  body: string;
  src: string;
  source: CopilotSource;
  cites?: CopilotCite[];
};

export type EnrichmentRow = {
  k: string;
  v: string;
  src: string;
  source: CopilotSource;
  ms: number | null;
  done: boolean;
};

export type BriefRow = { k: string; v: string; src: string; source: CopilotSource };

export type ConsoleTurn = {
  id: string;
  speaker: 'agent' | 'customer' | 'system';
  who: string;
  time: string;
  text: string;
  isSummary: boolean;
  /** BCP-47 tag from the ASR, when it sends one. */
  language?: string;
};

/** "hi-IN" -> "Hindi (India)" where the browser knows it, else the raw tag. */
export const languageLabel = (tag?: string) => {
  const value = String(tag || '').trim();
  if (!value) return '';
  try {
    const base = new Intl.DisplayNames(undefined, { type: 'language' }).of(value);
    return base || value;
  } catch {
    return value;
  }
};

/* ---------------------------------------------------------------------------
 * CALL DURATION
 *
 * The call-log API is not consistent about this: `billsectotal` is a number of
 * seconds, while `billsec` and `duration` come back as "HH:MM:SS" strings. A
 * bare Number() on those yields NaN, which is why every duration in the console
 * rendered as 00:00 / —. Parse all three shapes, and try the fields in the
 * order that gives the truest talk time.
 * ------------------------------------------------------------------------ */

/** Seconds from a number, a numeric string, or "mm:ss" / "hh:mm:ss". */
export const parseDurationValue = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;

  const text = String(value).trim();
  if (!text) return null;

  if (text.includes(':')) {
    const parts = text.split(':');
    if (parts.length > 3) return null;
    let total = 0;
    for (const part of parts) {
      const n = Number(part.trim());
      if (!Number.isFinite(n) || n < 0) return null;
      total = total * 60 + n;
    }
    return total;
  }

  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * The talk length of a call row, in seconds.
 *
 * Pass either the raw log (fields are tried in order billsectotal → billsec →
 * duration → recording_duration) or explicit values. The first value that
 * parses to a real length wins; 0 when nothing does, never NaN.
 */
export const durationSeconds = (...values: unknown[]): number => {
  const candidates: unknown[] = [];
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      candidates.push(row.billsectotal, row.billsec, row.duration, row.recording_duration);
    } else {
      candidates.push(value);
    }
  }
  for (const candidate of candidates) {
    const parsed = parseDurationValue(candidate);
    if (parsed !== null && parsed > 0) return parsed;
  }
  // Nothing was positive — a genuine zero still beats "unknown".
  for (const candidate of candidates) {
    const parsed = parseDurationValue(candidate);
    if (parsed !== null) return parsed;
  }
  return 0;
};

/**
 * Talk time only — never ringing.
 *
 * `duration` on a call row is the WHOLE call including the time it rang, while
 * `billsec`/`billsectotal` are the seconds two people were actually connected.
 * durationSeconds falls through to `duration` when the earlier fields are zero,
 * which is right for an answered call whose billsec is missing, and wrong for
 * one that was never answered: a missed call came out showing how long it rang
 * as though that were a conversation.
 */
export const talkSeconds = (raw: any): number => durationSeconds(raw?.billsectotal, raw?.billsec);

/**
 * Did anyone pick up?
 *
 * The switch's own `status` is the most direct answer; `hangup_cause` catches
 * the rows that predate it, and talk time is the last resort.
 */
export const wasAnswered = (raw: any): boolean => {
  const status = String(raw?.status ?? '')
    .trim()
    .toUpperCase();
  if (status) return status === 'ANSWERED' || status === 'SUCCESS';

  const cause = String(raw?.hangup_cause ?? '')
    .trim()
    .toUpperCase();
  if (cause && cause !== 'NORMAL_CLEARING') return false;

  if (String(raw?.direction ?? '').toLowerCase() === 'missed') return false;

  return talkSeconds(raw) > 0;
};

/** mm:ss, widening to h:mm:ss once the call runs past an hour. */
export const formatDuration = (seconds: unknown): string => {
  const total = Math.max(0, Math.floor(parseDurationValue(seconds) ?? 0));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/* ---------------------------------------------------------------------------
 * TRANSCRIPT (live) — normalises the dialpad's socket messages into the shape
 * the artifact's transcript rows expect.
 * ------------------------------------------------------------------------ */

export const formatTurnTime = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export const toConsoleTurns = (
  messages: DialpadTranscriptMessage[] | undefined,
  agentName: string,
  contactName: string,
): ConsoleTurn[] => {
  if (!Array.isArray(messages)) return [];
  return messages.map((m, i) => {
    const role = String(m.speakerDetails?.role || '').toLowerCase();
    const mode = String(m.mode || '').toLowerCase();
    const speakerRaw = String(m.speaker || '').toLowerCase();
    const isSummary = mode === 'summary' || role === 'summary' || speakerRaw === 'summary';
    const isAgent = role === 'agent';
    return {
      id: String(m.id ?? i),
      speaker: isSummary ? 'system' : isAgent ? 'agent' : 'customer',
      who: isSummary ? 'Summary' : isAgent ? agentName : contactName,
      time: formatTurnTime(m.start_time),
      text: String(m.msg || ''),
      isSummary,
      language: m.language,
    };
  });
};

/* ---------------------------------------------------------------------------
 * SENTIMENT + TALK RATIO
 *
 * Talk ratio is genuinely derived (who spoke how many words).
 * Sentiment is a small on-device lexicon — the platform has no live sentiment
 * model on the call path, so it is labelled 'derived', never presented as a
 * platform score. Swap `scoreSentiment` for a server score when one exists.
 * ------------------------------------------------------------------------ */

const NEGATIVE = [
  'angry',
  'annoyed',
  'cancel',
  'cancelled',
  'charged twice',
  'complaint',
  'disappointed',
  'frustrated',
  'never',
  'not happy',
  'ridiculous',
  'refund',
  'still waiting',
  'switch',
  'terrible',
  'unacceptable',
  'useless',
  'wrong',
  'again',
  'chasing',
  'failed',
];
const POSITIVE = [
  'thank',
  'thanks',
  'great',
  'perfect',
  'appreciate',
  'happy',
  'brilliant',
  'lovely',
  'sorted',
  'resolved',
  'helpful',
  'excellent',
  'no problem',
  'that works',
];
const CHURN = ['cancel', 'switch', 'another provider', 'leave', 'close my account', 'ombudsman'];

export const hasChurnSignal = (text: string) => {
  const t = text.toLowerCase();
  return CHURN.some((k) => t.includes(k));
};

/** −100..100 over the customer's turns, weighted towards what was said last. */
export const scoreSentiment = (turns: ConsoleTurn[]): number => {
  const customer = turns.filter((t) => t.speaker === 'customer');
  if (!customer.length) return 0;
  let score = 0;
  let weight = 0;
  customer.forEach((turn, index) => {
    const text = turn.text.toLowerCase();
    const recency = 1 + index / Math.max(1, customer.length);
    let local = 0;
    NEGATIVE.forEach((k) => {
      if (text.includes(k)) local -= 22;
    });
    POSITIVE.forEach((k) => {
      if (text.includes(k)) local += 20;
    });
    if (CHURN.some((k) => text.includes(k))) local -= 30;
    score += local * recency;
    weight += recency;
  });
  if (!weight) return 0;
  return Math.max(-100, Math.min(100, Math.round(score / weight)));
};

/** Agent share of spoken words, 0..100. */
export const talkRatio = (turns: ConsoleTurn[]): number => {
  const words = (t: ConsoleTurn) => t.text.trim().split(/\s+/).filter(Boolean).length;
  const agent = turns.filter((t) => t.speaker === 'agent').reduce((n, t) => n + words(t), 0);
  const customer = turns.filter((t) => t.speaker === 'customer').reduce((n, t) => n + words(t), 0);
  const total = agent + customer;
  if (!total) return 0;
  return Math.round((agent / total) * 100);
};

/* ---------------------------------------------------------------------------
 * QUALITY CHECKLIST — the artifact's five behaviours, ticked by matching the
 * agent's own turns. Derived, not a QA platform score.
 * ------------------------------------------------------------------------ */

export const CHECKLIST: { label: string; test: RegExp }[] = [
  {
    label: 'Verify the account holder',
    test: /\b(date of birth|confirm your|security question|first line|postcode|verif)/i,
  },
  {
    label: 'Restate the issue back to the customer',
    test: /\b(so (just )?to confirm|what i.m hearing|let me make sure|you.re saying)/i,
  },
  {
    label: 'Give a specific next action with a date',
    test: /\b(by (monday|tuesday|wednesday|thursday|friday)|within \d|working days|on the \d{1,2}(st|nd|rd|th)?)/i,
  },
  {
    label: 'Confirm amount and timeline',
    test: /(\$|£|€|\brs\.?\b|\busd\b)\s?\d|(\b\d+(\.\d{2})?\s?(pounds|dollars|euro))/i,
  },
  {
    label: 'Offer a direct follow-up contact',
    test: /\b(my direct|call me back on|reference number|ticket number|i.ll ring you|extension)/i,
  },
];

export const checklistState = (turns: ConsoleTurn[]): boolean[] => {
  const agentText = turns
    .filter((t) => t.speaker === 'agent')
    .map((t) => t.text)
    .join(' \n ');
  return CHECKLIST.map((c) => c.test.test(agentText));
};

/* ---------------------------------------------------------------------------
 * SCREEN POP + ENRICHMENT
 *
 * Rows are 'live' when the platform actually resolved them for this session,
 * and stay in the pending state otherwise — the ticker reports what really
 * came back rather than replaying the artifact's scripted timings.
 * ------------------------------------------------------------------------ */

const headerValue = (session: DialpadSession | null, name: string) => {
  if (!session?.headers) return '';
  const wanted = name.trim().toLowerCase();
  const entry = Object.entries(session.headers).find(([k]) => k.trim().toLowerCase() === wanted);
  const values = entry?.[1];
  return Array.isArray(values) && values.length ? String(values[0] || '').trim() : '';
};

/**
 * Placeholders the switch and the CRM send when they could NOT identify who is
 * on the call. Treating them as a name is how an extension call ended up
 * captioned "Unknown" instead of the colleague's name — the real name was
 * available in the users directory the whole time, but this never fell through
 * far enough to look for it.
 */
const NOT_A_NAME = new Set([
  'unknown',
  'unknown contact',
  'unknown caller',
  // getUserDisplayName's own last resort, for a directory row with no name
  'unknown user',
  'not in contacts',
  'anonymous',
  'restricted',
  'private',
  'null',
  'na',
  'n/a',
  '-',
  '--',
  '—',
]);

/** '' for a placeholder, so the caller keeps looking for a real name. */
export const realNameOrEmpty = (value: unknown): string => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return NOT_A_NAME.has(text.toLowerCase()) ? '' : text;
};

/**
 * Who is on the call.
 *
 * `resolveName` is the console's directory + contact-book lookup — see
 * `useCallerName`. It is optional so this stays a pure function for the
 * non-React callers, but without it an internal extension has no name to find:
 * the switch does not send one, it sends "Unknown".
 */
export const contactDisplayName = (
  session: DialpadSession | null,
  resolveName?: (number: string) => string,
): string => {
  const first = String(session?.contactInfo?.name?.first || '').trim();
  const last = String(session?.contactInfo?.name?.last || '').trim();
  const joined = realNameOrEmpty(`${first} ${last}`.trim());
  const number = String(session?.remoteNumber || '').trim();

  return (
    joined ||
    /* Looked up BEFORE the switch's own labels: the directory knows an
       extension's owner, and the switch only ever sends "Unknown" for one. */
    (resolveName ? realNameOrEmpty(resolveName(number)) : '') ||
    realNameOrEmpty(session?.liveCallData?.contact_name) ||
    realNameOrEmpty(headerValue(session, 'x-contactname')) ||
    realNameOrEmpty(session?.remoteName) ||
    number ||
    'Unknown contact'
  );
};

/** True when the label is just a dialled number rather than a person's name. */
export const isNumberLike = (value: string) =>
  /^[+\d][\d\s()+-]*$/.test(String(value || '').trim());

/**
 * Initials for an avatar. A bare number has none — callers render an icon
 * instead, rather than showing a lone "+".
 */
export const initialsOf = (name: string) => {
  const value = String(name || '').trim();
  if (!value || isNumberLike(value)) return '';
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || '?'
  );
};

export const buildEnrichment = (
  session: DialpadSession | null,
  resolveName?: (number: string) => string,
): EnrichmentRow[] => {
  const contact = session?.contactInfo;
  const queue = session?.queueMetaData?.response;
  const campaign = session?.campaignMetaData?.response;
  const live = session?.liveCallData;

  const rows: EnrichmentRow[] = [
    {
      k: 'Number match',
      v: (() => {
        const number = String(session?.remoteNumber || '').trim();
        const name = contactDisplayName(session, resolveName);
        // Don't print "7242 → 7242" when no name was found — say so instead.
        if (name && name !== number && name !== 'Unknown contact') return `${number} → ${name}`;
        return `${number || 'Unknown'} — no contact record`;
      })(),
      src: 'Contacts',
      source: 'live',
      ms: null,
      done: true,
    },
    {
      k: 'Contact',
      v: contact
        ? [
            contact?.company,
            contact?.email,
            contact?.tags?.length ? `${contact.tags.length} tags` : '',
          ]
            .filter(Boolean)
            .join(' · ') || 'Matched'
        : 'Not in the contact book',
      src: 'Contacts',
      source: 'live',
      ms: null,
      done: !!contact,
    },
    {
      k: 'Routing',
      v: queue?.name
        ? `Queue ${queue.name}${live?.did ? ` · DID ${live.did}` : ''}`
        : live?.did
          ? `Direct · DID ${live.did}`
          : 'Direct call',
      src: 'Call routing',
      source: 'live',
      ms: null,
      done: !!(queue?.name || live?.did),
    },
    {
      k: 'Campaign',
      v: campaign?.campaign_name || campaign?.name || 'Not a campaign call',
      src: 'Campaigns',
      source: 'live',
      ms: null,
      done: !!(campaign?.campaign_name || campaign?.name),
    },
    {
      k: 'Transcription',
      v:
        session?.transcriptionHasStarted === 'start' ||
        session?.transcriptionHasStarted === 'resume'
          ? 'ASR streaming'
          : 'Standing by',
      src: 'Speech service',
      source: 'live',
      ms: null,
      done:
        session?.transcriptionHasStarted === 'start' ||
        session?.transcriptionHasStarted === 'resume',
    },
    {
      // NO BACKEND: there is no pre-call CRM/billing enrichment service today.
      k: 'Account brief',
      v: 'No pre-call enrichment service connected',
      src: 'Not connected',
      source: 'stub',
      ms: null,
      done: false,
    },
  ];

  return rows;
};

export const buildBrief = (session: DialpadSession | null): BriefRow[] => {
  const contact = session?.contactInfo;
  const name = contactDisplayName(session);
  const queue = session?.queueMetaData?.response;

  const rows: BriefRow[] = [
    {
      k: 'Who you are talking to',
      v: contact
        ? `<strong>${escapeHtml(name)}</strong>${contact?.company ? ` — ${escapeHtml(String(contact.company))}` : ''}` +
          `${contact?.email ? `<br>${escapeHtml(String(contact.email))}` : ''}` +
          `${session?.remoteNumber ? `<br>${escapeHtml(String(session.remoteNumber))}` : ''}`
        : `<strong>${escapeHtml(name)}</strong><br>No contact record — this number is not in the contact book.`,
      src: contact ? 'Contacts · live' : 'Contacts',
      source: 'live',
    },
    {
      k: 'How the call arrived',
      v: queue?.name
        ? `Queue <strong>${escapeHtml(String(queue.name))}</strong>${session?.liveCallData?.did ? ` on ${escapeHtml(String(session.liveCallData.did))}` : ''}`
        : session?.direction === 'incoming'
          ? 'Direct inbound call'
          : 'Outbound call',
      src: 'Call routing · live',
      source: 'live',
    },
    {
      // NO BACKEND: needs a summarisation service over prior interactions.
      k: 'Why they are probably calling',
      v: 'No prediction service connected. Recent calls and notes for this contact are in the History and Notes tabs.',
      src: 'Not connected',
      source: 'stub',
    },
  ];
  return rows;
};

/* ---------------------------------------------------------------------------
 * COPILOT CARDS + SAY-THIS-NEXT
 *
 * NO BACKEND. These two surfaces need a model watching the live transcript.
 * What follows produces cards only from things the console can actually
 * observe (churn wording, a missing contact record, a long hold, verification
 * not yet done) so nothing on screen is invented about the customer.
 * ------------------------------------------------------------------------ */

export const buildCards = (
  session: DialpadSession | null,
  turns: ConsoleTurn[],
  checklist: boolean[],
): CopilotCard[] => {
  const cards: CopilotCard[] = [];
  const customerText = turns
    .filter((t) => t.speaker === 'customer')
    .map((t) => t.text)
    .join(' ');

  if (!session?.contactInfo && session?.remoteNumber) {
    cards.push({
      id: 'no-contact',
      kind: 'lookup',
      title: 'No contact record',
      body: `<strong>${escapeHtml(String(session.remoteNumber))}</strong> is not in the contact book. Creating the contact now means the recap, notes and disposition attach to a record instead of a bare number.`,
      src: 'Contacts · live',
      source: 'live',
    });
  }

  if (turns.length && !checklist[0]) {
    cards.push({
      id: 'verify',
      kind: 'compliance',
      level: 'warn',
      title: 'Verification not detected',
      body: 'Nothing matching an identity check has been heard on this call yet. Verify the account holder before discussing account details.',
      src: 'Transcript · derived',
      source: 'derived',
    });
  }

  if (hasChurnSignal(customerText)) {
    cards.push({
      id: 'churn',
      kind: 'risk',
      level: 'crit',
      title: 'Churn wording detected',
      body: 'The customer used cancellation or switching language. Acknowledge the failure directly and commit to a specific action with a date rather than promising to check and call back.',
      src: 'Transcript · derived',
      source: 'derived',
    });
  }

  if (session?.isOnHold) {
    cards.push({
      id: 'hold',
      kind: 'context',
      level: 'warn',
      title: 'Customer is on hold',
      body: 'Come back on the line and give a progress update — long silent holds are the single biggest driver of repeat contacts.',
      src: 'Session · live',
      source: 'live',
    });
  }

  return cards;
};

/**
 * NO BACKEND: real "say this next" needs a live model. Until then the console
 * shows a coaching prompt only when the transcript gives it an unambiguous
 * trigger, and always labels it as guidance rather than a generated line.
 */
export const buildSayNext = (
  turns: ConsoleTurn[],
  checklist: boolean[],
): { text: string; src: string; source: CopilotSource } | null => {
  if (!turns.length) return null;
  const last = turns[turns.length - 1];
  if (last.speaker !== 'customer') return null;

  if (hasChurnSignal(last.text)) {
    return {
      text: 'Acknowledge the failure as ours, then give three concrete commitments with dates — what you are doing now, what happens next, and when you will confirm it landed.',
      src: 'Coaching rule · derived',
      source: 'derived',
    };
  }
  if (!checklist[0]) {
    return {
      text: 'Verify the account holder before going any further into the account.',
      src: 'Coaching rule · derived',
      source: 'derived',
    };
  }
  if (!checklist[2] && turns.length > 6) {
    return {
      text: 'Close the loop with a specific next action and a date — not "I will look into it".',
      src: 'Coaching rule · derived',
      source: 'derived',
    };
  }
  return null;
};

/* ---------------------------------------------------------------------------
 * LINE HEALTH — NO BACKEND. The artifact shows MOS / jitter / packet loss.
 * jssip can expose WebRTC stats; until that is plumbed through the context the
 * console reports the codec it knows and marks the rest unavailable.
 * ------------------------------------------------------------------------ */
export const lineHealth = (session: DialpadSession | null) => [
  {
    k: 'Status',
    v: session?.isOnHold ? 'On hold' : session?.hasAnswered ? 'Connected' : '—',
    source: 'live' as CopilotSource,
  },
  { k: 'Recording', v: session?.isRecording ? 'On' : 'Off', source: 'live' as CopilotSource },
  { k: 'MOS', v: 'n/a', source: 'stub' as CopilotSource },
  { k: 'Jitter', v: 'n/a', source: 'stub' as CopilotSource },
];

export const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

export const sentimentColor = (v: number) =>
  v > 15 ? 'var(--live)' : v < -15 ? 'var(--crit)' : 'var(--warn)';

export const SUGGESTED_QUESTIONS = [
  'Summarise this call so far',
  'What should I say next?',
  'What did we agree with this customer before?',
  'Draft a wrap-up note for this call',
];
