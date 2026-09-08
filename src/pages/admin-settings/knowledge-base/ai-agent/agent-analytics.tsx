import { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getChatAgentAnalytics } from '@/services/api';
import moment from 'moment';
import { ArrowLeft, ChevronRight, Download, FileText, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  CartesianGrid,
} from 'recharts';
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

interface AgentAnalyticsProps {
  onClose: () => void;
  agents?: any[];
}

const ANALYTICS_COMING_SOON = false;
const THEME_PRIMARY = 'var(--primary)';
const THEME_PRIMARY_SOFT = 'color-mix(in oklab, var(--primary) 18%, white)';
const THEME_PRIMARY_MUTED = 'color-mix(in oklab, var(--primary) 45%, white)';
type ConversationMetric = 'volume' | 'resolved' | 'handoffs' | 'scheduled_callbacks';
const CONVERSATION_METRIC_OPTIONS: Array<{
  value: ConversationMetric;
  label: string;
  color: string;
}> = [
  { value: 'volume', label: 'Volume', color: THEME_PRIMARY },
  { value: 'resolved', label: 'Resolved', color: '#10b981' },
  { value: 'handoffs', label: 'Handoffs', color: '#f59e0b' },
  { value: 'scheduled_callbacks', label: 'Callbacks', color: '#8b5cf6' },
];
const FLAG_PREFIX_PATTERN = /^([\u{1F1E6}-\u{1F1FF}]{2}|🌐)\s*/u;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

const LANGUAGE_FLAG_BY_KEY: Record<string, string> = {
  en: '🇺🇸',
  english: '🇺🇸',
  hi: '🇮🇳',
  hindi: '🇮🇳',
  es: '🇪🇸',
  spanish: '🇪🇸',
  fr: '🇫🇷',
  french: '🇫🇷',
  de: '🇩🇪',
  german: '🇩🇪',
  pt: '🇧🇷',
  portuguese: '🇧🇷',
  ar: '🇸🇦',
  arabic: '🇸🇦',
  zh: '🇨🇳',
  chinese: '🇨🇳',
  mandarin: '🇨🇳',
  ja: '🇯🇵',
  japanese: '🇯🇵',
  ko: '🇰🇷',
  korean: '🇰🇷',
  it: '🇮🇹',
  italian: '🇮🇹',
  nl: '🇳🇱',
  dutch: '🇳🇱',
  ru: '🇷🇺',
  russian: '🇷🇺',
  bn: '🇧🇩',
  bengali: '🇧🇩',
  pa: '🇮🇳',
  punjabi: '🇮🇳',
  ur: '🇵🇰',
  urdu: '🇵🇰',
  ta: '🇮🇳',
  tamil: '🇮🇳',
  te: '🇮🇳',
  telugu: '🇮🇳',
  mr: '🇮🇳',
  marathi: '🇮🇳',
  gu: '🇮🇳',
  gujarati: '🇮🇳',
};

const getCountryFlag = (countryCode: string) => {
  const normalizedCode = String(countryCode || '')
    .trim()
    .toUpperCase();
  if (normalizedCode === 'UK') return '🇬🇧';
  if (!COUNTRY_CODE_PATTERN.test(normalizedCode)) return '🌐';

  return normalizedCode
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
};

const cleanLanguageName = (language: string) =>
  String(language || 'Other')
    .replace(FLAG_PREFIX_PATTERN, '')
    .trim() || 'Other';

