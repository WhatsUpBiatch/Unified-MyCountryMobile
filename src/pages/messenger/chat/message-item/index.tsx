import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import moment from 'moment';
import {
  Ban,
  Bot,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  DownloadIcon,
  Eye,
  Expand,
  Forward,
  Loader2,
  PencilIcon,
  Pin,
  Play,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  Trash2,
} from 'lucide-react';
import CustomAvatar from '@/components/custom/custom-avatar';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useUser } from '@/hooks/use-user';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  extractLinksFromMessage,
  getRenderableReactionEmoji,
  getAttachmentUrl,
  getMessagePreviewText,
  getNameToShow,
  getReceiverIds,
  hasVisibleSlateContent,
  normalizeMessageNodes,
  toSlateNodes,
  pendingReactionsCache,
} from './helpers';
import { FILE_TYPES, getFileType } from '../utils';
import LinkPreview from './link-preview';
import AttachmentItem from './attachment-item';
import LightBoxPreview from './lightbox-preview';
import ItemHoveredContent from './item-hovered-content';
import ReactionUsersList from './reaction-users-list';
import MessageSeenList from './message-seen-list';
import TextEditor, { createDefaultEditorValue } from '../editor';
import PollItem from './poll-item';
import EventItem from './event-item';
import TaskItem from './task-item';
import { useUsersDirectory } from '@/hooks/use-users-directory';

const DeletedMessage = ({ isOutbound }: { isOutbound: boolean }) => {
  return (
    <div className="italic text-xs text-gray-500 px-3 py-2 rounded-md bg-white border border-gray-200 shadow-sm">
      {isOutbound ? (
        <div className="flex items-center gap-1.5">
          You deleted this message
          <Ban size={14} className="text-gray-400" />
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Ban size={14} className="text-gray-400" />
          This message was deleted
        </div>
      )}
    </div>
  );
};

const SOFT_BREAK_CHUNK_SIZE = 24;

const formatCallMetadataDuration = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';

  const durationInSeconds = Number(value);
  if (!Number.isFinite(durationInSeconds) || durationInSeconds < 0) return '';

  const totalSeconds = Math.floor(durationInSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
};

const insertSoftBreaksIntoLongWords = (text: string, chunkSize = SOFT_BREAK_CHUNK_SIZE) => {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\S+/g, (token) => {
    if (token.length <= chunkSize) return token;
    let broken = '';
    for (let index = 0; index < token.length; index += chunkSize) {
      broken += token.slice(index, index + chunkSize);
      if (index + chunkSize < token.length) broken += '\u200B';
    }
    return broken;
  });
};

const addSoftBreaksToSlateNodes = (nodes: any): any => {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map((node: any) => {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.text === 'string') {
      return {
        ...node,
        text: insertSoftBreaksIntoLongWords(node.text),
      };
    }
    if (Array.isArray(node.children)) {
      return {
        ...node,
        children: addSoftBreaksToSlateNodes(node.children),
      };
    }
    return node;
  });
};

