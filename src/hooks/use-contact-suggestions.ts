import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getContactList } from '@/services/api';

/**
 * The saved contact book, as suggestions for a typed query.
 *
 * The contact book is `getContactList` → POST /api/contact/list — the same
 * endpoint the Contacts page reads. Do not reach for a call-log report here: a
 * call list answers "who have I spoken to", not "who is saved", and its rows
 * carry a different shape entirely.
 *
 * Contacts come back nested — `name.first` / `name.last` and `contact.phone` —
 * so anything that expects flat `first_name` / `last_name` off a number-keyed
 * map will silently match nothing.
 */

export type ContactSuggestion = {
  id: string;
  name: string;
  phone: string;
  email: string;
  company: string;
};

const digitsOf = (value: unknown) => String(value ?? '').replace(/\D/g, '');

/** Last-10 digits: a stored +919004583988 must answer a typed +91 90045-83988. */
const tailOf = (value: unknown) => {
  const digits = digitsOf(value);
  return digits.length > 10 ? digits.slice(-10) : digits;
};

export const toContactSuggestion = (row: any): ContactSuggestion => {
  const first = String(row?.name?.first || '').trim();
  const last = String(row?.name?.last || '').trim();
  return {
    id: String(row?._id || row?.id || ''),
    name: `${first} ${last}`.trim(),
    phone: String(row?.contact?.phone || '').trim(),
    email: String(row?.contact?.email || '').trim(),
    company: String(row?.profile?.company || '').trim(),
  };
};

/** Every saved contact, normalised. Shared cache with the Contacts page. */
export const useContactBook = () => {
  const { data = [], ...query } = useQuery({
    /* Sharing the ['getContactList'] prefix is what makes a contact saved on
       the Contacts page suggestable here without a reload — create/edit already
       invalidates that prefix. */
    queryKey: ['getContactList', 'suggestions'],
    queryFn: () => getContactList({ page: 1, limit: 200 }),
    select: (res: any) =>
      ((res?.data?.data?.result?.rows || []) as any[])
        .map(toContactSuggestion)
        .filter((c) => c.name || c.phone),
    staleTime: 60_000,
  });

  return { contacts: data as ContactSuggestion[], ...query };
};

/**
 * Contacts matching what someone has typed.
 *
 * Names match from the first character, so "he" finds Helen straight away.
 * Numbers need two digits before anything matches — a single digit matches most
 * of an address book, which is noise rather than a suggestion.
 */
export const useContactSuggestions = (query: string, limit = 6) => {
  const { contacts, isPending } = useContactBook();

  const matches = useMemo(() => {
    const raw = String(query ?? '').trim();
    if (!raw) return [] as ContactSuggestion[];

    const digits = digitsOf(raw);
    const isNumeric = !/[a-z]/i.test(raw);

    if (isNumeric) {
      if (digits.length < 2) return [] as ContactSuggestion[];
      return contacts
        .filter((c) => {
          const phone = digitsOf(c.phone);
          return phone.includes(digits) || (digits.length >= 4 && tailOf(c.phone).includes(digits));
        })
        .slice(0, limit);
    }

    const needle = raw.toLowerCase();
    return contacts
      .filter((c) => {
        const name = c.name.toLowerCase();
        if (name.startsWith(needle)) return true;
        // also from the start of any word, so "smith" finds "Jane Smith"
        return name.split(/\s+/).some((part) => part.startsWith(needle));
      })
      .slice(0, limit);
  }, [contacts, query, limit]);

  return { matches, isPending };
};

/**
 * The saved name for a number, matched on the last 10 digits so the stored and
 * the typed form need not agree about country code or punctuation. Returns ''
 * when nothing is saved, so the caller can fall back to showing the number.
 */
export const useNameForNumber = () => {
  const { contacts } = useContactBook();

  return useMemo(() => {
    const byTail = new Map<string, string>();
    contacts.forEach((c) => {
      const tail = tailOf(c.phone);
      if (tail.length >= 7 && c.name && !byTail.has(tail)) byTail.set(tail, c.name);
    });
    return (number: unknown) => {
      const tail = tailOf(number);
      if (tail.length < 7) return '';
      return byTail.get(tail) || '';
    };
  }, [contacts]);
};
