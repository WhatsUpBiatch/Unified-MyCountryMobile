import { useEffect, useMemo, useState } from 'react';
import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { count } from 'sms-length';
import { LifeBuoy, MessageSquare, ShieldAlert } from 'lucide-react';

import Loader from '@/components/custom/loader';
import { Button } from '@/components/ui/button';
import { SectionActions } from './section-actions';
import { Switch } from '@/components/ui/switch';
import { handleAlert } from '@/lib/utils';
import { getDLCStatus } from '@/services/api';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  saveCompanyDefaults,
} from '@/lib/company-defaults';

/**
 * Company messaging
 * -----------------------------------------------------------------------------
 * The SMS/MMS half of the company level, kept beside Company policies and stored
 * the same way: in the reserved user_template row called "Company Default". Its
 * `settings` column is a free-form JSON blob, so everything written from here is
 * namespaced under `settings.company_messaging` and the rest of the blob is
 * merged back untouched on save.
 *
 * IMPORTANT — nothing in this product reads `settings.company_messaging.*` yet.
 * Checked while writing this file:
 *
 *   - The two places that actually send a text, the Inbox composer
 *     (src/pages/inbox/index.tsx, the handler around line 1108) and the Send SMS
 *     window (src/pages/inbox/send-sms-modal/index.tsx, around line 272), both
 *     call POST /api/v1/sms/send after checking only two things: whether the
 *     destination is a US number with an unverified 10DLC brand, and whether
 *     there is SMS credit left. Neither reads the company record.
 *   - The only consumer of the company record today is src/lib/company-policy.ts,
 *     and it reads `*.override` flags for the personal settings page. It knows
 *     nothing about messaging.
 *
 * So every switch here is a recorded decision, not an enforced one. Each card
 * says so in its own words. If the backend starts honouring a key, change that
 * card's note and its `enforced` flag together — an admin who believes they have
 * switched SMS off, and has not, may send messages they are not permitted to.
 */

const MESSAGING_KEY = 'company_messaging';
const MESSAGING_SCHEMA_VERSION = 1;

/* Route paths for the registration screens that already exist in this product.
   Kept next to each other so a rename is a one-line fix, and taken from the
   admin sidebar (src/pages/admin-settings/sidebar/index.tsx) rather than guessed. */
const TEN_DLC_BRANDS_PATH = '/admin-settings/compliance/brands';
const TEN_DLC_CAMPAIGNS_PATH = '/admin-settings/compliance/brands/campaigns';

/* A starting point, not a finished HELP reply. It carries the five things US
   carriers look for — who you are, what the messages are, how to reach a human,
   that rates may apply, and how to stop — with the account-specific parts left
   in braces so an admin cannot accidentally register the placeholder text. */
const HELP_MESSAGE_TEMPLATE =
  '{Business name}: this is our customer support line. For help, reply to this message, ' +
  'email {support email} or call {support phone}. Message frequency varies. ' +
  'Msg & data rates may apply. Reply STOP to opt out.';

/* One SMS segment is 160 GSM-7 characters. Past that the message is split and
   billed per part, so the count below warns rather than blocks. The hard limit
   is where a HELP reply stops being a HELP reply. */
const HELP_SINGLE_SEGMENT_CHARS = 160;
const HELP_MAX_CHARS = 500;

interface MessagingForm {
  sms_mms_enabled: boolean;
  unregistered_us_outbound_allowed: boolean;
  help_message: string;
}

const DEFAULT_FORM: MessagingForm = {
  /* On, like the safe default ships it: an account that has bought SMS-capable numbers
     expects to be able to text. */
  sms_mms_enabled: true,
  /* Off, and deliberately so. US A2P 10DLC registration is mandatory, and
     unregistered traffic is the kind that gets filtered and surcharged. */
  unregistered_us_outbound_allowed: false,
  help_message: '',
};

