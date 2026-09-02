import { useMemo, useState } from 'react';
import DialpadMaxiTabDispositions from '@/components/dialpad/components/dialpad-maxi-tab-dispositions';
import DialpadEndedScreen from '@/components/dialpad/components/dialpad-ended-screen';
import DialpadAddUserList from '@/components/dialpad/components/dialpad-add-user-list';
import DialpadMergeList from '@/components/dialpad/components/dialpad-merge-list';
import DialpadConferenceMembersList from '@/components/dialpad/components/dialpad-conference-members-list';
import DialpadMaxiScriptSidebar from '@/components/dialpad/components/dialpad-maxi-script-sidebar';
import { useDialpadCallerIdOptions } from '@/hooks/use-dialpad-caller-id-options';
import { useUsersDirectory } from '@/hooks/use-users-directory';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useUser } from '@/hooks/use-user';
import { getHeaderFirstValue } from '@/components/dialpad/session-display';
import Flag from '@/components/flag';
import type { DialpadSession } from '@/context/dialpad-context';
import type { ConsoleCallRow } from './call-list-column';
import { Ic } from './icons';
import { useConsoleDialer } from './dial-number';
import CallRecord from './call-record';
import { isTerminalSession, mmss, type ConsoleCallState } from './use-console-call';
import {
  buildEnrichment,
  CHECKLIST,
  contactDisplayName,
  initialsOf,
  lineHealth,
  type ConsoleTurn,
} from './copilot-adapter';

/* Mirrors dialpad-transcript-manager.tsx's own helper of the same name - the
   manual "Transcribe" button needs the same call id the automatic path uses
   to start transcription, and it isn't exported from that file. */
const getSessionSipCallId = (session: DialpadSession | null | undefined): string => {
  if (!session) return '';
  return String(
    session?.liveCallData?.sip_call_id ||
      getHeaderFirstValue(session?.headers, 'x-cid') ||
      getHeaderFirstValue(session?.headers, 'call-id') ||
      '',
  ).trim();
};

const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
];

type StageProps = {
  state: ConsoleCallState;
  session: DialpadSession | null;
  secs: number;
  dialpad: ReturnType<typeof import('@/hooks/use-dialpad').useDialpad>;
  turns: ConsoleTurn[];
  checklist: boolean[];
  onEndWrapup: () => void;
  /** a past call picked in the left column — shown in the stage while idle */
  selectedCall: ConsoleCallRow | null;
  onBackToDialer: () => void;
  onOpenTranscript: (leg: any) => void;
};

/* ---------------------------------------------------------------- caller ---- */

