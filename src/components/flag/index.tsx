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

/* The same flag, for the places that already know the country.
 *
 * `Flag` below derives the country from a phone number, which is right for a
 * call log but useless for a country picker — there the ISO code is the thing
 * in hand. Both render through the same font stack above, so a flag looks
 * identical wherever it appears and the Windows webfont problem is solved in
 * one place rather than two. */
export const CountryFlag = memo(
  ({ code, className = '' }: { code?: string | null; className?: string }) => {
    const iso = String(code ?? '').trim().toUpperCase();
    /* Two letters exactly. The list this is fed from is clean, but a stray
       value would otherwise render as bare regional-indicator letters next to
       real flags, which reads as a broken row rather than a missing one. */
    if (!/^[A-Z]{2}$/.test(iso)) return null;

    return (
      <span className={className} aria-hidden="true">
        <ReactCountryFlag
          countryCode={iso}
          /* Real flag artwork rather than the emoji. Without `svg` this renders
             a country-flag emoji, which Windows draws through the Twemoji
             webfont as a flat rounded-square cartoon — legible, but nothing
             like the flag. `svg` serves lipis/flag-icons instead: correct
             proportions, correct colours, and the same drawing on every
             platform rather than one per operating system. */
          svg
          style={{
            /* 4:3, the aspect the artwork is authored at, so nothing is
               squashed. Sized in em so it tracks the text beside it. */
            width: '1.36em',
            height: '1.02em',
            borderRadius: '2px',
            objectFit: 'cover',
            /* A hairline, because several flags are mostly or entirely white
               (Japan) and would otherwise dissolve into a white menu. */
            boxShadow: '0 0 0 1px rgba(13, 21, 38, 0.12)',
            verticalAlign: 'middle',
          }}
        />
      </span>
    );
  },
);
CountryFlag.displayName = 'CountryFlag';

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
