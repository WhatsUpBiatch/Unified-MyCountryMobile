import NumberWithFlag from '@/components/custom/number-with-flag';
import { TabRail } from '@/components/mcm/tab-rail';
import { parseForwardActions } from '@/lib/call-standard';
import TableManager from '@/components/custom/table-manager';
import { AdminPage } from '@/pages/admin-settings/page-shell';
import { Input } from '@/components/ui/input';
import { useUser } from '@/hooks/use-user';
import { capitalizeFirstLetter, handleAlert } from '@/lib/utils';
import {
  allNumbersList,
  releasedNumbersList,
  releaseDidToCarrier,
  removeAssignNumber,
  removeForwarding,
} from '@/services/api';
import { useEffect, useMemo, useState } from 'react';
import { SearchLine, Plus } from '@/assets/icons';
import UpsertCallForwarding from '../set-number-forwarding';
import AssignDIDNumber from '../assign-did';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AlertConfirm from '@/components/custom/alert-confirm';
import SideDrawer from '@/components/custom/side-drawer';
import CustomTooltip from '@/components/custom/custom-tooltip';
import { Icon, IconName } from '@/assets/icons/icon';
import { useCompanyFeatures } from '@/hooks/rbac';
import AddNumber from '../all-numbers/add-number-new';
import {
  FORWARD_TYPES_WITH_EXTENSION,
  FORWARD_TYPES_WITH_NAME,
  FORWARD_TYPES_WITH_PHONE,
  getDidTypeLabel,
} from '../utils';
import { invalidateNumberLists } from '@/lib/number-list-cache';
import { featuresLookUp, featuresObj } from '../all-numbers/constants';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { canEditLabel, labelOf } from '@/lib/number-labels';
import EditNumberLabel from '../edit-label';
import NumbersByLine from '../by-line';

/* One screen, three views.

   "All numbers", "Numbers in use" and "Unused numbers" were three separate
   pages running the same query against the same endpoint, with the same
   columns, the same four actions and the same three confirmation dialogs —
   about 1,600 lines that differed by one request parameter and whether the
   Features column was shown. They drifted, as duplicated screens do: one of
   them shipped a column headed "Number/Name1", and only one carried the
   defensive parse that stops a single malformed row blanking the table.

   They are one component now, and the view is read from the URL the way the
   Identities / Addresses / Verifications tabs already work here. Each view
   keeps its own address so it can still be linked to and bookmarked. */

type ViewKey = 'all' | 'in-use' | 'inventory' | 'released' | 'by-line';

interface NumberView {
  key: ViewKey;
  tab: string;
  path: string;
  title: string;
  description: string;
  fetcherKey: string;
  extraParams?: Record<string, string>;
  /* Only the unfiltered view shows Features; the other two were built without
     it and adding it there would be a change of behaviour, not a merge. */
  showFeatures: boolean;
  /* Unused numbers are, by definition, not ones you buy more of from here. */
  showAddNumber: boolean;
  emptyDescription?: string;
  /* Released numbers are an archive, not live inventory: they come from a
     different table, have no owner to act on, and carry no row actions. */
  isArchive?: boolean;
  /* Not a filter of the same table but a different shape entirely: the numbers
     gathered under the shared line each one rings. */
  isGrouped?: boolean;
}

