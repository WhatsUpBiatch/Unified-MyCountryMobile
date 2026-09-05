import * as yup from 'yup';

import {
  DEVICE_OPTIONS_CONSTANT,
  FORWARD_TYPES,
  RING_MODE_OPTIONS,
} from '@/constants/forwarding-consts';
import { IADDUSER } from '@/interfaces/extension-interface';
import { SETTINGS } from '@/components/common-settings/constants';
import { readCompanyRingTime } from '@/lib/company-ring-time';

export const userInitialState = {
  email: '',
  first_name: '',
  last_name: '',
  extension: '',
  // extension: generateRandomExtension(),
  phone: '',
  password: '',
  confirm_password: '',
  role: { label: 'Select', value: '' },
};

export const formInitialState: IADDUSER = {
  user_add_count: null,
  site: { label: 'Select', value: '' },
  users: [userInitialState],
  password: '',
  confirm_password: '',
  /* Default: an invite link. The person chooses their own password. */
  password_type: 'email',
};

export const TAB_CONSTANT = {
  ADD_USER_INFO: 'Add User Info',
  SETUP_OPTION: 'Setup Options',
};

export const FORWARDING_TAB_CONSTANT = {
  BASIC_INFORMATION: 'Basic Information',
  SETTING_PERMISSIONS: 'Settings & Permissions',
  GREETING_NOTIFICATION: 'Media',
  CALL_RULES: 'Call Rules',
};

export const ERROR_TYPES = {
  [FORWARDING_TAB_CONSTANT.BASIC_INFORMATION]: 'basic',
  [FORWARDING_TAB_CONSTANT.SETTING_PERMISSIONS]: 'settings',
  [FORWARDING_TAB_CONSTANT.GREETING_NOTIFICATION]: 'greetings',
  [FORWARDING_TAB_CONSTANT.CALL_RULES]: 'callRules',
};

export const ERROR_TYPES_MESSAGES = {
  [FORWARDING_TAB_CONSTANT.BASIC_INFORMATION]: 'Basic information is required',
  [FORWARDING_TAB_CONSTANT.SETTING_PERMISSIONS]: 'Settings are required',
  [FORWARDING_TAB_CONSTANT.GREETING_NOTIFICATION]: 'Media is required',
  [FORWARDING_TAB_CONSTANT.CALL_RULES]: 'Call rules is required',
};

const callHandlingInitialState = {
  type: FORWARD_TYPES.VOICEMAIL,
  value: RING_MODE_OPTIONS?.[0],
  missed_call_action: {
    value: { label: '', value: FORWARD_TYPES.VOICEMAIL },
    forward_value: {
      label: '',
      value: '',
    },
    personal: false,
  },
  device_options: DEVICE_OPTIONS_CONSTANT,
};

export const greetingsInitialState = {
  welcome_greeting: {
    enabled: false,
    value: { label: '', value: '' },
  },
  voicemail: {
    enabled: false,
    value: { label: '', value: '' },
  },
  ring_tone: {
    enabled: false,
    value: { label: '', value: '' },
  },
  on_hold_music: {
    enabled: false,
    value: { label: '', value: '' },
  },
};

export const MEMBER_RING_STRATEGY_OPTIONS = [
  {
    label: 'Ring All',
    value: 'ring_all',
  },
  {
    label: 'Linear',
    value: 'linear',
  },
  {
    label: 'Round Robin',
    value: 'round_robin',
  },
  {
    label: 'Longest Idle',
    value: 'longest_idle',
  },
  {
    label: 'Random',
    value: 'random',
  },
];

export const settingsInitialState = {
  role: {
    label: '',
    value: '',
  },
  voicemail_pin: {
    value: '',
    users: [],
    voicemail_to_text: 'YES',
  },
  ...SETTINGS.settings,
};

export const basicInitialState = {
  email: '',
  site: { label: 'Select', value: '' },
  extension: '',
  phone: '',
  caller_id: '',
  job_title: '',
  first_name: '',
  last_name: '',
  profile: null,
};

export const callForwardingInitialState = {
  business_hours: {
    ...callHandlingInitialState,
  },
  closed_hours: {
    ...callHandlingInitialState,
  },
};

export const UPDATE_FORWARDING_INITIAL = {
  basic: basicInitialState,
  settings: settingsInitialState,
  greetings: greetingsInitialState,
  callRules: {
    forwardCall: {
      enabled: false,
      type: { label: '', value: '' },
      value: { label: '', value: '' },
      personal: true,
    },
    doNotDisturb: false,
    incomingCall: {
      enabled: true,
      deviceOptions: DEVICE_OPTIONS_CONSTANT,
      type: 'number',
      number: '',
      name: '',
      extension: [],
      deviceOptionValue: { label: '', value: 'sequential' },
    },
    outgoingCall: {
      enabled: true,
      defaultCallerId: { label: '', value: '' },
      defaultFaxId: '',
      defaultTextId: '',
      ringOut: false,
      region: '',
    },
    failureAction: {
      enabled: false,
      type: { label: '', value: '' },
      value: { label: '', value: '' },
      personal: true,
    },
    closedHoursAction: {
      enabled: false,
      type: { label: '', value: '' },
      value: { label: '', value: '' },
      personal: true,
    },
  },
  templateName: '',
  site: {},
};

