import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { makeCallQueueAvailable, validateCampaignLeadAssignment } from '@/services/api';
import { useDialpad } from '@/hooks/use-dialpad';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useUser } from '@/hooks/use-user';
import { getEnv, handleAlert, SESSION_NAME } from '@/lib/utils';
import { AlertTriangle, Clock3, LoaderCircle, PhoneCall } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DialpadCampaignContactCard, {
  type CampaignContactCard,
  type CampaignSkipStatus,
} from './dialpad-campaign-contact-card';
import DialpadCountdownRingTimer from './dialpad-countdown-ring-timer';
import { getHeaderFirstValue } from '../session-display';

import { isServerDialed } from '@/lib/campaign-dial-mode';
type DialpadScreenState = 'idle' | 'ringing' | 'connected' | 'ended';

type DialpadCampaignOverviewProps = {
  campaignContactCards: CampaignContactCard[] | null;
  dialpadScreen: DialpadScreenState;
};

const CAMPAIGN_OVERVIEW_ACCORDION_VALUE = 'campaign-overview';
const DEFAULT_PREVIEW_TIMER_KEY = 'campaign-preview-timer';
const WAIT_AFTER_CALL_MS = 30000;
const CONTACT_RETRY_MS = 30000;
const PROGRESSIVE_SKIP_NEXT_CONTACT_DELAY_MS = 10000;
const PREVIEW_SKIP_NEXT_CONTACT_DELAY_MS = 1500;

const isCampaignSkippingAllowed = (campaign: any) =>
  campaign?.allowSkipping === true || String(campaign?.allowSkipping).toLowerCase() === 'true';

const getCampaignPayload = (response: any) =>
  Array.isArray(response)
    ? response?.[0]?.response || response?.[0]
    : response?.response || response;

const getCampaignPayloadItems = (response: any) => {
  const payload = getCampaignPayload(response);

  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return payload ? [payload] : [];
};

const getCampaignStatus = (response: any) => {
  const payload = getCampaignPayload(response);
  const items = getCampaignPayloadItems(response);

  return String(
    payload?.campaignStatus ||
      items.find((item: any) => item?.campaignStatus)?.campaignStatus ||
      response?.campaignStatus ||
      '',
  )
    .trim()
    .toUpperCase();
};

const getCampaignRows = (response: any) => {
  const payload = getCampaignPayload(response);
  return Array.isArray(payload?.rows) ? payload.rows : [];
};

const isCampaignStopStatus = (status?: string) =>
  ['COMPLETED', 'COMPLETE', 'PAUSE'].includes(String(status || '').toUpperCase());

const getLeadValidationResponse = (response: any) => {
  const responseBody = response?.data ?? response;
  const responseData = responseBody?.data ?? responseBody;
  const result = responseData?.result ?? responseBody?.result ?? response?.result;

  return {
    result,
    message:
      result?.message || responseData?.message || responseBody?.message || response?.message || '',
  };
};

const isScheduledForFuture = (contact: any) => {
  const retryDate = contact?.startExecutionDate || contact?.sipcallDetail?.[0]?.retryDate;

  return Boolean(
    contact?.requestStatus === 'SCHEDULED' &&
    retryDate &&
    new Date(retryDate).getTime() > Date.now(),
  );
};

