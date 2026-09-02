import { Icon } from '@/assets/icons/icon';
import CustomAvatar from '@/components/custom/custom-avatar';
import CustomSelect from '@/components/custom/custom-select';
import TableManager from '@/components/custom/table-manager';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ISELECTVALUE } from '@/interfaces/api-interfaces';
import { forwardActionType } from '@/services/api';
import { ColumnDef } from '@tanstack/react-table';
import { FC, useState, useMemo, useCallback, memo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Search } from 'lucide-react';
import useDebounce from '@/hooks/use-debounce';
import { DIALER_TYPE } from '../consts';
import { useUser } from '@/hooks/use-user';

interface IMEMBER {
  first_name: string;
  last_name: string;
  label: string;
  extension: string;
  value: string;
  email: string;
  role: string;
  domain?: string;
  uuid: string;
  user_uuid: string;
  custom_role_data: { name: string };
  role_data: { name: string };
  profile?: string;
}

// Checkbox cell component with internal form subscription
const MemberCheckboxCell = ({ memberData }: { memberData: IMEMBER }) => {
  const { user } = useUser();
  const defaultDomain = user?.sip_credentials?.domain || '';
  const { control, setValue, clearErrors, watch, getValues } = useFormContext();
  const members = useWatch({ control, name: 'members', defaultValue: [] });
  const isChecked =
    Array.isArray(members) && members.some((item: any) => item?.value === memberData?.extension);

  const handleCheckChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        const extensionValue = memberData?.extension ? memberData?.extension : memberData?.value;
        const newValue = {
          label: memberData?.last_name
            ? `${memberData?.first_name} ${memberData?.last_name}`
            : memberData?.label,
          value: extensionValue,
          first_name: memberData?.first_name || '',
          last_name: memberData?.last_name || '',
          extension: extensionValue || '',
          email: memberData?.email,
          role:
            memberData?.custom_role_data?.name || memberData?.role_data?.name || memberData?.role,
          domain: memberData?.domain || defaultDomain || '',
          user_uuid: memberData?.user_uuid || memberData?.uuid || '',
        };
        /* Read at the moment of the click, not from the render that drew this
           row. Each row closed over the list as it stood when it last rendered,
           so the second agent ticked was added to a list that still had nobody
           in it and the first disappeared - one agent per campaign, with nothing
           on screen to explain it. Same bug the call queue member list had. */
        const live = getValues('members') || [];
        if (!live.some((m: IMEMBER) => m?.value === newValue.value)) {
          setValue('members', [...live, newValue], { shouldValidate: true });
        }
        clearErrors('members');
      } else {
        const filteredMembers = (getValues('members') || []).filter(
          (el: IMEMBER) => el.value !== memberData.extension,
        );
        setValue('members', filteredMembers, { shouldValidate: true });
        const currentManager = watch('manager');
        if (memberData.extension === currentManager?.value) {
          setValue('manager', { value: '' });
          clearErrors('manager');
        }
      }
    },
    [memberData, setValue, clearErrors, watch, getValues, defaultDomain],
  );

  return (
    <div className="flex justify-center text-primary hover:text-primary/80 underline underline-offset-4 text-center">
      <Checkbox checked={isChecked} onCheckedChange={handleCheckChange} />
    </div>
  );
};

MemberCheckboxCell.displayName = 'MemberCheckboxCell';

// Memoized name cell component
const MemberNameCell = memo(({ data }: { data: IMEMBER }) => {
  const fullName = `${data?.first_name}${data?.last_name ? ` ${data?.last_name}` : ''}`;
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex ">
        <CustomAvatar
          name={fullName}
          showPresence
          extension={data?.extension}
          image={data?.profile}
        />
      </div>
      <div className="flex flex-col w-full">
        <div className="flex items-center justify-between  gap-2">
          <div className="flex flex-col items-start ">
            <p className="capitalize">{fullName}</p>
            <small className="text-primary text-[10px]">
              {data?.custom_role_data?.name || data?.role_data?.name || data?.role}
            </small>
          </div>
          <div className="flex items-center gap-1 text-gray-500">
            <Icon name="Grid" className="w-4 h-4 " />
            <div>{data?.extension}</div>
          </div>
        </div>
        <p className="text-gray-500 flex justify-between">
          <div>{data?.email}</div>
        </p>
      </div>
    </div>
  );
});

MemberNameCell.displayName = 'MemberNameCell';

