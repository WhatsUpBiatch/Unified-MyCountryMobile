import { useState } from 'react';
import { WhatsappIcon } from '@/assets/icons';
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
   WhatsApp has the longest list of prerequisites of the four, which is the
   whole reason its dialog exists. */

const WhatsappChannel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user } = useUser();

  const handleConnect = () => {
    connectMetaChannel('whatsapp', setLoading, user?.company_info?.uuid);
  };

  return (
    <ChannelCard
      title="WhatsApp"
      description="Create a WhatsApp Business account with 360dialog or Twilio and connect it."
      icon={<WhatsappIcon className="w-6 h-6" />}
      types={['whatsapp']}
      onOpenSetup={() => setIsOpen(true)}
      onManage={handleConnect}
    >
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="w-[620px] max-w-[95vw] max-h-[90vh] overflow-y-auto p-0 border-gray-200">
          <div className="p-6 flex flex-col gap-5">
            <DialogHeader className="gap-2 text-left">
              <DialogTitle>WhatsApp setup</DialogTitle>
              <DialogDescription>
                Chat with customers over WhatsApp from the same inbox as everything else.
              </DialogDescription>
            </DialogHeader>

            {/* Both prerequisites are things Meta requires and this product
                cannot check for you, so they are stated plainly before the
                button rather than buried under it. The links that did not go
                anywhere have been dropped; the ones that do are kept. */}
            <div className="mcm-chan-req">
              <p>Meta requires two things before this will connect:</p>
              <ol>
                <li>
                  Admin access to your Facebook Business Manager account.{' '}
                  <a
                    href="https://www.facebook.com/business/help/2169003770027706?id=2190812977867143"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    How to check
                  </a>
                </li>
                <li>
                  A phone number that can take a verification code by SMS or call.{' '}
                  <a
                    href="https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Which numbers work
                  </a>
                </li>
              </ol>
            </div>

            <Button onClick={handleConnect} disabled={loading} className="self-start">
              {loading ? 'Adding…' : 'Add WhatsApp account'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ChannelCard>
  );
};

export default WhatsappChannel;
