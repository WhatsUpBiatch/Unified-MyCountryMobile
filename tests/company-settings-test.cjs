/* Company settings, two stores behind one door.
 *
 * The screens read and write one shape - {settings, greetings} - and this
 * proves that shape survives a trip through the per-section store, that the
 * first call of a session decides which store speaks and decides it the safe
 * way (a 404 means "old store", a 500 means "tell me", never "old store"),
 * that a save touches exactly the sections it names and carries the version
 * it last saw, and that a stale save says so in plain words.
 *
 *   npx esbuild tests/company-settings.entry.cjs --bundle --platform=node \
 *     --format=cjs --outfile=tests/company-settings.build.cjs \
 *     --alias:@/services/api=./tests/company-settings-stubs/api.cjs \
 *     --alias:@/lib/utils=./tests/company-settings-stubs/utils.cjs --alias:@=./src
 *   node --test tests/company-settings-test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('./company-settings.build.cjs');

const {
  assembleFromSections,
  splitIntoSections,
  isListResult,
  isEndpointAbsent,
  unwrapResult,
  fetchCompanyDefaults,
  saveCompanyDefaults,
  getCompanySettingsStore,
  resetCompanySettingsDetection,
  STALE_SAVE_MESSAGE,
  COMPANY_SETTINGS_UUID,
} = lib;

/* ---- helpers ------------------------------------------------------------ */

const httpError = (status, data) => {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data };
  error.isAxiosError = true;
  return error;
};

/* The envelope every list endpoint uses: axios response -> data.data.result. */
const envelope = (result, message) => ({ data: { data: { result, message } } });

const section = (settings, version, updated_at, extra = {}) => ({
  settings,
  version,
  updated_at,
  updated_by: 'u1',
  updated_by_name: 'Ann',
  ...extra,
});

const fresh = (api) => {
  resetCompanySettingsDetection();
  globalThis.__mcmApi = api;
  globalThis.__mcmCalls = [];
  globalThis.__mcmToasts = [];
};
const calls = (name) => (globalThis.__mcmCalls || []).filter((c) => c.name === name);

const SECTIONS = {
  security: section({ mfa: true, idle_minutes: 15 }, 3, '2026-09-01T10:00:00Z'),
  holidays: section({ days: ['2026-12-25'] }, 7, '2026-09-02T09:30:00Z'),
  greetings: section({ welcome: { url: 'x.wav' } }, 2, '2026-08-20T08:00:00Z'),
};

const TEMPLATE_ROWS = envelope({
  rows: [
    { uuid: 'row-old', name: 'Company Default (old)', settings: '{"a":1}', greetings: '{}' },
    {
      uuid: 'row-1',
      name: 'Company Default',
      settings: JSON.stringify({ security: { mfa: false } }),
      greetings: JSON.stringify({ welcome: 'old.wav' }),
      updated_at: '2026-07-01T00:00:00Z',
    },
  ],
});

/* ---- assemble / split --------------------------------------------------- */

test('assembleFromSections builds the old template shape', () => {
  const out = assembleFromSections(SECTIONS);
  assert.equal(out.uuid, COMPANY_SETTINGS_UUID);
  assert.equal(out.name, 'Company Default');
  assert.deepEqual(out.settings, {
    security: { mfa: true, idle_minutes: 15 },
    holidays: { days: ['2026-12-25'] },
  });
  assert.deepEqual(out.greetings, { welcome: { url: 'x.wav' } });
  assert.equal(out.updated_at, '2026-09-02T09:30:00Z', 'newest section wins');
  assert.deepEqual(out.versions, { security: 3, holidays: 7, greetings: 2 });
});

test('assembleFromSections parses settings that arrive as JSON strings', () => {
  const out = assembleFromSections({
    security: section('{"mfa":true}', 1),
    greetings: section('{"welcome":"w.wav"}', 1),
  });
  assert.deepEqual(out.settings, { security: { mfa: true } });
  assert.deepEqual(out.greetings, { welcome: 'w.wav' });
});

test('assembleFromSections of nothing is an empty, well-formed object', () => {
  const out = assembleFromSections({});
  assert.deepEqual(out.settings, {});
  assert.deepEqual(out.greetings, {});
  assert.deepEqual(out.versions, {});
  assert.equal(out.updated_at, undefined);
  assert.deepEqual(assembleFromSections(null).settings, {});
});

