/* The panel that opens when an admin clicks a location.
 *
 * It used to print nine stored fields as label/value pairs, which told an admin
 * what had been typed in but nothing about whether the location worked. established systems
 * and other established systems both answer a different question first — is this location ready,
 * who is in it, and what does it govern — and only then show the address.
 *
 * Caller ID is spelled out rather than shown as a code — `caller_id_type` is
 * stored as MAIN / CUSTOM / BLANK — and labelled as not yet applied, because
 * nothing in the call path reads it. The number a person shows when calling out
 * comes from their own record.
 */

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Hash,
  MapPin,
  PhoneOutgoing,
  Users,
} from 'lucide-react';
import { useSiteHeadcount } from '@/hooks/use-site-headcount';
import { useLocationNumbers } from '@/hooks/use-location-numbers';
import { evaluateLocation, PLATFORM_LOCATION_GAPS } from '@/lib/location-readiness';

/* Recorded against the location, but not yet read by anything that places a
   call. Describing the intended behaviour as though it happened would be the
   more comfortable copy and the wrong one. */
const CALLER_ID_EXPLAINED: Record<string, { title: string; detail: string }> = {
  MAIN: { title: 'Company main number', detail: 'Recorded as this location\u2019s preference.' },
  CUSTOM: { title: 'Custom name', detail: 'Recorded as this location\u2019s preference.' },
  BLANK: { title: 'Withheld', detail: 'Recorded as this location\u2019s preference.' },
};

const CALLER_ID_NOT_LIVE =
  'Applied to outbound calls from everyone at this location since 3 September 2026: a custom name replaces the name shown, the company main number replaces the number shown, and withheld asks the carrier to hide it.';

const Row = ({ label, value }: { label: string; value?: string }) => (
  <div className="flex items-start justify-between gap-3 py-1.5">
    <span className="text-sm text-gray-500 shrink-0">{label}</span>
    <span className="text-sm font-medium text-gray-900 text-right break-words">
      {value?.trim() ? value : '—'}
    </span>
  </div>
);

