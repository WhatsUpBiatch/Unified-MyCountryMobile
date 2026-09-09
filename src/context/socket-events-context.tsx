import { useUser } from '@/hooks/use-user';
import { useDialpad } from '@/hooks/use-dialpad';
import { useOrganization } from '@/hooks/use-organisation';
import {
  convertDateTimeFormateApis,
  GUEST_MEETING_TOKEN_UPDATED_EVENT,
  GUEST_MEETING_TOKEN_KEY,
  getEnv,
  getSessionInfo,
  handleAlert,
  makeSipSocketConnection,
  removeEnvPrefix,
  setActiveCallTab,
  showPushNotification,
} from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Socket } from 'socket.io-client';
import notificationSound from '@/assets/audio/new-notification.mp3';
import { chatEvents } from '@/context/socket-events';
import { v4 as uuidV4 } from 'uuid';
import { toast } from 'react-toastify';
import AIChatRequestModal from '@/components/custom/ai-chat-request-modal';
import {
  AlertTriangle,
  CheckCircle2,
  X,
  HardDrive,
  ShieldAlert,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getMessagePreviewText, getNameToShow } from '@/pages/messenger/chat/message-item/helpers';
import {
  enqueueMeetingInvite,
  getMeetingEventChatId,
  normalizeMeetingInvitePayload,
  removeMeetingInvitesForChat,
} from '@/lib/meeting-invites';

function prioritizeChat(chats: any[], targetChatId: string): any[] {
  if (Array.isArray(chats) && chats?.[0]?.chatId === targetChatId) return chats;
  const copy = Array.isArray(chats) ? [...chats] : [];
  const idx = copy.findIndex((c: any) => c?.chatId === targetChatId);
  if (idx <= 0) return copy;
  const [target] = copy.splice(idx, 1);
  return [target, ...copy];
}

function createPrivateChatIdFromUsers(ids: string[]) {
  const sortAlphaNum = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
  return [...ids].sort(sortAlphaNum).join('_');
}

function mergeIncomingMessage(existingMessage: any, incomingMessage: any) {
  const base = existingMessage && typeof existingMessage === 'object' ? existingMessage : {};
  const incoming = incomingMessage && typeof incomingMessage === 'object' ? incomingMessage : {};
  const hasIncomingAttachments = Array.isArray(incoming?.attachments);
  const fallbackAttachments = Array.isArray(base?.attachments) ? base.attachments : [];

  return {
    ...base,
    ...incoming,
    messageId: incoming?.messageId || base?.messageId,
    createdAt: incoming?.createdAt || base?.createdAt,
    senderId: incoming?.senderId || base?.senderId,
    message: incoming?.message ?? base?.message,
    attachments: hasIncomingAttachments ? incoming.attachments : fallbackAttachments,
  };
}

function getSocketAck(response: any) {
  if (Array.isArray(response)) {
    return response.find((item) => item && typeof item === 'object') || response[0];
  }

  return response;
}

function isSocketAckFailure(response: any) {
  const ack = getSocketAck(response);
  if (!ack || typeof ack !== 'object') return false;

  const status = Number(ack?.status ?? ack?.statusCode);

  return (
    ack?.success === false ||
    ack?.error ||
    ack?.data?.error ||
    (Number.isFinite(status) && status >= 400)
  );
}

function extractChatFromSocketAck(response: any) {
  const ack = getSocketAck(response);
  if (!ack || typeof ack !== 'object') return null;

  const candidates = [
    ack?.chat,
    ack?.data?.chat,
    ack?.data?.result?.chat,
    ack?.data?.data?.chat,
    ack?.result?.chat,
    ack?.doc,
    ack?.data?.result,
    ack?.data,
    ack,
  ];

  return candidates.find((candidate) => candidate?.chatId) || null;
}

function normalizeUserPresenceUpdate(data: any) {
  if (!data) return null;

  if (Array.isArray(data)) {
    const [, payload] = data;
    return payload?.doc || payload || null;
  }

  return data?.doc || data;
}

function normalizeUserPresenceList(data: any) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.doc)) return data.doc;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.users)) return data.users;

  const nestedData = data?.data?.result;
  if (Array.isArray(nestedData)) return nestedData;

  return [];
}

function normalizeUserDetailUpdate(data: any) {
  if (!data) return null;

  const candidates = Array.isArray(data) ? data : [data];
  const payload = candidates
    .map((candidate: any) => candidate?.doc || candidate?.data?.doc || candidate?.data || candidate)
    .find((candidate: any) => {
      if (!candidate || typeof candidate !== 'object') return false;
      return Boolean(
        candidate?.userID ||
          candidate?.userId ||
          candidate?.uuid ||
          candidate?.user_uuid,
      );
    });

  if (!payload) return null;

  const userId = String(
    payload?.userID || payload?.userId || payload?.uuid || payload?.user_uuid || '',
  ).trim();
  if (!userId) return null;

  const userPatch: Record<string, any> = {};
  const patchableFields = [
    'name',
    'email',
    'extension',
    'profile',
    'first_name',
    'last_name',
  ];

  patchableFields.forEach((field) => {
    if (payload?.[field] === undefined || payload?.[field] === null) return;
    userPatch[field] = typeof payload[field] === 'string' ? payload[field].trim() : payload[field];
  });

  return { userId, userPatch };
}

function updateUserDetailsInChats(chats: any[], userId: string, userPatch: Record<string, any>) {
  if (!Array.isArray(chats) || !userId || !Object.keys(userPatch).length) return chats;

  let didUpdateChat = false;
  const updatedChats = chats.map((chat: any) => {
    if (!Array.isArray(chat?.users)) return chat;

    let didUpdateUser = false;
    const users = chat.users.map((chatUser: any) => {
      const chatUserId = String(
        chatUser?.uuid || chatUser?.userID || chatUser?.userId || chatUser?.user_uuid || '',
      ).trim();
      if (chatUserId !== userId) return chatUser;

      didUpdateUser = true;
      return { ...chatUser, ...userPatch };
    });

    if (!didUpdateUser) return chat;
    didUpdateChat = true;
    return { ...chat, users };
  });

  return didUpdateChat ? updatedChats : chats;
}

function normalizeTranscribeDetailPayload(raw: any) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    if (raw[1] && typeof raw[1] === 'object') return raw[1];
    if (raw[0] && typeof raw[0] === 'object') return raw[0];
    return null;
  }
  if (raw?.doc && typeof raw.doc === 'object') return raw.doc;
  if (raw?.data && typeof raw.data === 'object') return raw.data;
  if (typeof raw === 'object') return raw;
  return null;
}

function extractTranscribeText(payload: any) {
  const textValue = payload?.text;
  if (typeof textValue === 'string') return textValue.trim();
  if (textValue && typeof textValue === 'object') {
    const preferred =
      payload?.original_language && typeof textValue?.[payload.original_language] === 'string'
        ? textValue[payload.original_language]
        : '';

    if (preferred?.trim()) return preferred.trim();

    const firstValue = Object.values(textValue).find((value) => typeof value === 'string') as
      | string
      | undefined;
    return (firstValue || '').trim();
  }
  return '';
}

function extractTranscribeTextByLanguageMap(payload: any) {
  const textValue = payload?.text;
  if (!textValue || typeof textValue !== 'object' || Array.isArray(textValue)) return null;

  const entries = Object.entries(textValue)
    .map(([language, text]) => [
      String(language || '')
        .trim()
        .toLowerCase(),
      String(text || '').trim(),
    ])
    .filter(([language, text]) => Boolean(language && text));

  if (!entries.length) return null;
  return Object.fromEntries(entries);
}

function normalizeLanguageKey(value: string = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
}

function getAttachmentNotificationLabel(attachment: any): string {
  const type = String(attachment?.type || attachment?.mimeType || '').toLowerCase();
  const fileName = String(
    attachment?.fileName || attachment?.name || attachment?.filename || '',
  ).toLowerCase();

  const isImage = type.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(fileName);
  const isVideo = type.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(fileName);
  const isAudio = type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac)$/i.test(fileName);
  const isDocument =
    type.includes('pdf') ||
    type.includes('document') ||
    type.includes('text/') ||
    /\.(pdf|docx?|xlsx?|pptx?|txt|csv)$/i.test(fileName);

  if (isImage) return 'image';
  if (isVideo) return 'video';
  if (isAudio) return 'audio';
  if (isDocument) return 'document';
  return 'file';
}

function getIncomingMessageNotificationBody(messageData: any): string {
  const messageText = getMessagePreviewText(messageData?.message || '');
  if (messageText) return messageText;

  const attachments = Array.isArray(messageData?.attachments) ? messageData.attachments : [];
  if (attachments.length > 0) {
    if (attachments.length === 1) {
      const label = getAttachmentNotificationLabel(attachments[0]);
      if (label === 'image') return 'Sent an image';
      if (label === 'video') return 'Sent a video';
      if (label === 'audio') return 'Sent an audio message';
      if (label === 'document') return 'Sent a document';
      return 'Sent a file';
    }
    return `Sent ${attachments.length} attachments`;
  }

  const gifTitle = String(messageData?.gif?.title || '').trim();
  if (gifTitle) return `GIF: ${gifTitle}`;

  return 'New message';
}

function extractSelectedTranscribeEntry(payload: any, selectedLanguage = '') {
  const textByLanguage = extractTranscribeTextByLanguageMap(payload);
  const preferredLanguage = normalizeLanguageKey(
    selectedLanguage ||
      payload?.language ||
      payload?.selected_language ||
      payload?.translation_language ||
      '',
  );
  const originalLanguage = normalizeLanguageKey(payload?.original_language || '');

  if (textByLanguage && typeof textByLanguage === 'object') {
    if (preferredLanguage && textByLanguage?.[preferredLanguage]) {
      const text = String(textByLanguage[preferredLanguage] || '').trim();
      return text
        ? { language: preferredLanguage, text, textByLanguage: { [preferredLanguage]: text } }
        : null;
    }

    if (originalLanguage && textByLanguage?.[originalLanguage]) {
      const text = String(textByLanguage[originalLanguage] || '').trim();
      return text
        ? { language: originalLanguage, text, textByLanguage: { [originalLanguage]: text } }
        : null;
    }

    const firstEntry = Object.entries(textByLanguage).find(([language, text]) =>
      Boolean(String(language || '').trim() && String(text || '').trim()),
    );
    if (firstEntry) {
      const [language, text] = firstEntry;
      const normalizedLanguage = normalizeLanguageKey(language);
      const selectedText = String(text || '').trim();
      return selectedText
        ? {
            language: normalizedLanguage,
            text: selectedText,
            textByLanguage: normalizedLanguage ? { [normalizedLanguage]: selectedText } : null,
          }
        : null;
    }
  }

  const fallbackText = extractTranscribeText(payload);
  if (!fallbackText) return null;
  const fallbackLanguage = preferredLanguage || originalLanguage;
  return {
    language: fallbackLanguage,
    text: fallbackText,
    textByLanguage: fallbackLanguage ? { [fallbackLanguage]: fallbackText } : null,
  };
}

export type PinConversationAction = 'pin' | 'unpin';

export interface PinConversationPayload {
  chatId: string;
  userID: string;
  type: PinConversationAction;
}

export function emitPinConversationEvent(
  socket: Socket | null,
  payload: PinConversationPayload,
  callback?: (response: any) => void,
) {
  if (!socket || !payload?.chatId || !payload?.userID || !payload?.type) return;
  socket.emit(chatEvents.PIN_CONVERSATION, payload, (response: any) => {
    callback?.(response);
  });
}

export const createPrivateChatId = (obj: any) => {
  const sortAlphaNum = (a: any, b: any) => a.localeCompare(b, 'en', { numeric: true });
  return obj.sort(sortAlphaNum).join('_');
};

type LeadProcessNotification = {
  id: string;
  success: number;
  fail: number;
  duplicate: number;
  entityLabel: 'Lead' | 'Contact';
};

type AdminNotification = {
  type?: string;
  title?: string;
  description?: string;
  version?: string;
  publishAt?: string;
  adminNotificationUuid: string;
  unread: boolean;
  companyUuid?: string;
  userUuid?: string;
};

interface SocketEventsType {
  allLiveCalls: Array<any>;
  usersOnlineStatus: Array<any>;
  unreadCount: any;
  unreadSMSCount: any;
  unreadTaskCount: number;
  ongoingLiveCalls: any;
  conferenceParticipants: Array<any>;
  conferenceTracker: Array<any>;
  socketEventsManager: Socket | null;
  setConferenceTracker: any;
  getUnreadSMSCount: any;
  updateSmsCount: any;
  setSmsUnreadCountArray: any;
  smsUnreadCountArray: Array<any>;
  getNotifications: () => void;
  markReadNotification: (p: any) => void;
  mergeSeparateCalls: (params: {
    mainCallId: string;
    secondaryCallId: string;
    _uiSessions: any;
    mainCallDirection: string;
  }) => Promise<{ success: boolean }>;
  notificationArr: any[];
  notificationLoading: boolean;
  ongoingDepartmentCalls: any;
  liveTranscriptionList: Array<any>;
  setLiveTranscriptionList: any;
  userActivity: any;
  transcriptionSocket: any;
  userActivitiesList: any;
  disconnectSocket: () => void;
  activityLoader: boolean;
  ongoingCampaignActivity: any;
  omniChannelData: any;
  setOmniChannelData: any;
  callSummary: any;
  setCallSummary: any;
  setOngoingCampaignActivity: any;
  userLogoutData: any;
  setUserLogoutData: any;
  inCallTranscription: any;
  setInCallTranscription: any;
  handleOnCallTranscript: any;
  transcriptionActiveKeys: string[];
  addTranscriptionActiveKey: (key: string) => void;
  removeTranscriptionActiveKey: (key: string) => void;
  isSocketConnected: boolean;
  callingInProgress: boolean;
  callPresence: any;
  allChats: Array<any>;
  allAgentChats: Array<any>;
  getAgentChats: (payload?: any, callback?: (response: any) => void) => void;
  messageList: Array<any>;
  setMessageList: any;
  pinnedList: Array<any>;
  threadsManager: Array<any>;
  setThreadsManager: any;
  typingList: any;
  chatPageList: any;
  isFetchingMessages: any;
  hasMessagesTopNextPage: any;
  hasMessagesBottomNextPage: any;
  chatWindows: Array<string>;
  setChatWindows: any;
  chatWindowsMaximized: any;
  setChatWindowsMaximized: any;
  meetWindows: Array<any>;
  setMeetWindows: any;
  meetInitiateModalData: any;
  setMeetInitiateModalData: any;
  meetingAcceptingChatId: string | null;
  setMeetingAcceptingChatId: React.Dispatch<React.SetStateAction<string | null>>;
  chatMode: boolean;
  setChatMode: any;
  activityCount: {
    all: number;
    mention: number;
    request: number;
    meeting: number;
  };
  activityList: any;
  setActivityList: any;
  unreadMessageCount: number;
  groupChatUnreadCount: number;
  directMessageUnreadCount: number;
  aiChatUnreadCount: number;
  recentMeetings: any[];
  recentTasks: any[];
  setRecentMeetings: any;
  setRecentTasks: any;
  handleOpenChatInWindow: (chatId: string, remove?: boolean, maximize?: boolean) => void;
  createNewChat: (
    otherPersonDetails: any,
    maximize?: boolean,
    message?: string,
    isForwarded?: boolean,
    chatId?: string,
    attachments?: any[],
  ) => void;
  chatExist: (chatId: string) => any;
  createPrivateChatId: (ids: string[]) => string;
  handleSendMessage: (message: any, callback?: (response: any) => void) => void;
  handleGetMessageByChatId: (params: any) => void;
  getChatPinnedMessages: (chatId: string, callback?: (response: any) => void) => void;
  handleUnread: (payload: any, fromClick?: boolean, socket?: any) => void;
  handleTyping: (
    payload: { currentChat: any; isTyping: boolean },
    callback?: (response: any) => void,
  ) => void;
  handleToggleChatAsFavorite: (chatId: string, callback?: (response: any) => void) => void;
  handleDeleteChat: (chatId: string, callback?: (response: any) => void) => void;
  handleExitChat: (chatId: string, callback?: (response: any) => void) => void;
  handleAddChannelMember: (
    chatId: string,
    members: any[],
    callback?: (response: any) => void,
  ) => void;
  handleRemoveChannelMember: (
    chatId: string,
    members: string[],
    callback?: (response: any) => void,
  ) => void;
  handleMeetInviteMember: (payload: any, callback?: (response: any) => void) => void;
  handlePinMessage: (payload: any, callback?: (response: any) => void) => void;
  handleUserPresenceUpdate: (payload: any, callback?: (response: any) => void) => void;
  handleAssignAdminPrivileges: (
    chatId: string,
    id: string,
    callback?: (response: any) => void,
  ) => void;
  handleAddChannelImage: (
    chatId: string,
    avatar: string,
    callback?: (response: any) => void,
  ) => void;
  handleRemoveChannelImage: (chatId: string, callback?: (response: any) => void) => void;
  handleDeleteMessage: (msgObj: any, chatId: string, callback?: (response: any) => void) => void;
  handleActivityStatus: (
    type?: string,
    activityID?: string,
    callback?: (response: any) => void,
  ) => void;
  handleMeetInitiate: (payload: any, callback?: (response: any) => void) => void;
  handleMeetAccept: (payload: any, callback?: (response: any) => void) => void;
  handleMeetDecline: (payload: any, callback?: (response: any) => void) => void;
  handleMeetLeave: (payload: any, callback?: (response: any) => void) => void;
  handleMeetMissed: (payload: any, callback?: (response: any) => void) => void;
  handleTerminateCall: (payload: any, callback?: (response: any) => void) => void;
  handleUpdateMessage: (payload: any, callback?: (response: any) => void) => void;
  handleSendReaction: (payload: any, callback?: (response: any) => void) => void;
  handleUpdateChatname: (payload: any, callback?: (response: any) => void) => void;
  handleUpdateChannel: (payload: any, callback?: (response: any) => void) => void;
  handlePinConversation: (
    payload: { chatId: string; type: PinConversationAction; userID?: string },
    callback?: (response: any) => void,
  ) => void;
  handleMuteConversation: (payload: any, callback?: (response: any) => void) => void;
  handleLeaveBeforeJoin: (payload: any, callback?: (response: any) => void) => void;
  getSeenByList: (payload: any, callback: any) => void;
  searchMessages: (params: {
    chatId: string;
    userID: string;
    keyword: string;
    cb: (results: any[]) => void;
  }) => void;
  notesList: Array<any>;
  folderList: Array<any>;
  handleCreateNote: (payload: any, callback?: (response: any) => void) => void;
  handleDeleteNote: (payload: any, callback?: (response: any) => void) => void;
  handleUpdateNote: (payload: any, callback?: (response: any) => void) => void;
  getNotesByChatId: (payload: any, callback?: (response: any) => void) => void;
  getFoldersByChatId: (payload: any, callback?: (response: any) => void) => void;
  handleCreateFolder: (payload: any, callback?: (response: any) => void) => void;
  handleDeleteFolder: (payload: any, callback?: (response: any) => void) => void;
  handleUpdateFolder: (payload: any, callback?: (response: any) => void) => void;
  handlePinFolder: (payload: any, callback?: (response: any) => void) => void;
  handlePinFolderAttachment: (payload: any, callback?: (response: any) => void) => void;
  getAttachmentsByChatId: (payload: any, callback?: (response: any) => void) => void;
  liveCalls: Array<any>;
  setLiveCalls: any;
  eventLiveCallsData: any;
  setEventLiveCallsData: any;
  callHistoryLiveUpdate: { payload: any; receivedAt: number } | null;
  liveQueueCalls: Array<any>;
  setLiveQueueCalls: any;
  activeCampaigns: Array<any>;
  setActiveCampaigns: any;
  campaignCallFlowFunnel: any;
  setCampaignCallFlowFunnel: any;
  campaignAgents: any;
  setCampaignAgents: any;
  getCampaignLiveCalls: (payload: any, callback?: (response: any) => void) => void;
  campaignLiveCallsData: any;
  setCampaignLiveCallsData: any;
  aiLiveWallboardData: any;
  setAiLiveWallboardData: any;
  campaignAiLiveCallData: any;
  setCampaignAiLiveCallData: any;
  getAiLiveWallboardData: (payload: any, callback?: (response: any) => void) => void;
  contactsInfo: Record<string, any>;
  upsertContactInfoByNumber: (number: string, contactData: any) => void;
  aiChatRequests: any[];
  setAiChatRequests: React.Dispatch<React.SetStateAction<any[]>>;
  handleAiChatAccept: (payload: any, callback?: (response: any) => void) => void;
  handleAiChatDecline: (payload: any, callback?: (response: any) => void) => void;
  sentimentData: any;
  meetingSubtitlesByChatId: Record<string, any[]>;
  clearMeetingSubtitles: (chatId?: string) => void;
  updateMeetingSubtitleLanguage: (chatId?: string, language?: string) => void;
  updateMeetingSubtitleEnabled: (chatId?: string, enabled?: boolean) => void;
}

