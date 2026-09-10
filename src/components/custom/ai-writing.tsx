/* AI Writing — rewrite the draft sitting in a message composer.
 *
 * Deliberately separate from the AI Assist button that already sits in the
 * chat composer. That one opens a conversational agent and needs an agent
 * configured for the company; this one takes the text you have already typed
 * and offers it back rewritten, and works with no setup.
 *
 * THE RULE THIS COMPONENT EXISTS TO KEEP: it never sends anything, and it
 * never touches the draft until someone presses Insert. The suggestion lives
 * in this component's own state; the composer's value is only ever changed
 * through `onInsert`, and only from a click. Cancel, click away, or an error,
 * and whatever was typed is exactly as it was.
 *
 * Kept as its own component rather than inlined into the composer because the
 * chat composer is a four-thousand-line file that other work edits constantly.
 * Mounting this is a one-line change there.
 */

import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  Expand,
  Loader2,
  PenLine,
  Shrink,
  ThumbsDown,
  ThumbsUp,
  Wand2,
  WandSparkles,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, handleAlert } from '@/lib/utils';
import { rateMessageRewrite, rewriteMessageDraft } from '@/services/api';

type RewriteMode = 'polish' | 'formalize' | 'elaborate' | 'shorten' | 'custom';

/* The four presets, named the way this class of feature is named across the
   industry. The one-line descriptions carry the plain-English meaning, so
   "Formalize" never has to be guessed at from the label alone. */
const MODES: {
  mode: Exclude<RewriteMode, 'custom'>;
  label: string;
  blurb: string;
  icon: LucideIcon;
}[] = [
  { mode: 'polish', label: 'Polish', blurb: 'Fix the grammar and wording', icon: Wand2 },
  {
    mode: 'formalize',
    label: 'Formalize',
    blurb: 'Rewrite in a professional tone',
    icon: Building2,
  },
  { mode: 'elaborate', label: 'Elaborate', blurb: 'Expand a short note', icon: Expand },
  { mode: 'shorten', label: 'Shorten', blurb: 'Cut it down, keep the point', icon: Shrink },
];

