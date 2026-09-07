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
import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import { RuleCard, RuleToggle } from '@/components/mcm/rule-card';
import { Globe } from 'lucide-react';
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

  /* Two switches per company rule, one for each thing a rule can say about a
     person: whether they GET the company value, and whether they may CHANGE it.

     There used to be one switch here, "Let people change this themselves", writing
     the single `override` flag — which was also, elsewhere, the instruction to copy
     the company value onto people. One switch could not say "everyone gets this
     and nobody may change it", the thing an admin most often means. The two
     halves are stored as `apply` and `locked` beside the old flag, through
     `writeRuleFlags`, which also keeps `override` filled in for the readers that
     still only understand that one. `node` is the rule's node in the settings
     object ('recording', 'operational_hours.regional'); the flags sit on it. */
  const RuleRows = ({ node, what }: { node: string; what: string }) => {
    const settings = watch('settings');
    const flags = readRuleFlags(settings, node);

    const write = (change: Partial<RuleFlags>) => {
      const next = writeRuleFlags(settings, node, {
        apply: flags.apply,
        locked: flags.locked,
        ...change,
      });
      const nodePath = ruleNodePath(node);
      /* Only the one node is set, not the whole settings object: the other cards'
         values are left exactly as the form holds them. */
      setValue(`settings.${nodePath}`, readPath(next, nodePath), { shouldDirty: true });
    };

    return (
      <>
        <SettingRow
          label="Give this to everyone"
          description={`On, the company ${what} is copied onto everyone. Off, people keep what they have.`}
          control={
            <Switch
              checked={flags.apply}
              onCheckedChange={(checked: boolean) => write({ apply: checked })}
            />
          }
        />
        <SettingRow
          label="Lock it"
          description={`On, nobody can change the ${what} on their own phone. Off, a person may change it.`}
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

  /* The same two flags as RuleRows, laid out for the rebuilt card: side by side
     and close to their switches instead of two full-width rows with the control
     stranded at the far edge of the panel. The writing logic is shared, so the
     two layouts can never disagree about what a switch does. */
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
          icon={<Globe className="h-[17px] w-[17px]" />}
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

        <SettingCard
          title="When you are open"
          status="active"
          note="Live on the switch. Outside these hours a call goes to the closed-hours destination set on the number it dialled; a number that rings a person and has no destination goes to that person's voicemail. A number, a menu or a queue can also keep its own hours, and closes on its own even while the company is open. Checked against the running switch on 3 Sep 2026."
          description="Calls outside these hours are handled differently - that is what the closed-hours action on your numbers and queues points at."
          aside={
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
        >
          <SettingRow
            label="Opening hours"
            description={
              bussinessHourError
                ? bussinessHourError
                : operational_hours?.type == '24_hours'
                  ? 'Open 24 hours, every day. Nothing is ever treated as out of hours.'
                  : getWeeklyScheduleName(operational_hours?.value) || 'Set per weekday.'
            }
          />
          <RuleRows node="operational_hours" what="opening hours" />
        </SettingCard>

        <SettingCard
          title="Call recording"
          status="active"
          note="Live on the switch. Calls to a person, a menu, a queue or a forwarded outside number are recorded in whichever direction you choose, the caller hears the recording notice before the call connects (and the person called hears it on an outbound call), and each recording appears against its call in your call logs. Checked against the running switch on 3 Sep 2026."
          description="Whether calls are recorded automatically, or only when somebody chooses to start recording."
          aside={
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
        >
          <SettingRow
            label="What gets recorded"
            description={describeRecording({
              automaticEnabled: recording?.automatic?.enabled,
              onDemandEnabled: recording?.on_demand?.enabled,
              direction: recording?.automatic?.value,
            })}
          />
          <RuleRows node="recording" what="recording setting" />
        </SettingCard>

        {features?.plan_features?.advance_call_management?.access?.TRANSCRIPTION && (
          <>
            <SettingCard
              title="Transcription"
              status="coming-soon"
              note="Saved, and nothing writes calls out as text yet."
              description="Writing calls out as text so they can be read and searched rather than listened to."
            >
              <SettingRow
                label="Write calls out as text"
                description="Applies to recorded calls. Turning this off also turns off call monitoring below, which depends on it."
                control={
                  <Switch
                    checked={watch('settings.transcription.enabled')}
                    onCheckedChange={(checked) => {
                      setValue('settings.transcription.enabled', checked);
                      if (!checked) {
                        setValue('settings.ai_call_monitoring.enabled', false);
                      }
                    }}
                  />
                }
              />
              <RuleRows node="transcription" what="transcription setting" />
            </SettingCard>

            <SettingCard
              title="Call monitoring"
              status="coming-soon"
              note="Saved, and no transcript is being looked through yet."
              description="Reading the transcripts to flag calls worth a supervisor's attention."
            >
              <SettingRow
                label="Look through transcripts automatically"
                description="Needs transcription switched on above, since there is nothing to read without it."
                control={
                  <Switch
                    checked={watch('settings.ai_call_monitoring.enabled')}
                    disabled={!watch('settings.transcription.enabled')}
                    onCheckedChange={(checked) =>
                      setValue('settings.ai_call_monitoring.enabled', checked)
                    }
                  />
                }
              />
              <RuleRows node="ai_call_monitoring" what="call monitoring setting" />
            </SettingCard>
          </>
        )}

        <SettingCard
          title="The number people see"
          status="coming-soon"
          note="Saved, and not used on calls yet. The switch takes the outgoing number from each person's own record under People, and never reads this rule. Checked against the running call switch on 3 Sep 2026."
          description="What shows on the other person's phone when somebody here calls out."
          aside={
            <Button type="button" variant="primary" size="sm" className="cs-save" onClick={() => openModal('displayNumberModal')}>
              Change
            </Button>
          }
        >
          <SettingRow
            label="Outgoing caller ID"
            description={
              display_number?.masking?.type?.value === 'N'
                ? 'Not set. Calls go out showing whatever the line itself is set to.'
                : `${display_number?.masking?.type?.label} - ${display_number?.masking?.value}`
            }
            control={
              (errors?.settings as any)?.display_number?.masking?.value?.message ? (
                <ErrorTooltip
                  text={(errors?.settings as any)?.display_number?.masking?.value?.message}
                />
              ) : null
            }
          />
          <RuleRows node="display_number" what="caller ID" />
        </SettingCard>

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
