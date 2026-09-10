import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useUser } from '@/hooks/use-user';
import { getAiWidgetScriptUrl, handleAlert } from '@/lib/utils';
import { addAIDomain, updateAIAgent } from '@/services/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Code2, Copy, MessageSquare, Palette, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export type ChatWidgetColors = {
  headerBackground: string;
  bubbleBackground: string;
  bubbleText: string;
  chatIcon: string;
  sendButton: string;
  loader: string;
};

export const DEFAULT_CHAT_WIDGET_COLORS: ChatWidgetColors = {
  headerBackground: '#171717',
  bubbleBackground: '#e9e9e9',
  bubbleText: '#171717',
  chatIcon: '#171717',
  sendButton: '#171717',
  loader: '#171717',
};

export const getChatWidgetScriptSrc = () => {
  return getAiWidgetScriptUrl();
};

const COLOR_FIELDS: Array<{ key: keyof ChatWidgetColors; label: string }> = [
  { key: 'headerBackground', label: 'Header' },
  { key: 'bubbleBackground', label: 'Bubble' },
  { key: 'bubbleText', label: 'Bubble text' },
  { key: 'chatIcon', label: 'Launcher' },
  { key: 'sendButton', label: 'Send button' },
  { key: 'loader', label: 'Loader' },
];

const ACCENT_SWATCHES = ['#2563eb', '#10b981', '#8b5cf6', '#db2777', '#f59e0b', '#111827'];
const ACCENT_COLOR_FIELDS = [
  'headerBackground',
  'chatIcon',
  'sendButton',
  'loader',
] as const satisfies ReadonlyArray<keyof ChatWidgetColors>;

const getAgentId = (agent: any) =>
  String(agent?.agent_uuid || agent?.agentId || agent?.id || agent?.uuid || agent?._id || '');

export const getAi360WidgetKey = (agent: any) => String(agent?.widgetKey || '').trim();

const getAgentName = (agent: any) => agent?.agentName || agent?.name || 'Virtual Assistant';

const isValidHex = (color: string) => /^#[0-9A-Fa-f]{6}$/.test(color);

const ChatLauncherPreview = ({ colors }: { colors: ChatWidgetColors }) => (
  <button
    type="button"
    aria-label="Open chat preview"
    className="inline-flex h-[66px] w-full max-w-[300px] min-w-0 items-center justify-between gap-3 rounded-full border-0 py-[9px] pl-4 pr-[9px] text-left shadow-[0_18px_42px_rgba(0,0,0,.14)] sm:min-w-[230px] sm:gap-4 sm:pl-5"
    style={{ backgroundColor: colors.bubbleBackground, color: colors.bubbleText }}
  >
    <span className="flex min-w-0 flex-col gap-[3px]">
      <span
        className="truncate text-sm font-extrabold leading-[1.15]"
        style={{ color: colors.bubbleText }}
      >
        Need Help?
      </span>
      <span className="truncate text-xs font-medium leading-[1.2]">Click here to chat with us</span>
    </span>
    <span
      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white"
      style={{ backgroundColor: colors.chatIcon }}
    >
      <MessageSquare className="h-[22px] w-[22px]" />
    </span>
  </button>
);

