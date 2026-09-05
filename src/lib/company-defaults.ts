/* The company level of the settings cascade.
 *
 * A phone system needs three levels: what the whole company gets, what a named
 * preset gets, and what one person has. This platform shipped the bottom two —
 * `user_template` holds named presets, and each user carries their own settings —
 * but nothing held "the rule for everyone". Admin > Phone System > Preferences was
 * built for that job and, with nowhere to save to, was wired to the signed-in
 * admin's own record instead, which meant an admin setting a company rule was
 * quietly editing their own phone.
 *
 * Rather than add a table, the top level was first stored as a reserved user
 * template. That table already holds exactly the right shape — a settings JSON
 * and a greetings JSON, with the same `override` flags the cascade needs — and
 * the upsert/list endpoints already exist, so the company level worked against
 * the running backend with no migration and no deploy.
 *
 * The reserved name is how it is found. It is deliberately one that reads
 * correctly if it ever shows up in the ordinary template list, because it will.
 *
 * Two stores, one door
 * --------------------
 * A per-section store now exists on newer servers (see company-settings-api.ts):
 * each top-level key of the blob is its own row with a version, so two tabs can
 * no longer undo each other, and a stale save is refused rather than applied.
 * Not every server has it yet. So the first call of a session asks the new API;
 * if the server answers "no such endpoint" the old template row is used for the
 * rest of the session, and if it answers properly the section store is used.
 * Either way the fifteen screens and hooks that call `fetchCompanyDefaults` and
 * `saveCompanyDefaults` see the same shape and need not know which store spoke.
 *
 * A failure that is not "no such endpoint" — a 500, a timeout, a dropped
 * connection — is thrown, never papered over with the template row. That row
 * may be months stale on a server that has migrated away from it, and showing
 * it as current would be worse than showing an error.
 */

import { getTemplateList, upsertTemplate } from '@/services/api';
import { handleAlert } from '@/lib/utils';
import {
  AssembledCompanySettings,
  CompanySettingsListResult,
  GREETINGS_SECTION,
  assembleFromSections,
  describeRequestError,
  isEndpointAbsent,
  isListResult,
  isVersionConflict,
  listSections,
  parseMaybeJson,
  saveSection,
  splitIntoSections,
} from '@/lib/company-settings-api';

export const COMPANY_DEFAULT_TEMPLATE_NAME = 'Company Default';

export interface CompanyDefaultTemplate {
  uuid?: string;
  name: string;
  settings: any;
  greetings: any;
  updated_at?: string;
  /* Present only when the per-section store answered: the version of each
     section as last seen, keyed by section name (`greetings` included). */
  versions?: Record<string, number>;
}

export const STALE_SAVE_MESSAGE =
  'Someone else saved these settings a moment ago. Reload and try again.';

/* ---- Which store -------------------------------------------------------- */

export type CompanySettingsStore = 'unknown' | 'sections' | 'template';

let store: CompanySettingsStore = 'unknown';

/* Versions as last seen from the section store, so a save can say which
   version it is replacing even though no caller passes one. Updated on every
   list and every successful save; a save that comes back without a version
   forgets the entry rather than keep a number it knows is out of date. */
let knownVersions: Record<string, number> = {};

/* Many screens ask for the company row at the same moment on page load. The
   first `list` of the session is shared between them so the server is probed
   once, and every caller learns the same answer. */
let inflightList: Promise<ListOutcome> | null = null;

type ListOutcome = { kind: 'sections'; result: CompanySettingsListResult } | { kind: 'absent' };

export const getCompanySettingsStore = (): CompanySettingsStore => store;

/* For tests, and for any future "check again" affordance. */
export const resetCompanySettingsDetection = (): void => {
  store = 'unknown';
  knownVersions = {};
  inflightList = null;
};

const rememberVersions = (result: CompanySettingsListResult): void => {
  const next: Record<string, number> = {};
  for (const [section, row] of Object.entries(result.sections || {})) {
    if (typeof row?.version === 'number' && Number.isFinite(row.version)) {
      next[section] = row.version;
    }
  }
  knownVersions = next;
};

