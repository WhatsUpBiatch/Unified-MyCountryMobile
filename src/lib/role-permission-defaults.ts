/* What a person should be allowed to do on the day they are created.
 *
 * THE PROBLEM
 *
 * A role in this product is a name, a description, and a tree of tick boxes
 * that mirrors everything the company's plan includes. When an administrator
 * adds somebody they pick a role from a list, and whatever that role happens to
 * hold is what the new person gets. Nothing in this product ever decided what a
 * role *should* hold. A role created by ticking boxes at three in the afternoon
 * is the whole of the answer, and two companies that both have a role called
 * "Manager" can mean completely different things by it.
 *
 * This file is the missing opinion. Give it the company's plan and say which
 * kind of person you are setting up, and it returns the permissions that kind of
 * person should start with — plus, in plain sentences, what was granted, what
 * was deliberately held back, and anything it could not place.
 *
 * THE SIX KINDS OF PERSON, AND WHY THEY SPLIT WHERE THEY DO
 *
 * Every established phone system lands on roughly the same six, because the same
 * five questions decide where a capability sits. The questions, in the order
 * they are asked:
 *
 *   1. Does it cost money, or change the shape of the account?
 *      Buying numbers, changing the plan, paying the bill, adding a location.
 *      These go to one person and stay there. Somebody who can quietly triple
 *      the monthly bill is not an administrator, they are a signatory. This is
 *      why the person who runs a location day to day still cannot buy.
 *
 *   2. Does it change the *person*, or only the person's place in one team?
 *      Creating somebody, deleting them, changing their email address, giving
 *      them a role — that changes who they are, and belongs with whoever owns
 *      the staff list. Adding an existing person to a queue only changes their
 *      place in that queue, and belongs with whoever runs the queue. This one
 *      line separates a Location Admin from a Department Admin more cleanly
 *      than any list of screens.
 *
 *   3. Is it configuration, or is it supervision?
 *      Listening to a live call, whispering to the person on it, marking an
 *      agent unavailable — these last for one shift and are done by somebody
 *      standing next to the team. Changing where calls route lasts until
 *      somebody changes it back and affects everyone. So supervision is handed
 *      down much further than configuration is, and a supervisor gets the whole
 *      of the first and none of the second.
 *
 *   4. Whose data is it?
 *      The safe default for everybody is: your own calls, your own recordings,
 *      your own numbers. Access to anyone else's is granted, never assumed. An
 *      agent who can search the whole company's recordings on their first day
 *      is a data-protection incident waiting for a reason.
 *
 *   5. Is it just doing the job?
 *      Making calls, sending messages, chatting, keeping contacts, recording a
 *      greeting. Nobody needs permission for the thing they were hired to do,
 *      and withholding it produces a support ticket on day one.
 *
 * Run those five over any capability and the six kinds fall out. Each is named
 * after how far it reaches, not after how senior anybody is:
 *
 *   Company Admin      the whole company, money included. Usually the person
 *                      who signed up.
 *   Location Admin     one or more locations. Everything the Company Admin can
 *                      do except spend money and reshape the account. The
 *                      person who actually runs the day to day.
 *   Department Admin   one or more departments: their call handling, their
 *                      hours, their members, and watching them work. Cannot
 *                      create or delete a person.
 *   Supervisor         watches a department and nothing else. Changes no
 *                      setting. Promoted from inside the department, not sent
 *                      down from head office. That is the point of the tier:
 *                      you can trust somebody to watch a queue without
 *                      trusting them to change it.
 *   Agent              does the work, sees their own calls. The tools of the
 *                      job and nothing about anybody else.
 *   User               an ordinary person with a phone. Their own line, their
 *                      own data, nothing about anybody else.
 *
 * TWO THINGS THIS PRODUCT DOES NOT HAVE YET, SAID PLAINLY
 *
 *   No scope. A permission here applies to the whole company. "Department
 *   Admin" therefore means the call handling of every department, not of
 *   theirs, because there is no column saying which department is theirs.
 *   Question 2 above is only half answerable today, and the Department Admin
 *   and Supervisor defaults are written as the narrowest set that is still
 *   useful rather than the correct one. See lib/admin-scope.ts, which records
 *   the missing half, and which offers the same three kinds of reach.
 *
 *   No enforcement. The platform does not read these permissions when it
 *   answers a request. They decide what the app puts on screen. A default
 *   worked out here is a good default, not a lock, and every screen that uses
 *   this file says so on its face.
 *
 * THREE RULES THIS FILE WILL NOT BEND
 *
 *   1. Never grant beyond the plan. The company's own feature tree is the
 *      ceiling. A role cannot hold a permission for something the company has
 *      not bought, because that tick box would be a promise the platform
 *      cannot keep.
 *   2. Anything unrecognised is withheld, and reported. New capabilities get
 *      added to the plan tree over time. Quietly granting one nobody has
 *      classified is how an agent ends up with the billing screen. It is
 *      returned in `undecided` so a person can decide.
 *   3. It never reads or writes anything. No React, no network, no dates. Give
 *      it a plan tree, get back a permission tree.
 */

