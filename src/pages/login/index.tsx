import { Check } from '@/assets/icons';
// import Logo from '@/assets/images/Logo.svg';
import Logo from '@/assets/images/Logo.svg';
// import Desktop from '@/assets/images/Desktop-2.svg';
import Desktop from '@/assets/images/signup-banner-image.png';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useMutation } from '@tanstack/react-query';
import { login, sendOtp, verifyOtp, googleLogin } from '@/services/api';
import { useForm, type SubmitHandler, Controller } from 'react-hook-form';
import Loader from '@/components/custom/loader';
import { useUser } from '@/hooks/use-user';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/assets/icons/icon';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import OtpVerification from '../signup/otp-verification';
import {
  getDeviceId,
  getEnv,
  handleAlert,
  PLAN_PENDING_COMPANY_UUID_KEY,
  PLAN_PENDING_FLAG_KEY,
  RENEW_PLAN_FROM_APP_KEY,
  SESSION_NAME,
} from '@/lib/utils';
import packageJson from '../../../package.json';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { useOrganization } from '@/hooks/use-organisation';
import { Turnstile, type TurnstileHandle } from '@/hooks/use-turnstile';
import { ArrowLeft } from 'lucide-react';

const isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(
  window.location.hostname,
);

type Inputs = {
  email: string;
  password: string;
};
const schema = yup.object({
  email: yup.string().email('Invalid email format').required('Email is required'),
  password: yup
    .string()
    .required('Password is required')
    .min(6, 'Password must be at least 6 characters')
    // .max(15, 'Password must not be more than 15 characters')
    .matches(/^\S+$/, 'Spaces are not allowed'),
  // .matches(/[A-Z]/, "Must contain at least one uppercase letter")
  // .matches(/[a-z]/, "Must contain at least one lowercase letter")
  // .matches(/[0-9]/, "Must contain at least one number")
  // .matches(/[@$!%*?&#]/, "Must contain at least one special character"),
});
const getAuthResponseData = (response: any) => {
  const responseCandidates = [
    response?.data?.data?.result,
    response?.data?.result,
    response?.data?.data,
    response?.result,
    response?.data,
    response,
  ].filter((candidate) => candidate && typeof candidate === 'object');

  const result =
    responseCandidates.find(
      (candidate) =>
        candidate?.auth ||
        candidate?.token ||
        candidate?.access_token ||
        candidate?.accessToken ||
        candidate?.sip_credentials,
    ) ||
    responseCandidates[0] ||
    {};
  const auth = result?.auth ?? result ?? {};
  const token =
    [
      result?.token,
      result?.access_token,
      result?.accessToken,
      auth?.token,
      auth?.access_token,
      auth?.accessToken,
      ...responseCandidates.flatMap((candidate) => [
        candidate?.token,
        candidate?.access_token,
        candidate?.accessToken,
        candidate?.auth?.token,
        candidate?.auth?.access_token,
        candidate?.auth?.accessToken,
      ]),
      response?.headers?.['x-access-token'],
      String(response?.headers?.authorization || '').replace(/^Bearer\s+/i, ''),
    ]
      .find((candidate) => typeof candidate === 'string' && candidate.trim())
      ?.trim() || '';

  return { result, auth, token };
};

