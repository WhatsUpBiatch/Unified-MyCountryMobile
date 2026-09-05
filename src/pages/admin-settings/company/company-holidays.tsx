/* One holiday calendar for the whole company.
 *
 * Today a holiday can only be entered inside one object's business-hours dialog
 * (`src/components/custom/bussiness-hours-dialog.tsx`): capped at ten, stored as
 * a one-off date range with no recurrence, and repeated for every object that
 * needs it. A company with an IVR, three queues and forty users therefore types
 * Christmas forty-four times, and again next year. established systems keeps a holiday
 * catalogue at office level with per-country defaults and a repeat frequency;
 * other established systems keeps RRULE schedules grouped into open/closed/holiday sets. This is
 * the same idea at the level where it belongs — the company.
 *
 * This list is now read at call time. The inbound dialplan
 * (`/opt/fs-xml-api-1.2.5/dialplan_service.py`) looks the company record up on
 * every incoming call and, if today is on this list, treats the company as
 * closed - so the caller gets the number's closed-hours destination instead of
 * its normal one. Until 1 Sep 2026 it did not: the dialplan read the holiday
 * date off the keys `date`/`day`/`value`/`start`, and a stored holiday carries
 * none of them, so every holiday in the system silently missed. That is fixed in
 * `backend-patches/fs-xml-api/`.
 *
 * NOTHING ON THE SCREEN EXPLAINS THIS ANY MORE. Both notes were removed on
 * request - first the warning banner, then the pair that replaced it. So the one
 * real gap is recorded here and nowhere a customer will see it: a number pointed
 * at a menu or a queue with no closed-hours destination has nothing to divert
 * to, and rings through on a holiday like any other day. A main line pointed at
 * an auto attendant is the commonest setup there is, so this will be somebody's
 * surprise eventually. Raise it again before it is.
 *
 * Storage is the company level of the settings cascade — the reserved
 * `user_template` row named "Company Default" whose `settings` field is an
 * arbitrary JSON blob (see `src/lib/company-defaults.ts`). The calendar lives
 * under `settings.company_holidays`. The rest of `settings` and the whole of
 * `greetings` are read, kept and written back untouched, so saving a holiday
 * cannot wipe the company's business hours or voicemail rules.
 */

import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Pencil, Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SectionHeading } from './section-heading';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import CustomSelect from '@/components/custom/custom-select';
import { CustomDatePicker } from '@/components/custom/custom-datepicker';
import { handleAlert } from '@/lib/utils';
/* The rules that turn "United States, 2026" into eleven dates live in their own
   module so they can be run and checked without React - see
   `scripts/verify-holiday-presets.mjs`. */
import { buildPreset, COUNTRY_PRESETS } from '@/lib/holiday-presets';
/* One definition of "the company record", shared by every company-level screen.
   This file originally carried a local copy of these helpers because it was
   built on a branch that predated the shared module. Two definitions of where
   the company rules live is how they start disagreeing. */
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  saveCompanyDefaults,
  type CompanyDefaultTemplate,
} from '@/lib/company-defaults';

/* --------------------------------------------------------------- the shape */

/* `settings.company_holidays` is versioned from day one. The per-object holiday
   shape already has two generations of data in it because it never was, and the
   business-hours dialog now has to guess which it is holding. */
export interface CompanyHoliday {
  id: string;
  title: string;
  /* Inclusive YYYY-MM-DD. A single day has from === to. */
  from: string;
  to: string;
  /* True only when the same calendar date is correct every year. Anything that
     moves — Thanksgiving, Easter, a weekend substitute day — is false, so nobody
     is told a date will hold when it will not. */
  repeats_yearly: boolean;
  /* 'preset' rows came from a country list; 'manual' rows were typed. */
  source: 'preset' | 'manual';
  country?: string;
  note?: string;
}

export interface CompanyHolidayCalendar {
  version: 1;
  updated_at: string;
  items: CompanyHoliday[];
}

const SETTINGS_KEY = 'company_holidays';