export const DISPLAY_NUMBER_OPTIONS = [
  { label: 'Personal and mobile only', value: 'personal' },
  { label: 'None', value: 'N' },
];

export const WEEKLY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type Weekday = (typeof WEEKLY_ORDER)[number];

export const WEEKLY_SCHEDULE_MAP: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thur',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

export const timeOption = [
  {
    label: 5,
    value: 5,
  },
  {
    label: 10,
    value: 10,
  },
  {
    label: 15,
    value: 15,
  },
  {
    label: 20,
    value: 20,
  },
  {
    label: 25,
    value: 25,
  },
  {
    label: 30,
    value: 30,
  },
];

/* A department's member ring timeout is the same idea as a device ring time —
   how long it rings before the call moves on — but it is held in a different
   shape: `timeOption` stores plain numbers, and the record it is read back from
   is matched with `===`, so a string here would blank the select and lose the
   setting. Everything below therefore converts the company's seconds into the
   numeric shape this picker expects rather than reusing the string options.

   The department default stays 10. It is only replaced when an admin has
   actually saved a company ring time, so a tenant that never opened that page
   sees the same 10 seconds it has always had. */
export const DEPARTMENT_DEFAULT_TIMEOUT_SECONDS = 10;

const hasTimeoutValue = (current: any) => {
  const raw = current && typeof current === 'object' ? current?.value : current;
  if (raw === null || typeof raw === 'undefined' || raw === '') return false;
  return Number.isFinite(Number(raw)) && Number(raw) > 0;
};

/* The shipped entry itself comes back when the seconds are one of the six on
   offer, so the common case is the exact object the picker already holds. */
export const buildDepartmentTimeoutOption = (seconds: number) =>
  timeOption.find((option) => option.value === seconds) ?? { label: seconds, value: seconds };

export const DEPARTMENT_DEFAULT_TIMEOUT = buildDepartmentTimeoutOption(
  DEPARTMENT_DEFAULT_TIMEOUT_SECONDS,
);

/**
 * What a brand new department should start on: the company's ring time when one
 * is saved and switched on for new people, otherwise the shipped 10 seconds.
 */
export const getDepartmentTimeoutOption = (companySettings: unknown) => {
  const companyRingTime = readCompanyRingTime(companySettings);
  return companyRingTime && companyRingTime.appliesToNewPeople
    ? buildDepartmentTimeoutOption(companyRingTime.seconds)
    : DEPARTMENT_DEFAULT_TIMEOUT;
};

/**
 * Read a saved department timeout back into the picker. A number the six
 * choices cannot express — which a company ring time above 30 now makes
 * possible — is offered as itself instead of coming back as nothing at all.
 * A department with no timeout saved still reads back as nothing, exactly as
 * before, so the field stays required rather than being silently filled.
 */
export const readDepartmentTimeoutOption = (stored: unknown) =>
  hasTimeoutValue(stored) ? buildDepartmentTimeoutOption(Math.round(Number(stored))) : undefined;

/**
 * The list to hand the picker: the six shipped choices, plus the company's
 * number and whatever this department is already on when either falls outside
 * them. Without this a department on 45 seconds shows an empty box and the
 * first click quietly rewrites it.
 */
export const getDepartmentTimeoutOptions = (companySettings: unknown, current?: unknown) => {
  const options = [...timeOption];

  const add = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const rounded = Math.round(seconds);
    if (options.some((option) => option.value === rounded)) return;
    options.push({ label: rounded, value: rounded });
  };

  const companyRingTime = readCompanyRingTime(companySettings);
  if (companyRingTime && companyRingTime.appliesToNewPeople) add(companyRingTime.seconds);

  if (hasTimeoutValue(current)) {
    add(Number(current && typeof current === 'object' ? (current as any).value : current));
  }

  /* Nothing extra to show means the shipped list in the shipped order, so a
     tenant with no company ring time sees the very same picker as before. */
  if (options.length === timeOption.length) return options;

  return options.sort((a, b) => a.value - b.value);
};

export const DEVICE_TYPE_NAME_CONST = {
  web: 'Desktop',
  pstn: 'ATA Device',
  mobile: 'Mobile',
} as const;

export const holidaySchema = yup.object().shape({
  title: yup.string().required('Title is required'),
  from: yup.date().nullable().required('From date is required'),
  to: yup.date().nullable().required('To date is required'),
  type: yup.object().shape({
    label: yup.string(),
    value: yup.string().required('Type is required'),
  }),
  value: yup
    .object()
    .shape({
      label: yup.string(),
      value: yup.string().required('Value is required'),
    })
    .when('type', {
      is: (type: any) => type?.value === 'PHONE',
      then: (schema) =>
        schema.shape({
          value: yup
            .string()
            .required('Value is required')
            .test('phone-length', 'Phone number must be at least 8 digits', (val) => {
              if (val && val.replace(/\D/g, '').length < 8) return false;
              return true;
            }),
        }),
    }),
});