interface AiWritingProps {
  /* The draft as plain text. The composer may be a rich editor, so the caller
     is responsible for flattening it - only this component's own reading of
     "is there anything to rewrite" depends on it. */
  draftText: string;
  /* Called with the rewritten text when, and only when, Insert is pressed. */
  onInsert: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

const AiWriting = ({ draftText, onInsert, disabled = false, className }: AiWritingProps) => {
  const [open, setOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [instruction, setInstruction] = useState('');
  const [showInstruction, setShowInstruction] = useState(false);
  /* The follow-up box under a suggestion. Separate from `instruction`, which
     is the "Help me write" box on the menu - one refines a result, the other
     starts from the draft, and sharing one field would carry stale text
     between the two. */
  const [refinement, setRefinement] = useState('');
  /* Which mode produced what is on screen, so a second opinion can be asked
     for without retyping, and so feedback records what was rated. */
  const usedMode = useRef<RewriteMode | null>(null);
  const [rated, setRated] = useState<'up' | 'down' | null>(null);

  const hasDraft = draftText.trim().length > 0;

  const reset = () => {
    setSuggestion('');
    setInstruction('');
    setRefinement('');
    setShowInstruction(false);
    setRated(null);
    usedMode.current = null;
  };

  const run = async (mode: RewriteMode) => {
    if (!hasDraft || isWorking) return;
    setIsWorking(true);
    setRated(null);
    try {
      const response: any = await rewriteMessageDraft({
        text: draftText,
        mode,
        ...(mode === 'custom' ? { instruction } : {}),
      });
      const text =
        response?.data?.data?.result?.text ?? response?.data?.result?.text ?? '';
      if (!text) throw new Error('No suggestion came back.');
      usedMode.current = mode;
      setSuggestion(text);
    } catch (error: any) {
      /* The server sends back wording meant for a person - "that message is
         too long to rewrite" - so it is shown as-is rather than replaced with
         something vaguer. */
      handleAlert({
        text:
          error?.response?.data?.message ||
          error?.message ||
          'The rewrite could not be generated. Please try again.',
        type: 'error',
      });
    } finally {
      setIsWorking(false);
    }
  };

  /* Refine what is currently on screen. `run` always works from `draftText`,
     so this is a separate call that passes the suggestion as the source -
     that is what makes a second instruction build on the first result rather
     than starting again from the original draft. */
  const refine = async () => {
    const ask = refinement.trim();
    if (!ask || !suggestion || isWorking) return;
    setIsWorking(true);
    setRated(null);
    try {
      const response: any = await rewriteMessageDraft({
        text: suggestion,
        mode: 'custom',
        instruction: ask,
      });
      const text = response?.data?.data?.result?.text ?? response?.data?.result?.text ?? '';
      if (!text) throw new Error('No suggestion came back.');
      usedMode.current = 'custom';
      setSuggestion(text);
      setRefinement('');
    } catch (error: any) {
      handleAlert({
        text:
          error?.response?.data?.message ||
          error?.message ||
          'The rewrite could not be generated. Please try again.',
        type: 'error',
      });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        /* Closing throws the suggestion away on purpose. Keeping it would mean
           reopening the panel later and being offered a rewrite of a draft
           that has since changed. */
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Rewrite this message with AI"
          title={hasDraft ? 'Rewrite with AI' : 'Type a message first, then rewrite it with AI'}
          className={cn(
            'flex min-h-6 min-w-6 max-h-6 max-w-6 items-center justify-center rounded-2xl text-gray-500 transition-colors hover:text-ucass-active',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            className,
          )}
        >
          <WandSparkles width={18} height={18} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">AI Writing</p>
            {/* Says plainly that this is new and may change. The model can be
                wrong, and a badge is a cheaper way to set that expectation
                than an apology after the fact. */}
            <span className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Alpha
            </span>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            onClick={() => setOpen(false)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {!hasDraft ? (
          <p className="px-3 py-4 text-xs text-gray-500">
            Type your message first, then come back here to have it rewritten.
          </p>
        ) : suggestion ? (
          <div className="flex flex-col gap-2 p-2">
            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
                {suggestion}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Rate this suggestion</span>
                <button
                  type="button"
                  aria-label="Good suggestion"
                  className={cn(
                    'cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100',
                    rated === 'up' && 'text-emerald-600',
                  )}
                  onClick={() => {
                    const next = rated === 'up' ? null : 'up';
                    setRated(next);
                    /* Fire-and-forget: a rating must never block or interrupt
                       what someone was doing, and the server always answers
                       200 regardless of whether the insert succeeds. */
                    if (next) rateMessageRewrite({ rating: next, mode: usedMode.current || 'polish' });
                  }}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Poor suggestion"
                  className={cn(
                    'cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100',
                    rated === 'down' && 'text-red-600',
                  )}
                  onClick={() => {
                    const next = rated === 'down' ? null : 'down';
                    setRated(next);
                    if (next) rateMessageRewrite({ rating: next, mode: usedMode.current || 'polish' });
                  }}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Said plainly, once, where the output is - not buried in a
                  tooltip. A rewrite can invent a detail or change a meaning,
                  and the person pressing Insert is the one accountable for
                  what goes out. */}
              <p className="text-xs text-gray-500">
                This is an AI feature and can make mistakes. Please double-check responses.
              </p>
            </div>

            {/* Refine: feeds the SUGGESTION back in, not the original draft, so
                instructions stack - "make it shorter", then "and warmer" - the
                way a person expects a conversation to work. The gradient
                border is deliberate: it is the one visual cue that this box
                triggers another AI call, not a plain text field. */}
            <div className="rounded-xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400 p-[1.5px]">
              <div className="flex items-center gap-1.5 rounded-xl bg-white px-2 py-1">
                <Input
                  placeholder="Refine this copy..."
                  value={refinement}
                  disabled={isWorking}
                  className="h-8 flex-1 border-0 shadow-none focus-visible:ring-0"
                  onChange={(event) => setRefinement(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && refinement.trim() && !isWorking) {
                      event.preventDefault();
                      refine();
                    }
                  }}
                />
                {refinement.trim() ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={isWorking}
                    onClick={refine}
                  >
                    {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refine'}
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isWorking}
                      onClick={() => setOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={isWorking}
                      onClick={() => {
                        onInsert(suggestion);
                        setOpen(false);
                        reset();
                      }}
                    >
                      Insert
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col p-1">
            {MODES.map(({ mode, label, blurb, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                disabled={isWorking}
                onClick={() => run(mode)}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                <span className="flex flex-col">
                  <span className="text-sm text-gray-900">{label}</span>
                  <span className="text-[11px] text-gray-500">{blurb}</span>
                </span>
              </button>
            ))}

            <div className="mt-1 border-t border-gray-100 pt-1">
              {showInstruction ? (
                <div className="flex flex-col gap-2 p-1.5">
                  <Input
                    autoFocus
                    placeholder="e.g. make this sound more friendly"
                    value={instruction}
                    disabled={isWorking}
                    onChange={(event) => setInstruction(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && instruction.trim()) {
                        event.preventDefault();
                        run('custom');
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={isWorking || !instruction.trim()}
                    onClick={() => run('custom')}
                  >
                    {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Rewrite'}
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() => setShowInstruction(true)}
                  className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                  <span className="flex flex-col">
                    <span className="text-sm text-gray-900">Help me write</span>
                    <span className="text-[11px] text-gray-500">Write your own instruction</span>
                  </span>
                </button>
              )}
            </div>

            {isWorking && (
              <p className="flex items-center gap-1.5 px-2.5 pb-2 pt-1 text-[11px] text-gray-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Rewriting…
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default AiWriting;
