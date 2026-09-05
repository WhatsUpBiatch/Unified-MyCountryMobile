import { useEffect, useMemo, useRef, useState } from 'react';
import type { DialpadSession } from '@/context/dialpad-context';
import type { ConsoleCallRow } from './call-list-column';
import NumberWithFlag from '@/components/custom/number-with-flag';
import { Ic } from './icons';
import type { ConsoleCallState } from './use-console-call';
import { useCopilotAsk } from './use-copilot-ask';
import { useCopilotContext, useCopilotSuggestions } from './copilot-client';
import SummaryPane from './panes/summary-pane';
import TranscriptPane from './panes/transcript-pane';
import NotesPane from './panes/notes-pane';
import HistoryPane from './panes/history-pane';
import ContactPane from './panes/contact-pane';
import Turn from './panes/turn';
import {
  buildBrief,
  buildCards,
  buildSayNext,
  sentimentColor,
  SUGGESTED_QUESTIONS,
  type ConsoleTurn,
  type CopilotCard,
} from './copilot-adapter';

type PanelTab = 'copilot' | 'summary' | 'transcript' | 'notes' | 'history' | 'contact';

const TABS: { id: PanelTab; label: string; ai?: boolean }[] = [
  { id: 'copilot', label: 'Copilot', ai: true },
  { id: 'summary', label: 'Summary' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'notes', label: 'Notes' },
  { id: 'history', label: 'History' },
  { id: 'contact', label: 'Contact' },
];

type Props = {
  state: ConsoleCallState;
  session: DialpadSession | null;
  turns: ConsoleTurn[];
  sentiment: number;
  talk: number;
  checklist: boolean[];
  selectedNumber?: string;
  selectedCall?: ConsoleCallRow | null;
  panelRequest?: { tab: 'transcript'; leg: any; at: number } | null;
};

/* ---------------------------------------------------------------- meters ---- */

const Meters = ({
  sentiment,
  talk,
  checklist,
}: {
  sentiment: number;
  talk: number;
  checklist: boolean[];
}) => {
  const done = checklist.filter(Boolean).length;
  return (
    <div className="meters">
      <div className="meter">
        <div className="k">Customer sentiment</div>
        <div className="v num" style={{ color: sentimentColor(sentiment) }}>
          {sentiment > 0 ? '+' : ''}
          {sentiment}
        </div>
        <div className="bar">
          <i style={{ width: `${Math.abs(sentiment)}%`, background: sentimentColor(sentiment) }} />
        </div>
      </div>
      <div className="meter">
        <div className="k">Your talk ratio</div>
        <div className="v num">{talk}%</div>
        <div className="bar">
          <i
            style={{ width: `${talk}%`, background: talk > 55 ? 'var(--warn)' : 'var(--accent)' }}
          />
        </div>
      </div>
      <div className="meter">
        <div className="k">Checklist</div>
        <div className="v num">
          {done}
          <span style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 600 }}>
            /{checklist.length}
          </span>
        </div>
        <div className="bar">
          <i style={{ width: `${(done / checklist.length) * 100}%`, background: 'var(--live)' }} />
        </div>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------- cards ---- */

const Card = ({ card }: { card: CopilotCard }) => (
  <div
    className={`aicard ${card.level === 'crit' ? 'critc' : card.level === 'warn' ? 'warnc' : ''}`}
  >
    <div className="ac-head">
      <span className="ac-kind">
        {card.level ? <Ic n="alert" size={12} /> : <Ic n="spark" size={12} fill />} {card.title}
      </span>
      <span
        className={`src ${card.source === 'live' ? 'live' : card.source === 'stub' ? '' : 'ai'}`}
        style={{ marginLeft: 'auto' }}
      >
        {card.src}
      </span>
    </div>
    <div className="ac-body" dangerouslySetInnerHTML={{ __html: card.body }} />
  </div>
);

/* -------------------------------------------------------------- ask dock ---- */

