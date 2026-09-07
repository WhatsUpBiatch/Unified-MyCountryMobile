import { getUserDetails, updateUserSettings } from '@/services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { NOTIFICATION_SETTINGS_INITIAL, NOTIFICATION_TYPES_LIST } from '../constant';
import { handleAlert } from '@/lib/utils';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Icon } from '@/assets/icons/icon';
import PhoneInput from 'react-phone-input-2';
// import Breadcrumb from '@/components/custom/breadcrumb';

const SettingsNotification = () => {
  // const breadcrumbData = [{ label: 'Settings' }, { label: 'Notification' }];
  const { data: userInfoData } = useQuery({
    queryKey: ['getUserDetailsForNotification'],
    queryFn: getUserDetails,
    select: (data) => data?.data?.data?.result,
  });

  const queryClient: any = useQueryClient();
  const { setValue, watch, handleSubmit, reset } = useForm<any>({
    mode: 'all',
    defaultValues: NOTIFICATION_SETTINGS_INITIAL,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: updateUserSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userInfo'] });
      invalidateGlobalUsersDirectory(queryClient);
      handleAlert({
        text: 'Notification settings saved successfully!',
        type: 'success',
      });
    },
  });

  useEffect(() => {
    if (userInfoData) {
      /* The column is flat now: {voicemail, missed, sms, forgot_password}. Older
         saves wrapped it one level deeper, so that shape is still read. */
      const stored = userInfoData?.notification_settings;
      reset(stored?.notification_settings ?? stored);
    }
  }, [userInfoData]);

  const onSubmit = (data: any) => {
    const formattedData = { ...data };

    Object.keys(formattedData).forEach((key) => {
      if (formattedData[key] && typeof formattedData[key] === 'object') {
        if (formattedData[key].sms === false) {
          formattedData[key].phone = '';
        }
      }
    });

    const payload = {
      key: 'notification_settings',
      /* Flat, one level: the voicemail sender reads `column[type]` and used to
         find the wrapper instead of the event, which is why no voicemail email
         went out after 24 Aug. */
      value: {
        ...formattedData,
        forgot_password: {
          email: true,
          socket: false,
          sms: true,
          push: false,
        },
      },
    };

    mutate(payload);
  };

  return (
    <section className="w-full bg-gray-200/15 flex flex-col overflow-x-auto overflow-y-hidden">
      {/* <Breadcrumb breadcrumbs={breadcrumbData} /> */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 min-h-[65px] bg-white">
        <div>
          <p className="text-gray-900 font-semibold text-lg">Notifications</p>
          <p className="text-gray-500 text-xs">
            What you get alerted about, and whether it arrives in the browser, by email or both.
          </p>
        </div>
      </div>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="gap-3 p-3 flex flex-col justify-between h-full"
      >
        <div className="flex flex-col gap-2  overflow-y-auto pr-1">
          <h4 className="text-gray-900 font-semibold text-md">Notification Settings</h4>

          <p className="text-gray-700 text-sm mb-1">
            Manage how you receive notifications across different channels
          </p>

          {/* Voicemail, missed calls and SMS all save, and nothing reads them.
              The only key any service takes out of `notification_settings` is
              `security_alert`. The missed-call script on the switch is worse
              than unwired: it is referenced by no dialplan, it posts to a
              placeholder address, and it uses `!=`, which is not valid Lua.
              Remove this notice in the same change that makes the three real —
              not before. */}
          <div className="mb-3 rounded-md border-l-[3px] border-l-amber-500 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-900">
            <span className="font-semibold">Voicemail and missed-call alerts have stopped.</span>{' '}
            They worked until 24 August and are not being sent at the moment — what you choose here
            is saved and will apply again once they are running. Text message alerts have never been
            sent.
          </div>
          <div className="w-full flex flex-col gap-3">
            {NOTIFICATION_TYPES_LIST.map((item) => (
              <div className="border border-gray-200 bg-white rounded-xl" key={item?.id}>
                <div className="w-full flex items-center gap-3 border-b border-gray-200 px-4 py-3">
                  {item?.iconType === 'circle' ? (
                    <span className={item?.iconClass}></span>
                  ) : (
                    <Icon name={item?.iconName} className={item?.iconClass} />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold truncate text-md text-gray-900">{item?.name}</p>
                    {(item as any)?.description && (
                      <p className="text-xs text-gray-500">{(item as any).description}</p>
                    )}
                  </div>
                  {/* Every channel off means this event reaches the person nowhere.
                      Nothing said so, so it looked configured rather than silent. */}
                  {!item?.settingsType?.some(({ value }) => watch(`${item?.value}.${value}`)) && (
                    <span className="ml-auto shrink-0 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                      You will not be told
                    </span>
                  )}
                </div>
                <div className="flex xs:flex-wrap sm:flex-nowrap  justify-between gap-4 px-4 py-3 w-full">
                  {item?.settingsType?.map(({ label, value, hint }: any) => {
                    return (
                      <div key={value} className="w-full flex flex-col gap-2">
                        <div
                          className={`w-full flex items-center justify-between gap-2 ${watch(`${item?.value}.${value}`) ? 'bg-ucass-primary-200/50 border-primary/15' : 'border-gray-200 bg-gray-100'}  border  rounded-md p-3`}
                        >
                          <div className="min-w-0">
                            <Label className="text-gray-700 text-sm">{label}</Label>
                            {hint && (
                              <p className="text-[11px] leading-tight text-gray-500">{hint}</p>
                            )}
                          </div>
                          <Switch
                            disabled={item?.id === 3 && value === 'sms'}
                            className="cursor-pointer"
                            onCheckedChange={(checked) => {
                              setValue(`${item?.value}.${value}`, checked);
                              if (checked && value === 'sms' && !watch(`${item?.value}.phone`)) {
                                setValue(
                                  `${item?.value}.phone`,
                                  userInfoData?.user_info?.phone || '',
                                );
                              }
                            }}
                            checked={watch(`${item?.value}.${value}`)}
                          />
                        </div>
                        {value === 'sms' && watch(`${item?.value}.${value}`) && (
                          <div className="w-full pl-2 pr-2 pb-2">
                            <PhoneInput
                              country={'us'}
                              value={watch(`${item?.value}.phone`) || ''}
                              onChange={(value) => setValue(`${item?.value}.phone`, value)}
                            />
                            {/* Kept, but no longer written as a live warning:
                                nothing is sent, so nothing is charged today. */}
                            <p className="text-xs mt-1">
                              Note: SMS notifications will be charged once they are switched on.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end mcm-stickyfoot">
          <Button variant={'primary'} type="submit" disabled={isPending}>
            {isPending ? 'Submitting...' : 'Save notifications'}
          </Button>
        </div>
      </form>
    </section>
  );
};

export default SettingsNotification;