const ChatOpenPreview = ({
  agentName,
  colors,
}: {
  agentName: string;
  colors: ChatWidgetColors;
}) => (
  <div className="flex h-full min-h-[420px] w-full flex-col overflow-hidden bg-white">
    <header
      className="flex min-h-[220px] shrink-0 flex-col text-white"
      style={{ backgroundColor: colors.headerBackground }}
    >
      <div className="flex min-h-[54px] items-center justify-between gap-3 px-[18px] py-2">
        <span className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1 truncate text-center text-sm font-bold" />
        <button
          type="button"
          aria-label="Close"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent text-[25px] leading-none text-white"
        >
          ×
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-5 pb-[34px] text-center">
        <span className="mb-4 inline-flex h-[60px] w-[60px] items-center justify-center rounded-xl bg-white shadow-[0_14px_26px_rgba(0,0,0,.12)]">
          <Bot className="h-[30px] w-[30px]" style={{ color: colors.headerBackground }} />
        </span>
        <h1 className="m-0 text-xl font-extrabold leading-[1.2]">Hi, welcome👋</h1>
        <div className="mt-[7px] text-sm font-medium text-white/80">
          Chat with <strong className="font-extrabold text-white">{agentName}</strong>
        </div>
      </div>
    </header>

    <section className="flex min-h-0 flex-1 flex-col bg-white px-5 pb-[17px] pt-[33px]">
      <h2 className="mb-2.5 text-[13px] font-extrabold" style={{ color: colors.sendButton }}>
        Your conversations
      </h2>
      <div className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-hidden pb-3.5">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg border border-[rgba(17,24,39,0.09)] bg-white p-2.5 text-left shadow-[0_2px_8px_rgba(15,23,42,0.09)]"
        >
          <span
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-extrabold text-white"
            style={{ backgroundColor: colors.chatIcon }}
          >
            {agentName.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-extrabold text-[#171717]">
                {agentName}
              </span>
              <span
                className="max-w-[105px] shrink-0 truncate text-[10px]"
                style={{ color: colors.sendButton }}
              >
                a few seconds ago
              </span>
            </span>
            <span className="block truncate text-xs" style={{ color: colors.sendButton }}>
              Hi! How can I help you today?
            </span>
          </span>
        </button>
      </div>
      <button
        type="button"
        className="inline-flex min-h-[54px] w-full shrink-0 items-center justify-center gap-[9px] rounded-full border-0 text-sm font-extrabold text-white shadow-[0_12px_24px_rgba(0,0,0,.15)]"
        style={{ backgroundColor: colors.sendButton }}
      >
        <MessageSquare className="h-4 w-4" />
        New conversation
      </button>
    </section>
  </div>
);

const ChatConversationPreview = ({
  agentName,
  colors,
}: {
  agentName: string;
  colors: ChatWidgetColors;
}) => (
  <div className="flex h-full min-h-[420px] w-full flex-col overflow-hidden bg-white">
    <header
      className="flex min-h-[56px] shrink-0 flex-col text-white"
      style={{ backgroundColor: colors.headerBackground }}
    >
      <div className="flex min-h-[54px] items-center justify-between gap-3 px-[18px] py-2">
        <button
          type="button"
          aria-label="Back"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent text-[25px] leading-none text-white"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1 truncate text-center text-sm font-bold">{agentName}</div>
        <button
          type="button"
          aria-label="Close"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent text-[25px] leading-none text-white"
        >
          ×
        </button>
      </div>
    </header>

    <section className="relative flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex-1 overflow-hidden bg-white px-[14px] py-4">
        <article
          className="mb-[11px] max-w-[88%] whitespace-pre-wrap rounded-xl border border-[rgba(17,24,39,0.08)] px-3 py-2.5 text-sm leading-[1.45]"
          style={{ backgroundColor: colors.bubbleBackground, color: colors.bubbleText }}
        >
          <span className="mb-1 block text-[11px] font-extrabold leading-none opacity-70">
            Agent
          </span>
          <span className="block">Hi! How can I help you today?</span>
        </article>
        <article
          className="mb-[11px] ml-auto max-w-[88%] whitespace-pre-wrap rounded-xl px-3 py-2.5 text-sm leading-[1.45] text-white"
          style={{ backgroundColor: colors.sendButton }}
        >
          <span className="mb-1 block text-[11px] font-extrabold leading-none opacity-70">You</span>
          <span className="block">Can I see the plans?</span>
        </article>
        <article
          className="mb-[11px] max-w-[88%] whitespace-pre-wrap rounded-xl border border-[rgba(17,24,39,0.08)] px-3 py-2.5 text-sm leading-[1.45]"
          style={{ backgroundColor: colors.bubbleBackground, color: colors.bubbleText }}
        >
          <span className="mb-1 block text-[11px] font-extrabold leading-none opacity-70">
            Agent
          </span>
          <span className="block">Sure. I can help you compare the available options.</span>
        </article>
        <div
          aria-label="Typing indicator"
          className="inline-flex w-fit items-center gap-1 rounded-full border border-[rgba(17,24,39,0.08)] px-3 py-2"
          style={{ backgroundColor: colors.bubbleBackground }}
        >
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: colors.loader }}
            />
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-[9px] border-t border-[rgba(17,24,39,0.1)] bg-white px-3 py-2.5">
        <span className="h-[42px] min-w-0 flex-1 rounded-xl border border-[rgba(17,24,39,0.16)] bg-white px-3 text-sm leading-[42px] text-slate-400">
          Type here...
        </span>
        <span
          className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: colors.sendButton }}
        >
          <Send className="h-[18px] w-[18px]" />
        </span>
      </div>
    </section>
  </div>
);