/**
 * The six kinds of person this file has an opinion about, widest reach first.
 *
 * The name of each one says how far it reaches, not how senior somebody is.
 * That is the whole trick: "Department Admin" is not a junior administrator, it
 * is an administrator of one department. Somebody who runs two departments and
 * somebody who runs the company do the same sorts of thing to different sets of
 * people, and naming a tier after the set is what makes the ladder readable.
 */
export type RoleTier =
  | 'company_admin'
  | 'location_admin'
  | 'department_admin'
  | 'supervisor'
  | 'agent'
  | 'user';

/** Widest reach first. Used for ordering on screen and nothing else. */
export const TIER_ORDER: RoleTier[] = [
  'company_admin',
  'location_admin',
  'department_admin',
  'supervisor',
  'agent',
  'user',
];

/**
 * How far a tier reaches. The first three are the same three the Admin scope
 * screen offers, deliberately — a tier picks the *kind* of reach, and a scope
 * fills in which locations or departments it means. `self` is the fourth: a
 * person who administers nobody but themselves.
 */
export type TierScope = 'company' | 'location' | 'department' | 'self';

export const SCOPE_LABEL: Record<TierScope, string> = {
  company: 'The whole company',
  location: 'Chosen locations',
  department: 'Chosen departments',
  self: 'Themselves only',
};

export interface TierInfo {
  tier: RoleTier;
  /** What this kind of person is called on screen. */
  label: string;
  /** How far they reach. */
  scope: TierScope;
  /** One sentence an administrator can read and act on. */
  description: string;
  /** The single line that decides what this tier does not get. */
  boundary: string;
  /**
   * Role names in the platform's own list that mean this tier. Matched without
   * case, and with spaces, hyphens and underscores treated as the same thing,
   * because "SUB-ADMIN", "Sub Admin" and "sub_admin" have all been seen.
   */
  aliases: string[];
}

export const TIERS: TierInfo[] = [
  {
    tier: 'company_admin',
    label: 'Company Admin',
    scope: 'company',
    description:
      'The whole company, money included. Buys numbers, changes the plan, pays the bill, adds locations, and can do everything below.',
    boundary: 'Nothing is held back. Give this to as few people as the company can manage with.',
    aliases: ['admin', 'administrator', 'owner', 'company admin', 'super admin'],
  },
  {
    tier: 'location_admin',
    label: 'Location Admin',
    scope: 'location',
    description:
      'Runs one or more locations day to day: adds and removes people, sets up call handling, hands out numbers, connects other software, reads the reports.',
    boundary:
      'No spending and no changing the shape of the account — no buying numbers, no plan changes, no billing, no new locations.',
    aliases: ['sub admin', 'subadmin', 'location admin', 'site admin', 'branch admin'],
  },
  {
    tier: 'department_admin',
    label: 'Department Admin',
    scope: 'department',
    description:
      'Runs one or more departments: their call handling, their opening hours, who is in them, and watching them work. Reads their reports and hears their recordings.',
    boundary:
      'Cannot create, delete or edit a person, cannot buy anything, and cannot connect other software.',
    aliases: [
      'manager',
      'department admin',
      'department manager',
      'group admin',
      'team manager',
      'team lead',
    ],
  },
  {
    tier: 'supervisor',
    label: 'Supervisor',
    scope: 'department',
    description:
      'Watches a department while it works — sees who is on a call, listens in, whispers, takes a call over, and reads the department’s reports.',
    boundary:
      'Changes no settings at all. No call handling, no hours, no adding people. Watching, not configuring.',
    aliases: ['supervisor', 'floor supervisor', 'team supervisor'],
  },
  {
    tier: 'agent',
    label: 'Agent',
    scope: 'self',
    /* Two sentences, not four clauses and a list. The dialler, campaigns,
       messaging and the shared inbox are what "a department's tools" means, and
       naming all four under every Role dropdown on a form of ten people is more
       words than the choice needs. */
    description: 'Takes and makes calls with a department\u2019s tools.',
    boundary: 'Sees only their own calls. No supervision, recordings or settings.',
    aliases: ['agent', 'contact centre agent', 'contact center agent', 'operator'],
  },
  {
    tier: 'user',
    label: 'User',
    scope: 'self',
    description:
      'Somebody with a phone: calls, messages, chat, contacts, video, voicemail, and their own settings.',
    boundary:
      'Their own line and their own data. Nothing about anybody else, and nothing administrative.',
    aliases: ['user', 'member', 'employee', 'standard user', 'everyday user'],
  },
];

