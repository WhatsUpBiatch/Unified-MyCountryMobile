import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Contact,
  Gauge,
  Pencil,
  Plus,
  Quote,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import '@/components/mcm/mcm-page.css';

/**
 * Captain — Assistants.
 *
 * The list was a divided strip of names, each with a description and one
 * truncated line of instructions. Everything that actually distinguishes one
 * assistant from another — which features it runs, what it is forbidden to do,
 * how freely it answers — was invisible until the edit dialog was opened, so
 * the screen could not answer the question it exists to answer: what is the
 * difference between these.
 *
 * It is a grid of cards now, each showing what that assistant is configured to
 * be. The dialog is unchanged in what it saves; only its layout is.
 */

const CAPTAIN_API_BASE = '/captain-api/api/captain';
const INSTRUCTIONS_LIMIT = 2000;

/* The one assistant Captain falls back to. It cannot be deleted, which the card
   says rather than leaving the missing button to be noticed. */
const DEFAULT_ASSISTANT_ID = 'default-assistant';

type Assistant = {
  id: string;
  name: string;
  description: string;
  config: {
    instructions?: string;
    product_name?: string;
    welcome_message?: string;
    handoff_message?: string;
    resolution_message?: string;
    temperature?: number;
    feature_faq?: boolean;
    feature_memory?: boolean;
    feature_citation?: boolean;
    feature_contact_attributes?: boolean;
  } | null;
  response_guidelines: string[] | null;
  guardrails: string[] | null;
};

const emptyForm = {
  name: '',
  description: '',
  product_name: '',
  instructions:
    'This is a virtual assistant designed to help you complete tasks efficiently. Simply provide clear instructions or ask questions and it will generate a response.',
  welcome_message: 'Hi! How can I help you today?',
  handoff_message: 'Let me connect you with a team member.',
  resolution_message: 'Glad I could help! Anything else?',
  temperature: 0.3,
  feature_faq: true,
  feature_memory: true,
  feature_citation: false,
  feature_contact_attributes: false,
  response_guidelines: '',
  guardrails: '',
};

/* One definition of the four switchable features, used by both the card and the
   dialog. They were written out twice before, with different wording in each —
   so a card could name a feature the form called something else. */
const FEATURES = [
  {
    key: 'feature_faq' as const,
    short: 'FAQ generation',
    label: 'Generate FAQs from resolved conversations',
    Icon: BookOpen,
  },
  {
    key: 'feature_memory' as const,
    short: 'Memory',
    label: 'Capture key details as memories from customer interactions',
    Icon: Sparkles,
  },
  {
    key: 'feature_citation' as const,
    short: 'Citations',
    label: 'Include source citations in responses',
    Icon: Quote,
  },
  {
    key: 'feature_contact_attributes' as const,
    short: 'Contact data',
    label: 'Allow access to contact information',
    Icon: Contact,
  },
];

/* The mark on a card. Every card carried the same sparkle, which told you these
   were assistants — something the page title had already said — and nothing
   about which one you were looking at.

   Initials, from the first word only. Taking one letter per word is the usual
   approach and is wrong here: the second word is "assistant" on almost every
   one of these, so "Support assistant" and "Sales assistant" both come out SA
   and the mark collides exactly where it is needed. Two letters off the first
   word gives SU and SA, which is the part of the name that actually differs.

   The tile stays violet. The letters say which assistant; the colour says it is
   a machine that answers, which is what `--ai` is reserved for. */
const initials = (name: string) => {
  const first = name.trim().split(/\s+/)[0] || '';
  return (first.slice(0, 2) || '?').toUpperCase();
};

/* Temperature is the number that says how far the assistant may stray from what
   it was told, and 0.3 means nothing to most of the people who read this
   screen. The band is the answer; the number stays for whoever wants it. */
const temperatureBand = (value: number) => {
  if (value <= 0.35) return { label: 'Sticks to the script', tone: 'is-tight' };
  if (value <= 0.7) return { label: 'Balanced', tone: 'is-mid' };
  return { label: 'Improvises freely', tone: 'is-loose' };
};

