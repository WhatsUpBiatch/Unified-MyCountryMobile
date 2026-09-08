/* Fake users for the sandbox — invented people, not accounts on any server.
 *
 * The frontend switches on the string at user_info.role, and non-admins are
 * gated by a permission tree the router checks with `=== true`. So a persona is
 * a role string plus a feature map, and getting either shape wrong shows an
 * empty sidebar rather than an error. */

import * as f from './factory.mjs';

/* A permissive feature node. `action.view` and friends are booleans because the
   router compares them with === true; anything the router walks deeper into
   (settings.action.greeting.view) has to be an object instead, so those are
   passed in explicitly per feature rather than defaulted here. */
const node = (over = {}) => ({
  IS_SHOW: true,
  action: {
    view: true,
    edit: true,
    add: true,
    create: true,
    update: true,
    delete: true,
    export: true,
    download: true,
    ...(over.action || {}),
  },
  access: over.access || {},
});

const fullFeatures = () => ({
  ai: node(),
  /* Booleans, like `video.access.RECORDING` next door. The router resolves the
     route's `feature` path and compares it with `=== true`, and every screen
     that reads these wraps them in Boolean() — so an object here meant all
     three Phone System pages answered "Upgrade to unlock this feature" on a
     plan that includes them. */
  phone_system_action: node({
    access: { DEPARTMENT: true, IVR: true, QUEUE: true },
  }),
  campaign: node(),
  video: node({ access: { RECORDING: true } }),
  /* TRANSCRIPTION gates the Transcription and Call monitoring cards on the
     phone rules screen. Granted here so those screens are reachable in mock
     mode — without it two of the six cards simply never render and cannot be
     worked on. */
  advance_call_management: node({ access: { TRANSCRIPTION: true } }),
  account_setting: node({
    access: {
      USER: { action: { view: true, edit: true } },
      SITE: { action: { view: true } },
    },
  }),
  reports: node({ action: { sms: true, call_recording_listen: true } }),
  chat: node(),
  /* The social channel cards are gated one per network, and `node()` leaves
     `access` empty — so three of the four never rendered and only Telegram
     showed, because its gate had been commented out and replaced with `true`. */
  omni_channel: node({
    access: { FACEBOOK: true, INSTAGRAM: true, WHATSAPP: true, TELEGRAM: true },
  }),
  billing: node(),
  /* The numbers screens gate on domain verbs, not on the generic CRUD set:
     buying a number, assigning it to an extension, setting and removing its
     forwarding, releasing it back to the carrier. Without these the whole
     Action column rendered empty and there was no Add number button, which
     looks like a broken screen rather than a plan that does not include them. */
  virtual_numbers: node({
    action: {
      buy: true,
      assign_number: true,
      release: true,
      set_forwarding: true,
      update_forwarding: true,
      remove_forwarding: true,
    },
  }),
  monitoring: node(),
  monitoring_features: node({ action: { whisper: true, barge: true, listen: true } }),
  messages: node(),
  integration: node(),
  contact: node(),
  calling_rates: node(),
  settings: node({ action: { greeting: { view: true, edit: true } } }),
});

/* Agents lose the administrative surfaces. Removing the key entirely is closer
   to how the real API answers than setting IS_SHOW false. */
const withoutKeys = (features, keys) => {
  const copy = { ...features };
  keys.forEach((k) => delete copy[k]);
  return copy;
};

export const ROLES = {
  ADMIN: {
    role: 'ADMIN',
    label: 'Account owner — sees everything',
    features: fullFeatures,
  },
  MANAGER: {
    role: 'MANAGER',
    label: 'Manager — no billing or company settings',
    features: () => withoutKeys(fullFeatures(), ['billing', 'integration']),
  },
  'SUB-ADMIN': {
    role: 'SUB-ADMIN',
    label: 'People admin — no billing, campaigns or AI',
    features: () => withoutKeys(fullFeatures(), ['billing', 'campaign', 'ai']),
  },
  AGENT: {
    role: 'AGENT',
    label: 'Agent — phone, chat and their own reports only',
    /* The Admin area appears if ANY of phone_system_action.action.view,
       ai.IS_SHOW, billing, calling_rates or omni_channel is granted, so all
       five have to go or an agent still sees the admin nav. */
    features: () =>
      withoutKeys(fullFeatures(), [
        'billing',
        'account_setting',
        'campaign',
        'integration',
        'monitoring',
        'monitoring_features',
        'calling_rates',
        'virtual_numbers',
        'phone_system_action',
        'ai',
        'omni_channel',
      ]),
  },
};

