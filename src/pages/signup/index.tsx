import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import * as yup from 'yup';
import {
  requiredAllString,
  requiredEmail,
  requiredString,
  selectFieldRequired,
} from '@/lib/schema';
import { yupResolver } from '@hookform/resolvers/yup';
import { useMutation } from '@tanstack/react-query';
import { getTaxesAndFees, sendOtpForSignUP, validateAccount, verifyOtp } from '@/services/api';
import { getDeviceId, getEnv, handleAlert } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import OtpVerification from './otp-verification';
import { Input } from '@/components/ui/input';
import PhoneInput from 'react-phone-input-2';
import { Label } from '@/components/ui/label';
import ErrorTooltip from '@/components/custom/error-tooltip';
import CustomSelect from '@/components/custom/custom-select';
import { Button } from '@/components/ui/button';
import PlanSummary from './plan-summary';
import Loader from '@/components/custom/loader';
import { Country, State, City } from 'country-state-city';
import { CountryFlag } from '@/components/flag';
import { postcodeValidator, postcodeValidatorExistsForCountry } from 'postcode-validator';
import LogoIcon from '@/assets/images/LogoIcon.svg';
import { useOrganization } from '@/hooks/use-organisation';
import countryListJson from '@/lib/countries.json';
import { useGetPlans } from '@/hooks/common';
import { durationMap } from '@/lib/plan-constants';
import CustomizePlanModal from '../pricing/modals/customize-plan-modal';
const initialValues = {
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  company_name: '',
  company_address: '',
  company_country: null,
  company_state: null,
  company_city: null,
  company_postal_code: '',
  timezone: null,
};

export const contactValidationSchema = yup.object().shape({
  first_name: requiredString('First Name', 3),
  last_name: requiredString('Last Name', 3),
  phone: requiredAllString('Phone Number')
    .min(9, 'Invalid Number Format')
    .max(15, 'Invalid Number Format'),
  email: requiredEmail(),
  company_country: selectFieldRequired('Country'),
  company_name: requiredString('Company Name'),
  company_address: yup
    .string()
    .required('Company Address is required')
    .matches(/^\S[\s\S]*\S$|^\S$/, 'Spaces not allowed')
    .matches(/[A-Za-z]/, `Company Address must contain at least one letter`)
    .min(2, `Company Address must be at least 2 characters`)
    .max(50, `Company Address must not exceed 50 characters`),
  company_state: yup
    .object({
      label: yup.string().required(),
      value: yup.string().nullable(),
    })
    .required(`State is required`)
    .typeError(`State is required`),
  company_city: yup
    .object({
      label: yup.string().required(),
      value: yup.string().nullable(),
    })
    .required(`City is required`)
    .typeError(`City is required`),
  company_postal_code: yup
    .string()
    .required('Postal Code is required')
    .test(
      'valid-postal-code',
      'Enter a valid postal code for the selected country',
      function (value) {
        const postalCode = String(value || '').trim();
        if (!postalCode) return false;

        const countryCode = String(this.parent?.company_country?.value || '')
          .trim()
          .toUpperCase();

        if (!countryCode) return true;

        if (!postcodeValidatorExistsForCountry(countryCode)) {
          return postalCode.length >= 3;
        }

        return postcodeValidator(postalCode, countryCode);
      },
    ),
  timezone: yup
    .object({
      label: yup.string().required(),
      value: yup.string().required(),
    })
    .required('Timezone is required')
    .typeError('Timezone is required'),
});

