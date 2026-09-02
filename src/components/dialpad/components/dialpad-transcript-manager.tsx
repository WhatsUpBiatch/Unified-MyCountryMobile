import type { DialpadSession, DialpadTranscriptMessage } from '@/context/dialpad-context';
import { useDialpad } from '@/hooks/use-dialpad';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useUser } from '@/hooks/use-user';
import { isExtensionDialTarget } from '@/lib/extension-utility';
import { useEffect, useRef } from 'react';

type TranscriptSocketMessage = Partial<DialpadTranscriptMessage> & {
  sipCallId?: string;
};

const UNKNOWN_CONTACT_LABEL = 'Unknown Contact';

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

const getMeaningfulSpeakerName = (value: unknown): string => {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue) return '';

  const lowerCaseValue = normalizedValue.toLowerCase();
  if (lowerCaseValue === 'unknown' || lowerCaseValue === 'unknown speaker') return '';

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

const getSessionSipCallId = (session: DialpadSession | null | undefined): string => {
  if (!session) return '';

  return String(
    session?.liveCallData?.sip_call_id ||
      getHeaderFirstValue(session?.headers, 'x-cid') ||
      getHeaderFirstValue(session?.headers, 'call-id') ||
      '',
  ).trim();
};

const normalizeTranscriptSocketMessage = (payload: unknown): TranscriptSocketMessage | null => {
  if (!payload) return null;

  if (Array.isArray(payload)) {
    const [, secondItem] = payload;
    if (secondItem && typeof secondItem === 'object') {
      return secondItem as TranscriptSocketMessage;
    }

    const [firstItem] = payload;
    if (firstItem && typeof firstItem === 'object') {
      return firstItem as TranscriptSocketMessage;
    }

    return null;
  }

  if (typeof payload === 'object') {
    return payload as TranscriptSocketMessage;
  }

  return null;
};

