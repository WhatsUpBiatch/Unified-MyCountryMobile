import { useEffect, useMemo, useState } from 'react';
import { SettingCard, SettingNest, SettingRow } from '@/components/mcm/setting-card';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, ScrollText, Voicemail } from 'lucide-react';

import Loader from '@/components/custom/loader';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SectionHeading } from './section-heading';
import { SectionActions } from './section-actions';
import { Switch } from '@/components/ui/switch';
import { handleAlert } from '@/lib/utils';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  saveCompanyDefaults,
} from '@/lib/company-defaults';

/**
 * Company voicemail
 * -----------------------------------------------------------------------------
 * Setting voicemail rules once for the whole organisation is standard in
 * established business phone systems. Here there was no such screen: the
 * company record already
 * carried `settings.voicemail_pin`, other code already read it, but the only
 * editor for it was the per-person dialog. The company-level card that would
 * have written it sits commented out in
 * src/pages/admin-settings/templates/user-settings/add-edit-user-settings/settings/index.tsx
 * (lines 124-157), so the value was displayed and copied around but could never
 * be set at company level. This page is the missing editor.
 *
 * Storage follows the rest of Company info: the reserved user_template row
 * called "Company Default", whose `settings` column is a free-form JSON blob.
 * The EXISTING key is reused — no new namespace — because other code already
 * reads it:
 *
 *   settings.voicemail_pin = {
 *     value:             string,          // the PIN
 *     users:             ISELECTVALUE[],  // shared-voicemail recipients
 *     voicemail_to_text: 'YES' | 'NO',
 *     override:          boolean,
 *   }
 *
 * `users` is not edited here (picking named people as everyone's shared
 * mailbox is a per-person choice, not a company rule) but it is spread through
 * untouched on save, as is the rest of the settings blob.
 *
 * ---------------------------------------------------------------------------
 * WHAT ACTUALLY TAKES EFFECT (grepped when this file was written)
 * ---------------------------------------------------------------------------
 * `override` — REAL. Read by src/lib/company-policy.ts:32
 *   (POLICY_FIELDS.voicemail = 'voicemail_pin.override'), compared at
 *   src/lib/company-policy.ts:74, and consumed by
 *   src/components/common-settings/index.tsx:48 (useCompanyPolicy) through
 *   canEditField, which disables the Voicemail Settings button on a person's
 *   own settings page. It is also read at
 *   src/pages/admin-settings/people/update-forwarding/index.tsx:787,
 *   where a true flag copies this whole voicemail_pin block onto a user when an
 *   admin applies this record as their template.
 *
 * `voicemail_to_text` — STORED. Nothing reads the company copy except the
 *   template-copy path above. The per-person editors
 *   (src/components/common-settings/voicemail-dialog/index.tsx:113-115) read
 *   and write each person's own value, never this one, so changing it here
 *   turns transcription on for nobody who already exists.
 *
 * `value` (the PIN) — STORED, AND NO LONGER EDITED HERE. The control was taken
 *   off this screen because nothing on the switch ever asks for a PIN: grepped
 *   again on 1 Sep 2026 across `save-voicemail.lua`, `read-voicemail.lua` and
 *   `functions.lua`, with no hit. The key itself is left alone — the save
 *   spreads the stored block through untouched rather than writing `value` from
 *   a form that no longer holds it, so an existing PIN is preserved rather than
 *   blanked. Put the control back only alongside a mailbox that asks for one. No screen in this product asks for a voicemail
 *   PIN at any point; the key is only carried between form and record
 *   (src/pages/settings/general/index.tsx:177,
 *   src/components/common-settings/voicemail-dialog/index.tsx:62). Nothing
 *   checks it when a mailbox is opened.
 *
 * Keep those notes honest. If the backend starts acting on a key, change that
 * card's `status` and rewrite its note — a stale reassurance here is worse than
 * no page. "Coming soon" means we have not built it; "In this app only" means
 * the browser does the work and nothing behind it checks again.
 */

const VOICEMAIL_KEY = 'voicemail_pin';

