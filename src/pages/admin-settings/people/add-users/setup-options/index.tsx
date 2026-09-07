import { userInitialState } from '../../../constants';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useFormContext } from 'react-hook-form';
import OrderSummary from '../order-summary';
import PaymentScreen from '@/components/payment';

const SetupOption = ({
  orderSummary,
  status = '',
  paymentProps,
  setTypeOfPassword,
  dataGetMyPlanDetails,
  setPaymentCalculation,
}: any) => {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  }: any = useFormContext();

  // Watch current value of password_type
  const passwordType = watch('password_type');
  const watchUsers = watch('users');

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pt-2 pr-1">
      {status === 'show_payment' ? (
        <div className="flex flex-col xl:flex-row gap-5">
          <section className="w-full xl:w-1/2 border border-grey-200 p-3 rounded-xl flex items-center justify-center">
            <PaymentScreen
              ref={paymentProps?.paymentRef}
              onSuccessPayment={paymentProps?.onSuccessPayment}
              isSavedPaymentCard={false}
              onSuccess3dsPayment={paymentProps?.handle3DSSuccess}
              onFailure3dsPayment={paymentProps?.handle3DSFailure}
              isApiLoad={paymentProps?.isApiLoad}
            />
          </section>
          <OrderSummary
            orderSummary={orderSummary}
            dataGetMyPlanDetails={dataGetMyPlanDetails}
            customClass="w-full"
            mainCustomClass="w-full xl:w-1/2"
            onCalculationChange={setPaymentCalculation}
          />
        </div>
      ) : (
        <RadioGroup
          className="gap-4"
          value={passwordType}
          onValueChange={(value) => {
            setTypeOfPassword(value);
            setValue('password_type', value, { shouldValidate: true });
          }}
        >
          {/* The invite link is the default. Nothing on this screen ever
              e-mails a password: the person chooses their own on the page the
              link opens (see /accept-invite). */}
          <div className="flex items-start gap-3">
            <RadioGroupItem value="email" id="password-email" className="mt-1 cursor-pointer" />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="password-email" className="cursor-pointer">
                Send them an invite link
              </Label>
              <p className="text-xs text-grey-800">
                They get an e-mail with a link to choose their own password. The link works for 3
                days. You can send it again from the People list.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <RadioGroupItem value="common" id="password-common" className="mt-1 cursor-pointer" />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="password-common" className="cursor-pointer">
                Set one password for everyone now
              </Label>
              <p className="text-xs text-grey-800">
                You tell them the password yourself. They also get the invite link, in case they
                want to choose their own.
              </p>
            </div>
          </div>

          {passwordType === 'common' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5 w-full">
                <Input
                  type="password"
                  label="Password"
                  placeholder="Password"
                  {...register(`password`)}
                  error={errors?.password?.message}
                  showEye={true}
                />
              </div>
              <div className="flex flex-col gap-1.5 w-full">
                <Input
                  type="password"
                  label="Confirm Password"
                  placeholder="Confirm Password"
                  {...register(`confirm_password`)}
                  error={errors?.confirm_password?.message}
                  showEye={true}
                />
              </div>
            </div>
          )}
          <div className="flex items-start gap-3">
            <RadioGroupItem
              value="individual"
              id="password-individual"
              className="mt-1 cursor-pointer"
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="password-individual" className="cursor-pointer">
                Set a password for each person now
              </Label>
              <p className="text-xs text-grey-800">
                You tell each person their password yourself. They also get the invite link.
              </p>
            </div>
          </div>

          {passwordType === 'individual' && (
            <div className="flex flex-col gap-4">
              {watchUsers?.map((field: typeof userInitialState, index: number) => {
                return (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" key={index}>
                    <Input label={index === 0 && 'Person'} value={field?.first_name} disabled />

                    <Input
                      showEye={true}
                      label={index === 0 && 'Password'}
                      placeholder="Password"
                      type="password"
                      {...register(`users.${index}.password`)}
                      error={errors?.users?.[index]?.password?.message}
                    />
                    <Input
                      showEye={true}
                      label={index === 0 && 'Confirm Password'}
                      placeholder="Confirm Password"
                      type="password"
                      {...register(`users.${index}.confirm_password`)}
                      error={errors?.users?.[index]?.confirm_password?.message}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </RadioGroup>
      )}
    </div>
  );
};

export default SetupOption;
