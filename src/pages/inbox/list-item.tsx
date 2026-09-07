import CustomAvatar from '@/components/custom/custom-avatar';
import NumberWithFlag from '@/components/custom/number-with-flag';
import { useSearchParamManager } from '@/hooks/use-search-params';
import { cn } from '@/lib/utils';
import { faxToNumberList, smsListViaDID } from '@/services/api';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  FileDown,
  FileUp,
  Image as ImageIcon,
  MessageSquareOff,
} from 'lucide-react';
import moment from 'moment';
import { useEffect, useMemo } from 'react';
import { isSameNumber, useSmsUnread } from './use-sms-unread';

const normalizeDidNumber = (number?: string) => {
  if (!number) return number;
  return number.includes('+') ? number : `+${number}`;
};

/**
 * The timestamp column is narrow, so it has to stay unambiguous without being
 * long: time for today, "Yesterday", weekday inside the last week, short date
 * beyond that.
 */
const formatConversationTime = (value: any) => {
  if (!value) return '';
  const date = moment(value);
  if (!date.isValid()) return '';

  if (date.isSame(moment(), 'day')) return date.format('HH:mm');
  if (date.isSame(moment().subtract(1, 'day'), 'day')) return 'Yesterday';
  if (date.isAfter(moment().subtract(6, 'days'))) return date.format('ddd');
  if (date.isSame(moment(), 'year')) return date.format('DD MMM');
  return date.format('DD/MM/YY');
};

const ConversationSkeleton = () => (
  <div className="flex flex-col">
    {Array.from({ length: 8 }).map((_, index) => (
      <div
        key={index}
        className="flex items-start gap-2.5 px-3.5 py-3"
        style={{ borderBottom: '1px solid var(--mcm-line-2)' }}
      >
        <div className="mcm-skel h-[34px] w-[34px] shrink-0" style={{ borderRadius: '11px' }} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
          <div className="flex items-center justify-between gap-3">
            <div className="mcm-skel h-2.5" style={{ width: `${44 + ((index * 13) % 28)}%` }} />
            <div className="mcm-skel h-2 w-8" />
          </div>
          <div className="mcm-skel h-2" style={{ width: `${58 + ((index * 7) % 26)}%` }} />
        </div>
      </div>
    ))}
  </div>
);

const EmptyState = ({ title, description }: { title: string; description: string }) => (
  <div className="mcm-empty">
    <MessageSquareOff className="mcm-empty-ic" />
    <div className="mcm-empty-title">{title}</div>
    <p>{description}</p>
  </div>
);

