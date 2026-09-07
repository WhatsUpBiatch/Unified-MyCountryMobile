import { formatPhoneNumber, isExtensionNumber } from '@/lib/utils';
import { memo, useMemo } from 'react';
import PhoneInput from 'react-phone-input-2';
import Flag, { toFlagNumber } from '../flag';

export const filterPhoneNumber = (number: any) => (number.startsWith('+') ? number : `+${number}`);

/**
 * A phone number with its country flag.
 *
 * Two things it has to survive, because numbers reach it from every corner of
 * the platform:
 *
 *  - DIDs are stored inconsistently, with and without a leading "+". `Flag`
 *    only parses strict E.164, so the number is normalised before it gets there
 *    or roughly half the flags silently fail to render.
 *  - Internal extensions ("7242") have no country at all. They are shown as
 *    typed, with no flag and no reformatting — an extension run through an
 *    international formatter comes out as a nonsense country code.
 */
const NumberWithFlag = ({
  number = null,
  isFlag = true,
  isFlagOnly = false,
  className = '',
}: any) => {
  const value = String(number ?? '').trim();
  const isExtension = isExtensionNumber(value);

  const formattedNumber = useMemo(() => {
    if (!value) return '';
    if (isExtension) return value;
    return formatPhoneNumber(value) || value;
  }, [value, isExtension]);

  if (!value) return isFlagOnly ? null : '---';

  /* Flag on its own — for a field that already renders the number itself, like
     the dialler's input. */
  if (isFlagOnly) {
    if (isExtension) return null;
    return <Flag phoneNumber={toFlagNumber(value)} className={className} />;
  }

  if (!isFlag) {
    return (
      <PhoneInput
        country={'us'}
        value={filterPhoneNumber(value)}
        onChange={() => {}}
        disableDropdown={true}
        disabled={true}
        enableAreaCodes={true}
      />
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {isExtension ? null : (
        <Flag phoneNumber={toFlagNumber(value)} className="w-5 flex-shrink-0" />
      )}
      {formattedNumber}
    </span>
  );
};

export default memo(NumberWithFlag);