const formatCampaignType = (value: string) => {
  return value
    .split('_')
    .join(' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const pickRandomCallerId = (callerIds: string[] | undefined) => {
  if (!Array.isArray(callerIds) || callerIds.length === 0) return '';
  const validCallerIds = callerIds.map((callerId) => String(callerId || '').trim()).filter(Boolean);
  if (!validCallerIds.length) return '';
  const randomIndex = Math.floor(Math.random() * validCallerIds.length);
  return validCallerIds[randomIndex];
};

const DialpadCampaignOverview = ({
  campaignContactCards,
  dialpadScreen,
}: DialpadCampaignOverviewProps) => {
  const {
    makeCall,
    setCampaignContactCards,
    openDialpad,
    closeDialpad,
    clearAllSessions,
    isDialpadOpen,
    sessions,
    activeSessionId,
    isRegistered,
    activeCampaign,
    setActiveCampaign,
    startCampaignClearingTimer,
    setJoinedCampaignId,
  } = useDialpad();
  const { socketEventsManager, ongoingCampaignActivity, setOngoingCampaignActivity } =
    useSocketEvents();
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
  const [isSkipLoading, setIsSkipLoading] = useState(false);
  const [accordionValue, setAccordionValue] = useState('');
  const [emptyQueueTimerRunId, setEmptyQueueTimerRunId] = useState(0);
  const lastCampaignIdRef = useRef('');
  const isTryFetchingContactsPendingRef = useRef(false);
  const previewTimerSnapshotRef = useRef(0);
  const previewTimerReferenceMapRef = useRef<Record<string, number>>({});
  const contactRetryAlertShownRef = useRef(false);
  const emittedCallEventKeysRef = useRef<Set<string>>(new Set());
  const emittedWrapupEventKeysRef = useRef<Set<string>>(new Set());
  const leadValidationCountdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [leadValidationAlert, setLeadValidationAlert] = useState({
    open: false,
    message: '',
    countdown: 3,
    shouldRefresh: false,
  });

  /* An administrator pausing or completing the campaign is announced to the
     whole tenant on "campaign-state-update". Take it here directly: the shared
     context only forwarded it on a route that no longer exists. */
  useEffect(() => {
    if (!socketEventsManager) return;
    const onState = (payload: any) => {
      if (!payload || typeof payload !== 'object') return;
      setOngoingCampaignActivity(payload);
    };
    socketEventsManager.on('campaign-state-update', onState);
    return () => {
      socketEventsManager.off('campaign-state-update', onState);
    };
  }, [socketEventsManager, setOngoingCampaignActivity]);

  const cards = Array.isArray(campaignContactCards) ? campaignContactCards : [];
  console.log('🚀 ~ DialpadCampaignOverview ~ campaignContactCards:', campaignContactCards);
  const totalContacts = cards.length;
  const firstCampaignCard: CampaignContactCard = cards[0] || {};
  const activeCampaignId = String(activeCampaign?._id || '').trim();
  const activeCampaignName = String(activeCampaign?.name || '').trim();
  const activeCampaignDialMethod = String(
    activeCampaign?.dialMethod || activeCampaign?.campaignType || '',
  ).trim();
  const campaignName =
    activeCampaignName || firstCampaignCard?.campaignDetail?.campaignName?.trim() || 'Campaign';
  const campaignTypeValue =
    activeCampaignDialMethod ||
    firstCampaignCard?.campaignDetail?.campaignType?.trim() ||
    'UNKNOWN';
  const normalizedCampaignType = campaignTypeValue.toUpperCase();
  /* Server-dialled modes (predictive, and progressive once the dialer service
     places its calls) share one runtime: go available, wait for the call.
     "Progressive" below then only means the browser-dialled variant. */
  const serverDialed = isServerDialed(normalizedCampaignType);
  const isProgressiveDialMethod = normalizedCampaignType === 'PROGRESSIVE' && !serverDialed;
  const isPreviewDialMethod = normalizedCampaignType === 'PREVIEW';
  const isPredictiveDialMethod = serverDialed;
  const campaignType = formatCampaignType(campaignTypeValue);
  const normalizedContactNumber = firstCampaignCard?.contactNumber?.trim() || '';
  const campaignId = activeCampaignId || firstCampaignCard?.campaignId?.trim() || '';
  const activeSession = activeSessionId ? sessions?.[activeSessionId] : null;
  const hasAnyDialpadSession = Object.keys(sessions || {}).length > 0;
  const hasLiveDialpadSession = Object.values(sessions || {}).some((sessionItem) => {
    const sessionStatus = String(sessionItem?.status || '').toLowerCase();
    return Boolean(sessionStatus && !['ended', 'failed'].includes(sessionStatus));
  });
  const progressiveAutoDialContactKey = String(
    activeCampaign?.progressiveAutoDialContactKey || '',
  ).trim();
  const campaignIdFromSession = String(
    activeSession?.campaignMetaData?.id || activeSession?.liveCallData?.forward_value || '',
  ).trim();
  const resolvedCampaignId = campaignId || campaignIdFromSession || lastCampaignIdRef.current;
  const hasCampaignSessionForCurrentCampaign = Object.values(sessions).some((sessionItem) => {
    const sessionCampaignId = String(
      sessionItem?.campaignMetaData?.id ||
        sessionItem?.liveCallData?.campaign_uuid ||
        (String(sessionItem?.liveCallData?.forward_type || '').toUpperCase() === 'CAMPAIGN'
          ? sessionItem?.liveCallData?.forward_value
          : '') ||
        getHeaderFirstValue(sessionItem?.headers, 'x-campaignuuid') ||
        '',
    ).trim();
    return Boolean(sessionCampaignId && sessionCampaignId === resolvedCampaignId);
  });
  const currentUserUuid = user?.uuid || '';
  const currentCompanyUuid = user?.company_info?.uuid || '';
  const allowSkipping = isCampaignSkippingAllowed({
    allowSkipping: firstCampaignCard?.allowSkipping ?? activeCampaign?.allowSkipping ?? false,
  });
  const configuredPreviewTimeSeconds = Number(
    activeCampaign?.dialerSetting?.preview_time ??
      firstCampaignCard?.campaign_detail?.dialerSetting?.preview_time ??
      0,
  );
  const previewTimeSeconds =
    isPreviewDialMethod && Number.isFinite(configuredPreviewTimeSeconds)
      ? Math.max(0, configuredPreviewTimeSeconds)
      : 0;
  const previewTimerKey =
    firstCampaignCard?._id?.trim() ||
    firstCampaignCard?.contactId?.trim() ||
    firstCampaignCard?.contactNumber?.trim() ||
    DEFAULT_PREVIEW_TIMER_KEY;
  const previewTimerReferenceTimestampMs =
    previewTimerReferenceMapRef.current[previewTimerKey] || 0;
  const predictiveAutoCollapseKey =
    firstCampaignCard?._id?.trim() ||
    firstCampaignCard?.contactId?.trim() ||
    firstCampaignCard?.contactNumber?.trim() ||
    campaignId ||
    firstCampaignCard?.contactName?.trim() ||
    'predictive-default';
  const accordionBehaviorKey = `${isPredictiveDialMethod ? 'predictive' : 'standard'}:${predictiveAutoCollapseKey}`;
  const canCall = Boolean(normalizedContactNumber && isRegistered);
  const canSkip = Boolean(
    allowSkipping &&
    socketEventsManager &&
    resolvedCampaignId &&
    currentUserUuid &&
    currentCompanyUuid,
  );
  const isManualProcessing =
    String(activeCampaign?.manualStatus || '')
      .trim()
      .toUpperCase() === 'PROCESSING';
  const manualCampaignStatus = String(
    activeCampaign?.manualStatus || activeCampaign?.campaignStatus || '',
  )
    .trim()
    .toUpperCase();
  const isManualStopStatus = isCampaignStopStatus(manualCampaignStatus);
  const deferredNextActionFromCampaign = activeCampaign?.deferredNextAction;
  const shouldShowProcessingLoopTimer =
    totalContacts === 0 && isManualProcessing && !leadValidationAlert.open;
  const configuredNextContactDelayMs = Number(activeCampaign?.nextContactDelayMs);
  const nextContactDelayMs = Number.isFinite(configuredNextContactDelayMs)
    ? Math.max(0, configuredNextContactDelayMs)
    : WAIT_AFTER_CALL_MS;
  const nextContactDelaySeconds = Math.max(1, Math.ceil(nextContactDelayMs / 1000));

  useEffect(() => {
    if (!Array.isArray(campaignContactCards) || campaignContactCards.length === 0) return;

    const callableContacts = campaignContactCards.filter(
      (contact) => !isScheduledForFuture(contact),
    );
    if (callableContacts.length === campaignContactCards.length) {
      contactRetryAlertShownRef.current = false;
      return;
    }

    if (callableContacts.length > 0) {
      contactRetryAlertShownRef.current = false;
      setCampaignContactCards(callableContacts);
      return;
    }

    const nextRetryAt = campaignContactCards.reduce((earliest: number | null, contact: any) => {
      const retryDate = contact?.startExecutionDate || contact?.sipcallDetail?.[0]?.retryDate;
      const retryTime = retryDate ? new Date(retryDate).getTime() : NaN;

      if (!Number.isFinite(retryTime) || retryTime <= Date.now()) return earliest;
      return earliest === null ? retryTime : Math.min(earliest, retryTime);
    }, null);
    const waitMs = nextRetryAt
      ? Math.max(1000, Math.min(nextRetryAt - Date.now(), CONTACT_RETRY_MS))
      : CONTACT_RETRY_MS;

    setCampaignContactCards([]);
    setActiveCampaign((prev: any) => ({
      ...(prev || {}),
      manualStatus: 'PROCESSING',
      nextContactDelayMs: waitMs,
    }));

    if (!contactRetryAlertShownRef.current) {
      contactRetryAlertShownRef.current = true;
      handleAlert({
        text: 'Next campaign contact is scheduled for later. The campaign will keep running and retry automatically.',
        type: 'info',
      });
    }
  }, [campaignContactCards, setActiveCampaign, setCampaignContactCards]);

  useEffect(() => {
    if (!campaignId) return;
    lastCampaignIdRef.current = campaignId;
  }, [campaignId]);

  useEffect(() => {
    if (!isManualStopStatus) return;
    if (hasCampaignSessionForCurrentCampaign) return;

    handleAlert({
      text:
        manualCampaignStatus === 'PAUSE'
          ? 'Campaign has been paused.'
          : 'Campaign has been completed. No more contacts are available.',
      type: manualCampaignStatus === 'PAUSE' ? 'info' : 'success',
    });
    socketEventsManager?.emit('campaign-event-logs', {
      campaignDetail: {
        campaignName,
        campaignId: resolvedCampaignId,
        companyId: activeCampaign?.companyId,
      },
      eventType: 'DELETE',
      userDetail: userDetailsPayload,
    });

    if (isPredictiveDialMethod && resolvedCampaignId) {
      void makeCallQueueAvailable({
        campaign_uuid: resolvedCampaignId,
        status: 'On Break',
        state: 'Idle',
      }).catch((error) => {
        console.error('Failed to mark predictive campaign idle after stopping:', error);
      });
    }

    previewTimerReferenceMapRef.current = {};
    previewTimerSnapshotRef.current = 0;
    setEmptyQueueTimerRunId(0);
    setCampaignContactCards(null);
    setActiveCampaign(null);
    setJoinedCampaignId(null);
    closeDialpad();
  }, [
    closeDialpad,
    hasCampaignSessionForCurrentCampaign,
    activeCampaign?.companyId,
    campaignName,
    isPredictiveDialMethod,
    isManualStopStatus,
    manualCampaignStatus,
    setActiveCampaign,
    setCampaignContactCards,
    setJoinedCampaignId,
  ]);

  useEffect(() => {
    previewTimerSnapshotRef.current = previewTimeSeconds;
  }, [previewTimeSeconds, previewTimerKey]);

  useEffect(() => {
    if (!previewTimerKey) return;
    if (totalContacts === 0) return;
    if (previewTimerKey === DEFAULT_PREVIEW_TIMER_KEY) return;

    if (previewTimeSeconds <= 0) {
      delete previewTimerReferenceMapRef.current[previewTimerKey];
      return;
    }

    if (!previewTimerReferenceMapRef.current[previewTimerKey]) {
      previewTimerReferenceMapRef.current[previewTimerKey] = Date.now();
    }
  }, [previewTimeSeconds, previewTimerKey, totalContacts]);

  useEffect(() => {
    setAccordionValue(isPredictiveDialMethod ? '' : CAMPAIGN_OVERVIEW_ACCORDION_VALUE);
  }, [accordionBehaviorKey, isPredictiveDialMethod]);

  useEffect(() => {
    if (dialpadScreen === 'ended') {
      setAccordionValue('');
    }
  }, [dialpadScreen]);

  const handleAccordionValueChange = useCallback((value: string) => {
    setAccordionValue(value);
  }, []);

  const showLeadValidationRefreshAlert = useCallback(
    (message: string) => {
      setCampaignContactCards([]);
      setLeadValidationAlert({
        open: true,
        message,
        countdown: 3,
        shouldRefresh: true,
      });
    },
    [setCampaignContactCards],
  );

  const validateLeadBeforeCall = useCallback(
    async (data: CampaignContactCard) => {
      const currentDialMethod = String(
        activeCampaign?.dialMethod || activeCampaign?.campaignType || '',
      )
        .trim()
        .toUpperCase();
      const requiresValidation = ['PROGRESSIVE', 'PREVIEW'].includes(currentDialMethod);

      if (!requiresValidation) {
        return { valid: true, shouldRefresh: false, message: '' };
      }

      if (!activeCampaignId || !data?._id) {
        return {
          valid: false,
          shouldRefresh: true,
          message:
            'This lead is no longer active on your screen. Refreshing to get the latest lead.',
        };
      }

      try {
        const response = await validateCampaignLeadAssignment({
          campaignId: activeCampaignId,
          campaignNumberId: data._id,
        });
        const { result, message } = getLeadValidationResponse(response);

        return {
          valid: result?.valid === true,
          shouldRefresh: result?.shouldRefresh === true,
          message:
            result?.message ||
            message ||
            'This lead is no longer available. Refreshing to get the latest lead.',
        };
      } catch (error: any) {
        handleAlert({
          text:
            error?.response?.data?.error?.message ||
            'Unable to validate lead assignment. Please try again.',
          type: 'error',
        });
        return { valid: false, shouldRefresh: false, message: '' };
      }
    },
    [activeCampaign?.campaignType, activeCampaign?.dialMethod, activeCampaignId],
  );

  const handleCall = useCallback(async () => {
    if (!isRegistered) return;
    if (!normalizedContactNumber) return;

    const validationResult = await validateLeadBeforeCall(firstCampaignCard);
    if (!validationResult.valid) {
      if (validationResult.shouldRefresh) {
        showLeadValidationRefreshAlert(validationResult.message);
      }
      return;
    }

    const campaignUuid = activeCampaignId || firstCampaignCard?.campaignId?.trim() || '';
    const campaignDisplayName =
      activeCampaignName || firstCampaignCard?.campaignDetail?.campaignName?.trim() || '';
    const campaignDialMethod =
      activeCampaignDialMethod || firstCampaignCard?.campaignDetail?.campaignType?.trim() || '';
    const contactName = firstCampaignCard?.contactName?.trim() || '';
    const contactUuid = firstCampaignCard?.contactId?.trim() || '';
    const campaignNumberUuid = firstCampaignCard?._id?.trim() || '';
    const randomCallerId =
      String(activeCampaign?.selectedCallerId || '').trim() ||
      pickRandomCallerId(activeCampaign?.callerId);

    const extraHeaders = [
      `X-CampaignUuid: ${campaignUuid}`,
      `X-CampaignName: ${campaignDisplayName}`,
      `X-CampaignType: ${campaignDialMethod}`,
      `X-ContactName: ${contactName}`,
      `X-ContactUuid: ${contactUuid}`,
      `X-CampaignNumberUuid: ${campaignNumberUuid}`,
      `X-CallerId: ${randomCallerId}`,
    ];

    makeCall(normalizedContactNumber, { extraHeaders });
  }, [
    activeCampaign?.callerId,
    activeCampaign?.selectedCallerId,
    activeCampaignDialMethod,
    activeCampaignId,
    activeCampaignName,
    firstCampaignCard?.campaignDetail?.campaignName,
    firstCampaignCard?.campaignDetail?.campaignType,
    firstCampaignCard?.campaignId,
    firstCampaignCard?.contactId,
    firstCampaignCard?.contactName,
    firstCampaignCard?._id,
    isRegistered,
    makeCall,
    normalizedContactNumber,
    showLeadValidationRefreshAlert,
    validateLeadBeforeCall,
  ]);

  useEffect(() => {
    if (!isProgressiveDialMethod) return;
    if (!canCall) return;
    // An ended/failed campaign session remains present during wrap-up. Treat it as
    // active workflow state so changing dialpad views cannot re-dial its lead.
    if (hasLiveDialpadSession || hasCampaignSessionForCurrentCampaign) return;

    const progressiveContactKey =
      firstCampaignCard?._id?.trim() ||
      firstCampaignCard?.contactId?.trim() ||
      normalizedContactNumber ||
      '';
    if (!progressiveContactKey) return;
    if (progressiveAutoDialContactKey === progressiveContactKey) return;

    // Keep this key in DialpadProvider-backed campaign state. The campaign overview
    // unmounts in Micro view, while refs owned by this component do not survive.
    setActiveCampaign((prev: any) => ({
      ...(prev || {}),
      progressiveAutoDialContactKey: progressiveContactKey,
    }));
    handleCall();
  }, [
    canCall,
    firstCampaignCard?._id,
    firstCampaignCard?.contactId,
    hasCampaignSessionForCurrentCampaign,
    hasLiveDialpadSession,
    handleCall,
    isProgressiveDialMethod,
    normalizedContactNumber,
    progressiveAutoDialContactKey,
    setActiveCampaign,
  ]);

  const applyNewCampaignContacts = useCallback(
    (rows: any[] | null) => {
      // Always restart preview timer for freshly loaded lead cards.
      previewTimerReferenceMapRef.current = {};
      previewTimerSnapshotRef.current = previewTimeSeconds;
      const callableContacts = Array.isArray(rows)
        ? rows.filter((contact) => !isScheduledForFuture(contact))
        : rows;

      // A completed contact-list request represents a new progressive auto-dial
      // opportunity, even when the backend intentionally returns a retry lead.
      setActiveCampaign((prev: any) =>
        prev
          ? {
              ...prev,
              progressiveAutoDialContactKey: '',
            }
          : prev,
      );
      setCampaignContactCards(callableContacts);
    },
    [previewTimeSeconds, setActiveCampaign, setCampaignContactCards],
  );

  const triggerPredictiveCampaignFlow = useCallback(async () => {
    if (!socketEventsManager || !resolvedCampaignId || !currentUserUuid) return;

    socketEventsManager.emit(
      'campaign-system-events',
      {
        body: {
          campaignId: resolvedCampaignId,
          queue: activeCampaign?.queue || '',
          user_uuid: currentUserUuid,
          userDetail: userDetailsPayload,
        },
      },
      (res: any) => {
        const campaignStatusFromEvent = getCampaignStatus(res);
        if (isCampaignStopStatus(campaignStatusFromEvent)) {
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
        campaign_uuid: resolvedCampaignId,
        status: 'Available',
        state: 'Waiting',
      });
      console.log('makeCallQueueAvailable response:', availabilityResponse);
    } catch (error) {
      console.error('makeCallQueueAvailable failed for predictive campaign:', error);
    }
  }, [
    activeCampaign?.queue,
    currentUserUuid,
    resolvedCampaignId,
    setActiveCampaign,
    setCampaignContactCards,
    socketEventsManager,
    userDetailsPayload,
  ]);

  const handleSkip = useCallback(
    (status: CampaignSkipStatus = 'SKIPPED', options?: { isManual?: boolean }) => {
      if (isSkipLoading) return;
      if (!socketEventsManager || !resolvedCampaignId || !currentUserUuid || !currentCompanyUuid)
        return;

      const durationSnapshot =
        !isProgressiveDialMethod && previewTimeSeconds > 0
          ? Math.max(0, Math.floor(previewTimerSnapshotRef.current))
          : Math.max(0, Math.floor(previewTimeSeconds));

      setIsSkipLoading(true);
      if (options?.isManual) {
        handleAlert({ text: 'Contact Skipped', type: 'success' });
      }

      try {
        socketEventsManager.emit(
          'campaign-skip-lead',
          {
            body: {
              campaignId: resolvedCampaignId,
              campaignNumberId: firstCampaignCard?._id?.trim() || '',
              userDetail: userDetailsPayload,
              next_action: {
                campaign_number: {
                  ...firstCampaignCard,
                },
                status,
                duration: durationSnapshot,
              },
            },
          },
          (res: any) => {
            console.log('🚀 ~ DialpadCampaignOverview Skipped event callback ~ res:', res);
          },
        );

        if (isPredictiveDialMethod) {
          void triggerPredictiveCampaignFlow().finally(() => {
            if (!isDialpadOpen) {
              openDialpad('maxi');
            }
            setIsSkipLoading(false);
          });
          return;
        }

        setCampaignContactCards([]);
        setActiveCampaign((prev: any) => ({
          ...(prev || {}),
          manualStatus: 'PROCESSING',
          nextContactDelayMs: isPreviewDialMethod
            ? PREVIEW_SKIP_NEXT_CONTACT_DELAY_MS
            : PROGRESSIVE_SKIP_NEXT_CONTACT_DELAY_MS,
          deferredNextAction: {
            campaign_number: {
              ...firstCampaignCard,
            },
            status,
            duration: durationSnapshot,
          },
        }));
        if (!isDialpadOpen) {
          openDialpad('maxi');
        }
        setIsSkipLoading(false);
      } catch {
        setIsSkipLoading(false);
      }
    },
    [
      currentCompanyUuid,
      currentUserUuid,
      firstCampaignCard,
      isDialpadOpen,
      isProgressiveDialMethod,
      isPreviewDialMethod,
      isPredictiveDialMethod,
      isSkipLoading,
      openDialpad,
      previewTimeSeconds,
      resolvedCampaignId,
      triggerPredictiveCampaignFlow,
      setCampaignContactCards,
      socketEventsManager,
      setActiveCampaign,
      userDetailsPayload,
    ],
  );

  const handlePreviewTimerValueChange = useCallback((remainingSeconds: number) => {
    previewTimerSnapshotRef.current = Math.max(0, Math.floor(remainingSeconds));
  }, []);

  const tryfetchingNewContacts = useCallback(() => {
    if (isTryFetchingContactsPendingRef.current) return;
    if (!socketEventsManager || !resolvedCampaignId || !currentUserUuid || !currentCompanyUuid)
      return;

    const durationSnapshot = Math.max(
      0,
      Math.floor(previewTimerSnapshotRef.current || previewTimeSeconds || 0),
    );
    const defaultNextActionPayload = {
      campaign_number: {
        ...firstCampaignCard,
      },
      status: '',
      duration: durationSnapshot,
    };
    const resolvedNextActionPayload =
      deferredNextActionFromCampaign !== undefined
        ? deferredNextActionFromCampaign
        : defaultNextActionPayload;

    isTryFetchingContactsPendingRef.current = true;
    try {
      if (isPredictiveDialMethod) {
        void triggerPredictiveCampaignFlow().finally(() => {
          if (!isDialpadOpen) {
            openDialpad('maxi');
          }
          isTryFetchingContactsPendingRef.current = false;
        });
        return;
      }

      const previewContactListBody: Record<string, any> = {
        campaignId: resolvedCampaignId,
        user_uuid: currentUserUuid,
        company_uuid: currentCompanyUuid,
        userDetail: userDetailsPayload,
      };
      if (resolvedNextActionPayload !== null) {
        previewContactListBody.next_action = resolvedNextActionPayload;
      }

      socketEventsManager.emit(
        'campaign-preview-contact-list',
        {
          body: previewContactListBody,
        },
        (res: any) => {
          const campaignStatus = getCampaignStatus(res);
          if (isCampaignStopStatus(campaignStatus)) {
            setCampaignContactCards([]);
            setActiveCampaign((prev: any) => ({
              ...(prev || {}),
              manualStatus: campaignStatus,
            }));
            isTryFetchingContactsPendingRef.current = false;
            return;
          }

          const rows = getCampaignRows(res);
          const callableContacts = rows.filter((contact: any) => !isScheduledForFuture(contact));
          const nextRetryAt = rows.reduce((earliest: number | null, contact: any) => {
            const retryDate = contact?.startExecutionDate || contact?.sipcallDetail?.[0]?.retryDate;
            const retryTime = retryDate ? new Date(retryDate).getTime() : NaN;

            if (!Number.isFinite(retryTime) || retryTime <= Date.now()) return earliest;
            return earliest === null ? retryTime : Math.min(earliest, retryTime);
          }, null);
          const scheduledRetryMs = nextRetryAt
            ? Math.max(1000, Math.min(nextRetryAt - Date.now(), CONTACT_RETRY_MS))
            : CONTACT_RETRY_MS;

          setActiveCampaign((prev: any) =>
            prev
              ? {
                  ...prev,
                  manualStatus: campaignStatus,
                  deferredNextAction: undefined,
                  nextContactDelayMs:
                    callableContacts.length > 0 ? WAIT_AFTER_CALL_MS : scheduledRetryMs,
                }
              : prev,
          );
          applyNewCampaignContacts(rows);
          if (!isDialpadOpen) {
            openDialpad('maxi');
          }
          isTryFetchingContactsPendingRef.current = false;
        },
      );
    } catch {
      isTryFetchingContactsPendingRef.current = false;
    }
  }, [
    currentCompanyUuid,
    currentUserUuid,
    firstCampaignCard,
    isDialpadOpen,
    isPredictiveDialMethod,
    openDialpad,
    deferredNextActionFromCampaign,
    previewTimeSeconds,
    resolvedCampaignId,
    applyNewCampaignContacts,
    triggerPredictiveCampaignFlow,
    setActiveCampaign,
    setCampaignContactCards,
    socketEventsManager,
    userDetailsPayload,
  ]);

  useEffect(() => {
    if (!leadValidationAlert.open) {
      if (leadValidationCountdownTimeoutRef.current) {
        clearTimeout(leadValidationCountdownTimeoutRef.current);
        leadValidationCountdownTimeoutRef.current = null;
      }
      return;
    }

    if (leadValidationAlert.countdown <= 0) {
      const shouldRefresh = leadValidationAlert.shouldRefresh;
      setLeadValidationAlert({
        open: false,
        message: '',
        countdown: 3,
        shouldRefresh: false,
      });
      if (shouldRefresh) {
        setActiveCampaign((prev: any) => ({
          ...(prev || {}),
          manualStatus: 'PROCESSING',
          nextContactDelayMs: 0,
        }));
        tryfetchingNewContacts();
      }
      return;
    }

    leadValidationCountdownTimeoutRef.current = setTimeout(() => {
      setLeadValidationAlert((prev) => ({
        ...prev,
        countdown: Math.max(0, prev.countdown - 1),
      }));
    }, 1000);

    return () => {
      if (leadValidationCountdownTimeoutRef.current) {
        clearTimeout(leadValidationCountdownTimeoutRef.current);
        leadValidationCountdownTimeoutRef.current = null;
      }
    };
  }, [leadValidationAlert, setActiveCampaign, tryfetchingNewContacts]);

  const handleEmptyQueueTimerEnds = useCallback(() => {
    if (!shouldShowProcessingLoopTimer) return;
    tryfetchingNewContacts();
    setEmptyQueueTimerRunId((previousValue) => previousValue + 1);
  }, [shouldShowProcessingLoopTimer, tryfetchingNewContacts]);

  const handleLeaveCampaign = useCallback(async () => {
    if (hasCampaignSessionForCurrentCampaign) {
      handleAlert({
        text: 'There is an active call going on. Disposition the call first.',
        type: 'error',
      });
      return;
    }

    try {
      if (isPredictiveDialMethod && resolvedCampaignId) {
        const availabilityResponse = await makeCallQueueAvailable({
          campaign_uuid: resolvedCampaignId,
          status: 'On Break',
          state: 'Idle',
        });
        console.log('makeCallQueueAvailable leave response:', availabilityResponse);
      }
    } catch (error) {
      console.error('makeCallQueueAvailable failed while leaving campaign:', error);
    } finally {
      socketEventsManager?.emit('campaign-event-logs', {
        campaignDetail: {
          campaignName,
          campaignId: resolvedCampaignId,
          companyId: activeCampaign?.companyId,
        },
        eventType: 'DELETE',
        userDetail: userDetailsPayload,
      });
      startCampaignClearingTimer();
      previewTimerReferenceMapRef.current = {};
      previewTimerSnapshotRef.current = 0;
      isTryFetchingContactsPendingRef.current = false;
      setEmptyQueueTimerRunId(0);
      setCampaignContactCards(null);
      setActiveCampaign(null);
      setJoinedCampaignId(null);
      clearAllSessions();
      closeDialpad();
    }
  }, [
    activeCampaign?.companyId,
    campaignName,
    hasCampaignSessionForCurrentCampaign,
    clearAllSessions,
    closeDialpad,
    isPredictiveDialMethod,
    resolvedCampaignId,
    setActiveCampaign,
    startCampaignClearingTimer,
    setCampaignContactCards,
    setJoinedCampaignId,
    socketEventsManager,
    userDetailsPayload,
  ]);

  useEffect(() => {
    const activityCampaignId = String(ongoingCampaignActivity?._id || '').trim();
    if (!activityCampaignId || activityCampaignId !== resolvedCampaignId) return;

    const activityStatus = String(ongoingCampaignActivity?.campaignStatus || '')
      .trim()
      .toUpperCase();
    if (activityStatus !== 'PAUSE') return;

    setCampaignContactCards([]);
    setActiveCampaign((prev: any) => ({
      ...(prev || {}),
      manualStatus: activityStatus,
    }));
    setOngoingCampaignActivity(null);
  }, [
    ongoingCampaignActivity,
    resolvedCampaignId,
    setActiveCampaign,
    setCampaignContactCards,
    setOngoingCampaignActivity,
  ]);

  useEffect(() => {
    if (!socketEventsManager || !resolvedCampaignId) return;

    Object.values(sessions).forEach((session) => {
      const sessionCampaignId = String(
        session?.campaignMetaData?.id ||
          session?.liveCallData?.campaign_uuid ||
          (String(session?.liveCallData?.forward_type || '').toUpperCase() === 'CAMPAIGN'
            ? session?.liveCallData?.forward_value
            : '') ||
          getHeaderFirstValue(session?.headers, 'x-campaignuuid') ||
          '',
      ).trim();
      if (sessionCampaignId !== resolvedCampaignId) return;

      const normalizedStatus = String(session?.status || '')
        .trim()
        .toLowerCase();
      const campaignNumberId = String(
        session?.liveCallData?.campaign_number_uuid ||
          getHeaderFirstValue(session?.headers, 'x-campaignnumberuuid') ||
          firstCampaignCard?._id ||
          '',
      ).trim();
      const sipcallID = String(
        session?.liveCallData?.sip_call_id ||
          getHeaderFirstValue(session?.headers, 'x-cid') ||
          getHeaderFirstValue(session?.headers, 'call-id') ||
          session?.id ||
          '',
      ).trim();

      if (normalizedStatus === 'connecting') {
        const eventKey = `CONNECTING:${campaignNumberId || sipcallID}`;
        if (!emittedCallEventKeysRef.current.has(eventKey)) {
          emittedCallEventKeysRef.current.add(eventKey);
          socketEventsManager.emit('campaign-lead-wrap', {
            type: 'CONNECTING',
            campaignId: resolvedCampaignId,
            campaignNumberId,
            status: 'CONNECTING',
            sipcallID,
            direction: session?.direction,
            phone: firstCampaignCard?.contactNumber || session?.remoteNumber,
            didNumber:
              getHeaderFirstValue(session?.headers, 'x-callerid') ||
              activeCampaign?.selectedCallerId ||
              (Array.isArray(activeCampaign?.callerId)
                ? activeCampaign.callerId[0]
                : activeCampaign?.callerId),
            userDetail: userDetailsPayload,
          });
        }
      }

      if (['ended', 'failed'].includes(normalizedStatus)) {
        const wrapupEventKey = `${session?.id}:${session?.endedAt || ''}`;
        if (emittedWrapupEventKeysRef.current.has(wrapupEventKey)) return;

        emittedWrapupEventKeysRef.current.add(wrapupEventKey);
        socketEventsManager.emit('callcenter.agent-wrapup-started', {
          type: 'agent-wrapup-started',
          agentName: `${userDetailsPayload.extension}@${userDetailsPayload.domain}`,
          status: 'Wrap-Up',
          queue: activeCampaign?.queue || '',
          wrapupDuration: activeCampaign?.dialerSetting?.wrapup_time ?? 0,
          timestamp: new Date().toISOString(),
          start_time: '',
          answered_time: '',
        });
      }
    });
  }, [
    activeCampaign?.callerId,
    activeCampaign?.selectedCallerId,
    activeCampaign?.dialerSetting?.wrapup_time,
    activeCampaign?.queue,
    firstCampaignCard?._id,
    firstCampaignCard?.contactNumber,
    resolvedCampaignId,
    sessions,
    socketEventsManager,
    userDetailsPayload,
  ]);

  useEffect(() => {
    if (!resolvedCampaignId || !isPredictiveDialMethod) return;

    let didRunUnloadCleanup = false;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!didRunUnloadCleanup) {
        didRunUnloadCleanup = true;
        try {
          const accessToken = localStorage.getItem(SESSION_NAME);
          const apiBaseUrl = String(getEnv().VITE_API_BASE_URL || '').replace(/\/$/, '');
          void fetch(`${apiBaseUrl}/api/call-queue/agent/status`, {
            method: 'POST',
            body: JSON.stringify({
              campaign_uuid: resolvedCampaignId,
              status: 'On Break',
              state: 'Idle',
            }),
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            keepalive: true,
          }).catch(() => undefined);
        } catch {
          // Browser unload cleanup is best-effort.
        }
      }

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload as EventListener);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload as EventListener);
    };
  }, [isPredictiveDialMethod, resolvedCampaignId]);

  if (isPredictiveDialMethod && dialpadScreen === 'idle' && !hasAnyDialpadSession) {
    return (
      <div className="relative mb-2 mt-1">
        <div className="rounded-xl border border-ucass-active-bg bg-gradient-to-r from-[#f8fbff] to-[#f1f7ff] p-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative h-11 w-11 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
              <span className="absolute inset-1 flex items-center justify-center rounded-full bg-primary text-white shadow-sm">
                <PhoneCall className="h-4 w-4" />
              </span>
            </div>

            <div className="min-w-0 flex-1 text-left">
              <p className="text-[12px] font-semibold text-[#183960] sm:text-sm">
                Waiting for call
              </p>
              <p className="mt-0.5 truncate text-[10px] text-[#6a7f9e] sm:text-xs">
                Connecting you to the next campaign contact.
              </p>
              <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[10px] font-medium text-[#5a7396]">
                  {campaignName}
                </span>
                <span className="rounded-full border border-ucass-active-bg bg-ucass-active-bg px-2 py-0.5 text-[9px] font-semibold tracking-[0.04em] text-[#1f4f8f]">
                  {campaignType}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
              <button
                type="button"
                onClick={handleLeaveCampaign}
                className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-100"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isPredictiveDialMethod) {
    return null;
  }

  if (campaignContactCards === null) {
    return null;
  }

  const leadValidationDialog = (
    <Dialog open={leadValidationAlert.open}>
      <DialogContent
        className="z-[1401] w-[calc(100vw-2rem)] max-w-[430px] gap-0 rounded-xl border border-gray-200 bg-white p-0 shadow-2xl"
        overlayClassName="z-[1400]"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <div className="flex flex-col items-center gap-4 px-6 py-7 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-gray-900">Campaign lead updated</h3>
            <p className="text-sm leading-6 text-gray-600">{leadValidationAlert.message}</p>
            <p className="text-sm font-semibold text-primary">
              Fetching a new lead in {leadValidationAlert.countdown}s...
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  console.log('🚀 ~ DialpadCampaignOverview ~ totalContacts:', totalContacts);
  if (totalContacts === 0) {
    return (
      <div className="relative mb-2 mt-1 overflow-hidden rounded-2xl border border-ucass-active-bg bg-[radial-gradient(circle_at_20%_20%,rgba(177,211,255,0.35),transparent_48%),radial-gradient(circle_at_85%_80%,rgba(143,196,255,0.22),transparent_48%),linear-gradient(135deg,#f7fbff,#eef5ff)] px-3 py-3">
        <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-ucass-active-bg/70 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-7 -left-6 h-20 w-20 rounded-full bg-ucass-active-bg/70 blur-2xl" />

        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col items-start gap-2 text-left">
            <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-ucass-active-bg bg-white/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
              <Clock3 className="h-3.5 w-3.5" />
              Campaign Queue
            </div>

            <p className="text-[12px] font-semibold leading-snug text-[#183960] sm:text-sm">
              Waiting for another contact.
            </p>
          </div>

          {shouldShowProcessingLoopTimer ? (
            <div className="self-center sm:self-auto">
              <DialpadCountdownRingTimer
                key={`empty-queue-timer-${resolvedCampaignId || 'default'}-${emptyQueueTimerRunId}`}
                currentTimeSeconds={nextContactDelaySeconds}
                onTimeEnds={handleEmptyQueueTimerEnds}
              />
            </div>
          ) : null}
        </div>
        {leadValidationDialog}
      </div>
    );
  }

  return (
    <div className="relative mb-2 mt-1">
      <Accordion
        type="single"
        collapsible
        value={accordionValue}
        onValueChange={handleAccordionValueChange}
      >
        <AccordionItem value={CAMPAIGN_OVERVIEW_ACCORDION_VALUE} className="relative border-0">
          <AccordionContent className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-20 !pb-0 !pt-0">
            <DialpadCampaignContactCard
              firstCampaignCard={firstCampaignCard}
              onCall={handleCall}
              onSkip={handleSkip}
              canCall={canCall}
              canSkip={canSkip}
              showCallButton={!isProgressiveDialMethod}
              isSkipLoading={isSkipLoading}
              allowSkipping={!isProgressiveDialMethod && allowSkipping}
              previewTimeSeconds={isProgressiveDialMethod ? 0 : previewTimeSeconds}
              timerReferenceTimestampMs={
                isProgressiveDialMethod ? undefined : previewTimerReferenceTimestampMs
              }
              timerKey={previewTimerKey}
              onTimerValueChange={handlePreviewTimerValueChange}
            />
          </AccordionContent>

          <AccordionTrigger
            variant="default"
            className="rounded-xl border border-ucass-active-bg bg-gradient-to-r from-[#f8fbff] to-[#f1f7ff] px-3 py-2 hover:no-underline"
          >
            <div className="flex w-full min-w-0 items-center justify-between gap-2 text-left">
              <p className="truncate text-[12px] font-semibold text-[#183960]">{campaignName}</p>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-full border border-ucass-active-bg bg-ucass-active-bg px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-[#1f4f8f]">
                  {campaignType}
                </span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleLeaveCampaign();
                  }}
                  className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-100"
                >
                  Leave
                </button>
              </div>
            </div>
          </AccordionTrigger>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default DialpadCampaignOverview;
