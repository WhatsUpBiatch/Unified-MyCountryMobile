import { useMemo } from 'react';
import { MapPin, Pencil, Star, Trash2 } from 'lucide-react';
import countryList from '@/lib/countries.json';
import { CountryFlag } from '@/components/flag';
import LocationFacts from './location-facts';

/**
 * One location, on the Company screen.
 *
 * This markup existed twice — once for the default location and once inside the
 * `.map()` over the others — about ninety lines each of address block and a
 * five-column Country / State / City / Postal / Timezone grid, differing only in
 * which buttons were drawn. Two copies of a record card is two places for a
 * field to be added and one to be forgotten.
 *
 * The five labelled columns are also gone. Every one of those values is already
 * in the address line directly above them, so the card was printing the same
 * place twice, once as prose and once as a table, and spending five heading rows
 * to do it. They read as one line now. What is promoted instead is the pair the
 * page's own explainer says a location decides — its country and its clock.
 */

/* Name to ISO code, so the country can carry its flag. The sites API stores a
   country name, and `CountryFlag` needs the two-letter code; the same
   countries.json the rest of the console uses has both. Built once. */
const ISO_BY_NAME: Record<string, string> = {};
(countryList as Array<{ name: string; isoCode: string }>).forEach((c) => {
  ISO_BY_NAME[c.name.toLowerCase()] = c.isoCode;
});
const isoFor = (name?: string | null) => ISO_BY_NAME[String(name || '').trim().toLowerCase()];

export type LocationCardProps = {
  site: any;
  isDefault: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /* Trial accounts can look but not change. Kept as its own flag rather than
     folded into canEdit, because the two mean different things and the buttons
     they hide are not the same set. */
  isTrial: boolean;
  isSettingMain?: boolean;
  onOpen: (site: any) => void;
  onEdit: (site: any) => void;
  onDelete: (site: any, isDefault: boolean) => void;
  onMakeMain?: (site: any) => void;
};

const LocationCard = ({
  site,
  isDefault,
  canEdit,
  canDelete,
  isTrial,
  isSettingMain,
  onOpen,
  onEdit,
  onDelete,
  onMakeMain,
}: LocationCardProps) => {
  const siteId = site?.site_id || site?.id || site?.uuid || '---';

  /* Country, state, city and postcode as one line. Empty parts are dropped
     rather than printed as "---", so a half-filled record reads as short
     instead of broken — what is actually missing is already said by the
     readiness flag in LocationFacts below. */
  const where = useMemo(
    () => [site?.state, site?.city, site?.postal_code].filter(Boolean).join(' · '),
    [site?.state, site?.city, site?.postal_code],
  );

  return (
    <article className={`mcm-loc ${isDefault ? 'is-main' : ''}`}>
      <header className="mcm-loc-h">
        <span className="mcm-loc-mark" aria-hidden="true">
          <MapPin size={16} strokeWidth={2} />
        </span>

        <div className="mcm-loc-id">
          <div className="mcm-loc-t">
            <button type="button" className="mcm-loc-name" onClick={() => onOpen(site)}>
              {site?.name || 'Untitled location'}
            </button>
            {isDefault ? (
              <span className="mcm-loc-main" title="New people and numbers default to this one">
                <Star size={11} strokeWidth={2.5} aria-hidden="true" />
                Main
              </span>
            ) : null}
          </div>
          <span className="mcm-loc-ref">{siteId}</span>
        </div>

        <div className="mcm-loc-acts">
          {!isTrial && canEdit && !isDefault && onMakeMain ? (
            <button
              type="button"
              className="mcm-loc-mainbtn"
              disabled={isSettingMain}
              onClick={() => onMakeMain(site)}
            >
              Make main
            </button>
          ) : null}
          {!isTrial && canEdit ? (
            <button
              type="button"
              className="mcm-loc-btn"
              aria-label={`Edit ${site?.name || 'location'}`}
              title="Edit"
              onClick={() => onEdit(site)}
            >
              <Pencil size={14} strokeWidth={2} />
            </button>
          ) : null}
          {canDelete && !isDefault ? (
            <button
              type="button"
              className="mcm-loc-btn is-kill"
              aria-label={`Delete ${site?.name || 'location'}`}
              title="Delete"
              onClick={() => onDelete(site, isDefault)}
            >
              <Trash2 size={14} strokeWidth={2} />
            </button>
          ) : null}
          {isDefault ? (
            /* The main location cannot be deleted. Said, rather than left as an
               absent button next to every other card's. */
            <span className="mcm-loc-locked">Cannot be deleted</span>
          ) : null}
        </div>
      </header>

      <div className="mcm-loc-body">
        <p className={`mcm-loc-addr ${site?.address ? '' : 'is-empty'}`}>
          {site?.address || 'No address on record'}
        </p>
        {where ? <p className="mcm-loc-where">{where}</p> : null}

        <div className="mcm-loc-facts">
          {/* The two things the page says a location decides: which country it
              is in, and what time it is there. */}
          <span className="mcm-loc-fact">
            <CountryFlag code={isoFor(site?.country)} />
            {site?.country || 'No country'}
          </span>
          <span className="mcm-loc-fact">
            <span className="mcm-loc-factk">Clock</span>
            {site?.timezone || 'Not set'}
          </span>
        </div>
      </div>

      <LocationFacts site={site} />
    </article>
  );
};

export default LocationCard;
