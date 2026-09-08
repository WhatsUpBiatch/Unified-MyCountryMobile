/* Sandbox mock API. Answers every /api/* call locally; nothing leaves the
 * machine, so no request can reach or change production.
 *
 * There are 345 routes and hand-writing all of them is not worth it, so named
 * handlers cover the screens people actually work on and a generic fallback
 * answers the rest in the right envelope. An unhandled endpoint therefore
 * yields a plausible empty table rather than a crash, and the console names it
 * so it is easy to promote into a real handler when someone needs it. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as f from './factory.mjs';
import { persona, ROLES, COMPANY_UUID } from './personas.mjs';

/* Persisted to disk, not held in memory: editing anything under mock/ restarts
   Vite, and an in-memory role silently reverted to ADMIN on every save — which
   looks exactly like the role switcher being broken. */
const ROLE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.role');

const readRole = () => {
  try {
    const saved = fs.readFileSync(ROLE_FILE, 'utf8').trim();
    if (ROLES[saved]) return saved;
  } catch {
    /* first run, no file yet */
  }
  return ROLES[process.env.SANDBOX_ROLE] ? process.env.SANDBOX_ROLE : 'ADMIN';
};

let currentRole = readRole();

const writeRole = (role) => {
  currentRole = role;
  try {
    fs.writeFileSync(ROLE_FILE, role);
  } catch {
    /* a read-only checkout still works, it just forgets on restart */
  }
};

/* Shape A from the real controllers. Consumers read
   res.data.data.result, and the shallower res.data.result readers fall through
   to the same object, so this one shape satisfies both. */
const ok = (result) => ({ success: true, data: { message: 'Mocked by sandbox', result } });

const page = (rows, { page: p = 1, limit = 25 } = {}) =>
  ok({
    rows,
    total: rows.length,
    totalItems: rows.length,
    totalRecords: rows.length,
    count: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / (limit || 25))),
    currentPage: p,
  });

const STATES = ['available', 'busy', 'away', 'offline'];
const DIRECTIONS = ['inbound', 'outbound'];
const CALL_STATUS = ['answered', 'missed', 'voicemail', 'abandoned'];

/* The first three locations get people; the fourth deliberately gets none. */
const SITE_UUIDS = [f.uuid('site0'), f.uuid('site1'), f.uuid('site2')];
const SITE_NAMES = ['Austin HQ', 'London', 'Singapore'];

const user = (i) => {
  const p = f.person(`u${i}`);
  return {
    uuid: f.uuid(`u${i}`),
    first_name: p.first_name,
    last_name: p.last_name,
    name: p.name,
    full_name: p.name,
    email: p.email,
    phone: f.phone(`u${i}`),
    extension: String(1001 + i),
    role: f.choice(['ADMIN', 'MANAGER', 'AGENT', 'SUB-ADMIN'], `r${i}`),
    status: f.bool(`s${i}`, 0.85) ? 'Y' : 'N',
    socket_status: f.choice(STATES, `st${i}`),
    job_title: f.department(i),
    /* Every user belongs to a location, so the per-site headcount on the
       Company screen can be filtered rather than answering 24 for all of
       them. Uneven on purpose: a location with nobody in it is a real state
       the card has copy for. */
    site_uuid: SITE_UUIDS[i % 3],
    /* `site.name` as well as `site_detail`: the People roster reads
       `person.site.name` for the Location column and joins `site_uuid` to the
       site list for the "City, Country" line under it. With only
       `site_detail` the column showed a dash above a place. */
    site: { name: SITE_NAMES[i % 3], uuid: SITE_UUIDS[i % 3] },
    site_detail: { name: SITE_NAMES[i % 3] },
    /* The outbound number, shown under the extension. Not everyone has one —
       the column has copy for that and it should be reachable. */
    caller_id: i % 3 === 0 ? f.phone(`cid${i}`) : '',
    department: f.department(i),
    created_at: f.daysAgo(i * 3 + 2),
    profile: null,
  };
};

const call = (i) => ({
  uuid: f.uuid(`c${i}`),
  sipcall_id: f.uuid(`sip${i}`),
  direction: f.choice(DIRECTIONS, `dir${i}`),
  status: f.choice(CALL_STATUS, `cs${i}`),
  from_number: f.phone(`from${i}`),
  to_number: f.phone(`to${i}`),
  caller_name: f.person(`cn${i}`).name,
  agent_name: f.person(`u${i % 8}`).name,
  duration: f.duration(i),
  talk_time: f.duration(i),
  wait_time: f.number(`w${i}`, 0, 90),
  recording: null,
  queue_name: f.choice(['Support', 'Sales', 'Billing'], `q${i}`),
  created_at: f.minutesAgo(i * 17 + 4),
  date: f.minutesAgo(i * 17 + 4),
});

/* A call queue as the queues screen reads one.

   Queue membership is also the platform's nearest thing to an ACD skill, which
   is what the People roster's "ACD skills" column lists — so `members` serves
   both, and carries the member's name because the queue table draws an avatar
   stack from it rather than a count.

   Three fields the list cannot do without and the old row did not have:

     `_id`  — what a number's forwarding points at. The Numbers column is that
             relationship read backwards, so with no id every queue reads "No
             number" however many are pointed at it.
     `site_uuid` — an object with a name, not the uuid string its own key
             suggests. That is what the endpoint sends and what the cell reads.
     `settings` — the JSON blob holding how calls are shared and when the queue
             is open. Both columns came back "---" and "Not set" without it.

   Deliberately uneven: one queue is open only on weekdays, one has nobody in
   it, and one has more members than the stack shows so the "+N" overflow can
   be seen. */
const RING_STRATEGIES = ['ring-all', 'longest-idle-agent', 'round-robin', 'top-down'];

const queue = (i) => {
  const memberCount = i === 3 ? 0 : i === 1 ? 8 : f.number(`qm${i}`, 2, 5);
  return {
    _id: `queue-${i}`,
    uuid: f.uuid(`q${i}`),
    members: f.seq(memberCount, (n) => n).map((n) => {
      const who = (i * 3 + n) % 24;
      return { user_uuid: f.uuid(`u${who}`), name: f.person(`u${who}`).name, imageUrl: '' };
    }),
    /* DEPT_NAMES, not `f.department` — that picks by hash, so six queues drew
        "Onboarding Queue" three times and the list could not be scanned. */
    name: `${DEPT_NAMES[i % DEPT_NAMES.length]} Queue`,
    extension: String(6000 + i),
    site_uuid: { uuid: SITE_UUIDS[i % 3], name: SITE_NAMES[i % 3] },
    settings: JSON.stringify({
      ring_strategy: { value: RING_STRATEGIES[i % RING_STRATEGIES.length] },
      /* Every fourth queue keeps weekday hours; the rest never close. */
      operational_hours: { type: i % 4 === 2 ? 'weekly' : '24_hours' },
    }),
    strategy: RING_STRATEGIES[i % RING_STRATEGIES.length],
    agents_count: memberCount,
    waiting: f.number(`wt${i}`, 0, 5),
    answered: f.number(`an${i}`, 10, 300),
    abandoned: f.number(`ab${i}`, 0, 25),
    sla: f.number(`sla${i}`, 70, 99),
    status: 'active',
    created_at: f.daysAgo(i * 12 + 6),
  };
};

/* A number as the numbers list actually returns one.

   The old row was invented from the column headings and matched none of the
   real field names, so every screen that reads it showed a table of dashes:
   `type` where the code reads `did_type`, a plain `assigned_to` string where it
   reads a nested `User`, no `forward_call_actions` at all — which is where both
   the routing AND the editable label live — and no `features` or `Site`.

   The eight states below are the ones the cells branch on, so each branch is
   reachable: assigned to a person; forwarded to an extension, a department, a
   queue, an IVR and an outside phone; a fax line (which suppresses the
   forwarding cell entirely); and numbers sitting unused with and without a
   label, because "Add label" and "Assign to extension" are only offered on
   those. */
const FORWARD_TARGETS = [
  null,
  null,
  { type: 'EXTENSION', name: 'Zara Adeyemi', value: '1001' },
  { type: 'QUEUE', name: 'Retention Queue', value: 'queue-2' },
  /* `value` as well as a name: the queues screen finds a queue's numbers by
     matching this against the queue's own `_id`. */
  { type: 'QUEUE', name: 'Billing Queue', value: 'queue-0' },
  { type: 'IVR', name: 'Main menu', value: 'ivr-0' },
  { type: 'PHONE', name: '15125550143' },
  { type: 'VOICEMAIL', name: 'Sales voicemail', value: '7002' },
];

