import { FilterIcon, Bell, PhoneIcon, VideocameraAdd } from '@/assets/icons';
import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { notificationFilters, notificationIconLookup } from '../constants';
import { useUser } from '@/hooks/use-user';
import { NOTIFICATION_TYPE_CONST } from '@/constants/common-const';
import moment from 'moment';
import { formatNotificationDate, handleAlert, removeEnvPrefix } from '@/lib/utils';
import Loader from '../../loader';
import NotFound from '@/assets/images/not-found-img.svg';
import { useQuery } from '@tanstack/react-query';
import { meetingList } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Icon as IconComponent } from '@/assets/icons/icon';
import { useDialpad } from '@/hooks/use-dialpad';
const NotificationContent = ({ setNotificationState }: { setNotificationState: any }) => {
  const { user } = useUser();
  const { makeCall } = useDialpad();
  // const { user_info } = user;
  const {
    getNotifications,
    notificationArr = [],
    markReadNotification,
    notificationLoading,
  } = useSocketEvents();
  const [mutatedNotifications, setMutatedNotifications] = useState<any>([]);

  const [notificationFilterValue, setNotificationFilterValue] = useState<any>({
    id: 1,
    label: 'All',
    value: ['all'],
    icon: <Bell className="text-gray-700 w-full h-full" />,
  });
  const { data: ongoingMeetingData } = useQuery({
    queryKey: ['ongoingMeetingList', 'notification-content'],
    queryFn: () => meetingList({ listType: 'ongoing', page: 1, limit: 100 }),
  });
  const ongoingMeetingList =
    ongoingMeetingData?.data?.data?.result?.rows &&
    Array.isArray(ongoingMeetingData?.data?.data?.result?.rows)
      ? ongoingMeetingData?.data?.data?.result?.rows
      : [];

  useEffect(() => {
    getNotifications();
  }, []);

  useEffect(() => {
    if (notificationArr && notificationArr?.length > 0) {
      const filtered_notifications =
        notificationArr?.length > 0
          ? notificationFilterValue?.value?.[0] === 'unread'
            ? notificationArr.filter(({ unread }) => unread)
            : notificationFilterValue?.value?.[0] !== 'all'
              ? notificationArr.filter(({ type }) => notificationFilterValue?.value?.includes(type))
              : notificationArr
          : [];
      setMutatedNotifications(filtered_notifications || []);
    } else {
      setMutatedNotifications([]);
    }
  }, [notificationArr, notificationFilterValue]);
  return (
    <div className="w-full mx-auto ">
      <div className="flex flex-col  gap-2 px-1 py-2">
        {/* This drawer is opened without a title, so SideDrawer renders no header
            row of its own — its close button is absolutely positioned at
            top-4/right-4 and lands on this row. `pr-12` keeps the filter button
            clear of it; `min-h-14` makes this row 56px so its centre line falls
            at the same 36px from the top as the 40px close button's, which is
            what puts the two circles level rather than merely side by side. */}
        <div className="flex min-h-14 items-center justify-between pr-12">
          <div className=" text-gray-900 font-semibold flex gap-2 items-center justify-between w-full">
            <div className="flex items-center gap-3 ">
              <div className="flex w-5 h-5">{notificationFilterValue?.icon}</div>
              <div className="flex text-lg">{notificationFilterValue?.label}</div>
            </div>
            <div className="flex items-center gap-3">
              {mutatedNotifications && mutatedNotifications?.length > 0 ? (
                <div
                  className="text-xs text-primary cursor-pointer"
                  onClick={() => {
                    markReadNotification('all');
                    setNotificationState(false);
                    handleAlert({
                      text: 'All the notifications has been marked as read.',
                      type: 'success',
                    });
                  }}
                >
                  Mark all as read
                </div>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <div
                    className={
                      'cursor-pointer flex items-center justify-center rounded-full w-10 h-10 bg-gray-100 text-gray-900/80 hover:bg-primary hover:text-white'
                    }
                  >
                    <FilterIcon className="w-5 h-5" />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {notificationFilters?.map((filter: any) => {
                    return (
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => setNotificationFilterValue(filter)}
                      >
                        <div className="w-6 h-6 p-1 bg-gray-50 border-gray-200 border rounded-full flex items-center justify-center">
                          {filter?.icon}
                        </div>
                        {filter?.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
      <hr className="text-gray-400 p-2 mt-1" />
      <div className="w-full overflow-auto h-[calc(100vh_-_5rem)] pr-1">
        {notificationLoading && mutatedNotifications?.length == 0 ? (
          <div className="flex justify-center items-center h-full">
            <Loader variant="blue" />
          </div>
        ) : mutatedNotifications && mutatedNotifications?.length > 0 ? (
          mutatedNotifications?.map((notification: any) => {
            const notificationtype =
              notification?.type === NOTIFICATION_TYPE_CONST.EVENT_REMINDER
                ? notification?.details?.category || NOTIFICATION_TYPE_CONST.EVENT
                : notification?.type;
            const Icon =
              notificationIconLookup?.[notificationtype] || notificationIconLookup?.['default'];
            console.log(notification?.type, 'notification');
            const eventStartTime =
              notification?.details?.startUtc &&
              (notification?.type === NOTIFICATION_TYPE_CONST.CALL_BACK_SCHEDULE ||
                notification?.details?.category === NOTIFICATION_TYPE_CONST.EVENT)
                ? moment.utc(notification?.details?.startUtc)
                : null;

            const eventEndTime =
              notification?.details?.endUtc &&
              notification?.details?.category === NOTIFICATION_TYPE_CONST.EVENT
                ? moment.utc(notification?.details?.endUtc)
                : null;

            const now = moment.utc();

            let actionIcon = null;
            let actionButton = null;

            const notificationChatId =
              notification?.chatId ||
              notification?.details?.chatId ||
              notification?.details?.meetingId ||
              notification?.value ||
              '';
            const matchedOngoingMeeting = notificationChatId
              ? ongoingMeetingList?.find(
                  (meeting: any) =>
                    meeting?.meetingId === notificationChatId ||
                    meeting?.chatId === notificationChatId ||
                    meeting?.meetingId === removeEnvPrefix(notificationChatId),
                )
              : null;
            const currentUserMember = matchedOngoingMeeting?.members?.find(
              (member: any) =>
                member?.userId === user?.uuid ||
                member?.user_uuid === user?.uuid ||
                member?.email === user?.user_info?.email,
            );
            const isCurrentUserJoined = currentUserMember?.joinStatus?.toUpperCase() === 'YES';
            const shouldShowJoinNowForInvite =
              notification?.type === 'meeting_invite' &&
              !!matchedOngoingMeeting &&
              !isCurrentUserJoined;
            // Call back schedule → show call icon if startUtc >= now
            if (
              notification?.type === NOTIFICATION_TYPE_CONST.CALL_BACK_SCHEDULE &&
              eventStartTime &&
              now.isSameOrAfter(eventStartTime)
            ) {
              actionIcon = (
                <span
                  className="cursor-pointer flex items-center justify-center rounded-full w-8 h-8 bg-green-100 text-green-500 hover:bg-green-400 hover:text-white"
                  onClick={() => {
                    const number = String(notification?.value || '').trim();
                    if (!number) return;
                    const extraHeaders = notification?.didNumber
                      ? [`X-CallerId: ${notification?.didNumber}`]
                      : [];
                    makeCall(number, { extraHeaders });
                  }}
                >
                  <PhoneIcon className="w-4 h-4" />
                </span>
              );
            }

            // Event → show video icon only within start and end time
            if (
              notification?.details?.category === NOTIFICATION_TYPE_CONST.EVENT &&
              eventStartTime &&
              eventEndTime &&
              now.isBetween(eventStartTime, eventEndTime)
            ) {
              actionIcon = (
                <span className="cursor-pointer flex items-center justify-center rounded-full w-8 h-8 bg-ucass-primary-200 text-primary hover:bg-primary hover:text-white">
                  <VideocameraAdd className="w-5 h-5" />
                </span>
              );
            }

            if (shouldShowJoinNowForInvite) {
              actionButton = (
                <Button
                  variant="outline"
                  className="min-h-8 h-8 px-3 text-xs text-primary border-primary bg-white hover:bg-primary/10 hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    markReadNotification(notification?._id);
                    setNotificationState(false);
                    window.open(`/video-meet?meetCode=${matchedOngoingMeeting?.meetingId}`);
                  }}
                >
                  <IconComponent name="VideoIcon" className="w-4 h-4" />
                  Join Now
                </Button>
              );
            }
            // // Event → show video icon only within start and end time
            // if (
            //   notification?.type === NOTIFICATION_TYPE_CONST.MEETING_REMINDER &&
            //   eventStartTime &&
            //   eventEndTime &&
            //   now.isBetween(eventStartTime, eventEndTime)
            // ) {
            //   actionIcon = (
            //     <span className="cursor-pointer flex items-center justify-center rounded-full w-8 h-8 bg-ucass-primary-200 text-primary hover:bg-primary hover:text-white">
            //       <VideocameraAdd className="w-5 h-5" />
            //     </span>
            //   );
            // }

            return (
              <div
                key={notification?._id}
                className={`relative w-full p-3 mt-2 bg-gray-50 border rounded-lg border-gray-200 flex cursor-pointer flex-shrink-0 ${shouldShowJoinNowForInvite ? 'pb-12' : ''} ${
                  notification?.unread ? 'opacity-100' : 'opacity-60'
                }`}
                onClick={() => markReadNotification(notification?._id)}
              >
                <div
                  aria-label="group icon"
                  role="img"
                  className="focus:outline-none w-11 h-11 border rounded-full border-gray-200 bg-white flex flex-shrink-0 items-center justify-center p-2"
                >
                  {Icon ? <div className="flex w-5 h-5">{Icon}</div> : null}
                </div>
                <div className="pl-3 w-full">
                  <div className="flex items-center justify-between w-full text-sm">
                    {notification?.description}
                  </div>
                  <p className="focus:outline-none text-xs leading-3 pt-1 text-gray-500">
                    {formatNotificationDate(notification?.createdAt)}
                  </p>
                </div>
                {actionIcon && <div className="flex items-start gap-2 ml-2">{actionIcon}</div>}
                {actionButton && <div className="absolute bottom-3 right-3">{actionButton}</div>}
              </div>
            );
          })
        ) : (
          <div className="w-full max-w-96 min-h-52  h-full p-4 rounded-lg   m-auto border border-gray-100 flex flex-col items-center justify-center gap-2">
            <img src={NotFound} alt="BusyImage" className="min-w-28 w-28" />
            <p className="flex items-center justify-center text-gray-900  font-medium">
              No Notification(s) Found!
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationContent;
