import { SearchLine, UserLine, UsersGroupLine, FilterIcon, LetterOpenedLine } from '@/assets/icons';
import CustomAvatar from '@/components/custom/custom-avatar';
import SideDrawer from '@/components/custom/side-drawer';
import CreateDirectChat from './drawers/create-direct-chat';
import CreateTeamChat from './drawers/create-team-chat';
import { useCompanyFeatures } from '@/hooks/rbac';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useUser } from '@/hooks/use-user';
import moment from 'moment';
import {
  Bell,
  BellOff,
  EllipsisVertical,
  Pin,
  PinOff,
  MessageSquareIcon,
  Plus,
  Star,
  StarOff,
  XIcon,
  LucideUser,
  Loader2,
} from 'lucide-react';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import Chat from './chat';
import { useQuery } from '@tanstack/react-query';
import { allOmniChannelsList } from '@/services/api';
import { capitalizeFirstLetter, cn } from '@/lib/utils';
import { chatEvents } from '@/context/socket-events';
import { toast } from 'react-toastify';
import Sidebar from './sidebar';
import { CHANNELS_ICON, ChatChannels } from './constants';
import Content from './content';
import { useUsersDirectory } from '@/hooks/use-users-directory';
import { canUseOmniChannel, getAllowedOmniChannels } from './omni-permissions';
import useDebounce from '@/hooks/use-debounce';
import { useLoadMoreUsersObserver, useMessengerUsers } from './hooks/use-messenger-users';
import '@/components/mcm/mcm-page.css';
import { Picker } from '@/components/mcm/picker';

type ChannelType = keyof typeof CHANNELS_ICON;

type ChatTab = 'all' | 'team' | 'direct' | 'favorites';
type MessageStatus = 'all' | 'unread';
type MessengerMode = 'messenger' | 'agent-chat';
type MessengerChatType =
  '' | 'whatsapp' | 'instagram' | 'facebook' | 'messenger' | 'telegram' | 'chat' | 'website' | 'captain' | 'all_channels';
type DraftRecord = Record<
  string,
  { message?: any; messageItemAction?: { action?: string }; updatedAt?: number }
>;

const DRAFT_STORAGE_KEY = 'mcm_chat_drafts';
const DRAFT_SAVED_STORAGE_KEY = 'mcm_chat_drafts_saved';
const DRAFTS_UPDATED_EVENT = 'mcm-chat-drafts-updated';

const tabOptions: Array<{ label: string; value: ChatTab }> = [
  { label: 'All', value: 'all' },
  { label: 'Team', value: 'team' },
  { label: 'Direct', value: 'direct' },
  { label: 'Favorites', value: 'favorites' },
];

const getChatTimestamp = (chat: any, draftUpdatedAt = 0) => {
  let baseTimestamp = -Infinity;
  if (chat?.lastMessage?.createdAt) baseTimestamp = new Date(chat.lastMessage.createdAt).getTime();
  else if (chat?.metaData?.lastMessageTimeStamp)
    baseTimestamp = new Date(chat.metaData.lastMessageTimeStamp).getTime();
  else if (chat?.createdAt) baseTimestamp = new Date(chat.createdAt).getTime();

  const draftTimestamp = Number(draftUpdatedAt);
  const normalizedDraftTimestamp = Number.isFinite(draftTimestamp) ? draftTimestamp : -Infinity;
  return Math.max(baseTimestamp, normalizedDraftTimestamp);
};

const getSimpleDateString = (dateString?: string) => {
  if (!dateString) return '';
  const date = moment(dateString);
  if (!date.isValid()) return '';

  if (date.isSame(moment(), 'day')) return date.format('HH:mm');
  if (date.isSame(moment().subtract(1, 'day'), 'day')) return 'Yesterday';
  if (date.isSame(moment(), 'year')) return date.format('MMM D');
  return date.format('MMM D, YYYY');
};

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

const getDraftPreviewText = (draft: any): string => {
  if (!draft) return '';

  const messagePreview = getMessagePreviewText(draft?.message);
  if (messagePreview) return `Draft: ${messagePreview}`;

  const action = draft?.messageItemAction?.action;
  if (action === 'edit') return 'Draft: Editing message';
  if (action === 'reply') return 'Draft: Replying';

  return action ? 'Draft message' : '';
};

const readDraftsFromStorage = (): DraftRecord => {
  if (typeof window === 'undefined') return {};

  try {
    const parseDraftStore = (rawValue: string | null) => {
      if (!rawValue) return {} as DraftRecord;
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === 'object' ? parsed : {};
    };

    const savedDrafts = parseDraftStore(window.sessionStorage.getItem(DRAFT_SAVED_STORAGE_KEY));
    const legacyDrafts = parseDraftStore(window.sessionStorage.getItem(DRAFT_STORAGE_KEY));

    // Sidebar should show only committed/saved drafts.
    return {
      ...legacyDrafts,
      ...savedDrafts,
    };
  } catch {
    return {};
  }
};

const isConversationPinnedForUser = (chat: any, userId?: string) => {
  if (!chat || !userId) return false;

  const metaPinnedBy = chat?.metaData?.pinnedBy;
  if (Array.isArray(metaPinnedBy)) {
    const isPinnedFromMeta = metaPinnedBy.some((item: any) => {
      if (typeof item === 'string') return item === userId;
      return item?.uuid === userId;
    });
    if (isPinnedFromMeta) return true;
  }

  const candidatePinnedLists = [
    chat?.pinnedConversation,
    chat?.pinnedConversations,
    chat?.pinnedChats,
    chat?.pinnedBy,
    chat?.pinnedUsers,
    chat?.conversationPinnedBy,
  ];

  for (const pinnedList of candidatePinnedLists) {
    if (Array.isArray(pinnedList) && pinnedList.includes(userId)) return true;
  }

  if (typeof chat?.isPinnedConversation === 'boolean') return chat.isPinnedConversation;
  if (typeof chat?.isConversationPinned === 'boolean') return chat.isConversationPinned;
  if (typeof chat?.isPinned === 'boolean') return chat.isPinned;

  return false;
};

