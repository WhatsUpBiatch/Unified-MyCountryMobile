import { Icon } from '@/assets/icons/icon';
import CustomAvatar from '@/components/custom/custom-avatar';
import TableManager from '@/components/custom/table-manager';
import { SettingCard, SettingFlag } from '@/components/mcm/setting-card';
import { chooseManager, isOnQueue, memberKey, toggleMember } from '@/lib/queue-members';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { forwardActionType } from '@/services/api';
import { ColumnDef } from '@tanstack/react-table';
import { FC, useState, useMemo, memo, useCallback } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import useDebounce from '@/hooks/use-debounce';
import { SearchLine } from '@/assets/icons';

interface IMEMBER {
  first_name: string;
  last_name: string;
  label: string;
  extension: string;
  value: string;
  email: string;
  role: string;
  uuid: string;
  user_uuid: string;
  custom_role_data: { name: string };
  role_data: { name: string };
  skills: any;
  profile?: string;
}

/* One reading of a person's role.
 *
 * There were three. The name cell showed `custom_role_data ?? role_data ?? role`,
 * the manager radio decided whether to enable itself from `role_data ?? role`,
 * and the click handler checked the raw `role` on its own. So somebody whose
 * role comes from a custom role — which is what the list actually displays —
 * could be shown as MANAGER and still never be selectable as one: the radio read
 * a different field and stayed disabled forever.
 *
 * The list and the rule now read the same field, so what an admin sees is what
 * the form acts on. */
const roleOf = (member: IMEMBER): string =>
  member?.custom_role_data?.name || member?.role_data?.name || member?.role || '';

/* Who may be the manager of a queue. Agents answer calls; they do not own the
   queue. */
const MANAGER_ROLES = ['MANAGER', 'ADMIN', 'SUB-ADMIN', 'SUPER-ADMIN'];
const canManage = (member: IMEMBER): boolean =>
  MANAGER_ROLES.includes(roleOf(member).toUpperCase());

/* How well somebody handles this queue's work, 0 to 100.
 *
 * Per queue, not per person: somebody can be the strongest on billing and the
 * weakest on support, and one number per person could not say that.
 *
 * Everybody starts at 100, so a queue that rates nobody behaves exactly as it
 * does today. That default is deliberate - starting at 0 would mean rating one
 * person silently sidelined everybody else, and the first admin to try the
 * feature would break their own queue.
 *
 * Only editable for somebody already in the queue. Rating a person you have not
 * added is a setting with nowhere to live. */
const MemberRatingCell = ({ memberData }: { memberData: IMEMBER }) => {
  const { control, setValue, getValues } = useFormContext();
  const members = useWatch({ control, name: 'members', defaultValue: [] });
  const index = Array.isArray(members)
    ? members.findIndex((m: any) => m?.value === memberData?.extension)
    : -1;

  if (index < 0) {
    return <span className="text-xs text-gray-400">&mdash;</span>;
  }

  const rating = members[index]?.rating ?? 100;

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        max={100}
        value={rating}
        className="h-9 w-20"
        onChange={(event) => {
          const raw = event.target.value;
          /* Clamped rather than refused: an admin typing 150 means "as high as
             it goes", and an error message for that would be pedantic. */
          const next = raw === '' ? 100 : Math.min(100, Math.max(0, Number(raw) || 0));
          /* Read at the moment of the edit, like every other write on this
             screen. Building from a remembered list here would drop anybody
             ticked since this input last rendered. */
          const live = getValues('members') || [];
          const at = live.findIndex((m: any) => m?.value === memberData?.extension);
          if (at < 0) return;
          const copy = [...live];
          copy[at] = { ...copy[at], rating: next };
          setValue('members', copy, { shouldValidate: false });
        }}
      />
    </div>
  );
};

// Checkbox cell component with internal form subscription and logic
/**
 * Putting somebody on this queue, or taking them off.
 *
 * Shared by the tick box and the person's name, because a 16px box is a poor
 * target for the main action on the page - and when a click misses it, nothing
 * happens and nothing explains why. Clicking the name does the same thing.
 */