const numberRow = (i) => {
  const target = FORWARD_TARGETS[i % FORWARD_TARGETS.length];
  /* A fax line every seventh number. Fax rows carry no forwarding, which is
     the one case the cell short-circuits before parsing anything. */
  const isFax = i % 7 === 3;
  /* Every third number is held by a person; the rest are free to assign. */
  const holder = i % 3 === 0 ? f.person(`u${i}`) : null;
  /* Two thirds carry a label. The rest are what "Add label" is for, and a
     table where every row already has one never shows that link. */
  const label = i % 3 === 2 ? '' : `${SITE_NAMES[i % 3]} ${['main', 'sales', 'support', 'invoices'][i % 4]}`;

  const actions =
    isFax || (!target && !label)
      ? null
      : JSON.stringify({
          did_info: { did_name: label },
          call_handling: target ? { business_hours: target } : {},
        });

  return {
    uuid: f.uuid(`n${i}`),
    did_number: f.phone(`n${i}`),
    /* The name a number was bought with. `labelOf` prefers the one in the blob
       above and falls back to this, so the two differ on purpose. */
    did_name: `${f.city(i)} line`,
    did_type: f.choice(['L', 'N', 'T', 'M'], `dt${i}`),
    is_fax_enabled: isFax,
    /* `extension` as well as the name. Call coverage branches on it: with no
       extension it decided an owned number still needed assigning to one, and
       told the admin to "assign the number to an extension first" on a row
       whose own next column named the person holding it. */
    User: holder
      ? {
          uuid: f.uuid(`u${i}`),
          first_name: holder.first_name,
          last_name: holder.last_name,
          extension: String(1001 + i),
        }
      : null,
    forward_call_actions: actions,
    features: [
      'voice_in',
      'voice_out',
      ...(i % 2 === 0 ? ['sms_in', 'sms_out'] : []),
    ],
    Site: { uuid: SITE_UUIDS[i % 3], name: SITE_NAMES[i % 3] },
    country: 'United States',
    monthly_cost: f.money(i, 1, 15),
    status: 'active',
    created_at: f.daysAgo(i * 9 + 5),
  };
};

/* Who a number is registered to, and where it is served.

   Regulators require a named holder and a service address for most number
   ranges, and the three tabs of Identities & addresses read three different
   endpoints with three different row shapes. None of them were mocked, so all
   three tables drew the right headings over completely empty rows.

   Uneven on purpose: an individual and two businesses, one identity with no
   proof uploaded at all, one address without a description, and verifications
   spread across every status the column can show — including one that has
   already expired, which is the state the countdown has to cope with. */
const IDENTITIES = () => [
  {
    identity_id: f.uuid('id0'),
    identity_type: 'Individual',
    is_primary: true,
    identity: { firstname: 'Hannah', lastname: 'Okafor', prefix: '+1', phone: '5125559618', email: 'hannah.okafor@example.com' },
    address_count: 2,
    proof_count: 2,
  },
  {
    identity_id: f.uuid('id1'),
    identity_type: 'Business',
    identity: { firstname: 'Sandbox', lastname: 'Communications', prefix: '+44', phone: '2079460321', email: 'ops@sandboxcomms.example' },
    address_count: 1,
    proof_count: 1,
  },
  {
    identity_id: f.uuid('id2'),
    identity_type: 'Business',
    identity: { firstname: 'Sandbox', lastname: 'Singapore Pte', prefix: '+65', phone: '69700142', email: 'sg@sandboxcomms.example' },
    address_count: 1,
    /* Nothing uploaded yet. The count is what tells somebody a record is
       incomplete, so a table where every row reads 2 never shows it. */
    proof_count: 0,
  },
];

const ADDRESSES = () => [
  {
    address_id: f.uuid('ad0'),
    identity_id: f.uuid('id0'),
    is_primary: true,
    address: {
      country: 'United States',
      state: 'Texas',
      city: 'Austin',
      zipcode: '78701',
      address: '600 Congress Ave, Suite 1400',
      description: 'Head office',
    },
    address_proof: [{ uuid: f.uuid('ap0') }, { uuid: f.uuid('ap1') }],
  },
  {
    address_id: f.uuid('ad1'),
    identity_id: f.uuid('id1'),
    address: {
      country: 'United Kingdom',
      state: 'England',
      city: 'London',
      zipcode: 'EC2A 4NE',
      address: '55 Old Street',
      /* No description. The column has to survive one. */
      description: '',
    },
    address_proof: [{ uuid: f.uuid('ap2') }],
  },
  {
    address_id: f.uuid('ad2'),
    identity_id: f.uuid('id2'),
    address: {
      country: 'Singapore',
      state: 'Central',
      city: 'Singapore',
      zipcode: '018956',
      address: '1 Marina Boulevard, #20-01',
      description: 'Registered office',
    },
    address_proof: [],
  },
];

/* Real dialling codes rather than the generator's US numbers: the row shows a
   flag beside the number and a country beside that, and a British registration
   under a US flag reads as a bug on a screen whose whole job is registrations. */
const VERIFICATIONS = () => [
  {
    uuid: f.uuid('vf0'),
    did_number: '+442079460198',
    country: 'United Kingdom',
    city: 'London',
    status: 'approved',
    awaiting_registration: false,
    expires_at: f.daysAgo(-96),
  },
  {
    uuid: f.uuid('vf1'),
    did_number: '+493088776120',
    country: 'Germany',
    city: 'Berlin',
    status: 'pending',
    awaiting_registration: true,
    expires_at: f.daysAgo(-4),
  },
  {
    uuid: f.uuid('vf2'),
    did_number: '+33170610455',
    country: 'France',
    city: 'Paris',
    status: 'rejected',
    awaiting_registration: false,
    expires_at: f.daysAgo(-11),
  },
  {
    /* Already past its date. Nothing else on the screen is in this state and
       it is the one the countdown has to not print as a negative number. */
    uuid: f.uuid('vf3'),
    did_number: '+34911982307',
    country: 'Spain',
    city: 'Madrid',
    status: 'pending',
    awaiting_registration: true,
    expires_at: f.daysAgo(6),
  },
];

/* A released number is a different table: no owner to act on, and the fields
   are spelled differently again — `user_details` rather than `User`,
   `site_data` rather than `Site`. One row was never assigned, because the cell
   has copy for that and it should be reachable. */
const releasedRow = (i) => {
  const held = i === 1 ? null : f.person(`ru${i}`);
  return {
    uuid: f.uuid(`rn${i}`),
    did_number: f.phone(`rn${i}`),
    did_name: `${f.city(i + 4)} line`,
    did_type: f.choice(['L', 'T'], `rdt${i}`),
    user_details: held ? { first_name: held.first_name, last_name: held.last_name } : null,
    site_data: { name: SITE_NAMES[i % 3] },
    buy_date: f.daysAgo(i * 40 + 120),
    released_at: f.daysAgo(i * 11 + 3),
  };
};

const campaign = (i) => ({
  uuid: f.uuid(`cm${i}`),
  name: `${f.choice(['Spring', 'Renewal', 'Winback', 'Onboarding'], `cn${i}`)} campaign ${i + 1}`,
  status: f.choice(['running', 'paused', 'completed', 'draft'], `cst${i}`),
  type: 'outbound',
  total_leads: f.number(`tl${i}`, 50, 5000),
  contacted: f.number(`co${i}`, 10, 2000),
  connected: f.number(`cc${i}`, 5, 900),
  created_at: f.daysAgo(i * 6 + 1),
});

const contact = (i) => {
  const p = f.person(`ct${i}`);
  return {
    uuid: f.uuid(`ct${i}`),
    first_name: p.first_name,
    last_name: p.last_name,
    name: p.name,
    email: p.email,
    phone: f.phone(`ct${i}`),
    company: `${f.city(i)} Holdings`,
    tags: [f.department(i)],
    created_at: f.daysAgo(i * 4),
  };
};

const DEPT_NAMES = ['Billing', 'Onboarding', 'Retention', 'Support', 'Sales', 'Engineering'];

/* Departments carry their members, because that is how the People roster fills
   its Groups column — `departmentByUser` walks each department's `members` and
   maps user uuid to group name. A count alone left the column reading "—" for
   everybody. Deliberately partial: a person in no group is a real row and the
   column has to survive it. */
const department = (i) => {
  const members = f
    .seq(f.number(`dm${i}`, 2, 5), (n) => n)
    .map((n) => ({ user_uuid: f.uuid(`u${(i + n * 4) % 24}`) }));
  return {
    uuid: f.uuid(`d${i}`),
    /* Distinct names. `f.department` picks from a short list by hash, so six
       departments drew the same name twice — and a person in both then read
       "Onboarding, Onboarding" in the roster's Groups column. */
    name: DEPT_NAMES[i % DEPT_NAMES.length],
    extension: String(7000 + i),
    members,
    members_count: members.length,
    /* Most groups have somebody running them. The Manager column has copy for
       one that does not, and a table where every row is filled never shows it. */
    manager:
      i % 3 === 1
        ? null
        : {
            uuid: f.uuid(`mgu${i}`),
            first_name: f.person(`mg${i}`).first_name,
            last_name: f.person(`mg${i}`).last_name,
          },
    site_name: f.city(i),
    status: 'active',
  };
};

const message = (i) => ({
  uuid: f.uuid(`m${i}`),
  from_number: f.phone(`mf${i}`),
  to_number: f.phone(`mt${i}`),
  body: f.choice(
    ['Thanks, that worked.', 'Can you call me back?', 'Order confirmed.', 'Running late.'],
    `mb${i}`,
  ),
  direction: f.choice(DIRECTIONS, `md${i}`),
  status: 'delivered',
  created_at: f.minutesAgo(i * 25 + 3),
});

const meeting = (i) => ({
  uuid: f.uuid(`mt${i}`),
  title: f.choice(['Standup', 'Client review', 'Onboarding call', '1:1'], `mtt${i}`),
  host_name: f.person(`u${i}`).name,
  start_time: f.daysAgo(-(i + 1)),
  duration: 30,
  participants: f.number(`pt${i}`, 2, 9),
  status: 'scheduled',
});

