import { useState, useMemo, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReceptionistAnalytics } from '@/services/api';
import moment from 'moment';
import { ArrowLeft, ChevronRight, Download, FileText, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { downloadAnalyticsSectionAsPdf } from '@/lib/analytics-export';
import { handleAlert } from '@/lib/utils';
import { Picker } from '@/components/mcm/picker';

/* The option list of a native <select> is drawn by the operating system, so
   no CSS reaches it: these opened as a plain white box with a hard blue
   highlight in the middle of a themed page. Same Radix picker as the rest of
   the console. */
const dateRangeOptions = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
];

interface ReceptionistAnalyticsProps {
  onClose: () => void;
  receptionists: any[];
}

const ANALYTICS_COMING_SOON = false;
const THEME_PRIMARY = 'var(--primary)';
const THEME_PRIMARY_SOFT = 'color-mix(in oklab, var(--primary) 18%, white)';
const THEME_PRIMARY_MUTED = 'color-mix(in oklab, var(--primary) 45%, white)';

// Local helper to validate hex colors
// const isValidHex = (color: string) => {
//   return /^#[0-9A-Fa-f]{6}$/.test(color);
// };

// Render small inline trends for table rows
const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 100;
  const height = 30;
  const padding = 2;
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = padding + (height - padding * 2) - ((val - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });
  const pathData = `M ${points.join(' L ')}`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const CardLoader = ({ dark = false }: { dark?: boolean }) => (
  <div
    className={`absolute inset-0 z-10 flex items-center justify-center backdrop-blur-[1px] rounded-[inherit] ${dark ? 'bg-black/40' : 'bg-white/60'}`}
  >
    <div
      className={`h-5 w-5 animate-spin rounded-full border-2 border-t-transparent ${dark ? 'border-white' : 'border-primary'}`}
    />
  </div>
);

const toNumber = (value: any) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(
    typeof value === 'string' ? value.replace('%', '').replace(/,/g, '').trim() : value,
  );
  return Number.isFinite(parsed) ? parsed : null;
};

const getPathValue = (source: any, path: string) =>
  path.split('.').reduce((value, key) => value?.[key], source);

const pickNumber = (source: any, paths: string[], defaultValue: number | null = 0) => {
  for (const path of paths) {
    const parsed = toNumber(getPathValue(source, path));
    if (parsed !== null) return parsed;
  }
  return defaultValue;
};

const pickArray = (source: any, paths: string[]) => {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (Array.isArray(value)) return value;
  }
  return [];
};

const normalizeAnalyticsPayload = (payload: any) => {
  const data =
    payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data
      : payload || {};
  const result =
    data?.result && typeof data.result === 'object' && !Array.isArray(data.result)
      ? data.result
      : {};
  const analytics = { ...result, ...data };
  const agentBreakdown = pickArray(analytics, ['agent_breakdown']);
  const receptionistBreakdown = pickArray(analytics, ['per_receptionist_breakdown']);
  const dailyBreakdown = pickArray(analytics, [
    'daily_breakdown',
    'daily_inbound_call_distribution',
  ]);
  const hourlyBreakdown = pickArray(analytics, [
    'hour_of_day_breakdown',
    'hour_of_day_distribution',
  ]);

  return {
    ...analytics,
    agent_breakdown: agentBreakdown.length ? agentBreakdown : receptionistBreakdown,
    daily_breakdown: dailyBreakdown,
    hour_of_day_breakdown: hourlyBreakdown,
  };
};

const formatPercentage = (value: number | null) =>
  value === null ? 'Not analyzed' : `${Math.round(value)}%`;

const formatCsat = (value: number | null) => {
  if (value === null) return 'Not analyzed';
  return value > 5 ? `${Math.round(value)}%` : `${value.toFixed(1)}/5`;
};

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="What is this?"
        className="grid h-4 w-4 place-items-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-500"
      >
        i
      </button>
      <span className="pointer-events-none absolute left-1/2 top-5 z-20 hidden w-56 -translate-x-1/2 rounded-md bg-slate-900 px-2.5 py-2 text-[11px] font-medium leading-4 text-white shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  );
}

