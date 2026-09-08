/**
 * Searchable pages derived from the router config.
 * Each entry maps a human-readable label to an absolute route path.
 * Only top-level, user-navigable pages are included (no auth/error/index routes).
 */
export interface SearchablePage {
  label: string;
  path: string;
}

export const SEARCHABLE_PAGES: SearchablePage[] = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Phone', path: '/phone' },
  { label: 'Chat', path: '/messenger' },
  { label: 'Video Meetings', path: '/video' },
  { label: 'Upcoming Meetings', path: '/video' },
  { label: 'Past Meetings', path: '/video/past-meetings' },
  { label: 'Ongoing Meetings', path: '/video/ongoing-meetings' },
  { label: 'Invited Meetings', path: '/video/invited-meetings' },
  { label: 'All Recordings', path: '/video/recordings/all' },
  { label: 'My Recordings', path: '/video/recordings/my' },
  { label: 'Contacts', path: '/contact' },
  { label: 'Groups', path: '/department' },
  { label: 'Admin Settings', path: '/admin-settings' },
  { label: 'Company & Locations', path: '/admin-settings/company' },
  { label: 'Location management', path: '/admin-settings/company/location-management' },
  { label: 'People', path: '/admin-settings/people' },
  { label: 'Roles', path: '/admin-settings/roles' },
  { label: 'Groups', path: '/admin-settings/phone/departments' },
  { label: 'All Numbers', path: '/admin-settings/numbers/all' },
  { label: 'Numbers In Use', path: '/admin-settings/numbers/in-use' },
  { label: 'Numbers Inventory', path: '/admin-settings/numbers/inventory' },
  { label: 'Telephony', path: '/admin-settings/phone' },
  { label: 'IVR Menus', path: '/admin-settings/phone/ivr' },
  { label: 'Call Queue', path: '/admin-settings/phone/queues' },
  { label: 'Call Forwarding', path: '/admin-settings/phone/preferences' },
  { label: 'Shared Line', path: '/admin-settings/phone/shared-line' },
  { label: 'Social Media Channels', path: '/admin-settings/social-media-channels' },
  { label: 'Templates', path: '/admin-settings/templates/user-settings' },
  { label: 'Outbound Rates', path: '/admin-settings/calling-rates/outbound-rates' },
  { label: 'Knowledge Base', path: '/admin-settings/knowledge/all-knowledge' },
  { label: 'AI Agent', path: '/admin-settings/knowledge/ai-agent' },
  { label: 'AI Settings', path: '/admin-settings/knowledge/ai-settings' },
  { label: 'AI Receptionist', path: '/admin-settings/knowledge/ai-receptionist' },
  { label: 'Campaign', path: '/campaign/all-campaigns' },
  { label: 'Call Scripts', path: '/campaign/call-scripts' },
  { label: 'Leads', path: '/campaign/leads' },
  { label: 'Dispositions', path: '/campaign/dispositions' },
  { label: 'Campaign Logs', path: '/campaign/logs' },
  { label: 'DNC', path: '/campaign/dnc' },
  { label: 'My Account', path: '/admin-settings/account/basic-info' },
  { label: 'Profile', path: '/admin-settings/account/basic-info' },
  { label: 'Preferences', path: '/admin-settings/account/general' },
  { label: 'Notifications', path: '/admin-settings/account/notifications' },
  { label: 'Security Settings', path: '/admin-settings/account/security' },
  { label: 'Inbox', path: '/inbox' },
  { label: 'Greetings', path: '/greetings' },
  { label: 'Monitoring', path: '/monitoring/all-calls' },
  { label: 'Call Queue Monitoring', path: '/monitoring/call-queue' },
  { label: 'Department Monitoring', path: '/monitoring/department' },
  { label: 'Reports', path: '/reports/call-history' },
  { label: 'Call History', path: '/reports/call-history' },
  { label: 'Call Recording', path: '/reports/call-recording' },
  { label: 'Voicemail', path: '/reports/voicemail' },
  { label: 'Call Volume', path: '/reports/call-volume' },
  { label: 'SMS Logs', path: '/reports/sms-log' },
  { label: 'Integration', path: '/integration' },
  { label: 'Calendar', path: '/calendar' },
  { label: 'My Campaigns', path: '/my-campaigns' },
];

/**
 * Resolves an API result to a navigable path.
 * Handles parsing specific types according to project requirements.
 */
export function resolveApiResultPath(item: any): string {
  const id = item.id || item.raw?._id;

  switch (item.type?.toLowerCase()) {
    case 'campaign':
      return '/campaign/all-campaigns';
    case 'queue':
      return '/admin-settings/phone/queues';
    case 'department':
      return '/department/extension';
    case 'ivr':
      return '/admin-settings/phone/ivr';
    case 'meeting':
      return '/video';
    case 'user':
      return '/admin-settings/people';
    case 'lead':
      return '/campaign/leads';
    case 'page':
      return item.raw?.path || '/dashboard';
    default:
      return id ? `/dashboard?ref=${id}` : '/dashboard';
  }
}

/**
 * Filter searchable pages by query string (case-insensitive).
 * Deduplicates by path.
 */
export function filterPages(query: string): SearchablePage[] {
  if (!query.trim()) return [];
  const lower = query.toLowerCase();
  const seen = new Set<string>();
  return SEARCHABLE_PAGES.filter((page) => {
    if (seen.has(page.path)) return false;
    if (page.label.toLowerCase().includes(lower)) {
      seen.add(page.path);
      return true;
    }
    return false;
  });
}
