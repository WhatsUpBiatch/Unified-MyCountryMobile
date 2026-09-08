import { Button } from '@/components/ui/button';
import { useEffect, useRef, useState } from 'react';
import moment from 'moment';
import { RequestedPlanStatusMap } from '@/lib/plan-constants';
import {
  handleAlert,
  PLAN_PENDING_COMPANY_UUID_KEY,
  PLAN_PENDING_FLAG_KEY,
  RENEW_PLAN_FROM_APP_KEY,
  SESSION_NAME,
} from '@/lib/utils';
import { useGetMyPlanDetails } from '@/hooks/common';
import { getTaxesAndFees, getUserDetails, renewPlan, upgradeTrialPlan } from '@/services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { CloseIcon } from '@/assets/icons';
import PaymentScreen from '@/components/payment';
import { CARDS_TYPE } from '@/constants/common-const';
import Loader from '@/components/custom/loader';
import { useBlocker, useNavigate } from 'react-router-dom';

const RENEW_PLAN_PATH = '/renew-plan';

const clearRenewPlanState = () => {
  localStorage.removeItem(SESSION_NAME);
  localStorage.removeItem(PLAN_PENDING_FLAG_KEY);
  sessionStorage.removeItem(PLAN_PENDING_COMPANY_UUID_KEY);
  sessionStorage.removeItem(RENEW_PLAN_FROM_APP_KEY);
};

