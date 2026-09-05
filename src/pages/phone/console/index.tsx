import { useMemo, useState } from 'react';
import { useUser } from '@/hooks/use-user';
import DialpadTranscriptManager from '@/components/dialpad/components/dialpad-transcript-manager';
import { ConsoleIconSprite } from './icons';
import CallListColumn, { type ConsoleCallRow, type ConsoleLogSource } from './call-list-column';
import StageColumn from './stage-column';
import PanelColumn from './panel-column';
import { useConsoleCall } from './use-console-call';
import { useCallLogRefresh } from './use-call-log-refresh';
import { useCallerName } from './use-caller-name';
import { checklistState, scoreSentiment, talkRatio, toConsoleTurns } from './copilot-adapter';
import './console.css';

/**
 * MCM Unified Console — phone console.
 *
 * Layout, states and surfaces follow the "MCM Unified Console" design artifact:
 * a three-zone console (call list │ softphone stage │ intelligence panel) with
 * the call lifecycle idle → incoming/dialing → active → wrap-up.
 *
 * Everything on screen is driven by the platform: the stage is bound to the
 * real jssip session in DialpadContext, the call list to the call-log API, the
 * transcript to the speech service, notes/dispositions/history to the same
 * endpoints the dialpad uses. The parts with no service behind them yet live
 * in `copilot-adapter.ts` and label themselves as such.
 */
const PhoneConsole = () => {
  const { user } = useUser();
  const { dialpad, session, state, secs, endWrapup } = useConsoleCall();

  /* A call placed from this page did not show up in the list beside it until
     the query happened to refetch. This watches for hangup and refreshes. */
  useCallLogRefresh();
  const [selectedCall, setSelectedCall] = useState<ConsoleCallRow | null>(null);
  const [logSource, setLogSource] = useState<ConsoleLogSource>('call');
  // a request from the stage to open a specific panel tab (transcript for a leg)
  const [panelRequest, setPanelRequest] = useState<{
    tab: 'transcript';
    leg: any;
    at: number;
  } | null>(null);

  const agentName =
    `${user?.user_info?.first_name || ''} ${user?.user_info?.last_name || ''}`.trim() || 'You';

  /* Transcript rows are labelled with who spoke, so they need the resolved
     name too — otherwise every turn from the colleague at ext 7242 reads
     "Unknown". */
  const { callerName } = useCallerName();
  const turns = useMemo(
    () => toConsoleTurns(session?.transcriptionMessages, agentName, callerName(session)),
    [session?.transcriptionMessages, agentName, session, callerName],
  );

  const spoken = useMemo(() => turns.filter((t) => !t.isSummary), [turns]);
  const sentiment = useMemo(() => scoreSentiment(spoken), [spoken]);
  const talk = useMemo(() => talkRatio(spoken), [spoken]);
  const checklist = useMemo(() => checklistState(spoken), [spoken]);

  return (
    <div className="mcm-console">
      <ConsoleIconSprite />
      {/* Headless. It relays transcript socket messages onto the session and
          auto-starts transcription per the user's settings. Normally mounted by
          the Dialpad component, but DialpadGlobalOverlay renders nothing on
          /phone — without this the console's live transcript would stay empty
          on the one page that shows it. */}
      <DialpadTranscriptManager />
      <div className="phone-grid">
        <CallListColumn
          selectedId={selectedCall?.id || null}
          onSelect={(row) => {
            setSelectedCall(row);
            setPanelRequest(null);
          }}
          source={logSource}
          onSourceChange={(next) => {
            setLogSource(next);
            setSelectedCall(null);
            setPanelRequest(null);
          }}
          liveNumber={session?.remoteNumber}
        />
        <StageColumn
          state={state}
          session={session}
          secs={secs}
          dialpad={dialpad}
          turns={spoken}
          checklist={checklist}
          onEndWrapup={endWrapup}
          selectedCall={selectedCall}
          onBackToDialer={() => setSelectedCall(null)}
          onOpenTranscript={(leg) => setPanelRequest({ tab: 'transcript', leg, at: Date.now() })}
        />
        <PanelColumn
          state={state}
          session={session}
          turns={turns}
          sentiment={sentiment}
          talk={talk}
          checklist={checklist}
          selectedNumber={selectedCall?.number}
          selectedCall={selectedCall}
          panelRequest={panelRequest}
        />
      </div>
    </div>
  );
};

export default PhoneConsole;