const Login = () => {
  const { mainSiteInfo } = useOrganization();
  const { handleSetUser } = useUser();
  const [showPassword, setShowPassword] = useState(false);
  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Inputs>({
    defaultValues: {
      email: '',
      password: '',
    },
    resolver: yupResolver(schema),
    mode: 'onChange',
  });
  const navigate = useNavigate();
  const signUpResponseData = useRef<any>(null);
  const loginAccessTokenRef = useRef('');
  const googleCredentialRef = useRef('');
  /* Kept so a trusted device can finish sign-in from the /login response alone,
     without a verify-otp round trip. */
  const loginResponseRef = useRef<any>(null);
  /* The choice has to outlive the session it was made in — it is read on the
     next sign-in, before any code is sent. */
  const REMEMBER_DEVICE_KEY = 'ucaas-remember-device';
  const [rememberDevice, setRememberDevice] = useState<boolean>(() => {
    try {
      return localStorage.getItem(REMEMBER_DEVICE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [showOtp, setShowOtp] = useState(false);
  const [showSsoEmail, setShowSsoEmail] = useState(false);
  const [ssoWorkEmail, setSsoWorkEmail] = useState('');
  const [isResolvingSso, setIsResolvingSso] = useState(false);
  const [otp, setOtp] = useState('');
  const [formData, setFormData] = useState<{ email: string; password: string }>();
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [largeLogoError, setLargeLogoError] = useState(false);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const canSubmit = isLocalhost || Boolean(captchaToken);

  useEffect(() => {
    setLargeLogoError(false);
  }, [mainSiteInfo?.large_logo]);

  // Handle the enterprise SSO redirect back from the backend
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get('sso_token');
      const err = sp.get('sso_error');
      const signupTok = sp.get('sso_signup');
      if (signupTok) {
        try { sessionStorage.setItem('sso_signup', JSON.stringify({ email: sp.get('email') || '', name: sp.get('name') || '', token: signupTok })); } catch (e2) {}
        window.history.replaceState({}, '', window.location.pathname);
        navigate('/pricing');
        return;
      }
      if (t) {
        localStorage.setItem(SESSION_NAME, t);
        window.history.replaceState({}, '', window.location.pathname);
        window.location.reload();
        return;
      }
      if (err) {
        const em = sp.get('email') || '';
        const msg = err === 'no_account'
          ? `No account found for ${em || 'this email'}. Please contact your administrator.`
          : 'SSO sign-in failed. Please try again.';
        handleAlert({ text: msg, type: 'error' });
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If user already has plan-pending token, send them to renew-plan (no re-login)
  useEffect(() => {
    if (
      localStorage.getItem(SESSION_NAME) &&
      localStorage.getItem(PLAN_PENDING_FLAG_KEY) === 'true'
    ) {
      sessionStorage.setItem(RENEW_PLAN_FROM_APP_KEY, '1');
      navigate('/renew-plan', { replace: true });
    }
  }, [navigate]);

  const { mutate: mutateLogin, isPending: isLoginPending } = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      setCaptchaToken(null);
      turnstileRef.current?.reset();
      const { auth, token } = getAuthResponseData(data);
      loginAccessTokenRef.current = token;
      loginResponseRef.current = data;
      signUpResponseData.current = {
        ...auth,
        ...(token ? { token } : {}),
      };
      const email = auth?.email;
      if (email)
        mutateSendOtp({
          email,
          device_id: getDeviceId(),
          remember_device: rememberDevice,
        });
    },
    onError: (err: any) => {
      const data = err?.response?.data || {};
      const inner = data?.data || {};
      const message = typeof data?.message === 'string' ? data.message : '';
      const planPaymentPending =
        data?.plan_payment_pending === true || inner?.plan_payment_pending === true;
      const token = inner?.token || data?.token;

      if (token && planPaymentPending && message?.toLowerCase().includes('no longer active')) {
        localStorage.setItem(SESSION_NAME, token);
        localStorage.setItem(PLAN_PENDING_FLAG_KEY, 'true');
        const companyUuid = inner?.company_uuid || data?.company_uuid;
        if (companyUuid) {
          sessionStorage.setItem(PLAN_PENDING_COMPANY_UUID_KEY, companyUuid);
        }
        handleAlert({
          text:
            message ||
            'Your current plan is no longer active. Please renew to avoid service interruptions.',
          type: 'error',
        });
        sessionStorage.setItem(RENEW_PLAN_FROM_APP_KEY, '1');
        navigate('/renew-plan', { replace: true });
        return;
      }
      console.log({ err });
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    },
  });
  // const { mutate: mutateFinalLogin, isPending: isFinalLoginPending } = useMutation({
  //   mutationFn: login,
  //   onSuccess: (data) => {
  //     console.log(data?.data?.data?.result?.auth, 'data?.data?.data?.result?.auth');

  //     const userData = data?.data?.data?.result;
  //     const auth = data?.data?.data?.result?.auth;
  //     signUpResponseData.current = auth;

  //     const isPlanPaymentPending =
  //       auth?.isPlanPaymentPending === true || auth?.isPlanPayemntPending === true;
  //     const token = auth?.token || data?.data?.data?.result?.token;

  //     if (token && isPlanPaymentPending) {
  //       const msg =
  //         data?.data?.data?.message ||
  //         'Your current plan is no longer active. Please renew to avoid service interruptions.';
  //       localStorage.setItem(SESSION_NAME, token);
  //       if (auth?.company_uuid) {
  //         sessionStorage.setItem(PLAN_PENDING_COMPANY_UUID_KEY, auth.company_uuid);
  //       }
  //       handleAlert({ text: msg, type: 'error' });
  //       sessionStorage.setItem(RENEW_PLAN_FROM_APP_KEY, '1');
  //       navigate('/renew-plan', { replace: true });
  //       return;
  //     }

  //     const paymentVerified = auth?.payment_verified;
  //     const freeDID = auth?.free_did;

  //     if (!paymentVerified) {
  //       navigate(`/payment`, {
  //         state: {
  //           isLogin: true,
  //           signUpResponseData,
  //         },
  //       });
  //     } else if (paymentVerified && !freeDID) {
  //       navigate('/phone-lines', {
  //         state: {
  //           isLogin: true,
  //           signUpResponseData,
  //         },
  //       });
  //     } else {
  //       sessionStorage.setItem('welcomePopup', 'true');
  //       handleSetUser(userData);
  //       window.location.reload();
  //       // navigate('/dashboard')
  //     }
  //   },
  //   onError: (err: any) => {
  //     const data = err?.response?.data || {};
  //     const inner = data?.data || {};
  //     const message = typeof data?.message === 'string' ? data.message : '';
  //     const planPaymentPending =
  //       data?.plan_payment_pending === true || inner?.plan_payment_pending === true;
  //     const token = inner?.token || data?.token;

  //     if (token && planPaymentPending && message?.toLowerCase().includes('no longer active')) {
  //       localStorage.setItem(SESSION_NAME, token);
  //       localStorage.setItem(PLAN_PENDING_FLAG_KEY, 'true');
  //       const companyUuid = inner?.company_uuid || data?.company_uuid;
  //       if (companyUuid) {
  //         sessionStorage.setItem(PLAN_PENDING_COMPANY_UUID_KEY, companyUuid);
  //       }
  //       handleAlert({
  //         text:
  //           message ||
  //           'Your current plan is no longer active. Please renew to avoid service interruptions.',
  //         type: 'error',
  //       });
  //       sessionStorage.setItem(RENEW_PLAN_FROM_APP_KEY, '1');
  //       navigate('/renew-plan', { replace: true });
  //       return;
  //     }
  //     console.log({ err });
  //   },
  // });
  /* Finishes sign-in once identity is settled — either the code was verified, or
     the server recognised this device and skipped the code. Both paths land here
     so they route identically. */
  const finishSignIn = (data: any) => {
    const {
      result: userData,
      auth: verifiedAuth,
      token: verifiedToken,
    } = getAuthResponseData(data);
    const token =
      verifiedToken ||
      String(signUpResponseData.current?.token || loginAccessTokenRef.current || '').trim();
    const auth = {
      ...(signUpResponseData.current || {}),
      ...verifiedAuth,
      ...(token ? { token } : {}),
    };

    signUpResponseData.current = {
      ...auth,
      ...(token ? { token } : {}),
    };

    if (token) {
      localStorage.setItem(SESSION_NAME, token);
    }

    const isPlanPaymentPending =
      auth?.isPlanPaymentPending === true || auth?.isPlanPayemntPending === true;

    if (token && isPlanPaymentPending) {
      const msg =
        data?.data?.data?.message ||
        'Your current plan is no longer active. Please renew to avoid service interruptions.';
      localStorage.setItem(SESSION_NAME, token);
      if (auth?.company_uuid) {
        sessionStorage.setItem(PLAN_PENDING_COMPANY_UUID_KEY, auth.company_uuid);
      }
      handleAlert({ text: msg, type: 'error' });
      sessionStorage.setItem(RENEW_PLAN_FROM_APP_KEY, '1');
      navigate('/renew-plan', { replace: true });
      return;
    }

    const paymentVerified = auth?.payment_verified;
    const freeDID = auth?.free_did;

    if (!paymentVerified) {
      navigate(`/payment`, {
        state: {
          isLogin: true,
          signUpResponseData,
          accessToken: token,
          planUuid: auth?.plan_uuid,
        },
      });
    } else if (paymentVerified && !freeDID) {
      navigate('/phone-lines', {
        state: {
          isLogin: true,
          signUpResponseData,
          accessToken: token,
          planUuid: auth?.plan_uuid,
        },
      });
    } else {
      sessionStorage.setItem('welcomePopup', 'true');
      handleSetUser({ ...userData, token });
      window.location.reload();
    }
  };

  const { mutate: mutateSendOtp, isPending: isSendOtpPending } = useMutation({
    mutationFn: sendOtp,
    onSuccess: (data: any) => {
      /* The server skips the code on a device that passed one recently. */
      const payload = (data as any)?.data ?? {};
      const otpRequired = payload?.otp_required ?? payload?.data?.otp_required;

      if (otpRequired === false) {
        handleAlert({ text: 'Signed in on a recognised device', type: 'success' });
        finishSignIn(loginResponseRef.current);
        return;
      }

      handleAlert({ text: 'OTP sent successfully', type: 'success' });
      setShowOtp(true);
    },
  });
  const { mutate: mutateVerifyOtp, isPending: isPendingVerifyOtp } = useMutation({
    mutationFn: verifyOtp,
    onSuccess: (data: any) => {
      handleAlert({ text: 'OTP Verified successfully', type: 'success' });
      finishSignIn(data);
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

  const { mutate: mutateGoogleLogin } = useMutation({
    mutationFn: googleLogin,
    onSuccess: (data: any) => {
      handleAlert({ text: 'Signed in with Google', type: 'success' });
      finishSignIn(data);
    },
    onError: (err: any) => {
      const res = err?.response?.data;
      if (res?.code === 'SSO_NEW_USER') {
        try {
          sessionStorage.setItem('google_signup', JSON.stringify({ email: res?.email || '', name: res?.name || '', credential: googleCredentialRef.current }));
        } catch (e) {}
        handleAlert({ text: 'Let\u2019s set up your account', type: 'success' });
        navigate('/pricing');
        return;
      }
      handleAlert({ text: res?.message || 'Google sign-in failed', type: 'error' });
    },
  });
  const handleSsoContinue = async () => {
    const email = ssoWorkEmail.trim();
    if (!email) return;
    setIsResolvingSso(true);
    try {
      const org = localStorage.getItem('org_uuid') || '';
      const resp = await fetch(
        `${getEnv().VITE_API_BASE_URL}/api/auth/sso/resolve?email=${encodeURIComponent(email)}&website_uuid=${encodeURIComponent(org)}`,
      );
      const data = await resp.json();
      if (!data?.found) {
        handleAlert({ text: 'No account found for that email. Contact your administrator.', type: 'error' });
        setIsResolvingSso(false);
        return;
      }
      if (data?.method === 'saml' && data?.company_uuid) {
        window.location.href = `${getEnv().VITE_API_BASE_URL}/api/auth/sso/saml/${encodeURIComponent(data.company_uuid)}/login`;
        return;
      }
      handleAlert({
        text: "Your company hasn't enabled SSO yet. Contact your administrator, or sign in with your password.",
        type: 'error',
      });
      setIsResolvingSso(false);
    } catch (e) {
      handleAlert({ text: 'Could not start SSO. Please try again.', type: 'error' });
      setIsResolvingSso(false);
    }
  };

  const handleGoogleCredential = (credential?: string) => {
    if (!credential) {
      handleAlert({ text: 'Google sign-in was cancelled', type: 'error' });
      return;
    }
    googleCredentialRef.current = credential;
    mutateGoogleLogin({
      credential,
      device_type: 'W',
      device_id: getDeviceId(),
      version: packageJson.version,
    });
  };

  const handleVerify = () => {
    if (!formData) return;
    if (!isPendingVerifyOtp && otp?.length === 6)
      mutateVerifyOtp({ email: formData?.email, otp, device_id: getDeviceId() });
  };

  const onSubmit: SubmitHandler<Inputs> = (data) => {
    if (!canSubmit) return;

    setFormData(data);
    const payload = {
      ...data,
      device_type: 'W',
      device_id: getDeviceId(),
      version: packageJson.version,
      ...(captchaToken ? { captchaToken } : {}),
    };
    mutateLogin(payload);
  };

  return (
    <>
      {!showSsoEmail && (
      <div className="w-full h-full p-4 md:p-15 md:py-6 bg-gray-200/15 flex items-center justify-center">
        <div className="w-full lg:max-w-[60%] xxl:max-w-[70%] flex sm:flex-row flex-col xs:h-full sm:h-auto md:h-full rounded-xl bg-white shadow-sm overflow-auto">
          <section className="w-full sm:w-1/2 h-full">
            <div className="mx-auto p-5 xl:p-8 h-full flex flex-col gap-3">
              <div className="h-8">
                <img
                  src={
                    mainSiteInfo?.large_logo
                      ? `${getEnv().VITE_API_BASE_URL}/${mainSiteInfo?.large_logo}`
                      : Logo
                  }
                  alt="Logo"
                  className="h-full"
                />
              </div>
              <div className="flex flex-col justify-center items-center m-auto">
                <div className="w-full flex flex-col gap-2 xl:gap-8">
                  {!showSsoEmail && (
                  <>
                  <div className="flex flex-col gap-1 xl:gap-3">
                    <h1 className="text-base xl:text-2xl  text-gray-900 font-bold">
                      Log in to your account
                    </h1>
                    <h6 className="text-sm xl:text-base text-gray-500 font-normal">
                      Welcome back! Please enter your details.
                    </h6>
                  </div>
                  <div className="flex flex-col gap-4">
                    <form
                      className="flex flex-col gap-1 xl:gap-5"
                      onSubmit={handleSubmit(onSubmit)}
                    >
                      <div className="flex flex-col gap-5">
                        <div className="flex flex-col gap-1.5">
                          <Label>Email</Label>
                          <Controller
                            name="email"
                            control={control}
                            render={({ field }) => (
                              <Input
                                placeholder="Enter Your Email"
                                type="email"
                                {...field}
                                error={errors.email?.message || ''}
                              />
                            )}
                          />
                        </div>
                        <div className="w-full flex flex-col gap-2">
                          <div className="flex flex-col gap-1.5">
                            <Label>Password</Label>
                            <Controller
                              name="password"
                              control={control}
                              render={({ field }) => (
                                <Input
                                  placeholder="Enter Your Password"
                                  type={showPassword ? 'text' : 'password'}
                                  {...field}
                                  Icon={
                                    showPassword ? (
                                      <Icon name="EyeLineOff" />
                                    ) : (
                                      <Icon name="EyeLine" />
                                    )
                                  }
                                  onIconClick={() => setShowPassword((prev) => !prev)}
                                  error={errors.password?.message || ''}
                                />
                              )}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <Checkbox
                                className="cursor-pointer"
                                checked={rememberDevice}
                                onCheckedChange={(value) => {
                                  const next = value === true;
                                  setRememberDevice(next);
                                  try {
                                    localStorage.setItem(REMEMBER_DEVICE_KEY, next ? '1' : '0');
                                  } catch {
                                    /* private mode — the choice just won't persist */
                                  }
                                }}
                              />
                              <span className="text-sm text-gray-600">
                                Skip the code on this device for 30 days
                              </span>
                            </label>
                            <div
                              className="text-primary hover:text-primary/80 text-sm font-semibold cursor-pointer whitespace-nowrap"
                              onClick={() => navigate('/forgot-password')}
                            >
                              Forgot password
                            </div>
                          </div>
                        </div>
                      </div>
                      {!isLocalhost && (
                        <Turnstile
                          ref={turnstileRef}
                          action="login"
                          className="w-full"
                          onVerify={setCaptchaToken}
                          onExpire={() => setCaptchaToken(null)}
                          onError={() => setCaptchaToken(null)}
                        />
                      )}

                      {canSubmit && (
                        <Button
                          variant={'primary'}
                          type="submit"
                          className="w-full rounded-xl"
                          disabled={isSendOtpPending || isLoginPending}
                        >
                          {isSendOtpPending || isLoginPending ? (
                            <Loader variant="blue" />
                          ) : (
                            'Sign In'
                          )}
                        </Button>
                      )}
                    </form>
                    <div className="flex items-center gap-3 my-3">
                      <span className="h-px flex-1 bg-gray-200" />
                      <span className="text-xs text-gray-500">or</span>
                      <span className="h-px flex-1 bg-gray-200" />
                    </div>
                    <div className="w-full flex justify-center">
                      <GoogleLogin
                        onSuccess={(cred) => handleGoogleCredential(cred?.credential)}
                        onError={() => handleAlert({ text: 'Google sign-in failed', type: 'error' })}
                        text="signin_with"
                        shape="rectangular"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSsoEmail(true)}
                      className="w-full mt-3 flex items-center justify-center gap-3 rounded-lg border border-[#dadce0] bg-white h-[42px] text-sm font-medium text-[#3c4043] shadow-sm hover:bg-gray-50 transition-colors"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      Login via SSO
                    </button>
                  </div>
                  </>
                  )}
                  {showSsoEmail && (
                    <div className="w-full flex flex-col gap-6">
                      <button
                        type="button"
                        data-testid="ssoStepBackArrow"
                        onClick={() => { setShowSsoEmail(false); setSsoWorkEmail(''); }}
                        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 w-fit"
                      >
                        <ArrowLeft size={18} />
                        Back
                      </button>
                      <div className="flex flex-col gap-1 xl:gap-3">
                        <h1 className="text-base xl:text-2xl text-gray-900 font-bold">
                          Login via SSO
                        </h1>
                        <h6 className="text-sm xl:text-base text-gray-500 font-normal">
                          Enter your work email to continue to your company's sign-in page.
                        </h6>
                      </div>
                      <div className="flex flex-col gap-4">
                        <Input
                          type="email"
                          autoFocus
                          label="Work email"
                          placeholder="you@yourcompany.com"
                          value={ssoWorkEmail}
                          onChange={(e) => setSsoWorkEmail(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSsoContinue(); } }}
                        />
                        <Button
                          variant={'primary'}
                          type="button"
                          className="w-full rounded-xl"
                          disabled={isResolvingSso || !ssoWorkEmail.trim()}
                          onClick={handleSsoContinue}
                        >
                          {isResolvingSso ? <Loader variant="blue" /> : 'Continue'}
                        </Button>
                      </div>
                    </div>
                  )}

                  <p className="text-xs xl:text-sm text-gray-800 font-normal">
                    By creating new account, you automatically agree to our
                    <a
                      target="_blank"
                      href="https://www.mycountrymobile.com/terms-and-conditions/"
                      className="text-primary hover:text-primary/80 font-bold"
                    >
                      &nbsp;Terms & Conditions
                    </a>
                    &nbsp;and
                    <a
                      target="_blank"
                      href="https://www.mycountrymobile.com/privacy-policy/"
                      className="text-primary hover:text-primary/80 font-bold"
                    >
                      &nbsp;Privacy Policy
                    </a>
                  </p>

                  <p className="text-xs xl:text-sm text-gray-800 font-normal text-center">
                    Don’t have an account?
                    <span
                      className="text-primary hover:text-primary/80 font-semibold cursor-pointer"
                      onClick={() => navigate('/pricing')}
                      // onClick={() => navigate('/phone-lines')}
                    >
                      &nbsp;Sign up&nbsp;
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </section>
          {/* bg-sky-200/30 */}
          <section className="w-full sm:w-1/2 bg-ucass-login-bg sm:overflow-hidden">
            <div className="mx-auto pt-8 h-full flex flex-col gap-10 justify-between">
              <div className="flex flex-col gap-3 px-8">
                <h2 className="text-gray-900 font-bold text-base xl:text-2xl ">
                  Enterprise Communication Solutions
                </h2>

                <p className="text-gray-700 text-sm">
                  Connect with your customers through our reliable and scalable communication
                  platform.
                </p>
                <div className="grid grid-cols-2 gap-2 xl:gap-3">
                  <div className="flex gap-2 items-center">
                    <span className="bg-green-500 text-white w-5 h-5 rounded-full p-1 flex items-center justify-center">
                      <Check />
                    </span>
                    <p className="text-gray-900 text-xs xxl:text-sm font-semibold">
                      Secure Communication
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className="bg-green-500 text-white w-5 h-5 rounded-full p-1 flex items-center justify-center">
                      <Check />
                    </span>
                    <p className="text-gray-900 text-xs xxl:text-sm font-semibold">Global Reach</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className="bg-green-500 text-white w-5 h-5 rounded-full p-1 flex items-center justify-center">
                      <Check />
                    </span>
                    <p className="text-gray-900 text-xs xxl:text-sm font-semibold">
                      Scalable Solutions
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className="bg-green-500 text-white w-5 h-5 rounded-full p-1 flex items-center justify-center">
                      <Check />
                    </span>
                    <p className="text-gray-900 text-xs xxl:text-sm font-semibold">24/7 Support</p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end pl-8">
                <div className="w-full">
                  <img
                    src={
                      mainSiteInfo?.login_image && !largeLogoError
                        ? `${getEnv().VITE_API_BASE_URL}/${mainSiteInfo?.login_image}`
                        : Desktop
                    }
                    alt="Desktop"
                    className="w-full rounded-br-xl rounded-tl-xl"
                    onError={() => setLargeLogoError(true)}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
      )}
      {showSsoEmail && (
        <div
          data-testid="ssoStandaloneScreen"
          className="w-full h-full p-4 flex items-center justify-center bg-gray-200/15"
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-sm p-6 xl:p-10 flex flex-col items-center gap-6">
            <img
              src={
                mainSiteInfo?.large_logo
                  ? `${getEnv().VITE_API_BASE_URL}/${mainSiteInfo?.large_logo}`
                  : Logo
              }
              alt="Logo"
              className="h-8"
            />
            <div className="flex flex-col items-center gap-1 text-center">
              <h1 className="text-xl xl:text-2xl text-gray-900 font-bold">Login via SSO</h1>
              <h6 className="text-sm text-gray-500 font-normal">
                Enter your work email to continue to your company&apos;s sign-in page.
              </h6>
            </div>
            <div className="w-full flex flex-col gap-4">
              <Input
                type="email"
                autoFocus
                label="Work email"
                placeholder="you@yourcompany.com"
                value={ssoWorkEmail}
                onChange={(e) => setSsoWorkEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSsoContinue();
                  }
                }}
              />
              <Button
                variant={'primary'}
                type="button"
                className="w-full rounded-xl"
                disabled={isResolvingSso || !ssoWorkEmail.trim()}
                onClick={handleSsoContinue}
              >
                {isResolvingSso ? <Loader variant="blue" /> : 'Continue with SSO'}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowSsoEmail(false);
                setSsoWorkEmail('');
              }}
              className="text-sm font-medium text-primary hover:text-primary/80"
            >
              Login via Password
            </button>
          </div>
        </div>
      )}
      <Dialog open={showOtp} onOpenChange={setShowOtp}>
        <DialogContent
          className="w-full md:w-2/5 p-3"
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <OtpVerification
            {...{
              otp,
              setOtp,
              formData: formData,
              apiLoading: isPendingVerifyOtp,
              onConfirm: () => handleVerify(),
              remainingAttempts,
              handleClose: () => {
                setShowOtp(false);
                setOtp('');
                setRemainingAttempts(null);
              },
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Login;
