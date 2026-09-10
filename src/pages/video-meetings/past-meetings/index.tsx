import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/assets/icons/icon';
import Loader from '@/components/custom/loader';
import { formatMeetingDate, formatTime, getAbbreviationByTimeZone, handleAlert } from '@/lib/utils';
import { meetingDelete, meetingList } from '@/services/api';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import MeetingMembersModal from '../meeting-members-modal';
import MeetingFeedback from '../meeting-feedback-modal';
import SideDrawer from '@/components/custom/side-drawer';
import MeetingInfo from '../meeting-info-modal';
import { Button } from '@/components/ui/button';
import { Clock4Icon, InfoIcon, X } from 'lucide-react';
import NotFound from '@/assets/images/not-found-img.svg';
import AlertConfirm from '@/components/custom/alert-confirm';
import { useCompanyFeatures } from '@/hooks/rbac';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import Chat from '@/pages/messenger/chat';
import { useUser } from '@/hooks/use-user';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { chatEvents } from '@/context/socket-events';
import { buildRecordingChatUsers } from '../recordings/recording-chat-utils';

const MEMBER_AVATAR_TONE_CLASSES = [
  'text-primary bg-ucass-active-bg',
  'text-yellow-600 bg-yellow-100',
  'text-pink-600 bg-pink-100',
  'text-sky-600 bg-sky-100',
  'text-emerald-600 bg-emerald-100',
];

const normalizeMemberType = (member: any) =>
  String(member?.type || '')
    .trim()
    .toUpperCase();

const isGuestMember = (member: any) => normalizeMemberType(member) === 'GUEST';

const isAdminMember = (member: any) => normalizeMemberType(member) === 'ADMIN';

const getMemberName = (member: any): string => {
  const fullName = String(
    member?.name || `${member?.first_name || ''} ${member?.last_name || ''}`,
  ).trim();
  return fullName || String(member?.email || 'Guest').trim();
};

const getMemberInitial = (member: any): string => {
  const memberName = getMemberName(member);
  return String(memberName.charAt(0) || 'G').toUpperCase();
};

const formatMemberCountLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const PastMeetings = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const meetingActorUuid = user?.uuid || user?.guest_info?.uuid || '';
  const socketDomain = user?.sip_credentials?.domain || '';
  const { allChats, messageList, socketEventsManager, handleGetMessageByChatId } =
    useSocketEvents();
  const { features } = useCompanyFeatures();
  const videAccess = features?.plan_features?.video?.action || {};
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const [modalState, setModalState] = useState<any>({
    meetingInfo: false,
    meetingAttendee: false,
    meetingInvites: false,
    meetingChat: false,
    isDelete: false,
  });
  const [drawerState, setDrawerState] = useState<any>({
    meetingFeedback: false,
  });
  const observerTarget = useRef(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending: isPendingPastMeeting,
    refetch: refetchPastMeetings,
  } = useInfiniteQuery({
    queryKey: ['pastMeetingList'],
    queryFn: ({ pageParam = 1 }) => meetingList({ listType: 'past', page: pageParam, limit: 25 }),
    getNextPageParam: (lastPage) => {
      const result = lastPage?.data?.data?.result;
      const currentPage = result?.currentPage ?? 1;
      const totalPages = result?.totalPages ?? 1;
      return currentPage < totalPages ? currentPage + 1 : undefined;
    },

    initialPageParam: 1,
    select: (data) => ({
      pages: data?.pages,
      pageParams: data?.pageParams,
    }),
  });

  const { mutate: mutateMeetingDelete, isPending: isPendingDeleteMeeting } = useMutation({
    mutationFn: meetingDelete,
    onSuccess: () => {
      handleAlert({ text: 'Meeting deleted successfully', type: 'success' });
      setModalState({
        meetingInfo: false,
        meetingAttendee: false,
        meetingInvites: false,
        meetingChat: false,
        isDelete: false,
      });
      refetchPastMeetings();
    },
  });

  const pastMeetingList =
    data?.pages?.flatMap((page) => page?.data?.data?.result?.rows || []) || [];

  const meetingChatId = String(selectedMeeting?.meetingId || '').trim();
  const meetingChatName = selectedMeeting?.name || 'Meeting Chat';
  const meetingChatDescription = `Meeting ID: ${meetingChatId || '--'}`;
  const meetingChatUsers = useMemo(
    () => buildRecordingChatUsers({ meeting: selectedMeeting }, user),
    [selectedMeeting, user],
  );

  const handleOpenMeetingChat = (meeting: any) => {
    const chatId = String(meeting?.meetingId || '').trim();
    if (!chatId) return;

    setSelectedMeeting(meeting);
    setModalState({ meetingChat: true });

    const hasChatInList = Array.isArray(allChats)
      ? allChats.some((chatItem: any) => String(chatItem?.chatId || '').trim() === chatId)
      : false;
    const messageListForChat = Array.isArray(messageList)
      ? messageList.find((chatItem: any) => String(chatItem?.chatId || '').trim() === chatId)
      : null;
    const isMessageListEmptyForChat =
      !Array.isArray(messageListForChat?.messages) || messageListForChat.messages.length === 0;

    if (!hasChatInList && isMessageListEmptyForChat) {
      if (socketEventsManager && meetingActorUuid) {
        const chatPayload: any = { uuid: meetingActorUuid };
        if (socketDomain) chatPayload.domain = socketDomain;
        socketEventsManager.emit(chatEvents.GET_CHATS, chatPayload);
      }
      if (typeof handleGetMessageByChatId === 'function' && meetingActorUuid) {
        handleGetMessageByChatId({ chatId, userId: meetingActorUuid });
      }
    }
  };

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  );

  useEffect(() => {
    const target = observerTarget.current;
    const scrollContainer = scrollContainerRef.current;
    if (!target || !scrollContainer) return;

    const observer = new IntersectionObserver(handleObserver, {
      root: scrollContainer,
      threshold: 0.1,
    });

    observer.observe(target);
    return () => observer.disconnect();
  }, [handleObserver]);

  return (
    <section className="flex h-full min-h-0 w-full flex-1 flex-col gap-3 overflow-auto bg-gray-200/15 p-3 sm:p-4">
      <div className="mx-auto max-w-250 flex h-full min-h-0 w-full flex-col justify-start gap-6 sm:gap-8">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex justify-between items-center">
            <h4 className="text-gray-900 font-semibold text-lg flex items-center gap-1">
              Past Meetings <InfoIcon className="w-3 h-3 text-gray-600" />
            </h4>
            <Button
              variant="outline"
              className="justify-center shadow-none sm:w-auto hover:bg-gray-50 hover:text-gray-600 border-gray-200 bg-white/80 h-9 min-h-9 text-xs text-gray-600"
              type="button"
            >
              <span className="text-ucass-active">{pastMeetingList?.length || 0}</span>
              meeting(s)
            </Button>
          </div>
          <div ref={scrollContainerRef} className="flex flex-1 min-h-0 flex-col gap-3 ">
            {isPendingPastMeeting ? (
              <div className="flex items-center justify-center p-5">
                <Loader variant="blue" size="sm" />
              </div>
            ) : pastMeetingList && pastMeetingList?.length ? (
              pastMeetingList?.map((meeting: any) => {
                if (!meeting) return null;
                const formattedDate = formatMeetingDate(meeting?.startTimeLocal) || '';
                const meetingMembers = Array.isArray(meeting?.members)
                  ? meeting.members.filter(
                      (member: any) => member?.type !== 'ADMIN' && member?.meetJoined === true,
                    )
                  : [];
                const guestMembers = meetingMembers.filter((member: any) => isGuestMember(member));
                const nonGuestMembers = meetingMembers.filter(
                  (member: any) => !isGuestMember(member),
                );
                const previewMembers = meetingMembers.slice(0, 3);
                const remainingMembersCount = Math.max(
                  meetingMembers.length - previewMembers.length,
                  0,
                );
                const feedbackCount = Array.isArray(meeting?.feedback)
                  ? meeting.feedback.length
                  : 0;
                const hostMember = meetingMembers.find((member: any) => isAdminMember(member));
                const hostName =
                  String(
                    meeting?.hostName || (hostMember ? getMemberName(hostMember) : ''),
                  ).trim() || 'Host';
                return (
                  <div
                    key={meeting?.meetingId}
                    className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-5 shadow-[1px_1px_5px_rgba(0,0,0,0.05)] sm:flex-row sm:items-center sm:justify-between"
                    onClick={() => setSelectedMeeting(meeting)}
                  >
                    <div className="flex w-full min-w-0 items-start">
                      <div className="flex gap-4 items-center">
                        <div className="rounded-lg min-h-11 min-w-11 max-w-11 max-h-11 flex flex-col justify-center items-center text-ucass-active bg-ucass-active-bg">
                          <div className="text-[11px] uppercase font-medium ">
                            {formattedDate?.month || ''}
                          </div>
                          <div className="text-sm uppercase font-extrabold leading-4">
                            {formattedDate?.day}
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                          <h4 className="text-md font-semibold break-words">
                            {meeting?.name || 'Meeting Name'}
                          </h4>
                          <div className="flex flex-wrap gap-2 w-full items-center text-gray-600">
                            <div className="flex items-center gap-1 text-[11px]">
                              <Clock4Icon className="w-3 h-3" />
                              <div className="flex">
                                {getAbbreviationByTimeZone(meeting?.timezone)}{' '}
                                {formatTime(meeting?.startTimeLocal)} -{' '}
                                {formatTime(meeting?.endTimeLocal) || ''}
                              </div>
                            </div>
                            <div
                              className="flex items-center cursor-pointer"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!meetingMembers.length) return;
                                setModalState({
                                  meetingInfo: false,
                                  meetingAttendee: false,
                                  meetingInvites: true,
                                  isDelete: false,
                                });
                                setSelectedMeeting(meeting);
                              }}
                            >
                              {previewMembers.length
                                ? previewMembers.map((member: any, memberIndex: number) => (
                                    <div
                                      key={`${member?.userId || member?.user_uuid || member?.email || memberIndex}`}
                                      className={`min-w-6 min-h-6 max-w-6 max-h-6 flex justify-center items-center rounded-full font-medium text-[10px] border-2 border-white ${MEMBER_AVATAR_TONE_CLASSES[memberIndex % MEMBER_AVATAR_TONE_CLASSES.length]} ${memberIndex === 0 ? '' : '-ml-2'}`}
                                      title={getMemberName(member)}
                                    >
                                      {getMemberInitial(member)}
                                    </div>
                                  ))
                                : null}
                              {remainingMembersCount > 0 && (
                                <div className="min-w-6 min-h-6 max-w-6 max-h-6 flex justify-center items-center rounded-full text-gray-600 font-medium bg-gray-200 text-[10px] border-2 border-white -ml-2">
                                  +{remainingMembersCount}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-[11px]">
                              <div className="flex">
                                {formatMemberCountLabel(
                                  nonGuestMembers.length,
                                  'member',
                                  'members',
                                )}
                                , {formatMemberCountLabel(guestMembers.length, 'guest', 'guests')}
                              </div>
                            </div>
                            <div
                              className="flex items-center gap-1 text-[11px] cursor-pointer"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!feedbackCount) return;
                                setDrawerState({ meetingFeedback: true });
                                setSelectedMeeting(meeting);
                              }}
                            >
                              <Icon name="FeedbackIconLine" className="w-3.5 h-3.5" />
                              <div className="flex">{feedbackCount}</div>
                            </div>
                            <div className="flex items-center gap-1 text-[11px] ml-2">
                              <div className="flex text-gray-500">Host :</div>
                              <div className="min-w-6 min-h-6 max-h-6 flex justify-center items-center rounded-sm text-primary font-medium bg-ucass-active-bg text-[10px] border border-ucass-active/20 px-2">
                                {hostName}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex w-full items-center justify-start gap-2 sm:w-auto sm:justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="focus:outline-0 border border-gray-200 cursor-pointer flex items-center justify-center rounded-xl w-9 h-9 min-h-9 bg-[#f7f9fc] text-gray-900/80 hover:bg-gray-100 hover:text-gray-600"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Icon name="MenuDots" className="w-5 h-5 " />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          sideOffset={8}
                          className="min-w-[142px] overflow-hidden rounded-xl border border-[#e5e7eb] bg-white p-0 shadow-[0_6px_14px_rgba(15,23,42,0.12)]"
                        >
                          <DropdownMenuItem
                            className="h-10 rounded-none px-4 text-[15px] font-normal leading-none text-[#1f2937] hover:bg-[#f3f4f6] focus:bg-[#f3f4f6]"
                            onClick={() => {
                              setSelectedMeeting(meeting);
                              setModalState({ meetingInfo: true });
                            }}
                            disabled={!videAccess?.view}
                          >
                            Info
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="h-10 rounded-none px-4 text-[15px] font-normal leading-none text-[#1f2937] hover:bg-[#f3f4f6] focus:bg-[#f3f4f6]"
                            onClick={() => {
                              setSelectedMeeting(meeting);
                              setModalState({ meetingInvites: true });
                            }}
                            disabled={!videAccess?.view}
                          >
                            Invited Members
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="h-10 rounded-none px-4 text-[15px] font-normal leading-none text-[#1f2937] hover:bg-[#f3f4f6] focus:bg-[#f3f4f6]"
                            onClick={() => {
                              setSelectedMeeting(meeting);
                              setModalState({ meetingAttendee: true });
                            }}
                            disabled={!videAccess?.view}
                          >
                            Attendees
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="h-10 rounded-none px-4 text-[15px] font-normal leading-none text-[#1f2937] hover:bg-[#f3f4f6] focus:bg-[#f3f4f6]"
                            onClick={() => handleOpenMeetingChat(meeting)}
                            disabled={!videAccess?.view || !meeting?.meetingId}
                          >
                            Chat
                          </DropdownMenuItem>
                          {meeting?.recording === true && (
                            <DropdownMenuItem
                              className="h-10 rounded-none px-4 text-[15px] font-normal leading-none text-[#1f2937] hover:bg-[#f3f4f6] focus:bg-[#f3f4f6] cursor-pointer"
                              onClick={() => {
                                navigate(
                                  `/video/recordings/all?search=${encodeURIComponent(meeting?.name || '')}`,
                                );
                              }}
                            >
                              View Recording
                            </DropdownMenuItem>
                          )}
                          {videAccess?.delete ? (
                            <DropdownMenuItem
                              className="h-10 rounded-none px-4 text-[15px] font-normal leading-none text-red-500 hover:bg-red-50 focus:bg-red-50"
                              onClick={() => {
                                setSelectedMeeting(meeting);
                                setModalState({ isDelete: true });
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="w-full max-w-96 min-h-52  p-4 rounded-lg   m-auto border border-gray-100 flex flex-col items-center justify-center gap-2">
                <img src={NotFound} alt="BusyImage" className="min-w-28 w-28" />
                <p className="flex items-center justify-center text-gray-900 font-medium">
                  No meeting history available!
                </p>
                <p className="text-sm text-gray-700">Your completed meetings will be shown here.</p>
              </div>
            )}
            {isFetchingNextPage && (
              <div className="flex items-center justify-center p-5">
                <Loader variant="blue" size="sm" />
              </div>
            )}
            <div ref={observerTarget} className="h-4" />
          </div>
        </div>
      </div>

      {drawerState?.meetingFeedback && (
        <SideDrawer
          width="30%"
          isOpen={drawerState?.meetingFeedback}
          title="Feedback"
          handleClose={() => setDrawerState((prev: any) => ({ ...prev, meetingFeedback: false }))}
          content={
            <MeetingFeedback
              feedback={
                selectedMeeting?.feedback && Array.isArray(selectedMeeting.feedback)
                  ? selectedMeeting.feedback
                  : []
              }
            />
          }
          enableResponsive
        />
      )}
      {modalState?.meetingInfo && (
        <MeetingInfo
          modalState={modalState}
          setModalState={setModalState}
          meetingInfoData={selectedMeeting}
        />
      )}
      {modalState?.meetingInvites && (
        <MeetingMembersModal
          modalState={modalState}
          setModalState={setModalState}
          members={
            selectedMeeting?.members && Array.isArray(selectedMeeting.members)
              ? selectedMeeting.members?.filter((member: any) => member?.type !== 'ADMIN')
              : []
          }
          title="Invited Members"
        />
      )}

      {modalState?.meetingAttendee && (
        <MeetingMembersModal
          modalState={modalState}
          setModalState={setModalState}
          members={
            selectedMeeting?.members && Array.isArray(selectedMeeting?.members)
              ? selectedMeeting?.members?.filter((member: any) => member?.type !== 'ADMIN')
              : []
          }
          title="Attendees"
          filterFn={(user) => user?.meetJoined === true}
        />
      )}
      <Dialog
        open={Boolean(modalState?.meetingChat)}
        onOpenChange={(open) => {
          setModalState((prev: any) => ({ ...prev, meetingChat: open }));
          if (!open) setSelectedMeeting(null);
        }}
      >
        <DialogContent
          className="w-[96vw] max-w-[1100px] h-[88vh] overflow-hidden border border-border p-0"
          showCloseButton={false}
        >
          <button
            type="button"
            className="absolute top-3.5 right-3.5 z-20 cursor-pointer flex items-center justify-center rounded-full w-9 h-9 bg-gray-100 text-gray-900/80 hover:bg-ucass-active hover:text-white transition-colors duration-200"
            onClick={() => {
              setModalState((prev: any) => ({ ...prev, meetingChat: false }));
              setSelectedMeeting(null);
            }}
            aria-label="Close chat modal"
          >
            <X className="w-4 h-4" />
          </button>
          {meetingChatId ? (
            <div className="h-full min-h-0">
              <Chat
                chatId={meetingChatId}
                fromMeetChat={false}
                isAgentChat={false}
                allowFallbackChat={true}
                fallbackChat={{
                  name: meetingChatName,
                  description: meetingChatDescription,
                  users: meetingChatUsers,
                }}
                disableMessageHoverActions={true}
                disableRouteMaxHeight={true}
                hideFooter={true}
                disableCallActions={true}
                hiddenHeaderActions={['notes', 'folders', 'description']}
                disableInitialMessageFetch={true}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center px-6 text-sm text-gray-600">
              Meeting chat is not available.
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertConfirm
        {...{
          apiLoading: isPendingDeleteMeeting,
          descriptionTextComp: 'If you delete this meeting, the recording will also be deleted.',
          onConfirm: () => {
            if (selectedMeeting?.meetingId) {
              mutateMeetingDelete(selectedMeeting.meetingId);
            }
          },
          open: modalState?.isDelete,
          setOpen: (open: boolean) =>
            !open && setModalState((prev: any) => ({ ...prev, isDelete: false })),
        }}
      />
    </section>
  );
};

export default PastMeetings;
