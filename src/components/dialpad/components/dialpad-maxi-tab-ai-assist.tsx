import type { DialpadSession } from '@/context/dialpad-context';
import { useDialpad } from '@/hooks/use-dialpad';
import { getAISettingToken, getChatAgentList } from '@/services/api';
import { useQuery } from '@tanstack/react-query';
import { Bot, SendHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Picker } from '@/components/mcm/picker';

type DialpadMaxiTabAiAssistProps = {
  activeSession: DialpadSession | null;
};

type ChatAgentOption = {
  label: string;
  value: string;
};

type AiQuestionPayload = {
  agentId: string;
  sessionId: string;
  token: string;
  text: string;
};

const resolveAiTokenValue = (response: any): string => {
  return String(
    response?.data?.data?.result?.tokenId ||
      response?.data?.result?.tokenId ||
      response?.data?.data?.result?.tokenId ||
      response?.data?.data?.result?.token ||
      response?.data?.result?.tokenId ||
      response?.data?.result?.token ||
      '',
  ).trim();
};

const resolveAiChatMessageText = (message: any): string => {
  if (!message) return '';
  const candidate =
    message?.me || String(message?.role || '').toLowerCase() === 'user'
      ? message?.text
      : message?.answer || message?.text || message?.message || message?.content;

  if (typeof candidate === 'string') return candidate;
  if (candidate === null || candidate === undefined) return '';
  if (typeof candidate === 'object') {
    const nestedText = candidate?.text;
    if (typeof nestedText === 'string') return nestedText;
    try {
      return JSON.stringify(candidate);
    } catch {
      return String(candidate);
    }
  }
  return String(candidate);
};

const normalizeAiAnswerPayload = (payload: any): Record<string, any> | null => {
  if (payload === null || payload === undefined) return null;

  if (Array.isArray(payload)) {
    const [eventName, eventBody] = payload;
    if (
      payload.length === 2 &&
      typeof eventName === 'string' &&
      eventBody &&
      typeof eventBody === 'object' &&
      !Array.isArray(eventBody)
    ) {
      return {
        event: eventName,
        ...eventBody,
      };
    }

    if (payload.length === 1) {
      return normalizeAiAnswerPayload(payload[0]);
    }

    return {
      answer: JSON.stringify(payload),
      rawPayload: payload,
    };
  }

  if (typeof payload === 'string') {
    return { answer: payload };
  }

  if (typeof payload === 'object') {
    return payload as Record<string, any>;
  }

  return { answer: String(payload) };
};

