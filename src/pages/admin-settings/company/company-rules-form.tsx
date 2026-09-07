/* The two company screens that share one form: Phone rules and Greetings.
 *
 * They edit different halves of the same record and save through one button, so
 * they cannot simply be two independent pages. This component owns the form, the
 * loading, the seeding and the save; each page passes the tab it wants rendered.
 *
 * Splitting them into separate routes was the point of the URL work, but the
 * form has to stay shared or the two halves would fight over one record.
 */

import { useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { yupResolver } from '@hookform/resolvers/yup';

import { AudioLines, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SectionHeading } from './section-heading';
import { SectionActions } from './section-actions';
import { useUser } from '@/hooks/use-user';
import { handleAlert } from '@/lib/utils';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  COMPANY_DEFAULT_TEMPLATE_NAME,
  fetchCompanyDefaults,
  saveCompanyDefaults,
} from '@/lib/company-defaults';
import { buildTemplatePayload, hydrateTemplateForm } from '@/lib/user-settings-template-form';

import SettingPermission from '@/pages/admin-settings/templates/user-settings/add-edit-user-settings/settings';
import GreetingNotification from '@/pages/admin-settings/templates/user-settings/add-edit-user-settings/greetings';
import {
  ADD_TEMPLATE_INITIAL,
  settingsInitialState,
  TAB_CONSTANT,
} from '@/pages/admin-settings/templates/user-settings/add-edit-user-settings/constants';
import { UPSERT_TEMPLATE_SCHEMA } from '@/pages/admin-settings/templates/user-settings/add-edit-user-settings/schema';

/* The column every company settings section uses — see .cs-section in
   mcm-page.css. These two screens come from the shared user-settings templates,
   which default to scrolling inside a box of their own; this hands them the
   same shape the rest of the area has. */
const SECTION_COLUMN = 'user-settings-template-settings cs-section flex w-full flex-col gap-4';

