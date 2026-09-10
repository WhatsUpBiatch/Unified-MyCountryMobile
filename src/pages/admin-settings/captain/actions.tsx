import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Lock,
  LockOpen,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AssistantSwitcher, useSelectedAssistant } from './assistant-switcher';
import '@/components/mcm/mcm-page.css';
import { Picker } from '@/components/mcm/picker';
import { BrandMark, hasBrandMark } from '@/components/mcm/brand-mark';

/**
 * Captain — Actions.
 *
 * What the assistant may do beyond answering: connected third-party apps, the
 * individual actions inside them, and hand-built HTTP tools.
 *
 * The security tier control was written out twice — once for a connected app's
 * actions and once for custom tools — as ~45 lines each of hand-rolled popover
 * with a `fixed inset-0` div for a backdrop, reachable only by mouse. It is one
 * component now, on the menu primitive this file already had.
 */

const CAPTAIN_API_BASE = '/captain-api/api/captain';

type Param = { name: string; type: string; description: string; required: boolean };
type Tool = {
  id: string;
  assistant_id: string;
  slug: string;
  title: string;
  description: string | null;
  http_method: 'GET' | 'POST';
  endpoint_url: string;
  request_template: string | null;
  response_template: string | null;
  auth_type: 'none' | 'bearer' | 'basic' | 'header' | 'api_key';
  auth_config: Record<string, string>;
  param_schema: Param[];
  config: { data_access?: 'full' | 'limited'; allowed_response_fields?: string[] };
  operation_type: 'read' | 'write';
  security_tier: 'open' | 'standard' | 'secure' | null;
  enabled: boolean;
  kind: 'http' | 'composio';
  composio_tool_slug: string | null;
  composio_connection_id: string | null;
};

type Toolkit = { slug: string; name: string; description: string; logo: string | null; tools_count: number; categories: string[] };
type Connection = { id: string; toolkit_slug: string; toolkit_name: string; connected_account_id: string; status: string };
type ComposioAction = {
  id: string | null;
  slug: string;
  name: string;
  description: string;
  input_parameters: any;
  enabled: boolean;
  operation_type: 'read' | 'write';
  security_tier: 'open' | 'standard' | 'secure' | null;
};

type SecurityTier = 'open' | 'standard' | 'secure';

/* How sure Captain has to be who it is talking to before it will run a read.
   The wording says what the visitor must do, not what the tier is called —
   "Standard" on its own tells nobody anything. */
const TIER_META: Record<SecurityTier, { label: string; desc: string; icon: any; tone: string }> = {
  open: {
    label: 'Anyone',
    desc: 'No check. The assistant answers whoever is asking.',
    icon: LockOpen,
    tone: 'is-open',
  },
  standard: {
    label: 'Known email',
    desc: 'Only once the visitor has given an email address.',
    icon: Lock,
    tone: 'is-standard',
  },
  secure: {
    label: 'Verified by SMS',
    desc: 'Needs a one-time code. No SMS provider is wired up yet.',
    icon: ShieldCheck,
    tone: 'is-secure',
  },
};

const STAFF_ONLY_NOTE =
  'This action changes data, so it is never offered to customers — staff only.';

/* A connection is one of three things, and the old pill said so in the API's
   own words: ACTIVE, INITIALIZING, FAILED. */
const CONN_STATE: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: 'Connected', tone: 'is-live' },
  INITIALIZING: { label: 'Finishing up', tone: 'is-work' },
  FAILED: { label: 'Not connected', tone: 'is-bad' },
};

/* Two letters off the app's name, matching the assistant marks elsewhere in
   Captain — a catalogue whose logos have not loaded should not be a column of
   identical plug icons. */
const initials = (name: string) => (name.trim().slice(0, 2) || '?').toUpperCase();

/* Which mark a tile draws, in order of how current it is: the logo the API
   sent, then one of the marks this app ships, then the initials that were
   there before. A backend that knows the toolkit's logo outranks anything
   compiled in; a platform nobody has a mark for still renders. */
const AppLogo = ({
  slug,
  name,
  logo,
}: {
  slug?: string;
  name?: string;
  logo?: string | null;
}) => {
  if (logo) return <img src={logo} alt="" />;
  if (hasBrandMark(slug || '', name)) return <BrandMark slug={slug || ''} name={name} />;
  return <>{initials(name || '')}</>;
};

/* The security tier control, once. Built on the menu primitive rather than a
   hand-rolled popover with a full-screen backdrop div: that version could only
   be opened with a mouse, trapped no focus, and closed by clicking an
   invisible element covering the page. */
