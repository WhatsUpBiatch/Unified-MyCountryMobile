import { useState, useRef, useCallback, useEffect } from 'react';
import { Icon } from '@/assets/icons/icon';
import Loader from '@/components/custom/loader';
import {
  formatMeetingDate,
  formatTime,
  getAbbreviationByTimeZone,
  handleAlert,
  isMeetingActive,
} from '@/lib/utils';
import { createMeeting, meetingList } from '@/services/api';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MeetingMembersModal from '../meeting-members-modal';
import { Button } from '@/components/ui/button';
import MeetingInfo from '../meeting-info-modal';
import { CircleX, Clock4Icon, InfoIcon } from 'lucide-react';
import NotFound from '@/assets/images/not-found-img.svg';
import AlertConfirm from '@/components/custom/alert-confirm';
import { useUser } from '@/hooks/use-user';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useCompanyFeatures } from '@/hooks/rbac';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

const OngoingMeetings = () => {
  const queryClient = useQueryClient();
  const { features } = useCompanyFeatures();
  const videAccess = features?.plan_features?.video?.action || {};
  const { user } = useUser();
  const { handleTerminateCall, handleMeetLeave } = useSocketEvents();
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const [meetingToCancel, setMeetingToCancel] = useState<any>(null);
  const [meetingToEndForAll, setMeetingToEndForAll] = useState<any>(null);
  const [modalState, setModalState] = useState<any>({
    meetingAttendee: false,
    meetingInvites: false,
    meetingInfo: false,
  });
  const observerTarget = useRef(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending: isPendingOnglingMeeting,
  } = useInfiniteQuery({
    queryKey: ['ongoingMeetingList'],
    queryFn: ({ pageParam = 1 }) =>
      meetingList({ listType: 'ongoing', page: pageParam, limit: 25 }),
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

  const { mutate: cancelMeetingMutate, isPending: isPendingCancelMeeting } = useMutation({
    mutationFn: (payload: { meetingId: string; status: string }) => createMeeting(payload),
    onSuccess: () => {
      handleAlert({ text: 'Meeting cancelled successfully', type: 'success' });
      setMeetingToCancel(null);
      queryClient.invalidateQueries({ queryKey: ['ongoingMeetingList'] });
    },
  });

  const emitEndForAllEvent = (meetingId?: string) => {
    if (!meetingId || !user?.uuid) return;
    handleTerminateCall({
      chatId: meetingId,
      userID: user.uuid,
    });
    handleAlert({ text: 'Meeting ended for all successfully', type: 'success' });
    setMeetingToEndForAll(null);
    // queryClient.invalidateQueries({ queryKey: ['ongoingMeetingList'] });
  };

  const emitLeaveForSelfEvent = (meetingId?: string) => {
    if (!meetingId || !user?.uuid) return;
    handleMeetLeave({
      chatId: meetingId,
      userID: user.uuid,
    });
    handleAlert({ text: 'Meeting left successfully', type: 'success' });
    setMeetingToEndForAll(null);
    // queryClient.invalidateQueries({ queryKey: ['ongoingMeetingList'] });
  };

  // Flatten all pages into a single array
  const ongoingMeetingList =
    data?.pages?.flatMap((page) => page?.data?.data?.result?.rows || []) || [];

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
              Ongoing Meetings <InfoIcon className="w-3 h-3 text-gray-600" />
            </h4>
            <Button
              variant="outline"
              className="justify-center shadow-none sm:w-auto hover:bg-gray-50 hover:text-gray-600 border-gray-200 bg-white/80 h-9 min-h-9 text-xs text-gray-600"
              type="button"
            >
              <span className="text-ucass-active">{ongoingMeetingList?.length || 0}</span>
              meeting(s)
            </Button>
          </div>
          <div ref={scrollContainerRef} className="flex flex-1 min-h-0 flex-col gap-3 ">
            {isPendingOnglingMeeting ? (
              <div className="flex items-center justify-center p-5">
                <Loader variant="blue" size="sm" />
              </div>
            ) : ongoingMeetingList && ongoingMeetingList?.length ? (
              ongoingMeetingList?.map((meeting: any) => {
                if (!meeting) return null;
                const formattedDate = formatMeetingDate(meeting?.startTimeLocal) || '';
                const isActive = isMeetingActive(
                  meeting?.startTimeLocal,
                  meeting?.endTimeLocal,
                  meeting?.status,
                );
                const meetingMembers = Array.isArray(meeting?.members)
                  ? meeting.members.filter(
                      (member: any) => member?.type !== 'ADMIN' && member?.invited === true,
                    )
                  : [];
                const currentUserMember =
                  (meeting?.members || [])?.find(
                    (member: any) =>
                      member?.userId === user?.uuid ||
                      member?.user_uuid === user?.uuid ||
                      member?.email === user?.email,
                  ) || null;
                const isCurrentUserJoined = currentUserMember?.joinStatus?.toUpperCase() === 'YES';
                const isCurrentUserAdmin = currentUserMember?.type?.toUpperCase() === 'ADMIN';
                const shouldShowEndMeeting = isCurrentUserJoined;
                const shouldShowJoinMeeting = isActive && !isCurrentUserJoined;
                const guestMembers = meetingMembers.filter((member: any) => isGuestMember(member));
                const nonGuestMembers = meetingMembers.filter(
                  (member: any) => !isGuestMember(member),
                );
                const previewMembers = meetingMembers.slice(0, 3);
                const remainingMembersCount = Math.max(
                  meetingMembers.length - previewMembers.length,
                  0,
                );
                const hostMember = meetingMembers.find((member: any) => isAdminMember(member));
                const hostName =
                  String(
                    meeting?.hostName || (hostMember ? getMemberName(hostMember) : ''),
                  ).trim() || 'Host';
                const hostMemberId = hostMember?.userId || hostMember?.user_uuid || '';
                const currentUserEmail = user?.email || user?.user_info?.email || '';
                const isCurrentUserHost = Boolean(
                  hostMemberId === user?.uuid ||
                  meeting?.createdById === user?.uuid ||
                  (currentUserEmail && hostMember?.email === currentUserEmail),
                );
                const hostLabel = isCurrentUserHost ? `${hostName} (You)` : hostName;
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
                          <div className="flex items-center flex-wrap gap-2">
                            <h4 className="min-w-0 text-md font-semibold break-words">
                              {meeting?.name || 'Meeting Name'}
                            </h4>
                          </div>
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
                              onClick={() => {
                                if (!meetingMembers.length) return;
                                setModalState({ meetingInvites: true });
                                setSelectedMeeting(meeting);
                              }}
                            >
                              {previewMembers.length
                                ? previewMembers?.map((member: any, memberIndex: number) => (
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
                            <div className="flex items-center gap-1 text-[11px] ml-2">
                              <div className="flex text-gray-500">Host :</div>
                              <div className="min-w-6 min-h-6 max-h-6 flex justify-center items-center rounded-sm text-primary font-medium bg-ucass-active-bg text-[10px] border border-ucass-active/20 px-2">
                                {hostLabel}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex w-full items-center justify-start gap-2 sm:w-auto sm:justify-end">
                      {/* <Button
                        variant="outline"
                        className="h-8 min-h-8 rounded-xl border-primary px-4 text-primary hover:bg-primary/5"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!meetingMembers.length) return;
                          setSelectedMeeting(meeting);
                          setModalState({ meetingInvites: true });
                        }}
                      >
                        <Icon name="PlusIcon" className="w-3.5 h-3.5" />
                        Invite
                      </Button> */}
                      {shouldShowEndMeeting ? (
                        <Button
                          variant="destructiveOutline"
                          className="h-9 min-h-9 rounded-xl border-[#9a2438] bg-white px-4 text-[#9a2438] hover:bg-[#9a2438]/5"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isCurrentUserAdmin) {
                              setMeetingToEndForAll({
                                meetingId: meeting?.meetingId,
                                sessionId: currentUserMember?.sessionId,
                              });
                              return;
                            }
                            emitLeaveForSelfEvent(meeting?.meetingId);
                          }}
                        >
                          <CircleX className="size-[16px] " />
                          End Meeting
                        </Button>
                      ) : shouldShowJoinMeeting ? (
                        <Button
                          className="h-9 min-h-9 rounded-xl bg-[#12b981] border border-[#12b981] px-6 text-white hover:bg-[#0fa271]"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            window.open(`/video-meet?meetCode=${meeting?.meetingId}`);
                          }}
                        >
                          <Icon name="VideoIcon" className="w-3.5 h-3.5" />
                          Join Now
                        </Button>
                      ) : null}
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
                  No active meetings right now
                </p>
                <p className="text-sm text-gray-700">Start a meeting to begin a video call.</p>
              </div>
            )}
            {/* Loading indicator for next page */}
            {isFetchingNextPage && (
              <div className="flex items-center justify-center p-5">
                <Loader variant="blue" size="sm" />
              </div>
            )}
            {/* Observer target for infinite scroll */}
            <div ref={observerTarget} className="h-4" />
          </div>
        </div>
      </div>
      {modalState?.meetingInfo && (
        <MeetingInfo
          modalState={modalState}
          setModalState={setModalState}
          meetingInfoData={selectedMeeting}
        />
      )}
      {modalState?.meetingAttendee && (
        <MeetingMembersModal
          modalState={modalState}
          setModalState={setModalState}
          members={
            selectedMeeting?.members && Array.isArray(selectedMeeting?.members)
              ? selectedMeeting.members?.filter((member: any) => member?.type !== 'ADMIN')
              : []
          }
          title="Attendees"
          filterFn={(user) => user?.meetJoined === true}
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
      <AlertConfirm
        open={!!meetingToCancel}
        setOpen={(open) => !open && setMeetingToCancel(null)}
        headerText="What would you like to do?"
        descriptionTextComp={
          <p className="text-md">Do you want to reschedule or cancel this meeting?</p>
        }
        closeBtnText="Reschedule"
        confirmBtnText="Cancel Meeting"
        apiLoading={isPendingCancelMeeting}
        onConfirm={() => {
          if (meetingToCancel?.meetingId) {
            cancelMeetingMutate({ meetingId: meetingToCancel.meetingId, status: 'CANCEL' });
          }
        }}
      />
      <AlertConfirm
        open={!!meetingToEndForAll}
        setOpen={(open) => !open && setMeetingToEndForAll(null)}
        headerText="Please confirm"
        descriptionTextComp={<p className="text-md">Are you sure you want to end this meeting?</p>}
        closeBtnText="Leave Meeting"
        confirmBtnText="End for all"
        apiLoading={false}
        onCancel={() => {
          if (meetingToEndForAll?.meetingId) {
            emitLeaveForSelfEvent(meetingToEndForAll.meetingId);
          }
        }}
        onConfirm={() => {
          if (meetingToEndForAll?.meetingId) {
            emitEndForAllEvent(meetingToEndForAll.meetingId);
          }
        }}
      />
    </section>
  );
};

export default OngoingMeetings;
