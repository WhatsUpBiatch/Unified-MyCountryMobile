import { FC, useEffect, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { useCompanyFeatures } from '@/hooks/rbac';
import { Switch } from '@/components/ui/switch';
import VoiceMailConfigureModal from './voicemail-dialog';
import AutomaticCallRecordingModal from './automatic-call-recording';
import DisplayNumberModal from './display-number-dialog';
import ErrorTooltip from '@/components/custom/error-tooltip';
import BussinessHoursModal from '@/components/custom/bussiness-hours-dialog';
import { Weekday, WEEKLY_ORDER, WEEKLY_SCHEDULE_MAP } from '@/pages/admin-settings/constants';
import { RuleCard, RuleToggle } from '@/components/mcm/rule-card';
import { Input } from '@/components/ui/input';
import RegionalModal from '@/components/common-settings/regional-dialog';
import { describeRecording } from '@/lib/recording-description';
import {
  readPath,
  readRuleFlags,
  ruleNodePath,
  writeRuleFlags,
  type RuleFlags,
} from '@/lib/company-rule-flags';

interface DaySchedule {
  open: boolean;
}

type WeeklySchedule = Partial<Record<Weekday, DaySchedule>>;

const getWeeklyScheduleName = (obj: WeeklySchedule = {}): string =>
  WEEKLY_ORDER.filter((day) => obj[day]?.open)
    .map((day) => WEEKLY_SCHEDULE_MAP[day])
    .join(', ');

/* `footer` renders inside this screen's own scrolling box, which is
   the only place content can sit and still scroll with the settings. Anything
   passed as a sibling of this component lands outside that box and stays put
   while the settings move under it. Optional, and unused by the other screens
   that render this. */
const SettingPermission: FC<any> = ({ data, intro, footer, containerClass }) => {
  const { features } = useCompanyFeatures();
  const [bussinessHourError, setBussinessHourEror] = useState<string | null>('');
  const [initialRegionalSettings, setInitialRegionalSettings] = useState<any>(null);

  const [modalState, setModalState] = useState({
    regionalModal: false,
    voicemailModal: false,
    bussinessHoursModal: false,
    automaticRecordingModal: false,
    displayNumberModal: false,
  });

  const {
    watch,
    register,
    setValue,
    formState: { errors },
  } = useFormContext();
  const {
    operational_hours = {},
    recording = {},
    display_number = {},
    // voicemail_pin = {},
  } = watch('settings');

  const openModal = (key: keyof typeof modalState) => {
    setModalState((prev) => ({ ...prev, [key]: true }));
  };

  const closeModal = (key: keyof typeof modalState) => {
    setModalState((prev) => ({ ...prev, [key]: false }));
  };

  useEffect(() => {
    if (modalState?.regionalModal) {
      const currentValues = JSON.parse(
        JSON.stringify(watch('settings.operational_hours.regional')),
      );
      setInitialRegionalSettings(currentValues);
    }
  }, [modalState?.regionalModal]);

  /* The two flags every company rule carries, one for each thing a rule can say
     about a person: whether they GET the company value (`apply`) and whether
     they may CHANGE it (`locked`). One switch could not express "everyone gets
     this and nobody may change it", which is what an admin most often means.
     `writeRuleFlags` keeps the older single `override` flag filled in for the
     readers that still understand only that one.

     Laid out side by side and next to their switches: at full panel width the
     old rows put a control a foot away from the words explaining it. */
  const RuleToggles = ({ node, what }: { node: string; what: string }) => {
    const settings = watch('settings');
    const flags = readRuleFlags(settings, node);

    const write = (change: Partial<RuleFlags>) => {
      const next = writeRuleFlags(settings, node, {
        apply: flags.apply,
        locked: flags.locked,
        ...change,
      });
      const nodePath = ruleNodePath(node);
      setValue(`settings.${nodePath}`, readPath(next, nodePath), { shouldDirty: true });
    };

    return (
      <>
        <RuleToggle
          label="Give this to everyone"
          description={`The company ${what} is copied onto everyone. Off, people keep what they have.`}
          control={
            <Switch
              checked={flags.apply}
              onCheckedChange={(checked: boolean) => write({ apply: checked })}
            />
          }
        />
        <RuleToggle
          label="Lock it"
          description={`Nobody can change the ${what} on their own phone.`}
          control={
            <Switch
              checked={flags.locked}
              onCheckedChange={(checked: boolean) => write({ locked: checked })}
            />
          }
        />
      </>
    );
  };

  /* Read once: call monitoring is disabled by it, describes itself by it, and
     is switched off with it. */
  const isTranscriptionOn = Boolean(watch('settings.transcription.enabled'));

  const isRegionalSet = Boolean(
    operational_hours?.regional?.country?.value && operational_hours?.regional?.timezone?.value,
  );

  return (
    <>
      <div
        className={
          /* The default is a box of its own fixed height that scrolls inside
             itself. A caller whose page already scrolls passes its own layout
             instead, so the settings scroll with that page rather than in a
             second scrollbar within it. The identifying class stays either way,
             because this screen's other styles are keyed to it. */
          containerClass ??
          'user-settings-template-settings flex h-[calc(100vh_-_15rem)] flex-col gap-4 overflow-auto'
        }
      >
        {intro}
        <div className="user-settings-template-settings-name-wrap mt-2 w-full max-w-sm">
          <Input
            label="Name"
            {...register('name')}
            error={errors?.name?.message}
            placeholder="Enter template name"
          />
        </div>

        <RuleCard
          tone="indigo"
          title="Where this company works"
          status="active"
          description="The country and clock everything else is measured against - opening hours, holidays, and the times shown in reports."
          valueLabel="Country and time zone"
          /* Set or unset are two different sentences, not one string with a
             fallback: "Not set yet" is a state worth reading at full size,
             and the consequence of leaving it belongs underneath it. */
          value={
            isRegionalSet
              ? `${operational_hours?.regional?.timezone?.value}, ${operational_hours?.regional?.country?.value}`
              : 'Not set yet'
          }
          valueHint={
            isRegionalSet
              ? 'Opening hours, holidays and report times are all read against this clock.'
              : 'Nothing that depends on the clock will behave predictably until it is.'
          }
          valueAside={
            (errors.settings as any)?.operational_hours?.regional ? (
              <ErrorTooltip text="Regional settings is required" />
            ) : null
          }
          action={
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="cs-save"
              onClick={() => openModal('regionalModal')}
            >
              Change
            </Button>
          }
          note="The time zone here is what opening hours are judged against on every incoming call."
        >
          <RuleToggles node="operational_hours.regional" what="country and time zone" />
        </RuleCard>

        <RuleCard
          tone="cyan"
          title="When you are open"
          status="active"
          description="Calls outside these hours are handled differently - that is what the closed-hours action on your numbers and queues points at."
          valueLabel="Opening hours"
          /* The error takes the value line rather than sitting underneath it:
             when the hours are wrong, that IS the current state. */
          value={
            bussinessHourError
              ? 'Check these hours'
              : operational_hours?.type == '24_hours'
                ? 'Open 24 hours, every day'
                : getWeeklyScheduleName(operational_hours?.value) || 'Set per weekday'
          }
          valueHint={
            bussinessHourError
              ? bussinessHourError
              : operational_hours?.type == '24_hours'
                ? 'Nothing is ever treated as out of hours.'
                : 'Outside these hours, callers take the closed-hours route.'
          }
          action={
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="cs-save"
              onClick={() => openModal('bussinessHoursModal')}
            >
              Change
            </Button>
          }
          note="Live on the switch. Outside these hours a call goes to the closed-hours destination set on the number it dialled; a number that rings a person and has no destination goes to that person's voicemail. A number, a menu or a queue can also keep its own hours, and closes on its own even while the company is open. Checked against the running switch on 3 Sep 2026."
        >
          <RuleToggles node="operational_hours" what="opening hours" />
        </RuleCard>

        <RuleCard
          tone="teal"
          title="Call recording"
          status="active"
          description="Whether calls are recorded automatically, or only when somebody chooses to start recording."
          valueLabel="What gets recorded"
          /* describeRecording writes a sentence, which is right where it is read
             as one. Here it is a headline beside five others that carry none, so
             the full stop is dropped rather than the shared helper reworded. */
          value={describeRecording({
            automaticEnabled: recording?.automatic?.enabled,
            onDemandEnabled: recording?.on_demand?.enabled,
            direction: recording?.automatic?.value,
          })?.replace(/\.$/, '')}
          action={
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="cs-save"
              onClick={() => openModal('automaticRecordingModal')}
            >
              Change
            </Button>
          }
          note="Live on the switch. Calls to a person, a menu, a queue or a forwarded outside number are recorded in whichever direction you choose, the caller hears the recording notice before the call connects (and the person called hears it on an outbound call), and each recording appears against its call in your call logs. Checked against the running switch on 3 Sep 2026."
        >
          <RuleToggles node="recording" what="recording setting" />
        </RuleCard>

        {features?.plan_features?.advance_call_management?.access?.TRANSCRIPTION && (
          <>
            <RuleCard
              tone="violet"
              title="Transcription"
              status="coming-soon"
              description="Writing calls out as text so they can be read and searched rather than listened to."
              valueLabel="Write calls out as text"
              /* On these two the switch is the action, so the value line says
                 which way it is set rather than repeating the label. */
              value={isTranscriptionOn ? 'On' : 'Off'}
              valueHint="Applies to recorded calls. Turning this off also turns off call monitoring below, which depends on it."
              action={
                <Switch
                  checked={isTranscriptionOn}
                  onCheckedChange={(checked) => {
                    setValue('settings.transcription.enabled', checked);
                    if (!checked) {
                      setValue('settings.ai_call_monitoring.enabled', false);
                    }
                  }}
                />
              }
              note="Saved, and nothing writes calls out as text yet."
            >
              <RuleToggles node="transcription" what="transcription setting" />
            </RuleCard>

            <RuleCard
              tone="sky"
              title="Call monitoring"
              status="coming-soon"
              description="Reading the transcripts to flag calls worth a supervisor's attention."
              valueLabel="Look through transcripts automatically"
              /* Unavailable is its own state, and saying so is kinder than a
                 greyed switch next to the word "Off" with no reason given. */
              value={
                !isTranscriptionOn
                  ? 'Unavailable'
                  : watch('settings.ai_call_monitoring.enabled')
                    ? 'On'
                    : 'Off'
              }
              valueHint={
                !isTranscriptionOn
                  ? 'Switch transcription on above first - there is nothing to read without it.'
                  : 'Transcripts are read as they arrive and calls worth attention are flagged.'
              }
              action={
                <Switch
                  checked={watch('settings.ai_call_monitoring.enabled')}
                  disabled={!isTranscriptionOn}
                  onCheckedChange={(checked) =>
                    setValue('settings.ai_call_monitoring.enabled', checked)
                  }
                />
              }
              note="Saved, and no transcript is being looked through yet."
            >
              <RuleToggles node="ai_call_monitoring" what="call monitoring setting" />
            </RuleCard>
          </>
        )}

        <RuleCard
          tone="rose"
          title="The number people see"
          status="coming-soon"
          description="What shows on the other person's phone when somebody here calls out."
          valueLabel="Outgoing caller ID"
          value={
            display_number?.masking?.type?.value === 'N'
              ? 'Not set'
              : `${display_number?.masking?.type?.label} - ${display_number?.masking?.value}`
          }
          valueHint={
            display_number?.masking?.type?.value === 'N'
              ? 'Calls go out showing whatever the line itself is set to.'
              : undefined
          }
          valueAside={
            (errors?.settings as any)?.display_number?.masking?.value?.message ? (
              <ErrorTooltip
                text={(errors?.settings as any)?.display_number?.masking?.value?.message}
              />
            ) : null
          }
          action={
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="cs-save"
              onClick={() => openModal('displayNumberModal')}
            >
              Change
            </Button>
          }
          note="Saved, and not used on calls yet. The switch takes the outgoing number from each person's own record under People, and never reads this rule. Checked against the running call switch on 3 Sep 2026."
        >
          <RuleToggles node="display_number" what="caller ID" />
        </RuleCard>

        {footer}
      </div>

      {modalState?.regionalModal && (
        <RegionalModal
          modalState={modalState?.regionalModal}
          setModalState={() => closeModal('regionalModal')}
          initialRegionalSettings={initialRegionalSettings}
          data={data}
        />
      )}
      {modalState?.voicemailModal && (
        <VoiceMailConfigureModal
          modalState={modalState?.voicemailModal}
          setModalState={() => closeModal('voicemailModal')}
        />
      )}
      {modalState?.bussinessHoursModal && (
        <BussinessHoursModal
          modalState={modalState?.bussinessHoursModal}
          setModalState={() => closeModal('bussinessHoursModal')}
          setError={(value) => setBussinessHourEror(value)}
        />
      )}
      {modalState?.automaticRecordingModal && (
        <AutomaticCallRecordingModal
          modalState={modalState?.automaticRecordingModal}
          setModalState={() => closeModal('automaticRecordingModal')}
        />
      )}
      {modalState?.displayNumberModal && (
        <DisplayNumberModal
          modalState={modalState?.displayNumberModal}
          setModalState={() => closeModal('displayNumberModal')}
        />
      )}
    </>
  );
};

export default SettingPermission;
