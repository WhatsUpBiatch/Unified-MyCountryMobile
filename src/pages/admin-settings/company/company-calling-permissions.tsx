import { useEffect, useMemo, useState } from 'react';
import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Globe2, PhoneForwarded, PhoneOutgoing, ShieldAlert } from 'lucide-react';

import Loader from '@/components/custom/loader';
import { Button } from '@/components/ui/button';
import { SectionActions } from './section-actions';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { handleAlert } from '@/lib/utils';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  saveCompanyDefaults,
  type CompanyDefaultTemplate,
} from '@/lib/company-defaults';
import { COUNTRY_OPTIONS, type CountryOption } from '@/lib/company-default-country';
import { normalizeDidCountries } from '@/lib/did-countries';
import { useHomeCountry } from '@/lib/home-country';
import { useUser } from '@/hooks/use-user';
import {
  buildCompanyInternationalRule,
  describeCompanyRule,
  readCompanyInternationalRule,
  toCountryList,
} from '@/lib/international-calling';

/**
 * Company calling permissions
 * -----------------------------------------------------------------------------
 * The established systems Office Settings that decide which number a person may show on an
 * outbound call, and where they may send a call once it is connected. They are
 * kept in the reserved user_template row called "Company Default", namespaced
 * under `settings.company_calling_permissions`, so nothing else in that blob is
 * touched on save.
 *
 * These are toll-fraud controls, not conveniences. Every one of them defaults to
 * OFF, which is how the safe default ships them, because each one is a way of turning a
 * call the company already pays for into a second leg the company also pays for —
 * and an outside caller who can reach a transfer prompt can dial a premium-rate
 * number on your bill.
 *
 * IMPORTANT — nothing in this product reads `settings.company_calling_permissions.*`
 * yet. Checked, then verified per setting:
 *
 *   - Caller ID choices are built in `src/hooks/use-dialpad-caller-id-options.ts`.
 *     It lists only the DIDs assigned to the signed-in user (`useGetAssignedDIDNumbers`,
 *     src/hooks/common.ts:72) and offers no office/group number and no hidden option,
 *     so neither caller-ID setting below has anything to switch on or off today.
 *   - Transfer targets are typed in `src/components/dialpad/components/dialpad-transfer-list.tsx`
 *     and dispatched by `handleTransfer` in `src/context/dialpad-context.tsx:2460`.
 *     The only check on an external target is `length >= 3` — no company lookup,
 *     no country test, no direction test.
 *   - Admin-side external forwarding destinations come from
 *     `src/components/custom/forwarding-actions.tsx` (the `PHONE` case, line 251),
 *     an unrestricted phone input that accepts any country.
 *
 * So every control on this page is a recorded decision, not an enforced rule. Each
 * one says so in its own words. Do not soften those notes: telling an admin a fraud
 * control is protecting them when it is not is worse than not shipping the control.
 *
 * The same is true of the newest control here, "Calling other countries", and it
 * is the most expensive one to get wrong in either direction. Its decision lives
 * in src/lib/international-calling.ts with its own tests; this screen only asks
 * the question and stores the answer, under
 * `settings.company_calling_permissions.international_calling`. Read that file
 * before changing anything about it — in particular, why the answer is NOT
 * stored on the `companies.allow_country` column (that column is the plan's
 * entitlement, filled at signup, and the console cannot write it), and why an
 * account that has configured nothing must go on calling everywhere.
 */

const PERMISSIONS_KEY = 'company_calling_permissions';
const PERMISSIONS_SCHEMA_VERSION = 1;

interface PermissionsForm {
  allow_office_or_group_caller_id: boolean;
  allow_hidden_caller_id: boolean;
  allow_external_transfer: boolean;
  allow_international_transfer: boolean;
  allow_outbound_call_external_transfer: boolean;
  allow_ivr_external_forwarding: boolean;
  ivr_external_forwarding_domestic_only: boolean;
  /* Which countries this company may call. See src/lib/international-calling.ts
     for the rule these two feed, and for why they are stored here rather than on
     the `companies.allow_country` column the plan fills in. */
  international_restricted: boolean;
  international_countries: string[];
}

