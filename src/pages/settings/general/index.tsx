// import Breadcrumb from '@/components/custom/breadcrumb';
import CommonSettingPermission from '@/components/common-settings';
import { Button } from '@/components/ui/button';
import { POLICY_FIELDS, useCompanyPolicy, type PolicyField } from '@/lib/company-policy';
import { getHolidaysFormVal, getHolidaysPayload, handleAlert } from '@/lib/utils';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import { CUSTOM_HOURS_SCHEDULE_OPTIONS } from '@/pages/admin-settings/numbers/set-number-forwarding/constants';
import {
  FORWARDING_TAB_CONSTANT,
  settingsInitialState,
} from '@/pages/admin-settings/constants';
import { upsertUserSettingsSchema } from '@/pages/admin-settings/people/update-forwarding/schema';
import { getUserDetails, updateUserSettings } from '@/services/api';
import { yupResolver } from '@hookform/resolvers/yup';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FC, useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { COMPANY_RULES_PATH } from '@/pages/admin-settings/company/company-sections';
import {
  DIRECT_CALLS_ONLY_WORDING,
  LiveNote,
  NOT_APPLIED_WORDING,
  NotAppliedNote,
} from '../not-applied-note';

interface GeneralProps {
  heading?: string;
}

/* The record arrives parsed or as JSON text, depending on the caller. */
const parseSettings = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/* Named for what the sidebar calls it. "General" was the old tab name and no
   longer matches the menu item that opens this page. */
