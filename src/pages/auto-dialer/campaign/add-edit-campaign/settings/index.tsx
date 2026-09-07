import { Icon } from '@/assets/icons/icon';
import CustomSelect from '@/components/custom/custom-select';
import ErrorTooltip from '@/components/custom/error-tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ISELECTVALUE } from '@/interfaces/api-interfaces';
import { getDispositions, getGreetings } from '@/services/api';
import { useQuery } from '@tanstack/react-query';
import { FC } from 'react';
import { useFormContext } from 'react-hook-form';
import { DEFAULT_RETRY_PERIOD_TYPE, DIALER_TYPE, MAX_ATTEMPTS, TIME_LIST } from '../consts';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const Settings: FC<any> = ({ dialMethod, setModalState, campaignStatus }) => {
  const { data: voicemailList = [] } = useQuery({
    queryKey: ['useGetVoicemails'],
    queryFn: () =>
      getGreetings({
        page: 1,
        limit: 1000,
        filters: [],
        search: '',
        type: 'voicemail',
        sort: { key: 'created_at', desc: true },
      }),
    select: (data) => data?.data?.data?.result?.rows || [],
  });

  const {
    register,
    formState: { errors },
    setValue,
    watch,
  } = useFormContext();

  const { data: dispositionsList = [] } = useQuery({
    queryKey: ['getDispositionsList'],
    queryFn: () => getDispositions({ page: 1, limit: 200 }),
    select: (data) => data?.data?.data?.result?.rows || [],
  });

  const handleDispositionCheck = (checked: boolean, item: any) => {
    const currentValues = watch('agentDisposition') || [];
    if (checked) {
      if (!currentValues.some((d: any) => d._id === item?._id)) {
        setValue('agentDisposition', [...currentValues, { ...item }], { shouldValidate: true });
      }
    } else {
      setValue(
        'agentDisposition',
        currentValues.filter((d: any) => d._id !== item?._id),
        { shouldValidate: true },
      );
    }
  };

  const isDispositionChecked = (item: any) => {
    return (watch('agentDisposition') || []).some((d: any) => d._id === item?._id);
  };

  return (
    <>
      <div className="flex h-[calc(100vh_-_22.5rem)] flex-col gap-6 overflow-auto pr-1 ">
        <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
          {dialMethod === DIALER_TYPE.PREVIEW ? (
            <CustomSelect
              isDisabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
              label={'Preview Time'}
              placeholder="Select Option"
              options={TIME_LIST.map((item) => ({
                label: item,
                value: item,
              }))}
              handleChange={(e: ISELECTVALUE | null) => {
                setValue(`dialerSetting.preview_time`, e?.value || '', {
                  shouldValidate: true,
                });
              }}
              value={{
                value: watch('dialerSetting.preview_time'),
                label: watch('dialerSetting.preview_time'),
              }}
              error={(errors as any)?.dialerSetting?.preview_time?.message}
              menuPlacement="auto"
            />
          ) : dialMethod === DIALER_TYPE.PREDICTIVE ? (
            <CustomSelect
              label={'Ringing Agent Time'}
              placeholder="Select Option"
              isDisabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
              options={TIME_LIST.map((item) => ({
                label: item,
                value: item,
              }))}
              handleChange={(e: ISELECTVALUE | null) => {
                setValue(`dialerSetting.ringing_agent_time`, e?.value || '', {
                  shouldValidate: true,
                });
              }}
              value={{
                value: watch('dialerSetting.ringing_agent_time'),
                label: watch('dialerSetting.ringing_agent_time'),
              }}
              error={(errors as any)?.dialerSetting?.ringing_agent_time?.message}
              menuPlacement="auto"
            />
          ) : null}

          <CustomSelect
            label={'Wrap-up time'}
            isDisabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
            placeholder="Select Option"
            options={TIME_LIST.map((item) => ({
              label: item,
              value: item,
            }))}
            handleChange={(e: ISELECTVALUE | null) => {
              setValue(`dialerSetting.wrapup_time`, e?.value || '', {
                shouldValidate: true,
              });
            }}
            value={{
              value: watch('dialerSetting.wrapup_time'),
              label: watch('dialerSetting.wrapup_time'),
            }}
            error={(errors?.dialerSetting as any)?.wrapup_time?.message}
            menuPlacement="auto"
          />

          {dialMethod === DIALER_TYPE.PREDICTIVE ? (
            <CustomSelect
              label={'Max ring time'}
              placeholder="Select Option"
              isDisabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
              options={TIME_LIST.map((item) => ({
                label: item,
                value: item,
              }))}
              handleChange={(e: ISELECTVALUE | null) => {
                setValue(`dialerSetting.max_ring_time`, e?.value || '', {
                  shouldValidate: true,
                });
              }}
              value={{
                value: watch('dialerSetting.max_ring_time'),
                label: watch('dialerSetting.max_ring_time'),
              }}
              error={(errors?.dialerSetting as any)?.max_ring_time?.message}
              menuPlacement="auto"
            />
          ) : null}
          <div className="relative flex flex-col gap-1.5 w-full">
            <Label className="text-sm font-medium leading-none">Default retry period</Label>
            <div className="flex gap-1">
              <div className="w-full relative">
                <Input
                  // label="Default retry period"
                  disabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                  placeholder="Enter default retry period"
                  type="number"
                  {...register('dialerSetting.default_retry_period')}
                  // error={(errors?.dialerSetting as any)?.default_retry_period?.message}
                />
                <span className="absolute top-[-20px] right-0">
                  {(errors as any)?.dialerSetting?.default_retry_period?.message && (
                    <ErrorTooltip
                      text={(errors as any)?.dialerSetting?.default_retry_period?.message}
                    />
                  )}
                </span>
              </div>

              <CustomSelect
                // label={'Default retry period type'}
                className="max-w-[100px]  "
                isDisabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                placeholder="Select Option"
                options={DEFAULT_RETRY_PERIOD_TYPE.map((item) => ({
                  label: item?.label,
                  value: item?.value,
                }))}
                handleChange={(e: ISELECTVALUE | null) => {
                  setValue(`dialerSetting.default_retry_period_type`, e || '', {
                    shouldValidate: true,
                  });
                }}
                value={watch('dialerSetting.default_retry_period_type')}
                error={(errors?.dialerSetting as any)?.default_retry_period_type?.message}
                menuPlacement="auto"
              />
            </div>
          </div>

          <CustomSelect
            label={'Max attempts per record'}
            placeholder="Select Option"
            isDisabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
            options={MAX_ATTEMPTS.map((item) => ({
              label: item,
              value: item,
            }))}
            handleChange={(e: ISELECTVALUE | null) => {
              setValue(`dialerSetting.max_attempt_per_record`, e?.value || '', {
                shouldValidate: true,
              });
            }}
            value={{
              value: watch('dialerSetting.max_attempt_per_record'),
              label: watch('dialerSetting.max_attempt_per_record'),
            }}
            error={(errors?.dialerSetting as any)?.max_attempt_per_record?.message}
            menuPlacement="auto"
          />

          {/* <Input label="Name" placeholder="Enter campaign name" /> */}
        </div>

        {dialMethod === DIALER_TYPE.PREDICTIVE || dialMethod === DIALER_TYPE.NORMAL ? (
          <div className="w-full flex flex-col gap-3">
            <div>
              <h3 className="text-gray-900 font-semibold text-md">Pacing</h3>
              <p className="text-xs text-gray-500">
                {dialMethod === DIALER_TYPE.PREDICTIVE
                  ? 'The dialer places more calls than there are free agents, then corrects itself from the answer rate. Keep the abandon cap where your regulations put it.'
                  : 'The dialer places one call for each free agent, so nobody answers to silence. Only the line ceiling applies.'}
              </p>
            </div>
            <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
              <Input
                label="Line ceiling (0 = no limit)"
                type="number"
                min={0}
                max={500}
                disabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                {...register('dialerSetting.max_lines')}
                error={(errors?.dialerSetting as any)?.max_lines?.message}
              />
              {dialMethod === DIALER_TYPE.PREDICTIVE ? (
                <>
                  <Input
                    label="Max calls per free agent"
                    type="number"
                    step="0.1"
                    min={1}
                    max={15}
                    disabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                    {...register('dialerSetting.max_calls_per_agent')}
                    error={(errors?.dialerSetting as any)?.max_calls_per_agent?.message}
                  />
                  <Input
                    label="Abandon rate cap (%)"
                    type="number"
                    step="0.1"
                    min={0.1}
                    max={100}
                    disabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                    {...register('dialerSetting.target_abandon_rate')}
                    error={(errors?.dialerSetting as any)?.target_abandon_rate?.message}
                  />
                  <Input
                    label="Counts as abandoned after (seconds waiting)"
                    type="number"
                    min={0}
                    max={60}
                    disabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                    {...register('dialerSetting.compliance_abandon_seconds')}
                    error={(errors?.dialerSetting as any)?.compliance_abandon_seconds?.message}
                  />
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {dialMethod === DIALER_TYPE.PREDICTIVE ? (
          <>
            <div className="w-full flex items-start flex-col gap-2">
              <div className="flex items-center gap-2">
                <p className="text-gray-900 font-medium text-sm">Automatic Answer</p>
                <Switch
                  disabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                  onCheckedChange={(checked) => {
                    setValue(`dialerSetting.auto_answering.enabled`, checked, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                  checked={Boolean(watch('dialerSetting.auto_answering.enabled'))}
                />
              </div>
              {/* {watch('dialerSetting.auto_answering.enabled') && (
                <div className="flex items-center gap-2">
                  <Input
                    disabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                    placeholder="Timeout in seconds"
                    type="number"
                    {...register('dialerSetting.auto_answering.timeout')}
                    error={(errors?.dialerSetting as any)?.auto_answering?.timeout?.message}
                    min={2}
                    max={30}
                  />
                </div>
              )} */}
            </div>
            <div className="w-full flex items-start gap-2 flex-col">
              <div className="flex items-center gap-2">
                <p className="text-gray-900 font-medium text-sm">Answering Machine Detection</p>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  saved, not enforced by the switch yet
                </span>
                <Switch
                  disabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                  onCheckedChange={(checked) => {
                    setValue(`dialerSetting.answering_detection_machine.enabled`, checked);
                  }}
                  checked={watch('dialerSetting.answering_detection_machine.enabled')}
                />
              </div>
              {watch('dialerSetting.answering_detection_machine.enabled') ? (
                <div className="flex w-full gap-4 h-10">
                  <div className="flex w-full gap-4 items-end">
                    <div className="flex gap-8 items-center ">
                      <Label>Select Action:</Label>
                      <RadioGroup
                        disabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                        className="flex items-center gap-4 h-10"
                        value={watch('dialerSetting.answering_detection_machine.type')}
                        onValueChange={(value) =>
                          setValue('dialerSetting.answering_detection_machine.type', value)
                        }
                      >
                        <div className="flex items-center gap-2 cursor-pointer">
                          <RadioGroupItem value="HANGUP" id="HANGUP" />
                          <Label htmlFor="HANGUP" className="cursor-pointer">
                            Hangup
                          </Label>
                        </div>
                        <div className="flex items-center gap-2 cursor-pointer">
                          <RadioGroupItem value="VOICEMAIL" id="VOICEMAIL" />
                          <Label htmlFor="VOICEMAIL" className="cursor-pointer">
                            Voicemail Message
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>
                    <>
                      {watch('dialerSetting.answering_detection_machine.type') === 'VOICEMAIL' && (
                        <div className="flex gap-1.5 relative flex-row">
                          <CustomSelect
                            isDisabled={campaignStatus !== '' && campaignStatus !== 'NEW'}
                            options={
                              voicemailList?.length > 0
                                ? voicemailList?.map((item: { name: string; uuid: string }) => ({
                                    label: item?.name,
                                    value: item?.uuid,
                                  }))
                                : [{ label: 'No record found!', value: '', disabled: true }]
                            }
                            handleChange={(e: ISELECTVALUE | null) => {
                              setValue('dialerSetting.answering_detection_machine.value', e, {
                                shouldValidate: true,
                              });
                            }}
                            value={watch('dialerSetting.answering_detection_machine.value') || {}}
                            error={
                              (errors?.dialerSetting as any)?.answering_detection_machine?.value
                                ?.value?.message
                            }
                            menuPlacement="auto"
                          />
                        </div>
                      )}
                    </>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <div
          className={`w-full flex gap-6 ${campaignStatus !== '' && campaignStatus !== 'NEW' ? 'pointer-events-none opacity-50' : ''}`}
        >
          <div className="w-full">
            <div className="w-full flex items-center gap-2 mb-2">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1">
                  <h3 className="text-gray-900 font-semibold text-md">Agent Disposition</h3>
                  {(errors as any)?.agentDisposition?.message && (
                    <ErrorTooltip text={(errors as any)?.agentDisposition?.message} />
                  )}
                </div>
                <Button
                  className="shadow-none"
                  variant="secondary"
                  type="button"
                  onClick={() => setModalState(true)}
                >
                  <Icon name="Plus" className="w-3 h-3" />
                </Button>
              </div>
            </div>
            {/* <div
              className={`w-full h-full grid grid-cols-2 gap-2 overflow-y-auto ${dialMethod === 'PREDICTIVE' ? 'max-h-[calc(100vh_-_41rem)]' : 'max-h-[calc(100vh_-_30rem)]'}  pr-1`}
            > */}
            <div className={`w-full h-full grid grid-cols-2 gap-2 overflow-y-auto `}>
              {dispositionsList && dispositionsList?.length
                ? dispositionsList
                    ?.filter((item: any) => item?.dispositionType?.toLowerCase() === 'agent')
                    ?.map((item: any) => (
                      <div
                        className="w-full  flex items-center justify-between gap-3"
                        key={`${item?.disposition?.name}`}
                      >
                        <div className="w-full p-2 border border-gray-200 rounded-lg flex items-center justify-between gap-2  min-h-[62px]">
                          <div className="flex items-center gap-3">
                            <Switch
                              id={item?._id}
                              onCheckedChange={(checked) => {
                                handleDispositionCheck(checked, item);
                              }}
                              checked={isDispositionChecked(item)}
                            />
                            <label
                              htmlFor={item?._id}
                              className="text-gray-900/80 font-semibold text-sm"
                            >
                              {item?.disposition?.name}
                            </label>
                          </div>
                        </div>
                        {/* <Button
                        className="shadow-none min-w-[70px]"
                        variant={'secondary'}
                        type="submit"
                      >
                        Retry
                      </Button> */}
                      </div>
                    ))
                : null}
              {/* items */}

              {/* ---- */}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Settings;