const getPinnedAtTimestampForUser = (chat: any, userId?: string) => {
  if (!chat || !userId) return 0;

  const metaPinnedBy = Array.isArray(chat?.metaData?.pinnedBy) ? chat.metaData.pinnedBy : [];
  const metaPinEntry = metaPinnedBy.find((item: any) => item?.uuid === userId);
  if (metaPinEntry?.pinnedAt) {
    const ts = new Date(metaPinEntry.pinnedAt).getTime();
    if (Number.isFinite(ts)) return ts;
  }

  const genericPinLists = [chat?.pinnedBy, chat?.pinnedUsers, chat?.conversationPinnedBy];
  for (const list of genericPinLists) {
    if (!Array.isArray(list)) continue;
    const entry = list.find((item: any) => item?.uuid === userId && item?.pinnedAt);
    if (entry?.pinnedAt) {
      const ts = new Date(entry.pinnedAt).getTime();
      if (Number.isFinite(ts)) return ts;
    }
  }

  return 0;
};

const NotificationBadge = ({
  count = 0,
  isMuted = false,
}: {
  count?: number;
  isMuted?: boolean;
}) => {
  if (!count && !isMuted) return null;

  return (
    <>
      {isMuted && <BellOff className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
      {count > 0 && (
        <span className="bg-primary min-w-5 h-5 px-1 rounded-full flex items-center justify-center text-white text-[11px]">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </>
  );
};

const ListItem = ({
  chat,
  onChatSelect,
  draftsByKey,
}: {
  chat: any;
  onChatSelect: (chat: any) => void;
  draftsByKey?: DraftRecord;
}) => {
  const { user } = useUser();
  const [searchParams] = useSearchParams();
  const {
    handleToggleChatAsFavorite,
    handleMuteConversation,
    handlePinConversation,
    allChats,
    typingList,
    chatWindows,
    handleUnread,
  } = useSocketEvents();
  const { getUserProfileByUuid } = useUsersDirectory();
  const chatIdFromQuery = searchParams.get('chatId') || '';
  const isGroupChat = !!chat?.isGroupChat;
  const isOwnChat = chat?.chatId === user?.uuid;
  const isMuted = chat?.isMuted?.includes(user?.uuid) ?? false;
  const isFavorited = chat?.favoriteChats?.includes(user?.uuid);
  const isConversationPinned = isConversationPinnedForUser(chat, user?.uuid);
  const otherUserData = chat?.users?.find((chatUser: any) => chatUser?.uuid !== user?.uuid);
  const myData = chat?.users?.find((chatUser: any) => chatUser?.uuid === user?.uuid);
  const unreadMsgCount = myData?.unreadMsg || 0;

  const getUserDisplayName = (chatUser: any) => {
    if (!chatUser) return '';
    if (chatUser?.name) return chatUser.name;
    return `${chatUser?.first_name || ''} ${chatUser?.last_name || ''}`.trim();
  };

  const nameToShow = isGroupChat
    ? chat?.name || 'Group'
    : isOwnChat
      ? `${user?.first_name || ''} ${user?.last_name || ''}`.trim()
      : getUserDisplayName(otherUserData) || 'Unknown';

  const typingUsers = Array.isArray(typingList?.[chat?.chatId]) ? typingList[chat.chatId] : [];
  const isTyping = typingUsers.length > 0;
  const draftKey = `${chat?.chatId || ''}_main`;
  const draftPreviewText = useMemo(
    () => getDraftPreviewText(draftsByKey?.[draftKey]),
    [draftsByKey, draftKey],
  );
  const hasDraftPreview = !!draftPreviewText;
  const isChatOpened = chatIdFromQuery === chat?.chatId || chatWindows?.includes(chat?.chatId);
  const shouldShowDraftPreview = hasDraftPreview && unreadMsgCount === 0 && !isChatOpened;

  const typingText = useMemo(() => {
    if (!isTyping) return '';

    if (isGroupChat) {
      const names = (chat?.users || [])
        .filter((u: any) => typingUsers.includes(u?.uuid))
        .map((u: any) => getUserDisplayName(u))
        .filter(Boolean);
      return names.length ? `${names.join(', ')} typing...` : 'Typing...';
    }
    return 'Typing...';
  }, [isTyping, isGroupChat, chat?.users, typingUsers]);

  const lastMessageText = useMemo(() => {
    const rawMessage = chat?.lastMessage?.messageType
      ? chat.lastMessage
      : chat?.lastMessage?.message || chat?.metaData?.lastMessage || chat?.lastMessage;
    const preview = getMessagePreviewText(rawMessage);
    if (preview && preview !== '') return preview;

    return Array.isArray(chat?.lastMessage?.attachments) && chat.lastMessage.attachments.length
      ? 'Attachment'
      : '';
  }, [
    chat?.metaData?.lastMessage,
    chat?.lastMessage?.message,
    chat?.lastMessage,
    chat?.lastMessage?.attachments,
  ]);

  // Handle available user case
  if (chat?.isAvailableUser) {
    return (
      <div className="flex hover:bg-gray cursor-pointer" onClick={() => onChatSelect(chat)}>
        <div className="flex items-center w-full px-3 h-16 gap-2">
          <div className="relative">
            <CustomAvatar
              name={`${otherUserData?.first_name} ${otherUserData?.last_name}`}
              extension={otherUserData?.extension}
              showPresence
              image={otherUserData?.profile || getUserProfileByUuid(otherUserData?.uuid)}
            />
          </div>
          <div className="flex flex-col justify-between text-sm w-[calc(100%_-_3rem)] gap-1">
            <div className="flex justify-between gap-2">
              <div className="flex items-center gap-1 w-full ">
                <LucideUser className="w-4 min-w-4 h-4 text-gray-700" />
                <p className="text-gray-900 truncate font-medium">
                  {otherUserData?.first_name}&nbsp;
                  {otherUserData?.last_name}
                </p>
              </div>
            </div>
            <div className="flex justify-between">
              <p className="text-primary truncate pr-12 text-xs">Click to start a new chat</p>
              {/* <div className="flex gap-0.5 justify-end items-center">
                <span className="bg-ucass-active text-white text-xs px-2 py-1 rounded-full">
                  New
                </span>
              </div> */}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function handleClickItem(selectedChat: any) {
    onChatSelect(selectedChat);
  }

  // Auto-selection removed from ListItem, handled centrally in SidebarContent now.

  function toggleFavorite(selectedChat: any) {
    const selectedChatId = selectedChat?.chatId || '';
    if (!selectedChatId) return;
    handleToggleChatAsFavorite(selectedChatId);
  }

  function toggleMute(selectedChat: any) {
    const selectedChatId = selectedChat?.chatId || '';
    if (!selectedChatId) return;

    handleMuteConversation({
      chatId: selectedChatId,
      mute: !isMuted,
    });
  }

  function togglePinConversation(selectedChat: any) {
    const selectedChatId = selectedChat?.chatId || '';
    if (!selectedChatId) return;

    if (!isConversationPinned) {
      const pinnedCount = (Array.isArray(allChats) ? allChats : []).filter(
        (chatItem: any) =>
          !chatItem?.isHidden?.includes(user?.uuid) &&
          !chatItem?.isDeleted &&
          isConversationPinnedForUser(chatItem, user?.uuid),
      ).length;

      if (pinnedCount >= 3) {
        toast.error('You can pin only 3 conversations');
        return;
      }
    }

    handlePinConversation({
      chatId: selectedChatId,
      userID: user?.uuid,
      type: isConversationPinned ? 'unpin' : 'pin',
    });
  }

  return (
    <div
      key={chat?.chatId}
      className="text-xs text-[var(--color-text-black)] pb-0 cursor-pointer"
      onClick={() => handleClickItem(chat)}
    >
      <div className="w-full flex flex-col gap-1 ">
        <div
          className={`flex justify-between w-full items-center pl-3 pr-2 min-h-[60px] group relative  transition-all border-b border-gray-200 duration-200 
             ${isChatOpened ? 'bg-gray-100  ' : 'bg-transparent hover:bg-gray-100 '}`}
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <div className="text-xs font-medium flex items-center gap-1">
              <CustomAvatar
                name={nameToShow || ''}
                showPresence={!isGroupChat && !isOwnChat}
                size="36"
                extension={!isGroupChat ? otherUserData?.extension : ''}
                image={isGroupChat ? chat?.avatar : getUserProfileByUuid(otherUserData?.uuid) || ''}
              />
            </div>
            <div className="flex w-full min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <div className=" min-w-0 truncate">{nameToShow || ''}</div>
                {isFavorited ? (
                  <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500 shrink-0" />
                ) : null}
                {isConversationPinned ? (
                  <Pin className="w-3.5 h-3.5 text-primary shrink-0" />
                ) : null}
                <NotificationBadge count={unreadMsgCount} isMuted={isMuted} />
              </div>
              {isOwnChat ? (
                <div className="text-gray-500 italic">(You)</div>
              ) : (
                <div
                  className={`truncate text-xs ${isTyping ? 'text-primary' : shouldShowDraftPreview ? 'text-amber-600 font-medium' : 'text-gray-500'}`}
                >
                  {isTyping
                    ? typingText
                    : shouldShowDraftPreview
                      ? draftPreviewText
                      : lastMessageText || 'No message yet'}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1 items-end">
            {window.location.pathname.includes('/agent-chat') ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="min-w-6 max-h-10 max-w-6 cursor-pointer invisible flex items-center justify-end group-hover:visible group-focus-within:flex text-gray-500">
                    <EllipsisVertical width={18} height={18} />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-white rounded-lg shadow-lg border border-gray-200 p-1 min-w-[200px]">
                  <DropdownMenuItem
                    className="flex items-center gap-3 p-2 text-xs font-normal cursor-pointer rounded-md hover:bg-gray-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnread({ chatId: chat?.chatId, type: 'read' }, true);
                    }}
                  >
                    {/* <LetterOpenedLine className="text-gray-900 w-4 h-4" /> */}
                    <LetterOpenedLine className="w-3.5 h-3.5 text-gray-600" />
                    <span className="text-gray-700">Mark as read</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex items-center gap-3 p-2 text-xs font-normal cursor-pointer rounded-md hover:bg-gray-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(chat);
                    }}
                  >
                    {isFavorited ? (
                      <>
                        <StarOff className="w-3.5 h-3.5 text-gray-600" />
                        <span className="text-gray-700">Remove from favorites</span>
                      </>
                    ) : (
                      <>
                        <Star className="w-3.5 h-3.5 text-gray-600" />
                        <span className="text-gray-700">Add to favorites</span>
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex items-center gap-3 p-2 text-xs font-normal cursor-pointer rounded-md hover:bg-gray-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePinConversation(chat);
                    }}
                  >
                    {isConversationPinned ? (
                      <>
                        <PinOff className="w-3.5 h-3.5 text-gray-600" />
                        <span className="text-gray-700">Unpin conversation</span>
                      </>
                    ) : (
                      <>
                        <Pin className="w-3.5 h-3.5 text-gray-600" />
                        <span className="text-gray-700">Pin conversation</span>
                      </>
                    )}
                  </DropdownMenuItem>

                  {!isOwnChat && (
                    <DropdownMenuItem
                      className="flex items-center gap-3 p-2 text-xs font-normal cursor-pointer rounded-md hover:bg-gray-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMute(chat);
                      }}
                    >
                      {isMuted ? (
                        <>
                          <Bell className="w-3.5 h-3.5 text-gray-600" />
                          <span className="text-gray-700">Unmute conversation</span>
                        </>
                      ) : (
                        <>
                          <BellOff className="w-3.5 h-3.5 text-gray-600" />
                          <span className="text-gray-700">Mute conversation</span>
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {(chat?.lastMessage?.createdAt || chat?.metaData?.lastMessageTimeStamp) && (
              <div className="text-xs whitespace-nowrap text-gray-500">
                {getSimpleDateString(
                  chat?.lastMessage?.createdAt || chat?.metaData?.lastMessageTimeStamp,
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SidebarContent = ({
  activeTab,
  setActiveTab,
  setChatType,
  setselectedChannelType,
  isAgentChat = false,
  isCompactLayout = false,
}: {
  activeTab: ChatTab;
  setActiveTab: (tab: ChatTab) => void;
  setChatType: (type: any) => void;
  setselectedChannelType: (type: any) => void;
  isAgentChat?: boolean;
  isCompactLayout?: boolean;
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchOpen, setSearchOpen] = useState(false);

  const [statusFilter, setStatusFilter] = useState<MessageStatus>('all');
  const {
    allChats = [],
    chatWindows,
    setChatWindows,
    handleOpenChatInWindow,
    handleUnread,
    createPrivateChatId,
    socketEventsManager,
    chatExist,
  } = useSocketEvents();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useUser();
  const [showCreateChatModal, setShowCreateChatModal] = useState('');
  const { features } = useCompanyFeatures();
  const chatAccess = features?.plan_features?.chat || {};
  const omniAccess = features?.plan_features?.omni_channel || {};
  const pageTitle = isAgentChat ? 'Agent Chat' : 'Chat';
  const [draftsByKey, setDraftsByKey] = useState<DraftRecord>(() => readDraftsFromStorage());

  const { data: omniChannels } = useQuery({
    queryKey: ['allOmniChannelsList'],
    queryFn: () => allOmniChannelsList(),
    select: (data: any) => data?.data?.data?.rows,
  });

  const debouncedUserSearch = useDebounce(searchQuery, 300);
  const shouldLoadAvailableUsers =
    !isAgentChat && statusFilter === 'all' && (activeTab === 'all' || activeTab === 'direct');
  const {
    users: userListData,
    fetchNextPage: fetchNextUserPage,
    hasNextPage: hasNextUserPage = false,
    isFetchingNextPage: isFetchingNextUserPage,
    isLoading: isLoadingUsers,
  } = useMessengerUsers({
    search: debouncedUserSearch,
    enabled: shouldLoadAvailableUsers,
  });
  const loadMoreUsersRef = useLoadMoreUsersObserver({
    fetchNextPage: fetchNextUserPage,
    hasNextPage: hasNextUserPage,
    isFetchingNextPage: isFetchingNextUserPage,
    enabled: shouldLoadAvailableUsers,
  });

  const allowedOmniChannels = useMemo(
    () => getAllowedOmniChannels(omniAccess, omniChannels || []),
    [omniAccess, omniChannels],
  );

  useEffect(() => {
    const syncDrafts = () => {
      setDraftsByKey(readDraftsFromStorage());
    };

    syncDrafts();
    window.addEventListener(DRAFTS_UPDATED_EVENT, syncDrafts);
    return () => window.removeEventListener(DRAFTS_UPDATED_EVENT, syncDrafts);
  }, []);

  const existingDirectChatUserUuids = useMemo(() => {
    return (Array.isArray(allChats) ? allChats : [])
      .filter((chat: any) => !chat.isGroupChat && !chat.isDeleted)
      .map((chat: any) => {
        const otherUser = chat?.users?.find((u: any) => u?.uuid !== user?.uuid);
        return otherUser?.uuid;
      })
      .filter(Boolean);
  }, [allChats, user?.uuid]);

  const availableUsers = useMemo(() => {
    return userListData
      .filter((u: any) => u.uuid !== user?.uuid && !existingDirectChatUserUuids.includes(u.uuid))
      .map((u: any) => ({
        chatId: u.uuid,
        isAvailableUser: true,
        users: [
          {
            uuid: user?.uuid,
            first_name: user?.first_name,
            last_name: user?.last_name,
            email: user?.email,
          },
          {
            uuid: u.uuid,
            first_name: u.first_name,
            last_name: u.last_name,
            profile: u.profile,
            extension: u.extension,
            email: u.email,
          },
        ],
      }));
  }, [userListData, existingDirectChatUserUuids, user]);

  const visibleChats = useMemo(
    () =>
      (Array.isArray(allChats) ? allChats : []).filter(
        (chat: any) =>
          !chat?.isHidden?.includes(user?.uuid) &&
          !chat?.isDeleted &&
          (isAgentChat
            ? chat?.groupType === 'AI'
            : chat?.groupType !== 'AI' && chat?.groupType !== 'MEETING'),
      ),
    [allChats, user?.uuid, isAgentChat],
  );

  const directMessages = useMemo(
    () => visibleChats.filter((chat: any) => !chat?.isGroupChat && !chat?.isDeleted),
    [visibleChats],
  );

  const favorites = useMemo(
    () =>
      visibleChats.filter(
        (chat: any) =>
          !chat?.isHidden?.includes(user?.uuid) &&
          !chat?.isDeleted &&
          chat?.favoriteChats?.includes(user?.uuid),
      ),
    [visibleChats, user?.uuid],
  );

  const teamChats = useMemo(
    () => visibleChats.filter((chat: any) => !!chat?.isGroupChat && !chat?.isDeleted),
    [visibleChats],
  );

  useEffect(() => {
    const channelIds = visibleChats.map((chat: any) => chat?.chatId);
    const newWindows = (Array.isArray(chatWindows) ? chatWindows : []).filter((item: string) =>
      channelIds.includes(item),
    );

    if (JSON.stringify(newWindows) !== JSON.stringify(chatWindows || [])) {
      setChatWindows(newWindows);
    }
  }, [visibleChats, chatWindows, setChatWindows]);

  const handleSanitizedCreateNewChat = (selectedUser: any, requiredChatId: string) => {
    if (!selectedUser?.uuid || !user?.uuid) return;

    const ifElementExist: any = chatExist(requiredChatId);
    const isHidden = ifElementExist?.isHidden?.includes(user?.uuid);

    if (ifElementExist) {
      if (isHidden) {
        socketEventsManager?.emit(chatEvents.REVERT_CHAT, {
          chatId: requiredChatId,
          senderId: user?.uuid,
        });
      }

      handleOpenChatInWindow(requiredChatId, false, false);
      return;
    }
    console.log(selectedUser, 'selectedUser');

    if (socketEventsManager) {
      const usersToSend = [
        {
          uuid: user?.uuid,
          name: `${user?.first_name || user?.user_info?.first_name || ''} ${user?.last_name || user?.user_info?.last_name || ''}`.trim(),
          email: user?.email || user?.user_info?.email,
          extension: user?.extension || user?.user_info?.extension,
        },
        {
          uuid: selectedUser?.uuid,
          name: `${selectedUser?.first_name || ''} ${selectedUser?.last_name || ''}`.trim(),
          email: selectedUser?.email,
          extension: selectedUser?.extension || selectedUser?.value,
        },
      ];

      socketEventsManager.emit(
        chatEvents.CREATE_NEW_CHAT,
        {
          chatId: requiredChatId,
          company_uuid: user?.company_info?.uuid,
          users: usersToSend,
          allUsers: usersToSend,
        },
        () => {
          // toast.success('Chat created successfully!');
          handleOpenChatInWindow(requiredChatId, false, false);
        },
      );
    }
  };

  const onChatSelect = (
    selectedChat: any,
    options?: {
      allowCreateForAvailableUser?: boolean;
    },
  ) => {
    const selectedChatId = selectedChat?.chatId || '';
    if (!selectedChatId) return;
    const allowCreateForAvailableUser = options?.allowCreateForAvailableUser !== false;

    if (selectedChat?.isAvailableUser) {
      if (!allowCreateForAvailableUser) return;
      const otherUser = selectedChat?.users?.find((u: any) => u?.uuid !== user?.uuid);
      const generatedChatId = createPrivateChatId([user?.uuid, otherUser?.uuid]);

      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('chatId', generatedChatId);
        if (isAgentChat) {
          next.delete('type');
        } else {
          next.set('type', 'direct');
        }
        return next;
      });

      // Creating the conversation is not the same as opening it: the branch
      // below does this for existing chats, and without it a chat started from
      // an available user is created, listed, and left closed — the caller then
      // has to click the person a second time to actually read it.
      handleOpenChatInWindow(generatedChatId);
      handleSanitizedCreateNewChat(otherUser, generatedChatId);
      return;
    }

    const myData = selectedChat?.users?.find((u: any) => u?.uuid === user?.uuid);
    if (myData?.unreadMsg > 0) {
      handleUnread({ chatId: selectedChatId, type: 'read' }, true);
    }

    handleOpenChatInWindow(selectedChatId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('chatId', selectedChatId);

      if (isAgentChat) {
        next.delete('type');
        return next;
      }

      const currentType = next.get('type') || 'all';
      if (currentType !== 'all') {
        const isGroup = !!selectedChat?.isGroupChat;
        const isFav = selectedChat?.favoriteChats?.includes(user?.uuid);

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
  };

  const getChatDisplayName = (chat: any) => {
    if (chat?.isGroupChat) return chat?.name || '';
    if (chat?.chatId === user?.uuid) {
      const me = chat?.users?.find((u: any) => u?.uuid === user?.uuid);
      return me?.name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
    }
    const otherUser = chat?.users?.find((u: any) => u?.uuid !== user?.uuid);
    return otherUser?.name || `${otherUser?.first_name || ''} ${otherUser?.last_name || ''}`.trim();
  };

  const filterByName = (arr: any[]) => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return arr || [];

    return (arr || []).filter((chat: any) => {
      return getChatDisplayName(chat).toLowerCase().includes(normalizedQuery);
    });
  };

  const filterByStatus = (arr: any[]) => {
    if (statusFilter === 'all') return arr;
    return (arr || []).filter((chat: any) => {
      const me = chat?.users?.find((u: any) => u?.uuid === user?.uuid);
      return (me?.unreadMsg || 0) > 0;
    });
  };

  const groupList = useMemo(() => {
    const sortByPinnedAndTime = (arr: any[]) =>
      [...arr].sort((a: any, b: any) => {
        const aPinned = isConversationPinnedForUser(a, user?.uuid);
        const bPinned = isConversationPinnedForUser(b, user?.uuid);

        if (aPinned && bPinned) {
          const aPinnedAt = getPinnedAtTimestampForUser(a, user?.uuid);
          const bPinnedAt = getPinnedAtTimestampForUser(b, user?.uuid);
          if (aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;
        } else if (aPinned !== bPinned) {
          return aPinned ? -1 : 1;
        }

        const aDraftUpdatedAt = draftsByKey?.[`${a?.chatId || ''}_main`]?.updatedAt || 0;
        const bDraftUpdatedAt = draftsByKey?.[`${b?.chatId || ''}_main`]?.updatedAt || 0;
        return getChatTimestamp(b, bDraftUpdatedAt) - getChatTimestamp(a, aDraftUpdatedAt);
      });

    if (isAgentChat) {
      return [
        {
          id: 1,
          label: '',
          shouldVisible: visibleChats.length > 0,
          data: sortByPinnedAndTime(filterByStatus(filterByName(visibleChats))),
        },
      ];
    }

    const groupsByTab: Record<
      ChatTab,
      Array<{ id: number; label: string; shouldVisible: boolean; data: any[] }>
    > = {
      all: [
        {
          id: 1,
          label: 'Favorites',
          shouldVisible: favorites.length > 0,
          data: sortByPinnedAndTime(filterByStatus(filterByName(favorites))),
        },
        {
          id: 2,
          label: 'Team',
          shouldVisible: teamChats.length > 0,
          data: sortByPinnedAndTime(filterByStatus(filterByName(teamChats))),
        },
        {
          id: 3,
          label: 'Chats',
          shouldVisible: directMessages.length > 0 || availableUsers.length > 0,
          data: [
            ...sortByPinnedAndTime(filterByStatus(filterByName(directMessages))),
            ...filterByStatus(filterByName(availableUsers)),
          ],
        },
      ],
      team: [
        {
          id: 1,
          label: 'Team',
          shouldVisible: teamChats.length > 0,
          data: sortByPinnedAndTime(filterByStatus(filterByName(teamChats))),
        },
      ],
      direct: [
        {
          id: 1,
          label: 'Chats',
          shouldVisible: directMessages.length > 0 || availableUsers.length > 0,
          data: [
            ...sortByPinnedAndTime(filterByStatus(filterByName(directMessages))),
            ...filterByStatus(filterByName(availableUsers)),
          ],
        },
      ],
      favorites: [
        {
          id: 1,
          label: 'Favorites',
          shouldVisible: favorites.length > 0,
          data: sortByPinnedAndTime(filterByStatus(filterByName(favorites))),
        },
      ],
    };

    return groupsByTab[activeTab];
  }, [
    activeTab,
    favorites,
    teamChats,
    directMessages,
    searchQuery,
    statusFilter,
    user?.uuid,
    availableUsers,
    isAgentChat,
    visibleChats,
    draftsByKey,
  ]);

  const emptyMessenger = useMemo(
    () => groupList.every((group) => !group.shouldVisible || group.data.length === 0),
    [groupList],
  );

  const prevTabRef = useRef(activeTab);

  /**
   * Arriving with `?chatId=` — from Directory's Message button, a notification,
   * or a shared link — opens that conversation.
   *
   * A person you have never messaged appears in the list as an "available
   * user" whose chat does not exist yet. Selecting them without
   * `allowCreateForAvailableUser` does nothing, which left the person
   * highlighted at the bottom of the list and the pane stuck on "Select a
   * chat". Creating the conversation also moves them out of the available
   * users and up into the real chats.
   *
   * The ref keeps this to once per chatId, so re-renders while the chat is
   * being created cannot fire it again.
   */
  const autoOpenedChatIdRef = useRef<string>('');

  useEffect(() => {
    const wanted = searchParams.get('chatId') || '';
    if (!wanted || autoOpenedChatIdRef.current === wanted) return;

    const entry = groupList
      .flatMap((group: any) => group?.data || [])
      .find((item: any) => item?.chatId === wanted);
    if (!entry) return;

    autoOpenedChatIdRef.current = wanted;
    onChatSelect(entry, { allowCreateForAvailableUser: true });
  }, [searchParams.get('chatId'), groupList]);

  useEffect(() => {
    if (isCompactLayout) {
      prevTabRef.current = activeTab;
      return;
    }

    const chatIdFromQuery = searchParams.get('chatId');
    const isTabChange = prevTabRef.current !== activeTab;

    if (
      isTabChange ||
      (!chatIdFromQuery && (!chatWindows || chatWindows.length === 0) && !emptyMessenger)
    ) {
      if (!emptyMessenger) {
        const firstAvailableGroup = groupList.find((g) => g.shouldVisible && g?.data?.length > 0);
        const firstExistingChat = firstAvailableGroup?.data?.find(
          (chat: any) => !chat?.isAvailableUser,
        );
        if (firstExistingChat) {
          setTimeout(() => {
            onChatSelect(firstExistingChat, { allowCreateForAvailableUser: false });
          }, 100);
        }
      }
    }

    prevTabRef.current = activeTab;
  }, [
    searchParams.get('chatId'),
    chatWindows?.length,
    emptyMessenger,
    groupList,
    activeTab,
    isCompactLayout,
  ]);

  return (
    <div className="w-full h-full min-h-0 bg-white flex flex-col">
      <div className="min-h-16 flex items-center px-3 sm:px-4 justify-between border-b border-gray-200">
        <div className="flex gap-3 w-full">
          {searchOpen ? (
            <div className="w-full h-full flex items-center justify-between gap-2">
              <Input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search member"
                className="border-none min-h-14 h-full w-full focus-visible:ring-0 px-0"
              />
              <button
                className="flex cursor-pointer text-gray-700"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery('');
                }}
                aria-label="Close search"
              >
                <XIcon width={16} height={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 w-full">
              <div className="text-xl font-semibold w-full min-w-0 truncate text-gray-900">
                {pageTitle}
              </div>
              {!isAgentChat ? (
                <div className="flex gap-2 shrink-0">
                  {chatAccess?.access?.DIRECT_MESSAGE || chatAccess?.access?.TEAM_MESSAGE ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="flex items-center justify-center cursor-pointer w-10 h-10 rounded-full bg-gray-100 text-gray-700 hover:bg-primary hover:text-white"
                          aria-label="Add"
                        >
                          <Plus width={18} height={18} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {chatAccess?.access?.DIRECT_MESSAGE && (
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => {
                              setShowCreateChatModal('direct');
                            }}
                          >
                            <UserLine className="text-gray-900 w-8 h-8" /> Direct Message
                          </DropdownMenuItem>
                        )}
                        {chatAccess?.access?.TEAM_MESSAGE && (
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => {
                              setShowCreateChatModal('team');
                            }}
                          >
                            <UsersGroupLine className="text-gray-900 w-8 h-8" />
                            Create New Team
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <button
                      className="flex items-center justify-center cursor-pointer w-10 h-10 rounded-full bg-gray-100 text-gray-700 hover:bg-primary hover:text-white"
                      aria-label="Add"
                    >
                      <Plus width={18} height={18} />
                    </button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <div className="cursor-pointer flex items-center justify-center rounded-full w-10 h-10 bg-gray-100 text-gray-900/80 hover:bg-primary hover:text-white">
                        <FilterIcon className="w-6 h-6" />
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {ChatChannels?.map((item: any, index: number) => {
                        return (
                          <DropdownMenuItem
                            key={index}
                            onClick={() => {
                              setChatType(item.value);
                              setselectedChannelType(item);
                            }}
                          >
                            {item.icon()} {item.label}
                          </DropdownMenuItem>
                        );
                      })}
                      {allowedOmniChannels && allowedOmniChannels?.length
                        ? allowedOmniChannels.map((item: any, index: number) => (
                            <DropdownMenuItem
                              key={index}
                              onClick={() => {
                                setChatType(item.type);
                                setselectedChannelType(item);
                              }}
                            >
                              {CHANNELS_ICON[item?.type as ChannelType]}{' '}
                              {capitalizeFirstLetter(item.type)}
                            </DropdownMenuItem>
                          ))
                        : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {!isAgentChat ? (
        <div className="border-b border-gray-200 px-2">
          <div className="flex min-h-10 items-center gap-2 overflow-x-auto">
            {tabOptions.map((tab) => (
              <button
                key={tab.value}
                className={`px-2 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab.value
                    ? 'text-primary border-primary'
                    : 'text-gray-700 border-transparent hover:text-primary'
                }`}
                onClick={() => {
                  setActiveTab(tab.value);
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set('type', tab.value);
                    next.delete('chatId');
                    return next;
                  });
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="px-3 py-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 border-b border-gray-100">
        <Input
          Icon={<SearchLine className="text-gray-500" />}
          IconPosition="left-0 pl-3 inset-y-0"
          className="pl-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
        />
        {!isAgentChat ? (
          <div className="w-full sm:min-w-28 sm:w-28">
            <Picker
              label="Show"
              showLabel={false}
              className="mcm-field"
              value={statusFilter}
              options={[
                { label: 'All', value: 'all' },
                { label: 'Unread', value: 'unread' },
              ]}
              onChange={(option) => setStatusFilter(option.value as MessageStatus)}
            />
          </div>
        ) : null}
      </div>

      <div className="w-full flex-1 min-h-0 overflow-auto">
        {emptyMessenger ? (
          <div className="w-full min-h-[calc(100%_-_2.5rem)] flex justify-center items-center">
            <div className="flex items-center justify-center px-4">
              <div className="max-w-md w-full text-center px-4 pb-11">
                <div className="flex items-center justify-center w-20 h-20 mx-auto rounded-full bg-ucass-active-bg mb-6">
                  <MessageSquareIcon className="h-9 w-9 text-primary" />
                </div>

                <div className="text-lg font-semibold text-gray-800">
                  {isAgentChat ? 'No chats available' : 'Create a new chat'}
                </div>
                <div className="text-gray-500 mt-2 text-sm">
                  {isAgentChat
                    ? 'Chats will appear here once they are available.'
                    : 'Click on the plus icon to create a new chat'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-2 pb-[45px] overflow-auto">
            {groupList.map((group: any) => {
              if (!group?.shouldVisible || !group?.data?.length) return null;
              return (
                <div key={group?.label} className="w-full">
                  {group?.label && !isAgentChat ? (
                    <div className="text-xs uppercase tracking-wider font-medium text-gray-500 flex gap-2 py-0 items-center bg-transparent min-h-9 justify-start max-h-9 px-2">
                      {group?.label}
                    </div>
                  ) : null}
                  {(group?.data || []).map((chat: any) => (
                    <ListItem
                      chat={chat}
                      key={chat?.chatId}
                      onChatSelect={onChatSelect}
                      draftsByKey={draftsByKey}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {shouldLoadAvailableUsers &&
        (isLoadingUsers || hasNextUserPage || isFetchingNextUserPage) ? (
          <div
            ref={hasNextUserPage ? loadMoreUsersRef : undefined}
            className="flex min-h-10 w-full items-center justify-center py-2"
          >
            {isLoadingUsers || isFetchingNextUserPage ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : null}
          </div>
        ) : null}
      </div>

      {showCreateChatModal === 'direct' && (
        <SideDrawer
          width="450px"
          isHeader
          isOpen={showCreateChatModal === 'direct'}
          handleClose={() => setShowCreateChatModal('')}
          content={
            <CreateDirectChat
              handleClose={() => {
                setShowCreateChatModal('');
              }}
              onChatSelect={onChatSelect}
            />
          }
        />
      )}
      {showCreateChatModal === 'team' && (
        <SideDrawer
          width="450px"
          isHeader
          isOpen={showCreateChatModal === 'team'}
          handleClose={() => setShowCreateChatModal('')}
          content={
            <CreateTeamChat
              handleClose={() => {
                setShowCreateChatModal('');
              }}
              onChatSelect={onChatSelect}
            />
          }
        />
      )}
    </div>
  );
};

const Messenger = ({ mode = 'messenger' }: { mode?: MessengerMode }) => {
  const isAgentChat = mode === 'agent-chat';
  const { features } = useCompanyFeatures();
  const omniAccess = features?.plan_features?.omni_channel || {};

  const [searchParams, setSearchParams] = useSearchParams();
  const { chatWindows = [] } = useSocketEvents();
  const [isCompactLayout, setIsCompactLayout] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1280 : false,
  );
  const queryType = isAgentChat ? 'all' : (searchParams.get('type') as ChatTab) || 'all';
  const [activeTab, setActiveTab] = useState<ChatTab>(
    ['all', 'team', 'direct', 'favorites'].includes(queryType) ? queryType : 'all',
  );

  const chatIdFromQuery = searchParams.get('chatId') || '';
  const activeChatId = isCompactLayout
    ? chatIdFromQuery
    : chatIdFromQuery || (Array.isArray(chatWindows) ? chatWindows?.[0] : '') || '';

  const rawChatTypeInUrl = searchParams.get('chatType');
  const normalizedChatTypeInUrl =
    rawChatTypeInUrl === 'all_channels' ? 'chat' : rawChatTypeInUrl || 'chat';

  const [chatType, setChatType] = useState<MessengerChatType>(
    isAgentChat ? 'chat' : (normalizedChatTypeInUrl as MessengerChatType),
  );
  const [selectedChannelType, setselectedChannelType] = useState<any>(null);
  const [selectedChat, setSelectedChat] = useState<any>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const hasChatTypeInUrl = searchParams.has('chatType');

  useEffect(() => {
    const handleResize = () => {
      setIsCompactLayout(window.innerWidth < 1280);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isAgentChat) {
      if (chatType !== 'chat') {
        setChatType('chat');
      }
      if (hasChatTypeInUrl) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('chatType');
        const nextSearch = nextParams.toString();
        navigate(nextSearch ? `${location.pathname}?${nextSearch}` : location.pathname, {
          replace: true,
        });
      }
      return;
    }

    if (chatType !== 'chat' && chatType !== 'website' && chatType !== 'captain' && chatType !== 'all_channels' && !canUseOmniChannel(omniAccess, chatType)) {
      setSelectedChat(null);
      setselectedChannelType(null);
      setChatType('chat');
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('chatType');
      const nextSearch = nextParams.toString();
      navigate(nextSearch ? `${location.pathname}?${nextSearch}` : location.pathname, {
        replace: true,
      });
      return;
    }

    if (rawChatTypeInUrl === 'all_channels') {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('chatType');
      const nextSearch = nextParams.toString();
      navigate(nextSearch ? `${location.pathname}?${nextSearch}` : location.pathname, {
        replace: true,
      });
      return;
    }

    if (chatType !== normalizedChatTypeInUrl) {
      setSelectedChat(null);
      if (chatType === 'chat') {
        navigate(location.pathname);
      } else {
        navigate(`${location.pathname}?chatType=${chatType}`);
      }
    }
  }, [
    chatType,
    hasChatTypeInUrl,
    isAgentChat,
    location.pathname,
    navigate,
    normalizedChatTypeInUrl,
    omniAccess,
    rawChatTypeInUrl,
    searchParams,
  ]);

  // useEffect(() => {
  //   const type = (searchParams.get('type') as ChatTab) || 'all';
  //   if (['all', 'team', 'direct', 'favorites'].includes(type)) {
  //     setActiveTab(type);
  //   }
  // }, [searchParams]);

  const handleBackToChatList = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('chatId');
      return next;
    });
  };

  const handleBackToOmniList = () => {
    setSelectedChat(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('chatId');
      return next;
    });
  };

  return (
    <div className="mcm-page mcm-admin">
      <div className="w-full h-full min-h-0 flex overflow-hidden bg-white">
        {chatType === 'chat' ? (
          <>
            <section
              className={cn(
                'h-full min-h-0 border-r border-gray-200 bg-white lg:w-[22rem] lg:min-w-[22rem] lg:max-w-[22rem]',
                activeChatId ? 'hidden lg:block' : 'w-full',
              )}
            >
              <SidebarContent
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                setChatType={setChatType}
                setselectedChannelType={setselectedChannelType}
                isAgentChat={isAgentChat}
                isCompactLayout={isCompactLayout}
              />
            </section>
            <section
              className={cn(
                'h-full min-h-0 w-full min-w-0 flex-1 bg-white',
                activeChatId ? 'block' : 'hidden lg:block',
              )}
            >
              <Chat
                chatId={activeChatId}
                isAgentChat={isAgentChat}
                onBackToList={isCompactLayout ? handleBackToChatList : undefined}
              />
            </section>
          </>
        ) : (
          <>
            <section
              className={cn(
                'h-full min-h-0 border-r border-gray-200 bg-white lg:max-w-[19rem] lg:min-w-[19rem] xl:max-w-[22rem] xl:min-w-[22rem]',
                selectedChat ? 'hidden lg:block' : 'block w-full',
              )}
            >
              <Sidebar
                handleChatType={setChatType}
                chatType={chatType}
                setSelectedChat={setSelectedChat}
                selectedChat={selectedChat}
                setselectedChannelType={setselectedChannelType}
                selectedChannelType={selectedChannelType}
                isCompactLayout={isCompactLayout}
              />
            </section>
            <section
              className={cn(
                'h-full min-h-0 w-full min-w-0 flex-1 bg-white',
                selectedChat ? 'block' : 'hidden lg:block',
              )}
            >
              <Content
                chatType={chatType}
                selectedChat={selectedChat}
                selectedChannelType={selectedChannelType}
                onBackToList={isCompactLayout ? handleBackToOmniList : undefined}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default Messenger;
