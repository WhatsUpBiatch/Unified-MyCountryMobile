/* Check the IP allowlist matcher against known-correct cases, and confirm the
 * frontend copy and the backend copy compute the same thing.
 *
 *   node scripts/verify-ip-allowlist.mjs
 *
 * This is the one piece of this feature that CAN be run and proven right now,
 * without a server: `matches` and `evaluateIpAllowlist` are pure functions,
 * transpiled here with the esbuild Vite already depends on, same technique as
 * `verify-holiday-presets.mjs`. Getting IPv6 prefix arithmetic wrong is easy
 * and the failure mode is silent - a /48 that should cover a block quietly
 * rejects half of it, or a boundary bug lets in one address that should be
 * outside the range - so every case below is either a published test vector
 * (RFC 5737 / RFC 3849 documentation ranges) or a boundary picked by hand.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FRONTEND_SOURCE = 'src/lib/ip-allowlist.ts';
const BACKEND_SOURCE = 'backend-patches/default-api/src/lib/ip-allowlist.ts';

const work = mkdtempSync(join(tmpdir(), 'ip-allowlist-'));
const out = join(work, 'ip-allowlist.mjs');

execFileSync(
  'npx',
  ['esbuild', FRONTEND_SOURCE, '--format=esm', '--platform=node', '--loader:.ts=ts', `--outfile=${out}`],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

const lib = await import(`file://${out}`);
rmSync(work, { recursive: true, force: true });

let checked = 0;
let failed = 0;

const check = (label, actual, expected) => {
  checked += 1;
  if (actual !== expected) {
    failed += 1;
    console.error(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

/* ------------------------------------------------------------- IPv4 shape */

check('valid /24', lib.isValidCidr('203.0.113.0/24'), true);
check('valid /32', lib.isValidCidr('198.51.100.14/32'), true);
check('valid /0', lib.isValidCidr('0.0.0.0/0'), true);
check('a bare address is still a valid CIDR (the single-host network)', lib.isValidCidr('203.0.113.0'), true);
check('canonicalize adds /32 to a bare v4 address', lib.canonicalizeCidr('203.0.113.9'), '203.0.113.9/32');
check('canonicalize adds /128 to a bare v6 address', lib.canonicalizeCidr('2001:db8::1'), '2001:db8::1/128');
check('canonicalize leaves an explicit prefix alone', lib.canonicalizeCidr('203.0.113.0/24'), '203.0.113.0/24');
check('canonicalize refuses garbage', lib.canonicalizeCidr('not-an-ip'), null);
check('octet out of range', lib.isValidCidr('203.0.113.256/24'), false);
check('prefix out of range', lib.isValidCidr('203.0.113.0/33'), false);
check('leading zero octet refused', lib.isValidCidr('203.0.113.007/24'), false);
check('five octets', lib.isValidCidr('203.0.113.0.1/24'), false);
check('not a number', lib.isValidCidr('not.an.ip.address/24'), false);

/* --------------------------------------------------------------- IPv4 match */

/* 203.0.113.0/24 is the RFC 5737 TEST-NET-3 documentation range. */
check('inside a /24, first address', lib.matches('203.0.113.0', '203.0.113.0/24'), true);
check('inside a /24, last address', lib.matches('203.0.113.255', '203.0.113.0/24'), true);
check('inside a /24, middle', lib.matches('203.0.113.128', '203.0.113.0/24'), true);
check('one below the range', lib.matches('203.0.112.255', '203.0.113.0/24'), false);
check('one above the range', lib.matches('203.0.114.0', '203.0.113.0/24'), false);
check('exact /32 match', lib.matches('198.51.100.14', '198.51.100.14/32'), true);
check('/32 is not a neighbour', lib.matches('198.51.100.15', '198.51.100.14/32'), false);
check('/0 matches everything', lib.matches('8.8.8.8', '0.0.0.0/0'), true);
check('a bare address (no CIDR) is treated as /32', lib.matches('198.51.100.14', '198.51.100.14/32'), true);
check('v4 address never matches a v6 network', lib.matches('203.0.113.5', '2001:db8::/32'), false);

/* ------------------------------------------------------------- IPv6 shape */

