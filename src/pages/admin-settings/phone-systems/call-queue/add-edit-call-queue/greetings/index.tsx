import { GreetingItem, useGetGreetings } from '@/hooks/common';
import CommonGreetingNotification from '@/components/common-greetings';
import { useFormContext } from 'react-hook-form';
import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import { Input } from '@/components/ui/input';
import { DELAY_GREETING_DEFAULT_INTERVAL, WAITING_LIMITS } from '../../constant';

const GreetingNotification = () => {
  const { greetingList } = useGetGreetings();

  const { watch, setValue } = useFormContext();

  const optionsData: Record<string, GreetingItem[]> = {
    welcome: greetingList,
    waiting: greetingList,
    hold: greetingList,
    ring_tone: greetingList,
    no_agent_available: greetingList,
    all_agent_busy: greetingList,
    delay: greetingList,
  };

  const mediaOptionsGreetingNotifications: {
    name: string;
    placeholder: string;
    label: string;
  }[] = [
    {
      name: 'welcome',
      placeholder: 'Business hour',
      label: 'Business hour',
    },
    {
      name: 'hold',
      placeholder: 'On Hold Music',
      label: 'On hold music',
    },
    {
      name: 'ring_tone',
      placeholder: 'Ring Tone',
      label: 'Ring tone',
    },
    {
      name: 'waiting',
      placeholder: 'Waiting',
      label: 'Waiting | No agent available | All agent busy',
    },
    /* Repeats on an interval while the caller waits, unlike the business-hour
       greeting which plays once. It is also where a callback would be offered. */
    {
      name: 'delay',
      placeholder: 'Repeats while waiting',
      label: 'Repeating message',
    },
    // {
    //   name: 'no_agent_available',
    //   placeholder: 'No Agent Available',
    //   label: 'No agent available',
    // },
    // {
    //   name: 'all_agent_busy',
    //   placeholder: 'All Agent Busy',
    //   label: 'All agent busy',
    // },
  ];

  if (watch('settings.operational_hours.type') === 'weekly') {
    mediaOptionsGreetingNotifications.push({
      name: 'waiting',
      placeholder: 'After hour',
      label: 'After hour',
    });
  }

  const delayEnabled = watch('greetings.delay.enabled');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <CommonGreetingNotification
        {...{ mediaOptionsGreetingNotifications, optionsData }}
        customClass="min-h-0 pr-1"
      />

      {/* How often the repeating message plays. Only useful once that message is
          switched on, so it appears with it rather than sitting there greyed. */}
      {delayEnabled && (
        <SettingCard
          title="The repeating message"
          description="How often the caller hears it while they wait."
        >
          <SettingRow
            label="Play it every (seconds)"
            description={`Anything under ${WAITING_LIMITS.delay_interval_seconds.min} seconds starts to feel like badgering, so that is the floor.`}
            status="active"
            control={
              <Input
                type="number"
                min={WAITING_LIMITS.delay_interval_seconds.min}
                max={WAITING_LIMITS.delay_interval_seconds.max}
                value={watch('greetings.delay.interval_seconds') ?? DELAY_GREETING_DEFAULT_INTERVAL}
                onChange={(event) =>
                  setValue('greetings.delay.interval_seconds', Number(event.target.value), {
                    shouldValidate: true,
                  })
                }
              />
            }
          />
        </SettingCard>
      )}
    </div>
  );
};

export default GreetingNotification;
