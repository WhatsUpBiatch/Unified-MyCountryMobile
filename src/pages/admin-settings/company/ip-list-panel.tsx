/* One independent IP list's editing surface - either the allowlist or the
 * blocklist - WITHOUT its own card chrome. Company > Security renders a
 * single "IP allowlist / blocklist" card with a tab switcher, and mounts only
 * ONE of these at a time inside it: the allow panel while the "Only allow
 * these" tab is selected, the block panel while "Block these" is selected.
 * That is what makes each tab show its own separate table rather than both
 * lists sharing one - the two lists are independent data (own toggle, own
 * entries, own lockout check), just shown one at a time instead of both
 * cards stacked on screen at once.
 *
 * OWNS ITS OWN "new entry" FORM STATE. The CIDR being typed, the label being
 * typed, and the validation error for THIS list's form live here, not in the
 * parent - two independent lists must not share one half-typed entry between
 * them, which is what would happen if that state lived one level up.
 *
 * DOES NOT OWN THE LIST ITSELF. `entries` and `enabled` are props, changed
 * through `onToggle` / `onAddEntry` / `onRemoveEntry` - the parent is what
 * actually saves the company record, and holding two independent copies of
 * the same array (one here, one in the parent's form) is how they would drift
 * out of sync the first time a save reloaded one but not the other.
 */

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Plus, Trash2, Crosshair } from 'lucide-react';

import { SettingRow } from '@/components/mcm/setting-card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  type AllowlistEntry,
  type AllowlistKind,
  canonicalizeCidr,
  matches as ipMatchesCidr,
} from '@/lib/ip-allowlist';

export const IP_LIST_MAX_ENTRIES = 150;

interface IpListPanelProps {
  kind: AllowlistKind;
  enabled: boolean;
  entries: AllowlistEntry[];
  onToggle: (enabled: boolean) => void;
  onAddEntry: (entry: AllowlistEntry) => void;
  onRemoveEntry: (entry: AllowlistEntry) => void;
  myIp: string;
  myIpLoading: boolean;
  actorUuid: string;
  actorName: string;
  /* Lifted to the parent rather than kept as local state: the page-level Save
     button gates every card on this page from one place, and it needs to read
     whether THIS box was ticked at the moment of saving - a local checkbox the
     parent cannot see would make that check impossible. Re-ticking it on every
     save is the point, so nothing here persists it either. */
  lockoutAcknowledged: boolean;
  onLockoutAcknowledgedChange: (checked: boolean) => void;
  /* Set by the page-level save validation, keyed the same way as every other
     field on this page, so this panel's own error reads from the same place a
     failed save already populates. */
  saveError?: string;
}

export interface IpListPanelHandle {
  /* Called by the parent when its save was refused because of THIS list -
     switches to this list's tab (the parent does that part) and focuses the
     field that needs attention. */
  focusNewEntry: () => void;
}

