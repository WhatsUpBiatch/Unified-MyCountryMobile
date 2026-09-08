import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  BookOpen,
  ChevronDown,
  Clock3,
  MessageSquare,
  Settings,
  UserRound,
  Zap,
  Globe,
  Play,
  Pause,
  Check,
  FileText,
  Upload,
  Info,
  HelpCircle,
  Stethoscope,
  Home,
  Edit3,
  type LucideIcon,
  Briefcase,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Room, RoomEvent, Track } from 'livekit-client';
import {
  AIUserKnowledgeBase,
  siteList,
  createAiReceptionist,
  createWebRTCVoiceSession,
  finalizeAgentSession,
  getAIAgentToken,
  updateAiReceptionist,
  getAIAgentType,
} from '@/services/api';
import {
  voiceOptions,
  languageOptions,
  spanishVoiceOptions,
  hindiVoiceOptions,
} from '../constants';
import RegionalModal from '@/components/common-settings/regional-dialog';
import BussinessHoursModal from '@/components/custom/bussiness-hours-dialog';
import { OPERATIONAL_HOURS } from '@/components/common-settings/constants';
import { getWeeklyScheduleName } from '@/components/common-settings';
import { FORWARD_TYPES_LABEL } from '@/components/custom/forward-action-all';
import { handleAlert } from '@/lib/utils';
import {
  hasCompleteRegionalSettings,
  normalizeRegionalSettings,
  withRegionalSettingsFallback,
} from '@/lib/regional-settings';
import moment from 'moment';
import { useNavigate } from 'react-router-dom';
import CustomSelect from '@/components/custom/custom-select';
import {
  useGetDepartment,
  useGetExtensions,
  useGetGreetings,
  useGetIVR,
  useGetQueueList,
} from '@/hooks/common';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ForwardActionAllAi from './forward-action-all-ai';
import { useUser } from '@/hooks/use-user';
import useDebounce from '@/hooks/use-debounce';
import { usePaginatedUsers } from '@/hooks/use-paginated-users';
import { Picker } from '@/components/mcm/picker';

type CreateAiReceptionistProps = {
  onClose: () => void;
  initialTemplateName?: string;
  initialTopicId?: string;
  initialData?: any;
  initialStep?: number;
  preselectKnowledgeBase?: { ingestionId: string; type: 'text' | 'url' | 'pdf' } | null;
  initialDraft?: AiReceptionistDraftState | null;
};

type DetailField = 'name' | 'dob' | 'phone' | 'email' | 'address';
type ForwardCallState = {
  enabled?: boolean;
  type?: {
    label?: string;
    value?: string;
  };
  value?: {
    label?: string;
    value?: string;
  };
  personal?: boolean;
};
const cloneForwardCallState = (value?: ForwardCallState | null): ForwardCallState =>
  value ? (JSON.parse(JSON.stringify(value)) as ForwardCallState) : {};
const DETAIL_FIELDS: DetailField[] = ['name', 'dob', 'phone', 'email', 'address'];
const ensurePhoneMandatory = (details: DetailField[] = []) => {
  const set = new Set<DetailField>(['phone', ...details]);
  return DETAIL_FIELDS.filter((field) => set.has(field));
};

const getManagerUserRole = (user: any) =>
  String(
    user?.custom_role_data?.name ||
      user?.customRoleData?.name ||
      user?.role_data?.name ||
      user?.roleData?.name ||
      user?.role?.name ||
      user?.role_name ||
      (typeof user?.role === 'string' ? user.role : ''),
  )
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-');

const getManagerUserId = (user: any) =>
  String(user?.uuid || user?.user_uuid || user?.userId || user?.id || user?._id || '').trim();

type AiReceptionistDraftState = {
  receptionistName: string;
  greetingText: string;
  systemPrompt: string;
  enableTranscripts: boolean;
  enableCallMonitoring: boolean;
  temperature: string;
  maxSessionDuration: number;
  idleReminder: number;
  idleReminderRetry: number;
  detailsToCollect: {
    data_agent_uuid: string;
    details_to_collect: DetailField[];
  };
  isDataCollectionEnabled: boolean;
  selectedLanguage: string;
  selectedPersona: string;
  selectedCompanyDetailsKb: string[];
  selectedWebsiteKb: string[];
  selectedDocumentKb: string[];
  selectedLocationId: string;
  selectedTopicId: string;
  selectedManagerId?: string;
  enableHumanHandoff: boolean;
  enableCallbackScheduling: boolean;
  currentStep: number;
  formValues?: any;
};

const STEP_ITEMS: Array<{ title: string; subtitle: string; icon: LucideIcon }> = [
  { title: 'Welcome greeting', subtitle: 'First message', icon: MessageSquare },
  { title: 'Tone and personality', subtitle: 'Select AI voice', icon: UserRound },
  { title: 'Company description', subtitle: 'Business details', icon: BookOpen },
  { title: 'Location & hours', subtitle: 'When and where', icon: Clock3 },
  { title: 'Hand Off & Callback', subtitle: 'Forwarding rules', icon: Zap },
  { title: 'Advanced config', subtitle: 'Data & tracking', icon: Settings },
];

const TEMPERATURE_OPTIONS = ['Low (More consistent)', 'Balanced', 'High (More creative)'];
const MAX_SESSION_DURATION_OPTIONS = [1, 2, 3, 5, 10, 15];
const DEFAULT_MAX_SESSION_DURATION_MINUTES = 5;
const IDLE_REMINDER_OPTIONS = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600];
const DEFAULT_IDLE_REMINDER_SECONDS = 60;
const IDLE_REMINDER_RETRY_OPTIONS = [1, 2, 3, 4, 5];
const DEFAULT_IDLE_REMINDER_RETRY = 3;

const getClosestSessionDurationOption = (value: number): number =>
  MAX_SESSION_DURATION_OPTIONS.reduce((closest, current) =>
    Math.abs(current - value) < Math.abs(closest - value) ? current : closest,
  );

const normalizeMaxSessionDurationMinutes = (value: unknown): number => {
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue)) return DEFAULT_MAX_SESSION_DURATION_MINUTES;
  if (MAX_SESSION_DURATION_OPTIONS.includes(normalizedValue)) return normalizedValue;

  // Backward compatibility for second-based stored values.
  const convertedMinutes = normalizedValue / 60;
  if (MAX_SESSION_DURATION_OPTIONS.includes(convertedMinutes)) return convertedMinutes;

  if (normalizedValue >= 30) return getClosestSessionDurationOption(convertedMinutes);
  return getClosestSessionDurationOption(normalizedValue);
};

const normalizeIdleReminderSeconds = (value: unknown): number => {
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue)) return DEFAULT_IDLE_REMINDER_SECONDS;
  if (IDLE_REMINDER_OPTIONS.includes(normalizedValue)) return normalizedValue;

  return IDLE_REMINDER_OPTIONS.reduce((closest, current) =>
    Math.abs(current - normalizedValue) < Math.abs(closest - normalizedValue) ? current : closest,
  );
};

const normalizeIdleReminderRetry = (value: unknown): number => {
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue)) return DEFAULT_IDLE_REMINDER_RETRY;
  if (IDLE_REMINDER_RETRY_OPTIONS.includes(normalizedValue)) return normalizedValue;

  return IDLE_REMINDER_RETRY_OPTIONS.reduce((closest, current) =>
    Math.abs(current - normalizedValue) < Math.abs(closest - normalizedValue) ? current : closest,
  );
};

const TEMPERATURE_MAP: Record<string, string> = {
  'Low (More consistent)': 'low',
  Balanced: 'medium',
  'High (More creative)': 'high',
};

const getForwardTypeLabel = (type?: string) =>
  (type && FORWARD_TYPES_LABEL[type as keyof typeof FORWARD_TYPES_LABEL]) || 'Hangup';
const getForwardValueFieldLabel = (type?: string) => {
  switch (type) {
    case 'GREETING':
      return 'Announcement';
    case 'EXTENSION':
      return 'Extension';
    case 'VOICEMAIL':
      return 'Voicemail';
    case 'DEPARTMENT':
      return 'Group';
    case 'IVR':
      return 'IVR';
    case 'QUEUE':
      return 'Queue';
    case 'PHONE':
      return 'Phone Number';
    default:
      return 'Destination';
  }
};
const getForwardDestinationValue = (forwardCall?: ForwardCallState | any) =>
  String((forwardCall as any)?.value?.value ?? (forwardCall as any)?.value ?? '').trim();

const VOICE_EMOJI_MAP: Record<string, string> = {
  Alloy: '👩',
  Ash: '👨',
  Ballad: '👨',
  Coral: '👩‍💼',
  Echo: '👨',
  Sage: '👩‍🔬',
  Shimmer: '👩‍🎨',
  Verse: '👨',
  Ava: '👩',
  Andrew: '👨',
  Amanda: '👩‍💼',
  Adam: '👨‍💼',
  Christopher: '👨‍💻',
  Derek: '👨‍🔬',
  Steffan: '👨‍🎨',
  Nancy: '👩‍🏫',
  // Spanish
  Abril: '👩',
  Elias: '👨',
  Arnau: '👨',
  Laia: '👩',
  Estrella: '👩',
  Dario: '👨',
  // Hindi
  Aarav: '👨',
  Ananya: '👩',
  Kavya: '👩',
  Madhur: '👨',
  Rehaan: '👨',
  Aarti: '👩',
  Arjun: '👨',
  Kunal: '👨',
};

const PREVIEW_AUTO_STOP_MS = 15000;
const PREVIEW_DEMO_TEXT =
  'Hello, this is your realtime voice preview demo. Thank you for listening carefully to this sample so you can evaluate pronunciation, pacing, clarity, and tone before saving this voice. This preview is intentionally longer to provide a better comparison experience across all available voices, and it will end automatically after playback.';
const REALTIME_PREVIEW_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
] as const;
const LEGACY_PERSONA_TO_REALTIME_VOICE: Record<string, (typeof REALTIME_PREVIEW_VOICES)[number]> = {
  'en-us-avamultilingualneural': 'alloy',
  'en-us-andrewmultilingualneural': 'ash',
  'en-us-amandamultilingualneural': 'ballad',
  'en-us-adammultilingualneural': 'coral',
  'en-us-christophermultilingualneural': 'echo',
  'en-us-derekmultilingualneural': 'sage',
  'en-us-steffanmultilingualneural': 'shimmer',
  'en-us-nancymultilingualneural': 'verse',
  'es-es-abrilneural': 'alloy',
  'es-es-eliasneural': 'ash',
  'es-es-arnauneural': 'ballad',
  'es-es-laianeural': 'coral',
  'es-es-estrellaneural': 'echo',
  'es-es-darioneural': 'sage',
  'hi-in-aaravneural': 'alloy',
  'hi-in-ananyaneural': 'ash',
  'hi-in-kavyaneural': 'ballad',
  'hi-in-madhurneural': 'coral',
  'hi-in-rehaanneural': 'echo',
  'hi-in-aartineural': 'sage',
  'hi-in-arjunneural': 'shimmer',
  'hi-in-kunalneural': 'verse',
};

const isRealtimePreviewVoice = (
  voiceValue: string,
): voiceValue is (typeof REALTIME_PREVIEW_VOICES)[number] => {
  return (REALTIME_PREVIEW_VOICES as readonly string[]).includes(voiceValue);
};

