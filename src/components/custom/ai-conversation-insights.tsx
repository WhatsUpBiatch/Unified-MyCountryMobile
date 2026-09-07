/* AI Conversation Insights — summarize an open chat, and answer questions
 * about it.
 *
 * Separate from AI Writing on purpose: that one rewrites a draft and never
 * reads message history; this one reads message history and never touches
 * the draft. Different data, different privacy shape, so a different
 * component keeps the two from getting tangled.
 *
 * PRIVACY NOTE THAT MATTERS HERE: unlike AI Writing's feedback, this feature
 * genuinely sends conversation content to the brand's configured model - a
 * summary has no other way to work. Nothing is stored on our side; the
 * transcript lives only in this component's own state and in the request
 * body of each call.
 */

import { useState } from 'react';
import { Loader2, MessagesSquare, Send, Sparkles, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, handleAlert } from '@/lib/utils';
import { askAboutConversation, summarizeConversation } from '@/services/api';

type ConversationMessage = { sender: string; text: string };
type QaTurn = { question: string; answer: string };

interface AiConversationInsightsProps {
  messages: ConversationMessage[];
  disabled?: boolean;
  className?: string;
}

const AiConversationInsights = ({
  messages,
  disabled = false,
  className,
}: AiConversationInsightsProps) => {
  const [open, setOpen] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [summary, setSummary] = useState('');
  const [question, setQuestion] = useState('');
  const [qaHistory, setQaHistory] = useState<QaTurn[]>([]);

  const hasMessages = messages.length > 0;
  const isBusy = isSummarizing || isAsking;

  const reset = () => {
    setSummary('');
    setQuestion('');
    setQaHistory([]);
  };

  const runSummarize = async () => {
    if (!hasMessages || isBusy) return;
    setIsSummarizing(true);
    try {
      const response: any = await summarizeConversation({ messages });
      const text = response?.data?.data?.result?.text ?? response?.data?.result?.text ?? '';
      if (!text) throw new Error('No summary came back.');
      setSummary(text);
    } catch (error: any) {
      handleAlert({
        text:
          error?.response?.data?.message ||
          error?.message ||
          'The summary could not be generated. Please try again.',
        type: 'error',
      });
    } finally {
      setIsSummarizing(false);
    }
  };

  const runAsk = async () => {
    const ask = question.trim();
    if (!ask || !hasMessages || isBusy) return;
    setIsAsking(true);
    try {
      const response: any = await askAboutConversation({ messages, question: ask });
      const text = response?.data?.data?.result?.text ?? response?.data?.result?.text ?? '';
      if (!text) throw new Error('No answer came back.');
      setQaHistory((prev) => [...prev, { question: ask, answer: text }]);
      setQuestion('');
    } catch (error: any) {
      handleAlert({
        text:
          error?.response?.data?.message ||
          error?.message ||
          'The answer could not be generated. Please try again.',
        type: 'error',
      });
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        /* Closing throws the summary and Q&A away on purpose - reopening
           should reflect the conversation as it is now, not a stale read. */
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Summarize this conversation with AI"
          title={
            hasMessages ? 'Summarize & ask AI' : 'No messages in this conversation yet'
          }
          className={cn(
            'flex min-h-6 min-w-6 max-h-6 max-w-6 items-center justify-center rounded-2xl text-gray-500 transition-colors hover:text-ucass-active',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            className,
          )}
        >
          <MessagesSquare width={18} height={18} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[24rem] p-0">
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">Conversation Insights</p>
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

        {!hasMessages ? (
          <p className="px-3 py-4 text-xs text-gray-500">
            There are no messages in this conversation yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2 p-2">
            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              {!summary ? (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={runSummarize}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-white py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSummarizing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Summarizing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      Summarize this conversation
                    </>
                  )}
                </button>
              ) : (
                <div className="max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
                  {summary}
                </div>
              )}

              {qaHistory.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-gray-200 pt-2">
                  {qaHistory.map((turn, index) => (
                    <div key={index} className="flex flex-col gap-1">
                      <p className="text-xs font-medium text-gray-700">{turn.question}</p>
                      <p className="text-sm leading-relaxed text-gray-900">{turn.answer}</p>
                    </div>
                  ))}
                </div>
              )}

              {summary && (
                <p className="text-xs text-gray-500">
                  This is an AI feature and can make mistakes. Please double-check responses.
                </p>
              )}
            </div>

            {/* Gradient border marks this as the box that triggers another AI
                call, matching the same cue used in AI Writing's refine box. */}
            <div className="rounded-xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400 p-[1.5px]">
              <div className="flex items-center gap-1.5 rounded-[10px] bg-white px-2 py-1">
                <Input
                  placeholder="Ask a question about this conversation..."
                  value={question}
                  disabled={isBusy}
                  className="h-8 flex-1 border-0 shadow-none focus-visible:ring-0"
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && question.trim() && !isBusy) {
                      event.preventDefault();
                      runAsk();
                    }
                  }}
                />
                <button
                  type="button"
                  aria-label="Ask"
                  disabled={isBusy || !question.trim()}
                  onClick={runAsk}
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAsking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default AiConversationInsights;
