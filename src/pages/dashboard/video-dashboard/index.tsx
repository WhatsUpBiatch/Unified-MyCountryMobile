import { Icon } from '@/assets/icons/icon';
import Loader from '@/components/custom/loader';
import NotFound from '@/assets/images/not-found-img.svg';
import {
  canDeleteMeeting,
  canEditMeeting,
  formatMeetingDate,
  formatTime,
  getAbbreviationByTimeZone,
  handleAlert,
  initialCallGraphData,
  initialVideoGraphData,
  isDateFuture,
} from '@/lib/utils';
import {
  createMeeting,
  meetingDelete,
  meetingList,
  sendInvites,
  videoDashboardStats,
} from '@/services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { WelcomeModalPopup } from '../welcome-modal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import SideDrawer from '@/components/custom/side-drawer';
import ScheduleMeeting from '@/pages/video-meetings/schedule-meeting';
import moment from 'moment';
import { CallGraphData } from '../constant';
import JoinMeetingModal from '@/pages/video-meetings/upcoming-meetings/join-meeting-modal';
import MeetingMembersModal from '@/pages/video-meetings/meeting-members-modal';
import AlertConfirm from '@/components/custom/alert-confirm';
import { useUser } from '@/hooks/use-user';
import MeetingInfo from '@/pages/video-meetings/meeting-info-modal';
import CustomTooltip from '@/components/custom/custom-tooltip';
import { LucideUserRoundCheck, UserPlus } from 'lucide-react';
import { getMeetingStatus } from '@/pages/video-meetings/schedule-meeting/constant';
import InviteMembersModal from '@/pages/video-meetings/send-invites/invite-members';
import InviteOthersModal from '@/pages/video-meetings/send-invites/invite-others';
import { useForm } from 'react-hook-form';
import { useCompanyFeatures } from '@/hooks/rbac';

// Helper function to check if current time is within meeting time range
export const isMeetingActive = (startTime: string, endTime: string) => {
  const now = moment();
  const start = moment(startTime);
  const end = moment(endTime);
  return now.isBetween(start, end, null, '[]'); // inclusive of start and end
};
const BarChart = ({
  data = initialCallGraphData,
  isPendingStatsData = false,
}: {
  data: CallGraphData;
  isPendingStatsData: boolean;
}) => {
  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute' }}>
      {isPendingStatsData ? (
        <div className="h-full w-full bg-white ">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2  bg-white ">
            <div className="flex items-center justify-center p-5">
              <Loader variant="blue" />
            </div>
          </div>
        </div>
      ) : (
        <Bar
          className="graph"
          options={{
            maintainAspectRatio: false,
            responsive: true,
            plugins: {
              legend: {
                position: 'top',
                labels: {
                  boxWidth: 15,
                  boxHeight: 15,
                },
              },
              title: {
                display: false,
                font: {
                  size: 16,
                  weight: 'bold',
                },
                padding: {
                  top: 5,
                  bottom: 5,
                },
              },
            },
            scales: {
              y: {
                ticks: {
                  stepSize: 1,
                },
              },
            },
            datasets: {
              bar: {
                barPercentage: 0.4,
              },
            },
          }}
          data={data || initialVideoGraphData}
          style={{ height: '100%' }}
        />
      )}
    </div>
  );
};

type MeetingListType = 'upcoming_owned' | 'invited';

