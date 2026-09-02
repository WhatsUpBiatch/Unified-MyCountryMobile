/**
 * What an agent may do in the seconds after a call ends.
 *
 * A queue can ask for wrap-up five different ways, and until now all five
 * behaved identically: a countdown ran and the agent went back on duty whatever
 * they had or had not written. "Optional" and "cannot be skipped" are different
 * products to a supervisor, and a timer alone cannot tell them apart.
 *
 * The rules are here rather than in the call screen because the screen is on an
 * agent's live call path and shared with outbound campaigns. A mistake there
 * traps somebody in a wrap-up they cannot leave, or lets a queue that demands a
 * disposition go unanswered - both worth proving before they ship.
 *
 * The safe direction is always *towards letting the agent go*. A queue whose
 * rule cannot be read behaves exactly as it did before this existed.
 */

export const WRAPUP_MODES = {
  /** The agent may leave whenever they like. */
  OPTIONAL: 'OPTIONAL',
  /** They must label the call, and nothing hurries them. */
  MANDATORY: 'MANDATORY',
  /** They must label it, but the timer eventually moves them on. */
  MANDATORY_TIMEOUT: 'MANDATORY_TIMEOUT',
  /** As above, and the wrap-up is closed for them when time runs out. */
  MANDATORY_FORCED_TIMEOUT: 'MANDATORY_FORCED_TIMEOUT',
  /** No wrap-up at all unless the agent asks for one. */
  AGENT_REQUESTED: 'AGENT_REQUESTED',
} as const;

export type WrapupMode = (typeof WRAPUP_MODES)[keyof typeof WRAPUP_MODES];

/* What a plain countdown already did, which is what every queue got before the
   modes were honoured. An unreadable mode falls back to this, so nothing
   changes underneath anybody. */
export const WRAPUP_DEFAULT_MODE: WrapupMode = WRAPUP_MODES.MANDATORY_TIMEOUT;

const KNOWN = new Set<string>(Object.values(WRAPUP_MODES));

export const readWrapupMode = (raw: unknown): WrapupMode => {
  const text = String(raw ?? '')
    .trim()
    .toUpperCase();
  return (KNOWN.has(text) ? text : WRAPUP_DEFAULT_MODE) as WrapupMode;
};

export type WrapupState = {
  mode: unknown;
  /** Seconds the queue allows. 0 or less means the queue sets no limit. */
  totalSeconds: number;
  /** Seconds already spent wrapping up. */
  elapsedSeconds: number;
  /** True once the agent has chosen a disposition. */
  hasDisposition: boolean;
  /** True when the agent asked for wrap-up themselves. */
  requested?: boolean;
};

export type WrapupVerdict = {
  /** Show a wrap-up at all. */
  active: boolean;
  /** The agent may end it now, by their own choice. */
  mayLeave: boolean;
  /** Run a visible countdown. */
  showCountdown: boolean;
  /** End it for them, without being asked. */
  autoClose: boolean;
  /** Why they cannot leave yet, for the line under the button. Empty when they can. */
  blockedReason: string;
};

const outOfTime = (state: WrapupState): boolean =>
  state.totalSeconds > 0 && state.elapsedSeconds >= state.totalSeconds;

/**
 * What the wrap-up screen should do right now.
 *
 * `autoClose` never implies `mayLeave` and vice versa: one is the product
 * ending the wrap-up, the other is the agent being allowed to. A screen that
 * conflated them would let an agent dismiss a mandatory wrap-up by waiting.
 */
export const wrapupVerdict = (state: WrapupState): WrapupVerdict => {
  const mode = readWrapupMode(state.mode);
  const needsLabel = 'Choose how the call went before you finish.';

  if (mode === WRAPUP_MODES.AGENT_REQUESTED && !state.requested) {
    return {
      active: false,
      mayLeave: true,
      showCountdown: false,
      autoClose: false,
      blockedReason: '',
    };
  }

  if (mode === WRAPUP_MODES.OPTIONAL) {
    return {
      active: true,
      mayLeave: true,
      showCountdown: state.totalSeconds > 0,
      autoClose: outOfTime(state),
      blockedReason: '',
    };
  }

  /* Mandatory in some form from here down. The agent may only end it once the
     call is labelled - that is the whole point of the setting. */
  const labelled = Boolean(state.hasDisposition);

  if (mode === WRAPUP_MODES.MANDATORY) {
    return {
      active: true,
      mayLeave: labelled,
      /* No countdown: this mode exists precisely so nobody is hurried, and a
         ticking clock says the opposite of what the supervisor chose. */
      showCountdown: false,
      autoClose: false,
      blockedReason: labelled ? '' : needsLabel,
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
      blockedReason: labelled ? '' : needsLabel,
    };
  }

  // MANDATORY_TIMEOUT, and anything unrecognised, which falls back to it.
  return {
    active: true,
    mayLeave: labelled || expired,
    showCountdown: true,
    autoClose: expired,
    blockedReason: labelled || expired ? '' : needsLabel,
  };
};
