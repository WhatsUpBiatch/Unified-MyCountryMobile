import { useMemo, useState } from 'react';
import moment from 'moment';
import { AuthenticatedAudio } from '@/components/custom/authenticated-media';
import { handleDownloadFile, MEDIA_URL } from '@/lib/utils';
import { useGetExtensions } from '@/hooks/common';
import { useCompanyFeatures } from '@/hooks/rbac';
import { useUser } from '@/hooks/use-user';
import { getUserNameByExtension } from '@/lib/extension-utility';
import NumberWithFlag from '@/components/custom/number-with-flag';
import { Ic } from './icons';
import { DialNumber, useConsoleDialer } from './dial-number';
import {
  durationSeconds,
  formatDuration,
  initialsOf,
  isNumberLike,
  wasAnswered,
} from './copilot-adapter';
import type { ConsoleCallRow } from './call-list-column';

/**
 * A past call, rendered in the console's own language.
 *
 * Replaces the embedded `LogContent` panel: same data and the same
 * authenticated media components underneath (AuthenticatedAudio and
 * handleDownloadFile both go through the signed-URL hook), but one header
 * instead of two and no app-styled chrome inside the console. It also stops
 * the grid blow-out that squeezed the intelligence panel — this markup has no
 * large intrinsic min-width.
 */

const isMeaningful = (v: unknown) => {
  const s = String(v ?? '').trim();
  return Boolean(s) && s.toLowerCase() !== 'na' && s.toLowerCase() !== 'null';
};

/* The API sends `billsec`/`duration` as "HH:MM:SS" strings and only
   `billsectotal` as a number, so Number() here produced NaN and every leg read
   00:00. durationSeconds understands all three. */
/* Unanswered legs show no length: `duration` on those is ring time, not talk
   time, and printing it claims a conversation that never happened. */
const clock = (log: any) => (wasAnswered(log) ? formatDuration(durationSeconds(log)) : '—');

export type RecordLeg = {
  id: string;
  raw: any;
  direction: 'in' | 'out' | 'miss';
  when: string;
  duration: string;
  by: string;
  viaDid: string;
  recordingUrl: string;
  transcriptUrl: string;
};

