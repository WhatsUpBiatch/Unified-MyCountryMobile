/* Real-time reply suggestions, shown as a popup directly above the composer.
 *
 * Companion to ai-reply-suggestions.tsx, not a replacement: that one is a
 * panel you deliberately open from a button, this one comes to you while you
 * are about to reply. Both call the same endpoint.
 *
 * TWO MODES, DECIDED BY WHETHER ANYTHING IS TYPED:
 *   nothing typed  - offers openers: five-plus ways to answer what was just
 *                    said, varying by intent.
 *   mid-sentence   - offers endings, every one of which BEGINS with what has
 *                    already been typed. Clicking one extends the sentence
 *                    rather than throwing the words away.
 *
 * WHY THE DEBOUNCE AND THE GUARDS ARE THE IMPORTANT PART. Each refresh is a
 * real LLM call that the brand pays for. Firing one per keystroke would be
 * slow, expensive, and would flicker a new set of options under someone's
 * cursor while they were reading the last set. So a request only goes out
 * once typing has actually paused, only when the text has moved on enough to
 * plausibly change the answer, and never for a draft so short it carries no
 * intent yet.
 *
 * IT NEVER SENDS. Clicking fills the composer. The person still reads it,
 * edits it if they want, and presses send themselves.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { suggestReplies } from '@/services/api';

type ConversationMessage = { sender: string; text: string };

/* Long enough that a normal typing rhythm does not trigger it, short enough
   that a real pause feels answered rather than laggy. */
const TYPING_IDLE_MS = 900;
/* Below this a draft is "th" or "ok" - not enough intent for a continuation
   to be anything but a guess. */
const MIN_DRAFT_CHARS = 4;
/* A refresh mid-sentence is only worth its cost once the text has genuinely
   moved on; single characters rarely change what a sensible ending is. */
const MIN_DRAFT_DELTA = 3;

/* Far enough that a dismissal is not undone by a stray keystroke, close
   enough that carrying on writing brings help back without being asked. */
const REDISPLAY_AFTER_CHARS = 12;

interface AiInlineReplySuggestionsProps {
  messages: ConversationMessage[];
  /* Which conversation this is. Required, and not decorative: message count
     alone cannot tell two chats apart - switching between two chats that both
     have five messages changes nothing observable, so without this the panel
     kept showing the previous conversation's state and never refetched. */
  chatId?: string;
  /* The live draft, already flattened to plain text by the composer. */
  draftText: string;
  onSelect: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

const AiInlineReplySuggestions = ({
  messages,
  chatId,
  draftText,
  onSelect,
  disabled = false,
  className,
}: AiInlineReplySuggestionsProps) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  /* Where the draft stood when the panel was closed, or null if it is open.
     Dismissal used to be a plain boolean cleared only by a new message, which
     meant closing the panel while typing silenced it for the rest of the
     conversation. Holding the draft instead lets it come back once the person
     has genuinely written on - closed for this thought, not for good. */
  const [dismissedAtDraft, setDismissedAtDraft] = useState<string | null>(null);

  /* What the shown suggestions were generated from, so a refresh only happens
     when one of those inputs has actually changed. */
  const generatedForDraft = useRef<string | null>(null);
  const generatedForCount = useRef(-1);
  /* Guards against a slow response overwriting a newer one. */
  const requestSeq = useRef(0);

  const trimmedDraft = draftText.trim();
  const lastMessage = messages.length ? messages[messages.length - 1] : null;

  /* Two different questions, and conflating them was a bug.
   *
   * Unprompted openers are only welcome when the other person spoke last -
   * offering "here are five replies" straight after your own message is
   * nagging, and there is nothing to reply to.
   *
   * Help finishing a sentence is welcome whenever you are actually typing:
   * following up your own message, or opening a brand new conversation that
   * has no history at all. Requiring the other person to have spoken meant
   * the feature stayed invisible in exactly those cases. */
  const canOfferOpeners = Boolean(lastMessage) && lastMessage?.sender !== 'You';
  const isTyping = trimmedDraft.length >= MIN_DRAFT_CHARS;

  const fetchSuggestions = useCallback(
    async (draft: string) => {
      /* An empty conversation is still workable when there is a draft - the
         model is finishing a sentence, not answering anybody. */
      if (!messages.length && !draft) return;
      const seq = ++requestSeq.current;
      setIsWorking(true);
      try {
        const response: any = await suggestReplies({
          messages,
          ...(draft ? { draft } : {}),
        });
        /* A newer request started while this one was in flight - its answer
           is the current one, so this stale reply is dropped. */
        if (seq !== requestSeq.current) return;

        const list =
          response?.data?.data?.result?.suggestions ?? response?.data?.result?.suggestions ?? [];
        if (Array.isArray(list) && list.length) {
          setSuggestions(list);
          generatedForDraft.current = draft;
          generatedForCount.current = messages.length;
        }
      } catch {
        if (seq !== requestSeq.current) return;
        /* Quiet on failure. This panel appears uninvited, so it must not
           interrupt with an error for something nobody asked for - the
           deliberate button in the composer surfaces errors properly. */
        setSuggestions([]);
      } finally {
        if (seq === requestSeq.current) setIsWorking(false);
      }
    },
    [messages],
  );

