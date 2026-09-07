import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import UserProvider from './context/user-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Suspense } from 'react';
import FullPageLoader from './components/custom/full-page-loader';

import 'react-datepicker/dist/react-datepicker.css';
import 'tui-calendar/dist/tui-calendar.css';

import { GoogleOAuthProvider } from '@react-oauth/google';
import { useUser } from './hooks/use-user';
import { CampaignProvider } from './context/campaign-context';
import { OrganizationProvider } from './context/organization-context';
import { DialpadProvider } from './context/dialpad-context';
import { UsersDirectoryProvider } from './context/users-directory-context';
import NewBuildNotice from '@/components/custom/new-build-notice';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: false,
    },
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const GoogleOAuthProviderWrapper = ({ children }: { children: React.ReactNode }) => {
  const { user } = useUser();
  const DEFAULT_CLIENT_ID =
    '285675733526-2o55qj8ogir1d5qfl9jugpccmg4o96mb.apps.googleusercontent.com';
  const googleClientId = user?.google_client_id || DEFAULT_CLIENT_ID;

  return (
    <GoogleOAuthProvider
      clientId={googleClientId}
      onScriptLoadSuccess={() => console.log('Scriptloaded')}
    >
      {children}
    </GoogleOAuthProvider>
  );
};

const App = () => {
  const appEnv = String(import.meta.env.VITE_APP_ENV || '').toLowerCase();
  if (appEnv === 'production' || appEnv === 'prod') {
    console.log = () => {};
  }
  return (
    <Suspense fallback={<FullPageLoader />}>
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider>
          <UserProvider>
            <UsersDirectoryProvider>
              <CampaignProvider>
                <DialpadProvider>
                  <GoogleOAuthProviderWrapper>
                    <RouterProvider router={router} />
                  </GoogleOAuthProviderWrapper>
                </DialpadProvider>
              </CampaignProvider>
            </UsersDirectoryProvider>
          </UserProvider>
          <ToastContainer />
          <NewBuildNotice />
        </OrganizationProvider>
      </QueryClientProvider>
    </Suspense>
  );
};

export default App;
