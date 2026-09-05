import type {
  DialpadSession,
  DialpadTranscriptMessage,
  DialpadTranscriptionStatus,
} from '@/context/dialpad-context';
import { useDialpad } from '@/hooks/use-dialpad';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useUser } from '@/hooks/use-user';
import { isExtensionDialTarget } from '@/lib/extension-utility';
import { InfoIcon, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDialpadSessionDisplayInfo } from '../session-display';

type DialpadMaxiTabTranscriptProps = {
  activeSession: DialpadSession | null;
};

const UNKNOWN_CONTACT_LABEL = 'Unknown Contact';
const URI_ENCODED_FRAGMENT_PATTERN = /%[0-9a-f]{2}/i;
const INVALID_PERCENT_ENCODING_PATTERN = /%(?![0-9a-f]{2})/gi;

const getHeaderFirstValue = (
  headers: DialpadSession['headers'] | undefined,
  headerName: string,
): string => {
  if (!headers) return '';

  const normalizedHeaderName = headerName.trim().toLowerCase();
  const matchingHeaderEntry = Object.entries(headers).find(
    ([name]) => name.trim().toLowerCase() === normalizedHeaderName,
  );

  if (!matchingHeaderEntry) return '';

  const [, values] = matchingHeaderEntry;
  if (!Array.isArray(values) || values.length === 0) return '';
  return String(values[0] || '').trim();
};

const isTruthyHeaderValue = (value: string): boolean =>
  ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());

/* The settings-editor UI (admin-settings/templates/user-settings, and the
   campaign/queue settings forms) writes this as `{enabled, override}`, not a
   bare boolean - `users.settings.transcription` and `.ai_call_monitoring`
   have historically been saved as a plain boolean instead, so both shapes
   exist. Treating an object as automatically falsy silently disabled
   auto-start for any user whose setting was saved through that editor. */
const isTruthySettingValue = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return isTruthyHeaderValue(value);
  if (value && typeof value === 'object') {
    return isTruthySettingValue((value as { enabled?: unknown }).enabled);
  }
  return false;
};

const safeDecodeUriComponent = (value: string): string => {
  if (!value) return '';

  const normalizedForDecoding = value.replace(/\+/g, '%20');
  const sanitizedPercentValue = normalizedForDecoding.replace(
    INVALID_PERCENT_ENCODING_PATTERN,
    '%25',
  );

  try {
    return decodeURIComponent(sanitizedPercentValue);
  } catch {
    try {
      return decodeURI(sanitizedPercentValue);
    } catch {
      return value;
    }
  }
};

const decodeAndNormalizeSpeakerName = (value: string): string => {
  let normalizedValue = value;

  // Handle single and double encoded values (for example: %20 and %2520).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const shouldTryDecoding =
      URI_ENCODED_FRAGMENT_PATTERN.test(normalizedValue) || normalizedValue.includes('+');
    if (!shouldTryDecoding) break;

    const decodedValue = safeDecodeUriComponent(normalizedValue);
    if (!decodedValue || decodedValue === normalizedValue) break;
    normalizedValue = decodedValue;
  }

  const valueWithoutControlCharacters = Array.from(normalizedValue)
    .map((character) => {
      const charCode = character.charCodeAt(0);
      return charCode <= 31 || charCode === 127 ? ' ' : character;
    })
    .join('');

  return valueWithoutControlCharacters.replace(/\s+/g, ' ').trim();
};

const getMeaningfulSpeakerName = (value: unknown): string => {
  const rawValue = typeof value === 'string' ? value : String(value ?? '');
  const normalizedValue = decodeAndNormalizeSpeakerName(rawValue);
  if (!normalizedValue) return '';

  const lowerCaseValue = normalizedValue.toLowerCase();
  if (
    lowerCaseValue === 'unknown' ||
    lowerCaseValue === 'unknown speaker' ||
    lowerCaseValue === 'null' ||
    lowerCaseValue === 'undefined' ||
    lowerCaseValue === 'n/a'
  ) {
    return '';
  }

  return normalizedValue;
};

