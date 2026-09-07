/* The first-time setup guide.
 *
 * Modelled on the usual deployment order rather than invented: offices, then
 * users, then main line routing. the usual guidance is the same sequence with
 * organisation first. Both put locations before people, because a person
 * inherits their clock and their address from where they sit.
 *
 * It is a guide, not a cage. Every step is a link, the menu keeps working, and
 * nothing is ever blocked behind an unfinished step — an admin who only wants to
 * add one person should not have to complete a wizard first. Once everything is
 * done it stops showing entirely, so an established account is not nagged.
 */

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useSetupProgress } from '@/hooks/use-setup-progress';

const DISMISS_KEY = 'mcm.setup-guide.dismissed';

const readDismissed = (): boolean => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    /* Private windows and blocked site data throw. Showing the guide is the
       safer default — it is dismissable again. */
    return false;
  }
};

const SetupGuide = ({
  companyInfo,
  defaultExpanded = true,
}: {
  companyInfo?: any;
  /* Open on the screens where setting the company up is the subject, shut where
     it is a reminder sitting on top of somebody else's work. Collapsed it is
     still a row with the count and a chevron, so nothing is hidden — the roster
     just gets the top of its own page back. */
  defaultExpanded?: boolean;
}) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(readDismissed);

  /* Two steps point at the page the guide is already on. Calling navigate() for
     those is a no-op, so the row looked broken — clicking it did nothing at all.
     They scroll to their section instead, and flash its outline, because a page
     that silently jumps leaves you unsure whether anything happened. */
  const goToStep = (path: string, anchor?: string) => {
    if (anchor && pathname === path) {
      const target = document.getElementById(anchor);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('mcm-flash');
        window.setTimeout(() => target.classList.remove('mcm-flash'), 1600);
        return;
      }
    }
    navigate(path);
  };
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { steps, completed, total, next, isLoading, licences } = useSetupProgress(companyInfo);

  /* Nothing is shown while the counts are still arriving: a half-loaded guide
     would tell an established account it has set nothing up. */
  if (dismissed || isLoading) return null;

  const allDone = completed >= total - 1 && !next;
  if (allDone) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* Not being able to remember the dismissal is a small annoyance, not a
         reason to leave the panel stuck open. */
    }
  };

  return (
    <div className="rounded-xl border border-primary/20 bg-ucass-primary-200/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Finish setting up your phone system</p>
          <p className="mt-0.5 text-xs text-gray-600">
            {completed} of {total} done
            {licences ? ` · ${licences.used} of ${licences.bought} licences used` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-gray-500 hover:bg-white/60"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Hide setup guide"
            title="Hide this"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-gray-500 hover:bg-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Progress bar: the last step is never auto-ticked, so it is excluded
          rather than making the bar look permanently unfinished. */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/70">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.round((completed / Math.max(total - 1, 1)) * 100)}%` }}
        />
      </div>

      {expanded && (
        <ol className="mt-3 flex flex-col gap-1.5">
          {steps.map((step, index) => {
            const isNext = next?.key === step.key;
            return (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={() => goToStep(step.path, step.anchor)}
                  className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    isNext
                      ? 'border-primary bg-white'
                      : 'border-transparent bg-white/60 hover:bg-white'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      step.done
                        ? 'bg-green-100 text-green-700'
                        : isNext
                          ? 'bg-primary text-white'
                          : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {step.done ? <Check className="h-3 w-3" /> : index + 1}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{step.title}</span>
                      {isNext && (
                        <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                          Next
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-gray-600">{step.purpose}</span>
                    <span className="mt-0.5 block text-xs font-medium text-gray-500">
                      {step.detail}
                    </span>
                  </span>

                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-gray-400" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

export default SetupGuide;
