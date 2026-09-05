/* eslint-disable no-useless-escape */
import { clsx, type ClassValue } from 'clsx';
import * as yup from 'yup';
import { Slide, toast, type TypeOptions } from 'react-toastify';
import { twMerge } from 'tailwind-merge';
import moment from 'moment';
import { io } from 'socket.io-client';
import countryData from '@/lib/countries.json';
import { v4 as uuidv4 } from 'uuid';
import {
  CallDropped,
  Invite,
  MessageIcon,
  StarCircleLine,
  VoicemailLineIcon,
} from '@/assets/icons';
import parsePhoneNumber from 'libphonenumber-js';
import { CreditCardIcon } from 'lucide-react';
import { COMMN_CONST, COMMON_CONST } from '@/constants/common-const';
import { getDomain } from 'tldts';

type LogEntry = {
  caller_id_number: string;
  start_stamp: string; // ISO date
  [key: string]: any;
};

type RunGroup = {
  main: LogEntry;
  acc_logs: LogEntry[];
  count: number;
};

export const IncomingRing = new Audio(`${window.location.origin}/tones/incoming-call.ogg`);
IncomingRing.loop = true;

export const emojiRegex = /([\uD800-\uDBFF][\uDC00-\uDFFF])/g;
export const mentionRegex = /@\[[^\]]+\]\([^\)]+\)/g;
export const urlPattern =
  /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gi;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getAiBaseUrl = () =>
  String(import.meta.env.VITE_AI_URL || '')
    .trim()
    .replace(/\/+$/, '');

export const createAiWidgetKey = () =>
  `wgt_${(
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  ).replace(/[^a-zA-Z0-9]/g, '')}`;

export const getAiWidgetScriptUrl = () => {
  const aiUrl = getAiBaseUrl();
  if (!aiUrl) return '';

  try {
    const url = new URL(aiUrl);
    url.pathname = '/embed/widget.js';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
};

export function getEnv() {
  const aiBaseUrl = getAiBaseUrl();

  return {
    ...import.meta.env,
    VITE_PAYPAL_CLIENT_ID: import.meta.env.VITE_PAYPAL_CLIENT_ID,
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_NOTIFICATION_SOCKET_URL: import.meta.env.VITE_NOTIFICATION_SOCKET_URL,
    VITE_AI_SOCKET_URL: import.meta.env.VITE_AI_SOCKET_URL,
    VITE_AGENTIC_API_URL: import.meta.env.VITE_AGENTIC_API_URL,
    VITE_TEXT_TO_SPEECH_CHAR_LENGTH: import.meta.env.VITE_TEXT_TO_SPEECH_CHAR_LENGTH,
    VITE_STRIPE_PUBLISHABLE_KEY: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY,
    VITE_HUBSPOT_CLIENT_ID: import.meta.env.VITE_HUBSPOT_CLIENT_ID,
    VITE_HUBSPOT_SCOPE: import.meta.env.VITE_HUBSPOT_SCOPE,
    VITE_HUBSPOT_REDIRECT_URL: import.meta.env.VITE_HUBSPOT_REDIRECT_URL,
    VITE_TEMPLATE_BASE_URL: import.meta.env.VITE_TEMPLATE_BASE_URL,
    VITE_WHATSAPP_CHAT_TOKEN: import.meta.env.VITE_WHATSAPP_CHAT_TOKEN,
    VITE_AI_URL: aiBaseUrl,
    VITE_APP_DOMAIN: import.meta.env.VITE_APP_DOMAIN,
    VITE_APP_ENV: import.meta.env.VITE_APP_ENV,
    VITE_APP_SLUG: import.meta.env.VITE_APP_SLUG,
    VITE_WHITEBOARD_BASE_URL:
      import.meta.env.VITE_WHITEBOARD_BASE_URL ?? 'https://qa.mycountrymobile.com/whiteboard',
  };
}

export const getDomainNameFromLocation = () => {
  if (typeof window === 'undefined') return '';

  const host = window.location.hostname.includes('localhost')
    ? 'qa.mycountrymobile.com'
    : window.location.hostname;

  return getDomain(host, { allowPrivateDomains: true }) || host;
};
export function handleAlert({ text = '', type = 'success' }: { text: any; type: TypeOptions }) {
  if (typeof window !== 'undefined' && (window as any).isSessionTerminated) {
    toast.dismiss();
    return null;
  }
  toast.dismiss();
  return toast(text, {
    type: type,
    position: 'top-center',
    transition: Slide,
  });
}

export const convertDateFormateApis = (timeString: any, format: string = '') => {
  return moment
    .utc(timeString)
    .local()
    .format(format || 'MMM DD');
};

export const convertDateTimeFormateApis = (timeString: any, format: string = '') => {
  return moment
    .utc(timeString)
    .local()
    .format(format || 'MMM DD, hh:mm A');
};
export const formatSecondsToMMSS = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
export function removeEnvPrefix(str: string): string {
  return str.replace(/^(dev_|qa_|prod_|live_)/, '');
}

export const stringToColour = (str: string) => {
  if (!str || !str.length) return;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let colour = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    colour += ('00' + value.toString(16)).substr(-2);
  }
  return colour;
};

export const darkenColor = (hexColor: string, factor = 20) => {
  if (!hexColor) return '#fff';
  // Remove the '#' character if present
  hexColor = hexColor.replace('#', '');

  // Convert the hex color to RGB
  const r = parseInt(hexColor.slice(0, 2), 16);
  const g = parseInt(hexColor.slice(2, 4), 16);
  const b = parseInt(hexColor.slice(4, 6), 16);

  // Darken the color by reducing the RGB values
  const newR = Math.max(0, r - factor);
  const newG = Math.max(0, g - factor);
  const newB = Math.max(0, b - factor);

  // Convert the darkened RGB back to hex
  const darkenedColor = `#${newR.toString(16).padStart(2, '0')}${newG
    .toString(16)
    .padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;

  return darkenedColor;
};

export const lightenColorWithAlpha = (
  hexColor: string,
  lightenFactor = 30,
  alpha = 0.2,
): string => {
  if (!hexColor) {
    // Return a fallback color (light gray) if none is provided
    return `rgba(220, 220, 220, ${alpha})`;
  }

  // Remove '#' if present
  const cleanHex = hexColor.replace('#', '');

  // Parse into RGB
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);

  // Lighten each channel by lightenFactor, up to a max of 255
  const newR = Math.min(255, r + lightenFactor);
  const newG = Math.min(255, g + lightenFactor);
  const newB = Math.min(255, b + lightenFactor);

  // Return in RGBA format with the given alpha
  return `rgba(${newR}, ${newG}, ${newB}, ${alpha})`;
};

export const lightenColor = (hexColor: string, factor = 20) => {
  if (!hexColor) return '#fff';

  // Remove the '#' character if present
  hexColor = hexColor.replace('#', '');

  // Convert the hex color to RGB
  const r = parseInt(hexColor.slice(0, 2), 16);
  const g = parseInt(hexColor.slice(2, 4), 16);
  const b = parseInt(hexColor.slice(4, 6), 16);

  // Lighten the color by increasing the RGB values
  const newR = Math.min(255, r + factor);
  const newG = Math.min(255, g + factor);
  const newB = Math.min(255, b + factor);

  // Convert the lightened RGB back to hex
  const lightenedColor = `#${newR.toString(16).padStart(2, '0')}${newG
    .toString(16)
    .padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;

  return lightenedColor;
};

