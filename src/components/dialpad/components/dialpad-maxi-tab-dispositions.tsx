import type { DialpadSession } from '@/context/dialpad-context';
import { isServerDialed } from '@/lib/campaign-dial-mode';
import { useDialpad } from '@/hooks/use-dialpad';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useUser } from '@/hooks/use-user';
import {
  addDispositionInLeadContatc,
  makeCallQueueAvailable,
  queueDisposition,
} from '@/services/api';
import { useEffect, useMemo, useRef, useState } from 'react';

type DialpadMaxiTabDispositionsProps = {
  activeSession: DialpadSession | null;
};

const WAIT_AFTER_CALL_MS = 30000;

type QueueDispositionItem = {
  _id?: string;
  disposition?: {
    name?: string;
  } | null;
};

const getWrapupDurationSeconds = (session: DialpadSession | null): number => {
  const queueWrapupTime = Number(session?.queueMetaData?.response?.settings?.wrapup_time ?? 0);
  const campaignWrapupTime = Number(
    session?.campaignMetaData?.response?.dialerSetting?.wrapup_time ?? 0,
  );
  const wrapupTime = queueWrapupTime > 0 ? queueWrapupTime : campaignWrapupTime;
  if (!Number.isFinite(wrapupTime) || wrapupTime <= 0) return 0;
  return Math.floor(wrapupTime);
};

const getWrapupTimeSnapshotSeconds = (
  session: DialpadSession | null,
  nowTimestampMs: number = Date.now(),
): number => {
  const wrapupDurationSeconds = getWrapupDurationSeconds(session);
  if (wrapupDurationSeconds <= 0) return 0;

  const referenceTimestampMs = session?.endedAt || session?.connectedAt || session?.startedAt || 0;
  if (!referenceTimestampMs) return wrapupDurationSeconds;

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Math.max(nowTimestampMs, referenceTimestampMs) - referenceTimestampMs) / 1000),
  );

  return Math.max(0, wrapupDurationSeconds - elapsedSeconds);
};

const getHeaderFirstValue = (
  headers: DialpadSession['headers'] | undefined,
  headerName: string,
): string => {
  if (!headers) return '';

  const normalizedHeaderName = headerName.trim().toLowerCase();
  const matchingHeaderEntry = Object.entries(headers).find(
    ([name]) => name.trim().toLowerCase() === normalizedHeaderName,
  );

  if (!matchingHeaderEntry) return '';

  const [, values] = matchingHeaderEntry;
  if (!Array.isArray(values) || values.length === 0) return '';
  return String(values[0] || '').trim();
};

const getSessionDispositions = (activeSession: DialpadSession | null): QueueDispositionItem[] => {
  const queueId = String(activeSession?.queueMetaData?.id || '').trim();
  const campaignId = String(activeSession?.campaignMetaData?.id || '').trim();
  const forwardTypeFromHeader = getHeaderFirstValue(activeSession?.headers, 'x-forwardtype')
    .trim()
    .toUpperCase();
  const shouldForceCampaignFromHeader =
    Boolean(queueId && campaignId) && forwardTypeFromHeader === 'CAMPAIGN';

  const queueDispositionList = activeSession?.queueMetaData?.response?.agentDisposition;
  const campaignDispositionList = activeSession?.campaignMetaData?.response?.agentDisposition;

  if (shouldForceCampaignFromHeader && Array.isArray(campaignDispositionList))
    return campaignDispositionList;
  if (Array.isArray(queueDispositionList)) return queueDispositionList;
  if (Array.isArray(campaignDispositionList)) return campaignDispositionList;

  return [];
};

