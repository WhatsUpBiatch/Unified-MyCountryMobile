import CustomSelect from '@/components/custom/custom-select';
import { Input } from '@/components/ui/input';
import { useGetSite } from '@/hooks/common';
import { ISELECTVALUE } from '@/interfaces/api-interfaces';
import { Label } from '@/components/ui/label';

import { useFormContext } from 'react-hook-form';
import PhoneInput from 'react-phone-input-2';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FC, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTemplateList } from '@/services/api';
const BasicInformation: FC<any> = ({
  isChooseTemplate = true,
  chooseTemplate,
  setChooseTemplate,
  isSiteDisabled = false,
  customClass = 'xxl:max-h-[calc(100vh-450px)] xxl:h-[calc(100vh_-_21rem)]',
}) => {
  const { data: dataSiteList = [], isLoading } = useGetSite();

  const { data: templatesList = [] } = useQuery({
    queryKey: ['templateListQuery'],
    queryFn: () => getTemplateList({ page: 1, limit: 1000, filters: [], search: '' }),
    select: (data) => data?.data?.data?.result?.rows || [],
    enabled: isChooseTemplate,
  });
  const {
    register,
    formState: { errors },
    watch,
    setValue,
    clearErrors,
  } = useFormContext();

  /* Repair a site that arrived with a name but no uuid: match it against the
     site list so the select holds a real value. Without this the field looks
     correct but saves as empty, silently clearing the person's location. */
  const site = watch('basic.site');
  useEffect(() => {
    if (!site?.label || site?.value || !dataSiteList?.length) return;
    const match = dataSiteList.find(
      (entry: { name: string; uuid: string }) => entry?.name === site.label,
    );
    if (match?.uuid) {
      setValue('basic.site', { label: match.name, value: match.uuid });
    }
  }, [site?.label, site?.value, dataSiteList]);

  /* A location sets the clock for the people at it.
     
     Established systems work this way — the office or site timezone is what
     opening hours are read in — and our own Company & Locations screen tells
     customers a location decides "the clock". It did not: a location's timezone
     was stored, shown, and never used, while opening hours were read from each
     person's own regional setting. A London queue could run on Mumbai time.
     
     So choosing a location now fills in that person's timezone from it. Only
     when the person has none: a timezone somebody deliberately set is theirs,
     and someone who genuinely sits in a different zone from their office must
     keep it. Country is filled the same way when blank, since the timezone list
     is derived from it. */
  const siteValue = site?.value;
  useEffect(() => {
    if (!siteValue || !dataSiteList?.length) return;

    const chosen = dataSiteList.find((entry: any) => entry?.uuid === siteValue);
    const zone = `${chosen?.timezone || ''}`.trim();
    if (!zone) return;

    if (!watch('settings.operational_hours.regional.timezone')?.value) {
      setValue('settings.operational_hours.regional.timezone', { label: zone, value: zone });
    }

    const country = `${chosen?.country || ''}`.trim();
    if (country && !watch('settings.operational_hours.regional.country')?.value) {
      setValue('settings.operational_hours.regional.country', { label: country, value: country });
    }
  }, [siteValue, dataSiteList]);

  const handleTemplateChange = (e: ISELECTVALUE | null) => {
    const tempIndex = templatesList.findIndex((item: { uuid: string }) => item.uuid === e?.value);
    if (tempIndex != -1) {
      setChooseTemplate((prev: typeof chooseTemplate) => ({
        ...prev,
        selectedTemplate: templatesList[tempIndex],
      }));
      clearErrors('basic.selectedTemplate');
    }
  };

  return (
    <div className={`flex flex-col overflow-y-auto pr-1 pt-1 ${customClass}`}>
      {/* Identity is the only part of this step the platform lets you change;
          everything below it is provisioned elsewhere. Splitting them makes
          that obvious instead of leaving three greyed boxes unexplained. */}
      <section className="mcm-fsec">
        <div className="mcm-fsec-h">
          <div className="mcm-fsec-t">Identity</div>
          <div className="mcm-fsec-d">
            The name shown across the console, directory and caller ID.
          </div>
        </div>
        <div className="mcm-fgrid">
          <div className="mcm-field">
            <Input
              label="First Name"
              placeholder="Enter first name"
              {...register('basic.first_name')}
              error={(errors.basic as any)?.first_name?.message}
              maxLength={50}
            />
          </div>
          <div className="mcm-field">
            <Input
              label="Last Name"
              placeholder="Enter last name"
              {...register('basic.last_name')}
              error={(errors.basic as any)?.last_name?.message}
              maxLength={50}
            />
          </div>
          {/* The save payload has always carried job_title and the server
              returns it, but no screen ever offered a way to set it. */}
          <div className="mcm-field wide">
            <Input
              label="Job Title"
              placeholder="e.g. Support Team Lead"
              {...register('basic.job_title')}
              error={(errors.basic as any)?.job_title?.message}
              maxLength={80}
            />
          </div>
        </div>
      </section>

      <section className="mcm-fsec">
        <div className="mcm-fsec-h">
          <div className="mcm-fsec-t">Workplace</div>
          <div className="mcm-fsec-d">
            Which location this person belongs to. The extension is set when the person is added
            and cannot be changed here.
          </div>
        </div>
        <div className="mcm-fgrid">
          <div className="mcm-field">
            <div className="mcm-field-h">
              <Label>Location</Label>
            </div>
            <CustomSelect
              options={dataSiteList.map((site: { name: string; uuid: string }) => ({
                label: site?.name,
                value: site?.uuid,
              }))}
              handleChange={(e: ISELECTVALUE | null) => {
                if (!isSiteDisabled) setValue(`basic.site`, e || { label: '', value: '' });
              }}
              value={watch('basic.site')}
              isLoading={isLoading}
              isDisabled={isSiteDisabled}
            />
          </div>
          <div className="mcm-field">
            <div className="mcm-field-h">
              <Label>Extension</Label>
              <span className="mcm-lock">Read only</span>
            </div>
            <Input placeholder="—" type="number" disabled value={watch('basic.extension')} />
            <span className="mcm-field-note">Set when the person was added.</span>
          </div>
        </div>
      </section>

      <section className="mcm-fsec">
        <div className="mcm-fsec-h">
          <div className="mcm-fsec-t">Contact</div>
          <div className="mcm-fsec-d">
            How this person is reached. Both are managed on the person&rsquo;s own account and are
            shown here for reference.
          </div>
        </div>
        <div className="mcm-fgrid">
          <div className="mcm-field">
            <div className="mcm-field-h">
              <Label>Phone</Label>
              <span className="mcm-lock">Read only</span>
            </div>
            <PhoneInput country={'us'} value={watch(`basic.phone`)} disabled />
          </div>
          <div className="mcm-field">
            <div className="mcm-field-h">
              <Label>Email</Label>
              <span className="mcm-lock">Read only</span>
            </div>
            <Input placeholder="—" disabled value={watch('basic.email')} />
            <span className="mcm-field-note">Also the sign-in address.</span>
          </div>
        </div>
      </section>

      {isChooseTemplate && (
        <section className="mcm-fsec">
          <div className="mcm-fsec-h">
            <div className="mcm-fsec-t">Provisioning</div>
            <div className="mcm-fsec-d">
              Apply a saved template to fill the remaining steps, or configure them yourself.
            </div>
          </div>
          <div className="mcm-fgrid">
            <div className="mcm-field">
              <div className="mcm-field-h">
                <span className="mcm-field-l">Use an existing template?</span>
              </div>
              <RadioGroup
                className="flex flex-wrap items-center gap-5"
                value={chooseTemplate?.isChooseTemplate}
                onValueChange={(value) => {
                  setChooseTemplate((prev: any) => ({
                    ...prev,
                    isChooseTemplate: value,
                    selectedTemplate: null,
                  }));
                  clearErrors('basic.selectedTemplate');
                }}
                style={{ minHeight: 38 }}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="Yes" id="yes" className="cursor-pointer" />
                  <Label htmlFor="yes" className="cursor-pointer">
                    Yes
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="No" id="no" className="cursor-pointer" />
                  <Label htmlFor="no" className="cursor-pointer">
                    No
                  </Label>
                </div>
              </RadioGroup>
            </div>
            {chooseTemplate?.isChooseTemplate === 'Yes' && (
              <div className="mcm-field">
                <div className="mcm-field-h">
                  <Label>Template</Label>
                </div>
                <CustomSelect
                  options={templatesList.map((site: { name: string; uuid: string }) => ({
                    label: site?.name,
                    value: site?.uuid,
                  }))}
                  handleChange={(e: ISELECTVALUE | null) => {
                    handleTemplateChange(e);
                  }}
                  value={{
                    label: chooseTemplate?.selectedTemplate?.name || '',
                    value: chooseTemplate?.selectedTemplate?.uuid || '',
                  }}
                  error={(errors.basic as any)?.selectedTemplate?.message}
                />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default BasicInformation;