const CaptainAssistants = () => {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /* Which card is asking "are you sure". Held here rather than in each card so
     opening one confirmation closes any other. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [composioAccess, setComposioAccess] = useState<
    { toolkit_slug: string; toolkit_name: string; allowed: boolean }[]
  >([]);
  const [isLoadingComposioAccess, setIsLoadingComposioAccess] = useState(false);

  const fetchAssistants = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/assistants`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to load assistants');
      setAssistants(json.data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load assistants');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAssistants();
  }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(emptyForm);
    setComposioAccess([]);
    setIsModalOpen(true);
  };

  const fetchComposioAccess = async (assistantId: string) => {
    setIsLoadingComposioAccess(true);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/assistants/${assistantId}/composio-access`);
      const json = await res.json();
      setComposioAccess(json.data || []);
    } catch {
      setComposioAccess([]);
    } finally {
      setIsLoadingComposioAccess(false);
    }
  };

  const toggleComposioAccess = async (toolkitSlug: string, allowed: boolean) => {
    if (!editingId) return;
    setComposioAccess((prev) =>
      prev.map((c) => (c.toolkit_slug === toolkitSlug ? { ...c, allowed } : c)),
    );
    try {
      await fetch(`${CAPTAIN_API_BASE}/assistants/${editingId}/composio-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolkit_slug: toolkitSlug, allowed }),
      });
    } catch {
      setComposioAccess((prev) =>
        prev.map((c) => (c.toolkit_slug === toolkitSlug ? { ...c, allowed: !allowed } : c)),
      );
    }
  };

  const openEditModal = (a: Assistant) => {
    setEditingId(a.id);
    fetchComposioAccess(a.id);
    setForm({
      name: a.name,
      description: a.description || '',
      product_name: a.config?.product_name || '',
      instructions: a.config?.instructions || '',
      welcome_message: a.config?.welcome_message || '',
      handoff_message: a.config?.handoff_message || '',
      resolution_message: a.config?.resolution_message || '',
      temperature: a.config?.temperature ?? 0.3,
      feature_faq: a.config?.feature_faq ?? true,
      feature_memory: a.config?.feature_memory ?? true,
      feature_citation: a.config?.feature_citation ?? false,
      feature_contact_attributes: a.config?.feature_contact_attributes ?? false,
      response_guidelines: (a.response_guidelines || []).join('\n'),
      guardrails: (a.guardrails || []).join('\n'),
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setIsSaving(true);
    setError('');
    const payload = {
      name: form.name,
      description: form.description,
      config: {
        product_name: form.product_name,
        instructions: form.instructions,
        welcome_message: form.welcome_message,
        handoff_message: form.handoff_message,
        resolution_message: form.resolution_message,
        temperature: Number(form.temperature),
        feature_faq: form.feature_faq,
        feature_memory: form.feature_memory,
        feature_citation: form.feature_citation,
        feature_contact_attributes: form.feature_contact_attributes,
      },
      response_guidelines: form.response_guidelines
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      guardrails: form.guardrails
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    try {
      const url = editingId
        ? `${CAPTAIN_API_BASE}/assistants/${editingId}`
        : `${CAPTAIN_API_BASE}/assistants`;
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json())?.message || 'Failed to save assistant');
      setIsModalOpen(false);
      fetchAssistants();
    } catch (err: any) {
      setError(err?.message || 'Failed to save assistant');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (id === DEFAULT_ASSISTANT_ID) return;
    setConfirmingId(null);
    setDeletingId(id);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/assistants/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete assistant');
      setAssistants((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      setError(err?.message || 'Failed to delete assistant');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="mcm-adminpage mcm-asst">
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">Captain</div>
          <h1>Assistants</h1>
          <p>
            The personas behind your chatbot. Each one carries its own instructions, the features
            it may use, and the things it must never do.
          </p>
        </div>
        <div className="mcm-adminpage-actions">
          <Button type="button" variant="primary" onClick={openCreateModal}>
            <Plus className="size-4" />
            Add assistant
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mcm-cpg-error" role="alert">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <div className="mcm-asst-body">
        {isLoading ? (
          <div className="mcm-asst-blank">Loading assistants…</div>
        ) : assistants.length === 0 ? (
          <div className="mcm-asst-blank">
            <span className="mcm-asst-blank-mark">
              <Sparkles size={22} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h2>No assistants yet</h2>
            <p>An assistant is a set of instructions Captain answers with. Add the first one.</p>
            <Button type="button" variant="primary" onClick={openCreateModal}>
              <Plus className="size-4" />
              Add assistant
            </Button>
          </div>
        ) : (
          <div className="mcm-asst-grid">
            {assistants.map((assistant) => {
              const config = assistant.config || {};
              const on = FEATURES.filter((feature) => config[feature.key]);
              const guardrails = assistant.guardrails?.length || 0;
              const guidelines = assistant.response_guidelines?.length || 0;
              const band = temperatureBand(config.temperature ?? 0.3);
              const isDefault = assistant.id === DEFAULT_ASSISTANT_ID;

              return (
                <article className="mcm-asst-card" key={assistant.id}>
                  <header className="mcm-asst-card-h">
                    <span className="mcm-asst-mark" aria-hidden="true">
                      {initials(assistant.name)}
                    </span>
                    <div className="mcm-asst-id">
                      <h2>{assistant.name}</h2>
                      {assistant.description ? (
                        <p>{assistant.description}</p>
                      ) : (
                        <p className="is-empty">No description</p>
                      )}
                    </div>
                    {isDefault ? <span className="mcm-asst-default">Default</span> : null}
                  </header>

                  {/* The instructions are the assistant. Two lines of them say
                      more about what it will do than any label on this card. */}
                  {config.instructions ? (
                    <blockquote className="mcm-asst-brief">{config.instructions}</blockquote>
                  ) : (
                    <blockquote className="mcm-asst-brief is-empty">
                      No instructions — this assistant will answer from the knowledge base alone.
                    </blockquote>
                  )}

                  <dl className="mcm-asst-facts">
                    <div>
                      <dt>
                        <Gauge size={13} strokeWidth={2} aria-hidden="true" />
                        Answer style
                      </dt>
                      <dd className={`mcm-asst-band ${band.tone}`}>
                        {band.label}
                        <span>{(config.temperature ?? 0.3).toFixed(1)}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <ShieldCheck size={13} strokeWidth={2} aria-hidden="true" />
                        Rules
                      </dt>
                      <dd>
                        {guardrails + guidelines === 0 ? (
                          <span className="is-empty">None set</span>
                        ) : (
                          <>
                            {guardrails} guardrail{guardrails === 1 ? '' : 's'} · {guidelines}{' '}
                            guideline{guidelines === 1 ? '' : 's'}
                          </>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {/* Only what is switched on. A row of chips half greyed out
                      reads as a checklist of things that are missing, when the
                      point is what this assistant does. */}
                  <div className="mcm-asst-feats">
                    {on.length ? (
                      on.map(({ key, short, Icon }) => (
                        <span className="mcm-asst-feat" key={key}>
                          <Icon size={12} strokeWidth={2.25} aria-hidden="true" />
                          {short}
                        </span>
                      ))
                    ) : (
                      <span className="mcm-asst-feat is-empty">No optional features on</span>
                    )}
                  </div>

                  <footer className="mcm-asst-card-f">
                    {confirmingId === assistant.id ? (
                      /* Inline, not window.confirm — an OS dialog in the middle
                         of the page cannot say which assistant it means, and
                         this one is named on the card it came from. */
                      <div className="mcm-asst-confirm">
                        <span>Delete {assistant.name}?</span>
                        <button type="button" onClick={() => setConfirmingId(null)}>
                          Keep
                        </button>
                        <button
                          type="button"
                          className="is-go"
                          onClick={() => handleDelete(assistant.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(assistant)}
                        >
                          <Pencil className="size-3.5" />
                          Edit
                        </Button>
                        {isDefault ? (
                          <span className="mcm-asst-locked">Cannot be deleted</span>
                        ) : (
                          <Button
                            type="button"
                            variant="destructiveOutline"
                            size="sm"
                            disabled={deletingId === assistant.id}
                            onClick={() => setConfirmingId(assistant.id)}
                          >
                            <Trash2 className="size-3.5" />
                            {deletingId === assistant.id ? 'Deleting…' : 'Delete'}
                          </Button>
                        )}
                      </>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="mcm-asst-dlg w-full max-w-2xl p-0">
          <div className="mcm-asst-dlg-h">
            <DialogTitle>{editingId ? 'Edit assistant' : 'New assistant'}</DialogTitle>
            <p>
              {editingId
                ? 'Changes apply the next time this assistant answers.'
                : 'Give it a name and tell it what it is for. Everything else has a sensible default.'}
            </p>
          </div>

          <div className="mcm-asst-dlg-b">
            <section className="mcm-asst-sec">
              <h3>Identity</h3>
              <div className="mcm-asst-row">
                <div className="mcm-asst-f">
                  <Label htmlFor="asst-name">Name</Label>
                  <Input
                    id="asst-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Support assistant"
                  />
                </div>
                <div className="mcm-asst-f">
                  <Label htmlFor="asst-product">Product name</Label>
                  <Input
                    id="asst-product"
                    type="text"
                    value={form.product_name}
                    onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))}
                    placeholder="What it is answering about"
                  />
                </div>
              </div>
              <div className="mcm-asst-f">
                <Label htmlFor="asst-desc">Description</Label>
                <Input
                  id="asst-desc"
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="One line, for the people picking between assistants"
                />
              </div>
            </section>

            <section className="mcm-asst-sec">
              <h3>Instructions</h3>
              <div className="mcm-asst-f">
                <div className="mcm-asst-f-h">
                  <Label htmlFor="asst-instructions">What this assistant is for</Label>
                  {/* Warns before the cap rather than at it: a limit that only
                      announces itself by silently dropping the next keystroke
                      reads as a broken field. */}
                  <span
                    className={`mcm-asst-count ${
                      form.instructions.length > INSTRUCTIONS_LIMIT - 200 ? 'is-near' : ''
                    }`}
                  >
                    {form.instructions.length} / {INSTRUCTIONS_LIMIT}
                  </span>
                </div>
                <textarea
                  id="asst-instructions"
                  className="mcm-asst-ta"
                  value={form.instructions}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, instructions: e.target.value.slice(0, INSTRUCTIONS_LIMIT) }))
                  }
                  rows={5}
                  placeholder="Answer from the knowledge base only. If the answer is not there, say so and hand off."
                />
              </div>
            </section>

            <section className="mcm-asst-sec">
              <h3>What it says</h3>
              <div className="mcm-asst-row">
                <div className="mcm-asst-f">
                  <Label htmlFor="asst-welcome">Opening line</Label>
                  <Input
                    id="asst-welcome"
                    type="text"
                    value={form.welcome_message}
                    onChange={(e) => setForm((f) => ({ ...f, welcome_message: e.target.value }))}
                  />
                </div>
                <div className="mcm-asst-f">
                  <Label htmlFor="asst-handoff">Handing over to a person</Label>
                  <Input
                    id="asst-handoff"
                    type="text"
                    value={form.handoff_message}
                    onChange={(e) => setForm((f) => ({ ...f, handoff_message: e.target.value }))}
                  />
                </div>
              </div>
            </section>

            <section className="mcm-asst-sec">
              <h3>Features</h3>
              <div className="mcm-asst-featlist">
                {FEATURES.map(({ key, short, label, Icon }) => (
                  <label className="mcm-asst-featrow" key={key} htmlFor={key}>
                    <Checkbox
                      id={key}
                      checked={form[key]}
                      onCheckedChange={(checked) =>
                        setForm((f) => ({ ...f, [key]: checked === true }))
                      }
                    />
                    <span className="mcm-asst-featmark" aria-hidden="true">
                      <Icon size={14} strokeWidth={2} />
                    </span>
                    <span className="mcm-asst-fettxt">
                      <b>{short}</b>
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="mcm-asst-sec">
              <h3>
                <Wrench size={13} strokeWidth={2} aria-hidden="true" />
                Customer tools
              </h3>
              <p className="mcm-asst-sec-p">
                Turn a toolkit off to block it everywhere — in the Playground and in customer
                conversations.
              </p>
              {!editingId ? (
                <div className="mcm-asst-hint">
                  Save this assistant first, then come back to allow or block connected apps.
                </div>
              ) : isLoadingComposioAccess ? (
                <div className="mcm-asst-hint">Loading connected apps…</div>
              ) : composioAccess.length === 0 ? (
                <div className="mcm-asst-hint">
                  No Actions connected yet.{' '}
                  <Link to="/admin-settings/captain/actions">Connect apps in Actions</Link>
                </div>
              ) : (
                <div className="mcm-asst-tools">
                  {composioAccess.map((tool) => (
                    <div className="mcm-asst-tool" key={tool.toolkit_slug}>
                      <span>{tool.toolkit_name}</span>
                      <Switch
                        checked={tool.allowed}
                        onCheckedChange={(checked) =>
                          toggleComposioAccess(tool.toolkit_slug, checked === true)
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <details className="mcm-asst-more">
              <summary>Response guidelines and guardrails</summary>
              <div className="mcm-asst-more-b">
                <div className="mcm-asst-f">
                  <Label htmlFor="asst-guidelines">Response guidelines</Label>
                  <p className="mcm-asst-f-p">How it should answer. One per line.</p>
                  <textarea
                    id="asst-guidelines"
                    className="mcm-asst-ta"
                    value={form.response_guidelines}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, response_guidelines: e.target.value }))
                    }
                    rows={3}
                    placeholder="Keep replies under three sentences"
                  />
                </div>
                <div className="mcm-asst-f">
                  <Label htmlFor="asst-guardrails">Guardrails</Label>
                  <p className="mcm-asst-f-p">What it must never do. One per line.</p>
                  <textarea
                    id="asst-guardrails"
                    className="mcm-asst-ta"
                    value={form.guardrails}
                    onChange={(e) => setForm((f) => ({ ...f, guardrails: e.target.value }))}
                    rows={3}
                    placeholder="Never share pricing without approval"
                  />
                </div>
              </div>
            </details>

            {error ? (
              <div className="mcm-cpg-error" role="alert">
                <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
                {error}
              </div>
            ) : null}
          </div>

          <div className="mcm-asst-dlg-f">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isSaving || !form.name.trim()}
              onClick={handleSave}
            >
              {isSaving ? 'Saving…' : editingId ? 'Save changes' : 'Create assistant'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default CaptainAssistants;
