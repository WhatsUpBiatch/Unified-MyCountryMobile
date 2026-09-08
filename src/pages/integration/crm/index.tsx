import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronIcon } from '@/assets/icons';
import { CRMDisconnect, crmGetToken, CRMIsConnected, hubspotCRM } from '@/services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AlertConfirm from '@/components/custom/alert-confirm';
import { crmList, crmListProps } from '../constant';
import SideDrawer from '@/components/custom/side-drawer';
import CRMConfigration from './configration';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const CRMIntegration = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [drawerState, setDrawerState] = useState<boolean>(false);
  const [drawerData, setDrawerData] = useState<crmListProps>();
  const [deleteAlertModal, setDeleteAlertModal] = useState<Record<string, boolean>>({});
  const [mondaySetupModal, setMondaySetupModal] = useState<boolean>(false);
  const queryClient: any = useQueryClient();
  const activeDeleteKey = Object?.keys(deleteAlertModal)?.find((key) => deleteAlertModal[key]);

  const { data: crmIsConnectedData = [] } = useQuery({
    queryKey: ['CRMIsConnected'],
    queryFn: () => CRMIsConnected(),
    /* `|| []` only catches a missing result. Anything else truthy — an object,
       a string, an error envelope — went straight through to `.find` below and
       threw during render, so the entire CRM page became "Error Occurred" and
       not one connector could be reached. A list is what this is; anything
       that is not a list is no connections. */
    select: (data) => {
      const result = data?.data?.data?.result;
      return Array.isArray(result) ? result : [];
    },
  });

  const { mutateAsync: hubspotCRMMutation } = useMutation({
    mutationKey: ['crmIntegration'],
    mutationFn: hubspotCRM,
  });

  const handleConnect = async (crm: crmListProps, bypassModal = false) => {
    const type = crm?.label?.split('-')?.[0]?.toUpperCase();

    if (crm.id === 'Monday' && !bypassModal) {
      setMondaySetupModal(true);
      return;
    }

    try {
      const response = await hubspotCRMMutation(type);
      const url = response?.data?.data?.result;

      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      console.error('Failed to connect CRM:', error);
    }
  };

  const { mutate: mutateGetToken } = useMutation({
    mutationFn: crmGetToken,
    onSettled: () => navigate(window.location.pathname, { replace: true }),
    onSuccess: () => queryClient.invalidateQueries(['CRMIsConnected'], { exact: true }),
  });

  const { mutate: mutateDisconnect, isPending } = useMutation({
    mutationKey: ['CRMDisconnect'],
    mutationFn: CRMDisconnect,
    onSuccess: () => {
      if (activeDeleteKey) {
        setDeleteAlertModal((prev) => ({ ...prev, [activeDeleteKey]: false }));
      }
      queryClient.invalidateQueries(['CRMIsConnected']);
    },
  });
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      navigate(window.location.pathname, { replace: true });
      return;
    }
    if (code && state) {
      mutateGetToken({ code, type: state });
    }
  }, [searchParams]);

  const getConnectionStatus = (crmName: string) => {
    const connectedItem = crmIsConnectedData?.find((item: { type: string }) =>
      crmName?.toLowerCase()?.includes(item?.type?.toLowerCase()),
    );
    return connectedItem?.is_connected || false;
  };

  const getConnectedItem = (crmName: string) => {
    return crmIsConnectedData?.find((item: { type: string }) =>
      crmName?.toLowerCase()?.includes(item?.type?.toLowerCase()),
    );
  };

  return (
    <section className="mcm-intpage">
      <div className="mcm-intpage-head">
        <div className="mcm-intpage-eyebrow">Integration</div>
        <h1>CRM</h1>
        <p>
          Connect the system your team already works in, so calls, contacts and activity flow both
          ways.
        </p>
      </div>
      <div className="mcm-intgrid">
        {crmList?.map((crm) => {
          const isConnected = getConnectionStatus(crm.id);

          return (
            <div key={crm?.name} className={`mcm-intcard${isConnected ? ' is-on' : ''}`}>
              <div className="flex flex-col gap-5 w-full">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-start w-full">
                    <span className="mcm-intcard-mark">
                      <img src={crm?.image} alt={crm?.alt} />
                    </span>
                    {/* The overflow menu that used to sit here held Manage and
                        Delete. Both are in the card's footer now, named and
                        visible, so keeping the menu would be two ways to reach
                        the same two actions on the same card. */}
                  </div>
                  <div className="mcm-intcard-t">
                    <h4>{crm.name}</h4>
                    {/* Whether this account has it connected. The card said so
                        only through the presence of a switch, at the very
                        bottom, after the description — so a grid of eight read
                        as eight identical offers. */}
                    {isConnected ? <span className="mcm-intcard-on">Connected</span> : null}
                  </div>
                  <p className="mcm-intcard-d">{crm.description}</p>
                </div>
              </div>
              {/* Three states, three footers. "Coming soon" was a clickable-
                  looking line that did nothing when clicked, and the connected
                  footer carried a switch wired to nothing — no onCheckedChange,
                  so it snapped back on every click — beside a tip explaining
                  where the real controls were. The controls are here instead. */}
              {crm?.comingSoon ? (
                <span className="mcm-intcard-soon">Coming soon</span>
              ) : !isConnected ? (
                <button
                  type="button"
                  className="mcm-intcard-go"
                  onClick={() => handleConnect(crm)}
                >
                  Connect
                  <ChevronIcon className="-rotate-90" />
                </button>
              ) : (
                <div className="mcm-intcard-acts">
                  <button
                    type="button"
                    className="mcm-intcard-go"
                    onClick={() => {
                      setDrawerState(true);
                      setDrawerData(crm);
                    }}
                  >
                    Manage
                    <ChevronIcon className="-rotate-90" />
                  </button>
                  <button
                    type="button"
                    className="mcm-intcard-off"
                    onClick={() => setDeleteAlertModal({ [crm?.id]: true })}
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <AlertConfirm
          {...{
            onConfirm: () => {
              const convertToUppercase = activeDeleteKey?.toUpperCase();
              mutateDisconnect({ type: convertToUppercase });
            },
            apiLoading: isPending,
            open: !!activeDeleteKey,
            setOpen: (val) => {
              if (!val && activeDeleteKey) {
                setDeleteAlertModal((prev) => ({ ...prev, [activeDeleteKey]: false }));
              }
            },
          }}
        />
        {drawerState && (
          <SideDrawer
            isOpen={drawerState}
            title="Configurations"
            isTab={false}
            enableResponsive
            responsiveWidth="96vw"
            responsiveBreakpoint={1024}
            handleClose={() => setDrawerState(false)}
            content={<CRMConfigration drawerData={drawerData} setDrawerState={setDrawerState} />}
          />
        )}
        {mondaySetupModal && (
          <Dialog open={mondaySetupModal} onOpenChange={setMondaySetupModal}>
            <DialogContent className="max-w-md p-6 rounded-2xl border border-gray-100 bg-white shadow-2xl">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                  <img
                    src={crmList.find((item) => item.id === 'Monday')?.image}
                    alt="Monday"
                    className="w-10 h-10 object-contain"
                  />
                  <div className="h-6 w-px bg-slate-200" />
                  {/* <img src={McmLogo} alt="UCAAS" className="w-10 h-10 object-contain" /> */}
                </div>
                <DialogTitle className="text-xl font-bold text-gray-900">
                  Monday Integration Setup
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-500 max-w-xs">
                  To connect monday.com, please follow these steps:
                </DialogDescription>
              </div>

              <div className="flex flex-col gap-3.5 my-6">
                <div className="flex gap-3 bg-slate-50/50 p-3.5 rounded-xl border border-slate-100">
                  <span className="flex items-center justify-center shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold mt-0.5">
                    1
                  </span>
                  <div className="flex flex-col text-left">
                    <span className="text-sm font-semibold text-gray-800">Install Monday App</span>
                    <span className="text-xs text-gray-500 mt-0.5">
                      Click the install button to install the app.
                    </span>
                  </div>
                </div>
                <div className="flex gap-3 bg-slate-50/50 p-3.5 rounded-xl border border-slate-100">
                  <span className="flex items-center justify-center shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold mt-0.5">
                    2
                  </span>
                  <div className="flex flex-col text-left">
                    <span className="text-sm font-semibold text-gray-800">
                      Authorize Connection
                    </span>
                    <span className="text-xs text-gray-500 mt-0.5">
                      After installing, click connect to sync contacts and call logs.
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  type="button"
                  onClick={() => {
                    const appUrl = getConnectedItem('Monday')?.app_url;
                    if (appUrl) {
                      window.open(appUrl, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="flex-1 flex items-center justify-center h-10 text-sm font-bold text-primary bg-primary/5 hover:bg-primary/10 rounded-xl border border-primary/10 transition-all active:scale-[0.98]"
                >
                  Step 1: Install App
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMondaySetupModal(false);
                    const crm = crmList.find((item) => item.id === 'Monday');
                    if (crm) handleConnect(crm, true);
                  }}
                  className="flex-1 flex items-center justify-center h-10 text-sm font-bold text-white bg-primary hover:bg-primary/95 rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
                >
                  Step 2: Connect
                </button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </section>
  );
};

export default CRMIntegration;
