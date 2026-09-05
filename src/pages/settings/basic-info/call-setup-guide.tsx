import { Link } from 'react-router-dom';
import { useGetAssignedDIDNumbers } from '@/hooks/common';
import { Ic, McmIconSprite } from '@/components/mcm/icons';
import { NotAppliedFlag } from '../not-applied-note';

/**
 * "How your calls reach you" — the setup this profile is actually for.
 *
 * On its own this screen is a name, a photo and an extension, with nothing
 * saying what any of it does. The questions people arrive with are which number
 * rings them, what happens when they miss a call, and what a caller hears — and
 * every one of those is answered somewhere else in Admin.
 *
 * So rather than explaining the settings in the abstract, this reads the
 * person's own configuration and tells them where they stand, with a link to
 * the screen that changes each one. A checklist that reports real state is
 * worth more than help text, because it can say "this one is not set up" — and
 * that is the failure people cannot otherwise see. A number that drops calls
 * looks identical to one that works until somebody rings it.
 */

type Step = {
  title: string;
  /** What is true right now, in the person's own configuration. */
  status: string;
  ok: boolean;
  /** True for a step the switch does not act on yet. It is shown, so the
      person can see what they have saved, but it is neither a tick nor a
      warning, and it is not counted as something left for them to finish.
      Since 3 Sep 2026 only one case is left: an after-ring destination of an
      outside number, a queue or a menu. */
  soon?: boolean;
  /** Why this step exists at all, for someone meeting it the first time. */
  explain: string;
  action?: { label: string; to: string };
};

const asObject = (value: unknown): any => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value) || '{}');
  } catch {
    return {};
  }
};