const readCalendar = (settings: any): CompanyHoliday[] => {
  const raw = settings?.[SETTINGS_KEY];
  const items = Array.isArray(raw) ? raw : raw?.items;
  if (!Array.isArray(items)) return [];

  return items
    .filter((item: any) => item && typeof item === 'object')
    .map((item: any, index: number): CompanyHoliday => ({
      id: `${item.id || `holiday-${index}`}`,
      title: `${item.title || ''}`,
      from: `${item.from || ''}`,
      to: `${item.to || item.from || ''}`,
      repeats_yearly: !!item.repeats_yearly,
      source: item.source === 'preset' ? 'preset' : 'manual',
      country: item.country ? `${item.country}` : undefined,
      note: item.note ? `${item.note}` : undefined,
    }))
    .filter((item: CompanyHoliday) => item.title && item.from);
};

/* The bridge to what call routing actually reads today. Each object's
   business-hours dialog stores holidays in the shape `getHolidaysFormVal`
   produces, so a company holiday has to be expressible in it. Exported rather
   than used here: wiring it into the dialog means editing that dialog, which
   this change is not allowed to do. It is the whole point of the storage shape,
   so it is written down and typed now rather than guessed at later. */
/* Converting this list into rows on a line's business hours lives in
   src/lib/company-holiday-import.ts. It is not a plain field copy: every holiday
   on a line must carry an action or it fails validation, so the import has to
   resolve one from that line's closed-hours behaviour. */

/* ------------------------------------------------------------ date helpers */

const pad = (value: number) => `${value}`.padStart(2, '0');

const toIso = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/* Parsed into a local-noon Date so a browser west of UTC cannot render
   2026-12-25 as the 24th. */
const isoToDate = (iso: string): Date | null => {
  const parts = `${iso}`.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
};

