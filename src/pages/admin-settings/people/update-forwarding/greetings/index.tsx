import CommonGreetingNotification from '@/components/common-greetings';
import { useGetGreetings } from '@/hooks/common';
import { greetingOptionsForSlots } from '@/lib/greeting-slots';

const GreetingNotification = ({ customClass }: any) => {
  /* The whole library, not the pre-filtered lists: those filter on the
     original `greeting` type and so cannot see the stock recordings, which
     are typed by slot. greeting-slots.ts holds the mapping. */
  const { allGreetings } = useGetGreetings();

  const optionsData = greetingOptionsForSlots(allGreetings, [
    'welcome_greeting',
    'on_hold',
    'on_hold_music',
    'ring_tone',
    'voicemail',
  ]);

  const mediaOptionsGreetingNotifications = [
    {
      name: 'welcome_greeting',
      placeholder: 'Welcome',
      label: 'welcome',
      icon: 'MessageStrokIcon',
      iconClass: 'h-5 w-5 text-primary',
    },
    {
      name: 'on_hold_music',
      placeholder: 'On Hold Music',
      label: 'on hold music',
      icon: 'HoldMusicIcon',
      iconClass: 'h-5 w-5 text-orange-500',
    },
    {
      name: 'voicemail',
      placeholder: 'Voicemail',
      label: 'voicemail',
      icon: 'VoicemailborderIcon',
      iconClass: 'h-5 w-5 text-green-500',
    },
    {
      name: 'ring_tone',
      placeholder: 'Ring Tone',
      label: 'ring tone',
      icon: 'RingtoneIcon',
      iconClass: 'h-4 w-4 text-purple-500',
    },
  ].filter(Boolean) as {
    name: string;
    placeholder: string;
    label: string;
    icon: any;
    iconClass: string;
  }[];

  return (
    <section className="mcm-fsec">
      <div className="mcm-fsec-h">
        <div className="mcm-fsec-t">Media</div>
        <div className="mcm-fsec-d">
          The audio callers hear on this extension. Anything left unset falls back to the account
          default.
        </div>
      </div>
      <CommonGreetingNotification
        {...{ mediaOptionsGreetingNotifications, optionsData }}
        customClass={customClass}
      />
    </section>
  );
};

export default GreetingNotification;