export const General: FC<GeneralProps> = ({ heading = 'Preferences' }) => {
  // const breadcrumbData = [{ label: 'Settings' }, { label: 'General' }];
  const queryClient: any = useQueryClient();
  const [schemaContext, setSchemaContext] = useState<any>(null);

  /* The same company rule the editor below reads, read once more here so the
     validation agrees with what is on screen. A setting the company has locked is
     greyed out, so requiring a value in it would leave this form permanently
     unsubmittable with an error pointing at a control the person cannot open.
     The query is shared with the editor, so this costs no extra request. */
  const companyPolicy = useCompanyPolicy({ enabled: true });
  const lockedFields = (Object.keys(POLICY_FIELDS) as PolicyField[]).filter(
    (field) => !companyPolicy.allows(field),
  );

  const methods = useForm({
    mode: 'all',
    defaultValues: { settings: settingsInitialState },
    resolver: yupResolver(upsertUserSettingsSchema[FORWARDING_TAB_CONSTANT.SETTING_PERMISSIONS]),
    context: {
      activeTab: FORWARDING_TAB_CONSTANT.SETTING_PERMISSIONS,
      schemaContext,
      lockedFields,
    },
  });

  const { handleSubmit, setValue, watch } = methods;

  useEffect(() => {
    const subscription = watch((value) => {
      setSchemaContext(value);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  const { data: userInfoData } = useQuery<any>({
    queryKey: ['getUserDetailsQueryFn'],
    queryFn: getUserDetails,
    select: (data) => data?.data?.data?.result,
  });

  const { mutate: mutateGeneralSettings, isPending: PendingGeneralSettings } = useMutation({
    mutationFn: updateUserSettings,
    onSuccess: () => {
      handleAlert({
        text: 'General Settings updated successfully!',
        type: 'success',
      });
      queryClient.invalidateQueries(['getUsersDetails', 'getUserDetailsQueryFn'], {
        exact: true,
      });
      invalidateGlobalUsersDirectory(queryClient);
    },
  });

  const onSubmit = () => {
    const {
      display_number: { masking = {}, incoming = {}, show_number_if_blocked = 'NO' } = {},
      operational_hours = {},
      ...restSettings
    }: any = watch('settings');

    /* The save endpoint replaces the whole `settings` column with what it is
       sent, and this form only ever hydrates the keys it shows. So any key
       another screen wrote to the person's record was deleted the first time
       Submit was pressed here. The one that matters most is
       `international_calling` - the admin's per-person rule on calling abroad,
       and the only per-person key the switch actually reads. Starting from the
       stored record and laying the form's keys over it keeps everything this
       page does not know about, now and for keys added later. */
    const storedSettings = parseSettings(userInfoData?.settings);
    const tempSettings = {
      ...storedSettings,
      ...restSettings,
      display_number: {
        incoming,
        masking: {
          type: masking?.type?.value,
          label: masking?.type?.label,
          value: masking?.value,
        },
        show_number_if_blocked,
      },

      operational_hours: {
        type: operational_hours?.type,
        value: operational_hours?.value || CUSTOM_HOURS_SCHEDULE_OPTIONS,
        holidays: operational_hours?.holidays?.length
          ? getHolidaysPayload(operational_hours.holidays)
          : [],
        regional: {
          country: operational_hours?.regional?.country,
          timezone: operational_hours?.regional?.timezone,
          time_format: operational_hours?.regional?.time_format,
          country_code: operational_hours?.regional?.country_code,
        },
        closed_hour_action: {
          type: operational_hours?.closed_hour_action?.type?.value,
          value: operational_hours?.closed_hour_action?.value?.value,
          enabled: operational_hours?.closed_hour_action?.enabled,
          personal: operational_hours?.closed_hour_action?.personal,
          type_label: operational_hours?.closed_hour_action?.type?.label,
          value_label: operational_hours?.closed_hour_action?.value?.label,
        },
      },
    };

    const payload = {
      key: 'settings',
      value: removeOverride(tempSettings),
    };
    mutateGeneralSettings(payload);
  };

  /* Company rule flags describe what the company does to a person; they are not
     part of that person's own settings. `override` was already stripped for that
     reason, and `apply`/`locked` are the same flag split in two, so all three go.
     Left in, this page would save the company's rule back onto the individual
     record, and the lock would then be read from the wrong level. */
  const RULE_FLAG_KEYS = ['override', 'apply', 'locked'];

  function removeOverride<T>(obj: T): T {
    if (Array.isArray(obj)) {
      return obj.map(removeOverride) as unknown as T;
    } else if (typeof obj === 'object' && obj !== null) {
      return Object.fromEntries(
        Object.entries(obj)
          .filter(([key]) => !RULE_FLAG_KEYS.includes(key))
          .map(([key, value]) => [key, removeOverride(value)]),
      ) as unknown as T;
    }
    return obj;
  }

  useEffect(() => {
    if (userInfoData) {
      const settingInfo: any = parseSettings(userInfoData?.settings);
      setValue(
        'settings.operational_hours.regional.timezone',
        settingInfo?.operational_hours?.regional?.timezone || {},
      );
      setValue(
        'settings.operational_hours.regional.country_code',
        settingInfo?.operational_hours?.regional?.country_code || {},
      );
      setValue(
        'settings.operational_hours.regional.time_format',
        settingInfo?.operational_hours?.regional?.time_format || 12,
      );
      setValue(
        'settings.operational_hours.regional.country',
        settingInfo?.operational_hours?.regional?.country || {},
      );
      setValue('settings.recording', settingInfo?.recording || {});

      setValue('settings.operational_hours.type', settingInfo?.operational_hours?.type || '');
      setValue('settings.operational_hours.value', settingInfo?.operational_hours?.value || {});

      const holidays =
        settingInfo?.operational_hours?.holidays && settingInfo?.operational_hours?.holidays?.length
          ? getHolidaysFormVal(settingInfo?.operational_hours?.holidays)
          : [];

      setValue('settings.operational_hours.holidays', holidays);

      setValue('settings.operational_hours.closed_hour_action', {
        type: {
          label: settingInfo?.operational_hours?.closed_hour_action?.type_label || '',
          value: settingInfo?.operational_hours?.closed_hour_action?.type || '',
        },
        value: {
          label: settingInfo?.operational_hours?.closed_hour_action?.value_label || '',
          value: settingInfo?.operational_hours?.closed_hour_action?.value || '',
        },
        enabled: settingInfo?.operational_hours?.closed_hour_action?.enabled,
        personal: settingInfo?.operational_hours?.closed_hour_action?.personal,
      });

      setValue('settings.role', settingInfo?.role || { label: '', value: '' });
      setValue('settings.group', settingInfo?.group || { label: '', value: '' });

      setValue('settings.voicemail_pin.value', settingInfo?.voicemail_pin?.value || '');
      setValue('settings.voicemail_pin.users', settingInfo?.voicemail_pin?.users || []);
      setValue(
        'settings.voicemail_pin.voicemail_to_text',
        settingInfo?.voicemail_pin?.voicemail_to_text || 'NO',
      );

      setValue('settings.display_number.incoming', settingInfo?.display_number?.incoming || {});
      setValue('settings.display_number.masking', settingInfo?.display_number?.masking || {});
      setValue(
        'settings.display_number.show_number_if_blocked',
        settingInfo?.display_number?.show_number_if_blocked || 'NO',
      );
      setValue('settings.display_number.masking.type', {
        label: settingInfo?.display_number?.masking?.label || '',
        value: settingInfo?.display_number?.masking?.type || '',
      });
      setValue('settings.transcription', settingInfo?.transcription || false);
      setValue('settings.ai_call_monitoring', settingInfo?.ai_call_monitoring || false);
    }
  }, [userInfoData]);

  return (
    <>
      <section className="w-full h-full min-h-0 flex flex-col overflow-hidden bg-gray-200/15">
        {/* <Breadcrumb breadcrumbs={breadcrumbData} /> */}
        <div className="flex items-center justify-between p-3 border-b border-gray-200 min-h-[65px] bg-white">
          <div>
            <p className="text-gray-900 font-semibold text-lg">{heading}</p>
            <p className="text-gray-500 text-xs">
              Your own regional settings, business hours and call handling. Company-wide rules live
              under{' '}
              <Link to={COMPANY_RULES_PATH} className="font-medium text-primary hover:underline">
                Company → Company Rules
              </Link>
              .
            </p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <FormProvider {...methods}>
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="flex h-full min-h-0 w-full flex-col gap-3"
            >
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {/* The cards below are a shared editor with no badge of its own
                    on a personal page, so the honest notes sit above them.
                    Since the switch patch of 3 Sep 2026 the person's own
                    Business Hours (with the closed-hours destination, else
                    voicemail) ARE read for a call dialled straight to their
                    extension - proven by offline tests and by reading the
                    running switch, not yet by a real call. Recording,
                    transcription, AI monitoring and display number are still
                    the company's rule; the personal copies saved here are
                    not read. */}
                <div className="mb-3 flex flex-col gap-2">
                  <LiveNote title="Business Hours: Active">
                    Your own hours are followed. Outside them, a caller goes where your closed-hours
                    setting says, or to your voicemail if you have not chosen anything.{' '}
                    {DIRECT_CALLS_ONLY_WORDING}
                  </LiveNote>
                  <NotAppliedNote title={NOT_APPLIED_WORDING}>
                    This covers Call Recording, Automatic Transcription, AI Call Monitoring and
                    Display Number on this page. Recording in particular is decided by your
                    company&rsquo;s rule under{' '}
                    <Link to={COMPANY_RULES_PATH} className="font-semibold underline">
                      Company → Company Rules
                    </Link>
                    , not by the switch here.
                  </NotAppliedNote>
                </div>
                <CommonSettingPermission
                  type={'GENERAL_SETTING'}
                  data={{ user_info: userInfoData?.user_info, settings: userInfoData?.settings }}
                  IS_ADMIN={false}
                  origin={'general_settings'}
                  company_info={userInfoData?.company_info}
                  isChooseTemplate={false}
                  /* These are the person's own settings — their timezone, their
                     hours, their recording preference — so they may edit them.
                     This used to be `isEditable={IS_ADMIN}`, which greyed out the
                     whole page for everyone who was not an admin, including every
                     tenant that has no company rule at all. Holding people back
                     from settings the company controls is the company rule's job,
                     and it does it per setting rather than per job title. */
                  isEditable={true}
                  // isShowVoicemail={true}
                  customClass="md:min-h-[calc(100vh_-_13rem)]"
                  selectedUserExt={userInfoData?.user_info?.extension}
                />
              </div>
              <div className="flex justify-end mcm-stickyfoot">
                {/* Saving before the company rule has arrived could write a value the
                    company does not allow, so the button waits for it. The query has
                    no retry, so this is one request long either way. */}
                <Button
                  variant={'primary'}
                  type="submit"
                  disabled={PendingGeneralSettings || companyPolicy.isLoading}
                >
                  {PendingGeneralSettings ? 'Submiting...' : 'Save preferences'}
                </Button>
              </div>
            </form>
          </FormProvider>
        </div>
      </section>{' '}
    </>
  );
};
