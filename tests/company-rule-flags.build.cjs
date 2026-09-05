var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/lib/company-rule-flags.ts
var company_rule_flags_exports = {};
__export(company_rule_flags_exports, {
  POLICY_FIELDS: () => POLICY_FIELDS,
  RULE_FIELDS: () => RULE_FIELDS,
  RULE_NODE_PATHS: () => RULE_NODE_PATHS,
  describeRuleFlags: () => describeRuleFlags,
  legacyOverrideFor: () => legacyOverrideFor,
  readPath: () => readPath,
  readRuleFlags: () => readRuleFlags,
  ruleNodePath: () => ruleNodePath,
  writeRuleFlags: () => writeRuleFlags
});
module.exports = __toCommonJS(company_rule_flags_exports);

// src/lib/company-policy.ts
var import_react_query = require("@tanstack/react-query");

// src/lib/company-defaults.ts
var import_api2 = __toESM(require_api(), 1);
var import_utils = __toESM(require_utils(), 1);

// src/lib/company-settings-api.ts
var import_api = __toESM(require_api(), 1);

// src/lib/company-policy.ts
var POLICY_FIELDS = {
  voicemail: "voicemail_pin.override",
  recording: "recording.override",
  transcription: "transcription.override",
  ai_call_monitoring: "ai_call_monitoring.override",
  display_number: "display_number.override",
  business_hours: "operational_hours.override",
  regional: "operational_hours.regional.override",
  role: "role.override"
};

// src/lib/company-rule-flags.ts
var LEGACY_FLAG_KEY = "override";
var APPLY_KEY = "apply";
var LOCKED_KEY = "locked";
var readPath = (source, path) => path.split(".").reduce((value, key) => value == null ? value : value[key], source);
var setPath = (source, path, value) => {
  const [head, ...rest] = path.split(".");
  const base = Array.isArray(source) ? [...source] : source && typeof source === "object" ? { ...source } : {};
  base[head] = rest.length ? setPath(source?.[head], rest.join("."), value) : value;
  return base;
};
var stripLegacyFlag = (path) => path.endsWith(`.${LEGACY_FLAG_KEY}`) ? path.slice(0, -(LEGACY_FLAG_KEY.length + 1)) : path;
var RULE_NODE_PATHS = Object.fromEntries(
  Object.entries(POLICY_FIELDS).map(([field, path]) => [field, stripLegacyFlag(path)])
);
var RULE_FIELDS = Object.keys(POLICY_FIELDS);
var ruleNodePath = (field) => Object.prototype.hasOwnProperty.call(RULE_NODE_PATHS, field) ? RULE_NODE_PATHS[field] : stripLegacyFlag(field);
var legacyFlags = (override) => {
  if (override === true) return { apply: true, locked: false };
  if (override === false) return { apply: false, locked: true };
  return { apply: false, locked: false };
};
var legacyOverrideFor = ({ apply }) => apply;
var readRuleFlags = (settings, field) => {
  if (settings == null) return { apply: false, locked: false, isLegacy: false };
  const nodePath = ruleNodePath(field);
  const node = readPath(settings, nodePath);
  const apply = node?.[APPLY_KEY];
  const locked = node?.[LOCKED_KEY];
  const explicitApply = typeof apply === "boolean" ? apply : null;
  const explicitLocked = typeof locked === "boolean" ? locked : null;
  const fallback = legacyFlags(node?.[LEGACY_FLAG_KEY]);
  return {
    apply: explicitApply ?? fallback.apply,
    locked: explicitLocked ?? fallback.locked,
    /* Only when neither new flag is there — including a node with no flags at all,
       which has never been looked at since the split either. A half-written node —
       one flag present, from an interrupted save or a hand edit — is not legacy; the
       flag that is there is honoured and the missing one comes from `override`. */
    isLegacy: explicitApply === null && explicitLocked === null
  };
};
var writeRuleFlags = (settings, field, { apply, locked }) => {
  const nodePath = ruleNodePath(field);
  const current = readPath(settings, nodePath);
  const node = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : current == null ? {} : { enabled: current };
  node[APPLY_KEY] = apply;
  node[LOCKED_KEY] = locked;
  node[LEGACY_FLAG_KEY] = legacyOverrideFor({ apply, locked });
  return setPath(settings, nodePath, node);
};
var describeRuleFlags = ({ apply, locked }) => {
  if (apply && locked) return "Everyone gets the company setting and cannot change it.";
  if (apply) return "Everyone starts with the company setting and may change it.";
  if (locked) return "The company setting is not applied, and people cannot change theirs.";
  return "The company has no rule here. People keep and may change their own setting.";
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  POLICY_FIELDS,
  RULE_FIELDS,
  RULE_NODE_PATHS,
  describeRuleFlags,
  legacyOverrideFor,
  readPath,
  readRuleFlags,
  ruleNodePath,
  writeRuleFlags
});
