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

/* The target names live beside the enum now, because the coverage screen
   needs them too and was spelling its own out of the constant by rule.
   Re-exported so every existing import here keeps working. */
export { getForwardTypeLabel } from '@/constants/forwarding-consts';

export const isForwardingConfigured = (forwardType?: string | null): boolean =>
  !!forwardType &&
  (FORWARD_TYPES_WITH_EXTENSION.includes(forwardType) ||
    FORWARD_TYPES_WITH_NAME.includes(forwardType) ||
    FORWARD_TYPES_WITH_PHONE.includes(forwardType));
