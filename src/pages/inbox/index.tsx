import NumberWithFlag from '@/components/custom/number-with-flag';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageSidebarLayout from '@/layout/page-sidebar-layout';
import './inbox-theme.css';
import ListItem from './list-item';
import CustomSelect from '@/components/custom/custom-select';
import {
  getDLCStatus,
  getFaxAssignedDidNumbers,
  getSMSList,
  mediaUploadUrl,
  sendSms,
  userSMSInfo,
} from '@/services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParamManager } from '@/hooks/use-search-params';
import { AddCircle, EmojiICon, PlainLine, Refresh, SearchLine, Send } from '@/assets/icons';

import {
  CHAT_MAX_LENGTH,
  cn,
  formatChatDate,
  formatPhoneNumber,
  checkPhoneNumberCountry,
  getEnv,
  handleAlert,
  getSmsAlert,
  SESSION_NAME,
} from '@/lib/utils';
import moment from 'moment';
import Loader from '@/components/custom/loader';
import { useUser } from '@/hooks/use-user';
import { count } from 'sms-length';
import { useSmsRateCredits } from '@/hooks/use-sms-rate-credits';
import { useNameForNumber } from '@/hooks/use-contact-suggestions';
import EmojiPicker from 'emoji-picker-react';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';

polyfillCountryFlagEmojis();
import useClickOutside from '@/hooks/use-click-outside';
import CustomAvatar from '@/components/custom/custom-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import SendSMSModal from './send-sms-modal';
import SendFaxModal from './send-fax-modal';
import FaxContent from './fax-content';
import { useMessagingPermissions } from '@/hooks/use-messaging-permissions';
import {
  ArrowDown,
  ArrowLeft,
  CheckCheckIcon,
  CheckIcon,
  DownloadIcon,
  Expand,
  FileAudio2,
  FileText,
  FileVideo2,
  Loader2,
  MessageSquareOff,
  MessageSquareText,
  Paperclip,
  Pause,
  Play,
  Printer,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFetchContact } from '@/hooks/common';
import Flag from '@/components/flag';
import { useCompanyFeatures } from '@/hooks/rbac';
import DLCVerificationPopup from '@/components/custom/dlc-verification-popup';
import countryList from '@/lib/countries.json';
import AlertConfirm from '@/components/custom/alert-confirm';
import useDebounce from '@/hooks/use-debounce';
import { useMediaBlob } from '@/pages/messenger/chat/message-item/use-media-blob';
import { useAuthenticatedMediaUrl } from '@/hooks/use-authenticated-media';

const messageStatus = function (key: string = '') {
  const status = {
    Delivered: (
      <div className="mcm-bub-meta pos">
        <CheckCheckIcon width={12} height={12} />
        Delivered
      </div>
    ),

    Success: (
      <div className="mcm-bub-meta pos">
        <CheckCheckIcon width={12} height={12} />
        Sent
      </div>
    ),

    Pending: (
      <div className="mcm-bub-meta">
        <CheckIcon width={12} height={12} />
        Sending
      </div>
    ),
  };

  if (!key) return null;

  return (
    status[key as keyof typeof status] || (
      <div className="mcm-bub-meta neg">
        <TriangleAlert width={12} height={12} />
        {key}
      </div>
    )
  );
};

// Two messages from the same sender inside this window are drawn as one visual
// group: only the last one gets the pointed tail corner.
const MESSAGE_GROUP_WINDOW_MINUTES = 3;

const SOFT_BREAK_CHUNK_SIZE = 24;
const SMS_COUNT_LIMIT = 5;
const FAX_ASSIGNED_DID_PAYLOAD = { page: 1, limit: 200 };
const EMPTY_FAX_DID_NUMBERS: any[] = [];

const getFaxDidNumber = (item: any) =>
  String(item?.did_number || item?.phone_number || item?.number || '').trim();

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

const trimToSmsCountLimit = (value: string, maxMessages = SMS_COUNT_LIMIT) => {
  const normalizedValue = String(value || '');
  if (count(normalizedValue).messages <= maxMessages) return normalizedValue;

  let low = 0;
  let high = normalizedValue.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = normalizedValue.slice(0, mid);
    if (count(candidate).messages <= maxMessages) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
};

const extractFileNameFromUrl = (url: string) => {
  try {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) return '';
    const parsed = new URL(cleanUrl, window.location.origin);
    const pathname = parsed.pathname || '';
    const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(lastSegment);
  } catch {
    const fallback = String(url || '')
      .split('?')[0]
      .split('#')[0];
    const lastSegment = fallback.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(lastSegment);
  }
};

const getMMSFileName = (sms: any) => {
  const directName = sms?.filename || sms?.fileName || sms?.mediaName || sms?.media_name || '';
  if (directName) return directName;
  return extractFileNameFromUrl(sms?.mediaUrl || sms?.media_url || sms?.url || '');
};

const isAllowedMMSFile = (file: File | null) => {
  if (!file) return false;
  const mimeType = String(file.type || '').toLowerCase();
  if (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/')
  ) {
    return true;
  }
  const lowerName = String(file.name || '').toLowerCase();
  return [
    '.gif',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.bmp',
    '.svg',
    '.mp4',
    '.mov',
    '.webm',
    '.m4v',
    '.mkv',
    '.avi',
    '.mp3',
    '.wav',
    '.m4a',
    '.aac',
    '.ogg',
    '.flac',
  ].some((ext) => lowerName.endsWith(ext));
};

