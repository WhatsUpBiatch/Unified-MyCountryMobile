import { useLocation } from 'react-router-dom';
import { TabRail } from '@/components/mcm/tab-rail';
import Identities from './Identities';
import Addresses from './addresses';
import Verification from './verification';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import useDebounce from '@/hooks/use-debounce';
// import { Button } from '@/components/ui/button';
// import { Plus, SearchLine } from '@/assets/icons';
import { SearchLine } from '@/assets/icons';
import SideDrawer from '@/components/custom/side-drawer';
import CreateNewAddress from './addresses/create-new-address';
import { AdminPage } from '@/pages/admin-settings/page-shell';
/* The three views, in the order a record is built: who the number is
   registered to, where it is served from, and what the carrier has said about
   it. Each keeps its own address so a view can be linked to and reloaded. */
const TABS = [
  { key: 'identities', label: 'Identities', path: '/admin-settings/numbers/identities' },
  { key: 'addresses', label: 'Addresses', path: '/admin-settings/numbers/addresses' },
  { key: 'verifications', label: 'Verifications', path: '/admin-settings/numbers/verifications' },
];
const IdentitiesAndAddressesPageLayout = () => {
  const [search, setSearch] = useState<string>('');
  const debouncedSearch = useDebounce(search, 800);
  const { pathname } = useLocation();
  const getActiveTab = pathname?.split('/')[pathname?.split('/')?.length - 1];
  const activeTab = getActiveTab?.toLocaleLowerCase();
  const [drawerState, setDrawerState] = useState({
    addNewAddress: false,
  });
  const handleClose = (drawerName: string) =>
    setDrawerState((prev) => ({ ...prev, [drawerName]: false }));

  const RenderTabComponents = {
    identities: <Identities search={debouncedSearch} />,
    addresses: <Addresses search={debouncedSearch} />,
    verifications: <Verification search={debouncedSearch} />,
  };

  return (
    <>
      <AdminPage
        section="Numbers"
        title="Identities & addresses"
        description="The registered identities and service addresses your numbers are issued against. Records are created while buying a number that requires one — this page is where you review and edit them."
        filters={
          <Input
            placeholder="Search identities and addresses"
            className="pl-10 w-full max-w-sm min-h-9 rounded-lg"
            IconPosition="left-0 pl-2 inset-y-0"
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith(' ')) return;
              setSearch(e.target.value);
            }}
            Icon={<SearchLine className=" text-gray-700" />}
          />
        }
      >
        {/* The panel the Numbers views sit on, so the two screens under the
            same sidebar heading are the same shape. The tab strip is the
            shared one rather than a Radix Tabs list styled to look nearly like
            it: these three are routes, and Radix was being told the active tab
            by the URL and then asked to navigate on change — a control
            pretending to hold state it never held. */}
        <section className="cs-section flex w-full flex-col">
          <TabRail
            items={TABS.map((tab) => ({ to: tab.path, label: tab.label }))}
            ariaLabel="Identity views"
          />
          {RenderTabComponents[activeTab as keyof typeof RenderTabComponents]}
        </section>
      </AdminPage>
      {drawerState.addNewAddress && (
        <SideDrawer
          width="min(1040px, 84vw)"
          title="Add New Address"
          isOpen={drawerState.addNewAddress}
          isTab={false}
          handleClose={() => handleClose('addNewAddress')}
          content={<CreateNewAddress />}
        />
      )}
    </>
  );
};

export default IdentitiesAndAddressesPageLayout;
