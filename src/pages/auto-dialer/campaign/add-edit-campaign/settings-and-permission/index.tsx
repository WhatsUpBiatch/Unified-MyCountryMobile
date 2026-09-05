import CustomSelect from '@/components/custom/custom-select';
import { CountryFlag } from '@/components/flag';
import countriesData from '@/assets/json/countries.json';
import { ISELECTVALUE } from '@/interfaces/api-interfaces';
import { useFormContext } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import { useUser } from '@/hooks/use-user';
import parsePhoneNumberFromString from 'libphonenumber-js';
import { Input } from '@/components/ui/input';
import { calculateSelectedDays, getTodayInTimezone } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import ErrorTooltip from '@/components/custom/error-tooltip';
import moment from 'moment';
import { Switch } from '@/components/ui/switch';
import { X } from 'lucide-react';

const SettingsAndPermission = ({ campaignStatus }: { campaignStatus: string }) => {
  const {
    watch,
    setValue,
    register,
    formState: { errors },
  } = useFormContext();
  const { user } = useUser();
  const { user_info } = user || {};
  const [timezonesList, setTimezonesList] = useState<any>([]);
  const watchRegionalSettings = watch('settings.operational_hours.regional');
  const selectedTimezone = watch('settings.operational_hours.regional.timezone')?.value;
  const isAutomaticRecordingEnabled = watch('settings.recording.automatic.enabled');
  const isAiCallMonitoringEnabled = watch('settings.ai_call_monitoring.enabled');
  const isTranscriptionEnabled = watch('settings.transcription.enabled');

  const parsedNumber = useMemo(() => {
    if (user_info?.phone || user_info?.phone) {
      return parsePhoneNumberFromString(`+${user_info?.phone || user_info?.phone}`);
    }
    return null;
  }, [user_info?.phone || user_info?.phone]);

  const today = useMemo(() => {
    if (!selectedTimezone) return new Date().toISOString().split('T')[0];
    return getTodayInTimezone(selectedTimezone);
  }, [selectedTimezone]);

  useEffect(() => {
    const countryCode = watchRegionalSettings?.country_code?.value
      ? watchRegionalSettings?.country_code?.value
      : parsedNumber?.country || 'US';
    const index = countriesData?.findIndex((item) => item?.isoCode === countryCode);
    if (index !== -1) {
      const countryData = countriesData[index];
      const countryLabel = `${countryData.name} (${countryData.phonecode?.startsWith('+') ? countryData.phonecode : `+${countryData.phonecode}`})`;

      setValue('settings.operational_hours.regional.country_code', {
        label: countryLabel,
        value: countryData.isoCode,
        name: countryData.name || '',
      });
      setValue(
        'settings.operational_hours.regional.country',
        {
          label: countryData.name,
          value: countryData.name,
          name: countryData.name || '',
        },
        { shouldValidate: true },
      );
    }
  }, [parsedNumber]);
  const onCountryChange = (value: ISELECTVALUE | null) => {
    const index = countriesData?.findIndex((item: any) => item?.isoCode === value?.value);

    /* Only the plain fields. `value` is the option straight from the select and
       now carries a flag element; this object is written into the form and saved
       with the campaign, and a React element cannot survive that round trip. */
    setValue(
      'settings.operational_hours.regional.country',
      value ? { label: value.label, value: value.value } : value,
      { shouldValidate: true },
    );

    const countryData = countriesData[index];
    const countryLabel = `${countryData.name} (${countryData.phonecode?.startsWith('+') ? countryData.phonecode : `+${countryData.phonecode}`})`;
    setValue(
      'settings.operational_hours.regional.country_code',
      { label: countryLabel, value: countryData.isoCode, name: countryData.name || '' },
      {
        shouldValidate: true,
      },
    );
    setValue('settings.operational_hours.regional.timezone', {
      label: 'Select',
      value: '',
    });
  };
  useEffect(() => {
    const selectedCountry = watchRegionalSettings?.country_code?.value;
    if (selectedCountry) {
      const country = countriesData.find((item) => item?.isoCode === selectedCountry);
      setTimezonesList(country?.timezones || []);
    } else {
      setTimezonesList([]);
    }
  }, [watchRegionalSettings?.country_code?.value]);

  useEffect(() => {
    if (timezonesList?.length > 0) {
      const firstTimezone = timezonesList[0];
      setValue(
        'settings.operational_hours.regional.timezone',
        {
          label: firstTimezone?.zoneName,
          value: firstTimezone?.zoneName,
        },
        { shouldValidate: true },
      );
    }
  }, [timezonesList]);

  // const today = new Date().toISOString().split('T')[0];
  const _start_date = watch('startDate');
  const _end_date = watch('endDate');
  const _holidays = watch('settings.operational_hours.holidays');

  const watchBusinessHour = watch('settings.operational_hours');
  const selectedDays = watch('settings.operational_hours.value');

  const startDate = watch('startDate') ? moment(watch('startDate')) : null;
  const endDate = watch('endDate') ? moment(watch('endDate')) : null;
  const totalSelectedDays = calculateSelectedDays(startDate, endDate, selectedDays);

  const isDayWithinRange = (day: string) => {
    if (!startDate || !endDate) return true;
    const dayIndex = moment().day(day).day();

    const checkDay = (current: moment.Moment): boolean =>
      current.isAfter(endDate, 'day')
        ? false
        : current.day() === dayIndex || checkDay(current.clone().add(1, 'day'));

    return checkDay(startDate.clone());
  };

  const handleChangeScheduleOption = (checked: boolean, day: string) => {
    const currentScheduleOptions = watchBusinessHour?.value || {};
    const updatedScheduleOptions = {
      ...currentScheduleOptions,
      [day]: {
        ...currentScheduleOptions[day],
        open: checked,
        start: '10:00',
        end: '23:00',
      },
    };
    setValue('settings.operational_hours.value', updatedScheduleOptions);
  };

  return (
    <div className="flex max-h-[calc(100vh_-_22.5rem)] w-full flex-col gap-4 overflow-auto pr-1 md:flex-row">
      <div className="flex h-full w-full flex-col gap-4 xl:w-[70%]">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <CustomSelect
            label={'Country'}
            isDisabled={campaignStatus == 'PROCESSING'}
            placeholder="Select Country"
            options={countriesData.map((country: { name: string; isoCode: string }) => ({
              label: country?.name,
              value: country?.isoCode,
              icon: <CountryFlag code={country?.isoCode} />,
            }))}
            handleChange={(e: ISELECTVALUE | null) => {
              onCountryChange(e);
            }}
            /* Rebuilt for display instead of stored, since the saved object must
               stay plain. The ISO code is read from country_code, which holds it
               reliably - `country` itself is written as a name on one path and an
               ISO code on another. */
            value={(() => {
              const selected = watch('settings.operational_hours.regional.country');
              const iso = watch('settings.operational_hours.regional.country_code')?.value;
              return selected?.value
                ? { ...selected, icon: <CountryFlag code={iso} /> }
                : selected;
            })()}
            error={(errors.settings as any)?.operational_hours?.regional?.country?.value?.message}
          />
          <CustomSelect
            label={'Timezone'}
            isDisabled={campaignStatus == 'PROCESSING'}
            placeholder="Select Timezone"
            options={timezonesList.map((timezone: { zoneName: string }) => ({
              label: timezone?.zoneName,
              value: timezone?.zoneName,
            }))}
            handleChange={(e: ISELECTVALUE | null) => {
              setValue('settings.operational_hours.regional.timezone', e || {}, {
                shouldValidate: true,
              });
            }}
            value={watch('settings.operational_hours.regional.timezone')}
            error={(errors.settings as any)?.operational_hours?.regional?.timezone?.value?.message}
          />
        </div>
        <div className="flex w-full flex-col gap-2 md:flex-row">
          <div className="flex flex-col gap-1.5 w-full">
            <Input
              disabled={campaignStatus === 'PROCESSING'}
              label="Start Date"
              placeholder="Enter start date"
              type="date"
              {...register('startDate', {
                required: 'Start date is required',
                validate: (value) =>
                  !_end_date ||
                  moment(value).isBefore(moment(_end_date), 'day') ||
                  'Start date must be before end date',
              })}
              error={errors?.startDate?.message}
              min={today}
              max={
                _end_date ? moment(_end_date).subtract(1, 'day').format('YYYY-MM-DD') : undefined
              }
            />
          </div>

          <div className="flex items-end gap-1.5 w-full">
            <Input
              label="End Date"
              disabled={campaignStatus === 'PROCESSING'}
              placeholder="Enter end date"
              type="date"
              {...register('endDate', {
                required: 'End date is required',
                validate: (value) =>
                  !_start_date ||
                  moment(value).isAfter(moment(_start_date), 'day') ||
                  'End date must be after start date',
              })}
              error={errors?.endDate?.message}
              min={_start_date ? moment(_start_date).add(1, 'day').format('YYYY-MM-DD') : today}
            />

            <span className="bg-gray-100 rounded-lg text-gray-700 text-sm font-medium px-3 py-2 inline-flex items-center justify-center min-w-[140px] max-h-[40px] min-h-[40px]">
              {totalSelectedDays} Days
            </span>
          </div>
        </div>
        <div className="w-full">
          <div
            className={`flex flex-col gap-2 ${
              campaignStatus === 'PROCESSING' ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
              (day, index) => {
                const currentDayData = watchBusinessHour?.value?.[day];
                if (!currentDayData) return null;

                const { open } = currentDayData;
                const disabledDay = !isDayWithinRange(day);
                return (
                  <div
                    key={`${day}-${index}`}
                    className="flex flex-col gap-4 xl:flex-row xl:items-center"
                  >
                    <div className="inline-flex w-full md:w-auto">
                      <div className="bg-primary/20 rounded-xl py-3 px-4 flex gap-4 min-w-40 justify-between w-full">
                        <div className="flex gap-2">
                          <Label className={`capitalize ${disabledDay ? 'text-gray-400' : ''}`}>
                            {day}
                          </Label>
                        </div>
                        <Switch
                          onCheckedChange={(checked) => {
                            if (disabledDay) return;
                            handleChangeScheduleOption(checked, day);
                          }}
                          checked={open}
                          disabled={disabledDay}
                        />
                      </div>
                    </div>
                    <div className="flex w-full flex-col gap-4 md:flex-row">
                      <Input
                        disabled={disabledDay || !open}
                        placeholder="Enter start"
                        type="time"
                        {...register(`settings.operational_hours.value.${day}.start`)}
                      />

                      <Input
                        disabled={disabledDay || !open}
                        placeholder="Enter end"
                        type="time"
                        {...register(`settings.operational_hours.value.${day}.end`)}
                      />
                      {(errors?.settings as any)?.operational_hours?.value?.[day]?.end?.message && (
                        <ErrorTooltip
                          text={
                            (errors?.settings as any)?.operational_hours?.value?.[day]?.end?.message
                          }
                        />
                      )}

                      <div className="flex gap-2 items-center w-full">
                        <Checkbox
                          disabled={disabledDay || !open}
                          checked={watch(`settings.operational_hours.value.${day}.is_checked`)}
                          onCheckedChange={(checked: boolean) => {
                            setValue(`settings.operational_hours.value.${day}.is_checked`, checked);
                            if (checked) {
                              setValue(`settings.operational_hours.value.${day}.start`, '00:00');
                              setValue(`settings.operational_hours.value.${day}.end`, '23:59');
                            } else {
                              setValue(`settings.operational_hours.value.${day}.start`, '10:00');
                              setValue(`settings.operational_hours.value.${day}.end`, '23:00');
                            }
                          }}
                          id={`check-${index}`}
                        />
                        <Label htmlFor={`check-${index}`} className="cursor-pointer">
                          Full day
                        </Label>
                      </div>
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </div>
        <div className="p-3 rounded-lg gap-3 flex flex-col px-0">
          <div className="flex flex-col items-start gap-3">
            <div className="flex w-full flex-col gap-1.5 md:w-2/4">
              <Label>Select Holidays</Label>
              <div className="w-full flex flex-col">
                <Input
                  type="date"
                  disabled={campaignStatus == 'PROCESSING'}
                  onChange={(e) => {
                    const _val = e.target.value;
                    const _selectedVal = moment(_val).format('YYYY-MM-DD');
                    e.target.value = '';
                    return setValue(
                      'settings.operational_hours.holidays',
                      _holidays.includes(_selectedVal)
                        ? _holidays.filter((_value: any) => _selectedVal !== _value)
                        : [..._holidays, _selectedVal],
                    );
                  }}
                />
              </div>
            </div>
            {_holidays && _holidays?.length ? (
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-sm">Holidays:</span>
                <div className="flex flex-wrap gap-2">
                  {_holidays?.map((day: any) => (
                    <div
                      key={day}
                      className="flex items-center gap-1.5 min-h-10 border border-gray-300 border-dashed px-3 py-2 rounded-md bg-gray-50 relative"
                    >
                      <Label>{moment(day)?.format('MMM DD, YYYY')}</Label>
                      <span className="text-sm text-gray-600">{moment(day).format('ddd')}</span>

                      <button
                        type="button"
                        onClick={() =>
                          setValue(
                            'settings.operational_hours.holidays',
                            _holidays?.filter((_value: any) => _value !== day),
                          )
                        }
                        className="absolute -top-1 -right-1 p-0.5 rounded-full bg-red-500 text-white hover:bg-red-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="w-full rounded-xl border border-gray-200 bg-gray-50 xl:w-[30%] h-full">
        <div
          className={`flex justify-between p-3 cursor-pointer ${isAutomaticRecordingEnabled ? 'items-start' : 'items-center'}`}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Label>Call Recording</Label>
                <Switch
                  disabled={campaignStatus == 'PROCESSING'}
                  onCheckedChange={(checked) => {
                    setValue(
                      'settings.recording.automatic',
                      {
                        enabled: checked,
                        value: 'all',
                        label: 'All',
                        recording_on: 'ad98d65d-fcf8-4d4d-bc77-ee1426c34333.mp3',
                      },
                      { shouldDirty: true, shouldValidate: true },
                    );
                  }}
                  checked={isAutomaticRecordingEnabled}
                />
              </div>
            </div>
            <p className="text-gray-900 text-sm">
              Turn on this feature to automatically record this campaign call. The recording will be
              accessible in your campaign call logs.{' '}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200" />
        <div
          className={`flex justify-between p-3 cursor-pointer ${isAiCallMonitoringEnabled ? 'items-start' : 'items-center'}`}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Label>Call Monitoring</Label>
                <Switch
                  disabled={campaignStatus == 'PROCESSING'}
                  onCheckedChange={(checked) => {
                    setValue(
                      'settings.ai_call_monitoring',
                      {
                        enabled: checked,
                      },
                      { shouldDirty: true, shouldValidate: true },
                    );
                    if (checked) {
                      setValue(
                        'settings.transcription',
                        {
                          enabled: true,
                        },
                        { shouldDirty: true, shouldValidate: true },
                      );
                    }
                  }}
                  checked={isAiCallMonitoringEnabled}
                />
              </div>
            </div>
            <p className="text-gray-900 text-sm">
              Turn on this feature to automatically monitor this campaign call. The monitoring will
              be accessible in your campaign call logs.{' '}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200" />
        <div
          className={`flex justify-between p-3 cursor-pointer ${isTranscriptionEnabled ? 'items-start' : 'items-center'}`}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Label>Transcription</Label>
                <Switch
                  disabled={campaignStatus == 'PROCESSING'}
                  onCheckedChange={(checked) => {
                    setValue(
                      'settings.transcription',
                      {
                        enabled: checked,
                      },
                      { shouldDirty: true, shouldValidate: true },
                    );
                    if (!checked) {
                      setValue(
                        'settings.ai_call_monitoring',
                        {
                          enabled: false,
                        },
                        { shouldDirty: true, shouldValidate: true },
                      );
                    }
                  }}
                  checked={isTranscriptionEnabled}
                />
              </div>
            </div>
            <p className="text-gray-900 text-sm">
              Turn on this feature to automatically transcribe this campaign call. The transcript
              will be accessible in your campaign call logs.{' '}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsAndPermission;
