import { createBrowserRouter, Outlet, Navigate } from 'react-router-dom';
import { JitsiContextProvider } from '@/context/jitsi-context';
import { lazy } from 'react';
import ProtectedRoute from './protected-route';
import { SocketEventsProvider } from '@/context/socket-events-context';
import { QUEUE_TYPE } from '@/pages/monitoring/constants';
import VideoSection from '@/pages/meetings/video-section';



const AdminSettings = lazy(() => import('@/pages/admin-settings'));
const CompanyInfo = lazy(() => import('@/pages/admin-settings/company'));
/* Sits beside the location list rather than inside the settings sections: it is
   a view of the locations themselves, so it is guarded by the same location
   permission the list is, not by the phone-system one. */
const LocationManagement = lazy(() => import('@/pages/admin-settings/company/location-management'));
const CaptainPlayground = lazy(() => import('@/pages/admin-settings/captain/playground'));
const CaptainAssistants = lazy(() => import('@/pages/admin-settings/captain/assistants'));
const CaptainDocuments = lazy(() => import('@/pages/admin-settings/captain/documents'));
const CaptainFaqs = lazy(() => import('@/pages/admin-settings/captain/faqs'));
const CaptainScenarios = lazy(() => import('@/pages/admin-settings/captain/scenarios'));
const CaptainActions = lazy(() => import('@/pages/admin-settings/captain/actions'));
const CaptainInboxes = lazy(() => import('@/pages/admin-settings/captain/inboxes'));
const CaptainSettings = lazy(() => import('@/pages/admin-settings/captain/settings'));
const CompanyLayout = lazy(() => import('@/pages/admin-settings/company/company-layout'));
const CompanyPhoneRules = lazy(() => import('@/pages/admin-settings/company/page-phone-rules'));
const CompanyGreetings = lazy(() => import('@/pages/admin-settings/company/page-greetings'));
const CompanyVoicemailPage = lazy(() => import('@/pages/admin-settings/company/page-voicemail'));
const CompanyCalling = lazy(
  () => import('@/pages/admin-settings/company/company-calling-permissions'),
);
const CompanyHolidaysPage = lazy(() => import('@/pages/admin-settings/company/page-holidays'));
const CompanyEmergency = lazy(
  () => import('@/pages/admin-settings/company/company-emergency-address'),
);
const CompanyMessagingPage = lazy(() => import('@/pages/admin-settings/company/company-messaging'));
const CompanyPoliciesPage = lazy(() => import('@/pages/admin-settings/company/company-policies'));
const CompanySecurityPage = lazy(() => import('@/pages/admin-settings/company/company-security'));
const Dashboard = lazy(() => import('@/pages/dashboard'));
const Performance = lazy(() => import('@/pages/performance'));
const Login = lazy(() => import('@/pages/login'));
const Messenger = lazy(() => import('@/pages/messenger'));
// `/phone` renders the MCM Unified Console (three-zone phone console).
// The legacy page module stays in place — components/custom/contact-call-log-content
// and the activity lists still import LogContent / initialDrawerState from it,
// and the console itself renders that same call-log content in its History tab.
const Phone = lazy(() => import('@/pages/phone/console'));
// `/video-console` renders the MCM Unified Video console — the replacement for
// the current `/video` meetings hub, parked on its own path while it is
// reviewed. Flipping `/video` over to it is a one-line change here.
const VideoConsole = lazy(() => import('@/pages/video/console'));
const NewContact = lazy(() => import('@/pages/new-contact'));
const Directory = lazy(() => import('@/pages/directory'));
const ErrorPage = lazy(() => import('@/pages/error'));
const UserDepartment = lazy(() => import('@/pages/admin-settings/phone-systems/departments'));
const NumberList = lazy(() => import('@/pages/admin-settings/numbers/number-list'));
const IvrMenus = lazy(() => import('@/pages/admin-settings/phone-systems/ivr-menus'));
const Inbox = lazy(() => import('@/pages/inbox'));
const VideoMeetings = lazy(() => import('@/pages/video-meetings'));
const UpcomingMeetings = lazy(() => import('@/pages/video-meetings/upcoming-meetings'));
const PastMeetings = lazy(() => import('@/pages/video-meetings/past-meetings'));
const AllRecording = lazy(() => import('@/pages/video-meetings/recordings/all-recording'));
const MyRecording = lazy(() => import('@/pages/video-meetings/recordings/my-recording'));
const CallQueues = lazy(() => import('@/pages/admin-settings/phone-systems/call-queue'));
const GreetingDetailsPage = lazy(() => import('@/pages/greetings'));
const GreetingContent = lazy(() => import('@/pages/greetings/greetings-content'));
const BasicInfoSettings = lazy(() => import('@/pages/settings/basic-info'));
const General = lazy(() =>
  import('@/pages/settings/general').then((module) => ({ default: module.General })),
);
const SettingsVideo = lazy(() => import('@/pages/settings/video'));
const IncomingCalls = lazy(() => import('@/pages/settings/phone'));
const SettingsNotification = lazy(() => import('@/pages/settings/notification'));
const Greetings = lazy(() => import('@/pages/settings/greetings'));
const Monitoring = lazy(() => import('@/pages/monitoring'));
const CallQueueMonitoring = lazy(() => import('@/pages/monitoring/call-queue'));
const DepartmentMonitoring = lazy(() => import('@/pages/monitoring/department'));
const AllUserMonitoring = lazy(() => import('@/pages/monitoring/all-users'));

