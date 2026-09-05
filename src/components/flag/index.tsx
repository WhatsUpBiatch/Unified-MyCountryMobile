import { parsePhoneNumber } from 'libphonenumber-js/max';
import { memo, useMemo } from 'react';
import ReactCountryFlag from 'react-country-flag';
/**
 * The faces that can actually draw a flag emoji, most reliable first.
 * 'Twemoji Country Flags' is the webfont `polyfillCountryFlagEmojis()` injects
 * for Windows, which has none of its own; the rest cover macOS, Android and
 * Linux without it.
 */
const FLAG_FONT_STACK =
  "'Twemoji Country Flags', 'Twemoji Mozilla', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";

/**
 * DIDs are stored inconsistently — some with a leading "+", some without, some
 * with spaces or brackets. `Flag` only parses strict E.164, so passing a stored
 * number straight through silently rendered nothing for about half of them.
 * Normalise to +<digits> at every call site.
 */
export const toFlagNumber = (value: unknown): string => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? `+${digits}` : '';
};

const Flag = ({
  phoneNumber = '',
  className = '',
}: {
  phoneNumber: string | undefined;
  className?: string;
  width?: number | undefined;
  height?: number | undefined;
}) => {
  const countryCode = useMemo(() => {
    try {
      if (phoneNumber && phoneNumber.startsWith('+')) {
        return parsePhoneNumber(phoneNumber)?.country || '';
      }
    } catch {
      return '';
    }

    return '';
  }, [phoneNumber]);

  if (!countryCode) return null;

  return (
    <span className={className}>
      <ReactCountryFlag
        countryCode={countryCode}
        style={{
          fontSize: '1rem',
          lineHeight: '1rem',
          /* A flag emoji is two regional-indicator letters. Windows ships no
             font that draws them as a flag, so without a face that does they
             render as the bare letter pair — which is why numbers read
             "IN +91 90045 83988" and "US +1 605 971 3935".
             `polyfillCountryFlagEmojis()` (main.tsx) injects the webfont that
             draws them, but it only applies where the inherited font-family
             names it. Phone numbers are monospace, portalled dropdowns escape
             their page's scope, and neither stack listed it. Naming it here
             means the flag carries its own font wherever it is rendered, rather
             than depending on where it happens to land. */
          fontFamily: FLAG_FONT_STACK,
        }}
      />
    </span>
  );
};

export default memo(Flag);
