import moment from 'moment';
import { CUSTOM_HOURS_SCHEDULE_OPTIONS } from '@/constants/forwarding-consts';
import { CAMPAIGN_SETTINGS_CONST } from '@/constants/common-const';
import { DEFAULT_RETRY_PERIOD_TYPE, DIALER_TYPE } from './consts';

type Option = { label: string; value: string };
type CampaignMember = {
  user_uuid: string;
  first_name: string;
  last_name: string;
  email: string;
  extension: string;
  role: string;
  domain: string;
  label?: string;
  value?: string;
  uuid?: string;
};

const toBoolean = (value: any, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (typeof value === 'number') return value === 1;
  return fallback;
};

const normalizeAnsweringMachineValue = (answeringMachine: any) => {
  const rawValue = answeringMachine?.value;
  if (rawValue && typeof rawValue === 'object') {
    return {
      value: rawValue?.value || '',
      label: rawValue?.label || answeringMachine?.label || '',
    };
  }

  return {
    value: rawValue || '',
    label: answeringMachine?.label || '',
  };
};

const splitNameFromLabel = (label?: string) => {
  const cleanLabel = String(label || '').trim();
  if (!cleanLabel) return { first_name: '', last_name: '' };
  const parts = cleanLabel.split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' '),
  };
};

const normalizeMemberForPayload = (member: any, fallbackDomain = ''): CampaignMember => {
  const fallbackNames = splitNameFromLabel(member?.label);
  const first_name = String(member?.first_name ?? fallbackNames.first_name ?? '').trim();
  const last_name = String(member?.last_name ?? fallbackNames.last_name ?? '').trim();
  const extension = String(member?.extension ?? member?.value ?? '').trim();

  return {
    user_uuid: String(member?.user_uuid ?? member?.uuid ?? '').trim(),
    first_name,
    last_name,
    email: String(member?.email ?? '').trim(),
    extension,
    role: String(member?.role ?? '').trim(),
    domain: String(member?.domain ?? fallbackDomain ?? '').trim(),
  };
};

const normalizeMemberForForm = (member: any) => {
  const normalizedMember = normalizeMemberForPayload(member);
  const label =
    String(member?.label || '').trim() ||
    `${normalizedMember.first_name}${normalizedMember.last_name ? ` ${normalizedMember.last_name}` : ''}`.trim();
  const value = String(member?.value ?? normalizedMember.extension ?? '').trim();

  return {
    ...member,
    ...normalizedMember,
    uuid: member?.uuid || normalizedMember.user_uuid,
    label,
    value,
  };
};

const buildSettingsPayload = (formValues: any) => {
  const {
    display_number: { masking = {}, incoming = {}, show_number_if_blocked = 'NO' } = {},
    operational_hours = {},
    recording = {},
    ai_call_monitoring = {},
    transcription = {},
  } = formValues?.settings || {};
  const { hold = {} } = formValues?.greetings || {};
  const automaticRecordingEnabled = toBoolean(recording?.automatic?.enabled, false);

  return {
    recording: {
      on_demand: {
        enabled: false,
        recording_on:
          recording?.on_demand?.recording_on || 'ad98d65d-fcf8-4d4d-bc77-ee1426c34331.mp3',
        recording_Off:
          recording?.on_demand?.recording_Off || 'ad98d65d-fcf8-4d4d-bc77-ee1426c34332.mp3',
      },
      automatic: {
        enabled: automaticRecordingEnabled,
        value: 'all',
        label: 'All',
        recording_on:
          recording?.automatic?.recording_on || 'ad98d65d-fcf8-4d4d-bc77-ee1426c34333.mp3',
      },
    },
    ai_call_monitoring: toBoolean(
      typeof ai_call_monitoring === 'boolean' ? ai_call_monitoring : ai_call_monitoring?.enabled,
    ),
    transcription: toBoolean(
      typeof transcription === 'boolean' ? transcription : transcription?.enabled,
    ),
    display_number: {
      incoming,
      masking: {
        type: masking?.type?.value || masking?.type || '',
        label: masking?.type?.label || masking?.label || '',
        value: masking?.value,
      },
      show_number_if_blocked,
    },
    operational_hours: {
      value: operational_hours?.value || CUSTOM_HOURS_SCHEDULE_OPTIONS,
      holidays: operational_hours?.holidays?.length ? operational_hours.holidays : [],
      regional: {
        override: operational_hours?.regional?.override ?? false,
        country: operational_hours?.regional?.country,
        timezone: operational_hours?.regional?.timezone,
        time_format: operational_hours?.regional?.time_format,
        country_code: operational_hours?.regional?.country_code,
      },
    },
    media: {
      hold: {
        enabled: toBoolean(hold?.enabled, false),
        value: hold?.value?.value || '',
        label: hold?.value?.label || '',
      },
    },
  };
};

