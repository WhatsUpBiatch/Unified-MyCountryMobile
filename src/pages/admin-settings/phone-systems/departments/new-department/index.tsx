import { Button } from '@/components/ui/button';
import { yupResolver } from '@hookform/resolvers/yup';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import * as yup from 'yup';
import DepartmentInfo from './department-info';
import {
  generateRandomExtension,
  getHolidaysFormVal,
  getHolidaysPayload,
  getObjectLength,
  handleAlert,
  parseJSON,
} from '@/lib/utils';
import { useUser } from '@/hooks/use-user';
import AddMembers from './add-members';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createDeparment } from '@/services/api';
import RingStrategy from './ring-strategy';
import {
  DEPARTMENT_DEFAULT_TIMEOUT,
  DEPARTMENT_DEFAULT_TIMEOUT_SECONDS,
  ERROR_TYPES,
  getDepartmentTimeoutOption,
  MEMBER_RING_STRATEGY_OPTIONS,
  readDepartmentTimeoutOption,
} from '../../../constants';
import { COMPANY_DEFAULTS_QUERY_KEY, fetchCompanyDefaults } from '@/lib/company-defaults';
import { requiredExtension } from '@/schema/common';
import { COMMON_SETTINGS_SCHEMA } from '@/components/common-settings/schema';
import { SETTINGS } from '@/components/common-settings/constants';
import CommonSettingPermission from '@/components/common-settings';
import Media from './media';
import { DEPARTMENT_ERROR_TYPES_MESSAGES, DEPARTMENT_TAB_CONSTANT } from './consts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ErrorTooltip from '@/components/custom/error-tooltip';
import { requiredString } from '@/lib/schema';
import { useGetSite } from '@/hooks/common';

const baseValueSchema = yup.object({
  label: yup.string(),
  value: yup.string(),
});

const conditionalMediaValue = yup.lazy((_, context) => {
  const { parent } = context as yup.ValidateOptions & { parent: { enabled: boolean } };

  if (parent?.enabled) {
    return yup.object({
      label: yup.string().required('Label is required'),
      value: yup.string().required('Value is required'),
    });
  }
  return baseValueSchema;
});

const validationSchema: Record<string, yup.AnyObjectSchema> = {
  [DEPARTMENT_TAB_CONSTANT.BASIC_INFORMATION]: yup.object().shape({
    name: requiredString('Name', 2, 50),
    extension: requiredExtension(),
    timeout: yup.object().shape({
      value: yup.string().required('Ring time is required'),
    }),
    site: yup.object().shape({
      value: yup.string().required('Location is required'),
    }),
    description: yup
      .string()
      .max(500, 'Description cannot be more than 500 characters')
      .optional()
      .nullable(),
    failover: yup
      .object()
      .shape({
        type: yup.object().shape({
          value: yup.string().required('Failover actions type is required'),
        }),
        value: yup.object().shape({
          value: yup.string().required('Failover actions value is required'),
        }),
      })
      .test('phone-length', 'Phone number must be at least 8 digits', function (obj) {
        const forwardType = obj?.type?.value;
        const forwardValue = obj?.value?.value;
        if (forwardType === 'PHONE' && forwardValue && forwardValue.replace(/\D/g, '').length < 8) {
          return this.createError({
            path: `${this.path}.value.value`,
            message: 'Phone number must be at least 8 digits',
          });
        }
        return true;
      }),
  }),

  [DEPARTMENT_TAB_CONSTANT.SETTING_PERMISSIONS]: COMMON_SETTINGS_SCHEMA,
  [DEPARTMENT_TAB_CONSTANT.ADD_MEMBER]: yup.object().shape({
    manager: yup.object({
      value: yup.string().trim().required('Manager is required'),
    }),
    members: yup
      .array()
      .of(
        yup.object({
          value: yup.string().trim().required('Person is required'),
        }),
      )
      .min(1, 'Add at least one person'),
  }),
  [DEPARTMENT_TAB_CONSTANT.RING_STRETEGY]: yup.object().shape({
    ring_strategy: yup.object().shape({
      value: yup.string().required('Ring Strategy is required'),
    }),
  }),
  [DEPARTMENT_TAB_CONSTANT.GREETING_NOTIFICATION]: yup.object().shape({
    media: yup.object({
      welcome: yup.object({
        enabled: yup.boolean().required(),
        value: conditionalMediaValue,
      }),
      hold: yup.object({
        enabled: yup.boolean().required(),
        value: conditionalMediaValue,
      }),
    }),
  }),
};