const getSessionContactName = (session: DialpadSession | null): string => {
  const contactFirstName = String(session?.contactInfo?.name?.first || '').trim();
  const contactLastName = String(session?.contactInfo?.name?.last || '').trim();
  const contactInfoName = getMeaningfulSpeakerName(`${contactFirstName} ${contactLastName}`.trim());

  return (
    contactInfoName ||
    getMeaningfulSpeakerName(session?.liveCallData?.contact_name) ||
    getMeaningfulSpeakerName(getHeaderFirstValue(session?.headers, 'x-contactname')) ||
    getMeaningfulSpeakerName(session?.remoteName) ||
    UNKNOWN_CONTACT_LABEL
  );
};

const getTranscriptSignature = (messages: DialpadTranscriptMessage[]) => {
  const lastMessage = messages[messages.length - 1];
  return `${messages.length}:${String(lastMessage?.id || '')}:${lastMessage?.msg || ''}`;
};

const formatTimeWithMeridiem = (date: Date): string =>
  date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

const formatTimeOfDayFromSeconds = (totalSeconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600) % 24;
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const date = new Date();
  date.setHours(hours, minutes, seconds, 0);
  return formatTimeWithMeridiem(date);
};

const formatTranscriptMessageTime = (value: unknown): string => {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(rawValue)) {
    const [hoursRaw, minutesRaw, secondsRaw = '0'] = rawValue.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    const seconds = Number(secondsRaw);
    if (
      Number.isFinite(hours) &&
      Number.isFinite(minutes) &&
      Number.isFinite(seconds) &&
      hours >= 0 &&
      minutes >= 0 &&
      seconds >= 0
    ) {
      return formatTimeOfDayFromSeconds(hours * 3600 + minutes * 60 + seconds);
    }
    return rawValue;
  }

  const numericValue = Number(rawValue);
  if (Number.isFinite(numericValue) && numericValue >= 0) {
    // Support time-of-day offsets represented in seconds.
    if (numericValue < 24 * 60 * 60) {
      return formatTimeOfDayFromSeconds(numericValue);
    }

    // Support time-of-day offsets represented in milliseconds.
    if (numericValue < 24 * 60 * 60 * 1000) {
      return formatTimeOfDayFromSeconds(numericValue / 1000);
    }

    // Epoch seconds or epoch milliseconds fallback.
    const epochMs = numericValue >= 1_000_000_000_000 ? numericValue : numericValue * 1000;
    const parsedDate = new Date(epochMs);
    if (!Number.isNaN(parsedDate.getTime())) {
      return formatTimeWithMeridiem(parsedDate);
    }
  }

  const parsedDate = new Date(rawValue);
  if (!Number.isNaN(parsedDate.getTime())) {
    return formatTimeWithMeridiem(parsedDate);
  }

  return rawValue;
};

