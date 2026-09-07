import { getUserDetails, updateUserSettings } from '@/services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import {
  NOTIFICATION_SETTINGS_INITIAL,
  NOTIFICATION_SETTINGS_LIST,
  NOTIFICATION_TYPES_LIST,
} from '../constant';
import { handleAlert } from '@/lib/utils';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Icon } from '@/assets/icons/icon';
import PhoneInput from 'react-phone-input-2';
import '@/components/mcm/mcm-page.css';
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
    <section className="mcm-adminpage mcm-notif">
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">My account</div>
          <h1>Notifications</h1>
          <p>What you get alerted about, and whether it arrives in the browser, by email or both.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mcm-notif-form">
        <div className="mcm-notif-body">
          {/* Voicemail, missed calls and SMS all save, and nothing reads them.
              The only key any service takes out of `notification_settings` is
              `security_alert`. The missed-call script on the switch is worse
              than unwired: it is referenced by no dialplan, it posts to a
              placeholder address, and it uses `!=`, which is not valid Lua.
              Remove this notice in the same change that makes the three real —
              not before. */}
          <div className="mcm-notsaved" role="status">
            <strong>Voicemail and missed-call alerts have stopped.</strong>
            <span>
              They worked until 24 August and are not being sent at the moment — what you choose
              here is saved and will apply again once they are running. Text message alerts have
              never been sent.
            </span>
          </div>

          {/* A table, not three cards of four boxes.

              Every event offers the same four channels, so the card layout drew
              the same four boxes three times and repeated each channel's
              explanation with them — twelve boxes and twelve hints for twelve
              switches, where the hints differ four ways and the switches
              differ twelve. Here each channel is explained once, in its own
              column heading, and the grid answers "what reaches me where" by
              being read across or down.

              A real <table> rather than a grid of divs: the switches are the
              cells of a matrix, and this is what gives each one its row and
              column when it is read out, instead of twelve controls all
              announced as "on". */}
          <div className="mcm-notif-wrap">
            <table className="mcm-notif-grid">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="mcm-notif-corner">Tell me about</span>
                  </th>
                  {NOTIFICATION_SETTINGS_LIST.map((channel) => (
                    <th scope="col" key={channel.value}>
                      <span className="mcm-notif-ch">{channel.label}</span>
                      <span className="mcm-notif-chhint">{channel.hint}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_TYPES_LIST.map((item) => {
                  const silent = !item?.settingsType?.some(({ value }) =>
                    watch(`${item?.value}.${value}`),
                  );
                  const smsOn = watch(`${item?.value}.sms`);
                  return (
                    /* A keyed Fragment, not `<>`: each event yields two rows —
                       itself and, when texts are on, its phone number — so the
                       array element is the pair, and that is what React needs
                       the key on. */
                    <Fragment key={item?.id}>
                      <tr className={silent ? 'is-silent' : ''}>
                        <th scope="row">
                          <span className="mcm-notif-ev">
                            <span className="mcm-notif-evmark" aria-hidden="true">
                              {item?.iconType === 'circle' ? (
                                <span className={item?.iconClass} />
                              ) : (
                                <Icon name={item?.iconName} className={item?.iconClass} />
                              )}
                            </span>
                            <span className="mcm-notif-evtxt">
                              <b>{item?.name}</b>
                              {(item as any)?.description ? (
                                <span>{(item as any).description}</span>
                              ) : null}
                            </span>
                          </span>
                          {/* Every channel off means this event reaches the
                              person nowhere. Nothing said so, so it looked
                              configured rather than silent. */}
                          {silent ? (
                            <span className="mcm-notif-silent">You will not be told</span>
                          ) : null}
                        </th>

                        {item?.settingsType?.map(({ label, value }: any) => {
                          const blocked = item?.id === 3 && value === 'sms';
                          return (
                            <td key={value} className={blocked ? 'is-blocked' : ''}>
                              {blocked ? (
                                /* A text alert about a text arriving is a loop
                                   nobody asked for. It was a switch that could
                                   not be moved and gave no reason. */
                                <span
                                  className="mcm-notif-na"
                                  title="A text message telling you a text message arrived"
                                >
                                  —
                                </span>
                              ) : (
                                <Switch
                                  className="cursor-pointer"
                                  aria-label={`${label} for ${item?.name}`}
                                  onCheckedChange={(checked) => {
                                    setValue(`${item?.value}.${value}`, checked);
                                    if (
                                      checked &&
                                      value === 'sms' &&
                                      !watch(`${item?.value}.phone`)
                                    ) {
                                      setValue(
                                        `${item?.value}.phone`,
                                        userInfoData?.user_info?.phone || '',
                                      );
                                    }
                                  }}
                                  checked={watch(`${item?.value}.${value}`)}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>

                      {/* The number this event's texts would go to. One row
                          below its own event rather than inside a cell, so the
                          grid keeps its shape. */}
                      {smsOn ? (
                        <tr className="mcm-notif-phonerow">
                          <td colSpan={NOTIFICATION_SETTINGS_LIST.length + 1}>
                            <div className="mcm-notif-phone">
                              <label htmlFor={`phone-${item?.value}`}>
                                Text {item?.name.replace(' Notifications', '').toLowerCase()}{' '}
                                alerts to
                              </label>
                              <PhoneInput
                                inputProps={{ id: `phone-${item?.value}` }}
                                country={'us'}
                                value={watch(`${item?.value}.phone`) || ''}
                                onChange={(value) => setValue(`${item?.value}.phone`, value)}
                              />
                              {/* Kept, but no longer written as a live warning:
                                  nothing is sent, so nothing is charged today. */}
                              <span>Charged per message once text alerts are switched on.</span>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mcm-notif-foot">
          <Button variant={'primary'} type="submit" disabled={isPending}>
            {isPending ? 'Submitting...' : 'Save notifications'}
          </Button>
        </div>
      </form>
    </section>
    );
};

export default SettingsNotification;