test('splitIntoSections is one section per key plus greetings', () => {
  const out = splitIntoSections({ security: { mfa: true }, holidays: { days: [] } }, { welcome: 'w' });
  assert.deepEqual(out, {
    security: { settings: { mfa: true } },
    holidays: { settings: { days: [] } },
    greetings: { settings: { welcome: 'w' } },
  });
});

test('splitIntoSections drops undefined keys and non-object greetings', () => {
  const out = splitIntoSections({ security: undefined, holidays: { days: [] } }, null);
  assert.deepEqual(out, { holidays: { settings: { days: [] } } });
  assert.deepEqual(splitIntoSections(null, undefined), {});
});

test('round trip: assemble(split(x)) gives x back', () => {
  const settings = { security: { mfa: true }, holidays: { days: ['2026-12-25'] }, logo: { url: 'l' } };
  const greetings = { welcome: { url: 'x.wav' } };
  const back = assembleFromSections(splitIntoSections(settings, greetings));
  assert.deepEqual(back.settings, settings);
  assert.deepEqual(back.greetings, greetings);
});

test('round trip: split(assemble(sections)) gives the settings of every section back', () => {
  const split = splitIntoSections(assembleFromSections(SECTIONS).settings, assembleFromSections(SECTIONS).greetings);
  assert.deepEqual(Object.keys(split).sort(), Object.keys(SECTIONS).sort());
  for (const name of Object.keys(SECTIONS)) {
    assert.deepEqual(split[name].settings, SECTIONS[name].settings);
  }
});

/* ---- shape and status helpers ------------------------------------------- */

test('unwrapResult tolerates a missing envelope layer', () => {
  assert.deepEqual(unwrapResult({ data: { data: { result: { sections: {} } } } }), { sections: {} });
  assert.deepEqual(unwrapResult({ data: { result: { sections: {} } } }), { sections: {} });
  assert.deepEqual(unwrapResult({ result: { sections: {} } }), { sections: {} });
  assert.equal(unwrapResult({ data: 'nope' }), null);
  assert.equal(unwrapResult(undefined), null);
});

test('isListResult accepts only a body with a sections object', () => {
  assert.equal(isListResult({ sections: {}, migrated_from_template: false }), true);
  assert.equal(isListResult({ sections: [] }), false);
  assert.equal(isListResult({ rows: [] }), false);
  assert.equal(isListResult('<html>'), false);
  assert.equal(isListResult(null), false);
});

test('isEndpointAbsent is 404 or 501 and nothing else', () => {
  assert.equal(isEndpointAbsent(httpError(404)), true);
  assert.equal(isEndpointAbsent(httpError(501)), true);
  assert.equal(isEndpointAbsent(httpError(500)), false);
  assert.equal(isEndpointAbsent(httpError(502)), false);
  assert.equal(isEndpointAbsent(new Error('Network Error')), false, 'no response is not absent');
});

/* ---- feature detection -------------------------------------------------- */

test('404 from list: old store for the rest of the session', async () => {
  fresh({
    listCompanySettings: async () => { throw httpError(404, { message: 'Not Found' }); },
    getTemplateList: async () => TEMPLATE_ROWS,
  });
  assert.equal(getCompanySettingsStore(), 'unknown');
  const row = await fetchCompanyDefaults();
  assert.equal(getCompanySettingsStore(), 'template');
  assert.equal(row.uuid, 'row-1', 'the exact-name row, not the loose match');
  assert.deepEqual(row.settings, { security: { mfa: false } });
  assert.equal(row.versions, undefined, 'the old store has no versions');

  await fetchCompanyDefaults();
  await fetchCompanyDefaults();
  assert.equal(calls('listCompanySettings').length, 1, 'probed once, then never again');
  assert.equal(calls('getTemplateList').length, 3);
  assert.deepEqual(globalThis.__mcmToasts, [], 'a silent probe: no toast for the 404');
});

test('501 from list also means old store', async () => {
  fresh({
    listCompanySettings: async () => { throw httpError(501); },
    getTemplateList: async () => TEMPLATE_ROWS,
  });
  await fetchCompanyDefaults();
  assert.equal(getCompanySettingsStore(), 'template');
});