const DialpadMaxiTabAiAssist = ({ activeSession }: DialpadMaxiTabAiAssistProps) => {
  const { patchSessionAiInfo, dialpadAiSocket, requestDialpadAiSocketAuth } = useDialpad();
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const pendingQuestionPayloadRef = useRef<AiQuestionPayload | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const selectedAgentIdRef = useRef('');
  const activeSessionRef = useRef<DialpadSession | null>(null);
  const sessionAiAgentId = String(activeSession?.AiInfo?.AiAgentId || '').trim();
  const sessionAiToken = String(activeSession?.AiInfo?.AiToken || '').trim();
  const activeSessionID = String(
    (activeSession as any)?.activeSessionID || activeSession?.id || '',
  ).trim();
  const aiChatMessages = useMemo(
    () => (Array.isArray(activeSession?.AiInfo?.AiChat) ? activeSession.AiInfo.AiChat : []),
    [activeSession?.AiInfo?.AiChat],
  );

  useEffect(() => {
    console.log('[DialpadAIAssist] activeSession', activeSession);
  }, [activeSession]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const { data: chatAgentRows = [], isLoading: isChatAgentListLoading } = useQuery({
    queryKey: ['getChatAgentList', 'dialpad-ai-assist'],
    queryFn: () => getChatAgentList(),
    select: (data: any) => data?.data?.data?.result?.rows || [],
  });

  const chatAgentOptions = useMemo<ChatAgentOption[]>(
    () =>
      (chatAgentRows || [])
        .filter((agent: any) => agent?.agentType !== 'data')
        .map((agent: any) => ({
          label: String(agent?.agentName || '').trim() || 'Unnamed Agent',
          value: String(agent?.agent_uuid || '').trim() || String(agent?.uuid || '').trim(),
        }))
        .filter((agent: ChatAgentOption) => Boolean(agent.value)),
    [chatAgentRows],
  );
  const isNoAgentAvailable = !isChatAgentListLoading && chatAgentOptions.length === 0;
  const canSendQuestion = Boolean(
    !isNoAgentAvailable &&
    questionText.trim() &&
    activeSessionID &&
    String(activeSession?.AiInfo?.AiAgentId || '').trim() &&
    String(activeSession?.AiInfo?.AiToken || '').trim(),
  );

  useEffect(() => {
    if (!chatAgentOptions.length) {
      if (selectedAgentId) setSelectedAgentId('');
      return;
    }

    const selectedOptionExists = chatAgentOptions.some((agent) => agent.value === selectedAgentId);
    if (selectedOptionExists) return;
    const sessionAgentOption = chatAgentOptions.find((agent) => agent.value === sessionAiAgentId);
    if (sessionAgentOption) {
      setSelectedAgentId(sessionAgentOption.value);
      return;
    }

    setSelectedAgentId(chatAgentOptions[0].value);
  }, [chatAgentOptions, selectedAgentId, sessionAiAgentId]);

  const sessionAiTokenForSelectedAgent = useMemo(() => {
    if (!selectedAgentId) return '';
    if (selectedAgentId !== sessionAiAgentId) return '';
    return sessionAiToken;
  }, [selectedAgentId, sessionAiAgentId, sessionAiToken]);

  const shouldFetchAiToken = Boolean(selectedAgentId && !sessionAiTokenForSelectedAgent);

  const { data: aiTokenResponse } = useQuery({
    queryKey: ['getAISettingToken', 'dialpad-ai-assist', selectedAgentId],
    queryFn: () => getAISettingToken({ agentId: selectedAgentId }),
    enabled: shouldFetchAiToken,
  });

  const aiTokenFromApi = useMemo(() => resolveAiTokenValue(aiTokenResponse), [aiTokenResponse]);
  const aiToken = useMemo(
    () => sessionAiTokenForSelectedAgent || aiTokenFromApi,
    [aiTokenFromApi, sessionAiTokenForSelectedAgent],
  );

  useEffect(() => {
    selectedAgentIdRef.current = String(selectedAgentId || '').trim();
  }, [selectedAgentId]);

  useEffect(() => {
    if (!dialpadAiSocket) return;

    const handleAuthorized = () => {
      const token = String(activeSessionRef.current?.AiInfo?.AiToken || '').trim();
      const agentId = String(selectedAgentIdRef.current || '').trim();
      console.log('[DialpadAIAssist] socket.authorized', {
        agentId,
        tokenLength: token.length,
      });

      const pendingQuestionPayload = pendingQuestionPayloadRef.current;
      if (!pendingQuestionPayload) return;

      dialpadAiSocket.emit('question', pendingQuestionPayload);
      pendingQuestionPayloadRef.current = null;
      console.log('[DialpadAIAssist] socket.emit("question") on authorized (pending)', {
        agentId: pendingQuestionPayload.agentId,
        sessionId: pendingQuestionPayload.sessionId,
        tokenLength: pendingQuestionPayload.token.length,
        textLength: pendingQuestionPayload.text.length,
      });
    };

    const handleUnauthorized = () => {
      const session = activeSessionRef.current;
      const sessionId = String(session?.id || '').trim();
      if (!sessionId) return;
      setIsAiThinking(false);

      const existingAiInfo = session?.AiInfo;
      const currentAgentId = String(
        existingAiInfo?.AiAgentId || selectedAgentIdRef.current || '',
      ).trim();
      const existingAiChat = Array.isArray(existingAiInfo?.AiChat) ? existingAiInfo.AiChat : [];

      patchSessionAiInfo(sessionId, {
        AiAgentId: currentAgentId,
        AiToken: '',
        AiChat: existingAiChat,
      });
      console.log('[DialpadAIAssist] unauthorized -> cleared AiToken from session');
    };

    const handleAnswer = (data: any) => {
      const session = activeSessionRef.current;
      const sessionId = String(session?.id || '').trim();
      if (!sessionId) return;
      setIsAiThinking(false);

      const normalizedAnswer = normalizeAiAnswerPayload(data);
      if (!normalizedAnswer) return;

      const existingAiInfo = session?.AiInfo;
      const currentAgentId = String(
        existingAiInfo?.AiAgentId || selectedAgentIdRef.current || '',
      ).trim();
      const currentToken = String(existingAiInfo?.AiToken || '').trim();
      const existingAiChat = Array.isArray(existingAiInfo?.AiChat) ? existingAiInfo.AiChat : [];

      const isTerminalAnswer = Boolean(
        normalizedAnswer?.end ||
        normalizedAnswer?.limitExceeded ||
        String(normalizedAnswer?.reason || '')
          .trim()
          .toLowerCase() === 'session_limit_reached',
      );

      patchSessionAiInfo(sessionId, {
        AiAgentId: currentAgentId,
        AiToken: isTerminalAnswer ? '' : currentToken,
        AiChat: [...existingAiChat, normalizedAnswer],
      });
      console.log('[DialpadAIAssist] answer -> appended AiChat', {
        sessionId,
        isTerminalAnswer,
        nextAiChatLength: existingAiChat.length + 1,
      });

      if (isTerminalAnswer) {
        pendingQuestionPayloadRef.current = null;
      }
    };

    dialpadAiSocket.on('authorized', handleAuthorized);
    dialpadAiSocket.on('unauthorized', handleUnauthorized);
    dialpadAiSocket.on('answer', handleAnswer);

    return () => {
      dialpadAiSocket.off('authorized', handleAuthorized);
      dialpadAiSocket.off('unauthorized', handleUnauthorized);
      dialpadAiSocket.off('answer', handleAnswer);
    };
  }, [dialpadAiSocket, patchSessionAiInfo]);

  useEffect(() => {
    if (!dialpadAiSocket) return;
    const token = String(activeSession?.AiInfo?.AiToken || '').trim();
    if (!token) return;
    requestDialpadAiSocketAuth(token);
  }, [activeSession?.AiInfo?.AiToken, dialpadAiSocket, requestDialpadAiSocketAuth]);

  useEffect(() => {
    const sessionId = String(activeSession?.id || '').trim();
    if (!sessionId || !selectedAgentId) return;

    const existingAiInfo = activeSession?.AiInfo;
    const didAgentChange = String(existingAiInfo?.AiAgentId || '').trim() !== selectedAgentId;
    const nextAiChat = didAgentChange
      ? []
      : Array.isArray(existingAiInfo?.AiChat)
        ? existingAiInfo.AiChat
        : [];
    const existingAiToken = String(existingAiInfo?.AiToken || '').trim();
    const normalizedAiToken = String(aiToken || '').trim();

    if (
      !didAgentChange &&
      existingAiToken === normalizedAiToken &&
      Array.isArray(existingAiInfo?.AiChat)
    ) {
      return;
    }

    console.log('[DialpadAIAssist] patchSessionAiInfo', {
      sessionId,
      AiAgentId: selectedAgentId,
      AiToken: normalizedAiToken,
      AiChatLength: nextAiChat.length,
      tokenSource: sessionAiTokenForSelectedAgent ? 'session' : 'api',
    });

    patchSessionAiInfo(sessionId, {
      AiAgentId: selectedAgentId,
      AiToken: normalizedAiToken,
      AiChat: nextAiChat,
    });
  }, [
    activeSession?.AiInfo,
    activeSession?.id,
    aiToken,
    patchSessionAiInfo,
    selectedAgentId,
    sessionAiTokenForSelectedAgent,
  ]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [aiChatMessages.length, isAiThinking]);

  useEffect(() => {
    setIsAiThinking(false);
  }, [activeSession?.id, selectedAgentId]);

  const handleSendQuestion = () => {
    if (isNoAgentAvailable) return;

    const text = questionText.trim();
    if (!text) return;

    const session = activeSessionRef.current;
    const socket = dialpadAiSocket;
    const agentId = String(session?.AiInfo?.AiAgentId || '').trim();
    const sessionId = String((session as any)?.activeSessionID || session?.id || '').trim();
    const token = String(session?.AiInfo?.AiToken || '').trim();

    if (!socket || !agentId || !sessionId || !token) return;

    const existingAiInfo = session?.AiInfo;
    const existingAiChat = Array.isArray(existingAiInfo?.AiChat) ? existingAiInfo.AiChat : [];

    patchSessionAiInfo(sessionId, {
      AiAgentId: agentId,
      AiToken: token,
      AiChat: [...existingAiChat, { me: true, text }],
    });
    setIsAiThinking(true);

    const payload: AiQuestionPayload = {
      agentId,
      sessionId,
      token,
      text,
    };

    if (!socket.connected) {
      pendingQuestionPayloadRef.current = payload;
      requestDialpadAiSocketAuth(token);
      setQuestionText('');
      return;
    }

    socket.emit('question', payload);
    console.log('[DialpadAIAssist] socket.emit("question") on send', {
      agentId: payload.agentId,
      sessionId: payload.sessionId,
      tokenLength: payload.token.length,
      textLength: payload.text.length,
    });
    setQuestionText('');
  };

  if (!activeSession) {
    return (
      <div className="h-full rounded-2xl border border-ucass-active-bg bg-ucass-active-bg px-3 py-3 max-[380px]:px-2.5 max-[380px]:py-2.5 sm:px-4 sm:py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5a7396] max-[380px]:text-[10px] sm:text-xs">
          AI Assist
        </p>
        <p className="mt-2 text-[13px] text-[#6c809e] max-[380px]:text-xs sm:text-sm">
          No active session available.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-ucass-active-bg bg-white px-3 py-3 max-[380px]:px-2.5 max-[380px]:py-2.5 sm:px-4 sm:py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-primary">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-ucass-active-bg">
            <Bot className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5a7396] max-[380px]:text-[10px] sm:text-xs">
              AI Assist
            </p>
            <p className="text-xs text-[#6c809e]">Live call insights and recommendations</p>
          </div>
        </div>

        <div className="min-w-[160px] max-w-[220px]">
          <Picker
            label="AI agent"
            showLabel={false}
            className="mcm-field"
            disabled={isChatAgentListLoading || chatAgentOptions.length === 0}
            placeholder={isChatAgentListLoading ? 'Loading agents…' : 'No agents available'}
            value={selectedAgentId}
            options={chatAgentOptions.map((agent) => ({
              label: String(agent.label),
              value: String(agent.value),
            }))}
            onChange={(option) => setSelectedAgentId(option.value)}
          />
        </div>
      </div>

      <div
        ref={chatScrollRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-ucass-active-bg bg-white p-2.5"
      >
        {isNoAgentAvailable ? (
          <p className="text-xs text-[#6c809e]">
            No agent is available, so you cannot use AI Assist.
          </p>
        ) : aiChatMessages.length === 0 ? (
          <p className="text-xs text-[#6c809e]">No chat messages yet. Ask a question to begin.</p>
        ) : (
          aiChatMessages.map((message: any, index: number) => {
            const text = resolveAiChatMessageText(message);
            const isUserMessage =
              Boolean(message?.me) || String(message?.role || '').toLowerCase() === 'user';
            return (
              <div
                key={`${message?.id || message?.sessionId || 'ai-chat'}-${index}`}
                className={`flex ${isUserMessage ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-5 sm:text-sm ${
                    isUserMessage
                      ? 'bg-primary text-white'
                      : 'border border-ucass-active-bg bg-[#f9fbff] text-[#27466f]'
                  }`}
                >
                  {text || '-'}
                </div>
              </div>
            );
          })
        )}
        {isAiThinking ? (
          <div className="flex justify-start">
            <div className="max-w-[88%] rounded-xl border border-ucass-active-bg bg-[#f9fbff] px-3 py-2 text-xs leading-5 text-[#27466f] sm:text-sm">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 rounded-xl border border-[#d7e3f5] bg-white p-2">
        <div className="relative">
          <textarea
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            disabled={isNoAgentAvailable}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSendQuestion();
              }
            }}
            placeholder={
              isNoAgentAvailable ? 'No agent available for AI Assist' : 'Ask a question...'
            }
            className="h-[72px] w-full resize-none rounded-lg border-0 bg-transparent px-2.5 py-2 pr-11 text-[13px] text-[#233f63] outline-none placeholder:text-[#8ca0bc] sm:text-sm"
          />
          <button
            type="button"
            onClick={handleSendQuestion}
            disabled={!canSendQuestion}
            className={`absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
              canSendQuestion
                ? 'bg-primary text-white hover:bg-primary'
                : 'cursor-not-allowed bg-ucass-active-bg text-[#8ea3c2]'
            }`}
            aria-label="Send question"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DialpadMaxiTabAiAssist;
