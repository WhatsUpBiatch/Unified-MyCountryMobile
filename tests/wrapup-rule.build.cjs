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
var wrapup_rule_exports = {};
__export(wrapup_rule_exports, {
  WRAPUP_DEFAULT_MODE: () => WRAPUP_DEFAULT_MODE,
  WRAPUP_MODES: () => WRAPUP_MODES,
  readWrapupMode: () => readWrapupMode,
  wrapupVerdict: () => wrapupVerdict
});
module.exports = __toCommonJS(wrapup_rule_exports);
const WRAPUP_MODES = {
  /** The agent may leave whenever they like. */
  OPTIONAL: "OPTIONAL",
  /** They must label the call, and nothing hurries them. */
  MANDATORY: "MANDATORY",
  /** They must label it, but the timer eventually moves them on. */
  MANDATORY_TIMEOUT: "MANDATORY_TIMEOUT",
  /** As above, and the wrap-up is closed for them when time runs out. */
  MANDATORY_FORCED_TIMEOUT: "MANDATORY_FORCED_TIMEOUT",
  /** No wrap-up at all unless the agent asks for one. */
  AGENT_REQUESTED: "AGENT_REQUESTED"
};
const WRAPUP_DEFAULT_MODE = WRAPUP_MODES.MANDATORY_TIMEOUT;
const KNOWN = new Set(Object.values(WRAPUP_MODES));
const readWrapupMode = (raw) => {
  const text = String(raw ?? "").trim().toUpperCase();
  return KNOWN.has(text) ? text : WRAPUP_DEFAULT_MODE;
};
const outOfTime = (state) => state.totalSeconds > 0 && state.elapsedSeconds >= state.totalSeconds;
const wrapupVerdict = (state) => {
  const mode = readWrapupMode(state.mode);
  const needsLabel = "Choose how the call went before you finish.";
  if (mode === WRAPUP_MODES.AGENT_REQUESTED && !state.requested) {
    return {
      active: false,
      mayLeave: true,
      showCountdown: false,
      autoClose: false,
      blockedReason: ""
    };
  }
  if (mode === WRAPUP_MODES.OPTIONAL) {
    return {
      active: true,
      mayLeave: true,
      showCountdown: state.totalSeconds > 0,
      autoClose: outOfTime(state),
      blockedReason: ""
    };
  }
  const labelled = Boolean(state.hasDisposition);
  if (mode === WRAPUP_MODES.MANDATORY) {
    return {
      active: true,
      mayLeave: labelled,
      /* No countdown: this mode exists precisely so nobody is hurried, and a
         ticking clock says the opposite of what the supervisor chose. */
      showCountdown: false,
      autoClose: false,
      blockedReason: labelled ? "" : needsLabel
    };
  }
  const expired = outOfTime(state);
  if (mode === WRAPUP_MODES.MANDATORY_FORCED_TIMEOUT) {
    return {
      active: true,
      mayLeave: labelled,
      showCountdown: true,
      /* Closed for them whether or not they labelled it. "Forced" is the
         difference between this and the mode above. */
      autoClose: expired,
      blockedReason: labelled ? "" : needsLabel
    };
  }
  return {
    active: true,
    mayLeave: labelled || expired,
    showCountdown: true,
    autoClose: expired,
    blockedReason: labelled || expired ? "" : needsLabel
  };
};
