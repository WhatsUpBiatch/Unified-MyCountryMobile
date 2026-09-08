export const FORWARD_TYPES = {
  DEVICE: 'DEVICE',
  VOICEMAIL: 'VOICEMAIL',
  GREETING: 'GREETING',
  EXTENSION: 'EXTENSION',
  PHONE: 'PHONE',
  IVR: 'IVR',
  QUEUE: 'QUEUE',
  DEPARTMENT: 'DEPARTMENT',
  MESSAGE: 'MESSAGE',
  AI: 'AI',
  HANGUP: 'HANGUP',
};

/**
 * What each forwarding target is called.
 *
 * Two screens were spelling these out of the enum by rule — the numbers table
 * through `capitalizeFirstLetter`, the coverage screen through
 * `.toLowerCase()` — and both got the acronyms wrong: "Ivr", "Ai", "calls
 * reach ivr". A name cannot be derived from its constant, so it is written
 * down, once, beside the constant.
 *
 * `FORWARD_TYPE_LABEL` is the heading form, for a table cell that leads with
 * it. `FORWARD_TYPE_PHRASE` is the same thing mid-sentence, where it needs an
 * article — "Calls reach the IVR menu", not "Calls reach IVR menu".
 */
export const FORWARD_TYPE_LABEL: Record<string, string> = {
  EXTENSION: 'Extension',
  VOICEMAIL: 'Voicemail',
  DEPARTMENT: 'Department',
  QUEUE: 'Queue',
  IVR: 'IVR menu',
  GREETING: 'Greeting',
  MESSAGE: 'Message',
  HANGUP: 'Hang up',
  DEVICE: 'Device',
  AI: 'AI receptionist',
  PHONE: 'Outside number',
};

export const FORWARD_TYPE_PHRASE: Record<string, string> = {
  EXTENSION: 'the extension',
  VOICEMAIL: 'voicemail',
  DEPARTMENT: 'the department',
  QUEUE: 'the queue',
  IVR: 'the IVR menu',
  GREETING: 'a greeting',
  MESSAGE: 'a message',
  HANGUP: 'a hang-up',
  DEVICE: 'the device',
  AI: 'the AI receptionist',
  PHONE: 'an outside number',
};

const normaliseType = (forwardType?: string | null) =>
  String(forwardType ?? '').trim().toUpperCase();

export const getForwardTypeLabel = (forwardType?: string | null): string =>
  FORWARD_TYPE_LABEL[normaliseType(forwardType)] ?? 'Forwarded';

export const getForwardTypePhrase = (forwardType?: string | null): string =>
  FORWARD_TYPE_PHRASE[normaliseType(forwardType)] ?? 'its destination';

export const RING_TYPE_LABELS = {
  sequential: 'Ring in order',
  simultaneously: 'Ring all at once',
} as const;

export const RING_MODE_OPTIONS = [
  {
    label: RING_TYPE_LABELS.sequential,
    value: 'sequential',
  },
  {
    label: RING_TYPE_LABELS.simultaneously,
    value: 'simultaneously',
  },
];

export const CUSTOM_HOURS_SCHEDULE_OPTIONS = {
  monday: {
    open: true,
    start: '10:00',
    end: '23:00',
    is_checked: false,
  },
  tuesday: {
    open: true,
    start: '10:00',
    end: '23:00',
    is_checked: false,
  },
  wednesday: {
    open: true,
    start: '10:00',
    end: '23:00',
    is_checked: false,
  },
  thursday: {
    open: true,
    start: '10:00',
    end: '23:00',
    is_checked: false,
  },
  friday: {
    open: true,
    start: '10:00',
    end: '23:00',
    is_checked: false,
  },
  saturday: {
    open: false,
    start: '',
    end: '',
    is_checked: false,
  },
  sunday: {
    open: false,
    start: '',
    end: '',
    is_checked: false,
  },
};

export const CUSTOM_HOURS_HOLIDAYS = [
  {
    title: '',
    from: null,
    to: null,
    type: { label: '', value: '' },
    value: { label: '', value: '' },
  },
];

export const RINGING_OPTIONS = [
  {
    label: '6 times / 30 secs',
    value: '30',
  },
  {
    label: '3 times / 15 secs',
    value: '15',
  },
];

export const DEVICE_OPTIONS_CONSTANT = {
  web: {
    status: true,
    value: RINGING_OPTIONS?.[0],
    options: {
      label: '',
      value: '',
    },
  },
};
