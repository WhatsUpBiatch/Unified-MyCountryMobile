// cspell:ignore dialpad maxi
import { FaPhone } from '@/assets/icons';
import type { DialpadSession } from '@/context/dialpad-context';
import { cn } from '@/lib/utils';
import { Expand, Mic, MicOff, PauseCircle, PlayCircle, X } from 'lucide-react';
import { useMemo } from 'react';
import DialpadSessionSummaryCard from './dialpad-session-summary-card';

type DialpadScreenState = 'idle' | 'ringing' | 'connected' | 'ended';

type DialpadMicroFrameProps = {
  session: DialpadSession | null;
  dialpadScreen: DialpadScreenState;
  isHold: boolean;
  isMuted: boolean;
  onHoldToggle: () => void;
  onMuteToggle: () => void;
  onExpandToMaxi: () => void;
  onAcceptRinging: () => void;
  onRejectRinging: () => void;
  onCallAgain: () => void;
  onCloseEndedSession: () => void;
  onEndCall: () => void;
  showExpandButton?: boolean;
  className?: string;
};

const DialpadMicroFrame = ({
  session,
  dialpadScreen,
  isHold,
  isMuted,
  onHoldToggle,
  onMuteToggle,
  onExpandToMaxi,
  onAcceptRinging,
  onRejectRinging,
  onCallAgain,
  onCloseEndedSession,
  onEndCall,
  showExpandButton = true,
  className,
}: DialpadMicroFrameProps) => {
  const sessionForStatus = useMemo(() => {
    if (!session) return null;
    return {
      ...session,
      isOnHold: isHold,
      isMuted,
    };
  }, [isHold, isMuted, session]);

  const isSessionConnected = ['accepted', 'confirmed'].includes(
    String(sessionForStatus?.status || '').toLowerCase(),
  );
  const canControlLiveCall = dialpadScreen === 'connected' && !!session && isSessionConnected;
  const showExpand = dialpadScreen === 'connected' && showExpandButton;
  const isEnded = dialpadScreen === 'ended';
  const actionGridColumnsClass =
    dialpadScreen === 'connected' ? (showExpand ? 'grid-cols-4' : 'grid-cols-3') : 'grid-cols-2';

  return (
    <div
      className={cn(
        'w-full rounded-xl border border-white/80 bg-white p-2.5  max-[380px]:p-2 sm:rounded-xl  sm:p-3 md:p-4',
        'max-w-[min(100vw-1.25rem,348px)] max-[380px]:max-w-[min(100vw-0.5rem,312px)]',
        className,
      )}
    >
      <DialpadSessionSummaryCard session={sessionForStatus} showTimer={!isEnded} />

      <div
        className={`mt-2.5 grid gap-1.5 max-[380px]:mt-2 max-[380px]:gap-1 sm:mt-3 sm:gap-2 ${actionGridColumnsClass}`}
      >
        {dialpadScreen === 'ringing' ? (
          <>
            <button
              type="button"
              onClick={onRejectRinging}
              aria-label="Reject call"
              className="flex h-9 items-center justify-center rounded-xl bg-[#ffe6ea] text-[#c13345] transition max-[380px]:h-8 sm:h-10 md:h-11 hover:bg-red-600 hover:text-white"
            >
              <FaPhone className="-rotate-[135deg] h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
            </button>
            <button
              type="button"
              onClick={onAcceptRinging}
              aria-label="Accept call"
              className="flex h-9 items-center justify-center rounded-xl bg-[#dff8ea] text-[#1e9a4b] transition max-[380px]:h-8 sm:h-10 md:h-11 hover:bg-green-600 hover:text-white"
            >
              <FaPhone className="-scale-x-100 h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
            </button>
          </>
        ) : isEnded ? (
          <>
            <button
              type="button"
              onClick={onCallAgain}
              aria-label="Call again"
              className="flex h-9 items-center justify-center gap-1 rounded-xl bg-primary px-2 text-[11px] font-semibold text-white transition max-[380px]:h-8 max-[380px]:text-[10px] sm:h-10 sm:gap-1.5 sm:px-2.5 sm:text-xs md:h-11 md:px-3 hover:bg-primary"
            >
              <FaPhone className="-scale-x-100 h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
              Call Again
            </button>
            <button
              type="button"
              onClick={onCloseEndedSession}
              aria-label="Close ended session"
              className="flex h-9 items-center justify-center gap-1 rounded-xl border border-[#d4e1f6] bg-white px-2 text-[11px] font-semibold text-[#2f4f79] transition max-[380px]:h-8 max-[380px]:text-[10px] sm:h-10 sm:gap-1.5 sm:px-2.5 sm:text-xs md:h-11 md:px-3 hover:bg-ucass-active-bg"
            >
              <X className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
              Close
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onHoldToggle}
              disabled={!canControlLiveCall}
              aria-label={isHold ? 'Unhold call' : 'Hold call'}
              className={`flex h-9 items-center justify-center rounded-xl transition max-[380px]:h-8 sm:h-10 md:h-11 ${
                canControlLiveCall
                  ? isHold
                    ? 'bg-primary text-white hover:bg-primary'
                    : 'bg-ucass-active-bg text-[#224162] hover:bg-primary hover:text-white'
                  : 'border border-[#dfe7f3] bg-[#f8fafd] text-[#95a5b9]'
              }`}
            >
              {isHold ? (
                <PlayCircle className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onMuteToggle}
              disabled={!canControlLiveCall}
              aria-label={isMuted ? 'Unmute call' : 'Mute call'}
              className={`flex h-9 items-center justify-center rounded-xl transition max-[380px]:h-8 sm:h-10 md:h-11 ${
                canControlLiveCall
                  ? isMuted
                    ? 'bg-primary text-white hover:bg-primary'
                    : 'bg-ucass-active-bg text-[#224162] hover:bg-primary hover:text-white'
                  : 'border border-[#dfe7f3] bg-[#f8fafd] text-[#95a5b9]'
              }`}
            >
              {isMuted ? (
                <MicOff className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
              ) : (
                <Mic className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
              )}
            </button>
          </>
        )}

        {showExpand ? (
          <button
            type="button"
            onClick={onExpandToMaxi}
            disabled={!canControlLiveCall}
            aria-label="Expand to maxi"
            className={`flex h-9 items-center justify-center rounded-xl transition max-[380px]:h-8 sm:h-10 md:h-11 ${
              canControlLiveCall
                ? 'bg-ucass-active-bg text-[#224162] hover:bg-primary hover:text-white'
                : 'border border-[#dfe7f3] bg-[#f8fafd] text-[#95a5b9]'
            }`}
          >
            <Expand className="h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
          </button>
        ) : null}
        {dialpadScreen === 'connected' ? (
          <button
            type="button"
            onClick={onEndCall}
            disabled={!canControlLiveCall}
            aria-label="End call"
            className={`flex h-9 items-center justify-center rounded-xl transition max-[380px]:h-8 sm:h-10 md:h-11 ${
              canControlLiveCall
                ? 'bg-[#ffe6ea] text-[#c13345] hover:bg-red-600 hover:text-white'
                : 'border border-[#dfe7f3] bg-[#f8fafd] text-[#95a5b9]'
            }`}
          >
            <FaPhone className="-rotate-[135deg] h-3.5 w-3.5 max-[380px]:h-3 max-[380px]:w-3 sm:h-4 sm:w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default DialpadMicroFrame;
