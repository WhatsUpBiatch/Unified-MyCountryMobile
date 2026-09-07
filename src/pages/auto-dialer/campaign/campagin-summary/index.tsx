import { useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Ic, McmIconSprite } from '@/components/mcm/icons';
import { SocketEvents } from '@/context/socket-events-context';
import { campaignAnalytics, getCampaignDetail, playPauseCampaign } from '@/services/api';
import { capitalizeFirstLetter, convertDateFormateApis } from '@/lib/utils';
import {
  CALL_STATUS_LABEL,
  DUTY_LABEL,
  HEALTH_LABEL,
  OUTCOME_LABEL,
  hasPacingControls,
} from '@/lib/campaign-dial-mode';
import { useCompanyFeatures } from '@/hooks/rbac';
import {
  BreakdownRow,
  Crumb,
  DIAL_METHOD_LABEL,
  OutcomeDonut,
  OutcomeLegend,
  StatusPill,
  fmt,
  num,
  pct,
  readOutcomes,
} from '../campaign-ui';
import { RETRY_PERIOD_TYPE } from '../add-edit-campaign/consts';
import '@/components/mcm/mcm-page.css';
import '../campaign.css';

/**
 * MCM Unified Console — campaign monitor.
 *
 * Three questions, in the order a supervisor asks them:
 *
 *   1. Is it running, and if not, what is holding it back?  The health line
 *      at the top: dialling normally, waiting for agents, waiting for
 *      contacts, outside hours, paused.
 *   2. What is happening right now?  Calls in flight (dialling, ringing,
 *      waiting for an agent, talking), which agent is free or busy, and a
 *      feed of the last events. All of it pushed by the dialer engine every
 *      few seconds on the "campaign-live-stats" socket event.
 *   3. How far through the list are we, and how did the calls go?  Lead
 *      progress and outcome counts from the stored analytics (refreshed when
 *      the engine writes a call back), plus this run's connect and abandon
 *      rates against the campaign's own cap.
 *
 * When the engine has not reported (campaign not running, or the server side
 * is not deployed yet) the live panels say so instead of showing zeros.
 */

const RETRY_UNIT_LABEL: Record<string, string> = {
  [RETRY_PERIOD_TYPE.MIN]: 'minutes',
  [RETRY_PERIOD_TYPE.HOUR]: 'hours',
  [RETRY_PERIOD_TYPE.DAY]: 'days',
};

type TabId = 'live' | 'overview' | 'agents' | 'config';

const secondsSince = (ts?: number | null) => (ts ? Math.max(0, Math.floor((Date.now() - ts) / 1000)) : 0);
const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ratePct = (value: unknown) => `${(Number(value || 0) * 100).toFixed(1)}%`;