const listViaSections = async (): Promise<ListOutcome> => {
  let body: unknown;
  try {
    body = await listSections();
  } catch (error: any) {
    if (store === 'unknown' && isEndpointAbsent(error)) return { kind: 'absent' };
    /* The interceptor was told to stay quiet so the probe could fail silently;
       this is not the probe failing, it is the data failing, and the user is
       told in the interceptor's own words. A 401 is already handled there. */
    if (Number(error?.response?.status) !== 401) {
      handleAlert({ text: describeRequestError(error), type: 'error' });
    }
    throw error;
  }

  if (isListResult(body)) return { kind: 'sections', result: body };

  /* A 200 with a body that is not this API — a catch-all route, a proxy's
     index page — counts as absent, but only while the store is still being
     decided. Once the section store has answered properly, a wrong body is a
     fault, not a downgrade. */
  if (store === 'unknown') return { kind: 'absent' };
  throw new Error('Company settings came back in a shape this app does not understand.');
};

const listOnce = (): Promise<ListOutcome> => {
  if (!inflightList) {
    inflightList = listViaSections().finally(() => {
      inflightList = null;
    });
  }
  return inflightList;
};

/* ---- The template row (old store) --------------------------------------- */

const normalise = (row: any): CompanyDefaultTemplate => ({
  uuid: row?.uuid,
  name: row?.name,
  settings: parseMaybeJson(row?.settings),
  greetings: parseMaybeJson(row?.greetings),
  updated_at: row?.updated_at,
});

/* The list endpoint filters by name, but it matches loosely — a tenant with a
   template called "Company Default (old)" would come back too. The exact match
   is re-applied here so the wrong record can never be treated as the company
   rule and silently overwritten on save. */
const fetchFromTemplate = async (): Promise<CompanyDefaultTemplate | null> => {
  const response = await getTemplateList({
    page: 1,
    limit: 200,
    filters: [],
    search: COMPANY_DEFAULT_TEMPLATE_NAME,
  });

  const rows: any[] = response?.data?.data?.result?.rows || [];
  const exact = rows.find((row) => row?.name === COMPANY_DEFAULT_TEMPLATE_NAME);

  return exact ? normalise(exact) : null;
};

/* ---- Read --------------------------------------------------------------- */

export const fetchCompanyDefaults = async (): Promise<CompanyDefaultTemplate | null> => {
  if (store === 'template') return fetchFromTemplate();

  const outcome = await listOnce();
  if (outcome.kind === 'absent') {
    store = 'template';
    return fetchFromTemplate();
  }

  store = 'sections';
  rememberVersions(outcome.result);

  /* No sections at all is the new store's way of saying what "no row" said in
     the old one, and callers already know what to do with null. */
  if (!Object.keys(outcome.result.sections).length) return null;

  const assembled: AssembledCompanySettings = assembleFromSections(outcome.result.sections);
  return assembled;
};

/* ---- Write -------------------------------------------------------------- */

/* `only` names the top-level settings keys (and/or the word 'greetings') that
   the calling screen actually edits.

   Old store: when it is given, the row is re-read first and just those keys are
   replaced on the fresh copy. Without it, the whole blob the screen loaded —
   possibly minutes ago — is written back, and ten screens share this one row:
   an admin with Security open in one tab and Holidays in another would have
   each save silently undo the other. A key listed in `only` whose value is
   `undefined` is removed, which is how a screen clears its own section without
   touching anybody else's.

   New store: with `only`, just those sections are saved; without it, every
   top-level key present is saved as its own section. Each save carries the
   version of that section as last seen, so a tab holding an older copy is
   refused with a 409 rather than quietly overwriting somebody else's work.
   `versions` may be passed to override what this module last saw. */
export type CompanySectionKey = string;

export interface SaveCompanyDefaultsInput {
  uuid?: string;
  settings: any;
  greetings: any;
  only?: CompanySectionKey[];
  versions?: Record<string, number>;
}

/* What the section path resolves with. Screens read the message from either
   `response.data.message` or `response.data.data.message`, so both are set. */
