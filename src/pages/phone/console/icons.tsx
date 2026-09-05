/**
 * Icon sprite ported verbatim from the MCM Unified Console artifact.
 * Ids are prefixed `mcmi-` so they cannot collide with the app's own SVG ids.
 */
export type ConsoleIconName =
  | 'home'
  | 'phone'
  | 'chat'
  | 'video'
  | 'inbox'
  | 'users'
  | 'route'
  | 'mega'
  | 'chart'
  | 'sliders'
  | 'search'
  | 'mic'
  | 'micoff'
  | 'pause'
  | 'play'
  | 'transfer'
  | 'plus'
  | 'grid'
  | 'note'
  | 'rec'
  | 'hangup'
  | 'spark'
  | 'send'
  | 'up'
  | 'down'
  | 'copy'
  | 'check'
  | 'chev'
  | 'x'
  | 'alert'
  | 'book'
  | 'transcript'
  | 'clock'
  | 'user'
  | 'shield'
  | 'vm'
  | 'star'
  | 'dl'
  | 'bolt'
  | 'brain'
  | 'list'
  | 'cal'
  | 'globe'
  | 'headset'
  | 'moon'
  | 'pin'
  | 'filter'
  | 'arrow-in'
  | 'arrow-out'
  | 'miss'
  | 'park'
  | 'eye'
  | 'expand'
  | 'target'
  | 'trend'
  | 'merge';

export const ConsoleIconSprite = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
    <defs dangerouslySetInnerHTML={{ __html: SPRITE }} />
  </svg>
);

export const Ic = ({
  n,
  size,
  fill = false,
  className = '',
}: {
  n: ConsoleIconName;
  size?: number;
  fill?: boolean;
  className?: string;
}) => (
  <svg
    className={`ic${fill ? ' fill' : ''}${className ? ` ${className}` : ''}`}
    viewBox="0 0 24 24"
    style={size ? { width: size, height: size } : undefined}
    aria-hidden="true"
  >
    <use href={`#mcmi-${n}`} />
  </svg>
);

