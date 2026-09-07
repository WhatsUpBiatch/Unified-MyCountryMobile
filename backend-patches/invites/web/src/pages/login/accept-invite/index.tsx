/* Accept an invite: the public page a new person lands on from the e-mail link.
 *
 * URL: /accept-invite?token=...  (registered next to /reset-password in
 * router/index.tsx). The page asks the server what the link is, shows the
 * person's name and e-mail, and lets them choose a password. Rule: 12 or more
 * characters, not their e-mail address, typed twice the same.
 *
 * Accepting does not sign them in - the login screen has its own checks
 * (code by e-mail, device memory) that the invite endpoint does not repeat.
 * After success they are sent to the login screen with their e-mail shown.
 */
import LogoIcon from '@/assets/images/LogoIcon.svg';
import Desktop from '@/assets/images/Desktop.svg';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { EyeLine, EyeLineOff } from '@/assets/icons';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import * as yup from 'yup';
import { acceptInvite, inspectInvite } from '@/services/api';
import { getEnv, handleAlert } from '@/lib/utils';
import Loader from '@/components/custom/loader';
import { useOrganization } from '@/hooks/use-organisation';
import CheckIcon from '@/assets/images/Check.svg';

export const INVITE_MIN_PASSWORD_LENGTH = 12;

type InviteState = 'loading' | 'ok' | 'invalid' | 'expired' | 'accepted' | 'error';

interface InviteInfo {
  ok?: boolean;
  state?: InviteState;
  expired?: boolean;
  name?: string;
  email?: string;
  min_password_length?: number;
  ttl_hours?: number;
}

const buildSchema = (email: string) =>
  yup.object({
    password: yup
      .string()
      .required('Please choose a password')
      .min(
        INVITE_MIN_PASSWORD_LENGTH,
        `Your password must be at least ${INVITE_MIN_PASSWORD_LENGTH} characters long`,
      )
      .test(
        'not-email',
        'Your password cannot be your e-mail address',
        (value) => !email || String(value || '').toLowerCase() !== email.toLowerCase(),
      ),
    confirm_password: yup
      .string()
      .required('Please type your password again')
      .oneOf([yup.ref('password')], 'Both passwords must be the same'),
  });

const RuleLine = ({ met, text }: { met: boolean; text: string }) => (
  <li
    className={`flex items-center gap-2 transition-all ${met ? 'text-green-400' : 'text-gray-300'}`}
  >
    <img
      src={CheckIcon}
      alt=""
      className={`w-4 h-4 transition-opacity ${met ? 'opacity-100' : 'opacity-30'}`}
    />
    {text}
  </li>
);