/* These defaults describe what the product does TODAY, not what we would choose
   for a brand new account.
   
   That distinction became load-bearing the moment the transfer switches started
   being honoured. This page writes the whole permissions block on save, so if
   the transfer boxes arrived unticked, an admin who opened this page to look at
   caller ID and pressed Save would store "external transfer: not allowed" and
   stop every outside transfer in the company — having decided nothing about
   transfers at all. The form must therefore open showing what is actually
   happening, so that saving changes nothing and turning a control off is always
   a deliberate act.
   
   Off-by-default for new accounts is the right posture and belongs at signup,
   where it can be a real decision rather than a side effect of a Save button.
   
   The two caller-ID switches stay off because off IS today's behaviour for
   them: nothing offers a company or group number unless they are switched on. */
const DEFAULT_FORM: PermissionsForm = {
  allow_office_or_group_caller_id: false,
  allow_hidden_caller_id: false,
  allow_external_transfer: true,
  allow_international_transfer: true,
  allow_outbound_call_external_transfer: true,
  /* True because that is what menus do today. Off-by-default belongs at signup,
     not as a side effect of someone saving this page for another reason. */
  allow_ivr_external_forwarding: true,
  ivr_external_forwarding_domestic_only: false,
  /* Off, because off is what happens today: the platform places calls to every
     country for everybody. A company that has never opened this screen must go
     on working exactly as it does now, so the only way to restrict calling is
     for an admin to deliberately switch this on. */
  international_restricted: false,
  international_countries: [],
};

