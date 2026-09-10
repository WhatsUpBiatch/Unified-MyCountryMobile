import Loader from '@/components/custom/loader';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { getAgentList, getAIAgentToken } from '@/services/api';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useWebRTCVoice } from './useWebRTCVoice';
import { Icon } from '@/assets/icons/icon';
import { X } from 'lucide-react';

interface ITestTalkModalProps {
  modalState: boolean;
  setModalState: (v: boolean) => void;
  data?: any;
  preferredProvider?: 'livekit' | 'azure' | 'openai' | 'google' | string;
}

// ── Components ────────────────────────────────────────────────────────────────

const Spinner = ({ className = 'h-10 w-10' }: { className?: string }) => (
  <svg
    className={`animate-spin ${className} text-white`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
);

// ── Modal ─────────────────────────────────────────────────────────────────────

function TestTalkModal({
  modalState,
  setModalState,
  data,
  preferredProvider,
}: ITestTalkModalProps) {
  const agentId: string = data?.agentId || data?.agent_uuid || '';
  const [agent, setAgent] = useState<any>(null);

  const { data: tokenData = {} } = useQuery({
    queryFn: getAIAgentToken,
    queryKey: ['getAIAgentToken'],
    select: (r: any) => r?.data?.data?.result || {},
    enabled: modalState,
  });
  const token: string = (tokenData as any)?.tokenId || '';

  const { data: agentList = [], isLoading: isAgentListLoading } = useQuery({
    queryFn: getAgentList,
    queryKey: ['getAgentList', agentId],
    select: (r: any) => r?.data?.data?.result?.rows || [],
    enabled: modalState && Boolean(agentId),
  });

  useEffect(() => {
    if (agentList && (agentList as any[]).length > 0 && !isAgentListLoading) {
      const found = (agentList as any[]).find((v: any) => v?.agentId === agentId);
      setAgent(found);
    }
  }, [agentList, isAgentListLoading, agentId]);

  const {
    agentName = agent?.agentName || 'AI Agent',
    widgetHeaderColor = agent?.widgetHeaderColor || '#1e60c1',
  } = (data || {}) as any;

  const ready = Boolean(token && agentId);
  const {
    isConnecting,
    isSessionActive,
    isDisconnecting,
    remoteAudioRef,
    startWebRTCSession,
    stopWebRTCSession,
  } = useWebRTCVoice({ agentId, token, preferredProvider });
  const [activeView, setActiveView] = useState<'list' | 'call'>('list');

  useEffect(() => {
    if (isSessionActive || isConnecting) {
      setActiveView('call');
    }
  }, [isSessionActive, isConnecting]);

  const handleClose = async () => {
    await stopWebRTCSession();
    setActiveView('list');
    setModalState(false);
  };

  const statusLabel = isDisconnecting
    ? 'Ending call...'
    : isConnecting
      ? 'Connecting to Agent...'
      : isSessionActive
        ? 'Call is live'
        : 'Press play to start talking.';

  const {
    widgetIconColor = agent?.widgetIconColor || '#1e60c1',
    widgetSendButtonColor = agent?.widgetSendButtonColor || '#1e60c1',
  } = (data || {}) as any;

  return (
    <Dialog
      open={modalState}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent
        className="p-0 border-none bg-white shadow-2xl w-[360px] max-w-[95vw] overflow-hidden rounded-xl"
        showCloseButton={false}
      >
        {isAgentListLoading ? (
          <div className="flex flex-col items-center justify-center min-h-[580px] bg-[#f4f5f7] gap-4">
            <Loader variant="custom" />
            <p className="text-sm text-gray-500 animate-pulse">Loading agent configuration...</p>
          </div>
        ) : activeView === 'list' ? (
          <div className="flex flex-col bg-[#f4f5f7] min-h-[580px]">
            {/* Tall Welcome Header */}
            <div
              className="h-[220px] pt-10 pb-6 px-6 text-white text-center flex flex-col items-center relative"
              style={{ backgroundColor: widgetHeaderColor }}
            >
              <button
                type="button"
                className="absolute top-4 right-4 cursor-pointer shrink-0 rounded-full p-1 transition-colors hover:bg-white/20"
                onClick={handleClose}
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
              <div
                className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-3 shadow-lg"
                style={{ color: widgetIconColor }}
              >
                <Icon name="PhoneCalling" className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold">Prefer to Talk? 👋</h2>
              <div className="mt-1 opacity-75 text-sm">Click here to call our AI assistant</div>
            </div>

            {/* Welcome Body */}
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              <div className="bg-white rounded-full flex items-center justify-center mb-8 shadow-sm w-20 h-20">
                <Icon name="Microphone" className="w-10 h-10 text-gray-300" />
              </div>
              <p className="text-gray-500 text-center mb-8 font-medium">
                Our AI agent <span className="text-gray-800 font-bold">{agentName}</span> is ready
                to assist you over a voice call.
              </p>

              <button
                onClick={startWebRTCSession}
                disabled={!ready}
                className="w-full rounded-full py-4 font-bold text-white flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98] border-0 mt-auto"
                style={{ backgroundColor: widgetSendButtonColor || widgetHeaderColor }}
              >
                <Icon name="PhoneCalling" className="w-5 h-5" />
                Start conversation
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col bg-white min-h-[580px]">
            {/* Compact Header */}
            <div
              className="h-14 px-4 text-white flex items-center justify-between"
              style={{ backgroundColor: widgetHeaderColor }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-lg font-semibold truncate" title={agentName}>
                  Talk to {agentName}
                </h3>
              </div>
              <button
                type="button"
                className="cursor-pointer shrink-0 rounded-full p-1 transition-colors hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  if (!isDisconnecting) handleClose();
                }}
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Call Body */}
            <div className="flex-1 flex flex-col items-center justify-center py-20 bg-white">
              <div className="mb-12">
                <p className="text-[#646464] text-lg font-normal text-center">{statusLabel}</p>
              </div>

              <div className="relative">
                {/* Pulsing ring for active state */}
                {isSessionActive && (
                  <div
                    className="absolute -inset-4 rounded-full animate-ping opacity-25"
                    style={{ backgroundColor: '#ef4444', animationDuration: '2.5s' }}
                  />
                )}

                <button
                  onClick={isSessionActive ? () => stopWebRTCSession() : startWebRTCSession}
                  disabled={isConnecting || isDisconnecting || !ready}
                  className="relative w-20 h-20 rounded-full flex items-center justify-center shadow-[0_8px_30px_rgb(0,0,0,0.12)] border-0 cursor-pointer transition-all duration-200 active:scale-95 disabled:opacity-80 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor:
                      isDisconnecting || isSessionActive
                        ? '#ef4444'
                        : isConnecting
                          ? '#444444'
                          : '#1a1a1a',
                  }}
                >
                  <div className="transform text-white">
                    {isConnecting || isDisconnecting ? (
                      <Spinner />
                    ) : isSessionActive ? (
                      <Icon name="CutCallIcon" className="w-8 h-8" />
                    ) : (
                      <Icon name="Microphone" className="w-8 h-8" />
                    )}
                  </div>
                </button>
              </div>

              {!ready && !isConnecting && (
                <div className="mt-8">
                  <p className="text-sm text-gray-400">Loading configuration...</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hidden Audio */}
        <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />
      </DialogContent>
    </Dialog>
  );
}

export default TestTalkModal;
