import { CUSTOM_HOURS_SCHEDULE_OPTIONS } from '@/pages/admin-settings/numbers/set-number-forwarding/constants';
import { getForwardTypePhrase } from '@/constants/forwarding-consts';

/**
 * The standard every number and extension should meet.
 *
 * A number whose `forward_call_actions` is empty has no destination and no rule
 * to fail, so the switch has nothing to run and the caller hears silence — no
 * menu, no mailbox, no error. Nothing in the product ever writes a default:
 * the number wizard starts at `forwardType: ''`, user creation applies no
 * template, and the template screens can author a standard but never apply one.
 *
 * This module is the missing definition. It states what "covered" means, judges
 * a record against it, and builds the payload that closes the gap.
 *
 * The rule it encodes is the one every mature UCaaS platform shares: **every
 * branch terminates in something a human hears.** A call may fail to reach a
 * person, but it must never fail to reach a message.
 */

export type CoverageState = 'covered' | 'partial' | 'gap';

export type Coverage = {
  state: CoverageState;
  /** Short label for the table cell. */
  headline: string;
  /** One sentence saying what a caller actually experiences. */
  detail: string;
  /** True when "Apply standard" can fix this record unattended. */
  fixable: boolean;
};

/** `forward_call_actions` arrives as a JSON string, or already parsed, or absent. */
export const parseForwardActions = (raw: unknown): any => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const assignedUserOf = (did: any) => did?.User || did?.user || null;

export const extensionOf = (did: any) => {
  const user = assignedUserOf(did);
  return String(user?.extension || did?.extension || '').trim();
};

export const assignedNameOf = (did: any) => {
  const user = assignedUserOf(did);
  if (!user?.first_name) return '';
  return `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}`.trim();
};

/**
 * What a caller reaching this number experiences today.
 *
 * "Partial" is the case worth naming separately: a number can be configured for
 * business hours and still drop every out-of-hours call, because choosing
 * Weekly without filling Closed Hours leaves that branch empty. It looks
 * configured on screen and fails half the day.
 */
export const evaluateNumber = (did: any): Coverage => {
  const actions = parseForwardActions(did?.forward_call_actions);
  const businessHours = actions?.call_handling?.business_hours;
  const destination = String(businessHours?.type || '').trim();

  if (!actions || !destination) {
    const extension = extensionOf(did);
    return {
      state: 'gap',
      headline: 'No call handling',
      detail: extension
        ? 'Calls are dropped in silence. This number is assigned to an extension, so the standard can be applied.'
        : 'Calls are dropped in silence. Assign the number to an extension first, then the standard can be applied.',
      fixable: Boolean(extension),
    };
  }

  const hours = actions?.condition?.operational_hours;
  const isWeekly = String(hours?.type || '') === 'weekly';
  const closedAction = String(hours?.closed_hour_action?.type || '').trim();

  if (isWeekly && !closedAction) {
    return {
      state: 'partial',
      headline: 'Drops out of hours',
      detail:
        'Business-hours calls are handled, but the closed-hours branch is empty — every call outside opening hours is dropped in silence.',
      /* Business hours are already set deliberately; overwriting them with a
         24-hour default would be a policy change, not a fix. */
      fixable: false,
    };
  }

  const missed = String(businessHours?.missed_call_action?.type || '').trim();

  /* Forwarding somewhere is not the same as landing. A number that rings an
     extension with nothing behind it drops every unanswered and rejected call,
     which is the exact symptom this screen exists to catch. */
  if (!missed && destination !== 'VOICEMAIL') {
    /* A personal mailbox only means something when the call is ringing a
       person. A queue or an IVR needs a mailbox chosen deliberately, so those
       are reported and left alone. */
    const ringsAnExtension = destination === 'EXTENSION' && Boolean(businessHours?.value);
    return {
      state: 'partial',
      headline: 'No voicemail',
      detail: ringsAnExtension
        ? 'Calls ring the extension, but nothing catches them when nobody answers or the call is rejected — those callers get silence.'
        : `Calls reach ${getForwardTypePhrase(destination)}, but nothing catches an unanswered call. Choose a mailbox for this number in Set Forwarding.`,
      fixable: ringsAnExtension,
    };
  }

  return {
    state: 'covered',
    headline: 'Covered',
    detail: 'Every call reaches a destination, and voicemail catches the rest.',
    fixable: false,
  };
};

