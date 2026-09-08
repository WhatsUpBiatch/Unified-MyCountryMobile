import { useEffect, useState } from 'react';
import {
  Check, Facebook, MessageCircle, Smartphone, Mail, Braces, Send, MessageSquare, Instagram, Voicemail,
  Search, Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getUserList } from '@/services/api';
import { Picker } from '@/components/mcm/picker';

const CAPTAIN_API_BASE = '/captain-api/api/captain';

type TeamMember = { uuid: string; name: string; email: string };
type Step = 'channel' | 'create' | 'agents' | 'done';

const CHANNEL_OPTIONS: { key: string; label: string; desc: string; icon: any; live: boolean }[] = [
  { key: 'website', label: 'Website', desc: 'Create a live-chat widget', icon: MessageSquare, live: true },
  { key: 'facebook', label: 'Facebook', desc: 'Connect your Facebook page', icon: Facebook, live: false },
  { key: 'whatsapp', label: 'WhatsApp', desc: 'Support your customers on WhatsApp', icon: MessageCircle, live: false },
  { key: 'sms', label: 'SMS', desc: 'Integrate SMS channel with a provider', icon: Smartphone, live: false },
  { key: 'email', label: 'Email', desc: 'Connect with Gmail, Outlook, or other providers', icon: Mail, live: false },
  { key: 'api', label: 'API', desc: 'Make a custom channel using our API', icon: Braces, live: false },
  { key: 'telegram', label: 'Telegram', desc: 'Configure Telegram channel using Bot token', icon: Send, live: false },
  { key: 'instagram', label: 'Instagram', desc: 'Connect your Instagram account', icon: Instagram, live: false },
  { key: 'voice', label: 'Voice', desc: 'Integrate with a voice/telephony provider', icon: Voicemail, live: false },
];

const STEPS: { key: Step; title: string; desc: string }[] = [
  { key: 'channel', title: 'Choose Channel', desc: 'Choose the channel you want to create.' },
  { key: 'create', title: 'Create Inbox', desc: 'Configure the channel and create the inbox.' },
  { key: 'agents', title: 'Add Agents', desc: 'Add agents to the created inbox.' },
  { key: 'done', title: 'Voilà!', desc: 'You are all set to go!' },
];


