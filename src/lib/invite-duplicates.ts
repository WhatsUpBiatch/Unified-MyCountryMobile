/* Somebody you are inviting is already here — or is in the list twice.
 *
 * THE PROBLEM
 *
 * The invite form adds up to ten people at once and checks each field against
 * the platform one at a time, as it is typed. That catches an email address
 * that already belongs to somebody. It does not catch the two mistakes that
 * actually happen when an administrator is pasting a list:
 *
 *   The same person typed twice in the same batch. Neither row has been saved
 *   yet, so neither is "already taken" as far as the platform is concerned.
 *   Both rows pass, the request goes, and the whole batch fails on a database
 *   error with nothing on screen saying which two rows were the problem.
 *
 *   The same person who is already on the account, described as a taken field
 *   rather than as a person. "Email already exists" does not tell an
 *   administrator that Amara Osei is sitting in the London office right now, or
 *   what to do about it.
 *
 * ONE PERSON, ONE PLACE
 *
 * A person belongs to exactly one location. That is not a limitation of this
 * screen, it is what a person *is* here: their extension, their number, their
 * opening hours and their timezone all come from the location they sit in, and
 * a person in two locations would have two of each. So there is no such thing
 * as adding somebody a second time to move them. The answer is always to open
 * the person who already exists and change their location, and every message in
 * this file says that in those words rather than leaving somebody to work it
 * out.
 *
 * WHAT COUNTS AS THE SAME PERSON
 *
 * The email address, and nothing else. It is what somebody signs in with, so
 * two people cannot share one. Names are not evidence: two people really are
 * called Sarah Jones. Phone numbers and extensions are checked too, but as
 * clashes over a *thing* rather than as evidence of the same person — an
 * extension somebody has just left is very often typed for the person
 * replacing them.
 *
 * WHY THE PLATFORM'S OWN CHECK IS NOT ENOUGH
 *
 * The form already asks the platform whether an email address is free, and the
 * platform answers "Email already exists!" — four words with no name, no
 * location, and one further problem: that check looks at every company on the
 * platform, not just yours. An address belonging to a completely different
 * organisation comes back the same way as your own colleague's. An
 * administrator reading it concludes their colleague is already set up, goes
 * looking, and finds nobody.
 *
 * So the roster you are already looking at is checked as well, and the two
 * answers together say something useful: found here, and we can name the person
 * and where they sit; not found here but the platform says taken, and the
 * honest answer is that the address belongs to somebody outside this company.
 *
 * It reads and writes nothing: give it the rows on the form and the roster
 * already on screen, get back a list of problems in plain sentences.
 */

/** One row of the invite form, as it stands while somebody is typing. */
export interface InviteRowLike {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  extension?: string | number;
}

/** Somebody already on the account, as the user list hands them back. */
export interface ExistingPersonLike {
  uuid?: string;
  user_uuid?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  extension?: string | number;
  site?: { name?: string };
}

export type ClashField = 'email' | 'extension' | 'phone';

export type ClashKind =
  /** The same email address is on two rows of this invite. */
  | 'email-twice'
  /** Somebody on the account already signs in with this email address. */
  | 'email-taken'
  /** The same extension is on two rows of this invite. */
  | 'extension-twice'
  /** Somebody on the account already answers on this extension. */
  | 'extension-taken'
  /** The same phone number is on two rows of this invite. */
  | 'phone-twice';

export interface Clash {
  /** Which row of the form, counting from zero. */
  row: number;
  field: ClashField;
  kind: ClashKind;
  /** One sentence for the administrator, naming the person where we know it. */
  message: string;
  /**
   * True when this must be fixed before the invite can be sent. Everything here
   * is blocking today — the platform refuses all of them — but the flag is kept
   * separate from the message so a future softer check has somewhere to live.
   */
  blocking: boolean;
}