const DialpadMaxiTabTranscript = ({ activeSession }: DialpadMaxiTabTranscriptProps) => {
  const { handleTranscription, activeCampaign } = useDialpad();
  const { socketEventsManager } = useSocketEvents();
  const { user } = useUser();
  const { contactName, contactNumber } = getDialpadSessionDisplayInfo(activeSession);

  const transcriptListRef = useRef<HTMLDivElement | null>(null);
  const lastTranscriptSignatureRef = useRef('');
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false);

  const activeMessages = useMemo(
    () => activeSession?.transcriptionMessages || [],
    [activeSession?.transcriptionMessages],
  );
  const activeTranscriptSignature = useMemo(
    () => getTranscriptSignature(activeMessages),
    [activeMessages],
  );
  const currentUserName = useMemo(() => {
    const firstName = getMeaningfulSpeakerName(user?.user_info?.first_name);
    const lastName = getMeaningfulSpeakerName(user?.user_info?.last_name);
    return getMeaningfulSpeakerName(`${firstName} ${lastName}`.trim()) || 'Agent';
  }, [user?.user_info?.first_name, user?.user_info?.last_name]);
  const resolvedContactName = useMemo(() => getSessionContactName(activeSession), [activeSession]);

  const scrollTranscriptToBottom = useCallback(() => {
    const transcriptListElement = transcriptListRef.current;
    if (!transcriptListElement) return;

    transcriptListElement.scrollTop = transcriptListElement.scrollHeight;
  }, []);

  const handleTranscriptScroll = useCallback(() => {
    const transcriptListElement = transcriptListRef.current;
    if (!transcriptListElement) return;

    const distanceFromBottom =
      transcriptListElement.scrollHeight -
      transcriptListElement.scrollTop -
      transcriptListElement.clientHeight;
    const isAtBottom = distanceFromBottom <= 20;

    if (isAtBottom) {
      setIsAutoScrollEnabled(true);
      setShowNewMessagesButton(false);
      return;
    }

    setIsAutoScrollEnabled(false);
  }, []);

  const handleScrollToLatestMessages = useCallback(() => {
    setIsAutoScrollEnabled(true);
    setShowNewMessagesButton(false);
    scrollTranscriptToBottom();
  }, [scrollTranscriptToBottom]);

  useEffect(() => {
    setIsAutoScrollEnabled(true);
    setShowNewMessagesButton(false);
    lastTranscriptSignatureRef.current = activeTranscriptSignature;

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(scrollTranscriptToBottom);
    } else {
      scrollTranscriptToBottom();
    }
  }, [activeSession?.id, scrollTranscriptToBottom]);

  useEffect(() => {
    if (activeTranscriptSignature === lastTranscriptSignatureRef.current) return;

    lastTranscriptSignatureRef.current = activeTranscriptSignature;

    if (isAutoScrollEnabled) {
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(scrollTranscriptToBottom);
      } else {
        scrollTranscriptToBottom();
      }
      setShowNewMessagesButton(false);
      return;
    }

    setShowNewMessagesButton(true);
  }, [activeTranscriptSignature, isAutoScrollEnabled, scrollTranscriptToBottom]);

  const transcriptHeaderValue = useMemo(
    () => getHeaderFirstValue(activeSession?.headers, 'x-transcript'),
    [activeSession?.headers],
  );
  const sentimentHeaderValue = useMemo(
    () => getHeaderFirstValue(activeSession?.headers, 'x-sentimentmonitor'),
    [activeSession?.headers],
  );
  const isOutgoingCall = useMemo(
    () => String(activeSession?.direction || '').toLowerCase() === 'outgoing',
    [activeSession?.direction],
  );
  const sessionCampaignId = useMemo(
    () =>
      String(
        activeSession?.campaignMetaData?.id || activeSession?.liveCallData?.campaign_uuid || '',
      ).trim(),
    [activeSession?.campaignMetaData?.id, activeSession?.liveCallData?.campaign_uuid],
  );
  const sessionForwardType = useMemo(
    () => getHeaderFirstValue(activeSession?.headers, 'x-forwardtype').trim().toUpperCase(),
    [activeSession?.headers],
  );
  const liveForwardType = useMemo(
    () =>
      String(activeSession?.liveCallData?.forward_type || '')
        .trim()
        .toUpperCase(),
    [activeSession?.liveCallData?.forward_type],
  );
  const liveCampaignType = useMemo(
    () =>
      String(activeSession?.liveCallData?.campaign_type || '')
        .trim()
        .toUpperCase(),
    [activeSession?.liveCallData?.campaign_type],
  );
  const isCampaignCall = useMemo(
    () =>
      Boolean(
        sessionCampaignId ||
        sessionForwardType === 'CAMPAIGN' ||
        liveForwardType === 'CAMPAIGN' ||
        liveCampaignType,
      ),
    [liveCampaignType, liveForwardType, sessionCampaignId, sessionForwardType],
  );
  const activeCampaignId = useMemo(
    () => String(activeCampaign?._id || '').trim(),
    [activeCampaign?._id],
  );
  const shouldUseActiveCampaignSettings = useMemo(() => {
    if (!isCampaignCall) return false;
    if (!activeCampaignId) return false;
    if (!sessionCampaignId) return true;
    return sessionCampaignId === activeCampaignId;
  }, [activeCampaignId, isCampaignCall, sessionCampaignId]);
  const campaignSettings = activeCampaign?.settings as any;
  const isCampaignSentimentMonitoringEnabled = useMemo(
    () =>
      shouldUseActiveCampaignSettings && isTruthySettingValue(campaignSettings?.ai_call_monitoring),
    [campaignSettings?.ai_call_monitoring, shouldUseActiveCampaignSettings],
  );
  const isCampaignTranscriptionEnabled = useMemo(
    () => shouldUseActiveCampaignSettings && isTruthySettingValue(campaignSettings?.transcription),
    [campaignSettings?.transcription, shouldUseActiveCampaignSettings],
  );
  const isCampaignBotEnabled = useMemo(
    () =>
      shouldUseActiveCampaignSettings &&
      (isTruthySettingValue(campaignSettings?.bot) ||
        isTruthySettingValue(campaignSettings?.bot?.enabled) ||
        isTruthySettingValue(campaignSettings?.ai_bot) ||
        isTruthySettingValue(campaignSettings?.ai_bot?.enabled) ||
        isTruthySettingValue(campaignSettings?.bot_enabled)),
    [
      campaignSettings?.ai_bot,
      campaignSettings?.ai_bot?.enabled,
      campaignSettings?.bot,
      campaignSettings?.bot?.enabled,
      campaignSettings?.bot_enabled,
      shouldUseActiveCampaignSettings,
    ],
  );
  /* The switch has never actually set X-Transcript/X-SentimentMonitor on an
     inbound leg (checked the dialplan generator - it's nowhere), so gating
     incoming calls on that header alone left auto-start permanently off for
     every inbound call regardless of the agent's own setting. Fall back to
     the same personal setting outgoing already uses whenever the header is
     absent - the header (if the switch ever does send one, e.g. a
     queue-level override) still wins when present. */
  const isAutomaticSentimentMonitoringEnabled = useMemo(() => {
    const enabledFromUserOrHeader = isOutgoingCall
      ? isTruthySettingValue(user?.settings?.ai_call_monitoring)
      : sentimentHeaderValue
        ? isTruthyHeaderValue(sentimentHeaderValue)
        : isTruthySettingValue(user?.settings?.ai_call_monitoring);

    return enabledFromUserOrHeader || isCampaignSentimentMonitoringEnabled;
  }, [
    isCampaignSentimentMonitoringEnabled,
    isOutgoingCall,
    sentimentHeaderValue,
    user?.settings?.ai_call_monitoring,
  ]);
  const isAutomaticTranscriptionEnabled = useMemo(() => {
    const enabledFromUserOrHeader = isOutgoingCall
      ? isTruthySettingValue(user?.settings?.transcription)
      : transcriptHeaderValue
        ? isTruthyHeaderValue(transcriptHeaderValue)
        : isTruthySettingValue(user?.settings?.transcription);

    return enabledFromUserOrHeader || isCampaignTranscriptionEnabled;
  }, [
    isCampaignTranscriptionEnabled,
    isOutgoingCall,
    transcriptHeaderValue,
    user?.settings?.transcription,
  ]);
  const shouldForceAutomaticTranscription = useMemo(
    () =>
      isAutomaticSentimentMonitoringEnabled ||
      isAutomaticTranscriptionEnabled ||
      isCampaignBotEnabled,
    [isAutomaticSentimentMonitoringEnabled, isAutomaticTranscriptionEnabled, isCampaignBotEnabled],
  );

  const emitTranscriptionEvent = useCallback(
    (
      eventName: 'transcript' | 'transcript-stop' | 'transcript-restart',
      transcriptionType: DialpadTranscriptionStatus,
    ): boolean => {
      if (!activeSession || !socketEventsManager) return false;
      const activeSessionStatus = String(activeSession?.status || '').toLowerCase();
      const isSessionConnected = ['accepted', 'confirmed'].includes(activeSessionStatus);
      if (!isSessionConnected) return false;
      const sessionDialTarget = String(
        activeSession?.remoteNumber || activeSession?.extension || '',
      ).trim();
      const isExtensionCallSession = isExtensionDialTarget(sessionDialTarget);
      if (isExtensionCallSession) return false;

      /* session.id IS the SIP Call-ID already - see dialpad-transcript-manager's
         getSessionSipCallId for why it's the reliable fallback here. */
      const sipCallId = String(
        activeSession?.liveCallData?.sip_call_id ||
          getHeaderFirstValue(activeSession?.headers, 'x-cid') ||
          getHeaderFirstValue(activeSession?.headers, 'call-id') ||
          activeSession?.id ||
          '',
      ).trim();
      if (!sipCallId) {
        // eslint-disable-next-line no-console
        console.warn('[transcript] manual action skipped: no sipCallId resolvable', {
          sessionId: activeSession?.id,
          eventName,
        });
        return false;
      }

      const firstName = user?.user_info?.first_name || '';
      const lastName = user?.user_info?.last_name || '';
      const payload = {
        data: {
          type: 'transcript',
          agent_extension: user?.user_info?.extension || '',
          agent_name: `${firstName} ${lastName}`.trim(),
          contact_name:
            contactName || resolvedContactName === UNKNOWN_CONTACT_LABEL
              ? UNKNOWN_CONTACT_LABEL
              : resolvedContactName || UNKNOWN_CONTACT_LABEL,
          contact_number: contactNumber || activeSession.remoteNumber || '',
          direction: activeSession.direction === 'outgoing' ? 'outbound' : 'inbound',
          sipCallId,
          sentiment_monitoring: isAutomaticSentimentMonitoringEnabled,
          bot_enabled: isCampaignBotEnabled,
        },
      };

      // eslint-disable-next-line no-console
      console.log('[transcript] manual action emitting', { sessionId: activeSession.id, sipCallId, eventName });
      socketEventsManager.emit(eventName, payload);
      handleTranscription(activeSession, transcriptionType);
      return true;
    },
    [
      activeSession,
      handleTranscription,
      isAutomaticSentimentMonitoringEnabled,
      isCampaignBotEnabled,
      resolvedContactName,
      socketEventsManager,
      user?.user_info?.extension,
      user?.user_info?.first_name,
      user?.user_info?.last_name,
    ],
  );

  const isStopDisabled =
    !activeSession || activeSession.transcriptionHasStarted === 'stop' || !socketEventsManager;
  const isEndedOrFailedSession = ['ended', 'failed'].includes(
    String(activeSession?.status || '').toLowerCase(),
  );
  const isTranscriptionRunning =
    activeSession?.transcriptionHasStarted === 'start' ||
    activeSession?.transcriptionHasStarted === 'resume';
  const shouldShowFirstTranscriptLoader = isTranscriptionRunning && activeMessages.length === 0;
  const shouldShowResumeInsteadOfStart =
    !!activeSession &&
    activeSession.transcriptionHasStarted === 'stop' &&
    activeMessages.length > 0;
  const primaryTranscriptionAction = shouldShowResumeInsteadOfStart
    ? {
        label: 'Resume',
        eventName: 'transcript-restart' as const,
        status: 'resume' as DialpadTranscriptionStatus,
      }
    : {
        label: 'Start',
        eventName: 'transcript' as const,
        status: 'start' as DialpadTranscriptionStatus,
      };
  const isPrimaryDisabled =
    !activeSession ||
    !socketEventsManager ||
    activeSession.transcriptionHasStarted === primaryTranscriptionAction.status;
  const shouldShowTranscriptionButtons =
    !shouldForceAutomaticTranscription && !isEndedOrFailedSession;
  const shouldShowTranscriptionHeader =
    shouldForceAutomaticTranscription || shouldShowTranscriptionButtons;

  return activeSession ? (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-ucass-active-bg bg-white px-3">
      {shouldShowTranscriptionHeader ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {shouldForceAutomaticTranscription ? (
            <p className="rounded-lg bg-[#fff3f3] flex gap-1 items-center  px-3 py-2 text-xs font-semibold text-[#b43232] sm:text-sm">
              <InfoIcon className="h-3 w-3" /> Automatic sentiment monitoring or transcription is
              on.
            </p>
          ) : shouldShowTranscriptionButtons ? (
            isTranscriptionRunning ? (
              <button
                type="button"
                disabled={isStopDisabled}
                onClick={() => emitTranscriptionEvent('transcript-stop', 'stop')}
                className="rounded-lg border border-ucass-active-bg bg-white px-3 py-1.5 text-xs font-semibold text-[#2f3d57] transition hover:bg-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                disabled={isPrimaryDisabled}
                onClick={() =>
                  emitTranscriptionEvent(
                    primaryTranscriptionAction.eventName,
                    primaryTranscriptionAction.status,
                  )
                }
                className="rounded-lg border border-primary bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {primaryTranscriptionAction.label}
              </button>
            )
          ) : null}
        </div>
      ) : null}

      <div className="relative mt-2 flex-1 min-h-0 rounded-xl bg-white px-2.5 py-2.5 ">
        {activeMessages.length ? (
          <div
            ref={transcriptListRef}
            onScroll={handleTranscriptScroll}
            className="h-full space-y-2 overflow-y-auto pb-12 pr-1"
          >
            {activeMessages.map((message) => {
              const normalizedRole = String(message.speakerDetails?.role || '').toLowerCase();
              const normalizedMode = String(message.mode || '').toLowerCase();
              const normalizedSpeaker = String(message.speaker || '').toLowerCase();
              const isSummaryMessage =
                normalizedMode === 'summary' ||
                normalizedRole === 'summary' ||
                normalizedSpeaker === 'summary';
              const isAgentSpeaker = normalizedRole === 'agent';
              const isRemoteSpeaker = !isAgentSpeaker;
              const messageSpeakerName =
                getMeaningfulSpeakerName(message.speakerDetails?.name) ||
                getMeaningfulSpeakerName(message.speaker);
              const speakerName = isSummaryMessage
                ? 'Summary'
                : isAgentSpeaker
                  ? currentUserName
                  : resolvedContactName || messageSpeakerName || UNKNOWN_CONTACT_LABEL;
              const messageTimeLabel = formatTranscriptMessageTime(message.start_time);
              return (
                <div
                  key={String(message.id)}
                  className={`max-w-[88%] rounded-xl px-3 py-2 text-xs sm:text-sm ${
                    isRemoteSpeaker
                      ? 'mr-auto bg-[#f5f8ff] text-[#2d4668]'
                      : 'ml-auto bg-ucass-active-bg text-[#1d3556]'
                  }`}
                >
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#5f7392] sm:text-[11px]">
                    {speakerName}
                    {messageTimeLabel ? (
                      <span className="ml-1 font-medium normal-case tracking-normal text-[#7a8ba3]">
                        {messageTimeLabel}
                      </span>
                    ) : null}
                  </p>
                  <p className="break-words">{message.msg || '-'}</p>
                </div>
              );
            })}
          </div>
        ) : shouldShowFirstTranscriptLoader ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-[#5f7392]">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-[13px] max-[380px]:text-xs sm:text-sm">
              Waiting for first transcript message...
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-[#5f7392] max-[380px]:text-xs sm:text-sm">
            Transcript messages will appear here once transcription starts.
          </p>
        )}

        {showNewMessagesButton && activeMessages.length > 0 && (
          <button
            type="button"
            onClick={handleScrollToLatestMessages}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-white shadow-md transition hover:bg-primary sm:text-xs"
          >
            You have new messages
          </button>
        )}
      </div>
    </div>
  ) : (
    <div className="h-full rounded-2xl border border-ucass-active-bg bg-ucass-active-bg px-3 py-3 max-[380px]:px-2.5 max-[380px]:py-2.5 sm:px-4 sm:py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5a7396] max-[380px]:text-[10px] sm:text-xs">
        Transcript
      </p>
      <p className="mt-2 text-[13px] text-[#6c809e] max-[380px]:text-xs sm:text-sm">
        No active session available.
      </p>
    </div>
  );
};

export default DialpadMaxiTabTranscript;
