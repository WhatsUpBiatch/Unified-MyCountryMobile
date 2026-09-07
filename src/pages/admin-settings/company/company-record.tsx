/* The company itself, above the list of places it works from.
 *
 * Established business phone systems separate the organisation from its
 * locations, and put the organisation first: name, address, and the ID that
 * support asks for. MCM stores all of that on the `companies` record and, for
 * a long time, showed none of it and let none of it be changed.
 *
 * Two doors to that record
 * ------------------------
 * Newer servers have `/api/company/self` and `/api/company/self/update`. They
 * return and change the caller's own `companies` row - the real one, that
 * invoices and number purchases read - and the company is taken from the
 * session on the server, so an admin can only ever reach their own. When the
 * server has them, this card reads and writes the row directly and nothing
 * else.
 *
 * Older servers do not have them. There, the only endpoints that touch the
 * row sit under /api/admin behind the platform-staff check: every customer
 * admin gets a 401, and a 401 used to end the session. So on those servers
 * the card keeps a copy of the name and address in the company settings row
 * (`settings.company_identity`), and tries the admin route once as a
 * best-effort extra. That path is only used when the new endpoint answers
 * "no such route" - see lib/company-self.ts.
 *
 * Only the fields the admin actually edited are sent, on both paths. The
 * server writes just those and leaves the rest alone.
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Copy } from 'lucide-react';
import { City, State } from 'country-state-city';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import CustomSelect from '@/components/custom/custom-select';
import countryList from '@/lib/countries.json';
import { CountryFlag } from '@/components/flag';
import { upsertCompany } from '@/services/api';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  saveCompanyDefaults,
} from '@/lib/company-defaults';
import {
  COMPANY_SELF_QUERY_KEY,
  CompanySelfChanges,
  CompanySelfOutcome,
  fetchCompanySelfRecord,
  saveCompanySelfRecord,
} from '@/lib/company-self';
import { handleAlert } from '@/lib/utils';
import { useUser } from '@/hooks/use-user';

/* Signup stores ISO codes - `IN`, `MH` - so every company record holds codes
   rather than names. The selects show the readable name and save the code,
   which keeps this form consistent with the records already there and with
   whatever reads them. Cities have no ISO code and are stored by name. */
type Option = { label: string; value: string };

const COUNTRY_OPTIONS: Option[] = (countryList || []).map((country: any) => ({
  label: country?.name || '',
  value: country?.isoCode || '',
}));

/* The flag beside each country, drawn rather than stored.

   Elsewhere in Company the flag is attached to the option as an `icon` field.
   That works where the option is rebuilt on every render, but this form keeps
   the chosen option in react-hook-form state and rebuilds it again in `reset`,
   so the icon would have to be remembered in two places and would sit as a
   React element inside form state. `FormatOptionLabel` is react-select's own
   hook for this: the options and the value stay plain `{label, value}` data,
   and the flag is drawn for the menu row and the selected row alike.

   `option.value` is already the ISO code this form saves, so there is nothing
   to look up. */
const CountryOptionLabel = ({ option }: { option: Option }) => (
  <span className="flex items-center gap-2">
    <CountryFlag code={option?.value} />
    <span>{option?.label}</span>
  </span>
);

interface CompanyRecordProps {
  companyInfo?: any;
  /* The default location. Used only on older servers, as a fallback source
     for the company name - see `name` below. */
  defaultSite?: any;
}

const Field = ({ label, value }: { label: string; value?: string }) => (
  <div className="space-y-0.5">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
    <p className="text-sm font-medium text-gray-900 break-words">{value?.trim() ? value : '—'}</p>
  </div>
);

const text = (value: unknown): string => `${value ?? ''}`.trim();

