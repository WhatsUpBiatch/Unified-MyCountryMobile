import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  RotateCcw,
  Send,
  TriangleAlert,
  User,
  UserCheck,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import '@/components/mcm/mcm-page.css';

/**
 * Captain — Playground.
 *
 * A test harness for an assistant, not a chat product: the point is to judge
 * what the assistant said, so the screen shows the two things that let you do
 * that alongside every reply — whether it handed off to a human, and which
 * knowledge-base entries it leaned on, with how strongly.
 *
 * The page head is the console's own, so this screen opens like every other
 * Admin screen; only the transcript below it is particular to Captain.
 */

const CAPTAIN_API_BASE = '/captain-api/api/captain';

type Assistant = { id: string; name: string };
type Source = { id: string; question: string; score: number };
type Message = { role: 'user' | 'assistant'; content: string; handoff?: boolean; sources?: Source[] };

/* The similarity score arrives 0–1 and used to live only in a `title`
   attribute, which is to say nowhere — it is not reachable by keyboard or on a
   touch screen, and it is the number that says whether the assistant actually
   had grounding for the answer or was reaching. */
const asPercent = (score: number) => `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;

const CaptainPlayground = () => {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [assistantId, setAssistantId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const activeAssistant = assistants.find((a) => a.id === assistantId);

  useEffect(() => {
    fetch(`${CAPTAIN_API_BASE}/assistants`)
      .then((res) => res.json())
      .then((json) => {
        const list = json.data || [];
        setAssistants(list);
        if (list.length) setAssistantId(list[0].id);
      })
      .catch(() => setError('Failed to load assistants'));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isSending]);

  /* The field grows with what is typed into it, up to a point. Reset to `auto`
     first: scrollHeight only ever reports the content's height correctly when
     the box is not already holding itself open at the previous measurement. */
  const growField = () => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 132)}px`;
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !assistantId || isSending) return;
    setError('');
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    /* The box is emptied by state, but its height is inline and would stay at
       whatever four lines of typing had grown it to. */
    requestAnimationFrame(growField);
    setIsSending(true);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/assistants/${assistantId}/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to get a response');
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: json.data.reply,
          handoff: json.data.handoff,
          sources: json.data.sources,
        },
      ]);
    } catch (err: any) {
      setError(err?.message || 'Failed to get a response');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className="mcm-adminpage mcm-cpg">
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">Captain</div>
          <h1>Playground</h1>
          <p>
            Try an assistant the way a customer would. Nothing here is saved, and no customer sees
            it.
          </p>
        </div>
        <div className="mcm-adminpage-actions">
          {/* A menu, not a <select>. The option list of a native select is
              drawn by the operating system: no CSS reaches it, which is why it
              opened as a white box with a hard blue highlight in the middle of
              a themed page, and why it cannot show anything but a string per
              row. Radix's radio group is single-select the same way a select
              is - one value, arrow keys, type-ahead, announced as a choice -
              and it is already a dependency here. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="mcm-cpg-pick" disabled={!assistants.length}>
                <span className="mcm-cpg-pick-l">Assistant</span>
                <span className="mcm-cpg-pick-v">
                  <span className="mcm-cpg-pick-dot" aria-hidden="true" />
                  {activeAssistant?.name || 'None available'}
                </span>
                <ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="mcm-cpg-menu">
              <DropdownMenuRadioGroup
                value={assistantId}
                onValueChange={(next) => {
                  if (next === assistantId) return;
                  setAssistantId(next);
                  /* A transcript belongs to the assistant that produced it.
                     Carrying it across would put one assistant's answers under
                     another's name, which is the one thing this screen exists
                     to tell apart. */
                  setMessages([]);
                  setError('');
                }}
              >
                {assistants.map((assistant) => (
                  <DropdownMenuRadioItem key={assistant.id} value={assistant.id}>
                    <span className="mcm-cpg-menu-name">{assistant.name}</span>
                    {assistant.id === assistantId ? (
                      <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                    ) : null}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Switching assistant was the only way to empty the transcript,
              which meant starting a clean run on the same assistant took two
              switches. */}
          <button
            type="button"
            className="mcm-cpg-reset"
            onClick={() => {
              setMessages([]);
              setError('');
              fieldRef.current?.focus();
            }}
            disabled={!messages.length || isSending}
          >
            <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
            Reset
          </button>
        </div>
      </div>

      {error ? (
        <div className="mcm-cpg-error" role="alert">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <div className="mcm-cpg-stage" ref={scrollRef}>
        <div className="mcm-cpg-thread">
          {messages.length === 0 && !isSending ? (
            <div className="mcm-cpg-blank">
              <span className="mcm-cpg-blank-mark">
                <Bot size={22} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <h2>
                {activeAssistant ? `${activeAssistant.name} is ready` : 'Pick an assistant'}
              </h2>
              <p>
                Send it something a customer would ask. Every reply shows what it drew on, and
                flags the point where it would hand over to a person.
              </p>
            </div>
          ) : null}

          {messages.map((message, index) => (
            <div
              /* Index as key: this list is append-only and never reordered or
                 filtered, and the messages carry no id of their own. */
              key={index}
              className={`mcm-cpg-turn ${message.role === 'user' ? 'is-you' : 'is-bot'}`}
            >
              <span className="mcm-cpg-avatar" aria-hidden="true">
                {message.role === 'user' ? (
                  <User size={15} strokeWidth={2} />
                ) : (
                  <Bot size={15} strokeWidth={2} />
                )}
              </span>
              <div className="mcm-cpg-side">
                <div className="mcm-cpg-who">{message.role === 'user' ? 'You' : 'Assistant'}</div>
                <div className="mcm-cpg-bubble">{message.content}</div>

                {message.handoff ? (
                  <span className="mcm-cpg-handoff">
                    <UserCheck size={13} strokeWidth={2} aria-hidden="true" />
                    Handed off to a human agent
                  </span>
                ) : null}

                {message.sources?.length ? (
                  <div className="mcm-cpg-sources">
                    <div className="mcm-cpg-sources-h">Drew on</div>
                    {message.sources.map((source) => (
                      <span className="mcm-cpg-source" key={source.id}>
                        <BookOpen size={13} strokeWidth={2} aria-hidden="true" />
                        <span className="mcm-cpg-source-q">{source.question}</span>
                        {/* The bar is the quick read and the number is the
                            exact one; the bar alone would be a decoration you
                            cannot act on, and colour alone would carry the
                            warning to everyone except the people most likely
                            to miss a weak match. */}
                        <span
                          className={`mcm-cpg-score ${source.score < 0.6 ? 'is-weak' : ''}`}
                          title={`Similarity ${asPercent(source.score)}`}
                        >
                          <span className="mcm-cpg-score-bar">
                            <i style={{ width: asPercent(source.score) }} />
                          </span>
                          {asPercent(source.score)}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {isSending ? (
            <div className="mcm-cpg-turn is-bot">
              <span className="mcm-cpg-avatar" aria-hidden="true">
                <Bot size={15} strokeWidth={2} />
              </span>
              <div className="mcm-cpg-side">
                <div className="mcm-cpg-who">Assistant</div>
                <div className="mcm-cpg-bubble is-typing" aria-label="Assistant is replying">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mcm-cpg-composer">
        <div className="mcm-cpg-field">
          {/* A textarea, not an input. The Enter handler has always treated
              Shift+Enter as "new line", which an <input> cannot do — so the
              key did nothing and a long question had to be written as one
              unbroken line. */}
          <textarea
            ref={fieldRef}
            rows={1}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              growField();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              handleSend();
            }}
            placeholder={
              activeAssistant ? `Ask ${activeAssistant.name} something…` : 'Type a message…'
            }
            aria-label="Message the assistant"
            disabled={!assistantId}
          />
          <button
            type="button"
            className="mcm-cpg-send"
            onClick={handleSend}
            disabled={!input.trim() || isSending || !assistantId}
          >
            <Send size={15} strokeWidth={2} aria-hidden="true" />
            <span>Send</span>
          </button>
        </div>
        <p className="mcm-cpg-hint">
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
        </p>
      </div>
    </section>
  );
};

export default CaptainPlayground;
