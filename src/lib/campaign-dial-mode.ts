/**
 * Who places the call in each campaign mode.
 *
 *   Preview      the agent sees the record, then dials from their own phone.
 *   Progressive  the server dials one contact per idle agent and rings the
 *                agent through the campaign's queue when someone answers.
 *   Predictive   as progressive, but the server dials ahead of the agents
 *                becoming free, corrected by the measured answer and abandon
 *                rates.
 *
 * Until the dialer engine and the switch route were deployed, progressive
 * campaigns were dialled from the agent's browser like preview without the
 * countdown. SERVER_DIALS_PROGRESSIVE is the switch between the two
 * behaviours: leave it false until campaign-api runs the engine and the
 * switch has the campaign route (backend-patches/campaign-api/
 * apply-outbound-dialer.sh and backend-patches/fs-xml-api/
 * apply-campaign-context.sh), or a progressive agent will sit waiting for a
 * call that nothing places.
 */
export const SERVER_DIALS_PROGRESSIVE = false;

export const normalizeDialMode = (value: unknown): string => String(value ?? '').trim().toUpperCase();

/** True when the server, not the agent's browser, places this campaign's calls. */
export const isServerDialed = (dialMethod: unknown): boolean => {
  const mode = normalizeDialMode(dialMethod);
  if (mode.includes('PREDICTIVE')) return true;
  if (mode === 'PROGRESSIVE') return SERVER_DIALS_PROGRESSIVE;
  return false;
};

/** Modes where the pacing controls (lines, calls per agent, abandon cap) mean something. */
export const hasPacingControls = (dialMethod: unknown): boolean => {
  const mode = normalizeDialMode(dialMethod);
  return mode === 'PREDICTIVE' || mode === 'PROGRESSIVE';
};

export const HEALTH_LABEL: Record<string, { label: string; tone: 'good' | 'warn' | 'crit' | 'neu' }> = {
  running: { label: 'Dialling normally', tone: 'good' },
  waiting_for_agents: { label: 'Waiting for agents', tone: 'crit' },
  waiting_for_contacts: { label: 'Waiting for contacts', tone: 'crit' },
  outside_hours: { label: 'Outside calling hours', tone: 'warn' },
  line_limit: { label: 'At the line limit', tone: 'warn' },
  agent_driven: { label: 'Agents dial from their records', tone: 'neu' },
  paused: { label: 'Paused', tone: 'neu' },
  stopping: { label: 'Stopping', tone: 'warn' },
  completed: { label: 'Completed', tone: 'neu' },
  not_started: { label: 'Not started', tone: 'neu' },
};

export const CALL_STATUS_LABEL: Record<string, string> = {
  dialing: 'Dialling',
  ringing: 'Ringing',
  answered: 'Answered, waiting for agent',
  offering: 'Ringing agent',
  talking: 'Talking',
  ended: 'Ended',
};

export const OUTCOME_LABEL: Record<string, string> = {
  ANSWERED: 'Answered',
  ABANDONED: 'Abandoned',
  NO_ANSWER: 'No answer',
  BUSY: 'Busy',
  FAILED: 'Failed',
  CANCEL: 'Cancelled',
};

export const DUTY_LABEL: Record<string, string> = {
  idle: 'Idle',
  on_call: 'On a call',
  wrap_up: 'Wrapping up',
  break: 'On break',
  offline: 'Offline',
};
