/* Seeding a value and locking a value are two different jobs. One flag was doing both.
 *
 * Every setting on the company record (see src/lib/company-defaults.ts) carries a
 * single `override` boolean, and two parts of the product read it with opposite
 * meanings:
 *
 *   - As a LOCK. src/lib/company-policy.ts turns it into `allows(field)`, and
 *     src/components/common-settings/index.tsx disables the control when that is
 *     false. Here `override: true` reads as "this person MAY change it themselves".
 *   - As a COPY INSTRUCTION. `seSettingsData` in
 *     src/pages/admin-settings/people/update-forwarding/index.tsx copies the
 *     company value onto the person only when the flag is on. Here `override: true`
 *     reads as "PUT this company value on the person".
 *
 * So the flag runs backwards against itself. Left off — which is how an admin reads
 * "lock this for everyone" — the person gets none of the company value AND cannot set
 * it themselves: the worst of both. Turned on, the value lands but the lock is gone.
 * "Everyone gets this and nobody may change it" — the most common thing an admin
 * actually wants, and the only sane setting for call recording in a regulated tenant —
 * cannot be said at all.
 *
 * established systems keeps these apart deliberately: a template seeds values onto a person, a
 * User Settings Policy locks them. other established systems does the same with its assignable policies.
 * This module is that separation, expressed as two independent booleans per rule:
 *
 *   apply   — put this company value onto the person
 *   locked  — the person may not change it themselves
 *
 *   apply / locked  →  everyone gets it and it stays that way   (impossible until now)
 *   apply / open    →  a starting point people may change       (old `override: true`)
 *   skip  / locked  →  hands off; whatever they have is frozen  (old `override: false`)
 *   skip  / open    →  the company has no opinion at all        (old flag ABSENT)
 *
 * The flags live beside `override` in the same rule node — `recording.apply`,
 * `recording.locked`, `recording.override` — so no migration is needed and a record
 * can be understood by old and new readers at the same time. Nothing here is a React
 * hook or does any I/O; it is pure reading and writing of the settings object, so it
 * can be used from a component, a hook, or a form submit handler alike.
 *
 * HOW A RECORD IS READ, in full. New keys win whenever they are present; the old flag
 * is consulted only for a half that is missing. This table is shared with the server
 * copy in default-api (src/helpers/companyRuleFlags.ts) and the two must not drift:
 *
 *   stored                                  apply   locked
 *   ------------------------------------    -----   ------
 *   apply / locked present (either value)   as stored, each on its own
 *   override: true                          true    false
 *   override: false (explicitly stored)     false   true
 *   override absent / undefined / null      false   false
 *   no company record at all                false   false
 *
 * The last two rows are the same on purpose, and the ABSENT row is the one that was
 * decided. It used to read as locked, so the moment the company record came into
 * being for any reason — an admin saving a holiday, say — every governed setting on
 * every person's phone locked at once, and stayed locked until somebody found each
 * switch. A flag nobody has set means the company has said nothing, and a company
 * that has said nothing does not lock anything. Only a `false` an admin actually
 * stored is a lock.
 */

import { POLICY_FIELDS, type PolicyField } from '@/lib/company-policy';

/* Re-exported rather than restated: the paths live in POLICY_FIELDS and having them
   written down twice is how the two copies quietly drift apart. */
export { POLICY_FIELDS };
export type { PolicyField };

const LEGACY_FLAG_KEY = 'override';
const APPLY_KEY = 'apply';
const LOCKED_KEY = 'locked';

export interface RuleFlags {
  /* Put the company's value for this setting onto the person. */
  apply: boolean;
  /* The person may not change this setting on their own phone. */
  locked: boolean;
}

export interface RuleFlagsRead extends RuleFlags {
  /* True when the record carries only the old `override` flag, so both values above
     were inferred rather than read. Useful for a "not reviewed since the split" hint
     in the admin UI; the flags themselves are safe to act on either way. */
  isLegacy: boolean;
}