const DialpadMaxiTabDispositions = ({ activeSession }: DialpadMaxiTabDispositionsProps) => {
  const { clearSession, setCampaignContactCards, openDialpad, isDialpadOpen, setActiveCampaign } =
    useDialpad();
  const { socketEventsManager } = useSocketEvents();
  const { user } = useUser();
  const userDetailsPayload = useMemo(
    () => ({
      first_name: String(user?.user_info?.first_name || user?.first_name || '').trim(),
      last_name: String(user?.user_info?.last_name || user?.last_name || '').trim(),
      email: String(user?.user_info?.email || user?.email || '').trim(),
      extension: String(user?.user_info?.extension || '').trim(),
      user_uuid: String(user?.uuid || '').trim(),
      company_uuid: String(user?.company_info?.uuid || user?.company_uuid || '').trim(),
      domain: String(user?.sip_credentials?.domain || user?.user_info?.domain || '').trim(),
      role: String(user?.role || user?.user_info?.role || '').trim(),
      caller_id: String(user?.user_info?.caller_id || user?.caller_id || '').trim(),
    }),
    [user],
  );
  const currentUserUuid = user?.uuid || '';
  const currentCompanyUuid = user?.company_info?.uuid || '';
  const [selectedDispositionId, setSelectedDispositionId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [wrapupTimeSnapshotSeconds, setWrapupTimeSnapshotSeconds] = useState<number>(
    getWrapupTimeSnapshotSeconds(activeSession),
  );
  const activeSessionRef = useRef<DialpadSession | null>(activeSession);

  const dispositionList = useMemo(() => getSessionDispositions(activeSession), [activeSession]);

  useEffect(() => {
    setSelectedDispositionId('');
  }, [activeSession?.id]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    setWrapupTimeSnapshotSeconds(getWrapupTimeSnapshotSeconds(activeSessionRef.current));
    if (!activeSessionRef.current?.id) return;

    const snapshotInterval = window.setInterval(() => {
      setWrapupTimeSnapshotSeconds(getWrapupTimeSnapshotSeconds(activeSessionRef.current));
    }, 1000);

    return () => {
      window.clearInterval(snapshotInterval);
    };
  }, [
    activeSession?.connectedAt,
    activeSession?.endedAt,
    activeSession?.id,
    activeSession?.startedAt,
    activeSession?.campaignMetaData?.response?.dialerSetting?.wrapup_time,
    activeSession?.queueMetaData?.response?.settings?.wrapup_time,
  ]);

  const selectedDisposition = useMemo(
    () => dispositionList.find((item) => item?._id === selectedDispositionId) || null,
    [dispositionList, selectedDispositionId],
  );

  const handleSave = async () => {
    if (!activeSession || !selectedDisposition || isSaving) return;

    const queueId = String(activeSession.queueMetaData?.id || '').trim();
    const campaignId = String(activeSession.campaignMetaData?.id || '').trim();
    const forwardTypeFromHeader = getHeaderFirstValue(activeSession.headers, 'x-forwardtype')
      .trim()
      .toUpperCase();
    const shouldForceCampaignFromHeader =
      Boolean(queueId && campaignId) && forwardTypeFromHeader === 'CAMPAIGN';
    const isQueueCallSession = shouldForceCampaignFromHeader ? false : Boolean(queueId);
    const isCampaignCallSession = shouldForceCampaignFromHeader ? true : Boolean(campaignId);
    if (!isQueueCallSession && !isCampaignCallSession) return;

    const currentWrapupSnapshot = Math.max(0, Math.floor(wrapupTimeSnapshotSeconds));
    const dispositionName = selectedDisposition.disposition?.name || '';
    const userName =
      `${user?.user_info?.first_name || ''} ${user?.user_info?.last_name || ''}`.trim();
    const contactPhone =
      getHeaderFirstValue(activeSession.headers, 'x-originalnumber') ||
      activeSession.remoteNumber ||
      activeSession.liveCallData?.called_number ||
      '';

    try {
      setIsSaving(true);
      let shouldClearAllSessions = true;

      if (isQueueCallSession) {
        const queuePayload = {
          disposition: {
            disposition: dispositionName,
            name: userName,
            extension: user?.user_info?.extension || '',
            uuid: user?.uuid || '',
            createdAt: new Date().toISOString(),
            _id: queueId,
          },
          contactName: '',
          contactPhone,
          sipCallId:
            getHeaderFirstValue(activeSession.headers, 'x-cid') ||
            getHeaderFirstValue(activeSession.headers, 'call-id') ||
            activeSession.liveCallData?.sip_call_id ||
            activeSession.id ||
            '',
          source: 'QUEUE',
          serviceDetail: {
            name: activeSession.queueMetaData?.response?.name || '',
            type: 'QUEUE',
            uuid: queueId,
          },
          wrap_time_sec: currentWrapupSnapshot,
          queueUuid: queueId,
        };

        await queueDisposition(queuePayload);
        await makeCallQueueAvailable({
          queue_uuid: queueId,
          status: 'Available',
          state: 'Waiting',
        });
        console.log('Queue disposition saved', queuePayload);
      } else if (isCampaignCallSession) {
        const campaignNumberId = String(
          activeSession.liveCallData?.campaign_number_uuid ||
            getHeaderFirstValue(activeSession.headers, 'x-campaignnumberuuid') ||
            '',
        ).trim();
        const contactId = String(
          activeSession.liveCallData?.contact_uuid ||
            getHeaderFirstValue(activeSession.headers, 'x-contactuuid') ||
            '',
        ).trim();
        const campaignName =
          activeSession.campaignMetaData?.response?.name ||
          activeSession.liveCallData?.campaign_name ||
          '';
        const campaignType =
          activeSession.campaignMetaData?.response?.dialMethod ||
          activeSession.liveCallData?.campaign_type ||
          'CAMPAIGN';
        const contactName =
          activeSession.liveCallData?.contact_name ||
          `${activeSession.contactInfo?.name?.first || ''} ${activeSession.contactInfo?.name?.last || ''}`.trim() ||
          activeSession.remoteName ||
          '';
        const campaignPayload = {
          disposition: {
            disposition: dispositionName,
            name: userName,
            extension: user?.user_info?.extension || '',
            uuid: user?.uuid || '',
            createdAt: new Date().toISOString(),
            _id: String(selectedDisposition?._id || selectedDispositionId || '').trim(),
          },
          contactId,
          contactName,
          contactPhone,
          sipCallId:
            activeSession.liveCallData?.sip_call_id ||
            getHeaderFirstValue(activeSession.headers, 'x-cid') ||
            getHeaderFirstValue(activeSession.headers, 'call-id') ||
            activeSession.id ||
            '',
          source: 'LEAD',
          serviceDetail: {
            name: campaignName,
            type: campaignType,
            uuid: campaignId,
          },
          wrap_time_sec: currentWrapupSnapshot,
          campaignNumberId,
        };

        await addDispositionInLeadContatc(campaignPayload);
        console.log('Campaign disposition saved', campaignPayload);

        const campaignDialMethod = String(campaignType || '')
          .trim()
          .toUpperCase();
        const isPredictiveCampaign = isServerDialed(campaignDialMethod);
        const shouldFetchNextContact =
          (campaignDialMethod === 'PROGRESSIVE' ||
            campaignDialMethod === 'PREVIEW' ||
            isPredictiveCampaign) &&
          !!socketEventsManager &&
          !!campaignId &&
          !!currentUserUuid &&
          !!currentCompanyUuid &&
          !!activeSession.id;

        if (shouldFetchNextContact) {
          try {
            clearSession(activeSession.id);
            if (isPredictiveCampaign) {
              socketEventsManager.emit(
                'campaign-system-events',
                {
                  body: {
                    campaignId,
                    queue:
                      activeSession.liveCallData?.queue ||
                      activeSession.campaignMetaData?.response?.queue ||
                      '',
                    user_uuid: currentUserUuid,
                    userDetail: userDetailsPayload,
                  },
                },
                (res: any) => {
                  const firstLevel = Array.isArray(res) ? res[0] : null;
                  const eventPayload = Array.isArray(firstLevel) ? firstLevel[0] : firstLevel;
                  const campaignStatusFromEvent = String(eventPayload?.campaignStatus || '')
                    .trim()
                    .toUpperCase();
                  if (['COMPLETED', 'COMPLETE', 'PAUSE'].includes(campaignStatusFromEvent)) {
                    setCampaignContactCards([]);
                    setActiveCampaign((prev: any) => ({
                      ...(prev || {}),
                      manualStatus: campaignStatusFromEvent,
                    }));
                    return;
                  }
                  console.log('campaign-system-events response:', res);
                },
              );

              const availabilityResponse = await makeCallQueueAvailable({
                campaign_uuid: campaignId,
                status: 'Available',
                state: 'Waiting',
              });
              console.log('makeCallQueueAvailable response:', availabilityResponse);

              if (!isDialpadOpen) {
                openDialpad('maxi');
              }
            } else {
              setCampaignContactCards([]);
              setActiveCampaign((prev: any) => {
                const currentStatus = String(
                  prev?.manualStatus || prev?.campaignStatus || '',
                ).toUpperCase();
                if (['COMPLETED', 'COMPLETE', 'PAUSE'].includes(currentStatus)) return prev;

                return {
                  ...(prev || {}),
                  manualStatus: 'PROCESSING',
                  nextContactDelayMs: WAIT_AFTER_CALL_MS,
                  deferredNextAction: null,
                };
              });
              if (!isDialpadOpen) {
                openDialpad('maxi');
              }
            }
            shouldClearAllSessions = false;
          } catch (error) {
            console.error('Failed to fetch campaign contacts after disposition save', error);
          }
        }
      }

      if (shouldClearAllSessions) {
        clearSession(activeSession.id);
      }
    } catch (error) {
      console.error('Failed to save disposition', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!activeSession) {
    return (
      <div className="h-full rounded-2xl border border-ucass-active-bg bg-white px-3 py-3 max-[380px]:px-2.5 max-[380px]:py-2.5 sm:px-4 sm:py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5a7396] max-[380px]:text-[10px] sm:text-xs">
          Dispositions
        </p>
        <p className="mt-2 text-[13px] text-[#6c809e] max-[380px]:text-xs sm:text-sm">
          No active session available.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full rounded-2xl border border-ucass-active-bg bg-white px-3 py-3 max-[380px]:px-2.5 max-[380px]:py-2.5 sm:px-4 sm:py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5a7396] max-[380px]:text-[10px] sm:text-xs">
        Dispositions
      </p>

      {dispositionList.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-[#d7e3f6] bg-white px-2.5 py-3 text-[13px] text-[#5f7392] max-[380px]:px-2 max-[380px]:text-xs sm:px-3 sm:text-sm">
          No dispositions found for this session.
        </div>
      ) : (
        <>
          <div className="mt-3 space-y-2 max-[380px]:space-y-1.5 sm:space-y-2.5">
            {dispositionList.map((item, index) => {
              const dispositionId = String(item?._id || `disposition-${index}`);
              const dispositionName = item?.disposition?.name || 'Unnamed Disposition';
              const isSelected = selectedDispositionId === dispositionId;

              return (
                <label
                  key={dispositionId}
                  htmlFor={dispositionId}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2.5 transition max-[380px]:px-2 max-[380px]:py-2 sm:px-3 sm:py-3 ${
                    isSelected
                      ? 'border-[#9fc3ff] bg-[#eef5ff]'
                      : 'border-[#dce7f7] bg-white hover:border-[#c9dcf8] hover:bg-[#f7fbff]'
                  }`}
                >
                  <input
                    id={dispositionId}
                    type="radio"
                    name="dialpad-disposition"
                    value={dispositionId}
                    checked={isSelected}
                    onChange={() => setSelectedDispositionId(dispositionId)}
                    className="h-4 w-4 accent-ucass-active"
                  />
                  <span className="truncate text-[13px] font-medium text-[#243a59] max-[380px]:text-xs sm:text-sm">
                    {dispositionName}
                  </span>
                </label>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!selectedDisposition || isSaving}
            className="mt-3 w-full rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </>
      )}
    </div>
  );
};

export default DialpadMaxiTabDispositions;