const role = (i) => {
  const names = ['ADMIN', 'MANAGER', 'SUB-ADMIN', 'AGENT', 'Sales lead', 'Call reviewer'];
  return {
    uuid: f.uuid(`rl${i}`),
    /* `type` and `role_uuid` as well as `uuid`. Every role picker in the
       product identifies a role by `uuid` when it is custom and by `role_uuid`
       when it is not, so with neither field set they all resolved to the empty
       string — which react-select read as "every option is the selected one"
       and drew the whole menu as selected. `company_uuid` is what tells a
       platform role from a company's own. */
    role_uuid: f.uuid(`rlsys${i}`),
    type: i >= 4 ? 'custom' : 'system',
    company_uuid: i >= 4 ? COMPANY_UUID : 'PREDEFINED',
    name: names[i % names.length],
    description: 'Sandbox role',
    /* `user_count` as well: the roles screen reads five different key spellings
       depending on which endpoint answered, and the real list endpoint sends
       this one. */
    user_count: f.number(`uc${i}`, 1, 30),
    users_count: f.number(`uc${i}`, 1, 30),
    is_custom: i >= 4,
  };
};

/* An IVR menu. `site` is a JSON *string* holding a `{ value, label }` pair,
   not a uuid and not an object — the cell JSON.parses it and reads `.label`,
   so anything else lands in its catch and the column stays empty. */
const IVR_NAMES = ['Main menu', 'After-hours menu', 'Holiday menu', 'Support menu', 'Sales menu'];

const ivr = (i) => ({
  uuid: f.uuid(`iv${i}`),
  name: IVR_NAMES[i % IVR_NAMES.length],
  extension: String(8000 + i),
  site: JSON.stringify({ value: SITE_UUIDS[i % 3], label: SITE_NAMES[i % 3] }),
  options_count: f.number(`oc${i}`, 2, 8),
  status: 'active',
  created_at: f.daysAgo(i * 15 + 9),
});

/* Company locations. The screen reads `is_default === '1'` to find the main
   one, so exactly one row carries it — with none, the page shows "No default
   location found", which is a real state but not the one anybody is designing
   against. The rest are deliberately uneven: one fully filled in, one missing
   its address, so the "---" placeholders are exercised on purpose rather than
   because the mock forgot. */
const SITES = [
  {
    uuid: f.uuid('site0'),
    site_id: 'LOC-1001',
    name: 'Austin HQ',
    is_default: '1',
    address: '100 Example Street, Austin, TX 78701',
    country: 'United States',
    state: 'Texas',
    city: 'Austin',
    postal_code: '78701',
    timezone: 'America/Chicago',
    users_count: 18,
    numbers_count: 6,
  },
  {
    uuid: f.uuid('site1'),
    site_id: 'LOC-1002',
    name: 'London',
    is_default: '0',
    address: '4 Example Road, London EC2A 4NE',
    country: 'United Kingdom',
    state: 'England',
    city: 'London',
    postal_code: 'EC2A 4NE',
    timezone: 'Europe/London',
    users_count: 9,
    numbers_count: 3,
  },
  {
    uuid: f.uuid('site2'),
    site_id: 'LOC-1003',
    name: 'Singapore',
    is_default: '0',
    address: '',
    country: 'Singapore',
    state: '',
    city: 'Singapore',
    postal_code: '',
    timezone: 'Asia/Singapore',
    users_count: 4,
    numbers_count: 0,
  },
  {
    uuid: f.uuid('site3'),
    site_id: 'LOC-1004',
    name: 'Dubai',
    is_default: '0',
    address: 'Office 12, Example Tower, Dubai',
    country: 'United Arab Emirates',
    state: 'Dubai',
    city: 'Dubai',
    postal_code: '',
    timezone: 'Asia/Dubai',
    users_count: 6,
    numbers_count: 2,
  },
];

/* The company rule, as the section store returns it.

   `assembleFromSections` turns `sections[key].settings` into `settings[key]`,
   and `readRuleFlags` then looks for `apply` / `locked` on that node (falling
   back to the older single `override`). Two fields are locked here on purpose:
   with none, every personal-settings screen shows "all yours to change" and the
   governed half of those screens is never seen. */
const COMPANY_RULE_SECTIONS = {
  recording: { settings: { apply: true, locked: true }, version: 3 },
  ai_call_monitoring: { settings: { apply: true, locked: true }, version: 2 },
  transcription: { settings: { apply: false, locked: false }, version: 1 },
  display_number: { settings: { apply: false, locked: false }, version: 1 },
  operational_hours: { settings: { apply: false, locked: false, regional: { apply: false, locked: false } }, version: 4 },
  voicemail_pin: { settings: { apply: false, locked: false }, version: 1 },
  role: { settings: { apply: false, locked: false }, version: 1 },
};

/* The recording library. `greetingsForSlot` picks by `type`, so each slot needs
   at least one row of its own kind plus something of the generic 'greeting'
   type to fall back to — otherwise every picker on every greetings screen opens
   empty and the row cannot be exercised at all. */
const GREETINGS = [
  { uuid: f.uuid('g1'), name: 'Default welcome', filename: 'default-welcome.wav', type: 'welcome_greeting', is_default: 1, duration: 6 },
  { uuid: f.uuid('g2'), name: 'Out of hours welcome', filename: 'ooh-welcome.wav', type: 'welcome_greeting', is_default: 0, duration: 9 },
  { uuid: f.uuid('g3'), name: 'Piano hold loop', filename: 'piano-hold.wav', type: 'on_hold_music', is_default: 1, duration: 62 },
  { uuid: f.uuid('g4'), name: 'Classic ringback', filename: 'ringback.wav', type: 'ring_tone', is_default: 1, duration: 4 },
  { uuid: f.uuid('g5'), name: 'My voicemail greeting', filename: 'vm-personal.wav', type: 'voicemail', is_default: 0, duration: 11 },
  { uuid: f.uuid('g6'), name: 'Standard voicemail', filename: 'vm-standard.wav', type: 'voicemail', is_default: 1, duration: 8 },
  { uuid: f.uuid('g7'), name: 'Main menu prompt', filename: 'menu-main.wav', type: 'prompt', is_default: 0, duration: 14 },
  { uuid: f.uuid('g8'), name: 'Company announcement', filename: 'announce.wav', type: 'greeting', is_default: 0, duration: 12 },
];

/* Sessions signed in as you. The screen filters to `user_uuid === your uuid`
   and marks the row whose `uuid` equals your `device_token` as the current one,
   so both have to line up with the persona or the list comes back empty and the
   "Current device" badge never appears.

   Deliberately mixed: two browsers, a desktop app and a phone, from three
   addresses — this list exists so somebody can spot the session they do not
   recognise, and a list of identical rows cannot be scanned for the odd one. */
const SESSIONS = (role) => {
  const uuid = f.uuid(`user-${role}`);
  const person = f.person(`me-${role}`);
  const detail = {
    first_name: person.first_name,
    last_name: person.last_name,
    email: person.email,
    extension: EXTENSIONS_FOR_SESSIONS[role] || '1001',
    profile: null,
  };
  return [
    {
      uuid: 'sandbox-device',
      user_uuid: uuid,
      user_detail: detail,
      device_type: 'W',
      user_agent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      ip_address: '82.14.201.7',
      last_active_at: new Date(Date.now() - 2 * 6e4).toISOString(),
    },
    {
      uuid: f.uuid('sess-mac'),
      user_uuid: uuid,
      user_detail: detail,
      device_type: 'W',
      user_agent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      ip_address: '82.14.201.7',
      last_active_at: new Date(Date.now() - 5 * 36e5).toISOString(),
    },
    {
      uuid: f.uuid('sess-phone'),
      user_uuid: uuid,
      user_detail: detail,
      device_type: 'M',
      user_agent: 'MyCountryMobile/4.2.1 (iPhone; iOS 17.5; Scale/3.00)',
      ip_address: '203.0.113.44',
      last_active_at: new Date(Date.now() - 3 * 864e5).toISOString(),
    },
    {
      uuid: f.uuid('sess-old'),
      user_uuid: uuid,
      user_detail: detail,
      device_type: 'W',
      user_agent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      ip_address: '198.51.100.9',
      last_active_at: new Date(Date.now() - 21 * 864e5).toISOString(),
    },
  ];
};

const EXTENSIONS_FOR_SESSIONS = { ADMIN: '1001', MANAGER: '1002', 'SUB-ADMIN': '1003', AGENT: '1004' };

/* The administrators and their scopes, for the Admin scope screen. See the
   handler below for why they are shaped this way. */
const ADMIN_SCOPES = () => [
  { uuid: f.uuid(`user-${currentRole}`), system_role: 'ADMIN', admin_scope: null },
  {
    uuid: f.uuid('u4'),
    system_role: 'SUB-ADMIN',
    admin_scope: { level: 'location', location_uuids: [SITE_UUIDS[0], SITE_UUIDS[1]], group_uuids: [] },
  },
  {
    uuid: f.uuid('u7'),
    system_role: 'SUB-ADMIN',
    admin_scope: { level: 'group', location_uuids: [], group_uuids: [f.uuid('d1')] },
  },
  { uuid: f.uuid('u1'), system_role: 'MANAGER', admin_scope: null },
  { uuid: f.uuid('u13'), system_role: 'SUB-ADMIN', admin_scope: null },
];

/* Every person's account state. `/api/user/list` does not carry it, so the
   roster asks for all of them at once and joins by uuid; with no handler the
   request failed and the screen showed no pill at all rather than a wrong one —
   correct behaviour, but it meant the column could never be seen working.

   Mostly ACTIVE, with one of each other state: the three read differently and
   each has its own note. */
const PERSON_STATES = () =>
  f.seq(24, (i) => ({
    uuid: f.uuid(`u${i}`),
    state: i === 5 ? 'PENDING' : i === 11 ? 'SUSPENDED' : 'ACTIVE',
  }));

