import { Icon } from '@/assets/icons/icon';
import NumberWithFlag from '@/components/custom/number-with-flag';
import TableManager from '@/components/custom/table-manager';
import CustomAvatar from '@/components/custom/custom-avatar';
import CustomTooltip from '@/components/custom/custom-tooltip';
import { cn, convertDateFormateApis, getInitials } from '@/lib/utils';
import { useUser } from '@/hooks/use-user';
import { deleteContact, getContactList, updateContactTag, upsertContact } from '@/services/api';
import { ColumnDef } from '@tanstack/react-table';
import { FC, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
// import { updateContactTag } from '@/services/api';
import AlertConfirm from '@/components/custom/alert-confirm';
import { BELONGS_TO_LABELS, getBelongsToIcons } from '@/pages/integration/constant';
import { useDialpad } from '@/hooks/use-dialpad';
import { useOrganization } from '@/hooks/use-organisation';
import { useGetExtensions, useGetGroupList } from '@/hooks/common';
import { toast } from 'react-toastify';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import AgentDetailsModal from '@/pages/auto-dialer/campaign/modal/agent-details-modal';
const extractUpdatedByName = (
  updatedByIds: string | string[] | undefined,
  userId: string,
  extensionByUuid: Map<string, any>,
) => {
  const ids = Array.isArray(updatedByIds)
    ? updatedByIds.filter(Boolean)
    : updatedByIds
      ? [updatedByIds]
      : [];

  if (!ids.length) return <div className="font-medium text-gray-900">---</div>;

  const idsToShow = [ids[ids.length - 1]];
  const usersToShow = idsToShow
    .map((id: string) => {
      const extension = extensionByUuid.get(id);
      if (!extension) return null;
      const name = `${extension?.first_name || ''} ${extension?.last_name || ''}`.trim();
      return {
        name,
        amI: extension?.uuid === userId,
      };
    })
    .filter(Boolean);

  if (!usersToShow.length) return <div className="font-medium text-gray-900">---</div>;

  return (
    <div className="font-medium text-gray-900">
      {usersToShow.map((item: any, index: number) => (
        <span key={`${item?.name}-${index}`}>
          {index > 0 ? ', ' : ''}
          {item?.name}
          {item?.amI ? <span className="text-ucass-active"> (You)</span> : null}
        </span>
      ))}
    </div>
  );
};

const GroupAssignCell: FC<{ contact: any; groupList: any[] }> = ({ contact, groupList }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const isLead =
    window.location.pathname.includes('leads') || window.location.pathname.includes('lead');

  // Find already added group ids
  const existingMembers = Array.isArray(contact.groupMeta) ? contact?.groupMeta : [];
  const initialGroupIds = existingMembers
    ?.map((item: any) => String(item?._id || '').trim())
    ?.filter(Boolean);

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(initialGroupIds);

  useEffect(() => {
    if (open) {
      setSelectedGroupIds(initialGroupIds);
    }
  }, [open, contact.groupMeta]);

  const { mutate: mutateUpsert, isPending } = useMutation({
    mutationFn: upsertContact,
    onSuccess: () => {
      toast.success(`${isLead ? 'Lead' : 'Contact'} groups updated successfully`);
      queryClient.invalidateQueries({ queryKey: ['getContactList'] });
      queryClient.invalidateQueries({ queryKey: ['getGroupContactsById'] });
      setOpen(false);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || 'Failed to update groups');
    },
  });

  const handleToggle = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    );
  };

  const handleSave = () => {
    const belongsTo = selectedGroupIds.join(',');

    const payload: Record<string, any> = {
      name: {
        first: contact.name?.first || '',
        last: contact.name?.last || '',
      },
      contact: {
        email: contact.contact?.email || '',
        phone: contact.contact?.phone || '',
      },
      profile: {
        gender: contact.profile?.gender || '',
        dob: contact.profile?.dob || '',
        title: contact.profile?.title || '',
        company: contact.profile?.company || '',
        webpage: contact.profile?.webpage || '',
        contactPic: contact.profile?.contactPic || '',
      },
      address: {
        street: contact.address?.street || '',
        city: contact.address?.city || '',
        state: contact.address?.state || '',
        zipcode: contact.address?.zipcode || '',
        ...(contact.address?.country ? { country: contact.address.country } : {}),
      },
      social: {
        twitter: contact.social?.twitter || '',
        facebook: contact.social?.facebook || '',
        linkedin: contact.social?.linkedin || '',
      },
      type: isLead ? 'LEAD' : 'CONTACT',
      belongsTo,
    };

    if (contact._id) {
      payload.contact_uuid = contact._id;
    }

    mutateUpsert(payload);
  };

  const isSystemGenerated = existingMembers?.some((g: any) => g?.generatedBy === 'SYSTEM');

  if (isSystemGenerated) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-150 bg-gray-50 text-gray-400 cursor-not-allowed opacity-60 shadow-3xs">
        Change Group
        <ChevronDown className="w-3.5 h-3.5 opacity-40" />
      </span>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 cursor-pointer hover:bg-gray-50 hover:text-gray-900 transition-all shadow-3xs">
            Change Group
            <ChevronDown className="w-3.5 h-3.5 opacity-80" />
          </span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-56 p-2 flex flex-col gap-2 bg-white border border-gray-200 shadow-md rounded-md z-50"
          /* Portalled, but React events still bubble up the React tree — see the
             note on the row menus below. */
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-xs font-semibold text-gray-500 px-2 py-1 border-b border-gray-100">
            Assign Groups
          </div>
          <div className="flex flex-col max-h-48 overflow-y-auto gap-1">
            {groupList.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-gray-500">No groups available</div>
            ) : (
              groupList.map((group: any) => {
                const isChecked = selectedGroupIds.includes(group._id);
                return (
                  <div
                    key={group._id}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded-md cursor-pointer text-sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleToggle(group._id);
                    }}
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => handleToggle(group._id)}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    />
                    <span
                      className="truncate flex-1 text-gray-700 select-none"
                      title={group.groupName}
                    >
                      {group.groupName}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button
              size="sm"
              variant="transparent"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }}
              className="h-8 text-xs px-3"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowConfirm(true);
              }}
              className="h-8 text-xs px-3"
            >
              {isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <AlertConfirm
        open={showConfirm}
        setOpen={setShowConfirm}
        headerText="Please confirm assignment"
        onConfirm={() => {
          handleSave();
          setShowConfirm(false);
        }}
        apiLoading={isPending}
        descriptionTextComp={
          <div className="flex flex-col items-center justify-center gap-4 py-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ucass-active-bg text-ucass-active">
              <Icon name="QuestionIcon" className="h-8 w-8" />
            </div>
            <p className="text-center text-gray-600">
              Are you sure you want to update the assigned groups for this{' '}
              {isLead ? 'lead' : 'contact'}?
            </p>
          </div>
        }
      />
    </>
  );
};

