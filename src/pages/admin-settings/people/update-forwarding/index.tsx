import { useEffect, useState, type FC } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { yupResolver } from '@hookform/resolvers/yup';
import {
  basicInitialState,
  ERROR_TYPES,
  ERROR_TYPES_MESSAGES,
  FORWARDING_TAB_CONSTANT,
  settingsInitialState,
  UPDATE_FORWARDING_INITIAL,
} from '../../constants';
import { FormProvider, useForm } from 'react-hook-form';
import { upsertUserSettingsSchema } from './schema';
import BasicInformation from './basic-information';
import GreetingNotification from './greetings';
import { roleDisplayName } from '@/pages/admin-settings/roles/role-names';
import CallRules from './call-rules';
import { RING_TYPE_LABELS } from '@/constants/forwarding-consts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRoleList, updateMemberForwading } from '@/services/api';
import { useUser } from '@/hooks/use-user';
import { getHolidaysFormVal, getHolidaysPayload, handleAlert } from '@/lib/utils';
import { COMPANY_DEFAULTS_QUERY_KEY, fetchCompanyDefaults } from '@/lib/company-defaults';
import { seedDeviceRingTime } from '@/lib/company-ring-time';
import { getCompanyNewUserDefaults } from '@/lib/company-new-user-defaults';
import { readRuleFlags } from '@/lib/company-rule-flags';
import ErrorTooltip from '@/components/custom/error-tooltip';
import { CUSTOM_HOURS_SCHEDULE_OPTIONS } from '@/pages/admin-settings/numbers/set-number-forwarding/constants';
import Loader from '@/components/custom/loader';
import CustomAvatar from '@/components/custom/custom-avatar';
import CommonSettingPermission from '@/components/common-settings';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import { mergeCallForwarding } from '@/lib/call-forwarding-record';

// ========== Types =========
interface DeviceOption {
  type: string;
  name: string;
  status: boolean;
  label: string;
  timeout: string;
  value: string;
  isDefault: boolean;
}

interface GreetingValue {
  label: string;
  value: string;
}

interface GreetingState {
  enabled: boolean;
  value: GreetingValue;
}

interface Greetings {
  welcome_greeting: GreetingState;
  voicemail: GreetingState;
  ring_tone: GreetingState;
  on_hold_music: GreetingState;
}

interface FormValues {
  basic: {
    email: string;
    site: { label: string; value: string };
    extension: string;
    phone: string;
    caller_id: string;
    job_title: string;
    first_name: string;
    last_name: string;
  };
  settings: any;
  greetings: Greetings;
  callRules: any;
  templateName: string;
}

interface UpdateForwardingProps {
  drawerState: boolean;
  setDrawerState: (state: boolean) => void;
  data: any;
  setTabData?: any;
}

const TABS_ORDER = [
  FORWARDING_TAB_CONSTANT.BASIC_INFORMATION,
  FORWARDING_TAB_CONSTANT.SETTING_PERMISSIONS,
  FORWARDING_TAB_CONSTANT.GREETING_NOTIFICATION,
  FORWARDING_TAB_CONSTANT.CALL_RULES,
];