const AcceptInvite = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { mainSiteInfo } = useOrganization();
  const token = new URLSearchParams(location.search).get('token') || '';
  const [showPassword, setShowPassword] = useState<{ password: boolean; confirm: boolean }>({
    password: false,
    confirm: false,
  });
  const [largeLogoError, setLargeLogoError] = useState(false);

  useEffect(() => {
    setLargeLogoError(false);
  }, [mainSiteInfo?.large_logo]);

  const {
    data: inspectData,
    isLoading: isInspecting,
    isError: inspectFailed,
  } = useQuery({
    queryKey: ['inspectInvite', token],
    queryFn: () => inspectInvite({ token }),
    enabled: Boolean(token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const info: InviteInfo = inspectData?.data?.data?.result || {};
  const email = info.email || '';
  const days = Math.max(1, Math.round((info.ttl_hours || 72) / 24));

  let state: InviteState = 'loading';
  if (!token) state = 'invalid';
  else if (inspectFailed) state = 'error';
  else if (!isInspecting) state = info.ok ? 'ok' : (info.state as InviteState) || 'invalid';

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: { password: '', confirm_password: '' },
    resolver: yupResolver(buildSchema(email)),
    mode: 'onChange',
  });

  const password = watch('password');
  const confirm = watch('confirm_password');

  const { mutate: accept, isPending } = useMutation({
    mutationFn: acceptInvite,
    onSuccess: (response: any) => {
      handleAlert({
        text: response?.data?.data?.message || 'Your password is set. You can log in now.',
        type: 'success',
      });
      navigate('/', { replace: true, state: { email } });
    },
  });

  const onSubmit = (values: { password: string }) => {
    accept({ token, password: values.password });
  };

  const renderBody = () => {
    if (state === 'loading') {
      return (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader variant="blue" />
          <p className="text-sm text-grey-800">Checking your link...</p>
        </div>
      );
    }

    if (state === 'ok') {
      return (
        <form
          className="flex flex-col gap-6"
          onSubmit={handleSubmit(onSubmit)}
          data-testid="accept-invite-form"
        >
          <div className="flex flex-col gap-3">
            <h1 className="text-4xl text-black font-semibold">Welcome, {info.name || 'there'}</h1>
            <h6 className="text-base text-grey-800 font-normal">
              Choose a password for <span className="font-semibold text-black">{email}</span>.
              You will use it to log in.
            </h6>
          </div>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Input
                onIconClick={() => setShowPassword((p) => ({ ...p, password: !p.password }))}
                Icon={showPassword.password ? <EyeLineOff /> : <EyeLine />}
                placeholder="Choose a password"
                label="Password"
                type={showPassword.password ? 'text' : 'password'}
                autoComplete="new-password"
                {...register('password')}
                error={errors?.password?.message}
              />
              <ul className="list-inside text-sm font-medium flex flex-col gap-2 pb-1.5">
                <RuleLine
                  met={(password || '').length >= INVITE_MIN_PASSWORD_LENGTH}
                  text={`At least ${INVITE_MIN_PASSWORD_LENGTH} characters`}
                />
                <RuleLine
                  met={Boolean(password) && password.toLowerCase() !== email.toLowerCase()}
                  text="Not your e-mail address"
                />
                <RuleLine
                  met={Boolean(password) && password === confirm}
                  text="Both passwords are the same"
                />
              </ul>
            </div>
            <Input
              onIconClick={() => setShowPassword((p) => ({ ...p, confirm: !p.confirm }))}
              Icon={showPassword.confirm ? <EyeLineOff /> : <EyeLine />}
              placeholder="Type it again"
              label="Confirm password"
              type={showPassword.confirm ? 'text' : 'password'}
              autoComplete="new-password"
              {...register('confirm_password')}
              error={errors?.confirm_password?.message}
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? <Loader variant="blue" /> : 'Set my password'}
          </Button>
          <p className="text-xs text-grey-800 text-center">
            This link works for {days} day{days === 1 ? '' : 's'} from when it was sent.
          </p>
        </form>
      );
    }

    const copy: Record<Exclude<InviteState, 'loading' | 'ok'>, { title: string; text: string }> = {
      invalid: {
        title: 'This link is not valid',
        text: 'Check that you opened the full link from your e-mail. If it still does not work, ask the person who added you to send a new one.',
      },
      expired: {
        title: 'This link has expired',
        text: `An invite link works for ${days} day${days === 1 ? '' : 's'}. Ask the person who added you to send a new one.`,
      },
      accepted: {
        title: 'This link has already been used',
        text: 'You have already chosen a password. You can log in with it.',
      },
      error: {
        title: 'We could not check your link',
        text: 'Please try again in a moment. If it keeps failing, ask the person who added you to send a new link.',
      },
    };
    const { title, text } = copy[state];

    return (
      <div className="flex flex-col gap-6" data-testid={`accept-invite-${state}`}>
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl text-black font-semibold">{title}</h1>
          {info.name && (
            <p className="text-base text-grey-800">
              This link was for {info.name}
              {email ? ` (${email})` : ''}.
            </p>
          )}
          <h6 className="text-base text-grey-800 font-normal">{text}</h6>
        </div>
        <Button type="button" onClick={() => navigate('/')}>
          Go to log in
        </Button>
      </div>
    );
  };

  return (
    <div className="w-full flex md:min-h-screen xs:min-h-0">
      <section className="sm:w-5/12 xs:w-full">
        <div className="container mx-auto p-8 max-w-full">
          <div className="h-8 cursor-pointer" onClick={() => navigate('/')}>
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
          <div className="pt-16 sm:min-h-[calc(100vh_-_6rem)] xs:min-h-0 flex flex-col justify-center items-center">
            <div className="flex flex-col xxl:w-2/3 xl:w-3/4 lg:w-4/5 md:w-11/12 xs:w-full gap-8">
              {renderBody()}
              <p className="text-sm text-grey-800 font-normal text-center">
                Already have a password?
                <span
                  className="text-primary hover:text-primary/80 font-semibold cursor-pointer"
                  onClick={() => navigate('/')}
                >
                  &nbsp;Log in&nbsp;
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="w-7/12 bg-ucass-gray overflow-hidden sm:block xs:hidden">
        <div className="flex flex-col justify-between h-screen xl:gap-10 xs:gap-8">
          <div className="container m-auto pt-8 md:px-24 sm:px-8">
            <div className="flex flex-col gap-6">
              <h2 className="text-gray-900 font-medium text-3xl leading-10">
                One password, chosen by you. Nobody else ever sees it.
              </h2>
            </div>
          </div>
          <div className="container ml-auto md:pl-24 sm:pl-8">
            <div className="flex justify-end">
              <div className="w-full">
                <img
                  src={
                    mainSiteInfo?.login_image && !largeLogoError
                      ? `${getEnv().VITE_API_BASE_URL}/${mainSiteInfo?.login_image}`
                      : Desktop
                  }
                  alt="Desktop"
                  className="w-full"
                  onError={() => setLargeLogoError(true)}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AcceptInvite;
