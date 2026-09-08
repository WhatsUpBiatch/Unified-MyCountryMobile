import LogoIcon from '@/assets/images/LogoIcon.svg';
import CustomPlanVector from '@/assets/images/customplanvector.svg';
import { useNavigate } from 'react-router-dom';
import PricingDropDown from './dropdown';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import Loader from '@/components/custom/loader'; 
import { useGetPlans } from '@/hooks/common';
import { durationMap, PlanDurationMap, PRICE_FEATURES } from '@/lib/plan-constants';
import { Check, InfoIcon } from '@/assets/icons';
import { getEnv } from '@/lib/utils';
import { useOrganization } from '@/hooks/use-organisation';
import { PLANS } from '@/lib/plan-catalogue';

export type PricingDropdownKey = 'virtual_phone' | 'international_calling' | 'sms' | 'learn';

/* The plans shown here come from the billing catalogue, so a price on this page
   cannot disagree with the price a customer is actually charged. This page used
   to carry three hardcoded plan names with one identical price caption repeated
   under every one of them, matching nothing we sell.

   Only paid plans get a column - a free plan has no per-seat price to compare
   and belongs in its own section rather than in a price grid. */
const PAID_PLANS = PLANS.filter((plan) => plan.monthlyPerSeat > 0);

/* A year is quoted individually, so there is no annual figure to print. Saying
   that plainly beats printing a number nobody honours. */
const planPriceLine = (plan?: (typeof PAID_PLANS)[number]): string => {
  if (!plan) return '';
  const monthly = `$${plan.monthlyPerSeat} per user, per month`;
  return plan.yearlyPerSeat === null
    ? `${monthly} · annual billing quoted on request`
    : `${monthly} · $${plan.yearlyPerSeat} per user, per year`;
};

