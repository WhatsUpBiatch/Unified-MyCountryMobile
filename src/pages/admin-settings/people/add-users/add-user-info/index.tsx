import { useFieldArray, useFormContext } from 'react-hook-form';
import CustomSelect from '@/components/custom/custom-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser } from '@/hooks/use-user';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { userInitialState } from '../../../constants';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getRoleList, getUserList, validateUser } from '@/services/api';
import PhoneInput from 'react-phone-input-2';
import 'react-phone-input-2/lib/style.css';
import type { ISELECTVALUE } from '@/interfaces/api-interfaces';
import { Plus, TrashBin } from '@/assets/icons';
import { useGetSite } from '@/hooks/common';
import OrderSummary from '../order-summary';
import { Label } from '@/components/ui/label';
import ErrorTooltip from '@/components/custom/error-tooltip';
import { generateRandomExtension, handleAlert } from '@/lib/utils';
import { Icon } from '@/assets/icons/icon';
import CustomTooltip from '@/components/custom/custom-tooltip';
import { InfoIcon } from 'lucide-react';
import { COMPANY_DEFAULTS_QUERY_KEY, fetchCompanyDefaults } from '@/lib/company-defaults';
import { NEW_PERSON_ROLE_KEY, readNewPersonRole } from '@/lib/role-permission-defaults';
import {
  decideInviteRole,
  describeRole,
  roleWarning,
  toRoleChoice,
} from '@/lib/invite-role';
import {
  blocksInvite,
  clashForField,
  explainTakenEmail,
  findInviteClashes,
  summariseClashes,
} from '@/lib/invite-duplicates';