/* ── AI tools ──────────────────────────────────────────────────────────────

   Five screens read from these: AI receptionists, chat agents, the playground,
   sessions and settings. None were mocked, so the generic fallback answered
   every one of them with rows from the user list — eight receptionists all
   called "Untitled", none live, every metric zero.

   The data is deliberately uneven, because these screens are almost entirely
   about state: a receptionist that is live and one that is paused and one still
   a draft; agents with a caller ID assigned and agents without; sentiment that
   has been measured and sentiment that has not. A list where every row is
   identical shows one branch of each cell and hides the rest. */

const RECEPTIONISTS = [
  {
    uuid: f.uuid('rec0'),
    agent_uuid: f.uuid('rec0'),
    agentName: 'Front desk',
    agentType: 'voice',
    status: 'live',
    description: 'Reception · 24/7 voice assistant',
    /* A number assigned, so the Caller Id cell shows one rather than the
       "Assign Caller Id" link. Both states are worth seeing. */
    did_uuid: [{ uuid: f.uuid('n0'), did_number: '+15125559618' }],
    calls_handled: 412,
    resolution_rate: 78,
    average_call_duration: 154,
    sentiment_calls: 412,
    avg_sentiment: 74,
    sentiment_label: 'positive',
    sentiment_counts: { positive: 305, neutral: 78, negative: 29 },
    updated_at: f.daysAgo(1),
  },
  {
    uuid: f.uuid('rec1'),
    agent_uuid: f.uuid('rec1'),
    agentName: 'After hours',
    agentType: 'voice',
    status: 'live',
    description: 'Out of hours · takes messages',
    did_uuid: [{ uuid: f.uuid('n5'), did_number: '+15125555800' }],
    calls_handled: 96,
    resolution_rate: 54,
    average_call_duration: 88,
    sentiment_calls: 96,
    avg_sentiment: 41,
    sentiment_label: 'neutral',
    sentiment_counts: { positive: 30, neutral: 44, negative: 22 },
    updated_at: f.daysAgo(3),
  },
  {
    uuid: f.uuid('rec2'),
    agent_uuid: f.uuid('rec2'),
    agentName: 'Billing questions',
    agentType: 'voice',
    status: 'paused',
    description: 'Billing · answers account questions',
    did_uuid: [],
    calls_handled: 58,
    resolution_rate: 31,
    average_call_duration: 210,
    /* Measured, and the answer is not good. A demo where every sentiment is
       positive never shows the cell's other colours. */
    sentiment_calls: 58,
    avg_sentiment: 18,
    sentiment_label: 'negative',
    sentiment_counts: { positive: 6, neutral: 14, negative: 38 },
    updated_at: f.daysAgo(6),
  },
  {
    uuid: f.uuid('rec3'),
    agent_uuid: f.uuid('rec3'),
    agentName: 'Order status',
    agentType: 'voice',
    status: 'inactive',
    description: 'Draft · not answering yet',
    did_uuid: [],
    /* Never taken a call, so there is nothing to analyse. This is what the
       "Not analyzed" pill is for. */
    calls_handled: 0,
    resolution_rate: 0,
    average_call_duration: 0,
    sentiment_calls: 0,
    avg_sentiment: 0,
    sentiment_counts: null,
    forward_call_actions: { receptionist_builder: { draft: true } },
    updated_at: f.daysAgo(11),
  },
];

const CHAT_AGENTS = [
  {
    uuid: f.uuid('cha0'),
    /* `_id` as well: the AI settings pickers build their options with
       `value: agent._id`, so without it every channel showed "Select agent"
       however it was configured. */
    _id: f.uuid('cha0'),
    agent_uuid: f.uuid('cha0'),
    agentName: 'Support bot',
    name: 'Support bot',
    agentType: 'chat',
    status: 'live',
    description: 'chat',
    conversations: 268,
    resolution_rate: 71,
    confidence: 82,
    sentiment_calls: 268,
    avg_sentiment: 68,
    sentiment_label: 'positive',
    sentiment_counts: { positive: 180, neutral: 61, negative: 27 },
    updated_at: f.daysAgo(2),
  },
  {
    uuid: f.uuid('cha1'),
    _id: f.uuid('cha1'),
    agent_uuid: f.uuid('cha1'),
    agentName: 'Sales assistant',
    name: 'Sales assistant',
    agentType: 'chat',
    status: 'paused',
    description: 'chat',
    conversations: 41,
    resolution_rate: 39,
    confidence: 55,
    sentiment_calls: 0,
    avg_sentiment: 0,
    sentiment_counts: null,
    updated_at: f.daysAgo(9),
  },
];

/* Sessions: every AI call and chat, with its transcript and outcome.

   The field names here are the screen's, not the API's house style, because
   the screen is what has to read them: `startedAt` and `createdAt` in camel
   case (a snake_case `started_at` fails the date-range filter and every row
   silently disappears), `durationMs` rather than seconds, `channel: 'call'`
   for voice, and the contact's details inside `collectedData` as
   `{ value }` pairs.

   Outcome is derived rather than stored — `status: 'active'`, `handoff` and
   `scheduledCallback` decide it — so all four states are represented below;
   with only resolved sessions the outcome filter has nothing to filter. */
const AI_SESSIONS = () =>
  f.seq(14, (i) => {
    const isCall = i % 3 !== 2;
    const agent = isCall ? RECEPTIONISTS[i % RECEPTIONISTS.length] : CHAT_AGENTS[i % 2];
    const person = f.person(`sc${i}`);
    const startedAt = f.minutesAgo(i * 137 + 20);
    /* One of each: still running, handed to a person, a callback booked, and
       the rest resolved by the agent alone. */
    const active = i === 0;
    const handoff = i % 5 === 1;
    const callback = i % 7 === 3;

    return {
      uuid: f.uuid(`ses${i}`),
      sessionId: f.uuid(`ses${i}`),
      channel: isCall ? 'call' : 'chat',
      agentId: agent.uuid,
      agent_id: agent.uuid,
      agentName: agent.agentName,
      agent_name: agent.agentName,
      startedAt,
      createdAt: startedAt,
      durationMs: f.number(`sd${i}`, 25, 420) * 1000,
      totalCostUSD: f.number(`scst${i}`, 2, 40) / 100,
      status: active ? 'active' : 'ended',
      handoff: handoff && !active,
      scheduledCallback: callback && !active && !handoff,
      callerId: isCall ? f.phone(`sc${i}`) : '',
      collectedData: {
        name: { value: person.name },
        ...(isCall ? { phone: { value: f.phone(`sc${i}`) } } : { email: { value: person.email } }),
      },
      /* `sentiment` is the label and `sentiment_scores` the three-way split
         the bar in the column draws. Without them the cell renders an empty
         bar and a dash, which reads as "neutral" rather than "not measured". */
      sentiment: ['positive', 'neutral', 'negative', 'positive'][i % 4],
      sentiment_scores: [
        { positive: 0.82, neutral: 0.13, negative: 0.05 },
        { positive: 0.31, neutral: 0.55, negative: 0.14 },
        { positive: 0.09, neutral: 0.22, negative: 0.69 },
        { positive: 0.74, neutral: 0.2, negative: 0.06 },
      ][i % 4],
      summary: [
        'Asked when the office opens and was told.',
        'Wanted a copy of last month\'s invoice.',
        'Reported a fault and was passed to an engineer.',
        'Asked to be called back tomorrow morning.',
      ][i % 4],
      transcript:
        'Sandbox transcript — the caller asked a question and the agent answered it.',
    };
  });

