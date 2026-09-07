/* Ready-made roles, so a company does not have to invent them.
 *
 * ONE SET OF NAMES, EVERYWHERE A PERSON LOOKS
 *
 * The built-in roles are shown under the names in ../role-names.ts (Account
 * owner, Location admin, Group admin, Supervisor, Agent). A preset must not
 * borrow one of those names: a custom role called "Account owner" would look
 * like the owner and not be one, because the server gates on the stored
 * string, not on the label. So presets are named for the job they do and
 * never for a built-in role. There were briefly three vocabularies on this
 * screen: the stored ADMIN/MANAGER/SUB-ADMIN/AGENT, a set of presets, and a set
 * of display labels. Three names for one idea is worse than an ugly name.
 *
 * The stored strings stay as they are because the platform compares them
 * directly as an authorisation gate - `role !== "ADMIN"` in AuthMiddleware and
 * 32 other places - so they are internal identifiers, like a primary key, and
 * nobody sees them.
 *
 * Until now a new role started from nothing or from a copy of ADMIN, SUB-ADMIN,
 * MANAGER or AGENT. Neither helps somebody who wants the ordinary thing every
 * company wants: a person who runs reports, or handles people, and touches
 * nothing else.
 *
 * The names are ours. An earlier version borrowed another product's five word
 * for word, reasoning that somebody moving across would recognise them. That is
 * a bad trade: it puts a competitor's vocabulary inside our product, where it
 * stays for as long as the product does, in exchange for a moment of
 * familiarity during one signup. These say what the person does instead, which
 * is what the rest of this console already does - "What each role can do",
 * rather than a job title.
 *
 * WHY THESE ARE FEATURE LISTS AND NOT PERMISSION TREES
 * `constants.ts` carries a warning worth repeating: a hard-coded permission tree
 * in this folder once caused removed and renamed backend keys to be submitted.
 * So a preset never spells out a permission. It names top-level features, and
 * `buildPresetPermission` walks the company's OWN live plan tree and switches on
 * what it finds there. A key that no longer exists cannot be sent, because the
 * only keys used are the ones the company just told us about.
 */

/* Top-level feature keys, taken from the guards in src/router/index.tsx rather
   than written from memory. */
export const FEATURE_KEYS = {
  people: 'account_setting',
  phoneSystem: 'phone_system_action',
  numbers: 'virtual_numbers',
  reports: 'reports',
  monitoring: 'monitoring',
  ai: 'ai',
  chat: 'chat',
  video: 'video',
  contact: 'contact',
  campaign: 'campaign',
  billing: 'billing',
  integration: 'integration',
  settings: 'settings',
  omniChannel: 'omni_channel',
  callingRates: 'calling_rates',
} as const;

export interface RolePreset {
  id: string;
  name: string;
  description: string;
  /* Which top-level features this role covers. `null` means everything the
     company has — used only by Administrator. */
  features: string[] | null;
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: 'full-access',
    name: 'Full access',
    description:
      'Every feature the company has. A copy you own; the built-in Account owner role stays as it is.',
    features: null,
  },
  {
    id: 'people-admin',
    name: 'People admin',
    description: 'Adds and removes people, and looks after numbers. No billing.',
    features: [FEATURE_KEYS.people, FEATURE_KEYS.numbers, FEATURE_KEYS.settings],
  },
  {
    /* "Account admin" and "Call reviewer" used to sit here as two presets with
       the same two features. One job, one preset. */
    id: 'reports-and-monitoring',
    name: 'Reports and monitoring',
    description: 'Watches live calls, listens to recordings and reads reports. Changes no settings.',
    features: [FEATURE_KEYS.reports, FEATURE_KEYS.monitoring],
  },
  {
    id: 'call-flow-builder',
    name: 'Call flow builder',
    description: 'Builds menus, AI agents and knowledge. Does not manage people.',
    features: [FEATURE_KEYS.ai, FEATURE_KEYS.phoneSystem],
  },
];

/* Turn a preset into a permission object, using only keys the company actually
   has. Anything not listed stays off, so a preset can never grant more than it
   says on the tin. */
export const buildPresetPermission = (
  preset: RolePreset,
  companyPlanFeatures: Record<string, any>,
): Record<string, any> => {
  if (!companyPlanFeatures || typeof companyPlanFeatures !== 'object') return {};

  const enableEverything = (node: any): any => {
    if (typeof node === 'boolean') return true;
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, enableEverything(v)]));
  };

  /* Administrator gets whatever the company has, whatever shape it is in. */
  if (preset.features === null) return enableEverything(companyPlanFeatures);

  /* Everything not named by the preset is switched OFF, not left as the company
     has it. Passing the company's own value through would hand the role whatever
     the company happens to have enabled — so "Reports only" would quietly
     carry billing and people as well, which is the opposite of what it says. */
  const disableEverything = (node: any): any => {
    if (typeof node === 'boolean') return false;
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, disableEverything(v)]));
  };

  const wanted = new Set(preset.features);
  return Object.fromEntries(
    Object.entries(companyPlanFeatures).map(([featureKey, featureValue]) => [
      featureKey,
      wanted.has(featureKey) ? enableEverything(featureValue) : disableEverything(featureValue),
    ]),
  );
};
