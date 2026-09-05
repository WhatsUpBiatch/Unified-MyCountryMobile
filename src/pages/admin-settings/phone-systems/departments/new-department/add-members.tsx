import { Icon } from '@/assets/icons/icon';
import CustomAvatar from '@/components/custom/custom-avatar';
import TableManager from '@/components/custom/table-manager';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { forwardActionType } from '@/services/api';
import { useCallback, useState, useMemo, memo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Search } from 'lucide-react';
import useDebounce from '@/hooks/use-debounce';
import { SearchLine } from '@/assets/icons';

interface Member {
  first_name: string;
  last_name?: string;
  extension: string;
  email?: string;
  role: string;
  uuid: string;
  profile?: string;
  custom_role_data?: { name: string };
  role_data?: { name: string };
  value?: string;
  label?: string;
}

// Checkbox cell component with internal form subscription and logic
const MemberCheckboxCell = ({ memberData }: { memberData: Member }) => {
  const { control, setValue, clearErrors } = useFormContext();
  const members = useWatch({ control, name: 'members', defaultValue: [] });
  const manager = useWatch({ control, name: 'manager', defaultValue: { value: '' } });
  const isChecked =
    Array.isArray(members) && members.some((item: any) => item?.value === memberData?.extension);

  const handleCheckChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        const newValue = {
          label: memberData.last_name
            ? `${memberData.first_name} ${memberData.last_name}`
            : memberData.label || `${memberData.first_name}`,
          value: memberData.extension || memberData.value || '',
          email: memberData.email,
          profile: memberData.profile,
          role: memberData.custom_role_data?.name || memberData.role_data?.name || memberData.role,
          user_uuid: memberData.uuid,
        };

        // Check if member already exists to ensure uniqueness
        const memberExists = members.some(
          (member: any) =>
            member.value === newValue.value || member.user_uuid === newValue.user_uuid,
        );

        if (!memberExists) {
          setValue('members', [...members, newValue], { shouldValidate: true });
          clearErrors('members');
        }
      } else {
        const filteredMembers = members.filter((el: any) => el.value !== memberData.extension);
        setValue('members', filteredMembers, { shouldValidate: true });
        if (memberData.extension === manager?.value) {
          setValue('manager', { value: '' });
          clearErrors('manager');
        }
      }
    },
    [memberData, members, manager, setValue, clearErrors],
  );

  return (
    <div className="flex justify-center text-primary hover:text-primary/80 underline underline-offset-4 text-center">
      <Checkbox onCheckedChange={handleCheckChange} checked={isChecked} />
    </div>
  );
};

MemberCheckboxCell.displayName = 'MemberCheckboxCell';

// Manager radio cell component with internal form subscription and logic
const ManagerRadioCell = ({ memberData }: { memberData: Member }) => {
  const { control, setValue, clearErrors } = useFormContext();
  const members = useWatch({ control, name: 'members', defaultValue: [] });
  const manager = useWatch({ control, name: 'manager', defaultValue: { value: '' } });
  // memberData?.custom_role_data?.name ||
  const role = memberData?.role_data?.name || memberData?.role;
  const isEnabled =
    Array.isArray(members) &&
    members.some((item: any) => item?.value === memberData?.extension) &&
    ['MANAGER', 'ADMIN', 'SUB-ADMIN'].includes(role);

  const handleManagerChange = useCallback(
    (value: string) => {
      if (memberData.role === 'AGENT') return;

      if (value === 'true') {
        const managerVal = {
          value: memberData.extension || memberData.value || '',
          label: memberData.last_name
            ? `${memberData.first_name} ${memberData.last_name}`
            : memberData.label || `${memberData.first_name}`,
          email: memberData.email,
          profile: memberData.profile,
          role: memberData.custom_role_data?.name || memberData.role_data?.name || memberData.role,
          user_uuid: memberData.uuid,
        };
        const memberExists = members.some((m: any) => m.value === managerVal.value);
        const updatedMembers = memberExists ? [...members] : [...members, managerVal];

        setValue('manager', managerVal);
        setValue('members', updatedMembers, { shouldValidate: true });
        clearErrors('manager');
      }
    },
    [memberData, members, setValue, clearErrors],
  );

  return (
    <div className="flex justify-center">
      <RadioGroup onValueChange={handleManagerChange}>
        <RadioGroupItem
          value={'true'}
          disabled={!isEnabled}
          checked={manager?.value === memberData?.extension}
        />
      </RadioGroup>
    </div>
  );
};

ManagerRadioCell.displayName = 'ManagerRadioCell';

