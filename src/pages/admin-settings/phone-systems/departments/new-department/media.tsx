import { Label } from '@/components/ui/label';
import { GreetingItem, useGetGreetings } from '@/hooks/common';
import { greetingOptionsForSlots } from '@/lib/greeting-slots';
import { useIsStarterPlan } from '@/hooks/use-is-starter-plan';
import { capitalizeFirstLetter } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import SelectGreeting from '@/components/custom/greeting-select';
import { ISELECTVALUE } from '@/interfaces/api-interfaces';
import { useFormContext } from 'react-hook-form';

const Media = () => {
  const { allGreetings } = useGetGreetings();
  const isStarterPlan = useIsStarterPlan();

  const {
    setValue,
    watch,
    formState: { errors },
  } = useFormContext();

  const watchMedia = watch('media');

  const optionsData: Record<string, GreetingItem[]> = {
    ...greetingOptionsForSlots(allGreetings, ['welcome', 'hold']),
  };

  const mediaOptionsGreetingNotifications = [
    {
      name: 'welcome',
      placeholder: 'Welcome',
      label: 'welcome',
    },
    {
      name: 'hold',
      placeholder: 'On Hold Music',
      label: 'on hold music',
    },
  ].filter(({ name }) => !isStarterPlan || !['hold', 'on_hold_music'].includes(name)) as {
    name: string;
    placeholder: string;
    label: string;
  }[];

  const onChangeMedia = (name: string, status: boolean) => {
    setValue(`media.${name}.enabled`, status, { shouldValidate: true });
    setValue(
      `media.${name}.value`,
      status ? null : ({} as ISELECTVALUE),
      ...(status ? [] : [{ shouldValidate: true }]),
    );
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
        <div className="flex w-full flex-col gap-4 pr-1 sm:pr-2">
          <div className="flex w-full flex-col gap-4">
            <div className="flex w-full flex-col gap-3 lg:w-1/2">
              <h5 className="font-semibold text-gray-900 text-md my-2">Media</h5>
              <div className="flex flex-col gap-4 pt-2">
                <div className="divide-y divide-gray-200">
                  {mediaOptionsGreetingNotifications.map(({ name, label }) => {
                    return (
                      <div
                        key={name}
                        className="flex flex-col gap-2 w-full py-2 first:pt-0 last:pb-0"
                      >
                        <p className="text-gray-900 text-sm">{`Do you want to add "${capitalizeFirstLetter(label)} message" ?`}</p>
                        <div className="flex min-h-10 flex-col items-start gap-3 md:flex-row md:items-center">
                          <RadioGroup
                            value={watchMedia?.[name]?.enabled?.toString()}
                            onValueChange={(value) => onChangeMedia(name, JSON.parse(value))}
                            className="flex w-full gap-5 md:w-1/2"
                          >
                            <div className="flex items-center gap-2 cursor-pointer">
                              <RadioGroupItem value="true" id={`yes-${name}`} />
                              <Label htmlFor={`yes-${name}`} className="cursor-pointer">
                                Yes
                              </Label>
                            </div>
                            <div className="flex items-center gap-2 cursor-pointer">
                              <RadioGroupItem value="false" id={`no-${name}`} />
                              <Label htmlFor={`no-${name}`} className="cursor-pointer">
                                No
                              </Label>
                            </div>
                          </RadioGroup>

                          <div className="flex w-full flex-col gap-2 md:w-1/2">
                            <div className="w-full md:max-w-80">
                              {watchMedia?.[name]?.enabled && (
                                <SelectGreeting
                                  name={name == 'voicemail' ? 'voicemail' : 'greeting'}
                                  isShowUpload={name !== 'ring_tone'}
                                  onChangeMedia={(e) =>
                                    setValue(`media.${name}.value`, e as ISELECTVALUE, {
                                      shouldValidate: true,
                                    })
                                  }
                                  options={optionsData[name]?.map((item: GreetingItem) => ({
                                    label: item.name,
                                    value: item.filename,
                                  }))}
                                  value={watch(`media.${name}.value`) || null}
                                  errors={
                                    (errors.media as any)?.[name]?.value?.value?.message ||
                                    (errors.media as any)?.[name]?.value?.message
                                      ? `${label} message is required`
                                      : ''
                                  }
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Media;
