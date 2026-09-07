import CustomTooltip from '@/components/custom/custom-tooltip';
import NumberWithFlag from '@/components/custom/number-with-flag';
import TableManager from '@/components/custom/table-manager';
import { getVerificationList } from '@/services/api';

/* Numbers waiting on a regulator.
 *
 * Buying a number in most countries registers an identity and a service address
 * against it, and the carrier then has to approve that registration before the
 * number will carry calls. This is the queue of those: which number, where, how
 * far along, and how long is left to supply anything missing.
 *
 * Three of the four columns were wrong rather than unstyled, and no amount of
 * restyling would have shown it — every row was empty, so every cell looked
 * equally plausible:
 *
 *   "DID Number" read `row.address.country` and `row.address.state`, copied
 *   from the Addresses table next door, and printed "/" on every line.
 *
 *   "Status" printed `awaiting_registration` — a boolean — straight into the
 *   cell, so it read "true", "false" or nothing.
 *
 *   "Time Left" printed `expires_at`, a timestamp, under a heading promising a
 *   duration.
 *
 * The row actions were not wired either: Delete's mutation had no `mutationFn`
 * and its confirm handler returned before calling it, so the dialog asked, was
 * confirmed, and did nothing. View set a row into state that nothing renders.
 * Both are gone rather than left looking available — an action that quietly
 * does nothing is worse than one that is not offered.
 */

/** What the carrier has said so far. Approved and rejected are final. */
const STATUS_TONE: Record<string, string> = {
  approved: 'is-ok',
  rejected: 'is-bad',
  pending: 'is-wait',
};

const STATUS_LABEL: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  pending: 'Awaiting registration',
};

/** A verification's state, from either the explicit status or the flag. */
const statusOf = (row: any): string => {
  const named = String(row?.status ?? '').toLowerCase();
  if (STATUS_LABEL[named]) return named;
  return row?.awaiting_registration ? 'pending' : 'approved';
};

/**
 * How long is left, in whole days.
 *
 * Returns null when there is no date and a negative count when the date has
 * passed, so the cell can tell "no deadline" from "overdue" rather than
 * printing a minus sign at somebody.
 */
const daysLeft = (raw: unknown): number | null => {
  if (!raw) return null;
  const when = new Date(String(raw));
  if (Number.isNaN(when.getTime())) return null;
  return Math.ceil((when.getTime() - Date.now()) / 86_400_000);
};

const Verification = ({ search }: { search: string }) => {
  const columns = [
    {
      header: 'Number',
      accessorKey: 'did_number',
      cell: ({ row }: any) => <NumberWithFlag number={row?.original?.did_number} />,
    },
    {
      header: 'Registered for',
      accessorKey: 'country',
      cell: ({ row }: any) => {
        const { country, city } = row?.original || {};
        return (
          <span className="mcm-ident-place">
            <b>{country || 'Unknown country'}</b>
            {city ? <span>{city}</span> : null}
          </span>
        );
      },
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: ({ row }: any) => {
        const state = statusOf(row?.original);
        return <span className={`mcm-vstat ${STATUS_TONE[state]}`}>{STATUS_LABEL[state]}</span>;
      },
    },
    {
      header: 'Time left',
      accessorKey: 'expires_at',
      cell: ({ row }: any) => {
        const state = statusOf(row?.original);
        /* Only a registration still being decided has a deadline. An approved
           or rejected one has nothing left to count down to, and the date it
           carries is when it was settled. */
        if (state !== 'pending') return <span className="mcm-numnone">&mdash;</span>;

        const left = daysLeft(row?.original?.expires_at);
        if (left === null) return <span className="mcm-numnone">No deadline</span>;
        if (left < 0) {
          return (
            <CustomTooltip text="The carrier may suspend the number until this is registered">
              <span className="mcm-vstat is-bad">Overdue</span>
            </CustomTooltip>
          );
        }
        return (
          <span className={left <= 7 ? 'mcm-vleft is-soon' : 'mcm-vleft'}>
            {left === 0 ? 'Today' : `${left} day${left === 1 ? '' : 's'}`}
          </span>
        );
      },
    },
  ];

  return (
    <div className="mcm-ident-tab">
      <TableManager
        {...{
          columns,
          search,
          fetcherKey: 'getVerificationList',
          fetcherFn: getVerificationList,
          emptyTablePlaceholder: 'Nothing awaiting registration',
          descriptionEmptyTable:
            'Numbers in countries that require a registered identity appear here while the carrier reviews them.',
        }}
      />
    </div>
  );
};

export default Verification;
