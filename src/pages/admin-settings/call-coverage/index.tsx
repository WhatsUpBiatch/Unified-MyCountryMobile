import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allNumbersList, callForwarding, getGreetings, getUserList } from '@/services/api';
import { useUser } from '@/hooks/use-user';
import {
  assignVoicemailGreeting,
  generateVoicemailGreeting,
  voicemailGreetingName,
  voicemailScriptFor,
} from '@/lib/voicemail-greeting';
import { useOrganization } from '@/hooks/use-organisation';
import { handleAlert } from '@/lib/utils';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import Loader from '@/components/custom/loader';
import NumberWithFlag from '@/components/custom/number-with-flag';
import SideDrawer from '@/components/custom/side-drawer';
import UpdateForwarding from '@/pages/admin-settings/people/update-forwarding';
import { Ic } from '@/components/mcm/icons';
import { AdminPage } from '@/pages/admin-settings/page-shell';
import {
  buildNumberStandard,
  buildVoicemailPatch,
  describeStandard,
  evaluateNumber,
  evaluateUser,
  extensionOf,
  assignedNameOf,
  type Coverage,
} from '@/lib/call-standard';
import { invalidateNumberLists } from '@/lib/number-list-cache';
import '@/components/mcm/mcm-page.css';

/**
 * Admin ▸ Call coverage.
 *
 * Which numbers and extensions would drop a call right now, and a way to fix
 * the ones that can be fixed safely.
 *
 * Every other screen in Numbers answers "what is this number set to". None of
 * them answers "would a caller get through", which is the only question that
 * matters when a number has no handling at all — those numbers look unremarkable
 * in a list and silently drop every call.
 *
 * Apply is deliberately two different writes. A number with no handling at all
 * gets the full standard. A number that already routes somewhere but never
 * catches an unanswered call gets *only* the missing voicemail added, leaving
 * its destination and hours exactly as someone set them. Nothing here replaces
 * a decision an administrator already made.
 */

const STATE_CLASS: Record<Coverage['state'], string> = {
  covered: 'tag pos',
  partial: 'tag warn',
  gap: 'tag neg',
};

type Tab = 'numbers' | 'extensions' | 'greetings';

