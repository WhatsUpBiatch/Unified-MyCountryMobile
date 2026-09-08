import type { DialpadSession } from '@/context/dialpad-context';
import { getDialpadSessionStatusLabel } from '../session-status';
import { getDialpadSessionDisplayInfo } from '../session-display';
import { Picker } from '@/components/mcm/picker';

type DialpadSessionSwitcherProps = {
  sessions: DialpadSession[];
  activeSessionId: string | null;
  onSwitchSession: (sessionId: string) => void;
};

const getDialpadSessionSwitcherLabel = (session: DialpadSession, statusLabel: string) => {
  const { contactName, contactNumber, isConferenceSession, isMonitoringCall } =
    getDialpadSessionDisplayInfo(session);
  if (isConferenceSession || isMonitoringCall) return `${contactName} - ${statusLabel}`;

  return `${contactName} (${contactNumber || '-'}) - ${statusLabel}`;
};

const DialpadSessionSwitcher = ({
  sessions,
  activeSessionId,
  onSwitchSession,
}: DialpadSessionSwitcherProps) => {
  if (sessions.length <= 1) return null;

  return (
    <div className="mb-2 rounded-2xl border border-[#e5edf8] bg-white px-2.5 py-1.5 max-[380px]:mb-1.5 max-[380px]:px-2 max-[380px]:py-1 sm:mb-2.5 sm:px-3 sm:py-2 md:mb-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5f789a] max-[380px]:text-[9px] sm:mb-1.5 sm:text-[11px]">
        Call Sessions
      </div>

      <Picker
        label="Active call"
        showLabel={false}
        className="mcm-field"
        value={activeSessionId ?? ''}
        options={sessions.map((session) => ({
          label: getDialpadSessionSwitcherLabel(session, getDialpadSessionStatusLabel(session)),
          value: String(session.id),
        }))}
        onChange={(option) => onSwitchSession(option.value)}
      />
    </div>
  );
};

export default DialpadSessionSwitcher;