const Pricing = () => {
  const navigate = useNavigate();
  const { mainSiteInfo } = useOrganization();
  const [dropDown, setDropDown] = useState({
    virtual_phone: false,
    international_calling: false,
    sms: false,
    learn: false,
  });
  const [planDuration, setPlanDuration] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const { data: planData, isLoading } = useGetPlans();

  const toggleDropdown = (key: PricingDropdownKey) => {
    setDropDown((prevState) => ({
      ...prevState,
      virtual_phone: key === 'virtual_phone' ? !prevState.virtual_phone : false,
      international_calling:
        key === 'international_calling' ? !prevState.international_calling : false,
      sms: key === 'sms' ? !prevState.sms : false,
      learn: key === 'learn' ? !prevState.learn : false,
    }));
  };

  const getPlanCost = (cost = []) => {
    const costDetails = cost.filter((item: any) => item.type === durationMap[planDuration]);
    return costDetails?.[0] || {};
  };
  return (
    <>
      <div className="w-full bg-white h-full">
        {/* header */}
        <div className="mx-auto w-full px-8">
          <header className="bg-white py-8">
            <nav className="flex items-center justify-between flex-row gap-6" aria-label="Global">
              {/* logo */}
              <div className="flex flex-1">
                <a className="h-8 cursor-pointer" onClick={() => navigate('/')}>
                  <img
                    src={
                      mainSiteInfo?.small_logo
                        ? `${getEnv().VITE_API_BASE_URL}/${mainSiteInfo?.small_logo}`
                        : LogoIcon
                    }
                    alt="Logo"
                    className="h-full"
                  />
                </a>
              </div>
              {/* logo */}

              {/* mobile toggle button */}
              <div className="flex md:hidden">
                <button
                  type="button"
                  className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 "
                >
                  <span className="sr-only">Open main menu</span>
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                    aria-hidden="true"
                    data-slot="icon"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                    />
                  </svg>
                </button>
              </div>
              {/* mobile toggle button */}

              {/* menus */}
              <div className="hidden md:flex md:gap-8">
                <div className="relative">
                  <button
                    type="button"
                    className="cursor-pointer flex items-center gap-x-1 text-sm font-semibold leading-6  hover:text-primary focus:text-primary"
                    aria-expanded="true"
                    onClick={() => toggleDropdown('virtual_phone')}
                  >
                    Virtual Phone Numbers
                    <svg
                      className="h-5 w-5 flex-none text-gray-400"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      data-slot="icon"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <PricingDropDown isDropDownOpen={dropDown.virtual_phone} />
                </div>
                <div className="relative">
                  <button
                    type="button"
                    className="cursor-pointer flex items-center gap-x-1 text-sm font-semibold leading-6  hover:text-primary focus:text-primary"
                    aria-expanded="true"
                    onClick={() => toggleDropdown('international_calling')}
                  >
                    International Calling
                    <svg
                      className="h-5 w-5 flex-none text-gray-400"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      data-slot="icon"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <PricingDropDown isDropDownOpen={dropDown.international_calling} />
                </div>
                <div className="relative">
                  <button
                    type="button"
                    className="cursor-pointer flex items-center gap-x-1 text-sm font-semibold leading-6  hover:text-primary focus:text-primary"
                    aria-expanded="true"
                    onClick={() => toggleDropdown('sms')}
                  >
                    SMS
                    <svg
                      className="h-5 w-5 flex-none text-gray-400"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      data-slot="icon"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <PricingDropDown isDropDownOpen={dropDown.sms} />
                </div>
                <div className="cursor-pointer text-sm font-semibold leading-6  hover:text-primary focus:text-primary">
                  International Top-Up
                </div>
                <div className="relative">
                  <button
                    type="button"
                    className="cursor-pointer flex items-center gap-x-1 text-sm font-semibold leading-6  hover:text-primary focus:text-primary"
                    aria-expanded="true"
                    onClick={() => toggleDropdown('learn')}
                  >
                    Learn
                    <svg
                      className="h-5 w-5 flex-none text-gray-400"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      data-slot="icon"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <PricingDropDown isDropDownOpen={dropDown.learn} />
                </div>
              </div>
              {/* menus */}

              {/* actions */}
              <Button variant={'outline'} onClick={() => navigate('/')}>
                Login
              </Button>
              {/* actions */}
            </nav>
          </header>
        </div>
        {/* header */}

        {/* content */}
        <div className="relative overflow-auto h-full">
          {/* background */}
          <div className="bg-ucass-primary-100">
            <div className="mx-auto w-full px-8">
              <div className="flex justify-center p-8 min-h-80"></div>
            </div>
          </div>
          {/* background */}

          {/* pricing */}
          <div className="absolute top-4 left-0 w-full">
            <div className="mx-auto w-full px-8">
              <div className="flex justify-end gap-2">
                <Label>Monthly</Label>
                <Switch
                  checked={planDuration === 12}
                  onCheckedChange={(checked) => {
                    setPlanDuration(checked ? 12 : 1);
                  }}
                />
                <Label>Annually</Label>
              </div>
            </div>
            <div className="mx-auto w-full px-8 pt-8 gap-5 flex flex-col">
              {/* <div className="flex items-center justify-center gap-5 pb-8"> */}
              <div className="grid grid-cols-4 w-full gap-5 pb-8">
                {isLoading ? (
                  <Loader variant="blue" />
                ) : planData?.length ? (
                  planData?.map((plan: any, index: number) => {
                    const { plan_name, cost, description, licenses, trial_period } = plan || {};
                    const costDetails: any = getPlanCost(cost);
                    return (
                      <>
                        <div
                          key={`${index}-${plan_name}`}
                          // className={`p-6 rounded-xl ${index === activeIndex ? 'bg-primary' : 'bg-white'} shadow-md w-1/3 relative`}
                          className={`p-6 rounded-xl ${index === activeIndex ? 'bg-primary' : 'bg-white'} shadow-md w-full relative transition-colors duration-300 ease-in-out`}
                          onClick={() => setActiveIndex(index)}
                        >
                          <div className="flex flex-col gap-6">
                            {costDetails?.discount_enabled && (
                              <span
                                className={`inline-flex items-center rounded-b-md px-2 py-1 text-xs ${index === activeIndex ? 'bg-white text-primary' : 'bg-primary text-white'} font-medium tracking-widest absolute top-0 right-6`}
                              >
                                {costDetails?.discount}% Discount
                              </span>
                            )}
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-6">
                                <h2
                                  className={`text-2xl ${index === activeIndex ? 'text-white' : 'text-primary'} font-semibold flex items-center gap-5`}
                                >
                                  {plan_name}
                                </h2>
                                {index === 0 && (
                                  <span className="inline-flex items-center rounded-md bg-ucass-green px-2 py-1 text-xs font-medium  uppercase tracking-widest">
                                    Popular
                                  </span>
                                )}
                              </div>
                              <small
                                className={`${index === activeIndex ? 'text-white' : 'text-gray-800'} font-normal text-[.8rem]`}
                              >
                                {description}
                              </small>
                            </div>
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-3">
                                <h2
                                  className={`text-4xl ${index === activeIndex ? 'text-white' : 'text-primary'} font-semibold flex items-center`}
                                >{`$${costDetails?.discount_enabled ? costDetails?.discount_price : costDetails?.original_price}`}</h2>
                                {costDetails?.discount_enabled && (
                                  <h4
                                    className={`line-through text-xl ${index === activeIndex ? 'text-white' : 'text-primary'}`}
                                  >
                                    ${costDetails?.original_price}
                                  </h4>
                                )}
                              </div>
                              <div className="flex items-center justify-between">
                                <p
                                  className={`${index === activeIndex ? 'text-white' : 'text-primary'} text-sm`}
                                >
                                  /{PlanDurationMap[planDuration]}/user
                                </p>
                                <p
                                  className={`font-semibold text-sm ${index === activeIndex ? 'text-white' : 'text-primary'}`}
                                >
                                  Licences: {!licenses ? 'Unlimited' : `Up to ${licenses}`}
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-col gap-4">
                              <Button
                                className={`${index === activeIndex ? 'text-primary bg-white border-primary hover:bg-white hover:text-primary/90' : 'text-primary bg-white border-primary hover:bg-primary hover:text-white'}`}
                                onClick={() => {
                                  navigate(
                                    `/sign-up?planId=${encodeURIComponent(plan.uuid)}&isTrial=false`,
                                  );
                                }}
                              >
                                Subscribe Now
                              </Button>

                              {trial_period > 0 ? (
                                <p
                                  className={`${index === activeIndex ? 'text-white' : 'text-primary'} text-sm p-1 rounded-full flex justify-center cursor-pointer font-semibold underline-offset-4 underline w-auto mx-auto`}
                                  onClick={() => {
                                    navigate(
                                      `/sign-up?planId=${encodeURIComponent(plan.uuid)}&isTrial=true`,
                                    );
                                  }}
                                >
                                  {trial_period}-days free trial
                                </p>
                              ) : null}

                              {plan_name === 'Standard' && <p className="p-1">&nbsp;</p>}
                              {plan_name === 'Intermediate' && <p className="p-1">&nbsp;</p>}
                              <h5
                                className={` ${index === activeIndex ? 'text-white' : ''} font-medium text-lg`}
                              >
                                All Advanced Features
                              </h5>
                              <ul
                                className={`${index === activeIndex ? 'list-image-[url(assets/images/CheckWhite.svg)]' : 'list-image-[url(assets/images/CheckBlue.svg)]'} list-inside ${index === activeIndex ? 'text-white' : 'text-gray-800'} text-sm font-medium flex flex-col gap-4 pb-1.5`}
                              >
                                {PRICE_FEATURES.map(({ name }, i) => {
                                  return <li key={`${i + 1}-${name}`}>{name}</li>;
                                })}
                              </ul>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })
                ) : (
                  <div>No Plans are found</div>
                )}
                {planData && planData?.length > 0 && (
                  <div className="p-6 rounded-xl bg-white shadow-md w-full flex flex-col items-center justify-center gap-3 relative">
                    <img
                      src={CustomPlanVector}
                      alt="Custom Plan "
                      className="w-full h-full max-h-52 object-contain"
                    />
                    <h5 className={`font-medium text-lg text-center`}>Customize Your Plan</h5>
                    <p className={`font-medium text-sm text-gray-500 text-center mb-1`}>
                      Design a plan that fits your workflow with flexible options and transparent
                      pricing.
                    </p>
                    <Button
                      onClick={() => navigate('/sign-up?planId=custom&isTrial=false')}
                      className={`text-white bg-primary  hover:bg-primary/90  w-full`}
                    >
                      Contact Us
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-center gap-6">
                <h1 className="text-3xl text-gray-900 font-semibold">Compare plan features</h1>
                <div className="flex w-full">
                  <div className="flex flex-col w-[30%] justify-center gap-5">
                    <div className="flex flex-col py-3">
                      <div className="flex flex-col w-full min-h-20 justify-center">
                        <div className="flex items-center gap-3">
                          <h4 className="flex items-center text-xl">Have a question?</h4>
                        </div>
                        <h4 className="font-semibold flex items-center text-xl">
                          Call (000) 123 4567
                        </h4>
                      </div>
                    </div>
                    <div className="flex flex-col gap-6 pt-3">
                      <h4 className="text-primary font-semibold flex items-center">
                        Cloud phone system
                      </h4>
                      <div className="flex flex-col gap-6">
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Business phone numbers</p>
                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Toll-free number and minutes</p>
                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            Domestic calling in US/Canada
                            <span className="text-primary">*</span>
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            Enhanced Business SMS
                            <span className="text-primary">*</span>
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            Visual voicemail – voicemail transcriptions, voicemail to email
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Multi-level auto attendant and IVR</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Shared lines</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            High-definition (HD) voice; AI-noise cancellation
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">End-to-end encryption for calls (beta)</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Emergency calling (E911)</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Desk phone & conference phone rentals</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Incoming caller ID</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Call queues</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Call recording</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Up to 8-digit extensions with site codes</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            Receptionist and admin console (heads-up display)
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            Advanced call monitoring including whisper, barge, and monitor
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Hot desking</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Push-to-talk / walkie talkie</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-6 pt-3">
                      <h4 className="text-primary font-semibold flex items-center">
                        Cloud phone system
                      </h4>
                      <div className="flex flex-col gap-6">
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Business phone numbers</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Toll-free number and minutes</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            Domestic calling in US/Canada
                            <span className="text-primary">*</span>
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            Enhanced Business SMS
                            <span className="text-primary">*</span>
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            Visual voicemail – voicemail transcriptions, voicemail to email
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Multi-level auto attendant and IVR</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Shared lines</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            High-definition (HD) voice; AI-noise cancellation
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">End-to-end encryption for calls (beta)</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Emergency calling (E911)</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Desk phone & conference phone rentals</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Incoming caller ID</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Call queues</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Call recording</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Up to 8-digit extensions with site codes</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            Receptionist and admin console (heads-up display)
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">
                            Advanced call monitoring including whisper, barge, and monitor
                          </p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Hot desking</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p className="truncate">Push-to-talk / walkie talkie</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col w-[23.3%] px-2 gap-5">
                    <div className="p-3 rounded-xl border border-gray-200 bg-gray-100">
                      <div className="flex flex-col items-center justify-center gap-1 w-full min-h-20">
                        <div className="flex items-center gap-3">
                          <h2 className="text-primary font-semibold flex items-center leading-none text-2xl">
                            {PAID_PLANS[0]?.name ?? ''}
                          </h2>
                          <span className="inline-flex items-center rounded-md bg-ucass-green px-2 py-1 text-xs font-medium  uppercase tracking-widest">
                            Popular
                          </span>
                        </div>
                        <small className="text-gray-800 font-normal">
                          {planPriceLine(PAID_PLANS[0])}
                        </small>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-6 pt-3">
                      <h3 className="text-primary font-semibold flex items-center">&nbsp;</h3>
                      <div className="flex flex-col items-center gap-6">
                        <div className="min-h-7 flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">100</p>
                        <p className="min-h-7 text-sm flex items-center">Unlimited</p>
                        <p className="min-h-7 text-sm flex items-center">25/user/mo</p>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>Basic</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>On-demand</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <p className="min-h-7 text-sm flex items-center">&nbsp;</p>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">&nbsp;</p>
                        <p className="min-h-7 text-sm flex items-center">&nbsp;</p>
                        <p className="min-h-7 text-sm flex items-center">Add-on option</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-6 pt-3">
                      <h3 className="text-primary font-semibold flex items-center">&nbsp;</h3>
                      <div className="flex flex-col items-center gap-6">
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">100</p>
                        <p className="min-h-7 text-sm flex items-center">Unlimited</p>
                        <p className="min-h-7 text-sm flex items-center">25/user/mo</p>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>Basic</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>On-demand</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <p className="min-h-7 text-sm flex items-center">&nbsp;</p>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">&nbsp;</p>
                        <p className="min-h-7 text-sm flex items-center">&nbsp;</p>
                        <p className="min-h-7 text-sm flex items-center">Add-on option</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col w-[23.3%] px-2 gap-5">
                    <div className="p-3 rounded-xl border border-gray-200 bg-gray-100">
                      <div className="flex flex-col items-center justify-center gap-1 w-full min-h-20">
                        <div className="flex items-center gap-3">
                          <h2 className="text-primary font-semibold flex items-center leading-none text-2xl">
                            {PAID_PLANS[1]?.name ?? ''}
                          </h2>
                        </div>
                        <small className="text-gray-800 font-normal">
                          {planPriceLine(PAID_PLANS[1])}
                        </small>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-6 pt-3">
                      <h3 className="text-primary font-semibold flex items-center">&nbsp;</h3>
                      <div className="flex flex-col items-center gap-6">
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">1000</p>
                        <p className="min-h-7 text-sm flex items-center">Unlimited</p>
                        <p className="min-h-7 text-sm flex items-center">100/user/mo</p>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>Advanced rules and routing</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>Automatic / on‑demand</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">Add-on option</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-6 pt-3">
                      <h3 className="text-primary font-semibold flex items-center">&nbsp;</h3>
                      <div className="flex flex-col items-center gap-6">
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">1000</p>
                        <p className="min-h-7 text-sm flex items-center">Unlimited</p>
                        <p className="min-h-7 text-sm flex items-center">100/user/mo</p>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>Advanced rules and routing</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>Automatic / on‑demand</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">Add-on option</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col w-[23.3%] px-2 gap-5">
                    <div className="p-3 rounded-xl border border-gray-200 bg-gray-100">
                      <div className="flex flex-col items-center justify-center gap-1 w-full min-h-20">
                        <div className="flex items-center gap-3">
                          <h2 className="text-primary font-semibold flex items-center leading-none text-2xl">
                            {PAID_PLANS[2]?.name ?? ''}
                          </h2>
                        </div>
                        <small className="text-gray-800 font-normal">
                          {planPriceLine(PAID_PLANS[2])}
                        </small>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-6 pt-3">
                      <h3 className="text-primary font-semibold flex items-center">&nbsp;</h3>
                      <div className="flex flex-col items-center gap-6">
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">10,000</p>
                        <p className="min-h-7 text-sm flex items-center">Unlimited</p>
                        <p className="min-h-7 text-sm flex items-center">200/user/mo</p>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>Advanced rules and routing</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>Automatic / on‑demand</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">Add-on option</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-6 pt-3">
                      <h3 className="text-primary font-semibold flex items-center">&nbsp;</h3>
                      <div className="flex flex-col items-center gap-6">
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">10,000</p>
                        <p className="min-h-7 text-sm flex items-center">Unlimited</p>
                        <p className="min-h-7 text-sm flex items-center">200/user/mo</p>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>Advanced rules and routing</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="flex items-center gap-1 min-h-7 text-sm">
                          <p>Automatic / on‑demand</p>

                          <InfoIcon className="w-3 h-3" />
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <div className="min-h-7 text-sm flex items-center">
                          <div className="flex items-center justify-center w-6 h-6 bg-primary/50 rounded-full p-1.5">
                            <Check className="w-100 h-100 " />
                          </div>
                        </div>
                        <p className="min-h-7 text-sm flex items-center">Add-on option</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Pricing;
