/* Which networks a company allows sign-in from, and the decision for one
 * request. Pure — no React, no fetch, no Express — so it can be imported by
 * the screen AND run by a checker with no browser involved (see
 * `scripts/verify-ip-allowlist.mjs`), the same split this codebase already
 * uses for the holiday rules (`holiday-presets.ts`) and for the switch's own
 * caller-ID and holiday logic in `backend-patches/fs-xml-api/`.
 *
 * THE SAME ALGORITHM RUNS TWICE, ONCE HERE AND ONCE ON THE SERVER, and that
 * split is deliberate rather than an oversight: this file ships in the browser
 * bundle, and the browser is exactly the machine an allowlist exists to keep
 * an unauthorised caller off. The server-side port lives at
 * `backend-patches/default-api/src/lib/ip-allowlist.ts` and is a line-for-line copy of
 * `matches`, `isAllowed` and `evaluateIpAllowlist` below — every change here
 * must be mirrored there, and `scripts/verify-ip-allowlist.mjs` checks the two
 * files stay byte-identical on those three functions so they cannot quietly
 * drift apart.
 *
 * WHY THIS EXISTS AT ALL. The screen already had a full, working CIDR
 * allowlist editor - IPv4 only, one CIDR block per line, no label, capped at
 * 150 entries, with its own hand-rolled validator. That code was correct and
 * stays; what it lacked was IPv6, a label per entry so an admin remembers what
 * "203.0.113.0/24" is six months later, and a match test that produces the
 * same answer wherever it runs. This module adds all three without touching
 * the parts that already worked.
 */

export type IpFamily = 'v4' | 'v6';

export interface AllowlistEntry {
  id: string;
  /* Stored exactly as entered, trimmed. A single address is written with the
     full-length prefix (/32 for IPv4, /128 for IPv6) rather than assumed,
     because "no prefix" and "the whole internet" are one keystroke apart and a
     silent default in that direction is how an allowlist stops allowlisting
     anything. */
  cidr: string;
  label: string;
  added_at: string;
  added_by_uuid?: string;
  added_by_name?: string;
}

export interface AllowlistAuditEntry {
  at: string;
  actor_uuid?: string;
  actor_name?: string;
  action: 'add' | 'remove' | 'enable' | 'disable' | 'break_glass_armed' | 'break_glass_cleared';
  detail: string;
}

export interface BreakGlassWindow {
  active: boolean;
  expires_at: string;
  created_by_uuid?: string;
  created_by_name?: string;
  reason: string;
}

/* 'allow' (the original, and the default): only a caller matching one of the
   entries gets through - the safer of the two for a small, known set of
   offices. Block: everyone gets through EXCEPT a caller matching one of the
   entries - the shape needed to eject one specific bad actor without having
   to first enumerate every legitimate network a whole company signs in from.

   THESE ARE TWO INDEPENDENT FEATURES, not one list with a mode switch on it.
   Each has its own enable flag and its own entries, because a company running
   an allowlist of known offices AND wanting to eject one specific abusive
   address is one situation, not two mutually exclusive ones - a mode switch
   would have forced a choice between them that nobody actually has to make.
   `AllowlistKind` names which of the two a piece of UI or a helper is
   currently working on; it does not appear in the stored shape. */
export type AllowlistKind = 'allow' | 'block';

export interface AllowlistList {
  enabled: boolean;
  entries: AllowlistEntry[];
}

export interface AllowlistSettings {
  allow: AllowlistList;
  block: AllowlistList;
  audit_log: AllowlistAuditEntry[];
  break_glass?: BreakGlassWindow | null;
}

export type AllowlistDecision =
  | { outcome: 'not_enforced' } // neither list is switched on - every request passes
  | { outcome: 'break_glass' } // a pre-armed emergency window is open
  | { outcome: 'allowed'; matched?: AllowlistEntry }
  /* `by` says which list produced the refusal - useful to a security review,
     and to a UI that wants to explain WHY a given request was refused rather
     than just that it was. */
  | { outcome: 'denied'; by: AllowlistKind; matched?: AllowlistEntry }
  /* The allow list, switched on with nothing in it, would lock out the entire
     company, including the admin who just saved it. This must never be a live
     state - the screen refuses to save one - but the decision function does
     not trust the screen to have been the only writer, so it treats an empty,
     enabled allow list as "not really on" rather than "deny everyone". The
     block list has no equivalent: an empty, enabled block list is not a
     mistake, it is "on, and currently blocking nobody" - the ordinary state
     right after the feature is switched on and before the first address is
     added to it. */
  | { outcome: 'misconfigured_empty' };