/* WHAT WOULD MAKE THE EMAIL ACTUALLY SEND, checked on the switch 1 Sep 2026.
 * Everything except one hop already exists:
 *
 *   - `notification-api` is running on this box and answers
 *     `POST 127.0.0.1:3002/api/v1/send-email` with `{email, subject, body}`.
 *     It is bound to loopback only, which is right - the switch is a local
 *     caller, and nothing off-box should be able to send mail through it.
 *   - Its SMTP is configured and points at Gmail (`smtp.gmail.com:587`) with a
 *     dedicated sender, `notifications@mycountrymobile.com`.
 *   - `voicemail_save()` in the FreeSWITCH `functions.lua` already holds every
 *     fact the mail needs by the time the caller hangs up: `accountcode`,
 *     `vm_msgfile`, the duration, and the caller's number.
 *
 * The missing hop is that `voicemail_save()` records to disk and stops. It
 * tells nothing that a message arrived. Until that call is added, this card
 * records the choice and no mail is sent, which is what its note says.
 * The patch lives in `backend-patches/fs-xml-api/`.
 */

/* A key of its own rather than another field inside `voicemail_pin`. That block
   is copied wholesale onto a person when an admin sets them up, and an address
   is the one thing on this page that must NOT be copied that way - forty people
   provisioned from one record would all mail their voicemail to the same
   inbox. */
const NOTIFY_KEY = 'voicemail_notify';

/* Deliberately narrow. `person` is the address already on the mailbox owner's
   own record, so it is right for every person without an admin typing anything;
   `address` is one fixed inbox, for a shared line - reception, sales, support -
   where there is no single owner to send to. */
type NotifyTarget = 'person' | 'address';

/* Not a full RFC 5322 check, which no regex does correctly. This rejects the
   mistakes people actually make - a missing @, a missing dot, a stray space -
   and leaves the rest to the mail server, which is the only thing that can
   really answer. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface VoicemailForm {
  voicemail_to_text: boolean;
  override: boolean;
  /* Email a copy of each new message. */
  notify_enabled: boolean;
  notify_target: NotifyTarget;
  notify_address: string;
  /* Whether the recording travels with the mail or only a link back into the
     app. Off by default: a voicemail can carry card numbers, health details or
     a home address, and once it is an attachment it is in an inbox nobody here
     controls, forwardable, and outside any retention rule this product sets. */
  notify_attach_audio: boolean;
  notify_override: boolean;
}