const SPRITE = `<g id="mcmi-home"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></g>
<g id="mcmi-phone"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></g>
<g id="mcmi-chat"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 4 12a8.4 8.4 0 0 1 8.5-8.5A8.4 8.4 0 0 1 21 11.5z"/></g>
<g id="mcmi-video"><path d="M23 7l-7 5 7 5zM1 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" transform="translate(2)"/></g>
<g id="mcmi-inbox"><path d="M22 12h-6l-2 3h-4l-2-3H2M5.4 5.8 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.2A2 2 0 0 0 16.8 5H7.2a2 2 0 0 0-1.8.8z"/></g>
<g id="mcmi-users"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></g>
<g id="mcmi-route"><path d="M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9v3a6 6 0 0 1-6 6H9"/></g>
<g id="mcmi-mega"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/></g>
<g id="mcmi-chart"><path d="M3 3v18h18M7 15l4-5 3 3 5-7"/></g>
<g id="mcmi-sliders"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></g>
<g id="mcmi-search"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>
<g id="mcmi-mic"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></g>
<g id="mcmi-micoff"><path d="m2 2 20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 10.5V5a3 3 0 0 0-5.9-.8M19 10v2a7 7 0 0 1-1.1 3.8M12 19v3M5 10v2a7 7 0 0 0 10 6.3"/></g>
<g id="mcmi-pause"><path d="M7 4h3v16H7zM14 4h3v16h-3z"/></g>
<g id="mcmi-play"><path d="M6 3.5 20 12 6 20.5z"/></g>
<g id="mcmi-transfer"><path d="M17 2l4 4-4 4M21 6H9a4 4 0 0 0-4 4v1M7 22l-4-4 4-4M3 18h12a4 4 0 0 0 4-4v-1"/></g>
<g id="mcmi-plus"><path d="M12 5v14M5 12h14"/></g>
<g id="mcmi-grid"><circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="18" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/><circle cx="6" cy="18" r="1.4"/><circle cx="12" cy="18" r="1.4"/><circle cx="18" cy="18" r="1.4"/></g>
<g id="mcmi-note"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"/></g>
<g id="mcmi-rec"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/></g>
<g id="mcmi-hangup"><path d="M2.5 11.2a13 13 0 0 1 19 0 1.6 1.6 0 0 1 .1 2.1l-1.5 1.8a1.6 1.6 0 0 1-2 .4l-2.4-1.3a1.6 1.6 0 0 1-.8-1.6l.2-1.4a9.3 9.3 0 0 0-6.2 0l.2 1.4a1.6 1.6 0 0 1-.8 1.6l-2.4 1.3a1.6 1.6 0 0 1-2-.4l-1.5-1.8a1.6 1.6 0 0 1 .1-2.1z"/></g>
<g id="mcmi-spark"><path d="M12 1.8 15.3 8.7 22.2 12 15.3 15.3 12 22.2 8.7 15.3 1.8 12 8.7 8.7z"/></g>
<g id="mcmi-send"><path d="M21.5 12 3 3.5 6.5 12 3 20.5zM6.5 12H21"/></g>
<g id="mcmi-up"><path d="M7 10.5v9h-3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM7 10.5 11.5 3a2.2 2.2 0 0 1 2.2 2.6L13 9h5.6a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.7H7z"/></g>
<g id="mcmi-down"><path d="M17 13.5v-9h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1zM17 13.5 12.5 21a2.2 2.2 0 0 1-2.2-2.6l.7-3.4H5.4a2 2 0 0 1-2-2.4l1.3-6.4a2 2 0 0 1 2-1.7H17z"/></g>
<g id="mcmi-copy"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></g>
<g id="mcmi-check"><path d="m4 12.5 5.5 5.5L20 6.5"/></g>
<g id="mcmi-chev"><path d="m9 5 7 7-7 7"/></g>
<g id="mcmi-x"><path d="M5 5l14 14M19 5 5 19"/></g>
<g id="mcmi-alert"><path d="M12 3 2.5 20h19zM12 10v4M12 17.2v.1"/></g>
<g id="mcmi-book"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5zM4 17.5A2.5 2.5 0 0 1 6.5 15H20"/></g>
<g id="mcmi-transcript"><path d="M20 4H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3v4l4.5-4H20a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M6 9h9M6 12.5h5"/></g>
<g id="mcmi-clock"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.3 2"/></g>
<g id="mcmi-user"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></g>
<g id="mcmi-shield"><path d="M12 2.5 4 6v6c0 5 3.4 8.6 8 9.5 4.6-.9 8-4.5 8-9.5V6z"/><path d="m9 12 2 2 4-4"/></g>
<g id="mcmi-vm"><circle cx="6" cy="14" r="4"/><circle cx="18" cy="14" r="4"/><path d="M6 18h12"/></g>
<g id="mcmi-star"><path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.2 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z"/></g>
<g id="mcmi-dl"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></g>
<g id="mcmi-bolt"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></g>
<g id="mcmi-brain"><path d="M9.5 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5.3A3 3 0 0 0 5.6 16 3 3 0 0 0 9 20.5a2.5 2.5 0 0 0 3-2.4V5.5A2.5 2.5 0 0 0 9.5 3zM14.5 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5.3A3 3 0 0 1 18.4 16 3 3 0 0 1 15 20.5a2.5 2.5 0 0 1-3-2.4"/></g>
<g id="mcmi-list"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.1M3.5 12h.1M3.5 18h.1"/></g>
<g id="mcmi-cal"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></g>
<g id="mcmi-globe"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></g>
<g id="mcmi-headset"><path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 14a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z"/></g>
<g id="mcmi-moon"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></g>
<g id="mcmi-pin"><path d="M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3z"/></g>
<g id="mcmi-filter"><path d="M3 4h18l-7 8v7l-4 2v-9z"/></g>
<g id="mcmi-arrow-in"><path d="M20 4 9 15M9 15V8M9 15h7"/></g>
<g id="mcmi-arrow-out"><path d="M4 20 15 9M15 9v7M15 9H8"/></g>
<g id="mcmi-miss"><path d="M20 4 9 15M9 15V8M9 15h7"/></g>
<g id="mcmi-park"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9.5 17V8h3.2a2.7 2.7 0 0 1 0 5.4H9.5"/></g>
<g id="mcmi-eye"><path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></g>
<g id="mcmi-expand"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></g>
<g id="mcmi-target"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></g>
<g id="mcmi-trend"><path d="M3 17l6-6 4 4 8-8M21 7h-5M21 7v5"/></g>
<g id="mcmi-merge"><path d="M8 21V9a5 5 0 0 0-5-5M16 21V9a5 5 0 0 1 5-5M12 3v18"/></g>`;
