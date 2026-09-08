import { useLocation } from 'react-router-dom';
import { PlanDurationMap } from '@/lib/plan-constants';
import { VerifiedCheck } from '@/assets/icons';
import { useMutation } from '@tanstack/react-query';
import { getTaxesAndFees } from '@/services/api';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import CustomTooltip from '@/components/custom/custom-tooltip';
import { Info } from 'lucide-react';
import { getPlanDidCountries } from '@/lib/did-countries';

const PlanSummary = ({
  licenseCount,
  rowData,
  formData,
  planDuration,
  costDetails,
  onSuccess,
  page = 1,
  initialData,
  didCountries: didCountriesProp,
}: any) => {
  const { state } = useLocation();
  const { isTrailPlan } = state || {};
  const { discount_enabled, discount_price, original_price } = costDetails || {};
  const planCost = discount_enabled ? discount_price : original_price;
  const [taxes, setTaxes] = useState<any>({});
  const didCountriesFromProps = getPlanDidCountries(didCountriesProp);
  const didCountries = didCountriesFromProps.length
    ? didCountriesFromProps
    : getPlanDidCountries(rowData);
  const didCountryNames = didCountries.map((country) => country.country_name);

  const { mutate, isPending } = useMutation({
    mutationKey: ['getTaxesAndFees'],
    mutationFn: getTaxesAndFees,
    onSuccess: (data) => {
      onSuccess(data?.data?.data?.result || {});
      setTaxes(data?.data?.data?.result || {});
    },
  });
  useEffect(() => {
    if (!rowData?.uuid || licenseCount <= 0 || page !== 2) return;
    const payload = initialData?.isLogin
      ? {
          plan_uuid: rowData.uuid,
          licenses: licenseCount,
          plan_duration: planDuration,
          line1: initialData?.current?.address || '',
          country: initialData?.current?.country || '',
          state: initialData?.current?.state || '',
          city: initialData?.current?.city || '',
          postal_code: initialData?.current?.postal_code || '',
          type: 'SIGNUP',
        }
      : {
          plan_uuid: rowData.uuid,
          licenses: licenseCount,
          plan_duration: planDuration,
          line1: formData?.company_address || '',
          country: formData?.company_country?.value || '',
          state: formData?.company_state?.value || '',
          city: formData?.company_city?.value || '',
          postal_code: formData?.company_postal_code || '',
          type: 'SIGNUP',
        };

    mutate(payload);
  }, [rowData?.uuid, licenseCount, page]);

  return (
    <>
      <div className="bg-white  rounded-xl py-4 shadow-secondary/5 focus:shadow-secondary/8 shadow-md gap-6 flex flex-col relative w-full">
        <div className="flex justify-between flex-row gap-4 px-8 min-h-[72px]">
          <div className="flex flex-col gap-3 justify-center items-center w-full">
            <h4 className="text-primary font-semibold text-base">
              {' '}
              {rowData?.plan_name || 'Plan'}
            </h4>
            <div className="flex  gap-2">
              <span className="text-primary font-semibold leading-7 pb-0 text-2xl">
                <span className="text-xl align-text-top">$</span>
                {planCost || 0}
              </span>
              {discount_enabled && (
                <span className="flex gap-0.5 text-red-500 justify-end text-base">
                  <span className="text-lg align-text-top">$</span>
                  <h3 className="line-through">{original_price}</h3>
                </span>
              )}
            </div>
            <h4 className="text-gray-500 text-base">/user/{PlanDurationMap[planDuration]}</h4>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-8">
          <h5 className=" font-semibold text-base uppercase border-b border-gray-200 pb-3">
            FEATURES
          </h5>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between border-b border-gray-200 pb-3">
              <p className="text-gray-800 font-regular text-sm">
                {licenseCount || 1} User(s) (Line Included)
              </p>
              <p className="text-primary font-bold text-sm">
                {licenseCount || 1} X ${planCost}
              </p>
            </div>

            <div className="flex justify-between">
              <p className="text-gray-800 font-regular text-sm">1 DID Cost </p>
              <div className="flex items-center gap-1">
                <p className="text-primary font-bold text-sm">FREE</p>
                <CustomTooltip
                  side="left"
                  className="max-w-64 px-3 py-2"
                  text={
                    <div className="flex flex-col gap-1">
                      <p className="font-semibold">Included DID countries</p>
                      {didCountryNames.length ? (
                        <ul className="list-disc space-y-0.5 pl-4">
                          {didCountryNames.map((countryName) => (
                            <li key={countryName}>{countryName}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>Country information is unavailable for this plan.</p>
                      )}
                    </div>
                  }
                >
                  <button
                    type="button"
                    aria-label={
                      didCountryNames.length
                        ? `Included DID countries: ${didCountryNames.join(', ')}`
                        : 'Included DID country information is unavailable'
                    }
                    className="inline-flex size-5 items-center justify-center rounded-full text-primary/80 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Info className="size-4" aria-hidden="true" />
                  </button>
                </CustomTooltip>
              </div>
            </div>
          </div>
        </div>
        {page === 2 && (
          <div className="w-full p-4 pb-0 flex flex-col gap-4">
            <div className="flex flex-col border border-gray-200 bg-gray-100 p-4 rounded-lg">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between">
                  <h5 className=" text-gray-700 text-sm">Subtotal</h5>
                  <p className="text-gray-700 text-sm">
                    {isPending ? (
                      <Skeleton className="h-3 w-[50px] bg-gray-200" />
                    ) : (
                      `$${taxes?.sub_total || 0}`
                    )}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <h5 className=" text-gray-700 text-sm">Taxes</h5>
                  <p className="text-gray-700 text-sm">
                    {isPending ? (
                      <Skeleton className="h-3 w-[80px] bg-gray-200" />
                    ) : (
                      <div className="flex items-center gap-0.5">
                        ${taxes?.tax_amount || 0}
                        <span className="font-normal">({Number(taxes?.tax_percentage ?? 0)}%)</span>
                      </div>
                    )}
                  </p>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-2 mt-2">
                  <h3 className=" font-semibold text-base text-primary">Total</h3>
                  <div className="flex items-center gap-2">
                    {isTrailPlan ? (
                      <p className="text-red-700 font-semibold">(Free Trial Plan)</p>
                    ) : null}
                    <h3 className=" font-semibold text-base text-primary">
                      {isTrailPlan ? (
                        '$0'
                      ) : (
                        <>
                          {isPending ? (
                            <Skeleton className="h-3 w-[50px] bg-gray-200" />
                          ) : (
                            `$${taxes?.total_amount || 0}`
                          )}
                        </>
                      )}
                    </h3>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-green-700/70 bg-green-100 text-green-700/70">
              <VerifiedCheck className="text-green-700/70" />
              <p className="font-medium text-sm">No hidden costs & fees</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default PlanSummary;