/* Either a POLICY_FIELDS key ('recording') or a path into the settings object, with or
   without the trailing flag ('recording', 'recording.override'). Paths are accepted
   because the same one-flag-two-meanings problem exists on the greetings record —
   `greetings.welcome_greeting.override` and friends — which POLICY_FIELDS does not
   cover, and this model works there unchanged. */
export type RuleFieldRef = PolicyField | string;

/* Exported so a screen holding a form can pull the one node `writeRuleFlags` changed
   back out and set just that node, rather than replacing its whole settings object. */
export const readPath = (source: any, path: string): any =>
  path.split('.').reduce((value, key) => (value == null ? value : value[key]), source);

/* Clones only the nodes along the path, so the caller's object is never touched and
   everything off the path stays shared. A non-object on the way down is replaced with
   an object: there is nowhere else to hang the rest of the path. */
const setPath = (source: any, path: string, value: any): any => {
  const [head, ...rest] = path.split('.');
  const base: any = Array.isArray(source)
    ? [...source]
    : source && typeof source === 'object'
      ? { ...source }
      : {};
  base[head] = rest.length ? setPath(source?.[head], rest.join('.'), value) : value;
  return base;
};

const stripLegacyFlag = (path: string): string =>
  path.endsWith(`.${LEGACY_FLAG_KEY}`) ? path.slice(0, -(LEGACY_FLAG_KEY.length + 1)) : path;

/* POLICY_FIELDS points at the flag; the flags live on the node that holds it, so the
   node path is that with the trailing `.override` taken off. */
export const RULE_NODE_PATHS = Object.fromEntries(
  Object.entries(POLICY_FIELDS).map(([field, path]) => [field, stripLegacyFlag(path)]),
) as Record<PolicyField, string>;

export const RULE_FIELDS = Object.keys(POLICY_FIELDS) as PolicyField[];

/* `hasOwnProperty` rather than `in`: a caller passing a raw path of "constructor" or
   "toString" would otherwise match Object.prototype and read the wrong node. */
export const ruleNodePath = (field: RuleFieldRef): string =>
  Object.prototype.hasOwnProperty.call(RULE_NODE_PATHS, field)
    ? RULE_NODE_PATHS[field as PolicyField]
    : stripLegacyFlag(field);

/* WHAT AN OLD RECORD MEANS.
 *
 * `override: true` — the value was copied onto people and the control stayed enabled:
 * apply, not locked. `override: false` — an admin turned the switch off: nothing
 * copied, control disabled: skip, locked. Both are kept exactly as they were.
 *
 * The flag being ABSENT used to read the same as `false`, because the old readers
 * tested `=== true`. That is the case this function now reads differently: absent
 * means the company never said anything about this setting, so nothing is copied and
 * nothing is locked. The decision and the reason are in the header. A value that is
 * not a boolean at all — null from a JSON column, a string from a hand edit — is
 * treated as absent for the same reason: nobody chose it.
 */
const legacyFlags = (override: unknown): RuleFlags => {
  if (override === true) return { apply: true, locked: false };
  if (override === false) return { apply: false, locked: true };
  return { apply: false, locked: false };
};

