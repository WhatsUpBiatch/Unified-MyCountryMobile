import { useSocketEvents } from '@/hooks/use-socket-events';
import { useUser } from '@/hooks/use-user';
import { Bot, CircleAlert, CircleCheck, Clock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import AgentChatFooter from './chat/agent-chat-footer';
import AgentChatHeader from './chat/agent-chat-header';
import AgentChatMessages from './chat/agent-chat-messages';

export type AgentChatProps = {
  chatId?: string;
  fromMeetChat?: boolean;
  onBackToList?: () => void;
  onOpenProfile?: () => void;
  pendingRequest?: any;
  onPendingAccepted?: (chatId: string) => void;
};

const AgentChat = ({
  chatId = '',
  onBackToList,
  onOpenProfile,
  pendingRequest = null,
  onPendingAccepted,
}: AgentChatProps) => {
  const { user } = useUser();
  const [isAcceptingRequest, setIsAcceptingRequest] = useState(false);
  const {
    allAgentChats = [],
    typingList = {},
    handleAiChatAccept,
    setAiChatRequests,
  } = useSocketEvents();

  const pendingChat = useMemo(() => {
    if (!pendingRequest?.chatId) return null;

    const rawUsers = pendingRequest?.users;
    const userList = Array.isArray(rawUsers) ? rawUsers : rawUsers ? [rawUsers] : [];
    const pendingVisitor =
      userList.find((chatUser: any) => chatUser?.uuid && chatUser?.uuid !== user?.uuid) ||
      userList.find((chatUser: any) => chatUser?.name || chatUser?.email) ||
      {};

    const visitorName =
      pendingVisitor?.name ||
      `${pendingVisitor?.first_name || ''} ${pendingVisitor?.last_name || ''}`.trim() ||
      pendingVisitor?.email ||
      'Unknown Visitor';

    return {
      chatId: pendingRequest.chatId,
      createdAt:
        pendingRequest?.createdAt || pendingRequest?.requestedAt || new Date().toISOString(),
      users: [
        {
          ...pendingVisitor,
          uuid: pendingVisitor?.uuid || 'pending-visitor',
          name: visitorName,
        },
        {
          uuid: 'AI-Bot',
          name: 'AI Assistant',
        },
      ],
      isPendingRequest: true,
      metaData: {
        ...(pendingRequest?.metaData || {}),
      },
    };
  }, [pendingRequest, user?.uuid]);

  const currentChat = useMemo(() => {
    const existingChat = (Array.isArray(allAgentChats) ? allAgentChats : []).find(
      (chat: any) => chat?.chatId === chatId,
    );
    if (pendingRequest?.chatId && pendingRequest.chatId === chatId) {
      const base = existingChat || pendingChat;
      if (!base) return null;
      return {
        ...base,
        users:
          Array.isArray(base?.users) && base.users.length
            ? base.users
            : Array.isArray(pendingChat?.users)
              ? pendingChat.users
              : [],
        createdAt: base?.createdAt || pendingChat?.createdAt,
        metaData: {
          ...(pendingChat?.metaData || {}),
          ...(base?.metaData || {}),
        },
        isPendingRequest: true,
      };
    }
    if (existingChat) return existingChat;
    if (pendingChat?.chatId === chatId) return pendingChat;
    return null;
  }, [allAgentChats, chatId, pendingChat, pendingRequest?.chatId]);

  const isPendingRequestChat =
    Boolean(pendingRequest?.chatId && pendingRequest?.chatId === chatId) &&
    pendingRequest?.status === 'pending';
  const isAbandonedRequestChat =
    Boolean(pendingRequest?.chatId && pendingRequest?.chatId === chatId) &&
    pendingRequest?.status === 'abandoned';

  const pendingTopic = useMemo(() => {
    const candidate =
      pendingRequest?.topic ||
      pendingRequest?.queue ||
      pendingRequest?.intent ||
      pendingRequest?.metaData?.topic ||
      pendingRequest?.metaData?.intent ||
      '';
    if (!candidate) return '';
    return `${candidate}`.trim();
  }, [pendingRequest]);

  const typingText = useMemo(() => {
    if (isPendingRequestChat) return '';
    if (!currentChat?.chatId) return '';
    const typingUsers = Array.isArray(typingList?.[currentChat.chatId])
      ? typingList[currentChat.chatId]
      : [];
    if (!typingUsers.length) return '';

    const names = (Array.isArray(currentChat?.users) ? currentChat.users : [])
      .filter(
        (chatUser: any) => typingUsers.includes(chatUser?.uuid) && chatUser?.uuid !== user?.uuid,
      )
      .map(
        (chatUser: any) =>
          chatUser?.name || `${chatUser?.first_name || ''} ${chatUser?.last_name || ''}`.trim(),
      )
      .filter(Boolean);

    return names.length ? `${names.join(', ')} typing...` : 'Typing...';
  }, [typingList, currentChat, user?.uuid, isPendingRequestChat]);

  const acceptPendingRequest = () => {
    const pendingChatId = pendingRequest?.chatId;
    if (!pendingChatId || !user?.uuid || isAcceptingRequest) return;

    setIsAcceptingRequest(true);
    const payload = {
      chatId: pendingChatId,
      company_uuid: user?.company_info?.uuid,
      domain: user?.sip_credentials?.domain || '',
      token: pendingRequest?.token,
      users: [
        {
          uuid: user?.uuid,
          name: `${user?.first_name || user?.user_info?.first_name || ''} ${user?.last_name || user?.user_info?.last_name || ''}`.trim(),
          email: user?.email || user?.user_info?.email,
          extension: user?.extension || user?.user_info?.extension,
        },
        pendingRequest?.users,
      ],
    };

    handleAiChatAccept(payload, (response: any) => {
      setIsAcceptingRequest(false);
      if (response?.status === 200 || response?.success) {
        toast.success('Chat request accepted!');
        setAiChatRequests((prev: any[]) =>
          (Array.isArray(prev) ? prev : []).filter(
            (request: any) => request?.chatId !== pendingChatId,
          ),
        );

        onPendingAccepted?.(pendingChatId);
      } else {
        toast.error(response?.message || 'Failed to accept chat request');
      }
    });
  };

  if (!currentChat?.chatId) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-ucass-gray">
        <div className="text-center px-6">
          <Bot className="mx-auto mb-6 h-12 w-12 text-muted-foreground" strokeWidth={2} />
          <div className="text-[13px] leading-6 font-medium text-muted-foreground">
            Select a conversation from the queue to start providing support.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-white">
      <AgentChatHeader
        currentChat={currentChat}
        onBackToList={onBackToList}
        onOpenProfile={onOpenProfile}
        isPendingRequest={isPendingRequestChat || isAbandonedRequestChat}
        pendingTopic={pendingTopic}
      />
      <div className="flex-1 min-h-0 flex flex-col bg-white">
        <AgentChatMessages currentChat={currentChat} />
        {isPendingRequestChat ? (
          <div className="w-full shrink-0 border-t-[3px] border-t-ucass-orange bg-ucass-orange/10 px-4 py-6">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-ucass-orange bg-white">
                <CircleAlert className="h-5 w-5 text-ucass-orange" />
              </div>
              <div className="text-[17px] font-bold leading-snug text-ucass-active">
                Incoming Chat Request
              </div>
              <div className="text-[13px] leading-5 text-muted-foreground">
                <p>This user was handed off by the AI bot and is waiting for assistance.</p>
                <p>Accept to start chatting.</p>
              </div>
              <button
                type="button"
                onClick={acceptPendingRequest}
                disabled={isAcceptingRequest}
                className="mt-1 inline-flex h-10 min-w-[180px] cursor-pointer items-center justify-center rounded-xl bg-ucass-active px-6 text-[13px] font-semibold leading-none text-white shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAcceptingRequest ? 'Accepting...' : 'Accept Request'}
              </button>
            </div>
          </div>
        ) : isAbandonedRequestChat ? (
          <div className="w-full shrink-0 border-t border-destructive/20 bg-destructive/5 px-4 py-5">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
                <Clock className="h-5 w-5 text-destructive" />
              </div>
              <div className="text-[15px] font-bold leading-snug text-destructive">
                {currentChat?.endedBy ? 'Chat Closed By User' : 'Chat Auto-Closed (Timeout)'}
              </div>
              {!currentChat?.endedBy && (
                <p className="text-[13px] leading-5 text-destructive">
                  No agent accepted this chat within the 10-minute SLA. The user was emailed the
                  fallback contact details.
                </p>
              )}
            </div>
          </div>
        ) : currentChat?.isEnded ? (
          <div className="w-full shrink-0 border-t border-border bg-ucass-gray px-4 py-4">
            <div className="flex flex-col items-center justify-center gap-1.5">
              <CircleCheck className="h-6 w-6 text-green-500" strokeWidth={1.8} />
              <span className="text-[13px] leading-6 font-medium text-muted-foreground">
                This conversation has been resolved.
              </span>
            </div>
          </div>
        ) : (
          <AgentChatFooter currentChat={currentChat} typingText={typingText} />
        )}
      </div>
    </div>
  );
};

export default AgentChat;