const VIEWS: Record<ViewKey, NumberView> = {
  all: {
    key: 'all',
    tab: 'All numbers',
    path: '/admin-settings/numbers/all',
    title: 'All numbers',
    description: 'Every number on the account, whether it is assigned, routed or sitting unused.',
    fetcherKey: 'allNumbersList',
    showFeatures: true,
    showAddNumber: true,
  },
  'by-line': {
    key: 'by-line',
    tab: 'By line',
    path: '/admin-settings/numbers/by-line',
    title: 'Numbers by line',
    description:
      'The numbers that ring each department, queue and menu, with what each one is called.',
    fetcherKey: 'numbersByLine',
    showFeatures: false,
    showAddNumber: false,
    isGrouped: true,
  },
  'in-use': {
    key: 'in-use',
    tab: 'In use',
    path: '/admin-settings/numbers/in-use',
    title: 'Numbers in use',
    description:
      'Numbers assigned to a person, a group or a call flow — and what each one routes to.',
    fetcherKey: 'usedNumbersList',
    extraParams: { type: 'in_use' },
    showFeatures: false,
    showAddNumber: true,
    emptyDescription: 'Numbers assigned to users, departments, or call flows will appear here.',
  },
  inventory: {
    key: 'inventory',
    tab: 'Unused',
    path: '/admin-settings/numbers/inventory',
    title: 'Unused numbers',
    description: 'Numbers you own that are not assigned to anyone and have no call forwarding set.',
    fetcherKey: 'inventoryNumbersList',
    extraParams: { type: 'inventory' },
    showFeatures: false,
    showAddNumber: false,
    emptyDescription: 'Numbers you own but have not assigned or forwarded will appear here.',
  },
  released: {
    key: 'released',
    tab: 'Released',
    path: '/admin-settings/numbers/released',
    title: 'Released numbers',
    description:
      'Numbers that have left the account, and who held them last — so a number that went with someone who left can still be traced.',
    fetcherKey: 'releasedNumbersList',
    showFeatures: false,
    showAddNumber: false,
    isArchive: true,
    emptyDescription: 'Numbers released from this account will appear here.',
  },
};

const viewFromPath = (pathname: string): ViewKey => {
  const last = pathname.replace(/\/+$/, '').split('/').pop() || '';
  if (last === 'in-use') return 'in-use';
  if (last === 'inventory') return 'inventory';
  if (last === 'released') return 'released';
  if (last === 'by-line') return 'by-line';
  return 'all';
};

interface INumberListState {
  updateForwarding: boolean;
  assignDID: boolean;
  selectedDID: any;
  deleteConfirmationAlert: boolean;
  removeConfirmationAlert: boolean;
  releaseConfirmationAlert: boolean;
  editLabel: boolean;
}

