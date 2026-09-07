import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import moment from 'moment';
import { useUser } from '@/hooks/use-user';
import { fetchPhone } from '@/services/api';
import { Ic, McmIconSprite } from '@/components/mcm/icons';
import Timer from '@/components/timer';
import { useConsoleDialer } from '@/pages/phone/console/dial-number';
import { useLiveContactCentre, KPI_REFRESH_MS } from '@/hooks/use-live-contact-centre';
import { useAnimatedNumber } from '@/pages/performance/use-animated-number';
import { formatSecsToClock } from '@/pages/performance/format';
import buildQueueRows from '@/pages/performance/queue-rows';
import buildAgentRows, { AGENT_STATES } from '@/pages/performance/agent-rows';
import {
  getMonitoringCallTimestamp,
  getMonitoringContactValue,
  isMonitoringCallForMember,
} from '@/pages/monitoring/live-call-helpers';
import { handleDate } from '@/components/custom/date-dropdown/constant';
import { buildAttentionItems } from './attention';
import '@/components/mcm/mcm-page.css';
import '@/pages/dashboard/dashboard.css';

/**
 * MCM Unified Console — Home.
 *
 * The artifact's Home is a shift opener, not a dashboard: who you are, what is
 * on fire, how your own day is going, and one click to the phone. It is built
 * from the same platform components as Performance (`components/mcm/mcm-page.css`)
 * so the two read as one product.
 *
 * Everything on screen is live: the KPI strip and the attention list come from
 * the same queue/agent feeds Performance uses (`useLiveContactCentre`), "Your
 * day so far" from the signed-in user's own agent report, the digest counts
 * from the call-log API. The one panel the artifact fills that the platform has
 * no service behind — the Copilot overnight summary — says so rather than
 * inventing a summary.
 */

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '—';

const round = (value: number) => String(Math.round(value));

const STATE_CLASS: Record<string, string> = {
  'On Call': 'state busy',
  Ringing: 'state acw',
  'On Hold': 'state acw',
  Available: 'state q',
  Busy: 'state busy',
  'Do Not Disturb': 'state busy',
  Offline: 'state away',
};

/** Service level, on the artifact's thresholds: 85+ good, 80+ neutral, below that bad. */
const slTag = (sla: number | null) => {
  if (sla === null) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
  const tone = sla >= 85 ? 'pos' : sla >= 80 ? 'neu' : 'neg';
  return <span className={`tag ${tone}`}>{Math.round(sla)}%</span>;
};

type Kpi = {
  key: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'warnv' | 'bad';
};

