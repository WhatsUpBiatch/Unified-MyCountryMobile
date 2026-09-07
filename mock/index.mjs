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
    site_detail: { name: f.city(i) },
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

const queue = (i) => ({
  uuid: f.uuid(`q${i}`),
  name: `${f.department(i)} Queue`,
  extension: String(6000 + i),
  strategy: f.choice(['ring-all', 'longest-idle', 'round-robin'], `str${i}`),
  agents_count: f.number(`ac${i}`, 2, 12),
  waiting: f.number(`wt${i}`, 0, 5),
  answered: f.number(`an${i}`, 10, 300),
  abandoned: f.number(`ab${i}`, 0, 25),
  sla: f.number(`sla${i}`, 70, 99),
  status: 'active',
});

const numberRow = (i) => ({
  uuid: f.uuid(`n${i}`),
  did_number: f.phone(`n${i}`),
  did_name: `${f.city(i)} line`,
  type: f.choice(['P', 'T'], `t${i}`),
  country: 'United States',
  city: f.city(i),
  monthly_cost: f.money(i, 1, 15),
  assigned_to: f.person(`u${i}`).name,
  status: 'active',
  created_at: f.daysAgo(i * 9 + 5),
});

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

const department = (i) => ({
  uuid: f.uuid(`d${i}`),
  name: f.department(i),
  extension: String(7000 + i),
  members_count: f.number(`mc${i}`, 2, 20),
  site_name: f.city(i),
  status: 'active',
});

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
    name: names[i % names.length],
    description: 'Sandbox role',
    users_count: f.number(`uc${i}`, 1, 30),
    is_custom: i >= 4,
  };
};

const ivr = (i) => ({
  uuid: f.uuid(`iv${i}`),
  name: `${f.choice(['Main', 'After hours', 'Holiday', 'Support'], `ivn${i}`)} menu`,
  extension: String(8000 + i),
  options_count: f.number(`oc${i}`, 2, 8),
  status: 'active',
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
      primary_color: '',
      secondary_color: '',
      large_logo: '',
      small_logo: '',
      login_image: '',
      fav_icon: '',
    })],
  ['/api/user/list', (b) => page(f.seq(24, user), b)],
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
  ['/api/numbers/list', (b) => page(f.seq(18, numberRow), b)],
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
