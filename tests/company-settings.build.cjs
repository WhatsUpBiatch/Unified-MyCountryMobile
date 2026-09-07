var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// tests/company-settings-stubs/api.cjs
var require_api = __commonJS({
  "tests/company-settings-stubs/api.cjs"(exports2, module2) {
    var call = (name, ...args) => {
      const api = globalThis.__mcmApi || {};
      (globalThis.__mcmCalls = globalThis.__mcmCalls || []).push({ name, args });
      const handler = api[name];
      if (typeof handler !== "function") {
        return Promise.reject(new Error(`no stub for ${name}`));
      }
      return Promise.resolve().then(() => handler(...args));
    };
    module2.exports = {
      getTemplateList: (...args) => call("getTemplateList", ...args),
      upsertTemplate: (...args) => call("upsertTemplate", ...args),
      listCompanySettings: (...args) => call("listCompanySettings", ...args),
      getCompanySettingsSection: (...args) => call("getCompanySettingsSection", ...args),
      saveCompanySettingsSection: (...args) => call("saveCompanySettingsSection", ...args),
      getCompanySettingsHistory: (...args) => call("getCompanySettingsHistory", ...args)
    };
  }
});

// src/lib/company-settings-api.ts
var company_settings_api_exports = {};
__export(company_settings_api_exports, {
  COMPANY_SETTINGS_NAME: () => COMPANY_SETTINGS_NAME,
  COMPANY_SETTINGS_UUID: () => COMPANY_SETTINGS_UUID,
  GREETINGS_SECTION: () => GREETINGS_SECTION,
  assembleFromSections: () => assembleFromSections,
  describeRequestError: () => describeRequestError,
  getSection: () => getSection,
  isEndpointAbsent: () => isEndpointAbsent,
  isListResult: () => isListResult,
  isVersionConflict: () => isVersionConflict,
  listSections: () => listSections,
  parseMaybeJson: () => parseMaybeJson,
  saveSection: () => saveSection,
  sectionHistory: () => sectionHistory,
  splitIntoSections: () => splitIntoSections,
  unwrapResult: () => unwrapResult
});
var import_api, COMPANY_SETTINGS_UUID, COMPANY_SETTINGS_NAME, GREETINGS_SECTION, parseMaybeJson, isPlainObject, unwrapResult, isListResult, isEndpointAbsent, isVersionConflict, laterOf, assembleFromSections, splitIntoSections, describeRequestError, listSections, getSection, saveSection, sectionHistory;
var init_company_settings_api = __esm({
  "src/lib/company-settings-api.ts"() {
    import_api = __toESM(require_api(), 1);
    COMPANY_SETTINGS_UUID = "company-settings";
    COMPANY_SETTINGS_NAME = "Company Default";
    GREETINGS_SECTION = "greetings";
    parseMaybeJson = (value) => {
      if (!value) return {};
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    };
    isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
    unwrapResult = (response) => {
      if (response === null || response === void 0) return null;
      if (response?.data?.data?.result !== void 0) return response.data.data.result;
      if (response?.data?.result !== void 0) return response.data.result;
      if (response?.result !== void 0) return response.result;
      return null;
    };
    isListResult = (value) => isPlainObject(value) && isPlainObject(value.sections);
    isEndpointAbsent = (error) => {
      const status = Number(error?.response?.status ?? error?.status);
      return status === 404 || status === 501;
    };
    isVersionConflict = (error) => Number(error?.response?.status ?? error?.status) === 409;
    laterOf = (a, b) => {
      if (!a) return b;
      if (!b) return a;
      const ta = Date.parse(a);
      const tb = Date.parse(b);
      if (Number.isFinite(ta) && Number.isFinite(tb)) return tb > ta ? b : a;
      return b > a ? b : a;
    };
    assembleFromSections = (sections) => {
      const settings = {};
      const versions = {};
      let greetings = {};
      let updatedAt;
      for (const [section, row] of Object.entries(sections || {})) {
        if (!isPlainObject(row)) continue;
        const value = parseMaybeJson(row.settings);
        if (section === GREETINGS_SECTION) greetings = value;
        else settings[section] = value;
        if (typeof row.version === "number" && Number.isFinite(row.version)) {
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
        versions
      };
    };
    splitIntoSections = (settings, greetings) => {
      const sections = {};
      for (const [key, value] of Object.entries(settings || {})) {
        if (value === void 0) continue;
        if (key === GREETINGS_SECTION) continue;
        sections[key] = { settings: value };
      }
      if (isPlainObject(greetings)) sections[GREETINGS_SECTION] = { settings: greetings };
      return sections;
    };
    describeRequestError = (error) => {
      const status = Number(error?.response?.status ?? error?.status);
      const body = error?.response?.data;
      if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) {
        return "Network unavailable. Please check your internet connection.";
      }
      if (status === 502) return "System update ongoing. Please retry in a bit.";
      if (typeof body?.message === "string" && body.message) return body.message;
      if (typeof body?.error?.message === "string" && body.error.message) return body.error.message;
      if (status === 504) return "This is taking longer than expected. Try a narrower date range.";
      if (status === 503) return "This data is temporarily unavailable. Please retry in a moment.";
      if (Number.isFinite(status) && status > 0) {
        return `Something went wrong (${status}). Please retry in a moment.`;
      }
      return "Something went wrong. Please retry in a moment.";
    };
    listSections = async () => {
      const response = await (0, import_api.listCompanySettings)();
      return unwrapResult(response);
    };
    getSection = async (section) => {
      const response = await (0, import_api.getCompanySettingsSection)({ section });
      const result = unwrapResult(response);
      if (!isPlainObject(result)) return null;
      return { ...result, settings: parseMaybeJson(result.settings) };
    };
    saveSection = async ({
      section,
      settings,
      version
    }) => {
      const response = await (0, import_api.saveCompanySettingsSection)({
        section,
        settings,
        ...typeof version === "number" ? { version } : {}
      });
      const result = unwrapResult(response);
      const row = isPlainObject(result) ? result : {};
      const nextVersion = typeof row.version === "number" ? row.version : void 0;
      const message = response?.data?.data?.message ?? response?.data?.message ?? void 0;
      return {
        section,
        version: nextVersion,
        updated_at: row.updated_at,
        message: typeof message === "string" ? message : void 0,
        raw: response
      };
    };
    sectionHistory = async (section, limit) => {
      const response = await (0, import_api.getCompanySettingsHistory)({
        section,
        ...typeof limit === "number" ? { limit } : {}
      });
      const result = unwrapResult(response);
      const rows = Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : Array.isArray(result?.history) ? result.history : [];
      return rows.map((row) => ({ ...row, settings: parseMaybeJson(row?.settings) }));
    };
  }
});

