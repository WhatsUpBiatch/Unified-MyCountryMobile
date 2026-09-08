import { useState } from 'react';
import { Instagram } from '@/assets/icons';
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

/* Card, status, switch and disconnect are shared — see channel-card.tsx.
   Instagram's setup has two prerequisites of its own, which is why it keeps a
   dialog rather than connecting straight away. */

const InstagramChannel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user } = useUser();

  const handleConnect = () => {
    connectMetaChannel('instagram', setLoading, user?.company_info?.uuid);
  };

  return (
    <ChannelCard
      title="Instagram"
      description="Connect your Instagram Business account and set up chat on your page."
      icon={<Instagram className="w-6 h-6" />}
      types={['instagram']}
      onOpenSetup={() => setIsOpen(true)}
      onManage={handleConnect}
    >
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="w-[620px] max-w-[95vw] max-h-[90vh] overflow-y-auto p-0 border-gray-200">
          <div className="p-6 flex flex-col gap-5">
            <DialogHeader className="gap-2 text-left">
              <DialogTitle>Instagram setup</DialogTitle>
              <DialogDescription>
                Exchange messages and Story reactions with your Instagram followers. Facebook
                Messenger comes with it, so your Facebook followers are covered too.
              </DialogDescription>
            </DialogHeader>

            {/* Two things have to be true before the connect will succeed, so
                they are stated before the button rather than under it. They
                used to sit below, as links that went nowhere:
                `href="javascript:void(0)"`, four of them on this screen alone. */}
            <div className="mcm-chan-req">
              <p>Before connecting, on Instagram:</p>
              <ol>
                <li>Switch the account from Creator to Business.</li>
                <li>Link that Business account to a Facebook page.</li>
              </ol>
            </div>

            <Button onClick={handleConnect} disabled={loading} className="self-start">
              {loading ? 'Connecting…' : 'Connect Instagram'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ChannelCard>
  );
};

export default InstagramChannel;
