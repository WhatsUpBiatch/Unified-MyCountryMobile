import {
  ActivityIcon,
  Bell,
  CalendarIcon,
  // CloseIcon,
  Headphones,
  Monitor,
  // PauseCircle,
} from '@/assets/icons';
import { useUser } from '@/hooks/use-user';
import { useDialpad } from '@/hooks/use-dialpad';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CustomAvatar from '../custom-avatar';
import CompanyLogoMark from '../company-logo-mark';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useSocketEvents } from '@/hooks/use-socket-events';
import SideDrawer from '../side-drawer';
import ChangePassword from '@/pages/change-password';
import CustomTooltip from '../custom-tooltip';
import { useCompanyFeatures } from '@/hooks/rbac';
import AvatarContent from './AvatarContent';
import NotificationContent from './NotificationContent';
// import { useCampaign } from '@/hooks/use-campaign';
import GlobalSearch from './GlobalSearch';
import AreaNav from '@/components/custom/area-nav';
import ThemeToggle from '@/components/custom/theme-toggle';
import { useOrganization } from '@/hooks/use-organisation';
import PendingChatRequestsDrawer from './PendingChatRequestsDrawer';
import { List, Menu, Plus, Wallet, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getEnv, SESSION_NAME } from '@/lib/utils';
import { DASHBOARDCONST } from '@/pages/dashboard/constant';
import AlertConfirm from '../alert-confirm';
import { toast } from 'react-toastify';
import { getRoutePrefetchHandlers, prefetchRoute } from '@/router/route-prefetch';

