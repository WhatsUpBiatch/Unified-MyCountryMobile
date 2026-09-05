import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { City, Country, State } from 'country-state-city';
import { postcodeValidator, postcodeValidatorExistsForCountry } from 'postcode-validator';
import { AlertTriangle, MapPinIcon, PhoneCall } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SectionHeading } from './section-heading';
import { BackButton } from './section-actions';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import CustomSelect from '@/components/custom/custom-select';
import { CountryFlag } from '@/components/flag';
import Loader from '@/components/custom/loader';
import { handleAlert } from '@/lib/utils';
import { useCompanyFeatures } from '@/hooks/rbac';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  saveCompanyDefaults,
} from '@/lib/company-defaults';

/**
 * Emergency address (E911) panel.
 *
 * STORAGE
 * There is no dedicated company-settings endpoint in this app. Company-wide
 * settings live on a reserved `user_template` row whose `name` is exactly
 * "Company Default"; its `settings` column is a free-form JSON blob. This panel
 * reads that row with `templateList` and writes it back with `upsertTemplate`,
 * touching only the namespaced `settings.emergency_address` key and preserving
 * every other key untouched. The row is created on first save if it is missing.
 *
 * Shape written to `settings.emergency_address`:
 * {
 *   schema_version: 1,
 *   address_line_1: string,
 *   address_line_2: string,   // suite / floor, optional
 *   city: string,             // city name
 *   state: string,            // ISO subdivision code, '' when country has none
 *   postal_code: string,
 *   country: string,          // ISO 3166-1 alpha-2 code
 *   callback_number: string,  // E.164-ish, digits with optional leading +
 *   routed: false,            // ALWAYS false - nothing consumes this yet
 *   acknowledged_not_routed: true,
 *   updated_at: string        // ISO timestamp
 * }
 */

const EMERGENCY_ADDRESS_KEY = 'emergency_address';
const EMERGENCY_ADDRESS_SCHEMA_VERSION = 1;

