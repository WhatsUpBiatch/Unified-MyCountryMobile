import { Send } from '@/assets/icons';
import { getAISettingConfig, getAISettingToken } from '@/services/api';
import { useQuery } from '@tanstack/react-query';
import { AI_SETTINGS_TYPES } from '../../../messenger/constants';
import { useEffect, useRef, useState } from 'react';
import { makeAISocketConnection } from '@/lib/utils';
import Loader from '@/components/custom/loader';
import { Minus, Sparkles } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

const aiMarkdownPlugins = [remarkGfm, remarkBreaks];

const aiMarkdownClassName = [
  'text-sm leading-6 break-words overflow-x-auto',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_p]:mb-2',
  '[&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold',
  '[&_h2]:mb-2 [&_h2]:text-[15px] [&_h2]:font-semibold',
  '[&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold',
  '[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:mb-1 [&_li>p]:mb-1',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:text-gray-700',
  '[&_pre]:my-2 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-gray-50 [&_pre]:p-2',
  '[&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px]',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:my-2 [&_table]:border-collapse [&_table]:text-xs',
  '[&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1',
].join(' ');

const aiMarkdownComponents: Components = {
  a: ({ node, ...props }) => {
    void node;

    return (
      <a
        {...props}
        className="text-ucass-active underline underline-offset-2"
        target="_blank"
        rel="noreferrer"
      />
    );
  },
};