const UpdateForwarding: FC<UpdateForwardingProps> = ({ setDrawerState, data, setTabData }) => {
  const [activeTab, setActiveTab] = useState<string>(FORWARDING_TAB_CONSTANT.BASIC_INFORMATION);
  const queryClient: any = useQueryClient();
  const [chooseTemplate, setChooseTemplate] = useState<{
    isChooseTemplate: 'Yes' | 'No';
    selectedTemplate: { uuid: string; settings?: any; greetings?: any } | null;
  }>({
    isChooseTemplate: 'No',
    selectedTemplate: null,
  });

  const [schemaContext, setSchemaContext] = useState<any>(null);

  const selectedUser = {
    name: `${data?.first_name}${data?.last_name ? ` ${data?.last_name}` : ''}`,
    extension: data?.extension || '',
  };

  const { data: roleList = [], isFetched } = useQuery({
    queryKey: ['useRolesList', true],
    queryFn: () => getRoleList(true),
    select: (res) => res?.data?.data?.result?.rows,
  });

  /* Company policy, read once, used to seed a person the first time they are
     set up. Shares the cache key with every other company-level screen. */
  const { data: companyDefaults } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
    staleTime: 5 * 60 * 1000,
  });

  const formInstance = useForm<FormValues>({
    defaultValues: UPDATE_FORWARDING_INITIAL,
    resolver: yupResolver(upsertUserSettingsSchema[activeTab]),
    mode: 'onChange',
    context: { activeTab, schemaContext },
  });

  useEffect(() => {
    const subscription = formInstance.watch((value) => {
      setSchemaContext(value);
    });
    return () => subscription.unsubscribe();
  }, [formInstance.watch]);

  const { user } = useUser();
  const { user_info, company_info, uuid } = user || {};
  const IS_ADMIN = user_info?.role === 'ADMIN';
  const isAdminAccount = IS_ADMIN && uuid === data?.uuid;
  const {
    setValue,
    trigger,
    formState: { errors },
    watch,
  } = formInstance;
  const isSelectedTemplate = !!chooseTemplate?.selectedTemplate?.uuid;

  const handleTabChange = async (nextTab: string) => {
    const currentIndex = TABS_ORDER.indexOf(activeTab);
    const nextIndex = TABS_ORDER.indexOf(nextTab);

    if (nextIndex <= currentIndex) {
      setActiveTab(nextTab);
      return;
    }

    if (activeTab === FORWARDING_TAB_CONSTANT.BASIC_INFORMATION) {
      if (chooseTemplate?.isChooseTemplate === 'Yes' && !chooseTemplate?.selectedTemplate?.uuid) {
        formInstance.setError('basic.selectedTemplate' as any, {
          type: 'manual',
          message: 'Template is required',
        });
        return;
      }
    }

    const values = formInstance.getValues();

    for (let i = currentIndex; i < nextIndex; i++) {
      const tabKey = TABS_ORDER[i];
      const schema = upsertUserSettingsSchema[tabKey];

      try {
        await schema.validate(values, {
          abortEarly: false,
          context: { activeTab: tabKey, schemaContext },
        });
      } catch (err: any) {
        if (err?.inner) {
          err.inner.forEach((validationError: any) => {
            if (validationError.path) {
              formInstance.setError(validationError.path as any, {
                type: 'manual',
                message: validationError.message,
              });
            }
          });
        }

        return;
      }
    }

    setActiveTab(nextTab);
  };

  const handleNext = async () => {
    const currentIndex = TABS_ORDER.indexOf(activeTab);
    const isValid = await trigger();

    let hasError = false;
    if (activeTab === FORWARDING_TAB_CONSTANT.BASIC_INFORMATION) {
      if (chooseTemplate?.isChooseTemplate === 'Yes' && !chooseTemplate?.selectedTemplate?.uuid) {
        formInstance.setError('basic.selectedTemplate' as any, {
          type: 'manual',
          message: 'Template is required',
        });
        hasError = true;
      }
    }

    if (isValid && !hasError && currentIndex < TABS_ORDER.length - 1) {
      setActiveTab(TABS_ORDER[currentIndex + 1]);
    }
  };

  /**
   * Commit from any step. Every step is validated first — not just the one on
   * screen — because the resolver only ever carries the active step's schema,
   * so submitting straight from step 1 would otherwise send the other three
   * unchecked. On failure it lands you on the first step that has a problem
   * instead of reporting an error you cannot see.
   */
  const handleSaveNow = async () => {
    if (chooseTemplate?.isChooseTemplate === 'Yes' && !chooseTemplate?.selectedTemplate?.uuid) {
      formInstance.setError('basic.selectedTemplate' as any, {
        type: 'manual',
        message: 'Template is required',
      });
      setActiveTab(FORWARDING_TAB_CONSTANT.BASIC_INFORMATION);
      return;
    }

    const values = formInstance.getValues();

    for (const tabKey of TABS_ORDER) {
      try {
        await upsertUserSettingsSchema[tabKey].validate(values, {
          abortEarly: false,
          context: { activeTab: tabKey, schemaContext },
        });
      } catch (err: any) {
        err?.inner?.forEach((validationError: any) => {
          if (validationError.path) {
            formInstance.setError(validationError.path as any, {
              type: 'manual',
              message: validationError.message,
            });
          }
        });
        setActiveTab(tabKey);
        return;
      }
    }

    onSubmit();
  };

  const handlePrev = () => {
    const currentIndex = TABS_ORDER.indexOf(activeTab);
    if (currentIndex > 0) {
      setActiveTab(TABS_ORDER[currentIndex - 1]);
    }
  };

  useEffect(() => {
    const subscription = watch((value) => {
      setSchemaContext(value);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  const { mutate: mutateUpdateMember, isPending: isPendingUpdateMember } = useMutation({
    mutationFn: updateMemberForwading,
    onSuccess: (data) => {
      handleAlert({ text: data?.data?.message || 'Person updated', type: 'success' });
      queryClient.invalidateQueries(['fetchUsersList']);
      invalidateGlobalUsersDirectory(queryClient);
      setDrawerState(false);
      setTabData(data?.data?.data?.result);
    },
  });

  const onSubmit = () => {
    const { basic = basicInitialState, greetings = {}, settings, callRules = {} } = watch();
    const {
      display_number: { masking = {}, incoming = {}, show_number_if_blocked = 'NO' } = {},
      role = {},
      operational_hours = {},
      ...restSettings
    } = settings;
    const tempSettings = {
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
      role: {
        label: IS_ADMIN && isAdminAccount ? 'ADMIN' : role?.label,
        value: IS_ADMIN && isAdminAccount ? 'ADMIN' : role?.value,
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
    const deviceOptionsSorted = Object.entries(callRules?.incomingCall?.deviceOptions || {})
      .map(([key, value]) => {
        const typedValue = value as { order: number; [key: string]: any };
        return { key, ...typedValue };
      })
      .sort((a, b) => a.order - b.order);

    const callRuleRequest = {
      forward_calls: {
        enabled: callRules?.forwardCall?.enabled,
        type: callRules?.forwardCall?.type?.value,
        value:
          callRules?.forwardCall?.type?.value === 'VOICEMAIL' && callRules?.forwardCall?.personal
            ? selectedUser?.extension
            : callRules?.forwardCall?.value?.value,

        value_label: callRules?.forwardCall?.value?.label || 'Select',
        label:
          callRules?.forwardCall?.type?.value === 'VOICEMAIL' && callRules?.forwardCall?.personal
            ? selectedUser?.name
            : callRules?.forwardCall?.value?.name || selectedUser?.name,
        type_label: callRules?.forwardCall?.type?.label,
        personal: callRules?.forwardCall?.personal,
      },
      dnd: callRules?.doNotDisturb,
      incoming_calls: {
        enabled: callRules?.incomingCall?.enabled,
        device_options: transformPayloadNew(deviceOptionsSorted),
        type: callRules?.incomingCall?.deviceOptionValue?.value,
        failure_action: {
          enabled: true,
          type: callRules?.failureAction?.type?.value,
          value_label: callRules?.failureAction?.value?.label || 'Select',
          value:
            callRules?.failureAction?.type?.value === 'VOICEMAIL' &&
            callRules?.failureAction?.personal
              ? selectedUser?.extension || ''
              : callRules?.failureAction?.value?.value,
          label:
            callRules?.failureAction?.type?.value === 'VOICEMAIL' &&
            callRules?.failureAction?.personal
              ? selectedUser?.name
              : callRules?.failureAction?.value?.name || selectedUser?.name,
          type_label: callRules?.failureAction?.type?.label,
          personal: callRules?.failureAction?.personal,
        },
      },
      outgoing_calls: {
        enabled: callRules?.outgoingCall?.enabled,
        default_caller_id: callRules?.outgoingCall?.defaultCallerId?.value,
        default_fax_id: callRules?.outgoingCall?.defaultFaxId,
        default_text_id: callRules?.outgoingCall?.defaultTextId,
        ring_out: callRules?.outgoingCall?.ringOut,
        region: callRules?.outgoingCall?.region,
      },
    };

    const greetingsRequest = {
      welcome_greeting: getGreetingConfig('welcome_greeting', greetings),
      voicemail: getGreetingConfig('voicemail', greetings),
      ring_tone: getGreetingConfig('ring_tone', greetings),
      on_hold_music: getGreetingConfig('on_hold_music', greetings),
    };

    const payload = {
      first_name: basic?.first_name,
      last_name: basic?.last_name,
      job_title: basic?.job_title,
      caller_id: basic?.caller_id,
      /* The photo, passed through exactly as stored. The server writes
         `profile = profile ?? null` on every update, so leaving it out of this
         payload wiped the person's photo on every save from this drawer. This
         drawer does not edit the photo; it only has to hand it back. */
      profile: data?.profile ?? null,
      /* Omitted rather than sent empty: a blank value here means we failed to
         resolve the current site, not that the admin cleared it. */
      ...(basic?.site?.value ? { site_uuid: basic.site.value } : {}),
      /* Only the keys above belong to this drawer. Everything else already on
         the record — the person's own presence among them — is carried through,
         so saving here does not delete what another screen owns. */
      call_forwarding: mergeCallForwarding(data?.call_forwarding, callRuleRequest),
      [['MANAGER', 'ADMIN', 'AGENT', 'SUB-ADMIN'].includes(role?.label)
        ? 'role_uuid'
        : 'custom_role_uuid']: role?.value || null,
      greetings: greetingsRequest,
      settings: removeOverride(tempSettings),
      uuid: data?.uuid,
      userID: data?.uuid,
    };
    mutateUpdateMember(payload);
  };

  /* Presence is not editable here. It belongs to the person, and is set from
     their own avatar menu, which writes `call_forwarding.status` and broadcasts
     over the socket. The copy that used to live in this form posted
     `{ socket_status }` with no target user and emitted against the *admin's*
     extension, so saving someone else's call rules changed your own presence. */

  const getGreetingConfig = (
    key: string,
    greetings: Record<string, { enabled?: boolean; value?: { label?: string; value?: string } }>,
  ) => ({
    enabled: greetings?.[key]?.enabled,
    label: greetings?.[key]?.value?.label,
    value: greetings?.[key]?.value?.value,
  });

  function transformPayloadNew(res: any[]) {
    return res.map((item) => ({
      type: item?.type || 'web',
      status: item.status ?? false,
      label: item.value.label || '',
      value: item?.key === 'web' ? selectedUser?.extension || '' : item.option?.value || '',
      name: item?.key === 'web' ? selectedUser?.name || '' : item.option?.label || '',
      timeout: item.value.value,
      isDefault: item.isDefault ?? false,
    }));
  }

  /* Company rule flags describe what the company does to a person; they are not
     part of that person's own settings. `override` was already stripped for that
     reason, and `apply`/`locked` are the same flag split in two, so all three go.
     Left in, a copied company value would arrive on the individual record still
     carrying its rule, and the lock would then be read back from the wrong level. */
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
    if (!data?.uuid || !roleList.length || isSelectedTemplate) return;
    try {
      if (data?.uuid) {
        const roleID = data?.custom_role_uuid || data?.role_uuid;
        const selectedRole = roleList.find(
          (item: { role_uuid: string; uuid: string }) =>
            item?.role_uuid === roleID || item?.uuid === roleID,
        );
        const settingsData =
          typeof data?.settings === 'string'
            ? JSON.parse(data?.settings || '{}')
            : data?.settings || {};

        const greetingsData =
          typeof data?.greetings === 'string' ? JSON.parse(data?.greetings) : data?.greetings || {};

        const callHandlingData =
          typeof data?.call_forwarding === 'string'
            ? JSON.parse(data.call_forwarding || '{}')
            : data?.call_forwarding;

        let tempObj: any = {};
        let tempDeviceOptions: DeviceOption[] = [];

        if (callHandlingData?.incoming_calls?.device_options?.length) {
          tempDeviceOptions = callHandlingData.incoming_calls.device_options;

          // Build initial tempObj
          tempDeviceOptions.forEach((item) => {
            const typeKey =
              data?.extension !== item?.value ? item?.name || 'web' : item?.type || 'web';
            tempObj[typeKey] = {
              status: item?.status,
              isDefault: item?.isDefault,
              type: item?.type || 'web',
              value: {
                label: item?.label,
                value: seedDeviceRingTime(
                  { label: item?.label, value: item?.timeout },
                  companyDefaults?.settings,
                ),
              },
              option: {
                label: item?.name,
                value: item?.value,
              },
            };
          });

          // Ensure 'mobile' is added if not present
          if (!tempObj.mobile) {
            tempObj.mobile = {
              status: true,
              value: seedDeviceRingTime(undefined, companyDefaults?.settings),
              type: 'mobile',
              option: {
                label: selectedUser?.name || '',
                value: selectedUser?.extension || '',
              },
            };
          }

          // Ensure 'pstn' is added if not present
          if (!tempObj.pstn) {
            tempObj.pstn = {
              status: true,
              value: seedDeviceRingTime(undefined, companyDefaults?.settings),
              type: 'pstn',
              option: {
                label: selectedUser?.name || '',
                value: selectedUser?.extension || '',
              },
            };
          }
        } else {
          // Default case if no device_options
          tempObj = {
            web: {
              status: true,
              value: seedDeviceRingTime(undefined, companyDefaults?.settings),
              type: 'web',
              option: {
                label: selectedUser?.name || '',
                value: selectedUser?.extension || '',
              },
            },
            mobile: {
              status: true,
              value: seedDeviceRingTime(undefined, companyDefaults?.settings),
              type: 'mobile',
              option: {
                label: selectedUser?.name || '',
                value: selectedUser?.extension || '',
              },
            },
            pstn: {
              status: true,
              value: seedDeviceRingTime(undefined, companyDefaults?.settings),
              type: 'pstn',
              option: {
                label: selectedUser?.name || '',
                value: selectedUser?.extension || '',
              },
            },
          };
        }

        setValue('callRules.forwardCall', {
          enabled: callHandlingData?.forward_calls?.enabled || false,
          type: {
            label: callHandlingData?.forward_calls?.type_label || 'Send to Voicemail',
            value: callHandlingData?.forward_calls?.type || 'VOICEMAIL',
          },
          value: {
            label: callHandlingData?.forward_calls?.value_label || 'Select',
            value: callHandlingData?.forward_calls?.value || user_info?.extension,
          },
          personal: !!callHandlingData?.forward_calls?.personal,
        });

        setValue('callRules.incomingCall', {
          enabled: true,
          deviceOptions: tempObj,
          deviceOptionValue: {
            label:
              RING_TYPE_LABELS[
                callHandlingData?.incoming_calls?.type as keyof typeof RING_TYPE_LABELS
              ] || RING_TYPE_LABELS?.sequential,
            value: callHandlingData?.incoming_calls?.type || 'sequential',
          },
          type: 'number',
          number: '',
          name: '',
          extension: Object.keys(tempObj)
            .filter((key: any) => tempObj?.[key]?.option?.value !== data.extension)
            .map((key: any) => ({
              label: tempObj?.[key]?.option?.label || '',
              value: tempObj?.[key]?.option?.value || '',
            })),
        });

        setValue(`callRules.doNotDisturb`, callHandlingData?.dnd || false);

        setValue('callRules.outgoingCall', {
          enabled: callHandlingData?.outgoing_calls?.enabled || false,
          defaultCallerId: {
            label: callHandlingData?.outgoing_calls?.default_caller_id
              ? `${`${callHandlingData?.outgoing_calls?.default_caller_id.startsWith('+') ? `${callHandlingData?.outgoing_calls?.default_caller_id}` : `+${callHandlingData?.outgoing_calls?.default_caller_id}`}`}`
              : '',
            value: callHandlingData?.outgoing_calls?.default_caller_id || '',
          },
          defaultFaxId: callHandlingData?.outgoing_calls?.default_fax_id || '',
          defaultTextId: callHandlingData?.outgoing_calls?.default_text_id || '',
          ringOut: callHandlingData?.outgoing_calls?.ring_out || false,
          region: callHandlingData?.outgoing_calls?.region || '',
        });

        ['failureAction'].forEach((key) => {
          const action =
            callHandlingData?.incoming_calls?.[
              key === 'failureAction' ? 'failure_action' : 'closed_hour_action'
            ];
          setValue(`callRules.${key}`, {
            enabled: action?.enabled || false,
            type: {
              label: action?.type_label || 'Send to Voicemail',
              value: action?.type || 'VOICEMAIL',
            },
            value: {
              label: action?.value_label || 'Select',
              value: action?.value || user_info?.extension,
            },
            personal: action?.personal || true,
          });
        });

        setValue('templateName', data?.name || '');

        /* A person with no saved timezone has never been configured, so this is
           their first-time setup rather than an edit. */
        const isFirstTimeSetup = !settingsData?.operational_hours?.regional?.timezone?.value;

        /* Starting from defaults is right for the fields this form owns, and
           destructive for anything else on the record. The same swap on the
           company record silently deleted the emergency address, holidays and
           policies until it was fixed; this is the same shape, one level down.
           Keys the defaults do not describe are carried through untouched. */
        const formOwnedKeys = new Set(Object.keys(settingsInitialState || {}));
        const carriedThrough: Record<string, any> = {};
        Object.keys(settingsData || {}).forEach((key) => {
          if (!formOwnedKeys.has(key)) carriedThrough[key] = (settingsData as any)[key];
        });

        setValue('settings', {
          ...(isFirstTimeSetup ? settingsInitialState : settingsData),
          ...carriedThrough,
        });

        /* Company policy decides what a new person starts with.
        
           This also fixes a real bug rather than only adding a feature:
           `settingsInitialState` hard-codes voicemail-to-text as ON, so a company
           whose policy said OFF still got every new person switched on. That 'YES'
           is a shipped placeholder, not anybody's answer, which is why it is safe
           to replace — a value the admin actually chose is left alone. */
        if (isFirstTimeSetup) {
          const seed = getCompanyNewUserDefaults({
            companySettings: companyDefaults?.settings,
            formValues: formInstance.getValues(),
            touchedPaths: Object.keys(formInstance.formState.dirtyFields || {}),
          });
          seed.values.forEach(({ path, value }) => setValue(path as any, value));
        }
        setValue('settings.role', {
          label: selectedRole?.name || '',
          value: selectedRole?.type === 'custom' ? selectedRole?.uuid : selectedRole?.role_uuid,
        });
        setValue('settings.display_number.masking.type', {
          label: settingsData?.display_number?.masking?.label || '',
          value: settingsData?.display_number?.masking?.type || '',
        });

        const holidays =
          settingsData?.operational_hours?.holidays &&
          settingsData?.operational_hours?.holidays?.length
            ? getHolidaysFormVal(settingsData?.operational_hours?.holidays)
            : [];

        setValue('settings.operational_hours.holidays', holidays);

        setValue('settings.operational_hours.closed_hour_action', {
          type: {
            label: settingsData?.operational_hours?.closed_hour_action?.type_label || '',
            value: settingsData?.operational_hours?.closed_hour_action?.type || '',
          },
          value: {
            label: settingsData?.operational_hours?.closed_hour_action?.value_label || '',
            value: settingsData?.operational_hours?.closed_hour_action?.value || '',
          },
          enabled: settingsData?.operational_hours?.closed_hour_action?.enabled,
          personal: settingsData?.operational_hours?.closed_hour_action?.personal,
        });

        const welcomeGreetingData = greetingsData?.welcome_greeting || greetingsData?.welcome;
        const onHoldMusicData = greetingsData?.on_hold_music || greetingsData?.hold;

        setValue('greetings', {
          welcome_greeting: {
            enabled: welcomeGreetingData?.enabled || false,
            value: {
              label: welcomeGreetingData?.label || 'Select',
              value: welcomeGreetingData?.value || '',
            },
          },
          voicemail: {
            enabled: greetingsData?.voicemail?.enabled || false,
            value: {
              label: greetingsData?.voicemail?.label || 'Select',
              value: greetingsData?.voicemail?.value || '',
            },
          },
          ring_tone: {
            enabled: greetingsData?.ring_tone?.enabled || false,
            value: {
              label: greetingsData?.ring_tone?.label || 'Select',
              value: greetingsData?.ring_tone?.value || '',
            },
          },
          on_hold_music: {
            enabled: onHoldMusicData?.enabled || false,
            value: {
              label: onHoldMusicData?.label || 'Select',
              value: onHoldMusicData?.value || '',
            },
          },
        });
        /* This is the person's own record, not a template, so the value shown is
           the value stored - in either of its two shapes, a bare boolean from the
           server's defaults or {enabled} from a later save. Gating it on the
           person's own apply flag turned a stored "on" into "off" on every page
           load, and the next save wrote that "off" back. */
        const storedToggle = (node: any): boolean =>
          typeof node === 'object' && node !== null ? !!node.enabled : !!node;
        setValue('settings.transcription', storedToggle(settingsData?.transcription));
        setValue('settings.ai_call_monitoring', storedToggle(settingsData?.ai_call_monitoring));

        setValue('basic', {
          email: data?.email || '',
          /* The user-list row carries `site: { name }`; only some responses
             also carry `site_uuid`. Reading just `site_uuid` left the select
             showing the site name with an empty value, which then saved as
             "no site" and wiped the person's location. Accept either shape. */
          site: {
            label: data?.site?.name || '',
            value: data?.site_uuid || data?.site?.uuid || '',
          },
          extension: data?.extension || '',
          phone: data?.phone || '',
          caller_id: data?.caller_id || '',
          job_title: data?.job_title || '',
          first_name: data?.first_name || '',
          last_name: data?.last_name || '',
        });
      }
    } catch (error: any) {
      console.error('Something went wrong', error?.message);
    }
  }, [data, roleList, isSelectedTemplate]);

  useEffect(() => {
    if (!data?.uuid || !isSelectedTemplate) return;
    try {
      const settingsData =
        typeof chooseTemplate.selectedTemplate?.settings === 'string'
          ? JSON.parse(chooseTemplate.selectedTemplate.settings)
          : chooseTemplate.selectedTemplate?.settings;

      const greetingsData =
        typeof chooseTemplate.selectedTemplate?.greetings === 'string'
          ? JSON.parse(chooseTemplate.selectedTemplate.greetings || '{}')
          : chooseTemplate.selectedTemplate?.greetings;
      seSettingsData(settingsData);
      setGreetingsData(greetingsData);
    } catch (error: any) {
      console.error('Something went wrong', error?.message);
    }
  }, [isSelectedTemplate, chooseTemplate?.selectedTemplate]);

  /* Every test below asks the same question — should this company value be put onto
     the person — which is the `apply` half of the rule, not the `locked` half the raw
     `override` flag was also being used for. `readRuleFlags` reads a record that only
     carries the old flag exactly as this code read it before, so nothing changes for
     existing data; what it adds is the ability for a company to apply a value AND lock
     it, which one flag could never say. */
  const seSettingsData = (settingsData: any) => {
    if (readRuleFlags(settingsData, 'regional').apply)
      setValue('settings.operational_hours.regional', settingsData?.operational_hours?.regional);
    if (
      readRuleFlags(settingsData, 'display_number').apply ||
      chooseTemplate?.isChooseTemplate === 'Yes'
    ) {
      const maskingType = settingsData?.display_number?.masking?.type;
      const typeValue = typeof maskingType === 'object' ? maskingType?.value : maskingType;
      const typeLabel =
        typeof maskingType === 'object'
          ? maskingType?.label
          : settingsData?.display_number?.masking?.label;

      setValue('settings.display_number', {
        incoming: settingsData?.display_number?.incoming || { label: 'Yes', value: true },
        masking: {
          type: {
            label: typeLabel || 'None',
            value: typeValue || 'N',
          },
          value: settingsData?.display_number?.masking?.value || '',
        },
        show_number_if_blocked: settingsData?.display_number?.show_number_if_blocked || 'NO',
      });
    }
    if (readRuleFlags(settingsData, 'business_hours').apply) {
      setValue('settings.operational_hours', settingsData?.operational_hours);
      const holidays =
        settingsData?.operational_hours?.holidays &&
        settingsData?.operational_hours?.holidays?.length
          ? getHolidaysFormVal(settingsData?.operational_hours?.holidays)
          : [];
      setValue('settings.operational_hours.holidays', holidays);
      setValue('settings.operational_hours.closed_hour_action', {
        type: {
          label: settingsData?.operational_hours?.closed_hour_action?.type_label || '',
          value: settingsData?.operational_hours?.closed_hour_action?.type || '',
        },
        value: {
          label: settingsData?.operational_hours?.closed_hour_action?.value_label || '',
          value: settingsData?.operational_hours?.closed_hour_action?.value || '',
        },
        enabled: settingsData?.operational_hours?.closed_hour_action?.enabled,
        personal: settingsData?.operational_hours?.closed_hour_action?.personal,
      });
    }
    if (readRuleFlags(settingsData, 'voicemail').apply) {
      setValue('settings.voicemail_pin', settingsData?.voicemail_pin);
    }
    if (readRuleFlags(settingsData, 'recording').apply) {
      setValue('settings.recording', settingsData?.recording);
    }
    if (readRuleFlags(settingsData, 'transcription').apply) {
      setValue('settings.transcription', settingsData?.transcription?.enabled || false);
    }
    if (readRuleFlags(settingsData, 'ai_call_monitoring').apply) {
      setValue('settings.ai_call_monitoring', settingsData?.ai_call_monitoring?.enabled || false);
    }
  };

  /* The greetings record has the same one-flag-two-meanings problem as the settings
     record, so it gets the same treatment. Paths are given with the trailing
     `.override` because that is literally where the old flag sits, and because the
     bare name `voicemail` is already a settings rule pointing at `voicemail_pin` —
     spelling the path out keeps the greeting's own flag from being read from there. */
  const setGreetingsData = (greetingsData: any) => {
    const welcomeGreetingKey = greetingsData?.welcome_greeting ? 'welcome_greeting' : 'welcome';
    const onHoldMusicKey = greetingsData?.on_hold_music ? 'on_hold_music' : 'hold';
    const welcomeGreetingData = greetingsData?.welcome_greeting || greetingsData?.welcome;
    const onHoldMusicData = greetingsData?.on_hold_music || greetingsData?.hold;

    if (readRuleFlags(greetingsData, `${welcomeGreetingKey}.override`).apply) {
      setValue('greetings.welcome_greeting', {
        enabled: welcomeGreetingData?.enabled || false,
        value: {
          label: welcomeGreetingData?.label || 'Select',
          value: welcomeGreetingData?.value || '',
        },
      });
    }
    if (readRuleFlags(greetingsData, 'voicemail.override').apply) {
      setValue('greetings.voicemail', {
        enabled: greetingsData?.voicemail?.enabled || false,
        value: {
          label: greetingsData?.voicemail?.label || 'Select',
          value: greetingsData?.voicemail?.value || '',
        },
      });
    }
    if (readRuleFlags(greetingsData, 'ring_tone.override').apply) {
      setValue('greetings.ring_tone', {
        enabled: greetingsData?.ring_tone?.enabled || false,
        value: {
          label: greetingsData?.ring_tone?.label || 'Select',
          value: greetingsData?.ring_tone?.value || '',
        },
      });
    }
    if (readRuleFlags(greetingsData, `${onHoldMusicKey}.override`).apply) {
      setValue('greetings.on_hold_music', {
        enabled: onHoldMusicData?.enabled || false,
        value: {
          label: onHoldMusicData?.label || 'Select',
          value: onHoldMusicData?.value || '',
        },
      });
    }
  };

  return (
    <FormProvider {...formInstance}>
      <form onSubmit={formInstance.handleSubmit(onSubmit)} className="mcm-page mcm-userform h-full">
        {isFetched ? (
          <>
            <Tabs
              value={activeTab}
              onValueChange={handleTabChange}
              className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
            >
              {/* Who you are editing, held above the steps so it stays visible
                  while you move through them. */}
              <div className="mcm-personhead">
                <CustomAvatar
                  name={`${data?.first_name || ''} ${data?.last_name || ''}`.trim()}
                  image={data?.profile}
                  size="42"
                />
                <div style={{ minWidth: 0 }}>
                  <div className="mcm-personhead-name">
                    {`${data?.first_name || ''} ${data?.last_name || ''}`.trim() || 'Person'}
                  </div>
                  <div className="mcm-personhead-meta">
                    {data?.extension ? <span className="tag neu">Ext {data.extension}</span> : null}
                    {data?.custom_role_data?.name || data?.role_data?.name || data?.role ? (
                      <span className="tag acc">
                        {roleDisplayName(
                          data?.custom_role_data?.name || data?.role_data?.name || data?.role,
                        )}
                      </span>
                    ) : null}
                    {data?.email ? <span className="mcm-field-note">{data.email}</span> : null}
                  </div>
                </div>
              </div>

              <TabsList className="mcm-steps" asChild>
                <div>
                  {TABS_ORDER.map((value, index) => {
                    const hasError = Boolean((errors as any)[ERROR_TYPES[value]]);
                    const isDone = index < TABS_ORDER.indexOf(activeTab);
                    return (
                      <TabsTrigger
                        key={value}
                        value={value}
                        className={`mcm-step${value === activeTab ? ' on' : ''}${
                          isDone ? ' done' : ''
                        }${hasError ? ' err' : ''}`}
                      >
                        <span className="mcm-step-n">{isDone && !hasError ? '✓' : index + 1}</span>
                        <span className="mcm-step-label">{value}</span>
                        {hasError && <ErrorTooltip text={ERROR_TYPES_MESSAGES[value]} />}
                      </TabsTrigger>
                    );
                  })}
                </div>
              </TabsList>

              <TabsContent
                value={FORWARDING_TAB_CONSTANT.BASIC_INFORMATION}
                className="mcm-userform-body"
              >
                <BasicInformation {...{ chooseTemplate, setChooseTemplate }} customClass="h-full" />
              </TabsContent>
              <TabsContent
                value={FORWARDING_TAB_CONSTANT.SETTING_PERMISSIONS}
                className="mcm-userform-body"
              >
                <CommonSettingPermission
                  {...{
                    chooseTemplate,
                    setChooseTemplate,
                    IS_ADMIN,
                    data,
                    origin: 'user_extension',
                    company_info,
                    isShowRole: true,
                    // isShowVoicemail: true,
                    /* Only here. This editor is shared with numbers, departments,
                       phone menus and queues, and "may this person call abroad"
                       is a question only a person can answer. The answer is
                       carried through on save by `restSettings` in `onSubmit`,
                       the same way every other key this form does not own is. */
                    isShowInternationalCalling: true,
                    isAdminAccount,
                  }}
                  customClass="h-full mcm-settings"
                />
              </TabsContent>
              <TabsContent
                value={FORWARDING_TAB_CONSTANT.GREETING_NOTIFICATION}
                className="mcm-userform-body"
              >
                <GreetingNotification customClass="h-full" />
              </TabsContent>
              <TabsContent value={FORWARDING_TAB_CONSTANT.CALL_RULES} className="mcm-userform-body">
                <CallRules {...{ UUID: data?.uuid, userData: data }} customClass="h-full" />
              </TabsContent>
            </Tabs>
            <div className="mcm-formfoot">
              <span className="mcm-formfoot-hint">
                Step {TABS_ORDER.indexOf(activeTab) + 1} of {TABS_ORDER.length} · {activeTab}
              </span>
              <button type="button" className="btn ghost" onClick={() => setDrawerState(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={handlePrev}
                disabled={activeTab === TABS_ORDER[0]}
              >
                Back
              </button>
              {activeTab !== TABS_ORDER[TABS_ORDER.length - 1] && (
                <button type="button" className="btn" onClick={handleNext}>
                  Next
                </button>
              )}
              {/* Saving is reachable from every step, not just the last one:
                  most edits touch one step, and walking the whole wizard to
                  commit them was the slow part. `handleSaveNow` validates the
                  steps you haven't visited before committing, so an early save
                  can't push through data a later step would have rejected. */}
              <button
                type="button"
                className="btn primary"
                onClick={handleSaveNow}
                disabled={isPendingUpdateMember}
              >
                {isPendingUpdateMember ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col justify-center items-center gap-2 h-[calc(100%_-_45px)] w-full mx-auto">
            <Loader variant="blue" />
          </div>
        )}
      </form>
    </FormProvider>
  );
};

export default UpdateForwarding;