const NumberList = () => {
  const { pathname } = useLocation();
  const view = VIEWS[viewFromPath(pathname)];

  const [search, setSearch] = useState<string>('');
  const [openDrawer, setOpenDrawer] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useUser();
  /* `companyInfo` does not exist on the user object — the field is `company_info`
     everywhere else in the codebase. Read wrongly, this was always undefined and
     a customer with an expired subscription could still open the buy flow. */
  const isPlanExpired = user?.company_info?.plan_status === 'EXPIRED';
  const isTrial = user?.company_info?.is_trial === 'Y';
  /* Required by the released-numbers endpoint, which rejects a company_uuid
     that is not the caller's own. */
  const companyUuid = user?.company_info?.uuid;
  const [numberState, setNumberState] = useState<INumberListState>({
    updateForwarding: false,
    assignDID: false,
    selectedDID: null,
    deleteConfirmationAlert: false,
    removeConfirmationAlert: false,
    releaseConfirmationAlert: false,
    editLabel: false,
  });
  const queryClient: any = useQueryClient();
  const { features } = useCompanyFeatures();
  const virtualNumberAccess = features?.plan_features?.virtual_numbers || {};

  const handleAddNumber = () => {
    if (isTrial) return;

    if (isPlanExpired) {
      handleAlert({
        text: 'You cannot add numbers until your subscription is renewed.',
        type: 'error',
      });
      return;
    }
    setOpenDrawer(true);
  };

  /* Linked to from the setup guide, which sends people straight into the buy
     flow. Consumed once so a refresh does not reopen the drawer. */
  useEffect(() => {
    const shouldOpenAddNumber = searchParams.get('openAddNumber') === '1';
    if (!shouldOpenAddNumber || isTrial || !view.showAddNumber) return;

    setOpenDrawer(true);
    const params = new URLSearchParams(searchParams);
    params.delete('openAddNumber');
    setSearchParams(params, { replace: true });
  }, [isTrial, searchParams, setSearchParams, view.showAddNumber]);

  /* Search is per-view: carrying a filter across tabs makes an empty table look
     like missing data. */
  useEffect(() => {
    setSearch('');
  }, [view.key]);

  const handleNumberState = (data: any, key: string) => {
    setNumberState((prev) => ({ ...prev, [key]: true, selectedDID: data }));
  };

  const closeAlert = (key: keyof INumberListState) =>
    setNumberState((prev) => ({ ...prev, [key]: false, selectedDID: null }));

  const { mutate: mutateRemoveAssignDID, isPending: isPendingRemoveAssignDID } = useMutation({
    mutationFn: removeAssignNumber,
    onSuccess: (data: any) => {
      invalidateNumberLists(queryClient);
      handleAlert({
        text: data?.data?.data?.message || 'Assigned DID Removed Successfully.',
        type: 'success',
      });
      closeAlert('deleteConfirmationAlert');
    },
  });

  const { mutate: mutateRemoveForwarding, isPending: isPendingRemovingForwarding } = useMutation({
    mutationFn: removeForwarding,
    onSuccess: (data: any) => {
      invalidateNumberLists(queryClient);
      handleAlert({
        text: data?.data?.data?.message || 'Forwarding removed. You still have this number.',
        type: 'success',
      });
      closeAlert('removeConfirmationAlert');
    },
  });

  /* "Release Number" gives the number back to the carrier.

     It called releaseForwarding, which only unwires forwarding in our own
     database and never contacts the carrier. So the number vanished from these
     screens and stopped taking calls, while still being billed - and the dialog
     told the admin the action could not be undone. Every number released that
     way is still live at the carrier and should be checked against the invoice.

     releaseDidToCarrier sends the termination first and only then marks it
     deleted here. */
  const { mutate: mutateReleaseForwarding, isPending: isPendingReleaseForwarding } = useMutation({
    mutationFn: releaseDidToCarrier,
    onSuccess: (data: any) => {
      invalidateNumberLists(queryClient);
      handleAlert({
        text:
          data?.data?.data?.message ||
          'Number released. It has been given back and will not be billed again.',
        type: 'success',
      });
      closeAlert('releaseConfirmationAlert');
    },
    /* A failed carrier call must not read as success - the number would carry on
       being billed while the admin believes it is gone. */
    onError: (error: any) => {
      handleAlert({
        text:
          error?.response?.data?.message ||
          'The number could not be released with the carrier. It has NOT been given back - please try again.',
        type: 'error',
      });
    },
  });

  const archiveColumns = useMemo(
    () => [
      {
        header: 'Number',
        accessorKey: 'did_number',
        cell: ({ row }: any) => <NumberWithFlag number={row?.original?.did_number} />,
      },
      {
        header: 'Label',
        accessorKey: 'did_name',
        cell: ({ row }: any) => labelOf(row?.original) || <span className="text-gray-500">--</span>,
      },
      {
        header: 'Last assigned to',
        accessorKey: 'user_details',
        cell: ({ row }: any) => {
          const held = row?.original?.user_details;
          const name = [held?.first_name, held?.last_name].filter(Boolean).join(' ').trim();
          /* A number can be released without ever having had an owner, so this
             says so rather than showing an empty cell that reads as missing data. */
          return name || <span className="text-gray-500">Never assigned</span>;
        },
      },
      {
        header: 'Type',
        accessorKey: 'did_type',
        cell: ({ row: { original: _val } }: any) => getDidTypeLabel(_val?.did_type),
      },
      {
        header: 'Site',
        accessorKey: 'site_data',
        cell: ({ row }: any) => row?.original?.site_data?.name ?? '--',
      },
      {
        header: 'Held from',
        accessorKey: 'buy_date',
        cell: ({ row }: any) => {
          const bought = row?.original?.buy_date;
          if (!bought) return '--';
          const parsed = new Date(bought);
          return Number.isNaN(parsed.getTime()) ? '--' : parsed.toLocaleDateString();
        },
      },
    ],
    [],
  );

  const columns = useMemo(() => {
    const base: any[] = [
      {
        header: 'Number',
        accessorKey: 'did_number',
        cell: ({ row }: any) => {
          const data = row?.original || {};
          return (
            <div className="flex items-center gap-2">
              <NumberWithFlag number={data?.did_number} />
              {data?.is_fax_enabled && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  FAX
                </span>
              )}
            </div>
          );
        },
      },
      /* The name a number was bought with used to sit as small print under the
         number, where it read as decoration. It is the only thing that tells
         three numbers on the same line apart, so it gets a column of its own -
         and, for the first time, a way to change it. */
      {
        header: 'Label',
        accessorKey: 'did_name',
        cell: ({ row }: any) => {
          const data = row?.original || {};
          const label = labelOf(data);
          if (label) return label;
          return canEditLabel(data).ok && virtualNumberAccess?.action?.update_forwarding ? (
            <span
              className="text-primary cursor-pointer"
              onClick={() => handleNumberState(data, 'editLabel')}
            >
              Add label
            </span>
          ) : (
            <span className="text-gray-500">--</span>
          );
        },
      },
      {
        header: 'Assigned to',
        accessorKey: 'uuid',
        cell: ({ row }: any) => {
          const data = row?.original?.User || {};
          if (data?.first_name) {
            return `${data?.first_name}${data?.last_name ? ` ${data?.last_name}` : ''}`;
          }
          const canAssign =
            !row?.original?.forward_call_actions && virtualNumberAccess?.action?.set_forwarding;
          return canAssign ? (
            <p
              className="text-primary cursor-pointer"
              onClick={() => handleNumberState(row?.original, 'assignDID')}
            >
              Assign to extension
            </p>
          ) : (
            <p className="text-grey cursor-not-allowed">Assign to extension</p>
          );
        },
      },
      {
        header: 'Forwarded to',
        accessorKey: 'uuid',
        cell: ({ row }: any) => {
          const data = row?.original || {};

          if (data?.is_fax_enabled) return '--';

          /* Parsed defensively: an unguarded JSON.parse here throws during
             render, and one malformed forward_call_actions row would blank the
             entire table rather than that single cell. */
          const parsedForwardTo = parseForwardActions(data?.forward_call_actions);
          const forwardedValue = parsedForwardTo?.call_handling?.business_hours || '';
          return (
            <div>
              {FORWARD_TYPES_WITH_EXTENSION.includes(forwardedValue?.type) ? (
                <div className="flex">
                  <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-2.5 py-1 w-auto">
                    <div className="w-7 h-7 rounded-lg border border-primary/30 bg-white flex items-center justify-center text-primary text-base font-semibold leading-none">
                      #
                    </div>
                    <div className="flex flex-col gap-1 leading-tight">
                      <div className="text-[9px] font-semibold tracking-[0.08em] text-gray-500 uppercase">
                        {capitalizeFirstLetter(forwardedValue?.type)}
                      </div>
                      <small className="text-gray-900 text-xs font-semibold leading-none">
                        {forwardedValue?.name}
                        {forwardedValue?.value ? ` (${forwardedValue.value})` : ''}
                      </small>
                    </div>
                  </div>
                </div>
              ) : FORWARD_TYPES_WITH_NAME.includes(forwardedValue?.type) ? (
                <div className="flex flex-col items-start">
                  {capitalizeFirstLetter(forwardedValue?.type)}
                  <small>{forwardedValue?.name}</small>
                </div>
              ) : FORWARD_TYPES_WITH_PHONE.includes(forwardedValue?.type) ? (
                <div className="flex flex-col items-start">
                  {capitalizeFirstLetter(forwardedValue?.type)}
                  <small>
                    <NumberWithFlag number={`+${forwardedValue?.name}`} />
                  </small>
                </div>
              ) : data?.User || !virtualNumberAccess?.action?.set_forwarding ? (
                <p className="text-grey cursor-not-allowed">Set Forwarding</p>
              ) : (
                <p
                  className="text-primary cursor-pointer"
                  onClick={() => handleNumberState(data, 'updateForwarding')}
                >
                  Set Forwarding
                </p>
              )}
            </div>
          );
        },
      },
      {
        header: 'Type',
        accessorKey: 'did_type',
        cell: ({ row: { original: _val } }: any) => getDidTypeLabel(_val?.did_type),
      },
    ];

    if (view.showFeatures) {
      base.push({
        header: 'Features',
        accessorKey: 'features',
        cell: ({ getValue }: any) => {
          const rowFeatures = getValue();
          return (
            <div className="flex justify-center items-center gap-2 px-4">
              {rowFeatures?.map((v: any) => {
                if (!featuresLookUp[v]) return null;
                return (
                  <CustomTooltip key={v} text={featuresObj[v]} side="top">
                    <img src={featuresLookUp[v]} alt={featuresObj[v]} width={24} height={24} />
                  </CustomTooltip>
                );
              })}
            </div>
          );
        },
        meta: { textAlign: 'center' },
      });
    }

    base.push({
      header: 'Site',
      accessorKey: 'type',
      cell: ({ row: { original: _val } }: any) => _val?.Site?.name ?? '--',
    });

    base.push({
      header: 'Action',
      accessorKey: 'action',
      cell: (props: any) => {
        const data = props?.row?.original;
        const createAction = (
          id: number,
          tooltip: string,
          icon: string,
          iconClass: string,
          className: string,
          stateAction: string,
        ) => ({
          id,
          tooltipText: tooltip,
          icon,
          iconClass,
          className,
          cb: () => handleNumberState(data, stateAction),
        });

        const neutral = 'bg-gray-100 text-gray-900/80 hover:bg-primary hover:text-white';

        const assignNumberAction =
          !data?.User && virtualNumberAccess?.action?.assign_number
            ? [
                createAction(
                  2,
                  'Assign Number',
                  'AssignNumberIcon',
                  'w-5 h-5',
                  neutral,
                  'assignDID',
                ),
              ]
            : [];

        const setForwardingActions =
          !data?.forward_call_actions && !data?.User
            ? [
                virtualNumberAccess?.action?.set_forwarding &&
                  createAction(
                    1,
                    'Set Forwarding',
                    'CallForward',
                    'w-5.5 h-5.5',
                    neutral,
                    'updateForwarding',
                  ),
                ...assignNumberAction,
              ].filter(Boolean)
            : [];

        const updateForwardingActions =
          !data?.User && data?.forward_call_actions
            ? [
                virtualNumberAccess?.action?.update_forwarding &&
                  createAction(
                    1,
                    'Update Forwarding',
                    'EditStrokIcon',
                    'w-5 h-5',
                    neutral,
                    'updateForwarding',
                  ),
                virtualNumberAccess?.action?.remove_forwarding &&
                  createAction(
                    3,
                    'Remove Forwarding',
                    'CallCancel',
                    'w-5.5 h-5.5',
                    neutral,
                    'removeConfirmationAlert',
                  ),
              ].filter(Boolean)
            : [];

        const removeAssignmentAction =
          data?.User && virtualNumberAccess?.action?.assign_number
            ? [
                createAction(
                  2,
                  'Remove Assignment',
                  'RemoveAssignmentLine',
                  'w-5 h-5 ',
                  neutral,
                  'deleteConfirmationAlert',
                ),
              ]
            : [];

        /* Offered wherever a label can actually be kept, assigned or not. The
           permission is the forwarding one because that is literally the write
           this makes - there is no endpoint that changes a number's name on its
           own. */
        const editLabelAction =
          canEditLabel(data).ok && virtualNumberAccess?.action?.update_forwarding
            ? [createAction(5, 'Edit Label', 'EditStrokIcon', 'w-5 h-5', neutral, 'editLabel')]
            : [];

        const releaseNumberAction = virtualNumberAccess?.action?.release
          ? [
              createAction(
                4,
                'Release Number',
                'ReleaseNumber',
                'w-5 h-5',
                'bg-red-100 text-red-500 hover:bg-red-500 hover:text-white',
                'releaseConfirmationAlert',
              ),
            ]
          : [];

        const faxActions = [
          ...(data?.User ? removeAssignmentAction : assignNumberAction),
          ...editLabelAction,
        ];

        const actions = data?.is_fax_enabled
          ? faxActions
          : [
              ...removeAssignmentAction,
              ...setForwardingActions,
              ...updateForwardingActions,
              ...editLabelAction,
              ...releaseNumberAction,
            ];

        if (actions?.length === 0) return '---';

        return (
          <div className="flex items-center justify-end w-full gap-2">
            {actions?.map((action: any) => (
              <CustomTooltip key={action.id} text={action.tooltipText} side="top">
                <div
                  className={`cursor-pointer flex items-center justify-center rounded-full w-8 h-8 ${action.className}`}
                  onClick={action.cb}
                >
                  <Icon name={action.icon as IconName} className={action.iconClass} />
                </div>
              </CustomTooltip>
            ))}
          </div>
        );
      },
    });

    return base;
  }, [view.showFeatures, virtualNumberAccess]);

  const selected = numberState.selectedDID;
  const releaseBlocked = Boolean(selected?.User) || Boolean(selected?.forward_call_actions);

  return (
    <>
      <AdminPage
        crumbs={[
          { label: 'Admin settings', to: '/admin-settings' },
          { label: 'Numbers', to: VIEWS.all.path },
          { label: view.tab },
        ]}
        section="Numbers"
        title={view.title}
        description={view.description}
        actions={
          !isTrial && view.showAddNumber && virtualNumberAccess?.action?.buy ? (
            <button type="button" className="btn primary" onClick={handleAddNumber}>
              <Plus className="w-3 h-3" />
              Add number
            </button>
          ) : null
        }
        filters={
          <Input
            placeholder="Search numbers"
            className="pl-10 w-full min-h-9 rounded-lg"
            IconPosition="left-0 pl-2 inset-y-0"
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith(' ')) return;
              setSearch(value);
            }}
            Icon={<SearchLine className=" text-gray-700" />}
          />
        }
      >
        {/* The panel the company settings tabs sit on, so the two areas are the
            same shape: one surface, its own hairline, and the views, the note
            and the table as sections of it rather than three things stacked on
            the page with gaps between them. */}
        <section className="cs-section flex w-full flex-col">
          {/* One list, five views. Each keeps its own address so a view can be
              linked to and reloaded.

              The same strip the company settings tabs use, rather than a second
              one built to look nearly like it: one control, one active state,
              and the marker, sideways scrolling and overflow chevron come with
              it. */}
          <TabRail
            items={Object.values(VIEWS).map((item) => ({ to: item.path, label: item.tab }))}
            ariaLabel="Number views"
          />

          {view.key === 'all' && (
            /* Was three sentences saying one thing twice: that a number is
               charged as a number, that it is not a new subscription, and that
               the monthly total goes up. The first two are the same fact from
               either side. */
            <p className="text-sm text-gray-600">
              Adding a number to an existing plan charges for the number only, not a new
              subscription. Your monthly total updates to match.
            </p>
          )}

          {view.isGrouped ? (
            <NumbersByLine
              search={search}
              canLabel={Boolean(virtualNumberAccess?.action?.update_forwarding)}
              onEditLabel={(did) => handleNumberState(did, 'editLabel')}
            />
          ) : (
            <TableManager
              {...{
                fetcherKey: view.fetcherKey,
                fetcherFn: view.isArchive ? releasedNumbersList : allNumbersList,
                columns: view.isArchive ? archiveColumns : columns,
                search,
                ...(view.isArchive ? { extraParams: { company_uuid: companyUuid } } : {}),
                ...(view.extraParams ? { extraParams: view.extraParams } : {}),
                emptyTablePlaceholder: 'No numbers available',
                ...(view.emptyDescription ? { descriptionEmptyTable: view.emptyDescription } : {}),
              }}
            />
          )}

          {openDrawer && (
            <SideDrawer
              width="min(1040px, 84vw)"
              title="Add Number"
              isOpen={openDrawer}
              isTab={false}
              enableResponsive
              handleClose={() => setOpenDrawer(false)}
              content={<AddNumber handleClose={() => setOpenDrawer(false)} />}
            />
          )}
        </section>
      </AdminPage>

      {numberState.updateForwarding && (
        <SideDrawer
          width="min(1040px, 84vw)"
          isOpen={numberState.updateForwarding}
          title="Update Forwarding"
          handleClose={() => closeAlert('updateForwarding')}
          isTab={false}
          content={
            <UpsertCallForwarding
              drawerState={numberState.updateForwarding}
              setDrawerState={(val: boolean) =>
                setNumberState((prev) => ({
                  ...prev,
                  updateForwarding: val,
                  selectedDID: null,
                }))
              }
              initialType={'SELECT_TEMPLATE'}
              isUser={false}
              initialData={selected}
            />
          }
        />
      )}

      {numberState.editLabel && selected && (
        <EditNumberLabel
          did={selected}
          open={numberState.editLabel}
          onClose={() => closeAlert('editLabel')}
        />
      )}

      {numberState.assignDID && (
        <AssignDIDNumber
          modalState={numberState.assignDID}
          setModalState={(val: boolean) =>
            setNumberState((prev) => ({ ...prev, assignDID: val, selectedDID: null }))
          }
          selectedDidNumber={selected}
        />
      )}

      {numberState.deleteConfirmationAlert && (
        <AlertConfirm
          {...{
            apiLoading: isPendingRemoveAssignDID,
            onConfirm: () => mutateRemoveAssignDID({ did_number: selected?.did_number }),
            open: numberState.deleteConfirmationAlert,
            setOpen: () => closeAlert('deleteConfirmationAlert'),
            descriptionTextComp:
              'Are you sure you want to remove the assignment of this DID number? ',
          }}
          headerText="Remove DID Assignment"
        />
      )}

      {numberState.releaseConfirmationAlert && (
        <AlertConfirm
          {...{
            apiLoading: isPendingReleaseForwarding,
            onConfirm: () => mutateReleaseForwarding(selected?.did_number),
            open: numberState.releaseConfirmationAlert,
            setOpen: () => closeAlert('releaseConfirmationAlert'),
            descriptionTextComp: releaseBlocked
              ? ' You must remove the assignment or forwarding before releasing this number.'
              : 'Give this number back to the carrier? Billing for it stops and it will no longer reach you. It may then be issued to somebody else, so you cannot get it back. To stop it taking calls but keep the number, use Remove forwarding instead.',
            confirmBtnDisabled: releaseBlocked,
          }}
        />
      )}

      {numberState.removeConfirmationAlert && (
        <AlertConfirm
          {...{
            apiLoading: isPendingRemovingForwarding,
            onConfirm: () => mutateRemoveForwarding({ uuid: selected?.uuid }),
            open: numberState.removeConfirmationAlert,
            setOpen: () => closeAlert('removeConfirmationAlert'),
            descriptionTextComp:
              'Are you sure you want to remove the forwarding of this DID number? This action cannot be undone.',
          }}
        />
      )}
    </>
  );
};

export default NumberList;