export interface CompanySaveResponse {
  data: {
    message: string;
    data: {
      message: string;
      result: {
        saved: Array<{ section: string; version?: number; updated_at?: string }>;
        versions: Record<string, number>;
      };
    };
  };
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/* Which sections a save touches, in the order they are sent. */
const sectionsToSave = ({
  settings,
  greetings,
  only,
}: Pick<SaveCompanyDefaultsInput, 'settings' | 'greetings' | 'only'>): Array<{
  section: string;
  settings: any;
}> => {
  if (only?.length) {
    return only.map((key) =>
      key === GREETINGS_SECTION
        ? { section: GREETINGS_SECTION, settings: greetings || {} }
        : /* `undefined` meant "remove this key" on the old store; an empty
             section is the nearest the new one has. */
          { section: key, settings: settings?.[key] === undefined ? {} : settings[key] },
    );
  }

  /* The whole-blob case. Screens pass `greetings: loaded?.greetings || {}`
     here without ever editing greetings, so an empty object is taken as
     "nothing to say" rather than "wipe them" — a screen that means to clear
     greetings says so with only: ['greetings']. */
  const split = splitIntoSections(
    settings,
    isPlainObject(greetings) && Object.keys(greetings).length ? greetings : undefined,
  );
  return Object.entries(split).map(([section, row]) => ({ section, settings: row.settings }));
};

const saveViaSections = async (input: SaveCompanyDefaultsInput): Promise<CompanySaveResponse> => {
  const versions = { ...knownVersions, ...(input.versions || {}) };
  const saved: Array<{ section: string; version?: number; updated_at?: string }> = [];

  for (const { section, settings } of sectionsToSave(input)) {
    let result;
    try {
      result = await saveSection({ section, settings, version: versions[section] });
    } catch (error: any) {
      if (isVersionConflict(error)) {
        /* Told here as well as thrown, so a screen with no onError of its own
           still says it; a screen with one shows the same words again, and the
           toast helper replaces rather than stacks. */
        handleAlert({ text: STALE_SAVE_MESSAGE, type: 'error' });
        const conflict: any = new Error(STALE_SAVE_MESSAGE);
        conflict.name = 'CompanySettingsConflict';
        conflict.section = section;
        conflict.status = 409;
        conflict.current = error?.response?.data?.data?.result ?? error?.response?.data ?? null;
        conflict.response = { status: 409, data: { message: STALE_SAVE_MESSAGE } };
        throw conflict;
      }
      if (Number(error?.response?.status) !== 401) {
        handleAlert({ text: describeRequestError(error), type: 'error' });
      }
      throw error;
    }

    if (typeof result.version === 'number') knownVersions[section] = result.version;
    else delete knownVersions[section];
    saved.push({ section, version: result.version, updated_at: result.updated_at });
  }

  const message = 'Settings saved';
  return {
    data: {
      message,
      data: { message, result: { saved, versions: { ...knownVersions } } },
    },
  };
};

const saveViaTemplate = async ({ uuid, settings, greetings, only }: SaveCompanyDefaultsInput) => {
  if (!only?.length) {
    return upsertTemplate({
      ...(uuid ? { uuid, userID: uuid } : {}),
      name: COMPANY_DEFAULT_TEMPLATE_NAME,
      settings,
      greetings,
    });
  }

  const fresh = await fetchFromTemplate();
  const nextSettings: Record<string, any> = { ...(fresh?.settings || {}) };
  let nextGreetings: any = fresh?.greetings || {};
  for (const key of only) {
    if (key === GREETINGS_SECTION) {
      nextGreetings = greetings || {};
      continue;
    }
    if (settings?.[key] === undefined) delete nextSettings[key];
    else nextSettings[key] = settings[key];
  }
  const rowUuid = fresh?.uuid || uuid;

  return upsertTemplate({
    ...(rowUuid ? { uuid: rowUuid, userID: rowUuid } : {}),
    name: COMPANY_DEFAULT_TEMPLATE_NAME,
    settings: nextSettings,
    greetings: nextGreetings,
  });
};

/* Saving keeps the uuid when one exists so the same record is updated rather
   than a second "Company Default" being created alongside it — two records
   under the same reserved name would make which one is the rule a coin toss.
   (Old store only; the section store has no uuid to keep.) */
export const saveCompanyDefaults = async (input: SaveCompanyDefaultsInput): Promise<any> => {
  if (store === 'unknown') {
    /* A save before any read this session — decide the store the same way a
       read would, so a save never goes to the wrong one. */
    const outcome = await listOnce();
    if (outcome.kind === 'absent') store = 'template';
    else {
      store = 'sections';
      rememberVersions(outcome.result);
    }
  }
  return store === 'sections' ? saveViaSections(input) : saveViaTemplate(input);
};

export const COMPANY_DEFAULTS_QUERY_KEY = ['company-default-template'];
