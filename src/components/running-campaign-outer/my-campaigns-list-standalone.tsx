import { SearchLine } from '@/assets/icons';
import { isServerDialed } from '@/lib/campaign-dial-mode';
import { Icon } from '@/assets/icons/icon';
import Loader from '@/components/custom/loader';
import type { DialpadSession } from '@/context/dialpad-context';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import useDebounce from '@/hooks/use-debounce';
import { useSocketEvents } from '@/hooks/use-socket-events';
import { useDialpad } from '@/hooks/use-dialpad';
import { useUser } from '@/hooks/use-user';
import { handleAlert } from '@/lib/utils';
import { CAMPAIGN_STATUS_CONST, CAMPAIGN_TYPE_NAME } from '@/pages/auto-dialer/campaign/const';
import CallQueueCard from '@/pages/dashboard/call-dashboard/Call-queue-content/call-queue-card';
import NotFound from '@/assets/images/not-found-img.svg';
import {
  campaignAnalytics,
  getCallQueueInvolvements,
  getRunningCampaigns,
  makeCallQueueAvailable,
} from '@/services/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Loader2, Mic, RefreshCcw, X } from 'lucide-react';

type TabKey = 'running-campaign' | 'assigned-queues';

const getCampaignPayload = (response: any) =>
  Array.isArray(response)
    ? response?.[0]?.response || response?.[0]
    : response?.response || response;

const getCampaignStatus = (response: any) => {
  const payload = getCampaignPayload(response);
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rows)
      ? payload.rows
      : payload
        ? [payload]
        : [];

  return String(
    payload?.campaignStatus ||
      items.find((item: any) => item?.campaignStatus)?.campaignStatus ||
      response?.campaignStatus ||
      '',
  )
    .trim()
    .toUpperCase();
};

const getCampaignRows = (response: any) => {
  const payload = getCampaignPayload(response);
  return Array.isArray(payload?.rows) ? payload.rows : [];
};

const getRandomCallerId = (campaign: any) => {
  if (!Array.isArray(campaign?.callerId) || campaign.callerId.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * campaign.callerId.length);
  return campaign.callerId[randomIndex];
};