/* Named handlers, matched on the path ending. */
const HANDLERS = [
  ['/api/user/info', () => ok(persona(currentRole))],
  ['/api/admin/organisation/get-meta-data', () =>
    ok({
      uuid: COMPANY_UUID,
      source_name: 'Sandbox Communications',
      fav_title: 'MCM Sandbox',
      /* Non-empty or OrganizationProvider renders a loader forever. Not a real
         key — Stripe Elements simply will not initialise, which is fine here. */
      stripe_publish_key: 'pk_test_sandbox_placeholder_not_a_real_key',
      /* A real company always has a brand colour, and a great deal is keyed
         on it: the selected row of every react-select menu, the primary button
         in every portalled dialog. Left empty, OrganizationProvider never sets
         --primary and all of it falls back to shadcn's near-black, which reads
         as a rendering fault rather than as an unbranded account. Same blue as
         the --accent token so the sandbox is one colour throughout. */
      primary_color: '#2563eb',
      secondary_color: '#dbeafe',
      large_logo: '',
      small_logo: '',
      login_image: '',
      fav_icon: '',
    })],
  ['/api/tenant/user/company-settings/list', () =>
    ok({ sections: COMPANY_RULE_SECTIONS, uuid: 'company-settings', versions: {} })],
  /* Not `page()`: this screen reads `data.data.result` as the array itself. */
  ['/api/user/device-securities', (b) => {
    const term = String(b?.search || '').toLowerCase();
    const rows = SESSIONS(currentRole);
    return ok(
      term
        ? rows.filter(
            (r) =>
              r.user_agent.toLowerCase().includes(term) ||
              r.ip_address.includes(term) ||
              `${r.user_detail.first_name} ${r.user_detail.last_name}`.toLowerCase().includes(term),
          )
        : rows,
    );
  }],
  ['/api/person/state', (b) => page(PERSON_STATES(), b)],

  /* Who is an administrator, and how far each one reaches.

     Admin scope builds its whole list from this endpoint: a person only
     appears there if a row here gives them MANAGER or SUB-ADMIN. With no
     handler the screen said "Nobody holds an admin role yet", which is a real
     state but the one state where none of the screen can be seen. The signed-in
     persona is ADMIN so the editing path is reachable; the rest are deliberately
     uneven — one already narrowed to two locations, one to a group, the others
     still company-wide, because the list sorts the narrowed ones first and that
     ordering is worth being able to see. */
  /* Matching is by prefix, so this answers the save at
     /api/person/scope/<uuid> too. The screen only checks that the save
     succeeded and then refetches, so a saved scope does not stick between
     reloads — enough to walk the form. */
  ['/api/person/scope', () => page(ADMIN_SCOPES(), { page: 1, limit: 50 })],
  ['/api/tenant/greeting/list', (b) => page(GREETINGS, b)],
  ['/api/site/list', (b) => page(SITES, b)],
  ['/api/user/list', (b) => {
    /* The console narrows this list by a filter array, and screens count a
       cohort by asking for one row and reading the total back. Ignoring the
       filter made every such count report the whole company — a location with
       four people claiming 24, and the Roles screen crediting the owner role
       with every account on the tenant.

       Both spellings are accepted because both are sent: People passes
       `filters`, the roles screen's owner count passes `filter`. */
    const clauses = [...(b?.filters || []), ...(b?.filter || [])];
    const valueOf = (key) => clauses.find((x) => x?.key === key)?.value;
    const siteFilter = valueOf('site_uuid');
    const roleFilter = valueOf('role');

    let rows = f.seq(24, user);
    if (siteFilter) rows = rows.filter((r) => r.site_uuid === siteFilter);
    if (roleFilter) {
      /* Sent either bare or wrapped in an array, depending on the caller. */
      const wanted = [].concat(roleFilter).map(String);
      rows = rows.filter((r) => wanted.includes(String(r.role)));
    }
    return page(rows, b);
  }],
  ['/api/user/role/list', (b) => page(f.seq(6, role), b)],
  ['/api/call-queue/list', (b) => page(f.seq(6, queue), b)],
  ['/api/tenant/report/call-queue/list', (b) => page(f.seq(6, queue), b)],
  ['/api/call-queue/role-based-queue', (b) => page(f.seq(6, queue), b)],
  ['/api/tenant/department/list', (b) => page(f.seq(6, department), b)],
  ['/api/tenant/department/role-based-list', (b) => page(f.seq(6, department), b)],
  ['/api/tenant/report/phone-call-list', (b) => page(f.seq(40, call), b)],
  ['/api/tenant/report/call-list', (b) => page(f.seq(40, call), b)],
  ['/api/tenant/report/agents', (b) =>
    page(
      f.seq(12, (i) => ({
        ...user(i),
        stats: {
          answered: f.number(`aa${i}`, 5, 120),
          missed: f.number(`am${i}`, 0, 15),
          talk_time: f.duration(i),
          avg_handle_time: f.number(`ah${i}`, 60, 400),
        },
      })),
      b,
    )],
  /* One endpoint, three views. "In use" and "Unused" are the same list with
     `type` set, and ignoring it meant both showed every number the account
     has — including, on the In-use tab, rows whose own cells said "Assign to
     extension" and "Set forwarding". A number is in use when somebody holds it
     or its calls are routed somewhere; unused is the complement, which is what
     the Unused tab's own description says it is. */
  ['/api/numbers/list', (b) => {
    const rows = f.seq(18, numberRow);
    const inUse = (r) =>
      Boolean(r.User) ||
      Boolean(JSON.parse(r.forward_call_actions || '{}')?.call_handling?.business_hours?.type);
    const type = b?.type;
    if (type === 'in_use') return page(rows.filter(inUse), b);
    if (type === 'inventory') return page(rows.filter((r) => !inUse(r)), b);
    return page(rows, b);
  }],
  /* Which CRMs this account has actually connected. The screen reads the
     result as an array and calls .find on it, so the generic fallback's object
     crashed the whole page rather than showing nothing connected.

     Two connected, the rest not: the card has a whole second state — a switch,
     a manage menu and a delete — that is only reachable on a connected one. */
  /* The social channels connected to this workspace. Uneven on purpose: the
     card has four states and a list where nothing is connected only ever shows
     one of them. Facebook is live, Instagram is connected but switched off,
     WhatsApp and Telegram are not set up. */
  /* What a destination costs to call or text.

     The screen sends { filter: { key: 'COUNTRY' | 'DIALPREFIX', value } } and
     reads three separate lists off the result — inbound calls, outbound calls
     and SMS — each with its own per-minute or per-message price. Rates differ
     by line type, which is the whole reason the list is not one number, so
     mobile and landline are priced apart here. */
  ['/api/ai/receptionist/list', (b) => page(RECEPTIONISTS, b)],
  ['/api/ai/receptionist/metrics', () =>
    ok({
      /* The tiles above the table sum the whole estate, not one row. */
      calls_handled: RECEPTIONISTS.reduce((n, r) => n + r.calls_handled, 0),
      calls_handled_7d: RECEPTIONISTS.reduce((n, r) => n + r.calls_handled, 0),
      resolution_rate: 63,
      average_call_duration: 147,
      sentiment_calls: RECEPTIONISTS.reduce((n, r) => n + r.sentiment_calls, 0),
      avg_sentiment: 58,
      sentiment_label: 'positive',
      rows: RECEPTIONISTS.map((r) => ({ agent_uuid: r.agent_uuid, ...r })),
    })],
  ['/api/ai/chat-agent/list', (b) => page(CHAT_AGENTS, b)],
  /* Conversations, resolution and confidence come from here, keyed by agent —
     the list rows alone leave those three columns as dashes. */
  ['/api/ai/chat-agent/metrics', () =>
    ok({
      conversations: CHAT_AGENTS.reduce((n, a) => n + a.conversations, 0),
      conversations_7d: CHAT_AGENTS.reduce((n, a) => n + a.conversations, 0),
      resolution_rate: 61,
      avg_confidence: 74,
      sentiment_calls: CHAT_AGENTS.reduce((n, a) => n + a.sentiment_calls, 0),
      avg_sentiment: 68,
      sentiment_label: 'positive',
      rows: CHAT_AGENTS.map((a) => ({
        agent_uuid: a.agent_uuid,
        conversations: a.conversations,
        conversations_7d: a.conversations,
        resolution_rate: a.resolution_rate,
        avg_confidence: a.confidence,
        sentiment_calls: a.sentiment_calls,
        avg_sentiment: a.avg_sentiment,
        sentiment_label: a.sentiment_label,
        sentiment_counts: a.sentiment_counts,
      })),
    })],
  /* `getAgentList` — despite the name — posts to /api/ai/agent/list, not
     /api/agent. The Sessions screen builds its agent lookup from it, so with
     the wrong path mocked every voice session showed its agent as "Deleted"
     and the agent picker offered only the chat agents. Longer path first: the
     matcher takes the first entry the URL starts with, and /api/ai/agent would
     otherwise swallow /api/ai/agent/session. */
  ['/api/ai/agent/session', (b) => {
    let rows = AI_SESSIONS();
    const channel = b?.channel;
    const agentId = b?.agentId;
    /* The tabs send 'voice', the rows carry 'call'. */
    if (channel) rows = rows.filter((r) => r.channel === (channel === 'voice' ? 'call' : channel));
    if (agentId) rows = rows.filter((r) => r.agentId === agentId);
    return page(rows, b);
  }],
  ['/api/ai/agent/list', (b) => page(RECEPTIONISTS, b)],
  ['/api/agent', (b) => page([...RECEPTIONISTS, ...CHAT_AGENTS], b)],
  ['/api/ai/agent-type', (b) => {
    const wanted = String(b?.type || '').toLowerCase();
    const rows = wanted === 'chat' ? CHAT_AGENTS : wanted === 'voice' ? RECEPTIONISTS : [...RECEPTIONISTS, ...CHAT_AGENTS];
    return page(rows, b);
  }],
  /* Which agent answers on which channel.

     A flat array of { type, name, agentId } read at `response.data.data` —
     not the usual { result } envelope, which is why this one is built by hand.
     Two channels are wired and the rest are not: the picker's empty state is
     a real one and worth being able to see. */
  ['/api/ai/setting/list', () => ({
    success: true,
    data: [
      { type: 'AI_BOT', name: 'WHATSAPP', agentId: f.uuid('cha0') },
      { type: 'AI_ASSISTANT', name: 'FACEBOOK', agentId: f.uuid('cha0') },
      { type: 'AI_ASSISTANT', name: 'WHATSAPP', agentId: f.uuid('cha0') },
      { type: 'AI_ASSISTANT', name: 'TELEGRAM', agentId: f.uuid('cha1') },
    ],
  })],
  ['/api/user/rates', (b) => {
    const clause = b?.filter || {};
    const wanted = String(clause?.value || '').trim();

    const COUNTRIES = {
      'United States': { iso: 'US', prefix: '1' },
      'United Kingdom': { iso: 'GB', prefix: '44' },
      Germany: { iso: 'DE', prefix: '49' },
      India: { iso: 'IN', prefix: '91' },
      Singapore: { iso: 'SG', prefix: '65' },
      Australia: { iso: 'AU', prefix: '61' },
    };

    /* A dial prefix search finds the country that owns it. */
    const byPrefix = Object.entries(COUNTRIES).find(([, meta]) =>
      wanted.replace(/[^0-9]/g, '').startsWith(meta.prefix),
    );
    const name =
      clause?.key === 'DIALPREFIX'
        ? byPrefix?.[0]
        : Object.keys(COUNTRIES).find((c) => c.toLowerCase() === wanted.toLowerCase());

    /* An unknown destination is a real answer, and the screen has copy for it. */
    if (!name) return ok({});

    const meta = COUNTRIES[name];
    const price = (seed, lo, hi) => (f.number(`${meta.iso}${seed}`, lo, hi) / 1000).toFixed(4);

    return ok({
      country: { iso: meta.iso, name },
      inbound_call_rates: [
        { dialprefix: meta.prefix, destination: name, type: 'Toll-Free', rate: price('in1', 6, 22) },
        { dialprefix: meta.prefix, destination: name, type: 'Local', rate: price('in2', 2, 9) },
      ],
      outbound_call_rates: [
        { dialprefix: meta.prefix, destination: name, type: 'Landline', rate: price('out1', 4, 18) },
        { dialprefix: meta.prefix, destination: name, type: 'Mobile', rate: price('out2', 9, 46) },
      ],
      sms_rates: [
        { dialprefix: meta.prefix, destination: name, type: 'Mobile', rate: price('sms1', 5, 30) },
      ],
    });
  }],
  ['/api/v1/sms/omni-channel-list', () =>
    ok([
      {
        uuid: f.uuid('omni-fb'),
        name: 'Sandbox Communications',
        type: 'messenger',
        status: 1,
        created_at: f.daysAgo(64),
      },
      {
        uuid: f.uuid('omni-ig'),
        name: '@sandboxcomms',
        type: 'instagram',
        /* Connected, but paused. The switch is the only thing that says so, and
           with nothing in this state it could never be seen off. */
        status: 0,
        created_at: f.daysAgo(31),
      },
    ])],
  ['/api/crm/is-connected', () =>
    ok([
      { type: 'HUBSPOT', is_connected: true, app_url: '' },
      { type: 'MONDAY', is_connected: true, app_url: 'https://monday.com/marketplace' },
      { type: 'ZOHO', is_connected: false },
      { type: 'PIPEDRIVE', is_connected: false },
      { type: 'SALESFORCE', is_connected: false },
      { type: 'MSTEAMS', is_connected: false },
    ])],
  ['/api/identity/list', (b) => page(IDENTITIES(), b)],
  ['/api/identity/address/list', (b) => page(ADDRESSES(), b)],
  ['/api/identity/did/identity/verification/list', (b) => page(VERIFICATIONS(), b)],
  ['/api/did/released-number-listing', (b) => page(f.seq(5, releasedRow), b)],
  ['/api/campaign/list', (b) => page(f.seq(9, campaign), b)],
  ['/api/campaign/lead-list', (b) => page(f.seq(30, contact), b)],
  ['/api/contact/list', (b) => page(f.seq(30, contact), b)],
  ['/api/contact/group/list', (b) =>
    page(f.seq(5, (i) => ({ uuid: f.uuid(`g${i}`), name: `${f.department(i)} list`, contacts_count: f.number(`gc${i}`, 5, 400) })), b)],
  ['/api/v1/sms/list', (b) => page(f.seq(20, message), b)],
  ['/api/v1/omni/list', (b) => page(f.seq(12, message), b)],
  ['/api/v1/meeting/listing', (b) => page(f.seq(8, meeting), b)],
  ['/api/tenant/ivr/list', (b) => page(f.seq(5, ivr), b)],
  ['/api/person/state', () => ok(f.seq(24, (i) => ({ uuid: f.uuid(`u${i}`), state: f.choice(STATES, `st${i}`) })))],
  ['/api/tenant/calls/graph', () =>
    ok(
      f.seq(14, (i) => ({
        date: f.daysAgo(13 - i).slice(0, 10),
        inbound: f.number(`gi${i}`, 20, 180),
        outbound: f.number(`go${i}`, 10, 140),
        missed: f.number(`gm${i}`, 0, 25),
      })),
    )],
  ['/api/campaign/analytics', () =>
    ok({ total_leads: 1240, contacted: 860, connected: 410, conversion_rate: 33 })],
];

