import type { DialpadSession } from '@/context/dialpad-context';
import { FaPhone } from '@/assets/icons';
import { useDialpad } from '@/hooks/use-dialpad';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useCompanyFeatures } from '@/hooks/rbac';
import {
  ArrowRightLeft,
  Circle,
  FileText,
  Keyboard,
  MergeIcon,
  Mic,
  MicOff,
  NotebookPen,
  PauseCircle,
  PlayCircle,
  Sparkles,
  UserPlus,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { DialpadMaxiTab } from './dialpad-maxi-side-panel';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import DialpadAddUserList from './dialpad-add-user-list';
import DialpadConferenceMembersList from './dialpad-conference-members-list';
import DialpadDTMFPanel from './dialpad-dtmf-panel';
import DialpadMergeList from './dialpad-merge-list';
import DialpadSessionSummaryCard from './dialpad-session-summary-card';
import DialpadTransferList from './dialpad-transfer-list';
import { useUser } from '@/hooks/use-user';
import { isExtensionDialTarget } from '@/lib/extension-utility';
import { getHeaderFirstValue, getMonitoringCallLabel } from '../session-display';

type DialpadConnectedScreenProps = {
  session: DialpadSession | null;
  onHoldToggle: () => void;
  onMuteToggle: () => void;
  onSpeakerToggle: () => void;
  onEndCall: () => void;
  isHold: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  onOpenMaxiTab: (tab: DialpadMaxiTab) => void;
};

type ConnectedActionProps = {
  label: string;
  activeLabel?: string;
  active?: boolean;
  icon: ReactNode;
  activeIcon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  activeVariant?: 'default' | 'recording';
  className?: string;
};

type SentimentScores = {
  positive: number;
  neutral: number;
  negative: number;
};

type AddUserPanelMode = 'conference' | 'pre-conference';

const parseHeaderBoolean = (rawValue: unknown): boolean => {
  const normalizedValue = String(rawValue || '')
    .trim()
    .toLowerCase();
  return ['true', '1', 'yes', 'y', 'on'].includes(normalizedValue);
};

const ConnectedAction = ({
  label,
  activeLabel,
  active = false,
  icon,
  activeIcon,
  onClick,
  disabled = false,
  danger = false,
  activeVariant = 'default',
  className,
}: ConnectedActionProps) => {
  const activeBase =
    activeVariant === 'recording'
      ? 'bg-[#d62839] text-white border-[#d62839] hover:bg-[#bf2738] hover:border-[#bf2738] shadow-[0_0_0_4px_rgba(220,38,38,0.14),0_8px_16px_rgba(194,35,52,0.2)]'
      : 'bg-primary text-white border-primary hover:bg-primary hover:border-primary';

  const base = disabled
    ? 'bg-[#f7f9fd] text-[#95a4b8] border-[#e2e9f4] shadow-none'
    : danger
      ? 'bg-[#dc3545] text-white border-[#dc3545] hover:bg-[#bf2738] hover:border-[#bf2738]'
      : active
        ? activeBase
        : 'bg-ucass-active-bg text-[#224162] border-ucass-active-bg hover:bg-primary hover:text-white hover:border-primary';
  const iconMotionClass =
    active && activeVariant === 'recording' ? 'animate-[pulse_1.5s_ease-in-out_infinite]' : '';
  const labelClass = danger
    ? 'text-[#cf3647]'
    : active && activeVariant === 'recording'
      ? 'text-[#c62839]'
      : 'text-[#60708c]';

  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={`${className || ''} appearance-none border-0 bg-transparent p-0 w-full max-w-[70px] justify-self-center flex justify-center disabled:cursor-not-allowed items-center flex-col max-[380px]:max-w-[62px] sm:max-w-[76px] md:max-w-[80px] lg:max-w-[86px] ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <span
        className={`flex h-11 w-11 flex-col items-center justify-center rounded-full border shadow-[0_4px_8px_rgba(33,56,90,0.08)] transition max-[380px]:h-[38px] max-[380px]:w-[38px] sm:h-12 sm:w-12 md:h-[52px] md:w-[52px] lg:h-14 lg:w-14 ${base} ${iconMotionClass}`}
      >
        <span className="max-[380px]:[&_svg]:h-4 max-[380px]:[&_svg]:w-4">
          {active && activeIcon ? activeIcon : icon}
        </span>
      </span>
      <span
        className={`mt-1 block w-full text-center text-[9px] font-semibold max-[380px]:text-[8px] sm:mt-1.5 sm:text-[10px] md:text-[10.5px] lg:text-[11px] ${labelClass}`}
      >
        {active && activeLabel ? activeLabel : label}
      </span>
    </button>
  );
};

const HIDE_AI_ASSIST = false;

const DialpadConnectedScreen = ({
  session,
  onHoldToggle,
  onMuteToggle,
  onSpeakerToggle,
  onEndCall,
  isHold,
  isMuted,
  isSpeakerOn,
  onOpenMaxiTab,
}: DialpadConnectedScreenProps) => {
  const { user } = useUser();
  const { features } = useCompanyFeatures();
  const { sentimentData = {} } = useSocketEvents();
  const { sessions, sendDtmf, activeCampaign, activeSpeakFirstTarget, handleTransfer } =
    useDialpad();
  const advanceCallManagementAccess =
    features?.plan_features?.advance_call_management?.access || {};
  const canShowRecordingAction = Boolean(advanceCallManagementAccess.RECORDING);
  const canShowTranscriptionAction = Boolean(advanceCallManagementAccess.TRANSCRIPTION);
  const canShowAiAssistAction = HIDE_AI_ASSIST;
  // const canShowAiAssistAction = HIDE_AI_ASSIST || Boolean(features?.plan_features?.ai?.IS_SHOW);

  const [activePanel, setActivePanel] = useState<
    'transfer' | 'merge' | 'conference-members' | 'add-user' | 'dtmf' | null
  >(null);
  const [addUserPanelMode, setAddUserPanelMode] = useState<AddUserPanelMode | null>(null);
  const [recordingOverrideBySession, setRecordingOverrideBySession] = useState<
    Record<string, boolean>
  >({});

  const closeActivePanel = useCallback(() => {
    setActivePanel(null);
    setAddUserPanelMode(null);
  }, []);

  const openAddUserPanel = useCallback((mode: AddUserPanelMode) => {
    setAddUserPanelMode(mode);
    setActivePanel('add-user');
  }, []);

  const sessionForStatus = useMemo<DialpadSession | null>(() => {
    if (!session) return null;
    return {
      ...session,
      isOnHold: isHold,
      isMuted,
      isSpeakerOn,
    };
  }, [isHold, isMuted, isSpeakerOn, session]);

  const isRecording = Boolean(sessionForStatus?.isRecording);
  const isInboundCall = String(sessionForStatus?.direction || '').toLowerCase() === 'incoming';
  const isOutboundCall = String(sessionForStatus?.direction || '').toLowerCase() === 'outgoing';
  const queueIdFromSession = String(sessionForStatus?.queueMetaData?.id || '').trim();
  const campaignIdFromSession = String(
    sessionForStatus?.campaignMetaData?.id || sessionForStatus?.liveCallData?.campaign_uuid || '',
  ).trim();
  const forwardTypeFromHeader = String(
    Object.entries(sessionForStatus?.headers || {}).find(
      ([headerName]) => headerName.trim().toLowerCase() === 'x-forwardtype',
    )?.[1]?.[0] || '',
  )
    .trim()
    .toUpperCase();
  const liveForwardType = String(sessionForStatus?.liveCallData?.forward_type || '')
    .trim()
    .toUpperCase();
  const liveCampaignType = String(sessionForStatus?.liveCallData?.campaign_type || '')
    .trim()
    .toUpperCase();
  const shouldForceCampaignFromHeader =
    Boolean(queueIdFromSession && campaignIdFromSession) && forwardTypeFromHeader === 'CAMPAIGN';
  const isQueueCallSession = shouldForceCampaignFromHeader ? false : Boolean(queueIdFromSession);
  const isCampaignCallSession = shouldForceCampaignFromHeader
    ? true
    : Boolean(
        campaignIdFromSession ||
        forwardTypeFromHeader === 'CAMPAIGN' ||
        liveForwardType === 'CAMPAIGN' ||
        liveCampaignType,
      );
  const isCampaignOrQueueCall = isQueueCallSession || isCampaignCallSession;
  const activeCampaignId = String(activeCampaign?._id || '').trim();
  const shouldUseActiveCampaignRecordingSettings =
    isCampaignCallSession &&
    Boolean(activeCampaignId) &&
    (!campaignIdFromSession || campaignIdFromSession === activeCampaignId);
  const recordHeaderValue = Object.entries(sessionForStatus?.headers || {}).find(
    ([headerName]) => headerName.trim().toLowerCase() === 'x-record',
  )?.[1]?.[0];
  const recordDynamicHeaderValue = Object.entries(sessionForStatus?.headers || {}).find(
    ([headerName]) => headerName.trim().toLowerCase() === 'x-recorddynamic',
  )?.[1]?.[0];
  const inboundRecordEnabled = parseHeaderBoolean(recordHeaderValue);
  const inboundRecordDynamicEnabled = parseHeaderBoolean(recordDynamicHeaderValue);
  const campaignAutomaticRecordingEnabled =
    shouldUseActiveCampaignRecordingSettings &&
    Boolean((activeCampaign as any)?.settings?.recording?.automatic?.enabled);
  const campaignOnDemandRecordingEnabled =
    shouldUseActiveCampaignRecordingSettings &&
    Boolean((activeCampaign as any)?.settings?.recording?.on_demand?.enabled);

  const shouldActivateRecording = user?.settings?.recording?.automatic?.enabled
    ? user?.settings?.recording?.automatic?.value === 'all'
      ? true
      : isInboundCall
        ? user?.settings?.recording?.automatic?.value === 'incoming'
        : isOutboundCall
          ? user?.settings?.recording?.automatic?.value === 'outgoing'
          : false
    : false;

  const outboundAutomaticRecordingEnabled =
    shouldActivateRecording || campaignAutomaticRecordingEnabled;
  const outboundOnDemandRecordingEnabled =
    Boolean(user?.settings?.recording?.on_demand?.enabled) || campaignOnDemandRecordingEnabled;
  const automaticRecordingEnabled = isInboundCall
    ? inboundRecordEnabled
    : isOutboundCall
      ? outboundAutomaticRecordingEnabled
      : false;
  const manualRecordingOverride =
    sessionForStatus?.id &&
    Object.prototype.hasOwnProperty.call(recordingOverrideBySession, sessionForStatus.id)
      ? recordingOverrideBySession[sessionForStatus.id]
      : null;
  const isRecordingVisible =
    manualRecordingOverride === null
      ? automaticRecordingEnabled || isRecording
      : manualRecordingOverride;
  const canToggleRecording = (automaticRecordingEnabled || Boolean(sessionForStatus?.recordingLocked))
    ? false
    : isInboundCall
      ? inboundRecordDynamicEnabled
      : isOutboundCall
        ? outboundOnDemandRecordingEnabled
        : false;
  const sessionStatus = String(sessionForStatus?.status || '').toLowerCase();
  const shouldShowRecordAction = !['connecting', 'ringing'].includes(sessionStatus);
  const isSessionConnected = ['accepted', 'confirmed'].includes(sessionStatus);
  const monitoringCallLabel = getMonitoringCallLabel(
    sessionForStatus?.remoteNumber || sessionForStatus?.extension || '',
  );
  const shouldLockConnectedActions = Boolean(monitoringCallLabel);
  const isConferenceSession = Boolean(sessionForStatus?.conferenceData);
  const sessionDialTarget = String(
    sessionForStatus?.remoteNumber || sessionForStatus?.extension || '',
  ).trim();
  const isExtensionCallSession = isExtensionDialTarget(sessionDialTarget);

  useEffect(() => {
    setRecordingOverrideBySession((previousState) => {
      const existingSessionIds = new Set(Object.keys(sessions));
      let hasChanges = false;
      const nextState: Record<string, boolean> = {};

      Object.entries(previousState).forEach(([sessionId, overrideValue]) => {
        if (!existingSessionIds.has(sessionId)) {
          hasChanges = true;
          return;
        }
        nextState[sessionId] = overrideValue;
      });

      return hasChanges ? nextState : previousState;
    });
  }, [sessions]);

  useEffect(() => {
    if (!shouldLockConnectedActions) return;
    if (!activePanel) return;
    closeActivePanel();
  }, [activePanel, closeActivePanel, shouldLockConnectedActions]);

  useEffect(() => {
    if (!['ended', 'failed'].includes(sessionStatus)) return;
    if (!activePanel) return;
    closeActivePanel();
  }, [activePanel, closeActivePanel, sessionStatus]);

  const sentimentScores = useMemo<SentimentScores | null>(() => {
    const liveCallData = sessionForStatus?.liveCallData || {};
    const callIdCandidates = [
      ...(Array.isArray(liveCallData?.sip_call_ids) ? liveCallData.sip_call_ids : []),
      liveCallData?.sip_call_id,
      liveCallData?.sipCallId,
      liveCallData?.SipCallID,
      liveCallData?.call_uuid,
      liveCallData?.callUuid,
      liveCallData?.call_id,
      liveCallData?.callId,
      liveCallData?.b_leg_uuid,
      liveCallData?.leg_uuid,
      liveCallData?.member_uuid,
      liveCallData?.uuid,
      getHeaderFirstValue(sessionForStatus?.headers, 'x-cid'),
      getHeaderFirstValue(sessionForStatus?.headers, 'call-id'),
      sessionForStatus?.id,
    ]
      .map((callId) =>
        String(callId || '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
    const socketSentimentScores = callIdCandidates
      .map((callId) => sentimentData?.[callId])
      .find(Boolean);
    const rawSentimentScores =
      socketSentimentScores || sessionForStatus?.liveCallData?.sentiment_scores;
    if (!rawSentimentScores) return null;

    let parsedSentimentScores: any = rawSentimentScores;
    if (typeof rawSentimentScores === 'string') {
      try {
        parsedSentimentScores = JSON.parse(rawSentimentScores);
      } catch {
        return null;
      }
    }

    if (!parsedSentimentScores || typeof parsedSentimentScores !== 'object') return null;

    const normalizeScore = (value: unknown) => {
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue)) return 0;
      if (parsedValue < 0) return 0;
      if (parsedValue > 100) return 100;
      return parsedValue;
    };

    return {
      positive: normalizeScore(parsedSentimentScores.positive),
      neutral: normalizeScore(parsedSentimentScores.neutral),
      negative: normalizeScore(parsedSentimentScores.negative),
    };
  }, [sentimentData, sessionForStatus]);
  const hasMultipleLiveSessions = useMemo(
    () =>
      Object.values(sessions).filter(
        (sessionItem) => !['ended', 'failed'].includes(sessionItem.status),
      ).length > 1,
    [sessions],
  );
  const shouldShowMergeAction = hasMultipleLiveSessions && !isConferenceSession;
  const canOpenMergePanel = useMemo(() => {
    if (!sessionForStatus?.id) return false;

    const activeSessionStatus = String(sessionForStatus?.status || '').toLowerCase();
    const isActiveSessionConnected = ['accepted', 'confirmed'].includes(activeSessionStatus);
    if (!isActiveSessionConnected) return false;

    return Object.values(sessions).some((sessionItem) => {
      if (!sessionItem?.id || sessionItem.id === sessionForStatus.id) return false;
      const sessionItemStatus = String(sessionItem.status || '').toLowerCase();
      return ['accepted', 'confirmed'].includes(sessionItemStatus);
    });
  }, [sessionForStatus?.id, sessionForStatus?.status, sessions]);
  const transferNowTarget = String(activeSpeakFirstTarget || '').trim();
  const canTransferNow = Boolean(transferNowTarget && canOpenMergePanel);
  return (
    <div className="flex h-full min-h-0 flex-col w-full">
      <div className="mb-1 ">
        <DialpadSessionSummaryCard
          session={sessionForStatus}
          onConferenceMembersClick={
            sessionForStatus?.conferenceData
              ? () => setActivePanel('conference-members')
              : undefined
          }
        />
      </div>

      {activePanel === 'transfer' ? (
        <div className="min-h-0 flex-1 overflow-hidden pr-1">
          <DialpadTransferList
            onBack={closeActivePanel}
            onOpenMerge={() => setActivePanel('merge')}
          />
        </div>
      ) : activePanel === 'add-user' ? (
        <div className="min-h-0 flex-1 overflow-hidden pr-1">
          <DialpadAddUserList
            session={sessionForStatus}
            mode={
              addUserPanelMode ||
              (sessionForStatus?.conferenceData ? 'conference' : 'pre-conference')
            }
            onBack={closeActivePanel}
          />
        </div>
      ) : activePanel === 'merge' ? (
        <div className="min-h-0 flex-1 overflow-hidden pr-1">
          <DialpadMergeList session={sessionForStatus} onBack={closeActivePanel} />
        </div>
      ) : activePanel === 'conference-members' ? (
        <div className="min-h-0 flex-1 overflow-hidden pr-1">
          <DialpadConferenceMembersList session={sessionForStatus} onBack={closeActivePanel} />
        </div>
      ) : activePanel === 'dtmf' ? (
        <div className="min-h-0 flex-1 overflow-hidden pr-1">
          <DialpadDTMFPanel
            session={sessionForStatus}
            onBack={closeActivePanel}
            onSendDtmf={(value) => {
              if (!sessionForStatus?.id) return;
              sendDtmf(sessionForStatus.id, value);
            }}
          />
        </div>
      ) : (
        <div className="w-full min-h-0 flex-1 flex flex-col">
          <div className="xl:mt-4 grid grid-cols-3 gap-x-1.5 gap-y-1.5 px-0.5 max-[380px]:gap-x-1 max-[380px]:gap-y-1 sm:gap-x-2.5 sm:gap-y-2 sm:px-2 md:gap-x-3 md:gap-y-2.5 md:px-3 md:mt-3 w-full mx-auto">
            {!isConferenceSession ? (
              <ConnectedAction
                label="Hold"
                activeLabel="Unhold"
                active={isHold}
                disabled={!isSessionConnected || shouldLockConnectedActions}
                onClick={onHoldToggle}
                icon={<PauseCircle className="h-5 w-5" />}
                activeIcon={<PlayCircle className="h-5 w-5" />}
              />
            ) : null}
            <ConnectedAction
              label="Mute"
              activeLabel="Unmute"
              active={isMuted}
              disabled={!isSessionConnected || shouldLockConnectedActions}
              onClick={onMuteToggle}
              icon={<Mic className="h-5 w-5" />}
              activeIcon={<MicOff className="h-5 w-5" />}
            />
            <ConnectedAction
              label="Speaker"
              activeLabel="Speaker Off"
              active={!isSpeakerOn}
              disabled={!isSessionConnected || shouldLockConnectedActions}
              onClick={onSpeakerToggle}
              icon={<Volume2 className="h-5 w-5" />}
              activeIcon={<VolumeX className="h-5 w-5" />}
            />
            {isConferenceSession ? (
              <ConnectedAction
                label="Add User"
                active={false}
                className={isCampaignOrQueueCall ? 'hidden' : ''}
                disabled={!isSessionConnected || shouldLockConnectedActions}
                onClick={() => openAddUserPanel('conference')}
                icon={<UserPlus className="h-5 w-5" />}
              />
            ) : (
              <>
                <ConnectedAction
                  label="Transfer"
                  active={false}
                  className={isCampaignOrQueueCall || shouldShowMergeAction ? 'hidden' : ''}
                  disabled={!isSessionConnected || shouldLockConnectedActions}
                  onClick={() => setActivePanel('transfer')}
                  icon={<ArrowRightLeft className="h-5 w-5" />}
                />
                <ConnectedAction
                  label="Add Call"
                  active={false}
                  className={isCampaignOrQueueCall || shouldShowMergeAction ? 'hidden' : ''}
                  disabled={!isSessionConnected || shouldLockConnectedActions}
                  onClick={() => openAddUserPanel('pre-conference')}
                  icon={<UserPlus className="h-5 w-5" />}
                />
              </>
            )}
            {!shouldShowMergeAction && shouldShowRecordAction && canShowRecordingAction ? (
              <ConnectedAction
                label="Record"
                activeLabel={canToggleRecording ? 'Record' : 'Recording'}
                active={isRecordingVisible}
                disabled={!isSessionConnected || !canToggleRecording || shouldLockConnectedActions}
                onClick={() => {
                  if (!sessionForStatus?.id) return;
                  const shouldStartRecording = !isRecordingVisible;
                  sendDtmf(sessionForStatus.id, shouldStartRecording ? '*2' : '*3');
                  setRecordingOverrideBySession((previousState) => ({
                    ...previousState,
                    [sessionForStatus.id]: shouldStartRecording,
                  }));
                }}
                icon={<Circle className="h-5 w-5" />}
                activeIcon={
                  <span className="relative flex h-4 w-4 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-white  animate-ping" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_0_4px_rgba(220,38,38,0.24)]" />
                  </span>
                }
                activeVariant="recording"
              />
            ) : null}
            {shouldShowMergeAction ? (
              <>
                <ConnectedAction
                  label="Transfer Now"
                  active={false}
                  className={isCampaignOrQueueCall ? 'hidden' : ''}
                  disabled={!canTransferNow || shouldLockConnectedActions}
                  onClick={() => {
                    if (!transferNowTarget) return;
                    handleTransfer('transfer_now', transferNowTarget);
                  }}
                  icon={<ArrowRightLeft className="h-5 w-5" />}
                />
                <ConnectedAction
                  label="Merge"
                  active={false}
                  className={isCampaignOrQueueCall ? 'hidden' : ''}
                  disabled={!canOpenMergePanel || shouldLockConnectedActions}
                  onClick={() => setActivePanel('merge')}
                  icon={<MergeIcon className="h-5 w-5" />}
                />
              </>
            ) : null}
            {canShowTranscriptionAction && !isConferenceSession && !isExtensionCallSession ? (
              <ConnectedAction
                label="Transcript"
                active={false}
                disabled={!isSessionConnected || shouldLockConnectedActions}
                onClick={() => onOpenMaxiTab('transcript')}
                icon={<FileText className="h-5 w-5" />}
              />
            ) : null}
            {!isExtensionCallSession ? (
              <ConnectedAction
                label="Notes"
                active={false}
                disabled={!isSessionConnected || shouldLockConnectedActions}
                onClick={() => onOpenMaxiTab('notes')}
                icon={<NotebookPen className="h-5 w-5" />}
              />
            ) : null}
            {canShowAiAssistAction ? (
              <ConnectedAction
                label="AI Assist"
                active={false}
                disabled={!isSessionConnected || shouldLockConnectedActions}
                onClick={() => onOpenMaxiTab('ai-assist')}
                icon={<Sparkles className="h-5 w-5" />}
              />
            ) : null}
            <ConnectedAction
              label="Keypad"
              active={false}
              className={isCampaignOrQueueCall ? 'hidden' : ''}
              disabled={!isSessionConnected || shouldLockConnectedActions}
              onClick={() => setActivePanel('dtmf')}
              icon={<Keyboard className="h-5 w-5" />}
            />
            <ConnectedAction
              label="Hangup"
              onClick={onEndCall}
              className="col-start-2"
              icon={
                <FaPhone className="-rotate-[135deg] h-5 w-5 max-[380px]:h-4 max-[380px]:w-4" />
              }
              danger
            />
          </div>

          {sentimentScores && (
            <div className="mt-auto rounded-2xl border border-ucass-active-bg bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-2 py-2 ">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5d7394] max-[380px]:text-[9px] sm:text-[11px]">
                Live sentiment
              </p>

              <div className="mt-2 grid grid-cols-3 gap-2 max-[380px]:gap-1.5 sm:mt-3 sm:gap-3">
                {[
                  { label: 'Positive', value: sentimentScores.positive, color: '#22c55e' },
                  {
                    label: 'Neutral',
                    value: sentimentScores.neutral,
                    color: 'var(--color-ucass-active)',
                  },
                  { label: 'Negative', value: sentimentScores.negative, color: '#ef4444' },
                ].map((item) => {
                  // const progressAngle = Math.round(item.value * 360);
                  const progressAngle = Math.round((item.value / 100) * 360);

                  return (
                    <div key={item.label} className="flex flex-col items-center justify-center">
                      <div
                        className="relative flex h-14 w-14 items-center justify-center rounded-full max-[380px]:h-12 max-[380px]:w-12 sm:h-16 sm:w-16"
                        style={{
                          background: `conic-gradient(${item.color} ${progressAngle}deg, #e6edf9 ${progressAngle}deg)`,
                        }}
                      >
                        <div className="flex h-[80%] w-[80%] items-center justify-center rounded-full bg-white text-[#1e3352]">
                          <span className="text-[10px] font-semibold max-[380px]:text-[9px] sm:text-[11px]">
                            {/* {item.value.toFixed(2)} */}
                            {item.value.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] font-medium text-[#5f7392] max-[380px]:text-[9px] sm:text-[11px]">
                        {item.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DialpadConnectedScreen;
