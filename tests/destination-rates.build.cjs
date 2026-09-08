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

// src/lib/destination-rates.ts
var destination_rates_exports = {};
__export(destination_rates_exports, {
  buildDestinations: () => buildDestinations,
  lowestRate: () => lowestRate,
  markFailed: () => markFailed,
  markLoading: () => markLoading,
  matchesSearch: () => matchesSearch,
  nextToPrice: () => nextToPrice,
  priceProgress: () => priceProgress,
  readRateAnswer: () => readRateAnswer,
  toCsv: () => toCsv
});
module.exports = __toCommonJS(destination_rates_exports);
var cleanCode = (raw) => {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
};
var buildDestinations = (countries) => (countries ?? []).map((c) => ({
  iso: String(c?.isoCode ?? "").toUpperCase(),
  name: String(c?.name ?? "").trim(),
  flag: String(c?.flag ?? ""),
  dialCode: cleanCode(c?.phonecode),
  state: "unknown"
})).filter((d) => d.iso && d.name && d.dialCode).sort((a, b) => a.name.localeCompare(b.name));
var money = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : void 0;
};
var lowestRate = (rows) => {
  const values = (rows ?? []).map((r) => money(r?.rate)).filter((n) => n !== void 0);
  return values.length ? Math.min(...values) : void 0;
};
var readRateAnswer = (destination, answer) => {
  const result = answer?.data?.data?.result ?? answer?.result ?? answer;
  if (!result) {
    return { ...destination, state: "failed", note: "The price could not be loaded. Try again." };
  }
  const outbound = lowestRate(result?.outbound_call_rates);
  const inbound = lowestRate(result?.inbound_call_rates);
  const sms = lowestRate(result?.sms_rates);
  if (outbound === void 0 && inbound === void 0 && sms === void 0) {
    return {
      ...destination,
      state: "unpriced",
      note: "No price is published for this destination, so calls to it are not sold."
    };
  }
  return { ...destination, state: "priced", outbound, inbound, sms, note: void 0 };
};
var markLoading = (destination) => ({
  ...destination,
  state: "loading",
  note: void 0
});
var markFailed = (destination) => ({
  ...destination,
  state: "failed",
  note: "The price could not be loaded. Try again."
});
var matchesSearch = (destination, search) => {
  const term = String(search ?? "").trim().toLowerCase();
  if (!term) return true;
  if (destination.name.toLowerCase().includes(term)) return true;
  if (destination.iso.toLowerCase() === term) return true;
  const digits = term.replace(/[^\d]/g, "");
  if (!digits) return false;
  const code = destination.dialCode.slice(1);
  return code.startsWith(digits) || digits.startsWith(code);
};
var priceProgress = (destinations) => {
  const total = destinations.length;
  const priced = destinations.filter((d) => d.state === "priced").length;
  const unpriced = destinations.filter((d) => d.state === "unpriced").length;
  const known = priced + unpriced;
  return { total, known, priced, unpriced, missing: total - known, complete: total > 0 && known >= total };
};
var nextToPrice = (destinations, batch) => destinations.filter((d) => d.state === "unknown").slice(0, Math.max(0, batch));
var csvCell = (value) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};
var toCsv = (destinations) => {
  const header = [
    "Destination",
    "Country code",
    "Dialling code",
    "Outbound",
    "Inbound",
    "SMS",
    "Status"
  ];
  const rows = destinations.map(
    (d) => [
      csvCell(d.name),
      csvCell(d.iso),
      csvCell(d.dialCode),
      csvCell(d.outbound ?? ""),
      csvCell(d.inbound ?? ""),
      csvCell(d.sms ?? ""),
      csvCell(
        d.state === "priced" ? "Priced" : d.state === "unpriced" ? "Not sold" : d.state === "failed" ? "Could not load" : "Not loaded"
      )
    ].join(",")
  );
  return [header.map(csvCell).join(","), ...rows].join("\n");
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildDestinations,
  lowestRate,
  markFailed,
  markLoading,
  matchesSearch,
  nextToPrice,
  priceProgress,
  readRateAnswer,
  toCsv
});