const TIER_BY_KEY = new Map(TIERS.map((info) => [info.tier, info]));

export const tierInfo = (tier: RoleTier): TierInfo => TIER_BY_KEY.get(tier) as TierInfo;

/** "SUB-ADMIN", "Sub Admin" and "sub_admin" are the same word. */
const flatten = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();

/**
 * Which kind of person a role in the platform's list is meant to be, or null
 * when the name says nothing. A company's own role called "Night shift" gets
 * null, and the screen asks rather than guessing: a wrong guess here would
 * quietly propose the wrong permissions for real people.
 */
export const tierForRoleName = (name: unknown): RoleTier | null => {
  const flat = flatten(name);
  if (!flat) return null;
  const exact = TIERS.find((info) => info.aliases.some((alias) => flatten(alias) === flat));
  return exact ? exact.tier : null;
};

/* ------------------------------------------------------------------------ */
/* The rules                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * One rule: a family of capabilities, who gets it, and why. `why` is written to
 * be shown to a customer, so it says what the rule protects rather than which
 * keys it matches.
 */
export interface PermissionRule {
  id: string;
  /** Which part of the product this belongs to. Groups the rows of the table. */
  area: CapabilityArea;
  /** Shown on screen as the heading of a group. */
  title: string;
  /** Plain English. Why this sits where it sits. */
  why: string;
  /** Which of the five principles put it here. */
  principle: PrincipleId;
  tiers: RoleTier[];
  match: (path: string[]) => boolean;
}

/**
 * The five questions from the header, as something a screen can print. An
 * administrator who reads these five lines has the whole model; the table
 * underneath is only them applied.
 */
export type PrincipleId =
  | 'money'
  | 'identity'
  | 'supervision'
  | 'own_data'
  | 'the_job';

export const PRINCIPLES: { id: PrincipleId; title: string; statement: string }[] = [
  {
    id: 'money',
    title: 'Money and the shape of the account sit above ordinary administration',
    statement:
      'Buying a number, changing the plan, paying the bill, adding a location. Somebody who can quietly treble the monthly bill is not an administrator, they are a signatory. This is why the person who runs a location day to day still cannot buy.',
  },
  {
    id: 'identity',
    title: 'Changing a person is different from changing their place in a department',
    statement:
      'Creating somebody, deleting them or changing their email address changes who they are, and belongs with whoever owns the staff list. Adding an existing person to a queue only changes their place in that queue, and belongs with whoever runs the queue. This one line separates a Location Admin from a Department Admin more cleanly than any list of screens.',
  },
  {
    id: 'supervision',
    title: 'Supervision reaches further down than configuration',
    statement:
      'Listening to a live call or whispering to the person on it lasts one shift and is done by somebody standing with the department. Changing where calls go lasts until somebody changes it back and affects every caller. So a Supervisor gets the whole of the first and none of the second.',
  },
  {
    id: 'own_data',
    title: 'Data defaults to your own calls only',
    statement:
      'Your own calls, your own recordings, your own numbers. Anybody else’s is granted on purpose, to the few people whose job needs it. An agent who can search the whole company’s recordings on their first day is a data-protection incident waiting for a reason.',
  },
  {
    id: 'the_job',
    title: 'Nobody needs permission for the job they were hired to do',
    statement:
      'Making calls, sending messages, keeping contacts, recording a greeting, changing their own settings. A person’s own settings are theirs — withholding them produces a support ticket on the first morning.',
  },
];