const normalizeStoredVoiceValue = (voiceValue: unknown) => {
  const normalized = String(voiceValue || '')
    .trim()
    .toLowerCase();
  if (!normalized) return voiceOptions[0].value;
  if (isRealtimePreviewVoice(normalized)) return normalized;
  const mapped = LEGACY_PERSONA_TO_REALTIME_VOICE[normalized];
  if (mapped) return mapped;
  return voiceOptions[0].value;
};

const resolveRealtimePreviewVoice = (personaValue: string) => {
  const normalized = String(personaValue || '')
    .trim()
    .toLowerCase();
  if (isRealtimePreviewVoice(normalized)) return normalized;
  const explicit = LEGACY_PERSONA_TO_REALTIME_VOICE[normalized];
  if (explicit) return explicit;
  const hash = normalized.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return REALTIME_PREVIEW_VOICES[Math.abs(hash) % REALTIME_PREVIEW_VOICES.length];
};

const ICON_MAP: Record<string, LucideIcon> = {
  'customer-support-chat': MessageSquare,
  'healthcare-chat': Stethoscope,
  'real-estate-chat': Home,
  'legal-services-chat': Briefcase,
  'finance-banking-chat': Briefcase,
  voice: Briefcase,
};

const DEFAULT_GREETING =
  'Thanks for calling Western Care Dental. I am an AI Receptionist and can help answer any questions you have about our clinic, the services we provide or direct the call to specific users or departments. How can I help you?';

const DEFAULT_DETAILS_TO_COLLECT = {
  data_agent_uuid: '',
  details_to_collect: ['dob', 'email', 'address'] as DetailField[],
};

const normalizeKnowledgeBaseSelection = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const AI_RECEPTIONIST_KB_RETURN_STATE_KEY = 'ai_receptionist_kb_return_state';