const getHeaderFirstValueFromSessionHeaders = (
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

const getSessionCampaignId = (session: DialpadSession | null | undefined): string => {
  if (!session) return '';

  const liveForwardType = String(session?.liveCallData?.forward_type || '')
    .trim()
    .toUpperCase();
  const headerCampaignId = getHeaderFirstValueFromSessionHeaders(
    session?.headers,
    'x-campaignuuid',
  );
  const liveCampaignId = String(
    session?.liveCallData?.campaign_uuid ||
      (liveForwardType === 'CAMPAIGN' ? session?.liveCallData?.forward_value : '') ||
      '',
  ).trim();

  return String(session?.campaignMetaData?.id || liveCampaignId || headerCampaignId || '').trim();
};

const MyCampaignListStandalone = () => {
  const { socketEventsManager } = useSocketEvents();
  const {
    setCampaignContactCards,
    openDialpad,
    joinedCampaignId,
    activeCampaign,
    setJoinedCampaignId,
    setActiveCampaign,
    startCampaignClearingTimer,
    sessions,
    isRegistered,
  } = useDialpad();
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

  const [activeTab, setActiveTab] = useState<TabKey>('running-campaign');
  const [queueSearch, setQueueSearch] = useState('');
  const [campaignActionPendingId, setCampaignActionPendingId] = useState<string | null>(null);
  const [refreshingCampaignIds, setRefreshingCampaignIds] = useState<Record<string, boolean>>({});
  const [campaignAnalyticsMap, setCampaignAnalyticsMap] = useState<Record<string, any>>({});
  const [micPermissionDialogOpen, setMicPermissionDialogOpen] = useState(false);
  const [pendingCampaign, setPendingCampaign] = useState<any>(null);
  const [micPermissionState, setMicPermissionState] = useState<
    'prompt' | 'granted' | 'denied' | 'unsupported'
  >('prompt');
  const [micPermissionMessage, setMicPermissionMessage] = useState('');

  const debouncedQueueSearch = useDebounce(queueSearch, 1000);

  const { data: campaignList = [], isLoading: isCampaignListLoading } = useQuery({
    queryKey: ['getRunningCampaignsList'],
    queryFn: () => getRunningCampaigns(),
    select: (data) => data?.data?.data?.result?.rows || [],
  });

  const {
    data: callQueueData = [],
    isError: isQueueError,
    isLoading: isQueueLoading,
    refetch: refetchCallQueue,
  } = useQuery({
    queryKey: ['getCallQueueInvolvements', debouncedQueueSearch],
    queryFn: () =>
      getCallQueueInvolvements({
        search: debouncedQueueSearch,
      }),
    select: (res) => res?.data?.data?.result ?? [],
    enabled: activeTab === 'assigned-queues',
  });

  // const { mutateAsync: mutateCampaignJoinUpsert } = useMutation({
  //   mutationFn: upsertCampaignJoin,
  // });

  useEffect(() => {
    if (!joinedCampaignId || isCampaignListLoading) return;

    const isJoinedCampaignAvailable = campaignList.some(
      (campaign: any) => String(campaign?._id || '').trim() === joinedCampaignId,
    );
    if (!isJoinedCampaignAvailable) {
      setJoinedCampaignId(null);
      setActiveCampaign(null);
    }
  }, [
    campaignList,
    isCampaignListLoading,
    joinedCampaignId,
    setActiveCampaign,
    setJoinedCampaignId,
  ]);

  useEffect(() => {
    if (activeCampaign !== null) return;
    setJoinedCampaignId(null);
    setActiveCampaign(null);
  }, [activeCampaign, setActiveCampaign, setJoinedCampaignId]);

  const toNumber = (value: any) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getCampaignMemberAnalytics = (campaign: any) => campaignAnalyticsMap[campaign?._id] || {};

  const getPercentage = (rawPercentage: any, value: number, total: number) => {
    const parsed = Number(rawPercentage);
    if (Number.isFinite(parsed)) return Number(parsed.toFixed(2));
    if (!total) return 0;
    return Number(((value / total) * 100).toFixed(2));
  };

  const getStatusBadgeConfig = (status: string) => {
    const statusMap: Record<string, { label: string; className: string }> = {
      PROCESSING: {
        label: 'Processing',
        className: 'bg-orange-50 border border-orange-200 text-orange-500',
      },
      COMPLETED: {
        label: 'Completed',
        className: 'bg-emerald-50 border border-emerald-200 text-emerald-600',
      },
      PAUSE: {
        label: 'Pause',
        className: 'bg-rose-50 border border-rose-200 text-rose-600',
      },
      NEW: {
        label: 'New',
        className: 'bg-sky-50 border border-sky-200 text-sky-600',
      },
    };

    return (
      statusMap[status] || {
        label: String(status || 'Unknown')
          .toLowerCase()
          .replace(/\b\w/g, (char) => char.toUpperCase()),
        className: 'bg-slate-50 border border-slate-200 text-slate-600',
      }
    );
  };

  const { mutateAsync: mutateCampaignAnalytics } = useMutation({
    mutationFn: campaignAnalytics,
  });

  const refreshCampaignAnalytics = async (campaignId?: string) => {
    if (!campaignId || refreshingCampaignIds[campaignId]) return;
    setRefreshingCampaignIds((prev) => ({ ...prev, [campaignId]: true }));
    try {
      const response: any = await mutateCampaignAnalytics({ campaignId });
      const analytics = response?.data?.data?.result;
      if (!analytics) return;
      setCampaignAnalyticsMap((prev) => ({ ...prev, [campaignId]: analytics }));
    } catch (error) {
      console.error('Failed to fetch campaign analytics:', error);
    } finally {
      setRefreshingCampaignIds((prev) => {
        const next = { ...prev };
        delete next[campaignId];
        return next;
      });
    }
  };

  useEffect(() => {
    if (activeTab !== 'running-campaign') return;
    if (isCampaignListLoading || !campaignList?.length) return;

    setCampaignAnalyticsMap((prev) => {
      const allowedIds = new Set(
        campaignList.map((campaign: any) => campaign?._id).filter(Boolean),
      );
      return Object.fromEntries(
        Object.entries(prev).filter(([campaignId]) => allowedIds.has(campaignId)),
      );
    });

    campaignList.forEach((campaign: any) => {
      if (campaign?._id) {
        refreshCampaignAnalytics(campaign._id);
      }
    });
  }, [activeTab, campaignList, isCampaignListLoading]);

  const getMicrophonePermissionState = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      return 'unsupported' as const;
    }

    if (!navigator.permissions?.query) return 'prompt' as const;

    try {
      const result = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });

      if (result.state === 'granted') return 'granted' as const;
      if (result.state === 'denied') return 'denied' as const;
      return 'prompt' as const;
    } catch {
      return 'prompt' as const;
    }
  }, []);

  const ensureMicrophonePermission = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setMicPermissionState('unsupported');
      setMicPermissionMessage('Microphone access is not supported in this browser.');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermissionState('granted');
      setMicPermissionMessage('');
      return true;
    } catch (error: any) {
      const errorName = String(error?.name || '').toLowerCase();
      const isDenied = errorName === 'notallowederror' || errorName === 'permissiondeniederror';

      setMicPermissionState(isDenied ? 'denied' : 'prompt');
      setMicPermissionMessage(
        isDenied
          ? 'Microphone access is blocked. Please enable microphone permission from the browser site settings near the address bar, then try again.'
          : 'Unable to access your microphone. Please check microphone permission and try again.',
      );
      return false;
    }
  }, []);

  const launchCampaign = async (campaign: any) => {
    console.log('🚀 ~ handleJoinCampaign ~ campaign:', campaign);
    const { _id } = campaign || {};

    if (!_id) return;
    if (campaignActionPendingId) return;
    if (joinedCampaignId && joinedCampaignId !== _id) return;

    if (!userDetailsPayload.user_uuid || !userDetailsPayload.company_uuid) {
      handleAlert({
        text: 'Unable to join campaign. User details are missing.',
        type: 'error',
      });
      return;
    }

    setCampaignActionPendingId(_id);
    setActiveCampaign({
      ...campaign,
      selectedCallerId: getRandomCallerId(campaign),
    });
    setJoinedCampaignId(_id);
    socketEventsManager?.emit('campaign-event-logs', {
      campaignDetail: {
        campaignName: campaign?.name,
        campaignId: _id,
        companyId: campaign?.companyId,
      },
      eventType: 'INSERT',
      userDetail: {
        first_name: userDetailsPayload.first_name,
        last_name: userDetailsPayload.last_name,
        email: userDetailsPayload.email,
        extension: userDetailsPayload.extension,
        user_uuid: userDetailsPayload.user_uuid,
        company_uuid: userDetailsPayload.company_uuid,
        domain: userDetailsPayload.domain,
        role: userDetailsPayload.role,
        caller_id: campaign?.callerId,
      },
    });

    /* Predictive and (once the server dials it) progressive: the agent goes
       available in the campaign's queue and waits for the dialer to ring them.
       Preview: the agent pulls records and dials from their own phone. */
    const isPredictiveCampaign = isServerDialed(campaign?.dialMethod);

    if (isPredictiveCampaign) {
      try {
        const availabilityResponse = await makeCallQueueAvailable({
          campaign_uuid: _id,
          status: 'Available',
          state: 'Waiting',
        });
        console.log('makeCallQueueAvailable response:', availabilityResponse);
      } catch (error) {
        console.error('makeCallQueueAvailable failed for predictive campaign:', error);
      } finally {
        openDialpad('maxi');
        setCampaignActionPendingId(null);
      }
    } else {
      if (!socketEventsManager) {
        setCampaignActionPendingId(null);
        return;
      }

      socketEventsManager.emit(
        'campaign-preview-contact-list',
        {
          body: {
            campaignId: _id,
            user_uuid: userDetailsPayload.user_uuid,
            company_uuid: userDetailsPayload.company_uuid,
            userDetail: userDetailsPayload,
          },
        },
        (res: any) => {
          const campaignStatus = getCampaignStatus(res);
          if (['COMPLETED', 'COMPLETE', 'PAUSE'].includes(campaignStatus)) {
            socketEventsManager.emit('campaign-event-logs', {
              campaignDetail: {
                campaignName: campaign?.name,
                campaignId: _id,
                companyId: campaign?.companyId,
              },
              eventType: 'DELETE',
              userDetail: {
                first_name: userDetailsPayload.first_name,
                last_name: userDetailsPayload.last_name,
                email: userDetailsPayload.email,
                extension: userDetailsPayload.extension,
                user_uuid: userDetailsPayload.user_uuid,
                company_uuid: userDetailsPayload.company_uuid,
                domain: userDetailsPayload.domain,
                role: userDetailsPayload.role,
                caller_id: campaign?.callerId,
              },
            });
            setActiveCampaign(null);
            setJoinedCampaignId(null);
            setCampaignContactCards(null);
            setCampaignActionPendingId(null);
            handleAlert({
              text:
                campaignStatus === 'PAUSE'
                  ? 'Campaign has been paused.'
                  : 'Campaign has been completed. No more contacts are available.',
              type: campaignStatus === 'PAUSE' ? 'info' : 'success',
            });
            return;
          }

          setActiveCampaign((prev: any) => ({ ...prev, manualStatus: campaignStatus }));
          console.log('res-X', res);
          const rows = getCampaignRows(res);
          setCampaignContactCards(rows);
          openDialpad('maxi');
          setCampaignActionPendingId(null);
        },
      );
    }
  };

  const handleMicPermissionConfirm = useCallback(async () => {
    if (!pendingCampaign) return;

    setMicPermissionMessage('');
    const currentPermissionState = await getMicrophonePermissionState();
    setMicPermissionState(currentPermissionState);

    if (currentPermissionState === 'denied') {
      setMicPermissionMessage(
        'Microphone access is blocked. Please click the site settings icon near the address bar, allow microphone access for this site, then click the button again.',
      );
      return;
    }

    const hasPermission = await ensureMicrophonePermission();
    if (!hasPermission) return;

    setMicPermissionDialogOpen(false);
    await launchCampaign(pendingCampaign);
    setPendingCampaign(null);
  }, [ensureMicrophonePermission, getMicrophonePermissionState, launchCampaign, pendingCampaign]);

  const handleJoinCampaign = async (campaign: any) => {
    if (joinedCampaignId === campaign?._id || campaignActionPendingId) return;
    if (joinedCampaignId && joinedCampaignId !== campaign?._id) return;

    if (!isRegistered) {
      handleAlert({
        text: 'You are not registered to start the campaign',
        type: 'warning',
      });
      return;
    }

    if (campaign?.campaignStatus !== CAMPAIGN_STATUS_CONST.PROCESSING) return;

    const currentPermissionState = await getMicrophonePermissionState();
    setMicPermissionState(currentPermissionState);

    if (currentPermissionState === 'granted') {
      await launchCampaign(campaign);
      return;
    }

    setPendingCampaign(campaign);
    setMicPermissionDialogOpen(true);
  };

  useEffect(() => {
    if (!micPermissionDialogOpen) {
      setMicPermissionMessage('');
      return;
    }

    void getMicrophonePermissionState().then((state) => {
      setMicPermissionState(state);
      if (state === 'denied') {
        setMicPermissionMessage(
          'Microphone access is currently blocked for this site. Enable it from the browser site settings near the address bar.',
        );
      } else if (state === 'unsupported') {
        setMicPermissionMessage('Microphone access is not supported in this browser.');
      } else {
        setMicPermissionMessage('');
      }
    });
  }, [getMicrophonePermissionState, micPermissionDialogOpen]);

  const handleLeaveCampaign = async (campaign: any) => {
    const { _id } = campaign || {};
    if (!_id || joinedCampaignId !== _id) return;
    if (campaignActionPendingId) return;

    const hasActiveCallForThisCampaign = Object.values(sessions || {}).some((sessionItem) => {
      const sessionCampaignId = getSessionCampaignId(sessionItem);
      return Boolean(sessionCampaignId && sessionCampaignId === _id);
    });

    if (hasActiveCallForThisCampaign) {
      handleAlert({
        text: 'There is an active call going on. Disposition the call first.',
        type: 'error',
      });
      return;
    }

    setCampaignActionPendingId(_id);
    socketEventsManager?.emit('campaign-event-logs', {
      campaignDetail: {
        campaignName: campaign?.name,
        campaignId: _id,
        companyId: campaign?.companyId,
      },
      eventType: 'DELETE',
      userDetail: {
        first_name: userDetailsPayload.first_name,
        last_name: userDetailsPayload.last_name,
        email: userDetailsPayload.email,
        extension: userDetailsPayload.extension,
        user_uuid: userDetailsPayload.user_uuid,
        company_uuid: userDetailsPayload.company_uuid,
        domain: userDetailsPayload.domain,
        role: userDetailsPayload.role,
        caller_id: campaign?.callerId,
      },
    });
    const isPredictiveCampaign = isServerDialed(campaign?.dialMethod);

    try {
      if (isPredictiveCampaign) {
        const availabilityResponse = await makeCallQueueAvailable({
          campaign_uuid: _id,
          status: 'On Break',
          state: 'Idle',
        });
        console.log('makeCallQueueAvailable leave response:', availabilityResponse);
      }
    } catch (error) {
      console.error('makeCallQueueAvailable failed while leaving campaign:', error);
    } finally {
      startCampaignClearingTimer();
      setJoinedCampaignId(null);
      setActiveCampaign(null);
      setCampaignContactCards(null);
      setCampaignActionPendingId(null);
    }
  };

  return (
    <>
      <section className="w-full bg-[#F7F9FC] flex flex-col overflow-x-auto overflow-y-hidden h-full">
        <div className="flex items-center justify-between p-4 border-b border-gray-200/90 min-h-[68px] bg-white">
          <div className="flex flex-col">
            <p className="text-gray-900 font-semibold text-lg leading-tight">Campaign Workspace</p>
            <p className="text-xs text-gray-500">
              Running campaigns with quick join and assigned queues.
            </p>
          </div>
        </div>

        <div className="p-3 w-full h-full gap-2 flex flex-col">
          <div className="bg-white w-full rounded-2xl border border-gray-200/90 h-[calc(100vh-11rem)] overflow-hidden flex flex-col">
            <div className="border-b border-gray-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 w-full">
              <div className="sm:px-3 sm:pt-3 sm:pb-2 flex-col sm:flex items-center justify-between gap-3 w-full ">
                <div className="inline-flex items-center sm:rounded-xl bg-gray-100 p-1 gap-1 w-full">
                  <button
                    type="button"
                    onClick={() => setActiveTab('running-campaign')}
                    className={`relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold ${
                      activeTab === 'running-campaign'
                        ? 'bg-white text-slate-900'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Icon name="Grid2" className="w-4 h-4" />
                    <span>Running Campaign</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('assigned-queues')}
                    className={`relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold ${
                      activeTab === 'assigned-queues'
                        ? 'bg-white text-slate-900'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Icon name="CallQueue" className="w-4 h-4" />
                    <span>Assigned Queues</span>
                  </button>
                </div>

                <div />
              </div>
            </div>

            <div className="flex-1 p-3 overflow-hidden">
              {activeTab === 'running-campaign' ? (
                <div className="w-full h-full overflow-y-auto">
                  {isCampaignListLoading ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <Loader variant="blue" />
                    </div>
                  ) : campaignList?.length ? (
                    <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {campaignList.map((campaign: any) => {
                        const isJoined = joinedCampaignId === campaign?._id;
                        const isRefreshingAnalytics = !!refreshingCampaignIds[campaign?._id];
                        const hasJoinedAnotherCampaign =
                          Boolean(joinedCampaignId) && joinedCampaignId !== campaign?._id;
                        const isActionPending = campaignActionPendingId === campaign?._id;
                        const hasActionPending = Boolean(campaignActionPendingId);
                        const hasAnalytics = Boolean(campaignAnalyticsMap[campaign?._id]);
                        const analytics = getCampaignMemberAnalytics(campaign);
                        const assignedLeads = toNumber(analytics?.assignedLeads ?? 0);
                        const connected = toNumber(
                          analytics?.answeredLeads ?? analytics?.connected ?? 0,
                        );
                        const notAnswered = toNumber(
                          analytics?.totalCallNotAnswered ??
                            analytics?.notAnswered ??
                            analytics?.noAnswer ??
                            0,
                        );
                        const pending = toNumber(analytics?.pendingLeads ?? 0);
                        const pendingPercentage = getPercentage(
                          analytics?.pendingPercentage,
                          pending,
                          assignedLeads,
                        );
                        const connectedPercentage = getPercentage(
                          analytics?.answeredPercentage,
                          connected,
                          assignedLeads,
                        );
                        const notAnsweredPercentage = getPercentage(
                          analytics?.notAnsweredPercentage,
                          notAnswered,
                          assignedLeads,
                        );
                        const statusBadge = getStatusBadgeConfig(campaign?.campaignStatus);
                        return (
                          <div
                            key={campaign?._id}
                            className="flex flex-col justify-between min-h-32 group rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-slate-300"
                          >
                            <div className="gap-3  items-start justify-between sm:gap-3 xs:flex-col sm:flex-row flex">
                              <div className="min-w-0 flex-1 sm:mb-0 mb-2">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="text-base font-semibold text-slate-900 truncate">
                                    {campaign?.name || 'Untitled Campaign'}
                                  </p>
                                  <div
                                    className={`px-3 py-1 w-fit whitespace-nowrap  text-center rounded-md text-xs font-medium ${statusBadge.className}`}
                                  >
                                    {statusBadge.label}
                                  </div>
                                  {isJoined && (
                                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-ucass-active-bg text-ucass-active border-ucass-active-bg">
                                      Joined
                                    </span>
                                  )}
                                </div>

                                <p className="text-xs text-slate-500">
                                  {CAMPAIGN_TYPE_NAME[campaign?.dialMethod] ||
                                    campaign?.dialMethod ||
                                    'Preview'}
                                </p>
                              </div>

                              {isJoined ? (
                                <button
                                  onClick={() => handleLeaveCampaign(campaign)}
                                  disabled={hasActionPending}
                                  className="shrink-0 px-4 py-2 rounded-lg border text-sm font-semibold cursor-pointer bg-rose-50 text-rose-700 border-rose-200 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {isActionPending ? 'Leaving...' : 'Leave'}
                                </button>
                              ) : hasJoinedAnotherCampaign ? null : (
                                <button
                                  onClick={() => handleJoinCampaign(campaign)}
                                  disabled={hasActionPending}
                                  className="shrink-0 px-4 py-2 rounded-lg border text-sm font-semibold cursor-pointer bg-emerald-600 text-white border-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {isActionPending ? 'Joining...' : 'Join Campaign'}
                                </button>
                              )}
                            </div>

                            <div className="mt-3 flex flex-col gap-1">
                              <div className="flex items-center min-w-[160px] w-full gap-2">
                                {!hasAnalytics ? (
                                  <div className="flex-1 min-w-[120px]">
                                    <div className="w-full bg-stone-200 rounded-xs h-4 animate-pulse" />
                                  </div>
                                ) : (
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <div className="flex-1 min-w-[120px] cursor-pointer">
                                        <div className="w-full bg-stone-300/50 rounded-xs h-3 relative overflow-hidden flex">
                                          {pendingPercentage > 0 && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <div
                                                  className="h-full bg-slate-400 transition-all duration-300"
                                                  style={{ width: `${pendingPercentage}%` }}
                                                />
                                              </TooltipTrigger>
                                              <TooltipContent side="top">
                                                Pending: {pendingPercentage}%
                                              </TooltipContent>
                                            </Tooltip>
                                          )}
                                          {connectedPercentage > 0 && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <div
                                                  className="h-full bg-green-400 transition-all duration-300"
                                                  style={{ width: `${connectedPercentage}%` }}
                                                />
                                              </TooltipTrigger>
                                              <TooltipContent side="top">
                                                Connected: {connectedPercentage}%
                                              </TooltipContent>
                                            </Tooltip>
                                          )}
                                          {notAnsweredPercentage > 0 && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <div
                                                  className="h-full bg-orange-300 transition-all duration-300"
                                                  style={{ width: `${notAnsweredPercentage}%` }}
                                                />
                                              </TooltipTrigger>
                                              <TooltipContent side="top">
                                                No Answer: {notAnsweredPercentage}%
                                              </TooltipContent>
                                            </Tooltip>
                                          )}
                                        </div>
                                      </div>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-80 p-3">
                                      <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                          <div className="text-sm text-gray-900 font-semibold capitalize">
                                            Dialed In Total
                                          </div>
                                          <div className="min-w-5 min-h-5 px-1.5 py-0.5 text-xs font-medium border border-300/50 bg-stone-100 hover:bg-stone-50 text-slate-500 rounded-sm">
                                            {assignedLeads || 0}
                                          </div>
                                        </div>
                                        <div className="border-t border-stone-300/50 flex flex-col gap-2 pt-2">
                                          <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-1 justify-between">
                                              <span className="text-xs text-slate-500">
                                                Pending
                                              </span>
                                              <div className="flex items-center gap-2 min-w-10">
                                                <span className="text-xs text-slate-500 whitespace-nowrap font-medium text-start">
                                                  {pendingPercentage}%
                                                </span>
                                                <span className="text-xs text-slate-500 whitespace-nowrap">
                                                  |
                                                </span>
                                                <span className="text-xs text-slate-500 whitespace-nowrap font-medium text-start">
                                                  {pending} of {assignedLeads}
                                                </span>
                                              </div>
                                            </div>
                                            <div className="flex gap-2">
                                              <div className="flex-1 min-w-[100px]">
                                                <div className="w-full bg-slate-100 rounded-xs h-4 relative overflow-hidden">
                                                  <div
                                                    className="h-full bg-slate-400 rounded-xs transition-all duration-300 flex items-center justify-center"
                                                    style={{ width: `${pendingPercentage}%` }}
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          </div>

                                          <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-1 justify-between">
                                              <span className="text-xs text-slate-500">
                                                Answered
                                              </span>
                                              <div className="flex items-center gap-2 min-w-10">
                                                <span className="text-xs text-slate-500 whitespace-nowrap font-medium text-start">
                                                  {connectedPercentage}%
                                                </span>
                                                <span className="text-xs text-slate-500 whitespace-nowrap">
                                                  |
                                                </span>
                                                <span className="text-xs text-slate-500 whitespace-nowrap font-medium text-start">
                                                  {connected} of {assignedLeads}
                                                </span>
                                              </div>
                                            </div>
                                            <div className="flex gap-2">
                                              <div className="flex-1 min-w-[100px]">
                                                <div className="w-full bg-green-100 rounded-xs h-4 relative overflow-hidden">
                                                  <div
                                                    className="h-full bg-green-400 rounded-xs transition-all duration-300 flex items-center justify-center"
                                                    style={{ width: `${connectedPercentage}%` }}
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          </div>

                                          <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-1 justify-between">
                                              <span className="text-xs text-slate-500">
                                                No Answer
                                              </span>
                                              <div className="flex items-center gap-2 min-w-10">
                                                <span className="text-xs text-slate-500 whitespace-nowrap font-medium text-start">
                                                  {notAnsweredPercentage}%
                                                </span>
                                                <span className="text-xs text-slate-500 whitespace-nowrap">
                                                  |
                                                </span>
                                                <span className="text-xs text-slate-500 whitespace-nowrap font-medium text-start">
                                                  {notAnswered} of {assignedLeads}
                                                </span>
                                              </div>
                                            </div>
                                            <div className="flex gap-2">
                                              <div className="flex-1 min-w-[100px]">
                                                <div className="w-full bg-orange-100 rounded-xs h-4 relative overflow-hidden">
                                                  <div
                                                    className="h-full bg-orange-300 rounded-xs transition-all duration-300 flex items-center justify-center"
                                                    style={{ width: `${notAnsweredPercentage}%` }}
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                )}
                                <button
                                  type="button"
                                  className="w-6 h-6 rounded-full flex items-center justify-center text-slate-500 hover:text-primary hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={!campaign?._id || isRefreshingAnalytics}
                                  onClick={() => {
                                    if (!campaign?._id || isRefreshingAnalytics) return;
                                    refreshCampaignAnalytics(campaign._id);
                                  }}
                                  title="Refresh analytics"
                                >
                                  {isRefreshingAnalytics ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <RefreshCcw className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="w-full h-full flex justify-center flex-col gap-2 items-center py-10 text-gray-500">
                      <img src={NotFound} alt="BusyImage" className="min-w-36 max-w-36" />
                      <p className="text-gray-900 text-sm whitespace-normal text-center">
                        No campaigns found
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full h-full flex flex-col gap-3 relative">
                  <div className="relative w-full">
                    <Input
                      placeholder="Search assigned queue"
                      className="pl-10 w-full bg-slate-50 border-slate-200 focus-visible:bg-white"
                      IconPosition="left-0 pl-2 inset-y-0"
                      value={queueSearch}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value.startsWith(' ')) return;
                        setQueueSearch(value);
                      }}
                      Icon={<SearchLine className="text-gray-700" />}
                    />
                    {isQueueLoading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader variant="blue" size="sm" />
                      </div>
                    )}
                  </div>

                  <div className="w-full flex-1 overflow-y-auto pr-1">
                    {isQueueError ? (
                      <div className="w-full flex justify-center items-center py-10 text-gray-500">
                        Failed to load call queue data.
                      </div>
                    ) : isQueueLoading ? null : callQueueData?.length ? (
                      <div className="w-full grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                        {callQueueData?.map((queue: any, index: number) => (
                          <div key={queue?.uuid || index}>
                            <CallQueueCard queue={queue} refetch={refetchCallQueue} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="w-full h-full flex justify-center flex-col gap-2 items-center py-10 text-gray-500">
                        <img src={NotFound} alt="BusyImage" className="min-w-36 max-w-36" />
                        <p className="flex items-center justify-center text-gray-900">
                          No call queue found.
                        </p>
                        <p className="text-sm text-gray-700">
                          Call queues assigned to you will appear here.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Dialog
        open={micPermissionDialogOpen}
        onOpenChange={(open) => {
          setMicPermissionDialogOpen(open);
          if (!open) setPendingCampaign(null);
        }}
      >
        <DialogContent
          className="w-[calc(100vw-2rem)] max-w-[520px] gap-0 rounded-xl border border-gray-200 bg-white p-0 shadow-2xl"
          showCloseButton={false}
        >
          <div className="w-full px-5 py-4 sm:px-7 sm:py-6">
            <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
              <h3 className="text-lg font-semibold text-gray-900 sm:text-xl">
                Microphone Permission Required
              </h3>
              <button
                type="button"
                aria-label="Close microphone permission dialog"
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                onClick={() => {
                  setMicPermissionDialogOpen(false);
                  setPendingCampaign(null);
                }}
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="flex flex-col gap-3.5 py-5">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ucass-active-bg text-primary">
                  <Mic className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold leading-6 text-gray-800 sm:text-base">
                  Campaign calling needs microphone access before it can start.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <Info className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold leading-6 text-gray-800 sm:text-base">
                  {micPermissionState === 'denied'
                    ? 'Microphone permission is blocked in browser site settings. Please allow microphone for this site, then continue.'
                    : 'Click Allow Microphone and accept the browser permission prompt to continue.'}
                </p>
              </div>

              {micPermissionMessage ? (
                <div className="flex items-start gap-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                    <AlertTriangle className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-semibold leading-6 text-red-700">
                    {micPermissionMessage}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMicPermissionDialogOpen(false);
                  setPendingCampaign(null);
                }}
                className="h-12 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleMicPermissionConfirm()}
                className="h-12 rounded-xl"
              >
                {micPermissionState === 'denied' ? 'I Enabled Microphone' : 'Allow Microphone'}
                <Mic className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default MyCampaignListStandalone;
