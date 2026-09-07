import { useEffect, useRef, useState } from 'react';
import {
  BookOpenText,
  CircleCheck,
  FileText,
  Link2,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AssistantSwitcher, useSelectedAssistant } from './assistant-switcher';
import '@/components/mcm/mcm-page.css';

/**
 * Captain — Documents.
 *
 * The sources an assistant answers from. The list showed a name, a status pill
 * and an address; `content_length` was fetched on every row and shown on none
 * of them, which left the one question a knowledge source raises — is there
 * actually anything in it — unanswerable from this screen. A crawl that
 * succeeds and returns an empty page reads here exactly like one that worked.
 */

const CAPTAIN_API_BASE = '/captain-api/api/captain';

type Document = {
  id: string;
  assistant_id: string;
  name: string;
  type: 'url' | 'pdf';
  source_url: string | null;
  status: 'processing' | 'ready' | 'failed';
  error_message: string | null;
  created_at: string;
  content_length: number;
};

type GeneratedFaq = { question: string; answer: string; selected: boolean };

/* The three states a document can be in. Held as data rather than as a chain of
   ternaries in the markup, which is what made the old pill's colours and its
   words drift into separate expressions. */
const STATUS = {
  ready: { label: 'Ready', tone: 'is-ready', Icon: CircleCheck },
  processing: { label: 'Processing', tone: 'is-work', Icon: Loader2 },
  failed: { label: 'Failed', tone: 'is-bad', Icon: TriangleAlert },
} as const;

/* How much text was actually extracted. The API has always sent it. A document
   that crawled "successfully" and came back with 40 characters is the failure
   this screen could not previously show — it looked identical to a good one. */
const extractSize = (chars: number) => {
  if (!chars) return null;
  if (chars < 1000) return `${chars} characters`;
  return `${(chars / 1000).toFixed(chars < 10000 ? 1 : 0)}k characters`;
};
/* Under a paragraph or so of text is almost never a real page — usually a
   cookie wall, a login screen, or a redirect that returned 200. */
const THIN_EXTRACT = 400;

