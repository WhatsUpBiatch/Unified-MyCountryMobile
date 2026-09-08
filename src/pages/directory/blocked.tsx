import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { getContactList, updateContactTag } from '@/services/api';
import CustomAvatar from '@/components/custom/custom-avatar';
import { Ic } from '@/components/mcm/icons';
import { SettingCard, SettingRow } from '@/components/mcm/setting-card';
import {
  DEFAULT_BLOCK_CHOICE,
  SCOPE_LABELS,
  TREATMENT_DESCRIPTIONS,
  TREATMENT_LABELS,
  type BlockChoice,
  type BlockLine,
  type BlockScope,
  type BlockTreatment,
  type BlockableContact,
  canBlock,
  contactName,
  describeChoice,
  planBlock,
  tagRequest,
} from '@/lib/contact-blocking';
import { DirectoryPage, EmptyRow, SearchChip } from './page-shell';
import { Picker } from '@/components/mcm/picker';

/**
 * Directory ▸ Blocked — the numbers you have stopped hearing from.
 *
 * Blocking is spread across the app today: a menu on a row of the contacts
 * table marks somebody as Blocked, and after that the block is invisible.
 * Nothing lists what is blocked, so nobody can check whether a caller they are
 * no longer hearing from was blocked on purpose or is simply not calling.
 *
 * This is that list, plus the one thing the row menu cannot do — block a number
 * you are looking at rather than a contact you have already opened.
 *
 * The important honesty, and the reason the card at the top says so plainly:
 * marking a contact as blocked records the decision and nothing more. Nothing
 * in the call path reads it yet, so a blocked number can still ring through.
 * The screen is still worth having — the decision has to be recorded somewhere
 * before anything can act on it, and until then people deserve to know.
 */

