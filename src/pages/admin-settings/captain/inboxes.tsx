import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bot,
  ChevronDown,
  Globe,
  MessageSquare,
  MessagesSquare,
  Plus,
  Search,
  Send,
  Settings2,
  Trash2,
  TriangleAlert,
  User,
  UserCheck,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useUser } from '@/hooks/use-user';
import { useSelectedAssistant } from './assistant-switcher';
import InboxDetail, { InboxSummary } from './inbox-detail';
import AddInboxWizard from './add-inbox-wizard';
import '@/components/mcm/mcm-page.css';

/**
 * Captain — Inboxes.
 *
 * The places a customer can start a conversation, and the conversations
 * themselves.
 *
 * The conversation viewer was in this file twice: two dialogs of about 110
 * lines each, character-identical apart from which state they read, plus a full
 * parallel set of state and handlers behind each — one for inboxes and one for
 * the legacy per-assistant widget. Both then called the same
 * `/widget-conversations/:id` endpoints to read a thread, reply and hand back;
 * only the very first fetch differed. Two copies of a takeover UI is two places
 * for "reply as a human" to drift.
 *
 * It is one viewer and one set of state now, and opening it picks the URL.
 */

const CAPTAIN_API_BASE = '/captain-api/api/captain';

type ChannelToggle = { channel_type: string; enabled: boolean };
type Conversation = {
  id: string;
  visitor_name: string | null;
  page_url: string | null;
  owner: 'ai' | 'human' | null;
  last_message: string | null;
  last_message_at: string | null;
};
type WidgetMessage = { id: string; role: 'visitor' | 'assistant' | 'agent'; content: string; created_at: string };

