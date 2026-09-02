/* Call logs were showing 7770112568081009 where the person had dialled
   +1 256 808 1009, and 1000_web where their own extension belonged. The
   headline test is the plain one: the number that comes out is the number that
   went in. The rest guard the edge the rule turns on — a real number must never
   be shortened, however it happens to start. */

const assert = require('assert');
const { stripCarrierRoutingPrefix, normalizeCallNumber } = require('./call-number.build.cjs');

let passed = 0;
const check = (what, fn) => {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${what}\n        ${err.message}`);
    process.exitCode = 1;
  }
};

check('the number dialled is the number shown', () => {
  assert.strictEqual(normalizeCallNumber('7770112568081009'), '12568081009');
});

check('an international destination comes back whole', () => {
  assert.strictEqual(normalizeCallNumber('77701917666718264'), '917666718264');
});

check('the web phone shows its extension, not its SIP endpoint', () => {
  assert.strictEqual(normalizeCallNumber('1000_web'), '1000');
});

check('a full SIP URI is reduced to the number', () => {
  assert.strictEqual(normalizeCallNumber('sip:1010_web@mycountrymobile.com'), '1010');
});

check('the second carrier prefix is handled too', () => {
  assert.strictEqual(normalizeCallNumber('6732912345678901'), '912345678901');
});

/* The guard. Stripping only happens above 15 digits, which E.164 forbids, so a
   real number that starts with a prefix's digits survives untouched. */
check('a real number beginning with 77701 is left alone', () => {
  assert.strictEqual(normalizeCallNumber('777011234'), '777011234');
});

check('the longest legal number is never shortened', () => {
  assert.strictEqual(normalizeCallNumber('777011234567890'), '777011234567890');
});

check('an unrecognised long number is left as it is', () => {
  assert.strictEqual(normalizeCallNumber('99999912568081009'), '99999912568081009');
});

check('a leading plus is kept', () => {
  assert.strictEqual(normalizeCallNumber('+12568081009'), '+12568081009');
});

check('spaces and casing do not defeat it', () => {
  assert.strictEqual(normalizeCallNumber(' 1000_WEB '), '1000');
});

check('empty and missing values give an empty string', () => {
  assert.strictEqual(normalizeCallNumber(''), '');
  assert.strictEqual(normalizeCallNumber(null), '');
  assert.strictEqual(normalizeCallNumber(undefined), '');
});

check('a non-numeric value is not treated as a prefixed number', () => {
  assert.strictEqual(stripCarrierRoutingPrefix('77701abcdefghijkl'), '77701abcdefghijkl');
});

console.log(`  ${passed} passed${process.exitCode ? ' (with failures above)' : ''}`);