const buildDialerSettingsPayload = (dialerSetting: any) => {
  const answeringMachine = dialerSetting?.answering_detection_machine || {};
  const autoAnswering = dialerSetting?.auto_answering || {};
  const normalizedMachine = normalizeAnsweringMachineValue(answeringMachine);
  const retryPeriodType = dialerSetting?.default_retry_period_type;

  return {
    preview_time: dialerSetting?.preview_time,
    ringing_agent_time: dialerSetting?.ringing_agent_time,
    wrapup_time: dialerSetting?.wrapup_time,
    max_ring_time: dialerSetting?.max_ring_time,
    max_attempt_per_record: dialerSetting?.max_attempt_per_record,
    default_retry_period: dialerSetting?.default_retry_period,
    default_retry_period_type:
      typeof retryPeriodType === 'string' ? retryPeriodType : retryPeriodType?.value,
    agent_contact_limit: dialerSetting?.agent_contact_limit ?? null,
    /* Pacing for the server-side dialer. Progressive only reads the line
       ceiling; predictive reads all four. Preview ignores them. */
    max_lines: Number(dialerSetting?.max_lines ?? 0) || 0,
    max_calls_per_agent: Number(dialerSetting?.max_calls_per_agent ?? 3) || 3,
    target_abandon_rate: Number(dialerSetting?.target_abandon_rate ?? 3) || 3,
    compliance_abandon_seconds: Number(dialerSetting?.compliance_abandon_seconds ?? 2) || 0,
    answering_detection_machine: {
      /* The switch was never sent. The UI writes to `enabled`, the read-back at
         line ~321 looks for `enabled ?? enable`, and this builder omitted both —
         so answering machine detection resolved to false on every save and could
         not be turned on at all. Zero of the twelve live campaigns carry the key.
         Written as `enabled` to match the read-back and the backend's Joi schema;
         `enable` is also sent because the sibling `auto_answering` block uses that
         spelling and it is not knowable from here which one the dialer reads. */
      enabled: toBoolean(answeringMachine?.enabled ?? answeringMachine?.enable, false),
      enable: toBoolean(answeringMachine?.enabled ?? answeringMachine?.enable, false),
      type: answeringMachine?.type || 'HANGUP',
      value: normalizedMachine.value,
      label: normalizedMachine.label,
    },
    auto_answering: {
      enable: toBoolean(autoAnswering?.enabled ?? autoAnswering?.enable, false),
      timeout: autoAnswering?.timeout ?? 2,
    },
  };
};

const buildAgentDispositionPayload = (agentDisposition: any[] = []) => {
  return agentDisposition
    .filter((item) => item?._id)
    .map((item) => ({
      _id: item?._id,
      disposition: {
        name: item?.disposition?.name || '',
      },
    }));
};

export const buildCampaignUpsertPayload = ({
  formValues,
  dialMethod,
  campaignStatus,
  selectedCampaignId,
  fallbackDomain = '',
}: {
  formValues: any;
  dialMethod?: string;
  campaignStatus: string;
  selectedCampaignId?: string;
  fallbackDomain?: string;
}) => {
  const scriptValue = formValues?.script;
  const normalizedMembers = (formValues?.members || []).map((member: any) =>
    normalizeMemberForPayload(member, fallbackDomain),
  );
  const uniqueMemberMap = new Map<string, CampaignMember>();
  normalizedMembers.forEach((member: CampaignMember) => {
    const key = member?.user_uuid || member?.extension;
    if (!key) return;
    uniqueMemberMap.set(key, member);
  });
  const uniqueMembers = Array.from(uniqueMemberMap.values());

  const settingsPayload = buildSettingsPayload(formValues);
  const timezone = formValues?.settings?.operational_hours?.regional?.timezone?.value || '';

  return {
    campaignStatus,
    name: formValues?.name || '',
    siteId: formValues?.siteId?.value || '',
    description: formValues?.description || '',
    startDate: formValues?.startDate ? moment(formValues.startDate).format('YYYY-MM-DD') : '',
    endDate: formValues?.endDate ? moment(formValues.endDate).format('YYYY-MM-DD') : '',
    callerId: (formValues?.callerId || []).map((item: Option) => item?.value),
    groupId: (formValues?.groupId || []).map((item: Option) => item?.value),
    dialerSetting: buildDialerSettingsPayload(formValues?.dialerSetting || {}),
    agentDisposition: buildAgentDispositionPayload(formValues?.agentDisposition || []),
    members: uniqueMembers,
    allowSkipping: formValues?.allowSkipping ?? true,
    /* Defaults to false in all three places (initial value, write, read).
       The schema makes `script` required whenever agentScripting is true, so
       defaulting to true would fail validation on every new campaign, and
       would silently flip legacy campaigns on — then block saving them. */
    agentScripting: formValues?.agentScripting ?? false,
    script: typeof scriptValue === 'string' ? scriptValue : scriptValue?.value || '',
    settings: settingsPayload,
    dialMethod: dialMethod || formValues?.dialMethod || DIALER_TYPE.PREVIEW,
    timezone,
    ...(selectedCampaignId ? { campaignId: selectedCampaignId } : {}),
  };
};