const Home = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const { dial, isRegistered } = useConsoleDialer();

  // Home always reads today; Performance keeps the date picker.
  const today = useMemo(() => handleDate('Today'), []);

  const live = useLiveContactCentre(today);
  const {
    queues,
    agentRows,
    activeQueueCalls,
    waitingCalls,
    longestWaitTimestamp,
    longestWaitSecs,
    liveSlaByName,
    usersOnlineStatus,
    totals,
    onlineAgentsCount,
    avgSla,
    avgHandleTime,
    abandonRate,
    occupancy,
  } = live;

  const firstName = String(user?.user_info?.first_name || '').trim();
  const myExtension = String(user?.user_info?.extension || '').trim();
  const myName =
    `${user?.user_info?.first_name || ''} ${user?.user_info?.last_name || ''}`.trim() || 'you';

  /* ── the queues this user is a member of ─────────────────────────────── */
  const myQueues = useMemo(() => {
    const keys = [user?.user_info?.uuid, user?.user_info?.user_uuid, myExtension]
      .filter(Boolean)
      .map((value) => String(value));
    if (!keys.length) return [];
    return queues.filter((queue) => queue.memberKeys.some((key) => keys.includes(key)));
  }, [queues, user, myExtension]);

  /* ── every queue's live row, from the derivation Performance uses ────── */
  const queueRows = useMemo(
    () =>
      buildQueueRows({
        queues,
        activeQueueCalls,
        queueStatsByUuid: live.queueStatsByUuid,
        liveSlaByName,
        liveQueueStatsByName: live.liveQueueStatsByName,
        cdrByQueueUuid: live.cdrByQueueUuid,
      }).sort(
        (a, b) =>
          b.waiting - a.waiting || b.interacting - a.interacting || a.name.localeCompare(b.name),
      ),
    [live, queues, activeQueueCalls, liveSlaByName],
  );

  /* ── the floor, from the derivation Performance ▸ Agents uses ────────── */
  const liveAgents = useMemo(
    () => buildAgentRows({ agentRows, queues, usersOnlineStatus, activeQueueCalls }),
    [agentRows, queues, usersOnlineStatus, activeQueueCalls],
  );

  /* Only states anyone is actually in — an empty bar teaches nothing. */
  const stateDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    liveAgents.forEach((agent) => counts.set(agent.status, (counts.get(agent.status) || 0) + 1));
    const total = liveAgents.length || 1;
    return AGENT_STATES.filter((state) => counts.get(state)).map((state) => ({
      state,
      count: counts.get(state) || 0,
      pct: Math.round(((counts.get(state) || 0) / total) * 100),
    }));
  }, [liveAgents]);

  /* The bar is a picture, so it needs saying in words for anyone who cannot see
     it — the same split, read out. */
  const rosterSummary = useMemo(
    () =>
      stateDistribution.length
        ? `Roster: ${stateDistribution.map((s) => `${s.state} ${s.count} (${s.pct}%)`).join(', ')}`
        : 'Nobody on the roster',
    [stateDistribution],
  );

  /* Busiest first: on a call, then ringing, then everyone else by handled. */
  const agentsByActivity = useMemo(
    () =>
      [...liveAgents].sort(
        (a, b) =>
          Number(b.isOnCall) - Number(a.isOnCall) ||
          Number(b.isOnline) - Number(a.isOnline) ||
          b.handledToday - a.handledToday ||
          a.name.localeCompare(b.name),
      ),
    [liveAgents],
  );

  /* ── what is on the wire this second ─────────────────────────────────── */
  const interactions = useMemo(
    () =>
      (activeQueueCalls || [])
        .map((call: any) => {
          const forwardValue = String(
            call?.queue_uuid || call?.forward_value || call?.campaign_uuid || '',
          );
          const queue = forwardValue ? queues.find((q) => q.uuid === forwardValue) : null;
          const agent = liveAgents.find(
            (row) => row.extension && isMonitoringCallForMember(call, row.extension),
          );
          const startedAt = getMonitoringCallTimestamp(call);
          return {
            id: String(call?.uuid || call?.call_uuid || call?.sipcall_id || startedAt || ''),
            startedAt,
            customer: getMonitoringContactValue(call),
            number: call?.caller_number || call?.called_number || call?.did_number || '—',
            queue: queue?.name || '—',
            agent: agent?.name || 'Unassigned',
            state: String(call?.status || 'waiting').replace(/_/g, ' '),
            waiting: String(call?.status || '') === 'waiting',
          };
        })
        // longest-running first: the one most likely to need a supervisor
        .sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity)),
    [activeQueueCalls, queues, liveAgents],
  );

  /* ── the signed-in user's own row in today's agent report ────────────── */
  const me = useMemo(
    () =>
      agentRows.find((agent: any) => String(agent?.extension || '') === myExtension) ||
      agentRows.find(
        (agent: any) =>
          `${agent?.first_name || ''} ${agent?.last_name || ''}`.trim().toLowerCase() ===
          myName.toLowerCase(),
      ) ||
      null,
    [agentRows, myExtension, myName],
  );
  const myStats = me?.stats || {};
  const myHandled = Number(myStats.answered_calls) || 0;
  const myTalkMinutes = Number(myStats.time_on_calls_minutes) || 0;
  const myAhtSecs = myHandled ? (myTalkMinutes * 60) / myHandled : null;

  /* ── digest counts, straight off the call log ────────────────────────── */
  const { data: voicemails = 0 } = useQuery({
    queryKey: ['homeVoicemailCount', today],
    queryFn: () =>
      fetchPhone({
        page: 1,
        limit: 1,
        type: 'voicemail',
        filter: [],
        filter_date: { from: today?.from, to: today?.to },
        sort: { key: 'start_stamp', desc: true },
      }),
    select: (res: any) => Number(res?.data?.data?.result?.totalRecords) || 0,
    refetchInterval: KPI_REFRESH_MS * 15,
  });

  const { data: missedRows = [] } = useQuery({
    queryKey: ['homeMissedCalls', today],
    queryFn: () =>
      fetchPhone({
        page: 1,
        limit: 25,
        filter: [{ key: 'direction', value: 'Missed' }],
        filter_date: { from: today?.from, to: today?.to },
        sort: { key: 'start_stamp', desc: true },
      }),
    select: (res: any) => res?.data?.data?.result?.rows || [],
    refetchInterval: KPI_REFRESH_MS * 15,
  });

  /* ── quick dial: the people you actually call ────────────────────────── */
  const quickDial = useMemo<{ name: string; extension: string; online: boolean }[]>(
    () =>
      agentRows
        .filter((agent: any) => agent?.extension && String(agent.extension) !== myExtension)
        .slice(0, 6)
        .map((agent: any) => {
          const name = `${agent?.first_name || ''} ${agent?.last_name || ''}`.trim() || 'Teammate';
          const online = usersOnlineStatus.some(
            (u: any) => String(u?.userId) === String(agent.extension) && u?.online,
          );
          return { name, extension: String(agent.extension), online };
        }),
    [agentRows, myExtension, usersOnlineStatus],
  );

  /* ── attention list ──────────────────────────────────────────────────── */
  const attention = useMemo(
    () =>
      buildAttentionItems({
        queues,
        activeQueueCalls,
        waitingCalls,
        longestWaitSecs,
        liveSlaByName,
        usersOnlineStatus,
        onlineAgentsCount,
      }),
    [
      queues,
      activeQueueCalls,
      waitingCalls,
      longestWaitSecs,
      liveSlaByName,
      usersOnlineStatus,
      onlineAgentsCount,
    ],
  );

  /* ── KPI strip — same eight figures Performance leads with ───────────── */
  const waitingAnimated = useAnimatedNumber(waitingCalls.length);
  const answeredAnimated = useAnimatedNumber(totals.answered);
  const onlineAgentsAnimated = useAnimatedNumber(onlineAgentsCount);
  const slaAnimated = useAnimatedNumber(avgSla);
  const abandonAnimated = useAnimatedNumber(abandonRate);
  const ahtAnimated = useAnimatedNumber(avgHandleTime);
  const occupancyAnimated = useAnimatedNumber(occupancy);

  const kpis: Kpi[] = [
    {
      key: 'waiting',
      label: 'Waiting now',
      value: round(waitingAnimated),
      sub: `across ${queues.length} ${queues.length === 1 ? 'queue' : 'queues'}`,
      tone: waitingCalls.length > 5 ? 'bad' : undefined,
    },
    {
      key: 'longest',
      label: 'Longest wait',
      value: longestWaitTimestamp ? <Timer startTime={longestWaitTimestamp} /> : '00:00',
      sub: longestWaitSecs > 120 ? 'past the breach mark' : 'within target',
      tone: longestWaitSecs > 120 ? 'bad' : undefined,
    },
    {
      key: 'sla',
      label: 'Service level',
      value: avgSla === null ? '—' : `${Math.round(slaAnimated)}%`,
      sub: 'target 80% in 20s',
      /* The one figure on the strip with a number to be judged against, so it
         is the one that gets a track. Both values are real: the level comes
         from the same feed as the figure above it, the target is the 80% the
         sub-line already quotes. */
      meter: avgSla === null ? undefined : { value: Math.round(slaAnimated), target: 80 },
      tone: avgSla === null ? undefined : avgSla >= 80 ? 'good' : avgSla >= 60 ? 'warnv' : 'bad',
    },
    { key: 'answered', label: 'Answered today', value: round(answeredAnimated), sub: 'all queues' },
    {
      key: 'abandon',
      label: 'Abandon rate',
      value: abandonRate === null ? '—' : `${Math.round(abandonAnimated)}%`,
      sub: abandonRate === null ? 'no calls in range' : 'of calls today',
      tone: abandonRate !== null && abandonRate > 5 ? 'bad' : undefined,
    },
    {
      key: 'aht',
      label: 'Avg handle time',
      value: avgHandleTime === null ? '—' : formatSecsToClock(ahtAnimated),
    },
    {
      key: 'onqueue',
      label: 'On queue',
      value: round(onlineAgentsAnimated),
      sub: `of ${agentRows.length} on the roster`,
    },
    {
      key: 'occupancy',
      label: 'Occupancy',
      value: occupancy === null ? '—' : `${Math.round(occupancyAnimated)}%`,
      sub: 'target 75–85%',
    },
  ];

  const heroLine = myQueues.length
    ? `You are on queue for ${myQueues
        .slice(0, 3)
        .map((q) => q.name)
        .join(', ')}${myQueues.length > 3 ? ` and ${myQueues.length - 3} more` : ''}.`
    : 'You are not assigned to a queue right now — direct calls only.';

  return (
    <div className="mcm-page home-v2">
      <McmIconSprite />
      <div className="page">
        {/* ── hero ─────────────────────────────────────────────────────── */}
        <div className="hero">
          <div style={{ minWidth: 0 }}>
            <h1>
              {greeting()}
              {firstName ? `, ${firstName}` : ''}
            </h1>
            <p>
              {heroLine}{' '}
              {attention.length
                ? `${attention.length} ${attention.length === 1 ? 'thing needs' : 'things need'} your attention — they are at the top of the list below.`
                : 'Nothing is breaching right now.'}
            </p>
          </div>
          <div className="hero-right">
            <button className="btn ghost" onClick={() => navigate('/performance')}>
              <Ic n="trend" />
              Performance
            </button>
            <button className="btn primary" onClick={() => navigate('/phone')}>
              <Ic n="phone" />
              New call
            </button>
          </div>
        </div>

        {/* ── KPI strip ────────────────────────────────────────────────── */}
        <div className="kpis">
          {kpis.map((kpi) => (
            // A breaching figure tints the whole tile, not just the number —
            // the artifact's `alert` treatment, so it reads at a glance.
            <div key={kpi.key} className={`kpi${kpi.tone === 'bad' ? ' alert' : ''}`}>
              <div className="k">{kpi.label}</div>
              <div className={`v num${kpi.tone ? ` ${kpi.tone}` : ''}`}>{kpi.value}</div>
              {kpi.meter ? (
                <div
                  className="kpi-meter"
                  role="img"
                  aria-label={`${kpi.meter.value}% against a ${kpi.meter.target}% target`}
                >
                  <span style={{ width: `${Math.min(100, Math.max(0, kpi.meter.value))}%` }} />
                  {/* Where the target sits on the same rail, so the gap between
                      the two is the thing you read rather than a number you
                      have to hold in your head. */}
                  <i style={{ left: `${Math.min(100, kpi.meter.target)}%` }} />
                </div>
              ) : null}
              {kpi.sub ? <div className="d">{kpi.sub}</div> : null}
            </div>
          ))}
        </div>

        <div className="grid2">
          {/* ── needs you now ──────────────────────────────────────────── */}
          <div className="panel-card">
            <div className="pc-head">
              <h3>Needs you now</h3>
              <span className={`tag ${attention.length ? 'neg' : 'pos'}`}>
                {attention.length
                  ? `${attention.length} item${attention.length === 1 ? '' : 's'}`
                  : 'all clear'}
              </span>
              <span className="src live pc-right">
                <span className="dot green" />
                live
              </span>
            </div>
            <div className="pc-body">
              {attention.length ? (
                attention.map((item) => (
                  <div key={item.id} className={`attn ${item.level}`}>
                    <span className="attn-ic">
                      <Ic n={item.icon} size={15} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="attn-t">{item.title}</div>
                      <div className="attn-d">{item.detail}</div>
                    </div>
                    <button
                      className={`btn sm ${item.action.primary ? 'primary' : 'ghost'}`}
                      onClick={() => navigate(item.action.to)}
                    >
                      {item.action.label}
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty">
                  <Ic n="check" />
                  <p>
                    Every queue is inside its service level and nobody is waiting past the breach
                    mark. This list fills itself the moment that changes.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="stack">
            {/* ── your day so far ──────────────────────────────────────── */}
            <div className="panel-card">
              <div className="pc-head">
                <h3>Your day so far</h3>
                <span className="src pc-right">{moment().format('HH:mm')} · today</span>
              </div>
              <div className="pc-body tight">
                {me ? (
                  <>
                    <div className="kv">
                      <span className="k">Calls handled</span>
                      <span className="v num">{myHandled}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Average handle time</span>
                      <span className="v num">
                        {myAhtSecs === null ? '—' : formatSecsToClock(myAhtSecs)}
                      </span>
                    </div>
                    <div className="kv">
                      <span className="k">Time on calls</span>
                      <span className="v num">{Math.round(myTalkMinutes)} min</span>
                    </div>
                    <div className="kv">
                      <span className="k">Inbound</span>
                      <span className="v num">{Number(myStats.incoming_calls) || 0}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Outbound</span>
                      <span className="v num">{Number(myStats.outgoing_calls) || 0}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Queues you cover</span>
                      <span className="v num">{myQueues.length}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Station</span>
                      <span className="v">
                        {isRegistered ? (
                          <>
                            <span className="dot green" />
                            registered
                            {myExtension ? <span className="num"> · ext {myExtension}</span> : null}
                          </>
                        ) : (
                          <>
                            <span className="dot red" />
                            not registered
                          </>
                        )}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="empty">
                    <Ic n="user" />
                    <p>
                      No agent report for your extension today. Numbers appear here once you take
                      your first call.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── overnight digest ─────────────────────────────────────── */}
            <div className="panel-card">
              <div className="pc-head">
                <h3>Since you logged off</h3>
                <span className="tag ai pc-right">
                  <Ic n="spark" size={9} fill />
                  Copilot
                </span>
              </div>
              <div className="pc-body">
                {/* The artifact writes a Copilot narrative here — "eleven duplicate
                    direct debits, none of them told". There is no summarisation
                    service behind Home yet, so this says so instead of inventing
                    one. The counts below it are real. */}
                <div className="aicard" style={{ marginBottom: 10 }}>
                  <div className="ac-head">
                    <span className="ac-kind">
                      <Ic n="spark" size={12} fill />
                      Overnight summary
                    </span>
                    <span className="src pc-right">not connected</span>
                  </div>
                  <div className="ac-body">
                    Copilot does not summarise overnight activity yet. When that service is wired
                    up, the pattern it finds across the calls you missed appears here — for now the
                    counts below are the raw record.
                  </div>
                </div>
                <div className="kv">
                  <span className="k">Voicemails today</span>
                  <span className="v num">{voicemails}</span>
                </div>
                <div className="kv">
                  <span className="k">Missed calls today</span>
                  <span className="v num">{missedRows.length}</span>
                </div>
                <div className="kv">
                  <span className="k">Callers still waiting</span>
                  <span className="v num">{waitingCalls.length}</span>
                </div>
                <div className="ac-acts" style={{ marginTop: 12 }}>
                  <button className="mini" onClick={() => navigate('/phone')}>
                    <Ic n="list" size={12} />
                    Open the call log
                  </button>
                </div>
              </div>
            </div>

            {/* ── quick dial ───────────────────────────────────────────── */}
            <div className="panel-card">
              <div className="pc-head">
                <h3>Quick dial</h3>
                <span className="src pc-right">{quickDial.length} on the roster</span>
              </div>
              <div className="pc-body">
                {quickDial.length ? (
                  <div className="quickdial">
                    {quickDial.map((person) => (
                      <button
                        key={person.extension}
                        className="qd"
                        title={`Call ${person.name} on ${person.extension}`}
                        onClick={() => dial(person.extension)}
                      >
                        <span className="qd-av">{initials(person.name)}</span>
                        <span style={{ minWidth: 0 }}>
                          <span className="qd-n" style={{ display: 'block' }}>
                            {person.name}
                          </span>
                          <span className="qd-m num">
                            ext {person.extension}
                            {person.online ? ' · online' : ''}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <Ic n="users" />
                    <p>No other extensions on the roster yet.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Queues ──────────────────────────────────────────────────────
            The whole floor, worst first — Home answers "where is it hurting"
            before you go to Performance to work the detail. */}
        <div className="panel-card" style={{ marginTop: 16 }}>
          <div className="pc-head">
            <h3>Queues</h3>
            <button type="button" className="btn sm ghost" onClick={() => navigate('/performance')}>
              <Ic n="trend" />
              All queues
            </button>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Waiting</th>
                  <th>Longest</th>
                  <th>On queue</th>
                  <th>Interacting</th>
                  <th>SL</th>
                  <th>ASA</th>
                  <th>Abandon</th>
                </tr>
              </thead>
              <tbody>
                {queueRows.length ? (
                  queueRows.map((row) => (
                    <tr key={row.uuid}>
                      <td style={{ fontWeight: 700 }}>{row.name}</td>
                      <td className="num">{row.waiting}</td>
                      <td className="num">
                        {row.longestWaitTimestamp ? (
                          <Timer startTime={row.longestWaitTimestamp} />
                        ) : (
                          <span style={{ color: 'var(--ink-4)' }}>—</span>
                        )}
                      </td>
                      <td className="num">
                        {row.available}
                        <span style={{ color: 'var(--ink-4)' }}>/{row.membersCount}</span>
                      </td>
                      <td className="num">{row.interacting}</td>
                      <td>{slTag(row.sla)}</td>
                      <td className="num">
                        {row.asa === null ? (
                          <span style={{ color: 'var(--ink-4)' }}>—</span>
                        ) : (
                          formatSecsToClock(Math.round(row.asa))
                        )}
                      </td>
                      <td className="num">{row.abandonRate}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty">
                        <Ic n="list" />
                        <p>No queues are configured yet.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Agent status distribution ──────────────────────────────────
            Where the floor actually is right now, before the roster below. */}
        <div className="panel-card" style={{ marginTop: 16 }}>
          <div className="pc-head">
            <h3>Agent status distribution</h3>
            <span className="pc-right num" style={{ color: 'var(--ink-4)', fontSize: 11 }}>
              {liveAgents.length} on the roster
            </span>
          </div>
          <div className="pc-body">
            {/* The whole roster as one bar, before the states are listed out.
                Four separate bars each measured against its own empty track say
                how big each state is; one bar divided between them says how the
                team is split, which is the question this panel exists to
                answer. The rows below stay as the detail. */}
            {stateDistribution.length ? (
              <div className="rosterbar" role="img" aria-label={rosterSummary}>
                {stateDistribution.map((slice) => (
                  <span
                    key={slice.state}
                    style={{
                      width: `${slice.pct}%`,
                      background: slice.state === 'Offline' ? 'var(--ink-4)' : 'var(--accent)',
                    }}
                    title={`${slice.state} · ${slice.count} · ${slice.pct}%`}
                  />
                ))}
              </div>
            ) : null}
            {stateDistribution.length ? (
              stateDistribution.map((slice) => (
                <div className="hbar" key={slice.state}>
                  <span className="hbar-l">
                    <span className={STATE_CLASS[slice.state] || 'state away'}>{slice.state}</span>
                  </span>
                  <span className="hbar-t">
                    <i
                      style={{
                        width: `${slice.pct}%`,
                        background: slice.state === 'Offline' ? 'var(--ink-4)' : 'var(--accent)',
                      }}
                    />
                  </span>
                  <span className="hbar-v num">
                    {slice.count}
                    <span style={{ color: 'var(--ink-4)' }}> · {slice.pct}%</span>
                  </span>
                </div>
              ))
            ) : (
              <div className="empty">
                <Ic n="users" />
                <p>Nobody is logged in yet.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Agents ─────────────────────────────────────────────────────
            Occupancy, adherence and sentiment are in the artifact but have no
            service behind them yet, so this shows what the platform knows
            rather than filling the columns in. */}
        <div className="panel-card" style={{ marginTop: 16 }}>
          <div className="pc-head">
            <h3>Agents</h3>
            <button type="button" className="btn sm ghost" onClick={() => navigate('/performance')}>
              <Ic n="users" />
              All agents
            </button>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Queue</th>
                  <th>State</th>
                  <th>Time in state</th>
                  <th>Handled</th>
                  <th>AHT</th>
                </tr>
              </thead>
              <tbody>
                {agentsByActivity.length ? (
                  agentsByActivity.map((agent) => (
                    <tr key={agent.extension || agent.name}>
                      <td>
                        <span style={{ fontWeight: 700 }}>{agent.name}</span>
                        {agent.extension ? (
                          <span className="num" style={{ color: 'var(--ink-4)' }}>
                            {' '}
                            · {agent.extension}
                          </span>
                        ) : null}
                      </td>
                      <td>{agent.queueOrCampaign}</td>
                      <td>
                        <span className={STATE_CLASS[agent.status] || 'state away'}>
                          {agent.status}
                        </span>
                      </td>
                      <td className="num">
                        {agent.callStart ? (
                          <Timer startTime={agent.callStart} />
                        ) : (
                          <span style={{ color: 'var(--ink-4)' }}>—</span>
                        )}
                      </td>
                      <td className="num">{agent.handledToday}</td>
                      <td className="num">
                        {agent.aht === null ? (
                          <span style={{ color: 'var(--ink-4)' }}>—</span>
                        ) : (
                          formatSecsToClock(Math.round(agent.aht * 60))
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty">
                        <Ic n="users" />
                        <p>No agents on the roster yet.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Interactions ───────────────────────────────────────────────
            Live calls only. Sentiment is in the artifact but needs the
            Copilot transcript service, so the column is left out rather
            than shown empty. */}
        <div className="panel-card" style={{ marginTop: 16 }}>
          <div className="pc-head">
            <h3>Interactions</h3>
            <span className="pc-right num" style={{ color: 'var(--ink-4)', fontSize: 11 }}>
              {interactions.length} in progress
            </span>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Customer</th>
                  <th>Number</th>
                  <th>Queue</th>
                  <th>Agent</th>
                  <th>Duration</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {interactions.length ? (
                  interactions.map((call) => (
                    <tr key={call.id}>
                      <td className="num">
                        {call.startedAt ? moment(call.startedAt).format('HH:mm') : '—'}
                      </td>
                      <td style={{ fontWeight: 700 }}>{call.customer}</td>
                      <td className="num">{call.number}</td>
                      <td>{call.queue}</td>
                      <td>{call.agent}</td>
                      <td className="num">
                        {call.startedAt ? (
                          <Timer startTime={call.startedAt} />
                        ) : (
                          <span style={{ color: 'var(--ink-4)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={call.waiting ? 'state acw' : 'state busy'}
                          style={{ textTransform: 'capitalize' }}
                        >
                          {call.state}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">
                        <Ic n="phone" />
                        <p>Nothing on the wire right now.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
