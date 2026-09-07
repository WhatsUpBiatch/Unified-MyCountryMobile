import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { handleAlert } from '@/lib/utils';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import {
  FORWARDING_TAB_CONSTANT,
  greetingsInitialState,
} from '@/pages/admin-settings/constants';
import PersonalGreetings from './personal-greetings';
import '@/components/mcm/mcm-page.css';
import { upsertUserSettingsSchema } from '@/pages/admin-settings/people/update-forwarding/schema';
import { getUserDetails, updateUserSettings } from '@/services/api';
import { yupResolver } from '@hookform/resolvers/yup';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

type GreetingValue = {
  label?: string;
  value?: string;
};

type GreetingItem = {
  enabled?: boolean;
  value?: GreetingValue;
};

type GreetingsMap = Record<string, GreetingItem>;

type GreetingKey = 'welcome_greeting' | 'voicemail' | 'ring_tone' | 'on_hold_music';

interface GreetingField {
  enabled: boolean;
  override: boolean; // <-- you were missing this
  value: {
    label: string;
    value: string;
  };
}

type GreetingsForm = Record<GreetingKey, GreetingField>;

const Greetings = () => {
  // const breadcrumbData = [{ label: 'Settings' }, { label: 'Greetings' }];
  const [schemaContext, setSchemaContext] = useState<any>(null);
  const hasHydratedGreetingsRef = useRef(false);
  const methods = useForm({
    mode: 'all',
    defaultValues: { greetings: greetingsInitialState },
    resolver: yupResolver(upsertUserSettingsSchema[FORWARDING_TAB_CONSTANT.GREETING_NOTIFICATION]),
    context: { schemaContext },
  });
  const queryClient: any = useQueryClient();

  const { data: userInfoData } = useQuery({
    queryKey: ['getUserDetailsForGreetings'],
    queryFn: getUserDetails,
    select: (data) => data?.data?.data?.result,
  });

  const { handleSubmit, reset, watch } = methods;
  const { dirtyFields } = methods.formState;
  const { mutate: mutateGreetingSettings, isPending: PendingGreetingSetting } = useMutation({
    mutationFn: updateUserSettings,
    onSuccess: () => {
      handleAlert({
        text: 'Greeting Setting updated successfully!',
        type: 'success',
      });
      queryClient.invalidateQueries(['getUserDetailsForGreetings', 'getUsersDetails'], {
        exact: true,
      });
      invalidateGlobalUsersDirectory(queryClient);
    },
  });

  const onSubmit = () => {
    const greetings: any = watch('greetings');
    const greetingsRequest = {
      welcome: getGreetingConfig('welcome_greeting', greetings),
      voicemail: getGreetingConfig('voicemail', greetings),
      ring_tone: getGreetingConfig('ring_tone', greetings),
      hold: getGreetingConfig('on_hold_music', greetings),
    };

    const payload = {
      key: 'greetings',
      value: greetingsRequest,
    };
    mutateGreetingSettings(payload);
  };

  const getGreetingConfig = (
    key: string,
    greetings: GreetingsMap,
  ): { enabled?: boolean; label?: string; value?: string } => ({
    enabled: greetings?.[key]?.enabled,
    label: greetings?.[key]?.value?.label,
    value: greetings?.[key]?.value?.value,
  });

  useEffect(() => {
    if (!userInfoData || hasHydratedGreetingsRef.current) return;

    const greetingInfo =
      typeof userInfoData.greetings === 'string'
        ? JSON.parse(userInfoData.greetings)
        : (userInfoData.greetings ?? {});

    const keys: GreetingKey[] = ['welcome_greeting', 'voicemail', 'ring_tone', 'on_hold_music'];

    const formattedGreetings = keys.reduce<GreetingsForm>((acc, key) => {
      const apiKey =
        key === 'welcome_greeting' ? 'welcome' : key === 'on_hold_music' ? 'hold' : key;
      const target = greetingInfo?.[key] || greetingInfo?.[apiKey];
      acc[key] = {
        enabled: !!target?.enabled,
        override: !!target?.override,
        value: {
          label: target?.label ?? '',
          value: target?.value ?? '',
        },
      };
      return acc;
    }, {} as GreetingsForm);

    hasHydratedGreetingsRef.current = true;
    reset(
      { greetings: formattedGreetings },
      {
        keepDirtyValues: true,
      },
    );
  }, [dirtyFields, reset, userInfoData]);

  useEffect(() => {
    const subscription = watch((value) => {
      setSchemaContext(value);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  return (
    <>
      <section className="mcm-adminpage mcm-greet">
        <div className="mcm-adminpage-head">
          <div className="mcm-adminpage-title">
            <div className="mcm-adminpage-eyebrow">My account</div>
            <h1>Greetings</h1>
            {/* The switch plays the person's voicemail greeting on a direct
                call (patch of 3 Sep 2026); the other three slots are still
                saved and not read, so the subtitle keeps the two apart. */}
            <p>
              Your welcome message, hold music, voicemail greeting and ring tone. Callers hear your
              voicemail greeting today. The other three are saved for when the switch plays them.{' '}
              <Link to="/admin-settings/phone/media?mine=1">Your recordings in the media library</Link>
            </p>
          </div>
        </div>
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="mcm-greet-form">
            <div className="mcm-greet-scroll">
              <PersonalGreetings customClass="" />
            </div>
            <div className="mcm-greet-foot">
              <Button variant={'primary'} type="submit" disabled={PendingGreetingSetting}>
                {PendingGreetingSetting ? 'Please wait...' : 'Save greetings'}
              </Button>
            </div>
          </form>
        </FormProvider>
      </section>
    </>
  );
};

export default Greetings;
