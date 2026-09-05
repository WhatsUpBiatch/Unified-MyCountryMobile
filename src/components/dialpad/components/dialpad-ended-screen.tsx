import type { DialpadSession } from '@/context/dialpad-context';
import { isServerDialed } from '@/lib/campaign-dial-mode';
import { useDialpad } from '@/hooks/use-dialpad';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useUser } from '@/hooks/use-user';
// import { handleAlert } from '@/lib/utils';
import {
  // addDispositionInLeadContatc,
  createEventAndTask,
  makeCallQueueAvailable,
  // queueDisposition,
} from '@/services/api';
import moment from 'moment';
import { CalendarClock, Clock3, NotebookPen, Phone, PhoneOff, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DialpadCountdownRingTimer from './dialpad-countdown-ring-timer';
import { wrapupVerdict } from '@/lib/wrapup-rule';
import DialpadScheduleCallback from './dialpad-schedule-callback';
import DialpadSessionSummaryCard from './dialpad-session-summary-card';
import { formatDialpadDuration } from './dialpad-call-timer';
import { handleAlert } from '@/lib/utils';
import { isExtensionDialTarget } from '@/lib/extension-utility';
import { getMonitoringCallLabel } from '../session-display';

type DialpadEndedScreenProps = {
  session: DialpadSession | null;
  onAddNotes: () => void;
  onCallAgain: () => void;
  onClose: () => void;
};

const WAIT_AFTER_CALL_MS = 30000;

// const getScheduleCallbackSuccessMessage = (response: any): string => {
//   return (
//     response?.data?.data?.result?.messages ||
//     response?.data?.result?.messages ||
//     response?.data?.data?.message ||
//     response?.data?.message ||
//     'Callback scheduled successfully.'
//   );
// };

const getHeaderFirstValueFromSessionHeaders = (
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

const DialpadEndedScreen = ({
  session,
  onAddNotes,
  onCallAgain,
  onClose,
}: DialpadEndedScreenProps) => {
  const { clearAllSessions, clearSession, setCampaignContactCards, setActiveCampaign } =
    useDialpad();
  const { socketEventsManager } = useSocketEvents();
  const { user } = useUser();
  const userDetailsPayload = useMemo(
    () => ({
      first_name: String(user?.user_info?.first_name || user?.first_name || '').trim(),
      last_name: String(user?.user_info?.last_name || user?.last_name || '').trim(),
      email: String(user?.user_info?.email || user?.email || '').trim(),
      extension: String(user?.user_info?.extension || '').trim(),
      user_uuid: String(user?.uuid || '').trim(),
      company_uuid: String(user?.company_info?.uuid || user?.company_uuid || '').trim(),
      domain: String(user?.sip_credentials?.domain || user?.user_info?.domain || '').trim(),
      role: String(user?.role || user?.user_info?.role || '').trim(),
      caller_id: String(user?.user_info?.caller_id || user?.caller_id || '').trim(),
    }),
    [user],
  );
  const wrapupAvailabilityCallRef = useRef<string | null>(null);
  const [isScheduleCallbackOpen, setIsScheduleCallbackOpen] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const unansweredCampaignHandledSessionRef = useRef<string | null>(null);
  const endedCampaignWithoutWrapupHandledSessionRef = useRef<string | null>(null);
  const currentUserUuid = user?.uuid || '';
  const currentCompanyUuid = user?.company_info?.uuid || '';

  const normalizedCause = (session?.cause || '').toLowerCase();
  const isRejectedCause = normalizedCause.includes('rejected');
  const endStatus =
    session?.status === 'ended'
      ? session?.eventOriginator === 'remote'
        ? 'Remote Hung Up'
        : 'Call Ended'
      : normalizedCause.includes('no answer') ||
          normalizedCause.includes('request timeout') ||
          normalizedCause.includes('expires') ||
          normalizedCause.includes('unavailable')
        ? 'No Pickup'
        : normalizedCause.includes('busy')
          ? 'Busy'
          : isRejectedCause
            ? 'Rejected'
            : 'Call Failed';

  const causeLabel = session?.cause || 'No reason available';
  const queueWrapupTimeSeconds = Number(
    session?.queueMetaData?.response?.settings?.wrapup_time ?? 0,
  );
  const campaignWrapupTimeSeconds = Number(
    session?.campaignMetaData?.response?.dialerSetting?.wrapup_time ?? 0,
  );
  const queueIdFromSession = String(session?.queueMetaData?.id || '').trim();
  const campaignIdFromSession = String(session?.campaignMetaData?.id || '').trim();
  const forwardTypeFromHeader = getHeaderFirstValueFromSessionHeaders(
    session?.headers,
    'x-forwardtype',
  )
    .trim()
    .toUpperCase();
  const shouldForceCampaignFromHeader =
    Boolean(queueIdFromSession && campaignIdFromSession) && forwardTypeFromHeader === 'CAMPAIGN';
  const hasQueueWrapupTimer = Number.isFinite(queueWrapupTimeSeconds) && queueWrapupTimeSeconds > 0;
  const hasCampaignWrapupTimer =
    Number.isFinite(campaignWrapupTimeSeconds) && campaignWrapupTimeSeconds > 0;
  const wrapupTimerSource = isRejectedCause
    ? null
    : shouldForceCampaignFromHeader
      ? hasCampaignWrapupTimer
        ? 'campaign'
        : null
      : hasQueueWrapupTimer
        ? 'queue'
        : hasCampaignWrapupTimer
          ? 'campaign'
          : null;
  const wrapupTimeSeconds =
    wrapupTimerSource === 'queue'
      ? queueWrapupTimeSeconds
      : wrapupTimerSource === 'campaign'
        ? campaignWrapupTimeSeconds
        : 0;
  const shouldShowWrapupTimer = Boolean(wrapupTimerSource);
  const wrapupReferenceTimestampMs =
    session?.endedAt || session?.connectedAt || session?.startedAt || 0;
  const liveForwardType = String(session?.liveCallData?.forward_type || '')
    .trim()
    .toUpperCase();
  const liveCampaignType = String(session?.liveCallData?.campaign_type || '')
    .trim()
    .toUpperCase();
  const isQueueCallFromSession = shouldForceCampaignFromHeader
    ? false
    : Boolean(
        queueIdFromSession ||
        (liveForwardType === 'QUEUE' && String(session?.liveCallData?.forward_value || '').trim()),
      );
  const isCampaignCallFromSession = shouldForceCampaignFromHeader
    ? true
    : Boolean(campaignIdFromSession || liveForwardType === 'CAMPAIGN' || liveCampaignType);
  const campaignIdForNoAnswerFetch = String(
    campaignIdFromSession || session?.liveCallData?.forward_value || '',
  ).trim();
  const isOutgoingNoAnswerCampaignCall = Boolean(
    isCampaignCallFromSession &&
    String(session?.direction || '').toLowerCase() === 'outgoing' &&
    !session?.hasAnswered &&
    ['ended', 'failed'].includes(String(session?.status || '').toLowerCase()),
  );
  /* Which of the five wrap-up rules this queue chose. Every queue call used to
     hide the close button outright, so "optional" and "cannot be skipped" were
     the same product - the supervisor's choice was saved and ignored.
     
     The half that still is not honoured is "may leave early once the call is
     labelled": whether a disposition has been picked is held in the disposition
     tab, a different component, so it is passed as false here. That makes every
     mandatory mode behave exactly as it does today, and only the modes that let
     the agent go are newly obeyed. Nothing gets stricter than it was. */
  const wrapupRule = wrapupVerdict({
    mode: session?.queueMetaData?.response?.settings?.after_call?.wrapup_prompt,
    totalSeconds: wrapupTimeSeconds,
    elapsedSeconds: wrapupReferenceTimestampMs
      ? Math.max(0, Math.floor((Date.now() - Number(wrapupReferenceTimestampMs)) / 1000))
      : 0,
    hasDisposition: false,
  });

  const shouldHideCloseButton =
    (isQueueCallFromSession || isCampaignCallFromSession) &&
    !isRejectedCause &&
    /* A campaign keeps the behaviour it always had; only a queue call has a
       rule of its own to read. */
    (!isQueueCallFromSession || !wrapupRule.mayLeave);
  const sessionDialTarget = String(session?.remoteNumber || session?.extension || '').trim();
  const isExtensionCallSession = isExtensionDialTarget(sessionDialTarget);
  const monitorCallLabel = getMonitoringCallLabel(
    session?.remoteNumber || session?.extension || '',
  );
  const isMonitoringCall = Boolean(monitorCallLabel);
  const isEndedSession = String(session?.status || '').toLowerCase() === 'ended';
  const shouldShowMonitoringCloseButton = isMonitoringCall && isEndedSession;
  const shouldShowBottomActionButtons = !isMonitoringCall;
  const shouldShowCloseButton = shouldShowMonitoringCloseButton || !shouldHideCloseButton;

  const shouldShowCallAgainButton = !isQueueCallFromSession && !isCampaignCallFromSession;
  const callDurationSeconds = useMemo(() => {
    const callStartTimeMs = Number(session?.connectedAt || session?.startedAt || 0);
    const callEndTimeMs = Number(session?.endedAt || Date.now());

    if (!callStartTimeMs || !Number.isFinite(callStartTimeMs)) return 0;
    if (!Number.isFinite(callEndTimeMs)) return 0;

    return Math.max(0, Math.floor((callEndTimeMs - callStartTimeMs) / 1000));
  }, [session?.connectedAt, session?.endedAt, session?.startedAt]);

  const getHeaderFirstValue = useCallback(
    (headerName: string): string => {
      return getHeaderFirstValueFromSessionHeaders(session?.headers, headerName);
    },
    [session?.headers],
  );

  const getCampaignNextAction = useCallback(
    (status: string) => {
      const campaignNumberId = String(
        session?.liveCallData?.campaign_number_uuid ||
          getHeaderFirstValue('x-campaignnumberuuid') ||
          '',
      ).trim();
      const contactId = String(
        session?.liveCallData?.contact_uuid || getHeaderFirstValue('x-contactuuid') || '',
      ).trim();
      const contactName = String(
        session?.liveCallData?.contact_name || session?.remoteName || '',
      ).trim();
      const contactNumber = String(
        getHeaderFirstValue('x-originalnumber') ||
          session?.remoteNumber ||
          session?.liveCallData?.called_number ||
          '',
      ).trim();
      const campaignId = String(
        session?.campaignMetaData?.id || session?.liveCallData?.forward_value || '',
      ).trim();

      const callStartTimeMs = Number(session?.connectedAt || session?.startedAt || 0);
      const callEndTimeMs = Number(session?.endedAt || Date.now());
      const durationSeconds = callStartTimeMs
        ? Math.max(0, Math.floor((callEndTimeMs - callStartTimeMs) / 1000))
        : 0;

      return {
        campaign_number: {
          _id: campaignNumberId || undefined,
          campaignId: campaignId || undefined,
          contactId: contactId || undefined,
          contactName: contactName || undefined,
          contactNumber: contactNumber || undefined,
        },
        status,
        duration: durationSeconds,
      };
    },
    [
      getHeaderFirstValue,
      session?.campaignMetaData?.id,
      session?.connectedAt,
      session?.endedAt,
      session?.liveCallData?.called_number,
      session?.liveCallData?.campaign_number_uuid,
      session?.liveCallData?.contact_name,
      session?.liveCallData?.contact_uuid,
      session?.liveCallData?.forward_value,
      session?.remoteName,
      session?.remoteNumber,
      session?.startedAt,
    ],
  );

  const fetchCampaignPreviewContacts = useCallback(
    async (campaignId: string, options?: { status?: string }) => {
      const normalizedCampaignId = String(campaignId || '').trim();
      if (!normalizedCampaignId) return;
      if (!socketEventsManager || !currentUserUuid || !currentCompanyUuid) return;

      const campaignDialMethod = String(
        session?.campaignMetaData?.response?.dialMethod ||
          session?.liveCallData?.campaign_type ||
          '',
      )
        .trim()
        .toUpperCase();
      const isPredictiveCampaign = isServerDialed(campaignDialMethod);

      if (isPredictiveCampaign) {
        socketEventsManager.emit(
          'campaign-system-events',
          {
            body: {
              campaignId: normalizedCampaignId,
              queue:
                session?.liveCallData?.queue || session?.campaignMetaData?.response?.queue || '',
              user_uuid: currentUserUuid,
              userDetail: userDetailsPayload,
            },
          },
          (res: any) => {
            const firstLevel = Array.isArray(res) ? res[0] : null;
            const eventPayload = Array.isArray(firstLevel) ? firstLevel[0] : firstLevel;
            const campaignStatusFromEvent = String(eventPayload?.campaignStatus || '')
              .trim()
              .toUpperCase();
            if (['COMPLETED', 'COMPLETE', 'PAUSE'].includes(campaignStatusFromEvent)) {
              setCampaignContactCards([]);
              setActiveCampaign((prev: any) => ({
                ...(prev || {}),
                manualStatus: campaignStatusFromEvent,
              }));
              return;
            }
            console.log('campaign-system-events response:', res);
          },
        );

        try {
          const availabilityResponse = await makeCallQueueAvailable({
            campaign_uuid: normalizedCampaignId,
            status: 'Available',
            state: 'Waiting',
          });
          console.log('makeCallQueueAvailable response:', availabilityResponse);
        } catch (error) {
          console.error('makeCallQueueAvailable failed for predictive campaign:', error);
        }

        return;
      }

      setCampaignContactCards([]);
      setActiveCampaign((prev: any) => {
        const currentStatus = String(
          prev?.manualStatus || prev?.campaignStatus || '',
        ).toUpperCase();
        if (['COMPLETED', 'COMPLETE', 'PAUSE'].includes(currentStatus)) return prev;

        return {
          ...(prev || {}),
          manualStatus: 'PROCESSING',
          nextContactDelayMs: WAIT_AFTER_CALL_MS,
          deferredNextAction: getCampaignNextAction(options?.status || ''),
        };
      });
    },
    [
      currentCompanyUuid,
      currentUserUuid,
      getCampaignNextAction,
      session?.campaignMetaData?.response?.dialMethod,
      session?.campaignMetaData?.response?.queue,
      session?.liveCallData?.campaign_type,
      session?.liveCallData?.queue,
      setActiveCampaign,
      setCampaignContactCards,
      socketEventsManager,
      userDetailsPayload,
    ],
  );

  const handleQueueWrapupTimeEnds = useCallback(async () => {
    const queueId = String(session?.queueMetaData?.id || '').trim();
    const sessionId = String(session?.id || '').trim();
    if (!queueId || !sessionId) return;

    const callKey = `queue:${sessionId}:${queueId}`;
    if (wrapupAvailabilityCallRef.current === callKey) return;

    wrapupAvailabilityCallRef.current = callKey;

    try {
      await makeCallQueueAvailable({
        queue_uuid: queueId,
        status: 'Available',
        state: 'Waiting',
      });
      clearAllSessions();
    } catch (error) {
      wrapupAvailabilityCallRef.current = null;
      console.error('Failed to mark queue available after wrap-up timer end', error);
    }
  }, [clearAllSessions, session?.id, session?.queueMetaData?.id]);

  const handleCampaignWrapupTimeEnds = useCallback(async () => {
    const campaignId = String(session?.campaignMetaData?.id || '').trim();
    const sessionId = String(session?.id || '').trim();
    if (!campaignId || !sessionId) return;

    const callKey = `campaign:${sessionId}:${campaignId}`;
    if (wrapupAvailabilityCallRef.current === callKey) return;

    wrapupAvailabilityCallRef.current = callKey;
    try {
      clearSession(sessionId);
      void fetchCampaignPreviewContacts(campaignId, { status: '' });
    } catch (error) {
      wrapupAvailabilityCallRef.current = null;
      console.error('Failed to fetch campaign contacts after wrap-up timer end', error);
    }
  }, [clearSession, fetchCampaignPreviewContacts, session?.campaignMetaData?.id, session?.id]);

  const handleWrapupTimeEnds = useCallback(() => {
    if (wrapupTimerSource === 'queue') {
      void handleQueueWrapupTimeEnds();
      return;
    }

    if (wrapupTimerSource === 'campaign') {
      void handleCampaignWrapupTimeEnds();
    }
  }, [handleCampaignWrapupTimeEnds, handleQueueWrapupTimeEnds, wrapupTimerSource]);

  useEffect(() => {
    if (!isExtensionCallSession) return;
    if (!isScheduleCallbackOpen) return;
    setIsScheduleCallbackOpen(false);
  }, [isExtensionCallSession, isScheduleCallbackOpen]);

  useEffect(() => {
    const sessionId = String(session?.id || '').trim();
    if (!sessionId) return;
    if (!campaignIdForNoAnswerFetch) return;
    if (!isOutgoingNoAnswerCampaignCall) return;
    if (unansweredCampaignHandledSessionRef.current === sessionId) return;

    unansweredCampaignHandledSessionRef.current = sessionId;
    clearSession(sessionId);
    void fetchCampaignPreviewContacts(campaignIdForNoAnswerFetch, { status: 'NOT_DIALED' });
  }, [
    campaignIdForNoAnswerFetch,
    clearSession,
    fetchCampaignPreviewContacts,
    isOutgoingNoAnswerCampaignCall,
    session?.id,
  ]);

  useEffect(() => {
    const sessionId = String(session?.id || '').trim();
    if (!sessionId) return;
    if (!campaignIdForNoAnswerFetch) return;
    if (!isCampaignCallFromSession) return;
    if (isOutgoingNoAnswerCampaignCall) return;
    if (isRejectedCause) return;
    if (shouldShowWrapupTimer) return;
    if (!['ended', 'failed'].includes(String(session?.status || '').toLowerCase())) return;
    if (endedCampaignWithoutWrapupHandledSessionRef.current === sessionId) return;

    endedCampaignWithoutWrapupHandledSessionRef.current = sessionId;
    clearSession(sessionId);
    void fetchCampaignPreviewContacts(campaignIdForNoAnswerFetch, { status: '' });
  }, [
    campaignIdForNoAnswerFetch,
    clearSession,
    fetchCampaignPreviewContacts,
    isCampaignCallFromSession,
    isOutgoingNoAnswerCampaignCall,
    isRejectedCause,
    session?.id,
    session?.status,
    shouldShowWrapupTimer,
  ]);

  const handleSaveScheduleCallback = useCallback(
    async (selectedDateTime: Date) => {
      const queueId = String(session?.queueMetaData?.id || '').trim();
      const campaignId = String(session?.campaignMetaData?.id || '').trim();
      const forwardTypeFromHeaderForSave = getHeaderFirstValue('x-forwardtype')
        .trim()
        .toUpperCase();
      const shouldForceCampaignForSave =
        Boolean(queueId && campaignId) && forwardTypeFromHeaderForSave === 'CAMPAIGN';
      const isQueueCallSession = shouldForceCampaignForSave ? false : Boolean(queueId);
      const hasCampaignSession = shouldForceCampaignForSave ? true : Boolean(campaignId);
      const callbackScheduledDate = selectedDateTime.toISOString();
      const userName =
        `${user?.user_info?.first_name || ''} ${user?.user_info?.last_name || ''}`.trim();
      const contactPhone =
        getHeaderFirstValue('x-originalnumber') ||
        session?.remoteNumber ||
        session?.liveCallData?.called_number ||
        '';
      // const elapsedSeconds = wrapupReferenceTimestampMs
      //   ? Math.max(0, Math.floor((Date.now() - wrapupReferenceTimestampMs) / 1000))
      //   : 0;
      // const currentWrapupSnapshot = Math.max(0, Math.floor(wrapupTimeSeconds - elapsedSeconds));
      const sipCallId =
        session?.liveCallData?.sip_call_id ||
        getHeaderFirstValue('x-cid') ||
        getHeaderFirstValue('call-id') ||
        session?.id ||
        '';

      // const campaignNumberId = String(
      //   session?.liveCallData?.campaign_number_uuid ||
      //   getHeaderFirstValue('x-campaignnumberuuid') ||
      //   '',
      // ).trim();
      // const contactId = String(
      //   session?.liveCallData?.contact_uuid || getHeaderFirstValue('x-contactuuid') || '',
      // ).trim();
      // const campaignName =
      //   session?.campaignMetaData?.response?.name || session?.liveCallData?.campaign_name || '';
      // const campaignType =
      //   session?.campaignMetaData?.response?.dialMethod ||
      //   session?.liveCallData?.campaign_type ||
      //   'CAMPAIGN';
      const contactName =
        session?.liveCallData?.contact_name ||
        `${session?.contactInfo?.name?.first || ''} ${session?.contactInfo?.name?.last || ''}`.trim() ||
        session?.remoteName ||
        '';
      // const queueName = session?.queueMetaData?.response?.name || '';

      const eventTaskPayload = {
        name: 'Call Back Schedule',
        startTime: moment(selectedDateTime).format('YYYY-MM-DD HH:mm:ss'),
        description: '',
        category: 'TASK',
        reminderMode: ['EMAIL', 'NOTIFICATION'],
        reminder: true,
        mode: 'CALL',
        requestStatus: 'CALLBACK_SCHEDULED',
        source: isQueueCallSession ? 'QUEUE' : hasCampaignSession ? 'LEAD' : 'CONTACT',
        sipCallId: sipCallId || null,
        didNumber: user?.user_info?.caller_id || '',
        timezone:
          user?.settings?.operational_hours?.regional?.timezone?.value ||
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          'Asia/Kolkata',
        members: [
          {
            extension: String(user?.user_info?.extension || '').trim(),
            email: String(user?.user_info?.email || user?.email || '').trim(),
            name: userName,
            type: String(user?.role || user?.user_info?.role || 'ADMIN').toUpperCase(),
            user_uuid: String(user?.uuid || '').trim(),
          },
        ],
        details: {
          contactName: contactName || ' ',
          contactPhone: contactPhone || '',
        },
      };

      setIsScheduling(true);
      try {
        const response = await createEventAndTask(eventTaskPayload);
        console.log(response?.data, 'lllsss');

        handleAlert({
          text: response?.data?.data?.message || 'Callback scheduled successfully',
          type: 'success',
        });
        console.log('Queue callback scheduled payload:', eventTaskPayload);
        setIsScheduleCallbackOpen(false);
      } catch (error) {
        console.error('Failed to schedule queue callback disposition', error);
      } finally {
        setIsScheduling(false);
      }
      // if (isQueueCallSession) {
      //   const queueDispositions = Array.isArray(session?.queueMetaData?.response?.agentDisposition)
      //     ? session?.queueMetaData?.response?.agentDisposition
      //     : [];
      //   const selectedDisposition = queueDispositions[0] || null;
      //   const dispositionName = selectedDisposition?.disposition?.name || null;
      //   const queuePayload = {
      //     disposition: {
      //       disposition: dispositionName,
      //       name: userName || null,
      //       extension: user?.user_info?.extension || null,
      //       uuid: user?.uuid || null,
      //       createdAt: new Date().toISOString(),
      //       _id: queueId || null,
      //     },
      //     contactId: contactId || null,
      //     contactName: contactPhone || null,
      //     contactPhone: contactPhone || null,
      //     sipCallId: sipCallId || null,
      //     source: 'QUEUE',
      //     serviceDetail: {
      //       name: queueName || null,
      //       type: 'QUEUE',
      //       uuid: queueId || null,
      //     },
      //     wrap_time_sec: currentWrapupSnapshot,
      //     queueUuid: queueId || null,
      //     callbackScheduledDate,

      //   };

      // try {
      //   const response = await queueDisposition(queuePayload);
      //   handleAlert({
      //     text: getScheduleCallbackSuccessMessage(response),
      //     type: 'success',
      //   });
      //   console.log('Queue callback scheduled payload:', queuePayload);

      // } catch (error) {
      //   console.error('Failed to schedule queue callback disposition', error);
      // }
      // } else if (hasCampaignSession) {
      //   const campaignDispositions = Array.isArray(
      //     session?.campaignMetaData?.response?.agentDisposition,
      //   )
      //     ? session?.campaignMetaData?.response?.agentDisposition
      //     : [];
      //   const selectedDisposition = campaignDispositions[0] || null;
      //   const dispositionName = selectedDisposition?.disposition?.name || null;
      //   const campaignPayload = {
      //     disposition: {
      //       disposition: dispositionName,
      //       name: userName || null,
      //       extension: user?.user_info?.extension || null,
      //       uuid: user?.uuid || null,
      //       createdAt: new Date().toISOString(),
      //       _id: String(selectedDisposition?._id || '').trim() || null,
      //     },
      //     contactId: contactId || null,
      //     contactName: contactName || null,
      //     contactPhone: contactPhone || null,
      //     sipCallId: sipCallId || null,
      //     source: 'LEAD',
      //     serviceDetail: {
      //       name: campaignName || null,
      //       type: campaignType || null,
      //       uuid: campaignId || null,
      //     },
      //     wrap_time_sec: currentWrapupSnapshot,
      //     campaignNumberId: campaignNumberId || null,
      //     callbackScheduledDate,
      //     //
      //   };

      //   try {
      //     const response = await addDispositionInLeadContatc(campaignPayload);
      //     handleAlert({
      //       text: getScheduleCallbackSuccessMessage(response),
      //       type: 'success',
      //     });
      //     console.log('Campaign callback scheduled payload:', campaignPayload);
      //   } catch (error) {
      //     console.error('Failed to schedule campaign callback disposition', error);
      //   }
      // } else {
      //   const fallbackPayload = {
      //     contactName: contactPhone || null,
      //     contactPhone: contactPhone || null,
      //     sipCallId: sipCallId || null,
      //     source: 'CALL',
      //     callbackScheduledDate
      //     // disposition: {
      //     //   disposition: null,
      //     //   name: userName || null,
      //     //   extension: user?.user_info?.extension || null,
      //     //   uuid: user?.uuid || null,
      //     //   createdAt: new Date().toISOString(),
      //     //   _id: null,
      //     // },
      //     // contactId: contactId || null,
      //     // contactName: contactName || null,
      //     // contactPhone: contactPhone || null,
      //     // sipCallId: sipCallId || null,
      //     // source: 'CALLBACK',
      //     // serviceDetail: {
      //     //   name: null,
      //     //   type: null,
      //     //   uuid: null,
      //     // },
      //     // wrap_time_sec: currentWrapupSnapshot,
      //     // campaignNumberId: campaignNumberId || null,
      //     // queueUuid: null,
      //     // callbackScheduledDate,
      //   };

      //   try {
      //     const response = await addDispositionInLeadContatc(fallbackPayload);
      //     handleAlert({
      //       text: getScheduleCallbackSuccessMessage(response),
      //       type: 'success',
      //     });
      //     console.log('Fallback callback scheduled payload:', fallbackPayload);

      //     const eventTaskPayload = {
      //       name: 'Call Back Schedule',
      //       startTime: moment(selectedDateTime).format('YYYY-MM-DD HH:mm:ss'),
      //       description: '',
      //       category: 'TASK',
      //       reminderMode: ['EMAIL', 'NOTIFICATION'],
      //       reminder: true,
      //       mode: 'CALL',
      //       requestStatus: 'CALLBACK_SCHEDULED',
      //       source: window?.location?.pathname.includes('/contact') ? 'CONTACT' : window?.location?.pathname.includes('/department/organization/') ? "DEPARTMENT" : 'DIALER',
      //       sipCallId: sipCallId || null,
      //       didNumber: user?.user_info?.caller_id || '',
      //       timezone:
      //         user?.settings?.operational_hours?.regional?.timezone?.value ||
      //         Intl.DateTimeFormat().resolvedOptions().timeZone ||
      //         'Asia/Kolkata',
      //       members: [
      //         {
      //           extension: String(user?.user_info?.extension || '').trim(),
      //           email: String(user?.user_info?.email || user?.email || '').trim(),
      //           name: userName,
      //           type: String(user?.role || user?.user_info?.role || 'ADMIN').toUpperCase(),
      //           user_uuid: String(user?.uuid || '').trim(),
      //         },
      //       ],
      //       details: {
      //         contactName: contactName || ' ',
      //         contactPhone: contactPhone || '',
      //       },
      //     };
      //     await createEventAndTask(eventTaskPayload);
      //   } catch (error) {
      //     console.error('Failed to schedule callback with fallback payload', error);
      //   }
      // }

      console.log(
        'Dialpad callback date-time selected:',
        callbackScheduledDate,
        selectedDateTime.toString(),
      );
      setIsScheduleCallbackOpen(false);
    },
    [
      getHeaderFirstValue,
      session?.campaignMetaData?.id,
      session?.campaignMetaData?.response?.agentDisposition,
      session?.campaignMetaData?.response?.dialMethod,
      session?.campaignMetaData?.response?.name,
      session?.queueMetaData?.id,
      session?.queueMetaData?.response?.agentDisposition,
      session?.queueMetaData?.response?.name,
      session?.contactInfo?.name?.first,
      session?.contactInfo?.name?.last,
      session?.id,
      session?.liveCallData?.called_number,
      session?.liveCallData?.campaign_name,
      session?.liveCallData?.campaign_number_uuid,
      session?.liveCallData?.campaign_type,
      session?.liveCallData?.contact_name,
      session?.liveCallData?.contact_uuid,
      session?.liveCallData?.sip_call_id,
      session?.remoteName,
      session?.remoteNumber,
      user?.user_info?.extension,
      user?.user_info?.first_name,
      user?.user_info?.last_name,
      user?.uuid,
      wrapupReferenceTimestampMs,
      wrapupTimeSeconds,
    ],
  );

  return (
    <div className="flex h-full  flex-col w-full justify-between xl:gap-10">
      <div className="mt-1 mb-2 rounded-2xl  bg-white   md:mb-4">
        <div className="mb-2.5 sm:mb-3">
          <DialpadSessionSummaryCard session={session} statusLabel={endStatus} showTimer={false} />
        </div>

        <div className="rounded-xl border border-red-100  px-2.5 py-1.5 text-[11px] font-medium text-red-600  bg-red-50  max-[380px]:px-2 max-[380px]:py-1.5 max-[380px]:text-[10px] sm:px-3 sm:py-2 sm:text-xs flex items-center gap-2 ">
          <PhoneOff className="h-3 w-3 max-[380px]:h-3 max-[380px]:w-3 sm:h-3.5 sm:w-3.5" />
          {endStatus}
        </div>

        <p className="mt-2.5 rounded-xl border border-[#e8edf6] bg-[#f9fbff] px-2.5 py-1.5 text-[11px] font-medium text-primary max-[380px]:px-2 max-[380px]:py-1.5 max-[380px]:text-[10px] sm:mt-3 sm:px-3 sm:py-2 sm:text-xs">
          Cause: {causeLabel}
        </p>

        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-[#d9e5f6] bg-ucass-active-bg px-2.5 py-1.5 text-[11px] font-semibold text-[#2f4f79] max-[380px]:px-2 max-[380px]:py-1.5 max-[380px]:text-[10px] sm:px-3 sm:py-2 sm:text-xs">
          <span className="flex items-center gap-2">
            <Clock3 className="h-3 w-3 max-[380px]:h-3 max-[380px]:w-3 sm:h-3.5 sm:w-3.5" />
            Duration
          </span>
          <span className="font-mono">{formatDialpadDuration(callDurationSeconds)}</span>
        </div>

        {shouldShowWrapupTimer ? (
          <div className="mt-3 flex w-full flex-col items-center justify-center gap-1.5 sm:mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5a7396] max-[380px]:text-[10px] sm:text-xs">
              {wrapupTimerSource === 'queue' ? 'Queue Wrap-up Time' : 'Campaign Wrap-up Time'}
            </p>
            <DialpadCountdownRingTimer
              currentTimeSeconds={wrapupTimeSeconds}
              referenceTimestampMs={wrapupReferenceTimestampMs}
              onTimeEnds={handleWrapupTimeEnds}
            />
          </div>
        ) : null}
      </div>

      {!shouldShowBottomActionButtons && !shouldShowCloseButton ? null : (
        <div className="mt-auto grid grid-cols-1 gap-1.5 sm:gap-2">
          {shouldShowBottomActionButtons ? (
            <>
              {!isExtensionCallSession ? (
                isScheduleCallbackOpen ? (
                  <DialpadScheduleCallback
                    onSave={handleSaveScheduleCallback}
                    isLoading={isScheduling}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsScheduleCallbackOpen(true)}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#d4e1f6] bg-ucass-active-bg text-[12px] font-semibold text-[#2f4f79] transition max-[380px]:h-8 max-[380px]:text-[11px] sm:h-10 sm:gap-2 sm:text-sm"
                  >
                    <CalendarClock className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
                    Schedule Callback
                  </button>
                )
              ) : null}

              {!isExtensionCallSession ? (
                <button
                  type="button"
                  onClick={onAddNotes}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#d4e1f6] bg-ucass-active-bg text-[12px] font-semibold text-[#2f4f79] transition max-[380px]:h-8 max-[380px]:text-[11px] sm:h-10 sm:gap-2 sm:text-sm"
                >
                  <NotebookPen className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
                  Add Notes
                </button>
              ) : null}

              {shouldShowCallAgainButton && session?.direction === 'outgoing' ? (
                <button
                  type="button"
                  onClick={onCallAgain}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary text-[12px] font-semibold text-white transition max-[380px]:h-8 max-[380px]:text-[11px] sm:h-10 sm:gap-2 sm:text-sm"
                >
                  <Phone className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
                  Call Again
                </button>
              ) : null}
            </>
          ) : null}

          {!isCampaignCallFromSession ? (
            <button
              type="button"
              onClick={clearAllSessions}
              className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-[12px] font-semibold text-red-600 transition hover:bg-red-100 max-[380px]:h-8 max-[380px]:text-[11px] sm:h-10 sm:gap-2 sm:text-sm"
            >
              <Trash2 className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
              Clear All Sessions
            </button>
          ) : null}

          {shouldShowCloseButton ? (
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 items-center justify-center gap-1.5 rounded-xl  bg-red-600 text-white text-[12px] font-semibold  transition max-[380px]:h-8 max-[380px]:text-[11px] sm:h-10 sm:gap-2 sm:text-sm"
            >
              <PhoneOff className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
              Close
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default DialpadEndedScreen;
