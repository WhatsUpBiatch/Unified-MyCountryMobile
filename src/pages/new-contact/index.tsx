import { Icon } from '@/assets/icons/icon';
import '@/components/mcm/mcm-page.css';
import { Button } from '@/components/ui/button';
import { handleAlert, normalizeSearchText } from '@/lib/utils';
import { deleteContact, deleteLeadGroup, getContactList, syncContacts } from '@/services/api';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import {
  describeSyncPlan,
  planContactSync,
  syncPayload,
  syncWouldChangeAnything,
} from '@/lib/contact-sync';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FC, useState } from 'react';
import AlertConfirm from '@/components/custom/alert-confirm.tsx';
import SideDrawer from '@/components/custom/side-drawer.tsx';
import AllNewContactsList from './all-contacts-list/index.tsx';
import { Input } from '@/components/ui/input.tsx';
import { SearchLine } from '@/assets/icons/index.tsx';
import useDebounce from '@/hooks/use-debounce.tsx';
// import { IContact } from '../leads/index.tsx';
import CreateContactNew from './create-new-contact.tsx';
import ContactDetailDrawer, { type ContactRecord } from './contact-detail-drawer.tsx';
import { McmIconSprite } from '@/components/mcm/icons';
import SendWhatsappMessage from '../messenger/drawers/send-whatsapp-message/index.tsx';
import { useGoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useUser } from '@/hooks/use-user';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { CONTACT_TABS_CONST, LEAD_CREATE_TYPE } from '../leads/const.ts';
import { useLocation } from 'react-router-dom';
import LeadsGroupList from '../leads/lead-group-list/index.tsx';
import CreateNewLeadGroup from '../leads/add-group-lead-modal/index.tsx';
import LeadContactLogs from '../leads/lead-contact-logs/index.tsx';
import NotesWidget from '@/components/notes/index.tsx';
import UploadContacts from '../leads/upload-contacts.tsx/index.tsx';
import ExportContacts from '../leads/export-contacts.tsx/index.tsx';
import { useCompanyFeatures } from '@/hooks/rbac';
import { useGetGroupList } from '@/hooks/common';
import CustomSelect from '@/components/custom/custom-select';

interface IDrawerState {
  addContact: boolean;
  selectedContact: any;
  addLead: boolean;
  selectedGroup: any;
  updateContacts: boolean;
  exportContacts: boolean;
}