const CreateAiReceptionist = ({
  onClose,
  initialTemplateName,
  initialTopicId,
  initialData,
  initialStep = 0,
  preselectKnowledgeBase = null,
  initialDraft = null,
}: CreateAiReceptionistProps) => {
  const { user } = useUser();
  const isEdit = Boolean(initialData?.id || initialData?.agent_uuid);
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(
    Number.isFinite(initialDraft?.currentStep) ? Number(initialDraft?.currentStep) : initialStep,
  );
  const [receptionistName, setReceptionistName] = useState(
    initialDraft?.receptionistName ?? initialData?.agentName ?? initialTemplateName ?? '',
  );
  const [greetingText, setGreetingText] = useState(
    initialDraft?.greetingText ?? initialData?.firstMessage ?? '',
  );
  const [systemPrompt, setSystemPrompt] = useState(
    initialDraft?.systemPrompt ?? initialData?.systemPrompt ?? '',
  );

  const [enableTranscripts, setEnableTranscripts] = useState(
    initialDraft?.enableTranscripts ?? initialData?.forward_call_actions?.transcription ?? true,
  );
  const [enableCallMonitoring, setEnableCallMonitoring] = useState(
    initialDraft?.enableCallMonitoring ??
      initialData?.forward_call_actions?.ai_call_monitoring ??
      true,
  );
  const initialEnableHumanHandoff =
    initialDraft?.enableHumanHandoff ??
    initialData?.forward_call_actions?.enableHumanHandoff ??
    initialData?.forward_call_actions?.enable_human_handoff ??
    true;
  const initialEnableCallbackScheduling =
    initialDraft?.enableCallbackScheduling ??
    initialData?.forward_call_actions?.enableCallbackScheduling ??
    initialData?.forward_call_actions?.enable_callback_scheduling ??
    false;
  const [enableHumanHandoff, setEnableHumanHandoff] = useState(initialEnableHumanHandoff);
  const [enableCallbackScheduling, setEnableCallbackScheduling] = useState(
    initialEnableCallbackScheduling,
  );
  const [temperature, setTemperature] = useState(
    initialDraft?.temperature ??
      Object.entries(TEMPERATURE_MAP).find(
        ([, v]) => v === initialData?.forward_call_actions?.temperature,
      )?.[0] ??
      TEMPERATURE_OPTIONS[0],
  );
  const [maxSessionDuration, setMaxSessionDuration] = useState<number>(() => {
    if (
      initialDraft?.maxSessionDuration !== undefined &&
      initialDraft?.maxSessionDuration !== null
    ) {
      return normalizeMaxSessionDurationMinutes(initialDraft.maxSessionDuration);
    }

    return normalizeMaxSessionDurationMinutes(
      initialData?.forward_call_actions?.maxSessionDuration ??
        initialData?.forward_call_actions?.max_session_duration,
    );
  });
  const [idleReminder, setIdleReminder] = useState<number>(() => {
    if (initialDraft?.idleReminder !== undefined && initialDraft?.idleReminder !== null) {
      return normalizeIdleReminderSeconds(initialDraft.idleReminder);
    }

    return normalizeIdleReminderSeconds(
      initialData?.forward_call_actions?.idleReminder ??
        initialData?.forward_call_actions?.idle_reminder,
    );
  });
  const [idleReminderRetry, setIdleReminderRetry] = useState<number>(() => {
    if (initialDraft?.idleReminderRetry !== undefined && initialDraft?.idleReminderRetry !== null) {
      return normalizeIdleReminderRetry(initialDraft.idleReminderRetry);
    }

    return normalizeIdleReminderRetry(
      initialData?.forward_call_actions?.idleReminderRetry ??
        initialData?.forward_call_actions?.idle_reminder_retry,
    );
  });

  const initialDetails = useMemo(() => {
    const detailsArr =
      initialData?.forward_call_actions?.data_agent?.details_to_collect ||
      initialData?.forward_call_actions?.detailsToCollect ||
      DEFAULT_DETAILS_TO_COLLECT.details_to_collect;

    return {
      data_agent_uuid: '',
      details_to_collect: ensurePhoneMandatory(detailsArr as DetailField[]),
    };
  }, [initialData]);

  const initialDataCollectionEnabled = useMemo(() => {
    const dataAgentDetails = initialData?.forward_call_actions?.data_agent?.details_to_collect;
    if (Array.isArray(dataAgentDetails)) return dataAgentDetails.length > 0;

    const legacyDetails = initialData?.forward_call_actions?.detailsToCollect;
    if (Array.isArray(legacyDetails)) return legacyDetails.length > 0;

    return true;
  }, [initialData]);

  const [isDataCollectionEnabled, setIsDataCollectionEnabled] = useState(
    initialDraft?.isDataCollectionEnabled ??
      (Array.isArray(initialDraft?.detailsToCollect?.details_to_collect)
        ? initialDraft.detailsToCollect.details_to_collect.length > 0
        : initialDataCollectionEnabled),
  );

  const [detailsToCollect, setDetailsToCollect] = useState(
    initialDraft?.detailsToCollect
      ? {
          ...initialDraft.detailsToCollect,
          details_to_collect: ensurePhoneMandatory(
            (initialDraft.detailsToCollect.details_to_collect || []) as DetailField[],
          ),
        }
      : initialDetails,
  );
  const [selectedLanguage, setSelectedLanguage] = useState(
    initialDraft?.selectedLanguage ?? initialData?.language ?? languageOptions[0].value,
  );
  const [selectedPersona, setSelectedPersona] = useState(() =>
    normalizeStoredVoiceValue(
      initialDraft?.selectedPersona ?? initialData?.agentVoice ?? voiceOptions[0].value,
    ),
  );
  const [selectedCompanyDetailsKb, setSelectedCompanyDetailsKb] = useState(
    initialDraft?.selectedCompanyDetailsKb ??
      normalizeKnowledgeBaseSelection(initialData?.text_uuid),
  );
  const [selectedWebsiteKb, setSelectedWebsiteKb] = useState(
    initialDraft?.selectedWebsiteKb ?? normalizeKnowledgeBaseSelection(initialData?.url_uuid),
  );
  const [selectedDocumentKb, setSelectedDocumentKb] = useState(
    initialDraft?.selectedDocumentKb ?? normalizeKnowledgeBaseSelection(initialData?.pdf_uuid),
  );
  const [selectedLocationId, setSelectedLocationId] = useState(
    initialDraft?.selectedLocationId ?? initialData?.site_uuid ?? '',
  );

  const [selectedTopicId, setSelectedTopicId] = useState(
    initialDraft?.selectedTopicId ?? initialTopicId ?? '',
  );

  const [selectedManagerId, setSelectedManagerId] = useState<string>(
    initialDraft?.selectedManagerId ??
      initialData?.forward_call_actions?.manager?.id ??
      initialData?.forward_call_actions?.manager?.manager_id ??
      '',
  );
  const [managerSearch, setManagerSearch] = useState('');

  const [isTemplateDropdownOpen, setIsTemplateDropdownOpen] = useState(false);
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);

  const [modalState, setModalState] = useState({
    regionalModal: false,
    bussinessHoursModal: false,
    humanHandoffModal: false,
  });
  const [isForwardDestinationModalOpen, setIsForwardDestinationModalOpen] = useState(false);
  const [forwardDestinationSnapshot, setForwardDestinationSnapshot] =
    useState<ForwardCallState | null>(null);
  const isForwardModalSavingRef = useRef(false);
  const [bussinessHourError, setBussinessHourError] = useState<string | null>('');
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  console.log(stepErrors, 'stepErrorsstepErrors');

  const [invalidStepIndexes, setInvalidStepIndexes] = useState<number[]>([]);
  const userRegionalSettings = user?.settings?.operational_hours?.regional;
  const formattedOperationalHours = useMemo(() => {
    const rawHours = initialData?.forward_call_actions?.condition?.operational_hours;
    const operationalHours = rawHours
      ? {
          ...rawHours,
          closed_hour_action: {
            enabled: rawHours.closed_hour_action?.enabled ?? false,
            personal: rawHours.closed_hour_action?.personal ?? true,
            type:
              typeof rawHours.closed_hour_action?.type === 'object'
                ? rawHours.closed_hour_action.type
                : {
                    value: rawHours.closed_hour_action?.type || '',
                    label:
                      rawHours.closed_hour_action?.type_label ||
                      rawHours.closed_hour_action?.type ||
                      '',
                  },
            value:
              typeof rawHours.closed_hour_action?.value === 'object'
                ? rawHours.closed_hour_action.value
                : {
                    value: rawHours.closed_hour_action?.value || '',
                    label:
                      rawHours.closed_hour_action?.value_label ||
                      rawHours.closed_hour_action?.value ||
                      '',
                  },
          },
        }
      : OPERATIONAL_HOURS;

    return withRegionalSettingsFallback(operationalHours, userRegionalSettings);
  }, [initialData, userRegionalSettings]);
  const draftForwardCall = initialDraft?.formValues?.callRules?.forwardCall;
  const draftOperationalHours = initialDraft?.formValues?.settings?.operational_hours;
  const initialOperationalHours = useMemo(
    () =>
      withRegionalSettingsFallback(
        draftOperationalHours || formattedOperationalHours,
        userRegionalSettings,
      ),
    [draftOperationalHours, formattedOperationalHours, userRegionalSettings],
  );

  const formInstance = useForm({
    defaultValues: {
      settings: {
        operational_hours: initialOperationalHours,
      },
      callRules: {
        forwardCall: {
          enabled: draftForwardCall?.enabled ?? initialEnableHumanHandoff,
          type: {
            label:
              draftForwardCall?.type?.label ||
              (initialData?.forward_call_actions?.call_handling?.business_hours?.type
                ? getForwardTypeLabel(
                    initialData?.forward_call_actions?.call_handling?.business_hours?.type,
                  )
                : 'Hangup'),
            value:
              draftForwardCall?.type?.value ||
              initialData?.forward_call_actions?.call_handling?.business_hours?.type ||
              'HANGUP',
          },
          value: {
            label:
              draftForwardCall?.value?.label ||
              initialData?.forward_call_actions?.call_handling?.business_hours?.label ||
              '',
            value:
              draftForwardCall?.value?.value ||
              initialData?.forward_call_actions?.call_handling?.business_hours?.value ||
              '',
          },
          personal:
            typeof draftForwardCall?.personal === 'boolean'
              ? draftForwardCall.personal
              : !initialData?.forward_call_actions?.call_handling?.business_hours?.value,
        },
      },
    },
    mode: 'onChange',
  });

  const { data: agentTypeData } = useQuery({
    queryKey: ['getAIAgentType'],
    queryFn: () => getAIAgentType({ type: 'voice' }),
    select: (data: any) => {
      return data?.data || [];
    },
  });

  const dynamicTopics = useMemo(() => {
    const rawApiData = agentTypeData || [];
    if (rawApiData.length === 0) return [];

    return rawApiData.map((item: any) => ({
      id: item.value,
      agentType: item.value,
      title: item.label,
      icon: ICON_MAP[item.value] || Briefcase,
      description: item.welcome_greeting,
      systemPrompt: item.systemPrompt,
    }));
  }, [agentTypeData]);

  useEffect(() => {
    if (isEdit && initialData && dynamicTopics.length > 0) {
      const topic = dynamicTopics.find((t: any) => t.agentType === initialData.agentType);
      if (topic) setSelectedTopicId(topic.id);
    }
  }, [isEdit, initialData, dynamicTopics]);

  const {
    watch,
    setValue,
    formState: { errors },
    reset,
  } = formInstance;

  useEffect(() => {
    if (selectedLocationId === 'none' || !hasCompleteRegionalSettings(userRegionalSettings)) {
      return;
    }

    const regionalFieldName = 'settings.operational_hours.regional' as const;
    const currentRegionalSettings = formInstance.getValues(regionalFieldName);
    if (
      hasCompleteRegionalSettings(currentRegionalSettings) ||
      formInstance.getFieldState(regionalFieldName).isDirty
    ) {
      return;
    }

    setValue(regionalFieldName, normalizeRegionalSettings(userRegionalSettings), {
      shouldDirty: false,
      shouldValidate: true,
    });
    setStepErrors((prev) => ({ ...prev, regionalSettings: '' }));
  }, [formInstance, selectedLocationId, setValue, userRegionalSettings]);
  const [committedForwardState, setCommittedForwardState] = useState<ForwardCallState>(() =>
    cloneForwardCallState(formInstance.getValues('callRules.forwardCall') as ForwardCallState),
  );

  useEffect(() => {
    if (initialDraft) return;
    if (isEdit && initialData) {
      setReceptionistName(initialData.agentName || '');
      setGreetingText(initialData.firstMessage || DEFAULT_GREETING);
      setEnableTranscripts(initialData.forward_call_actions?.transcription ?? true);
      const initialMaxSessionDuration = normalizeMaxSessionDurationMinutes(
        initialData.forward_call_actions?.maxSessionDuration ??
          initialData.forward_call_actions?.max_session_duration,
      );
      setMaxSessionDuration(initialMaxSessionDuration);
      setIdleReminder(
        normalizeIdleReminderSeconds(
          initialData.forward_call_actions?.idleReminder ??
            initialData.forward_call_actions?.idle_reminder,
        ),
      );
      setIdleReminderRetry(
        normalizeIdleReminderRetry(
          initialData.forward_call_actions?.idleReminderRetry ??
            initialData.forward_call_actions?.idle_reminder_retry,
        ),
      );
      setTemperature(
        Object.entries(TEMPERATURE_MAP).find(
          ([, v]) => v === initialData.forward_call_actions?.temperature,
        )?.[0] || TEMPERATURE_OPTIONS[0],
      );
      setSelectedLanguage(initialData.language || languageOptions[0].value);
      setSelectedPersona(
        normalizeStoredVoiceValue(initialData.agentVoice || voiceOptions[0].value),
      );
      setSelectedCompanyDetailsKb(normalizeKnowledgeBaseSelection(initialData.text_uuid));
      setSelectedWebsiteKb(normalizeKnowledgeBaseSelection(initialData.url_uuid));
      setSelectedDocumentKb(normalizeKnowledgeBaseSelection(initialData.pdf_uuid));
      setSelectedLocationId(initialData.site_uuid || '');
      setEnableHumanHandoff(
        initialData.forward_call_actions?.enableHumanHandoff ??
          initialData.forward_call_actions?.enable_human_handoff ??
          true,
      );
      setEnableCallbackScheduling(
        initialData.forward_call_actions?.enableCallbackScheduling ??
          initialData.forward_call_actions?.enable_callback_scheduling ??
          false,
      );
      setSelectedManagerId(
        initialData.forward_call_actions?.manager?.id ||
          initialData.forward_call_actions?.manager?.manager_id ||
          '',
      );
      setSelectedTopicId(
        dynamicTopics.find((t: any) => t.agentType === initialData.agentType)?.id || '',
      );

      const detailsArr =
        initialData.forward_call_actions?.data_agent?.details_to_collect ||
        initialData.forward_call_actions?.detailsToCollect ||
        DEFAULT_DETAILS_TO_COLLECT.details_to_collect;
      setIsDataCollectionEnabled(
        Array.isArray(detailsArr) ? detailsArr.length > 0 : initialDataCollectionEnabled,
      );

      setDetailsToCollect({
        data_agent_uuid: '',
        details_to_collect: ensurePhoneMandatory(detailsArr as DetailField[]),
      });

      const resetForwardCall: ForwardCallState = {
        enabled: initialEnableHumanHandoff,
        type: {
          label: initialData?.forward_call_actions?.call_handling?.business_hours?.type
            ? getForwardTypeLabel(
                initialData?.forward_call_actions?.call_handling?.business_hours?.type,
              )
            : 'Hangup',
          value: initialData?.forward_call_actions?.call_handling?.business_hours?.type || 'HANGUP',
        },
        value: {
          label: initialData?.forward_call_actions?.call_handling?.business_hours?.label || '',
          value: initialData?.forward_call_actions?.call_handling?.business_hours?.value || '',
        },
        personal: !initialData?.forward_call_actions?.call_handling?.business_hours?.value,
      };

      reset({
        settings: {
          operational_hours: formattedOperationalHours,
        },
        callRules: {
          forwardCall: resetForwardCall,
        },
      });
      setCommittedForwardState(cloneForwardCallState(resetForwardCall));
    }
  }, [initialData, initialDataCollectionEnabled, initialDraft, isEdit, reset]);

  const { data: extensionList = [] } = useGetExtensions({
    page: 1,
    limit: 1000,
    filters: [],
    search: '',
  });
  const debouncedManagerSearch = useDebounce(managerSearch, 300);
  const {
    users: managerUserList,
    fetchNextPage: fetchNextManagerPage,
    hasNextPage: hasNextManagerPage = false,
    isFetchingNextPage: isFetchingNextManagerPage,
    isLoading: isLoadingManagerUsers,
  } = usePaginatedUsers({
    search: debouncedManagerSearch,
    queryKey: ['legacyAiReceptionistManagerUsers'],
    params: { role: ['MANAGER', 'SUB-ADMIN', 'ADMIN'] },
  });
  const { greetingList = [] } = useGetGreetings({ displayType: 'dropdown' });
  const { data: departmentList = [] } = useGetDepartment({ displayType: 'dropdown' });
  const { data: IVRList = [] } = useGetIVR({ displayType: 'dropdown' });
  const { data: queueList = [] } = useGetQueueList({ displayType: 'dropdown' });

  const managerExtensions = useMemo(() => {
    const managers = managerUserList.filter((user: any) =>
      ['MANAGER', 'SUB-ADMIN', 'ADMIN'].includes(getManagerUserRole(user)),
    );
    const selectedManager = extensionList.find(
      (user: any) => getManagerUserId(user) === String(selectedManagerId),
    );

    if (
      selectedManager &&
      !managers.some((user: any) => getManagerUserId(user) === getManagerUserId(selectedManager))
    ) {
      managers.unshift(selectedManager);
    }

    return managers;
  }, [extensionList, managerUserList, selectedManagerId]);

  const forwardingOptionsData = useMemo(
    () => ({
      extensionList,
      greetingList,
      departmentList,
      IVRList,
      queueList,
    }),
    [extensionList, greetingList, departmentList, IVRList, queueList],
  );
  const operational_hours = watch('settings.operational_hours');
  const forwardCallState = watch('callRules.forwardCall') as ForwardCallState;
  const selectedForwardType = forwardCallState?.type?.value || 'HANGUP';
  const selectedForwardTypeLabel =
    forwardCallState?.type?.label || getForwardTypeLabel(selectedForwardType);
  const showForwardToForType = (type?: string) => type !== 'HANGUP';
  const shouldShowForwardTo = showForwardToForType(selectedForwardType);
  const committedForwardType = committedForwardState?.type?.value || 'HANGUP';
  const committedForwardTypeLabel =
    committedForwardState?.type?.label || getForwardTypeLabel(committedForwardType);
  const committedShouldShowForwardTo = showForwardToForType(committedForwardType);
  const committedForwardValueLabel = committedShouldShowForwardTo
    ? committedForwardType === 'VOICEMAIL' && committedForwardState?.personal
      ? 'My Voicemail'
      : committedForwardState?.value?.label ||
        getForwardDestinationValue(committedForwardState) ||
        '-'
    : '-';
  const selectedForwardValueLabel = shouldShowForwardTo
    ? selectedForwardType === 'VOICEMAIL' && forwardCallState?.personal
      ? 'My Voicemail'
      : forwardCallState?.value?.label || getForwardDestinationValue(forwardCallState) || '-'
    : '-';
  const forwardValueFieldLabel = getForwardValueFieldLabel(selectedForwardType);
  const committedForwardValueFieldLabel = getForwardValueFieldLabel(committedForwardType);
  const resolveForwardDestinationLabel = (forwardState?: ForwardCallState) => {
    const type = forwardState?.type?.value || '';
    const destinationId = getForwardDestinationValue(forwardState);
    if (!destinationId) return '-';

    if (type === 'QUEUE') {
      const matchedQueue = Array.isArray(queueList)
        ? queueList.find((q: any) =>
            [q?.uuid, q?._id, q?.id].map((id) => String(id || '')).includes(destinationId),
          )
        : null;
      return matchedQueue?.name || forwardState?.value?.label || destinationId;
    }

    return forwardState?.value?.label || destinationId;
  };
  const selectedForwardValueDisplay = resolveForwardDestinationLabel(forwardCallState);
  const committedForwardValueDisplay = resolveForwardDestinationLabel(committedForwardState);

  const openModal = (key: keyof typeof modalState) => {
    setModalState((prev) => ({ ...prev, [key]: true }));
  };

  const closeModal = (key: keyof typeof modalState) => {
    setModalState((prev) => ({ ...prev, [key]: false }));
  };

  const previewRoomRef = useRef<Room | null>(null);
  const previewAudioElementsRef = useRef<HTMLAudioElement[]>([]);
  const previewAutoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSessionIdRef = useRef<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<string | null>(null);

  const stopAudio = async () => {
    if (previewAutoStopRef.current) {
      clearTimeout(previewAutoStopRef.current);
      previewAutoStopRef.current = null;
    }

    previewAudioElementsRef.current.forEach((audioEl) => {
      try {
        audioEl.pause();
        audioEl.srcObject = null;
        audioEl.remove();
      } catch {
        // ignore
      }
    });
    previewAudioElementsRef.current = [];

    const sessionIdToFinalize = String(previewSessionIdRef.current || '').trim();
    previewSessionIdRef.current = '';

    if (previewRoomRef.current) {
      try {
        previewRoomRef.current.disconnect();
      } catch {
        // ignore
      }
      previewRoomRef.current = null;
    }

    if (sessionIdToFinalize) {
      try {
        const tokenResponse = await fetchToken();
        const tokenId = tokenResponse?.data?.data?.result?.tokenId;
        if (tokenId) {
          await finalizeAgentSession(
            {
              token: tokenId,
              agentId: '',
              sessionId: sessionIdToFinalize,
              source: 'voice_preview_stop',
              endReason: 'manual_end',
            },
            { hideToastOnError: true },
          );
        }
      } catch {
        // ignore finalize failures in preview mode
      }
    }

    setIsPlaying(false);
    setCurrentAudio(null);
  };

  const handlePlayPause = async (voice: { value: string }) => {
    const selectedVoiceValue = String(voice?.value || '').trim();
    if (!selectedVoiceValue) return;

    if (isPlaying && currentAudio === selectedVoiceValue) {
      await stopAudio();
      return;
    }

    await stopAudio();
    setCurrentAudio(selectedVoiceValue);
    setIsPlaying(true);

    try {
      const tokenResponse = await fetchToken();
      const tokenId = tokenResponse?.data?.data?.result?.tokenId;
      if (!tokenId) {
        throw new Error('Unable to create preview token');
      }

      const previewVoice = resolveRealtimePreviewVoice(selectedVoiceValue);
      const sessionResponse = await createWebRTCVoiceSession({
        token: tokenId,
        previewMode: true,
        previewVoice,
        previewText: PREVIEW_DEMO_TEXT,
        preferredProvider: 'livekit',
      });

      const sessionData = sessionResponse?.data || {};
      if (sessionData?.limitExceeded) {
        throw new Error(sessionData?.message || 'Preview session limit exceeded');
      }

      const sessionId = String(sessionData?.sessionId || '').trim();
      if (sessionId) {
        previewSessionIdRef.current = sessionId;
      }

      const livekitData = sessionData?.webrtc?.livekit || sessionData?.livekit || {};
      const livekitUrl = String(
        livekitData?.url || sessionData?.webrtc?.livekitUrl || sessionData?.livekitUrl || '',
      ).trim();
      const livekitToken = String(
        livekitData?.token ||
          sessionData?.webrtc?.livekitToken ||
          sessionData?.livekitToken ||
          sessionData?.webrtc?.clientSecret ||
          '',
      ).trim();

      if (!livekitUrl || !livekitToken) {
        throw new Error('Missing LiveKit connection details for preview');
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      previewRoomRef.current = room;

      const attachAudioTrack = (track: any) => {
        if (!track || track.kind !== Track.Kind.Audio) return;
        const audioEl = track.attach();
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        audioEl.muted = false;
        audioEl.style.display = 'none';
        previewAudioElementsRef.current.push(audioEl);
        document.body.appendChild(audioEl);
      };

      room.on(RoomEvent.TrackSubscribed, (track: any) => {
        attachAudioTrack(track);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
        try {
          track.detach().forEach((el: any) => {
            if (el && typeof el.remove === 'function') {
              el.remove();
            }
          });
        } catch {
          // ignore
        }
      });

      await room.connect(livekitUrl, livekitToken);
      await room.localParticipant.setMicrophoneEnabled(false);

      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.track && publication.track.kind === Track.Kind.Audio) {
            attachAudioTrack(publication.track);
          }
        });
      });

      previewAutoStopRef.current = setTimeout(() => {
        void stopAudio();
      }, PREVIEW_AUTO_STOP_MS);
    } catch (error: any) {
      await stopAudio();
      handleAlert({
        text: String(
          error?.response?.data?.error || error?.message || 'Failed to start voice preview',
        ),
        type: 'error',
      });
    }
  };

  useEffect(() => {
    return () => {
      void stopAudio();
    };
  }, []);

  const { data: kbData = [] } = useQuery({
    queryKey: ['AIUserKnowledgeBase'],
    queryFn: () => AIUserKnowledgeBase({}),
    select: (data: any) => data?.data?.data?.result?.rows || [],
  });

  const textKbItems = useMemo(() => kbData.filter((item: any) => item.type === 'text'), [kbData]);
  const urlKbItems = useMemo(() => kbData.filter((item: any) => item.type === 'url'), [kbData]);
  const pdfKbItems = useMemo(() => kbData.filter((item: any) => item.type === 'pdf'), [kbData]);

  const { data: sites = [] } = useQuery({
    queryKey: ['siteList'],
    queryFn: () => siteList({ page: 1, limit: 1000 }),
    select: (data: any) => data?.data?.data?.result?.rows || [],
  });
  useEffect(() => {
    if (!selectedLocationId && sites.length > 0) {
      const defaultSite = sites.find((s: any) => s.is_default === '1');
      if (defaultSite) {
        setSelectedLocationId(defaultSite.uuid || defaultSite.id);
      } else {
        setSelectedLocationId(sites[0].uuid || sites[0].id);
      }
    }
  }, [sites, selectedLocationId]);

  useEffect(() => {
    if (initialDraft) return;
    if (initialTopicId) {
      setSelectedTopicId(initialTopicId);
      const topic = dynamicTopics.find((t: any) => t.id === initialTopicId);
      if (topic) {
        setGreetingText(topic.description);
        setSystemPrompt(topic.systemPrompt || '');
      }
    }
  }, [dynamicTopics, initialDraft, initialTopicId]);

  useEffect(() => {
    if (initialDraft) return;
    if (!isEdit) {
      setReceptionistName(initialTemplateName || '');
    }
  }, [initialDraft, initialTemplateName, isEdit]);

  useEffect(() => {
    setCurrentStep(initialStep);
  }, [initialStep]);

  useEffect(() => {
    const preselectId = preselectKnowledgeBase?.ingestionId
      ? String(preselectKnowledgeBase.ingestionId)
      : '';
    const preselectType = preselectKnowledgeBase?.type;
    if (!preselectId || !preselectType) return;

    if (preselectType === 'text') {
      setSelectedCompanyDetailsKb((prev) =>
        prev.includes(preselectId) ? prev : [...prev, preselectId],
      );
    } else if (preselectType === 'url') {
      setSelectedWebsiteKb((prev) => (prev.includes(preselectId) ? prev : [...prev, preselectId]));
    } else if (preselectType === 'pdf') {
      setSelectedDocumentKb((prev) => (prev.includes(preselectId) ? prev : [...prev, preselectId]));
    }

    setStepErrors((prev) => ({ ...prev, companyDescription: '' }));
  }, [preselectKnowledgeBase]);

  const handleOpenKnowledgeBasePage = () => {
    const receptionistDraft: AiReceptionistDraftState = {
      receptionistName,
      greetingText,
      systemPrompt,
      enableTranscripts,
      enableCallMonitoring,
      temperature,
      maxSessionDuration,
      idleReminder,
      idleReminderRetry,
      detailsToCollect,
      isDataCollectionEnabled,
      selectedLanguage,
      selectedPersona,
      selectedCompanyDetailsKb,
      selectedWebsiteKb,
      selectedDocumentKb,
      selectedLocationId,
      selectedTopicId,
      enableHumanHandoff,
      enableCallbackScheduling,
      currentStep,
      formValues: formInstance.getValues(),
    };
    const returnToState = {
      editData: isEdit ? initialData : null,
      selectedBuildMode: initialTopicId || initialTemplateName ? 'template' : 'scratch',
      selectedTemplateName: initialTemplateName || '',
      selectedTemplateId: initialTopicId || '',
      receptionistDraft,
    };

    try {
      window.sessionStorage.setItem(
        AI_RECEPTIONIST_KB_RETURN_STATE_KEY,
        JSON.stringify(returnToState),
      );
    } catch (error) {
      console.warn('Unable to persist AI Receptionist draft before KB navigation.', error);
    }

    navigate('/admin-settings/knowledge/all-knowledge-base', {
      state: {
        returnTo: '/admin-settings/knowledge/ai-receptionist',
        returnToStep: currentStep,
        returnToState,
      },
    });
  };

  const isAllDetailsSelected = useMemo(
    () => detailsToCollect.details_to_collect.length === 5,
    [detailsToCollect],
  );

  const validateStep = (stepIndex: number) => {
    const newErrors: Record<string, string> = {};

    if (stepIndex === 0) {
      if (!receptionistName.trim())
        newErrors.receptionistName = 'AI Receptionist name is required.';
      if (!greetingText.trim()) newErrors.greetingText = 'Welcome greeting is required.';
    } else if (stepIndex === 1) {
      if (!selectedLanguage) newErrors.selectedLanguage = 'Please select a language.';
      if (!selectedPersona) newErrors.selectedPersona = 'Please select a voice persona.';
    } else if (stepIndex === 2) {
      if (
        selectedCompanyDetailsKb.length === 0 &&
        selectedWebsiteKb.length === 0 &&
        selectedDocumentKb.length === 0
      ) {
        newErrors.companyDescription =
          'Please select at least one knowledge base (Company Details, Website, or Document).';
      }
    } else if (stepIndex === 3) {
      if (selectedLocationId !== 'none') {
        const regional = formInstance.getValues('settings.operational_hours.regional');
        if (!hasCompleteRegionalSettings(regional)) {
          newErrors.regionalSettings = 'Please configure Regional Settings before continuing.';
        }
      }
    } else if (stepIndex === 4) {
      if (!enableHumanHandoff) return newErrors;

      const forwardCall = watch('callRules.forwardCall');
      const forwardDestinationValue = getForwardDestinationValue(forwardCall);
      if (!forwardCall?.type?.value) newErrors.forwardCall = 'Please select a forwarding type.';
      const needsValue =
        forwardCall?.type?.value && !['HANGUP', 'VOICEMAIL'].includes(forwardCall.type.value);

      if (needsValue && !forwardDestinationValue)
        newErrors.forwardCall = 'Please select a forwarding destination.';
      if (
        forwardCall?.type?.value === 'VOICEMAIL' &&
        !forwardCall?.personal &&
        !forwardDestinationValue
      ) {
        newErrors.forwardCall = 'Please select a voicemail destination.';
      }

      if (!selectedManagerId) {
        newErrors.manager = 'Please select a manager.';
      }
    }

    return newErrors;
  };

  const handleContinue = () => {
    const newErrors = validateStep(currentStep);
    if (Object.keys(newErrors).length > 0) {
      setStepErrors(newErrors);
      setInvalidStepIndexes([currentStep]);
      return;
    }
    stopAudio();
    setStepErrors({});
    setInvalidStepIndexes([]);
    setCurrentStep((prev) => Math.min(prev + 1, STEP_ITEMS.length - 1));
  };

  const handleBack = () => {
    setStepErrors({});
    setInvalidStepIndexes([]);
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleStepClick = (targetStep: number) => {
    if (targetStep === currentStep) return;

    if (targetStep < currentStep) {
      stopAudio();
      setStepErrors({});
      setInvalidStepIndexes([]);
      setCurrentStep(targetStep);
      return;
    }

    const mergedErrors: Record<string, string> = {};
    const blockedSteps: number[] = [];

    for (let stepIndex = 0; stepIndex < targetStep; stepIndex += 1) {
      const stepValidationErrors = validateStep(stepIndex);
      if (Object.keys(stepValidationErrors).length > 0) {
        blockedSteps.push(stepIndex);
        Object.assign(mergedErrors, stepValidationErrors);
      }
    }

    if (blockedSteps.length > 0) {
      setStepErrors(mergedErrors);
      setInvalidStepIndexes(Array.from(new Set([...blockedSteps, targetStep])));
      return;
    }

    stopAudio();
    setStepErrors({});
    setInvalidStepIndexes([]);
    setCurrentStep(targetStep);
  };

  const handleOpenForwardDestinationModal = () => {
    const currentForwardState = formInstance.getValues('callRules.forwardCall') as ForwardCallState;
    setForwardDestinationSnapshot(cloneForwardCallState(currentForwardState));
    setIsForwardDestinationModalOpen(true);
  };

  const handleCancelForwardDestinationEdit = () => {
    if (forwardDestinationSnapshot) {
      setValue('callRules.forwardCall', forwardDestinationSnapshot as any);
    }
    isForwardModalSavingRef.current = false;
    setIsForwardDestinationModalOpen(false);
  };

  const handleSaveForwardDestinationEdit = () => {
    const latestForwardState = formInstance.getValues('callRules.forwardCall') as ForwardCallState;
    setCommittedForwardState(cloneForwardCallState(latestForwardState));
    setStepErrors((prev) => ({ ...prev, forwardCall: '' }));
    isForwardModalSavingRef.current = true;
    setIsForwardDestinationModalOpen(false);
  };

  const buildPayload = () => {
    const formValues = formInstance.getValues();
    const operational_hours = formValues.settings?.operational_hours;
    const forwardCall = formValues.callRules?.forwardCall;
    const forwardDestinationValue = getForwardDestinationValue(forwardCall);

    const selectedManager = [...managerUserList, ...extensionList].find(
      (user: any) => getManagerUserId(user) === String(selectedManagerId),
    );

    return {
      ...(isEdit ? { agentId: initialData?.agent_uuid || initialData?.id } : {}),
      agentName: receptionistName,
      agentType: dynamicTopics.find((t: any) => t.id === selectedTopicId)?.agentType ?? 'voice',
      firstMessage: greetingText,
      systemPrompt: systemPrompt,
      language: selectedLanguage,
      agentVoice: selectedPersona,
      text_uuid: selectedCompanyDetailsKb,
      url_uuid: selectedWebsiteKb,
      pdf_uuid: selectedDocumentKb,
      site_uuid: selectedLocationId !== 'none' ? selectedLocationId : '',

      token: '',
      forward_call_actions: {
        condition: {
          operational_hours: {
            regional: operational_hours?.regional ?? {},
            type: operational_hours?.type ?? '24_hours',
            value: operational_hours?.value ?? {},
            holidays: operational_hours?.holidays ?? [],
            closed_hour_action: {
              type: operational_hours?.closed_hour_action?.type?.value,
              value: operational_hours?.closed_hour_action?.value?.value,
              enabled: operational_hours?.closed_hour_action?.enabled,
              personal: operational_hours?.closed_hour_action?.personal,
              type_label: operational_hours?.closed_hour_action?.type?.label,
              value_label: operational_hours?.closed_hour_action?.value?.label,
            },
          },
          recording: {
            on_demand: {
              enabled: true,
              recording_on: 'ad98d65d-fcf8-4d4d-bc77-ee1426c34331.mp3',
              recording_Off: 'ad98d65d-fcf8-4d4d-bc77-ee1426c34332.mp3',
            },
            automatic: {
              enabled: true,
              label: 'All',
              value: 'all',
              recording_on: 'ad98d65d-fcf8-4d4d-bc77-ee1426c34333.mp3',
            },
          },
          display_number: {
            incoming: { label: 'Yes', value: true },
            masking: { type: 'N', value: '', label: 'None' },
            show_number_if_blocked: 'NO',
          },
          caller_id: [],
        },
        manager: selectedManagerId
          ? {
              id: selectedManager?.uuid || selectedManager?.id || selectedManagerId,
              name: `${selectedManager?.first_name || ''} ${selectedManager?.last_name || ''}`.trim(),
              extension: selectedManager?.extension || '',
              role: getManagerUserRole(selectedManager) || 'MANAGER',
            }
          : null,
        enableHumanHandoff,
        enableCallbackScheduling,
        call_handling: {
          business_hours: {
            type: forwardCall?.type?.value ?? '',
            value: forwardDestinationValue,
            label: '',
            // label: forwardCall?.value?.label ?? '',
          },
        },
        media: {
          welcome: { enabled: false, value: '' },
          hold: { enabled: false, value: '' },
          voicemail: { enabled: false, value: '' },
        },
        transcription: enableTranscripts,
        ai_call_monitoring: enableCallMonitoring,
        temperature: TEMPERATURE_MAP[temperature] ?? 'low',
        maxSessionDuration,
        idleReminder,
        idleReminderRetry,
        data_agent: {
          ...detailsToCollect,
          details_to_collect: isDataCollectionEnabled
            ? ensurePhoneMandatory(detailsToCollect.details_to_collect as DetailField[])
            : [],
        },
      },
    };
  };

  const { mutate: submitAgent, isPending: isSubmitting } = useMutation({
    mutationFn: isEdit ? updateAiReceptionist : createAiReceptionist,
    onSuccess: () => {
      handleAlert({
        text: `AI Receptionist ${isEdit ? 'updated' : 'created'} successfully!`,
        type: 'success',
      });
      onClose();
    },
    onError: (err: any) => {
      console.error(`Failed to ${isEdit ? 'update' : 'create'} AI Receptionist:`, err);
    },
  });

  const { mutateAsync: fetchToken, isPending: isPendingToken } = useMutation({
    mutationFn: getAIAgentToken,
    mutationKey: ['getAIAgentToken'],
  });

  const handleFinish = async () => {
    const tokenResponse = await fetchToken();
    const tokenId = tokenResponse?.data?.data?.result?.tokenId;
    const payload = buildPayload();
    payload.token = tokenId ?? '';
    submitAgent(payload);
  };

  const toggleAllDetails = (checked: boolean) => {
    setDetailsToCollect((prev) => ({
      ...prev,
      details_to_collect: checked
        ? ensurePhoneMandatory(['name', 'dob', 'phone', 'email', 'address'] as DetailField[])
        : ensurePhoneMandatory([]),
    }));
  };

  const toggleSingleDetail = (field: DetailField, checked: boolean) => {
    if (field === 'phone') {
      setDetailsToCollect((prev) => ({
        ...prev,
        details_to_collect: ensurePhoneMandatory(prev.details_to_collect as DetailField[]),
      }));
      return;
    }
    setDetailsToCollect((prev) => {
      const next = checked
        ? [...prev.details_to_collect, field]
        : prev.details_to_collect.filter((f) => f !== field);
      return { ...prev, details_to_collect: ensurePhoneMandatory(next as DetailField[]) };
    });
  };

  const renderStepFooter = () => {
    if (currentStep === 0) {
      return (
        <div className="mt-8 flex justify-center">
          <Button className="min-w-[128px]" onClick={handleContinue}>
            Continue
          </Button>
        </div>
      );
    }

    return (
      <div className="mt-8 flex items-center justify-center gap-3">
        <Button className="min-w-[128px]" variant="outline" onClick={handleBack}>
          Back
        </Button>
        <Button
          className="min-w-[128px]"
          disabled={currentStep === STEP_ITEMS.length - 1 && (isSubmitting || isPendingToken)}
          onClick={currentStep === STEP_ITEMS.length - 1 ? handleFinish : handleContinue}
        >
          {currentStep === STEP_ITEMS.length - 1
            ? isSubmitting || isPendingToken
              ? 'Saving...'
              : 'Finish'
            : 'Continue'}
        </Button>
      </div>
    );
  };

  const renderWelcomeGreetingStep = () => {
    const selectedTopic = dynamicTopics.find((t: any) => t.id === selectedTopicId);

    return (
      <div className="mx-auto w-full max-w-[900px]">
        <div className="text-center">
          <h3 className="text-xl font-semibold text-[#091A3A]">
            {isEdit ? 'Update Welcome greeting' : 'Welcome greeting'}
          </h3>
          <p className="mt-2 text-sm text-[#667085]">
            {isEdit
              ? 'Update the initial message your AI Receptionist delivers when answering a call.'
              : 'Define the initial message your AI Receptionist should deliver when answering a call.'}
          </p>
        </div>

        <div className="mt-8">
          <label className="block text-sm font-semibold text-[#091A3A]">AI Receptionist Name</label>
          <input
            value={receptionistName}
            onChange={(e) => {
              setReceptionistName(e.target.value);
              setStepErrors((p) => ({ ...p, receptionistName: '' }));
            }}
            className={`mt-3 h-11 w-full rounded-xl border bg-white px-4 text-sm text-[#091A3A] outline-none shadow-sm focus:border-primary ${
              stepErrors.receptionistName ? 'border-red-400' : 'border-gray-200'
            }`}
            placeholder="Enter AI Receptionist name"
          />
          {stepErrors.receptionistName && (
            <p className="mt-1 text-xs text-red-500">{stepErrors.receptionistName}</p>
          )}
        </div>

        <div className="mt-8">
          <label className="block text-sm font-semibold text-[#091A3A]">Suggested Templates</label>
          <div className="relative mt-3">
            <div
              onClick={() => setIsTemplateDropdownOpen(!isTemplateDropdownOpen)}
              className="flex h-14 w-full cursor-pointer items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 shadow-sm transition-all hover:border-primary/50"
            >
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-gray-400" />
                <span className="text-sm font-medium text-[#667085]">Topic:</span>
                <span className="rounded-lg bg-gray-100 px-3 py-1 text-sm font-semibold text-[#091A3A]">
                  {selectedTopic ? selectedTopic.title : 'Select a template'}
                </span>
              </div>
              <ChevronDown
                className={`h-5 w-5 text-gray-400 transition-transform ${
                  isTemplateDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </div>

            {isTemplateDropdownOpen && (
              <div className="absolute top-full z-50 mt-2 w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl">
                <div className="max-h-[320px] overflow-y-auto p-2 scrollbar-hide">
                  {dynamicTopics?.length
                    ? dynamicTopics?.map((topic: any) => {
                        const TopicIcon = topic.icon;
                        const isSelected = selectedTopicId === topic.id;

                        return (
                          <div
                            key={topic.id}
                            onClick={() => {
                              setSelectedTopicId(topic.id);
                              setGreetingText(topic.description);
                              setSystemPrompt(topic.systemPrompt || '');
                              setIsTemplateDropdownOpen(false);
                            }}
                            className={`flex cursor-pointer items-start gap-4 rounded-xl p-4 transition-colors ${
                              isSelected ? 'bg-primary/5' : 'hover:bg-gray-50'
                            }`}
                          >
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                isSelected
                                  ? 'bg-white text-primary shadow-sm'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              <TopicIcon className="h-5 w-5" />
                            </div>
                            <div className="flex-1 overflow-hidden">
                              <h5
                                className={`text-sm font-bold ${
                                  isSelected ? 'text-primary' : 'text-[#091A3A]'
                                }`}
                              >
                                {topic.title}
                              </h5>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#667085]">
                                {topic.description}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    : null}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8">
          <label className="block text-sm font-semibold text-[#091A3A]">Spoken Language</label>
          <div className="relative mt-3">
            <div
              onClick={() => setIsLanguageDropdownOpen(!isLanguageDropdownOpen)}
              className="flex h-14 w-full cursor-pointer items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 shadow-sm transition-all hover:border-primary/50"
            >
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-gray-400" />
                <span className="text-sm font-medium text-[#667085]">Language:</span>
                <span className="rounded-lg bg-gray-100 px-3 py-1 text-sm font-semibold text-[#091A3A]">
                  {languageOptions.find((l) => l.value === selectedLanguage)?.label}
                </span>
              </div>
              <ChevronDown
                className={`h-5 w-5 text-gray-400 transition-transform ${
                  isLanguageDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </div>

            {isLanguageDropdownOpen && (
              <div className="absolute top-full z-50 mt-2 w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl">
                <div className="p-2">
                  {languageOptions.map((lang) => {
                    const isSelected = selectedLanguage === lang.value;
                    return (
                      <div
                        key={lang.value}
                        onClick={() => {
                          const newLang = lang.value;
                          setSelectedLanguage(newLang);
                          if (newLang === 'spanish') {
                            setSelectedPersona(spanishVoiceOptions[0].value);
                          } else if (newLang === 'hindi') {
                            setSelectedPersona(hindiVoiceOptions[0].value);
                          } else {
                            setSelectedPersona(voiceOptions[0].value);
                          }
                          setIsLanguageDropdownOpen(false);
                        }}
                        className={`flex cursor-pointer items-center justify-between rounded-xl p-3 px-4 transition-colors ${
                          isSelected
                            ? 'bg-primary/5 text-primary font-semibold'
                            : 'hover:bg-gray-50 text-[#091A3A]'
                        }`}
                      >
                        <span className="text-sm uppercase tracking-wide">{lang.label}</span>
                        {isSelected && <Check className="h-4 w-4" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-[#667085] flex items-start gap-2 bg-gray-50 p-3 rounded-xl border border-gray-100">
            <Info className="w-4 h-4 shrink-0 text-primary mt-0.5" />
            <span>
              <strong>Note:</strong> Selecting a primary language enables your AI Receptionist to
              understand and respond accurately in that language. This will also update the
              available voice personas in the next step.
            </span>
          </p>
        </div>

        <div className="mt-8">
          <label className="block text-sm font-semibold text-[#091A3A]">Welcome Greeting</label>
          <div
            className={`mt-3 overflow-hidden rounded-2xl border bg-white ring-4 ring-primary/10 ${
              stepErrors.greetingText ? 'border-red-400' : 'border-primary'
            }`}
          >
            <textarea
              value={greetingText}
              onChange={(e) => {
                setGreetingText(e.target.value);
                setStepErrors((p) => ({ ...p, greetingText: '' }));
              }}
              className="min-h-[160px] w-full resize-none border-none p-5 text-sm leading-6 text-[#091A3A] outline-none"
            />
          </div>
          <p className="mt-3 text-xs text-[#667085] flex items-start gap-2 bg-gray-50 p-3 rounded-xl border border-gray-100">
            <Info className="w-4 h-4 shrink-0 text-primary mt-0.5" />
            <span>
              <strong>Note:</strong> Please write the welcome message in the selected language only.
              Mixed or transliterated text may not work correctly.
            </span>
          </p>
          {stepErrors.greetingText && (
            <p className="mt-1 text-xs text-red-500">{stepErrors.greetingText}</p>
          )}
        </div>

        {/* <div className="mt-8">
          <label className="block text-sm font-semibold text-[#091A3A]">System Prompt</label>
          <p className="mt-1 text-xs text-[#667085]">
            Provide core behavioral instructions. This defines the AI's persona, operational boundaries, tone, and specific interaction rules.
          </p>
          <div
            className={`mt-3 overflow-hidden rounded-2xl border bg-white ring-4 ring-primary/10 ${stepErrors.systemPrompt ? 'border-red-400' : 'border-primary'
              }`}
          >
            <textarea
              value={systemPrompt}
              onChange={(e) => {
                setSystemPrompt(e.target.value);
                setStepErrors((p) => ({ ...p, systemPrompt: '' }));
              }}
              rows={8}
              className="w-full resize-none border-none p-4 text-sm text-[#091A3A] outline-none placeholder:text-gray-400 scrollbar-hide"
              placeholder="Provide core behavioral instructions..."
            />
          </div>
          {stepErrors.systemPrompt && (
            <p className="mt-1 text-xs text-red-500">{stepErrors.systemPrompt}</p>
          )}
        </div> */}

        {renderStepFooter()}
      </div>
    );
  };

  const renderToneAndPersonalityStep = () => (
    <div className="mx-auto w-full max-w-[900px]">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-[#091A3A]">Tone and personality</h3>
        <p className="mt-2 text-sm text-[#667085]">
          Set the spoken language and select a voice persona that best fits your brand.
        </p>
      </div>

      <div className="mt-10">
        <h4 className="text-base font-semibold text-[#091A3A]">Voice Persona</h4>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(selectedLanguage === 'spanish'
            ? spanishVoiceOptions
            : selectedLanguage === 'hindi'
              ? hindiVoiceOptions
              : voiceOptions
          ).map((voice) => {
            const isSelected = selectedPersona === voice.value;
            const isVoicePlaying = isPlaying && currentAudio === voice.value;

            return (
              <div
                key={voice.value}
                onClick={() => {
                  setSelectedPersona(voice.value);
                  void stopAudio();
                }}
                className={`relative cursor-pointer rounded-2xl border p-6 text-center transition-all ${
                  isSelected ? 'border-primary bg-gray-50 shadow-sm' : 'border-gray-100 bg-gray-50'
                }`}
              >
                {isSelected ? (
                  <div className="absolute right-3 top-3 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                ) : (
                  <div
                    className={`absolute right-3 top-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      voice.gender === 'female'
                        ? 'bg-pink-100 text-pink-600'
                        : 'bg-ucass-active-bg text-ucass-active'
                    }`}
                  >
                    {voice.gender}
                  </div>
                )}
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white text-4xl shadow-inner border border-gray-100">
                  {VOICE_EMOJI_MAP[voice.label] || (voice.gender === 'female' ? '👩' : '👨')}
                </div>
                <h5 className="mt-4 text-sm font-semibold text-[#091A3A]">{voice.label}</h5>
                <button
                  type="button"
                  className={`mt-4 flex h-10 w-10 mx-auto items-center justify-center rounded-full transition-colors ${
                    isVoicePlaying
                      ? 'bg-primary/20 text-primary'
                      : 'bg-primary text-white shadow-sm hover:bg-primary/90'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handlePlayPause(voice);
                  }}
                >
                  {isVoicePlaying ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="ml-1 h-5 w-5 fill-current" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {renderStepFooter()}
    </div>
  );

  const renderCompanyDescriptionStep = () => (
    <div className="mx-auto w-full max-w-[900px]">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-[#091A3A]">Company description</h3>
        <p className="mt-2 text-sm text-[#667085]">
          Select the relevant knowledge base items for your company details, website, and documents.
        </p>
      </div>
      <div className="mt-5 flex justify-end">
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={handleOpenKnowledgeBasePage}
        >
          Add Knowledge Base
        </Button>
      </div>

      <div className="mt-10 space-y-6">
        {(() => {
          const hasKnowledgeBaseSelection =
            selectedCompanyDetailsKb.length > 0 ||
            selectedWebsiteKb.length > 0 ||
            selectedDocumentKb.length > 0;

          const renderKbSection = ({
            title,
            icon: Icon,
            items,
            selectedValues,
            setSelectedValues,
            emptyLabel,
          }: {
            title: string;
            icon: LucideIcon;
            items: any[];
            selectedValues: string[];
            setSelectedValues: Dispatch<SetStateAction<string[]>>;
            emptyLabel: string;
          }) => (
            <div
              className={`rounded-2xl border bg-[#F9FAFB] p-6 ${
                stepErrors.companyDescription && !hasKnowledgeBaseSelection
                  ? 'border-red-300'
                  : 'border-gray-100'
              }`}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-100 bg-white text-primary shadow-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-base font-semibold text-[#091A3A]">{title}</h4>
                    <p className="text-xs text-[#667085]">Selected: {selectedValues.length}</p>
                  </div>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-sm text-[#667085]">
                  <p>{emptyLabel}</p>
                </div>
              ) : (
                <CustomSelect
                  isMulti
                  placeholder="Search and select knowledge base"
                  options={items.map((item: any) => ({
                    label: item.name || item.title || 'Untitled knowledge base',
                    value: String(item.ingestionId || item.uuid || item.id || ''),
                  }))}
                  value={items
                    .map((item: any) => ({
                      label: item.name || item.title || 'Untitled knowledge base',
                      value: String(item.ingestionId || item.uuid || item.id || ''),
                    }))
                    .filter((option: any) => selectedValues.includes(String(option.value)))}
                  handleChange={(selectedOptions: any) => {
                    const nextValues = Array.isArray(selectedOptions)
                      ? selectedOptions.map((option: any) => String(option.value))
                      : [];
                    setSelectedValues(nextValues);
                    setStepErrors((p) => ({ ...p, companyDescription: '' }));
                  }}
                />
              )}
            </div>
          );

          return (
            <>
              {/* Company Details (Text) */}
              {renderKbSection({
                title: 'Company Details (Text)',
                icon: FileText,
                items: textKbItems,
                selectedValues: selectedCompanyDetailsKb,
                setSelectedValues: setSelectedCompanyDetailsKb,
                emptyLabel: 'No company details knowledge base found for this section.',
              })}

              {renderKbSection({
                title: 'Website Link (URL)',
                icon: Globe,
                items: urlKbItems,
                selectedValues: selectedWebsiteKb,
                setSelectedValues: setSelectedWebsiteKb,
                emptyLabel: 'No website link knowledge base found for this section.',
              })}

              {renderKbSection({
                title: 'Document (PDF)',
                icon: Upload,
                items: pdfKbItems,
                selectedValues: selectedDocumentKb,
                setSelectedValues: setSelectedDocumentKb,
                emptyLabel: 'No document knowledge base found for this section.',
              })}
            </>
          );
        })()}
        {stepErrors.companyDescription && (
          <p className="mt-2 text-sm text-red-500 font-medium text-center">
            {stepErrors.companyDescription}
          </p>
        )}
      </div>

      {renderStepFooter()}
    </div>
  );

  const renderLocationAndHoursStep = () => {
    const selectedLocation =
      sites.find((loc: any) => (loc.uuid || loc.id) === selectedLocationId) ||
      (sites.length > 0 ? sites[0] : null);

    const timezone = (operational_hours?.regional?.timezone as any)?.value || '';

    const formatOperatingHours = (hoursValue: any, tz: string) => {
      if (!hoursValue || typeof hoursValue !== 'object') return [];

      const daysArr = [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ];
      const activeDays = daysArr.filter((d) => hoursValue[d]?.open);

      if (activeDays.length === 0) return [];

      const formatTime = (time: string) => moment(time, 'HH:mm').format('h:mm A');
      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

      const groups: any[] = [];
      let currentGroup: any = null;

      activeDays.forEach((day) => {
        const data = hoursValue[day];
        const timeStr = `${formatTime(data.start)} - ${formatTime(data.end)}`;

        const dayIndex = daysArr.indexOf(day);
        const lastDayIndex = currentGroup ? daysArr.indexOf(currentGroup.lastDay) : -1;

        if (currentGroup && currentGroup.timeStr === timeStr && dayIndex === lastDayIndex + 1) {
          currentGroup.days.push(day);
          currentGroup.lastDay = day;
        } else {
          currentGroup = { days: [day], lastDay: day, timeStr };
          groups.push(currentGroup);
        }
      });

      return groups.map((g) => {
        const dayRange =
          g.days.length > 1
            ? `${capitalize(g.days[0])} - ${capitalize(g.days[g.days.length - 1])}`
            : capitalize(g.days[0]);
        return `${dayRange}: ${g.timeStr} ${tz ? `(${tz})` : ''}`;
      });
    };

    const displayHours =
      operational_hours?.type === '24_hours'
        ? [`Monday - Sunday: 24 Hours ${timezone ? `(${timezone})` : ''}`]
        : formatOperatingHours(operational_hours?.value, timezone);

    const finalHours =
      displayHours.length > 0
        ? displayHours
        : selectedLocation?.hours && Array.isArray(selectedLocation.hours)
          ? selectedLocation.hours.map((h: string) => `${h} ${timezone ? `(${timezone})` : ''}`)
          : [];

    return (
      <div className="mx-auto w-full max-w-[900px]">
        <div className="text-center">
          <h3 className="text-xl font-semibold text-[#091A3A]">Location and business hours</h3>
          <p className="mt-2 text-sm text-[#667085]">
            Set your operating hours and physical locations for the AI to reference.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-[#FEE4E2] bg-[#FEF3F2] p-5">
          <div className="flex items-start gap-3 text-[#B42318]">
            <Info className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm leading-6">
              The AI Receptionist will use the information listed below to answer callers questions
              about your locations and business hours. By default, your primary account address is
              selected.
            </p>
          </div>
        </div>

        <div className="mt-8">
          <label className="block text-sm font-semibold text-[#091A3A]">Select location</label>
          <div className="mt-3">
            <Picker
              label="Location"
              showLabel={false}
              className="mcm-field"
              placeholder="Select a location"
              value={selectedLocationId}
              options={[
                ...sites.map((loc: any) => ({
                  label: `${loc.name}${loc.is_default === '1' ? ' (Main Site)' : ''}`,
                  value: String(loc.uuid || loc.id),
                })),
                { label: 'None (skip this step)', value: 'none' },
              ]}
              onChange={(option) => {
                const val = option.value;
                setSelectedLocationId(val);
                if (val === 'none') {
                  formInstance.setValue('settings.operational_hours.type', '24_hours');
                  formInstance.setValue('settings.operational_hours.value', {});
                  formInstance.setValue('settings.operational_hours.regional', {
                    country: { label: '', value: '' },
                    timezone: { label: '', value: '' },
                  });
                  setStepErrors((p) => ({ ...p, regionalSettings: '' }));
                }
              }}
            />
          </div>
        </div>

        {/* New Cards for Regional and Business Hours */}
        {selectedLocationId !== 'none' && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Regional Settings Card */}

            <div className="flex flex-col bg-white justify-between gap-3.5 w-full border border-gray-100 shadow-[1px_1px_2px_rgba(0,0,0,0.05)] p-4 rounded-xl">
              <div className="flex justify-between">
                <div className="flex flex-col gap-1.5 overflow-hidden">
                  <div className="flex items-center gap-1">
                    <Globe className="h-4 w-4 text-primary" />
                    <p className="font-semibold truncate text-md text-gray-900 leading-tight">
                      Regional Settings
                    </p>
                  </div>
                  <p className="text-gray-600 truncate text-xs">
                    {(operational_hours?.regional?.country as any)?.value &&
                    (operational_hours?.regional?.timezone as any)?.value
                      ? `${(operational_hours.regional.timezone as any).value}, ${(operational_hours.regional.country as any).value}`
                      : 'Not configured'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 px-4 text-xs font-semibold shrink-0"
                  onClick={() => openModal('regionalModal')}
                >
                  Select
                </Button>
              </div>
              {stepErrors.regionalSettings && (
                <p className="text-[13px] text-red-500 ">{stepErrors.regionalSettings}</p>
              )}
            </div>

            {/* Business Hours Card */}
            <div className="flex bg-white justify-between gap-3.5 w-full border border-gray-100 shadow-[1px_1px_2px_rgba(0,0,0,0.05)] p-4 rounded-xl">
              <div className="flex flex-col gap-1.5 overflow-hidden">
                <div className="flex items-center gap-1">
                  <Clock3 className="h-4 w-4 text-primary" />
                  <p className="font-semibold truncate text-md text-gray-900 leading-tight">
                    Business Hours
                  </p>
                </div>
                <p
                  className={`${bussinessHourError ? 'text-red-500 font-medium' : 'text-gray-600'} truncate text-xs`}
                >
                  {bussinessHourError
                    ? bussinessHourError
                    : operational_hours?.type === '24_hours'
                      ? '24 Hours, all times'
                      : getWeeklyScheduleName(operational_hours?.value) || 'Not configured'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-9 px-4 text-xs font-semibold shrink-0"
                onClick={() => openModal('bussinessHoursModal')}
              >
                Select
              </Button>
            </div>
          </div>
        )}

        {selectedLocation && selectedLocationId !== 'none' && (
          <div className="mt-6 rounded-2xl border border-gray-100 bg-[#F9FAFB] p-6">
            <h4 className="text-lg font-bold text-[#091A3A] truncate">
              {selectedLocation.name}{' '}
              {selectedLocation.is_default === '1' ? '(Primary Account)' : ''}
            </h4>
            <p className="text-sm text-[#667085] mt-1 pr-4">
              {[
                selectedLocation.address,
                selectedLocation.city,
                selectedLocation.state,
                selectedLocation.postal_code,
                selectedLocation.country,
              ]
                .filter(Boolean)
                .join(', ')}
            </p>

            <div className="mt-6 flex flex-col gap-3">
              {finalHours.length > 0 ? (
                finalHours.map((hour: string, index: number) => (
                  <div
                    key={index}
                    className="w-fit rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 text-sm font-medium text-primary"
                  >
                    {hour}
                  </div>
                ))
              ) : (
                <div className="rounded-lg bg-gray-100/50 p-4 border border-dashed border-gray-200">
                  <p className="text-sm text-gray-500 italic">
                    No active operating hours selected. The AI will handle inquiries based on
                    general knowledge.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedLocationId === 'none' && (
          <div className="mt-6 rounded-2xl border border-gray-100 bg-[#F9FAFB] p-10 text-center">
            <p className="text-sm italic text-[#667085] leading-6">
              No location or business hours will be provided to the AI Receptionist. It will handle
              inquiries generally or state that this information is unavailable.
            </p>
          </div>
        )}

        {renderStepFooter()}
      </div>
    );
  };

  const renderCallRoutingStep = () => {
    const renderHumanHandoffInfoCard = () => (
      <div className="rounded-2xl border border-primary/20 bg-ucass-active-bg p-5">
        <div className="flex items-start gap-3 text-primary">
          <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Zap className="h-4 w-4" />
          </span>
          <div>
            <h4 className="text-base font-semibold leading-6">When does the AI transfer a call?</h4>
            <p className="mt-2 text-sm leading-6 text-primary">
              The AI Receptionist will automatically route the active call to your designated
              destination under the following scenarios:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-primary">
              <li>
                When the caller explicitly asks to speak with a human agent, specific user, or
                department.
              </li>
              <li>
                When the AI encounters a complex issue or query outside of its provided knowledge
                base.
              </li>
              <li>
                When the conversational flow naturally concludes and requires a live person to
                finalize tasks (e.g., taking payment).
              </li>
              <li>
                Whenever a callback is scheduled, the corresponding task will be automatically
                assigned to the manager. The manager can then either handle the callback personally
                or reassign the task to any available agent as required.
              </li>
            </ul>
          </div>
        </div>
      </div>
    );

    return (
      <div className="mx-auto w-full max-w-[900px]">
        <div className="text-center">
          <h3 className="text-xl font-semibold text-[#091A3A]">
            Human Hand Off & Schedule Callback
          </h3>
          <p className="mt-2 text-sm text-[#667085]">
            Configure where the AI Receptionist should forward the call when a handoff is required.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-gray-200 bg-black/1 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h4 className="text-base font-semibold text-[#091A3A]">
                Do you want to enable Schedule Callback?
              </h4>
            </div>
            <Switch
              checked={enableCallbackScheduling}
              onCheckedChange={(checked) => setEnableCallbackScheduling(checked === true)}
            />
          </div>

          <div className="mt-5 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-base font-semibold text-[#091A3A]">
                  Do you want to enable Human Hand Off.
                </h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full border border-gray-200 bg-white text-gray-500 hover:border-primary hover:text-primary"
                  onClick={() => openModal('humanHandoffModal')}
                  aria-label="Learn more about human handoff"
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Switch
              checked={enableHumanHandoff}
              onCheckedChange={(checked) => {
                const nextValue = checked === true;
                setEnableHumanHandoff(nextValue);
                if (!nextValue) {
                  setStepErrors((prev) => {
                    const nextErrors = { ...prev };
                    delete nextErrors.forwardCall;
                    delete nextErrors.manager;
                    return nextErrors;
                  });
                  setInvalidStepIndexes((prev) => prev.filter((index) => index !== 4));
                }
              }}
            />
          </div>

          {enableHumanHandoff && (
            <div className="mt-6 border-t border-gray-200 pt-6">
              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-white p-6">
                  <h4 className="text-base font-semibold text-[#091A3A]">Forwarding Destination</h4>
                  <p className="mt-1 text-sm text-[#667085]">
                    Select the extension, department, or number where calls should be routed.
                  </p>
                  <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className={`min-w-0 ${committedShouldShowForwardTo ? '' : 'flex-1'}`}>
                        <p className="text-xs text-gray-500">Forward Type</p>
                        <p className="truncate text-sm font-medium text-gray-900">
                          {committedForwardTypeLabel}
                        </p>
                      </div>
                      {committedShouldShowForwardTo && (
                        <div className="min-w-0">
                          <p className="text-xs text-gray-500">{committedForwardValueFieldLabel}</p>
                          <p className="truncate text-sm font-medium text-gray-900">
                            {committedForwardValueDisplay || committedForwardValueLabel}
                          </p>
                        </div>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0"
                        onClick={handleOpenForwardDestinationModal}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-6">
                  <h4 className="text-base font-semibold text-[#091A3A]">Manager Configuration</h4>
                  <p className="mt-1 text-sm text-[#667085]">Select a manager</p>
                  <div className="mt-4">
                    <CustomSelect
                      options={managerExtensions.map((ext: any) => ({
                        label:
                          `${ext.first_name || ''} ${ext.last_name || ''} (${ext.extension}) - ${getManagerUserRole(ext)}`.trim(),
                        value: getManagerUserId(ext),
                      }))}
                      value={selectedManagerId}
                      handleChange={(val: any) => {
                        setSelectedManagerId(val?.value || val);
                        if (val) setStepErrors((prev) => ({ ...prev, manager: '' }));
                      }}
                      placeholder="Select a manager"
                      error={stepErrors.manager}
                      menuPlacement="top"
                      isLoading={isLoadingManagerUsers || isFetchingNextManagerPage}
                      onInputChange={setManagerSearch}
                      onMenuScrollToBottom={() => {
                        if (hasNextManagerPage && !isFetchingNextManagerPage) {
                          void fetchNextManagerPage();
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {enableHumanHandoff && stepErrors.forwardCall && (
            <p className="mt-3 text-center text-sm text-red-500">{stepErrors.forwardCall}</p>
          )}
        </div>

        <Dialog
          open={modalState.humanHandoffModal}
          onOpenChange={(open) => {
            if (open) {
              openModal('humanHandoffModal');
            } else {
              closeModal('humanHandoffModal');
            }
          }}
        >
          <DialogContent className="max-w-[760px] max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>When does the AI transfer a call?</DialogTitle>
            </DialogHeader>
            <div className="pt-1">{renderHumanHandoffInfoCard()}</div>
          </DialogContent>
        </Dialog>
        <Dialog
          open={isForwardDestinationModalOpen}
          onOpenChange={(open) => {
            if (open) {
              setIsForwardDestinationModalOpen(true);
              return;
            }
            if (isForwardModalSavingRef.current) {
              isForwardModalSavingRef.current = false;
              setIsForwardDestinationModalOpen(false);
              return;
            }
            handleCancelForwardDestinationEdit();
          }}
        >
          <DialogContent className="max-w-[620px]">
            <DialogHeader>
              <DialogTitle>Edit Forwarding Destination</DialogTitle>
            </DialogHeader>
            <div className="pt-1">
              <ForwardActionAllAi
                setValue={setValue}
                watch={watch}
                forwardType="callRules.forwardCall.type"
                forwardValue="callRules.forwardCall.value"
                enableVoicemailChoice={true}
                voicemailPersonalField="callRules.forwardCall.personal"
                optionsData={forwardingOptionsData}
                userExtension={user?.user_info?.extension || ''}
                forwardTypeLabel="Forward Type"
                forwardValueLabel={forwardValueFieldLabel}
                forwardTypeError={(errors as any)?.callRules?.forwardCall?.type?.message || ''}
                forwardValueError={(errors as any)?.callRules?.forwardCall?.value?.message || ''}
                forwardTypeClass="w-full mb-3"
                forwardValueClass="w-full"
                selectCustomClassSecond="w-full"
              />
              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Selected</p>
                <p className="text-sm font-medium text-gray-900">
                  {shouldShowForwardTo
                    ? `${selectedForwardTypeLabel} - ${selectedForwardValueDisplay || selectedForwardValueLabel}`
                    : selectedForwardTypeLabel}
                </p>
              </div>
            </div>
            <DialogFooter className="sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={handleCancelForwardDestinationEdit}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveForwardDestinationEdit}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {renderStepFooter()}
      </div>
    );
  };

  const renderAdvancedConfigStep = () => (
    <div className="mx-auto w-full max-w-[900px]">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-[#091A3A]">Advanced settings</h3>
        <p className="mt-2 text-sm text-[#667085]">
          Configure data collection, language preferences, and behavioral parameters.
        </p>
      </div>

      <div className="mt-6 space-y-4">
        {/* <div className="rounded-2xl border border-gray-200 bg-black/1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-[#091A3A]">Call Recording</h4>
              <p className="mt-1 text-sm leading-6 text-[#667085]">
                Automatically record all calls made through the AI Receptionist for quality and
                training purposes.
              </p>
            </div>
            <Switch checked={true} disabled />
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-black/1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-[#091A3A]">Enable Transcripts</h4>
              <p className="mt-1 text-sm leading-6 text-[#667085]">
                Enable this option to generate and save text transcripts for each call.
              </p>
            </div>
            <Switch checked={enableTranscripts} disabled onCheckedChange={setEnableTranscripts} />
          </div>
        </div> */}
        <div className="rounded-2xl border border-gray-200 bg-black/1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-[#091A3A]">Enable Call Monitoring</h4>
              <p className="mt-1 text-sm leading-6 text-[#667085]">
                Enable this option to generate and save text transcripts for each call.
              </p>
            </div>
            <Switch
              checked={enableCallMonitoring}
              disabled
              onCheckedChange={setEnableCallMonitoring}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-black/1 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h4 className="text-base font-semibold text-[#091A3A]">Temperature</h4>
              <p className="mt-1 text-sm leading-6 text-[#667085]">
                Adjust how creative or consistent the AI&apos;s responses are during calls.
              </p>
            </div>
            <div className="w-full md:w-[280px]">
              <Picker
                label="Temperature"
                showLabel={false}
                className="mcm-field"
                value={String(temperature)}
                options={TEMPERATURE_OPTIONS.map((item) => ({
                  label: String(item),
                  value: String(item),
                }))}
                onChange={(option) => setTemperature(option.value)}
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-black/1 p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-base font-semibold text-[#091A3A]">Data Collection</h4>
            <Switch
              checked={isDataCollectionEnabled}
              onCheckedChange={(checked) => setIsDataCollectionEnabled(checked === true)}
            />
          </div>
          <p className="mt-1 text-sm leading-6 text-[#667085]">
            Enable this to choose which caller details the AI should collect during a conversation.
          </p>

          {isDataCollectionEnabled && (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-[#101828]">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={isAllDetailsSelected}
                  onCheckedChange={(checked) => toggleAllDetails(checked === true)}
                />
                All
              </label>

              <label className="flex items-center gap-2">
                <Checkbox
                  checked={detailsToCollect.details_to_collect.includes('name')}
                  onCheckedChange={(checked) => toggleSingleDetail('name', checked === true)}
                />
                Name
              </label>

              <label className="flex items-center gap-2">
                <Checkbox
                  checked={detailsToCollect.details_to_collect.includes('dob')}
                  onCheckedChange={(checked) => toggleSingleDetail('dob', checked === true)}
                />
                DOB
              </label>

              <label className="flex items-center gap-2">
                <Checkbox
                  checked={detailsToCollect.details_to_collect.includes('phone')}
                  disabled
                  onCheckedChange={() => {}}
                />
                Phone (Required)
              </label>

              <label className="flex items-center gap-2">
                <Checkbox
                  checked={detailsToCollect.details_to_collect.includes('email')}
                  onCheckedChange={(checked) => toggleSingleDetail('email', checked === true)}
                />
                Email
              </label>

              <label className="flex items-center gap-2">
                <Checkbox
                  checked={detailsToCollect.details_to_collect.includes('address')}
                  onCheckedChange={(checked) => toggleSingleDetail('address', checked === true)}
                />
                Address
              </label>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-black/1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-[#091A3A]">Max Session Duration</h4>
              <p className="mt-1 text-sm leading-6 text-[#667085]">
                Set the maximum session length before the AI ends the active conversation.
              </p>
            </div>
            <Picker
              label="Maximum session length"
              showLabel={false}
              value={String(maxSessionDuration)}
              options={MAX_SESSION_DURATION_OPTIONS.map((minutes) => ({
                label: `${minutes} min`,
                value: String(minutes),
              }))}
              onChange={(option) => setMaxSessionDuration(Number(option.value))}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-black/1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-[#091A3A]">Idle Reminder</h4>
              <p className="mt-1 text-sm leading-6 text-[#667085]">
                Set how long to wait before sending an idle reminder.
              </p>
            </div>
            <Picker
              label="Idle reminder"
              showLabel={false}
              value={String(idleReminder)}
              options={IDLE_REMINDER_OPTIONS.map((seconds) => ({
                label: `${seconds / 60} min`,
                value: String(seconds),
              }))}
              onChange={(option) => setIdleReminder(Number(option.value))}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-black/1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-[#091A3A]">Idle Reminder Retry</h4>
              <p className="mt-1 text-sm leading-6 text-[#667085]">
                Set how many reminder retries should be attempted.
              </p>
            </div>
            <Picker
              label="Reminder retries"
              showLabel={false}
              value={String(idleReminderRetry)}
              options={IDLE_REMINDER_RETRY_OPTIONS.map((count) => ({
                label: String(count),
                value: String(count),
              }))}
              onChange={(option) => setIdleReminderRetry(Number(option.value))}
            />
          </div>
        </div>
      </div>

      {renderStepFooter()}
    </div>
  );

  const renderSimpleStep = () => (
    <div className="mx-auto flex min-h-[260px] w-full max-w-[900px] flex-col justify-end">
      {renderStepFooter()}
    </div>
  );

  const renderStepContent = () => {
    if (currentStep === 0) return renderWelcomeGreetingStep();
    if (currentStep === 1) return renderToneAndPersonalityStep();
    if (currentStep === 2) return renderCompanyDescriptionStep();
    if (currentStep === 3) return renderLocationAndHoursStep();
    if (currentStep === 4) return renderCallRoutingStep();
    if (currentStep === 5) return renderAdvancedConfigStep();
    return renderSimpleStep();
  };

  return (
    <FormProvider {...formInstance}>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
        <div className="grid grid-cols-2 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
          {STEP_ITEMS.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = currentStep === index;
            const isInvalid = invalidStepIndexes.includes(index);

            return (
              <button
                key={step.title}
                type="button"
                onClick={() => handleStepClick(index)}
                className="flex cursor-pointer flex-col items-center bg-transparent p-0 text-center px-1"
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full border ${
                    isInvalid
                      ? 'border-red-400 text-red-500 bg-red-50'
                      : isActive
                        ? 'border-primary text-primary bg-ucass-active-bg'
                        : 'border-gray-300 text-gray-400'
                  }`}
                >
                  <StepIcon className="h-4 w-4" />
                </span>
                <p
                  className={`mt-2 text-sm font-semibold leading-5 ${
                    isInvalid ? 'text-red-500' : isActive ? 'text-primary' : 'text-[#344054]'
                  }`}
                >
                  {step.title}
                </p>
                <p className="mt-1 text-xs leading-4 text-[#667085]">{step.subtitle}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-8">{renderStepContent()}</div>
      </div>

      {modalState.regionalModal && (
        <RegionalModal
          modalState={modalState.regionalModal}
          setModalState={() => closeModal('regionalModal')}
          initialRegionalSettings={operational_hours?.regional}
          onSuccess={() => setStepErrors((prev) => ({ ...prev, regionalSettings: '' }))}
          data={{}}
        />
      )}
      {modalState.bussinessHoursModal && (
        <BussinessHoursModal
          modalState={modalState.bussinessHoursModal}
          setModalState={() => closeModal('bussinessHoursModal')}
          setError={(value) => setBussinessHourError(value)}
          data={{ settings: { operational_hours } }}
          aiMode={true}
        />
      )}
    </FormProvider>
  );
};

export default CreateAiReceptionist;
