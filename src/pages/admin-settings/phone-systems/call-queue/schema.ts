import { requiredExtension } from '@/schema/common';
import * as yup from 'yup';
import {
  CALL_QUEUE_INIITAL_VALUES,
  MAX_WAITING_CALLERS_LIMITS,
  QUEUE_TIMEOUT_LIMITS,
} from './constant';
import { optionalString } from '@/lib/schema';
import { checkQueueName } from '@/lib/queue-naming';
import { holidaySchema } from '../../constants';
import { FORWARD_TYPES } from '@/constants/forwarding-consts';

export const upsertCallQueueSchema = [
  yup.object().shape({
    /* Judged on the stored name, which carries the "Inbound - " prefix. A
       plain max here would measure what was typed and then store ten more
       characters than it allowed. */
    name: yup
      .string()
      .required('Name is required')
      .test('queue-name', function (value) {
        const result = checkQueueName(value);
        return result.ok || this.createError({ message: result.reason });
      }),
    extension: requiredExtension(),
    script_data: optionalString('Description', 10, 500),
    site_uuid: yup.mixed().required('Site is required'),
    description: yup
      .string()
      .max(500, 'Description cannot exceed 500 characters')
      .optional()
      .nullable(),
    script: yup
      .object()
      .shape({
        label: yup.string().optional().nullable(),
        value: yup.string().optional().nullable(),
      })
      .nullable()
      .when('script_enabled', {
        is: true,
        then: (schema) =>
          schema.test(
            'script-value-required',
            'Call script is required',
            (val: any) =>
              val !== null &&
              val !== undefined &&
              typeof val?.value === 'string' &&
              val.value.trim().length > 0,
          ),
        otherwise: (schema) => schema.optional().nullable(),
      }),
    settings: yup.object().shape({
      ring_strategy: yup.object().shape({
        max_wait_time: yup.object().shape({
          queue_timeout: yup
            .number()
            .required('Queue timeout is required')
            .min(
              QUEUE_TIMEOUT_LIMITS.min,
              `Queue timeout must be at least ${QUEUE_TIMEOUT_LIMITS.min} seconds`,
            )
            .max(
              QUEUE_TIMEOUT_LIMITS.max,
              `Queue timeout must be ${QUEUE_TIMEOUT_LIMITS.max} seconds (300 minutes) or less`,
            )
            .typeError('Queue timeout must be a number'),
          callers: yup.object().shape({
            /* Was `mixed().required()`, which accepted anything truthy. Now that
               this is a free number field rather than a list of 3 to 30, the
               range has to be checked here or nothing checks it. */
            value: yup
              .number()
              .required('Max waiting callers is required')
              .min(
                MAX_WAITING_CALLERS_LIMITS.min,
                `At least ${MAX_WAITING_CALLERS_LIMITS.min} caller must be able to wait`,
              )
              .max(
                MAX_WAITING_CALLERS_LIMITS.max,
                `Max waiting callers cannot be more than ${MAX_WAITING_CALLERS_LIMITS.max}`,
              )
              .typeError('Max waiting callers must be a number'),
          }),
          after_max_wait_time: yup
            .object()
            .shape({
              type: yup.object().shape({
                value: yup.string().required('Timeout forward type is required'),
              }),
              value: yup.object().shape({
                value: yup.string().required('Timeout forward value is required'),
              }),
            })
            .test('phone-length', 'Phone number must be at least 8 digits', function (obj) {
              const forwardType = obj?.type?.value;
              const forwardValue = obj?.value?.value;
              if (
                forwardType === 'PHONE' &&
                forwardValue &&
                forwardValue.replace(/\D/g, '').length < 8
              ) {
                return this.createError({
                  path: `${this.path}.value.value`,
                  message: 'Phone number must be at least 8 digits',
                });
              }
              return true;
            }),
        }),
      }),
    }),
  }),
  yup.object().shape({
    settings: yup.object().shape({
      operational_hours: yup.object().shape({
        type: yup.string().required(),
        value: yup.mixed(),
        holidays: yup.array().of(holidaySchema),
        closed_hour_action: yup.object().shape({
          value: yup.object().shape({
            value: yup.string().when(['$schemaContext', '$activeTab'], {
              is: (schema: any) => {
                const isWeekly = schema?.settings?.operational_hours?.type === 'weekly';
                if (!isWeekly) return false;
                const closedHoursAction = schema?.settings?.operational_hours?.closed_hour_action;
                const forwardType = closedHoursAction?.type?.value;
                if (forwardType === FORWARD_TYPES.VOICEMAIL) return !closedHoursAction?.personal;
                if (forwardType === 'HANGUP') return false;
                return true;
              },
              then: (schema) =>
                schema
                  .required('Forward value is required')
                  .test('phone-length', 'Phone number must be at least 8 digits', function (value) {
                    const schemaContext = this.options.context?.schemaContext;
                    const closedHoursAction =
                      schemaContext?.settings?.operational_hours?.closed_hour_action;
                    const forwardType = closedHoursAction?.type?.value;
                    if (forwardType === 'PHONE' && value && value.replace(/\D/g, '').length < 8) {
                      return false;
                    }
                    return true;
                  }),
              otherwise: (schema) => schema.notRequired(),
            }),
          }),
        }),
        regional: yup.object().shape({
          override: yup.boolean(),
          country_code: yup.object().shape({
            value: yup.string().required('Country code is required'),
          }),
          timezone: yup.object().shape({
            value: yup.string().required('Timezone is required'),
          }),
          country: yup.object().shape({
            value: yup.string().required('Country is required'),
          }),
        }),
      }),
    }),
  }),
  yup.object().shape({
    settings: yup.object().shape({
      wrapup_time: yup
        .number()
        .required('Wrapup time is required')
        .min(0, 'Wrapup time must be greater than or equal to 0')
        .max(3600, 'Wrapup time must be less than or equal to 3600')
        .typeError('Wrapup time must be a number'),
    }),
    script: yup
      .object()
      .shape({
        label: yup.string().optional().nullable(),
        value: yup.string().optional().nullable(),
      })
      .nullable()
      .when('script_enabled', {
        is: true,
        then: (schema) =>
          schema.test(
            'script-value-required',
            'Call script is required',
            (val: any) =>
              val !== null &&
              val !== undefined &&
              typeof val?.value === 'string' &&
              val.value.trim().length > 0,
          ),
        otherwise: (schema) => schema.optional().nullable(),
      }),
    agentDisposition: yup
      .array()
      .of(
        yup.object().shape({
          _id: yup.string().required('Key is required'),
          disposition: yup.object().shape({
            name: yup.string().required('Name is required'),
          }),
        }),
      )
      .min(1, 'Agent disposition is required')
      .required('Agent disposition is required'),
  }),
  yup.object().shape({
    greetings: yup.object().shape({
      welcome: yup.object().shape({
        value: yup.object().shape({
          value: yup.string().when('$schemaContext', {
            is: (schema: typeof CALL_QUEUE_INIITAL_VALUES) => schema?.greetings?.welcome?.enabled,
            then: () => yup.string().required('Welcome greeting is required'),
            otherwise: () => yup.string().notRequired(),
          }),
        }),
      }),
      waiting: yup.object().shape({
        value: yup
          .object()
          .nullable()
          .test(
            'waiting-value-required',
            'Waiting greeting is required',
            (val: any) =>
              val !== null &&
              val !== undefined &&
              typeof val?.value === 'string' &&
              val.value.trim().length > 0,
          ),
      }),
      ring_tone: yup.object().shape({
        value: yup.object().shape({
          value: yup.string().when('$schemaContext', {
            is: (schema: typeof CALL_QUEUE_INIITAL_VALUES) => schema?.greetings?.ring_tone?.enabled,
            then: () => yup.string().required('Ringtone message is required'),
            otherwise: () => yup.string().notRequired(),
          }),
        }),
      }),
      hold: yup.object().shape({
        value: yup.object().shape({
          value: yup.string().when('$schemaContext', {
            is: (schema: typeof CALL_QUEUE_INIITAL_VALUES) => schema?.greetings?.hold?.enabled,
            then: () => yup.string().required('On hold music is required'),
            otherwise: () => yup.string().notRequired(),
          }),
        }),
      }),
      no_agent_available: yup.object().shape({
        value: yup.object().shape({
          value: yup.string().when('$schemaContext', {
            is: (schema: typeof CALL_QUEUE_INIITAL_VALUES) =>
              schema?.greetings?.no_agent_available?.enabled,
            then: () => yup.string().required('No agent available is required'),
            otherwise: () => yup.string().notRequired(),
          }),
        }),
      }),
      all_agent_busy: yup.object().shape({
        value: yup.object().shape({
          value: yup.string().when('$schemaContext', {
            is: (schema: typeof CALL_QUEUE_INIITAL_VALUES) =>
              schema?.greetings?.all_agent_busy?.enabled,
            then: () => yup.string().required('No agent available is required'),
            otherwise: () => yup.string().notRequired(),
          }),
        }),
      }),
    }),
  }),
  yup.object().shape({
    manager: yup.object({
      value: yup.string().trim().required('Manager is required'),
    }),
    members: yup
      .array()
      .of(
        yup.object({
          value: yup.string().trim().required('Member is required'),
        }),
      )
      .min(1, 'At least one member is required'),
  }),
  yup.object().shape({
    settings: yup.object().shape({
      ring_strategy: yup.object().shape({
        value: yup.mixed().required('Ring strategy is required'),
      }),
    }),
  }),
];