const DialpadTranscriptManager = () => {
  const { sessions, handleTranscription, activeCampaign } = useDialpad();
  const { socketEventsManager } = useSocketEvents();
  const { user } = useUser();
  const sessionsRef = useRef(sessions);
  const autoStartedBySessionRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    if (!socketEventsManager) return;

    const handleTranscriptSocketEvent = (...socketPayload: unknown[]) => {
      const transcriptMessage = normalizeTranscriptSocketMessage(
        socketPayload.length > 1 ? socketPayload : socketPayload[0],
      );

      const transcriptSipCallId = String(transcriptMessage?.sipCallId || '').trim();
      if (!transcriptSipCallId) return;

      const matchingSession = Object.values(sessionsRef.current).find((session) => {
        const sessionSipCallId = getSessionSipCallId(session);
        return !!sessionSipCallId && sessionSipCallId === transcriptSipCallId;
      });
      if (!matchingSession) return;

      handleTranscription(
        matchingSession,
        matchingSession.transcriptionHasStarted || 'stop',
        transcriptMessage,
      );
    };

    socketEventsManager.on('transcript', handleTranscriptSocketEvent);
    return () => {
      socketEventsManager.off('transcript', handleTranscriptSocketEvent);
    };
  }, [handleTranscription, socketEventsManager]);

  useEffect(() => {
    if (!socketEventsManager) return;

    const activeSessionIds = new Set(Object.keys(sessions || {}));
    Object.keys(autoStartedBySessionRef.current).forEach((sessionId) => {
      if (!activeSessionIds.has(sessionId)) {
        delete autoStartedBySessionRef.current[sessionId];
      }
    });

    const activeCampaignId = String(activeCampaign?._id || '').trim();
    const campaignSettings = activeCampaign?.settings as any;
    const firstName = user?.user_info?.first_name || '';
    const lastName = user?.user_info?.last_name || '';
    const agentName = `${firstName} ${lastName}`.trim();
    const agentExtension = user?.user_info?.extension || '';

    Object.values(sessions || {}).forEach((session) => {
      if (!session?.id) return;

      const sessionStatus = String(session?.status || '').toLowerCase();
      if (['ended', 'failed'].includes(sessionStatus)) return;
      const isSessionConnected = ['accepted', 'confirmed'].includes(sessionStatus);
      if (!isSessionConnected) return;
      const sessionDialTarget = String(session?.remoteNumber || session?.extension || '').trim();
      const isExtensionCallSession = isExtensionDialTarget(sessionDialTarget);
      if (isExtensionCallSession) return;

      if (session.transcriptionHasStarted !== 'stop') {
        autoStartedBySessionRef.current[session.id] = true;
        return;
      }
      if (autoStartedBySessionRef.current[session.id]) return;

      const sessionCampaignId = String(
        session?.campaignMetaData?.id || session?.liveCallData?.campaign_uuid || '',
      ).trim();
      const sessionForwardType = getHeaderFirstValue(session?.headers, 'x-forwardtype')
        .trim()
        .toUpperCase();
      const liveForwardType = String(session?.liveCallData?.forward_type || '')
        .trim()
        .toUpperCase();
      const liveCampaignType = String(session?.liveCallData?.campaign_type || '')
        .trim()
        .toUpperCase();
      const isCampaignCall = Boolean(
        sessionCampaignId ||
        sessionForwardType === 'CAMPAIGN' ||
        liveForwardType === 'CAMPAIGN' ||
        liveCampaignType,
      );
      const shouldUseActiveCampaignSettings = (() => {
        if (!isCampaignCall) return false;
        if (!activeCampaignId) return false;
        if (!sessionCampaignId) return true;
        return sessionCampaignId === activeCampaignId;
      })();

      const isCampaignSentimentMonitoringEnabled =
        shouldUseActiveCampaignSettings &&
        isTruthySettingValue(campaignSettings?.ai_call_monitoring);
      const isCampaignTranscriptionEnabled =
        shouldUseActiveCampaignSettings && isTruthySettingValue(campaignSettings?.transcription);
      const isCampaignBotEnabled =
        shouldUseActiveCampaignSettings &&
        (isTruthySettingValue(campaignSettings?.bot) ||
          isTruthySettingValue(campaignSettings?.bot?.enabled) ||
          isTruthySettingValue(campaignSettings?.ai_bot) ||
          isTruthySettingValue(campaignSettings?.ai_bot?.enabled) ||
          isTruthySettingValue(campaignSettings?.bot_enabled));

      const transcriptHeaderValue = getHeaderFirstValue(session?.headers, 'x-transcript');
      const sentimentHeaderValue = getHeaderFirstValue(session?.headers, 'x-sentimentmonitor');
      const isOutgoingCall = String(session?.direction || '').toLowerCase() === 'outgoing';

      const isAutomaticSentimentMonitoringEnabled =
        (isOutgoingCall
          ? isTruthySettingValue(user?.settings?.ai_call_monitoring)
          : isTruthyHeaderValue(sentimentHeaderValue)) || isCampaignSentimentMonitoringEnabled;
      const isAutomaticTranscriptionEnabled =
        (isOutgoingCall
          ? isTruthySettingValue(user?.settings?.transcription)
          : isTruthyHeaderValue(transcriptHeaderValue)) || isCampaignTranscriptionEnabled;

      const shouldForceAutomaticTranscription =
        isAutomaticSentimentMonitoringEnabled ||
        isAutomaticTranscriptionEnabled ||
        isCampaignBotEnabled;
      if (!shouldForceAutomaticTranscription) return;

      const sipCallId = getSessionSipCallId(session);
      if (!sipCallId) return;

      const payload = {
        data: {
          type: 'transcript',
          agent_extension: agentExtension,
          agent_name: agentName,
          contact_name: getSessionContactName(session),
          contact_number: session.remoteNumber || '',
          direction: session.direction === 'outgoing' ? 'outbound' : 'inbound',
          sipCallId,
          sentiment_monitoring: isAutomaticSentimentMonitoringEnabled,
          bot_enabled: isCampaignBotEnabled,
        },
      };

      socketEventsManager.emit('transcript', payload);
      handleTranscription(session, 'start');
      autoStartedBySessionRef.current[session.id] = true;
    });
  }, [
    activeCampaign?._id,
    activeCampaign?.settings,
    handleTranscription,
    sessions,
    socketEventsManager,
    user?.settings?.ai_call_monitoring,
    user?.settings?.transcription,
    user?.user_info?.extension,
    user?.user_info?.first_name,
    user?.user_info?.last_name,
  ]);

  return null;
};

export default DialpadTranscriptManager;
