/* Says why things have stopped working, before somebody has to guess.
 *
 * Seven screens already check whether the plan has expired, and each one quietly
 * disables its buttons. Nothing anywhere says why. So an admin finds they cannot
 * add a person, cannot buy a number, cannot change a queue — and the product
 * offers no explanation at all. The most likely reading is that it is broken.
 *
 * Established phone systems treat this as two distinct states and say so plainly:
 * on hold, where a payment failed but calls still work, and suspended, where they
 * do not. The difference matters enormously to somebody deciding how urgently to
 * act, and it is the first thing they need to know.
 *
 * Shown wherever the admin console is, not only on the billing page — the person
 * who needs this is on the screen where something just refused to work, and
 * telling them only in Billing means telling them only if they go looking.
 */


import { useUser } from '@/hooks/use-user';

import './mcm-page.css';

type AccountTrouble = {
  tone: 'warn' | 'stop';
  title: string;
  detail: string;
  action: string;
};

/* Read from the company's plan status. Only states that actually stop somebody
   doing their job appear here — a plan due for renewal next month is not a
   problem, and a banner for it would teach people to ignore banners. */
const TROUBLE_BY_STATUS: Record<string, AccountTrouble> = {
  EXPIRED: {
    tone: 'stop',
    title: 'Your plan has expired',
    detail:
      'Calls still work, but you cannot add people, buy numbers or change how calls are handled until it is renewed.',
    action: 'Renew the plan',
  },
  SUSPENDED: {
    tone: 'stop',
    title: 'Your account is suspended',
    detail:
      'Your lines are no longer taking calls. Check the card on file, then renew to have service restored.',
    action: 'Fix payment',
  },
  ON_HOLD: {
    tone: 'warn',
    title: 'A payment did not go through',
    detail:
      'Your lines still work for now. Updating the card on file usually resolves it, and the payment is tried again straight away.',
    action: 'Update payment',
  },
  CANCELLED: {
    tone: 'stop',
    title: 'This account has been cancelled',
    detail: 'Numbers and settings are kept for a short while. Renewing restores them.',
    action: 'Renew the plan',
  },
};

const AccountStateBanner = () => {
  const { user } = useUser();
  const status = String((user as any)?.company_info?.plan_status || '').toUpperCase();
  const trouble = TROUBLE_BY_STATUS[status];

  if (!trouble) return null;

  return (
    <div className={`mcm-acctbanner is-${trouble.tone}`} role="status">
      <div className="mcm-acctbanner-t">
        <strong>{trouble.title}</strong>
        <span>{trouble.detail}</span>
      </div>
      {/* The remedy used to be a link to Billing › Summary. That section has
          been removed, and a banner whose only action leads nowhere is worse
          than one that simply states the problem. */}
    </div>
  );
};

export default AccountStateBanner;