const CallerBlock = ({
  session,
  state,
  secs,
}: {
  session: DialpadSession | null;
  state: ConsoleCallState;
  secs: number;
}) => {
  const name = contactDisplayName(session);
  const pill =
    state === 'incoming'
      ? { cls: 'ringing', label: 'Incoming' }
      : state === 'dialing'
        ? { cls: 'ringing', label: 'Ringing' }
        : state === 'wrapup'
          ? { cls: 'wrap', label: 'Wrap-up' }
          : session?.isOnHold
            ? { cls: 'held', label: 'On hold' }
            : { cls: 'live', label: 'Connected' };

  const contact = session?.contactInfo;
  const queue = session?.queueMetaData?.response;

  return (
    <div className="card">
      <div className="caller">
        <div className="caller-av">{initialsOf(name)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="caller-name">{name}</div>
          <div className="caller-num num">
            {session?.remoteNumber}
            {contact?.company ? ` · ${contact.company}` : ''}
          </div>
        </div>
        <div className="caller-state">
          <span
            className={`state-pill ${pill.cls} ${state === 'incoming' || state === 'dialing' ? 'pulsing' : ''}`}
          >
            {state === 'active' && !session?.isOnHold ? <span className="dot green" /> : null}
            {pill.label}
          </span>
          {state === 'active' || state === 'wrapup' ? (
            <div className="timer num">{mmss(secs)}</div>
          ) : null}
        </div>
      </div>
      <div className="popstrip">
        <div className="popcell">
          <div className="k">Contact</div>
          <div className="v">{contact ? name : 'Not in contacts'}</div>
        </div>
        <div className="popcell">
          <div className="k">Company</div>
          <div className="v">{contact?.company || '—'}</div>
        </div>
        <div className="popcell">
          <div className="k">Queue</div>
          <div className="v">{queue?.name || '—'}</div>
        </div>
        <div className="popcell">
          <div className="k">Direction</div>
          <div className="v">{session?.direction === 'incoming' ? 'Inbound' : 'Outbound'}</div>
        </div>
        <div className="popcell">
          <div className="k">Recording</div>
          <div className="v" style={{ color: session?.isRecording ? 'var(--crit)' : undefined }}>
            {session?.isRecording ? 'On' : 'Off'}
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------- session switch ---- */

/**
 * Multiple concurrent calls. The dialpad overlay (which carries the platform's
 * own session switcher) renders nothing on /phone, so the console has to offer
 * this itself — otherwise a second inbound call while you are talking is
 * invisible and unanswerable on this page.
 */
const SessionStrip = ({
  sessions,
  activeId,
  onSwitch,
}: {
  sessions: DialpadSession[];
  activeId: string | null;
  onSwitch: (id: string) => void;
}) => {
  if (sessions.length < 2) return null;
  return (
    <div
      className="card card-pad"
      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      <span className="eyebrow" style={{ marginRight: 2 }}>
        {sessions.length} calls
      </span>
      {sessions.map((s) => {
        const ringing = !s.hasAnswered;
        return (
          <button
            type="button"
            key={s.id}
            className={`chip ${activeId === s.id ? 'on' : ''}`}
            onClick={() => onSwitch(s.id)}
          >
            <span
              className={`dot ${ringing ? 'amber' : s.isOnHold ? 'red' : 'green'} ${ringing ? 'pulsing' : ''}`}
            />
            {contactDisplayName(s)}
            <span className="num" style={{ opacity: 0.7 }}>
              {ringing
                ? s.direction === 'incoming'
                  ? 'ringing'
                  : 'calling'
                : s.isOnHold
                  ? 'hold'
                  : 'live'}
            </span>
          </button>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------ enrichment ---- */

const EnrichmentTicker = ({
  title,
  session,
}: {
  title: string;
  session: DialpadSession | null;
}) => {
  const rows = buildEnrichment(session);
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="sect-title">
        <Ic n="merge" size={13} /> {title}
      </div>
      <div className="enrich">
        {rows.map((row) => (
          <div className={`erow ${row.done ? '' : 'pending'}`} key={row.k}>
            <span className={`edot ${row.done ? '' : 'wait'}`}>
              {row.done ? <Ic n="check" size={10} /> : null}
            </span>
            <span className="ek">{row.k}</span>
            <span className="ev">
              {row.v}
              <span
                className={`src ${row.source === 'live' ? 'live' : ''}`}
                style={{ marginLeft: 6 }}
              >
                {row.src}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5 }}>
        Each row names the system it came from. Rows marked <strong>Not connected</strong> have no
        service behind them yet — nothing there is inferred.
      </div>
    </div>
  );
};

/* --------------------------------------------------------------- transfer ---- */

const TransferPanel = ({
  conference,
  onClose,
  onTransfer,
}: {
  conference: boolean;
  onClose: () => void;
  onTransfer: (target: string, type: 'speak_first' | 'transfer_now') => void;
}) => {
  const { users } = useUsersDirectory();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (users || []).map((u: any) => ({
      name: `${u?.first_name || ''} ${u?.last_name || ''}`.trim() || u?.email || 'User',
      extension: String(u?.extension || u?.user_info?.extension || '').trim(),
      role: u?.role || u?.department_name || 'Extension',
    }));
    const withExt = list.filter((u: any) => u.extension);
    if (!q) return withExt.slice(0, 6);
    return withExt
      .filter((u: any) => `${u.name} ${u.extension} ${u.role}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [users, query]);

  const target = query.trim();
  const isRawNumber = /^[+0-9*#]{2,}$/.test(target);

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="sect-title">
          <Ic n={conference ? 'merge' : 'transfer'} size={13} />{' '}
          {conference ? 'Add to call' : 'Transfer'}
        </span>
        <button type="button" className="thumb" style={{ marginLeft: 'auto' }} onClick={onClose}>
          <Ic n="x" size={13} />
        </button>
      </div>
      <div className="search-mini">
        <Ic n="search" size={13} />
        <input
          placeholder="Search extensions, or type a number…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="dres">
        {results.map((r: any) => (
          <button
            type="button"
            className="dres-row"
            key={r.extension}
            onClick={() => setQuery(r.extension)}
          >
            <span className="dres-av">{initialsOf(r.name)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="dres-n" style={{ display: 'block' }}>
                {r.name}
              </span>
              <span className="dres-m">
                {r.role} · <span className="num">ext {r.extension}</span>
              </span>
            </span>
          </button>
        ))}
        {!results.length && !isRawNumber ? (
          <div style={{ fontSize: 12, color: 'var(--ink-4)', padding: '6px 10px' }}>
            No matching extension. Type a full number to transfer externally.
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn ghost"
          style={{ flex: 1 }}
          disabled={!target}
          onClick={() => onTransfer(target, 'transfer_now')}
        >
          <Ic n="transfer" />
          {conference ? 'Add now' : 'Transfer now'}
        </button>
        <button
          type="button"
          className="btn primary"
          style={{ flex: 1 }}
          disabled={!target}
          onClick={() => onTransfer(target, 'speak_first')}
        >
          <Ic n="headset" />
          Ask first
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ stage ---- */

const StageColumn = ({
  state,
  session,
  secs,
  dialpad,
  turns,
  checklist,
  onEndWrapup,
  selectedCall,
  onBackToDialer,
  onOpenTranscript,
}: StageProps) => {
  const [dial, setDial] = useState('');
  const [transfer, setTransfer] = useState<null | { conference: boolean }>(null);
  const [dtmfOpen, setDtmfOpen] = useState(false);
  const [panel, setPanel] = useState<null | 'add-user' | 'merge' | 'members' | 'script'>(null);
  const {
    callerIdOptions,
    defaultCallerIdOption,
    isCallerIdFallback,
    isCallerIdUpdating,
    updateCallerIdSelection,
  } = useDialpadCallerIdOptions();
  const [callerIdOpen, setCallerIdOpen] = useState(false);
  const { users } = useUsersDirectory();
  const { dial: dial2 } = useConsoleDialer();
  const { socketEventsManager } = useSocketEvents();
  const { user } = useUser();

  // same resolution order the dialpad's maxi side panel uses
  const scriptId = String(
    session?.queueMetaData?.response?.script ||
      session?.campaignMetaData?.response?.script ||
      (session?.campaignMetaData as any)?.script ||
      session?.liveCallData?.scriptId ||
      session?.liveCallData?.script ||
      '',
  ).trim();

  const liveSessions = useMemo(
    () => Object.values(dialpad.sessions || {}).filter((s) => !isTerminalSession(s)),
    [dialpad.sessions],
  );
  const sessionStrip = (
    <SessionStrip
      sessions={liveSessions}
      activeId={dialpad.activeSessionId}
      onSwitch={dialpad.switchActiveSession}
    />
  );

  const directoryHits = useMemo(() => {
    const q = dial.trim().toLowerCase();
    if (!q) return [];
    return (users || [])
      .map((u: any) => ({
        name: `${u?.first_name || ''} ${u?.last_name || ''}`.trim() || u?.email || 'User',
        extension: String(u?.extension || u?.user_info?.extension || '').trim(),
        role: u?.role || u?.department_name || 'Extension',
      }))
      .filter((u: any) => u.extension && `${u.name} ${u.extension}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [users, dial]);

  const placeCall = (target: string) => {
    if (dial2(target)) setDial('');
  };

  const pressKey = (key: string) => {
    if (state === 'active' && session) {
      dialpad.sendDtmf(session.id, key);
      return;
    }
    setDial((d) => d + key);
  };

  /* --------------------------------------------------- idle · call record ---- */
  // A past call picked from the left column takes the stage while nothing is
  // live. `LogContent` is the platform's own call-record view — every leg,
  // authenticated recording playback, download, call-back and the call
  // intelligence / transcript view, with its plan gating intact.
  if (state === 'idle' && selectedCall) {
    return (
      <div className="col stage">
        <div className="stage-inner">
          <CallRecord
            row={selectedCall}
            onBack={onBackToDialer}
            onOpenTranscript={onOpenTranscript}
          />
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- idle ---- */
  if (state === 'idle') {
    return (
      <div className="col stage">
        <div className="stage-inner">
          <div
            className="card card-pad"
            style={{ display: 'flex', flexDirection: 'column', gap: 13 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="eyebrow">Calling as</span>

              {/* This was a static chip, so the number shown here could not be
                  changed without opening the floating dialpad — and when nothing
                  is stored on the account it shows whichever number happens to
                  be first. Picking one here writes it, which is the only way it
                  stops defaulting. */}
              <div style={{ marginLeft: 'auto', position: 'relative' }}>
                <button
                  type="button"
                  className="chip"
                  style={{ height: 26, fontSize: 11, cursor: 'pointer' }}
                  disabled={isCallerIdUpdating || callerIdOptions.length === 0}
                  aria-haspopup="listbox"
                  aria-expanded={callerIdOpen}
                  title="Choose which of your numbers people see"
                  onClick={() => setCallerIdOpen((open) => !open)}
                >
                  <Ic n="globe" size={12} />
                  {isCallerIdUpdating
                    ? 'Saving…'
                    : defaultCallerIdOption?.number || 'No caller ID'}
                  {callerIdOptions.length > 1 ? <Ic n="chev" size={11} /> : null}
                </button>

                {callerIdOpen ? (
                  <>
                    <div
                      onClick={() => setCallerIdOpen(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                      aria-hidden
                    />
                    <div
                      role="listbox"
                      aria-label="Caller ID"
                      className="card"
                      style={{
                        position: 'absolute',
                        top: 32,
                        right: 0,
                        zIndex: 41,
                        minWidth: 232,
                        padding: 5,
                        maxHeight: 280,
                        overflowY: 'auto',
                      }}
                    >
                      {callerIdOptions.map((option) => {
                        const active = option.id === defaultCallerIdOption?.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            className="popcell"
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                            onClick={async () => {
                              setCallerIdOpen(false);
                              /* No-ops for the placeholder option, and the hook
                                 refreshes the user so the label follows. */
                              await updateCallerIdSelection(option);
                            }}
                          >
                            <span className="k" style={{ minWidth: 62 }}>
                              {option.label}
                            </span>
                            <span className="v" style={{ flex: 1 }}>
                              {option.number}
                            </span>
                            {active ? <Ic n="check" size={12} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </div>

              {/* Nothing chose this number — it is simply first in the assigned
                  list. Saying so before the call beats finding out from whoever
                  answered it. */}
              {isCallerIdFallback ? (
                <span
                  className="chip"
                  title="No caller ID is saved for you, so the first assigned number is being used. Pick one to save it."
                  style={{ height: 26, fontSize: 11, color: 'var(--warn, #c2670a)' }}
                >
                  default
                </span>
              ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="dial-flag-slot">
                {dial && <Flag phoneNumber={dial.startsWith('+') ? dial : `+${dial}`} />}
              </span>
              <input
                className="dial-display num"
                placeholder="Type a name or number"
                value={dial}
                onChange={(e) => setDial(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') placeCall(dial);
                }}
                aria-label="Number or name to dial"
                autoComplete="off"
                style={{ flex: 1 }}
              />
              <span className="dial-flag-slot" aria-hidden="true" />
            </div>
            {directoryHits.length ? (
              <div className="dres">
                <div className="eyebrow" style={{ padding: '0 10px 4px' }}>
                  {directoryHits.length} match{directoryHits.length > 1 ? 'es' : ''} · directory
                </div>
                {directoryHits.map((d: any) => (
                  <button
                    type="button"
                    className="dres-row"
                    key={d.extension}
                    onClick={() => placeCall(d.extension)}
                  >
                    <span className="dres-av">{initialsOf(d.name)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="dres-n" style={{ display: 'block' }}>
                        {d.name}
                      </span>
                      <span className="dres-m">
                        {d.role} · <span className="num">ext {d.extension}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="keypad">
                {KEYS.map(([d, l]) => (
                  <button type="button" className="key" key={d} onClick={() => pressKey(d)}>
                    <b>{d}</b>
                    <i>{l}</i>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn primary"
                style={{ flex: 1 }}
                onClick={() => placeCall(dial)}
              >
                <Ic n="phone" />
                Call
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setDial('')}
                aria-label="Clear"
              >
                <Ic n="x" />
              </button>
            </div>
          </div>

          <div
            className="card card-pad"
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <div className="sect-title">
              <Ic n="bolt" size={13} /> Ready state
            </div>
            <div className="kv">
              <span className="k">Station</span>
              <span
                className="v"
                style={{ color: dialpad.isRegistered ? 'var(--live)' : 'var(--crit)' }}
              >
                WebRTC · {dialpad.isRegistered ? 'registered' : dialpad.uaStatus}
              </span>
            </div>
            <div className="kv">
              <span className="k">Extension</span>
              <span className="v num">{dialpad.sipCredentials?.extension || '—'}</span>
            </div>
            <div className="kv">
              <span className="k">Caller ID</span>
              <span className="v num">{defaultCallerIdOption?.number || '—'}</span>
            </div>
            {dialpad.lastError ? (
              <div className="kv">
                <span className="k">Last error</span>
                <span className="v" style={{ color: 'var(--crit)' }}>
                  {dialpad.lastError}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------- dialing / incoming ---- */
  if (state === 'dialing' || state === 'incoming') {
    return (
      <div className="col stage">
        <div className="stage-inner">
          {sessionStrip}
          <CallerBlock session={session} state={state} secs={secs} />
          <EnrichmentTicker
            title={
              state === 'incoming' ? 'Enriching before you answer' : 'Resolving who you are calling'
            }
            session={session}
          />
          {state === 'incoming' ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn answer"
                style={{ flex: 1, height: 46 }}
                onClick={() => session && dialpad.answerCall(session.id)}
              >
                <Ic n="phone" />
                Answer
              </button>
              <button
                type="button"
                className="btn ghost"
                style={{ height: 46 }}
                onClick={() => session && dialpad.endCall(session.id)}
              >
                <Ic n="hangup" size={17} fill />
                Decline
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn danger"
                style={{ flex: 1, height: 46 }}
                onClick={() => session && dialpad.endCall(session.id)}
              >
                <Ic n="hangup" size={18} fill />
                Cancel
              </button>
              <button
                type="button"
                className="btn ghost"
                style={{ height: 46 }}
                onClick={() =>
                  session &&
                  (session.isMuted ? dialpad.unmuteCall(session.id) : dialpad.muteCall(session.id))
                }
              >
                <Ic n={session?.isMuted ? 'micoff' : 'mic'} size={17} />
                {session?.isMuted ? 'Unmute' : 'Mute'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------- wrap-up ---- */
  if (state === 'wrapup') {
    return (
      <div className="col stage">
        <div className="stage-inner">
          <CallerBlock session={session} state={state} secs={secs} />
          <div
            className="card card-pad"
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div className="sect-title">
              <Ic n="check" size={13} /> Disposition &amp; wrap-up
            </div>
            {/* The platform's own wrap-up panel: it owns the queue/campaign
                disposition payloads, the wrap-up timer and going back to
                Available. Reused rather than reimplemented so the console
                writes exactly what the rest of the app writes. */}
            <DialpadMaxiTabDispositions activeSession={session} />
          </div>

          <div className="card card-pad console-embed-panel">
            <div className="sect-title" style={{ marginBottom: 8 }}>
              <Ic n="cal" size={13} /> After the call
            </div>
            {/* schedule callback (createEventAndTask), session summary and call
                again — the platform's own ended screen, payloads unchanged */}
            <DialpadEndedScreen
              session={session}
              onAddNotes={() => undefined}
              onCallAgain={() => session?.remoteNumber && placeCall(session.remoteNumber)}
              onClose={onEndWrapup}
            />
          </div>
          <button
            type="button"
            className="btn ghost"
            style={{ width: '100%' }}
            onClick={onEndWrapup}
          >
            <Ic n="x" />
            Close wrap-up
          </button>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------- active ---- */
  return (
    <div className="col stage">
      <div className="stage-inner">
        {sessionStrip}
        <CallerBlock session={session} state={state} secs={secs} />

        <div
          className="card card-pad"
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div className="controls">
            <button
              type="button"
              className={`ctl ${session?.isMuted ? 'on danger' : ''}`}
              onClick={() =>
                session &&
                (session.isMuted ? dialpad.unmuteCall(session.id) : dialpad.muteCall(session.id))
              }
            >
              <Ic n={session?.isMuted ? 'micoff' : 'mic'} />
              {session?.isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              className={`ctl ${session?.isOnHold ? 'on hold' : ''}`}
              onClick={() =>
                session &&
                (session.isOnHold ? dialpad.unholdCall(session.id) : dialpad.holdCall(session.id))
              }
            >
              <Ic n={session?.isOnHold ? 'play' : 'pause'} />
              {session?.isOnHold ? 'Resume' : 'Hold'}
            </button>
            <button
              type="button"
              className="ctl"
              onClick={() => setTransfer({ conference: false })}
            >
              <Ic n="transfer" />
              Transfer
            </button>
            <button
              type="button"
              className={`ctl ${panel === 'add-user' ? 'on' : ''}`}
              onClick={() => setPanel(panel === 'add-user' ? null : 'add-user')}
            >
              <Ic n="plus" />
              Add
            </button>
            <button
              type="button"
              className={`ctl ${panel === 'merge' ? 'on' : ''}`}
              onClick={() => setPanel(panel === 'merge' ? null : 'merge')}
              disabled={liveSessions.length < 2}
              title={
                liveSessions.length < 2
                  ? 'Needs a second call to merge'
                  : 'Merge two calls into a conference'
              }
            >
              <Ic n="merge" />
              Merge
            </button>
            <button
              type="button"
              className={`ctl ${dtmfOpen ? 'on' : ''}`}
              onClick={() => setDtmfOpen((v) => !v)}
            >
              <Ic n="grid" />
              Keypad
            </button>
            <button
              type="button"
              className={`ctl ${session?.isRecording ? 'on rec' : ''}`}
              onClick={() => session && dialpad.toggleRecordingCall(session.id)}
            >
              <Ic n="rec" />
              {session?.isRecording ? 'Recording' : 'Record'}
            </button>
            <button
              type="button"
              className="ctl"
              onClick={() => {
                if (!session) return;
                const startingNow = session.transcriptionHasStarted !== 'start';
                /* dialpad.handleTranscription only updates local UI state - it
                   never asks the switch to actually start transcribing. The
                   automatic path (dialpad-transcript-manager.tsx) separately
                   emits this same request; this button skipped that step
                   entirely, so clicking it showed "streaming" with no turns
                   ever arriving. Mirror the automatic path's request here. */
                if (startingNow && socketEventsManager) {
                  socketEventsManager.emit('transcript', {
                    data: {
                      type: 'transcript',
                      agent_extension: user?.user_info?.extension || '',
                      agent_name: `${user?.user_info?.first_name || ''} ${user?.user_info?.last_name || ''}`.trim(),
                      contact_number: session.remoteNumber || '',
                      direction: session.direction === 'outgoing' ? 'outbound' : 'inbound',
                      sipCallId: getSessionSipCallId(session),
                      sentiment_monitoring: false,
                      bot_enabled: false,
                    },
                  });
                } else if (!startingNow && socketEventsManager) {
                  socketEventsManager.emit('transcript-stop', {
                    data: { type: 'transcript-stop', sipCallId: getSessionSipCallId(session) },
                  });
                }
                dialpad.handleTranscription(session, startingNow ? 'start' : 'stop');
              }}
            >
              <Ic n="book" />
              {session?.transcriptionHasStarted === 'start' ? 'Stop ASR' : 'Transcribe'}
            </button>
            <button
              type="button"
              className={`ctl ${!session?.isSpeakerOn ? 'on' : ''}`}
              onClick={() => session && dialpad.toggleSpeakerCall(session.id)}
            >
              <Ic n="mega" />
              Speaker
            </button>
            {scriptId ? (
              <button
                type="button"
                className={`ctl ${panel === 'script' ? 'on' : ''}`}
                onClick={() => setPanel(panel === 'script' ? null : 'script')}
              >
                <Ic n="list" />
                Script
              </button>
            ) : null}
            {session?.conferenceData ? (
              <button
                type="button"
                className={`ctl ${panel === 'members' ? 'on' : ''}`}
                onClick={() => setPanel(panel === 'members' ? null : 'members')}
              >
                <Ic n="users" />
                Members
              </button>
            ) : null}
          </div>

          {dtmfOpen ? (
            <div className="keypad">
              {KEYS.map(([d, l]) => (
                <button type="button" className="key" key={d} onClick={() => pressKey(d)}>
                  <b>{d}</b>
                  <i>{l}</i>
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            className="btn danger"
            style={{ width: '100%', height: 46 }}
            onClick={() => session && dialpad.endCall(session.id)}
          >
            <Ic n="hangup" size={18} fill />
            End call
          </button>
        </div>

        {panel ? (
          <div className="card card-pad console-embed-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className="sect-title">
                <Ic
                  n={
                    panel === 'script'
                      ? 'list'
                      : panel === 'merge'
                        ? 'merge'
                        : panel === 'members'
                          ? 'users'
                          : 'plus'
                  }
                  size={13}
                />
                {panel === 'script'
                  ? 'Call script'
                  : panel === 'merge'
                    ? 'Merge calls'
                    : panel === 'members'
                      ? 'Conference members'
                      : 'Add to call'}
              </span>
              <button
                type="button"
                className="thumb"
                style={{ marginLeft: 'auto' }}
                onClick={() => setPanel(null)}
              >
                <Ic n="x" size={13} />
              </button>
            </div>
            {/* the platform's own in-call panels: they carry the conference and
                merge socket protocol and the call-script fetch */}
            {panel === 'add-user' ? (
              <DialpadAddUserList
                session={session}
                mode={session?.conferenceData ? 'conference' : 'pre-conference'}
                onBack={() => setPanel(null)}
              />
            ) : null}
            {panel === 'merge' ? (
              <DialpadMergeList session={session} onBack={() => setPanel(null)} />
            ) : null}
            {panel === 'members' ? (
              <DialpadConferenceMembersList session={session} onBack={() => setPanel(null)} />
            ) : null}
            {panel === 'script' ? (
              <DialpadMaxiScriptSidebar scriptId={scriptId} sessionId={session?.id} />
            ) : null}
          </div>
        ) : null}

        {transfer ? (
          <TransferPanel
            conference={transfer.conference}
            onClose={() => setTransfer(null)}
            onTransfer={(target, type) => {
              dialpad.handleTransfer(type, target);
              setTransfer(null);
            }}
          />
        ) : null}

        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div className="sect-title">
            <Ic n="check" size={13} /> Quality checklist
            <span className="src" style={{ marginLeft: 'auto' }}>
              transcript · derived
            </span>
          </div>
          {CHECKLIST.map((item, i) => (
            <div
              key={item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                fontSize: 12.5,
                color: checklist[i] ? undefined : 'var(--ink-3)',
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  display: 'grid',
                  placeItems: 'center',
                  flex: 'none',
                  background: checklist[i] ? 'var(--live)' : 'var(--surface-3)',
                  color: '#fff',
                }}
              >
                {checklist[i] ? <Ic n="check" size={11} /> : null}
              </span>
              {item.label}
              {checklist[i] ? (
                <span className="tag pos" style={{ marginLeft: 'auto' }}>
                  detected
                </span>
              ) : null}
            </div>
          ))}
          {!turns.length ? (
            <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              Ticks appear once transcription is streaming.
            </div>
          ) : null}
        </div>

        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div className="sect-title">
            <Ic n="bolt" size={13} /> Line health · this leg
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            {lineHealth(session).map((m) => (
              <div key={m.k}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-4)',
                  }}
                >
                  {m.k}
                </div>
                <div
                  className="num"
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    letterSpacing: '-.03em',
                    marginTop: 2,
                    color: m.source === 'stub' ? 'var(--ink-4)' : 'var(--live)',
                  }}
                >
                  {m.v}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            MOS and jitter need WebRTC stats piped through the SIP layer — not wired yet, so they
            read <strong>n/a</strong> rather than showing a made-up score.
          </div>
        </div>
      </div>
    </div>
  );
};

export default StageColumn;
