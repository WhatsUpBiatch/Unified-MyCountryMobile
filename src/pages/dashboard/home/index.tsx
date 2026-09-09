import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import moment from 'moment';
import { useUser } from '@/hooks/use-user';
import { fetchPhone } from '@/services/api';
import {
  AlertTriangle,
  Check,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  Phone,
  PhoneOutgoing,
  Search,
  Users,
} from 'lucide-react';
import Timer from '@/components/timer';
import { useConsoleDialer } from '@/pages/phone/console/dial-number';
import { useLiveContactCentre, KPI_REFRESH_MS } from '@/hooks/use-live-contact-centre';
import { useAnimatedNumber } from '@/pages/performance/use-animated-number';
import { formatSecsToClock } from '@/pages/performance/format';
import buildQueueRows from '@/pages/performance/queue-rows';
import buildAgentRows from '@/pages/performance/agent-rows';
import {
  getMonitoringCallTimestamp,
  getMonitoringContactValue,
  isMonitoringCallForMember,
} from '@/pages/monitoring/live-call-helpers';
import { handleDate } from '@/components/custom/date-dropdown/constant';
import { isMissedCall } from '@/hooks/use-call-stats';
import { buildAttentionItems } from './attention';
import '@/components/mcm/mcm-page.css';
import '@/pages/dashboard/home-v3.css';

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


const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '—';

const round = (value: number) => String(Math.round(value));


/**
 * One ring, for the one figure with a target to be judged against.
 *
 * The page had four of these. A ring around a number that has nothing to be
 * measured against is a decoration wearing the costume of a chart — it takes
 * the space of a visualisation and carries no comparison. Service level has a
 * target, so it gets the ring; everything else is a figure.
 */
const Ring = ({ pct, tone }: { pct: number | null; tone: 'ok' | 'warn' | 'bad' | 'none' }) => {
  const size = 52;
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const value = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className={`opsring is-${tone}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="opsring-t" cx={size / 2} cy={size / 2} r={r} strokeWidth={4} />
        {/* Only when there is an arc to draw: a round cap on a zero-length dash
            still paints itself, which put a stray dot at twelve o'clock on any
            figure with no data behind it. */}
        {value > 0 ? (
          <circle
            className="opsring-a"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={`${(value / 100) * c} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </svg>
      <span className="opsring-v">{pct === null ? '—' : `${Math.round(pct)}%`}</span>
    </div>
  );
};

/**
 * The change against the hour before, when there is an hour before to compare
 * against. Renders the caption alone rather than "0%" when there is not — a
 * delta against no data is a claim.
 */
const Trend = ({ now, prev, unit }: { now: number; prev: number | null; unit: string }) => {
  if (prev === null || prev === 0) return <span>{unit}</span>;
  const change = Math.round(((now - prev) / prev) * 100);
  if (change === 0) return <span>level {unit}</span>;
  const up = change > 0;
  return (
    <>
      <span className={`trend ${up ? 'is-up' : 'is-down'}`}>
        {up ? <ArrowUpRight size={12} strokeWidth={2} /> : <ArrowDownRight size={12} strokeWidth={2} />}
        {Math.abs(change)}%
      </span>
      <span>{unit}</span>
    </>
  );
};

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

type TabKey = 'attention' | 'queues' | 'agents' | 'interactions' | 'dial';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'queues', label: 'Queues' },
  { key: 'agents', label: 'Agents' },
  { key: 'interactions', label: 'Interactions' },
  { key: 'dial', label: 'Quick dial' },
];

/** Agent state to the dot's colour. Small and subtle beats a filled pill on
    every row of a twenty-four row table. */
