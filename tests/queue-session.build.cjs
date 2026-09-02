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
var queue_session_exports = {};
__export(queue_session_exports, {
  QUEUE_FORWARD_TYPE: () => QUEUE_FORWARD_TYPE,
  queueIdFromHeaderMap: () => queueIdFromHeaderMap,
  queueIdFromHeaders: () => queueIdFromHeaders
});
module.exports = __toCommonJS(queue_session_exports);
const QUEUE_FORWARD_TYPE = "QUEUE";
const queueIdFromHeaders = (read) => {
  const direct = String(read("x-queue") || "").trim();
  if (direct) return direct;
  const forwardType = String(read("x-forwardtype") || "").trim().toUpperCase();
  if (forwardType !== QUEUE_FORWARD_TYPE) return "";
  return String(read("x-forwardvalue") || "").trim();
};
const queueIdFromHeaderMap = (headers) => queueIdFromHeaders((name) => String(headers?.[name] ?? ""));
