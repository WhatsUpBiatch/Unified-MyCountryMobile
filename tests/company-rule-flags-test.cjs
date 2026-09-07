/* What a company rule's flags mean, and what gets written back.
 *
 * Built with:
 *   npx esbuild src/lib/company-rule-flags.ts --bundle --platform=node --format=cjs \
 *     --outfile=tests/company-rule-flags.build.cjs \
 *     --alias:@/services/api=./tests/company-settings-stubs/api.cjs \
 *     --alias:@/lib/utils=./tests/company-settings-stubs/utils.cjs --alias:@=./src \
 *     --external:@tanstack/react-query
 *   node --test tests/company-rule-flags-test.cjs
 *
 * The table these tests pin down is also implemented server-side, in default-api's
 * src/helpers/companyRuleFlags.ts. If a row here changes, that file must change too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readRuleFlags,
  writeRuleFlags,
  legacyOverrideFor,
  describeRuleFlags,
  ruleNodePath,
  readPath,
} = require('./company-rule-flags.build.cjs');

const flagsOf = (read) => ({ apply: read.apply, locked: read.locked });

/* ------------------------------------------------------------------------------
 * Reading the old flag.
 * ---------------------------------------------------------------------------- */

test('legacy override: true reads as apply, not locked', () => {
  const read = readRuleFlags({ recording: { override: true } }, 'recording');
  assert.deepEqual(read, { apply: true, locked: false, isLegacy: true });
});

test('legacy override: false (explicitly stored) reads as skip, locked', () => {
  const read = readRuleFlags({ recording: { override: false } }, 'recording');
  assert.deepEqual(read, { apply: false, locked: true, isLegacy: true });
});

test('flag absent on an existing node reads as skip, open', () => {
  const read = readRuleFlags({ recording: { automatic: { enabled: true } } }, 'recording');
  assert.deepEqual(read, { apply: false, locked: false, isLegacy: true });
});

test('node absent altogether reads as skip, open', () => {
  const read = readRuleFlags({ operational_hours: { type: 'weekly' } }, 'recording');
  assert.deepEqual(flagsOf(read), { apply: false, locked: false });
});

test('flag stored as null reads as skip, open, the same as absent', () => {
  const read = readRuleFlags({ recording: { override: null } }, 'recording');
  assert.deepEqual(read, { apply: false, locked: false, isLegacy: true });
});

test('flag stored as undefined reads as skip, open', () => {
  const read = readRuleFlags({ recording: { override: undefined } }, 'recording');
  assert.deepEqual(flagsOf(read), { apply: false, locked: false });
});

test('a non-boolean flag (a string from a hand edit) is treated as absent, not as a lock', () => {
  assert.deepEqual(flagsOf(readRuleFlags({ recording: { override: 'false' } }, 'recording')), {
    apply: false,
    locked: false,
  });
  assert.deepEqual(flagsOf(readRuleFlags({ recording: { override: 'true' } }, 'recording')), {
    apply: false,
    locked: false,
  });
});

test('no company record at all reads as skip, open and is not legacy', () => {
  assert.deepEqual(readRuleFlags(null, 'recording'), { apply: false, locked: false, isLegacy: false });
  assert.deepEqual(readRuleFlags(undefined, 'recording'), {
    apply: false,
    locked: false,
    isLegacy: false,
  });
});

test('CONTROL: the row-16 case. A record created by saving something unrelated locks nothing', () => {
  /* Saving a holiday creates the company record with operational_hours only. Every
     governed field must read as open, not locked, on every person's phone. */
  const settings = { operational_hours: { holidays: [{ date: '2026-12-25' }] } };
  for (const field of [
    'voicemail',
    'recording',
    'transcription',
    'ai_call_monitoring',
    'display_number',
    'business_hours',
    'regional',
    'role',
  ]) {
    assert.equal(readRuleFlags(settings, field).locked, false, `${field} must be open`);
    assert.equal(readRuleFlags(settings, field).apply, false, `${field} must not be applied`);
  }
});

test('a bare boolean node (old transcription shape) falls through to absent, so it is open', () => {
  assert.deepEqual(flagsOf(readRuleFlags({ transcription: true }, 'transcription')), {
    apply: false,
    locked: false,
  });
  assert.deepEqual(flagsOf(readRuleFlags({ transcription: false }, 'transcription')), {
    apply: false,
    locked: false,
  });
});

/* ------------------------------------------------------------------------------
 * New-style keys win.
 * ---------------------------------------------------------------------------- */

test('new keys win over an override that disagrees with them', () => {
  const read = readRuleFlags(
    { recording: { override: false, apply: true, locked: true } },
    'recording',
  );
  assert.deepEqual(read, { apply: true, locked: true, isLegacy: false });
});