/** The areas the capability table is grouped into, in the order it shows them. */
export type CapabilityArea =
  | 'people'
  | 'numbers'
  | 'call_handling'
  | 'reporting'
  | 'supervision'
  | 'billing';

export const AREAS: { area: CapabilityArea; title: string; blurb: string }[] = [
  {
    area: 'people',
    title: 'People and identity',
    blurb: 'Who exists, what they are called, and which locations the company has.',
  },
  {
    area: 'numbers',
    title: 'Numbers',
    blurb: 'Buying numbers, giving them out, and deciding where they ring.',
  },
  {
    area: 'call_handling',
    title: 'Call handling',
    blurb: 'Menus, queues, departments, opening hours, campaigns, and the tools of the job.',
  },
  {
    area: 'reporting',
    title: 'Reporting and recordings',
    blurb: 'What happened on the calls, and who may listen back to them.',
  },
  {
    area: 'supervision',
    title: 'Live supervision',
    blurb: 'Watching calls while they are happening, and stepping into them.',
  },
  {
    area: 'billing',
    title: 'Billing and the account',
    blurb: 'What the company pays, and the plan it pays for.',
  },
];

/** Everybody. */
const ALL: RoleTier[] = [
  'company_admin',
  'location_admin',
  'department_admin',
  'supervisor',
  'agent',
  'user',
];
/** The two who administer people rather than departments. */
const ADMINS: RoleTier[] = ['company_admin', 'location_admin'];
/** Everybody who is responsible for somebody else's work. */
const WATCHERS: RoleTier[] = [
  'company_admin',
  'location_admin',
  'department_admin',
  'supervisor',
];
/** Everybody who may change a setting that outlives today. */
const CONFIGURERS: RoleTier[] = ['company_admin', 'location_admin', 'department_admin'];
/** Everybody who works a queue, from the agent upwards. */
const WORKERS: RoleTier[] = [
  'company_admin',
  'location_admin',
  'department_admin',
  'supervisor',
  'agent',
];

/** Every segment of a path, lowercased, so matching does not care about case. */
const low = (path: string[]): string[] => path.map((part) => String(part).toLowerCase());

const module_ = (path: string[]): string => low(path)[0] || '';
const leaf = (path: string[]): string => low(path)[path.length - 1] || '';
const has = (path: string[], ...names: string[]): boolean => {
  const parts = low(path);
  return names.some((name) => parts.includes(name.toLowerCase()));
};

/** Verbs that change something rather than look at it. */
const WRITE_VERBS = ['add', 'edit', 'update', 'delete', 'remove', 'create', 'assign', 'release'];
const isWrite = (path: string[]): boolean => WRITE_VERBS.includes(leaf(path));

/**
 * Ordered. The first rule that matches decides, so the narrow ones come first.
 * Read top to bottom and it is the five questions in the header, in order.
 */
