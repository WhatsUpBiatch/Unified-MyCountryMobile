import type { DialpadSession } from '@/context/dialpad-context';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DialpadMaxiTab } from './dialpad-maxi-side-panel';
import { KEYPAD_KEYS } from '../constants';
import type { CallerIdOption } from '../types';
import DialpadCallButton from './dialpad-call-button';
import DialpadAiConversationOverview from './dialpad-ai-conversation-overview';
import DialpadCallerId from './dialpad-caller-id';
import DialpadConnectedScreen from './dialpad-connected-screen';
import DialpadCampaignOverview from './dialpad-campaign-overview';
import DialpadContactLink from './dialpad-contact-link';
import DialpadEndedScreen from './dialpad-ended-screen';
import DialpadKeypad from './dialpad-keypad';
import DialpadNumberDisplay from './dialpad-number-display';
import DialpadRingingScreen from './dialpad-ringing-screen';
import DialpadSessionSwitcher from './dialpad-session-switcher';
import { getMonitoringCallLabel } from '../session-display';

type DialpadScreenState = 'idle' | 'ringing' | 'connected' | 'ended';

type DialpadMiniFrameProps = {
  dialpadScreen: DialpadScreenState;
  campaignContactCards:
    | {
        campaignDetail?: {
          campaignName?: string;
          campaignType?: string;
        };
        requestStatus?: string;
        leadStatus?: string;
      }[]
    | null;
  allSessions: DialpadSession[];
  activeSessionId: string | null;
  activeSession: DialpadSession | null;
  ringingSession: DialpadSession | null;
  typedNumber: string;
  canCall: boolean;
  isManualDialDisabled?: boolean;
  isSipRegistered: boolean;
  sipStatus: string;
  /* Widened for shared group numbers, which carry a source and group name.
     Plain options still satisfy it, so existing callers are unaffected. */
  callerIdOptions: Array<CallerIdOption & { source?: string; groupName?: string }>;
  selectedCallerId: CallerIdOption;
  isCallerIdOpen: boolean;
  isHold: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  onSwitchSession: (sessionId: string) => void;
  onToggleCallerId: () => void;
  onSelectCallerId: (option: CallerIdOption) => void;
  onOpenGuide: () => void;
  onContactLinkClick: () => void;
  onTypedNumberChange: (value: string) => void;
  onBackspace: () => void;
  onPressKey: (value: string) => void;
  onCall: () => void;
  onAcceptRinging: () => void;
  onRejectRinging: () => void;
  onAddNotes: () => void;
  onCallAgain: () => void;
  onCloseEndedSession: () => void;
  onHoldToggle: () => void;
  onMuteToggle: () => void;
  onSpeakerToggle: () => void;
  onEndCall: () => void;
  onOpenMaxiTab: (tab: DialpadMaxiTab) => void;
  topAccessory?: ReactNode;
  className?: string;
  contentClassName?: string;
};