const AllNewContactsList: FC<any> = ({
  setDrawerState,
  setShowDeleteConfirmation,
  payloadExtraParams,
  permissionAccess = {},
  // actionMode = 'full',
  handleNotesOpen = () => {},
  handleWhatsappOpen = () => {},
  onOpenContact,
}) => {
  const navigate = useNavigate();
  const tableRef = useRef<any>(null);
  const { user } = useUser();
  const { mainSiteInfo } = useOrganization();
  const { makeCall } = useDialpad();
  const belongsToIcons = getBelongsToIcons(mainSiteInfo);
  const { data: extensionList = [] } = useGetExtensions({
    page: 1,
    limit: 999999,
    filters: [],
    search: '',
    displayType: 'dropdown',
  });
  const extensionByUuid = useMemo<Map<string, any>>(
    () =>
      new Map(
        extensionList
          .filter((extension: any) => extension?.uuid)
          .map((extension: any): [string, any] => [String(extension.uuid), extension]),
      ),
    [extensionList],
  );
  const queryClient = useQueryClient();
  const currentUserUuid = user?.uuid || user?.user_info?.uuid || '';
  const canViewContact = permissionAccess?.canView !== false;
  const canEditContact = permissionAccess?.canEdit !== false;
  const canDeleteContact = permissionAccess?.canDelete !== false;
  const [tagUpdateState, setTagUpdateState] = useState<{
    contact: any;
    tag: string;
    label: string;
  } | null>(null);

  const { data: groupList = [] } = useGetGroupList({
    type: 'CONTACT',
    generatedBy: 'COMPANY',
    displayType: 'dropdown',
  });

  const [modalState, setModalState] = useState<any>({
    open: false,
    type: null,
    data: [],
  });

  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [showBulkDeleteConfirmation, setShowBulkDeleteConfirmation] = useState(false);

  const handleSelectedRowsChange = useCallback((selectedRowState: any) => {
    const selectedIds = Object.keys(selectedRowState || {}).filter((key) => selectedRowState[key]);
    setSelectedContactIds(selectedIds);
  }, []);

  const { mutate: mutateBulkDelete, isPending: isPendingBulkDelete } = useMutation({
    mutationFn: deleteContact,
    onSuccess: (data) => {
      if (data?.data?.success) {
        toast.success(data?.data?.data?.message || 'Contacts deleted successfully!');
        setSelectedContactIds([]);
        if (tableRef.current) {
          tableRef.current.refetchTable();
          tableRef.current.clearSelection?.();
        }
        setShowBulkDeleteConfirmation(false);
      }
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || 'Failed to delete contacts');
    },
  });

  const handleBulkDelete = () => {
    mutateBulkDelete({ contact_uuid: selectedContactIds });
  };

  const handleContactCall = (contactRow: any) => {
    const dialNumber = String(contactRow?.contact?.phone || '').trim();
    console.log(contactRow, 'contactRow');

    if (!dialNumber) return;

    const contactName = [contactRow?.name?.first, contactRow?.name?.middle, contactRow?.name?.last]
      .map((value: any) => String(value || '').trim())
      .filter(Boolean)
      .join(' ');

    const contactId = String(contactRow?._id || '').trim();

    const extraHeaders = [
      contactName ? `X-ContactName: ${contactName}` : '',
      contactId ? `X-ContactUuid: ${contactId}` : '',
    ].filter(Boolean) as string[];

    makeCall(dialNumber, {
      size: 'mini',
      extraHeaders,
    });
  };

  const { mutate: mutateUpdateTag, isPending: isApiLoading } = useMutation({
    mutationFn: updateContactTag,
    onSuccess: (data) => {
      if (data?.data?.success) {
        toast.success(`Contact updated to ${tagUpdateState?.label} successfully`);
        queryClient.invalidateQueries({ queryKey: ['getContactList'] });
        setTagUpdateState(null);
      }
    },
    onError: (error: any) => {
      console.log(error, 'errorerror');
      toast.error(error?.response?.data?.message || 'Failed to update contact tag');
    },
  });

  const handleTagUpdate = async () => {
    if (!tagUpdateState) return;
    mutateUpdateTag({
      contact_uuid: [tagUpdateState.contact._id],
      tag: tagUpdateState.tag,
    });
  };

  const columns: ColumnDef<any>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <div className="flex items-center justify-center pl-2">
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center pl-2" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      header: 'Created Date',
      accessorKey: 'createdAt',
      cell: ({ row }) => (
        <div>{convertDateFormateApis(row?.original?.createdAt, 'MMM D, YYYY')}</div>
      ),
    },
    {
      header: 'Name',
      accessorKey: 'firstName',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <CustomAvatar
            name={`${row.original.name?.first || ''} ${row.original.name?.last || ''}`}
            type="contact"
            image={row.original.profile?.contactPic}
          />
          <div>
            <span className="font-medium text-gray-900">
              {row.original.name?.first || ''} {row.original.name?.last || ''}
            </span>
            <div className="text-ucass-active">{row?.original?.contact?.email || '---'}</div>
          </div>
        </div>
      ),
    },

    {
      header: 'Phone',
      accessorKey: 'contact',
      cell: ({ row }) => {
        const crmArray = Array.isArray(row?.original?.crm) ? row.original.crm : [];
        const seenCrms = new Set<string>();
        const groupIcons: any[] = [];

        crmArray.forEach((crmItem: any) => {
          if (
            !crmItem ||
            crmItem.deleted === true ||
            !crmItem.type ||
            typeof crmItem.type !== 'string'
          ) {
            return;
          }

          const type = crmItem.type.trim().toUpperCase();
          const mapCrmTypeToBelongsTo = (t: string): string => {
            if (t === 'MS_TEAMS' || t === 'MS_TEAM' || t === 'MSTEAMS' || t === 'MS-TEAMS')
              return 'MSTEAMS';
            if (t === 'GOOGLE_CONTACTS' || t === 'GOOGLECONTACTS') return 'GOOGLE_CONTACTS';
            if (t === 'GOOGLE_SHEETS' || t === 'GOOGLESHEETS') return 'GOOGLE_SHEETS';
            if (t === 'MICROSOFT365' || t === 'MICROSOFT_365' || t === 'MICROSOFT')
              return 'MICROSOFT365';
            return t;
          };

          const belongsToKey = mapCrmTypeToBelongsTo(type);

          if (seenCrms.has(belongsToKey)) {
            return;
          }
          seenCrms.add(belongsToKey);

          const icon = belongsToIcons[belongsToKey];
          if (icon) {
            groupIcons.push({
              key: crmItem?.id || belongsToKey,
              icon,
              label: BELONGS_TO_LABELS[belongsToKey] || type,
            });
          }
        });

        return (
          <div className="flex items-center gap-2">
            <NumberWithFlag number={row?.original?.contact?.phone || ''} />
            {groupIcons.length > 0 ? (
              <div className="flex items-center gap-2 -space-x-1">
                {groupIcons.map((groupIcon: any) => (
                  <CustomTooltip
                    key={groupIcon.key}
                    text={groupIcon.label.toUpperCase()}
                    side="top"
                    className="capitalize"
                  >
                    <span className="inline-flex h-6 w-6 cursor-default items-center justify-center rounded-md border border-gray-200 bg-gray-100 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
                      <img
                        src={groupIcon.icon}
                        alt={groupIcon.label}
                        className="h-4 w-4 object-contain"
                      />
                    </span>
                  </CustomTooltip>
                ))}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      header: 'Groups',
      accessorKey: 'groupMeta',
      cell: ({ getValue }: any) => {
        let members = [];
        try {
          const parsed = getValue();
          members = Array.isArray(parsed)
            ? Array.from(new Map(parsed?.map((item: any) => [item?._id, item])).values())
            : [];
        } catch (error) {
          console.error('Error parsing members:', error);
        }
        return Array.isArray(members) && members.length > 0 ? (
          <div className="flex -space-x-2">
            {members.slice(0, 5).map((item: any, index: number) => {
              const username = item?.groupName || item?.id?.groupName || 'Unknown';
              return (
                <CustomTooltip key={index} text={username} side="top">
                  <div className="w-9 h-9 flex items-center justify-center border border-white rounded-full bg-gray-200 dark:border-gray-800 capitalizes cursor-pointer">
                    <div className="w-full h-full flex items-center justify-center rounded-full border border-gray-400 bg-gray-100 text-gray-600 text-xs capitalize">
                      {getInitials(username)}
                    </div>
                  </div>
                </CustomTooltip>
              );
            })}
            {members?.length > 5 && (
              <div
                onClick={() => {
                  const transformedData = members.map((m: any) => ({
                    label: m.groupName || m.id?.groupName || 'Unknown',
                    value: m._id || m.id?._id || '',
                    role: 'Group',
                  }));
                  setModalState({ open: true, data: transformedData, type: 'Total Groups' });
                }}
                className="w-9 h-9 flex items-center justify-center border border-gray-500 !space-x-10 rounded-full bg-gray-500 text-white font-medium cursor-pointer"
              >
                +{members?.length - 5}
              </div>
            )}
          </div>
        ) : (
          <div>---</div>
        );
      },
    },
    {
      header: 'Assign Group',
      id: 'assignGroup',
      cell: ({ row }) => {
        const contact = row.original;
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <GroupAssignCell contact={contact} groupList={groupList} />
          </span>
        );
      },
    },
    {
      header: 'Tag',
      accessorKey: 'is_vip',
      cell: ({ row }) => {
        const contact = row.original;
        const { is_vip, is_blocked, is_dnc } = contact;
        let tagLabel = 'Standard';
        let bgColor = 'bg-ucass-active-bg';
        let textColor = 'text-ucass-active';
        let borderColor = 'border-ucass-active-bg';

        if (is_blocked) {
          tagLabel = 'Blocked';
          bgColor = 'bg-red-50';
          textColor = 'text-red-600';
          borderColor = 'border-red-200';
        } else if (is_vip) {
          tagLabel = 'VIP';
          bgColor = 'bg-orange-50';
          textColor = 'text-orange-600';
          borderColor = 'border-orange-200';
        } else if (is_dnc) {
          tagLabel = 'DNC';
          bgColor = 'bg-purple-50';
          textColor = 'text-purple-600';
          borderColor = 'border-purple-200';
        }

        return (
          /* Interactive cell: a click here changes the tag, it does not open
             the contact. */
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <span
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold border cursor-pointer hover:opacity-80 transition-all shadow-3xs',
                  bgColor,
                  textColor,
                  borderColor,
                )}
              >
                {tagLabel}
                <ChevronDown className="w-3.5 h-3.5 opacity-80" />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-44"
              /* Radix portals this menu into document.body, but React events still
                 bubble up the REACT tree — so without this a click on any item
                 reached the row underneath and opened the contact panel on top
                 of whatever the menu item just did. */
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                onClick={() =>
                  setTagUpdateState({
                    contact,
                    tag: is_vip ? 'STANDARD' : 'VIP',
                    label: is_vip ? 'Standard' : 'VIP',
                  })
                }
              >
                {is_vip ? 'Remove from VIP' : 'Add to VIP'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setTagUpdateState({
                    contact,
                    tag: is_dnc ? 'STANDARD' : 'DNC',
                    label: is_dnc ? 'Standard' : 'DNC',
                  })
                }
              >
                {is_dnc ? 'Remove from DNC' : 'Add to DNC'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setTagUpdateState({
                    contact,
                    tag: is_blocked ? 'STANDARD' : 'BLOCK',
                    label: is_blocked ? 'Standard' : 'Blocked',
                  })
                }
              >
                {is_blocked ? 'Unblock' : 'Block'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
    {
      header: 'Updated By',
      accessorKey: 'updatedBy',
      cell: ({ row }: any) => {
        return extractUpdatedByName(
          row?.original?.meta?.updatedBy,
          currentUserUuid,
          extensionByUuid,
        );
      },
    },

    {
      header: 'Action',
      accessorKey: 'action',
      cell: ({ row }) => {
        const contact = row.original;

        const { is_vip, is_blocked, is_dnc } = contact;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <span
                onClick={(e) => e.stopPropagation()}
                className="cursor-pointer flex items-center justify-center rounded-full w-8 h-8 bg-gray-100 text-gray-900/80 hover:bg-gray-200"
              >
                <MoreHorizontal className="w-5 h-5" />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
              {canViewContact && (
                <>
                  <DropdownMenuItem
                    onClick={() =>
                      navigate(`/contact-activity?contactId=${contact._id}`, {
                        state: { key: 'phone', value: contact.contact?.phone || '' },
                      })
                    }
                  >
                    View
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleNotesOpen(contact)}>
                    Notes
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      navigate(`/inbox?formState=contact&number=${contact?.contact?.phone || ''}`)
                    }
                  >
                    Message
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleWhatsappOpen(contact)}>
                    WhatsApp
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleContactCall(contact)}>
                    Call
                  </DropdownMenuItem>
                </>
              )}
              {canEditContact && (
                <>
                  <DropdownMenuItem
                    onClick={() =>
                      setTagUpdateState({
                        contact,
                        tag: is_vip ? 'STANDARD' : 'VIP',
                        label: is_vip ? 'Standard' : 'VIP',
                      })
                    }
                  >
                    {is_vip ? 'Remove from VIP' : 'Add to VIP'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setTagUpdateState({
                        contact,
                        tag: is_dnc ? 'STANDARD' : 'DNC',
                        label: is_dnc ? 'Standard' : 'DNC',
                      })
                    }
                  >
                    {is_dnc ? 'Remove from DNC' : 'Add to DNC'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setTagUpdateState({
                        contact,
                        tag: is_blocked ? 'STANDARD' : 'BLOCK',
                        label: is_blocked ? 'Standard' : 'Blocked',
                      })
                    }
                  >
                    {is_blocked ? 'Unblock' : 'Block'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setDrawerState({
                        addContact: true,
                        selectedContact: contact,
                      })
                    }
                  >
                    Edit
                  </DropdownMenuItem>
                </>
              )}
              {canDeleteContact && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setShowDeleteConfirmation(contact)}
                >
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="flex w-full min-h-0 flex-1 flex-col gap-2 p-3 sm:p-4">
      {selectedContactIds.length > 0 && (
        <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg animate-fade-in mb-2 shadow-2xs">
          <span className="text-sm font-semibold text-red-800">
            {selectedContactIds.length} contact{selectedContactIds.length > 1 ? 's' : ''} selected
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowBulkDeleteConfirmation(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 h-9 bg-red-600 hover:bg-red-700 text-white border-none animate-fade-in"
          >
            <Icon name="TrashBin" className="w-4 h-4" />
            Delete Selected
          </Button>
        </div>
      )}
      <TableManager
        {...{
          tableRef,
          columns,
          fetcherKey: 'getContactList',
          fetcherFn: getContactList,
          extraParams: {
            sort: { key: 'created_at', desc: true },
            ...payloadExtraParams,
          },
          getSelectedRows: handleSelectedRowsChange,
          onRowClick: onOpenContact,
          emptyTablePlaceholder: payloadExtraParams?.search
            ? 'No contacts match your search.'
            : 'No contacts found',
          descriptionEmptyTable: payloadExtraParams?.search ? '' : 'Add contacts to get started.',
        }}
      />
      <AlertConfirm
        open={showBulkDeleteConfirmation}
        setOpen={setShowBulkDeleteConfirmation}
        headerText="Delete Contacts"
        apiLoading={isPendingBulkDelete}
        onConfirm={handleBulkDelete}
        descriptionTextComp={
          <div className="flex flex-col items-center justify-center gap-4 py-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
              <Icon name="TrashBin" className="h-8 w-8 text-red-600" />
            </div>
            <p className="text-center text-gray-600">
              Are you sure you want to delete the {selectedContactIds.length} selected contact
              {selectedContactIds.length > 1 ? 's' : ''}? This action cannot be undone.
            </p>
          </div>
        }
      />
      <AlertConfirm
        open={!!tagUpdateState}
        setOpen={() => setTagUpdateState(null)}
        headerText="Please confirm"
        onConfirm={handleTagUpdate}
        apiLoading={isApiLoading}
        descriptionTextComp={
          <div className="flex flex-col items-center justify-center gap-4 py-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ucass-active-bg text-ucass-active">
              <Icon name="QuestionIcon" className="h-8 w-8" />
            </div>
            <p className="text-center text-gray-600">
              Are you sure, you want to {tagUpdateState?.tag === 'STANDARD' ? 'remove' : 'make'}{' '}
              this contact {tagUpdateState?.label}?
            </p>
          </div>
        }
      />

      {modalState?.open && (
        <AgentDetailsModal modalState={modalState} setModalState={setModalState} />
      )}
    </div>
  );
};

export default AllNewContactsList;