const normalizeDetailStatus = (value: unknown, fallback: 'mandatory' | 'optional') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized === 'mandatory' || normalized === 'required' ? 'mandatory' : fallback;
};

const normalizeDetailsToCollectObject = (forwardCallActions: any) => {
  const dataAgent = forwardCallActions?.data_agent || {};
  if (dataAgent?.data_collection === false) return { name: 'mandatory' };

  const rawDetails = dataAgent?.details_to_collect;
  const detailMandatory = dataAgent?.details_mandatory || {};

  if (rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)) {
    const normalized = Object.entries(rawDetails).reduce<Record<string, 'mandatory' | 'optional'>>(
      (acc, [field, status]) => {
        const key = String(field || '').trim();
        if (!key) return acc;
        acc[key] = normalizeDetailStatus(status, key === 'name' ? 'mandatory' : 'optional');
        return acc;
      },
      {},
    );
    return { ...normalized, name: 'mandatory' };
  }

  if (!Array.isArray(rawDetails)) return { name: 'mandatory' };

  const normalized = rawDetails.reduce<Record<string, 'mandatory' | 'optional'>>((acc, field) => {
    const key = String(field || '').trim();
    if (!key) return acc;
    acc[key] = normalizeDetailStatus(
      detailMandatory?.[key],
      key === 'name' || key === 'email' ? 'mandatory' : 'optional',
    );
    return acc;
  }, {});
  return { ...normalized, name: 'mandatory' };
};

const normalizeForwardCallActionsForUpdate = (forwardCallActions: any) => ({
  ...(forwardCallActions || {}),
  data_agent: {
    ...(forwardCallActions?.data_agent || {}),
    details_to_collect: normalizeDetailsToCollectObject(forwardCallActions),
  },
});

export const getChatWidgetColors = (agent: any): ChatWidgetColors => ({
  headerBackground:
    agent?.widgetHeaderColor ||
    agent?.forward_call_actions?.chatbot_builder?.brain?.widgetColors?.headerBackground ||
    DEFAULT_CHAT_WIDGET_COLORS.headerBackground,
  bubbleBackground:
    agent?.widgetBubbleBackground ||
    agent?.forward_call_actions?.chatbot_builder?.brain?.widgetColors?.bubbleBackground ||
    DEFAULT_CHAT_WIDGET_COLORS.bubbleBackground,
  bubbleText:
    agent?.widgetBubbleTextColor ||
    agent?.forward_call_actions?.chatbot_builder?.brain?.widgetColors?.bubbleText ||
    DEFAULT_CHAT_WIDGET_COLORS.bubbleText,
  chatIcon:
    agent?.widgetIconColor ||
    agent?.forward_call_actions?.chatbot_builder?.brain?.widgetColors?.chatIcon ||
    DEFAULT_CHAT_WIDGET_COLORS.chatIcon,
  sendButton:
    agent?.widgetSendButtonColor ||
    agent?.forward_call_actions?.chatbot_builder?.brain?.widgetColors?.sendButton ||
    DEFAULT_CHAT_WIDGET_COLORS.sendButton,
  loader:
    agent?.widgetLoaderColor ||
    agent?.forward_call_actions?.chatbot_builder?.brain?.widgetColors?.loader ||
    DEFAULT_CHAT_WIDGET_COLORS.loader,
});

export const applyChatWidgetColorsToAgent = (agent: any, colors: ChatWidgetColors) => ({
  ...agent,
  widgetHeaderColor: colors.headerBackground,
  widgetBubbleBackground: colors.bubbleBackground,
  widgetBubbleTextColor: colors.bubbleText,
  widgetIconColor: colors.chatIcon,
  widgetSendButtonColor: colors.sendButton,
  widgetLoaderColor: colors.loader,
});