export const RULES: PermissionRule[] = [
  /* --- Question 1: does it cost money, or reshape the account? ----------- */
  {
    id: 'money',
    area: 'billing',
    principle: 'money',
    title: 'Spending and the plan',
    why: 'Billing, plan changes and call rates. Anybody who can change these can change what the company pays, so it stays with the account holder.',
    tiers: ['company_admin'],
    match: (path) => ['billing', 'calling_rates', 'payment', 'plan'].includes(module_(path)),
  },
  {
    id: 'buy_numbers',
    area: 'numbers',
    principle: 'money',
    title: 'Buying and giving up numbers',
    why: 'Every number bought is on the next bill, and a number given up cannot always be got back. Same reason as the bill itself.',
    tiers: ['company_admin'],
    match: (path) => module_(path) === 'virtual_numbers' && has(path, 'buy', 'release', 'port'),
  },
  {
    id: 'offices',
    area: 'people',
    principle: 'money',
    title: 'Locations',
    why: 'Adding or changing a location changes the shape of the account and usually the contract. It sits with the account holder.',
    tiers: ['company_admin'],
    match: (path) => module_(path) === 'account_setting' && has(path, 'site'),
  },

  /* --- Question 2: does it change the person, or their place in a team? -- */
  {
    id: 'people_manage',
    area: 'people',
    principle: 'identity',
    title: 'Creating and removing people',
    why: 'Creating somebody, removing them or changing their details changes who they are, not what one department does. It belongs with whoever owns the staff list.',
    tiers: ADMINS,
    match: (path) => module_(path) === 'account_setting' && has(path, 'user') && isWrite(path),
  },
  {
    id: 'people_view',
    area: 'people',
    principle: 'identity',
    title: 'Seeing the list of people',
    why: 'A department admin or supervisor has to be able to find their own people. Looking at the staff list changes nothing.',
    tiers: WATCHERS,
    match: (path) => module_(path) === 'account_setting' && has(path, 'user'),
  },
  {
    id: 'account_rest',
    area: 'people',
    principle: 'money',
    title: 'Company settings',
    why: 'Everything else on the company record is a company-wide decision, so it stays with the account holder.',
    tiers: ['company_admin'],
    match: (path) => module_(path) === 'account_setting',
  },
  {
    id: 'numbers_assign',
    area: 'numbers',
    principle: 'identity',
    title: 'Giving out numbers and forwarding',
    why: 'Deciding whose phone a number rings is part of running a location. It costs nothing, so it does not need the account holder.',
    tiers: ADMINS,
    match: (path) =>
      module_(path) === 'virtual_numbers' &&
      (isWrite(path) ||
        has(
          path,
          'assign_number',
          'set_forwarding',
          'update_forwarding',
          'remove_forwarding',
        )),
  },
  {
    id: 'numbers_view',
    area: 'numbers',
    principle: 'the_job',
    title: 'Seeing the company’s numbers',
    why: 'Somebody setting up a queue needs to know which numbers exist. Looking at the list buys nothing.',
    tiers: CONFIGURERS,
    match: (path) => module_(path) === 'virtual_numbers',
  },

  /* --- Question 3: configuration, or supervision? ------------------------ */
  {
    id: 'supervision',
    area: 'supervision',
    principle: 'supervision',
    title: 'Watching calls as they happen',
    why: 'Listening in, whispering, taking a call over and seeing who is busy last one shift. This is the job of whoever is standing with the department, so it goes further down than any setting does.',
    tiers: WATCHERS,
    match: (path) => ['monitoring', 'monitoring_features'].includes(module_(path)),
  },
  {
    id: 'phone_config',
    area: 'call_handling',
    principle: 'supervision',
    title: 'Call handling, menus, queues and hours',
    why: 'These last until somebody changes them back and affect every caller. Changing them is a department admin’s job; a supervisor watches the department without reshaping it.',
    tiers: CONFIGURERS,
    match: (path) => module_(path) === 'phone_system_action' && isWrite(path),
  },
  {
    id: 'phone_view',
    area: 'call_handling',
    principle: 'the_job',
    title: 'Seeing how calls are handled',
    why: 'An agent should be able to see which queue they are in and when it is open, without being able to change it.',
    tiers: WORKERS,
    match: (path) => module_(path) === 'phone_system_action',
  },
  {
    id: 'integrations',
    area: 'call_handling',
    principle: 'money',
    title: 'Connecting other software',
    why: 'A connection sends the company’s call data to somebody else’s system. That is an account-wide decision even though it costs nothing here.',
    tiers: ADMINS,
    match: (path) => ['integration', 'integrations'].includes(module_(path)),
  },
  {
    id: 'ai_setup',
    area: 'call_handling',
    principle: 'money',
    title: 'Setting up the AI assistants',
    why: 'An assistant answers the company’s calls in the company’s words, and reads whatever it is trained on. Setting one up is an account-wide decision.',
    tiers: ADMINS,
    match: (path) => module_(path) === 'ai' && (has(path, 'action') || isWrite(path)),
  },
  {
    id: 'ai_use',
    area: 'call_handling',
    principle: 'the_job',
    title: 'Using the AI assistants',
    why: 'Help on your own call is part of doing the job, so everybody gets it if the plan includes it.',
    tiers: ALL,
    match: (path) => module_(path) === 'ai',
  },

  /* --- Question 4: whose data is it? ------------------------------------- */
  {
    id: 'recordings',
    area: 'reporting',
    principle: 'own_data',
    title: 'Other people’s recordings and transcripts',
    why: 'A recording is a conversation somebody else had. Hearing it is granted on purpose, to the few people whose job needs it, and never handed out with the phone.',
    tiers: WATCHERS,
    match: (path) =>
      module_(path) === 'advance_call_management' ||
      has(path, 'recording', 'transcription', 'call_recording_listen'),
  },
  {
    id: 'reports_all',
    area: 'reporting',
    principle: 'own_data',
    title: 'Reports on the whole company',
    why: 'Everybody’s calls and messages in one place. That is a company-wide view and belongs with the people who run the company.',
    tiers: ADMINS,
    match: (path) => module_(path) === 'reports' && leaf(path) === 'all',
  },
  {
    id: 'reports_team',
    area: 'reporting',
    principle: 'own_data',
    title: 'Reports on a department',
    why: 'A department admin and a supervisor need their own department’s figures to do the job. They do not need the sales department’s.',
    tiers: WATCHERS,
    match: (path) => module_(path) === 'reports' && leaf(path) === 'team',
  },
  {
    id: 'reports_own',
    area: 'reporting',
    principle: 'the_job',
    title: 'Your own reports',
    why: 'Seeing how your own day went is not a privilege, and withholding it is the fastest way to be asked for it.',
    tiers: ALL,
    match: (path) => module_(path) === 'reports',
  },

  /* --- Question 5: is it just doing the job? ----------------------------- */
  {
    id: 'campaign_config',
    area: 'call_handling',
    principle: 'supervision',
    title: 'Setting up campaigns and diallers',
    why: 'A campaign decides who the company rings and how often. Building one is a department admin’s job; working one is an agent’s.',
    tiers: CONFIGURERS,
    match: (path) => ['campaign', 'auto_dialer'].includes(module_(path)) && isWrite(path),
  },
  {
    id: 'campaign_work',
    area: 'call_handling',
    principle: 'the_job',
    title: 'Working a campaign',
    why: 'The dialler is the tool of the job for an agent, so they get it without asking.',
    tiers: WORKERS,
    match: (path) => ['campaign', 'auto_dialer'].includes(module_(path)),
  },
  {
    id: 'shared_inbox',
    area: 'call_handling',
    principle: 'the_job',
    title: 'The shared inbox',
    why: 'Answering the company’s social and messaging channels is the job of the department that answers them.',
    tiers: WORKERS,
    match: (path) => module_(path) === 'omni_channel',
  },
  {
    id: 'the_job',
    area: 'call_handling',
    principle: 'the_job',
    title: 'The phone, and the tools that go with it',
    why: 'Calling, messaging, chat, contacts, video, voicemail and your own settings. Nobody needs permission for the thing they were hired to do.',
    tiers: ALL,
    match: (path) =>
      [
        'chat',
        'contact',
        'contacts',
        'messages',
        'video',
        'settings',
        'phone_system',
        'phone_system_services',
        'voicemail',
        'meeting',
        'meetings',
      ].includes(module_(path)),
  },
];