/* --------------------------------------------------------------- IPv4 CIDR */

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_ADDRESS_RE = new RegExp(`^${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}$`);

const ipv4ToInt = (address: string): number | null => {
  const match = IPV4_ADDRESS_RE.exec(address);
  if (!match) return null;
  return (
    (Number(match[1]) << 24) |
    (Number(match[2]) << 16) |
    (Number(match[3]) << 8) |
    Number(match[4])
  );
};

/* --------------------------------------------------------------- IPv6 CIDR */

/* Expands to 8 groups of 16 bits, filling out a "::" contraction, and returns
   null for anything that is not a well-formed address. An IPv4-mapped address
   embedded in the last 32 bits (::ffff:192.0.2.1) is also accepted, because
   that is the exact shape Node/Express hand back for a v4 client on a
   dual-stack socket. */
const ipv6ToGroups = (address: string): number[] | null => {
  let text = address.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);

  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parseHextets = (part: string): number[] | null => {
    if (part === '') return [];
    const pieces = part.split(':');
    const values: number[] = [];
    for (const piece of pieces) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      values.push(parseInt(piece, 16));
    }
    return values;
  };

  if (halves.length === 1) {
    const groups = parseHextets(halves[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const head = parseHextets(halves[0]);
  const tailGroups = parseHextets(halves[1]);
  if (!head || !tailGroups) return null;
  const missing = 8 - head.length - tailGroups.length;
  if (missing < 0) return null;
  return [...head, ...new Array(missing).fill(0), ...tailGroups];
};

/* -------------------------------------------------------------- one parser */

export interface ParsedCidr {
  family: IpFamily;
  /* IPv4 as one 32-bit int; IPv6 as eight 16-bit groups. Kept as the family's
     native width rather than forced into one shared integer type, so a v4
     address and a v6 address can never accidentally compare equal. */
  address: number | number[];
  prefix: number;
}

export const parseCidr = (raw: string): ParsedCidr | null => {
  const text = raw.trim();
  const slash = text.lastIndexOf('/');
  const host = slash === -1 ? text : text.slice(0, slash);
  const prefixText = slash === -1 ? null : text.slice(slash + 1);

  if (host.includes(':')) {
    const groups = ipv6ToGroups(host);
    if (!groups) return null;
    const prefix = prefixText === null ? 128 : Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
    if (prefixText !== null && !/^\d{1,3}$/.test(prefixText)) return null;
    return { family: 'v6', address: groups, prefix };
  }

  const v4 = ipv4ToInt(host);
  if (v4 === null) return null;
  const prefix = prefixText === null ? 32 : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  if (prefixText !== null && !/^\d{1,2}$/.test(prefixText)) return null;
  return { family: 'v4', address: v4, prefix };
};

export const isValidCidr = (raw: string): boolean => parseCidr(raw) !== null;

/* -------------------------------------------------------------- matching */

const v4Matches = (address: number, network: number, prefix: number): boolean => {
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~0 << (32 - prefix)) >>> 0;
  return (address & mask) === (network & mask);
};

const v6Matches = (address: number[], network: number[], prefix: number): boolean => {
  let remaining = prefix;
  for (let group = 0; group < 8; group += 1) {
    if (remaining <= 0) return true;
    const bits = Math.min(16, remaining);
    const mask = bits === 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff;
    if ((address[group] & mask) !== (network[group] & mask)) return false;
    remaining -= bits;
  }
  return true;
};

/* Groups [0,0,0,0,0,0xffff,hi,lo] - an IPv4 address embedded in a v6 one,
   exactly what Node/Express hand back for a v4 client on a dual-stack socket
   (`::ffff:203.0.113.5`). Read down to a plain v4 int when this shape is seen,
   so a stored v4 CIDR still matches a client whose address happens to arrive
   in this form - the alternative is an allowlist entry silently failing to
   cover half the v4 traffic depending on how the listening socket answered. */
const asV4Mapped = (groups: number[]): number | null => {
  if (groups[0] !== 0 || groups[1] !== 0 || groups[2] !== 0 || groups[3] !== 0) return null;
  if (groups[4] !== 0 || groups[5] !== 0xffff) return null;
  return ((groups[6] & 0xffff) << 16) | (groups[7] & 0xffff);
};

/* Is `clientAddress` inside `entryCidr`? A bare address (no "/") is read as
   the single-host network - /32 for v4, /128 for v6 - which is what lets a
   plain client IP be compared directly against a stored CIDR. */
export const matches = (clientAddress: string, entryCidr: string): boolean => {
  const client = parseCidr(clientAddress.includes('/') ? clientAddress : `${clientAddress}/32`);
  const network = parseCidr(entryCidr);
  if (!client || !network) return false;

  if (client.family === network.family) {
    if (client.family === 'v4') {
      return v4Matches(client.address as number, network.address as number, network.prefix);
    }
    return v6Matches(client.address as number[], network.address as number[], network.prefix);
  }

  // Families differ. The one case worth reconciling is a v4 client reported in
  // v6-mapped notation against a plain v4 network entry - anything else (a
  // genuinely different address family) is correctly a non-match.
  if (client.family === 'v6' && network.family === 'v4') {
    const mapped = asV4Mapped(client.address as number[]);
    return mapped !== null && v4Matches(mapped, network.address as number, network.prefix);
  }
  return false;
};

/* What gets SAVED for a new entry: the prefix made explicit, /32 or /128,
   rather than left implicit. An admin who types "8.8.8.8" almost certainly
   means that one address, and writing the prefix out is what lets the stored
   list be read back later without re-deriving what a bare entry was supposed
   to mean. */
export const canonicalizeCidr = (raw: string): string | null => {
  const parsed = parseCidr(raw);
  if (!parsed) return null;
  if (raw.trim().includes('/')) return raw.trim();
  return parsed.family === 'v4' ? `${raw.trim()}/32` : `${raw.trim()}/128`;
};

/* ----------------------------------------------------------- the decision */

const breakGlassIsOpen = (window: BreakGlassWindow | null | undefined, now: Date): boolean => {
  if (!window || window.active !== true) return false;
  const expires = Date.parse(window.expires_at);
  return Number.isFinite(expires) && expires > now.getTime();
};

const emptyList = (): AllowlistList => ({ enabled: false, entries: [] });

/* The one function both sides call. `now` is a parameter rather than
   `new Date()` inside the function so this stays a pure function - which is
   what lets it be checked with fixed timestamps in a test rather than one that
   only fails at a particular minute of the day.

   PRECEDENCE: the block list is checked FIRST, and a match there wins
   outright, whatever the allow list says. This is the ordinary firewall
   convention (a DENY rule beats an ALLOW rule) and it is also the only
   reading that keeps "block" meaning what its name says: if an allow match
   could override a block match, ejecting one bad office network you had
   previously allow-listed would require remembering to also remove it from
   the allow list, and forgetting that step would silently readmit exactly the
   address the block was added to keep out. */
export const evaluateIpAllowlist = (
  settings: AllowlistSettings | null | undefined,
  clientIp: string,
  now: Date,
): AllowlistDecision => {
  const allow = settings?.allow ?? emptyList();
  const block = settings?.block ?? emptyList();

  if (!settings || (allow.enabled !== true && block.enabled !== true)) {
    return { outcome: 'not_enforced' };
  }

  if (breakGlassIsOpen(settings.break_glass, now)) return { outcome: 'break_glass' };

  if (block.enabled === true) {
    const entries = Array.isArray(block.entries) ? block.entries : [];
    const matched = entries.find((entry) => matches(clientIp, entry.cidr));
    if (matched) return { outcome: 'denied', by: 'block', matched };
  }

  if (allow.enabled === true) {
    const entries = Array.isArray(allow.entries) ? allow.entries : [];
    if (entries.length === 0) return { outcome: 'misconfigured_empty' };
    const matched = entries.find((entry) => matches(clientIp, entry.cidr));
    return matched ? { outcome: 'allowed', matched } : { outcome: 'denied', by: 'allow' };
  }

  // Only the block list is on, and nothing in it matched this caller.
  return { outcome: 'allowed' };
};

/* A yes/no convenience over `evaluateIpAllowlist`, for a caller that only
   needs the boolean - a middleware guard mostly wants "let this through or
   not" and would otherwise re-derive the same switch over `outcome` at every
   call site. */
export const isAllowed = (
  settings: AllowlistSettings | null | undefined,
  clientIp: string,
  now: Date,
): boolean => {
  const decision = evaluateIpAllowlist(settings, clientIp, now);
  return (
    decision.outcome === 'not_enforced' ||
    decision.outcome === 'break_glass' ||
    decision.outcome === 'allowed' ||
    decision.outcome === 'misconfigured_empty'
  );
};

/* ------------------------------------------------------- reading old data */

const readEntries = (rawEntries: any): AllowlistEntry[] =>
  (Array.isArray(rawEntries) ? rawEntries : [])
    .filter((entry: any) => entry && typeof entry.cidr === 'string' && isValidCidr(entry.cidr))
    .map((entry: any, index: number) => ({
      id: typeof entry.id === 'string' && entry.id ? entry.id : `legacy-${index}`,
      cidr: entry.cidr.trim(),
      label: typeof entry.label === 'string' ? entry.label : '',
      added_at: typeof entry.added_at === 'string' ? entry.added_at : '',
      added_by_uuid: typeof entry.added_by_uuid === 'string' ? entry.added_by_uuid : undefined,
      added_by_name: typeof entry.added_by_name === 'string' ? entry.added_by_name : undefined,
    }));

/* Three generations of stored shape, read in order:
 *
 *   1. Current: `{ allow: {enabled, entries}, block: {enabled, entries} }` -
 *      two independent lists, read straight through.
 *   2. One generation back, for the few hours this feature had a single
 *      `mode: 'allow'|'block'` switch instead of two lists: `{ enabled, mode,
 *      entries }`. Mapped onto whichever of the two lists `mode` named; the
 *      other starts empty and off.
 *   3. Original: `{ enabled, cidr_blocks: string[] }`, no label, allow-only
 *      (block did not exist yet). Mapped onto `allow`.
 *
 * Every one of these is read rather than discarded, so a company that
 * configured this at any point since it first shipped never has their list
 * silently wiped by a later rewrite of the storage shape. */
export const migrateLegacyAllowlist = (stored: any): AllowlistSettings => {
  const audit_log = Array.isArray(stored?.audit_log) ? stored.audit_log : [];
  const break_glass =
    stored?.break_glass && typeof stored.break_glass === 'object' ? stored.break_glass : null;

  // Generation 1: already in the current shape.
  if (stored?.allow || stored?.block) {
    return {
      allow: {
        enabled: stored?.allow?.enabled === true,
        entries: readEntries(stored?.allow?.entries),
      },
      block: {
        enabled: stored?.block?.enabled === true,
        entries: readEntries(stored?.block?.entries),
      },
      audit_log,
      break_glass,
    };
  }

  // Generation 2: one `enabled` + `mode` covering a single `entries` array.
  if (Array.isArray(stored?.entries)) {
    const entries = readEntries(stored.entries);
    const enabled = stored?.enabled === true;
    const isBlock = stored?.mode === 'block';
    return {
      allow: { enabled: enabled && !isBlock, entries: isBlock ? [] : entries },
      block: { enabled: enabled && isBlock, entries: isBlock ? entries : [] },
      audit_log,
      break_glass,
    };
  }

  // Generation 3: the original `cidr_blocks: string[]`, allow-only, no label.
  const legacyBlocks: string[] = Array.isArray(stored?.cidr_blocks)
    ? stored.cidr_blocks.filter((block: any) => typeof block === 'string' && isValidCidr(block))
    : [];

  return {
    allow: {
      enabled: stored?.enabled === true,
      entries: legacyBlocks.map((cidr, index) => ({
        id: `legacy-${index}`,
        cidr,
        label: '',
        added_at: '',
      })),
    },
    block: emptyList(),
    audit_log: [],
    break_glass: null,
  };
};

/* Audit log kept short on purpose: this blob rides along on every save of
   every OTHER security setting on this page, and an unbounded list would make
   every unrelated save slower forever. The server-side table
   (`company_security_audit_log`, see `backend-patches/default-api/`) is the
   durable, unbounded record; this is a quick "what changed recently" view. */
export const MAX_CLIENT_AUDIT_ENTRIES = 30;

export const appendAudit = (
  log: AllowlistAuditEntry[],
  entry: AllowlistAuditEntry,
): AllowlistAuditEntry[] => [entry, ...log].slice(0, MAX_CLIENT_AUDIT_ENTRIES);