export const buildChatAgentEmbedScript = ({
  agent,
}: {
  agent: any;
  tokenId?: string;
  userId?: string;
  companyId?: string;
  allowedDomain?: string;
}) => {
  const widgetKey = getAi360WidgetKey(agent);
  const widgetScriptSrc = getChatWidgetScriptSrc();
  return `<script
  src="${widgetScriptSrc}"
  data-widget-mode="chat"
  data-widget-key="${widgetKey}"
  data-position="bottom-right"
  data-label="Need Help?"
  async
  type="text/javascript">
</script>`;
};

const buildWidgetUpdatePayload = (agent: any, colors: ChatWidgetColors, allowedDomain: string) => {
  const {
    agent_uuid,
    uuid,
    did_uuid,
    company_uuid,
    created_at,
    createdAt,
    updated_at,
    updatedAt,
    deletedAt,
    deleted_at,
    useMessageExactly,
    ...rest
  } = agent || {};
  const normalizedForwardCallActions = normalizeForwardCallActionsForUpdate(
    rest?.forward_call_actions,
  );

  void agent_uuid;
  void uuid;
  void did_uuid;
  void company_uuid;
  void created_at;
  void createdAt;
  void updated_at;
  void updatedAt;
  void deletedAt;
  void deleted_at;
  void useMessageExactly;

  const widgetKey = getAi360WidgetKey(agent);

  return {
    ...rest,
    agentId: getAgentId(agent),
    allowedDomain: allowedDomain.trim(),
    widgetKey,
    forward_call_actions: {
      ...normalizedForwardCallActions,
    },
    widgetHeaderColor: colors.headerBackground,
    widgetBubbleBackground: colors.bubbleBackground,
    widgetBubbleTextColor: colors.bubbleText,
    widgetIconColor: colors.chatIcon,
    widgetSendButtonColor: colors.sendButton,
    widgetLoaderColor: colors.loader,
  };
};

type ChatAgentConfigureModalProps = {
  open: boolean;
  agent: any | null;
  initialTokenId?: string;
  onOpenChange: (open: boolean) => void;
  onSaved?: (agent: any) => void;
  onFinish?: () => void;
};

