/* Which queue a live call came through. The switch names the queue id twice -
   X-Queue on the caller's leg, X-ForwardValue on the agent's - and the agent's
   leg is the one that decides whether dispositions, script and wrap-up load. */

const assert = require('assert');
const { queueIdFromHeaders, queueIdFromHeaderMap } = require('./queue-session.build.cjs');

let passed = 0;
const check = (what, fn) => {
  fn();
  passed += 1;
  console.log('  ok  ' + what);
};

/* Headers exactly as each leg carries them. */
const CALLER_LEG = { 'x-queue': 'q-sales', 'x-forwardtype': 'QUEUE', 'x-forwardvalue': 'q-sales' };
const AGENT_LEG = { 'x-forwardtype': 'QUEUE', 'x-forwardvalue': 'q-sales' };
const CAMPAIGN_LEG = { 'x-forwardtype': 'CAMPAIGN', 'x-forwardvalue': 'camp-99' };
const EXTENSION_LEG = { 'x-forwardtype': 'EXTENSION', 'x-forwardvalue': '200' };

check('the caller leg still resolves from X-Queue, as it always did', () => {
  assert.strictEqual(queueIdFromHeaderMap(CALLER_LEG), 'q-sales');
});

check('THE BUG: the agent leg now resolves from X-ForwardValue', () => {
  assert.strictEqual(queueIdFromHeaderMap(AGENT_LEG), 'q-sales');
});

check('CONTROL the old behaviour found nothing on the agent leg', () => {
  const oldWay = (h) => String(h['x-queue'] || '').trim();
  assert.strictEqual(oldWay(AGENT_LEG), '');
  assert.strictEqual(oldWay(CALLER_LEG), 'q-sales');
});

check('a campaign call is NOT mistaken for a queue', () => {
  assert.strictEqual(queueIdFromHeaderMap(CAMPAIGN_LEG), '');
});

check('an ordinary extension call is NOT mistaken for a queue', () => {
  assert.strictEqual(queueIdFromHeaderMap(EXTENSION_LEG), '');
});

check('X-Queue wins when both are present and disagree', () => {
  const both = { 'x-queue': 'q-real', 'x-forwardtype': 'QUEUE', 'x-forwardvalue': 'q-other' };
  assert.strictEqual(queueIdFromHeaderMap(both), 'q-real');
});

check('the forward type is matched whatever its case', () => {
  assert.strictEqual(queueIdFromHeaderMap({ 'x-forwardtype': 'queue', 'x-forwardvalue': 'q1' }), 'q1');
  assert.strictEqual(queueIdFromHeaderMap({ 'x-forwardtype': ' Queue ', 'x-forwardvalue': 'q1' }), 'q1');
});

check('a queue call with no id yields nothing rather than a blank lookup', () => {
  assert.strictEqual(queueIdFromHeaderMap({ 'x-forwardtype': 'QUEUE' }), '');
  assert.strictEqual(queueIdFromHeaderMap({ 'x-forwardtype': 'QUEUE', 'x-forwardvalue': '  ' }), '');
});

check('no headers at all is not a crash', () => {
  assert.strictEqual(queueIdFromHeaderMap(null), '');
  assert.strictEqual(queueIdFromHeaderMap(undefined), '');
  assert.strictEqual(queueIdFromHeaderMap({}), '');
});

check('values are trimmed, so a padded header still matches a record', () => {
  assert.strictEqual(queueIdFromHeaderMap({ 'x-queue': '  q-sales  ' }), 'q-sales');
});

check('it works off a reader function, not just a plain object', () => {
  const reader = (name) => AGENT_LEG[name] || '';
  assert.strictEqual(queueIdFromHeaders(reader), 'q-sales');
});

console.log('\n  ' + passed + ' checks passed');
