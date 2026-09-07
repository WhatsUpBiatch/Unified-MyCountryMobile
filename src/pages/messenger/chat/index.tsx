/* eslint-disable @typescript-eslint/ban-ts-comment */
//@ts-nocheck
import CustomAvatar from '@/components/custom/custom-avatar';
import GroupedAvatar from '@/components/custom/grouped-avatar';
import CustomSelect from '@/components/custom/custom-select';
import Loader from '@/components/custom/loader';
import { useCompanyFeatures } from '@/hooks/rbac';
import { ExtensionListView } from '@/pages/admin-settings/people/update-forwarding/call-rules/add-coworker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { useUser } from '@/hooks/use-user';
import { useSocketEvents } from '@/hooks/use-socket-events';
import useMediaQuery from '@/hooks/use-media-query';
import { cn, handleAlert, scrollToBottom } from '@/lib/utils';
import { normalizeMeetingCallType } from '@/lib/meeting-links';
import { chatEvents } from '@/context/socket-events';
import { getAISettingConfig, mediaUploadUrl } from '@/services/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  CheckCheck,
  FileText,
  Folder,
  Loader2,
  Mic,
  NotebookPenIcon,
  Paperclip,
  Pin,
  PhoneCall,
  Search,
  SendHorizontal,
  Smile,
  Trash2,
  UserCog,
  UserPlus,
  X,
  BarChart2,
  Calendar,
  File as FileIcon,
  Plus,
  Sparkles,
  Video,
  Play,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { Checkbox } from '@/components/ui/checkbox';
import EmojiPicker from 'emoji-picker-react';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import useDebounce from '@/hooks/use-debounce';
import { useMessengerUsers } from '../hooks/use-messenger-users';

polyfillCountryFlagEmojis();
import moment from 'moment';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { v4 as uuidV4 } from 'uuid';
import TextEditor, { defaultEditorValue } from './editor';
import MessageItem from './message-item';
import AudioRecorder from './audio-recorder';
import SearchComponent from './search-component';
import DeleteMessageItem from './delete-message-item';
import ForwardMessageModal from './message-item/forward-message-modal';
import CreatePollModal from './create-poll-modal';
import CustomTooltip from '@/components/custom/custom-tooltip';
import SideDrawer from '@/components/custom/side-drawer';
import MeetInitiateModal from '@/components/audio-video-call/components/meet-initiate-modal';
import {
  ensureCallMediaAccess,
  getCallBlockReason,
  getVideoToAudioFallback,
  useCallEligibility,
} from '@/components/audio-video-call/hooks/use-call-eligibility';
import { EyeLine } from '@/assets/icons';
import { useJitsi } from '@/hooks/use-jitsi';
import NotesList from '../content/socket-content/notes-list';
import FolderList from '../content/socket-content/folder-list';
import Thread from '../content/socket-content/thread';
import DescriptionModal from '../content/socket-content/description-modal';
import CreateEvent from './create-event-modal';
import ScheduleEventModal from '@/pages/video-meetings/Calender/Modal/ScheduleEventModal';
import { SCHEDULEMEETING } from '@/pages/video-meetings/Calender/constants';
import { useUsersDirectory } from '@/hooks/use-users-directory';
import AiAssist from '../content/ai-assist';
import AiWriting from '@/components/custom/ai-writing';
import AiConversationInsights from '@/components/custom/ai-conversation-insights';
import AiReplySuggestions from '@/components/custom/ai-reply-suggestions';
import AiInlineReplySuggestions from '@/components/custom/ai-inline-reply-suggestions';
import { AI_SETTINGS_TYPES } from '../constants';

// const MESSAGE_LIMIT = 30;
const PAGINATION_DEBOUNCE_MS = 500;

const DRAFT_SAVED_STORAGE_KEY = 'mcm_chat_drafts_saved';
const DRAFT_EDITING_STORAGE_KEY = 'mcm_chat_drafts_editing';
const DRAFTS_UPDATED_EVENT = 'mcm-chat-drafts-updated';
const chatDraftAttachmentsMemory: Record<string, any[]> = {};

const createEmptyDraftStore = () =>
  ({}) as Record<
    string,
    {
      message: any;
      attachments: any[];
      messageItemAction: MessageItemActionState;
      updatedAt: number;
    }
  >;

const hydrateDraftStore = (rawStore: any) => {
  const nextStore = createEmptyDraftStore();
  if (!rawStore || typeof rawStore !== 'object') return nextStore;
  Object.keys(rawStore).forEach((key) => {
    const entry = rawStore[key];
    if (!entry || typeof entry !== 'object') return;
    nextStore[key] = {
      message: entry?.message,
      attachments: Array.isArray(chatDraftAttachmentsMemory[key])
        ? chatDraftAttachmentsMemory[key]
        : [],
      messageItemAction: entry?.messageItemAction || { action: '', msgObj: null },
      updatedAt: Number(entry?.updatedAt) || 0,
    };
  });
  return nextStore;
};

const readDraftStoreFromSessionStorage = (storageKey: string) => {
  if (typeof window === 'undefined') return createEmptyDraftStore();
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return createEmptyDraftStore();
    return hydrateDraftStore(JSON.parse(saved));
  } catch (error) {
    console.error(`Failed to load chat drafts for key ${storageKey}:`, error);
    return createEmptyDraftStore();
  }
};

const chatSavedDrafts: Record<
  string,
  {
    message: any;
    attachments: any[];
    messageItemAction: MessageItemActionState;
    updatedAt: number;
  }
> = readDraftStoreFromSessionStorage(DRAFT_SAVED_STORAGE_KEY);

const chatEditingDrafts: Record<
  string,
  {
    message: any;
    attachments: any[];
    messageItemAction: MessageItemActionState;
    updatedAt: number;
  }
> = readDraftStoreFromSessionStorage(DRAFT_EDITING_STORAGE_KEY);

const serializeDraftStore = (draftStore: Record<string, any>) => {
  const serializableDrafts: any = {};
  Object.keys(draftStore || {}).forEach((key) => {
    serializableDrafts[key] = {
      message: draftStore[key]?.message,
      messageItemAction: draftStore[key]?.messageItemAction,
      attachments: [],
      updatedAt: draftStore[key]?.updatedAt || 0,
    };
  });
  return serializableDrafts;
};

const persistDraftStores = () => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      DRAFT_SAVED_STORAGE_KEY,
      JSON.stringify(serializeDraftStore(chatSavedDrafts)),
    );
    sessionStorage.setItem(
      DRAFT_EDITING_STORAGE_KEY,
      JSON.stringify(serializeDraftStore(chatEditingDrafts)),
    );
    window.dispatchEvent(new CustomEvent(DRAFTS_UPDATED_EVENT));
  } catch (error) {
    console.error('Failed to persist chat draft stores:', error);
  }
};

const getDraftFromStores = (draftKey: string) =>
  chatEditingDrafts[draftKey] || chatSavedDrafts[draftKey] || null;

const setEditingDraft = (draftKey: string, draftValue: any) => {
  if (!draftKey) return;
  chatEditingDrafts[draftKey] = draftValue;
  chatDraftAttachmentsMemory[draftKey] = Array.isArray(draftValue?.attachments)
    ? [...draftValue.attachments]
    : [];
  persistDraftStores();
};

const clearDraftFromStores = (draftKey: string) => {
  if (!draftKey) return;
  delete chatSavedDrafts[draftKey];
  delete chatEditingDrafts[draftKey];
  delete chatDraftAttachmentsMemory[draftKey];
  persistDraftStores();
};

const flushEditingDraftsToSaved = (draftKeys: string[] = []) => {
  const keysToFlush = draftKeys.length ? draftKeys : Object.keys(chatEditingDrafts);
  if (!keysToFlush.length) return;

  keysToFlush.forEach((draftKey) => {
    const editingDraft = chatEditingDrafts[draftKey];
    if (!editingDraft) return;
    chatSavedDrafts[draftKey] = {
      ...editingDraft,
      attachments: Array.isArray(chatDraftAttachmentsMemory[draftKey])
        ? [...chatDraftAttachmentsMemory[draftKey]]
        : [],
      updatedAt: Date.now(),
    };
    delete chatEditingDrafts[draftKey];
  });

  persistDraftStores();
};

type MessageActionType =
  'reply' | 'reply_thread' | 'edit' | 'delete' | 'forward' | 'select' | 'create_task';
type MessageItemActionState = {
  action: '' | 'reply' | 'edit' | 'delete';
  msgObj: any;
};
type FallbackChatMeta = {
  name?: string;
  description?: string;
  users?: any[];
};
type HeaderActionType = 'files' | 'pinned' | 'notes' | 'folders' | 'description' | 'delete-team';
type SidebarMode =
  | 'thread'
  | 'call-details'
  | 'files'
  | 'pinned'
  | 'members'
  | 'notes'
  | 'folders'
  | 'description'
  | null;

export type ChatMode = 'messenger' | 'agent';

export type ChatFeatureFlags = {
  canUseCallActions: boolean;
  canEndChat: boolean;
  canUseSidebarActions: boolean;
  canUseMessageHoverActions: boolean;
  canShowSeenState: boolean;
  canUseAttachmentAndRichComposer: boolean;
  canUseDragDropAndUpload: boolean;
};

export type ChatUiOverrides = {
  Header?: (props: any) => JSX.Element;
  Messages?: (props: any) => JSX.Element;
  Footer?: (props: any) => JSX.Element;
  MessageItem?: (props: any) => JSX.Element;
};

type ChatFooterAiAssistContext = {
  hasAiAssistAgent: boolean;
  aiSettings: any[];
  prefillText: string;
  chatId: string;
  lineHeight: string;
  type: string;
};

export const resolveChatFeatures = (mode: ChatMode): ChatFeatureFlags => {
  const isAgentMode = mode === 'agent';

  return {
    canUseCallActions: !isAgentMode,
    canEndChat: isAgentMode,
    canUseSidebarActions: !isAgentMode,
    canUseMessageHoverActions: !isAgentMode,
    canShowSeenState: !isAgentMode,
    canUseAttachmentAndRichComposer: !isAgentMode,
    canUseDragDropAndUpload: !isAgentMode,
  };
};

const chatScrollStateMap: Record<string, { scrollTop: number; isAtBottom: boolean }> = {};

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

const getMessagePreviewText = (value: any): string => {
  if (value === null || value === undefined) return '';

  if (typeof value === 'object' && !Array.isArray(value)) {
    if (value.messageType === 'poll' && value.poll?.question) {
      return value.poll.question;
    }
    if (value.messageType === 'event' && value.event?.name) {
      return value.event.name;
    }
    if (value.messageType === 'task' && value.task?.name) {
      return value.task.name;
    }
    if ('message' in value) {
      return getMessagePreviewText(value.message);
    }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        if (parsed.messageType === 'poll' && parsed.poll?.question) {
          return parsed.poll.question;
        }
        if (parsed.messageType === 'event' && parsed.event?.name) {
          return parsed.event.name;
        }
        if (parsed.messageType === 'task' && parsed.task?.name) {
          return parsed.task.name;
        }
        if ('message' in parsed) {
          return getMessagePreviewText(parsed.message);
        }
      }
      const fromParsed = extractMessageText(parsed);
      return fromParsed || trimmed;
    } catch {
      return trimmed;
    }
  }
  return extractMessageText(value);
};

const getMessageSearchBlob = (message: any): string => {
  try {
    const text = getMessagePreviewText(message);
    const replyText = getMessagePreviewText(message?.replyOf);
    const gifTitle = message?.gif?.title || '';
    const fileNames = (Array.isArray(message?.attachments) ? message.attachments : [])
      .map((attachment: any) => attachment?.fileName || attachment?.name || '')
      .filter(Boolean)
      .join(' ');

    return `${text} ${replyText} ${gifTitle} ${fileNames}`.toLowerCase();
  } catch (error) {
    console.error('Failed to build message search blob:', error);
    return '';
  }
};

