import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { pickCounterpartNumber } from '@/lib/call-number';
import moment from 'moment';
import { fetchPhone } from '@/services/api';
import { useFetchContact } from '@/hooks/common';
import { useCompanyFeatures } from '@/hooks/rbac';
import Loader from '@/components/custom/loader';
import DateDropdown from '@/components/custom/date-dropdown';
import { dropdownCallInitialVal, handleDate } from '@/components/custom/date-dropdown/constant';
import { Ic } from './icons';
import { DialNumber, useConsoleDialer } from './dial-number';

/** The three call-log sources the old phone page exposed, same `tabType` values. */
export type ConsoleLogSource = 'call' | 'recording' | 'voicemail';

export type ConsoleCallRow = {
  id: string;
  raw: any;
  direction: 'in' | 'out' | 'miss';
  name: string;
  number: string;
  time: string;
  duration: string;
  topic: string;
  contactId: string | number | null;
  hasRecording: boolean;
  /** the shape `LogContent` consumes — matches call-list.tsx's buildLogData */
  logData: {
    main: any;
    count: number;
    acc_logs: any[];
    number: string;
  };
};

const DIRECTION_FILTERS: { key: 'all' | 'in' | 'out' | 'miss'; label: string; filter: any[] }[] = [
  { key: 'all', label: 'All', filter: [] },
  { key: 'in', label: 'Inbound', filter: [{ key: 'direction', value: 'Inbound' }] },
  { key: 'out', label: 'Outbound', filter: [{ key: 'direction', value: 'Outbound' }] },
  { key: 'miss', label: 'Missed', filter: [{ key: 'direction', value: 'Missed' }] },
];

/* Sorting key for a call row. Falls back through the stamp fields the API has
   used, and returns 0 rather than NaN so an unparseable row sinks instead of
   scrambling the order around it. */
const sortStamp = (raw: any): number => {
  const value = raw?.start_stamp || raw?.created_at || raw?.answer_stamp || raw?.end_stamp;
  if (!value) return 0;
  const parsed = moment(value as any);
  return parsed.isValid() ? parsed.valueOf() : 0;
};

const secondsToClock = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const timeLabel = (stamp: unknown) => {
  if (!stamp) return '';
  const m = moment(stamp as any);
  if (!m.isValid()) return String(stamp);
  return m.isSame(moment(), 'day') ? m.format('HH:mm') : m.format('DD MMM');
};

const getEntryLogs = (main: any = {}) => {
  const callLogs = Array.isArray(main?.call_logs)
    ? main.call_logs.filter((item: any) => item && typeof item === 'object')
    : [];
  return callLogs.length ? callLogs : main && Object.keys(main).length ? [main] : [];
};

const getEntryRawNumber = (main: any = {}) => pickCounterpartNumber(main);

const getEntryNumber = (main: any = {}) => getEntryRawNumber(main).replace(/ /g, '');

/**
 * The contact map is keyed by whatever the call log stored, which is not always
 * the same shape as the number we display — it may carry spaces, a leading "+",
 * or a country prefix the saved contact lacks. Looking up only the
 * space-stripped form meant saved contacts kept reading "Not in contacts", so
 * the usual variants are tried, then a digits-only match as a last resort.
 */
const digitsOf = (value: string) => value.replace(/\D/g, '');

const findContact = (contactsByNumber: Record<string, any>, rawNumber: string) => {
  if (!contactsByNumber || !rawNumber) return null;

  const stripped = rawNumber.replace(/ /g, '');
  for (const key of [rawNumber, stripped, stripped.replace(/^\+/, ''), `+${stripped}`]) {
    if (key && contactsByNumber[key]) return contactsByNumber[key];
  }

  const digits = digitsOf(rawNumber);
  if (digits.length < 7) return null;
  const tail = digits.slice(-10);
  const match = Object.keys(contactsByNumber).find((key) => {
    const keyDigits = digitsOf(key);
    return keyDigits.length >= 7 && keyDigits.slice(-10) === tail;
  });
  return match ? contactsByNumber[match] : null;
};