/* Endpoints whose names read like collections get rows; everything else gets an
   object. Guessing wrong costs an oddly-shaped empty screen, never a bad write. */
const LIST_LIKE = /(list|listing|search|history|rows|all)(\/|$)/i;

const genericResponse = (urlPath, body) => {
  if (LIST_LIKE.test(urlPath)) return page(f.seq(8, user), body);
  return ok({});
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) raw = raw.slice(0, 1e6);
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });

/* Captain assistants. Shaped as the Assistants screen reads them - config,
   guidelines and guardrails included - rather than the {id, name} the
   playground's picker needs, so both screens work off one list. Deliberately
   uneven: one with everything filled in, one with features off and no
   guardrails, one bare. A screen only looks finished when every row is full. */
const CAPTAIN_ASSISTANTS = [
  {
    id: 'default-assistant',
    name: 'Support assistant',
    description: 'First line for everything that arrives in the shared inbox.',
    config: {
      instructions:
        'Answer from the knowledge base only. If the answer is not there, say so and hand off rather than guessing.',
      product_name: 'MyCountryMobile',
      welcome_message: 'Hi! How can I help you today?',
      handoff_message: 'Let me connect you with a team member.',
      resolution_message: 'Glad I could help! Anything else?',
      temperature: 0.3,
      feature_faq: true,
      feature_memory: true,
      feature_citation: true,
      feature_contact_attributes: false,
    },
    response_guidelines: ['Keep replies under three sentences.', 'Never invent a policy.'],
    guardrails: ['Never share pricing without approval.', 'Do not discuss other customers.'],
  },
  {
    id: 'asst_sales',
    name: 'Sales assistant',
    description: 'Qualifies inbound interest and books demos.',
    config: {
      instructions: 'Be brief and concrete. Offer a demo slot once intent is clear.',
      product_name: 'MyCountryMobile',
      welcome_message: 'Hey - looking for numbers, calling, or both?',
      handoff_message: 'Passing you to someone on the sales team.',
      resolution_message: 'Anything else before you go?',
      temperature: 0.6,
      feature_faq: false,
      feature_memory: true,
      feature_citation: false,
      feature_contact_attributes: true,
    },
    response_guidelines: ['Ask one question at a time.'],
    guardrails: [],
  },
  {
    id: 'asst_billing',
    name: 'Billing assistant',
    description: '',
    config: {
      instructions: '',
      temperature: 0.2,
      feature_faq: false,
      feature_memory: false,
      feature_citation: false,
      feature_contact_attributes: false,
    },
    response_guidelines: [],
    guardrails: [],
  },
];

/* Captain documents. One of each state the list draws — ready, still
   processing, and failed with a reason — because the three look nothing alike
   and only the ready one ever turns up by accident. */
const CAPTAIN_DOCS = [
  {
    id: 'doc_pricing',
    assistant_id: 'default-assistant',
    name: 'Pricing and plans',
    type: 'url',
    source_url: 'https://help.example.com/pricing',
    status: 'ready',
    error_message: null,
    created_at: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 19).replace('T', ' '),
    content_length: 8420,
  },
  {
    id: 'doc_porting',
    assistant_id: 'default-assistant',
    name: 'Number porting guide.pdf',
    type: 'pdf',
    source_url: null,
    status: 'ready',
    error_message: null,
    created_at: new Date(Date.now() - 26 * 36e5).toISOString().slice(0, 19).replace('T', ' '),
    content_length: 31900,
  },
  {
    /* Ready, and nearly empty. The crawl answered 200 and produced a cookie
       banner — the failure that looks like a success, and the reason the list
       shows how much text it actually got. */
    id: 'doc_status',
    assistant_id: 'default-assistant',
    name: 'Status page',
    type: 'url',
    source_url: 'https://status.example.com',
    status: 'ready',
    error_message: null,
    created_at: new Date(Date.now() - 5 * 36e5).toISOString().slice(0, 19).replace('T', ' '),
    content_length: 180,
  },
  {
    id: 'doc_sla',
    assistant_id: 'default-assistant',
    name: 'Service level agreement',
    type: 'url',
    source_url: 'https://help.example.com/sla',
    status: 'processing',
    error_message: null,
    created_at: new Date(Date.now() - 4 * 6e4).toISOString().slice(0, 19).replace('T', ' '),
    content_length: 0,
  },
  {
    id: 'doc_legacy',
    assistant_id: 'default-assistant',
    name: 'Legacy tariff sheet',
    type: 'url',
    source_url: 'https://old.example.com/tariffs',
    status: 'failed',
    error_message: 'The page returned 404. Check the address, or the page may have moved.',
    created_at: new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 19).replace('T', ' '),
    content_length: 0,
  },
];

/* Newlines in the body on purpose: the edit dialog's textarea is the one place
   a document's extracted text is seen, and text that arrives as a single
   unbroken run tells you nothing about whether the wrapping there works. */
const CAPTAIN_DOC_BODY = [
  'Plans are billed monthly and can be changed at any time. A change takes',
  'effect at the start of the next billing period, and the difference is',
  'prorated on the following invoice.',
  '',
  'Cancelling stops the next renewal. Numbers stay active until the end of the',
  'period already paid for.',
].join('\n');

/* Captain FAQs. Weighted the way a real set is: mostly approved, with a few
   drafts still waiting on someone — which is the state the screen has to make
   findable, because a draft is written but not answering anyone. */
