/* Putting the company holiday list onto many lines at once.
 *
 * This panel is no longer what makes a holiday work. Since 1 Sep 2026 the
 * inbound dialplan reads the company list itself on every incoming call
 * (see `company-holidays.tsx` and `backend-patches/fs-xml-api/`), so declaring
 * Christmas once is enough to close the lines. What this still does is keep each
 * line's OWN holiday list in step with the company one, so a queue's or a
 * person's own business-hours screen shows the same dates the company declared
 * rather than looking empty. The panel says that plainly rather than implying a
 * run is needed - an admin who thinks holidays are broken until they press this
 * button has been misled just as surely as one who thinks they work when they
 * do not.
 *
 * Without it an admin who wanted those per-line lists filled in would open every
 * queue, every IVR menu, every person and every number and press "Import company
 * holidays" inside each one's business-hours dialog. Forty-four lines is
 * forty-four trips.
 *
 * Nothing here is new logic. `buildHolidayImport` already decides what a line
 * should receive, and the same rules apply whether it is called once from a
 * dialog or two hundred times from here:
 *
 *   - A holiday on a line MUST carry both `type.value` and `value.value`
 *     (`holidaySchema`, src/pages/admin-settings/constants.ts). A row with
 *     an empty action does not fall back to anything — it fails validation and
 *     blocks that line's whole form from saving, on a screen that never explains
 *     why. So a line whose action cannot be resolved is REPORTED AS SKIPPED and
 *     is not written at all.
 *   - Holidays already on the line are never touched. `buildHolidayImport`
 *     dedupes on name and start date, and the new rows are appended to the
 *     stored array rather than replacing it.
 *   - A line holds at most ten holidays, so what did not fit is named.
 *
 * Every save writes the line's WHOLE record back, read fresh from the server
 * with exactly one slot changed. All four endpoints here replace rather than
 * patch — `/api/user/update` most notoriously, which is why
 * `assignVoicemailGreeting` (src/lib/voicemail-greeting.ts) echoes the person
 * back field for field. A payload assembled from assumptions about what a record
 * contains is how settings get silently dropped, and this codebase has already
 * paid for that once.
 */

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  MinusCircle,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SectionHeading } from './section-heading';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import Loader from '@/components/custom/loader';
import { getHolidaysPayload, handleAlert } from '@/lib/utils';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { parseForwardActions } from '@/lib/call-standard';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  type CompanyDefaultTemplate,
} from '@/lib/company-defaults';
import {
  buildHolidayImport,
  readCompanyHolidays,
  type HolidayAction,
  type ImportResult,
} from '@/lib/company-holiday-import';
import {
  allNumbersList,
  callForwarding,
  callQueueInfo,
  callQueueList,
  getUserList,
  ivrList,
  updateMemberForwading,
  upsertCallQueue,
  upsertIVR,
} from '@/services/api';
import { invalidateNumberLists } from '@/lib/number-list-cache';

/* The same cap the business-hours dialog enforces. It is a local constant there
   too, so this is a second copy rather than a shared one — worth knowing if the
   limit ever moves. */
const MAX_HOLIDAYS = 10;

/* Saves run one at a time, with a breath between them. The endpoints below
   regenerate dialplans, and two hundred parallel writes is how a bulk action
   becomes an outage. */
const BATCH_PAUSE_MS = 150;

type LineType = 'queue' | 'ivr' | 'user' | 'number';

interface Line {
  /* Unique across types — ids are only unique within their own table. */
  key: string;
  type: LineType;
  id: string;
  name: string;
  detail: string;
  /* The list row, kept so the save can echo back what the server gave us. */
  row: any;
}

type Outcome = 'added' | 'unchanged' | 'skipped' | 'failed';

interface LineResult {
  outcome: Outcome;
  text: string;
}