const CallRecord = ({
  row,
  onBack,
  onOpenTranscript,
}: {
  row: ConsoleCallRow;
  onBack: () => void;
  onOpenTranscript: (leg: any) => void;
}) => {
  const { user } = useUser();
  const { features } = useCompanyFeatures();
  const { dial } = useConsoleDialer();
  const { data: extensionList } = useGetExtensions({
    page: 1,
    limit: 1000,
    filters: [],
    search: '',
  });
  const [playingId, setPlayingId] = useState<string | null>(null);
  /* Opening a leg's transcript used to give no indication of WHICH leg the
     right-hand panel was describing, once a call had more than one. */
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  const companyUuid = String(user?.company_info?.uuid || '').trim();
  const reportsActionAccess = features?.plan_features?.reports?.action;
  const canListen = Boolean(reportsActionAccess?.call_recording_listen);
  const canTranscribe = Boolean(
    features?.plan_features?.advance_call_management?.access?.TRANSCRIPTION,
  );

  const legs: RecordLeg[] = useMemo(() => {
    const source = row.logData?.acc_logs?.length ? row.logData.acc_logs : [row.raw];
    return source.filter(Boolean).map((log: any, i: number) => {
      const direction = String(log?.direction || '').trim();
      const isOutbound = direction === 'Outbound';
      const isMissed =
        direction === 'Missed' || String(log?.hangup_cause || '').toUpperCase() === 'NO_ANSWER';
      const recordingFile = String(log?.recording_file_url ?? '').trim();
      const transcriptFile = String(log?.transcript_file ?? '').trim();
      const selectedUser = extensionList?.find(
        (ex: any) => String(ex?.extension ?? '') === String(log?.extension ?? ''),
      );
      const by =
        (selectedUser
          ? `${selectedUser?.first_name || ''} ${selectedUser?.last_name || ''}`.trim()
          : '') ||
        getUserNameByExtension(extensionList as any, String(log?.extension ?? '')) ||
        String(log?.caller_id_name || '').trim() ||
        '—';
      const start = String(log?.start_stamp ?? '').trim();

      return {
        /* `uuid` identifies the call, not the leg, so sibling legs shared an
           id: pressing play matched every one of them and mounted several
           autoplaying players on the same file (and React saw duplicate keys).
           The row index makes each leg's id its own. */
        id: `${String(log?.uuid || log?.sipcall_id || log?.xml_cdr_uuid || 'leg')}#${i}`,
        raw: log,
        direction: isMissed ? 'miss' : isOutbound ? 'out' : 'in',
        when: start && moment(start).isValid() ? moment(start).format('DD MMM, h:mm A') : '—',
        duration: clock(log),
        by,
        viaDid: isMeaningful(log?.via_did) ? String(log.via_did).trim() : '',
        recordingUrl:
          recordingFile && companyUuid
            ? `${MEDIA_URL}/${companyUuid}/recording/${recordingFile}`
            : '',
        transcriptUrl:
          transcriptFile && companyUuid
            ? `${MEDIA_URL}/${companyUuid}/recording/${transcriptFile}`
            : '',
      };
    });
  }, [row, extensionList, companyUuid]);

  return (
    <>
      {/* ---- one header ---- */}
      <div className="card record-head">
        <button type="button" className="btn ghost sm" onClick={onBack}>
          <Ic n="chev" size={13} className="flip" />
          Dialer
        </button>
        <div className="caller-av record-av">
          {initialsOf(row.name) || <Ic n="user" size={18} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="record-name">
            {isNumberLike(row.name) ? <span className="num">{row.name}</span> : row.name}
            {row.contactId ? <span className="tag acc">Contact</span> : null}
          </div>
          <div className="record-sub num">
            <DialNumber number={row.number}>
              <NumberWithFlag number={row.number} />
            </DialNumber>
            <span style={{ color: 'var(--ink-4)' }}>
              {' '}
              · {legs.length} {legs.length === 1 ? 'call' : 'calls'}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={!row.number}
          onClick={() => dial(row.number)}
        >
          <Ic n="phone" />
          Call
        </button>
      </div>

      {/* ---- legs ---- */}
      <div className="card record-legs">
        {legs.map((leg) => {
          const playing = playingId === leg.id;
          const selected = selectedLegId === leg.id;
          return (
            <div className={`leg ${playing ? 'open' : ''} ${selected ? 'on' : ''}`} key={leg.id}>
              <div
                className="leg-row"
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => setSelectedLegId(leg.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedLegId(leg.id);
                  }
                }}
              >
                <div className={`cr-av ${leg.direction === 'miss' ? 'miss' : leg.direction}`}>
                  <Ic
                    n={
                      leg.direction === 'out'
                        ? 'arrow-out'
                        : leg.direction === 'miss'
                          ? 'miss'
                          : 'arrow-in'
                    }
                    size={14}
                  />
                </div>

                <div className="leg-main">
                  <div className="leg-top">
                    <span className="leg-by">
                      {leg.direction === 'out' ? 'Called by' : 'Received by'}{' '}
                      <strong>{leg.by}</strong>
                    </span>
                  </div>
                  {/* The timestamp sits with the rest of the metadata rather
                      than on the name's line, which was squeezing the agent
                      name down to "Called by Umar A…". */}
                  <div className="leg-meta">
                    <span className="leg-when num">{leg.when}</span>
                    {leg.viaDid ? (
                      <span>
                        via <NumberWithFlag number={leg.viaDid} className="num" />
                      </span>
                    ) : null}
                    <span className="num">{leg.duration}</span>
                    {leg.recordingUrl ? <span className="tag acc">Recorded</span> : null}
                    {leg.transcriptUrl ? <span className="tag ai">Transcript</span> : null}
                  </div>
                </div>

                <div className="leg-acts">
                  <button
                    type="button"
                    className={`legbtn play ${playing ? 'on' : ''}`}
                    title={
                      !leg.recordingUrl
                        ? 'No recording'
                        : !canListen
                          ? 'Your plan does not allow listening'
                          : playing
                            ? 'Hide player'
                            : 'Play recording'
                    }
                    disabled={!leg.recordingUrl || !canListen}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedLegId(leg.id);
                      setPlayingId(playing ? null : leg.id);
                    }}
                  >
                    <Ic n={playing ? 'pause' : 'play'} size={14} />
                  </button>
                  <button
                    type="button"
                    className="legbtn dl"
                    title={leg.recordingUrl ? 'Download recording' : 'No recording'}
                    disabled={!leg.recordingUrl || downloading[leg.id]}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedLegId(leg.id);
                      handleDownloadFile({
                        fileUrl: leg.recordingUrl,
                        name: `${row.name || row.number}-${leg.when}`,
                        setLoading: (value: any) =>
                          setDownloading((prev) => ({
                            ...prev,
                            [leg.id]: typeof value === 'function' ? value(prev[leg.id]) : value,
                          })),
                      });
                    }}
                  >
                    <Ic n="dl" size={14} />
                  </button>
                  <button
                    type="button"
                    className="legbtn ai"
                    title={
                      !leg.transcriptUrl
                        ? 'No transcript stored'
                        : !canTranscribe
                          ? 'Transcription is not on your plan'
                          : 'Open transcript'
                    }
                    disabled={!leg.transcriptUrl || !canTranscribe}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedLegId(leg.id);
                      onOpenTranscript(leg.raw);
                    }}
                  >
                    <Ic n="transcript" size={14} />
                  </button>
                  <button
                    type="button"
                    className="legbtn call"
                    title={`Call ${row.number}`}
                    disabled={!row.number}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedLegId(leg.id);
                      dial(row.number);
                    }}
                  >
                    <Ic n="phone" size={14} />
                  </button>
                </div>
              </div>

              {playing && leg.recordingUrl ? (
                <div className="leg-audio">
                  <AuthenticatedAudio src={leg.recordingUrl} controls autoPlay preload="metadata" />
                </div>
              ) : null}
            </div>
          );
        })}

        {!legs.length ? (
          <div className="empty" style={{ padding: '30px 0' }}>
            <Ic n="list" size={28} />
            <p>No call legs recorded for this entry.</p>
          </div>
        ) : null}
      </div>
    </>
  );
};

export default CallRecord;