const ChatAgentConfigureModal = ({
  open,
  agent,
  initialTokenId = '',
  onOpenChange,
  onSaved,
  onFinish,
}: ChatAgentConfigureModalProps) => {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const [activeStep, setActiveStep] = useState<'design' | 'deploy'>('design');
  const [previewMode, setPreviewMode] = useState<'closed' | 'open' | 'chat'>('closed');
  const [colors, setColors] = useState<ChatWidgetColors>(DEFAULT_CHAT_WIDGET_COLORS);
  const [allowedDomain, setAllowedDomain] = useState('');
  const [copied, setCopied] = useState(false);
  const agentId = getAgentId(agent);
  const previousSessionRef = useRef({ open: false, agentId: '' });

  const { mutateAsync: saveAgent, isPending: isSaving } = useMutation({
    mutationFn: updateAIAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['getChatAgentList'] });
    },
  });

  const { mutateAsync: saveDomain, isPending: isSavingDomain } = useMutation({
    mutationFn: addAIDomain,
    mutationKey: ['addAIDomain', 'chat-configure-modal'],
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['getChatAgentList'] });
      queryClient.invalidateQueries({ queryKey: ['getAIDomainList'] });
    },
  });

  useEffect(() => {
    if (!open || !agent) {
      previousSessionRef.current = { open: false, agentId: '' };
      return;
    }

    const previousSession = previousSessionRef.current;
    previousSessionRef.current = { open: true, agentId };
    if (previousSession.open && previousSession.agentId === agentId) return;

    setActiveStep('design');
    setPreviewMode('closed');
    setColors(getChatWidgetColors(agent));
    setAllowedDomain(agent?.allowedDomain || '');
    setCopied(false);
  }, [agent, agentId, initialTokenId, open]);

  const configuredAgent = useMemo(
    () => ({
      ...applyChatWidgetColorsToAgent(agent || {}, colors),
      allowedDomain: allowedDomain.trim(),
    }),
    [agent, allowedDomain, colors],
  );

  const embedScript = useMemo(
    () =>
      buildChatAgentEmbedScript({
        agent: configuredAgent,
        userId: user?.ai_user_id,
        companyId: user?.company_info?.uuid,
        allowedDomain: allowedDomain.trim(),
      }),
    [allowedDomain, configuredAgent, user?.ai_user_id, user?.company_info?.uuid],
  );

  const updateColor = (key: keyof ChatWidgetColors, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }));
  };
  const applyAccentColor = (value: string) => {
    setColors((prev) => ({
      ...prev,
      headerBackground: value,
      chatIcon: value,
      sendButton: value,
      loader: value,
    }));
  };
  const currentAccentColor = useMemo(() => {
    const values = ACCENT_COLOR_FIELDS.map((key) => colors[key].toLowerCase());
    return values.every((value) => value === values[0]) ? colors.headerBackground : '';
  }, [colors]);
  const customAccentPickerValue = isValidHex(currentAccentColor)
    ? currentAccentColor
    : isValidHex(colors.headerBackground)
      ? colors.headerBackground
      : DEFAULT_CHAT_WIDGET_COLORS.headerBackground;
  const isCustomAccentSelected = Boolean(
    currentAccentColor &&
    !ACCENT_SWATCHES.some(
      (presetColor) => presetColor.toLowerCase() === currentAccentColor.toLowerCase(),
    ) &&
    currentAccentColor.toLowerCase() !== DEFAULT_CHAT_WIDGET_COLORS.headerBackground.toLowerCase(),
  );

  const saveConfiguration = async ({
    goToDeploy = false,
    closeAfterSave = false,
  }: {
    goToDeploy?: boolean;
    closeAfterSave?: boolean;
  } = {}) => {
    if (!agent || !getAgentId(agent)) {
      handleAlert({ text: 'Agent is still being prepared. Please try again.', type: 'error' });
      return;
    }

    try {
      const domain = allowedDomain.trim();
      if (closeAfterSave && !domain) {
        handleAlert({ text: 'Allowed domain is required.', type: 'error' });
        return;
      }

      const payload = buildWidgetUpdatePayload(agent, colors, allowedDomain);
      await saveAgent(payload);
      if (domain) {
        await saveDomain({
          domain,
          agentId: getAgentId(agent),
        });
      }
      const nextAgent = {
        ...applyChatWidgetColorsToAgent(agent, colors),
        allowedDomain: domain,
        forward_call_actions: normalizeForwardCallActionsForUpdate(agent?.forward_call_actions),
      };
      onSaved?.(nextAgent);
      handleAlert({ text: 'Widget configuration saved successfully!', type: 'success' });
      if (goToDeploy) setActiveStep('deploy');
      if (closeAfterSave) closeModal(false);
    } catch (error) {
      console.error('Failed to save widget configuration:', error);
      handleAlert({ text: 'Failed to save widget configuration.', type: 'error' });
    }
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(embedScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      handleAlert({ text: 'Script copied successfully!', type: 'success' });
    } catch (error) {
      console.error('Failed to copy embed script:', error);
      handleAlert({ text: 'Failed to copy script.', type: 'error' });
    }
  };

  const closeModal = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      onFinish?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={closeModal}>
      <DialogContent
        showCloseButton={false}
        className="h-[100dvh] max-h-[100dvh] w-screen max-w-none gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(820px,94dvh)] sm:max-h-[94dvh] sm:w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-2rem)] sm:rounded-xl sm:border xl:max-w-7xl"
      >
        <div className="flex h-full min-h-0 flex-col bg-white text-[#07142f]">
          <div className="flex min-h-[60px] shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-3 py-3 sm:min-h-[66px] sm:px-5 sm:py-4">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-bold text-gray-950 sm:text-lg">
                Finish setting up {getAgentName(agent)}
              </DialogTitle>
              <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                Step {activeStep === 'design' ? '1' : '2'} of 2 -{' '}
                {activeStep === 'design' ? 'Design' : 'Deploy'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => closeModal(false)}
              aria-label="Close widget configuration"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[210px_minmax(0,1fr)] md:grid-rows-1 lg:grid-cols-[228px_minmax(0,1fr)]">
            <aside className="flex gap-2 overflow-x-auto border-b border-gray-200 bg-slate-50 px-3 py-2 md:block md:overflow-y-auto md:border-b-0 md:border-r md:px-4 md:py-5">
              {[
                {
                  key: 'design' as const,
                  label: 'Design',
                  copy: 'Style the widget',
                  icon: Palette,
                },
                { key: 'deploy' as const, label: 'Deploy', copy: 'Embed and go live', icon: Code2 },
              ].map((step, index) => {
                const Icon = step.icon;
                const active = activeStep === step.key;
                const complete = activeStep === 'deploy' && step.key === 'design';

                return (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => setActiveStep(step.key)}
                    className={`flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors md:mb-3 md:min-h-[78px] md:w-full md:gap-3 md:px-3.5 md:py-3 ${
                      active
                        ? 'border-primary/20 bg-white text-primary shadow-sm'
                        : 'border-transparent text-slate-600 hover:bg-white'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
                        complete
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : active
                            ? 'border-primary text-primary'
                            : 'border-slate-300 text-slate-400'
                      }`}
                    >
                      {complete ? <Check className="h-4 w-4" /> : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-nowrap text-sm font-bold leading-5">
                        {step.label}
                      </span>
                      <span className="hidden whitespace-nowrap text-xs leading-4 text-slate-500 md:block">
                        {step.copy}
                      </span>
                    </span>
                    <Icon className="hidden h-4 w-4 shrink-0 opacity-60 sm:block" />
                  </button>
                );
              })}
            </aside>

            <main className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4 lg:p-5">
              {activeStep === 'design' ? (
                <div className="grid gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
                  <section className="min-w-0">
                    <div>
                      <h3 className="text-base font-bold text-gray-950">Web widget designer</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Customize the launcher, chat panel, and message colors.
                      </p>
                    </div>

                    <div className="mt-5">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Accent presets
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {ACCENT_SWATCHES.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => applyAccentColor(color)}
                            aria-label={`Use ${color} accent`}
                            aria-pressed={currentAccentColor.toLowerCase() === color.toLowerCase()}
                            className={`relative grid h-8 w-8 place-items-center rounded-lg border-2 border-white shadow transition ${
                              currentAccentColor.toLowerCase() === color.toLowerCase()
                                ? 'ring-2 ring-primary ring-offset-1'
                                : 'ring-1 ring-slate-200 hover:ring-slate-400'
                            }`}
                            style={{ backgroundColor: color }}
                            title={color}
                          >
                            {currentAccentColor.toLowerCase() === color.toLowerCase() && (
                              <Check className="h-4 w-4 text-white drop-shadow" />
                            )}
                          </button>
                        ))}
                        <label
                          className={`relative inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs font-bold transition ${
                            isCustomAccentSelected
                              ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary/20'
                              : 'border-slate-300 bg-white text-slate-600 hover:border-primary hover:text-primary'
                          }`}
                          title="Choose a custom accent color"
                        >
                          <span
                            className="h-4 w-4 rounded border border-black/10"
                            style={{ backgroundColor: customAccentPickerValue }}
                          />
                          Custom
                          <input
                            type="color"
                            aria-label="Custom accent color"
                            value={customAccentPickerValue}
                            onChange={(event) => applyAccentColor(event.target.value)}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setColors(DEFAULT_CHAT_WIDGET_COLORS)}
                          className="h-8 rounded-lg border border-dashed border-slate-300 px-3 text-xs font-bold text-slate-600 hover:border-primary hover:text-primary"
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      {COLOR_FIELDS.map((field) => {
                        const value = colors[field.key];
                        return (
                          <label
                            key={field.key}
                            className="rounded-lg border border-gray-200 bg-white p-3"
                          >
                            <span className="text-xs font-bold text-slate-600">{field.label}</span>
                            <span className="mt-2 flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5">
                              <input
                                type="color"
                                value={isValidHex(value) ? value : '#000000'}
                                onChange={(event) => updateColor(field.key, event.target.value)}
                                className="h-7 w-7 shrink-0 cursor-pointer appearance-none rounded border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none"
                              />
                              <input
                                value={value}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  updateColor(
                                    field.key,
                                    nextValue && !nextValue.startsWith('#')
                                      ? `#${nextValue}`
                                      : nextValue,
                                  );
                                }}
                                maxLength={7}
                                className="min-w-0 flex-1 bg-transparent text-sm font-semibold uppercase text-slate-800 outline-none"
                              />
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>

                  <section className="min-w-0 xl:sticky xl:top-0 xl:self-start">
                    <div className="mb-3 flex justify-center">
                      <div className="inline-flex w-full max-w-[320px] rounded-full bg-slate-100 p-1">
                        {(['closed', 'open', 'chat'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setPreviewMode(mode)}
                            className={`h-8 min-w-0 flex-1 rounded-full px-2 text-xs font-bold capitalize transition sm:px-4 sm:text-sm ${
                              previewMode === mode
                                ? 'bg-primary text-white shadow-sm'
                                : 'text-slate-600 hover:text-slate-950'
                            }`}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mx-auto w-full max-w-[420px] xl:max-w-none">
                      <div
                        className={`flex overflow-hidden rounded-2xl border border-slate-200 bg-white ${
                          previewMode === 'closed'
                            ? 'min-h-[280px] items-end justify-end p-3 sm:min-h-[360px] sm:p-4 xl:min-h-[420px]'
                            : 'h-[420px] items-stretch justify-stretch sm:h-[500px] xl:h-[530px]'
                        }`}
                      >
                        {previewMode === 'closed' && <ChatLauncherPreview colors={colors} />}
                        {previewMode === 'open' && (
                          <ChatOpenPreview agentName={getAgentName(agent)} colors={colors} />
                        )}
                        {previewMode === 'chat' && (
                          <ChatConversationPreview
                            agentName={getAgentName(agent)}
                            colors={colors}
                          />
                        )}
                      </div>
                    </div>
                    <p className="mt-3 text-center text-xs text-slate-500">
                      HTML preview updates as colors change.
                    </p>
                  </section>
                </div>
              ) : (
                <section className="mx-auto min-w-0 max-w-3xl">
                  <h3 className="text-base font-bold text-gray-950">Deploy on your website</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Add this snippet before the closing body tag. The widget renders only on your
                    allowed domain.
                  </p>

                  <label className="mt-5 block">
                    <span className="text-sm font-bold text-slate-700">Allowed domain</span>
                    <input
                      value={allowedDomain}
                      onChange={(event) => setAllowedDomain(event.target.value)}
                      placeholder="example.com"
                      className="mt-2 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-primary"
                    />
                  </label>

                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-700">Embed code</p>
                      <Button type="button" variant="outline" className="h-8" onClick={copyScript}>
                        {copied ? (
                          <>
                            <Check className="h-4 w-4" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="max-h-[300px] overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100 sm:p-4">
                      <code className="whitespace-pre-wrap">{embedScript}</code>
                    </pre>
                  </div>

                  <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                    Almost there. Once this snippet is on your site, {getAgentName(agent)} is live.
                  </div>
                </section>
              )}
            </main>
          </div>

          <div className="flex min-h-[58px] shrink-0 items-center justify-between gap-2 border-t border-gray-200 px-3 py-2 sm:min-h-[62px] sm:px-5 sm:py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                activeStep === 'deploy' ? setActiveStep('design') : closeModal(false)
              }
            >
              {activeStep === 'deploy' ? 'Back' : 'Cancel'}
            </Button>
            {activeStep === 'design' ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => saveConfiguration({ goToDeploy: true })}
                disabled={isSaving || isSavingDomain}
              >
                {isSaving || isSavingDomain ? 'Saving...' : 'Save and continue'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={() => saveConfiguration({ closeAfterSave: true })}
                disabled={isSaving || isSavingDomain}
              >
                {isSaving || isSavingDomain ? 'Saving...' : 'Finish'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChatAgentConfigureModal;
