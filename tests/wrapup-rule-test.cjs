/* What an agent may do after a call ends. Five modes that all behaved
   identically until now, so the tests are mostly about telling them apart —
   and about the one direction that must never go wrong: nobody trapped in a
   wrap-up they cannot leave. */

const assert = require('assert');
const {
  WRAPUP_MODES,
  WRAPUP_DEFAULT_MODE,
  readWrapupMode,
  wrapupVerdict,
} = require('./wrapup-rule.build.cjs');

let passed = 0;
const check = (what, fn) => {
  fn();
  passed += 1;
  console.log('  ok  ' + what);
};

const state = (over) => ({
  mode: WRAPUP_MODES.MANDATORY_TIMEOUT,
  totalSeconds: 30,
  elapsedSeconds: 0,
  hasDisposition: false,
  ...over,
});

check('optional lets the agent go straight away', () => {
  const v = wrapupVerdict(state({ mode: 'OPTIONAL' }));
  assert.strictEqual(v.mayLeave, true);
  assert.strictEqual(v.blockedReason, '');
});

check('required holds them until the call is labelled', () => {
  const before = wrapupVerdict(state({ mode: 'MANDATORY' }));
  const after = wrapupVerdict(state({ mode: 'MANDATORY', hasDisposition: true }));
  assert.strictEqual(before.mayLeave, false);
  assert.ok(before.blockedReason.length > 0);
  assert.strictEqual(after.mayLeave, true);
  assert.strictEqual(after.blockedReason, '');
});

check('"required, no time limit" shows no countdown and never auto-closes', () => {
  const v = wrapupVerdict(state({ mode: 'MANDATORY', elapsedSeconds: 9999 }));
  assert.strictEqual(v.showCountdown, false, 'a clock says the opposite of "take your time"');
  assert.strictEqual(v.autoClose, false);
  assert.strictEqual(v.mayLeave, false, 'still needs the label, however long they take');
});

check('"required, then moves on" releases them when the time runs out', () => {
  const during = wrapupVerdict(state({ mode: 'MANDATORY_TIMEOUT', elapsedSeconds: 10 }));
  const after = wrapupVerdict(state({ mode: 'MANDATORY_TIMEOUT', elapsedSeconds: 30 }));
  assert.strictEqual(during.mayLeave, false);
  assert.strictEqual(after.mayLeave, true);
  assert.strictEqual(after.autoClose, true);
});

check('"forced" closes it for them even with nothing chosen', () => {
  const v = wrapupVerdict(state({ mode: 'MANDATORY_FORCED_TIMEOUT', elapsedSeconds: 30 }));
  assert.strictEqual(v.autoClose, true);
  /* And they still could not have left of their own accord without labelling -
     the product ended it, the agent did not skip it. */
  assert.strictEqual(v.mayLeave, false);
});

check('CONTROL forced and plain timeout differ, or the setting is decorative', () => {
  const s = { totalSeconds: 30, elapsedSeconds: 30, hasDisposition: false };
  const plain = wrapupVerdict({ ...s, mode: 'MANDATORY_TIMEOUT' });
  const forced = wrapupVerdict({ ...s, mode: 'MANDATORY_FORCED_TIMEOUT' });
  assert.notStrictEqual(plain.mayLeave, forced.mayLeave);
});

check('"only when asked" shows nothing until the agent asks', () => {
  const idle = wrapupVerdict(state({ mode: 'AGENT_REQUESTED' }));
  const asked = wrapupVerdict(state({ mode: 'AGENT_REQUESTED', requested: true }));
  assert.strictEqual(idle.active, false);
  assert.strictEqual(idle.mayLeave, true);
  assert.strictEqual(asked.active, true);
});

check('THE ONE THAT MATTERS: an unreadable mode behaves exactly as before', () => {
  for (const junk of [undefined, null, '', 'NONSENSE', 42, {}]) {
    const v = wrapupVerdict(state({ mode: junk, elapsedSeconds: 30 }));
    const known = wrapupVerdict(state({ mode: WRAPUP_DEFAULT_MODE, elapsedSeconds: 30 }));
    assert.deepStrictEqual(v, known, String(junk));
    assert.strictEqual(v.mayLeave, true, 'and it must release them, never trap them');
  }
});

check('CONTROL nobody is ever trapped with no way out', () => {
  /* Every mandatory mode must eventually release the agent, either by their own
     hand once labelled or by the clock. MANDATORY is the deliberate exception:
     it has no clock, so the label is the only exit — and that exit always works. */
  for (const mode of Object.values(WRAPUP_MODES)) {
    const labelled = wrapupVerdict(state({ mode, hasDisposition: true, elapsedSeconds: 0 }));
    assert.strictEqual(labelled.mayLeave, true, mode + ' traps a labelled call');
  }
});

check('a queue with no time limit still works', () => {
  const v = wrapupVerdict(state({ mode: 'MANDATORY_TIMEOUT', totalSeconds: 0, elapsedSeconds: 999 }));
  assert.strictEqual(v.autoClose, false, 'no limit means no expiry');
  assert.strictEqual(v.mayLeave, false, 'so the label is the only way out');
});

check('the mode is read case-insensitively and trimmed', () => {
  assert.strictEqual(readWrapupMode('  optional '), 'OPTIONAL');
  assert.strictEqual(readWrapupMode('Mandatory'), 'MANDATORY');
  assert.strictEqual(readWrapupMode('nope'), WRAPUP_DEFAULT_MODE);
});

console.log('\n  ' + passed + ' checks passed');