const TABS_ORDER = [
  DEPARTMENT_TAB_CONSTANT.BASIC_INFORMATION,
  DEPARTMENT_TAB_CONSTANT.SETTING_PERMISSIONS,
  DEPARTMENT_TAB_CONSTANT.ADD_MEMBER,
  DEPARTMENT_TAB_CONSTANT.RING_STRETEGY,
  DEPARTMENT_TAB_CONSTANT.GREETING_NOTIFICATION,
];

const NewDepartment = ({ rowData, setDrawerState, setTabData }: any) => {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { user_info } = user || {};
  const isEdit = getObjectLength(rowData);
  const [currentStep, setCurrentStep] = useState<string>(DEPARTMENT_TAB_CONSTANT.BASIC_INFORMATION);
  const [schemaContext, setSchemaContext] = useState<any>(null);
  const { forward_call_actions = {} } = rowData || {};
  const { data: dataSiteList, isLoading } = useGetSite();

  /* The company record, on the cache key every other company-level screen
     shares. Only ever used to start a brand new department off. */
  const { data: companyDefaults } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
    staleTime: 5 * 60 * 1000,
  });
  const greetingsInitialState = {
    welcome: {
      enabled: false,
      value: { label: '', value: '' },
    },
    hold: {
      enabled: false,
      value: { label: '', value: '' },
    },
  };

  const initialState = {
    name: '',
    description: '',
    extension: generateRandomExtension(),
    members: [],
    manager: {
      label: '',
      value: '',
    },
    ring_strategy: {
      label: 'Ring All',
      value: 'ring_all',
    },
    failover: {
      type: { label: 'Send to Voicemail', value: 'VOICEMAIL' },
      value: { label: 'Select', value: user_info?.extension },
      personal: true,
    },
    closed_hours: {
      type: { label: '', value: '' },
      value: { label: '', value: '' },
      personal: false,
    },
    timeout: DEPARTMENT_DEFAULT_TIMEOUT,
    media: greetingsInitialState,
    // callerId: {
    //   enabled: false,
    //   value: [],
    // },
    site: { label: user_info?.site_detail?.name, value: user_info?.site_uuid },
    ...SETTINGS,
  };

  const formInstance = useForm<any>({
    defaultValues: initialState,
    resolver: yupResolver(validationSchema[currentStep]),
    mode: 'onChange',
    context: { schemaContext },
  });
  const {
    handleSubmit,
    reset,
    watch,
    trigger,
    setValue,
    formState: { errors },
  } = formInstance;

  const handleTabChange = async (nextTab: string) => {
    const currentIndex = TABS_ORDER.indexOf(currentStep);
    const nextIndex = TABS_ORDER.indexOf(nextTab);

    if (nextIndex <= currentIndex) {
      setCurrentStep(nextTab);
      return;
    }
    const values = formInstance.getValues();

    for (let i = currentIndex; i < nextIndex; i++) {
      const tabKey = TABS_ORDER[i];
      const schema = validationSchema[tabKey];

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

    setCurrentStep(nextTab);
  };

  const handleNext = async () => {
    const currentIndex = TABS_ORDER.indexOf(currentStep);
    const isValid = await trigger();

    if (isValid && currentIndex < TABS_ORDER.length - 1) {
      setCurrentStep(TABS_ORDER[currentIndex + 1]);
    }
  };

  const handlePrev = () => {
    const currentIndex = TABS_ORDER.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(TABS_ORDER[currentIndex - 1]);
    }
  };

  const { mutate: createDepartmentMutate, isPending } = useMutation({
    mutationKey: ['createDepartment'],
    mutationFn: createDeparment,
    onSuccess: (data) => {
      handleAlert({
        text: data?.data?.data?.message,
        type: 'success',
      });
      setDrawerState(false);
      queryClient.invalidateQueries({ queryKey: ['getDepartmentList'] });
      setTabData(data?.data?.data?.result);
    },
  });

  useEffect(() => {
    const subscription = watch((value) => {
      setSchemaContext(value);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  /* Seeding the ring timeout of a department being created.
   *
   * The form's default values are fixed on the first render, and the company
   * record may not have arrived by then, so the company number is applied here
   * once it does. Three guards keep it from ever taking a decision away:
   *
   *   - editing is left alone entirely; a saved department already has a number,
   *   - it happens once, so a later refetch cannot walk over a choice made in
   *     the meantime,
   *   - and it only writes while the field still holds the shipped 10, which is
   *     the closest this field has to "nobody has chosen yet" — unlike a queue
   *     member, it is never empty.
   *
   * With no company ring time saved, `getDepartmentTimeoutOption` hands back the
   * very same default object the form already holds, so nothing is written and
   * the tenant sees no change at all. */
  const hasSeededTimeout = useRef(false);

  useEffect(() => {
    if (isEdit || hasSeededTimeout.current || !companyDefaults) return;

    const seeded = getDepartmentTimeoutOption(companyDefaults?.settings);
    hasSeededTimeout.current = true;

    if (Number(formInstance.getValues('timeout')?.value) !== DEPARTMENT_DEFAULT_TIMEOUT_SECONDS) {
      return;
    }
    if (Number(seeded?.value) === DEPARTMENT_DEFAULT_TIMEOUT_SECONDS) return;

    setValue('timeout', seeded, { shouldValidate: true });
  }, [companyDefaults, isEdit, formInstance, setValue]);

  const stepLookUp: any = {
    [DEPARTMENT_TAB_CONSTANT.BASIC_INFORMATION]: (
      <DepartmentInfo {...{ isEdit, dataSiteList, isLoading }} />
    ),
    [DEPARTMENT_TAB_CONSTANT.SETTING_PERMISSIONS]: (
      <CommonSettingPermission
        isChooseTemplate={false}
        data={{ settings: forward_call_actions }}
        customClass="h-full min-h-0"
        origin="department"
      />
    ),
    [DEPARTMENT_TAB_CONSTANT.ADD_MEMBER]: <AddMembers />,
    [DEPARTMENT_TAB_CONSTANT.RING_STRETEGY]: <RingStrategy />,
    [DEPARTMENT_TAB_CONSTANT.GREETING_NOTIFICATION]: <Media />,
  };

  const onSubmit = (data: any) => {
    const { site, timeout, failover, settings, media, ring_strategy, members, ...rest } =
      data || {};
    const uniqueMembers = members?.length
      ? Array.from(new Map(members.map((m: any) => [m.user_uuid, m])).values())
      : [];
    const payload = {
      site: JSON.stringify(site),
      forward_call_actions: {
        ring_strategy: ring_strategy?.value,
        operational_hours: {
          ...settings?.operational_hours,
          holidays: settings?.operational_hours?.holidays?.length
            ? getHolidaysPayload(settings?.operational_hours.holidays)
            : [],
          regional: settings?.operational_hours?.regional,
          closed_hour_action: {
            type: settings?.operational_hours?.closed_hour_action?.type?.value,
            value: settings?.operational_hours?.closed_hour_action?.value?.value,
            enabled: settings?.operational_hours?.closed_hour_action?.enabled,
            personal: settings?.operational_hours?.closed_hour_action?.personal,
            type_label: settings?.operational_hours?.closed_hour_action?.type?.label,
            value_label: settings?.operational_hours?.closed_hour_action?.value?.label,
          },
        },
        recording: settings?.recording,
        display_number: {
          incoming: settings?.display_number?.incoming,
          masking: {
            type: settings?.display_number?.masking?.type?.value || '',
            label: settings?.display_number?.masking?.type?.label || '',
            value: settings?.display_number?.masking?.value || '',
          },
        },
        call_handling: {
          timeout: timeout?.value,
          failover: {
            type: failover?.type?.value,
            value: failover?.value?.value,
            label: failover?.value?.label,
            name: failover?.value?.name,
          },
        },
        media: {
          welcome: {
            enabled: media?.welcome?.enabled,
            value: media?.welcome?.value?.value,
            label: media?.welcome?.value?.label,
          },
          hold: {
            enabled: media?.hold?.enabled,
            value: media?.hold?.value?.value,
            label: media?.hold?.value?.label,
          },
        },
        transcription: settings?.transcription,
        ai_call_monitoring: settings?.ai_call_monitoring,
      },
      members: uniqueMembers,
      // caller_id: JSON.stringify({
      //   enabled: callerId?.enabled,
      //   value: callerId?.value,
      // }),
      ...(isEdit && { uuid: rowData?.uuid }),
      ...rest,
    };
    createDepartmentMutate(payload);
  };

  useEffect(() => {
    if (isEdit) {
      const {
        name = '',
        site = '',
        description,
        forward_call_actions = {},
        // caller_id,
        members = '',
        manager = '',
        extension = '',
      } = rowData || {};
      const {
        operational_hours = {},
        media = {},
        call_handling = {},
        ring_strategy = '',
        recording = {},
        display_number = {},
        transcription = false,
        ai_call_monitoring = false,
      } = forward_call_actions || {};
      const parsedMembers = typeof members === 'string' ? parseJSON(members) : members;
      const uniqueMembers = Array.isArray(parsedMembers)
        ? Array.from(new Map(parsedMembers.map((m: any) => [m.user_uuid, m])).values())
        : [];
      reset({
        name,
        extension,
        site: {
          ...parseJSON(site),
        },
        description: description ?? '',
        /* A saved department keeps its own number, whatever it is. The company
           value is never applied here: this department already made a choice. */
        timeout: readDepartmentTimeoutOption(call_handling?.timeout),
        members: uniqueMembers,
        manager: typeof manager === 'string' ? parseJSON(manager) : manager,
        failover: {
          type: {
            label: call_handling?.failover?.type,
            value: call_handling?.failover?.type,
          },
          value: {
            label: call_handling?.failover?.label,
            value: call_handling?.failover?.value,
          },
          personal: false,
        },
        settings: {
          operational_hours: {
            ...operational_hours,
            holidays:
              operational_hours?.holidays && operational_hours?.holidays?.length
                ? getHolidaysFormVal(operational_hours?.holidays)
                : [],
            regional: operational_hours?.regional,
            closed_hour_action: {
              type: {
                label: operational_hours?.closed_hour_action?.type_label || '',
                value: operational_hours?.closed_hour_action?.type || '',
              },
              value: {
                label: operational_hours?.closed_hour_action?.value_label || '',
                value: operational_hours?.closed_hour_action?.value || '',
              },
              enabled: operational_hours?.closed_hour_action?.enabled,
              personal: operational_hours?.closed_hour_action?.personal,
            },
          },
          recording,
          display_number: {
            incoming: display_number?.incoming,
            masking: {
              type: {
                label: display_number?.masking?.label,
                value: display_number?.masking?.type || 'N',
              },
              value: display_number?.masking?.value || '',
            },
          },
          transcription: transcription,
          ai_call_monitoring: ai_call_monitoring,
        },
        media: Object.fromEntries(
          Object.entries(media).map(([key, val]: any) => [
            key,
            {
              enabled: val?.enabled,
              value: { value: val?.value, label: val?.label },
            },
          ]),
        ),

        // callerId: {
        //   ...parseJSON(caller_id),
        // },
        ring_strategy: MEMBER_RING_STRATEGY_OPTIONS.find(({ value }) => value === ring_strategy),
      });
    } else {
      const obj = {
        label: user_info?.site_detail?.name,
        value: user_info?.site_uuid,
      };
      setValue('site', obj);
      setValue('settings.operational_hours.regional', user?.settings?.operational_hours?.regional);
    }
  }, [rowData, isEdit, user_info]);
  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-col justify-between gap-3 pt-2 sm:pt-3">
        {!isEdit && (
          <span className="text-sm leading-5 text-gray-700">
            Create a department to organize your company’s workflow. This allows you to route calls
            to specific teams (e.g., Support or Billing) and assign multiple users to a single
            extension so they can handle incoming calls together.
          </span>
        )}
        <Tabs
          value={currentStep}
          onValueChange={handleTabChange}
          className="flex w-full flex-col overflow-x-hidden overflow-y-hidden"
        >
          <div className="w-full overflow-x-auto overflow-y-hidden border-b border-gray-200">
            <TabsList className="flex min-w-max min-h-12 items-stretch overflow-y-hidden rounded-none bg-transparent p-0 text-center text-sm font-semibold">
              {Object.entries(DEPARTMENT_TAB_CONSTANT).map(([key, value]) => (
                <TabsTrigger
                  className="relative flex h-full shrink-0 items-center gap-1 rounded-none border-b-2 bg-transparent px-4 py-3 text-sm font-semibold text-gray-700 data-[state=active]:border-b-2 data-[state=active]:border-b-primary data-[state=active]:text-primary data-[state=active]:shadow-2xs sm:px-6 focus-visible:outline-0 focus-visible:ring-0 focus-visible:border-0 "
                  key={key}
                  value={value}
                >
                  {value}{' '}
                  {(errors as any)[ERROR_TYPES[value]] && (
                    <div className="flex justify-end">
                      <ErrorTooltip text={DEPARTMENT_ERROR_TYPES_MESSAGES[value]} />
                    </div>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <FormProvider {...formInstance}>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex h-full min-h-0 w-full flex-col justify-between gap-4"
          >
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">{stepLookUp?.[currentStep]}</div>
            <div className="border-t border-gray-200 pt-2 sm:pt-3">
              <div className="hidden items-center justify-between gap-2 lg:flex">
                <Button variant={'transparent'} type="button" onClick={() => setDrawerState(false)}>
                  Cancel
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant={'outline'}
                    type="button"
                    onClick={handlePrev}
                    disabled={currentStep === TABS_ORDER[0]}
                  >
                    Prev
                  </Button>
                  {currentStep !== DEPARTMENT_TAB_CONSTANT.GREETING_NOTIFICATION && (
                    <Button variant={'outline'} type="button" onClick={handleNext}>
                      Next
                    </Button>
                  )}
                  {currentStep === DEPARTMENT_TAB_CONSTANT.GREETING_NOTIFICATION && (
                    <Button variant={'primary'} type="submit" disabled={isPending}>
                      {isPending ? 'Submiting...' : 'Submit'}
                    </Button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto overflow-y-hidden pb-1 lg:hidden">
                <div className="flex min-w-max items-center gap-2">
                  <Button
                    variant={'transparent'}
                    type="button"
                    onClick={() => setDrawerState(false)}
                    className="shrink-0"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant={'outline'}
                    type="button"
                    onClick={handlePrev}
                    disabled={currentStep === TABS_ORDER[0]}
                    className="shrink-0"
                  >
                    Prev
                  </Button>
                  {currentStep !== DEPARTMENT_TAB_CONSTANT.GREETING_NOTIFICATION && (
                    <Button
                      variant={'outline'}
                      type="button"
                      onClick={handleNext}
                      className="shrink-0"
                    >
                      Next
                    </Button>
                  )}
                  {currentStep === DEPARTMENT_TAB_CONSTANT.GREETING_NOTIFICATION && (
                    <Button
                      variant={'primary'}
                      type="submit"
                      disabled={isPending}
                      className="shrink-0"
                    >
                      {isPending ? 'Submiting...' : 'Submit'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </form>
        </FormProvider>
      </div>
    </>
  );
};

export default NewDepartment;
