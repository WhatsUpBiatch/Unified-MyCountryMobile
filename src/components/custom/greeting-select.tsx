import { FC, useState } from 'react';
import CustomSelect from './custom-select';
import { ISELECTVALUE } from '@/interfaces/api-interfaces';
import AddGreeting from '@/pages/greetings/add-greeting';
import { Button } from '../ui/button';
import { CloseIcon, Play, UploadLineIcon } from '@/assets/icons';
import { DEFAULT_RECORDING_UUIDS, getEnv, MEDIA_URL } from '@/lib/utils';
import { useUser } from '@/hooks/use-user';
import ErrorTooltip from './error-tooltip';
import SideDrawer from './side-drawer';
import ReadyAudio from './ready-audio';

interface IGREETINGPROPS {
  options: ISELECTVALUE[];
  onChangeMedia: (e: ISELECTVALUE | null) => void;
  isShowUpload: boolean;
  name: string;
  value: ISELECTVALUE | null;
  errors: string;
  audioCustomClass?: string;
  selectCustomClass?: string;
  selectCustomClassSecond?: string;
  isRefetchable?: boolean;
  refetch?: () => void;
  onGreetingUploadStart?: () => void;
  onGreetingUploadSuccess?: () => void;
  width?: string;
  /* Keeps the add button available after a recording has been chosen, and
     selects whatever gets made. Off by default: the forms that embed this
     control - IVR keys, queue settings, a person's phone tab - lay it out in a
     narrow column where a third button next to the dropdown and the play button
     wraps the row. Screens with room ask for it. */
  alwaysAllowAdd?: boolean;
}

interface GreetingSelectValue extends ISELECTVALUE {
  uuid?: string;
  /* Straight off the recording's own row. See `isDefaultRecording` below for
     why this is preferred over matching the uuid against a list. */
  is_default?: boolean | number;
}

const SelectGreeting: FC<IGREETINGPROPS> = ({
  options,
  onChangeMedia,
  isShowUpload,
  name,
  value,
  errors,
  audioCustomClass = '',
  selectCustomClass = '',
  selectCustomClassSecond = '',
  /* A width for the Add-a-recording drawer, because leaving it blank does not
     mean "default" — the drawer falls back to `calc(100% - 16rem - 5rem)`, very
     nearly the whole window. A dropzone, a name and a type do not need a
     thousand pixels, and stretched that wide the form read as an empty page
     with a few controls stranded in it.

     Capped against the viewport as well as fixed, so a narrow window gets the
     room it has rather than a drawer wider than the screen. */
  width = 'min(560px, calc(100vw - 2rem))',
  isRefetchable = true,
  refetch = () => {},
  onGreetingUploadStart = () => {},
  onGreetingUploadSuccess = () => {},
  alwaysAllowAdd = false,
}) => {
  const { user } = useUser();
  const { company_info } = user;
  const [isPlay, setIsPlay] = useState<boolean>(false);
  const [drawerState, setDrawerState] = useState({
    addGreeting: false,
    greetingType: '',
  });
  const selectedGreeting = options.find((option) => option.value === value?.value) as
    GreetingSelectValue | undefined;
  const selectedValue = value as GreetingSelectValue | null;

  /* Which of the two places this recording lives in: a company's own uploads
     are at `<company>/greeting/<file>`, the ones the platform ships for
     everybody are at `default/recording/<file>`. Guess wrong and the request
     404s at the storage layer and the player says "Unable to load this audio".
   *
   * `is_default` comes from the recording's own row and is the reliable
   * answer. The uuid list is kept only as a fallback for a value that was
   * saved before `is_default` was carried through — matching on it was the
   * ONLY test before, which made playback depend on a hardcoded list being in
   * step with the database AND on the saved value still carrying its uuid.
   * Neither holds for a value saved by an older build, and every stock
   * recording chosen that way failed to play. */
  const flag = selectedValue?.is_default ?? selectedGreeting?.is_default;
  const greetingUuid = selectedValue?.uuid ?? selectedGreeting?.uuid;
  const isDefaultRecording =
    flag === true || flag === 1 || DEFAULT_RECORDING_UUIDS.includes(greetingUuid ?? '');

  const recordingUrl = isDefaultRecording
    ? `${getEnv().VITE_API_BASE_URL}/api/media/default/recording/${value?.value}`
    : `${MEDIA_URL}/${company_info?.uuid}/greeting/${value?.value}`;

  return (
    <>
      {isPlay ? (
        <div className={`flex items-center gap-2 ${audioCustomClass}`}>
          <ReadyAudio controls authenticated src={recordingUrl} />
          <Button
            type="button"
            variant={'outline'}
            className="w-10 h-10 min-w-10 text-red-500 text-lg font-bold border-red-500 hover:bg-red-500"
            onClick={() => setIsPlay(false)}
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <div className={`flex gap-2 relative ${selectCustomClass}`}>
          <div className={`relative ${selectCustomClassSecond}`}>
            {errors && (
              <div className="flex justify-end absolute right-0 top-[-18px]">
                <ErrorTooltip text={errors} />
              </div>
            )}
            <CustomSelect
              options={options}
              handleChange={(e: ISELECTVALUE | null) => {
                onChangeMedia(e || { label: '', value: '' });
              }}
              value={value}
              isClearable={true}
            />
          </div>
          {value?.value && (
            <Button
              type="button"
              variant={'outline'}
              className="w-10 h-10"
              onClick={() => setIsPlay(true)}
            >
              <Play className="w-5 h-5" />
            </Button>
          )}
          {/* Without `alwaysAllowAdd` this disappeared the moment a recording
              was chosen, so the only way to add a second one was to clear the
              first - on a screen whose whole job is choosing recordings. */}
          {isShowUpload && !isPlay && (alwaysAllowAdd || !value?.value) && (
            <Button
              variant={'outline'}
              type="button"
              className="w-10 h-10"
              onClick={() => {
                onGreetingUploadStart();
                setDrawerState({
                  addGreeting: true,
                  greetingType: name,
                });
              }}
            >
              <UploadLineIcon className="w-5 h-5" />
            </Button>
          )}
        </div>
      )}

      {drawerState?.addGreeting && (
        <SideDrawer
          width={width}
          isOpen={drawerState?.addGreeting}
          /* It uploads, records from the microphone, and reads typed text
             aloud. "Upload File" named one of the three. */
          title="Add a recording"
          handleClose={() =>
            setDrawerState((prev) => ({ ...prev, addGreeting: false, greetingType: '' }))
          }
          isHeader
          content={
            <AddGreeting
              drawerState={drawerState?.addGreeting}
              setDrawerState={(val) =>
                setDrawerState((prev) => ({ ...prev, addGreeting: val, greetingType: '' }))
              }
              greetingType={name}
              refetch={() => {
                refetch();
                onGreetingUploadSuccess();
              }}
              /* Straight into the slot it was made for. The drawer was opened
                 from this dropdown to fill it, so leaving the admin to find the
                 new recording in the list afterwards is a step with no purpose. */
              onCreated={alwaysAllowAdd ? (greeting) => onChangeMedia(greeting) : undefined}
              isRefetchable={isRefetchable}
            />
          }
        />
      )}
    </>
  );
};

export default SelectGreeting;