// tests/company-settings-stubs/utils.cjs
var require_utils = __commonJS({
  "tests/company-settings-stubs/utils.cjs"(exports2, module2) {
    module2.exports = {
      handleAlert: ({ text, type }) => {
        (globalThis.__mcmToasts = globalThis.__mcmToasts || []).push({ text, type });
        return null;
      }
    };
  }
});

// src/lib/company-defaults.ts
var company_defaults_exports = {};
__export(company_defaults_exports, {
  COMPANY_DEFAULTS_QUERY_KEY: () => COMPANY_DEFAULTS_QUERY_KEY,
  COMPANY_DEFAULT_TEMPLATE_NAME: () => COMPANY_DEFAULT_TEMPLATE_NAME,
  STALE_SAVE_MESSAGE: () => STALE_SAVE_MESSAGE,
  fetchCompanyDefaults: () => fetchCompanyDefaults,
  getCompanySettingsStore: () => getCompanySettingsStore,
  resetCompanySettingsDetection: () => resetCompanySettingsDetection,
  saveCompanyDefaults: () => saveCompanyDefaults
});
var import_api2, import_utils, COMPANY_DEFAULT_TEMPLATE_NAME, STALE_SAVE_MESSAGE, store, knownVersions, inflightList, getCompanySettingsStore, resetCompanySettingsDetection, rememberVersions, listViaSections, listOnce, normalise, fetchFromTemplate, fetchCompanyDefaults, isPlainObject2, sectionsToSave, saveViaSections, saveViaTemplate, saveCompanyDefaults, COMPANY_DEFAULTS_QUERY_KEY;
var init_company_defaults = __esm({
  "src/lib/company-defaults.ts"() {
    import_api2 = __toESM(require_api(), 1);
    import_utils = __toESM(require_utils(), 1);
    init_company_settings_api();
    COMPANY_DEFAULT_TEMPLATE_NAME = "Company Default";
    STALE_SAVE_MESSAGE = "Someone else saved these settings a moment ago. Reload and try again.";
    store = "unknown";
    knownVersions = {};
    inflightList = null;
    getCompanySettingsStore = () => store;
    resetCompanySettingsDetection = () => {
      store = "unknown";
      knownVersions = {};
      inflightList = null;
    };
    rememberVersions = (result) => {
      const next = {};
      for (const [section, row] of Object.entries(result.sections || {})) {
        if (typeof row?.version === "number" && Number.isFinite(row.version)) {
          next[section] = row.version;
        }
      }
      knownVersions = next;
    };
    listViaSections = async () => {
      let body;
      try {
        body = await listSections();
      } catch (error) {
        if (store === "unknown" && isEndpointAbsent(error)) return { kind: "absent" };
        if (Number(error?.response?.status) !== 401) {
          (0, import_utils.handleAlert)({ text: describeRequestError(error), type: "error" });
        }
        throw error;
      }
      if (isListResult(body)) return { kind: "sections", result: body };
      if (store === "unknown") return { kind: "absent" };
      throw new Error("Company settings came back in a shape this app does not understand.");
    };
    listOnce = () => {
      if (!inflightList) {
        inflightList = listViaSections().finally(() => {
          inflightList = null;
        });
      }
      return inflightList;
    };
    normalise = (row) => ({
      uuid: row?.uuid,
      name: row?.name,
      settings: parseMaybeJson(row?.settings),
      greetings: parseMaybeJson(row?.greetings),
      updated_at: row?.updated_at
    });
    fetchFromTemplate = async () => {
      const response = await (0, import_api2.getTemplateList)({
        page: 1,
        limit: 200,
        filters: [],
        search: COMPANY_DEFAULT_TEMPLATE_NAME
      });
      const rows = response?.data?.data?.result?.rows || [];
      const exact = rows.find((row) => row?.name === COMPANY_DEFAULT_TEMPLATE_NAME);
      return exact ? normalise(exact) : null;
    };
    fetchCompanyDefaults = async () => {
      if (store === "template") return fetchFromTemplate();
      const outcome = await listOnce();
      if (outcome.kind === "absent") {
        store = "template";
        return fetchFromTemplate();
      }
      store = "sections";
      rememberVersions(outcome.result);
      if (!Object.keys(outcome.result.sections).length) return null;
      const assembled = assembleFromSections(outcome.result.sections);
      return assembled;
    };
    isPlainObject2 = (value) => !!value && typeof value === "object" && !Array.isArray(value);
    sectionsToSave = ({
      settings,
      greetings,
      only
    }) => {
      if (only?.length) {
        return only.map(
          (key) => key === GREETINGS_SECTION ? { section: GREETINGS_SECTION, settings: greetings || {} } : (
            /* `undefined` meant "remove this key" on the old store; an empty
               section is the nearest the new one has. */
            { section: key, settings: settings?.[key] === void 0 ? {} : settings[key] }
          )
        );
      }
      const split = splitIntoSections(
        settings,
        isPlainObject2(greetings) && Object.keys(greetings).length ? greetings : void 0
      );
      return Object.entries(split).map(([section, row]) => ({ section, settings: row.settings }));
    };
    saveViaSections = async (input) => {
      const versions = { ...knownVersions, ...input.versions || {} };
      const saved = [];
      for (const { section, settings } of sectionsToSave(input)) {
        let result;
        try {
          result = await saveSection({ section, settings, version: versions[section] });
        } catch (error) {
          if (isVersionConflict(error)) {
            (0, import_utils.handleAlert)({ text: STALE_SAVE_MESSAGE, type: "error" });
            const conflict = new Error(STALE_SAVE_MESSAGE);
            conflict.name = "CompanySettingsConflict";
            conflict.section = section;
            conflict.status = 409;
            conflict.current = error?.response?.data?.data?.result ?? error?.response?.data ?? null;
            conflict.response = { status: 409, data: { message: STALE_SAVE_MESSAGE } };
            throw conflict;
          }
          if (Number(error?.response?.status) !== 401) {
            (0, import_utils.handleAlert)({ text: describeRequestError(error), type: "error" });
          }
          throw error;
        }
        if (typeof result.version === "number") knownVersions[section] = result.version;
        else delete knownVersions[section];
        saved.push({ section, version: result.version, updated_at: result.updated_at });
      }
      const message = "Settings saved";
      return {
        data: {
          message,
          data: { message, result: { saved, versions: { ...knownVersions } } }
        }
      };
    };
    saveViaTemplate = async ({ uuid, settings, greetings, only }) => {
      if (!only?.length) {
        return (0, import_api2.upsertTemplate)({
          ...uuid ? { uuid, userID: uuid } : {},
          name: COMPANY_DEFAULT_TEMPLATE_NAME,
          settings,
          greetings
        });
      }
      const fresh = await fetchFromTemplate();
      const nextSettings = { ...fresh?.settings || {} };
      let nextGreetings = fresh?.greetings || {};
      for (const key of only) {
        if (key === GREETINGS_SECTION) {
          nextGreetings = greetings || {};
          continue;
        }
        if (settings?.[key] === void 0) delete nextSettings[key];
        else nextSettings[key] = settings[key];
      }
      const rowUuid = fresh?.uuid || uuid;
      return (0, import_api2.upsertTemplate)({
        ...rowUuid ? { uuid: rowUuid, userID: rowUuid } : {},
        name: COMPANY_DEFAULT_TEMPLATE_NAME,
        settings: nextSettings,
        greetings: nextGreetings
      });
    };
    saveCompanyDefaults = async (input) => {
      if (store === "unknown") {
        const outcome = await listOnce();
        if (outcome.kind === "absent") store = "template";
        else {
          store = "sections";
          rememberVersions(outcome.result);
        }
      }
      return store === "sections" ? saveViaSections(input) : saveViaTemplate(input);
    };
    COMPANY_DEFAULTS_QUERY_KEY = ["company-default-template"];
  }
});

// tests/company-settings.entry.cjs
module.exports = {
  ...(init_company_settings_api(), __toCommonJS(company_settings_api_exports)),
  ...(init_company_defaults(), __toCommonJS(company_defaults_exports))
};
