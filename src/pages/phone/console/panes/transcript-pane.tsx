import { useEffect, useMemo, useState } from 'react';
import { MEDIA_URL } from '@/lib/utils';
import { useUser } from '@/hooks/use-user';
import { useCompanyFeatures } from '@/hooks/rbac';
import { useDialpad } from '@/hooks/use-dialpad';
import type { DialpadSession } from '@/context/dialpad-context';
import TranscriptInfo from '../../transcript-info';
import { Ic } from '../icons';
import { languageLabel, type ConsoleTurn } from '../copilot-adapter';
import { isTerminalSession } from '../use-console-call';
import type { ConsoleCallRow } from '../call-list-column';
import Turn from './turn';

/**
 * Transcript — live while a call is up, the stored transcript for a past call.
 *
 * Live turns stream onto the session via DialpadTranscriptManager. For a past
 * call the stored transcript file is handed to the platform's own
 * TranscriptInfo, which renders speaker split, sentiment and keywords against
 * the synced recording — the same view the call log opens, behind the same
 * TRANSCRIPTION plan gate.
 */
const TranscriptPane = ({
  session,
  turns,
  selectedCall,
  legOverride,
}: {
  session: DialpadSession | null;
  turns: ConsoleTurn[];
  selectedCall?: ConsoleCallRow | null;
  legOverride?: any;
}) => {
  const { user } = useUser();
  const { features } = useCompanyFeatures();
  const dialpad = useDialpad();
  const [query, setQuery] = useState('');
  const [transcriptState, setTranscriptState] = useState<{ url: string; src: string }>({
    url: '',
    src: '',
  });

  const canTranscribe = Boolean(
    features?.plan_features?.advance_call_management?.access?.TRANSCRIPTION,
  );
  const companyUuid = String(user?.company_info?.uuid || '').trim();

  const storedLeg = useMemo(() => {
    if (session) return null;
    if (legOverride) return legOverride;
    if (!selectedCall) return null;
    const legs = selectedCall.logData?.acc_logs || [];
    return (
      legs.find((leg: any) => String(leg?.transcript_file || '').trim()) ||
      (String(selectedCall.raw?.transcript_file || '').trim() ? selectedCall.raw : null)
    );
  }, [session, selectedCall, legOverride]);

  useEffect(() => {
    if (!storedLeg || !companyUuid) {
      setTranscriptState({ url: '', src: '' });
      return;
    }
    const transcriptFile = String(storedLeg?.transcript_file || '').trim();
    const recordingFile = String(storedLeg?.recording_file_url || '').trim();
    setTranscriptState({
      url: transcriptFile ? `${MEDIA_URL}/${companyUuid}/recording/${transcriptFile}` : '',
      src: recordingFile ? `${MEDIA_URL}/${companyUuid}/recording/${recordingFile}` : '',
    });
  }, [storedLeg, companyUuid]);

  if (!canTranscribe) {
    return (
      <div className="pscroll">
        <div className="empty">
          <Ic n="book" size={30} />
          <p>Transcription is not enabled on your plan.</p>
        </div>
      </div>
    );
  }

  // ---- live ----
  if (session) {
    /* The session object survives through wrap-up, so "session is not null"
       does NOT mean the call is up. Without this the badge kept reading
       "streaming" after hangup and the Start button was still offered — which
       would have asked the platform to transcribe a call that had ended. */
    const ended = isTerminalSession(session);
    const streaming =
      !ended &&
      (session.transcriptionHasStarted === 'start' || session.transcriptionHasStarted === 'resume');
    const q = query.trim().toLowerCase();
    const visible = q ? turns.filter((t) => `${t.who} ${t.text}`.toLowerCase().includes(q)) : turns;
    // languages the ASR actually reported on this call
    const languages = Array.from(new Set(turns.map((t) => t.language).filter(Boolean) as string[]));

    return (
      <div className="pscroll">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span className="eyebrow">Live transcript</span>
          <span className={`tag ${ended ? 'neu' : streaming ? 'pos' : 'neu'}`}>
            {ended ? 'call ended' : streaming ? 'streaming' : 'stopped'}
          </span>
          {languages.map((code) => (
            <span className="tag acc" key={code} title={code}>
              <Ic n="globe" size={9} /> {languageLabel(code)}
            </span>
          ))}
          {/* Nothing to start or stop once the call is down. */}
          {ended ? null : (
            <button
              type="button"
              className="mini"
              style={{ marginLeft: 'auto' }}
              onClick={() => dialpad.handleTranscription(session, streaming ? 'stop' : 'start')}
            >
              <Ic n={streaming ? 'pause' : 'play'} size={12} />
              {streaming ? 'Stop' : 'Start'}
            </button>
          )}
        </div>

        <div className="search-mini">
          <Ic n="search" size={13} />
          <input
            placeholder="Search this transcript…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search transcript"
          />
        </div>

        {visible.length ? (
          visible.map((t) =>
            t.isSummary ? (
              <div className="aicard" key={t.id}>
                <div className="ac-head">
                  <span className="ac-kind">
                    <Ic n="spark" size={12} fill /> Summary
                  </span>
                </div>
                <div className="ac-body">{t.text}</div>
              </div>
            ) : (
              <Turn key={t.id} turn={t} />
            ),
          )
        ) : (
          <div className="empty" style={{ padding: '18px 0' }}>
            <Ic n="mic" size={28} />
            <p>
              {turns.length
                ? 'Nothing in this transcript matches that search.'
                : ended
                  ? 'No transcript was captured on this call.'
                  : streaming
                    ? 'Listening — turns appear as they are spoken.'
                    : 'Transcription is stopped for this call.'}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ---- past call ----
  if (selectedCall && transcriptState.url) {
    return (
      <div className="ppane on console-embed-pane" style={{ padding: 10, minHeight: 0 }}>
        <TranscriptInfo
          initialData={transcriptState.src}
          transcriptSrcURL={transcriptState.url}
          callDetails={{
            sipCallId: String(storedLeg?.sipcall_id ?? ''),
            callID: String(storedLeg?.xml_cdr_uuid ?? ''),
          }}
          setTranscriptionState={setTranscriptState}
        />
      </div>
    );
  }

  return (
    <div className="pscroll">
      <div className="empty">
        <Ic n="book" size={30} />
        <p>
          {selectedCall
            ? 'No transcript was stored for this call.'
            : 'Pick a call on the left, or start one, to read its transcript.'}
        </p>
      </div>
    </div>
  );
};

export default TranscriptPane;