const SMSLogs = lazy(() => import('@/pages/reports/sms-logs'));
const Reports = lazy(() => import('@/pages/reports'));
const Departments = lazy(() => import('@/pages/departments'));
const DepartmentDetails = lazy(
  () => import('@/pages/departments/department-list/department-details'),
);
const UserDetails = lazy(() => import('@/pages/departments/users-list/user-details'));
const UserSettings = lazy(() => import('@/pages/admin-settings/templates/user-settings'));
const OutboundRates = lazy(() => import('@/pages/admin-settings/calling-rates/outbound-rates'));
const Destinations = lazy(() => import('@/pages/admin-settings/calling-rates/destinations'));
const CallHandling = lazy(() => import('@/pages/admin-settings/templates/call-handling'));
const Pricing = lazy(() => import('@/pages/pricing'));
const SignUp = lazy(() => import('@/pages/signup'));
const SignUpPayment = lazy(() => import('@/pages/signup/payment'));
const PaymentSuccess = lazy(() => import('@/pages/signup/payment-success'));
const PhoneLines = lazy(() => import('@/pages/signup/phone-lines'));
const AllCallMonitoring = lazy(() => import('@/pages/monitoring/all-calls'));
const RecordingDetails = lazy(() => import('@/pages/video-meetings/recordings/recording-details'));
const ForgotPassword = lazy(() => import('@/pages/login/forget-password'));
const ResetPassword = lazy(() => import('@/pages/login/reset-password'));
const AcceptInvite = lazy(() => import('@/pages/login/accept-invite'));
const SocialMediaChannels = lazy(() => import('@/pages/admin-settings/social-media-channels'));
const Integration = lazy(() => import('@/pages/integration'));
const CRMIntegration = lazy(() => import('@/pages/integration/crm'));
const CalendarPage = lazy(() => import('@/pages/video-meetings/Calender'));
const SharedWithMe = lazy(() => import('@/pages/video-meetings/recordings/shared-wth-me'));
const Zapier = lazy(() => import('@/pages/integration/data-reporting/zapier'));
const GeneralSettings = lazy(() => import('@/pages/integration/data-reporting/general-settings'));
const UserActivity = lazy(() => import('@/pages/activity/user-activity'));
const ManageWebhook = lazy(() => import('@/pages/integration/data-reporting/manage-webhook'));
const AutoDialer = lazy(() => import('@/pages/auto-dialer'));
const PowerDialer = lazy(() => import('@/pages/auto-dialer/power-predictive'));
const CallScripts = lazy(() => import('@/pages/auto-dialer/call-scripts'));
const DispositionsList = lazy(() => import('@/pages/auto-dialer/dispositions'));
const Leads = lazy(() => import('@/pages/leads'));
const CampaignRecord = lazy(() => import('@/pages/auto-dialer/campaign/campagin-summary'));
const CampaignCallLogs = lazy(() => import('@/pages/auto-dialer/campaign/campaign-call-logs'));
const Campaign = lazy(() => import('@/pages/auto-dialer/campaign'));
const AgentRunningCampign = lazy(
  () => import('@/pages/auto-dialer/campaign/agent-running-campaign'),
);
const ConfigureAiAgent = lazy(
  () => import('@/pages/admin-settings/knowledge-base/ai-agent/configure-ai-agent'),
);
const BrowseTemplates = lazy(
  () => import('@/pages/admin-settings/knowledge-base/ai-agent/browse-templates-tabs'),
);
const AiAgent = lazy(
  () => import('@/pages/admin-settings/knowledge-base/ai-agent/ai-chatbot-agents'),
);
const CreateAgent = lazy(
  () => import('@/pages/admin-settings/knowledge-base/ai-agent/create-chatbot-agent'),
);
const CampaignLogs = lazy(() => import('@/pages/auto-dialer/campaign-logs'));
const DispositionLogs = lazy(() => import('@/pages/auto-dialer/disposition-logs'));
const Security = lazy(() => import('@/pages/settings/security'));
const RenewPlan = lazy(() => import('@/pages/login/renew-plan'));
const VerifyAccessToken = lazy(() => import('@/pages/verify-access-token'));
const NoOrganization = lazy(() => import('@/pages/no-organization'));
const InvitedMeetings = lazy(() => import('@/pages/video-meetings/invited-meetings'));
const MyCampaignListStandalone = lazy(
  () => import('@/components/running-campaign-outer/my-campaigns-list-standalone'),
);
const LeadContactLogs = lazy(() => import('@/pages/leads/lead-contact-logs'));
const OngoingMeetings = lazy(() => import('@/pages/video-meetings/ongoing-meetings'));
const KnowledgeBaseList = lazy(
  () => import('@/pages/admin-settings/knowledge-base/all-knowledge-base/know-base-list'),
);
const AllKnowledgeBase = lazy(
  () => import('@/pages/admin-settings/knowledge-base/all-knowledge-base'),
);
const AISettings = lazy(() => import('@/pages/admin-settings/knowledge-base/AI-settings'));
const Playground = lazy(() => import('@/pages/admin-settings/knowledge-base/playground'));
const AIDomain = lazy(() => import('@/pages/admin-settings/knowledge-base/domain'));
const AiReceptionist = lazy(
  () => import('@/pages/admin-settings/knowledge-base/ai-receptionist/new-ai-receptionist'),
);
const IdentitiesAndAddressesPageLayout = lazy(
  () => import('@/pages/admin-settings/numbers/identities-and-address-page-layout'),
);
const DNC = lazy(() => import('@/pages/auto-dialer/dnc'));
const AdminHome = lazy(() => import('@/pages/admin-settings/admin-home'));
const CallCoverage = lazy(() => import('@/pages/admin-settings/call-coverage'));

/* Admin ▸ Users reuses the Directory screens rather than keeping a second,
   older implementation of the same lists. Same components, same actions. */
const DirectoryPeople = lazy(() => import('@/pages/directory/people'));
const DirectoryGroups = lazy(() => import('@/pages/directory/groups'));
const DirectoryRoles = lazy(() => import('@/pages/directory/roles'));
const AdminScope = lazy(() => import('@/pages/admin-settings/roles/admin-scope'));
const DefaultPermissions = lazy(() => import('@/pages/admin-settings/roles/default-permissions'));
const AccessControl = lazy(() => import('@/pages/admin-settings/roles/access-control'));
const CapabilityMatrix = lazy(() => import('@/pages/admin-settings/roles/capability-matrix'));
const AiBotSession = lazy(() => import('@/pages/admin-settings/knowledge-base/ai-bot-session'));
const CallHistory = lazy(() => import('@/pages/reports/call-logs/call-history'));
const LocalCallList = lazy(() => import('@/pages/reports/call-logs/local-call-list'));
const CallRecording = lazy(() => import('@/pages/reports/call-logs/call-recording'));
const Voicemail = lazy(() => import('@/pages/reports/call-logs/voicemail'));
const CallVolume = lazy(() => import('@/pages/reports/call-logs/call-volumn'));
const QueueCallLogs = lazy(() => import('@/pages/reports/call-logs/queue'));
const Inbound = lazy(() => import('@/pages/reports/call-logs/inbound'));
const Outbound = lazy(() => import('@/pages/reports/call-logs/outbound'));
const ActivityCallLogs = lazy(() => import('@/pages/reports/call-logs/activity'));
const AgentReports = lazy(() => import('@/pages/reports/call-logs/agentReports'));
const CallAnalytics = lazy(() => import('@/pages/reports/analytics'));
const ContactActivity = lazy(() => import('@/pages/new-contact/contact-activity'));
const AgentChatMessenger = lazy(() => import('@/pages/agent-chat'));
const OmniChannelConnect = lazy(() => import('@/pages/omni-channel-connect'));