/* ------------------------------------------------------------------------ */
/* Building a default                                                        */
/* ------------------------------------------------------------------------ */

export interface DefaultPermissionResult {
  /** The permission tree, in the shape a role stores. */
  permission: Record<string, any>;
  /** How many tick boxes the plan offers, and how many this default turns on. */
  total: number;
  granted: number;
  /** Rules that gave this tier something, in the order they are written. */
  allowed: PermissionRule[];
  /** Rules that had something to give and deliberately gave this tier none. */
  withheld: PermissionRule[];
  /**
   * Capabilities in the plan that no rule recognised. They are switched off,
   * and listed here so somebody can decide rather than the file guessing.
   * Dotted paths, e.g. `wallboard.action.view`.
   */
  undecided: string[];
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Work out the permissions a given kind of person should start with.
 *
 * `companyFeatures` is the company's own plan tree — the module map with keys
 * such as `chat` and `account_setting`, as `extractPlanFeatures` in hooks/rbac
 * returns it. Everything is measured against it, so a company that has not
 * bought a feature never sees a default that claims to grant it.
 */
export const buildDefaultPermission = (
  companyFeatures: unknown,
  tier: RoleTier,
): DefaultPermissionResult => {
  const source = isPlainObject(companyFeatures) ? companyFeatures : {};
  const usedRules = new Set<string>();
  const blockedRules = new Set<string>();
  const undecided: string[] = [];
  let total = 0;
  let granted = 0;

  const walk = (node: Record<string, any>, path: string[]): Record<string, any> => {
    const out: Record<string, any> = {};

    Object.keys(node).forEach((key) => {
      const value = node[key];
      const here = [...path, key];

      if (isPlainObject(value)) {
        out[key] = walk(value, here);
        return;
      }

      if (typeof value !== 'boolean') {
        /* Anything that is neither a branch nor a tick box is carried through
           untouched. Dropping a key the platform put there would silently
           change the role's shape. */
        out[key] = value;
        return;
      }

      /* `IS_SHOW` is not a permission — it is whether the module appears at
         all. It is filled in afterwards, once we know whether this tier was
         given anything inside the module. */
      if (key === 'IS_SHOW') {
        out[key] = false;
        return;
      }

      total += 1;

      /* Rule 1: the plan is the ceiling. A capability the company has not got
         is off for everybody, and is not counted as withheld from anyone —
         nobody is being denied something that does not exist. */
      if (value !== true) {
        out[key] = false;
        return;
      }

      const rule = RULES.find((candidate) => candidate.match(here));

      if (!rule) {
        // Rule 2: unrecognised means off, and said out loud.
        out[key] = false;
        undecided.push(here.join('.'));
        return;
      }

      if (rule.tiers.includes(tier)) {
        out[key] = true;
        granted += 1;
        usedRules.add(rule.id);
      } else {
        out[key] = false;
        blockedRules.add(rule.id);
      }
    });

    return out;
  };

  const permission = walk(source, []);

  /* A module is shown when this tier was given something inside it, and only
     when the plan shows it at all. Showing an empty module is how somebody ends
     up on a screen with every button greyed out and no explanation. */
  Object.keys(permission).forEach((moduleKey) => {
    const branch = permission[moduleKey];
    if (!isPlainObject(branch) || !('IS_SHOW' in branch)) return;
    const planShows = (source as any)?.[moduleKey]?.IS_SHOW !== false;
    branch.IS_SHOW = planShows && hasAnyGrant(branch);
  });

  return {
    permission,
    total,
    granted,
    allowed: RULES.filter((rule) => usedRules.has(rule.id)),
    withheld: RULES.filter((rule) => blockedRules.has(rule.id) && !usedRules.has(rule.id)),
    undecided,
  };
};

/** Whether anything under a branch is switched on, ignoring `IS_SHOW`. */
export const hasAnyGrant = (node: unknown): boolean => {
  if (!isPlainObject(node)) return node === true;
  return Object.keys(node).some((key) => {
    if (key === 'IS_SHOW') return false;
    const value = node[key];
    return isPlainObject(value) ? hasAnyGrant(value) : value === true;
  });
};

/* ------------------------------------------------------------------------ */
/* Comparing a default with a role that already exists                       */
/* ------------------------------------------------------------------------ */

export interface PermissionDifference {
  /** Dotted path of the tick box that differs. */
  path: string;
  /** `extra` — the role grants something the default does not. */
  kind: 'extra' | 'missing';
}

const collectLeaves = (node: unknown, path: string[], into: Map<string, boolean>): void => {
  if (!isPlainObject(node)) return;
  Object.keys(node).forEach((key) => {
    if (key === 'IS_SHOW') return;
    const value = node[key];
    const here = [...path, key];
    if (isPlainObject(value)) {
      collectLeaves(value, here, into);
    } else if (typeof value === 'boolean') {
      into.set(here.join('.'), value);
    }
  });
};

/**
 * How a role that already exists differs from the default for its kind. Used to
 * tell an administrator what would change *before* anything is saved — a screen
 * that offers to "apply the default" without saying what it would take away is
 * a screen nobody should press.
 *
 * A tick box present in one tree and absent from the other counts as off, since
 * that is how every reader in this product treats a missing key.
 */
export const comparePermissions = (
  current: unknown,
  proposed: unknown,
): PermissionDifference[] => {
  const before = new Map<string, boolean>();
  const after = new Map<string, boolean>();
  collectLeaves(current, [], before);
  collectLeaves(proposed, [], after);

  const paths = new Set<string>([...before.keys(), ...after.keys()]);
  const differences: PermissionDifference[] = [];

  [...paths].sort().forEach((path) => {
    const was = before.get(path) === true;
    const will = after.get(path) === true;
    if (was === will) return;
    differences.push({ path, kind: was ? 'extra' : 'missing' });
  });

  return differences;
};

/* ------------------------------------------------------------------------ */
/* What this product cannot do yet                                           */
/* ------------------------------------------------------------------------ */

/**
 * Capabilities that established systems hand to one named person rather than to
 * their role — because one salesperson needs to ring abroad and the rest of the
 * team does not, and because a role is the wrong place to record an exception.
 *
 * A person record here has nowhere to keep any of them, so none of these can be
 * set today. They are listed rather than hidden: an administrator looking for
 * the switch should be told it is not there, not left hunting.
 */
export const PER_PERSON_GAPS: { id: string; label: string; why: string }[] = [
  {
    id: 'international',
    label: 'Allow this person to dial abroad',
    why: 'Normally off for a new person and switched on one at a time, because international calls are where a stolen password costs real money. There is no per-person switch here yet — a company-wide rule is the only control.',
  },
  {
    id: 'own_recordings',
    label: 'Let this person hear their own recordings',
    why: 'Usually separate from hearing anybody else’s. Here the two are the same tick box, so granting one grants both.',
  },
  {
    id: 'self_service',
    label: 'Which of their own settings a person may change',
    why: 'Established systems let an administrator lock a person’s own voicemail, hours or ring time to read-only. There is no such lock here, so anybody can change their own.',
  },
  {
    id: 'sign_in_as',
    label: 'Sign in as this person to help them',
    why: 'A support power kept away from ordinary administrators. Not available here at all, which is safer but slower.',
  },
];

/* ------------------------------------------------------------------------ */
/* The whole model on one page                                               */
/* ------------------------------------------------------------------------ */

export interface MatrixRow {
  rule: PermissionRule;
  /** One entry per tier, in TIER_ORDER, saying whether that tier gets it. */
  cells: { tier: RoleTier; allowed: boolean }[];
}

export interface MatrixSection {
  area: CapabilityArea;
  title: string;
  blurb: string;
  rows: MatrixRow[];
}

/**
 * Every capability, grouped by the part of the product it belongs to, with a
 * yes or no against each of the six kinds of person.
 *
 * This is built from the same rule table the defaults are built from, on
 * purpose. A table typed out by hand alongside the rules would start correct
 * and drift within a month, and then the screen that explains the model would
 * be explaining a model nobody was using. Here they cannot disagree: change a
 * rule and the table changes with it.
 *
 * An area with no rules in it is dropped rather than shown empty.
 */
export const capabilityMatrix = (): MatrixSection[] =>
  AREAS.map((area) => ({
    ...area,
    rows: RULES.filter((rule) => rule.area === area.area).map((rule) => ({
      rule,
      cells: TIER_ORDER.map((tier) => ({ tier, allowed: rule.tiers.includes(tier) })),
    })),
  })).filter((section) => section.rows.length > 0);

/* ------------------------------------------------------------------------ */
/* Which role a new person starts on                                         */
/* ------------------------------------------------------------------------ */

/**
 * Where the company's answer is kept on its own record. The Add person form
 * opens with the role box empty, so whoever is adding somebody has to remember
 * which role is the right one — and the roles that ship all look alike. One
 * stored answer removes the guess.
 */
export const NEW_PERSON_ROLE_KEY = 'new_person_default_role';

/**
 * Read that answer back. Anything that is not a non-empty piece of text means
 * nobody has chosen, and the form is left exactly as it is today. It is
 * deliberately not checked against the current list of roles here: a role that
 * has since been deleted should leave the form empty, which is what an id
 * matching nothing already does, rather than throwing away the company's answer
 * because a list had not finished loading.
 */
export const readNewPersonRole = (raw: unknown): string =>
  typeof raw === 'string' && raw.trim() ? raw.trim() : '';

export default buildDefaultPermission;