/** Sign-in addresses are not case sensitive, and pasted lists carry spaces. */
const normaliseEmail = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/** An extension is the digits and nothing else. */
const normaliseExtension = (value: unknown): string =>
  String(value ?? '')
    .replace(/\D+/g, '')
    .trim();

/**
 * A phone number, reduced to its digits. Two people who typed the same number
 * with and without a country code, or with brackets, still typed the same
 * number — comparing the raw strings would miss it.
 */
const normalisePhone = (value: unknown): string =>
  String(value ?? '')
    .replace(/\D+/g, '')
    .trim();

/**
 * What to call somebody in a message. Their name if we have one, their email if
 * not, and a neutral phrase if we have neither — never an empty gap, which
 * reads as a bug rather than as missing information.
 */
export const nameOfPerson = (person: ExistingPersonLike | InviteRowLike | null | undefined): string => {
  const full = [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
  if (full) return full;
  const email = String(person?.email || '').trim();
  return email || 'somebody already on the account';
};

/** Where somebody already sits, ready to drop into a sentence. */
const placeOf = (person: ExistingPersonLike): string => {
  const site = String(person?.site?.name || '').trim();
  return site ? ` at ${site}` : '';
};

export interface InviteDuplicateInput {
  /** The rows currently on the invite form, in the order they appear. */
  rows?: readonly InviteRowLike[] | null;
  /**
   * Everybody already on the account. Pass what the roster already holds rather
   * than fetching again; an empty list simply means only within-the-batch
   * clashes are found.
   */
  roster?: readonly ExistingPersonLike[] | null;
}

/**
 * Every clash in an invite, in row order.
 *
 * Only the *second* and later occurrences of a within-batch duplicate are
 * reported. Flagging both rows reads as two separate problems and leaves an
 * administrator wondering which of the two is wrong, when the answer is always
 * "the one you typed again".
 */
export const findInviteClashes = ({ rows, roster }: InviteDuplicateInput): Clash[] => {
  const list = Array.isArray(rows) ? rows : [];
  const existing = Array.isArray(roster) ? roster : [];
  if (!list.length) return [];

  const takenEmail = new Map<string, ExistingPersonLike>();
  const takenExtension = new Map<string, ExistingPersonLike>();
  existing.forEach((person) => {
    const email = normaliseEmail(person?.email);
    if (email && !takenEmail.has(email)) takenEmail.set(email, person);
    const extension = normaliseExtension(person?.extension);
    if (extension && !takenExtension.has(extension)) takenExtension.set(extension, person);
  });

  const seenEmail = new Map<string, number>();
  const seenExtension = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const found: Clash[] = [];

  list.forEach((row, index) => {
    const email = normaliseEmail(row?.email);
    if (email) {
      const firstAt = seenEmail.get(email);
      if (firstAt === undefined) {
        seenEmail.set(email, index);
        const already = takenEmail.get(email);
        if (already) {
          found.push({
            row: index,
            field: 'email',
            kind: 'email-taken',
            message: `${nameOfPerson(already)} already signs in with ${email}${placeOf(already)}. A person belongs to one location, so they cannot be added a second time — open them on the People page and change their location instead.`,
            blocking: true,
          });
        }
      } else {
        found.push({
          row: index,
          field: 'email',
          kind: 'email-twice',
          message: `${email} is already on row ${firstAt + 1} of this invite. One person, one email address — remove this row or correct the address.`,
          blocking: true,
        });
      }
    }

    const extension = normaliseExtension(row?.extension);
    if (extension) {
      const firstAt = seenExtension.get(extension);
      if (firstAt === undefined) {
        seenExtension.set(extension, index);
        const already = takenExtension.get(extension);
        if (already) {
          found.push({
            row: index,
            field: 'extension',
            kind: 'extension-taken',
            message: `Extension ${extension} already rings ${nameOfPerson(already)}${placeOf(already)}. Two people on one extension means calls reach whichever the platform picks — choose a different one.`,
            blocking: true,
          });
        }
      } else {
        found.push({
          row: index,
          field: 'extension',
          kind: 'extension-twice',
          message: `Extension ${extension} is already on row ${firstAt + 1} of this invite. Give this person a different one.`,
          blocking: true,
        });
      }
    }

    const phone = normalisePhone(row?.phone);
    if (phone) {
      const firstAt = seenPhone.get(phone);
      if (firstAt === undefined) {
        seenPhone.set(phone, index);
      } else {
        found.push({
          row: index,
          field: 'phone',
          kind: 'phone-twice',
          message: `This phone number is already on row ${firstAt + 1} of this invite. It is where the platform reaches this person, so two people cannot share one.`,
          blocking: true,
        });
      }
    }
  });

  return found;
};

/** The clashes on one row, for showing under that row's fields. */
export const clashesForRow = (clashes: readonly Clash[], row: number): Clash[] =>
  (Array.isArray(clashes) ? clashes : []).filter((clash) => clash.row === row);

/** The clash on one field of one row, or null. Used to colour a single input. */
export const clashForField = (
  clashes: readonly Clash[],
  row: number,
  field: ClashField,
): Clash | null =>
  (Array.isArray(clashes) ? clashes : []).find(
    (clash) => clash.row === row && clash.field === field,
  ) || null;

/** Whether anything found must be fixed before the invite can be sent. */
export const blocksInvite = (clashes: readonly Clash[]): boolean =>
  (Array.isArray(clashes) ? clashes : []).some((clash) => clash.blocking);

/**
 * One line for the top of the form. Written to say what to do rather than how
 * many things are wrong, because a count without an instruction just raises the
 * blood pressure.
 */
export const summariseClashes = (clashes: readonly Clash[]): string => {
  const list = Array.isArray(clashes) ? clashes : [];
  if (!list.length) return '';
  const alreadyHere = list.filter(
    (clash) => clash.kind === 'email-taken' || clash.kind === 'extension-taken',
  ).length;
  const repeated = list.length - alreadyHere;

  if (alreadyHere && repeated) {
    return 'Some of these people are already on the account, and some appear twice in this list. Fix the rows marked below before adding anybody.';
  }
  if (alreadyHere) {
    return alreadyHere === 1
      ? 'One of these people is already on the account. Nobody is added twice, so fix the row marked below.'
      : 'Some of these people are already on the account. Nobody is added twice, so fix the rows marked below.';
  }
  return repeated === 1
    ? 'One row repeats something from another row. Fix it before adding anybody.'
    : 'Some rows repeat something from another row. Fix them before adding anybody.';
};

/**
 * Turn the platform's "Email already exists!" into something an administrator
 * can act on.
 *
 * The platform checks that address against every company it hosts, so the
 * answer on its own does not say whether the person is a colleague or a
 * stranger. Checking the roster settles it:
 *
 *   found on the roster — name them, say where they sit, and point at moving
 *   them rather than adding them again;
 *
 *   not on the roster — the address belongs to somebody outside this company,
 *   and no amount of looking will turn them up in your own people list. Say
 *   that plainly, because the alternative is an administrator hunting for a
 *   colleague who was never here.
 *
 * Returns an empty string when the address is not one we were told about, so a
 * caller can fall back to whatever the platform said.
 */
export const explainTakenEmail = (
  email: unknown,
  roster: readonly ExistingPersonLike[] | null | undefined,
): string => {
  const wanted = normaliseEmail(email);
  if (!wanted) return '';
  const here = (Array.isArray(roster) ? roster : []).find(
    (person) => normaliseEmail(person?.email) === wanted,
  );
  if (here) {
    return `${nameOfPerson(here)} already signs in with ${wanted}${placeOf(here)}. A person belongs to one location, so they cannot be added a second time — open them on the People page and change their location instead.`;
  }
  return `${wanted} cannot be used for a new person here. If it is their address, they may already sign in somewhere else; otherwise use a different address.`;
};

export default findInviteClashes;
