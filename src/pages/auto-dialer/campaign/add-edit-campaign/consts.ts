import { CAMPAIGN_SETTINGS_CONST } from '@/constants/common-const';

export const PREVIW_INITIALS = {
  name: '',
  siteId: {
    label: '',
    value: '',
  },
  description: '',
  startDate: '',
  endDate: '',
  callerId: [],
  groupId: [],
  dialerSetting: {
    preview_time: 30,
    ringing_agent_time: 30,
    wrapup_time: 30,
    max_ring_time: 30,
    max_attempt_per_record: 1,
    default_retry_period: 3,
    default_retry_period_type: {
      label: 'Minutes',
      value: 'min',
    },
    agent_contact_limit: null,
    /* Pacing, read by the dialer service. 0 lines = no ceiling. */
    max_lines: 0,
    max_calls_per_agent: 3,
    target_abandon_rate: 3,
    compliance_abandon_seconds: 2,
    answering_detection_machine: {
      enable: false,
      type: 'HANGUP',
      value: {
        label: '',
        value: '',
      },
    },
    auto_answering: {
      enabled: false,
      timeout: 2,
    },
  },
  agentDisposition: [],
  members: [],
  allowSkipping: true,
  agentScripting: false,
  script: {
    label: '',
    value: '',
  },
  greetings: {
    hold: {
      value: {
        label: '',
        value: '',
      },
      enabled: false,
    },
  },
  ...CAMPAIGN_SETTINGS_CONST,
};

export const RETRY_PERIOD_TYPE = {
  MIN: 'min',
  HOUR: 'hr',
  DAY: 'day',
};

export const DIALER_TYPE = {
  NORMAL: 'PROGRESSIVE',
  PREDICTIVE: 'PREDICTIVE',
  PREVIEW: 'PREVIEW',
};

export const CAMPAIGN_TYPE_LIST = [
  {
    label: 'Preview',
    description: 'For small teams, manual review',
    value: DIALER_TYPE.PREVIEW,
  },
  {
    label: 'Progressive',
    description: 'For small to medium teams, steady flow',
    value: DIALER_TYPE.NORMAL,
  },
  {
    label: 'Predictive',
    description: 'For large teams, max. efficiency, min. idle time',
    value: DIALER_TYPE.PREDICTIVE,
  },
];

export const TIME_LIST = [30, 35, 40, 45, 50, 55, 60];

export const MAX_ATTEMPTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const DEFAULT_RETRY_PERIOD_TYPE = [
  {
    label: 'Minutes',
    value: RETRY_PERIOD_TYPE.MIN,
  },
  {
    label: 'Hours',
    value: RETRY_PERIOD_TYPE.HOUR,
  },
  {
    label: 'Days',
    value: RETRY_PERIOD_TYPE.DAY,
  },
];