const CompanyDetails = ({ data = {} }: any) => {
  const {
    uuid = '',
    name = '',
    address = '',
    city = '',
    state = '',
    country = '',
    postal_code = '',
    caller_id_name = '',
    caller_id_type = '',
    timezone = '',
    is_default = '',
  } = data;

  const isMainLocation = is_default === '1';
  const readiness = useMemo(() => evaluateLocation(data), [data]);
  const { counts, isLoading: isHeadcountLoading } = useSiteHeadcount(uuid ? [uuid] : []);
  const headcount = counts[uuid];
  const { bySite, isLoading: isNumbersLoading } = useLocationNumbers();
  const numbers = bySite[uuid] || [];

  const callerId = CALLER_ID_EXPLAINED[caller_id_type] || {
    title: 'Not set',
    detail: 'No caller ID rule has been chosen for this location.',
  };

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto pt-2 pr-1">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="text-md font-semibold text-gray-900">{name || 'Location'}</h5>
        {isMainLocation && (
          <span className="rounded-sm bg-ucass-primary-200 px-2 py-0.5 text-xs font-semibold text-primary">
            Main location
          </span>
        )}
      </div>

      {/* Whether this location is usable comes before what is stored in it. */}
      {readiness.isComplete ? (
        <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          <p className="text-xs text-gray-700">
            Everything this platform stores for a location is filled in.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs font-semibold text-gray-900">
              {readiness.requiredMissing > 0
                ? `${readiness.requiredMissing} thing${readiness.requiredMissing > 1 ? 's' : ''} still needed`
                : 'Worth completing'}
            </p>
          </div>
          <ul className="mt-2 space-y-2">
            {readiness.issues.map((issue) => (
              <li key={issue.field} className="text-xs text-gray-700">
                <span className="font-semibold text-gray-900">{issue.label}</span>
                {issue.severity === 'recommended' && (
                  <span className="ml-1 text-gray-500">(optional)</span>
                )}
                <span className="block text-gray-600">{issue.consequence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 p-3">
        <div className="mb-1 flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h6 className="text-sm font-semibold text-gray-900">People here</h6>
        </div>
        <p className="text-sm text-gray-700">
          {isHeadcountLoading
            ? 'Counting…'
            : headcount === undefined
              ? 'Could not be counted right now.'
              : headcount === 0
                ? 'Nobody is assigned to this location yet.'
                : `${headcount} ${headcount === 1 ? 'person works' : 'people work'} here.`}
        </p>
        {headcount === 0 && !isHeadcountLoading && (
          <p className="mt-1 text-xs text-gray-500">
            Assign people to a location under Users, so their hours and caller ID follow the right
            branch.
          </p>
        )}
      </div>

      {/* Which numbers ring here. The link has always been stored on the number
          record; it had simply never been surfaced against the location. */}
      <div className="rounded-xl border border-gray-200 p-3">
        <div className="mb-1 flex items-center gap-2">
          <Hash className="h-4 w-4 text-primary" />
          <h6 className="text-sm font-semibold text-gray-900">Numbers here</h6>
        </div>
        {isNumbersLoading ? (
          <p className="text-sm text-gray-700">Loading…</p>
        ) : numbers.length === 0 ? (
          <p className="text-sm text-gray-700">
            No numbers are attached to this location.
            <span className="mt-1 block text-xs text-gray-500">
              Numbers are assigned to a location under Numbers.
            </span>
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {numbers.map((entry) => (
              <li
                key={entry.uuid || entry.number}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="text-sm font-medium text-gray-900">{entry.number}</span>
                <span className="text-xs text-gray-500 text-right">
                  {entry.assignedTo || (entry.type ? entry.type : 'Unassigned')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 p-3">
        <div className="mb-1 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <h6 className="text-sm font-semibold text-gray-900">Address</h6>
        </div>
        <div className="divide-y divide-gray-100">
          <Row label="Street" value={address} />
          <Row label="City" value={city} />
          <Row label="State / region" value={state} />
          <Row label="Country" value={country} />
          <Row label="Postal code" value={postal_code} />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 p-3">
        <div className="mb-1 flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h6 className="text-sm font-semibold text-gray-900">Timezone</h6>
        </div>
        <p className="text-sm font-medium text-gray-900">{timezone || '—'}</p>
        <p className="mt-1 text-xs text-gray-500">
          Opening and closing times for people here are read on this clock.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 p-3">
        <div className="mb-1 flex items-center gap-2">
          <PhoneOutgoing className="h-4 w-4 text-primary" />
          <h6 className="text-sm font-semibold text-gray-900">Outbound caller ID</h6>
        </div>
        <p className="text-sm font-medium text-gray-900">{callerId.title}</p>
        <p className="mt-1 text-xs text-gray-600">{callerId.detail}</p>
        {caller_id_type === 'CUSTOM' && (
          <p className="mt-2 text-sm text-gray-900">
            <span className="text-gray-500">Name: </span>
            {caller_id_name?.trim() || '— none entered —'}
          </p>
        )}
        <p className="mt-2 text-xs text-gray-500">{CALLER_ID_NOT_LIVE}</p>
      </div>

      {/* Named plainly so an admin comparing this against another system knows the
          setting is absent from the product, not hidden somewhere they missed. */}
      <div className="rounded-xl border border-dashed border-gray-300 p-3">
        <h6 className="text-sm font-semibold text-gray-900">Not available yet</h6>
        <p className="mt-1 text-xs text-gray-600">
          Other platforms hold these against a location. This one does not store them yet.
        </p>
        <ul className="mt-2 space-y-1.5">
          {PLATFORM_LOCATION_GAPS.map((gap) => (
            <li key={gap.label} className="text-xs text-gray-700">
              <span className="font-semibold text-gray-900">{gap.label}</span>
              <span className="block text-gray-500">{gap.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default CompanyDetails;