const CaptainInboxes = () => {
  const { user } = useUser();
  const { assistants, selectedId, selectAssistant } = useSelectedAssistant();
  const [, setToggles] = useState<Record<string, boolean>>({});
  const [, setIsLoading] = useState(true);
  const [, setSavingChannel] = useState<string | null>(null);
  const [error, setError] = useState('');

  // The open inbox (and which of its tabs is active) lives in the URL, not
  // local state — so refreshing, sharing a link, or using browser back/forward
  // all land you back on the exact same screen. Required for a production
  // deployment serving many customers, not just a single admin's live session.
  const navigate = useNavigate();
  const { inboxId: activeInboxId } = useParams<{ inboxId?: string; tab?: string }>();
  const goToInboxList = () => navigate('/admin-settings/captain/inboxes');
  const goToInbox = (id: string) => navigate(`/admin-settings/captain/inboxes/${id}`);

  // Real multi-inbox model — any number of independent website chatbots,
  // decoupled from any single assistant, same shape as floatchat's real
  // Inbox entity. Lives alongside the legacy single-widget-per-assistant flow
  // below untouched, so the widget already embedded on a live site keeps working.
  const [inboxes, setInboxes] = useState<InboxSummary[]>([]);
  const [isLoadingInboxes, setIsLoadingInboxes] = useState(true);
  const [isAddInboxOpen, setIsAddInboxOpen] = useState(false);
  /* `conversationsInboxId` used to live here, holding only the id so the dialog
     could know it was open. `openInbox` below holds the inbox itself, which is
     what lets the viewer name the inbox in its header. */
  const [inboxSearch, setInboxSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  /* Which row is asking "are you sure". Inline rather than window.confirm: this
     one stops a script that is live on a customer's website, and an OS dialog
     cannot name which inbox it means. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchInboxes = async () => {
    setIsLoadingInboxes(true);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/inboxes`);
      const json = await res.json();
      setInboxes(json?.data || []);
    } catch {
      setInboxes([]);
    } finally {
      setIsLoadingInboxes(false);
    }
  };

  useEffect(() => {
    fetchInboxes();
  }, []);

  const deleteInbox = async (id: string) => {
    setConfirmDeleteId(null);
    try {
      await fetch(`${CAPTAIN_API_BASE}/inboxes/${id}`, { method: 'DELETE' });
      setInboxes((prev) => prev.filter((i) => i.id !== id));
    } catch {
      // non-critical
    }
  };

  const toggleInboxEnabled = async (id: string, next: boolean) => {
    setInboxes((prev) => prev.map((i) => (i.id === id ? { ...i, enabled: next } : i)));
    try {
      await fetch(`${CAPTAIN_API_BASE}/inboxes/${id}/toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
    } catch {
      setInboxes((prev) => prev.map((i) => (i.id === id ? { ...i, enabled: !next } : i)));
    }
  };

  // A legacy row (the one pre-existing widget embedded via data-assistant-id,
  // migrated into this list purely for display/management) routes its
  // actions to the original per-assistant config path instead of the new
  // per-inbox one, so the already-live embed script is never at risk of
  // drifting out of sync with what's shown here.
  const handleLegacyToggle = (row: InboxSummary, next: boolean) => {
    setInboxes((prev) => prev.map((i) => (i.id === row.id ? { ...i, enabled: next } : i)));
    handleToggle('website', next, row.legacy_assistant_id || undefined);
  };

  const groupedInboxes = useMemo(() => {
    const q = inboxSearch.trim().toLowerCase();
    const filtered = inboxes.filter((i) => !q || i.name.toLowerCase().includes(q) || (i.website_domain || '').toLowerCase().includes(q));
    const groups: Record<string, InboxSummary[]> = {};
    filtered.forEach((i) => {
      const key = i.channel_type || 'website';
      groups[key] = groups[key] || [];
      groups[key].push(i);
    });
    return groups;
  }, [inboxes, inboxSearch]);

  /* One set of conversation state for both kinds of inbox. Reading a thread,
     replying and handing back are the same three endpoints either way; only the
     list fetch differs, and that is decided in `openConversations`. */
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [thread, setThread] = useState<WidgetMessage[]>([]);
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  /* The inbox whose conversations are open, and what to call it in the dialog
     header — which was previously nowhere, so the viewer never said which
     inbox you were looking at. */
  const [openInbox, setOpenInbox] = useState<InboxSummary | null>(null);

  const fetchToggles = async (assistantId: string) => {
    if (!assistantId) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/inbox-channels?assistant_id=${assistantId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to load channels');
      const map: Record<string, boolean> = {};
      (json.data as ChannelToggle[]).forEach((c) => {
        map[c.channel_type] = c.enabled;
      });
      setToggles(map);
    } catch (err: any) {
      setError(err?.message || 'Failed to load channels');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedId) fetchToggles(selectedId);
  }, [selectedId]);

  const handleToggle = async (channelType: string, next: boolean, assistantIdOverride?: string) => {
    const targetId = assistantIdOverride || selectedId;
    if (!targetId) return;
    setSavingChannel(channelType);
    setToggles((prev) => ({ ...prev, [channelType]: next }));
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/inbox-channels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistant_id: targetId, channel_type: channelType, enabled: next }),
      });
      if (!res.ok) throw new Error((await res.json())?.message || 'Failed to update channel');
    } catch (err: any) {
      setToggles((prev) => ({ ...prev, [channelType]: !next }));
      setError(err?.message || 'Failed to update channel');
    } finally {
      setSavingChannel(null);
    }
  };

  /* One entry point. A legacy inbox is the single widget that predates the
     multi-inbox model; its conversations hang off the assistant rather than off
     an inbox, so only the list URL forks here. */
  const openConversations = async (inbox: InboxSummary) => {
    setOpenInbox(inbox);
    setActiveConversationId(null);
    setThread([]);
    setConversations([]);

    const legacyAssistantId = inbox.legacy_assistant_id;
    const params = new URLSearchParams();
    if (user?.uuid) params.set('agent_user_id', user.uuid);

    let url: string;
    if (legacyAssistantId) {
      if (legacyAssistantId !== selectedId) selectAssistant(legacyAssistantId);
      params.set('assistant_id', legacyAssistantId);
      url = `${CAPTAIN_API_BASE}/widget-conversations?${params.toString()}`;
    } else {
      url = `${CAPTAIN_API_BASE}/inboxes/${inbox.id}/conversations?${params.toString()}`;
    }

    try {
      const res = await fetch(url);
      const json = await res.json();
      setConversations(json.data || []);
    } catch {
      setConversations([]);
    }
  };

  const openThread = async (id: string) => {
    setActiveConversationId(id);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/widget-conversations/${id}/messages`);
      const json = await res.json();
      setThread(json.data || []);
    } catch {
      setThread([]);
    }
  };

  const handleReply = async () => {
    if (!activeConversationId || !replyText.trim()) return;
    setIsReplying(true);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/widget-conversations/${activeConversationId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to send reply');
      setThread((prev) => [...prev, { id: json.data.id, role: 'agent', content: replyText.trim(), created_at: new Date().toISOString() }]);
      setReplyText('');
      setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, owner: 'human' } : c)));
    } catch (err: any) {
      setError(err?.message || 'Failed to send reply');
    } finally {
      setIsReplying(false);
    }
  };

  const handBackToAi = async () => {
    if (!activeConversationId) return;
    try {
      await fetch(`${CAPTAIN_API_BASE}/widget-conversations/${activeConversationId}/hand-back-to-ai`, { method: 'POST' });
      setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, owner: 'ai' } : c)));
    } catch {
      // non-critical
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;

  const CHANNEL_GROUP_META: Record<string, { label: string; icon: any }> = {
    website: { label: 'Website', icon: MessageSquare },
  };

  // Placed after every hook in this component (never before) — React requires
  // the same hooks to run in the same order on every render, and an early
  // return above any hook declaration violates that the moment this branch
  // becomes true, which is exactly what made "Configure" crash to the app's
  // generic error page instead of opening the settings view.
  if (activeInboxId) {
    return (
      <InboxDetail
        inboxId={activeInboxId}
        assistants={assistants}
        onBack={() => {
          goToInboxList();
          fetchInboxes();
        }}
      />
    );
  }

  return (
    <section className="mcm-adminpage mcm-inb">
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">Captain</div>
          <h1>Inboxes</h1>
          <p>
            Where customers can start a conversation. Each inbox is its own chat widget, with its
            own assistant and its own site.
          </p>
        </div>
        <div className="mcm-adminpage-actions">
          <Button type="button" variant="primary" onClick={() => setIsAddInboxOpen(true)}>
            <Plus className="size-4" />
            Add inbox
          </Button>
        </div>
      </div>

      <div className="mcm-act-bar">
        <div className="mcm-faq-search">
          <Search size={15} strokeWidth={2} aria-hidden="true" />
          <input
            type="text"
            value={inboxSearch}
            onChange={(e) => setInboxSearch(e.target.value)}
            placeholder="Search inboxes"
            aria-label="Search inboxes"
          />
        </div>
        <span className="mcm-inb-count">
          {inboxes.filter((i) => i.enabled).length} of {inboxes.length} live
        </span>
      </div>

      {error ? (
        <div className="mcm-cpg-error" role="alert">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <div className="mcm-inb-body">
        {isLoadingInboxes ? (
          <div className="mcm-inb-blank">Loading inboxes…</div>
        ) : inboxes.length === 0 ? (
          <div className="mcm-inb-blank">
            <span className="mcm-inb-blank-mark">
              <MessageSquare size={22} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h2>No inboxes yet</h2>
            <p>
              An inbox is the chat widget you embed on a site. Add one and you will get a script to
              paste.
            </p>
            <Button type="button" variant="primary" onClick={() => setIsAddInboxOpen(true)}>
              <Plus className="size-4" />
              Add inbox
            </Button>
          </div>
        ) : Object.keys(groupedInboxes).length === 0 ? (
          <div className="mcm-inb-blank">
            <span className="mcm-inb-blank-mark">
              <Search size={22} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h2>Nothing matches “{inboxSearch}”</h2>
            <p>Try the inbox name or its domain.</p>
          </div>
        ) : (
          Object.entries(groupedInboxes).map(([channelType, rows]) => {
            const meta = CHANNEL_GROUP_META[channelType] || { label: channelType, icon: Globe };
            const GroupIcon = meta.icon;
            const isCollapsed = collapsedGroups[channelType];
            return (
              <section className="mcm-inb-group" key={channelType}>
                <button
                  type="button"
                  className="mcm-inb-grouph"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsedGroups((prev) => ({ ...prev, [channelType]: !prev[channelType] }))
                  }
                >
                  <ChevronDown
                    size={15}
                    strokeWidth={2.25}
                    className={isCollapsed ? 'is-shut' : undefined}
                    aria-hidden="true"
                  />
                  <GroupIcon size={15} strokeWidth={2} aria-hidden="true" />
                  {meta.label}
                  <span>{rows.length}</span>
                </button>

                {!isCollapsed && (
                  <ul className="mcm-inb-list">
                    {rows.map((inbox) => {
                      const isLegacy = !!inbox.legacy_assistant_id;
                      return (
                        <li
                          className={`mcm-inb-row ${inbox.enabled ? '' : 'is-off'}`}
                          key={inbox.id}
                        >
                          <span className="mcm-inb-mark" aria-hidden="true">
                            <MessageSquare size={15} strokeWidth={2} />
                          </span>

                          <div className="mcm-inb-main">
                            <div className="mcm-inb-t">
                              <h3>{inbox.name}</h3>
                              {/* Live or not is the fact this row exists to
                                  report — a switch alone states it only if you
                                  already know which way is on. */}
                              <span
                                className={`mcm-inb-state ${inbox.enabled ? 'is-live' : 'is-off'}`}
                              >
                                {inbox.enabled ? 'Live' : 'Paused'}
                              </span>
                              {isLegacy ? (
                                <span
                                  className="mcm-inb-legacy"
                                  title="Embedded before inboxes existed. It is managed through its assistant, not through this inbox."
                                >
                                  Original widget
                                </span>
                              ) : null}
                            </div>
                            <div className="mcm-inb-meta">
                              {inbox.website_domain ? (
                                <>
                                  <Globe size={12} strokeWidth={2} aria-hidden="true" />
                                  <span>{inbox.website_domain}</span>
                                </>
                              ) : null}
                              {inbox.assistant_name ? (
                                <>
                                  <i aria-hidden="true" />
                                  <Bot size={12} strokeWidth={2} aria-hidden="true" />
                                  <span>{inbox.assistant_name}</span>
                                </>
                              ) : null}
                            </div>
                          </div>

                          <div className="mcm-inb-acts">
                            {confirmDeleteId === inbox.id ? (
                              <div className="mcm-act-confirm">
                                <span>Delete? The embed stops working.</span>
                                <button type="button" onClick={() => setConfirmDeleteId(null)}>
                                  Keep
                                </button>
                                <button
                                  type="button"
                                  className="is-go"
                                  onClick={() => deleteInbox(inbox.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="mcm-inb-btn"
                                  onClick={() => openConversations(inbox)}
                                  aria-label={`Conversations in ${inbox.name}`}
                                  title="Conversations"
                                >
                                  <MessagesSquare className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  className="mcm-inb-btn"
                                  onClick={() => goToInbox(inbox.id)}
                                  aria-label={`Configure ${inbox.name}`}
                                  title="Configure"
                                >
                                  <Settings2 className="size-4" />
                                </button>
                                {!isLegacy && (
                                  <button
                                    type="button"
                                    className="mcm-act-kill"
                                    onClick={() => setConfirmDeleteId(inbox.id)}
                                    aria-label={`Delete ${inbox.name}`}
                                    title="Delete"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                )}
                                <Switch
                                  checked={inbox.enabled}
                                  aria-label={`${inbox.enabled ? 'Pause' : 'Start'} ${inbox.name}`}
                                  onCheckedChange={(c) =>
                                    isLegacy
                                      ? handleLegacyToggle(inbox, c === true)
                                      : toggleInboxEnabled(inbox.id, c === true)
                                  }
                                />
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>

      <AddInboxWizard
        open={isAddInboxOpen}
        onClose={() => setIsAddInboxOpen(false)}
        assistants={assistants}
        onDone={() => {
          setIsAddInboxOpen(false);
          fetchInboxes();
        }}
        onOpenSettings={(inboxId) => {
          setIsAddInboxOpen(false);
          fetchInboxes();
          goToInbox(inboxId);
        }}
      />

      {/* One viewer, for both kinds of inbox. */}
      <Dialog open={!!openInbox} onOpenChange={(v) => !v && setOpenInbox(null)}>
        <DialogContent className="mcm-inb-dlg w-full max-w-3xl p-0">
          <div className="mcm-inb-dlg-side">
            <div className="mcm-inb-dlg-sideh">
              <DialogTitle>Conversations</DialogTitle>
              {/* Which inbox these belong to. The old viewer never said. */}
              <p>{openInbox?.name}</p>
            </div>
            {conversations.length === 0 ? (
              <div className="mcm-inb-dlg-none">
                Nothing here yet, or none of it is assigned to you.
              </div>
            ) : (
              <ul>
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openThread(c.id)}
                      className={activeConversationId === c.id ? 'is-on' : undefined}
                    >
                      <span className="mcm-inb-who">
                        {c.owner === 'human' ? (
                          <UserCheck size={12} strokeWidth={2.25} className="is-human" />
                        ) : (
                          <Bot size={12} strokeWidth={2.25} className="is-ai" />
                        )}
                        {c.visitor_name || 'Visitor'}
                      </span>
                      <span className="mcm-inb-last">{c.last_message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mcm-inb-dlg-main">
            <div className="mcm-inb-dlg-mainh">
              <div>
                <h3>{activeConversation ? activeConversation.visitor_name || 'Visitor' : 'Pick a conversation'}</h3>
                {activeConversation?.page_url ? (
                  <p>{activeConversation.page_url}</p>
                ) : null}
              </div>
              {activeConversation?.owner === 'human' ? (
                <Button type="button" variant="outline" size="sm" onClick={handBackToAi}>
                  Hand back to AI
                </Button>
              ) : null}
            </div>

            <div className="mcm-inb-thread">
              {thread.map((m) => (
                <div
                  className={`mcm-inb-turn ${m.role === 'visitor' ? 'is-them' : m.role === 'agent' ? 'is-agent' : 'is-ai'}`}
                  key={m.id}
                >
                  <span className="mcm-inb-avatar" aria-hidden="true">
                    {m.role === 'visitor' ? (
                      <User size={13} strokeWidth={2} />
                    ) : m.role === 'agent' ? (
                      <UserCheck size={13} strokeWidth={2} />
                    ) : (
                      <Bot size={13} strokeWidth={2} />
                    )}
                  </span>
                  <div className="mcm-inb-side">
                    {/* Three speakers, and two of them are on your side. Which
                        of your two answered is the thing this screen is for. */}
                    <span className="mcm-inb-role">
                      {m.role === 'visitor' ? 'Visitor' : m.role === 'agent' ? 'You' : 'Assistant'}
                    </span>
                    <div className="mcm-inb-bubble">{m.content}</div>
                  </div>
                </div>
              ))}
              {activeConversationId && !thread.length ? (
                <div className="mcm-inb-dlg-none">No messages yet.</div>
              ) : null}
              {!activeConversationId ? (
                <div className="mcm-inb-dlg-none">
                  Choose a conversation to read it, and to reply as a person.
                </div>
              ) : null}
            </div>

            {activeConversationId ? (
              <div className="mcm-inb-reply">
                <div className="mcm-cpg-field">
                  <textarea
                    rows={1}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.shiftKey) return;
                      e.preventDefault();
                      handleReply();
                    }}
                    placeholder="Reply as a person…"
                    aria-label="Reply as a person"
                  />
                  <button
                    type="button"
                    className="mcm-cpg-send"
                    onClick={handleReply}
                    disabled={isReplying || !replyText.trim()}
                  >
                    <Send size={15} strokeWidth={2} aria-hidden="true" />
                    <span>Send</span>
                  </button>
                </div>
                {/* Replying is what takes the conversation off the assistant,
                    which the old composer did without saying so. */}
                <p className="mcm-inb-note">
                  {activeConversation?.owner === 'human'
                    ? 'You have taken this over. The assistant will not reply until you hand it back.'
                    : 'Sending takes this conversation off the assistant.'}
                </p>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default CaptainInboxes;