const CallSetupGuide = ({ userInfo }: { userInfo: any }) => {
  const info = userInfo?.user_info || {};
  const extension = String(info?.extension || '').trim();
  const fullName = `${info?.first_name || ''} ${info?.last_name || ''}`.trim();

  const { data: assignedNumbers = [] } = useGetAssignedDIDNumbers(info?.uuid || userInfo?.uuid);

  const rules = asObject(userInfo?.call_forwarding);
  const greetings = asObject(userInfo?.greetings);

  /* What happens after ringing, as the switch has followed it for a call
     dialled straight to the person since the patch of 3 Sep 2026 (proven by
     offline tests and by reading the running switch, not yet by a real call):
     nothing saved means voicemail; voicemail, an extension or hang up is
     followed; an outside number, a queue or a menu is saved and not followed
     after the ring. */
  const failureAction = rules?.incoming_calls?.failure_action;
  const fallbackSet = Boolean(failureAction?.type) && failureAction?.enabled !== false;
  const fallbackType = String(failureAction?.type || '').toUpperCase();
  const fallbackFollowed =
    !fallbackSet || ['VOICEMAIL', 'EXTENSION', 'HANGUP'].includes(fallbackType);
  const fallbackStatus = !fallbackSet
    ? 'Callers go to your voicemail. That is what happens when nothing else is chosen.'
    : fallbackType === 'VOICEMAIL'
      ? 'Callers go to your voicemail.'
      : fallbackType === 'EXTENSION'
        ? `Callers go to ${failureAction?.name || failureAction?.value_label || `extension ${failureAction?.value || ''}`.trim()}.`
        : fallbackType === 'HANGUP'
          ? 'The call ends.'
          : `Saved: send callers to ${
              failureAction?.type_label?.toLowerCase() || fallbackType.toLowerCase()
            }. Not followed after the ring yet.`;

  const voicemailGreeting = greetings?.voicemail;
  const greetingSet = Boolean(voicemailGreeting?.value) && voicemailGreeting?.enabled !== false;

  const numbers = (assignedNumbers as any[]) || [];

  const steps: Step[] = [
    {
      title: 'Your extension',
      status: extension ? `Colleagues reach you on ${extension}` : 'No extension assigned yet',
      ok: Boolean(extension),
      explain:
        'Your internal number. Anyone inside the company can dial it directly, and outside numbers are pointed at it.',
      action: extension ? undefined : { label: 'Ask an admin', to: '/admin-settings/people' },
    },
    {
      title: 'Numbers that ring you',
      status: numbers.length
        ? numbers
            .slice(0, 3)
            .map((row: any) => row?.did_number)
            .filter(Boolean)
            .join(', ') + (numbers.length > 3 ? ` and ${numbers.length - 3} more` : '')
        : 'No outside number points here yet',
      ok: numbers.length > 0,
      explain:
        'The public numbers people outside the company dial to reach you. Without one, only colleagues can call you.',
      action: { label: 'Numbers', to: '/admin-settings/numbers/in-use' },
    },
    /* Both of these are followed by the switch for a call straight to the
       person, so they are a tick or a warning again. The one exception is an
       after-ring destination the switch does not follow yet (an outside
       number, a queue or a menu): that stays "Coming soon", neither a tick
       nor something the person can finish. */
    {
      title: 'When you do not answer',
      status: fallbackStatus,
      ok: fallbackFollowed,
      soon: !fallbackFollowed,
      explain:
        'Covers a call you miss, a call you reject, and a call that arrives while you are offline. This is for calls straight to you; a call through a queue or a menu follows that queue’s or menu’s own rules.',
      action: { label: 'My Phone', to: '/admin-settings/account/phone' },
    },
    {
      title: 'What callers hear',
      status: greetingSet
        ? `Callers hear: ${voicemailGreeting?.label || 'your greeting'}.`
        : 'No greeting of your own is saved yet.',
      ok: greetingSet,
      explain: fullName
        ? `A greeting that names you — "You have reached the voicemail of ${fullName}" — tells callers they reached the right person. It plays before they leave a message.`
        : 'A greeting that names you tells callers they reached the right person. It plays before they leave a message.',
      action: { label: 'Greetings', to: '/admin-settings/account/greetings' },
    },
  ];

  /* Only the steps the switch acts on can be "left to finish". */
  const outstanding = steps.filter((step) => !step.soon && !step.ok).length;

  return (
    <section className="mcm-setupguide">
      <McmIconSprite />
      <header>
        <div>
          <h2>How your calls reach you</h2>
          <p>
            {outstanding
              ? `${outstanding} of these ${outstanding === 1 ? 'is' : 'are'} not set up yet. Until they are, some callers will not get through, or will not know they reached you.`
              : 'Your extension, numbers, voicemail and greeting are set up, so calls straight to you reach you.'}
          </p>
        </div>
        <span className={`mcm-setupguide-pill${outstanding ? ' warn' : ''}`}>
          {outstanding ? `${outstanding} to finish` : 'All set'}
        </span>
      </header>

      <ol>
        {steps.map((step) => (
          <li key={step.title} className={step.soon ? 'soon' : step.ok ? 'ok' : 'todo'}>
            {/* A coming-soon step gets a neutral grey clock: not green (it does
                not work) and not amber (nothing is waiting on the person). */}
            <span
              className="mcm-setupguide-mark"
              aria-hidden
              style={step.soon ? { background: '#f2f4f7', color: '#667085' } : undefined}
            >
              <Ic n={step.soon ? 'clock' : step.ok ? 'check' : 'alert'} size={13} />
            </span>
            <div className="mcm-setupguide-body">
              <h3 className="flex items-center gap-2">
                {step.title}
                {step.soon ? <NotAppliedFlag>Coming soon</NotAppliedFlag> : null}
              </h3>
              <p className="mcm-setupguide-status">{step.status}</p>
              <p className="mcm-setupguide-explain">{step.explain}</p>
            </div>
            {step.action ? (
              <Link className="mcm-setupguide-action" to={step.action.to}>
                {step.action.label}
              </Link>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
};

export default CallSetupGuide;
