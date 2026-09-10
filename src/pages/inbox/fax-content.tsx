import NumberWithFlag from '@/components/custom/number-with-flag';
import CustomAvatar from '@/components/custom/custom-avatar';
import { useSearchParamManager } from '@/hooks/use-search-params';
import { cn, formatChatDate } from '@/lib/utils';
import { getFaxList } from '@/services/api';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ExternalLink,
  FilePlus2,
  FileText,
  Loader2,
  MessageSquareOff,
  RefreshCw,
} from 'lucide-react';
import moment from 'moment';
import { useEffect, useMemo, useRef } from 'react';

const getOtherFaxNumber = (faxMessageId: string, selectedDID?: string) => {
  const [from = '', to = ''] = String(faxMessageId || '').split('_');
  const normalizedDid = String(selectedDID || '').replace(/\+/g, '');
  return from.replace(/\+/g, '') === normalizedDid ? to : from;
};

const formatStatus = (status?: string) =>
  String(status || 'pending')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const getStatusTagClassName = (status?: string) => {
  const normalizedStatus = String(status || '').toLowerCase();
  if (['success', 'completed', 'delivered'].some((value) => normalizedStatus.includes(value))) {
    return 'mcm-tag pos';
  }
  if (['failed', 'error'].some((value) => normalizedStatus.includes(value))) {
    return 'mcm-tag neg';
  }
  return 'mcm-tag warn';
};

const getFaxMediaUrl = (fax: any) =>
  fax?.storedMediaUrl || fax?.mediaUrl || fax?.originalMediaUrl || fax?.previewUrl || '';

interface FaxContentProps {
  selectedDID: any;
  selectedChat: any;
  getNameFromNumber?: (number?: string) => string;
  onBackToList?: () => void;
  onSendNewFax?: (number: string) => void;
  isCompactLayout?: boolean;
}