const GROUPS: { type: LineType; label: string; blurb: string }[] = [
  {
    type: 'queue',
    label: 'Call queues',
    blurb: 'Holidays borrow the queue’s holiday action, or its closed-hours action.',
  },
  {
    type: 'ivr',
    label: 'IVR menus',
    blurb: 'Holidays borrow what the menu already does outside opening hours.',
  },
  {
    type: 'user',
    label: 'People',
    blurb: 'Holidays borrow the person’s closed-hours action.',
  },
  {
    type: 'number',
    label: 'Numbers',
    blurb: 'Only numbers that already have call handling set up can take a holiday.',
  },
];

/* ------------------------------------------------------------- small helpers */

const asObject = (value: unknown): any => parseForwardActions(value) || {};

const pad = (value: number) => `${value}`.padStart(2, '0');

/* The dialog's own date pickers store 'YYYY-MM-DD', so that is the shape the
   stored holidays are in and the shape written here. `buildHolidayImport` hands
   back Date objects for react-hook-form, and serialising those straight to JSON
   would produce a UTC timestamp that renders as the previous day west of the
   meridian — the off-by-one holiday. */
const toDayString = (value: any): string => {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const text = `${value || ''}`;
  return text.length >= 10 ? text.slice(0, 10) : text;
};

/* Stored actions are flat — `{ type, type_label, value, value_label }` — while
   `buildHolidayImport` reads the form's nested shape. Both halves must carry a
   `value` or the resolved action is refused, which is the intended behaviour:
   an action we cannot state is one we must not write. */
const actionFromStored = (action: any): HolidayAction | undefined => {
  if (!action?.type) return undefined;
  return {
    type: { label: action.type_label || action.label || '', value: `${action.type}` },
    value: {
      label: action.value_label || action.label || action.name || '',
      value: `${action.value || ''}`,
      name: action.name || action.label || '',
    },
    personal: Boolean(action.personal),
  };
};

/* New rows are converted with the same helper every save path uses, so what is
   written here is indistinguishable from what the dialog writes. */
const toStoredHolidays = (toAppend: any[]) =>
  getHolidaysPayload(toAppend as any).map((row: any, index: number) => ({
    ...row,
    from: toDayString(toAppend[index]?.from),
    to: toDayString(toAppend[index]?.to),
  }));

const outcomeStyle: Record<Outcome, string> = {
  added: 'text-emerald-700',
  unchanged: 'text-gray-500',
  skipped: 'text-amber-700',
  failed: 'text-red-600',
};

const OutcomeIcon = ({ outcome }: { outcome: Outcome }) => {
  if (outcome === 'added') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />;
  if (outcome === 'failed') return <XCircle className="h-3.5 w-3.5 shrink-0" />;
  if (outcome === 'skipped') return <AlertTriangle className="h-3.5 w-3.5 shrink-0" />;
  return <MinusCircle className="h-3.5 w-3.5 shrink-0" />;
};

/* ------------------------------------------------------------------- the UI */

