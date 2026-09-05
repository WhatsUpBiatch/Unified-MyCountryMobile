/* Turning the company's override flags into an actual lock.
 *
 * Each setting in the company record carries an `override` flag meaning "a person
 * may change this one on their own phone". Until now nothing read it: the personal
 * settings page stripped `override` out before saving and decided editability from
 * job title alone — an admin could change everything, everyone else could change
 * nothing. That is the wrong shape. "Anyone may pick their ringtone, nobody may
 * turn off call recording" was impossible to express.
 *
 * This reads the flags and answers one question per field: may this person change
 * it. Two rules keep it safe to switch on:
 *
 *   - It applies only on someone's own settings page. Every other screen using the
 *     shared editor is an admin configuring a number, department, IVR or queue, and
 *     locking those would be nonsense.
 *   - With no company record saved, it defers entirely to the old behaviour. A
 *     tenant that has never opened the company page sees no change at all.
 *   - Once a record exists, a rule the company has never set is open. An absent
 *     flag used to read as a lock, so the record coming into being for any reason
 *     (a holiday saved, say) locked every governed field on every person's phone.
 *     Now only a flag an admin actually stored as "locked" locks anything; see the
 *     table in src/lib/company-rule-flags.ts.
 */

import { useQuery } from '@tanstack/react-query';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  type CompanyDefaultTemplate,
} from '@/lib/company-defaults';
import { readRuleFlags } from '@/lib/company-rule-flags';

/* The settings a company rule can be set on, and where the flag sits in the
   stored record. Keys are the names callers use; paths are what the company page
   writes. Anything absent from this map is not governed and stays editable. */
export const POLICY_FIELDS = {
  voicemail: 'voicemail_pin.override',
  recording: 'recording.override',
  transcription: 'transcription.override',
  ai_call_monitoring: 'ai_call_monitoring.override',
  display_number: 'display_number.override',
  business_hours: 'operational_hours.override',
  regional: 'operational_hours.regional.override',
  role: 'role.override',
} as const;

export type PolicyField = keyof typeof POLICY_FIELDS;

export interface CompanyPolicy {
  /* True once a company record exists and its flags are governing this page. */
  isActive: boolean;
  isLoading: boolean;
  /* Whether the person may change this field on their own phone. */
  allows: (field: PolicyField) => boolean;
  /* Whether the company value should be copied onto a person. */
  applies: (field: PolicyField) => boolean;
}

export const useCompanyPolicy = ({ enabled }: { enabled: boolean }): CompanyPolicy => {
  const { data, isLoading } = useQuery<CompanyDefaultTemplate | null>({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
    enabled,
    /* The company rule changes rarely and is read on every settings page load, so
       it is kept for a few minutes rather than refetched each time. */
    staleTime: 5 * 60 * 1000,
  });

  const settings = data?.settings;
  const isActive = enabled && !isLoading && !!data?.uuid && !!settings;

  return {
    isActive,
    isLoading: enabled && isLoading,
    /* A field is editable unless the company has locked it.
    
       This used to read the single `override` flag directly, which carried two
       contradictory jobs: on this page it meant "the person may change it", and
       when provisioning a new person it meant "copy this value onto them". One
       bit could not say both, so "everyone gets this and nobody may change it"
       — the thing admins actually want — was unsayable. The flags are separate
       now. A record holding only the old flag reads as it did for `true` and for a
       stored `false`; a flag that was never stored reads as open, not locked. */
    allows: (field: PolicyField) => {
      if (!isActive) return true;
      return !readRuleFlags(settings, field).locked;
    },
    /* The other half: whether this company value should be put onto a person. */
    applies: (field: PolicyField) => {
      if (!isActive) return false;
      return readRuleFlags(settings, field).apply;
    },
  };
};