test('200 with the wrong body means old store', async () => {
  fresh({
    listCompanySettings: async () => ({ data: '<html>proxy index</html>' }),
    getTemplateList: async () => TEMPLATE_ROWS,
  });
  const row = await fetchCompanyDefaults();
  assert.equal(getCompanySettingsStore(), 'template');
  assert.equal(row.uuid, 'row-1');
});

test('list works: new store, assembled shape with versions', async () => {
  fresh({
    listCompanySettings: async () => envelope({ sections: SECTIONS, migrated_from_template: true }),
    getTemplateList: async () => { throw new Error('must not be called'); },
  });
  const row = await fetchCompanyDefaults();
  assert.equal(getCompanySettingsStore(), 'sections');
  assert.equal(row.uuid, COMPANY_SETTINGS_UUID);
  assert.equal(row.name, 'Company Default');
  assert.deepEqual(row.settings.security, { mfa: true, idle_minutes: 15 });
  assert.deepEqual(row.greetings, { welcome: { url: 'x.wav' } });
  assert.deepEqual(row.versions, { security: 3, holidays: 7, greetings: 2 });
  assert.equal(calls('getTemplateList').length, 0);
});

test('list works but has no sections: null, as "no row" always was', async () => {
  fresh({ listCompanySettings: async () => envelope({ sections: {}, migrated_from_template: false }) });
  assert.equal(await fetchCompanyDefaults(), null);
  assert.equal(getCompanySettingsStore(), 'sections');
});

test('500 from list: the error is thrown, the old store is NOT read', async () => {
  fresh({
    listCompanySettings: async () => { throw httpError(500, { message: 'boom' }); },
    getTemplateList: async () => TEMPLATE_ROWS,
  });
  await assert.rejects(fetchCompanyDefaults(), (e) => e.response.status === 500);
  assert.equal(getCompanySettingsStore(), 'unknown', 'nothing decided on a transient failure');
  assert.equal(calls('getTemplateList').length, 0, 'CONTROL: stale template row never shown as current');
  assert.deepEqual(globalThis.__mcmToasts, [{ text: 'boom', type: 'error' }], 'the user is told');
});

test('a dropped connection (no response at all) is not "absent" either', async () => {
  fresh({
    listCompanySettings: async () => { throw new Error('Network Error'); },
    getTemplateList: async () => TEMPLATE_ROWS,
  });
  await assert.rejects(fetchCompanyDefaults());
  assert.equal(getCompanySettingsStore(), 'unknown');
  assert.equal(calls('getTemplateList').length, 0);
});

test('a 500 that comes after a good answer is thrown too; the store does not flip back', async () => {
  let turn = 0;
  fresh({
    listCompanySettings: async () => {
      turn += 1;
      if (turn === 1) return envelope({ sections: SECTIONS });
      throw httpError(404);
    },
    getTemplateList: async () => TEMPLATE_ROWS,
  });
  await fetchCompanyDefaults();
  assert.equal(getCompanySettingsStore(), 'sections');
  await assert.rejects(fetchCompanyDefaults(), (e) => e.response.status === 404);
  assert.equal(getCompanySettingsStore(), 'sections');
  assert.equal(calls('getTemplateList').length, 0);
});

test('fifteen screens loading at once share one probe', async () => {
  let hits = 0;
  fresh({
    listCompanySettings: async () => {
      hits += 1;
      await new Promise((r) => setTimeout(r, 5));
      return envelope({ sections: SECTIONS });
    },
  });
  const rows = await Promise.all(Array.from({ length: 15 }, () => fetchCompanyDefaults()));
  assert.equal(hits, 1);
  assert.equal(rows.every((r) => r.versions.security === 3), true);
});

/* ---- saving on the old store (unchanged behaviour) ---------------------- */

test('old store, whole blob: one upsert with the uuid kept', async () => {
  fresh({
    listCompanySettings: async () => { throw httpError(404); },
    getTemplateList: async () => TEMPLATE_ROWS,
    upsertTemplate: async (body) => ({ data: { data: { message: 'Saved', result: body } } }),
  });
  await fetchCompanyDefaults();
  const res = await saveCompanyDefaults({ uuid: 'row-1', settings: { a: 1 }, greetings: {} });
  const sent = calls('upsertTemplate');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].args[0].uuid, 'row-1');
  assert.equal(sent[0].args[0].name, 'Company Default');
  assert.deepEqual(sent[0].args[0].settings, { a: 1 });
  assert.equal(res.data.data.message, 'Saved');
});

