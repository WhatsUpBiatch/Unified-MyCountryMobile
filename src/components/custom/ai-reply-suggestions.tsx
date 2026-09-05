/* AI Reply Suggestions — offers replies you could send next.
 *
 * The third AI piece in the composer, and the one that produces new text from
 * history: AI Writing rewrites a draft you typed, Conversation Insights reads
 * history to explain it, this reads history to propose what comes next.
 *
 * WHY A PANEL AND NOT A ROW OF CHIPS. Five contextual replies are full
 * sentences, not "Yes"/"No"/"Thanks". Laid out as a row they truncate to
 * uselessness, so they are stacked in a popover where each one is readable in
 * full before it is chosen.
 *
 * IT NEVER SENDS. Choosing a suggestion fills the composer and closes the
 * panel. The person still reads it, edits it if they want, and presses send
 * themselves - so a wrong suggestion costs a glance, never a sent message.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquareReply, RefreshCw, X } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, handleAlert } from '@/lib/utils';
import { suggestReplies } from '@/services/api';

type ConversationMessage = { sender: string; text: string };

interface AiReplySuggestionsProps {
  /* Sender-resolved transcript of the open conversation. The caller flattens
     it, because only the caller knows how to turn its rich message format
     into text and which name belongs to each participant. */
  messages: ConversationMessage[];
  /* Called with the chosen reply. The caller decides how to put it in the
     composer - this component never touches the editor itself. */
  onSelect: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

const AiReplySuggestions = ({
  messages,
  onSelect,
  disabled = false,
  className,
}: AiReplySuggestionsProps) => {
  const [open, setOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  /* How many messages the shown suggestions were generated from. If the
     conversation moves on while the panel is open, the suggestions are stale
     and saying so is better than quietly offering a reply to a message that
     has already been answered. */
  const generatedAtCount = useRef(0);

  const hasMessages = messages.length > 0;
  const isStale = suggestions.length > 0 && messages.length !== generatedAtCount.current;

  const run = async () => {
    if (!hasMessages || isWorking) return;
    setIsWorking(true);
    try {
      const response: any = await suggestReplies({ messages });
      const list =
        response?.data?.data?.result?.suggestions ?? response?.data?.result?.suggestions ?? [];
      if (!Array.isArray(list) || !list.length) throw new Error('No suggestions came back.');
      setSuggestions(list);
      generatedAtCount.current = messages.length;
    } catch (error: any) {
      handleAlert({
        text:
          error?.response?.data?.message ||
          error?.message ||
          'Reply suggestions could not be generated. Please try again.',
        type: 'error',
      });
      setOpen(false);
    } finally {
      setIsWorking(false);
    }
  };

  /* Fetch on open rather than behind a button: the whole point is that the
     options are already waiting when someone is about to reply. */
  useEffect(() => {
    if (open && !suggestions.length && !isWorking) run();
  }, [open]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        /* Dropped on close so reopening reflects the conversation as it is
           now - the same rule the other AI panels follow. */
        if (!next) {
          setSuggestions([]);
          generatedAtCount.current = 0;
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || !hasMessages}
          aria-label="Suggest a reply with AI"
          title={hasMessages ? 'Suggest a reply' : 'No messages to reply to yet'}
          className={cn(
            'flex min-h-6 min-w-6 max-h-6 max-w-6 items-center justify-center rounded-2xl text-gray-500 transition-colors hover:text-ucass-active',
            disabled || !hasMessages ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            className,
          )}
        >
          <MessageSquareReply width={18} height={18} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" side="top" className="w-[24rem] p-0">
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">Suggested Replies</p>
            <span className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Alpha
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Get new suggestions"
              title="Get new suggestions"
              disabled={isWorking}
              className="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={run}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isWorking && 'animate-spin')} />
            </button>
            <button
              type="button"
              aria-label="Close"
              className="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              onClick={() => setOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {isWorking && !suggestions.length ? (
          <p className="flex items-center gap-2 px-3 py-4 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reading the conversation…
          </p>
        ) : suggestions.length ? (
          <div className="flex flex-col gap-2 p-2">
            {isStale && (
              <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
                New messages have arrived. Refresh for up-to-date suggestions.
              </p>
            )}

            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  type="button"
                  disabled={isWorking}
                  onClick={() => {
                    onSelect(suggestion);
                    setOpen(false);
                  }}
                  className="cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm leading-relaxed text-gray-900 transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {/* Same wording as the other AI surfaces, on purpose. A reply is
                put in the box, never sent, but the person pressing send is
                the one accountable for what it says. */}
            <p className="px-1 text-xs text-gray-500">
              This is an AI feature and can make mistakes. Please double-check responses.
            </p>
          </div>
        ) : (
          <p className="px-3 py-4 text-xs text-gray-500">
            There are no messages in this conversation yet.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default AiReplySuggestions;
