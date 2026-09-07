import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, HelpCircle, PencilLine, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { AssistantSwitcher, useSelectedAssistant } from './assistant-switcher';
import '@/components/mcm/mcm-page.css';

/**
 * Captain — FAQs.
 *
 * Answers the assistant may give verbatim. The list drew `draft` and `approved`
 * as a yellow pill and a green one and left it there — but the difference is
 * the whole point of the screen: an approved FAQ is answering customers now, a
 * draft is written and doing nothing. Drafts are also what the Documents screen
 * produces in bulk, so they arrive in batches and then sit unnoticed among the
 * live ones. They now have a filter of their own, and a count.
 */

const CAPTAIN_API_BASE = '/captain-api/api/captain';

type Faq = {
  id: string;
  assistant_id: string;
  question: string;
  answer: string;
  status: 'draft' | 'approved';
  created_at: string;
};

const emptyForm = { question: '', answer: '', status: 'approved' as const };

/* One definition of the two states, so the pill's colour and its wording cannot
   drift apart the way two separate ternaries in the markup could. */
const STATUS = {
  approved: {
    label: 'Live',
    tone: 'is-live',
    Icon: CircleCheck,
    note: 'The assistant may give this answer.',
  },
  draft: {
    label: 'Draft',
    tone: 'is-draft',
    Icon: PencilLine,
    note: 'Written, but the assistant will not use it yet.',
  },
} as const;