const DialpadMiniFrame = ({
  dialpadScreen,
  campaignContactCards,
  allSessions,
  activeSessionId,
  activeSession,
  ringingSession,
  typedNumber,
  canCall,
  isManualDialDisabled = false,
  isSipRegistered,
  sipStatus,
  callerIdOptions,
  selectedCallerId,
  isCallerIdOpen,
  isHold,
  isMuted,
  isSpeakerOn,
  onSwitchSession,
  onToggleCallerId,
  onSelectCallerId,
  onOpenGuide,
  onContactLinkClick,
  onTypedNumberChange,
  onBackspace,
  onPressKey,
  onCall,
  onAcceptRinging,
  onRejectRinging,
  onAddNotes,
  onCallAgain,
  onCloseEndedSession,
  onHoldToggle,
  onMuteToggle,
  onSpeakerToggle,
  onEndCall,
  onOpenMaxiTab,
  topAccessory,
  className,
  contentClassName,
}: DialpadMiniFrameProps) => {
  const isCallConnected = ['accepted', 'confirmed'].includes(
    String(activeSession?.status || '').toLowerCase(),
  );
  const contactDialTarget = String(
    activeSession?.remoteNumber || activeSession?.extension || '',
  ).trim();
  const contactDialTargetDigitsCount = contactDialTarget.replace(/\D/g, '').length;
  const hasSessionContactId = Boolean(String(activeSession?.contactInfo?._id || '').trim());
  const sessionContactInfo = activeSession?.contactInfo;
  const firstName =
    sessionContactInfo?.first_name ||
    sessionContactInfo?.firstName ||
    sessionContactInfo?.name?.first;
  const lastName =
    sessionContactInfo?.last_name || sessionContactInfo?.lastName || sessionContactInfo?.name?.last;
  const mergedName = `${firstName || ''} ${lastName || ''}`.trim();
  const directName =
    typeof sessionContactInfo?.name === 'string' ? sessionContactInfo.name.trim() : '';
  const monitoringCallLabel = getMonitoringCallLabel(contactDialTarget);
  const isConferenceSession = Boolean(activeSession?.conferenceData);
  const resolvedContactName = isConferenceSession
    ? 'Conference Call'
    : monitoringCallLabel || mergedName || directName || 'Unknown Contact';
  const isUnknownContact = resolvedContactName === 'Unknown Contact';
  const shouldShowDialpadContactLink =
    isCallConnected && contactDialTargetDigitsCount > 4 && !hasSessionContactId && isUnknownContact;
  const idleCanCall = canCall && !isManualDialDisabled;

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-white/80 bg-white  sm:rounded-xl',
        'xs:p-2 xl:p-4',
        className,
      )}
    >
      {topAccessory ? <div className="mb-2 flex items-center">{topAccessory}</div> : null}

      {allSessions.length > 1 ? (
        <DialpadSessionSwitcher
          sessions={allSessions}
          activeSessionId={activeSessionId ?? allSessions[0]?.id ?? null}
          onSwitchSession={onSwitchSession}
        />
      ) : null}

      <div
        className={cn(
          ' flex min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y w-full',
          contentClassName,
        )}
      >
        {dialpadScreen === 'idle' ? (
          <div className="flex h-full min-h-0 w-full flex-col">
            {/* <DialpadBalance /> */}

            <DialpadCallerId
              options={callerIdOptions}
              selectedOption={selectedCallerId}
              isOpen={isCallerIdOpen}
              onToggle={onToggleCallerId}
              onSelect={onSelectCallerId}
              onOpenGuide={onOpenGuide}
            />

            {!isSipRegistered ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#ffd8b4] bg-[#fff8ef] px-2.5 py-2 text-[11px] font-medium text-[#9a4f00] sm:text-xs">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                SIP not registered ({sipStatus}). Please wait before calling.
              </div>
            ) : null}

            <DialpadNumberDisplay
              typedNumber={typedNumber}
              onTypedNumberChange={onTypedNumberChange}
              onBackspace={onBackspace}
              onEnterPress={idleCanCall ? onCall : undefined}
              disabled={isManualDialDisabled}
            />

            <div className="lg:my-auto space-y-3 sm:space-y-4 xs:min-h-[300px] xs:mt-18">
              <DialpadKeypad
                keys={KEYPAD_KEYS}
                onPressKey={onPressKey}
                disabled={isManualDialDisabled}
              />
              <DialpadCallButton canCall={idleCanCall} onCall={onCall} />
            </div>
          </div>
        ) : dialpadScreen === 'ringing' ? (
          <DialpadRingingScreen
            session={ringingSession}
            onAccept={onAcceptRinging}
            onReject={onRejectRinging}
          />
        ) : dialpadScreen === 'ended' ? (
          <DialpadEndedScreen
            session={activeSession}
            onAddNotes={onAddNotes}
            onCallAgain={onCallAgain}
            onClose={onCloseEndedSession}
          />
        ) : (
          <div className="flex h-full min-h-0 w-full flex-col">
            {shouldShowDialpadContactLink ? (
              <DialpadContactLink onClick={onContactLinkClick} />
            ) : null}
            <DialpadConnectedScreen
              session={activeSession}
              onHoldToggle={onHoldToggle}
              onMuteToggle={onMuteToggle}
              onSpeakerToggle={onSpeakerToggle}
              onEndCall={onEndCall}
              isHold={isHold}
              isMuted={isMuted}
              isSpeakerOn={isSpeakerOn}
              onOpenMaxiTab={onOpenMaxiTab}
            />
          </div>
        )}
      </div>
      <DialpadCampaignOverview
        campaignContactCards={campaignContactCards}
        dialpadScreen={dialpadScreen}
      />
      <DialpadAiConversationOverview session={activeSession} dialpadScreen={dialpadScreen} />
    </div>
  );
};

export default DialpadMiniFrame;
