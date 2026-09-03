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
var queue_service_level_exports = {};
__export(queue_service_level_exports, {
  DEFAULT_SHORT_ABANDON_SECONDS: () => DEFAULT_SHORT_ABANDON_SECONDS,
  DEFAULT_TARGET_SECONDS: () => DEFAULT_TARGET_SECONDS,
  default: () => queue_service_level_default,
  isShortAbandon: () => isShortAbandon,
  serviceLevel: () => serviceLevel,
  talkSeconds: () => talkSeconds,
  waitSeconds: () => waitSeconds,
  wasAnswered: () => wasAnswered
});
module.exports = __toCommonJS(queue_service_level_exports);
const DEFAULT_TARGET_SECONDS = 20;
const DEFAULT_SHORT_ABANDON_SECONDS = 5;
const toSeconds = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (!trimmed.includes(":")) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
  }
  const parts = trimmed.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return Math.max(
    0,
    Math.floor(
      parts.reduceRight((total, part, i) => total + part * Math.pow(60, parts.length - 1 - i), 0)
    )
  );
};
const talkSeconds = (row) => toSeconds(row?.billsectotal) ?? toSeconds(row?.billsec) ?? 0;
const totalSeconds = (row) => toSeconds(row?.durationtotal) ?? toSeconds(row?.duration) ?? 0;
const waitSeconds = (row) => {
  const stored = toSeconds(row?.waitsec);
  if (stored !== null) return stored;
  return Math.max(0, totalSeconds(row) - talkSeconds(row));
};
const wasAnswered = (row) => talkSeconds(row) > 0;
const isShortAbandon = (row, shortAbandonSeconds = DEFAULT_SHORT_ABANDON_SECONDS) => {
  if (wasAnswered(row)) return false;
  return Math.max(waitSeconds(row), totalSeconds(row)) < Math.max(0, shortAbandonSeconds);
};
const serviceLevel = ({
  rows,
  targetSeconds = DEFAULT_TARGET_SECONDS,
  shortAbandonSeconds = DEFAULT_SHORT_ABANDON_SECONDS
}) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const target = Math.max(0, targetSeconds);
  let shortAbandons = 0;
  let answered = 0;
  let answeredWithinTarget = 0;
  let abandoned = 0;
  let answeredWaitTotal = 0;
  let longestWait = null;
  safeRows.forEach((row) => {
    if (isShortAbandon(row, shortAbandonSeconds)) {
      shortAbandons += 1;
      return;
    }
    const wait = waitSeconds(row);
    if (longestWait === null || wait > longestWait) longestWait = wait;
    if (wasAnswered(row)) {
      answered += 1;
      answeredWaitTotal += wait;
      if (wait <= target) answeredWithinTarget += 1;
    } else {
      abandoned += 1;
    }
  });
  const counted = answered + abandoned;
  return {
    offered: safeRows.length,
    shortAbandons,
    counted,
    answered,
    answeredWithinTarget,
    abandoned,
    serviceLevelPercent: counted ? answeredWithinTarget / counted * 100 : null,
    abandonRatePercent: counted ? abandoned / counted * 100 : null,
    averageAnswerSeconds: answered ? answeredWaitTotal / answered : null,
    longestWaitSeconds: counted ? longestWait : null
  };
};
var queue_service_level_default = serviceLevel;
