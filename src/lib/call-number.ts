/**
 * A call log stores a number as the switch left it, not as the person dialled
 * it. Two rewrites leak through into the screens:
 *
 *   1. The carrier routing prefix. `mycountrymobile_db.providers.add_prefix` is
 *      prepended on the way out to the carrier, so a call to 12568081009 is
 *      logged as 7770112568081009.
 *   2. `<extension>_web`, the SIP endpoint the browser phone registers as, which
 *      stands in for the person on any call that started in the web phone.
 *
 * Neither is dialable and neither means anything to somebody reading their call
 * history, so both are undone before a number reaches the screen.
 */

/**
 * `add_prefix` values from `mycountrymobile_db.providers`. They are listed here
 * because no endpoint exposes them to the browser — add to this list if a
 * carrier is added with a new prefix.
 */
const CARRIER_ROUTING_PREFIXES = ['77701', '6732'];

/** E.164 allows 15 digits at most, so anything longer has been rewritten. */
const MAX_E164_DIGITS = 15;

/** Below this, whatever is left is too short to be the number that was dialled. */
const MIN_KEPT_DIGITS = 8;

/**
 * Remove a carrier routing prefix, but only when the value cannot be a real
 * number as it stands. Requiring more than 15 digits before touching anything
 * is what makes this safe: a genuine international number never reaches that
 * length, so a real number that merely happens to begin with 77701 is left
 * alone.
 */
export const stripCarrierRoutingPrefix = (value: string): string => {
  const digits = String(value || '');
  if (!/^\d+$/.test(digits) || digits.length <= MAX_E164_DIGITS) return digits;

  for (const prefix of CARRIER_ROUTING_PREFIXES) {
    if (!digits.startsWith(prefix)) continue;
    const rest = digits.slice(prefix.length);
    if (rest.length >= MIN_KEPT_DIGITS && rest.length <= MAX_E164_DIGITS) return rest;
  }

  return digits;
};

/**
 * The number as it should be shown: SIP wrapper gone, `_web` gone, carrier
 * prefix gone. A leading "+" is kept if it was there, since that is the
 * caller's own formatting rather than something the switch added.
 */
export const normalizeCallNumber = (value: unknown): string => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';

  const userPart = trimmed
    .replace(/^sip:/i, '')
    .split('@')[0]
    .replace(/\s+/g, '')
    .replace(/_web$/i, '');

  const hasPlus = userPart.startsWith('+');
  const stripped = stripCarrierRoutingPrefix(hasPlus ? userPart.slice(1) : userPart);

  return hasPlus ? `+${stripped}` : stripped;
};
