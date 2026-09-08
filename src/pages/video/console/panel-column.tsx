import { useMemo, useState } from 'react';
import { Ic, type VideoIconName } from './icons';
import {
  demoActions,
  demoCaptions,
  demoChat,
  demoPoll,
  demoQuestions,
  demoRecap,
  initialsOf,
  type VideoParticipant,
} from './demo-data';
import type { VideoConsole } from './use-video-console';
import DemoChip from './panes/demo-chip';
import { Picker } from '@/components/mcm/picker';

export type PanelTab = 'people' | 'chat' | 'ai' | 'captions' | 'apps' | 'details';

const TABS: { key: PanelTab; label: string; icon: VideoIconName; ai?: boolean }[] = [
  { key: 'people', label: 'People', icon: 'users' },
  { key: 'chat', label: 'Chat', icon: 'chat' },
  { key: 'ai', label: 'AI', icon: 'spark', ai: true },
  { key: 'captions', label: 'CC', icon: 'cc' },
  { key: 'apps', label: 'Apps', icon: 'grid' },
  { key: 'details', label: 'Info', icon: 'note' },
];

const LANGUAGES = ['Off', 'English', 'Spanish', 'German', 'French', 'Hindi', 'Arabic', 'Japanese'];

const ROLE_LABEL: Record<VideoParticipant['role'], string> = {
  host: 'Host',
  cohost: 'Co-host',
  presenter: 'Presenter',
  attendee: 'Attendee',
};

type Props = {
  vc: VideoConsole;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
};

/* ---------------------------------------------------------------- people --- */

