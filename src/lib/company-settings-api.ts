/* The per-section company settings store — the typed client and the two pure
 * shape conversions that let it stand in for the old "Company Default" row.
 *
 * The old store was one user_template row holding one settings blob. The new
 * server keeps each top-level key of that blob as its own section, each with a
 * version, and `greetings` is a section too. Screens still speak the old shape
 * (`{settings, greetings}`), so `assembleFromSections` builds that shape from a
 * list response and `splitIntoSections` takes it apart again for saving. They
 * are each other's inverse and are proven so in tests/company-settings-test.cjs.
 *
 * The four endpoint calls pass `hideToastOnError` because company-defaults.ts
 * decides what the user is told: a 404 from `list` means the server has not
 * got this API yet and must be silent, while a real failure must say so.
 */

import {
  getCompanySettingsHistory,
  getCompanySettingsSection,
  listCompanySettings,
  saveCompanySettingsSection,
} from '@/services/api';

export const COMPANY_SETTINGS_UUID = 'company-settings';
export const COMPANY_SETTINGS_NAME = 'Company Default';
export const GREETINGS_SECTION = 'greetings';

export interface CompanySettingsSection {
  settings: any;
  version?: number;
  updated_at?: string;
  updated_by?: string;
  updated_by_name?: string;
}

export type CompanySettingsSections = Record<string, CompanySettingsSection>;

export interface CompanySettingsListResult {
  sections: CompanySettingsSections;
  migrated_from_template?: boolean;
}

export interface CompanySettingsHistoryEntry {
  section?: string;
  settings?: any;
  version?: number;
  updated_at?: string;
  updated_by?: string;
  updated_by_name?: string;
}

/* What `fetchCompanyDefaults` hands back when the section store is in use.
   The first five fields are the old template shape, so every existing screen
   reads it unchanged; `versions` is new and is what makes a stale save a 409
   rather than an overwrite. */
export interface AssembledCompanySettings {
  uuid: typeof COMPANY_SETTINGS_UUID;
  name: typeof COMPANY_SETTINGS_NAME;
  settings: Record<string, any>;
  greetings: any;
  updated_at?: string;
  versions: Record<string, number>;
}

/* Settings arrive as either parsed objects or JSON strings depending on the
   endpoint, so both are handled at the boundary and everything downstream can
   assume an object. */
