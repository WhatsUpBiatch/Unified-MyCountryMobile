import { useEffect, useMemo, useState } from 'react';
import { SettingCard, SettingRow, type SettingStatus } from '@/components/mcm/setting-card';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, PhoneCall, Timer, Users } from 'lucide-react';

import CustomSelect from '@/components/custom/custom-select';
import Loader from '@/components/custom/loader';
import { Button } from '@/components/ui/button';
import { SectionActions } from './section-actions';
import { Switch } from '@/components/ui/switch';
import { handleAlert } from '@/lib/utils';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  saveCompanyDefaults,
} from '@/lib/company-defaults';

/**
 * Company ring time
 * -----------------------------------------------------------------------------
 * How long a phone rings before the call gives up is one of the two numbers a
 * customer changes first, and until now there was nowhere to say it once for the
 * whole company. It could only be set in three unrelated places:
 *
 *   - per queue member, in Call Queue > Ring strategy ("Ring For")
 *   - per department, as "Member Ring Timeout (Sec)"
 *   - per device on one person's phone, in their Call rules > device options
 *
 * A new person gets whatever the code happens to default to. This page is the
 * missing top level: one number, written down once, in the same reserved
 * "Company Default" record the rest of Company info uses. It is namespaced under
 * `settings.company_ring_time` and the rest of that blob is spread through
 * untouched on save.
 *
 * ---------------------------------------------------------------------------
 * WHAT READS THIS, AS OF 29 AUGUST 2026
 * ---------------------------------------------------------------------------
 * This header used to say "nothing reads this value", and warned against
 * leaving a stale reassurance behind. That warning now applies to the header
 * itself: the key IS read, and `RING_TIME_STATUS` is 'active'.
 *
 * The reader is `seedDeviceRingTime` in src/lib/company-ring-time.ts, which
 * returns a stored per-device value if one exists and otherwise falls back to
 * this company number instead of a hardcoded constant. Three call sites use it:
 *
 *   - people/update-forwarding/index.tsx      (Call rules > device options)
 *   - phone-systems/call-queue/add-edit-call-queue/index.tsx
 *   - phone-systems/call-queue/.../ring-strategy/index.tsx
 *
 * So a device or queue member saved through the interface without its own ring
 * time now inherits what is set here. What this page still does NOT do is
 * change anything already saved with an explicit value — those were somebody's
 * decision and are kept, unclamped, by design (see seedDeviceRingTime).
 *
 * If that ever stops being true, change this note in the same commit. An admin
 * who believes they have shortened the ring and has not will read every missed
 * call as a fault somewhere else.
 */

const RING_TIME_KEY = 'company_ring_time';
const RING_TIME_SCHEMA_VERSION = 1;

/* Change this only if something outside this file stops reading the key. */
const RING_TIME_STATUS: SettingStatus = 'active';

/* the safe default ships 30 seconds. other established systems ships 12 and refuses anything above 60, so
   60 is the ceiling here too: offering 90 would let an admin save a number that
   the stricter of the two vendors would reject outright. */
const COMMON_DEFAULT_SECONDS = 30;
const CONTACT_CENTRE_SECONDS = 12;
const MIN_SECONDS = 5;
const MAX_SECONDS = 60;

/**
 * `RINGING_OPTIONS` from '@/constants/forwarding-consts' — the list the queue
 * ring-time control uses — is deliberately NOT reused. It holds exactly two
 * entries, 15 and 30 seconds, which cannot express the 5-60 range this page is
 * meant to cover: an admin who wants the usual 12 seconds, or the full 60, has
 * no option to pick. Its labels are borrowed instead, because they are the good
 * part: it counts rings as well as seconds, at five seconds a ring, and "about
 * 6 rings" is how a person actually experiences the wait.
 */
const SECONDS_PER_RING = 5;

const ringCount = (seconds: number) => Math.round(seconds / SECONDS_PER_RING);

const buildOption = (seconds: number, note?: string) => ({
  label: `${seconds} seconds — about ${ringCount(seconds)} rings${note ? ` (${note})` : ''}`,
  value: String(seconds),
});

const RING_TIME_OPTIONS = [
  buildOption(5),
  buildOption(10),
  buildOption(CONTACT_CENTRE_SECONDS, 'contact centre pace'),
  buildOption(15),
  buildOption(20),
  buildOption(25),
  buildOption(COMMON_DEFAULT_SECONDS, 'recommended'),
  buildOption(40),
  buildOption(45),
  buildOption(MAX_SECONDS, 'other established systems maximum'),
];

/* Where the "what happens next" half of this question is answered.
   `/admin-settings/numbers/in-use` used to be the target and was wrong: it
   lists what each number is set to, never whether a caller would be dropped,
   and the no-answer action is not on it at all — that lives inside the per-number
   Set Forwarding dialog, which has no URL of its own. Call coverage is the one
   screen that asks the question this panel asks, so it is the honest target:
   it names the numbers that would drop a call and offers to fix them. Route
   confirmed in src/router/index.tsx (`numbers` > `coverage`). */