const ST_CLASS: Record<string, string> = {
  'On Call': 'is-oncall',
  Ringing: 'is-ring',
  'On Hold': 'is-acw',
  Available: 'is-free',
  Busy: 'is-busy',
  'Do Not Disturb': 'is-busy',
  Offline: 'is-off',
};
const Home = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const { dial } = useConsoleDialer();

  // Home always reads today; Performance keeps the date picker.
  const today = useMemo(() => handleDate('Today'), []);

  const live = useLiveContactCentre(today);
  const {
    queues,
    agentRows,
    activeQueueCalls,
    waitingCalls,
    longestWaitSecs,
    liveSlaByName,
    usersOnlineStatus,
    onlineAgentsCount,
    avgSla,
    abandonRate,
  } = live;

  const myExtension = String(user?.user_info?.extension || '').trim();
  const firstName = String(user?.user_info?.first_name || '').trim();

  /* The queues this person is actually a member of. The sub-line used to say
     only that they were not on one; saying which ones they are on is the part
     that changes what they do next. */
  const myQueues = useMemo(() => {
    const keys = [user?.user_info?.uuid, user?.user_info?.user_uuid, myExtension]
      .filter(Boolean)
      .map((value) => String(value));
    if (!keys.length) return [];
    return queues.filter((queue) => queue.memberKeys.some((key) => keys.includes(key)));
  }, [queues, user?.user_info?.uuid, user?.user_info?.user_uuid, myExtension]);

  /* ── the queues this user is a member of ─────────────────────────────── */

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

  /* The bar is a picture, so it needs saying in words for anyone who cannot see
     it — the same split, read out. */

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

  /* ── what is on the wire right now ───────────────────────────────────── */
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
        voicemails,
        missedCalls: missedRows.length,
      }),
    [
      queues,
      activeQueueCalls,
      waitingCalls,
      longestWaitSecs,
      liveSlaByName,
      usersOnlineStatus,
      onlineAgentsCount,
      voicemails,
      missedRows,
    ],
  );

  /* ── KPI strip — same eight figures Performance leads with ───────────── */
  /* The console opens on whatever needs doing. If something is breaching you
     are looking at it before you have clicked anything; if not, the floor is
     the sensible resting view. Only the initial value - once you pick a tab it
     stays picked. */
  const [tab, setTab] = useState<TabKey>(() => 'queues');
  const settledRef = useRef(false);
  useEffect(() => {
    if (settledRef.current) return;
    // The live feed arrives after the first paint; wait for it before deciding.
    if (!queues.length) return;
    settledRef.current = true;
    if (attention.length) setTab('attention');
  }, [queues.length, attention.length]);

  /* Quick dial gets a search box in the brief, so it needs somewhere to put
     what you type. Filtered on name and extension, which is what a person
     reaches for. */
  const [dialSearch, setDialSearch] = useState('');
  const dialResults = useMemo(() => {
    const term = dialSearch.trim().toLowerCase();
    if (!term) return quickDial;
    return quickDial.filter(
      (person) =>
        person.name.toLowerCase().includes(term) || person.extension.toLowerCase().includes(term),
    );
  }, [quickDial, dialSearch]);

  const waitingAnimated = useAnimatedNumber(waitingCalls.length);
  const onlineAgentsAnimated = useAnimatedNumber(onlineAgentsCount);
  const slaAnimated = useAnimatedNumber(avgSla);
  const abandonAnimated = useAnimatedNumber(abandonRate);

  /* Two kinds of fact, told apart.

     These were eight tiles of identical weight in one auto-fit row, which at
     any normal width fitted seven and orphaned the eighth on a line of its own
     beside a stretch of empty card. Worse than the wrapping: "Waiting now" is
     the state of the floor this second and "Answered today" is a total since
     midnight, and rendering them the same size says they are the same kind of
     thing. They are not - one is what you act on, the other is how the day has
     gone.

     So: three live figures at display size, then the day's running totals
     underneath at list size. Three and five both divide cleanly, so nothing
     orphans at any width, and the eye lands on the live row first because it
     is bigger, not because it happens to be leftmost. */
  /* The day bucketed by hour, from the call rows the stats hook already
     pulled. Everything time-shaped on this page - the sparklines, the activity
     chart, the hour-on-hour deltas - reads from this one derivation rather
     than each inventing its own shape. */
  const hourly = useMemo(() => {
    const rows: any[] = live.callStats?.rows || [];
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, calls: 0, answered: 0 }));
    const startOfToday = moment().startOf('day');
    rows.forEach((row: any) => {
      const stamp = row?.created_at || row?.date;
      if (!stamp) return;
      const when = moment(stamp);
      if (!when.isValid()) return;
      /* Today only. Bucketing by hour-of-day alone counted a call from
         Monday afternoon into this afternoon's column, so a panel headed
         "call volume through the day" was drawing several days at once. */
      if (!when.isSame(startOfToday, 'day')) return;
      const bucket = buckets[when.hour()];
      if (!bucket) return;
      bucket.calls += 1;
      if (!isMissedCall(row)) bucket.answered += 1;
    });
    return buckets;
  }, [live.callStats?.rows]);

  const nowHour = new Date().getHours();
  const callsThisHour = hourly[nowHour]?.calls ?? 0;
  const callsPrevHour = nowHour > 0 ? (hourly[nowHour - 1]?.calls ?? null) : null;

  const answered = live.callStats?.answeredCalls ?? 0;
  const offered = live.callStats?.totalCalls ?? 0;
  const slaTone = avgSla === null ? 'none' : avgSla >= 80 ? 'ok' : avgSla >= 60 ? 'warn' : 'bad';
  const worst = attention[0];

  return (
    <div className="mcm-page home-v3">
      <div className="page">
        <div className="ops">
          {/* ── header ─────────────────────────────────────────────────── */}
          <header className="ophead">
            <div>
              {/* The greeting names the person; the line under it says where
                  they stand on the floor. "Nothing is breaching right now" used
                  to live here and does not any more — the band below states
                  that, and stating it twice made the second one furniture. */}
              <h1>
                {greeting()}
                {firstName ? `, ${firstName}` : ''}
              </h1>
              <p className="ophead-meta">
                <b>{moment().format('dddd, D MMMM YYYY')}</b>
                <span className="ophead-sep" />
                {myQueues.length ? (
                  <>
                    Covering{' '}
                    <b>
                      {myQueues
                        .slice(0, 2)
                        .map((queue) => queue.name)
                        .join(', ')}
                      {myQueues.length > 2 ? ` +${myQueues.length - 2}` : ''}
                    </b>
                  </>
                ) : (
                  'Not on a queue — direct calls only'
                )}
                {myExtension ? (
                  <>
                    <span className="ophead-sep" />
                    ext <b>{myExtension}</b>
                  </>
                ) : null}
              </p>
            </div>
            <div className="ophead-r">
              <span className="livetag">
                <i />
                Live
              </span>
              <button type="button" className="btn" onClick={() => navigate('/performance')}>
                <BarChart3 size={14} strokeWidth={1.8} />
                Performance
              </button>
              <button type="button" className="btn is-primary" onClick={() => navigate('/phone')}>
                <Phone size={14} strokeWidth={1.8} />
                New call
              </button>
            </div>
          </header>

          {/* ── the figures ────────────────────────────────────────────────
              Pinned. These never scroll away, because the question they answer
              — what is the floor doing this second — is the one you come back
              to between every other task. */}
          <div className="kstrip">
            <div className="kcell">
              <p className="kcell-k">Waiting calls</p>
              <p className={`kcell-v${waitingCalls.length > 5 ? ' is-crit' : ''}`}>
                {round(waitingAnimated)}
              </p>
              <p className="kcell-d">
                across {queues.length} {queues.length === 1 ? 'queue' : 'queues'}
              </p>
            </div>
            <div className="kcell">
              <p className="kcell-k">Calls this hour</p>
              <p className="kcell-v">{callsThisHour}</p>
              <p className="kcell-d">
                <Trend now={callsThisHour} prev={callsPrevHour} unit="vs last hour" />
              </p>
            </div>
            <div className="kcell">
              <p className="kcell-k">Service level</p>
              <p className="kcell-v">{avgSla === null ? '—' : `${Math.round(slaAnimated)}%`}</p>
              <p className="kcell-d">target 80% in 20s</p>
            </div>
            <div className="kcell">
              <p className="kcell-k">On queue</p>
              <p className="kcell-v">{round(onlineAgentsAnimated)}</p>
              <p className="kcell-d">of {agentRows.length} agents</p>
            </div>
            <div className="kcell">
              <p className="kcell-k">Calls answered</p>
              <p className="kcell-v">{answered}</p>
              <p className="kcell-d">of {offered} offered</p>
            </div>
            <div className="kcell">
              <p className="kcell-k">Avg wait</p>
              <p className="kcell-v">
                {live.callStats?.avgWaitSec == null
                  ? '—'
                  : formatSecsToClock(Math.round(live.callStats.avgWaitSec))}
              </p>
              <p className="kcell-d">answered calls today</p>
            </div>
            <div className="kcell">
              <p className="kcell-k">Abandon rate</p>
              <p className={`kcell-v${abandonRate !== null && abandonRate > 5 ? ' is-crit' : ''}`}>
                {abandonRate === null ? '—' : `${Math.round(abandonAnimated)}%`}
              </p>
              <p className="kcell-d">{offered ? `of ${offered} calls` : 'no calls in range'}</p>
            </div>
          </div>

          {/* ── the state of play, in one line ──────────────────────────────
              Always on screen. The worst thing open, named, with the way into
              it — so a supervisor working down the agent table still knows a
              queue is breaching behind them. */}
          <div className={`band${attention.length ? ' is-hot' : ''}`}>
            {attention.length ? (
              <>
                <AlertTriangle size={14} strokeWidth={1.9} />
                <b>
                  {attention.length} {attention.length === 1 ? 'item needs' : 'items need'} you
                </b>
                <span className="band-sep" />
                <span className="band-d">{worst?.title}</span>
                <button type="button" className="btn is-sm band-a" onClick={() => setTab('attention')}>
                  Review
                </button>
              </>
            ) : (
              <>
                <Check size={14} strokeWidth={1.9} />
                <b>All clear</b>
                <span className="band-sep" />
                <span className="band-d">
                  Every queue is inside its service level and nobody is past the breach mark.
                </span>
              </>
            )}
          </div>

          {/* ── detail ─────────────────────────────────────────────────────
              One dense view at a time, filling whatever is left of the screen
              and scrolling inside itself. Five panels stacked down a page meant
              the last of them was never on screen with the first. */}
          <div className="console">
            <div className="tabs" role="tablist" aria-label="Detail">
              {TABS.map((entry) => {
                const count =
                  entry.key === 'attention'
                    ? attention.length
                    : entry.key === 'queues'
                      ? queueRows.length
                      : entry.key === 'agents'
                        ? agentsByActivity.length
                        : entry.key === 'interactions'
                          ? interactions.length
                          : quickDial.length;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === entry.key}
                    className={`tab${tab === entry.key ? ' is-on' : ''}`}
                    onClick={() => setTab(entry.key)}
                  >
                    {entry.label}
                    <span className={`tab-n${entry.key === 'attention' && count ? ' is-hot' : ''}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
              <div className="tabs-r">
                <button type="button" className="link" onClick={() => navigate('/performance')}>
                  Open in Performance <ChevronRight size={12} strokeWidth={2} />
                </button>
              </div>
            </div>

            <div className="console-b">
              {tab === 'attention' ? (
                attention.length ? (
                  <div className="pane-scroll">
                    <div className="alerts">
                      {attention.map((item) => (
                        <div key={item.id} className={`alert is-${item.level}`}>
                          <div className="alert-t">
                            <p className="alert-k">
                              {item.level === 'crit' ? 'Critical' : 'Warning'}
                            </p>
                            <p className="alert-n">{item.title}</p>
                            <p className="alert-d">{item.detail}</p>
                          </div>
                          <button
                            type="button"
                            className="btn is-sm"
                            onClick={() => navigate(item.action.to)}
                          >
                            {item.action.label}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="none">
                    <Check size={20} strokeWidth={1.5} />
                    <p>Nothing is breaching. This list fills itself the moment that changes.</p>
                  </div>
                )
              ) : null}

              {tab === 'queues' ? (
                queueRows.length ? (
                  <div className="pane-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Queue</th>
                          <th className="ta-r">Waiting</th>
                          <th>Capacity</th>
                          <th className="ta-r">Longest wait</th>
                          <th className="ta-r">Service level</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queueRows.map((row) => {
                          const pct = row.membersCount
                            ? Math.round((row.available / row.membersCount) * 100)
                            : 0;
                          const unstaffed = row.available === 0;
                          const below = row.sla !== null && row.sla < 80;
                          const tone = unstaffed ? 'bad' : below ? 'warn' : 'ok';
                          return (
                            <tr key={row.uuid}>
                              <td className="strong">{row.name}</td>
                              <td className="n ta-r">{row.waiting}</td>
                              <td>
                                <span className="cap">
                                  <span className="cap-b">
                                    <i className={`is-${tone}`} style={{ width: `${pct}%` }} />
                                  </span>
                                  <span className="cap-n">
                                    {row.available}/{row.membersCount}
                                  </span>
                                </span>
                              </td>
                              <td className="n ta-r">
                                {row.longestWaitTimestamp ? (
                                  <Timer startTime={row.longestWaitTimestamp} />
                                ) : (
                                  <span className="dim">—</span>
                                )}
                              </td>
                              <td className="n ta-r">
                                {row.sla === null ? (
                                  <span className="dim">—</span>
                                ) : (
                                  `${Math.round(row.sla)}%`
                                )}
                              </td>
                              <td>
                                <span
                                  className={`st ${
                                    unstaffed ? 'is-busy' : below ? 'is-acw' : 'is-free'
                                  }`}
                                >
                                  {unstaffed ? 'Unstaffed' : below ? 'Below target' : 'Healthy'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="none">
                    <Users size={20} strokeWidth={1.5} />
                    <p>No queues are configured yet.</p>
                  </div>
                )
              ) : null}

              {tab === 'agents' ? (
                agentsByActivity.length ? (
                  <div className="pane-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Agent</th>
                          <th>Status</th>
                          <th>Current call</th>
                          <th className="ta-r">Duration</th>
                          <th>Queue</th>
                          <th className="ta-r">Calls today</th>
                          <th className="ta-r">AHT</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {agentsByActivity.map((agent) => (
                          <tr key={agent.extension || agent.name}>
                            <td>
                              <span className="who">
                                <span className="av">{initials(agent.name)}</span>
                                <span>
                                  <span className="who-n">{agent.name}</span>
                                  {agent.extension ? (
                                    <span className="who-x">ext {agent.extension}</span>
                                  ) : null}
                                </span>
                              </span>
                            </td>
                            <td>
                              <span className={`st ${ST_CLASS[agent.status] || 'is-off'}`}>
                                {agent.status}
                              </span>
                            </td>
                            <td className="n">
                              {agent.isOnCall ? agent.callerId : <span className="dim">—</span>}
                            </td>
                            <td className="n ta-r">
                              {agent.callStart ? (
                                <Timer startTime={agent.callStart} />
                              ) : (
                                <span className="dim">—</span>
                              )}
                            </td>
                            <td>{agent.queueOrCampaign}</td>
                            <td className="n ta-r">{agent.handledToday}</td>
                            <td className="n ta-r">
                              {agent.aht === null ? (
                                <span className="dim">—</span>
                              ) : (
                                formatSecsToClock(Math.round(agent.aht * 60))
                              )}
                            </td>
                            <td className="ta-r">
                              <button
                                type="button"
                                className="rowact"
                                aria-label={`Call ${agent.name}`}
                                disabled={!agent.extension}
                                onClick={() => agent.extension && dial(agent.extension)}
                              >
                                <PhoneOutgoing size={13} strokeWidth={1.8} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="none">
                    <Users size={20} strokeWidth={1.5} />
                    <p>No agents on the roster yet.</p>
                  </div>
                )
              ) : null}

              {tab === 'interactions' ? (
                interactions.length ? (
                  <div className="pane-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Customer</th>
                          <th>Number</th>
                          <th>Queue</th>
                          <th>Agent</th>
                          <th className="ta-r">Duration</th>
                          <th>State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {interactions.map((call) => (
                          <tr key={call.id}>
                            <td className="n">
                              {call.startedAt ? moment(call.startedAt).format('HH:mm') : '—'}
                            </td>
                            <td className="strong">{call.customer}</td>
                            <td className="n">{call.number}</td>
                            <td>{call.queue}</td>
                            <td>{call.agent}</td>
                            <td className="n ta-r">
                              {call.startedAt ? (
                                <Timer startTime={call.startedAt} />
                              ) : (
                                <span className="dim">—</span>
                              )}
                            </td>
                            <td>
                              <span
                                className={`st ${call.waiting ? 'is-acw' : 'is-oncall'}`}
                                style={{ textTransform: 'capitalize' }}
                              >
                                {call.state}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="none">
                    <Phone size={20} strokeWidth={1.5} />
                    <p>Nothing on the wire right now.</p>
                  </div>
                )
              ) : null}

              {tab === 'dial' ? (
                <>
                  <div className="pane-top">
                    <label className="search">
                      <Search size={14} strokeWidth={1.8} />
                      <input
                        value={dialSearch}
                        onChange={(event) => setDialSearch(event.target.value)}
                        placeholder="Search contact or number"
                        aria-label="Search contact or number"
                      />
                    </label>
                  </div>
                  {dialResults.length ? (
                    <div className="pane-scroll">
                      <div className="dialgrid">
                        {dialResults.map((person) => (
                          <button
                            key={person.extension}
                            type="button"
                            className="dial-r"
                            title={`Call ${person.name} on ${person.extension}`}
                            onClick={() => dial(person.extension)}
                          >
                            <span className={`av${person.online ? ' is-on' : ''}`}>
                              {initials(person.name)}
                            </span>
                            <span className="dial-t">
                              <span className="dial-n">{person.name}</span>
                              <span className="dial-x">ext {person.extension}</span>
                            </span>
                            <PhoneOutgoing className="dial-go" size={14} strokeWidth={1.8} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="none">
                      <Users size={20} strokeWidth={1.5} />
                      <p>
                        {quickDial.length
                          ? 'Nobody on the roster matches that.'
                          : 'No other extensions on the roster yet.'}
                      </p>
                    </div>
                  )}
                </>
              ) : null}
            </div>

            {/* Today's figures live along the foot of the console rather than
                in a column of their own: they are the day's score, read once,
                not something you work in. */}
            <div className="foot">
              <span className="foot-f is-lead">
                <Ring pct={avgSla} tone={slaTone as any} />
                <span>
                  <span className="foot-k">Service level</span>
                  <span className="foot-v">
                    {avgSla === null ? '—' : `${Math.round(avgSla)}%`}
                    <span className="foot-n">target 80%</span>
                  </span>
                </span>
              </span>
              <span className="foot-f">
                <span className="foot-k">Calls answered</span>
                <span className="foot-v">
                  {answered}
                  <span className="foot-n">of {offered} offered</span>
                </span>
              </span>
              <span className="foot-f">
                <span className="foot-k">Average wait</span>
                <span className="foot-v">
                  {live.callStats?.avgWaitSec == null
                    ? '—'
                    : formatSecsToClock(Math.round(live.callStats.avgWaitSec))}
                  <span className="foot-n">target under 0:20</span>
                </span>
              </span>
              <span className="foot-f">
                <span className="foot-k">Abandonment</span>
                <span className="foot-v">
                  {abandonRate === null ? '—' : `${Math.round(abandonRate)}%`}
                  <span className="foot-n">target under 5%</span>
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
