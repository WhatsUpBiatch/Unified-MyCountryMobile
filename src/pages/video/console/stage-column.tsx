import { useEffect, useMemo, useState } from 'react';
import { Ic, type VideoIconName } from './icons';
import {
  demoChapters,
  demoRecap,
  initialsOf,
  type VideoMeeting,
  type VideoParticipant,
} from './demo-data';
import { clockLabel, dayLabel, relativeLabel } from './meeting-list-column';
import { mmss, type BackdropMode, type StageLayout, type VideoConsole } from './use-video-console';
import DemoChip from './panes/demo-chip';
import { JoinView, ScheduleView } from './stage-forms';
import type { PanelTab } from './panel-column';
import { Picker } from '@/components/mcm/picker';

type Props = {
  vc: VideoConsole;
  selfName: string;
  onOpenPanel: (tab: PanelTab) => void;
};

/* ------------------------------------------------------------------ tile --- */

const NET_TITLE: Record<VideoParticipant['net'], string> = {
  good: 'Good connection',
  weak: 'Unstable connection',
  bad: 'Poor connection — audio may drop',
};

const Tile = ({
  p,
  big = false,
  pinned,
  onPin,
}: {
  p: VideoParticipant;
  big?: boolean;
  pinned: string | null;
  onPin: (id: string) => void;
}) => (
  <div
    className={[
      'tile',
      big ? 'big' : '',
      p.speaking ? 'speaking' : '',
      pinned === p.id ? 'pinned' : '',
      p.self ? 'self' : '',
    ]
      .filter(Boolean)
      .join(' ')}
    onDoubleClick={() => onPin(p.id)}
    title={`${p.name} — double-click to ${pinned === p.id ? 'unpin' : 'pin'}`}
  >
    {p.sharing ? (
      <div className="sharesurface">
        <Ic n="share" />
        <div>{p.self ? 'You are sharing your screen' : `${p.name} is sharing`}</div>
      </div>
    ) : p.camOff ? (
      <div className="tile-av" style={{ background: p.tone }}>
        {initialsOf(p.name)}
      </div>
    ) : (
      // No real media track here yet — the tile draws the person's tone as a
      // stand-in so the grid reads correctly. The Jitsi track mounts here.
      <div className="tile-av" style={{ background: p.tone }}>
        {initialsOf(p.name)}
      </div>
    )}

    <div className={`tile-net ${p.net === 'good' ? '' : p.net}`} title={NET_TITLE[p.net]}>
      <Ic n="wifi" />
    </div>

    <div className="tile-badges">
      {p.hand && (
        <span className="tbadge hand" title="Hand raised">
          <Ic n="hand" />
        </span>
      )}
      {pinned === p.id && (
        <span className="tbadge" title="Pinned">
          <Ic n="pin" />
        </span>
      )}
      {(p.role === 'host' || p.role === 'cohost') && (
        <span className="tbadge host">{p.role === 'host' ? 'HOST' : 'CO-HOST'}</span>
      )}
      {p.external && (
        <span className="tbadge" title="Guest from outside your organisation">
          <Ic n="shield" />
        </span>
      )}
    </div>

    <div className="tile-name">
      <Ic n={p.muted ? 'micoff' : 'mic'} className={p.muted ? 'muted' : ''} />
      <span>{p.self ? `${p.name} (you)` : p.name}</span>
    </div>
  </div>
);

/* -------------------------------------------------------------- hub view --- */

