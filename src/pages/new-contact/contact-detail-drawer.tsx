import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomAvatar from '@/components/custom/custom-avatar';
import NumberWithFlag from '@/components/custom/number-with-flag';
import SideDrawer from '@/components/custom/side-drawer';
import SendWhatsappMessage from '@/pages/messenger/drawers/send-whatsapp-message';
import { useConsoleDialer } from '@/pages/phone/console/dial-number';
import { Ic } from '@/components/mcm/icons';
import { DirectoryDrawer } from '@/pages/directory/page-shell';
import { useContactLabels } from '@/pages/directory/use-contact-labels';

/**
 * A contact, read at a glance.
 *
 * Opening a contact used to mean leaving the list for a full-page form, which
 * is a lot of ceremony for "what is their number again?". This is the read
 * view: everything stored about them, the four ways to reach them, and an Edit
 * button for the times you did want the form.
 *
 * Record shape is nested and easy to get wrong: `name.first` / `name.last`,
 * `contact.phone` / `contact.email`, `profile.contactPic`, and the record id is
 * `_id`, not `uuid`.
 */

export type ContactRecord = {
  _id?: string;
  name?: { first?: string; last?: string };
  contact?: { phone?: string; email?: string; webpage?: string };
  profile?: { contactPic?: string; company?: string; webpage?: string; title?: string };
  company?: string;
  title?: string;
  /** Extensible on the server: the form writes whatever keys it is given. */
  social?: Record<string, string>;
  is_vip?: boolean;
  is_dnc?: boolean;
  is_blocked?: boolean;
  tag?: string;
};

export const contactFullName = (row?: ContactRecord | null) =>
  `${row?.name?.first || ''} ${row?.name?.last || ''}`.trim() || 'Unknown';

/** VIP / DNC / Blocked are exclusive states in the UI, most restrictive first. */
export const contactTagOf = (row?: ContactRecord | null) => {
  const tag = String(row?.tag || '').toUpperCase();
  if (row?.is_blocked || tag === 'BLOCK') return { label: 'Blocked', cls: 'tag neg' };
  if (row?.is_dnc || tag === 'DNC') return { label: 'DNC', cls: 'tag warn' };
  if (row?.is_vip || tag === 'VIP') return { label: 'VIP', cls: 'tag acc' };
  return { label: 'Standard', cls: 'tag neu' };
};

