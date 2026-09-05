import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, IdCard, Plus, Trash2 } from 'lucide-react';

import CustomSelect from '@/components/custom/custom-select';
import Loader from '@/components/custom/loader';
import { Button } from '@/components/ui/button';
import { SectionActions } from './section-actions';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { handleAlert } from '@/lib/utils';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  saveCompanyDefaults,
} from '@/lib/company-defaults';

/**
 * Extra details on a person's record — the ones every company keeps and no
 * phone system ships: Employee ID, Department code, Start date, Desk number.
 * -----------------------------------------------------------------------------
 * This screen defines the *shape* only. Definitions live in the reserved
 * "Company Default" template row, namespaced under `settings.company_profile_fields`,
 * so nothing else in that blob is touched on save. Nothing is ever written onto
 * a person's record from here.
 *
 * IMPORTANT — nothing in this product reads `settings.company_profile_fields` yet.
 * No person form renders these, no directory column shows them, and no API
 * accepts them. Every definition below is a saved decision, not a live field,
 * and the card says so on screen. Please keep that note accurate if a person
 * form starts honouring it.
 *
 * Why an id and not the label: values recorded against a field must survive the
 * label being reworded. An id minted once at creation and never regenerated is
 * the only thing that keeps "Employee ID" renamed to "Staff number" pointing at
 * the same stored values. Editing a label deliberately does not touch the id.
 */

const PROFILE_FIELDS_KEY = 'company_profile_fields';
const PROFILE_FIELDS_SCHEMA_VERSION = 1;

const MAX_FIELDS = 20;
const MAX_CHOICES = 30;
const LABEL_MAX = 40;

type FieldType = 'text' | 'number' | 'date' | 'choice';

const TYPE_OPTIONS: { label: string; value: FieldType }[] = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Date', value: 'date' },
  { label: 'Pick from a list', value: 'choice' },
];

const TYPE_HELPER: Record<FieldType, string> = {
  text: 'Anything typed — a name, a code, a note.',
  number: 'Digits only, so it can be counted and sorted.',
  date: 'A single calendar day.',
  choice: 'The person picks one of the options you set below.',
};

interface FieldForm {
  /** Minted once. Never changes, whatever the label becomes. */
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Only meaningful when `type` is 'choice'; kept as typed text, one per line. */
  choicesText: string;
  /** Present on definitions loaded from the record, absent on new rows. */
  created_at?: string;
}

/* Ids are minted here rather than by the server because the server never sees a
   definition until save, and a row must be reorderable and deletable before
   then. `crypto.randomUUID` is not available on every browser this console
   supports, so there is a plain fallback. Either way the id is opaque: nothing
   should ever parse meaning out of it. */
