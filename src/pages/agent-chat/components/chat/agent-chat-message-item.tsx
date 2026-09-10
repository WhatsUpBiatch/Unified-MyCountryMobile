import { useEffect, useRef, useState } from 'react';
import moment from 'moment';
import { Bot, ChevronDown, ChevronUp, CircleAlert } from 'lucide-react';
import { useUser } from '@/hooks/use-user';

type MessageSegment = { type: 'text'; content: string } | { type: 'list'; items: string[] };

const extractMessageText = (value: any): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractMessageText(item))
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  if (typeof value === 'object') {
    if (typeof value?.text === 'string') return value.text.trim();
    if (typeof value?.message === 'string') return value.message.trim();
    if (typeof value?.value === 'string') return value.value.trim();
    if (Array.isArray(value?.children)) return extractMessageText(value.children);
    if (Array.isArray(value?.content)) return extractMessageText(value.content);
  }

  return '';
};

const normalizeMessageText = (value: string): string => {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n');
};

const renderFormattedContent = (text: string) => {
  if (!text) return null;

  // Split by **bold text**
  const parts = text.split(/(\*\*.*?\*\*)/g);

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
};

const parseMessageSegments = (value: string): MessageSegment[] => {
  const normalized = normalizeMessageText(value);
  const lines = normalized.split('\n');
  const segments: MessageSegment[] = [];
  let textBuffer: string[] = [];
  let listBuffer: string[] = [];

  const flushText = () => {
    if (!textBuffer.length) return;
    segments.push({ type: 'text', content: textBuffer.join('\n').trim() });
    textBuffer = [];
  };

  const flushList = () => {
    if (!listBuffer.length) return;
    segments.push({ type: 'list', items: [...listBuffer] });
    listBuffer = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const listMatch = trimmed.match(/^[-*]\s+(.*)$/);

    if (listMatch) {
      flushText();
      listBuffer.push(listMatch[1].trim());
      return;
    }

    if (!trimmed) {
      flushText();
      flushList();
      return;
    }

    flushList();
    textBuffer.push(line);
  });

  flushText();
  flushList();

  return segments;
};

