import { useCompanyFeatures } from '@/hooks/rbac';
import TelegramChannel from './telegram-channel';
import WhatsappChannel from './whatsapp-channel';
import InstagramChannel from './instagram-channel';
import FacebookChannel from './facebook-channel';
import '@/components/mcm/mcm-page.css';

const SocialMediaChannels = () => {
  const { features } = useCompanyFeatures();
  const omniAccess = features?.plan_features?.omni_channel?.access || {};

  return (
    <section className="mcm-intpage">
      <div className="mcm-intpage-head">
        <div className="mcm-intpage-eyebrow">Channels</div>
        <h1>Social media channels</h1>
        <p>
          The WhatsApp, Instagram, Facebook and Telegram accounts customers can reach you on. Their
          conversations arrive in the same inbox as everything else.
        </p>
      </div>

      {/* The blue notice that used to sit here said, at greater length, what
          the description above now says: connect your accounts, chat in one
          place. Two explanations of the same thing stacked, the second styled
          as a notice. */}
      <div className="mcm-intgrid">
        {omniAccess?.FACEBOOK ? <FacebookChannel /> : null}
        {omniAccess?.INSTAGRAM ? <InstagramChannel /> : null}
        {omniAccess?.WHATSAPP ? <WhatsappChannel /> : null}
        {/* Gated like the other three. This read `{true ? <TelegramChannel />`
            with its real gate commented out beside it, and the file carried an
            `eslint-disable no-constant-condition` at the top to keep the lint
            quiet about it — so Telegram showed on plans that do not include it
            while the other three were correctly hidden. */}
        {omniAccess?.TELEGRAM ? <TelegramChannel /> : null}
      </div>
    </section>
  );
};

export default SocialMediaChannels;
