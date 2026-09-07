import CustomTooltip from '@/components/custom/custom-tooltip';
import TableManager from '@/components/custom/table-manager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate, getInitials, getObjectLength, handleAlert } from '@/lib/utils';
import { deleteDepartment, getDepartmentList } from '@/services/api';
import { useState } from 'react';
import NewDepartment from './new-department';
import DepartmentDetails from './department-details';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AlertConfirm from '@/components/custom/alert-confirm';
import { Plus, SearchLine } from '@/assets/icons';
import SideDrawer from '@/components/custom/side-drawer';
import { Icon, IconName } from '@/assets/icons/icon';
import useDebounce from '@/hooks/use-debounce';
import { useCompanyFeatures } from '@/hooks/rbac';
import AgentDetailsModal from '@/pages/auto-dialer/campaign/modal/agent-details-modal';
import { ModalState } from '@/pages/auto-dialer/campaign';
import { useLocation } from 'react-router-dom';

const UserDepartment = () => {
  const queryClient = useQueryClient();
  const [showInfo, setShowInfo] = useState(false);
  const [rowData, setRowData] = useState<any>({});
  const [search, setSearch] = useState<string>('');
  const debouncedSearch = useDebounce(search, 1000);
  const location = useLocation();
  const isSharedLine = location?.pathname?.includes('shared-line');
  const [modalState, setModalState] = useState<ModalState>({
    open: false,
    type: null,
    data: [],
  });
  const [drawerState, setDrawerState] = useState<any>(false);
  const [open, setOpen] = useState(false);
  const { features } = useCompanyFeatures();
  const phoneSystem = features?.plan_features?.phone_system_action;

  const hasDepartmentAccess = Boolean(phoneSystem?.access?.DEPARTMENT);
  const departmentActions = phoneSystem?.action;

  const { mutate: mutateDeleteDepartment, isPending } = useMutation({
    mutationKey: ['deleteDepartment'],
    mutationFn: deleteDepartment,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['getDepartmentList'] });
      handleAlert({
        text: data?.data?.data?.message || 'Group deleted',
        type: 'success',
      });
      setOpen(false);
    },
  });

  const columns = [
    {
      header: 'Date',
      accessorKey: 'created_at',
      cell: ({ getValue }: any) => <div className="text-gray-600">{formatDate(getValue())}</div>,
    },
    {
      header: 'Group',
      accessorKey: 'name',
      cell: (props: any) => {
        const data = props?.row?.original;
        return (
          <div
            className="text-primary hover:text-primary/80 underline underline-offset-4 cursor-pointer"
            onClick={() => {
              setShowInfo(true);
              setRowData(data);
            }}
          >
            {data?.name}
          </div>
        );
      },
    },
    {
      header: 'Extension',
      accessorKey: 'extension',
      cell: ({ getValue }: any) => (
        <div className="flex shrink-0 items-center gap-1 text-gray-500">
          <Icon name="Grid" className="w-4 h-4" />
          <small className="text-xs">{getValue() || '--'}</small>
        </div>
      ),
    },

    {
      header: 'Manager',
      accessorKey: 'manager',
      cell: ({ getValue }: any) => {
        const Name =
          typeof getValue() === 'string'
            ? JSON.parse(getValue() || '{}')?.label
            : getValue()?.label;

        return <div className="text-gray-600 cursor-pointer capitalize">{Name || ''}</div>;
      },
    },
    {
      header: 'Location',
      accessorKey: 'site',
      cell: ({ getValue }: any) => {
        const isJsonString = (str: string): boolean => {
          return str.trim().startsWith('{') && str.trim().endsWith('}');
        };

        const Name = isJsonString(getValue()) ? JSON.parse(getValue())?.label || '' : getValue();
        return <span>{Name || '---'}</span>;
      },
    },
    {
      header: 'People',
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

        return Array.isArray(members) ? (
          <div className="flex -space-x-2">
            {members.slice(0, 5).map((item: any, index: number) => {
              const username = item?.label || 'Unknown';
              const imageUrl = item?.imageUrl || '';
              return (
                <CustomTooltip text={username} side="top">
                  <div
                    key={index}
                    className="w-9 h-9 flex  items-center justify-center border border-white rounded-full bg-gray-200 dark:border-gray-800 capitalizes cursor-pointer"
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
                  setModalState({ open: true, data: members || [], type: 'People in this group' });
                }}
                className="w-9 h-9 flex items-center justify-center border border-gray-500 !space-x-10 rounded-full bg-gray-500 text-white font-medium cursor-pointer"
              >
                +{members?.length - 5}
              </div>
            )}
          </div>
        ) : (
          <div>Nobody yet</div>
        );
      },
    },

    {
      header: 'Action',
      accessorKey: 'action',
      cell: (props: any) => {
        const data = props?.row?.original;
        const actions = [
          hasDepartmentAccess &&
            departmentActions?.edit && {
              icon: 'EditStrokIcon',
              onClick: () => {
                setDrawerState(true);
                setRowData(data);
              },

              className: 'bg-gray-100 text-gray-900/80 hover:bg-primary hover:text-white',
              tooltipText: 'Edit',
            },
          hasDepartmentAccess &&
            departmentActions?.delete && {
              icon: 'TrashBin',
              onClick: () => {
                setOpen(true);
                setRowData(data);
              },
              className: 'bg-red-100 text-red-500 hover:bg-red-500 hover:text-white',
              tooltipText: 'Delete',
            },
        ].filter(Boolean);

        if (!actions?.length) return '---';

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

  const handleNewDepartment = () => {
    setDrawerState(true);
    setRowData({});
  };

  return (
    <section className="w-full bg-gray-200/15 flex flex-col overflow-x-auto overflow-y-hidden overflow-x-auto overflow-y-hidden">
      <div className="flex flex-col sm:flex-row items-center justify-between p-3 border-b border-gray-200 min-h-[65px] bg-white">
        <p className="text-gray-900 font-semibold text-lg flex items-center gap-1">
          Phone System
          <div className="-rotate-90 text-gray-800">
            <Icon name="ChevronIcon" className="w-5 h-5" />
          </div>
          <span className="text-primary text-md">Groups</span>
        </p>
        {!showInfo && (
          <div className="flex gap-2 filters">
            <Input
              placeholder="Search"
              className="pl-10 w-full min-h-9 rounded-lg"
              IconPosition="left-0 pl-2 inset-y-0"
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                if (value.startsWith(' ')) return;
                setSearch(e.target.value);
              }}
              Icon={<SearchLine className=" text-gray-700" />}
            />
            {hasDepartmentAccess && departmentActions?.add && (
              <Button
                className="min-h-9"
                variant={'outline'}
                onClick={() => {
                  handleNewDepartment();
                }}
              >
                <Plus className="w-3 h-3" /> New group
              </Button>
            )}
          </div>
        )}
      </div>
      {!showInfo ? (
        <div className="w-full p-3 flex flex-col gap-2">
          <p className="text-gray-900 text-sm">
            {isSharedLine
              ? 'A shared line links one or more groups to a single number, so every group on it can take calls from the same number at the same time.'
              : 'A group is a team that answers calls together: Support, Billing, Sales. Give it an extension, put people in it, and route calls to it.'}
          </p>
          <TableManager
            {...{
              fetcherKey: 'getDepartmentList',
              fetcherFn: getDepartmentList,
              columns,
              // search,
              extraParams: {
                filter: [{ key: 'name', value: debouncedSearch }],
              },
              emptyTablePlaceholder: 'No groups yet',
              descriptionEmptyTable: 'Create a group and it will appear here.',
            }}
          />
        </div>
      ) : (
        <DepartmentDetails handleBack={() => setShowInfo(false)} tabData={rowData} />
      )}
      {modalState?.open && (
        <AgentDetailsModal modalState={modalState} setModalState={setModalState} />
      )}
      {drawerState && (
        <SideDrawer
          isOpen={drawerState}
          title={
            getObjectLength(rowData) ? `Update group (${rowData?.name})` : 'Create group'
          }
          handleClose={() => setDrawerState(false)}
          isTab={false}
          enableResponsive
          headerClassName="min-h-8 px-4 sm:px-5"
          content={
            <NewDepartment
              drawerState={drawerState}
              setDrawerState={setDrawerState}
              rowData={rowData}
            />
          }
        />
      )}

      <AlertConfirm
        {...{
          apiLoading: isPending,
          onConfirm: () => {
            mutateDeleteDepartment(rowData?.uuid);
          },
          open,
          setOpen,
        }}
      />
    </section>
  );
};

export default UserDepartment;