export const COMPANY_UUID = f.uuid('company');

/* Distinct per role, so a screenshot or a bug report identifies which persona
   produced it instead of every role claiming to be extension 1001. */
const EXTENSIONS = { ADMIN: '1001', MANAGER: '1002', 'SUB-ADMIN': '1003', AGENT: '1004' };

export const persona = (roleKey) => {
  const role = ROLES[roleKey] ? roleKey : 'ADMIN';
  const spec = ROLES[role];
  const me = f.person(`me-${role}`);
  const features = spec.features();
  const extension = EXTENSIONS[role];

  return {
    uuid: f.uuid(`user-${role}`),
    status: 'Y',
    /* free_did must be truthy on company_info or auth-provider redirects
       straight to /phone-lines-auth and the app is never reachable. */
    free_did: 4,
    paid_did: 2,
    caller_id: f.phone('me'),
    profile: null,
    notification_settings: null,
    call_forwarding: null,
    settings: { admin_scope: { level: 'company', location_uuids: [], group_uuids: [] } },
    greetings: null,
    socket_status: 'online',
    device_token: 'sandbox-device',
    purchased_licenses: 25,
    assigned_did: [{ did_number: f.phone('did1'), did_name: 'Main line', type: 'P' }],
    /* `countryname` and `alpha2code` as well as the friendlier names: those
       two spellings are what the app actually reads — 20 call sites between
       them — so with only `name`/`iso` the calling-rates screen never learned
       which country to look up and loaded nothing on open. */
    countryInfo: {
      name: 'United States',
      countryname: 'United States',
      iso: 'US',
      alpha2code: 'US',
      alpha3code: 'USA',
      code: '+1',
    },

    user_info: {
      uuid: f.uuid(`user-${role}`),
      extension,
      email: me.email,
      phone: f.phone('me'),
      first_name: me.first_name,
      last_name: me.last_name,
      job_title: spec.label.split(' — ')[0],
      role: spec.role,
      role_uuid: f.uuid(`role-${role}`),
      custom_role_uuid: null,
      site_uuid: f.uuid('site'),
      caller_id: f.phone('me'),
      profile: null,
      domain: 'sandbox.local',
      permission: { plan_features: features },
      site_detail: { name: 'Sandbox HQ' },
      did_detail: { did_name: 'Main line' },
      role_data: { name: spec.role, description: spec.label, permission: { plan_features: features } },
      custom_role_data: null,
    },

    company_info: {
      uuid: COMPANY_UUID,
      company_name: 'Sandbox Communications',
      plan_uuid: f.uuid('plan'),
      plan_status: 'active',
      is_trial: 'N',
      free_did: 4,
      amount: '149.00',
      allow_country: [],
      allow_did_countries: [],
      plan_duration: 'monthly',
      address: '100 Example Street, Austin, TX',
      plan_features: { plan_features: features },
    },

    /* All four of these must be present or the dialpad disables itself. They
       point nowhere real — the softphone will fail to register, which is
       correct for a sandbox with no switch behind it. */
    sip_credentials: {
      wss_url: 'wss://sandbox.invalid:7443',
      domain: 'sandbox.local',
      extension,
      password: 'sandbox-not-a-real-secret',
      caller_id: f.phone('me'),
      stun_url: 'stun:sandbox.invalid:3478',
      turn_url: 'turn:sandbox.invalid:3478',
      turn_urls: ['turn:sandbox.invalid:3478'],
      turn_username: 'sandbox',
      turn_password: 'sandbox-not-a-real-secret',
    },
  };
};