const FaxContent = ({
  selectedDID,
  selectedChat,
  getNameFromNumber = () => '',
  onBackToList,
  onSendNewFax,
  isCompactLayout = false,
}: FaxContentProps) => {
  const { getAllParams } = useSearchParamManager();
  const { faxMessageId = '' } = getAllParams();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const faxPayload = useMemo(
    () => ({
      search: '',
      page: 1,
      limit: 25,
      filters: { faxMessageId },
    }),
    [faxMessageId],
  );

  const {
    data: faxMessages = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['faxList', faxPayload],
    queryFn: () => getFaxList(faxPayload),
    select: (data) => data?.data?.data?.result?.rows || [],
    enabled: Boolean(faxMessageId),
  });

  const groupedFaxMessages = useMemo(() => {
    const sortedMessages = [...faxMessages].sort(
      (first: any, second: any) =>
        new Date(first?.createdAt || 0).getTime() - new Date(second?.createdAt || 0).getTime(),
    );

    return sortedMessages.reduce((groups: Record<string, any[]>, fax: any) => {
      const dateKey = moment(fax?.createdAt).format('YYYY-MM-DD');
      groups[dateKey] = [...(groups[dateKey] || []), fax];
      return groups;
    }, {});
  }, [faxMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [faxMessages]);

  if (!faxMessageId) {
    return (
      <div className="mcm-col mcm-col-stage h-full w-full">
        <div className="mcm-empty">
          <MessageSquareOff className="mcm-empty-ic" />
          <div className="mcm-empty-title">No fax selected</div>
          <p>Pick a fax conversation from the list, or send a new fax.</p>
        </div>
      </div>
    );
  }

  const otherNumber =
    selectedChat?.faxMessageId === faxMessageId
      ? selectedDID?.value?.replace(/\+/g, '') === selectedChat?.from?.replace(/\+/g, '')
        ? selectedChat?.to
        : selectedChat?.from
      : getOtherFaxNumber(faxMessageId, selectedDID?.value);
  const resolvedName = getNameFromNumber(otherNumber?.replaceAll(' ', ''));
  const name = !resolvedName || resolvedName.includes('+') ? 'Unknown contact' : resolvedName;

  return (
    <div className="mcm-col mcm-col-stage relative h-full w-full">
      <div className="mcm-thread-head">
        {onBackToList ? (
          <button
            type="button"
            className={cn('mcm-iconbtn', isCompactLayout ? 'xl:hidden' : 'hidden')}
            onClick={onBackToList}
            aria-label="Back to fax conversations"
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </button>
        ) : null}
        <span className="shrink-0">
          <CustomAvatar name={name} type="contact" size="38" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mcm-thread-name">{name}</div>
          <div className="mcm-thread-num">
            <NumberWithFlag number={otherNumber} className="mcm-num truncate" />
            <span className="mcm-tag neu hidden sm:inline-flex">FAX</span>
          </div>
        </div>
        <span className="mcm-chip hidden lg:inline-flex">
          <span className="mcm-eyebrow">From</span>
          <span className="mcm-num max-w-40 truncate">{selectedDID?.value || 'NA'}</span>
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          className="mcm-iconbtn"
          aria-label="Refresh fax history"
          title="Refresh fax history"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-[17px] w-[17px]" />
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="mcm-thread justify-end gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className={cn('flex w-full', row % 2 ? 'justify-end' : 'justify-start')}>
              <div
                className="mcm-skel h-20"
                style={{ width: `${44 + row * 7}%`, borderRadius: '13px' }}
              />
            </div>
          ))}
        </div>
      ) : faxMessages.length ? (
        <div className="mcm-thread mcm-scroll">
          {Object.entries(groupedFaxMessages).map(([dateKey, messages]) => (
            <div key={dateKey} className="flex flex-col">
              <div className="my-3 flex justify-center">
                <span className="mcm-daychip">{formatChatDate(messages[0]?.createdAt)}</span>
              </div>
              {messages.map((fax: any) => {
                const isOutbound = fax?.direction === 'outbound';
                const mediaUrl = getFaxMediaUrl(fax);
                const pageCount = Number(fax?.pageCount || 0);
                const failureReason = formatStatus(fax?.failureReason);

                return (
                  <div
                    key={fax?._id || fax?.faxId}
                    className={cn(
                      'mb-2.5 flex w-full flex-col',
                      isOutbound ? 'items-end' : 'items-start',
                    )}
                  >
                    <div
                      className={cn('mcm-bub is-tail', isOutbound ? 'mcm-bub-out' : 'mcm-bub-in')}
                      style={{ minWidth: '15rem' }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                          style={{
                            background: isOutbound
                              ? 'rgba(255,255,255,0.18)'
                              : 'var(--mcm-surface-3)',
                            color: isOutbound ? '#fff' : 'var(--mcm-accent-ink)',
                          }}
                        >
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">
                            {fax?.fileName || 'Fax document.pdf'}
                          </p>
                          <p
                            className="text-[10.5px]"
                            style={{
                              color: isOutbound ? 'rgba(255,255,255,0.75)' : 'var(--mcm-ink-4)',
                            }}
                          >
                            {pageCount > 0
                              ? `${pageCount} page${pageCount === 1 ? '' : 's'}`
                              : 'PDF document'}
                          </p>
                        </div>
                        {mediaUrl ? (
                          <a
                            href={mediaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
                            style={{ color: 'inherit' }}
                            aria-label="Open fax PDF"
                            title="Open PDF"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : null}
                      </div>

                      <div
                        className="flex flex-wrap items-center justify-between gap-2 pt-2"
                        style={{
                          borderTop: `1px solid ${
                            isOutbound ? 'rgba(255,255,255,0.22)' : 'var(--mcm-line)'
                          }`,
                        }}
                      >
                        <span className={getStatusTagClassName(fax?.status)}>
                          {formatStatus(fax?.status)}
                        </span>
                        {fax?.faxCost !== null && fax?.faxCost !== undefined ? (
                          <span
                            className="mcm-num text-[10.5px]"
                            style={{
                              color: isOutbound ? 'rgba(255,255,255,0.8)' : 'var(--mcm-ink-4)',
                            }}
                          >
                            ${fax.faxCost}
                          </span>
                        ) : null}
                      </div>
                      {fax?.failureReason ? (
                        <p
                          className="text-[11px]"
                          style={{ color: isOutbound ? '#ffe0e0' : 'var(--mcm-crit)' }}
                        >
                          Reason: {failureReason}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className="mcm-num mt-1 px-1 text-[10px]"
                      style={{ color: 'var(--mcm-ink-4)' }}
                    >
                      {moment(fax?.createdAt).format('HH:mm')}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      ) : (
        <div className="mcm-empty">
          <MessageSquareOff className="mcm-empty-ic" />
          <div className="mcm-empty-title">No fax messages found</div>
          <p>This fax conversation does not have any history yet.</p>
        </div>
      )}
      {onSendNewFax ? (
        <button
          type="button"
          onClick={() => onSendNewFax(String(otherNumber || ''))}
          className="mcm-btn primary sm absolute right-4 bottom-4 z-10"
          style={{ boxShadow: 'var(--mcm-shadow-lg)' }}
          title="Send new fax"
        >
          <FilePlus2 className="h-4 w-4" />
          <span>New fax</span>
        </button>
      ) : null}
    </div>
  );
};

export default FaxContent;
