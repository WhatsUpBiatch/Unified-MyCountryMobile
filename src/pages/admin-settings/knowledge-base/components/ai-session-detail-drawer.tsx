import { getSessionChat } from '@/services/api';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, Loader2, MessageSquare, Phone, X } from 'lucide-react';

type SessionIntent = { label: string; summary: string };
type SentimentKey = 'positive' | 'neutral' | 'negative';

const sentimentScoreRows: Array<{
  key: SentimentKey;
  label: string;
  colorClass: string;
}> = [
  { key: 'positive', label: 'Positive', colorClass: 'bg-emerald-500' },
  { key: 'neutral', label: 'Neutral', colorClass: 'bg-amber-400' },
  { key: 'negative', label: 'Negative', colorClass: 'bg-rose-500' },
];

const safeNumber = (value: any) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const toDate = (value: any) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDuration = (durationMs: any) => {
  const totalSeconds = Math.max(0, Math.floor(safeNumber(durationMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}:${String(remainingMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatCost = (value: any) => `$${safeNumber(value).toFixed(2)}`;

const hasSessionCost = (session: any) =>
  session?.totalCostUSD !== null && session?.totalCostUSD !== undefined;

const getCostBasis = (session: any) =>
  String(session?.costBasis || session?.cost?.basis || '').trim();

const getCostDeductionLabel = (session: any) =>
  String(
    session?.costDeductionLabel ||
      session?.costBilling?.deductionLabel ||
      session?.cost?.billing?.deductionLabel ||
      '',
  ).trim();

const formatTime = (value: any) => {
  const date = toDate(value);
  if (!date) return '-';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatStarted = (value: any) => {
  const date = toDate(value);
  if (!date) return '-';

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDate = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

  if (sameDate(date, today)) return `Today · ${formatTime(date)}`;
  if (sameDate(date, yesterday)) return `Yesterday · ${formatTime(date)}`;

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatOffset = (startedAt: any, messageAt: any) => {
  const start = toDate(startedAt);
  const messageDate = toDate(messageAt);
  if (!start || !messageDate) return '';
  return formatDuration(Math.max(0, messageDate.getTime() - start.getTime()));
};

const formatResponseTime = (value: any) => {
  const milliseconds = safeNumber(value);
  if (!milliseconds) return '';
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
};

const getInitials = (value: any) => {
  const words = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'AI';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};

const getSessionIntents = (data: any): SessionIntent[] => {
  const seen = new Set<string>();
  return (Array.isArray(data?.intents) ? data.intents : [])
    .map((item: any) => ({
      label: String(item?.intent_label || '').trim(),
      summary: String(item?.intent_summary || '').trim(),
    }))
    .filter((item: any) => {
      const normalized = item.label.toLowerCase();
      if (!item.label || normalized === 'other' || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
};

const getSentimentLabel = (session: any) => {
  const label = String(session?.sentiment || '')
    .trim()
    .toLowerCase();
  if (!label) return 'Not analyzed';
  return label;
};

const getSentimentScore = (session: any) => {
  const scores = session?.sentiment_scores || {};
  const sentiment = getSentimentLabel(session);
  const score = safeNumber(scores?.[sentiment]);
  return score > 0 ? Math.round(score) : 0;
};

const getSentimentScores = (session: any) => {
  const scores = session?.sentiment_scores || {};
  return sentimentScoreRows.map((row) => ({
    ...row,
    score: Math.max(0, Math.min(100, Math.round(safeNumber(scores?.[row.key])))),
  }));
};

const getSentimentEmoji = (session: any) => {
  const sentiment = getSentimentLabel(session);
  if (sentiment === 'positive') return '';
  if (sentiment === 'negative') return '';
  if (sentiment === 'neutral') return '';
  return '–';
};

const getOutcome = (session: any) => {
  if (session?.status === 'active') return 'Active';
  if (session?.handoff) return 'Handoff';
  if (session?.scheduledCallback) return 'Callback';
  return 'Resolved';
};

const getOutcomeClass = (outcome: string) => {
  if (outcome === 'Resolved') return 'bg-emerald-100 text-emerald-700';
  if (outcome === 'Handoff') return 'bg-amber-100 text-amber-800';
  if (outcome === 'Callback') return 'bg-blue-100 text-blue-700';
  if (outcome === 'Active') return 'bg-slate-100 text-slate-700';
  return 'bg-rose-100 text-rose-700';
};

const getContactTitle = (session: any) => {
  const collectedData = session?.collectedData || {};
  const name = String(
    collectedData?.name?.value ||
      collectedData?.first_name?.value ||
      collectedData?.full_name?.value ||
      '',
  ).trim();

  if (name) return name;
  return session?.channel === 'call' ? 'Inbound caller' : 'visitor · web widget';
};

const getContactSubText = (session: any) => {
  const collectedData = session?.collectedData || {};
  const callerId = String(session?.callerId || session?.caller_id || '').trim();
  const phone = String(
    collectedData?.phone?.value || collectedData?.phone_number?.value || '',
  ).trim();
  const email = String(collectedData?.email?.value || '').trim();

  if (session?.channel === 'call' && callerId) return callerId;
  if (phone && email) return `${phone} · ${email}`;
  if (phone) return phone;
  if (email) return email;
  return session?.sessionId ? `sess_${String(session.sessionId).slice(0, 6)}` : '-';
};

const getAgentName = (session: any, agentById?: Map<string, any>) => {
  const agentId = String(session?.agentId || '').trim();
  const agent = agentById?.get(agentId);
  return String(
    agent?.agentName || agent?.name || session?.agentName || session?.agent_name || 'Unnamed agent',
  );
};

const makeSessionText = (messages: any[] = []) =>
  messages
    .map((item) => `${item?.displayName || item?.role || 'Message'}: ${item?.data || ''}`)
    .join('\n\n');

const downloadTextFile = (fileName: string, text: string) => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

const copyText = async (text: string) => {
  if (!text) return;
  await navigator.clipboard.writeText(text);
};

const ChannelPill = ({
  channel,
  isSessionLabel = false,
}: {
  channel: string;
  isSessionLabel?: boolean;
}) => {
  const isCall = channel === 'call';
  const label = isCall
    ? isSessionLabel
      ? 'Voice call'
      : 'Voice'
    : isSessionLabel
      ? 'Chat session'
      : 'Chat';

  const Icon = isCall ? Phone : MessageSquare;

  return (
    <span className={`mcm-ses-ch${isCall ? ' is-call' : ''}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
};

const SentimentGraph = ({ session }: { session: any }) => {
  const score = getSentimentScore(session);
  const sentimentScores = getSentimentScores(session);
  const hasScores = sentimentScores.some((item) => item.score > 0);

  return (
    <div className="group relative flex w-fit items-center gap-[7px]">
      <span className="text-sm">{getSentimentEmoji(session)}</span>
      <div className="h-1.5 w-[70px] overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${score}%` }} />
      </div>
      <div className="pointer-events-none absolute right-0 top-6 z-30 hidden w-[190px] rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl group-hover:block">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-slate-500">
          Sentiment scores
        </div>
        {hasScores ? (
          <div className="space-y-2">
            {sentimentScores.map((item) => (
              <div key={item.key}>
                <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-700">
                  <span>{item.label}</span>
                  <span>{item.score}/100</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${item.colorClass}`}
                    style={{ width: `${item.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs font-semibold text-slate-500">Not analyzed</div>
        )}
      </div>
    </div>
  );
};

const DetailItem = ({
  label,
  value,
  className = '',
}: {
  label: string;
  value: any;
  className?: string;
}) => (
  <div>
    <div className="text-[11px] font-medium text-slate-500">{label}</div>
    <div
      className={`mt-0.5 flex items-center gap-1.5 text-[13px] font-bold text-slate-950 ${className}`}
    >
      {value}
    </div>
  </div>
);

type AiSessionDetailDrawerProps = {
  session: any;
  agentById?: Map<string, any>;
  isLoading?: boolean;
  emptyMessage?: string;
  onClose: () => void;
};

const AiSessionDetailDrawer = ({
  session,
  agentById,
  isLoading = false,
  emptyMessage = 'No AI session found for this call.',
  onClose,
}: AiSessionDetailDrawerProps) => {
  const sessionId = session?.sessionId;
  const { data: selectedMessages = [], isLoading: isLoadingMessages } = useQuery({
    queryKey: ['getSessionChat', session?.agentId, sessionId],
    queryFn: () =>
      getSessionChat({
        agentId: session?.agentId,
        sessionId,
      }),
    select: (data) => data?.data?.messages || [],
    enabled: Boolean(session?.agentId) && Boolean(sessionId),
  });

  const selectedIntents = getSessionIntents(session);
  const transcriptText = makeSessionText(selectedMessages);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45">
      <div className="flex h-full w-full max-w-[560px] flex-col bg-slate-50 shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-extrabold text-slate-950">
                {session ? getContactTitle(session) : 'AI session'}
              </h2>
              {session ? <ChannelPill channel={session?.channel} isSessionLabel /> : null}
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {session
                ? `${getContactSubText(session)} · ${getAgentName(session, agentById)} · ${formatStarted(
                    session?.startedAt || session?.createdAt,
                  )}`
                : 'Loading session details...'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close session"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading session...
          </div>
        ) : !session ? (
          <div className="flex flex-1 items-center justify-center px-5 text-center text-sm font-semibold text-slate-500">
            {emptyMessage}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-[18px]">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.04em] text-slate-500">
                  Session details
                </div>
                <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
                  <DetailItem
                    label="Channel"
                    value={session?.channel === 'call' ? 'Voice' : 'Chat'}
                  />
                  <DetailItem label="Agent" value={getAgentName(session, agentById)} />
                  <DetailItem
                    label="Started"
                    value={formatStarted(session?.startedAt || session?.createdAt)}
                  />
                  <DetailItem label="Duration" value={formatDuration(session?.durationMs)} />
                  <DetailItem
                    label="Cost"
                    className="items-start"
                    value={
                      <div className="flex flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-emerald-700">
                            {hasSessionCost(session) ? formatCost(session?.totalCostUSD) : '-'}
                          </span>
                          {getCostBasis(session) ? (
                            <span className="text-[11px] font-medium text-slate-500">
                              · {getCostBasis(session)}
                            </span>
                          ) : null}
                        </div>
                        {getCostDeductionLabel(session) ? (
                          <span className="text-[11px] font-semibold text-slate-500">
                            {getCostDeductionLabel(session)}
                          </span>
                        ) : null}
                      </div>
                    }
                  />
                  <DetailItem
                    label="Outcome"
                    value={
                      <span
                        className={`inline-flex rounded-xl px-[9px] py-[3px] text-[11px] font-bold ${getOutcomeClass(
                          getOutcome(session),
                        )}`}
                      >
                        {getOutcome(session)}
                      </span>
                    }
                  />
                  <DetailItem label="Intent" value={selectedIntents[0]?.label || 'Not analyzed'} />
                  <DetailItem
                    label="Sentiment"
                    value={
                      getSentimentScore(session) ? (
                        <div className="flex items-center gap-2">
                          <SentimentGraph session={session} />
                          <span>{getSentimentScore(session)}/100</span>
                        </div>
                      ) : (
                        'Not analyzed'
                      )
                    }
                  />
                  <DetailItem
                    label="CSAT"
                    value={
                      safeNumber(session?.csat?.score) ? (
                        <span className="text-[#F59E0B]">
                          {'★'.repeat(Math.round(session.csat.score))}
                          {'☆'.repeat(Math.max(0, 5 - Math.round(session.csat.score)))} ·{' '}
                          {session.csat.score}/5
                        </span>
                      ) : (
                        'Not analyzed'
                      )
                    }
                  />
                </div>
              </div>

              <div className="mt-3.5 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
                <div className="text-[11px] font-bold uppercase tracking-[0.04em] text-slate-500">
                  ✨ AI summary
                </div>
                <p className="mt-2.5 text-[13px] leading-relaxed text-slate-700">
                  {String(session?.summary || '').trim() ||
                    'No summary available for this session.'}
                </p>
                {selectedIntents.length ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {selectedIntents.map((intent) => (
                      <span
                        key={intent.label}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                      >
                        {intent.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-3.5 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.04em] text-slate-500">
                  Transcript
                </div>
                {isLoadingMessages ? (
                  <div className="flex min-h-[180px] items-center justify-center text-slate-500">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Loading transcript...
                  </div>
                ) : selectedMessages.length ? (
                  <div>
                    {selectedMessages.map((message: any, index: number) => {
                      const isUser = message?.role === 'user';
                      const displayName = String(
                        message?.displayName || (isUser ? 'Visitor' : 'Agent'),
                      ).trim();
                      const offset = formatOffset(
                        session?.startedAt || session?.createdAt,
                        message?.at,
                      );

                      return (
                        <div
                          key={`${message?.at || index}-${message?.role}`}
                          className="border-b border-slate-100 py-2.5 first:pt-0 last:border-b-0 last:pb-0"
                        >
                          <div className="flex gap-2.5">
                            <div
                              className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                                isUser ? 'bg-slate-400' : 'bg-indigo-600'
                              }`}
                            >
                              {getInitials(displayName)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-bold text-slate-500">
                                  {displayName}
                                </span>
                                {offset ? (
                                  <span className="text-[11px] font-medium text-slate-400">
                                    {offset}
                                  </span>
                                ) : null}
                                {!isUser &&
                                message?.responseTimeMs !== null &&
                                message?.responseTimeMs !== undefined ? (
                                  <span className="text-[11px] font-medium text-slate-400">
                                    Response {formatResponseTime(message.responseTimeMs)}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
                                {message?.data}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-12 text-center text-slate-500">No transcript available.</div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-5 py-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadTextFile(
                      `${session?.sessionId || 'session'}-transcript.txt`,
                      transcriptText,
                    )
                  }
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => copyText(transcriptText)}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AiSessionDetailDrawer;