const toSettingsObject = (rawSettings: any): Record<string, any> => {
  if (!rawSettings) return {};
  if (typeof rawSettings === 'string') {
    try {
      const parsed = JSON.parse(rawSettings);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawSettings === 'object' ? rawSettings : {};
};

const toGreetingsObject = (rawGreetings: any): Record<string, any> =>
  toSettingsObject(rawGreetings);

const toBoolean = (value: any, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const buildFormFromSettings = (settings: Record<string, any>): PermissionsForm => {
  const permissions = settings?.[PERMISSIONS_KEY] || {};
  const callerId = permissions?.caller_id || {};
  const transfers = permissions?.transfers || {};
  const ivrForwarding = permissions?.ivr_external_forwarding || {};
  const internationalRule = readCompanyInternationalRule(settings);

  const allowIvrForwarding = toBoolean(
    ivrForwarding?.allowed,
    DEFAULT_FORM.allow_ivr_external_forwarding,
  );
  const allowExternalTransfer = toBoolean(
    transfers?.allow_external,
    DEFAULT_FORM.allow_external_transfer,
  );

  return {
    allow_office_or_group_caller_id: toBoolean(
      callerId?.allow_office_or_group_number,
      DEFAULT_FORM.allow_office_or_group_caller_id,
    ),
    allow_hidden_caller_id: toBoolean(callerId?.allow_hidden, DEFAULT_FORM.allow_hidden_caller_id),
    allow_external_transfer: allowExternalTransfer,
    /* International is a child of external. A stored `true` under a parent that is
       off is read as off rather than shown checked-but-inert, so what is on screen
       is always what would actually be permitted. */
    allow_international_transfer:
      allowExternalTransfer &&
      toBoolean(transfers?.allow_international, DEFAULT_FORM.allow_international_transfer),
    allow_outbound_call_external_transfer: toBoolean(
      transfers?.allow_outbound_call_external,
      DEFAULT_FORM.allow_outbound_call_external_transfer,
    ),
    allow_ivr_external_forwarding: allowIvrForwarding,
    /* Never on under a parent that is off, on read as well as on write. */
    ivr_external_forwarding_domestic_only:
      allowIvrForwarding &&
      toBoolean(ivrForwarding?.domestic_only, DEFAULT_FORM.ivr_external_forwarding_domestic_only),
    /* Read through the shared module rather than by hand, so this screen and
       whatever eventually checks a live call read the stored answer the same
       way — including the part where anything missing means no restriction. */
    international_restricted: internationalRule.restricted,
    /* Sorted so that "has anything changed?" compares like with like, whatever
       order the countries happened to be stored in. */
    international_countries: [...internationalRule.countries].sort(),
  };
};

const buildPermissionsPayload = (form: PermissionsForm) => ({
  version: PERMISSIONS_SCHEMA_VERSION,
  updated_at: new Date().toISOString(),
  caller_id: {
    allow_office_or_group_number: form.allow_office_or_group_caller_id,
    allow_hidden: form.allow_hidden_caller_id,
  },
  transfers: {
    allow_external: form.allow_external_transfer,
    /* Written the same way it is read: the child can never be stored true while
       its parent is false, so a later reader cannot mistake a leftover value for
       a permission that was granted. */
    allow_international: form.allow_external_transfer && form.allow_international_transfer,
    allow_outbound_call_external: form.allow_outbound_call_external_transfer,
  },
  ivr_external_forwarding: {
    allowed: form.allow_ivr_external_forwarding,
    domestic_only: form.allow_ivr_external_forwarding && form.ivr_external_forwarding_domestic_only,
  },
  /* Built by the shared module so the stored shape is the one its reader
     expects, and so a country list can never be stored under a switch that is
     off — see src/lib/international-calling.ts. */
  international_calling: buildCompanyInternationalRule({
    restricted: form.international_restricted,
    countries: form.international_countries,
  }),
});

/* The line an admin reads under the country list. Kept out of the component so
   the wording is next to the payload it describes. */
/* The switch reads this now. It was stored-and-ignored until 30 August 2026,
   when the check went into the call path: the dialplan reads this company
   record and the person's own permission before it picks a carrier, and
   refuses the call if the country is not allowed.

   The one thing worth saying on screen is the safety rule that makes it
   harmless to leave alone: with no list chosen, every country is allowed, so
   nothing changes for a company that never opens this. A restriction only
   exists once somebody sets one. */
const INTERNATIONAL_ACTIVE_NOTE =
  'Refused by the switch itself, so a desk phone cannot get around it. With no list chosen, every country is allowed.';

/**
 * A per-setting honesty badge. `enforced` is only ever passed `true` once
 * something in the call path genuinely acts on that key — today nothing does.
 */
interface PermissionRowProps {
  label: string;
  description: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /* Whether anything in the product actually acts on this key today. */
  enforced: boolean;
  enforcementNote: string;
  disabled?: boolean;
  disabledNote?: string;
  isChild?: boolean;
}

/* One checkbox, one honesty badge, one note about that key alone. Deliberately
   not one disclaimer for the page: each of these settings has a different reader
   that would have to honour it, so each gets its own answer. */
const PermissionRow = ({
  label,
  description,
  checked,
  onCheckedChange,
  enforced,
  enforcementNote,
  disabled = false,
  disabledNote,
  isChild = false,
}: PermissionRowProps) => (
  /* Renders through SettingRow so this looks like every other settings screen,
     while keeping the two things a permission needs and a plain row does not:
     a child row sits indented under the permission it depends on, and a row that
     cannot be changed says why rather than just going grey. */
  <div className={isChild ? 'sm:ml-6' : ''}>
    <SettingRow
      label={label}
      description={description}
      notActive={!enforced}
      control={
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
      }
    />
    {disabled && disabledNote ? <p className="mcm-setrow-note">{disabledNote}</p> : null}
    {enforcementNote ? (
      <p className={`mcm-setrow-note${enforced ? ' is-on' : ''}`}>{enforcementNote}</p>
    ) : null}
  </div>
);

/**
 * The list of countries a company may call.
 *
 * Deliberately a searchable list of tick boxes rather than a drop-down. An admin
 * doing this job is answering "where does my business actually phone?", which
 * means seeing what is ticked and what is not at a glance — a drop-down hides
 * the answer behind a click, and the answer is the whole point.
 *
 * The company's own country is always ticked and cannot be unticked. A call
 * inside your own country is not an international call, so removing it could
 * only ever be a mistake — and on an account whose own country we cannot read,
 * it is the one entry that stops the list from cutting off local calling.
 */
interface CountryChooserProps {
  options: CountryOption[];
  selected: string[];
  /* The company's own country, or '' when the account does not have one. */
  homeCountry: string;
  homeCountryName: string;
  onToggle: (code: string, checked: boolean) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  /* True when the plan itself limits where this company can call. */
  isPlanLimited: boolean;
}

const CountryChooser = ({
  options,
  selected,
  homeCountry,
  homeCountryName,
  onToggle,
  onSelectAll,
  onClearAll,
  isPlanLimited,
}: CountryChooserProps) => {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
    );
  }, [options, query]);

  const chosen = new Set(selected);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search countries"
          className="h-9 max-w-[260px]"
        />
        <Button type="button" variant="outline" size="sm" onClick={onSelectAll}>
          Select all
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClearAll}>
          Clear all
        </Button>
        <span className="text-xs text-gray-500">
          {selected.length} of {options.length} chosen
        </span>
      </div>

      {isPlanLimited ? (
        <p className="text-xs text-gray-500">
          This list is the set of countries your plan covers. To call somewhere that is not on it,
          your plan has to change first.
        </p>
      ) : null}

      <div className="max-h-[280px] overflow-y-auto rounded-lg border border-gray-200 bg-white">
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-500">No country matches that search.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visible.map((option) => {
              const isHome = Boolean(homeCountry) && option.value === homeCountry;
              return (
                <li key={option.value} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    checked={isHome || chosen.has(option.value)}
                    disabled={isHome}
                    onCheckedChange={(value) => onToggle(option.value, value === true)}
                  />
                  <span className="text-sm text-gray-900">{option.label}</span>
                  {isHome ? (
                    <span className="text-[11px] font-medium text-gray-500">
                      Your own country — always allowed
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!homeCountry ? (
        <p className="text-xs text-amber-700">
          We could not work out which country your company is in, so nothing has been ticked for
          you. Tick {homeCountryName === 'your country' ? 'your own country' : homeCountryName}{' '}
          yourself before you save, or calls at home could be treated as calls abroad.
        </p>
      ) : null}
    </div>
  );
};

