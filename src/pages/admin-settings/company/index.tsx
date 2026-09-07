import { siteDelete, siteList } from '@/services/api';
import { useEffect, useMemo, useState } from 'react';
import CompanyDetails from './company-details';
import LocationCard from './location-card';
import CompanyRecord from './company-record';
import CompanySettingsCard from './company-settings-card';
import CompanyLogo from './company-logo';
import SetupGuide from '@/components/mcm/setup-guide';
import { Button } from '@/components/ui/button';
import NewSiteSteps from './new-site-steps';
import AlertConfirm from '@/components/custom/alert-confirm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { upsertSite, siteList as fetchSiteList } from '@/services/api';
import { handleAlert } from '@/lib/utils';
import { SearchLine } from '@/assets/icons';
import SideDrawer from '@/components/custom/side-drawer';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/assets/icons/icon';
import { useCompanyFeatures } from '@/hooks/rbac';
import { MapPin } from 'lucide-react';
import useDebounce from '@/hooks/use-debounce';
import Loader from '@/components/custom/loader';
import { useUser } from '@/hooks/use-user';
import '@/components/mcm/mcm-page.css';

const CompanyInfo = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState<string>('');
  const debouncedSearch = useDebounce(search, 1000);
  const [rowData, setRowData] = useState<any>({});
  const [drawerState, setDrawerState] = useState<any>(false);
  const [drawerState2, setDrawerState2] = useState<any>(false);

  /* A location is opened from its own URL rather than only from a click, so it
     can be linked to, reloaded and sent to someone. The drawer stays — it is a
     good way to show a location — but it is no longer that location's only
     address. */
  const navigate = useNavigate();
  const { locationId } = useParams();
  const [open, setOpen] = useState(false);
  const { user } = useUser();
  const isTrial = user?.company_info?.is_trial === 'Y';
  const { features } = useCompanyFeatures();
  const siteAccess = features?.plan_features?.account_setting?.access?.SITE?.action;
  const canViewSites = Boolean(siteAccess?.view);
  const canAddSites = Boolean(siteAccess?.add);
  const canEditSites = Boolean(siteAccess?.edit);
  const canDeleteSites = Boolean(siteAccess?.delete);

  const { mutate: mutateSiteDelete, isPending } = useMutation({
    mutationKey: ['siteDelete'],
    mutationFn: siteDelete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['siteList'] });
      handleAlert({ text: 'Location deleted successfully', type: 'success' });
      setOpen(false);
    },
  });
  const { data: sites = [], isLoading: isSitesLoading } = useQuery({
    queryKey: ['siteList'],
    queryFn: () =>
      siteList({
        page: 1,
        limit: 1000,
      }),
    enabled: canViewSites,
    select: (data: any) => data?.data?.data?.result?.rows || [],
  });

  const defaultSite = useMemo(
    () => sites.find((site: any) => site?.is_default === '1') || null,
    [sites],
  );

  const filteredSites = useMemo(() => {
    const nameSearch = debouncedSearch?.trim()?.toLowerCase();
    const nonDefaultSites = sites.filter((site: any) => site?.is_default !== '1');
    if (!nameSearch) return nonDefaultSites;

    return nonDefaultSites.filter((site: any) => site?.name?.toLowerCase()?.includes(nameSearch));
  }, [sites, debouncedSearch]);

  const handleNewSite = () => {
    if (isTrial) return;

    if (!canAddSites) {
      return handleAlert({
        text: 'This feature is not available in your current plan. Please upgrade',
        type: 'error',
      });
    }
    setDrawerState2(true);
    setRowData({});
  };

  const handleViewSite = (site: any) => {
    if (!canViewSites) {
      return handleAlert({
        text: 'You do not have permission to view locations',
        type: 'error',
      });
    }
    /* Navigating opens the drawer through the effect below, so a click and a
       pasted URL take exactly the same path. */
    navigate(`/admin-settings/company/locations/${site?.uuid}`);
  };

  /* Opens the drawer for whichever location the URL names. Runs once the list
     has arrived, because the drawer needs the whole record and the URL carries
     only an id. An id that matches nothing is ignored rather than opening an
     empty drawer. */
  useEffect(() => {
    if (!locationId || !sites.length) return;
    const match = sites.find((site: any) => site?.uuid === locationId);
    if (!match) return;
    setRowData(match);
    setDrawerState(true);
  }, [locationId, sites]);

  /* Choosing the main location.
     
     Established systems treat this as a real setting; inbound calls fail when
     it is wrong; ours only ever displayed which location was marked. There is no
     dedicated endpoint, so the flag is sent through the ordinary site save.
     
     Whether the API honours an is_default it has never been sent before is not
     knowable from here, so the result is checked rather than assumed: the list is
     re-read and, if the flag did not move, the admin is told it was refused
     instead of being shown a success message for something that did not happen. */
  const { mutate: makeMainLocation, isPending: isSettingMain } = useMutation({
    mutationFn: (site: any) =>
      upsertSite({
        siteUUID: site?.uuid,
        name: site?.name,
        address: site?.address,
        country: site?.country,
        state: site?.state,
        city: site?.city,
        postal_code: site?.postal_code,
        timezone: site?.timezone,
        is_default: '1',
      }),
    onSuccess: async (_response: any, site: any) => {
      const fresh: any = await fetchSiteList({ page: 1, limit: 200 });
      const rows: any[] = fresh?.data?.data?.result?.rows || [];
      const moved = rows.find((row: any) => row?.uuid === site?.uuid)?.is_default === '1';

      queryClient.invalidateQueries({ queryKey: ['siteList'] });

      handleAlert({
        text: moved
          ? `${site?.name || 'That location'} is now your main location.`
          : 'The server did not accept the change, so your main location is unchanged. This needs a change on the API side.',
        type: moved ? 'success' : 'error',
      });
    },
    onError: () => {
      handleAlert({
        text: 'Could not change the main location. Nothing was changed.',
        type: 'error',
      });
    },
  });

  const handleEditSite = (site: any) => {
    if (isTrial || !canEditSites) return;
    setDrawerState2(true);
    setRowData(site);
  };

  const handleDeleteSite = (site: any, isDefault: boolean) => {
    if (isDefault || !canDeleteSites) return;
    setRowData(site);
    setOpen(true);
  };

  return (
    <section className="mcm-adminpage mcm-co">
      {/* The head was centred, alone among Admin screens, and carried no
          eyebrow. Same head as everywhere else now. */}
      <div className="mcm-adminpage-head">
        <div className="mcm-adminpage-title">
          <div className="mcm-adminpage-eyebrow">Company</div>
          <h1>Company &amp; Locations</h1>
          <p>
            Your company record and every place it operates from — address, timezone and the
            people who work there.
          </p>
        </div>
      </div>
      {!canViewSites ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3 sm:px-4">
          <div className="mx-auto flex w-full max-w-[1040px] min-h-0 flex-col gap-4">
            <div className="mcm-co-none">You do not have permission to view locations.</div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3 sm:px-4">
          <div className="mx-auto flex w-full max-w-[1040px] min-h-0 flex-col gap-4">
            {/* Organisation before locations — the order established systems
                use, and the order the platform's own data follows: a location
                belongs to a company. */}
            {/* Above the company record: it is the thing a new admin should read
                first, and it disappears once everything is done. */}
            <SetupGuide companyInfo={user?.company_info} />

            <div id="setup-company-record" className="rounded-xl">
              <CompanyRecord companyInfo={user?.company_info} defaultSite={defaultSite} />
            </div>

            {/* Company-wide rules belong on the company screen, which is where
                established systems put them and where an admin looks. The editor
                itself stays under Phone System — one editor, one record. */}
            <CompanyLogo />
            <CompanySettingsCard />

            {/* A location is not a label — it decides how calls behave for
                everyone assigned to it. Saying so here saves an admin working it
                out from the fields. */}
            <div className="mcm-co-explain">
              <p className="mcm-co-explain-h">What a location decides</p>
              <p className="mcm-co-explain-p">
                One for each place you work from — London, Dubai, Singapore — all on one bill. For
                everyone assigned to it, the location sets:
              </p>
              <ul>
                <li>
                  <b>The clock.</b> Opening and closing times are read in its timezone.
                </li>
                <li>
                  <b>The number shown.</b> What people here display when they call out.
                </li>
                <li>
                  <b>The address on record.</b> Used when buying local numbers and for
                  regulatory checks.
                </li>
              </ul>
            </div>
            <div id="setup-locations">
              <h2 className="mcm-co-sech">Main location</h2>
            </div>
            {defaultSite ? (
              <LocationCard
                site={defaultSite}
                isDefault
                canEdit={canEditSites}
                canDelete={canDeleteSites}
                isTrial={isTrial}
                onOpen={handleViewSite}
                onEdit={handleEditSite}
                onDelete={handleDeleteSite}
              />
            ) : (
              <div className="mcm-co-none">No main location set yet.</div>
            )}
            <div className="mcm-co-otherh">
              <h2 className="mcm-co-sech">
                Other locations
                <span>{filteredSites.length}</span>
              </h2>
              <div className="mcm-co-otheracts">
                <div className="mcm-faq-search">
                  <SearchLine className="size-4" />
                  <input
                    type="text"
                    placeholder="Search locations"
                    aria-label="Search locations"
                    value={search}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.startsWith(' ')) return;
                      setSearch(e.target.value);
                    }}
                  />
                </div>
                {/* Comparing locations is a different job from reading one, and
                    it needs a table rather than a column of cards. */}
                <Button
                  className="rounded-xl"
                  variant={'outline'}
                  onClick={() => navigate('/admin-settings/company/location-management')}
                >
                  <MapPin className="mr-1 h-4 w-4" />
                  Manage all locations
                </Button>
                {!isTrial && canViewSites && canAddSites && (
                  <Button
                    className="rounded-xl"
                    variant={'outline'}
                    onClick={() => handleNewSite()}
                  >
                    <Icon name="Plus" className="mr-1 h-4 w-4" />
                    New location
                  </Button>
                )}
              </div>
            </div>
            <div className="w-full flex flex-col gap-3 pb-3">
              {isSitesLoading ? (
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-8">
                  <div className="flex items-center justify-center">
                    <Loader variant="blue" size="md" />
                  </div>
                </div>
              ) : !filteredSites.length ? (
                <div className="mcm-co-none">
                  {search
                    ? `No location matches “${search}”.`
                    : 'Only the main location so far. Add another for each place you work from.'}
                </div>
              ) : (
                filteredSites.map((site: any) => (
                  <LocationCard
                    key={site?.uuid || site?.site_id}
                    site={site}
                    isDefault={site?.is_default === '1'}
                    canEdit={canEditSites}
                    canDelete={canDeleteSites}
                    isTrial={isTrial}
                    isSettingMain={isSettingMain}
                    onOpen={handleViewSite}
                    onEdit={handleEditSite}
                    onDelete={handleDeleteSite}
                    onMakeMain={makeMainLocation}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {drawerState && (
        <SideDrawer
          width="min(1040px, 84vw)"
          isOpen={drawerState}
          isTab={false}
          handleClose={() => setDrawerState(false)}
          content={<CompanyDetails data={rowData} />}
        />
      )}
      {drawerState2 && (
        <SideDrawer
          width="min(1040px, 84vw)"
          isOpen={drawerState2}
          handleClose={() => setDrawerState2(false)}
          isTab={false}
          enableResponsive
          content={<NewSiteSteps data={rowData} handleClose={() => setDrawerState2(false)} />}
        />
      )}
      <AlertConfirm
        {...{
          apiLoading: isPending,
          onConfirm: () => {
            if (!canDeleteSites) return;
            mutateSiteDelete(rowData?.uuid);
          },
          open,
          setOpen,
        }}
      />
    </section>
  );
};

export default CompanyInfo;