const DEFAULT_FORM: VoicemailForm = {
  /* Both flags start off. `override` off is the safer of its two readings, and
     the personal lock behaves the way it did before this page existed. */
  voicemail_to_text: false,
  override: false,
  notify_enabled: false,
  notify_target: 'person',
  notify_address: '',
  notify_attach_audio: false,
  notify_override: false,
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

const buildFormFromSettings = (settings: Record<string, any>): VoicemailForm => {
  const voicemail = settings?.[VOICEMAIL_KEY] || {};
  const notify = settings?.[NOTIFY_KEY] || {};

  return {
    /* Stored as the strings 'YES'/'NO', never as a boolean. Anything else — an
       older record, a missing key — reads as off rather than as on. */
    voicemail_to_text: voicemail?.voicemail_to_text === 'YES',
    override: voicemail?.override === true,
    notify_enabled: notify?.enabled === true,
    /* Anything that is not the one other value we write reads as `person`. A
       record with a target we do not recognise must not silently become a fixed
       address somebody cannot see. */
    notify_target: notify?.send_to === 'address' ? 'address' : 'person',
    notify_address: typeof notify?.address === 'string' ? notify.address : '',
    notify_attach_audio: notify?.attach_audio === true,
    notify_override: notify?.override === true,
  };
};

/* An address is only required when one is actually going to be used. Validating
   a field the admin cannot see - because the target is `person`, or the whole
   card is off - would block a save for a reason nothing on screen explains. */
const validateForm = (form: VoicemailForm): Record<string, string> => {
  const errors: Record<string, string> = {};

  if (form.notify_enabled && form.notify_target === 'address') {
    const address = form.notify_address.trim();
    if (!address) {
      errors.notify_address = 'Enter the address the messages should go to';
    } else if (!EMAIL_SHAPE.test(address)) {
      errors.notify_address = 'That does not look like an email address';
    }
  }

  return errors;
};

/**
 * The honesty badge. A card is only ever marked 'active' or 'app-only' for a key
 * something in this product genuinely reads today.
 */
const CompanyVoicemail = () => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<VoicemailForm>(DEFAULT_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const {
    data: companyDefaultTemplate = null,
    isLoading,
    isError,
  } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
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


  const { mutate: saveVoicemail, isPending: isSaving } = useMutation({
    mutationFn: saveCompanyDefaults,
    onSuccess: (response: any) => {
      handleAlert({
        text: response?.data?.message || 'Company voicemail settings saved',
        type: 'success',
      });
      /* The whole company record is invalidated, not just this card. The
         personal-settings lock (useCompanyPolicy) and the other company cards
         read the same row, so a save here must make them re-read — otherwise
         the next card merges onto a stale blob and drops what was just
         written. */
      queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['userTemplateList'] });
    },
  });

  const updateForm = (patch: Partial<VoicemailForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSave = () => {
    const nextErrors = validateForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      handleAlert({ text: 'Please fix the highlighted fields', type: 'error' });
      return;
    }

    /* Merge at both levels, never replace. The outer spread keeps the other
       company cards' keys; the inner spread keeps `users` and anything else
       already inside voicemail_pin, so the stored shape is unchanged and only
       the three fields on this page move. */
    const nextSettings = {
      ...savedSettings,
      [VOICEMAIL_KEY]: {
        /* `value` holds the company PIN. It is deliberately NOT written here
           any more: the PIN control has been removed from this screen, and
           writing the field from a form that no longer edits it would blank
           whatever an admin had already saved. The spread above carries it
           through untouched. */
        ...(savedSettings?.[VOICEMAIL_KEY] || {}),
        voicemail_to_text: form.voicemail_to_text ? 'YES' : 'NO',
        override: form.override,
      },
      [NOTIFY_KEY]: {
        ...(savedSettings?.[NOTIFY_KEY] || {}),
        enabled: form.notify_enabled,
        send_to: form.notify_target,
        /* Trimmed, and only kept when it is the target in use. Leaving a stale
           address behind on a record set back to `person` is how somebody's
           messages start going to a leaver's inbox the day it is switched
           over again. */
        address: form.notify_target === 'address' ? form.notify_address.trim() : '',
        attach_audio: form.notify_attach_audio,
        override: form.notify_override,
      },
    };

    saveVoicemail({
      uuid: companyDefaultTemplate?.uuid,
      settings: nextSettings,
      greetings: toGreetingsObject(companyDefaultTemplate?.greetings),
      only: [VOICEMAIL_KEY, NOTIFY_KEY],
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center py-10">
        <Loader />
      </div>
    );
  }

  return (
    <section className="cs-section flex w-full flex-col gap-4">
      <div className="cs-block">
        <SectionHeading
          icon={<Voicemail className="h-[18px] w-[18px]" />}
          title="Voicemail"
          description="The voicemail settings the company starts people on, and whether a person may change them on their own phone."
        />
      </div>

      <div className="w-full">
        <div className="flex w-full flex-col gap-4">
          {isError && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center">
              <p className="text-sm font-semibold text-gray-900">
                We could not load the saved settings
              </p>
              <p className="text-xs text-gray-500">
                What you see below are the built-in defaults, not your saved values. Reload before
                you save, or you may overwrite settings you cannot currently see.
              </p>
            </div>
          )}

          {!companyDefaultTemplate && !isError && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-4">
              <p className="text-sm font-semibold text-gray-900">No company voicemail saved yet</p>
              <p className="text-xs text-gray-500">
                Nothing has been set for your company yet. Choose what you want below and save.
              </p>
            </div>
          )}

          <SettingCard
            icon={<Voicemail className="h-5 w-5" />}
            title="Who may change voicemail settings"
            description="The one setting on this page that something already acts on — and it is read in two different ways."
            status="app-only"
            note="Works in this app. When this is off, a person cannot open their own voicemail settings here and an admin changes them instead."
          >
            <SettingRow
              label="Let people change their own voicemail settings"
              description="Left off, a person cannot open their own voicemail settings and an admin changes them instead. Be aware of the second reading: a new person set up from this record also starts with the voicemail-to-text choice below, and with any PIN already stored against the company."
              control={
                <Switch
                  checked={form.override}
                  onCheckedChange={(checked: boolean) => updateForm({ override: checked })}
                />
              }
            />
          </SettingCard>

          {/* Before "Voicemail to text" on purpose: getting the message is the
              first thing an admin wants; having it written out is a refinement
              of a message they are already receiving. */}
          <SettingCard
            icon={<Mail className="h-5 w-5" />}
            title="Email a copy of new voicemail"
            description="Send an email the moment somebody leaves a message, so nobody has to dial in to find out."
            note="Saved here, but nothing sends the email yet. The switch records a voicemail to disk and stops there — it does not tell anything a message arrived. Everything else is ready: the mail service is running and configured to send through Gmail."
          >
            <SettingRow
              label="Send an email for every new message"
              description="One email per message, as soon as the caller hangs up. It carries who rang, the number they rang, when, and how long the message is."
              control={
                <Switch
                  checked={form.notify_enabled}
                  onCheckedChange={(checked: boolean) => updateForm({ notify_enabled: checked })}
                />
              }
            />

            <SettingNest when={form.notify_enabled}>
              <SettingRow
                label="Send it to the person whose mailbox it is"
                description="Uses the email address already on their own record, so this works for everybody without an address being typed here. Turn it off to send every message to one fixed inbox instead — right for a shared line like reception or sales, where no single person owns the mailbox."
                control={
                  <Switch
                    checked={form.notify_target === 'person'}
                    onCheckedChange={(checked: boolean) =>
                      updateForm({ notify_target: checked ? 'person' : 'address' })
                    }
                  />
                }
              />

              <SettingNest when={form.notify_target === 'address'}>
                <div className="flex flex-col gap-1">
                  <Input
                    label="Send every message to"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder="reception@yourcompany.com"
                    value={form.notify_address}
                    error={errors.notify_address}
                    onChange={(event) => updateForm({ notify_address: event.target.value })}
                  />
                  <p className="text-xs text-gray-500">
                    One address. Every message from every mailbox goes here, whoever it was left
                    for — so use a shared inbox rather than one person&apos;s, or messages stop
                    arriving the day they leave.
                  </p>
                </div>
              </SettingNest>

              <SettingRow
                label="Attach the recording to the email"
                description="Off, the email says a message is waiting and links back here to hear it. On, the audio travels with it and can be played from any mail app — but it also sits in an inbox outside this system, forwardable, and outside any retention rule set here. A voicemail can carry card numbers or health details, so leave this off unless you have decided otherwise."
                control={
                  <Switch
                    checked={form.notify_attach_audio}
                    onCheckedChange={(checked: boolean) =>
                      updateForm({ notify_attach_audio: checked })
                    }
                  />
                }
              />

              <SettingRow
                label="Let people change this for themselves"
                description="On — a person can turn their own voicemail emails on or off, and change where they go. Off — only an admin can."
                control={
                  <Switch
                    checked={form.notify_override}
                    onCheckedChange={(checked: boolean) => updateForm({ notify_override: checked })}
                  />
                }
              />
            </SettingNest>
          </SettingCard>

          <SettingCard
            icon={<ScrollText className="h-5 w-5" />}
            title="Voicemail to text"
            description="Whether a message is written out as text as well as left as audio."
            status="app-only"
            note="Works in this app, in one place: setting somebody up from these company settings. It does not change anyone already set up."
          >
            <SettingRow
              label="Write messages out as text"
              description="Stored as YES or NO, the same wording the per-person voicemail dialog writes, so both screens agree on what they are reading."
              control={
                <Switch
                  checked={form.voicemail_to_text}
                  onCheckedChange={(checked) => updateForm({ voicemail_to_text: checked })}
                />
              }
            />
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

export default CompanyVoicemail;
