/* Deterministic fake data for the sandbox.
 *
 * Seeded rather than random on purpose: a row must keep the same name and
 * number across reloads, or every refresh reshuffles the screen you are trying
 * to style and you cannot tell a layout change from new data. Same seed in,
 * same value out, forever. */

/* FNV-1a, then the murmur3 fmix32 avalanche. The avalanche is not optional:
   plain FNV leaves near-identical high bits for short similar seeds ("f0",
   "f1", "f2"), and picking from a list reads exactly those high bits — every
   seed lands in the same bucket and all sixteen names come out identical. */
const hash = (seed) => {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const pick = (list, seed) => list[Math.floor(hash(seed) * list.length) % list.length];
const int = (seed, min, max) => min + Math.floor(hash(seed) * (max - min + 1));

const FIRST = ['Aisha', 'Daniel', 'Priya', 'Marcus', 'Sofia', 'Omar', 'Hannah', 'Diego',
  'Mei', 'Tomas', 'Zara', 'Elliot', 'Nadia', 'Rafael', 'Ingrid', 'Kwame'];
const LAST = ['Okafor', 'Whitfield', 'Raman', 'Delgado', 'Lindqvist', 'Haddad', 'Brennan',
  'Moreau', 'Tanaka', 'Novak', 'Adeyemi', 'Castellanos', 'Petrov', 'Sandoval'];
const CITY = ['Austin', 'Lisbon', 'Toronto', 'Dublin', 'Singapore', 'Cape Town', 'Berlin', 'Denver'];
const DEPT = ['Support', 'Sales', 'Billing', 'Onboarding', 'Retention', 'Technical'];

export const person = (i) => {
  const first = pick(FIRST, `f${i}`);
  const last = pick(LAST, `l${i}`);
  return {
    first_name: first,
    last_name: last,
    name: `${first} ${last}`,
    full_name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
    initials: first[0] + last[0],
  };
};

/* 555-01xx is the block reserved for fiction, so a number that leaks into a
   screenshot or a test call can never reach a real person. */
export const phone = (i) => `+1512555${String(1000 + (int(`p${i}`, 0, 8999))).padStart(4, '0')}`;

export const uuid = (i) => {
  const hex = (n) => Math.floor(hash(`${i}:${n}`) * 0xffffffff).toString(16).padStart(8, '0');
  return `${hex(1)}-${hex(2).slice(0, 4)}-4${hex(3).slice(0, 3)}-a${hex(4).slice(0, 3)}-${hex(5)}${hex(6).slice(0, 4)}`;
};

/* Dates are relative to now, so the UI always shows plausible recent activity
   instead of drifting into the past as the sandbox ages. */
export const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
export const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

export const city = (i) => pick(CITY, `c${i}`);
export const department = (i) => pick(DEPT, `d${i}`);
export const bool = (i, trueRate = 0.7) => hash(`b${i}`) < trueRate;
export const number = int;
export const choice = pick;

export const money = (i, min = 5, max = 500) =>
  (min + hash(`m${i}`) * (max - min)).toFixed(2);

export const duration = (i) => int(`dur${i}`, 20, 1800);

export const seq = (count, build) => Array.from({ length: count }, (_, i) => build(i));