const CampaignRecord = () => {
  const navigate = useNavigate();
  const { state } = useLocation();
  const queryClient: any = useQueryClient();
  const { features } = useCompanyFeatures();
  const { socketEventsManager } = useContext(SocketEvents);
  const campaignAccess = features?.plan_features?.campaign?.action;

  const { campaignDetails, campaignId } = (state || {}) as any;
  const resolvedCampaignId = campaignId || campaignDetails?._id;

  const [tab, setTab] = useState<TabId>('live');
  const [analytics, setAnalytics] = useState<any>(campaignDetails?.campaignAnalytics || {});
  const [live, setLive] = useState<any>(null);
  const [liveReceivedAt, setLiveReceivedAt] = useState<number>(0);
  const [, setClock] = useState(0);

  const { data: detail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['campaignDetail', resolvedCampaignId],
    queryFn: () => getCampaignDetail({ campaignId: resolvedCampaignId }),
    select: (data: any) => data?.data?.data?.result,
    enabled: Boolean(resolvedCampaignId),
    refetchOnWindowFocus: false,
  });

  const campaign = detail || campaignDetails || {};

  const { mutate: refreshAnalytics, isPending: isRefreshing } = useMutation({
    mutationFn: campaignAnalytics,
    onSuccess: (response: any) => {
      const next = response?.data?.data?.result;
      if (next) setAnalytics(next);
    },
  });

  const { mutate: mutateStatus, isPending: isTogglingStatus } = useMutation({
    mutationFn: playPauseCampaign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaignDetail', resolvedCampaignId] });
      queryClient.invalidateQueries({ queryKey: ['getCampaignListForPreview'] });
      queryClient.invalidateQueries({ queryKey: ['campaignListForKpis'] });
    },
  });

  /* ── live feed from the dialer engine ─────────────────────────────── */
  useEffect(() => {
    if (!socketEventsManager || !resolvedCampaignId) return;
    const onLive = (payload: any) => {
      if (String(payload?.campaignId) !== String(resolvedCampaignId)) return;
      setLive(payload);
      setLiveReceivedAt(Date.now());
    };
    const onAnalytics = (payload: any) => {
      if (String(payload?.campaignId) !== String(resolvedCampaignId)) return;
      refreshAnalytics({ campaignId: resolvedCampaignId });
    };
    const onState = (payload: any) => {
      if (String(payload?._id) !== String(resolvedCampaignId)) return;
      queryClient.invalidateQueries({ queryKey: ['campaignDetail', resolvedCampaignId] });
    };
    socketEventsManager.on('campaign-live-stats', onLive);
    socketEventsManager.on('campaign-analytics-updated', onAnalytics);
    socketEventsManager.on('campaign-state-update', onState);
    // Ask once for the current board rather than waiting for the next push.
    socketEventsManager.emit('campaign-live-calls', {
      domain: campaign?.domain,
      company_uuid: campaign?.company_uuid,
    });
    return () => {
      socketEventsManager.off('campaign-live-stats', onLive);
      socketEventsManager.off('campaign-analytics-updated', onAnalytics);
      socketEventsManager.off('campaign-state-update', onState);
    };
  }, [socketEventsManager, resolvedCampaignId, campaign?.domain, campaign?.company_uuid, queryClient, refreshAnalytics]);

  useEffect(() => {
    if (resolvedCampaignId) refreshAnalytics({ campaignId: resolvedCampaignId });
  }, [resolvedCampaignId, refreshAnalytics]);

  // Timers on the live rows tick once a second.
  useEffect(() => {
    const id = setInterval(() => setClock((c) => c + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const outcomes = useMemo(() => readOutcomes(analytics), [analytics]);
  const { assigned, answered, noAnswer, dnc, pending, dialed } = outcomes;

  const members: any[] = useMemo(() => {
    const raw = campaign?.members;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
      if (!Array.isArray(parsed)) return [];
      return Array.from(new Map(parsed.map((m: any) => [m?.user_uuid || m?.uuid, m])).values());
    } catch {
      return [];
    }
  }, [campaign?.members]);

  const dispositions: any[] = Array.isArray(campaign?.agentDisposition)
    ? campaign.agentDisposition
    : [];
  const callerIds: string[] = Array.isArray(campaign?.callerId) ? campaign.callerId : [];
  const dialer = campaign?.dialerSetting || {};
  const isRunning = String(campaign?.campaignStatus).toUpperCase() === 'PROCESSING';
  const mode = DIAL_METHOD_LABEL[campaign?.dialMethod];
  const paced = hasPacingControls(campaign?.dialMethod);

  const liveIsFresh = Boolean(live) && Date.now() - liveReceivedAt < 30000;
  const health = live?.health?.state ? HEALTH_LABEL[live.health.state] : null;
  const liveCalls: any[] = Array.isArray(live?.calls?.rows) ? live.calls.rows : [];
  const activeCalls = liveCalls.filter((c) => c?.status !== 'ended');
  const recentEnded = liveCalls.filter((c) => c?.status === 'ended');
  const liveAgents: any[] = Array.isArray(live?.agents?.rows) ? live.agents.rows : [];
  const events: any[] = Array.isArray(live?.events) ? live.events : [];
  const run = live?.run || {};
  const leads = live?.leads || null;
  const targetAbandon = Number(dialer?.target_abandon_rate ?? 3);
  const abandonPct = Number(run?.abandonRate || 0) * 100;
  const abandonOver = abandonPct > targetAbandon;

  const KPI_CARDS = liveIsFresh
    ? [
        {
          key: 'progress',
          label: 'List progress',
          value: `${num(leads?.progressPct)}%`,
          sub: `${fmt(leads?.pending)} of ${fmt(leads?.total)} still to work`,
        },
        {
          key: 'outstanding',
          label: 'Calls in flight',
          value: fmt(live?.calls?.linesInUse),
          sub: `${fmt(live?.calls?.talking)} talking · ${fmt(live?.calls?.waiting)} waiting for agent`,
          tone: 'good' as const,
        },
        {
          key: 'agents',
          label: 'Idle agents',
          value: `${fmt(live?.agents?.idle)}/${fmt(live?.agents?.total)}`,
          sub: `${fmt(live?.agents?.onCall)} on call · ${fmt(live?.agents?.wrapUp)} wrapping up`,
          tone: num(live?.agents?.idle) === 0 && isRunning ? ('warnv' as const) : undefined,
        },
        {
          key: 'connect',
          label: 'Connect rate',
          value: ratePct(run?.connectRate),
          sub: `${fmt(run?.answeredLive)} answered of ${fmt(run?.dialed)} dialled this run`,
        },
        {
          key: 'abandon',
          label: 'Abandon rate',
          value: paced ? `${abandonPct.toFixed(1)}%` : '—',
          sub: paced ? `cap ${targetAbandon}% · ${fmt(run?.abandoned)} abandoned` : 'preview calls cannot abandon',
          tone: paced ? (abandonOver ? ('warnv' as const) : ('good' as const)) : undefined,
        },
        {
          key: 'cpa',
          label: 'Calls per agent',
          value: paced ? String(run?.callsPerAgent ?? 1) : '—',
          sub: paced ? `${fmt(run?.linesOpenedLastTick)} opened last tick` : 'agent driven',
        },
      ]
    : [
        {
          key: 'assigned',
          label: 'Leads assigned',
          value: fmt(assigned),
          sub: `${fmt(pending)} still callable`,
        },
        {
          key: 'dialed',
          label: 'Dialled',
          value: fmt(dialed),
          sub: `${pct(dialed, assigned)}% of assigned`,
        },
        {
          key: 'answered',
          label: 'Answered',
          value: `${pct(answered, dialed)}%`,
          sub: `${fmt(answered)} connects`,
          tone: 'good' as const,
        },
        { key: 'noanswer', label: 'No answer', value: `${pct(noAnswer, dialed)}%`, sub: fmt(noAnswer) },
        {
          key: 'dnc',
          label: 'DNC / blocked',
          value: `${pct(dnc, dialed)}%`,
          sub: fmt(dnc),
          tone: dnc > 0 ? ('warnv' as const) : undefined,
        },
        {
          key: 'agents',
          label: 'Agents assigned',
          value: String(members.length),
          sub: members.length ? 'on this campaign' : 'unassigned',
        },
      ];

  const TABS: Array<[TabId, string, any, number | null]> = [
    ['live', 'Live', 'bolt', activeCalls.length || null],
    ['overview', 'Outcomes', 'chart', null],
    ['agents', 'Agents', 'users', liveIsFresh ? liveAgents.length : members.length],
    ['config', 'Configuration', 'sliders', null],
  ];

  const healthTone = health?.tone === 'good' ? 'pos' : health?.tone === 'crit' ? 'neg' : health?.tone === 'warn' ? 'warn' : 'neu';

  return (
    <div className="mcm-page cmp">
      <McmIconSprite />
      <div className="page">
        <div className="page-head">
          <div>
            <Crumb onBack={() => navigate(-1)} label="Campaigns" trail={resolvedCampaignId} />
            <h1>{capitalizeFirstLetter(campaign?.name) || 'Campaign'}</h1>
            <p>
              {mode ? <span className="tag neu">{mode}</span> : null}{' '}
              {campaign?.startDate
                ? `${convertDateFormateApis(campaign?.startDate, 'DD MMM YYYY')} – ${convertDateFormateApis(campaign?.endDate, 'DD MMM YYYY')}`
                : 'No campaign window set'}
              {campaign?.description ? ` · ${campaign.description}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {liveIsFresh && health ? (
              <span className={`tag ${healthTone}`} title={live?.health?.reason || ''}>
                {health.tone === 'good' ? <span className="dot green" /> : null}
                {health.label}
              </span>
            ) : (
              <StatusPill status={campaign?.campaignStatus} />
            )}
            {campaignAccess?.pause && (
              <button
                type="button"
                className="btn ghost sm"
                disabled={isTogglingStatus}
                onClick={() =>
                  mutateStatus({
                    campaignId: resolvedCampaignId,
                    campaignStatus: isRunning ? 'PAUSE' : 'PROCESSING',
                  })
                }
              >
                <Ic n={isRunning ? 'pause' : 'play'} size={13} />
                {isRunning ? 'Pause' : 'Start'}
              </button>
            )}
            <button
              type="button"
              className="btn ghost sm"
              disabled={isRefreshing || !resolvedCampaignId}
              onClick={() =>
                resolvedCampaignId && refreshAnalytics({ campaignId: resolvedCampaignId })
              }
            >
              <Ic n="refresh" size={13} className={isRefreshing ? 'pulsing' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {liveIsFresh && live?.health?.reason ? (
          <div className={`attn${health?.tone === 'crit' ? ' crit' : health?.tone === 'warn' ? ' warn' : ''}`}>
            <span className="attn-ic">
              <Ic n={health?.tone === 'good' ? 'bolt' : 'alert'} size={14} />
            </span>
            <div>
              <div className="attn-t">{health?.label}</div>
              <div className="attn-d">
                {live.health.reason}
                {live?.window && !live.window.open ? ` ${live.window.reason}` : ''}
                {Array.isArray(live?.notes) && live.notes.length ? ` ${live.notes.join(' ')}` : ''}
              </div>
            </div>
          </div>
        ) : null}

        <div className="kpis">
          {KPI_CARDS.map((kpi) => (
            <div className="kpi" key={kpi.key}>
              <div className="k">{kpi.label}</div>
              <div className={`v num${kpi.tone ? ` ${kpi.tone}` : ''}`}>{kpi.value}</div>
              <div className="d">{kpi.sub}</div>
            </div>
          ))}
        </div>

        <div className="ptabstrip">
          {TABS.map(([id, label, icon, count]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'on' : ''}
              onClick={() => setTab(id)}
            >
              <Ic n={icon} size={15} />
              {label}
              {count ? <span className="cnt num">{count}</span> : null}
            </button>
          ))}
        </div>

        {/* ── live ─────────────────────────────────────────────────── */}
        {tab === 'live' && (
          <>
            {!liveIsFresh ? (
              <div className="panel-card">
                <div className="empty">
                  <Ic n="bolt" />
                  <b>{isRunning ? 'Waiting for the dialer to report' : 'The campaign is not running'}</b>
                  <p>
                    {isRunning
                      ? 'The live board is pushed by the dialer service every few seconds. If this stays empty for more than half a minute the service is not running the engine yet.'
                      : 'Start the campaign to see calls in flight, agent state and pacing here as they happen.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid2">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="panel-card">
                    <div className="pc-head">
                      <h3>Calls in flight</h3>
                      <span className="src live pc-right">
                        <Ic n="spark" size={10} />
                        live · {secondsSince(liveReceivedAt)}s ago
                      </span>
                    </div>
                    {activeCalls.length ? (
                      <div className="tbl-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Contact</th>
                              <th style={{ width: 200 }}>State</th>
                              <th style={{ width: 150 }}>Agent</th>
                              <th style={{ width: 70 }}>For</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeCalls.map((call) => (
                              <tr key={call.key}>
                                <td>
                                  <strong>{call.contactName || 'Unknown'}</strong>
                                  <div className="num" style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>
                                    {call.phone}
                                    {call.origin === 'agent' ? ' · agent dialled' : ''}
                                  </div>
                                </td>
                                <td>
                                  <span className={`tag ${call.status === 'talking' ? 'pos' : call.status === 'answered' ? 'warn' : 'neu'}`}>
                                    {call.status === 'talking' || call.status === 'ringing' ? <span className="dot green" /> : null}
                                    {CALL_STATUS_LABEL[call.status] || call.status}
                                  </span>
                                </td>
                                <td>{call.agentName || call.agentExtension || <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                                <td className="num">
                                  {mmss(secondsSince(call.status === 'talking' ? call.bridgedAt : call.dialedAt))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty">
                        <Ic n="phone" />
                        <b>No calls up right now</b>
                        <p>{live?.health?.reason || 'The next call appears here the moment it is placed.'}</p>
                      </div>
                    )}
                    {recentEnded.length ? (
                      <div className="pc-foot">
                        Just finished:{' '}
                        {recentEnded.slice(-4).map((call) => (
                          <span className="tag neu" key={call.key}>
                            {call.contactName || call.phone} · {OUTCOME_LABEL[call.outcome] || call.outcome}
                            {call.talkSec ? ` ${mmss(call.talkSec)}` : ''}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="panel-card">
                    <div className="pc-head">
                      <h3>This run</h3>
                      <span className="src pc-right">since {timeOf(live?.startedAt || Date.now())}</span>
                    </div>
                    <div className="pc-body tight">
                      <div className="kv"><span className="k">Dialled</span><span className="v num">{fmt(run?.dialed)}</span></div>
                      <div className="kv"><span className="k">Answered</span><span className="v num">{fmt(run?.answeredLive)}</span></div>
                      <div className="kv"><span className="k">Reached an agent</span><span className="v num">{fmt(run?.bridged)}</span></div>
                      <div className="kv"><span className="k">Abandoned before an agent</span><span className={`v num${num(run?.abandoned) ? ' warnv' : ''}`}>{fmt(run?.abandoned)}</span></div>
                      <div className="kv"><span className="k">Waited over {num(dialer?.compliance_abandon_seconds ?? 2)}s for an agent</span><span className="v num">{fmt(run?.complianceAbandoned)}</span></div>
                      <div className="kv"><span className="k">No answer</span><span className="v num">{fmt(run?.noAnswer)}</span></div>
                      <div className="kv"><span className="k">Busy</span><span className="v num">{fmt(run?.busy)}</span></div>
                      <div className="kv"><span className="k">Failed</span><span className="v num">{fmt(run?.failed)}</span></div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="panel-card">
                    <div className="pc-head">
                      <h3>Contact list</h3>
                      <span className="tag neu num">{num(leads?.progressPct)}% done</span>
                    </div>
                    <div className="pc-body">
                      <div className="bar" style={{ marginBottom: 10 }}>
                        <i style={{ width: `${num(leads?.progressPct)}%` }} />
                      </div>
                      <BreakdownRow label="Due now" value={num(leads?.due)} total={num(leads?.total)} colour="var(--live)" />
                      <BreakdownRow label="Being dialled" value={num(leads?.inProgress)} total={num(leads?.total)} colour="var(--warn)" />
                      <BreakdownRow label="Retry later" value={num(leads?.future)} total={num(leads?.total)} colour="var(--surface-3)" />
                      <BreakdownRow label="Callbacks due" value={num(leads?.callbacks)} total={num(leads?.total)} colour="var(--accent)" />
                      <BreakdownRow label="Completed" value={num(leads?.completed)} total={num(leads?.total)} colour="var(--ink-4)" />
                      <BreakdownRow label="Attempts used up" value={num(leads?.exhausted)} total={num(leads?.total)} colour="var(--crit)" />
                      <BreakdownRow label="Do not call" value={num(leads?.dnc)} total={num(leads?.total)} colour="var(--crit)" />
                    </div>
                  </div>

                  <div className="panel-card">
                    <div className="pc-head">
                      <h3>What just happened</h3>
                    </div>
                    <div className="pc-body tight" style={{ maxHeight: 320, overflowY: 'auto' }}>
                      {events.length ? (
                        events.map((event, index) => (
                          <div className="kv" key={`${event.ts}-${index}`}>
                            <span className="k num" style={{ minWidth: 70 }}>{timeOf(event.ts)}</span>
                            <span className="v" style={{ fontWeight: event.kind === 'abandon' ? 800 : 600, color: event.kind === 'abandon' ? 'var(--crit)' : undefined }}>
                              {event.text}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="src">Nothing yet.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── outcomes ─────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="grid2">
            <div className="panel-card">
              <div className="pc-head">
                <h3>Contact outcomes</h3>
                <span className="src pc-right">
                  {isRefreshing ? 'refreshing…' : 'updates after every call'}
                </span>
              </div>
              <div
                className="pc-body"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
              >
                {assigned ? (
                  <>
                    <OutcomeDonut analytics={analytics} />
                    <div style={{ textAlign: 'center' }}>
                      <div className="num" style={{ fontSize: 15, fontWeight: 800 }}>
                        {fmt(dialed)}{' '}
                        <span style={{ color: 'var(--ink-4)', fontWeight: 600 }}>
                          of {fmt(assigned)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600 }}>
                        {fmt(pending)} records still callable
                      </div>
                    </div>
                    <div style={{ width: '100%' }}>
                      <BreakdownRow label="Answered" value={answered} total={assigned} colour="var(--live)" />
                      <BreakdownRow label="No answer" value={noAnswer} total={assigned} colour="var(--warn)" />
                      <BreakdownRow label="DNC / blocked" value={dnc} total={assigned} colour="var(--crit)" />
                      <BreakdownRow label="Pending" value={pending} total={assigned} colour="var(--surface-3)" />
                    </div>
                  </>
                ) : (
                  <div className="empty">
                    <Ic n="mega" />
                    <b>Nothing dialled yet</b>
                    <p>
                      This campaign has no lead outcomes to show. Once it starts dialling, the
                      breakdown appears here.
                    </p>
                  </div>
                )}
              </div>
              <div className="pc-foot">
                <OutcomeLegend />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="panel-card">
                <div className="pc-head">
                  <h3>Dialling policy</h3>
                </div>
                <div className="pc-body tight">
                  <div className="kv">
                    <span className="k">Max attempts per record</span>
                    <span className="v num">{num(dialer?.max_attempt_per_record) || '—'}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Retry period</span>
                    <span className="v num">
                      {dialer?.default_retry_period
                        ? `${dialer.default_retry_period} ${RETRY_UNIT_LABEL[dialer?.default_retry_period_type] || ''}`
                        : '—'}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="k">Wrap-up time</span>
                    <span className="v num">{dialer?.wrapup_time ? `${dialer.wrapup_time}s` : '—'}</span>
                  </div>
                  {paced ? (
                    <>
                      <div className="kv">
                        <span className="k">Line ceiling</span>
                        <span className="v num">{num(dialer?.max_lines) || 'none'}</span>
                      </div>
                      {String(campaign?.dialMethod).toUpperCase() === 'PREDICTIVE' ? (
                        <>
                          <div className="kv">
                            <span className="k">Max calls per agent</span>
                            <span className="v num">{num(dialer?.max_calls_per_agent) || 3}</span>
                          </div>
                          <div className="kv">
                            <span className="k">Abandon rate cap</span>
                            <span className="v num">{targetAbandon}%</span>
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : null}
                  <div className="kv">
                    <span className="k">Answering machine detection</span>
                    <span className="v">
                      {dialer?.answering_detection_machine?.enabled ||
                      dialer?.answering_detection_machine?.enable ? (
                        <span className="tag warn">set, not enforced yet</span>
                      ) : (
                        <span className="tag neu">off</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {!paced ? (
                <div className="aicard">
                  <div className="ac-head">
                    <span className="ac-kind">
                      <Ic n="user" size={12} />
                      Preview campaign
                    </span>
                  </div>
                  <div className="ac-body">
                    Agents see each record first and place the call themselves, so there is no
                    pacing to tune and no risk of abandoned calls. The live tab still shows their
                    calls as they happen.
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ── agents ───────────────────────────────────────────────── */}
        {tab === 'agents' && (
          <div className="panel-card">
            <div className="pc-head">
              <h3>Agents on this campaign</h3>
              {liveIsFresh ? (
                <span className="src live pc-right">
                  <Ic n="spark" size={10} />
                  live
                </span>
              ) : (
                <span className="tag neu num">{members.length}</span>
              )}
            </div>
            {liveIsFresh && liveAgents.length ? (
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th style={{ width: 110 }}>Extension</th>
                      <th style={{ width: 150 }}>Now</th>
                      <th>On the line with</th>
                      <th style={{ width: 100 }}>For</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveAgents.map((agent: any, index: number) => (
                      <tr key={agent?.userUuid || agent?.extension || index}>
                        <td>
                          <strong>{agent?.name || 'Unknown'}</strong>
                        </td>
                        <td className="num">{agent?.extension || '—'}</td>
                        <td>
                          <span className={`tag ${agent?.duty === 'idle' ? 'pos' : agent?.duty === 'on_call' ? 'acc' : agent?.duty === 'offline' ? 'neu' : 'warn'}`}>
                            {agent?.duty === 'idle' ? <span className="dot green" /> : null}
                            {DUTY_LABEL[agent?.duty] || agent?.status || '—'}
                          </span>
                        </td>
                        <td style={{ color: 'var(--ink-3)' }}>
                          {agent?.callContact || agent?.callPhone ? `${agent.callContact || ''} ${agent.callPhone ? `(${agent.callPhone})` : ''}`.trim() : '—'}
                        </td>
                        <td className="num">{agent?.since ? mmss(secondsSince(agent.since)) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : members.length ? (
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th style={{ width: 140 }}>Extension</th>
                      <th style={{ width: 180 }}>Role</th>
                      <th>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member: any, index: number) => {
                      const name =
                        member?.label ||
                        `${member?.first_name || ''} ${member?.last_name || ''}`.trim() ||
                        'Unknown';
                      return (
                        <tr key={member?.user_uuid || index}>
                          <td>
                            <strong>{name}</strong>
                          </td>
                          <td className="num">{member?.extension || '—'}</td>
                          <td>{member?.role ? capitalizeFirstLetter(member.role) : '—'}</td>
                          <td style={{ color: 'var(--ink-3)' }}>{member?.email || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <Ic n="users" />
                <b>No agents assigned</b>
                <p>Edit the campaign to add members before it can dial.</p>
              </div>
            )}
            <div className="pc-foot">
              {liveIsFresh
                ? 'Idle means signed in, available and past wrap-up: the dialer only places calls for idle agents.'
                : 'Live agent state (idle, on a call, wrapping up) shows here while the campaign runs.'}
            </div>
          </div>
        )}

        {/* ── configuration ────────────────────────────────────────── */}
        {tab === 'config' && (
          <div className="grid2">
            <div className="panel-card">
              <div className="pc-head">
                <h3>Targeting</h3>
              </div>
              <div className="pc-body tight">
                <div className="kv">
                  <span className="k">Dialing mode</span>
                  <span className="v">{mode || '—'}</span>
                </div>
                <div className="kv">
                  <span className="k">Lead groups</span>
                  <span className="v num">
                    {Array.isArray(campaign?.groupId) ? campaign.groupId.length : 0}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Caller IDs</span>
                  <span className="v num">{callerIds.length}</span>
                </div>
                <div className="kv">
                  <span className="k">Agent scripting</span>
                  <span className="v">
                    {campaign?.agentScripting ? <span className="tag pos">on</span> : <span className="tag neu">off</span>}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Agents may skip records</span>
                  <span className="v">
                    {campaign?.allowSkipping ? <span className="tag pos">yes</span> : <span className="tag neu">no</span>}
                  </span>
                </div>
                {liveIsFresh && live?.window ? (
                  <div className="kv">
                    <span className="k">Calling hours now</span>
                    <span className="v">
                      <span className={`tag ${live.window.open ? 'pos' : 'warn'}`}>{live.window.open ? 'open' : 'closed'}</span>{' '}
                      <span className="src">{live.window.reason} ({live.window.timezone})</span>
                    </span>
                  </div>
                ) : null}
              </div>
              {callerIds.length ? (
                <div className="pc-foot">
                  {callerIds.slice(0, 6).map((did) => (
                    <span className="tag acc num" key={did}>
                      {String(did).startsWith('+') ? did : `+${did}`}
                    </span>
                  ))}
                  {callerIds.length > 6 ? <span className="src">+{callerIds.length - 6} more</span> : null}
                </div>
              ) : null}
            </div>

            <div className="panel-card">
              <div className="pc-head">
                <h3>Dispositions</h3>
                <span className="tag neu num">{dispositions.length}</span>
              </div>
              {dispositions.length ? (
                <div className="pc-body tight">
                  {dispositions.map((item: any, index: number) => (
                    <div className="kv" key={item?._id || index}>
                      <span className="k">{item?.disposition?.name || item?.name || 'Unnamed'}</span>
                      <span className="v" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>
                        {item?.disposition?.description || ''}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <Ic n="list" />
                  <b>No dispositions configured</b>
                  <p>Agents need at least one outcome code before the campaign can run.</p>
                </div>
              )}
              <div className="pc-foot">Per-disposition counts need a disposition report keyed by campaign.</div>
            </div>
          </div>
        )}

        {isLoadingDetail && !detail ? (
          <div className="src" style={{ marginTop: 12 }}>
            Loading campaign configuration…
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default CampaignRecord;
