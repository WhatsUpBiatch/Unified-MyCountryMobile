import { normalizeRegionalSettings } from '@/lib/regional-settings';
import { Picker } from '@/components/mcm/picker';

type AgentSiteSelectionProps = {
  sites: any[];
  selectedSiteId: string;
  onChange: (siteId: string) => void;
  error?: string;
  disabled?: boolean;
  isLoading?: boolean;
};

const readSiteValue = (value: unknown): string => {
  if (value && typeof value === 'object') {
    const option = value as { value?: unknown; label?: unknown };
    return String(option.value || option.label || '').trim();
  }

  return String(value || '').trim();
};

export const getAgentSiteId = (site: any): string =>
  String(site?.uuid || site?.id || site?.site_uuid || site?.site_id || '').trim();

export const getAgentSiteTimezone = (site: any): string =>
  readSiteValue(site?.timezone || site?.time_zone || site?.timeZone);

export const getPreferredAgentSiteId = (sites: any[]): string => {
  const defaultSite = sites.find(
    (site) => site?.is_default === '1' || site?.is_default === 1 || site?.is_default === true,
  );
  return getAgentSiteId(defaultSite || sites[0]);
};

export const getAgentSiteRegionalSettings = (site: any, currentRegional?: any) => {
  const timezone = getAgentSiteTimezone(site);
  const country = readSiteValue(site?.country);
  const countryCode = readSiteValue(
    site?.country_code || site?.countryCode || site?.iso_code || site?.isoCode,
  );

  return normalizeRegionalSettings({
    ...(currentRegional || {}),
    country: country
      ? { label: country, value: country }
      : currentRegional?.country || { label: '', value: '' },
    country_code: countryCode
      ? { label: countryCode, value: countryCode }
      : currentRegional?.country_code || { label: '', value: '' },
    timezone: { label: timezone, value: timezone },
  });
};

export default function AgentSiteSelection({
  sites,
  selectedSiteId,
  onChange,
  error,
  disabled = false,
  isLoading = false,
}: AgentSiteSelectionProps) {
  return (
    <div
      className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      data-validation-key="siteLocation"
    >
      <h3 className="text-sm font-semibold text-gray-950">Location</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Select the site this agent belongs to. Its timezone will be used for schedules and
        reporting.
      </p>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-semibold text-slate-700">Site location *</span>
        <Picker
          label="Site location"
          showLabel={false}
          className={`mcm-field${error ? ' is-bad' : ''}`}
          disabled={disabled || isLoading || sites.length === 0}
          placeholder={
            isLoading ? 'Loading sites…' : sites.length ? 'Select a site' : 'No sites available'
          }
          value={selectedSiteId}
          options={sites.map((site) => {
            const isDefault =
              site?.is_default === '1' || site?.is_default === 1 || site?.is_default === true;
            return {
              label: `${site?.name || 'Unnamed site'}${isDefault ? ' (Main Site)' : ''}`,
              value: getAgentSiteId(site),
            };
          })}
          onChange={(option) => onChange(option.value)}
        />
      </label>

      {error ? <p className="mt-2 text-xs font-medium text-red-500">{error}</p> : null}
    </div>
  );
}