type User = typeof userInitialState;
type ValidationErrorMap = {
  [index: number]: {
    email?: string;
    phone?: string;
    extension?: string;
  };
};
const debounce = (fn: any, delay: any) => {
  let timer: any;
  return (...args: any) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const AddUserInfo = ({
  setIspaymentRequired,
  setOrderSummary,
  setIsUserValidatorError,
  dataGetMyPlanDetails,
  setPaymentCalculation,
}: any) => {
  const {
    register,
    watch,
    setValue,
    control,
    formState: { errors },
  }: any = useFormContext<any>();
  const { user } = useUser();
  // const [errorType, setErrorType] = useState(null);
  // const [errIndex, setErrIndex] = useState(null);
  // const [validatorErrors, setValidatorErrors] = useState(null);

  const [validationErrors, setValidationErrors] = useState<ValidationErrorMap>({});
  const formFieldArrayInstance = useFieldArray({
    control: control,
    name: 'users',
  });

  const { data: companySiteList, isLoading } = useGetSite();

  const { data: roleList = [], isPending } = useQuery({
    queryKey: ['useRolesList', false],
    queryFn: () => getRoleList(),
    select: (data) => data?.data?.data?.result?.rows || [],
  });

  /* The role a new person should start on, if the company has chosen one under
     Admin > People > Default permissions. Without it this box opens empty and
     whoever is adding somebody has to remember which of the roles is right. */
  const { data: companyDefaults } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
  });
  const defaultRoleId = readNewPersonRole(
    (companyDefaults as any)?.settings?.[NEW_PERSON_ROLE_KEY],
  );

  /* Everybody already on the account, read under the key the People page
     already uses so opening this form from there costs nothing extra.
     It is what lets a clash say "Amara Osei, at London" instead of the
     platform's four words, "Email already exists!". */
  const { data: roster = [] } = useQuery({
    queryKey: ['directoryPeople'],
    queryFn: () => getUserList({ page: 1, limit: 500 }),
    select: (res: any) => res?.data?.data?.result?.rows || [],
  });

  /* Which role a new person starts on, and why that one. The company's own
     answer wins; with no answer the narrowest role on the account is used, and
     an administrator is never chosen for somebody automatically. The reasoning
     and its tests live in lib/invite-role.ts, so this form and the Default
     permissions screen cannot drift apart. */
  const roleDecision = useMemo(
    () => decideInviteRole({ savedRoleId: defaultRoleId, roles: roleList }),
    [defaultRoleId, roleList],
  );

  /* Which rows have already been offered that answer, held by the row's own id
     rather than its position — removing the first row renumbers every other
     one, and a set of positions would then re-fill a row somebody had
     deliberately cleared. A row is filled in once and never again. */
  const seededRows = useRef<Set<string>>(new Set());

  const { fields, append, remove } = formFieldArrayInstance;

  const [users, userAddCountRaw] = watch(['users', 'user_add_count']) as [User[], number | null];

  useEffect(() => {
    const picked = roleDecision.role;
    if (!picked || !Array.isArray(users)) return;

    fields.forEach((field: any, index: number) => {
      const rowId = String(field?.id || index);
      if (seededRows.current.has(rowId)) return;
      seededRows.current.add(rowId);
      // Never overwrite a row somebody has already answered.
      if ((users as any[])[index]?.role?.value) return;

      setValue(`users.${index}.role`, { label: picked.name, value: picked.id });
      setValue(`users.${index}.role_uuid`, picked.custom ? '' : picked.id);
      setValue(`users.${index}.custom_role_uuid`, picked.custom ? picked.id : '');
    });
  }, [roleDecision, fields, users, setValue]);

  /* The role showing on one row right now, whether it was filled in for the
     admin or picked by hand. Used to say underneath what that role actually
     allows, because the names alone do not. */
  const chosenRoleOf = (index: number) => {
    const value = (users as any[])?.[index]?.role?.value;
    if (!value) return null;
    return toRoleChoice(
      roleList.find((item: any) => (item?.type === 'custom' ? item?.uuid : item?.role_uuid) === value),
    );
  };

  /* The same person typed twice, or somebody who is already here. The platform
     cannot find either — two unsaved rows are not "taken" yet, and its check
     spans every company it hosts rather than just this one. */
  const clashes = useMemo(() => findInviteClashes({ rows: users, roster }), [users, roster]);
  const userAddCount = Number(userAddCountRaw) || 0;
  const { plan_info, user_info = {}, company_info } = user || {};
  const isPlanExpired = company_info?.plan_status === 'EXPIRED';
  const isTrial = company_info?.is_trial === 'Y';

  const planCost = dataGetMyPlanDetails?.current_plan_details?.discount_enabled
    ? dataGetMyPlanDetails?.current_plan_details?.discount_price || 0
    : dataGetMyPlanDetails?.current_plan_details?.original_price || 0;

  const licenseInfo = useMemo(() => {
    const licenseDetail = dataGetMyPlanDetails?.license_detail || {};

    /* What this screen used to show on its own: spare licences + licences freed
       by revoked users. */
    const reportedFree =
      (licenseDetail?.free_licenses || 0) + (licenseDetail?.free_revoked_licenses || 0);

    /* What the API actually enforces when it decides whether to charge:
       licences owned minus licences already in use. If either field is missing
       we fall back to the old number rather than guess. */
    const totalLicenses = Number(licenseDetail?.total_licenses);
    const usedLicenses = Number(licenseDetail?.used_licenses);
    const enforcedFree =
      Number.isFinite(totalLicenses) && Number.isFinite(usedLicenses)
        ? Math.max(0, totalLicenses - usedLicenses)
        : null;

    /* Trust the smaller of the two. Promising a free seat the API then refuses
       to create is what dead-ends the admin, so we would rather show the
       payment step they can actually complete. */
    const available = enforcedFree === null ? reportedFree : Math.min(reportedFree, enforcedFree);
    const hasLicenseMismatch = enforcedFree !== null && enforcedFree !== reportedFree;

    const currentUserCount = users?.length || 0;
    const extraUnits = Math.max(0, currentUserCount - available);

    const extraCharge = extraUnits > 0;
    const cost = extraUnits * planCost;

    return {
      available,
      reportedFree,
      enforcedFree,
      hasLicenseMismatch,
      currentUserCount,
      extraUnits,
      extraCharge,
      cost,
    };
  }, [users, dataGetMyPlanDetails, planCost]);
  const { mutate: mutateValidateUser } = useMutation({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mutationFn: ({ index, ...payload }: any) => validateUser(payload),

    onSuccess: (_, variables) => {
      const { index, type } = variables;

      setValidationErrors((prev) => ({
        ...prev,
        [index]: {
          ...prev[index],
          [type]: undefined,
        },
      }));
    },

    onError: (err: any, variables) => {
      const { index, type } = variables;
      const errMsg = err?.response?.data?.message;

      setValidationErrors((prev) => ({
        ...prev,
        [index]: {
          ...prev[index],
          [type]: errMsg,
        },
      }));
    },
  });

  /* Whether the platform has rejected anything still on the form.
     It used to be set straight from each reply, which meant a successful check
     on row two's phone cleared the flag row one's rejected email had raised —
     and the Continue button came back on with a known-bad row on screen. Read
     from the errors themselves and that cannot happen: the flag is true exactly
     while a rejection is showing. */
  const apiRejected = useMemo(
    () =>
      Object.values(validationErrors).some(
        (row: any) => row && Object.values(row).some((message) => Boolean(message)),
      ),
    [validationErrors],
  );

  /* Continue is off while anything on this form would be refused — by the
     platform, or by the duplicate checks it cannot make. */
  useEffect(() => {
    setIsUserValidatorError(apiRejected || blocksInvite(clashes));
  }, [apiRejected, clashes, setIsUserValidatorError]);

  /* What to show under a field, worst first: a clash we can explain properly
     beats the platform's wording, and the platform's wording beats nothing.
     "Email already exists!" is turned into a sentence naming the colleague, or
     saying plainly that the address belongs outside this company — which the
     platform's own answer never distinguishes. */
  const emailProblem = (index: number) => {
    const clash = clashForField(clashes, index, 'email');
    if (clash) return clash.message;
    const fromApi = validationErrors?.[index]?.email;
    if (fromApi) {
      return /already exists/i.test(String(fromApi))
        ? explainTakenEmail((users as any[])?.[index]?.email, roster) || fromApi
        : fromApi;
    }
    return errors?.users?.[index]?.email?.message;
  };

  const extensionProblem = (index: number) =>
    clashForField(clashes, index, 'extension')?.message ||
    errors?.users?.[index]?.extension?.message ||
    validationErrors?.[index]?.extension;

  const phoneProblem = (index: number) =>
    clashForField(clashes, index, 'phone')?.message ||
    errors?.users?.[index]?.phone?.message ||
    validationErrors?.[index]?.phone;

  // const { mutate: mutateValidateUser } = useMutation({
  //   mutationFn: validateUser,
  //   onSuccess: () => {
  //     setErrorType(null);
  //     setErrIndex(null);
  //     setIsUserValidatorError(false);
  //     setValidatorErrors(null);
  //   },
  //   onError: (err: any) => {
  //     const errMsg = err?.response?.data?.message;
  //     setIsUserValidatorError(true);
  //     setValidatorErrors(errMsg);
  //   },
  // });

  // const useDebouncedValidateUser = (mutateValidateUser: any, delay = 500) => {
  //   return useCallback(
  //     debounce((value: any, index: any) => {
  //       setErrIndex(index);
  //       setErrorType(value?.type);
  //       mutateValidateUser({ ...value });
  //     }, delay),
  //     [mutateValidateUser, delay],
  //   );
  // };
  // const handleValidateUser = useDebouncedValidateUser(mutateValidateUser);

  const useDebouncedValidateUser = (mutateFn: any, delay = 500) => {
    return useCallback(
      debounce((value: any, index: number) => {
        mutateFn({ ...value, index });
      }, delay),
      [mutateFn, delay],
    );
  };

  const handleValidateUser = useDebouncedValidateUser(mutateValidateUser);

  const MAX_USERS = 10;

  const handleUserAddCountChange = (event: ChangeEvent<HTMLInputElement>) => {
    /* Two digits, so the box can express MAX_USERS. Anything below 1 clears the
       field, anything above the cap is pinned to the cap. */
    const sanitizedValue = event.target.value.replace(/[^0-9]/g, '').slice(0, 2);
    const parsedValue = sanitizedValue ? Number(sanitizedValue) : null;
    const nextValue =
      parsedValue === null || parsedValue < 1 ? null : Math.min(parsedValue, MAX_USERS);

    setValue('user_add_count', nextValue, {
      shouldDirty: true,
      shouldTouch: true,
    });
  };

  const handleAddUser = () => {
    if (isPlanExpired) {
      handleAlert({
        text: 'You cannot add people until your subscription is renewed.',
        type: 'error',
      });
      return;
    }

    if (isTrial) {
      handleAlert({
        text: 'This feature is not available in your current plan. Please upgrade',
        type: 'error',
      });
      return;
    }

    if (userAddCount < 1 || userAddCount > MAX_USERS) {
      handleAlert({
        text: `Please enter a number between 1 and ${MAX_USERS}.`,
        type: 'warning',
      });
      return;
    }

    const currentCount = users?.length;

    const availableLicensesToPurchase =
      plan_info?.dataValues?.licenses !== 0
        ? (plan_info?.dataValues?.licenses || 0) -
          (dataGetMyPlanDetails?.license_detail?.total_licenses || 0)
        : 'Unlimited';

    const maxAllowed =
      availableLicensesToPurchase !== 'Unlimited'
        ? Math.min(MAX_USERS, availableLicensesToPurchase)
        : MAX_USERS;

    if (currentCount >= maxAllowed) {
      handleAlert({
        text:
          availableLicensesToPurchase !== 'Unlimited' && currentCount >= availableLicensesToPurchase
            ? `You have reached the maximum limit of available licenses.`
            : `You can add up to 10 people at once.`,
        type: 'warning',
      });
      return;
    }

    if (userAddCount > maxAllowed) {
      handleAlert({
        text:
          availableLicensesToPurchase !== 'Unlimited' && userAddCount > availableLicensesToPurchase
            ? `You can only add up to ${availableLicensesToPurchase} people with the licences you have.`
            : `You can add up to 10 people at once.`,
        type: 'warning',
      });
      return;
    }

    const remainingSlots = maxAllowed - currentCount;

    if (userAddCount > remainingSlots) {
      if (currentCount === 1 && userAddCount === maxAllowed) {
        // Silently allow it if there's only the default row and they entered the max allowed,
        // it will append (maxAllowed - 1) rows, bringing the total exactly to maxAllowed.
      } else {
        handleAlert({
          text:
            availableLicensesToPurchase !== 'Unlimited' && remainingSlots < MAX_USERS - currentCount
              ? `You can only add ${remainingSlots} more ${remainingSlots === 1 ? 'person' : 'people'} with the licences you have.`
              : `You can only add ${remainingSlots} more ${remainingSlots === 1 ? 'person' : 'people'}.`,
          type: 'warning',
        });
        return;
      }
    }

    const count = Math.min(userAddCount, remainingSlots);
    if (count <= 0) return;

    Array.from({ length: count }).forEach(() => {
      append({ ...userInitialState });
    });

    setValue('user_add_count', '');
  };

  // const handleAddUser = () => {
  //   const count = Math.min(userAddCount, 10 - users.length);

  //   if (count <= 0) return;

  //   for (let i = 0; i < count; i++) {
  //     append({ ...userInitialState });
  //   }
  //   setValue('user_add_count', '');
  // };

  const generateNewExtension = (index: number) => {
    const newExtension = generateRandomExtension();
    setValue(`users.[${index}].extension`, newExtension, { shouldValidate: true });
    handleValidateUser({ value: newExtension, type: 'extension' }, index);
  };

  useEffect(() => {
    if (user_info) {
      const obj = {
        label: user_info?.site_detail?.name,
        value: user_info?.site_uuid,
      };
      setValue('site', obj);
    }
  }, [user_info]);

  useEffect(() => {
    setIspaymentRequired(licenseInfo.extraCharge);
  }, [licenseInfo.extraCharge]);

  useEffect(() => {
    setOrderSummary({
      watchUserLength: users.length,
      availableLicenses: licenseInfo?.available,
      totalPayableUnit: licenseInfo?.extraUnits,
    });
  }, [users.length, licenseInfo?.available, licenseInfo?.extraUnits]);

  useEffect(() => {
    fields.forEach((_, index) => {
      if (!watch(`users.[${index}].extension`)) {
        generateNewExtension(index);
      }
    });
  }, [fields?.length]);

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
      {/* The licence panel.
 
          This was five centred sentences with the controls buried in the middle
          of them — "Licenses available to purchase: 2988", then the field, then
          "Unused licenses: 0", then "New licenses purchased: 1", then a
          paragraph about roles, each its own centred line. Centred text reads as
          prose, so three separate figures looked like a paragraph and the one
          thing to DO on the row was the hardest part to find.
 
          Now: what you do on the left, what it costs you on the right, and the
          notes underneath. Everything left-aligned, because a column of figures
          is read down its left edge. */}
      {/* No box. A tinted, bordered panel sitting inside a bordered drawer above
          a row of bordered cards was three frames deep before any content — the
          layering the screen was accused of. Spacing and a rule where one is
          actually needed do the same job. */}
      {/* The same 12px the list of people below is inset by, so the controls,
          the figures and the cards all start on one left edge. */}
      <div className="mt-3 ps-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          {/* Aligned to the bottom of the fields so the button stands level
              with the boxes rather than with their labels. */}
          {/* The hint is taken out of the flow below, so all three controls are
              label-plus-box and nothing else. Aligned on their bottom edge the
              boxes then line up with each other and with the button, which was
              the misalignment: the select was sitting level with the hint text
              under the number field rather than with the field itself. */}
          <div className="flex flex-wrap items-end gap-2 pb-5">
            <div className="relative w-32">
              <Input
                label="How many people"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="e.g. 3"
                value={String(userAddCountRaw ?? '')}
                onChange={handleUserAddCountChange}
                maxLength={2}
              />
              <p className="absolute left-0 top-full mt-1 ps-[2px] text-[10px] text-gray-500">
                Between 1 and {MAX_USERS}
              </p>
            </div>
            <Button variant={'outline'} type="button" onClick={handleAddUser}>
              <Plus className="w-3 h-3" />
              Add people
            </Button>
            <div className="w-full sm:w-[220px]">
              <CustomSelect
                label="Location"
                options={companySiteList?.map((site: { name: string; uuid: string }) => ({
                  label: site?.name,
                  value: site?.uuid,
                }))}
                placeholder="Select location"
                isLoading={isLoading}
                handleChange={(e: ISELECTVALUE | null) => {
                  setValue(`site`, e || { label: '', value: '' }, { shouldValidate: true });
                }}
                value={watch('site')}
                error={errors?.site?.value?.message}
              />
            </div>
          </div>

          {/* Three figures, set as figures: the number large enough to read at a
              glance with what it counts under it, rather than three sentences
              of the same weight as everything else on the screen. */}
          {/* The same 20px the controls row reserves under its boxes for the
              hint. Both sides then end on one line, which puts the figures level
              with the fields instead of level with "Between 1 and 10". */}
          <dl className="flex gap-6 pb-5">
            <div>
              <dd className="text-lg font-semibold leading-tight text-gray-900">
                {plan_info?.dataValues?.licenses !== 0
                  ? plan_info?.dataValues?.licenses -
                    dataGetMyPlanDetails?.license_detail?.total_licenses
                  : 'Unlimited'}
              </dd>
              <dt className="text-[11px] text-gray-500">Available to buy</dt>
            </div>
            <div>
              <dd className="flex items-center gap-1 text-lg font-semibold leading-tight text-gray-900">
                {licenseInfo?.available || 0}
                <CustomTooltip text="License purchased" side="top">
                  <InfoIcon className="w-3.5 h-3.5 cursor-pointer text-gray-400" />
                </CustomTooltip>
              </dd>
              <dt className="text-[11px] text-gray-500">Unused</dt>
            </div>
            <div>
              <dd className="text-lg font-semibold leading-tight text-gray-900">
                {licenseInfo?.extraUnits || 0}
              </dd>
              <dt className="text-[11px] text-gray-500">Buying now</dt>
            </div>
          </dl>
        </div>

        {licenseInfo?.hasLicenseMismatch ? (
          <p className="mt-3 text-xs text-amber-700">
            Your plan lists {licenseInfo?.reportedFree} unused licence
            {licenseInfo?.reportedFree === 1 ? '' : 's'}, but billing can only confirm{' '}
            {licenseInfo?.enforcedFree}. We use the lower number so you are not blocked at checkout.
          </p>
        ) : null}

        {/* Which role everybody on this form starts on, and why that one. Said
            once here rather than repeated on every row: it is the same answer
            for all of them, and it is a company-wide setting somebody can go
            and change. */}
        {roleDecision.reason ? (
          <p className="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-600">
            {roleDecision.reason}
          </p>
        ) : null}
        {roleDecision.warning ? (
          <p className="mt-1 text-xs font-medium text-amber-700">{roleDecision.warning}</p>
        ) : null}

        {/* One line saying what is wrong with the list as a whole, so somebody
            scrolling ten rows knows there is something to find. */}
        {clashes.length ? (
          <p
            role="status"
            className="mx-auto mt-2 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800"
          >
            {summariseClashes(clashes)}
          </p>
        ) : null}
      </div>
      <div className="mcm-invitee-list flex flex-col my-2 gap-3 pr-0 md:pr-3 lg:gap-2">
        {fields?.map((_, index) => (
          /* Each person is now a named block rather than a run of fields.
 
             With the card around each of them gone, ten people were one long
             column of First Name / Last Name / Email repeating and nothing said
             where one ended and the next began — a rule alone is a join, not a
             heading. Numbering them says how many there are, which one you are
             on, and which row the delete button belongs to. */
          <section key={index} className="mcm-invitee-block">
            <header className="mcm-invitee-head">
              <span className="mcm-invitee-n">{index + 1}</span>
              <h4>
                {/* Their name once they have one, so a long list reads as people
                    rather than as "Person 4". */}
                {[watch(`users.${index}.first_name`), watch(`users.${index}.last_name`)]
                  .filter(Boolean)
                  .join(' ') || `Person ${index + 1}`}
              </h4>
              {/* Both of this person's actions, on the heading line.
 
                  They were two more cells in the field grid, so they landed
                  wherever the flow put them — one under Phone, one under Role —
                  reading as controls belonging to those fields rather than to
                  the person. On the heading they are unmistakably theirs, and
                  the heading gains the weight that tells one block from the
                  next. */}
              <div className="mcm-invitee-acts">
                <CustomTooltip text="Give this person a new extension" side="top">
                  <button
                    type="button"
                    aria-label={`Give person ${index + 1} a new extension`}
                    onClick={() => generateNewExtension(index)}
                  >
                    <Icon name="Refresh" className="h-4 w-4" />
                  </button>
                </CustomTooltip>
                {fields.length > 1 && (
                  <CustomTooltip text="Remove this person" side="top">
                    <button
                      type="button"
                      className="is-remove"
                      aria-label={`Remove person ${index + 1}`}
                      onClick={() => remove(index)}
                    >
                      <TrashBin className="h-4 w-4" />
                    </button>
                  </CustomTooltip>
                )}
              </div>
            </header>
            <div className="mcm-invitee grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="w-full">
              <Input
                label="First Name"
                type="text"
                placeholder="First Name"
                {...register(`users.${index}.first_name`)}
                error={errors?.users?.[index]?.first_name?.message}
                maxLength={50}
              />
            </div>
            <div className="w-full">
              <Input
                label="Last Name"
                type="text"
                placeholder="Last Name"
                {...register(`users.${index}.last_name`)}
                error={errors?.users?.[index]?.last_name?.message}
                maxLength={50}
              />
            </div>
            <div className="w-full">
              <Input
                label="Email"
                type="email"
                placeholder="Email"
                {...register(`users.${index}.email`)}
                error={emailProblem(index)}
                onChange={(e) => {
                  const value = e.target.value;
                  setValue(`users.[${index}].email`, value, {
                    shouldValidate: true,
                  });
                  handleValidateUser({ value, type: 'email' }, index);
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5 w-full">
              <div className="flex items-center justify-between">
                <Label>Phone</Label>
                <div className="flex items-start">
                  {phoneProblem(index) ? <ErrorTooltip text={phoneProblem(index)} /> : null}
                </div>
              </div>
              <div className="flex w-full gap-1">
                <PhoneInput
                  country={'us'}
                  value={watch(`users.${index}.phone`)}
                  onChange={(value) => {
                    setValue(`users.[${index}].phone`, value, {
                      shouldValidate: true,
                    });
                    handleValidateUser({ value, type: 'phone' }, index);
                  }}
                  containerClass={`w-full ${errors?.users?.[index]?.phone?.message ? 'phone-error' : ''}`}
                  enableSearch={true}
                />
              </div>
            </div>

            <div className="w-full">
              <CustomSelect
                label="Role"
                value={watch(`users.${index}.role`)}
                options={roleList.map(
                  (role: { name: string; role_uuid: string; type: string; uuid: string }) => ({
                    label: role?.name,
                    value: role?.type === 'custom' ? role?.uuid : role?.role_uuid,
                  }),
                )}
                handleChange={(e: ISELECTVALUE | null) => {
                  setValue(`users.${index}.role`, e || { label: '', value: '' }, {
                    shouldValidate: true,
                  });
                  /* Branch on the role's `type`, not on its display name: a custom
                     role may legitimately be called "ADMIN", and the old test
                     would then have written it into role_uuid. Both fields are
                     set every time — one to the id, the other cleared — because
                     leaving the previous one behind meant switching from a custom
                     role back to a system role silently kept the custom role, the
                     backend checking custom_role_uuid first. */
                  const picked = roleList.find(
                    (item: any) =>
                      (item?.type === 'custom' ? item?.uuid : item?.role_uuid) === e?.value,
                  );
                  const isCustomRole = picked?.type === 'custom';
                  setValue(`users.${index}.role_uuid`, isCustomRole ? '' : e?.value || '', {
                    shouldValidate: true,
                  });
                  setValue(`users.${index}.custom_role_uuid`, isCustomRole ? e?.value || '' : '', {
                    shouldValidate: true,
                  });
                }}
                error={errors?.users?.[index]?.role?.value?.message}
                isLoading={isPending}
              />
              {/* What that role actually allows. The names the platform ships
                  with — AGENT, MANAGER, SUB-ADMIN — do not say, and the
                  permissions behind them barely differ, so the box on its own is
                  a guess dressed up as a decision. The words come from the same
                  place the Default permissions screen reads them, so the two
                  screens describe a role identically. */}
              {(() => {
                const chosen = chosenRoleOf(index);
                const caution = roleWarning(chosen);
                return chosen ? (
                  <>
                    <p className="mt-1 text-[11px] leading-snug text-gray-500">
                      {describeRole(chosen)}
                    </p>
                    {caution ? (
                      <p className="mt-0.5 text-[11px] font-medium leading-snug text-amber-600">
                        {caution}
                      </p>
                    ) : null}
                  </>
                ) : null;
              })()}
            </div>

            <div className="w-full">
              <Input
                label="Extension"
                type="text"
                placeholder="Extension"
                value={watch(`users.[${index}].extension`)}
                error={extensionProblem(index)}
                onChange={(e) => {
                  const value = e.target.value;
                  setValue(`users.[${index}].extension`, value, {
                    shouldValidate: true,
                  });
                  handleValidateUser({ value, type: 'extension' }, index);
                }}
                maxLength={5}
              />
            </div>

            </div>
          </section>
        ))}
      </div>

      {licenseInfo.extraCharge ? (
        <OrderSummary
          customClass="w-full lg:w-4/6 xl:w-3/5 xxl:w-3/6"
          orderSummary={{
            watchUserLength: users?.length,
            availableLicenses: licenseInfo?.available,
            totalPayableUnit: licenseInfo?.extraUnits,
          }}
          dataGetMyPlanDetails={dataGetMyPlanDetails}
          onCalculationChange={setPaymentCalculation}
        />
      ) : null}
    </div>
  );
};

export default AddUserInfo;