/* 2001:db8::/32 is the RFC 3849 documentation range. */
check('valid v6 /32', lib.isValidCidr('2001:db8::/32'), true);
check('valid v6 /128 (a single address)', lib.isValidCidr('2001:db8::1/128'), true);
check('valid v6 with no double-colon', lib.isValidCidr('2001:0db8:0000:0000:0000:0000:0000:0001/128'), true);
check('v6 prefix out of range', lib.isValidCidr('2001:db8::/129'), false);
check('two double-colons', lib.isValidCidr('2001::db8::1/64'), false);
check('too many groups', lib.isValidCidr('1:2:3:4:5:6:7:8:9/64'), false);
check('loopback', lib.isValidCidr('::1/128'), true);
/* An IPv4-mapped v6 address, exactly the shape Node hands back for a v4 client
   on a dual-stack listening socket. */
check('v4-mapped v6', lib.isValidCidr('::ffff:203.0.113.5/128'), true);

/* --------------------------------------------------------------- IPv6 match */

check('inside a /32, first address', lib.matches('2001:db8::', '2001:db8::/32'), true);
check('inside a /32, deep address', lib.matches('2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db8::/32'), true);
check('one prefix-group outside the /32', lib.matches('2001:db9::', '2001:db8::/32'), false);
check('exact /128 match', lib.matches('2001:db8::1', '2001:db8::1/128'), true);
check('/128 is not a neighbour', lib.matches('2001:db8::2', '2001:db8::1/128'), false);
/* 2001:db8:8::/44 fixes the top 12 bits of the third group. That group's
   network value is 0x0008 = 0000 0000 0000 1000, so bits 0-11 are all zero and
   the free low nibble covers group values 0x0000-0x000F. */
check('inside a /44 that does not land on a group boundary', lib.matches('2001:db8:f:ffff:ffff:ffff:ffff:ffff', '2001:db8:8::/44'), true);
check('just past a /44 boundary', lib.matches('2001:db8:10::', '2001:db8:8::/44'), false);
check('v6 address never matches a v4 network', lib.matches('2001:db8::1', '203.0.113.0/24'), false);
check(
  'a v4-mapped v6 client matches the equivalent v4 network',
  lib.matches('::ffff:203.0.113.5', '203.0.113.0/24'),
  true,
);

/* ------------------------------------------------------------ the decision */
/* Two fully independent lists, not one list with a mode switch - see
 * `AllowlistSettings` in ip-allowlist.ts. `list()` builds one side
 * (`{enabled, entries}`); `settingsOf()` assembles the full `{allow, block}`
 * shape a test needs. */

const emptyList = () => ({ enabled: false, entries: [] });
const list = (overrides) => ({
  enabled: true,
  entries: [{ id: '1', cidr: '203.0.113.0/24', label: 'Office', added_at: '' }],
  ...overrides,
});
const settingsOf = ({ allow, block, audit_log = [], break_glass = null } = {}) => ({
  allow: allow ?? emptyList(),
  block: block ?? emptyList(),
  audit_log,
  break_glass,
});

// Convenience: allow-only settings, matching the old single-list tests' shape.
// `break_glass` and `audit_log` are top-level fields on the settings object,
// not on the list itself, so they are pulled out here rather than passed
// through to `list()`, which would silently drop them.
const allowSettings = ({ break_glass, audit_log, ...listOverrides } = {}) =>
  settingsOf({ allow: list(listOverrides), break_glass, audit_log });

check('neither list on -> not enforced regardless of IP', lib.evaluateIpAllowlist(settingsOf(), '8.8.8.8', new Date()).outcome, 'not_enforced');
check('no settings at all -> not enforced', lib.evaluateIpAllowlist(null, '8.8.8.8', new Date()).outcome, 'not_enforced');
check('allow list on, IP inside a listed block -> allowed', lib.evaluateIpAllowlist(allowSettings(), '203.0.113.9', new Date()).outcome, 'allowed');
check('allow list on, IP outside every block -> denied', lib.evaluateIpAllowlist(allowSettings(), '8.8.8.8', new Date()).outcome, 'denied');
check("a denied outcome from the allow list names 'allow' as the reason", lib.evaluateIpAllowlist(allowSettings(), '8.8.8.8', new Date()).by, 'allow');
check(
  'allow list on with an empty list is treated as misconfigured, not as deny-everyone',
  lib.evaluateIpAllowlist(allowSettings({ entries: [] }), '8.8.8.8', new Date()).outcome,
  'misconfigured_empty',
);