const HubView = ({ vc, selfName, onOpenPanel }: Props) => {
  const next = useMemo(
    () =>
      vc.meetings
        .filter((m) => m.state === 'live' || m.state === 'upcoming')
        .sort((a, b) => a.startsInMins - b.startsInMins)[0] || null,
    [vc.meetings],
  );

  const pmi = useMemo(() => vc.meetings.find((m) => m.pmi) || vc.meetings[0], [vc.meetings]);

  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(
      () => vc.showToast(`${what} copied`),
      () => vc.showToast('Could not copy'),
    );
  };

  const actions: {
    key: string;
    cls: string;
    icon: VideoIconName;
    title: string;
    sub: string;
    run: () => void;
  }[] = [
    {
      key: 'new',
      cls: 'go',
      icon: 'video',
      title: 'New meeting',
      sub: 'Start now in your personal room',
      run: () => pmi && vc.openMeeting({ ...pmi, state: 'live', startsInMins: 0 }),
    },
    {
      key: 'join',
      cls: '',
      icon: 'link',
      title: 'Join',
      sub: 'With a meeting ID or link',
      run: vc.openJoin,
    },
    {
      key: 'schedule',
      cls: 'plan',
      icon: 'cal',
      title: 'Schedule',
      sub: 'Book it and invite the room',
      run: vc.openSchedule,
    },
    {
      key: 'share',
      cls: 'share',
      icon: 'share',
      title: 'Share screen',
      sub: 'Present into an existing room',
      run: vc.openJoin,
    },
  ];

  return (
    <div className="stage-scroll">
      <div className="qa">
        {actions.map((a) => (
          <button key={a.key} type="button" className={`qa-tile ${a.cls}`} onClick={a.run}>
            <span className="qa-ic">
              <Ic n={a.icon} />
            </span>
            <span className="qa-t">{a.title}</span>
            <span className="qa-s">{a.sub}</span>
          </button>
        ))}
      </div>

      {next && (
        <div className="card">
          <div className="hero">
            <div className="hero-when">
              <span className="t">{clockLabel(next.startsInMins)}</span>
              <span className="d">{dayLabel(next.startsInMins)}</span>
            </div>
            <div className="hero-main">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className={`countdown${next.state === 'live' ? ' now' : ''}`}>
                  <Ic n="clock" size={12} />
                  {next.state === 'live'
                    ? 'In progress'
                    : `Starts ${relativeLabel(next.startsInMins)}`}
                </span>
                {next.external && (
                  <span className="tag warn">
                    <Ic n="shield" />
                    External guests
                  </span>
                )}
              </div>
              <div className="hero-t" style={{ marginTop: 7 }}>
                {next.title}
              </div>
              <div className="hero-s">
                {next.host} · {next.participants.length} invited · {next.durationMins} min
              </div>
            </div>
            <div className="hero-acts">
              <button type="button" className="btn ghost" onClick={() => vc.openMeeting(next)}>
                <Ic n="eye" />
                Details
              </button>
              <button type="button" className="btn go" onClick={() => vc.openMeeting(next)}>
                <Ic n="video" />
                {next.state === 'live' ? 'Join now' : 'Start early'}
              </button>
            </div>
          </div>
          <div className="popstrip">
            <div className="popcell">
              <div className="k">Meeting ID</div>
              <div className="v num">{next.roomId}</div>
            </div>
            <div className="popcell">
              <div className="k">Agenda</div>
              <div className="v">{next.agenda[0]}</div>
            </div>
            <div className="popcell">
              <div className="k">AI companion</div>
              <div className="v">
                <span className="tag ai">
                  <Ic n="spark" />
                  Recap on
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="sect-title">
          <Ic n="user" size={13} />
          Your personal room
        </div>
        <div className="kv">
          <span className="k">Room link</span>
          <span className="v num">
            unified.mycountrymobile.com/j/{pmi?.roomId.replace(/ /g, '')}
          </span>
        </div>
        <div className="kv">
          <span className="k">Meeting ID</span>
          <span className="v num">{pmi?.roomId}</span>
        </div>
        <div className="kv">
          <span className="k">Passcode</span>
          <span className="v num">{pmi?.passcode}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              copy(
                `https://unified.mycountrymobile.com/j/${pmi?.roomId.replace(/ /g, '')}`,
                'Room link',
              )
            }
          >
            <Ic n="copy" />
            Copy link
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => copy(String(pmi?.passcode), 'Passcode')}
          >
            <Ic n="key" />
            Copy passcode
          </button>
          <button type="button" className="btn ghost sm" onClick={() => onOpenPanel('details')}>
            <Ic n="sliders" />
            Room settings
          </button>
        </div>
      </div>

      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="sect-title">
          <Ic n="check" size={13} />
          Ready to join
          <span style={{ marginLeft: 'auto' }}>
            <DemoChip label="Simulated" />
          </span>
        </div>
        <div className="rule">
          <span className="rule-ic">
            <Ic n="video" />
          </span>
          <div className="rule-main">
            <div className="rule-t">
              Camera
              <span className="tag pos">Working</span>
            </div>
            <div className="rule-s">{vc.media.camDevice}</div>
          </div>
        </div>
        <div className="rule">
          <span className="rule-ic">
            <Ic n="mic" />
          </span>
          <div className="rule-main">
            <div className="rule-t">
              Microphone
              <span className="tag pos">Working</span>
            </div>
            <div className="rule-s">{vc.media.micDevice} · noise removal on</div>
          </div>
        </div>
        <div className="rule">
          <span className="rule-ic">
            <Ic n="wifi" />
          </span>
          <div className="rule-main">
            <div className="rule-t">
              Network
              <span className="tag pos">Good — 42 ms</span>
            </div>
            <div className="rule-s">HD video and stereo audio available on this connection</div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          Signed in as <strong>{selfName}</strong>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------ green room --- */

const BACKDROPS: { key: BackdropMode; label: string; icon: VideoIconName }[] = [
  { key: 'off', label: 'None', icon: 'x' },
  { key: 'blur', label: 'Blur', icon: 'blur' },
  { key: 'office', label: 'Office', icon: 'grid' },
  { key: 'brand', label: 'Brand', icon: 'star' },
];

const GreenRoom = ({ vc, selfName }: { vc: VideoConsole; selfName: string }) => {
  const meeting = vc.meeting as VideoMeeting;
  const [level, setLevel] = useState(0);

  // A mic meter that never moves reads as broken, so the green room animates
  // one while the mic is live. It is a stand-in for a real analyser node.
  useEffect(() => {
    if (!vc.media.mic) {
      setLevel(0);
      return undefined;
    }
    const id = setInterval(() => setLevel(Math.random()), 180);
    return () => clearInterval(id);
  }, [vc.media.mic]);

  const lit = Math.round(level * 12);

  return (
    <div className="stage-scroll">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost sm" onClick={vc.backToHub}>
          <Ic n="chev" className="flip" />
          Back
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.03em' }}>
            {meeting.title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {clockLabel(meeting.startsInMins)} · {meeting.durationMins} min · {meeting.host}
          </div>
        </div>
      </div>

      <div className="green">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            className={`preview${vc.media.backdrop !== 'off' && vc.media.cam ? ' blurred' : ''}`}
          >
            {vc.media.cam ? (
              <div
                className="preview-av"
                style={{ background: 'linear-gradient(150deg,#3b6fe0,#7c3aed)' }}
              >
                {initialsOf(selfName)}
              </div>
            ) : (
              <div className="preview-av" style={{ background: 'var(--stage-3)' }}>
                {initialsOf(selfName)}
              </div>
            )}

            <div className="preview-badges">
              {vc.media.noise && (
                <span className="vbadge ai">
                  <Ic n="wand" />
                  Noise removal
                </span>
              )}
              {vc.media.autoframe && (
                <span className="vbadge on">
                  <Ic n="frame" />
                  Auto-framing
                </span>
              )}
              {vc.media.backdrop !== 'off' && (
                <span className="vbadge">
                  <Ic n="blur" />
                  {BACKDROPS.find((b) => b.key === vc.media.backdrop)?.label}
                </span>
              )}
            </div>

            {!vc.media.cam && (
              <div className="preview-off">
                <Ic n="videooff" />
                Camera is off
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn ${vc.media.mic ? 'ghost' : 'danger'}`}
              onClick={vc.toggleMic}
            >
              <Ic n={vc.media.mic ? 'mic' : 'micoff'} />
              {vc.media.mic ? 'Mute' : 'Unmute'}
            </button>
            <button
              type="button"
              className={`btn ${vc.media.cam ? 'ghost' : 'danger'}`}
              onClick={vc.toggleCam}
            >
              <Ic n={vc.media.cam ? 'video' : 'videooff'} />
              {vc.media.cam ? 'Stop video' : 'Start video'}
            </button>
            <button
              type="button"
              className="btn go"
              style={{ marginLeft: 'auto' }}
              onClick={() => vc.join()}
            >
              <Ic n="video" />
              Join now
            </button>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            Joining as <strong>{selfName}</strong>. Everyone else will see you{' '}
            {vc.media.mic ? 'unmuted' : 'muted'} with your camera {vc.media.cam ? 'on' : 'off'}.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card card-pad">
            <div className="sect-title" style={{ marginBottom: 8 }}>
              <Ic n="sliders" size={13} />
              Devices
            </div>

            <div className="devrow">
              <Ic n="mic" />
              <Picker
                label="Microphone"
                showLabel={false}
                className="mcm-field"
                value={vc.media.micDevice}
                options={[
                  { label: 'MacBook Pro Microphone', value: 'MacBook Pro Microphone' },
                  { label: 'Jabra Evolve2 65', value: 'Jabra Evolve2 65' },
                  { label: 'Poly Blackwire 3325', value: 'Poly Blackwire 3325' },
                ]}
                onChange={(option) => vc.patchMedia({ micDevice: option.value })}
              />
            </div>
            <div className="devrow">
              <Ic n="volume" />
              <div className="levels" aria-hidden="true">
                {Array.from({ length: 12 }, (_, i) => (
                  <i
                    key={i}
                    className={i < lit ? 'lit' : ''}
                    style={{ height: i < lit ? 4 + i : 4 }}
                  />
                ))}
              </div>
              <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 'auto' }}>
                {vc.media.mic ? 'Hearing you' : 'Muted'}
              </span>
            </div>
            <div className="devrow">
              <Ic n="volume" />
              <Picker
                label="Speaker"
                showLabel={false}
                className="mcm-field"
                value={vc.media.spkDevice}
                options={[
                  { label: 'MacBook Pro Speakers', value: 'MacBook Pro Speakers' },
                  { label: 'Jabra Evolve2 65', value: 'Jabra Evolve2 65' },
                  { label: 'Studio Display Speakers', value: 'Studio Display Speakers' },
                ]}
                onChange={(option) => vc.patchMedia({ spkDevice: option.value })}
              />
            </div>
            <div className="devrow">
              <Ic n="video" />
              <Picker
                label="Camera"
                showLabel={false}
                className="mcm-field"
                value={vc.media.camDevice}
                options={[
                  { label: 'FaceTime HD Camera', value: 'FaceTime HD Camera' },
                  { label: 'Logitech Brio 4K', value: 'Logitech Brio 4K' },
                  { label: 'OBS Virtual Camera', value: 'OBS Virtual Camera' },
                ]}
                onChange={(option) => vc.patchMedia({ camDevice: option.value })}
              />
            </div>
          </div>

          <div className="card card-pad">
            <div className="sect-title" style={{ marginBottom: 9 }}>
              <Ic n="blur" size={13} />
              Background
            </div>
            <div className="bgpicker">
              {BACKDROPS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={`bgopt${vc.media.backdrop === b.key ? ' on' : ''}`}
                  onClick={() => vc.patchMedia({ backdrop: b.key })}
                  title={b.label}
                >
                  <Ic n={b.icon} />
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="card card-pad"
            style={{ display: 'flex', flexDirection: 'column', gap: 9 }}
          >
            <div className="sect-title">
              <Ic n="wand" size={13} />
              Enhancements
            </div>
            <div className="rule">
              <span className="rule-ic">
                <Ic n="wand" />
              </span>
              <div className="rule-main">
                <div className="rule-t">Noise removal</div>
                <div className="rule-s">Strips keyboards, traffic and background voices</div>
              </div>
              <button
                type="button"
                aria-pressed={vc.media.noise}
                aria-label="Noise removal"
                className={`toggle${vc.media.noise ? ' on' : ''}`}
                onClick={() => vc.patchMedia({ noise: !vc.media.noise })}
              />
            </div>
            <div className="rule">
              <span className="rule-ic">
                <Ic n="frame" />
              </span>
              <div className="rule-main">
                <div className="rule-t">Auto-framing</div>
                <div className="rule-s">Keeps you centred when you move</div>
              </div>
              <button
                type="button"
                aria-pressed={vc.media.autoframe}
                aria-label="Auto-framing"
                className={`toggle${vc.media.autoframe ? ' on' : ''}`}
                onClick={() => vc.patchMedia({ autoframe: !vc.media.autoframe })}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------ live stage --- */

const LAYOUTS: { key: StageLayout; label: string; icon: VideoIconName }[] = [
  { key: 'gallery', label: 'Gallery', icon: 'gallery' },
  { key: 'speaker', label: 'Speaker', icon: 'speaker' },
  { key: 'sidebar', label: 'Sidebar', icon: 'sidebar' },
  { key: 'together', label: 'Together', icon: 'together' },
];

const REACTIONS = ['👍', '👏', '❤️', '😂', '🎉', '🤔'];

const SHARE_SOURCES: { key: string; label: string; icon: VideoIconName }[] = [
  { key: 'screen', label: 'Entire screen', icon: 'share' },
  { key: 'window', label: 'A window', icon: 'sidebar' },
  { key: 'tab', label: 'A browser tab', icon: 'globe' },
  { key: 'board', label: 'Whiteboard', icon: 'board' },
];

const LiveStage = ({ vc, onOpenPanel }: Props) => {
  const meeting = vc.meeting as VideoMeeting;
  const [showReactions, setShowReactions] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareSource, setShareSource] = useState('screen');
  const [shareAudio, setShareAudio] = useState(false);

  const hero = vc.sharer || vc.activeSpeaker;
  const others = vc.inRoom.filter((p) => p.id !== hero?.id);
  const pin = (id: string) => vc.setPinned(vc.pinned === id ? null : id);

  return (
    <div className="stage-full">
      <div className="meetbar">
        <h2>{meeting.title}</h2>
        <span className="mb-pill">
          <Ic n="clock" />
          <span className="num">{mmss(vc.elapsed)}</span>
        </span>
        <span className="mb-pill enc">
          <Ic n="lock" />
          Encrypted
        </span>
        {vc.recording && (
          <span className="mb-pill rec">
            <span className="dot pulsing" />
            Recording
          </span>
        )}
        {vc.ai && (
          <span className="mb-pill ai">
            <Ic n="spark" />
            AI companion
          </span>
        )}
        {vc.locked && (
          <span className="mb-pill">
            <Ic n="lock" />
            Locked
          </span>
        )}

        <div className="spacer" />

        <div className="layout-seg" role="group" aria-label="Stage layout">
          {LAYOUTS.map((l) => (
            <button
              key={l.key}
              type="button"
              className={vc.layout === l.key ? 'on' : ''}
              onClick={() => vc.setLayout(l.key)}
              title={`${l.label} view`}
              aria-pressed={vc.layout === l.key}
            >
              <Ic n={l.icon} />
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="canvas" style={{ position: 'relative' }}>
        {vc.layout === 'gallery' && (
          <div className="tiles">
            {vc.inRoom.map((p) => (
              <Tile key={p.id} p={p} pinned={vc.pinned} onPin={pin} />
            ))}
          </div>
        )}

        {vc.layout === 'speaker' && hero && (
          <div className="stagewrap speaker">
            <div className="bigtile">
              <Tile p={hero} big pinned={vc.pinned} onPin={pin} />
            </div>
            <div className="strip">
              {others.map((p) => (
                <Tile key={p.id} p={p} pinned={vc.pinned} onPin={pin} />
              ))}
            </div>
          </div>
        )}

        {vc.layout === 'sidebar' && hero && (
          <div className="stagewrap sidebar">
            <div className="bigtile">
              <Tile p={hero} big pinned={vc.pinned} onPin={pin} />
            </div>
            <div className="strip vertical">
              {others.map((p) => (
                <Tile key={p.id} p={p} pinned={vc.pinned} onPin={pin} />
              ))}
            </div>
          </div>
        )}

        {vc.layout === 'together' && (
          <div className="tiles" style={{ gridTemplateColumns: '1fr', alignContent: 'center' }}>
            <div className="tile big" style={{ minHeight: 240 }}>
              <div className="sharesurface" style={{ background: 'var(--stage-2)' }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    alignItems: 'flex-end',
                  }}
                >
                  {vc.inRoom.map((p) => (
                    <div key={p.id} style={{ textAlign: 'center' }}>
                      <div
                        className="tile-av"
                        style={{
                          background: p.tone,
                          width: 62,
                          height: 62,
                          fontSize: 20,
                          margin: '0 auto',
                          boxShadow: p.speaking ? '0 0 0 3px var(--live)' : 'none',
                        }}
                      >
                        {initialsOf(p.name)}
                      </div>
                      <div
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          marginTop: 6,
                          color: 'var(--stage-ink-2)',
                          maxWidth: 78,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.name.split(' ')[0]}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 11 }}>
                  Together mode — everyone on one shared backdrop
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="reactions">
          {vc.reactions.map((r) => (
            <span key={r.id} className="reaction" style={{ right: r.offset }}>
              {r.emoji}
            </span>
          ))}
        </div>

        {showShare && !vc.media.sharing && (
          <div
            style={{
              position: 'absolute',
              bottom: 14,
              left: 14,
              right: 14,
              maxWidth: 520,
              margin: '0 auto',
              padding: 14,
              borderRadius: 'var(--r-lg)',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 7,
            }}
          >
            <div className="sect-title" style={{ marginBottom: 10 }}>
              <Ic n="share" size={13} />
              Share your screen
              <button
                type="button"
                className="mini"
                style={{ marginLeft: 'auto' }}
                onClick={() => setShowShare(false)}
              >
                <Ic n="x" />
              </button>
            </div>

            <div className="sources">
              {SHARE_SOURCES.map((src) => (
                <button
                  key={src.key}
                  type="button"
                  className={`source${shareSource === src.key ? ' on' : ''}`}
                  onClick={() => setShareSource(src.key)}
                >
                  <span className="source-thumb">
                    <Ic n={src.icon} />
                  </span>
                  <span className="source-t">{src.label}</span>
                </button>
              ))}
            </div>

            <div className="rule" style={{ marginTop: 12 }}>
              <span className="rule-ic">
                <Ic n="volume" />
              </span>
              <div className="rule-main">
                <div className="rule-t">Share audio too</div>
                <div className="rule-s">For video clips and anything with sound</div>
              </div>
              <button
                type="button"
                aria-pressed={shareAudio}
                aria-label="Share audio too"
                className={`toggle${shareAudio ? ' on' : ''}`}
                onClick={() => setShareAudio(!shareAudio)}
              />
            </div>

            <div className="formbar" style={{ marginTop: 12 }}>
              <span className="spacer" />
              <button type="button" className="btn ghost sm" onClick={() => setShowShare(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary sm"
                onClick={() => {
                  setShowShare(false);
                  vc.toggleShare();
                }}
              >
                <Ic n="share" />
                Share
              </button>
            </div>
          </div>
        )}

        {showReactions && (
          <div
            style={{
              position: 'absolute',
              bottom: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: 4,
              padding: 7,
              borderRadius: 99,
              background: 'var(--stage-2)',
              border: '1px solid var(--stage-line)',
              zIndex: 6,
            }}
          >
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                style={{ fontSize: 20, lineHeight: 1, padding: '4px 6px', borderRadius: 8 }}
                onClick={() => {
                  vc.react(emoji);
                  setShowReactions(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="dock">
        <div className="dock-left">
          {vc.waiting.length > 0 && (
            <button type="button" className="mb-pill" onClick={() => onOpenPanel('people')}>
              <Ic n="alert" />
              {vc.waiting.length} waiting
            </button>
          )}
        </div>

        <div className="dock-center">
          <button
            type="button"
            className={`dbtn ${vc.media.mic ? 'on' : 'off'}`}
            onClick={vc.toggleMic}
          >
            <Ic n={vc.media.mic ? 'mic' : 'micoff'} />
            {vc.media.mic ? 'Mute' : 'Unmute'}
          </button>
          <button
            type="button"
            className={`dbtn ${vc.media.cam ? 'on' : 'off'}`}
            onClick={vc.toggleCam}
          >
            <Ic n={vc.media.cam ? 'video' : 'videooff'} />
            {vc.media.cam ? 'Stop video' : 'Start video'}
          </button>
          <button
            type="button"
            className={`dbtn${vc.media.sharing ? ' on' : ''}`}
            aria-expanded={showShare}
            onClick={() => {
              // stopping is immediate; starting asks what to share, the way
              // every other conferencing tool does
              if (vc.media.sharing) {
                vc.toggleShare();
                setShowShare(false);
              } else {
                setShowShare((v) => !v);
                setShowReactions(false);
              }
            }}
          >
            <Ic n={vc.media.sharing ? 'shareoff' : 'share'} />
            Share
          </button>
          <button type="button" className={`dbtn${vc.hand ? ' on' : ''}`} onClick={vc.toggleHand}>
            <Ic n="hand" />
            Hand
          </button>
          <button
            type="button"
            className="dbtn"
            onClick={() => setShowReactions((s) => !s)}
            aria-expanded={showReactions}
          >
            <Ic n="smile" />
            React
          </button>
          <button
            type="button"
            className={`dbtn${vc.captions ? ' on' : ''}`}
            onClick={() => {
              vc.setCaptions(!vc.captions);
              vc.showToast(vc.captions ? 'Captions off' : 'Live captions on');
            }}
          >
            <Ic n="cc" />
            Captions
          </button>
          <button
            type="button"
            className={`dbtn${vc.recording ? ' rec' : ''}`}
            onClick={vc.toggleRecording}
          >
            <Ic n={vc.recording ? 'stop' : 'rec'} />
            {vc.recording ? 'Stop rec' : 'Record'}
          </button>
        </div>

        <div className="dock-right">
          <button
            type="button"
            className="dbtn icon"
            title="People"
            aria-label="People"
            onClick={() => onOpenPanel('people')}
          >
            <Ic n="users" />
          </button>
          <button
            type="button"
            className="dbtn icon"
            title="Chat"
            aria-label="Chat"
            onClick={() => onOpenPanel('chat')}
          >
            <Ic n="chat" />
          </button>
          <button
            type="button"
            className={`dbtn icon${vc.ai ? ' aion' : ''}`}
            title="AI companion"
            aria-label="AI companion"
            onClick={() => onOpenPanel('ai')}
          >
            <Ic n="spark" />
          </button>
          <button
            type="button"
            className="dbtn icon"
            title="Apps"
            aria-label="Apps"
            onClick={() => onOpenPanel('apps')}
          >
            <Ic n="grid" />
          </button>
          <button type="button" className="dbtn leave" onClick={vc.leave}>
            <Ic n="hangup" />
            Leave
          </button>
        </div>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------- recap view --- */

const RecapView = ({ vc, onOpenPanel }: Props) => {
  const meeting = vc.meeting as VideoMeeting;
  const recap = useMemo(() => demoRecap(meeting.id), [meeting.id]);
  const chapters = useMemo(() => demoChapters(meeting.id), [meeting.id]);

  return (
    <div className="stage-scroll">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost sm" onClick={vc.backToHub}>
          <Ic n="chev" className="flip" />
          Back
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.03em' }}>
            {meeting.title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {dayLabel(meeting.startsInMins)} {clockLabel(meeting.startsInMins)} ·{' '}
            {meeting.durationMins} min · {meeting.participants.length} attended
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => vc.showToast('Recording link copied')}
          >
            <Ic n="link" />
            Share
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => vc.showToast('Preparing download')}
          >
            <Ic n="dl" />
            Download
          </button>
        </div>
      </div>

      <div className="player">
        <button
          type="button"
          className="player-play"
          onClick={() => vc.showToast('Playback starts here')}
        >
          <Ic n="play" fill />
        </button>
        <div className="player-bar">
          <span className="num">00:00</span>
          <div className="player-track">
            <i style={{ width: '0%' }} />
            {chapters.map((c) => (
              <span key={c.at} className="chapter" style={{ left: `${c.pct}%` }} title={c.title} />
            ))}
          </div>
          <span className="num">{meeting.durationMins}:00</span>
        </div>
      </div>

      <div className="aicard">
        <div className="ac-head">
          <span className="ac-kind">
            <Ic n="spark" />
            AI recap
          </span>
          <span className="src ai">generated</span>
          <span style={{ marginLeft: 'auto' }}>
            <DemoChip />
          </span>
        </div>
        <div className="ac-body">{recap.summary}</div>
        <div className="ac-acts">
          <button type="button" className="mini solid" onClick={() => onOpenPanel('ai')}>
            <Ic n="list" />
            Action items
          </button>
          <button type="button" className="mini" onClick={() => onOpenPanel('captions')}>
            <Ic n="cc" />
            Full transcript
          </button>
          <button
            type="button"
            className="mini"
            onClick={() => vc.showToast('Recap sent to attendees')}
          >
            <Ic n="send" />
            Send to attendees
          </button>
        </div>
      </div>

      <div className="grid3">
        <div className="stat">
          <div className="k">Engagement</div>
          <div className="v">{recap.engagement}%</div>
          <div className="d">Cameras on, chat and reactions</div>
        </div>
        <div className="stat">
          <div className="k">Your talk time</div>
          <div className="v">{recap.talkRatio}%</div>
          <div className="d">Of the total speaking time</div>
        </div>
        <div className="stat">
          <div className="k">Sentiment</div>
          <div className="v">{recap.sentiment}</div>
          <div className="d">Positive overall</div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="sect-title" style={{ marginBottom: 6 }}>
          <Ic n="list" size={13} />
          Chapters
          <span style={{ marginLeft: 'auto' }}>
            <DemoChip />
          </span>
        </div>
        {chapters.map((c) => (
          <button
            key={c.at}
            type="button"
            className="chaprow"
            onClick={() => vc.showToast(`Jumping to ${c.at}`)}
          >
            <span className="chap-time num">{c.at}</span>
            <span style={{ minWidth: 0 }}>
              <span className="chap-t" style={{ display: 'block' }}>
                {c.title}
              </span>
              <span className="chap-s" style={{ display: 'block' }}>
                {c.summary}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ root --- */

const StageColumn = (props: Props) => {
  const { vc } = props;

  return (
    <div className="col stage">
      {vc.view === 'hub' && <HubView {...props} />}
      {vc.view === 'schedule' && <ScheduleView vc={vc} selfName={props.selfName} />}
      {vc.view === 'join' && <JoinView vc={vc} selfName={props.selfName} />}
      {vc.view === 'green' && vc.meeting && <GreenRoom vc={vc} selfName={props.selfName} />}
      {vc.view === 'live' && vc.meeting && <LiveStage {...props} />}
      {vc.view === 'recap' && vc.meeting && <RecapView {...props} />}
    </div>
  );
};

export default StageColumn;
