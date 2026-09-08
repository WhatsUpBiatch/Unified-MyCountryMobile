import { useEffect, useState } from 'react';
import { TelegramIcon } from '@/assets/icons';
import Loader from '@/components/custom/loader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { handleAlert } from '@/lib/utils';
import { integrateSocialMediaChannel } from '@/services/api';
import { yupResolver } from '@hookform/resolvers/yup';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { telegramChannelInitialValues, telegramChannelSchema } from '../constants';
import { useUser } from '@/hooks/use-user';
import ChannelCard, { useChannel } from '../channel-card';

/* Card, status, switch and disconnect are shared — see channel-card.tsx.
   Telegram is the one channel that is not an OAuth handshake: it takes a bot
   username and token typed in by hand, so it keeps a real form. */

const TelegramChannel = () => {
  const { user } = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const { channel: telegramData } = useChannel(['telegram'], 'Telegram');
  const isConnected = Boolean(telegramData);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<any>({
    defaultValues: telegramChannelInitialValues,
    resolver: yupResolver(telegramChannelSchema),
    mode: 'onChange',
  });

  /* The form shows what is stored when reopened, so "Update" starts from the
     current bot rather than from blank fields. */
  useEffect(() => {
    reset({
      username: telegramData?.username || '',
      token: telegramData?.token || '',
    });
  }, [telegramData, reset, isOpen]);

  const { mutate: mutateIntegrate, isPending } = useMutation({
    mutationKey: ['integrateSocialMediaChannel'],
    mutationFn: integrateSocialMediaChannel,
    onSuccess: (data: any) => {
      handleAlert({
        text: data?.data?.message || `Bot ${isConnected ? 'updated' : 'added'}.`,
        type: 'success',
      });
      setIsOpen(false);
      queryClient.invalidateQueries({ queryKey: ['getSocialMediaChannelList'] });
    },
  });

  const onSubmit = (data: any) => {
    const { token = '', username = '' } = data || {};

    const currentUserMember = {
      email: user?.user_info?.email || user?.email || '',
      domain: String(user?.sip_credentials?.domain || user?.user_info?.domain || '').trim(),
      fullName:
        `${user?.first_name || user?.user_info?.first_name || ''} ${user?.last_name || user?.user_info?.last_name || ''}`.trim() ||
        user?.name ||
        user?.user_info?.name ||
        '',
      userUuid: user?.uuid || user?.user_info?.uuid || '',
      extension: user?.extension || user?.user_info?.extension || '',
      companyUuid: user?.company_info?.uuid || user?.company_uuid || '',
    };

    /* The stored members list arrives as an array or as JSON, and the caller
       must not be dropped from it by reconnecting. */
    let existingMembers: any[] = [];
    const raw = telegramData?.channel_members;
    if (Array.isArray(raw)) existingMembers = raw;
    else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        existingMembers = Array.isArray(parsed) ? parsed : [];
      } catch {
        existingMembers = [];
      }
    }

    const alreadyThere = existingMembers.some((m: any) => m?.userUuid === currentUserMember.userUuid);

    mutateIntegrate({
      type: 'telegram',
      token,
      username,
      channel_members: alreadyThere ? existingMembers : [...existingMembers, currentUserMember],
    });
  };

  return (
    <ChannelCard
      title="Telegram"
      description="Connect your Telegram bot to enable automated messaging and manage conversations in real time."
      icon={<TelegramIcon className="w-6 h-6" />}
      types={['telegram']}
      matchName="Telegram"
      onOpenSetup={() => setIsOpen(true)}
    >
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="w-[520px] max-w-[95vw] p-0 overflow-hidden border-gray-200">
          <div className="p-6 flex flex-col gap-5">
            <DialogHeader className="gap-2 text-left">
              <DialogTitle>Telegram setup</DialogTitle>
              <DialogDescription>
                Telegram is connected through a bot you own, so it needs the bot&rsquo;s username
                and token rather than a sign-in.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div className="mcm-chan-req">
                <p>To get these, in Telegram:</p>
                <ol>
                  <li>
                    Search for <b>@BotFather</b> and send it <b>/newbot</b>.
                  </li>
                  <li>It replies with the bot&rsquo;s username and token. Paste both below.</li>
                </ol>
              </div>

              <Controller
                name="username"
                control={control}
                render={({ field }) => (
                  <Input
                    {...field}
                    label="Bot username"
                    placeholder="mycompany_support_bot"
                    error={errors?.username?.message as string}
                  />
                )}
              />
              <Controller
                name="token"
                control={control}
                render={({ field }) => (
                  <Input
                    {...field}
                    label="Bot token"
                    placeholder="123456789:AAF..."
                    error={errors?.token?.message as string}
                  />
                )}
              />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isPending}>
                  {isPending && <Loader variant="blue" />}
                  {isConnected ? 'Update bot' : 'Connect bot'}
                </Button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </ChannelCard>
  );
};

export default TelegramChannel;
