import { useState } from 'react';
import { FacebookIcon } from '@/assets/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { connectMetaChannel } from '@/lib/utils';
import { useUser } from '@/hooks/use-user';
import ChannelCard from '../channel-card';

/* The card, the status strip, the switch and the delete dialog are shared —
   see channel-card.tsx. What is left here is the one thing Facebook does
   differently: its own setup flow. */

const FacebookChannel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user } = useUser();

  const handleConnect = () => {
    connectMetaChannel('messenger', setLoading, user?.company_info?.uuid);
  };

  return (
    <ChannelCard
      title="Facebook Comments & Messenger"
      description="Connect your Facebook Business account and set up Messenger for your page."
      icon={<FacebookIcon className="w-6 h-6" />}
      /* Two type strings: a row for this channel comes back as either. */
      types={['messenger', 'facebook']}
      onOpenSetup={() => setIsOpen(true)}
      onManage={handleConnect}
    >
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="w-[520px] max-w-[95vw] p-0 overflow-hidden border-gray-200">
          <div className="p-6 flex flex-col gap-5">
            <DialogHeader className="gap-2 text-left">
              <DialogTitle>Facebook setup</DialogTitle>
              <DialogDescription>
                Connect your Facebook Business account and set up Messenger for your page.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-start gap-5">
              <Button onClick={handleConnect} disabled={loading}>
                {loading ? 'Connecting…' : 'Connect Facebook page'}
              </Button>
              <p className="text-sm text-gray-600">
                You must be an admin of the page to connect it.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ChannelCard>
  );
};

export default FacebookChannel;