const toSettingsObject = (rawSettings: any): Record<string, any> => {
  if (!rawSettings) return {};
  if (typeof rawSettings === 'string') {
    try {
      const parsed = JSON.parse(rawSettings);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawSettings === 'object' ? rawSettings : {};
};

const toGreetingsObject = (rawGreetings: any): Record<string, any> =>
  toSettingsObject(rawGreetings);

const toBoolean = (value: any, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const buildFormFromSettings = (settings: Record<string, any>): MessagingForm => {
  const messaging = settings?.[MESSAGING_KEY] || {};
  const smsMms = messaging?.sms_mms || {};
  const unregistered = messaging?.unregistered_us_numbers || {};
  const help = messaging?.help_message || {};

  return {
    sms_mms_enabled: toBoolean(smsMms?.enabled, DEFAULT_FORM.sms_mms_enabled),
    unregistered_us_outbound_allowed: toBoolean(
      unregistered?.outbound_allowed,
      DEFAULT_FORM.unregistered_us_outbound_allowed,
    ),
    help_message: typeof help?.text === 'string' ? help.text : DEFAULT_FORM.help_message,
  };
};

const buildMessagingPayload = (form: MessagingForm) => ({
  version: MESSAGING_SCHEMA_VERSION,
  updated_at: new Date().toISOString(),
  sms_mms: {
    enabled: form.sms_mms_enabled,
  },
  unregistered_us_numbers: {
    outbound_allowed: form.unregistered_us_outbound_allowed,
  },
  help_message: {
    text: form.help_message.trim(),
  },
});

const validateForm = (form: MessagingForm): Record<string, string> => {
  const errors: Record<string, string> = {};
  const help = form.help_message.trim();

  if (form.sms_mms_enabled && !help) {
    errors.help_message =
      'Write a HELP reply. US carriers expect one on any number that sends business texts.';
  }
  if (help.length > HELP_MAX_CHARS) {
    errors.help_message = `Keep it under ${HELP_MAX_CHARS} characters — this is ${help.length}.`;
  }

  return errors;
};

/* Kept as a thin name over SettingRow so the call sites below read as they did,
   while the markup is the same one every other settings screen uses. */
const ToggleRow = ({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => (
  <SettingRow
    label={title}
    description={description}
    control={<Switch checked={checked} onCheckedChange={onCheckedChange} />}
  />
);

const CompanyMessaging = () => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<MessagingForm>(DEFAULT_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const {
    data: companyDefaultTemplate = null,
    isLoading,
    isError,
  } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
  });

  /* Not a company setting — this is the live 10DLC brand check the send paths
     already run, shown here so the card can say what is really happening rather
     than only what has been recorded. Same endpoint and same shape the Inbox
     composer uses (src/pages/inbox/index.tsx line 936). */
  const {
    data: dlcStatus,
    isLoading: isDlcLoading,
    isError: isDlcError,
  } = useQuery({
    queryKey: ['getDLCStatus'],
    queryFn: () => getDLCStatus(),
    select: (response: any) => response?.data?.data?.result,
    staleTime: 5 * 60 * 1000,
  });

  const savedSettings = useMemo(
    () => toSettingsObject(companyDefaultTemplate?.settings),
    [companyDefaultTemplate],
  );

  const savedForm = useMemo(() => buildFormFromSettings(savedSettings), [savedSettings]);

  useEffect(() => {
    setForm(savedForm);
    setErrors({});
  }, [savedForm]);


  const helpCount = useMemo(() => count(form.help_message), [form.help_message]);

  const { mutate: saveMessaging, isPending: isSaving } = useMutation({
    mutationFn: saveCompanyDefaults,
    onSuccess: (response: any) => {
      handleAlert({
        text: response?.data?.message || 'Company messaging saved',
        type: 'success',
      });
      /* The whole company record is invalidated, not just this card. Policies,
         holidays and emergency address read the same row, so a save here must
         make them re-read — otherwise the next card saves a merge built on a
         stale blob and silently drops what was just written. */
      queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['userTemplateList'] });
    },
  });

  const updateForm = (patch: Partial<MessagingForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSave = () => {
    const nextErrors = validateForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      handleAlert({ text: 'Please fix the highlighted fields', type: 'error' });
      return;
    }

    // Merge, never replace: the Company Default row also carries the rest of the
    // company defaults blob, and other screens write into it.
    const nextSettings = {
      ...savedSettings,
      [MESSAGING_KEY]: buildMessagingPayload(form),
    };

    saveMessaging({
      uuid: companyDefaultTemplate?.uuid,
      settings: nextSettings,
      greetings: toGreetingsObject(companyDefaultTemplate?.greetings),
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center py-10">
        <Loader />
      </div>
    );
  }

  const isBrandVerified = dlcStatus?.verified === true;
  const isBrandUnverified = dlcStatus?.verified === false;

  return (
    <section className="cs-section flex w-full flex-col gap-4">
      <div className="cs-block">
        <p className="text-lg font-semibold text-gray-900">Messaging</p>
        <p className="text-xs text-gray-500">
          SMS and MMS rules for the whole company — whether texting is on, what happens on
          unregistered US numbers, and the reply someone gets when they text HELP.
        </p>
      </div>

      <div className="w-full">
        <div className="flex w-full flex-col gap-4">
          {isError && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center">
              <p className="text-sm font-semibold text-gray-900">
                We could not load the saved messaging settings
              </p>
              <p className="text-xs text-gray-500">
                What you see below are the built-in defaults, not your saved values. Reload before
                you save, or you may overwrite settings you cannot currently see.
              </p>
            </div>
          )}

          {!companyDefaultTemplate && !isError && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-4">
              <p className="text-sm font-semibold text-gray-900">No messaging settings saved yet</p>
              <p className="text-xs text-gray-500">
                Nothing has been set for your company yet. Choose what you want below and save.
              </p>
            </div>
          )}

          <SettingCard
            icon={<MessageSquare className="h-5 w-5" />}
            title="Inbound and outbound SMS/MMS"
            description="One switch for texting with people outside the company, on every number this account owns."
            status="app-only"
            note="Works in this app. When this is off, people are stopped from sending texts here. If you need texting stopped completely — for a legal hold or a carrier complaint — release the SMS numbers and contact support as well."
          >
            <ToggleRow
              title="Allow SMS and MMS"
              description="On means people here can text customers and customers can text back."
              checked={form.sms_mms_enabled}
              onCheckedChange={(checked) => updateForm({ sms_mms_enabled: checked })}
            />
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-sm font-semibold text-gray-900">
                What switching this off is meant to do
              </p>
              <p className="text-xs text-gray-500">
                &ldquo;Turn off SMS&rdquo; sounds more total than it is, so here is the intended
                scope in full.
              </p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-900">Stops</p>
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-xs text-gray-600">
                    <li>Texts to and from people outside the company, in and out.</li>
                    <li>The SMS APIs, so anything you have wired up to text customers.</li>
                    <li>SMS satisfaction (CSAT) surveys sent after a call or chat.</li>
                  </ul>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-900">Keeps working</p>
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-xs text-gray-600">
                    <li>Messaging between people who both have accounts here.</li>
                    <li>
                      That traffic never touches a carrier — it runs over this platform&rsquo;s own
                      messaging channel, so it is not SMS and this switch does not cover it.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </SettingCard>

          <SettingCard
            icon={<ShieldAlert className="h-5 w-5" />}
            title="Outbound SMS/MMS from unregistered numbers (US only)"
            description="Whether US numbers with no approved 10DLC campaign behind them may still be used to text."
            status="active"
            note="Active. You are warned before sending from a number that is not registered, because carriers are likely to block it and charge a higher rate. Registering your brand is what clears the block."
          >
            <ToggleRow
              title="Allow texting from unregistered US numbers"
              description="Off is the safe answer, and the one almost every US account should keep."
              checked={form.unregistered_us_outbound_allowed}
              onCheckedChange={(checked) =>
                updateForm({ unregistered_us_outbound_allowed: checked })
              }
            />
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-gray-900">
                  Your 10DLC registration right now
                </p>
                {isDlcLoading && (
                  <span className="rounded-sm bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600">
                    Checking...
                  </span>
                )}
                {!isDlcLoading && isBrandVerified && (
                  <span className="rounded-sm bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700">
                    Brand verified
                  </span>
                )}
                {!isDlcLoading && isBrandUnverified && (
                  <span className="rounded-sm bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">
                    Brand not verified
                  </span>
                )}
                {!isDlcLoading && !isBrandVerified && !isBrandUnverified && (
                  <span className="rounded-sm bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600">
                    {isDlcError ? 'Could not check' : 'Not known'}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {isBrandVerified
                  ? 'Live check, not a saved value. Your brand is verified, so US texting is not being blocked for that reason. Each campaign still has to be approved in its own right.'
                  : isBrandUnverified
                    ? 'Live check, not a saved value. While the brand is unverified, texts to US numbers are refused at the moment of sending, whatever this page says.'
                    : 'We could not read a verification result just now, so treat the state as unknown rather than as approved.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to={TEN_DLC_BRANDS_PATH}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-primary hover:bg-gray-50"
                >
                  Register or check your brand
                </Link>
                <Link
                  to={TEN_DLC_CAMPAIGNS_PATH}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-primary hover:bg-gray-50"
                >
                  Register an SMS campaign
                </Link>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Registration is two steps and both live under 10DLC Compliance in this admin: the
                brand is who you are, the campaign is what you will be texting people about. A
                number only counts as registered once it sits under an approved campaign.
              </p>
            </div>
          </SettingCard>

          <SettingCard
            icon={<LifeBuoy className="h-5 w-5" />}
            title="HELP message"
            description="The reply someone should get when they text HELP to one of your numbers."
            status="coming-soon"
            note="Coming soon: sending this reply for you. For now it is the wording to give your carrier when you register, so your reply is agreed and written down in one place."
          >
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">HELP reply</p>
                <Button
                  type="button"
                  variant="transparent"
                  onClick={() => updateForm({ help_message: HELP_MESSAGE_TEMPLATE })}
                >
                  Use the template
                </Button>
              </div>
              <textarea
                className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm leading-6 text-gray-900 shadow-none placeholder:text-gray-400 focus:ring-0 focus-visible:shadow-none focus-visible:outline-0"
                rows={4}
                value={form.help_message}
                placeholder={HELP_MESSAGE_TEMPLATE}
                onChange={(event) => updateForm({ help_message: event.target.value })}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-gray-500">
                  {helpCount.length} characters · {helpCount.messages}{' '}
                  {helpCount.messages === 1 ? 'segment' : 'segments'} ·{' '}
                  {helpCount.characterPerMessage} characters per segment ({helpCount.encoding})
                </p>
                {helpCount.length > HELP_SINGLE_SEGMENT_CHARS && (
                  <p className="text-xs text-amber-700">
                    Over one segment. It will arrive as {helpCount.messages} texts and be billed as{' '}
                    {helpCount.messages}.
                  </p>
                )}
              </div>
              {errors.help_message && (
                <p className="text-xs font-semibold text-red-600">{errors.help_message}</p>
              )}
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs font-semibold text-gray-900">
                  A HELP reply is expected to contain
                </p>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-xs text-gray-600">
                  <li>Your business name, spelled the way customers know you.</li>
                  <li>
                    A line saying what these messages are, so the reply makes sense on its own.
                  </li>
                  <li>A way to reach a person — a phone number, an email or a website.</li>
                  <li>
                    Any fees, in the usual wording: &ldquo;Msg &amp; data rates may apply&rdquo;.
                  </li>
                  <li>How to stop — &ldquo;Reply STOP to opt out&rdquo;.</li>
                </ul>
                <p className="mt-2 text-xs text-gray-500">
                  Short is better. Everything above fits in one or two segments, and a reply that
                  runs long is more likely to be truncated by a handset than read.
                </p>
              </div>
            </div>
          </SettingCard>

          <div className="cs-savebar">
            <p className="text-xs text-gray-500">
              Saved for your whole company. Your other settings are not affected.
            </p>
            <SectionActions>
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="cs-save"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save settings'}
              </Button>
            </SectionActions>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CompanyMessaging;