export const mapCampaignToFormDefaults = ({
  selectedCampaign,
  dataSiteList = [],
  groupList = [],
  inventoryNumberList = [],
}: {
  selectedCampaign: any;
  dataSiteList?: any[];
  groupList?: any[];
  inventoryNumberList?: any[];
}) => {
  const media = selectedCampaign?.settings?.media;
  const retryPeriodLabel =
    DEFAULT_RETRY_PERIOD_TYPE.find(
      (item) => item.value === selectedCampaign?.dialerSetting?.default_retry_period_type,
    )?.label || '';

  const answeringMachine = selectedCampaign?.dialerSetting?.answering_detection_machine || {};
  const autoAnswering = selectedCampaign?.dialerSetting?.auto_answering || {};
  const normalizedMachine = normalizeAnsweringMachineValue(answeringMachine);

  const settings = selectedCampaign?.settings || CAMPAIGN_SETTINGS_CONST?.settings;

  const siteLabel = dataSiteList?.find(
    (item: { uuid: string }) => item?.uuid === selectedCampaign?.siteId,
  )?.name;

  const groupIds = (selectedCampaign?.groupId || [])
    .map((groupId: string) => {
      const group = groupList?.find(
        (item: { _id: string; groupName?: string; name?: string; leadCount?: number }) =>
          item?._id === groupId,
      );
      return group
        ? {
            label: group.groupName || group.name || groupId,
            value: groupId,
            leadCount: group.leadCount ?? 0,
          }
        : { label: groupId, value: groupId, leadCount: 0 };
    })
    .filter(Boolean);

  const callerIds = (selectedCampaign?.callerId || [])
    .map((didNumber: string) => {
      const matchedNumber = inventoryNumberList?.find(
        (item: { did_number: string }) => item?.did_number === didNumber,
      );
      if (!matchedNumber) {
        return {
          label: didNumber?.startsWith('+') ? didNumber : `+${didNumber}`,
          value: didNumber,
        };
      }
      return {
        label: `${matchedNumber?.did_number?.startsWith('+') ? matchedNumber.did_number : `+${matchedNumber.did_number}`}`,
        value: matchedNumber?.did_number,
      };
    })
    .filter(Boolean);
  const members = (selectedCampaign?.members || []).map((member: any) =>
    normalizeMemberForForm(member),
  );

  return {
    name: selectedCampaign?.name || '',
    description: selectedCampaign?.description || '',
    dialerSetting: {
      preview_time: selectedCampaign?.dialerSetting?.preview_time,
      ringing_agent_time: selectedCampaign?.dialerSetting?.ringing_agent_time,
      wrapup_time: selectedCampaign?.dialerSetting?.wrapup_time,
      max_ring_time: selectedCampaign?.dialerSetting?.max_ring_time,
      default_retry_period: selectedCampaign?.dialerSetting?.default_retry_period,
      default_retry_period_type: {
        label: retryPeriodLabel,
        value: selectedCampaign?.dialerSetting?.default_retry_period_type || '',
      },
      max_attempt_per_record: selectedCampaign?.dialerSetting?.max_attempt_per_record,
      max_lines: selectedCampaign?.dialerSetting?.max_lines ?? 0,
      max_calls_per_agent: selectedCampaign?.dialerSetting?.max_calls_per_agent ?? 3,
      target_abandon_rate: selectedCampaign?.dialerSetting?.target_abandon_rate ?? 3,
      compliance_abandon_seconds: selectedCampaign?.dialerSetting?.compliance_abandon_seconds ?? 2,
      answering_detection_machine: {
        enabled: toBoolean(answeringMachine?.enabled ?? answeringMachine?.enable, false),
        type: answeringMachine?.type,
        value: normalizedMachine,
      },
      auto_answering: {
        enabled: toBoolean(autoAnswering?.enabled ?? autoAnswering?.enable, false),
        timeout: autoAnswering?.timeout ?? 2,
      },
    },
    greetings: {
      hold: {
        enabled: toBoolean(media?.hold?.enabled, false),
        value: {
          label: media?.hold?.label || '',
          value: media?.hold?.value || '',
        },
      },
    },
    agentDisposition: selectedCampaign?.agentDisposition || [],
    allowSkipping: toBoolean(selectedCampaign?.allowSkipping, true),
    agentScripting: toBoolean(selectedCampaign?.agentScripting, false),
    members,
    startDate: selectedCampaign?.startDate
      ? moment(selectedCampaign.startDate).format('YYYY-MM-DD')
      : '',
    endDate: selectedCampaign?.endDate ? moment(selectedCampaign.endDate).format('YYYY-MM-DD') : '',
    settings: {
      ...settings,
      ai_call_monitoring: {
        enabled: toBoolean(
          typeof settings?.ai_call_monitoring === 'boolean'
            ? settings?.ai_call_monitoring
            : settings?.ai_call_monitoring?.enabled,
        ),
      },
      transcription: {
        enabled: toBoolean(
          typeof settings?.transcription === 'boolean'
            ? settings?.transcription
            : settings?.transcription?.enabled,
        ),
      },
    },
    maskingType: {
      label: selectedCampaign?.settings?.display_number?.masking?.label || '',
      value: selectedCampaign?.settings?.display_number?.masking?.type || '',
    },
    siteId: { label: siteLabel, value: selectedCampaign?.siteId },
    groupId: groupIds,
    callerId: callerIds,
  };
};