test('new keys can say skip+open even with override: false beside them', () => {
  const read = readRuleFlags(
    { recording: { override: false, apply: false, locked: false } },
    'recording',
  );
  assert.deepEqual(read, { apply: false, locked: false, isLegacy: false });
});

test('a half-written node honours the key present and takes the other from override', () => {
  /* locked present, apply missing, override true → apply from override. */
  assert.deepEqual(readRuleFlags({ recording: { override: true, locked: true } }, 'recording'), {
    apply: true,
    locked: true,
    isLegacy: false,
  });
  /* apply present, locked missing, override absent → locked from absent = open. */
  assert.deepEqual(readRuleFlags({ recording: { apply: true } }, 'recording'), {
    apply: true,
    locked: false,
    isLegacy: false,
  });
  /* apply present, locked missing, override false → locked from false = locked. */
  assert.deepEqual(readRuleFlags({ recording: { apply: true, override: false } }, 'recording'), {
    apply: true,
    locked: true,
    isLegacy: false,
  });
});

test('a new key that is not a boolean is ignored, not honoured', () => {
  const read = readRuleFlags({ recording: { override: true, apply: 'yes', locked: 1 } }, 'recording');
  assert.deepEqual(read, { apply: true, locked: false, isLegacy: true });
});

/* ------------------------------------------------------------------------------
 * Writing, and what old readers see.
 * ---------------------------------------------------------------------------- */

const COMBINATIONS = [
  { apply: true, locked: true, override: true },
  { apply: true, locked: false, override: true },
  { apply: false, locked: true, override: false },
  { apply: false, locked: false, override: false },
];

for (const { apply, locked, override } of COMBINATIONS) {
  test(`writeRuleFlags apply=${apply} locked=${locked} round-trips and writes override=${override}`, () => {
    const before = { recording: { automatic: { enabled: true, value: 'both' } } };
    const after = writeRuleFlags(before, 'recording', { apply, locked });

    /* The new reader gets back exactly what was written. */
    assert.deepEqual(readRuleFlags(after, 'recording'), { apply, locked, isLegacy: false });

    /* The old flag is the one old readers see: `apply`, as the header explains. */
    assert.equal(after.recording.override, override);
    assert.equal(legacyOverrideFor({ apply, locked }), override);

    /* CONTROL: an old reader testing `=== true` behaves as documented — enabled and
       copying for apply, disabled and not copying otherwise. */
    assert.equal(after.recording.override === true, apply);

    /* Everything else on the node survives, and the input was not touched. */
    assert.deepEqual(after.recording.automatic, { enabled: true, value: 'both' });
    assert.deepEqual(before, { recording: { automatic: { enabled: true, value: 'both' } } });
  });
}

test('writing onto a missing node creates it without disturbing the rest of the record', () => {
  const before = { operational_hours: { type: 'weekly' } };
  const after = writeRuleFlags(before, 'display_number', { apply: true, locked: true });
  assert.deepEqual(after.display_number, { apply: true, locked: true, override: true });
  assert.equal(after.operational_hours, before.operational_hours);
});

test('writing onto a bare boolean node keeps its value as enabled', () => {
  const after = writeRuleFlags({ transcription: true }, 'transcription', {
    apply: true,
    locked: false,
  });
  assert.deepEqual(after.transcription, {
    enabled: true,
    apply: true,
    locked: false,
    override: true,
  });
});

test('writing a nested rule clones only the path and keeps siblings', () => {
  const before = {
    operational_hours: {
      type: 'weekly',
      regional: { timezone: { value: 'Europe/London' } },
    },
  };
  const after = writeRuleFlags(before, 'regional', { apply: true, locked: true });
  assert.deepEqual(after.operational_hours.regional, {
    timezone: { value: 'Europe/London' },
    apply: true,
    locked: true,
    override: true,
  });
  assert.equal(after.operational_hours.type, 'weekly');
  assert.equal(before.operational_hours.regional.apply, undefined);
});

/* ------------------------------------------------------------------------------
 * Paths, including the greetings record.
 * ---------------------------------------------------------------------------- */

test('a greeting path with the trailing .override reads the greeting, not voicemail_pin', () => {
  assert.equal(ruleNodePath('voicemail'), 'voicemail_pin');
  assert.equal(ruleNodePath('voicemail.override'), 'voicemail');

  const greetings = { voicemail: { enabled: true, override: true } };
  assert.deepEqual(flagsOf(readRuleFlags(greetings, 'voicemail.override')), {
    apply: true,
    locked: false,
  });

  const written = writeRuleFlags(greetings, 'voicemail.override', { apply: true, locked: true });
  assert.deepEqual(written.voicemail, { enabled: true, override: true, apply: true, locked: true });
  assert.deepEqual(readPath(written, 'voicemail'), written.voicemail);
});

test('the four combinations each get a different sentence', () => {
  const lines = new Set(COMBINATIONS.map((c) => describeRuleFlags(c)));
  assert.equal(lines.size, 4);
});