function AnalyticsPanel({
  title,
  subtitle,
  tip,
  children,
  className = '',
  isLoading = false,
  dark = false,
}: {
  title: string;
  subtitle?: string;
  tip?: string;
  children: ReactNode;
  className?: string;
  isLoading?: boolean;
  dark?: boolean;
}) {
  return (
    <div
      className={`relative rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}
    >
      {isLoading && <CardLoader dark={dark} />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className={`text-[14px] font-bold ${dark ? 'text-white' : 'text-gray-950'}`}>
              {title}
            </h3>
            {tip ? <InfoTip text={tip} /> : null}
          </div>
          {subtitle ? (
            <p className={`mt-1 text-xs ${dark ? 'text-white/60' : 'text-slate-500'}`}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta = '-',
  bad = false,
  isLoading = false,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  bad?: boolean;
  isLoading?: boolean;
}) {
  return (
    <div className="relative min-h-[86px] rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      {isLoading && <CardLoader />}
      <div className="text-[12px] font-medium leading-4 text-slate-500">{label}</div>
      <div className="mt-2 text-[25px] font-black leading-8 text-gray-950">{value}</div>
      <div className={`mt-1 text-[12px] font-medium ${bad ? 'text-red-500' : 'text-emerald-500'}`}>
        {delta}
      </div>
    </div>
  );
}

function TopicProgressRow({ name, value }: { name: string; value: number }) {
  return (
    <div className="flex items-center gap-3 border-b border-gray-100 py-2.5 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{name}</span>
      <span className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      <span className="w-10 text-right text-xs font-bold text-slate-800">{value}%</span>
    </div>
  );
}

export default function ReceptionistAnalytics({
  onClose,
  receptionists,
}: ReceptionistAnalyticsProps) {
  const navigate = useNavigate();
  const analyticsContentRef = useRef<HTMLDivElement | null>(null);
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | '7d' | '30d' | '90d'>('7d');
  const [selectedRepId, setSelectedRepId] = useState<string>('all');
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const { startDate, endDate } = useMemo(() => {
    const end = moment().format('YYYY-MM-DD');
    let start = moment().subtract(7, 'days').format('YYYY-MM-DD');
    let finalEnd = end;

    if (dateRange === 'today') {
      start = moment().format('YYYY-MM-DD');
      finalEnd = moment().format('YYYY-MM-DD');
    } else if (dateRange === 'yesterday') {
      start = moment().subtract(1, 'days').format('YYYY-MM-DD');
      finalEnd = moment().subtract(1, 'days').format('YYYY-MM-DD');
    } else if (dateRange === '7d') {
      start = moment().subtract(7, 'days').format('YYYY-MM-DD');
      finalEnd = end;
    } else if (dateRange === '30d') {
      start = moment().subtract(30, 'days').format('YYYY-MM-DD');
      finalEnd = end;
    } else if (dateRange === '90d') {
      start = moment().subtract(90, 'days').format('YYYY-MM-DD');
      finalEnd = end;
    }
    return { startDate: start, endDate: finalEnd };
  }, [dateRange]);

  const agentId = selectedRepId === 'all' ? '' : selectedRepId;
  const viewerTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  //
  const {
    data: analyticsData,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['receptionistAnalytics', startDate, endDate, agentId, viewerTimeZone],
    queryFn: async () => {
      const response = await getReceptionistAnalytics({
        startDate,
        endDate,
        agentId,
        timezone: viewerTimeZone,
      });
      return response.data;
    },
    enabled: !ANALYTICS_COMING_SOON,
  });

  if (error) {
    console.error('Receptionist Analytics API Error:', error);
  }
  const analytics = useMemo(() => normalizeAnalyticsPayload(analyticsData), [analyticsData]);

  // Format duration from seconds to M:SS
  const formatDuration = (seconds: number) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Merge parent page's actual receptionists if available
  const activeReceptionists = useMemo(() => {
    const apiRows = Array.isArray(analytics?.agent_breakdown) ? analytics.agent_breakdown : [];
    const apiMap = new Map<string, any>();
    apiRows.forEach((item: any) => {
      const id = String(item.agent_uuid || item.id || '').trim();
      if (id) apiMap.set(id, item);
    });

    const parentRows = Array.isArray(receptionists) ? receptionists : [];
    const combinedRows = [...parentRows];
    const parentIds = new Set(
      parentRows.map((rep: any) => String(rep.agent_uuid || rep.id || '').trim()).filter(Boolean),
    );
    apiRows.forEach((item: any) => {
      const id = String(item.agent_uuid || item.id || '').trim();
      if (id && !parentIds.has(id)) combinedRows.push(item);
    });

    return combinedRows.map((rep, idx) => {
      const colorOptions = ['#0d9488', THEME_PRIMARY, '#d97706', '#64748b', '#db2777'];
      const sparklineColors = ['#14b8a6', THEME_PRIMARY, '#f59e0b', '#94a3b8', '#ec4899'];
      const colorIndex = idx % colorOptions.length;
      const repId = rep.agent_uuid || rep.id || String(idx);
      const apiItem = apiMap.get(String(repId)) || rep;
      const callsVal =
        pickNumber(apiItem, ['total_calls', 'calls_handled', 'session_calls', 'calls'], 0) || 0;
      const handoffs = pickNumber(apiItem, ['handoffs', 'live_transfers', 'transfers'], 0) || 0;
      const resolution =
        pickNumber(
          apiItem,
          ['resolution_rate', 'resolution'],
          callsVal ? ((callsVal - handoffs) / callsVal) * 100 : 0,
        ) || 0;
      const confidence = pickNumber(apiItem, ['avg_confidence', 'confidence'], null);
      const csat = pickNumber(
        apiItem,
        ['csat', 'avg_csat', 'customer_satisfaction', 'post_call_csat'],
        null,
      );
      const sentiment = pickNumber(apiItem, ['avg_sentiment', 'sentiment_score'], null);
      const scheduledCallbacks =
        pickNumber(apiItem, ['scheduled_callbacks', 'scheduledCallbacks'], 0) || 0;
      const resolved =
        pickNumber(apiItem, ['resolved', 'resolved_calls'], Math.max(0, callsVal - handoffs)) || 0;

      return {
        id: repId,
        name: rep.agentName || rep.agent_name || apiItem.agent_name || 'Unnamed Receptionist',
        subtitle: rep.forward_call_actions?.roleUseCase || 'Inbound virtual agent',
        initials: (rep.agentName || rep.agent_name || apiItem.agent_name || 'U')
          .charAt(0)
          .toUpperCase(),
        avatarBg: colorOptions[colorIndex],
        sparklineColor: sparklineColors[colorIndex],
        calls: callsVal,
        resolution: Math.round(resolution),
        csat,
        csatLabel: formatCsat(csat),
        confidence,
        confidenceLabel: formatPercentage(confidence),
        sentiment,
        talkTime: pickNumber(apiItem, ['ai_talk_percentage', 'talk_time_percentage'], 0) || 0,
        sparklineData: [0, 0, 0, 0, 0, 0, 0, 0],
        unansweredQuestions:
          pickNumber(apiItem, ['unanswered_questions_count', 'unanswered_questions'], 0) || 0,
        outcomes: { resolved, transfer: handoffs, scheduledCallbacks },
        volume: [],
        sentimentTrend: [],
        topics: [],
      };
    });
  }, [receptionists, analytics]);

  // Find currently selected receptionist details
  const selectedRep = useMemo(() => {
    return activeReceptionists.find((r) => r.id === selectedRepId);
  }, [selectedRepId, activeReceptionists]);

  // Aggregate metrics based on selected filters
  const metrics = useMemo(() => {
    if (selectedRep) {
      const calls = selectedRep.calls;
      const res = selectedRep.resolution;
      const duration = formatDuration(analytics?.average_call_duration ?? 0);
      const liveTransfers = selectedRep.outcomes.transfer;
      const scheduledCallbacks = selectedRep.outcomes.scheduledCallbacks;

      return {
        totalCalls: calls,
        resolution: `${res}%`,
        avgDuration: duration,
        transfers: liveTransfers,
        scheduledCallbacks,
        csat: selectedRep.csatLabel,
      };
    }

    // "All" selected -> sum metrics
    const totalCalls =
      pickNumber(
        analytics,
        ['calls_handled', 'total_calls', 'livekit_calls'],
        activeReceptionists.reduce((acc, r) => acc + r.calls, 0),
      ) || 0;
    const avgRes =
      pickNumber(
        analytics,
        ['resolution_rate'],
        activeReceptionists.length > 0
          ? Math.round(
              activeReceptionists.reduce((acc, r) => acc + r.resolution, 0) /
                activeReceptionists.length,
            )
          : 0,
      ) || 0;
    const totalTransfers =
      pickNumber(
        analytics,
        ['handoffs', 'live_transfers', 'transfers', 'outcome_breakdown.live_transfer'],
        activeReceptionists.reduce((acc, r) => acc + r.outcomes.transfer, 0),
      ) || 0;
    const totalScheduledCallbacks =
      pickNumber(
        analytics,
        [
          'scheduled_callbacks',
          'scheduledCallbacks',
          'outcome_breakdown.scheduled_callback',
          'outcome_breakdown.scheduled_callbacks',
        ],
        activeReceptionists.reduce((acc, r) => acc + r.outcomes.scheduledCallbacks, 0),
      ) || 0;
    const avgCsat = pickNumber(
      analytics,
      ['csat', 'avg_csat', 'customer_satisfaction', 'post_call_csat'],
      null,
    );

    return {
      totalCalls,
      resolution: `${avgRes}%`,
      avgDuration: formatDuration(analytics?.average_call_duration ?? 0),
      transfers: totalTransfers,
      scheduledCallbacks: totalScheduledCallbacks,
      csat: formatCsat(avgCsat),
    };
  }, [selectedRep, activeReceptionists, analyticsData, analytics]);

  // Donut ratios (Talk-to-listen) — show 0 until API provides data
  const talkListenRatio = useMemo(() => {
    const aiPercent = selectedRep ? selectedRep.talkTime : 0;
    const callerPercent = 100 - aiPercent;
    return [
      { name: 'AI talking', value: aiPercent, color: THEME_PRIMARY },
      { name: 'Caller talking / silence', value: callerPercent, color: '#e2e8f0' },
    ];
  }, [selectedRep]);

  // Pie outcomes
  const pieData = useMemo(() => {
    const outcomes = selectedRep
      ? selectedRep.outcomes
      : {
          resolved:
            pickNumber(
              analytics,
              ['outcome_breakdown.resolved', 'resolved', 'resolved_calls'],
              activeReceptionists.reduce((acc, r) => acc + r.outcomes.resolved, 0),
            ) || 0,
          transfer:
            pickNumber(
              analytics,
              ['outcome_breakdown.live_transfer', 'handoffs', 'live_transfers', 'transfers'],
              activeReceptionists.reduce((acc, r) => acc + r.outcomes.transfer, 0),
            ) || 0,
          scheduledCallbacks:
            pickNumber(
              analytics,
              [
                'scheduled_callbacks',
                'scheduledCallbacks',
                'outcome_breakdown.scheduled_callback',
                'outcome_breakdown.scheduled_callbacks',
              ],
              activeReceptionists.reduce((acc, r) => acc + r.outcomes.scheduledCallbacks, 0),
            ) || 0,
        };

    const total = outcomes.resolved + outcomes.transfer + outcomes.scheduledCallbacks || 1;
    return [
      {
        name: 'Resolved on call',
        value: outcomes.resolved,
        color: '#10b981',
        pct: Math.round((outcomes.resolved / total) * 100),
      },
      {
        name: 'Live transfer',
        value: outcomes.transfer,
        color: '#f59e0b',
        pct: Math.round((outcomes.transfer / total) * 100),
      },
      {
        name: 'Scheduled callback',
        value: outcomes.scheduledCallbacks,
        color: THEME_PRIMARY_MUTED,
        pct: Math.round((outcomes.scheduledCallbacks / total) * 100),
      },
    ];
  }, [selectedRep, activeReceptionists, analytics]);

  // Volume by day
  const barData = useMemo(() => {
    const dailyBreakdown = pickArray(analytics, [
      'daily_breakdown',
      'daily_inbound_call_distribution',
    ]);
    if (dailyBreakdown.length) {
      const dayMap = new Map<string, number>();
      dailyBreakdown.forEach((item: any) => {
        if (item.date) {
          const formatted = moment(item.date).format('YYYY-MM-DD');
          dayMap.set(
            formatted,
            pickNumber(item, ['calls_handled', 'session_calls', 'total_calls', 'calls'], 0) || 0,
          );
        }
      });

      const list = [];
      const curr = moment(startDate);
      const end = moment(endDate);
      let limit = 0;
      while (curr.isSameOrBefore(end, 'day') && limit < 100) {
        const dateStr = curr.format('YYYY-MM-DD');
        list.push({
          name: curr.format('ddd DD'),
          calls: dayMap.get(dateStr) ?? 0,
          dateStr,
        });
        curr.add(1, 'day');
        limit++;
      }
      return list;
    }

    // No data yet — return empty placeholder range
    const list = [];
    const curr = moment(startDate);
    const end = moment(endDate);
    let limit = 0;
    while (curr.isSameOrBefore(end, 'day') && limit < 100) {
      list.push({ name: curr.format('ddd DD'), calls: 0, dateStr: curr.format('YYYY-MM-DD') });
      curr.add(1, 'day');
      limit++;
    }
    return list;
  }, [analytics, startDate, endDate]);

  const sentimentChartData = useMemo(() => {
    const trendMap = new Map<string, any>();
    const sentimentTrend = pickArray(analytics, ['sentiment_trend']);
    if (sentimentTrend.length) {
      sentimentTrend.forEach((item: any) => {
        if (item.date) trendMap.set(moment(item.date).format('YYYY-MM-DD'), item);
      });
    }

    const list = [];
    const curr = moment(startDate);
    const end = moment(endDate);
    let limit = 0;
    while (curr.isSameOrBefore(end, 'day') && limit < 100) {
      const dateStr = curr.format('YYYY-MM-DD');
      const item = trendMap.get(dateStr);
      list.push({
        name: curr.format('ddd DD'),
        score: Number(item?.score || 0),
        count: Number(item?.count || 0),
      });
      curr.add(1, 'day');
      limit++;
    }
    return list;
  }, [analytics, startDate, endDate]);

  const conversationTopics = useMemo(() => {
    return pickArray(analytics, ['conversation_topics', 'top_user_intents', 'top_topics', 'topics'])
      .map((topic: any) => ({
        name: topic.name || topic.intent || topic.topic || topic.label || 'Unknown',
        percentage: pickNumber(topic, ['percentage', 'percent', 'pct'], 0) || 0,
      }))
      .filter((topic: any) => topic.name);
  }, [analytics]);

  // Format hour values to AM/PM labels
  const formatHourLabel = (hour: number) => {
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour;
    return `${displayHour} ${ampm}`;
  };

  // Peak call hours by hour of day — reads from daily_breakdown hourly_breakdown
  const peakCallHours = useMemo(() => {
    const dailyBreakdown = pickArray(analytics, [
      'daily_breakdown',
      'daily_inbound_call_distribution',
    ]);
    const hourlyBreakdown = pickArray(analytics, [
      'hour_of_day_breakdown',
      'hour_of_day_distribution',
    ]);
    // Aggregate hourly data from daily_breakdown if available
    if (dailyBreakdown.length || hourlyBreakdown.length) {
      const hourMap = new Map<number, number>();
      dailyBreakdown.forEach((day: any) => {
        if (Array.isArray(day.hourly_breakdown)) {
          day.hourly_breakdown.forEach((h: any) => {
            const current = hourMap.get(h.hour) ?? 0;
            hourMap.set(h.hour, current + (pickNumber(h, ['calls_handled', 'calls'], 0) || 0));
          });
        }
      });

      // Also support top-level hour_of_day_breakdown
      if (hourlyBreakdown.length) {
        hourlyBreakdown.forEach((h: any) => {
          const current = hourMap.get(h.hour) ?? 0;
          hourMap.set(h.hour, current + (pickNumber(h, ['calls_handled', 'calls'], 0) || 0));
        });
      }

      const hoursData = [];
      for (let h = 0; h < 24; h++) {
        hoursData.push({
          name: formatHourLabel(h),
          calls: hourMap.get(h) ?? 0,
          hour: h,
        });
      }
      return hoursData.filter((h) => h.calls > 0 || (h.hour >= 8 && h.hour <= 20));
    }

    // No data yet — return 0 for standard business hours
    const emptyHours = [];
    for (let h = 8; h <= 20; h++) {
      emptyHours.push({ name: formatHourLabel(h), calls: 0, hour: h });
    }
    return emptyHours;
  }, [analytics]);

  const maxCalls = useMemo(() => {
    if (!peakCallHours || peakCallHours.length === 0) return 1;
    return Math.max(...peakCallHours.map((h) => h.calls));
  }, [peakCallHours]);

  // Dynamic bar coloring helper for Hour-of-day peak loads
  const getHourBarColor = (calls: number) => {
    if (calls <= 0 || maxCalls <= 0) return THEME_PRIMARY_SOFT;

    const relativeCallVolume = calls / maxCalls;
    if (relativeCallVolume >= 0.75) return THEME_PRIMARY;
    if (relativeCallVolume >= 0.4) return THEME_PRIMARY_MUTED;
    return THEME_PRIMARY_SOFT;
  };

  const periodLabel = `${moment(startDate).format('MMM D')} - ${moment(endDate).format('MMM D, YYYY')}`;
  const rangeDays = Math.max(1, moment(endDate).diff(moment(startDate), 'days') + 1);
  const periodCompare =
    dateRange === 'today'
      ? 'compared to yesterday'
      : dateRange === 'yesterday'
        ? 'compared to previous day'
        : `compared to previous ${rangeDays} days`;
  const kpiCards = [
    { label: 'Total calls', value: metrics.totalCalls },
    { label: 'Resolution rate', value: metrics.resolution },
    { label: 'Avg call duration', value: metrics.avgDuration },
    { label: 'Live transfers', value: metrics.transfers, bad: true },
    {
      label: 'CSAT (post-call)',
      value:
        typeof metrics.csat === 'string' && metrics.csat.endsWith('/5') ? (
          <>
            {metrics.csat.replace('/5', '')}
            <span className="text-sm text-slate-400">/5</span>
          </>
        ) : (
          metrics.csat
        ),
    },
  ];
  const talkPercent = Number(talkListenRatio[0]?.value || 0);
  const talkItems = [
    { name: 'AI talking', value: talkPercent, color: THEME_PRIMARY, pct: talkPercent },
    {
      name: 'Caller talking / silence',
      value: Math.max(0, 100 - talkPercent),
      color: '#cbd5e1',
      pct: Math.max(0, 100 - talkPercent),
    },
  ];
  const exportAnalyticsCsv = () => {
    const rowsToExport = selectedRep ? [selectedRep] : activeReceptionists;
    const rows: Array<Array<string | number>> = [
      ['Metric', 'Value'],
      ['Date range', `${startDate} to ${endDate}`],
      ['Total calls', metrics.totalCalls],
      ['Resolution rate', metrics.resolution],
      ['Average call duration', metrics.avgDuration],
      ['Live transfers', metrics.transfers],
      ['Scheduled callbacks', metrics.scheduledCallbacks],
      ['CSAT', metrics.csat],
      [],
      [
        'Receptionist',
        'Calls',
        'Resolution',
        'Confidence',
        'CSAT',
        'Live transfers',
        'Scheduled callbacks',
      ],
      ...rowsToExport.map((receptionist) => [
        receptionist.name,
        receptionist.calls,
        `${receptionist.resolution}%`,
        receptionist.confidenceLabel,
        receptionist.csatLabel,
        receptionist.outcomes.transfer,
        receptionist.outcomes.scheduledCallbacks,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `receptionist-analytics-${startDate}-to-${endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const exportAnalyticsPdf = async () => {
    if (!analyticsContentRef.current || isExportingPdf) return;

    setIsExportingPdf(true);
    try {
      await downloadAnalyticsSectionAsPdf(
        analyticsContentRef.current,
        `receptionist-analytics-${startDate}-to-${endDate}.pdf`,
      );
    } catch (error) {
      console.error('Failed to export receptionist analytics PDF:', error);
      handleAlert({ text: 'Unable to generate the PDF report. Please try again.', type: 'error' });
    } finally {
      setIsExportingPdf(false);
    }
  };

  if (ANALYTICS_COMING_SOON) {
    // Existing analytics implementation is preserved below; temporarily show a simple placeholder.
    return (
      <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f3f4f6] text-[#07142f]">
        <div className="flex min-h-[64px] shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <button
              type="button"
              onClick={() => navigate('/admin-settings/knowledge/ai-agent')}
              className="transition-colors hover:text-primary"
            >
              AI Agents
            </button>
            <span>/</span>
            <button
              type="button"
              onClick={onClose}
              className="transition-colors hover:text-primary"
            >
              AI Receptionists
            </button>
            <span>/</span>
            <span className="font-semibold text-gray-950">Analytics</span>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-base font-semibold text-slate-600">Coming soon</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f3f4f6] text-[#07142f]">
      <div className="flex min-h-[72px] shrink-0 flex-col gap-3 border-b border-gray-200 bg-white px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
          <button
            type="button"
            onClick={() => navigate('/admin-settings/knowledge/ai-agent')}
            className="transition-colors hover:text-primary"
          >
            AI Agents
          </button>
          <span>/</span>
          <button type="button" onClick={onClose} className="transition-colors hover:text-primary">
            AI Receptionists
          </button>
          <span>/</span>
          <span className="font-semibold text-gray-950">Analytics & Reports</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Picker
            label="Period"
            value={dateRange}
            options={dateRangeOptions}
            onChange={(option) => setDateRange(option.value as any)}
          />
          <Picker
            label="Receptionist"
            value={selectedRepId}
            options={[
              { label: 'All receptionists', value: 'all' },
              ...activeReceptionists.map((r) => ({ label: r.name, value: r.id })),
            ]}
            onChange={(option) => setSelectedRepId(option.value)}
          />

          <Button
            type="button"
            variant="outline"
            onClick={exportAnalyticsCsv}
            className="h-[34px] gap-1 text-xs font-semibold text-slate-700 bg-white border border-gray-200"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => void exportAnalyticsPdf()}
            disabled={isExportingPdf}
            className="h-[34px] gap-1 text-xs font-semibold text-slate-700 bg-white border border-gray-200"
          >
            <FileText className="h-3.5 w-3.5" />
            {isExportingPdf ? 'Generating PDF...' : 'PDF Report'}
          </Button>

          <Button
            variant="primary"
            onClick={onClose}
            className="h-[34px] gap-1.5 bg-primary text-xs font-semibold text-white shadow-sm transition-all hover:bg-primary/90"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to list
          </Button>
        </div>
      </div>

      <div
        ref={analyticsContentRef}
        className="w-full flex-1 space-y-3.5 overflow-y-auto px-7 py-6"
      >
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
          <Info className="h-4 w-4 shrink-0" />
          <span>
            <strong>{periodLabel}</strong> · {periodCompare}. Voice-specific KPIs below — sentiment,
            talk-to-listen ratio, call outcomes, peak hours.
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {kpiCards.map((card) => (
            <KpiCard
              key={card.label}
              label={card.label}
              value={card.value}
              bad={card.bad}
              isLoading={isLoading}
            />
          ))}
        </div>

        {selectedRepId === 'all' ? (
          <AnalyticsPanel
            title="Per-receptionist breakdown"
            subtitle="How each voice receptionist is performing — pick one above to drill in."
            isLoading={isLoading}
          >
            <div className="mt-4 flex items-center justify-end">
              <span className="rounded-full border border-gray-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                All receptionists
              </span>
            </div>
            <div className="mt-2 divide-y divide-gray-100">
              {activeReceptionists.map((rep) => (
                <div
                  key={rep.id}
                  onClick={() => setSelectedRepId(rep.id)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-slate-50"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white shadow-sm"
                      style={{ backgroundColor: rep.avatarBg }}
                    >
                      {rep.initials}
                    </div>
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-bold text-gray-950">{rep.name}</h4>
                      <p className="text-xs text-slate-500 truncate">{rep.subtitle}</p>
                    </div>
                  </div>
                  <div className="hidden w-[420px] shrink-0 grid-cols-[64px_96px_112px_100px] items-center gap-4 md:grid">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400">
                        Calls
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-slate-800">{rep.calls}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400">
                        Resolution
                      </div>
                      <div
                        className={`mt-0.5 text-sm font-bold ${
                          rep.resolution >= 80
                            ? 'text-emerald-600'
                            : rep.resolution >= 75
                              ? 'text-primary'
                              : 'text-amber-500'
                        }`}
                      >
                        {rep.resolution}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400">
                        CSAT
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-slate-800">{rep.csatLabel}</div>
                    </div>
                    <div className="w-full">
                      <Sparkline data={rep.sparklineData} color={rep.sparklineColor} />
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </div>
              ))}
            </div>
          </AnalyticsPanel>
        ) : null}

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[2fr_1fr]">
          <AnalyticsPanel
            title={`Call volume - ${dateRange === 'today' ? 'today' : 'last 7 days'}`}
            subtitle="Daily bars showing inbound call distribution. Click a day for a per-hour breakdown."
            tip="Daily count of inbound calls. Helps spot trends, weekly seasonality, and unusual spikes that may need extra capacity."
            isLoading={isLoading}
          >
            <div className="mt-5 h-[150px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <XAxis
                    dataKey="name"
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <Tooltip cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} />
                  <Bar
                    dataKey="calls"
                    radius={[6, 6, 0, 0]}
                    fill={THEME_PRIMARY}
                    minPointSize={4}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </AnalyticsPanel>

          <AnalyticsPanel
            title="Call outcomes"
            subtitle="7-day breakdown across all receptionists"
            tip="How calls ended: resolved on the call, transferred to a human, or scheduled a callback."
            isLoading={isLoading}
          >
            <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row">
              <div className="relative h-[150px] w-[150px] shrink-0">
                <div className="absolute inset-0 z-10 grid place-items-center text-center pointer-events-none">
                  <div>
                    <div className="text-[22px] font-black leading-6 text-gray-950">
                      {metrics.totalCalls}
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400">
                      calls
                    </div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={74}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`outcome-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full space-y-2">
                {pieData.map((item) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-600">
                      {item.name}
                    </span>
                    <span className="font-bold text-slate-800">{item.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </AnalyticsPanel>
        </div>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <AnalyticsPanel
            title="Sentiment trend - last 7 days"
            subtitle="Caller sentiment score (0-100) at end of call"
            tip="Caller sentiment score calculated from call transcript analysis. 70+ is healthy."
            isLoading={isLoading}
          >
            <div className="mt-5 h-[150px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sentimentChartData}>
                  <XAxis
                    dataKey="name"
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <Tooltip cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} />
                  <Bar dataKey="score" radius={[6, 6, 0, 0]} fill="#10b981" minPointSize={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </AnalyticsPanel>

          <AnalyticsPanel
            title="Talk-to-listen ratio"
            subtitle="Voice-AI best practice: 35-55% AI talk time. Higher = caller cannot get a word in."
            tip="Fraction of the call where the AI is speaking vs the caller speaking or silent."
            isLoading={isLoading}
          >
            <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row">
              <div className="relative h-[150px] w-[150px] shrink-0">
                <div className="absolute inset-0 z-10 grid place-items-center text-center pointer-events-none">
                  <div>
                    <div className="text-[22px] font-black leading-6 text-gray-950">
                      {talkPercent}%
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400">
                      AI talk
                    </div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={talkItems}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={74}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {talkItems.map((entry, index) => (
                        <Cell key={`talk-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full space-y-2">
                {talkItems.map((item) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-600">
                      {item.name}
                    </span>
                    <span className="font-bold text-slate-800">{item.pct}%</span>
                  </div>
                ))}
                <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-800">
                  {talkPercent
                    ? 'Healthy range — receptionist is letting callers speak.'
                    : 'No voice talk-time data captured yet.'}
                </div>
              </div>
            </div>
          </AnalyticsPanel>
        </div>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <AnalyticsPanel
            title="Top conversation topics"
            subtitle="What callers ask about most"
            tip="Most frequent topics callers raise, derived from intent classification."
            isLoading={isLoading}
          >
            <div className="mt-4">
              {conversationTopics.length ? (
                conversationTopics.map((topic, idx) => (
                  <TopicProgressRow
                    key={`${topic.name}-${idx}`}
                    name={topic.name}
                    value={topic.percentage}
                  />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-slate-50 px-4 py-7 text-center text-xs font-semibold text-slate-500">
                  No topic data yet
                </div>
              )}
            </div>
          </AnalyticsPanel>

          <AnalyticsPanel
            title="Per-receptionist performance"
            subtitle="7-day metrics, click for full report"
            tip="Side-by-side comparison across receptionists. Click any row to drill into that receptionist's full report."
            isLoading={isLoading}
          >
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400">
                    <th className="py-2.5">Receptionist</th>
                    <th className="py-2.5 text-right">Calls</th>
                    <th className="py-2.5 text-right">Res%</th>
                    <th className="py-2.5 text-right">Sent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activeReceptionists.slice(0, 5).map((rep) => (
                    <tr
                      key={rep.id}
                      className="cursor-pointer transition-colors hover:bg-slate-50/70"
                      onClick={() => setSelectedRepId(rep.id)}
                    >
                      <td className="py-3 font-semibold text-slate-800">{rep.name}</td>
                      <td className="py-3 text-right font-bold text-slate-800">{rep.calls}</td>
                      <td className="py-3 text-right font-bold text-emerald-600">
                        {rep.resolution}%
                      </td>
                      <td className="py-3 text-right font-semibold text-slate-800">
                        {rep.sentiment !== null
                          ? `${Math.round(rep.sentiment)}`
                          : 'Not analyzed'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AnalyticsPanel>
        </div>

        <div className="grid grid-cols-1 gap-3.5">
          <AnalyticsPanel
            title="Peak call hours - last 7 days"
            subtitle="Hour-of-day distribution. Darker bars = more calls."
            tip="Hour-of-day distribution. Use to schedule live agents for overflow during peak hours."
            isLoading={isLoading}
          >
            <div className="mt-5 h-[120px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={peakCallHours}>
                  <XAxis
                    dataKey="name"
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    tickMargin={8}
                  />
                  <Tooltip cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} />
                  <Bar dataKey="calls" radius={[5, 5, 0, 0]} minPointSize={4}>
                    {peakCallHours.map((entry, index) => (
                      <Cell
                        key={`peak-${index}`}
                        fill={getHourBarColor(Number(entry.calls || 0))}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </AnalyticsPanel>
        </div>

        <div className="grid grid-cols-1 gap-3.5">
          <AnalyticsPanel
            title="Unanswered caller questions"
            subtitle="Pick a receptionist to see their unanswered questions, then answer each one."
            tip="Questions callers asked but the receptionist could not answer with confidence."
            isLoading={isLoading}
          >
            <div className="mt-4 space-y-2.5">
              {activeReceptionists.slice(0, 4).map((rep) => (
                <div
                  key={rep.id}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-100 p-3 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-white"
                      style={{ backgroundColor: rep.avatarBg }}
                    >
                      {rep.initials}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-slate-900">{rep.name}</h4>
                      <p className="text-[10px] text-slate-500">{rep.subtitle}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {rep.unansweredQuestions > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-[10px] font-bold text-red-600">
                        {rep.unansweredQuestions} questions
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600">
                        All clear ✓
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                </div>
              ))}
            </div>
          </AnalyticsPanel>
        </div>
      </div>
    </div>
  );
}
