import CommonGreetingNotification from '@/components/common-greetings';
import { useGetGreetings } from '@/hooks/common';
import { greetingOptionsForSlots } from '@/lib/greeting-slots';

const Media = () => {
  const { allGreetings } = useGetGreetings();

  const optionsData = greetingOptionsForSlots(allGreetings, ['welcome', 'hold', 'voicemail']);

  const mediaOptionsGreetingNotifications = [
    {
      name: 'welcome',
      placeholder: 'Welcome',
      label: 'welcome',
      icon: 'MessageStrokIcon',
      iconClass: 'h-5 w-5 text-primary',
    },
    {
      name: 'hold',
      placeholder: 'On Hold Music',
      label: 'on hold music',
      icon: 'HoldMusicIcon',
      iconClass: 'h-5 w-5 text-orange-500',
    },
  ].filter(Boolean);

  return (
    <CommonGreetingNotification
      {...{ mediaOptionsGreetingNotifications, optionsData, formParentKey: 'media' }}
    />
  );
};

export default Media;