/**
 * A destination only counts if a human ends up hearing something. `HANGUP` is a
 * real, selectable choice on the call-rules screens, and it is the one
 * destination that ends the call the same way an empty rule does.
 */
const landsSomewhere = (type: string) => Boolean(type) && type !== 'HANGUP';

/** How a stored rule's destination reads inside a sentence. */
const describeTarget = (rule: any): string => {
  const type = String(rule?.type || '').trim();
  const name = String(rule?.label || rule?.name || rule?.value_label || '').trim();
  const value = String(rule?.value || '').trim();

  if (type === 'VOICEMAIL') {
    return rule?.personal === false && name ? `${name}'s voicemail` : 'voicemail';
  }
  if (type === 'EXTENSION') {
    if (name) return value ? `${name} (${value})` : name;
    return value ? `extension ${value}` : 'another extension';
  }
  if (type === 'PHONE') return value ? `the number ${value}` : 'an outside number';
  if (type === 'QUEUE') return name ? `the ${name} queue` : 'a call queue';
  if (type === 'DEPARTMENT') return name ? `the ${name} group` : 'a group';
  if (type === 'IVR') return name ? `the ${name} menu` : 'a menu';
  if (type === 'GREETING' || type === 'MESSAGE') return 'a recorded message';
  if (type === 'AI') return 'the virtual receptionist';
  return name || type.toLowerCase() || 'another destination';
};

/**
 * Whether an extension catches its own unanswered calls.
 *
 * A number forwarding to an extension only lands the call if that extension
 * falls back to voicemail when nobody picks up — otherwise the number looks
 * covered while the call still dies one hop later.
 *
 * The rules are read in the order the platform reads them: Forward All Calls is
 * checked before the devices ring, so while it is on it decides where every
 * call lands and the fallback below is never reached. Judging the fallback
 * first would describe a rule that is not being used.
 *
 * `enabled` is the switch the platform actually obeys, and it is checked on
 * every rule. The call-rules form hydrates both dropdowns to "Send to
 * Voicemail" whenever nothing is stored, and saves that displayed type even
 * when the rule is switched off — so a stored `type` on its own proves nothing.
 * Judging on the displayed type alone would reproduce that same lie here.
 */
export const evaluateUser = (user: any): Coverage => {
  const rules =
    typeof user?.call_forwarding === 'string'
      ? parseForwardActions(user.call_forwarding)
      : user?.call_forwarding;

  const forwardAll = rules?.forward_calls;
  const forwardTo = String(forwardAll?.type || '').trim();
  const forwardingAll = forwardAll?.enabled === true && Boolean(forwardTo);

  if (forwardingAll && !landsSomewhere(forwardTo)) {
    return {
      state: 'gap',
      headline: 'Hangs up',
      detail: 'Forward All Calls is on and set to end the call, so every caller is hung up on.',
      fixable: false,
    };
  }

  if (forwardingAll) {
    return {
      state: 'covered',
      headline: 'Forwarded',
      detail:
        forwardTo === 'VOICEMAIL'
          ? 'Every call goes straight to voicemail without the phone ringing.'
          : `Every call is forwarded to ${describeTarget(forwardAll)} without the phone ringing, and is handled there.`,
      fixable: false,
    };
  }

  const failureAction = rules?.incoming_calls?.failure_action;
  const failure = String(failureAction?.type || '').trim();
  const failureOn = Boolean(failure) && failureAction?.enabled !== false;

  if (failureOn && landsSomewhere(failure)) {
    return {
      state: 'covered',
      headline: 'Covered',
      detail:
        failure === 'VOICEMAIL'
          ? 'Unanswered calls go to voicemail.'
          : `Unanswered calls go to ${describeTarget(failureAction)}.`,
      fixable: false,
    };
  }

  if (failureOn) {
    return {
      state: 'gap',
      headline: 'Hangs up',
      detail:
        'Unanswered calls are set to be ended, so the caller is hung up on instead of reaching a message.',
      fixable: false,
    };
  }

  /* A stored type with `enabled: false` is a fallback that was switched off,
     not one that was never chosen — worth saying differently, because the
     call-rules screen still shows that destination in its dropdown. */
  if (failure) {
    return {
      state: 'gap',
      headline: 'Hangs up',
      detail:
        'The fallback for unanswered calls is switched off, so the caller is hung up on. Switch it back on to use it.',
      fixable: false,
    };
  }

  return {
    state: 'gap',
    headline: 'Hangs up',
    detail: 'Nothing catches an unanswered call, so the switch hangs up on the caller.',
    fixable: false,
  };
};

