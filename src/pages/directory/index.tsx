import { Suspense } from 'react';
import { useSearchParamManager } from '@/hooks/use-search-params';
import Loader from '@/components/custom/loader';
import People from './people';
import Groups from './groups';
import Contacts from '../new-contact';
import Locations from './locations';
import Roles from './roles';
import Favourites from './favourites';
import Blocked from './blocked';
import '@/components/mcm/mcm-page.css';

/**
 * Directory.
 *
 * The console splits this into People, Groups, Locations, External and
 * Favourites; the platform had it as Contact and Department. The names here
 * follow the console, and each one maps onto whichever platform surface
 * actually holds that data:
 *
 *   People     -> the organisation roster (users / extensions)
 *   Groups     -> departments
 *   Locations  -> sites
 *   External   -> the contact book — the platform's own Contacts page. There
 *                 used to be a second, read-only list of the same records
 *                 here, and its "New contact" button simply navigated to the
 *                 other one; two pages of the same contacts is one page too
 *                 many, so the one that can actually create, import, group and
 *                 export them is the one that stayed.
 *   Favourites -> no platform equivalent; pinned locally, see
 *                 `use-directory-favourites`
 *   Blocked    -> the contact book's Blocked tag, which had no list of its own
 */

const Directory = () => {
  const { getParam } = useSearchParamManager();
  const view = String(getParam('view') || 'people');

  return (
    <div className="mcm-page">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Loader variant="blue" />
          </div>
        }
      >
        {view === 'people' && <People />}
        {view === 'groups' && <Groups />}
        {view === 'roles' && <Roles />}
        {view === 'external' && <Contacts />}
        {view === 'locations' && <Locations />}
        {view === 'favourites' && <Favourites />}
        {view === 'blocked' && <Blocked />}
      </Suspense>
    </div>
  );
};

export default Directory;
