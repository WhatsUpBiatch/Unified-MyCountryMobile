import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import CreateContactNew from '@/pages/new-contact/create-new-contact';
import { useDialpad } from '@/hooks/use-dialpad';
import type { DialpadSession } from '@/context/dialpad-context';
import { Ic } from '../icons';
import { DialNumber } from '../dial-number';
import { initialsOf } from '../copilot-adapter';
import { useCallerName } from '../use-caller-name';
import type { ConsoleCallRow } from '../call-list-column';
import { DEMO_ENABLED, demoProfile } from '../demo-data';
import DemoChip from './demo-chip';

/**
 * Contact — laid out as `paneContact` in the design artifact: an identity card,
 * then stacked `.panel-card` blocks of key/value rows.
 *
 * Real first: contactInfo, queue, campaign and arrival DID come from the
 * platform. The account block, open tickets and linked systems have no endpoint
 * yet and fall back to demo values behind a chip.
 */
const ContactPane = ({
  session,
  selectedCall,
}: {
  session: DialpadSession | null;
  selectedCall?: ConsoleCallRow | null;
}) => {
  const { refreshSessionContactInfo } = useDialpad();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { callerName } = useCallerName();
  const number = session?.remoteNumber || selectedCall?.number || '';
  const name = session ? callerName(session) : selectedCall?.name || '';
  const contact = session?.contactInfo;

  const formContactData = useMemo(() => {
    if (!contact) return null;
    if (Array.isArray(contact)) return contact.length ? contact : null;
    if (typeof contact === 'object') return Object.keys(contact).length ? contact : null;
    return contact;
  }, [contact]);

  if (!number) {
    return (
      <div className="pscroll">
        <div className="empty">
          <Ic n="user" size={30} />
          <p>Pick a call on the left, or start one, to see who it is.</p>
        </div>
      </div>
    );
  }

  const profile = DEMO_ENABLED ? demoProfile(number) : null;

  if (editing) {
    return (
      <div className="ppane on console-embed-pane" style={{ padding: 10, minHeight: 0 }}>
        <div className="contact-edit-head">
          <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>
            <Ic n="chev" size={13} className="flip" />
            Back
          </button>
          <span className="sect-title" style={{ marginLeft: 4 }}>
            {formContactData ? 'Edit contact' : 'New contact'}
          </span>
        </div>
        <CreateContactNew
          contactData={formContactData}
          prefillPhone={formContactData ? '' : number}
          hideCancelButton
          isDisable={false}
          setIsDisable={() => void 0}
          setDrawerState={() => void 0}
          keepFormDataAfterSave
          handleClose={() => setEditing(false)}
          setTabData={(savedContact: any) => {
            if (session?.id && savedContact) {
              refreshSessionContactInfo(session.id, savedContact);
            }
            queryClient.invalidateQueries({ queryKey: ['fetchContact'] });
            queryClient.invalidateQueries({ queryKey: ['console-call-list'] });
            setEditing(false);
          }}
        />
      </div>
    );
  }

  const company = contact?.company || '';
  const queue = session?.queueMetaData?.response?.name || '';

  return (
    <div className="pscroll">
      {/* identity */}
      <div className="card contact-card">
        <div className="caller-av contact-av">{initialsOf(name) || <Ic n="user" size={20} />}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="contact-name">{name || 'Unknown contact'}</div>
          <div className="contact-sub">
            {company || (contact ? 'Contact' : 'Not in the contact book')}
          </div>
          <div className="contact-tags">
            {contact ? (
              <span className="tag pos">In contacts</span>
            ) : (
              <span className="tag warn">No record</span>
            )}
            {session?.direction ? (
              <span className="tag acc">
                {session.direction === 'incoming' ? 'Inbound' : 'Outbound'}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="contact-actions">
        <button type="button" className="btn primary sm" onClick={() => setEditing(true)}>
          <Ic n={contact ? 'note' : 'plus'} size={13} />
          {contact ? 'Edit contact' : 'Add to contacts'}
        </button>
        <DialNumber number={number} className="btn ghost sm contact-call">
          <Ic n="phone" size={13} />
          Call
        </DialNumber>
      </div>

      {/* the platform's own record */}
      <div className="panel-card">
        <div className="pc-head">
          <h3>Contact record</h3>
          <span className="src live">live</span>
        </div>
        <div className="pc-body tight">
          <div className="kv">
            <span className="k">Number</span>
            <span className="v num">{number}</span>
          </div>
          <div className="kv">
            <span className="k">Company</span>
            <span className="v">{company || '—'}</span>
          </div>
          <div className="kv">
            <span className="k">Email</span>
            <span className="v">{contact?.email || '—'}</span>
          </div>
          <div className="kv">
            <span className="k">Tags</span>
            <span className="v">
              {Array.isArray(contact?.tags) && contact.tags.length
                ? contact.tags.map((t: any) => String(t?.name || t)).join(', ')
                : '—'}
            </span>
          </div>
          <div className="kv">
            <span className="k">Queue</span>
            <span className="v">{queue || '—'}</span>
          </div>
          <div className="kv">
            <span className="k">Campaign</span>
            <span className="v">
              {session?.campaignMetaData?.response?.name ||
                session?.liveCallData?.campaign_name ||
                '—'}
            </span>
          </div>
          <div className="kv">
            <span className="k">DNIS · flow</span>
            <span className="v num" style={{ fontSize: 11.5 }}>
              {session?.liveCallData?.did || '—'}
            </span>
          </div>
        </div>
      </div>

      {profile ? (
        <>
          <div className="panel-card">
            <div className="pc-head">
              <h3>Account</h3>
              <DemoChip />
            </div>
            <div className="pc-body tight">
              <div className="kv">
                <span className="k">Account</span>
                <span className="v num">{profile.account}</span>
              </div>
              <div className="kv">
                <span className="k">Segment</span>
                <span className="v">{profile.tier}</span>
              </div>
              <div className="kv">
                <span className="k">Balance</span>
                <span className="v num">{profile.balance}</span>
              </div>
              <div className="kv">
                <span className="k">Customer since</span>
                <span className="v">{profile.since}</span>
              </div>
              <div className="kv">
                <span className="k">Location</span>
                <span className="v">
                  {profile.city} · {profile.tz}
                </span>
              </div>
              <div className="kv">
                <span className="k">Language</span>
                <span className="v">{profile.language}</span>
              </div>
              <div className="kv">
                <span className="k">Contract ends</span>
                <span className="v" style={{ color: 'var(--warn)' }}>
                  {profile.contractEnds}
                </span>
              </div>
              <div className="kv">
                <span className="k">Lifetime calls</span>
                <span className="v num">{profile.lifetimeCalls}</span>
              </div>
            </div>
          </div>

          <div className="panel-card">
            <div className="pc-head">
              <h3>Open tickets</h3>
              {profile.openTickets ? (
                <span className="tag neg">{profile.openTickets} open</span>
              ) : (
                <span className="tag pos">None</span>
              )}
              <DemoChip />
            </div>
            <div className="pc-body tight">
              {profile.openTickets ? (
                Array.from({ length: profile.openTickets }).map((_, i) => (
                  <div className="kv" key={i}>
                    <span className="k">
                      {i === 0 ? 'Billing — duplicate collection' : 'Service — callback owed'}
                    </span>
                    <span className="v" style={{ color: i === 0 ? 'var(--crit)' : 'var(--warn)' }}>
                      {i === 0 ? '7 days open' : 'Awaiting owner'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="kv">
                  <span className="k">Nothing outstanding</span>
                  <span className="v">—</span>
                </div>
              )}
            </div>
          </div>

          <div className="panel-card">
            <div className="pc-head">
              <h3>Linked systems</h3>
              <DemoChip />
            </div>
            <div className="pc-body tight">
              <div className="kv">
                <span className="k">CRM</span>
                <span className="v">Not connected</span>
              </div>
              <div className="kv">
                <span className="k">Cases</span>
                <span className="v">Not connected</span>
              </div>
              <div className="kv">
                <span className="k">Payments</span>
                <span className="v">Not connected</span>
              </div>
            </div>
            <div className="demo-foot" style={{ padding: '0 16px 14px' }}>
              No CRM, case or payments integration is wired to the console yet. These rows show
              where they will appear.
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default ContactPane;