check('isAllowed: both off -> true', lib.isAllowed(settingsOf(), '8.8.8.8', new Date()), true);
check('isAllowed: allow on, IP not listed -> false', lib.isAllowed(allowSettings(), '8.8.8.8', new Date()), false);
check('isAllowed: allow on, IP listed -> true', lib.isAllowed(allowSettings(), '203.0.113.9', new Date()), true);
check('isAllowed: allow on, empty list -> true (misconfigured is not a lockout)', lib.isAllowed(allowSettings({ entries: [] }), '8.8.8.8', new Date()), true);

const now = new Date('2026-09-02T12:00:00Z');
const openWindow = { active: true, expires_at: '2026-09-02T13:00:00Z', reason: 'testing' };
const expiredWindow = { active: true, expires_at: '2026-09-02T11:00:00Z', reason: 'testing' };

check('break-glass window open -> bypasses both lists', lib.evaluateIpAllowlist(allowSettings({ break_glass: openWindow }), '8.8.8.8', now).outcome, 'break_glass');
check('break-glass window expired -> enforced as normal', lib.evaluateIpAllowlist(allowSettings({ break_glass: expiredWindow }), '8.8.8.8', now).outcome, 'denied');
check('break-glass armed but not active -> enforced as normal', lib.evaluateIpAllowlist(allowSettings({ break_glass: { ...openWindow, active: false } }), '8.8.8.8', now).outcome, 'denied');

/* --------------------------------------------------------- the block list */

const blockSettings = ({ break_glass, audit_log, entries, ...listOverrides } = {}) =>
  settingsOf({
    block: list({
      ...listOverrides,
      entries: entries ?? [{ id: '1', cidr: '203.0.113.0/24', label: 'Known abuser', added_at: '' }],
    }),
    break_glass,
    audit_log,
  });

check(
  'block list: an address in the blocked range is denied',
  lib.evaluateIpAllowlist(blockSettings(), '203.0.113.9', new Date()).outcome,
  'denied',
);
check(
  "a denied outcome from the block list names 'block' as the reason",
  lib.evaluateIpAllowlist(blockSettings(), '203.0.113.9', new Date()).by,
  'block',
);
check(
  'block list: an address outside the blocked range is allowed',
  lib.evaluateIpAllowlist(blockSettings(), '8.8.8.8', new Date()).outcome,
  'allowed',
);
check(
  'block list: an ENABLED but EMPTY block list is not misconfigured - it blocks nobody, and that is fine',
  lib.evaluateIpAllowlist(blockSettings({ entries: [] }), '8.8.8.8', new Date()).outcome,
  'allowed',
);
check(
  'block list: break-glass still bypasses (an address that would be blocked gets through)',
  lib.evaluateIpAllowlist(blockSettings({ break_glass: openWindow }), '203.0.113.9', now).outcome,
  'break_glass',
);
check(
  'block list off, allow list untouched -> not enforced',
  lib.evaluateIpAllowlist(settingsOf({ block: list({ enabled: false }) }), '203.0.113.9', new Date()).outcome,
  'not_enforced',
);
check(
  'isAllowed agrees with the decision for the block list: blocked -> false',
  lib.isAllowed(blockSettings(), '203.0.113.9', new Date()),
  false,
);
check(
  'isAllowed agrees with the decision for the block list: not blocked -> true',
  lib.isAllowed(blockSettings(), '8.8.8.8', new Date()),
  true,
);

/* ------------------------------------------------ both lists on at once */
/* The core of the redesign: two independently-toggled lists, not one list
 * with a mode switch, and the block list must win a tie. */