const TierPicker = ({
  value,
  onChange,
}: {
  value: SecurityTier | null;
  onChange: (level: SecurityTier) => void;
}) => {
  const meta = value ? TIER_META[value] : null;
  const Icon = meta?.icon || LockOpen;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`mcm-act-tier ${meta?.tone || 'is-none'}`}
        aria-label="Who may trigger this action"
      >
        <Icon size={12} strokeWidth={2.25} aria-hidden="true" />
        {meta?.label || 'Not set'}
        <ChevronDown size={12} strokeWidth={2.5} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="mcm-act-tiermenu">
        <div className="mcm-act-tiermenu-h">Who may trigger this</div>
        {(['open', 'standard', 'secure'] as const).map((level) => {
          const item = TIER_META[level];
          const ItemIcon = item.icon;
          return (
            <DropdownMenuItem
              key={level}
              onClick={() => onChange(level)}
              className={value === level ? 'is-on' : undefined}
            >
              <ItemIcon size={15} strokeWidth={2} aria-hidden="true" />
              <span>
                <b>{item.label}</b>
                {item.desc}
              </span>
              {value === level ? (
                <Check size={14} strokeWidth={2.5} aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const emptyForm = {
  title: '',
  description: '',
  http_method: 'GET' as 'GET' | 'POST',
  endpoint_url: '',
  request_template: '',
  response_template: '',
  auth_type: 'none' as Tool['auth_type'],
  auth_config: {} as Record<string, string>,
  param_schema: [] as Param[],
  data_access: 'full' as 'full' | 'limited',
  allowed_response_fields: '',
  operation_type: 'write' as 'read' | 'write',
  enabled: true,
};

const textAreaClass =
  'w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10';

const CaptainActions = () => {
  const { assistants, selectedId, selectAssistant } = useSelectedAssistant();
  const [mainTab, setMainTab] = useState<'my-actions' | 'create-action'>('my-actions');
  const [actionsSearch, setActionsSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [tools, setTools] = useState<Tool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  const [samplePayload, setSamplePayload] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Composio — real third-party app connections (Gmail, Slack, GitHub, ...),
  // same shape as floatchat's real Composio setup. Connect an app via OAuth,
  // then browse and enable its real actions; enabled ones become ordinary
  // rows in `tools` above (kind: 'composio') and flow through the exact same
  // tool-calling loop as manual HTTP Actions.
  const [connections, setConnections] = useState<Connection[]>([]);
  const [toolkitSearch, setToolkitSearch] = useState('');
  const [toolkits, setToolkits] = useState<Toolkit[]>([]);
  const [isLoadingToolkits, setIsLoadingToolkits] = useState(false);
  const [isConnecting, setIsConnecting] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<string | null>(null);
  const [browseConnection, setBrowseConnection] = useState<Connection | null>(null);
  const [browseActions, setBrowseActions] = useState<ComposioAction[]>([]);
  const [isLoadingActions, setIsLoadingActions] = useState(false);
  const [browseSearch, setBrowseSearch] = useState('');
  /* Which row is asking "are you sure", one per list. Held here rather than in
     the rows so opening a second confirmation closes the first. */
  const [confirmToolId, setConfirmToolId] = useState<string | null>(null);
  const [confirmConnId, setConfirmConnId] = useState<string | null>(null);

  const fetchConnections = async (assistantId: string) => {
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/composio/connections?assistant_id=${assistantId}`);
      const json = await res.json();
      setConnections(json.data || []);
    } catch {
      setConnections([]);
    }
  };

  const searchToolkits = async (q: string) => {
    setIsLoadingToolkits(true);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/composio/toolkits${q ? `?search=${encodeURIComponent(q)}` : ''}`);
      const json = await res.json();
      setToolkits((json.data || []).slice(0, 24));
    } catch {
      setToolkits([]);
    } finally {
      setIsLoadingToolkits(false);
    }
  };

  const connectToolkit = async (toolkit: Toolkit) => {
    if (!selectedId) return;
    setIsConnecting(toolkit.slug);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/composio/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistant_id: selectedId, toolkit_slug: toolkit.slug, toolkit_name: toolkit.name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to start connection');

      // A real iframe-embedded sign-in isn't possible here — Google (and most
      // OAuth providers) refuse to render their login page inside a frame at
      // all, on any site. The closest to "stays in this screen" that's
      // actually achievable is a centered popup window rather than a full
      // new browser tab — same approach WhatsApp's own Embedded Signup and
      // "Sign in with Google" use. It also auto-refreshes status on close, so
      // there's no separate "Check status" click needed once you finish.
      const width = 520;
      const height = 680;
      const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
      const popup = window.open(
        json.data.redirect_url,
        'composio-connect',
        `width=${width},height=${height},left=${left},top=${top},noopener`,
      );
      await fetchConnections(selectedId);

      if (popup) {
        const poll = setInterval(() => {
          if (popup.closed) {
            clearInterval(poll);
            if (selectedId) fetchConnections(selectedId);
          }
        }, 800);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to start connection');
    } finally {
      setIsConnecting(null);
    }
  };

  const refreshConnection = async (conn: Connection) => {
    setIsRefreshing(conn.id);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/composio/connections/${conn.id}/refresh`, { method: 'POST' });
      const json = await res.json();
      setConnections((prev) => prev.map((c) => (c.id === conn.id ? { ...c, status: json.data.status } : c)));
    } catch {
      // non-critical
    } finally {
      setIsRefreshing(null);
    }
  };

  const disconnectApp = async (conn: Connection) => {
    setConfirmConnId(null);
    try {
      await fetch(`${CAPTAIN_API_BASE}/composio/connections/${conn.id}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((c) => c.id !== conn.id));
      if (selectedId) fetchTools(selectedId);
    } catch {
      // non-critical
    }
  };

  // A connection that expired (or failed) before OAuth was ever completed is
  // permanently dead on Composio's side — re-checking its status can never
  // turn it ACTIVE. The only fix is a brand new connect link, so this drops
  // the dead row and starts over rather than leaving a stuck "Check status" button.
  const reconnectApp = async (conn: Connection) => {
    try {
      await fetch(`${CAPTAIN_API_BASE}/composio/connections/${conn.id}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((c) => c.id !== conn.id));
    } catch {
      // non-critical — connectToolkit below will surface any real failure
    }
    await connectToolkit({ slug: conn.toolkit_slug, name: conn.toolkit_name, description: '', logo: null, tools_count: 0, categories: [] });
  };

  const openBrowseActions = async (conn: Connection) => {
    if (browseConnection?.id === conn.id) {
      setBrowseConnection(null);
      return;
    }
    setBrowseConnection(conn);
    setBrowseSearch('');
    setIsLoadingActions(true);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/composio/toolkits/${conn.toolkit_slug}/tools?assistant_id=${selectedId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to load actions');
      setBrowseActions(json.data.tools || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load actions');
      setBrowseActions([]);
    } finally {
      setIsLoadingActions(false);
    }
  };

  const toggleComposioAction = async (action: ComposioAction) => {
    if (!browseConnection || !selectedId) return;
    if (action.enabled) {
      const match = action.id || tools.find((t) => t.composio_tool_slug === action.slug && t.composio_connection_id === browseConnection.connected_account_id)?.id;
      if (match) await fetch(`${CAPTAIN_API_BASE}/custom-tools/${match}`, { method: 'DELETE' });
      setBrowseActions((prev) => prev.map((a) => (a.slug === action.slug ? { ...a, enabled: false, id: null, security_tier: null } : a)));
    } else {
      const res = await fetch(`${CAPTAIN_API_BASE}/composio/enable-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistant_id: selectedId, connection_id: browseConnection.connected_account_id,
          composio_tool_slug: action.slug, title: action.name, description: action.description, input_parameters: action.input_parameters,
        }),
      });
      const json = await res.json();
      setBrowseActions((prev) => prev.map((a) => (a.slug === action.slug ? { ...a, enabled: true, id: json.data?.id || null } : a)));
    }
    fetchTools(selectedId);
  };

  // Sets (or clears) the security tier for one browse-panel action, enabling
  // it first if it isn't already — the tier control is available right from
  // this list, same as "My actions", without a separate enable step first.
  const setBrowseActionTier = async (action: ComposioAction, tier: SecurityTier | null) => {
    if (!browseConnection || !selectedId) return;
    let toolId = action.id;
    if (!toolId) {
      const res = await fetch(`${CAPTAIN_API_BASE}/composio/enable-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistant_id: selectedId, connection_id: browseConnection.connected_account_id,
          composio_tool_slug: action.slug, title: action.name, description: action.description, input_parameters: action.input_parameters,
        }),
      });
      const json = await res.json();
      toolId = json.data?.id || null;
    }
    if (!toolId) return;
    await fetch(`${CAPTAIN_API_BASE}/custom-tools/${toolId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: action.name, description: action.description, operation_type: action.operation_type, security_tier: tier }),
    });
    setBrowseActions((prev) => prev.map((a) => (a.slug === action.slug ? { ...a, id: toolId, enabled: true, security_tier: tier } : a)));
    fetchTools(selectedId);
  };

  // Doubles as both the "select all" checkbox above the list and the
  // toolkit-level on/off switch on the app's card — same effect either way:
  // enable (or disable) every one of this app's actions for the assistant.
  const setAllComposioActions = async (enable: boolean) => {
    if (!browseConnection || !selectedId) return;
    const targets = browseActions.filter((a) => a.enabled !== enable);
    if (!targets.length) return;
    setIsLoadingActions(true);
    for (const action of targets) {
      if (enable) {
        // eslint-disable-next-line no-await-in-loop
        await fetch(`${CAPTAIN_API_BASE}/composio/enable-tool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assistant_id: selectedId, connection_id: browseConnection.connected_account_id,
            composio_tool_slug: action.slug, title: action.name, description: action.description, input_parameters: action.input_parameters,
          }),
        });
      } else {
        const match = tools.find((t) => t.composio_tool_slug === action.slug && t.composio_connection_id === browseConnection.connected_account_id);
        // eslint-disable-next-line no-await-in-loop
        if (match) await fetch(`${CAPTAIN_API_BASE}/custom-tools/${match.id}`, { method: 'DELETE' });
      }
    }
    setBrowseActions((prev) => prev.map((a) => ({ ...a, enabled: enable })));
    fetchTools(selectedId);
    setIsLoadingActions(false);
  };

  useEffect(() => {
    searchToolkits('');
  }, []);

  useEffect(() => {
    if (selectedId) fetchConnections(selectedId);
  }, [selectedId]);

  const fetchTools = async (assistantId: string) => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/custom-tools?assistant_id=${assistantId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to load actions');
      setTools(json.data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load actions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedId) fetchTools(selectedId);
  }, [selectedId]);

  // Composio actions are managed per-app inside "Manage" (grouped under their
  // connected app card above) — this list is just the manual/custom HTTP
  // actions, which don't belong to any app.
  const filteredTools = useMemo(() => {
    const q = actionsSearch.trim().toLowerCase();
    const manual = tools.filter((t) => t.kind !== 'composio');
    if (!q) return manual;
    return manual.filter((t) => t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
  }, [tools, actionsSearch]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    toolkits.forEach((tk) => tk.categories.forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [toolkits]);

  const visibleToolkits = useMemo(() => {
    if (categoryFilter === 'all') return toolkits;
    return toolkits.filter((tk) => tk.categories.includes(categoryFilter));
  }, [toolkits, categoryFilter]);

  const connectionFor = (toolkitSlug: string) => connections.find((c) => c.toolkit_slug === toolkitSlug);

  const visibleBrowseActions = useMemo(() => {
    const q = browseSearch.trim().toLowerCase();
    if (!q) return browseActions;
    return browseActions.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
  }, [browseActions, browseSearch]);
  const allBrowseActionsEnabled = browseActions.length > 0 && browseActions.every((a) => a.enabled);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setSamplePayload({});
    setTestResult(null);
    setIsModalOpen(true);
  };

  const openEdit = (t: Tool) => {
    setEditingId(t.id);
    setForm({
      title: t.title,
      description: t.description || '',
      http_method: t.http_method,
      endpoint_url: t.endpoint_url,
      request_template: t.request_template || '',
      response_template: t.response_template || '',
      auth_type: t.auth_type,
      auth_config: t.auth_config || {},
      param_schema: t.param_schema || [],
      data_access: t.config?.data_access || 'full',
      allowed_response_fields: (t.config?.allowed_response_fields || []).join(', '),
      operation_type: t.operation_type,
      enabled: t.enabled,
    });
    setSamplePayload(Object.fromEntries((t.param_schema || []).map((p) => [p.name, ''])));
    setTestResult(null);
    setIsModalOpen(true);
  };

  const addParam = () => setForm((f) => ({ ...f, param_schema: [...f.param_schema, { name: '', type: 'string', description: '', required: false }] }));
  const updateParam = (i: number, changes: Partial<Param>) =>
    setForm((f) => {
      const params = [...f.param_schema];
      params[i] = { ...params[i], ...changes };
      return { ...f, param_schema: params };
    });
  const removeParam = (i: number) => setForm((f) => ({ ...f, param_schema: f.param_schema.filter((_, idx) => idx !== i) }));

  const buildPayload = () => ({
    assistant_id: selectedId,
    title: form.title,
    description: form.description,
    http_method: form.http_method,
    endpoint_url: form.endpoint_url,
    request_template: form.request_template || null,
    response_template: form.response_template || null,
    auth_type: form.auth_type,
    auth_config: form.auth_config,
    param_schema: form.param_schema,
    config: { data_access: form.data_access, allowed_response_fields: form.allowed_response_fields.split(',').map((s) => s.trim()).filter(Boolean) },
    operation_type: form.operation_type,
    enabled: form.enabled,
  });

  const handleSave = async () => {
    if (!form.title.trim() || !form.endpoint_url.trim()) return;
    setIsSaving(true);
    setError('');
    try {
      const url = editingId ? `${CAPTAIN_API_BASE}/custom-tools/${editingId}` : `${CAPTAIN_API_BASE}/custom-tools`;
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) throw new Error((await res.json())?.message || 'Failed to save action');
      setIsModalOpen(false);
      if (selectedId) fetchTools(selectedId);
    } catch (err: any) {
      setError(err?.message || 'Failed to save action');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmToolId(null);
    try {
      await fetch(`${CAPTAIN_API_BASE}/custom-tools/${id}`, { method: 'DELETE' });
      setTools((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // non-critical
    }
  };

  const handleToggleEnabled = async (t: Tool, next: boolean) => {
    setTools((prev) => prev.map((x) => (x.id === t.id ? { ...x, enabled: next } : x)));
    try {
      await fetch(`${CAPTAIN_API_BASE}/custom-tools/${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...t, enabled: next }),
      });
    } catch {
      setTools((prev) => prev.map((x) => (x.id === t.id ? { ...x, enabled: !next } : x)));
    }
  };

  /* The two "which popover is open" flags that used to live here are gone:
     TierPicker keeps its own open state, so the page no longer tracks the
     internals of a control it only needs a value from. */

  const setSecurityTier = async (t: Tool, tier: SecurityTier | null) => {
    /* Closing the popover by hand went with it — Radix dismisses the menu when
       an item is chosen. */
    setTools((prev) => prev.map((x) => (x.id === t.id ? { ...x, security_tier: tier } : x)));
    try {
      await fetch(`${CAPTAIN_API_BASE}/custom-tools/${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...t, security_tier: tier }),
      });
    } catch {
      setTools((prev) => prev.map((x) => (x.id === t.id ? { ...x, security_tier: t.security_tier } : x)));
    }
  };

  const runTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/custom-tools/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildPayload(), sample_params: samplePayload }),
      });
      const json = await res.json();
      setTestResult(res.ok ? json.data.result : `Error: ${json.message}`);
    } catch (err: any) {
      setTestResult(`Error: ${err?.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <section className="mcm-adminpage mcm-act">
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">Captain</div>
          <h1>Actions</h1>
          {/* The old header ran to four lines listing every category Composio
              supports. The catalogue below already lists them, and it is
              searchable. */}
          <p>
            What the assistant is allowed to do, beyond answering. Connect an app or point it at
            your own API.
          </p>
        </div>
        <div className="mcm-adminpage-actions">
          <AssistantSwitcher
            assistants={assistants}
            selectedId={selectedId}
            onSelect={selectAssistant}
          />
        </div>
      </div>

      <div className="mcm-act-bar">
        <div className="mcm-faq-filters">
          <button
            type="button"
            className={mainTab === 'my-actions' ? 'is-on' : undefined}
            onClick={() => setMainTab('my-actions')}
          >
            <Zap size={13} strokeWidth={2.25} aria-hidden="true" />
            In use
            <span>{connections.length + filteredTools.length}</span>
          </button>
          <button
            type="button"
            className={mainTab === 'create-action' ? 'is-on' : undefined}
            onClick={() => setMainTab('create-action')}
          >
            <Plus size={13} strokeWidth={2.25} aria-hidden="true" />
            Add an action
          </button>
        </div>

        {/* One search box in one place, searching whichever list is on screen —
            the two tabs each had their own, in the same spot, doing different
            things. */}
        <div className="mcm-faq-search">
          <Search size={15} strokeWidth={2} aria-hidden="true" />
          {mainTab === 'my-actions' ? (
            <input
              type="text"
              value={actionsSearch}
              onChange={(e) => setActionsSearch(e.target.value)}
              placeholder="Search your actions"
              aria-label="Search your actions"
            />
          ) : (
            <input
              type="text"
              value={toolkitSearch}
              onChange={(e) => {
                setToolkitSearch(e.target.value);
                searchToolkits(e.target.value);
              }}
              placeholder="Search apps — Gmail, Slack, GitHub…"
              aria-label="Search apps to connect"
            />
          )}
        </div>
      </div>

      {error ? (
        <div className="mcm-cpg-error" role="alert">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <div className="mcm-act-body">
        {mainTab === 'my-actions' ? (
          <>
            {connections.length > 0 ? (
              <section className="mcm-act-sec">
                <h2 className="mcm-act-h">
                  Connected apps
                  <span>{connections.length}</span>
                </h2>
                <div className="mcm-act-apps">
                  {connections.map((conn) => {
                    const tk = toolkits.find((t) => t.slug === conn.toolkit_slug);
                    const state = CONN_STATE[conn.status] || CONN_STATE.FAILED;
                    const isOpen = browseConnection?.id === conn.id;
                    return (
                      <article
                        className={`mcm-act-app ${state.tone} ${isOpen ? 'is-open' : ''}`}
                        key={conn.id}
                      >
                        <header>
                          <span className="mcm-act-logo" aria-hidden="true">
                            <AppLogo
                              slug={conn.toolkit_slug}
                              name={conn.toolkit_name}
                              logo={tk?.logo}
                            />
                          </span>
                          <div>
                            <h3>{conn.toolkit_name}</h3>
                            <span className={`mcm-act-connstate ${state.tone}`}>{state.label}</span>
                          </div>
                        </header>
                        <p>{tk?.description || 'Connected app'}</p>
                        <footer>
                          {conn.status === 'ACTIVE' ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openBrowseActions(conn)}
                            >
                              {isOpen ? 'Close' : 'Choose actions'}
                            </Button>
                          ) : conn.status === 'INITIALIZING' ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => refreshConnection(conn)}
                              disabled={isRefreshing === conn.id}
                            >
                              <RefreshCw className="size-3.5" />
                              {isRefreshing === conn.id ? 'Checking…' : 'Check again'}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => reconnectApp(conn)}
                              disabled={isConnecting === conn.toolkit_slug}
                            >
                              {isConnecting === conn.toolkit_slug ? 'Opening…' : 'Reconnect'}
                            </Button>
                          )}

                          {confirmConnId === conn.id ? (
                            <div className="mcm-act-confirm">
                              <span>Disconnect?</span>
                              <button type="button" onClick={() => setConfirmConnId(null)}>
                                Keep
                              </button>
                              <button
                                type="button"
                                className="is-go"
                                onClick={() => disconnectApp(conn)}
                              >
                                Disconnect
                              </button>
                            </div>
                          ) : (
                            /* A real button. This was a <span onClick>, which
                               no keyboard could reach and no screen reader
                               announced — on the control that severs an
                               integration. */
                            <button
                              type="button"
                              className="mcm-act-kill"
                              onClick={() => setConfirmConnId(conn.id)}
                              aria-label={`Disconnect ${conn.toolkit_name}`}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </footer>
                      </article>
                    );
                  })}
                </div>

                {browseConnection ? (
                  <div className="mcm-act-browse">
                    <div className="mcm-act-browse-h">
                      <div>
                        <h3>What {browseConnection.toolkit_name} may do</h3>
                        <p>Only what is switched on here can be called by this assistant.</p>
                      </div>
                      <label className="mcm-act-all">
                        <span>Everything</span>
                        <Switch
                          checked={allBrowseActionsEnabled}
                          onCheckedChange={(c) => setAllComposioActions(c === true)}
                        />
                      </label>
                      <button
                        type="button"
                        className="mcm-act-kill"
                        onClick={() => setBrowseConnection(null)}
                        aria-label="Close"
                      >
                        <X className="size-4" />
                      </button>
                    </div>

                    {isLoadingActions ? (
                      <div className="mcm-act-mini-blank">Loading actions…</div>
                    ) : (
                      <>
                        <div className="mcm-faq-search mcm-act-browse-search">
                          <Search size={15} strokeWidth={2} aria-hidden="true" />
                          <input
                            type="text"
                            value={browseSearch}
                            onChange={(e) => setBrowseSearch(e.target.value)}
                            placeholder={`Search ${browseConnection.toolkit_name} actions`}
                            aria-label="Search this app's actions"
                          />
                        </div>
                        <ul className="mcm-act-mini">
                          {visibleBrowseActions.length === 0 ? (
                            <li className="mcm-act-mini-blank">No actions match that.</li>
                          ) : (
                            visibleBrowseActions.map((a) => (
                              <li key={a.slug} className={a.enabled ? 'is-on' : undefined}>
                                <div className="mcm-act-mini-t">
                                  <b>{a.name}</b>
                                  <code>{a.slug}</code>
                                </div>
                                {a.operation_type === 'read' ? (
                                  <TierPicker
                                    value={a.security_tier}
                                    onChange={(level) => setBrowseActionTier(a, level)}
                                  />
                                ) : (
                                  <span className="mcm-act-staff" title={STAFF_ONLY_NOTE}>
                                    <Lock size={11} strokeWidth={2.25} aria-hidden="true" />
                                    Staff only
                                  </span>
                                )}
                                <Switch
                                  checked={a.enabled}
                                  onCheckedChange={() => toggleComposioAction(a)}
                                />
                              </li>
                            ))
                          )}
                        </ul>
                      </>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

            {isLoading ? null : connections.length === 0 && filteredTools.length === 0 ? (
              <div className="mcm-act-blank">
                <span className="mcm-act-blank-mark">
                  <Zap size={22} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <h2>The assistant can only talk</h2>
                <p>
                  Connect an app, or point it at your own API, and it can look things up and act
                  on them instead of just answering.
                </p>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setMainTab('create-action')}
                  disabled={!selectedId}
                >
                  <Plus className="size-4" />
                  Add an action
                </Button>
              </div>
            ) : filteredTools.length > 0 ? (
              <section className="mcm-act-sec">
                <h2 className="mcm-act-h">
                  Your own APIs
                  <span>{filteredTools.length}</span>
                </h2>
                <ul className="mcm-act-list">
                  {filteredTools.map((t) => (
                    <li className={`mcm-act-row ${t.enabled ? '' : 'is-off'}`} key={t.id}>
                      <span className="mcm-act-kind" aria-hidden="true">
                        {t.kind === 'composio' ? (
                          <Plug size={15} strokeWidth={2} />
                        ) : (
                          <Wrench size={15} strokeWidth={2} />
                        )}
                      </span>

                      <div className="mcm-act-main">
                        <div className="mcm-act-t">
                          <h3>{t.title}</h3>
                          {/* A write action changes something at the other
                              end, which is the one property of an action
                              worth knowing before reading anything else. */}
                          {t.operation_type === 'write' ? (
                            <span className="mcm-act-write">Writes</span>
                          ) : null}
                        </div>
                        {t.description ? <p className="mcm-act-desc">{t.description}</p> : null}
                        <div className="mcm-act-meta">
                          <code>{t.http_method}</code>
                          <span className="mcm-act-url">{t.endpoint_url}</span>
                          <i aria-hidden="true" />
                          <span>{t.auth_type === 'none' ? 'No auth' : `Auth: ${t.auth_type}`}</span>
                        </div>
                      </div>

                      <div className="mcm-act-acts">
                        {confirmToolId === t.id ? (
                          <div className="mcm-act-confirm">
                            <span>Delete?</span>
                            <button type="button" onClick={() => setConfirmToolId(null)}>
                              Keep
                            </button>
                            <button
                              type="button"
                              className="is-go"
                              onClick={() => handleDelete(t.id)}
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <>
                            {t.operation_type === 'read' ? (
                              <TierPicker
                                value={t.security_tier}
                                onChange={(level) => setSecurityTier(t, level)}
                              />
                            ) : (
                              <span className="mcm-act-staff" title={STAFF_ONLY_NOTE}>
                                <Lock size={11} strokeWidth={2.25} aria-hidden="true" />
                                Staff only
                              </span>
                            )}
                            {t.kind !== 'composio' ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openEdit(t)}
                                aria-label={`Edit ${t.title}`}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            ) : null}
                            <button
                              type="button"
                              className="mcm-act-kill"
                              onClick={() => setConfirmToolId(t.id)}
                              aria-label={`Delete ${t.title}`}
                            >
                              <Trash2 className="size-4" />
                            </button>
                            <Switch
                              checked={t.enabled}
                              onCheckedChange={(c) => handleToggleEnabled(t, c === true)}
                              aria-label={`${t.enabled ? 'Disable' : 'Enable'} ${t.title}`}
                            />
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <>
            <div className="mcm-act-cats">
              <button
                type="button"
                className={categoryFilter === 'all' ? 'is-on' : undefined}
                onClick={() => setCategoryFilter('all')}
              >
                All
              </button>
              {/* Categories come from whatever the catalogue returns, so this
                  is a scrolling row rather than a fixed set. */}
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={categoryFilter === c ? 'is-on' : undefined}
                  onClick={() => setCategoryFilter(c)}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="mcm-act-apps">
              <button
                type="button"
                onClick={openCreate}
                disabled={!selectedId}
                className="mcm-act-app is-custom"
              >
                <header>
                  <span className="mcm-act-logo" aria-hidden="true">
                    <Wrench size={15} strokeWidth={2} />
                  </span>
                  <div>
                    <h3>Your own API</h3>
                  </div>
                </header>
                <p>Any HTTP endpoint, with your auth and your own request and response shapes.</p>
              </button>

              {isLoadingToolkits ? (
                <div className="mcm-act-mini-blank">Loading apps…</div>
              ) : (
                visibleToolkits
                  .filter((tk) => !connectionFor(tk.slug))
                  .map((tk) => (
                    <article className="mcm-act-app" key={tk.slug}>
                      <header>
                        <span className="mcm-act-logo" aria-hidden="true">
                          <AppLogo slug={tk.slug} name={tk.name} logo={tk.logo} />
                        </span>
                        <div>
                          <h3>{tk.name}</h3>
                          {tk.tools_count ? (
                            <span className="mcm-act-count">{tk.tools_count} actions</span>
                          ) : null}
                        </div>
                      </header>
                      <p>{tk.description}</p>
                      <footer>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!selectedId || isConnecting === tk.slug}
                          onClick={() => connectToolkit(tk)}
                        >
                          {isConnecting === tk.slug ? 'Opening…' : 'Connect'}
                        </Button>
                      </footer>
                    </article>
                  ))
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="mcm-asst-dlg w-full max-w-2xl p-0">
          <div className="mcm-asst-dlg-h">
            <DialogTitle>{editingId ? 'Edit action' : 'New action'}</DialogTitle>
            <p>
              Describe the call and what it is for. The description is what the assistant reads to
              decide whether to use it.
            </p>
          </div>
          <div className="mcm-asst-dlg-b mcm-doc-dlg-b">
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Get Order Status" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Description (tells the AI when to use this)</Label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className={textAreaClass}
                placeholder="Looks up an order's shipping status by order ID."
              />
            </div>
            <div className="flex gap-3">
              <div className="flex w-32 flex-col gap-1.5">
                <Label>Method</Label>
                <Picker label="Method" showLabel={false} className="mcm-field" value={form.http_method} options={[{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }]} onChange={(o) => setForm((f) => ({ ...f, http_method: o.value as any }))} />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>Endpoint URL</Label>
                <Input
                  type="text"
                  value={form.endpoint_url}
                  onChange={(e) => setForm((f) => ({ ...f, endpoint_url: e.target.value }))}
                  placeholder="https://api.example.com/orders/{{ params.order_id }}"
                />
              </div>
            </div>
            {form.http_method === 'POST' && (
              <div className="flex flex-col gap-1.5">
                <Label>Request Body Template (JSON, optional)</Label>
                <textarea
                  value={form.request_template}
                  onChange={(e) => setForm((f) => ({ ...f, request_template: e.target.value }))}
                  rows={3}
                  className={`${textAreaClass} font-mono`}
                  placeholder='{"order_id": "{{ params.order_id }}"}'
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>Response Template (optional — how to phrase the result for the model)</Label>
              <textarea
                value={form.response_template}
                onChange={(e) => setForm((f) => ({ ...f, response_template: e.target.value }))}
                rows={2}
                className={`${textAreaClass} font-mono`}
                placeholder="Order status: {{ response.status }}, expected {{ response.eta }}"
              />
              <p className="text-xs text-gray-400">Leave blank to pass the raw JSON response straight to the model.</p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Parameters the AI can fill in</Label>
                <Button type="button" variant="outline" size="sm" onClick={addParam}><Plus className="size-3" />Add</Button>
              </div>
              {form.param_schema.map((p, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
                  <Input type="text" value={p.name} onChange={(e) => updateParam(i, { name: e.target.value })} placeholder="order_id" className="w-32" />
                  <Picker label="Type" showLabel={false} className="mcm-field w-24" value={p.type} options={[{ label: 'string', value: 'string' }, { label: 'number', value: 'number' }, { label: 'boolean', value: 'boolean' }]} onChange={(o) => updateParam(i, { type: o.value })} />
                  <Input type="text" value={p.description} onChange={(e) => updateParam(i, { description: e.target.value })} placeholder="description" className="flex-1" />
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <Checkbox checked={p.required} onCheckedChange={(c) => updateParam(i, { required: c === true })} />
                    Required
                  </label>
                  <span onClick={() => removeParam(i)} className="cursor-pointer text-gray-300 hover:text-red-500"><Trash2 className="size-3.5" /></span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3">
              <Label>Authentication</Label>
              <Picker label="Authentication" showLabel={false} className="mcm-field" value={form.auth_type} options={[{ label: 'None', value: 'none' }, { label: 'Bearer token', value: 'bearer' }, { label: 'Basic auth', value: 'basic' }, { label: 'Custom header', value: 'header' }, { label: 'API key header', value: 'api_key' }]} onChange={(o) => setForm((f) => ({ ...f, auth_type: o.value as any, auth_config: {} }))} />
              {form.auth_type === 'bearer' && (
                <Input type="password" value={form.auth_config.token || ''} onChange={(e) => setForm((f) => ({ ...f, auth_config: { token: e.target.value } }))} placeholder="Token" />
              )}
              {form.auth_type === 'basic' && (
                <div className="flex gap-2">
                  <Input type="text" value={form.auth_config.username || ''} onChange={(e) => setForm((f) => ({ ...f, auth_config: { ...f.auth_config, username: e.target.value } }))} placeholder="Username" />
                  <Input type="password" value={form.auth_config.password || ''} onChange={(e) => setForm((f) => ({ ...f, auth_config: { ...f.auth_config, password: e.target.value } }))} placeholder="Password" />
                </div>
              )}
              {form.auth_type === 'header' && (
                <div className="flex gap-2">
                  <Input type="text" value={form.auth_config.key || ''} onChange={(e) => setForm((f) => ({ ...f, auth_config: { ...f.auth_config, key: e.target.value } }))} placeholder="Header name" />
                  <Input type="password" value={form.auth_config.value || ''} onChange={(e) => setForm((f) => ({ ...f, auth_config: { ...f.auth_config, value: e.target.value } }))} placeholder="Header value" />
                </div>
              )}
              {form.auth_type === 'api_key' && (
                <div className="flex gap-2">
                  <Input type="text" value={form.auth_config.name || ''} onChange={(e) => setForm((f) => ({ ...f, auth_config: { ...f.auth_config, name: e.target.value } }))} placeholder="Header name" />
                  <Input type="password" value={form.auth_config.key || ''} onChange={(e) => setForm((f) => ({ ...f, auth_config: { ...f.auth_config, key: e.target.value } }))} placeholder="API key" />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3">
              <Label>Response data access</Label>
              <div className="flex gap-3">
                {(['full', 'limited'] as const).map((opt) => (
                  <button key={opt} type="button" onClick={() => setForm((f) => ({ ...f, data_access: opt }))} className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs ${form.data_access === opt ? 'border-primary bg-primary/5' : 'border-gray-200'}`}>
                    <div className="font-medium text-gray-800">{opt === 'full' ? 'Full response' : 'Limited fields'}</div>
                    <div className="text-gray-400">{opt === 'full' ? 'The model sees the entire API response' : 'Only the fields you list below reach the model'}</div>
                  </button>
                ))}
              </div>
              {form.data_access === 'limited' && (
                <Input type="text" value={form.allowed_response_fields} onChange={(e) => setForm((f) => ({ ...f, allowed_response_fields: e.target.value }))} placeholder="status, eta, tracking_number" />
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3">
              <Label>Operation type</Label>
              <p className="text-xs text-gray-400">Only read actions can ever be exposed to customers — write actions stay staff-only (Playground), no matter the security level.</p>
              <div className="flex gap-3">
                {(['read', 'write'] as const).map((opt) => (
                  <button key={opt} type="button" onClick={() => setForm((f) => ({ ...f, operation_type: opt }))} className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs capitalize ${form.operation_type === opt ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-700'}`}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
              <div>
                <Label>Enabled</Label>
                <p className="text-xs text-gray-400">Off means the assistant can never call this action.</p>
              </div>
              <Switch checked={form.enabled} onCheckedChange={(c) => setForm((f) => ({ ...f, enabled: c === true }))} />
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              <Label>Test this action</Label>
              {form.param_schema.map((p) => (
                <Input
                  key={p.name}
                  type="text"
                  value={samplePayload[p.name] || ''}
                  onChange={(e) => setSamplePayload((s) => ({ ...s, [p.name]: e.target.value }))}
                  placeholder={`Sample value for ${p.name}`}
                />
              ))}
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={runTest} disabled={isTesting || !form.endpoint_url.trim()}>
                <Play className="size-3.5" />
                {isTesting ? 'Running...' : 'Run Test'}
              </Button>
              {testResult && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-xs text-gray-700">{testResult}</pre>}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button type="button" variant="primary" disabled={isSaving || !form.title.trim() || !form.endpoint_url.trim()} onClick={handleSave}>
              {isSaving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Action'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default CaptainActions;