export const toCallRow = (raw: any, contactsByNumber: Record<string, any>): ConsoleCallRow => {
  const rawDirection = String(raw?.direction || '').toLowerCase();
  const isMissed =
    rawDirection === 'missed' ||
    String(raw?.hangup_cause || '').toUpperCase() === 'NO_ANSWER' ||
    (rawDirection === 'inbound' && Number(raw?.billsec || raw?.duration || 0) === 0);
  const direction: ConsoleCallRow['direction'] = isMissed
    ? 'miss'
    : rawDirection === 'outbound'
      ? 'out'
      : 'in';

  const number = getEntryNumber(raw);
  const contact = findContact(contactsByNumber, getEntryRawNumber(raw)) || {};
  const savedName = contact?.first_name
    ? `${contact.first_name}${contact.last_name ? ` ${contact.last_name}` : ''}`.trim()
    : String(contact?.name || '').trim();
  /* `contact_name`/`caller_id_name` on the row do NOT reliably identify the
     other party — for a call started in the web phone the switch stamps the
     agent's own name there (it means "received by", not "calling from"), so
     showing it as this row's identity attached the agent's name to numbers
     that were never saved as a contact. Only a real saved-contact match earns
     a name here; everyone else reads "Unknown Contact", same as the legacy
     Phone page. */
  const contactName = savedName;

  const accLogs = getEntryLogs(raw);
  const hasRecording = accLogs.some((log: any) =>
    Boolean(log?.record_file || log?.recording || log?.recording_file || log?.record_path),
  );

  return {
    id: String(raw?.uuid || raw?.id || raw?.sip_call_id || `${number}-${raw?.start_stamp}`),
    raw,
    direction,
    name: contactName || 'Unknown Contact',
    number,
    time: timeLabel(raw?.start_stamp),
    duration: secondsToClock(raw?.billsec ?? raw?.duration),
    topic: String(raw?.disposition || raw?.queue_name || '').trim(),
    contactId: contact?.id || null,
    hasRecording,
    logData: {
      main: raw,
      count: raw?.count ?? accLogs.length,
      acc_logs: accLogs,
      number,
    },
  };
};

type Props = {
  selectedId: string | null;
  onSelect: (row: ConsoleCallRow) => void;
  source: ConsoleLogSource;
  onSourceChange: (source: ConsoleLogSource) => void;
  liveNumber?: string;
};

