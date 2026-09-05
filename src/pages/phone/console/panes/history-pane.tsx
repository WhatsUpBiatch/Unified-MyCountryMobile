import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import moment from 'moment';
import { callList } from '@/services/api';
import Loader from '@/components/custom/loader';
import type { DialpadSession } from '@/context/dialpad-context';
import { Ic } from '../icons';
import { DialNumber, useConsoleDialer } from '../dial-number';
import type { ConsoleCallRow } from '../call-list-column';
import { durationSeconds } from '../copilot-adapter';
import { DEMO_ENABLED, demoInteractions } from '../demo-data';
import DemoChip from './demo-chip';

/**
 * History — every previous interaction with this number, as the artifact's
 * expandable timeline.
 *
 * The calls themselves are real: `callList` filtered by phone, the same query
 * the contact call-log uses. What the platform cannot give us per call is the
 * written recap, the outcome code and the action items that came out of it —
 * those are demo values, chipped as such.
 */

type Item = {
  id: string;
  when: string;
  dateLabel: string;
  timeLabel: string;
  relative: string;
  duration: string;
  direction: string;
  queue: string;
  agent: string;
  mood: 'pos' | 'neg' | 'neu' | 'acc';
  title: string;
  code: string;
  summary: string;
  items: string[];
  isDemoNarrative: boolean;
};

/** 0 -> "not answered", 45 -> "45s", 605 -> "10m 05s", 3725 -> "1h 02m" */
const humanDuration = (value: unknown) => {
  const n = durationSeconds(value);
  if (!Number.isFinite(n) || n <= 0) return 'not answered';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = Math.floor(n % 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
};

const HistoryPane = ({
  session,
  selectedCall,
  selectedNumber,
}: {
  session: DialpadSession | null;
  selectedCall?: ConsoleCallRow | null;
  selectedNumber?: string;
}) => {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { dial } = useConsoleDialer();

  const phone = String(session?.remoteNumber || selectedCall?.number || selectedNumber || '')
    .trim()
    .replace(/\s+/g, '');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['console-history-by-phone', phone],
    queryFn: () => callList({ page: 1, limit: 50, filter: [{ key: 'phone', value: phone }] }),
    select: (data: any) => data?.data?.data?.result?.rows || [],
    enabled: Boolean(phone),
  });

  const items: Item[] = useMemo(() => {
    const narrative = DEMO_ENABLED ? demoInteractions(phone, Math.max(4, rows.length)) : [];
    return (rows as any[]).map((row, i) => {
      const demo = narrative[i % Math.max(1, narrative.length)];
      const start = String(row?.start_stamp ?? '').trim();
      /* Same shape problem as the call list: billsec/duration are "HH:MM:SS"
         strings, so Number() was NaN and every call here read "not answered". */
      const billsec = durationSeconds(row);
      const direction = String(row?.direction || '').trim() || 'Inbound';
      const missed =
        direction === 'Missed' || String(row?.hangup_cause || '').toUpperCase() === 'NO_ANSWER';
      const at = start && moment(start).isValid() ? moment(start) : null;
      return {
        id: String(row?.uuid || row?.sipcall_id || `${i}`),
        when: at ? at.format('DD MMM YYYY · HH:mm') : '—',
        dateLabel: at ? at.format('ddd, DD MMM YYYY') : '—',
        timeLabel: at ? at.format('HH:mm:ss') : '—',
        relative: at ? at.fromNow() : '',
        duration: humanDuration(billsec),
        direction,
        queue: String(row?.queue_name || demo?.queue || '—'),
        agent: String(row?.caller_id_name || demo?.agent || '—'),
        mood: missed ? 'neg' : billsec > 120 ? 'pos' : 'neu',
        title: missed ? 'Missed call' : demo?.title || 'Call',
        code: demo?.code || '—',
        summary: missed
          ? 'The call was not answered. No conversation to summarise.'
          : demo?.summary || '',
        items: missed ? [] : demo?.items || [],
        isDemoNarrative: !missed && DEMO_ENABLED,
      };
    });
  }, [rows, phone]);

  if (!phone) {
    return (
      <div className="pscroll">
        <div className="empty">
          <Ic n="clock" size={30} />
          <p>Pick a call on the left, or start one, to see everything for that number.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pscroll">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span className="eyebrow">Interaction history</span>
        <span className="tag acc">{items.length}</span>
        <span className="src live" style={{ marginLeft: 'auto' }}>
          Call logs · live
        </span>
      </div>

      <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow">This number</div>
          <div className="num" style={{ fontSize: 13, fontWeight: 700 }}>
            <DialNumber number={phone} />
          </div>
        </div>
        <button type="button" className="btn primary sm" onClick={() => dial(phone)}>
          <Ic n="phone" size={13} />
          Call
        </button>
      </div>

      {isLoading ? (
        <div className="empty" style={{ padding: '30px 0' }}>
          <Loader />
        </div>
      ) : !items.length ? (
        <div className="empty" style={{ padding: '30px 0' }}>
          <Ic n="clock" size={28} />
          <p>No previous calls logged for this number.</p>
        </div>
      ) : (
        <div className="tl">
          {items.map((item) => {
            const isOpen = !!open[item.id];
            return (
              <div className={`tl-item ${item.mood} ${isOpen ? 'open' : ''}`} key={item.id}>
                <div className="tl-card">
                  <button
                    type="button"
                    className="tl-head"
                    onClick={() => setOpen((p) => ({ ...p, [item.id]: !p[item.id] }))}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="tl-title">{item.title}</div>
                      <div className="tl-sub">
                        <span className="num">{item.dateLabel}</span>
                        <span className="tl-dot">·</span>
                        <span className="num">{item.timeLabel}</span>
                        <span className="tl-dot">·</span>
                        <span className={`tag ${item.direction === 'Outbound' ? 'acc' : 'neu'}`}>
                          {item.direction}
                        </span>
                      </div>
                    </div>
                    <div className="tl-right">
                      <span className="tl-dur num">{item.duration}</span>
                      <span className="tl-rel">{item.relative}</span>
                    </div>
                    <span className="tl-open">
                      <Ic n="chev" size={14} />
                    </span>
                  </button>

                  <div className="tl-detail">
                    <div className="kv">
                      <span className="k">Handled by</span>
                      <span className="v">{item.agent}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Queue</span>
                      <span className="v">{item.queue}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Wrap-up code</span>
                      <span className="v">{item.code}</span>
                    </div>

                    {item.summary ? (
                      <div className="aicard" style={{ marginTop: 10 }}>
                        <div className="ac-head">
                          <span className="ac-kind">
                            <Ic n="spark" size={12} fill /> Recap
                          </span>
                          <span style={{ marginLeft: 'auto' }}>
                            {item.isDemoNarrative ? (
                              <DemoChip />
                            ) : (
                              <span className="src">Platform</span>
                            )}
                          </span>
                        </div>
                        <div className="ac-body">{item.summary}</div>
                      </div>
                    ) : null}

                    {item.items.length ? (
                      <div style={{ marginTop: 10 }}>
                        <div className="eyebrow" style={{ marginBottom: 6 }}>
                          Commitments made
                        </div>
                        {item.items.map((line) => {
                          const failed = /not completed|open \d/i.test(line);
                          return (
                            <div className="commit" key={line}>
                              <span className={`commit-dot ${failed ? 'bad' : 'good'}`}>
                                <Ic n={failed ? 'alert' : 'check'} size={10} />
                              </span>
                              <span>{line}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HistoryPane;