const mintId = (): string => {
  const globalCrypto = globalThis.crypto as Crypto | undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return `pf_${globalCrypto.randomUUID()}`;
  }
  return `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const toSettingsObject = (rawSettings: any): Record<string, any> => {
  if (!rawSettings) return {};
  if (typeof rawSettings === 'string') {
    try {
      const parsed = JSON.parse(rawSettings);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawSettings === 'object' ? rawSettings : {};
};

const toGreetingsObject = (rawGreetings: any): Record<string, any> =>
  toSettingsObject(rawGreetings);

const toFieldType = (value: any): FieldType =>
  TYPE_OPTIONS.find((option) => option.value === value)?.value || 'text';

/* A stored definition with no id predates this screen or arrived hand-edited.
   It gets one now rather than being dropped, because dropping it would lose the
   admin's definition entirely; the values it may already have are unreachable
   either way, and a definition that exists can at least be seen and deleted. */
const buildFieldsFromSettings = (settings: Record<string, any>): FieldForm[] => {
  const stored = settings?.[PROFILE_FIELDS_KEY]?.fields;
  if (!Array.isArray(stored)) return [];

  return stored
    .filter((entry: any) => entry && typeof entry === 'object')
    .map((entry: any) => {
      const type = toFieldType(entry?.type);
      const choices = Array.isArray(entry?.choices) ? entry.choices : [];
      return {
        id: typeof entry?.id === 'string' && entry.id.trim() ? entry.id : mintId(),
        label: `${entry?.label || ''}`,
        type,
        required: Boolean(entry?.required),
        choicesText: choices.map((choice: any) => `${choice ?? ''}`).join('\n'),
        created_at: typeof entry?.created_at === 'string' ? entry.created_at : undefined,
      };
    });
};

const parseChoices = (choicesText: string): string[] => {
  const seen = new Set<string>();
  return choicesText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CHOICES);
};

const buildPayload = (fields: FieldForm[], now: string) => ({
  version: PROFILE_FIELDS_SCHEMA_VERSION,
  updated_at: now,
  fields: fields.map((field, index) => ({
    id: field.id,
    label: field.label.trim(),
    type: field.type,
    required: field.required,
    /* Order is stored as a number as well as being implied by array position:
       a reader that sorts by it cannot be broken by a future writer that
       appends instead of splicing. */
    order: index + 1,
    ...(field.type === 'choice' ? { choices: parseChoices(field.choicesText) } : {}),
    created_at: field.created_at || now,
  })),
});

const validateFields = (fields: FieldForm[]): Record<string, string> => {
  const errors: Record<string, string> = {};
  const labelCounts = new Map<string, number>();

  fields.forEach((field) => {
    const key = field.label.trim().toLowerCase();
    if (key) labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  });

  fields.forEach((field) => {
    const label = field.label.trim();
    if (!label) {
      errors[`${field.id}:label`] = 'Give this field a name';
    } else if ((labelCounts.get(label.toLowerCase()) || 0) > 1) {
      errors[`${field.id}:label`] = 'Another field already uses this name';
    }

    if (field.type === 'choice' && parseChoices(field.choicesText).length < 2) {
      errors[`${field.id}:choices`] = 'Give at least two options, one per line';
    }
  });

  return errors;
};

const selectedType = (value: FieldType) =>
  TYPE_OPTIONS.find((option) => option.value === value) || null;

const CompanyProfileFields = () => {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<FieldForm[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const {
    data: companyDefaultTemplate = null,
    isLoading,
    isError,
  } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
  });

  const savedSettings = useMemo(
    () => toSettingsObject(companyDefaultTemplate?.settings),
    [companyDefaultTemplate],
  );

  const savedFields = useMemo(() => buildFieldsFromSettings(savedSettings), [savedSettings]);

  useEffect(() => {
    setFields(savedFields);
    setErrors({});
    setConfirmingDelete(null);
  }, [savedFields]);


  const { mutate: saveFields, isPending: isSaving } = useMutation({
    mutationFn: saveCompanyDefaults,
    onSuccess: (response: any) => {
      handleAlert({
        text: response?.data?.message || 'Profile fields saved',
        type: 'success',
      });
      /* The whole company record is invalidated, not just this list. Holidays,
         policies and phone rules read the same row, so a save here must make
         them re-read — otherwise the next screen saves a merge built on a stale
         blob and silently drops what was just written. */
      queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['userTemplateList'] });
    },
  });

  const updateField = (id: string, patch: Partial<FieldForm>) =>
    setFields((prev) => prev.map((field) => (field.id === id ? { ...field, ...patch } : field)));

  const addField = () => {
    if (fields.length >= MAX_FIELDS) {
      handleAlert({ text: `You can have up to ${MAX_FIELDS} fields`, type: 'error' });
      return;
    }
    setFields((prev) => [
      ...prev,
      { id: mintId(), label: '', type: 'text', required: false, choicesText: '' },
    ]);
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    setFields((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((field) => field.id !== id));
    setConfirmingDelete(null);
  };

  const handleSave = () => {
    const nextErrors = validateFields(fields);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      handleAlert({ text: 'Please fix the highlighted fields', type: 'error' });
      return;
    }

    // Merge, never replace: the Company Default row also carries holidays,
    // policies and phone rules, and other screens write into the same blob.
    const nextSettings = {
      ...savedSettings,
      [PROFILE_FIELDS_KEY]: buildPayload(fields, new Date().toISOString()),
    };

    saveFields({
      uuid: companyDefaultTemplate?.uuid,
      settings: nextSettings,
      greetings: toGreetingsObject(companyDefaultTemplate?.greetings),
      only: [PROFILE_FIELDS_KEY],
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center py-10">
        <Loader />
      </div>
    );
  }

  return (
    <section className="cs-section flex w-full flex-col gap-4">
      <div className="cs-block">
        <p className="text-lg font-semibold text-gray-900">Profile fields</p>
        <p className="text-xs text-gray-500">
          The extra details you keep about the people who work here — an employee number, a
          department code, a start date, a desk.
        </p>
      </div>

      <div className="w-full">
        <div className="flex w-full flex-col gap-4">
          {isError && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center">
              <p className="text-sm font-semibold text-gray-900">
                We could not load your saved fields
              </p>
              <p className="text-xs text-gray-500">
                The list below is empty because nothing could be read, not because you have no
                fields. Reload before you save, or you may wipe fields you cannot currently see.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start gap-3 border-b border-gray-200 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ucass-primary-200 text-primary">
                <IdCard className="h-5 w-5" />
              </div>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-gray-900">Your fields</p>
                  <span className="rounded-sm bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                    Coming soon
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Set out the details you want to keep, in the order you want to see them.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={addField}>
                <Plus className="h-3.5 w-3.5" />
                Add a field
              </Button>
            </div>

            <div className="flex flex-col gap-4 p-4">
              {/* The honest bit. Defining a field is real and is saved; nothing
                  yet puts it on anybody's record, and an admin who saves this
                  and then opens a colleague's profile must not be surprised. */}
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Coming soon. What you set here is saved for your company, but these details do not
                appear on anyone&apos;s profile yet — there is nowhere to fill them in, and nothing
                to see in the people list. Set them up now and they are ready when it arrives.
              </p>

              {!fields.length ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center">
                  <p className="text-sm font-semibold text-gray-900">No extra fields yet</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Most companies start with an employee number and a start date.
                  </p>
                </div>
              ) : (
                fields.map((field, index) => {
                  const labelError = errors[`${field.id}:label`];
                  const choicesError = errors[`${field.id}:choices`];
                  const isConfirming = confirmingDelete === field.id;
                  const isSaved = savedFields.some((saved) => saved.id === field.id);

                  return (
                    <div
                      key={field.id}
                      className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-500">
                          Field {index + 1} of {fields.length}
                        </p>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => moveField(index, -1)}
                            disabled={index === 0}
                            aria-label={`Move ${field.label || 'this field'} up`}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => moveField(index, 1)}
                            disabled={index === fields.length - 1}
                            aria-label={`Move ${field.label || 'this field'} down`}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              isSaved ? setConfirmingDelete(field.id) : removeField(field.id)
                            }
                            aria-label={`Remove ${field.label || 'this field'}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1">
                          <Input
                            label="What to call it"
                            placeholder="Employee number"
                            maxLength={LABEL_MAX}
                            value={field.label}
                            error={labelError}
                            onChange={(event) =>
                              updateField(field.id, { label: event.target.value })
                            }
                          />
                          <p className="text-xs text-gray-500">
                            This is what people see. You can reword it later without losing anything
                            already filled in.
                          </p>
                        </div>

                        <div className="flex flex-col gap-1">
                          <CustomSelect
                            label="Kind of answer"
                            options={TYPE_OPTIONS}
                            value={selectedType(field.type)}
                            handleChange={(option: any) =>
                              updateField(field.id, { type: toFieldType(option?.value) })
                            }
                          />
                          <p className="text-xs text-gray-500">{TYPE_HELPER[field.type]}</p>
                        </div>
                      </div>

                      {field.type === 'choice' && (
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-gray-700">The options</p>
                          <textarea
                            rows={4}
                            value={field.choicesText}
                            placeholder={'Full time\nPart time\nContractor'}
                            onChange={(event) =>
                              updateField(field.id, { choicesText: event.target.value })
                            }
                            className={`w-full rounded-xl border bg-white px-3 py-2 text-sm text-gray-700 shadow-sm outline-none ${
                              choicesError
                                ? 'border-red-500'
                                : 'border-gray-300 hover:border-primary focus:border-primary'
                            }`}
                          />
                          <p
                            className={`text-xs ${choicesError ? 'text-red-600' : 'text-gray-500'}`}
                          >
                            {choicesError ||
                              `One option per line, at least two. Up to ${MAX_CHOICES}; blank lines and repeats are dropped.`}
                          </p>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">Must be filled in</p>
                          <p className="text-xs text-gray-500">
                            Nobody&apos;s profile counts as complete without it.
                          </p>
                        </div>
                        <Switch
                          checked={field.required}
                          onCheckedChange={(checked) =>
                            updateField(field.id, { required: Boolean(checked) })
                          }
                          aria-label={`Make ${field.label || 'this field'} required`}
                        />
                      </div>

                      {isConfirming && (
                        <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                          <p className="text-xs font-semibold text-gray-900">
                            Remove &quot;{field.label.trim() || 'this field'}&quot;?
                          </p>
                          <p className="text-xs text-gray-700">
                            Anything already filled in against this field stays where it is but
                            becomes impossible to see or search, and adding the field back later
                            will not bring it into view — the new one is treated as a different
                            field. If you only want to reword it, change its name instead.
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setConfirmingDelete(null)}
                            >
                              Keep it
                            </Button>
                            <Button
                              type="button"
                              variant="primary"
                              onClick={() => removeField(field.id)}
                            >
                              Remove it
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="cs-savebar">
            <p className="text-xs text-gray-500">
              Saved for your whole company. Nobody&apos;s own profile is changed by saving here.
            </p>
            <SectionActions>
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="cs-save"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save settings'}
              </Button>
            </SectionActions>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CompanyProfileFields;