const RenewPlan = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hasSessionToken = Boolean(localStorage.getItem(SESSION_NAME));
  const [isPaymentInitiate, setIsPaymentInitiate] = useState(false);
  const [isRenewPaymentInitiate, setIsRenewPaymentInitiate] = useState(false);
  const [getTaxes, setGetTaxes] = useState<any>({});
  const paymentRef = useRef<any>(null);
  const hasHandledBlockRef = useRef(false);
  const isIntentionalExitRef = useRef(false);

  const { data: userInfoData } = useQuery({
    queryKey: ['getUserDetailsQueryFn'],
    queryFn: getUserDetails,
    select: (data) => data?.data?.data?.result,
    enabled: hasSessionToken,
  });

  // Block browser back or any navigation away from renew-plan; clear state and send to login.
  const shouldBlockLeave = ({
    currentLocation,
    nextLocation,
  }: {
    currentLocation: { pathname: string };
    nextLocation: { pathname: string };
  }) => {
    if (isIntentionalExitRef.current) return false;
    const isOnRenewPlan = currentLocation.pathname === RENEW_PLAN_PATH;
    const isLeavingRenewPlan = Boolean(
      nextLocation?.pathname && nextLocation.pathname !== RENEW_PLAN_PATH,
    );
    return isOnRenewPlan && isLeavingRenewPlan;
  };
  const blocker = useBlocker(shouldBlockLeave);

  // When user tries to leave (back or in-app nav): clear state and go to login. Run once per block to avoid multiple navigations/fluctuation.
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      hasHandledBlockRef.current = false;
      return;
    }
    if (hasHandledBlockRef.current) return;
    hasHandledBlockRef.current = true;
    clearRenewPlanState();
    queryClient.clear();
    navigate('/', { replace: true });
    blocker.reset();
  }, [blocker.state, blocker, navigate, queryClient]);

  // Only on manual refresh: clear all session/plan-pending state and redirect to login.
  // When user is sent here from login/guard we set RENEW_PLAN_FROM_APP_KEY so we don't treat that as refresh.
  useEffect(() => {
    const fromApp = sessionStorage.getItem(RENEW_PLAN_FROM_APP_KEY);
    if (fromApp) {
      sessionStorage.removeItem(RENEW_PLAN_FROM_APP_KEY);
      // Came from in-app navigation – don't redirect; fall through to session check below
    } else {
      const navEntries = performance.getEntriesByType('navigation');
      const isManualRefresh =
        navEntries.length > 0 && (navEntries[0] as PerformanceNavigationTiming).type === 'reload';

      if (isManualRefresh) {
        clearRenewPlanState();
        queryClient.clear();
        window.location.replace('/');
        return;
      }
    }

    if (!localStorage.getItem(SESSION_NAME)) {
      window.location.replace('/');
    }
  }, [queryClient]);

  const { data: dataGetMyPlanDetails, isLoading: isLoadingPlanDetails } = useGetMyPlanDetails(
    {},
    hasSessionToken,
  );
  const companyUuid = userInfoData?.company_info?.uuid;
  const totalPaybleLicences = dataGetMyPlanDetails?.license_detail?.payable_licenses || 0;

  const { mutateAsync: mutateTaxCalculate, isPending: isPendingTaxCalculation } = useMutation({
    mutationFn: getTaxesAndFees,
    onSuccess: (data) => {
      setGetTaxes(data?.data?.data?.result || {});
      setIsPaymentInitiate(true);
    },
  });

  const { mutate: mutateUpgradeTrialPlan, isPending: isPendingUpgradeTrialPlan } = useMutation({
    mutationFn: upgradeTrialPlan,
    onSuccess: ({ data }) => {
      if (data?.data?.result?.status === 'requires_action') {
        paymentRef.current?.handle3DSPayment(data?.data?.result?.client_secret);
        return;
      }
      paymentSuccess('Plan upgraded successfully. Please login again.');
    },
    onError: () => {
      setIsPaymentInitiate(false);
      setIsRenewPaymentInitiate(false);
    },
  });

  const { mutate: mutateRenewPlan } = useMutation({
    mutationFn: renewPlan,
    onSuccess: ({ data }) => {
      paymentSuccess(
        data?.data?.message
          ? `${data.data.message}. Please login again.`
          : 'Plan renewed successfully. Please login again.',
      );
    },
    onError: () => setIsRenewPaymentInitiate(false),
  });

  const onSuccessPayment = (data: any) => {
    setIsRenewPaymentInitiate(true);
    const isNewCardRequest = data?.paymentType === 'NEW_CARD';
    const payload = {
      currency: 'usd',
      plan_uuid: userInfoData?.company_info?.plan_uuid,
      type: isNewCardRequest ? CARDS_TYPE.NEW_CARD : CARDS_TYPE.SAVED_CARD,
      company_uuid: companyUuid,
      ...(isNewCardRequest ? { payment_method_id: data?.id } : { card_id: data?.uuid }),
    };
    if (userInfoData?.company_info?.is_trial === 'Y') {
      mutateUpgradeTrialPlan({
        ...payload,
        tax_calculation_id: getTaxes?.tax_calculation_id || '',
        licenses: getTaxes?.licenses || '',
        plan_duration: userInfoData?.company_info?.plan_duration,
      });
    } else {
      mutateRenewPlan(payload);
    }
  };

  const handleLogoutWithSuccess = (msg: string) => {
    isIntentionalExitRef.current = true;
    clearRenewPlanState();
    queryClient.clear();
    handleAlert({ text: msg, type: 'success' });
    setTimeout(() => {
      window.location.replace('/');
    }, 2000);
  };

  const paymentSuccess = (message: string) => {
    paymentRef.current?.resetPaymentState();
    setGetTaxes({});
    setIsPaymentInitiate(false);
    setIsRenewPaymentInitiate(false);
    handleLogoutWithSuccess(message);
  };

  const handleLogout = () => {
    isIntentionalExitRef.current = true;
    clearRenewPlanState();
    queryClient.clear();
    window.location.replace('/');
  };

  if (isLoadingPlanDetails) {
    return (
      <div className="w-full min-h-screen bg-gradient-to-br from-slate-50 via-white to-primary/5 flex items-center justify-center">
        <Loader variant="blue" />
      </div>
    );
  }

  if (!hasSessionToken) {
    return (
      <div className="w-full min-h-screen bg-gradient-to-br from-slate-50 via-white to-primary/5 flex items-center justify-center">
        <Loader variant="blue" />
      </div>
    );
  }

  if (!userInfoData?.company_info) {
    return (
      <div className="w-full min-h-screen bg-gradient-to-br from-slate-50 via-white to-primary/5 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <p className="text-gray-600 font-medium">
            Unable to load plan details. Please try logging in again.
          </p>
          <Button
            className="mt-6 rounded-xl"
            variant="outline"
            onClick={() => navigate('/', { replace: true })}
          >
            Go to login
          </Button>
        </div>
      </div>
    );
  }

  const planStatusStyle =
    RequestedPlanStatusMap[userInfoData?.company_info?.plan_status]?.color ||
    'bg-green-100 text-green-600';
  const planName = userInfoData?.plan_info?.dataValues?.plan_name || 'Plan';

  return (
    <div className="w-full min-h-screen bg-gradient-to-br from-slate-50 via-white to-primary/5 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Page title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Plan renewal</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Review your plan and renew to continue using the service
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/80 border border-gray-100 overflow-hidden">
          {/* Current Plan */}
          <div className="p-6 sm:p-8 border-b border-gray-100">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Current plan
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${planStatusStyle}`}
                  >
                    {RequestedPlanStatusMap[userInfoData?.company_info?.plan_status]?.label || 'NA'}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mt-2">
                  {planName}
                  {userInfoData?.company_info?.is_trial === 'Y' && (
                    <span className="text-primary font-semibold ml-1.5">(Trial)</span>
                  )}
                </h2>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <Button
                  size="lg"
                  variant="destructiveOutline"
                  onClick={handleLogout}
                  className="shrink-0 rounded-xl border-red-200 bg-red-50 text-red-600 hover:bg-red-500 hover:text-white"
                >
                  Logout
                </Button>
                <Button
                  size="lg"
                  disabled={isPendingTaxCalculation || !companyUuid}
                  onClick={() => {
                    mutateTaxCalculate({
                      company_uuid: companyUuid,
                      licenses: totalPaybleLicences,
                      type:
                        dataGetMyPlanDetails?.current_plan_details?.is_trial === 'Y'
                          ? 'TRIAL_PLAN_UPGRADE'
                          : 'RENEWAL',
                    });
                  }}
                  className="shrink-0 bg-ucass-active hover:bg-ucass-active/90 text-white font-semibold px-6 rounded-xl shadow-md hover:shadow-lg transition-all"
                >
                  {isPendingTaxCalculation ? (
                    <Loader variant="blue" />
                  ) : userInfoData?.company_info?.is_trial === 'Y' ? (
                    'Upgrade'
                  ) : (
                    'Renew'
                  )}
                </Button>
              </div>
            </div>

            <div className="mt-5 rounded-xl bg-gray-50/80 border border-gray-100 p-4">
              <p className="text-sm font-medium text-gray-600">
                Last billing for{' '}
                {userInfoData?.company_info?.is_trial === 'Y'
                  ? 1
                  : dataGetMyPlanDetails?.last_billing?.total_license}{' '}
                {userInfoData?.company_info?.is_trial === 'Y' ? 'license' : 'licenses'}
              </p>

              <p className="text-gray-900 font-semibold mt-2">
                {dataGetMyPlanDetails?.last_billing?.created_at
                  ? moment(dataGetMyPlanDetails.last_billing.created_at).format('DD MMM, YYYY')
                  : 'NA'}{' '}
                · $
                {userInfoData?.company_info?.is_trial === 'Y' &&
                !dataGetMyPlanDetails?.last_billing?.purchase_detail?.discount_enabled
                  ? dataGetMyPlanDetails?.last_billing?.purchase_detail?.original_price || 0
                  : dataGetMyPlanDetails?.last_billing?.tax_detail?.plan_cost || 0}{' '}
                ×{' '}
                {userInfoData?.company_info?.is_trial === 'Y' &&
                !dataGetMyPlanDetails?.last_billing?.purchase_detail?.discount_enabled
                  ? 1
                  : dataGetMyPlanDetails?.last_billing?.total_license}{' '}
                = $
                {userInfoData?.company_info?.is_trial === 'Y' &&
                !dataGetMyPlanDetails?.last_billing?.purchase_detail?.discount_enabled
                  ? dataGetMyPlanDetails?.last_billing?.purchase_detail?.original_price || 0
                  : dataGetMyPlanDetails?.last_billing?.tax_detail?.sub_total}{' '}
                <span className="text-gray-500 font-normal text-sm">(excl. tax)</span>
              </p>

              {/* <p className="text-gray-900 font-semibold mt-2">
                {dataGetMyPlanDetails?.last_billing?.created_at
                  ? moment(dataGetMyPlanDetails.last_billing.created_at).format('DD MMM, YYYY')
                  : 'NA'}{' '}
                · $
                {userInfoData?.company_info?.is_trial === 'Y'
                  ? 0
                  : dataGetMyPlanDetails?.last_billing?.tax_detail?.plan_cost || 0}{' '}
                ×{' '}
                {userInfoData?.company_info?.is_trial === 'Y'
                  ? 1
                  : dataGetMyPlanDetails?.last_billing?.total_license}{' '}
                = $
                {userInfoData?.company_info?.is_trial === 'Y'
                  ? 0
                  : dataGetMyPlanDetails?.last_billing?.tax_detail?.sub_total}{' '}
                <span className="text-gray-500 font-normal text-sm">(excl. tax)</span>
              </p> */}
            </div>
          </div>
        </div>
      </div>

      {isPaymentInitiate && (
        <Dialog open={isPaymentInitiate} onOpenChange={setIsPaymentInitiate}>
          <DialogContent
            className="w-full md:w-2/5 p-3 max-h-[99%] overflow-y-auto bg-white"
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            showCloseButton={false}
          >
            <div className="flex flex-col gap-1.5 text-900/80">
              <div className="font-semibold truncate text-md flex items-center justify-between">
                {userInfoData?.company_info?.is_trial === 'Y' ? 'Upgrade' : 'Renew'} Plan
                <div
                  onClick={() => setIsPaymentInitiate(false)}
                  className="cursor-pointer text-gray-500 ring-offset-background opacity-70 hover:opacity-100"
                >
                  <CloseIcon className="w-3 h-3" />
                </div>
              </div>
            </div>
            <div className="px-3">
              <PaymentScreen
                ref={paymentRef}
                onSuccessPayment={onSuccessPayment}
                isSavedPaymentCard={false}
                enableSaveCard={true}
                onSuccess3dsPayment={() =>
                  paymentSuccess('Plan upgraded successfully. Please login again.')
                }
                onFailure3dsPayment={() => {
                  setIsPaymentInitiate(false);
                  setIsRenewPaymentInitiate(false);
                }}
                isApiLoad={isRenewPaymentInitiate || isPendingUpgradeTrialPlan}
                submitButtonText={`Pay $${getTaxes?.total_amount || 0}`}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default RenewPlan;