test('old store, only: re-read, replace just those keys, keep the rest', async () => {
  fresh({
    listCompanySettings: async () => { throw httpError(404); },
    getTemplateList: async () => TEMPLATE_ROWS,
    upsertTemplate: async (body) => ({ data: { data: { message: 'Saved', result: body } } }),
  });
  await saveCompanyDefaults({
    settings: { holidays: { days: ['x'] }, security: { mfa: true /* stale copy, not listed */ } },
    greetings: { welcome: 'ignored' },
    only: ['holidays'],
  });
  const body = calls('upsertTemplate')[0].args[0];
  assert.equal(body.uuid, 'row-1');
  assert.deepEqual(body.settings, { security: { mfa: false }, holidays: { days: ['x'] } });
  assert.deepEqual(body.greetings, { welcome: 'old.wav' }, 'greetings untouched');
});

/* ---- saving on the new store -------------------------------------------- */

const sectionServer = () => {
  const versions = { security: 3, holidays: 7, greetings: 2 };
  const saved = [];
  return {
    saved,
    versions,
    api: {
      listCompanySettings: async () =>
        envelope({
          sections: Object.fromEntries(
            Object.entries(SECTIONS).map(([name, row]) => [name, { ...row, version: versions[name] }]),
          ),
        }),
      saveCompanySettingsSection: async (body) => {
        if (body.version !== undefined && body.version !== versions[body.section]) {
          throw httpError(409, {
            message: 'Version conflict',
            data: { result: { section: body.section, version: versions[body.section] } },
          });
        }
        versions[body.section] = (versions[body.section] || 0) + 1;
        saved.push(body);
        return envelope({ section: body.section, version: versions[body.section], updated_at: 'now' }, 'Section saved');
      },
      getTemplateList: async () => { throw new Error('must not be called'); },
      upsertTemplate: async () => { throw new Error('must not be called'); },
    },
  };
};

test('new store, only: just the named sections, each with its known version', async () => {
  const server = sectionServer();
  fresh(server.api);
  await fetchCompanyDefaults();
  const res = await saveCompanyDefaults({
    uuid: 'ignored',
    settings: { holidays: { days: ['y'] }, security: { mfa: false /* stale, not listed */ } },
    greetings: { welcome: 'ignored' },
    only: ['holidays'],
  });
  assert.deepEqual(server.saved, [{ section: 'holidays', settings: { days: ['y'] }, version: 7 }]);
  assert.equal(calls('upsertTemplate').length, 0);
  assert.equal(typeof res.data.message, 'string', 'response.data.message readable');
  assert.equal(typeof res.data.data.message, 'string', 'response.data.data.message readable');
  assert.deepEqual(res.data.data.result.saved, [{ section: 'holidays', version: 8, updated_at: 'now' }]);
  assert.equal(res.data.data.result.versions.holidays, 8, 'the new version is remembered');
});

test('new store, only with greetings: greetings is a section', async () => {
  const server = sectionServer();
  fresh(server.api);
  await fetchCompanyDefaults();
  await saveCompanyDefaults({ settings: {}, greetings: { welcome: 'new.wav' }, only: ['greetings', 'logo'] });
  assert.deepEqual(server.saved, [
    { section: 'greetings', settings: { welcome: 'new.wav' }, version: 2 },
    { section: 'logo', settings: {} },
  ]);
});

test('new store, only with an undefined key: that section is emptied', async () => {
  const server = sectionServer();
  fresh(server.api);
  await fetchCompanyDefaults();
  await saveCompanyDefaults({ settings: {}, greetings: {}, only: ['security'] });
  assert.deepEqual(server.saved, [{ section: 'security', settings: {}, version: 3 }]);
});

test('new store, whole blob: every top-level key, empty greetings left alone', async () => {
  const server = sectionServer();
  fresh(server.api);
  await fetchCompanyDefaults();
  await saveCompanyDefaults({
    settings: { security: { mfa: true }, holidays: { days: [] }, brand_new: { x: 1 } },
    greetings: {},
  });
  assert.deepEqual(
    server.saved.map((s) => [s.section, s.version]),
    [['security', 3], ['holidays', 7], ['brand_new', undefined]],
  );
});

