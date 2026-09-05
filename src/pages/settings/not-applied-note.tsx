/* The honest badges for a personal setting: what the switch reads, and what it
 * does not read yet.
 *
 * The My Account pages save into the person's own record. Since 3 Sep 2026 the
 * live call path reads part of it for a call dialled straight to the person's
 * extension: forward-all, do not disturb, their own working hours with the
 * closed-hours destination, their ring time, what happens after ringing (for a
 * voicemail, extension or hang-up destination) and their voicemail greeting.
 * It still reads none of it for recording, transcription, AI monitoring,
 * display number, the welcome / hold / ring-tone greetings, or per-device
 * on/off and ring order - those come from the company's rule or from the
 * number. And a call that arrives through a queue or a menu follows that
 * queue's or menu's own rules, not the person's.
 *
 * A card with no badge reads as live, and a card with the wrong badge is
 * worse, because somebody believes it. So each page says which is which.
 *
 * The cards on these pages come from shared editors that carry no badge of
 * their own on a personal page (the queue editor is the only one that does),
 * so the note sits on the page itself, above or beside the cards it is about.
 *
 * Styling is the existing `.mcm-notsaved` amber note from index.css, the
 * `.mcm-callsummary` green strip and the `.mcm-setcard-badge` pill from the
 * setting-card styles - the same shapes the rest of the console uses for "in
 * force" and "not in force" - so nothing new has to be learnt to read it.
 * When one of these settings goes live, move it from the amber note to the
 * green one in the same change: a badge that outlives the fix is as
 * misleading as none.
 */

import { ReactNode } from 'react';

import '@/components/mcm/mcm-page.css';

/* One sentence, used word for word wherever a personal copy of a company
   rule is stored and not read. Kept in one place so every page says it the
   same way. */
export const NOT_APPLIED_WORDING =
  "Saved, not applied yet. Your company's rule is what the switch follows today.";

/* One sentence, used word for word wherever a personal setting is read by the
   switch for calls dialled straight to the person. Queue and menu calls are
   the exception every time, so the sentence carries it. */
export const DIRECT_CALLS_ONLY_WORDING =
  "Applies to calls straight to you. Calls through a queue or a menu follow that queue's or menu's own hours.";

export const NotAppliedNote = ({ title, children }: { title: ReactNode; children?: ReactNode }) => (
  <div className="mcm-notsaved" role="status">
    <strong>{title}</strong>
    {children ? <span>{children}</span> : null}
  </div>
);

/* The green counterpart: a strip for the settings on a page the switch does
   read. Same shape as the "What works today" strip on My Phone. */
export const LiveNote = ({ title, children }: { title: ReactNode; children?: ReactNode }) => (
  <div className="mcm-callsummary" role="status">
    <span className="mcm-callsummary-l">{title}</span>
    {children ? <p>{children}</p> : null}
  </div>
);

/* A small amber pill for a heading. Amber is the console's colour for "on its
   way", so the pill reads the same as the coming-soon flag on the setting cards. */
export const NotAppliedFlag = ({ children }: { children: ReactNode }) => (
  <span className="mcm-setrow-flag">{children}</span>
);

/* A small green pill for a heading: the same "Active" pill a setting card
   wears, so a person who has learnt one has learnt the other. */
export const LiveFlag = ({ children }: { children: ReactNode }) => (
  <span className="mcm-setcard-badge is-on">{children}</span>
);
