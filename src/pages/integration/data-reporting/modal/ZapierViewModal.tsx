import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { crmZapData, McmLogo, getMcmLogoIcon } from '@/pages/integration/constant';
import { useOrganization } from '@/hooks/use-organisation';
import '@/components/mcm/mcm-page.css';

/**
 * The prebuilt Zap templates for one tool.
 *
 * Every row leaves for zapier.com, which the rows did not say — "Use this Zap"
 * on a plain outline button reads as something that happens here. Each one is
 * a real link now, so it can be middle-clicked, copied, and read out as a link
 * by a screen reader, and it says where it goes.
 */

const ZapierViewModal = ({
  modalOpen,
  handleClose,
  setModalOpen,
}: {
  modalOpen: string;
  handleClose: () => void;
  setModalOpen: (val: string | null) => void;
}) => {
  const { mainSiteInfo } = useOrganization();
  const data = crmZapData[modalOpen];

  return (
    <Dialog open={!!modalOpen} onOpenChange={(val) => !val && setModalOpen(null)}>
      {/* The close control was a div with a click handler, next to
          `showCloseButton={false}` which had switched off the real one. The
          dialog's own button is back: it is focusable, it is labelled, and
          Escape already worked through it. */}
      <DialogContent className="max-w-2xl p-4">
        <DialogTitle className="mcm-zap-h">
          {data?.title || 'Zaps'}
          <span>Each one opens in Zapier, where you finish setting it up.</span>
        </DialogTitle>

        <ul className="mcm-zaps">
          {data?.zaps?.map((zap) => (
            <li key={zap.url} className="mcm-zap">
              <span className="mcm-zap-icons" aria-hidden="true">
                {zap?.icons?.map((icon, i) => (
                  <img
                    key={i}
                    src={icon === McmLogo ? getMcmLogoIcon(mainSiteInfo) : icon}
                    alt=""
                  />
                ))}
              </span>
              <span className="mcm-zap-t">
                <b>{zap.label}</b>
                {/* Which way the data moves. Source on the left, matching the
                    icon order beside it. */}
                <span>{zap.subtitle}</span>
              </span>
              <a
                className="mcm-zap-go"
                href={zap.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleClose}
              >
                Open in Zapier
              </a>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
};

export default ZapierViewModal;
