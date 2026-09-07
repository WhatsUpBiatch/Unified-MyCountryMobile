import CustomSelect from '@/components/custom/custom-select';
import { useFormContext } from 'react-hook-form';
import { MEMBER_RING_STRATEGY_OPTIONS } from '../../../constants';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import SelectedMemberList from './selected-member-list';
import CustomAvatar from '@/components/custom/custom-avatar';
import { Icon } from '@/assets/icons/icon';
import { DEPARTMENT_RING_STRATEGY, DEPARTMENT_RING_STRATEGY_DESC } from './consts';

const RingStrategy = () => {
  const { setValue, watch } = useFormContext();
  const [watchRingStrategy, watchMembers] = watch(['ring_strategy', 'members', 'manager']);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-col gap-4 px-1 sm:px-3 lg:flex-row lg:items-start lg:gap-5">
        <p className="text-sm text-gray-800 lg:max-w-xs">
          Set how you'd like to answer calls when conditions are met.{' '}
        </p>
        <div className="w-full">
          <CustomSelect
            options={MEMBER_RING_STRATEGY_OPTIONS}
            handleChange={(value) => {
              setValue('ring_strategy', value);
            }}
            value={watch('ring_strategy')}
            placeholder={'Select ring strategy'}
            className="w-full max-w-[300px]"
          />
          <p className="text-gray-800 text-xs mt-3">
            {DEPARTMENT_RING_STRATEGY_DESC[watchRingStrategy?.value] || ''}
          </p>
        </div>
      </div>
      {/* <div className="flex flex-col gap-1">
        <p className="font-semibold text-gray-900 truncate text-md">Group manager</p>
        <div className="w-1/4 px-1.5">
          <div className="flex items-center justify-between border border-primary rounded-lg w-full p-3 gap-1 bg-white">
            <CustomAvatar
              name={watchManager?.label}
              showPresence
              extension={watchManager?.value || watchManager?.value || ''}
              image={watchManager?.profile}
            />

            <div className="flex flex-col w-[calc(100%_-_3.5rem)]">
              <div className="flex items-center justify-between gap-2">
                <p className="capitalize text-md truncate">{watchManager?.label}</p>
                <div className="flex gap-1">
                  <Icon name="Grid" className="w-4 h-4 text-gray-500" />
                  <div className="text-gray-500 truncate text-xs">
                    {watchManager?.value || watchManager?.value || ''}
                  </div>
                </div>
              </div>
              <small className="text-primary text-[10px]">{watchManager?.role}</small>
              <div className="flex flex-col gap-1">
                <small className="text-gray-500 truncate text-sm">
                  <CustomTooltip text={watchManager?.email}>{watchManager?.email}</CustomTooltip>
                </small>
              </div>
            </div>
          </div>
        </div>
      </div> */}
      <div className="w-full">
        <p className="font-semibold text-gray-900 truncate text-md mb-2">People in this group</p>
        {watchRingStrategy?.value !== DEPARTMENT_RING_STRATEGY.LINEAR ? (
          <div className="w-full lg:w-1/2">
            <div className="flex flex-col gap-2 overflow-auto border border-gray-200 rounded-xl">
              <Table className="w-full text-sm text-gray-700 h-full ">
                <TableHeader className="bg-gray-100/40 text-gray-90/80">
                  <TableRow>
                    <TableHead className="px-4 py-2 font-medium text-left text-text-gray-90/80">
                      Name
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-gray-200 bg-white w-full font-normal">
                  {watchMembers.map((data: any, index: any) => {
                    const fullName = data?.last_name
                      ? `${data?.first_name} ${data?.last_name}`
                      : data?.label;

                    return (
                      <TableRow key={`${data?.user_uuid}-${index}`} className="h-8">
                        <TableCell className="px-4 py-2 border-b">
                          <div className="flex items-center gap-3">
                            <CustomAvatar
                              name={fullName}
                              showPresence
                              extension={data?.value}
                              image={data?.profile}
                            />
                            <div className="flex flex-col w-full">
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="capitalize font-medium text-sm">{fullName}</p>
                                  <p className="text-primary text-[11px]">{data?.role}</p>
                                </div>
                                <div className="flex items-center gap-1 text-gray-500 text-sm">
                                  <Icon name="Grid" className="w-4 h-4" />
                                  <span>{data?.value}</span>
                                </div>
                              </div>
                              {data?.email && (
                                <p className="text-gray-500 text-[11px] truncate">{data?.email}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="w-full lg:w-1/2">
            <div className="flex flex-col gap-2 overflow-auto border border-gray-200 rounded-xl">
              <Table className="w-full text-sm text-gray-700 h-full ">
                <TableHeader className="bg-gray-100/40 text-gray-90/80">
                  <TableRow>
                    <TableHead className="px-4 py-2 font-medium text-left "></TableHead>

                    <TableHead className="px-4 py-2 font-medium text-left ">Name</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody className="bg-white w-full font-normal">
                  <SelectedMemberList
                    {...{
                      members: watchMembers,
                      setValue,
                    }}
                  />
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RingStrategy;
