import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { callQueueInfo, getCampaignDetail, getContactInfoV1 } from '@/services/api';
import { useUser } from '@/hooks/use-user';
import { getEnv, handleAlert, makeAISocketConnection, SESSION_NAME } from '@/lib/utils';
import { queueIdFromHeaders } from '@/lib/queue-session';
import JsSIP from 'jssip';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Mic, Video } from 'lucide-react';
import { getHeaderFirstValue } from '@/components/dialpad/session-display';
import { toNullableString } from '@/components/notes';

export type DialpadModalSize = 'micro' | 'mini' | 'maxi';
export type DialpadMakeCallOptions = {
  size?: DialpadModalSize;
  extraHeaders?: string[];
  forceRefreshContactInfo?: boolean;
};
export type DialpadTransferType = 'speak_first' | 'transfer_now';
export type DialpadUaStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'registered'
  | 'unregistered'
  | 'registrationFailed'
  | 'disconnected'
  | 'stopped';

type SipCredentials = {
  turn_username?: string;
  turn_password?: string;
  stun_url?: string;
  turn_url?: string;
  turn_urls?: string[];
  wss_url: string;
  extension: string;
  password: string;
  domain: string;
  caller_id?: string | null;
};

type SessionDirection = 'incoming' | 'outgoing';
type SessionEventOriginator = 'local' | 'remote' | 'system';

type SessionRemoteMetaData = {
  username?: string;
  email?: string;
  extension?: string;
};

type SpeakFirstTransferState = {
  mainSessionId: string;
  consultSessionId?: string;
  target: string;
  startedAt: number;
};

export type DialpadTranscriptionStatus = 'stop' | 'start' | 'resume';

export type DialpadTranscriptMessage = {
  id: string | number;
  speaker?: string;
  speakerIndex?: number | null;
  speakerDetails?: any;
  msg: string;
  sipCallId?: string;
  requestId?: string;
  start_time?: string;
  answered_time?: string;
  mode?: string;
  /** BCP-47 tag the ASR reports for this turn, when it reports one. */
  language?: string;
};

export type DialpadSessionHeaders = Record<string, string[]>;

export type DialpadQueueMetaData = {
  id: string;
  response?: any | null;
};

export type DialpadCampaignMetaData = {
  id: string;
  script?: string | null;
  response?: any | null;
};

export type DialpadSessionAiInfo = {
  AiAgentId: string;
  AiToken: string;
  AiChat: any[];
};

export type DialpadSession = {
  id: string;
  direction: SessionDirection;
  status: string;
  isOnHold: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  isRecording: boolean;
  recordingLocked?: boolean;
  hasAnswered: boolean;
  username?: string;
  email?: string;
  extension?: string;
  remoteName: string;
  remoteNumber: string;
  startedAt: number;
  connectedAt?: number;
  endedAt?: number;
  cause?: string;
  eventOriginator?: SessionEventOriginator;
  headers: DialpadSessionHeaders;
  extraHeaders: string[];
  queueMetaData?: DialpadQueueMetaData | null;
  campaignMetaData?: DialpadCampaignMetaData | null;
  contactInfo?: any | null;
  liveCallData?: any | null;
  conferenceData?: any | null;
  AiInfo?: DialpadSessionAiInfo | null;
  transcriptionHasStarted: DialpadTranscriptionStatus;
  transcriptionMessages: DialpadTranscriptMessage[];
};

interface DialpadContextType {
  isDialpadOpen: boolean;
  setIsDialpadOpen: Dispatch<SetStateAction<boolean>>;
  openDialpad: (size?: DialpadModalSize) => void;
  closeDialpad: () => void;
  toggleDialpad: (size?: DialpadModalSize) => void;
  modalSize: DialpadModalSize;
  setModalSize: Dispatch<SetStateAction<DialpadModalSize>>;
  sipCredentials: SipCredentials | null;
  uaStatus: DialpadUaStatus;
  isRegistered: boolean;
  lastError: string | null;
  campaignContactCards: any[] | null;
  setCampaignContactCards: Dispatch<SetStateAction<any[] | null>>;
  joinedCampaignId: string | null;
  setJoinedCampaignId: Dispatch<SetStateAction<string | null>>;
  activeCampaign: any | null;
  setActiveCampaign: Dispatch<SetStateAction<any | null>>;
  campaignClearingSecondsLeft: number;
  startCampaignClearingTimer: () => void;
  activeQueueData: any | null;
  setActiveQueueData: Dispatch<SetStateAction<any | null>>;
  sessions: Record<string, DialpadSession>;
  activeSessionId: string | null;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  connectSip: () => void;
  disconnectSip: () => void;
  registerUa: () => void;
  unregisterUa: () => void;
  makeCall: (target: string, options?: DialpadMakeCallOptions) => boolean;
  answerCall: (sessionId: string) => void;
  endCall: (sessionId: string) => void;
  muteCall: (sessionId: string) => void;
  unmuteCall: (sessionId: string) => void;
  holdCall: (sessionId: string) => void;
  unholdCall: (sessionId: string) => void;
  toggleSpeakerCall: (sessionId: string) => void;
  switchActiveSession: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
  clearAllSessions: () => void;
  activeSpeakFirstTarget: string | null;
  handleTransfer: (type: DialpadTransferType, number: string) => void;
  handleTranscription: (
    session: DialpadSession | null,
    transcriptionType: DialpadTranscriptionStatus,
    transcriptMessage?: Partial<DialpadTranscriptMessage> | null,
  ) => void;
  getMatchedLiveCallBySession: (
    liveCallsArray: any[],
    session: DialpadSession | null,
  ) => any | null;
  ensureSessionContactInfo: (session: DialpadSession | null) => Promise<any | null>;
  refreshSessionContactInfo: (sessionId: string, contactInfo: any) => void;
  updateConferenceDataBySipCallIds: (conferenceData: any) => void;
  toggleRecordingCall: (sessionId: string) => void;
  sendDtmf: (sessionId: string, tone: string) => void;
  patchSessionAiInfo: (sessionId: string, aiInfo: DialpadSessionAiInfo | null) => void;
  dialpadAiSocket: any | null;
  requestDialpadAiSocketAuth: (token: string) => void;
}

const EMPTY_FN = () => void 0;
const EMPTY_FALSE_FN = () => false;
const EMPTY_NULL_FN = () => null;
const EMPTY_NULL_ASYNC_FN = async () => null;
const TERMINAL_SESSION_STATUSES = new Set(['ended', 'failed']);

const isLiveSessionStatus = (status?: string) =>
  !TERMINAL_SESSION_STATUSES.has(String(status || '').toLowerCase());

export const DialpadContext = createContext<DialpadContextType>({
  isDialpadOpen: false,
  setIsDialpadOpen: EMPTY_FN,
  openDialpad: EMPTY_FN,
  closeDialpad: EMPTY_FN,
  toggleDialpad: EMPTY_FN,
  modalSize: 'mini',
  setModalSize: EMPTY_FN,
  sipCredentials: null,
  uaStatus: 'idle',
  isRegistered: false,
  lastError: null,
  campaignContactCards: null,
  setCampaignContactCards: EMPTY_FN,
  joinedCampaignId: null,
  setJoinedCampaignId: EMPTY_FN,
  activeCampaign: null,
  setActiveCampaign: EMPTY_FN,
  campaignClearingSecondsLeft: 0,
  startCampaignClearingTimer: EMPTY_FN,
  activeQueueData: null,
  setActiveQueueData: EMPTY_FN,
  sessions: {},
  activeSessionId: null,
  setActiveSessionId: EMPTY_FN,
  connectSip: EMPTY_FN,
  disconnectSip: EMPTY_FN,
  registerUa: EMPTY_FN,
  unregisterUa: EMPTY_FN,
  makeCall: EMPTY_FALSE_FN,
  answerCall: EMPTY_FN,
  endCall: EMPTY_FN,
  muteCall: EMPTY_FN,
  unmuteCall: EMPTY_FN,
  holdCall: EMPTY_FN,
  unholdCall: EMPTY_FN,
  toggleSpeakerCall: EMPTY_FN,
  switchActiveSession: EMPTY_FN,
  clearSession: EMPTY_FN,
  clearAllSessions: EMPTY_FN,
  activeSpeakFirstTarget: null,
  handleTransfer: EMPTY_FN,
  handleTranscription: EMPTY_FN,
  getMatchedLiveCallBySession: EMPTY_NULL_FN,
  ensureSessionContactInfo: EMPTY_NULL_ASYNC_FN,
  refreshSessionContactInfo: EMPTY_FN,
  updateConferenceDataBySipCallIds: EMPTY_FN,
  toggleRecordingCall: EMPTY_FN,
  sendDtmf: EMPTY_FN,
  patchSessionAiInfo: EMPTY_FN,
  dialpadAiSocket: null,
  requestDialpadAiSocketAuth: EMPTY_FN,
});

const normalizeDialTarget = (target: string) => target?.replace(/\s+/g, '')?.trim();
const normalizeOutgoingDialTarget = (target: string) => {
  const normalizedTarget = normalizeDialTarget(target);
  if (!normalizedTarget) return normalizedTarget;

  const isSipUri = normalizedTarget.toLowerCase().startsWith('sip:');
  const isFeatureCode = normalizedTarget.startsWith('*') || normalizedTarget.startsWith('#');
  const isDigitsOnly = /^\d+$/.test(normalizedTarget);
  const shouldPrependPlus =
    normalizedTarget.length > 4 &&
    !normalizedTarget.startsWith('+') &&
    !isSipUri &&
    !isFeatureCode &&
    isDigitsOnly;

  return shouldPrependPlus ? `+${normalizedTarget}` : normalizedTarget;
};
const SELF_CALL_ERROR_MESSAGE = 'You cannot call yourself';
const DUPLICATE_CALL_ERROR_MESSAGE = 'Call already running for this number or extension';
const normalizeSelfCallTarget = (target?: string) => {
  const normalizedTarget = normalizeDialTarget(target || '');
  if (!normalizedTarget) return '';

  const targetUserPart = normalizedTarget.replace(/^sip:/i, '').split('@')[0];
  return targetUserPart.replace(/_web$/i, '');
};
const getDialTargetVariants = (target?: string): string[] => {
  const normalizedTarget = normalizeDialTarget(target || '');
  if (!normalizedTarget) return [];

  const variants = new Set<string>();
  const pushVariant = (value?: string) => {
    const normalizedValue = normalizeDialTarget(value || '');
    if (!normalizedValue) return;
    variants.add(normalizedValue.toLowerCase());
  };

  pushVariant(normalizedTarget);
  pushVariant(normalizeOutgoingDialTarget(normalizedTarget));

  const selfTarget = normalizeSelfCallTarget(normalizedTarget);
  pushVariant(selfTarget);
  pushVariant(normalizeOutgoingDialTarget(selfTarget));

  return Array.from(variants);
};
const getContactInfoLookupKeysForTarget = (target?: string): string[] => {
  const lookupValues = new Set<string>();

  getDialTargetVariants(target).forEach((variant) => {
    const normalizedVariant = normalizeDialTarget(variant);
    if (!normalizedVariant) return;

    lookupValues.add(normalizedVariant);

    const withoutPlus = normalizedVariant.replace(/^\+/, '');
    if (withoutPlus) {
      lookupValues.add(withoutPlus);
      lookupValues.add(`+${withoutPlus}`);
    }
  });

  return Array.from(lookupValues).map((lookupValue) => {
    const lookupType = lookupValue.length <= 4 ? 'extension' : 'phone';
    return `${lookupType}:${lookupValue}`;
  });
};
const getSessionAudioElementId = (sessionId: string) => `dialpad-session-audio-${sessionId}`;
const INCOMING_RINGTONE_AUDIO_ID = 'dialpad-incoming-ringtone';
const INCOMING_RINGTONE_SOURCE = '/tones/incoming-call.ogg';
const AI_AUTH_EMIT_DELAY_MS = 350;
const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';
const ICE_CANDIDATE_READY_DEBOUNCE_MS = 3000;
type DialpadMediaPermissionName = 'microphone' | 'camera';

type DialpadMandatoryPermissionPrompt = {
  permissionName: DialpadMediaPermissionName;
  constraints: MediaStreamConstraints;
  prePromptTitle: string;
  prePromptMessage: string;
  allowActionLabel: string;
  blockedTitle: string;
  blockedMessage: string;
};

type DialpadPermissionPopupState = {
  title: string;
  description: string;
  actionLabel: string;
  pendingPermissions?: DialpadMediaPermissionName[];
};

const DIALPAD_MANDATORY_PERMISSION_PROMPTS: DialpadMandatoryPermissionPrompt[] = [
  {
    permissionName: 'microphone',
    constraints: { audio: true, video: false },
    prePromptTitle: 'Microphone Access Required',
    prePromptMessage:
      'Microphone permission is mandatory for audio and video calls. Please click "Allow" in the next browser popup.',
    allowActionLabel: 'Allow Microphone',
    blockedTitle: 'Microphone Access Blocked',
    blockedMessage:
      'Microphone permission is mandatory for audio and video calls. Please allow microphone access from browser site settings and reload the page.',
  },
  {
    permissionName: 'camera',
    constraints: { audio: false, video: true },
    prePromptTitle: 'Camera Access Required',
    prePromptMessage:
      'Camera permission is mandatory for video calls. Please click "Allow" in the next browser popup.',
    allowActionLabel: 'Allow Camera',
    blockedTitle: 'Camera Access Blocked',
    blockedMessage:
      'Camera permission is mandatory for video calls. Please allow camera access from browser site settings and reload the page.',
  },
];

const sanitizeMetaValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const isLiveCallEqual = (currentLiveCall: any, nextLiveCall: any): boolean => {
  if (!currentLiveCall && !nextLiveCall) return true;
  if (!currentLiveCall || !nextLiveCall) return false;

  try {
    return JSON.stringify(currentLiveCall) === JSON.stringify(nextLiveCall);
  } catch {
    return currentLiveCall?.sip_call_id === nextLiveCall?.sip_call_id;
  }
};

const getHeaderValueFromHeaders = (
  headers: DialpadSessionHeaders | null | undefined,
  headerName: string,
): string => {
  if (!headers) return '';

  const normalizedHeaderName = headerName.trim().toLowerCase();
  const directHeaderValues = headers[normalizedHeaderName];
  if (Array.isArray(directHeaderValues) && directHeaderValues[0]) {
    return String(directHeaderValues[0]).trim();
  }

  const matchingHeader = Object.entries(headers).find(
    ([key]) => key.trim().toLowerCase() === normalizedHeaderName,
  );
  if (!matchingHeader) return '';

  const [, values] = matchingHeader;
  if (!Array.isArray(values) || !values[0]) return '';
  return String(values[0]).trim();
};

const getSessionHeaderValue = (session: DialpadSession | null, headerName: string): string => {
  return getHeaderValueFromHeaders(session?.headers, headerName);
};

const isCampaignOrQueueSession = (session: DialpadSession | null | undefined): boolean => {
  if (!session) return false;

  const queueId = String(session.queueMetaData?.id || '').trim();
  const campaignId = String(session.campaignMetaData?.id || '').trim();
  const forwardTypeFromHeader = getSessionHeaderValue(session, 'x-forwardtype').toUpperCase();
  /* The agent's leg carries the queue id as X-ForwardValue, not X-Queue -
     see queue-session.ts. Reading only X-Queue found nothing on the one leg
     the agent is actually on. */
  const queueIdFromHeader = queueIdFromHeaders((name) => getSessionHeaderValue(session, name));
  const campaignIdFromHeader = getSessionHeaderValue(session, 'x-campaignuuid');
  const liveForwardType = String(session.liveCallData?.forward_type || '')
    .trim()
    .toUpperCase();
  const liveCampaignType = String(session.liveCallData?.campaign_type || '')
    .trim()
    .toUpperCase();
  const liveCallType = String(session.liveCallData?.call_type || '')
    .trim()
    .toUpperCase();

  const isQueueCall = Boolean(
    queueId ||
    queueIdFromHeader ||
    forwardTypeFromHeader === 'QUEUE' ||
    liveForwardType === 'QUEUE' ||
    liveCallType === 'QUEUE',
  );
  const isCampaignCall = Boolean(
    campaignId ||
    campaignIdFromHeader ||
    forwardTypeFromHeader === 'CAMPAIGN' ||
    liveForwardType === 'CAMPAIGN' ||
    liveCampaignType ||
    liveCallType === 'CAMPAIGN',
  );

  return isQueueCall || isCampaignCall;
};

const appendHeaderValue = (
  target: DialpadSessionHeaders,
  rawName: string,
  rawValue: string | null | undefined,
) => {
  const name = rawName?.trim()?.toLowerCase();
  const value = rawValue?.trim();
  if (!name || !value) return;

  if (!target[name]) {
    target[name] = [value];
    return;
  }

  if (!target[name].includes(value)) {
    target[name].push(value);
  }
};

const extractHeadersFromRequestObject = (request: any): DialpadSessionHeaders => {
  const headers: DialpadSessionHeaders = {};
  const requestHeaders = request?.headers;
  if (!requestHeaders || typeof requestHeaders !== 'object') return headers;

  Object.entries(requestHeaders).forEach(([headerName, headerEntries]) => {
    if (!Array.isArray(headerEntries)) return;

    headerEntries.forEach((headerEntry: any) => {
      if (typeof headerEntry === 'string') {
        appendHeaderValue(headers, headerName, headerEntry);
        return;
      }

      if (typeof headerEntry?.raw === 'string') {
        appendHeaderValue(headers, headerName, headerEntry.raw);
        return;
      }

      if (typeof headerEntry?.value === 'string') {
        appendHeaderValue(headers, headerName, headerEntry.value);
        return;
      }

      if (typeof headerEntry?.toString === 'function') {
        const renderedValue = `${headerEntry.toString()}`;
        appendHeaderValue(headers, headerName, renderedValue);
      }
    });
  });

  return headers;
};

const extractHeadersFromRequestString = (request: any): DialpadSessionHeaders => {
  const headers: DialpadSessionHeaders = {};
  if (typeof request?.toString !== 'function') return headers;

  const rawMessage = `${request.toString()}`;
  if (!rawMessage) return headers;

  const [headerSection = ''] = rawMessage.split(/\r?\n\r?\n/);
  const headerLines = headerSection.split(/\r?\n/).slice(1);

  let currentHeaderName = '';
  let currentHeaderValue = '';

  const flushCurrentHeader = () => {
    appendHeaderValue(headers, currentHeaderName, currentHeaderValue);
    currentHeaderName = '';
    currentHeaderValue = '';
  };

  headerLines.forEach((line) => {
    if (!line) return;

    if (/^\s/.test(line) && currentHeaderName) {
      currentHeaderValue = `${currentHeaderValue} ${line.trim()}`.trim();
      return;
    }

    flushCurrentHeader();
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) return;

    currentHeaderName = line.slice(0, separatorIndex).trim();
    currentHeaderValue = line.slice(separatorIndex + 1).trim();
  });

  flushCurrentHeader();
  return headers;
};

const mergeHeaderMaps = (...headerMaps: DialpadSessionHeaders[]): DialpadSessionHeaders => {
  const mergedHeaders: DialpadSessionHeaders = {};

  headerMaps.forEach((headerMap) => {
    Object.entries(headerMap || {}).forEach(([headerName, headerValues]) => {
      if (!Array.isArray(headerValues)) return;
      headerValues.forEach((headerValue) => {
        appendHeaderValue(mergedHeaders, headerName, headerValue);
      });
    });
  });

  return mergedHeaders;
};

const extractSessionHeaders = (request: any): DialpadSessionHeaders =>
  mergeHeaderMaps(
    extractHeadersFromRequestObject(request),
    extractHeadersFromRequestString(request),
  );

const extractSessionExtraHeaders = (request: any, fallbackExtraHeaders: string[]): string[] => {
  const rawRequestExtraHeaders = request?.extraHeaders;
  const requestExtraHeaders = Array.isArray(rawRequestExtraHeaders)
    ? rawRequestExtraHeaders.filter(
        (header: unknown): header is string =>
          typeof header === 'string' && header.trim().length > 0,
      )
    : [];

  const allExtraHeaders = [...requestExtraHeaders, ...fallbackExtraHeaders];
  return allExtraHeaders.filter(
    (headerValue, index) => allExtraHeaders.indexOf(headerValue) === index,
  );
};

const parseRemoteMetaDataHeader = (request: any): SessionRemoteMetaData => {
  const headerValue =
    request?.getHeader?.('remoteMetaData') ||
    request?.getHeader?.('remotemetadata') ||
    request?.getHeader?.('X-remoteMetaData') ||
    request?.getHeader?.('x-remotemetadata') ||
    '';

  if (!headerValue || typeof headerValue !== 'string') return {};

  const candidates: string[] = [headerValue];
  try {
    candidates.unshift(decodeURIComponent(headerValue));
  } catch {
    // Keep raw header candidate if decode fails.
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== 'object') continue;

      return {
        username: sanitizeMetaValue((parsed as SessionRemoteMetaData)?.username),
        email: sanitizeMetaValue((parsed as SessionRemoteMetaData)?.email),
        extension: sanitizeMetaValue((parsed as SessionRemoteMetaData)?.extension),
      };
    } catch {
      // Keep trying fallback candidates.
    }
  }

  return {};
};

const buildPcConfig = (credentials: SipCredentials) => {
  const { stun_url, turn_url, turn_urls, turn_username, turn_password } = credentials;
  const stunUrl = stun_url || DEFAULT_STUN_URL;
  const turnUsername = turn_username || '';
  const turnPassword = turn_password || '';
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];

  if (stunUrl) {
    iceServers.push({ urls: stunUrl });
  }

  // Every relay address the API offers, not just the first. A browser on a
  // network that blocks outbound UDP gathers no relay candidate from a UDP-only
  // list, and the call then dies about fifteen seconds in - it dials, it rings,
  // and the carrier gives up because no audio ever reached it. The TCP and TLS
  // entries exist for that case. Older API builds send only turn_url, so fall
  // back to it rather than losing the relay entirely.
  const relayUrls = (turn_urls?.length ? turn_urls : [turn_url])
    .map((url) => `${url || ''}`.trim())
    .filter((url) => url.length > 0);

  if (relayUrls.length > 0 && turnPassword) {
    iceServers.push({
      urls: relayUrls,
      username: turnUsername,
      credential: turnPassword,
    });
  }

  return { iceServers };
};

const CAMPAIGN_CLEARING_TIMER_SECONDS = 30;