const AiAssist = ({
  lineHeight,
  onClose,
  type = AI_SETTINGS_TYPES.WHATSAPP,
  chatId,
  aiSettings,
  aiSetting,
  // prefillText = '',
  isEmbedded = false,
}: {
  lineHeight: string;
  onClose: () => void;
  type?: string;
  chatId?: string;
  aiSettings?: any[] | null;
  aiSetting?: any;
  prefillText?: string;
  isEmbedded?: boolean;
}) => {
  const hasAiSettingsProp = Array.isArray(aiSettings);
  const hasAiSettingProp = Boolean(aiSetting);
  const shouldFetchAiSettings = !hasAiSettingsProp && !hasAiSettingProp;
  const { data: savedSettings = [] } = useQuery({
    queryKey: ['getAISettingConfig'],
    queryFn: () => getAISettingConfig(),
    select: (data) => data?.data?.data || [],
    enabled: shouldFetchAiSettings,
  });

  const { data: AITokenData = { tokenId: '' } } = useQuery({
    queryKey: ['getAISettingToken'],
    queryFn: () => getAISettingToken(),
    select: (data): { tokenId: string } => data?.data?.data?.result || { tokenId: '' },
  });

  const availableSettings = hasAiSettingsProp ? aiSettings : savedSettings;
  const selectedAiSetting =
    aiSetting ||
    (Array.isArray(availableSettings)
      ? availableSettings.find(
          (setting: any) => setting?.name === type && setting?.type === 'AI_ASSISTANT',
        )
      : null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [aiSocket, setAISocket] = useState<any>(null);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tokenData, setTokenData] = useState<any>(null);
  const [AIToken, setAIToken] = useState<string>('');
  const [aiChat, setAiChat] = useState<any>(null);
  const quickActions = ['Campaign Analysis', 'Lead Insights', 'Performance Tips'];

  const safeChat = Array.isArray(aiChat) ? aiChat : [];

  useEffect(() => {
    if (AITokenData?.tokenId) {
      setTokenData(AITokenData);
    }
  }, [AITokenData]);

  // Auto scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [safeChat?.length, isLoading, isAiLoading]);

  useEffect(() => {
    if (chatId && selectedAiSetting?.agentId && AIToken) {
      setIsAiLoading(true);
      const socket = makeAISocketConnection();
      if (socket) {
        socket.on('connect', () => {
          setTimeout(() => {
            initialEmitters(socket);
          }, 1000);
        });

        socket.on('reconnect', () => {
          setTimeout(() => {
            initialEmitters(socket);
          }, 1000);
        });

        socket.on('disconnect', (reason: any) => {
          console.log('disconnected');
          if (reason === 'io server disconnect') {
            socket.connect();
          }
        });

        socket.on('authorized', () => {
          console.log('under auth');
          setIsAiLoading(false);
          if (safeChat && !safeChat?.length) {
            socket.emit('question', {
              agentId: selectedAiSetting?.agentId,
              token: AIToken,
            });
          }
        });

        socket.on('unauthorized', () => {
          socket.disconnect();
          setIsAiLoading(true);
          setAIToken('');
        });

        socket.on('answer', (data: any) => {
          setIsLoading(false);
          handleChat({
            mode: 'ai-chat',
            ...data,
          });
        });

        socket.connect();
        setAISocket(socket);
      }
      return () => {
        turnOffListeners(socket);
      };
    }
  }, [chatId, selectedAiSetting?.agentId, AIToken]);

  useEffect(() => {
    if (
      !AIToken &&
      !!tokenData?.tokenId
      // !!tokenData?.result?.data_conversational_agent_id
    ) {
      setAIToken(tokenData?.tokenId);
    }
  }, [tokenData]);

  // useEffect(() => {
  //   const normalizedPrefill = `${prefillText || ''}`.trim();
  //   if (!normalizedPrefill) return;
  //   setText((prev) => {
  //     console.log('🚀 ~ AiAssist ~ prev:', prev);
  //     return prev.trim() ? prev : normalizedPrefill;
  //   });
  // }, [prefillText, chatId]);

  function initialEmitters(socket: any) {
    socket.emit('auth', AIToken);
  }

  function turnOffListeners(socket: any) {
    if (socket) {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('reconnect');
    }
  }

  function handleChat(data: any) {
    if (data?.mode === 'ai-chat') {
      const enrichedMessage = {
        ...data,
        timestamp: data?.timestamp || data?.createdAt || new Date().toISOString(),
      };
      setAiChat((prev: any) => {
        const safePrev = prev || [];
        return [...safePrev, enrichedMessage];
      });
    }
  }

  function handleSendChat(text: string) {
    if (isLoading || !text.trim()) return;
    setIsLoading(true);
    const sessionId = safeChat?.[0]?.sessionId || '';
    const payload = {
      agentId: selectedAiSetting?.agentId,
      sessionId,
      token: AIToken,
      text,
      timestamp: new Date().toISOString(),
    };

    handleChat({
      mode: 'ai-chat',
      me: true,
      ...payload,
    });

    aiSocket?.emit('question', payload);

    setText('');
  }

  function handleQuickActionClick(actionText: string) {
    setText(actionText);
  }

  function formatMessageTime(value: string) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  return (
    <div
      className={
        isEmbedded
          ? 'h-full min-h-0 w-full max-w-none bg-white border-l border-ucass-active-bg overflow-hidden flex flex-col'
          : 'rounded-xl bg-white shadow-[0_10px_35px_rgba(2,37,92,0.16)] border border-ucass-active-bg overflow-hidden fixed bottom-16 right-5 w-full max-w-[360px] z-[60]'
      }
    >
      {/* Chat Head */}
      <div
        className={`${isEmbedded ? '' : 'rounded-t-xl'} px-4 py-3 bg-ucass-active flex items-center justify-between gap-2`}
      >
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center border border-white/35">
            <Sparkles className="text-white w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <h3 className="text-base leading-5 text-white font-semibold">AI Assistant</h3>
            <p className="text-xs text-white/80">Online</p>
          </div>
        </div>
        <span className="cursor-pointer px-1 py-1 text-white/90 hover:text-white" onClick={onClose}>
          <Minus className="w-4 h-4" />
        </span>
      </div>
      <div className="px-3 pt-2 pb-3 bg-ucass-active-bg/60 border-b border-ucass-active-bg">
        <p className="text-sm text-gray-700 font-medium mb-2">Quick Actions</p>
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <button
              key={action}
              type="button"
              className="rounded-full px-3 py-1 bg-ucass-active-bg text-ucass-active text-[13px] leading-5 cursor-pointer hover:bg-ucass-primary-200 hover:text-primary transition-colors"
              onClick={() => handleQuickActionClick(action)}
            >
              {action}
            </button>
          ))}
        </div>
      </div>
      {/* Chat Box */}
      <div
        ref={scrollRef}
        className={
          isEmbedded
            ? 'p-3 bg-white w-full flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto'
            : 'p-3 bg-white w-full flex flex-col gap-3 min-h-[360px] max-h-[420px] overflow-y-auto'
        }
      >
        {/* left items */}
        {safeChat?.length
          ? safeChat?.map((item: any, index: number) => {
              return (
                <div
                  key={item?.id || item?.messageId || item?.timestamp || item?.createdAt || index}
                  className={`w-full flex flex-col gap-1 ${item?.me ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`p-3 rounded-lg ${
                      item?.me
                        ? 'bg-ucass-active rounded-br-sm text-white w-fit max-w-[90%]'
                        : 'bg-white border border-gray-200 rounded-bl-sm text-gray-900 w-fit max-w-[90%]'
                    }`}
                  >
                    {item?.me ? (
                      <p className="text-sm leading-6 whitespace-pre-wrap break-words">
                        {item?.text}
                      </p>
                    ) : (
                      <div className={aiMarkdownClassName}>
                        <ReactMarkdown
                          remarkPlugins={aiMarkdownPlugins}
                          components={aiMarkdownComponents}
                          skipHtml
                        >
                          {String(item?.answer || '')}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 px-0.5">
                    {formatMessageTime(item?.timestamp || item?.createdAt)}
                  </p>
                </div>
              );
            })
          : null}
        {isAiLoading || isLoading ? (
          <div className="w-full flex items-center justify-center p-3">
            <Loader variant="blue" />
          </div>
        ) : null}
      </div>
      {/* Chat Footer */}
      <div className="p-3 bg-gray-50 w-full flex items-center gap-2 border-t border-gray-200 relative">
        <textarea
          className={`w-full h-full max-h-[46px] ${lineHeight} p-2 pr-[44px] rounded-xl text-sm overflow-y-auto placeholder:text-gray-500 focus:ring-0 focus-visible:shadow-none focus-visible:outline-0 text-gray-900 shadow-none resize-none border border-gray-200 bg-white`}
          placeholder="Ask AI anything..."
          value={text}
          disabled={isAiLoading || isLoading}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!isLoading && text.trim()) {
                handleSendChat(text);
              }
            }
          }}
          // disabled={isSendingMessage}
        />
        <div
          className={`${isLoading || !text.trim() ? 'cursor-not-allowed bg-gray-100 text-gray-400' : 'cursor-pointer bg-ucass-active text-white hover:bg-primary'} absolute bottom-[20px] right-[20px] flex items-center justify-center rounded-full w-[30px] min-w-[30px] h-[30px] transition-colors`}
          onClick={() => handleSendChat(text)}
        >
          <button
            className={`${isLoading || !text.trim() ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiAssist;