export const SocketEvents = createContext<SocketEventsType>({
  allLiveCalls: [],
  usersOnlineStatus: [],
  unreadCount: 0,
  unreadSMSCount: 0,
  unreadTaskCount: 0,
  conferenceParticipants: [],
  conferenceTracker: [],
  ongoingLiveCalls: {},
  socketEventsManager: null,
  setConferenceTracker: () => void 0,
  getUnreadSMSCount: () => void 0,
  updateSmsCount: () => void 0,
  setSmsUnreadCountArray: () => void 0,
  mergeSeparateCalls: async () => ({ success: false }),
  smsUnreadCountArray: [],
  getNotifications: () => null,
  markReadNotification: () => null,
  notificationArr: [],
  notificationLoading: false,
  ongoingDepartmentCalls: {},
  liveTranscriptionList: [],
  setLiveTranscriptionList: () => void 0,
  userActivity: () => null,
  transcriptionSocket: () => null,
  userActivitiesList: [],
  disconnectSocket: () => 0,
  activityLoader: false,
  ongoingCampaignActivity: null,
  omniChannelData: null,
  setOmniChannelData: null,
  callSummary: null,
  setCallSummary: () => void 0,
  setOngoingCampaignActivity: () => void 0,
  userLogoutData: null,
  setUserLogoutData: null,
  inCallTranscription: {},
  setInCallTranscription: () => void 0,
  handleOnCallTranscript: () => void 0,
  transcriptionActiveKeys: [],
  addTranscriptionActiveKey: () => void 0,
  removeTranscriptionActiveKey: () => void 0,
  isSocketConnected: false,
  callingInProgress: false,
  callPresence: {},
  allChats: [],
  allAgentChats: [],
  getAgentChats: () => void 0,
  messageList: [],
  setMessageList: () => void 0,
  pinnedList: [],
  threadsManager: [],
  setThreadsManager: () => void 0,
  typingList: {},
  chatPageList: {},
  isFetchingMessages: {},
  hasMessagesTopNextPage: {},
  hasMessagesBottomNextPage: {},
  chatWindows: [],
  setChatWindows: () => void 0,
  chatWindowsMaximized: {},
  setChatWindowsMaximized: () => void 0,
  meetWindows: [],
  setMeetWindows: () => void 0,
  meetInitiateModalData: null,
  setMeetInitiateModalData: () => void 0,
  meetingAcceptingChatId: null,
  setMeetingAcceptingChatId: () => void 0,
  chatMode: false,
  setChatMode: () => void 0,
  activityCount: { all: 0, mention: 0, request: 0, meeting: 0 },
  activityList: {
    all: { page: 0, data: [], isLoading: false, hasMore: false, type: 'all' },
    mention: { page: 0, data: [], isLoading: false, hasMore: false, type: 'mention' },
    request: { page: 0, data: [], isLoading: false, hasMore: false, type: 'request' },
    meeting: { page: 0, data: [], isLoading: false, hasMore: false, type: 'meeting' },
  },
  setActivityList: () => void 0,
  unreadMessageCount: 0,
  groupChatUnreadCount: 0,
  directMessageUnreadCount: 0,
  aiChatUnreadCount: 0,
  recentMeetings: [],
  recentTasks: [],
  setRecentMeetings: () => void 0,
  setRecentTasks: () => void 0,
  handleOpenChatInWindow: () => void 0,
  createNewChat: () => void 0,
  chatExist: () => null,
  createPrivateChatId: () => '',
  handleSendMessage: () => void 0,
  handleGetMessageByChatId: () => void 0,
  getChatPinnedMessages: () => void 0,
  handleUnread: () => void 0,
  handleTyping: () => void 0,
  handleToggleChatAsFavorite: () => void 0,
  handleDeleteChat: () => void 0,
  handleExitChat: () => void 0,
  handleAddChannelMember: () => void 0,
  handleRemoveChannelMember: () => void 0,
  handleMeetInviteMember: () => void 0,
  handlePinMessage: () => void 0,
  handleUserPresenceUpdate: () => void 0,
  handleAssignAdminPrivileges: () => void 0,
  handleAddChannelImage: () => void 0,
  handleRemoveChannelImage: () => void 0,
  handleDeleteMessage: () => void 0,
  handleActivityStatus: () => void 0,
  handleMeetInitiate: () => void 0,
  handleMeetAccept: () => void 0,
  handleMeetDecline: () => void 0,
  handleMeetLeave: () => void 0,
  handleMeetMissed: () => void 0,
  handleTerminateCall: () => void 0,
  handleUpdateMessage: () => void 0,
  handleSendReaction: () => void 0,
  handleUpdateChatname: () => void 0,
  handleUpdateChannel: () => void 0,
  handlePinConversation: () => void 0,
  handleMuteConversation: () => void 0,
  handleLeaveBeforeJoin: () => void 0,
  getSeenByList: () => void 0,
  searchMessages: () => void 0,
  handleCreateNote: () => void 0,
  handleDeleteNote: () => void 0,
  handleUpdateNote: () => void 0,
  getNotesByChatId: () => void 0,
  getFoldersByChatId: () => void 0,
  handleCreateFolder: () => void 0,
  handleDeleteFolder: () => void 0,
  handleUpdateFolder: () => void 0, // callback overload handled at runtime
  handlePinFolder: () => void 0,
  handlePinFolderAttachment: () => void 0,
  getAttachmentsByChatId: () => void 0,
  notesList: [],
  folderList: [],
  liveCalls: [],
  setLiveCalls: () => void 0,
  eventLiveCallsData: null,
  setEventLiveCallsData: () => void 0,
  callHistoryLiveUpdate: null,
  liveQueueCalls: [],
  setLiveQueueCalls: () => void 0,
  activeCampaigns: [],
  setActiveCampaigns: () => void 0,
  campaignCallFlowFunnel: null,
  setCampaignCallFlowFunnel: () => void 0,
  campaignAgents: null,
  setCampaignAgents: () => void 0,
  getCampaignLiveCalls: () => void 0,
  campaignLiveCallsData: null,
  setCampaignLiveCallsData: () => void 0,
  aiLiveWallboardData: null,
  setAiLiveWallboardData: () => void 0,
  campaignAiLiveCallData: null,
  setCampaignAiLiveCallData: () => void 0,
  getAiLiveWallboardData: () => void 0,
  contactsInfo: {},
  upsertContactInfoByNumber: () => void 0,
  aiChatRequests: [],
  setAiChatRequests: () => void 0,
  handleAiChatAccept: () => void 0,
  handleAiChatDecline: () => void 0,
  sentimentData: {},
  meetingSubtitlesByChatId: {},
  clearMeetingSubtitles: () => void 0,
  updateMeetingSubtitleLanguage: () => void 0,
  updateMeetingSubtitleEnabled: () => void 0,
});

