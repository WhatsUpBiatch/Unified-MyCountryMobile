/* Pronouns and interface language: the small rules the Profile page follows.
 * No imports, so the unit tests can load it straight from source.
 *
 * Interface language
 * ------------------
 * This console has no translation layer - no i18next, react-intl or lingui
 * anywhere in src, and every string is written in English in place. So the
 * only language it can honestly offer today is English. The choice is still
 * saved (users.interface_language) so it is there the day translations
 * arrive, and the field says so with a Coming soon flag. Add a language here
 * ONLY when its translations exist; a list of languages the app cannot show
 * is a promise the app breaks the moment somebody picks one.
 */

export interface InterfaceLanguage {
  value: string;
  label: string;
}

export const INTERFACE_LANGUAGES: ReadonlyArray<InterfaceLanguage> = [{ value: 'en', label: 'English' }];

export const DEFAULT_INTERFACE_LANGUAGE = 'en';

/* True once more than one language can actually be shown. Drives the Coming
   soon flag and the note under the select. */
export const HAS_TRANSLATIONS = INTERFACE_LANGUAGES.length > 1;

export const isSupportedLanguage = (code: unknown): boolean =>
  INTERFACE_LANGUAGES.some((l) => l.value === String(code ?? '').trim());

/* The option the select should show for a stored code. An unknown or empty
   code shows English rather than a blank, because English is what the person
   is looking at. */
export const languageOption = (code: unknown): InterfaceLanguage => {
  const wanted = String(code ?? '').trim();
  return INTERFACE_LANGUAGES.find((l) => l.value === wanted) || INTERFACE_LANGUAGES[0];
};

/* Pronouns: free text, the same 40-character ceiling as users.pronouns. The
   placeholder shows the common forms; nothing is enforced beyond length. */
export const PRONOUNS_MAX = 40;
export const PRONOUN_SUGGESTIONS: ReadonlyArray<string> = ['she/her', 'he/him', 'they/them'];
export const PRONOUNS_PLACEHOLDER = `e.g. ${PRONOUN_SUGGESTIONS.join(', ')}`;

export const cleanPronouns = (value: unknown): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PRONOUNS_MAX);