export const parseMaybeJson = (value: any): any => {
  if (!value) return {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const isPlainObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/* The list endpoints wrap their payload as `data.data.result`; the unwrapping
   is tolerant so a server that drops one layer of envelope still reads. */
export const unwrapResult = (response: any): any => {
  if (response === null || response === undefined) return null;
  if (response?.data?.data?.result !== undefined) return response.data.data.result;
  if (response?.data?.result !== undefined) return response.data.result;
  if (response?.result !== undefined) return response.result;
  return null;
};

/* The shape check the feature detection relies on: a body without a `sections`
   object is not this API, whatever status it came with. */
export const isListResult = (value: unknown): value is CompanySettingsListResult =>
  isPlainObject(value) && isPlainObject((value as any).sections);

/* "This server does not have the endpoint": a 404, or a 501 from a server that
   knows the route but has not implemented it. Anything else — a 500, a timeout,
   a dropped connection — is a failure of a server that may well have the data,
   and must never be read as "use the old store". */
export const isEndpointAbsent = (error: any): boolean => {
  const status = Number(error?.response?.status ?? error?.status);
  return status === 404 || status === 501;
};

export const isVersionConflict = (error: any): boolean =>
  Number(error?.response?.status ?? error?.status) === 409;

const laterOf = (a?: string, b?: string): string | undefined => {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return tb > ta ? b : a;
  return b > a ? b : a;
};

/* Sections in, the old template shape out. Every section except greetings
   becomes a top-level settings key; greetings becomes the greetings blob;
   `updated_at` is the newest of any section's; `versions` keeps each section's
   version, greetings included, keyed by section name. */
export const assembleFromSections = (
  sections: CompanySettingsSections | null | undefined,
): AssembledCompanySettings => {
  const settings: Record<string, any> = {};
  const versions: Record<string, number> = {};
  let greetings: any = {};
  let updatedAt: string | undefined;

  for (const [section, row] of Object.entries(sections || {})) {
    if (!isPlainObject(row)) continue;
    const value = parseMaybeJson(row.settings);
    if (section === GREETINGS_SECTION) greetings = value;
    else settings[section] = value;
    if (typeof row.version === 'number' && Number.isFinite(row.version)) {
      versions[section] = row.version;
    }
    updatedAt = laterOf(updatedAt, row.updated_at);
  }

  return {
    uuid: COMPANY_SETTINGS_UUID,
    name: COMPANY_SETTINGS_NAME,
    settings,
    greetings,
    updated_at: updatedAt,
    versions,
  };
};

/* The inverse: the old template shape in, one section per top-level settings
   key out, plus a greetings section when greetings is an object. A settings
   key whose value is `undefined` produces no section — that is the old way of
   saying "this section is gone", and the caller decides what that means. */
export const splitIntoSections = (
  settings: Record<string, any> | null | undefined,
  greetings?: any,
): CompanySettingsSections => {
  const sections: CompanySettingsSections = {};
  for (const [key, value] of Object.entries(settings || {})) {
    if (value === undefined) continue;
    if (key === GREETINGS_SECTION) continue;
    sections[key] = { settings: value };
  }
  if (isPlainObject(greetings)) sections[GREETINGS_SECTION] = { settings: greetings };
  return sections;
};

/* The wording the axios interceptor would have used, reproduced here because
   these calls silence it and company-defaults.ts speaks instead. */
export const describeRequestError = (error: any): string => {
  const status = Number(error?.response?.status ?? error?.status);
  const body = error?.response?.data;
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    return 'Network unavailable. Please check your internet connection.';
  }
  if (status === 502) return 'System update ongoing. Please retry in a bit.';
  if (typeof body?.message === 'string' && body.message) return body.message;
  if (typeof body?.error?.message === 'string' && body.error.message) return body.error.message;
  if (status === 504) return 'This is taking longer than expected. Try a narrower date range.';
  if (status === 503) return 'This data is temporarily unavailable. Please retry in a moment.';
  if (Number.isFinite(status) && status > 0) {
    return `Something went wrong (${status}). Please retry in a moment.`;
  }
  return 'Something went wrong. Please retry in a moment.';
};

/* ---- The typed client ---------------------------------------------------- */

/* Returns the raw unwrapped result, which may not be the expected shape — the
   caller checks with `isListResult`, because a wrong shape is one of the ways
   the feature detection learns the endpoint is not there. */
export const listSections = async (): Promise<unknown> => {
  const response = await listCompanySettings();
  return unwrapResult(response);
};

export const getSection = async (section: string): Promise<CompanySettingsSection | null> => {
  const response = await getCompanySettingsSection({ section });
  const result = unwrapResult(response);
  if (!isPlainObject(result)) return null;
  return { ...result, settings: parseMaybeJson(result.settings) };
};

export interface SaveSectionInput {
  section: string;
  settings: any;
  version?: number;
}

export interface SaveSectionResult {
  section: string;
  version?: number;
  updated_at?: string;
  message?: string;
  raw: any;
}

export const saveSection = async ({
  section,
  settings,
  version,
}: SaveSectionInput): Promise<SaveSectionResult> => {
  const response = await saveCompanySettingsSection({
    section,
    settings,
    ...(typeof version === 'number' ? { version } : {}),
  });
  const result = unwrapResult(response);
  const row = isPlainObject(result) ? result : {};
  const nextVersion = typeof row.version === 'number' ? row.version : undefined;
  const message =
    response?.data?.data?.message ?? response?.data?.message ?? undefined;
  return {
    section,
    version: nextVersion,
    updated_at: row.updated_at,
    message: typeof message === 'string' ? message : undefined,
    raw: response,
  };
};

export const sectionHistory = async (
  section: string,
  limit?: number,
): Promise<CompanySettingsHistoryEntry[]> => {
  const response = await getCompanySettingsHistory({
    section,
    ...(typeof limit === 'number' ? { limit } : {}),
  });
  const result = unwrapResult(response);
  const rows: any[] = Array.isArray(result)
    ? result
    : Array.isArray(result?.rows)
      ? result.rows
      : Array.isArray(result?.history)
        ? result.history
        : [];
  return rows.map((row) => ({ ...row, settings: parseMaybeJson(row?.settings) }));
};