const PeoplePane = ({ vc }: { vc: VideoConsole }) => {
  if (!vc.meeting) {
    return (
      <div className="ppane">
        <div className="empty">
          <Ic n="users" />
          <p>
            Pick a meeting on the left, or start one. Everyone in the room shows up here with their
            mic, hand and connection.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ppane">
      <div className="pbar">
        <button type="button" className="mini" onClick={vc.muteAll}>
          <Ic n="micoff" />
          Mute all
        </button>
        <button type="button" className="mini" onClick={vc.lowerAllHands}>
          <Ic n="hand" />
          Lower hands
        </button>
        <button type="button" className="mini" onClick={() => vc.showToast('Invite link copied')}>
          <Ic n="plus" />
          Invite
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>
          {vc.inRoom.length} in the meeting
        </span>
      </div>

      <div className="pscroll">
        {vc.waiting.length > 0 && (
          <div className="lobby">
            <div className="lobby-head">
              <Ic n="alert" />
              <span className="lobby-t">Waiting room · {vc.waiting.length}</span>
              <button
                type="button"
                className="mini"
                style={{ marginLeft: 'auto' }}
                onClick={vc.admitAll}
              >
                Admit all
              </button>
            </div>
            {vc.waiting.map((p) => (
              <div key={p.id} className="prow">
                <span className="pav" style={{ background: p.tone }}>
                  {initialsOf(p.name)}
                </span>
                <div className="pmain">
                  <div className="pname">
                    <span>{p.name}</span>
                    {p.external && (
                      <span className="tag warn">
                        <Ic n="shield" />
                        External
                      </span>
                    )}
                  </div>
                  <div className="pmeta">{p.title}</div>
                </div>
                <div className="pacts">
                  <button type="button" title="Admit" onClick={() => vc.admit(p.id)}>
                    <Ic n="usercheck" />
                  </button>
                  <button type="button" title="Remove" onClick={() => vc.removeParticipant(p.id)}>
                    <Ic n="x" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {vc.hands.length > 0 && (
          <div>
            <div className="sect-title" style={{ marginBottom: 6 }}>
              <Ic n="hand" size={13} />
              Hands raised · {vc.hands.length}
            </div>
            {vc.hands.map((p, i) => (
              <div key={p.id} className="prow">
                <span className="pav" style={{ background: p.tone }}>
                  {i + 1}
                </span>
                <div className="pmain">
                  <div className="pname">
                    <span>{p.name}</span>
                  </div>
                  <div className="pmeta">Waiting to speak</div>
                </div>
                <div className="pacts">
                  <button
                    type="button"
                    title="Let them speak"
                    onClick={() => vc.toggleParticipantMute(p.id)}
                  >
                    <Ic n="mic" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="sect-title" style={{ marginBottom: 6 }}>
            <Ic n="users" size={13} />
            In the meeting
          </div>
          {vc.inRoom.map((p) => (
            <div key={p.id} className="prow">
              <span
                className={`pav${p.speaking ? ' speaking' : ''}`}
                style={{ background: p.tone }}
              >
                {initialsOf(p.name)}
              </span>
              <div className="pmain">
                <div className="pname">
                  <span>
                    {p.name}
                    {p.self ? ' (you)' : ''}
                  </span>
                  {(p.role === 'host' || p.role === 'cohost') && (
                    <span className="tag acc">{ROLE_LABEL[p.role]}</span>
                  )}
                  {p.external && (
                    <span className="tag warn">
                      <Ic n="shield" />
                      External
                    </span>
                  )}
                </div>
                <div className="pmeta">
                  {p.title}
                  {p.sharing && <span className="tag pos">Sharing</span>}
                  {p.speaking && <span className="tag pos">Speaking</span>}
                  {p.net !== 'good' && (
                    <span className={`tag ${p.net === 'bad' ? 'neg' : 'warn'}`}>
                      <Ic n="wifi" />
                      {p.net === 'bad' ? 'Poor' : 'Unstable'}
                    </span>
                  )}
                </div>
              </div>
              <div className="pacts">
                <button
                  type="button"
                  className={p.muted ? 'muted' : ''}
                  title={p.muted ? 'Unmute' : 'Mute'}
                  onClick={() => (p.self ? vc.toggleMic() : vc.toggleParticipantMute(p.id))}
                >
                  <Ic n={p.muted ? 'micoff' : 'mic'} />
                </button>
                <button
                  type="button"
                  title={vc.pinned === p.id ? 'Unpin' : 'Pin to stage'}
                  onClick={() => vc.setPinned(vc.pinned === p.id ? null : p.id)}
                >
                  <Ic n="pin" />
                </button>
                {!p.self && (
                  <button type="button" title="Remove" onClick={() => vc.removeParticipant(p.id)}>
                    <Ic n="x" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ chat --- */

const ChatPane = ({ vc }: { vc: VideoConsole }) => {
  const [draft, setDraft] = useState('');
  const [translate, setTranslate] = useState(true);
  const messages = useMemo(() => demoChat(vc.meeting?.id || 'none'), [vc.meeting?.id]);

  const send = () => {
    if (!draft.trim()) return;
    vc.showToast('Message sent to everyone');
    setDraft('');
  };

  return (
    <div className="ppane">
      <div className="pbar">
        <span className="sect-title">
          <Ic n="chat" size={13} />
          Meeting chat
        </span>
        <button
          type="button"
          className={`mini${translate ? ' solid' : ''}`}
          style={{ marginLeft: 'auto' }}
          onClick={() => setTranslate((t) => !t)}
        >
          <Ic n="globe" />
          Translate
        </button>
        <DemoChip />
      </div>

      <div className="chat">
        {messages.map((m) => (
          <div key={m.id} className="msg">
            <span className="msg-av" style={{ background: m.tone }}>
              {initialsOf(m.who)}
            </span>
            <div className="msg-body">
              <div className="msg-meta">
                <span className="msg-who">{m.who}</span>
                <span className="msg-t">{m.at}</span>
                {!m.toEveryone && <span className="tag neu">Direct</span>}
              </div>
              <div className="msg-text">{m.text}</div>
              {translate && m.translated && (
                <div className="msg-tr">
                  <Ic n="globe" size={10} /> {m.translated}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="composer">
        <div className="composer-row">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message everyone"
            aria-label="Message everyone"
          />
          <button type="button" className="sendbtn" onClick={send} aria-label="Send">
            <Ic n="send" />
          </button>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- AI --- */

const AiPane = ({ vc }: { vc: VideoConsole }) => {
  const id = vc.meeting?.id || 'none';
  const recap = useMemo(() => demoRecap(id), [id]);
  const [actions, setActions] = useState(() => demoActions(id));
  const [ask, setAsk] = useState('');

  const toggleAction = (actionId: string) =>
    setActions((list) => list.map((a) => (a.id === actionId ? { ...a, done: !a.done } : a)));

  const open = actions.filter((a) => !a.done).length;

  return (
    <div className="ppane">
      <div className="meters">
        <div className="meter">
          <div className="k">Sentiment</div>
          <div className="v">{recap.sentiment}</div>
          <div className="bar">
            <i style={{ width: `${recap.sentiment}%`, background: 'var(--live)' }} />
          </div>
        </div>
        <div className="meter">
          <div className="k">Your talk</div>
          <div className="v">{recap.talkRatio}%</div>
          <div className="bar">
            <i style={{ width: `${recap.talkRatio}%`, background: 'var(--accent)' }} />
          </div>
        </div>
        <div className="meter">
          <div className="k">Engagement</div>
          <div className="v">{recap.engagement}%</div>
          <div className="bar">
            <i style={{ width: `${recap.engagement}%`, background: 'var(--ai)' }} />
          </div>
        </div>
      </div>

      <div className="pscroll">
        <div className="aicard">
          <div className="ac-head">
            <span className="ac-kind">
              <Ic n="spark" />
              {vc.view === 'live' ? 'Live summary' : 'Meeting recap'}
            </span>
            <span className="src ai">generated</span>
            <span style={{ marginLeft: 'auto' }}>
              <DemoChip />
            </span>
          </div>
          <div className="ac-body">{recap.summary}</div>
          <div className="ac-acts">
            <button
              type="button"
              className="mini solid"
              onClick={() => vc.showToast('Catching you up')}
            >
              <Ic n="bolt" />
              Catch me up
            </button>
            <button type="button" className="mini" onClick={() => vc.showToast('Recap copied')}>
              <Ic n="copy" />
              Copy
            </button>
          </div>
        </div>

        <div className="aicard warnc">
          <div className="ac-head">
            <span className="ac-kind">
              <Ic n="alert" />
              Risk flagged
            </span>
            <span className="src ai">generated</span>
          </div>
          <div className="ac-body">{recap.risks}</div>
        </div>

        <div>
          <div className="sect-title" style={{ marginBottom: 4 }}>
            <Ic n="check" size={13} />
            Action items
            <span className="tag ai" style={{ marginLeft: 6 }}>
              {open} open
            </span>
          </div>
          {actions.map((a) => (
            <div key={a.id} className={`todo${a.done ? ' done' : ''}`}>
              <button
                type="button"
                className="todo-box"
                aria-pressed={a.done}
                aria-label={a.done ? 'Mark not done' : 'Mark done'}
                onClick={() => toggleAction(a.id)}
              >
                <Ic n="check" />
              </button>
              <div className="todo-main">
                <div className="todo-t">{a.text}</div>
                <div className="todo-m">
                  <span className="tag neu">{a.owner}</span>
                  <span>Due {a.due}</span>
                  <button
                    type="button"
                    className="cite"
                    onClick={() => vc.showToast(`Jump to ${a.cite}`)}
                  >
                    <Ic n="cc" size={9} />
                    {a.cite}
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="mini"
              onClick={() => vc.showToast('Actions sent to attendees')}
            >
              <Ic n="send" />
              Send actions to attendees
            </button>
          </div>
        </div>

        <div>
          <div className="sect-title" style={{ marginBottom: 6 }}>
            <Ic n="list" size={13} />
            Decisions
          </div>
          <div className="aicard">
            <div className="ac-body">
              <ul>
                {recap.decisions.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="composer">
        <div className="suggests" style={{ marginBottom: 8, marginTop: 0 }}>
          {['What did I miss?', 'Any decisions about pricing?', 'List my action items'].map((s) => (
            <button key={s} type="button" className="sugg" onClick={() => setAsk(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="composer-row">
          <textarea
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Ask about this meeting"
            aria-label="Ask about this meeting"
          />
          <button
            type="button"
            className="sendbtn ai"
            aria-label="Ask"
            onClick={() => {
              if (!ask.trim()) return;
              vc.showToast('Asking the AI companion');
              setAsk('');
            }}
          >
            <Ic n="send" />
          </button>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------- captions --- */

const CaptionsPane = ({ vc }: { vc: VideoConsole }) => {
  const [language, setLanguage] = useState('English');
  const [query, setQuery] = useState('');
  const turns = useMemo(() => demoCaptions(vc.meeting?.id || 'none'), [vc.meeting?.id]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return turns;
    return turns.filter((t) => t.text.toLowerCase().includes(q) || t.who.toLowerCase().includes(q));
  }, [turns, query]);

  return (
    <div className="ppane">
      <div className="pbar">
        <button
          type="button"
          className={`mini${vc.captions ? ' solid' : ''}`}
          onClick={() => vc.setCaptions(!vc.captions)}
        >
          <Ic n="cc" />
          {vc.captions ? 'On' : 'Off'}
        </button>
        <Picker
          label="Translate captions to"
          showLabel={false}
          value={language}
          options={LANGUAGES.map((l) => ({ label: l, value: l }))}
          onChange={(option) => setLanguage(option.value)}
        />
        <DemoChip />
      </div>

      <div className="pbar" style={{ borderTop: 0 }}>
        <div className="search-mini" style={{ flex: 1 }}>
          <Ic n="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the transcript"
            aria-label="Search the transcript"
          />
        </div>
      </div>

      <div className="pscroll">
        {!vc.captions && (
          <div className="empty">
            <Ic n="cc" />
            <p>Captions are off. Turn them on to see live speech and translation here.</p>
          </div>
        )}

        {vc.captions &&
          shown.map((t) => (
            <div key={t.id} className="turn">
              <span className="turn-av" style={{ background: t.tone }}>
                {initialsOf(t.who)}
              </span>
              <div className="turn-body">
                <div className="turn-meta">
                  <span className="turn-who">{t.who}</span>
                  <span className="turn-t">{t.at}</span>
                </div>
                <div className="turn-text">{t.text}</div>
                {t.translated && language !== 'Off' && (
                  <div className="turn-tr">
                    <Ic n="globe" size={10} /> {t.translated}
                  </div>
                )}
              </div>
            </div>
          ))}

        {vc.captions && shown.length === 0 && (
          <div className="empty">
            <Ic n="search" />
            <p>Nothing in the transcript matches that search.</p>
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ apps --- */

const AppsPane = ({ vc }: { vc: VideoConsole }) => {
  const id = vc.meeting?.id || 'none';
  const poll = useMemo(() => demoPoll(id), [id]);
  const questions = useMemo(() => demoQuestions(id), [id]);
  const [rooms, setRooms] = useState(3);

  const apps: { key: string; icon: VideoIconName; title: string; sub: string; ai?: boolean }[] = [
    { key: 'board', icon: 'board', title: 'Whiteboard', sub: 'Sketch together on a shared canvas' },
    { key: 'poll', icon: 'poll', title: 'Polls', sub: 'Ask the room and show the result' },
    { key: 'qa', icon: 'qa', title: 'Q&A', sub: 'Upvoted questions, answered on the record' },
    {
      key: 'breakout',
      icon: 'breakout',
      title: 'Breakout rooms',
      sub: 'Split the room and bring it back',
    },
    { key: 'notes', icon: 'note', title: 'Shared notes', sub: 'One document everyone can edit' },
    {
      key: 'summary',
      icon: 'spark',
      title: 'AI notes',
      sub: 'Notes written for you as you talk',
      ai: true,
    },
  ];

  return (
    <div className="ppane">
      <div className="pscroll">
        <div className="applist">
          {apps.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`apptile${a.ai ? ' aiapp' : ''}`}
              onClick={() => vc.showToast(`${a.title} opens on the stage`)}
            >
              <Ic n={a.icon} />
              <span className="app-t">{a.title}</span>
              <span className="app-s">{a.sub}</span>
            </button>
          ))}
        </div>

        <div className="card card-pad">
          <div className="sect-title" style={{ marginBottom: 8 }}>
            <Ic n="poll" size={13} />
            Live poll
            <span style={{ marginLeft: 'auto' }}>
              <DemoChip />
            </span>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{poll.question}</div>
          {poll.options.map((o) => {
            const pct = Math.round((o.votes / Math.max(1, poll.responded)) * 100);
            return (
              <div key={o.label} className="pollbar">
                <span className="pollbar-l">{o.label}</span>
                <span className="pollbar-t">
                  <i style={{ width: `${pct}%` }} />
                </span>
                <span className="pollbar-v">{pct}%</span>
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>
            {poll.responded} of {poll.total} responded
          </div>
        </div>

        <div className="card card-pad">
          <div className="sect-title" style={{ marginBottom: 8 }}>
            <Ic n="qa" size={13} />
            Q&amp;A
            <span style={{ marginLeft: 'auto' }}>
              <DemoChip />
            </span>
          </div>
          {questions.map((q) => (
            <div key={q.id} className="prow">
              <span
                className="pav"
                style={{ background: 'var(--surface-3)', color: 'var(--ink-2)' }}
              >
                <Ic n="arrow" size={13} className="flip" />
              </span>
              <div className="pmain">
                <div className="pname">
                  <span>{q.text}</span>
                </div>
                <div className="pmeta">
                  {q.who} · {q.votes} upvotes
                  {q.answered && <span className="tag pos">Answered</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card card-pad">
          <div className="sect-title" style={{ marginBottom: 8 }}>
            <Ic n="breakout" size={13} />
            Breakout rooms
          </div>
          <div className="rule">
            <span className="rule-ic">
              <Ic n="breakout" />
            </span>
            <div className="rule-main">
              <div className="rule-t">{rooms} rooms</div>
              <div className="rule-s">
                About {Math.max(1, Math.round(vc.inRoom.length / rooms))} people per room, assigned
                automatically
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className="mini"
                onClick={() => setRooms((r) => Math.max(2, r - 1))}
              >
                −
              </button>
              <button
                type="button"
                className="mini"
                onClick={() => setRooms((r) => Math.min(20, r + 1))}
              >
                +
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn primary sm wide"
            style={{ marginTop: 10 }}
            onClick={() => vc.showToast(`Opening ${rooms} breakout rooms`)}
          >
            <Ic n="breakout" />
            Open rooms
          </button>
        </div>
      </div>
    </div>
  );
};

/* --------------------------------------------------------------- details --- */

const DetailsPane = ({ vc }: { vc: VideoConsole }) => {
  const meeting = vc.meeting;

  if (!meeting) {
    return (
      <div className="ppane">
        <div className="empty">
          <Ic n="note" />
          <p>Pick a meeting on the left to see its ID, passcode, dial-in numbers and security.</p>
        </div>
      </div>
    );
  }

  const link = `unified.mycountrymobile.com/j/${meeting.roomId.replace(/ /g, '')}`;

  return (
    <div className="ppane">
      <div className="pscroll">
        <div className="card card-pad">
          <div className="sect-title" style={{ marginBottom: 6 }}>
            <Ic n="note" size={13} />
            Meeting
          </div>
          <div className="kv">
            <span className="k">Title</span>
            <span className="v">{meeting.title}</span>
          </div>
          <div className="kv">
            <span className="k">Host</span>
            <span className="v">{meeting.host}</span>
          </div>
          <div className="kv">
            <span className="k">Meeting ID</span>
            <span className="v num">{meeting.roomId}</span>
          </div>
          <div className="kv">
            <span className="k">Passcode</span>
            <span className="v num">{meeting.passcode}</span>
          </div>
          <div className="kv">
            <span className="k">Link</span>
            <span className="v num">{link}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="mini"
              onClick={() =>
                navigator.clipboard?.writeText(`https://${link}`).then(
                  () => vc.showToast('Invite copied'),
                  () => vc.showToast('Could not copy'),
                )
              }
            >
              <Ic n="copy" />
              Copy invite
            </button>
            <button
              type="button"
              className="mini"
              onClick={() => vc.showToast('Added to calendar')}
            >
              <Ic n="cal" />
              Add to calendar
            </button>
          </div>
        </div>

        <div className="card card-pad">
          <div className="sect-title" style={{ marginBottom: 6 }}>
            <Ic n="list" size={13} />
            Agenda
            <span style={{ marginLeft: 'auto' }}>
              <DemoChip />
            </span>
          </div>
          {meeting.agenda.map((item, i) => (
            <div key={item} className="kv">
              <span className="k num">{i + 1}</span>
              <span className="v" style={{ fontWeight: 500, textAlign: 'left', flex: 1 }}>
                {item}
              </span>
            </div>
          ))}
        </div>

        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div className="sect-title">
            <Ic n="shield" size={13} />
            Security
          </div>
          <div className="rule">
            <span className="rule-ic">
              <Ic n="lock" />
            </span>
            <div className="rule-main">
              <div className="rule-t">Lock the meeting</div>
              <div className="rule-s">Nobody new can join, not even with the link</div>
            </div>
            <button
              type="button"
              aria-pressed={vc.locked}
              aria-label="Lock the meeting"
              className={`toggle${vc.locked ? ' on' : ''}`}
              onClick={() => vc.setLocked(!vc.locked)}
            />
          </div>
          <div className="rule">
            <span className="rule-ic">
              <Ic n="usercheck" />
            </span>
            <div className="rule-main">
              <div className="rule-t">Waiting room</div>
              <div className="rule-s">Guests wait until a host admits them</div>
            </div>
            <button
              type="button"
              aria-pressed={vc.lobbyOn}
              aria-label="Waiting room"
              className={`toggle${vc.lobbyOn ? ' on' : ''}`}
              onClick={() => vc.setLobbyOn(!vc.lobbyOn)}
            />
          </div>
          <div className="rule">
            <span className="rule-ic">
              <Ic n="spark" />
            </span>
            <div className="rule-main">
              <div className="rule-t">AI companion</div>
              <div className="rule-s">
                Writes the recap and action items. Everyone is told it is on.
              </div>
            </div>
            <button
              type="button"
              aria-pressed={vc.ai}
              aria-label="AI companion"
              className={`toggle ai${vc.ai ? ' on' : ''}`}
              onClick={() => vc.setAi(!vc.ai)}
            />
          </div>
          <div className="rule">
            <span className="rule-ic">
              <Ic n="shield" />
            </span>
            <div className="rule-main">
              <div className="rule-t">
                Encryption
                <span className="tag pos">On</span>
              </div>
              <div className="rule-s">Media is encrypted in transit between every participant</div>
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <div className="sect-title" style={{ marginBottom: 6 }}>
            <Ic n="phone" size={13} />
            Dial in by phone
            <span style={{ marginLeft: 'auto' }}>
              <DemoChip />
            </span>
          </div>
          <div className="kv">
            <span className="k">United Kingdom</span>
            <span className="v num">+44 20 7946 0123</span>
          </div>
          <div className="kv">
            <span className="k">United States</span>
            <span className="v num">+1 646 555 0148</span>
          </div>
          <div className="kv">
            <span className="k">India</span>
            <span className="v num">+91 22 6117 0190</span>
          </div>
          <div className="kv">
            <span className="k">Conference PIN</span>
            <span className="v num">{meeting.passcode}#</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ root --- */

const PanelColumn = ({ vc, tab, onTabChange }: Props) => {
  // Badges describe the open meeting. With nothing open there is nothing to
  // count, and a stale number on the tab reads as unread messages.
  const counts: Partial<Record<PanelTab, number>> = vc.meeting
    ? { people: vc.inRoom.length, chat: demoChat(vc.meeting.id).length }
    : {};

  return (
    <div className="col panel-col">
      <div className="panel">
        <div className="panel-tabs" role="tablist" aria-label="Meeting panel">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`ptab${t.ai ? ' ai-tab' : ''}${tab === t.key ? ' on' : ''}`}
              onClick={() => onTabChange(t.key)}
            >
              <Ic n={t.icon} />
              {t.label}
              {counts[t.key] ? <span className="cnt">{counts[t.key]}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'people' && <PeoplePane vc={vc} />}
        {tab === 'chat' && <ChatPane vc={vc} />}
        {tab === 'ai' && <AiPane vc={vc} />}
        {tab === 'captions' && <CaptionsPane vc={vc} />}
        {tab === 'apps' && <AppsPane vc={vc} />}
        {tab === 'details' && <DetailsPane vc={vc} />}
      </div>
    </div>
  );
};

export default PanelColumn;
