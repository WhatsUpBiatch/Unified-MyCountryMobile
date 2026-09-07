import { Icon, IconName } from '@/assets/icons/icon';
import CustomTooltip from '@/components/custom/custom-tooltip';
import SideDrawer from '@/components/custom/side-drawer';
import TableManager from '@/components/custom/table-manager';
import { deleteAddress, getAddressesList, updateAddress, uploadAddressProof } from '@/services/api';
import { useState } from 'react';
import CreateNewAddress from './create-new-address';
import AlertConfirm from '@/components/custom/alert-confirm';
import { Button } from '@/components/ui/button';
import Loader from '@/components/custom/loader';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addressUpdateSchema, initialState } from '../../all-numbers/constants';
import { yupResolver } from '@hookform/resolvers/yup';

const Addresses = ({ search }: { search: string }) => {
  const [rowData, setRowData] = useState<any>(null);
  const [drawerState, setDrawerState] = useState({
    editAddress: false,
  });
  const [modalState, setModalState] = useState({
    deleteAddress: false,
  });
  const queryClient: any = useQueryClient();
  const handleDrawerClose = () => {
    setDrawerState((prev) => ({ ...prev, editAddress: false }));
    setRowData(null);
  };
  const handleModalClose = () => {
    setModalState((prev) => ({ ...prev, deleteAddress: false }));
    setRowData(null);
  };
  const formInstance = useForm<any>({
    // defaultValues: initialAddressState,
    defaultValues: initialState,
    resolver: yupResolver(addressUpdateSchema),
    mode: 'onChange',
  });
  const { handleSubmit, getValues } = formInstance;
  const { mutate: mutateUpload, isPending: isUploadProofPending } = useMutation({
    mutationKey: ['uploadAddressProof'],
    mutationFn: uploadAddressProof,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['getAddressesList'],
      });
    },
  });
  const { mutate: mutateUpdateAddress, isPending: isUpdateAddressPending } = useMutation({
    mutationKey: ['updateAddress'],
    mutationFn: updateAddress,
    onSuccess: () => {
      const addressId = rowData?.formData?.address_id;
      const identityId = rowData?.formData?.identity_id;
      const files = getValues('addressProofs') || [];

      const proofFiles = files?.filter((item: any) => item?.file instanceof File);
      if (proofFiles?.length > 0) {
        const formData = new FormData();
        proofFiles?.forEach((item: any) => {
          formData.append('identity_address_proof', item?.file);
          formData.append('proof_type_id[]', item?.proof_type_id?.value);
        });
        formData.append('type', 'address');
        formData.append('address_id', addressId);
        formData.append('identity_id', identityId);
        mutateUpload(formData);
      }
      queryClient.invalidateQueries({
        queryKey: ['getAddressesList'],
      });
      handleDrawerClose();
    },
  });

  const isLoading = [isUpdateAddressPending, isUploadProofPending].some((v) => v);
  const { mutateAsync: mutateDeleteAddress, isPending: isDeleteAddressPending } = useMutation({
    mutationKey: ['deleteAddress'],
    mutationFn: deleteAddress,
    onSuccess: () => {
      handleModalClose();
      queryClient.invalidateQueries({
        queryKey: ['getAddressesList'],
      });
    },
  });

  const columns = [
    {
      /* Street, then the place. Four of the six columns held one line of one
         address between them — "United States/Texas", "Austin", "78701",
         "600 Congress Ave" — so reading one address meant reading across four
         headings, and the table was too wide to do it without scrolling. */
      header: 'Address',
      accessorKey: 'address.address',
      cell: ({ row }: any) => {
        const { address = '', city = '', zipcode = '' } = row?.original?.address || {};
        const below = [city, zipcode].filter(Boolean).join(' \u00b7 ');
        return (
          <span className="mcm-ident-who">
            <b>{address || 'No street address'}</b>
            {below ? <span>{below}</span> : null}
          </span>
        );
      },
    },
    {
      header: 'Country',
      accessorKey: 'address.country',
      cell: ({ row }: any) => {
        const { country = '', state = '' } = row?.original?.address || {};
        return (
          <span className="mcm-ident-place">
            <b>{country || 'Unknown'}</b>
            {state ? <span>{state}</span> : null}
          </span>
        );
      },
    },
    {
      header: 'Proofs',
      accessorKey: 'address_proof',
      cell: ({ row }: any) => {
        const count = (row?.original?.address_proof || []).length;
        return count ? (
          <span className="mcm-ident-n">
            {count} <span>{count === 1 ? 'proof' : 'proofs'}</span>
          </span>
        ) : (
          <span className="mcm-ident-gap">None uploaded</span>
        );
      },
    },
    {
      header: 'Description',
      accessorKey: 'address.description',
      cell: ({ row }: any) =>
        row?.original?.address?.description || <span className="mcm-numnone">&mdash;</span>,
    },
    {
      header: 'Action',
      accessorKey: 'action',
      cell: (props: any) => {
        const data = props?.row?.original;
        if (data?.is_primary) return;
        const actions = [
          {
            icon: 'EditStrokIcon',
            onClick: () => {
              setRowData({ isEdit: true, formData: data });
              setDrawerState((prev) => ({ ...prev, editAddress: true }));
            },
            className: '',
            tooltipText: 'Edit',
          },
          {
            icon: 'TrashBin',
            onClick: () => {
              setRowData({ isEdit: true, formData: data });
              setModalState((prev) => ({ ...prev, deleteAddress: true }));
            },
            className: 'is-risky',
            tooltipText: 'Delete',
          },
        ];

        return (
          /* The key belongs on the element the map returns, not on a child of
             it — React was keying nothing here. And these are buttons: they
             were divs with a click handler, so neither could be reached or
             fired from a keyboard. */
          <div className="mcm-rowacts">
            {actions?.map((action) => (
              <CustomTooltip key={action.tooltipText} text={action.tooltipText} side="top">
                <button
                  type="button"
                  aria-label={action.tooltipText}
                  className={`mcm-rowact ${action.className}`}
                  onClick={() => action.onClick()}
                >
                  <Icon name={action.icon as IconName} className="w-4 h-4" />
                </button>
              </CustomTooltip>
            ))}
          </div>
        );
      },
    },
  ];

  const onSubmit = ({
    // requirements_type,
    // requirements_country,
    // number_type,
    address_state,
    addressDescription,
    country,
    addressProofs,
    ...rest
  }: {
    requirements_type?: string;
    requirements_country?: string;
    number_type?: string;
    country?: any;
    address_state?: string;
    addressDescription?: string;
    addressProofs?: any;
    rest?: object;
  }) => {
    // console.log(requirements_country, requirements_type, number_type);
    const payload = {
      ...rest,
      identity_id: rowData?.isEdit ? rowData?.formData?.identity_id : rowData?.formData?.id,
      address_id: rowData?.isEdit ? rowData?.formData?.address_id : rowData?.formData?.id,
      country: country?.value,
      state: address_state,
      description: addressDescription,
      proofs: addressProofs,
      ...(rowData?.isEdit && { uuid: rowData?.id }),
    };
    mutateUpdateAddress(payload);
  };
  return (
    <div>
      <div className="mcm-ident-tab">
        <TableManager
          {...{
            columns,
            search,
            fetcherKey: 'getAddressesList',
            fetcherFn: getAddressesList,
            emptyTablePlaceholder: 'No addresses yet',
            descriptionEmptyTable:
              'Service addresses are created while buying a number that requires one. Any you add during that flow appear here.',
          }}
        />
      </div>
      {drawerState.editAddress && (
        <SideDrawer
          width="min(1040px, 84vw)"
          title="Edit Address"
          isOpen={drawerState.editAddress}
          isTab={false}
          handleClose={handleDrawerClose}
          content={
            <form onSubmit={handleSubmit(onSubmit)}>
              <CreateNewAddress rowData={rowData} formInstance={formInstance} />
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={handleDrawerClose} variant="transparent">
                  Cancel
                </Button>
                <Button disabled={isLoading} variant="outline" type="submit" className="min-w-32">
                  {isLoading && <Loader variant="blue" />}Update
                </Button>
              </div>
            </form>
          }
        />
      )}
      {modalState?.deleteAddress && (
        <AlertConfirm
          {...{
            apiLoading: isDeleteAddressPending,
            onConfirm: () => {
              mutateDeleteAddress({ address_id: rowData?.formData?.address_id });
            },
            open: modalState?.deleteAddress,
            setOpen: () => handleModalClose(),
          }}
        />
      )}
    </div>
  );
};

export default Addresses;