const CallListColumn = ({ selectedId, onSelect, source, onSourceChange, liveNumber }: Props) => {
  const { dial } = useConsoleDialer();
  const [direction, setDirection] = useState<'all' | 'in' | 'out' | 'miss'>('all');
  const [search, setSearch] = useState('');
  const [dropdownVal, setDropdownVal] = useState(() => ({
    ...dropdownCallInitialVal,
    date_type: 'Today',
    value: handleDate('Today'),
  }));
  const { data: contactsByNumber } = useFetchContact();
  const { features } = useCompanyFeatures();
  const callAccess = features?.plan_features?.advance_call_management?.access;

  const filterDate = dropdownVal?.value || {};
  const activeDirection =
    DIRECTION_FILTERS.find((f) => f.key === direction) || DIRECTION_FILTERS[0];
  /* "Missed" is not a direction the switch records — it is derived from the
     hangup cause, or from an inbound call that never got a talk second. Asking
     the API to filter on direction='Missed' therefore returns nothing. Inbound
     and outbound are real values and stay server-side; missed is fetched
     unfiltered and narrowed below, on the same rule `toCallRow` already uses. */
  const filterMissedLocally = source !== 'voicemail' && direction === 'miss';
  // Voicemails were never direction-filtered on the old page; keep that.
  const directionFilter =
    source === 'voicemail' || filterMissedLocally ? [] : activeDirection.filter;

  const { data, isPending, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteQuery({
      queryKey: [
        'console-call-list',
        source,
        source === 'voicemail' ? 'all' : direction,
        filterDate?.from,
        filterDate?.to,
      ],
      queryFn: ({ pageParam = 1 }) =>
        fetchPhone({
          page: pageParam,
          limit: 50,
          type: source === 'call' ? undefined : source,
          filter: directionFilter,
          filter_date: { from: filterDate?.from, to: filterDate?.to },
          sort: { key: 'start_stamp', desc: true },
        }),
      initialPageParam: 1,
      getNextPageParam: (lastPage: any) => {
        const result = lastPage?.data?.data?.result;
        const { currentPage, totalPages } = result || {};
        if (!currentPage || !totalPages || currentPage >= totalPages) return undefined;
        return currentPage + 1;
      },
    });

  const rows = useMemo(() => {
    const flat =
      data?.pages.flatMap((page: any) => page?.data?.data?.result?.rows || []) || ([] as any[]);

    /* The API groups repeat calls: one entry per number, carrying `call_logs`
       and a `count`. Rendering the entry gave one row however many times
       somebody rang — five calls from the same number looked like one. Each
       log becomes its own row instead, so the list is a call history rather
       than a contact list.

       Log fields win over entry fields, but the entry is spread underneath:
       a log carries its own time, duration and hangup cause, and inherits
       direction and caller id from the group when it does not repeat them. */
    const expanded = flat.flatMap((entry: any) => {
      const logs = getEntryLogs(entry);
      if (logs.length <= 1) return [entry];
      return logs.map((log: any) => ({ ...entry, ...log, call_logs: [log], count: 1 }));
    });

    const mapped = expanded
      .map((raw: any, index: number) => {
        const row = toCallRow(raw, contactsByNumber || {});
        /* Two calls a second apart can share every field the id is built
           from. A positional suffix keeps React keys unique so neither row
           disappears. */
        return { ...row, id: `${row.id}#${index}` };
      })
      /* Expanding breaks the server's ordering, since a group's logs arrive
         together rather than in time order across groups. */
      .sort((a, b) => sortStamp(b.raw) - sortStamp(a.raw));

    const visible = filterMissedLocally ? mapped.filter((row) => row.direction === 'miss') : mapped;
    const q = search.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((r) =>
      `${r.name} ${r.number} ${r.topic}`.toLowerCase().includes(q.replace(/^\+/, '')),
    );
  }, [data, contactsByNumber, search, filterMissedLocally]);

  /* liveNumber is just the other party's number on the in-progress session —
     it has no call id to match against, so every past call to/from that same
     number would otherwise get tagged "Live now" too. Only the most recent
     matching row (rows are already sorted newest-first) is the actual call. */
  const liveRowId = useMemo(() => {
    if (!liveNumber) return null;
    const match = rows.find((row) => row.number && row.number.endsWith(liveNumber.slice(-7)));
    return match ? match.id : null;
  }, [rows, liveNumber]);

  const sources: { key: ConsoleLogSource; label: string; show: boolean }[] = [
    { key: 'call', label: 'Calls', show: true },
    { key: 'recording', label: 'Recordings', show: Boolean(callAccess?.RECORDING) },
    { key: 'voicemail', label: 'Voicemails', show: true },
  ];

  return (
    <div className="col calls">
      <div className="col-head">
        <div className="col-title">
          <h2>
            {source === 'call' ? 'Calls' : source === 'recording' ? 'Recordings' : 'Voicemails'}
          </h2>
          <button
            type="button"
            className="thumb"
            aria-label="Refresh"
            title="Refresh"
            onClick={() => refetch()}
          >
            <Ic n={isFetching ? 'clock' : 'merge'} size={14} />
          </button>
        </div>

        {/* source tabs — same tabType values the old phone page sent */}
        <div className="panel-tabs" style={{ padding: 0, margin: '0 0 2px' }}>
          {sources
            .filter((s) => s.show)
            .map((s) => (
              <button
                type="button"
                key={s.key}
                className={`ptab ${source === s.key ? 'on' : ''}`}
                onClick={() => onSourceChange(s.key)}
              >
                {s.label}
              </button>
            ))}
        </div>

        {source !== 'voicemail' ? (
          <div className="seg" role="tablist">
            {DIRECTION_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={direction === f.key}
                className={direction === f.key ? 'on' : ''}
                onClick={() => setDirection(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="search-mini">
          <Ic n="search" size={13} />
          <input
            placeholder="Search calls…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search calls"
          />
        </div>

        <div className="console-datefilter">
          <DateDropdown
            dropdownVal={dropdownVal}
            setDropdownVal={setDropdownVal}
            customPickerPlacement="bottom"
          />
        </div>
      </div>

      <div className="list">
        {isPending ? (
          <div className="empty" style={{ height: 200 }}>
            <Loader />
          </div>
        ) : !rows.length ? (
          <div className="empty" style={{ height: 200 }}>
            <Ic n="search" size={30} />
            <p>
              No{' '}
              {source === 'voicemail'
                ? 'voicemails'
                : source === 'recording'
                  ? 'recordings'
                  : 'calls'}{' '}
              in this date range.
            </p>
          </div>
        ) : (
          <>
            {rows.map((row) => {
              const isLive = !!liveRowId && row.id === liveRowId;
              return (
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className={`call-row ${selectedId === row.id ? 'on' : ''} ${isLive ? 'live-now' : ''}`}
                  onClick={() => onSelect(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(row);
                    }
                  }}
                >
                  <div className={`cr-av ${row.direction === 'miss' ? 'miss' : row.direction}`}>
                    <Ic
                      n={
                        row.direction === 'out'
                          ? 'arrow-out'
                          : row.direction === 'miss'
                            ? 'miss'
                            : 'arrow-in'
                      }
                      size={15}
                    />
                  </div>
                  <div className="cr-body">
                    <div className="cr-top">
                      <span className="cr-name">
                        {/* an unsaved number is its own title — don't print it twice */}
                        {row.contactId ? row.name : <DialNumber number={row.number} className="num" />}
                      </span>
                      <span className="cr-time num">{row.time}</span>
                    </div>
                    <div className="cr-num">
                      {row.contactId ? (
                        <DialNumber number={row.number} className="num" />
                      ) : (
                        <span style={{ color: 'var(--ink-4)' }}>Not in contacts</span>
                      )}
                      {row.duration !== '—' ? (
                        <span style={{ color: 'var(--ink-4)' }}> · {row.duration}</span>
                      ) : null}
                    </div>
                    {row.topic ? (
                      <div
                        className="cr-num"
                        style={{ marginTop: 3, color: 'var(--ink-4)', fontSize: 11 }}
                      >
                        {row.topic}
                      </div>
                    ) : null}
                    <div className="cr-tags">
                      {row.direction === 'miss' ? <span className="tag neg">Missed</span> : null}
                      {row.hasRecording ? (
                        <span className="tag acc">
                          <Ic n="rec" size={9} /> Recorded
                        </span>
                      ) : null}
                      {isLive ? <span className="tag pos">Live now</span> : null}
                    </div>
                  </div>
                  {row.number ? (
                    <button
                      type="button"
                      className="cr-call"
                      aria-label={`Call ${row.name || row.number}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        dial(row.number);
                      }}
                    >
                      <Ic n="phone" size={14} />
                    </button>
                  ) : null}
                </div>
              );
            })}
            {hasNextPage ? (
              <div style={{ padding: 12 }}>
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ width: '100%' }}
                  disabled={isFetchingNextPage}
                  onClick={() => fetchNextPage()}
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

export default CallListColumn;