/* WHAT A NEW RECORD WRITES BACK INTO THE OLD FLAG.
 *
 * The old readers keep reading `override` until every call site is migrated, so it has
 * to stay populated and it has to stay sensible. Two of the four combinations map
 * exactly (apply+open → true, skip+locked → false) and round-trip byte-identically.
 * The other two have to lose a half, and `override` mirrors `apply` for both.
 *
 * The case that matters is apply+locked, the one this whole model exists for. Writing
 * `true` means an old reader applies the value and misses the lock. Writing `false`
 * means it holds the lock and never applies the value — so the setting the admin
 * insisted on for everyone is simply absent from every phone provisioned through an
 * unmigrated path. Take call recording: `true` leaves recording on for everyone with a
 * switch a determined person could flip; `false` leaves recording off for everyone.
 * The first failure needs a deliberate act, is visible in the person's own settings,
 * and leaves an audit trail. The second is silent, universal, and is precisely the bug
 * being fixed. `true` is the safer half to keep.
 *
 * skip+open ("no opinion") follows the same rule and lands on `false`. That is the
 * conservative direction there too: to an old reader `false` only over-disables a
 * control in the UI — which is what those readers always showed for an untouched
 * field — while `true` would seed an uncurated company value onto real phones.
 * `apply` is the half that changes data, so `apply` is the half `override` carries.
 *
 * One consequence to be aware of: this module's own reader treats a stored `false`
 * as a lock and only an ABSENT flag as "no opinion". So skip+open round-trips only
 * while `apply` and `locked` travel with the record. Anything that copies a rule node
 * and keeps just `override` — a form helper rebuilding the node field by field — turns
 * skip+open into skip+locked on the way back. The cure is to carry the two new keys,
 * never to write a different `override`: the server reads the same table.
 */
export const legacyOverrideFor = ({ apply }: RuleFlags): boolean => apply;

/* A settings object of null/undefined means no company record was found at all, which
 * `useCompanyPolicy` already treats as "the company governs nothing" — everything
 * editable, nothing copied. That is skip+open, and it is reported as not-legacy
 * because there is no old flag involved, only an absent record.
 */
export const readRuleFlags = (settings: any, field: RuleFieldRef): RuleFlagsRead => {
  if (settings == null) return { apply: false, locked: false, isLegacy: false };

  const nodePath = ruleNodePath(field);
  const node = readPath(settings, nodePath);

  /* `node` can be a bare boolean: `transcription` and `ai_call_monitoring` were plain
     booleans before they grew flags and both shapes are still in the data. Indexing a
     boolean is undefined rather than an error, so it falls through to the legacy read. */
  const apply = node?.[APPLY_KEY];
  const locked = node?.[LOCKED_KEY];
  const explicitApply = typeof apply === 'boolean' ? apply : null;
  const explicitLocked = typeof locked === 'boolean' ? locked : null;

  const fallback = legacyFlags(node?.[LEGACY_FLAG_KEY]);

  return {
    apply: explicitApply ?? fallback.apply,
    locked: explicitLocked ?? fallback.locked,
    /* Only when neither new flag is there — including a node with no flags at all,
       which has never been looked at since the split either. A half-written node —
       one flag present, from an interrupted save or a hand edit — is not legacy; the
       flag that is there is honoured and the missing one comes from `override`. */
    isLegacy: explicitApply === null && explicitLocked === null,
  };
};

/* Returns a new settings object; the input is never mutated. Both new flags and a
 * consistent `override` are written together, so a record saved here still behaves
 * correctly for the readers that only understand the old flag.
 */
export const writeRuleFlags = (
  settings: any,
  field: RuleFieldRef,
  { apply, locked }: RuleFlags,
): any => {
  const nodePath = ruleNodePath(field);
  const current = readPath(settings, nodePath);

  /* A bare boolean node is kept as its `enabled` value rather than thrown away —
     dropping it would read as "switched off" in common-settings, which flips a real
     setting on a person's phone as a side effect of an admin editing a flag. */
  const node: any =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...current }
      : current == null
        ? {}
        : { enabled: current };

  node[APPLY_KEY] = apply;
  node[LOCKED_KEY] = locked;
  node[LEGACY_FLAG_KEY] = legacyOverrideFor({ apply, locked });

  return setPath(settings, nodePath, node);
};

/* One line of plain English per combination, for the admin screens. The wording says
   what happens to a person, not what the flags are called — an admin choosing a rule
   should not have to hold the model in their head to predict the result. */
export const describeRuleFlags = ({ apply, locked }: RuleFlags): string => {
  if (apply && locked) return 'Everyone gets the company setting and cannot change it.';
  if (apply) return 'Everyone starts with the company setting and may change it.';
  if (locked) return 'The company setting is not applied, and people cannot change theirs.';
  return 'The company has no rule here. People keep and may change their own setting.';
};