const useToggleMember = (memberData: IMEMBER) => {
  const { control, setValue, clearErrors, getValues } = useFormContext();
  /* Watched only so the tick redraws. The write below never uses this value. */
  const members = useWatch({ control, name: 'members', defaultValue: [] });
  const isOn = isOnQueue(members, memberData);

  const toggle = useCallback(
    (next?: boolean) => {
      /* Read at the moment of the click, not from the render that drew this
         row. Every row closed over the list as it stood when it last rendered,
         which was the empty list - so the second person you ticked was added to
         nothing and the first disappeared. That is why only one ever stuck. */
      const current = getValues('members') || [];
      const updated = toggleMember(current, memberData, next);
      setValue('members', updated, { shouldValidate: true });
      clearErrors('members');

      /* A queue cannot be saved without somebody in charge, and asking for that
         as a second click on a column that looks dead until you tick somebody is
         what made this screen feel like hard work. The first person who *can*
         run it is put in charge as they join; picking somebody else is still one
         click, and a deliberate choice is never overruled. */
      const nextManager = chooseManager(updated, getValues('manager'));
      const currentManagerKey = memberKey(getValues('manager'));
      if (memberKey(nextManager) !== currentManagerKey) {
        setValue('manager', nextManager || { value: '' }, { shouldValidate: true });
        clearErrors('manager');
      }
    },
    [memberData, setValue, clearErrors, getValues],
  );

  return { isOn, toggle };
};

const MemberCheckboxCell = ({ memberData }: { memberData: IMEMBER }) => {
  const { isOn, toggle } = useToggleMember(memberData);

  /* The whole cell is the target, not just the box inside it - the box alone is
     16px, and a near miss did nothing and said nothing. The box is made inert
     so one click cannot be counted twice. */
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isOn}
      title={isOn ? 'Click to take them off this queue' : 'Click to put them on this queue'}
      onClick={() => toggle()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      }}
      className="-m-2 flex cursor-pointer items-center justify-center p-4 text-primary"
    >
      <Checkbox checked={isOn} className="pointer-events-none" tabIndex={-1} />
    </div>
  );
};

MemberCheckboxCell.displayName = 'MemberCheckboxCell';

// Manager radio cell component with internal form subscription and logic
const ManagerRadioCell = ({ memberData }: { memberData: IMEMBER }) => {
  const { control, setValue, clearErrors } = useFormContext();
  const members = useWatch({ control, name: 'members', defaultValue: [] });

  const manager = useWatch({ control, name: 'manager', defaultValue: { value: '' } });
  const isTicked =
    Array.isArray(members) && members.some((item: any) => item?.value === memberData?.extension);
  const isEnabled = isTicked && canManage(memberData);
  const handleManagerChange = useCallback(() => {
    if (!canManage(memberData)) return;
    const managerVal = {
      value: memberData?.extension ? memberData?.extension : memberData?.value,
      extension: memberData?.extension,
      skills: memberData?.skills,
      label: memberData?.last_name
        ? `${memberData?.first_name} ${memberData?.last_name}`
        : `${memberData?.label}`,
      name: memberData?.last_name
        ? `${memberData?.first_name} ${memberData?.last_name}`
        : memberData?.label,
      email: memberData?.email,
      role: memberData?.custom_role_data?.name || memberData?.role_data?.name || memberData?.role,
      user_uuid: memberData?.uuid,
    };
    setValue('manager', managerVal);
    clearErrors('manager');
  }, [memberData, setValue, clearErrors]);

  return (
    <div className="flex ">
      <RadioGroup value={manager?.value} onValueChange={handleManagerChange}>
        <div className="flex w-full">
          <RadioGroupItem disabled={!isEnabled} value={memberData?.extension} id="yes" />
        </div>
      </RadioGroup>
    </div>
  );
};

ManagerRadioCell.displayName = 'ManagerRadioCell';

// Memoized name cell component
const MemberNameCell = memo(({ data }: { data: IMEMBER }) => {
  const fullName = `${data?.first_name}${data?.last_name ? ` ${data?.last_name}` : ''}`;
  /* Clicking the person is the obvious way to put them on the queue, and it is
     the biggest thing in the row. The tick box still works; this just stops a
     near miss doing nothing at all. */
  const { isOn, toggle } = useToggleMember(data);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isOn}
      title={isOn ? 'Click to take them off this queue' : 'Click to put them on this queue'}
      onClick={() => toggle()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      }}
      className={`flex w-2xs cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-gray-50 ${
        isOn ? 'bg-primary/5' : ''
      }`}
    >
      <div className="flex ">
        <CustomAvatar
          name={fullName}
          showPresence
          extension={data?.extension}
          image={data?.profile}
        />
      </div>
      <div className="flex flex-col w-full">
        <div className="flex items-center justify-between  gap-2">
          <div className="flex flex-col items-start ">
            <p className="capitalize">{fullName}</p>
            <small className="text-primary text-[10px]">
              {data?.custom_role_data?.name || data?.role_data?.name || data?.role}
            </small>
          </div>
          <div className="flex items-center gap-1 text-gray-500">
            <Icon name="Grid" className="w-4 h-4 " />
            <div>{data?.extension}</div>
          </div>
        </div>
        <p className="text-gray-500 flex justify-between">
          <div>{data?.email}</div>
        </p>
      </div>
    </div>
  );
});

