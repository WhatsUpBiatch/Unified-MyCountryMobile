type RouteImporter = () => Promise<unknown>;

interface RoutePrefetcher {
  prefix: string;
  importers: RouteImporter[];
}

const prefetchedRoutes = new Set<string>();

const normalizeRoutePath = (path?: string) => {
  if (!path || path === '#') return '';

  const [pathname] = path.split(/[?#]/);
  const normalized = pathname.replace(/\/+$/, '');

  return normalized || '/';
};

const matchesPrefix = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

const adminBase: RouteImporter[] = [() => import('@/pages/admin-settings')];
const reportsBase: RouteImporter[] = [() => import('@/pages/reports')];
const campaignBase: RouteImporter[] = [() => import('@/pages/auto-dialer')];
const monitoringBase: RouteImporter[] = [() => import('@/pages/monitoring')];
const departmentBase: RouteImporter[] = [() => import('@/pages/departments')];
const integrationBase: RouteImporter[] = [() => import('@/pages/integration')];

const withAdmin = (...importers: RouteImporter[]) => [...adminBase, ...importers];
const withReports = (...importers: RouteImporter[]) => [...reportsBase, ...importers];
const withCampaign = (...importers: RouteImporter[]) => [...campaignBase, ...importers];
const withMonitoring = (...importers: RouteImporter[]) => [...monitoringBase, ...importers];
const withDepartment = (...importers: RouteImporter[]) => [...departmentBase, ...importers];
const withIntegration = (...importers: RouteImporter[]) => [...integrationBase, ...importers];

const routePrefetchers: RoutePrefetcher[] = [
  {
    prefix: '/dashboard',
    importers: [() => import('@/pages/dashboard')],
  },
  {
    prefix: '/phone',
    importers: [() => import('@/pages/phone')],
  },
  {
    prefix: '/messenger',
    importers: [() => import('@/pages/messenger')],
  },
  {
    prefix: '/agent-chat',
    importers: [() => import('@/pages/agent-chat')],
  },
  {
    prefix: '/video',
    importers: [() => import('@/pages/video-meetings')],
  },
  {
    prefix: '/inbox',
    importers: [() => import('@/pages/inbox')],
  },
  {
    prefix: '/contact',
    importers: [() => import('@/pages/new-contact')],
  },
  {
    prefix: '/calendar',
    importers: [() => import('@/pages/video-meetings/Calender')],
  },
  {
    prefix: '/my-campaigns',
    importers: [() => import('@/components/running-campaign-outer/my-campaigns-list-standalone')],
  },
  {
    prefix: '/running-campaign',
    importers: [() => import('@/pages/auto-dialer/campaign/agent-running-campaign')],
  },
  {
    prefix: '/activity',
    importers: [() => import('@/pages/activity/user-activity')],
  },
  {
    prefix: '/department/extension',
    importers: withDepartment(() => import('@/pages/departments/users-list/user-details')),
  },
  {
    prefix: '/department/organization',
    importers: withDepartment(
      () => import('@/pages/departments/department-list/department-details'),
    ),
  },
  {
    prefix: '/department',
    importers: departmentBase,
  },
  {
    prefix: '/monitoring/call-queue',
    importers: withMonitoring(() => import('@/pages/monitoring/call-queue')),
  },
  {
    prefix: '/monitoring/campaign',
    importers: withMonitoring(() => import('@/pages/monitoring/call-queue')),
  },
  {
    prefix: '/monitoring/department',
    importers: withMonitoring(() => import('@/pages/monitoring/department')),
  },
  {
    prefix: '/monitoring/all-extensions',
    importers: withMonitoring(() => import('@/pages/monitoring/all-users')),
  },
  {
    prefix: '/monitoring/all-calls',
    importers: withMonitoring(() => import('@/pages/monitoring/all-calls')),
  },
  {
    prefix: '/monitoring',
    importers: monitoringBase,
  },
  {
    prefix: '/integration/data-reporting/zapier',
    importers: withIntegration(() => import('@/pages/integration/data-reporting/zapier')),
  },
  {
    prefix: '/integration/data-reporting/manage-webhook',
    importers: withIntegration(() => import('@/pages/integration/data-reporting/manage-webhook')),
  },
  {
    prefix: '/integration/data-reporting/general-settings',
    importers: withIntegration(() => import('@/pages/integration/data-reporting/general-settings')),
  },
  {
    prefix: '/integration',
    importers: withIntegration(() => import('@/pages/integration/crm')),
  },
  {
    prefix: '/admin-settings/people',
    importers: withAdmin(() => import('@/pages/directory/people')),
  },
  {
    prefix: '/admin-settings/roles',
    importers: withAdmin(() => import('@/pages/directory/roles')),
  },
  {
    prefix: '/admin-settings/phone/departments',
    importers: withAdmin(() => import('@/pages/directory/groups')),
  },
  {
    prefix: '/admin-settings/numbers/all',
    importers: withAdmin(() => import('@/pages/admin-settings/numbers/number-list')),
  },
  {
    prefix: '/admin-settings/numbers/in-use',
    importers: withAdmin(() => import('@/pages/admin-settings/numbers/number-list')),
  },
  {
    prefix: '/admin-settings/numbers/identities',
    importers: withAdmin(() => import('@/pages/admin-settings/numbers/identities-and-address-page-layout')),
  },
  {
    prefix: '/admin-settings/numbers/addresses',
    importers: withAdmin(() => import('@/pages/admin-settings/numbers/identities-and-address-page-layout')),
  },
  {
    prefix: '/admin-settings/numbers/verifications',
    importers: withAdmin(() => import('@/pages/admin-settings/numbers/identities-and-address-page-layout')),
  },
  {
    prefix: '/admin-settings/numbers/inventory',
    importers: withAdmin(() => import('@/pages/admin-settings/numbers/number-list')),
  },
  {
    prefix: '/admin-settings/phone/ivr',
    importers: withAdmin(() => import('@/pages/admin-settings/phone-systems/ivr-menus')),
  },
  {
    prefix: '/admin-settings/phone/queues',
    importers: withAdmin(() => import('@/pages/admin-settings/phone-systems/call-queue')),
  },
  {
    prefix: '/admin-settings/phone/shared-line',
    importers: withAdmin(() => import('@/pages/directory/groups')),
  },
  {
    prefix: '/admin-settings/knowledge/all-knowledge-base',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/all-knowledge-base')),
  },
  {
    prefix: '/admin-settings/knowledge/all-knowledge',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/all-knowledge-base/know-base-list')),
  },
  {
    prefix: '/admin-settings/knowledge/ai-agent',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/ai-agent/ai-chatbot-agents')),
  },
  {
    prefix: '/admin-settings/knowledge/ai-settings',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/AI-settings')),
  },
  {
    prefix: '/admin-settings/knowledge/playground',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/playground')),
  },
  {
    prefix: '/admin-settings/knowledge/ai-bot-session',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/ai-bot-session')),
  },
  {
    prefix: '/admin-settings/knowledge/ai-receptionist',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/ai-receptionist/new-ai-receptionist')),
  },
  {
    prefix: '/admin-settings/knowledge/domain',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/domain')),
  },
  {
    prefix: '/admin-settings/knowledge/create-agent',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/ai-agent/create-chatbot-agent')),
  },
  {
    prefix: '/admin-settings/knowledge/browse-templates',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/ai-agent/browse-templates-tabs')),
  },
  {
    prefix: '/admin-settings/knowledge/configure-ai-agent',
    importers: withAdmin(() => import('@/pages/admin-settings/knowledge-base/ai-agent/configure-ai-agent')),
  },
  {
    prefix: '/admin-settings/social-media-channels',
    importers: withAdmin(() => import('@/pages/admin-settings/social-media-channels')),
  },
  {
    prefix: '/admin-settings/templates/user-settings',
    importers: withAdmin(() => import('@/pages/admin-settings/templates/user-settings')),
  },
  {
    prefix: '/admin-settings/templates/call-handling',
    importers: withAdmin(() => import('@/pages/admin-settings/templates/call-handling')),
  },
  {
    prefix: '/admin-settings/calling-rates/outbound-rates',
    importers: withAdmin(() => import('@/pages/admin-settings/calling-rates/outbound-rates')),
  },
  {
    /* Its own entry so hovering the link loads the table rather than the card
       list. The longest matching prefix wins, so this beats the plain company
       one below whatever order they are written in. */
    prefix: '/admin-settings/company/location-management',
    importers: withAdmin(() => import('@/pages/admin-settings/company/location-management')),
  },
  {
    prefix: '/admin-settings/company',
    importers: withAdmin(() => import('@/pages/admin-settings/company')),
  },
  {
    prefix: '/admin-settings',
    importers: withAdmin(
      () => import('@/pages/admin-settings/admin-home'),
      () => import('@/pages/admin-settings/company'),
    ),
  },
  {
    prefix: '/admin-settings/account/profile',
    importers: withAdmin(() => import('@/pages/settings/basic-info')),
  },
  {
    prefix: '/admin-settings/account/preferences',
    importers: withAdmin(() => import('@/pages/settings/general')),
  },
  {
    prefix: '/admin-settings/account/video',
    importers: withAdmin(() => import('@/pages/settings/video')),
  },
  {
    prefix: '/admin-settings/account/phone',
    importers: withAdmin(() => import('@/pages/settings/phone')),
  },
  {
    prefix: '/admin-settings/account/notifications',
    importers: withAdmin(() => import('@/pages/settings/notification')),
  },
  {
    prefix: '/admin-settings/account/greetings',
    importers: withAdmin(() => import('@/pages/settings/greetings')),
  },
  {
    prefix: '/admin-settings/account/media',
    importers: withAdmin(() => import('@/pages/greetings/greetings-content')),
  },
  {
    prefix: '/admin-settings/account/security',
    importers: withAdmin(() => import('@/pages/settings/security')),
  },
  {
    prefix: '/admin-settings/account',
    importers: withAdmin(() => import('@/pages/settings/basic-info')),
  },
  {
    prefix: '/reports/local-call-list',
    importers: withReports(() => import('@/pages/reports/call-logs/local-call-list')),
  },
  {
    prefix: '/reports/call-recording',
    importers: withReports(() => import('@/pages/reports/call-logs/call-recording')),
  },
  {
    prefix: '/reports/voicemail',
    importers: withReports(() => import('@/pages/reports/call-logs/voicemail')),
  },
  {
    prefix: '/reports/call-volume',
    importers: withReports(() => import('@/pages/reports/call-logs/call-volumn')),
  },
  {
    prefix: '/reports/queue',
    importers: withReports(() => import('@/pages/reports/call-logs/queue')),
  },
  {
    prefix: '/reports/inbound',
    importers: withReports(() => import('@/pages/reports/call-logs/inbound')),
  },
  {
    prefix: '/reports/outbound',
    importers: withReports(() => import('@/pages/reports/call-logs/outbound')),
  },
  {
    prefix: '/reports/activity',
    importers: withReports(() => import('@/pages/reports/call-logs/activity')),
  },
  {
    prefix: '/reports/agent-reports',
    importers: withReports(() => import('@/pages/reports/call-logs/agentReports')),
  },
  {
    prefix: '/reports/sms-log',
    importers: withReports(() => import('@/pages/reports/sms-logs')),
  },
  {
    prefix: '/reports/analytics',
    importers: withReports(() => import('@/pages/reports/analytics')),
  },
  {
    prefix: '/reports/call-history',
    importers: withReports(() => import('@/pages/reports/call-logs/call-history')),
  },
  {
    prefix: '/reports',
    importers: withReports(() => import('@/pages/reports/call-logs/call-history')),
  },
  {
    prefix: '/campaign/all-campaigns/compaign-record',
    importers: withCampaign(() => import('@/pages/auto-dialer/campaign/campagin-summary')),
  },
  {
    prefix: '/campaign/all-campaigns/compaign-call-logs',
    importers: withCampaign(() => import('@/pages/auto-dialer/campaign/campaign-call-logs')),
  },
  {
    prefix: '/campaign/all-campaigns',
    importers: withCampaign(() => import('@/pages/auto-dialer/campaign')),
  },
  {
    prefix: '/campaign/call-scripts',
    importers: withCampaign(() => import('@/pages/auto-dialer/call-scripts')),
  },
  {
    prefix: '/campaign/leads/contact-logs',
    importers: withCampaign(() => import('@/pages/leads/lead-contact-logs')),
  },
  {
    prefix: '/campaign/leads',
    importers: withCampaign(() => import('@/pages/leads')),
  },
  {
    prefix: '/campaign/logs',
    importers: withCampaign(() => import('@/pages/auto-dialer/campaign-logs')),
  },
  {
    prefix: '/campaign/disposition-logs',
    importers: withCampaign(() => import('@/pages/auto-dialer/disposition-logs')),
  },
  {
    prefix: '/campaign/dispositions',
    importers: withCampaign(() => import('@/pages/auto-dialer/dispositions')),
  },
  {
    prefix: '/campaign/dnc',
    importers: withCampaign(() => import('@/pages/auto-dialer/dnc')),
  },
  {
    prefix: '/campaign',
    importers: withCampaign(() => import('@/pages/auto-dialer/power-predictive')),
  },
];

const getRouteImporters = (path: string) =>
  routePrefetchers
    .filter(({ prefix }) => matchesPrefix(path, prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.importers || [];

export const prefetchRoute = (path?: string) => {
  const routePath = normalizeRoutePath(path);
  if (!routePath || prefetchedRoutes.has(routePath)) return;

  const importers = getRouteImporters(routePath);
  if (!importers.length) return;

  prefetchedRoutes.add(routePath);
  void Promise.allSettled(importers.map((importer) => importer()));
};

export const getRoutePrefetchHandlers = (path?: string) => {
  const handlePrefetch = () => prefetchRoute(path);

  return {
    onFocus: handlePrefetch,
    onMouseDown: handlePrefetch,
    onMouseEnter: handlePrefetch,
    onTouchStart: handlePrefetch,
  };
};
