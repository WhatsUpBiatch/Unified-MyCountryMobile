import { Icon } from '@/assets/icons/icon';
import { NavIcon } from './nav-icon';
import type { IconType } from '@/assets/icons/type';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useCompanyFeatures } from '@/hooks/rbac';
import { useUser } from '@/hooks/use-user';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { getRoutePrefetchHandlers } from '@/router/route-prefetch';
import {
  COMPANY_RULES_PATH,
  COMPANY_ROOT,
  COMPANY_SECTIONS,
} from '@/pages/admin-settings/company/company-sections';

export const canShowItem = (item: any, isAdmin: boolean) => {
  if ('visible' in item && item.visible !== true) return false;

  if (isAdmin) return true;

  return true;
};

/* IS_ACCOUNT_ADMIN: the person holds the account-admin role (the one shown as
   "Location admin"), which may set admin scopes alongside the owner. */
export const adminSettingArr = (features: any, IS_ADMIN: boolean, IS_ACCOUNT_ADMIN = false) =>
  [
    {
      title: 'Captain',
      type: 'accordion',
      value: 'captain',
      icon: 'UserCircleIcon',
      visible: true,
      enabled: true,
      children: [
        { title: 'Playground', icon: 'PlayCircle', path: '/admin-settings/captain/playground' },
        { title: 'Assistants', icon: 'AIChatIcon', path: '/admin-settings/captain/assistants' },
        { title: 'Documents', icon: 'DocumentAdd', path: '/admin-settings/captain/documents' },
        { title: 'FAQs', icon: 'QuestionIcon', path: '/admin-settings/captain/faqs' },
        { title: 'Scenarios', icon: 'PlayDottedCircle', path: '/admin-settings/captain/scenarios' },
        { title: 'Actions', icon: 'WebhookIcon', path: '/admin-settings/captain/actions' },
        { title: 'Inboxes', icon: 'InboxIcon', path: '/admin-settings/captain/inboxes' },
        { title: 'Settings', icon: 'SettingsIcon', path: '/admin-settings/captain/settings' },
      ],
    },
    {
      /* Company-wide phone rules used to sit under Phone System, so an admin
         looking for company settings found a name and a list of locations and
         concluded there were none. Established systems keep organisation
         policy on the company screen; this puts it there. */
      title: 'Company',
      type: 'accordion',
      value: 'company-info',
      icon: 'CompayIcon',
      enabled: true,
      visible: Boolean(features?.plan_features?.account_setting?.access?.SITE?.action?.view),
      children: [
        {
          title: 'Company & Locations',
          path: '/admin-settings/company',
          icon: 'CompayIcon',
          enabled: true,
          visible: Boolean(features?.plan_features?.account_setting?.access?.SITE?.action?.view),
        },
        {
          title: 'Company Rules',
          path: COMPANY_RULES_PATH,
          /* Company Rules is eight tabs behind one entry, and `isActive` is an
             exact path match - so opening Greetings or Security put the sidebar
             back to nothing selected while the user was plainly still inside
             this section. Taken from COMPANY_SECTIONS rather than listed here,
             so a tab added or removed there cannot leave this behind. */
          extraActiveTab: COMPANY_SECTIONS.map((section) => `${COMPANY_ROOT}/${section.path}`),
          icon: 'SettingsIcon',
          enabled: true,
          visible: Boolean(features?.plan_features?.account_setting?.access?.SITE?.action?.view),
        },
      ].filter(Boolean),
    },
    {
      /* Named for whose settings these are. "Settings" alone sat ambiguously
         next to the company-wide screens; these are the signed-in person's own
         profile, phone, notifications and security. */
      title: 'My Account',
      type: 'accordion',
      value: 'account',
      icon: 'UserCircleIcon',
      visible: true,
      enabled: true,
      children: [
        { title: 'Profile', icon: 'ExtensionIcon', path: '/admin-settings/account/profile' },
        { title: 'Preferences', icon: 'SettingIcon', path: '/admin-settings/account/preferences' },
        { title: 'My Phone', icon: 'PhoneIcon', path: '/admin-settings/account/phone' },
        {
          title: 'Notifications',
          icon: 'NotificationIcon',
          path: '/admin-settings/account/notifications',
        },
        {
          title: 'Greetings',
          icon: 'GreetingIcon',
          path: '/admin-settings/account/greetings',
        },
        /* Media Files used to sit here. The library holds the whole company's
           audio — IVR prompts, queue greetings, voicemail — not one person's,
           so it now lives under Phone System beside IVR Menus. The old path
           still redirects there. */
        {
          title: 'Security & Privacy',
          icon: 'ShieldIcon',
          path: '/admin-settings/account/security',
        },
      ].filter(Boolean),
    },
    {
      title: 'People',
      type: 'accordion',
      value: 'users',
      icon: 'UserCircleIcon',
      visible:
        IS_ADMIN || Boolean(features?.plan_features?.account_setting?.access?.USER?.action?.view),
      enabled: true,
      children: [
        {
          title: 'People',
          icon: 'ExtensionIcon',
          path: '/admin-settings/people',
        },
        /* Access is one decision made in four steps, so the four screens are
           listed in the order they should be used rather than alphabetically or
           in the order they happened to be built. The reference table sits last:
           it explains the model but decides nothing. */
        {
          /* What a role can do. */
          title: 'Roles',
          icon: 'RoleIcon',
          path: '/admin-settings/roles',
          enabled: IS_ADMIN,
          visible: IS_ADMIN,
        },
        {
          /* Who a role reaches: the whole company, chosen locations or chosen
             groups. Saved on the person's record and read by the server on
             every request that acts on a person (report mode until switched
             on). The account owner and account admins set it; the entry is
             shown to both. */
          title: 'Admin scope',
          icon: 'RoleIcon',
          path: '/admin-settings/admin-scope',
          enabled: IS_ADMIN || IS_ACCOUNT_ADMIN,
          visible: IS_ADMIN || IS_ACCOUNT_ADMIN,
        },
      ].filter(Boolean),
    },
    {
      title: 'Numbers',
      type: 'accordion',
      value: 'numbers',
      icon: 'HashIcon',
      enabled: true,
      visible: Boolean(features?.plan_features?.virtual_numbers?.action?.view),
      children: [
        /* Labels are the page titles verbatim. The nav used to say "All Number",
           "Number In Use", "Unused Number" while the screens they open are
           titled "All numbers", "Numbers in use", "Unused numbers" — a
           singular/plural and word-order mismatch that made the nav read as a
           different set of screens than the ones it leads to. */
        {
          title: 'All numbers',
          path: '/admin-settings/numbers/all',
          icon: 'AllNumberIcon',
        },
        {
          title: 'Identities & addresses',
          path: '/admin-settings/numbers/identities',
          icon: 'AllNumberIcon',
          extraActiveTab: ['addresses', 'verifications'],
        },
        {
          title: 'Numbers in use',
          path: '/admin-settings/numbers/in-use',
          icon: 'TickCircleIcon',
        },
        {
          /* The same numbers read from the line's side rather than the
             number's, which is how an admin asks the question. */
          title: 'Numbers by line',
          path: '/admin-settings/numbers/by-line',
          icon: 'AllNumberIcon',
        },
        {
          title: 'Unused numbers',
          path: '/admin-settings/numbers/inventory',
          icon: 'InventoryIcon',
        },
        {
          title: 'Released numbers',
          path: '/admin-settings/numbers/released',
          icon: 'HashIcon',
          enabled: true,
          visible: Boolean(features?.plan_features?.virtual_numbers?.action?.view),
        },
        {
          title: 'Call Coverage',
          path: '/admin-settings/numbers/coverage',
          icon: 'TickCircleIcon',
        },
      ].filter(Boolean),
    },
    {
      title: 'Phone System',
      type: 'accordion',
      value: 'phone',
      icon: 'PhoneSystemIcon',
      enabled:
        Boolean(features?.plan_features?.phone_system_action?.IS_SHOW) &&
        (Boolean(features?.plan_features?.phone_system_action?.access?.IVR) ||
          Boolean(features?.plan_features?.phone_system_action?.access?.DEPARTMENT) ||
          Boolean(features?.plan_features?.phone_system_action?.access?.QUEUE)),

      visible: Boolean(features?.plan_features?.phone_system_action?.action?.view),
      children: [
        {
          title: 'Call Queues',
          path: '/admin-settings/phone/queues',
          icon: 'CallQueue',
          enabled: Boolean(features?.plan_features?.phone_system_action?.access?.QUEUE),
          visible: Boolean(features?.plan_features?.phone_system_action?.action?.view),
        },
        {
          /* A group is a team calls route to, so it belongs beside the other
             routing targets rather than under People. The path keeps the
             platform's own word; only the label changes. */
          title: 'Groups',
          path: '/admin-settings/phone/departments',
          icon: 'DepartmentIcon1',
          enabled: Boolean(features?.plan_features?.phone_system_action?.access?.DEPARTMENT),
          visible: Boolean(features?.plan_features?.phone_system_action?.action?.view),
        },
        {
          title: 'IVR Menus',
          path: '/admin-settings/phone/ivr',
          icon: 'PhoneCallingLine',
          enabled: Boolean(features?.plan_features?.phone_system_action?.access?.IVR),
          visible: Boolean(features?.plan_features?.phone_system_action?.action?.view),
        },
        {
          /* The company's audio library: the prompts IVR menus play, the
             greetings queues and groups use, and voicemail messages. It was
             under My Account, where it read as one person's files and an admin
             building a menu could not find it. The screen's own permission
             (settings.action.greeting) still decides who may add or delete. */
          title: 'Media Files',
          path: '/admin-settings/phone/media',
          icon: 'MediaIcon',
          extraActiveTab: ['phone/media/'],
        },
      ].filter(Boolean),
    },
    {
      title: 'AI Tools',
      type: 'accordion',
      value: 'knowledge',
      icon: 'AIBrainIcon',
      enabled: Boolean(features?.plan_features?.ai?.IS_SHOW),
      visible:
        Boolean(features?.plan_features?.ai?.action?.agent?.view) ||
        Boolean(features?.plan_features?.ai?.action?.knowledge_base?.view),
      children: [
        {
          title: 'AI Receptionists',
          path: '/admin-settings/knowledge/ai-receptionist',
          icon: 'RiChatVoiceLine',
          enabled: Boolean(features?.plan_features?.ai?.IS_SHOW),
          visible: Boolean(features?.plan_features?.ai?.IS_SHOW),
        },
        {
          title: 'Chat Agents',
          path: '/admin-settings/knowledge/ai-agent',
          icon: 'UsersGroupLine',
          extraActiveTab: ['create-agent', 'configure-ai-agent', 'browse-templates'],
          enabled: Boolean(features?.plan_features?.ai?.IS_SHOW),
          visible: Boolean(features?.plan_features?.ai?.action?.agent?.view),
        },
        {
          title: 'Playground',
          path: '/admin-settings/knowledge/playground',
          icon: 'Play',
          enabled: Boolean(features?.plan_features?.ai?.IS_SHOW),
          visible: Boolean(features?.plan_features?.ai?.IS_SHOW),
        },
        {
          title: 'Domain',
          path: '/admin-settings/knowledge/domain',
          icon: 'GlobeIcon',
          visible: false,
          enabled: Boolean(features?.plan_features?.ai?.IS_SHOW),
        },
        {
          title: 'Sessions',
          path: '/admin-settings/knowledge/ai-bot-session',
          icon: 'AIChatIcon',
          enabled: Boolean(features?.plan_features?.ai?.IS_SHOW),
          visible: Boolean(features?.plan_features?.ai?.IS_SHOW),
        },

        {
          title: 'Settings',
          path: '/admin-settings/knowledge/ai-settings',
          icon: 'SettingsIcon',
          enabled: Boolean(features?.plan_features?.ai?.IS_SHOW),
          visible: Boolean(features?.plan_features?.ai?.IS_SHOW),
        },
      ].filter(Boolean),
    },
    {
      key: 'admin-settings.integration',
      id: 'integration',
      title: 'Integration',
      type: 'accordion',
      value: 'integration',
      icon: 'IntegrationIcon',
      visible: Boolean(features?.plan_features?.integration?.action?.view),
      enabled: Boolean(features?.plan_features?.integration?.IS_SHOW),
      /* All four screens listed flat. The original nav nested Zapier, General
         Settings and Manage Webhook one level deeper under "Data & Reporting",
         but this nav is two levels only — collapsing them to a single link left
         Zapier and Manage Webhook with no way in. */
      children: [
        { title: 'CRM', icon: 'IntegrationIcon', path: '/admin-settings/integration/crm' },
        {
          title: 'General Settings',
          icon: 'SettingIcon',
          path: '/admin-settings/integration/data-reporting/general-settings',
        },
        {
          title: 'Zapier',
          icon: 'IntegrationIcon',
          path: '/admin-settings/integration/data-reporting/zapier',
        },
        {
          title: 'Manage Webhook',
          icon: 'AnalyticsIcon',
          path: '/admin-settings/integration/data-reporting/manage-webhook',
        },
      ],
    },
    {
      key: 'admin-settings.social_media_channels',
      id: 'social_media_channels',
      title: 'Social Media Channels',
      path: '/admin-settings/social-media-channels',
      icon: 'ShareIcon',
      enabled: Boolean(features?.plan_features?.omni_channel?.IS_SHOW),
      visible: Boolean(features?.plan_features?.omni_channel?.action?.view),
    },

    {
      key: 'admin-settings.calling_rates',
      id: 'calling_rates',
      title: 'SMS/Calling Rates',
      icon: 'DollarSignCircle',
      type: 'accordion',
      value: 'call-rates',
      enabled: Boolean(features?.plan_features?.calling_rates?.IS_SHOW),
      visible: Boolean(features?.plan_features?.calling_rates?.action?.view),
      children: [
        {
          key: 'admin-settings.calling_rates.outbound_rates',
          id: 'outbound_rates',
          title: 'Rate Details',
          path: '/admin-settings/calling-rates/outbound-rates',
          icon: 'CallOutgoing',
        },
        {
          /* The whole price list, rather than one country at a time. */
          key: 'admin-settings.calling_rates.destinations',
          id: 'destinations',
          title: 'Destinations',
          path: '/admin-settings/calling-rates/destinations',
          icon: 'CallOutgoing',
        },
      ].filter(Boolean),
    },
  ]
    ?.filter(Boolean)
    ?.filter((item) => {
      if ((item as any)?.visible === false) return false;
      if (IS_ADMIN) return true;
      return item?.visible !== false;
    });