test('new store, whole blob with real greetings: greetings saved too', async () => {
  const server = sectionServer();
  fresh(server.api);
  await fetchCompanyDefaults();
  await saveCompanyDefaults({ settings: { security: { mfa: true } }, greetings: { welcome: 'w' } });
  assert.deepEqual(server.saved.map((s) => s.section), ['security', 'greetings']);
  assert.equal(server.saved[1].version, 2);
});

test('the second save in the same tab carries the version the first one made', async () => {
  const server = sectionServer();
  fresh(server.api);
  await fetchCompanyDefaults();
  await saveCompanyDefaults({ settings: { security: { a: 1 } }, greetings: {}, only: ['security'] });
  await saveCompanyDefaults({ settings: { security: { a: 2 } }, greetings: {}, only: ['security'] });
  assert.deepEqual(server.saved.map((s) => s.version), [3, 4]);
});

test('a stale tab gets the plain-words message, not a silent overwrite', async () => {
  const server = sectionServer();
  fresh(server.api);
  await fetchCompanyDefaults(); /* this tab saw security v3 */
  server.versions.security = 4; /* somebody else saved */
  await assert.rejects(
    saveCompanyDefaults({ settings: { security: { mfa: false } }, greetings: {}, only: ['security'] }),
    (e) => {
      assert.equal(e.message, STALE_SAVE_MESSAGE);
      assert.equal(e.response.status, 409, 'looks like an http error to onError handlers');
      assert.equal(e.response.data.message, STALE_SAVE_MESSAGE);
      assert.equal(e.section, 'security');
      return true;
    },
  );
  assert.deepEqual(server.saved, [], 'CONTROL: nothing was written');
  assert.deepEqual(globalThis.__mcmToasts, [{ text: STALE_SAVE_MESSAGE, type: 'error' }]);
  assert.equal(server.versions.security, 4, 'the other tab\'s save stands');
});

test('a 409 does not quietly adopt the other tab\'s version: the next click is refused too', async () => {
  const server = sectionServer();
  fresh(server.api);
  await fetchCompanyDefaults();
  server.versions.security = 4;
  const attempt = () =>
    saveCompanyDefaults({ settings: { security: { mfa: false } }, greetings: {}, only: ['security'] });
  await assert.rejects(attempt());
  await assert.rejects(attempt(), (e) => e.message === STALE_SAVE_MESSAGE);
  assert.deepEqual(server.saved, []);
  /* ...until the screen reloads, as the message says. */
  await fetchCompanyDefaults();
  await attempt();
  assert.equal(server.saved.length, 1);
});

test('a 500 on save is thrown as-is and told in the interceptor\'s words', async () => {
  const server = sectionServer();
  server.api.saveCompanySettingsSection = async () => { throw httpError(503); };
  fresh(server.api);
  await fetchCompanyDefaults();
  await assert.rejects(
    saveCompanyDefaults({ settings: { security: {} }, greetings: {}, only: ['security'] }),
    (e) => e.response.status === 503,
  );
  assert.deepEqual(globalThis.__mcmToasts, [
    { text: 'This data is temporarily unavailable. Please retry in a moment.', type: 'error' },
  ]);
});

test('a save before any read still picks the store first', async () => {
  const server = sectionServer();
  fresh(server.api);
  await saveCompanyDefaults({ settings: { security: { a: 1 } }, greetings: {}, only: ['security'] });
  assert.equal(getCompanySettingsStore(), 'sections');
  assert.deepEqual(server.saved, [{ section: 'security', settings: { a: 1 }, version: 3 }]);

  fresh({
    listCompanySettings: async () => { throw httpError(404); },
    getTemplateList: async () => TEMPLATE_ROWS,
    upsertTemplate: async (body) => ({ data: { data: { message: 'Saved', result: body } } }),
  });
  await saveCompanyDefaults({ settings: { security: { a: 1 } }, greetings: {}, only: ['security'] });
  assert.equal(getCompanySettingsStore(), 'template');
  assert.equal(calls('upsertTemplate').length, 1);
});
