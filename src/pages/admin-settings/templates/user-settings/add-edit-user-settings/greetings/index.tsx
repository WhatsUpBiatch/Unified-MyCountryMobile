import SelectGreeting from '@/components/custom/greeting-select';
import { RuleCard, RuleToggle, type RuleTone } from '@/components/mcm/rule-card';
import { Switch } from '@/components/ui/switch';
import { GreetingItem, useGetGreetings } from '@/hooks/common';
import { useIsStarterPlan } from '@/hooks/use-is-starter-plan';
import { ISELECTVALUE } from '@/interfaces/api-interfaces';
import { readRuleFlags, writeRuleFlags, type RuleFlags } from '@/lib/company-rule-flags';
import { FC, ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';

import { HIDDEN_RECORDING_UUIDS } from '@/lib/utils';

/* One per slot, in the order the slots are listed. Fixed rather than derived
   so a recording keeps its colour even when a plan hides one of the rows. */
const GREETING_TONES: RuleTone[] = ['indigo', 'cyan', 'teal', 'violet'];

interface ICompanyInfo {
  plan_features?: string;
}

interface IGREETINGPROPS {
  company_info?: ICompanyInfo;
  intro?: ReactNode;
  footer?: ReactNode;
  /* The component already reads this; it was simply missing from the type, so
     every caller passing it failed to compile. */
  containerClass?: string;
}

/* See SettingPermission for why this renders inside the scrolling box rather
   than beside this component: outside it, it stays put while the settings
   scroll under it. Optional, and unused by the other screens here. */
const GreetingNotification: FC<IGREETINGPROPS> = ({ intro, footer, containerClass }: any) => {
  const { allGreetings } = useGetGreetings();
  const isStarterPlan = useIsStarterPlan();

  const {
    formState: { errors },
    watch,
    setValue,
  } = useFormContext();

  const watchMedia = watch('greetings');

  /* Each row lists only its OWN recordings, under their own names.
   *
   * Every row used to file its uploads as plain `greeting`, because
   * `SelectGreeting` was mounted with
   * `name={name == 'voicemail' ? 'voicemail' : 'greeting'}` and that name is
   * what reaches the uploader as `greeting_type`. One shared type for three
   * different rows had two consequences, and both were reported as bugs: a
   * recording added under Welcome also appeared under On-hold music and
   * Voicemail, and a filter looking for type `welcome_greeting` could never
   * match anything because nothing was ever saved with that type.
   *
   * The row now passes its own name (see the `name={name}` below), so an
   * upload is filed as `welcome_greeting`, `on_hold_music` or `ring_tone` and
   * belongs to exactly one row. `type` is a free-text STRING(50) on the
   * greeting table, so these are stored as-is, and the picker asks the API for
   * type `all` and narrows here — no API change needed.
   *
   * Recordings made before this are all typed `greeting` and there is no way
   * to tell which row they were meant for, so they are not shown in any of
   * them. The one exception is a recording a row currently HAS selected: that
   * stays listed, so nobody's saved choice disappears or stops playing. They
   * all remain in the recordings library, under All. */
  const forSlot = (slot: string): GreetingItem[] => {
    const mine = allGreetings.filter(
      (item: GreetingItem) =>
        item.type === slot && !HIDDEN_RECORDING_UUIDS.includes(item.uuid ?? ''),
    );

    /* Matching on `filename`, not `id`: that is what the options below use as
       their value, and what the playback URL is built from. */
    const saved = watchMedia?.[slot]?.value;
    const savedElsewhere =
      saved?.value && !mine.some((item: GreetingItem) => item.filename === saved.value)
        ? allGreetings.find((item: GreetingItem) => item.filename === saved.value)
        : undefined;

    return savedElsewhere ? [...mine, savedElsewhere] : mine;
  };

  const optionsData: Record<string, GreetingItem[]> = {
    welcome_greeting: forSlot('welcome_greeting'),
    on_hold: forSlot('on_hold'),
    on_hold_music: forSlot('on_hold_music'),
    ring_tone: forSlot('ring_tone'),
    /* Voicemail already had a type of its own, so its uploads were never
       shared with the other rows and its list is unchanged. */
    voicemail: forSlot('voicemail'),
  };

  /* What the closed box shows, kept in step with the open list.
   *
   * The two come from different places: the list is built above, the value is
   * whatever was saved into the form, label and all. A recording renamed in
   * the library would otherwise leave this box showing the name it had when it
   * was chosen. Matching is on `filename`, because that is what the options
   * below use as their value and what the playback URL is built from — not
   * `id`. Only the label is read back; the saved value is untouched, so which
   * file is chosen never changes. A value with no matching option (its
   * recording was deleted, say) keeps the label it was saved with rather than
   * going blank. */
  const displayValue = (slot: string) => {
    const saved = watchMedia?.[slot]?.value;
    if (!saved?.value) return saved;
    const option = optionsData[slot]?.find(
      (item: GreetingItem) => item.filename === saved.value,
    );
    return option ? { ...saved, label: option.name } : saved;
  };


  const mediaOptionsGreetingNotifications = [
    {
      name: 'welcome_greeting',
      placeholder: 'Welcome',
      label: 'welcome',
      title: 'Welcome message',
      blurb: 'Played as soon as the call is answered, before it rings anybody.',
    },
    {
      name: 'on_hold_music',
      placeholder: 'On Hold Music',
      label: 'on hold music',
      title: 'On-hold music',
      blurb: 'What the caller hears while they are holding.',
    },
    {
      name: 'voicemail',
      title: 'Voicemail message',
      blurb: 'What the caller hears before they leave a message.',
      placeholder: 'Voicemail',
      label: 'voicemail',
    },
    {
      name: 'ring_tone',
      placeholder: 'Ring Tone',
      label: 'ring tone',
      title: 'Ringback tone',
      blurb: 'What the caller hears instead of the usual ringing while they wait.',
    },
  ].filter(({ name }) => !isStarterPlan || !['hold', 'on_hold_music'].includes(name)) as {
    name: string;
    placeholder: string;
    label: string;
    title: string;
    blurb: string;
  }[];

  const onChangeMedia = (name: string, status: boolean) => {
    setValue(`greetings.${name}.enabled`, status, { shouldValidate: true });
    setValue(`greetings.${name}.value`, {} as ISELECTVALUE);
  };

  /* The rule on a recording: whether everyone gets it, and whether they may swap
     it. Stored as `apply` and `locked` on the greeting's own node, with the old
     `override` kept filled in for readers that only know that one — see
     src/lib/company-rule-flags.ts. The path is given with the trailing
     `.override` because that is where the old flag sits, and because the bare
     name `voicemail` is already a settings rule pointing at `voicemail_pin`;
     spelling the path out keeps this greeting's flags from being read from there. */
  const ruleFlags = (name: string) => readRuleFlags(watchMedia, `${name}.override`);

  const writeRule = (name: string, change: Partial<RuleFlags>) => {
    const flags = ruleFlags(name);
    const next = writeRuleFlags(watchMedia, `${name}.override`, {
      apply: flags.apply,
      locked: flags.locked,
      ...change,
    });
    setValue(`greetings.${name}`, next?.[name], { shouldDirty: true });
  };

  return (
    <div
      className={
        /* See SettingPermission: a caller whose page already scrolls passes its
           own layout so this does not scroll inside itself as well. */
        containerClass ??
        'user-settings-template-greetings flex h-[calc(100vh_-_15rem)] flex-col gap-4 overflow-auto pt-2'
      }
    >
      {intro}

      {/* One warning for the whole tab, not one per recording.
          It is true of all four slots equally, and repeating it on each card
          would drown the thing each card is actually for. No status badge on
          the cards themselves: that decision was made deliberately, and this
          strip is the part that tells an admin recordings do not reach a caller
          yet. It stays until they do. */}
      <p className="mcm-rule-note mcm-greet-note">
        Your choices are saved, but no caller hears them yet — call routing does not play
        recordings at all. Nothing is lost: whatever you set here starts playing when it does.
      </p>

      {mediaOptionsGreetingNotifications.map(({ name, label, title, blurb }, index) => {
        const isOn = !!watchMedia?.[name]?.enabled;
        const chosen = displayValue(name);

        return (
          <RuleCard
            key={name}
            /* Cycled so four cards of the same shape do not read as one slab.
               The order is fixed by the list above, so a slot keeps its colour
               rather than changing when a plan hides one of the rows. */
            tone={GREETING_TONES[index % GREETING_TONES.length]}
            title={title}
            description={blurb}
            valueLabel="Recording"
            /* Three real states, and they are not the same thing: switched off,
               on but nothing picked yet, and on with a recording. The middle one
               used to look identical to the last. */
            value={!isOn ? 'Off' : chosen?.label || 'None chosen'}
            valueHint={
              !isOn
                ? 'Callers hear nothing here until this is switched on.'
                : chosen?.label
                  ? undefined
                  : 'Pick a recording below, or upload one.'
            }
            /* The switch is what turns this message on, so it belongs with the
               state it changes rather than in the header. */
            action={
              <Switch
                checked={isOn}
                onCheckedChange={(checked: boolean) => onChangeMedia(name, checked)}
              />
            }
            nested={
              /* Only once it is on. There is nothing to choose before that, and
                 a greyed-out picker still reads as something you could use. */
              isOn ? (
                <>
                  <span className="mcm-rule-nested-label">Which recording</span>
                <SelectGreeting
                  /* The picker sat at its minimum width while the row it is in
                     had space to spare, so "Jenny (Female - American)" and
                     "Hold music - Bach Prelude" were both cut off mid-word and
                     two unlike recordings looked alike. It takes the width
                     going now, up to a point — a select stretched across a
                     whole settings page is harder to read than one sized to its
                     longest name. */
                  selectCustomClass="w-full"
                  selectCustomClassSecond="flex-1 min-w-0 max-w-[420px]"
                  /* The row's own name, which becomes the recording's type
                     when something is added from here. It used to collapse to
                     'greeting' for all three non-voicemail rows, which is why
                     a welcome message turned up in the On-hold music and
                     Voicemail dropdowns as well. */
                  name={name}
                  /* Every slot can have one made for it, ringback included. It
                     was the one row with no way to add anything, so on an
                     account with no recordings yet its dropdown was empty and
                     stayed empty however long you looked at it. */
                  isShowUpload
                  /* This screen is a full-width settings page, not a column in
                     a form, so the add button stays put after a choice is made
                     and a new recording drops straight into the slot. */
                  alwaysAllowAdd
                  onChangeMedia={(e) =>
                    setValue(`greetings.${name}.value`, e as ISELECTVALUE, {
                      shouldValidate: true,
                    })
                  }
                  /* `uuid` is carried alongside the label and value because
                     playback needs it: a recording the platform ships lives at
                     `default/recording/<file>` rather than
                     `<company>/greeting/<file>`, and `SelectGreeting` tells the
                     two apart by looking the uuid up in
                     DEFAULT_RECORDING_UUIDS. Without it every default resolved
                     to the company path and would not play. */
                  options={optionsData[name]?.map((item: GreetingItem) => ({
                    label: item.name,
                    value: item.filename,
                    uuid: item.uuid,
                    is_default: item.is_default,
                  }))}
                  value={chosen}
                  errors={(errors.greetings as any)?.[name]?.value?.value?.message}
                />
                </>
              ) : null
            }
          >
            {/* "Lock it" was removed on 3 Sep 2026 at the customer's request.
                Only its row is gone: `locked` is still read and written by
                writeRule below, and whatever each company already saved is
                carried through untouched, so nothing that depends on the flag
                changes meaning and putting the row back is a few lines. */}
            {isOn ? (
              <RuleToggle
                label="Give this to everyone"
                description={`This ${label} recording is copied onto everyone. Off, people keep what they have.`}
                control={
                  <Switch
                    checked={ruleFlags(name).apply}
                    onCheckedChange={(checked: boolean) => writeRule(name, { apply: checked })}
                  />
                }
              />
            ) : null}
          </RuleCard>
        );
      })}

      {footer}
    </div>
  );
};

export default GreetingNotification;