const VideoDashboard = () => {
  const { user } = useUser();
  const [date] = useState<Date | undefined>(new Date());
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const [drawerState, setDrawerState] = useState<any>(false);
  const queryClient: any = useQueryClient();
  const [modalState, setModalState] = useState({
    joinMeeting: false,
    isMeetingDelete: false,
    meetingInvites: false,
    meetingInfo: false,
    meetingAttendee: false,
    inviteMembers: false,
    inviteOthers: false,
  });
  const formInstance = useForm<any>({
    defaultValues: {
      inviteOthers: [],
      members: [],
      meeting_id: '',
    },
  });
  const { watch, setValue } = formInstance;
  const { features } = useCompanyFeatures();
  const videAccess = features?.plan_features?.video?.action || {};

  const { data: dashboardStatsData, isPending: isPendingStatsData } = useQuery({
    queryKey: ['videoDashboardStats'],
    queryFn: videoDashboardStats,
    select: (data) => data?.data?.data?.result?.data,
  });

  const graphData =
    dashboardStatsData?.graph_data && Object.keys(dashboardStatsData?.graph_data).length > 0
      ? dashboardStatsData?.graph_data
      : {
          datasets: [],
          labels: [],
        };

  const { data: upcomingMeetings, isPending: isPendingUpcomingMeetings } = useQuery({
    queryKey: ['upcomingList', 'upcoming_owned', date],
    queryFn: () =>
      meetingList({
        listType: 'upcoming_owned',
        filter_date: {
          from: moment(date)?.format('YYYY-MM-DD'),
          to: moment(date)?.format('YYYY-MM-DD'),
        },
      }),
    select: (data) => data?.data?.data?.result?.rows,
  });
  const { data: invitedMeetings, isPending: isPendingInvitedMeetings } = useQuery({
    queryKey: ['upcomingList', 'invited', date],
    queryFn: () =>
      meetingList({
        listType: 'invited',
        filter_date: {
          from: moment(date)?.format('YYYY-MM-DD'),
          to: moment(date)?.format('YYYY-MM-DD'),
        },
      }),
    select: (data) => data?.data?.data?.result?.rows,
  });

  const { mutate: mutateMeetingDelete, isPending } = useMutation({
    mutationFn: meetingDelete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['videoDashboardStats'] });
      queryClient.invalidateQueries({ queryKey: ['upcomingList'] });
      handleAlert({ text: 'Meeting deleted successfully', type: 'success' });
      setModalState((prev) => ({ ...prev, isMeetingDelete: false }));
      setSelectedMeeting(null);
    },
  });
  const { mutate: mutateInstantMeeting, isPending: isPendingInstantMeeting } = useMutation({
    mutationFn: createMeeting,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['videoDashboardStats'] });
      const meetingData = data?.data?.data?.result;
      const meetingId = meetingData?.meetingId;
      window.open(`/video-meet?meetCode=${meetingId}`);
    },
  });
  const { mutate: mutateSendInvite, isPending: isPendingInvites } = useMutation({
    mutationFn: sendInvites,
    onSuccess: () => {
      setModalState((prev) => ({ ...prev, inviteMembers: false, inviteOthers: false }));
      handleAlert({ text: 'Invite sent successfully', type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['upcomingList'] });
      setValue('inviteOthers', []);
      setValue('members', []);
    },
  });
  useEffect(() => {
    if (selectedMeeting?.members && Array.isArray(selectedMeeting?.members)) {
      setValue('members', selectedMeeting?.members, { shouldValidate: true });
    } else {
      setValue('members', []);
    }
  }, [selectedMeeting?.members]);
  const InstantMeeting = () => {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const normalizedTz = tz === 'Asia/Calcutta' ? 'Asia/Kolkata' : tz;
    const payload = {
      name: '',
      startTime: moment(now).format('YYYY-MM-DD HH:mm:ss'),
      allowHost: 'Y',
      timezone: normalizedTz,
      meetingType: 'INSTANT',
      mode: 'VIDEO',
      duration: 0,
    };
    mutateInstantMeeting(payload);
  };

  const handleSendInvite = async () => {
    const isValid = await formInstance.trigger(['members', 'inviteOthers']);
    if (!isValid) return;
    const members = watch('members');
    const invitedOthers = watch('inviteOthers');
    const existingMembers =
      selectedMeeting?.members && Array.isArray(selectedMeeting?.members)
        ? selectedMeeting?.members?.map((m: any) => m?.user_uuid || m?.userId)
        : [];

    const formattedMeetingInfoData = members?.map((obj: any) => {
      const id = obj?.user_uuid || obj?.userId || '';
      const isNewMember = !existingMembers.includes(id);

      const cleanedObj = {
        ...obj,
        user_uuid: id,
        invitation_sent: isNewMember ? false : true,
      };

      delete cleanedObj.source;
      delete cleanedObj.joinStatus;
      delete cleanedObj._id;
      delete cleanedObj.userId;

      return cleanedObj;
    });
    const allInviteOthers = [...formattedMeetingInfoData, ...invitedOthers];
    const payload = {
      meetingId: selectedMeeting?.meetingId,
      members: invitedOthers?.length > 0 ? allInviteOthers : formattedMeetingInfoData,
    };
    mutateSendInvite(payload);
  };

  const meetingActionTiles = [
    videAccess?.create && {
      id: 'start-instant-meeting',
      title: isPendingInstantMeeting ? 'Please wait' : 'Start Instant Meeting',
      description: 'Host a video conference.',
      icon: 'VideoCameraLine' as const,
      onClick: InstantMeeting,
      disabled: isPendingInstantMeeting,
    },
    {
      id: 'join-meeting',
      title: 'Join a meeting',
      description: 'Enter a code or link.',
      icon: 'LinkLine' as const,
      onClick: () => setModalState((prev) => ({ ...prev, joinMeeting: true })),
      disabled: false,
    },
    videAccess?.create && {
      id: 'schedule-meeting',
      title: 'Schedule Meeting',
      description: 'Plan a future video meeting.',
      icon: 'CalendarAdd' as const,
      onClick: () => setDrawerState(true),
      disabled: false,
    },
    {
      id: 'view-recordings',
      title: 'View Recordings',
      description: 'Access your cloud recordings.',
      icon: 'VideoRecordingIcon' as const,
      onClick: () => window.open('/video/recordings/all', '_self'),
      disabled: false,
    },
  ].filter(Boolean) as Array<{
    id: string;
    title: string;
    description: string;
    icon: 'VideoCameraLine' | 'LinkLine' | 'CalendarAdd' | 'VideoRecordingIcon';
    onClick: () => void;
    disabled: boolean;
  }>;

  const renderMeetingList = (meetings: any[] = [], listType: MeetingListType) =>
    meetings.map((meeting: any) => {
      const isFutureTime = isDateFuture(meeting?.startTimeLocal);
      const formattedDate = formatMeetingDate(meeting?.startTimeLocal) || '';
      const canEdit = canEditMeeting(meeting?.startTimeLocal);
      const isActive = isMeetingActive(meeting?.startTimeLocal, meeting?.endTimeLocal);
      const { label, classes } = getMeetingStatus(isActive, isFutureTime);

      return (
        <div
          key={`${listType}-${meeting?.meetingId}`}
          className="flex items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white px-2.5 py-2"
        >
          <div className="flex min-w-0 items-start gap-2">
            <div className="flex min-w-[52px] flex-col items-center rounded-xl bg-slate-100 p-1.5">
              <p className="text-sm font-semibold text-slate-800">{formattedDate?.day || ''}</p>
              <p className="text-[11px] text-slate-500">{formattedDate?.month || ''}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <h4
                  className="max-w-[180px] truncate text-sm font-semibold text-slate-900"
                  title={meeting?.name || 'Meeting Name'}
                >
                  {meeting?.name || 'Meeting Name'}
                </h4>
                {listType === 'invited' && (
                  <>
                    <span className={`rounded-full px-1.5 py-0.5 text-xs ${classes}`}>{label}</span>
                    <CustomTooltip text={`Invited by: ${meeting?.hostName || 'Person'}`} side="top">
                      <UserPlus className="h-4 w-4 text-gray-500" />
                    </CustomTooltip>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-semibold flex items-center gap-1 text-xs text-gray-500">
                  <Icon name="TimerIcon" />
                  <span>{getAbbreviationByTimeZone(meeting?.timezone)}</span>
                  {formatTime(meeting?.startTimeLocal)} - {formatTime(meeting?.endTimeLocal) || ''}
                </p>
                <CustomTooltip text="Invitees" side="top">
                  <div
                    className="text-semibold flex cursor-pointer items-center gap-1 text-sm text-gray-500"
                    onClick={() => {
                      if (!meeting?.members?.length) return;
                      setModalState((prev) => ({ ...prev, meetingInvites: true }));
                      setSelectedMeeting(meeting);
                    }}
                  >
                    <Icon name="UsersIcon" className="h-4 w-4" />
                    {meeting?.members?.length || 0}
                  </div>
                </CustomTooltip>
                {(isActive || !isFutureTime) && (
                  <CustomTooltip text="Attendees" side="top">
                    <div
                      className="text-semibold flex cursor-pointer items-center gap-1 text-sm text-gray-500"
                      onClick={() => {
                        const joinedCount = Array.isArray(meeting?.members)
                          ? meeting.members.filter(
                              (user: { joinStatus: string }) =>
                                user?.joinStatus?.toUpperCase() === 'YES',
                            ).length
                          : 0;

                        if (joinedCount > 0) {
                          setModalState((prev) => ({
                            ...prev,
                            meetingAttendee: true,
                          }));
                          setSelectedMeeting(meeting);
                        }
                      }}
                    >
                      <LucideUserRoundCheck className="h-3.5 w-3.5" />
                      {Array.isArray(meeting?.members)
                        ? meeting?.members?.filter(
                            (user: { joinStatus: string }) => user?.joinStatus === 'YES',
                          )?.length
                        : 0}
                    </div>
                  </CustomTooltip>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isActive && (
              <span
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-green-100 text-green-500 hover:bg-green-500 hover:text-white"
                onClick={() => window.open(`/video-meet?meetCode=${meeting?.meetingId}`)}
              >
                <Icon name="VideocameraAdd" className="h-5 w-5" />
              </span>
            )}
            {listType === 'upcoming_owned' && canEdit && videAccess?.invite && (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-ucass-active-bg text-ucass-active hover:bg-ucass-active hover:text-white">
                  <Icon name="PlusIcon" className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => {
                      setModalState((prev) => ({
                        ...prev,
                        inviteMembers: true,
                      }));
                      setSelectedMeeting(meeting);
                    }}
                  >
                    Invite Members
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setModalState((prev) => ({
                        ...prev,
                        inviteOthers: true,
                      }));
                      setSelectedMeeting(meeting);
                    }}
                  >
                    Invite Others
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {(isActive || isFutureTime) && listType === 'invited' && (
              <span
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-500 hover:text-white"
                onClick={() => {
                  setModalState((prev) => ({
                    ...prev,
                    meetingInfo: true,
                  }));
                  setSelectedMeeting(meeting);
                }}
              >
                <Icon name="InfoIcon" className="h-4 w-4" />
              </span>
            )}
            {listType === 'upcoming_owned' && (
              <DropdownMenu>
                <DropdownMenuTrigger className="focus:outline-0 flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-full bg-gray-100 text-gray-900/80 hover:bg-primary hover:text-white">
                  <Icon name="MenuDots" className="h-5 w-5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {canEdit && meeting?.createdById === user?.uuid && videAccess?.edit && (
                    <DropdownMenuItem
                      onClick={() => {
                        setDrawerState(true);
                        setSelectedMeeting(meeting);
                      }}
                    >
                      Edit
                    </DropdownMenuItem>
                  )}
                  {(isActive || isFutureTime) && (
                    <DropdownMenuItem
                      onClick={() => {
                        setModalState((prev) => ({
                          ...prev,
                          meetingInfo: true,
                        }));
                        setSelectedMeeting(meeting);
                      }}
                    >
                      Info
                    </DropdownMenuItem>
                  )}
                  {canDeleteMeeting(meeting?.startTimeLocal, meeting?.endTimeLocal) &&
                    meeting?.createdById === user?.uuid &&
                    videAccess?.edit && (
                      <DropdownMenuItem
                        onClick={() => {
                          setModalState((prev) => ({
                            ...prev,
                            isMeetingDelete: true,
                          }));
                          setSelectedMeeting(meeting);
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      );
    });

  const renderMeetingPanel = ({
    title,
    description,
    listType,
    meetings,
    isPendingList,
  }: {
    title: string;
    description: string;
    listType: MeetingListType;
    meetings: any[];
    isPendingList: boolean;
  }) => (
    <div className="flex min-h-60 flex-1 flex-col rounded-3xl border border-gray-200 bg-white p-3 ">
      <div className="mb-2.5 px-1">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
        {isPendingList ? (
          <div className="flex h-full items-center justify-center p-5">
            <Loader variant="blue" size="sm" />
          </div>
        ) : meetings && meetings?.length ? (
          renderMeetingList(meetings, listType)
        ) : (
          <div className="mx-auto flex h-full w-full flex-col items-center justify-center gap-1 py-5">
            <img src={NotFound} alt="BusyImage" className="min-w-28 w-28" />
            <p className="text-center text-sm font-medium text-gray-900">
              {listType === 'invited' ? 'No meeting invitations yet' : 'Nothing scheduled yet'}
            </p>
            <p className="text-center text-xs text-gray-600">
              {listType === 'invited'
                ? 'Invited meetings will appear here when available.'
                : 'Create a meeting to get started.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <section className="flex xxl:h-full w-full overflow-auto bg-slate-50 pb-4 ">
      <div className="mx-auto flex h-full w-full  flex-col gap-4 px-3 pt-3 ">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {meetingActionTiles.map((tile) => (
            <button
              key={tile.id}
              type="button"
              onClick={tile.onClick}
              disabled={tile.disabled}
              className="group flex min-h-[100px] flex-col justify-between rounded-xl border border-gray-200 bg-white p-2.5 text-left transition-all hover:border-primary/30 hover:shadow-[0_6px_20px_rgba(15,23,42,0.06)] disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-[126px] sm:rounded-xl sm:p-4 gap-2"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-ucass-active-bg text-primary sm:h-10 sm:w-10 sm:rounded-xl">
                <Icon name={tile.icon} className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="flex justify-between items-center">
                <div className="space-y-1">
                  <h3 className="text-[11px] leading-4 font-semibold text-slate-900 sm:text-sm">
                    {tile.title}
                  </h3>
                  <p className="hidden text-xs text-slate-500 sm:block">{tile.description}</p>
                </div>
                <div className="hidden h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors group-hover:border-primary group-hover:text-primary sm:flex">
                  <Icon name="ArrowRightUp" className="h-3.5 w-3.5" />
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[1fr_30rem] ">
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Meeting volume summary</h2>
                <p className="text-sm text-slate-500">
                  Activity across the selected organization date
                </p>
              </div>
              <span className="rounded-full bg-ucass-active-bg px-3 py-1 text-xs font-medium text-primary">
                {moment(date).format('ddd, DD MMM')}
              </span>
            </div>
            <div className="chart-container flex w-full min-h-[360px] items-center justify-center rounded-2xl border border-slate-100 bg-slate-50/30">
              <BarChart data={graphData} isPendingStatsData={isPendingStatsData} />
            </div>
          </div>

          <div className="flex h-full  lg:min-h-0 xs:flex-col md:flex-row xl:flex-col gap-3">
            {renderMeetingPanel({
              title: 'Upcoming Meetings',
              description: 'Meetings hosted by you for the selected date.',
              listType: 'upcoming_owned',
              meetings: upcomingMeetings || [],
              isPendingList: isPendingUpcomingMeetings,
            })}
            {renderMeetingPanel({
              title: 'Invited Meetings',
              description: 'Meetings where you are invited for the selected date.',
              listType: 'invited',
              meetings: invitedMeetings || [],
              isPendingList: isPendingInvitedMeetings,
            })}
          </div>
        </div>
      </div>
      {modalState?.joinMeeting && (
        <JoinMeetingModal
          modalState={modalState?.joinMeeting}
          setModalState={(value) => setModalState((prev) => ({ ...prev, joinMeeting: value }))}
        />
      )}
      {modalState?.meetingInvites && (
        <MeetingMembersModal
          modalState={modalState?.meetingInvites}
          setModalState={(value) => {
            setModalState((prev) => ({ ...prev, meetingInvites: value }));
            setSelectedMeeting(null);
          }}
          members={selectedMeeting?.members || []}
          title="Invited Members"
        />
      )}
      {modalState?.isMeetingDelete && (
        <AlertConfirm
          {...{
            apiLoading: isPending,
            onConfirm: () => mutateMeetingDelete(selectedMeeting?.meetingId),
            open: modalState?.isMeetingDelete,
            setOpen: (value) => {
              setModalState((prev) => ({ ...prev, isMeetingDelete: value }));
              setSelectedMeeting(null);
            },
          }}
        />
      )}
      {modalState?.meetingAttendee && (
        <MeetingMembersModal
          modalState={modalState?.meetingAttendee}
          setModalState={(value) => {
            setModalState((prev) => ({ ...prev, meetingAttendee: value }));
            setSelectedMeeting(null);
          }}
          members={
            selectedMeeting?.members && Array.isArray(selectedMeeting.members)
              ? selectedMeeting.members
              : []
          }
          title="Attendees"
          filterFn={(user) => user?.joinStatus === 'YES'}
        />
      )}
      {modalState?.meetingInfo && (
        <MeetingInfo
          modalState={modalState?.meetingInfo}
          setModalState={(value) => {
            setModalState((prev) => ({ ...prev, meetingInfo: value }));
            setSelectedMeeting(null);
          }}
          meetingInfoData={selectedMeeting}
        />
      )}
      {drawerState && (
        <SideDrawer
          isOpen={drawerState}
          title={selectedMeeting ? 'Update Meeting' : 'Schedule New Meeting'}
          handleClose={() => {
            setSelectedMeeting(null);
            setDrawerState(false);
          }}
          content={
            <ScheduleMeeting
              initialData={selectedMeeting}
              onSuccess={() => {
                queryClient.invalidateQueries({ queryKey: ['videoDashboardStats'] });
                setSelectedMeeting(null);
              }}
              setDrawerState={(value) => {
                setDrawerState(value);
                setSelectedMeeting(null);
              }}
            />
          }
          isHeader={true}
          width="650px"
        />
      )}
      {modalState?.inviteMembers && (
        <InviteMembersModal
          modalState={modalState?.inviteMembers}
          setModalState={(value) => {
            setModalState((prev) => ({ ...prev, inviteMembers: value }));
          }}
          formInstance={formInstance}
          isPending={isPendingInvites}
          handleSendInvite={handleSendInvite}
        />
      )}
      {modalState?.inviteOthers && (
        <InviteOthersModal
          modalState={modalState?.inviteOthers}
          setModalState={(value) => {
            setModalState((prev) => ({ ...prev, inviteOthers: value }));
          }}
          formInstance={formInstance}
          handleSendInvite={handleSendInvite}
          isPending={isPendingInvites}
        />
      )}
      <WelcomeModalPopup />
    </section>
  );
};

export default VideoDashboard;