export const DialpadProvider = ({ children }: { children: ReactNode }) => {
  const [isDialpadOpen, setIsDialpadOpen] = useState(false);
  const [modalSize, setModalSize] = useState<DialpadModalSize>('mini');
  const [uaStatus, setUaStatus] = useState<DialpadUaStatus>('idle');
  const [isRegistered, setIsRegistered] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [campaignContactCards, setCampaignContactCards] = useState<any[] | null>(null);
  const [joinedCampaignId, setJoinedCampaignId] = useState<string | null>(null);
  const [activeCampaign, setActiveCampaign] = useState<any | null>(null);
  const [campaignClearingSecondsLeft, setCampaignClearingSecondsLeft] = useState(0);
  const [activeQueueData, setActiveQueueData] = useState<any | null>(null);
  const [sessions, setSessions] = useState<Record<string, DialpadSession>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSpeakFirstTarget, setActiveSpeakFirstTarget] = useState<string | null>(null);
  const [permissionPopup, setPermissionPopup] = useState<DialpadPermissionPopupState | null>(null);
  const [dialpadAiSocket, setDialpadAiSocket] = useState<any>(null);

  const uaRef = useRef<any>(null);
  const sessionRef = useRef<Record<string, any>>({});
  const recordingStatusCheckedRef = useRef<Set<string>>(new Set());
  const isStartingRef = useRef(false);
  const credentialKeyRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionsStateRef = useRef<Record<string, DialpadSession>>({});
  const sessionAudioRef = useRef<Record<string, HTMLAudioElement>>({});
  const peerConnectionCleanupRef = useRef<Record<string, () => void>>({});
  const speakerStateRef = useRef<Record<string, boolean>>({});
  const answeredSessionIdsRef = useRef<Set<string>>(new Set());
  const incomingRingtoneRef = useRef<HTMLAudioElement | null>(null);
  const incomingRingingSessionIdsRef = useRef<Set<string>>(new Set());
  const speakFirstTransferRef = useRef<SpeakFirstTransferState | null>(null);
  const permissionPopupResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const queueMetaDataCacheRef = useRef<Record<string, any>>({});
  const queueMetaDataRequestRef = useRef<Record<string, Promise<any> | null>>({});
  const campaignMetaDataCacheRef = useRef<Record<string, any>>({});
  const campaignMetaDataRequestRef = useRef<Record<string, Promise<any> | null>>({});
  const sessionContactInfoCacheRef = useRef<Record<string, any | null>>({});
  const sessionContactInfoRequestRef = useRef<Record<string, Promise<any | null> | null>>({});
  const sessionContactInfoCacheBustRef = useRef<Record<string, number>>({});
  const dialpadAiSocketRef = useRef<any>(null);
  const aiAuthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const campaignClearingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiConnectAuthHandlerRef = useRef<(() => void) | null>(null);
  const aiLastAuthMetaRef = useRef<{ token: string; socketId: string; at: number } | null>(null);
  const { user, loader } = useUser();

  const clearCampaignClearingTimer = useCallback((resetSeconds = true) => {
    if (campaignClearingIntervalRef.current) {
      clearInterval(campaignClearingIntervalRef.current);
      campaignClearingIntervalRef.current = null;
    }

    if (resetSeconds) {
      setCampaignClearingSecondsLeft(0);
    }
  }, []);

  const startCampaignClearingTimer = useCallback(() => {
    clearCampaignClearingTimer(false);
    setCampaignClearingSecondsLeft(CAMPAIGN_CLEARING_TIMER_SECONDS);

    campaignClearingIntervalRef.current = setInterval(() => {
      setCampaignClearingSecondsLeft((prevSeconds) => {
        if (prevSeconds <= 1) {
          if (campaignClearingIntervalRef.current) {
            clearInterval(campaignClearingIntervalRef.current);
            campaignClearingIntervalRef.current = null;
          }
          return 0;
        }

        return prevSeconds - 1;
      });
    }, 1000);
  }, [clearCampaignClearingTimer]);

  const sipCredentials = useMemo<SipCredentials | null>(() => {
    const credentials = user?.sip_credentials;
    if (
      !credentials?.wss_url ||
      !credentials?.extension ||
      !credentials?.domain ||
      !credentials?.password
    ) {
      return null;
    }

    return {
      turn_username: credentials.turn_username,
      turn_password: credentials.turn_password,
      stun_url: credentials.stun_url,
      turn_url: credentials.turn_url,
      turn_urls: credentials.turn_urls,
      wss_url: credentials.wss_url,
      extension: credentials.extension,
      password: credentials.password,
      domain: credentials.domain,
      caller_id: credentials.caller_id,
    };
  }, [user?.sip_credentials]);

  const outboundDisplayName = useMemo(() => {
    const firstName = sanitizeMetaValue(user?.user_info?.first_name);
    const lastName = sanitizeMetaValue(user?.user_info?.last_name);
    const fullName = `${firstName || ''} ${lastName || ''}`.trim();
    return fullName || sanitizeMetaValue(user?.user_info?.email) || 'Unknown User';
  }, [user?.user_info?.email, user?.user_info?.first_name, user?.user_info?.last_name]);

  const outboundUserName = useMemo(
    () =>
      sanitizeMetaValue(user?.user_info?.extension) || sanitizeMetaValue(sipCredentials?.extension),
    [sipCredentials?.extension, user?.user_info?.extension],
  );

  const sessionMetaDataHeader = useMemo(() => {
    const username = outboundDisplayName;
    const email = sanitizeMetaValue(user?.user_info?.email) || sanitizeMetaValue(user?.email);
    const extension = outboundUserName;

    const payload: SessionRemoteMetaData = { username, email, extension };
    return `remoteMetaData: ${encodeURIComponent(JSON.stringify(payload))}`;
  }, [outboundDisplayName, outboundUserName, user?.email, user?.user_info?.email]);

  const patchSession = useCallback((sessionId: string, patch: Partial<DialpadSession>) => {
    setSessions((prev) => {
      if (!prev[sessionId]) return prev;
      return {
        ...prev,
        [sessionId]: {
          ...prev[sessionId],
          ...patch,
        },
      };
    });
  }, []);

  const patchSessionAiInfo = useCallback(
    (sessionId: string, aiInfo: DialpadSessionAiInfo | null) => {
      if (!sessionId) return;
      patchSession(sessionId, { AiInfo: aiInfo });
    },
    [patchSession],
  );

  const invalidateSessionContactInfoCache = useCallback((target?: string) => {
    getContactInfoLookupKeysForTarget(target).forEach((lookupKey) => {
      sessionContactInfoCacheBustRef.current[lookupKey] =
        (sessionContactInfoCacheBustRef.current[lookupKey] || 0) + 1;
      delete sessionContactInfoCacheRef.current[lookupKey];
      delete sessionContactInfoRequestRef.current[lookupKey];
    });
  }, []);

  const requestDialpadAiSocketAuth = useCallback((tokenValue: string) => {
    const socket = dialpadAiSocketRef.current;
    const token = String(tokenValue || '').trim();
    if (!socket || !token) return;

    const maybeSkipDuplicate = () => {
      const lastAuthMeta = aiLastAuthMetaRef.current;
      const socketId = String(socket.id || '');
      const now = Date.now();
      return Boolean(
        lastAuthMeta &&
        lastAuthMeta.token === token &&
        lastAuthMeta.socketId === socketId &&
        now - lastAuthMeta.at < 1200,
      );
    };

    const emitAuth = () => {
      if (!socket.connected) return;
      if (maybeSkipDuplicate()) return;
      socket.emit('auth', token);
      aiLastAuthMetaRef.current = {
        token,
        socketId: String(socket.id || ''),
        at: Date.now(),
      };
      console.log('[DialpadContext] socket.emit("auth")', {
        tokenLength: token.length,
      });
    };

    if (aiAuthTimeoutRef.current) {
      clearTimeout(aiAuthTimeoutRef.current);
      aiAuthTimeoutRef.current = null;
    }

    if (socket.connected) {
      aiAuthTimeoutRef.current = setTimeout(() => {
        emitAuth();
      }, AI_AUTH_EMIT_DELAY_MS);
      return;
    }

    if (aiConnectAuthHandlerRef.current) {
      socket.off('connect', aiConnectAuthHandlerRef.current);
    }

    const handleConnectForAuth = () => {
      aiConnectAuthHandlerRef.current = null;
      aiAuthTimeoutRef.current = setTimeout(() => {
        emitAuth();
      }, AI_AUTH_EMIT_DELAY_MS);
    };

    aiConnectAuthHandlerRef.current = handleConnectForAuth;
    socket.on('connect', handleConnectForAuth);
    socket.connect();
  }, []);

  const openDialpad = useCallback((size: DialpadModalSize = 'mini') => {
    setIsDialpadOpen(true);
    setModalSize(size);
  }, []);

  const closeDialpad = useCallback(() => {
    setIsDialpadOpen(false);
  }, []);

  const toggleDialpad = useCallback((size?: DialpadModalSize) => {
    setIsDialpadOpen((prev) => {
      const next = !prev;
      if (next && size) {
        setModalSize(size);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    sessionsStateRef.current = sessions;
  }, [sessions]);

  const hasLiveSession = useMemo(
    () => Object.values(sessions).some((session) => isLiveSessionStatus(session.status)),
    [sessions],
  );

  useEffect(() => {
    const socket = makeAISocketConnection();
    if (!socket) return;

    dialpadAiSocketRef.current = socket;
    setDialpadAiSocket(socket);

    return () => {
      if (aiAuthTimeoutRef.current) {
        clearTimeout(aiAuthTimeoutRef.current);
        aiAuthTimeoutRef.current = null;
      }
      if (aiConnectAuthHandlerRef.current) {
        socket.off('connect', aiConnectAuthHandlerRef.current);
        aiConnectAuthHandlerRef.current = null;
      }
      socket.disconnect();
      if (dialpadAiSocketRef.current === socket) {
        dialpadAiSocketRef.current = null;
      }
      aiLastAuthMetaRef.current = null;
      setDialpadAiSocket((prev: any) => (prev === socket ? null : prev));
    };
  }, []);

  const resolvePermissionPopup = useCallback((confirmed: boolean) => {
    setPermissionPopup(null);
    if (!permissionPopupResolverRef.current) return;
    permissionPopupResolverRef.current(confirmed);
    permissionPopupResolverRef.current = null;
  }, []);

  const showPermissionPopup = useCallback((popupState: DialpadPermissionPopupState) => {
    return new Promise<boolean>((resolve) => {
      if (permissionPopupResolverRef.current) {
        permissionPopupResolverRef.current(false);
      }
      permissionPopupResolverRef.current = resolve;
      setPermissionPopup(popupState);
    });
  }, []);

  const fetchQueueMetaDataById = useCallback(async (queueId: string, sessionId?: string) => {
    const normalizedQueueId = `${queueId || ''}`.trim();
    if (!normalizedQueueId) return null;

    const applyQueueMetaDataToSessions = (queueResult: any) => {
      setSessions((prev) => {
        let hasChanges = false;
        const nextSessions: Record<string, DialpadSession> = { ...prev };

        Object.entries(prev).forEach(([currentSessionId, currentSession]) => {
          if (sessionId && currentSessionId !== sessionId) return;

          const currentQueueId = `${currentSession?.queueMetaData?.id || ''}`.trim();
          if (currentQueueId !== normalizedQueueId) return;

          hasChanges = true;
          nextSessions[currentSessionId] = {
            ...currentSession,
            queueMetaData: {
              id: normalizedQueueId,
              response: queueResult,
            },
          };
        });

        return hasChanges ? nextSessions : prev;
      });
    };

    const cachedQueueResult = queueMetaDataCacheRef.current[normalizedQueueId];
    if (cachedQueueResult) {
      applyQueueMetaDataToSessions(cachedQueueResult);
      return cachedQueueResult;
    }

    if (!queueMetaDataRequestRef.current[normalizedQueueId]) {
      queueMetaDataRequestRef.current[normalizedQueueId] = callQueueInfo({
        uuid: normalizedQueueId,
      })
        .then((queueResponse) => {
          const queueResult =
            queueResponse?.data?.data?.result ?? queueResponse?.data?.result ?? null;
          queueMetaDataCacheRef.current[normalizedQueueId] = queueResult;
          return queueResult;
        })
        .finally(() => {
          queueMetaDataRequestRef.current[normalizedQueueId] = null;
        });
    }

    try {
      const queueResult = await queueMetaDataRequestRef.current[normalizedQueueId];
      applyQueueMetaDataToSessions(queueResult);
      return queueResult;
    } catch (error: any) {
      setLastError(error?.message || 'Unable to fetch queue info');
      return null;
    }
  }, []);

  const fetchCampaignMetaDataById = useCallback(async (campaignId: string, sessionId?: string) => {
    const normalizedCampaignId = `${campaignId || ''}`.trim();
    if (!normalizedCampaignId) return null;

    const applyCampaignMetaDataToSessions = (campaignResult: any) => {
      setSessions((prev) => {
        let hasChanges = false;
        const nextSessions: Record<string, DialpadSession> = { ...prev };

        Object.entries(prev).forEach(([currentSessionId, currentSession]) => {
          if (sessionId && currentSessionId !== sessionId) return;

          const currentCampaignId = `${currentSession?.campaignMetaData?.id || ''}`.trim();
          if (currentCampaignId !== normalizedCampaignId) return;

          hasChanges = true;
          nextSessions[currentSessionId] = {
            ...currentSession,
            campaignMetaData: {
              id: normalizedCampaignId,
              response: campaignResult,
            },
          };
        });

        return hasChanges ? nextSessions : prev;
      });
    };

    const cachedCampaignResult = campaignMetaDataCacheRef.current[normalizedCampaignId];
    if (cachedCampaignResult) {
      applyCampaignMetaDataToSessions(cachedCampaignResult);
      return cachedCampaignResult;
    }

    if (!campaignMetaDataRequestRef.current[normalizedCampaignId]) {
      campaignMetaDataRequestRef.current[normalizedCampaignId] = getCampaignDetail({
        campaignId: normalizedCampaignId,
      })
        .then((campaignResponse) => {
          const campaignResult =
            campaignResponse?.data?.data?.result ?? campaignResponse?.data?.result ?? null;
          campaignMetaDataCacheRef.current[normalizedCampaignId] = campaignResult;
          return campaignResult;
        })
        .finally(() => {
          campaignMetaDataRequestRef.current[normalizedCampaignId] = null;
        });
    }

    try {
      const campaignResult = await campaignMetaDataRequestRef.current[normalizedCampaignId];
      applyCampaignMetaDataToSessions(campaignResult);
      return campaignResult;
    } catch (error: any) {
      setLastError(error?.message || 'Unable to fetch campaign info');
      return null;
    }
  }, []);

  const ensureSessionContactInfo = useCallback(
    async (session: DialpadSession | null) => {
      if (!session?.id) return null;

      const currentSession = sessions[session.id];
      const resolvedSession = currentSession || session;
      if (resolvedSession?.contactInfo !== undefined) {
        return resolvedSession.contactInfo ?? null;
      }

      const lookupNumber =
        toNullableString(getHeaderFirstValue(resolvedSession?.headers, 'x-originalnumber')) ??
        normalizeDialTarget(resolvedSession?.remoteNumber || '') ??
        normalizeDialTarget(resolvedSession?.extension || '');

      if (!lookupNumber) {
        patchSession(session.id, { contactInfo: null });
        return null;
      }

      const isExtensionLookup = lookupNumber.length <= 4;
      const lookupType = isExtensionLookup ? 'extension' : 'phone';
      const lookupKey = `${lookupType}:${lookupNumber}`;
      const rawLookupValue =
        getHeaderFirstValue(resolvedSession?.headers, 'x-originalnumber') || lookupNumber;
      // SIP delivers the remote number as plain digits (no leading "+"), but
      // contacts are stored/matched E.164-style — the create-contact form
      // already prefixes "+" before saving. Looking up without the same
      // prefix caused real contacts to read as "not in contacts" here while
      // still tripping the backend's duplicate-phone check on save.
      const payload = isExtensionLookup
        ? { type: 'extension', extension: rawLookupValue }
        : { type: 'phone', phone: rawLookupValue.startsWith('+') ? rawLookupValue : `+${rawLookupValue}` };

      if (Object.prototype.hasOwnProperty.call(sessionContactInfoCacheRef.current, lookupKey)) {
        const cachedContactInfo = sessionContactInfoCacheRef.current[lookupKey];
        patchSession(session.id, { contactInfo: cachedContactInfo });
        return cachedContactInfo;
      }

      if (isExtensionLookup && isCampaignOrQueueSession(resolvedSession)) {
        patchSession(session.id, { contactInfo: null });
        return null;
      }

      if (!sessionContactInfoRequestRef.current[lookupKey]) {
        const cacheBustVersion = sessionContactInfoCacheBustRef.current[lookupKey] || 0;
        const contactInfoRequest = getContactInfoV1(payload)
          .then((response) => {
            const responseData = response?.data?.data;
            const contactInfo = responseData?.result ?? responseData ?? null;
            if ((sessionContactInfoCacheBustRef.current[lookupKey] || 0) === cacheBustVersion) {
              sessionContactInfoCacheRef.current[lookupKey] = contactInfo;
            }
            return contactInfo;
          })
          .catch(() => {
            if ((sessionContactInfoCacheBustRef.current[lookupKey] || 0) === cacheBustVersion) {
              sessionContactInfoCacheRef.current[lookupKey] = null;
            }
            return null;
          })
          .finally(() => {
            if (sessionContactInfoRequestRef.current[lookupKey] === contactInfoRequest) {
              sessionContactInfoRequestRef.current[lookupKey] = null;
            }
          });
        sessionContactInfoRequestRef.current[lookupKey] = contactInfoRequest;
      }

      const contactInfo = await sessionContactInfoRequestRef.current[lookupKey];
      patchSession(session.id, { contactInfo });
      return contactInfo;
    },
    [patchSession, sessions],
  );

  // ensureSessionContactInfo caches lookups (including "no contact found") and
  // never re-fetches once a session has a contactInfo value — so saving a
  // contact mid-call needs to push the fresh result in directly rather than
  // asking ensureSessionContactInfo to look it up again.
  const refreshSessionContactInfo = useCallback(
    (sessionId: string, contactInfo: any) => {
      const session = sessions[sessionId];
      const lookupNumber =
        toNullableString(getHeaderFirstValue(session?.headers, 'x-originalnumber')) ??
        normalizeDialTarget(session?.remoteNumber || '') ??
        normalizeDialTarget(session?.extension || '');

      if (lookupNumber) {
        const isExtensionLookup = lookupNumber.length <= 4;
        const lookupKey = `${isExtensionLookup ? 'extension' : 'phone'}:${lookupNumber}`;
        sessionContactInfoCacheRef.current[lookupKey] = contactInfo;
        sessionContactInfoCacheBustRef.current[lookupKey] =
          (sessionContactInfoCacheBustRef.current[lookupKey] || 0) + 1;
      }

      patchSession(sessionId, { contactInfo });
    },
    [patchSession, sessions],
  );

  const stopMediaStream = useCallback((stream: MediaStream | null | undefined) => {
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  }, []);

  const queryMediaPermissionState = useCallback(
    async (permissionName: DialpadMediaPermissionName): Promise<PermissionState | null> => {
      if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;

      try {
        const status = await navigator.permissions.query({
          name: permissionName as PermissionName,
        });
        return status.state;
      } catch {
        return null;
      }
    },
    [],
  );

  const ensureMandatoryAvPermissions = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!navigator?.mediaDevices?.getUserMedia) return;

    const pendingPermissions: DialpadMandatoryPermissionPrompt[] = [];
    for (const prompt of DIALPAD_MANDATORY_PERMISSION_PROMPTS) {
      const state = await queryMediaPermissionState(prompt.permissionName);
      if (state !== 'granted') {
        pendingPermissions.push(prompt);
      }
    }

    if (pendingPermissions.length === 0) return;

    const isAllBlocked = await (async () => {
      for (const p of pendingPermissions) {
        const state = await queryMediaPermissionState(p.permissionName);
        if (state !== 'denied') return false;
      }
      return true;
    })();

    if (isAllBlocked) {
      await showPermissionPopup({
        title: 'Permissions Blocked',
        description:
          'Microphone and Camera access are blocked. Please allow them in your browser settings to make calls.',
        actionLabel: 'I Understand',
      });
      return;
    }

    const confirmed = await showPermissionPopup({
      title: 'Permissions Required',
      description:
        'Microphone and camera permissions are mandatory for audio and video calls. Please click "Allow Access" and then "Allow" in the browser popup.',
      actionLabel: 'Allow Access',
      pendingPermissions: pendingPermissions.map((p) => p.permissionName),
    });

    if (!confirmed) {
      setLastError('Microphone and camera permissions are mandatory for audio and video calls.');
      return;
    }

    const combinedConstraints: MediaStreamConstraints = {
      audio: pendingPermissions.some((p) => p.constraints.audio),
      video: pendingPermissions.some((p) => p.constraints.video),
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(combinedConstraints);
      stopMediaStream(stream);
    } catch (error: any) {
      const normalizedErrorName = `${error?.name || ''}`.toLowerCase();
      const isPermissionDenied =
        normalizedErrorName.includes('notallowed') ||
        normalizedErrorName.includes('permission') ||
        normalizedErrorName.includes('security');

      if (isPermissionDenied) {
        await showPermissionPopup({
          title: 'Access Blocked',
          description:
            'Permission was denied. Please allow microphone and camera access from browser site settings and reload the page.',
          actionLabel: 'I Understand',
        });
        setLastError('Permissions mandatory for audio/video calls.');
      } else {
        const fallbackMessage = error?.message || 'Unable to access media devices.';
        setLastError(fallbackMessage);
      }
    }
  }, [queryMediaPermissionState, showPermissionPopup, stopMediaStream]);

  useEffect(() => {
    if (loader || !user?.token) return;
    void ensureMandatoryAvPermissions();
  }, [ensureMandatoryAvPermissions, loader, user?.token]);

  useEffect(() => {
    return () => {
      if (permissionPopupResolverRef.current) {
        permissionPopupResolverRef.current(false);
        permissionPopupResolverRef.current = null;
      }
    };
  }, []);

  const ensureSessionAudioElement = useCallback((sessionId: string) => {
    if (typeof window === 'undefined') return null;

    const cached = sessionAudioRef.current[sessionId];
    if (cached && document.body.contains(cached)) return cached;

    const audioElementId = getSessionAudioElementId(sessionId);
    const existingElement = document.getElementById(audioElementId);
    if (existingElement instanceof HTMLAudioElement) {
      existingElement.autoplay = true;
      existingElement.setAttribute('playsinline', 'true');
      existingElement.setAttribute('webkit-playsinline', 'true');
      existingElement.hidden = true;
      existingElement.muted = !(speakerStateRef.current[sessionId] ?? true);
      sessionAudioRef.current[sessionId] = existingElement;
      return existingElement;
    }

    const audioElement = document.createElement('audio');
    audioElement.id = audioElementId;
    audioElement.autoplay = true;
    audioElement.setAttribute('playsinline', 'true');
    audioElement.setAttribute('webkit-playsinline', 'true');
    audioElement.hidden = true;
    audioElement.muted = !(speakerStateRef.current[sessionId] ?? true);
    document.body.appendChild(audioElement);
    sessionAudioRef.current[sessionId] = audioElement;
    return audioElement;
  }, []);

  const ensureIncomingRingtoneElement = useCallback(() => {
    if (typeof window === 'undefined') return null;

    const cached = incomingRingtoneRef.current;
    if (cached && document.body.contains(cached)) return cached;

    const existingElement = document.getElementById(INCOMING_RINGTONE_AUDIO_ID);
    if (existingElement instanceof HTMLAudioElement) {
      existingElement.loop = true;
      existingElement.preload = 'auto';
      existingElement.hidden = true;
      existingElement.src = INCOMING_RINGTONE_SOURCE;
      existingElement.setAttribute('playsinline', 'true');
      existingElement.setAttribute('webkit-playsinline', 'true');
      incomingRingtoneRef.current = existingElement;
      return existingElement;
    }

    const audioElement = document.createElement('audio');
    audioElement.id = INCOMING_RINGTONE_AUDIO_ID;
    audioElement.loop = true;
    audioElement.preload = 'auto';
    audioElement.src = INCOMING_RINGTONE_SOURCE;
    audioElement.hidden = true;
    audioElement.setAttribute('playsinline', 'true');
    audioElement.setAttribute('webkit-playsinline', 'true');
    document.body.appendChild(audioElement);
    incomingRingtoneRef.current = audioElement;
    return audioElement;
  }, []);

  const playIncomingRingtone = useCallback(
    (sessionId: string) => {
      incomingRingingSessionIdsRef.current.add(sessionId);
      const audioElement = ensureIncomingRingtoneElement();
      if (!audioElement) return;

      if (audioElement.paused) {
        audioElement.currentTime = 0;
      }

      void audioElement.play().catch(() => undefined);
    },
    [ensureIncomingRingtoneElement],
  );

  const stopIncomingRingtone = useCallback((sessionId?: string) => {
    if (sessionId) {
      incomingRingingSessionIdsRef.current.delete(sessionId);
    } else {
      incomingRingingSessionIdsRef.current.clear();
    }

    if (incomingRingingSessionIdsRef.current.size > 0) return;

    const audioElement =
      incomingRingtoneRef.current ?? document.getElementById(INCOMING_RINGTONE_AUDIO_ID);
    if (!(audioElement instanceof HTMLAudioElement)) {
      incomingRingtoneRef.current = null;
      return;
    }

    try {
      audioElement.pause();
      audioElement.currentTime = 0;
    } catch {
      // Ignore ringtone cleanup failures.
    }

    incomingRingtoneRef.current = audioElement;
  }, []);

  const hangupLiveSessions = useCallback(() => {
    Object.entries(sessionsStateRef.current).forEach(([sessionId, sessionState]) => {
      if (!isLiveSessionStatus(sessionState.status)) return;

      const session = sessionRef.current[sessionId];
      if (!session) return;

      stopIncomingRingtone(sessionId);
      try {
        session.terminate();
      } catch {
        // Ignore termination errors during browser unload.
      }
    });
  }, [stopIncomingRingtone]);

  useEffect(() => {
    if (!hasLiveSession) return;

    let didHangupOnUnload = false;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = 'There is an ongoing call.';
    };

    const handleConfirmedUnload = () => {
      if (didHangupOnUnload) return;
      didHangupOnUnload = true;
      hangupLiveSessions();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleConfirmedUnload);
    window.addEventListener('unload', handleConfirmedUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleConfirmedUnload);
      window.removeEventListener('unload', handleConfirmedUnload);
    };
  }, [hangupLiveSessions, hasLiveSession]);

  const clearSpeakFirstTransferBySession = useCallback((sessionId: string) => {
    const currentSpeakFirstTransfer = speakFirstTransferRef.current;
    if (!currentSpeakFirstTransfer) return;

    if (currentSpeakFirstTransfer.consultSessionId === sessionId) {
      speakFirstTransferRef.current = {
        ...currentSpeakFirstTransfer,
        consultSessionId: undefined,
      };
      setActiveSpeakFirstTarget(null);
      return;
    }

    if (currentSpeakFirstTransfer.mainSessionId === sessionId) {
      speakFirstTransferRef.current = null;
      setActiveSpeakFirstTarget(null);
      return;
    }

    const sessionState = sessionsStateRef.current[sessionId];
    if (!sessionState) return;

    const speakFirstTargetVariants = new Set(
      getDialTargetVariants(currentSpeakFirstTransfer.target),
    );
    if (speakFirstTargetVariants.size === 0) return;

    const sessionTargetVariants = new Set([
      ...getDialTargetVariants(sessionState.remoteNumber),
      ...getDialTargetVariants(sessionState.extension || ''),
    ]);
    const matchesSpeakFirstTarget = Array.from(sessionTargetVariants).some((sessionTargetVariant) =>
      speakFirstTargetVariants.has(sessionTargetVariant),
    );

    if (!matchesSpeakFirstTarget) return;

    // Clear stale lock when consult session was not linked by id but clearly belongs to this target.
    speakFirstTransferRef.current = null;
    setActiveSpeakFirstTarget(null);
  }, []);

  const removeSessionAudioResources = useCallback((sessionId: string) => {
    const detachPeerListeners = peerConnectionCleanupRef.current[sessionId];
    if (detachPeerListeners) {
      detachPeerListeners();
      delete peerConnectionCleanupRef.current[sessionId];
    }

    const audioElementId = getSessionAudioElementId(sessionId);
    const targetElement =
      sessionAudioRef.current[sessionId] ?? document.getElementById(audioElementId);
    if (!(targetElement instanceof HTMLAudioElement)) {
      delete sessionAudioRef.current[sessionId];
      delete speakerStateRef.current[sessionId];
      return;
    }

    try {
      targetElement.pause();
      targetElement.srcObject = null;
      targetElement.remove();
    } catch {
      // Ignore audio cleanup failures and continue SIP teardown.
    }

    delete sessionAudioRef.current[sessionId];
    delete speakerStateRef.current[sessionId];
  }, []);

  const attachRemoteStreamToAudio = useCallback(
    (sessionId: string, stream: MediaStream) => {
      const audioElement = ensureSessionAudioElement(sessionId);
      if (!audioElement) return;

      if (audioElement.srcObject !== stream) {
        audioElement.srcObject = stream;
      }

      void audioElement.play().catch(() => undefined);
    },
    [ensureSessionAudioElement],
  );

  const bindPeerConnectionAudio = useCallback(
    (sessionId: string, peerConnection: RTCPeerConnection | null | undefined) => {
      if (!peerConnection) return;

      const existingCleanup = peerConnectionCleanupRef.current[sessionId];
      if (existingCleanup) {
        existingCleanup();
      }

      const attachStream = (stream: MediaStream | null | undefined) => {
        if (!stream) return;
        attachRemoteStreamToAudio(sessionId, stream);
      };

      if (typeof (peerConnection as any).getRemoteStreams === 'function') {
        const legacyStreams = (peerConnection as any).getRemoteStreams() as MediaStream[];
        if (legacyStreams?.[0]) {
          attachStream(legacyStreams[0]);
        }
      }

      const remoteAudioTracks = peerConnection
        .getReceivers()
        .map((receiver) => receiver.track)
        .filter((track): track is MediaStreamTrack => !!track && track.kind === 'audio');

      if (remoteAudioTracks.length) {
        attachStream(new MediaStream(remoteAudioTracks));
      }

      const onTrack = (event: RTCTrackEvent) => {
        if (event.streams?.[0]) {
          attachStream(event.streams[0]);
          return;
        }

        if (event.track?.kind !== 'audio') return;

        const audioElement = ensureSessionAudioElement(sessionId);
        if (!audioElement) return;

        const currentStream =
          audioElement.srcObject instanceof MediaStream
            ? audioElement.srcObject
            : new MediaStream();
        const alreadyExists = currentStream
          .getTracks()
          .some((track) => track.id === event.track.id);
        if (!alreadyExists) {
          currentStream.addTrack(event.track);
        }
        audioElement.srcObject = currentStream;
        void audioElement.play().catch(() => undefined);
      };

      const onAddStream = (event: Event) => {
        const streamEvent = event as Event & { stream?: MediaStream };
        attachStream(streamEvent.stream);
      };

      peerConnection.addEventListener('track', onTrack);
      peerConnection.addEventListener('addstream', onAddStream);

      peerConnectionCleanupRef.current[sessionId] = () => {
        peerConnection.removeEventListener('track', onTrack);
        peerConnection.removeEventListener('addstream', onAddStream);
      };
    },
    [attachRemoteStreamToAudio, ensureSessionAudioElement],
  );

  const registerSessionAudio = useCallback(
    (sessionId: string, session: any) => {
      ensureSessionAudioElement(sessionId);

      const syncConnectionAudio = () => {
        bindPeerConnectionAudio(sessionId, session?.connection);
      };

      session.on('peerconnection', ({ peerconnection }: { peerconnection: RTCPeerConnection }) => {
        bindPeerConnectionAudio(sessionId, peerconnection);
      });

      session.on('progress', syncConnectionAudio);
      session.on('accepted', syncConnectionAudio);
      session.on('confirmed', syncConnectionAudio);

      syncConnectionAudio();
    },
    [bindPeerConnectionAudio, ensureSessionAudioElement],
  );

  const switchActiveSession = useCallback(
    (sessionId: string) => {
      const targetSession = sessionRef.current[sessionId];
      if (!targetSession) return;

      Object.entries(sessionRef.current).forEach(([currentSessionId, session]) => {
        if (!session || currentSessionId === sessionId) return;

        try {
          const canHold = Boolean(session?.isEstablished?.());
          const isOnLocalHold = Boolean(session?.isOnHold?.()?.local);
          if (canHold && !isOnLocalHold) {
            session.hold();
          }
          if (canHold) {
            patchSession(currentSessionId, { isOnHold: true });
          }
        } catch (error: any) {
          setLastError(error?.message || 'Unable to hold background call session');
        }
      });

      try {
        const canUnhold = Boolean(targetSession?.isEstablished?.());
        const isOnLocalHold = Boolean(targetSession?.isOnHold?.()?.local);
        if (canUnhold && isOnLocalHold) {
          targetSession.unhold();
        }

        patchSession(sessionId, { isOnHold: false });
        setActiveSessionId(sessionId);
      } catch (error: any) {
        setLastError(error?.message || 'Unable to switch active call session');
      }
    },
    [patchSession],
  );

  const registerSessionListeners = useCallback(
    (sessionId: string, session: any, sessionDirection: SessionDirection) => {
      let iceCandidateReadyTimeout: ReturnType<typeof setTimeout> | null = null;
      let hasReleasedIceReady = false;

      const clearIceCandidateReadyTimeout = () => {
        if (!iceCandidateReadyTimeout) return;
        clearTimeout(iceCandidateReadyTimeout);
        iceCandidateReadyTimeout = null;
      };

      session.on('icecandidate', (candidateEvent: any) => {
        if (hasReleasedIceReady || typeof candidateEvent?.ready !== 'function') return;

        clearIceCandidateReadyTimeout();
        iceCandidateReadyTimeout = setTimeout(() => {
          if (hasReleasedIceReady) return;
          hasReleasedIceReady = true;
          candidateEvent.ready();
        }, ICE_CANDIDATE_READY_DEBOUNCE_MS);
      });

      const clearUnansweredIncomingSession = (wasActiveSession: boolean) => {
        clearIceCandidateReadyTimeout();
        removeSessionAudioResources(sessionId);
        delete sessionRef.current[sessionId];
        delete speakerStateRef.current[sessionId];
        clearSpeakFirstTransferBySession(sessionId);
        answeredSessionIdsRef.current.delete(sessionId);
        setCampaignContactCards(null);

        setSessions((prev) => {
          if (!prev[sessionId]) return prev;
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });

        if (!wasActiveSession) return;

        const fallbackSession =
          Object.values(sessionsStateRef.current)
            .filter((existingSession) => existingSession.id !== sessionId)
            .sort((left, right) => right.startedAt - left.startedAt)[0] || null;
        const fallbackSessionId = fallbackSession?.id ?? null;
        setActiveSessionId(fallbackSessionId);
      };

      session.on('connecting', () => patchSession(sessionId, { status: 'connecting' }));
      session.on('progress', () => {
        patchSession(sessionId, { status: 'ringing' });
        if (sessionDirection === 'incoming') {
          playIncomingRingtone(sessionId);
        }
      });
      session.on('accepted', () => {
        answeredSessionIdsRef.current.add(sessionId);
        stopIncomingRingtone(sessionId);
        patchSession(sessionId, {
          status: 'accepted',
          hasAnswered: true,
          connectedAt: sessionsStateRef.current[sessionId]?.connectedAt || Date.now(),
        });
      });
      session.on('confirmed', () => {
        answeredSessionIdsRef.current.add(sessionId);
        stopIncomingRingtone(sessionId);
        patchSession(sessionId, {
          status: 'confirmed',
          hasAnswered: true,
          connectedAt: sessionsStateRef.current[sessionId]?.connectedAt || Date.now(),
        });
      });
      session.on('hold', () => patchSession(sessionId, { isOnHold: true }));
      session.on('unhold', () => patchSession(sessionId, { isOnHold: false }));
      session.on('muted', (event: { audio?: boolean }) =>
        patchSession(sessionId, { isMuted: event?.audio ?? true }),
      );
      session.on('unmuted', (event: { audio?: boolean }) => {
        if (event?.audio === false) return;
        patchSession(sessionId, { isMuted: false });
      });
      session.on('newDTMF', () => undefined);
      session.on('newInfo', () => undefined);

      session.on('ended', (event: any) => {
        clearIceCandidateReadyTimeout();
        const wasActiveSession = activeSessionIdRef.current === sessionId;
        const sessionState = sessionsStateRef.current[sessionId];
        const shouldSwitchToMaxiOnSessionEnd =
          wasActiveSession && isCampaignOrQueueSession(sessionState);
        const shouldClearUnansweredIncomingSession =
          sessionDirection === 'incoming' &&
          !sessionState?.hasAnswered &&
          !answeredSessionIdsRef.current.has(sessionId);

        stopIncomingRingtone(sessionId);
        if (shouldClearUnansweredIncomingSession) {
          clearUnansweredIncomingSession(wasActiveSession);
          return;
        }

        patchSession(sessionId, {
          status: 'ended',
          isOnHold: false,
          isMuted: false,
          isRecording: false,
          endedAt: Date.now(),
          cause: event?.cause || 'ended',
          eventOriginator: event?.originator || 'system',
        });
        removeSessionAudioResources(sessionId);
        delete sessionRef.current[sessionId];
        delete speakerStateRef.current[sessionId];
        clearSpeakFirstTransferBySession(sessionId);
        answeredSessionIdsRef.current.delete(sessionId);

        if (!wasActiveSession) return;

        const remainingSessionIds = Object.keys(sessionRef.current);
        const fallbackSessionId = remainingSessionIds[remainingSessionIds.length - 1];

        if (fallbackSessionId) {
          switchActiveSession(fallbackSessionId);
          return;
        }

        if (shouldSwitchToMaxiOnSessionEnd) {
          setModalSize('maxi');
        }

        setActiveSessionId(sessionId);
      });

      session.on('failed', (event: any) => {
        clearIceCandidateReadyTimeout();
        const wasActiveSession = activeSessionIdRef.current === sessionId;
        const sessionState = sessionsStateRef.current[sessionId];
        const shouldSwitchToMaxiOnSessionEnd =
          wasActiveSession && isCampaignOrQueueSession(sessionState);
        const shouldClearUnansweredIncomingSession =
          sessionDirection === 'incoming' &&
          !sessionState?.hasAnswered &&
          !answeredSessionIdsRef.current.has(sessionId);

        stopIncomingRingtone(sessionId);
        if (shouldClearUnansweredIncomingSession) {
          clearUnansweredIncomingSession(wasActiveSession);
          return;
        }

        patchSession(sessionId, {
          status: 'failed',
          isOnHold: false,
          isMuted: false,
          isRecording: false,
          endedAt: Date.now(),
          cause: event?.cause || 'failed',
          eventOriginator: event?.originator || 'system',
        });
        removeSessionAudioResources(sessionId);
        delete sessionRef.current[sessionId];
        delete speakerStateRef.current[sessionId];
        clearSpeakFirstTransferBySession(sessionId);
        answeredSessionIdsRef.current.delete(sessionId);

        if (!wasActiveSession) return;

        const remainingSessionIds = Object.keys(sessionRef.current);
        const fallbackSessionId = remainingSessionIds[remainingSessionIds.length - 1];

        if (fallbackSessionId) {
          switchActiveSession(fallbackSessionId);
          return;
        }

        if (shouldSwitchToMaxiOnSessionEnd) {
          setModalSize('maxi');
        }

        setActiveSessionId(sessionId);
      });
    },
    [
      clearSpeakFirstTransferBySession,
      patchSession,
      playIncomingRingtone,
      removeSessionAudioResources,
      setCampaignContactCards,
      stopIncomingRingtone,
      switchActiveSession,
    ],
  );

  const registerUaListeners = useCallback(
    (ua: any) => {
      ua.on('connecting', () => {
        setUaStatus('connecting');
        setLastError(null);
      });

      ua.on('connected', () => {
        setUaStatus('connected');
        setLastError(null);
      });

      ua.on('disconnected', (event: any) => {
        setUaStatus('disconnected');
        setIsRegistered(false);
        setLastError(event?.reason || event?.cause || 'WebSocket disconnected');
        stopIncomingRingtone();
        Object.keys(sessionRef.current).forEach((sessionId) => {
          removeSessionAudioResources(sessionId);
        });
      });

      ua.on('registered', () => {
        setUaStatus('registered');
        setIsRegistered(true);
        setLastError(null);
      });

      ua.on('unregistered', () => {
        setUaStatus('unregistered');
        setIsRegistered(false);
      });

      ua.on('registrationFailed', (event: any) => {
        setUaStatus('registrationFailed');
        setIsRegistered(false);
        setLastError(event?.cause || 'Registration failed');
      });

      ua.on(
        'newRTCSession',
        ({
          originator,
          session,
          request,
        }: {
          originator: 'local' | 'remote';
          session: any;
          request: any;
        }) => {
          const sessionId =
            request?.call_id || session?._request?.call_id || session?.id || `${Date.now()}`;

          const remoteMetaData = parseRemoteMetaDataHeader(request);

          const identityRemoteNumber =
            session?.remote_identity?._uri?._user ||
            session?.remote_identity?.uri?.user ||
            session?._remote_identity?._uri?._user ||
            '';
          const identityRemoteName =
            session?.remote_identity?._display_name ||
            session?.remote_identity?.display_name ||
            session?._remote_identity?._display_name ||
            'Unknown';

          const remoteNumber =
            originator === 'remote'
              ? remoteMetaData.extension || identityRemoteNumber
              : identityRemoteNumber;
          const remoteName =
            originator === 'remote'
              ? remoteMetaData.username || identityRemoteName
              : identityRemoteName;

          const sessionDirection: SessionDirection =
            originator === 'local' ? 'outgoing' : 'incoming';

          const currentSpeakFirstTransfer = speakFirstTransferRef.current;
          if (
            originator === 'local' &&
            sessionDirection === 'outgoing' &&
            currentSpeakFirstTransfer &&
            !currentSpeakFirstTransfer.consultSessionId
          ) {
            const speakFirstTargetVariants = new Set(
              getDialTargetVariants(currentSpeakFirstTransfer.target),
            );
            const outgoingSessionTargetVariants = new Set([
              ...getDialTargetVariants(remoteNumber),
              ...getDialTargetVariants(remoteMetaData.extension || ''),
            ]);
            const isLikelyConsultSession = Array.from(outgoingSessionTargetVariants).some(
              (outgoingSessionTargetVariant) =>
                speakFirstTargetVariants.has(outgoingSessionTargetVariant),
            );

            if (isLikelyConsultSession) {
              speakFirstTransferRef.current = {
                ...currentSpeakFirstTransfer,
                consultSessionId: sessionId,
              };
            }
          }

          if (originator === 'remote') {
            setIsDialpadOpen(true);
            setModalSize('micro');
            playIncomingRingtone(sessionId);
          }

          sessionRef.current[sessionId] = session;
          speakerStateRef.current[sessionId] = true;
          /* A new incoming call must always surface unless the agent is
             genuinely mid-conversation on another call. The old check only
             asked "is some session tracked as active" - a ringing-but-
             unanswered session (this device's own earlier incoming leg that
             hasn't resolved yet, a stale reference, anything short of a real
             connected call) counted as "active" and silently blocked the new
             call from ever becoming visible: it rang (ringtone plays
             unconditionally above) but the UI kept showing whatever was
             already active, on that one device, while every other device
             with no such leftover state correctly showed it. */
          const currentActiveSessionId = activeSessionIdRef.current;
          const currentActiveSessionStatus = currentActiveSessionId
            ? String(sessionsStateRef.current[currentActiveSessionId]?.status || '').toLowerCase()
            : '';
          const isActiveSessionTrulyConnected =
            !!currentActiveSessionId &&
            !!sessionRef.current[currentActiveSessionId] &&
            ['accepted', 'confirmed'].includes(currentActiveSessionStatus);
          const shouldSetAsActive = originator === 'local' || !isActiveSessionTrulyConnected;
          if (shouldSetAsActive) {
            setActiveSessionId(sessionId);
          }

          const sessionHeaders = extractSessionHeaders(request);
          const sessionExtraHeaders = extractSessionExtraHeaders(
            request,
            originator === 'local' ? [sessionMetaDataHeader] : [],
          );
          /* Same two names for one id: X-Queue on the caller's leg,
             X-ForwardValue on the agent's. Without this the agent's session
             got no queueMetaData, so dispositions, call script and the
             queue's wrap-up time never loaded. */
          const queueIdFromHeader = queueIdFromHeaders((name) =>
            getHeaderValueFromHeaders(sessionHeaders, name),
          );
          const queueMetaData = queueIdFromHeader
            ? {
                id: queueIdFromHeader,
                response: null,
              }
            : null;
          const campaignIdFromHeader = getHeaderValueFromHeaders(sessionHeaders, 'x-campaignuuid');
          const campaignMetaData = campaignIdFromHeader
            ? {
                id: campaignIdFromHeader,
                response: null,
              }
            : null;

          setSessions((prev) => ({
            ...prev,
            [sessionId]: {
              id: sessionId,
              direction: sessionDirection,
              status: sessionDirection === 'incoming' ? 'incoming' : 'calling',
              isOnHold: false,
              isMuted: false,
              isSpeakerOn: true,
              isRecording: false,
              hasAnswered: false,
              username: originator === 'remote' ? remoteMetaData.username : undefined,
              email: originator === 'remote' ? remoteMetaData.email : undefined,
              extension: originator === 'remote' ? remoteMetaData.extension : undefined,
              remoteName,
              remoteNumber,
              startedAt: Date.now(),
              headers: sessionHeaders,
              extraHeaders: sessionExtraHeaders,
              queueMetaData,
              campaignMetaData,
              liveCallData: null,
              transcriptionHasStarted: 'stop',
              transcriptionMessages: [],
            },
          }));

          if (queueIdFromHeader) {
            void fetchQueueMetaDataById(queueIdFromHeader, sessionId);
          }
          if (campaignIdFromHeader) {
            void fetchCampaignMetaDataById(campaignIdFromHeader, sessionId);
          }

          registerSessionAudio(sessionId, session);
          registerSessionListeners(sessionId, session, sessionDirection);
        },
      );
    },
    [
      fetchCampaignMetaDataById,
      fetchQueueMetaDataById,
      playIncomingRingtone,
      registerSessionAudio,
      registerSessionListeners,
      removeSessionAudioResources,
      sessionMetaDataHeader,
      stopIncomingRingtone,
    ],
  );

  const disconnectSip = useCallback(() => {
    const ua = uaRef.current;
    if (ua) {
      try {
        ua.stop();
      } catch (error: any) {
        setLastError(error?.message || 'Error while stopping JsSIP UA');
      }
    }

    Object.keys(sessionRef.current).forEach((sessionId) => {
      removeSessionAudioResources(sessionId);
    });
    stopIncomingRingtone();

    uaRef.current = null;
    sessionRef.current = {};
    queueMetaDataCacheRef.current = {};
    queueMetaDataRequestRef.current = {};
    campaignMetaDataCacheRef.current = {};
    campaignMetaDataRequestRef.current = {};
    sessionContactInfoCacheRef.current = {};
    sessionContactInfoRequestRef.current = {};
    speakFirstTransferRef.current = null;
    setActiveSpeakFirstTarget(null);
    credentialKeyRef.current = null;
    setSessions({});
    setActiveSessionId(null);
    setUaStatus('stopped');
    setIsRegistered(false);
  }, [removeSessionAudioResources, stopIncomingRingtone]);

  const connectSip = useCallback(() => {
    if (!sipCredentials) {
      setLastError('Missing sip_credentials. Unable to initialize JsSIP UA.');
      return;
    }

    if (isStartingRef.current) return;

    const credentialKey = `${sipCredentials.wss_url}|${sipCredentials.domain}|${sipCredentials.extension}`;

    if (uaRef.current && credentialKeyRef.current !== credentialKey) {
      disconnectSip();
    }

    if (uaRef.current) {
      const alreadyConnected = uaRef.current?.isConnected?.() || uaRef.current?.isRegistered?.();

      if (alreadyConnected) return;

      try {
        isStartingRef.current = true;
        uaRef.current.start();
      } catch (error: any) {
        setUaStatus('disconnected');
        setIsRegistered(false);
        setLastError(error?.message || 'Failed to restart JsSIP');
      } finally {
        isStartingRef.current = false;
      }
      return;
    }

    try {
      isStartingRef.current = true;

      const wssUrl = `${sipCredentials.wss_url || ''}`.trim();
      if (!wssUrl) {
        setLastError('Invalid WSS URL in sip_credentials');
        return;
      }

      const domain = `${sipCredentials.domain || ''}`.trim();
      const extension = `${sipCredentials.extension || ''}`.trim();
      const password = `${sipCredentials.password || ''}`.trim();
      if (!domain || !extension || !password) {
        setLastError('Incomplete SIP credentials (domain/extension/password)');
        return;
      }

      JsSIP.debug.disable();
      const socket = new JsSIP.WebSocketInterface(wssUrl);
      socket.via_transport = 'tcp';
      const ua = new JsSIP.UA({
        sockets: [socket],
        uri: `sip:${extension}_web@${domain}`,
        password,
        session_timers: false,
        registrar_server: `sip:${domain}`,
        /* Puts the caller's name in the SIP From header, so an internal call
           arrives as `"Umar Ansari" <sip:1010_web@...>` rather than the bare
           extension. The name was already being sent, but only in the custom
           remoteMetaData header — and a proxy that strips unknown headers left
           the other side reading "Unknown". From is standard and survives. */
        display_name: outboundDisplayName,
      });

      uaRef.current = ua;
      credentialKeyRef.current = credentialKey;
      registerUaListeners(ua);
      ua.start();
    } catch (error: any) {
      setUaStatus('disconnected');
      setIsRegistered(false);
      setLastError(error?.message || 'Failed to initialize JsSIP');
    } finally {
      isStartingRef.current = false;
    }
  }, [disconnectSip, outboundDisplayName, registerUaListeners, sipCredentials]);

  const registerUa = useCallback(() => {
    try {
      const ua = uaRef.current;
      if (!ua) return;
      if (ua?.isRegistered?.() || isRegistered) return;
      if (!(ua?.isConnected?.() || uaStatus === 'connected')) return;
      ua.register();
    } catch (error: any) {
      setLastError(error?.message || 'Unable to register UA');
    }
  }, [isRegistered, uaStatus]);

  const unregisterUa = useCallback(() => {
    try {
      uaRef.current?.unregister({ all: true });
    } catch (error: any) {
      setLastError(error?.message || 'Unable to unregister UA');
    }
  }, []);

  const makeCall = useCallback(
    (target: string, makeCallOptions?: DialpadMakeCallOptions) => {
      const normalizedTarget = normalizeOutgoingDialTarget(target);
      if (!normalizedTarget) return false;

      if (makeCallOptions?.forceRefreshContactInfo) {
        invalidateSessionContactInfoCache(normalizedTarget);
        invalidateSessionContactInfoCache(target);
      }

      const normalizedUserExtension = normalizeSelfCallTarget(
        outboundUserName || sipCredentials?.extension,
      );
      const normalizedDialTarget = normalizeSelfCallTarget(target);
      if (
        normalizedUserExtension &&
        normalizedDialTarget &&
        normalizedUserExtension === normalizedDialTarget
      ) {
        setLastError(SELF_CALL_ERROR_MESSAGE);
        handleAlert({ text: SELF_CALL_ERROR_MESSAGE, type: 'error' });
        return false;
      }

      const targetVariants = new Set(getDialTargetVariants(normalizedTarget));
      const hasMatchingLiveSession = Object.values(sessionsStateRef.current)
        .filter((session) => isLiveSessionStatus(session.status))
        .some((session) => {
          const sessionTargetVariants = new Set([
            ...getDialTargetVariants(session.remoteNumber),
            ...getDialTargetVariants(session.extension || ''),
          ]);

          return Array.from(sessionTargetVariants).some((variant) => targetVariants.has(variant));
        });

      if (hasMatchingLiveSession) {
        setLastError(DUPLICATE_CALL_ERROR_MESSAGE);
        handleAlert({ text: DUPLICATE_CALL_ERROR_MESSAGE, type: 'error' });
        return false;
      }

      const ua = uaRef.current;
      if (!ua || !sipCredentials) {
        setLastError('UA is not connected. Call connectSip() first.');
        return false;
      }

      if (!isRegistered) {
        setLastError('UA is not registered yet. Please wait for SIP registration.');
        return false;
      }

      const pcConfig = buildPcConfig(sipCredentials);
      const campaignAutomaticRecordingEnabled = Boolean(
        activeCampaign?.settings?.recording?.automatic?.enabled,
      );
      const hasCampaignUuidHeader = (makeCallOptions?.extraHeaders ?? []).some((header) =>
        String(header || '')
          .trim()
          .toLowerCase()
          .startsWith('x-campaignuuid:'),
      );
      const normalizedActiveCampaignDialMethod = String(
        activeCampaign?.dialMethod || activeCampaign?.campaignType || '',
      )
        .trim()
        .toUpperCase();
      const campaignHoldMusicValue = String(
        activeCampaign?.settings?.media?.hold?.value || '',
      ).trim();
      const campaignHoldMusicEnabled =
        activeCampaign?.settings?.media?.hold?.enabled === true ||
        String(activeCampaign?.settings?.media?.hold?.enabled || '')
          .trim()
          .toLowerCase() === 'true';
      const isPreviewOrProgressiveCampaign =
        normalizedActiveCampaignDialMethod === 'PREVIEW' ||
        normalizedActiveCampaignDialMethod === 'PROGRESSIVE';
      const isCampaignCallRequest = Boolean(
        activeCampaign && campaignAutomaticRecordingEnabled && hasCampaignUuidHeader,
      );
      const mergedExtraHeaders = Array.from(
        new Set(
          [sessionMetaDataHeader, ...(makeCallOptions?.extraHeaders ?? [])]
            .map((header) => header?.trim())
            .filter((header): header is string => Boolean(header)),
        ),
      );
      if (
        isCampaignCallRequest &&
        !mergedExtraHeaders.some((header) =>
          String(header || '')
            .trim()
            .toLowerCase()
            .startsWith('x-record:'),
        )
      ) {
        mergedExtraHeaders.push(`X-Record: ${String(campaignAutomaticRecordingEnabled)}`);
      }
      if (
        activeCampaign &&
        hasCampaignUuidHeader &&
        isPreviewOrProgressiveCampaign &&
        campaignHoldMusicEnabled &&
        campaignHoldMusicValue &&
        !mergedExtraHeaders.some((header) =>
          String(header || '')
            .trim()
            .toLowerCase()
            .startsWith('x-holdmusic:'),
        )
      ) {
        mergedExtraHeaders.push(`X-HoldMusic: ${campaignHoldMusicValue}`);
      }

      const options: any = {
        mediaConstraints: { audio: true, video: false },
        RTCConstraints: {
          optional: [{ DtlsSrtpKeyAgreement: 'false' }],
        },
        rtcOfferConstraints: {
          offerToReceiveAudio: 1,
          offerToReceiveVideo: 0,
        },
        extraHeaders: mergedExtraHeaders,
        fromDisplayName: outboundDisplayName,
      };

      if (outboundUserName) {
        options.fromUserName = outboundUserName;
      }

      if (pcConfig) {
        options.pcConfig = pcConfig;
      }

      try {
        setIsDialpadOpen(true);
        if (makeCallOptions?.size) {
          setModalSize(makeCallOptions.size);
        } else {
          setModalSize((prev) => (prev === 'maxi' ? 'maxi' : 'mini'));
        }

        const currentActiveId = activeSessionIdRef.current;
        if (currentActiveId) {
          const currentActiveSession = sessionRef.current[currentActiveId];
          const canHoldCurrent = Boolean(currentActiveSession?.isEstablished?.());
          const currentIsOnHold = Boolean(currentActiveSession?.isOnHold?.()?.local);

          if (canHoldCurrent && !currentIsOnHold) {
            currentActiveSession.hold();
            patchSession(currentActiveId, { isOnHold: true });
          }
        }

        ua.call(normalizedTarget, options);
        return true;
      } catch (error: any) {
        setLastError(error?.message || 'Call failed to start');
        return false;
      }
    },
    [
      activeCampaign,
      invalidateSessionContactInfoCache,
      isRegistered,
      outboundDisplayName,
      outboundUserName,
      patchSession,
      sessionMetaDataHeader,
      sipCredentials,
    ],
  );

  const answerCall = useCallback(
    (sessionId: string) => {
      const session = sessionRef.current[sessionId];
      if (!session) return;
      answeredSessionIdsRef.current.add(sessionId);
      patchSession(sessionId, { hasAnswered: true });
      stopIncomingRingtone(sessionId);
      switchActiveSession(sessionId);
      ensureSessionAudioElement(sessionId);
      bindPeerConnectionAudio(sessionId, session?.connection);

      session.answer();
    },
    [
      bindPeerConnectionAudio,
      ensureSessionAudioElement,
      patchSession,
      stopIncomingRingtone,
      switchActiveSession,
    ],
  );

  const endCall = useCallback(
    (sessionId: string) => {
      const session = sessionRef.current[sessionId];
      if (!session) return;
      stopIncomingRingtone(sessionId);
      session.terminate();
    },
    [stopIncomingRingtone],
  );

  const muteCall = useCallback(
    (sessionId: string) => {
      const session = sessionRef.current[sessionId];
      if (!session) return;
      patchSession(sessionId, { isMuted: true });
      session.mute({ audio: true });
    },
    [patchSession],
  );

  const unmuteCall = useCallback(
    (sessionId: string) => {
      const session = sessionRef.current[sessionId];
      if (!session) return;
      patchSession(sessionId, { isMuted: false });
      session.unmute({ audio: true });
    },
    [patchSession],
  );

  const holdCall = useCallback(
    (sessionId: string) => {
      const session = sessionRef.current[sessionId];
      if (!session) return;
      patchSession(sessionId, { isOnHold: true });
      session.hold();
    },
    [patchSession],
  );

  const unholdCall = useCallback(
    (sessionId: string) => {
      const session = sessionRef.current[sessionId];
      if (!session) return;
      patchSession(sessionId, { isOnHold: false });
      session.unhold();
    },
    [patchSession],
  );

  const toggleSpeakerCall = useCallback(
    (sessionId: string) => {
      const currentSpeakerState = speakerStateRef.current[sessionId] ?? true;
      const nextSpeakerState = !currentSpeakerState;
      speakerStateRef.current[sessionId] = nextSpeakerState;

      const audioElement = ensureSessionAudioElement(sessionId);
      if (audioElement) {
        audioElement.muted = !nextSpeakerState;
      }

      patchSession(sessionId, { isSpeakerOn: nextSpeakerState });
    },
    [ensureSessionAudioElement, patchSession],
  );

  const clearSession = useCallback(
    (sessionId: string) => {
      const targetSession = sessions[sessionId];
      if (!targetSession) return;

      if (isLiveSessionStatus(targetSession.status)) {
        setLastError('Only ended or failed sessions can be cleared.');
        return;
      }

      removeSessionAudioResources(sessionId);
      delete sessionRef.current[sessionId];
      delete speakerStateRef.current[sessionId];
      answeredSessionIdsRef.current.delete(sessionId);
      clearSpeakFirstTransferBySession(sessionId);

      setSessions((prev) => {
        if (!prev[sessionId]) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });

      if (activeSessionIdRef.current !== sessionId) return;

      const fallbackSession = Object.values(sessions)
        .filter((session) => session.id !== sessionId)
        .sort((left, right) => right.startedAt - left.startedAt)[0];

      setActiveSessionId(fallbackSession?.id ?? null);
    },
    [clearSpeakFirstTransferBySession, removeSessionAudioResources, sessions],
  );

  const clearAllSessions = useCallback(() => {
    Object.entries(sessionRef.current).forEach(([sessionId, session]) => {
      stopIncomingRingtone(sessionId);
      try {
        session.terminate();
      } catch {
        // Ignore termination errors while force-clearing sessions.
      }
      removeSessionAudioResources(sessionId);
      delete speakerStateRef.current[sessionId];
      answeredSessionIdsRef.current.delete(sessionId);
    });

    sessionRef.current = {};
    answeredSessionIdsRef.current.clear();
    sessionContactInfoCacheRef.current = {};
    sessionContactInfoRequestRef.current = {};
    speakFirstTransferRef.current = null;
    setActiveSpeakFirstTarget(null);
    setSessions({});
    setActiveSessionId(null);
  }, [removeSessionAudioResources, stopIncomingRingtone]);

  const handleTransfer = useCallback(
    (type: DialpadTransferType, number: string) => {
      const normalizedNumber = normalizeDialTarget(number);
      if (!normalizedNumber) {
        setLastError('Session is already running');
        return;
      }

      const liveSessionEntries = Object.entries(sessions).filter(([, session]) =>
        isLiveSessionStatus(session.status),
      );

      const matchingLiveSessionEntries = liveSessionEntries.filter(([, session]) => {
        const normalizedRemoteNumber = normalizeDialTarget(session.remoteNumber);
        const normalizedExtension = normalizeDialTarget(session.extension || '');
        return (
          normalizedRemoteNumber === normalizedNumber || normalizedExtension === normalizedNumber
        );
      });

      const buildReferTarget = (target: string) =>
        sipCredentials?.domain && !target.toLowerCase().startsWith('sip:')
          ? `sip:${target}@${sipCredentials.domain}`
          : target;

      if (type === 'speak_first') {
        if (matchingLiveSessionEntries.length > 0) {
          setLastError('Session is already running');
          return;
        }

        const activeSessionId = activeSessionIdRef.current;
        const activeSession = activeSessionId ? sessionRef.current[activeSessionId] : null;

        const establishedSessionEntries = Object.entries(sessionRef.current).filter(([, session]) =>
          session?.isEstablished?.(),
        );

        const sourceSessionEntry =
          activeSessionId && activeSession?.isEstablished?.()
            ? ([activeSessionId, activeSession] as const)
            : (establishedSessionEntries[0] as [string, any] | undefined);

        if (!sourceSessionEntry) {
          setLastError('No active call available for speak first transfer');
          return;
        }

        const [sourceSessionId, sourceSession] = sourceSessionEntry;

        try {
          const isOnLocalHold = Boolean(sourceSession?.isOnHold?.()?.local);
          if (!isOnLocalHold) {
            const holdResult = sourceSession.hold?.();
            if (holdResult === false) {
              setLastError('Unable to hold active call for speak first transfer');
              return;
            }
            patchSession(sourceSessionId, { isOnHold: true });
          }

          speakFirstTransferRef.current = {
            mainSessionId: sourceSessionId,
            target: normalizedNumber,
            startedAt: Date.now(),
          };
          setActiveSpeakFirstTarget(normalizedNumber);
          setLastError(null);
          const didStartConsultCall = makeCall(normalizedNumber);
          if (!didStartConsultCall) {
            speakFirstTransferRef.current = null;
            setActiveSpeakFirstTarget(null);
          }
          return;
        } catch (error: any) {
          setLastError(error?.message || 'Unable to start speak first transfer');
          setActiveSpeakFirstTarget(null);
          return;
        }
      }

      if (type === 'transfer_now') {
        const currentSpeakFirstTransfer = speakFirstTransferRef.current;
        const isMatchingSpeakFirstTarget =
          currentSpeakFirstTransfer &&
          normalizeDialTarget(currentSpeakFirstTransfer.target) === normalizedNumber;

        if (isMatchingSpeakFirstTarget) {
          const mainSession = sessionRef.current[currentSpeakFirstTransfer.mainSessionId];
          let consultSessionId = currentSpeakFirstTransfer.consultSessionId;

          if (!consultSessionId) {
            consultSessionId =
              matchingLiveSessionEntries
                .map(([sessionId]) => sessionId)
                .find(
                  (sessionId) =>
                    sessionId !== currentSpeakFirstTransfer.mainSessionId &&
                    Boolean(sessionRef.current[sessionId]?.isEstablished?.()),
                ) || undefined;

            if (consultSessionId) {
              speakFirstTransferRef.current = {
                ...currentSpeakFirstTransfer,
                consultSessionId,
              };
            }
          }

          const consultSession = consultSessionId ? sessionRef.current[consultSessionId] : null;

          if (!mainSession?.refer || !consultSession?.isEstablished?.()) {
            setLastError('No consult call available for attended transfer');
            return;
          }

          const consultTarget =
            consultSession?.remote_identity?.uri ||
            consultSession?.remote_identity?._uri ||
            consultSession?._remote_identity?.uri ||
            consultSession?._remote_identity?._uri ||
            buildReferTarget(normalizedNumber);

          try {
            mainSession.refer(consultTarget, {
              replaces: consultSession,
              eventHandlers: {
                trying: () => {
                  setLastError(null);
                  console.log('[DialpadTransfer] trying', { type, target: normalizedNumber });
                },
                progress: () => {
                  console.log('[DialpadTransfer] progress', { type, target: normalizedNumber });
                },
                accepted: () => {
                  speakFirstTransferRef.current = null;
                  setActiveSpeakFirstTarget(null);
                  setLastError(null);
                  console.log('[DialpadTransfer] accepted', { type, target: normalizedNumber });
                },
                failed: (event: any) => {
                  setLastError(event?.cause || 'Attended transfer failed');
                },
                requestSucceeded: () => {
                  speakFirstTransferRef.current = null;
                  setActiveSpeakFirstTarget(null);
                  setLastError(null);
                  console.log('[DialpadTransfer] requestSucceeded', {
                    type,
                    target: normalizedNumber,
                  });
                },
                requestFailed: (event: any) => {
                  setLastError(event?.cause || 'Attended transfer request failed');
                },
              },
            });
            return;
          } catch (error: any) {
            setLastError(error?.message || 'Unable to complete attended transfer');
            return;
          }
        }

        if (matchingLiveSessionEntries.length > 0) {
          setLastError('Session is already running');
          return;
        }

        const activeTransferSessionCandidate = activeSessionIdRef.current
          ? sessionRef.current[activeSessionIdRef.current]
          : null;
        const activeTransferSession = activeTransferSessionCandidate?.isEstablished?.()
          ? activeTransferSessionCandidate
          : null;
        const fallbackTransferSession =
          Object.values(sessionRef.current).find((session: any) => session?.isEstablished?.()) ||
          null;
        const transferSession = activeTransferSession || fallbackTransferSession;

        if (!transferSession?.refer) {
          setLastError('No active call available for transfer');
          return;
        }

        const referTarget = buildReferTarget(normalizedNumber);

        try {
          transferSession.refer(referTarget, {
            eventHandlers: {
              trying: () => {
                setLastError(null);
                console.log('[DialpadTransfer] trying', { type, target: referTarget });
              },
              progress: () => {
                console.log('[DialpadTransfer] progress', { type, target: referTarget });
              },
              accepted: () => {
                console.log('[DialpadTransfer] accepted', { type, target: referTarget });
              },
              failed: (event: any) => {
                setLastError(event?.cause || 'Transfer failed');
              },
              requestSucceeded: () => {
                setLastError(null);
                console.log('[DialpadTransfer] requestSucceeded', { type, target: referTarget });
              },
              requestFailed: (event: any) => {
                setLastError(event?.cause || 'Transfer request failed');
              },
            },
          });
          return;
        } catch (error: any) {
          setLastError(error?.message || 'Unable to transfer call');
          return;
        }
      }

      console.log('[DialpadTransfer]', { type, number: normalizedNumber });
    },
    [makeCall, patchSession, sessions, sipCredentials?.domain],
  );

  const handleTranscription = useCallback(
    (
      session: DialpadSession | null,
      transcriptionType: DialpadTranscriptionStatus,
      transcriptMessage?: Partial<DialpadTranscriptMessage> | null,
    ) => {
      if (!session?.id) return;

      setSessions((prev) => {
        const existingSession = prev[session.id];
        if (!existingSession) return prev;

        const nextTranscriptionMessages = [...(existingSession.transcriptionMessages || [])];

        if (transcriptMessage) {
          const incomingId = transcriptMessage?.id;
          const mappedAtTimestamp = new Date().toISOString();
          const normalizedMessage: DialpadTranscriptMessage = {
            id: incomingId ?? `${Date.now()}`,
            speaker: transcriptMessage?.speaker,
            speakerIndex: transcriptMessage?.speakerIndex ?? null,
            speakerDetails: transcriptMessage?.speakerDetails,
            msg: transcriptMessage?.msg || '',
            sipCallId: transcriptMessage?.sipCallId,
            requestId: transcriptMessage?.requestId,
            // Always use local mapped time instead of provider start_time.
            start_time: mappedAtTimestamp,
            answered_time: transcriptMessage?.answered_time,
            mode: transcriptMessage?.mode,
            language: transcriptMessage?.language,
          };

          const existingMessageIndex = nextTranscriptionMessages.findIndex(
            (message) => String(message.id) === String(normalizedMessage.id),
          );

          if (existingMessageIndex >= 0) {
            const existingMessage = nextTranscriptionMessages[existingMessageIndex];
            nextTranscriptionMessages[existingMessageIndex] = {
              ...existingMessage,
              ...normalizedMessage,
              // Preserve initial mapped timestamp for message updates with same id.
              start_time: existingMessage?.start_time || mappedAtTimestamp,
            };
          } else {
            nextTranscriptionMessages.push(normalizedMessage);
          }
        }

        return {
          ...prev,
          [session.id]: {
            ...existingSession,
            transcriptionHasStarted: transcriptionType,
            transcriptionMessages: nextTranscriptionMessages,
          },
        };
      });
    },
    [],
  );

  const getMatchedLiveCallBySession = useCallback(
    (liveCallsArray: any[], session: DialpadSession | null) => {
      if (!session) return null;
      if (!Array.isArray(liveCallsArray)) return session.liveCallData || null;

      const sessionSipCallId =
        session.direction === 'incoming'
          ? getSessionHeaderValue(session, 'x-cid')
          : getSessionHeaderValue(session, 'call-id');

      if (!sessionSipCallId) return session.liveCallData || null;

      const normalizedSessionSipCallId = sessionSipCallId.toLowerCase();
      const matchedLiveCall =
        liveCallsArray.find((liveCall) => {
          const isQueueCall = String(liveCall?.call_type || '').toLowerCase() === 'queue';
          const liveCallSipCallId = String(
            isQueueCall ? liveCall?.call_uuid : liveCall?.sip_call_id,
          ).trim();
          if (!liveCallSipCallId) return false;
          return (
            liveCallSipCallId === sessionSipCallId ||
            liveCallSipCallId.toLowerCase() === normalizedSessionSipCallId
          );
        }) || null;

      if (!matchedLiveCall) {
        return session.liveCallData || null;
      }

      setSessions((prev) => {
        const existingSession = prev[session.id];
        if (!existingSession) return prev;

        if (isLiveCallEqual(existingSession.liveCallData, matchedLiveCall)) {
          return prev;
        }

        return {
          ...prev,
          [session.id]: {
            ...existingSession,
            liveCallData: matchedLiveCall,
          },
        };
      });

      return matchedLiveCall;
    },
    [],
  );

  const updateConferenceDataBySipCallIds = useCallback((conferenceData: any) => {
    const getNormalizedConferenceId = (data: any) =>
      String(data?.conference_id || data?.conferenceId || data?.confID || data?.confId || '')
        .trim()
        .toLowerCase();

    const getNormalizedSipCallIds = (data: any) => {
      const sipCallIds = Array.isArray(data?.sip_call_ids) ? data.sip_call_ids : [];

      return new Set(
        [...sipCallIds, data?.sip_call_id, data?.sipCallId, data?.SipCallID, data?.['SipCallID']]
          .map((sipCallId: unknown) =>
            String(sipCallId || '')
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      );
    };

    const normalizedConferenceId = getNormalizedConferenceId(conferenceData);
    const normalizedSipCallIdSet = getNormalizedSipCallIds(conferenceData);

    // Subsequent conference updates can be membership-only payloads. Those do not
    // always include sip_call_ids, but they do retain the conference identifier.
    if (!normalizedConferenceId && !normalizedSipCallIdSet.size) return;

    setSessions((prev) => {
      let hasChanges = false;
      const nextSessions: Record<string, DialpadSession> = { ...prev };

      Object.entries(prev).forEach(([sessionId, currentSession]) => {
        const currentConferenceId = getNormalizedConferenceId(currentSession.conferenceData);
        const hasMatchingConferenceId =
          Boolean(normalizedConferenceId) && normalizedConferenceId === currentConferenceId;
        const normalizedSessionSipIds = new Set([
          ...getNormalizedSipCallIds(currentSession.conferenceData),
          ...getNormalizedSipCallIds(currentSession.liveCallData),
          getSessionHeaderValue(currentSession, 'x-cid'),
          getSessionHeaderValue(currentSession, 'call-id'),
        ]);
        const hasMatchingSipCallId = [...normalizedSessionSipIds]
          .map((sessionSipId) =>
            String(sessionSipId || '')
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean)
          .some((sessionSipId) => normalizedSipCallIdSet.has(sessionSipId));
        if (!hasMatchingConferenceId && !hasMatchingSipCallId) return;

        hasChanges = true;
        nextSessions[sessionId] = {
          ...currentSession,
          conferenceData: {
            ...(currentSession.conferenceData || {}),
            ...conferenceData,
          },
        };
      });

      return hasChanges ? nextSessions : prev;
    });
  }, []);

  const sendDtmf = useCallback((sessionId: string, tone: string) => {
    const session = sessionRef.current[sessionId];
    if (!session || !tone) return;
    session.sendDTMF(tone, {
      duration: 100,
      interToneGap: 500,
      transportType: 'INFO',
    });
  }, []);

  // Ask the switch whether this live call is recording (and whether it is
  // locked by automatic recording), so the Record button reflects reality on
  // every call, inbound or outbound, regardless of the agent's own settings.
  useEffect(() => {
    Object.entries(sessions).forEach(([sessionId, sess]: [string, any]) => {
      const st = String(sess?.status || '').toLowerCase();
      if (
        (st === 'accepted' || st === 'confirmed' || st === 'connected') &&
        !recordingStatusCheckedRef.current.has(sessionId)
      ) {
        recordingStatusCheckedRef.current.add(sessionId);
        const s = sessionRef.current[sessionId];
        const sipCallId = s?._request?.call_id || s?.id || sessionId;
        const token = localStorage.getItem(SESSION_NAME) || '';
        fetch(`${getEnv().VITE_API_BASE_URL}/api/internal/recording-control/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sip_call_id: sipCallId, action: 'status' }),
        })
          .then((r) => r.json().catch(() => ({})))
          .then((res: any) => {
            if (res && res.success) {
              patchSession(sessionId, {
                isRecording: !!res.recording,
                recordingLocked: !!res.locked,
              });
            }
          })
          .catch(() => {});
      }
    });
    recordingStatusCheckedRef.current.forEach((id) => {
      if (!sessions[id]) recordingStatusCheckedRef.current.delete(id);
    });
  }, [sessions, patchSession]);

  const toggleRecordingCall = useCallback(
    (sessionId: string) => {
      const session = sessionRef.current[sessionId];
      const sessionState = sessions[sessionId];
      if (!session || !sessionState) return;
      if (!isLiveSessionStatus(sessionState.status)) return;
      if ((sessionState as any).recordingLocked) return;

      const shouldStartRecording = !sessionState.isRecording;
      // The SIP Call-ID FreeSWITCH stores as sip_call_id, so the server can find
      // this exact live channel. DTMF does not survive this WebRTC path, so the
      // Record button asks the server to toggle recording instead of sending a tone.
      const sipCallId =
        session?._request?.call_id || session?.id || sessionId;

      // Optimistic UI; roll back if the server rejects.
      patchSession(sessionId, { isRecording: shouldStartRecording });

      try {
        const token = localStorage.getItem(SESSION_NAME) || '';
        fetch(`${getEnv().VITE_API_BASE_URL}/api/internal/recording-control/toggle`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            sip_call_id: sipCallId,
            action: shouldStartRecording ? 'start' : 'stop',
          }),
        })
          .then((response) => response.json().catch(() => ({})))
          .then((result: any) => {
            if (!result?.success) {
              patchSession(sessionId, { isRecording: !shouldStartRecording });
              setLastError(
                result?.message ||
                  (shouldStartRecording
                    ? 'Unable to start recording'
                    : 'Unable to stop recording'),
              );
            }
          })
          .catch((error: any) => {
            patchSession(sessionId, { isRecording: !shouldStartRecording });
            setLastError(error?.message || 'Unable to toggle recording');
          });
      } catch (error: any) {
        patchSession(sessionId, { isRecording: !shouldStartRecording });
        setLastError(error?.message || 'Unable to toggle recording');
      }
    },
    [patchSession, sessions],
  );

  useEffect(() => {
    if (!sipCredentials) {
      if (uaRef.current) disconnectSip();
      return;
    }

    connectSip();
  }, [connectSip, disconnectSip, sipCredentials]);

  useEffect(() => {
    if (activeCampaign) {
      clearCampaignClearingTimer();
    }
  }, [activeCampaign, clearCampaignClearingTimer]);

  useEffect(() => {
    return () => {
      clearCampaignClearingTimer(false);
      Object.keys(sessionAudioRef.current).forEach((sessionId) => {
        removeSessionAudioResources(sessionId);
      });
      stopIncomingRingtone();
      const incomingRingtoneElement =
        incomingRingtoneRef.current ?? document.getElementById(INCOMING_RINGTONE_AUDIO_ID);
      if (incomingRingtoneElement instanceof HTMLAudioElement) {
        try {
          incomingRingtoneElement.pause();
          incomingRingtoneElement.srcObject = null;
          incomingRingtoneElement.remove();
        } catch {
          // Ignore ringtone element removal failures.
        }
      }
      incomingRingtoneRef.current = null;
    };
  }, [clearCampaignClearingTimer, removeSessionAudioResources, stopIncomingRingtone]);

  return (
    <DialpadContext.Provider
      value={{
        isDialpadOpen,
        setIsDialpadOpen,
        openDialpad,
        closeDialpad,
        toggleDialpad,
        modalSize,
        setModalSize,
        sipCredentials,
        uaStatus,
        isRegistered,
        lastError,
        campaignContactCards,
        setCampaignContactCards,
        joinedCampaignId,
        setJoinedCampaignId,
        activeCampaign,
        setActiveCampaign,
        campaignClearingSecondsLeft,
        startCampaignClearingTimer,
        activeQueueData,
        setActiveQueueData,
        sessions,
        activeSessionId,
        setActiveSessionId,
        connectSip,
        disconnectSip,
        registerUa,
        unregisterUa,
        makeCall,
        answerCall,
        endCall,
        muteCall,
        unmuteCall,
        holdCall,
        unholdCall,
        toggleSpeakerCall,
        switchActiveSession,
        clearSession,
        clearAllSessions,
        activeSpeakFirstTarget,
        handleTransfer,
        handleTranscription,
        getMatchedLiveCallBySession,
        ensureSessionContactInfo,
        refreshSessionContactInfo,
        updateConferenceDataBySipCallIds,
        toggleRecordingCall,
        sendDtmf,
        patchSessionAiInfo,
        dialpadAiSocket,
        requestDialpadAiSocketAuth,
      }}
    >
      {children}
      {permissionPopup ? (
        <Dialog
          open={Boolean(permissionPopup)}
          onOpenChange={(open) => {
            if (!open) {
              resolvePermissionPopup(false);
            }
          }}
        >
          <DialogContent
            className="w-[min(92vw,32rem)] overflow-hidden border border-primary/20 p-0 shadow-2xl"
            showCloseButton={false}
            onEscapeKeyDown={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <DialogHeader className="bg-gradient-to-r from-primary/10 via-white to-primary/5 px-5 py-4 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                Dialpad Permissions
              </p>
              <DialogTitle className="mt-1 text-xl font-semibold text-gray-900">
                {permissionPopup.title}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 px-5 pb-5 pt-1">
              <DialogDescription className="text-sm leading-6 text-gray-700">
                {permissionPopup.description}
              </DialogDescription>

              {permissionPopup.pendingPermissions &&
                permissionPopup.pendingPermissions.length > 0 && (
                  <div className="space-y-2 rounded-xl border border-primary/10 bg-primary/5 p-3">
                    {permissionPopup.pendingPermissions.map((permission) => (
                      <div key={permission} className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-primary/10">
                          {permission === 'microphone' ? (
                            <Mic className="h-4 w-4 text-primary" />
                          ) : (
                            <Video className="h-4 w-4 text-primary" />
                          )}
                        </div>
                        <span className="text-sm font-medium capitalize text-gray-800">
                          {permission} Access
                        </span>
                      </div>
                    ))}
                  </div>
                )}

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  className="min-w-36"
                  onClick={() => resolvePermissionPopup(true)}
                >
                  {permissionPopup.actionLabel}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </DialpadContext.Provider>
  );
};