/**
 * The payload that brings a number up to standard.
 *
 * Deliberately mirrors the shape `set-number-forwarding` submits, field for
 * field, rather than inventing a leaner one — the server is the authority on
 * what it accepts, and a shape it has never seen is a shape nobody has tested.
 *
 * Hours are set to 24 Hours on purpose. The alternative, Weekly, needs a
 * closed-hours branch to be safe, and guessing a company's opening hours would
 * be inventing policy. 24 Hours cannot drop a call.
 */
export const buildNumberStandard = (
  did: any,
  options?: { welcomeGreeting?: { value: string; label: string } },
) => {
  const extension = extensionOf(did);
  if (!extension) return null;

  const welcome = options?.welcomeGreeting;

  return {
    uuid: did?.uuid,
    forward_call_actions: {
      condition: {
        transcription: false,
        ai_call_monitoring: false,
        operational_hours: {
          regional: {
            timezone: { label: '', value: '' },
            time_format: 12,
            country_code: { label: '', value: '' },
            country: { label: '', value: '' },
          },
          type: '24_hours',
          value: CUSTOM_HOURS_SCHEDULE_OPTIONS,
          holidays: [],
          /* Nothing to define: with 24-hour operation there is no closed
             branch for a call to fall into. */
          closed_hour_action: {
            type: '',
            value: '',
            enabled: false,
            personal: false,
            type_label: '',
            value_label: '',
          },
        },
        recording: {},
        display_number: {
          incoming: false,
          masking: { type: '', label: '', value: '' },
        },
        caller_id: '',
      },
      call_handling: {
        business_hours: {
          type: 'EXTENSION',
          value: extension,
          label: assignedNameOf(did) || extension,
          name: assignedNameOf(did) || extension,
          extension,
          /* The half that was missing. Without this the call rings the
             extension and then ends — reject it or let it ring out and the
             caller gets silence, which is exactly the fault we are fixing.
             `personal: true` means the extension's own mailbox, matching how
             the same flag is read back into the wizard and how user-level
             rules resolve it. */
          missed_call_action: {
            type: 'VOICEMAIL',
            value: extension,
            label: assignedNameOf(did) || extension,
            personal: true,
          },
        },
      },
      media: {
        welcome: welcome
          ? { enabled: true, value: welcome.value, label: welcome.label }
          : { enabled: false, value: '', label: '' },
        hold: { enabled: false, value: '', label: '' },
        voicemail: { enabled: false, value: '', label: '' },
      },
    },
  };
};

/** Reads like the flow a caller walks, for showing what will be written. */
export const describeStandard = (did: any) => {
  const extension = extensionOf(did);
  const name = assignedNameOf(did);
  return [
    'Inbound call',
    'Ring extension ' + (extension || '—') + (name ? ` · ${name}` : ''),
    'No answer or rejected',
    'Voicemail',
  ];
};


/**
 * Adds the missing voicemail fallback to a number that already has handling.
 *
 * Deliberately not `buildNumberStandard`: that writes a whole configuration,
 * and applying it to a number already routing to a queue or an IVR would
 * silently replace that destination with an extension. This keeps every stored
 * value and adds the one field that was never written.
 */
export const buildVoicemailPatch = (did: any) => {
  const actions = parseForwardActions(did?.forward_call_actions);
  const businessHours = actions?.call_handling?.business_hours;
  const extension = String(businessHours?.value || '').trim();

  if (!actions || !extension || String(businessHours?.type || '') !== 'EXTENSION') return null;

  return {
    uuid: did?.uuid,
    forward_call_actions: {
      ...actions,
      call_handling: {
        ...actions.call_handling,
        business_hours: {
          ...businessHours,
          missed_call_action: {
            type: 'VOICEMAIL',
            value: extension,
            label: businessHours?.label || businessHours?.name || extension,
            personal: true,
          },
        },
      },
    },
  };
};
