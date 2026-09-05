import { Icon } from '@/assets/icons/icon';
import LogoIcon from '@/assets/images/LogoIcon.svg';
import PaymentScreen from '@/components/payment';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { initialPlanPayment, signup, signupOnTrial, getPlanInfo } from '@/services/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PaymentSuccessPopup from './payment-success-popup';
import PaymentFailedPopup from './payment-failed-popup';
import PlanSummary from './plan-summary';
import { getEnv, getObjectLength, handleAlert } from '@/lib/utils';
import { useGetPlans } from '@/hooks/common';
import { durationMap } from '../admin-settings/billing/constants';
import Loader from '@/components/custom/loader';
import { useOrganization } from '@/hooks/use-organisation';
import { getPlanDidCountries } from '@/lib/did-countries';
export interface ITaxCalculationResult {
  sub_total: number;
  tax_amount: number;
  tax_percentage: string;
  total_amount: number;
  currency: string;
  tax_calculation_id: string;
  tax_location: any;
  discount_applied: boolean;
  discount_amount: number;
}

const SignUpPayment = () => {
  const { state } = useLocation();
  const googleCredential = (state as any)?.googleCredential;
  const credHeader = (state as any)?.credHeader || 'x-google-credential';
  const {
    planDuration,
    isTrailPlan,
    // costDetails,
    formData,
    rowData: planData,
    isLogin,
    signUpResponseData: signUpResponseDataState,
    accessToken,
  } = state || {};
  const navigate = useNavigate();
  const { mainSiteInfo } = useOrganization();
  useEffect(() => {
    if (!Object.keys(state || {}).length) {
      navigate('/');
      return;
    }
  }, [state]);

  const [isPaymentSuccess, setIsPaymentSuccess] = useState(false);
  const [isPaymentFailed, setIsPaymentFailed] = useState(false);
  const [taxCalculationData, setTaxCalculationData] = useState<ITaxCalculationResult>();
  const paymentRef = useRef<any>(null);
  const signUpResponseData = useRef<any>(null);

  const minLicenses = useMemo(() => {
    if (isLogin && signUpResponseDataState?.current?.payment_verified === false) {
      return signUpResponseDataState?.current?.licenses || 1;
    }
    return 1;
  }, [isLogin, signUpResponseDataState]);

  const [licenseCount, setLicenseCount] = useState(minLicenses);

  useEffect(() => {
    if (minLicenses > 1) {
      setLicenseCount(minLicenses);
    }
  }, [minLicenses]);

  const { data: planList, isLoading } = useGetPlans();
  const activePlan = planList?.find(
    (v: any) =>
      v?.uuid === signUpResponseDataState?.current?.plan_uuid || v?.uuid === planData?.uuid,
  );

  const planUuid = signUpResponseDataState?.current?.plan_uuid || planData?.uuid;

  const { data: planInfo, isLoading: isPlanInfoLoading } = useQuery({
    queryKey: ['getPlanInfoQuery', planUuid],
    queryFn: () => getPlanInfo(planUuid),
    select: (res: any) => res?.data?.data?.result,
    enabled: !!planUuid,
  });

  const rowData = planInfo || (getObjectLength(activePlan) ? activePlan : planData);
  const didCountries = useMemo(() => {
    const planSources = [planInfo, activePlan, planData, signUpResponseDataState];

    for (const planSource of planSources) {
      const countries = getPlanDidCountries(planSource);
      if (countries.length) return countries;
    }

    return [];
  }, [activePlan, planData, planInfo, signUpResponseDataState]);
  const costDetails: any = rowData?.cost?.filter(
    (item: any) =>
      item.type === durationMap[signUpResponseDataState?.current?.plan_duration || planDuration],
  )?.[0];

  // const { discount_enabled, discount_price, original_price } = costDetails || {};

  // Determine max licenses: if licenses is 0, unlimited; otherwise use the plan's license limit
  const maxLicenses = rowData?.licenses === 0 ? null : rowData?.licenses || 50;
  console.log(rowData, 'rowDatarowData', maxLicenses);

  const handleSuccess = (message = 'Payment completed successfully') => {
    paymentRef.current?.resetPaymentState();
    setIsPaymentFailed(false);
    handleAlert({ text: message, type: 'success' });
    setIsPaymentSuccess(true);
  };
  const handle3DSFailure = () => {
    setIsPaymentFailed(true);
  };

  const { mutate: mutateSignUp, isPending: signUpPending } = useMutation({
    mutationFn: (payload: any) => signup(payload, googleCredential ? { headers: { [credHeader]: googleCredential } } : {}),
    onSuccess: ({ data }) => {
      if (data?.data?.result?.stripe_message) {
        handleAlert({ text: data?.data?.result?.stripe_message, type: 'error' });
        return;
      }
      signUpResponseData.current = data?.data?.result?.auth;
      if (data?.data?.result?.requires_action) {
        paymentRef.current.handle3DSPayment(
          data?.data?.result?.payment_intent || data?.data?.data?.result?.payment_intent_id,
        );
        return;
      }
      handleSuccess(data?.data?.message || data?.message);
    },
    onError: () => {
      // setIsPaymentFailed(true);
    },
  });

  const { mutate: mutateSignupOnTrial, isPending: PendingSignupTrial } = useMutation({
    mutationFn: (payload: any) => signupOnTrial(payload, googleCredential ? { headers: { [credHeader]: googleCredential } } : {}),
    onSuccess: ({ data }) => {
      if (data?.data?.result?.stripe_message) {
        handleAlert({ text: data?.data?.result?.stripe_message, type: 'error' });
        return;
      }
      signUpResponseData.current = data?.data?.result?.auth;
      if (data?.data?.result?.requires_action) {
        paymentRef.current.handle3DSPayment(
          data?.data?.result?.payment_intent || data?.data?.data?.result?.payment_intent_id,
        );
        return;
      }
      handleSuccess(data?.data?.message || data?.message);
    },
    onError: () => {
      // setIsPaymentFailed(true);
    },
  });

  const { mutate: mutateInitialPlanPayment, isPending: PendingInitialPlanPayment } = useMutation({
    mutationFn: initialPlanPayment,
    onSuccess: ({ data }) => {
      if (data?.data?.result?.stripe_message) {
        handleAlert({ text: data?.data?.result?.stripe_message, type: 'error' });
        return;
      }

      if (data?.data?.result?.requires_action) {
        paymentRef.current.handle3DSPayment(
          data?.data?.result?.payment_intent || data?.data?.data?.result?.payment_intent_id,
        );
        return;
      }

      handleSuccess(data?.data?.message || data?.message);
    },
    onError: () => {
      // setIsPaymentFailed(true);
    },
  });

  const handleCountChange = (action: 'add' | 'sub') => {
    // If maxLicenses is null, it means unlimited (licenses === 0)
    if (maxLicenses !== null && action === 'add' && licenseCount >= maxLicenses) {
      handleAlert({ text: `Maximum ${maxLicenses} licenses allowed`, type: 'warning' });
      return;
    }
    // if (action === 'sub' && licenseCount <= minLicenses) {
    //   handleAlert({ text: `Minimum ${minLicenses} licenses required`, type: 'warning' });
    //   return;
    // }

    setLicenseCount((p: any) => {
      return action === 'add' ? p + 1 : p - 1;
    });
  };

  const onSuccessPayment = (data: any) => {
    data?.setLoader(false);

    if (!state?.isLogin) {
      const { company_country, company_state, company_city, timezone, ...rest } = formData || {};
      const payload = {
        ...rest,
        company_country: company_country?.value || '',
        company_state: company_state?.value || '',
        company_city: company_city?.value || '',
        timezone: timezone?.value || '',
        plan_uuid: rowData?.uuid,
        licenses: licenseCount,
        plan_duration: planDuration,
        tax_calculation_id: taxCalculationData?.tax_calculation_id || '',
        is_trial: isTrailPlan ? 'Y' : 'N',
        payment: {
          amount: isTrailPlan ? '0.00' : taxCalculationData?.total_amount || 0,
          payment_method_id: data.id,
        },
      };
      console.log(signupOnTrial, 'signupOnTrial');

      if (isTrailPlan) {
        mutateSignupOnTrial(payload);
      } else {
        mutateSignUp(payload);
      }
    } else {
      const { first_name, last_name, email, uuid, company_uuid } =
        signUpResponseDataState?.current || {};
      const payload = {
        first_name,
        last_name,
        email,
        uuid,
        company_uuid,
        tax_calculation_id: taxCalculationData?.tax_calculation_id || '',
        licenses: licenseCount,
        is_trial: isTrailPlan ? 'Y' : 'N',
        payment: {
          amount: taxCalculationData?.total_amount || 0,
          payment_method_id: data.id,
        },
      };
      mutateInitialPlanPayment(payload);
    }
  };

  const onSuccess = (data: ITaxCalculationResult) => {
    setTaxCalculationData(data);
  };

  if (isLoading || (!!planUuid && isPlanInfoLoading)) {
    return (
      <div className="w-screen min-h-screen bg-white ">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2  bg-white ">
          <div className="flex items-center justify-center p-5">
            <Loader variant="blue" size="lg" />
          </div>
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
          <div className="w-full h-full flex flex-col gap-16 items-center justify-center">
            <div className="w-full flex flex-col justify-center items-center p-8 bg-white rounded-xl">
              <div className="flex flex-col w-full gap-8">
                <Button
                  type="button"
                  variant="secondary"
                  className="self-start"
                  onClick={() => navigate(-1)}
                >
                  Back
                </Button>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <h1 className="text-2xl  font-bold">How many phone lines you require?</h1>
                    <h6 className="text-base text-gray-500 font-normal">
                      Each line comes with its own phone number and uses a single{' '}
                      {mainSiteInfo?.domain === 'mycountrymobile.com'
                        ? 'MyCountryMobile '
                        : 'Acepeak '}
                      license
                    </h6>
                  </div>
                  <div className="flex flex-col gap-3 items-center border border-gray-200 bg-gray-50  p-4 rounded-lg">
                    <p className="text-gray-500 text-sm font-medium">Number of Phone Lines</p>
                    <div className="flex items-center gap-6 ">
                      <div
                        onClick={() => {
                          if (isTrailPlan || licenseCount <= minLicenses) return;
                          handleCountChange('sub');
                        }}
                        className={`text-white font-semibold h-8 w-8 rounded-lg flex items-center justify-center ${isTrailPlan || licenseCount <= minLicenses ? 'cursor-not-allowed bg-gray-400 hover:bg-gray-400' : 'cursor-pointer bg-primary hover:bg-primary/90'}`} // disabled={isTrailPlan || licenseCount <= minLicenses}
                      >
                        <Icon name="Minus" />
                      </div>
                      <p className="text-primary font-semibold text-lg">{licenseCount}</p>
                      <div
                        onClick={() => {
                          if (isTrailPlan || (maxLicenses !== null && licenseCount >= maxLicenses))
                            return;
                          handleCountChange('add');
                        }}
                        className={`${
                          isTrailPlan || (maxLicenses !== null && licenseCount >= maxLicenses)
                            ? 'cursor-not-allowed bg-gray-400 hover:bg-gray-400'
                            : 'cursor-pointer bg-primary hover:bg-primary/90'
                        } text-white font-semibold h-8 w-8 rounded-lg flex items-center justify-center`}
                      >
                        <Icon name="Plus" className="h-10" />
                      </div>
                    </div>
                    <p className="text-gray-500 text-sm ">
                      {isTrailPlan
                        ? 'Minimum 1 line, Maximum 1 lines'
                        : `Minimum ${minLicenses} line${minLicenses > 1 ? 's' : ''}${maxLicenses !== null ? `, Maximum ${maxLicenses} lines` : ', Unlimited'}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-3 border-t border-gray-200 pt-4">
                  <div className="flex flex-col gap-1">
                    <h1 className="text-xl font-semibold">Checkout</h1>
                    <h6 className="text-base text-gray-500 font-normal">
                      Select and add your payment information
                    </h6>
                  </div>
                  <div className="flex border border-gray-200 bg-white rounded-xl p-3">
                    <PaymentScreen
                      ref={paymentRef}
                      onSuccessPayment={onSuccessPayment}
                      isSavedPaymentCard={true}
                      onSuccess3dsPayment={() => handleSuccess()}
                      onFailure3dsPayment={handle3DSFailure}
                      isApiLoad={PendingSignupTrial || signUpPending || PendingInitialPlanPayment}
                      submitButtonText={
                        isTrailPlan ? 'Add Card' : `Pay $${taxCalculationData?.total_amount || 0}`
                      }
                      enableSaveCard={false}
                      showIsSaveCard={false}
                    />
                  </div>
                </div>
                <Dialog open={isPaymentSuccess} onOpenChange={setIsPaymentSuccess}>
                  <DialogContent
                    className="w-2/5 p-3"
                    showCloseButton={false}
                    onEscapeKeyDown={(e) => e.preventDefault()}
                    onPointerDownOutside={(e) => e.preventDefault()}
                  >
                    <PaymentSuccessPopup
                      signUpResponseData={isLogin ? signUpResponseDataState : signUpResponseData}
                      isLogin={state?.isLogin}
                      didCountries={didCountries}
                      accessToken={accessToken}
                      planUuid={planUuid}
                    />
                  </DialogContent>
                </Dialog>

                <Dialog open={isPaymentFailed} onOpenChange={setIsPaymentFailed}>
                  <DialogContent
                    className="w-2/5 p-3"
                    showCloseButton={false}
                    onEscapeKeyDown={(e) => e.preventDefault()}
                    onPointerDownOutside={(e) => e.preventDefault()}
                  >
                    <PaymentFailedPopup
                      handleClose={() => {
                        setIsPaymentFailed(false);
                      }}
                      isLogin={state?.isLogin}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>
        </section>

        <section className="md:w-[24rem] h-full ">
          <div className="h-full flex flex-col gap-3 r w-full">
            <PlanSummary
              {...{
                rowData,
                didCountries,
                initialData: {
                  ...signUpResponseDataState,
                  isLogin,
                },
                licenseCount,
                formData,
                page: 2,
                onSuccess,
                planDuration: signUpResponseDataState?.current?.plan_duration || planDuration,
                costDetails,
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
};

export default SignUpPayment;
