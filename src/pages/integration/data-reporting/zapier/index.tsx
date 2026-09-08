import { useState } from 'react';
import ZapierViewModal from '../modal/ZapierViewModal';
import { ChevronIcon } from '@/assets/icons';
import { crmZapData, reportingData } from '../../constant';
import '@/components/mcm/mcm-page.css';

/**
 * Integration ▸ Zapier — the prebuilt Zap templates on offer, per tool.
 *
 * Nothing on this page connects anything. Each card opens a list of templates,
 * and every one of those links out to zapier.com to be set up there. The cards
 * said "Connect" anyway, which is the same word the CRM screen next door uses
 * for a button that really does start an OAuth handshake — so two screens in
 * the same section used one verb for two different things, and only one of them
 * was true.
 */

const Zapier = () => {
  const zapierItems = reportingData['zapier']?.items;
  const [modalOpen, setModalOpen] = useState<string | null>(null);

  return (
    <section className="mcm-intpage">
      <div className="mcm-intpage-head">
        <div className="mcm-intpage-eyebrow">Integration</div>
        <h1>Zapier</h1>
        <p>Send console events into Zapier so they can trigger workflows in your other tools.</p>
      </div>
      <div className="mcm-intgrid">
        {zapierItems?.map((item) => {
          /* How many templates are behind the card. A card that opens a list
             should say how long the list is; four cards that all read the same
             gave no reason to open one before another. */
          const count = crmZapData[item?.id]?.zaps?.length || 0;
          return (
            <div key={item.id} className="mcm-intcard">
              <div className="flex flex-col gap-5 w-full">
                <div className="flex flex-col gap-2">
                  <span className="mcm-intcard-mark">
                    <img src={item.icon} alt={item.title} />
                  </span>
                  <div className="mcm-intcard-t">
                    <h4>{item.title}</h4>
                    {count ? (
                      <span className="mcm-zap-n">
                        {count} zap{count === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </div>
                  <p className="mcm-intcard-d">{item.description}</p>
                </div>
              </div>
              {/* A button, not a div with a click handler — this was the only
                  way into the templates and it could not be reached from a
                  keyboard. */}
              <button
                type="button"
                className="mcm-intcard-go"
                onClick={() => setModalOpen(item?.id)}
              >
                See zaps
                <ChevronIcon className="-rotate-90" />
              </button>
            </div>
          );
        })}
      </div>
      {modalOpen && (
        <ZapierViewModal
          handleClose={() => setModalOpen(null)}
          modalOpen={modalOpen}
          setModalOpen={setModalOpen}
        />
      )}
    </section>
  );
};

export default Zapier;