const SelectAllHeader = ({ currentMembers }: { currentMembers: IMEMBER[] }) => {
  const { user } = useUser();
  const defaultDomain = user?.sip_credentials?.domain || '';
  const { control, setValue, clearErrors, getValues } = useFormContext();
  const members = useWatch({ control, name: 'members', defaultValue: [] });

  const isAllChecked = useMemo(() => {
    if (!currentMembers || currentMembers.length === 0) return false;
    return currentMembers.every((member) =>
      (members || []).some((m: any) => m.value === member.extension),
    );
  }, [currentMembers, members]);

  const isIndeterminate = useMemo(() => {
    if (!currentMembers || currentMembers.length === 0) return false;
    const checkedCount = currentMembers.filter((member) =>
      (members || []).some((m: any) => m.value === member.extension),
    ).length;
    return checkedCount > 0 && checkedCount < currentMembers.length;
  }, [currentMembers, members]);

  const handleSelectAllChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        /* Live, for the same reason each row is: building from a remembered
           list is what made this screen hold one agent. */
        const newMembers = [...(getValues('members') || [])];
        currentMembers.forEach((member) => {
          const extensionValue = member.extension || member.value || '';
          if (!newMembers.some((m: any) => m.value === extensionValue)) {
            newMembers.push({
              label: member?.last_name
                ? `${member?.first_name} ${member?.last_name}`
                : member?.label,
              value: extensionValue,
              first_name: member?.first_name || '',
              last_name: member?.last_name || '',
              extension: extensionValue || '',
              email: member?.email,
              role: member?.custom_role_data?.name || member?.role_data?.name || member?.role,
              domain: member?.domain || defaultDomain || '',
              user_uuid: member?.user_uuid || member?.uuid || '',
            });
          }
        });
        setValue('members', newMembers, { shouldValidate: true });
        clearErrors('members');
      } else {
        const currentExtensions = currentMembers.map((m) => m.extension);
        const filteredMembers = (getValues('members') || []).filter(
          (m: any) => !currentExtensions.includes(m.value),
        );
        setValue('members', filteredMembers, { shouldValidate: true });

        const manager = getValues('manager');
        if (manager && currentExtensions.includes(manager.value)) {
          setValue('manager', { value: '' });
          clearErrors('manager');
        }
      }
    },
    [currentMembers, members, setValue, clearErrors, getValues, defaultDomain],
  );

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs font-semibold text-gray-500">Members</span>
      <div className="flex justify-center text-primary">
        <Checkbox
          checked={isAllChecked ? true : isIndeterminate ? 'indeterminate' : false}
          onCheckedChange={handleSelectAllChange}
        />
      </div>
    </div>
  );
};

const AgentsList: FC<any> = ({ scriptList = [], dialMethod = DIALER_TYPE.PREVIEW }) => {
  const {
    formState: { errors },
    watch,
    setValue,
  } = useFormContext();
  const selectedScript = watch('script');
  const selectedSite = watch('siteId')?.value;
  const [searchKey, setSearchKey] = useState('');
  const debouncedSearchKey = useDebounce(searchKey, 500);
  const [currentMembers, setCurrentMembers] = useState<IMEMBER[]>([]);

  const handleSuccess = useCallback((tbldata: any) => {
    const rows = tbldata?.data?.data?.result?.rows || [];
    setCurrentMembers(rows);
  }, []);

  const columns: ColumnDef<IMEMBER>[] = useMemo(
    () => [
      {
        header: () => <SelectAllHeader currentMembers={currentMembers} />,
        id: 'action',
        accessorKey: 'company_uuid',
        cell: ({ row }) => {
          return <MemberCheckboxCell memberData={row?.original} />;
        },
      },

      {
        header: 'Name',
        accessorKey: 'first_name',
        cell: ({ row }: any) => {
          return <MemberNameCell data={row?.original} />;
        },
      },
    ],
    [currentMembers],
  );
  console.log('errors', errors?.script);
  return (
    <div className="flex h-[calc(100vh_-_22.5rem)] flex-col overflow-auto">
      <div className="w-full">
        <div className="w-full flex flex-row items-end gap-6 flex-wrap ">
          {dialMethod === DIALER_TYPE.PREVIEW && (
            <div className="flex items-center gap-3 pb-1">
              <h3 className="text-gray-900 font-semibold text-sm whitespace-nowrap">
                Allow Skipping
              </h3>
              <Switch
                onCheckedChange={(checked) => {
                  setValue('allowSkipping', checked);
                }}
                checked={watch('allowSkipping')}
              />
            </div>
          )}

          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex items-center gap-3 pb-1">
              <h3 className="text-gray-900 font-semibold text-sm whitespace-nowrap">
                Agent Scripting
              </h3>
              <Switch
                onCheckedChange={(checked) => {
                  setValue('agentScripting', checked);
                }}
                checked={watch('agentScripting')}
              />
            </div>
            {watch('agentScripting') && (
              <div className="w-[200px] sm:w-[240px]">
                <CustomSelect
                  className="w-full"
                  placeholder="Select Option"
                  label=""
                  options={scriptList
                    ?.filter((item: any) => item?.dialMethod === dialMethod)
                    .map((script: { name: string; _id: string }) => ({
                      label: script?.name,
                      value: script?._id,
                    }))}
                  handleChange={(e: ISELECTVALUE | null) => {
                    setValue(`script`, e || { label: '', value: '' }, { shouldValidate: true });
                  }}
                  error={(errors as any)?.script?.value?.message ?? errors?.script?.message}
                  value={selectedScript?.value ? selectedScript : null}
                  menuPlacement="auto"
                />
              </div>
            )}
          </div>

          {/* Search Input on the right side */}
          <div className="relative w-full max-w-sm ml-auto pb-0.5">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search by name, email, or extension..."
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              className="pl-10 h-9 text-sm"
            />
          </div>
        </div>
      </div>
      {(errors?.members as any)?.message && (
        <div className="flex gap-2 mt-2 mb-1">
          {errors?.members && (
            <p className="text-red-500 text-sm font-medium">{(errors?.members as any)?.message} </p>
          )}
        </div>
      )}

      <div className="mt-3 flex-grow">
        <TableManager
          {...{
            columns,
            fetcherKey: 'forwardActionType',
            fetcherFn: forwardActionType,
            onSuccess: handleSuccess,
            extraParams: {
              site_uuid: selectedSite,
              type: 'EXTENSION',
              page: 1,
              limit: 999,
              search: debouncedSearchKey,
            },
            showPagination: false,
          }}
        />
      </div>
    </div>
  );
};

export default AgentsList;