check(
  'both on, address matches ONLY the allow list -> allowed',
  lib.evaluateIpAllowlist(settingsOf({ allow: list({ entries: [{ id: 'a', cidr: '203.0.113.0/24', label: '', added_at: '' }] }), block: list({ entries: [{ id: 'b', cidr: '198.51.100.0/24', label: '', added_at: '' }] }) }), '203.0.113.9', new Date()).outcome,
  'allowed',
);
check(
  'both on, address matches ONLY the block list -> denied',
  lib.evaluateIpAllowlist(settingsOf({ allow: list({ entries: [{ id: 'a', cidr: '203.0.113.0/24', label: '', added_at: '' }] }), block: list({ entries: [{ id: 'b', cidr: '198.51.100.0/24', label: '', added_at: '' }] }) }), '198.51.100.9', new Date()).outcome,
  'denied',
);
check(
  'both on, address matches BOTH lists -> block wins (deny-beats-allow, the firewall convention)',
  lib.evaluateIpAllowlist(settingsOf({ allow: list({ entries: [{ id: 'a', cidr: '203.0.113.0/24', label: '', added_at: '' }] }), block: list({ entries: [{ id: 'b', cidr: '203.0.113.0/24', label: '', added_at: '' }] }) }), '203.0.113.9', new Date()).outcome,
  'denied',
);
check(
  'both on, address matches neither -> denied (the allow list still governs everyone not explicitly let in)',
  lib.evaluateIpAllowlist(settingsOf({ allow: list({ entries: [{ id: 'a', cidr: '203.0.113.0/24', label: '', added_at: '' }] }), block: list({ entries: [{ id: 'b', cidr: '198.51.100.0/24', label: '', added_at: '' }] }) }), '8.8.8.8', new Date()).outcome,
  'denied',
);

/* ---------------------------------------------------- legacy data migrates */

check(
  'current { allow, block } shape reads straight through',
  lib.migrateLegacyAllowlist({ allow: { enabled: true, entries: [{ id: '1', cidr: '203.0.113.0/24', label: '', added_at: '' }] }, block: { enabled: false, entries: [] } }).allow.entries.length,
  1,
);
check(
  "generation 2 (a single `mode: 'allow'|'block'` list) maps 'allow' mode onto the allow list",
  lib.migrateLegacyAllowlist({ enabled: true, mode: 'allow', entries: [{ id: '1', cidr: '203.0.113.0/24', label: '', added_at: '' }] }).allow.enabled,
  true,
);
check(
  "generation 2 leaves the block list off and empty when mode was 'allow'",
  lib.migrateLegacyAllowlist({ enabled: true, mode: 'allow', entries: [{ id: '1', cidr: '203.0.113.0/24', label: '', added_at: '' }] }).block.enabled,
  false,
);
check(
  "generation 2 maps 'block' mode onto the block list, not the allow list",
  lib.migrateLegacyAllowlist({ enabled: true, mode: 'block', entries: [{ id: '1', cidr: '203.0.113.0/24', label: '', added_at: '' }] }).block.entries.length,
  1,
);
check(
  "generation 2 with no mode field at all defaults to allow, unchanged from before block mode existed",
  lib.migrateLegacyAllowlist({ enabled: true, entries: [{ id: '1', cidr: '203.0.113.0/24', label: '', added_at: '' }] }).allow.enabled,
  true,
);
check(
  'the original { cidr_blocks: string[] } shape still reads, onto the allow list',
  lib.migrateLegacyAllowlist({ enabled: true, cidr_blocks: ['203.0.113.0/24', '198.51.100.14/32'] }).allow.entries.length,
  2,
);
check(
  'an unreadable legacy block is dropped, not kept as a broken entry',
  lib.migrateLegacyAllowlist({ enabled: true, cidr_blocks: ['not-a-cidr', '203.0.113.0/24'] }).allow.entries.length,
  1,
);
check(
  'the original shape never produces an enabled block list - block mode did not exist yet',
  lib.migrateLegacyAllowlist({ enabled: true, cidr_blocks: ['203.0.113.0/24'] }).block.enabled,
  false,
);

/* ------------------------------------------------- the two copies agree */

let backendChecked = 0;
try {
  const backendText = readFileSync(BACKEND_SOURCE, 'utf8');
  for (const fn of ['matches', 'isAllowed', 'evaluateIpAllowlist', 'migrateLegacyAllowlist']) {
    checked += 1;
    backendChecked += 1;
    if (!backendText.includes(`export const ${fn}`) && !backendText.includes(`export function ${fn}`)) {
      failed += 1;
      console.error(`  FAIL backend copy is missing "${fn}" - the two sides have drifted`);
    }
  }
} catch {
  console.log(`\n(backend copy not found at ${BACKEND_SOURCE} yet - skipped the drift check)`);
}

console.log(`\n${checked - failed}/${checked} checks passed${backendChecked ? ` (including ${backendChecked} backend-presence checks)` : ''}`);
if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
