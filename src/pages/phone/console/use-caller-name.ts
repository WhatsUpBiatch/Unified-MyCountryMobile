import { useCallback, useMemo } from 'react';
import { useUsersDirectory } from '@/hooks/use-users-directory';
import { useNameForNumber } from '@/hooks/use-contact-suggestions';
import {
  getUserDisplayName,
  getUserExtension,
  isExtensionDialTarget,
} from '@/lib/extension-utility';
import type { DialpadSession } from '@/context/dialpad-context';
import { contactDisplayName, realNameOrEmpty } from './copilot-adapter';

/**
 * Put a name to whoever is on the call.
 *
 * The switch does not know your colleagues' names. Dial an extension and it
 * sends "Unknown", which the console printed verbatim — so calling the person
 * at desk 7242 was captioned "Unknown" even though the users directory had them
 * all along. Two lookups, in the order that gives the truest answer:
 *
 *   1. an internal extension  -> the users directory (this is the fix)
 *   2. an outside number      -> the saved contact book, matched on the last
 *                               ten digits so "+91 90045-83988" finds a stored
 *                               "+919004583988"
 *
 * Anything else falls through to the session's own labels and finally the
 * number itself, which is `contactDisplayName`'s job.
 */
export const useCallerName = () => {
  const { users } = useUsersDirectory();
  const nameForNumber = useNameForNumber();

  const byExtension = useMemo(() => {
    const map = new Map<string, string>();
    (users || []).forEach((user: any) => {
      const extension = getUserExtension(user);
      // getUserDisplayName falls back to "Unknown User" — no better than what
      // the switch already sent, so don't record it as an answer.
      const name = realNameOrEmpty(getUserDisplayName(user));
      if (extension && name && !map.has(extension)) map.set(extension, name);
    });
    return map;
  }, [users]);

  /** A name for a raw number, or '' when nothing is known about it. */
  const resolveName = useCallback(
    (number: unknown): string => {
      const raw = String(number ?? '').trim();
      if (!raw) return '';
      if (isExtensionDialTarget(raw)) {
        return byExtension.get(raw.replace(/\D/g, '')) || byExtension.get(raw) || '';
      }
      return nameForNumber(raw);
    },
    [byExtension, nameForNumber],
  );

  /** The display name for a live session. */
  const callerName = useCallback(
    (session: DialpadSession | null) => contactDisplayName(session, resolveName),
    [resolveName],
  );

  return { callerName, resolveName };
};