/** A handle becomes a link where we know the site; otherwise it stays text. */
const profileUrl = (key: string, value: string) => {
  const handle = String(value || '')
    .trim()
    .replace(/^@/, '');
  if (!handle) return '';
  if (/^https?:\/\//i.test(handle)) return handle;
  const host: Record<string, string> = {
    instagram: 'https://instagram.com/',
    telegram: 'https://t.me/',
    twitter: 'https://x.com/',
    facebook: 'https://facebook.com/',
    linkedin: 'https://linkedin.com/in/',
  };
  return host[key] ? `${host[key]}${handle}` : '';
};

const ContactDetailDrawer = ({
  contact,
  onClose,
  onEdit,
}: {
  contact: ContactRecord | null;
  onClose: () => void;
  onEdit?: (contact: ContactRecord) => void;
}) => {
  const navigate = useNavigate();
  const { dial } = useConsoleDialer();
  const labels = useContactLabels();
  const [whatsappTo, setWhatsappTo] = useState('');
  const [newLabel, setNewLabel] = useState('');

  if (!contact) return null;

  const phone = contact?.contact?.phone || '';
  const company = contact?.profile?.company || contact?.company || '';
  const website = contact?.contact?.webpage || contact?.profile?.webpage || '';
  const socials = Object.entries(contact?.social || {}).filter(([, value]) => Boolean(value));

  /** SMS goes to the inbox composer, the same route the Contacts page used. */
  const sendSms = () =>
    navigate(`/inbox?formState=contact&number=${encodeURIComponent(phone || '')}`);

  return (
    <>
      <DirectoryDrawer
        title={contactFullName(contact)}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={onClose}>
              Close
            </button>
            {onEdit ? (
              <button type="button" className="btn primary" onClick={() => onEdit(contact)}>
                <Ic n="user" size={13} />
                Edit contact
              </button>
            ) : null}
          </>
        }
      >
        <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
          <CustomAvatar
            name={contactFullName(contact)}
            image={contact?.profile?.contactPic}
            type="contact"
            size="44"
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{contactFullName(contact)}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {contact?.title || company || 'Contact'}
            </div>
          </div>
          <span className={contactTagOf(contact).cls} style={{ marginLeft: 'auto' }}>
            {contactTagOf(contact).label}
          </span>
        </div>

        <div className="kv">
          <span className="k">Phone</span>
          <span className="v num">{phone ? <NumberWithFlag number={phone} /> : '—'}</span>
        </div>
        <div className="kv">
          <span className="k">Email</span>
          <span className="v">{contact?.contact?.email || '—'}</span>
        </div>
        <div className="kv">
          <span className="k">Company</span>
          <span className="v">{company || '—'}</span>
        </div>
        <div className="kv">
          <span className="k">Website</span>
          <span className="v">{website || '—'}</span>
        </div>

        {/* `social` is an open map on the server — the contact form already
            writes back whatever keys it receives — so every handle stored
            against this contact is listed, not just the ones the form happens
            to render inputs for. */}
        {socials.map(([key, value]) => {
          const url = profileUrl(key, String(value));
          return (
            <div className="kv" key={key}>
              <span className="k" style={{ textTransform: 'capitalize' }}>
                {key}
              </span>
              <span className="v">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {String(value)}
                  </a>
                ) : (
                  String(value)
                )}
              </span>
            </div>
          );
        })}
        {!socials.length ? (
          <div className="kv">
            <span className="k">Social</span>
            <span className="v">—</span>
          </div>
        ) : null}

        {/* Labels sit above the actions because they are the part of this panel
            somebody edits, and the actions are the part they press once. */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 6 }}>
            Labels
          </div>
          <div className="flex flex-wrap items-center gap-1" style={{ marginBottom: 8 }}>
            {labels.labelsOf(contact?._id).length ? (
              labels.labelsOf(contact?._id).map((entry) => (
                <span className="tag neu" key={entry}>
                  {entry}
                  <button
                    type="button"
                    onClick={() => labels.remove(String(contact?._id), entry)}
                    title={`Remove the label “${entry}”`}
                    aria-label={`Remove the label ${entry}`}
                    style={{ marginLeft: 4, lineHeight: 1 }}
                  >
                    <Ic n="x" size={10} />
                  </button>
                </span>
              ))
            ) : (
              <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>None yet.</span>
            )}
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              labels.add(String(contact?._id), newLabel);
              setNewLabel('');
            }}
          >
            <input
              className="mcm-field"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="Add a label"
              aria-label="Add a label"
              list="mcm-label-suggestions"
            />
            {/* Suggests labels already in use, so the same idea does not end up
                spelled three ways and split across three filters. */}
            <datalist id="mcm-label-suggestions">
              {labels.index.map((entry) => (
                <option key={entry.label} value={entry.label} />
              ))}
            </datalist>
            <button type="submit" className="mini solid" disabled={!newLabel.trim()}>
              <Ic n="plus" size={12} />
              Add
            </button>
          </form>

          {labels
            .check(String(contact?._id), newLabel)
            .filter(() => newLabel.trim().length > 0)
            .map((problem) => (
              <p
                key={problem.message}
                style={{
                  fontSize: 11,
                  margin: '6px 0 0',
                  color: problem.blocking ? 'var(--crit)' : 'var(--ink-4)',
                }}
              >
                {problem.message}
              </p>
            ))}

          <p style={{ fontSize: 11, color: 'var(--ink-4)', margin: '8px 0 0' }}>
            Labels are yours and are kept in this browser. They do not reach the contact record, so
            they will not follow you to another device or appear for anyone else on your team.
          </p>
        </div>

        <div className="ac-acts" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="mini solid"
            disabled={!phone}
            onClick={() => phone && dial(phone)}
          >
            <Ic n="phone" size={12} />
            Call
          </button>
          <button type="button" className="mini" disabled={!phone} onClick={sendSms}>
            <Ic n="chat" size={12} />
            SMS
          </button>
          <button
            type="button"
            className="mini"
            disabled={!phone}
            onClick={() => setWhatsappTo(phone)}
          >
            <Ic n="send" size={12} />
            WhatsApp
          </button>
          <button
            type="button"
            className="mini"
            onClick={() =>
              navigate(`/contact-activity?contactId=${contact?._id}`, {
                state: { key: 'phone', value: phone },
              })
            }
          >
            <Ic n="clock" size={12} />
            Activity
          </button>
        </div>
      </DirectoryDrawer>

      {whatsappTo ? (
        <SideDrawer
          isOpen={Boolean(whatsappTo)}
          handleClose={() => setWhatsappTo('')}
          isHeader
          width="500px"
          enableResponsive
          responsiveWidth="96vw"
          responsiveBreakpoint={1024}
          content={
            <SendWhatsappMessage handleClose={() => setWhatsappTo('')} initialNumber={whatsappTo} />
          }
        />
      ) : null}
    </>
  );
};

export default ContactDetailDrawer;