const CompanyRulesForm = ({ tab }: { tab: string }) => {
  const queryClient: any = useQueryClient();
  const { user } = useUser();
  const [schemaContext, setSchemaContext] = useState<any>(null);

  const formInstance = useForm<any>({
    defaultValues: ADD_TEMPLATE_INITIAL,
    resolver: yupResolver(UPSERT_TEMPLATE_SCHEMA[tab]),
    mode: 'onChange',
    context: { activeTab: tab, schemaContext },
  });
  const { setValue, watch, handleSubmit } = formInstance;

  useEffect(() => {
    const subscription = watch((value) => setSchemaContext(value));
    return () => subscription.unsubscribe();
  }, [watch]);

  const {
    data: companyDefaults,
    isLoading,
    isError,
  } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
  });

  /* Whether the company level has ever been set. `isLoading` is checked
     separately so the "not set up yet" panel cannot flash before the answer
     arrives and tell the admin something untrue. */
  const hasCompanyDefaults = !!companyDefaults?.uuid;

  useEffect(() => {
    if (!companyDefaults) return;
    hydrateTemplateForm(setValue, companyDefaults, settingsInitialState);
  }, [companyDefaults, setValue]);

  /* Before the company level exists there is nothing to load, so the regional
     block is seeded from the admin's own account. It is the only place a sensible
     country and timezone is already known, and leaving those blank would save a
     record with no timezone — which reads as "never completed" on the way back
     in and would be discarded. */
  useEffect(() => {
    if (isLoading || hasCompanyDefaults) return;
    setValue('name', COMPANY_DEFAULT_TEMPLATE_NAME);
    if (user?.settings?.operational_hours?.regional) {
      setValue('settings.operational_hours.regional', user.settings.operational_hours.regional);
    }
  }, [isLoading, hasCompanyDefaults, user, setValue]);

  const { mutate: mutateSave, isPending } = useMutation({
    mutationFn: saveCompanyDefaults,
    onSuccess: (response: any) => {
      handleAlert({
        text: response?.data?.data?.message || 'Company phone preferences saved.',
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
    },
  });

  const isRules = tab === TAB_CONSTANT.SETTING_PERMISSIONS;

  /* These two screens are the only ones in the area that never named
     themselves: the tab strip said Phone rules or Greetings and the panel below
     it started straight in on the settings, so on arrival the page had no title
     at all while its seven neighbours did. One component renders both tabs, so
     the heading comes from which one is open. */
  const heading = isRules
    ? {
        icon: <SlidersHorizontal className="h-[18px] w-[18px]" />,
        title: 'Phone rules',
        description:
          'What everybody at your company starts with — where the company works, when it is open, and what a caller hears.',
      }
    : {
        icon: <AudioLines className="h-[18px] w-[18px]" />,
        title: 'Greetings',
        description:
          'The recordings a caller hears: the welcome message, hold music, the voicemail greeting and the ringback tone.',
      };

  const onSubmit = () => {
    const { settings = {}, greetings = {} } = watch();
    const payload = buildTemplatePayload({
      name: COMPANY_DEFAULT_TEMPLATE_NAME,
      settings,
      greetings,
      uuid: companyDefaults?.uuid,
    });
    mutateSave({
      uuid: companyDefaults?.uuid,
      settings: payload.settings,
      greetings: payload.greetings,
      /* Each tab replaces only the keys it edits. The other tab's keys, and every
         other company screen's, are re-read at save time rather than written
         back from this form's possibly stale copy. */
      only: isRules
        ? ['operational_hours', 'recording', 'display_number', 'transcription', 'ai_call_monitoring']
        : ['greetings'],
    });
  };

  /* Handed to the screen below rather than rendered here, so it sits inside that
     screen's own scrolling box. Rendered here it would be a sibling of that box
     and would hold its place while the settings moved under it, looking pinned.

     It closes the form: the note about how these settings work, then the button.
     The note reads better at the end — by the time somebody has been through the
     switches, "this is what happens when you save" is the next thing they want,
     where at the top it was a wall to get past first. */
  const footer = (
    <div className="flex flex-col gap-3">
      {isRules && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs text-gray-700">
          <p className="font-semibold text-gray-900 mb-1">How these settings are used</p>
          <p className="mb-1">
            These are what everybody at your company starts with. Each one has a{' '}
            <strong>Let people change this themselves</strong> switch: leave it off and the company
            setting stands for everyone, turn it on and a person may change that one thing on their
            own phone.
          </p>
          <p className="text-gray-600">
            Saving here does not rewrite phones that are already set up.
          </p>
        </div>
      )}

      {/* Just the button, with nothing drawn around it. `cs-save` because the
          `.mcm-page button` reset overrides the variant's white text — see the
          save row in mcm-page.css. */}
      <div className="cs-saverow">
        <SectionActions>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="cs-save"
            disabled={isPending || isLoading}
          >
            {isPending ? 'Saving...' : hasCompanyDefaults ? 'Save settings' : 'Create defaults'}
          </Button>
        </SectionActions>
      </div>
    </div>
  );

  /* The column is sized by its content, not by whatever height is left over.
     With `flex-1 min-h-0` it handed the form a fixed slice of the viewport to
     fit into, and the form paints the panel — so the white stopped partway down
     and the rest of the page carried on over bare ground. */
  return (
    <div className="flex w-full flex-col">
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 mb-3">
          Company preferences could not be loaded. Anything saved now would replace them, so saving
          is best left until the page loads cleanly.
        </div>
      )}

      {!isLoading && !hasCompanyDefaults && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-gray-700 mb-3">
          <p className="font-semibold text-gray-900 mb-1">Not set up yet</p>
          <p>Nothing has been set for your company yet. Choose what you want below and save.</p>
        </div>
      )}

      <FormProvider {...formInstance}>
        <form
          id="company-phone-rules-form"
          onSubmit={handleSubmit(onSubmit)}
          className="mcm-page mcm-userform user-settings-template-form cs-section-form flex w-full flex-col"
        >
          {isRules ? (
            <SettingPermission
              data={companyDefaults}
              company_info={user?.company_info}
              intro={<SectionHeading {...heading} />}
              footer={footer}
              containerClass={SECTION_COLUMN}
            />
          ) : (
            <GreetingNotification
              company_info={user?.company_info}
              intro={<SectionHeading {...heading} />}
              footer={footer}
              containerClass={`user-settings-template-greetings ${SECTION_COLUMN}`}
            />
          )}
        </form>
      </FormProvider>
    </div>
  );
};

export default CompanyRulesForm;