MemberNameCell.displayName = 'MemberNameCell';

const SelectAllHeader = ({ currentMembers }: { currentMembers: IMEMBER[] }) => {
  const { control, setValue, clearErrors, getValues } = useFormContext();
  const members = useWatch({ control, name: 'members', defaultValue: [] });

  const isAllChecked = useMemo(() => {
    if (!currentMembers || currentMembers.length === 0) return false;
    return currentMembers.every((member) => members.some((m: any) => m.value === member.extension));
  }, [currentMembers, members]);

  const isIndeterminate = useMemo(() => {
    if (!currentMembers || currentMembers.length === 0) return false;
    const checkedCount = currentMembers.filter((member) =>
      members.some((m: any) => m.value === member.extension),
    ).length;
    return checkedCount > 0 && checkedCount < currentMembers.length;
  }, [currentMembers, members]);

  const handleSelectAllChange = useCallback(
    (checked: boolean) => {
      /* Read at the moment of the click, for the same reason each row does:
         building from a remembered list is what made this screen hold one
         person. Every visible person is folded in one at a time, so the result
         is the same whether you tick them individually or all at once. */
      let updated = getValues('members') || [];
      currentMembers.forEach((person) => {
        updated = toggleMember(updated, person, checked);
      });
      setValue('members', updated, { shouldValidate: true });
      clearErrors('members');

      /* Same rule as a single tick: keep a deliberate choice, promote somebody
         eligible if the old manager has just been taken off, and say plainly
         that nobody can run it when that is the truth. */
      const nextManager = chooseManager(updated, getValues('manager'));
      if (memberKey(nextManager) !== memberKey(getValues('manager'))) {
        setValue('manager', nextManager || { value: '' }, { shouldValidate: true });
        clearErrors('manager');
      }
    },
    [currentMembers, setValue, clearErrors, getValues],
  );

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs font-semibold text-gray-500"></span>
      <div className="flex justify-center text-primary">
        <Checkbox
          checked={isAllChecked ? true : isIndeterminate ? 'indeterminate' : false}
          onCheckedChange={handleSelectAllChange}
        />
      </div>
    </div>
  );
};

/**
 * Who is on the queue, right now, above the list you pick from.
 *
 * Ticking a row changed a box halfway down a scrolling table and nothing else,
 * so there was no answer to "did that work, and who have I got?". This is that
 * answer: the manager first, then everybody else, each removable without
 * hunting for their row again.
 */
