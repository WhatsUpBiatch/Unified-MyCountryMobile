import { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import moment from 'moment';

import TableManager from '@/components/custom/table-manager';
import SideDrawer from '@/components/custom/side-drawer';
import AlertConfirm from '@/components/custom/alert-confirm';
import CustomTooltip from '@/components/custom/custom-tooltip';
import { Ic, McmIconSprite } from '@/components/mcm/icons';
import { capitalizeFirstLetter, convertDateFormateApis, handleAlert } from '@/lib/utils';
import { campaignAnalytics, campaignList, deleteCampaign, playPauseCampaign } from '@/services/api';
import { useCompanyFeatures } from '@/hooks/rbac';
import useDebounce from '@/hooks/use-debounce';
import { SocketEvents } from '@/context/socket-events-context';
import { HEALTH_LABEL } from '@/lib/campaign-dial-mode';
import type { IAutoDialer } from '../power-predictive/campaign-list';

import AddEditCampaign from './add-edit-campaign';
import AgentDetailsModal from './modal/agent-details-modal';
import { DIALER_TYPE } from './add-edit-campaign/consts';
import {
  DIAL_METHOD_LABEL,
  OutcomeBar,
  OutcomeLegend,
  StatusPill,
  fmt,
  num,
  pct,
  readOutcomes,
} from './campaign-ui';
import '@/components/mcm/mcm-page.css';
import './campaign.css';

/**
 * MCM Unified Console — Campaigns.
 *
 * Ported from the design artifact's outbound module. The artifact's argument
 * is that a campaign row is an object you operate, not a record you read: the
 * four contact outcomes sit on every row rather than behind a popover, and the
 * transport controls are on the row itself.
 *
 * Every figure comes from `campaignAnalytics`, which is what the platform
 * actually measures today. The artifact also showed pacing — abandon rate
 * against a compliance cap, idle and effective-idle agents, outbound line
 * allocation, adjusted calls per agent. None of those exist in any current
 * endpoint, so they are not drawn here; the panel footer says so rather than
 * showing a plausible number nobody computed.
 */

export interface ModalState {
  open: boolean;
  data: any[];
  type: string | null;
}

const STATUS_FILTERS: Array<[string, string]> = [
  ['ALL', 'All'],
  ['PROCESSING', 'Running'],
  ['PAUSE', 'Paused'],
  ['NEW', 'Scheduled'],
  ['COMPLETED', 'Completed'],
];

const MODE_FILTERS: Array<[string, string]> = [
  ['ALL', 'All modes'],
  [DIALER_TYPE.PREVIEW, 'Preview'],
  [DIALER_TYPE.NORMAL, 'Progressive'],
  [DIALER_TYPE.PREDICTIVE, 'Predictive'],
];

/**
 * `embedded` is set when Performance -> Campaigns renders this list beneath its
 * own stat cards. In that case the page title and the KPI strip would be a
 * second header and a second set of totals on the same screen, so both are
 * dropped and the frame stops claiming full height.
 */
const Campaign = ({ embedded = false }: { embedded?: boolean }) => {
  const navigate = useNavigate();
  const queryClient: any = useQueryClient();
  const { features } = useCompanyFeatures();
  const campaignAccess = features?.plan_features?.campaign?.action;

  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [modeFilter, setModeFilter] = useState<string>('ALL');
  const debouncedSearch = useDebounce(search, 1000);

  const [modalState, setModalState] = useState<ModalState>({ open: false, type: null, data: [] });
  const [drawerState, setDrawerState] = useState<{ isModalOpen: boolean; selectedCampaign: any }>({
    isModalOpen: false,
    selectedCampaign: null,
  });
  const [refreshingCampaignIds, setRefreshingCampaignIds] = useState<Record<string, boolean>>({});
  const { socketEventsManager } = useContext(SocketEvents);
  /* The dialer service pushes a board per running campaign every few seconds
     on "campaign-live-stats". Kept here by campaign id so each row can show
     what it is doing right now; a board older than 30 s is treated as gone. */
  const [liveBoards, setLiveBoards] = useState<Record<string, { board: any; at: number }>>({});
  useEffect(() => {
    if (!socketEventsManager) return;
    const onLive = (payload: any) => {
      const id = String(payload?.campaignId || '');
      if (!id) return;
      setLiveBoards((prev) => ({ ...prev, [id]: { board: payload, at: Date.now() } }));
    };
    const onState = () => {
      queryClient.invalidateQueries({ queryKey: ['getCampaignListForPreview'] });
      queryClient.invalidateQueries({ queryKey: ['campaignListForKpis'] });
    };
    const onAnalytics = (payload: any) => {
      const id = String(payload?.campaignId || '');
      if (id) mutateCampaignAnalytics({ campaignId: id });
    };
    socketEventsManager.on('campaign-live-stats', onLive);
    socketEventsManager.on('campaign-state-update', onState);
    socketEventsManager.on('campaign-analytics-updated', onAnalytics);
    return () => {
      socketEventsManager.off('campaign-live-stats', onLive);
      socketEventsManager.off('campaign-state-update', onState);
      socketEventsManager.off('campaign-analytics-updated', onAnalytics);
    };
  }, [socketEventsManager]);
  const liveBoardFor = (id: string) => {
    const entry = liveBoards[String(id)];
    return entry && Date.now() - entry.at < 30000 ? entry.board : null;
  };
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState<IAutoDialer | null>(null);

  /* ── aggregates for the KPI strip ────────────────────────────────────
     The table is paginated, so totals cannot come from the visible page.
     This pulls the campaign set once and counts it, the same way the
     inventory pages pull their full list for a summary. */
  const { data: allCampaigns = [], isLoading: isLoadingKpis } = useQuery({
    queryKey: ['campaignListForKpis'],
    enabled: !embedded,
    queryFn: () =>
      campaignList({ page: 1, limit: 500, filters: [], sort: { key: 'createdAt', desc: true } }),
    select: (data: any) => data?.data?.data?.result?.rows || [],
    refetchOnWindowFocus: false,
  });

  const kpis = useMemo(() => {
    const rows: any[] = Array.isArray(allCampaigns) ? allCampaigns : [];
    const byStatus = (status: string) =>
      rows.filter((r) => String(r?.campaignStatus).toUpperCase() === status).length;

    const totals = rows.reduce(
      (acc, row) => {
        const o = readOutcomes(row?.campaignAnalytics);
        acc.assigned += o.assigned;
        acc.answered += o.answered;
        acc.noAnswer += o.noAnswer;
        acc.dnc += o.dnc;
        acc.pending += o.pending;
        acc.dialed += o.dialed;
        return acc;
      },
      { assigned: 0, answered: 0, noAnswer: 0, dnc: 0, pending: 0, dialed: 0 },
    );

    return {
      total: rows.length,
      running: byStatus('PROCESSING'),
      paused: byStatus('PAUSE'),
      scheduled: byStatus('NEW'),
      completed: byStatus('COMPLETED'),
      ...totals,
    };
  }, [allCampaigns]);

  /* ── mutations ────────────────────────────────────────────────────── */
  const invalidateCampaigns = () => {
    queryClient.invalidateQueries(['getCampaignList']);
    queryClient.invalidateQueries({ queryKey: ['getCampaignListForPreview'] });
    queryClient.invalidateQueries({ queryKey: ['campaignListForKpis'] });
  };

  const { mutate: mutateStatus } = useMutation({
    mutationFn: playPauseCampaign,
    onSuccess: (data: any, variables: any) => {
      if (data?.status !== 200) return;
      invalidateCampaigns();
      if (variables?.campaignStatus === 'RESCHEDULED') {
        handleAlert({ text: 'Campaign has been rescheduled successfully', type: 'success' });
      }
    },
  });

  const { mutate: mutateDeleteCampaign, isPending: isPendingDeleteCampaign } = useMutation({
    mutationFn: deleteCampaign,
    onSuccess: (data: any) => {
      if (!data?.data?.success) return;
      handleAlert({
        text: data?.data?.message || 'Campaign Deleted Successfully!',
        type: 'success',
      });
      setShowDeleteConfirmation(null);
      invalidateCampaigns();
    },
  });

  const { mutate: mutateCampaignAnalytics } = useMutation({
    mutationFn: campaignAnalytics,
    onSuccess: (response: any, variables: any) => {
      const analytics = response?.data?.data?.result;
      const campaignId = variables?.campaignId;
      if (!analytics || !campaignId) return;

      queryClient.setQueriesData({ queryKey: ['getCampaignListForPreview'] }, (oldData: any) => {
        const existing = oldData?.data?.data?.result;
        if (!existing) return oldData;
        const rows = Array.isArray(existing?.rows) ? existing.rows : [];
        return {
          ...oldData,
          data: {
            ...oldData.data,
            data: {
              ...oldData.data.data,
              result: {
                ...existing,
                rows: rows.map((c: any) =>
                  c?._id === campaignId ? { ...c, campaignAnalytics: analytics } : c,
                ),
              },
            },
          },
        };
      });
    },
    onSettled: (_data, _error, variables: any) => {
      const campaignId = variables?.campaignId;
      if (campaignId) setRefreshingCampaignIds((prev) => ({ ...prev, [campaignId]: false }));
    },
  });

  /* ── row actions ──────────────────────────────────────────────────── */
  const onPlayPause = (data: any) =>
    mutateStatus({
      campaignId: data?._id,
      campaignStatus: data?.campaignStatus === 'PROCESSING' ? 'PAUSE' : 'PROCESSING',
    });

  const onReSchedule = (data: any) =>
    mutateStatus({ campaignId: data?._id, campaignStatus: 'RESCHEDULED' });

  const handleNavigateToCallLogs = (type: string, data: any) =>
    navigate('/campaign/all-campaigns/compaign-call-logs', { state: { type, data } });

  const openMonitor = (data: any) =>
    navigate('/campaign/all-campaigns/compaign-record', {
      state: { campaignDetails: data, campaignId: data?._id },
    });

  /* ── columns ──────────────────────────────────────────────────────── */
  const columns: any = [
    {
      header: 'Status',
      accessorKey: 'campaignStatus',
      cell: ({ row }: any) => {
        const board = liveBoardFor(row?.original?._id);
        const health = board?.health?.state ? HEALTH_LABEL[board.health.state] : null;
        if (!board || !health) return <StatusPill status={row?.original?.campaignStatus} />;
        const tone = health.tone === 'good' ? 'pos' : health.tone === 'crit' ? 'neg' : health.tone === 'warn' ? 'warn' : 'neu';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            <span className={`tag ${tone}`} title={board?.health?.reason || ''}>
              {health.tone === 'good' ? <span className="dot green" /> : null}
              {health.label}
            </span>
            <span className="src num">
              {num(board?.calls?.linesInUse)} call{num(board?.calls?.linesInUse) === 1 ? '' : 's'} up ·{' '}
              {num(board?.agents?.idle)} idle of {num(board?.agents?.total)}
            </span>
          </div>
        );
      },
    },
    {
      header: 'Campaign',
      accessorKey: 'name',
      cell: ({ row }: any) => {
        const data = row?.original || {};
        const mode = DIAL_METHOD_LABEL[data?.dialMethod];
        return (
          <div style={{ minWidth: 0 }}>
            <div className="cname" title={capitalizeFirstLetter(data?.name)}>
              {capitalizeFirstLetter(data?.name)}
            </div>
            <div className="cmeta">
              {mode ? <span className="tag neu">{mode}</span> : null}
              {data?.createdAt ? (
                <>
                  <span className="sl">•</span>
                  <span>created {convertDateFormateApis(data.createdAt, 'DD MMM YYYY')}</span>
                </>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      header: 'Window',
      accessorKey: 'startDate',
      cell: ({ row }: any) => {
        const data = row?.original || {};
        if (!data?.startDate && !data?.endDate) {
          return <span style={{ color: 'var(--ink-4)' }}>—</span>;
        }
        return (
          <div className="num" style={{ fontWeight: 700 }}>
            {convertDateFormateApis(data?.startDate, 'DD MMM')} –{' '}
            {convertDateFormateApis(data?.endDate, 'DD MMM')}
          </div>
        );
      },
    },
    {
      header: 'Leads',
      accessorKey: 'totalCount',
      cell: ({ row }: any) => {
        const count = num(row?.original?.campaignAnalytics?.assignedLeads);
        if (!count) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
        return (
          <button
            type="button"
            className="lnk num"
            style={{ fontWeight: 800 }}
            onClick={(event) => {
              event.stopPropagation();
              handleNavigateToCallLogs('ALL', row?.original);
            }}
          >
            {fmt(count)}
          </button>
        );
      },
    },
    {
      header: 'Contact outcomes',
      accessorKey: 'campaignAnalytics',
      enableSorting: false,
      cell: ({ row }: any) => {
        const data = row?.original || {};
        const campaignId = data?._id;
        const isRefreshing = !!refreshingCampaignIds[campaignId];
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 170 }}>
            <div style={{ flex: 1, minWidth: 110 }}>
              <OutcomeBar analytics={data?.campaignAnalytics} />
            </div>
            <CustomTooltip text="Refresh analytics" side="top">
              <button
                type="button"
                className="mini ic"
                disabled={isRefreshing || !campaignId}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!campaignId || isRefreshing) return;
                  setRefreshingCampaignIds((prev) => ({ ...prev, [campaignId]: true }));
                  mutateCampaignAnalytics({ campaignId });
                }}
              >
                <Ic n="refresh" size={12} className={isRefreshing ? 'pulsing' : ''} />
              </button>
            </CustomTooltip>
          </div>
        );
      },
    },
    {
      header: 'Answered',
      accessorKey: 'answeredPercentage',
      enableSorting: false,
      cell: ({ row }: any) => {
        const { answered, dialed } = readOutcomes(row?.original?.campaignAnalytics);
        if (!dialed) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
        return (
          <button
            type="button"
            className="lnk num"
            style={{ fontWeight: 800, fontSize: 13 }}
            onClick={(event) => {
              event.stopPropagation();
              handleNavigateToCallLogs('COMPLETED', row?.original);
            }}
          >
            {pct(answered, dialed)}%
          </button>
        );
      },
    },
    {
      header: 'Agents',
      accessorKey: 'members',
      cell: ({ getValue }: any) => {
        let members: any[] = [];
        try {
          const raw = getValue();
          const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
          members = Array.isArray(parsed)
            ? Array.from(new Map(parsed.map((item: any) => [item?.user_uuid, item])).values())
            : [];
        } catch {
          members = [];
        }

        if (!members.length) return <span style={{ color: 'var(--ink-4)' }}>Unassigned</span>;

        return (
          <CustomTooltip
            side="top"
            className="max-w-xs"
            text={
              <div className="flex flex-col gap-1 max-w-xs">
                <div className="font-semibold text-sm mb-1">
                  {members.length} {members.length === 1 ? 'member' : 'members'}
                </div>
                <div className="text-xs max-h-40 overflow-y-auto">
                  {members.map((item: any, index: number) => (
                    <div key={index} className="py-1 border-b border-gray-300 last:border-0">
                      {item?.label ||
                        `${item?.first_name || ''} ${item?.last_name || ''}`.trim() ||
                        'Unknown'}
                    </div>
                  ))}
                </div>
              </div>
            }
          >
            <button
              type="button"
              className="lnk num"
              style={{ fontWeight: 800 }}
              onClick={(event) => {
                event.stopPropagation();
                setModalState({ open: true, type: 'members', data: members });
              }}
            >
              {members.length}
            </button>
          </CustomTooltip>
        );
      },
    },
    {
      header: '',
      accessorKey: 'action',
      enableSorting: false,
      cell: ({ row }: any) => {
        const data = row?.original || {};
        const now = moment();
        const start = data?.startDate ? moment.utc(data.startDate).local() : null;
        const end = data?.endDate ? moment.utc(data.endDate).local() : null;
        const outOfWindow =
          data?.campaignStatus === 'COMPLETED' ||
          (!!start && now.isBefore(start, 'day')) ||
          (!!end && now.isAfter(end, 'day'));
        const isExpired = !!(end && now.isAfter(end, 'day'));
        const canReschedule = data?.campaignStatus !== 'COMPLETED' && isExpired;
        const isRunning = data?.campaignStatus === 'PROCESSING';

        return (
          <div className="rowacts" onClick={(event) => event.stopPropagation()}>
            {campaignAccess?.pause && (
              <CustomTooltip text={isRunning ? 'Pause campaign' : 'Start campaign'} side="top">
                <button
                  type="button"
                  className="mini ic"
                  disabled={outOfWindow}
                  onClick={() => !outOfWindow && onPlayPause(data)}
                >
                  <Ic n={isRunning ? 'pause' : 'play'} size={12} />
                </button>
              </CustomTooltip>
            )}
            {campaignAccess?.summary && (
              <CustomTooltip text="Open live monitor" side="top">
                <button type="button" className="mini ic" onClick={() => openMonitor(data)}>
                  <Ic n="eye" size={12} />
                </button>
              </CustomTooltip>
            )}
            {campaignAccess?.pause && (
              <CustomTooltip text="Reschedule campaign" side="top">
                <button
                  type="button"
                  className="mini ic"
                  disabled={!canReschedule}
                  onClick={() => canReschedule && onReSchedule(data)}
                >
                  <Ic n="cal" size={12} />
                </button>
              </CustomTooltip>
            )}
            {campaignAccess?.edit && (
              <CustomTooltip text="Edit campaign" side="top">
                <button
                  type="button"
                  className="mini ic"
                  disabled={isRunning || outOfWindow}
                  onClick={() => {
                    if (isRunning || outOfWindow) return;
                    setDrawerState({ selectedCampaign: data, isModalOpen: true });
                  }}
                >
                  <Ic n="sliders" size={12} />
                </button>
              </CustomTooltip>
            )}
            {campaignAccess?.delete && (
              <CustomTooltip text="Delete campaign" side="top">
                <button
                  type="button"
                  className="mini ic"
                  disabled={isRunning}
                  onClick={() => !isRunning && setShowDeleteConfirmation(data)}
                >
                  <Ic n="trash" size={12} />
                </button>
              </CustomTooltip>
            )}
          </div>
        );
      },
    },
  ];

  const KPI_CARDS = [
    {
      key: 'live',
      label: 'Live campaigns',
      value: (
        <>
          {kpis.running}
          <small> / {kpis.total}</small>
        </>
      ),
      sub: `${kpis.paused} paused · ${kpis.scheduled} scheduled`,
    },
    {
      key: 'leads',
      label: 'Leads assigned',
      value: fmt(kpis.assigned),
      sub: `${fmt(kpis.pending)} still callable`,
    },
    {
      key: 'dialed',
      label: 'Dialled',
      value: fmt(kpis.dialed),
      sub: `${pct(kpis.dialed, kpis.assigned)}% of assigned`,
    },
    {
      key: 'answered',
      label: 'Answered',
      value: `${pct(kpis.answered, kpis.dialed)}%`,
      sub: `${fmt(kpis.answered)} connects`,
      tone: 'good' as const,
    },
    {
      key: 'noanswer',
      label: 'No answer',
      value: `${pct(kpis.noAnswer, kpis.dialed)}%`,
      sub: fmt(kpis.noAnswer),
    },
    {
      key: 'dnc',
      label: 'DNC / blocked',
      value: `${pct(kpis.dnc, kpis.dialed)}%`,
      sub: fmt(kpis.dnc),
      tone: kpis.dnc > 0 ? ('warnv' as const) : undefined,
    },
  ];

  return (
    <div className={`mcm-page cmp${embedded ? ' embedded' : ''}`}>
      <McmIconSprite />
      <div className="page">
        {!embedded && (
          <div className="page-head">
            <div>
              <div className="eyebrow">Campaign · Outbound</div>
              <h1>Campaigns</h1>
              <p>
                Every outbound calling campaign, with its contact outcomes and agent load on one
                line. Open a campaign to watch it dial.
              </p>
            </div>
            <button className="btn ghost" type="button" onClick={() => navigate('/campaign/leads')}>
              <Ic n="users" />
              Lead groups
            </button>
            {campaignAccess?.add && (
              <button
                className="btn primary"
                type="button"
                onClick={() => setDrawerState({ selectedCampaign: null, isModalOpen: true })}
              >
                <Ic n="plus" />
                New campaign
              </button>
            )}
          </div>
        )}

        {!embedded && (
          <div className="kpis">
            {KPI_CARDS.map((kpi) => (
              <div className="kpi" key={kpi.key}>
                <div className="k">{kpi.label}</div>
                <div className={`v num${kpi.tone ? ` ${kpi.tone}` : ''}`}>
                  {isLoadingKpis ? (
                    <span className="skel" style={{ display: 'block', width: 62, height: 24 }} />
                  ) : (
                    kpi.value
                  )}
                </div>
                <div className="d">{kpi.sub}</div>
              </div>
            ))}
          </div>
        )}

        <div className="tbar">
          <div className="cmp-search">
            <Ic n="search" />
            <input
              placeholder="Search campaigns"
              aria-label="Search campaigns"
              value={search}
              maxLength={50}
              onChange={(event) => {
                const value = event.target.value;
                if (value.startsWith(' ')) return;
                setSearch(value);
              }}
            />
          </div>

          {STATUS_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`fchip${statusFilter === value ? ' on' : ''}`}
              onClick={() => setStatusFilter(value)}
            >
              {value === 'PROCESSING' ? <span className="dot green" /> : null}
              {label}
            </button>
          ))}

          <span style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 3px' }} />

          {MODE_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`fchip${modeFilter === value ? ' on' : ''}`}
              onClick={() => setModeFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="panel-card">
          <div className="pc-head">
            <h3>All campaigns</h3>
            {Object.keys(liveBoards).length ? (
              <span className="src live pc-right">
                <Ic n="spark" size={10} />
                live
              </span>
            ) : (
              <span className="src pc-right">refreshes on change</span>
            )}
          </div>

          <TableManager
            {...{
              columns,
              fetcherKey: 'getCampaignListForPreview',
              fetcherFn: campaignList,
              emptyTablePlaceholder: 'No campaigns found',
              descriptionEmptyTable: 'Create a campaign to start dialling',
              getRowClassName: () => 'rowlink',
              extraParams: {
                ...(debouncedSearch ? { search: debouncedSearch } : {}),
                filters: [
                  ...(modeFilter !== 'ALL' ? [{ key: 'dialMethod', value: modeFilter }] : []),
                  ...(statusFilter !== 'ALL'
                    ? [{ key: 'campaignStatus', value: statusFilter }]
                    : []),
                ],
                sort: { key: 'createdAt', desc: true },
              },
              customClass: 'w-full',
            }}
          />

          <div className="pc-foot">
            <OutcomeLegend />
            <span className="pc-right">
              Running campaigns show what is holding them back and how many calls are up. Open one
              for the live board.
            </span>
          </div>
        </div>
      </div>

      {drawerState?.isModalOpen && (
        <SideDrawer
          isOpen={drawerState?.isModalOpen}
          title={
            drawerState?.selectedCampaign
              ? `Update (${drawerState?.selectedCampaign?.name})`
              : 'Add Campaign'
          }
          isTab={false}
          enableResponsive
          headerClassName="min-h-8 px-4 sm:px-5"
          handleClose={() => setDrawerState({ selectedCampaign: null, isModalOpen: false })}
          content={
            <div className="h-full">
              <div className="h-full sm:min-w-[640px] md:min-w-0">
                <AddEditCampaign
                  drawerState={drawerState?.isModalOpen}
                  setDrawerState={() =>
                    setDrawerState({ selectedCampaign: null, isModalOpen: false })
                  }
                  selectedCampaign={drawerState?.selectedCampaign}
                />
              </div>
            </div>
          }
        />
      )}

      {modalState?.open && (
        <AgentDetailsModal modalState={modalState} setModalState={setModalState} />
      )}

      {!!showDeleteConfirmation && (
        <AlertConfirm
          {...{
            apiLoading: isPendingDeleteCampaign,
            onConfirm: () => mutateDeleteCampaign(showDeleteConfirmation?._id),
            open: !!showDeleteConfirmation,
            setOpen: () => setShowDeleteConfirmation(null),
          }}
        />
      )}
    </div>
  );
};

export default Campaign;
