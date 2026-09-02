import { Icon } from '@/assets/icons/icon';
import CustomSelect from '@/components/custom/custom-select';
import ErrorTooltip from '@/components/custom/error-tooltip';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ISELECTVALUE } from '@/interfaces/api-interfaces';
import { getDispositions } from '@/services/api';
import { useQuery } from '@tanstack/react-query';
import { FC } from 'react';
import { useFormContext } from 'react-hook-form';
import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import { TIME_LIST } from '@/pages/auto-dialer/campaign/add-edit-campaign/consts';
import { WRAPUP_DEFAULT_MODE, WRAPUP_PROMPT_MODES } from '../../constant';

/**
 * What happens around a queue call, rather than to it.
 *
 * These three settings were laid out as one row of unrelated dropdowns, which
 * made them read as a single thing with three parts. They are not: one governs
 * the seconds after a call, one what the agent reads during it, and one how the
 * agent labels it afterwards. They are separated here so each can carry its own
 * honest badge - and they do not all reach equally far.
 */

const QueueSettings: FC<any> = ({ scriptList, setModalState }) => {
  const {
    formState: { errors },
    setValue,
    watch,
  } = useFormContext();

  const { data: dispositionsList = [] } = useQuery({
    queryKey: ['getDispositionsList'],
    queryFn: () => getDispositions({ page: 1, limit: 200 }),
    select: (data) => data?.data?.data?.result?.rows || [],
  });

  const agentDispositions = (dispositionsList as any[]).filter(
    (item: any) => item?.dispositionType?.toLowerCase() === 'agent',
  );

  const handleDispositionCheck = (checked: boolean, item: any) => {
    const currentValues = watch('agentDisposition') || [];
    if (checked) {
      if (!currentValues.some((d: any) => d._id === item?._id)) {
        setValue('agentDisposition', [...currentValues, { ...item }], { shouldValidate: true });
      }
    } else {
      setValue(
        'agentDisposition',
        currentValues.filter((d: any) => d._id !== item?._id),
        { shouldValidate: true },
      );
    }
  };

  const isDispositionChecked = (item: any) =>
    (watch('agentDisposition') || []).some((d: any) => d._id === item?._id);

  const chosenCount = (watch('agentDisposition') || []).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <SettingCard
        title="After a call ends"
        description="The pause an agent gets before the queue sends them the next caller."
        note="The rules that let an agent finish early are obeyed. Holding them until they have labelled the call is not built yet, so the ones that require it behave like the timer."
      >
        <SettingRow
          label="Wrap-up time"
          description="Seconds an agent is held back after hanging up, to finish their notes."
          status="active"
          control={
            <CustomSelect
              placeholder="Select seconds"
              options={TIME_LIST.map((item) => ({ label: item, value: item }))}
              handleChange={(e: ISELECTVALUE | null) => {
                setValue(`settings.wrapup_time`, e?.value || '', { shouldValidate: true });
              }}
              value={{
                value: watch('settings.wrapup_time'),
                label: watch('settings.wrapup_time'),
              }}
              error={(errors?.settings as any)?.wrapup_time?.message}
              menuPlacement="auto"
            />
          }
        />

        {/* The prompt mode, not just the timer. "Optional" and "cannot be
            skipped" are different products to a supervisor, and a timer alone
            cannot say which one this queue is.
            
            Half honoured: the agent's call screen now reads this and lets them
            finish early where the rule allows it. Holding them until the call is
            labelled needs the chosen disposition, which lives in a different
            part of the call screen - so those modes still behave like the timer,
            which is what every mode did before. Badged app-only, because it is
            the app that obeys it and nothing further down. */}
        <SettingRow
          label="Wrap-up rule"
          description="Whether an agent may skip their wrap-up, or has to finish it."
          status="app-only"
          control={
            <CustomSelect
              placeholder="Select Option"
              options={WRAPUP_PROMPT_MODES}
              handleChange={(e: ISELECTVALUE | null) => {
                setValue('settings.after_call.wrapup_prompt', e?.value || WRAPUP_DEFAULT_MODE, {
                  shouldValidate: true,
                });
              }}
              value={
                WRAPUP_PROMPT_MODES.find(
                  (mode) => mode.value === watch('settings.after_call.wrapup_prompt'),
                ) || WRAPUP_PROMPT_MODES.find((mode) => mode.value === WRAPUP_DEFAULT_MODE)
              }
              menuPlacement="auto"
            />
          }
        />
      </SettingCard>

      <SettingCard
        title="What the agent reads on the call"
        description="A script shown in the agent's call panel while they are talking to this queue's callers."
        status="app-only"
        note="A script is something an agent reads. Nothing outside this app acts on it, and a caller never sees it."
      >
        <SettingRow
          label="Call script"
          description="Turn on to show one of your saved scripts to whoever answers."
          control={
            <div className="flex w-full items-center gap-2">
              <Switch
                id="script_enabled"
                checked={watch('script_enabled')}
                onCheckedChange={(checked) => {
                  setValue('script_enabled', checked, { shouldValidate: true });
                  if (!checked) {
                    setValue('script', { label: '', value: '' }, { shouldValidate: true });
                  }
                }}
              />
              {((errors as any)?.script?.value?.message ?? errors?.script?.message) && (
                <ErrorTooltip
                  text={(errors as any)?.script?.value?.message ?? errors?.script?.message}
                />
              )}
            </div>
          }
        />

        {watch('script_enabled') ? (
          <SettingRow
            label="Which script"
            description="Written under Call scripts. Changing it here changes what this queue's agents see."
            control={
              <CustomSelect
                placeholder="Choose a script"
                options={scriptList?.map((script: { name: string; _id: string }) => ({
                  label: script?.name,
                  value: script?._id,
                }))}
                handleChange={(e: ISELECTVALUE | null) => {
                  setValue(`script`, e || { label: '', value: '' }, { shouldValidate: true });
                }}
                value={watch('script')}
              />
            }
          />
        ) : null}
      </SettingCard>

      <SettingCard
        title="How agents label a call"
        description="When a call ends, the agent picks one of these to say how it went. It is saved with the call and counted in reports."
        status="active"
        note={
          agentDispositions.length === 0
            ? 'No labels exist yet. Add one with the button above - until then agents are asked for nothing.'
            : `${chosenCount} of ${agentDispositions.length} offered on this queue. Switch on only the ones that make sense here - a shorter list gets picked more honestly.`
        }
        aside={
          <Button
            className="shadow-none"
            variant="secondary"
            type="button"
            onClick={() => setModalState(true)}
            aria-label="Add a label"
          >
            <Icon name="Plus" className="h-3 w-3" />
          </Button>
        }
      >
        {(errors as any)?.agentDisposition?.message && (
          <p className="text-sm text-red-600">{(errors as any).agentDisposition.message}</p>
        )}

        {agentDispositions.length === 0 ? (
          <p className="text-sm text-gray-600">
            Nothing to choose from yet. Labels are shared across your whole company, so one added
            here can be offered on any queue.
          </p>
        ) : (
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            {agentDispositions.map((item: any) => (
              <label
                key={item?._id || item?.disposition?.name}
                htmlFor={item?._id}
                className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3"
              >
                <Switch
                  id={item?._id}
                  checked={isDispositionChecked(item)}
                  onCheckedChange={(checked) => handleDispositionCheck(checked, item)}
                />
                <span className="text-sm font-semibold text-gray-900/80">
                  {item?.disposition?.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </SettingCard>
    </div>
  );
};

export default QueueSettings;