const CaptainFaqs = () => {
  const { assistants, selectedId, selectAssistant } = useSelectedAssistant();
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  /* Which states to show. Client-side on purpose: the request is already
     debounced against the server for search, and adding status to it would make
     switching a filter cost a round trip to reorder a list that is in hand. */
  const [filter, setFilter] = useState<'all' | 'approved' | 'draft'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ question: string; answer: string; status: 'draft' | 'approved' }>(
    emptyForm,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const fetchFaqs = async (assistantId: string, searchTerm = '') => {
    if (!assistantId) return;
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ assistant_id: assistantId });
      if (searchTerm) params.set('search', searchTerm);
      const res = await fetch(`${CAPTAIN_API_BASE}/faqs?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to load FAQs');
      setFaqs(json.data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load FAQs');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedId) return;
    const timer = setTimeout(() => fetchFaqs(selectedId, search), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, selectedId]);

  const counts = useMemo(
    () => ({
      all: faqs.length,
      approved: faqs.filter((f) => f.status === 'approved').length,
      draft: faqs.filter((f) => f.status === 'draft').length,
    }),
    [faqs],
  );

  const visible = useMemo(
    () => (filter === 'all' ? faqs : faqs.filter((f) => f.status === filter)),
    [faqs, filter],
  );

  const openCreateModal = () => {
    setEditingId(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  };

  const openEditModal = (faq: Faq) => {
    setEditingId(faq.id);
    setForm({ question: faq.question, answer: faq.answer, status: faq.status });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.question.trim() || !form.answer.trim()) return;
    setIsSaving(true);
    setError('');
    try {
      if (editingId) {
        const res = await fetch(`${CAPTAIN_API_BASE}/faqs/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error((await res.json())?.message || 'Failed to update FAQ');
      } else {
        const res = await fetch(`${CAPTAIN_API_BASE}/faqs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, assistant_id: selectedId }),
        });
        if (!res.ok) throw new Error((await res.json())?.message || 'Failed to create FAQ');
      }
      setIsModalOpen(false);
      fetchFaqs(selectedId, search);
    } catch (err: any) {
      setError(err?.message || 'Failed to save FAQ');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmingId(null);
    setDeletingId(id);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/faqs/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete FAQ');
      setFaqs((prev) => prev.filter((f) => f.id !== id));
    } catch (err: any) {
      setError(err?.message || 'Failed to delete FAQ');
    } finally {
      setDeletingId(null);
    }
  };

  /* Publishing from the row. Approving a batch of generated drafts meant
     opening each one, changing a dropdown and saving — three steps and a modal
     per answer, for a decision that is one word. */
  const publish = async (faq: Faq) => {
    const next = { question: faq.question, answer: faq.answer, status: 'approved' as const };
    setFaqs((prev) => prev.map((f) => (f.id === faq.id ? { ...f, status: 'approved' } : f)));
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/faqs/${faq.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error('Failed to publish FAQ');
    } catch (err: any) {
      /* Put it back. An optimistic row that silently stays "Live" after a
         failed write is the worst outcome here — it reads as published. */
      setFaqs((prev) => prev.map((f) => (f.id === faq.id ? { ...f, status: 'draft' } : f)));
      setError(err?.message || 'Failed to publish FAQ');
    }
  };

  const FILTERS = [
    { key: 'all' as const, label: 'All', count: counts.all },
    { key: 'approved' as const, label: 'Live', count: counts.approved },
    { key: 'draft' as const, label: 'Drafts', count: counts.draft },
  ];

  return (
    <section className="mcm-adminpage mcm-faq">
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">Captain</div>
          <h1>FAQs</h1>
          <p>
            Answers the assistant gives word for word. Drafts are written but not in use — publish
            one and it starts answering customers.
          </p>
        </div>
        <div className="mcm-adminpage-actions">
          <AssistantSwitcher
            assistants={assistants}
            selectedId={selectedId}
            onSelect={selectAssistant}
          />
          <Button type="button" variant="primary" onClick={openCreateModal} disabled={!selectedId}>
            <Plus className="size-4" />
            Add FAQ
          </Button>
        </div>
      </div>

      <div className="mcm-faq-bar">
        <div className="mcm-faq-search">
          <Search size={15} strokeWidth={2} aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions and answers"
            aria-label="Search FAQs"
          />
        </div>
        {/* Counts on the tabs, so a batch of drafts left over from a document
            import announces itself instead of waiting to be scrolled past. */}
        <div className="mcm-faq-filters">
          {FILTERS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={filter === tab.key ? 'is-on' : undefined}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
              <span>{tab.count}</span>
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mcm-cpg-error" role="alert">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <div className="mcm-faq-body">
        {isLoading ? (
          <div className="mcm-faq-blank">Loading FAQs…</div>
        ) : visible.length === 0 ? (
          <div className="mcm-faq-blank">
            <span className="mcm-faq-blank-mark">
              <HelpCircle size={22} strokeWidth={1.75} aria-hidden="true" />
            </span>
            {/* Three ways to reach an empty list, and they need three different
                things done about them. */}
            {search ? (
              <>
                <h2>Nothing matches “{search}”</h2>
                <p>Try a word from the answer rather than the question.</p>
              </>
            ) : filter !== 'all' ? (
              <>
                <h2>No {filter === 'draft' ? 'drafts' : 'live answers'}</h2>
                <p>
                  {filter === 'draft'
                    ? 'Everything written for this assistant is published.'
                    : 'Nothing is published yet. Publish a draft and the assistant can start using it.'}
                </p>
              </>
            ) : (
              <>
                <h2>No FAQs yet</h2>
                <p>
                  Write one, or open a document and let Captain suggest a set from what it has
                  already read.
                </p>
                <Button type="button" variant="primary" onClick={openCreateModal}>
                  <Plus className="size-4" />
                  Add FAQ
                </Button>
              </>
            )}
          </div>
        ) : (
          <ul className="mcm-faq-list">
            {visible.map((faq) => {
              const state = STATUS[faq.status] || STATUS.draft;
              return (
                <li className={`mcm-faq-row ${state.tone}`} key={faq.id}>
                  <div className="mcm-faq-main">
                    <div className="mcm-faq-q">
                      <span className={`mcm-faq-status ${state.tone}`} title={state.note}>
                        <state.Icon size={12} strokeWidth={2.25} aria-hidden="true" />
                        {state.label}
                      </span>
                      <h2>{faq.question}</h2>
                    </div>
                    <p className="mcm-faq-a">{faq.answer}</p>
                  </div>

                  <div className="mcm-faq-acts">
                    {confirmingId === faq.id ? (
                      <div className="mcm-faq-confirm">
                        <span>Delete?</span>
                        <button type="button" onClick={() => setConfirmingId(null)}>
                          Keep
                        </button>
                        <button
                          type="button"
                          className="is-go"
                          onClick={() => handleDelete(faq.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <>
                        {faq.status === 'draft' ? (
                          <button
                            type="button"
                            className="mcm-faq-publish"
                            onClick={() => publish(faq)}
                          >
                            <CircleCheck size={14} strokeWidth={2} aria-hidden="true" />
                            Publish
                          </button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(faq)}
                        >
                          <PencilLine className="size-3.5" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="destructiveOutline"
                          size="sm"
                          disabled={deletingId === faq.id}
                          onClick={() => setConfirmingId(faq.id)}
                        >
                          <Trash2 className="size-3.5" />
                          {deletingId === faq.id ? 'Deleting…' : 'Delete'}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="mcm-asst-dlg w-full max-w-lg p-0">
          <div className="mcm-asst-dlg-h">
            <DialogTitle>{editingId ? 'Edit FAQ' : 'New FAQ'}</DialogTitle>
            <p>
              Write the answer as you would want a customer to read it — the assistant gives it
              back word for word.
            </p>
          </div>

          <div className="mcm-asst-dlg-b mcm-doc-dlg-b">
            <div className="mcm-asst-f">
              <Label htmlFor="faq-q">Question</Label>
              <Input
                id="faq-q"
                type="text"
                value={form.question}
                onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
                placeholder="What are your support hours?"
              />
            </div>

            <div className="mcm-asst-f">
              <Label htmlFor="faq-a">Answer</Label>
              <textarea
                id="faq-a"
                className="mcm-asst-ta"
                value={form.answer}
                onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
                rows={4}
                placeholder="Monday to Friday, 9am to 6pm."
              />
            </div>

            <div className="mcm-asst-f">
              <Label>Status</Label>
              {/* Two states, shown as two — and each says what it does rather
                  than only naming itself, because "draft" and "approved" do not
                  explain that one of them answers customers. */}
              <div className="mcm-doc-kindpick">
                {(['approved', 'draft'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={form.status === key ? 'is-on' : undefined}
                    onClick={() => setForm((f) => ({ ...f, status: key }))}
                  >
                    {STATUS[key].label}
                  </button>
                ))}
              </div>
              <p className="mcm-asst-f-p">{STATUS[form.status].note}</p>
            </div>
          </div>

          <div className="mcm-asst-dlg-f">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isSaving || !form.question.trim() || !form.answer.trim()}
              onClick={handleSave}
            >
              {isSaving ? 'Saving…' : editingId ? 'Save changes' : 'Add FAQ'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default CaptainFaqs;