const ChosenStrip = () => {
  const { control, setValue, clearErrors, getValues } = useFormContext();
  const members = useWatch({ control, name: 'members', defaultValue: [] });
  const manager = useWatch({ control, name: 'manager', defaultValue: { value: '' } });

  const list: any[] = Array.isArray(members) ? members : [];
  const managerKey = memberKey(manager);
  const ordered = [
    ...list.filter((m) => memberKey(m) === managerKey),
    ...list.filter((m) => memberKey(m) !== managerKey),
  ];

  const remove = (person: any) => {
    const updated = toggleMember(getValues('members') || [], person, false);
    setValue('members', updated, { shouldValidate: true });
    const nextManager = chooseManager(updated, getValues('manager'));
    if (memberKey(nextManager) !== memberKey(getValues('manager'))) {
      setValue('manager', nextManager || { value: '' }, { shouldValidate: true });
      clearErrors('manager');
    }
  };

  if (list.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-sm text-gray-600">
        Nobody on this queue yet. Click a person below to add them.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
      <p className="mb-2 text-sm font-semibold text-gray-900">
        {list.length} {list.length === 1 ? 'person is' : 'people are'} on this queue
        {managerKey ? '' : ' - nobody can run it yet'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {ordered.map((m) => {
          const isManager = memberKey(m) === managerKey;
          return (
            <span
              key={memberKey(m)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                isManager
                  ? 'border-primary/30 bg-primary/10 font-semibold text-primary'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              {m?.name || m?.label}
              <span className="text-gray-400">{m?.extension}</span>
              {isManager ? <span className="text-[10px] uppercase">runs it</span> : null}
              <button
                type="button"
                aria-label={`Take ${m?.name || m?.label} off this queue`}
                title="Take them off this queue"
                onClick={() => remove(m)}
                className="ml-0.5 rounded-full px-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
              >
                &times;
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
};

const AddMembers: FC = () => {
  const {
    watch,
    formState: { errors },
  } = useFormContext();

  const selectedSite = watch('site_uuid')?.value;
  /* How many are actually on the queue, not how many rows are listed. Read from
     the form rather than the table so it counts people the search has hidden. */
  const selectedCount = (watch('members') || []).length;
  const [searchKey, setSearchKey] = useState('');
  const debouncedSearchKey = useDebounce(searchKey, 500);
  const [currentMembers, setCurrentMembers] = useState<IMEMBER[]>([]);

  const handleSuccess = useCallback((tbldata: any) => {
    const rows = tbldata?.data?.data?.result?.rows || [];
    setCurrentMembers(rows);
  }, []);

  const columns: ColumnDef<IMEMBER>[] = useMemo(
    () => [
      {
        header: () => <SelectAllHeader currentMembers={currentMembers} />,
        id: 'action',
        accessorKey: 'company_uuid',
        cell: ({ row }) => <MemberCheckboxCell memberData={row?.original} />,
      },
      {
        /* The radio is deliberately dead until somebody is ticked - you cannot
           put a person in charge of a queue they are not on. That rule was
           invisible, so a whole column of greyed circles read as "this page is
           broken". */
        header: () => (
          <span className="flex flex-col leading-tight">
            <span>Manager</span>
            <span className="text-[10px] font-normal normal-case text-gray-500">
              {selectedCount === 0 ? 'chosen for you' : 'click to change'}
            </span>
          </span>
        ),
        accessorKey: 'status',
        cell: ({ row }) => <ManagerRadioCell memberData={row?.original} />,
      },
      {
        header: 'Name',
        accessorKey: 'first_name',
        cell: ({ row }: any) => <MemberNameCell data={row?.original} />,
      },
      {
        /* Saved on the member and read by nothing - not by the switch, not by
           the lookup service, and not used to decide who rings first. Said on
           the column rather than left for somebody to set carefully and wonder
           why it never changed anything. */
        header: () => (
          <span className="flex items-center gap-1.5">
            Rating
            <SettingFlag status="coming-soon" />
          </span>
        ),
        id: 'rating',
        accessorKey: 'rating',
        cell: ({ row }: any) => <MemberRatingCell memberData={row?.original} />,
      },
    ],
    [currentMembers],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <SettingCard
        title="Who this queue rings"
        description="Tick somebody to put them on this queue, untick to take them off - that is all there is to it, there is nothing separate to save or delete. Only people at the location chosen on Basic info are listed."
        note="Whoever runs the queue is chosen for you as soon as somebody eligible joins. Click a different Manager circle to change it."
        aside={
          <div className="relative w-full min-w-[15rem] max-w-sm">
            <Input
              type="text"
              placeholder="Search by name, email or extension"
              IconPosition="left-0 pl-2 inset-y-0"
              value={searchKey}
              Icon={<SearchLine className="text-gray-700" />}
              onChange={(e) => {
                const value = e.target.value;
                if (value.startsWith(' ')) return;
                setSearchKey(e.target.value);
              }}
              className="w-full pl-10"
            />
          </div>
        }
      >
        {/* Errors sit inside the card rather than floating above the tab, so it is
            obvious which thing is complaining. */}
        {(errors?.members || errors?.manager) && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            {errors?.members ? (
              <p className="text-xs text-red-700">{(errors?.members as any)?.message}</p>
            ) : null}
            {errors?.manager ? (
              <p className="text-xs text-red-700">{(errors?.manager as any)?.value?.message}</p>
            ) : null}
          </div>
        )}

        <div className="flex flex-col gap-3 py-3">
          <ChosenStrip />

          <TableManager
            {...{
              emptyTablePlaceholder: 'Nobody at this location',
              descriptionEmptyTable:
                'Only people at the location chosen on Basic info are listed. Change the location, or add people first.',
              columns,
              fetcherKey: 'forwardActionType',
              fetcherFn: forwardActionType,
              onSuccess: handleSuccess,
              extraParams: {
                site_uuid: selectedSite,
                type: 'EXTENSION',
                search: debouncedSearchKey,
              },
              customClass: 'min-h-[18rem]',
            }}
          />
        </div>
      </SettingCard>
    </div>
  );
};

export default AddMembers;