const getMMSMediaUrl = (sms: any, companyUuid: string) => {
  const rawUrl = sms?.mediaUrl || sms?.media_url || sms?.url || '';
  const base = getEnv()?.VITE_API_BASE_URL || '';
  if (typeof rawUrl === 'string' && /^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (typeof rawUrl === 'string' && rawUrl.startsWith('/') && base) return `${base}${rawUrl}`;
  if (typeof rawUrl === 'string' && rawUrl && !rawUrl.startsWith('/')) return rawUrl;

  const filename = getMMSFileName(sms);
  if (!filename || !companyUuid) return rawUrl || '';

  return `${base}/api/media/${companyUuid}/mms/${encodeURIComponent(filename)}`;
};

const resolveMMSMediaType = (sms: any) => {
  const directType =
    sms?.mimeType ||
    sms?.mediaMimeType ||
    sms?.media_type ||
    sms?.contentType ||
    sms?.mediaType ||
    '';
  const normalizedType = String(directType || '').toLowerCase();
  if (normalizedType.startsWith('image/')) return 'image';
  if (normalizedType.startsWith('video/')) return 'video';
  if (normalizedType.startsWith('audio/')) return 'audio';

  const urlFileName = extractFileNameFromUrl(sms?.mediaUrl || sms?.media_url || sms?.url || '');
  const filename = String(getMMSFileName(sms) || urlFileName || '').toLowerCase();
  const ext = filename.includes('.') ? filename.split('.').pop() || '' : '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';

  const rawUrl = String(sms?.mediaUrl || sms?.media_url || sms?.url || '').toLowerCase();
  if (rawUrl.includes('image%2f') || rawUrl.includes('image/')) return 'image';
  if (rawUrl.includes('video%2f') || rawUrl.includes('video/')) return 'video';
  if (rawUrl.includes('audio%2f') || rawUrl.includes('audio/')) return 'audio';

  return 'file';
};

const MMSAttachmentPreview = ({
  sms,
  companyUuid = '',
  isMine = false,
}: {
  sms: any;
  companyUuid?: string;
  isMine?: boolean;
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  const fallbackMediaUrl = getMMSMediaUrl(sms, companyUuid);
  const mediaType = resolveMMSMediaType(sms);
  const serverFileName = getMMSFileName(sms);
  const fileName = serverFileName || 'Attachment';
  const isAudio = mediaType === 'audio';
  const isImage = mediaType === 'image';
  const isVideo = mediaType === 'video';
  const { data: authenticatedFallbackMediaUrl } = useAuthenticatedMediaUrl(
    fallbackMediaUrl,
    Boolean(fallbackMediaUrl),
  );

  const { data: audioUrlServer, isLoading: isLoadingAudio } = useMediaBlob({
    serverFileName,
    company_uuid: companyUuid,
    type: 'mms',
    enabled: Boolean(isAudio && serverFileName && companyUuid),
  });
  const { data: imageUrlServer, isLoading: isLoadingImage } = useMediaBlob({
    serverFileName,
    company_uuid: companyUuid,
    type: 'mms',
    enabled: Boolean(isImage && serverFileName && companyUuid),
  });
  const { data: videoUrlServer, isLoading: isLoadingVideo } = useMediaBlob({
    serverFileName,
    company_uuid: companyUuid,
    type: 'mms',
    enabled: Boolean(isVideo && serverFileName && companyUuid),
  });

  const audioUrl = audioUrlServer || authenticatedFallbackMediaUrl;
  const imageUrl = imageUrlServer || authenticatedFallbackMediaUrl;
  const videoUrl = videoUrlServer || authenticatedFallbackMediaUrl;

  const resolvedMediaUrl = isAudio
    ? audioUrl
    : isImage
      ? imageUrl
      : isVideo
        ? videoUrl
        : authenticatedFallbackMediaUrl;

  if (!resolvedMediaUrl) return null;

  const openPreview = () => {
    window.open(resolvedMediaUrl, '_blank', 'noopener,noreferrer');
  };

  const downloadFile = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const accessToken = localStorage.getItem(SESSION_NAME) || '';
      const response = await fetch(resolvedMediaUrl, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(link.href);
      link.remove();
    } catch (error) {
      console.error('Failed to download MMS media:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl || isLoadingAudio) return;
    if (isPlaying) {
      audioRef.current.pause();
      return;
    }
    audioRef.current.play().catch(() => setIsPlaying(false));
  };

  const formatDuration = (seconds: number) => {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (mediaType === 'audio') {
    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
    return (
      <div
        className={cn(
          'border-b last:border-b-0 w-full flex flex-col gap-2 px-3 py-3',
          isMine ? 'border-white/20' : 'border-[var(--mcm-line)]',
        )}
      >
        <div className="flex items-center gap-2.5 w-full">
          <button
            type="button"
            onClick={togglePlay}
            disabled={isLoadingAudio || !audioUrl}
            className={cn(
              'min-w-9 max-h-9 max-w-9 min-h-9 rounded-full flex justify-center items-center transition-colors shrink-0 hover:opacity-90',
              isMine ? 'bg-white text-[var(--mcm-accent)]' : 'bg-[var(--mcm-accent)] text-white',
              isLoadingAudio || !audioUrl ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
            )}
          >
            {isLoadingAudio ? (
              <Loader2 className="animate-spin w-4 h-4" />
            ) : isPlaying ? (
              <Pause size={16} />
            ) : (
              <Play size={16} />
            )}
          </button>
          <audio
            ref={audioRef}
            src={audioUrl}
            onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
            onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
            onEnded={() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            preload="metadata"
          />
          <div className="flex flex-col flex-1 min-w-0">
            <div className="text-[12px] font-bold truncate min-w-40 max-w-40">{fileName}</div>
            <div
              className={cn('text-[10.5px]', isMine ? 'text-white/75' : 'text-[var(--mcm-ink-4)]')}
            >
              {isPlaying
                ? `${formatDuration(currentTime)} / ${formatDuration(duration)}`
                : formatDuration(duration)}
            </div>
          </div>
          <button
            type="button"
            className="cursor-pointer"
            onClick={downloadFile}
            title="Download"
            disabled={isDownloading}
          >
            {isDownloading ? (
              <Loader2
                className={cn(
                  'animate-spin size-4',
                  isMine ? 'text-white/85' : 'text-[var(--mcm-ink-4)]',
                )}
              />
            ) : (
              <DownloadIcon
                className={cn('size-4', isMine ? 'text-white/85' : 'text-[var(--mcm-ink-4)]')}
              />
            )}
          </button>
        </div>
        <div className="flex items-center gap-2 w-full">
          <div
            className="relative flex-1 h-1.5 rounded-full overflow-hidden"
            style={{ background: isMine ? 'rgba(255,255,255,0.60)' : '#e5e7eb' }}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all',
                isMine ? 'bg-white' : 'bg-primary',
              )}
              style={{ width: `${progressPercent}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                if (audioRef.current) {
                  audioRef.current.currentTime = value;
                  setCurrentTime(value);
                }
              }}
              disabled={!audioUrl || isLoadingAudio}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
            />
          </div>
        </div>
      </div>
    );
  }

  if (mediaType === 'image') {
    const isGif = fileName.toLowerCase().endsWith('.gif');
    return (
      <div
        className={cn(
          'border-b last:border-b-0 w-full flex flex-col gap-2 px-3 py-2',
          isMine ? 'border-white/20' : 'border-[var(--mcm-line)]',
        )}
      >
        <div className="w-64 max-w-full h-40 rounded-lg overflow-hidden flex items-center justify-center bg-black/5 relative">
          {isLoadingImage ? (
            <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
          ) : imageUrl ? (
            <img src={imageUrl} alt={fileName} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full bg-gray-100 text-gray-500 flex items-center justify-center rounded-lg text-xs">
              Unable to load image
            </div>
          )}
          <button
            type="button"
            className="absolute cursor-pointer bg-[var(--mcm-accent)] top-2 right-2 h-7 w-7 rounded-[8px] text-white flex items-center justify-center"
            onClick={openPreview}
            aria-label={isGif ? 'Open GIF in large view' : 'Open image in large view'}
          >
            <Expand size={14} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div
              className={cn(
                'text-[12px] font-bold truncate min-w-40 max-w-40',
                isMine ? 'text-white' : 'text-[var(--mcm-ink)]',
              )}
            >
              {fileName}
            </div>
            <div
              className={cn('text-[10.5px]', isMine ? 'text-white/75' : 'text-[var(--mcm-ink-4)]')}
            >
              {isGif ? 'GIF' : 'Image'}
            </div>
          </div>
          <button
            type="button"
            className="cursor-pointer"
            onClick={downloadFile}
            title="Download"
            disabled={isDownloading}
          >
            {isDownloading ? (
              <Loader2
                className={cn(
                  'animate-spin size-4',
                  isMine ? 'text-white/85' : 'text-[var(--mcm-ink-4)]',
                )}
              />
            ) : (
              <DownloadIcon
                className={cn('size-4', isMine ? 'text-white/85' : 'text-[var(--mcm-ink-4)]')}
              />
            )}
          </button>
        </div>
      </div>
    );
  }

  if (mediaType === 'video') {
    return (
      <div
        className={cn(
          'border-b last:border-b-0 w-full flex flex-col gap-2 px-3 py-2',
          isMine ? 'border-white/20' : 'border-[var(--mcm-line)]',
        )}
      >
        <div className="w-64 max-w-full h-40 rounded-lg overflow-hidden flex items-center justify-center bg-black/5 relative">
          {isLoadingVideo ? (
            <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
          ) : videoUrl ? (
            <video
              src={videoUrl}
              className="w-full h-full object-contain"
              controls
              controlsList="nofullscreen nodownload noremoteplayback"
              playsInline
              preload="metadata"
            />
          ) : (
            <div className="w-full h-full bg-gray-100 text-gray-500 flex items-center justify-center rounded-lg text-xs">
              Unable to load video
            </div>
          )}
          <button
            type="button"
            className="absolute cursor-pointer bg-[var(--mcm-accent)] top-2 right-2 h-7 w-7 rounded-[8px] text-white flex items-center justify-center"
            onClick={openPreview}
            aria-label="Open video in large view"
          >
            <Expand size={14} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex flex-col flex-1 min-w-0">
            <div
              className={cn(
                'text-[12px] font-bold truncate min-w-40 max-w-40',
                isMine ? 'text-white' : 'text-[var(--mcm-ink)]',
              )}
            >
              {fileName}
            </div>
            <div
              className={cn(
                'text-[10.5px] truncate',
                isMine ? 'text-white/75' : 'text-[var(--mcm-ink-4)]',
              )}
            >
              Video
            </div>
          </div>
          <button
            type="button"
            className="cursor-pointer"
            onClick={downloadFile}
            title="Download"
            disabled={isDownloading}
          >
            {isDownloading ? (
              <Loader2
                className={cn(
                  'animate-spin size-4',
                  isMine ? 'text-white/85' : 'text-[var(--mcm-ink-4)]',
                )}
              />
            ) : (
              <DownloadIcon
                className={cn('size-4', isMine ? 'text-white/85' : 'text-[var(--mcm-ink-4)]')}
              />
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'border-b last:border-b-0 w-full min-h-14 items-center flex gap-2 px-3 py-2',
        isMine ? 'border-white/20 text-white' : 'border-[var(--mcm-line)] text-[var(--mcm-ink)]',
      )}
    >
      <div
        className={cn(
          'min-w-9 max-h-9 max-w-9 min-h-9 rounded-[9px] flex justify-center items-center overflow-hidden',
          isMine ? 'bg-white/20 text-white' : 'bg-[var(--mcm-surface-3)] text-[var(--mcm-ink-3)]',
        )}
      >
        <FileText className="size-4" />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <div
          className={cn(
            'text-[12px] font-bold truncate min-w-40 max-w-40',
            isMine ? 'text-white' : 'text-[var(--mcm-ink)]',
          )}
        >
          {fileName}
        </div>
        <div
          className={cn(
            'text-[10.5px] truncate',
            isMine ? 'text-white/75' : 'text-[var(--mcm-ink-4)]',
          )}
        >
          Attachment
        </div>
      </div>
      <button
        type="button"
        className="cursor-pointer"
        onClick={downloadFile}
        title="Download"
        disabled={isDownloading}
      >
        {isDownloading ? (
          <Loader2
            className={cn(
              'animate-spin size-4',
              isMine ? 'text-white/85' : 'text-[var(--mcm-ink-4)]',
            )}
          />
        ) : (
          <DownloadIcon
            className={cn('size-4', isMine ? 'text-white/85' : 'text-[var(--mcm-ink-4)]')}
          />
        )}
      </button>
    </div>
  );
};

const InnerSidebarInbox = (props: any) => {
  const {
    setSelectedDID,
    selectedDID,
    selectedChat,
    setSelectedChat,
    getNameFromNumber,
    messagesAccess,
    setType,
    type,
    setSmsNumber,
    setShowSendSMSModal,
    faxDIDOptions = [],
    selectedFaxDID,
    setSelectedFaxDID,
    isFaxDIDLoading = false,
    isCompactLayout = false,
    headerAction = null,
    focusNumber = '',
    onFocusHandled,
    onOpenConversation,
  } = props;
  const [isDIDLoaded, setIsDIDLoaded] = useState(false);
  const { getParam, clearAllParams } = useSearchParamManager();
  const [search, setSearch] = useState<string>('');
  const debouncedSearch = useDebounce<string>(search, 300);
  const { user } = useUser();
  const did_number = getParam('did_number');
  const allDIDNumbers = useMemo(() => user?.assigned_did || [], [user?.assigned_did]);
  // const defaultTab = messagesAccess?.send_message
  //   ? 'messages'
  //   : messagesAccess?.send_mms
  //     ? 'messages'
  //     : 'fax';

  useEffect(() => {
    if (!allDIDNumbers?.length) {
      setIsDIDLoaded(true);
      return;
    }

    if (did_number) {
      const data = allDIDNumbers?.find(
        (item: any) => item?.did_number?.replace(/\+/g, '') === did_number?.replace(/\+/g, ''),
      );

      if (data) {
        setSelectedDID({
          label: data?.did_number,
          value: data?.did_number,
          icon: (
            <div className="w-5">
              <Flag phoneNumber={formatPhoneNumber(data?.did_number)} />
            </div>
          ),
        });
      }
    }
    setIsDIDLoaded(true);
  }, [allDIDNumbers?.length, did_number]);

  useEffect(() => {
    if (did_number === undefined || (did_number === null && allDIDNumbers?.length)) {
      const defaultDID = allDIDNumbers?.[0];
      setSelectedDID({
        label: defaultDID?.did_number,
        value: defaultDID?.did_number,
        icon: (
          <div className="w-5">
            <Flag phoneNumber={formatPhoneNumber(defaultDID?.did_number)} />
          </div>
        ),
      });
    }
  }, [allDIDNumbers]);

  return (
    <Tabs
      value={type}
      onValueChange={(e) => {
        setSelectedChat({});
        setType(e);
      }}
      className="mcm-col h-full w-full min-h-0 gap-0"
    >
      <div className="mcm-col-head">
        <div className="mcm-col-title">
          <h2>Inbox</h2>
          {headerAction}
        </div>
        <TabsList className="mcm-seg" style={{ width: '100%' }}>
          {messagesAccess?.send_message || messagesAccess?.send_mms ? (
            <TabsTrigger value="messages">
              <MessageSquareText className="size-3.5" />
              SMS / MMS
            </TabsTrigger>
          ) : null}
          {messagesAccess?.send_fax && (
            <TabsTrigger value="fax">
              <Printer className="size-3.5" />
              Fax
            </TabsTrigger>
          )}
        </TabsList>

        <div className="flex flex-col gap-1">
          <span className="mcm-eyebrow">{type === 'fax' ? 'Fax number' : 'Your number'}</span>
          <div className="mcm-did">
            <CustomSelect
              options={
                type === 'fax'
                  ? faxDIDOptions
                  : allDIDNumbers && allDIDNumbers?.length > 0
                    ? allDIDNumbers.map((number: any) => ({
                        label: number?.did_number,
                        value: number?.did_number,
                        icon: (
                          <div className="w-5">
                            <Flag phoneNumber={formatPhoneNumber(number?.did_number)} />
                          </div>
                        ),
                      }))
                    : []
              }
              handleChange={(val) => {
                if (type === 'fax') {
                  setSelectedFaxDID(val);
                  setSelectedChat({});
                  clearAllParams();
                  return;
                }
                setSelectedDID(val);
                clearAllParams();
              }}
              value={type === 'fax' ? selectedFaxDID : selectedDID}
            />
          </div>
        </div>

        <div className="mcm-search">
          <span className="mcm-search-ic">
            <SearchLine className="h-3.5 w-3.5" />
          </span>
          <input
            placeholder="Search by name or number"
            maxLength={50}
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith(' ')) return;
              setSearch(value);
            }}
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              className="mcm-search-clear"
              onClick={() => setSearch('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <TabsContent value="messages" className="mt-0 flex flex-1 min-h-0 flex-col overflow-hidden">
        {isDIDLoaded ? (
          <ListItem
            selectedDID={selectedDID}
            setSelectedChat={setSelectedChat}
            selectedChat={selectedChat}
            focusNumber={focusNumber}
            onFocusHandled={onFocusHandled}
            tabType="messages"
            getNameFromNumber={getNameFromNumber}
            search={debouncedSearch}
            setSmsNumber={setSmsNumber}
            setShowSendSMSModal={setShowSendSMSModal}
            onOpenConversation={onOpenConversation}
            isCompactLayout={isCompactLayout}
          />
        ) : (
          <div className="flex justify-center items-center h-full">
            <Loader variant="blue" />
          </div>
        )}
      </TabsContent>
      <TabsContent value="fax" className="mt-0 flex flex-1 min-h-0 flex-col overflow-hidden">
        {isFaxDIDLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader variant="blue" />
          </div>
        ) : (
          <ListItem
            selectedDID={selectedFaxDID}
            setSelectedChat={setSelectedChat}
            selectedChat={selectedChat}
            tabType="fax"
            getNameFromNumber={getNameFromNumber}
            search={debouncedSearch}
            onOpenConversation={onOpenConversation}
            isCompactLayout={isCompactLayout}
          />
        )}
      </TabsContent>
    </Tabs>
  );
};

const InboxContent = ({
  selectedDID = {},
  selectedChat,
  getNameFromNumber,
  type,
  onBackToList,
  isCompactLayout = false,
}: {
  selectedDID: any;
  selectedChat: any;
  getNameFromNumber?: any;
  type?: string;
  onBackToList?: () => void;
  isCompactLayout?: boolean;
}) => {
  const { getAllParams } = useSearchParamManager();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [smsListData, setSmsListData] = useState([]);
  const [message, setMessage] = useState('');
  const [mmsFile, setMmsFile] = useState<File | null>(null);
  const [mmsPreviewUrl, setMmsPreviewUrl] = useState<string>('');
  const [emojiOpen, setEmojiOpen] = useState<boolean>(false);
  const [countryCode, seCountryCode] = useState('');
  const params = getAllParams();
  // Keyed per message: expanding one long message must not expand every other
  // long message in the thread.
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const { user } = useUser();
  const companyUuid = user?.company_info?.uuid || user?.company_uuid || '';
  const queryClient = useQueryClient();
  const emojiContainerRef = useRef(null);
  const mmsFileInputRef = useRef<HTMLInputElement | null>(null);
  // text area auto height
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useClickOutside({ current: [emojiContainerRef.current] }, () => setEmojiOpen(false));
  const [showDLCPopup, setShowDLCPopup] = useState(false);
  const [sendMsgAlert, setSendMsgAlert] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);

  const {
    data: smsList,
    refetch,
    isRefetching,
    isFetching,
  } = useQuery({
    queryKey: ['getSMSList', { chat_id: params?.chatId }],
    queryFn: () => getSMSList({ chat_id: params?.chatId, limit: 100 }),
    select: (data) => data?.data?.data?.result?.rows || [],
    enabled: !!(params?.chatId && selectedDID),
  });

  /* Company messaging rules, read alongside the registration status they work
     with. */
  const { canSendTo } = useMessagingPermissions();

  const { data: dlcStatus } = useQuery({
    queryKey: ['getDLCStatus'],
    queryFn: () => getDLCStatus(),
    select: (data) => data?.data?.data?.result,
  });
  const otherNumber =
    selectedDID?.value?.replace('+', '') === selectedChat?.from?.replace('+', '')
      ? selectedChat?.to
      : selectedChat?.from;
  const isConversationReady = Boolean(selectedChat?._id);

  const smsCountData = count(message);
  const isMMSMode = !!mmsFile;

  useEffect(() => {
    if (otherNumber && otherNumber?.length > 0 && countryList && countryList?.length > 0) {
      const { countryCode = 'US' } = checkPhoneNumberCountry(otherNumber);
      seCountryCode(countryCode);
    }
  }, [otherNumber]);

  const { data: smsInfoData = [] } = useQuery({
    queryKey: ['userSMSInfo', otherNumber],
    queryFn: () =>
      userSMSInfo({
        filter: {
          key: 'DIALPREFIX',
          value: otherNumber?.trim().replace(/\s+/g, ''),
        },
      }),
    select: (data) => data?.data?.data?.result || {},
    enabled: !!otherNumber && otherNumber?.length > 8,
  });

  const { allow_country = [], sms_rates = [], sms: freeSms = 0, sms_used = 0 } = smsInfoData || {};
  const isSmsFree =
    allow_country?.some(({ country_code_iso2 }: any) => country_code_iso2 === countryCode) &&
    freeSms > sms_used;
  const freeSmsLeft = isSmsFree ? freeSms - sms_used : 0;
  const balanceAmount = Number(user?.company_info?.amount || 0);
  const chargeableSmsCount = Math.max(smsCountData.messages - freeSmsLeft, 0);

  const smsRate = Number(sms_rates?.rate || 0);
  const chargeableAmount = chargeableSmsCount * smsRate;
  const { credits: smsCredits } = useSmsRateCredits({
    segment: smsCountData.messages,
    phone: otherNumber,
    alpha2code: countryCode,
  });

  /* `sms_rates` is destructured with a default of `[]`, so `sms_rates.rate` is
     undefined whenever the response omits it — the old rate-card sum was then
     0, which the balance dialog read as "you cannot afford this" and refused a
     fully funded wallet. The applied cost from the rate service is the same
     figure shown on screen as "SMS Charges", so the dialog and the price now
     agree; the rate card is only the fallback. */
  const totalSmsCharges =
    smsCredits > 0 ? smsCredits : Number(sms_rates?.rate || 0) * smsCountData.messages;

  const { mutateAsync: sendSMSMutate, isPending: sendSMSLoad } = useMutation({
    mutationKey: ['sendSmsNew'],
    mutationFn: sendSms,
    onSuccess: () => {
      setMessage('');
      setMmsFile(null);
      if (mmsFileInputRef.current) {
        mmsFileInputRef.current.value = '';
      }
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.overflowY = 'hidden';
      }
      queryClient.invalidateQueries({ queryKey: ['getSMSList'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['smsListViaDID'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['userSMSInfo'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['getUsersDetails'], exact: false });
      handleAlert({
        type: 'success',
        text: isMMSMode ? (
          'MMS sent successfully'
        ) : (
          <>
            Remaining SMS: {Math.max(0, freeSms - (sms_used + (smsCountData?.messages || 0)))}
            <br />
            SMS Charges: ${chargeableAmount.toFixed(2)}
          </>
        ),
      });
      setSendMsgAlert(false);
    },
    onError: ({ response }: any) => {
      setSendMsgAlert(false);
      handleAlert({
        type: 'error',
        text: response?.data?.error?.message || 'Something went wrong',
      });
    },
  });

  useEffect(() => {
    if (!smsList?.length) return;
    const groupedMessages = smsList.reduce((groups: any, message: any) => {
      const date = new Date(message?.createdAt).toLocaleDateString();
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(message);
      return groups;
    }, {});

    const sortedGroups =
      groupedMessages &&
      Object.keys(groupedMessages)
        ?.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
        ?.map((date) => {
          return groupedMessages[date];
        });

    setSmsListData(sortedGroups);
  }, [smsList]);

  const scrollToBottom = () => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  const toggleMessageExpanded = (messageKey: string) =>
    setExpandedMessages((prev) => ({ ...prev, [messageKey]: !prev[messageKey] }));

  // Only offer the jump-to-latest affordance once the reader has actually
  // scrolled away from the newest message.
  const handleThreadScroll = () => {
    const element = scrollAreaRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 240);
  };

  useEffect(() => {
    setTimeout(() => {
      scrollToBottom();
    }, 100);
  }, [smsList]);

  const uploadMMSAttachment = async (file: File) => {
    const companyUuid = user?.company_info?.uuid || user?.company_uuid;
    if (!companyUuid) throw new Error('Company uuid not found');

    const uploadRes = await mediaUploadUrl({
      uuid: companyUuid,
      type: 'mms',
      file_name: file?.name,
    });

    const mediaUrl = uploadRes?.data?.data?.result?.url;
    const filename = uploadRes?.data?.data?.result?.file_name;
    if (!mediaUrl || !filename) {
      throw new Error('Failed to generate media upload url');
    }

    const uploadFileResponse = await fetch(mediaUrl, {
      method: 'PUT',
      body: file,
    });
    if (!uploadFileResponse.ok) {
      throw new Error('Failed to upload media file');
    }

    return { mediaUrl, filename };
  };

  async function handleSendSMS() {
    const otherNumber =
      selectedDID?.value?.replaceAll('+', '') === selectedChat?.from?.replaceAll('+', '')
        ? selectedChat?.to
        : selectedChat?.from;
    const senderNumber =
      selectedDID?.value?.replaceAll('+', '') !== selectedChat?.from?.replaceAll('+', '')
        ? selectedChat?.to
        : selectedChat?.from;

    if (sendSMSLoad || isSending) return;

    // Check if the receiver number is USA or international
    const receiverNumber = otherNumber?.startsWith('+') ? otherNumber : `+${otherNumber}`;
    const { isUSA } = checkPhoneNumberCountry(receiverNumber);

    // Check if DLC verification is required for US numbers
    if (isUSA && dlcStatus?.verified === false) {
      setShowDLCPopup(true);
      return;
    }

    /* The company's messaging rules. Runs after the registration check above so
       a number blocked there is refused once, with one explanation, rather than
       twice with two. A guard rail, not a lock: the send endpoint accepts the
       request regardless, so this tells someone before they send rather than
       making it impossible. */
    const messagingCheck = canSendTo(receiverNumber, { dlcVerified: dlcStatus?.verified });
    if (!messagingCheck.allowed) {
      handleAlert({ type: 'error', text: messagingCheck.message || 'Texting is switched off.' });
      return;
    }
    if (messagingCheck.warning) {
      handleAlert({ type: 'warning', text: messagingCheck.warning });
    }

    const payload: any = {
      isMMS: isMMSMode,
      from: senderNumber?.startsWith('+') ? senderNumber : `+${senderNumber}`,
      to: receiverNumber?.trim().replace(/\s+/g, ''),
      text: message,
    };
    if (!isMMSMode && !String(message || '').trim()) {
      handleAlert({ type: 'error', text: 'Message is required' });
      return;
    }
    setIsSending(true);
    try {
      if (isMMSMode && mmsFile) {
        const uploaded = await uploadMMSAttachment(mmsFile);
        payload.mediaUrl = uploaded.mediaUrl;
        payload.filename = uploaded.filename;
      }

      await sendSMSMutate(payload);
      scrollToBottom();
    } catch (error: any) {
      if (!error?.response) {
        handleAlert({
          type: 'error',
          text: error?.message || 'Failed to upload MMS attachment',
        });
      }
    } finally {
      setIsSending(false);
    }
  }
  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({
      queryKey: ['getSmsNumbersList'],
      exact: false,
    });
  };

  const name = selectedChat?.name
    ? selectedChat?.name
    : selectedChat?.toContactName
      ? selectedChat?.toContactName
      : getNameFromNumber(otherNumber?.replaceAll(' ', ''))?.includes('+')
        ? 'Unknown contact'
        : getNameFromNumber(otherNumber?.replaceAll(' ', ''));

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    setMmsFile(null);
    if (mmsFileInputRef.current) {
      mmsFileInputRef.current.value = '';
    }
  }, [type, params?.chatId]);

  useEffect(() => {
    if (!mmsFile) {
      setMmsPreviewUrl('');
      return;
    }
    if (!String(mmsFile?.type || '').startsWith('image/')) {
      setMmsPreviewUrl('');
      return;
    }

    const objectUrl = URL.createObjectURL(mmsFile);
    setMmsPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [mmsFile]);

  const adjustTextareaHeight = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    // Reset height to measure scrollHeight correctly
    textarea.style.height = 'auto';
    const maxHeight = 160; // Tailwind's max-h-40 (40 * 4)
    const newHeight = textarea.scrollHeight;
    if (newHeight > maxHeight) {
      textarea.style.height = `${maxHeight}px`;
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.height = `${newHeight}px`;
      textarea.style.overflowY = 'hidden';
    }
    // Fix scroll jump issue
    requestAnimationFrame(() => {
      textarea.scrollTop = textarea.scrollHeight;
    });
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    adjustTextareaHeight(e.currentTarget);
  };
  return (
    <>
      {params?.chatId ? (
        <div className="mcm-col mcm-col-stage h-full w-full">
          {/* ── thread header ─────────────────────────────────────── */}
          <div className="mcm-thread-head">
            {onBackToList ? (
              <button
                type="button"
                className={cn('mcm-iconbtn', isCompactLayout ? 'xl:hidden' : 'hidden')}
                onClick={onBackToList}
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-[18px] w-[18px]" />
              </button>
            ) : null}

            {isConversationReady ? (
              <>
                <span className="shrink-0">
                  <CustomAvatar
                    name={name}
                    image={selectedChat?.contactPic}
                    type="contact"
                    size="38"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mcm-thread-name">{name}</div>
                  <div className="mcm-thread-num">
                    <NumberWithFlag number={otherNumber} className="mcm-num truncate" />
                    <span className="mcm-tag neu hidden sm:inline-flex">
                      {type === 'fax' ? 'FAX' : 'SMS / MMS'}
                    </span>
                  </div>
                </div>
                <span className="mcm-chip hidden lg:inline-flex">
                  <span className="mcm-eyebrow">From</span>
                  <span className="mcm-num max-w-40 truncate">{selectedDID?.value || 'NA'}</span>
                </span>
                <button
                  type="button"
                  onClick={handleRefresh}
                  title="Refresh conversation"
                  aria-label="Refresh conversation"
                  className="mcm-iconbtn"
                >
                  {isRefetching || isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Refresh className="h-[18px] w-[18px]" />
                  )}
                </button>
              </>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="mcm-skel h-[38px] w-[38px] rounded-full" />
                <div className="flex flex-col gap-1.5">
                  <div className="mcm-skel h-3 w-32" />
                  <div className="mcm-skel h-2.5 w-24" />
                </div>
              </div>
            )}
          </div>

          {!isConversationReady ? (
            <div className="mcm-thread justify-end gap-3">
              {[0, 1, 2, 3].map((row) => (
                <div
                  key={row}
                  className={cn('flex w-full', row % 2 ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className="mcm-skel h-12"
                    style={{ width: `${34 + row * 9}%`, borderRadius: '13px' }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* ── message thread ──────────────────────────────────── */}
              <div className="relative min-h-0 flex-1">
                <div
                  ref={scrollAreaRef}
                  onScroll={handleThreadScroll}
                  className="mcm-thread mcm-scroll h-full"
                >
                  {smsListData && smsListData?.length > 0 ? (
                    smsListData?.map((item: any, idx) => {
                      return (
                        <div key={idx} className="flex flex-col">
                          <div className="my-3 flex justify-center">
                            <span className="mcm-daychip">
                              {formatChatDate(item?.[0]?.createdAt)}
                            </span>
                          </div>
                          {item?.map((sms: any, index: any) => {
                            const isOutbound = user?.uuid === sms?.senderId;
                            const messageDate = moment(sms?.createdAt)?.format('HH:mm');
                            const message = sms?.message || '';
                            const isLong = message.length > CHAT_MAX_LENGTH;
                            const messageKey = String(sms?._id || `${idx}-${index}`);
                            const isExpanded = Boolean(expandedMessages[messageKey]);
                            const visibleOutboundText = isExpanded
                              ? message
                              : message.slice(0, CHAT_MAX_LENGTH) + (isLong ? '...' : '');
                            const visibleMessageText =
                              insertSoftBreaksIntoLongWords(visibleOutboundText);
                            const isMMSMessage =
                              String(sms?.messageMimeType || '').toLowerCase() === 'mms';
                            const mmsMediaUrl = isMMSMessage
                              ? getMMSMediaUrl(sms, companyUuid)
                              : '';
                            const status = sms?.dlrStatus || '';
                            const hasText = Boolean(String(visibleOutboundText || '').trim());

                            // Consecutive messages from the same side within a
                            // short window read as one group: only the last one
                            // gets the pointed tail corner.
                            const nextSms = item?.[index + 1];
                            const isGroupEnd = !(
                              nextSms &&
                              (user?.uuid === nextSms?.senderId) === isOutbound &&
                              Math.abs(
                                moment(sms?.createdAt).diff(moment(nextSms?.createdAt), 'minutes'),
                              ) < MESSAGE_GROUP_WINDOW_MINUTES
                            );

                            return (
                              <div
                                key={`${sms?.date}-${index}`}
                                className={cn(
                                  'flex w-full flex-col',
                                  isGroupEnd ? 'mb-2.5' : 'mb-1',
                                  isOutbound ? 'items-end' : 'items-start',
                                )}
                              >
                                <div
                                  className={cn(
                                    'mcm-bub',
                                    isOutbound ? 'mcm-bub-out' : 'mcm-bub-in',
                                    isGroupEnd && 'is-tail',
                                  )}
                                >
                                  {hasText ? (
                                    <p className="whitespace-pre-wrap">{visibleMessageText}</p>
                                  ) : null}
                                  {isMMSMessage && mmsMediaUrl ? (
                                    <div
                                      className="w-full overflow-hidden rounded-[9px]"
                                      style={{
                                        background: isOutbound
                                          ? 'rgba(255,255,255,0.14)'
                                          : 'var(--mcm-surface-2)',
                                      }}
                                    >
                                      <MMSAttachmentPreview
                                        sms={sms}
                                        companyUuid={companyUuid}
                                        isMine={isOutbound}
                                      />
                                    </div>
                                  ) : null}
                                  {isLong ? (
                                    <button
                                      type="button"
                                      className="mcm-showmore"
                                      onClick={() => toggleMessageExpanded(messageKey)}
                                    >
                                      {isExpanded ? 'Show less' : 'Show more'}
                                    </button>
                                  ) : null}
                                </div>
                                <div
                                  className={cn(
                                    'mt-1 flex items-center gap-2 px-1',
                                    isOutbound ? 'flex-row-reverse' : 'flex-row',
                                  )}
                                >
                                  <span
                                    className="mcm-num text-[10px]"
                                    style={{ color: 'var(--mcm-ink-4)' }}
                                  >
                                    {messageDate}
                                  </span>
                                  {isOutbound && status ? messageStatus(status) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  ) : (
                    <div className="mcm-empty">
                      <MessageSquareOff className="mcm-empty-ic" />
                      <div className="mcm-empty-title">No messages yet</div>
                      <p>Send the first message below to start this conversation.</p>
                    </div>
                  )}
                  <div ref={containerRef} />
                </div>
                {showScrollToBottom ? (
                  <button
                    type="button"
                    onClick={scrollToBottom}
                    aria-label="Jump to latest message"
                    className="mcm-jump"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                    Latest
                  </button>
                ) : null}
              </div>

              {/* ── composer ────────────────────────────────────────── */}
              <div className="mcm-composer">
                {mmsFile && type !== 'fax' ? (
                  <div className="mcm-attach">
                    <div className="mcm-attach-thumb">
                      {mmsPreviewUrl ? (
                        <img src={mmsPreviewUrl} alt={mmsFile?.name || 'attachment'} />
                      ) : String(mmsFile?.type || '').startsWith('video/') ? (
                        <FileVideo2 className="h-5 w-5" />
                      ) : String(mmsFile?.type || '').startsWith('audio/') ? (
                        <FileAudio2 className="h-5 w-5" />
                      ) : (
                        <FileText className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="mcm-attach-name">{mmsFile?.name || 'Attachment'}</div>
                      <div className="mcm-attach-sub">
                        Sending as MMS
                        {mmsFile?.size ? ` · ${(mmsFile.size / 1024 / 1024).toFixed(2)} MB` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Remove attachment"
                      className="mcm-iconbtn"
                      style={{ width: 26, height: 26 }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMmsFile(null);
                        if (mmsFileInputRef.current) {
                          mmsFileInputRef.current.value = '';
                        }
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}

                <div className={cn('mcm-composer-shell', (sendSMSLoad || isSending) && 'is-busy')}>
                  <textarea
                    placeholder="Write a message…"
                    rows={1}
                    value={message}
                    ref={textareaRef}
                    onInput={handleInput}
                    onChange={(e) => {
                      const value = e.target.value.replace(/^\s+/, '');
                      const limitedValue = trimToSmsCountLimit(value);
                      setMessage(limitedValue);
                    }}
                    disabled={sendSMSLoad || isSending}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.shiftKey) {
                        e.preventDefault();
                        setMessage((prevMessage) => {
                          return trimToSmsCountLimit(`${prevMessage}\n`);
                        });
                        return;
                      }
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!isMMSMode && smsCountData.messages > freeSmsLeft) {
                          setSendMsgAlert(true);
                        } else {
                          handleSendSMS();
                        }
                      }
                    }}
                  />

                  <div className="mcm-composer-bar">
                    {type !== 'fax' ? (
                      <>
                        <input
                          ref={mmsFileInputRef}
                          type="file"
                          accept="image/*,audio/*,video/*"
                          className="hidden"
                          onClick={(e) => {
                            (e.target as HTMLInputElement).value = '';
                          }}
                          onChange={(e) => {
                            const selectedFile = e.target.files?.[0] || null;
                            if (selectedFile && !isAllowedMMSFile(selectedFile)) {
                              handleAlert({
                                type: 'error',
                                text: 'Only image, audio, or video files are allowed',
                              });
                              setMmsFile(null);
                              (e.target as HTMLInputElement).value = '';
                              return;
                            }
                            setMmsFile(selectedFile);
                          }}
                        />
                        <button
                          type="button"
                          title="Attach image, audio or video"
                          aria-label="Attach image, audio or video"
                          className="mcm-iconbtn"
                          onClick={() => mmsFileInputRef.current?.click()}
                        >
                          <Paperclip className="h-[17px] w-[17px]" />
                        </button>
                      </>
                    ) : null}

                    <div className="relative flex items-center">
                      <div
                        className="emoji-container absolute bottom-[2.75rem] left-0 z-20 max-w-[calc(100vw-2rem)]"
                        ref={emojiContainerRef}
                      >
                        <EmojiPicker
                          className="border-gray-200"
                          lazyLoadEmojis
                          open={emojiOpen}
                          onEmojiClick={(data) => {
                            setMessage((prev) =>
                              trimToSmsCountLimit(`${prev}${data?.emoji || ''}`),
                            );
                            setEmojiOpen(false);
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        title="Insert emoji"
                        aria-label="Insert emoji"
                        className={cn('mcm-iconbtn', emojiOpen && 'is-on')}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEmojiOpen((prev: boolean) => !prev);
                        }}
                      >
                        <EmojiICon className="h-[17px] w-[17px]" />
                      </button>
                    </div>

                    <div className="ml-auto flex items-center gap-2.5">
                      {!isMMSMode ? (
                        <span
                          className="mcm-num hidden text-[10.5px] sm:inline"
                          style={{
                            color:
                              smsCountData.messages >= SMS_COUNT_LIMIT
                                ? 'var(--mcm-warn)'
                                : 'var(--mcm-ink-4)',
                            fontWeight: smsCountData.messages >= SMS_COUNT_LIMIT ? 700 : 400,
                          }}
                          title={`${smsCountData.length} characters · ${smsCountData.characterPerMessage} characters per SMS`}
                        >
                          {smsCountData.length} · {smsCountData.messages}/{SMS_COUNT_LIMIT}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        aria-label="Send message"
                        title="Send message"
                        className="mcm-sendbtn"
                        disabled={
                          sendSMSLoad || isSending || (!isMMSMode && !String(message || '').trim())
                        }
                        onClick={() => {
                          if (sendSMSLoad || isSending) return;
                          if (!isMMSMode && smsCountData.messages > freeSmsLeft) {
                            setSendMsgAlert(true);
                          } else {
                            handleSendSMS();
                          }
                        }}
                      >
                        {sendSMSLoad || isSending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-[17px] w-[17px]" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {!isMMSMode ? (
                  <div className="mcm-composer-foot">
                    <span className="mcm-num sm:hidden">
                      {smsCountData.length} chars · {smsCountData.messages}/{SMS_COUNT_LIMIT} SMS
                    </span>
                    <span className="hidden sm:inline">
                      Enter to send · Shift + Enter for a new line
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {freeSmsLeft > 0 ? (
                        <span className="mcm-tag pos">
                          <span className="mcm-num">{freeSmsLeft}</span> free left
                        </span>
                      ) : null}
                      <span>
                        Est. charge{' '}
                        <span
                          className="mcm-num"
                          style={{ color: 'var(--mcm-ink-2)', fontWeight: 700 }}
                        >
                          ${smsCredits.toFixed(2)}
                        </span>
                      </span>
                    </span>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="mcm-col mcm-col-stage h-full w-full">
          <div className="mcm-empty">
            <MessageSquareOff className="mcm-empty-ic" />
            <div className="mcm-empty-title">
              {type === 'fax' ? 'No fax selected' : 'No conversation selected'}
            </div>
            <p>
              {type === 'fax'
                ? 'Pick a fax from the list, or send a new one to see it appear here.'
                : 'Pick a conversation from the list, or start a new message to begin texting.'}
            </p>
          </div>
        </div>
      )}
      <DLCVerificationPopup open={showDLCPopup} setOpen={setShowDLCPopup} />
      {!isMMSMode && sendMsgAlert && (
        <AlertConfirm
          open={sendMsgAlert}
          setOpen={setSendMsgAlert}
          onConfirm={handleSendSMS}
          descriptionTextComp={getSmsAlert({
            freeSmsLeft,
            smsCount: smsCountData.messages,
            balanceAmount,
            totalSmsCharges,
          })}
          apiLoading={sendSMSLoad || isSending}
          showButton={!(balanceAmount <= 0)}
          headerText={balanceAmount <= 0 ? 'Alert' : 'Confirm'}
        />
      )}
    </>
  );
};

const Inbox = () => {
  const { clearAllParams, getAllParams, removeParam, setParam } = useSearchParamManager();
  const [showSendSMSModal, setShowSendSMSModal] = useState(false);
  const [showSendFaxModal, setShowSendFaxModal] = useState(false);
  const [selectedDID, setSelectedDID] = useState({});
  const [selectedFaxDID, setSelectedFaxDID] = useState<any>({});
  const [selectedChat, setSelectedChat] = useState({});
  const [smsNumber, setSmsNumber] = useState('');
  const [faxNumber, setFaxNumber] = useState('');
  const [isFaxFromDisabled, setIsFaxFromDisabled] = useState(false);

  // An SMS push notification navigates here with the message in router state
  // (socket-events-context, 'inbound-sms'). Nothing consumed it before, so the
  // notification landed on whatever thread happened to be open.
  const location = useLocation();
  const navigate = useNavigate();
  const [focusNumber, setFocusNumber] = useState('');

  const [isCompactLayout, setIsCompactLayout] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1280 : false,
  );
  const { formState, number, chatId, faxMessageId } = getAllParams();
  const { data: dataFetchContact } = useFetchContact();
  const { features } = useCompanyFeatures();
  const messagesAccess = features?.plan_features?.messages?.action || {};
  const canUseMessages = Boolean(messagesAccess?.send_message || messagesAccess?.send_mms);
  const canUseFax = Boolean(messagesAccess?.send_fax);
  const [type, setType] = useState<string>('messages');
  /* The composer used to be a drawer floating over everything. Now it takes the
     conversation area, so on a compact layout — where that section is hidden
     unless something is open — "composing" has to count as active, or the form
     is simply unreachable on a phone. */
  const isComposing = showSendSMSModal || showSendFaxModal;
  const hasActiveConversation =
    isComposing || (type === 'fax' ? Boolean(faxMessageId) : Boolean(chatId));
  const { data: faxAssignedNumbers = EMPTY_FAX_DID_NUMBERS, isLoading: isFaxDIDLoading } = useQuery(
    {
      queryKey: ['faxAssignedDidNumbers', FAX_ASSIGNED_DID_PAYLOAD],
      queryFn: () => getFaxAssignedDidNumbers(FAX_ASSIGNED_DID_PAYLOAD),
      select: (response) => {
        const result = response?.data?.data?.result;
        if (Array.isArray(result)) return result;
        if (Array.isArray(result?.rows)) return result.rows;
        if (Array.isArray(result?.data)) return result.data;
        return EMPTY_FAX_DID_NUMBERS;
      },
      enabled: Boolean(messagesAccess?.send_fax),
    },
  );
  const faxDIDOptions = useMemo(() => {
    const seenNumbers = new Set<string>();

    return faxAssignedNumbers.reduce((options: any[], item: any) => {
      const number = getFaxDidNumber(item);
      const normalizedNumber = number.replace(/\+/g, '');
      if (!number || seenNumbers.has(normalizedNumber)) return options;
      seenNumbers.add(normalizedNumber);

      options.push({
        label: number,
        value: number,
        icon: (
          <div className="w-5">
            <Flag phoneNumber={formatPhoneNumber(number)} />
          </div>
        ),
      });
      return options;
    }, []);
  }, [faxAssignedNumbers]);

  useEffect(() => {
    if (isFaxDIDLoading) return;

    setSelectedFaxDID((current: any) => {
      if (!faxDIDOptions.length) return current?.value ? {} : current;
      const currentNumber = String(current?.value || '').replace(/\+/g, '');
      return (
        faxDIDOptions.find((option: any) => option.value.replace(/\+/g, '') === currentNumber) ||
        faxDIDOptions[0]
      );
    });
  }, [faxDIDOptions, isFaxDIDLoading]);
  const openSendModal = () => {
    setShowSendFaxModal(false);
    setShowSendSMSModal(true);
  };

  const closeComposers = () => {
    setShowSendSMSModal(false);
    setShowSendFaxModal(false);
  };

  /* A drawer sat over everything, so it never had to decide what happens when
     you click a conversation underneath. In place, it does: opening one closes
     the composer. Keying off a chatId change is not enough — the list
     auto-selects a conversation, so clicking the already-selected row changes
     nothing and the composer would stay sitting on top of it. */
  const handleOpenConversation = () => {
    closeComposers();
  };
  /* The map is keyed by the number as the contact stored it, plus a digits-only
     and a "+digits" variant. A number that reaches here punctuated or with a
     different country prefix matched none of those, so conversation headers
     showed a raw number where a saved contact name belongs. The last-10-digit
     lookup is the fallback for exactly that case.

     A contact row with no name used to return a single space, which renders as
     an empty header — fall back to the number instead. */
  const nameForNumber = useNameForNumber();
  const getNameFromNumber = (number: string = '') => {
    const contact = dataFetchContact?.[number] || null;
    const saved = contact
      ? `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim()
      : nameForNumber(number);
    return saved || number;
  };

  // Keep the selected tab when it is allowed and only fall back when access changes.
  useEffect(() => {
    setType((currentType) => {
      const canUseCurrentTab =
        (currentType === 'messages' && canUseMessages) || (currentType === 'fax' && canUseFax);

      if (canUseCurrentTab) return currentType;
      if (canUseMessages) return 'messages';
      if (canUseFax) return 'fax';
      return 'messages';
    });
  }, [canUseFax, canUseMessages]);

  /* Keep SMS and fax conversation state isolated when switching tabs.
     This effect drops the OTHER tab's stale URL param and nothing else. It used
     to clear `selectedChat` too, which broke the Fax → SMS round trip: coming
     back to SMS the list re-selects the last conversation and writes its chatId
     to the URL, and then this effect ran (every one of its deps had just
     changed) and wiped the selection while clearing the stale faxMessageId.
     chatId set with no selection is the loading state, and nothing re-ran to
     resolve it — the thread sat on skeletons for ever. Clearing the selection
     is the tab switch's job, and it already does it. */
  useEffect(() => {
    if (type === 'fax' && chatId) {
      removeParam('chatId');
    } else if (type === 'messages' && faxMessageId) {
      removeParam('faxMessageId');
    }
  }, [chatId, faxMessageId, type]);

  useEffect(() => {
    if (formState === 'contact' && number) {
      setSmsNumber(number);
      setShowSendSMSModal(true);
    }
  }, [formState, number]);

  // Consume the SMS push-notification payload, then strip it from history so a
  // refresh or a back-navigation does not yank the user to an old thread.
  useEffect(() => {
    const notificationData = (location.state as any)?.notificationData;
    if (!notificationData) return;

    const sender = String(notificationData?.from || '').trim();
    const receivedOn = String(notificationData?.to || notificationData?.didNumber || '').trim();

    if (sender) {
      setType('messages');
      setFocusNumber(sender);
      if (receivedOn) setParam({ did_number: receivedOn });
    }

    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.key]);

  useEffect(() => {
    const handleResize = () => {
      setIsCompactLayout(window.innerWidth < 1280);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleBackToList = () => {
    setSelectedChat({});
    removeParam(type === 'fax' ? 'faxMessageId' : 'chatId');
  };

  return (
    <div className="mcm-inbox w-full h-full min-h-0 flex overflow-hidden bg-white">
      <section
        className={cn(
          'h-full min-h-0 bg-white',
          isCompactLayout
            ? hasActiveConversation
              ? 'hidden'
              : 'w-full'
            : 'w-full min-w-0 lg:min-w-[19rem] lg:max-w-[19rem] xl:min-w-[22rem] xl:max-w-[22rem]',
        )}
      >
        <PageSidebarLayout
          fullHeightOnMobile
          content={
            <InnerSidebarInbox
              type={type}
              onOpenConversation={handleOpenConversation}
              focusNumber={focusNumber}
              onFocusHandled={() => setFocusNumber('')}
              headerAction={
                messagesAccess?.send_message ||
                messagesAccess?.send_mms ||
                messagesAccess?.send_fax ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="mcm-btn sm primary">
                        <AddCircle className="h-4 w-4" />
                        New
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {messagesAccess?.send_message || messagesAccess?.send_mms ? (
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => {
                            setSmsNumber('');
                            openSendModal();
                          }}
                        >
                          <PlainLine className="text-gray-900 w-8 h-8" /> Send New Message
                        </DropdownMenuItem>
                      ) : null}
                      {messagesAccess?.send_fax ? (
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => {
                            setFaxNumber('');
                            setIsFaxFromDisabled(false);
                            setShowSendSMSModal(false);
                            setShowSendFaxModal(true);
                          }}
                        >
                          <FileText className="ml-1 mr-2 h-6 w-6 text-gray-900" /> Send New Fax
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null
              }
              setSelectedDID={setSelectedDID}
              selectedDID={selectedDID}
              selectedChat={selectedChat}
              setSelectedChat={setSelectedChat}
              getNameFromNumber={getNameFromNumber}
              messagesAccess={messagesAccess}
              setType={setType}
              setSmsNumber={setSmsNumber}
              faxDIDOptions={faxDIDOptions}
              selectedFaxDID={selectedFaxDID}
              setSelectedFaxDID={setSelectedFaxDID}
              isFaxDIDLoading={isFaxDIDLoading}
              isCompactLayout={isCompactLayout}
              setShowSendSMSModal={(value: boolean) => {
                if (value) {
                  openSendModal();
                } else {
                  setShowSendSMSModal(false);
                }
              }}
            />
          }
        />
      </section>
      <section
        className={cn(
          'h-full min-h-0 w-full min-w-0 flex-1 bg-white',
          isCompactLayout ? (hasActiveConversation ? 'block' : 'hidden') : 'block',
        )}
      >
        {/* Composing happens HERE, in the same space an open conversation
            occupies — not in a drawer over the top of it. The composer follows
            the active tab: switching to Fax mid-compose swaps in the fax form
            rather than leaving an SMS form, addressed from an SMS DID, on a
            screen that is now about faxes. */}
        {isComposing ? (
          type === 'fax' ? (
            <SendFaxModal
              defaultNumber={faxNumber}
              faxDIDOptions={faxDIDOptions}
              selectedDID={selectedFaxDID}
              isFromDisabled={isFaxFromDisabled}
              handleClose={closeComposers}
            />
          ) : (
            <SendSMSModal
              handleClose={() => {
                if (formState === 'contact' && number) clearAllParams();
                closeComposers();
              }}
              defaultNumber={smsNumber}
              selectedDID={selectedDID}
            />
          )
        ) : type === 'fax' ? (
          <FaxContent
            selectedDID={selectedFaxDID}
            selectedChat={selectedChat}
            getNameFromNumber={getNameFromNumber}
            onBackToList={isCompactLayout ? handleBackToList : undefined}
            onSendNewFax={(number) => {
              setFaxNumber(number);
              setIsFaxFromDisabled(true);
              setShowSendSMSModal(false);
              setShowSendFaxModal(true);
            }}
            isCompactLayout={isCompactLayout}
          />
        ) : (
          <InboxContent
            selectedDID={selectedDID}
            selectedChat={selectedChat}
            getNameFromNumber={getNameFromNumber}
            type={type}
            onBackToList={isCompactLayout ? handleBackToList : undefined}
            isCompactLayout={isCompactLayout}
          />
        )}
      </section>
    </div>
  );
};

export default Inbox;