// established systems and most E911 address validators reject PO boxes: responders cannot
// be sent to a mailbox. Catches "PO Box", "P.O. Box", "Post Office Box", "PMB".
const PO_BOX_PATTERN =
  /(\bp\.?\s*o\.?\s*box\b)|(\bpost\s*office\s*box\b)|(\bpostal\s*box\b)|(\bpo\s*bx\b)|(\bp\.?\s*m\.?\s*b\.?\s*#?\s*\d)/i;

const CALLBACK_NUMBER_PATTERN = /^\+?[0-9]{7,15}$/;

const isPoBox = (value?: string | null) => PO_BOX_PATTERN.test(String(value || ''));

const parseJsonBlob = (value: any): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

interface ISelectOption {
  label: string;
  value: string;
}

interface IEmergencyAddressForm {
  address_line_1: string;
  address_line_2: string;
  city: ISelectOption | null;
  state: ISelectOption | null;
  postal_code: string;
  country: ISelectOption | null;
  callback_number: string;
}

const DEFAULT_FORM_VALUES: IEmergencyAddressForm = {
  address_line_1: '',
  address_line_2: '',
  city: null,
  state: null,
  postal_code: '',
  country: null,
  callback_number: '',
};

const EMERGENCY_ADDRESS_SCHEMA = yup.object({
  address_line_1: yup
    .string()
    .trim()
    .required('Street address is required')
    .min(3, 'Enter the full street address')
    .test(
      'no-po-box',
      'A PO box cannot be used. Emergency services need a street address.',
      (v) => !isPoBox(v),
    ),
  address_line_2: yup
    .string()
    .trim()
    .test(
      'no-po-box',
      'A PO box cannot be used. Emergency services need a street address.',
      (v) => !isPoBox(v),
    ),
  country: yup
    .object({
      label: yup.string().required(),
      value: yup.string().required(),
    })
    .nullable()
    .required('Country is required'),
  state: yup
    .object({
      label: yup.string().required(),
      value: yup.string().required(),
    })
    .nullable()
    .test('state-required', 'State / province is required', function (value) {
      const countryCode = String((this.parent as any)?.country?.value || '');
      if (!countryCode) return true;
      const hasStates = (State.getStatesOfCountry(countryCode) || []).length > 0;
      if (!hasStates) return true;
      return Boolean(value?.value);
    }),
  city: yup
    .object({
      label: yup.string().required(),
      value: yup.string().required(),
    })
    .nullable()
    .test('city-required', 'City is required', function (value) {
      const countryCode = String((this.parent as any)?.country?.value || '');
      const stateCode = String((this.parent as any)?.state?.value || '');
      if (!countryCode || !stateCode) return true;
      const hasCities = (City.getCitiesOfState(countryCode, stateCode) || []).length > 0;
      if (!hasCities) return true;
      return Boolean(value?.value);
    }),
  postal_code: yup
    .string()
    .trim()
    .required('Postal code is required')
    .test('valid-postal-code', 'Enter a valid postal code for the selected country', function (v) {
      const postalCode = String(v || '').trim();
      if (!postalCode) return false;
      const countryCode = String((this.parent as any)?.country?.value || '')
        .trim()
        .toUpperCase();
      if (!countryCode) return true;
      if (!postcodeValidatorExistsForCountry(countryCode)) return postalCode.length >= 3;
      return postcodeValidator(postalCode, countryCode);
    }),
  callback_number: yup
    .string()
    .trim()
    .required('Callback number is required')
    .test('valid-callback', 'Enter a valid phone number, digits only, e.g. +14155550123', (v) =>
      CALLBACK_NUMBER_PATTERN.test(String(v || '').replace(/[\s()-]/g, '')),
    ),
});

const CompanyEmergencyAddress = () => {
  const queryClient = useQueryClient();
  const { features, IS_ADMIN } = useCompanyFeatures();
  const siteAccess = features?.plan_features?.account_setting?.access?.SITE?.action;
  const canView = Boolean(siteAccess?.view) || IS_ADMIN;
  const canEdit = Boolean(siteAccess?.edit) || IS_ADMIN;

  const [acknowledged, setAcknowledged] = useState(false);

  const formInstance = useForm<any>({
    defaultValues: DEFAULT_FORM_VALUES,
    resolver: yupResolver(EMERGENCY_ADDRESS_SCHEMA),
    mode: 'onChange',
  });

  const {
    control,
    register,
    reset,
    setValue,
    watch,
    handleSubmit,
    formState: { errors },
  } = formInstance;

  const [watchedCountry, watchedState] = watch(['country', 'state']);

  // Reserved company-wide settings row. There is no company-settings endpoint;
  // the "Company Default" user_template row is the agreed home for these.
  const {
    data: companyDefaultRow,
    isLoading,
    isError,
  } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    enabled: canView,
    queryFn: fetchCompanyDefaults,
  });

  const storedSettings = useMemo(
    () => parseJsonBlob(companyDefaultRow?.settings),
    [companyDefaultRow?.settings],
  );

  const storedAddress = useMemo(
    () => parseJsonBlob(storedSettings?.[EMERGENCY_ADDRESS_KEY]),
    [storedSettings],
  );

  /* `icon` is rendered by CustomSelect ahead of the label, in both the open
     menu and the closed control. Safe to hang a React element here because the
     payload takes `country.value` as a string (see onSubmit) rather than
     spreading this object — nothing of the icon reaches the API. */
  const countryOptions = useMemo(
    () =>
      (Country.getAllCountries() || []).map((country) => ({
        label: country.name,
        value: country.isoCode,
        icon: <CountryFlag code={country.isoCode} />,
      })),
    [],
  );

  const stateOptions = useMemo(() => {
    const countryCode = watchedCountry?.value;
    if (!countryCode) return [];
    return (State.getStatesOfCountry(countryCode) || []).map((stateItem) => ({
      label: stateItem.name,
      value: stateItem.isoCode,
    }));
  }, [watchedCountry?.value]);

  const cityOptions = useMemo(() => {
    const countryCode = watchedCountry?.value;
    const stateCode = watchedState?.value;
    if (!countryCode || !stateCode) return [];
    return (City.getCitiesOfState(countryCode, stateCode) || []).map((cityItem) => ({
      label: cityItem.name,
      value: cityItem.name,
    }));
  }, [watchedCountry?.value, watchedState?.value]);

  const hasStates = stateOptions.length > 0;
  const hasCities = cityOptions.length > 0;

  /* The live preview beside the fields.
   *
   * Watched rather than read on submit, because its whole purpose is to show
   * the address forming as it is typed - a dispatcher reads it as one block,
   * and a transposed house number is far easier to catch there than in the
   * field it was typed into.
   *
   * Assembled the way an address is actually written: street, then suite, then
   * "City, ST 12345" on one line. Empty parts drop out rather than leaving
   * stray commas, so a half-filled form still reads as an address. */
  const preview = watch(['address_line_1', 'address_line_2', 'city', 'state', 'postal_code', 'callback_number']);
  const [pLine1, pLine2, pCity, pState, pPostal, pCallback] = preview;

  const cityLine = [
    [pCity?.label, pState?.value].filter(Boolean).join(', '),
    String(pPostal || '').trim(),
  ]
    .filter(Boolean)
    .join(' ');

  const previewLines = [String(pLine1 || '').trim(), String(pLine2 || '').trim(), cityLine].filter(
    Boolean,
  );
  const previewCountry = watchedCountry?.value ? watchedCountry : null;
  const previewCallback = String(pCallback || '').trim();

  // Hydrate the form once the reserved row has loaded.
  useEffect(() => {
    if (isLoading) return;

    const countryCode = String(storedAddress?.country || '');
    const countryOption = countryOptions.find((option) => option.value === countryCode) || null;

    const stateCode = String(storedAddress?.state || '');
    const stateOption = countryCode
      ? (State.getStatesOfCountry(countryCode) || [])
          .map((stateItem) => ({ label: stateItem.name, value: stateItem.isoCode }))
          .find((option) => option.value === stateCode) || null
      : null;

    const cityName = String(storedAddress?.city || '');

    reset({
      address_line_1: storedAddress?.address_line_1 || '',
      address_line_2: storedAddress?.address_line_2 || '',
      city: cityName ? { label: cityName, value: cityName } : null,
      state: stateOption,
      postal_code: storedAddress?.postal_code || '',
      country: countryOption,
      callback_number: storedAddress?.callback_number || '',
    });
    setAcknowledged(false);
  }, [isLoading, storedAddress, countryOptions, reset]);

  const { mutate: saveEmergencyAddress, isPending: isSaving } = useMutation({
    mutationFn: saveCompanyDefaults,
    onSuccess: (response: any) => {
      handleAlert({
        text: response?.data?.message || 'Emergency address saved. It is recorded, not routed.',
        type: 'success',
      });
      /* Every company-level card reads this one row, so they all re-read after
         a save. Without this a sibling card would merge onto a stale blob and
         wipe what was just written here. */
      queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['userTemplateList'] });
    },
    onError: (error: any) => {
      handleAlert({
        text: error?.response?.data?.message || 'Could not save the emergency address',
        type: 'error',
      });
    },
  });

  const onSubmit = (values: IEmergencyAddressForm) => {
    if (!canEdit) {
      return handleAlert({
        text: 'You do not have permission to change the emergency address',
        type: 'error',
      });
    }
    if (!acknowledged) {
      return handleAlert({
        text: 'Please confirm you understand this address does not route emergency calls',
        type: 'error',
      });
    }

    const emergencyAddress = {
      schema_version: EMERGENCY_ADDRESS_SCHEMA_VERSION,
      address_line_1: String(values.address_line_1 || '').trim(),
      address_line_2: String(values.address_line_2 || '').trim(),
      city: String(values.city?.value || '').trim(),
      state: String(values.state?.value || '').trim(),
      postal_code: String(values.postal_code || '').trim(),
      country: String(values.country?.value || '').trim(),
      callback_number: String(values.callback_number || '').replace(/[\s()-]/g, ''),
      // Nothing in the call path reads this yet. Keep it false until the
      // carrier / switch work lands and something actually routes on it.
      routed: false,
      acknowledged_not_routed: true,
      updated_at: new Date().toISOString(),
    };

    // Merge, never replace: the blob holds other company-wide settings.
    const nextSettings = {
      ...storedSettings,
      [EMERGENCY_ADDRESS_KEY]: emergencyAddress,
    };

    const storedGreetings = parseJsonBlob(companyDefaultRow?.greetings);

    saveEmergencyAddress({
      uuid: companyDefaultRow?.uuid,
      settings: nextSettings,
      greetings: storedGreetings,
      only: [EMERGENCY_ADDRESS_KEY],
    });
  };

  const savedAt = storedAddress?.updated_at ? new Date(storedAddress.updated_at) : null;
  const hasSavedAddress = Boolean(storedAddress?.address_line_1);

  if (!canView) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center">
        <p className="text-sm font-semibold text-gray-900">
          You do not have permission to view the emergency address
        </p>
      </div>
    );
  }

  return (
    <section className="cs-section flex w-full flex-col gap-4">
      {/* On a panel, like the heading block every other section opens with. It
          was the one section whose title sat bare on the page ground. */}
      <div className="cs-block">
        <SectionHeading
          icon={<MapPinIcon className="h-[18px] w-[18px]" />}
          title="Emergency address (E911)"
          description="The street address emergency responders would be sent to, and the number they would call back on."
        />
      </div>

      {/* Small, but still a warning and still amber - not the plain grey note
          the other screens use for "saved, nothing reads it yet". Everywhere
          else that pattern costs somebody a setting that does not apply; here it
          is whether an ambulance arrives. Shortened to the three things a reader
          has to leave with: it is not used, keep another phone, and saving does
          not make you compliant. The detail that used to be here - which part of
          the system does not read it, and what building it needs - is in the
          file header, where the next engineer will look for it. */}
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-xs text-gray-800">
          <span className="font-semibold text-gray-900">
            This address is recorded here only.
          </span>{' '}
          A 999 or 911 call does not use it, and responders are not sent it — so keep a normal
          phone or a mobile available for emergencies. In the US, saving this does not make the
          account compliant with Kari&apos;s Law or the RAY BAUM&apos;S Act.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-10">
          <div className="flex items-center justify-center">
            <Loader variant="blue" size="md" />
          </div>
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center">
          <p className="text-sm font-semibold text-gray-900">
            Could not load the saved emergency address
          </p>
          <p className="text-xs text-gray-600">Refresh the page and try again.</p>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit(onSubmit as any)}
          className="flex flex-col gap-5 rounded-xl bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-3">
            <p className="text-sm font-semibold text-gray-900">Emergency address</p>
            {/* Whether one exists at all, said plainly. It was a grey aside in
                the corner, on a page whose entire question is exactly this. */}
            <span className={`mcm-e911-state${hasSavedAddress ? ' is-saved' : ''}`}>
              {hasSavedAddress && savedAt
                ? `Recorded ${savedAt.toLocaleDateString()} — written down only, not routed`
                : 'No address on file'}
            </span>
          </div>

          <div className="mcm-e911">
            <div className="mcm-e911-fields">
              <div className="mcm-e911-group">
                <span className="mcm-e911-grouph">The address</span>

                <Input
                  label="Street address (line 1)"
                  placeholder="e.g. 100 Market Street"
                  maxLength={120}
                  disabled={!canEdit}
                  error={errors?.address_line_1?.message}
                  {...register('address_line_1')}
                />

                <Input
                  label="Suite / floor / building (line 2, optional)"
                  placeholder="e.g. Suite 400, 4th floor"
                  maxLength={120}
                  disabled={!canEdit}
                  error={errors?.address_line_2?.message}
                  {...register('address_line_2')}
                />

          <div className="flex w-full flex-col gap-4 md:flex-row">
            <div className={`relative flex w-full gap-1 ${hasStates ? 'md:w-1/2' : 'md:w-full'}`}>
              <Controller
                control={control}
                name="country"
                render={({ field }) => (
                  <CustomSelect
                    label="Country"
                    placeholder="Select country"
                    options={countryOptions}
                    value={field.value}
                    isDisabled={!canEdit}
                    handleChange={(option) => {
                      field.onChange(option);
                      setValue('state', null, { shouldValidate: true, shouldDirty: true });
                      setValue('city', null, { shouldValidate: true, shouldDirty: true });
                    }}
                    error={errors?.country?.message}
                  />
                )}
              />
            </div>
            {hasStates && (
              <div className="relative flex w-full gap-1 md:w-1/2">
                <Controller
                  control={control}
                  name="state"
                  render={({ field }) => (
                    <CustomSelect
                      label="State / province"
                      placeholder="Select state"
                      options={stateOptions}
                      value={field.value}
                      isDisabled={!canEdit}
                      handleChange={(option) => {
                        field.onChange(option);
                        setValue('city', null, { shouldValidate: true, shouldDirty: true });
                      }}
                      error={errors?.state?.message}
                    />
                  )}
                />
              </div>
            )}
          </div>

          <div className="flex w-full flex-col gap-4 md:flex-row">
            {hasCities ? (
              <div className="relative flex w-full gap-1 md:w-1/2">
                <Controller
                  control={control}
                  name="city"
                  render={({ field }) => (
                    <CustomSelect
                      label="City"
                      placeholder="Select city"
                      options={cityOptions}
                      value={field.value}
                      isDisabled={!canEdit}
                      handleChange={(option) => field.onChange(option)}
                      error={errors?.city?.message}
                      menuPlacement="top"
                    />
                  )}
                />
              </div>
            ) : (
              <div className="relative flex w-full gap-1 md:w-1/2">
                <Controller
                  control={control}
                  name="city"
                  render={({ field }) => (
                    <Input
                      label="City"
                      placeholder="Enter city"
                      maxLength={60}
                      disabled={!canEdit}
                      value={field.value?.value || ''}
                      onChange={(event) => {
                        const cityName = event.target.value;
                        field.onChange(cityName ? { label: cityName, value: cityName } : null);
                      }}
                      error={errors?.city?.message}
                    />
                  )}
                />
              </div>
            )}
            <div className="relative flex w-full gap-1 md:w-1/2">
              <Input
                label="Postal code"
                placeholder="Enter postal code"
                maxLength={12}
                disabled={!canEdit}
                error={errors?.postal_code?.message}
                {...register('postal_code')}
              />
            </div>
          </div>

              </div>

              <div className="mcm-e911-group">
                <span className="mcm-e911-grouph">If the call drops</span>
                <Input
                  label="Emergency callback number"
                  placeholder="e.g. +14155550123"
                  maxLength={16}
                  disabled={!canEdit}
                  Icon={<PhoneCall className="h-4 w-4 text-gray-500" />}
                  error={errors?.callback_number?.message}
                  {...register('callback_number')}
                />
                <p className="text-xs text-gray-500">
                  The number responders would ring if the emergency call drops. Today nothing dials
                  it automatically - it is stored for your records and for whoever you hand this
                  address to.
                </p>
              </div>

              {/* Tokens, not palette classes. The originals were amber-300 /
                  amber-50 / amber-900 and gray-50, which do not move in dark
                  mode and do not follow a brand colour. */}
              <div className="mcm-e911-warn">
                <AlertTriangle className="h-4 w-4" />
                <p>
                  A PO box will be rejected. Emergency responders need a street address they can
                  drive to, so a mailbox is not accepted here - this matches what carriers and other
                  providers require.
                </p>
              </div>

              <div className="mcm-e911-ack">
                <Checkbox
                  id="emergency-address-acknowledgement"
                  checked={acknowledged}
                  disabled={!canEdit}
                  onCheckedChange={(checked) => setAcknowledged(checked === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="emergency-address-acknowledgement">
                  I understand this address is only written down. It does not route emergency calls
                  and it is not sent to emergency responders.
                </Label>
              </div>
            </div>

            {/* The address as one thing rather than seven fields. Seven inputs
                give seven fragments and no way to check the whole; this is what
                somebody would actually be handed. */}
            <aside className="mcm-e911-card">
              <span className="mcm-e911-card-eyebrow">What a responder would be given</span>

              {previewLines.length ? (
                <div className="mcm-e911-lines">
                  {previewLines.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                  {previewCountry ? (
                    <div className="is-country">
                      <CountryFlag code={previewCountry.value} />
                      {previewCountry.label}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mcm-e911-empty">
                  Nothing to show yet. Fill in the address and it appears here as a responder would
                  be given it.
                </p>
              )}

              <div className="mcm-e911-callback">
                <PhoneCall className="h-3.5 w-3.5" />
                {previewCallback ? (
                  previewCallback
                ) : (
                  <span className="is-missing">No callback number yet</span>
                )}
              </div>
            </aside>
          </div>

          {canEdit && (
            <div className="cs-savebar">
              <BackButton />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="cs-save"
                disabled={isSaving}
              >
                {isSaving ? <Loader variant="white" size="xs" /> : null}
                Save settings
              </Button>
            </div>
          )}
        </form>
      )}
    </section>
  );
};

export default CompanyEmergencyAddress;