function timeAgo(dateStr: string) {
  const diffMs = Date.now() - new Date(`${dateStr}Z`).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) === 1 ? '' : 's'} ago`;
}

const CaptainDocuments = () => {
  const { assistants, selectedId, selectAssistant } = useSelectedAssistant();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<'url' | 'pdf'>('url');
  const [createName, setCreateName] = useState('');
  const [createUrl, setCreateUrl] = useState('');
  const [createMaxPages, setCreateMaxPages] = useState(1);
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editName, setEditName] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedFaqs, setGeneratedFaqs] = useState<GeneratedFaq[] | null>(null);
  const [isSavingFaqs, setIsSavingFaqs] = useState(false);
  const [modalError, setModalError] = useState('');
  /* Which row is asking "are you sure". One at a time, so opening a second
     confirmation closes the first. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const fetchDocuments = async (assistantId: string) => {
    if (!assistantId) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/documents?assistant_id=${assistantId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to load documents');
      setDocuments(json.data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedId) fetchDocuments(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (createdCount === null) return;
    const timer = setTimeout(() => setCreatedCount(null), 5000);
    return () => clearTimeout(timer);
  }, [createdCount]);

  const resetCreateForm = () => {
    setCreateType('url');
    setCreateName('');
    setCreateUrl('');
    setCreateMaxPages(1);
    setCreateFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCreate = async () => {
    if (!selectedId) return;
    if (createType === 'url' && !createUrl.trim()) return;
    if (createType === 'pdf' && (!createFile || !createName.trim())) return;
    setIsCreating(true);
    setModalError('');
    setCreatedCount(null);
    try {
      const payload: any = { assistant_id: selectedId, name: createName.trim() || undefined, type: createType };
      if (createType === 'url') {
        payload.source_url = createUrl.trim();
        payload.max_pages = createMaxPages;
      } else {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
          reader.onerror = reject;
          reader.readAsDataURL(createFile as File);
        });
        payload.file_base64 = base64;
      }
      const res = await fetch(`${CAPTAIN_API_BASE}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to create document');
      const created = json.data?.documents?.length || 0;
      setIsCreateOpen(false);
      resetCreateForm();
      fetchDocuments(selectedId);
      setCreatedCount(created);
    } catch (err: any) {
      setModalError(err?.message || 'Failed to create document');
    } finally {
      setIsCreating(false);
    }
  };

  const deleteDocument = async (id: string) => {
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/documents/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete document');
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      setError(err?.message || 'Failed to delete document');
    }
  };

  const openEdit = async (doc: Document) => {
    setModalError('');
    setGeneratedFaqs(null);
    setEditingDoc(doc);
    setEditName(doc.name);
    setEditContent('');
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/documents/${doc.id}`);
      const json = await res.json();
      if (res.ok) setEditContent(json.data.content || '');
    } catch {
      // leave content blank; user can still see the error via modalError if save fails
    }
  };

  const handleSaveEdit = async () => {
    if (!editingDoc) return;
    setIsSavingEdit(true);
    setModalError('');
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/documents/${editingDoc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, content: editContent }),
      });
      if (!res.ok) throw new Error((await res.json())?.message || 'Failed to save document');
      setEditingDoc(null);
      fetchDocuments(selectedId);
    } catch (err: any) {
      setModalError(err?.message || 'Failed to save document');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleGenerateFaqs = async () => {
    if (!editingDoc) return;
    setIsGenerating(true);
    setModalError('');
    setGeneratedFaqs(null);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/documents/${editingDoc.id}/generate-faqs`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to generate FAQs');
      const faqs: GeneratedFaq[] = (json.data.faqs || []).map((f: any) => ({ ...f, selected: true }));
      if (!faqs.length) setModalError('No FAQs could be generated from this document.');
      setGeneratedFaqs(faqs);
    } catch (err: any) {
      setModalError(err?.message || 'Failed to generate FAQs');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveGeneratedFaqs = async () => {
    if (!editingDoc || !generatedFaqs) return;
    const selected = generatedFaqs.filter((f) => f.selected);
    if (!selected.length) return;
    setIsSavingFaqs(true);
    setModalError('');
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/faqs/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistant_id: editingDoc.assistant_id,
          document_id: editingDoc.id,
          status: 'draft',
          faqs: selected.map(({ question, answer }) => ({ question, answer })),
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.message || 'Failed to save FAQs');
      setGeneratedFaqs(null);
      setEditingDoc(null);
    } catch (err: any) {
      setModalError(err?.message || 'Failed to save FAQs');
    } finally {
      setIsSavingFaqs(false);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmingId(null);
    void deleteDocument(id);
  };

  return (
    <section className="mcm-adminpage mcm-doc">
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">Captain</div>
          <h1>Documents</h1>
          {/* The standing explainer that used to sit in a dashed box above the
              list said this, and said it on every visit forever. It belongs in
              the one line every other Admin screen puts under its title. */}
          <p>
            What the assistant is allowed to answer from. Point it at a help centre or upload a
            PDF, and Captain reads it for FAQs.
          </p>
        </div>
        <div className="mcm-adminpage-actions">
          <AssistantSwitcher
            assistants={assistants}
            selectedId={selectedId}
            onSelect={selectAssistant}
          />
          <Button
            type="button"
            variant="primary"
            onClick={() => setIsCreateOpen(true)}
            disabled={!selectedId}
          >
            <Plus className="size-4" />
            Add document
          </Button>
        </div>
      </div>

      {createdCount !== null ? (
        <div className="mcm-doc-note" role="status">
          <CircleCheck size={15} strokeWidth={2} aria-hidden="true" />
          {createdCount === 1
            ? 'Document added. It will show as Ready once Captain has read it.'
            : createdCount + ' documents added. They will show as Ready once Captain has read them.'}
        </div>
      ) : null}

      {error ? (
        <div className="mcm-cpg-error" role="alert">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <div className="mcm-doc-body">
        {isLoading ? (
          <div className="mcm-doc-blank">Loading documents…</div>
        ) : documents.length === 0 ? (
          <div className="mcm-doc-blank">
            <span className="mcm-doc-blank-mark">
              <BookOpenText size={22} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h2>Nothing to answer from yet</h2>
            <p>
              Without a document the assistant has only its instructions to go on. Add a help
              centre page or a PDF and it will read it for FAQs.
            </p>
            <Button type="button" variant="primary" onClick={() => setIsCreateOpen(true)}>
              <Plus className="size-4" />
              Add document
            </Button>
          </div>
        ) : (
          <ul className="mcm-doc-list">
            {documents.map((doc) => {
              const state = STATUS[doc.status] || STATUS.processing;
              const size = extractSize(doc.content_length);
              const isThin =
                doc.status === 'ready' &&
                doc.content_length > 0 &&
                doc.content_length < THIN_EXTRACT;

              return (
                <li className={'mcm-doc-row ' + state.tone} key={doc.id}>
                  <span className="mcm-doc-kind" aria-hidden="true">
                    {doc.type === 'url' ? (
                      <Link2 size={15} strokeWidth={2} />
                    ) : (
                      <FileText size={15} strokeWidth={2} />
                    )}
                  </span>

                  <div className="mcm-doc-main">
                    <div className="mcm-doc-t">
                      <span className="mcm-doc-name">{doc.name}</span>
                      <span className={'mcm-doc-status ' + state.tone}>
                        <state.Icon
                          size={12}
                          strokeWidth={2.25}
                          className={doc.status === 'processing' ? 'animate-spin' : undefined}
                          aria-hidden="true"
                        />
                        {state.label}
                      </span>
                    </div>

                    <div className="mcm-doc-meta">
                      {doc.source_url ? (
                        <a href={doc.source_url} target="_blank" rel="noreferrer">
                          {doc.source_url}
                        </a>
                      ) : (
                        <span>Uploaded PDF</span>
                      )}
                      {size ? (
                        <>
                          <i aria-hidden="true" />
                          {/* Flagged, not hidden: a page that returned almost no
                              text is the quiet failure this list exists to
                              surface. */}
                          <span className={isThin ? 'is-thin' : undefined}>
                            {isThin ? size + ' — barely any text' : size}
                          </span>
                        </>
                      ) : null}
                      <i aria-hidden="true" />
                      <span>{timeAgo(doc.created_at)}</span>
                    </div>

                    {doc.status === 'failed' && doc.error_message ? (
                      <p className="mcm-doc-why">{doc.error_message}</p>
                    ) : null}
                  </div>

                  {confirmingId === doc.id ? (
                    /* Asked on the row, not in an OS dialog — window.confirm
                       cannot name which document it means. */
                    <div className="mcm-doc-confirm">
                      <span>Delete?</span>
                      <button type="button" onClick={() => setConfirmingId(null)}>
                        Keep
                      </button>
                      <button type="button" className="is-go" onClick={() => handleDelete(doc.id)}>
                        Delete
                      </button>
                    </div>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="mcm-doc-more"
                        aria-label={'Actions for ' + doc.name}
                      >
                        <MoreVertical className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(doc)}>
                          <Pencil className="size-3.5" />
                          Edit content
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setConfirmingId(doc.id)}
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Create document modal */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) resetCreateForm();
        }}
      >
        <DialogContent className="mcm-asst-dlg w-full max-w-md p-0">
          <div className="mcm-asst-dlg-h">
            <DialogTitle>Add a document</DialogTitle>
            <p>Point Captain at a page it may answer from, or upload a PDF.</p>
          </div>

          <div className="mcm-asst-dlg-b mcm-doc-dlg-b">
            <div className="mcm-asst-f">
              <Label>Source</Label>
              {/* Two options, so they are shown as two. A dropdown asks for a
                  click to reveal a choice that fits on the line. */}
              <div className="mcm-doc-kindpick">
                <button
                  type="button"
                  className={createType === 'url' ? 'is-on' : undefined}
                  onClick={() => setCreateType('url')}
                >
                  <Link2 size={14} strokeWidth={2} aria-hidden="true" />
                  A web page
                </button>
                <button
                  type="button"
                  className={createType === 'pdf' ? 'is-on' : undefined}
                  onClick={() => setCreateType('pdf')}
                >
                  <FileText size={14} strokeWidth={2} aria-hidden="true" />
                  A PDF
                </button>
              </div>
            </div>

            {createType === 'url' ? (
              <>
                <div className="mcm-asst-f">
                  <Label htmlFor="doc-url">Address</Label>
                  <Input
                    id="doc-url"
                    type="text"
                    value={createUrl}
                    onChange={(e) => setCreateUrl(e.target.value)}
                    placeholder="https://example.com/help-article"
                  />
                </div>
                <div className="mcm-asst-f">
                  <Label>How far to follow links</Label>
                  <p className="mcm-asst-f-p">
                    Linked pages on the same site, one level deep. Each becomes its own document.
                  </p>
                  {/* Four fixed values, so they are four choices rather than a
                      dropdown hiding three of them. */}
                  <div className="mcm-doc-depth">
                    {[
                      { value: 1, label: 'This page' },
                      { value: 5, label: '5 pages' },
                      { value: 10, label: '10 pages' },
                      { value: 20, label: '20 pages' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={createMaxPages === option.value ? 'is-on' : undefined}
                        onClick={() => setCreateMaxPages(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="mcm-asst-f">
                <Label htmlFor="doc-file">PDF</Label>
                <input
                  id="doc-file"
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="mcm-doc-file"
                  onChange={(e) => setCreateFile(e.target.files?.[0] || null)}
                />
              </div>
            )}

            <div className="mcm-asst-f">
              <Label htmlFor="doc-name">
                Name{' '}
                {createType === 'url' ? <span className="mcm-doc-optional">optional</span> : null}
              </Label>
              <Input
                id="doc-name"
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={
                  createType === 'url' ? 'Defaults to the page title' : 'What this document is'
                }
              />
            </div>

            {modalError ? (
              <div className="mcm-cpg-error" role="alert">
                <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
                {modalError}
              </div>
            ) : null}
            {isCreating && createMaxPages > 1 ? (
              <div className="mcm-doc-wait" role="status">
                <Loader2 size={15} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                Reading up to {createMaxPages} pages — this can take a minute.
              </div>
            ) : null}
          </div>

          <div className="mcm-asst-dlg-f">
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isCreating || (createType === 'url' ? !createUrl.trim() : !createFile || !createName.trim())}
              onClick={handleCreate}
            >
              {isCreating ? 'Adding…' : 'Add document'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit / generate FAQs modal */}
      <Dialog open={!!editingDoc} onOpenChange={(open) => !open && setEditingDoc(null)}>
        <DialogContent className="mcm-asst-dlg w-full max-w-2xl p-0">
          <div className="mcm-asst-dlg-h">
            <DialogTitle>Edit document</DialogTitle>
            <p>
              This text is what the assistant reads. Trimming what does not belong here is the
              fastest way to improve its answers.
            </p>
          </div>

          <div className="mcm-asst-dlg-b mcm-doc-dlg-b">
            <div className="mcm-asst-f">
              <Label htmlFor="doc-edit-name">Name</Label>
              <Input
                id="doc-edit-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            <div className="mcm-asst-f">
              <Label htmlFor="doc-edit-content">Extracted text</Label>
              <textarea
                id="doc-edit-content"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={10}
                className="mcm-asst-ta"
                placeholder="Extracted text will appear here — correct or trim what the assistant sees."
              />
            </div>

            {modalError ? (
              <div className="mcm-cpg-error" role="alert">
                <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
                {modalError}
              </div>
            ) : null}

            {generatedFaqs && (
              <div className="mcm-doc-faqs">
                <div className="mcm-doc-faqs-h">
                  Suggested FAQs
                  <span>{generatedFaqs.filter((f) => f.selected).length} of {generatedFaqs.length} selected</span>
                </div>
                <div className="mcm-doc-faqs-l">
                  {generatedFaqs.map((f, i) => (
                    <label key={i} className={f.selected ? 'is-on' : undefined}>
                      <Checkbox
                        checked={f.selected}
                        onCheckedChange={(checked) =>
                          setGeneratedFaqs((prev) =>
                            prev ? prev.map((item, idx) => (idx === i ? { ...item, selected: checked === true } : item)) : prev,
                          )
                        }
                      />
                      <span className="mcm-doc-faq-t">
                        <b>{f.question}</b>
                        {f.answer}
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="self-end"
                  disabled={isSavingFaqs || !generatedFaqs.some((f) => f.selected)}
                  onClick={handleSaveGeneratedFaqs}
                >
                  {isSavingFaqs
                    ? 'Saving…'
                    : 'Save ' +
                      generatedFaqs.filter((f) => f.selected).length +
                      ' as drafts'}
                </Button>
              </div>
            )}
          </div>

          <div className="mcm-asst-dlg-f is-split">
            <Button
              type="button"
              variant="outline"
              onClick={handleGenerateFaqs}
              disabled={isGenerating || !editContent}
            >
              <Sparkles className="size-4" />
              {isGenerating ? 'Reading…' : 'Suggest FAQs from this'}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingDoc(null)}>
                Close
              </Button>
              <Button type="button" variant="primary" disabled={isSavingEdit} onClick={handleSaveEdit}>
                {isSavingEdit ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default CaptainDocuments;