const MessageItem = ({
  msgObj,
  currentChat,
  isFirstInGroup = true,
  fromMeetChat = false,
  fromThread = false,
  isPinnedView = false,
  isFilesView = false,
  onMessageAction,
  isAgentChat = false,
  disableHoverActions = false,
}: {
  msgObj: any;
  currentChat: any;
  isFirstInGroup?: boolean;
  fromMeetChat?: boolean;
  fromThread?: boolean;
  isPinnedView?: boolean;
  isFilesView?: boolean;
  onMessageAction?: (
    action: 'reply' | 'reply_thread' | 'edit' | 'delete' | 'forward' | 'select' | 'create_task',
    messageObj: any,
  ) => void;
  isAgentChat?: boolean;
  disableHoverActions?: boolean;
}) => {
  const safeIsFirstInGroup = (() => {
    try {
      return Boolean(isFirstInGroup);
    } catch (error) {
      console.error('MessageItem: Error validating isFirstInGroup:', error);
      return true;
    }
  })();

  const { user } = useUser();
  const { getUserProfileByUuid } = useUsersDirectory();
  const actorUuid = user?.uuid || user?.guest_info?.uuid || '';
  const userId = actorUuid;
  const { handleSendReaction, threadsManager = [], handleUpdateMessage } = useSocketEvents();
  const hoverTimeoutRef = useRef<any | null>(null);
  const emojiHoverTimeoutRef = useRef<any | null>(null);

  const [isHovered, setIsHovered] = useState(false);
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);
  const [emojiPosition, setEmojiPosition] = useState<{ top: number; left: number } | null>(null);

  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isGifDownloading, setIsGifDownloading] = useState(false);
  const [isMessageExpanded, setIsMessageExpanded] = useState(false);
  const [isMessageOverflowing, setIsMessageOverflowing] = useState(false);
  const messageContentRef = useRef<HTMLDivElement | null>(null);

  const senderId = msgObj?.senderId || '';
  const messageId = msgObj?.messageId || '';
  const collapsedMessageHeight = isAgentChat ? 110 : 100;
  const messageText = getMessagePreviewText(msgObj?.message || '');
  const messageNodes = useMemo(() => normalizeMessageNodes(msgObj?.message), [msgObj?.message]);
  const renderableMessageNodes = useMemo(() => {
    if (Array.isArray(messageNodes) && messageNodes.length > 0) return messageNodes;
    if (messageText) return toSlateNodes(messageText);
    return createDefaultEditorValue();
  }, [messageNodes, messageText]);
  const displayMessageNodes = useMemo(
    () => addSoftBreaksToSlateNodes(renderableMessageNodes),
    [renderableMessageNodes],
  );
  const hasMessageContent = useMemo(
    () => hasVisibleSlateContent(renderableMessageNodes),
    [renderableMessageNodes],
  );
  const messageLinks = useMemo(
    () => extractLinksFromMessage(msgObj?.message || []),
    [msgObj?.message],
  );
  const attachments = Array.isArray(msgObj?.attachments) ? msgObj.attachments : [];
  const groupAttachments =
    Array.isArray(msgObj?.groupAttachments) && msgObj.groupAttachments.length > 0
      ? msgObj.groupAttachments
      : attachments;

  const isBotMessage = senderId === 'AI-Bot';
  // AI-Bot messages are rendered on the right side (like outbound messages)
  const isMine = isBotMessage || senderId === actorUuid;
  const messageDirection = isMine ? 'justify-end' : 'justify-start';
  const companyUuid = useMemo(() => {
    const fallbackChatUser = (Array.isArray(currentChat?.users) ? currentChat.users : []).find(
      (chatUser: any) => chatUser?.company_info?.uuid || chatUser?.company_uuid,
    );
    return (
      user?.company_info?.uuid ||
      user?.company_uuid ||
      fallbackChatUser?.company_info?.uuid ||
      fallbackChatUser?.company_uuid ||
      attachments?.[0]?.company_uuid ||
      ''
    );
  }, [attachments, currentChat?.users, user?.company_info?.uuid, user?.company_uuid]);

  const otherUserData = useMemo(() => {
    try {
      if (!currentChat || !Array.isArray(currentChat?.users)) return null;
      if (!senderId) return null;
      return currentChat.users.find((u: any) => u?.uuid === senderId) || null;
    } catch (error) {
      console.error('MessageItem: Error finding sender data:', error);
      return null;
    }
  }, [currentChat?.users, senderId]);

  const replierUserData = useMemo(() => {
    try {
      if (!currentChat || !Array.isArray(currentChat?.users)) return null;
      return currentChat.users.find((u: any) => u?.uuid === msgObj?.replyOf?.senderId) || null;
    } catch (error) {
      console.error('MessageItem: Error finding replier data:', error);
      return null;
    }
  }, [currentChat?.users, msgObj?.replyOf?.senderId]);
  const pinnedByName = useMemo(() => {
    if (!msgObj?.isPinned) return '';
    if (msgObj.isPinned === actorUuid) return 'You';
    const pinner = (currentChat?.users || []).find((u: any) => u?.uuid === msgObj.isPinned);
    return pinner?.name || pinner?.first_name || 'System';
  }, [actorUuid, msgObj?.isPinned, currentChat?.users]);

  const handleDeleteIndividualAttachment = (attachmentToDelete: any) => {
    const updatedAttachments = attachments.filter(
      (item: any) => item?.serverFileName !== attachmentToDelete?.serverFileName,
    );
    handleUpdateMessage({
      messageId: msgObj.messageId || msgObj._id,
      currentChat,
      message: msgObj.message,
      attachments: updatedAttachments,
      groupAttachments: updatedAttachments,
    });
  };

  const activeThread = Array.isArray(threadsManager)
    ? threadsManager.find((thread: any) => thread?.parentMsgId === messageId)
    : undefined;

  const currentMessageThreads = activeThread
    ? activeThread.messages?.filter((msg: any) => !msg?.isDeleted) || []
    : null;

  const displayReplyCount =
    currentMessageThreads !== null ? currentMessageThreads.length : msgObj?.threadReplyCount || 0;

  const lightboxSlides = useMemo(() => {
    const sourceAttachments = Array.isArray(groupAttachments) ? groupAttachments : [];
    if (!sourceAttachments.length) return [];

    return sourceAttachments
      .map((item: any) => {
        const fileName = item?.fileName || 'Attachment';
        const fileType = getFileType(fileName);
        const base = {
          alt: fileName,
          senderName: isMine ? 'You' : otherUserData?.name || 'Unknown User',
          senderAvatar: isMine ? user?.profile : otherUserData?.profile,
          sentTime: msgObj?.createdAt,
          id: item?.serverFileName || fileName,
          serverFileName: item?.serverFileName || '',
          company_uuid: companyUuid,
        };

        if (fileType === FILE_TYPES.VIDEO) {
          return {
            ...base,
            type: 'video',
            src: getAttachmentUrl(companyUuid, item?.serverFileName || ''),
          };
        }
        if (fileType === FILE_TYPES.IMAGE) {
          return {
            ...base,
            type: 'image',
            src: getAttachmentUrl(companyUuid, item?.serverFileName || ''),
          };
        }

        return null;
      })
      .filter(Boolean);
  }, [
    companyUuid,
    groupAttachments,
    isMine,
    msgObj?.createdAt,
    otherUserData?.name,
    otherUserData?.profile,
    user?.profile,
  ]);

  const allLightboxSlides = useMemo(() => {
    if (!msgObj?.gif?.url) return lightboxSlides;
    return [
      ...lightboxSlides,
      {
        type: 'image',
        src: msgObj.gif.url,
        alt: msgObj?.gif?.title || 'GIF',
        senderName: isMine ? 'You' : otherUserData?.name || 'Unknown User',
        senderAvatar: isMine ? user?.profile : otherUserData?.profile,
        sentTime: msgObj?.createdAt,
        id: `gif-${messageId || msgObj?._id || 'item'}`,
      },
    ];
  }, [
    isMine,
    lightboxSlides,
    messageId,
    msgObj?._id,
    msgObj?.createdAt,
    msgObj?.gif?.title,
    msgObj?.gif?.url,
    otherUserData?.name,
    otherUserData?.profile,
    user?.profile,
  ]);

  const seenByCondition = useMemo(() => senderId === actorUuid, [senderId, actorUuid]);
  const showSeenIcon = useMemo(
    () => Boolean(seenByCondition && isHovered),
    [isHovered, seenByCondition],
  );

  useEffect(() => {
    setIsMessageExpanded(false);
  }, [msgObj?.messageId, msgObj?.message, msgObj?.updatedAt]);

  useEffect(() => {
    const targetMessageId = msgObj?.messageId || '';
    if (!targetMessageId || !actorUuid) return;
    const serverReactions = msgObj?.reactions?.[actorUuid] || [];
    const cached = pendingReactionsCache[targetMessageId]?.[actorUuid];
    if (cached) {
      const isSync =
        serverReactions.length === cached.length &&
        serverReactions.every((e: string) => cached.includes(e));
      if (isSync) {
        delete pendingReactionsCache[targetMessageId];
      }
    }
  }, [msgObj?.reactions, msgObj?.messageId, actorUuid]);

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
        console.error('MessageItem: Failed to measure message overflow', error);
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
  }, [
    collapsedMessageHeight,
    isAgentChat,
    isMine,
    isBotMessage,
    hasMessageContent,
    renderableMessageNodes,
  ]);

  const handlePreview = (serverFileNameOrIndex: string | number) => {
    const index =
      typeof serverFileNameOrIndex === 'number'
        ? serverFileNameOrIndex
        : lightboxSlides.findIndex(
            (slide: any) =>
              slide?.id === serverFileNameOrIndex ||
              slide?.serverFileName === serverFileNameOrIndex,
          );
    if (index < 0) return;
    setLightboxIndex(index);
    setIsLightboxOpen(true);
  };

  const handleGifDownload = async () => {
    const gifUrl = msgObj?.gif?.url;
    if (!gifUrl || isGifDownloading) return;
    setIsGifDownloading(true);
    try {
      const response = await fetch(gifUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      const nameBase = (msgObj?.gif?.title || 'gif').replace(/[^\w-]+/g, '_');
      link.download = `${nameBase || 'gif'}.gif`;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(link.href);
      link.remove();
    } catch (error) {
      console.error('Failed to download GIF:', error);
    } finally {
      setIsGifDownloading(false);
    }
  };

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 400);
  };

  const handleHoverContentMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  const handleHoverContentMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 180);
  };

  const handleEmojiMouseEnter = (emoji: string, event: React.MouseEvent<HTMLDivElement>) => {
    try {
      if (emojiHoverTimeoutRef.current) clearTimeout(emojiHoverTimeoutRef.current);
      const target = event.currentTarget;
      const rect = target.getBoundingClientRect();
      const left = rect.left + rect.width / 2;
      const top = rect.top - 8;
      emojiHoverTimeoutRef.current = setTimeout(() => {
        setEmojiPosition({ top, left });
        setHoveredEmoji(emoji);
      }, 220);
    } catch (error) {
      console.error('Error in handleEmojiMouseEnter:', error);
    }
  };

  const handleEmojiMouseLeave = () => {
    if (emojiHoverTimeoutRef.current) clearTimeout(emojiHoverTimeoutRef.current);
    emojiHoverTimeoutRef.current = setTimeout(() => {
      setHoveredEmoji(null);
      setEmojiPosition(null);
    }, 150);
  };

  //   function handleEmojiClick(data: any) {
  //   const prevReactions = msgObj?.reactions || {};
  //   const myReactions = prevReactions?.[user.uuid] || [];

  //   if (myReactions?.includes(data)) {
  //     const messageId = msgObj?.messageId;
  //     const receiverId =
  //       msgObj?.chatId === user?.uuid ? [user?.uuid] : msgObj?.receiverId;
  //     const senderId = msgObj?.senderId;
  //     const chatId = currentChat?.chatId;
  //     const myReactions = (msgObj?.reactions || {})?.[user?.uuid] ?? [];
  //     const newFilters =
  //       myReactions?.filter((item: any) => item !== data) || [];
  //     if (myReactions?.length >= 0) {
  //       const payload = {
  //         messageId,
  //         receiverId,
  //         senderId,
  //         chatId,
  //         reactions: {
  //           ...msgObj?.reactions,
  //           [user.uuid]: [...newFilters],
  //         },
  //       };

  //       handleSendReaction(payload);
  //     }
  //   } else {
  //     const chatId = currentChat?.chatId;
  //     const payload = {
  //       messageId,
  //       receiverId,
  //       senderId,
  //       chatId,
  //       reactions: {
  //         ...msgObj?.reactions,
  //         [user.uuid]: [...myReactions, data],
  //       },
  //     };

  //     handleSendReaction(payload);
  //   }
  // }

  const handleEmojiClick = (emoji: string) => {
    if (!actorUuid) return;
    const targetMessageId = msgObj?.messageId || '';
    if (!targetMessageId) return;

    const myReactions = (pendingReactionsCache[targetMessageId]?.[actorUuid] ||
      msgObj?.reactions?.[actorUuid] ||
      []) as string[];
    const hasReaction = myReactions.includes(emoji);
    const nextMyReactions = hasReaction
      ? myReactions.filter((item: string) => item !== emoji)
      : [...myReactions, emoji];

    const receiverId = getReceiverIds(currentChat, user, msgObj?.receiverId);
    console.log(receiverId, 'receiverId');

    const nextReactionsObj = {
      ...(msgObj?.reactions || {}),
      [actorUuid]: nextMyReactions,
    };

    pendingReactionsCache[targetMessageId] = nextReactionsObj;

    handleSendReaction({
      messageId: targetMessageId,
      receiverId,
      // senderId: msgObj?.senderId || senderId,
      senderId: actorUuid,
      chatId: currentChat?.chatId,
      reactions: nextReactionsObj,
    });
  };

  const emojiArray = Object.values(msgObj?.reactions || {}).flat();
  const emojiCount: any =
    emojiArray.reduce((acc: any, emoji: any) => {
      acc[emoji] = (acc[emoji] || 0) + 1;
      return acc;
    }, {}) || {};

  const formattedTime = msgObj?.createdAt ? moment(msgObj.createdAt).format('hh:mm A') : null;
  const currentUserDisplayName = useMemo(() => {
    const baseName =
      `${user?.user_info?.first_name || ''} ${user?.user_info?.last_name || ''}`.trim();
    return baseName || user?.guest_info?.name || user?.name || 'You';
  }, [user?.user_info, user?.guest_info?.name, user?.name]);
  const senderDisplayName = isBotMessage
    ? 'AI Assistant'
    : isMine
      ? `${currentUserDisplayName} (You)`
      : otherUserData?.name || getNameToShow(currentChat, user) || 'Unknown User';
  const agentMessageMaxWidthClass = isAgentChat
    ? isMine && !isBotMessage
      ? 'max-w-[78%]'
      : isBotMessage
        ? 'max-w-[50%]'
        : 'max-w-[52%]'
    : 'max-w-2/3';

  if (msgObj?.messageType === 'meet') {
    return;
  }
  if (msgObj?.isDeleted) {
    if (isAgentChat) {
      return (
        <div
          id={msgObj?.messageId || msgObj?._id}
          className={`w-full flex ${isMine ? 'justify-end' : 'justify-start'} py-1`}
        >
          <div
            className={`${isMine ? 'items-end' : 'items-start'} flex max-w-[72%] flex-col gap-1`}
          >
            <div className="flex items-center gap-2 text-[12px]">
              <span className={`font-semibold ${isMine ? 'text-ucass-active' : 'text-foreground'}`}>
                {senderDisplayName}
              </span>
              <span className="text-muted-foreground">{formattedTime}</span>
            </div>
            <div className="rounded-2xl border border-border bg-white px-4 py-2 text-[14px] italic text-muted-foreground">
              {isMine ? 'You deleted this message' : 'This message was deleted'}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        id={msgObj?.messageId || msgObj?._id}
        className={cn(
          `w-full flex ${messageDirection} relative rounded-md transition-colors duration-200`,
          'hover:bg-gray-100',
        )}
      >
        <div className="flex gap-1 items-start px-2 max-w-full w-full">
          <div className="flex flex-col text-black text-xs w-full">
            <div
              className={cn(
                'flex items-center gap-1 text-gray-500 text-xs mb-1',
                isMine ? 'mr-10 justify-end' : 'ml-10',
              )}
            >
              {safeIsFirstInGroup ? (
                <>
                  {!isMine ? otherUserData?.name || 'Unknown User' : currentUserDisplayName}
                  <span className="text-[11px]">
                    {msgObj?.createdAt ? moment(msgObj.createdAt).format('hh:mm A') : ''}
                  </span>
                </>
              ) : null}
            </div>

            <div className={`flex items-start gap-1 ${isMine ? 'flex-row-reverse' : ''}`}>
              {safeIsFirstInGroup ? (
                <div className="text-xs font-medium self-start shrink-0">
                  <CustomAvatar
                    name={otherUserData?.name || getNameToShow(currentChat, user)}
                    showPresence={!currentChat?.isGroupChat}
                    extension={otherUserData?.extension || ''}
                    size="36"
                    image={
                      otherUserData?.profile || getUserProfileByUuid(otherUserData?.uuid) || ''
                    }
                  />
                </div>
              ) : (
                <div className="w-9 h-9 flex-shrink-0"></div>
              )}

              <div
                className={`flex gap-1 flex-col relative max-w-2/3 ${isMine ? 'items-end' : 'items-start'} w-full`}
              >
                <DeletedMessage isOutbound={isMine} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (msgObj?.messageType === 'prompt' || msgObj?.messageType === 'alert') {
    const isCall = msgObj?.alertContent?.mode === 'call';
    const alertContent = msgObj?.alertContent;
    const updateMessage = alertContent?.updateMessage;
    const callMetadataDuration = formatCallMetadataDuration(msgObj?.callMetaData?.duration);

    let content = messageText || 'System Message';

    if (isCall) {
      const { callStatus, createdAt, updatedAt } = alertContent || {};
      const start = moment(createdAt);
      const end = moment(updatedAt);
      const diffInMs = end.diff(start);
      const duration = moment.duration(diffInMs);
      const formattedDuration = `${String(Math.floor(duration.asMinutes())).padStart(2, '0')}:${String(duration.seconds()).padStart(2, '0')}`;

      if (callStatus === 'ended') {
        content = `Call ended • ${formattedDuration}`;
      } else if (callStatus === 'missed') {
        content = isMine ? "Missed call — the user didn't answer your call." : `You missed a call`;
      } else if (callStatus === 'reject') {
        content = isMine ? 'Call rejected' : `You rejected a call`;
      } else {
        content = `Call ${callStatus}`;
      }
    } else if (updateMessage) {
      content = updateMessage;
    }

    if (isAgentChat) {
      return (
        <div className="my-3 flex w-full justify-center px-2 text-xs sm:px-0">
          <div className="inline-flex max-w-[96%] flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-border bg-white px-3 py-1.5 text-[12px] leading-5 text-muted-foreground shadow-sm sm:max-w-[85%] sm:rounded-full sm:px-4 sm:text-[14px]">
            <CircleAlert size={14} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words text-center font-medium text-ucass-active">
              {content}
            </span>
            {callMetadataDuration ? (
              <span className="shrink-0 font-mono text-muted-foreground">
                • {callMetadataDuration}
              </span>
            ) : null}
            {formattedTime ? (
              <span className="shrink-0 text-muted-foreground">{formattedTime}</span>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className="my-1 flex w-full justify-center px-2 text-xs sm:px-0">
        <div
          className={cn(
            'inline-flex max-w-[96%] flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl  px-3 py-1.5 text-center text-[12px] leading-5 text-gray-500 transition-colors select-none sm:max-w-[85%] sm:rounded-full sm:text-[14px]',
            msgObj?.messageType === 'prompt' && msgObj?.meetLogId ? 'cursor-pointer' : '',
          )}
          onClick={() => {
            if (msgObj?.messageType === 'prompt' && msgObj?.meetLogId) {
              onMessageAction?.('reply_thread', msgObj);
            }
          }}
          title="Click to view call details"
        >
          {isCall ? (
            alertContent?.callStatus === 'missed' ? (
              <PhoneMissed size={14} className="text-red-500" />
            ) : alertContent?.callStatus === 'reject' ? (
              <PhoneOff size={14} className="text-orange-500" />
            ) : (
              <PhoneCall size={14} className="text-ucass-active" />
            )
          ) : null}
          <span className="min-w-0 break-words text-center font-medium text-ucass-active">
            {content}
          </span>
          {callMetadataDuration ? (
            <span className="shrink-0 font-mono opacity-70">• {callMetadataDuration}</span>
          ) : null}
          {formattedTime && <span className="shrink-0 opacity-60">at {formattedTime}</span>}
        </div>
      </div>
    );
  }

  if (isAgentChat) {
    return (
      <div
        id={msgObj?.messageId || msgObj?._id}
        className={cn(`w-full flex ${isMine ? 'justify-end' : 'justify-start'} py-1.5`)}
      >
        <div
          className={cn(
            'flex flex-col gap-1',
            isMine
              ? 'items-end max-w-[74%]'
              : isBotMessage
                ? 'items-end max-w-[52%]'
                : 'items-start max-w-[52%]',
          )}
        >
          <div className="flex items-center gap-2 text-[12px]">
            {isBotMessage ? <Bot className="h-3.5 w-3.5 text-muted-foreground" /> : null}
            <span
              className={cn(
                'font-semibold',
                isBotMessage
                  ? 'text-ucass-active'
                  : isMine
                    ? 'text-ucass-active'
                    : 'text-foreground',
              )}
            >
              {senderDisplayName}
            </span>
            <span className="text-muted-foreground">{formattedTime}</span>
          </div>

          <div
            className={cn(
              'w-fit max-w-full min-w-0 break-words px-4 py-3',
              isMine && !isBotMessage
                ? 'rounded-t-xl rounded-bl-xl rounded-br-xl border border-ucass-active bg-ucass-active text-white'
                : isBotMessage
                  ? 'rounded-t-xl rounded-bl-xl rounded-br-xl border border-border bg-muted text-foreground'
                  : 'rounded-t-xl rounded-bl-xl rounded-br-xl border border-border bg-white text-foreground',
            )}
          >
            {msgObj?.messageType === 'poll' && msgObj?.poll ? (
              <div className="max-w-[680px]">
                <PollItem
                  poll={msgObj.poll}
                  isMine={isMine}
                  onVote={(optionId) => {
                    if (!msgObj || !userId) return;
                    const currentPoll = msgObj.poll;
                    if (!currentPoll || !Array.isArray(currentPoll.options)) return;

                    const newOptions = currentPoll.options.map((opt: any) => {
                      let votes = Array.isArray(opt.votes) ? [...opt.votes] : [];

                      if (opt.id === optionId) {
                        if (votes.includes(userId)) {
                          votes = votes.filter((id) => id !== userId);
                        } else {
                          votes.push(userId);
                        }
                      } else if (!currentPoll.isMultipleChoice) {
                        votes = votes.filter((id) => id !== userId);
                      }
                      return { ...opt, votes };
                    });

                    handleUpdateMessage({
                      messageId: msgObj.messageId || msgObj._id,
                      currentChat,
                      message: msgObj.message,
                      messageType: 'poll',
                      poll: {
                        ...currentPoll,
                        options: newOptions,
                      },
                    });
                  }}
                />
              </div>
            ) : null}

            {msgObj?.messageType === 'event' && msgObj?.event ? (
              <div className="max-w-[680px]">
                <EventItem
                  event={msgObj.event}
                  isMine={isMine}
                  currentChat={currentChat}
                  msgObj={msgObj}
                />
              </div>
            ) : null}

            {msgObj?.messageType === 'task' && msgObj?.task ? (
              <div className="max-w-[680px]">
                <TaskItem
                  task={msgObj.task}
                  isMine={isMine}
                  currentChat={currentChat}
                  msgObj={msgObj}
                />
              </div>
            ) : null}

            {attachments.length > 0 ? (
              <div className="flex max-w-[680px] flex-col gap-2">
                <div
                  className={cn(
                    'grid gap-2 rounded-xl',
                    attachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
                  )}
                >
                  {attachments?.map((item: any, index: number) => (
                    <div
                      key={`${item?.serverFileName || index}`}
                      className="relative group max-w-64 rounded-xl border border-border bg-muted"
                    >
                      <AttachmentItem
                        item={item}
                        isMine={isMine}
                        messageTime={formattedTime || ''}
                        onPreview={(serverFileName) => handlePreview(serverFileName || index)}
                      />
                      {isMine && attachments.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteIndividualAttachment(item)}
                          className="absolute -top-2 -right-2 hidden group-hover:flex items-center justify-center h-6 w-6 rounded-full bg-white border border-gray-200 shadow-md text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer z-30"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {msgObj?.gif?.url ? (
              <div className="w-[280px] max-w-full">
                <div className="relative w-full text-left">
                  <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-md bg-gray-900 text-white">
                    <Play size={22} />
                    <div className="text-sm font-medium">Play GIF</div>
                  </div>
                  <button
                    type="button"
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-ucass-active text-white"
                    onClick={() => {
                      setLightboxIndex(lightboxSlides.length);
                      setIsLightboxOpen(true);
                    }}
                    aria-label="Open GIF in large view"
                  >
                    <Expand size={14} />
                  </button>
                </div>
              </div>
            ) : null}

            {msgObj?.replyOf ? (
              <div className="mb-2">
                <button
                  type="button"
                  className={cn(
                    'w-full rounded-md border px-2 py-1.5 text-left',
                    isMine ? 'border-white/30 bg-white/20' : 'border-gray-200 bg-muted',
                  )}
                  onClick={() => {
                    try {
                      const targetId = msgObj?.replyOf?.messageId;
                      if (!targetId) return;
                      const elm = document.getElementById(targetId);
                      if (!elm) return;
                      elm.classList.add('bg-ucass-active-bg', 'rounded-md');
                      elm.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' });
                      setTimeout(() => {
                        elm.classList.remove('bg-ucass-active-bg', 'rounded-md');
                      }, 1000);
                    } catch (error) {
                      console.error(error);
                    }
                  }}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      className={cn(
                        'block min-w-0 max-w-full text-xs break-words',
                        isMine ? 'text-white' : 'text-gray-700',
                      )}
                    >
                      {insertSoftBreaksIntoLongWords(getMessagePreviewText(msgObj?.replyOf)) ||
                        'Replied message'}
                    </span>
                  </div>
                </button>
              </div>
            ) : null}

            {hasMessageContent && !['poll', 'event', 'task'].includes(msgObj?.messageType) ? (
              <div className="w-full">
                <div className="relative">
                  <div
                    ref={messageContentRef}
                    className={cn(
                      !isMessageExpanded && isMessageOverflowing ? 'overflow-hidden' : '',
                    )}
                    style={
                      !isMessageExpanded && isMessageOverflowing
                        ? { maxHeight: `${collapsedMessageHeight}px` }
                        : undefined
                    }
                  >
                    <TextEditor
                      readOnly
                      initialValue={displayMessageNodes}
                      className={
                        isMine && !isBotMessage
                          ? 'text-[14px] font-medium break-words [&_*]:break-words [&_*]:text-white [&_a]:text-white [&_code]:bg-white/20 [&_code]:text-white [&_p]:m-0 [&_p]:leading-[22px]'
                          : 'text-[14px] font-medium text-foreground break-words [&_*]:break-words [&_a]:text-foreground [&_code]:bg-black/10 [&_code]:text-foreground [&_p]:m-0 [&_p]:leading-[22px]'
                      }
                    />
                  </div>
                  {!isMessageExpanded && isMessageOverflowing ? (
                    <div
                      className={cn(
                        'pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t',
                        isMine && !isBotMessage
                          ? 'from-primary to-transparent'
                          : isBotMessage
                            ? 'from-muted to-transparent'
                            : 'from-white to-transparent',
                      )}
                    />
                  ) : null}
                </div>

                {isMessageOverflowing ? (
                  <div className="mt-1 flex justify-center">
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer',
                        isMine && !isBotMessage
                          ? 'border-white/40 bg-white/15 text-white hover:bg-white/25'
                          : 'border-border bg-white text-ucass-active hover:bg-muted',
                      )}
                      onClick={() => setIsMessageExpanded((prev) => !prev)}
                    >
                      {isMessageExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {isMessageExpanded ? 'Show less' : 'Show more'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {messageLinks && messageLinks.length > 0 ? (
              <div className="mt-2 flex flex-col gap-2">
                {messageLinks.map((link, index) => (
                  <LinkPreview key={`${link}-${index}`} url={link} />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {isLightboxOpen ? (
          <LightBoxPreview
            open={isLightboxOpen}
            onClose={() => setIsLightboxOpen(false)}
            slides={allLightboxSlides}
            index={lightboxIndex}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      id={msgObj?.messageId || msgObj?._id}
      className={cn(
        `w-full flex ${messageDirection} relative rounded-md transition-all duration-200 pt-1`,
        msgObj?.isPinned ? 'bg-amber-50/50 border border-amber-200/50 py-2 my-2' : '',
        isAgentChat ? '' : 'hover:bg-gray-100',
      )}
    >
      <div className="flex gap-1 items-start px-2 max-w-full w-full">
        <div className="flex flex-col text-black text-xs w-full">
          <div
            className={cn(
              'flex items-center gap-1 text-gray-500 text-xs mb-1',
              isAgentChat
                ? isMine
                  ? 'justify-end'
                  : 'justify-start'
                : isMine
                  ? 'mr-10 justify-end'
                  : 'ml-10',
            )}
          >
            {safeIsFirstInGroup || isAgentChat ? (
              <>
                {isAgentChat ? (
                  <>
                    {isBotMessage ? <Bot className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    <span
                      className={cn(
                        'text-[14px] font-semibold',
                        isBotMessage
                          ? 'text-ucass-active'
                          : isMine
                            ? 'text-ucass-active'
                            : 'text-foreground',
                      )}
                    >
                      {senderDisplayName}
                    </span>
                  </>
                ) : (
                  <>
                    {/* Show 'BOT' label on right side for AI-Bot; show sender name on left for others */}
                    {isBotMessage ? 'BOT' : !isMine ? otherUserData?.name || 'Unknown User' : null}
                  </>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {isMine ? (
                    <span className={'text-gray-500 text-xs ml-1'}>{currentUserDisplayName}</span>
                  ) : null}{' '}
                  {msgObj?.createdAt ? moment(msgObj.createdAt).format('hh:mm A') : ''}
                </span>
              </>
            ) : null}
          </div>

          <div className={`flex items-start gap-1 ${isMine ? 'flex-row-reverse' : ''}`}>
            {safeIsFirstInGroup && !isAgentChat ? (
              <div className="text-xs font-medium self-start shrink-0">
                <CustomAvatar
                  name={
                    isBotMessage ? 'BOT' : otherUserData?.name || getNameToShow(currentChat, user)
                  }
                  showPresence={!isBotMessage && !currentChat?.isGroupChat}
                  extension={isBotMessage ? '' : otherUserData?.extension || ''}
                  size="36"
                  image={
                    isBotMessage
                      ? ''
                      : otherUserData?.profile || getUserProfileByUuid(otherUserData?.uuid) || ''
                  }
                />
              </div>
            ) : !isAgentChat ? (
              <div className="w-9 h-9 flex-shrink-0"></div>
            ) : null}

            <div
              className={`flex gap-1 flex-col relative ${agentMessageMaxWidthClass} ${isMine ? 'items-end' : 'items-start'} w-full min-w-0 ${isAgentChat ? 'my-1.5' : ''}`}
            >
              {msgObj?.isPinned ? (
                <div
                  className={cn(
                    'flex items-center gap-1.5 mb-1 px-1 text-ucass-active font-semibold text-[11px] uppercase tracking-wider',
                    isMine ? 'justify-end' : 'justify-start',
                  )}
                >
                  <Pin size={12} className="fill-ucass-active text-ucass-active" />
                  <span>Pinned by {pinnedByName}</span>
                </div>
              ) : null}
              <div
                className={`flex ${isMine ? '' : 'flex-row-reverse '} items-start gap-1 relative max-w-full min-w-0`}
              >
                <div
                  className={`flex gap-2 items-start min-w-5 mt-1 ${isAgentChat ? 'hidden' : ''}`}
                >
                  {msgObj?.isEdited &&
                  !showSeenIcon &&
                  !['poll', 'event', 'task'].includes(msgObj?.messageType) ? (
                    <PencilIcon width={14} height={14} className="text-gray-400" />
                  ) : null}
                  {msgObj?.isForwarded && !showSeenIcon ? (
                    <Forward width={14} height={14} className="text-gray-400" />
                  ) : null}
                </div>

                <div
                  className={cn(
                    'flex relative flex-col rounded-md w-fit min-w-0 max-w-[85vw] shadow-sm break-words',
                    isAgentChat
                      ? isMine && !isBotMessage
                        ? 'rounded-2xl border border-ucass-active bg-ucass-active px-3 py-2 text-white shadow-sm'
                        : isBotMessage
                          ? 'rounded-2xl border border-border bg-muted px-3 py-2 text-foreground shadow-sm'
                          : 'rounded-2xl border border-border bg-white px-3 py-2 text-foreground shadow-sm'
                      : isMine
                        ? 'bg-ucass-primary-200 text-black '
                        : 'bg-white text-black',
                  )}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                  onMouseMove={handleMouseEnter}
                >
                  {msgObj?.messageType === 'poll' && msgObj?.poll ? (
                    <div className="p-2">
                      <PollItem
                        poll={msgObj.poll}
                        isMine={isMine}
                        onVote={(optionId) => {
                          if (!msgObj || !userId) return;
                          const currentPoll = msgObj.poll;
                          if (!currentPoll || !Array.isArray(currentPoll.options)) return;

                          const newOptions = currentPoll.options.map((opt: any) => {
                            let votes = Array.isArray(opt.votes) ? [...opt.votes] : [];

                            if (opt.id === optionId) {
                              // Toggle vote
                              if (votes.includes(userId)) {
                                votes = votes.filter((id) => id !== userId);
                              } else {
                                votes.push(userId);
                              }
                            } else if (!currentPoll.isMultipleChoice) {
                              // For single choice, remove user from all other options
                              votes = votes.filter((id) => id !== userId);
                            }
                            return { ...opt, votes };
                          });

                          handleUpdateMessage({
                            messageId: msgObj.messageId || msgObj._id,
                            currentChat,
                            message: msgObj.message,
                            messageType: 'poll',
                            poll: {
                              ...currentPoll,
                              options: newOptions,
                            },
                          });
                        }}
                      />
                    </div>
                  ) : null}

                  {msgObj?.messageType === 'event' && msgObj?.event ? (
                    <div className="p-2">
                      <EventItem
                        event={msgObj.event}
                        isMine={isMine}
                        currentChat={currentChat}
                        msgObj={msgObj}
                      />
                    </div>
                  ) : null}

                  {msgObj?.messageType === 'task' && msgObj?.task ? (
                    <div className="p-2">
                      <TaskItem
                        task={msgObj.task}
                        isMine={isMine}
                        currentChat={currentChat}
                        msgObj={msgObj}
                      />
                    </div>
                  ) : null}

                  {showSeenIcon && !isAgentChat && currentChat?.chatId && msgObj?.messageId ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'h-6 w-6 p-0 cursor-pointer rounded-full absolute top-1 text-gray-500 hover:text-ucass-active',
                            isMine ? '-left-7' : '-right-7',
                          )}
                        >
                          <Eye size={16} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="top"
                        align={isMine ? 'end' : 'start'}
                        className="p-0 w-auto border-none shadow-none bg-transparent"
                      >
                        <MessageSeenList messageId={msgObj.messageId} chatId={currentChat.chatId} />
                      </PopoverContent>
                    </Popover>
                  ) : null}

                  {attachments.length > 0 ? (
                    <div className="flex flex-col w-full gap-2 p-2">
                      <div
                        className={cn(
                          ' w-full rounded-xl grid gap-2  ',
                          isMine ? 'bg-white/10 ' : 'bg-white ',
                          fromMeetChat
                            ? 'grid-cols-1'
                            : attachments.length === 1
                              ? 'grid-cols-1'
                              : 'flex flex-wrap',
                        )}
                      >
                        {attachments?.map((item: any, index: number) => (
                          <div
                            key={`${item?.serverFileName || index}`}
                            className={`relative group border rounded-xl ${isMine ? 'bg-ucass-active-bg border-ucass-active-bg' : 'bg-white border-gray-200'} max-w-60`}
                          >
                            <AttachmentItem
                              item={item}
                              isMine={isMine}
                              messageTime={formattedTime || ''}
                              onPreview={(serverFileName) => handlePreview(serverFileName || index)}
                            />
                            {isMine && attachments.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleDeleteIndividualAttachment(item)}
                                className="absolute -top-2 -right-2 hidden group-hover:flex items-center justify-center h-6 w-6 rounded-full bg-white border border-gray-200 shadow-md text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer z-30"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {msgObj?.gif?.url ? (
                    <div className="p-2 w-[280px] max-w-full">
                      <div className="w-full text-left relative">
                        <div className="h-36 rounded-md bg-gray-900 text-white flex flex-col items-center justify-center gap-2">
                          <Play size={22} />
                          <div className="text-sm font-medium">Play GIF</div>
                          <div className="text-xs text-white/70">Use expand to open and play</div>
                        </div>
                        <button
                          type="button"
                          className="absolute cursor-pointer bg-ucass-active top-2 right-2 h-7 w-7 rounded-md text-white flex items-center justify-center"
                          onClick={() => {
                            setLightboxIndex(lightboxSlides.length);
                            setIsLightboxOpen(true);
                          }}
                          aria-label="Open GIF in large view"
                        >
                          <Expand size={14} />
                        </button>
                      </div>
                      <div className="mt-1 text-xs text-gray-500 flex items-center justify-between gap-2">
                        <span className="truncate">GIF - {msgObj?.gif?.title || 'GIF'}</span>
                        <button
                          type="button"
                          className="cursor-pointer shrink-0"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleGifDownload();
                          }}
                          title="Download GIF"
                          disabled={isGifDownloading}
                        >
                          {isGifDownloading ? (
                            <Loader2 className="animate-spin text-gray-500 size-4" />
                          ) : (
                            <DownloadIcon className="text-gray-500 size-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {msgObj?.replyOf ? (
                    <div className="p-2">
                      <button
                        type="button"
                        className={cn(
                          'w-full text-left rounded-md px-2 py-1.5 border relative ',
                          isMine
                            ? ' bg-white/70 border border-ucass-active/30'
                            : 'bg-white border-gray-200 bg-gray-100',
                        )}
                        onClick={() => {
                          try {
                            const targetId = msgObj?.replyOf?.messageId;
                            if (!targetId) return;
                            const elm = document.getElementById(targetId);
                            if (!elm) return;
                            elm.classList.add('bg-ucass-active-bg', 'rounded-md');
                            elm.scrollIntoView({
                              behavior: 'smooth',
                              inline: 'center',
                              block: 'center',
                            });
                            setTimeout(() => {
                              elm.classList.remove('bg-ucass-active-bg', 'rounded-md');
                            }, 1000);
                          } catch (error) {
                            console.error(error);
                          }
                        }}
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <div className="self-start shrink-0">
                            <CustomAvatar
                              name={replierUserData?.name || 'Unknown User'}
                              showPresence={false}
                              extension={replierUserData?.extension || ''}
                              size="26"
                              image={
                                replierUserData?.profile ||
                                getUserProfileByUuid(replierUserData?.uuid) ||
                                ''
                              }
                              textClass={'text-[11px]'}
                            />
                          </div>
                          <span
                            className={cn(
                              'block min-w-0 max-w-full text-xs break-words',
                              isMine ? 'text-black' : 'text-gray-700',
                            )}
                          >
                            {insertSoftBreaksIntoLongWords(
                              getMessagePreviewText(msgObj?.replyOf),
                            ) || 'Replied message'}
                          </span>
                        </div>
                      </button>
                    </div>
                  ) : null}

                  {hasMessageContent && !['poll', 'event', 'task'].includes(msgObj?.messageType) ? (
                    <div className={cn('px-1.5 pb-1', attachments.length ? 'pt-0' : 'pt-1')}>
                      <div className="w-full">
                        <div className="relative">
                          <div
                            ref={messageContentRef}
                            className={cn(
                              !isMessageExpanded && isMessageOverflowing ? 'overflow-hidden' : '',
                            )}
                            style={
                              !isMessageExpanded && isMessageOverflowing
                                ? { maxHeight: `${collapsedMessageHeight}px` }
                                : undefined
                            }
                          >
                            <TextEditor
                              readOnly
                              initialValue={displayMessageNodes}
                              className={
                                isAgentChat
                                  ? isMine && !isBotMessage
                                    ? 'break-words [&_*]:break-words [&_a]:text-white [&_code]:text-white [&_code]:bg-white/20 [&_*]:text-white'
                                    : 'break-words [&_*]:break-words [&_a]:text-foreground [&_code]:text-foreground [&_code]:bg-black/10'
                                  : isMine
                                    ? 'break-words [&_*]:break-words [&_a]:text-black [&_code]:text-black [&_code]:bg-black/15'
                                    : 'break-words [&_*]:break-words'
                              }
                            />
                          </div>

                          {!isMessageExpanded && isMessageOverflowing ? (
                            <div
                              className={cn(
                                'pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t',
                                isMine
                                  ? 'from-ucass-primary-200 to-transparent'
                                  : 'from-white to-transparent',
                              )}
                            />
                          ) : null}
                        </div>

                        {isMessageOverflowing ? (
                          <div className="mt-1 flex justify-center">
                            <button
                              type="button"
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer',
                                isMine
                                  ? 'border-black/20 bg-black/5 text-black hover:bg-black/10'
                                  : 'border-border bg-white text-ucass-active hover:bg-muted',
                              )}
                              onClick={() => setIsMessageExpanded((prev) => !prev)}
                            >
                              {isMessageExpanded ? (
                                <ChevronUp size={12} />
                              ) : (
                                <ChevronDown size={12} />
                              )}
                              {isMessageExpanded ? 'Show less' : 'Show more'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {messageLinks && messageLinks.length > 0 ? (
                    <div className="flex flex-col gap-2 p-2">
                      {messageLinks.map((link, index) => (
                        <LinkPreview key={`${link}-${index}`} url={link} />
                      ))}
                    </div>
                  ) : null}

                  {isHovered && !isAgentChat && !disableHoverActions ? (
                    <div
                      onMouseEnter={handleHoverContentMouseEnter}
                      onMouseLeave={handleHoverContentMouseLeave}
                      onMouseMove={handleHoverContentMouseEnter}
                    >
                      <ItemHoveredContent
                        senderId={senderId}
                        messageId={messageId}
                        currentChat={currentChat}
                        fromMeetChat={fromMeetChat}
                        msgObj={msgObj}
                        fromThread={fromThread}
                        isPinnedView={isPinnedView}
                        isFilesView={isFilesView}
                        isAgentChat={isAgentChat}
                        onReply={() => onMessageAction?.('reply', msgObj)}
                        onReplyThread={() => onMessageAction?.('reply_thread', msgObj)}
                        onEdit={() => onMessageAction?.('edit', msgObj)}
                        onDelete={() => onMessageAction?.('delete', msgObj)}
                        onForward={() => onMessageAction?.('forward', msgObj)}
                        onSelect={() => onMessageAction?.('select', msgObj)}
                        onCreateTask={() => onMessageAction?.('create_task', msgObj)}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                className={`flex items-center flex-wrap  gap-2 ${isMine ? 'justify-end' : 'justify-start'}`}
              >
                {!isAgentChat && !isPinnedView && !isFilesView && displayReplyCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!fromThread) onMessageAction?.('reply_thread', msgObj);
                    }}
                    className={cn(
                      'text-xs text-ucass-active font-medium',
                      !fromThread ? 'hover:underline cursor-pointer' : 'cursor-default',
                    )}
                    disabled={fromThread}
                  >
                    {displayReplyCount} &nbsp;Replies
                  </button>
                ) : null}

                {!isAgentChat && !isPinnedView && !isFilesView && emojiCount
                  ? Object.keys(emojiCount)?.map((item) => {
                      const yourReaction = msgObj?.reactions?.[actorUuid] || [];
                      const isEmojiYours = yourReaction?.find((_: any) => _ === item);

                      return (
                        <div
                          key={item}
                          className={`${
                            isEmojiYours ? 'border-[var(--color-border-ucass-active-bg)]' : ''
                          } min-h-6 min-w-6 max-h-6 px-1 pr-2 gap-1 text-base bg-[var(--color-bg-gray-100)] rounded-2xl shadow-2xs border border-gray-300 bg-white flex items-center justify-center cursor-pointer hover:bg-[var(--color-bg-gray-200)] transition-colors`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEmojiClick(item);
                          }}
                          onMouseEnter={(e) => handleEmojiMouseEnter(item, e)}
                          onMouseLeave={handleEmojiMouseLeave}
                        >
                          {getRenderableReactionEmoji(item)}
                          <div className="text-xs">{emojiCount[item]}</div>
                        </div>
                      );
                    })
                  : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {hoveredEmoji && emojiPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed pointer-events-auto"
              style={{
                left: isMine ? `${emojiPosition.left - 80}px` : `${emojiPosition.left}px`,
                top: `${emojiPosition.top}px`,
                transform: 'translate(-50%, -100%)',
                zIndex: 9999,
              }}
              onMouseEnter={() => {
                if (emojiHoverTimeoutRef.current) clearTimeout(emojiHoverTimeoutRef.current);
              }}
              onMouseLeave={handleEmojiMouseLeave}
            >
              <ReactionUsersList
                emoji={hoveredEmoji}
                reactions={(msgObj?.reactions || {}) as Record<string, string[]>}
                currentChatUsers={Array.isArray(currentChat?.users) ? currentChat.users : []}
                currentUserId={actorUuid}
              />
            </div>,
            document.body,
          )
        : null}

      {isLightboxOpen ? (
        <LightBoxPreview
          open={isLightboxOpen}
          onClose={() => setIsLightboxOpen(false)}
          slides={allLightboxSlides}
          index={lightboxIndex}
        />
      ) : null}
    </div>
  );
};

export default MessageItem;
