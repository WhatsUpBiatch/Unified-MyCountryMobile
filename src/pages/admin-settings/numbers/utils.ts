import { FORWARD_TYPES } from '@/constants/forwarding-consts';

/**
 * `did_type` is a single-character enum returned by the numbers APIs.
 * Keep every list page in agreement on how it is spelled out.
 */
export const DID_TYPE_LABELS: Record<string, string> = {
  L: 'Local',
  N: 'National',
  T: 'Toll Free',
  M: 'Mobile',
};

export const getDidTypeLabel = (didType?: string | null): string => {
  const key = String(didType ?? '')
    .trim()
    .toUpperCase();
  return DID_TYPE_LABELS[key] ?? '--';
};

/**
 * Forwarding targets, grouped by how the "Forwarded to" cell has to render them.
 * A number whose `call_handling.business_hours.type` matches ANY of these groups
 * already has live forwarding and must not be offered a "Set Forwarding" link.
 */
export const FORWARD_TYPES_WITH_EXTENSION = [FORWARD_TYPES.EXTENSION, FORWARD_TYPES.VOICEMAIL];

export const FORWARD_TYPES_WITH_NAME = [
  FORWARD_TYPES.DEPARTMENT,
  FORWARD_TYPES.IVR,
  FORWARD_TYPES.GREETING,
  FORWARD_TYPES.MESSAGE,
  FORWARD_TYPES.HANGUP,
  FORWARD_TYPES.QUEUE,
  FORWARD_TYPES.DEVICE,
  FORWARD_TYPES.AI,
];

export const FORWARD_TYPES_WITH_PHONE = [FORWARD_TYPES.PHONE];

/**
 * What a forwarding target is called, for the "Forwarded to" cell.
 *
 * The cell ran the raw enum through `capitalizeFirstLetter`, which lower-cases
 * everything after the first letter — so IVR read as "Ivr" and AI as "Ai".
 * These are names, and two of them are acronyms; a table cannot spell them
 * from a rule, so it is told.
 */
const FORWARD_TYPE_LABELS: Record<string, string> = {
  [FORWARD_TYPES.EXTENSION]: 'Extension',
  [FORWARD_TYPES.VOICEMAIL]: 'Voicemail',
  [FORWARD_TYPES.DEPARTMENT]: 'Department',
  [FORWARD_TYPES.QUEUE]: 'Queue',
  [FORWARD_TYPES.IVR]: 'IVR menu',
  [FORWARD_TYPES.GREETING]: 'Greeting',
  [FORWARD_TYPES.MESSAGE]: 'Message',
  [FORWARD_TYPES.HANGUP]: 'Hang up',
  [FORWARD_TYPES.DEVICE]: 'Device',
  [FORWARD_TYPES.AI]: 'AI receptionist',
  [FORWARD_TYPES.PHONE]: 'Outside number',
};

export const getForwardTypeLabel = (forwardType?: string | null): string =>
  FORWARD_TYPE_LABELS[String(forwardType ?? '').trim().toUpperCase()] ?? 'Forwarded';

export const isForwardingConfigured = (forwardType?: string | null): boolean =>
  !!forwardType &&
  (FORWARD_TYPES_WITH_EXTENSION.includes(forwardType) ||
    FORWARD_TYPES_WITH_NAME.includes(forwardType) ||
    FORWARD_TYPES_WITH_PHONE.includes(forwardType));