const ListItem = ({
  tabType = 'messages',
  selectedDID = {},
  setSelectedChat = () => null,
  getNameFromNumber = () => null,
  selectedChat,
  search = '',
  setSmsNumber = '',
  setShowSendSMSModal = '',
  isCompactLayout = false,
  focusNumber = '',
  onFocusHandled,
  onOpenConversation,
}: {
  tabType: string;
  selectedDID?: any;
  setSelectedChat?: any;
  getNameFromNumber?: any;
  selectedChat?: any;
  search?: string;
  setSmsNumber?: any;
  setShowSendSMSModal?: any;
  isCompactLayout?: boolean;
  focusNumber?: string;
  onFocusHandled?: () => void;
  /* Fired on every row click, not only when the selection changes: the list
     auto-selects a conversation, so clicking the already-selected one changes
     nothing — and the composer rendered in the same space would stay on top of
     it with no way back. */
  onOpenConversation?: () => void;
}) => {
  const { setParam, getAllParams } = useSearchParamManager();
  const { formState, chatId, faxMessageId } = getAllParams();
  const normalizedDid = normalizeDidNumber(selectedDID?.value);
  const isFaxTab = tabType === 'fax';
  // Live inbound-SMS counts already maintained by the socket layer.
  const { getUnread, markRead, refreshUnread } = useSmsUnread(normalizedDid);

  // Counts are kept current by `sms-notification`, but seed them on mount too
  // so arriving straight at /inbox shows the right badges.
  useEffect(() => {
    if (isFaxTab) return;
    refreshUnread?.();
  }, [isFaxTab, refreshUnread]);

  const { data: chatListing = [], isLoading: isSmsLoading } = useQuery({
    queryKey: [
      'smsListViaDID',
      {
        did_number: normalizedDid,
        search,
        page: 1,
        limit: 25,
      },
    ],
    queryFn: ({ queryKey }) => smsListViaDID(queryKey[1]),
    select: (data) => data?.data?.data?.result || [],
    enabled: Boolean(selectedDID?.value && !isFaxTab),
  });

  const { data: faxListing = [], isLoading: isFaxLoading } = useQuery({
    queryKey: [
      'faxToNumberList',
      {
        fromVirtualNumber: normalizedDid,
        page: 1,
        limit: 25,
      },
    ],
    queryFn: ({ queryKey }) => faxToNumberList(queryKey[1]),
    select: (data) => data?.data?.data?.result?.rows || [],
    enabled: Boolean(selectedDID?.value && isFaxTab),
  });

  const faxListingFiltered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return faxListing;

    return faxListing.filter((fax: any) => {
      const otherNumber =
        normalizedDid?.replace(/\+/g, '') === fax?.from?.replace(/\+/g, '') ? fax?.to : fax?.from;
      const name = getNameFromNumber(otherNumber?.replaceAll(' ', ''));
      return [otherNumber, name, fax?.metaData?.lastMessage]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [faxListing, getNameFromNumber, normalizedDid, search]);

  const activeListing = isFaxTab ? faxListing : chatListing;
  const activeConversationId = isFaxTab ? faxMessageId : chatId;

  /* Resolve the conversation id in the URL to the row it names.

     `selectedChat` is in the deps on purpose: a chatId in the URL with no
     selection is the thread's loading state, so if anything clears the
     selection while the id stays put, this has to run again to recover. Without
     it the effect had already fired for that id and never re-ran, and the
     thread sat on skeletons for ever. */
  useEffect(() => {
    if (!selectedDID?.value || formState === 'contact' || !activeConversationId) return;

    const existingChat = activeListing.find((item: any) =>
      isFaxTab
        ? item?.faxMessageId === activeConversationId
        : item?.chatId === activeConversationId,
    );

    if (existingChat) setSelectedChat(existingChat);
  }, [
    activeConversationId,
    activeListing,
    formState,
    isFaxTab,
    selectedChat,
    selectedDID?.value,
    setSelectedChat,
  ]);

  useEffect(() => {
    if (
      formState === 'contact' ||
      isCompactLayout ||
      activeConversationId ||
      !activeListing.length
    ) {
      return;
    }

    const firstConversation = activeListing[0];
    setSelectedChat(firstConversation);
    if (isFaxTab) {
      setParam({ faxMessageId: firstConversation?.faxMessageId });
    } else {
      setParam({ did_number: selectedDID?.value, chatId: firstConversation?.chatId });
    }
  }, [
    activeConversationId,
    activeListing,
    formState,
    isCompactLayout,
    isFaxTab,
    selectedDID?.value,
    setSelectedChat,
  ]);

  // A push notification hands us the sender's number rather than a chatId, so
  // resolve it against the loaded list and open that thread.
  useEffect(() => {
    if (!focusNumber || isFaxTab || !chatListing.length) return;

    const match = chatListing.find((item: any) => {
      const other =
        normalizedDid?.replace(/\+/g, '') === item?.from?.replace(/\+/g, '')
          ? item?.to
          : item?.from;
      return isSameNumber(other || item?.phone, focusNumber);
    });

    if (match) {
      setSelectedChat(match);
      setParam({ did_number: selectedDID?.value, chatId: match?.chatId });
    }
    onFocusHandled?.();
  }, [focusNumber, chatListing, isFaxTab, normalizedDid, selectedDID?.value]);

  if (!selectedDID?.value) {
    return (
      <EmptyState
        title={isFaxTab ? 'No fax yet' : 'No conversations yet'}
        description={
          isFaxTab
            ? 'Pick a fax number above to see its history.'
            : 'Pick a number above, then start a new message to begin texting.'
        }
      />
    );
  }

  if (isFaxTab ? isFaxLoading : isSmsLoading) {
    return <ConversationSkeleton />;
  }

  const listing = isFaxTab ? faxListingFiltered : chatListing;

  return (
    <div className="mcm-list mcm-scroll">
      {listing.length > 0 ? (
        listing.map((conversation: any) => {
          const otherNumber =
            normalizedDid?.replace(/\+/g, '') === conversation?.from?.replace(/\+/g, '')
              ? conversation?.to
              : conversation?.from;
          const isOutgoing = isFaxTab
            ? conversation?.metaData?.direction === 'outbound'
            : normalizedDid?.replace(/\+/g, '') === conversation?.from?.replace(/\+/g, '');
          const name =
            conversation?.name ||
            conversation?.toContactName ||
            getNameFromNumber(
              otherNumber?.replaceAll(' ', '') ?? conversation?.phone?.replaceAll(' ', ''),
            );
          const isSelected = isFaxTab
            ? conversation?.faxMessageId === selectedChat?.faxMessageId
            : conversation?.chatId === selectedChat?.chatId;
          const lastStatus = conversation?.metaData?.lastMessage;
          const isUnknownContact = Boolean(name?.includes('+'));
          const unreadCount = isFaxTab ? 0 : getUnread(otherNumber || conversation?.phone);
          const isFailedFax = isFaxTab && String(lastStatus).toLowerCase() === 'failed';
          const previewText = isFaxTab
            ? lastStatus || 'Fax'
            : (conversation?.metaData?.lastMessage ?? conversation?.phone?.replaceAll(' ', ''));
          const isMediaPreview =
            !isFaxTab &&
            String(conversation?.metaData?.messageMimeType || '').toLowerCase() === 'mms';
          const displayNumber = String(otherNumber || conversation?.phone || '').trim();

          return (
            <button
              type="button"
              key={conversation?._id || conversation?.faxMessageId || conversation?.chatId}
              aria-current={isSelected ? 'true' : undefined}
              className={cn('mcm-row', isSelected && 'is-active')}
              onClick={() => {
                onOpenConversation?.();
                setSelectedChat(conversation);
                if (isFaxTab) {
                  setParam({ faxMessageId: conversation?.faxMessageId });
                  return;
                }

                markRead(otherNumber || conversation?.phone);
                setParam({ did_number: selectedDID?.value, chatId: conversation?.chatId });
                if (conversation?.phone && !conversation?.chatId) {
                  setSmsNumber(conversation?.phone?.replaceAll(' ', ''));
                  setShowSendSMSModal(true);
                }
              }}
            >
              {isUnknownContact ? (
                <span
                  className={cn(
                    'mcm-row-av',
                    isFailedFax ? 'dir-fail' : isOutgoing ? 'dir-out' : 'dir-in',
                  )}
                  aria-hidden
                >
                  {isFaxTab ? (
                    isOutgoing ? (
                      <FileUp className="h-4 w-4" />
                    ) : (
                      <FileDown className="h-4 w-4" />
                    )
                  ) : isOutgoing ? (
                    <ArrowUpRight className="h-4 w-4" />
                  ) : (
                    <ArrowDownLeft className="h-4 w-4" />
                  )}
                </span>
              ) : (
                <span className="shrink-0">
                  <CustomAvatar
                    name={name}
                    image={conversation?.contactPic}
                    type="contact"
                    size="34"
                  />
                </span>
              )}

              <span className="mcm-row-body">
                <span className="mcm-row-top">
                  <span className="mcm-row-name">
                    {isUnknownContact ? <NumberWithFlag number={name} /> : name}
                  </span>
                  <span className="mcm-row-time mcm-num">
                    {formatConversationTime(conversation?.metaData?.timestamp)}
                  </span>
                </span>

                {!isUnknownContact && displayNumber ? (
                  <NumberWithFlag number={displayNumber} className="mcm-row-sub mcm-num" />
                ) : null}

                <span className="mcm-row-sub">
                  {isMediaPreview ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                  <span
                    className="mcm-row-text"
                    style={isFailedFax ? { color: 'var(--mcm-crit)', fontWeight: 600 } : undefined}
                  >
                    {previewText}
                  </span>
                </span>

                {isFaxTab || unreadCount > 0 ? (
                  <span className="mcm-row-tags">
                    {isFaxTab ? (
                      <span
                        className={cn('mcm-tag', isFailedFax ? 'neg' : isOutgoing ? 'acc' : 'pos')}
                      >
                        {isOutgoing ? 'Sent' : 'Received'}
                      </span>
                    ) : null}
                    {unreadCount > 0 ? (
                      <span className="mcm-tag acc">
                        {unreadCount > 99 ? '99+' : unreadCount} new
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })
      ) : (
        <EmptyState
          title={isFaxTab ? 'No fax yet' : 'No conversations yet'}
          description={
            isFaxTab
              ? search
                ? 'No fax conversations match your search.'
                : 'Send a fax to see it appear here.'
              : search
                ? 'No conversations match your search.'
                : 'Start a new message to begin texting.'
          }
        />
      )}
    </div>
  );
};

export default ListItem;