const Blocked = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [number, setNumber] = useState('');
  const [scope, setScope] = useState<BlockScope>(DEFAULT_BLOCK_CHOICE.scope);
  const [treatment, setTreatment] = useState<BlockTreatment>(DEFAULT_BLOCK_CHOICE.treatment);
  const [line, setLine] = useState<BlockLine>(DEFAULT_BLOCK_CHOICE.line);

  /* Two reads of the same list. The blocked one is filtered on the server, which
     is what the table shows; the whole book is what a typed number is matched
     against, because the number you want to block is usually already saved. */
  const { data: blocked = [], isPending } = useQuery({
    queryKey: ['getContactList', 'directoryBlocked'],
    queryFn: () =>
      getContactList({ page: 1, limit: 200, filters: [{ key: 'tag', value: 'BLOCK' }] }),
    select: (res: any) => (res?.data?.data?.result?.rows || []) as BlockableContact[],
  });

  const { data: everyone = [] } = useQuery({
    queryKey: ['getContactList', 'directoryBlockedLookup'],
    queryFn: () => getContactList({ page: 1, limit: 200 }),
    select: (res: any) => (res?.data?.data?.result?.rows || []) as BlockableContact[],
  });

  const { mutate: setTag, isPending: isSaving } = useMutation({
    mutationFn: updateContactTag,
    onSuccess: () => {
      /* Every contact list in the app shares this prefix, so unblocking here
         also corrects the tag shown on the contacts table and the directory. */
      queryClient.invalidateQueries({ queryKey: ['getContactList'] });
      queryClient.invalidateQueries({ queryKey: ['newContactListQuery'] });
    },
    onError: (error: any) =>
      toast.error(error?.response?.data?.message || 'That did not save. Try again.'),
  });

  const choice: BlockChoice = { number, scope, treatment, line };
  const plan = useMemo(() => planBlock(choice, everyone), [number, scope, treatment, line, everyone]);
  const typed = number.trim().length > 0;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return blocked;
    return blocked.filter((row) =>
      [contactName(row), row?.contact?.phone, row?.contact?.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [blocked, search]);

  const block = () => {
    if (!canBlock(plan)) return;
    setTag(tagRequest(plan.targets, 'BLOCK'), {
      onSuccess: () => {
        toast.success(`${plan.targets.length === 1 ? 'That number is' : 'Those numbers are'} blocked.`);
        setNumber('');
      },
    });
  };

  const unblock = (contact: BlockableContact) =>
    setTag(tagRequest([contact], 'STANDARD'), {
      onSuccess: () => toast.success(`${contactName(contact) || 'That number'} is unblocked.`),
    });

  return (
    <DirectoryPage
      title="Blocked Numbers"
      description="Everyone you have stopped hearing from, and one place to block someone new."
      filters={
        <>
          <SearchChip value={search} onChange={setSearch} placeholder="Search blocked numbers" />
          <span className="fchip live" style={{ marginLeft: 'auto' }}>
            <span className="num">{blocked.length}</span> blocked
          </span>
        </>
      }
    >
      <div style={{ padding: 14 }}>
        <SettingCard
          title="Block a number"
          description="Blocking covers calls, faxes and messages from that number."
          icon={<Ic n="shield" size={16} />}
          status="coming-soon"
          note={
            <>
              Coming soon. A block is recorded against the contact and that is as far as it
              goes today: nothing in the call path reads it yet, so a blocked number can
              still ring through. Only the fact of the block is kept — not which channels it
              covers, not what the caller hears instead, and not whether it applies to a
              shared line. Those choices are shown here because they are the decision people
              actually make, and they are what we need to be able to keep.
            </>
          }
        >
          <SettingRow
            label="Number"
            description="The number you want to stop hearing from. It has to be saved as a contact first."
            control={
              <input
                className="mcm-field"
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                placeholder="+44 20 7946 0000"
                inputMode="tel"
                aria-label="Number to block"
              />
            }
          />

          <SettingRow
            label="What to stop"
            description="Blocking calls blocks faxes too — they arrive over the same line."
            control={
              <Picker
                label="What to stop"
                showLabel={false}
                className="mcm-field"
                value={scope}
                options={(Object.keys(SCOPE_LABELS) as BlockScope[]).map((key) => ({
                  label: SCOPE_LABELS[key],
                  value: key,
                }))}
                onChange={(option) => setScope(option.value as BlockScope)}
              />
            }
            status={scope === DEFAULT_BLOCK_CHOICE.scope ? undefined : 'coming-soon'}
          />

          <SettingRow
            label="What the caller gets"
            description={TREATMENT_DESCRIPTIONS[treatment]}
            control={
              <Picker
                label="What the caller gets"
                showLabel={false}
                className="mcm-field"
                value={treatment}
                options={(Object.keys(TREATMENT_LABELS) as BlockTreatment[]).map((key) => ({
                  label: TREATMENT_LABELS[key],
                  value: key,
                }))}
                onChange={(option) => setTreatment(option.value as BlockTreatment)}
              />
            }
            status={treatment === DEFAULT_BLOCK_CHOICE.treatment ? undefined : 'coming-soon'}
          />

          <SettingRow
            label="Whose line"
            description="A block on your own line stops that caller reaching you. A shared line has to be blocked for everyone who answers it."
            control={
              <Picker
                label="Whose line"
                showLabel={false}
                className="mcm-field"
                value={line}
                options={[
                  { label: 'My line', value: 'personal' },
                  { label: 'A shared line', value: 'shared' },
                ]}
                onChange={(option) => setLine(option.value as BlockLine)}
              />
            }
            status={line === DEFAULT_BLOCK_CHOICE.line ? undefined : 'coming-soon'}
          />

          {typed ? (
            <div className="mcm-setrow mcm-setrow-stack">
              <div className="mcm-setrow-full">
                <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 8px' }}>
                  {describeChoice(choice)}
                </p>

                {plan.problems.map((problem) => (
                  <p
                    key={problem.message}
                    style={{
                      fontSize: 12,
                      margin: '0 0 6px',
                      color: problem.blocking ? 'var(--crit)' : 'var(--ink-3)',
                    }}
                  >
                    {problem.message}
                  </p>
                ))}

                {plan.notStored.length ? (
                  <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: '0 0 8px' }}>
                    Recorded on this screen but not saved with the contact:{' '}
                    {plan.notStored.join(', ')}.
                  </p>
                ) : null}

                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!canBlock(plan) || isSaving}
                    onClick={block}
                  >
                    <Ic n="shield" />
                    Block this number
                  </button>
                  {plan.needsContact ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() =>
                        navigate(
                          `/contact-activity?contactId=add&number=${encodeURIComponent(number.trim())}`,
                        )
                      }
                    >
                      <Ic n="plus" />
                      Save as a contact
                    </button>
                  ) : null}
                </span>
              </div>
            </div>
          ) : null}
        </SettingCard>
      </div>

      <table>
        <thead>
          <tr>
            <th>Contact</th>
            <th>Number</th>
            <th>Email</th>
            <th>Blocked</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {isPending ? (
            <EmptyRow span={5} message="Loading blocked numbers…" />
          ) : visible.length ? (
            visible.map((row) => {
              const name = contactName(row) || 'Unknown';
              return (
                <tr key={row?._id || row?.contact?.phone}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <CustomAvatar name={name} type="contact" size="30" />
                      <span style={{ fontWeight: 700 }}>{name}</span>
                    </span>
                  </td>
                  <td className="num">{row?.contact?.phone || '—'}</td>
                  <td>{row?.contact?.email || <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                  <td>
                    <span className="tag neg">Blocked</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="mini"
                      disabled={isSaving}
                      title={`Unblock ${name}`}
                      aria-label={`Unblock ${name}`}
                      onClick={() => unblock(row)}
                    >
                      <Ic n="check" size={12} />
                      Unblock
                    </button>
                  </td>
                </tr>
              );
            })
          ) : (
            <EmptyRow
              span={5}
              message={
                blocked.length
                  ? 'No blocked numbers match that search.'
                  : 'Nobody is blocked. Numbers you block will be listed here.'
              }
            />
          )}
        </tbody>
      </table>
    </DirectoryPage>
  );
};

export default Blocked;
