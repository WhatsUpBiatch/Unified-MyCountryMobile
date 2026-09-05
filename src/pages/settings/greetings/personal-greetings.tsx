/* The four greeting slots on your own Greetings page.
 *
 * This page used to borrow the People editor's "Media" step, whose heading
 * says "The audio callers hear on this extension. Anything left unset falls
 * back to the account default." That is only part true for a person. Since
 * the switch patch of 3 Sep 2026 the voicemail greeting saved here
 * (`greetings.voicemail`) is played before a caller records, on a call
 * dialled straight to the person - proven by offline tests and by reading the
 * running switch, not yet by a real call. The welcome message, hold music
 * and ring tone are still not read from a person's record, and there is no
 * fallback to an account default anywhere in the call path. Queue and menu
 * audio is played from the queue's or menu's own record.
 *
 * The shared row component takes no per-row badge, so the heading wears one
 * pill for each half and the sentence says which rows are which. The stored
 * key names are untouched; the switch-side work owns that spelling.
 *
 * The option lists and slot names are the same ones the admin step uses, so
 * a greeting picked here is the same record an admin would see.
 */

import CommonGreetingNotification from '@/components/common-greetings';
import { useGetGreetings } from '@/hooks/common';
import { greetingOptionsForSlots } from '@/lib/greeting-slots';
import { LiveFlag } from '../not-applied-note';

const PersonalGreetings = ({ customClass }: { customClass?: string }) => {
  const { allGreetings } = useGetGreetings();

  const optionsData = greetingOptionsForSlots(allGreetings, [
    'welcome_greeting',
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
  ];

  return (
    <section className="mcm-fsec">
      <div className="mcm-fsec-h">
        <div className="mcm-fsec-t flex flex-wrap items-center gap-2">
          Your recordings
          <LiveFlag>Voicemail: Active</LiveFlag>
        </div>
        <div className="mcm-fsec-d">
          Pick the welcome message, hold music, voicemail greeting and ring tone you want. Your
          voicemail greeting plays to callers before they leave a message, on calls straight to you.
        </div>
      </div>
      <CommonGreetingNotification
        {...{ mediaOptionsGreetingNotifications, optionsData }}
        customClass={customClass}
      />
    </section>
  );
};

export default PersonalGreetings;