const getNameToShow = (chat: any, user: any) => {
  if (!chat) return '';
  const isGroupChat = !!chat?.isGroupChat;
  const isOwnChat = chat?.chatId === user?.uuid;
  if (isGroupChat) return chat?.name || 'Team';
  if (isOwnChat) return `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
  const otherUser = chat?.users?.find((u: any) => u?.uuid !== user?.uuid);
  return (
    otherUser?.name ||
    `${otherUser?.first_name || ''} ${otherUser?.last_name || ''}`.trim() ||
    'Unknown'
  );
};

const getStableMessageId = (message: any) => {
  const rawId = message?._id || message?.messageId || '';
  const id = `${rawId}`.trim();
  if (!id) return '';
  // grouped fallback ids (message-<index>) should never be selectable
  if (/^message-\d+$/i.test(id)) return '';
  return id;
};

export const Messages = ({
  currentChat,
  disableScrollTop,
  searchQuery = '',
  fromThread = false,
  fromMeetChat = false,
  disableRouteMaxHeight = false,
  disableMessageHoverActions = false,
  disableInitialMessageFetch = false,
  onMessageAction,
  isAgentChat = false,
  isSelectionMode = false,
  selectedMessageIds = [],
  onToggleMessageSelection,
  MessageItemComponent = MessageItem,
}: {
  currentChat: any;
  disableScrollTop: React.MutableRefObject<boolean>;
  searchQuery?: string;
  fromThread?: boolean;
  fromMeetChat?: boolean;
  disableRouteMaxHeight?: boolean;
  disableMessageHoverActions?: boolean;
  disableInitialMessageFetch?: boolean;
  onMessageAction?: (action: MessageActionType, messageObj: any) => void;
  isAgentChat?: boolean;
  isSelectionMode?: boolean;
  selectedMessageIds?: string[];
  onToggleMessageSelection?: (message: any, checked: boolean) => void;
  MessageItemComponent?: (props: any) => JSX.Element;
}) => {
  const { user } = useUser();
  const meetingActorUuid = user?.uuid || user?.guest_info?.uuid || '';
  const {
    messageList,
    isSocketConnected,
    setMessageList,
    handleGetMessageByChatId,
    isFetchingMessages,
    hasMessagesTopNextPage,
    hasMessagesBottomNextPage,
    allChats,
  } = useSocketEvents();

  const [hasNewBottomMessage, setHasNewBottomMessage] = useState(false);
  const [showGoToLatestMessage, setShowGoToLatestMessage] = useState(false);
  const [isFetchingTopMessages, setIsFetchingTopMessages] = useState(false);
  const messageContainerRef = useRef<any>(null);
  const isScrolledToBottom = useRef(false);
  const scrollPosFromBottomRef = useRef(0);
  const fetchTopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchBottomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousScrollHeightRef = useRef(0);
  const previousFirstMessageIdRef = useRef<string | null>(null);
  const previousLastMessageIdRef = useRef<string | null>(null);

  const messages = useMemo(() => {
    const current = (Array.isArray(messageList) ? messageList : []).find(
      (m: any) => m?.chatId === currentChat?.chatId,
    );

    const list = Array.isArray(current?.messages)
      ? current.messages.filter((messageItem: any) => !messageItem?.parentMsgId)
      : [];
    const unique = list.filter(
      (messageItem: any, index: number, self: any[]) =>
        index === self.findIndex((other: any) => other?.messageId === messageItem?.messageId),
    );
    return unique.sort((a: any, b: any) => {
      const ta = new Date(a?.createdAt || 0).getTime();
      const tb = new Date(b?.createdAt || 0).getTime();
      return ta - tb;
    });
  }, [messageList, currentChat?.chatId]);
  const groupedMessages = useMemo(() => {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const result: any[] = [];
    let groupIndex = -1;

    messages.forEach((message: any, index: number) => {
      if (!message || typeof message !== 'object') return;
      if (message?.messageType === 'meet') return;

      const prevMessage = (() => {
        for (let i = index - 1; i >= 0; i--) {
          if (!messages[i]?.isDeleted) return messages[i];
        }
        return null;
      })();

      const isFirstMessage = index === 0;
      const isDifferentSender = !prevMessage || prevMessage?.senderId !== message?.senderId;
      const currentTime = moment(message?.createdAt);
      const prevTime = moment(prevMessage?.createdAt);
      const isTimeGap =
        prevMessage && currentTime.isValid() && prevTime.isValid()
          ? currentTime.diff(prevTime, 'minutes') > 1
          : true;
      const isDifferentDay =
        prevMessage && currentTime.isValid() && prevTime.isValid()
          ? !currentTime.isSame(prevTime, 'day')
          : true;
      // const isMeetMessage = message?.messageType === 'meet' || prevMessage?.messageType === 'meet';
      const isDifferentMessageType =
        (message?.messageType || '') !== (prevMessage?.messageType || '');

      const startsNewGroup =
        isFirstMessage ||
        isDifferentSender ||
        isTimeGap ||
        isDifferentDay ||
        isDifferentMessageType;

      if (startsNewGroup) {
        groupIndex += 1;
      } else if (result.length > 0) {
        result[result.length - 1].isLastInGroup = false;
      }

      result.push({
        ...message,
        isFirstInGroup: startsNewGroup,
        isLastInGroup: true,
        groupIndex,
        messageId: message?.messageId || `message-${index}`,
      });
    });

    const groupAttachmentsMap = new Map<number, any[]>();
    result.forEach((msg) => {
      const existing = groupAttachmentsMap.get(msg.groupIndex) || [];
      const currentAttachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
      groupAttachmentsMap.set(msg.groupIndex, [...existing, ...currentAttachments]);
    });

    return result.map((msg) => ({
      ...msg,
      groupAttachments: groupAttachmentsMap.get(msg.groupIndex) || [],
    }));
  }, [messages]);

  const displayMessages = useMemo(() => {
    const trimmedSearch = `${searchQuery || ''}`.trim().toLowerCase();
    return groupedMessages.filter((message: any) => {
      if (!trimmedSearch) return true;
      return getMessageSearchBlob(message).includes(trimmedSearch);
    });
  }, [groupedMessages, searchQuery]);
  const isSearchMode = `${searchQuery || ''}`.trim().length > 0;

  useEffect(() => {
    if (disableInitialMessageFetch) return;
    if (!currentChat?.chatId || !meetingActorUuid) return;
    if (
      !(Array.isArray(messageList) ? messageList : []).find(
        (v: any) => v?.chatId === currentChat?.chatId,
      )
    ) {
      handleGetMessageByChatId({
        chatId: currentChat?.chatId,
        userId: meetingActorUuid,
      });
    }
  }, [currentChat?.chatId, allChats?.length, meetingActorUuid, disableInitialMessageFetch]);

  useEffect(() => {
    return () => {
      if (fetchTopTimeoutRef.current) clearTimeout(fetchTopTimeoutRef.current);
      if (fetchBottomTimeoutRef.current) clearTimeout(fetchBottomTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (fetchTopTimeoutRef.current) clearTimeout(fetchTopTimeoutRef.current);
    if (fetchBottomTimeoutRef.current) clearTimeout(fetchBottomTimeoutRef.current);

    previousScrollHeightRef.current = 0;
    previousFirstMessageIdRef.current = null;
    previousLastMessageIdRef.current = null;
    scrollPosFromBottomRef.current = 0;
    isScrolledToBottom.current = true;
    setHasNewBottomMessage(false);
    setShowGoToLatestMessage(false);
    setIsFetchingTopMessages(false);
  }, [currentChat?.chatId]);

  useEffect(() => {
    const handleOnline = () => {
      if (!currentChat?.chatId || !isSocketConnected) return;
      setMessageList((prevMessageList: any) => {
        const prevList = Array.isArray(prevMessageList) ? prevMessageList : [];
        return prevList.map((list: any) =>
          list?.chatId === currentChat?.chatId ? { ...list, messages: [] } : list,
        );
      });

      handleGetMessageByChatId({
        chatId: currentChat?.chatId,
        userId: meetingActorUuid,
      });
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [isSocketConnected, currentChat?.chatId, meetingActorUuid]);

  useLayoutEffect(() => {
    const container = messageContainerRef.current;
    if (!container) return;

    const currentScrollHeight = container.scrollHeight;
    const currentFirstId = displayMessages?.[0]?.messageId || null;
    const currentLastId =
      displayMessages?.length > 0
        ? displayMessages?.[displayMessages.length - 1]?.messageId || null
        : null;

    if (!displayMessages?.length || isSearchMode) {
      previousScrollHeightRef.current = currentScrollHeight;
      previousFirstMessageIdRef.current = currentFirstId;
      previousLastMessageIdRef.current = currentLastId;
      return;
    }

    const isInitialLoad = previousLastMessageIdRef.current === null;
    const isPrepend = !isInitialLoad && currentFirstId !== previousFirstMessageIdRef.current;
    const isAppend =
      !isInitialLoad && currentLastId !== previousLastMessageIdRef.current && !isPrepend;

    const lastMessage = displayMessages[displayMessages.length - 1];
    const isSentByMe = lastMessage?.senderId === meetingActorUuid;

    const savedState = currentChat?.chatId ? chatScrollStateMap[currentChat.chatId] : null;

    if (isInitialLoad && savedState && !savedState.isAtBottom) {
      container.scrollTop = savedState.scrollTop;
      isScrolledToBottom.current = false;
      scrollPosFromBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight;
    } else if (isPrepend) {
      const heightDelta = currentScrollHeight - previousScrollHeightRef.current;
      if (heightDelta > 0) {
        container.scrollTop += heightDelta;
      }
    } else if (isAppend || isInitialLoad) {
      const isAtBottom = isScrolledToBottom.current || scrollPosFromBottomRef.current < 150;

      if (isInitialLoad || isSentByMe || isAtBottom) {
        const behavior = isInitialLoad ? 'instant' : 'smooth';
        scrollToBottom(messageContainerRef, behavior);
        scrollPosFromBottomRef.current = 0;
        isScrolledToBottom.current = true;
        setHasNewBottomMessage(false);
        setShowGoToLatestMessage(false);
      } else if (isAppend && !isSentByMe) {
        // User 2 sent a message and we are not at bottom
        setHasNewBottomMessage(true);
        setShowGoToLatestMessage(true);
      }
    }

    previousScrollHeightRef.current = currentScrollHeight;
    previousFirstMessageIdRef.current = currentFirstId;
    previousLastMessageIdRef.current = currentLastId;
  }, [displayMessages, isSearchMode, meetingActorUuid]);

  // const handleFetchTopNextPage = useCallback(() => {
  //   if (fetchTopTimeoutRef.current) clearTimeout(fetchTopTimeoutRef.current);

  //   fetchTopTimeoutRef.current = setTimeout(() => {
  //     fetchTopTimeoutRef.current = null;
  //     const topMsgObj = messages?.[0];
  //     if (!topMsgObj?.createdAt) return;
  //     if (!currentChat?.chatId || !user?.uuid) return;

  //     handleGetMessageByChatId({
  //       chatId: currentChat?.chatId,
  //       userId: user?.uuid,
  //       direction: 'up',
  //       cursor: topMsgObj?.createdAt,
  //     });
  //   }, PAGINATION_DEBOUNCE_MS);
  // }, [messages, currentChat?.chatId, user?.uuid, handleGetMessageByChatId]);

  // const handleFetchBottomNextPage = useCallback(() => {
  //   if (fetchBottomTimeoutRef.current) clearTimeout(fetchBottomTimeoutRef.current);

  //   fetchBottomTimeoutRef.current = setTimeout(() => {
  //     fetchBottomTimeoutRef.current = null;
  //     const bottomMsgObj = messages?.[messages?.length - 1];
  //     if (!bottomMsgObj?.createdAt) return;
  //     if (!currentChat?.chatId || !user?.uuid) return;

  //     handleGetMessageByChatId({
  //       chatId: currentChat?.chatId,
  //       userId: user?.uuid,
  //       direction: 'down',
  //       cursor: bottomMsgObj?.createdAt,
  //     });
  //   }, PAGINATION_DEBOUNCE_MS);
  // }, [messages, currentChat?.chatId, user?.uuid, handleGetMessageByChatId]);

  const handleFetchTopNextPage = useCallback(() => {
    if (fetchTopTimeoutRef.current) clearTimeout(fetchTopTimeoutRef.current);
    fetchTopTimeoutRef.current = setTimeout(() => {
      fetchTopTimeoutRef.current = null;
      const topMsgObj = messages?.[0];
      setIsFetchingTopMessages(true);
      handleGetMessageByChatId({
        chatId: currentChat?.chatId,
        userId: meetingActorUuid,
        direction: 'up',
        cursor: topMsgObj?.createdAt,
      });
    }, PAGINATION_DEBOUNCE_MS);
  }, [messages, currentChat?.chatId, meetingActorUuid, handleGetMessageByChatId]);

  const handleFetchBottomNextPage = useCallback(() => {
    if (fetchBottomTimeoutRef.current) clearTimeout(fetchBottomTimeoutRef.current);
    fetchBottomTimeoutRef.current = setTimeout(() => {
      fetchBottomTimeoutRef.current = null;
      const bottomMsgObj = messages?.[messages?.length - 1];
      handleGetMessageByChatId({
        chatId: currentChat?.chatId,
        userId: meetingActorUuid,
        direction: 'down',
        cursor: bottomMsgObj?.createdAt,
      });
    }, PAGINATION_DEBOUNCE_MS);
  }, [messages, currentChat?.chatId, meetingActorUuid, handleGetMessageByChatId]);

  const handleMessageContainerScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const container = event.currentTarget;
    const scrollFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    scrollPosFromBottomRef.current = scrollFromBottom;

    if (isSearchMode) {
      setShowGoToLatestMessage(false);
      return;
    }
    const isFetching = !!isFetchingMessages?.[currentChat?.chatId];

    // Save scroll state
    if (currentChat?.chatId) {
      chatScrollStateMap[currentChat.chatId] = {
        scrollTop: container.scrollTop,
        isAtBottom: container.scrollTop + container.clientHeight >= container.scrollHeight - 30,
      };
    }

    // Detect Top Reach
    if (
      container.scrollTop < 100 && // Trigger slightly earlier than 0
      hasMessagesTopNextPage?.[currentChat?.chatId]
    ) {
      if (!isFetching) {
        handleFetchTopNextPage();
      }
    }

    // Detect Bottom Reach
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 30) {
      isScrolledToBottom.current = true;
      setHasNewBottomMessage(false);
      setShowGoToLatestMessage(false);
      if (hasMessagesBottomNextPage?.[currentChat?.chatId]) {
        if (!isFetching) {
          handleFetchBottomNextPage();
        }
      }
    } else {
      isScrolledToBottom.current = false;
      setShowGoToLatestMessage(scrollFromBottom > 80);
    }
  };

  useEffect(() => {
    if (!isFetchingMessages?.[currentChat?.chatId]) {
      setIsFetchingTopMessages(false);
    }
  }, [isFetchingMessages, currentChat?.chatId]);

  const isStandaloneChatRoute =
    window.location.pathname.includes('/messenger') ||
    window.location.pathname.includes('/agent-chat');
  const shouldConstrainHeight = !isStandaloneChatRoute && !disableRouteMaxHeight;

  const selectedMessageIdSet = useMemo(
    () => new Set(Array.isArray(selectedMessageIds) ? selectedMessageIds : []),
    [selectedMessageIds],
  );

  return (
    <div
      key={currentChat?.chatId}
      id={currentChat?.chatId}
      ref={messageContainerRef}
      onScroll={handleMessageContainerScroll}
      onWheel={() => {
        if (disableScrollTop.current) {
          disableScrollTop.current = false;
          messageContainerRef.current.scrollTop = 150;
        }
      }}
      className={`chatInnerSec relative w-full h-full min-h-0 overflow-y-auto overflow-x-hidden flex-1 ${isAgentChat ? 'bg-ucass-gray' : 'bg-gray-100'} ${
        shouldConstrainHeight ? 'max-h-[calc(100vh-300px)]' : ''
      }`}
      style={{ overflowAnchor: 'auto' }}
    >
      {isFetchingTopMessages ? (
        <div
          className="sticky top-2 m-2 z-10 flex min-h-12 items-center justify-center gap-2 py-3 mb-2 rounded-lg bg-ucass-active-bg text-ucass-active text-sm font-medium shadow-sm"
          style={{ overflowAnchor: 'none' }}
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading older messages...</span>
        </div>
      ) : null}

      <div
        className={`w-full relative flex flex-col ${isAgentChat ? 'gap-4 px-6 py-5' : 'gap-1 p-4'}`}
        style={{ overflowAnchor: 'auto' }}
      >
        {displayMessages.map((message: any, index: number, arr: any[]) => {
          const prevVisibleMessage = (() => {
            for (let i = index - 1; i >= 0; i--) {
              if (!arr[i]?.isDeleted) return arr[i];
            }
            return null;
          })();

          const currentDate = moment(message?.createdAt);
          const prevDate = moment(prevVisibleMessage?.createdAt);
          const showDateSeparator =
            !prevVisibleMessage ||
            (currentDate.isValid() && prevDate.isValid() && !currentDate.isSame(prevDate, 'day'));

          const messageId = getStableMessageId(message);
          const messageType = `${message?.messageType || ''}`.toLowerCase();
          const nonForwardableTypes = ['prompt', 'alert', 'meet'];
          const isNormalMessage = !nonForwardableTypes.includes(messageType);
          const hasForwardableContent =
            Boolean(getMessagePreviewText(message?.message || '').trim()) ||
            Boolean(message?.gif?.url) ||
            (Array.isArray(message?.attachments) ? message.attachments.length : 0) > 0 ||
            (Array.isArray(message?.groupAttachments) ? message.groupAttachments.length : 0) > 0;
          const isSelected = selectedMessageIdSet.has(messageId);
          const canSelectMessage =
            isNormalMessage && !message?.isDeleted && !!messageId && hasForwardableContent;

          return (
            <div className="w-full flex flex-col" key={messageId || `msg-${index}`}>
              {showDateSeparator && currentDate.isValid() ? (
                <div className="flex items-center justify-center my-4 mx-auto w-[25%]">
                  <p className="bg-gray-200 rounded-full px-4 text-xs py-1">
                    {currentDate.isSame(moment(), 'day')
                      ? 'Today'
                      : currentDate.isSame(moment().subtract(1, 'day'), 'day')
                        ? 'Yesterday'
                        : currentDate.format('DD MMMM')}
                  </p>
                </div>
              ) : null}

              <div
                className={cn(
                  'w-full flex items-start gap-2 rounded-md transition-colors duration-150',
                  isSelectionMode &&
                    canSelectMessage &&
                    !isSelected &&
                    'cursor-pointer hover:bg-ucass-active-bg/60',
                  isSelectionMode &&
                    canSelectMessage &&
                    isSelected &&
                    'cursor-pointer bg-ucass-active-bg hover:bg-ucass-primary-200',
                )}
                onClick={() => {
                  if (isSelectionMode && canSelectMessage) {
                    onToggleMessageSelection?.(message, !isSelected);
                  }
                }}
              >
                {isSelectionMode && canSelectMessage ? (
                  <div className="pt-4 pl-1">
                    <input
                      type="checkbox"
                      checked={Boolean(isSelected)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        onToggleMessageSelection?.(message, event.target.checked)
                      }
                      className="cursor-pointer h-4 w-4 accent-primary"
                      aria-label="Select message for forwarding"
                    />
                  </div>
                ) : null}

                <div className={cn('flex-1 min-w-0', isSelectionMode ? 'pointer-events-none' : '')}>
                  <MessageItemComponent
                    msgObj={message}
                    currentChat={currentChat}
                    fromMeetChat={fromMeetChat}
                    isFirstInGroup={Boolean(message?.isFirstInGroup)}
                    fromThread={fromThread}
                    onMessageAction={isSelectionMode ? undefined : onMessageAction}
                    isAgentChat={isAgentChat}
                    disableHoverActions={disableMessageHoverActions}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {!displayMessages.length ? (
          <div className="w-full py-10 flex items-center justify-center text-sm text-gray-500">
            No messages found
          </div>
        ) : null}

        {(hasNewBottomMessage || showGoToLatestMessage) && (
          <div className="sticky bottom-4 left-0 w-full flex justify-end pr-2 sm:pr-4 z-20 pointer-events-none">
            <button
              type="button"
              onClick={() => {
                scrollToBottom(messageContainerRef, 'smooth');
                setHasNewBottomMessage(false);
                setShowGoToLatestMessage(false);
              }}
              className={`pointer-events-auto cursor-pointer w-10 h-10 rounded-full shadow-md flex items-center justify-center transition-all ${
                hasNewBottomMessage
                  ? 'bg-ucass-active text-white animate-bounce'
                  : 'bg-ucass-active-bg text-ucass-active hover:text-white hover:bg-ucass-active'
              }`}
              aria-label="Go to latest message"
              title="Go to latest message"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const ChatHeader = ({
  currentChat,
  showSearch = false,
  setShowSearch,
  setSearchQuery,
  activeSidebarMode,
  fromMeetChat = false,
  onOpenSidebarMode,
  disableScrollTop,
  isAgentChat = false,
  isMessageSelectionMode = false,
  selectedMessageCount = 0,
  onCancelMessageSelection,
  onForwardSelectedMessages,
  onBackToList,
  hiddenHeaderActions = [],
  disableCallActions = false,
}: {
  currentChat: any;
  showSearch: boolean;
  setShowSearch: (value: boolean) => void;
  setSearchQuery: (value: string) => void;
  activeSidebarMode: SidebarMode;
  fromMeetChat?: boolean;
  onOpenSidebarMode: (mode: Exclude<SidebarMode, 'thread' | 'call-details'> | null) => void;
  disableScrollTop: React.MutableRefObject<boolean>;
  isAgentChat?: boolean;
  isMessageSelectionMode?: boolean;
  selectedMessageCount?: number;
  onCancelMessageSelection?: () => void;
  onForwardSelectedMessages?: () => void;
  onBackToList?: () => void;
  hiddenHeaderActions?: HeaderActionType[];
  disableCallActions?: boolean;
}) => {
  console.log(isMessageSelectionMode, 'isMessageSelectionMode');

  const { user } = useUser();
  const { features } = useCompanyFeatures();
  const chatFeatures = useMemo<ChatFeatureFlags>(
    () => resolveChatFeatures(isAgentChat ? 'agent' : 'messenger'),
    [isAgentChat],
  );
  const chatAccess = features?.plan_features?.chat || {};
  const canUseCallActions =
    chatFeatures.canUseCallActions &&
    !disableCallActions &&
    Boolean(chatAccess?.access?.CHAT_VIDEO);
  const { cleanupLocalMediaTracks, devices, initializeSystemAVConfig } = useJitsi();
  const { getUserProfileByUuid } = useUsersDirectory();
  // const { features } = useCompanyFeatures();
  // const chatAccess = features?.plan_features?.chat || {};

  const {
    usersOnlineStatus = [],
    handleDeleteChat,
    handleOpenChatInWindow,
    setMessageList,
    socketEventsManager,
    meetWindows,
    meetingAcceptingChatId,
    messageList,
    // handleMeetInitiate
  } = useSocketEvents();

  /* Flattened, sender-resolved transcript for AI Conversation Insights. Built
     from the same messageList the rest of this header already reads, so it
     always reflects what's actually loaded - no separate fetch. */
  const conversationInsightMessages = useMemo(() => {
    const chatMessages = (Array.isArray(messageList) ? messageList : []).find(
      (chatItem: any) => chatItem?.chatId === currentChat?.chatId,
    )?.messages;
    return (Array.isArray(chatMessages) ? chatMessages : [])
      .filter(
        (item: any) =>
          !item?.isDeleted && item?.messageType !== 'prompt' && item?.messageType !== 'meet',
      )
      .map((item: any) => {
        const text = getMessagePreviewText(item?.message || '').trim();
        if (!text) return null;
        const senderId = item?.senderId;
        const sender =
          senderId === user?.uuid
            ? 'You'
            : (Array.isArray(currentChat?.users) ? currentChat.users : []).find(
                (chatUser: any) => chatUser?.uuid === senderId,
              )?.name || 'Someone';
        return { sender, text };
      })
      .filter(Boolean);
  }, [messageList, currentChat?.chatId, currentChat?.users, user?.uuid]);

  const handleEndChat = () => {
    if (socketEventsManager && currentChat?.chatId) {
      socketEventsManager.emit(chatEvents.END_CONVERSATION, {
        chatId: currentChat?.chatId,
      });
    }
  };

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState('');
  const [showMeetModal, setShowMeetModal] = useState(false);
  const avConfigInitializedRef = useRef(false);
  const {
    isAudioCallReady,
    isVideoCallReady,
    audioBlockReason,
    videoBlockReason,
    refresh: refreshCallEligibility,
  } = useCallEligibility({
    fallbackDevices: devices || null,
  });

  const [meetModalType, setMeetModalType] = useState('video');
  const [isInitiating, setIsInitiating] = useState(false);
  const [, setSearchParams] = useSearchParams();
  const isGroupChat = !!currentChat?.isGroupChat;
  const isOwnChat = currentChat?.chatId === user?.uuid;
  const otherUserData = (Array.isArray(currentChat?.users) ? currentChat.users : []).find(
    (chatUser: any) => chatUser?.uuid !== user?.uuid,
  );
  const nameToShow = getNameToShow(currentChat, user);
  const myExtension = user?.extension || user?.user_info?.extension;

  // const participantsGotRequest =
  //   (Array.isArray(currentChat?.users) ? currentChat.users : [])
  //     .filter((chatUser: any) => chatUser?.inviteStatus === 'PENDING')
  //     .map((chatUser: any) => chatUser?.uuid)
  //     .filter(Boolean) || [];
  // const isRequested = participantsGotRequest.includes(user?.uuid);
  const iamAdmin =
    (Array.isArray(currentChat?.admins) && currentChat.admins.includes(user?.uuid)) ||
    (Array.isArray(currentChat?.subAdmins) && currentChat.subAdmins.includes(user?.uuid));

  const isAmOnCall = Boolean(
    (Array.isArray(usersOnlineStatus) ? usersOnlineStatus : []).find(
      (status: any) => `${status?.userId}` === `${myExtension}`,
    )?.onCall,
  );
  const otherUserOnlineStatus = (Array.isArray(usersOnlineStatus) ? usersOnlineStatus : []).find(
    (status: any) => `${status?.userId}` === `${otherUserData?.extension}`,
  );

  const isOtherUserOnCall = Boolean(otherUserOnlineStatus?.onCall);
  const isUserOffline = !otherUserOnlineStatus?.online;
  const isCallGoingOnInCurrentChat = Boolean(currentChat?.meetMetadata?.onCall);
  const isMeetRingingVisibleForCurrentChat = Boolean(
    Array.isArray(meetWindows) &&
    meetWindows.length > 0 &&
    `${meetWindows?.[0]?.chatId || ''}` === `${currentChat?.chatId || ''}`,
  );
  const isMeetingAcceptInProgressForCurrentChat =
    Boolean(meetingAcceptingChatId) && `${meetingAcceptingChatId}` === `${currentChat?.chatId}`;

  const joinedParticipants = (Array.isArray(currentChat?.users) ? currentChat.users : []).filter(
    (chatUser: any) => chatUser?.callStatus === 'joined',
  );
  const isCurrentUserJoinedInCall = joinedParticipants.some(
    (chatUser: any) => chatUser?.uuid === user?.uuid,
  );

  const teamDescription = currentChat?.description || '';

  const subtitle = isAgentChat
    ? teamDescription
    : isGroupChat
      ? teamDescription ||
        (() => {
          const rawUsers = Array.isArray(currentChat?.users) ? currentChat.users : [];
          const count =
            currentChat?.groupType === 'MEETING'
              ? rawUsers.filter((u: any) => !u?.isGuest || u?.callStatus === 'joined').length
              : rawUsers.length;
          return `${count} ${count === 1 ? 'member' : 'members'}`;
        })()
      : isOwnChat
        ? 'Personal notes'
        : otherUserData?.email ||
          (isOtherUserOnCall ? 'On call' : '') ||
          ((Array.isArray(usersOnlineStatus) ? usersOnlineStatus : []).find(
            (status: any) => `${status?.userId}` === `${otherUserData?.extension}`,
          )?.online
            ? 'Online'
            : 'Offline');

  console.log(subtitle, 'subtitle');

  const prepareCallOptions = useCallback(
    async (force = false) => {
      if (!avConfigInitializedRef.current) {
        try {
          await initializeSystemAVConfig();
          avConfigInitializedRef.current = true;
        } catch (error) {
          console.log('Failed to initialize AV devices in chat header', error);
        }
      }
      return refreshCallEligibility({ force });
    },
    [initializeSystemAVConfig, refreshCallEligibility],
  );

  const deleteActionLabel = isGroupChat ? 'Delete Team' : 'Delete Chat';
  const deleteSuccessLabel = isGroupChat ? 'Team' : 'Chat';
  const deleteTargetName = (currentChat?.name || nameToShow || '').trim();
  // const canDeleteCurrentChat = isGroupChat && iamAdmin;

  // const handleMeetNow = (type: 'audio' | 'video' = 'video') => {
  //   try {
  //     console.log("Called here----------")
  //     handleMeetInitiate({
  //       chatId: currentChat?.chatId,
  //       userID: user?.uuid,
  //       callType: type,
  //     });
  //     console.log("Callededere----------")
  //     setActiveCallTab()
  //     setMeetModalType(type);
  //     setIsInitiating(true);
  //     setShowMeetModal(true);
  //   } catch (error) {
  //     console.error('Failed to initiate call:', error);
  //     handleAlert({ text: 'Unable to start call right now', type: 'error' });
  //   }
  // };
  // console.log(handleMeetNow)
  const handleJoinCall = async () => {
    try {
      const callType = normalizeMeetingCallType(currentChat?.meetMetadata?.callType) || 'video';
      const eligibilitySnapshot = await prepareCallOptions(true);
      let effectiveCallType = callType;
      const blockReason = getCallBlockReason(callType, eligibilitySnapshot);

      if (blockReason) {
        if (callType === 'video') {
          const videoFallback = getVideoToAudioFallback(eligibilitySnapshot);
          if (videoFallback.canFallback) {
            effectiveCallType = 'audio';
            handleAlert({ text: videoFallback.reason, type: 'info' });
          } else {
            handleAlert({ text: blockReason, type: 'error' });
            return;
          }
        } else {
          handleAlert({ text: blockReason, type: 'error' });
          return;
        }
      }

      const mediaAccess = await ensureCallMediaAccess(effectiveCallType);
      if (mediaAccess.fallbackCallType) {
        effectiveCallType = mediaAccess.fallbackCallType;
        handleAlert({ text: mediaAccess.reason, type: 'info' });
      }
      if (!mediaAccess.ok) {
        handleAlert({ text: mediaAccess.reason, type: 'error' });
        await refreshCallEligibility({ force: true });
        return;
      }

      setMeetModalType(effectiveCallType);
      setIsInitiating(false);
      setShowMeetModal(true);
    } catch (error) {
      console.error('Failed to join call:', error);
      handleAlert({ text: 'Unable to join call right now', type: 'error' });
    }
  };

  const resetSearch = () => {
    setShowSearch(false);
    setSearchQuery('');
  };

  const btnArr = (
    !chatFeatures.canUseSidebarActions
      ? [
          // {
          //   icon: <Pin className="w-4 h-4" />,
          //   onClick: () => onOpenSidebarMode(activeSidebarMode === 'pinned' ? null : 'pinned'),
          //   type: 'pinned',
          //   tooltip: 'Pinned Messages',
          // },
          // {
          //   icon: <EyeLine className="w-4 h-4" />,
          //   onClick: () =>
          //     onOpenSidebarMode(activeSidebarMode === 'description' ? null : 'description'),
          //   type: 'description',
          //   tooltip: 'Info',
          // },
          // canDeleteCurrentChat && {
          //   icon: <Trash2 className="w-4 h-4 text-red-500" />,
          //   onClick: () => setShowDeleteDialog(true),
          //   type: 'delete-chat',
          //   tooltip: deleteActionLabel,
          // },
        ]
      : [
          {
            icon: <FileText className="w-4 h-4" />,
            onClick: () => onOpenSidebarMode(activeSidebarMode === 'files' ? null : 'files'),
            type: 'files',
            tooltip: 'Files',
          },
          {
            icon: <Pin className="w-4 h-4" />,
            onClick: () => onOpenSidebarMode(activeSidebarMode === 'pinned' ? null : 'pinned'),
            type: 'pinned',
            tooltip: 'Pinned Messages',
          },
          {
            icon: <NotebookPenIcon className="w-4 h-4" />,
            onClick: () => onOpenSidebarMode(activeSidebarMode === 'notes' ? null : 'notes'),
            type: 'notes',
            tooltip: 'Open Notes',
          },
          {
            icon: <Folder className="w-4 h-4" />,
            onClick: () => onOpenSidebarMode(activeSidebarMode === 'folders' ? null : 'folders'),
            type: 'folders',
            tooltip: 'Open Folders',
          },
          {
            icon: <EyeLine className="w-4 h-4" />,
            onClick: () =>
              onOpenSidebarMode(activeSidebarMode === 'description' ? null : 'description'),
            type: 'description',
            tooltip: currentChat?.isGroupChat ? 'Team Info' : 'User Info',
          },
          isGroupChat &&
            iamAdmin && {
              icon: <Trash2 className="w-4 h-4 text-red-500" />,
              onClick: () => setShowDeleteDialog(true),
              type: 'delete-team',
              tooltip: 'Delete Team',
            },
        ]
  ).filter(Boolean) as any[];
  const hiddenHeaderActionSet = new Set(
    Array.isArray(hiddenHeaderActions) ? hiddenHeaderActions : [],
  );
  const filteredBtnArr = btnArr.filter(
    (buttonAction: any) => !hiddenHeaderActionSet.has(buttonAction?.type),
  );

  const handleDeleteChannel = () => {
    if (!currentChat?.chatId) return;
    setMessageList((prev: any) =>
      (Array.isArray(prev) ? prev : []).filter((item: any) => item?.chatId !== currentChat?.chatId),
    );
    handleDeleteChat(currentChat.chatId);

    handleOpenChatInWindow(currentChat.chatId, true);
    setShowDeleteDialog(false);
    setDeleteConfirmationInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('chatId', '');
      if (isAgentChat) {
        next.delete('type');
        return next;
      }
      const currentType = next.get('type') || 'all';
      if (currentType !== 'all') {
        const isGroup = !!currentChat?.isGroupChat;
        const isFav = currentChat?.favoriteChats?.includes(user?.uuid);

        if (isGroup) {
          next.set('type', 'team');
        } else if (isFav) {
          next.set('type', 'favorites');
        } else {
          next.set('type', 'direct');
        }
      }
      return next;
    });
    handleAlert({ text: `${deleteSuccessLabel} deleted successfully`, type: 'success' });
  };

  const participantMenu =
    joinedParticipants.length > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="h-8 px-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1"
            title="View participants"
          >
            <span className="text-xs font-semibold">{joinedParticipants.length}</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[230px] bg-white border border-gray-200">
          <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
            Live Participants
          </div>
          <div className="max-h-72 overflow-y-auto">
            {joinedParticipants.map((chatUser: any, index: number) => (
              <DropdownMenuItem key={chatUser?.uuid || `joined-${index}`} className="gap-2">
                <CustomAvatar
                  name={chatUser?.name || 'Unknown User'}
                  extension={chatUser?.extension || ''}
                  size="30"
                  image={chatUser?.profile || getUserProfileByUuid(chatUser?.uuid) || ''}
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">
                    {chatUser?.name || 'Unknown User'}
                  </div>
                  {chatUser?.extension ? (
                    <div className="text-[10px] text-gray-500 truncate">
                      EXT: {chatUser.extension}
                    </div>
                  ) : null}
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const handleAVCall = async (callType: 'audio' | 'video') => {
    const eligibilitySnapshot = await prepareCallOptions(true);
    const blockReason = getCallBlockReason(callType, eligibilitySnapshot);
    if (blockReason) {
      handleAlert({
        text: blockReason || `Cannot start ${callType === 'audio' ? 'voice' : 'video'} call.`,
        type: 'error',
      });
      return;
    }

    const mediaAccess = await ensureCallMediaAccess(callType);
    const effectiveCallType = mediaAccess.fallbackCallType || callType;
    if (mediaAccess.fallbackCallType) {
      handleAlert({ text: mediaAccess.reason, type: 'info' });
    }
    if (!mediaAccess.ok) {
      handleAlert({ text: mediaAccess.reason, type: 'error' });
      await refreshCallEligibility({ force: true });
      return;
    }

    try {
      await initializeSystemAVConfig();
    } catch (error) {
      console.log('Failed to initialize AV config before call start', error);
    }

    setMeetModalType(effectiveCallType);
    setIsInitiating(true);
    setShowMeetModal(true);
  };

  const renderCallAction = () => {
    if (isMeetRingingVisibleForCurrentChat) return null;
    if (isOwnChat) return null;

    if (isAmOnCall) {
      return (
        <CustomTooltip text={'You are currently on another call'} side="top">
          <button
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-200 font-medium text-sm text-gray-400 bg-gray-100 cursor-not-allowed`}
          >
            On Call
          </button>
        </CustomTooltip>
      );
    }

    if (
      isGroupChat &&
      isCallGoingOnInCurrentChat &&
      !isMeetingAcceptInProgressForCurrentChat &&
      !isMeetRingingVisibleForCurrentChat
    ) {
      return (
        <div className="flex items-center gap-1">
          <CustomTooltip text={'Join Meeting'} side="top">
            <button
              onClick={() => {
                void handleJoinCall();
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-200 font-medium text-sm text-ucass-active hover:bg-ucass-active-bg cursor-pointer`}
            >
              Join Meeting
            </button>
          </CustomTooltip>
          {participantMenu}
        </div>
      );
    }

    if (
      !isGroupChat &&
      isCallGoingOnInCurrentChat &&
      !isMeetingAcceptInProgressForCurrentChat &&
      !isMeetRingingVisibleForCurrentChat
    ) {
      if (!isCurrentUserJoinedInCall) {
        return (
          <CustomTooltip text={'Join Meeting'} side="top">
            <button
              onClick={() => {
                void handleJoinCall();
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-200 font-medium text-sm text-ucass-active hover:bg-ucass-active-bg cursor-pointer"
            >
              Join Meeting
            </button>
          </CustomTooltip>
        );
      }

      return (
        <CustomTooltip text={'User is already on this call'} side="top">
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-200 font-medium text-sm text-gray-400 bg-gray-100 cursor-not-allowed"
          >
            <PhoneCall className="w-4 h-4" />
            Call In Progress
          </button>
        </CustomTooltip>
      );
    }

    if (isMeetingAcceptInProgressForCurrentChat) {
      return (
        <CustomTooltip text={'Joining meeting...'} side="top">
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-200 font-medium text-sm text-gray-400 bg-gray-100 cursor-not-allowed"
          >
            Join Meeting
          </button>
        </CustomTooltip>
      );
    }

    const isPresenceBlocked =
      (isOtherUserOnCall && !isGroupChat) || (isUserOffline && !isGroupChat);
    if (isPresenceBlocked) {
      return (
        <CustomTooltip
          text={
            isUserOffline && !isGroupChat
              ? 'User is unavailable'
              : 'User is currently on another call'
          }
          side="top"
        >
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-200 font-medium text-sm text-gray-400 bg-gray-100 cursor-not-allowed"
          >
            <PhoneCall className="w-4 h-4" />
            {isUserOffline && !isGroupChat ? 'User Unavailable' : 'Start Call'}
          </button>
        </CustomTooltip>
      );
    }

    return (
      <div
        className="relative group z-10 inline-block"
        onMouseEnter={() => void prepareCallOptions()}
      >
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors duration-200 font-medium text-xs text-ucass-active hover:bg-ucass-active-bg cursor-pointer whitespace-nowrap"
        >
          <PhoneCall className="w-4 h-4" />
          Start Call
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        <div className="absolute right-0 top-full pt-1 opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-150 origin-top-right z-50">
          <div className="min-w-[220px] bg-white border border-gray-200 rounded-lg p-1 shadow-md">
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-100 select-none">
              Select Call Type
            </div>
            <CustomTooltip text={audioBlockReason || 'Start voice call'} side="right">
              <span className="block">
                <button
                  type="button"
                  disabled={!isAudioCallReady}
                  onClick={() => {
                    if (!isAudioCallReady) return;
                    void handleAVCall('audio');
                  }}
                  className="w-full flex items-center gap-2 mt-1 px-2 py-2 text-xs text-left rounded-md hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-50 cursor-pointer text-gray-700 transition-colors"
                >
                  <PhoneCall className="w-4 h-4 text-gray-500 shrink-0" />
                  Voice Call
                </button>
              </span>
            </CustomTooltip>
            <CustomTooltip text={videoBlockReason || 'Start video call'} side="right">
              <span className="block">
                <button
                  type="button"
                  disabled={!isVideoCallReady}
                  onClick={() => {
                    if (!isVideoCallReady) return;
                    void handleAVCall('video');
                  }}
                  className="w-full flex items-center gap-2 px-2 py-2 text-xs text-left rounded-md hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-50 cursor-pointer text-gray-700 transition-colors"
                >
                  <Video className="w-4 h-4 text-gray-500 shrink-0" />
                  Video Call
                </button>
              </span>
            </CustomTooltip>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {showMeetModal && (
        <MeetInitiateModal
          currentChat={currentChat}
          callType={meetModalType}
          isInitiator={isInitiating}
          skipJoinOptions
          onClose={() => {
            cleanupLocalMediaTracks();
            setShowMeetModal(false);
          }}
        />
      )}
      <div className="w-full min-h-16 shrink-0 border-b border-gray-200 px-3 sm:px-4 flex items-center justify-between bg-white gap-2 sm:gap-3">
        <div className="flex items-center gap-3 min-w-0 ">
          {onBackToList ? (
            <button
              type="button"
              className="xl:hidden w-9 h-9 rounded-full flex items-center justify-center bg-gray-100 text-gray-700 hover:bg-gray-200 shrink-0 z-1"
              onClick={onBackToList}
              aria-label="Back to conversations"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
            </button>
          ) : null}
          {showSearch ? (
            <div className="w-full flex items-center gap-2">
              <SearchComponent currentChat={currentChat} disableScrollTop={disableScrollTop} />
              <button
                type="button"
                className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-gray-100 text-gray-600 shrink-0"
                onClick={resetSearch}
                aria-label="Close search"
              >
                <X width={16} height={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 min-w-0">
              <CustomAvatar
                name={nameToShow}
                size="38"
                showPresence={!isGroupChat && !isOwnChat}
                extension={!isGroupChat ? otherUserData?.extension : ''}
                image={
                  isGroupChat
                    ? currentChat?.avatar
                    : getUserProfileByUuid(otherUserData?.uuid) || ''
                }
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate text-gray-900 block sm:max-w-30 md:max-w-35 xl:max-w-60  xxl:max-w-120">
                  {nameToShow}
                </div>
                {subtitle ? (
                  <div className="text-xs text-gray-500 truncate block sm:max-w-40 md:max-w-42 xl:max-w-100 xxl:max-w-200">
                    {subtitle}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {!showSearch && !fromMeetChat ? (
          <div className="flex min-w-0 flex-1 justify-end">
            <div className="flex min-w-0 max-w-[52vw] sm:max-w-[62vw] xl:max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden md:overflow-visible sm:gap-2 scrollbar-hide">
              {isMessageSelectionMode ? (
                <>
                  <div className="text-xs font-semibold text-gray-700 px-2">
                    {selectedMessageCount} selected
                  </div>
                  <Button
                    type="button"
                    onClick={onForwardSelectedMessages}
                    disabled={!selectedMessageCount}
                    className="h-9 px-3 shrink-0"
                  >
                    <CheckCheck className="w-4 h-4 mr-1" />
                    Forward
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onCancelMessageSelection}
                    className="h-9 px-3 shrink-0"
                  >
                    Cancel
                  </Button>
                </>
              ) : null}

              {!isMessageSelectionMode && !fromMeetChat && canUseCallActions
                ? renderCallAction()
                : null}

              {!isMessageSelectionMode &&
              !activeSidebarMode &&
              chatFeatures.canEndChat &&
              !currentChat?.isEnded ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 px-4 shrink-0 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 font-medium whitespace-nowrap"
                  onClick={handleEndChat}
                >
                  End Chat
                </Button>
              ) : null}

              {!isMessageSelectionMode && isGroupChat && (
                <GroupedAvatar
                  userArray={currentChat?.users || []}
                  visibleAvatar={2}
                  onOtherClick={() => onOpenSidebarMode('members')}
                />
              )}

              {!isMessageSelectionMode && !fromMeetChat ? (
                <CustomTooltip text="Summarize & ask AI" side="top">
                  <AiConversationInsights
                    messages={conversationInsightMessages}
                    disabled={!conversationInsightMessages.length}
                    className="w-9 h-9 rounded-full bg-gray-100 hover:bg-ucass-active hover:text-white"
                  />
                </CustomTooltip>
              ) : null}

              {!isMessageSelectionMode ? (
                <CustomTooltip text="Search" side="top">
                  <button
                    type="button"
                    className={`cursor-pointer shrink-0 flex items-center justify-center rounded-full w-9 h-9 bg-gray-100 text-gray-900/80 hover:bg-ucass-active hover:text-white transition-colors duration-200
                   `}
                    onClick={() => setShowSearch(true)}
                    aria-label="Search"
                  >
                    <Search width={16} height={16} />
                  </button>
                </CustomTooltip>
              ) : null}

              {!isMessageSelectionMode &&
                filteredBtnArr.map(({ icon, onClick, tooltip, type }, idx) => (
                  <CustomTooltip text={tooltip} side="top" key={idx}>
                    <button
                      key={idx}
                      type="button"
                      onClick={onClick}
                      className={`cursor-pointer shrink-0 flex items-center justify-center rounded-full w-9 h-9 bg-gray-100 text-gray-900/80 hover:bg-ucass-active hover:text-white transition-colors duration-200
                    ${activeSidebarMode === type ? 'text-ucass-active bg-ucass-active-bg' : ''}`}
                      aria-label={tooltip}
                    >
                      {icon}
                    </button>
                  </CustomTooltip>
                ))}
            </div>
          </div>
        ) : null}
      </div>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open);
          if (!open) setDeleteConfirmationInput('');
        }}
      >
        <DialogContent className="bg-white max-w-[540px]">
          <div className="flex flex-col items-center text-center space-y-3 pt-2">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-600" />
            </div>
            <DialogTitle className="text-xl font-bold text-gray-900">
              {deleteActionLabel}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600 max-w-sm mx-auto">
              This will permanently delete{' '}
              <span className="font-semibold text-gray-900">{deleteTargetName || 'this chat'}</span>{' '}
              and all its messages.
            </DialogDescription>
          </div>

          <div className="space-y-3 py-2">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-800">
                Type <span className="font-bold">{deleteTargetName || 'this chat'}</span> to
                confirm.
              </p>
            </div>
            <Input
              value={deleteConfirmationInput}
              onChange={(event) => setDeleteConfirmationInput(event.target.value)}
              placeholder={`Type ${isGroupChat ? 'team' : 'chat'} name to confirm`}
              className="h-11"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setDeleteConfirmationInput('');
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteChannel}
              disabled={deleteConfirmationInput !== deleteTargetName}
              className="flex-1"
            >
              {deleteActionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const MAX_CHAT_ATTACHMENTS = 5;

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);
const VIDEO_ATTACHMENT_EXTENSIONS = new Set([
  'avi',
  'flv',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'ogv',
  'webm',
]);
const AUDIO_ATTACHMENT_EXTENSIONS = new Set([
  'aac',
  'aiff',
  'flac',
  'm4a',
  'mp3',
  'oga',
  'ogg',
  'opus',
  'wav',
  'weba',
]);
const MIME_EXTENSION_FALLBACKS: Record<string, string> = {
  'application/json': 'json',
  'application/msword': 'doc',
  'application/pdf': 'pdf',
  'application/rtf': 'rtf',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/csv': 'csv',
  'text/plain': 'txt',
};

const getAttachmentFileName = (attachment: any, index = 0) => {
  const candidate =
    attachment?.fileName ||
    attachment?.name ||
    attachment?.filename ||
    attachment?.serverFileName ||
    '';
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : `Attachment ${index + 1}`;
};

const getAttachmentMimeType = (attachment: any) => {
  const type = attachment?.type || attachment?.mimeType || attachment?.contentType || '';
  return typeof type === 'string' ? type.toLowerCase().split(';')[0].trim() : '';
};

const getAttachmentExtension = (attachment: any, index = 0) => {
  const name = getAttachmentFileName(attachment, index);
  const extensionFromName = name.includes('.') ? name.split('.').pop() || '' : '';
  if (extensionFromName.trim()) {
    return extensionFromName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
  }

  const mimeType = getAttachmentMimeType(attachment);
  if (MIME_EXTENSION_FALLBACKS[mimeType]) return MIME_EXTENSION_FALLBACKS[mimeType];
  if (mimeType.includes('/')) {
    return mimeType
      .split('/')[1]
      .split('+')[0]
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
  }

  return '';
};

const getAttachmentKind = (attachment: any, index = 0) => {
  const mimeType = getAttachmentMimeType(attachment);
  const extension = getAttachmentExtension(attachment, index);

  if (mimeType.startsWith('image/') || IMAGE_ATTACHMENT_EXTENSIONS.has(extension)) return 'image';
  if (mimeType.startsWith('video/') || VIDEO_ATTACHMENT_EXTENSIONS.has(extension)) return 'video';
  if (mimeType.startsWith('audio/') || AUDIO_ATTACHMENT_EXTENSIONS.has(extension)) return 'audio';

  return 'file';
};

const formatAttachmentSize = (size: any) => {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const getAttachmentExternalPreviewUrl = (attachment: any) => {
  const candidate =
    attachment?.preview || attachment?.previewUrl || attachment?.url || attachment?.src || '';
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : '';
};

const canCreateObjectUrlForAttachment = (attachment: any) =>
  typeof URL !== 'undefined' &&
  typeof URL.createObjectURL === 'function' &&
  typeof Blob !== 'undefined' &&
  attachment instanceof Blob;

const AttachmentGlyph = ({
  kind,
  extension,
  large = false,
}: {
  kind: string;
  extension?: string;
  large?: boolean;
}) => {
  const iconClass = large ? 'h-16 w-16' : 'h-6 w-6';
  const wrapperClass = large
    ? 'flex h-28 w-28 items-center justify-center rounded-2xl bg-white text-gray-300 shadow-sm ring-1 ring-gray-200'
    : 'flex h-full w-full items-center justify-center rounded-md bg-gray-100 text-gray-500';

  if (kind === 'video') {
    return (
      <div className={wrapperClass}>
        <Video className={iconClass} strokeWidth={large ? 1.2 : 1.8} />
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div className={wrapperClass}>
        <Mic className={iconClass} strokeWidth={large ? 1.2 : 1.8} />
      </div>
    );
  }

  if (large) {
    return (
      <div className={wrapperClass}>
        <FileText className={iconClass} strokeWidth={1.1} />
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      {extension ? (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          {extension.slice(0, 4)}
        </span>
      ) : (
        <FileIcon className={iconClass} strokeWidth={1.8} />
      )}
    </div>
  );
};

const AttachmentNoPreview = ({ item }: { item: any }) => {
  const metaText = [item?.sizeLabel, item?.extensionLabel].filter(Boolean).join(' - ');

  return (
    <div className="flex h-[min(420px,48vh)] w-[min(720px,calc(100vw-2rem))] flex-col items-center justify-center rounded-xl bg-[#eef1f5] px-6 text-center">
      <AttachmentGlyph kind={item?.kind || 'file'} extension={item?.extension} large />
      <div className="mt-8 text-2xl font-normal text-[#aebbc7] sm:text-[30px]">
        No preview available
      </div>
      <div className="mt-2 text-sm font-semibold uppercase tracking-wide text-[#aebbc7] sm:text-base">
        {metaText || item?.extensionLabel || 'FILE'}
      </div>
    </div>
  );
};

const AttachmentPreviewStage = ({
  item,
  onPreviewError,
}: {
  item: any;
  onPreviewError: () => void;
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationState, setAnimationState] = useState<'play' | 'pause' | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setIsPlaying(false);
    setAnimationState(null);
  }, [item?.previewUrl]);

  useEffect(() => {
    if (animationState) {
      const timer = setTimeout(() => {
        setAnimationState(null);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [animationState]);

  const handlePlay = () => {
    setIsPlaying(true);
    setAnimationState('play');
  };

  const handlePause = () => {
    setIsPlaying(false);
    setAnimationState('pause');
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch((err) => console.log('Video play interrupted:', err));
    } else {
      videoRef.current.pause();
    }
  };

  if (!item) return null;

  if (item.previewError || !item.previewUrl) {
    return <AttachmentNoPreview item={item} />;
  }

  if (item.kind === 'image') {
    return (
      <img
        src={item.previewUrl}
        alt={item.name}
        className="max-h-full max-w-full rounded-xl object-contain shadow-[0_18px_44px_rgba(15,23,42,0.14)]"
        onError={onPreviewError}
      />
    );
  }

  if (item.kind === 'video') {
    return (
      <div className="relative group max-h-full max-w-[min(720px,82vw)] flex items-center justify-center rounded-xl overflow-hidden select-none shadow-[0_18px_44px_rgba(15,23,42,0.14)]">
        <video
          ref={videoRef}
          src={item.previewUrl}
          className="max-h-full max-w-full rounded-xl bg-black object-contain"
          controls
          playsInline
          preload="metadata"
          onPlay={handlePlay}
          onPause={handlePause}
          onError={onPreviewError}
        />

        <div
          className="absolute inset-x-0 top-0 bottom-14 z-10 cursor-pointer"
          onClick={togglePlay}
        />

        {animationState && animationState === 'play' && (
          <div className="absolute pointer-events-none inset-0 flex items-center justify-center z-[15]">
            <div className="animate-play-pause flex items-center justify-center w-20 h-20 rounded-full bg-black/60 backdrop-blur-md text-white border border-white/10 shadow-2xl">
              {
                animationState === 'play' ? (
                  <Play className="w-10 h-10 fill-current translate-x-0.5" />
                ) : null
                // <Pause className="w-10 h-10 fill-current" />
              }
            </div>
          </div>
        )}

        {!isPlaying && !animationState && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <button
              type="button"
              onClick={togglePlay}
              className="pointer-events-auto flex items-center justify-center w-16 h-16 rounded-full bg-black/50 hover:bg-black/75 backdrop-blur-md text-white border border-white/20 shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 cursor-pointer"
              aria-label="Play video"
            >
              <Play className="w-8 h-8 fill-current translate-x-0.5" />
            </button>
          </div>
        )}

        <style
          dangerouslySetInnerHTML={{
            __html: `
          @keyframes playPauseFade {
            0% {
              transform: scale(0.85);
              opacity: 0;
            }
            15% {
              transform: scale(1);
              opacity: 1;
            }
            75% {
              transform: scale(1.05);
              opacity: 1;
            }
            100% {
              transform: scale(1.25);
              opacity: 0;
            }
          }
          .animate-play-pause {
            animation: playPauseFade 0.6s cubic-bezier(0.25, 1, 0.5, 1) forwards;
          }
        `,
          }}
        />
      </div>
    );
  }

  if (item.kind === 'audio') {
    return (
      <div className="flex w-[min(520px,calc(100vw-2rem))] flex-col items-center rounded-xl bg-[#f4f5f7] px-6 py-10 text-center">
        <AttachmentGlyph kind="audio" extension={item.extension} large />
        <div className="mt-5 max-w-full truncate text-base font-semibold text-gray-800">
          {item.name}
        </div>
        <div className="mt-1 text-sm uppercase tracking-wide text-gray-400">
          {[item.sizeLabel, item.extensionLabel].filter(Boolean).join(' - ')}
        </div>
        <audio
          src={item.previewUrl}
          className="mt-6 w-full"
          controls
          preload="metadata"
          onError={onPreviewError}
        />
      </div>
    );
  }

  return <AttachmentNoPreview item={item} />;
};

const AttachmentThumbnail = ({
  item,
  isActive,
  onSelect,
  onRemove,
}: {
  item: any;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) => {
  const canShowMediaThumb =
    item?.previewUrl && !item?.previewError && (item?.kind === 'image' || item?.kind === 'video');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group relative h-14 w-14 shrink-0 cursor-pointer rounded-lg border-2 bg-white p-0.5 transition-all',
        isActive
          ? 'border-ucass-active ring-2 ring-ucass-active/20'
          : 'border-transparent hover:border-gray-300',
      )}
      title={item?.name}
    >
      <div className="h-full w-full overflow-hidden rounded-md">
        {canShowMediaThumb ? (
          item.kind === 'image' ? (
            <img src={item.previewUrl} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            <>
              <video
                src={item.previewUrl}
                className="h-full w-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/45">
                  <span className="ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" />
                </span>
              </div>
            </>
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gray-50 px-1 text-gray-500">
            <AttachmentGlyph kind={item?.kind || 'file'} extension={item?.extension} />
            <span className="max-w-full truncate text-[9px] font-semibold uppercase">
              {item?.extensionLabel || 'FILE'}
            </span>
          </div>
        )}
      </div>

      {isActive ? (
        <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-white/80" />
      ) : null}

      <button
        type="button"
        className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-gray-600 text-white opacity-100 shadow-sm transition-colors hover:bg-gray-800"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${item?.name || 'attachment'}`}
      >
        <X size={12} strokeWidth={2.5} />
      </button>
    </div>
  );
};

export const ChatFooter = ({
  currentChat,
  mentionUsers,
  parentMsgId = '',
  messageItemAction = { action: '', msgObj: null },
  setMessageItemAction,
  typingText,
  fromMeetChat = false,
  isAgentChat = false,
  aiAssistOpen,
  onAiAssistOpenChange,
  onAiAssistContextChange,
  renderAiAssistInline = true,
}: {
  currentChat: any;
  mentionUsers?: any[];
  parentMsgId?: string;
  messageItemAction?: MessageItemActionState;
  setMessageItemAction?: (state: MessageItemActionState) => void;
  typingText?: string;
  fromMeetChat?: boolean;
  isAgentChat?: boolean;
  aiAssistOpen?: boolean;
  onAiAssistOpenChange?: (open: boolean) => void;
  onAiAssistContextChange?: (context: ChatFooterAiAssistContext) => void;
  renderAiAssistInline?: boolean;
}) => {
  const { user } = useUser();
  const meetingActorUuid = user?.uuid || user?.guest_info?.uuid || '';
  const { features } = useCompanyFeatures();
  const location = useLocation();
  const navigate = useNavigate();
  const chatFeatures = useMemo<ChatFeatureFlags>(
    () => resolveChatFeatures(isAgentChat ? 'agent' : 'messenger'),
    [isAgentChat],
  );
  const { handleSendMessage, handleTyping, handleUpdateMessage, messageList } = useSocketEvents();
  const editorRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const emojiWrapperRef = useRef<HTMLDivElement | null>(null);
  const [message, setMessage] = useState<any>(defaultEditorValue);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [isAttachmentPreviewOpen, setIsAttachmentPreviewOpen] = useState(false);
  const [activeAttachmentIndex, setActiveAttachmentIndex] = useState(0);
  const [attachmentObjectUrls, setAttachmentObjectUrls] = useState<Record<number, string>>({});
  const [attachmentPreviewErrors, setAttachmentPreviewErrors] = useState<Record<number, boolean>>(
    {},
  );
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [internalAiAssistOpen, setInternalAiAssistOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [activeUploadChatId, setActiveUploadChatId] = useState('');
  const [attachmentUploadProgress, setAttachmentUploadProgress] = useState<{
    isActive: boolean;
    total: number;
    uploaded: number;
    failed: number;
    processed: number;
  }>({
    isActive: false,
    total: 0,
    uploaded: 0,
    failed: 0,
    processed: 0,
  });
  const [isRecording, setIsRecording] = useState(false);
  const [isPollModalOpen, setIsPollModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const chatAccess = features?.plan_features?.chat || {};
  const canScheduleEvent = Boolean(features?.plan_features?.video?.action?.create);
  const isTeamChat = Boolean(currentChat?.isGroupChat);
  const isChatAccessPending = !features || Object.keys(features).length === 0;
  const isGuestMeetingChat = Boolean(fromMeetChat && (user?.isGuest || user?.guest_info?.uuid));
  const canUseFooterByChatType =
    isGuestMeetingChat ||
    isChatAccessPending ||
    (isTeamChat
      ? Boolean(chatAccess?.access?.TEAM_MESSAGE)
      : Boolean(chatAccess?.access?.DIRECT_MESSAGE));
  const canUseFileUploadControls = isChatAccessPending
    ? true
    : Boolean(chatAccess?.access?.UPLOAD_FILES);
  const isGuestRestrictedFooter = false;
  const canUseUploadInComposer = chatFeatures.canUseDragDropAndUpload && canUseFileUploadControls;
  const canUseAttachmentAndRecordingControls =
    chatFeatures.canUseAttachmentAndRichComposer && canUseFileUploadControls;
  const [isDragOver, setIsDragOver] = useState(false);
  const { data: aiSettings = [] } = useQuery({
    queryKey: ['getAISettingConfig'],
    queryFn: () => getAISettingConfig(),
    select: (data: any) => data?.data?.data || [],
    enabled: !isGuestMeetingChat,
  });
  const hasAiAssistAgent = (Array.isArray(aiSettings) ? aiSettings : []).some(
    (setting: any) =>
      setting?.name === AI_SETTINGS_TYPES.CHAT_ASSISTANT &&
      setting?.type === 'AI_ASSISTANT' &&
      Boolean(setting?.agentId),
  );
  const canShowAiAssistSetupPopover = Boolean(features?.plan_features?.ai?.IS_SHOW);
  const showAiAssistTrigger =
    !fromMeetChat && !isGuestRestrictedFooter && (hasAiAssistAgent || canShowAiAssistSetupPopover);
  const isControlledAiAssist = typeof aiAssistOpen === 'boolean';
  const isAiAssistOpen = typeof aiAssistOpen === 'boolean' ? aiAssistOpen : internalAiAssistOpen;

  const setAiAssistOpen = useCallback(
    (nextValue: boolean) => {
      if (!isControlledAiAssist) {
        setInternalAiAssistOpen(nextValue);
      }
      onAiAssistOpenChange?.(nextValue);
    },
    [isControlledAiAssist, onAiAssistOpenChange],
  );

  const toggleAiAssistOpen = useCallback(() => {
    if (isControlledAiAssist) {
      onAiAssistOpenChange?.(!isAiAssistOpen);
      return;
    }
    setInternalAiAssistOpen((prev) => {
      const nextValue = !prev;
      onAiAssistOpenChange?.(nextValue);
      return nextValue;
    });
  }, [isAiAssistOpen, isControlledAiAssist, onAiAssistOpenChange]);

  useEffect(() => {
    if (isGuestMeetingChat) {
      setAiAssistOpen(false);
    }
  }, [isGuestMeetingChat, setAiAssistOpen]);

  useEffect(() => {
    if (!isGuestRestrictedFooter) return;
    setAttachments([]);
    setIsAttachmentPreviewOpen(false);
    setIsRecording(false);
    setIsPollModalOpen(false);
    setIsEventModalOpen(false);
    setAiAssistOpen(false);
  }, [isGuestRestrictedFooter, setAiAssistOpen]);

  useEffect(() => {
    if (canScheduleEvent) return;
    setIsEventModalOpen(false);
  }, [canScheduleEvent]);

  useEffect(() => {
    if (isChatAccessPending || canUseFileUploadControls) return;
    setAttachments([]);
    setIsAttachmentPreviewOpen(false);
    setIsRecording(false);
  }, [canUseFileUploadControls, isChatAccessPending]);

  const handleDragOver = (e: React.DragEvent) => {
    if (!canUseUploadInComposer || isGuestRestrictedFooter || isGuestMeetingChat) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!canUseUploadInComposer || isGuestRestrictedFooter || isGuestMeetingChat) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDropArea = (e: React.DragEvent) => {
    if (!canUseUploadInComposer || isGuestRestrictedFooter || isGuestMeetingChat) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      handleAddFiles(droppedFiles);
    }
  };

  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const { mutateAsync: uploadMediaMutate, isPending: isUploadingAttachments } = useMutation({
    mutationFn: mediaUploadUrl,
  });
  const activeReplyMessage =
    messageItemAction?.action === 'reply' ? messageItemAction?.msgObj : null;

  const availableUsers = useMemo(
    () =>
      (Array.isArray(mentionUsers)
        ? mentionUsers
        : Array.isArray(currentChat?.users)
          ? currentChat.users
          : []
      ).filter(
        (chatUser: any) =>
          chatUser &&
          chatUser?.uuid &&
          chatUser?.uuid !== meetingActorUuid &&
          (chatUser?.name || chatUser?.first_name || chatUser?.last_name),
      ),
    [currentChat?.users, meetingActorUuid, mentionUsers],
  );
  const chatCompanyUuid = useMemo(() => {
    const fallbackChatUser = (Array.isArray(currentChat?.users) ? currentChat.users : []).find(
      (chatUser: any) => chatUser?.company_info?.uuid || chatUser?.company_uuid,
    );
    return (
      user?.company_info?.uuid ||
      user?.company_uuid ||
      fallbackChatUser?.company_info?.uuid ||
      fallbackChatUser?.company_uuid ||
      ''
    );
  }, [currentChat?.users, user?.company_info?.uuid, user?.company_uuid]);
  const buildReceiverIds = useCallback(() => {
    if (!currentChat?.chatId || !meetingActorUuid) return [];
    const isOwnChat = currentChat.chatId === meetingActorUuid;
    if (isOwnChat) return [meetingActorUuid];

    const usersBasedIds = (Array.isArray(currentChat?.users) ? currentChat.users : [])
      .map((chatUser: any) => chatUser?.uuid)
      .filter((id: string) => id && id !== meetingActorUuid);
    if (usersBasedIds.length > 0) return Array.from(new Set(usersBasedIds));

    const fallbackReceiverIds = (
      Array.isArray(currentChat?.receiverId) ? currentChat.receiverId : []
    ).filter((id: string) => id && id !== meetingActorUuid);
    if (fallbackReceiverIds.length > 0) return Array.from(new Set(fallbackReceiverIds));

    const chatHistory = (Array.isArray(messageList) ? messageList : []).find(
      (chatItem: any) => chatItem?.chatId === currentChat?.chatId,
    )?.messages;
    const historyDerivedIds = (Array.isArray(chatHistory) ? chatHistory : [])
      .flatMap((messageItem: any) => messageItem?.receiverId || [])
      .filter((id: string) => id && id !== meetingActorUuid);
    if (historyDerivedIds.length > 0) return Array.from(new Set(historyDerivedIds));

    return [];
  }, [
    currentChat?.chatId,
    currentChat?.receiverId,
    currentChat?.users,
    meetingActorUuid,
    messageList,
  ]);

  const plainText = useMemo(() => getMessagePreviewText(message || []), [message]);

  /* Sender-resolved transcript for AI Reply Suggestions. Same shape the chat
     header builds for Conversation Insights, rebuilt here because the two
     live in different components and neither owns the other's scope. */
  const replySuggestionMessages = useMemo(() => {
    const chatMessages = (Array.isArray(messageList) ? messageList : []).find(
      (chatItem: any) => chatItem?.chatId === currentChat?.chatId,
    )?.messages;
    return (Array.isArray(chatMessages) ? chatMessages : [])
      .filter(
        (item: any) =>
          !item?.isDeleted && item?.messageType !== 'prompt' && item?.messageType !== 'meet',
      )
      .map((item: any) => {
        const text = getMessagePreviewText(item?.message || '').trim();
        if (!text) return null;
        const senderId = item?.senderId;
        /* "You" rather than the person's own name: the model is being asked
           what You should say next, so the label has to match the prompt. */
        const sender =
          senderId === meetingActorUuid
            ? 'You'
            : (Array.isArray(currentChat?.users) ? currentChat.users : []).find(
                (chatUser: any) => chatUser?.uuid === senderId,
              )?.name || 'Someone';
        return { sender, text };
      })
      .filter(Boolean);
  }, [messageList, currentChat?.chatId, currentChat?.users, meetingActorUuid]);
  const lastIncomingPrefill = useMemo(() => {
    const chatMessages = ((Array.isArray(messageList) ? messageList : []).find(
      (chatItem: any) => chatItem?.chatId === currentChat?.chatId,
    )?.messages || []) as any[];

    for (let index = chatMessages.length - 1; index >= 0; index--) {
      const messageItem = chatMessages[index];
      if (!messageItem || messageItem?.isDeleted) continue;
      if (messageItem?.messageType === 'prompt' || messageItem?.messageType === 'meet') continue;
      if (!messageItem?.senderId || messageItem?.senderId === meetingActorUuid) continue;
      const preview = getMessagePreviewText(messageItem?.message || '').trim();
      if (preview) return preview;
    }

    return '';
  }, [messageList, currentChat?.chatId, meetingActorUuid]);

  useEffect(() => {
    onAiAssistContextChange?.({
      hasAiAssistAgent,
      aiSettings: Array.isArray(aiSettings) ? aiSettings : [],
      prefillText: lastIncomingPrefill,
      chatId: currentChat?.chatId || '',
      lineHeight: 'leading-7',
      type: AI_SETTINGS_TYPES.CHAT_ASSISTANT,
    });
  }, [
    aiSettings,
    currentChat?.chatId,
    hasAiAssistAgent,
    lastIncomingPrefill,
    onAiAssistContextChange,
  ]);
  const hasText = plainText.trim().length > 0;
  const canSend =
    hasText ||
    (!isGuestRestrictedFooter && canUseAttachmentAndRecordingControls && attachments.length > 0);
  const currentChatId = String(currentChat?.chatId || '');
  const isComposerBusy = isSending || isUploadingAttachments;
  const attachmentUploadPercent = attachmentUploadProgress.total
    ? Math.round((attachmentUploadProgress.processed / attachmentUploadProgress.total) * 100)
    : 0;
  const attachmentUploadStep =
    attachmentUploadProgress.total > 0
      ? Math.min(attachmentUploadProgress.processed + 1, attachmentUploadProgress.total)
      : 0;
  const attachmentUploadTitle =
    attachmentUploadProgress.processed >= attachmentUploadProgress.total
      ? 'Finalizing Message'
      : 'Sending Attachments';
  const attachmentUploadStatusText =
    attachmentUploadProgress.processed >= attachmentUploadProgress.total
      ? 'Almost done. We are placing this into the chat.'
      : `Uploading file ${attachmentUploadStep} of ${attachmentUploadProgress.total}.`;
  const attachmentUploadHelperText =
    attachmentUploadProgress.failed > 0
      ? `${attachmentUploadProgress.failed} file${
          attachmentUploadProgress.failed > 1 ? 's' : ''
        } could not upload.`
      : 'Please keep this preview open while we finish sending.';
  const showAttachmentUploadOverlay =
    Boolean(currentChatId) &&
    activeUploadChatId === currentChatId &&
    attachmentUploadProgress.total > 0 &&
    (attachmentUploadProgress.isActive || isSending || isUploadingAttachments);

  useEffect(() => {
    const nextObjectUrls: Record<number, string> = {};

    attachments.forEach((attachment: any, index: number) => {
      const kind = getAttachmentKind(attachment, index);
      if (!['image', 'video', 'audio'].includes(kind)) return;

      const externalPreviewUrl = getAttachmentExternalPreviewUrl(attachment);
      if (externalPreviewUrl) {
        nextObjectUrls[index] = externalPreviewUrl;
        return;
      }

      if (canCreateObjectUrlForAttachment(attachment)) {
        nextObjectUrls[index] = URL.createObjectURL(attachment);
      }
    });

    setAttachmentObjectUrls(nextObjectUrls);

    return () => {
      Object.values(nextObjectUrls).forEach((previewUrl) => {
        if (previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(previewUrl);
        }
      });
    };
  }, [attachments]);

  useEffect(() => {
    setAttachmentPreviewErrors({});
    setActiveAttachmentIndex((prevIndex) => {
      if (!attachments.length) return 0;
      return Math.min(Math.max(prevIndex, 0), attachments.length - 1);
    });
  }, [attachments]);

  useEffect(() => {
    setIsAttachmentPreviewOpen(attachments.length > 0);
  }, [attachments.length]);

  const attachmentPreviewItems = useMemo(
    () =>
      attachments.map((attachment: any, index: number) => {
        const extension = getAttachmentExtension(attachment, index);
        const kind = getAttachmentKind(attachment, index);
        const sizeLabel = formatAttachmentSize(attachment?.size);

        return {
          file: attachment,
          index,
          name: getAttachmentFileName(attachment, index),
          extension,
          extensionLabel: extension ? extension.toUpperCase() : 'FILE',
          kind,
          previewUrl: attachmentObjectUrls[index] || '',
          previewError: Boolean(attachmentPreviewErrors[index]),
          sizeLabel,
        };
      }),
    [attachments, attachmentObjectUrls, attachmentPreviewErrors],
  );

  const activeAttachment =
    attachmentPreviewItems[activeAttachmentIndex] || attachmentPreviewItems[0] || null;
  const hasAttachmentPreview =
    isAttachmentPreviewOpen &&
    !isGuestRestrictedFooter &&
    canUseAttachmentAndRecordingControls &&
    canUseFileUploadControls &&
    attachments.length > 0;
  const attachmentInputId = `messenger-${currentChat?.chatId || 'chat'}-attachments`;

  const clearMessageAction = useCallback(() => {
    setMessageItemAction?.({ action: '', msgObj: null });
  }, [setMessageItemAction]);
  const getDraftMessageAction = useCallback((actionState: MessageItemActionState | null) => {
    if (actionState?.action === 'reply' || actionState?.action === 'edit') {
      return actionState;
    }
    return { action: '', msgObj: null } as MessageItemActionState;
  }, []);

  const replySenderName = useMemo(() => {
    if (!activeReplyMessage) return '';
    try {
      const senderId = activeReplyMessage?.senderId;
      if (!senderId) return 'Unknown User';
      if (senderId === meetingActorUuid) return 'You';
      const sender = (Array.isArray(currentChat?.users) ? currentChat.users : []).find(
        (chatUser: any) => chatUser?.uuid === senderId,
      );
      return sender?.name || 'Unknown User';
    } catch {
      return 'Unknown User';
    }
  }, [activeReplyMessage, currentChat?.users, meetingActorUuid]);

  const replyPreviewText = useMemo(() => {
    if (!activeReplyMessage) return '';
    const previewText = getMessagePreviewText(activeReplyMessage);
    if (previewText?.trim()) return previewText.trim();
    const attachments = Array.isArray(activeReplyMessage?.attachments)
      ? activeReplyMessage.attachments
      : [];
    if (attachments.length > 0) {
      const names = attachments
        .slice(0, 2)
        .map((attachment: any) => attachment?.fileName || attachment?.name || '')
        .filter(Boolean)
        .join(', ');
      return attachments.length > 2
        ? `${names} +${attachments.length - 2} more`
        : names || 'Attachment';
    }
    if (activeReplyMessage?.gif?.url) return activeReplyMessage?.gif?.title || 'GIF';
    return 'Message';
  }, [activeReplyMessage]);

  const emitTyping = useCallback(
    (typing: boolean) => {
      if (!currentChat?.chatId) return;
      handleTyping({ currentChat, isTyping: typing });
      isTypingRef.current = typing;
    },
    [currentChat, handleTyping],
  );

  const isRestoringDraft = useRef(false);
  const activeDraftKeyRef = useRef('');
  const lastPathnameRef = useRef(location.pathname);
  const currentDraftKey = useMemo(
    () => (currentChat?.chatId ? `${currentChat?.chatId}_${parentMsgId || 'main'}` : ''),
    [currentChat?.chatId, parentMsgId],
  );

  useEffect(() => {
    if (lastPathnameRef.current !== location.pathname) {
      flushEditingDraftsToSaved();
      lastPathnameRef.current = location.pathname;
    }
  }, [location.pathname]);

  useEffect(() => {
    if (activeDraftKeyRef.current && activeDraftKeyRef.current !== currentDraftKey) {
      flushEditingDraftsToSaved([activeDraftKeyRef.current]);
    }
    activeDraftKeyRef.current = currentDraftKey;
  }, [currentDraftKey]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      flushEditingDraftsToSaved();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    return () => {
      if (activeDraftKeyRef.current) {
        flushEditingDraftsToSaved([activeDraftKeyRef.current]);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentChat?.chatId) return;

    const draft = getDraftFromStores(currentDraftKey);

    isRestoringDraft.current = true;

    if (draft) {
      setMessage(draft.message);
      setAttachments(draft.attachments || []);
      const draftMessageAction = getDraftMessageAction(draft.messageItemAction);
      if (draftMessageAction.action) {
        setMessageItemAction?.(draftMessageAction);
      } else {
        clearMessageAction();
      }

      // Small delay to ensure editor is ready before replacing value
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.replaceEditorValue?.(draft.message);
        }
        isRestoringDraft.current = false;
      }, 0);
    } else {
      setMessage(defaultEditorValue);
      setAttachments([]);
      editorRef.current?.resetEditor?.();
      clearMessageAction();
      isRestoringDraft.current = false;
    }

    setIsEmojiPickerOpen(false);
    setAiAssistOpen(false);
    setIsRecording(false);

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (isTypingRef.current) {
      handleTyping({ currentChat, isTyping: false });
      isTypingRef.current = false;
    }
  }, [
    currentChat?.chatId,
    currentDraftKey,
    clearMessageAction,
    getDraftMessageAction,
    setAiAssistOpen,
    setMessageItemAction,
  ]);

  useEffect(() => {
    if (!hasAiAssistAgent) {
      setAiAssistOpen(false);
    }
  }, [hasAiAssistAgent, setAiAssistOpen]);

  useEffect(() => {
    if (isRestoringDraft.current || !currentChat?.chatId) return;

    const draftKey = currentDraftKey;
    if (!draftKey) return;
    const existingDraft = getDraftFromStores(draftKey);
    const hasAttachmentDraft = Array.isArray(attachments) && attachments.length > 0;
    const currentDraftMessageAction = getDraftMessageAction(messageItemAction);
    const existingDraftMessageAction = getDraftMessageAction(existingDraft?.messageItemAction);
    const hasMessageAction = Boolean(currentDraftMessageAction.action);
    const hasDraftContent = hasText || hasAttachmentDraft || hasMessageAction;
    const getAttachmentIdentity = (attachment: any, index: number) => {
      if (!attachment || typeof attachment !== 'object') return `empty_${index}`;
      const key = String(
        attachment?.serverFileName ||
          attachment?.filename ||
          attachment?.fileName ||
          attachment?.name ||
          attachment?.url ||
          attachment?.preview ||
          '',
      ).trim();
      const size = Number(attachment?.size) || 0;
      const type = String(attachment?.type || attachment?.mimeType || '').trim();
      const modified = Number(attachment?.lastModified) || 0;
      return `${key}_${size}_${type}_${modified}_${index}`;
    };
    const getAttachmentsSignature = (attachmentList: any[] = []) =>
      (Array.isArray(attachmentList) ? attachmentList : [])
        .map((attachment: any, index: number) => getAttachmentIdentity(attachment, index))
        .join('|');
    const getMessageActionSignature = (messageAction: any) => {
      const action = String(messageAction?.action || '').trim();
      const messageId = String(
        messageAction?.msgObj?.messageId || messageAction?.msgObj?._id || '',
      ).trim();
      return `${action}:${messageId}`;
    };

    if (!hasDraftContent) {
      if (existingDraft) {
        clearDraftFromStores(draftKey);
      }
      return;
    }

    const currentDraftText = plainText.trim();
    const existingDraftText = getMessagePreviewText(existingDraft?.message || '').trim();
    const currentAttachmentsSignature = getAttachmentsSignature(attachments);
    const existingAttachmentsSignature = getAttachmentsSignature(
      chatDraftAttachmentsMemory[draftKey] || existingDraft?.attachments || [],
    );
    const currentMessageActionSignature = getMessageActionSignature(currentDraftMessageAction);
    const existingMessageActionSignature = getMessageActionSignature(existingDraftMessageAction);
    const isTextChanged = currentDraftText !== existingDraftText;
    const isAttachmentsChanged = currentAttachmentsSignature !== existingAttachmentsSignature;
    const isMessageActionChanged = currentMessageActionSignature !== existingMessageActionSignature;
    const isDraftChanged = isTextChanged || isAttachmentsChanged || isMessageActionChanged;

    if (!isDraftChanged) {
      return;
    }

    setEditingDraft(draftKey, {
      message,
      attachments: Array.isArray(attachments) ? [...attachments] : [],
      messageItemAction: currentDraftMessageAction,
      updatedAt: Date.now(),
    });
  }, [
    message,
    attachments,
    messageItemAction,
    currentChat?.chatId,
    currentDraftKey,
    hasText,
    plainText,
    getDraftMessageAction,
  ]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) emitTyping(false);
    };
  }, [emitTyping]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!emojiWrapperRef.current) return;
      if (!emojiWrapperRef.current.contains(event.target as Node)) {
        setIsEmojiPickerOpen(false);
      }
    };

    if (!isEmojiPickerOpen) return;
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEmojiPickerOpen]);

  const onMessageChange = (nextValue: any) => {
    setMessage(nextValue);

    const hasContent = getMessagePreviewText(nextValue || []).trim().length > 0;
    if (hasContent && !isTypingRef.current) emitTyping(true);
    if (!hasContent && isTypingRef.current) emitTyping(false);

    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    if (hasContent) {
      typingTimeoutRef.current = window.setTimeout(() => {
        if (isTypingRef.current) emitTyping(false);
      }, 1200);
    }
  };

  const handleAddFiles = (files: any[] = []) => {
    if (!canUseUploadInComposer) return;
    const validFiles = (Array.isArray(files) ? files : []).filter(Boolean);
    if (!validFiles.length) return;

    setIsAttachmentPreviewOpen(true);
    setAttachments((prev) => {
      const combined = [...prev, ...validFiles];
      const limitedFiles = combined.slice(0, MAX_CHAT_ATTACHMENTS);
      if (combined.length > MAX_CHAT_ATTACHMENTS) {
        toast.warning(`You can only attach ${MAX_CHAT_ATTACHMENTS} files at a time.`);
      }
      if (limitedFiles.length > prev.length) {
        setActiveAttachmentIndex(prev.length ? Math.min(prev.length, limitedFiles.length - 1) : 0);
      }
      return limitedFiles;
    });
  };

  const handleAttachmentInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleAddFiles(Array.from(event.target.files || []));
    event.target.value = '';
  };

  const handleRemoveAttachment = useCallback((indexToRemove: number) => {
    setAttachments((prev) => {
      const safePrev = Array.isArray(prev) ? prev : [];
      const nextAttachments = safePrev.filter(
        (_: any, fileIndex: number) => fileIndex !== indexToRemove,
      );

      setActiveAttachmentIndex((prevIndex) => {
        if (!nextAttachments.length) return 0;
        if (prevIndex > indexToRemove) return prevIndex - 1;
        if (prevIndex === indexToRemove) return Math.min(indexToRemove, nextAttachments.length - 1);
        return Math.min(prevIndex, nextAttachments.length - 1);
      });

      if (!nextAttachments.length && fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (!nextAttachments.length) {
        setIsAttachmentPreviewOpen(false);
      }

      return nextAttachments;
    });
  }, []);

  const handleClearAttachments = useCallback(() => {
    setAttachments([]);
    setIsAttachmentPreviewOpen(false);
    setActiveAttachmentIndex(0);
    setAttachmentPreviewErrors({});
    setIsEmojiPickerOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleAttachmentPreviewError = useCallback((index: number) => {
    setAttachmentPreviewErrors((prev) => ({ ...prev, [index]: true }));
  }, []);

  const handleOpenAttachmentPicker = useCallback(() => {
    if (isComposerBusy) return;
    if (attachments.length >= MAX_CHAT_ATTACHMENTS) {
      toast.warning(`You can only attach ${MAX_CHAT_ATTACHMENTS} files at a time.`);
      return;
    }
    fileInputRef.current?.click();
  }, [attachments.length, isComposerBusy]);

  const normalizeUploadFile = (fileLike: any, index: number): File | null => {
    try {
      if (fileLike instanceof File) return fileLike;
      if (!fileLike) return null;

      const blobType = fileLike?.type || 'application/octet-stream';
      const extension = blobType.includes('/') ? blobType.split('/')[1] : 'bin';
      const fileName = fileLike?.name || `attachment-${Date.now()}-${index}.${extension}`;
      return new File([fileLike], fileName, { type: blobType });
    } catch (error) {
      console.error('Failed to normalize file:', error);
      return null;
    }
  };

  const uploadAttachments = async () => {
    if (!canUseUploadInComposer || isGuestRestrictedFooter) return [];
    const companyUuid = chatCompanyUuid;
    const uploadChatId = String(currentChat?.chatId || '');
    if (!attachments.length) return [];
    if (!companyUuid) {
      toast.error('Unable to upload attachments for this chat.');
      return [];
    }

    const filesToUpload = attachments
      .map((attachment: any, index: number) => normalizeUploadFile(attachment, index))
      .filter(Boolean) as File[];
    if (!filesToUpload.length) return [];

    setActiveUploadChatId(uploadChatId);
    setAttachmentUploadProgress({
      isActive: true,
      total: filesToUpload.length,
      uploaded: 0,
      failed: 0,
      processed: 0,
    });

    const uploadedFileData: any[] = [];

    try {
      for (let index = 0; index < filesToUpload.length; index++) {
        const file = filesToUpload[index];
        let isFileUploaded = false;

        try {
          const uploadMediaRes = await uploadMediaMutate({
            uuid: companyUuid,
            type: 'chat',
            file_name: file?.name,
          });

          const putUrl = uploadMediaRes?.data?.data?.result?.url;
          const uploadedFileName = uploadMediaRes?.data?.data?.result?.file_name;
          if (!putUrl || !uploadedFileName) continue;

          const uploadFileResponse = await fetch(putUrl, {
            method: 'PUT',
            body: file,
          });

          if (!uploadFileResponse.ok) continue;

          uploadedFileData.push({
            fileName: file?.name,
            serverFileName: uploadedFileName,
            name: file?.name,
            filename: uploadedFileName,
            company_uuid: companyUuid,
            type: file?.type || '',
            size: file?.size || 0,
          });
          isFileUploaded = true;
        } catch (error) {
          console.error('Attachment upload failed:', error);
        } finally {
          setAttachmentUploadProgress((prev) => ({
            ...prev,
            processed: prev.processed + 1,
            uploaded: prev.uploaded + (isFileUploaded ? 1 : 0),
            failed: prev.failed + (isFileUploaded ? 0 : 1),
          }));
        }
      }

      return uploadedFileData;
    } finally {
      setAttachmentUploadProgress((prev) => ({ ...prev, isActive: false }));
    }
  };

  const sendMessage = async () => {
    if (!currentChat?.chatId || !meetingActorUuid || isComposerBusy) return;
    if (editorRef.current?.isEditorEmpty?.() && attachments.length === 0) return;
    if (!canSend) return;

    setIsSending(true);

    try {
      const attachmentCountAtSend = attachments.length;
      const uploadedAttachments =
        !isGuestRestrictedFooter && canUseUploadInComposer && attachments.length > 0
          ? await uploadAttachments()
          : [];
      if (attachmentCountAtSend > 0 && uploadedAttachments.length < attachmentCountAtSend) {
        const failedCount = attachmentCountAtSend - uploadedAttachments.length;
        if (!hasText && uploadedAttachments.length === 0) {
          toast.error('Attachment upload failed. Please try again.');
        } else {
          toast.warning(`${failedCount} attachment${failedCount > 1 ? 's' : ''} could not upload.`);
        }
      }
      const originalAttachments =
        messageItemAction?.action === 'edit' ? messageItemAction?.msgObj?.attachments || [] : [];

      if (!hasText && uploadedAttachments.length === 0 && originalAttachments.length === 0) return;

      const receiverId = buildReceiverIds();

      if (messageItemAction?.action === 'edit') {
        const payload: any = {
          messageId: messageItemAction?.msgObj?.messageId || messageItemAction?.msgObj?._id,
          currentChat,
          message: hasText ? message : defaultEditorValue,
        };

        if (originalAttachments.length > 0 || uploadedAttachments.length > 0) {
          payload.attachments = [...originalAttachments, ...uploadedAttachments];
        }

        handleUpdateMessage(payload);
        setMessageItemAction?.({ action: '', msgObj: null });
        editorRef.current?.resetEditor?.();
        setMessage(defaultEditorValue);
        setAttachments([]);
        setIsAttachmentPreviewOpen(false);
        setIsSending(false);

        clearDraftFromStores(currentDraftKey);

        return;
      }

      const payload: any = {
        chatId: currentChat?.chatId,
        message: hasText ? message : defaultEditorValue,
        attachments: uploadedAttachments,
        senderId: meetingActorUuid,
        receiverId,
        messageId: uuidV4(),
        createdAt: new Date().toISOString(),
      };

      if (parentMsgId) {
        payload.parentMsgId = parentMsgId;
      }
      if (activeReplyMessage) {
        payload.isReplied = true;
        payload.replyOf = activeReplyMessage._id || activeReplyMessage.messageId;
      }

      handleSendMessage(payload);

      setMessage(defaultEditorValue);
      setAttachments([]);
      setIsAttachmentPreviewOpen(false);
      setIsEmojiPickerOpen(false);
      editorRef.current?.resetEditor?.();

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (isTypingRef.current) emitTyping(false);
      if (activeReplyMessage) clearMessageAction();

      clearDraftFromStores(currentDraftKey);
    } finally {
      setIsSending(false);
      setActiveUploadChatId('');
    }
  };

  const sendAudioMessage = async (audioFile: File) => {
    if (!currentChat?.chatId || !meetingActorUuid || isComposerBusy) return;
    setIsSending(true);
    try {
      const companyUuid = chatCompanyUuid;
      if (!companyUuid) {
        toast.error('Unable to upload voice message for this chat.');
        return;
      }

      const uploadMediaRes = await uploadMediaMutate({
        uuid: companyUuid,
        type: 'chat',
        file_name: audioFile.name,
      });

      const putUrl = uploadMediaRes?.data?.data?.result?.url;
      const uploadedFileName = uploadMediaRes?.data?.data?.result?.file_name;
      if (!putUrl || !uploadedFileName) return;

      const uploadFileResponse = await fetch(putUrl, { method: 'PUT', body: audioFile });
      if (!uploadFileResponse.ok) return;

      const receiverId = buildReceiverIds();

      const payload: any = {
        chatId: currentChat?.chatId,
        message: defaultEditorValue,
        attachments: [
          {
            fileName: audioFile.name,
            serverFileName: uploadedFileName,
            name: audioFile.name,
            filename: uploadedFileName,
            company_uuid: companyUuid,
            type: audioFile.type || 'audio/mp3',
            size: audioFile.size || 0,
          },
        ],
        senderId: meetingActorUuid,
        receiverId,
        messageId: uuidV4(),
        createdAt: new Date().toISOString(),
      };

      if (parentMsgId) payload.parentMsgId = parentMsgId;
      if (activeReplyMessage) {
        payload.isReplied = true;
        payload.replyOf = activeReplyMessage._id || activeReplyMessage.messageId;
      }

      handleSendMessage(payload);
      setIsRecording(false);
      if (activeReplyMessage) clearMessageAction();

      clearDraftFromStores(currentDraftKey);
    } catch (error) {
      console.error('Audio upload failed:', error);
    } finally {
      setIsSending(false);
    }
  };

  const sendPollMessage = (pollData: any) => {
    if (!currentChat?.chatId || !meetingActorUuid || isComposerBusy) return;
    const receiverId = buildReceiverIds();

    const payload: any = {
      chatId: currentChat?.chatId,
      message: [
        {
          type: 'paragraph',
          children: [{ text: 'Created a Poll' }],
        },
      ],
      messageType: 'poll',
      poll: pollData,
      senderId: meetingActorUuid,
      receiverId,
      messageId: uuidV4(),
      createdAt: new Date().toISOString(),
    };

    if (parentMsgId) payload.parentMsgId = parentMsgId;
    if (activeReplyMessage) {
      payload.isReplied = true;
      payload.replyOf = activeReplyMessage._id || activeReplyMessage.messageId;
    }

    handleSendMessage(payload);
    if (activeReplyMessage) clearMessageAction();

    clearDraftFromStores(currentDraftKey);
  };

  // const sendGifMessage = () => {
  //   if (!currentChat?.chatId || !user?.uuid || isComposerBusy) return;
  //   const gifUrl = window.prompt('Paste GIF URL');
  //   if (!gifUrl || !/^https?:\/\//i.test(gifUrl.trim())) return;

  //   const isOwnChat = currentChat?.chatId === user?.uuid;
  //   const receiverId = isOwnChat
  //     ? [user?.uuid]
  //     : (Array.isArray(currentChat?.users) ? currentChat.users : [])
  //       .map((chatUser: any) => chatUser?.uuid)
  //       .filter((id: string) => id && id !== user?.uuid);

  //   const payload: any = {
  //     chatId: currentChat?.chatId,
  //     message: defaultEditorValue,
  //     attachments: [],
  //     senderId: user?.uuid,
  //     receiverId,
  //     messageId: uuidV4(),
  //     createdAt: new Date().toISOString(),
  //     gif: {
  //       url: gifUrl.trim(),
  //       title: 'GIF',
  //     },
  //   };

  //   if (parentMsgId) {
  //     payload.parentMsgId = parentMsgId;
  //   }
  //   if (activeReplyMessage) {
  //     payload.replyOf = buildReplyOfPayload(activeReplyMessage);
  //   }

  //   handleSendMessage(payload);
  //   if (activeReplyMessage) clearMessageAction();
  // };

  const handleEmojiSelect = (emoji: string) => {
    if (!emoji) return;
    editorRef.current?.insertText?.(emoji);
    editorRef.current?.focusEditor?.();
    // setIsEmojiPickerOpen(false);
  };

  useEffect(() => {
    if (messageItemAction?.action === 'edit') {
      try {
        if (editorRef.current && messageItemAction?.msgObj?.message) {
          editorRef.current.replaceEditorValue?.(messageItemAction.msgObj.message);
        }
      } catch (error) {
        console.error('Error setting editor value:', error);
      }
    }
  }, [messageItemAction]);

  const renderEditBanner = (isPreview = false) =>
    messageItemAction?.action === 'edit' ? (
      <div
        className={cn(isPreview ? 'mb-2 w-full' : 'absolute -top-5 w-full left-0 px-2 h-8 z-[12]')}
      >
        <div
          className={cn(
            'bg-ucass-active px-3 text-white text-sm min-h-8 pt-1.5 flex justify-between',
            isPreview ? 'rounded-md' : 'rounded-t-md',
          )}
        >
          Edit Message
          <button
            type="button"
            className="cursor-pointer"
            onClick={() => {
              setMessageItemAction?.({ action: '', msgObj: null });
              editorRef.current?.resetEditor?.();
              setMessage(defaultEditorValue);
            }}
            aria-label="Cancel edit"
          >
            <X height={16} width={16} />
          </button>
        </div>
      </div>
    ) : null;

  const renderReplyBanner = (isPreview = false) =>
    activeReplyMessage ? (
      <div
        className={cn(
          'rounded-lg border border-ucass-active-bg bg-ucass-active-bg px-2.5 py-2',
          isPreview ? 'mb-2 w-full' : 'mb-2',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ucass-active truncate">
              Replying to {replySenderName || 'User'}
            </div>
            <div className="text-xs text-gray-700 truncate">{replyPreviewText || 'Message'}</div>
          </div>
          <button
            type="button"
            className="w-6 h-6 rounded-full flex items-center justify-center text-gray-500 hover:bg-white/80"
            onClick={clearMessageAction}
            aria-label="Cancel reply"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    ) : null;

  const renderComposerEditor = ({
    className = 'm-0',
    placeholder,
  }: {
    className?: string;
    placeholder?: string;
  } = {}) => (
    <TextEditor
      ref={editorRef}
      initialValue={message || defaultEditorValue}
      onChange={onMessageChange}
      onPressEnterWithoutShift={sendMessage}
      chatId={currentChat?.chatId}
      onPaste={(files: any[] = []) => {
        if (!isGuestRestrictedFooter && canUseUploadInComposer && !isGuestMeetingChat) {
          handleAddFiles(files);
        }
      }}
      onDrop={(files: any[] = []) => {
        if (!isGuestRestrictedFooter && canUseUploadInComposer && !isGuestMeetingChat) {
          handleAddFiles(files);
        }
      }}
      placeholder={
        placeholder ||
        (!isGuestRestrictedFooter && !isGuestMeetingChat && canUseAttachmentAndRecordingControls
          ? 'Type something or drag and drop files...'
          : 'Type a message...')
      }
      availableUsers={availableUsers}
      isLoading={isComposerBusy}
      fromMeetChat={fromMeetChat}
      className={className}
      allowEveryoneMention={currentChat?.groupType === 'CHANNEL'}
    />
  );

  const renderEmojiButton = (pickerClassName = 'absolute bottom-10 right-0') => (
    <div ref={emojiWrapperRef} className={fromMeetChat ? '' : 'relative'}>
      <button
        type="button"
        className={cn(
          'cursor-pointer min-w-6 max-h-6 max-w-6 min-h-6 rounded-2xl flex justify-center items-center text-gray-500',
          isComposerBusy ? 'cursor-not-allowed opacity-50' : '',
        )}
        onClick={() => {
          if (!isComposerBusy) {
            setIsEmojiPickerOpen((prev) => !prev);
          }
        }}
        title="Emoji"
        aria-label="Emoji"
      >
        <Smile width={18} height={18} />
      </button>

      {isEmojiPickerOpen ? (
        <div
          className={cn(
            pickerClassName,
            'z-[9999] shadow-xl rounded-lg overflow-hidden w-[350px] max-w-[calc(100vw-2rem)]',
          )}
        >
          <EmojiPicker
            className={fromMeetChat ? 'meeting-chat-emoji-picker' : undefined}
            width="100%"
            height={fromMeetChat ? 'clamp(280px, 42vh, 330px)' : undefined}
            lazyLoadEmojis
            searchDisabled={false}
            previewConfig={{ showPreview: false }}
            onEmojiClick={(data: any) => handleEmojiSelect(data?.emoji || '')}
          />
        </div>
      ) : null}
    </div>
  );

  const baseComposerClasses =
    'w-full flex flex-col border-t-2 border-r border-l border-t-primary/70 focus-visible:border-t-primary focus-within:border-t-primary border-r-gray-200 border-l-gray-200 rounded-md shadow-sm min-h-[120px] pb-8 relative';
  const attachmentPreviewMeta = [
    activeAttachment?.name,
    activeAttachment?.sizeLabel,
    activeAttachment?.extensionLabel,
  ]
    .filter(Boolean)
    .join(' \u00b7 ');

  if (!canUseFooterByChatType) return null;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropArea}
      className={cn(
        'transition-colors',
        hasAttachmentPreview
          ? 'absolute inset-0 z-20 flex h-full min-h-0 w-full flex-col bg-[#edf1f6]'
          : `w-full shrink-0 bg-white px-2 py-2 relative flex flex-col ${typingText ? 'gap-0' : 'gap-3'} border-t border-gray-200`,
        isDragOver ? 'bg-ucass-active-bg ring-2 ring-primary/20 ring-inset' : '',
      )}
    >
      {showAttachmentUploadOverlay ? (
        <div className="absolute inset-0 z-40 bg-ucass-active-bg/80 backdrop-blur-[2px] flex items-center justify-center px-3">
          <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-ucass-active-bg bg-white shadow-[0_14px_34px_rgba(15,23,42,0.14)]">
            <div className="relative px-4 py-4 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-ucass-active-bg text-ucass-active shadow-sm">
                    <Loader variant="blue" size="sm" />
                    <span className="absolute inset-0 rounded-xl ring-2 ring-ucass-active/30 animate-pulse" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {attachmentUploadTitle}
                    </p>
                    <p className="text-xs text-gray-600">{attachmentUploadStatusText}</p>
                  </div>
                </div>
                <div className="rounded-lg bg-ucass-active px-2 py-1 text-xs font-semibold text-white">
                  {attachmentUploadPercent}%
                </div>
              </div>

              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ucass-active-bg">
                <div
                  className="h-full rounded-full bg-ucass-active transition-all duration-300"
                  style={{ width: `${attachmentUploadPercent}%` }}
                />
              </div>

              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] sm:text-xs">
                <span className="font-medium text-gray-600">{attachmentUploadHelperText}</span>
                <span
                  className={cn(
                    'font-medium',
                    attachmentUploadProgress.failed > 0 ? 'text-amber-600' : 'text-ucass-active',
                  )}
                >
                  {attachmentUploadProgress.failed > 0
                    ? `${attachmentUploadProgress.failed} failed`
                    : 'No failures'}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {hasAttachmentPreview ? (
        <div className="flex h-full min-h-0 w-full flex-col bg-[#edf1f6]">
          <div className="flex h-11 shrink-0 items-center border-b border-gray-200 bg-white px-5">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md px-1 py-1 text-sm font-medium text-[#26364d] transition-colors hover:text-primary"
              onClick={handleClearAttachments}
              aria-label="Close attachment preview"
            >
              <X size={17} strokeWidth={2.2} />
              Close
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-4 pt-5 sm:px-8">
            <div className="flex min-h-0 w-full flex-1 items-center justify-center">
              <AttachmentPreviewStage
                item={activeAttachment}
                onPreviewError={() => handleAttachmentPreviewError(activeAttachment?.index)}
              />
            </div>

            {attachmentPreviewMeta ? (
              <div className="mt-4 max-w-[min(720px,calc(100vw-2rem))] truncate text-center text-xs font-medium text-[#1d2940]">
                {attachmentPreviewMeta}
              </div>
            ) : null}

            <div className="mt-3 w-full max-w-[680px]">
              {renderEditBanner(true)}
              {renderReplyBanner(true)}
              <div className="relative min-h-12 rounded-xl border border-gray-200 bg-white px-11 py-2 shadow-sm [&_[data-test-id=menu]]:hidden">
                <div className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-[#8a97ad]">
                  {renderEmojiButton('absolute bottom-8 left-0')}
                </div>
                {renderComposerEditor({
                  className: 'm-0 min-h-7 max-h-20 overflow-y-auto px-0 py-1 text-sm leading-6',
                  placeholder: 'Add a caption...',
                })}
              </div>
            </div>
          </div>

          <div className="relative flex min-h-[86px] shrink-0 items-center px-5 pb-5 pt-2">
            <input
              ref={fileInputRef}
              id={attachmentInputId}
              type="file"
              multiple
              hidden
              onChange={handleAttachmentInputChange}
              disabled={isComposerBusy}
            />

            <div className="flex max-w-full flex-1 items-center justify-start gap-3 overflow-x-auto pr-32 scrollbar-hide sm:pr-4 pt-2">
              {attachmentPreviewItems.map((item: any) => (
                <AttachmentThumbnail
                  key={`${item.name}-${item.index}`}
                  item={item}
                  isActive={item.index === activeAttachment?.index}
                  onSelect={() => setActiveAttachmentIndex(item.index)}
                  onRemove={() => handleRemoveAttachment(item.index)}
                />
              ))}

              <button
                type="button"
                className={cn(
                  'flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-[#b9c4d6] bg-white/30 text-[#73839c] transition-colors hover:border-ucass-active hover:bg-white hover:text-ucass-active',
                  isComposerBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                )}
                onClick={handleOpenAttachmentPicker}
                disabled={isComposerBusy}
                aria-label="Add attachment"
                title={
                  attachments.length >= MAX_CHAT_ATTACHMENTS
                    ? `Maximum ${MAX_CHAT_ATTACHMENTS} files`
                    : 'Add attachment'
                }
              >
                <Plus size={22} strokeWidth={2.2} />
              </button>
            </div>

            {/* <div className="absolute right-5 top-1/2 flex -translate-y-1/2 items-center gap-4"> */}
            <div className="flex items-center gap-4">
              <span className="whitespace-nowrap text-xs font-medium text-[#71809a]">
                {attachments.length} file{attachments.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className={cn(
                  'flex h-14 w-14 items-center justify-center rounded-full bg-ucass-active text-white shadow-[0_10px_24px_rgba(15,106,231,0.24)] transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                  !canSend || isComposerBusy
                    ? 'cursor-not-allowed bg-ucass-active-bg text-ucass-active shadow-none hover:bg-ucass-active-bg'
                    : 'cursor-pointer',
                )}
                onClick={() => sendMessage()}
                disabled={!canSend || isComposerBusy}
                aria-label="Send message"
              >
                {isUploadingAttachments ? (
                  <Loader variant={isComposerBusy ? 'blue' : 'white'} size="sm" />
                ) : (
                  <SendHorizontal width={25} height={25} strokeWidth={2.7} />
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {renderEditBanner()}
          {renderReplyBanner()}

          {isRecording && !fromMeetChat && !isGuestRestrictedFooter && canUseFileUploadControls ? (
            <div className="min-h-[150px] flex items-center justify-center border-t-2 border-ucass-active/70 border-r border-l border-r-gray-200 border-l-gray-200 rounded-md shadow-sm">
              <div className="w-auto max-w-md mx-auto transition-all duration-300 flex items-center justify-center">
                <AudioRecorder
                  isLoading={isComposerBusy}
                  onCancel={() => setIsRecording(false)}
                  onSend={(audioFile) => sendAudioMessage(audioFile)}
                />
              </div>
            </div>
          ) : (
            <div className="relative shrink-0">
              {typingText ? (
                <div className="text-xs text-ucass-active px-1 py-1">{typingText}</div>
              ) : null}

              {/* Sits directly above the input rather than in a panel: these
                  are offered rather than asked for, so they belong where the
                  eye already is. Fills the composer on click, same as every
                  other AI surface here - it never sends. */}
              {!isGuestRestrictedFooter ? (
                <AiInlineReplySuggestions
                  messages={replySuggestionMessages}
                  chatId={currentChat?.chatId}
                  draftText={plainText}
                  disabled={isComposerBusy}
                  onSelect={(text) => {
                    const value = String(text)
                      .split('\n')
                      .map((line) => ({ type: 'paragraph', children: [{ text: line }] }));
                    setMessage(value);
                    editorRef.current?.replaceEditorValue?.(value);
                  }}
                />
              ) : null}

              <div className={baseComposerClasses}>{renderComposerEditor()}</div>
              <div className="absolute right-0 bottom-1 z-[12]">
                <div className="flex gap-1.5 items-center px-2  pointer-events-auto rounded-full">
                  {!isGuestRestrictedFooter && chatFeatures.canUseAttachmentAndRichComposer ? (
                    <>
                      {canUseFileUploadControls && !isGuestMeetingChat ? (
                        <>
                          <input
                            ref={fileInputRef}
                            id={attachmentInputId}
                            type="file"
                            multiple
                            hidden
                            onChange={handleAttachmentInputChange}
                            disabled={isComposerBusy}
                          />
                          <label
                            htmlFor={attachmentInputId}
                            className={cn(
                              'cursor-pointer min-w-7 max-h-7 max-w-7 min-h-7 rounded-full flex justify-center items-center text-gray-500 transition-colors hover:text-ucass-active',
                              isComposerBusy ? 'opacity-50 cursor-not-allowed' : '',
                            )}
                            title="Attach files"
                          >
                            <Paperclip width={18} height={18} />
                          </label>

                          {!fromMeetChat ? (
                            <div
                              className={cn(
                                'cursor-pointer min-w-6 max-h-6 max-w-6 min-h-6 rounded-2xl flex justify-center items-center text-gray-500',
                                isComposerBusy ? 'cursor-not-allowed opacity-50' : '',
                              )}
                              onClick={() => {
                                if (!isComposerBusy) {
                                  setIsRecording((prev) => !prev);
                                  setIsEmojiPickerOpen(false);
                                }
                              }}
                              title="Record voice message"
                            >
                              <Mic width={18} height={18} />
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      <div
                        className={cn(
                          'cursor-pointer min-w-6 max-h-6 max-w-6 min-h-6 rounded-2xl flex justify-center items-center text-gray-500 hover:text-ucass-active transition-colors',
                          isComposerBusy ? 'cursor-not-allowed opacity-50' : '',
                        )}
                        onClick={() => {
                          if (!isComposerBusy) {
                            setIsPollModalOpen(true);
                          }
                        }}
                        title="Create Poll"
                      >
                        <BarChart2 width={18} height={18} />
                      </div>
                      {!fromMeetChat && canScheduleEvent ? (
                        <div
                          className={cn(
                            'cursor-pointer min-w-6 max-h-6 max-w-6 min-h-6 rounded-2xl flex justify-center items-center text-gray-500 hover:text-ucass-active transition-colors',
                            isComposerBusy ? 'cursor-not-allowed opacity-50' : '',
                          )}
                          onClick={() => {
                            if (!isComposerBusy) {
                              setIsEventModalOpen(true);
                            }
                          }}
                          title="Events"
                        >
                          <Calendar width={18} height={18} />
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {renderEmojiButton()}

                  {/* Rewrites what is already typed. Separate from the AI
                      Assist button beside it, which opens a conversational
                      agent and needs one configured; this needs no setup and
                      only ever hands text back. Insert is the sole path that
                      touches the draft, and it rebuilds the editor value from
                      plain text - so a rewrite drops bold/italic, which is the
                      honest trade for the model returning prose rather than
                      Slate nodes. */}
                  <AiWriting
                    draftText={plainText}
                    disabled={isComposerBusy}
                    onInsert={(text) => {
                      const value = String(text)
                        .split('\n')
                        .map((line) => ({ type: 'paragraph', children: [{ text: line }] }));
                      setMessage(value);
                      editorRef.current?.replaceEditorValue?.(value);
                    }}
                  />

                  {/* Fills the composer the same way AI Writing does, and for
                      the same reason: a suggestion is a starting point someone
                      can edit, never a message that has been sent. */}
                  <AiReplySuggestions
                    messages={replySuggestionMessages}
                    disabled={isComposerBusy}
                    onSelect={(text) => {
                      const value = String(text)
                        .split('\n')
                        .map((line) => ({ type: 'paragraph', children: [{ text: line }] }));
                      setMessage(value);
                      editorRef.current?.replaceEditorValue?.(value);
                    }}
                  />

                  {showAiAssistTrigger ? (
                    hasAiAssistAgent ? (
                      <div
                        className={cn(
                          'cursor-pointer min-w-6 max-h-6 max-w-6 min-h-6 rounded-2xl flex justify-center items-center text-gray-500 hover:text-ucass-active transition-colors',
                          isComposerBusy ? 'cursor-not-allowed opacity-50' : '',
                        )}
                        onClick={() => {
                          if (!isComposerBusy) {
                            toggleAiAssistOpen();
                          }
                        }}
                        title="AI Assist"
                      >
                        <Sparkles width={18} height={18} />
                      </div>
                    ) : (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            disabled={isComposerBusy}
                            className={cn(
                              'min-w-6 max-h-6 max-w-6 min-h-6 rounded-2xl flex justify-center items-center text-gray-500 hover:text-ucass-active transition-colors',
                              isComposerBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                            )}
                            aria-label="Set up AI assist agent"
                            title="AI Assist setup required"
                          >
                            <Sparkles width={18} height={18} />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[calc(100vw-2rem)] max-w-80 p-0 overflow-hidden rounded-xl border border-gray-200/80 shadow-xl"
                          side="top"
                        >
                          <div className="border-b border-gray-100 bg-gradient-to-br from-sky-50 to-indigo-50 px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white bg-white/80 shadow-sm">
                                <Sparkles className="h-4 w-4 text-ucass-active" />
                              </span>
                              <p className="text-sm font-semibold text-gray-900">AI Assist Setup</p>
                            </div>
                          </div>
                          <div className="space-y-3 p-3">
                            <p className="text-xs leading-5 text-gray-600">
                              Set up an agent in AI Settings to start using AI-generated assistance.
                            </p>
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                size={'sm'}
                                className="rounded-md bg-ucass-active px-2.5 max-h- text-[11px] font-medium text-white hover:bg-ucass-active focus:bg-ucass-active active:bg-ucass-active"
                                onClick={() => navigate('/admin-settings/knowledge/ai-settings')}
                              >
                                Open AI Settings
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )
                  ) : null}

                  <button
                    type="button"
                    className={cn(
                      'min-w-7 max-h-7 max-w-7 min-h-7 flex justify-center items-center text-ucass-active border-l border-gray-200 pl-2 transition-colors',
                      !canSend || isComposerBusy
                        ? 'cursor-not-allowed opacity-50'
                        : 'cursor-pointer hover:text-primary',
                    )}
                    onClick={() => sendMessage()}
                    disabled={!canSend || isComposerBusy}
                    aria-label="Send message"
                  >
                    {isUploadingAttachments ? (
                      <Loader variant="blue" size="sm" />
                    ) : (
                      <SendHorizontal width={18} height={18} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!isGuestRestrictedFooter ? (
        <CreatePollModal
          open={isPollModalOpen}
          onOpenChange={setIsPollModalOpen}
          onSend={sendPollMessage}
        />
      ) : null}

      {!fromMeetChat && !isGuestRestrictedFooter && canScheduleEvent && isEventModalOpen && (
        <SideDrawer
          isOpen={isEventModalOpen}
          title="Create Event"
          handleClose={() => setIsEventModalOpen(false)}
          content={
            <CreateEvent
              setDrawerState={setIsEventModalOpen}
              currentChat={currentChat}
              msgObj={messageItemAction?.msgObj}
              initialData={messageItemAction?.msgObj?.event}
            />
          }
          isHeader={true}
          width="45%"
        />
      )}

      {!hasAttachmentPreview && renderAiAssistInline && isAiAssistOpen && hasAiAssistAgent ? (
        <AiAssist
          lineHeight="leading-7"
          onClose={() => setAiAssistOpen(false)}
          type={AI_SETTINGS_TYPES.CHAT_ASSISTANT}
          chatId={currentChat?.chatId || ''}
          aiSettings={aiSettings}
          prefillText={lastIncomingPrefill}
        />
      ) : null}
    </div>
  );
};

const mergeThreadMessages = (base: any[], extra: any[]) => {
  const map = new Map<string, any>();
  [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])].forEach(
    (message: any) => {
      const id = message?.messageId || message?._id;
      if (!id) return;
      map.set(id, message);
    },
  );

  return Array.from(map.values()).sort((a: any, b: any) => {
    const ta = new Date(a?.createdAt || 0).getTime();
    const tb = new Date(b?.createdAt || 0).getTime();
    return ta - tb;
  });
};

console.log(mergeThreadMessages);

const mergeChatMessages = (base: any[], extra: any[]) => {
  const map = new Map<string, any>();
  [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])].forEach(
    (message: any) => {
      const id = message?.messageId || message?._id;
      if (!id) return;
      map.set(id, message);
    },
  );

  return Array.from(map.values()).sort((a: any, b: any) => {
    const ta = new Date(a?.createdAt || 0).getTime();
    const tb = new Date(b?.createdAt || 0).getTime();
    return ta - tb;
  });
};

const ThreadPanel = ({
  threadInfo,
  currentChat,
  mentionUsers,
  onClose,
  onMessageAction,
  messageItemAction,
  setMessageItemAction,
  fromMeetChat = false,
  isAgentChat = false,
}: {
  threadInfo: any;
  currentChat: any;
  mentionUsers?: any[];
  onClose: () => void;
  onMessageAction?: (action: MessageActionType, messageObj: any) => void;
  messageItemAction: MessageItemActionState;
  setMessageItemAction: (state: MessageItemActionState) => void;
  fromMeetChat?: boolean;
  isAgentChat?: boolean;
}) => {
  const { socketEventsManager, threadsManager, setThreadsManager, messageList } = useSocketEvents();
  const [isLoading, setIsLoading] = useState(false);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);

  const activeThreadMessage = useMemo(() => {
    try {
      const currentList = (Array.isArray(messageList) ? messageList : []).find(
        (list: any) => list?.chatId === currentChat?.chatId,
      );
      const foundMessage = Array.isArray(currentList?.messages)
        ? currentList.messages.find((msg: any) => msg?.messageId === threadInfo?.messageId)
        : null;
      return foundMessage || threadInfo;
    } catch (error) {
      console.error('Error finding activeThreadMessage', error);
      return threadInfo;
    }
  }, [messageList, currentChat?.chatId, threadInfo]);

  const currentThread = useMemo(() => {
    try {
      if (!threadsManager || !Array.isArray(threadsManager)) return [];
      if (!threadInfo || !threadInfo?.messageId) return [];

      const foundThread = threadsManager.find(
        (thread: any) => thread?.parentMsgId === threadInfo?.messageId,
      );

      if (!foundThread) return [];

      return (Array.isArray(foundThread?.messages) ? foundThread.messages : []).filter(
        (msg: any) => !msg?.isDeleted && msg?.messageId !== threadInfo?.messageId,
      );
    } catch (error) {
      console.error('Error accessing currentThread:', error);
      return [];
    }
  }, [threadInfo?.messageId, threadsManager]);

  useEffect(() => {
    if (!socketEventsManager || !threadInfo?.messageId) return;

    try {
      setIsLoading(true);
      socketEventsManager.emit(
        chatEvents.THREAD_LIST,
        {
          parentMsgId: threadInfo?.messageId,
        },
        (data: any) => {
          try {
            const responseData = Array.isArray(data) ? data[0] : data;
            if (responseData?.status === 200 || responseData?.response?.status === 200) {
              const result = responseData?.data?.result?.threads || responseData?.result?.threads;
              const newMessages = Array.isArray(result) ? result : [];

              setThreadsManager((prevData: any) => {
                const existingList = Array.isArray(prevData) ? prevData : [];
                const withoutCurrentThread = existingList.filter(
                  (thread: any) => thread?.parentMsgId !== threadInfo?.messageId,
                );

                return [
                  ...withoutCurrentThread,
                  {
                    chatId: threadInfo?.chatId || currentChat?.chatId,
                    parentMsgId: threadInfo?.messageId,
                    messages: newMessages,
                  },
                ];
              });
            }
          } catch (error) {
            console.error('Failed to parse thread list:', error);
          } finally {
            setIsLoading(false);
          }
        },
      );
    } catch (error) {
      console.error('Failed to fetch thread list:', error);
      setIsLoading(false);
    }
  }, [
    socketEventsManager,
    threadInfo?.messageId,
    threadInfo?.chatId,
    currentChat?.chatId,
    setThreadsManager,
  ]);

  useEffect(() => {
    if (currentThread.length > 0 && lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [currentThread.length]);

  return (
    <div
      className={`relative bg-white flex flex-col w-full h-full min-h-0 ${fromMeetChat ? 'min-w-0' : ''}`}
    >
      {messageItemAction?.action === 'delete' && (
        <DeleteMessageItem
          msgObj={messageItemAction?.msgObj}
          currentChat={currentChat}
          handleClose={() => setMessageItemAction({ action: '', msgObj: null })}
        />
      )}
      <div className="w-full shrink-0 px-4 bg-white flex items-center justify-between border-b min-h-[56px] lg:min-h-[65px] border-b-gray-200">
        <div className="cursor-pointer" onClick={onClose}>
          <div className="flex gap-2 items-center ">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
            <h3 className="text-sm lg:text-base font-semibold text-gray-900">Thread</h3>
          </div>
        </div>
      </div>

      <div className="p-3 overflow-y-auto overflow-x-hidden flex-1 ">
        <MessageItem
          msgObj={activeThreadMessage}
          currentChat={currentChat}
          isFirstInGroup={true}
          fromThread={true}
          onMessageAction={onMessageAction}
          isAgentChat={isAgentChat}
        />

        <div className="w-full max-w-44 mx-auto relative h-[1px] bg-gray-200 flex justify-center items-center my-6">
          <div className="bg-gray-100 px-3 py-1 absolute -top-3 text-gray-600 text-xs rounded-full border">
            {Array.isArray(threadsManager) &&
            threadsManager.some((t: any) => t?.parentMsgId === threadInfo?.messageId)
              ? currentThread.length
              : activeThreadMessage?.threadReplyCount || 0}{' '}
            replies
          </div>
        </div>

        {isLoading ? (
          <div className="w-full flex items-center justify-center py-6 text-gray-500 text-xs">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading thread...
          </div>
        ) : null}

        {!isLoading
          ? currentThread.map((message: any, index: number) => (
              <div
                key={message?.messageId || `thread-msg-${index}`}
                ref={index === currentThread.length - 1 ? lastMessageRef : null}
              >
                <MessageItem
                  msgObj={message}
                  currentChat={currentChat}
                  isFirstInGroup={true}
                  fromThread={true}
                  onMessageAction={onMessageAction}
                  isAgentChat={isAgentChat}
                />
              </div>
            ))
          : null}
      </div>

      {threadInfo?.messageType !== 'prompt' ? (
        <ChatFooter
          currentChat={currentChat}
          mentionUsers={mentionUsers}
          // typingText={typingText}
          parentMsgId={threadInfo?.messageId || ''}
          messageItemAction={messageItemAction}
          setMessageItemAction={setMessageItemAction}
          fromMeetChat={fromMeetChat}
          isAgentChat={isAgentChat}
        />
      ) : null}
    </div>
  );
};

const AddMemberDialog = ({
  isOpen,
  onClose,
  currentChat,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentChat: any;
}) => {
  const { user } = useUser();
  const { handleAddChannelMember } = useSocketEvents();
  const [selectedMembers, setSelectedMembers] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const debouncedUserSearch = useDebounce(userSearch, 300);
  const {
    users: userListing,
    fetchNextPage,
    hasNextPage = false,
    isFetchingNextPage,
    isLoading: isLoadingUsers,
  } = useMessengerUsers({
    search: debouncedUserSearch,
    enabled: isOpen,
  });

  const formattedMembers = useMemo(() => {
    const alreadyMemberUuids = (currentChat?.users || []).map((m: any) => m?.uuid);
    return (
      userListing
        ?.filter(
          (item: any) => item?.uuid !== user?.uuid && !alreadyMemberUuids.includes(item?.uuid),
        )
        ?.map((item: any) => ({
          ...item,
          label: `${item?.first_name || ''} ${item?.last_name || ''}`.trim(),
          value: item?.extension,
          uuid: item?.uuid,
        })) || []
    );
  }, [userListing, user?.uuid, currentChat?.users]);

  const handleSubmit = async () => {
    if (selectedMembers.length === 0) {
      toast.error('Please select at least one member');
      return;
    }

    setIsSubmitting(true);
    try {
      const membersToEmit = selectedMembers.map((m: any) => ({
        uuid: m?.uuid,
        name: m?.label || `${m?.first_name || ''} ${m?.last_name || ''}`.trim(),
        email: m?.email,
        extension: m?.extension || m?.value,
        agencyId: '',
        agencyName: '',
      }));

      handleAddChannelMember(currentChat?.chatId, membersToEmit);
      toast.success('Members added successfully');
      onClose();
    } catch (error) {
      console.error('Failed to add members:', error);
      toast.error('Failed to add members');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Add Team Members</DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            Select members to add to "{currentChat?.name || 'this team'}".
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Select Members
            </label>
            <CustomSelect
              isMulti
              options={formattedMembers}
              value={selectedMembers}
              handleChange={(val: any) => setSelectedMembers(val)}
              placeholder="Search by name or extension..."
              inputClass="team_chat"
              FormatOptionLabel={ExtensionListView}
              isLoading={isLoadingUsers || isFetchingNextPage}
              onInputChange={setUserSearch}
              onMenuScrollToBottom={() => {
                if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
              }}
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || selectedMembers.length === 0}>
            {isSubmitting ? <Loader /> : 'Add Members'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
const PinnedMessagesView = ({
  currentChat,
  onClose,
  onJumpToMessage,
}: {
  currentChat: any;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}) => {
  const { user } = useUser();
  const { pinnedList, getChatPinnedMessages } = useSocketEvents();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (currentChat?.chatId) {
      setIsLoading(true);
      getChatPinnedMessages(currentChat.chatId, () => {
        setIsLoading(false);
      });
    }
  }, []);

  const pinnedItems = useMemo(() => {
    const currentPinned = (Array.isArray(pinnedList) ? pinnedList : []).find(
      (list: any) => list?.chatId === currentChat?.chatId,
    );
    return Array.isArray(currentPinned?.chats) ? currentPinned.chats : [];
  }, [pinnedList, currentChat?.chatId]);

  const resolveSenderName = useCallback(
    (senderId: string) => {
      if (!senderId) return 'Unknown User';
      if (senderId === user?.uuid) return 'You';
      const sender = (Array.isArray(currentChat?.users) ? currentChat.users : []).find(
        (chatUser: any) => chatUser?.uuid === senderId,
      );
      return sender?.name || 'Unknown User';
    },
    [currentChat?.users, user?.uuid],
  );
  console.log(resolveSenderName);

  return (
    <div className="w-full flex flex-col h-full bg-[var(--color-bg-gray-50)] overflow-hidden">
      <div className="w-full shrink-0 px-4 bg-white flex items-center justify-between border-b min-h-[56px] lg:min-h-[65px] border-b-gray-200">
        <div className="cursor-pointer" onClick={onClose}>
          <div className="flex gap-2 items-center ">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
            <h3 className="text-sm lg:text-base font-semibold text-gray-900">Pinned Messages</h3>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 w-full bg-[var(--color-bg-gray-50)] p-3 flex items-center justify-center min-h-0 overflow-hidden">
          <div className="w-full flex items-center justify-center py-6 text-gray-500 text-xs">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading pinned messages...
          </div>
        </div>
      ) : pinnedItems.length === 0 ? (
        <div className="flex-1 w-full bg-[var(--color-bg-gray-50)] p-3 flex items-center justify-center min-h-0 overflow-hidden">
          <div className="flex flex-col justify-center items-center gap-2 py-5 h-full w-full mx-auto">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-2">
              <Pin className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-base font-semibold text-gray-900">No pinned messages yet</p>
            <p className="text-sm text-center text-gray-500 max-w-xs">
              Messages you pin in this chat will appear here for easy access.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 w-full bg-white lg:bg-[var(--color-bg-gray-50)] p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto pr-2 pb-2">
            <div className="flex flex-col gap-4">
              {pinnedItems?.map((message: any, index: number) => {
                return (
                  <div
                    key={message?.messageId || `pinned-${index}`}
                    className="w-full cursor-pointer relative group"
                    onClick={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest('button, a, input, textarea, select, [role="button"]')) {
                        return;
                      }
                      onJumpToMessage(message?.messageId);
                    }}
                  >
                    <div>
                      <MessageItem
                        msgObj={message}
                        currentChat={currentChat}
                        isFirstInGroup={true}
                        isPinnedView={true}
                        isAgentChat={false}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const FilesView = ({
  currentChat,
  onClose,
  onJumpToMessage,
}: {
  currentChat: any;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}) => {
  const { user } = useUser();
  const { messageList } = useSocketEvents();
  console.log(user);

  const currentMessages = useMemo(() => {
    const current = (Array.isArray(messageList) ? messageList : []).find(
      (list: any) => list?.chatId === currentChat?.chatId,
    );
    const list = Array.isArray(current?.messages) ? current.messages : [];
    return list
      .filter((message: any) => !message?.isDeleted && !message?.parentMsgId)
      .sort((a: any, b: any) => {
        const ta = new Date(a?.createdAt || 0).getTime();
        const tb = new Date(b?.createdAt || 0).getTime();
        return tb - ta;
      });
  }, [messageList, currentChat?.chatId]);

  const fileMessages = useMemo(() => {
    return currentMessages.filter((message: any) => {
      const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
      return attachments.length > 0;
    });
  }, [currentMessages]);

  return (
    <div className="w-full flex flex-col h-full bg-[var(--color-bg-gray-50)] overflow-hidden">
      <div className="w-full shrink-0 px-4 bg-white flex items-center justify-between border-b min-h-[56px] lg:min-h-[65px] border-b-gray-200">
        <div className="cursor-pointer" onClick={onClose}>
          <div className="flex gap-2 items-center">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
            <h3 className="text-sm lg:text-base font-semibold text-gray-900">Files</h3>
          </div>
        </div>
      </div>

      {fileMessages.length === 0 ? (
        <div className="flex-1 w-full bg-[var(--color-bg-gray-50)] p-3 flex items-center justify-center min-h-0 overflow-hidden">
          <div className="flex flex-col justify-center items-center gap-2 py-5 h-full w-full mx-auto">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-2">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-base font-semibold text-gray-900">No files yet</p>
            <p className="text-sm text-center text-gray-500 max-w-xs">
              Files shared in this chat will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 w-full bg-white lg:bg-[var(--color-bg-gray-50)] p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto pr-2 pb-2">
            <div className="flex flex-col gap-4">
              {fileMessages.map((message: any, index: number) => (
                <div
                  key={message?.messageId || `file-msg-${index}`}
                  className="w-full cursor-pointer relative group"
                  onClick={() => onJumpToMessage(message?.messageId)}
                >
                  <div className="pointer-events-none group-hover:pointer-events-auto">
                    <MessageItem
                      msgObj={message}
                      currentChat={currentChat}
                      isFirstInGroup={true}
                      isFilesView={true}
                      isAgentChat={false}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MembersView = ({ currentChat, onClose }: { currentChat: any; onClose: () => void }) => {
  console.log('🚀 ~ MembersView ~ currentChat:', currentChat);
  const { user } = useUser();
  const { handleRemoveChannelMember, handleAssignAdminPrivileges } = useSocketEvents();
  const { getUserProfileByUuid } = useUsersDirectory();
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedUuids, setSelectedUuids] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const isAdmin = useMemo(() => {
    return (
      (Array.isArray(currentChat?.admins) && currentChat.admins.includes(user?.uuid)) ||
      (Array.isArray(currentChat?.subAdmins) && currentChat.subAdmins.includes(user?.uuid))
    );
  }, [currentChat?.admins, currentChat?.subAdmins, user?.uuid]);

  const members = useMemo(() => {
    const rawUsers = Array.isArray(currentChat?.users) ? currentChat.users : [];
    if (currentChat?.groupType === 'MEETING') {
      return rawUsers.filter((u: any) => !u?.isGuest || u?.callStatus === 'joined');
    }
    return rawUsers;
  }, [currentChat?.users, currentChat?.groupType]);

  const removableMembers = useMemo(() => {
    return members.filter((member: any) => {
      const isMainAdmin = currentChat?.admins?.[0] === member?.uuid;
      const isCurrentUser = member?.uuid === user?.uuid;
      return !isCurrentUser && !isMainAdmin;
    });
  }, [members, currentChat?.admins, user?.uuid]);

  const isAllSelected = useMemo(() => {
    return removableMembers.length > 0 && selectedUuids.length === removableMembers.length;
  }, [removableMembers, selectedUuids]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedUuids([]);
    } else {
      setSelectedUuids(removableMembers.map((m: any) => m.uuid));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedUuids.length === 0) return;
    setIsDeleting(true);
    try {
      handleRemoveChannelMember(currentChat?.chatId, selectedUuids, (response: any) => {
        console.log('Remove selected members response:', response);
        toast.success(`${selectedUuids.length} member(s) removed successfully`);
        setIsSelectMode(false);
        setSelectedUuids([]);
        setIsDeleting(false);
      });
    } catch (error) {
      console.error('Failed to remove selected members:', error);
      toast.error('Failed to remove selected members');
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-full flex flex-col h-full bg-[var(--color-bg-gray-50)] overflow-hidden">
      <div className="w-full shrink-0 px-4 bg-white flex items-center justify-between border-b min-h-[56px] lg:min-h-[65px] border-b-gray-200">
        <div className="cursor-pointer" onClick={onClose}>
          <div className="flex gap-2 items-center ">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
            <h3 className="text-sm lg:text-base font-semibold text-gray-900">Members</h3>
          </div>
        </div>
        {isAdmin && !currentChat?.allowFallbackChat && (
          <div className="flex items-center gap-2">
            {isSelectMode ? (
              <>
                <Button
                  size="sm"
                  className="text-xs h-8 cursor-pointer"
                  onClick={handleToggleSelectAll}
                  disabled={isDeleting}
                >
                  {isAllSelected ? 'Deselect All' : 'Select All'}
                </Button>
                <Button
                  size="sm"
                  className="text-xs h-8 cursor-pointer"
                  onClick={() => {
                    setIsSelectMode(false);
                    setSelectedUuids([]);
                  }}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="text-xs h-8 font-semibold  cursor-pointer"
                  onClick={handleDeleteSelected}
                  disabled={selectedUuids.length === 0 || isDeleting}
                >
                  {isDeleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                  )}
                  Remove ({selectedUuids.length})
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8 font-semibold cursor-pointer"
                onClick={() => setIsSelectMode(true)}
              >
                Select Multiple
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 w-full bg-white lg:bg-[var(--color-bg-gray-50)] p-4 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto pr-2 pb-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4">
            {members.map((member: any, index: number) => {
              const isMemberAdmin =
                currentChat?.admins?.includes(member?.uuid) ||
                currentChat?.subAdmins?.includes(member?.uuid);
              const memberType = String(member?.type || '')
                .trim()
                .toUpperCase();
              const memberRoleLabel =
                memberType === 'ADMIN'
                  ? 'Host'
                  : memberType === 'USER'
                    ? 'Member'
                    : memberType === 'GUEST'
                      ? 'Guest'
                      : '';
              const isMainAdmin = currentChat?.admins?.[0] === member?.uuid;
              const isCurrentUser = member?.uuid === user?.uuid;
              const canBeRemoved = !isCurrentUser && !isMainAdmin;
              const isSelected = selectedUuids.includes(member?.uuid);

              const handleToggleSelectCard = () => {
                if (isSelectMode && canBeRemoved) {
                  setSelectedUuids((prev) =>
                    prev.includes(member?.uuid)
                      ? prev.filter((uuid) => uuid !== member?.uuid)
                      : [...prev, member?.uuid],
                  );
                }
              };

              return (
                <div
                  key={member?.uuid || `member-${index}`}
                  className={cn(
                    'flex flex-col gap-2 p-3 rounded-lg border transition-all bg-white shadow-sm',
                    isSelectMode && canBeRemoved ? 'cursor-pointer' : '',
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-gray-200 hover:bg-gray-50',
                  )}
                  onClick={handleToggleSelectCard}
                >
                  <div className="flex items-center gap-3">
                    <CustomAvatar
                      name={
                        member?.name ||
                        `${member?.first_name || ''} ${member?.last_name || ''}`.trim()
                      }
                      extension={member?.extension}
                      size="40"
                      showPresence={true}
                      image={
                        member?.profile ||
                        member?.avatar ||
                        getUserProfileByUuid(member?.uuid) ||
                        ''
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-900 truncate">
                        {member?.name ||
                          `${member?.first_name || ''} ${member?.last_name || ''}`.trim()}
                        {isCurrentUser && (
                          <span className="ml-2 text-xs text-ucass-active font-bold bg-ucass-active-bg px-1.5 py-0.5 rounded">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate mt-0.5">
                        {member?.email || member?.extension}
                      </div>
                    </div>
                    {memberRoleLabel && !isSelectMode && (
                      <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-2 py-1 rounded-full uppercase tracking-wider">
                        {memberRoleLabel}
                      </span>
                    )}
                    {isSelectMode && canBeRemoved && (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={handleToggleSelectCard}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      />
                    )}
                  </div>

                  {isAdmin &&
                    !isCurrentUser &&
                    !currentChat?.allowFallbackChat &&
                    !isSelectMode && (
                      <div className="flex gap-2 pt-2 border-t border-gray-100 mt-1">
                        <button
                          type="button"
                          className="cursor-pointer flex-1 min-h-8 flex items-center justify-center gap-1.5 rounded-md bg-ucass-active-bg text-ucass-active text-xs font-semibold hover:bg-ucass-active-bg transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isMainAdmin) {
                              toast.error('You could not remove main admin');
                            } else {
                              handleAssignAdminPrivileges(currentChat?.chatId, member?.uuid);
                            }
                          }}
                        >
                          <UserCog className="w-3.5 h-3.5" />
                          {isMemberAdmin ? 'Revoke' : 'Make'} Admin
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer flex-1 min-h-8 flex items-center justify-center gap-1.5 rounded-md bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isMainAdmin) {
                              toast.error('You could not remove main admin');
                            } else {
                              handleRemoveChannelMember(currentChat?.chatId, [member?.uuid]);
                            }
                          }}
                        >
                          <X className="w-3.5 h-3.5" /> Remove
                        </button>
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        </div>

        {isAdmin && !currentChat?.allowFallbackChat && (
          <div className="pt-3 mt-3 border-t border-gray-200 shrink-0">
            <Button
              type="button"
              className="w-full text-sm h-11 font-semibold cursor-pointer"
              onClick={() => setIsAddMemberOpen(true)}
            >
              <UserPlus className="w-4 h-4 mr-2" /> Add Member
            </Button>
          </div>
        )}

        {isAddMemberOpen && (
          <AddMemberDialog
            isOpen={isAddMemberOpen}
            onClose={() => setIsAddMemberOpen(false)}
            currentChat={currentChat}
          />
        )}
      </div>
    </div>
  );
};

type ChatWorkspaceProps = {
  chatId?: string;
  fromMeetChat?: boolean;
  mentionUsers?: any[];
  onBackToList?: () => void;
  mode: ChatMode;
  uiOverrides?: ChatUiOverrides;
  allowFallbackChat?: boolean;
  fallbackChat?: FallbackChatMeta;
  disableMessageHoverActions?: boolean;
  disableRouteMaxHeight?: boolean;
  hideFooter?: boolean;
  hiddenHeaderActions?: HeaderActionType[];
  disableCallActions?: boolean;
  disableInitialMessageFetch?: boolean;
};

export type ChatProps = {
  chatId?: string;
  fromMeetChat?: boolean;
  mentionUsers?: any[];
  isAgentChat?: boolean;
  onBackToList?: () => void;
  uiOverrides?: ChatUiOverrides;
  allowFallbackChat?: boolean;
  fallbackChat?: FallbackChatMeta;
  disableMessageHoverActions?: boolean;
  disableRouteMaxHeight?: boolean;
  hideFooter?: boolean;
  hiddenHeaderActions?: HeaderActionType[];
  disableCallActions?: boolean;
  disableInitialMessageFetch?: boolean;
};

export type AgentChatProps = {
  chatId?: string;
  fromMeetChat?: boolean;
  mentionUsers?: any[];
  onBackToList?: () => void;
  uiOverrides?: ChatUiOverrides;
  allowFallbackChat?: boolean;
  fallbackChat?: FallbackChatMeta;
  disableMessageHoverActions?: boolean;
  disableRouteMaxHeight?: boolean;
  hideFooter?: boolean;
  hiddenHeaderActions?: HeaderActionType[];
  disableCallActions?: boolean;
  disableInitialMessageFetch?: boolean;
};

const ChatWorkspace = ({
  chatId = '',
  fromMeetChat = false,
  mentionUsers,
  onBackToList,
  mode,
  uiOverrides,
  allowFallbackChat = false,
  fallbackChat,
  disableMessageHoverActions = false,
  disableRouteMaxHeight = false,
  hideFooter = false,
  hiddenHeaderActions = [],
  disableCallActions = false,
  disableInitialMessageFetch = false,
}: ChatWorkspaceProps) => {
  const isAgentChat = mode === 'agent';
  const chatFeatures = useMemo<ChatFeatureFlags>(() => resolveChatFeatures(mode), [mode]);
  const canUseMessageHoverActions =
    chatFeatures.canUseMessageHoverActions && !disableMessageHoverActions;
  const HeaderComponent = uiOverrides?.Header || ChatHeader;
  const MessagesComponent = uiOverrides?.Messages || Messages;
  const FooterComponent = uiOverrides?.Footer || ChatFooter;
  const MessageItemComponent = uiOverrides?.MessageItem || MessageItem;
  const { user } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const meetingActorUuid = user?.uuid || user?.guest_info?.uuid || '';
  const {
    allChats = [],
    typingList = {},
    handleGetMessageByChatId,
    handleUnread,
    setMessageList,
    messageList,
  } = useSocketEvents();

  const disableScrollTop = useRef<boolean>(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [threadInfo, setThreadInfo] = useState<any>(null);
  const [sidePanelMode, setSidePanelMode] = useState<SidebarMode>(null);

  const [mainMessageItemAction, setMainMessageItemAction] = useState<MessageItemActionState>({
    action: '',
    msgObj: null,
  });

  const [threadMessageItemAction, setThreadMessageItemAction] = useState<MessageItemActionState>({
    action: '',
    msgObj: null,
  });
  const requestedInitialMeetMessagesRef = useRef<Record<string, boolean>>({});
  const pendingNotificationBottomScrollRef = useRef('');

  const [showForwardModal, setShowForwardModal] = useState<any>(null);
  const [isMessageSelectionMode, setIsMessageSelectionMode] = useState(false);
  const [selectedForwardMessages, setSelectedForwardMessages] = useState<any[]>([]);
  const [createTaskMsgObj, setCreateTaskMsgObj] = useState<any>(null);
  const isDesktopAiLayout = useMediaQuery('(min-width: 1280px)');
  const [isAiAssistPanelOpen, setIsAiAssistPanelOpen] = useState(false);
  const [aiAssistPanelContext, setAiAssistPanelContext] = useState<ChatFooterAiAssistContext>({
    hasAiAssistAgent: false,
    aiSettings: [],
    prefillText: '',
    chatId: '',
    lineHeight: 'leading-7',
    type: AI_SETTINGS_TYPES.CHAT_ASSISTANT,
  });
  const handleAiAssistContextChange = useCallback((nextContext: ChatFooterAiAssistContext) => {
    setAiAssistPanelContext((prevContext) => {
      const prevSettings = Array.isArray(prevContext?.aiSettings) ? prevContext.aiSettings : [];
      const nextSettings = Array.isArray(nextContext?.aiSettings) ? nextContext.aiSettings : [];

      const areSettingsSame =
        prevSettings.length === nextSettings.length &&
        prevSettings.every((item: any, index: number) => {
          const compareItem = nextSettings[index];
          return (
            item === compareItem ||
            (item?.agentId || '') === (compareItem?.agentId || '') ||
            (item?.uuid || '') === (compareItem?.uuid || '')
          );
        });

      const isSameContext =
        prevContext?.hasAiAssistAgent === nextContext?.hasAiAssistAgent &&
        prevContext?.prefillText === nextContext?.prefillText &&
        prevContext?.chatId === nextContext?.chatId &&
        prevContext?.lineHeight === nextContext?.lineHeight &&
        prevContext?.type === nextContext?.type &&
        areSettingsSame;

      if (isSameContext) return prevContext;

      return {
        ...prevContext,
        ...nextContext,
      };
    });
  }, []);
  console.log(createTaskMsgObj, 'createTaskMsgObjcreateTaskMsgObj');

  const currentChat = useMemo(() => {
    const existingChat = (Array.isArray(allChats) ? allChats : []).find(
      (chat: any) => chat?.chatId === chatId,
    );
    if (existingChat) {
      if (!allowFallbackChat) return existingChat;

      const fallbackUsers = Array.isArray(fallbackChat?.users) ? fallbackChat.users : [];
      const getMemberId = (member: any) =>
        String(member?.uuid || member?.user_uuid || member?.userId || '').trim();
      const fallbackUsersById = new Map(
        fallbackUsers
          .map((member: any) => [getMemberId(member), member] as const)
          .filter(([memberId]) => Boolean(memberId)),
      );
      const existingUsers = Array.isArray(existingChat?.users) ? existingChat.users : [];
      const existingUserIds = new Set(existingUsers.map(getMemberId).filter(Boolean));
      const users = [
        ...existingUsers.map((member: any) => {
          const fallbackMember = fallbackUsersById.get(getMemberId(member));
          if (!fallbackMember?.type || member?.type) return member;
          return { ...member, type: fallbackMember.type };
        }),
        ...fallbackUsers.filter((member: any) => !existingUserIds.has(getMemberId(member))),
      ];

      return {
        ...existingChat,
        users,
        allowFallbackChat: true,
      };
    }
    if (!allowFallbackChat || !chatId) return undefined;

    return {
      chatId,
      name: fallbackChat?.name || 'Meeting Chat',
      description: fallbackChat?.description || '',
      users: Array.isArray(fallbackChat?.users) ? fallbackChat.users : [],
      isGroupChat: true,
      allowFallbackChat,
    };
  }, [
    allChats,
    chatId,
    allowFallbackChat,
    fallbackChat?.name,
    fallbackChat?.description,
    fallbackChat?.users,
  ]);

  useEffect(() => {
    if (!fromMeetChat || !chatId || !meetingActorUuid) return;
    if (typeof handleGetMessageByChatId !== 'function') return;

    const hasMessagesForChat = (Array.isArray(messageList) ? messageList : []).some(
      (item: any) => item?.chatId === chatId,
    );
    if (hasMessagesForChat) return;
    if (requestedInitialMeetMessagesRef.current?.[chatId]) return;
    requestedInitialMeetMessagesRef.current[chatId] = true;

    handleGetMessageByChatId({
      chatId,
      userId: meetingActorUuid,
    });
  }, [chatId, fromMeetChat, handleGetMessageByChatId, meetingActorUuid, messageList]);

  useEffect(() => {
    const openFromNotification = searchParams.get('openFromNotification') === '1';
    if (!openFromNotification) return;
    if (!chatId || !currentChat?.chatId || !meetingActorUuid) return;
    if (String(chatId) !== String(currentChat.chatId)) return;
    if (pendingNotificationBottomScrollRef.current === String(currentChat.chatId)) return;

    pendingNotificationBottomScrollRef.current = String(currentChat.chatId);
    handleGetMessageByChatId({
      chatId: String(currentChat.chatId),
      userId: meetingActorUuid,
    });
    handleUnread(
      {
        chatId: String(currentChat.chatId),
        type: 'read',
      },
      true,
    );

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('openFromNotification');
      next.delete('targetMessageId');
      return next;
    });
  }, [
    chatId,
    currentChat?.chatId,
    handleGetMessageByChatId,
    handleUnread,
    meetingActorUuid,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    if (
      !currentChat?.chatId ||
      pendingNotificationBottomScrollRef.current !== String(currentChat.chatId)
    ) {
      return;
    }

    const currentChatMessages = (Array.isArray(messageList) ? messageList : []).find(
      (item: any) => String(item?.chatId || '') === String(currentChat.chatId),
    );
    if (!currentChatMessages) return;

    window.setTimeout(() => {
      const messageContainer = document.getElementById(String(currentChat.chatId || ''));
      if (messageContainer) {
        messageContainer.scrollTo({
          top: messageContainer.scrollHeight,
          behavior: 'smooth',
        });
      }
      pendingNotificationBottomScrollRef.current = '';
    }, 120);
  }, [currentChat?.chatId, messageList]);

  const typingText = useMemo(() => {
    if (!currentChat?.chatId) return '';
    const typingUsers = Array.isArray(typingList?.[currentChat.chatId])
      ? typingList[currentChat.chatId]
      : [];
    if (!typingUsers.length) return '';

    const names = (Array.isArray(currentChat?.users) ? currentChat.users : [])
      .filter(
        (chatUser: any) =>
          typingUsers.includes(chatUser?.uuid) && chatUser?.uuid !== meetingActorUuid,
      )
      .map(
        (chatUser: any) =>
          chatUser?.name || `${chatUser?.first_name || ''} ${chatUser?.last_name || ''}`.trim(),
      )
      .filter(Boolean);

    return names.length ? `${names.join(', ')} typing...` : 'Typing...';
  }, [typingList, currentChat?.chatId, currentChat?.users, meetingActorUuid]);

  const isAuxSidebarOpen = useMemo(
    () =>
      sidePanelMode === 'notes' ||
      sidePanelMode === 'folders' ||
      sidePanelMode === 'description' ||
      sidePanelMode === 'pinned' ||
      sidePanelMode === 'files' ||
      sidePanelMode === 'thread' ||
      sidePanelMode === 'call-details' ||
      sidePanelMode === 'members',
    [sidePanelMode],
  );

  useEffect(() => {
    setShowSearch(false);
    setSearchQuery('');
    setThreadInfo(null);
    setSidePanelMode(null);
    // setMainMessageItemAction({ action: '', msgObj: null });
    setThreadMessageItemAction({ action: '', msgObj: null });
    setShowForwardModal(null);
    setIsMessageSelectionMode(false);
    setSelectedForwardMessages([]);
    setIsAiAssistPanelOpen(false);
  }, [currentChat?.chatId]);

  useEffect(() => {
    if (chatFeatures.canUseSidebarActions) return;
    setSidePanelMode(null);
  }, [chatFeatures.canUseSidebarActions]);

  useEffect(() => {
    if (!isAuxSidebarOpen) return;
    setIsAiAssistPanelOpen(false);
  }, [isAuxSidebarOpen]);

  const handleToggleMessageSelection = useCallback((message: any, checked: boolean) => {
    const messageId = getStableMessageId(message);
    if (!messageId) return;
    setSelectedForwardMessages((prev: any[]) => {
      const safePrev = Array.isArray(prev) ? prev : [];
      const withoutCurrent = safePrev.filter((item: any) => getStableMessageId(item) !== messageId);
      if (!checked) return withoutCurrent;
      return [...withoutCurrent, message];
    });
  }, []);

  const handleCancelSelectionMode = useCallback(() => {
    setIsMessageSelectionMode(false);
    setSelectedForwardMessages([]);
  }, []);

  const handleForwardSelectedMessages = useCallback(() => {
    if (!canUseMessageHoverActions) return;
    if (!selectedForwardMessages.length) {
      toast.error('Please select at least one message to forward');
      return;
    }

    const sortedMessages = [...selectedForwardMessages].sort((a: any, b: any) => {
      const ta = new Date(a?.createdAt || 0).getTime();
      const tb = new Date(b?.createdAt || 0).getTime();
      return ta - tb;
    });

    setShowForwardModal(sortedMessages);
  }, [canUseMessageHoverActions, selectedForwardMessages]);

  const handleMainMessageAction = useCallback(
    (action: MessageActionType, msgObj: any) => {
      if (!msgObj) return;
      if (action === 'select') {
        if (!canUseMessageHoverActions) return;
        const messageType = `${msgObj?.messageType || ''}`.toLowerCase();
        if (['prompt', 'alert', 'meet'].includes(messageType) || msgObj?.isDeleted) return;
        setShowSearch(false);
        setSearchQuery('');
        setSidePanelMode(null);
        setThreadInfo(null);
        setIsMessageSelectionMode(true);
        setSelectedForwardMessages((prev: any[]) => {
          const messageId = getStableMessageId(msgObj);
          if (!messageId) return prev;
          const exists = (Array.isArray(prev) ? prev : []).some(
            (item: any) => getStableMessageId(item) === messageId,
          );
          if (exists) return prev;
          return [...(Array.isArray(prev) ? prev : []), msgObj];
        });
        return;
      }
      if (action === 'forward') {
        if (!canUseMessageHoverActions) return;
        setShowForwardModal(msgObj);
        return;
      }
      if (action === 'reply') {
        setMainMessageItemAction({ action: 'reply', msgObj });
        return;
      }
      if (action === 'reply_thread') {
        setThreadInfo(msgObj);
        const isCallLog = msgObj?.messageType === 'prompt' && msgObj?.meetLogId;
        setSidePanelMode(isCallLog ? 'call-details' : 'thread');

        setThreadMessageItemAction({ action: '', msgObj: null });
        return;
      }
      if (action === 'create_task') {
        if (!canUseMessageHoverActions) return;
        setCreateTaskMsgObj(msgObj);
        return;
      }
      if (action === 'edit' || action === 'delete') {
        if (action === 'edit' && msgObj?.messageType === 'event') {
          setMainMessageItemAction({ action: 'edit', msgObj });
          setIsEventModalOpen(true);
          return;
        }
        setMainMessageItemAction({ action, msgObj });
        return;
      }
    },
    [canUseMessageHoverActions],
  );

  const handleThreadMessageAction = useCallback(
    (action: MessageActionType, msgObj: any) => {
      if (!msgObj) return;
      if (action === 'forward') {
        if (!canUseMessageHoverActions) return;
        setShowForwardModal(msgObj);
        return;
      }
      if (action === 'reply') {
        setThreadMessageItemAction({ action: 'reply', msgObj });
        return;
      }
      if (action === 'edit' || action === 'delete') {
        setThreadMessageItemAction({ action, msgObj });
        return;
      }
    },
    [canUseMessageHoverActions],
  );
  const openSidebarMode = useCallback(
    (mode: Exclude<SidebarMode, 'thread' | 'call-details'> | null) => {
      if (!chatFeatures.canUseSidebarActions && mode) return;
      setThreadInfo(null);
      setThreadMessageItemAction({ action: '', msgObj: null });
      setSidePanelMode(mode);
    },
    [chatFeatures.canUseSidebarActions],
  );

  const jumpToMessage = useCallback(
    (messageId: string) => {
      if (!messageId) return;

      const focusMessage = () => {
        try {
          const element = document.getElementById(messageId);
          if (!element) return false;
          element.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' });
          element.classList.add('bg-ucass-active-bg', 'rounded-md');
          setTimeout(() => {
            element.classList.remove('bg-ucass-active-bg', 'rounded-md');
          }, 1000);
          return true;
        } catch (error) {
          console.error('Failed to focus message:', error);
          return false;
        }
      };

      if (focusMessage()) return;
      if (
        !currentChat?.chatId ||
        !meetingActorUuid ||
        typeof handleGetMessageByChatId !== 'function'
      )
        return;

      handleGetMessageByChatId({
        chatId: currentChat.chatId,
        userId: meetingActorUuid,
        messageId,
        cb: ({
          messages: fetchedMessages = [],
          chatId: fetchedChatId = currentChat.chatId,
        }: any) => {
          setMessageList((prev: any) => {
            const prevList = Array.isArray(prev) ? prev : [];
            const existing =
              prevList.find((item: any) => item?.chatId === fetchedChatId)?.messages || [];
            return [
              ...prevList.filter((item: any) => item?.chatId !== fetchedChatId),
              {
                chatId: fetchedChatId,
                messages: mergeChatMessages(existing, fetchedMessages),
              },
            ];
          });
          setTimeout(() => {
            focusMessage();
          }, 120);
        },
      });
    },
    [currentChat?.chatId, handleGetMessageByChatId, meetingActorUuid, setMessageList],
  );
  const isCurrentChatDeleted = useMemo(() => {
    if (!chatId) return false;
    const selectedChat = (Array.isArray(allChats) ? allChats : []).find(
      (chat: any) => chat?.chatId === chatId,
    );
    if (!selectedChat) return false;
    const hiddenUsers = Array.isArray(selectedChat?.isHidden) ? selectedChat.isHidden : [];
    return !!selectedChat?.isDeleted || hiddenUsers.includes(meetingActorUuid);
  }, [allChats, chatId, meetingActorUuid]);

  if (isCurrentChatDeleted) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--color-bg-gray-50)]">
        <div className="text-center px-6">
          <div className="text-base font-semibold text-gray-800">This chat has been deleted</div>
          <div className="text-sm text-gray-500 mt-1">Select a new chat to continue messaging.</div>
        </div>
      </div>
    );
  }
  if (!currentChat?.chatId) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--color-bg-gray-50)]">
        <div className="text-center px-6">
          <div className="text-base font-semibold text-gray-800">Select a chat</div>
          <div className="text-sm text-gray-500 mt-1">
            Choose a conversation from the left panel to start messaging.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full min-h-0 flex flex-col overflow-hidden bg-white`}>
      {mainMessageItemAction?.action === 'delete' && (
        <DeleteMessageItem
          msgObj={mainMessageItemAction?.msgObj}
          currentChat={currentChat}
          handleClose={() => setMainMessageItemAction({ action: '', msgObj: null })}
        />
      )}
      <HeaderComponent
        currentChat={currentChat}
        showSearch={showSearch}
        setShowSearch={setShowSearch}
        setSearchQuery={setSearchQuery}
        activeSidebarMode={sidePanelMode}
        fromMeetChat={fromMeetChat}
        onOpenSidebarMode={openSidebarMode}
        disableScrollTop={disableScrollTop}
        isAgentChat={isAgentChat}
        isMessageSelectionMode={isMessageSelectionMode}
        selectedMessageCount={selectedForwardMessages.length}
        onCancelMessageSelection={handleCancelSelectionMode}
        onForwardSelectedMessages={handleForwardSelectedMessages}
        onBackToList={onBackToList}
        hiddenHeaderActions={hiddenHeaderActions}
        disableCallActions={disableCallActions}
      />
      <div
        className={`flex-1 min-h-0 overflow-hidden ${isAuxSidebarOpen ? '' : 'flex flex-col lg:flex-row'}`}
      >
        {isAuxSidebarOpen ? null : (
          <div className="relative flex-1 min-w-0 min-h-0 flex flex-col bg-white">
            <MessagesComponent
              currentChat={currentChat}
              typingText={typingText}
              disableScrollTop={disableScrollTop}
              searchQuery={searchQuery}
              fromMeetChat={fromMeetChat}
              disableRouteMaxHeight={disableRouteMaxHeight}
              disableMessageHoverActions={disableMessageHoverActions}
              disableInitialMessageFetch={disableInitialMessageFetch}
              onMessageAction={handleMainMessageAction}
              isAgentChat={isAgentChat}
              isSelectionMode={isMessageSelectionMode}
              selectedMessageIds={selectedForwardMessages.map((messageItem: any) =>
                getStableMessageId(messageItem),
              )}
              onToggleMessageSelection={handleToggleMessageSelection}
              MessageItemComponent={MessageItemComponent}
            />
            {hideFooter ? null : currentChat && currentChat?.isEnded ? (
              <div className="w-full shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-center gap-2">
                <span className="text-sm text-gray-500 font-medium">Chat has been ended</span>
              </div>
            ) : (
              <FooterComponent
                currentChat={currentChat}
                mentionUsers={mentionUsers}
                typingText={typingText}
                messageItemAction={mainMessageItemAction}
                setMessageItemAction={setMainMessageItemAction}
                fromMeetChat={fromMeetChat}
                isAgentChat={isAgentChat}
                aiAssistOpen={isAiAssistPanelOpen}
                onAiAssistOpenChange={setIsAiAssistPanelOpen}
                onAiAssistContextChange={handleAiAssistContextChange}
                renderAiAssistInline={!isDesktopAiLayout}
              />
            )}
          </div>
        )}

        {!isAuxSidebarOpen &&
        isDesktopAiLayout &&
        isAiAssistPanelOpen &&
        aiAssistPanelContext?.hasAiAssistAgent ? (
          <div className="w-full h-[420px] border-t border-gray-200 lg:h-full lg:w-[360px] lg:min-w-[360px] lg:border-t-0 lg:border-l lg:border-gray-200">
            <AiAssist
              lineHeight={aiAssistPanelContext?.lineHeight || 'leading-7'}
              onClose={() => setIsAiAssistPanelOpen(false)}
              type={aiAssistPanelContext?.type || AI_SETTINGS_TYPES.CHAT_ASSISTANT}
              chatId={aiAssistPanelContext?.chatId || currentChat?.chatId || ''}
              aiSettings={aiAssistPanelContext?.aiSettings || []}
              prefillText={aiAssistPanelContext?.prefillText || ''}
              isEmbedded
            />
          </div>
        ) : null}

        {showForwardModal && (
          <ForwardMessageModal
            showForwardModal={showForwardModal}
            handleClose={() => {
              setShowForwardModal(null);
              setIsMessageSelectionMode(false);
              setSelectedForwardMessages([]);
            }}
          />
        )}

        {createTaskMsgObj && (
          <Dialog
            open={!!createTaskMsgObj}
            onOpenChange={(open) => {
              if (!open) setCreateTaskMsgObj(null);
            }}
          >
            <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1rem)] max-w-[680px] flex-col overflow-hidden bg-white p-4 sm:max-w-2xl sm:p-6">
              <DialogHeader className="shrink-0 pr-8">
                <DialogTitle>Create Task</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 flex flex-col">
                <ScheduleEventModal
                  schedule={null}
                  source={'CHAT'}
                  startDate={null as any}
                  handleClose={() => setCreateTaskMsgObj(null)}
                  isEdit={false}
                  category={SCHEDULEMEETING.task}
                  defaultTopic="   created from chat"
                  defaultDescription={getMessagePreviewText(createTaskMsgObj?.message || '')}
                  currentChat={currentChat}
                  msgObj={createTaskMsgObj}
                />
              </div>
            </DialogContent>
          </Dialog>
        )}

        {chatFeatures.canUseSidebarActions && sidePanelMode === 'notes' ? (
          <NotesList selectedChat={currentChat} setActiveState={setSidePanelMode} />
        ) : null}

        {chatFeatures.canUseSidebarActions && sidePanelMode === 'thread' && threadInfo ? (
          <ThreadPanel
            threadInfo={threadInfo}
            currentChat={currentChat}
            mentionUsers={mentionUsers}
            onClose={() => {
              setThreadInfo(null);
              setThreadMessageItemAction({ action: '', msgObj: null });
              setSidePanelMode(null);
            }}
            onMessageAction={handleThreadMessageAction}
            messageItemAction={threadMessageItemAction}
            setMessageItemAction={setThreadMessageItemAction}
            fromMeetChat={fromMeetChat}
            isAgentChat={isAgentChat}
          />
        ) : null}

        {chatFeatures.canUseSidebarActions && sidePanelMode === 'call-details' && threadInfo ? (
          <div className="h-full min-h-0">
            <Thread
              threadInfo={threadInfo}
              setThreadInfo={setThreadInfo}
              currentChat={currentChat}
              setInfoBar={(val: boolean) => {
                if (!val) {
                  setThreadInfo(null);
                  setThreadMessageItemAction({ action: '', msgObj: null });
                  setSidePanelMode(null);
                }
              }}
              setMode={setSidePanelMode}
            />
          </div>
        ) : null}

        {chatFeatures.canUseSidebarActions && sidePanelMode === 'description' ? (
          <DescriptionModal
            selectedChat={currentChat}
            setActiveState={setSidePanelMode}
            messageList={messageList}
          />
        ) : null}

        {chatFeatures.canUseSidebarActions && sidePanelMode === 'folders' ? (
          <FolderList selectedChat={currentChat} setActiveState={setSidePanelMode} />
        ) : null}

        {chatFeatures.canUseSidebarActions && sidePanelMode === 'pinned' ? (
          <PinnedMessagesView
            currentChat={currentChat}
            onClose={() => setSidePanelMode(null)}
            onJumpToMessage={jumpToMessage}
            isAgentChat={isAgentChat}
          />
        ) : null}

        {chatFeatures.canUseSidebarActions && sidePanelMode === 'files' ? (
          <FilesView
            currentChat={currentChat}
            onClose={() => setSidePanelMode(null)}
            onJumpToMessage={jumpToMessage}
            isAgentChat={isAgentChat}
          />
        ) : null}

        {chatFeatures.canUseSidebarActions && sidePanelMode === 'members' ? (
          <MembersView currentChat={currentChat} onClose={() => setSidePanelMode(null)} />
        ) : null}
      </div>
    </div>
  );
};

const Chat = ({
  chatId = '',
  fromMeetChat = false,
  mentionUsers,
  isAgentChat = false,
  onBackToList,
  uiOverrides,
  allowFallbackChat = false,
  fallbackChat,
  disableMessageHoverActions = false,
  disableRouteMaxHeight = false,
  hideFooter = false,
  hiddenHeaderActions = [],
  disableCallActions = false,
  disableInitialMessageFetch = false,
}: ChatProps) => (
  <ChatWorkspace
    chatId={chatId}
    fromMeetChat={fromMeetChat}
    mentionUsers={mentionUsers}
    onBackToList={onBackToList}
    mode={isAgentChat ? 'agent' : 'messenger'}
    uiOverrides={uiOverrides}
    allowFallbackChat={allowFallbackChat}
    fallbackChat={fallbackChat}
    disableMessageHoverActions={disableMessageHoverActions}
    disableRouteMaxHeight={disableRouteMaxHeight}
    hideFooter={hideFooter}
    hiddenHeaderActions={hiddenHeaderActions}
    disableCallActions={disableCallActions}
    disableInitialMessageFetch={disableInitialMessageFetch}
  />
);

export const AgentChat = ({
  chatId = '',
  fromMeetChat = false,
  mentionUsers,
  onBackToList,
  uiOverrides,
  allowFallbackChat = false,
  fallbackChat,
  disableMessageHoverActions = false,
  disableRouteMaxHeight = false,
  hideFooter = false,
  hiddenHeaderActions = [],
  disableCallActions = false,
  disableInitialMessageFetch = false,
}: AgentChatProps) => (
  <ChatWorkspace
    chatId={chatId}
    fromMeetChat={fromMeetChat}
    mentionUsers={mentionUsers}
    onBackToList={onBackToList}
    mode="agent"
    uiOverrides={uiOverrides}
    allowFallbackChat={allowFallbackChat}
    fallbackChat={fallbackChat}
    disableMessageHoverActions={disableMessageHoverActions}
    disableRouteMaxHeight={disableRouteMaxHeight}
    hideFooter={hideFooter}
    hiddenHeaderActions={hiddenHeaderActions}
    disableCallActions={disableCallActions}
    disableInitialMessageFetch={disableInitialMessageFetch}
  />
);

export default Chat;
