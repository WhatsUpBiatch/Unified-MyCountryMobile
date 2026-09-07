import { Plus, SearchLine } from '@/assets/icons';
import { Icon } from '@/assets/icons/icon';
import Loader from '@/components/custom/loader';
import NumberWithFlag from '@/components/custom/number-with-flag';
import { invalidateNumberLists } from '@/lib/number-list-cache';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useUser } from '@/hooks/use-user';
import { capitalizeFirstLetter, handleAlert } from '@/lib/utils';
import { allNumbersList, assignNumberUser, removeForwarding } from '@/services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FC, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface AssignCallerIdModalProps {
  open: boolean;
  onClose: () => void;
  userData: any;
  onOpenMultipleAssignModal?: (users: any[]) => void;
}

const AssignCallerIdModal: FC<AssignCallerIdModalProps> = ({
  open,
  onClose,
  userData,
  onOpenMultipleAssignModal,
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const [search, setSearch] = useState('');
  const [removingForwardingUuid, setRemovingForwardingUuid] = useState('');
  const [reassignData, setReassignData] = useState<{
    open: boolean;
    didNumber: string;
    assignedTo: string;
  }>({
    open: false,
    didNumber: '',
    assignedTo: '',
  });

  const { data: dataGetAllNumbers = [], isLoading: isLoadingGetAllNumbers } = useQuery({
    queryKey: ['numbers-list-modal', 1, 9999999],
    queryFn: () =>
      allNumbersList({
        page: 1,
        limit: 9999999,
      }),
    select: (data: any) => data?.data?.data?.result?.rows || [],
    enabled: open,
  });

  const { mutate: mutateAssignNumber, isPending: isPendingAssignNumber } = useMutation({
    mutationFn: assignNumberUser,
    onSuccess: ({ data }: any) => {
      queryClient.invalidateQueries({ queryKey: ['fetchUsersList'] });
      queryClient.invalidateQueries({ queryKey: ['numbers-list-modal'] });
      handleAlert({
        text: data?.data?.message || 'Number assigned successfully',
        type: 'success',
      });
      setSearch('');
      setReassignData({
        open: false,
        didNumber: '',
        assignedTo: '',
      });
      onClose();
    },
  });

  const { mutate: mutateRemoveForwarding, isPending: isPendingRemoveForwarding } = useMutation({
    mutationFn: removeForwarding,
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['numbers-list-modal'] });
      invalidateNumberLists(queryClient);
      handleAlert({
        text: data?.data?.data?.message || 'Forwarding Removed Successfully.',
        type: 'success',
      });
    },
    onSettled: () => {
      setRemovingForwardingUuid('');
    },
  });

  const targetUserUuid = userData?.user_uuid || userData?.uuid;
  const purchasedLicenses = Number(user?.purchased_licenses || 0);
  const shouldOpenMultipleAssignModal =
    !isLoadingGetAllNumbers && purchasedLicenses > dataGetAllNumbers.length;
  const fullName =
    `${capitalizeFirstLetter(userData?.first_name || '')}${userData?.last_name ? ` ${userData?.last_name}` : ''}`.trim() ||
    'this person';

  const filteredNumbers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return dataGetAllNumbers;

    return dataGetAllNumbers?.filter((item: any) => {
      const assignedName = `${item?.User?.first_name || ''} ${item?.User?.last_name || ''}`
        .trim()
        .toLowerCase();

      return (
        String(item?.did_number || '')
          .toLowerCase()
          .includes(keyword) ||
        String(item?.did_name || '')
          .toLowerCase()
          .includes(keyword) ||
        assignedName.includes(keyword)
      );
    });
  }, [dataGetAllNumbers, search]);

  const handleAssignNumber = (didNumber: string, type?: 're-assign') => {
    if (!didNumber || !targetUserUuid) return;

    mutateAssignNumber({
      user_uuid: targetUserUuid,
      did_number: didNumber,
      ...(type ? { type } : {}),
    });
  };

  const handleRemoveForwarding = (uuid?: string) => {
    if (!uuid) return;

    setRemovingForwardingUuid(uuid);
    mutateRemoveForwarding({ uuid });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) {
          setSearch('');
          setReassignData({
            open: false,
            didNumber: '',
            assignedTo: '',
          });
          onClose();
        }
      }}
    >
      <DialogContent className="w-[680px] p-0 gap-0" showCloseButton={false}>
        <div className="p-5 border-b border-gray-200 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h4 className="text-gray-900 font-semibold text-xl">Assign Caller ID</h4>
            <p className="text-sm text-gray-500">
              Selecting number for <span className="text-primary font-semibold">{fullName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setReassignData({
                open: false,
                didNumber: '',
                assignedTo: '',
              });
              onClose();
            }}
            className="text-gray-500 hover:text-gray-900 cursor-pointer"
          >
            <Icon name="XIcon" className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <Input
            placeholder="Search numbers..."
            className="pl-10"
            IconPosition="left-0 pl-3 inset-y-0"
            value={search}
            inputMode="numeric"
            pattern="[0-9]*"
            onChange={(e) => {
              const numericValue = e.target.value.replace(/\D/g, '');
              setSearch(numericValue);
            }}
            Icon={<SearchLine className="text-gray-500" />}
          />

          <div className="flex flex-col gap-3 max-h-[calc(100vh_-_23rem)] overflow-y-auto pr-1 min-h-[240px]">
            {isLoadingGetAllNumbers ? (
              <div className="w-full h-full min-h-[200px] flex items-center justify-center">
                <Loader variant="blue" />
              </div>
            ) : filteredNumbers?.length > 0 ? (
              filteredNumbers?.map((item: any) => {
                const assignedName =
                  `${item?.User?.first_name || ''}${item?.User?.last_name ? ` ${item?.User?.last_name}` : ''}`.trim();
                const isAssigned = Boolean(item?.user_uuid || assignedName);
                const isForwarded = Boolean(item?.forward_call_actions);
                const isRemovingThisForwarding =
                  isPendingRemoveForwarding && removingForwardingUuid === item?.uuid;

                return (
                  <div
                    key={item?.uuid || item?.did_number}
                    className="w-full border border-gray-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="flex flex-col gap-1">
                      <NumberWithFlag number={item?.did_number} />
                      {isAssigned ? (
                        <p className="text-xs font-medium flex items-center gap-1 text-gray-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
                          Assigned to
                          {assignedName ? (
                            <span className="text-gray-700">{assignedName}</span>
                          ) : (
                            <span className="text-gray-700">someone else</span>
                          )}
                        </p>
                      ) : isForwarded ? (
                        <p className="text-primary text-xs font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                          Forwarded
                        </p>
                      ) : (
                        <p className="text-green-600 text-xs font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          {item?.type === 'F' ? 'Free' : 'Paid'}
                        </p>
                      )}
                    </div>

                    {isAssigned ? (
                      <Button
                        size="sm"
                        variant="destructiveOutline"
                        className="min-w-[110px]"
                        disabled={isPendingAssignNumber}
                        onClick={() => {
                          setReassignData({
                            open: true,
                            didNumber: item?.did_number || '',
                            assignedTo: assignedName || 'someone else',
                          });
                        }}
                      >
                        <Icon name="Refresh" className="w-4 h-4" />
                        Re-assign
                      </Button>
                    ) : isForwarded ? (
                      <Button
                        size="sm"
                        variant="destructiveOutline"
                        className="min-w-[150px] shrink-0"
                        disabled={isPendingAssignNumber || isPendingRemoveForwarding}
                        onClick={() => handleRemoveForwarding(item?.uuid)}
                      >
                        {isRemovingThisForwarding ? (
                          <Loader variant="blue" />
                        ) : (
                          <>
                            <Icon name="CallCancelLine" className="w-4 h-4" />
                            Remove Forwarding
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-w-[110px]"
                        disabled={isPendingAssignNumber || isPendingRemoveForwarding}
                        onClick={() => handleAssignNumber(item?.did_number)}
                      >
                        <Icon name="AssignNumberLine" className="w-4 h-4" />
                        Assign
                      </Button>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="w-full h-full min-h-[200px] flex items-center justify-center text-sm text-gray-500">
                No numbers found.
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => {
              setSearch('');
              setReassignData({
                open: false,
                didNumber: '',
                assignedTo: '',
              });
              onClose();
              if (shouldOpenMultipleAssignModal) {
                onOpenMultipleAssignModal?.([
                  {
                    ...userData,
                    user_uuid: targetUserUuid,
                    uuid: targetUserUuid,
                  },
                ]);
                return;
              }
              navigate('/admin-settings/numbers/all?openAddNumber=1', {
                state: location.state,
              });
            }}
          >
            <Plus className="w-3 h-3" />
            Add Additional Number
          </Button>
          <Button
            type="button"
            variant="transparent"
            className="text-gray-700"
            onClick={() => {
              setSearch('');
              setReassignData({
                open: false,
                didNumber: '',
                assignedTo: '',
              });
              onClose();
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>

      <Dialog
        open={reassignData.open}
        onOpenChange={(val) =>
          setReassignData((prev) => ({
            ...prev,
            open: val,
          }))
        }
      >
        <DialogContent className="w-[460px] max-w-[calc(100%-2rem)] p-6" showCloseButton={false}>
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center text-red-500">
              <Icon name="AlertIcon" className="w-8 h-8" />
            </div>

            <h5 className="text-gray-900 text-[34px] leading-none font-semibold">
              Re-assign Caller ID?
            </h5>

            <p className="text-gray-500 text-sm leading-6">
              The number{' '}
              <span className="text-gray-800 font-semibold">{reassignData.didNumber}</span> is
              currently assigned to{' '}
              <span className="text-primary font-semibold">{reassignData.assignedTo}</span>.{' '}
              Re-assigning it will remove it from them and assign it to{' '}
              <span className="text-green-600 font-semibold">{fullName}</span>. Proceed?
            </p>

            <div className="w-full flex items-center gap-3 pt-1">
              <Button
                type="button"
                variant="secondary"
                className="flex-1 min-w-0"
                onClick={() =>
                  setReassignData({
                    open: false,
                    didNumber: '',
                    assignedTo: '',
                  })
                }
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1 min-w-0"
                disabled={isPendingAssignNumber}
                onClick={() => {
                  handleAssignNumber(reassignData.didNumber, 're-assign');
                  setReassignData({
                    open: false,
                    didNumber: '',
                    assignedTo: '',
                  });
                }}
              >
                {isPendingAssignNumber ? <Loader variant="blue" /> : 'Yes, Re-assign'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};

export default AssignCallerIdModal;