const AskDock = ({ session }: { session: DialpadSession | null }) => {
  const {
    ask,
    socketOffline,
    contextSummary,
    messages,
    canAsk,
    noAgent,
    agentsLoading,
    agentOptions,
    agentId,
    setAgentId,
  } = useCopilotAsk(session);
  const [text, setText] = useState('');

  const send = (value: string) => {
    if (!value.trim() || !canAsk) return;
    ask(value);
    setText('');
  };

  return (
    <>
      <div className="pscroll" style={{ borderTop: '1px solid var(--line)' }}>
        {messages.length
          ? messages.map((m, i) => (
              <div className="qa" key={i}>
                {m.role === 'q' ? (
                  <div className="bub-q">{m.text}</div>
                ) : m.pending ? (
                  <div className="bub-a">
                    <span className="typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                ) : (
                  <div className="bub-a">{m.text}</div>
                )}
              </div>
            ))
          : null}
      </div>
      <div className="askdock">
        <div className="scope">
          {socketOffline ? (
            <span className="scopebtn offline">
              <Ic n="alert" size={10} /> AI service not connected
            </span>
          ) : agentsLoading ? (
            <span className="scopebtn">Loading agents…</span>
          ) : noAgent ? (
            <span className="scopebtn">No AI agent configured</span>
          ) : (
            agentOptions.map((a: any) => (
              <button
                type="button"
                key={a.value}
                className={`scopebtn ${agentId === a.value ? 'on' : ''}`}
                onClick={() => setAgentId(a.value)}
              >
                {a.label}
              </button>
            ))
          )}
        </div>
        <div className="askrow">
          <textarea
            rows={1}
            placeholder={
              socketOffline
                ? 'Copilot is offline — the AI socket is not connected'
                : noAgent
                  ? 'No AI agent available'
                  : canAsk
                    ? 'Ask the Copilot about this call…'
                    : 'Available once a call is connected'
            }
            value={text}
            disabled={!canAsk}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          <button
            type="button"
            className="sendbtn"
            aria-label="Ask"
            disabled={!canAsk}
            onClick={() => send(text)}
          >
            <Ic n="send" size={17} />
          </button>
        </div>
        {canAsk && contextSummary ? (
          <div className="ask-context">
            <Ic n="merge" size={10} />
            Sending with this call: {contextSummary.hasContact ? 'contact record' : 'number only'}
            {contextSummary.turns
              ? ` · last ${contextSummary.turns} turns`
              : ' · no transcript yet'}
          </div>
        ) : null}
        {!messages.length && canAsk ? (
          <div className="suggests">
            {SUGGESTED_QUESTIONS.map((s) => (
              <button type="button" className="sugg" key={s} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
};

/* ----------------------------------------------------------------- panes ---- */

const CopilotPane = ({
  state,
  session,
  turns,
  sentiment,
  talk,
  checklist,
  selectedCall,
  onGoTab,
}: Props & { onGoTab?: (tab: PanelTab) => void }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [briefOpen, setBriefOpen] = useState(true);
  // Live copilot output wins; the derived cards remain the fallback until the
  // backend worker is shipped (see copilot-client.ts).
  const live = useCopilotSuggestions(session);
  const liveBrief = useCopilotContext(session);

  const derivedCards = useMemo(
    () => buildCards(session, turns, checklist),
    [session, turns, checklist],
  );
  const derivedSayNext = useMemo(() => buildSayNext(turns, checklist), [turns, checklist]);
  const cards = live.cards.length ? live.cards : derivedCards;
  const sayNext = live.sayNext || derivedSayNext;
  const brief = useMemo(() => liveBrief || buildBrief(session), [liveBrief, session]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns.length, cards.length]);

  if (state === 'idle') {
    return (
      <>
        <div className="pscroll">
          {selectedCall ? (
            // a past call is open in the stage — show what we know about it
            // rather than an empty "armed" state
            <>
              <div className="card card-pad">
                <div className="sect-title" style={{ marginBottom: 10 }}>
                  <Ic n="clock" size={13} /> Selected call
                </div>
                <div className="kv">
                  <span className="k">Contact</span>
                  <span className="v">{selectedCall.name}</span>
                </div>
                <div className="kv">
                  <span className="k">Number</span>
                  <span className="v num">
                    <NumberWithFlag number={selectedCall.number} />
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Direction</span>
                  <span className="v">
                    {selectedCall.direction === 'out'
                      ? 'Outbound'
                      : selectedCall.direction === 'miss'
                        ? 'Missed'
                        : 'Inbound'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">When</span>
                  <span className="v">{selectedCall.time}</span>
                </div>
                <div className="kv">
                  <span className="k">Duration</span>
                  <span className="v num">{selectedCall.duration}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="mini" onClick={() => onGoTab?.('transcript')}>
                  <Ic n="book" size={12} />
                  Transcript
                </button>
                <button type="button" className="mini" onClick={() => onGoTab?.('notes')}>
                  <Ic n="note" size={12} />
                  Notes
                </button>
                <button type="button" className="mini" onClick={() => onGoTab?.('history')}>
                  <Ic n="clock" size={12} />
                  All calls with this number
                </button>
              </div>

              <div className="aicard">
                <div className="ac-head">
                  <span className="ac-kind">
                    <Ic n="spark" size={12} fill /> Copilot
                  </span>
                  <span className="src" style={{ marginLeft: 'auto' }}>
                    live calls only
                  </span>
                </div>
                <div className="ac-body">
                  Ask Copilot works while you are on a call. For this past call, the stored
                  transcript and notes are in the tabs above.
                </div>
              </div>
            </>
          ) : (
            <div className="empty" style={{ padding: '20px 0' }}>
              <Ic n="spark" size={34} fill />
              <p>
                <strong style={{ color: 'var(--ink)' }}>Copilot is armed.</strong>
                <br />
                It transcribes as soon as a call connects, and you can ask it about the call while
                you are on it.
              </p>
            </div>
          )}
        </div>
        <AskDock session={session} />
      </>
    );
  }

  return (
    <>
      {state === 'active' || state === 'wrapup' ? (
        <Meters sentiment={sentiment} talk={talk} checklist={checklist} />
      ) : null}
      <div className="pscroll" ref={scrollRef}>
        <div className={`brief ${briefOpen ? '' : 'closed'}`}>
          <button type="button" className="brief-head" onClick={() => setBriefOpen((v) => !v)}>
            <span className="ac-kind" style={{ color: 'var(--accent-ink)' }}>
              <Ic n="user" size={12} /> Customer brief
            </span>
            <span className="brief-chev">
              <Ic n="chev" size={14} />
            </span>
          </button>
          <div className="brief-body">
            {brief.map((row) => (
              <div className="brow" key={row.k}>
                <div className="bk">
                  {row.k}
                  <span className={`src ${row.source === 'live' ? 'live' : ''}`}>{row.src}</span>
                </div>
                <div className="bv" dangerouslySetInnerHTML={{ __html: row.v }} />
              </div>
            ))}
          </div>
        </div>

        {state === 'incoming' || state === 'dialing' ? (
          <div className="aicard">
            <div className="ac-head">
              <span className="ac-kind">
                <Ic n="spark" size={12} fill /> Transcript
              </span>
              <span className="src" style={{ marginLeft: 'auto' }}>
                ASR · standing by
              </span>
            </div>
            <div className="ac-body">
              Streaming starts when media connects. Everything above came from stored platform data
              — no audio has been processed yet.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className="eyebrow">Live transcript</span>
              <span className={`tag ${turns.length ? 'pos' : 'neu'}`}>
                {session?.transcriptionHasStarted === 'start'
                  ? 'streaming'
                  : turns.length
                    ? 'ended'
                    : 'not started'}
              </span>
            </div>
            {turns.length ? (
              turns.filter((t) => !t.isSummary).map((t) => <Turn key={t.id} turn={t} />)
            ) : (
              <div className="empty" style={{ padding: '18px 0' }}>
                <Ic n="mic" size={28} />
                <p>
                  No transcript yet. Start transcription from the call controls if it did not begin
                  automatically.
                </p>
              </div>
            )}
            {cards.map((c) => (
              <Card card={c} key={c.id} />
            ))}
            {sayNext && state === 'active' ? (
              <div className="saynext">
                <div className="ac-head">
                  <span className="ac-kind">
                    <Ic n="spark" size={12} fill /> Say this next
                  </span>
                  <span className="src ai" style={{ marginLeft: 'auto' }}>
                    {sayNext.src}
                  </span>
                </div>
                <div className="q">{sayNext.text}</div>
              </div>
            ) : null}
          </>
        )}
      </div>
      <AskDock session={session} />
    </>
  );
};

/* ----------------------------------------------------------------- panel ---- */

const PanelColumn = (props: Props) => {
  const [tab, setTab] = useState<PanelTab>('copilot');
  const { state, session, turns } = props;

  // Follow the call the way the artifact does: copilot while live, recap after.
  const requestAt = props.panelRequest?.at;
  useEffect(() => {
    if (requestAt && props.panelRequest?.tab) setTab(props.panelRequest.tab);
  }, [requestAt]);

  const prevState = useRef<ConsoleCallState>(state);
  useEffect(() => {
    if (prevState.current !== 'wrapup' && state === 'wrapup') setTab('summary');
    if (prevState.current === 'idle' && (state === 'incoming' || state === 'dialing')) {
      setTab('copilot');
    }
    prevState.current = state;
  }, [state]);

  const counts: Partial<Record<PanelTab, number>> = { copilot: turns.length || 0 };

  return (
    <div className="col panel-col">
      <div className="panel">
        <div className="panel-tabs">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`ptab ${t.ai ? 'ai-tab' : ''} ${tab === t.id ? 'on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.ai ? <Ic n="spark" size={12} fill /> : null}
              {t.label}
              {counts[t.id] ? <span className="cnt">{counts[t.id]}</span> : null}
            </button>
          ))}
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div className="ppane on">
            {tab === 'copilot' ? <CopilotPane {...props} onGoTab={setTab} /> : null}
            {tab === 'summary' ? (
              <SummaryPane
                state={state}
                session={session}
                turns={turns}
                sentiment={props.sentiment}
                talk={props.talk}
                checklist={props.checklist}
                selectedCall={props.selectedCall}
              />
            ) : null}
            {tab === 'transcript' ? (
              <TranscriptPane
                session={session}
                turns={turns}
                selectedCall={props.selectedCall}
                legOverride={props.panelRequest?.leg}
              />
            ) : null}
            {tab === 'notes' ? (
              <NotesPane session={session} selectedCall={props.selectedCall} />
            ) : null}
            {tab === 'history' ? (
              <HistoryPane
                session={session}
                selectedCall={props.selectedCall}
                selectedNumber={props.selectedNumber}
              />
            ) : null}
            {tab === 'contact' ? (
              <ContactPane session={session} selectedCall={props.selectedCall} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PanelColumn;