const CompanyRecord = ({ companyInfo, defaultSite }: CompanyRecordProps) => {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  /* Older servers only. Set once the admin route has actually refused a save,
     so the explanation is shown only when it is true. */
  const [serverRefused, setServerRefused] = useState(false);
  const { refetch } = useUser();
  const queryClient: any = useQueryClient();

  /* Which door. `self` means the real row came back; `absent` means the
     server has no such endpoint and the settings-row copy is used instead.
     No retries: a 404 is an answer, and a real failure should be shown at
     once rather than after three quiet attempts. */
  const {
    data: selfOutcome,
    isLoading: isProbing,
  } = useQuery<CompanySelfOutcome>({
    queryKey: COMPANY_SELF_QUERY_KEY,
    queryFn: fetchCompanySelfRecord,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const usesSelf = selfOutcome?.source === 'self';
  const usesFallback = selfOutcome?.source === 'absent';

  /* The settings-row copy, asked for only when the server has no self
     endpoint. On newer servers it is never read here. */
  const { data: companyDefaults } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
    staleTime: 5 * 60 * 1000,
    enabled: usesFallback,
  });
  /* Left `undefined` rather than `{}` when there is nothing, so the value is
     stable between renders and the form is not re-seeded while typing. */
  const identity: Record<string, any> | undefined = usesFallback
    ? companyDefaults?.settings?.company_identity
    : undefined;

  const uuid = companyInfo?.uuid || '';

  /* What the card shows and the form seeds from.

     New servers: the row itself.

     Old servers: the session's company_info carries `address` but not
     `name`, city, state, country or postal code, so the copy in the settings
     row fills those in where it has them. For the name there is one more
     fallback: signup names the default location after the company, so that
     name is used when nothing better is known. */
  const record: Record<string, any> = useMemo(() => {
    if (usesSelf) return selfOutcome.record;
    const session = companyInfo || {};
    if (!usesFallback) return session;
    const merged: Record<string, any> = { ...session };
    for (const key of ['name', 'address', 'city', 'state', 'country', 'postal_code']) {
      const copy = identity?.[key];
      if (text(copy)) merged[key] = copy;
    }
    return merged;
  }, [usesSelf, usesFallback, selfOutcome, companyInfo, identity]);

  const name = usesSelf
    ? text(record?.name)
    : text(record?.name) || text(record?.company_name) || text(defaultSite?.name);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { dirtyFields },
  } = useForm<any>({
    defaultValues: {
      name: '',
      address: '',
      postal_code: '',
      country: null,
      state: null,
      city: null,
    },
  });

  const country: Option | null = watch('country');
  const stateValue: Option | null = watch('state');

  const stateOptions: Option[] = useMemo(() => {
    if (!country?.value) return [];
    return (State.getStatesOfCountry(country.value) || []).map((item) => ({
      label: item.name,
      value: item.isoCode,
    }));
  }, [country?.value]);

  const cityOptions: Option[] = useMemo(() => {
    if (!country?.value || !stateValue?.value) return [];
    return (City.getCitiesOfState(country.value, stateValue.value) || []).map((item) => ({
      label: item.name,
      value: item.name,
    }));
  }, [country?.value, stateValue?.value]);

  /* Re-seeded whenever the record changes or the form is opened, so cancelling
     and reopening shows the saved values rather than the abandoned edit. */
  useEffect(() => {
    /* Stored values are codes. They are matched back to a readable name so the
       select shows "India" rather than "IN"; if a code is not recognised the
       stored value is kept as its own label rather than silently blanked. */
    const storedCountry = text(record?.country);
    const countryOption =
      COUNTRY_OPTIONS.find((option) => option.value === storedCountry) ||
      (storedCountry ? { label: storedCountry, value: storedCountry } : null);

    const storedState = text(record?.state);
    const statesForCountry = countryOption?.value
      ? State.getStatesOfCountry(countryOption.value) || []
      : [];
    const matchedState = statesForCountry.find((item) => item.isoCode === storedState);
    const stateOption = matchedState
      ? { label: matchedState.name, value: matchedState.isoCode }
      : storedState
        ? { label: storedState, value: storedState }
        : null;

    const storedCity = text(record?.city);

    reset({
      name,
      address: record?.address || '',
      postal_code: record?.postal_code || '',
      country: countryOption,
      state: stateOption,
      city: storedCity ? { label: storedCity, value: storedCity } : null,
    });
  }, [record, isEditing, name, reset]);

  /* Shown with the readable country name rather than the stored code, so the
     summary does not read "Mumbai, MH, 400001, IN". */
  const countryName =
    COUNTRY_OPTIONS.find((option) => option.value === record?.country)?.label || record?.country;

  const addressLine = [
    record?.address,
    record?.city,
    record?.state,
    record?.postal_code,
    countryName,
  ]
    .map((part) => text(part))
    .filter(Boolean)
    .join(', ');

  /* New servers: one request to the row itself. The reply is the row as it
     now stands, and it goes straight into the query cache so the card shows
     the saved values without a second round trip.

     Old servers: two writes, deliberately. The settings-row copy always
     succeeds, so an admin can always correct what their company is called.
     The admin route is then tried too, because on a deployment where it is
     open to customers it is the right thing to update. The two outcomes are
     reported differently: claiming "saved" when only half of it landed is how
     someone finds out months later that their invoices carry the old name. */
  const { mutate: save, isPending } = useMutation({
    mutationFn: async (values: any): Promise<{ path: 'self' | 'fallback'; billingUpdated: boolean }> => {
      const changed: CompanySelfChanges = values.changed;

      if (!usesFallback) {
        const row = await saveCompanySelfRecord(changed);
        queryClient.setQueryData(COMPANY_SELF_QUERY_KEY, { source: 'self', record: row });
        return { path: 'self', billingUpdated: true };
      }

      const nextIdentity = {
        version: 1,
        updated_at: new Date().toISOString(),
        name: text(values.name),
        address: text(values.address),
        postal_code: text(values.postal_code),
        country: values.country?.value || '',
        state: values.state?.value || '',
        city: values.city?.value || '',
      };

      await saveCompanyDefaults({
        uuid: companyDefaults?.uuid,
        settings: { ...(companyDefaults?.settings || {}), company_identity: nextIdentity },
        greetings: companyDefaults?.greetings || {},
        only: ['company_identity'],
      });

      /* Attempted, never required. A refusal here is expected where the row
         is platform-staff only, and it must not turn a successful save into a
         failure. */
      let billingUpdated = false;
      if (uuid) {
        try {
          await upsertCompany({ uuid, ...changed });
          billingUpdated = true;
        } catch {
          billingUpdated = false;
        }
      }

      return { path: 'fallback', billingUpdated };
    },
    onSuccess: ({ path, billingUpdated }) => {
      if (path === 'fallback' && !billingUpdated) setServerRefused(true);
      handleAlert({
        text:
          path === 'self'
            ? 'Company details saved.'
            : billingUpdated
              ? 'Company details saved, including your billing record.'
              : 'Saved. Your console is updated — your billing record is held separately and only your provider can change that.',
        type: 'success',
      });
      setIsEditing(false);
      if (path === 'fallback') {
        queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
      }
      refetch();
    },
    onError: (error: any) => {
      handleAlert({
        text:
          error?.response?.data?.message ||
          error?.response?.data?.error?.message ||
          error?.message ||
          'Could not save the company details. Nothing was changed.',
        type: 'error',
      });
    },
  });

  /* Only the fields the admin actually edited are sent, and a field left
     alone is omitted rather than sent empty. The server treats an omitted
     field as "leave it" and an empty one as "clear it", so this is the
     difference between correcting one line of the address and blanking four
     columns the admin never looked at. */
  const onSubmit = (values: any) => {
    const changed: CompanySelfChanges = {};
    if (dirtyFields.name) changed.name = values.name;
    if (dirtyFields.address) changed.address = values.address;
    if (dirtyFields.postal_code) changed.postal_code = values.postal_code;
    /* Codes for country and state, matching what signup wrote; cities have no
       code so the name is the value. */
    if (dirtyFields.country) changed.country = values.country?.value || '';
    if (dirtyFields.state) changed.state = values.state?.value || '';
    if (dirtyFields.city) changed.city = values.city?.value || '';

    if (!Object.keys(changed).length) {
      return handleAlert({ text: 'Nothing has been changed.', type: 'info' });
    }

    save({ ...values, changed } as any);
  };

  const handleCopyId = async () => {
    if (!uuid) return;
    try {
      await navigator.clipboard.writeText(uuid);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Refused in some browsers and over plain http. The id is on screen
         anyway, so there is nothing to recover from. */
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ucass-primary-200 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-gray-900">{name || 'Your company'}</p>
            <p className="text-xs text-gray-500">
              The company record. Every location below belongs to it.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {uuid && (
            <button
              type="button"
              onClick={handleCopyId}
              title="Copy company ID"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Company ID'}
            </button>
          )}
          {/* Held back until the server has said which door is open, so the
              form never seeds from the wrong record. */}
          {!isEditing && (
            <Button
              type="button"
              variant="outline"
              disabled={isProbing}
              onClick={() => setIsEditing(true)}
            >
              Edit details
            </Button>
          )}
        </div>
      </div>

      {/* Older servers only, and only after the admin route has refused a
          save. On a server with the self endpoint the row itself is changed
          and there is nothing to explain. */}
      {usesFallback && serverRefused && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-gray-900">
            These details cannot be changed from here yet
          </p>
          <p className="mt-1 text-xs text-gray-700">
            The name shown above is your main location&rsquo;s name, and you <strong>can</strong>{' '}
            change that — edit the main location below and the name here follows. That corrects what
            everyone sees.
          </p>
          <p className="mt-1 text-xs text-gray-700">
            Your registered address is held on a separate billing record, which only your provider
            can change today. Invoices and number purchases read that record, so ask them to update
            it if it is wrong.
          </p>
        </div>
      )}

      {isEditing ? (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Company name" placeholder="Enter company name" {...register('name')} />
            <Input label="Street address" placeholder="Enter address" {...register('address')} />

            <CustomSelect
              label="Country"
              placeholder="Select country"
              options={COUNTRY_OPTIONS}
              FormatOptionLabel={CountryOptionLabel}
              value={country}
              handleChange={(option: any) => {
                setValue('country', option || null, { shouldDirty: true });
                /* State and city belong to the old country, so they are cleared
                   rather than left pointing somewhere that no longer exists. */
                setValue('state', null, { shouldDirty: true });
                setValue('city', null, { shouldDirty: true });
              }}
            />

            <CustomSelect
              label="State / region"
              placeholder={country ? 'Select state' : 'Choose a country first'}
              options={stateOptions}
              value={stateValue}
              isDisabled={!country}
              handleChange={(option: any) => {
                setValue('state', option || null, { shouldDirty: true });
                setValue('city', null, { shouldDirty: true });
              }}
            />

            <CustomSelect
              label="City"
              placeholder={stateValue ? 'Select city' : 'Choose a state first'}
              options={cityOptions}
              value={watch('city')}
              isDisabled={!stateValue}
              handleChange={(option: any) => setValue('city', option || null, { shouldDirty: true })}
            />

            <Input
              label="Postal code"
              placeholder="Enter postal code"
              {...register('postal_code')}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="transparent" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save company details'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Company name" value={name} />
          <div className="lg:col-span-2">
            <Field label="Registered address" value={addressLine} />
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyRecord;