const SignUp = () => {
  const navigate = useNavigate();
  const [googleSignup] = useState<any>(() => {
    try {
      const g = sessionStorage.getItem('google_signup');
      if (g) { const o = JSON.parse(g); return { email: o.email, name: o.name, credential: o.credential, header: 'x-google-credential' }; }
      const so = sessionStorage.getItem('sso_signup');
      if (so) { const o = JSON.parse(so); return { email: o.email, name: o.name, credential: o.token, header: 'x-sso-credential' }; }
      return null;
    } catch (e) { return null; }
  });
  const location = useLocation();
  const { state } = location;
  const [searchParams] = useSearchParams();
  const planId = searchParams.get('planId')?.trim() || '';
  const isCustomPlan = planId.toLowerCase() === 'custom';
  const requestedIsTrialPlan = searchParams.get('isTrial')?.toLowerCase() === 'true';
  const {
    data: availablePlans,
    isLoading: isPlanLoading,
    isError: isPlanError,
  } = useGetPlans(!isCustomPlan);
  const statePlanId = state?.rowData?.uuid ? String(state.rowData.uuid) : '';
  const matchingPlan = availablePlans?.find((plan: any) => String(plan?.uuid) === planId);
  const needsPlanHydration =
    Boolean(planId) &&
    !isCustomPlan &&
    (statePlanId !== planId || state?.isTrailPlan !== requestedIsTrialPlan);
  const { mainSiteInfo } = useOrganization();
  const { planDuration, costDetails, rowData, isTrailPlan } = state || {};
  const { uuid } = rowData || {};
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  useEffect(() => {
    if (!needsPlanHydration || !matchingPlan) return;

    // URL-based signup uses the monthly plan cost and explicitly carries the trial choice.
    const resolvedPlanDuration = 1;
    const resolvedCostDetails =
      matchingPlan?.cost?.find((item: any) => item?.type === durationMap[resolvedPlanDuration]) ||
      {};

    navigate(
      { pathname: location.pathname, search: location.search },
      {
        replace: true,
        state: {
          planDuration: resolvedPlanDuration,
          rowData: matchingPlan,
          isTrailPlan: requestedIsTrialPlan,
          costDetails: resolvedCostDetails,
        },
      },
    );
  }, [
    location.pathname,
    location.search,
    matchingPlan,
    navigate,
    needsPlanHydration,
    requestedIsTrialPlan,
  ]);

  const formInstance = useForm<any>({
    defaultValues: initialValues,
    resolver: yupResolver(contactValidationSchema),
    mode: 'all',
  });

  const {
    handleSubmit,
    setValue,
    register,
    watch,
    control,
    formState: { errors },
  } = formInstance;
  console.log('errors', errors);
  const [timezonesList, setTimezonesList] = useState<any[]>([]);
  const [watchEmail, watchedCountry, watchedState, watchedCity, watchFirstName, watchLastName] =
    watch(['email', 'company_country', 'company_state', 'company_city', 'first_name', 'last_name']);
  // const { data: dataCountryList } = useQuery({
  //   queryKey: ['countryList'],
  //   queryFn: countryList,
  //   select: (data: any) => data?.data?.data?.result?.rows || [],
  // });
  /* Safe to carry a React element here: the signup payload reads
     `company_country.value` as a string rather than spreading the option, so
     nothing of the icon reaches the API. */
  const countryOptions = Country.getAllCountries()?.map((c) => ({
    label: c.name,
    value: c.isoCode,
    icon: <CountryFlag code={c.isoCode} />,
  }));

  const stateOptions = watchedCountry?.value
    ? State.getStatesOfCountry(watchedCountry?.value)?.map((s) => ({
        label: s.name,
        value: s.isoCode,
      }))
    : [];

  const cityOptions =
    watchedCountry?.value && watchedState?.value
      ? City.getCitiesOfState(watchedCountry?.value, watchedState?.value)?.map((c) => ({
          label: c.name,
          value: c.name,
        }))
      : [];

  const { mutateAsync, isPending } = useMutation({
    mutationKey: ['getTaxesAndFees'],
    mutationFn: getTaxesAndFees,
  });
  const [websiteUuid, setWebsideUuId] = useState('');
  useEffect(() => {
    if (localStorage.getItem('org_uuid')) {
      setWebsideUuId(localStorage.getItem('org_uuid') || '');
    }
  }, []);
  const { mutate: mutateSendOtp } = useMutation({
    mutationFn: sendOtpForSignUP,
    onSuccess: () => {
      handleAlert({ text: 'OTP sent successfully', type: 'success' });
      setShowOtp(true);
    },
  });
  console.log(websiteUuid, 'websiteUuidwebsiteUuid');

  const { mutate: mutateAccount, isPending: isPendingAccount } = useMutation({
    mutationFn: validateAccount,
    onSuccess: () => {
      if (googleSignup) {
        try { sessionStorage.removeItem('google_signup'); sessionStorage.removeItem('sso_signup'); } catch (e) {}
        navigate(`/payment`, {
          state: {
            planDuration,
            formData: watch(),
            rowData: rowData,
            isTrailPlan,
            costDetails,
            googleCredential: googleSignup.credential,
            credHeader: googleSignup.header,
          },
        });
        return;
      }
      mutateSendOtp({
        email: watchEmail,
        device_id: getDeviceId(),
        website_uuid: websiteUuid,
        name: `${watchFirstName || ''} ${watchLastName || ''}`,
      });
    },
  });

  const { mutate: mutateVerifyOtp, isPending: isPendingVerifyOtp } = useMutation({
    mutationFn: verifyOtp,
    onSuccess: () => {
      setOtp('');
      handleAlert({ text: 'OTP Verified successfully', type: 'success' });
      navigate(`/payment`, {
        state: {
          planDuration,
          formData: watch(),
          rowData: rowData,
          isTrailPlan,
          costDetails,
        },
      });
    },
    onError: (err: any) => {
      const res = err?.response?.data;
      const data = res?.data || {};
      const isMaxAttemptsReached =
        res?.retry_after_seconds != null ||
        (typeof res?.message === 'string' &&
          res.message.toLowerCase().includes('maximum number of otp verification attempts'));
      if (isMaxAttemptsReached) {
        setShowOtp(false);
        setOtp('');
        setRemainingAttempts(null);
      } else {
        const attempts =
          data?.remainingAttempts ?? data?.remaining_attempts ?? data?.attempts ?? null;
        if (typeof attempts === 'number') setRemainingAttempts(attempts);
        setOtp('');
      }
      handleAlert({ text: res?.message || 'Invalid OTP', type: 'error' });
    },
  });

  useEffect(() => {
    if (googleSignup) {
      if (googleSignup.email) setValue('email', googleSignup.email);
      const parts = String(googleSignup.name || '').trim().split(/\s+/).filter(Boolean);
      if (parts[0]) setValue('first_name', parts[0]);
      if (parts.length > 1) setValue('last_name', parts.slice(1).join(' '));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleSignup]);

  const handleSubmitForm = async (data: any) => {
    const response = await mutateAsync({
      plan_uuid: rowData?.uuid,
      licenses: 1,
      plan_duration: planDuration,
      line1: data?.company_address || '',
      country: data?.company_country?.value || '',
      state: data?.company_state?.value || '',
      ...(data?.company_city?.value ? { city: data?.company_city?.value || '' } : {}),
      postal_code: data?.company_postal_code || '',
      type: 'SIGNUP',
    });
    if (response?.status === 422) {
      handleAlert({
        text: 'Invalid address details. Please check your state, city, and ZIP code.',
        type: 'error',
      });
    }
    if (response?.status === 200) {
      const payload = {
        email: data?.email,
        company_name: data?.company_name,
        plan_uuid: uuid,
        phone: `+${data?.phone}`,
        timezone: data?.timezone?.value || '',
      };
      mutateAccount(payload);
    }
  };

  useEffect(() => {
    setValue('company_state', null);
    setValue('company_city', null);

    if (!watchedCountry?.value) {
      setTimezonesList([]);
      setValue('timezone', null);
      return;
    }
    const countryCode = watchedCountry?.value;
    const timezones =
      countryListJson?.find((item: any) => item?.isoCode === countryCode)?.timezones || [];
    setTimezonesList(timezones);

    if (timezones.length > 0) {
      setValue(
        'timezone',
        { label: timezones[0].zoneName, value: timezones[0].zoneName },
        { shouldValidate: true },
      );
    } else {
      setValue('timezone', null);
    }
  }, [watchedCountry]);

  useEffect(() => {
    if (stateOptions?.length > 0) {
      setValue('company_city', null);
    }
  }, [watchedState?.value, stateOptions?.length]);

  useEffect(() => {
    if (!watchedCountry?.value) return;

    const noStates = stateOptions?.length === 0;
    const noCities = cityOptions?.length === 0;

    if (noStates) {
      setValue(
        'company_state',
        { label: 'N/A', value: '' },
        { shouldDirty: false, shouldValidate: false },
      );
    }
    if (noCities) {
      setValue(
        'company_city',
        { label: 'N/A', value: '' },
        { shouldDirty: false, shouldValidate: false },
      );
    }
  }, [watchedCountry?.value, stateOptions?.length, cityOptions?.length]);

  const handleVerify = () => {
    const payload = {
      email: watchEmail,
      otp,
      device_id: getDeviceId(),
    };
    if (!isPendingVerifyOtp && otp?.length === 6) mutateVerifyOtp(payload);
  };

  if (isCustomPlan) {
    return (
      <div className="flex min-h-screen w-full flex-col gap-4 overflow-auto bg-gray-200/15">
        <div className="flex w-full items-center justify-between bg-white px-3 py-4 shadow-sm sm:px-12">
          <div className="h-8 cursor-pointer sm:px-8" onClick={() => navigate('/')}>
            <img
              src={
                mainSiteInfo?.small_logo
                  ? `${getEnv().VITE_API_BASE_URL}/${mainSiteInfo?.small_logo}`
                  : LogoIcon
              }
              alt="Logo"
              className="h-full"
            />
          </div>
          <p className="text-gray-900">
            Need help? <span className="cursor-pointer text-primary">(111) 111-1111</span>
          </p>
        </div>
        <main className="flex w-full flex-1 items-start justify-center px-4 py-8">
          <CustomizePlanModal variant="page" handleClose={() => navigate('/')} />
        </main>
      </div>
    );
  }

  if (needsPlanHydration && (isPlanLoading || matchingPlan)) {
    return (
      <div className="w-screen min-h-screen bg-white">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white">
          <div className="flex items-center justify-center p-5">
            <Loader variant="blue" size="lg" />
          </div>
        </div>
      </div>
    );
  }

  if ((needsPlanHydration && !matchingPlan) || (!planId && !rowData?.uuid)) {
    return (
      <div className="w-screen min-h-screen bg-white flex items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold text-gray-900">
            {isPlanError ? 'Unable to load the selected plan' : 'Plan not found'}
          </h1>
          <p className="text-sm text-gray-500">
            Please check the signup link or select a plan again.
          </p>
          <Button type="button" onClick={() => navigate('/')}>
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-4 h-full overflow-auto bg-gray-200/15">
      <div className="w-full  flex items-center justify-between bg-white sm:px-12 px-3 py-4 shadow-sm">
        <div className="h-8 cursor-pointer sm:px-8" onClick={() => navigate('/')}>
          <img
            src={
              mainSiteInfo?.small_logo
                ? `${getEnv().VITE_API_BASE_URL}/${mainSiteInfo?.small_logo}`
                : LogoIcon
            }
            alt="Logo"
            className="h-full"
          />
        </div>
        <p className="text-gray-900">
          Need help? <span className="text-primary cursor-pointer">(111) 111-1111</span>
        </p>
      </div>
      <div className="w-full flex md:flex-row flex-col gap-4 px-4 md:px-12 lg:max-w-[80%] mx-auto mb-4">
        <section className="md:w-[calc(100%-24rem)] bg-white rounded-xl">
          <div className="mx-auto h-full flex flex-col gap-16">
            <form
              onSubmit={handleSubmit(handleSubmitForm)}
              className="flex flex-col justify-center items-center p-8 bg-white rounded-xl"
            >
              <div className="flex flex-col w-full gap-8">
                <div className="flex flex-col gap-1">
                  <h1 className="text-xl  font-bold">Contact Information</h1>
                  <h6 className="text-base text-gray-500 font-normal">
                    Please enter all your contact information in the fields provided below to
                    complete your cloud phone system setup.
                  </h6>
                </div>
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-5">
                    <div className="flex gap-4 flex-col sm:flex-row">
                      <Input
                        placeholder="Enter First Name"
                        label="First Name"
                        {...register('first_name')}
                        error={errors?.first_name?.message}
                      />
                      <Input
                        placeholder="Enter Last Name"
                        label="Last Name"
                        {...register('last_name')}
                        error={errors?.last_name?.message}
                      />
                    </div>
                    <div className="flex gap-4 flex-col sm:flex-row items-center">
                      <div className="flex flex-col gap-1.5 w-full">
                        <div className="flex items-center justify-between">
                          <Label>Mobile Number</Label>
                          <div className="flex items-start ">
                            {' '}
                            {errors?.phone?.message && (
                              <ErrorTooltip text={errors?.phone?.message} />
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <PhoneInput
                            country={'us'}
                            value={watch(`phone`)}
                            onChange={(value) => {
                              setValue(`phone`, value, {
                                shouldValidate: true,
                              });
                            }}
                            containerClass={errors?.phone?.message ? 'phone-error' : ''}
                          />
                        </div>
                      </div>

                      <Input
                        placeholder="Enter Email"
                        label="Email Address"
                        {...register('email')}
                        readOnly={!!googleSignup}
                        error={errors?.email?.message}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-5 w-full">
                  <div className="flex items-center gap-3 w-full">
                    <h1 className="text-lg  font-semibold text-primary w-full max-w-fit">
                      Company Information
                    </h1>
                    <div className='w-full bg-linear-to-r from-primary to-ucass-primary-200" h-0.5 hidden sm:block'></div>
                  </div>
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-5">
                      <Input
                        placeholder="Enter Company Name"
                        label="Company Name"
                        {...register('company_name')}
                        error={errors?.company_name?.message}
                      />
                      {/* <Input
                        placeholder="Enter Company Address"
                        label="Company Address"
                        {...register('company_address')}
                        error={errors?.company_address?.message}
                      /> */}
                      <div className="flex flex-col gap-1.5 w-full">
                        <div className="flex items-center justify-between gap-1">
                          <Label>Company Address</Label>
                          {errors?.company_address?.message && (
                            <ErrorTooltip text={errors?.company_address?.message} />
                          )}
                        </div>
                        <textarea
                          placeholder="Enter Company Address"
                          {...register('company_address')}
                          rows={3}
                          className={`border w-full ${errors?.company_address?.message ? 'border-red-500' : 'border-gray-300'}  rounded-xl text-sm resize-none p-3 hover:border-primary focus:border-primary focus-visible:border-primary focus-visible:outline-none`}
                        />
                      </div>
                      <div className="flex gap-4 flex-col sm:flex-row">
                        <Controller
                          control={control}
                          name={'company_country'}
                          render={({ field }) => (
                            <CustomSelect
                              {...field}
                              label="Country"
                              placeholder="Select Country"
                              options={countryOptions || []}
                              handleChange={(value) => field.onChange(value)}
                              error={errors?.company_country?.message}
                            />
                          )}
                        />
                        {watchedState?.label !== 'N/A' && (
                          <Controller
                            control={control}
                            name={'company_state'}
                            render={({ field }) => (
                              <CustomSelect
                                {...field}
                                label="State"
                                placeholder="Select State"
                                options={stateOptions || []}
                                handleChange={(value) => field.onChange(value)}
                                error={errors?.company_state?.message}
                              />
                            )}
                          />
                        )}
                      </div>
                      <div className="flex gap-4 flex-col sm:flex-row">
                        {watchedCity?.label !== 'N/A' && (
                          <Controller
                            control={control}
                            name={'company_city'}
                            render={({ field }) => (
                              <CustomSelect
                                {...field}
                                label="City"
                                placeholder="Select City"
                                options={cityOptions || []}
                                handleChange={(value) => field.onChange(value)}
                                error={errors?.company_city?.message}
                                menuPlacement="top"
                              />
                            )}
                          />
                        )}
                        <Input
                          placeholder="Enter Postal Code"
                          label="Postal Code"
                          {...register('company_postal_code')}
                          error={errors?.company_postal_code?.message}
                          maxLength={10}
                        />
                      </div>
                      {/* w-[50%] */}
                      <div className="flex gap-4 flex-col sm:flex-row ">
                        <Controller
                          control={control}
                          name={'timezone'}
                          render={({ field }) => (
                            <CustomSelect
                              {...field}
                              label="Timezone"
                              placeholder="Select Timezone"
                              options={timezonesList?.map((item: any) => ({
                                label: item?.zoneName,
                                value: item?.zoneName,
                              }))}
                              handleChange={(value) => field.onChange(value)}
                              error={errors?.timezone?.message}
                              menuPlacement="top"
                            />
                          )}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between gap-2 w-full">
                      <Button
                        variant={'secondary'}
                        type="button"
                        onClick={() => navigate('/pricing')}
                      >
                        Back
                      </Button>
                      <Button
                        variant={'primary'}
                        className="w-full max-w-[calc(100%-80px)]"
                        type="submit"
                        disabled={isPendingAccount || isPending}
                      >
                        {isPendingAccount || isPending ? <Loader variant="blue" /> : 'Continue'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <Dialog open={showOtp} onOpenChange={setShowOtp}>
            <DialogContent
              className="w-full lg:w-2/5  p-3"
              showCloseButton={false}
              onEscapeKeyDown={(e) => e.preventDefault()}
              onPointerDownOutside={(e) => e.preventDefault()}
            >
              <OtpVerification
                {...{
                  isSignUp: true,
                  formData: watch(),
                  onConfirm: () => {
                    handleVerify();
                  },
                  otp,
                  setOtp,
                  apiLoading: isPendingVerifyOtp,
                  remainingAttempts,
                  handleClose: () => {
                    setShowOtp(false);
                    setRemainingAttempts(null);
                  },
                }}
              />
            </DialogContent>
          </Dialog>
        </section>
        <section className="md:w-[24rem] h-full ">
          <div className=" h-full flex flex-col gap-3 r w-full">
            <PlanSummary {...{ licenseCount: 1, rowData, planDuration, costDetails }} />
          </div>
        </section>
      </div>
    </div>
  );
};

export default SignUp;
