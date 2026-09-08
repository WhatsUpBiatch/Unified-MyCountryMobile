import CustomSelect from '@/components/custom/custom-select';
import TableManager from '@/components/custom/table-manager';
import { AdminPage } from '@/pages/admin-settings/page-shell';
import { useGetSite } from '@/hooks/common';
import { ISELECTVALUE } from '@/interfaces/api-interfaces';
import { convertDateFormateApis, getInitials, handleAlert } from '@/lib/utils';
import { callQueueList, deleteCallQueue } from '@/services/api';
import { ColumnDef } from '@tanstack/react-table';
import { FC, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import AddCallQueue from './add-edit-call-queue';
import { QUEUES_PATH, QUEUE_DEFAULT_TAB } from './queue-tabs';
import { CALL_DISTRIBUTION_DATA } from './constant';
import { useQuery } from '@tanstack/react-query';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { allNumbersList } from '@/services/api';
import { poolSummary } from '@/lib/queue-numbers';
import NumberWithFlag from '@/components/custom/number-with-flag';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AlertConfirm from '@/components/custom/alert-confirm';
import { Plus } from '@/assets/icons';
import SideDrawer from '@/components/custom/side-drawer';
import CustomTooltip from '@/components/custom/custom-tooltip';
import { Icon, IconName } from '@/assets/icons/icon';
import { Input } from '@/components/ui/input';
import useDebounce from '@/hooks/use-debounce';
import { useCompanyFeatures } from '@/hooks/rbac';
import AgentDetailsModal from '@/pages/auto-dialer/campaign/modal/agent-details-modal';
import { ModalState } from '@/pages/auto-dialer/campaign';

interface ICALLQUEUE {
  created_at: string;
  name: string;
  extension: string;
  _id: string;
  site: {
    name: string;
  };
  settings: {
    operational_hours: {
      type: string;
    };
  };
}

/* A queue row carries its settings as either an object or a JSON string,
   depending on the endpoint that produced it — the members column already has
   to cope with the same thing. Reading it in one place means a change of shape
   breaks one function rather than every column that touches it. */
const readQueueSettings = (row: any): any => {
  const raw = row?.settings;
  if (!raw) return {};
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
};

const CallQueues: FC = () => {
  const { data: dataSiteList = [] } = useGetSite();
  const [searchedText, setSearchedText] = useState('');
  const [selectedSite, setSelectedSite] = useState<any>('');
  /* The open queue and the open tab both come from the URL rather than from
     state, so a queue can be linked in a ticket, survives a reload, and the back
     button steps through the editor instead of leaving the page. `/new` opens
     the create panel; `/:queueId/:tab` opens that queue on that tab. */
  const navigate = useNavigate();
  const { queueId, tab: tabSlug } = useParams();
  const { pathname } = useLocation();
  const isCreating = pathname === `${QUEUES_PATH}/new`;
  const drawerState = Boolean(queueId) || isCreating;

  /* Kept only so the drawer heading can show the queue's name when the row was
     clicked. A queue opened from a pasted link has no row yet, and the editor
     loads its own detail from the id, so this is a nicety and never a
     dependency. */
  const [clickedRow, setClickedRow] = useState<any>(null);
  const selectedCallQueue = queueId ? { ...(clickedRow || {}), _id: queueId } : null;

  const openQueue = (row: any) => {
    setClickedRow(row);
    navigate(`${QUEUES_PATH}/${row?._id}/${QUEUE_DEFAULT_TAB.slug}`);
  };
  const closeQueue = () => {
    setClickedRow(null);
    navigate(QUEUES_PATH);
  };
  const [deleteCallQueueDetails, setDeleteCallQueue] = useState<ICALLQUEUE | null>(null);
  const queryClient: any = useQueryClient();
  const debouncedSearch = useDebounce(searchedText || '', 1000);
  const { features } = useCompanyFeatures();

  /* Every number the company owns, so the list can show which ones ring each
     queue. Same key and endpoint the numbers screens use, so this shares their
     cache rather than fetching a second copy. */
  const { data: allNumbers = [] } = useQuery({
    queryKey: ['numbersByLine'],
    queryFn: () => fetchAllPages(allNumbersList),
    staleTime: 60 * 1000,
  });
  const phoneSystem = features?.plan_features?.phone_system_action;

  const hasQueueAccess = Boolean(phoneSystem?.access?.QUEUE);
  const queueActions = phoneSystem?.action;

  const [modalState, setModalState] = useState<ModalState>({
    open: false,
    type: null,
    data: [],
  });
  const { mutate: mutateDeleteCallQueue, isPending: isPendingDeleteCallQueue } = useMutation({
    mutationFn: deleteCallQueue,
    onSuccess: (data) => {
      if (data?.data?.success) {
        queryClient.invalidateQueries(['callQueueListQueryFn'], { exact: true });
        handleAlert({
          text: data?.data?.message || 'Call Queue Deleted Successfully!',
          type: 'success',
        });
        setDeleteCallQueue(null);
      }
    },
  });

  const columns: ColumnDef<ICALLQUEUE>[] = [
    {
      /* Name leads. The list used to open on the date a queue was created,
         which is the least useful thing about it — an admin scanning twenty
         queues is looking for one by name, then wants to know how it routes and
         when it is open. Date moved to the end rather than being dropped, since
         it is occasionally used to find a queue somebody made last week. */
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) => {
        const name = row?.original?.name;
        return (
          <div className="flex flex-col gap-1.5">
            <span>{name}</span>
          </div>
        );
      },
    },
    {
      header: 'Site',
      accessorKey: 'site_uuid',
      cell: ({ row }: any) => <> {row?.original?.site_uuid?.name || ''}</>,
    },
    {
      header: 'Extension',
      accessorKey: 'extension',
    },
    {
      /* Which outside numbers reach this queue. A queue does not store them -
         each number stores where it forwards - so this is that relationship
         read backwards. Without it, "no caller can reach this queue" and "this
         queue is busy" looked identical from the list. */
      header: 'Numbers',
      accessorKey: 'did_numbers',
      cell: ({ row }: any) => {
        const pool = poolSummary(allNumbers, row?.original?._id);
        if (!pool.count) {
          return <span className="text-amber-700">No number</span>;
        }
        return (
          <span className="flex flex-wrap items-center gap-1">
            <NumberWithFlag number={pool.primary} />
            {pool.count > 1 && (
              <span className="text-gray-500">+{pool.count - 1}</span>
            )}
          </span>
        );
      },
    },
    {
      /* How calls are shared out. This was invisible from the list, so telling
         a ring-all queue from a top-down one meant opening each in turn. */
      header: 'How calls are shared',
      accessorKey: 'ring_strategy',
      cell: ({ row }: any) => {
        const strategy = readQueueSettings(row?.original)?.ring_strategy?.value;
        const label = CALL_DISTRIBUTION_DATA.find((item) => item.value === strategy)?.label;
        return <span>{label || '---'}</span>;
      },
    },
    {
      header: 'Hours',
      accessorKey: 'operational_hours',
      cell: ({ row }: any) => {
        const type = readQueueSettings(row?.original)?.operational_hours?.type;
        if (type === '24_hours') return <span>Open 24 hours</span>;
        if (type === 'weekly') return <span>Set per weekday</span>;
        return <span className="text-gray-500">Not set</span>;
      },
    },
    {
      header: 'Members',
      accessorKey: 'members',
      cell: ({ getValue }: any) => {
        let members = [];
        try {
          const parsed =
            typeof getValue() === 'string' ? JSON.parse(getValue() || '[]') : getValue();
          members = Array.isArray(parsed)
            ? Array.from(new Map(parsed.map((item: any) => [item.user_uuid, item])).values())
            : [];
        } catch (error) {
          console.error('Error parsing members JSON:', error);
        }
        if (!members.length) {
          /* An empty array is still an array, so the stack below drew nothing
             at all and the cell read as missing data rather than as a queue
             with nobody in it — which is the one state worth spotting here. */
          return <span className="mcm-ident-gap">Nobody yet</span>;
        }

        return Array.isArray(members) ? (
          <div className="flex -space-x-2">
            {members.slice(0, 5).map((item: any, index: number) => {
              const username = item?.name || 'Unknown';
              const imageUrl = item?.imageUrl || '';
              return (
                <CustomTooltip text={username} side="top">
                  <div
                    key={index}
                    className="w-9 h-9 flex items-center justify-center border border-white rounded-full bg-gray-200 dark:border-gray-800 capitalizes cursor-pointer"
                  >
                    {imageUrl ? (
                      <img
                        className="w-9 h-9 rounded-full"
                        src={imageUrl}
                        alt={username}
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center rounded-full border border-gray-400 bg-gray-100 text-gray-600 text-xs capitalize">
                        {getInitials(username)}
                      </div>
                    )}
                  </div>
                </CustomTooltip>
              );
            })}
            {members?.length > 5 && (
              <div
                onClick={() => {
                  setModalState({ open: true, data: members || [], type: 'Total Members' });
                }}
                className="w-9 h-9 flex items-center justify-center border border-gray-500 !space-x-10 rounded-full bg-gray-500 text-white font-medium cursor-pointer"
              >
                +{members?.length - 5}
              </div>
            )}
          </div>
        ) : (
          <span className="mcm-numnone">Nobody yet</span>
        );
      },
    },
    {
      header: 'Created',
      accessorKey: 'created_at',
      cell: ({ row }) => {
        const data = row?.original;
        return <div>{convertDateFormateApis(data?.created_at, 'LL')}</div>;
      },
    },
    {
      header: 'Actions',
      accessorKey: 'action',
      cell: ({ row }) => {
        const data = row?.original;
        const actions = [
          hasQueueAccess &&
            queueActions?.edit && {
              icon: 'EditStrokIcon',
              onClick: () => openQueue(data),
              className: 'bg-gray-100 text-gray-900/80 hover:bg-primary hover:text-white',
              tooltipText: 'Edit',
            },
          hasQueueAccess &&
            queueActions?.delete && {
              icon: 'TrashBin',
              onClick: () => setDeleteCallQueue(row?.original),
              className: 'bg-red-100 text-red-500 hover:bg-red-500 hover:text-white',
              tooltipText: 'Delete',
            },
        ].filter(Boolean);

        if (!actions.length) return '---';

        return (
          <div className="flex items-center gap-2">
            {actions?.map((action, index) => (
              <CustomTooltip text={action.tooltipText} side="top">
                <div
                  key={index}
                  className={`cursor-pointer flex items-center justify-center rounded-full w-8 h-8 ${action.className}`}
                  onClick={() => {
                    action.onClick();
                  }}
                >
                  <Icon name={action.icon as IconName} className="w-5 h-5" />
                </div>
              </CustomTooltip>
            ))}
          </div>
        );
      },
    },
  ];

  /* The remembered row is cleared when the editor closes, so reopening a
     different queue never shows the previous queue's name in the heading. */
  useEffect(() => {
    if (!drawerState) setClickedRow(null);
  }, [drawerState]);

  return (
    <>
      <AdminPage
        section="Phone System"
        title="Call queues"
        description="Where incoming calls wait, and which people answer them. Queues can be company-wide or tied to one location."
        actions={
          hasQueueAccess && queueActions?.add ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => navigate(`${QUEUES_PATH}/new`)}
            >
              <Plus className="w-3 h-3" />
              New queue
            </button>
          ) : null
        }
        filters={
          <>
            <Input
              type="search"
              placeholder="Search queues"
              onChange={(e) => {
                const value = e.target.value;
                if (value.startsWith(' ')) return;
                setSearchedText(e.target.value);
              }}
              className="w-full min-h-9 rounded-lg"
            />
            <CustomSelect
              className="w-full min-w-36"
              placeholder="All locations"
              isClearable
              options={
                dataSiteList?.map((site: { name: string; uuid: string }) => ({
                  label: site?.name,
                  value: site?.uuid,
                })) || []
              }
              handleChange={(e: ISELECTVALUE | null) => {
                setSelectedSite(e || '');
              }}
              value={selectedSite}
            />
          </>
        }
      >
        {/* The paragraph that used to sit here said, at greater length, what
            the page description above already says: that a queue holds callers
            and can belong to the company or to one location. Two explanations
            of the same thing, stacked, and the second one styled as a notice —
            which is a shape that should be reserved for something a reader
            does not already know. */}
        <div className="flex flex-col gap-2">
          <TableManager
            {...{
              columns,
              fetcherKey: 'callQueueListQueryFn',
              fetcherFn: callQueueList,
              extraParams: {
                filters: [
                  {
                    key: 'name',
                    value: debouncedSearch,
                  },
                  {
                    key: 'site_uuid',
                    value: selectedSite.value || '',
                  },
                ],
              },
            }}
          />
        </div>
      </AdminPage>

      {drawerState && (
        <SideDrawer
          width="min(1040px, 84vw)"
          isOpen={drawerState}
          title={
            selectedCallQueue
              ? `Update Call Queue${selectedCallQueue?.name ? ` (${selectedCallQueue.name})` : ''}`
              : 'Add Call Queue'
          }
          isTab={false}
          enableResponsive
          handleClose={closeQueue}
          content={
            <AddCallQueue
              {...{
                drawerState,
                setDrawerState: closeQueue,
                queueDetails: selectedCallQueue,
                tabSlug,
              }}
            />
          }
        />
      )}
      {modalState?.open && (
        <AgentDetailsModal modalState={modalState} setModalState={setModalState} />
      )}
      {!!deleteCallQueueDetails && (
        <AlertConfirm
          {...{
            apiLoading: isPendingDeleteCallQueue,
            onConfirm: () => {
              mutateDeleteCallQueue(deleteCallQueueDetails?._id);
            },
            open: !!deleteCallQueueDetails,
            setOpen: () => {
              setDeleteCallQueue(null);
            },
          }}
        />
      )}
    </>
  );
};

export default CallQueues;