export const SESSION_NAME = 'ucaas-public-token';
export const GUEST_MEETING_TOKEN_KEY = 'guest-meeting-token';
export const GUEST_MEETING_TOKEN_UPDATED_EVENT = 'guest-meeting-token-updated';

/** Persistent device identifier for this browser; used in login, send-otp, verify-otp */
export const DEVICE_ID_KEY = 'ucaas-device-id';

/** Get or create a persistent device id for this browser (stored in localStorage). */
export const getDeviceId = (): string => {
  let id = typeof localStorage !== 'undefined' ? localStorage.getItem(DEVICE_ID_KEY) : null;
  if (!id) {
    id = generateUniqueId();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
};

/** When API returns plan expired with isPlanPaymentPending + token, we store company uuid for renew-plan page */
export const PLAN_PENDING_COMPANY_UUID_KEY = 'ucaas-plan-pending-company-uuid';

/** When set, user must complete renewal before accessing any protected route */
export const PLAN_PENDING_FLAG_KEY = 'ucaas-plan-pending';

/** Set by app when navigating to renew-plan; used to avoid treating in-app navigation as "manual refresh" */
export const RENEW_PLAN_FROM_APP_KEY = 'ucaas-renew-plan-from-app';

export const PLAN_EXPIRED_MESSAGE =
  'Your current plan is no longer active. Please renew to avoid service interruptions.';

export const MEDIA_URL = `${getEnv().VITE_API_BASE_URL}/api/media`;

export const capitalizeFirstLetter = (text = ''): string => {
  if (!text) return '';
  return text?.charAt(0)?.toUpperCase() + text?.slice(1)?.toLowerCase();
};

const replaceControlCharacters = (value: string): string =>
  value
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('');

export const normalizeSearchText = (value: unknown, maxLength = 100): string => {
  const normalized = replaceControlCharacters(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim();

  return maxLength > 0 ? normalized.slice(0, maxLength) : normalized;
};

export const sanitizePlainTextInput = (value: unknown, maxLength?: number): string => {
  const sanitized = replaceControlCharacters(String(value ?? ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/--|\/\*|\*\//g, ' ')
    .replace(/[<>`"'=;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return maxLength && maxLength > 0 ? sanitized.slice(0, maxLength) : sanitized;
};

export const AUDIO_FILE_ACCEPT =
  'audio/*,.aac,.aif,.aiff,.flac,.m4a,.mp3,.oga,.ogg,.opus,.wav,.weba,.webm';

const AUDIO_FILE_EXTENSIONS = new Set([
  'aac',
  'aif',
  'aiff',
  'flac',
  'm4a',
  'mp3',
  'oga',
  'ogg',
  'opus',
  'wav',
  'weba',
  'webm',
]);

export const isAudioFile = (file?: File | null): boolean => {
  if (!file) return false;

  const mimeType = String(file.type || '').toLowerCase();
  if (mimeType.startsWith('audio/')) return true;

  const extension = String(file.name || '')
    .split('.')
    .pop()
    ?.toLowerCase();

  return Boolean(extension && AUDIO_FILE_EXTENSIONS.has(extension));
};

export const MAX_FILE_SIZE = 2 * 1024 * 1024;

export const validateFileSize = (FILE_SIZE: any = MAX_FILE_SIZE, file: File) => {
  if (file?.size > MAX_FILE_SIZE) {
    handleAlert({
      text: `File size should be less than ${FILE_SIZE / 1024 / 1024} MB`,
      type: 'error',
    });
    return false;
  }
  return true;
};

export const openDialer = () => {
  window.dispatchEvent(new CustomEvent('OPEN_DIALER'));
};
export const closeDialer = () => {
  window.dispatchEvent(new CustomEvent('CLOSE_DIALER'));
};
export const openDialerDrawer = () => {
  window.dispatchEvent(new CustomEvent('OPEN_DIALER_DRAWER'));
};
export const closeDialerDrawer = () => {
  window.dispatchEvent(new CustomEvent('CLOSE_DIALER_DRAWER'));
};

export const secondsToMinutes = (seconds: number | string = 0): string => {
  const secs = Number(seconds);
  if (secs === 0) return '0';
  const minutes = Math.floor(secs / 60);
  const remainingSeconds = secs % 60;
  const minPart = minutes > 0 ? `${minutes}m` : '';
  const secPart = remainingSeconds > 0 ? `${remainingSeconds}s` : '';

  return [minPart, secPart]?.filter(Boolean)?.join(' ');
};

export const secondsToHHMMSS = (seconds = 0) => {
  if (!seconds) return '00:00';
  return moment.utc(seconds * 1000).format('mm:ss');
};

export const labels = ['', '', '', '', '', '', ''];

export const initialCallGraphData = {
  labels,
  datasets: [
    {
      label: 'Answered Calls',
      data: [0, 0, 0, 0, 0, 0, 0],
      backgroundColor: '#26c3f6',
    },
    {
      label: 'Outgoing Calls',
      data: [0, 0, 0, 0, 0, 0, 0],
      backgroundColor: '#015023',
    },
    {
      label: 'Missed Calls',
      data: [0, 0, 0, 0, 0, 0, 0],
      backgroundColor: '#FF4E43',
    },
    {
      label: 'Voicemail',
      data: [0, 0, 0, 0, 0, 0, 0],
      backgroundColor: '#b98077',
    },
  ],
};
export const initialVideoGraphData = {
  labels,
  datasets: [
    {
      label: 'Upcoming Meetings',
      data: [0, 0, 0, 0, 0, 0, 0],
      backgroundColor: '#26c3f6',
    },
    {
      label: 'Past Meetings',
      data: [0, 0, 0, 0, 0, 0, 0],
      backgroundColor: '#015023',
    },
    {
      label: 'Invited Meetings',
      data: [0, 0, 0, 0, 0, 0, 0],
      backgroundColor: '#FF4E43',
    },
  ],
};
export const getObjectLength = (obj: object | undefined) => {
  return obj && Object.keys(obj).length > 0 ? true : false;
};

export const formatDate = (date: any) => {
  if (!date) return '';
  return moment(date).format('YYYY-MM-DD');
};

export const isJsonString = (str: string, type = 'object') => {
  try {
    return JSON.parse(str);
  } catch (_) {
    console.log('isJsonString:', _);
    if (type === 'array') {
      return [];
    }
    return {};
  }
};

export function parseJSON(jsonString: any) {
  try {
    return JSON.parse(jsonString);
  } catch (error: any) {
    console.error('JSON parse error:', error.message);
    return null;
  }
}
export const makeSipSocketConnection = (token: string, company_uuid?: string) => {
  console.log(token, 'tokentokentoken');

  if (!token) return;

  const socket = io(getEnv().VITE_NOTIFICATION_SOCKET_URL, {
    query: {
      token: token,
      ...(company_uuid ? { company_uuid } : {}),
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 99999,
  });

  return socket;
};

/**
 * Socket for the AI agent (Ask-Copilot and the dialpad's AI Assist tab).
 *
 * This was previously stubbed to `return null`, which meant `dialpadAiSocket`
 * was always null and every question was silently dropped by the `if (!socket)`
 * guard in the callers — the copilot looked broken with no error anywhere.
 *
 * Reconnection is bounded rather than effectively infinite (unlike the SIP
 * notification socket, which must never give up): if the AI service is down we
 * want it to stop retrying instead of hammering it for the whole session.
 */
export const makeAISocketConnection = (): ReturnType<typeof io> | null => {
  const url = String(getEnv().VITE_AI_SOCKET_URL || '').trim();
  if (!url) {
    console.warn('[AI socket] VITE_AI_SOCKET_URL is not set — Copilot will be unavailable.');
    return null;
  }

  const socket = io(url, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10,
    timeout: 10000,
  });

  socket.on('connect_error', (error: unknown) => {
    console.warn('[AI socket] connection failed', url, error);
  });

  return socket;
};

export const getBrowser = () => {
  const ua = navigator.userAgent;
  let tem;
  let M = ua.match(/(opera|chrome|safari|firefox|msie|trident|brave(?=\/))\/?\s*(\d+)/i) || [];
  if (/trident/i.test(M[1])) {
    tem = /\brv[ :]+(\d+)/g.exec(ua) || [];
    return { name: 'IE', version: tem[1] || '' };
  }
  if (M[1] === 'Chrome') {
    tem = ua.match(/\bOPR|Edge\/(\d+)/);
    if (tem != null) {
      return { name: 'Opera', version: tem[1] };
    }
  }
  M = M[2] ? [M[1], M[2]] : [navigator.appName, navigator.appVersion, '-?'];
  if ((tem = ua.match(/version\/(\d+)/i)) != null) {
    M.splice(1, 1, tem[1]);
  }
  return {
    name: M[0],
    version: M[1],
  };
};

export const detectPlatform = () => {
  const { userAgent, maxTouchPoints, platform } = navigator;
  let OS;
  if (userAgent.match(/Android/i)) {
    OS = 'android';
  } else if (
    userAgent.match(/iP(ad|hone|od)/i) ||
    (maxTouchPoints && maxTouchPoints > 2 && /MacIntel/.test(platform))
  ) {
    OS = 'ios';
  } else if (userAgent.match(/Mac(intosh| OS X)/i)) {
    OS = 'macos';
  } else if (userAgent.match(/Windows/i)) {
    OS = 'windows';
  }
  return OS;
};

export const getSessionInfo = () => {
  const browser = getBrowser();
  const os = detectPlatform();
  const browser_version = `${browser?.name} - ${browser?.version}`;
  const os_version = os;

  return {
    device_type: 'browser',
    browser_version: browser_version ? browser_version : null,
    os_version: os_version ? os_version : null,
  };
};

export const getAbbreviationByTimeZone = (timeZone: any) => {
  const country = countryData?.find((country) =>
    country.timezones.some((tz) => tz.zoneName === timeZone),
  );

  if (country) {
    const matchedTimeZone = country.timezones.find((tz) => tz.zoneName === timeZone);
    return matchedTimeZone?.abbreviation || '';
  }
  return '';
};
interface FormatNotificationOptions {
  hourFormat?: '12' | '24';
}

export const formatNotificationDate = (
  dateString: string,
  options: FormatNotificationOptions = {},
) => {
  if (!dateString) return '';
  const { hourFormat = '24' } = options;
  const date = moment(dateString);
  const now = moment();

  const timeFormat = hourFormat === '12' ? 'hh:mm A' : 'HH:mm';
  if (date.isSame(now, 'day')) {
    return `Today, ${date.format(timeFormat)}`;
  } else if (date.isSame(now.clone().subtract(1, 'day'), 'day')) {
    return `Yesterday, ${date.format(timeFormat)}`;
  } else {
    return date.format(`DD MMM YYYY, ${timeFormat}`);
  }
};
export const getFullFormateDate = (date: any) => moment(date).format('YYYY-MM-DD HH:mm');

export const formatTime = (timeString: any) => {
  // console.log(timeString, 'timeString');

  if (!timeString) return '';
  const date = new Date(timeString);
  return date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

export const formatMeetingDate = (dateString: any, showYear: boolean = false) => {
  if (!dateString) return { day: '', month: '', year: '' };

  const date = new Date(dateString);

  return {
    day: date.toLocaleDateString('en-US', { day: '2-digit' }),
    month: date.toLocaleDateString('en-US', { month: 'short' }),
    year: showYear ? date.getFullYear() : '',
  };
};
export function groupContiguousRunsSmart(logs: any = []): RunGroup[] {
  try {
    if (!Array.isArray(logs)) return [];

    const mapped =
      (logs as any[]).map((item) => {
        if (
          !item ||
          typeof item !== 'object' ||
          typeof item.start_stamp !== 'string' ||
          typeof item.direction !== 'string'
        ) {
          throw new Error('Invalid log entry');
        }

        const distinctionParam =
          item.direction === 'Outbound' ? item.destination_number : item.caller_id_number;

        if (typeof distinctionParam !== 'string') {
          throw new Error('Missing distinction param');
        }

        const date = new Date(item.start_stamp);
        if (isNaN(date.getTime())) {
          throw new Error('Invalid date');
        }

        return {
          entry: item as LogEntry,
          time: date.getTime(),
          key: distinctionParam,
        };
      }) || [];

    // Sort descending by time
    mapped.sort((a, b) => b.time - a.time);

    // Group by number (key)
    const groups: Record<string, { entry: LogEntry; time: number }[]> = {};

    for (const log of mapped) {
      if (!groups[log.key]) {
        groups[log.key] = [];
      }
      groups[log.key].push({ entry: log.entry, time: log.time });
    }

    // Convert to RunGroup[]
    const runs: RunGroup[] = Object.values(groups).map((logs) => {
      // logs already sorted by time (global sort above)
      return {
        main: logs[0].entry, // most recent entry as main
        acc_logs: logs.map((x) => x.entry),
        count: logs.length,
      };
    });

    return runs;
  } catch (err) {
    console.error('groupByNumber error:', err);
    return [];
  }
}

// export function groupContiguousRunsSmart(logs: any = []): RunGroup[] {
//   try {
//     if (!Array.isArray(logs)) return [];

//     // Sort descending by date and validate
//     const sorted =
//       (logs as any[])
//         .map((item) => {
//           if (
//             !item ||
//             typeof item !== "object" ||
//             typeof item.start_stamp !== "string" ||
//             typeof item.direction !== "string"
//           ) {
//             throw new Error("Invalid log entry");
//           }

//           // Pick distinction key
//           const distinctionParam =
//             item.direction === "Outbound"
//               ? item.destination_number
//               : item.caller_id_number;

//           if (typeof distinctionParam !== "string") {
//             throw new Error("Missing distinction param");
//           }

//           const date = new Date(item.start_stamp);
//           if (isNaN(date.getTime())) {
//             throw new Error("Invalid date");
//           }

//           return {
//             entry: item as LogEntry,
//             time: date.getTime(),
//             key: distinctionParam,
//           };
//         })
//         .sort((a, b) => b.time - a.time) || [];

//     const runs: RunGroup[] = [];
//     let currentRun: { entry: LogEntry; key: string }[] = [];

//     for (const log of sorted) {
//       if (
//         currentRun.length === 0 ||
//         log.key === currentRun[0].key
//       ) {
//         currentRun.push(log);
//       } else {
//         runs.push({
//           main: currentRun[0].entry,
//           acc_logs: currentRun.map((x) => x.entry),
//           count: currentRun.length,
//         });
//         currentRun = [log];
//       }
//     }

//     if (currentRun.length) {
//       runs.push({
//         main: currentRun[0].entry,
//         acc_logs: currentRun.map((x) => x.entry),
//         count: currentRun.length,
//       });
//     }

//     return runs;
//   } catch (err) {
//     console.error("groupContiguousRunsSmart error:", err);
//     return [];
//   }
// }
// export function groupContiguousRunsRaw(logs: any = []): RunGroup[] {
//   try {
//     // 1) must be an array
//     if (!Array.isArray(logs)) return [];

//     // 2) sort descending by date; validate each
//     const sorted =
//       (logs as any[])
//         .map((item) => {
//           if (
//             !item ||
//             typeof item !== 'object' ||
//             typeof item.caller_id_number !== 'string' ||
//             typeof item.start_stamp !== 'string'
//           ) {
//             throw new Error('Invalid log entry');
//           }
//           const date = new Date(item.start_stamp);
//           if (isNaN(date.getTime())) {
//             throw new Error('Invalid date');
//           }
//           return { entry: item as LogEntry, time: date.getTime() };
//         })
//         .sort((a, b) => b.time - a.time)
//         .map((x) => x.entry) || [];

//     const runs: RunGroup[] = [];
//     let currentRun: LogEntry[] = [];

//     for (const log of sorted) {
//       if (currentRun.length === 0 || log.caller_id_number === currentRun[0].caller_id_number) {
//         currentRun.push(log);
//       } else {
//         runs.push({
//           main: currentRun[0],
//           acc_logs: currentRun,
//           count: currentRun.length,
//         });
//         currentRun = [log];
//       }
//     }

//     if (currentRun.length) {
//       runs.push({
//         main: currentRun[0],
//         acc_logs: currentRun,
//         count: currentRun.length,
//       });
//     }

//     return runs || [];
//   } catch (err) {
//     console.error('groupContiguousRunsRaw error:', err);
//     return [];
//   }
// }

export const SecondsTohhmmss = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds - hours * 3600) / 60);
  let seconds = totalSeconds - hours * 3600 - minutes * 60;
  seconds = Math.round(seconds * 100) / 100;
  let result = hours === 0 ? '' : hours < 10 ? '0' + hours + ':' : hours + ':';
  result += minutes < 10 ? '0' + minutes : minutes;
  result += ':' + (seconds < 10 ? '0' + seconds : seconds);
  return result;
};

export const handleDownloadFile = async ({
  fileUrl,
  name = 'file',
  setLoading,
}: {
  fileUrl: string;
  name?: string;
  setLoading?: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  if (!fileUrl) {
    handleAlert({ text: 'Invalid file', type: 'error' });
    return;
  }

  try {
    setLoading?.(true);

    const accessToken =
      typeof window !== 'undefined' && /\/api\/media(?:\/|\?|$)/.test(fileUrl)
        ? localStorage.getItem(SESSION_NAME)
        : '';
    const response = await fetch(fileUrl, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
    if (!response.ok) {
      throw new Error('Failed to fetch file');
    }

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${name}.${fileUrl.split('.').pop()}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    window.URL.revokeObjectURL(blobUrl);
  } catch (error: any) {
    handleAlert({
      text: error?.message || 'Download failed',
      type: 'error',
    });
  } finally {
    setLoading?.(false);
  }
};

export const downloadFileFromURL = (fileUrl: string) => {
  if (!fileUrl) {
    handleAlert({ text: 'Invalid file', type: 'error' });
    return;
  }
  try {
    const a = document.createElement('a');
    a.href = fileUrl;
    a.target = '_blank';
    // if (name) {
    //   a.download = `${name}.${fileUrl.split('.').pop()}`;
    // }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (error: any) {
    handleAlert({ text: error?.message || 'Download failed', type: 'error' });
  }
};

export function parseTime(timeString?: string): number {
  if (!timeString) return 0;
  const [h = '0', m = '0', s = '0'] = timeString.split(':');
  const [sec = '0', ms = '0'] = s.split('.');
  return Number(h) * 3600 + Number(m) * 60 + Number(sec) + Number(ms) / 1000;
}

export function convertTimeStampToHHMMSS(timeStamp?: string): string {
  if (!timeStamp) return '';
  const [h = '00', m = '00', s = '00'] = timeStamp.split(':');
  const sec = s.split('.')[0];
  return `${h}:${m}:${sec}`;
}

interface Segment {
  speaker: string;
  text: string;
}

interface Ratio {
  name: string;
  ratio: number;
}

export function calculateWordRatio(segments?: Segment[]): Ratio[] {
  if (!segments?.length) return [];

  const wordCount = segments.reduce<Record<string, number>>((acc, { speaker, text }) => {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    acc[speaker] = (acc[speaker] || 0) + words;
    return acc;
  }, {});

  const totalWords = Object.values(wordCount).reduce((a, b) => a + b, 0);

  return Object.entries(wordCount).map(([name, count]) => ({
    name,
    ratio: Math.round((count / totalWords) * 100),
  }));
}

export const getNextFiveMinute = (minute: number) => {
  const rounded = Math.ceil(minute / 5) * 5;
  return rounded === 60 ? 0 : rounded;
};
export const formatChatDate = (dateString: any) => {
  const inputDate = moment(dateString);
  const today = moment().startOf('day');
  const yesterday = moment().subtract(1, 'day').startOf('day');

  if (inputDate.isSame(today, 'day')) {
    return 'Today';
  } else if (inputDate.isSame(yesterday, 'day')) {
    return 'Yesterday';
  } else {
    return inputDate.format('DD MMMM');
  }
};

export const CHAT_MAX_LENGTH = 400;

export const calculateDeductCost = (totalCost: any, day: any, remainingDays: any) => {
  const payable = (parseInt(totalCost) / day) * remainingDays;
  // return Math.ceil(payable);
  return payable.toFixed(2);
};

export const getCalculatedPlanCost = ({ planDuration = 1, planCost, planExpiration }: any) => {
  const planDays = moment().add(planDuration, 'months').diff(moment(), 'days');
  const remainingDays = moment(planExpiration, 'YYYY-MM-DD').diff(moment(), 'days');
  const totalDeductedCost = calculateDeductCost(planCost, planDays, remainingDays);
  return totalDeductedCost;
};

// export const getLicenseCalculatedPlanCost = ({
//   planCost,
//   plan_start_date,
//   plan_expiration_date,
// }: any) => {
//   const start = moment(plan_start_date).startOf('day');
//   const end = moment(plan_expiration_date).startOf('day');
//   const today = moment().startOf('day');

//   const totalPlanDays = end.diff(start, 'days');
//   const remainingDays = end.diff(today, 'days');

//   const perDayCost = planCost / totalPlanDays;
//   return Number((perDayCost * remainingDays).toFixed(2));
// };
export const getLicenseCalculatedPlanCost = ({
  planCost,
  plan_expiration_date,
}: {
  planCost: number;
  plan_expiration_date: string | Date;
}) => {
  const today = moment().startOf('day');
  const expiration = moment(plan_expiration_date).startOf('day');

  let remainingDays = expiration.diff(today, 'days');

  if (remainingDays === 0 && today.isSame(expiration, 'day')) {
    remainingDays = 1;
  }

  if (remainingDays < 0) {
    return 0;
  }

  const totalPlanDays = 30;
  const perDayCost = planCost / totalPlanDays;

  return Number((perDayCost * remainingDays).toFixed(2));
};

export function formatRecordingDate(createdAt: any) {
  const date = new Date(createdAt);

  const options: any = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  };

  return date.toLocaleString('en-US', options);
}

/* Recordings the platform ships, rather than ones a company made.
 *
 * They live in the media store under `default/recording/<file>` instead of
 * `<company>/greeting/<file>`, so anything playing one has to build a
 * different URL — see `greeting-select.tsx` and the recordings library. The
 * row exists in every tenant with the same uuid, which is what makes matching
 * on the uuid work at all.
 *
 * The last two were added on 3 Sep 2026 to give the Welcome message and
 * On-hold music rows something to offer on a brand-new account: without them
 * both dropdowns opened empty, with nothing to pick and no hint that the
 * answer was to go and record something first. */
export const DEFAULT_RECORDING_UUIDS = [
  '5b6ecf4c-4df2-43fe-b2c7-dd12f457824d',
  '5b6ecf4c-4df2-43fe-b2c7-dd12f457824c',
  '5b6ecf4c-4df2-43fe-b2c7-dd12f457824b',
  '5b6ecf4c-4df2-43fe-b2c7-dd12f457824a',
  // Default welcome message  (type welcome_greeting) — see HIDDEN_RECORDING_UUIDS
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578250',
  // Default hold music       (type on_hold_music)
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578251',
  /* Four proper voicemail greetings, added 3 Sep 2026. The stock rows this
     slot used to offer were recording announcements wearing a `voicemail`
     type — see HIDDEN_RECORDING_UUIDS. */
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578260', // Default voicemail
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578261', // After-hours voicemail
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578262', // Busy - all lines voicemail
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578263', // Holiday voicemail
  /* Welcome message, in a choice of voice and accent, added 3 Sep 2026. All
     three say the same line; only the voice differs, which is the whole point
     of offering more than one. Deliberately NOT in HIDDEN_RECORDING_UUIDS -
     the single generic default was hidden because one stock voice was worse
     than none, and a choice of three is the answer to that, not more of the
     same problem. */
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578270', // Jenny (Female - American)
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578271', // Guy (Male - American)
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578272', // Ryan (Male - British)
  /* The stock set the account owner curated, promoted from their own library
     to every tenant on 3 Sep 2026. These replace the three synthesised voices
     above, which are hidden below - keeping both would have listed two
     recordings called "Jenny (Female - American)". */
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578280', // Jenny (Female - American)
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578281', // Andrew (Male - American)
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578282', // Davis (Male - British)
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578283', // Victoria (Female - British)
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578284', // Hold music - Arabesque
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578285', // Hold music - Bach Prelude
];

/* Stock recordings the pickers do not offer.
 *
 * These rows stay in every tenant and keep playing wherever they are already
 * chosen — this only takes them out of the lists, so nothing anybody has
 * already saved stops working.
 *
 * The default welcome message is hidden at the customer's request: they want
 * their own voices offered there instead of a generic one. Note the cost, which
 * is the reason it was added on 3 Sep 2026 in the first place — a brand-new
 * account now opens the Welcome message dropdown with nothing in it again until
 * somebody records something. The default hold music is deliberately NOT in
 * this list: an account with no hold music of its own is better off with the
 * stock loop than with silence. */
export const HIDDEN_RECORDING_UUIDS = [
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578250',
  /* The four stock rows that were filed as `voicemail` but are not voicemail
     greetings. Three of them announce that a call is being RECORDED, and the
     fourth is a four-second stub; all four were offered as the thing a caller
     hears before leaving a message, which is simply the wrong recording in
     that slot. Hidden rather than deleted, for the reason above: any company
     that already picked one keeps hearing it. The four proper voicemail
     greetings added on 3 Sep 2026 take their place in the list. */
  '5b6ecf4c-4df2-43fe-b2c7-dd12f457824a', // Default VM
  '5b6ecf4c-4df2-43fe-b2c7-dd12f457824b', // Default Recording On
  '5b6ecf4c-4df2-43fe-b2c7-dd12f457824c', // Default Recording Off
  '5b6ecf4c-4df2-43fe-b2c7-dd12f457824d', // Default Recording
  /* The three synthesised welcome voices, replaced on 3 Sep 2026 by the set
     the account owner curated (uuids ...8280-8283 above). Hidden rather than
     deleted, as ever: a company that already chose one keeps hearing it.
     Note what changed since the earlier note here - hiding these used to
     leave the Welcome slot empty, which is why they were put back; there are
     now four better recordings in their place, so the slot stays full. */
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578270', // Jenny (Female - American), synthesised
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578271', // Guy (Male - American), synthesised
  '5b6ecf4c-4df2-43fe-b2c7-dd12f4578272', // Ryan (Male - British), synthesised
];

export const formatSize = (size: number): string => {
  if (size >= 1_048_576) {
    return `${Math.round(size / 1_048_576)} MB`;
  } else if (size >= 1_024) {
    return `${Math.round(size / 1_024)} KB`;
  } else {
    return `${size} Bytes`;
  }
};

export const formatDuration = (seconds: any) => {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '00:00';

  const duration = moment.duration(seconds, 'seconds');
  const minutes = String(duration.minutes()).padStart(2, '0');
  const secs = String(duration.seconds()).padStart(2, '0');

  return `${minutes}:${secs}`;
};

export const convertBase64ToBlob = (base64: any) => {
  const byteCharacters = atob(base64);
  const byteArrays = [];

  for (let i = 0; i < byteCharacters.length; i += 512) {
    const slice = byteCharacters.slice(i, i + 512);
    const byteNumbers = new Array(slice.length);
    for (let j = 0; j < slice.length; j++) {
      byteNumbers[j] = slice.charCodeAt(j);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays, { type: 'audio/mpeg' });
};

export function loadAudioFileAsync(url: any) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    xhr.onload = function () {
      if (xhr.status === 200) {
        const arrayBuffer = xhr.response;
        resolve(arrayBuffer);
      } else {
        reject('Error loading audio file');
      }
    };

    xhr.onerror = function () {
      reject('Network error');
    };

    xhr.send();
  });
}

export const generateUniqueId = () => {
  return uuidv4();
};

export const formatBytes = (bytes: any, decimals = 2) => {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const notificationIconLookup: any = {
  sms: MessageIcon,
  voicemail: VoicemailLineIcon,
  voicemailgroup: VoicemailLineIcon,
  missedcall: CallDropped,
  payment_event_socket: CreditCardIcon,
  did_purchase: CreditCardIcon,
  account_invitation: Invite,
  change_plan_request: StarCircleLine,
};

export const notificationIconColorLookup: any = {
  sms: 'text-primary',
  voicemail: 'text-orange-500',
  account_invitation: 'text-orange-500',
  voicemailgroup: 'text-primary',
  missedcall: 'text-danger-500',
  payment_event_socket: 'text-success-500',
  did_purchase: 'text-success-500',
  change_plan_request: 'text-success-500',
};
/** Below this many digits it is an extension, not a phone number — no country. */
export const EXTENSION_MAX_DIGITS = 6;

/** True when a value is an internal extension rather than a dialable number. */
export const isExtensionNumber = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw || /[a-z]/i.test(raw)) return false;
  return raw.replace(/\D/g, '').length > 0 && raw.replace(/\D/g, '').length <= EXTENSION_MAX_DIGITS;
};

/**
 * A phone number in international form, e.g. "+91 90045 83988".
 *
 * `parsePhoneNumber` THROWS on anything it cannot read — bare digits with no
 * country code (INVALID_COUNTRY), and short extensions like "7242" — so calling
 * it unguarded took down whatever was rendering the number. Numbers reach us
 * both with and without a leading "+", so try the "+" form too before giving up,
 * and hand back the original when nothing parses.
 */
export const formatPhoneNumber = (number: string) => {
  if (!number || typeof number === 'object') return;
  const cleaned = String(number).replace(/\s/g, '');
  if (!cleaned) return;

  const attempt = (value: string) => {
    try {
      return parsePhoneNumber(value)?.formatInternational();
    } catch {
      return undefined;
    }
  };

  /* Retrying a bare number with a "+" is what lets a stored DID keep its flag,
     but it must NOT be tried on an extension: "7242" parses as +7 242, a
     Russian number. Anything short enough to be an extension is returned as
     typed. */
  const canAssumePlus = !cleaned.startsWith('+') && !isExtensionNumber(cleaned);
  const formatted = attempt(cleaned) || (canAssumePlus ? attempt(`+${cleaned}`) : undefined);
  return formatted ?? cleaned.replace('+', '');
};

/**
 * Checks if a phone number is a USA (US) number
 * @param number - Phone number in any format (with or without +, with or without spaces)
 * @returns Object with isUSA (boolean) and countryCode (string) properties
 */
export const checkPhoneNumberCountry = (
  number: string,
): { isUSA: boolean; countryCode: string | undefined } => {
  if (!number || typeof number === 'object') {
    return { isUSA: false, countryCode: undefined };
  }

  try {
    // Clean the number (remove spaces and ensure it starts with +)
    const cleanNumber = number.replace(/\s/g, '').startsWith('+')
      ? number.replace(/\s/g, '')
      : `+${number.replace(/\s/g, '')}`;

    const phoneNumber = parsePhoneNumber(cleanNumber);
    const countryCode = phoneNumber?.country || undefined;
    const isUSA = countryCode === 'US';

    return { isUSA, countryCode };
  } catch (error) {
    console.error('Error parsing phone number:', error);
    return { isUSA: false, countryCode: undefined };
  }
};
// utils/generateExtension.ts

export const generateRandomExtension = (): string => {
  const min = 1000;
  const max = 9999;
  const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
  return randomNumber.toString();
};

export const getDateOnly = (date: any) => moment(date).format('YYYY-MM-DD');

export const showPushNotification = async ({
  body = '',
  title = '',
  icon = '',
  onClick = () => null,
}: {
  body?: string;
  title?: string;
  icon?: unknown;
  onClick?: any;
}) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission === 'granted') {
    const iconPath = String(icon || '').trim();
    const notificationIcon = (() => {
      if (iconPath) {
        if (/^(https?:|data:|blob:)/i.test(iconPath)) return iconPath;
        const baseUrl = String(getEnv().VITE_API_BASE_URL || '').replace(/\/$/, '');
        const normalizedPath = iconPath.replace(/^\/+/, '');
        return baseUrl ? `${baseUrl}/${normalizedPath}` : `/${normalizedPath}`;
      }

      return document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href || '/fav.ico';
    })();
    const notification = new Notification(title, {
      body: body,
      icon: notificationIcon,
    });

    notification.onclick = () => {
      notification.close();
      window.focus();
      onClick();
    };
  }
};

export const formatRecordingTime = (time: number) => {
  if (isNaN(time)) return '00:00';
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const getTodayInTimeZone = (timezone: any) => {
  const now = new Date();

  if (timezone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    //  return formatter.format(now);
    const formatted = formatter.format(now);
    // Standardize formatted output to "YYYY-MM-DD, HH:mm:ss" across all browsers (Chrome uses comma, Firefox does not)
    const cleaned = formatted.replace(/,/g, '').replace(/\s+/g, ' ').trim();
    return cleaned.replace(' ', ', ');
  }
};

export const getMinDateForTimeZone = (timezone: string) => {
  const todayInTZ = getTodayInTimeZone(timezone)?.split(',')?.[0]?.trim();
  return todayInTZ ? moment(todayInTZ).toDate() : new Date();
};

// IT ONLY RETURN DATE "YYYY-MM-DD"
export const getTodayInTimezone = (timezone: string) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
};

export function isDateFuture(date: string) {
  const targetDate = new Date(date);
  const now = new Date();

  if (targetDate > now) {
    return true;
  } else if (targetDate < now) {
    return false;
  } else {
    return false;
  }
}

export const parseResponse = (response: any) => {
  try {
    return JSON.parse(response);
  } catch (e) {
    console.log(e);
    return response;
  }
};

export const scrollToBottom = (
  ref: React.MutableRefObject<HTMLElement | undefined>,
  behavior: 'auto' | 'instant' | 'smooth' = 'instant',
) => {
  if (ref.current) {
    ref.current.scrollTo({ top: ref.current.scrollHeight, behavior });
  }
};

export const openAvCallModal = () => {
  window.dispatchEvent(new CustomEvent('OPEN_AV_CALL_MODAL'));
};
export const closeAvCallModal = () => {
  window.dispatchEvent(new CustomEvent('CLOSE_AV_CALL_MODAL'));
};

export const openActivityDaler = () => {
  window.dispatchEvent(new CustomEvent('OPEN_ACTIVITY_DIALER'));
};
export const closeActivityDaler = () => {
  window.dispatchEvent(new CustomEvent('CLOSE_ACTIVITY_DIALER'));
};
export const toTitleCase = (str: string) => {
  return str
    .split(/[-_]/) // splits on hyphen or underscore
    .map((word) => word?.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export function calculatePercentage(minutes: number) {
  const percent = ((minutes / 60) * 100).toFixed(3);
  return percent;
}

export const getActiveCallTab = () => {
  try {
    const item = sessionStorage.getItem(COMMN_CONST.ACTIVE_CALL_TAB);
    return item ? JSON.parse(item) : false;
  } catch (e) {
    console.error('Error parsing ACTIVE_CALL_TAB from sessionStorage:', e);
    return false;
  }
};

export const setActiveCallTab = () => {
  sessionStorage.setItem(COMMN_CONST.ACTIVE_CALL_TAB, JSON.stringify(true));
};

export const removeActiveCallTab = () => {
  sessionStorage.removeItem(COMMN_CONST.ACTIVE_CALL_TAB);
};

export const getHolidaysPayload = (holidays = []) => {
  return holidays.map((item: any) => ({
    title: item?.title || '',
    from: item?.from || '',
    to: item?.to || '',
    type: item?.type?.value || '',
    type_label: item?.type?.label || '',
    name: item?.value?.name || '',
    value: item?.value?.value || '',
    personal: item?.personal || '',
  }));
};

export const getHolidaysFormVal = (holidays = []) => {
  return holidays?.map((item: any) => ({
    title: item?.title || '',
    from: item?.from || '',
    to: item?.to || '',
    type: {
      label: item?.type_label || '',
      value: item?.type || '',
    },
    value: {
      label: item?.name || '',
      value: item?.value || '',
      name: item?.name || '',
    },
    personal: item?.personal || false,
  }));
};

export const calculateDays = (_start_date: string, _end_date: string) => {
  if (_start_date && _end_date) {
    const start = new Date(_start_date);
    const end = new Date(_end_date);
    const diffTime = end.getTime() - start.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays > 0 ? diffDays : 0;
  }
  return 0;
};

export const calculateSelectedDays = (
  start: moment.Moment | null,
  end: moment.Moment | null,
  operationalHours: Record<string, { open: boolean }>,
) => {
  if (!start || !end) return 0;

  const current = start.clone();
  let total = 0;

  const weekdayCounts: Record<string, number> = {
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
  };

  while (current.isSameOrBefore(end, 'day')) {
    const day = current.day(); // 0 = Sunday, 1 = Monday, ...
    switch (day) {
      case 0:
        weekdayCounts.sunday++;
        break;
      case 1:
        weekdayCounts.monday++;
        break;
      case 2:
        weekdayCounts.tuesday++;
        break;
      case 3:
        weekdayCounts.wednesday++;
        break;
      case 4:
        weekdayCounts.thursday++;
        break;
      case 5:
        weekdayCounts.friday++;
        break;
      case 6:
        weekdayCounts.saturday++;
        break;
    }
    current.add(1, 'day');
  }

  for (const day in operationalHours) {
    if (operationalHours[day].open) {
      total += weekdayCounts[day];
    }
  }

  return total;
};

export const openPowerCampaign = () => {
  window.dispatchEvent(new CustomEvent(COMMON_CONST.OPEN_POWER_CAMPAIGN));
};
export const closePowerCampaign = () => {
  window.dispatchEvent(new CustomEvent(COMMON_CONST.CLOSE_POWER_CAMPAIGN));
};

// utils/calculatePercentage.ts
export function calculateTotalPercentage(value: number, total: number): number {
  if (!total || total === 0) return 0;

  const percentage = (value / total) * 100;
  return parseFloat(Math.min(percentage, 100).toFixed(2));
}

export function formatString(str: string) {
  return str?.replace(/_/g, ' ') || '';
}

export const parseMessage = (msg: string) => {
  try {
    return JSON.parse(msg);
  } catch {
    return [{ type: 'TEXT', text: msg }];
  }
};

export const getDateKey = (iso: string) => {
  return new Date(iso).toISOString().split('T')[0]; // UTC day
};
export const groupMessagesByDate = (data: any) => {
  const map: Record<string, { date: string; message: any[] }> = {};

  data.forEach((item: any) => {
    const key = getDateKey(item.createdAt);
    if (!map[key]) {
      map[key] = { date: key, message: [] };
    }
    map[key].message.push({ ...item, message: parseMessage(item.message) });
  });

  return Object.values(map); // 👈 array of objects
};

export const twitterValidation = () =>
  yup
    .string()
    .nullable()
    .notRequired()
    .matches(
      /^$|^((https?:\/\/)?(www\.)?(twitter\.com|x\.com)\/)?@?[A-Za-z0-9_]{1,15}\/?$/,
      'Enter a valid Twitter URL or ID (e.g. @techcap or twitter.com/techcap)',
    );

/**
 * Channel handles stored on a contact's `social` map.
 *
 * These are the identities the omni channels reach a person on, so they are
 * validated loosely on purpose: a WhatsApp number may be written with or
 * without a country code, and Instagram/Telegram handles appear with or
 * without a leading @ or a full profile URL. Rejecting a real handle over
 * formatting is worse than storing it as typed.
 */
export const whatsappValidation = () =>
  yup
    .string()
    .nullable()
    .notRequired()
    .matches(
      /^$|^\+?[0-9][0-9\s\-()]{6,19}$/,
      'Enter the WhatsApp number in international format (e.g. +1 256 808 1010)',
    );

export const instagramValidation = () =>
  yup
    .string()
    .nullable()
    .notRequired()
    .matches(
      /^$|^((https?:\/\/)?(www\.)?instagram\.com\/)?@?[A-Za-z0-9._]{1,30}\/?$/,
      'Enter a valid Instagram handle or URL (e.g. @acme or instagram.com/acme)',
    );

export const telegramValidation = () =>
  yup
    .string()
    .nullable()
    .notRequired()
    .matches(
      /^$|^((https?:\/\/)?(www\.)?(t\.me|telegram\.me)\/)?@?[A-Za-z0-9_]{4,32}\/?$/,
      'Enter a valid Telegram handle or URL (e.g. @acme or t.me/acme)',
    );

export const facebookValidation = () =>
  yup
    .string()
    .nullable()
    .notRequired()
    .matches(
      /^$|^((https?:\/\/)?(www\.)?(facebook\.com|fb\.com)\/)?[a-zA-Z0-9.]+\/?$/,
      'Enter a valid Facebook profile URL or link (e.g. facebook.com/johndoe)',
    );

export const linkedinValidation = () =>
  yup
    .string()
    .nullable()
    .notRequired()
    .matches(
      /^$|^((https?:\/\/)?(www\.)?linkedin\.com\/in\/)?[a-zA-Z0-9-.]+\/?$/,
      'Enter a valid LinkedIn profile URL or link (e.g. linkedin.com/in/johndoe)',
    );
export const zipcodeValidation = () =>
  yup
    .string()
    .nullable()
    .notRequired()
    .matches(/^$|^[a-zA-Z0-9]{5,10}$/, 'Enter a valid ZIP code (5–10 alphanumeric characters)');

export const canEditMeeting = (startTimeLocal: string) => {
  const start = new Date(startTimeLocal).getTime();
  const now = Date.now();
  const diffInMinutes = (start - now) / 1000 / 60;
  return diffInMinutes > 5;
};

export const canDeleteMeeting = (startTimeLocal: string, endTimeLocal: string) => {
  const start = new Date(startTimeLocal).getTime();
  const end = new Date(endTimeLocal).getTime();
  const now = Date.now();
  const diffInMinutes = (start - now) / 1000 / 60;
  return diffInMinutes > 5 || now > end;
};

export const isMeetingActive = (startTime: string, endTime: string, status: string) => {
  if (!startTime || !endTime) return false;
  if (status === 'COMPLETED') return false;
  const now = moment();
  const parseMeetingTime = (value: string) => {
    const parsed = moment(
      value,
      [moment.ISO_8601, 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss'],
      true,
    );
    return parsed.isValid() ? parsed : moment(value);
  };
  const start = parseMeetingTime(startTime);
  const end = parseMeetingTime(endTime);
  if (!start.isValid() || !end.isValid()) return false;
  return now.isBetween(start, end, null, '[]');
};

/** True when meeting has not started yet and current time is within 5 minutes before start. Uses startUtc (ISO) for reliable parsing. */
export const canEndMeetingBeforeStart = (startUtc: string) => {
  if (!startUtc) return false;
  const start = new Date(startUtc).getTime();
  const now = Date.now();
  const diffInMinutes = (start - now) / 1000 / 60;
  console.log('diffInMinutes', diffInMinutes);
  return diffInMinutes > 0 && diffInMinutes >= 5;
};
export const getInitials = (fullName: string) => {
  if (!fullName) return '';

  const words = fullName.trim().split(/\s+/);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();

  const first = words[0]?.charAt(0).toUpperCase();
  const last = words[words.length - 1]?.charAt(0).toUpperCase();

  return first + last;
};

export const getArrayLength = (arr: any) => {
  return Array.isArray(arr) && arr?.length;
};

/**
 * What the composer tells you about balance before you send.
 *
 * A cost of zero means the price is NOT KNOWN — the rate card comes back
 * without a `rate` on plenty of destinations. It used to be read as
 * "unaffordable": `Math.floor(balance / 0)` is Infinity, but the guard above it
 * returned 0 sendable messages, so a fully funded wallet was told it had no
 * balance and could not send at all. Only report insufficient balance when the
 * price is actually known and the wallet genuinely cannot cover it.
 */
export function getSmsAlert({ freeSmsLeft, smsCount, balanceAmount, totalSmsCharges }: any) {
  if (smsCount <= 0) {
    return 'No SMS to send.';
  }

  const charges = Number(totalSmsCharges);
  const balance = Number(balanceAmount);
  const costPerSms =
    smsCount > 0 && Number.isFinite(charges) && charges > 0 ? charges / smsCount : 0;
  // No price to check against — say nothing about balance rather than blocking.
  const priceKnown = costPerSms > 0;
  const safeBalance = Number.isFinite(balance) ? balance : 0;
  const affordable = priceKnown ? Math.floor(safeBalance / costPerSms) : Number.POSITIVE_INFINITY;

  // Case 1: Free SMS available
  if (freeSmsLeft > 0) {
    // Fully free
    if (freeSmsLeft >= smsCount) {
      return `All ${smsCount} messages are FREE.`;
    }

    const paidMessagesNeeded = smsCount - freeSmsLeft;
    if (!priceKnown || affordable >= paidMessagesNeeded) {
      return `${freeSmsLeft} messages are FREE. The remaining ${paidMessagesNeeded} will be charged to your balance.`;
    }

    const totalSendable = freeSmsLeft + Math.min(affordable, paidMessagesNeeded);
    return `Only ${totalSendable} messages will be sent (${freeSmsLeft} FREE + ${affordable} paid). Insufficient balance for the rest.`;
  }

  // Case 2: No free SMS
  if (!priceKnown) {
    return `All ${smsCount} messages will be sent and charged to your balance.`;
  }
  if (affordable <= 0) {
    return 'You do not have enough balance to send any messages.';
  }
  if (affordable < smsCount) {
    return `You can send only ${affordable} out of ${smsCount} messages with your current balance ($${balanceAmount}).`;
  }

  return `All ${smsCount} messages will be sent and charged to your balance.`;
}
export const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

export const isQueueCall = (session: any) => {
  return session?._request?.headers?.['X-Forwardtype']?.[0]?.raw === 'QUEUE';
};

export const connectMetaChannel = async (
  channel: string,
  setLoading?: (loading: boolean) => void,
  tenantId?: string,
) => {
  setLoading?.(true);
  try {
    const { facebookAuthStart } = await import('@/services/api');
    const response = await facebookAuthStart(channel, tenantId);

    const redirectUrl = response?.data?.data?.result?.url;
    console.log(redirectUrl, 'redirectUrl');

    if (redirectUrl) {
      // Calculate center position
      // const width = 800;
      // const height = 600;
      // const left = window.screenX + (window.outerWidth - width) / 2;
      // const top = window.screenY + (window.outerHeight - height) / 2;

      // Open in centered new tab/window
      window.open(
        redirectUrl,
        '_blank',
        // `width=${width},sheight=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no`,
      );
    } else {
      handleAlert({
        text: 'No login URL returned from the server',
        type: 'error',
      });
    }
  } catch (err: any) {
    console.error(`Error starting ${channel} connection:`, err);
  } finally {
    setLoading?.(false);
  }
};
