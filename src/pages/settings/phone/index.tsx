import CallRules from '@/pages/admin-settings/people/update-forwarding/call-rules';
import { getUserDetails, updateUserSettings } from '@/services/api';
import { yupResolver } from '@hookform/resolvers/yup';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import '@/components/mcm/mcm-page.css';
import { phoneSettingsSchema } from './schema';
import { handleAlert } from '@/lib/utils';
import { RING_TYPE_LABELS, RINGING_OPTIONS } from '@/constants/forwarding-consts';
import { Button } from '@/components/ui/button';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import { mergeCallForwarding } from '@/lib/call-forwarding-record';
import '@/components/mcm/mcm-page.css';

const IncomingCalls = () => {
  const [schemaContext, setSchemaContext] = useState(null);
  const queryClient: any = useQueryClient();
  const { data: userDetails } = useQuery({
    queryKey: ['userInfoForPhoneSettings'],
    queryFn: getUserDetails,
    select: (data) => data?.data?.data?.result || [],
  });
  const methods = useForm<any>({
    mode: 'all',
    defaultValues: { CallRules },
    resolver: yupResolver(phoneSettingsSchema),
    context: { schemaContext },
  });

  const { setValue, watch } = methods;

  useEffect(() => {
    const subscription = watch((value) => {
      setSchemaContext(value);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  const { handleSubmit } = methods;

  const { mutate: mutateUpdateMember, isPending: isPendingUpdateMember } = useMutation({
    mutationFn: updateUserSettings,
    onSuccess: (data) => {
      queryClient.invalidateQueries(['userInfoForPhoneSettings', 'getUsersDetails'], {
        exact: true,
      });
      invalidateGlobalUsersDirectory(queryClient);
      handleAlert({
        text: data?.data?.message || 'Settings updated successfully!',
        type: 'success',
      });
    },
  });

  const onSubmit = () => {
    const callRules = watch('callRules');
    const settings =
      typeof userDetails?.settings === 'string'
        ? JSON.parse(userDetails?.settings || '{}')
        : userDetails?.settings;

    const is24Hours = settings?.operational_hours?.type === '24_hours';
    const deviceOptionsSorted = Object.entries(callRules?.incomingCall?.deviceOptions || {})
      .map(([key, value]) => ({ key, ...(value as { order: number }) }))
      .sort((a, b) => a.order - b.order);

    const selectedUser = {
      name: `${userDetails?.user_info?.first_name}${userDetails?.user_info?.last_name ? ` ${userDetails?.user_info?.last_name}` : ''}`,
      extension: userDetails?.user_info?.extension || '',
    };
    const callRuleRequest = {
      forward_calls: {
        enabled: callRules?.forwardCall?.enabled,
        type: callRules?.forwardCall?.type?.value,
        type_label: callRules?.forwardCall?.type?.label,
        value_label: callRules?.forwardCall?.value?.label || 'Select',
        value:
          callRules?.forwardCall?.type?.value === 'VOICEMAIL' && callRules?.forwardCall?.personal
            ? selectedUser?.extension
            : callRules?.forwardCall?.value?.value,
        name:
          callRules?.forwardCall?.type?.value === 'VOICEMAIL' && callRules?.forwardCall?.personal
            ? selectedUser?.name
            : callRules?.forwardCall?.value?.name || selectedUser?.name,
        personal: callRules?.forwardCall?.personal,
      },
      /* No `status` here. Presence is not edited on this screen, and it used to
         be posted anyway - to the record and to update-status, which moves the
         person's queue rows to On Break whenever the stored status is not
         "online". Saving a ring time could log an agent out of their queues.
         The stored presence is carried through untouched by the merge below. */
      incoming_calls: {
        enabled: callRules?.incomingCall?.enabled,
        device_options: transformPayloadNew(deviceOptionsSorted),
        type: callRules?.incomingCall?.deviceOptionValue?.value,
        failure_action: {
          enabled: true,
          type: callRules?.failureAction?.type?.value,
          type_label: callRules?.failureAction?.type?.label,
          value_label: callRules?.failureAction?.value?.label || 'Select',
          value:
            callRules?.failureAction?.type?.value === 'VOICEMAIL' &&
            callRules?.failureAction?.personal
              ? selectedUser?.extension || ''
              : callRules?.failureAction?.value?.value,
          name:
            callRules?.failureAction?.type?.value === 'VOICEMAIL' &&
            callRules?.failureAction?.personal
              ? selectedUser?.name
              : callRules?.failureAction?.value?.name || selectedUser?.name,
          personal: callRules?.failureAction?.personal,
        },
        ...(!is24Hours && {
          closed_hour_action: {
            enabled: true,
            type: callRules?.closedHoursAction?.type?.value,
            type_label: callRules?.closedHoursAction?.type?.label,
            value_label: callRules?.closedHoursAction?.value?.label || 'Select',
            value:
              callRules?.closedHoursAction?.type?.value === 'VOICEMAIL' &&
              callRules?.closedHoursAction?.personal
                ? selectedUser?.extension || ''
                : callRules?.closedHoursAction?.value?.value,
            name:
              callRules?.closedHoursAction?.type?.value === 'VOICEMAIL' &&
              callRules?.closedHoursAction?.personal
                ? selectedUser?.name
                : callRules?.closedHoursAction?.value?.name || selectedUser?.name,
            personal: callRules?.closedHoursAction?.personal,
          },
        }),
      },
      outgoing_calls: {
        enabled: callRules?.outgoingCall?.enabled,
        default_caller_id: callRules?.outgoingCall?.defaultCallerId?.value || '',
        default_fax_id: callRules?.outgoingCall?.defaultFaxId,
        default_text_id: callRules?.outgoingCall?.defaultTextId,
        ring_out: callRules?.outgoingCall?.ringOut,
        region: callRules?.outgoingCall?.region,
      },
    };
    /* Only the keys above belong to this screen. Everything else already on the
       record — the person's do-not-disturb among them — is carried through, so
       saving here does not delete what another screen owns. */
    const payload = {
      value: mergeCallForwarding(userDetails?.call_forwarding, callRuleRequest),
      key: 'call_forwarding',
    };

    mutateUpdateMember(payload);
  };

  function transformPayloadNew(res: any) {
    return res.map((item: any) => ({
      type: item?.type || 'web',
      status: item.status ?? false,
      label: item.value.label || '',
      value:
        item?.key === 'web' ? userDetails?.user_info?.extension || '' : item.option?.value || '',
      name:
        item?.key === 'web'
          ? `${userDetails?.user_info?.first_name}${userDetails?.user_info?.last_name ? ` ${userDetails?.user_info?.last_name}` : ''}` ||
            ''
          : item.option?.label || '',
      timeout: item.value.value,
    }));
  }

  useEffect(() => {
    if (userDetails?.call_forwarding) {
      const callHandlingData =
        typeof userDetails?.call_forwarding === 'string'
          ? JSON.parse(userDetails?.call_forwarding || '{}')
          : userDetails?.call_forwarding;
      const { incoming_calls = {}, outgoing_calls = {}, forward_calls = {} } = callHandlingData;

      const deviceOptionsArray = incoming_calls?.device_options || [];

      const deviceOptionsObject: any = {};

      if (deviceOptionsArray.length > 0) {
        deviceOptionsArray.forEach((item: any) => {
          const type = item?.type || 'web';
          const typeKey =
            userDetails?.user_info?.extension !== item?.value ? item?.name || 'web' : type;

          deviceOptionsObject[typeKey] = {
            status: item?.status,
            isDefault: item?.isDefault,
            type,
            value: {
              label: item?.label,
              value: item?.timeout,
            },
            option: {
              label: item?.name,
              value: item?.value,
            },
          };
        });

        if (!deviceOptionsObject.mobile) {
          deviceOptionsObject.mobile = {
            status: true,
            value: RINGING_OPTIONS?.[0],
            type: 'mobile',
            option: {
              label: `${userDetails?.user_info?.first_name}${userDetails?.user_info?.last_name ? ` ${userDetails?.user_info?.last_name}` : ''}`,
              value: userDetails?.user_info?.extension || '',
            },
          };
        }

        if (!deviceOptionsObject.pstn) {
          deviceOptionsObject.pstn = {
            status: true,
            value: RINGING_OPTIONS?.[0],
            type: 'pstn',
            option: {
              label: `${userDetails?.user_info?.first_name}${userDetails?.user_info?.last_name ? ` ${userDetails?.user_info?.last_name}` : ''}`,
              value: userDetails?.user_info?.extension || '',
            },
          };
        }
      } else {
        deviceOptionsObject.web = {
          status: true,
          value: RINGING_OPTIONS?.[0],
          type: 'web',
          option: {
            label: `${userDetails?.user_info?.first_name}${userDetails?.user_info?.last_name ? ` ${userDetails?.user_info?.last_name}` : ''}`,
            value: userDetails?.user_info?.extension || '',
          },
        };

        deviceOptionsObject.mobile = {
          status: true,
          value: RINGING_OPTIONS?.[0],
          type: 'mobile',
          option: {
            label: `${userDetails?.user_info?.first_name}${userDetails?.user_info?.last_name ? ` ${userDetails?.user_info?.last_name}` : ''}`,
            value: userDetails?.user_info?.extension || '',
          },
        };

        deviceOptionsObject.pstn = {
          status: true,
          value: RINGING_OPTIONS?.[0],
          type: 'pstn',
          option: {
            label: `${userDetails?.user_info?.first_name}${userDetails?.user_info?.last_name ? ` ${userDetails?.user_info?.last_name}` : ''}`,
            value: userDetails?.user_info?.extension || '',
          },
        };
      }

      setValue('callRules.forwardCall', {
        enabled: forward_calls?.enabled || false,
        type: {
          label: forward_calls?.type_label || 'Send to Voicemail',
          value: forward_calls?.type || 'VOICEMAIL',
        },
        value: {
          label: forward_calls?.value_label || 'Select',
          value: forward_calls?.value || userDetails?.user_info?.extension,
        },
        personal: forward_calls?.personal ?? true,
      });

      setValue('callRules.incomingCall', {
        enabled: true,
        deviceOptions: deviceOptionsObject,
        deviceOptionValue: {
          label: RING_TYPE_LABELS[incoming_calls?.type as keyof typeof RING_TYPE_LABELS],
          value: incoming_calls?.type || 'sequential',
        },
        type: 'number',
        number: '',
        name: '',
        extension: Object.keys(deviceOptionsObject)
          .filter(
            (key: any) =>
              deviceOptionsObject?.[key]?.option?.value !== userDetails?.user_info?.extension,
          )
          .map((key: any) => ({
            label: deviceOptionsObject?.[key]?.option?.label || '',
            value: deviceOptionsObject?.[key]?.option?.value || '',
          })),
      });

      setValue('basic.extension', userDetails?.user_info?.extension);
      setValue('callRules.outgoingCall', {
        enabled: outgoing_calls?.enabled || false,
        defaultCallerId: {
          label: outgoing_calls?.default_caller_id
            ? callHandlingData?.outgoing_calls?.default_caller_id.startsWith('+')
              ? `${callHandlingData?.outgoing_calls?.default_caller_id}`
              : `+${callHandlingData?.outgoing_calls?.default_caller_id}`
            : '',
          value: outgoing_calls?.default_caller_id || '',
        },
        defaultFaxId: outgoing_calls?.default_fax_id || '',
        defaultTextId: outgoing_calls?.default_text_id || '',
        ringOut: outgoing_calls?.ring_out || false,
        region: outgoing_calls?.region || '',
      });

      setValue('callRules.failureAction', {
        enabled: incoming_calls?.failure_action?.enabled || false,
        type: {
          label: incoming_calls?.failure_action?.type_label || 'Send to Voicemail',
          value: incoming_calls?.failure_action?.type || 'VOICEMAIL',
        },
        value: {
          label: incoming_calls?.failure_action?.value_label || 'Select',
          value: incoming_calls?.failure_action?.value || userDetails?.user_info?.extension,
        },
        personal: incoming_calls?.failure_action?.personal ?? true,
      });

      setValue('callRules.closedHoursAction', {
        enabled: incoming_calls?.closed_hour_action?.enabled || false,
        type: {
          label: incoming_calls?.closed_hour_action?.type_label || 'Send to Voicemail',
          value: incoming_calls?.closed_hour_action?.type || 'VOICEMAIL',
        },
        value: {
          label: incoming_calls?.closed_hour_action?.value_label || 'Select',
          value: incoming_calls?.closed_hour_action?.value || '',
        },
        personal: incoming_calls?.closed_hour_action?.personal ?? true,
      });
    } else {
      const fallbackLabel = `${userDetails?.user_info?.first_name}${userDetails?.user_info?.last_name ? ` ${userDetails?.user_info?.last_name}` : ''}`;
      const fallbackValue = userDetails?.user_info?.extension;

      setValue('callRules.incomingCall', {
        enabled: true,
        deviceOptions: {
          web: {
            status: true,
            value: RINGING_OPTIONS?.[0],
            option: {
              label: fallbackLabel || '',
              value: fallbackValue || '',
            },
          },
        },
        deviceOptionValue: {
          label: RING_TYPE_LABELS?.sequential,
          value: 'sequential',
        },
        type: 'number',
        number: '',
        name: '',
        extension: [],
      });

      setValue('callRules.failureAction.value', {
        label: fallbackLabel,
        value: fallbackValue,
      });
      setValue('callRules.failureAction.type', { label: 'Send to Voicemail', value: 'VOICEMAIL' });
      setValue('callRules.failureAction.personal', true);
      setValue('callRules.forwardCall.value', {
        label: fallbackLabel,
        value: fallbackValue,
      });
      setValue('callRules.forwardCall.type', { label: 'Send to Voicemail', value: 'VOICEMAIL' });
    }
  }, [userDetails]);

  useEffect(() => {
    const subscription = watch((value) => {
      setSchemaContext(value);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  return (
    <section className="mcm-adminpage mcm-phone">
      {/* The same head as every other Admin screen; this one was hand-rolled
          and carried no eyebrow. */}
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">My account</div>
          <h1>My Phone</h1>
          <p>
            How calls reach you: your devices, forwarding rules and what happens when you do not
            answer.
          </p>
        </div>
      </div>
      <FormProvider {...methods}>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mcm-phone-form"
        >
          {/* What the switch reads from this page, as of the patch of 3 Sep
              2026 (proven by offline tests and by reading the running switch,
              not yet by a real call), for a call dialled straight to the
              person's extension:
                - Forward All Calls (`call_forwarding.forward_calls`).
                - Do not disturb (`call_forwarding.dnd`). This page has no
                  switch for it - an admin sets it in the person's call rules
                  under People, and the summary below reports it.
                - Ring time: the person's own device timeout, and the shorter
                  of theirs and the company's wins.
                - What happens after ringing (`incoming_calls.failure_action`),
                  but only for a voicemail, extension or hang-up destination.
                - Default Caller ID, under Outgoing Calls.
              Still stored and not read: which devices are on and their ring
              order. The shared editor below carries no badge of its own, so
              the split is stated here, first. */}
          <div className="mcm-phone-scroll">
            <div className="mcm-callsummary" role="status">
              <span className="mcm-callsummary-l">What works today</span>
              <p>
                Forward All Calls, Do Not Disturb, your ring time and Default Caller ID are live for
                calls straight to you. What happens after ringing is live when it sends callers to
                voicemail, to an extension or hangs up; an outside number, a queue or a menu is
                saved but not followed after the ring. Which devices ring, and in what order, is
                saved, not applied yet. Do Not Disturb here means the one in your call rules: the
                DND status in your avatar menu does not stop calls. Calls through a queue or a menu
                follow that queue&rsquo;s or menu&rsquo;s own rules.
              </p>
            </div>
            <CallRules customClass="" />
          </div>
          <div className="mcm-phone-foot">
            <Button variant={'primary'} type="submit" disabled={isPendingUpdateMember}>
              {isPendingUpdateMember ? 'Please wait...' : 'Save call handling'}
            </Button>
          </div>
        </form>
      </FormProvider>
    </section>
  );
};

export default IncomingCalls;