const prettyDate = (iso: string) => {
  const date = isoToDate(iso);
  if (!date) return iso || '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const prettyRange = (item: CompanyHoliday) =>
  item.to && item.to !== item.from
    ? `${prettyDate(item.from)} – ${prettyDate(item.to)}`
    : prettyDate(item.from);

/* ------------------------------------------------------------------ the UI */

const makeId = () => `hol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface Draft {
  id: string | null;
  title: string;
  from: string;
  to: string;
  repeats_yearly: boolean;
}

const EMPTY_DRAFT: Draft = { id: null, title: '', from: '', to: '', repeats_yearly: true };

const YEAR_OPTIONS = (() => {
  const current = new Date().getFullYear();
  return [current, current + 1, current + 2].map((year) => ({
    label: `${year}`,
    value: `${year}`,
  }));
})();

/* The list owns the save, but the page below it owns the row of buttons that
   closes every settings tab. Rather than move the save up — it depends on this
   screen's draft state, its dirty flag and its mutation — the screen hands the
   page a handle to call. One save, reachable from either place. */
export interface CompanyHolidaysHandle {
  save: () => void;
}

const CompanyHolidays = forwardRef<CompanyHolidaysHandle>((_props, ref) => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<CompanyDefaultTemplate | null>({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
    staleTime: 5 * 60 * 1000,
  });

  const [items, setItems] = useState<CompanyHoliday[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [isAdding, setIsAdding] = useState(false);
  /* The add/edit panel renders at the FOOT of this card, under the presets and
     the whole holiday list, because the list it changes has to stay visible
     while you type. On an account with a year of holidays saved that is a long
     way below the button that opens it, so pressing Add appeared to do nothing
     at all - the panel opened somewhere the admin could not see, and the button
     greyed itself out, which read as broken rather than busy. */
  const draftPanelRef = useRef<HTMLDivElement | null>(null);
  const draftNameRef = useRef<HTMLInputElement | null>(null);
  /* Bumped on every open, so pressing Add again while the panel is already open
     scrolls back to it rather than doing nothing. */
  const [draftOpenedAt, setDraftOpenedAt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [country, setCountry] = useState<{ label: string; value: string } | null>(null);
  const [year, setYear] = useState<{ label: string; value: string }>(YEAR_OPTIONS[0]);

  /* Re-seeded from the server only while there is nothing unsaved, so a refetch
     landing mid-edit cannot throw away typing. */
  useEffect(() => {
    if (dirty) return;
    setItems(readCalendar(data?.settings));
  }, [data, dirty]);

  /* Runs after the panel is in the DOM, which is why this is an effect and not
     part of the click handler. */
  useEffect(() => {
    if (!isAdding) return;
    draftPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    /* Focus follows the scroll rather than racing it: focusing first makes the
       browser jump to the field, which fights the smooth scroll and lands in the
       wrong place. */
    const focus = window.setTimeout(() => draftNameRef.current?.focus(), 250);
    return () => window.clearTimeout(focus);
  }, [isAdding, draftOpenedAt]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.from.localeCompare(b.from) || a.title.localeCompare(b.title)),
    [items],
  );

  const repeatingCount = useMemo(() => items.filter((item) => item.repeats_yearly).length, [items]);

  const selectedPreset = useMemo(
    () => COUNTRY_PRESETS.find((preset) => preset.code === country?.value) || null,
    [country],
  );

  const presetPreview = useMemo(() => {
    if (!selectedPreset) return [];
    return buildPreset(selectedPreset, Number(year.value));
  }, [selectedPreset, year]);

  /* A preset re-added for a second year, or added twice, must not double up. */
  const presetNewCount = useMemo(() => {
    const existing = new Set(items.map((item) => `${item.title}|${item.from}`));
    return presetPreview.filter((entry) => !existing.has(`${entry.title}|${entry.iso}`)).length;
  }, [items, presetPreview]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => {
      const calendar: CompanyHolidayCalendar = {
        version: 1,
        updated_at: new Date().toISOString(),
        items,
      };
      /* Everything else in the company record is carried through untouched.
         `settings` here is the whole blob, not just this key. */
      return saveCompanyDefaults({
        uuid: data?.uuid,
        settings: { ...(data?.settings || {}), [SETTINGS_KEY]: calendar },
        greetings: data?.greetings || {},
        only: [SETTINGS_KEY],
      });
    },
    onSuccess: (response: any) => {
      handleAlert({
        text: response?.data?.data?.message || 'Company holidays saved.',
        type: 'success',
      });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
    },
    onError: () => {
      handleAlert({ text: 'Could not save the holidays. Nothing was changed.', type: 'error' });
    },
  });

  /* Declared after the mutation above: `save` is a const, so reading it any
     earlier in the body throws before the screen can render. */
  useImperativeHandle(ref, () => ({ save: () => save() }), [save]);

  const openAdd = () => {
    setDraft(EMPTY_DRAFT);
    setIsAdding(true);
    setDraftOpenedAt((count) => count + 1);
  };

  const openEdit = (item: CompanyHoliday) => {
    setDraft({
      id: item.id,
      title: item.title,
      from: item.from,
      to: item.to,
      repeats_yearly: item.repeats_yearly,
    });
    setIsAdding(true);
    setDraftOpenedAt((count) => count + 1);
  };

  const closeDraft = () => {
    setDraft(EMPTY_DRAFT);
    setIsAdding(false);
  };

  const commitDraft = () => {
    const title = draft.title.trim();
    if (!title) {
      handleAlert({ text: 'Give the holiday a name.', type: 'error' });
      return;
    }
    if (!draft.from) {
      handleAlert({ text: 'Pick the date the holiday starts.', type: 'error' });
      return;
    }
    const to = draft.to || draft.from;
    if (to < draft.from) {
      handleAlert({ text: 'The last day cannot be before the first day.', type: 'error' });
      return;
    }

    setItems((previous) => {
      if (draft.id) {
        return previous.map((item) =>
          item.id === draft.id
            ? { ...item, title, from: draft.from, to, repeats_yearly: draft.repeats_yearly }
            : item,
        );
      }
      return [
        ...previous,
        {
          id: makeId(),
          title,
          from: draft.from,
          to,
          repeats_yearly: draft.repeats_yearly,
          source: 'manual' as const,
        },
      ];
    });
    setDirty(true);
    closeDraft();
  };

  const removeItem = (id: string) => {
    setItems((previous) => previous.filter((item) => item.id !== id));
    setDirty(true);
  };

  const toggleRepeat = (id: string) => {
    setItems((previous) =>
      previous.map((item) =>
        item.id === id ? { ...item, repeats_yearly: !item.repeats_yearly, note: undefined } : item,
      ),
    );
    setDirty(true);
  };

  const addPreset = () => {
    if (!selectedPreset) return;
    const existing = new Set(items.map((item) => `${item.title}|${item.from}`));
    const additions = presetPreview
      .filter((entry) => !existing.has(`${entry.title}|${entry.iso}`))
      .map((entry) => ({
        id: makeId(),
        title: entry.title,
        from: entry.iso,
        to: entry.iso,
        repeats_yearly: entry.repeats_yearly,
        source: 'preset' as const,
        country: selectedPreset.code,
        note: entry.note,
      }));

    if (!additions.length) {
      handleAlert({ text: 'Those holidays are already on the list.', type: 'error' });
      return;
    }

    setItems((previous) => [...previous, ...additions]);
    setDirty(true);
    handleAlert({
      text: `Added ${additions.length} ${selectedPreset.label} holiday${additions.length === 1 ? '' : 's'} for ${year.value}. Not saved yet.`,
      type: 'success',
    });
  };

  return (
    <div className="cs-block">
      <SectionHeading
        icon={<CalendarDays className="h-[18px] w-[18px]" />}
        title="Holidays"
        description="The days your company is shut, written down once instead of typed again into every menu, queue and person. Callers get your out-of-hours option on these dates."
        actions={
          <>
          {/* Never disabled. While the panel is open this button is the way
              back to it, and a greyed-out control is exactly what made this look
              broken in the first place. */}
          <Button type="button" variant="outline" size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add holiday
          </Button>
          {/* Only there when there is something to save. Sitting greyed out with
              nothing to do, it read as a broken control rather than a finished
              one - the same complaint that got Add holiday fixed above.

              NOT removed outright: it is the only way this list reaches the
              server. Hidden while `dirty` is false and back the instant anything
              changes, alongside the "Unsaved changes" flag over the list. */}
          {dirty && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => save()}
              disabled={isPending || isLoading}
            >
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          )}
          </>
        }
      />

      {/* Presets. The point of the panel: a year of holidays in one click rather
          than twelve rows typed by hand. */}
      <div className="mt-3 rounded-lg border border-ucass-primary-200 bg-ucass-primary-200/40 p-3">
        <p className="text-xs font-semibold text-gray-900">Add a country&apos;s public holidays</p>
        <p className="mt-0.5 text-xs text-gray-600">
          Pick a country and a year, and the public holidays are added to the list below. You can
          edit or remove any of them afterwards.
        </p>

        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-72">
            <CustomSelect
              label="Country"
              placeholder="Select a country"
              options={COUNTRY_PRESETS.map((preset) => ({
                label: preset.label,
                value: preset.code,
              }))}
              value={country}
              handleChange={(option: any) => setCountry(option)}
              isClearable
            />
          </div>
          <div className="w-full sm:w-32">
            <CustomSelect
              label="Year"
              options={YEAR_OPTIONS}
              value={year}
              handleChange={(option: any) => option && setYear(option)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={addPreset}
            disabled={!selectedPreset || presetNewCount === 0}
          >
            <Plus className="h-3.5 w-3.5" />
            {selectedPreset
              ? presetNewCount === 0
                ? 'Already added'
                : `Add ${presetNewCount} holiday${presetNewCount === 1 ? '' : 's'}`
              : 'Add holidays'}
          </Button>
        </div>

        {selectedPreset && (
          <p className="mt-2 text-xs text-gray-600">
            <span className="font-semibold text-gray-900">{selectedPreset.label}:</span>{' '}
            {selectedPreset.scope} Check the list against your own working year before you rely on
            it.
          </p>
        )}
      </div>

      {/* The list. */}
      <div className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-gray-500">
            {items.length} holiday{items.length === 1 ? '' : 's'}
            {items.length > 0 && (
              <span className="font-normal text-gray-500">
                {' '}
                · {repeatingCount} repeat every year · {items.length - repeatingCount} need
                re-adding next year
              </span>
            )}
          </p>
          {dirty && <span className="text-xs font-semibold text-amber-700">Unsaved changes</span>}
        </div>

        {isLoading ? (
          <p className="mt-3 text-sm text-gray-500">Loading…</p>
        ) : sorted.length === 0 && !isAdding ? (
          <div className="mt-2 rounded-lg border border-dashed border-gray-300 p-4 text-center">
            <p className="text-xs font-semibold text-gray-900">No company holidays yet</p>
            <p className="mt-0.5 text-xs text-gray-600">
              Add a country&apos;s public holidays above, or add one by hand.
            </p>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {sorted.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-200 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                  <p className="mt-0.5 text-xs text-gray-600">{prettyRange(item)}</p>
                  {item.note && <p className="mt-0.5 text-xs text-gray-500">{item.note}</p>}
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <Switch
                      checked={item.repeats_yearly}
                      onCheckedChange={() => toggleRepeat(item.id)}
                    />
                    <span className="text-xs text-gray-600">
                      {item.repeats_yearly ? 'Every year' : 'This year only'}
                    </span>
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(item)}
                    aria-label={`Edit ${item.title}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="destructiveOutline"
                    size="sm"
                    onClick={() => removeItem(item.id)}
                    aria-label={`Remove ${item.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / edit row. Inline rather than a dialog: the list it changes stays
          visible, so a duplicate is obvious before it is added. */}
      {isAdding && (
        <div
          ref={draftPanelRef}
          className="mt-3 rounded-lg border border-ucass-primary-200 bg-white p-3"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-900">
              {draft.id ? 'Edit holiday' : 'New holiday'}
            </p>
            <button
              type="button"
              onClick={closeDraft}
              aria-label="Cancel"
              className="cursor-pointer rounded-md p-1 text-gray-500 hover:bg-gray-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="w-full sm:w-64">
              <Input
                ref={draftNameRef}
                label="Name"
                placeholder="Christmas Day"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </div>
            <div className="w-full sm:w-48">
              <CustomDatePicker
                label="First day"
                placeholder="Pick a date"
                value={draft.from ? isoToDate(draft.from) : null}
                onChange={(date) => {
                  if (!date) return;
                  const iso = toIso(date);
                  /* A one-day holiday is the common case, so the last day
                     follows the first until it is set apart. */
                  setDraft((previous) => ({
                    ...previous,
                    from: iso,
                    to: !previous.to || previous.to < iso ? iso : previous.to,
                  }));
                }}
              />
            </div>
            <div className="w-full sm:w-48">
              <CustomDatePicker
                label="Last day"
                placeholder="Same day"
                minDate={draft.from ? isoToDate(draft.from) || undefined : undefined}
                value={draft.to ? isoToDate(draft.to) : null}
                onChange={(date) =>
                  date && setDraft((previous) => ({ ...previous, to: toIso(date) }))
                }
              />
            </div>
            <label className="flex h-10 cursor-pointer items-center gap-2">
              <Switch
                checked={draft.repeats_yearly}
                onCheckedChange={(checked) => setDraft({ ...draft, repeats_yearly: !!checked })}
              />
              <span className="text-xs text-gray-600">Repeats every year</span>
            </label>
            <Button type="button" variant="primary" onClick={commitDraft}>
              {draft.id ? 'Update' : 'Add'}
            </Button>
          </div>

          <p className="mt-2 text-xs text-gray-500">
            Turn off &quot;repeats every year&quot; for anything that moves — Thanksgiving, Easter,
            Diwali, Eid — and add next year&apos;s date when you know it.
          </p>
        </div>
      )}
    </div>
  );
});

CompanyHolidays.displayName = 'CompanyHolidays';


export default CompanyHolidays;