const Header = () => {
  const { user, handleRemoveUser } = useUser();
  const { mainSiteInfo } = useOrganization();
  // The organisation context is loosely typed; name the two fields the brand
  // block reads rather than widening the shared context type.
  const siteBrand = (mainSiteInfo || {}) as { site_name?: string; company_name?: string };
  const queryClient = useQueryClient();
  const ACTIVE_PATH = {
    CALENDAR: 'calendar',
    RUNNING_CAMPAIGN: 'running-campaign',
    ACTIVITY: user?.user_info?.uuid,
    ALL_CALLS: 'all-calls',
    BASIC_INFO: 'basic-info',
  };
  const {
    activeCampaign,
    setActiveCampaign,
    setCampaignContactCards,
    campaignClearingSecondsLeft,
    sessions,
  } = useDialpad();
  const {
    unreadCount = 0,
    unreadTaskCount = 0,
    userLogoutData,
    disconnectSocket,
    socketEventsManager,
  } = useSocketEvents();

  const [notificationState, setNotificationState] = useState<any>(false);
  const [pendingChatState, setPendingChatState] = useState<boolean>(false);
  const [forceLogoutOpen, setForceLogoutOpen] = useState(false);
  const [profileState, setProfileState] = useState<
    'profile' | 'changePassword' | 'notification' | null
  >(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isQuickMenuOpen, setIsQuickMenuOpen] = useState(false);
  const [walletUpdatedAmount, setWalletUpdatedAmount] = useState<number | null>(null);
  const navigate = useNavigate();
  const { pathname = '' } = useLocation();
  const [searchParams] = useSearchParams();
  const activePath = pathname?.split('/')?.pop();
  const currentView = searchParams.get('view') || 'calendar';
  const companyAmount = user?.company_info?.amount;
  const totalFunds =
    companyAmount !== null && companyAmount !== undefined ? `$${companyAmount}` : '00.00';
  const resolvedFundsDisplay =
    walletUpdatedAmount !== null && walletUpdatedAmount !== undefined
      ? `$${walletUpdatedAmount}`
      : totalFunds;
  const role =
    user?.user_info?.custom_role_data?.name ||
    user?.user_info?.role_data?.name ||
    user?.user_info?.role ||
    'User';
  const hasActiveCampaign = Boolean(activeCampaign && Object.keys(activeCampaign).length);
  const activeCampaignName = String(activeCampaign?.name || '').trim() || 'Campaign Running';
  const isCampaignClearing = campaignClearingSecondsLeft > 0;
  const campaignSystemEventsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasAnyActiveDialpadSession = useMemo(
    () =>
      Object.values(sessions || {}).some((sessionItem: any) => {
        const sessionStatus = String(sessionItem?.status || '').toLowerCase();
        return sessionStatus && !['ended', 'failed'].includes(sessionStatus);
      }),
    [sessions],
  );
  const hasAnyActiveDialpadSessionRef = useRef(hasAnyActiveDialpadSession);

  const { features } = useCompanyFeatures();
  const monitoringAccess = features?.plan_features?.monitoring?.action || {};
  const campaignAccess = features?.plan_features?.campaign?.IS_SHOW;
  const taskRoute = '/calendar?view=task-list';
  const calendarRoute = '/calendar?view=calendar';
  const myCampaignsRoute = '/my-campaigns';
  const activityRoute = user?.user_info?.uuid ? `/activity/${user.user_info.uuid}` : undefined;
  const monitoringRoute =
    role !== 'ADMIN' || !monitoringAccess?.view
      ? '/monitoring/department'
      : '/monitoring/all-calls';
  const addFundsRoute = '/admin-settings/billing/purchase';
  // const { isCampaignCall, isStartCampaign, selectedCampaign, setIsStopCampaign, isStopCampaign } =
  //   useCampaign();

  const navigateToLazyRoute = useCallback(
    (route?: string) => {
      if (!route) return;

      prefetchRoute(route);
      navigate(route, { flushSync: true });
      setIsMobileMenuOpen(false);
    },
    [navigate],
  );

  const getHeaderRouteHandlers = useCallback(
    (route?: string) => ({
      ...getRoutePrefetchHandlers(route),
      onClick: () => navigateToLazyRoute(route),
    }),
    [navigateToLazyRoute],
  );

  const clearCampaignSystemEventsInterval = useCallback(() => {
    if (campaignSystemEventsIntervalRef.current) {
      clearInterval(campaignSystemEventsIntervalRef.current);
      campaignSystemEventsIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    hasAnyActiveDialpadSessionRef.current = hasAnyActiveDialpadSession;
  }, [hasAnyActiveDialpadSession]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsQuickMenuOpen(false);
  }, [pathname]);

  // A fan-out that stays open once the pointer leaves it feels stuck, and it
  // overlays the page, so dismiss on outside click and on Escape.
  useEffect(() => {
    if (!isQuickMenuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('.hdr-quick-wrap')) return;
      setIsQuickMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsQuickMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isQuickMenuOpen]);

  useEffect(() => {
    const logoutUuid = userLogoutData?.uuid;
    const deviceToken = user?.device_token;

    if (!logoutUuid || !deviceToken) return;

    if (logoutUuid === deviceToken) {
      if (typeof window !== 'undefined') {
        (window as any).isSessionTerminated = true;
      }
      toast.dismiss();
      disconnectSocket();
      localStorage.removeItem(SESSION_NAME);
      localStorage.removeItem(DASHBOARDCONST?.dashboardType);
      setForceLogoutOpen(true);
    }
  }, [userLogoutData, user, disconnectSocket]);

  useEffect(() => {
    const handleUnauthorized = () => {
      if (typeof window !== 'undefined') {
        (window as any).isSessionTerminated = true;
      }
      toast.dismiss();
      setForceLogoutOpen(true);
    };

    window.addEventListener('unauthorized-session', handleUnauthorized);
    return () => {
      window.removeEventListener('unauthorized-session', handleUnauthorized);
    };
  }, []);

  useEffect(() => {
    const campaignId = String(
      activeCampaign?._id || activeCampaign?.campaignId || activeCampaign?.id || '',
    ).trim();
    const campaignDialMethod = String(
      activeCampaign?.dialMethod || activeCampaign?.campaignType || '',
    )
      .trim()
      .toUpperCase();
    const isPredictiveCampaign = campaignDialMethod.includes('PREDICTIVE');
    const campaignStatus = String(
      activeCampaign?.manualStatus ||
        activeCampaign?.campaignStatus ||
        activeCampaign?.status ||
        '',
    )
      .trim()
      .toUpperCase();
    const isCampaignEnded = [
      'COMPLETED',
      'COMPLETE',
      'PAUSE',
      'ENDED',
      'STOPPED',
      'CANCELLED',
    ].includes(campaignStatus);

    clearCampaignSystemEventsInterval();

    if (campaignId && isCampaignEnded) {
      return;
    }

    if (!campaignId || !isPredictiveCampaign || !socketEventsManager) {
      return;
    }

    const userDetail = {
      first_name: String(user?.user_info?.first_name || user?.first_name || '').trim(),
      last_name: String(user?.user_info?.last_name || user?.last_name || '').trim(),
      email: String(user?.user_info?.email || user?.email || '').trim(),
      extension: String(user?.user_info?.extension || '').trim(),
      user_uuid: String(user?.uuid || '').trim(),
      company_uuid: String(user?.company_info?.uuid || user?.company_uuid || '').trim(),
      domain: String(user?.sip_credentials?.domain || user?.user_info?.domain || '').trim(),
      role: String(user?.role || user?.user_info?.role || '').trim(),
      caller_id: String(user?.user_info?.caller_id || user?.caller_id || '').trim(),
    };

    if (!userDetail.user_uuid) return;

    const queue = String(activeCampaign?.queue || '').trim();
    const emitCampaignSystemEvents = () => {
      if (hasAnyActiveDialpadSessionRef.current) {
        return;
      }

      socketEventsManager.emit(
        'campaign-system-events',
        {
          body: {
            campaignId,
            queue,
            user_uuid: userDetail.user_uuid,
            userDetail,
          },
        },
        (response: any) => {
          const firstLevel = Array.isArray(response) ? response[0] : null;
          const eventPayload = Array.isArray(firstLevel) ? firstLevel[0] : firstLevel;
          const campaignStatusFromEvent = String(eventPayload?.campaignStatus || '')
            .trim()
            .toUpperCase();

          if (['COMPLETED', 'COMPLETE', 'PAUSE'].includes(campaignStatusFromEvent)) {
            clearCampaignSystemEventsInterval();
            setCampaignContactCards([]);
            setActiveCampaign((prev: any) => ({
              ...(prev || {}),
              manualStatus: campaignStatusFromEvent,
            }));
          }
        },
      );
    };

    emitCampaignSystemEvents();
    campaignSystemEventsIntervalRef.current = setInterval(emitCampaignSystemEvents, 30000);

    return () => {
      clearCampaignSystemEventsInterval();
    };
  }, [
    activeCampaign?._id,
    activeCampaign?.campaignId,
    activeCampaign?.dialMethod,
    activeCampaign?.id,
    activeCampaign?.manualStatus,
    activeCampaign?.campaignStatus,
    socketEventsManager,
    user,
    setActiveCampaign,
    setCampaignContactCards,
    clearCampaignSystemEventsInterval,
  ]);

  useEffect(() => {
    return () => {
      clearCampaignSystemEventsInterval();
    };
  }, [clearCampaignSystemEventsInterval]);

  useEffect(() => {
    if (socketEventsManager) {
      const handleWalletUpdated = (data: any) => {
        console.log('Header wallet-updated data:', data);
        queryClient.invalidateQueries({ queryKey: ['callListingLog'] });
        const nextAmount = Number(data?.amount);
        if (!Number.isFinite(nextAmount)) return;
        setWalletUpdatedAmount(nextAmount);
      };

      socketEventsManager.on('wallet-updated', handleWalletUpdated);

      return () => {
        socketEventsManager.off('wallet-updated', handleWalletUpdated);
      };
    }
  }, [queryClient, socketEventsManager]);

  return (
    <>
      <div className="fixed left-0 top-0 z-30 h-16 w-full">
        {/* mcm-topbar carries the design tokens into this bar. It sits outside
            .mcm-page, so --accent and the rest were undefined here and the
            active area button was picking up Tailwind's own --accent, which is
            near-white - hence a near-black tab instead of the console blue. */}
        <header className="mcm-topbar bg-white min-h-16 text-gray-900/80 border-b border-gray-200 px-3 py-3 ">
          <nav
            className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-3"
            aria-label="Global"
          >
            <div className="mcm-brandbar hidden md:order-1 md:flex md:items-center md:gap-3">
              <a
                href="/dashboard"
                onClick={(event) => {
                  event.preventDefault();
                  navigate('/dashboard');
                }}
                className="mcm-brand"
                aria-label="Go to Home"
              >
                {/* The customer's own mark. When they have not uploaded one we
                    show their initial rather than falling back to the vendor's
                    logo — this bar belongs to whoever is running the console. */}
                <span className="mcm-brand-mark">
                  {mainSiteInfo?.small_logo ? (
                    <img src={`${getEnv().VITE_API_BASE_URL}/${mainSiteInfo?.small_logo}`} alt="" />
                  ) : (
                    <span className="mcm-brand-initial">
                      {(siteBrand.site_name || siteBrand.company_name || 'C')
                        .trim()
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="mcm-brand-text">
                  <span className="mcm-brand-name">{siteBrand.site_name || 'Console'}</span>
                  {/* Only rendered when the customer has set one — no vendor
                      name is hardcoded here. */}
                  {siteBrand.company_name ? (
                    <span className="mcm-brand-sub">
                      {String(siteBrand.company_name).toUpperCase()}
                    </span>
                  ) : null}
                </span>
              </a>
              <AreaNav />
            </div>
            <div className="flex w-full items-center gap-2 text-gray-900/80 md:order-2 md:w-auto md:flex-1 relative">
              {hasActiveCampaign && (
                <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
                  </span>
                  <span className="max-w-[180px] truncate text-xs font-semibold text-emerald-700">
                    {activeCampaignName}
                  </span>
                  <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    Running
                  </span>
                </div>
              )}
              {isCampaignClearing && (
                <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 absolute min-w-0 top-0 left-0 z-10">
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500"></span>
                  <span className="max-w-[440px] text-xs font-medium leading-4 text-amber-700">
                    Clearing up the campaign, calls can come up until next 30 seconds.
                  </span>
                </div>
              )}
              <div className="flex flex-1 items-center justify-start ">
                <GlobalSearch />
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700 transition-colors hover:bg-ucass-primary-200 hover:text-primary md:hidden"
                onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                aria-label={isMobileMenuOpen ? 'Close header menu' : 'Open header menu'}
                aria-expanded={isMobileMenuOpen}
                aria-controls="mobile-header-actions mobile-header-wallet-profile"
              >
                {isMobileMenuOpen ? (
                  <X className="w-4.5 h-4.5" />
                ) : (
                  <Menu className="w-4.5 h-4.5" />
                )}
              </button>
            </div>
            <div
              id="mobile-header-actions"
              className={`${isMobileMenuOpen ? 'flex' : 'hidden'} w-full flex-wrap gap-3 items-center border-t border-gray-200 pt-3 md:order-3 md:flex md:w-auto md:flex-nowrap md:border-t-0 md:pt-0`}
            >
              {/* On desktop these five destinations collapse behind the
                  "more" toggle and fan out along an arc. On narrow screens the
                  header menu already reveals them, so they stay in flow. */}
              <style>{`
                /* Narrow screens keep the original row: the wrappers dissolve
                   so the icons stay direct children of the header flex line. */
                .hdr-quick-wrap, .hdr-quick { display: contents; }
                .hdr-quick-toggle { display: none; }

                @media (min-width: 768px) {
                  .hdr-quick-wrap {
                    display: inline-flex; align-items: center;
                    position: relative; width: 36px; height: 36px; flex: none;
                  }
                  /* Tokens, not hex. These three lines were the last hard-coded
                     colours in the bar - #f3f4f6, #e0e7ff, #2563eb - so this
                     control alone could not follow a theme, and it sat as a
                     filled grey chip among ghost buttons. Ghost by default now,
                     filling only on hover, and solid accent while its menu is
                     open, which is the one state that earns a fill. */
                  .hdr-quick-toggle {
                    display: inline-flex; align-items: center; justify-content: center;
                    width: 36px; height: 36px; border-radius: 10px;
                    background: transparent; color: var(--ink-3); cursor: pointer;
                    transition: transform .3s cubic-bezier(.34,1.56,.64,1),
                                background .15s ease, color .15s ease;
                  }
                  .hdr-quick-toggle:hover {
                    background: color-mix(in srgb, var(--accent) 9%, transparent);
                    color: var(--accent-ink);
                  }
                  .hdr-quick-toggle.on {
                    transform: rotate(135deg); background: var(--accent); color: #fff;
                  }

                  .hdr-quick {
                    display: block; position: absolute; top: 0; right: 0;
                    width: 36px; height: 36px; z-index: 60;
                    /* This box overlays the toggle exactly, so it has to let
                       clicks through or it swallows them and the menu never
                       opens. Only the fanned-out items take pointer events. */
                    pointer-events: none;
                  }
                  .hdr-quick > * {
                    position: absolute; top: 0; left: 0;
                    opacity: 0; pointer-events: none;
                    transform: translate(0, 0) scale(.4);
                    transition: transform .34s cubic-bezier(.34,1.56,.64,1),
                                opacity .2s ease;
                  }
                  .hdr-quick.open > * { opacity: 1; pointer-events: auto; }

                  /* a quarter arc sweeping left then down, clear of the edge */
                  .hdr-quick.open > *:nth-child(1) { transform: translate(-152px,   0px) scale(1); transition-delay: .02s; }
                  .hdr-quick.open > *:nth-child(2) { transform: translate(-140px,  58px) scale(1); transition-delay: .06s; }
                  .hdr-quick.open > *:nth-child(3) { transform: translate(-107px, 107px) scale(1); transition-delay: .10s; }
                  .hdr-quick.open > *:nth-child(4) { transform: translate( -58px, 140px) scale(1); transition-delay: .14s; }
                  .hdr-quick.open > *:nth-child(5) { transform: translate(   0px, 152px) scale(1); transition-delay: .18s; }
                }

                @media (prefers-reduced-motion: reduce) {
                  .hdr-quick-toggle, .hdr-quick > * { transition-duration: .01ms; }
                }
              `}</style>

              <div className="hdr-quick-wrap">
                <button
                  type="button"
                  className={`hdr-quick-toggle ${isQuickMenuOpen ? 'on' : ''}`}
                  onClick={() => setIsQuickMenuOpen((prev) => !prev)}
                  aria-expanded={isQuickMenuOpen}
                  aria-label={isQuickMenuOpen ? 'Hide quick links' : 'Show quick links'}
                >
                  <Plus className="w-4.5 h-4.5" />
                </button>

                <div
                  className={`hdr-quick ${isQuickMenuOpen ? 'open' : ''}`}
                  aria-hidden={!isQuickMenuOpen}
                >
                  <div className="inline-flex items-center justify-center font-medium">
                    <CustomTooltip text={'Tasks'} side="bottom">
                      <span
                        className={`cursor-pointer relative flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 rounded-lg transition-all ${activePath === ACTIVE_PATH.CALENDAR && currentView === 'task-list' ? 'bg-ucass-primary-200 text-primary' : 'bg-gray-100 text-gray-700 hover:bg-ucass-primary-200 hover:text-primary'}`}
                        {...getHeaderRouteHandlers(taskRoute)}
                      >
                        {unreadTaskCount > 0 ? (
                          <span className="bg-primary absolute text-white font-normal rounded-full -top-1 -right-1 border-white border-2 text-[10px] min-w-[20px] h-5 flex items-center justify-center shadow-sm z-10">
                            {unreadTaskCount > 9 ? '9+' : unreadTaskCount}
                          </span>
                        ) : null}
                        <List className="w-4.5 h-4.5" />
                      </span>
                    </CustomTooltip>
                  </div>

                  <CustomTooltip text={'Calendar'} side="bottom">
                    <span
                      className={`cursor-pointer ${ACTIVE_PATH?.CALENDAR === activePath && currentView === 'calendar' ? 'bg-ucass-primary-200 text-primary hover:text-primary' : 'bg-gray-100 text-gray-700'} flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 rounded-lg hover:bg-ucass-primary-200 hover:text-primary`}
                      {...getHeaderRouteHandlers(calendarRoute)}
                    >
                      <CalendarIcon className="w-4.5 h-4.5" />
                    </span>
                  </CustomTooltip>
                  {campaignAccess && (
                    <CustomTooltip text={'My Campaigns'} side="bottom">
                      <span
                        className={`cursor-pointer ${ACTIVE_PATH?.RUNNING_CAMPAIGN === activePath ? 'bg-ucass-primary-200 text-primary hover:text-primary' : 'bg-gray-100 text-gray-700'} flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 rounded-lg hover:bg-ucass-primary-200 hover:text-primary`}
                        {...getHeaderRouteHandlers(myCampaignsRoute)}
                      >
                        <Headphones className="w-4.5 h-4.5" />
                      </span>
                    </CustomTooltip>
                  )}
                  {/* <CustomTooltip text={'Running Campaigns'} side="bottom">
              <span
                className={`cursor-pointer ${ACTIVE_PATH?.RUNNING_CAMPAIGN === activePath ? 'bg-ucass-primary-200 text-primary hover:text-primary' : 'bg-white text-gray-700'} flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 rounded-lg hover:bg-ucass-primary-200 hover:text-primary`}
                onClick={() => openPowerCampaign()}
              >
                <CallForwardLine className="w-4.5 h-4.5" />
              </span>
            </CustomTooltip> */}
                  <CustomTooltip text={'Activity'} side="bottom">
                    <span
                      className={`cursor-pointer ${ACTIVE_PATH?.ACTIVITY === activePath ? 'bg-ucass-primary-200 text-primary hover:text-primary' : 'bg-gray-100 text-gray-700'} flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 rounded-lg hover:bg-ucass-primary-200 hover:text-primary`}
                      {...getHeaderRouteHandlers(activityRoute)}
                    >
                      <ActivityIcon className="w-4.5 h-4.5" />
                    </span>
                  </CustomTooltip>
                  {monitoringAccess?.view && (
                    <div className="inline-flex items-center justify-center font-medium">
                      <CustomTooltip text={'Monitoring'} side="bottom">
                        <span
                          className={`cursor-pointer ${ACTIVE_PATH?.ALL_CALLS === activePath ? 'bg-ucass-primary-200 text-primary hover:text-primary' : 'bg-gray-100 text-gray-700'} flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 rounded-lg hover:bg-ucass-primary-200 hover:text-primary`}
                          {...getHeaderRouteHandlers(monitoringRoute)}
                        >
                          <Monitor className="w-4.5 h-4.5" />
                        </span>
                      </CustomTooltip>
                    </div>
                  )}
                </div>
              </div>

              {/* The WebRTC and presence chips lived here. Registration state is
                  already on the dialer button beside this, and presence is on the
                  avatar menu — two more always-on chips just crowded the bar. */}
              {/* The dialer button lived here. Calls are placed from
                  Activity ▸ Phone; the header keeps only notifications and
                  account controls. */}
              {/* AI Chat Requests */}
              {/* <div className="inline-flex items-center justify-center font-medium">
                <CustomTooltip text={'AI Chat Requests'} side="bottom">
                  <span
                    className="cursor-pointer relative bg-gray-100 flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 rounded-lg hover:bg-ucass-primary-200 hover:text-primary"
                    onClick={() => {
                      setPendingChatState(true);
                      setIsMobileMenuOpen(false);
                    }}
                  >
                    {aiChatRequests && aiChatRequests.length > 0 && (
                      <span className="bg-primary absolute text-white font-normal me-2  rounded-full -top-[4px] left-[20px] border-white border-2 text-xs px-1 min-w-5 min-h-5 flex items-center justify-center">
                        {aiChatRequests.length > 9 ? '9+' : aiChatRequests.length}
                      </span>
                    )}
                    <svg
                      className="w-4.5 h-4.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.539.924A13.484 13.484 0 0112 17.25a13.484 13.484 0 01-6.261-1.326L4.2 15m15.6 0-1.74 2.61a2.25 2.25 0 01-1.874 1.005H7.814a2.25 2.25 0 01-1.874-1.005L4.2 15"
                      />
                    </svg>
                  </span>
                </CustomTooltip>
              </div> */}
              <div className="inline-flex items-center justify-center font-medium">
                <CustomTooltip text={'Notification'} side="bottom">
                  <span
                    className="cursor-pointer relative bg-gray-100 flex items-center justify-center min-h-9 min-w-9 max-w-9 max-h-9 rounded-lg hover:bg-ucass-primary-200 hover:text-primary"
                    onClick={() => {
                      setNotificationState(true);
                      setIsMobileMenuOpen(false);
                    }}
                  >
                    {unreadCount ? (
                      <span className="bg-primary absolute text-white font-normal me-2  rounded-full -top-[4px] left-[20px] border-white border-2 text-xs px-1 min-w-5 min-h-5 flex items-center justify-center">
                        {unreadCount && unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    ) : null}
                    <Bell className="w-4.5 h-4.5" />
                  </span>
                </CustomTooltip>
              </div>

              {/* The gear lived here. Personal settings are now Admin ▸ My
                  Account, and the avatar menu still links straight to them. */}
            </div>
            <div className="hidden md:order-4 md:flex md:items-center">
              <ThemeToggle />
            </div>
            <div
              id="mobile-header-wallet-profile"
              className={`${isMobileMenuOpen ? 'flex' : 'hidden'} w-full flex-wrap items-center gap-3 border-t border-gray-200 pt-3 md:order-5 md:flex md:w-auto md:flex-nowrap md:justify-end md:border-t-0 md:pt-0`}
            >
              {/* Wallet / Add Funds */}
              {features?.plan_features?.billing?.action?.view ? (
                <div className="flex items-center">
                  <CustomTooltip text={'Add Funds'} side="bottom">
                    <div
                      className="flex items-center gap-2 px-3 h-9 bg-gray-100 hover:bg-ucass-primary-200  rounded-lg cursor-pointer"
                      {...getHeaderRouteHandlers(addFundsRoute)}
                    >
                      <Wallet className="w-5 h-5 text-primary group-hover:scale-110 transition-transform duration-300" />
                      <span className="text-[14px] text-primary font-medium">
                        {resolvedFundsDisplay}
                      </span>
                    </div>
                  </CustomTooltip>
                </div>
              ) : null}

              {/* User Profile */}
              <div className="flex items-center  bg-gray-100 rounded-xl ">
                <Popover
                  open={profileState === 'profile'}
                  onOpenChange={(val) => setProfileState(val ? 'profile' : null)}
                >
                  <PopoverTrigger className="cursor-pointer flex items-center gap-4 h-9 p-1 pr-2 rounded-xl border border-transparent hover:bg-ucass-primary-200">
                    <CompanyLogoMark />
                    <CustomAvatar
                      name={`${user?.user_info?.first_name} ${user?.user_info?.last_name || ''}`}
                      showPresence
                      extension={user?.user_info?.extension}
                      image={user?.user_info?.profile}
                      isActivityInfo={false}
                      size="32"
                    />
                    <div className="flex flex-col items-start text-left min-w-[120px]">
                      <h4 className="text-[12px] font-bold text-gray-900 leading-tight">
                        {`Hi, ${user?.user_info?.first_name} ${user?.user_info?.last_name || ''}`}
                      </h4>
                      <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-widest">
                        {role}
                      </div>
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-3 mt-2 mr-2 shadow-xl ring-1 ring-black/5">
                    <AvatarContent setProfileState={setProfileState} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </nav>
        </header>

        {notificationState && (
          <SideDrawer
            isOpen={notificationState}
            handleClose={() => setNotificationState(false)}
            content={<NotificationContent setNotificationState={setNotificationState} />}
            isHeader={true}
            width="30%"
          />
        )}
        {pendingChatState && (
          <SideDrawer
            isOpen={pendingChatState}
            handleClose={() => setPendingChatState(false)}
            content={<PendingChatRequestsDrawer onClose={() => setPendingChatState(false)} />}
            isHeader={false}
            width="30%"
          />
        )}
        {profileState === 'changePassword' && (
          <ChangePassword setModalState={setProfileState} modalState={profileState} />
        )}
        <AlertConfirm
          onConfirm={() => {}}
          open={forceLogoutOpen}
          setOpen={() => {}}
          headerText="Session Terminated"
          singleButton={true}
          singleButtonText="Okay"
          singleButtonHandler={() => {
            sessionStorage.clear();
            localStorage.clear();
            handleRemoveUser();
          }}
          descriptionTextComp={
            <div className="text-md py-2 text-gray-700">
              Your session has been terminated or has expired. Please click Okay to log in again.
            </div>
          }
        />
      </div>
    </>
  );
};

export default Header;