const CALL_COVERAGE_PATH = '/admin-settings/numbers/coverage';

interface RingTimeForm {
  seconds: string;
  apply_to_new_people: boolean;
}

const DEFAULT_FORM: RingTimeForm = {
  /* the usual 30, not the usual 12. Thirty seconds is what most people expect a
     desk phone to do, and it is the value the rest of this product already falls
     back to, so writing anything else down here would quietly disagree with the
     behaviour on every existing line. */
  seconds: String(COMMON_DEFAULT_SECONDS),
  apply_to_new_people: true,
};

const toSettingsObject = (rawSettings: any): Record<string, any> => {
  if (!rawSettings) return {};
  if (typeof rawSettings === 'string') {
    try {
      const parsed = JSON.parse(rawSettings);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawSettings === 'object' ? rawSettings : {};
};

const toGreetingsObject = (rawGreetings: any): Record<string, any> =>
  toSettingsObject(rawGreetings);

/* A stored value outside 5-60, or one this list does not offer, is kept rather
   than silently rounded — showing it as-is is the only way an admin can see that
   it is there and choose to replace it. */
const toSecondsString = (stored: any): string => {
  const parsed = Number(stored);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FORM.seconds;
  return String(Math.round(parsed));
};

const buildFormFromSettings = (settings: Record<string, any>): RingTimeForm => {
  const ringTime = settings?.[RING_TIME_KEY] || {};

  return {
    seconds: toSecondsString(ringTime?.seconds),
    apply_to_new_people:
      typeof ringTime?.apply_to_new_people === 'boolean'
        ? ringTime.apply_to_new_people
        : DEFAULT_FORM.apply_to_new_people,
  };
};

const buildRingTimePayload = (form: RingTimeForm) => ({
  version: RING_TIME_SCHEMA_VERSION,
  updated_at: new Date().toISOString(),
  seconds: Number(form.seconds),
  apply_to_new_people: form.apply_to_new_people,
});

/**
 * The same honesty badge the other company cards carry. A card is only ever
 * marked 'active' once something outside this file genuinely acts on the value.
 */
const selectedOption = (options: { label: string; value: string }[], value: string) =>
  options.find((option) => option.value === value) || null;

const CompanyRingTime = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RingTimeForm>(DEFAULT_FORM);

  const {
    data: companyDefaultTemplate = null,
    isLoading,
    isError,
  } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
  });

  const savedSettings = useMemo(
    () => toSettingsObject(companyDefaultTemplate?.settings),
    [companyDefaultTemplate],
  );

  const savedForm = useMemo(() => buildFormFromSettings(savedSettings), [savedSettings]);

  useEffect(() => {
    setForm(savedForm);
  }, [savedForm]);


  const currentSeconds = Number(form.seconds);

  /* A value that came from somewhere else — an older record, or a number typed
     straight into the API — is shown rather than hidden, so the list always has
     an entry matching what is stored. */
  const options = useMemo(() => {
    const isKnown = RING_TIME_OPTIONS.some((option) => option.value === form.seconds);
    if (isKnown) return RING_TIME_OPTIONS;
    return [...RING_TIME_OPTIONS, buildOption(currentSeconds, 'saved earlier')].sort(
      (a, b) => Number(a.value) - Number(b.value),
    );
  }, [form.seconds, currentSeconds]);

  const { mutate: saveRingTime, isPending: isSaving } = useMutation({
    mutationFn: saveCompanyDefaults,
    onSuccess: (response: any) => {
      handleAlert({
        text: response?.data?.message || 'Company ring time saved',
        type: 'success',
      });
      /* The whole company record is invalidated, not just this card. Policies,
         holidays, security and phone rules all read the same row, so a save here
         must make them re-read — otherwise the next card saves a merge built on
         a stale blob and silently drops what was just written. */
      queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['userTemplateList'] });
    },
  });

  const updateForm = (patch: Partial<RingTimeForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSave = () => {
    // Merge, never replace: the Company Default row also carries the rest of the
    // company defaults blob, and other screens write into it.
    const nextSettings = {
      ...savedSettings,
      [RING_TIME_KEY]: buildRingTimePayload(form),
    };

    saveRingTime({
      uuid: companyDefaultTemplate?.uuid,
      settings: nextSettings,
      greetings: toGreetingsObject(companyDefaultTemplate?.greetings),
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center py-10">
        <Loader />
      </div>
    );
  }

  return (
    <section className="cs-section flex w-full flex-col gap-4">
      <div className="cs-block">
        <p className="text-lg font-semibold text-gray-900">Ring time</p>
        <p className="text-xs text-gray-500">
          How long a phone rings before the call stops ringing and moves on. One number for the
          whole company, so a new person is not set up by hand.
        </p>
      </div>

      <div className="w-full">
        <div className="flex w-full flex-col gap-4">
          {isError && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center">
              <p className="text-sm font-semibold text-gray-900">
                We could not load the saved ring time
              </p>
              <p className="text-xs text-gray-500">
                What you see below is the built-in default, not your saved value. Reload before you
                save, or you may overwrite a setting you cannot currently see.
              </p>
            </div>
          )}

          {!companyDefaultTemplate && !isError && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-4">
              <p className="text-sm font-semibold text-gray-900">No ring time saved yet</p>
              <p className="text-xs text-gray-500">
                Nothing has been set for your company yet. Choose what you want below and save.
              </p>
            </div>
          )}

          <SettingCard
            icon={<Timer className="h-5 w-5" />}
            title="Default ring time"
            description="How many seconds a phone rings before the call gives up and moves on."
            status={RING_TIME_STATUS}
            note="Active. Used as the starting point: somebody with no ring time of their own gets this one. People already set up keep the time they have."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <CustomSelect
                  label="Ring for"
                  options={options}
                  value={selectedOption(options, form.seconds)}
                  handleChange={(option: any) =>
                    updateForm({ seconds: option?.value || DEFAULT_FORM.seconds })
                  }
                />
                <p className="text-xs text-gray-500">
                  Between {MIN_SECONDS} and {MAX_SECONDS} seconds. Rings are counted at about five
                  seconds each, which is what a caller hears.
                </p>
              </div>
            </div>

            {/* An unlabelled number is worse than a wrong one: an admin cannot
                judge 30 without knowing what anyone else does. Both vendors'
                figures are on screen, including why the list stops at 60. */}
            <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3">
              <p className="text-sm font-semibold text-gray-900">Where these numbers come from</p>
              <ul className="flex flex-col gap-1 text-xs text-gray-600">
                <li>
                  <span className="font-semibold text-gray-900">
                    Most desk phones ring for {COMMON_DEFAULT_SECONDS} seconds
                  </span>{' '}
                  — about {ringCount(COMMON_DEFAULT_SECONDS)} rings. That is the default here too,
                  because it is also what this product already falls back to everywhere else.
                </li>
                <li>
                  <span className="font-semibold text-gray-900">
                    Contact centres use about {CONTACT_CENTRE_SECONDS} seconds
                  </span>{' '}
                  and rarely go above {MAX_SECONDS}. A short ring moves an unanswered call to the
                  next agent quickly.
                </li>
                <li>
                  This list stops at {MAX_SECONDS} seconds for that reason. Longer is not offered:
                  most callers hang up well before a minute, and systems that cap this refuse
                  anything longer anyway.
                </li>
              </ul>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Users className="h-5 w-5" />}
            title="Who it applies to"
            description="Whether people added after today start with this ring time."
            status={RING_TIME_STATUS}
            note="Active. Used when somebody is set up who has no ring time of their own."
          >
            <SettingRow
              label="Use this for people added from now on"
              description="People already set up keep whatever ring time they have. Turning this off means the number above is recorded as the company's intention but is not offered as a starting point to anyone."
              control={
                <Switch
                  checked={form.apply_to_new_people}
                  onCheckedChange={(checked) => updateForm({ apply_to_new_people: checked })}
                />
              }
            />
          </SettingCard>

          {/* The honest other half of the question. Ring time only decides when
              ringing stops; what happens next is a different setting, in a
              different place, and an admin who changes one and not the other
              gets silence at the end of the call. */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start gap-3 border-b border-gray-200 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ucass-primary-200 text-primary">
                <PhoneCall className="h-5 w-5" />
              </div>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <p className="text-base font-semibold text-gray-900">
                  Ring time is only half the answer
                </p>
                <p className="text-xs text-gray-500">
                  It says when the ringing stops. It does not say what the caller gets next.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <p className="text-sm text-gray-700">
                When the ring time runs out, the call follows the &ldquo;what happens when nobody
                answers&rdquo; action set on that particular line — voicemail, another person, a
                menu, a queue, or simply hanging up. That action is not set here. It is set one
                number at a time, in that number&rsquo;s Set Forwarding, on the Business Hours
                step, and it can be different for every number you own.
              </p>
              <p className="text-sm text-gray-700">
                So a caller giving up is rarely just the ring time. A line with no action set
                will stop ringing and then do nothing at all, no matter what number you choose
                above. You do not have to open each number to find those: Call coverage lists
                every number that would drop a call today, and fixes the ones it safely can.
              </p>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(CALL_COVERAGE_PATH)}
                >
                  Show me which numbers would drop a call
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="cs-savebar">
            <p className="text-xs text-gray-500">
              Saved for your whole company. Your other settings are not affected.
            </p>
            <SectionActions>
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="cs-save"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save settings'}
              </Button>
            </SectionActions>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CompanyRingTime;
