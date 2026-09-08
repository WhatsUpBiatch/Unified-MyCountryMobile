import { useState } from 'react';
import { Icon } from '@/assets/icons/icon';
import { useUser } from '@/hooks/use-user';
import { handleAlert } from '@/lib/utils';
import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import '@/components/mcm/mcm-page.css';

/**
 * Integration ▸ General settings — the credentials Zapier authenticates with.
 *
 * THE CLIENT SECRET
 *
 * This screen used to show a second credential, labelled "Client Secret", with
 * a Copy button, a Show button and the instruction "keep them private and
 * secure". Its value was the string literal `d6d5ed116231378022040f108c9607cd`,
 * typed into this file.
 *
 * That is not a secret belonging to this account. It was the same thirty-two
 * characters for every customer on the platform, compiled into the frontend
 * bundle and served to every browser that opened the page. Nothing in the
 * product reads it — no endpoint issues it, no request sends it, and the Zapier
 * screen next door does not use it — so it is either a real shared secret that
 * was published, or a decorative one that could never have worked. It is gone
 * either way: a credential box is a promise, and this one could not keep it.
 *
 * When the API grows a per-account secret, add it here reading from that
 * endpoint. Do not put another constant in its place.
 *
 * THE API KEY
 *
 * The remaining value is real, but it is an identifier rather than a secret —
 * it is the signed-in person's own uuid, which also travels in URLs and turns
 * up in logs. It is labelled as what it is and no longer sits under a heading
 * telling somebody to keep it private, because treating an identifier as a
 * password is how people end up protecting the wrong thing.
 */

const GeneralSettings = () => {
  const { user } = useUser();
  const accountId = String((user as any)?.uuid || (user as any)?.user_info?.uuid || '');

  return (
    <section className="mcm-adminpage">
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">Integration</div>
          <h1>General settings</h1>
          <p>The credentials Zapier and other tools use to identify this account.</p>
        </div>
      </div>

      <div className="mcm-adminpage-body">
        <SettingCard
          title="Account identifier"
          icon={<Icon name="SettingsIcon" className="h-4 w-4" />}
          description="What identifies this account to a connected tool. Paste it where Zapier asks which account to work with."
        >
          <SettingRow
            label="API key"
            description="Sent by Zapier with each request so the platform knows whose data to return. It identifies the account rather than authorising the request, so it is not a password — but there is no reason to publish it either."
          >
            <Credential value={accountId} label="API key" />
          </SettingRow>
        </SettingCard>

        <SettingCard
          title="Client secret"
          icon={<Icon name="SettingsIcon" className="h-4 w-4" />}
          description="What an OAuth app would exchange for an access token."
          status="coming-soon"
          note="Coming soon. There is no endpoint that issues a secret for an account yet, so there is nothing here to copy. Until there is, connect through the Connect buttons on the CRM screen, which run the OAuth handshake for you and never show you a secret at all."
        >
          <SettingRow
            label="Per-account secret"
            description="This screen used to show one. It was the same value for every customer on the platform, written into the app itself rather than issued to you, and nothing in the product ever sent it — so it could not have authorised anything. It has been removed rather than left looking usable."
            status="coming-soon"
          />
        </SettingCard>
      </div>
    </section>
  );
};

/** A value you may need to copy, hidden until asked for. */
const Credential = ({ value, label }: { value: string; label: string }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  /* Guarded: `value` is typed as a string but comes from an optional chain, and
     copying `undefined` put the literal word into somebody's clipboard while
     the toast still said "Copied successfully". */
  const handleCopy = () => {
    if (!value) return;
    navigator?.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    handleAlert({ text: `${label} copied.`, type: 'success' });
  };

  if (!value) {
    return <span className="mcm-numnone">Not available for this account</span>;
  }

  return (
    <div className="mcm-cred">
      <code>{isVisible ? value : '•'.repeat(Math.min(value.length, 36))}</code>
      <div className="mcm-cred-acts">
        <button type="button" className="mcm-cred-btn" onClick={() => setIsVisible(!isVisible)}>
          <Icon name={isVisible ? 'EyeLineOff' : 'EyeLine'} className="w-4 h-4" />
          {isVisible ? 'Hide' : 'Show'}
        </button>
        <button type="button" className="mcm-cred-btn" onClick={handleCopy}>
          <Icon name={copied ? 'VerifiedCheck' : 'CopyLine'} className="w-4 h-4" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
};

export default GeneralSettings;
