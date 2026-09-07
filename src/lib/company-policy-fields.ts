/* The settings a company rule can be set on, and where the flag sits in the
 * stored record. Keys are the names callers use; paths are what the company page
 * writes. Anything absent from this map is not governed and stays editable.
 *
 * This table sits in a module of its own, importing nothing, because two modules
 * need it and they need each other:
 *
 *   company-policy      →  readRuleFlags  (from company-rule-flags)
 *   company-rule-flags  →  POLICY_FIELDS  (from company-policy)
 *
 * That cycle resolved fine for the screens that happened to pull one side in
 * first, and threw "Cannot access 'POLICY_FIELDS' before initialization" on the
 * ones that pulled the other — which is why My Account → Preferences rendered
 * the app's error page instead of the settings, while the Company screens next
 * to it were fine. A leaf module has no side to be entered from, so the order
 * modules load in stops mattering.
 *
 * Both files still re-export these, so every existing import keeps working.
 */

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
