import CustomSelect from '@/components/custom/custom-select';
import ForwardingActions from '@/components/custom/forwarding-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { generateRandomExtension } from '@/lib/utils';
import { getDepartmentTimeoutOptions } from '../../../constants';
import { useFormContext } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/assets/icons/icon';
import { COMPANY_DEFAULTS_QUERY_KEY, fetchCompanyDefaults } from '@/lib/company-defaults';

const DepartmentInfo = ({
  isEdit = false,
  dataSiteList = [],
  isLoading = false,
}: {
  isEdit: any;
  dataSiteList: any;
  isLoading: any;
}) => {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext();

  /* Same company record, same cache key as everywhere else, so the picker can
     offer the company's number when it is not one of the six shipped choices. */
  const { data: companyDefaults } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
    staleTime: 5 * 60 * 1000,
  });

  const generateNewExtension = () => {
    const newExtension = generateRandomExtension();
    setValue('extension', newExtension);
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
        <div className="flex w-full flex-col gap-4 pr-1 sm:pr-2">
          <div className="flex w-full items-center gap-3">
            <div className="flex w-full flex-col gap-4 md:flex-row">
              <div className="relative flex w-full gap-1 md:w-1/2">
                <Input
                  {...register(`name`)}
                  label="Name"
                  placeholder="Enter group name"
                  error={errors?.name?.message}
                  maxLength={50}
                />
              </div>
              <div className="relative flex w-full gap-1 md:w-1/2">
                <CustomSelect
                  label="Location"
                  options={dataSiteList?.map((site: any) => ({
                    label: site?.name,
                    value: site?.uuid,
                  }))}
                  handleChange={(value) => {
                    setValue('site', value, { shouldValidate: true });
                  }}
                  value={watch('site')}
                  placeholder={'Select location'}
                  error={
                    errors.site &&
                    'value' in errors.site &&
                    typeof errors.site.value?.message === 'string'
                      ? errors.site.value.message
                      : undefined
                  }
                  isLoading={isLoading}
                />
              </div>
            </div>
          </div>
          <div className="flex w-full items-center gap-3">
            <div className="flex w-full flex-col gap-4 md:flex-row">
              <div className="relative flex w-full gap-1 md:w-1/2">
                <Input
                  label="Description"
                  {...register(`description`)}
                  placeholder="Enter description"
                  error={errors?.description?.message}
                  maxLength={501}
                />
              </div>
              <div className="relative flex w-full gap-1.5 md:w-1/2">
                <div className="flex w-full items-end gap-2">
                  <Input
                    label={'Extension'}
                    placeholder="Enter extension"
                    type="number"
                    min={0}
                    {...register('extension')}
                    error={errors?.extension?.message}
                    disabled={isEdit}
                  />
                  {!isEdit && (
                    <Button
                      type="button"
                      className="h-10 w-10 shrink-0"
                      variant={'outline'}
                      onClick={() => generateNewExtension()}
                    >
                      <Icon name="Refresh" className="w-5 h-5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex w-full flex-col gap-4">
            <div className="flex flex-col gap-3">
              <h5 className="font-semibold text-gray-900 text-md my-2">Response Time Settings</h5>
              <div className="flex w-full gap-1">
                <div className="relative flex w-full gap-1 sm:max-w-[320px]">
                  <CustomSelect
                    label="Ring time per person (sec)"
                    options={getDepartmentTimeoutOptions(
                      companyDefaults?.settings,
                      watch('timeout'),
                    )}
                    handleChange={(value) => {
                      setValue('timeout', value, { shouldValidate: true });
                    }}
                    value={watch('timeout')}
                    placeholder="Select"
                    error={errors?.timeout?.message}
                  />
                </div>
              </div>
              <ForwardingActions
                setValue={setValue}
                watch={watch}
                errors={errors}
                forwardState="failover"
                label="If no one answer"
                description="Set how you'd like your calls to be handled, if no one answers."
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DepartmentInfo;
