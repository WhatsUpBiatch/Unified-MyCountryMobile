import { useDialpad } from '@/hooks/use-dialpad';
import { isServerDialed } from '@/lib/campaign-dial-mode';
import CustomAvatar from '@/components/custom/custom-avatar';
import { isExtensionDialTarget, normalizeDialTargetUserPart } from '@/lib/extension-utility';
import { Loader2, PhoneCall, SkipForward } from 'lucide-react';
import DialpadCountdownRingTimer from './dialpad-countdown-ring-timer';

export type CampaignContactCard = {
  _id?: string;
  campaignId?: string;
  allowSkipping?: boolean;
  campaignDetail?: {
    campaignName?: string;
    campaignType?: string;
  };
  campaign_detail?: {
    _id?: string;
    name?: string;
    dialMethod?: string;
    callerId?: string[];
    allowSkipping?: boolean;
    dialerSetting?: {
      preview_time?: number;
      wrapup_time?: number;
    };
  };
  contactName?: string;
  contactNumber?: string;
  contactId?: string;
  requestStatus?: string;
  leadStatus?: string;
  remainingCallAttempts?: number;
  totalCallAttempts?: number;
};

export type CampaignSkipStatus = 'SKIPPED' | 'NOT_DIALED';

type DialpadCampaignContactCardProps = {
  firstCampaignCard: CampaignContactCard;
  onCall: () => void;
  onSkip: (status?: CampaignSkipStatus, options?: { isManual?: boolean }) => void;
  canCall: boolean;
  canSkip: boolean;
  showCallButton?: boolean;
  isSkipLoading?: boolean;
  allowSkipping?: boolean;
  previewTimeSeconds?: number;
  timerReferenceTimestampMs?: number;
  timerKey?: string;
  onTimerValueChange?: (remainingSeconds: number) => void;
};

const DialpadCampaignContactCard = ({
  firstCampaignCard,
  onCall,
  onSkip,
  canCall,
  canSkip,
  showCallButton = true,
  isSkipLoading = false,
  allowSkipping = false,
  previewTimeSeconds = 0,
  timerReferenceTimestampMs,
  timerKey,
  onTimerValueChange,
}: DialpadCampaignContactCardProps) => {
  console.log('🚀 ~ DialpadCampaignContactCard ~ firstCampaignCard:', firstCampaignCard);
  const { sessions, activeSessionId, activeCampaign } = useDialpad();
  console.log('🚀 ~ DialpadCampaignContactCard ~ activeCampaign:', activeCampaign);
  const currentSession = activeSessionId ? sessions?.[activeSessionId] : null;
  console.log('DialpadCampaignContactCard currentSession:', currentSession);
  const dialMethodValue =
    `${activeCampaign?.dialMethod || activeCampaign?.campaignType || ''}`.trim() ||
    firstCampaignCard?.campaignDetail?.campaignType?.trim() ||
    '';
  const normalizedDialMethod = dialMethodValue.toUpperCase();
  const isPredictiveDialMethod = isServerDialed(normalizedDialMethod);

  const sessionStatus = `${currentSession?.status || ''}`.trim();
  console.log('🚀 ~ DialpadCampaignContactCard ~ sessionStatus:', sessionStatus);
  const hasSessionStatus = Boolean(sessionStatus);
  const formattedSessionStatus = sessionStatus.replace(/_/g, ' ').toUpperCase();

  const contactName = firstCampaignCard?.contactName?.trim() || 'Unknown Contact';
  const contactNumber = firstCampaignCard?.contactNumber?.trim() || 'No Number';
  const normalizedPresenceTarget = normalizeDialTargetUserPart(contactNumber);
  const shouldShowPresence =
    Boolean(normalizedPresenceTarget) && isExtensionDialTarget(normalizedPresenceTarget);

  const handleTimerEnds = () => {
    onSkip('NOT_DIALED');
  };

  const hasCallAction = showCallButton;
  const hasSkipAction = allowSkipping;
  const hasAnyAction = hasCallAction || hasSkipAction;
  const shouldUseTwoColumns = hasCallAction && hasSkipAction;

  if (isPredictiveDialMethod) {
    return (
      <div className="overflow-hidden rounded-2xl border border-[#d6e5ff] bg-gradient-to-br from-[#f7fbff] via-white to-[#f3f8ff] p-3 shadow-[0_12px_24px_rgba(14,67,145,0.14)]">
        <div className="flex items-center justify-center rounded-xl border border-dashed border-[#c6d9fb] bg-white/70 px-3 py-5 text-center">
          <p className="text-[12px] font-semibold text-[#1f4f8f] sm:text-[13px]">
            Waiting for call to come in
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#d6e5ff] bg-gradient-to-br from-[#f7fbff] via-white to-[#f3f8ff] p-3 shadow-[0_12px_24px_rgba(14,67,145,0.14)]">
      <div className="flex items-start gap-3">
        <CustomAvatar
          name={contactName}
          size="40"
          showPresence={shouldShowPresence}
          extension={shouldShowPresence ? normalizedPresenceTarget : ''}
          isActivityInfo={false}
        />

        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[#17385e]">{contactName}</p>
            <p className="truncate text-[12px] text-[#49668f]">{contactNumber}</p>
          </div>

          {hasSessionStatus ? (
            <span className="shrink-0 rounded-full border border-ucass-active-bg bg-ucass-active-bg px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-[#1f4f8f]">
              {formattedSessionStatus}
            </span>
          ) : previewTimeSeconds > 0 ? (
            <DialpadCountdownRingTimer
              key={timerKey}
              currentTimeSeconds={previewTimeSeconds}
              referenceTimestampMs={timerReferenceTimestampMs}
              onTimeEnds={handleTimerEnds}
              onTick={onTimerValueChange}
              size="compact"
              className="shrink-0"
            />
          ) : null}
        </div>
      </div>

      {!hasSessionStatus && hasAnyAction ? (
        <div className={`mt-3 grid ${shouldUseTwoColumns ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
          {hasCallAction ? (
            <button
              type="button"
              onClick={onCall}
              disabled={!canCall}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-white transition hover:bg-[#1856c0] disabled:cursor-not-allowed disabled:bg-[#a7bce3]"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              Call
            </button>
          ) : null}

          {hasSkipAction ? (
            <button
              type="button"
              onClick={() => onSkip('SKIPPED', { isManual: true })}
              disabled={!canSkip || isSkipLoading}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#cbdcff] bg-white px-3 text-[12px] font-semibold text-[#23456f] transition hover:bg-[#f3f7ff] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSkipLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SkipForward className="h-3.5 w-3.5" />
              )}
              {isSkipLoading ? 'Skiping' : 'Skip'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default DialpadCampaignContactCard;
