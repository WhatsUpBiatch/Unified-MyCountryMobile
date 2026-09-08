import { ReactNode, useState } from 'react';
import { ConnectIcon, SettingsLine, Warning } from '@/assets/icons';
import { CircleCheckIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import Loader from '@/components/custom/loader';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changeOmniStatus, deleteOmniChannel, getSocialMediaChannelList } from '@/services/api';
import { handleAlert } from '@/lib/utils';
import '@/components/mcm/mcm-page.css';

/**
 * One social channel, on the Social Media Channels screen.
 *
 * The four channels were four files of roughly 250-380 lines that differed only
 * in their icon, their copy, the `type` they matched on, and the body of their
 * setup dialog. Everything else — the same list query, the same status strip,
 * the same Active switch, the same Connect / Manage / Delete row, and a
 * byte-for-byte identical Delete dialog — was written out four times. They had
 * already drifted: Facebook matched two type strings where Instagram matched
 * one, Telegram additionally required a `name` of exactly "Telegram", and the
 * per-render console.log in each printed a different label.
 *
 * The card lives here once. The setup dialog is what genuinely differs, so it
 * stays with its channel and is handed in.
 */

export interface ChannelCardProps {
  /** What this network is called on screen. */
  title: string;
  /** One sentence saying what connecting it does. */
  description: string;
  icon: ReactNode;
  /** The `type` values a row for this channel can carry. */
  types: string[];
  /** Whether this channel's rows must also match a name. Telegram's do. */
  matchName?: string;
  /** Opens the channel's own setup flow. */
  onOpenSetup: () => void;
  /** Re-runs the connect handshake for a channel already connected. */
  onManage?: () => void;
  /** The setup dialog itself, rendered by the channel that owns it. */
  children?: ReactNode;
}

export const useChannel = (types: string[], matchName?: string) => {
  const { data: channelList = [], isLoading } = useQuery({
    queryKey: ['getSocialMediaChannelList'],
    queryFn: () => getSocialMediaChannelList(),
    /* Guarded: the four copies each did `|| []`, which lets any truthy
       non-array through to `.find` and throws during render. */
    select: (data: any) => {
      const result = data?.data?.data?.result;
      return Array.isArray(result) ? result : [];
    },
  });

  const channel = channelList.find(
    (item: any) =>
      types.includes(String(item?.type || '')) && (!matchName || item?.name === matchName),
  );

  return { channel, isLoading };
};

const ChannelCard = ({
  title,
  description,
  icon,
  types,
  matchName,
  onOpenSetup,
  onManage,
  children,
}: ChannelCardProps) => {
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const queryClient = useQueryClient();
  const { channel, isLoading } = useChannel(types, matchName);
  const isConnected = Boolean(channel);
  const isActive = channel?.status === 1;

  const { mutate: mutateStatusChange } = useMutation({
    mutationFn: changeOmniStatus,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['getSocialMediaChannelList'] }),
  });

  const { mutate: mutateDeleteChannel, isPending: isDeleting } = useMutation({
    mutationFn: deleteOmniChannel,
    onSuccess: () => {
      handleAlert({ text: `${title} disconnected.`, type: 'success' });
      setIsDeleteOpen(false);
      queryClient.invalidateQueries({ queryKey: ['getSocialMediaChannelList'] });
    },
    onError: (error: any) => {
      handleAlert({
        text: error?.response?.data?.message || 'Failed to delete channel',
        type: 'error',
      });
    },
  });

  /* Three states, not two. A channel that is connected but switched off was
     drawn exactly like one running normally — the only difference was the
     position of a switch at the far corner of the card — so a paused channel
     read as a working one and nobody would look for it here. */
  const state = !isConnected ? 'off' : isActive ? 'on' : 'paused';

  return (
    <div className={`mcm-chan is-${state}`}>
      <div className="mcm-chan-h">
        <span className="mcm-chan-mark">{icon}</span>
        <div className="mcm-chan-id">
          <h6>{title}</h6>
          {isConnected && channel?.name ? <span>{channel.name}</span> : null}
        </div>
      </div>

      <p className="mcm-chan-d">{description}</p>

      {isLoading ? (
        <div className="mcm-chan-state">
          <Loader variant="blue" />
        </div>
      ) : (
        <div className={`mcm-chan-state is-${state}`}>
          {isConnected ? <CircleCheckIcon className="w-4 h-4" /> : <Warning className="w-4 h-4" />}
          <span>
            {state === 'on'
              ? 'Connected and running'
              : state === 'paused'
                ? 'Connected, but paused'
                : 'Setup required'}
          </span>
        </div>
      )}

      <div className="mcm-chan-foot">
        {!isConnected ? (
          /* A button. This was a div with a click handler, while the card
             around it claimed `role="button"` and had no onClick at all — so
             the card announced itself as clickable and was not, and the thing
             that did work could not be reached by keyboard. */
          <button type="button" className="mcm-chan-go" onClick={onOpenSetup}>
            <ConnectIcon className="w-4 h-4" />
            Connect account
          </button>
        ) : (
          <div className="mcm-chan-acts">
            <button
              type="button"
              className="mcm-chan-go"
              onClick={() => (onManage ? onManage() : onOpenSetup())}
            >
              <SettingsLine className="w-4 h-4" />
              Manage settings
            </button>
            <button
              type="button"
              className="mcm-chan-del"
              onClick={() => setIsDeleteOpen(true)}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        )}

        <label className="mcm-chan-sw">
          <span>Active</span>
          <Switch
            disabled={!isConnected}
            checked={isActive}
            aria-label={`${title} active`}
            onCheckedChange={(checked) => {
              if (channel?.uuid) {
                mutateStatusChange({ uuid: channel.uuid, status: checked ? 1 : 0 });
              }
            }}
          />
        </label>
      </div>

      {children}

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="w-[400px] max-w-[95vw] p-6 border-gray-200">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold">Disconnect {title}</h3>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              Conversations already in the inbox stay there, but no new messages will arrive from
              this account until it is connected again. This cannot be undone from here.
            </p>
            <div className="flex justify-end gap-3 mt-2">
              <Button variant="outline" onClick={() => setIsDeleteOpen(false)} disabled={isDeleting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => channel?.uuid && mutateDeleteChannel({ uuid: channel.uuid })}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeleting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChannelCard;