const NewContact: FC = () => {
  const [search, setSearch] = useState<string>('');
  const { features } = useCompanyFeatures();
  const contactFeature = features?.plan_features?.contact || {};
  const contactActions = contactFeature?.action || {};
  const canViewContact = Boolean(contactFeature?.IS_SHOW && contactActions?.view);
  const canAddContact = Boolean(contactActions?.add);
  const canEditContact = Boolean(contactActions?.edit);
  const canDeleteContact = Boolean(contactActions?.delete);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState<any>(null);
  const debouncedSearch = useDebounce(search, 1000);
  const normalizedSearch = normalizeSearchText(debouncedSearch);
  const queryClient: any = useQueryClient();

  const [drawerState, setDrawerState] = useState<IDrawerState>({
    addContact: false,
    selectedContact: null,
    addLead: false,
    selectedGroup: null,
    updateContacts: false,
    exportContacts: false,
  });
  const { state } = useLocation();
  const { defaultTab } = state || {};
  const [notesOpen, setNotesOpen] = useState(false);
  const [whatsappDrawerOpen, setWhatsappDrawerOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  /* Opening a contact is a read, not an edit. The panel shows everything stored
     about them with the four ways to reach them; Edit is one press further on,
     for the times you actually wanted the form. */
  const [openContact, setOpenContact] = useState<ContactRecord | null>(null);
  const [selectedGroupForContactLogs, setSelectedGroupForContactLogs] = useState<any>(null);
  const [tabName, setTabName] = useState<string>(defaultTab || CONTACT_TABS_CONST.CONTACT_LIST);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const { data: groupList = [] } = useGetGroupList({
    type: 'CONTACT',
    generatedBy: null,
    displayType: 'dropdown',
  });

  const [confirmModelState, setConfirmState] = useState<{
    isModal: boolean;
    selectedGroupId: string;
  }>({
    isModal: false,
    selectedGroupId: '',
  });

  const { mutate: mutateDeleteContact, isPending: isPendingDeleteContact } = useMutation({
    mutationFn: deleteContact,
    onSuccess: (data) => {
      if (data?.data?.success) {
        handleAlert({
          text: data?.data?.data?.message || 'Contact deleted successfully!',
          type: 'success',
        });
        setShowDeleteConfirmation(null);
        queryClient.invalidateQueries(['newContactListQuery']);
        queryClient.invalidateQueries(['contactList']);
      }
    },
  });

  const { mutate: mutateDeleteGroup, isPending: isPendingDeleteGroup } = useMutation({
    mutationFn: deleteLeadGroup,
    onSuccess: (data) => {
      if (data?.data?.success) {
        console.log(data?.data?.success, 'success');

        handleAlert({
          text: data?.data?.data?.message || 'Contact group deleted successfully!',
          type: 'success',
        });
        setConfirmState({
          isModal: false,
          selectedGroupId: '',
        });
        queryClient.invalidateQueries(['getGroupListQuery']);
      }
    },
  });

  const handleAddContact = () => {
    if (!canAddContact) return;
    setDrawerState((prev) => ({
      ...prev,
      addContact: true,
      selectedContact: null,
    }));
  };

  const handleAddLeadGroup = () => {
    if (!canAddContact) return;
    setDrawerState((prev) => ({
      ...prev,
      addLead: true,
      selectedGroup: null,
    }));
  };

  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/contacts.readonly',

    onSuccess: async (tokenResponse) => {
      console.log('TOKEN RESPONSE RECEIVED:', tokenResponse);

      try {
        console.log('Initiating Google API fetch for contacts...');

        let connections: any[] = [];
        let nextPageToken = '';
        let hasNextPage = true;

        while (hasNextPage) {
          const url = `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers&pageSize=2000&requestSyncToken=false${
            nextPageToken ? `&pageToken=${nextPageToken}` : ''
          }`;

          const res = await fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${tokenResponse.access_token}`,
            },
          });

          if (!res.ok) {
            throw new Error(`Google API responded with status ${res.status}`);
          }

          const pageData = await res.json();
          if (pageData.connections) {
            connections = [...connections, ...pageData.connections];
          }

          nextPageToken = pageData.nextPageToken || '';
          hasNextPage = !!nextPageToken;
        }

        /* One entry per person, in the four fields the contact book keeps.
           Google returns numbers in whatever shape they were typed, so they are
           passed through as they came and matched on their digits later. */
        const fromGoogle = connections.map((conn: any) => {
          const nameObj = conn.names?.[0] || {};
          return {
            name: `${nameObj.givenName || nameObj.displayName || ''} ${nameObj.familyName || ''}`.trim(),
            phone: conn.phoneNumbers?.[0]?.canonicalForm || conn.phoneNumbers?.[0]?.value || '',
            email: conn.emailAddresses?.[0]?.value || '',
            externalId: conn.resourceName || '',
          };
        });

        /* Everything already stored, so the same address book can be brought in
           again without saving a second copy of everybody. Without this, the
           import created a duplicate of every contact on every run. */
        const stored = await fetchAllPages(getContactList);
        const plan = planContactSync(fromGoogle, stored);

        if (!syncWouldChangeAnything(plan)) {
          handleAlert({ text: describeSyncPlan(plan), type: 'info' });
          return;
        }

        await syncContacts(syncPayload(plan));

        handleAlert({ text: describeSyncPlan(plan), type: 'success' });

        queryClient.invalidateQueries({ queryKey: ['getContactList'] });
        queryClient.invalidateQueries({ queryKey: ['contactList'] });
      } catch (err) {
        console.error('FETCH OR IMPORT ERROR:', err);
        handleAlert({
          text: `Failed to import contacts: ${err instanceof Error ? err.message : String(err)}`,
          type: 'error',
        });
      }
    },

    onError: (errorResponse) => {
      console.error('GOOGLE LOGIN ERROR:', errorResponse);
      handleAlert({
        text: `Google Login Failed! Error: ${JSON.stringify(errorResponse)}`,
        type: 'error',
      });
    },
  });

  const payloadExtraParams: any = {
    ...(normalizedSearch ? { search: normalizedSearch } : {}),
    ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
    ...(selectedTag
      ? {
          filters: [
            selectedTag === 'VIP'
              ? { key: 'tag', value: 'VIP' }
              : selectedTag === 'BLOCK'
                ? { key: 'tag', value: 'BLOCK' }
                : selectedTag === 'DNC'
                  ? { key: 'tag', value: 'DNC' }
                  : selectedTag === 'STANDARD'
                    ? { key: 'tag', value: 'STANDARD' }
                    : null,
          ].filter(Boolean),
        }
      : {}),
  };

  const handleTabChange = (value: string) => {
    setTabName(value);
    setSelectedGroupId(null);
    setSelectedTag(null);
    if (value !== CONTACT_TABS_CONST.CONTACT_GROUP_LIST) {
      setSelectedGroupForContactLogs(null);
    }
  };

  const addActionLabel =
    tabName === CONTACT_TABS_CONST.CONTACT_GROUP_LIST ? 'Add Group' : 'Add Contact';

  return (
    <>
      <section className="mcm-page flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
        {!canViewContact ? null : selectedGroupForContactLogs ? (
          <LeadContactLogs
            groupData={selectedGroupForContactLogs}
            onBack={() => setSelectedGroupForContactLogs(null)}
            setDrawerState={setDrawerState}
            setShowDeleteConfirmation={canDeleteContact ? setShowDeleteConfirmation : () => void 0}
            contextType="new-contact"
          />
        ) : (
          <>
            {/* The page says what it is. Without this the screen opened straight
                onto a tab strip whose first tab is also called "Contact view",
                which named the tab twice and the page not at all. */}
            <div className="contacts-page-head">
              <McmIconSprite />
              <div className="contacts-page-head-text">
                <h1>Contacts</h1>
                <p>
                  People outside the organisation — who they work for, how to reach them, and every
                  channel you can use.
                </p>
              </div>
              {canAddContact ? (
                /* The primary action belongs where somebody looks for it. It
                   was a bare "+" in a row of icon buttons, which does not say
                   what it adds. */
                <Button
                  type="button"
                  className="btn primary contacts-page-head-add"
                  onClick={() =>
                    tabName === CONTACT_TABS_CONST.CONTACT_GROUP_LIST
                      ? handleAddLeadGroup()
                      : handleAddContact()
                  }
                >
                  <Icon name="Plus" className="h-3 w-3 shrink-0" />
                  {addActionLabel}
                </Button>
              ) : null}
            </div>

            {/* Header bar */}
            <div className="border-b border-gray-200 bg-white">
              <div /* 16px to line the toolbar up with the page heading above it, which
                   sits at 16px — at 12px the two edges disagreed. */
                className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="w-full shrink-0 overflow-x-auto lg:w-auto lg:min-w-0 lg:shrink lg:flex-1">
                  <Tabs
                    value={tabName}
                    onValueChange={handleTabChange}
                    className="flex w-max min-w-full lg:min-w-0"
                  >
                    <div className="h-full min-w-max">
                      <TabsList className="ptabstrip" style={{ margin: 0, border: 0 }}>
                        <TabsTrigger value={CONTACT_TABS_CONST.CONTACT_LIST}>
                          <span className="whitespace-nowrap">
                            {CONTACT_TABS_CONST.CONTACT_LIST}
                          </span>
                        </TabsTrigger>
                        <TabsTrigger value={CONTACT_TABS_CONST.CONTACT_GROUP_LIST}>
                          <span className="whitespace-nowrap">
                            {CONTACT_TABS_CONST.CONTACT_GROUP_LIST}
                          </span>
                        </TabsTrigger>
                      </TabsList>
                    </div>
                  </Tabs>
                </div>

                <div className="flex w-full flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-end sm:pb-0 md:max-lg:flex-row md:max-lg:flex-nowrap md:max-lg:items-center md:max-lg:pb-3 lg:w-auto lg:min-w-0 lg:flex-none lg:pb-0">
                  <Button
                    onClick={() => login()}
                    variant="outline"
                    /* Every control on this row is 40px. Left at the Button
                       default it sat 4px short of the search box beside it. */
                    className="btn ghost min-h-10 w-full rounded-xl sm:w-auto md:max-lg:shrink-0"
                  >
                    Sync With Google
                  </Button>

                  <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center md:max-lg:min-w-0 md:max-lg:flex-1 md:max-lg:flex-nowrap lg:w-auto lg:min-w-0 lg:flex-nowrap">
                    <Input
                      placeholder="Search"
                      className="min-h-10 w-full rounded-xl pl-10 sm:min-w-[6rem] md:min-w-[8rem] md:max-lg:min-w-0 md:max-lg:flex-1 lg:min-w-[12rem] xl:min-w-[18rem]"
                      IconPosition="left-0 pl-2 inset-y-0"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                      }}
                      Icon={<SearchLine className="text-gray-700" />}
                    />
                    {tabName === CONTACT_TABS_CONST.CONTACT_LIST && (
                      <>
                        <div className="w-full sm:w-44 md:max-lg:w-40 md:max-lg:shrink-0">
                          <CustomSelect
                            isClearable
                            placeholder="Group"
                            options={groupList?.map((group: any) => ({
                              label: group.groupName || group.name || '',
                              value: group._id,
                            }))}
                            handleChange={(e: any) => setSelectedGroupId(e ? e.value : null)}
                            value={
                              selectedGroupId
                                ? {
                                    label:
                                      groupList.find((g: any) => g._id === selectedGroupId)
                                        ?.groupName || '',
                                    value: selectedGroupId,
                                  }
                                : null
                            }
                            inputClass="team_chat"
                          />
                        </div>
                        <div className="w-full sm:w-40 md:max-lg:w-36 md:max-lg:shrink-0">
                          <CustomSelect
                            isClearable
                            placeholder="Tag"
                            options={[
                              { label: 'Standard', value: 'STANDARD' },
                              { label: 'VIP', value: 'VIP' },
                              { label: 'Blocked', value: 'BLOCK' },
                              { label: 'DNC', value: 'DNC' },
                            ]}
                            handleChange={(e: any) => setSelectedTag(e ? e.value : null)}
                            value={
                              selectedTag
                                ? {
                                    label:
                                      selectedTag === 'BLOCK'
                                        ? 'Blocked'
                                        : selectedTag === 'STANDARD'
                                          ? 'Standard'
                                          : selectedTag,
                                    value: selectedTag,
                                  }
                                : null
                            }
                            inputClass="team_chat"
                          />
                        </div>
                      </>
                    )}
                    <div className="flex items-center gap-3 md:max-lg:shrink-0">
                      {canAddContact ? (
                        <>
                          <Button
                            className="cursor-pointer flex items-center justify-center min-h-10 min-w-10 max-w-10 max-h-10 rounded-xl w-10 h-10 bg-white border border-primary text-primary hover:bg-primary hover:text-white"
                            type="button"
                            onClick={() =>
                              setDrawerState((prev) => ({ ...prev, updateContacts: true }))
                            }
                            title="Upload Contacts"
                          >
                            <Icon name="UploadLineIcon" className="w-5 h-5" />
                          </Button>
                          {tabName === CONTACT_TABS_CONST.CONTACT_LIST && (
                            <>
                              <Button
                                className="cursor-pointer flex items-center justify-center min-h-10 min-w-10 max-w-10 max-h-10 rounded-xl w-10 h-10 bg-white border border-primary text-primary hover:bg-primary hover:text-white"
                                type="button"
                                onClick={() =>
                                  setDrawerState((prev) => ({ ...prev, exportContacts: true }))
                                }
                                title="Export Contacts"
                              >
                                <Icon name="DownloadLine" className="w-5 h-5" />
                              </Button>
                            </>
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Content area */}

            <div className="flex w-full min-h-0 flex-1 flex-col gap-2">
              {(() => {
                switch (tabName) {
                  case CONTACT_TABS_CONST.CONTACT_LIST:
                    return (
                      <AllNewContactsList
                        setDrawerState={setDrawerState}
                        setShowDeleteConfirmation={
                          canDeleteContact ? setShowDeleteConfirmation : () => void 0
                        }
                        payloadExtraParams={payloadExtraParams}
                        permissionAccess={{
                          canView: canViewContact,
                          canEdit: canEditContact,
                          canDelete: canDeleteContact,
                        }}
                        handleNotesOpen={(contact: any) => {
                          setNotesOpen(true);
                          setSelectedContact(contact);
                        }}
                        handleWhatsappOpen={(contact: any) => {
                          setWhatsappDrawerOpen(true);
                          setSelectedContact(contact);
                        }}
                        onOpenContact={setOpenContact}
                      />
                    );
                  case CONTACT_TABS_CONST.CONTACT_GROUP_LIST:
                    return (
                      <LeadsGroupList
                        {...{
                          setConfirmState,
                          setDrawerState,
                          isLead: false,
                          permissionAccess: {
                            canEdit: canEditContact,
                            canDelete: canDeleteContact,
                          },
                          onOpenContactLogs: (group: any) => setSelectedGroupForContactLogs(group),
                          search: normalizedSearch,
                        }}
                      />
                    );
                  default:
                    return (
                      <AllNewContactsList
                        setDrawerState={setDrawerState}
                        setShowDeleteConfirmation={
                          canDeleteContact ? setShowDeleteConfirmation : () => void 0
                        }
                        payloadExtraParams={payloadExtraParams}
                        permissionAccess={{
                          canView: canViewContact,
                          canEdit: canEditContact,
                          canDelete: canDeleteContact,
                        }}
                        handleNotesOpen={(contact: any) => {
                          setNotesOpen(true);
                          setSelectedContact(contact);
                        }}
                        handleWhatsappOpen={(contact: any) => {
                          setWhatsappDrawerOpen(true);
                          setSelectedContact(contact);
                        }}
                        onOpenContact={setOpenContact}
                      />
                    );
                }
              })()}
            </div>

            {/* <div className="w-full flex flex-col gap-2">
        
        </div> */}
          </>
        )}

        {/* Inside `.mcm-page`: the drawer's styles are scoped to it, and it is
            position:fixed so it still covers the viewport from here. */}
        <ContactDetailDrawer
          contact={openContact}
          onClose={() => setOpenContact(null)}
          onEdit={
            canEditContact
              ? (contact) => {
                  setOpenContact(null);
                  setDrawerState((prev) => ({
                    ...prev,
                    addContact: true,
                    selectedContact: contact,
                  }));
                }
              : undefined
          }
        />
      </section>

      <AlertConfirm
        {...{
          apiLoading: isPendingDeleteGroup,
          onConfirm: () => {
            mutateDeleteGroup({ groupId: confirmModelState?.selectedGroupId, type: 'CONTACT' });
          },
          open: confirmModelState?.isModal,
          setOpen: () => {
            setConfirmState({
              isModal: false,
              selectedGroupId: '',
            });
          },
        }}
      />

      {/* Add / Edit Contact Drawer */}
      {canAddContact && drawerState?.addContact && (
        <SideDrawer
          width="min(500px, 94vw)"
          isHeader
          isOpen={drawerState?.addContact}
          title={
            drawerState?.selectedContact
              ? `Update Contact (${drawerState?.selectedContact?.name?.first || ''} ${drawerState?.selectedContact?.name?.last || ''})`
              : 'Add Contact'
          }
          handleClose={() => setDrawerState((prev) => ({ ...prev, addContact: false }))}
          content={
            <CreateContactNew
              contactData={drawerState?.selectedContact}
              isDisable={false}
              setIsDisable={() => void 0}
              setDrawerState={() => void 0}
              keepFormDataAfterSave
              isLead={false}
              handleClose={() => setDrawerState((prev) => ({ ...prev, addContact: false }))}
            />
          }
        />
      )}

      {notesOpen && (
        <SideDrawer
          width="min(500px, 94vw)"
          isOpen={notesOpen}
          title={`Contact Notes (${selectedContact?.name?.first || ''} ${selectedContact?.name?.last || ''})`}
          handleClose={() => setNotesOpen(false)}
          content={
            <NotesWidget
              customClass="h-full"
              extraPayload={{ phone: selectedContact?.contact?.phone }}
              contactId={selectedContact?._id || ''}
            />
          }
        />
      )}

      {whatsappDrawerOpen && (
        <SideDrawer
          width="min(500px, 94vw)"
          // isHeader
          isOpen={whatsappDrawerOpen}
          title="Send WhatsApp Message"
          handleClose={() => setWhatsappDrawerOpen(false)}
          content={
            <SendWhatsappMessage
              handleClose={() => setWhatsappDrawerOpen(false)}
              initialNumber={selectedContact?.contact?.phone}
            />
          }
        />
      )}

      {/* Delete confirmation */}
      {canDeleteContact && !!showDeleteConfirmation && (
        <AlertConfirm
          {...{
            apiLoading: isPendingDeleteContact,
            onConfirm: () => {
              mutateDeleteContact({ contact_uuid: [showDeleteConfirmation?._id] });
            },
            open: !!showDeleteConfirmation,
            setOpen: () => setShowDeleteConfirmation(null),
          }}
        />
      )}
      {canAddContact && drawerState.addLead && (
        <CreateNewLeadGroup
          group={drawerState?.selectedGroup}
          selectedCreateType={LEAD_CREATE_TYPE.ADD_NEW}
          onAddInExistingGroup={() => void 0}
          selectedLeads={[]}
          modalState={drawerState.addLead}
          setModalState={() =>
            setDrawerState((prev) => ({
              ...prev,
              addLead: false,
              selectedGroup: null,
            }))
          }
        />
      )}
      {canAddContact ? (
        <>
          <UploadContacts
            drawerState={drawerState.updateContacts}
            setDrawerState={(val) => setDrawerState((prev) => ({ ...prev, updateContacts: val }))}
          />
          <ExportContacts
            drawerState={drawerState.exportContacts}
            setDrawerState={(val) => setDrawerState((prev) => ({ ...prev, exportContacts: val }))}
          />
        </>
      ) : null}
    </>
  );
};

const NewContactWithProvider = () => {
  const { user } = useUser();
  const DEFAULT_CLIENT_ID =
    '285675733526-2rrr5cskrljog7f9s6ndm85198d5es29.apps.googleusercontent.com';
  const googleClientId = user?.google_client_id || DEFAULT_CLIENT_ID;

  return (
    <GoogleOAuthProvider key={googleClientId} clientId={googleClientId}>
      <NewContact />
    </GoogleOAuthProvider>
  );
};

export default NewContactWithProvider;