const CompanyHolidayApply = () => {
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, LineResult>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [personalFallback, setPersonalFallback] = useState(false);
  const stopped = useRef(false);

  const { data: companyDefaults, isLoading: loadingCompany } =
    useQuery<CompanyDefaultTemplate | null>({
      queryKey: COMPANY_DEFAULTS_QUERY_KEY,
      queryFn: fetchCompanyDefaults,
      staleTime: 5 * 60 * 1000,
    });

  const companyHolidays = useMemo(
    () => readCompanyHolidays(companyDefaults?.settings),
    [companyDefaults],
  );

  /* Nothing is fetched until the picker is opened. This panel sits on a page
     that already loads plenty, and four full list walks to answer a question
     nobody asked is rude. The endpoints cap `limit` at 200, so each list is
     walked page by page rather than requested in one oversized call. */
  const { data: queues = [], isPending: loadingQueues } = useQuery({
    queryKey: ['callQueueListQueryFn', 'companyHolidayApply'],
    queryFn: () => fetchAllPages(callQueueList as any, { filters: [], search: '' }),
    enabled: open,
  });

  const { data: ivrs = [], isPending: loadingIvrs } = useQuery({
    queryKey: ['ivrList', 'companyHolidayApply'],
    queryFn: () => fetchAllPages(ivrList as any, { filters: [], search: '' }),
    enabled: open,
  });

  const { data: people = [], isPending: loadingPeople } = useQuery({
    queryKey: ['fetchUsersList', 'companyHolidayApply'],
    queryFn: () => fetchAllPages(getUserList),
    enabled: open,
  });

  const { data: numbers = [], isPending: loadingNumbers } = useQuery({
    queryKey: ['usedNumbersList', 'companyHolidayApply'],
    queryFn: () => fetchAllPages(allNumbersList, { type: 'in_use' }),
    enabled: open,
  });

  const loadingLines = open && (loadingQueues || loadingIvrs || loadingPeople || loadingNumbers);

  const lines = useMemo<Record<LineType, Line[]>>(() => {
    const queueLines: Line[] = (queues as any[])
      .map((row) => {
        const id = `${row?._id || row?.uuid || ''}`;
        return {
          key: `queue:${id}`,
          type: 'queue' as const,
          id,
          name: row?.name || 'Untitled queue',
          detail: row?.extension ? `Extension ${row.extension}` : '',
          row,
        };
      })
      .filter((line) => line.id);

    const ivrLines: Line[] = (ivrs as any[])
      .map((row) => {
        const id = `${row?.uuid || ''}`;
        return {
          key: `ivr:${id}`,
          type: 'ivr' as const,
          id,
          name: row?.name || 'Untitled menu',
          detail: row?.extension ? `Extension ${row.extension}` : '',
          row,
        };
      })
      .filter((line) => line.id);

    const userLines: Line[] = (people as any[])
      .map((row) => {
        const id = `${row?.uuid || ''}`;
        const name = `${row?.first_name || ''} ${row?.last_name || ''}`.trim();
        return {
          key: `user:${id}`,
          type: 'user' as const,
          id,
          name: name || row?.email || 'Unnamed person',
          detail: row?.extension ? `Extension ${row.extension}` : '',
          row,
        };
      })
      .filter((line) => line.id);

    const numberLines: Line[] = (numbers as any[])
      .map((row) => {
        const id = `${row?.uuid || ''}`;
        return {
          key: `number:${id}`,
          type: 'number' as const,
          id,
          name: row?.did_number || row?.did_name || 'Number',
          detail: row?.did_name && row?.did_number ? row.did_name : '',
          row,
        };
      })
      .filter((line) => line.id);

    return { queue: queueLines, ivr: ivrLines, user: userLines, number: numberLines };
  }, [queues, ivrs, people, numbers]);

  const allLines = useMemo(
    () => [...lines.queue, ...lines.ivr, ...lines.user, ...lines.number],
    [lines],
  );

  const selectedLines = useMemo(
    () => allLines.filter((line) => selected[line.key]),
    [allLines, selected],
  );

  /* ------------------------------------------------------------- preflight */

  /* What the list row already tells us, so an admin does not tick forty lines
     that will all come back skipped. Queues are the exception: their list row
     carries settings but the save needs the full record, so anything the row
     does not answer is settled when the line is actually read. */
  const storedHoursOf = (line: Line): any => {
    if (line.type === 'queue') return line.row?.settings?.operational_hours;
    if (line.type === 'ivr') return asObject(line.row?.settings)?.operational_hours;
    if (line.type === 'user') return asObject(line.row?.settings)?.operational_hours;
    return parseForwardActions(line.row?.forward_call_actions)?.condition?.operational_hours;
  };

  const preflight = (line: Line): string => {
    if (line.type === 'number' && !parseForwardActions(line.row?.forward_call_actions)) {
      return 'No call handling yet';
    }
    if (line.type === 'ivr' && !Array.isArray(line.row?.ivr_option)) {
      return 'Key options not readable';
    }
    const hours = storedHoursOf(line);
    if (!hours) return '';
    const action =
      actionFromStored(hours?.holidays_action) || actionFromStored(hours?.closed_hour_action);
    if (!action) {
      return line.type === 'user' && personalFallback
        ? 'Will use their own voicemail'
        : 'No closed-hours action';
    }
    const held = (hours?.holidays || []).length;
    if (held >= MAX_HOLIDAYS) return `Already holds ${MAX_HOLIDAYS}`;
    return '';
  };

  /* --------------------------------------------------------------- the plan */

  const planFor = (
    existing: any[],
    action: HolidayAction | undefined,
    fallbackExtension?: string,
  ): ImportResult =>
    buildHolidayImport({
      companyHolidays,
      existingHolidays: existing,
      closedHourAction: action,
      fallbackExtension,
      capacity: MAX_HOLIDAYS - (existing?.length || 0),
    });

  const describe = (plan: ImportResult): LineResult => {
    if (plan.unresolvedAction) {
      return {
        outcome: 'skipped',
        text: 'Skipped — no closed-hours action to copy. Set one on this line first.',
      };
    }
    if (!plan.toAppend.length) {
      if (plan.skippedCapacity) {
        return {
          outcome: 'skipped',
          text: `Skipped — already holds ${MAX_HOLIDAYS} holidays, so ${plan.skippedCapacity} did not fit.`,
        };
      }
      return { outcome: 'unchanged', text: 'Already had these holidays.' };
    }
    const parts = [`Added ${plan.toAppend.length}`];
    if (plan.skippedDuplicate) parts.push(`${plan.skippedDuplicate} already there`);
    if (plan.skippedCapacity) {
      parts.push(`${plan.skippedCapacity} did not fit (a line holds ${MAX_HOLIDAYS})`);
    }
    return { outcome: 'added', text: `${parts.join(' · ')}.` };
  };

  /* ------------------------------------------------------------ the writes */

  /* Each of these reads the record, decides, and — only when there is something
     to add — writes the whole record back with the holiday array replaced. The
     fields around it are the server's own values passed straight through. */

  const applyToQueue = async (line: Line): Promise<LineResult> => {
    const response: any = await callQueueInfo({ uuid: line.id });
    const queue = response?.data?.data?.result || {};
    const settings = queue?.settings || {};
    const hours = settings?.operational_hours || {};
    const existing = hours?.holidays || [];

    /* A queue can carry a holiday action distinct from its closed-hours one,
       and that is the more exact answer to "what does this queue do on a
       holiday". Closed hours stays the fallback, matching how the queue form
       resolves the same pair. */
    const action =
      actionFromStored(hours?.holidays_action) || actionFromStored(hours?.closed_hour_action);

    const plan = planFor(existing, action);
    const result = describe(plan);
    if (result.outcome !== 'added') return result;

    await upsertCallQueue({
      uuid: line.id,
      name: queue?.name,
      extension: `${queue?.extension ?? ''}`,
      description: queue?.description,
      site: queue?.site_uuid,
      settings: {
        ...settings,
        operational_hours: {
          ...hours,
          holidays: [...existing, ...toStoredHolidays(plan.toAppend)],
        },
      },
      members: queue?.members || [],
      manager: queue?.manager || {},
      script: queue?.script || '',
      agentDisposition: queue?.agentDisposition || [],
    });

    return result;
  };

  const applyToIvr = async (line: Line): Promise<LineResult> => {
    const row = line.row;

    /* `/api/tenant/ivr/upsert` replaces the menu, key options included, so the
       options have to be written back with it. If the list row did not carry
       them there is nothing to write back, and saving would silently empty the
       menu — so the line is skipped rather than guessed at. */
    if (!Array.isArray(row?.ivr_option)) {
      return {
        outcome: 'skipped',
        text: 'Skipped — this menu’s key options were not in the list, and saving without them would empty the menu. Open it and import the holidays there.',
      };
    }

    const settings = asObject(row?.settings);
    const hours = settings?.operational_hours || {};
    const existing = hours?.holidays || [];

    const plan = planFor(existing, actionFromStored(hours?.closed_hour_action));
    const result = describe(plan);
    if (result.outcome !== 'added') return result;

    /* `site` and `generic_keys` are stored as JSON strings and are handed back
       exactly as they arrived; re-serialising them would be a chance to change
       them. `timeout_limit` is the column name — `timeout` matches nothing and
       is silently discarded. */
    await upsertIVR({
      uuid: line.id,
      extension: row?.extension ?? '',
      name: row?.name ?? '',
      description: row?.description ?? '',
      language: row?.language ?? '',
      site: typeof row?.site === 'string' ? row.site : JSON.stringify(row?.site || {}),
      settings: JSON.stringify({
        ...settings,
        operational_hours: {
          ...hours,
          holidays: [...existing, ...toStoredHolidays(plan.toAppend)],
        },
      }),
      ivr_option: row.ivr_option.map((option: any) => ({
        key: option?.key,
        type: option?.type,
        value: option?.value,
        label: option?.label,
      })),
      generic_keys:
        typeof row?.generic_keys === 'string'
          ? row.generic_keys
          : JSON.stringify(row?.generic_keys || {}),
      max_failures: row?.max_failures,
      max_timeouts: row?.max_timeouts,
      timeout_limit: row?.timeout_limit ?? row?.timeout,
    });

    return result;
  };

  const applyToUser = async (line: Line): Promise<LineResult> => {
    const person = line.row;
    const settings = asObject(person?.settings);
    const hours = settings?.operational_hours || {};
    const existing = hours?.holidays || [];

    const plan = planFor(
      existing,
      actionFromStored(hours?.closed_hour_action),
      /* Only ever a person's own extension, and only when the admin asked for
         it above. Inventing a mailbox for a queue or a menu would be inventing
         routing policy; a person's own voicemail is the one fallback that
         means what it says. */
      personalFallback ? `${person?.extension || ''}` : undefined,
    );
    const result = describe(plan);
    if (result.outcome !== 'added') return result;

    /* `/api/user/update` replaces the whole user record — there is no endpoint
       that patches one field for someone else — so every other value is read
       off the person and written straight back, exactly as
       `assignVoicemailGreeting` does. */
    const roleId = person?.custom_role_uuid || person?.role_uuid;
    const siteUuid = person?.site_uuid || person?.site?.uuid;

    await updateMemberForwading({
      first_name: person?.first_name,
      last_name: person?.last_name,
      job_title: person?.job_title,
      /* Omitted when absent rather than sent empty: writing these back in a
         different form than they were stored reads as "clear this", not "we
         could not resolve it". */
      ...(person?.caller_id ? { caller_id: person.caller_id } : {}),
      ...(siteUuid ? { site_uuid: siteUuid } : {}),
      call_forwarding: asObject(person?.call_forwarding),
      ...(person?.custom_role_uuid ? { custom_role_uuid: roleId } : { role_uuid: roleId }),
      greetings: asObject(person?.greetings),
      settings: {
        ...settings,
        operational_hours: {
          ...hours,
          holidays: [...existing, ...toStoredHolidays(plan.toAppend)],
        },
      },
      uuid: person?.uuid,
      userID: person?.uuid,
    });

    return result;
  };

  const applyToNumber = async (line: Line): Promise<LineResult> => {
    const actions = parseForwardActions(line.row?.forward_call_actions);
    /* An empty `forward_call_actions` means the number has no handling at all —
       no hours, no closed branch, nothing for a holiday to borrow. Writing one
       here would be authoring this number's whole call flow. */
    if (!actions) {
      return {
        outcome: 'skipped',
        text: 'Skipped — this number has no call handling yet, so there is nothing for a holiday to borrow.',
      };
    }

    const condition = actions?.condition || {};
    const hours = condition?.operational_hours || {};
    const existing = hours?.holidays || [];

    const plan = planFor(existing, actionFromStored(hours?.closed_hour_action));
    const result = describe(plan);
    if (result.outcome !== 'added') return result;

    await callForwarding({
      uuid: line.row?.uuid,
      forward_call_actions: {
        ...actions,
        condition: {
          ...condition,
          operational_hours: {
            ...hours,
            holidays: [...existing, ...toStoredHolidays(plan.toAppend)],
          },
        },
      },
    });

    return result;
  };

  const applyToLine = (line: Line): Promise<LineResult> => {
    if (line.type === 'queue') return applyToQueue(line);
    if (line.type === 'ivr') return applyToIvr(line);
    if (line.type === 'user') return applyToUser(line);
    return applyToNumber(line);
  };

  /* ------------------------------------------------------------- the run */

  const { mutate: run, isPending: running } = useMutation({
    mutationFn: async (targets: Line[]) => {
      stopped.current = false;
      setResults({});
      setProgress({ done: 0, total: targets.length });

      const tally: Record<Outcome, number> = { added: 0, unchanged: 0, skipped: 0, failed: 0 };

      for (const line of targets) {
        if (stopped.current) break;

        let result: LineResult;
        try {
          result = await applyToLine(line);
        } catch (error: any) {
          result = {
            outcome: 'failed',
            text:
              error?.response?.data?.message ||
              error?.message ||
              'The save was rejected. Nothing was changed on this line.',
          };
        }

        tally[result.outcome] += 1;
        setResults((previous) => ({ ...previous, [line.key]: result }));
        setProgress((previous) => (previous ? { ...previous, done: previous.done + 1 } : previous));

        if (BATCH_PAUSE_MS) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
        }
      }

      return tally;
    },
    onSuccess: (tally) => {
      /* Every list this touched, so the other screens do not keep showing the
         holiday counts they had before. */
      queryClient.invalidateQueries({ queryKey: ['callQueueListQueryFn'] });
      queryClient.invalidateQueries({ queryKey: ['ivrList'] });
      queryClient.invalidateQueries({ queryKey: ['fetchUsersList'] });
      invalidateNumberLists(queryClient);

      const failed = tally.failed;
      handleAlert({
        text: failed
          ? `${tally.added} line${tally.added === 1 ? '' : 's'} updated, ${failed} failed. The list below says what happened to each.`
          : `${tally.added} line${tally.added === 1 ? '' : 's'} updated. ${tally.unchanged} already had them, ${tally.skipped} skipped.`,
        type: failed ? 'error' : 'success',
      });
    },
    onError: () => {
      handleAlert({ text: 'The run stopped early. Nothing further was changed.', type: 'error' });
    },
  });

  const toggleLine = (key: string) =>
    setSelected((previous) => {
      const next = { ...previous };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });

  const toggleGroup = (type: LineType) =>
    setSelected((previous) => {
      const group = lines[type];
      const allOn = group.length > 0 && group.every((line) => previous[line.key]);
      const next = { ...previous };
      group.forEach((line) => {
        if (allOn) delete next[line.key];
        else next[line.key] = true;
      });
      return next;
    });

  const start = () => {
    if (!companyHolidays.length) {
      handleAlert({ text: 'There are no company holidays to apply yet.', type: 'error' });
      return;
    }
    if (!selectedLines.length) {
      handleAlert({ text: 'Tick the lines you want the holidays on first.', type: 'error' });
      return;
    }
    run(selectedLines);
  };

  return (
    <div className="cs-block">
      {/* The shared heading, not a hand-built one.
          This section drew its own: a 40px tile filled with `bg-ucass-primary-200
          text-primary`, which renders as a solid blue block rather than the
          quiet tile SectionHeading gives every other section — including the
          Holidays heading directly above it, so the two sat inches apart looking
          like different products. SectionHeading exists for exactly this; its
          own note lists the four treatments it was written to replace, and this
          was a fifth that never moved across. */}
      <SectionHeading
        icon={<CalendarCheck2 className="h-[18px] w-[18px]" />}
        title="Copy these holidays onto your lines"
        description={
          <>
            Optional. You do not need this for holidays to work; the list above already closes your
            lines on its own. Use it to copy the {companyHolidays.length} date
            {companyHolidays.length === 1 ? '' : 's'} onto your queues, menus, people and numbers so
            their own screens show them too, instead of opening each one.
          </>
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen((previous) => !previous)}
            disabled={running}
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? 'Hide lines' : 'Choose lines'}
          </Button>
        }
      />

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
        <p className="text-xs text-gray-700">
          <span className="font-semibold text-gray-900">What this writes.</span> Each holiday is
          added to the line&apos;s own holiday list with the action that line already uses when it
          is closed — a holiday has no separate action, it borrows the closed-hours one. Dates
          already on a line are left exactly as they are, and a line with no closed-hours action
          set is skipped and named rather than saved with a broken one. This changes what each
          line&apos;s screen shows; it does not change how a call is routed, because the router
          already reads the company list.
        </p>
      </div>

      {!loadingCompany && companyHolidays.length === 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-gray-700">
            There are no company holidays yet. Add some to the list above and save them first.
          </p>
        </div>
      )}

      {open && (
        <>
          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3">
            <Switch
              checked={personalFallback}
              onCheckedChange={(checked) => setPersonalFallback(!!checked)}
              disabled={running}
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-gray-900">
                For people with no closed-hours action, use their own voicemail
              </span>
              <span className="mt-0.5 block text-xs text-gray-600">
                Off by default. A person&apos;s own mailbox is the one fallback that means what it
                says; queues, menus and numbers are always skipped instead, because choosing what
                they do on a holiday is a routing decision, not a default.
              </span>
            </span>
          </label>

          {loadingLines ? (
            <div className="mt-3">
              <Loader />
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {GROUPS.map((group) => {
                const groupLines = lines[group.type];
                const chosen = groupLines.filter((line) => selected[line.key]).length;
                const allOn = groupLines.length > 0 && chosen === groupLines.length;

                return (
                  <div key={group.type} className="rounded-lg border border-gray-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 p-3">
                      <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={allOn}
                          onCheckedChange={() => toggleGroup(group.type)}
                          disabled={running || groupLines.length === 0}
                          aria-label={`Select all ${group.label}`}
                        />
                        <span className="text-sm font-semibold text-gray-900">
                          {group.label}{' '}
                          <span className="font-normal text-gray-500">({groupLines.length})</span>
                        </span>
                      </label>
                      <span className="text-xs text-gray-600">
                        {chosen > 0 ? `${chosen} selected · ` : ''}
                        {group.blurb}
                      </span>
                    </div>

                    {groupLines.length === 0 ? (
                      <p className="p-3 text-xs text-gray-500">None on this account.</p>
                    ) : (
                      <div className="flex max-h-72 flex-col overflow-y-auto">
                        {groupLines.map((line) => {
                          const result = results[line.key];
                          const hint = result ? '' : preflight(line);
                          return (
                            <label
                              key={line.key}
                              className="flex cursor-pointer items-center justify-between gap-3 border-b border-gray-100 p-2.5 last:border-b-0 hover:bg-gray-50"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <Checkbox
                                  checked={!!selected[line.key]}
                                  onCheckedChange={() => toggleLine(line.key)}
                                  disabled={running}
                                  aria-label={`Select ${line.name}`}
                                />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm text-gray-900">
                                    {line.name}
                                  </span>
                                  {line.detail && (
                                    <span className="block truncate text-xs text-gray-500">
                                      {line.detail}
                                    </span>
                                  )}
                                </span>
                              </span>

                              {result ? (
                                <span
                                  className={`flex shrink-0 items-center gap-1.5 text-xs ${outcomeStyle[result.outcome]}`}
                                >
                                  <OutcomeIcon outcome={result.outcome} />
                                  <span className="max-w-[22rem] text-right">{result.text}</span>
                                </span>
                              ) : hint ? (
                                <span className="shrink-0 text-xs text-gray-500">{hint}</span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-600">
              {progress
                ? `${progress.done} of ${progress.total} done${running ? '…' : ''}`
                : `${selectedLines.length} line${selectedLines.length === 1 ? '' : 's'} selected`}
            </p>
            <div className="flex items-center gap-2">
              {running && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    stopped.current = true;
                  }}
                >
                  Stop after this line
                </Button>
              )}
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={start}
                disabled={running || loadingLines || !companyHolidays.length}
              >
                {running
                  ? 'Applying…'
                  : `Apply to ${selectedLines.length} line${selectedLines.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>

          <p className="mt-2 text-xs text-gray-500">
            Lines are saved one at a time, not all at once, so a big run does not hit the switch in
            one burst. You can stop part-way — the lines already saved keep their holidays.
          </p>
        </>
      )}
    </div>
  );
};

export default CompanyHolidayApply;
