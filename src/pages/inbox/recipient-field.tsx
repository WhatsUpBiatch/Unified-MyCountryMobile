import { useEffect, useMemo, useRef, useState } from 'react';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { cn } from '@/lib/utils';
import CustomAvatar from '@/components/custom/custom-avatar';
import NumberWithFlag from '@/components/custom/number-with-flag';
import Flag, { toFlagNumber } from '@/components/flag';
import { useContactSuggestions, useNameForNumber } from '@/hooks/use-contact-suggestions';

/**
 * The "To" field of a composer: a name OR a number.
 *
 * This replaces react-phone-input-2, which cannot hold a name at all — it
 * strips every non-digit on each keystroke, so searching contacts by name was
 * impossible for as long as it owned the field.
 *
 * Two things this deliberately does NOT do, both learned the hard way:
 *
 *  - It does not commit the recipient to a chip. A chip that commits on the
 *    first keystroke unmounts the input, so only one digit could ever be typed.
 *    The text stays exactly as typed, and the parsed value goes to the form
 *    underneath.
 *  - It does not mirror the form value back into the input on every change.
 *    Doing that rewrites the text mid-word the moment the digits parse valid,
 *    which moves the caret out from under the person typing. The field
 *    hydrates only while it is still untouched — deep links, and a contact's
 *    "message" action.
 */

const digitsOf = (value: unknown) => String(value ?? '').replace(/\D/g, '');

/** The country to read a local number against: the number we are sending from. */
const countryOfNumber = (value: unknown): CountryCode | undefined => {
  const digits = digitsOf(value);
  if (!digits) return undefined;
  try {
    return parsePhoneNumberFromString(`+${digits}`)?.country;
  } catch {
    return undefined;
  }
};

/**
 * What a typed recipient resolves to.
 * `value` is what the form stores; '' while nothing usable has been typed.
 */
export const parseRecipient = (text: string, fromNumber?: string) => {
  const raw = String(text || '').trim();
  if (!raw) return { value: '', isValid: false };
  if (/[a-z]/i.test(raw)) return { value: '', isValid: false };

  try {
    // A leading "+" carries its own country code; anything else is read
    // against the country of the number it is being sent from.
    const parsed = raw.startsWith('+')
      ? parsePhoneNumberFromString(raw)
      : parsePhoneNumberFromString(raw, countryOfNumber(fromNumber));
    if (parsed?.isValid()) return { value: parsed.number, isValid: true };
  } catch {
    /* fall through to the digits below */
  }

  // Not valid yet — still hand the digits down so rate lookups and validation
  // can react while a number is only half typed.
  const digits = digitsOf(raw);
  return { value: digits ? `+${digits}` : '', isValid: false };
};

type Props = {
  /** the form's current value */
  value?: string;
  onChange: (value: string) => void;
  /** the DID the message is sent from — gives local numbers their country */
  fromNumber?: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
};

const RecipientField = ({
  value = '',
  onChange,
  fromNumber = '',
  placeholder = 'Type a name or number',
  error = '',
  disabled = false,
  autoFocus = false,
}: Props) => {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const touched = useRef(false);

  /* Hydrate ONLY while untouched. Anything else fights the caret. */
  useEffect(() => {
    if (touched.current) return;
    const incoming = String(value || '').trim();
    if (!incoming || incoming === text) return;
    setText(incoming.startsWith('+') ? incoming : `+${incoming}`);
  }, [value, text]);

  const isName = /[a-z]/i.test(text);
  const { matches } = useContactSuggestions(text, 5);
  /* Who this number belongs to, once it is a real number. Shown at the end of
     the line so it is clear the message is going to the person you meant, not
     just to a string of digits. */
  const nameForNumber = useNameForNumber();
  const showSuggestions = open && Boolean(text.trim()) && matches.length > 0;
  const noMatch = open && isName && text.trim().length > 1 && matches.length === 0;

  const parsed = useMemo(() => parseRecipient(text, fromNumber), [text, fromNumber]);

  const apply = (next: string) => {
    touched.current = true;
    setText(next);
    setOpen(true);
    onChange(parseRecipient(next, fromNumber).value);
  };

  const pickContact = (phone: string) => {
    const normalised = parseRecipient(phone, fromNumber);
    touched.current = true;
    setText(normalised.value || phone);
    setOpen(false);
    onChange(normalised.value || phone);
  };

  const resolvedName = parsed.value ? nameForNumber(parsed.value) : '';

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2">
      {/* The country of the number being typed, same as the From: line above. */}
      <span className="mcm-addr-flag">
        {parsed.value ? <Flag phoneNumber={toFlagNumber(parsed.value)} /> : null}
      </span>

      <input
        type="text"
        className={cn('mcm-addr-input', error && 'is-error')}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        aria-label="Recipient"
        aria-invalid={Boolean(error)}
        onChange={(e) => apply(e.target.value)}
        onFocus={() => setOpen(true)}
        // A click on a suggestion has to land before the list unmounts.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />

      {resolvedName ? <span className="mcm-addr-who">{resolvedName}</span> : null}

      {showSuggestions ? (
        <div className="mcm-addr-suggest">
          {matches.map((contact) => (
            <button
              type="button"
              key={contact.id || contact.phone}
              className="mcm-addr-opt"
              disabled={!contact.phone}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickContact(contact.phone)}
            >
              <CustomAvatar name={contact.name || contact.phone} type="contact" size="26" />
              <span className="min-w-0 flex-1">
                <span className="mcm-addr-opt-n">{contact.name || contact.phone}</span>
                <span className="mcm-addr-opt-m mcm-num">
                  {contact.phone ? <NumberWithFlag number={contact.phone} /> : 'No number saved'}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Empty space reads as "still searching" — say it found nothing. */}
      {noMatch ? (
        <div className="mcm-addr-suggest">
          <div className="mcm-addr-none">No saved contact matches “{text.trim()}”.</div>
        </div>
      ) : null}

      {/* Sits at the END of the addressing line, not under it: floating it below
          laid the message over the conversation body and across the row's own
          rule. Inline, it simply shares the row it belongs to. */}
      {error ? (
        <span className="mcm-addr-err">{error}</span>
      ) : text.trim() && !isName && !parsed.isValid ? (
        <span className="mcm-addr-err warn">Not a complete number yet</span>
      ) : null}
    </div>
  );
};

export default RecipientField;