const ago = (ms) => new Date(Date.now() - ms).toISOString().slice(0, 19).replace('T', ' ');
const CAPTAIN_FAQS = [
  {
    id: 'faq_hours',
    assistant_id: 'default-assistant',
    question: 'What are your support hours?',
    answer: 'Monday to Friday, 9am to 6pm UK time. Outside those hours the assistant takes a message and the team replies the next working day.',
    status: 'approved',
    created_at: ago(12 * 864e5),
  },
  {
    id: 'faq_port',
    assistant_id: 'default-assistant',
    question: 'How long does it take to port a number?',
    answer: 'Usually three to five working days once the losing carrier confirms. Mobile numbers are often quicker; landlines with an active contract can take longer.',
    status: 'approved',
    created_at: ago(9 * 864e5),
  },
  {
    id: 'faq_plan',
    assistant_id: 'default-assistant',
    question: 'Can I change my plan mid-month?',
    answer: 'Yes. The change takes effect at the start of the next billing period and the difference is prorated on the following invoice.',
    status: 'draft',
    created_at: ago(2 * 36e5),
  },
  {
    id: 'faq_cancel',
    assistant_id: 'default-assistant',
    question: 'What happens to my numbers if I cancel?',
    answer: 'They stay active until the end of the period you have already paid for, then they are released.',
    status: 'draft',
    created_at: ago(2 * 36e5),
  },
  {
    id: 'faq_refund',
    assistant_id: 'default-assistant',
    question: 'Do you offer refunds?',
    answer: 'Unused credit can be refunded within 14 days of purchase. Call charges already placed cannot be refunded.',
    status: 'approved',
    created_at: ago(40 * 864e5),
  },
  {
    id: 'faq_intl',
    assistant_id: 'default-assistant',
    question: 'Which countries can I call on the standard plan?',
    answer: 'The standard plan covers 40 destinations. Anything outside that list is billed at the published per-minute rate.',
    status: 'approved',
    created_at: ago(21 * 864e5),
  },
];

/* Captain Actions. Three surfaces on one screen — connected apps, the actions
   inside a connected app, and hand-built HTTP tools — so the fixtures cover a
   connection in each of its three states, and custom tools that are read and
   write, enabled and not, at each security tier. */
const CAPTAIN_CONNECTIONS = [
  {
    id: 'conn_gmail',
    toolkit_slug: 'gmail',
    toolkit_name: 'Gmail',
    connected_account_id: 'ca_1',
    status: 'ACTIVE',
  },
  {
    id: 'conn_hubspot',
    toolkit_slug: 'hubspot',
    toolkit_name: 'HubSpot',
    connected_account_id: 'ca_2',
    status: 'INITIALIZING',
  },
  {
    id: 'conn_stripe',
    toolkit_slug: 'stripe',
    toolkit_name: 'Stripe',
    connected_account_id: 'ca_3',
    status: 'FAILED',
  },
];

const CAPTAIN_TOOLKITS = [
  { slug: 'gmail', name: 'Gmail', description: 'Read and send mail from the connected mailbox.', logo: null, tools_count: 24, categories: ['Productivity'] },
  { slug: 'hubspot', name: 'HubSpot', description: 'Contacts, deals and companies from your CRM.', logo: null, tools_count: 61, categories: ['CRM'] },
  { slug: 'stripe', name: 'Stripe', description: 'Customers, invoices and payment status.', logo: null, tools_count: 38, categories: ['Finance & Accounting'] },
  { slug: 'slack', name: 'Slack', description: 'Post to channels and read recent messages.', logo: null, tools_count: 19, categories: ['Productivity'] },
  { slug: 'github', name: 'GitHub', description: 'Issues, pull requests and repository activity.', logo: null, tools_count: 44, categories: ['Issue Tracking'] },
  { slug: 'notion', name: 'Notion', description: 'Pages and databases from your workspace.', logo: null, tools_count: 17, categories: ['Productivity'] },
  { slug: 'shopify', name: 'Shopify', description: 'Orders, customers and fulfilment status.', logo: null, tools_count: 33, categories: ['E-commerce'] },
  { slug: 'zendesk', name: 'Zendesk', description: 'Tickets and their history.', logo: null, tools_count: 22, categories: ['Support'] },
];

/* The actions inside a connected app. Deliberately a mix: reads that a customer
   could trigger and writes that must never be exposed, so the screen's
   "Staff only" branch is not a code path nobody ever sees. */
const CAPTAIN_TOOLKIT_ACTIONS = {
  gmail: [
    { id: 't1', slug: 'GMAIL_FETCH_EMAILS', name: 'Fetch emails', description: 'List recent messages.', input_parameters: {}, enabled: true, operation_type: 'read', security_tier: 'standard' },
    { id: 't2', slug: 'GMAIL_SEND_EMAIL', name: 'Send email', description: 'Send a message as the connected account.', input_parameters: {}, enabled: false, operation_type: 'write', security_tier: null },
    { id: 't3', slug: 'GMAIL_GET_PROFILE', name: 'Get profile', description: 'Read the mailbox owner.', input_parameters: {}, enabled: true, operation_type: 'read', security_tier: 'open' },
    { id: 't4', slug: 'GMAIL_DELETE_MESSAGE', name: 'Delete message', description: 'Permanently remove a message.', input_parameters: {}, enabled: false, operation_type: 'write', security_tier: null },
    { id: 't5', slug: 'GMAIL_SEARCH', name: 'Search mail', description: 'Find messages matching a query.', input_parameters: {}, enabled: false, operation_type: 'read', security_tier: null },
  ],
};

const CAPTAIN_CUSTOM_TOOLS = [
  {
    id: 'tool_order',
    assistant_id: 'default-assistant',
    slug: 'get_order_status',
    title: 'Get order status',
    description: "Looks up an order's shipping status by order ID.",
    http_method: 'GET',
    endpoint_url: 'https://api.example.com/orders/{order_id}',
    request_template: null,
    response_template: null,
    auth_type: 'bearer',
    auth_config: {},
    param_schema: [{ name: 'order_id', type: 'string', description: 'The order reference', required: true }],
    config: { data_access: 'limited', allowed_response_fields: ['status', 'eta'] },
    operation_type: 'read',
    security_tier: 'standard',
    enabled: true,
    kind: 'http',
    composio_tool_slug: null,
    composio_connection_id: null,
  },
  {
    id: 'tool_balance',
    assistant_id: 'default-assistant',
    slug: 'get_account_balance',
    title: 'Get account balance',
    description: 'Returns the current credit on the account.',
    http_method: 'GET',
    endpoint_url: 'https://api.example.com/billing/balance',
    request_template: null,
    response_template: null,
    auth_type: 'api_key',
    auth_config: {},
    param_schema: [],
    config: { data_access: 'full' },
    operation_type: 'read',
    security_tier: 'secure',
    enabled: true,
    kind: 'http',
    composio_tool_slug: null,
    composio_connection_id: null,
  },
  {
    id: 'tool_refund',
    assistant_id: 'default-assistant',
    slug: 'issue_refund',
    title: 'Issue refund',
    description: 'Refunds a charge. Staff use only.',
    http_method: 'POST',
    endpoint_url: 'https://api.example.com/billing/refund',
    request_template: '{"charge_id": "{charge_id}"}',
    response_template: null,
    auth_type: 'bearer',
    auth_config: {},
    param_schema: [{ name: 'charge_id', type: 'string', description: 'Charge to refund', required: true }],
    config: { data_access: 'full' },
    operation_type: 'write',
    security_tier: null,
    enabled: false,
    kind: 'http',
    composio_tool_slug: null,
    composio_connection_id: null,
  },
  {
    id: 'tool_gmail_fetch',
    assistant_id: 'default-assistant',
    slug: 'gmail_fetch_emails',
    title: 'Fetch emails',
    description: 'From the connected Gmail account.',
    http_method: 'GET',
    endpoint_url: '',
    request_template: null,
    response_template: null,
    auth_type: 'none',
    auth_config: {},
    param_schema: [],
    config: {},
    operation_type: 'read',
    security_tier: 'standard',
    enabled: true,
    kind: 'composio',
    composio_tool_slug: 'GMAIL_FETCH_EMAILS',
    composio_connection_id: 'conn_gmail',
  },
];

/* Captain inboxes. One legacy row (the single widget that predates the
   multi-inbox model, kept working through the old per-assistant endpoints) and
   two ordinary ones, because the screen treats them differently and the legacy
   path is the one nobody remembers to test. */
const CAPTAIN_INBOXES = [
  {
    id: 'inbox_site',
    name: 'Website chat',
    channel_type: 'website',
    website_domain: 'mycountrymobile.com',
    assistant_id: 'default-assistant',
    assistant_name: 'Support assistant',
    enabled: true,
    legacy_assistant_id: null,
  },
  {
    id: 'inbox_help',
    name: 'Help centre',
    channel_type: 'website',
    website_domain: 'help.mycountrymobile.com',
    assistant_id: 'asst_sales',
    assistant_name: 'Sales assistant',
    enabled: false,
    legacy_assistant_id: null,
  },
  {
    id: 'inbox_legacy',
    name: 'Original widget',
    channel_type: 'website',
    website_domain: 'mycountrymobile.com',
    assistant_id: 'default-assistant',
    assistant_name: 'Support assistant',
    enabled: true,
    legacy_assistant_id: 'default-assistant',
  },
];

const CAPTAIN_CONVERSATIONS = [
  {
    id: 'conv_1',
    visitor_name: 'Priya N.',
    page_url: 'https://mycountrymobile.com/pricing',
    owner: 'human',
    last_message: 'Thanks — can someone confirm the porting date?',
    last_message_at: new Date(Date.now() - 6 * 6e4).toISOString(),
  },
  {
    id: 'conv_2',
    visitor_name: null,
    page_url: 'https://mycountrymobile.com/',
    owner: 'ai',
    last_message: 'What are your support hours?',
    last_message_at: new Date(Date.now() - 52 * 6e4).toISOString(),
  },
  {
    id: 'conv_3',
    visitor_name: 'Tomas R.',
    page_url: 'https://help.mycountrymobile.com/porting',
    owner: 'ai',
    last_message: 'That answered it, thanks.',
    last_message_at: new Date(Date.now() - 5 * 36e5).toISOString(),
  },
];