export const SocketEventsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useUser();
  const { mainSiteInfo } = useOrganization();
  console.log({ user });
  const { updateConferenceDataBySipCallIds } = useDialpad();
  const location = useLocation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const queryClient: any = useQueryClient();
  const [socketEventsManager, setSocketEventsManager] = useState<Socket | null>(null);
  const [ongoingLiveCalls, setOngoingLiveCalls] = useState<any>({});
  const [allLiveCalls, setAllLiveCalls] = useState<any>([]);
  const [eventLiveCallsData, setEventLiveCallsData] = useState<any>(null);
  /* Fires once per completed/updated call_history row (cdr-ingest, server
     121, pushes this the moment it inserts or merges a row - see
     [[live-call-history-push]]). Consumers re-fetch their own call list off
     this rather than the payload being spliced in directly, so pagination
     and active filters stay exactly as correct as a normal fetch. */
  const [callHistoryLiveUpdate, setCallHistoryLiveUpdate] = useState<{
    payload: any;
    receivedAt: number;
  } | null>(null);
  const [conferenceParticipants, setConferenceParticipants] = useState<Array<any>>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadSMSCount, setUnreadSMSCount] = useState(0);
  const [unreadTaskCount, setUnreadTaskCount] = useState(0);
  const [smsUnreadCountArray, setSmsUnreadCountArray] = useState([]);
  const [notificationArr, setNotificationArr] = useState([]);
  const [notificationLoading, setNotificationLoading] = useState<boolean>(false);
  const [usersOnlineStatus, setUsersOnlineStatus] = useState<any>([]);
  const [conferenceTracker, setConferenceTracker] = useState<Array<any>>([]);
  const [ongoingDepartmentCalls, setOngoingDepartmentCalls] = useState<any>({});
  const [liveTranscriptionList, setLiveTranscriptionList] = useState<Array<any>>([]);
  const [callSummary, setCallSummary] = useState<any>(null);
  const [userActivitiesList, setUserActivitiesList] = useState<Array<any>>([]);
  const [activityLoader, setActivityLoader] = useState<boolean>(false);
  const [ongoingCampaignActivity, setOngoingCampaignActivity] = useState<any>(null);
  const [omniChannelData, setOmniChannelData] = useState();
  const [userLogoutData, setUserLogoutData] = useState();
  const [isDisconnecting, setIsDisconnecting] = useState<boolean>(false);
  const [guestTokenVersion, setGuestTokenVersion] = useState(0);
  const [inCallTranscription, setInCallTranscription] = useState<any>({});
  const [transcriptionActiveKeys, setTranscriptionActiveKeys] = useState<string[]>([]);
  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(false);
  const [callingInProgress, setIsCallingInProgress] = useState<boolean>(false);
  const [callPresence, setCallPresence] = useState<any>({});
  const [showRoleUpdateReloadModal, setShowRoleUpdateReloadModal] = useState<boolean>(false);

  const [roleUpdateMessage, setRoleUpdateMessage] = useState<string>('');
  const [adminNotification, setAdminNotification] = useState<AdminNotification | null>(null);
  const [isRefreshingForUpdate, setIsRefreshingForUpdate] = useState<boolean>(false);

  useEffect(() => {
    console.log('MMMM SocketEventsProvider MOUNTED');
    return () => {
      console.log('MMMM SocketEventsProvider UNMOUNTED');
    };
  }, []);
  const [allChats, setAllChats] = useState<any>([]);
  const [allAgentChats, setAllAgentChats] = useState<any>([]);
  const [messageList, setMessageList] = useState<any>([]);
  const [pinnedList, setPinnedList] = useState<any>([]);
  const [threadsManager, setThreadsManager] = useState<any>([]);
  const [notesList, setNotesList] = useState<any>([]);
  const [folderList, setFolderList] = useState<any>([]);
  const [typingList, setTypingList] = useState<any>({});
  const [chatPageList, setChatPageList] = useState<any>({});
  const [isFetchingMessages, setIsFetchingMessages] = useState<any>({});
  const [hasMessagesTopNextPage, setHasMessagesTopNextPage] = useState<any>({});
  const [hasMessagesBottomNextPage, setHasMessagesBottomNextPage] = useState<any>({});
  const [chatWindows, setChatWindows] = useState<any>([]);
  const [chatWindowsMaximized, setChatWindowsMaximized] = useState<any>({});
  const [meetWindows, setMeetWindows] = useState<any>([]);
  const [meetInitiateModalData, setMeetInitiateModalData] = useState<any>(null);
  const [meetingAcceptingChatId, setMeetingAcceptingChatId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<boolean>(false);
  const [storageLimitData, setStorageLimitData] = useState<any>(null);
  const [isStorageModalOpen, setIsStorageModalOpen] = useState<boolean>(false);
  const [activityCount, setActivityCount] = useState<{
    all: number;
    mention: number;
    request: number;
    meeting: number;
  }>({
    all: 0,
    mention: 0,
    request: 0,
    meeting: 0,
  });
  const [activityList, setActivityList] = useState<any>({
    all: { page: 0, data: [], isLoading: false, hasMore: false, type: 'all' },
    mention: {
      page: 0,
      data: [],
      isLoading: false,
      hasMore: false,
      type: 'mention',
    },
    request: {
      page: 0,
      data: [],
      isLoading: false,
      hasMore: false,
      type: 'request',
    },
    meeting: {
      page: 0,
      data: [],
      isLoading: false,
      hasMore: false,
      type: 'meeting',
    },
  });
  const [unreadMessageCount, setUnreadMessageCount] = useState<number>(0);
  const [groupChatUnreadCount, setGroupChatUnreadCount] = useState<number>(0);
  const [directMessageUnreadCount, setDirectMessageUnreadCount] = useState<number>(0);
  const [aiChatUnreadCount, setAiChatUnreadCount] = useState<number>(0);
  const [recentMeetings, setRecentMeetings] = useState<any[]>([]);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [liveCalls, setLiveCalls] = useState<any[]>([]);
  const [liveQueueCalls, setLiveQueueCalls] = useState<any[]>([]);

  /* The sandbox has no socket behind it, so waiting callers, live calls and
     presence never arrived and every live figure in the app sat at zero with
     the whole roster reading "Offline" - correct, and impossible to judge a
     queue board or a status table against. In mock mode only, a plausible
     floor is seeded in their place.

     import.meta.env.MODE is replaced with a literal at build time, so this
     branch and the module it imports are dropped from a production build. */
  useEffect(() => {
    if (import.meta.env.MODE !== 'mock') return;
    let cancelled = false;
    import('@/mock/live-floor')
      .then(({ buildDemoFloor }) => buildDemoFloor())
      .then((floor) => {
        if (cancelled) return;
        setLiveCalls(floor.liveCalls);
        setUsersOnlineStatus(floor.presence);
        setLiveQueueCalls(floor.queueStats);
      })
      .catch(() => {
        /* A sandbox nicety; if it cannot be built the app still runs on the
           empty floor it had before. */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [activeCampaigns, setActiveCampaigns] = useState<any[]>([]);
  const [campaignCallFlowFunnel, setCampaignCallFlowFunnel] = useState<any>(null);
  const [campaignAgents, setCampaignAgents] = useState<any>(null);
  const [campaignLiveCallsData, setCampaignLiveCallsData] = useState<any>(null);
  const [aiLiveWallboardData, setAiLiveWallboardData] = useState<any>(null);
  const [campaignAiLiveCallData, setCampaignAiLiveCallData] = useState<any>(null);
  const [contactsInfo, setContactsInfo] = useState<Record<string, any>>({});
  const [aiChatRequests, setAiChatRequests] = useState<any[]>(() => {
    try {
      const stored = localStorage.getItem('ai_chat_requests');
      return stored ? (JSON.parse(stored) as any[]) : [];
    } catch {
      return [];
    }
  });
  const [showAiChatModal, setShowAiChatModal] = useState<boolean>(false);
  const [leadProcessNotifications, setLeadProcessNotifications] = useState<
    LeadProcessNotification[]
  >([]);

  const dismissLeadProcessNotification = useCallback((id: string) => {
    setLeadProcessNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    const handleGuestTokenUpdate = () => {
      setGuestTokenVersion((prev) => prev + 1);
    };

    window.addEventListener(GUEST_MEETING_TOKEN_UPDATED_EVENT, handleGuestTokenUpdate);
    return () => {
      window.removeEventListener(GUEST_MEETING_TOKEN_UPDATED_EVENT, handleGuestTokenUpdate);
    };
  }, []);

  // Keep localStorage in sync with the live requests array
  useEffect(() => {
    try {
      localStorage.setItem('ai_chat_requests', JSON.stringify(aiChatRequests));
    } catch {
      // ignore quota / serialisation errors
    }
  }, [aiChatRequests]);

  const [sentimentData, setSentimentData] = useState<any>({});
  const [meetingSubtitlesByChatId, setMeetingSubtitlesByChatId] = useState<Record<string, any[]>>(
    {},
  );
  const [meetingSubtitleLanguageByChatId, setMeetingSubtitleLanguageByChatId] = useState<
    Record<string, string>
  >({});
  const [meetingSubtitleEnabledByChatId, setMeetingSubtitleEnabledByChatId] = useState<
    Record<string, boolean>
  >({});
  const meetingSubtitleLanguageByChatIdRef = useRef<Record<string, string>>({});
  const meetingSubtitleEnabledByChatIdRef = useRef<Record<string, boolean>>({});
  const processedMessageIdsRef = useRef<Record<string, Set<string>>>({});
  const socketEventsManagerRef = useRef<Socket | null>(null);
  const allChatsRef = useRef<any[]>([]);
  const allAgentChatsRef = useRef<any[]>([]);
  const messageNotificationsRef = useRef<Record<string, Notification | null>>({});

  useEffect(() => {
    meetingSubtitleLanguageByChatIdRef.current = meetingSubtitleLanguageByChatId || {};
  }, [meetingSubtitleLanguageByChatId]);

  useEffect(() => {
    meetingSubtitleEnabledByChatIdRef.current = meetingSubtitleEnabledByChatId || {};
  }, [meetingSubtitleEnabledByChatId]);

  useEffect(() => {
    socketEventsManagerRef.current = socketEventsManager;
  }, [socketEventsManager]);

  useEffect(() => {
    allChatsRef.current = Array.isArray(allChats) ? allChats : [];
  }, [allChats]);

  useEffect(() => {
    allAgentChatsRef.current = Array.isArray(allAgentChats) ? allAgentChats : [];
  }, [allAgentChats]);

  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const closeMessageNotificationForChat = useCallback((chatId = '') => {
    const normalizedChatId = String(chatId || '').trim();
    if (!normalizedChatId) return;
    const existingNotification = messageNotificationsRef.current[normalizedChatId];
    if (existingNotification) {
      try {
        existingNotification.close();
      } catch {
        // ignore notification close errors
      }
      delete messageNotificationsRef.current[normalizedChatId];
    }
  }, []);

  const closeAllMessageNotifications = useCallback(() => {
    Object.keys(messageNotificationsRef.current).forEach((chatId) => {
      const existingNotification = messageNotificationsRef.current[chatId];
      if (existingNotification) {
        try {
          existingNotification.close();
        } catch {
          // ignore notification close errors
        }
      }
    });
    messageNotificationsRef.current = {};
  }, []);

  useEffect(() => {
    return () => {
      closeAllMessageNotifications();
    };
  }, [closeAllMessageNotifications]);

  const getMessageNotificationNavigationUrl = useCallback((chatId = '') => {
    const normalizedChatId = String(chatId || '').trim();
    if (!normalizedChatId) return '/messenger';

    const notificationQuery = 'openFromNotification=1';
    const allKnownChats = [...(allChatsRef.current || []), ...(allAgentChatsRef.current || [])];
    const targetChat = allKnownChats.find(
      (chat: any) => String(chat?.chatId || '').trim() === normalizedChatId,
    );
    const groupType = String(targetChat?.groupType || '')
      .trim()
      .toUpperCase();

    if (groupType === 'AI') {
      return `/agent-chat?chatId=${encodeURIComponent(normalizedChatId)}&type=active&${notificationQuery}`;
    }

    return `/messenger?channel=chat&type=all&chatId=${encodeURIComponent(normalizedChatId)}&${notificationQuery}`;
  }, []);

  const showIncomingMessageNotification = useCallback(
    ({
      chatId = '',
      chatName = '',
      messageData = {},
    }: {
      chatId: string;
      chatName: string;
      messageData: any;
    }) => {
      if (typeof window === 'undefined' || !('Notification' in window)) return;

      const normalizedChatId = String(chatId || '').trim();
      if (!normalizedChatId) return;
      if (Notification.permission === 'denied') return;

      const title = chatName || 'New message';
      const body = getIncomingMessageNotificationBody(messageData);
      const favIconPath = String(mainSiteInfo?.fav_icon || '').trim();
      const notificationIcon = (() => {
        if (favIconPath) {
          if (/^https?:\/\//i.test(favIconPath)) return favIconPath;
          const baseUrl = (getEnv() as { VITE_API_BASE_URL?: string }).VITE_API_BASE_URL || '';
          const normalizedPath = favIconPath.replace(/^\/+/, '');
          return baseUrl ? `${baseUrl}/${normalizedPath}` : `/${normalizedPath}`;
        }
        const fallbackIcon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href;
        return fallbackIcon || '/fav.ico';
      })();

      const createNotification = () => {
        closeMessageNotificationForChat(normalizedChatId);

        const notification = new Notification(title, {
          body,
          icon: notificationIcon,
          tag: `chat-message-${normalizedChatId}`,
        });

        messageNotificationsRef.current[normalizedChatId] = notification;

        notification.onclick = () => {
          try {
            notification.close();
          } catch {
            // ignore notification close errors
          }
          closeMessageNotificationForChat(normalizedChatId);
          window.focus();
          navigate(getMessageNotificationNavigationUrl(normalizedChatId));
        };

        notification.onclose = () => {
          if (messageNotificationsRef.current[normalizedChatId] === notification) {
            delete messageNotificationsRef.current[normalizedChatId];
          }
        };
      };

      if (Notification.permission === 'granted') {
        createNotification();
        return;
      }

      Notification.requestPermission()
        .then((permission) => {
          if (permission === 'granted') {
            createNotification();
          }
        })
        .catch(() => {
          // ignore notification permission errors
        });
    },
    [
      closeMessageNotificationForChat,
      getMessageNotificationNavigationUrl,
      mainSiteInfo?.fav_icon,
      navigate,
    ],
  );

  const clearMeetingSubtitles = useCallback((chatId = '') => {
    if (!chatId) {
      setMeetingSubtitlesByChatId({});
      return;
    }
    setMeetingSubtitlesByChatId((prev) => {
      const next = { ...(prev || {}) };
      Object.keys(next).forEach((key) => {
        if (key === chatId || key.endsWith(`_${chatId}`)) {
          delete next[key];
        }
      });
      return next;
    });
  }, []);

  const updateMeetingSubtitleLanguage = useCallback((chatId = '', language = '') => {
    const normalizedChatId = String(chatId || '').trim();
    const normalizedLanguage = normalizeLanguageKey(language);
    if (!normalizedChatId || !normalizedLanguage) return;

    setMeetingSubtitleLanguageByChatId((prev) => ({
      ...(prev || {}),
      [normalizedChatId]: normalizedLanguage,
    }));
  }, []);

  const updateMeetingSubtitleEnabled = useCallback((chatId = '', enabled = false) => {
    const normalizedChatId = String(chatId || '').trim();
    if (!normalizedChatId) return;

    setMeetingSubtitleEnabledByChatId((prev) => ({
      ...(prev || {}),
      [normalizedChatId]: !!enabled,
    }));
  }, []);

  const addTranscriptionActiveKey = useCallback((key: string) => {
    setTranscriptionActiveKeys((prev) => [...prev, key]);
  }, []);

  const removeTranscriptionActiveKey = useCallback((key: string) => {
    setTranscriptionActiveKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  const upsertContactInfoByNumber = useCallback((number: string, contactData: any) => {
    const normalizedNumber = String(number || '')
      .trim()
      .replace(/[^\d+]/g, '');
    if (!normalizedNumber) return;

    setContactsInfo((prev) => ({
      ...prev,
      [normalizedNumber]: contactData,
    }));
  }, []);

  const updateChatLists = useCallback(
    (
      updater: (chats: any[]) => any[],
      options?: {
        targetChatId?: string;
        upsertInAgentList?: boolean;
      },
    ) => {
      setAllChats((prev: any) => updater(Array.isArray(prev) ? prev : []));

      setAllAgentChats((prev: any) => {
        const agentChats = Array.isArray(prev) ? prev : [];
        const targetChatId = options?.targetChatId || '';

        if (targetChatId && !options?.upsertInAgentList) {
          const existsInAgentList = agentChats.some((chat: any) => chat?.chatId === targetChatId);
          if (!existsInAgentList) return agentChats;
        }

        return updater(agentChats);
      });
    },
    [],
  );

  const patchChatInLists = useCallback(
    (chatId: string, patch: any) => {
      if (!chatId || !patch || typeof patch !== 'object') return;

      updateChatLists(
        (prev: any[]) => {
          const chats = Array.isArray(prev) ? prev : [];
          const existingChat = chats.find((chat: any) => chat?.chatId === chatId);

          if (!existingChat) return chats;

          const updatedChat = {
            ...existingChat,
            ...patch,
            chatId,
            users: Array.isArray(patch?.users) ? patch.users : existingChat?.users,
          };

          return [updatedChat, ...chats.filter((chat: any) => chat?.chatId !== chatId)];
        },
        { targetChatId: chatId },
      );
    },
    [updateChatLists],
  );

  useEffect(() => {
    if (!chatMode) {
      if (chatWindows && chatWindows?.length > 0) {
        const item = chatWindows?.[0];
        setChatWindows(item ? [item] : []);
      } else {
        setChatWindows([]);
      }
    }
  }, [chatMode]);

  useEffect(() => {
    if (Array.isArray(meetWindows) && meetWindows.length > 0) {
      setIsCallingInProgress(true);
    } else {
      setIsCallingInProgress(false);
    }
  }, [meetWindows]);

  useEffect(() => {
    if (!Array.isArray(allChats) || !user?.uuid) {
      setUnreadMessageCount(0);
      setGroupChatUnreadCount(0);
      setDirectMessageUnreadCount(0);
      setAiChatUnreadCount(0);
      return;
    }

    let totalUnread = 0;
    let groupChatUnread = 0;
    let directUnread = 0;
    let aiChatUnread = 0;
    const userUuid = user?.uuid ?? user?.guest_info?.uuid ?? '';
    allChats.forEach((chat: any) => {
      if (!chat || !Array.isArray(chat?.users)) return;
      if (Array.isArray(chat?.isHidden) && chat.isHidden.includes(userUuid)) return;

      const currentUser = chat.users.find((u: any) => u?.uuid === userUuid);
      if (!currentUser) return;

      const unread =
        typeof currentUser.unreadMsg === 'number' ? Math.max(0, currentUser.unreadMsg) : 0;

      if (chat?.groupType === 'AI') {
        aiChatUnread += unread;
      } else if (chat?.groupType !== 'MEETING') {
        totalUnread += unread;
        if (chat?.isGroupChat) {
          groupChatUnread += unread;
        } else {
          directUnread += unread;
        }
      }
    });

    setUnreadMessageCount(Math.max(0, totalUnread));
    setGroupChatUnreadCount(Math.max(0, groupChatUnread));
    setDirectMessageUnreadCount(Math.max(0, directUnread));
    setAiChatUnreadCount(Math.max(0, aiChatUnread));
  }, [allChats, user?.uuid]);

  // Audio reference for notification sound
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Function to play notification sound
  // const playNotificationSound = () => {
  //   try {
  //     if (audioRef.current) {
  //       audioRef.current.play().catch((error) => {
  //         console.log('Failed to play notification sound:', error);
  //       });
  //     }
  //   } catch (error) {
  //     console.log('Error playing notification sound:', error);
  //   }
  // };

  const handleAiChatAccept = useCallback(
    (payload: any, callback?: (response: any) => void) => {
      socketEventsManager?.emit(chatEvents.AI_CHAT_ACCEPT, payload, (response: any) => {
        if (callback) callback(response);
      });
    },
    [socketEventsManager],
  );

  const handleAiChatDecline = useCallback(
    (payload: any, callback?: (response: any) => void) => {
      socketEventsManager?.emit(chatEvents.AI_CHAT_DECLINE, payload, (response: any) => {
        if (callback) callback(response);
      });
    },
    [socketEventsManager],
  );

  const getAgentChats = useCallback(
    (payload: any = {}, callback?: (response: any) => void) => {
      if (!socketEventsManager) return;

      const userUuid = user?.uuid || user?.guest_info?.uuid || '';
      const domain = user?.sip_credentials?.domain || '';
      const requestPayload: any = {
        ...(userUuid ? { uuid: userUuid } : {}),
        ...(domain ? { domain } : {}),
        ...(payload || {}),
      };

      socketEventsManager.emit(chatEvents.GET_AGENT_CHATS, requestPayload, (response: any) => {
        const chats =
          response?.chats ||
          response?.data?.chats ||
          response?.data?.data?.chats ||
          response?.data?.data?.result?.chats;

        if (Array.isArray(chats)) {
          setAllAgentChats(chats);
        }

        callback?.(response);
      });
    },
    [socketEventsManager, user?.guest_info?.uuid, user?.sip_credentials?.domain, user?.uuid],
  );

  useEffect(() => {
    const isAuthenticatedSocketUser =
      Boolean(user?.uuid) && Boolean(user?.sip_credentials?.domain) && Boolean(user?.token);
    const isMeetingRoute = location?.pathname?.startsWith('/video-meet');
    const guestMeetingTokenFromUser = String(user?.guest_meeting_token || '');
    const guestMeetingToken =
      isMeetingRoute && !isAuthenticatedSocketUser
        ? guestMeetingTokenFromUser || sessionStorage.getItem(GUEST_MEETING_TOKEN_KEY) || ''
        : '';

    if (!isAuthenticatedSocketUser && !guestMeetingToken) return;

    // Reset disconnecting state when socket is being initialized
    setIsDisconnecting(false);
    const getSocketConnection = makeSipSocketConnection(
      isAuthenticatedSocketUser ? user?.token : guestMeetingToken,
    );
    let areDomainListenersRegistered = false;

    if (getSocketConnection) {
      getSocketConnection.on(chatEvents.CONNECT, () => {
        setIsSocketConnected(true);
        setTimeout(() => {
          if (!isDisconnecting) {
            initialEmitters(getSocketConnection);
          }
        }, 1000);
        if (areDomainListenersRegistered) return;
        areDomainListenersRegistered = true;
        getSocketConnection.on(chatEvents.PRESENCE, (data) => {
          if (isDisconnecting) return;
          if (data?.['Call-ID'] && data?.State === 'confirmed') {
            setAllLiveCalls((prev: any) => [...prev, data]);
          }
          if (data?.['From'] && data?.['SipCallID']) {
            const requiredExt = data?.['From']?.replace('sip:', '')?.split('@')?.[0];
            if (requiredExt) {
              setCallPresence((prev: any) => ({
                ...(prev || {}),
                [requiredExt]: data,
              }));
            }
          }
          if (data['From']) {
            const fromUser = data['From-User'];
            if (!fromUser) return;
            if (data['From']) {
              const requiredExt = (data?.['From'] || '').replace('sip:', '').split('@')[0] || '';
              setOngoingLiveCalls((prev: any) => {
                const prevObj = { ...prev };
                if (prevObj && Object.keys(prevObj).length > 0) {
                  if (prevObj[requiredExt]) {
                    prevObj[requiredExt] = data;
                  } else {
                    prevObj[requiredExt] = data;
                  }
                } else {
                  prevObj[requiredExt] = data;
                }
                return prevObj;
              });
            }
            if (['ended', 'terminated'].includes(data['State'])) {
              if (data?.['From']) {
                const requiredExt = data?.['From']?.replace('sip:', '')?.split('@')?.[0];
                if (requiredExt) {
                  setCallPresence((prev: any) => {
                    const next = { ...(prev || {}) };
                    delete next[requiredExt];
                    return next;
                  });
                }
              }
              setOngoingLiveCalls((prev: any) => {
                const requiredExt = (data?.['From'] || '').replace('sip:', '').split('@')[0] || '';
                const newData = { ...prev };
                if (newData[requiredExt]) {
                  delete newData[requiredExt];
                }
                return newData;
              });
              if (data?.['Call-ID']) {
                setAllLiveCalls((prev: any) => {
                  return prev?.filter((item: any) => item?.['Call-ID'] !== data?.['Call-ID']);
                });
              }
            }
            if (data['forward_type'] === 'DEPARTMENT') {
              const requiredExt = data['From'].replace('sip:', '')?.split('@')?.[0];
              setOngoingDepartmentCalls((prev: any) => {
                const prevObj = { ...prev };
                if (prevObj && Object.keys(prevObj).length > 0) {
                  if (prevObj[requiredExt]) {
                    prevObj[requiredExt] = data;
                  } else {
                    prevObj[requiredExt] = data;
                  }
                } else {
                  prevObj[requiredExt] = data;
                }
                return prevObj;
              });

              if (['ended', 'terminated'].includes(data['State'])) {
                setOngoingDepartmentCalls((prev: any) => {
                  const requiredExt = data['From'].replace('sip:', '')?.split('@')?.[0];
                  const newData = { ...prev };
                  if (newData[requiredExt]) {
                    delete newData[requiredExt];
                  }
                  return newData;
                });
              }
            }
          }
        });
        getSocketConnection.on('conf-upd', handleConferenceUpdate);
        getSocketConnection.on('sms-notification', (data: any) => {
          if (isDisconnecting) return;
          setSmsUnreadCountArray((prev) => {
            const newPrev: any = [...prev];
            let isExist = true;
            for (let index = 0; index < newPrev.length; index++) {
              const element: any = newPrev[index];
              if (
                element?.senderNumber === data?.senderNumber &&
                element?.didNumber === data?.didNumber
              ) {
                element.count = data?.count;
                isExist = false;
              }
            }
            if (isExist) {
              newPrev.push(data);
            }
            return newPrev;
          });
        });
        getSocketConnection.on(chatEvents.LEAD_PROCESS_RESPONSE, (data: any) => {
          if (isDisconnecting) return;
          const payload = data && typeof data === 'object' ? data : {};
          const success = Number(payload?.success || 0);
          const fail = Number(payload?.fail || 0);
          const duplicate = Number(payload?.duplicate || 0);
          const normalizedType = String(
            payload?.type ||
              payload?.recordType ||
              payload?.entity ||
              payload?.entityType ||
              payload?.target ||
              '',
          )
            .trim()
            .toUpperCase();
          const entityLabel: 'Lead' | 'Contact' =
            normalizedType === 'LEAD' || location?.pathname?.includes('/leads')
              ? 'Lead'
              : 'Contact';

          setLeadProcessNotifications([
            {
              id: uuidV4(),
              success: Number.isFinite(success) ? success : 0,
              fail: Number.isFinite(fail) ? fail : 0,
              duplicate: Number.isFinite(duplicate) ? duplicate : 0,
              entityLabel,
            },
          ]);
          queryClient.invalidateQueries(['getGroupListQuery']);
          window.dispatchEvent(
            new CustomEvent(chatEvents.LEAD_PROCESS_RESPONSE, {
              detail: data,
            }),
          );
        });

        getSocketConnection.on(chatEvents.CALENDAR_UPDATE, () => {
          if (isDisconnecting) return;
          queryClient.invalidateQueries({ queryKey: ['calendarMeetingList'] });
          queryClient.invalidateQueries({ queryKey: ['calendarMeetingListTodayEvents'] });
          queryClient.invalidateQueries({ queryKey: ['calendarMeetingListTaskList'] });
        });

        getSocketConnection.on(chatEvents.USER_PRESENCE_LIST, (data) => {
          setUsersOnlineStatus(normalizeUserPresenceList(data));
        });
        getSocketConnection.on(chatEvents.USER_PRESENCE_UPDATE, (data: any) => {
          const presenceUpdate = normalizeUserPresenceUpdate(data);
          if (!presenceUpdate?.userId) return;
          setUsersOnlineStatus((prev: any) => {
            const prevList = Array.isArray(prev) ? prev : [];
            const index = prevList.findIndex(
              (item: any) => String(item?.userId) === String(presenceUpdate?.userId),
            );
            if (index !== -1) {
              const updated = [...prevList];
              updated[index] = { ...updated[index], ...presenceUpdate };
              return updated;
            }
            return [...prevList, presenceUpdate];
          });
        });

        getSocketConnection.on(chatEvents.ACTIVE_CAMPAIGN_RESPONSE, (data: any) => {
          console.log('active-campaign-response', data);
          const result = data?.data?.result || data?.result || data;
          setActiveCampaigns(Array.isArray(result) ? result : []);
        });
        getSocketConnection.on(chatEvents.CAMPAIGN_CALL_FLOW_FUNNEL, (data: any) => {
          console.log('campaign-call-flow-funnel-response', data);
          const result = data?.result || data?.data?.result || data;
          const parsedResult =
            result && typeof result === 'object' && !Array.isArray(result) ? result : null;
          setCampaignCallFlowFunnel(parsedResult);
        });
        getSocketConnection.on(chatEvents.CAMPAIGN_AGENT_RESPONSE, (data: any) => {
          console.log('campaign-agent-response', data);
          const result = data?.data?.result || data?.result || data;
          const parsedResult =
            result && typeof result === 'object' && !Array.isArray(result) ? result : null;
          setCampaignAgents(parsedResult);
        });
        getSocketConnection.on(chatEvents.DASH_AI_AGENT_DATA_RESPONSE, (data: any) => {
          console.log('dash-ai-agent-data-response', data);
          setAiLiveWallboardData(data);
        });
        getSocketConnection.on(chatEvents.DASH_CAMPAIGN_AI_LIVE_CALL_RESPONSE, (data: any) => {
          console.log('dash-campaign-ai-live-call-response', data);
          setCampaignAiLiveCallData(data);
        });

        getSocketConnection.on('storage-limit', (data: any) => {
          console.log('storage-limit event received:', data);
          if (data && typeof data === 'object') {
            setStorageLimitData(data);
            setIsStorageModalOpen(true);
          }
        });

        // Full list event — server sends this on connect/reconnect as source of truth
        getSocketConnection.on(chatEvents.AI_CHAT_REQUEST_LIST, (...args: any[]) => {
          console.log('ai-chat-request-list', args);
          // The payload might be args[0] directly, or if they sent an array like ["ai-chat-request-list", [...]]
          let list: any[] = [];
          const data = args[0];

          if (Array.isArray(data)) {
            if (
              data.length === 2 &&
              data[0] === chatEvents.AI_CHAT_REQUEST_LIST &&
              Array.isArray(data[1])
            ) {
              list = data[1];
            } else {
              list = data;
            }
          } else if (data && typeof data === 'object' && Array.isArray(data.data)) {
            list = data.data;
          }

          setAiChatRequests(list);
        });

        getSocketConnection.on(chatEvents.AI_CHAT_REQUEST, (data: any, callback: any) => {
          console.log('ai-chat-request', data);
          setAiChatRequests((prev) => {
            // Avoid duplicates by chatId
            if (prev.some((r) => r?.chatId === data?.chatId)) return prev;
            return [...prev, data];
          });
          // Re-open the modal for every new incoming request
          setShowAiChatModal(true);
          if (callback && typeof callback === 'function') {
            callback({ success: true });
          }
        });

        getSocketConnection.on(chatEvents.AI_CHAT_ACCEPTED, (data: any, callback: any) => {
          console.log('ai-chat-accepted', data);
          setAiChatRequests((prev) => prev.filter((r) => r?.chatId !== data?.chatId));
          if (callback && typeof callback === 'function') {
            callback({ success: true });
          }
        });

        getSocketConnection.on(chatEvents.AI_CHAT_ABANDONED, (data: any, callback: any) => {
          console.log('ai-chat-abandoned', data);
          setAiChatRequests((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const exists = list.some((r) => r?.chatId === data?.chatId);
            if (exists) {
              // Update the matching request's status from 'pending' → 'abandoned'
              // This moves it from Unassigned tab → Missed tab automatically
              return list.map((r) =>
                r?.chatId === data?.chatId ? { ...r, status: 'abandoned' } : r,
              );
            }
            // If not in the list yet, add it as abandoned
            return [{ ...data, status: 'abandoned' }, ...list];
          });
          if (callback && typeof callback === 'function') {
            callback({ success: true });
          }
        });

        getSocketConnection.on(chatEvents.DECLINE_AI_CHAT, (data: any, callback: any) => {
          console.log('ai-chat-decline', data);
          setAiChatRequests((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const exists = list.some((r) => r?.chatId === data?.chatId);
            if (exists) {
              return list.map((r) =>
                r?.chatId === data?.chatId ? { ...r, ...data, status: 'declined' } : r,
              );
            }
            return [{ ...data, status: 'declined' }, ...list];
          });
          if (callback && typeof callback === 'function') {
            callback({ success: true });
          }
        });

        const normalizeCallCenterPayload = (raw: any) => {
          if (!raw) return null;
          if (typeof raw === 'string') {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          }
          if (typeof raw === 'object') return raw;
          return null;
        };

        const normalizeCallCenterSipCallId = (value: unknown) =>
          String(value || '')
            .trim()
            .toLowerCase();

        const normalizeCallCenterId = (value: unknown) =>
          String(value || '')
            .trim()
            .toLowerCase();

        const getCallCenterSipCallIds = (payload: any) => {
          const sipCallIds = Array.isArray(payload?.sip_call_ids) ? payload.sip_call_ids : [];

          return [
            ...sipCallIds,
            payload?.sip_call_id,
            payload?.sipCallId,
            payload?.SipCallID,
            payload?.['SipCallID'],
          ]
            .map(normalizeCallCenterSipCallId)
            .filter(Boolean);
        };

        const getCallCenterConferenceId = (payload: any) =>
          normalizeCallCenterId(
            payload?.conference_id ||
              payload?.conferenceId ||
              payload?.confID ||
              payload?.confId ||
              '',
          );

        const getCallCenterConferenceMemberIds = (payload: any) => {
          const conferenceMembers = Array.isArray(payload?.conference_members)
            ? payload.conference_members
            : [];
          const conferenceIdParts = getCallCenterConferenceId(payload).split('_');

          return [
            ...conferenceIdParts,
            payload?.changed_member?.uniqueId,
            payload?.changed_member?.uuid,
            payload?.changed_member?.member_uuid,
            ...conferenceMembers.flatMap((member: any) => [
              member?.uniqueId,
              member?.uuid,
              member?.member_uuid,
            ]),
          ]
            .map(normalizeCallCenterId)
            .filter(Boolean);
        };

        const getCallCenterSessionId = (payload: any) =>
          payload?.b_leg_uuid ||
          payload?.leg_uuid ||
          payload?.member_uuid ||
          payload?.sip_call_id ||
          payload?.sipCallId ||
          payload?.SipCallID ||
          payload?.call_uuid ||
          payload?.uuid ||
          '';
        // payload?.b_leg_uuid ||
        // payload?.leg_uuid ||
        // payload?.member_uuid ||
        // payload?.sip_call_id ||
        // payload?.sipCallId ||
        // payload?.SipCallID ||
        // payload?.call_uuid ||
        // payload?.uuid ||
        // '';

        const hasSharedCallCenterSipCallId = (currentCall: any, nextCall: any) => {
          const currentSipCallIds = getCallCenterSipCallIds(currentCall);
          const nextSipCallIds = getCallCenterSipCallIds(nextCall);
          if (!currentSipCallIds.length || !nextSipCallIds.length) return false;

          const nextSipCallIdSet = new Set(nextSipCallIds);
          return currentSipCallIds.some((sipCallId) => nextSipCallIdSet.has(sipCallId));
        };

        const isSameCallCenterSession = (currentCall: any, nextCall: any) => {
          const currentLegId = normalizeCallCenterId(
            currentCall?.b_leg_uuid || currentCall?.leg_uuid || currentCall?.member_uuid,
          );
          const nextLegId = normalizeCallCenterId(
            nextCall?.b_leg_uuid || nextCall?.leg_uuid || nextCall?.member_uuid,
          );

          if (currentLegId && nextLegId && currentLegId === nextLegId) return true;

          const currentCallUuid = normalizeCallCenterId(currentCall?.call_uuid);
          const nextCallUuid = normalizeCallCenterId(nextCall?.call_uuid);
          if (currentCallUuid && nextCallUuid && currentCallUuid === nextCallUuid) return true;

          const currentSessionId = normalizeCallCenterId(getCallCenterSessionId(currentCall));
          const nextSessionId = normalizeCallCenterId(getCallCenterSessionId(nextCall));
          if (currentSessionId && nextSessionId && currentSessionId === nextSessionId) return true;

          return hasSharedCallCenterSipCallId(currentCall, nextCall);
        };

        const shouldRemoveCallCenterSession = (currentCall: any, endedCall: any) => {
          const currentLegId = normalizeCallCenterId(
            currentCall?.b_leg_uuid || currentCall?.leg_uuid || currentCall?.member_uuid,
          );
          const currentCallUuid = normalizeCallCenterId(currentCall?.call_uuid);
          const currentSessionId = normalizeCallCenterId(getCallCenterSessionId(currentCall));
          const currentConferenceId = getCallCenterConferenceId(currentCall);
          const endedCallUuid = normalizeCallCenterId(endedCall?.call_uuid);
          const endedLegId = normalizeCallCenterId(
            endedCall?.b_leg_uuid || endedCall?.leg_uuid || endedCall?.member_uuid,
          );
          const endedConferenceId = getCallCenterConferenceId(endedCall);
          const endedCallType = String(endedCall?.call_type || '').toLowerCase();
          const endedType = String(endedCall?.type || '').toLowerCase();
          const endedStatus = String(endedCall?.status || '').toLowerCase();
          const isTerminalConferenceCall =
            Boolean(endedConferenceId) &&
            (endedType === 'conference-end' ||
              endedCallType === 'conference' ||
              endedStatus === 'hangup');

          if (isTerminalConferenceCall) {
            const endedConferenceMemberIdSet = new Set(getCallCenterConferenceMemberIds(endedCall));
            const currentIds = [currentLegId, currentCallUuid, currentSessionId].filter(Boolean);
            const hasMatchingConferenceMemberId = currentIds.some((id) =>
              endedConferenceMemberIdSet.has(id),
            );

            return (
              currentConferenceId === endedConferenceId ||
              currentCallUuid === endedConferenceId ||
              currentSessionId === endedConferenceId ||
              hasMatchingConferenceMemberId ||
              hasSharedCallCenterSipCallId(currentCall, endedCall)
            );
          }

          if (endedLegId) {
            return (
              currentLegId === endedLegId ||
              (endedCallUuid &&
                (currentCallUuid === endedCallUuid || currentSessionId === endedCallUuid))
            );
          }

          if (endedCallUuid) {
            return currentCallUuid === endedCallUuid || currentSessionId === endedCallUuid;
          }

          return hasSharedCallCenterSipCallId(currentCall, endedCall);
        };

        const mergeCallCenterPayload = (currentCall: any, nextCall: any) => {
          const definedPayload = Object.fromEntries(
            Object.entries(nextCall).filter(([, value]) => value !== undefined),
          );
          const mergedCall = {
            ...currentCall,
            ...definedPayload,
            call_uuid:
              currentCall?.call_uuid ||
              nextCall?.call_uuid ||
              currentCall?.b_leg_uuid ||
              getCallCenterSessionId(nextCall),
          };

          ['answered_time', 'answered_at', 'bridged_at', 'start_time', 'started_at'].forEach(
            (key) => {
              if ((mergedCall?.[key] === null || mergedCall?.[key] === '') && currentCall?.[key]) {
                mergedCall[key] = currentCall[key];
              }
            },
          );

          return mergedCall;
        };

        const upsertCallCenterCallList = (previousValue: any, payload: any) => {
          const previousCalls = Array.isArray(previousValue) ? previousValue : [];
          const id = getCallCenterSessionId(payload);
          if (!payload || !id) return previousValue;

          const matchingIndexes = previousCalls.reduce<number[]>((indexes, item, index) => {
            if (isSameCallCenterSession(item, payload)) indexes.push(index);
            return indexes;
          }, []);

          if (!matchingIndexes.length) {
            return [...previousCalls, { ...payload, call_uuid: payload.call_uuid || id }];
          }

          return previousCalls.map((item, index) =>
            matchingIndexes.includes(index) ? mergeCallCenterPayload(item, payload) : item,
          );
        };

        const updateExistingCallCenterCallList = (previousValue: any, payload: any) => {
          const previousCalls = Array.isArray(previousValue) ? previousValue : [];
          const id = getCallCenterSessionId(payload);
          if (!payload || !id) return previousValue;

          const matchingIndexes = previousCalls.reduce<number[]>((indexes, item, index) => {
            if (isSameCallCenterSession(item, payload)) indexes.push(index);
            return indexes;
          }, []);

          if (!matchingIndexes.length) return previousValue;

          return previousCalls.map((item, index) =>
            matchingIndexes.includes(index) ? mergeCallCenterPayload(item, payload) : item,
          );
        };

        const mergeConferencePayloadBySipCallIds = (rawPayload: any) => {
          const payload = normalizeCallCenterPayload(rawPayload);
          const payloadSipCallIds = getCallCenterSipCallIds(payload);
          if (!payload || !payloadSipCallIds.length) return;

          const payloadSipCallIdSet = new Set(payloadSipCallIds);
          const definedPayload = Object.fromEntries(
            Object.entries(payload).filter(([, value]) => value !== undefined),
          );

          const updateConferenceCallList = (previousValue: any) => {
            const previousCalls = Array.isArray(previousValue) ? previousValue : [];
            if (!previousCalls.length) return previousValue;

            let hasChanges = false;
            const updatedCalls = previousCalls.map((call: any) => {
              const callSipCallIds = getCallCenterSipCallIds(call);
              const hasMatchingSipCallId = callSipCallIds.some((sipCallId) =>
                payloadSipCallIdSet.has(sipCallId),
              );

              if (!hasMatchingSipCallId) return call;

              hasChanges = true;
              return mergeCallCenterPayload(call, definedPayload);
            });

            return hasChanges ? updatedCalls : previousValue;
          };

          setLiveCalls(updateConferenceCallList);
          setEventLiveCallsData(updateConferenceCallList);
        };

        const upsertCallCenterCall = (rawPayload: any) => {
          const payload = normalizeCallCenterPayload(rawPayload);
          const id = getCallCenterSessionId(payload);
          if (!payload || !id) return;

          setLiveCalls((prev: any[]) => upsertCallCenterCallList(prev, payload));
          setEventLiveCallsData((prev: any[]) => upsertCallCenterCallList(prev, payload));
        };

        // Sentiment updates are supplemental data, not lifecycle events. They must not
        // re-create a call that has already been removed by a call-end event.
        const updateExistingCallCenterCall = (rawPayload: any) => {
          const payload = normalizeCallCenterPayload(rawPayload);
          const id = getCallCenterSessionId(payload);
          if (!payload || !id) return;

          setLiveCalls((prev: any[]) => updateExistingCallCenterCallList(prev, payload));
          setEventLiveCallsData((prev: any[]) => updateExistingCallCenterCallList(prev, payload));
        };

        getSocketConnection.on(chatEvents.CALL_START, (data) => {
          console.log('call-start', data);
          upsertCallCenterCall(data);
        });
        getSocketConnection.on(chatEvents.CONF_UPDATE, (data) => {
          console.log('conf-update', data);
          const normalizedConferencePayload = normalizeCallCenterPayload(data);
          if (normalizedConferencePayload) {
            updateConferenceDataBySipCallIds(normalizedConferencePayload);
            mergeConferencePayloadBySipCallIds(normalizedConferencePayload);
          }
          upsertCallCenterCall(data);
        });
        getSocketConnection.on(chatEvents.CALL_RINGING, (data) => {
          upsertCallCenterCall(data);
        });
        getSocketConnection.on(chatEvents.CALL_ANSWERED, (data) => {
          upsertCallCenterCall(data);
        });

        getSocketConnection.on(chatEvents.CALL_WAITING, (data) => {
          upsertCallCenterCall(data);
        });

        const removeEndedCallCenterCall = (data: any) => {
          const payload = normalizeCallCenterPayload(data);
          const id = getCallCenterSessionId(payload);
          if (!payload || !id) return;
          setLiveCalls((prev: any[]) =>
            (Array.isArray(prev) ? prev : []).filter(
              (item) => !shouldRemoveCallCenterSession(item, payload),
            ),
          );
          setEventLiveCallsData((prev: any[]) =>
            (Array.isArray(prev) ? prev : []).filter(
              (item) => !shouldRemoveCallCenterSession(item, payload),
            ),
          );
        };

        getSocketConnection.on(chatEvents.CALL_ENDED, (data) => {
          console.log('call-ended', data);
          removeEndedCallCenterCall(data);
        });
        getSocketConnection.on(chatEvents.CONF_END, (data) => {
          console.log('conf-ended', data);
          removeEndedCallCenterCall(data);
        });
        getSocketConnection.on(chatEvents.AGENT_STATUS_CHANGE, (data) => {
          console.log('agent-status-change', data);
        });
        getSocketConnection.on(chatEvents.MEMBER_OFFERED, (data) => {
          console.log('member-offered', data);
          upsertCallCenterCall(data);
        });
        getSocketConnection.on(chatEvents.MEMBER_QUEUE_START, (data) => {
          console.log('member-queue-start', data);
        });
        getSocketConnection.on(chatEvents.QUEUE_CALL_BRIDGE, (data) => {
          console.log('queue-call-bridge', data);
          upsertCallCenterCall(data);
        });
        getSocketConnection.on(chatEvents.CALL_HOLD, (data) => {
          console.log('call-hold', data);
          upsertCallCenterCall(data);
        });
        getSocketConnection.on(chatEvents.CALL_BRIDGE, (data) => {
          console.log('call-hold', data);
          upsertCallCenterCall(data);
        });
        getSocketConnection.on(chatEvents.CALL_SENTIMENT, (data) => {
          console.log('call-sentiment-partial', data);
          const normalizedPayload = normalizeCallCenterPayload(data);
          const nestedData = normalizeCallCenterPayload(normalizedPayload?.data);
          const nestedResult = normalizeCallCenterPayload(
            nestedData?.result || normalizedPayload?.result,
          );
          const payload = {
            ...(normalizedPayload || {}),
            ...(nestedData || {}),
            ...(nestedResult || {}),
          };
          const sentimentScores = payload?.sentiment_scores;
          const callIds = [
            ...(Array.isArray(payload?.sip_call_ids) ? payload.sip_call_ids : []),
            payload?.sip_call_id,
            payload?.sipCallId,
            payload?.SipCallID,
            payload?.call_uuid,
            payload?.callUuid,
            payload?.call_id,
            payload?.callId,
            payload?.b_leg_uuid,
            payload?.leg_uuid,
            payload?.member_uuid,
            payload?.uuid,
          ]
            .map((callId) => String(callId || '').trim())
            .filter(Boolean);

          if (callIds.length && sentimentScores) {
            setSentimentData((prev: any) => {
              const nextSentimentData = { ...prev };
              callIds.forEach((callId) => {
                nextSentimentData[callId] = sentimentScores;
                nextSentimentData[callId.toLowerCase()] = sentimentScores;
              });
              return nextSentimentData;
            });
          }
          updateExistingCallCenterCall(payload);
        });
        getSocketConnection.on(chatEvents.CALL_UN_HOLD, (data) => {
          console.log('call-hold', data);
          upsertCallCenterCall(data);
        });
        getSocketConnection.on(chatEvents.LIVE_CALLS_RESPONSE, (data) => {
          console.log('live-calls-response', data);
          setLiveCalls(Array.isArray(data?.data?.result) ? data?.data?.result : []);
        });
        getSocketConnection.on(chatEvents.ACTIVITY_COUNT, (data: any) => {
          setActivityCount({
            all: data?.all || 0,
            mention: data?.mention || 0,
            request: data?.request || 0,
            meeting: data?.meeting || 0,
          });
        });
        getSocketConnection.on(chatEvents.DASH_LIVE_CALLS_RESPONSE, (data: any) => {
          console.log('dash-live-calls-response', data);
          setCampaignLiveCallsData(data);
          const result = data?.data?.result || [];
          setEventLiveCallsData(Array.isArray(result) ? result : []);
        });
        getSocketConnection.on(chatEvents.LIVE_QUEUE_CALLS_RESPONSE, (data: any) => {
          console.log('dash-live-queue-calls-response', data);
          const result = data?.data?.result || [];
          setLiveQueueCalls(Array.isArray(result) ? result : []);
        });
        getSocketConnection.on('call-history-updated', (data: any) => {
          setCallHistoryLiveUpdate({ payload: data, receivedAt: Date.now() });
        });

        getSocketConnection.on(chatEvents.RECENT_MEETINGS, (data: any) => {
          setRecentMeetings(Array.isArray(data) ? data : []);
        });
        getSocketConnection.on(chatEvents.RECENT_TASKS, (data: any) => {
          setRecentTasks(Array.isArray(data) ? data : []);
        });
        getSocketConnection.on(chatEvents.MEET_END, (data: any) => {
          console.log('socket-events-context: RECEIVED BROADCAST MEET_END', data);
          const endedChatId = getMeetingEventChatId(data, chatEvents.MEET_END);
          if (!endedChatId) {
            console.warn('Ignoring meeting end event without a chat ID');
            return;
          }
          setMeetWindows((prev: any) => removeMeetingInvitesForChat(prev, endedChatId));
        });
        getSocketConnection.on(chatEvents.TRANSCRIBE_DETAIL, (rawData: any) => {
          if (isDisconnecting) return;

          const payload = normalizeTranscribeDetailPayload(rawData);
          if (!payload) return;

          const chatId = String(payload?.room || payload?.chatId || '').trim();
          const messageId = String(payload?.message_id || payload?.messageId || '').trim();
          const jid = String(payload?.jid || '').trim();
          const transcriptType = String(payload?.type || '').toLowerCase();
          const isPartial = transcriptType === 'partial';
          const isFinal = transcriptType === 'final';
          const enabledMap = meetingSubtitleEnabledByChatIdRef.current || {};
          const isSubtitleEnabledForChat =
            enabledMap?.[chatId] ??
            Object.entries(enabledMap).find(
              ([key]) => key === chatId || key.endsWith(`_${chatId}`),
            )?.[1] ??
            false;
          if (!isSubtitleEnabledForChat) return;
          const selectedLanguageMap = meetingSubtitleLanguageByChatIdRef.current || {};
          const selectedLanguageForChat =
            selectedLanguageMap?.[chatId] ||
            Object.entries(selectedLanguageMap).find(
              ([key]) => key === chatId || key.endsWith(`_${chatId}`),
            )?.[1] ||
            '';
          const selectedEntry = extractSelectedTranscribeEntry(payload, selectedLanguageForChat);

          if (!chatId || !messageId || !selectedEntry?.text) return;

          setMeetingSubtitlesByChatId((prev) => {
            const next = { ...(prev || {}) };
            const chatSubtitles = Array.isArray(next[chatId]) ? [...next[chatId]] : [];
            const subtitleIndexByMessageId = chatSubtitles.findIndex(
              (line: any) => line?.message_id === messageId,
            );
            let activePartialIndex = -1;
            if (isPartial) {
              for (let i = chatSubtitles.length - 1; i >= 0; i -= 1) {
                const line = chatSubtitles[i];
                if (!line || line?.isFinal) continue;
                if (jid && line?.jid && String(line.jid).trim() !== jid) continue;
                activePartialIndex = i;
                break;
              }
            }
            const subtitleIndex =
              subtitleIndexByMessageId !== -1 ? subtitleIndexByMessageId : activePartialIndex;

            if (subtitleIndex === -1) {
              chatSubtitles.push({
                message_id: messageId,
                text: selectedEntry.text,
                text_by_language: selectedEntry.textByLanguage,
                jid,
                room: chatId,
                type: transcriptType || 'partial',
                isFinal: isFinal && !isPartial,
                original_language: payload?.original_language || '',
                language: selectedEntry.language || payload?.language || '',
                timestamp: payload?.timestamp || Date.now(),
              });
            } else {
              const existing = chatSubtitles[subtitleIndex] || {};
              const finalText = selectedEntry.text;

              chatSubtitles[subtitleIndex] = {
                ...existing,
                message_id: messageId,
                text: finalText,
                text_by_language: selectedEntry.textByLanguage || null,
                jid: jid || existing?.jid || '',
                room: chatId,
                type: transcriptType || existing?.type || 'partial',
                isFinal: isFinal || existing?.isFinal || false,
                original_language: payload?.original_language || existing?.original_language || '',
                language: selectedEntry.language || payload?.language || existing?.language || '',
                timestamp: payload?.timestamp || existing?.timestamp || Date.now(),
              };
            }

            next[chatId] = chatSubtitles.slice(-30);
            return next;
          });
        });

        getSocketConnection.on('meeting_reminder', (data: any) => {
          if (isDisconnecting) return;
          const meetingName = data?.name || 'Meeting';
          const startTime = data?.startUtc
            ? convertDateTimeFormateApis(data.startUtc, 'MMM D, h:mm A')
            : '';
          const body = startTime ? `${meetingName} - ${startTime}` : meetingName;
          if (document.visibilityState === 'visible') {
            handleAlert({
              text: `Meeting reminder: ${meetingName}${startTime ? ` at ${startTime}` : ''}`,
              type: 'info',
            });
          }
          showPushNotification({
            title: 'Meeting reminder',
            body,
            icon: mainSiteInfo?.fav_icon || mainSiteInfo?.small_logo,
            onClick: () => {
              if (data?.meetingId) {
                window.open(`/video-meet?meetCode=${data.meetingId}`, '_blank');
              } else {
                navigate('/video-meetings');
              }
            },
          });
        });
        getSocketConnection.on('inbound-sms', (data) => {
          if (isDisconnecting) return;
          // Play notification sound for SMS
          // playNotificationSound();

          if (document.visibilityState === 'visible') {
            handleAlert({
              text: `You have a new sms from ${data?.from}: ${data?.message}`,
              type: 'success',
            });
          } else {
            showPushNotification({
              title: `New SMS from ${data?.from}`,
              body: data?.message,
              icon: mainSiteInfo?.fav_icon || mainSiteInfo?.small_logo,
              onClick: () => {
                navigate('/inbox', {
                  state: {
                    notificationData: {
                      ...data,
                    },
                  },
                });
              },
            });
          }
          getSocketConnection.emit(
            'get-inbound-sms-count-new',
            {
              uuid: user?.uuid,
            },
            (data: any) => {
              if (isDisconnecting) return;
              setSmsUnreadCountArray(data?.data || []);
            },
          );
          queryClient.invalidateQueries({
            queryKey: ['getSMSList'],
            exact: false,
          });
          queryClient.invalidateQueries({
            queryKey: ['smsListViaDID'],
            exact: false,
          });
        });
        getSocketConnection.on('notification-unread', (data) => {
          if (isDisconnecting) return;
          // Play notification sound when unread count increases (including from 0)
          // if(data?.unread > unreadCount) {
          //   playNotificationSound();
          // }
          setUnreadCount(data?.unread ?? 0);
          setUnreadSMSCount(data?.unreadSMS || 0);
          getNotifications();
        });
        getSocketConnection.on('admin-notification', (data: AdminNotification) => {
          if (isDisconnecting || !data?.unread || !data?.adminNotificationUuid) return;
          if (data?.type && data.type !== 'system_update') return;
          if (data?.userUuid && data.userUuid !== user?.uuid) return;
          if (
            data?.companyUuid &&
            user?.company_info?.uuid &&
            data.companyUuid !== user.company_info.uuid
          )
            return;

          setAdminNotification(data);
          setIsRefreshingForUpdate(false);
        });
        getSocketConnection.on('task-count-update', (data) => {
          setUnreadTaskCount(data?.pending_task_count || 0);
        });
        // getSocketConnection.on('transcript', (data) => {
        //   if (isDisconnecting) return;
        //   const sipCallId = data?.sipCallId || data?.sip_call_id || data?.call_uuid;
        //   if (!sipCallId) return;

        //   setLiveTranscriptionList((prev: any[]) => {
        //     const list = Array.isArray(prev) ? prev : [];
        //     const index = list.findIndex((item: any) => item?.activeCallKey === sipCallId);

        //     const newIncomingMsgs = Array.isArray(data?.messages) ? data.messages : [data];

        //     if (index === -1) {
        //       return [...list, { activeCallKey: sipCallId, messages: newIncomingMsgs }];
        //     }

        //     const next = [...list];
        //     const oldMsgs = Array.isArray(next[index]?.messages) ? next[index].messages : [];
        //     const updatedMsgs = [...oldMsgs];

        //     newIncomingMsgs.forEach((newMsg: any) => {
        //       const msgId =
        //         newMsg?.id ||
        //         newMsg?._id ||
        //         (newMsg?.mode === 'summary' ? `summary-${sipCallId}` : null);
        //       const existingIndex = msgId
        //         ? updatedMsgs.findIndex(
        //           (m: any) =>
        //             (m?.id || m?._id || (m?.mode === 'summary' ? `summary-${sipCallId}` : null)) ===
        //             msgId,
        //         )
        //         : -1;

        //       if (existingIndex !== -1) {
        //         updatedMsgs[existingIndex] = { ...updatedMsgs[existingIndex], ...newMsg };
        //       } else {
        //         updatedMsgs.push(newMsg);
        //       }
        //     });

        //     next[index] = {
        //       ...next[index],
        //       messages: updatedMsgs,
        //     };
        //     return next;
        //   });

        //   if (data?.mode === 'summary') setCallSummary(data);
        // });
        getSocketConnection.on('campaign-state-update', (data) => {
          if (isDisconnecting) return;
          if (window.location.pathname.includes('running-campaign'))
            setOngoingCampaignActivity(data);
        });

        getSocketConnection.on('omni-channel', (data) => {
          if (isDisconnecting) return;
          setOmniChannelData(data);
          console.log('omni-channel', data);
        });

        getSocketConnection?.on('user-publish-general-event', (data: any) => {
          if (isDisconnecting) return;
          setUserLogoutData(data?.[0]);
          console.log('user-publish-general-event:', data);
        });
        // getSocketConnection?.on('role-change-event', (data) => {
        //   console.log('role-change-event:', data);
        //   if (isDisconnecting) return;
        //   // Play notification sound for role change
        //   // playNotificationSound();
        //   if (data?.[0]?.user_uuid === user?.uuid) {
        //     handleAlert({
        //       text: 'Your role has been changed!',
        //       type: 'info',
        //     });
        //     queryClient.invalidateQueries(['getUsersDetails']);
        //   }
        // });
        getSocketConnection?.on(chatEvents.ROLE_UPDATE, (data: any) => {
          console.log(
            data?.role !== user?.settings?.role?.label,
            'MMMM',
            data,
            data?.role,
            user?.settings?.role?.label,
          );
          if (data?.role !== user?.settings?.role?.label) {
            console.log('MMMM222');

            setRoleUpdateMessage(
              data?.message ||
                'Your role has been updated. Please reload the page to apply the changes.',
            );
            setShowRoleUpdateReloadModal(true);
          }
        });

        getSocketConnection.on(chatEvents.UPDATE_USER_INFO, (data: any) => {
          const userDetailUpdate = normalizeUserDetailUpdate(data);
          if (!userDetailUpdate) return;

          updateChatLists((chats: any[]) =>
            updateUserDetailsInChats(
              chats,
              userDetailUpdate.userId,
              userDetailUpdate.userPatch,
            ),
          );
        });

        getSocketConnection.on(chatEvents.GET_CHATS, (data: any) => {
          const chats = Array.isArray(data?.chats) ? data.chats : [];
          setAllChats(chats);
        });

        getSocketConnection.on(chatEvents.GET_AGENT_CHATS, (data: any) => {
          const chats = Array.isArray(data)
            ? data
            : data?.chats ||
              data?.data?.chats ||
              data?.data?.data?.chats ||
              data?.data?.data?.result?.chats ||
              [];
          setAllAgentChats(chats);
        });

        getSocketConnection.on(chatEvents.RECEIVED_NEW_CHAT, (data: any) => {
          if (!data?.chatId) return;
          updateChatLists(
            (prev: any[]) => {
              const list = Array.isArray(prev) ? prev : [];
              return [data, ...list.filter((item: any) => item?.chatId !== data?.chatId)];
            },
            {
              targetChatId: data.chatId,
              upsertInAgentList: true,
            },
          );
        });

        getSocketConnection.on(chatEvents.CHAT_DELETED, (data: any) => {
          const chatId = data?.chatId || '';
          if (!chatId) return;
          updateChatLists(
            (prev: any[]) => {
              const prevList = Array.isArray(prev) ? prev : [];
              const chatToHide = prevList.find((item: any) => item?.chatId === chatId);
              if (!chatToHide) return prevList;
              const filtered = prevList.filter((item: any) => item?.chatId !== chatId);
              return [
                ...filtered,
                {
                  ...chatToHide,
                  isHidden: [...(chatToHide?.isHidden || []), user?.uuid],
                },
              ];
            },
            { targetChatId: chatId },
          );
          setChatWindows((prev: any) =>
            Array.isArray(prev) ? prev.filter((item: any) => item !== chatId) : [],
          );
        });

        getSocketConnection.on(chatEvents.CHAT_REVERTED, (data: any) => {
          const chatId = data?.chatId || '';
          if (!chatId) return;
          updateChatLists(
            (prev: any[]) => {
              const list = Array.isArray(prev) ? prev : [];
              const chatToUpdate = list.find((item: any) => item?.chatId === chatId);
              if (!chatToUpdate) return list;
              const updatedChat = {
                ...chatToUpdate,
                isHidden: Array.isArray(chatToUpdate?.isHidden)
                  ? chatToUpdate.isHidden.filter((item: string) => item !== user?.uuid)
                  : [],
              };
              return [updatedChat, ...list.filter((item: any) => item?.chatId !== chatId)];
            },
            { targetChatId: chatId },
          );
        });

        getSocketConnection.on(chatEvents.CHANNEL_UPDATE, (data: any) => {
          const currentUser = userRef.current;
          const currentUserUuid = currentUser?.uuid || currentUser?.guest_info?.uuid || '';

          let chatData = data?.chat;
          let isPart = chatData?.users?.find((_: any) => _?.uuid === currentUserUuid);

          if (chatData?.groupType === 'MEETING' && !isPart) {
            if (currentUser?.isGuest) {
              const guestUserObj = {
                uuid: currentUserUuid,
                email: currentUser?.guest_info?.email || '',
                name: currentUser?.guest_info?.name || '',
                extension: '',
                unreadMsg: 0,
                callStatus: 'joined',
                jid: [],
                isGuest: true,
                isWaiting: false,
              };
              if (chatData && Array.isArray(chatData.users)) {
                chatData = {
                  ...chatData,
                  users: [...chatData.users, guestUserObj],
                };
                isPart = true;
              }
            }
          }

          if (chatData?.chatId && isPart) {
            updateChatLists(
              (prev: any[]) => {
                const list = Array.isArray(prev) ? prev : [];
                return [chatData, ...list.filter((_: any) => _?.chatId !== chatData?.chatId)];
              },
              {
                targetChatId: chatData.chatId,
                upsertInAgentList: true,
              },
            );
            return;
          }
          updateChatLists(
            (prev: any[]) =>
              Array.isArray(prev)
                ? prev.filter((item: any) => item?.chatId !== chatData?.chatId)
                : [],
            { targetChatId: chatData?.chatId || '' },
          );
          setChatWindows((prev: any) =>
            Array.isArray(prev) ? prev.filter((item: any) => item !== chatData?.chatId) : [],
          );
        });

        getSocketConnection.on(chatEvents.CHAT_UPDATE, (data: any) => {
          try {
            if (!data || typeof data !== 'object') return;
            const mode = data?.mode;

            if (mode === 'chat_rejected') {
              const chatId = data?.chat?.chatId;
              if (!chatId) return;

              updateChatLists(
                (prev: any[]) =>
                  Array.isArray(prev) ? prev.filter((item: any) => item?.chatId !== chatId) : [],
                { targetChatId: chatId },
              );
              setChatWindows((prev: any) =>
                Array.isArray(prev) ? prev.filter((item: any) => item !== chatId) : [],
              );
            }

            if (mode === 'chat_accepted') {
              const chatId = data?.chat?.chatId;
              if (!chatId) return;

              updateChatLists(
                (prev: any[]) => {
                  const chats = Array.isArray(prev) ? prev : [];
                  const chatToUpdate = chats.find((item: any) => item?.chatId === chatId);

                  if (!chatToUpdate) {
                    return data?.chat ? [data.chat, ...chats] : chats;
                  }

                  const updatedChat = {
                    ...chatToUpdate,
                    users: Array.isArray(data?.chat?.users)
                      ? data.chat.users
                      : chatToUpdate.users || [],
                  };

                  return [updatedChat, ...chats.filter((item: any) => item?.chatId !== chatId)];
                },
                {
                  targetChatId: chatId,
                  upsertInAgentList: true,
                },
              );
            }

            if (mode === 'chat-updated' || !mode) {
              const chatId = data?.chatId;
              const isDeleted = data?.isDeleted || false;
              if (!chatId) return;

              if (isDeleted) {
                setChatWindows((prev: any) =>
                  Array.isArray(prev) ? prev.filter((_: any) => _ !== chatId) : [],
                );
              }

              updateChatLists(
                (prev: any[]) => {
                  const chats = Array.isArray(prev) ? prev : [];
                  const chatToUpdate = chats.find((item: any) => item?.chatId === chatId);

                  if (!chatToUpdate) {
                    return [data, ...chats];
                  }

                  const updatedChat = {
                    ...chatToUpdate,
                    ...data,
                  };

                  return [updatedChat, ...chats.filter((item: any) => item?.chatId !== chatId)];
                },
                {
                  targetChatId: chatId,
                  upsertInAgentList: true,
                },
              );
            }
          } catch (error) {
            console.error('Error in CHAT_UPDATE listener:', error);
          }
        });

        getSocketConnection.on(chatEvents.CHAT_EXIT, (data: any) => {
          if (!data?.chatId) return;
          updateChatLists(
            (prev: any[]) =>
              Array.isArray(prev) ? prev.filter((item: any) => item?.chatId !== data?.chatId) : [],
            { targetChatId: data.chatId },
          );
          setChatWindows((prev: any) =>
            Array.isArray(prev) ? prev.filter((item: any) => item !== data?.chatId) : [],
          );
        });

        getSocketConnection.on(chatEvents.APPEND_ACTIVITY, (data: any) => {
          if (!data?.type) return;
          setActivityList((previous: any) => {
            const prevActivities = previous || {
              all: { page: 0, data: [], isLoading: false, hasMore: false, type: 'all' },
              mention: { page: 0, data: [], isLoading: false, hasMore: false, type: 'mention' },
              request: { page: 0, data: [], isLoading: false, hasMore: false, type: 'request' },
              meeting: { page: 0, data: [], isLoading: false, hasMore: false, type: 'meeting' },
            };
            const activityType = data.type.toLowerCase();
            const updatedActivities = { ...prevActivities };

            if (updatedActivities.all) {
              const allData = Array.isArray(updatedActivities.all.data)
                ? updatedActivities.all.data
                : [];
              updatedActivities.all = { ...updatedActivities.all, data: [data, ...allData] };
            }

            if (updatedActivities[activityType]) {
              const typeData = Array.isArray(updatedActivities[activityType].data)
                ? updatedActivities[activityType].data
                : [];
              updatedActivities[activityType] = {
                ...updatedActivities[activityType],
                data: [data, ...typeData],
              };
            }
            return updatedActivities;
          });
        });

        getSocketConnection.on(chatEvents.GET_MESSAGE, (data: any) => {
          if (!data?.chatId) return;

          const chatId = String(data.chatId || '').trim();
          if (!chatId) return;

          const incomingMessageId = String(data?.messageId || '').trim();
          let isDuplicateDelivery = false;
          if (incomingMessageId) {
            const processedByChat = processedMessageIdsRef.current;
            const processedSet = processedByChat[chatId] || new Set<string>();
            if (processedSet.has(incomingMessageId)) {
              isDuplicateDelivery = true;
            } else {
              processedSet.add(incomingMessageId);
              if (processedSet.size > 300) {
                const oldestMessageId = processedSet.values().next().value;
                if (oldestMessageId) processedSet.delete(oldestMessageId);
              }
              processedByChat[chatId] = processedSet;
            }
          }

          const syncUnreadForIncomingMessage = () => {
            setChatWindows((prevWindows: any) => {
              const openWindows = Array.isArray(prevWindows) ? prevWindows : [];
              const normalizedIncomingChatId = removeEnvPrefix(String(chatId || '').trim());
              const activeRouteChatId = removeEnvPrefix(
                new URLSearchParams(window.location.search).get('chatId') || '',
              );
              const isChatOpenInRoute =
                !!activeRouteChatId && activeRouteChatId === normalizedIncomingChatId;
              const isChatOpenInWindow = openWindows.some(
                (windowChatId: any) =>
                  removeEnvPrefix(String(windowChatId || '').trim()) === normalizedIncomingChatId,
              );
              const isChatOpen = isChatOpenInRoute || isChatOpenInWindow;

              const userUuid = String(user?.uuid ?? user?.guest_info?.uuid ?? '').trim();
              const myExtension = String(user?.user_info?.extension ?? '').trim();
              const senderId = String(
                data?.senderId || data?.sender?.uuid || data?.sender?.extension || '',
              ).trim();
              const isCallLogPrompt =
                String(data?.messageType || '').toLowerCase() === 'prompt' &&
                Boolean(data?.meetLogId);
              const isMeetingSystemMessage =
                String(data?.messageType || '').toLowerCase() === 'meet';
              const isSentByCurrentUser =
                !!senderId && (senderId === userUuid || senderId === myExtension);

              if (!isChatOpen) {
                updateChatLists(
                  (prevChats: any[]) => {
                    const chatsList = Array.isArray(prevChats) ? prevChats : [];
                    const targetChat = chatsList.find((c: any) => c?.chatId === chatId);

                    if (!targetChat || !Array.isArray(targetChat.users)) return chatsList;
                    const updatedUsers = targetChat.users.map((u: any) => {
                      if (
                        String(u?.uuid || '').trim() === userUuid &&
                        !isSentByCurrentUser &&
                        !isCallLogPrompt &&
                        !isMeetingSystemMessage
                      ) {
                        return { ...u, unreadMsg: (u?.unreadMsg || 0) + 1 };
                      }
                      return u;
                    });

                    return chatsList.map((c: any) =>
                      c?.chatId === chatId ? { ...c, users: updatedUsers } : c,
                    );
                  },
                  { targetChatId: chatId },
                );

                const allKnownChats = [
                  ...(allChatsRef.current || []),
                  ...(allAgentChatsRef.current || []),
                ];
                const targetChat =
                  allKnownChats.find((chat: any) => String(chat?.chatId || '').trim() === chatId) ||
                  null;
                const chatName =
                  getNameToShow(targetChat, user) || targetChat?.name || 'New message';
                const isMutedForCurrentUser =
                  !!userUuid &&
                  Array.isArray(targetChat?.isMuted) &&
                  targetChat.isMuted.includes(userUuid);

                if (
                  !isMutedForCurrentUser &&
                  !isSentByCurrentUser &&
                  !isCallLogPrompt &&
                  !isMeetingSystemMessage
                ) {
                  showIncomingMessageNotification({
                    chatId,
                    chatName,
                    messageData: data,
                  });
                }
              } else {
                // If it is open, we should mark as read via socket
                handleUnread({ chatId, type: 'read' }, false, getSocketConnection);
              }
              return openWindows;
            });
          };

          if (data?.parentMsgId) {
            setThreadsManager((prev: any) => {
              try {
                const prevList = Array.isArray(prev) ? prev : [];
                const isChatIdExist = prevList.find(
                  (item: any) => item?.parentMsgId === data?.parentMsgId,
                );

                if (isChatIdExist) {
                  return prevList.map((list: any) => {
                    if (list?.parentMsgId === data?.parentMsgId) {
                      const existingMessages = Array.isArray(list.messages) ? list.messages : [];

                      if (
                        data?.messageId &&
                        existingMessages.some((m: any) => m?.messageId === data.messageId)
                      ) {
                        return list;
                      }

                      return {
                        ...list,
                        messages: [...existingMessages, data],
                      };
                    }
                    return list;
                  });
                } else {
                  return [
                    ...prevList,
                    {
                      chatId: chatId,
                      messages: [data],
                      parentMsgId: data?.parentMsgId,
                    },
                  ];
                }
              } catch (error) {
                console.error('Error updating threads manager:', error);
                return prev || [];
              }
            });
            syncUnreadForIncomingMessage();
            return;
          }

          // 1. Update Message List
          setMessageList((prevList: any[]) => {
            const list = Array.isArray(prevList) ? prevList : [];
            const index = list.findIndex((item: any) => item?.chatId === chatId);
            if (index === -1) {
              return [...list, { chatId, messages: [data] }];
            }

            const next = [...list];
            const oldMsgs = Array.isArray(next[index]?.messages) ? next[index].messages : [];
            const existingMessageIndex = data?.messageId
              ? oldMsgs.findIndex((m: any) => m?.messageId === data.messageId)
              : -1;

            if (existingMessageIndex !== -1) {
              const updatedMessages = [...oldMsgs];
              updatedMessages[existingMessageIndex] = mergeIncomingMessage(
                updatedMessages[existingMessageIndex],
                data,
              );
              next[index] = {
                ...next[index],
                messages: updatedMessages,
              };
              return next;
            }

            next[index] = {
              ...next[index],
              messages: [...oldMsgs, data],
            };
            return next;
          });

          // 2. Update allChats/allAgentChats (lastMessage and prioritizing)
          updateChatLists(
            (prev: any[]) => {
              const chats = Array.isArray(prev) ? prev : [];
              const chatToUpdate = chats.find((c: any) => c?.chatId === chatId);

              if (!chatToUpdate) return prioritizeChat(chats, chatId);

              const updatedChat = {
                ...chatToUpdate,
                lastMessage: mergeIncomingMessage(chatToUpdate.lastMessage, data),
              };

              const filtered = chats.filter((c: any) => c?.chatId !== chatId);
              return [updatedChat, ...filtered];
            },
            { targetChatId: chatId },
          );

          // 3. Handle unread count if chat window is not open
          if (!isDuplicateDelivery) {
            syncUnreadForIncomingMessage();
          }
        });

        getSocketConnection.on(chatEvents.MESSAGE_LIST, (data: any) => {
          const messages = Array.isArray(data?.chats) ? data.chats : [];
          const chatId = data?.chatId || messages?.[0]?.chatId;
          if (!chatId) return;

          // setMessageList((prevList: any[]) => {
          //   const prev = Array.isArray(prevList) ? prevList : [];
          //   const current = prev.find((item: any) => item?.chatId === chatId)?.messages || [];
          //   return [
          //     ...prev.filter((item: any) => item?.chatId !== chatId),
          //     { chatId, messages: mergeMessages(messages, current) },
          //   ];
          // });

          setIsFetchingMessages((prev: any) => ({ ...(prev || {}), [chatId]: false }));
          setHasMessagesTopNextPage((prev: any) => ({
            ...(prev || {}),
            [chatId]: messages.length === 30,
          }));
        });

        getSocketConnection.on(chatEvents.PINNED_LIST, (data: any) => {
          const messages = Array.isArray(data?.chats) ? data.chats : [];
          const filteredMessages = messages?.filter((item: any) => !item?.isDeleted);
          const chatId = filteredMessages?.[0]?.chatId || data?.chatId;
          if (!chatId) return;
          setPinnedList((prevList: any[]) => {
            const prev = Array.isArray(prevList) ? prevList : [];
            return [
              ...prev.filter((item: any) => item?.chatId !== chatId),
              { chatId, chats: filteredMessages },
            ];
          });
        });

        getSocketConnection.on(chatEvents.MESSAGE_PINNED, (data: any) => {
          const { chatId = '', messageId = '', isPinned = false } = data?.newMessage || {};
          if (!chatId || !messageId) return;

          setMessageList((prevMessageList: any[]) =>
            (Array.isArray(prevMessageList) ? prevMessageList : []).map((list: any) => {
              if (list?.chatId !== chatId) return list;
              return {
                ...list,
                messages: (Array.isArray(list?.messages) ? list.messages : []).map((msg: any) =>
                  msg?.messageId === messageId ? { ...msg, isPinned } : msg,
                ),
              };
            }),
          );

          setPinnedList((prevList: any[]) => {
            const prev = Array.isArray(prevList) ? prevList : [];
            const chatPinned = prev.find((item: any) => item?.chatId === chatId);
            const chats = Array.isArray(chatPinned?.chats) ? chatPinned.chats : [];
            const incomingMessage = data?.newMessage || {};
            const updated = chats
              .map((msg: any) =>
                msg?.messageId === messageId ? { ...msg, ...incomingMessage, isPinned } : msg,
              )
              .filter((msg: any) => !msg?.isDeleted);
            const messageAlreadyExists = updated.some((msg: any) => msg?.messageId === messageId);

            const nextPinnedChats = isPinned
              ? messageAlreadyExists
                ? updated
                : incomingMessage?.isDeleted
                  ? updated
                  : [...updated, incomingMessage]
              : updated.filter((item: any) => item?.isPinned);

            return [
              ...prev.filter((item: any) => item?.chatId !== chatId),
              {
                chatId,
                chats: nextPinnedChats,
              },
            ];
          });
        });

        getSocketConnection.on(chatEvents.MESSAGE_DELETED, (data: any) => {
          const messageId = data?.messageId;
          const chatId = data?.chatId;
          const parentMsgId = data?.parentMsgId;

          if (!messageId || !chatId) return;

          if (parentMsgId) {
            setThreadsManager((prevMessageList: any) => {
              try {
                const prevList = Array.isArray(prevMessageList) ? prevMessageList : [];
                return prevList.map((list: any) => {
                  if (list?.chatId === chatId && list?.parentMsgId === parentMsgId) {
                    return {
                      ...list,
                      messages: (Array.isArray(list?.messages) ? list.messages : []).map(
                        (msg: any) =>
                          msg?.messageId === messageId ? { ...msg, isDeleted: true } : msg,
                      ),
                    };
                  }
                  return list;
                });
              } catch (error) {
                console.error('Error updating thread message list in deleted event:', error);
                return prevMessageList || [];
              }
            });
          }

          setMessageList((prevList: any[]) =>
            (Array.isArray(prevList) ? prevList : []).map((list: any) => {
              if (list?.chatId !== chatId) return list;
              return {
                ...list,
                messages: (Array.isArray(list?.messages) ? list.messages : []).map((msg: any) =>
                  msg?.messageId === messageId ? { ...msg, isDeleted: true } : msg,
                ),
              };
            }),
          );

          setPinnedList((prevPinnedList: any[]) => {
            const prev = Array.isArray(prevPinnedList) ? prevPinnedList : [];
            return prev.map((list: any) => {
              if (list?.chatId !== chatId) return list;
              return {
                ...list,
                chats: (Array.isArray(list?.chats) ? list.chats : []).filter(
                  (msg: any) => msg?.messageId !== messageId,
                ),
              };
            });
          });
        });

        getSocketConnection.on(chatEvents.MESSAGE_UPDATED, (data: any) => {
          const messageId = data?.messageId;
          const chatId = data?.chatId;
          const parentMsgId = data?.parentMsgId;

          if (!messageId || !chatId) return;

          if (parentMsgId) {
            setThreadsManager((prevMessageList: any) => {
              try {
                const prevList = Array.isArray(prevMessageList) ? prevMessageList : [];
                return prevList.map((list: any) => {
                  if (list?.chatId === chatId && list?.parentMsgId === parentMsgId) {
                    return {
                      ...list,
                      messages: (Array.isArray(list?.messages) ? list.messages : []).map(
                        (msg: any) => (msg?.messageId === messageId ? { ...msg, ...data } : msg),
                      ),
                    };
                  }
                  return list;
                });
              } catch (error) {
                console.error('Error updating thread message list in updated event:', error);
                return prevMessageList || [];
              }
            });
          }

          setMessageList((prevList: any[]) =>
            (Array.isArray(prevList) ? prevList : []).map((list: any) => {
              if (list?.chatId !== chatId) return list;
              return {
                ...list,
                messages: (Array.isArray(list?.messages) ? list.messages : []).map((msg: any) =>
                  msg?.messageId === messageId ? { ...msg, ...data } : msg,
                ),
              };
            }),
          );
        });

        getSocketConnection.on(chatEvents.FAV_ADDED, (data: any) => {
          updateChatLists(
            (prev: any[]) =>
              (Array.isArray(prev) ? prev : []).map((item: any) => {
                if (item?.chatId !== data?.chatId) return item;
                const favoriteChats = Array.isArray(item?.favoriteChats) ? item.favoriteChats : [];
                return favoriteChats.includes(user?.uuid)
                  ? item
                  : { ...item, favoriteChats: [...favoriteChats, user?.uuid] };
              }),
            { targetChatId: data?.chatId || '' },
          );
        });

        getSocketConnection.on(chatEvents.FAV_REMOVED, (data: any) => {
          updateChatLists(
            (prev: any[]) =>
              (Array.isArray(prev) ? prev : []).map((item: any) => {
                if (item?.chatId !== data?.chatId) return item;
                const favoriteChats = Array.isArray(item?.favoriteChats) ? item.favoriteChats : [];
                return {
                  ...item,
                  favoriteChats: favoriteChats.filter((id: string) => id !== user?.uuid),
                };
              }),
            { targetChatId: data?.chatId || '' },
          );
        });

        getSocketConnection.on(chatEvents.TYPING, (data: any) => {
          try {
            if (!data || typeof data !== 'object') return;

            // Safely clean data
            const cleanData = { ...data };
            delete cleanData['receiverId'];
            delete cleanData['socketId'];

            const { chatId = '', ...rest } = cleanData;
            const entries = Object.entries(rest || {});

            if (!chatId || entries.length === 0) return;

            const [userId, isTyping] = entries[0] as [string, any];
            if (!userId || typeof isTyping !== 'boolean') return;

            setTypingList((prev: any = {}) => {
              const next = { ...(prev || {}) };
              let users = Array.isArray(next[chatId]) ? [...next[chatId]] : [];

              if (isTyping) {
                if (!users.includes(userId)) {
                  users.push(userId);
                }
              } else {
                users = users.filter((id) => id !== userId);
              }

              if (users.length > 0) {
                next[chatId] = users;
              } else {
                delete next[chatId];
              }
              return next;
            });
          } catch (error) {
            console.error('Error in TYPING listener:', error);
          }
        });
        getSocketConnection.on(chatEvents.SCHEDULE_MEETING_UPDATE, (data) => {
          try {
            if (data) {
              queryClient.invalidateQueries({
                queryKey: ['getMeetingList'],
                exact: false,
              });
            }
          } catch (error) {
            console.log({ error });
          }
        });
        getSocketConnection.on(chatEvents.MEETING_UPDATE, (data) => {
          try {
            if (data) {
              queryClient.invalidateQueries({
                queryKey: ['ongoingMeetingList'],
                exact: false,
              });
              queryClient.invalidateQueries({ queryKey: ['upcomingList'] });
              queryClient.invalidateQueries({ queryKey: ['upcomingInvitedList'] });
              queryClient.invalidateQueries({ queryKey: ['pastMeetingList'] });
            }
          } catch (error) {
            console.log({ error });
          }
        });
        getSocketConnection.on(chatEvents.MEETING_INITIATED, (data: any) => {
          try {
            const invite = normalizeMeetingInvitePayload(data, chatEvents.MEETING_INITIATED);
            if (!invite) {
              console.warn('Invalid meeting initiated data received');
              return;
            }

            setMeetWindows((prev: any) => enqueueMeetingInvite(prev, invite));
          } catch (error) {
            console.error('Error in MEETING_INITIATED listener:', error);
          }
        });

        // ── Notes listeners ──────────────────────────────────────────────
        getSocketConnection.on('note-created', (data: any) => {
          setNotesList((prevNotesList: any[]) => {
            const isChatIdExist = prevNotesList.find((item) => item?.chatId === data?.chatId);
            if (isChatIdExist) {
              return prevNotesList.map((list: any) => {
                if (list?.chatId === data?.chatId) {
                  const notes = Array.isArray(list.notes) ? list.notes : [];
                  // Prevent duplicates on reconnect or double-fire
                  if (data?._id && notes.some((n: any) => n?._id === data._id)) return list;
                  return { ...list, notes: [...notes, data] };
                }
                return list;
              });
            }
            return [...prevNotesList, { chatId: data?.chatId, notes: [data] }];
          });
        });

        getSocketConnection.on('note-list', (data: any) => {
          const notes = data?.notes || [];
          setNotesList((prevNotesList: any[]) => {
            const chatId = notes[0]?.chatId;
            return [
              ...prevNotesList.filter((item: any) => item?.chatId !== chatId),
              { chatId, notes },
            ];
          });
        });

        getSocketConnection.on('note-deleted', (data: any) => {
          const noteId = data?._id;
          const chatId = data?.chatId;
          if (!noteId || !chatId) return;
          setNotesList((prevNotesList: any) => {
            let notes = prevNotesList?.find((list: any) => list?.chatId === chatId)?.notes || [];
            if (notes?.length > 0) {
              notes = notes.filter((note: any) => note?._id !== noteId);
            }
            const rest = prevNotesList?.filter((item: any) => item?.chatId !== chatId);
            return [...rest, { notes, chatId }];
          });
        });

        getSocketConnection.on('note-updated', (data: any) => {
          const noteId = data?._id;
          const chatId = data?.chatId;
          if (!noteId || !chatId) return;
          setNotesList((prevNotesList: any) => {
            const notesList =
              prevNotesList?.find((list: any) => list?.chatId === chatId)?.notes || [];
            if (notesList?.length > 0) {
              notesList.map((note: any) => {
                if (note?._id === noteId) {
                  note.title = data?.title;
                  note.noteData = data?.noteData;
                }
                return note;
              });
            }
            return [...prevNotesList];
          });
        });

        // ── Folder listeners ─────────────────────────────────────────────
        getSocketConnection.on('folder-created', (data: any) => {
          const chatId = data?.chatId;
          const folderId = data?._id;
          if (!chatId || !folderId) return;

          setFolderList((prevFolderList: any[]) => {
            const isChatIdExist = prevFolderList.find((item) => item?.chatId === chatId);
            if (!isChatIdExist) {
              return [...prevFolderList, { chatId, folders: [data] }];
            }

            return prevFolderList.map((list: any) => {
              if (list?.chatId !== chatId) return list;
              const folders = Array.isArray(list?.folders) ? list.folders : [];
              const folderIndex = folders.findIndex(
                (folder: any) => String(folder?._id || '') === String(folderId),
              );

              if (folderIndex >= 0) {
                const nextFolders = [...folders];
                nextFolders[folderIndex] = { ...nextFolders[folderIndex], ...data };
                return { ...list, folders: nextFolders };
              }

              return { ...list, folders: [...folders, data] };
            });
          });
        });

        getSocketConnection.on('folder-deleted', (data: any) => {
          const folderId = data?._id;
          const chatId = data?.chatId;
          if (!folderId || !chatId) return;
          setFolderList((prevFolderList: any) => {
            let folders =
              prevFolderList?.find((list: any) => list?.chatId === chatId)?.folders || [];
            if (folders?.length > 0) {
              folders = folders.filter((folder: any) => folder?._id !== folderId);
            }
            const rest = prevFolderList?.filter((item: any) => item?.chatId !== chatId);
            return [...rest, { folders, chatId }];
          });
        });

        getSocketConnection.on('folder-updated', (data: any) => {
          const chatId = data?.chatId;
          const folderId = data?._id;
          if (!chatId || !folderId) return;

          setFolderList((prevFolderList: any[]) => {
            const isChatIdExist = prevFolderList.find((item) => item?.chatId === chatId);
            if (!isChatIdExist) {
              return [...prevFolderList, { chatId, folders: [data] }];
            }

            return prevFolderList.map((item: any) => {
              if (item?.chatId !== chatId) return item;
              const folders = Array.isArray(item?.folders) ? item.folders : [];
              const folderIndex = folders.findIndex(
                (folder: any) => String(folder?._id || '') === String(folderId),
              );

              if (folderIndex < 0) {
                return { ...item, folders: [...folders, data] };
              }

              const nextFolders = [...folders];
              nextFolders[folderIndex] = { ...nextFolders[folderIndex], ...data };
              return { ...item, folders: nextFolders };
            });
          });
        });

        getSocketConnection.on(chatEvents.FOLDER_PINNED, (rawData: any) => {
          const data = rawData?.data?.result || rawData?.result || rawData;
          const targetFolderId = data?._id || data?.folderId;
          if (!targetFolderId) return;

          const isPinnedValue = (value: any) => {
            if (typeof value === 'string') return value.trim().length > 0;
            if (typeof value === 'boolean') return value;
            return value === true || value === 'pin';
          };

          setFolderList((prevFolderList: any[]) => {
            return prevFolderList.map((chatItem: any) => {
              const folders = Array.isArray(chatItem?.folders) ? chatItem.folders : [];
              let updated = false;

              const nextFolders = folders.map((folder: any) => {
                if (folder?._id !== targetFolderId) return folder;
                updated = true;

                // If server returns full folder payload, prefer it.
                if (data?.folderName || data?.chatId || data?.createdAt || data?.attachments) {
                  return { ...folder, ...data };
                }

                // If server returns explicit isPinned payload, prefer that directly.
                if (Object.prototype.hasOwnProperty.call(data || {}, 'isPinned')) {
                  return { ...folder, ...data };
                }

                const actionType = String(data?.type || '').toLowerCase();
                const currentlyPinned =
                  isPinnedValue(folder?.isPinned) || folder?.pin === true || folder?.pin === 'pin';
                const shouldPin =
                  actionType === 'pin' ? true : actionType === 'unpin' ? false : !currentlyPinned;

                return {
                  ...folder,
                  isPinned: shouldPin ? data?.senderId || folder?.isPinned || '' : '',
                  pin: shouldPin,
                };
              });

              return updated ? { ...chatItem, folders: nextFolders } : chatItem;
            });
          });
        });

        getSocketConnection.on('folder-list', (data: any) => {
          const folders = data?.folders || [];
          const dedupedFolders = folders.reduce((acc: any[], folder: any) => {
            const folderId = String(folder?._id || '');
            if (!folderId) return acc;
            const existingIndex = acc.findIndex(
              (item: any) => String(item?._id || '') === folderId,
            );
            if (existingIndex >= 0) {
              acc[existingIndex] = { ...acc[existingIndex], ...folder };
              return acc;
            }
            acc.push(folder);
            return acc;
          }, []);

          setFolderList((prevFolderList: any[]) => {
            const chatId = dedupedFolders[0]?.chatId;
            if (!chatId) return prevFolderList;
            return [
              ...prevFolderList.filter((item: any) => item?.chatId !== chatId),
              { chatId, folders: dedupedFolders },
            ];
          });
        });
      });
      getSocketConnection.on(chatEvents.RECONNECT, () => {
        setTimeout(() => {
          if (!isDisconnecting) {
            initialEmitters(getSocketConnection);
          }
        }, 1000);
      });
      getSocketConnection.on(chatEvents.DISCONNECT, (reason) => {
        setIsSocketConnected(false);
        console.log('disconnected');
        // Don't reconnect if we're in the process of disconnecting/logging out
        if (reason === 'io server disconnect' && !isDisconnecting) {
          getSocketConnection.connect();
        }
      });

      getSocketConnection.connect();
      setSocketEventsManager(getSocketConnection);
      return () => {
        getSocketConnection.removeAllListeners();
        getSocketConnection.disconnect();
      };
    }
  }, [
    guestTokenVersion,
    user?.isGuest,
    user?.guest_meeting_token,
    user?.sip_credentials?.domain,
    user?.token,
    user?.uuid,
  ]);

  function handleCreateNote(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit('nats-create-note', payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleDeleteNote(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit('nats-delete-note', payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleUpdateNote(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit('nats-update-note', payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function getNotesByChatId(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit('nats-get-note-by-chat-id', payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function getFoldersByChatId(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit('nats-get-folders-by-chat-id', payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleCreateFolder(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit('nats-create-folder', payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleDeleteFolder(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit('nats-delete-folder', payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleUpdateFolder(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit('nats-update-folder', payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handlePinFolder(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.PIN_FOLDER, payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handlePinFolderAttachment(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.PIN_FOLDER_ATTACHMENT, payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  const getNotifications = useCallback(() => {
    if (socketEventsManager && !isDisconnecting && user?.uuid) {
      if (notificationArr?.length === 0) {
        setNotificationLoading(true);
      }
      socketEventsManager.emit('notification-list', { uuid: user?.uuid }, (data: any) => {
        if (isDisconnecting) return;
        setNotificationArr(data?.data || []);
        setNotificationLoading(false);
      });
    }
  }, [socketEventsManager, user?.uuid, isDisconnecting]);

  const markReadNotification = useCallback(
    (id: any) => {
      if (socketEventsManager && !isDisconnecting && user?.uuid) {
        socketEventsManager.emit('notification-status', { uuid: user?.uuid, id });
        setTimeout(() => {
          if (!isDisconnecting) {
            getNotifications();
          }
        }, 2000);
      }
    },
    [socketEventsManager, user?.uuid, isDisconnecting, getNotifications],
  );

  function handleConferenceUpdate(data: any) {
    if (isDisconnecting) return;
    if (data && !(data instanceof Array) && Object.keys(data).length > 0) {
      const confId = data?.confID;
      setConferenceParticipants((prev: any) => {
        return prev?.filter((item: any) => item?.confId !== confId);
      });
    } else {
      if (data && data instanceof Array) {
        setConferenceParticipants((prev: any) => {
          const isExist = prev?.find((item: any) => item?.confId === data?.[0]?.confId) || null;
          if (isExist) {
            const newList = prev?.filter((item: any) => item?.confId !== data?.[0]?.confId);
            return [...newList, ...data];
          } else {
            return [...prev, ...data];
          }
        });
      }
    }
  }

  const getUnreadSMSCount = useCallback(() => {
    if (socketEventsManager && !isDisconnecting && user?.uuid) {
      socketEventsManager.emit(
        'get-inbound-sms-count-new',
        {
          uuid: user?.uuid,
        },
        (res: any) => {
          if (isDisconnecting) return;
          setSmsUnreadCountArray(res?.data || []);
        },
      );
    }
  }, [socketEventsManager, user?.uuid, isDisconnecting]);

  const updateSmsCount = useCallback(
    (payload: any) => {
      if (socketEventsManager && !isDisconnecting) {
        socketEventsManager.emit('update-inbound-sms-count-new', payload, () => {
          if (!isDisconnecting) {
            getUnreadSMSCount();
          }
        });
      }
    },
    [socketEventsManager, user?.uuid, isDisconnecting, getUnreadSMSCount],
  );

  const initialEmitters = useCallback(
    (socket: Socket) => {
      if (socket) {
        const meetingActorUuid = user?.uuid || user?.guest_info?.uuid || '';

        const meetingActorEmail = user?.user_info?.email || user?.guest_info?.email || '';
        const meetingActorName = (
          user?.uuid
            ? `${user?.user_info?.first_name || ''} ${user?.user_info?.last_name || ''}`
            : user?.guest_info?.name || ''
        ).trim();
        const domain = user?.sip_credentials?.domain || '';

        const conDoc: any = {
          data: getSessionInfo(),
        };
        if (user?.user_info?.extension) conDoc.userId = user.user_info.extension;
        if (user?.user_info?.site_uuid) conDoc.siteId = user.user_info.site_uuid;
        if (meetingActorUuid) conDoc.userUuid = meetingActorUuid;
        if (user?.company_info?.uuid) conDoc.companyUuid = user.company_info.uuid;
        if (domain) conDoc.domain = domain;
        if (meetingActorName) conDoc.fullName = meetingActorName;
        if (user?.user_info?.extension) conDoc.extension = user.user_info.extension;
        if (meetingActorEmail) conDoc.email = meetingActorEmail;

        socket.emit('con', { doc: conDoc }, (response: any) => {
          console.log('Server con:', response);
        });

        if (domain) {
          socket.emit(
            'presence',
            {
              doc: {
                domain,
              },
            },
            (response: any) => {
              console.log('Server presence:', response);
            },
          );
        }

        if (meetingActorUuid) {
          const presenceDoc: any = {
            uuid: meetingActorUuid,
            status: user?.socket_status || 'online',
            onCall: false,
          };
          if (user?.user_info?.extension) presenceDoc.userId = user.user_info.extension;
          if (domain) presenceDoc.domain = domain;

          socket.emit('user-presence-update', { doc: presenceDoc }, (response: any) => {
            console.log('Server user-presence-update:', response);
          });
        }

        if (domain) {
          socket.emit(
            'on-call-user',
            {
              data: {
                domain,
              },
            },
            (response: any) => {
              console.log('Server on-call-user:', response);
            },
          );
        }

        if (meetingActorUuid) {
          console.log('meetingActorUuid aaya');

          const chatPayload: any = { uuid: meetingActorUuid };
          if (domain) chatPayload.domain = domain;
          socket.emit(chatEvents.GET_CHATS, chatPayload);

          socket.emit(chatEvents.ACTIVITY_COUNT, {
            userID: meetingActorUuid,
          });

          socket.emit(chatEvents.RECENT_MEETINGS, {
            userID: meetingActorUuid,
          });

          socket.emit(chatEvents.RECENT_TASKS, {
            userID: meetingActorUuid,
          });
        }

        if (domain) {
          socket.emit('campaign-live-calls', {
            domain,
          });
        }
      }
    },
    [
      user?.company_info?.uuid,
      user?.guest_info?.email,
      user?.guest_info?.name,
      user?.guest_info?.uuid,
      user?.sip_credentials?.domain,
      user?.socket_status,
      user?.user_info?.email,
      user?.user_info?.extension,
      user?.user_info?.first_name,
      user?.user_info?.last_name,
      user?.user_info?.site_uuid,
      user?.uuid,
    ],
  );

  const mergeSeparateCalls = useCallback(
    async ({
      mainCallId = '',
      mainCallDirection = '',
      secondaryCallId = '',
      _uiSessions = null,
    }: {
      mainCallId: string;
      secondaryCallId: string;
      _uiSessions: any;
      mainCallDirection: string;
    }): Promise<{ success: boolean }> => {
      //   const mainCallId =
      //     activeCallSessionData?._parentCallID || activeCallSessionData?._callID;
      //   const secondaryCallId = callListing?.[0]?._callID;
      //   const mainSessionDirection = _uiSessions?.[mainSessionId]?._direction || '';

      return new Promise((resolve) => {
        try {
          if (
            !mainCallId ||
            !secondaryCallId ||
            !mainCallDirection ||
            !_uiSessions ||
            (_uiSessions && Object.keys(_uiSessions).length === 0)
          ) {
            console.error('Parameter missing.');
            resolve({ success: false });
            return;
          }
          const myExt = user?.user_info?.extension;
          const myCallSessions = allLiveCalls?.filter((item: any) => item?.['From-User'] === myExt);
          const mainSessionCallId = mainCallId;
          const transferSessionCallId = secondaryCallId;
          const mainSessionDirection = mainCallDirection || '';
          console.log('myCallSessions', myCallSessions, allLiveCalls);
          let callerUniqueId;
          if (mainSessionDirection === 'outbound') {
            callerUniqueId = myCallSessions?.filter(
              (item: any) =>
                item?.Direction === 'initiator' &&
                item?.['To-User']?.replace('+', '') ===
                  _uiSessions?.[mainSessionCallId]?._number?.replace('+', ''),
            )?.[0]?.['Call-ID'];
          } else {
            callerUniqueId = myCallSessions?.filter(
              (item: any) =>
                item?.Direction === 'recipient' &&
                item?.['To-User']?.replace('+', '') ===
                  _uiSessions?.[mainSessionCallId]?._number?.replace('+', ''),
            )?.[0]?.['Call-ID'];
          }

          const childUniqueId = myCallSessions?.filter(
            (item: any) =>
              item?.Direction === 'initiator' &&
              item?.['To-User']?.replace('+', '') ===
                _uiSessions?.[transferSessionCallId]?._number?.replace('+', ''),
          )?.[0]?.['Call-ID'];
          console.log({ callerUniqueId, childUniqueId });
          if (!callerUniqueId || !childUniqueId) {
            console.error('Something went wrong with presence.');
            resolve({ success: false });
            return;
          }
          const data = {
            callerUniqueId,
            childUniqueId,
          };

          console.log('data', data);
          socketEventsManager?.emit('add-call-conf', {
            data: data,
          });
        } catch (error) {
          resolve({ success: false });
          console.error(error);
        }
        resolve({ success: true });
      });
    },
    [socketEventsManager],
  );

  const userActivity = useCallback(
    (data: any) => {
      if (!socketEventsManager || !user || isDisconnecting) return;
      setActivityLoader(true);

      const domain = user?.sip_credentials?.domain;
      const userId = data?.userId || user?.user_info?.uuid;
      const timezone =
        user?.settings?.operational_hours?.regional?.timezone?.value || 'America/Denver';
      if (!userId || !domain) return;

      const payload = {
        userId,
        domain,
        interval: 'custom',
        start: data?.startTime,
        end: data?.endTime,
        timezone: timezone,
        startDate: data?.startDate,
        endDate: data?.endDate,
        activity: data?.activityType?.value,
      };
      socketEventsManager.emit('user-activity-list', payload, (res: any) => {
        if (isDisconnecting) return;
        if (res) {
          setUserActivitiesList(res);
        } else {
          setUserActivitiesList([]);
        }
        setActivityLoader(false);
      });
    },
    [socketEventsManager, user, isDisconnecting],
  );

  const transcriptionSocket = useCallback(
    (data: any) => {
      if (!socketEventsManager || !user || isDisconnecting) return;
      const domain = user?.sip_credentials?.domain;
      if (!domain) return;
      const payload = {
        data: {
          domain,
          companyUuid: data?.companyId,
          sipCallId: data?.sipCallId,
          callID: data?.callID,
        },
      };
      socketEventsManager.emit('transcript-prerecorded', payload);
    },
    [socketEventsManager, user, isDisconnecting],
  );

  const getCampaignLiveCalls = useCallback(
    (payload: any, callback?: (response: any) => void) => {
      if (!socketEventsManager) return;
      socketEventsManager.emit('campaign-live-calls', payload, (res: any) => {
        if (callback) callback(res);
      });
    },
    [socketEventsManager, isDisconnecting],
  );

  const getAiLiveWallboardData = useCallback(
    (payload: any, callback?: (response: any) => void) => {
      if (!socketEventsManager || isDisconnecting) return;
      socketEventsManager.emit(chatEvents.MAIN_AI_LIVE_WALLBOARD, payload, (res: any) => {
        if (callback) callback(res);
      });
    },
    [socketEventsManager, isDisconnecting],
  );

  const disconnectSocket = useCallback(() => {
    setIsDisconnecting(true);
    if (socketEventsManager) {
      try {
        socketEventsManager.removeAllListeners();
        socketEventsManager.disconnect();
      } catch (error) {
        console.error('Error disconnecting socket:', error);
      } finally {
        setSocketEventsManager(null);
      }
    }
  }, [socketEventsManager]);

  function handleOnCallTranscript(data: any) {
    if (data?.sipCallId && data?.mode === 'ai-data') {
      setInCallTranscription((prev: any) => ({
        ...prev,
        [data.sipCallId]: {
          ...prev[data.sipCallId],
          AiData: data,
        },
      }));
    }
  }

  function chatExist(chatId: string) {
    if (!chatId) return null;
    return Array.isArray(allChats) ? allChats.find((chat: any) => chat?.chatId === chatId) : null;
  }

  function createNewChat(
    otherPersonDetails: any,
    maximize = false,
    message = '',
    isForwarded = false,
    chatId = '',
    attachments: any[] = [],
  ) {
    if (!otherPersonDetails?.uuid || !user?.uuid) return;

    const requiredChatId =
      chatId || createPrivateChatIdFromUsers([user?.uuid, otherPersonDetails?.uuid]);

    const ifElementExist: any = chatExist(requiredChatId);
    const isHidden = ifElementExist?.isHidden?.includes(user?.uuid);

    if (ifElementExist) {
      if (isHidden) {
        socketEventsManager?.emit(chatEvents.REVERT_CHAT, {
          chatId: requiredChatId,
          senderId: user?.uuid,
        });
      }

      handleOpenChatInWindow(requiredChatId, false, maximize);

      if (message) {
        handleSendMessage({
          chatId: requiredChatId,
          message,
          attachments: attachments || [],
          senderId: user?.uuid,
          receiverId: [otherPersonDetails?.uuid],
          messageId: uuidV4(),
          isForwarded,
          createdAt: new Date().toISOString(),
        });
      }
    } else if (socketEventsManager) {
      const transformUser = (u: any) => {
        const info = u?.user_info || u;
        return {
          uuid: info?.uuid || u?.uuid,
          name: info?.name || `${info?.first_name || ''} ${info?.last_name || ''}`.trim(),
          email: info?.email,
          extension: info?.extension,
        };
      };

      const usersToSend = [transformUser(user), transformUser(otherPersonDetails)];

      socketEventsManager.emit(
        chatEvents.CREATE_NEW_CHAT,
        {
          chatId: requiredChatId,
          company_uuid: user?.company_info?.uuid,
          users: usersToSend,
          allUsers: usersToSend,
        },
        (response: any) => {
          console.info('Server ack: handleSendMessage', response);
          // ✅ send message only after chat is created
          if (message && response?.status === 200) {
            handleSendMessage({
              chatId: requiredChatId,
              message,
              attachments: attachments || [],
              senderId: user?.uuid,
              receiverId: [otherPersonDetails?.uuid],
              messageId: uuidV4(),
              isForwarded,
              createdAt: new Date().toISOString(),
            });
          }
          // toast.success('Chat created successfully!');
          handleOpenChatInWindow(requiredChatId, false, maximize);
        },
      );
    }
  }

  function handleSendMessage(message: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.SEND_MESSAGE, message, (response: any) => {
        console.log('Server ack:', response);
        callback?.(response);
      });
    }
  }

  function handleLeaveBeforeJoin(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.LEAVE_BEFORE_JOIN, payload, (response: any) => {
        console.log('Server ack:', response);
        callback?.(response);
      });
    }
  }

  function getSeenByList(payload: any, callback: any) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.SEEN_BY, payload, (response: any) => {
        callback(response);
      });
    }
  }

  function handleUpdateChatname({ chatId = '', name = '', callback }: any) {
    if (socketEventsManager) {
      socketEventsManager.emit(
        chatEvents.UPDATE_CHAT_NAME,
        {
          chatId,
          name,
        },
        (response: any) => {
          console.log('Server ack: handleUpdateChatname', response);
          callback?.(response);
        },
      );
    }
  }

  function handleUpdateChannel(payload: any, callback?: (response: any) => void) {
    console.log('handleUpdateChannel called with payload:', payload);
    if (socketEventsManager) {
      console.log('Emitting UPDATE_CHANNEL event...');
      socketEventsManager.emit(chatEvents.UPDATE_CHANNEL, payload, (response: any) => {
        console.log('Server ack: handleUpdateChannel response:', response);
        if (!isSocketAckFailure(response)) {
          const responseChat = extractChatFromSocketAck(response);
          patchChatInLists(payload?.chatId || responseChat?.chatId || '', {
            ...(payload || {}),
            ...(responseChat || {}),
          });
        }
        callback?.(response);
      });
    } else {
      console.error('handleUpdateChannel: socketEventsManager is null');
      callback?.({
        success: false,
        error: { message: 'Socket connection is not available' },
      });
    }
  }

  function handlePinConversation(
    {
      chatId = '',
      type = 'pin',
      userID = user?.uuid,
    }: { chatId: string; type: PinConversationAction; userID?: string },
    callback?: (response: any) => void,
  ) {
    if (!chatId || !userID) return;
    emitPinConversationEvent(socketEventsManager, { chatId, userID, type }, (response: any) => {
      const ack = Array.isArray(response) ? response?.[0] : response;
      const isSuccess = ack?.success === true || ack?.status === 200 || ack?.data?.result === true;
      const successMessage = `Conversation ${type === 'pin' ? 'pinned' : 'unpinned'} successfully`;
      const errorMessage =
        ack?.error?.message || `Failed to ${type === 'pin' ? 'pin' : 'unpin'} conversation`;

      if (ack && typeof ack === 'object') {
        if (isSuccess) {
          toast.success(successMessage);
        } else {
          toast.error(errorMessage);
        }
      }

      console.log('Server ack: handlePinConversation', response);
      callback?.(response);
    });
  }

  function handleMuteConversation({ chatId = '', mute = false, callback }: any) {
    if (socketEventsManager) {
      socketEventsManager.emit(
        chatEvents.MUTE_CONVERSATION,
        {
          chatId,
          userID: user?.uuid,
          mute,
        },
        (response: any) => {
          console.log('Server ack: handleMuteConversation', response);
          callback?.(response);
        },
      );
    }
  }

  function getChatPinnedMessages(chatId: string, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.GET_PINNED_CHATS, { chatId }, (response: any) => {
        console.log('Server ack:', response);
        callback?.(response);
      });
    }
  }

  function handleUnread(payload: any, fromClick = false, socket: any = null) {
    const emitter = socket || socketEventsManager;
    const unreadAction = String(payload?.type || '')
      .trim()
      .toLowerCase();
    if (payload?.chatId && unreadAction === 'read') {
      closeMessageNotificationForChat(payload.chatId);
    }

    if (emitter) {
      emitter.emit(
        chatEvents.HANDLE_UNREAD,
        {
          ...payload,
          userId: user?.uuid ?? user?.guest_info?.uuid ?? '',
        },
        (response: any) => {
          console.log('Server ack:', response);
        },
      );

      if (fromClick) {
        updateChatLists(
          (prevChats: any[]) => {
            if (!Array.isArray(prevChats)) return prevChats;
            const chatIndex = prevChats.findIndex((item: any) => item?.chatId === payload?.chatId);
            if (chatIndex === -1) return prevChats;

            const chatToUpdate = prevChats[chatIndex];
            const users = Array.isArray(chatToUpdate?.users) ? chatToUpdate.users : [];
            const userUuid = user?.uuid ?? user?.guest_info?.uuid ?? '';
            const updatedUsers = users.map((userData: any) =>
              userData?.uuid === userUuid ? { ...userData, unreadMsg: 0 } : userData,
            );

            return [
              ...prevChats.slice(0, chatIndex),
              {
                ...chatToUpdate,
                users: updatedUsers,
              },
              ...prevChats.slice(chatIndex + 1),
            ];
          },
          { targetChatId: payload?.chatId || '' },
        );
      }
    }
  }

  function handleTyping(
    { currentChat, isTyping = false }: { currentChat: any; isTyping: boolean },
    callback?: (response: any) => void,
  ) {
    if (socketEventsManager) {
      const meetingActorUuid = user?.uuid || user?.guest_info?.uuid || '';
      if (!meetingActorUuid) return;
      const otherUserData = currentChat?.users?.find(
        (item: any) => item?.uuid !== meetingActorUuid,
      );

      socketEventsManager.emit(
        chatEvents.EMIT_TYPING,
        {
          chatId: currentChat?.chatId,
          receiverId: currentChat?.isGroupChat
            ? currentChat?.users
                ?.map((item: any) => item?.uuid)
                ?.filter((item: any) => item !== meetingActorUuid)
            : [otherUserData?.uuid],
          [meetingActorUuid]: isTyping,
        },
        (response: any) => {
          console.log('Server ack:', response);
          callback?.(response);
        },
      );
    }
  }

  function handleToggleChatAsFavorite(chatId: string, callback?: (response: any) => void) {
    if (socketEventsManager && chatId) {
      socketEventsManager.emit(
        chatEvents.ADD_TO_FAVORITES,
        {
          chatId,
          senderId: user?.uuid,
        },
        (response: any) => {
          console.log('Server ack:', response);
          callback?.(response);
        },
      );
    }
  }

  function handleDeleteChat(chatId: string, callback?: (response: any) => void) {
    if (socketEventsManager && chatId) {
      socketEventsManager.emit(
        chatEvents.DELETE_CHANNEL,
        {
          chatId,
          senderId: user?.uuid,
          userID: user?.uuid,
        },
        (response: any) => {
          console.log('Server ack:', response);
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('chatId');
            return next;
          });
          callback?.(response);
        },
      );
    }
  }

  function handleExitChat(chatId: string, callback?: (response: any) => void) {
    if (socketEventsManager && chatId) {
      socketEventsManager.emit(
        chatEvents.EXIT_CHAT,
        {
          chatId,
          userID: user?.uuid,
        },
        (data: any) => {
          console.log('Server ack:', data);
          callback?.(data);
        },
      );
    }
  }

  function handleAddChannelMember(
    chatId: string,
    members: any[],
    callback?: (response: any) => void,
  ) {
    console.log('handleAddChannelMember called:', {
      chatId,
      members,
      hasSocket: !!socketEventsManager,
    });
    if (socketEventsManager && chatId) {
      socketEventsManager.emit(
        chatEvents.REMOVE_CHANNEL_MEMBER,
        {
          chatId,
          userID: user?.uuid,
          action: 'add',
          members,
        },
        (response: any) => {
          console.log('Server ack:', response);
          callback?.(response);
        },
      );
    }
  }

  function handleMeetInviteMember(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.MEETING_INVITE_MEMBER, payload, (response: any) => {
        console.log('Server ack:', response);
        callback?.(response);
      });
    }
  }

  function handleRemoveChannelMember(
    chatId: string,
    members: string[],
    callback?: (response: any) => void,
  ) {
    if (socketEventsManager && chatId) {
      socketEventsManager.emit(
        chatEvents.REMOVE_CHANNEL_MEMBER,
        {
          chatId,
          userID: user?.uuid,
          action: 'remove',
          members,
        },
        (response: any) => {
          console.log('Server ack:', response);
          callback?.(response);
        },
      );
    }
  }

  function handlePinMessage(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.PIN_MESSAGE, payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleUserPresenceUpdate(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(
        chatEvents.USER_PRESENCE_UPDATE,
        { doc: payload },
        (response: any) => {
          callback?.(response);
        },
      );
    }
  }

  function handleAssignAdminPrivileges(
    chatId: string,
    id: string,
    callback?: (response: any) => void,
  ) {
    if (socketEventsManager && chatId) {
      socketEventsManager.emit(
        chatEvents.ASSIGN_UNASSIGN_ADMIN,
        {
          chatId,
          userID: user?.uuid,
          subAdminID: id,
        },
        (response: any) => {
          console.log('Server ack:', response);
          callback?.(response);
        },
      );
    }
  }

  function handleAddChannelImage(
    chatId: string,
    avatar: string,
    callback?: (response: any) => void,
  ) {
    if (socketEventsManager && chatId) {
      socketEventsManager.emit(
        chatEvents.ADD_CHANNEL_IMAGE,
        {
          chatId,
          avatar,
        },
        (response: any) => {
          console.log('Server ack:', response);
          if (!isSocketAckFailure(response)) {
            const responseChat = extractChatFromSocketAck(response);
            patchChatInLists(chatId, {
              ...(responseChat || {}),
              avatar: responseChat?.avatar || avatar,
            });
          }
          callback?.(response);
        },
      );
    } else {
      callback?.({
        success: false,
        error: { message: 'Socket connection is not available' },
      });
    }
  }

  function handleRemoveChannelImage(chatId: string, callback?: (response: any) => void) {
    if (socketEventsManager && chatId) {
      socketEventsManager.emit(
        chatEvents.REMOVE_CHANNEL_IMAGE,
        {
          chatId,
        },
        (response: any) => {
          console.log('Server ack:', response);
          if (!isSocketAckFailure(response)) {
            const responseChat = extractChatFromSocketAck(response);
            patchChatInLists(chatId, {
              ...(responseChat || {}),
              avatar: responseChat?.avatar || '',
            });
          }
          callback?.(response);
        },
      );
    } else {
      callback?.({
        success: false,
        error: { message: 'Socket connection is not available' },
      });
    }
  }

  function handleDeleteMessage(msgObj: any, chatId: string, callback?: (response: any) => void) {
    if (socketEventsManager && chatId) {
      socketEventsManager.emit(
        chatEvents.DELETE_MESSAGE,
        {
          messageId: msgObj?.messageId,
          senderId: msgObj?.senderId,
          receiverId: msgObj?.receiverId,
          chatId,
        },
        (response: any) => {
          console.log('Server ack:', response);
          callback?.(response);
        },
      );
    }
  }

  function handleActivityStatus(
    type?: string,
    activityID?: string,
    callback?: (response: any) => void,
  ) {
    if (socketEventsManager) {
      socketEventsManager.emit(
        chatEvents.ACTIVITY_STATUS,
        {
          type: type ? type : undefined,
          activityID: activityID ? activityID : undefined,
          userID: user?.uuid,
        },
        (response: any) => {
          console.log('Server ack:', response);
          callback?.(response);
        },
      );
    }
  }

  function handleMeetInitiate(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.MEET_INITIATE, payload, (response: any) => {
        callback?.(response);
        console.log('Called here----------');
        setActiveCallTab();
      });
    }
  }

  function handleMeetAccept(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.MEETING_ACCEPT, payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleMeetDecline(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.MEETING_DECLINE, payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleMeetLeave(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.MEET_LEAVE, payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleMeetMissed(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.MEETING_MISSED, payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleUpdateMessage(params: {
    messageId: any;
    currentChat: any;
    message: any;
    callback?: (response: any) => void;
    [key: string]: any;
  }) {
    const { messageId, currentChat, message, callback, ...rest } = params;
    if (socketEventsManager && currentChat?.chatId) {
      const otherUserData = currentChat?.users?.find((item: any) => item?.uuid !== user?.uuid);

      socketEventsManager.emit(
        chatEvents.UPDATE_MESSAGE,
        {
          messageId,
          senderId: user?.uuid,
          receiverId:
            currentChat?.chatId === user?.uuid
              ? [user?.uuid]
              : currentChat?.isGroupChat
                ? currentChat?.users
                    ?.map((item: any) => item?.uuid)
                    ?.filter((item: any) => item !== user?.uuid)
                : [otherUserData?.uuid],
          chatId: currentChat?.chatId,
          message,
          ...rest,
        },
        (response: any) => {
          console.log('Server ack:', response);
          callback?.(response);
        },
      );
    }
  }

  function handleSendReaction(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.REACT_ON_MESSAGE, payload, (response: any) => {
        console.log('Server ack:', response);
        callback?.(response);
      });
    }
  }

  function handleTerminateCall(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager) {
      socketEventsManager.emit(chatEvents.TERMINATE_CALL, payload, (response: any) => {
        callback?.(response);
      });
    }
  }

  function handleGetMessageByChatId({
    chatId,
    userId,
    messageId = undefined,
    direction = undefined,
    cursor = undefined,
    cb = undefined,
  }: {
    chatId: string;
    userId: string;
    messageId?: string;
    direction?: 'up' | 'down' | undefined;
    cursor?: any;
    cb?: any;
  }) {
    setChatPageList((prev: any) => ({ ...(prev || {}), [chatId]: cursor || messageId || null }));
    setIsFetchingMessages((prev: any) => ({ ...(prev || {}), [chatId]: true }));
    const activeSocket = socketEventsManagerRef.current || socketEventsManager;
    if (activeSocket) {
      activeSocket.emit(
        chatEvents.GET_CHAT_MESSAGES,
        {
          chatId,
          userID: userId,
          direction,
          cursor,
          messageId,
        },
        (response: any) => {
          const rawChats = response?.response?.data?.result?.chats || response?.data?.result?.chats;
          const messages = Array.isArray(rawChats) ? rawChats : [];

          const responseChatId =
            response?.response?.data?.result?.chatId || response?.data?.result?.chatId || chatId;

          if (direction === 'up' || !direction) {
            setHasMessagesTopNextPage((prev: any) => ({
              ...(prev || {}),
              [responseChatId]: messages.length === 30,
            }));
          }
          if (direction === 'down') {
            setHasMessagesBottomNextPage((prev: any) => ({
              ...(prev || {}),
              [responseChatId]: messages.length === 30,
            }));
          }
          setIsFetchingMessages((prev: any) => ({ ...(prev || {}), [responseChatId]: false }));

          if (cb) {
            return cb({ messages, chatId: responseChatId });
          }
          setMessageList((prevMessageList: any) => {
            const prevList = Array.isArray(prevMessageList) ? prevMessageList : [];
            const currentChatMessages =
              prevList.find((item: any) => item?.chatId === responseChatId)?.messages || [];

            return [
              ...prevList.filter((item: any) => item?.chatId !== responseChatId),
              {
                chatId: responseChatId,
                messages: mergeMessages(messages, currentChatMessages),
              },
            ];
          });
        },
      );
    }
  }

  function searchMessages({
    chatId,
    userID,
    keyword,
    cb,
  }: {
    chatId: string;
    userID: string;
    keyword: string;
    cb: (results: any[]) => void;
  }) {
    if (!socketEventsManager || !keyword?.trim()) {
      cb([]);
      return;
    }
    socketEventsManager.emit('nats-search-message', { chatId, userID, keyword }, (res: any) => {
      const data = res?.response?.data?.result?.chats || [];
      cb(data);
    });
  }

  function handleOpenChatInWindow(chatId: string, remove = false, maximize = false) {
    if (!chatId) return;

    setChatWindows((prev: any[]) => {
      const prevList = Array.isArray(prev) ? prev : [];
      const ifChatExist = prevList.find((c: any) => c === chatId);

      if (!ifChatExist && chatMode) {
        const newChatWindows = [...prevList, chatId];
        if (newChatWindows.length > 3) {
          return newChatWindows.slice(-3);
        }
        return newChatWindows;
      }

      if (!ifChatExist && !chatMode) {
        return [chatId];
      }

      if (remove) {
        return prevList.filter((c: any) => c !== chatId);
      }

      return prevList;
    });

    if (maximize && !remove) {
      setChatWindowsMaximized((prev: any) => ({
        ...(prev || {}),
        [chatId]: true,
      }));
    } else if (remove) {
      setChatWindowsMaximized((prev: any) => {
        const next = { ...(prev || {}) };
        delete next[chatId];
        return next;
      });
    }
  }

  function getAttachmentsByChatId(payload: any, callback?: (response: any) => void) {
    if (socketEventsManager && payload?.chatId) {
      socketEventsManager.emit(chatEvents.NATS_ATTACHMENTS, payload, (response: any) => {
        console.log('Server ack getAttachmentsByChatId:', response);
        callback?.(response);
      });
    }
  }
  const extension = user?.user_info?.extension;
  const isMeOnCall = usersOnlineStatus?.find((user: any) => user?.userId == extension)?.onCall;

  const handleAdminNotificationRefresh = () => {
    if (
      isRefreshingForUpdate ||
      !socketEventsManager ||
      !user?.uuid ||
      !adminNotification?.adminNotificationUuid
    ) {
      return;
    }

    setIsRefreshingForUpdate(true);

    let hasReloaded = false;
    const reloadPage = () => {
      if (hasReloaded) return;
      hasReloaded = true;
      window.location.reload();
    };
    const reloadFallback = window.setTimeout(reloadPage, 1000);

    socketEventsManager.emit(
      'admin-notification-status',
      {
        uuid: user.uuid,
        adminNotificationUuid: adminNotification.adminNotificationUuid,
      },
      () => {
        window.clearTimeout(reloadFallback);
        reloadPage();
      },
    );
  };

  return (
    <SocketEvents.Provider
      value={{
        socketEventsManager: socketEventsManager,
        allLiveCalls: allLiveCalls,
        ongoingLiveCalls: ongoingLiveCalls,
        usersOnlineStatus: usersOnlineStatus,
        unreadCount: unreadCount,
        unreadSMSCount: unreadSMSCount,
        unreadTaskCount: unreadTaskCount,
        conferenceParticipants: conferenceParticipants,
        conferenceTracker: conferenceTracker,
        setConferenceTracker: setConferenceTracker,
        getUnreadSMSCount: getUnreadSMSCount,
        updateSmsCount: updateSmsCount,
        transcriptionSocket: transcriptionSocket,
        setSmsUnreadCountArray: setSmsUnreadCountArray,
        smsUnreadCountArray: smsUnreadCountArray,
        getNotifications: getNotifications,
        notificationArr: notificationArr,
        notificationLoading: notificationLoading,
        mergeSeparateCalls,
        ongoingDepartmentCalls,
        markReadNotification,
        liveTranscriptionList,
        setLiveTranscriptionList,
        userActivity,
        userActivitiesList,
        disconnectSocket,
        activityLoader,
        ongoingCampaignActivity,
        omniChannelData,
        setOmniChannelData,
        callSummary,
        setCallSummary,
        setOngoingCampaignActivity,
        userLogoutData,
        setUserLogoutData,
        inCallTranscription,
        setInCallTranscription,
        handleOnCallTranscript,
        transcriptionActiveKeys,
        addTranscriptionActiveKey,
        removeTranscriptionActiveKey,
        isSocketConnected,
        callingInProgress,
        callPresence,
        allChats,
        allAgentChats,
        getAgentChats,
        messageList,
        setMessageList,
        pinnedList,
        threadsManager,
        setThreadsManager,
        typingList,
        chatPageList,
        isFetchingMessages,
        hasMessagesTopNextPage,
        hasMessagesBottomNextPage,
        chatWindows,
        setChatWindows,
        chatWindowsMaximized,
        setChatWindowsMaximized,
        meetWindows,
        setMeetWindows,
        meetInitiateModalData,
        setMeetInitiateModalData,
        meetingAcceptingChatId,
        setMeetingAcceptingChatId,
        chatMode,
        setChatMode,
        activityCount,
        activityList,
        setActivityList,
        unreadMessageCount,
        groupChatUnreadCount,
        directMessageUnreadCount,
        aiChatUnreadCount,
        recentMeetings,
        recentTasks,
        setRecentMeetings,
        setRecentTasks,
        handleOpenChatInWindow,
        createNewChat,
        chatExist,
        createPrivateChatId: createPrivateChatIdFromUsers,
        handleSendMessage,
        handleGetMessageByChatId,
        getChatPinnedMessages,
        handleUnread,
        handleTyping,
        handleToggleChatAsFavorite,
        handleDeleteChat,
        handleExitChat,
        handleAddChannelMember,
        handleRemoveChannelMember,
        handleMeetInviteMember,
        handlePinMessage,
        handleUserPresenceUpdate,
        handleAssignAdminPrivileges,
        handleAddChannelImage,
        handleRemoveChannelImage,
        handleDeleteMessage,
        handleActivityStatus,
        handleMeetInitiate,
        handleMeetAccept,
        handleMeetDecline,
        handleMeetLeave,
        handleMeetMissed,
        handleTerminateCall,
        handleUpdateMessage,
        handleSendReaction,
        handleUpdateChatname,
        handleUpdateChannel,
        handlePinConversation,
        handleMuteConversation,
        handleLeaveBeforeJoin,
        getSeenByList,
        searchMessages,
        handleCreateNote,
        handleDeleteNote,
        handleUpdateNote,
        getNotesByChatId,
        getFoldersByChatId,
        notesList,
        folderList,
        handleCreateFolder,
        handleDeleteFolder,
        handleUpdateFolder,
        handlePinFolder,
        handlePinFolderAttachment,
        getAttachmentsByChatId,
        liveCalls,
        setLiveCalls,
        eventLiveCallsData,
        setEventLiveCallsData,
        callHistoryLiveUpdate,
        liveQueueCalls,
        setLiveQueueCalls,
        activeCampaigns,
        setActiveCampaigns,
        campaignCallFlowFunnel,
        setCampaignCallFlowFunnel,
        campaignAgents,
        setCampaignAgents,
        getCampaignLiveCalls,
        campaignLiveCallsData,
        setCampaignLiveCallsData,
        aiLiveWallboardData,
        setAiLiveWallboardData,
        campaignAiLiveCallData,
        setCampaignAiLiveCallData,
        getAiLiveWallboardData,
        contactsInfo,
        upsertContactInfoByNumber,
        aiChatRequests,
        setAiChatRequests,
        handleAiChatAccept,
        handleAiChatDecline,
        sentimentData,
        meetingSubtitlesByChatId,
        clearMeetingSubtitles,
        updateMeetingSubtitleLanguage,
        updateMeetingSubtitleEnabled,
      }}
    >
      <audio ref={audioRef} src={notificationSound} preload="auto" />
      {children}

      {leadProcessNotifications.length ? (
        <div className="fixed bottom-4 right-4 z-[1000] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3 sm:bottom-5 sm:right-5">
          {leadProcessNotifications.map((notification) => {
            const hasFailure = notification.fail > 0;
            const Icon = hasFailure ? AlertTriangle : CheckCircle2;

            return (
              <div
                key={notification.id}
                className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl ring-1 ring-black/5 dark:border-border dark:bg-card"
              >
                <div className={`h-1 ${hasFailure ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                <div className="flex items-start gap-3 p-4">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      hasFailure ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-foreground">
                          {notification.entityLabel} processing finished
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-muted-foreground">
                          Import result summary is ready.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => dismissLeadProcessNotification(notification.id)}
                        className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-stone-100 hover:text-slate-700 dark:hover:bg-muted dark:hover:text-foreground"
                        aria-label="Close lead processing notification"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-2 text-center">
                        <p className="text-base font-bold leading-none text-emerald-700">
                          {notification.success}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-emerald-700">Success</p>
                      </div>
                      <div className="rounded-md border border-red-100 bg-red-50 px-2 py-2 text-center">
                        <p className="text-base font-bold leading-none text-red-600">
                          {notification.fail}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-red-600">Failed</p>
                      </div>
                      <div className="rounded-md border border-sky-100 bg-sky-50 px-2 py-2 text-center">
                        <p className="text-base font-bold leading-none text-sky-600">
                          {notification.duplicate}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-sky-600">Duplicate</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* AI Chat Request Accept/Reject Popup */}
      {!isMeOnCall && (
        <AIChatRequestModal
          requests={aiChatRequests}
          isOpen={showAiChatModal && aiChatRequests.length > 0}
          onDismiss={() => setShowAiChatModal(false)}
          onClose={(chatId) => {
            setAiChatRequests((prev) => prev.filter((r) => r?.chatId !== chatId));
            setShowAiChatModal(false);
          }}
          onAccept={(data) => {
            console.log('ai-chat-request ACCEPTED', data);
          }}
          onReject={(data) => {
            console.log('ai-chat-request REJECTED', data);
            handleAiChatDecline({ chatId: data?.chatId });
          }}
        />
      )}

      {/* Storage Limit Modal */}
      <Dialog open={isStorageModalOpen} onOpenChange={setIsStorageModalOpen}>
        <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden rounded-2xl border border-gray-100 shadow-2xl bg-white">
          {/* Header with warm/warning premium background */}
          <div className="relative p-6 pb-4 bg-gradient-to-br from-amber-50 to-orange-50/50 border-b border-amber-100/60">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-lg shadow-amber-500/20">
                <HardDrive className="h-6 w-6 animate-pulse" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-lg font-bold text-gray-900 leading-tight">
                  Storage Limit Exceeded
                </h3>
                <p className="text-xs font-medium text-amber-700/80">
                  Your organization's storage is nearly full or has run out of space.
                </p>
              </div>
            </div>
          </div>

          {/* Details / Usage Progress */}
          <div className="p-6 flex flex-col gap-5">
            <p className="text-sm text-gray-700 leading-relaxed">
              Your organization has used{' '}
              <strong className="font-semibold text-gray-900">
                {storageLimitData?.used_storage || 0} GB
              </strong>{' '}
              of its total{' '}
              <strong className="font-semibold text-gray-900">
                {storageLimitData?.total_storage || 0} GB
              </strong>{' '}
              storage limit.
            </p>

            {/* Circular/horizontal progress visual */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-gray-500">Storage Consumption</span>
                <span
                  className={`${(storageLimitData?.storage_used_percentage || 0) >= 90 ? 'text-red-500' : 'text-primary'}`}
                >
                  {storageLimitData?.storage_used_percentage || 0}% Used
                </span>
              </div>

              <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`absolute top-0 left-0 h-full transition-all duration-500 rounded-full ${
                    (storageLimitData?.storage_used_percentage || 0) >= 90
                      ? 'bg-gradient-to-r from-red-500 to-orange-500'
                      : 'bg-gradient-to-r from-primary to-sky-400'
                  }`}
                  style={{
                    width: `${Math.min(storageLimitData?.storage_used_percentage || 0, 100)}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-500">
                <span>0 GB</span>
                <span>{storageLimitData?.total_storage || 0} GB</span>
              </div>
            </div>

            {/* Info Message Box */}
            <div className="flex items-start gap-2.5 p-3.5 bg-gray-50 rounded-xl border border-gray-100">
              <AlertTriangle className="h-4.5 w-4.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-gray-600 leading-normal">
                To continue uploading files, attachments, transcription and call recordings, please
                purchase extra storage space.
              </p>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-100 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsStorageModalOpen(false)}
              className="text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 rounded-xl h-11 px-5 transition-colors cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                /* Billing › Plan has been removed; nothing to navigate to. */
                setIsStorageModalOpen(false);
              }}
              className="bg-primary hover:bg-primary/95 text-white shadow-lg shadow-primary/20 rounded-xl h-11 px-6 font-semibold transition-all hover:scale-[1.02] cursor-pointer"
            >
              Buy More Storage
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(adminNotification)}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          className="sm:max-w-[500px] overflow-hidden border-0 bg-white p-0 shadow-2xl dark:bg-slate-900"
        >
          <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-6 py-7 text-white">
            <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/10" />
            <div className="absolute -bottom-16 -left-8 h-32 w-32 rounded-full bg-white/10" />
            <div className="relative flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 shadow-inner ring-1 ring-white/25 backdrop-blur-sm">
                <Sparkles className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">
                  Product update
                </p>
                <h2 className="text-xl font-bold leading-tight">
                  {adminNotification?.title || 'A new update is ready'}
                </h2>
              </div>
              {adminNotification?.version && (
                <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/20">
                  v{adminNotification.version.replace(/^v/i, '')}
                </span>
              )}
            </div>
          </div>

          <div className="px-6 py-6">
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              {adminNotification?.description ||
                'We have released new improvements. Refresh to start using the latest version.'}
            </p>

            <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 dark:border-blue-900/60 dark:bg-blue-950/30">
              <p className="text-xs font-medium leading-5 text-blue-800 dark:text-blue-300">
                Refresh the page to apply this update.
              </p>
            </div>

            <div className="mt-6 flex justify-end">
              <Button
                type="button"
                onClick={handleAdminNotificationRefresh}
                disabled={isRefreshingForUpdate}
                className="h-11 min-w-32 cursor-pointer rounded-xl bg-primary px-5 font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/95 disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isRefreshingForUpdate ? 'animate-spin' : ''}`}
                />
                {isRefreshingForUpdate ? 'Refreshing...' : 'Refresh now'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showRoleUpdateReloadModal && (
        <div className="fixed bottom-4 right-4 z-[99999] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3 sm:bottom-5 sm:right-5 animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="overflow-hidden rounded-2xl border border-blue-100/60 bg-white/95 backdrop-blur-md shadow-2xl ring-1 ring-black/5 dark:border-slate-800 dark:bg-slate-900/95">
            {/* Top gradient indicator */}
            <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-primary" />

            <div className="flex items-start gap-4 p-5">
              {/* Circular Icon Container */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400 shadow-sm">
                <ShieldAlert className="h-5.5 w-5.5" />
              </div>

              <div className="min-w-0 flex-1">
                {/* Header and message */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight leading-none mb-1.5">
                      Role Updated
                    </h4>
                    <p className="text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                      {roleUpdateMessage}
                    </p>
                  </div>

                  {/* Small X close button */}
                  <button
                    type="button"
                    onClick={() => setShowRoleUpdateReloadModal(false)}
                    className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label="Close notification"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Bottom action row */}
                <div className="mt-4 flex items-center justify-end gap-2.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowRoleUpdateReloadModal(false)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-100/50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/50 rounded-lg h-9 px-3.5 transition-colors cursor-pointer"
                  >
                    Dismiss
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => window.location.reload()}
                    className="bg-primary hover:bg-primary/95 text-white shadow-lg shadow-primary/20 text-xs font-bold rounded-lg h-9 px-4 transition-all hover:scale-[1.02] cursor-pointer"
                  >
                    Reload Now
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </SocketEvents.Provider>
  );
};

function mergeMessages(oldMsgs: any[], newMsgs: any[]) {
  const all = [
    ...(Array.isArray(oldMsgs) ? oldMsgs : []),
    ...(Array.isArray(newMsgs) ? newMsgs : []),
  ];
  const map = new Map<string, any>();

  for (const msg of all) {
    if (!msg?.messageId) continue;
    map.set(msg.messageId, msg);
  }

  const deduped = Array.from(map.values());
  deduped.sort((a, b) => {
    const ta = new Date(a?.createdAt || 0).getTime();
    const tb = new Date(b?.createdAt || 0).getTime();
    return ta - tb;
  });

  return deduped;
}