const CompanyCallingPermissions = () => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PermissionsForm>(DEFAULT_FORM);
  const { user } = useUser();
  const { homeCountry, homeCountryName } = useHomeCountry();

  /* Which countries an admin may even choose from.

     `companies.allow_country` is filled at signup from the plan the company
     bought, so it says what the PLAN covers rather than what the admin wants.
     That makes it the right menu and the wrong place to save the answer — the
     console cannot write that column at all. When a plan carries no list, every
     country is offered, because an empty plan list means "no plan limit" and
     not "nowhere". */
  const planCountries = useMemo(
    () => toCountryList(normalizeDidCountries(user?.company_info?.allow_country)),
    [user?.company_info?.allow_country],
  );

  const countryOptions = useMemo<CountryOption[]>(() => {
    if (!planCountries.length) return COUNTRY_OPTIONS;
    const allowed = new Set(planCountries);
    const fromPlan = COUNTRY_OPTIONS.filter((option) => allowed.has(option.value));
    /* A plan naming a country our own list does not know would otherwise vanish
       from the menu, so it is added back under its code rather than dropped. */
    const known = new Set(fromPlan.map((option) => option.value));
    const missing = planCountries
      .filter((code) => !known.has(code))
      .map((code) => ({ label: code, value: code }));
    return [...fromPlan, ...missing].sort((a, b) => a.label.localeCompare(b.label));
  }, [planCountries]);

  const isPlanLimited = planCountries.length > 0;

  const {
    data: companyDefaultTemplate = null,
    isLoading,
    isError,
  } = useQuery<CompanyDefaultTemplate | null>({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
  });

  const savedSettings = useMemo(
    () => toSettingsObject(companyDefaultTemplate?.settings),
    [companyDefaultTemplate],
  );

  const savedForm = useMemo(() => buildFormFromSettings(savedSettings), [savedSettings]);

  useEffect(() => {
    setForm(savedForm);
  }, [savedForm]);


  const { mutate: savePermissions, isPending: isSaving } = useMutation({
    mutationFn: saveCompanyDefaults,
    onSuccess: (response: any) => {
      handleAlert({
        text: response?.data?.message || 'Calling permissions saved',
        type: 'success',
      });
      /* The whole company record is invalidated, not just this card. Policies,
         holidays and emergency address all read the same row, so a save here must
         make them re-read — otherwise the next card saves a merge built on a stale
         blob and silently drops what was just written. */
      queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['userTemplateList'] });
    },
  });

  const updateForm = (patch: Partial<PermissionsForm>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  /* Turning the parent off takes the child with it, in the form as well as in the
     payload, so the screen never shows an international permission sitting under a
     transfer permission that is switched off. */
  /* Turning the parent off clears the child, so a stored "domestic only" can
     never sit under a setting that is switched off. */
  const setIvrExternalForwarding = (checked: boolean) =>
    updateForm({
      allow_ivr_external_forwarding: checked,
      ivr_external_forwarding_domestic_only: checked && form.ivr_external_forwarding_domestic_only,
    });

  const setExternalTransfer = (checked: boolean) =>
    updateForm({
      allow_external_transfer: checked,
      allow_international_transfer: checked ? form.allow_international_transfer : false,
    });

  /* The company's own country is added on every write, not only on the tick.
     An admin who restricts calling and forgets to tick their own country would
     otherwise store a rule that treats every local call as a call abroad — the
     one mistake on this screen that could stop a business answering its own
     phones. */
  /* Sorted on the way out as well, so that ticking a country and unticking it
     again leaves the form exactly as it was found. Without that the Save button
     stays lit after a change that undid itself, and an admin is invited to save
     a rule identical to the one already stored. */
  const withHomeCountry = (codes: string[]): string[] =>
    [...(homeCountry && !codes.includes(homeCountry) ? [...codes, homeCountry] : codes)].sort();

  const setInternationalRestricted = (checked: boolean) =>
    updateForm({
      international_restricted: checked,
      /* Turning the restriction on with nothing chosen would read as "nowhere
         abroad", which is a real answer but never the one somebody means by
         ticking a box. They start from the countries already stored, plus home. */
      international_countries: checked ? withHomeCountry(form.international_countries) : [],
    });

  const toggleCountry = (code: string, checked: boolean) =>
    updateForm({
      international_countries: withHomeCountry(
        checked
          ? [...form.international_countries.filter((item) => item !== code), code]
          : form.international_countries.filter((item) => item !== code),
      ),
    });

  const selectAllCountries = () =>
    updateForm({ international_countries: withHomeCountry(countryOptions.map((o) => o.value)) });

  const clearAllCountries = () => updateForm({ international_countries: withHomeCountry([]) });

  const handleSave = () => {
    // Merge, never replace: the Company Default row also carries the rest of the
    // company defaults blob, and other screens write into it.
    const nextSettings = {
      ...savedSettings,
      [PERMISSIONS_KEY]: buildPermissionsPayload(form),
    };

    savePermissions({
      uuid: companyDefaultTemplate?.uuid,
      settings: nextSettings,
      greetings: toGreetingsObject(companyDefaultTemplate?.greetings),
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center py-10">
        <Loader />
      </div>
    );
  }

  return (
    <section className="cs-section flex w-full flex-col gap-4">
      <div className="cs-block">
        <p className="text-lg font-semibold text-gray-900">Calling permissions</p>
        <p className="text-xs text-gray-500">
          Which countries your team can phone, which number they show when they call out, and where
          they may send a call once it is connected.
        </p>
      </div>

      <div className="w-full">
        <div className="flex w-full flex-col gap-4">
          {/* Amber, not red. Nothing here is broken or urgent — it is a
              standing caution about settings that are safe as they ship, and red
              is the colour this console uses for things that are actually
              wrong. */}
          <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
              <p className="text-xs font-semibold text-amber-900">
                These are fraud controls, not conveniences
              </p>
              <p className="text-xs text-amber-800">
                Each one turns a call you already pay for into a second leg you also pay for.
                Transfers start off; calls abroad do not — until you pick a list, every country is
                allowed. That is the one worth setting today.
              </p>
            </div>
          </div>

          {isError && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center">
              <p className="text-sm font-semibold text-gray-900">
                We could not load the saved permissions
              </p>
              <p className="text-xs text-gray-500">
                What you see below are the built-in defaults, not your saved values. Reload before
                you save, or you may overwrite permissions you cannot currently see.
              </p>
            </div>
          )}

          {!companyDefaultTemplate && !isError && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-4">
              <p className="text-sm font-semibold text-gray-900">No permissions saved yet</p>
              <p className="text-xs text-gray-500">
                Nothing has been set for your company yet. Choose what you want below and save.
              </p>
            </div>
          )}

          {/* First on the page on purpose. Every other control here limits what
              happens to a call that already exists; this one limits what can be
              dialled at all, and it is the only one where a mistake shows up as
              money on an invoice. */}
          <SettingCard
            icon={<Globe2 className="h-5 w-5" />}
            title="Calling other countries"
            description="Which countries your team can phone. Calls abroad are where a stolen password turns into a real bill."
            enforced
            enforcementNote={INTERNATIONAL_ACTIVE_NOTE}
          >
            <SettingRow
              label="Only allow calls to the countries chosen below"
              description="Off, any country can be called — how your account works today. On, only the countries you tick."
              control={
                <Checkbox
                  checked={form.international_restricted}
                  onCheckedChange={(value) => setInternationalRestricted(value === true)}
                />
              }
            />
            <p className="mcm-setrow-note">
              {describeCompanyRule({
                restricted: form.international_restricted,
                countries: form.international_countries,
              })}
            </p>

            {form.international_restricted ? (
              <SettingRow
                label="Countries your team can call"
                description="Tick the countries you phone. Anything unticked is refused by the switch."
              >
                <CountryChooser
                  options={countryOptions}
                  selected={form.international_countries}
                  homeCountry={homeCountry || ''}
                  homeCountryName={homeCountryName}
                  onToggle={toggleCountry}
                  onSelectAll={selectAllCountries}
                  onClearAll={clearAllCountries}
                  isPlanLimited={isPlanLimited}
                />
              </SettingRow>
            ) : null}

            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              This is the company's answer, and it is the ceiling: a single person can be refused a
              country you allow here, on their own record under People, but nobody can be given a
              country this list leaves out. Calls to your own country, internal extensions and
              emergency numbers are never affected by any of it.
            </p>
          </SettingCard>

          <SettingCard
            icon={<PhoneOutgoing className="h-5 w-5" />}
            title="Outbound caller ID"
            description="Which number the person being called sees when a team member dials out."
          >
            <PermissionRow
              label="Allow team members to use the office number or group numbers for which they are a member as caller ID"
              description="Someone can show the main office number, or a group's number, instead of their own line."
              checked={form.allow_office_or_group_caller_id}
              onCheckedChange={(checked) =>
                updateForm({ allow_office_or_group_caller_id: checked })
              }
              enforced={false}
              enforcementNote="Not active yet. People can currently choose only the numbers assigned to them."
            />
            <PermissionRow
              label="Allow team members to hide their caller ID. Calls from them will appear as 'unknown'."
              description="The person called sees no number. Anyone can dial *67 to hide one call, or *82 to show it, whichever way this is set."
              checked={form.allow_hidden_caller_id}
              onCheckedChange={(checked) => updateForm({ allow_hidden_caller_id: checked })}
              enforced={false}
              enforcementNote="Not active yet — your number still shows. *67 withholds it for one call, where the carrier allows."
            />
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              How the pair works: if neither of these two is on, a team member with more than one
              line can only ever call out from their own primary number.
            </p>
          </SettingCard>

          <SettingCard
            icon={<ArrowRightLeft className="h-5 w-5" />}
            title="Transferring a call outside the company"
            description="Whether a live call may be sent to a number that is not yours, and whether it may leave the country."
          >
            <PermissionRow
              label="Allow team members to transfer calls outside of the company"
              description="Hand a live call to any outside number, not just a colleague or queue."
              checked={form.allow_external_transfer}
              onCheckedChange={setExternalTransfer}
              enforced
              enforcementNote="Active. Off stops transfers to outside numbers."
            />
            <PermissionRow
              label="Allow transfers to international numbers"
              description="Extends the above to numbers abroad, where toll fraud usually lands."
              checked={form.allow_international_transfer}
              onCheckedChange={(checked) => updateForm({ allow_international_transfer: checked })}
              enforced
              enforcementNote="Active. Off stops transfers to other countries."
              disabled={!form.allow_external_transfer}
              disabledNote="Locked off: external transfers are not allowed at all. Allow those first."
              isChild
            />
          </SettingCard>

          <SettingCard
            icon={<PhoneForwarded className="h-5 w-5" />}
            title="Transferring a call your team made"
            description="Whether a call your team dialled out may then be sent on to another outside number."
          >
            <PermissionRow
              label="Allow transferring an outbound call to an external number"
              description="Your team calls out, then hands that call to a third outside number. You pay for both legs, and neither party works for you. Leave it off unless a team needs it."
              checked={form.allow_outbound_call_external_transfer}
              onCheckedChange={(checked) =>
                updateForm({ allow_outbound_call_external_transfer: checked })
              }
              enforced
              enforcementNote="Active. Off stops people passing on a call they placed themselves."
            />
          </SettingCard>

          <SettingCard
            icon={<ShieldAlert className="h-5 w-5" />}
            title="Sending a caller out of a phone menu"
            description="Whether a menu key can pass a caller to a number outside your company."
          >
            <PermissionRow
              label="Let a menu key forward to an outside number"
              description="A caller presses a key and reaches a number outside your company. You are billed for both halves."
              checked={form.allow_ivr_external_forwarding}
              onCheckedChange={(checked) => setIvrExternalForwarding(checked)}
              enforced
              enforcementNote="Active. Off stops an outside number being set on a menu key. Existing menus keep working."
            />
            <PermissionRow
              isChild
              label="Only to numbers in your own country"
              description="Calls abroad are the expensive ones. On keeps a menu from dialling out of the country."
              checked={form.ivr_external_forwarding_domestic_only}
              disabled={!form.allow_ivr_external_forwarding}
              disabledNote="Turn the setting above on first."
              onCheckedChange={(checked) =>
                updateForm({ ivr_external_forwarding_domestic_only: checked })
              }
              enforced
              enforcementNote="Active. Numbers outside your country cannot be chosen for a menu key."
            />
          </SettingCard>

          <div className="cs-savebar">
            <p className="text-xs text-gray-500">
              Saved for your whole company. Your other settings are not affected.
            </p>
            <SectionActions>
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="cs-save"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save settings'}
              </Button>
            </SectionActions>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CompanyCallingPermissions;
