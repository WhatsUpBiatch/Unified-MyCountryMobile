import { FC, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { deleteGreeting, deleteMedia, getGreetings } from '@/services/api';
import { Icon, IconName } from '@/assets/icons/icon';
import TableManager from '@/components/custom/table-manager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser } from '@/hooks/use-user';
import {
  capitalizeFirstLetter,
  DEFAULT_RECORDING_UUIDS,
  formatDate,
  formatDuration,
  formatSize,
  getEnv,
  handleAlert,
  MEDIA_URL,
} from '@/lib/utils';
import AudioModal from '@/pages/phone/audio-dialog';
import AlertConfirm from '@/components/custom/alert-confirm';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AddGreeting from '../add-greeting';
import EditGreeting from '../edit-greeting';
import { SearchLine } from '@/assets/icons';
import CustomTooltip from '@/components/custom/custom-tooltip';
import { useCompanyFeatures } from '@/hooks/rbac';

const GreetingContent: FC = () => {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [recordingUrl, serRecordingUrl] = useState<any>('');
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  /* `?mine=1` narrows the library to files the signed-in person added, so a
     link from their own Greetings settings lands on their files and not on the
     whole company's. The filter is applied in the browser: the list endpoint
     has no owner filter, so one wide page is fetched and narrowed here. */
  const onlyMine = searchParams.get('mine') === '1';
  const myUuid = String(user?.uuid || user?.user_info?.uuid || '');
  const querySuffix = onlyMine ? '?mine=1' : '';
  const { features } = useCompanyFeatures();
  const greetingAccess = features?.plan_features?.settings?.action?.greeting || {};
  const [modalState, setModalState] = useState<any>({
    playMedia: false,
    isEdit: false,
    isDelete: false,
  });
  const [drawerState, setDrawerState] = useState<any>(false);
  const [greetingData, setGreetingData] = useState<any>(null);
  /* Slug in the URL -> the type this page renders. The plural slugs are the
     current ones; the `type-` forms are the old paths, still routed as
     redirects, and still matched here so a direct hit on one resolves to the
     right library instead of silently falling back to "all". */
  const TYPE_SLUGS: Record<string, string> = {
    voicemail: 'voicemail',
    prompts: 'prompt',
    greetings: 'greeting',
    'type-voicemail': 'voicemail',
    'type-prompt': 'prompt',
    'type-greeting': 'greeting',
  };
  /* One of the type slugs is `greetings`, and this page is also mounted at
     `/greetings`. So the last segment alone cannot say whether it is a type or
     the mount itself: at `/greetings` the answer is "all", at
     `/greetings/greetings` it is the greetings library. Strip the segment and
     look at what is left — an empty base means we were standing on the mount. */
  const trimmed = pathname.replace(/\/+$/, '');
  const lastSegment = trimmed.split('/').pop() || '';
  const candidateBase = trimmed.slice(0, trimmed.length - lastSegment.length - 1);
  const isTypeSegment = Boolean(TYPE_SLUGS[lastSegment]) && candidateBase !== '';

  const type = isTypeSegment ? TYPE_SLUGS[lastSegment] : 'all';

  /* The type routes exist under every place this page is mounted, but only the
     standalone greetings area has a sidebar linking to them — under
     My Account > Media Files they were reachable by typing a URL and no other
     way. The base is whatever precedes the type segment, so the tabs follow the
     mount wherever it is. */
  const typeBase = isTypeSegment ? candidateBase : trimmed;
  const TYPE_TABS = [
    { key: 'all', label: 'All', to: typeBase },
    { key: 'greeting', label: 'Greetings', to: `${typeBase}/greetings` },
    { key: 'prompt', label: 'Prompts', to: `${typeBase}/prompts` },
    { key: 'voicemail', label: 'Voicemail', to: `${typeBase}/voicemail` },
  ];

  /* One page serves four different libraries, so the description follows the
     type rather than saying something vague enough to cover all of them. */
  const typeBlurb: Record<string, string> = {
    greeting: 'Recordings callers hear when they reach you — welcome messages and hold music.',
    prompt: 'Recordings played inside IVR menus to tell callers what their options are.',
    voicemail:
      'Recordings played when a call goes to voicemail, before the caller leaves a message.',
    all: 'Audio this account can use for greetings, IVR prompts and voicemail.',
  };

  function handleOpenAudio(src: string) {
    serRecordingUrl(src);
    setModalState({ playMedia: true });
  }

  const { mutateAsync: mutateDeleteMedia, isPending: PendingMedia } = useMutation({
    mutationFn: deleteMedia,
  });
  const { mutateAsync: mutateDeleteGreeting, isPending: PendingGreeting } = useMutation({
    mutationFn: deleteGreeting,
  });

  const handleDeleteGreeting = async () => {
    try {
      const result = await mutateDeleteGreeting(greetingData?.uuid);

      /* Always `greeting`, never the row's own type. Every recording is stored
         in that one folder whatever it is called - the upload sends `greeting`
         and every playback URL in the app reads `<media>/<company>/greeting/`.
         Passing the row's type here asked the server to delete a voicemail or a
         prompt from a folder it was never in, so the audio of every one of
         those ever deleted is still sitting on the server. */
      try {
        await mutateDeleteMedia({
          uuid: user?.company_info?.uuid,
          type: 'greeting',
          file_name: greetingData?.filename,
        });
      } catch (mediaError) {
        /* The row is already gone, so the recording has left the product either
           way. A leftover file is a housekeeping problem, not something to
           report as a failed deletion - and the old code let this throw, which
           skipped the refresh and the confirmation entirely: the row vanished
           on the next load and the admin was never told anything had happened. */
        console.error('greeting row deleted, its audio file was not: ', mediaError);
      }

      await queryClient.invalidateQueries({ queryKey: ['greetingList'] });
      await queryClient.invalidateQueries({ queryKey: ['greetings'] });
      setModalState({ isDelete: false });
      setGreetingData(null);
      handleAlert({
        text: result?.data?.data?.message || 'Record deleted successfully',
        type: 'success',
      });
    } catch (error) {
      console.error('FAILED TO DELETE GREETING: ', error);
      handleAlert({ text: 'That recording could not be deleted.', type: 'error' });
    }
  };

  const columns = [
    {
      header: 'Name',
      accessorKey: 'name',
    },
    {
      header: 'Size',
      accessorKey: 'size',
      cell: ({ getValue }: any) => <div className="text-gray-600">{formatSize(getValue())}</div>,
    },
    {
      header: 'Type',
      accessorKey: 'type',
      cell: ({ getValue }: any) => (
        <div className="text-gray-600">{capitalizeFirstLetter(getValue())}</div>
      ),
    },
    {
      header: 'Duration',
      accessorKey: 'duration',
      cell: ({ getValue }: any) => (
        <div className="text-gray-600">{formatDuration(getValue())}</div>
      ),
    },
    {
      header: 'Created At',
      accessorKey: 'created_at',
      cell: ({ getValue }: any) => <div className="text-gray-600">{formatDate(getValue())}</div>,
    },
    {
      header: 'Action',
      accessorKey: 'action',
      cell: (props: any) => {
        const data = props?.row?.original;
        /* `is_default` off the row itself decides where the file lives - see
           the same choice in greeting-select.tsx. The uuid list stays only as
           a fallback for rows served without the flag; on its own it made
           playback depend on a hardcoded list keeping step with the database,
           and every stock recording added after the list was last edited
           failed to play. */
        const isDefaultRecording =
          data?.is_default === true ||
          data?.is_default === 1 ||
          DEFAULT_RECORDING_UUIDS?.includes(data?.uuid);
        const srcUrl = isDefaultRecording
          ? `${getEnv().VITE_API_BASE_URL}/api/media/default/recording/${data?.filename}`
          : `${MEDIA_URL}/${user?.company_info?.uuid}/greeting/${data?.filename}`;
        const actions = [
          {
            icon: 'PlayLine',
            onClick: () => {
              handleOpenAudio(srcUrl);
            },
            className: ' bg-gray-100 text-gray-900/80 hover:bg-primary hover:text-white',
            tooltipText: 'Play',
            access: true,
          },
          greetingAccess?.edit && {
            icon: 'EditStrokIcon',
            onClick: () => {
              setGreetingData(data);
              setModalState({ isEdit: true });
            },
            className: 'bg-gray-100 text-gray-900/80 hover:bg-primary hover:text-white',
            tooltipText: 'Edit',
            access: !data?.is_default,
          },
          greetingAccess?.delete && {
            icon: 'TrashBin',
            onClick: () => {
              setGreetingData(data);
              setModalState({ isDelete: true });
            },
            className: 'bg-red-100 text-red-500 hover:bg-red-500 hover:text-white',
            tooltipText: 'Delete',
            access: !data?.is_default,
          },
        ]?.filter(Boolean);
        return (
          <div className="flex items-center gap-2">
            {actions?.map((action, index) => (
              <CustomTooltip text={action.tooltipText} side="top">
                <div
                  key={index}
                  className={`${action?.access ? `cursor-pointer  ${action.className}` : 'cursor-not-allowed  bg-gray-100 text-gray-900/80'}  flex items-center justify-center rounded-full w-8 h-8 `}
                  onClick={() => {
                    if (action?.access) {
                      action.onClick();
                    }
                  }}
                >
                  <Icon
                    name={action.icon as IconName}
                    className={`w-5 h-5 ${action?.access ? '' : 'text-gray-400'}`}
                  />
                </div>
              </CustomTooltip>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    // <section className="w-full overflow-auto max-h-[calc(100vh-64px)] ">
    <section className="w-full overflow-auto  ">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 min-h-[65px] bg-white">
        <div>
          <p className="text-gray-900 font-semibold text-lg flex items-center gap-1">
            Media Files{' '}
            <div className="-rotate-90 text-gray-800">
              <Icon name="ChevronIcon" className="w-5 h-5" />
            </div>
            <span className="text-primary text-md">{capitalizeFirstLetter(type)}</span>
          </p>
          <p className="text-gray-500 text-xs">{typeBlurb[type] || typeBlurb.all}</p>
          {onlyMine ? (
            <p className="text-xs text-primary mt-1">
              Showing only files you added.{' '}
              <button
                type="button"
                className="underline underline-offset-2 cursor-pointer"
                onClick={() => navigate(typeBase === '' ? '/' : typeBase)}
              >
                Show the whole library
              </button>
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => navigate(`${tab.to}${querySuffix}`)}
                className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  type === tab.key
                    ? 'bg-ucass-primary-200 text-primary'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 filters">
          <Input
            placeholder="Search"
            className="pl-10 w-full min-h-9 rounded-lg"
            IconPosition="left-0 pl-2 inset-y-0"
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith(' ')) return;
              setSearch(e.target.value);
            }}
            Icon={<SearchLine className=" text-gray-700" />}
          />
          {greetingAccess?.add && !drawerState && (
            <Button
              className="min-h-9"
              type="button"
              variant={'outline'}
              onClick={() => setDrawerState(true)}
            >
              <Icon name="Plus" className="w-3 h-3" /> Add
            </Button>
          )}
        </div>
      </div>
      {drawerState ? (
        <div className="w-full flex justify-center py-6 px-4 bg-gray-50/50 ">
          <div className=" w-full max-w-[800px] bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col h-full">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Add Media File</h2>
                <p className="text-sm text-gray-500 mt-1">Create or upload a new audio file</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDrawerState(false)}
                className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 h-8 px-3"
              >
                <Icon name="CloseIcon" className="w-3 h-3" />
              </Button>
            </div>

            <AddGreeting
              drawerState={drawerState}
              setDrawerState={setDrawerState}
              greetingType={type}
            />
          </div>
        </div>
      ) : (
        <div className="w-full p-3 flex flex-col gap-2">
          <TableManager
            {...{
              fetcherKey: onlyMine ? 'greetingListMine' : 'greetingList',
              fetcherFn: getGreetings,
              columns,
              search,
              type,
              /* One wide page when narrowing to the person's own files, so the
                 filter is applied over the whole library rather than over the
                 first 25 rows of it. */
              ...(onlyMine ? { extraParams: { limit: 200 } } : {}),
              select: (res: any) => {
                const rows = res?.data?.data?.result?.rows || [];
                if (!onlyMine) return rows;
                return rows.filter(
                  (row: any) => !row?.is_default && String(row?.user_uuid || '') === myUuid,
                );
              },
              emptyTablePlaceholder: onlyMine
                ? 'You have not added any files yet'
                : type == 'all'
                  ? 'No media files uploaded yet'
                  : `No ${type} file uploaded yet`,
              descriptionEmptyTable: onlyMine
                ? 'Files you add will appear here.'
                : `Uploaded ${type} files will appear here.`,
            }}
          />
          {modalState?.playMedia && (
            <AudioModal
              modalState={modalState}
              setModalState={setModalState}
              srcUrl={recordingUrl}
              serRecordingUrl={serRecordingUrl}
            />
          )}
          {modalState?.isEdit && (
            <EditGreeting
              modalState={modalState}
              setModalState={setModalState}
              initialData={greetingData}
            />
          )}
          {modalState?.isDelete && (
            <AlertConfirm
              {...{
                apiLoading: PendingMedia || PendingGreeting,
                onConfirm: () => {
                  handleDeleteGreeting();
                },
                open: modalState,
                setOpen: setModalState,
              }}
            />
          )}
          {/* {drawerState && (
          <SideDrawer
            isOpen={drawerState}
            title="Upload File"
            handleClose={() => setDrawerState(false)}
            width="500px"
            isHeader
            content={
              <AddGreeting
                drawerState={drawerState}
                setDrawerState={setDrawerState}
                greetingType={type}
              />
            }
          />
        )} */}
        </div>
      )}
    </section>
  );
};

export default GreetingContent;