const AgentChatMessageItem = ({ msgObj, currentChat }: { msgObj: any; currentChat: any }) => {
  const { user } = useUser();
  const [isMessageExpanded, setIsMessageExpanded] = useState(false);
  const [isMessageOverflowing, setIsMessageOverflowing] = useState(false);
  const messageContentRef = useRef<HTMLDivElement | null>(null);

  const messageText = extractMessageText(msgObj?.message || '') || 'System Message';
  const formattedTime = msgObj?.createdAt ? moment(msgObj.createdAt).format('hh:mm A') : '';
  const senderId = msgObj?.senderId || '';
  const isBotMessage = senderId === 'AI-Bot';
  const users = Array.isArray(currentChat?.users) ? currentChat.users : [];
  const isMine = senderId === user?.uuid;
  const senderData = users.find((chatUser: any) => chatUser?.uuid === senderId);

  const senderDisplayName = isBotMessage
    ? 'AI Assistant'
    : isMine
      ? `${senderData?.name || 'You'} (You)`
      : senderData?.name ||
        `${senderData?.first_name || ''} ${senderData?.last_name || ''}`.trim() ||
        'Unknown User';
  const isRightAligned = isMine || isBotMessage;
  const messageSegments = parseMessageSegments(messageText);
  const collapsedMessageHeight = 110;

  useEffect(() => {
    setIsMessageExpanded(false);
  }, [msgObj?.messageId, msgObj?.message, msgObj?.updatedAt]);

  useEffect(() => {
    const measureOverflow = () => {
      try {
        const contentEl = messageContentRef.current;
        if (!contentEl) {
          setIsMessageOverflowing(false);
          return;
        }

        const previousMaxHeight = contentEl.style.maxHeight;
        const previousOverflow = contentEl.style.overflow;
        contentEl.style.maxHeight = 'none';
        contentEl.style.overflow = 'visible';
        const fullHeight = contentEl.scrollHeight;
        contentEl.style.maxHeight = previousMaxHeight;
        contentEl.style.overflow = previousOverflow;

        setIsMessageOverflowing(fullHeight > collapsedMessageHeight + 2);
      } catch (error) {
        console.error('AgentChatMessageItem: Failed to measure message overflow', error);
        setIsMessageOverflowing(false);
      }
    };

    measureOverflow();
    if (typeof window === 'undefined') return;

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureOverflow) : null;
    if (resizeObserver && messageContentRef.current) {
      resizeObserver.observe(messageContentRef.current);
    }
    window.addEventListener('resize', measureOverflow);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureOverflow);
    };
  }, [collapsedMessageHeight, messageSegments, messageText]);

  if (!msgObj) return null;

  if (msgObj?.messageType === 'meet') return null;

  if (msgObj?.messageType === 'prompt' || msgObj?.messageType === 'alert') {
    const content =
      extractMessageText(msgObj?.alertContent?.updateMessage || msgObj?.message || '') ||
      messageText;
    return (
      <div className="my-3 flex w-full justify-center text-xs">
        <div className="inline-flex max-w-[95%] items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm sm:max-w-none sm:gap-2 sm:px-4 sm:text-[13px]">
          <CircleAlert size={13} className="shrink-0 text-muted-foreground" />
          <span className="truncate font-normal text-ucass-active">{content}</span>
          {formattedTime ? (
            <span className="shrink-0 text-muted-foreground">{formattedTime}</span>
          ) : null}
        </div>
      </div>
    );
  }

  if (msgObj?.isDeleted) {
    return (
      <div className={`w-full flex ${isRightAligned ? 'justify-end' : 'justify-start'} py-1`}>
        <div
          className={`${isRightAligned ? 'items-end max-w-[86%] sm:max-w-[74%]' : 'items-start max-w-[86%] sm:max-w-[52%]'} flex flex-col gap-1`}
        >
          <div className="flex items-center gap-2 text-[11px] sm:text-[12px]">
            <span className={`font-semibold ${isMine ? 'text-ucass-active' : 'text-foreground'}`}>
              {senderDisplayName}
            </span>
            <span className="text-muted-foreground">{formattedTime}</span>
          </div>
          <div className="rounded-t-xl rounded-bl-xl rounded-br-xl border border-border bg-white px-3 py-2 text-[13px] italic text-muted-foreground sm:px-4 sm:text-[14px]">
            {isMine ? 'You deleted this message' : 'This message was deleted'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full flex ${isRightAligned ? 'justify-end' : 'justify-start'} py-1.5`}>
      <div
        className={`flex flex-col gap-1 ${isRightAligned ? 'items-end max-w-[86%] sm:max-w-[74%]' : 'items-start max-w-[86%] sm:max-w-[52%]'}`}
      >
        <div className="flex items-center gap-2 text-[11px] sm:text-[12px]">
          {isBotMessage ? (
            <Bot className="h-3 w-3 text-muted-foreground sm:h-3.5 sm:w-3.5" />
          ) : null}
          <span
            className={`font-semibold ${isBotMessage ? 'text-ucass-active' : isMine ? 'text-ucass-active' : 'text-foreground'}`}
          >
            {senderDisplayName}
          </span>
          <span className="text-muted-foreground">{formattedTime}</span>
        </div>

        <div
          className={`w-fit px-3 py-2.5 sm:px-4 sm:py-3 break-words ${
            isMine
              ? 'rounded-t-xl rounded-bl-xl rounded-br-[0px] border border-ucass-active bg-ucass-active text-white'
              : isBotMessage
                ? 'rounded-t-xl rounded-bl-xl rounded-br-[0px] border border-border bg-muted text-foreground'
                : 'rounded-t-xl rounded-bl-[0px] rounded-br-xl border border-border bg-white text-foreground'
          }`}
        >
          <div
            className={`text-[13px] font-medium leading-5 sm:text-[14px] sm:leading-[22px] break-words ${isMine ? 'text-white' : 'text-foreground'}`}
          >
            <div className="w-full">
              <div className="relative">
                <div
                  ref={messageContentRef}
                  className={`${!isMessageExpanded && isMessageOverflowing ? 'overflow-hidden' : ''}`}
                  style={
                    !isMessageExpanded && isMessageOverflowing
                      ? { maxHeight: `${collapsedMessageHeight}px` }
                      : undefined
                  }
                >
                  <div className="space-y-2">
                    {messageSegments.map((segment, index) =>
                      segment.type === 'list' ? (
                        <ul className="list-disc pl-5 space-y-1" key={`segment-list-${index}`}>
                          {segment.items.map((item, itemIndex) => (
                            <li key={`segment-list-item-${index}-${itemIndex}`}>
                              {renderFormattedContent(item)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p
                          className="whitespace-pre-line break-words"
                          key={`segment-text-${index}`}
                        >
                          {renderFormattedContent(segment.content)}
                        </p>
                      ),
                    )}
                  </div>
                </div>
                {!isMessageExpanded && isMessageOverflowing ? (
                  <div
                    className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t ${isMine ? 'from-ucass-active to-transparent' : isBotMessage ? 'from-muted to-transparent' : 'from-white to-transparent'}`}
                  />
                ) : null}
              </div>

              {isMessageOverflowing ? (
                <div className="mt-1 flex justify-center">
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${isMine ? 'border-white/40 bg-white/15 text-white hover:bg-white/25' : 'border-border bg-white text-ucass-active hover:bg-muted'}`}
                    onClick={() => setIsMessageExpanded((prev) => !prev)}
                  >
                    {isMessageExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {isMessageExpanded ? 'Show less' : 'Show more'}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentChatMessageItem;
