import { Icon } from '@/assets/icons/icon';
import { IconType } from '@/assets/icons/type';
import { Picker } from '@/components/mcm/picker';
import { AISettingConfig, getAISettingConfig, getChatAgentList } from '@/services/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleAlert } from '@/lib/utils';

const socialMediaList = [
  { key: 'facebook', apiName: 'FACEBOOK', name: 'Facebook', icon: 'Messanger' },
  { key: 'whatsapp', apiName: 'WHATSAPP', name: 'WhatsApp', icon: 'WhatsappIcon' },
  { key: 'telegram', apiName: 'TELEGRAM', name: 'Telegram', icon: 'TelegramIcon' },
  { key: 'instagram', apiName: 'INSTAGRAM', name: 'Instagram', icon: 'Instagram' },
  { key: 'on_call', apiName: 'ON_CALL', name: 'On call', icon: 'PhoneCallingLine' },
  { key: 'chat_assistant', apiName: 'CHAT_ASSISTANT', name: 'Chat assistant', icon: 'Chat2' },
];

/* The page is two columns of the same channel names with nothing saying how
   they differ — the one thing somebody opening it needs to know. They are two
   different jobs: the bot talks to your customer instead of you, the assistant
   sits in your own inbox and drafts what you might say. Picking the wrong
   column puts an AI in front of a customer when you meant to help an agent. */
const panels = [
  {
    type: 'AI_BOT' as const,
    field: 'aiBot',
    title: 'AI bot',
    blurb: 'Answers the customer directly on that channel, with no one else in the conversation.',
    /* On call and Chat assistant are staff-side surfaces, so there is no
       customer-facing bot to put on them. */
    channels: socialMediaList.filter(
      (media) => media.key !== 'on_call' && media.key !== 'chat_assistant',
    ),
  },
  {
    type: 'AI_ASSISTANT' as const,
    field: 'aiAssistance',
    title: 'AI assist',
    blurb: 'Suggests replies to your team inside the inbox. Nothing is sent until someone sends it.',
    channels: socialMediaList,
  },
];

function AISettings() {
  const navigate = useNavigate();

  /* Was react-hook-form with a Controller per row. Nothing is ever submitted —
     every pick fires its own mutation — so the form was holding two plain
     objects and giving back a `reset` this could do itself. */
  const [assigned, setAssigned] = useState<Record<string, Record<string, string>>>({
    aiBot: {},
    aiAssistance: {},
  });

  const { data: typeListData = [] } = useQuery({
    queryKey: ['getChatAgentList'],
    queryFn: () => getChatAgentList(),
    select: (data) => data?.data?.data?.result?.rows || [],
  });

  const allAgents = useMemo(() => {
    return (
      (typeListData || []).map((agent: any) => ({
        label: agent?.agentName,
        value: agent?._id,
      })) || []
    );
  }, [typeListData]);

  /* "Nobody" is the first option rather than a clear button beside the field:
     turning a channel off is the same kind of decision as picking who answers
     it, so it belongs in the same list. */
  const agentChoices = useMemo(
    () => [{ label: 'Nobody — off', value: '' }, ...allAgents],
    [allAgents],
  );

  const { data: savedSettings = [] } = useQuery({
    queryKey: ['getAISettingConfig'],
    queryFn: () => getAISettingConfig(),
    select: (data) => data?.data?.data || [],
  });
  const { mutate } = useMutation({
    mutationFn: AISettingConfig,
    mutationKey: ['AISettingConfig'],
    onSuccess: (data) => {
      handleAlert({
        text:
          data?.data?.data?.message ||
          data?.data?.message ||
          'AI agent setting updated successfully',
        type: 'success',
      });
    },
  });

  /* There were two of these — one guarded by an `initialized` flag that could
     only ever run first, and this one, which does the same work unguarded. The
     flag and its effect were dead the moment the second one existed. */
  useEffect(() => {
    if (!savedSettings?.length || !allAgents?.length) return;
    const next: Record<string, Record<string, string>> = { aiBot: {}, aiAssistance: {} };
    savedSettings.forEach((item: any) => {
      const media = socialMediaList.find((m) => m.apiName === item?.name);
      const agent = allAgents.find((a: any) => a?.value === item?.agentId);
      if (!media || !agent) return;
      next[item?.type === 'AI_BOT' ? 'aiBot' : 'aiAssistance'][media.key] = agent.value;
    });
    setAssigned(next);
  }, [savedSettings, allAgents]);

  const handleAgentUpdate = (panel: (typeof panels)[number], media: any, agentId: string) => {
    setAssigned((current) => ({
      ...current,
      [panel.field]: { ...current[panel.field], [media.key]: agentId },
    }));
    mutate({ type: panel.type, name: media?.apiName, agentId });
  };

  return (
    <section className="mcm-aiset">
      <div className="mcm-aiset-head">
        <div className="mcm-aihead-b">
          <button
            type="button"
            onClick={() => navigate('/admin-settings/knowledge/ai-agent')}
            className="transition-colors hover:text-primary"
          >
            AI Agents
          </button>
          <span>/</span>
          <span className="mcm-aihead-here">Settings</span>
        </div>
        {/* Was floated to the far right of the bar, on its own, reading as a
            caption belonging to nothing. */}
        <p className="mcm-aihead-d">
          Which agent handles each channel. Changes save as you pick them.
        </p>
      </div>

      <div className="mcm-aiset-body">
        <div className="mcm-aiset-cols">
          {panels.map((panel) => (
            <section key={panel.type} className="mcm-aiset-card">
              <header className="mcm-aiset-cardhead">
                <h3>{panel.title}</h3>
                <p>{panel.blurb}</p>
              </header>
              <div className="mcm-aiset-rows">
                {panel.channels.map((media) => (
                  <div key={media.key} className="mcm-aiset-row">
                    <div className="mcm-aiset-chan">
                      <Icon name={media.icon as IconType} className="h-[18px] w-[18px]" />
                      <span>{media.name}</span>
                    </div>

                    <Picker
                      label={`${panel.title} on ${media.name}`}
                      showLabel={false}
                      className="mcm-aiset-sel"
                      value={assigned[panel.field]?.[media.key] || ''}
                      options={agentChoices}
                      onChange={(option) => handleAgentUpdate(panel, media, option.value)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

export default AISettings;