const AddInboxWizard = ({
  open,
  onClose,
  assistants,
  onDone,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  assistants: any[];
  onDone: () => void;
  onOpenSettings: (inboxId: string) => void;
}) => {
  const [step, setStep] = useState<Step>('channel');
  const [selectedChannel, setSelectedChannel] = useState('website');

  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [color, setColor] = useState('#000000');
  const [heading, setHeading] = useState('Hi there!');
  const [tagline, setTagline] = useState('We are here to help you out!!!');
  const [greetingEnabled, setGreetingEnabled] = useState(false);
  const [assistantId, setAssistantId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const [createdInboxId, setCreatedInboxId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [agentSearch, setAgentSearch] = useState('');
  const [isSavingAgents, setIsSavingAgents] = useState(false);
  const [copied, setCopied] = useState(false);

  const embedOrigin = typeof window !== 'undefined' ? `https://${window.location.host}/captain-api` : '';
  const embedSnippet = createdInboxId ? `<script src="${embedOrigin}/widget.js" data-inbox-id="${createdInboxId}" async></script>` : '';

  useEffect(() => {
    if (!open) return;
    setStep('channel');
    setSelectedChannel('website');
    setName('');
    setDomain('');
    setColor('#000000');
    setHeading('Hi there!');
    setTagline('We are here to help you out!!!');
    setGreetingEnabled(false);
    setAssistantId('');
    setError('');
    setCreatedInboxId(null);
    setSelectedAgents(new Set());
    setAgentSearch('');
    setCopied(false);
    getUserList({ page: 1, limit: 500 }).then((teamRes: any) => {
      const rows = teamRes?.data?.data?.result?.rows || [];
      setTeamMembers(rows.map((p: any) => ({
        uuid: p.uuid,
        name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email || 'Unknown',
        email: p.email || '',
      })));
    }).catch(() => {});
  }, [open]);

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const createInbox = async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    setError('');
    try {
      const res = await fetch(`${CAPTAIN_API_BASE}/inboxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          website_domain: domain.trim() || undefined,
          widget_color: color,
          welcome_heading: heading,
          welcome_tagline: tagline,
          channel_greeting_enabled: greetingEnabled,
          assistant_id: assistantId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to create inbox');
      setCreatedInboxId(json.data.id);
      setStep('agents');
    } catch (err: any) {
      setError(err?.message || 'Failed to create inbox');
    } finally {
      setIsCreating(false);
    }
  };

  const toggleAgent = (uuid: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const saveAgentsAndFinish = async () => {
    if (!createdInboxId) return;
    setIsSavingAgents(true);
    try {
      const agents = teamMembers.filter((m) => selectedAgents.has(m.uuid)).map((m) => ({ user_uuid: m.uuid, user_name: m.name, user_email: m.email }));
      await fetch(`${CAPTAIN_API_BASE}/inboxes/${createdInboxId}/collaborators`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents }),
      });
      setStep('done');
    } catch (err: any) {
      setError(err?.message || 'Failed to save agents');
    } finally {
      setIsSavingAgents(false);
    }
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(embedSnippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const filteredTeamMembers = teamMembers.filter((m) => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return true;
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="grid h-[82vh] w-full max-w-4xl grid-cols-[240px_1fr] gap-0 overflow-hidden rounded-2xl p-0">
        <div className="flex flex-col gap-1 border-r border-gray-100 bg-gray-50/60 p-5">
          <button type="button" onClick={onClose} className="mb-3 w-fit text-xs text-gray-400 hover:text-gray-700">‹ Back</button>
          <DialogTitle className="mb-4 text-sm font-bold text-gray-950">Inboxes</DialogTitle>
          <div className="flex flex-col gap-5">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex gap-3">
                <div
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    i === stepIndex ? 'bg-primary text-white' : i < stepIndex ? 'bg-primary/20 text-primary' : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {i < stepIndex ? <Check className="size-3.5" /> : i + 1}
                </div>
                <div>
                  <div className={`text-sm font-medium ${i === stepIndex ? 'text-gray-950' : 'text-gray-500'}`}>{s.title}</div>
                  <div className="text-xs text-gray-400">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col overflow-y-auto">
          {step === 'channel' && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
              <div className="text-base font-bold text-gray-950">Choose Channel</div>
              <p className="text-xs text-gray-500">Choose the provider you want to integrate.</p>
              <div className="grid grid-cols-3 gap-3">
                {CHANNEL_OPTIONS.map((c) => {
                  const Icon = c.icon;
                  const active = selectedChannel === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      disabled={!c.live}
                      onClick={() => {
                        setSelectedChannel(c.key);
                        setStep('create');
                      }}
                      className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors ${
                        c.live ? 'cursor-pointer border-gray-200 hover:border-primary hover:bg-primary/[0.02]' : 'cursor-not-allowed border-gray-100 opacity-50'
                      } ${active && c.live ? 'border-primary bg-primary/5' : ''}`}
                    >
                      <div className="flex size-9 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                        <Icon className="size-4" />
                      </div>
                      <div className="text-sm font-semibold text-gray-900">{c.label}</div>
                      <div className="text-xs text-gray-400">{c.live ? c.desc : 'Coming soon'}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'create' && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
              <div className="text-base font-bold text-gray-950">Website channel</div>
              <p className="text-xs text-gray-500">Create a channel for your website and start supporting your customers via your website widget.</p>
              {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
              <div className="flex flex-col gap-1.5">
                <Label>Website Name</Label>
                <Input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Inc" autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Website Domain</Label>
                <Input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. acme.com" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Widget Color</Label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-24 cursor-pointer rounded-xl border border-gray-300" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Welcome Heading</Label>
                <Input type="text" value={heading} onChange={(e) => setHeading(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Welcome Tagline</Label>
                <textarea
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value.slice(0, 255))}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 shadow-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
                <span className="self-end text-xs text-gray-400">{tagline.length} / 255</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Enable channel greeting</Label>
                <Picker label="Greeting" showLabel={false} className="mcm-field" value={greetingEnabled ? 'enabled' : 'disabled'} options={[{ label: 'Disabled', value: 'disabled' }, { label: 'Enabled', value: 'enabled' }]} onChange={(o) => setGreetingEnabled(o.value === 'enabled')} />
                <p className="text-xs text-gray-400">Auto-send greeting messages when customers start a conversation.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>AI Assistant (optional)</Label>
                <Picker label="AI assistant" showLabel={false} className="mcm-field" value={assistantId} options={[{ label: 'No AI assistant — human agents only', value: '' }, ...assistants.map((a: any) => ({ label: String(a.name), value: String(a.id) }))]} onChange={(o) => setAssistantId(o.value)} />
              </div>
            </div>
          )}

          {step === 'agents' && (
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-6">
              <div className="text-base font-bold text-gray-950">Add Agents</div>
              <p className="text-xs text-gray-500">Pick which team members can see and reply to this inbox's conversations. Leave empty to allow everyone.</p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                <Input type="text" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="Search team members..." className="pl-9" />
              </div>
              <div className="flex flex-col gap-1 overflow-y-auto rounded-xl border border-gray-200">
                {filteredTeamMembers.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">No team members found.</div>
                ) : (
                  filteredTeamMembers.map((m) => (
                    <label key={m.uuid} className="flex cursor-pointer items-center gap-2.5 border-b border-gray-50 px-4 py-2.5 last:border-0 hover:bg-gray-50">
                      <Checkbox checked={selectedAgents.has(m.uuid)} onCheckedChange={() => toggleAgent(m.uuid)} />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-gray-800">{m.name}</div>
                        <div className="truncate text-xs text-gray-400">{m.email}</div>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
              <div className="text-base font-bold text-gray-950">Voilà! You're all set</div>
              <p className="text-sm text-gray-500">Paste this before the closing &lt;/body&gt; tag of any page you want this chatbot on.</p>
              <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <code className="flex-1 overflow-x-auto whitespace-pre text-xs text-gray-700">{embedSnippet}</code>
                <button type="button" onClick={copySnippet} className="shrink-0 text-gray-500 hover:text-primary" title="Copy">
                  {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
                </button>
              </div>
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
                This website inbox is live. You can fine-tune business hours, CSAT, pre-chat form, and more from its settings any time.
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-gray-100 p-4">
            {step === 'create' && (
              <>
                <Button type="button" variant="outline" onClick={() => setStep('channel')}>Back</Button>
                <Button type="button" variant="primary" disabled={isCreating || !name.trim()} onClick={createInbox}>
                  {isCreating ? 'Creating...' : 'Create inbox'}
                </Button>
              </>
            )}
            {step === 'agents' && (
              <Button type="button" variant="primary" disabled={isSavingAgents} onClick={saveAgentsAndFinish}>
                {isSavingAgents ? 'Saving...' : 'Continue'}
              </Button>
            )}
            {step === 'done' && (
              <>
                <Button type="button" variant="outline" onClick={() => createdInboxId && onOpenSettings(createdInboxId)}>
                  More Settings
                </Button>
                <Button type="button" variant="primary" onClick={onDone}>
                  All Setup Done
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddInboxWizard;