const Sidebar = () => {
  const [manualActiveItem, setManualActiveItem] = useState<{
    pathname: string;
    value: string;
  } | null>(null);
  const [mobileExpandedItem, setMobileExpandedItem] = useState<{
    pathname: string;
    value: string;
  } | null>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user = {} } = useUser();
  const { features } = useCompanyFeatures();
  const IS_ADMIN = user?.user_info?.role === 'ADMIN';
  const IS_ACCOUNT_ADMIN = String(user?.user_info?.role || '').toUpperCase() === 'MANAGER';
  const settingsItems = useMemo(
    () => adminSettingArr(features, IS_ADMIN, IS_ACCOUNT_ADMIN),
    [features, IS_ADMIN, IS_ACCOUNT_ADMIN],
  );

  /* Admin has ~35 screens; typing beats opening sections one by one. A section
     matches if its own name matches, or any screen inside it does — and when it
     matches by a child, only the matching children are listed. */
  const [navSearch, setNavSearch] = useState('');
  const searchedItems = useMemo(() => {
    const needle = navSearch.trim().toLowerCase();
    if (!needle) return settingsItems;
    return settingsItems
      .map((item: any) => {
        const selfMatches = String(item?.title || '')
          .toLowerCase()
          .includes(needle);
        const matchedChildren = (item?.children || []).filter((child: any) =>
          String(child?.title || '')
            .toLowerCase()
            .includes(needle),
        );
        if (selfMatches) return item;
        if (matchedChildren.length) return { ...item, children: matchedChildren };
        return null;
      })
      .filter(Boolean);
  }, [settingsItems, navSearch]);
  const matchesChildItem = (child: any) =>
    (child?.path ? pathname?.startsWith(child.path) : false) ||
    child?.extraActiveTab?.some((segment: string) => pathname?.includes(segment));
  const matchesTopLevelItem = (item: any) =>
    (item?.path ? pathname?.startsWith(item.path) : false) ||
    item?.children?.some((child: any) => matchesChildItem(child));

  const activeItem = useMemo(() => {
    if (!pathname) return '';
    const matchedParent = settingsItems?.find((item: any) => matchesTopLevelItem(item));
    return matchedParent?.value || '';
  }, [pathname, settingsItems]);

  const hasManualActiveItem = manualActiveItem?.pathname === pathname;
  const hasMobileExpandedItem = mobileExpandedItem?.pathname === pathname;
  const openAccordionItem = hasManualActiveItem ? manualActiveItem.value : activeItem;
  const responsiveExpandedItem = hasMobileExpandedItem ? mobileExpandedItem.value : activeItem;

  useEffect(() => {
    const runResize = () => window.dispatchEvent(new Event('resize'));
    const frameId = window.requestAnimationFrame(runResize);
    const timeoutId = window.setTimeout(runResize, 180);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [responsiveExpandedItem, pathname]);

  const activeResponsiveItem = settingsItems?.find(
    (item: any) => item?.value === responsiveExpandedItem,
  );
  const activeResponsiveChildren =
    activeResponsiveItem?.type === 'accordion'
      ? (activeResponsiveItem?.children || []).filter((child: any) => canShowItem(child, IS_ADMIN))
      : [];

  const handleResponsiveTabClick = (item: any) => {
    if (item?.type === 'accordion') {
      const visibleChildren = (item?.children || []).filter((child: any) =>
        canShowItem(child, IS_ADMIN),
      );
      const isSameExpanded = responsiveExpandedItem === item?.value;

      setMobileExpandedItem({
        pathname,
        value: isSameExpanded ? '' : item?.value || '',
      });

      const hasActiveChild = visibleChildren.some((child: any) =>
        pathname?.startsWith(child?.path),
      );
      const hasChildTabMatch = visibleChildren.some((child: any) => matchesChildItem(child));
      const firstEnabledChild = visibleChildren.find((child: any) => child?.enabled !== false);
      if (!isSameExpanded && !hasActiveChild && !hasChildTabMatch && firstEnabledChild?.path) {
        navigate(firstEnabledChild.path);
      }
      return;
    }

    setMobileExpandedItem({ pathname, value: '' });
    if (item?.path) navigate(item.path);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex flex-col gap-3 overflow-x-hidden overflow-y-auto px-3 py-3 lg:hidden">
        <div className="-mx-3 overflow-x-auto px-3">
          <div className="flex min-w-max gap-2 pb-1">
            {settingsItems?.map((item: any, index: number) => {
              const isCurrent = matchesTopLevelItem(item);
              const visibleChildren = (item?.children || []).filter((child: any) =>
                canShowItem(child, IS_ADMIN),
              );
              const prefetchPath =
                item?.path || visibleChildren.find((child: any) => child?.enabled !== false)?.path;

              return (
                <button
                  key={`${item?.value || item?.path || item?.title}-${index}`}
                  type="button"
                  onClick={() => handleResponsiveTabClick(item)}
                  {...getRoutePrefetchHandlers(prefetchPath)}
                  className={`flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors ${
                    isCurrent
                      ? 'border-primary bg-ucass-primary-200/60 text-primary'
                      : 'border-gray-200 bg-white text-gray-700'
                  } ${item?.enabled === false ? 'cursor-not-allowed opacity-60' : ''}`}
                  disabled={item?.enabled === false}
                >
                  <NavIcon name={item?.icon} className="h-4.5 w-4.5 p-0.5" />
                  <span>{item?.title}</span>
                  {item?.type === 'accordion' && (
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition-transform ${
                        mobileExpandedItem === item?.value ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {!!activeResponsiveChildren.length && (
          <div className="min-h-[9rem] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {activeResponsiveItem?.title}
              </p>
            </div>
            <div className="flex flex-col">
              {activeResponsiveChildren.map(
                ({ title, path, icon, extraActiveTab, enabled }: any, index: number) => {
                  const isChildActive =
                    pathname === path ||
                    extraActiveTab?.some((segment: string) => pathname?.includes(segment));

                  return (
                    <button
                      key={`${path || title}-${index}`}
                      type="button"
                      onClick={() => path && navigate(path)}
                      {...getRoutePrefetchHandlers(path)}
                      disabled={enabled === false}
                      className={`flex min-h-11 w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left text-sm font-medium last:border-b-0 ${
                        isChildActive
                          ? 'bg-ucass-primary-200/50 text-primary'
                          : 'bg-white text-gray-700'
                      } ${enabled === false ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <NavIcon name={icon} className="h-4.5 w-4.5 shrink-0 p-0.5" />
                      <span className="truncate">{title}</span>
                    </button>
                  );
                },
              )}
            </div>
          </div>
        )}
      </div>

      <div className="hidden h-full min-h-0 overflow-y-auto overflow-x-hidden lg:flex lg:flex-col">
        <div className="mcm-adminnav-search">
          <Icon name={'SearchLine' as IconType} className="h-4 w-4" />
          <input
            value={navSearch}
            onChange={(event) => setNavSearch(event.target.value)}
            placeholder="Search admin"
            aria-label="Filter admin sections"
          />
        </div>
        {/* Once you are on a screen there was no way back to the Admin landing
            page — the nav lists sections but never the overview itself. */}
        <NavLink
          to="/admin-settings"
          end
          className={({ isActive }) => `mcm-adminnav-all ${isActive ? 'on' : ''}`}
        >
          <NavIcon name={'Grid'} className="h-4 w-4" />
          All admin screens
        </NavLink>
        <div className="mcm-adminnav h-full min-h-0 divide-y divide-gray-200">
          {!searchedItems?.length ? (
            <p className="mcm-adminnav-empty">No section matches that.</p>
          ) : null}
          {searchedItems?.map(
            ({ type, icon = '', path, title, children, value, enabled }, index: number) => {
              const isActive = value === activeItem;
              if (type === 'accordion') {
                const visibleChildren = (children || [])?.filter((child: any) =>
                  canShowItem(child, IS_ADMIN),
                );

                if (visibleChildren?.length === 0) return null;
                return (
                  <Accordion
                    key={index}
                    type="single"
                    value={openAccordionItem}
                    onValueChange={(v) => setManualActiveItem({ pathname, value: v })}
                    collapsible
                  >
                    <AccordionItem value={value} className="">
                      <AccordionTrigger className="p-0 items-center" isActive={isActive}>
                        <div className="flex items-center w-full px-3 h-14 gap-2 cursor-pointer font-medium whitespace-nowrap">
                          <NavIcon name={icon} className="w-6 h-6 p-0.5" />
                          {title}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="border md:border-0  md:bg-ucass-primary-200/20 bg-white z-10 relative">
                        {visibleChildren?.map((child: any, index: number) => {
                          /* `children` used to be spread in here from the
                             enclosing section, not from the child - so every
                             item inside a section was told it had children of
                             its own. Tile reads that to decide whether it is a
                             parent row, and a parent row never draws the filled
                             pill, so the current page could be lit inside a
                             section but never marked as the page you are on.
                             A leaf has no children; it now says so. */
                          const { title, path, icon, extraActiveTab, enabled } = child;
                          return (
                            <Tile
                              key={index}
                              {...{
                                title,
                                path,
                                icon,
                                extraActiveTab,
                                children: child.children,
                                enabled,
                              }}
                            />
                          );
                        })}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                );
              } else {
                return <Tile key={index} {...{ title, path, icon, children, enabled }} />;
              }
            },
          )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;

const Tile = ({ title, path, icon, extraActiveTab, children, enabled }: any) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isEnabled = enabled !== false;

  const isActive =
    pathname === path || extraActiveTab?.some((segment: string) => pathname?.includes(segment));
  const isChildrenExist = Boolean(children && children?.length);
  return (
    <div
      className={`flex items-center w-full px-3 min-h-14 h-14 gap-2 cursor-pointer ${isActive ? (isChildrenExist ? 'text-primary' : 'text-primary bg-ucass-primary-200/50 border-r-primary border-r-2') : 'text-gray-900/80'} ${isChildrenExist ? 'pl-10' : ''} ${!isEnabled ? 'text-gray-400 opacity-60' : ''}`}
      {...getRoutePrefetchHandlers(path)}
      onClick={() => {
        if (!isEnabled || !path) return;
        navigate(path);
      }}
    >
      <NavIcon name={icon} className="w-5 h-5 p-0.5" />
      <p title={title} className="font-medium truncate text-sm">
        {title}
      </p>
      {!isEnabled && <span className="text-xs">🔒</span>}
    </div>
  );
};