/* A thread that exercises all three roles the viewer draws — visitor, the
   assistant, and a human agent who took over. */
const CAPTAIN_THREAD = [
  { id: 'm1', role: 'visitor', content: 'Hi, how long does porting take?', created_at: new Date(Date.now() - 30 * 6e4).toISOString() },
  { id: 'm2', role: 'assistant', content: 'Usually three to five working days once the losing carrier confirms.', created_at: new Date(Date.now() - 29 * 6e4).toISOString() },
  { id: 'm3', role: 'visitor', content: 'Mine has been nine days.', created_at: new Date(Date.now() - 12 * 6e4).toISOString() },
  { id: 'm4', role: 'agent', content: 'Let me take a look at that for you — could you confirm the number?', created_at: new Date(Date.now() - 8 * 6e4).toISOString() },
  { id: 'm5', role: 'visitor', content: 'Thanks — can someone confirm the porting date?', created_at: new Date(Date.now() - 6 * 6e4).toISOString() },
];

export const mockApiPlugin = () => ({
  name: 'sandbox-mock-api',
  configureServer(server) {
    /* Role switch. Server-side because the mock has no view of localStorage;
       each developer runs their own dev server so a single value is enough. */
    server.middlewares.use('/__mock', (req, res) => {
      const wanted = String(req.url || '').split('/').filter(Boolean)[0];
      const key = Object.keys(ROLES).find((r) => r.toLowerCase() === decodeURIComponent(wanted || '').toLowerCase());
      if (key) {
        writeRole(key);
        console.log(`[sandbox] role switched to ${key}`);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        `<body style="font:14px system-ui;padding:2rem;max-width:34rem">
         <h2>Sandbox role</h2>
         <p>Active: <b>${currentRole}</b> — ${ROLES[currentRole].label}</p>
         <ul>${Object.entries(ROLES)
           .map(([k, v]) => `<li><a href="/__mock/${k}">${k}</a> — ${v.label}</li>`)
           .join('')}</ul>
         <p><a href="/">← back to the app</a> (reload it after switching)</p>
         </body>`,
      );
    });

    /* Captain. Its own middleware because Captain does not use the console's
       envelope: the playground reads `json.data` straight off the response,
       where every /api route wraps rows in `data.result`. Routing it through
       the handler table above would have meant teaching that table a second
       envelope for one screen.

       Only the two routes the playground actually calls. The replies are
       canned and say so - this is here so the screen can be built and looked
       at without a Captain backend, not to imitate one. */
    server.middlewares.use('/captain-api', async (req, res) => {
      const [urlPath, rawQuery = ''] = String(req.url || '').split('?');
      const query = new URLSearchParams(rawQuery);
      const body = req.method === 'POST' ? await readBody(req) : {};
      let payload;

      if (urlPath.endsWith('/assistants') && req.method === 'GET') {
        payload = { data: CAPTAIN_ASSISTANTS };
      } else if (urlPath.includes('/composio-access')) {
        /* The toolkits an assistant may reach. PUT just echoes success — the
           screen already moved its own switch and only reverts on a failure. */
        payload =
          req.method === 'GET'
            ? {
                data: [
                  { toolkit_slug: 'gmail', toolkit_name: 'Gmail', allowed: true },
                  { toolkit_slug: 'hubspot', toolkit_name: 'HubSpot', allowed: true },
                  { toolkit_slug: 'stripe', toolkit_name: 'Stripe', allowed: false },
                ],
              }
            : { data: {} };
      } else if (urlPath.includes('/generate-faqs')) {
        payload = {
          data: {
            faqs: [
              { question: 'Can I change my plan mid-month?', answer: 'Yes — it takes effect next period and is prorated.' },
              { question: 'What happens to my numbers if I cancel?', answer: 'They stay active until the end of the period already paid for.' },
              { question: 'When am I billed?', answer: 'Monthly, at the start of each billing period.' },
            ],
          },
        };
      } else if (urlPath.startsWith('/api/captain/documents/') && req.method === 'GET') {
        /* The edit dialog asks for one document's extracted text. */
        payload = { data: { content: CAPTAIN_DOC_BODY } };
      } else if (urlPath.endsWith('/documents') && req.method === 'GET') {
        payload = { data: CAPTAIN_DOCS };
      } else if (urlPath.endsWith('/documents') && req.method === 'POST') {
        /* The screen reads `documents.length` to say how many a crawl produced,
           so the count has to follow max_pages rather than always being one. */
        const made = Math.max(1, Math.min(Number(body.max_pages) || 1, 20));
        payload = { data: { documents: Array.from({ length: made }, (_, i) => ({ id: `doc_new_${i}` })) } };
      } else if (urlPath.endsWith('/faqs') && req.method === 'GET') {
        /* The screen debounces a search term into the query string, so the mock
           has to actually filter — a list that ignores `search` makes the box
           look broken rather than empty. */
        const term = String(query.get('search') || '').toLowerCase();
        payload = {
          data: term
            ? CAPTAIN_FAQS.filter(
                (f) =>
                  f.question.toLowerCase().includes(term) || f.answer.toLowerCase().includes(term),
              )
            : CAPTAIN_FAQS,
        };
      } else if (urlPath.includes('/composio/connections') && req.method === 'GET') {
        payload = { data: CAPTAIN_CONNECTIONS };
      } else if (urlPath.includes('/composio/toolkits/') && urlPath.endsWith('/tools')) {
        const slug = urlPath.split('/toolkits/')[1].split('/')[0];
        /* `data.tools`, not `data`: this one route nests, and the screen reads
           `json.data.tools`. Every other Captain route returns the array
           directly. */
        payload = { data: { tools: CAPTAIN_TOOLKIT_ACTIONS[slug] || CAPTAIN_TOOLKIT_ACTIONS.gmail } };
      } else if (urlPath.endsWith('/composio/toolkits')) {
        const term = String(query.get('search') || '').toLowerCase();
        payload = {
          data: term
            ? CAPTAIN_TOOLKITS.filter((t) => t.name.toLowerCase().includes(term))
            : CAPTAIN_TOOLKITS,
        };
      } else if (urlPath.endsWith('/custom-tools') && req.method === 'GET') {
        payload = { data: CAPTAIN_CUSTOM_TOOLS };
      } else if (urlPath.endsWith('/custom-tools/test')) {
        payload = { data: { ok: true, status: 200, body: { status: 'shipped', eta: '2 days' } } };
      } else if (urlPath.includes('/composio/connect')) {
        /* No OAuth window in the sandbox. Returning no redirect leaves the
           screen on the page rather than sending it somewhere that cannot
           answer. */
        payload = { data: { redirect_url: null, connection_id: 'conn_new' } };
      } else if (urlPath.includes('/widget-conversations/') && urlPath.endsWith('/messages')) {
        payload = { data: CAPTAIN_THREAD };
      } else if (urlPath.includes('/widget-conversations/') && urlPath.endsWith('/reply')) {
        payload = { data: { id: `m_${Date.now()}` } };
      } else if (urlPath.endsWith('/widget-conversations')) {
        payload = { data: CAPTAIN_CONVERSATIONS };
      } else if (urlPath.includes('/inboxes/') && urlPath.endsWith('/conversations')) {
        payload = { data: CAPTAIN_CONVERSATIONS };
      } else if (urlPath.endsWith('/inboxes') && req.method === 'GET') {
        payload = { data: CAPTAIN_INBOXES };
      } else if (urlPath.endsWith('/inbox-channels')) {
        payload = { data: [{ channel_type: 'website', enabled: true }] };
      } else if (urlPath.includes('/playground')) {
        const asked = String(body.message || '');
        /* Enough shape to exercise every branch the screen draws: a plain
           answer, the handoff badge, and cited sources. Keyed off the question
           so each can be triggered on purpose rather than at random. */
        const wantsHuman = /human|agent|person|refund/i.test(asked);
        payload = {
          data: {
            reply: wantsHuman
              ? 'That one needs a person. Passing you to an agent now.'
              : `Sandbox reply. You asked: "${asked}"`,
            handoff: wantsHuman,
            sources: wantsHuman
              ? []
              : [
                  { id: 'kb_1', question: 'What are your opening hours?', score: 0.91 },
                  /* Deliberately under the 0.6 the screen calls weak, so both
                     states of the similarity chip can be seen without having to
                     find a badly-matched question by hand. */
                  { id: 'kb_2', question: 'How do I change my plan?', score: 0.42 },
                ],
          },
        };
      } else {
        /* Create, update and delete. Nothing is kept: the sandbox has no store,
           and a screen that appears to save and then loses it on reload is
           worse than one that plainly does not. The list re-fetches after a
           save and comes back as it was. */
        payload = { data: { id: 'asst_new', ...body } };
      }

      res.statusCode = req.method === 'DELETE' ? 204 : 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    });

    server.middlewares.use('/api', async (req, res) => {
      const urlPath = `/api${String(req.url || '').split('?')[0]}`;
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};

      const hit = HANDLERS.find(([p]) => urlPath === p || urlPath.startsWith(`${p}/`));
      const payload = hit ? hit[1](body) : genericResponse(urlPath, body);

      if (!hit) console.log(`[sandbox] generic response for ${req.method} ${urlPath}`);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    });
  },
});