const CallCoverage = () => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('numbers');
  const [confirming, setConfirming] = useState<{ did: any; coverage: Coverage } | null>(null);
  const [onlyGaps, setOnlyGaps] = useState(true);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [, setGeneratedFor] = useState<string[]>([]);
  const [failedFor, setFailedFor] = useState<Record<string, string>>({});
  const { user } = useUser();
  const { mainSiteInfo } = useOrganization();

  /* Spoken aloud, so the admin gets to set it: text-to-speech reads
     "MyCountryMobile" as one run-on word, where "My Country Mobile" is said the
     way a person would. Seeded from the tenant's own branding and remembered
     locally, because there is nowhere on the account to store it. */
  const brandFromOrg = String(
    (mainSiteInfo as any)?.source_name || (mainSiteInfo as any)?.fav_title || '',
  ).trim();
  const [companyName, setCompanyName] = useState<string>(
    () => window.localStorage.getItem('mcm-voicemail-company') || '',
  );
  const spokenCompany = companyName || brandFromOrg;

  /* These three walk every page rather than asking for one huge one: the list
     endpoints cap `limit` at 200 and reject anything larger outright, so a
     single oversized request fails instead of truncating. This screen audits
     the whole estate, so it genuinely needs all of it. */
  const { data: numbers = [], isPending: numbersLoading } = useQuery({
    /* Shares the prefix the Numbers screens use, so applying the standard here
       refreshes those lists too. */
    queryKey: ['usedNumbersList', 'callCoverage'],
    queryFn: () => fetchAllPages(allNumbersList, { type: 'in_use' }),
  });

  const { data: users = [], isPending: usersLoading } = useQuery({
    queryKey: ['fetchUsersList', 'callCoverage'],
    queryFn: () => fetchAllPages(getUserList),
  });

  const { data: greetings = [], refetch: refetchGreetings } = useQuery({
    queryKey: ['greetingList', 'callCoverage'],
    queryFn: () => fetchAllPages(getGreetings, { search: '', type: 'voicemail' }),
  });

  const { mutate: applyStandard, isPending: applying } = useMutation({
    mutationFn: callForwarding,
    onSuccess: () => {
      invalidateNumberLists(queryClient);
      handleAlert({ text: 'Standard call handling applied.', type: 'success' });
      setConfirming(null);
    },
    onError: (error: any) => {
      handleAlert({
        text: error?.response?.data?.message || 'Could not apply the standard to this number.',
        type: 'error',
      });
    },
  });

  const numberRows = useMemo(
    () => (numbers as any[]).map((did) => ({ did, coverage: evaluateNumber(did) })),
    [numbers],
  );

  const userRows = useMemo(
    () => (users as any[]).map((user) => ({ user, coverage: evaluateUser(user) })),
    [users],
  );

  const counts = useMemo(() => {
    const rows = tab === 'numbers' ? numberRows : userRows;
    return {
      total: rows.length,
      gaps: rows.filter((row) => row.coverage.state !== 'covered').length,
      fixable: rows.filter((row) => row.coverage.fixable).length,
    };
  }, [tab, numberRows, userRows]);

  const visibleNumbers = onlyGaps
    ? numberRows.filter((row) => row.coverage.state !== 'covered')
    : numberRows;
  const visibleUsers = onlyGaps
    ? userRows.filter((row) => row.coverage.state !== 'covered')
    : userRows;

  const isLoading = tab === 'numbers' ? numbersLoading : usersLoading;

  const confirmApply = () => {
    if (!confirming) return;
    /* A number with no handling gets the whole standard written. A number that
       already routes somewhere gets only the missing voicemail added, so its
       destination and hours survive untouched. */
    const payload =
      confirming.coverage.state === 'gap'
        ? buildNumberStandard(confirming.did)
        : buildVoicemailPatch(confirming.did);
    if (!payload) {
      handleAlert({ text: 'This number has no extension to send voicemail to.', type: 'error' });
      return;
    }
    applyStandard(payload);
  };

  const rememberCompany = (value: string) => {
    setCompanyName(value);
    try {
      window.localStorage.setItem('mcm-voicemail-company', value);
    } catch {
      /* Private browsing — the field still works for this session. */
    }
  };

  const personName = (person: any) =>
    `${person?.first_name || ''} ${person?.last_name || ''}`.trim();

  /* A person already has one when a voicemail greeting carries their name.
     Matching on name rather than an id because the greeting library has no
     link back to the person it was made for. */
  const greetingExistsFor = (person: any) => {
    const expected = voicemailGreetingName(personName(person)).slice(0, 50).toLowerCase();
    return (greetings as any[]).some(
      (greeting) => String(greeting?.name || '').toLowerCase() === expected,
    );
  };

  const runGeneration = async (people: any[]) => {
    const companyUuid = (user as any)?.company_info?.uuid;
    if (!companyUuid) {
      handleAlert({
        text: 'Could not resolve this company, so nothing was generated.',
        type: 'error',
      });
      return;
    }

    for (const person of people) {
      const name = personName(person);
      if (!name) continue;
      setGenerating(person?.uuid);
      try {
        const greeting = await generateVoicemailGreeting({
          personName: name,
          companyName: spokenCompany || undefined,
          companyUuid,
        });
        /* Generating without attaching leaves an audio file nobody hears, so
           the two steps are one action. */
        await assignVoicemailGreeting(person, greeting);
        setGeneratedFor((previous) => [...previous, person.uuid]);
        setFailedFor((previous) => {
          const next = { ...previous };
          delete next[person.uuid];
          return next;
        });
      } catch (error: any) {
        setFailedFor((previous) => ({
          ...previous,
          [person.uuid]: error?.message || 'Generation failed',
        }));
      }
    }

    setGenerating(null);
    await refetchGreetings();
    queryClient.invalidateQueries({ queryKey: ['fetchUsersList'] });
    handleAlert({ text: 'Voicemail greetings generated and assigned.', type: 'success' });
  };

  const peopleNeedingGreeting = (users as any[]).filter(
    (person) => personName(person) && !greetingExistsFor(person),
  );

  return (
    <>
      <AdminPage
        section="Numbers"
        title="Call coverage"
        description="Which numbers and extensions would drop a call right now, and what it takes to close each gap."
        filters={
          <>
            <div className="ptabstrip">
              <button
                type="button"
                className={tab === 'numbers' ? 'on' : ''}
                onClick={() => setTab('numbers')}
              >
                Numbers
              </button>
              <button
                type="button"
                className={tab === 'extensions' ? 'on' : ''}
                onClick={() => setTab('extensions')}
              >
                Extensions
              </button>
              <button
                type="button"
                className={tab === 'greetings' ? 'on' : ''}
                onClick={() => setTab('greetings')}
              >
                Voicemail greetings
              </button>
            </div>
            {tab === 'greetings' ? null : (
              <label className="fchip">
                <input
                  type="checkbox"
                  checked={onlyGaps}
                  onChange={(event) => setOnlyGaps(event.target.checked)}
                />
                Only show gaps
              </label>
            )}
            {tab === 'greetings' ? (
              <>
                <label className="fchip" style={{ flex: '1 1 260px', maxWidth: 340 }}>
                  Company:
                  <input
                    value={companyName}
                    onChange={(event) => rememberCompany(event.target.value)}
                    placeholder={brandFromOrg || 'Spoken company name'}
                    aria-label="Company name spoken in the greeting"
                    style={{
                      border: 0,
                      background: 'transparent',
                      width: '100%',
                      outline: 'none',
                      fontWeight: 700,
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn primary"
                  disabled={Boolean(generating) || !peopleNeedingGreeting.length}
                  onClick={() => runGeneration(peopleNeedingGreeting)}
                >
                  {generating
                    ? 'Generating…'
                    : `Generate all missing (${peopleNeedingGreeting.length})`}
                </button>
                <span
                  className={`fchip ${peopleNeedingGreeting.length ? 'bad' : 'live'}`}
                  style={{ marginLeft: 'auto' }}
                >
                  <span className="num">{peopleNeedingGreeting.length}</span> without a greeting
                </span>
              </>
            ) : (
              <span
                className={`fchip ${counts.gaps ? 'bad' : 'live'}`}
                style={{ marginLeft: 'auto' }}
              >
                <span className="num">{counts.gaps}</span> of {counts.total} would drop a call
              </span>
            )}
          </>
        }
      >
        {isLoading ? (
          <div className="flex h-full w-full items-center justify-center p-8">
            <Loader variant="blue" size="lg" />
          </div>
        ) : tab === 'numbers' ? (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Assigned to</th>
                <th>Coverage</th>
                <th>What a caller gets</th>
                <th>Fix</th>
              </tr>
            </thead>
            <tbody>
              {visibleNumbers.length ? (
                visibleNumbers.map(({ did, coverage }) => (
                  <tr key={did?.uuid || did?.did_number}>
                    {/* Formatted, with its flag — the raw E.164 string was the
                        only place in Numbers that printed one. */}
                    <td>
                      <span className="mcm-cov-num">
                        <NumberWithFlag number={did?.did_number} />
                        {did?.did_name ? <span>{did.did_name}</span> : null}
                      </span>
                    </td>
                    <td>
                      {assignedNameOf(did) ? (
                        <span className="mcm-cov-who">
                          <b>{assignedNameOf(did)}</b>
                          {extensionOf(did) ? <span>Ext {extensionOf(did)}</span> : null}
                        </span>
                      ) : (
                        <span className="mcm-numnone">Not assigned</span>
                      )}
                    </td>
                    <td>
                      <span className={STATE_CLASS[coverage.state]}>{coverage.headline}</span>
                    </td>
                    <td className="mcm-cov-detail">{coverage.detail}</td>
                    <td>
                      {coverage.fixable ? (
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => setConfirming({ did, coverage })}
                          disabled={applying}
                        >
                          Apply standard
                        </button>
                      ) : coverage.state === 'covered' ? (
                        <span className="mcm-numnone">Nothing to do</span>
                      ) : (
                        /* Not fixable from here is not the same as broken. The
                           cell beside it already says what the decision is;
                           this one only has to stop reading as a dead button. */
                        <span className="mcm-cov-manual">Yours to choose</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">
                      <Ic n="check" size={28} />
                      <p>
                        {onlyGaps ? 'No numbers are dropping calls.' : 'No numbers in use yet.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : tab === 'extensions' ? (
          <table>
            <thead>
              <tr>
                <th>Extension</th>
                <th>Name</th>
                <th>Coverage</th>
                <th>What a caller gets</th>
                <th>Fix</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.length ? (
                visibleUsers.map(({ user, coverage }) => (
                  <tr key={user?.uuid}>
                    <td className="num">{user?.extension || '—'}</td>
                    <td>
                      {`${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Unknown'}
                    </td>
                    <td>
                      <span className={STATE_CLASS[coverage.state]}>{coverage.headline}</span>
                    </td>
                    <td className="mcm-cov-detail">{coverage.detail}</td>
                    <td>
                      <button
                        type="button"
                        className={coverage.state === 'covered' ? 'btn' : 'btn primary'}
                        onClick={() => setEditingUser(user)}
                      >
                        {coverage.state === 'covered' ? 'Call rules' : 'Set voicemail'}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">
                      <Ic n="check" size={28} />
                      <p>
                        {onlyGaps
                          ? 'Every extension catches its unanswered calls.'
                          : 'No extensions yet.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Extension</th>
                <th>Greeting</th>
                <th>What the caller will hear</th>
                <th>Generate</th>
              </tr>
            </thead>
            <tbody>
              {(users as any[]).length ? (
                (users as any[])
                  .filter((person) => personName(person))
                  .map((person) => {
                    const has = greetingExistsFor(person);
                    const failure = failedFor[person.uuid];
                    const busy = generating === person.uuid;
                    return (
                      <tr key={person.uuid}>
                        <td style={{ fontWeight: 600 }}>{personName(person)}</td>
                        <td className="num">{person?.extension || '—'}</td>
                        <td>
                          {has ? (
                            <span className="tag pos">Ready</span>
                          ) : failure ? (
                            <span className="tag neg">Failed</span>
                          ) : (
                            <span className="tag warn">Just a tone</span>
                          )}
                        </td>
                        <td className="mcm-cov-detail">
                          {failure ||
                            voicemailScriptFor(personName(person), spokenCompany || undefined)}
                        </td>
                        <td>
                          {/* Weighted like the other two tabs: the row that has
                              no greeting yet is the one being acted on, so its
                              button leads. Regenerating one that is already
                              there is a second thought, not the point. */}
                          <button
                            type="button"
                            className={has ? 'btn' : 'btn primary'}
                            disabled={Boolean(generating)}
                            onClick={() => runGeneration([person])}
                          >
                            {busy ? 'Generating…' : has ? 'Regenerate' : 'Generate'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">
                      <Ic n="alert" size={28} />
                      <p>No extensions yet.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {tab === 'greetings' ? (
          <div className="mcm-tblfoot">
            Each greeting is synthesised, saved to Media Files, and attached to that person's
            voicemail in one step. Attaching goes through <code>/api/user/update</code>, which
            replaces the whole user record — so every other field is read off the person and written
            straight back, unchanged. Run one person first and confirm their name, role and settings
            are intact before generating for everyone.
          </div>
        ) : null}

        {tab === 'extensions' ? (
          <div className="mcm-tblfoot">
            This is the control that decides whether an unanswered call reaches voicemail. Open an
            extension, expand <strong>Incoming Calls</strong>, and set{' '}
            <strong>If Busy / Unanswered / Unreachable</strong> to{' '}
            <strong>Send to Voicemail</strong>. It is not applied in bulk on purpose: the only
            endpoint that writes call rules replaces the whole user record — name, role, greetings
            and settings included — so a partial write would quietly clear fields this screen never
            asked about.
          </div>
        ) : null}
      </AdminPage>

      {editingUser ? (
        <SideDrawer
          isOpen={Boolean(editingUser)}
          title={`Call rules · ${`${editingUser?.first_name || ''} ${editingUser?.last_name || ''}`.trim() || 'Extension'}`}
          width="min(1080px, 82vw)"
          enableResponsive
          responsiveWidth="96vw"
          responsiveBreakpoint={1024}
          handleClose={() => {
            setEditingUser(null);
            queryClient.invalidateQueries({ queryKey: ['fetchUsersList'] });
          }}
          content={
            <UpdateForwarding
              drawerState
              setDrawerState={() => {
                setEditingUser(null);
                queryClient.invalidateQueries({ queryKey: ['fetchUsersList'] });
              }}
              data={editingUser}
              setTabData={() => undefined}
            />
          }
        />
      ) : null}

      {confirming ? (
        <>
          <div className="scrim" onClick={() => setConfirming(null)} aria-hidden />
          <aside className="drw" role="dialog" aria-label="Apply standard call handling">
            <div className="drw-h">
              <h2>Apply standard call handling</h2>
              <button
                type="button"
                className="mini"
                onClick={() => setConfirming(null)}
                aria-label="Close"
              >
                <Ic n="x" size={12} />
              </button>
            </div>
            <div className="drw-b">
              <p style={{ color: 'var(--ink-2)' }}>
                This writes call handling to <strong>{confirming.did.did_number}</strong>, which{' '}
                {confirming.coverage.state === 'gap'
                  ? 'currently drops every call'
                  : 'currently drops any call that is not answered'}
                . Callers will follow this path:
              </p>

              <div className="mcm-flowpath">
                {describeStandard(confirming.did).map((step, index, all) => (
                  <span key={step} className="mcm-flowstep">
                    <span className={index === all.length - 1 ? 'chip end' : 'chip'}>{step}</span>
                    {index < all.length - 1 ? <span className="arw">→</span> : null}
                  </span>
                ))}
              </div>

              <ul className="mcm-flowfacts">
                <li>
                  Hours are set to <strong>24 hours</strong>. Weekly hours need a closed-hours
                  branch to be safe, and guessing your opening times would be inventing policy.
                </li>
                <li>
                  An unanswered or rejected call goes to <strong>voicemail</strong> on that
                  extension. This is the part the number wizard never saved, which is why calls rang
                  out into silence.
                </li>
                <li>
                  Nothing else on this number changes, and no number that already has handling is
                  touched.
                </li>
              </ul>
            </div>
            <div className="drw-f">
              <button type="button" className="btn" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={confirmApply}
                disabled={applying}
              >
                {applying ? 'Applying…' : 'Apply to this number'}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
};

export default CallCoverage;