const IpListPanel = forwardRef<IpListPanelHandle, IpListPanelProps>(function IpListPanel(
  {
    kind,
    enabled,
    entries,
    onToggle,
    onAddEntry,
    onRemoveEntry,
    myIp,
    myIpLoading,
    actorUuid,
    actorName,
    lockoutAcknowledged,
    onLockoutAcknowledgedChange,
    saveError,
  },
  forwardedRef,
) {
  const isBlock = kind === 'block';

  const [newCidr, setNewCidr] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [entryError, setEntryError] = useState('');
  const newCidrRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(forwardedRef, () => ({
    focusNewEntry: () => {
      newCidrRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => newCidrRef.current?.focus(), 250);
    },
  }));

  /* A match means something different in each direction: in the allow list a
     match is safety, in the block list a match is the danger. Everything that
     warns about locking the admin out reads THIS, never the raw match, so the
     warning can never point the wrong way for whichever list it is on. */
  const myIpMatches = myIp ? entries.some((entry) => ipMatchesCidr(myIp, entry.cidr)) : null;
  const myIpWouldBeLockedOut = myIpMatches === null ? null : isBlock ? myIpMatches : !myIpMatches;

  const addEntry = () => {
    const raw = newCidr.trim();
    if (!raw) {
      setEntryError('Enter an address or block first.');
      return;
    }
    const canonical = canonicalizeCidr(raw);
    if (!canonical) {
      setEntryError(
        'Not a valid IPv4 or IPv6 address or CIDR block - for example 203.0.113.0/24 or 2001:db8::/32.',
      );
      return;
    }
    if (entries.some((entry) => entry.cidr === canonical)) {
      setEntryError('That block is already on this list.');
      return;
    }
    if (entries.length >= IP_LIST_MAX_ENTRIES) {
      setEntryError(`This list already holds the maximum of ${IP_LIST_MAX_ENTRIES} entries.`);
      return;
    }

    onAddEntry({
      id: `ip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      cidr: canonical,
      label: newLabel.trim(),
      added_at: new Date().toISOString(),
      added_by_uuid: actorUuid || undefined,
      added_by_name: actorName,
    });
    setNewCidr('');
    setNewLabel('');
    setEntryError('');
  };

  const toggle = (checked: boolean) => {
    onToggle(checked);
    if (checked) {
      window.setTimeout(() => newCidrRef.current?.focus(), 250);
    }
  };

  const useMyIp = () => {
    if (!myIp) return;
    setNewCidr(myIp);
    setEntryError('');
  };

  /* Whether THIS save carries lockout risk worth confirming. The allow list
     always does once it has entries - the admin could be the one address left
     out. The block list only does when it has something in it that could
     possibly match the admin's own address. */
  const carriesLockoutRisk = isBlock ? entries.length > 0 : true;

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        label={isBlock ? 'Block sign-in from these networks' : 'Only allow sign-in from these networks'}
        description={
          isBlock
            ? 'When this is off, nothing is refused by this list and the list stays saved for next time.'
            : 'When this is off, no network restriction is enforced and the list stays saved for next time.'
        }
        control={<Switch checked={enabled} onCheckedChange={toggle} />}
      />

      {enabled && (
        <>
          {/* Your own address, looked up once from the browser and shown on
              both tabs - the one thing this screen once said a browser could
              not do without asking an outside service, which is exactly what
              this now does. */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <Crosshair className="h-3.5 w-3.5 shrink-0 text-gray-500" />
            {myIpLoading ? (
              <span>Looking up your public IP address…</span>
            ) : myIp ? (
              <>
                <span>
                  Your current public IP is{' '}
                  <span className="font-mono font-semibold text-gray-900">{myIp}</span>.
                </span>
                {myIpWouldBeLockedOut === true && (
                  <span className="font-semibold text-red-600">
                    {isBlock
                      ? 'It matches a block below — saving now would lock you out.'
                      : 'It is not covered by any block below — saving now would lock you out.'}
                  </span>
                )}
                {myIpWouldBeLockedOut === false && (
                  <span className="font-semibold text-emerald-700">
                    {isBlock
                      ? 'Not matched by any block below — you can still sign in.'
                      : 'Covered by the list below.'}
                  </span>
                )}
              </>
            ) : (
              <span>
                Could not detect your public IP automatically — a browser extension or network
                policy may be blocking it. Look it up yourself before relying on this list.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700" htmlFor={`ip-${kind}-new-cidr`}>
              Add an address or block
            </label>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-[12rem] flex-1">
                <Input
                  id={`ip-${kind}-new-cidr`}
                  ref={newCidrRef}
                  placeholder="203.0.113.0/24 or 2001:db8::/32"
                  spellCheck={false}
                  className={`font-mono ${entryError ? 'border-red-500' : ''}`}
                  value={newCidr}
                  onChange={(event) => {
                    setNewCidr(event.target.value);
                    if (entryError) setEntryError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addEntry();
                    }
                  }}
                />
              </div>
              <div className="min-w-[10rem] flex-1">
                <Input
                  placeholder="Label — e.g. Head office"
                  value={newLabel}
                  onChange={(event) => setNewLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addEntry();
                    }
                  }}
                />
              </div>
              <Button type="button" variant="outline" onClick={useMyIp} disabled={!myIp}>
                <Crosshair className="h-3.5 w-3.5" />
                Use my IP
              </Button>
              <Button type="button" variant="primary" onClick={addEntry}>
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              {entries.length} of {IP_LIST_MAX_ENTRIES} used. IPv4 and IPv6, both as a single
              address or a CIDR block — a single address is stored with its full prefix (/32 or
              /128) automatically.
            </p>
            {(saveError || entryError) && (
              <p className="text-xs font-semibold text-red-600">{saveError || entryError}</p>
            )}
          </div>

          {entries.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Address / CIDR</th>
                    <th className="px-3 py-2 font-medium">Label</th>
                    <th className="px-3 py-2 font-medium">Added</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-3 py-2 font-mono text-gray-900">{entry.cidr}</td>
                      <td className="px-3 py-2 text-gray-700">{entry.label || '—'}</td>
                      <td className="px-3 py-2 text-gray-500">
                        {entry.added_by_name || 'Unknown'}
                        {entry.added_at ? ` · ${new Date(entry.added_at).toLocaleDateString()}` : ''}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          aria-label={`Remove ${entry.cidr}`}
                          className="cursor-pointer rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => onRemoveEntry(entry)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {carriesLockoutRisk && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">
                You can lock yourself out with this list.
              </p>
              <p className="mt-1 text-xs text-amber-800">
                {isBlock
                  ? 'A network that matches one of these blocks is refused, including your own if it ever does. Your address is checked above; confirm it is not matched before you save, and remember a home connection’s address usually changes over time.'
                  : 'An allowlist that does not cover the address you are saving from locks you out of your own account. Your address is checked above; confirm it is covered before you save, and remember a home connection’s address usually changes over time.'}
              </p>
              <label className="mt-3 flex cursor-pointer items-start gap-2">
                <Checkbox
                  checked={lockoutAcknowledged}
                  onCheckedChange={(checked) => onLockoutAcknowledgedChange(checked === true)}
                />
                <span className="text-xs text-amber-900">
                  {isBlock
                    ? 'I have checked that my own public IP address is not matched by any of these blocks.'
                    : 'I have checked that my own public IP address is inside one of these blocks.'}
                </span>
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default IpListPanel;
