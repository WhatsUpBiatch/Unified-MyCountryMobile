/* "How calls reach you" — the panel the Profile page's own subtitle promised.
 *
 * The page had grown into a name, a job title and a photo, which told somebody
 * what colleagues see but nothing about the thing they actually came to check:
 * which number rings them, and what happens when they miss it.
 *
 * Everything here is what is true on the switch today, and nothing else.
 *
 *   - Extension: read by the switch. Live.
 *   - Direct number: the numbers actually assigned to this person, from the
 *     same list the dialler's caller-ID picker uses. This used to show the
 *     sign-up mobile number (`user_info.phone`) under the words "outside
 *     callers reach you on this number", which is not what that number is.
 *   - Voicemail: live for a call dialled straight to the person, since the
 *     switch patch of 3 Sep 2026. An unanswered direct call goes to their
 *     voicemail unless their after-ring rule says otherwise, and their own
 *     voicemail greeting plays before the caller records. Proven by offline
 *     tests and by reading the running switch, not yet by a real call. It
 *     wore "Coming soon" before that; the badge moved in the same change.
 *     Missed-call email alerts are still not sent, so the line says so.
 *   - The timezone line is gone: the person's own hours are now read, but
 *     the hours editor on Preferences already shows the timezone with them.
 *
 * A number that is not set says so, because "—" against Direct number is the
 * answer to "why do outside callers never reach me".
 */

import { Building2, Clock, Hash, PhoneIncoming } from 'lucide-react';
import { useGetAssignedDIDNumbers } from '@/hooks/common';
import { LiveFlag } from '../not-applied-note';

interface HowCallsReachYouProps {
  /** The `user_info` object: extension, site_detail. */
  userInfo?: any;
}

const Fact = ({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  hint: string;
}) => (
  <div className="rounded-lg border border-gray-200 bg-white p-3">
    <div className="flex items-center gap-2">
      <span className="text-primary">{icon}</span>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
    </div>
    <p className="mt-1 text-sm font-semibold text-gray-900">{value?.trim() ? value : '—'}</p>
    <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
  </div>
);

const withPlus = (number: string) => (number.startsWith('+') ? number : `+${number}`);

const HowCallsReachYou = ({ userInfo }: HowCallsReachYouProps) => {
  const site = userInfo?.site_detail || {};

  /* No uuid: the hook then asks for the signed-in person's own numbers, which
     is the same call the dialler makes for its caller-ID list. Read-only here. */
  const { data: assignedNumbers, isPending, isError } = useGetAssignedDIDNumbers();

  const numbers = ((assignedNumbers as any[]) || [])
    .map((row: any) => String(row?.did_number || '').trim())
    .filter(Boolean)
    .map(withPlus);

  /* Three states, and none of them shows a bare "—" for "we do not know yet":
     still loading, could not load, and genuinely none. */
  const directNumber = isPending
    ? 'Checking…'
    : isError
      ? ''
      : numbers.slice(0, 2).join(', ') + (numbers.length > 2 ? ` and ${numbers.length - 2} more` : '');

  const directHint = isPending
    ? 'Looking up the numbers assigned to you.'
    : isError
      ? 'Could not load your numbers just now. Try again in a moment.'
      : numbers.length
        ? 'Outside callers reach you on this number.'
        : 'No number is assigned to you, so outside callers cannot dial you straight.';

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <p className="text-sm font-semibold text-gray-900">How calls reach you</p>
      <p className="mt-0.5 text-xs text-gray-600">
        Where a call comes in, and what happens if you do not pick it up.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Fact
          icon={<Hash className="h-4 w-4" />}
          label="Extension"
          value={userInfo?.extension ? String(userInfo.extension) : ''}
          hint="Colleagues dial this from inside the company."
        />
        <Fact
          icon={<PhoneIncoming className="h-4 w-4" />}
          label="Direct number"
          value={directNumber}
          hint={directHint}
        />
        <Fact
          icon={<Building2 className="h-4 w-4" />}
          label="Location"
          value={site?.name}
          hint="Set by an administrator under People."
        />
      </div>

      {/* What happens to a missed call is the part people are unsure about.
          For a call straight to the person, voicemail is live; the two limits
          (queue and menu calls, and the missing email alert) are said here
          rather than left for somebody to find out. */}
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold text-gray-900">
            Voicemail
            <LiveFlag>Active</LiveFlag>
          </p>
          <p className="text-xs text-gray-700">
            A call straight to you that you do not answer goes to your voicemail, unless you chose
            something else under My Phone. Your own voicemail greeting plays first. Calls through a
            queue or a menu follow that queue&rsquo;s or menu&rsquo;s own rules. Email alerts for a
            missed call are not sent yet.
          </p>
        </div>
      </div>
    </div>
  );
};

export default HowCallsReachYou;
