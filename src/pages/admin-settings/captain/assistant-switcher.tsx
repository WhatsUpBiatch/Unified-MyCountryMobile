import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Pencil } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/dropdown-menu';

const CAPTAIN_API_BASE = '/captain-api/api/captain';
export const SELECTED_ASSISTANT_KEY = 'captain_selected_assistant_id';

export type Assistant = { id: string; name: string };

/* The row mark. Was a bot glyph on a colour hashed from the assistant's id —
   which meant the colour was stable but arbitrary, and the glyph identical on
   every row, so neither told you which assistant you were about to pick.
   Initials do, and they are the same ones the Assistants screen puts on each
   card. Two letters off the first word: the second word is "assistant" on
   almost all of these, so one letter per word collides exactly where it
   matters. */
function initials(name: string) {
  const first = name.trim().split(/\s+/)[0] || '';
  return (first.slice(0, 2) || '?').toUpperCase();
}

// Shared "which assistant am I looking at" state for Captain's per-assistant
// pages (Documents, FAQs, ...) — persisted so it survives navigating between them.
export function useSelectedAssistant() {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [selectedId, setSelectedId] = useState<string>(() => localStorage.getItem(SELECTED_ASSISTANT_KEY) || '');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`${CAPTAIN_API_BASE}/assistants`)
      .then((res) => res.json())
      .then((json) => {
        const list: Assistant[] = json.data || [];
        setAssistants(list);
        setSelectedId((prev) => {
          const next = prev && list.some((a) => a.id === prev) ? prev : list[0]?.id || '';
          if (next) localStorage.setItem(SELECTED_ASSISTANT_KEY, next);
          return next;
        });
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const selectAssistant = (id: string) => {
    setSelectedId(id);
    localStorage.setItem(SELECTED_ASSISTANT_KEY, id);
  };

  return { assistants, selectedId, selectAssistant, isLoading };
}

export function AssistantSwitcher({
  assistants,
  selectedId,
  onSelect,
  pageTitle,
}: {
  assistants: Assistant[];
  selectedId: string;
  onSelect: (id: string) => void;
  pageTitle?: string;
}) {
  const selected = assistants.find((a) => a.id === selectedId);

  return (
    <div className="flex items-center gap-3">
      <DropdownMenu>
        {/* Same control as the Playground's picker, and for the same reason:
            which assistant you are looking at is the fact every one of these
            screens turns on, so it is stated rather than implied by a name in
            the corner. */}
        <DropdownMenuTrigger className="mcm-cpg-pick">
          <span className="mcm-cpg-pick-l">Assistant</span>
          <span className="mcm-cpg-pick-v">
            <span className="mcm-cpg-pick-dot" aria-hidden="true" />
            {selected?.name || 'Select assistant'}
          </span>
          <ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="mcm-swi-menu">
          <div className="mcm-swi-h">
            <div>
              <b>Assistants</b>
              <span>What this screen is showing</span>
            </div>
            {/* Both buttons went to the same address and only their tooltips
                differed, so the pair offered one destination twice. */}
            <Link to="/admin-settings/captain/assistants" title="Manage assistants">
              <Pencil className="size-3.5" />
            </Link>
          </div>
          <div className="mcm-swi-list">
            {assistants.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a.id)}
                className={a.id === selectedId ? 'is-on' : undefined}
              >
                {/* Initials, matching the cards on the Assistants screen — the
                    same bot glyph on every row said only that these were
                    assistants, which the heading above already said. */}
                <span className="mcm-swi-mark" aria-hidden="true">
                  {initials(a.name)}
                </span>
                <span className="mcm-swi-name">{a.name}</span>
                {a.id === selectedId ? <Check className="size-4" /> : null}
              </button>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {pageTitle && (
        <>
          <span className="text-gray-300">|</span>
          <span className="text-base font-bold text-gray-950">{pageTitle}</span>
        </>
      )}
    </div>
  );
}