// Memoized name cell component
const MemberNameCell = memo(({ data }: { data: Member }) => {
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
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col items-start">
            <p className="capitalize">{fullName}</p>
            <small className="text-primary text-[10px]">
              {data?.custom_role_data?.name || data?.role_data?.name || data?.role}
            </small>
          </div>
          <div className="flex items-center gap-1 text-gray-500">
            <Icon name="Grid" className="w-4 h-4" />
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

const SelectAllHeader = ({ currentMembers }: { currentMembers: Member[] }) => {
  const { control, setValue, clearErrors, getValues } = useFormContext();
  const members = useWatch({ control, name: 'members', defaultValue: [] });

  const isAllChecked = useMemo(() => {
    if (!currentMembers || currentMembers.length === 0) return false;
    return currentMembers.every((member) => members.some((m: any) => m.value === member.extension));
  }, [currentMembers, members]);

  const isIndeterminate = useMemo(() => {
    if (!currentMembers || currentMembers.length === 0) return false;
    const checkedCount = currentMembers.filter((member) =>
      members.some((m: any) => m.value === member.extension),
    ).length;
    return checkedCount > 0 && checkedCount < currentMembers.length;
  }, [currentMembers, members]);

  const handleSelectAllChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        const newMembers = [...members];
        currentMembers.forEach((member) => {
          const extension = member.extension || member.value || '';
          if (!newMembers.some((m: any) => m.value === extension)) {
            newMembers.push({
              label: member.last_name
                ? `${member.first_name} ${member.last_name}`
                : member.label || `${member.first_name}`,
              value: extension,
              email: member.email,
              profile: member.profile,
              role: member.custom_role_data?.name || member.role_data?.name || member.role,
              user_uuid: member.uuid,
            });
          }
        });
        setValue('members', newMembers, { shouldValidate: true });
        clearErrors('members');
      } else {
        const currentExtensions = currentMembers.map((m) => m.extension);
        const filteredMembers = members.filter((m: any) => !currentExtensions.includes(m.value));
        setValue('members', filteredMembers, { shouldValidate: true });

        const manager = getValues('manager');
        if (manager && currentExtensions.includes(manager.value)) {
          setValue('manager', { value: '' });
          clearErrors('manager');
        }
      }
    },
    [currentMembers, members, setValue, clearErrors, getValues],
  );

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs font-semibold text-gray-500">People</span>
      <div className="flex justify-center text-primary">
        <Checkbox
          checked={isAllChecked ? true : isIndeterminate ? 'indeterminate' : false}
          onCheckedChange={handleSelectAllChange}
        />
      </div>
    </div>
  );
};

const AddMembers = () => {
  const {
    watch,
    formState: { errors },
  } = useFormContext();

  const siteWatch = watch('site');
  const [searchKey, setSearchKey] = useState('');
  const debouncedSearchKey = useDebounce(searchKey, 500);
  const [currentMembers, setCurrentMembers] = useState<Member[]>([]);

  const handleSuccess = useCallback((tbldata: any) => {
    const rows = tbldata?.data?.data?.result?.rows || [];
    setCurrentMembers(rows);
  }, []);

  const columns = useMemo(
    () => [
      {
        header: () => <SelectAllHeader currentMembers={currentMembers} />,
        accessorKey: 'createdAt',
        cell: ({ row }: any) => <MemberCheckboxCell memberData={row?.original} />,
        meta: {
          textAlign: 'center',
        },
      },
      {
        header: 'Manager',
        accessorKey: 'updatedAt',
        cell: ({ row }: any) => <ManagerRadioCell memberData={row?.original} />,
        meta: {
          textAlign: 'center',
        },
      },
      {
        header: 'Name',
        accessorKey: 'first_name',
        cell: ({ row }: any) => <MemberNameCell data={row?.original} />,
      },
    ],
    [currentMembers],
  );

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-x-auto overflow-y-hidden">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
        {Object?.keys(errors)?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {errors?.members && (
              <p className="text-red-500 text-sm">
                {typeof errors?.members?.message === 'string' ? errors.members.message : null}
              </p>
            )}
            {errors?.manager && (
              <p className="text-red-500 text-sm">
                {errors.manager &&
                  'value' in errors.manager &&
                  typeof errors.manager.value?.message === 'string' && (
                    <p className="text-red-500 text-sm">{errors.manager.value.message}</p>
                  )}
              </p>
            )}
          </div>
        )}

        {/* Search Input */}
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Search by name, email, or extension..."
            value={searchKey}
            Icon={<SearchLine className=" text-gray-700" />}
            IconPosition="left-0 pl-2 inset-y-0"
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith(' ')) return;
              setSearchKey(e.target.value);
            }}
            className="pl-10 h-9 text-sm"
          />
        </div>

        {/* <div className="w-full flex flex-col gap-2"> */}
        <div className="min-h-0 flex-1">
          <TableManager
            {...{
              emptyTablePlaceholder: 'Nobody to add',
              descriptionEmptyTable: 'There is nobody available to put in this group yet.',
              fetcherKey: 'forwardActionType',
              fetcherFn: forwardActionType,
              columns,
              tableMaxHeight: '100%',
              onSuccess: handleSuccess,
              extraParams: {
                site_uuid: siteWatch?.value,
                type: 'EXTENSION',
                search: debouncedSearchKey,
              },
            }}
          />
        </div>
        {/* </div> */}
      </div>
    </section>
  );
};

export default AddMembers;
