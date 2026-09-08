import { useMemo, useState } from 'react';
import { Ic } from './icons';
import { initialsOf, toneFor, type VideoMeeting } from './demo-data';
import { clockLabel, dayLabel } from './meeting-list-column';
import type { VideoConsole } from './use-video-console';
import { Picker } from '@/components/mcm/picker';

/**
 * The two hub actions that need a form rather than a button: scheduling a
 * meeting, and joining one you were given an ID for.
 *
 * Both are stage screens, not modals. The console already owns the middle
 * column, and a dialog floating over it would cover the meeting list — which
 * is exactly what people check while scheduling ("what else is that morning?").
 */

/* ------------------------------------------------------------------ utils -- */

const pad = (n: number) => String(n).padStart(2, '0');

/** Default to the next clean half-hour, which is what people almost always pick. */
const nextHalfHour = () => {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30, 0, 0);
  return d;
};

const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const isExternal = (email: string) => {
  const domain = email.split('@')[1] || '';
  return Boolean(domain) && !/mycountrymobile\.com$/i.test(domain);
};

/* --------------------------------------------------------------- schedule -- */

type Recurrence = 'once' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

const RECURRENCE: { key: Recurrence; label: string }[] = [
  { key: 'once', label: 'Does not repeat' },
  { key: 'daily', label: 'Every weekday' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Every 2 weeks' },
  { key: 'monthly', label: 'Monthly' },
];

export const ScheduleView = ({ vc, selfName }: { vc: VideoConsole; selfName: string }) => {
  const start = useMemo(nextHalfHour, []);
  const pmi = useMemo(() => vc.meetings.find((m) => m.pmi) || vc.meetings[0], [vc.meetings]);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dateValue(start));
  const [time, setTime] = useState(timeValue(start));
  const [duration, setDuration] = useState(30);
  const [recurrence, setRecurrence] = useState<Recurrence>('once');
  const [idMode, setIdMode] = useState<'generated' | 'pmi'>('generated');
  const [agenda, setAgenda] = useState('');
  const [invitees, setInvitees] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [calendar, setCalendar] = useState<'mcm' | 'google' | 'outlook' | 'ics'>('mcm');

  const [passcodeOn, setPasscodeOn] = useState(true);
  const [lobbyOn, setLobbyOn] = useState(true);
  const [signedInOnly, setSignedInOnly] = useState(false);
  const [muteOnEntry, setMuteOnEntry] = useState(true);
  const [hostVideo, setHostVideo] = useState(true);
  const [guestVideo, setGuestVideo] = useState(false);
  const [joinBeforeHost, setJoinBeforeHost] = useState(false);
  const [autoRecord, setAutoRecord] = useState(false);
  const [aiOn, setAiOn] = useState(true);

  const addInvitee = (raw: string) => {
    const value = raw.trim().replace(/,$/, '');
    if (!value || invitees.includes(value)) return;
    setInvitees((list) => [...list, value]);
  };

  const externals = invitees.filter(isExternal).length;

  const save = () => {
    if (!title.trim()) {
      vc.showToast('Give the meeting a title first');
      return;
    }
    // TODO: POST to `createMeeting` (see `@/services/api`) — the same endpoint
    // the old scheduler used, plus the security block below.
    vc.showToast(`"${title.trim()}" scheduled for ${date} at ${time}`);
    vc.backToHub();
  };

  return (
    <div className="stage-scroll">
      <div className="form-head">
        <button type="button" className="btn ghost sm" onClick={vc.backToHub}>
          <Ic n="chev" className="flip" />
          Back
        </button>
        <div>
          <h1>Schedule a meeting</h1>
          <p>Everything here is set before anyone joins, so the room opens the way you want it.</p>
        </div>
      </div>

      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <label htmlFor="sch-title">Title</label>
          <input
            id="sch-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is this meeting about?"
          />
        </div>

        <div className="fgrid">
          <div className="field">
            <label htmlFor="sch-date">Date</label>
            <input
              id="sch-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sch-time">Start</label>
            <input
              id="sch-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sch-dur">Duration</label>
            <Picker
              label="Duration"
              showLabel={false}
              className="mcm-field"
              value={String(duration)}
              options={[15, 30, 45, 60, 90, 120].map((d) => ({
                label:
                  d < 60 ? `${d} min` : `${d / 60} hr${d > 60 ? ` ${d % 60 || ''}` : ''}`.trim(),
                value: String(d),
              }))}
              onChange={(option) => setDuration(Number(option.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="sch-rec">Repeat</label>
            <Picker
              label="Repeat"
              showLabel={false}
              className="mcm-field"
              value={recurrence}
              options={RECURRENCE.map((r) => ({ label: String(r.label), value: String(r.key) }))}
              onChange={(option) => setRecurrence(option.value as Recurrence)}
            />
          </div>
        </div>

        <div className="field">
          <label>Invite</label>
          <div className="chips">
            {invitees.map((person) => (
              <span key={person} className={`chipx${isExternal(person) ? ' ext' : ''}`}>
                <span>{person}</span>
                <button
                  type="button"
                  aria-label={`Remove ${person}`}
                  onClick={() => setInvitees((list) => list.filter((p) => p !== person))}
                >
                  <Ic n="x" />
                </button>
              </span>
            ))}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addInvitee(draft);
                  setDraft('');
                }
                if (e.key === 'Backspace' && !draft) setInvitees((list) => list.slice(0, -1));
              }}
              onBlur={() => {
                addInvitee(draft);
                setDraft('');
              }}
              placeholder={invitees.length ? '' : 'name@company.com, comma or Enter to add'}
              aria-label="Invite people by email"
            />
          </div>
          {externals > 0 && (
            <span className="hint">
              {externals} {externals === 1 ? 'guest is' : 'guests are'} outside your organisation.
              They will be told the meeting is recorded and AI-assisted if those are on.
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="sch-agenda">Agenda</label>
          <textarea
            id="sch-agenda"
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            placeholder="One item per line. The AI companion uses these as the recap headings."
          />
        </div>
      </div>

      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div className="sect-title">
          <Ic n="key" size={13} />
          Meeting ID
        </div>
        <div className="picks">
          <button
            type="button"
            className={`pick${idMode === 'generated' ? ' on' : ''}`}
            onClick={() => setIdMode('generated')}
          >
            <span className="pick-dot" />
            <span>
              <span className="pick-t" style={{ display: 'block' }}>
                Generate automatically
              </span>
              <span className="pick-s" style={{ display: 'block' }}>
                A one-off ID for this meeting only
              </span>
            </span>
          </button>
          <button
            type="button"
            className={`pick${idMode === 'pmi' ? ' on' : ''}`}
            onClick={() => setIdMode('pmi')}
          >
            <span className="pick-dot" />
            <span>
              <span className="pick-t" style={{ display: 'block' }}>
                Personal room
              </span>
              <span className="pick-s num" style={{ display: 'block' }}>
                {pmi?.roomId}
              </span>
            </span>
          </button>
        </div>
        {idMode === 'pmi' && (
          <span className="hint" style={{ fontSize: 10.5, color: 'var(--warn)' }}>
            Anyone who has ever had your personal room link can join this one.
          </span>
        )}
      </div>

      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div className="sect-title">
          <Ic n="shield" size={13} />
          Security
        </div>
        {[
          {
            key: 'pass',
            icon: 'key' as const,
            t: 'Require a passcode',
            s: 'Generated with the invite and embedded in the link',
            on: passcodeOn,
            set: setPasscodeOn,
          },
          {
            key: 'lobby',
            icon: 'usercheck' as const,
            t: 'Waiting room',
            s: 'Guests wait until a host admits them',
            on: lobbyOn,
            set: setLobbyOn,
          },
          {
            key: 'signed',
            icon: 'user' as const,
            t: 'Signed-in users only',
            s: 'Blocks anonymous joins entirely',
            on: signedInOnly,
            set: setSignedInOnly,
          },
          {
            key: 'jbh',
            icon: 'clock' as const,
            t: 'Allow joining before the host',
            s: 'People can talk while they wait for you',
            on: joinBeforeHost,
            set: setJoinBeforeHost,
          },
        ].map((row) => (
          <div key={row.key} className="rule">
            <span className="rule-ic">
              <Ic n={row.icon} />
            </span>
            <div className="rule-main">
              <div className="rule-t">{row.t}</div>
              <div className="rule-s">{row.s}</div>
            </div>
            <button
              type="button"
              aria-pressed={row.on}
              aria-label={row.t}
              className={`toggle${row.on ? ' on' : ''}`}
              onClick={() => row.set(!row.on)}
            />
          </div>
        ))}
      </div>

      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div className="sect-title">
          <Ic n="sliders" size={13} />
          How the room opens
        </div>
        {[
          {
            key: 'hv',
            icon: 'video' as const,
            t: 'Host video on',
            s: 'Your camera starts on',
            on: hostVideo,
            set: setHostVideo,
          },
          {
            key: 'gv',
            icon: 'users' as const,
            t: 'Participant video on',
            s: 'Everyone else starts with camera on',
            on: guestVideo,
            set: setGuestVideo,
          },
          {
            key: 'mute',
            icon: 'micoff' as const,
            t: 'Mute on entry',
            s: 'Stops the arrival noise on bigger calls',
            on: muteOnEntry,
            set: setMuteOnEntry,
          },
          {
            key: 'rec',
            icon: 'rec' as const,
            t: 'Record automatically',
            s: 'Starts recording to the cloud as the meeting opens',
            on: autoRecord,
            set: setAutoRecord,
          },
        ].map((row) => (
          <div key={row.key} className="rule">
            <span className="rule-ic">
              <Ic n={row.icon} />
            </span>
            <div className="rule-main">
              <div className="rule-t">{row.t}</div>
              <div className="rule-s">{row.s}</div>
            </div>
            <button
              type="button"
              aria-pressed={row.on}
              aria-label={row.t}
              className={`toggle${row.on ? ' on' : ''}`}
              onClick={() => row.set(!row.on)}
            />
          </div>
        ))}
        <div className="rule">
          <span className="rule-ic">
            <Ic n="spark" />
          </span>
          <div className="rule-main">
            <div className="rule-t">
              AI companion
              <span className="tag ai">Recap · actions</span>
            </div>
            <div className="rule-s">
              Writes the summary, decisions and action items. Everyone in the room is told it is on.
            </div>
          </div>
          <button
            type="button"
            aria-pressed={aiOn}
            aria-label="AI companion"
            className={`toggle ai${aiOn ? ' on' : ''}`}
            onClick={() => setAiOn(!aiOn)}
          />
        </div>
      </div>

      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div className="sect-title">
          <Ic n="cal" size={13} />
          Add to calendar
        </div>
        <div className="picks">
          {[
            { key: 'mcm' as const, t: 'MCM calendar', s: 'Stays inside the platform' },
            { key: 'google' as const, t: 'Google Calendar', s: 'Opens a prefilled event' },
            { key: 'outlook' as const, t: 'Outlook', s: 'Opens a prefilled event' },
            { key: 'ics' as const, t: 'Download .ics', s: 'For anything else' },
          ].map((c) => (
            <button
              key={c.key}
              type="button"
              className={`pick${calendar === c.key ? ' on' : ''}`}
              onClick={() => setCalendar(c.key)}
            >
              <span className="pick-dot" />
              <span>
                <span className="pick-t" style={{ display: 'block' }}>
                  {c.t}
                </span>
                <span className="pick-s" style={{ display: 'block' }}>
                  {c.s}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="formbar">
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          Scheduled by {selfName} · {invitees.length} invited
        </span>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={vc.backToHub}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={save}>
          <Ic n="cal" />
          Schedule
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------- join -- */

export const JoinView = ({ vc, selfName }: { vc: VideoConsole; selfName: string }) => {
  const [code, setCode] = useState('');
  const [passcode, setPasscode] = useState('');
  const [name, setName] = useState(selfName);
  const [noAudio, setNoAudio] = useState(false);
  const [noVideo, setNoVideo] = useState(false);

  const recent = useMemo(
    () => vc.meetings.filter((m) => m.state !== 'upcoming').slice(0, 3),
    [vc.meetings],
  );

  /** Accept a bare ID, a spaced ID, or a full room link — people paste all three. */
  const digits = code.replace(/[^0-9]/g, '');
  const canJoin = digits.length >= 9;

  const join = () => {
    if (!canJoin) {
      vc.showToast('Enter a meeting ID or paste the link');
      return;
    }
    const match =
      vc.meetings.find((m) => m.roomId.replace(/ /g, '') === digits) ||
      ({
        ...vc.meetings[0],
        id: `joined-${digits}`,
        title: `Meeting ${digits}`,
        roomId: digits.replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3'),
        state: 'live',
        startsInMins: 0,
      } as VideoMeeting);

    vc.patchMedia({ mic: !noAudio && vc.media.mic, cam: !noVideo });
    vc.join(match);
  };

  return (
    <div className="stage-scroll">
      <div className="form-head">
        <button type="button" className="btn ghost sm" onClick={vc.backToHub}>
          <Ic n="chev" className="flip" />
          Back
        </button>
        <div>
          <h1>Join a meeting</h1>
          <p>Paste the link, or type the meeting ID you were given.</p>
        </div>
      </div>

      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field big">
          <label htmlFor="join-id">Meeting ID or link</label>
          <input
            id="join-id"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') join();
            }}
            placeholder="123 456 7890"
            autoComplete="off"
          />
          {code && !canJoin && <span className="hint">A meeting ID is at least 9 digits.</span>}
        </div>

        <div className="fgrid">
          <div className="field">
            <label htmlFor="join-pass">Passcode</label>
            <input
              id="join-pass"
              type="text"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="If the meeting has one"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="join-name">Your name</label>
            <input
              id="join-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="How you appear to the room"
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div className="rule">
            <span className="rule-ic">
              <Ic n="volume" />
            </span>
            <div className="rule-main">
              <div className="rule-t">Do not connect to audio</div>
              <div className="rule-s">
                Join silently — useful when you are already on the room system
              </div>
            </div>
            <button
              type="button"
              aria-pressed={noAudio}
              aria-label="Do not connect to audio"
              className={`toggle${noAudio ? ' on' : ''}`}
              onClick={() => setNoAudio(!noAudio)}
            />
          </div>
          <div className="rule">
            <span className="rule-ic">
              <Ic n="videooff" />
            </span>
            <div className="rule-main">
              <div className="rule-t">Turn off my video</div>
              <div className="rule-s">Join with the camera already stopped</div>
            </div>
            <button
              type="button"
              aria-pressed={noVideo}
              aria-label="Turn off my video"
              className={`toggle${noVideo ? ' on' : ''}`}
              onClick={() => setNoVideo(!noVideo)}
            />
          </div>
        </div>

        <div className="formbar">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={vc.backToHub}>
            Cancel
          </button>
          <button type="button" className="btn go" onClick={join} disabled={!canJoin}>
            <Ic n="video" />
            Join
          </button>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="card card-pad">
          <div className="sect-title" style={{ marginBottom: 9 }}>
            <Ic n="clock" size={13} />
            Recent rooms
          </div>
          {recent.map((m) => (
            <button key={m.id} type="button" className="recent" onClick={() => setCode(m.roomId)}>
              <span className="recent-av" style={{ background: toneFor(m.title) }}>
                {initialsOf(m.title.replace(/[^A-Za-z ]/g, ''))}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="recent-t" style={{ display: 'block' }}>
                  {m.title}
                </span>
                <span className="recent-s num" style={{ display: 'block' }}>
                  {m.roomId} · {dayLabel(m.startsInMins)} {clockLabel(m.startsInMins)}
                </span>
              </span>
              <Ic n="arrow" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
