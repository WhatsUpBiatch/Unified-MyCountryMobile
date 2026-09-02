var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/call-number.ts
var call_number_exports = {};
__export(call_number_exports, {
  normalizeCallNumber: () => normalizeCallNumber,
  stripCarrierRoutingPrefix: () => stripCarrierRoutingPrefix
});
module.exports = __toCommonJS(call_number_exports);
var CARRIER_ROUTING_PREFIXES = ["77701", "6732"];
var MAX_E164_DIGITS = 15;
var MIN_KEPT_DIGITS = 8;
var stripCarrierRoutingPrefix = (value) => {
  const digits = String(value || "");
  if (!/^\d+$/.test(digits) || digits.length <= MAX_E164_DIGITS) return digits;
  for (const prefix of CARRIER_ROUTING_PREFIXES) {
    if (!digits.startsWith(prefix)) continue;
    const rest = digits.slice(prefix.length);
    if (rest.length >= MIN_KEPT_DIGITS && rest.length <= MAX_E164_DIGITS) return rest;
  }
  return digits;
};
var normalizeCallNumber = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const userPart = trimmed.replace(/^sip:/i, "").split("@")[0].replace(/\s+/g, "").replace(/_web$/i, "");
  const hasPlus = userPart.startsWith("+");
  const stripped = stripCarrierRoutingPrefix(hasPlus ? userPart.slice(1) : userPart);
  return hasPlus ? `+${stripped}` : stripped;
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  normalizeCallNumber,
  stripCarrierRoutingPrefix
});
