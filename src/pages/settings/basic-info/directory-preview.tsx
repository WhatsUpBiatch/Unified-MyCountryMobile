import { useFormContext } from 'react-hook-form';
import { Hash, MapPin } from 'lucide-react';
import CustomAvatar from '@/components/custom/custom-avatar';
import { Icon } from '@/assets/icons/icon';

/**
 * Your directory card, drawn live from the form beside it.
 *
 * The page has always described itself as "your name, job title and location as
 * colleagues see them in the directory" — and then never showed that. The
 * fields were a column of labelled inputs like any other settings form, so the
 * one question this screen exists to answer, "what do other people see?", was
 * the one thing you had to save and go and look somewhere else to find out.
 *
 * So the card is the page. It reads the same `basic.*` fields the inputs write,
 * through the form context, which means it cannot drift from what will be
 * saved: there is no second copy of the data, only a second rendering of it.
 *
 * The photo lives in page state rather than the form (it uploads separately),
 * so it arrives as props.
 */

const DirectoryPreview = ({
  photo,
  isImageRemoved,
  storedPhoto,
}: {
  photo?: string | null;
  isImageRemoved?: boolean;
  storedPhoto?: string | null;
}) => {
  const { watch } = useFormContext();

  /* Watched as one object rather than field by field.

     The page fills this form with a single `setValue('basic', {...})` — the
     parent path. Subscribing to `basic.first_name` and friends does not get
     woken by that write, so the card sat on its placeholders until the first
     keystroke, showing "Your name" beside an input that already said Hannah.
     Watching `basic` matches the write exactly and the card is right from the
     first render. */
  const basic = (watch('basic') || {}) as Record<string, any>;

  const first = String(basic.first_name || '').trim();
  const last = String(basic.last_name || '').trim();
  const jobTitle = String(basic.job_title || '').trim();
  const pronouns = String(basic.pronouns || '').trim();
  const extension = basic.extension;
  const site = basic.site?.label;

  const fullName = [first, last].filter(Boolean).join(' ');
  const image = isImageRemoved ? null : photo || storedPhoto || null;

  return (
    <div className="mcm-dircard">
      {/* Says what it is. Without this the card reads as a second thing to
          fill in rather than as a picture of the first. */}
      <div className="mcm-dircard-cap">
        <span className="mcm-dircard-dot" aria-hidden="true" />
        How colleagues see you
      </div>

      <div className="mcm-dircard-body">
        <span className="mcm-dircard-band" aria-hidden="true" />

        <span className="mcm-dircard-photo">
          {image ? (
            <img src={image} alt="" loading="lazy" />
          ) : (
            <CustomAvatar
              size="76"
              name={fullName || '—'}
              showPresence={false}
              extension={extension}
              isActivityInfo={false}
            />
          )}
        </span>

        <h3 className={fullName ? '' : 'is-empty'}>
          {fullName || 'Your name'}
          {/* Pronouns sit with the name here exactly as they do in the
              directory, which is the whole point of showing this. */}
          {pronouns ? <span className="mcm-dircard-pro">({pronouns})</span> : null}
        </h3>
        <p className={jobTitle ? 'mcm-dircard-role' : 'mcm-dircard-role is-empty'}>
          {jobTitle || 'No job title'}
        </p>

        <dl className="mcm-dircard-rows">
          <div>
            <dt>
              <Hash size={13} strokeWidth={2} aria-hidden="true" />
              Extension
            </dt>
            <dd className={extension ? '' : 'is-empty'}>{extension || 'Not set'}</dd>
          </div>
          <div>
            <dt>
              <MapPin size={13} strokeWidth={2} aria-hidden="true" />
              Location
            </dt>
            <dd className={site ? '' : 'is-empty'}>{site || 'Not set'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
};

/* The photo control, under the card. Kept out of `DirectoryPreview` so the card
   stays a picture of the record and nothing in it is clickable except this. */
export const PhotoControls = ({
  hasPhoto,
  onRemove,
}: {
  hasPhoto: boolean;
  onRemove: () => void;
}) => (
  <div className="mcm-dircard-acts">
    <label htmlFor="file-upload" className="mcm-dircard-change">
      <Icon name="EditIcon" />
      {hasPhoto ? 'Change photo' : 'Add a photo'}
    </label>
    {/* Removing was a bare "×" that appeared on hover only — invisible on a
        touch screen, and unreachable by keyboard because it sat inside the
        label that swallows the click. */}
    {hasPhoto ? (
      <button type="button" className="mcm-dircard-drop" onClick={onRemove}>
        Remove
      </button>
    ) : null}
  </div>
);

export default DirectoryPreview;