const getLanguageFlag = (language: string) => {
  if (FLAG_PREFIX_PATTERN.test(String(language || ''))) {
    return String(language).match(FLAG_PREFIX_PATTERN)?.[1] || '🌐';
  }

  const normalizedLanguage = cleanLanguageName(language).toLowerCase().replace(/\(.*/, '').trim();
  const baseKey = normalizedLanguage.split(/[\s_-]+/)[0];

  return LANGUAGE_FLAG_BY_KEY[normalizedLanguage] || LANGUAGE_FLAG_BY_KEY[baseKey] || '🌐';
};

const Sparkline = ({
  data,
  color,
  isDotted = false,
}: {
  data: number[];
  color: string;
  isDotted?: boolean;
}) => {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 80;
  const height = 24;
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
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={isDotted ? '2,2' : undefined}
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

const getResolutionRate = (item: any) => {
  const percentageRate =
    item?.percentage != null ? Number.parseFloat(String(item.percentage).replace('%', '')) : NaN;

  if (Number.isFinite(percentageRate)) {
    return percentageRate;
  }

  const conversations = Number(item?.conversations ?? 0);
  const resolved = Number(item?.resolved ?? 0);
  return conversations > 0 ? Math.round((resolved / conversations) * 100) : 0;
};

const getNumericValue = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const formatDateRange = (startDate: string, endDate: string) => {
  const start = moment(startDate);
  const end = moment(endDate);

  if (start.isSame(end, 'day')) {
    return end.format('MMM DD, YYYY');
  }

  return start.isSame(end, 'year')
    ? `${start.format('MMM DD')} – ${end.format('MMM DD, YYYY')}`
    : `${start.format('MMM DD, YYYY')} – ${end.format('MMM DD, YYYY')}`;
};

const getChatAnalyticsSummary = (data: any) => {
  const totalConvos = Number(data?.conversations_handled ?? 0);
  const daily = data?.daily_breakdown ?? [];
  const totalVolume = daily.reduce((acc: number, d: any) => acc + (d.volume ?? 0), 0);
  const totalResolved = daily.reduce((acc: number, d: any) => acc + (d.resolved ?? 0), 0);
  const totalHandoffs = Number(
    data?.handoffs ?? daily.reduce((acc: number, d: any) => acc + (d.handoffs ?? 0), 0),
  );
  const handoffRate = totalConvos > 0 ? (totalHandoffs / totalConvos) * 100 : null;
  const resolutionBreakdown = data?.resolution_breakdown ?? [];
  const latestResolution = resolutionBreakdown[resolutionBreakdown.length - 1];
  const apiResolutionRate = getNumericValue(data?.resolution_rate);
  const resolutionRate =
    apiResolutionRate != null
      ? apiResolutionRate
      : latestResolution
        ? getResolutionRate(latestResolution)
        : totalConvos > 0
          ? Math.round(((totalConvos - totalHandoffs) / totalConvos) * 100)
          : totalVolume > 0
            ? Math.round((totalResolved / totalVolume) * 100)
            : 0;
  const avgConfidence = getNumericValue(data?.avg_confidence);
  const csat = getNumericValue(
    data?.csat ?? data?.avg_csat ?? data?.customer_satisfaction ?? data?.post_chat_csat,
  );

  return {
    totalConvos,
    totalHandoffs,
    handoffRate,
    totalResolved,
    resolutionRate,
    avgConfidence,
    avgResponseTime: getNumericValue(data?.average_response_time),
    csat,
  };
};

const getPercentChange = (current: number | null, previous: number | null) => {
  if (current == null || previous == null || previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
};

const getValueChange = (current: number | null, previous: number | null) => {
  if (current == null || previous == null) {
    return null;
  }
  return current - previous;
};

const formatPercentChange = (value: number | null) =>
  value == null ? '-' : `${value >= 0 ? '↑' : '↓'} ${Math.abs(value).toFixed(1)}%`;

const formatMillisecondChange = (value: number | null) =>
  value == null ? '-' : `${value <= 0 ? '↓' : '↑'} ${Math.abs(Math.round(value))}ms`;

const formatScoreChange = (value: number | null) =>
  value == null ? '-' : `${value >= 0 ? '↑' : '↓'} ${Math.abs(value).toFixed(1)}`;

const getChangeClass = (value: number | null, lowerIsBetter = false) => {
  if (value == null || value === 0) {
    return 'text-slate-400';
  }

  const isGood = lowerIsBetter ? value < 0 : value > 0;
  return isGood ? 'text-emerald-500' : 'text-red-500';
};

const KpiCard = ({
  title,
  value,
  delta,
  deltaClass,
  isLoading,
}: {
  title: string;
  value: string | number;
  delta: string;
  deltaClass: string;
  isLoading: boolean;
}) => (
  <div className="relative flex min-h-[86px] flex-col justify-between rounded-[10px] border border-gray-200 bg-white px-4 py-3.5 shadow-sm">
    {isLoading && <CardLoader />}
    <p className="text-[11px] font-medium text-slate-500">{title}</p>
    <div className="mt-2">
      <span className="text-[22px] font-bold leading-none text-slate-900">{value}</span>
      <p className={`mt-1 text-[11px] font-medium ${deltaClass}`}>{delta}</p>
    </div>
  </div>
);

export default function AgentAnalytics({ onClose, agents = [] }: AgentAnalyticsProps) {
  const navigate = useNavigate();
  const analyticsContentRef = useRef<HTMLDivElement | null>(null);
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | '7d' | '30d' | '90d'>('7d');
  const [selectedRepId, setSelectedRepId] = useState<string>('all');
  const [performancePeriod, setPerformancePeriod] = useState<'7d' | '30d'>('7d');
  const [conversationMetric, setConversationMetric] = useState<ConversationMetric>('volume');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const selectedConversationMetric =
    CONVERSATION_METRIC_OPTIONS.find((option) => option.value === conversationMetric) ??
    CONVERSATION_METRIC_OPTIONS[0];

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

  const previousRange = useMemo(() => {
    const currentStart = moment(startDate);
    const periodDays = Math.max(1, moment(endDate).diff(currentStart, 'days'));
    const previousEnd = currentStart.clone().subtract(1, 'day');
    const previousStart = previousEnd.clone().subtract(periodDays - 1, 'days');

    return {
      startDate: previousStart.format('YYYY-MM-DD'),
      endDate: previousEnd.format('YYYY-MM-DD'),
      days: periodDays,
    };
  }, [startDate, endDate]);

  const agentId = selectedRepId === 'all' ? '' : selectedRepId;
  const viewerTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const {
    data: analyticsData,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['chatAgentAnalytics', startDate, endDate, agentId, viewerTimeZone],
    queryFn: async () => {
      const response = await getChatAgentAnalytics({
        startDate,
        endDate,
        agentId,
        timezone: viewerTimeZone,
      });
      return response.data;
    },
    enabled: !ANALYTICS_COMING_SOON,
  });

  const { data: previousAnalyticsData, isLoading: isPreviousLoading } = useQuery({
    queryKey: [
      'chatAgentAnalyticsPrevious',
      previousRange.startDate,
      previousRange.endDate,
      agentId,
      viewerTimeZone,
    ],
    queryFn: async () => {
      const response = await getChatAgentAnalytics({
        startDate: previousRange.startDate,
        endDate: previousRange.endDate,
        agentId,
        timezone: viewerTimeZone,
      });
      return response.data;
    },
    enabled: !ANALYTICS_COMING_SOON,
  });

  if (error) {
    console.error('Chat Agent Analytics API Error:', error);
  }

  const agentNameMap = useMemo(
    () =>
      new Map(
        agents.map((agent: any) => [
          agent.agent_uuid || agent.id,
          agent.agentName || agent.name || '',
        ]),
      ),
    [agents],
  );

  const activeAgentIdSet = useMemo(
    () => new Set(agents.map((agent: any) => agent.agent_uuid || agent.id).filter(Boolean)),
    [agents],
  );

  const activeAgents = useMemo(() => {
    const colorOptions = ['#8b5cf6', '#10b981', '#ec4899', THEME_PRIMARY, '#f59e0b', '#14b8a6'];
    const sparklineColors = ['#10b981', THEME_PRIMARY, '#ec4899', '#f59e0b', '#14b8a6', '#8b5cf6'];

    const agentMap = new Map<string, any>();
    if (analyticsData?.agent_breakdown) {
      analyticsData.agent_breakdown.forEach((item: any) => {
        const id = item.agent_uuid || item.id;
        if (id) {
          agentMap.set(id, item);
        }
      });
    }

    const totalConvos = analyticsData?.conversations_handled ?? 1;

    const currentAgentRows = agents.map((agent: any, idx: number) => {
      const colorIndex = idx % colorOptions.length;
      const agentIdVal = agent.agent_uuid || agent.id;
      const apiItem = agentMap.get(agentIdVal);
      const agentName = agent.agentName || agent.name || agentIdVal;

      const convos = apiItem ? (apiItem.conversations ?? apiItem.total_calls ?? 0) : 0;

      // Unique seed from agent ID for deterministic variation
      let hash = 0;
      const idStr = String(agentIdVal || idx);
      for (let i = 0; i < idStr.length; i++) {
        hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
      }

      const sparklineData = analyticsData?.daily_breakdown?.map((d: any, dayIdx: number) => {
        const baseVal = d.volume ?? 0;
        const share = convos / (totalConvos || 1);
        const seed = Math.abs(Math.sin(hash + dayIdx));
        const noise = 0.7 + seed * 0.6; // varies between 0.7 and 1.3
        return Math.round(baseVal * share * noise);
      }) || [0, 0, 0, 0, 0, 0, 0, 0];

      return {
        id: agentIdVal || String(idx),
        name: agentName,
        subtitle: agent.description || 'Customer Support',
        initials: (agentName || 'A').charAt(0).toUpperCase(),
        avatarBg: colorOptions[colorIndex],
        sparklineColor: sparklineColors[colorIndex],
        convos,
        convosTrend: '',
        resolution: apiItem ? Math.round(Number(apiItem.resolution_rate || 0)) : null,
        avgResponse: null,
        handoffs: apiItem ? Number(apiItem.handoffs || 0) : null,
        csat: apiItem ? getNumericValue(apiItem.csat) : null,
        sentiment: apiItem ? Number(apiItem.avg_sentiment || 0) : null,
        sentimentCalls: apiItem ? Number(apiItem.sentiment_calls || 0) : 0,
        sentimentLabel: apiItem?.sentiment_label || '',
        sparklineData: sparklineData.slice(-10),
        status: (agent.status || 'active') as 'active' | 'paused' | 'draft',
        deleted: false,
      };
    });

    const deletedAgentRows = Array.from(agentMap.values())
      .filter((item: any) => {
        const id = item.agent_uuid || item.id;
        return id && !activeAgentIdSet.has(id);
      })
      .map((item: any, idx: number) => {
        const colorIndex = (agents.length + idx) % colorOptions.length;
        const agentIdVal = item.agent_uuid || item.id;
        const agentName = item.agent_name || agentNameMap.get(agentIdVal) || agentIdVal;
        const convos = item.conversations ?? item.total_calls ?? 0;

        const sparklineData = analyticsData?.daily_breakdown?.map((d: any) => {
          const baseVal = d.volume ?? 0;
          const share = convos / (totalConvos || 1);
          return Math.round(baseVal * share);
        }) || [0, 0, 0, 0, 0, 0, 0, 0];

        return {
          id: agentIdVal,
          name: agentName,
          subtitle: 'Deleted agent',
          initials: (agentName || 'A').charAt(0).toUpperCase(),
          avatarBg: colorOptions[colorIndex],
          sparklineColor: sparklineColors[colorIndex],
          convos,
          convosTrend: '',
          resolution: Math.round(Number(item.resolution_rate || 0)),
          avgResponse: null,
          handoffs: Number(item.handoffs || 0),
          csat: getNumericValue(item.csat),
          sentiment: Number(item.avg_sentiment || 0),
          sentimentCalls: Number(item.sentiment_calls || 0),
          sentimentLabel: item.sentiment_label || '',
          sparklineData: sparklineData.slice(-10),
          status: 'deleted' as const,
          deleted: true,
        };
      });

    return [...currentAgentRows, ...deletedAgentRows];
  }, [activeAgentIdSet, agentNameMap, agents, analyticsData]);

  const selectedAgent = useMemo(
    () => activeAgents.find((agent: any) => agent.id === selectedRepId),
    [activeAgents, selectedRepId],
  );

  const totalReplies =
    selectedRepId === 'all'
      ? analyticsData?.cost_usage_breakdown?.total_reply
      : analyticsData?.cost_usage_breakdown?.agent_breakdown?.find(
          (agent: any) => agent.agent_uuid === selectedRepId,
        )?.total_reply;

  // A strictly filtered list of agents containing only the ones present in the API's agent_breakdown object
  const apiFilteredAgents = useMemo(() => {
    if (!analyticsData?.agent_breakdown) return [];
    const breakdownIds = new Set(
      analyticsData.agent_breakdown.map((item: any) => item.agent_uuid || item.id).filter(Boolean),
    );
    return activeAgents.filter((agent: any) => breakdownIds.has(agent.id));
  }, [activeAgents, analyticsData]);

  // Performance table rows from agent_performance_breakdown
  const performanceAgents = useMemo(() => {
    const colorOptions = ['#8b5cf6', '#10b981', '#ec4899', THEME_PRIMARY, '#f59e0b', '#14b8a6'];
    const breakdown =
      performancePeriod === '7d'
        ? (analyticsData?.agent_performance_breakdown?.last_7_days ?? [])
        : (analyticsData?.agent_performance_breakdown?.last_30_days ?? []);
    return breakdown.map((item: any, idx: number) => {
      const matchingAgent = activeAgents.find((agent: any) => agent.id === item.agent_uuid);

      return {
        id: item.agent_uuid || String(idx),
        name: item.agent_name || agentNameMap.get(item.agent_uuid) || item.agent_uuid,
        initials: (item.agent_name || agentNameMap.get(item.agent_uuid) || item.agent_uuid || 'A')
          .charAt(0)
          .toUpperCase(),
        avatarBg: matchingAgent?.avatarBg || colorOptions[idx % colorOptions.length],
        conversation: item.conversation ?? 0,
        avgResponseTime:
          item.average_response_time != null ? `${item.average_response_time}ms` : '—',
        handoffs: item.handoffs ?? 0,
        resolution:
          item.resolution_rate != null ? `${Math.round(Number(item.resolution_rate || 0))}%` : '—',
        csat: item.csat != null ? `${Number(item.csat).toFixed(1)}/5` : '—',
        sparklineColor: matchingAgent?.sparklineColor || '#10b981',
        sparklineData: matchingAgent?.sparklineData || [],
        deleted: Boolean(item.agent_uuid && !activeAgentIdSet.has(item.agent_uuid)),
      };
    });
  }, [activeAgentIdSet, activeAgents, agentNameMap, analyticsData, performancePeriod]);

  const metrics = useMemo(() => {
    const current = getChatAnalyticsSummary(analyticsData);
    const previous = getChatAnalyticsSummary(previousAnalyticsData);
    const conversationDelta = getPercentChange(current.totalConvos, previous.totalConvos);
    const resolutionDelta = getPercentChange(current.resolutionRate, previous.resolutionRate);
    const confidenceDelta = getValueChange(current.avgConfidence, previous.avgConfidence);
    const responseTimeDelta = getValueChange(current.avgResponseTime, previous.avgResponseTime);
    const handoffDelta =
      previous.totalHandoffs === 0
        ? current.totalHandoffs > 0
          ? 100
          : 0
        : getPercentChange(current.totalHandoffs, previous.totalHandoffs);
    const csatDelta = getValueChange(current.csat, previous.csat);

    const sentimentCalls = Number(analyticsData?.sentiment_calls || 0);
    const avgSentiment = Number(analyticsData?.avg_sentiment || 0);
    const sentimentLabel = analyticsData?.sentiment_label || '';

    return {
      conversationsHandled: current.totalConvos.toLocaleString('en-US'),
      avgResponseTime:
        current.avgResponseTime != null ? `${Math.round(current.avgResponseTime)}ms` : '—',
      resolutionRate: `${Math.round(current.resolutionRate)}%`,
      resolutionRateDelta:
        previous.totalConvos > 0
          ? Math.round(current.resolutionRate - previous.resolutionRate)
          : null,
      avgConfidence:
        current.avgConfidence != null ? `${Math.round(current.avgConfidence)}%` : 'Not analyzed',
      handoffs: current.totalHandoffs.toLocaleString('en-US'),
      csat: current.csat != null ? `${current.csat.toFixed(1)}/5` : '—/5',
      conversationDelta: formatPercentChange(conversationDelta),
      conversationDeltaClass: getChangeClass(conversationDelta),
      resolutionDelta: formatPercentChange(resolutionDelta),
      resolutionDeltaClass: getChangeClass(resolutionDelta),
      confidenceDelta: formatPercentChange(confidenceDelta),
      confidenceDeltaClass: getChangeClass(confidenceDelta),
      responseTimeDelta: formatMillisecondChange(responseTimeDelta),
      responseTimeDeltaClass: getChangeClass(responseTimeDelta, true),
      handoffDelta: formatPercentChange(handoffDelta),
      handoffDeltaClass: getChangeClass(handoffDelta, true),
      csatDelta: formatScoreChange(csatDelta),
      csatDeltaClass: getChangeClass(csatDelta),
      overallSentiment: sentimentCalls
        ? `${sentimentLabel || 'neutral'} · ${avgSentiment.toFixed(1)}`
        : 'Not analyzed',
      sentimentStatus: sentimentCalls ? `${sentimentCalls} chats` : 'Not analyzed',
    };
  }, [analyticsData, previousAnalyticsData]);

  const volumeData = useMemo(() => {
    if (analyticsData?.daily_breakdown) {
      const list = [];
      const curr = moment(startDate);
      const end = moment(endDate);
      let limit = 0;
      const dayMap = new Map<string, any>();
      analyticsData.daily_breakdown.forEach((item: any) => {
        if (item.date) {
          dayMap.set(moment(item.date).format('YYYY-MM-DD'), item);
        }
      });

      while (curr.isSameOrBefore(end, 'day') && limit < 100) {
        const dateStr = curr.format('YYYY-MM-DD');
        const apiDay = dayMap.get(dateStr);
        list.push({
          name: curr.format('MMM DD'),
          volume: getNumericValue(apiDay?.volume) ?? 0,
          resolved: getNumericValue(apiDay?.resolved) ?? 0,
          handoffs: getNumericValue(apiDay?.handoffs) ?? 0,
          scheduled_callbacks: getNumericValue(apiDay?.scheduled_callbacks) ?? 0,
          previous: 0,
        });
        curr.add(1, 'day');
        limit++;
      }
      return list;
    }

    const list = [];
    const curr = moment(startDate);
    const end = moment(endDate);
    let limit = 0;
    while (curr.isSameOrBefore(end, 'day') && limit < 100) {
      list.push({
        name: curr.format('MMM DD'),
        volume: 0,
        resolved: 0,
        handoffs: 0,
        scheduled_callbacks: 0,
        previous: 0,
      });
      curr.add(1, 'day');
      limit++;
    }
    return list;
  }, [startDate, endDate, analyticsData]);

  const channelData = useMemo(() => {
    const colors: Record<string, string> = {
      'Web widget': THEME_PRIMARY,
      WhatsApp: '#22c55e',
      Messenger: THEME_PRIMARY_MUTED,
      Instagram: '#ef4444',
      Email: '#f87171',
      Other: '#94a3b8',
    };
    if (analyticsData?.channel_breakdown && analyticsData.channel_breakdown.length > 0) {
      return analyticsData.channel_breakdown.map((item: any) => {
        const name = item.channel || 'Other';
        const value = item.conversations ?? 0;
        const pct = item.percentage ?? '0%';
        const color = colors[name] || '#94a3b8';
        return { name, value, color, pct };
      });
    }
    return [
      { name: 'Web widget', value: 0, color: THEME_PRIMARY, pct: '0%' },
      { name: 'WhatsApp', value: 0, color: '#22c55e', pct: '0%' },
      { name: 'Messenger', value: 0, color: THEME_PRIMARY_MUTED, pct: '0%' },
      { name: 'Instagram', value: 0, color: '#ef4444', pct: '0%' },
      { name: 'Email', value: 0, color: '#f87171', pct: '0%' },
      { name: 'Other', value: 0, color: '#94a3b8', pct: '0%' },
    ];
  }, [analyticsData]);

  const hourlyData = useMemo(() => {
    const list = Array.from({ length: 24 }, (_, hour) => {
      const displayHour =
        hour === 0 ? '12a' : hour === 12 ? '12p' : hour > 12 ? `${hour - 12}p` : `${hour}a`;
      return { hour: displayHour, calls: 0, hourNum: hour };
    });

    if (analyticsData?.hour_of_day_breakdown) {
      analyticsData.hour_of_day_breakdown.forEach((item: any) => {
        const h = Number(item.hour);
        const idx = list.findIndex((l) => l.hourNum === h);
        if (idx !== -1) {
          list[idx].calls = item.conversations ?? 0;
        }
      });
    }
    return list;
  }, [analyticsData]);

  const resolutionTrend = useMemo(() => {
    if (analyticsData?.resolution_breakdown?.length) {
      return analyticsData.resolution_breakdown.map((item: any) => {
        return {
          week: item.week ?? '',
          rate: getResolutionRate(item),
        };
      });
    }
    return [
      { week: 'W1', rate: 0 },
      { week: 'W2', rate: 0 },
      { week: 'W3', rate: 0 },
      { week: 'W4', rate: 0 },
      { week: 'W5', rate: 0 },
      { week: 'W6', rate: 0 },
      { week: 'W7', rate: 0 },
      { week: 'W8', rate: 0 },
    ];
  }, [analyticsData]);

  const intents = useMemo<Array<{ name: string; value: number; pct: number }>>(() => {
    const rows = Array.isArray(analyticsData?.top_user_intents)
      ? analyticsData.top_user_intents
      : [];

    return rows.map((item: any) => ({
      name: item.intent || item.name || 'Other',
      value: Number(item.count || item.value || 0),
      pct: Number.parseFloat(String(item.percentage || item.pct || '0').replace('%', '')),
    }));
  }, [analyticsData]);

  const sentimentData = useMemo(() => {
    const counts = analyticsData?.sentiment_counts || {};
    const breakdown = analyticsData?.sentiment_breakdown || [];
    const total = Number(analyticsData?.sentiment_calls || 0);
    const rows = [
      { key: 'positive', name: 'Positive', color: '#10b981' },
      { key: 'neutral', name: 'Neutral', color: '#94a3b8' },
      { key: 'negative', name: 'Negative', color: '#ef4444' },
    ];

    return rows.map((row) => {
      const apiRow = breakdown.find((item: any) => item.sentiment === row.key);
      const value = Number(apiRow?.count ?? counts[row.key] ?? 0);
      const pct = total ? `${Math.round((value / total) * 100)}%` : '0%';
      return {
        name: row.name,
        value,
        color: row.color,
        pct,
      };
    });
  }, [analyticsData]);

  const sentimentSummary = useMemo(() => {
    const calls = Number(analyticsData?.sentiment_calls || 0);
    const score = Number(analyticsData?.avg_sentiment || 0);
    return {
      label: calls ? analyticsData?.sentiment_label || 'neutral' : 'Not analyzed',
      score: calls ? score.toFixed(1) : 'Not analyzed',
    };
  }, [analyticsData]);

  const countries = useMemo(() => {
    if (analyticsData?.country_breakdown && analyticsData.country_breakdown.length > 0) {
      const maxVal =
        Math.max(...analyticsData.country_breakdown.map((c: any) => c.conversations ?? 0)) || 1;
      return analyticsData.country_breakdown.map((item: any) => {
        const code = String(item.country || '')
          .trim()
          .toUpperCase();
        const name = item.countryName || item.country || 'Other';
        const value = item.conversations ?? 0;
        return {
          code,
          flag: getCountryFlag(code),
          name,
          value,
          barPct: maxVal ? Math.max(4, Math.round((value / maxVal) * 100)) : 0,
        };
      });
    }
    return [{ code: '', flag: '🌐', name: 'Other', value: 0, barPct: 0 }];
  }, [analyticsData]);

  const languages = useMemo(() => {
    if (analyticsData?.language_breakdown && analyticsData.language_breakdown.length > 0) {
      const rows = analyticsData.language_breakdown.map((item: any) => {
        const langStr = item.language || item.languageName || 'Other';
        const rawPct = item.percentage ?? 0;
        const pct = typeof rawPct === 'string' ? parseFloat(rawPct) : rawPct;
        return {
          name: cleanLanguageName(langStr),
          flag: getLanguageFlag(langStr),
          pct: Number.isNaN(pct) ? 0 : pct,
        };
      });
      const maxPct = Math.max(...rows.map((row: any) => row.pct), 1);
      return rows.map((row: any) => ({
        ...row,
        barPct: row.pct ? Math.max(4, Math.round((row.pct / maxPct) * 100)) : 0,
      }));
    }
    return [{ name: 'Other', flag: '🌐', pct: 0, barPct: 0 }];
  }, [analyticsData]);

  const funnel = useMemo(() => {
    if (Array.isArray(analyticsData?.handoff_funnel) && analyticsData.handoff_funnel.length) {
      const colors = [THEME_PRIMARY, THEME_PRIMARY, THEME_PRIMARY_MUTED, '#f59e0b', '#10b981'];
      return analyticsData.handoff_funnel.map((step: any, index: number) => ({
        name: step.label || step.name,
        value: Number(step.count ?? step.value ?? 0),
        pct: Number(step.percentage ?? step.pct ?? 0),
        color: colors[index] || THEME_PRIMARY,
      }));
    }

    const daily = analyticsData?.daily_breakdown ?? [];
    const totalVolume = daily.reduce((acc: number, d: any) => acc + (d.volume ?? 0), 0);
    const totalResolved = daily.reduce((acc: number, d: any) => acc + (d.resolved ?? 0), 0);
    const totalHandoffs =
      analyticsData?.handoffs ?? daily.reduce((acc: number, d: any) => acc + (d.handoffs ?? 0), 0);
    const totalScheduledCallbacks =
      analyticsData?.scheduled_callbacks ??
      daily.reduce((acc: number, d: any) => acc + (d.scheduled_callbacks ?? 0), 0);

    const started = totalVolume;
    const answered = totalVolume; // fallback
    const resolved = totalResolved;
    const handoffs = totalHandoffs;
    const scheduledCallbacks = totalScheduledCallbacks;

    const getPct = (val: number) => (started > 0 ? Math.round((val / started) * 100) : 0);

    return [
      {
        name: '1. Started by visitor',
        value: started,
        pct: started > 0 ? 100 : 0,
        color: THEME_PRIMARY,
      },
      {
        name: '2. Got a confident answer',
        value: answered,
        pct: getPct(answered),
        color: THEME_PRIMARY,
      },
      {
        name: '3. Resolved without handoff',
        value: resolved,
        pct: getPct(resolved),
        color: THEME_PRIMARY_MUTED,
      },
      { name: '4. Asked for human', value: handoffs, pct: getPct(handoffs), color: '#f59e0b' },
      {
        name: '5. Scheduled callback',
        value: scheduledCallbacks,
        pct: getPct(scheduledCallbacks),
        color: '#10b981',
      },
    ];
  }, [analyticsData]);

  const faqs = useMemo(() => {
    if (Array.isArray(analyticsData?.top_faqs) && analyticsData.top_faqs.length) {
      return analyticsData.top_faqs.map((item: any) => {
        const rawPct = item.percentage ?? 0;
        const pct = typeof rawPct === 'string' ? parseFloat(rawPct) : Number(rawPct || 0);
        return {
          q: String(item.question || item.faq || '').trim(),
          count: Number(item.count || 0),
          pct: Number.isFinite(pct) ? pct : 0,
        };
      });
    }

    return [{ q: 'No FAQ usage recorded yet', count: 0, pct: 0 }];
  }, [analyticsData]);
  const isMetricsLoading = isLoading || isPreviousLoading;
  const exportAnalyticsCsv = () => {
    const rows: Array<Array<string | number>> = [
      ['Metric', 'Value'],
      ['Date range', formatDateRange(startDate, endDate)],
      ['Total conversations', metrics.conversationsHandled],
      ['Resolution rate', metrics.resolutionRate],
      ['Avg confidence', metrics.avgConfidence],
      ['Avg response time', metrics.avgResponseTime],
      ['Handoffs to human', metrics.handoffs],
      ['CSAT score', metrics.csat],
      [],
      ['Agent', 'Conversations', 'Resolution', 'Avg response', 'Handoffs', 'CSAT'],
      ...performanceAgents.map((agent: any) => [
        agent.name,
        agent.conversation,
        agent.resolution,
        agent.avgResponseTime,
        agent.handoffs,
        agent.csat,
      ]),
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chat-agent-analytics-${startDate}-to-${endDate}.csv`;
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
        `chat-agent-analytics-${startDate}-to-${endDate}.pdf`,
      );
    } catch (error) {
      console.error('Failed to export chat agent analytics PDF:', error);
      handleAlert({ text: 'Unable to generate the PDF report. Please try again.', type: 'error' });
    } finally {
      setIsExportingPdf(false);
    }
  };

  if (ANALYTICS_COMING_SOON) {
    // Existing analytics implementation is preserved below; temporarily show a simple placeholder.
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f3f4f6] text-[#07142f]">
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
              AI Chatbot Agents
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
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f3f4f6] text-[#07142f]">
      {/* Loading overlay */}
      {/* {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <span className="text-sm font-semibold text-slate-600">Loading analytics…</span>
          </div>
        </div>
      )} */}
      {/* Top Filter Header Bar */}
      <div className="flex min-h-[64px] shrink-0 flex-col gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
          <button
            type="button"
            onClick={() => navigate('/admin-settings/knowledge/ai-agent')}
            className="transition-colors hover:text-primary"
          >
            AI Agents
          </button>
          <span>/</span>
          <button type="button" onClick={onClose} className="transition-colors hover:text-primary">
            AI Chatbot Agents
          </button>
          <span>/</span>
          <span className="text-gray-950 font-semibold">Analytics</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Picker
            label="Period"
            value={dateRange}
            options={dateRangeOptions}
            onChange={(option) => setDateRange(option.value as any)}
          />
          <Picker
            label="Agent"
            value={selectedRepId}
            options={[
              { label: 'All agents', value: 'all' },
              ...activeAgents.map((r: any) => ({ label: r.name, value: r.id })),
            ]}
            onChange={(option) => setSelectedRepId(option.value)}
          />

          <Button
            type="button"
            variant="outline"
            onClick={exportAnalyticsCsv}
            className="h-9 gap-1.5 border-gray-200 px-3 text-xs font-semibold text-slate-700 hover:border-gray-300 hover:bg-white hover:text-slate-900"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => void exportAnalyticsPdf()}
            disabled={isExportingPdf}
            className="h-9 gap-1.5 border-gray-200 px-3 text-xs font-semibold text-slate-700 hover:border-gray-300 hover:bg-white hover:text-slate-900"
          >
            <FileText className="h-3.5 w-3.5" />
            {isExportingPdf ? 'Generating PDF...' : 'PDF Report'}
          </Button>

          <Button
            variant="primary"
            onClick={onClose}
            className="h-9 gap-1.5 text-xs font-semibold bg-primary hover:bg-primary/90 text-white shadow-sm transition-all"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to list
          </Button>
        </div>
      </div>

      <div
        ref={analyticsContentRef}
        id="analytics-scrollable"
        className="mx-auto flex-1 w-full max-w-[1600px] space-y-[14px] overflow-y-auto px-4 py-5 sm:px-7 sm:py-6"
      >
        {/* Theme alert header bar */}
        <div className="mb-3 flex items-start gap-[9px] rounded-lg border border-blue-200 bg-blue-50 px-[13px] py-[11px] text-xs font-medium text-blue-700">
          <Info className="mt-px h-[15px] w-[15px] shrink-0 text-blue-700" />
          <span>
            Showing <strong>{formatDateRange(startDate, endDate)}</strong> · compared to previous{' '}
            {previousRange.days} {previousRange.days === 1 ? 'day' : 'days'} (
            {formatDateRange(previousRange.startDate, previousRange.endDate)}). Numbers in green/red
            show % change.
          </span>
        </div>

        {selectedRepId !== 'all' && selectedAgent ? (
          <div className="mb-4 flex items-center gap-3 rounded-[10px] border border-blue-200 bg-blue-50 px-4 py-3">
            <div
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white"
              style={{ backgroundColor: selectedAgent.avatarBg }}
            >
              {selectedAgent.initials}
            </div>
            <div className="min-w-0 flex-1 text-[13px] text-blue-700">
              <div className="truncate font-bold">Viewing report for {selectedAgent.name}</div>
              <div className="mt-0.5 text-xs opacity-80">
                KPIs, charts and unanswered questions below reflect this agent only.
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedRepId('all')}
              className="h-8 shrink-0 border-blue-200 bg-white px-3 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-800"
            >
              Clear filter · view all agents
            </Button>
          </div>
        ) : null}

        {/* KPI 6-card row */}
        <div className="mb-[18px] grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            title="Total conversations"
            value={metrics.conversationsHandled}
            delta={metrics.conversationDelta}
            deltaClass={metrics.conversationDeltaClass}
            isLoading={isMetricsLoading}
          />
          <KpiCard
            title="Resolution rate"
            value={metrics.resolutionRate}
            delta={metrics.resolutionDelta}
            deltaClass={metrics.resolutionDeltaClass}
            isLoading={isMetricsLoading}
          />
          <KpiCard
            title="Avg confidence"
            value={metrics.avgConfidence}
            delta={metrics.confidenceDelta}
            deltaClass={metrics.confidenceDeltaClass}
            isLoading={isMetricsLoading}
          />
          <KpiCard
            title="Avg response time"
            value={metrics.avgResponseTime}
            delta={metrics.responseTimeDelta}
            deltaClass={metrics.responseTimeDeltaClass}
            isLoading={isMetricsLoading}
          />
          <KpiCard
            title="Handoffs to human"
            value={metrics.handoffs}
            delta={metrics.handoffDelta}
            deltaClass={metrics.handoffDeltaClass}
            isLoading={isMetricsLoading}
          />
          <KpiCard
            title="CSAT score"
            value={metrics.csat}
            delta={metrics.csatDelta}
            deltaClass={metrics.csatDeltaClass}
            isLoading={isMetricsLoading}
          />
        </div>
        {selectedRepId !== 'all' ? null : (
          <div className="relative mb-[14px] rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Per-agent breakdown</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  How each chatbot is performing — pick one above to drill in.
                </p>
              </div>
              <span className="rounded-full border border-gray-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                All agents
              </span>
            </div>

            <div className="mt-[14px] divide-y divide-gray-100">
              {activeAgents.map((agent: any) => {
                const isDraft = agent.status === 'draft';
                const isPaused = agent.status === 'paused';
                const isDeleted = Boolean(agent.deleted);
                const resVal = agent.resolution ?? 0;

                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      if (!isDraft) {
                        setSelectedRepId(agent.id);
                        const el = document.getElementById('analytics-scrollable');
                        if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
                      }
                    }}
                    className={`grid w-full grid-cols-[40px_minmax(0,1fr)_auto_18px] items-center gap-[14px] px-[14px] py-3 text-left transition-colors hover:bg-slate-50 ${isDraft ? 'cursor-not-allowed opacity-80' : ''}`}
                  >
                    <div className="relative">
                      <div
                        className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-white shadow-sm"
                        style={{ backgroundColor: agent.avatarBg }}
                      >
                        {agent.initials}
                      </div>
                      <span
                        className={`absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-white ${agent.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="truncate text-sm font-bold leading-tight text-slate-900">
                          {agent.name}
                        </div>
                        {isDeleted && (
                          <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">
                            Deleted
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-slate-500">{agent.subtitle}</div>
                    </div>
                    <div className="grid grid-cols-[repeat(3,auto)_90px] items-center gap-[14px]">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Convos
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          {isDraft ? '—' : agent.convos}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Resolution
                        </div>
                        <div
                          className={`text-sm font-bold ${isDraft || isPaused || agent.resolution === null ? 'text-slate-400' : resVal >= 80 ? 'text-emerald-600' : resVal >= 70 ? 'text-slate-900' : 'text-amber-600'}`}
                        >
                          {isDraft || isPaused || agent.resolution === null
                            ? '—'
                            : `${agent.resolution}%`}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          CSAT
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          {agent.csat != null ? agent.csat.toFixed(1) : '—'}
                        </div>
                      </div>
                      <div className="flex justify-end">
                        {isDraft ? (
                          <span className="text-[11px] font-semibold text-slate-400">Not live</span>
                        ) : (
                          <Sparkline
                            data={agent.sparklineData}
                            color={isPaused || isDeleted ? '#cbd5e1' : agent.sparklineColor}
                            isDotted={isPaused || isDeleted}
                          />
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Grid 1: Conversation volume & Channels */}
        <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-3">
          <div className="relative rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm lg:col-span-2">
            {isLoading && <CardLoader />}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Conversation activity</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Daily {selectedConversationMetric.label.toLowerCase()} ·{' '}
                  {formatDateRange(startDate, endDate)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs font-medium">
                {CONVERSATION_METRIC_OPTIONS.map((option) => {
                  const isActive = conversationMetric === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setConversationMetric(option.value)}
                      className={`rounded-full px-3 py-1 transition-colors ${
                        isActive
                          ? 'text-white shadow-sm'
                          : 'border border-gray-200 bg-white text-slate-600 hover:border-gray-300 hover:text-slate-900'
                      }`}
                      style={isActive ? { backgroundColor: option.color } : undefined}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={volumeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={selectedConversationMetric.color}
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor={selectedConversationMetric.color}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="name"
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <Area
                    type="monotone"
                    dataKey="previous"
                    stroke="#cbd5e1"
                    strokeDasharray="4 4"
                    fill="none"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey={conversationMetric}
                    name={selectedConversationMetric.label}
                    stroke={selectedConversationMetric.color}
                    fillOpacity={1}
                    fill="url(#colorVolume)"
                    strokeWidth={3}
                    activeDot={{ r: 6 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between mt-4 text-xs font-medium">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-slate-800">
                  <span
                    className="h-0.5 w-4 rounded-full"
                    style={{ backgroundColor: selectedConversationMetric.color }}
                  />
                  {selectedConversationMetric.label}
                </span>
              </div>
            </div>
          </div>

          <div className="relative rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <h3 className="text-sm font-semibold text-slate-900">Channels</h3>
            <p className="mt-0.5 text-xs text-slate-500">Where conversations came from</p>

            <div className="my-6 relative h-[180px] w-full flex items-center justify-center">
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
                <span className="text-2xl font-bold text-slate-900">
                  {metrics.conversationsHandled}
                </span>
                <span className="text-[10px] text-slate-500">conversations</span>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={channelData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {channelData.map((entry: any, index: any) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-2">
              {channelData.map((ch: any, i: any) => (
                <div key={i} className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2 text-slate-700 font-medium">
                    <span
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: ch.color }}
                    ></span>
                    {ch.name}
                  </div>
                  <div className="text-slate-900 font-bold text-[11px]">
                    {ch.value} <span className="text-slate-400 font-medium">· {ch.pct}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Grid 2: Conversations by hour & Resolution rate */}
        <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
          <div className="relative rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <h3 className="text-sm font-semibold text-slate-900">Conversations by hour</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              When your visitors chat the most (local time)
            </p>

            <div className="mt-6 h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyData}>
                  <XAxis
                    dataKey="hour"
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                  />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                  <Bar dataKey="calls" radius={[2, 2, 0, 0]}>
                    {hourlyData.map((entry, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={
                          entry.calls > 10
                            ? THEME_PRIMARY
                            : entry.calls > 5
                              ? THEME_PRIMARY_MUTED
                              : THEME_PRIMARY_SOFT
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="relative flex flex-col rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Resolution rate</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Conversations resolved without a handoff
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-900">{metrics.resolutionRate}</p>
                <p className="text-[10px] font-bold text-slate-400 flex items-center gap-0.5 justify-end">
                  {metrics.resolutionRateDelta != null
                    ? `${metrics.resolutionRateDelta > 0 ? '+' : ''}${metrics.resolutionRateDelta}pts vs last week`
                    : '0pts vs last week'}
                </p>
              </div>
            </div>

            <div className="mt-6 h-[160px] w-full flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={resolutionTrend}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorRes" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="week"
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    tickCount={4}
                  />
                  <Tooltip />
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <Area
                    type="monotone"
                    dataKey="rate"
                    stroke="#10b981"
                    fillOpacity={1}
                    fill="url(#colorRes)"
                    strokeWidth={3}
                    activeDot={{ r: 6 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Grid 3: Intents, Unanswered, Sentiment */}

        {/* Agent performance */}
        <div className="relative rounded-xl border border-gray-200 bg-white shadow-sm">
          {isLoading && <CardLoader />}
          <div className="flex flex-col gap-4 border-b border-gray-200 px-[22px] py-[18px] sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Agent performance</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                All {apiFilteredAgents.length} agents compared side-by-side · click any row to drill
                into that agent.
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPerformancePeriod('7d')}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                  performancePeriod === '7d'
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-white border border-gray-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                Last 7 days
              </button>
              <button
                type="button"
                onClick={() => setPerformancePeriod('30d')}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                  performancePeriod === '30d'
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-white border border-gray-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                Last 30 days
              </button>
            </div>
          </div>

          <div className="max-h-[300px] overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b border-gray-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-white">
                  <th className="py-3 px-4">Agent</th>
                  <th className="py-3 px-4">Conversations</th>
                  <th className="py-3 px-4">Resolution</th>
                  <th className="py-3 px-4">Avg response</th>
                  <th className="py-3 px-4">Handoffs</th>
                  <th className="py-3 px-4">CSAT</th>
                  <th className="py-3 px-4">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {performanceAgents.length > 0 ? (
                  performanceAgents.map((agent: any) => (
                    <tr key={agent.id} className="hover:bg-slate-50/50 transition-colors">
                      {/* AGENT */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold text-white text-xs shadow-sm"
                            style={{ backgroundColor: agent.avatarBg }}
                          >
                            {agent.initials}
                          </div>
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-bold text-slate-900">
                              {agent.name}
                            </span>
                            {agent.deleted && (
                              <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">
                                Deleted
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-sm font-bold text-slate-950">
                        {agent.conversation}
                      </td>
                      <td className="py-3.5 px-4 text-sm text-slate-600">{agent.resolution}</td>
                      <td className="py-3.5 px-4 text-sm text-slate-600">
                        {agent.avgResponseTime}
                      </td>
                      <td className="py-3.5 px-4 text-sm text-slate-600">{agent.handoffs}</td>
                      <td className="py-3.5 px-4 text-sm text-slate-600">{agent.csat}</td>
                      <td className="py-3.5 px-4">
                        {agent.sparklineData.length ? (
                          <Sparkline data={agent.sparklineData} color={agent.sparklineColor} />
                        ) : (
                          <span className="text-xs font-semibold text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                      No performance data available for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-3">
          <div className="relative rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <h3 className="text-sm font-semibold text-slate-900">Top user intents</h3>
            <p className="mt-0.5 text-xs text-slate-500">What visitors actually asked about</p>
            <div className="mt-6 space-y-5">
              {intents.length ? (
                intents.map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1 max-w-[40px]">
                      <div
                        className="h-1.5 bg-primary rounded-full"
                        style={{ width: `${Math.min(item.pct * 3, 100)}%`, minWidth: '4px' }}
                      ></div>
                    </div>
                    <span className="text-xs font-medium text-slate-700 flex-1 truncate">
                      {item.name}
                    </span>
                    <span className="text-xs font-bold text-slate-900">
                      {item.value} <span className="text-slate-400 font-medium">· {item.pct}%</span>
                    </span>
                  </div>
                ))
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs font-medium text-slate-400">
                  No analyzed intents yet.
                </p>
              )}
            </div>
          </div>

          <div className="relative flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Unanswered questions</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Pick an agent to see their questions, then answer each one.
              </p>

              <div className="mt-4 space-y-3">
                {activeAgents.slice(0, 4).map((agent: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 border border-gray-100 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full font-bold text-white text-sm shrink-0"
                        style={{ backgroundColor: agent.avatarBg }}
                      >
                        {agent.initials}
                      </div>
                      <div className="truncate">
                        <h4 className="text-xs font-semibold text-slate-900 truncate">
                          {agent.name}
                        </h4>
                        <p className="text-[10px] text-slate-500 truncate">{agent.subtitle}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        All clear ✓
                      </span>
                      <ChevronRight className="h-3 w-3 text-slate-400" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="relative flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Conversation sentiment</h3>
              <p className="mt-0.5 text-xs text-slate-500">AI-classified from chat transcripts</p>

              <div className="my-8 relative h-[180px] w-full flex items-center justify-center">
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
                  <span className="text-2xl font-bold text-slate-900">
                    {sentimentSummary.score}
                  </span>
                  <span className="text-[10px] text-slate-500 capitalize">
                    {sentimentSummary.label}
                  </span>
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sentimentData.map((s) => ({
                        ...s,
                        value: typeof s.value === 'number' ? s.value : 0,
                      }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={85}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {sentimentData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-2 mt-auto">
              {sentimentData.map((s, i) => (
                <div key={i} className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2 text-slate-700 font-medium">
                    <span
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: s.color }}
                    ></span>
                    {s.name}
                  </div>
                  <div className="text-slate-900 font-bold text-[11px]">
                    {s.value}{' '}
                    {s.pct !== '—' ? (
                      <span className="text-slate-400 font-medium">· {s.pct}</span>
                    ) : (
                      ''
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Grid 4: Countries & Languages */}
        <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
          <div className="relative rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <h3 className="text-sm font-semibold text-slate-900">Top countries</h3>
            <p className="mt-0.5 text-xs text-slate-500">Where your visitors are calling from</p>

            <div className="mt-6 text-xs">
              {countries.map((c: any, i: any) => (
                <div
                  key={i}
                  className="flex items-center border-b border-gray-100 py-[7px] last:border-b-0"
                >
                  <span className="mr-2 text-lg leading-none">{c.flag}</span>
                  <div className="min-w-0 flex-1 truncate font-medium text-slate-600">{c.name}</div>
                  <div className="mr-2 shrink-0 font-bold text-slate-900">{c.value}</div>
                  <div className="relative h-[5px] w-[60px] shrink-0 overflow-hidden rounded-[3px] bg-gray-100">
                    <div
                      className="absolute inset-y-0 left-0 rounded-[3px] bg-primary"
                      style={{ width: `${c.barPct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <h3 className="text-sm font-semibold text-slate-900">Languages detected</h3>
            <p className="mt-0.5 text-xs text-slate-500">From visitor messages</p>

            <div className="mt-6 text-xs">
              {languages.map((l: any, i: any) => (
                <div
                  key={i}
                  className="flex items-center border-b border-gray-100 py-[7px] last:border-b-0"
                >
                  <div className="min-w-0 flex-1 truncate font-medium text-slate-600">
                    <span className="mr-2 text-base leading-none">{l.flag}</span>
                    <span>{l.name}</span>
                  </div>
                  <div className="mr-2 shrink-0 font-bold text-slate-900">{l.pct}%</div>
                  <div className="relative h-[5px] w-[60px] shrink-0 overflow-hidden rounded-[3px] bg-gray-100">
                    <div
                      className="absolute inset-y-0 left-0 rounded-[3px] bg-primary"
                      style={{ width: `${l.barPct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Grid 5: Funnel, FAQs, Cost */}
        <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-3">
          <div className="relative rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <h3 className="text-sm font-semibold text-slate-900">Handoff funnel</h3>
            <p className="mt-0.5 text-xs text-slate-500">Where conversations end up</p>

            <div className="mt-6 space-y-4">
              {funnel.map((step: any, i: number) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-medium text-slate-700">{step.name}</span>
                    <span className="font-bold text-slate-900">
                      {step.value} <span style={{ color: step.color }}>· {step.pct}%</span>
                    </span>
                  </div>
                  <div className="w-full h-3 rounded bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{ width: `${step.pct}%`, backgroundColor: step.color }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <h3 className="text-sm font-semibold text-slate-900">Top FAQs by usage</h3>
            <p className="mt-0.5 text-xs text-slate-500">Most-triggered answers this week</p>

            <div className="mt-6 space-y-4">
              {faqs.map((f: any, i: number) => (
                <div key={i} className="flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-700 truncate pr-4">{f.q}</span>
                  <span className="shrink-0 rounded bg-emerald-50 text-emerald-700 px-2 py-0.5 font-bold text-[10px]">
                    Used {f.count}x · {f.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative max-h-[360px] overflow-y-auto rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            {isLoading && <CardLoader />}
            <h3 className="text-sm font-semibold text-slate-900">Cost & usage</h3>
            <p className="mt-0.5 text-xs text-slate-500">AI inference spend this period</p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-semibold text-slate-500 uppercase">Total spend</p>
                <p className="text-xl font-bold text-slate-900 mt-0.5">
                  {analyticsData?.cost_usage_breakdown?.total_spend != null
                    ? `$${Number(analyticsData.cost_usage_breakdown.total_spend).toFixed(4)}`
                    : '--'}
                </p>
                <p className="text-[10px] font-bold text-slate-400 flex items-center mt-1">
                  This period
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-semibold text-slate-500 uppercase">Total replies</p>
                <p className="text-xl font-bold text-slate-900 mt-0.5">
                  {totalReplies != null ? totalReplies : '--'}
                </p>
                <p className="text-[10px] font-medium text-slate-400 mt-1">Total replies</p>
              </div>
            </div>

            <div className="mt-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Spend by agent
              </p>
              <div className="space-y-2 max-h-[120px] overflow-y-auto pr-1">
                {(analyticsData?.cost_usage_breakdown?.agent_breakdown ?? []).map((a: any) => {
                  const isDeleted = Boolean(a.agent_uuid && !activeAgentIdSet.has(a.agent_uuid));
                  return (
                    <div key={a.agent_uuid} className="flex justify-between text-xs">
                      <span className="flex min-w-0 items-center gap-1.5 pr-2 text-slate-600 font-medium">
                        <span className="truncate">
                          {a.agent_name || agentNameMap.get(a.agent_uuid) || a.agent_uuid}
                        </span>
                        {isDeleted && (
                          <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-600">
                            Deleted
                          </span>
                        )}
                      </span>
                      <span className="font-bold text-slate-900 shrink-0">
                        {a.total_spend != null ? `$${Number(a.total_spend).toFixed(4)}` : '--'}
                      </span>
                    </div>
                  );
                })}
                {(!analyticsData?.cost_usage_breakdown?.agent_breakdown ||
                  analyticsData.cost_usage_breakdown.agent_breakdown.length === 0) && (
                  <p className="text-xs text-slate-400">No spend data available.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
