import MeetInitiateModal from '@/components/audio-video-call/components/meet-initiate-modal';
import Header from '@/components/custom/header';
import Sidebar from '@/components/custom/sidebar';
import { useAreaNav } from '@/components/custom/use-area-nav';
// import Dialer from '@/components/dialer';
import AgentRunningCampignOuter from '@/components/running-campaign-outer';
import DialpadGlobalOverlay from '@/components/dialpad/dialpad-global-overlay';
import { useAvCall } from '@/hooks/use-av-call';
import { useCampaign } from '@/hooks/use-campaign';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { CAMPAIGN_STATUS_CONST } from '@/pages/auto-dialer/campaign/const';
import MeetRinging from '@/pages/messenger/chat/meet-ringing';
import { GlobalCallbackReminder } from '@/components/custom/callback-reminder/global-callback-reminder';
import { SuspenseOutlet } from '@/components/custom/route-suspense';
// import PowerDialerCampaign from '@/components/power-dialer-campaign';
import { useEffect, useMemo } from 'react';

import { useIdleTimeout } from '@/hooks/use-idle-timeout';

const AuthLayout = () => {
  /* Signs an unattended console out after the idle time the company set. Placed
     here because this layout sits inside both the call and video providers, so
     the hook can tell when somebody is actually on a call and hold off — being
     dropped mid-call would be far worse than the timeout it enforces. Does
     nothing at all unless a company has switched it on. */
  useIdleTimeout();

  // Same source the rail uses, so the gutter and the rail agree.
  const { hasRail } = useAreaNav();
  // const [isDialerOpen, setIsDialerOpen] = useState(false);
  // const [isDialerDrawerOpen, setIsDialerDrawerOpen] = useState(false);

  const {
    setIsStartCampaign,
    setTimer,
    setContacts,
    setActiveCallSessionData,
    setSelectedContact,
    selectedCampaign,
    setSelectedCampaign,
    setIsCampaignCall,
    isStartCampaign,
  } = useCampaign();

  // const  = location?.pathname?.startsWith('/contact-activity')
  const {
    socketEventsManager,
    callingInProgress,
    allChats,
    meetInitiateModalData,
    setMeetInitiateModalData,
  } = useSocketEvents();
  const { isRoomJoined, cleanupLocalMediaTracks } = useAvCall();
  const isInConference = isRoomJoined;

  const meetModalCurrentChat = useMemo(() => {
    if (!meetInitiateModalData?.chatId) return null;

    const matchedChat = Array.isArray(allChats)
      ? allChats.find((chat: any) => chat?.chatId === meetInitiateModalData.chatId)
      : null;

    if (matchedChat) {
      return {
        ...matchedChat,
        meetMetadata: {
          ...(matchedChat?.meetMetadata || {}),
          startedBy: matchedChat?.meetMetadata?.startedBy || meetInitiateModalData?.senderId || '',
        },
      };
    }

    return {
      chatId: meetInitiateModalData.chatId,
      users: [],
      meetMetadata: {
        startedBy: meetInitiateModalData?.senderId || '',
      },
    };
  }, [allChats, meetInitiateModalData]);
  useEffect(() => {
    if (!socketEventsManager) return;
    const handler = (data: any) => {
      if (data && data?._id) {
        if (
          data?._id === selectedCampaign?.value &&
          data?.campaignStatus === CAMPAIGN_STATUS_CONST.PAUSE
        ) {
          setIsStartCampaign(false);
          setContacts([]);
          setTimer(0);
          setSelectedCampaign(null);
          setActiveCallSessionData(null);
          setSelectedContact(null);
          setIsCampaignCall(false);
          // if (activeCallKey) _terminate(activeCallKey);
        }
      }
    };
    socketEventsManager.on('campaign-state-update', handler);

    return () => {
      socketEventsManager.off('campaign-state-update', handler);
    };
  }, [socketEventsManager, selectedCampaign?.value]);

  useEffect(() => {
    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().then((permission) => {
          console.log(`Notification permission: ${permission}`);
        });
      } else {
        console.log(`Notification permission already set to: ${Notification.permission}`);
      }
    } else {
      console.log('This browser does not support notifications.');
    }
  }, []);

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      {/* The rail's gutter goes when the rail does, so Home is not left with an
          empty column beside it. */}
      <div className={`h-full w-full p-0 ${hasRail ? 'md:pl-20' : ''}`}>
        <Header />
        <div className="flex h-full min-h-0 w-full pt-16">
          <SuspenseOutlet />
        </div>
      </div>
      {/* <Dialer {...{ isDialerDrawerOpen, setIsDialerDrawerOpen, isDialerOpen, setIsDialerOpen }} /> */}
      <DialpadGlobalOverlay />
      {/* <PowerDialerCampaign /> */}
      <GlobalCallbackReminder />
      {isStartCampaign && <AgentRunningCampignOuter />}
      {callingInProgress && !isInConference ? <MeetRinging /> : null}
      {meetInitiateModalData && meetModalCurrentChat ? (
        <MeetInitiateModal
          currentChat={meetModalCurrentChat}
          callType={meetInitiateModalData?.callType || 'video'}
          isInitiator={false}
          skipJoinOptions
          skipPreJoinMediaCheck={Boolean(meetInitiateModalData?.skipPreJoinMediaCheck)}
          onClose={() => {
            cleanupLocalMediaTracks();
            setMeetInitiateModalData(null);
          }}
        />
      ) : null}
      {/* {
        isStartCampaign && selectedCampaign?.dialMethod === DIALER_TYPE.PREVIEW && (
          <CampaignContactsRightBar />
        )
      } */}
    </div>
  );
};

export default AuthLayout;