  /* Switching conversations wipes everything, including a dismissal: a panel
     closed in one chat has no business staying closed in the next. Keyed on
     chatId rather than message count, because two chats can easily hold the
     same number of messages and be completely different conversations. */
  useEffect(() => {
    setSuggestions([]);
    setDismissedAtDraft(null);
    generatedForDraft.current = null;
    generatedForCount.current = -1;
    /* Invalidates any request still in flight for the previous chat, so its
       answer cannot land in this one. */
    requestSeq.current += 1;
    setIsWorking(false);
  }, [chatId]);

  /* New message arrived: clear what is on screen (it answers the previous
     turn), and reopen the panel - a fresh message is exactly when help is
     wanted again, even if it was closed a moment ago. */
  useEffect(() => {
    if (messages.length !== generatedForCount.current) {
      setSuggestions([]);
      generatedForDraft.current = null;
      setDismissedAtDraft(null);
    }
  }, [messages.length]);

  /* A dismissal lapses once the draft has genuinely moved on, so closing the
     panel silences this thought rather than the whole conversation. */
  const isDismissed =
    dismissedAtDraft !== null &&
    Math.abs(trimmedDraft.length - dismissedAtDraft.length) < REDISPLAY_AFTER_CHARS;

  useEffect(() => {
    if (disabled || isDismissed) return;

    const shouldOfferOpeners =
      canOfferOpeners &&
      !trimmedDraft &&
      generatedForDraft.current !== '' &&
      generatedForCount.current !== messages.length;

    const previous = generatedForDraft.current;
    const movedOnEnough =
      previous === null ||
      previous === '' ||
      Math.abs(trimmedDraft.length - previous.length) >= MIN_DRAFT_DELTA ||
      !trimmedDraft.toLowerCase().startsWith(previous.toLowerCase());

    /* Deliberately NOT gated on who spoke last - see canOfferOpeners above. */
    const shouldOfferEndings = isTyping && trimmedDraft !== previous && movedOnEnough;

    if (!shouldOfferOpeners && !shouldOfferEndings) return;

    const timer = setTimeout(
      () => fetchSuggestions(shouldOfferOpeners ? '' : trimmedDraft),
      /* Openers are wanted the moment the message lands; endings wait for
         typing to actually stop. */
      shouldOfferOpeners ? 250 : TYPING_IDLE_MS,
    );
    return () => clearTimeout(timer);
  }, [
    trimmedDraft,
    isTyping,
    messages.length,
    canOfferOpeners,
    disabled,
    isDismissed,
    fetchSuggestions,
  ]);

  /* Escape closes it, the way any transient overlay should. */
  useEffect(() => {
    if (!suggestions.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDismissedAtDraft(trimmedDraft);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [suggestions.length, trimmedDraft]);

  if (disabled || isDismissed) return null;
  /* Nothing fetched and nothing in flight means there is nothing to show -
     which covers "your own message was last and you have not started
     typing", without blocking the typing case. */
  if (!suggestions.length && !isWorking) return null;

  return (
    <div
      className={cn(
        'mb-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-gray-700">
            {trimmedDraft ? 'Ways to finish this' : 'Suggested replies'}
          </span>
          {isWorking && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
        </div>
        <button
          type="button"
          aria-label="Hide suggestions"
          className="cursor-pointer rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          onClick={() => setDismissedAtDraft(trimmedDraft)}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {suggestions.length ? (
        <div className="flex max-h-52 flex-col overflow-y-auto p-1.5">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${index}-${suggestion.slice(0, 24)}`}
              type="button"
              onClick={() => {
                onSelect(suggestion);
                /* Closed against the text just inserted, not the old draft -
                   otherwise the inserted suggestion instantly reads as "moved
                   on a lot" and the panel reopens over its own result. */
                setDismissedAtDraft(suggestion.trim());
              }}
              className="cursor-pointer rounded-lg px-2.5 py-2 text-left text-sm leading-snug text-gray-800 transition-colors hover:bg-primary/5 hover:text-gray-900"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : (
        <p className="px-3 py-2.5 text-xs text-gray-500">Reading the conversation…</p>
      )}
    </div>
  );
};

export default AiInlineReplySuggestions;
