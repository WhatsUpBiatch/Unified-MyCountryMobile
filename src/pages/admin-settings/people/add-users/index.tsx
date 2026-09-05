import { useRef, useState, type FC } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { formInitialState } from '../../constants';
import AddUserInfo from './add-user-info';
import SetupOption from './setup-options';
import Stepper from '@/components/custom/stepper';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addMember } from '@/services/api';
import Loader from '@/components/custom/loader';
import { useUser } from '@/hooks/use-user';
import {
  passwordValidationSchema,
  schemaValidationForAddIndividualPassword,
  schemaValidationForAddUser,
} from './schema';
import { yupResolver } from '@hookform/resolvers/yup';
import AlertConfirm from '@/components/custom/alert-confirm';
import MultipleAssignNumber from './multiple-assign-number';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useGetMyPlanDetails } from '@/hooks/common';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import { handleAlert } from '@/lib/utils';

interface AddUsersProps {
  setDrawerState: (state: boolean) => void;
}

const AddUsers: FC<AddUsersProps> = ({ setDrawerState }) => {
  const { data: dataGetMyPlanDetails } = useGetMyPlanDetails();
  const { refetch: refetchUserApi } = useUser();

  const [isPaymentRequired, setIspaymentRequired] = useState<any>(false);
  const [orderSummary, setOrderSummary] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState(1);
  /* Default: an invite link; the person chooses their own password. */
  const [typeOfPassword, setTypeOfPassword] = useState('email');
  const [isUserValidatorError, setIsUserValidatorError] = useState(false);
  const [alertAssignNumber, setAlertAssignNumber] = useState(false);
  const [showAssignNumber, setShowAssignNumber] = useState(false);
  const [newUsers, setNewUsers] = useState([]);

  const [status, setStatus] = useState('');
  const queryClient: any = useQueryClient();
  const paymentRef = useRef<any>(null);
  const paymentData = useRef<any>(null);

  const [paymentCalculation, setPaymentCalculation] = useState<{
    total_amount: number;
    tax_calculation_id: string | null;
  } | null>(null);

  const { mutate: mutateAddMember, isPending: isPendingAddMember } = useMutation({
    mutationFn: addMember,
    onSuccess: ({ data }) => {
      if (data?.data?.result?.requires_action) {
        paymentRef.current.handle3DSPayment(data?.data?.result?.client_secret);
        return;
      }

      handleSuccess(data);
    },
    onError: (error: any) => {
      /* The API refuses to create users when the company has no licence left,
         even if this screen believed the seats were free. Without this the
         admin is dead-ended: the payment step only renders once payment is
         already known to be required. Open it instead of failing silently. */
      const response = error?.response;
      const body = response?.data || {};
      const errorCode = String(body?.code || body?.error_code || body?.data?.code || '');
      const errorMessage = String(body?.message || '');
      const needsPayment =
        response?.status === 402 ||
        errorCode.toUpperCase() === 'PAYMENT_REQUIRED' ||
        /payment[\s_-]*required/i.test(errorMessage);

      // Anything else already surfaces through the shared axios error toast.
      if (!needsPayment) return;

      paymentRef.current?.resetPaymentState();
      paymentData.current = null;
      setIspaymentRequired(true);
      setOrderSummary((prev: any) => {
        const watchUserLength = watchUsers?.length || 0;
        return {
          ...(prev || {}),
          watchUserLength,
          availableLicenses: prev?.availableLicenses ?? 0,
          totalPayableUnit: prev?.totalPayableUnit || watchUserLength,
        };
      });
      setCurrentStep(2);
      setStatus('show_payment');
    },
  });

  const handleSuccess = (data: any) => {
    paymentRef.current?.resetPaymentState();
    paymentData.current = null;
    setStatus('');
    setPaymentCalculation(null);
    queryClient.invalidateQueries(['fetchUsersList'], { exact: true });
    queryClient.invalidateQueries({ queryKey: ['pendingInvites'] });
    queryClient.invalidateQueries(['getMyPlanDetails'], { exact: true });
    invalidateGlobalUsersDirectory(queryClient);

    refetchUserApi();
    /* The server says what happened to the invite e-mails; this is the
       fallback wording when it does not. No password is ever e-mailed. */
    handleAlert({
      text:
        data?.data?.message ||
        'People added. We sent them a link to choose a password. It works for 3 days.',
      type: 'success',
    });

    const users = data?.data?.result?.createdUsers || [];
    if (users?.length > 0) {
      setAlertAssignNumber(true);
      setNewUsers(users);
    }
  };

  const getResolver = (currentStep: any, typeOfPassword: any) => {
    if (currentStep === 1) {
      return yupResolver(schemaValidationForAddUser);
    }

    if (currentStep === 2) {
      if (typeOfPassword === 'common') {
        return yupResolver(passwordValidationSchema);
      }

      if (typeOfPassword === 'individual') {
        return yupResolver(schemaValidationForAddIndividualPassword);
      }
    }
    return undefined;
  };

  const formInstance = useForm<any>({
    defaultValues: formInitialState,
    resolver: getResolver(currentStep, typeOfPassword),
    mode: 'onChange',
  });

  const { handleSubmit, watch } = formInstance;

  const [watchPasswordType, watchPassword, watchUsers, watchSite] = watch([
    'password_type',
    'password',
    'users',
    'site',
  ]);

  const StepContent = [
    {
      number: 1,
      title: 'Add people',
    },
    {
      number: 2,
      title: 'Setup Options',
    },
  ];

  const onSubmit = (data: any) => {
    const { password_type, users, site } = data || {};

    if (currentStep === 1) {
      setCurrentStep((p) => p + 1);
    } else {
      if (isPaymentRequired) {
        setStatus('show_payment');
      } else {
        mutateAddMember({
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          users: users?.map(({ confirm_password, password, role, ...item }: any) => ({
            ...item,
            /* The name, not the id. `value` is always a uuid (role_uuid, or the
                   custom role's uuid), and sending it here wrote a uuid into
                   users.role — the display-name column. Every guard that compares
                   that column to "ADMIN", "MANAGER" or "AGENT" then silently
                   stopped working, including the one that prevents an
                   administrator being deleted. The role ids still travel
                   separately as role_uuid / custom_role_uuid. */
            role: role?.label,
            password: password_type === 'common' ? data?.password : password,
          })),
          site_uuid: site?.value,
        });
      }
    }
  };

  const onSuccessPayment = (paymentMethod: any) => {
    // const planCost = dataGetMyPlanDetails?.current_plan_details?.discount_enabled
    //   ? dataGetMyPlanDetails?.current_plan_details?.discount_price
    //   : dataGetMyPlanDetails?.current_plan_details?.original_price;
    // const proratedCost = getLicenseCalculatedPlanCost({
    //   planCost,
    //   plan_expiration_date: dataGetMyPlanDetails?.current_plan_details?.plan_expiration_date,
    // });
    // const available =
    //   (dataGetMyPlanDetails?.license_detail?.free_licenses || 0) +
    //   (dataGetMyPlanDetails?.license_detail?.free_revoked_licenses || 0);

    // const totalAmountPayable = (watchUsers?.length - available) * +proratedCost;

    // const taxPercentage = Number(
    //   dataGetMyPlanDetails?.last_billing?.tax_detail?.tax_percentage ?? 0,
    // );

    // const totalTax = (taxPercentage * (totalAmountPayable ?? 0)) / 100;

    const payload = {
      payment: {
        amount: paymentCalculation?.total_amount,
        tax_calculation_id: paymentCalculation?.tax_calculation_id,
        payment_method_id: paymentMethod?.id || paymentMethod?.payment_method_id,
        save: paymentMethod?.isSavedCard,
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      users: watchUsers?.map(({ confirm_password, role, password, ...item }: any) => ({
        ...item,
        /* The name, not the id. `value` is always a uuid (role_uuid, or the
                   custom role's uuid), and sending it here wrote a uuid into
                   users.role — the display-name column. Every guard that compares
                   that column to "ADMIN", "MANAGER" or "AGENT" then silently
                   stopped working, including the one that prevents an
                   administrator being deleted. The role ids still travel
                   separately as role_uuid / custom_role_uuid. */
        role: role?.label,
        password: watchPasswordType === 'common' ? watchPassword : password,
      })),
      site_uuid: watchSite?.value,
    };

    paymentMethod.setLoader(false);
    mutateAddMember(payload);

    paymentData.current = payload;
  };

  const handle3DSSuccess = () => {
    mutateAddMember({
      ...paymentData?.current,
      payment: {
        ...paymentData?.current?.payment,
        status: 'confirmed',
      },
    });
    paymentData.current = null;
  };

  const handle3DSFailure = () => {
    paymentData.current = null;
    setStatus('');
  };

  const stepLookUp: any = {
    1: (
      <AddUserInfo
        {...{
          setIspaymentRequired,
          setOrderSummary,
          setIsUserValidatorError,
          dataGetMyPlanDetails,
          setPaymentCalculation,
        }}
      />
    ),
    2: (
      <SetupOption
        {...{
          isPaymentRequired,
          orderSummary,
          status,
          dataGetMyPlanDetails,
          setPaymentCalculation,
          paymentProps: {
            onSuccessPayment,
            paymentRef,
            isApiLoad: isPendingAddMember,
            handle3DSSuccess,
            handle3DSFailure,
          },
          setTypeOfPassword,
        }}
      />
    ),
  };
  return (
    <>
      <FormProvider {...formInstance}>
        <div className="mcm-page mcm-invite w-full h-full min-h-0 overflow-hidden flex flex-col justify-between">
          <Stepper steps={StepContent} currentStep={currentStep} mobileHorizontal />
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="h-full min-h-0 w-full flex flex-1 flex-col justify-between gap-4 overflow-hidden"
          >
            {/* The buttons live INSIDE the scrolling area, at the end of the
                form — not pinned to the bottom of the drawer.
 
                Held outside it they were always on screen, sitting over
                whatever the form was showing, and on a wide screen with no
                border or surface behind them they landed on top of the text.
                At the end of the form they are where somebody who has filled it
                in arrives, and nothing is covered on the way down. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {stepLookUp?.[currentStep]}
              <div className="mt-4 border-t border-gray-200 bg-white px-1 py-3">
              <div className="flex min-w-max flex-nowrap justify-start gap-2 overflow-x-auto overflow-y-hidden sm:justify-end lg:min-w-0 lg:justify-end lg:overflow-visible">
                <button
                  onClick={() => {
                    if (currentStep === 1) {
                      setDrawerState(false);
                    } else {
                      setCurrentStep((prev) => prev - 1);
                    }
                    setStatus('');
                  }}
                  type="button"
                  className="btn ghost shrink-0"
                >
                  {currentStep === 1 ? 'Cancel' : 'Back'}
                </button>
                {status !== 'show_payment' && (
                  <button
                    type="submit"
                    disabled={isPendingAddMember || isUserValidatorError}
                    className="btn primary shrink-0"
                  >
                    {isPendingAddMember ? (
                      /* white, not `blue`: this button is filled with the
                         accent now, and a --primary spinner can vanish into it
                         on tenants whose brand colour is close to it. */
                      <Loader variant="white" />
                    ) : currentStep === 2 ? (
                      'Submit'
                    ) : (
                      'Save & Continue'
                    )}
                  </button>
                )}
                </div>
              </div>
            </div>
          </form>

          <AlertConfirm
            {...{
              apiLoading: false,
              onConfirm: () => {
                setShowAssignNumber(true);
                setAlertAssignNumber(false);
                // setDrawerState(false);
              },
              onCancel: () => {
                setDrawerState(false);
              },
              onClose: () => {
                setDrawerState(false);
              },
              open: alertAssignNumber,
              setOpen: setAlertAssignNumber,
              singleButton: true,
              singleButtonText: 'Go Now',
              singleButtonHandler: () => {
                setDrawerState(false);
              },
              descriptionTextComp: (
                <div className=" text-md">
                  Person added. Give them a phone number now, or later from the People list.
                </div>
              ),
              closeBtnText: 'Assign Later',
              confirmBtnText: 'Assign Now',
            }}
          />
        </div>
      </FormProvider>
      {showAssignNumber && (
        <Dialog open={showAssignNumber} onOpenChange={setShowAssignNumber}>
          <DialogContent
            className="md:w-3/6 p-3 max-h-[99%] overflow-y-auto w-full"
            showCloseButton={false}
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            <MultipleAssignNumber
              {...{
                users: newUsers,
                handleClose: () => {
                  setShowAssignNumber(false);
                  setDrawerState(false);
                },
                showAssignNumber,
                setShowAssignNumber,
              }}
            />
          </DialogContent>
        </Dialog>
      )}
      {/* {showAssignNumber && (
        <SideDrawer
          isOpen={showAssignNumber}
          handleClose={() => setShowAssignNumber(false)}
          isHeader={true}
          width="45%"
          content={
            <MultipleAssignNumber
              {...{
                users: newUsers,
                handleClose: () => {
                  setShowAssignNumber(false);
                  setDrawerState(false);
                },
                showAssignNumber,
                setShowAssignNumber,
              }}
            />
          }
        />
      )} */}
    </>
  );
};

export default AddUsers;
