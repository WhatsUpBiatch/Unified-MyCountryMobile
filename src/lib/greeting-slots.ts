/* Which recordings belong in which "pick a recording" slot.
 *
 * Recordings are stored per company in `ivrfiles`, each with a `type`. Two
 * generations of type live side by side and both are real:
 *
 *   * the ORIGINAL kinds - `greeting`, `voicemail`, `prompt` - which is what
 *     anything a customer uploaded before September 2026 still carries, and
 *     what an upload made from a screen that has not been narrowed still
 *     carries today;
 *   * SLOT types - `welcome_greeting`, `on_hold_music`, `ring_tone` - used by
 *     the stock recordings seeded into every tenant, and by uploads made from
 *     a screen that names its slot.
 *
 * Every picker used to ask for `greetingList` (type `greeting`) for all of its
 * slots. That silently stopped showing the stock recordings the moment they
 * were seeded as `welcome_greeting` and `on_hold_music`: the Welcome dropdown
 * on the per-extension and queue screens simply went empty, with the toggle
 * on and nothing to choose. This module is the one place that knows the
 * mapping, so a new slot or a new type cannot quietly diverge across the six
 * screens that offer recordings.
 *
 * Deliberately INCLUSIVE. A slot returns its own typed recordings first, then
 * the generic pool, so the stock recordings appear without anything a customer
 * already had disappearing. Company > Greetings is the exception and stays
 * strict - see the comment in its own file for why the three company slots
 * must not share.
 */

import type { GreetingItem } from '@/hooks/common';
import { HIDDEN_RECORDING_UUIDS } from '@/lib/utils';

/* Slot name (as each screen spells it) -> the types that belong in it.
 *
 * The names differ per screen for historical reasons: the queue calls its
 * hold slot `hold`, the extension screen calls it `on_hold_music`. Both are
 * listed rather than renamed, because the slot name is also the form key that
 * has already been saved into people's records. */
const SLOT_TYPES: Record<string, string[]> = {
  // Welcome, however each screen spells it.
  welcome: ['welcome_greeting'],
  welcome_greeting: ['welcome_greeting'],

  // Hold music.
  hold: ['on_hold_music'],
  on_hold: ['on_hold_music'],
  on_hold_music: ['on_hold_music'],
  // A queue's "waiting" and "delay" are played to somebody on hold, so they
  // draw from the same pool.
  waiting: ['on_hold_music'],
  delay: ['on_hold_music'],

  ring_tone: ['ring_tone'],

  voicemail: ['voicemail'],

  // IVR announcements.
  menu: ['prompt'],
  prompt: ['prompt'],
  no_agent_available: ['prompt'],
  all_agent_busy: ['prompt'],
};

/* The pool a slot falls back to once its own recordings are listed. Voicemail
   and prompt slots keep to their own kind - offering hold music as a voicemail
   greeting helps nobody - while the rest fall back to `greeting`, which is
   what an ordinary upload is filed as. */
const FALLBACK_TYPE: Record<string, string> = {
  voicemail: 'voicemail',
  menu: 'prompt',
  prompt: 'prompt',
  no_agent_available: 'prompt',
  all_agent_busy: 'prompt',
};

/**
 * Every recording that may be chosen for `slot`, its own kind first.
 *
 * `all` is the unfiltered library (`allGreetings` from useGetGreetings), not
 * one of the pre-filtered lists - those are filtered on the original types and
 * so cannot see a slot-typed recording at all.
 */
export const greetingsForSlot = (all: GreetingItem[], slot: string): GreetingItem[] => {
  const library = Array.isArray(all) ? all : [];
  const ownTypes = SLOT_TYPES[slot] ?? [];
  const fallbackType = FALLBACK_TYPE[slot] ?? 'greeting';

  /* The same hidden list Company > Greetings applies. Without it the two
     screens disagreed: a recording taken out of the company picker still
     showed up on the per-extension one, so "the defaults" meant something
     different depending on where you stood. Hidden rows keep playing wherever
     they are already chosen - this only takes them out of the lists. */
  const visible = library.filter((item) => !HIDDEN_RECORDING_UUIDS.includes(item?.uuid ?? ''));

  const own = visible.filter((item) => ownTypes.includes(String(item?.type ?? '')));
  const rest = visible.filter(
    (item) =>
      String(item?.type ?? '') === fallbackType &&
      !own.some((chosen) => chosen.uuid === item.uuid),
  );

  return [...own, ...rest];
};

/**
 * The `optionsData` map a picker screen needs, built from its own slot names.
 * Saves every screen repeating the same object with the same mistake in it.
 */
export const greetingOptionsForSlots = (
  all: GreetingItem[],
  slots: string[],
): Record<string, GreetingItem[]> =>
  slots.reduce<Record<string, GreetingItem[]>>((acc, slot) => {
    acc[slot] = greetingsForSlot(all, slot);
    return acc;
  }, {});