const AuthProvider = lazy(() => import('@/auth/auth-provider'));
const AuthRemover = lazy(() => import('@/auth/auth-remover'));
const AuthLayout = lazy(() => import('@/layout/auth-layout'));
const PlanPendingGuard = lazy(() => import('@/auth/plan-pending-guard'));

export const router = createBrowserRouter([
  {
    path: '/no-organization',
    element: <NoOrganization />,
    id: 'no-organization',
  },
  {
    path: '/403',
    element: <ErrorPage text="Access Denied! You do not have permission to access this page. 😔" />,
    id: 'forbidden',
  },
  {
    path: '/',
    element: (
      <AuthRemover>
        <Outlet />
      </AuthRemover>
    ),
    errorElement: <ErrorPage text="Error Occurred 😔" />,
    children: [
      {
        index: true,
        element: <Login />,
        id: 'login',
      },
      {
        path: 'verify-access-token',
        element: <VerifyAccessToken />,
        id: 'verify-access-token',
      },
      {
        path: 'pricing',
        element: <Pricing />,
        id: 'pricing',
      },
      {
        path: 'sign-up',
        element: <SignUp />,
        id: 'sign-up',
      },
      {
        path: 'payment',
        element: <SignUpPayment />,
        id: 'payment',
      },
      {
        path: 'payment-success',
        element: <PaymentSuccess />,
        id: 'payment-success',
      },
      {
        path: 'phone-lines',
        element: <PhoneLines />,
        id: 'phone-lines',
      },
      {
        path: 'forgot-password',
        element: <ForgotPassword />,
      },
      {
        path: 'reset-password',
        element: <ResetPassword />,
      },
      {
        /* Public: a new person lands here from the invite e-mail. */
        path: 'accept-invite',
        element: <AcceptInvite />,
      },
      {
        path: 'renew-plan',
        element: <RenewPlan />,
      },
    ],
  },
  {
    path: '/phone-lines-auth',
    element: (
      <AuthProvider>
        <PhoneLines />
      </AuthProvider>
    ),
    id: 'phone-lines-authenticated',
  },
  {
    path: '/',
    element: (
      <PlanPendingGuard>
        <AuthProvider>
          <SocketEventsProvider>
            <JitsiContextProvider>
              <AuthLayout />
            </JitsiContextProvider>
          </SocketEventsProvider>
        </AuthProvider>
      </PlanPendingGuard>
    ),
    errorElement: <ErrorPage text="Error Occurred 😔" />,
    children: [
      {
        path: 'dashboard',
        element: <Dashboard />,
        id: 'Dashboard',
      },
      {
        path: 'performance',
        element: <Performance />,
        id: 'Performance',
      },
      {
        path: 'phone',
        element: <Phone />,
        id: 'Phone',
      },
      {
        path: 'video-console',
        element: (
          <ProtectedRoute
            element={<VideoConsole />}
            guard={{
              feature: 'video.IS_SHOW',
              permission: 'video.action.view',
            }}
          />
        ),
        id: 'VideoConsole',
      },
      {
        path: 'messenger',
        element: (
          <ProtectedRoute
            element={<Messenger />}
            guard={{
              feature: 'chat.IS_SHOW',
              permission: 'chat.action.view',
            }}
          />
        ),
        id: 'messenger',
      },
      {
        path: 'agent-chat',
        element: (
          <ProtectedRoute
            element={<AgentChatMessenger />}
            guard={{
              feature: 'ai.IS_SHOW',
              permission: 'ai.action.agent.view',
            }}
          />
        ),
        id: 'agent-chat',
      },
      {
        path: 'video',
        element: (
          <ProtectedRoute
            element={<VideoMeetings />}
            guard={{
              feature: 'video.IS_SHOW',
              permission: 'video.action.view',
            }}
          />
        ),
        id: 'meetings',
        children: [
          {
            index: true,
            element: <UpcomingMeetings />,
          },
          {
            path: 'ongoing-meetings',
            element: <OngoingMeetings />,
          },
          {
            path: 'invited-meetings',
            element: <InvitedMeetings />,
          },
          {
            path: 'past-meetings',
            element: <PastMeetings />,
          },
          {
            path: 'recordings',
            children: [
              {
                path: 'all',
                element: (
                  <ProtectedRoute
                    element={<AllRecording />}
                    guard={{
                      feature: 'video.access.RECORDING',
                      permission: 'video.access.RECORDING',
                    }}
                  />
                ),
              },
              {
                path: 'my',
                element: (
                  <ProtectedRoute
                    element={<MyRecording />}
                    guard={{
                      feature: 'video.access.RECORDING',
                      permission: 'video.access.RECORDING',
                    }}
                  />
                ),
              },
              {
                path: 'shared-with-me',
                element: (
                  <ProtectedRoute
                    element={<SharedWithMe />}
                    guard={{
                      feature: 'video.access.RECORDING',
                      permission: 'video.access.RECORDING',
                    }}
                  />
                ),
              },
            ],
          },
        ],
      },
      {
        // Directory is the console's grouping of People, Groups, Locations,
        // External and Favourites. The individual platform routes below stay
        // reachable so existing links keep working.
        path: 'directory',
        element: <Directory />,
        id: 'directory',
      },
      {
        path: 'contact',
        element: (
          <ProtectedRoute
            element={<NewContact />}
            guard={{
              feature: 'contact.IS_SHOW',
              permission: 'contact.action.view',
            }}
          />
        ),
        id: 'contact',
      },
      {
        path: 'contact-activity',
        element: (
          <ProtectedRoute
            element={<ContactActivity />}
            guard={{
              feature: 'contact.IS_SHOW',
              permission: 'contact.action.view',
            }}
          />
        ),
        id: 'contact-activity',
      },
      {
        path: 'department',
        element: <Departments />,
        children: [
          {
            path: 'extension',
            element: (
              <ProtectedRoute
                element={<UserDetails />}
                guard={{
                  permission: 'account_setting.access.USER.action.view',
                }}
              />
            ),
            children: [
              {
                index: true,
                path: ':id',
                element: <UserDetails />,
              },
            ],
          },
          {
            path: 'organization',
            children: [
              {
                path: ':id',
                element: (
                  <ProtectedRoute
                    element={<DepartmentDetails />}
                    guard={{
                      feature: 'phone_system_action.access.DEPARTMENT',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
            ],
          },
        ],
      },
      {
        path: 'admin-settings',
        element: <AdminSettings />,
        id: 'admin-settings',
        children: [
          {
            index: true,
            /* Admin opens on its own landing page now, rather than bouncing to
               whichever screen the person happened to have access to. */
            element: <AdminHome />,
            id: 'company-info-1',
          },
          {
            /* The company area. `company`, not `company-info`: the word a
              {
                /* The company area. `company`, not `company-info`: the word a
                   customer uses. Old paths redirect below.

                   The settings sections are children of a pathless layout route,
                   so each one is /admin-settings/company/<section> — the address
                   the sub-nav links to and the one people will bookmark. The
                   overview and the locations screens are siblings, outside that
                   layout, because they are not settings sections. */
            path: 'company',
            children: [
              {
                index: true,
                element: (
                  <ProtectedRoute
                    element={<CompanyInfo />}
                    guard={{ permission: 'account_setting.access.SITE.action.view' }}
                  />
                ),
              },
              {
                /* A location has its own address, so it can be linked to and
                       reloaded. The list and a single location render the same
                       screen; the id decides whether that location's panel opens. */
                path: 'locations',
                element: (
                  <ProtectedRoute
                    element={<CompanyInfo />}
                    guard={{ permission: 'account_setting.access.SITE.action.view' }}
                  />
                ),
              },
              {
                path: 'locations/:locationId',
                element: (
                  <ProtectedRoute
                    element={<CompanyInfo />}
                    guard={{ permission: 'account_setting.access.SITE.action.view' }}
                  />
                ),
              },
              {
                /* Every location in one table, for comparing and exporting.
                       The card list next door is still the place to read one
                       location; this is the place to run all of them. */
                path: 'location-management',
                element: (
                  <ProtectedRoute
                    element={<LocationManagement />}
                    guard={{ permission: 'account_setting.access.SITE.action.view' }}
                  />
                ),
              },
              {
                /* Each settings section is its own route rather than a tab held
                       in state. One screen, one URL: it can be linked to,
                       bookmarked, reloaded, and later given its own permission.

                       Phase 1 deliberately reuses the EXISTING permission strings.
                       A permission the backend does not return reads as "no
                       permission" and would lock every admin out, so a section
                       cannot get its own key until the API ships it. Security is
                       the exception and is tightened now, because today it opens
                       for anyone who can view the phone system. */
                element: (
                  <ProtectedRoute
                    element={<CompanyLayout />}
                    guard={{ permission: 'phone_system_action.action.view' }}
                  />
                ),
                children: [
                  { path: 'phone-rules', element: <CompanyPhoneRules /> },
                  { path: 'greetings', element: <CompanyGreetings /> },
                  { path: 'voicemail', element: <CompanyVoicemailPage /> },
                  { path: 'emergency-address', element: <CompanyEmergency /> },
                  { path: 'holidays', element: <CompanyHolidaysPage /> },
                  { path: 'calling', element: <CompanyCalling /> },
                  { path: 'messaging', element: <CompanyMessagingPage /> },
                  { path: 'policies', element: <CompanyPoliciesPage /> },
                  {
                    /* Administrator-only. It holds the sign-in policy, and the
                           phone-system permission is far too wide a key for that. */
                    path: 'security',
                    element: (
                      <ProtectedRoute
                        element={<CompanySecurityPage />}
                        guard={{ adminOnly: true }}
                        sectionName="Security"
                      />
                    ),
                  },
                ],
              },
            ],
          },
          {
            path: 'company-info',
            element: <Navigate to="/admin-settings/company" replace />,
          },
          {
            path: 'company-info/rules',
            element: <Navigate to="/admin-settings/company/policies" replace />,
          },
          {
            /* Integrations are set up once for the whole account, so they belong
               with the other administered settings rather than as a top-level
               destination of their own. */
            path: 'integration',
            id: 'admin-integration',
            /* Guarded at the parent, the way the top-level `/integration` twin
               below already is. Without an element of its own this subtree fell
               through to a bare Outlet, so every integration screen under Admin
               was reachable on a plan the sidebar hides the section for. */
            element: (
              <ProtectedRoute
                element={<Outlet />}
                guard={{
                  feature: 'integration.IS_SHOW',
                  permission: 'integration.action.view',
                }}
              />
            ),
            children: [
              { index: true, element: <CRMIntegration /> },
              { path: 'crm', element: <CRMIntegration /> },
              {
                path: 'data-reporting',
                element: <Outlet />,
                children: [
                  { index: true, element: <GeneralSettings /> },
                  { path: 'zapier', element: <Zapier /> },
                  { path: 'manage-webhook', element: <ManageWebhook /> },
                  { path: 'general-settings', element: <GeneralSettings /> },
                ],
              },
            ],
          },
          {
            /* The signed-in person's own settings. They used to be a separate
               top-level area with its own sidebar, reachable only from the
               avatar menu — which put personal settings and company settings in
               two different places. Nested here, they render inside the Admin
               shell alongside everything else you administer. */
            path: 'account',
            id: 'account',
            children: [
              /* `profile` and `preferences`: the words the navigation already
                 uses for these two screens. `basic-info` and `general` said
                 nothing and disagreed with their own labels. Old paths redirect. */
              { path: 'profile', element: <BasicInfoSettings /> },
              { path: 'preferences', element: <General /> },
              { path: 'phone', element: <IncomingCalls /> },
              { path: 'notifications', element: <SettingsNotification /> },
              /* Plural, like every other section. The singular stays as a
                 redirect because it is what the sidebar shipped with. */
              { path: 'notification', element: <Navigate to="../notifications" replace /> },
              {
                /* Video settings existed only under the old `/settings` tree, so
                   once the navigation moved to `/admin-settings/account` there
                   was no way to reach them. */
                path: 'video',
                element: (
                  <ProtectedRoute
                    element={<SettingsVideo />}
                    guard={{
                      feature: 'video.IS_SHOW',
                      permission: 'video.action.view',
                    }}
                  />
                ),
              },
              { path: 'basic-info', element: <Navigate to="../profile" replace /> },
              { path: 'general', element: <Navigate to="../preferences" replace /> },
              {
                path: 'greetings',
                element: (
                  <ProtectedRoute
                    element={<Greetings />}
                    guard={{ permission: 'settings.action.greeting.view' }}
                  />
                ),
              },
              {
                /* The media library moved to Phone System > Media Files
                   (`/admin-settings/phone/media`) on 3 Sep 2026: it is the
                   company's audio, not one person's. These paths are in
                   bookmarks and support articles, so every one of them still
                   lands on the same screen at its new address. The `type-`
                   slugs are the older spelling of the same three libraries. */
                path: 'media',
                element: <Outlet />,
                children: [
                  {
                    index: true,
                    element: <Navigate to="/admin-settings/phone/media" replace />,
                  },
                  {
                    path: 'greetings',
                    element: <Navigate to="/admin-settings/phone/media/greetings" replace />,
                  },
                  {
                    path: 'prompts',
                    element: <Navigate to="/admin-settings/phone/media/prompts" replace />,
                  },
                  {
                    path: 'voicemail',
                    element: <Navigate to="/admin-settings/phone/media/voicemail" replace />,
                  },
                  {
                    path: 'type-greeting',
                    element: <Navigate to="/admin-settings/phone/media/greetings" replace />,
                  },
                  {
                    path: 'type-prompt',
                    element: <Navigate to="/admin-settings/phone/media/prompts" replace />,
                  },
                  {
                    path: 'type-voicemail',
                    element: <Navigate to="/admin-settings/phone/media/voicemail" replace />,
                  },
                ],
              },
              { path: 'security', element: <Security /> },
            ],
          },
          {
            path: 'captain/playground',
            id: 'captain-playground',
            element: <CaptainPlayground />,
          },
          {
            path: 'captain/assistants',
            id: 'captain-assistants',
            element: <CaptainAssistants />,
          },
          {
            path: 'captain/documents',
            id: 'captain-documents',
            element: <CaptainDocuments />,
          },
          {
            path: 'captain/faqs',
            id: 'captain-faqs',
            element: <CaptainFaqs />,
          },
          {
            path: 'captain/scenarios',
            id: 'captain-scenarios',
            element: <CaptainScenarios />,
          },
          {
            path: 'captain/actions',
            id: 'captain-actions',
            element: <CaptainActions />,
          },
          {
            path: 'captain/inboxes',
            id: 'captain-inboxes',
            element: <CaptainInboxes />,
          },
          {
            path: 'captain/inboxes/:inboxId',
            id: 'captain-inbox-detail',
            element: <CaptainInboxes />,
          },
          {
            path: 'captain/inboxes/:inboxId/:tab',
            id: 'captain-inbox-detail-tab',
            element: <CaptainInboxes />,
          },
          {
            path: 'captain/settings',
            id: 'captain-settings',
            element: <CaptainSettings />,
          },
          {
            /* People, not "users/extension". An extension is a number a person
               happens to have; the screen is a list of people. */
            path: 'people',
            id: 'people',
            element: (
              <ProtectedRoute
                element={<DirectoryPeople />}
                guard={{
                  permission: 'account_setting.access.USER.action.view',
                }}
              />
            ),
          },
          {
            /* This page defines what every role in the company may do, and it
               carried no guard at all: `ProtectedRoute` returns its element
               unchanged when `guard` is undefined, so any signed-in person could
               open it. Administrator-only until the backend ships a permission
               key of its own — a key it does not return reads as "no permission"
               and would lock every admin out. */
            path: 'roles',
            id: 'roles',
            element: <ProtectedRoute element={<DirectoryRoles />} guard={{ adminOnly: true }} />,
          },
          {
            /* The front door to the four screens that decide access, and the
               only one that says what order they go in. */
            path: 'access-control',
            id: 'access-control',
            element: <ProtectedRoute element={<AccessControl />} guard={{ adminOnly: true }} />,
          },
          {
            /* The whole model on one page: every capability against every kind
               of person. Describes, saves nothing. */
            path: 'capability-matrix',
            id: 'capability-matrix',
            element: <ProtectedRoute element={<CapabilityMatrix />} guard={{ adminOnly: true }} />,
          },
          {
            /* Who each administrator covers, as opposed to what they may do.
               The account owner and account admins set scopes (the server
               refuses anybody else), so the gate is the people-edit box rather
               than owner-only; the screen itself is read-only for the rest. */
            path: 'admin-scope',
            id: 'admin-scope',
            element: (
              <ProtectedRoute
                element={<AdminScope />}
                guard={{ permission: 'account_setting.access.USER.action.edit' }}
              />
            ),
          },
          {
            /* What each kind of person should be able to do on their first day.
               Administrator-only for the same reason as the two above: it sets
               the shape of authority for everybody in the company. */
            path: 'default-permissions',
            id: 'default-permissions',
            element: (
              <ProtectedRoute element={<DefaultPermissions />} guard={{ adminOnly: true }} />
            ),
          },
          {
            /* Kept permanently: bookmarked, and linked from support articles. */
            path: 'users/extension',
            element: <Navigate to="/admin-settings/people" replace />,
          },
          {
            path: 'users/role',
            element: <Navigate to="/admin-settings/roles" replace />,
          },
          {
            path: 'users/department',
            element: <Navigate to="/admin-settings/phone/departments" replace />,
          },
          {
            path: 'numbers',
            id: 'numbers',
            children: [
              {
                /* Every sibling under `numbers` is gated on this permission.
                   This one was not wrapped at all. */
                path: 'coverage',
                id: 'numbers-coverage',
                element: (
                  <ProtectedRoute
                    element={<CallCoverage />}
                    guard={{
                      permission: 'virtual_numbers.action.view',
                    }}
                  />
                ),
              },
              {
                /* `/admin-settings/numbers` on its own is the list, so the
                   section has a home to link to. The three views below are the
                   same screen with a different filter. */
                index: true,
                element: <Navigate to="all" replace />,
              },
              {
                path: 'all',
                id: 'all',
                element: (
                  <ProtectedRoute
                    element={<NumberList />}
                    guard={{
                      permission: 'virtual_numbers.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'in-use',
                id: 'in-use',
                element: (
                  <ProtectedRoute
                    element={<NumberList />}
                    guard={{
                      permission: 'virtual_numbers.action.view',
                    }}
                  />
                ),
              },
              {
                /* Same numbers, gathered under the shared line each one rings.
                   A line does not store its numbers, so this is the only place
                   that relationship can be seen from the line's side. */
                path: 'by-line',
                id: 'by-line',
                element: (
                  <ProtectedRoute
                    element={<NumberList />}
                    guard={{
                      permission: 'virtual_numbers.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'identities',
                id: 'identities',
                element: (
                  <ProtectedRoute
                    element={<IdentitiesAndAddressesPageLayout />}
                    guard={{
                      permission: 'virtual_numbers.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'addresses',
                id: 'addresses',
                element: (
                  <ProtectedRoute
                    element={<IdentitiesAndAddressesPageLayout />}
                    guard={{
                      permission: 'virtual_numbers.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'verifications',
                id: 'verifications',
                element: (
                  <ProtectedRoute
                    element={<IdentitiesAndAddressesPageLayout />}
                    guard={{
                      permission: 'virtual_numbers.action.view',
                    }}
                  />
                ),
              },
              {
                /* The archive of numbers that have left the account. Served by
                   an endpoint that already existed and was never called. */
                path: 'released',
                id: 'released',
                element: (
                  <ProtectedRoute
                    element={<NumberList />}
                    guard={{
                      permission: 'virtual_numbers.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'inventory',
                id: 'inventory',
                element: (
                  <ProtectedRoute
                    element={<NumberList />}
                    guard={{
                      permission: 'virtual_numbers.action.view',
                    }}
                  />
                ),
              },
            ],
          },
          {
            path: 'phone',
            id: 'phone',
            children: [
              {
                /* Kept permanently. The company rules moved out of Phone System
                   into Company, where an admin looks for them, but this path is
                   bookmarked and linked from support articles. */
                path: 'preferences',
                element: <Navigate to="/admin-settings/company/policies" replace />,
              },
              {
                /* Same shape as queues: the list is always rendered and the id
                   decides whether the editor opens over it. */
                path: 'ivr',
                id: 'ivr',
                element: (
                  <ProtectedRoute
                    element={<IvrMenus />}
                    guard={{
                      feature: 'phone_system_action.access.IVR',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'ivr/new',
                element: (
                  <ProtectedRoute
                    element={<IvrMenus />}
                    guard={{
                      feature: 'phone_system_action.access.IVR',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'ivr/:ivrId',
                element: (
                  <ProtectedRoute
                    element={<IvrMenus />}
                    guard={{
                      feature: 'phone_system_action.access.IVR',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'ivr/:ivrId/:tab',
                element: (
                  <ProtectedRoute
                    element={<IvrMenus />}
                    guard={{
                      feature: 'phone_system_action.access.IVR',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'ivr-menus',
                element: <Navigate to="/admin-settings/phone/ivr" replace />,
              },
              {
                /* The company's audio library — IVR prompts, greetings,
                   voicemail — beside the menus that play it. Moved here from
                   My Account > Media Files; the old address redirects. Not
                   wrapped in a phone-system guard on purpose: the old route
                   had none, and the screen's own greeting permission already
                   decides who may add or delete. `?mine=1` narrows the list
                   to files the signed-in person added, so My Account >
                   Greetings can open it on their own files. */
                path: 'media',
                element: <Outlet />,
                children: [
                  { index: true, element: <GreetingContent /> },
                  { path: 'greetings', element: <GreetingContent /> },
                  { path: 'prompts', element: <GreetingContent /> },
                  { path: 'voicemail', element: <GreetingContent /> },
                  { path: 'type-greeting', element: <Navigate to="../greetings" replace /> },
                  { path: 'type-prompt', element: <Navigate to="../prompts" replace /> },
                  { path: 'type-voicemail', element: <Navigate to="../voicemail" replace /> },
                ],
              },
              {
                /* A queue, and the tab inside it, each have their own address.
                   All four paths render the same screen: the list is always
                   there, and the id decides whether the editor opens over it.

                   Phase 1 deliberately keeps the EXISTING permission key. A
                   permission the backend does not return reads as "no
                   permission" and would lock every admin out, so a queue tab
                   cannot get its own key until the API ships one. */
                path: 'queues',
                id: 'queues',
                element: (
                  <ProtectedRoute
                    element={<CallQueues />}
                    guard={{
                      feature: 'phone_system_action.access.QUEUE',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'queues/new',
                element: (
                  <ProtectedRoute
                    element={<CallQueues />}
                    guard={{
                      feature: 'phone_system_action.access.QUEUE',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'queues/:queueId',
                element: (
                  <ProtectedRoute
                    element={<CallQueues />}
                    guard={{
                      feature: 'phone_system_action.access.QUEUE',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'queues/:queueId/:tab',
                element: (
                  <ProtectedRoute
                    element={<CallQueues />}
                    guard={{
                      feature: 'phone_system_action.access.QUEUE',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
              {
                /* Kept for good. Admins bookmark these screens and support
                   articles link to them. */
                path: 'call-queue',
                element: <Navigate to="/admin-settings/phone/queues" replace />,
              },
              {
                /* A department is a group calls are routed to, not a kind of
                   person. It sat under People while being gated on a
                   phone-system permission; now it sits with the other routing
                   groups it belongs beside. */
                path: 'departments',
                id: 'departments',
                element: (
                  <ProtectedRoute
                    element={<DirectoryGroups />}
                    guard={{
                      feature: 'phone_system_action.access.DEPARTMENT',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'shared-line',
                element: (
                  <ProtectedRoute
                    element={<UserDepartment />}
                    guard={{
                      feature: 'phone_system_action.access.DEPARTMENT',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
            ],
          },

          {
            path: 'knowledge',
            id: 'knowledge',
            children: [
              {
                path: 'all-knowledge',
                id: 'all-knowledge',
                element: (
                  <ProtectedRoute
                    element={<KnowledgeBaseList />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.action.knowledge_base.view',
                    }}
                  />
                ),
              },
              {
                path: 'all-knowledge-base',
                id: 'all-knowledge-base',
                element: (
                  <ProtectedRoute
                    element={<AllKnowledgeBase />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.action.knowledge_base.view',
                    }}
                  />
                ),
              },
              {
                path: 'ai-agent',
                element: (
                  <ProtectedRoute
                    element={<AiAgent />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.action.agent.view',
                    }}
                  />
                ),
              },
              {
                path: 'ai-settings',
                element: (
                  <ProtectedRoute
                    element={<AISettings />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.IS_SHOW',
                    }}
                  />
                ),
              },
              {
                path: 'playground',
                element: (
                  <ProtectedRoute
                    element={<Playground />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.IS_SHOW',
                    }}
                  />
                ),
              },
              {
                path: 'ai-bot-session',
                element: (
                  <ProtectedRoute
                    element={<AiBotSession />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.IS_SHOW',
                    }}
                  />
                ),
              },
              {
                path: 'ai-receptionist',
                element: (
                  <ProtectedRoute
                    element={<AiReceptionist />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.IS_SHOW',
                    }}
                  />
                ),
              },
              {
                path: 'domain',
                element: (
                  <ProtectedRoute
                    element={<AIDomain />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.action.domain.view',
                    }}
                  />
                ),
              },
              {
                path: 'create-agent',
                element: (
                  <ProtectedRoute
                    element={<CreateAgent />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.action.agent.view',
                    }}
                  />
                ),
              },

              {
                path: 'browse-templates',
                element: (
                  <ProtectedRoute
                    element={<BrowseTemplates />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.action.agent.view',
                    }}
                  />
                ),
              },
              {
                path: 'configure-ai-agent',
                element: (
                  <ProtectedRoute
                    element={<ConfigureAiAgent />}
                    guard={{
                      feature: 'ai.IS_SHOW',
                      permission: 'ai.action.agent.view',
                    }}
                  />
                ),
              },
            ],
          },
          {
            path: 'social-media-channels',
            element: (
              <ProtectedRoute
                element={<SocialMediaChannels />}
                guard={{
                  feature: 'omni_channel.IS_SHOW',
                  permission: 'omni_channel.action.view',
                }}
              />
            ),
          },
          {
            path: 'templates',
            children: [
              {
                index: true,
                path: 'user-settings',
                element: <ProtectedRoute element={<UserSettings />} guard={{ adminOnly: true }} />,
              },
              {
                path: 'call-handling',
                element: (
                  <ProtectedRoute
                    element={<CallHandling />}
                    guard={{
                      feature: 'phone_system_action.access.DEPARTMENT',
                      permission: 'phone_system_action.action.view',
                    }}
                  />
                ),
              },
            ],
          },
          {
            path: 'calling-rates',
            id: 'calling-rates',
            children: [
              {
                index: true,
                path: 'outbound-rates',
                id: 'outbound-rates',
                element: (
                  <ProtectedRoute
                    element={<OutboundRates />}
                    guard={{
                      feature: 'calling_rates.IS_SHOW',
                      permission: 'calling_rates.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'destinations',
                id: 'destinations',
                element: (
                  <ProtectedRoute
                    element={<Destinations />}
                    guard={{
                      feature: 'calling_rates.IS_SHOW',
                      permission: 'calling_rates.action.view',
                    }}
                  />
                ),
              },
            ],
          },
        ],
      },
      {
        path: 'campaign',
        element: <AutoDialer />,
        children: [
          {
            path: 'all-campaigns',
            element: <Outlet />,
            children: [
              {
                index: true,
                element: (
                  <ProtectedRoute
                    element={<Campaign />}
                    guard={{
                      feature: 'campaign.IS_SHOW',
                      permission: 'campaign.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'compaign-record',
                element: (
                  <ProtectedRoute
                    element={<CampaignRecord />}
                    guard={{
                      feature: 'campaign.IS_SHOW',
                      permission: 'campaign.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'compaign-call-logs',
                element: (
                  <ProtectedRoute
                    element={<CampaignCallLogs />}
                    guard={{
                      feature: 'campaign.IS_SHOW',
                      permission: 'campaign.action.view',
                    }}
                  />
                ),
              },
            ],
          },
          {
            path: 'call-scripts',
            id: 'call-scripts',
            element: (
              <ProtectedRoute
                element={<CallScripts />}
                guard={{
                  feature: 'campaign.IS_SHOW',
                  permission: 'campaign.action.view',
                }}
              />
            ),
          },
          {
            path: 'leads',
            element: <Outlet />,
            children: [
              {
                index: true,
                element: (
                  <ProtectedRoute
                    element={<Leads />}
                    guard={{
                      feature: 'campaign.IS_SHOW',
                      permission: 'campaign.action.view',
                    }}
                  />
                ),
              },
              {
                path: 'contact-logs',
                element: (
                  <ProtectedRoute
                    element={<LeadContactLogs />}
                    guard={{
                      feature: 'campaign.IS_SHOW',
                      permission: 'campaign.action.view',
                    }}
                  />
                ),
              },
            ],
          },
          {
            path: 'logs',
            element: (
              <ProtectedRoute
                element={<CampaignLogs />}
                guard={{
                  feature: 'campaign.IS_SHOW',
                  permission: 'campaign.action.view',
                }}
              />
            ),
          },
          {
            path: 'disposition-logs',
            element: (
              <ProtectedRoute
                element={<DispositionLogs />}
                guard={{
                  feature: 'campaign.IS_SHOW',
                  permission: 'campaign.action.view',
                }}
              />
            ),
          },
          {
            path: 'dispositions',
            element: (
              <ProtectedRoute
                element={<DispositionsList />}
                guard={{
                  feature: 'campaign.IS_SHOW',
                  permission: 'campaign.action.view',
                }}
              />
            ),
          },
          {
            /* Every sibling campaign route passes a guard; this one did not, and
               ProtectedRoute returns the element unconditionally when `guard` is
               undefined. So /campaign/<anything> rendered the dialer while
               bypassing both the plan-feature check and the view permission. */
            path: ':type?',
            element: (
              <ProtectedRoute
                element={<PowerDialer />}
                guard={{
                  feature: 'campaign.IS_SHOW',
                  permission: 'campaign.action.view',
                }}
              />
            ),
          },
          {
            path: 'dnc',
            element: (
              <ProtectedRoute
                element={<DNC />}
                guard={{
                  feature: 'campaign.IS_SHOW',
                  permission: 'campaign.action.view',
                }}
              />
            ),
          },
        ],
      },

      {
        path: 'settings',
        /* These screens are the same components rendered under
           `/admin-settings/account`, which is where the navigation points and
           where they sit inside the Admin shell. Two live URLs for one screen
           meant Video existed only here and so had no navigation at all, and a
           person following an old link landed outside the shell they had just
           been in. Redirected rather than deleted: these paths are bookmarked
           and are linked from support articles. */
        children: [
          { index: true, element: <Navigate to="/admin-settings/account/profile" replace /> },
          {
            path: 'basic-info',
            element: <Navigate to="/admin-settings/account/profile" replace />,
          },
          {
            path: 'general',
            element: <Navigate to="/admin-settings/account/preferences" replace />,
          },
          { path: 'video', element: <Navigate to="/admin-settings/account/video" replace /> },
          { path: 'phone', element: <Navigate to="/admin-settings/account/phone" replace /> },
          {
            path: 'notification',
            element: <Navigate to="/admin-settings/account/notifications" replace />,
          },
          {
            path: 'greetings',
            element: <Navigate to="/admin-settings/account/greetings" replace />,
          },
          {
            path: 'media',
            children: [
              { index: true, element: <Navigate to="/admin-settings/account/media" replace /> },
              {
                path: 'type-greeting',
                element: <Navigate to="/admin-settings/account/media/greetings" replace />,
              },
              {
                path: 'type-prompt',
                element: <Navigate to="/admin-settings/account/media/prompts" replace />,
              },
              {
                path: 'type-voicemail',
                element: <Navigate to="/admin-settings/account/media/voicemail" replace />,
              },
            ],
          },
          {
            path: 'security',
            element: <Navigate to="/admin-settings/account/security" replace />,
          },
        ],
      },
      {
        /* Plain, not wrapped in ProtectedRoute. ProtectedRoute checks
           `guard?.feature`, `guard?.permission` and `guard?.adminOnly`, so a
           wrapper with no guard object checks nothing at all — it reads as a
           lock and is not one. Twelve routes carried that empty wrapper. None
           was an open hole: ten sat under /reports, which guards its children,
           and this one and account/phone are a person's own inbox and own phone
           settings, which everybody should reach. They are unwrapped rather than
           given guards so that a ProtectedRoute in this file always means a real
           check, and an empty one is never mistaken for protection again. */
        path: 'inbox',
        element: <Inbox />,
        id: 'inbox',
      },
      {
        path: 'greetings',
        element: <GreetingDetailsPage />,
        children: [
          {
            index: true,
            element: <GreetingContent />,
          },
          /* Same slugs as under My Account > Media Files. This area's own
             sidebar links to them, so without these three the tabs led nowhere. */
          { path: 'greetings', element: <GreetingContent /> },
          { path: 'prompts', element: <GreetingContent /> },
          { path: 'voicemail', element: <GreetingContent /> },
          /* Kept for good — these are in bookmarks. */
          { path: 'type-greeting', element: <Navigate to="../greetings" replace /> },
          { path: 'type-prompt', element: <Navigate to="../prompts" replace /> },
          { path: 'type-voicemail', element: <Navigate to="../voicemail" replace /> },
        ],
      },
      {
        path: 'monitoring',
        element: (
          <ProtectedRoute
            element={<Monitoring />}
            guard={{
              permission: 'monitoring.action.view',
            }}
          />
        ),
        children: [
          {
            path: 'call-queue',
            element: (
              <ProtectedRoute
                element={<CallQueueMonitoring queueType={QUEUE_TYPE.queue} />}
                guard={{
                  feature: 'phone_system_action.access.QUEUE',
                  permission: 'phone_system_action.action.view',
                }}
              />
            ),
          },
          {
            path: 'campaign',
            element: (
              <ProtectedRoute
                element={<CallQueueMonitoring queueType={QUEUE_TYPE.campaign} />}
                guard={{
                  feature: 'campaign.IS_SHOW',
                  permission: 'campaign.action.view',
                }}
              />
            ),
          },
          {
            path: 'department',
            element: (
              <ProtectedRoute
                element={<DepartmentMonitoring />}
                guard={{
                  feature: 'phone_system_action.access.DEPARTMENT',
                  permission: 'phone_system_action.action.view',
                }}
              />
            ),
          },
          {
            path: 'all-extensions',
            element: (
              <ProtectedRoute
                element={<AllUserMonitoring />}
                guard={{
                  permission: 'monitoring.action.view',
                }}
              />
            ),
          },
          {
            path: 'all-calls',
            element: (
              <ProtectedRoute
                element={<AllCallMonitoring />}
                guard={{
                  permission: 'monitoring.action.view',
                }}
              />
            ),
          },
        ],
      },
      {
        path: 'reports',
        element: (
          <ProtectedRoute
            element={<Reports />}
            guard={{
              feature: 'reports.IS_SHOW',
              permission: 'reports.IS_SHOW',
            }}
          />
        ),
        children: [
          {
            index: true,
            element: <Navigate to="call-history" replace />,
          },
          {
            path: 'call-history',
            element: <CallHistory />,
          },
          {
            path: 'local-call-list',
            element: <LocalCallList />,
          },
          {
            path: 'call-recording',
            element: (
              <ProtectedRoute
                element={<CallRecording />}
                guard={{
                  feature: 'reports.IS_SHOW',
                  permission: 'reports.action.call_recording_listen',
                }}
              />
            ),
          },
          {
            path: 'voicemail',
            element: <Voicemail />,
          },
          {
            path: 'call-volume',
            element: <CallVolume />,
          },
          {
            path: 'queue',
            element: <QueueCallLogs />,
          },
          {
            path: 'inbound',
            element: <Inbound />,
          },
          {
            path: 'outbound',
            element: <Outbound />,
          },
          {
            path: 'activity',
            element: <ActivityCallLogs />,
          },
          {
            path: 'agent-reports',
            element: <AgentReports />,
          },
          {
            path: 'sms-log',
            element: (
              <ProtectedRoute
                element={<SMSLogs />}
                guard={{
                  feature: 'reports.IS_SHOW',
                  permission: 'reports.action.sms',
                }}
              />
            ),
          },
          {
            path: 'analytics',
            element: <CallAnalytics />,
          },
        ],
      },
      {
        path: 'integration',
        element: (
          <ProtectedRoute
            element={<Integration />}
            guard={{
              feature: 'integration.IS_SHOW',
              permission: 'integration.action.view',
            }}
          />
        ),
        children: [
          {
            index: true,
            element: <CRMIntegration />,
          },
          {
            path: 'data-reporting',
            children: [
              {
                path: 'zapier',
                element: <Zapier />,
              },
              {
                path: 'manage-webhook',
                element: <ManageWebhook />,
              },
              {
                path: 'general-settings',
                element: <GeneralSettings />,
              },
            ],
          },
        ],
      },
      {
        path: 'activity/:id',
        element: <UserActivity />,
        id: 'UserActivity',
      },
      // {
      //   path: 'activity',
      //   element: <Outlet />,
      //   children: [
      //     {
      //       index: true,
      //       element: <Activity />,
      //       id: 'Activity',
      //     },
      //     {
      //       path: ':id',
      //       element: <UserActivity />,
      //       id: 'UserActivity',
      //     },
      //   ],
      // },
      {
        path: 'running-campaign',
        element: <AgentRunningCampign />,
      },
      {
        path: 'my-campaigns',
        element: <MyCampaignListStandalone />,
      },
      {
        path: 'calendar',
        element: <CalendarPage />,
      },
    ],
  },
  {
    path: 'recording-details',
    element: <RecordingDetails />,
    id: 'recording-details',
  },
  {
    path: 'omni-channel-connect',
    element: (
      <PlanPendingGuard>
        <AuthProvider>
          <SocketEventsProvider>
            <AuthLayout />
          </SocketEventsProvider>
        </AuthProvider>
      </PlanPendingGuard>
    ),
    id: 'omni-channel-connect',
    children: [
      {
        path: '',
        element: <AdminSettings />,
        children: [
          {
            index: true,
            element: <OmniChannelConnect />,
          },
        ],
      },
    ],
  },
  {
    path: 'video-meet',
    element: (
      <SocketEventsProvider>
        <JitsiContextProvider>
          <VideoSection />
        </JitsiContextProvider>
      </SocketEventsProvider>
    ),
    id: 'video-meet',
  },
  {
    path: '*',
    element: <ErrorPage text="Page Not Found! 😔" />,
  },
],
  {
    /* Vite rewrites BASE_URL to whatever `base` the build used: "/" for the
       normal build, "/Unified-MyCountryMobile/" for a GitHub Pages one, which
       serves a project site from a sub-path rather than the domain root.
       Without this the router would look for "/dashboard" on a site whose
       routes all live under "/Unified-MyCountryMobile/dashboard". */
    basename: import.meta.env.BASE_URL,
  },
);
