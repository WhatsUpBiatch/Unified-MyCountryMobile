import { FC, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import Loader from '@/components/custom/loader';
import { useUser } from '@/hooks/use-user';
import ChooseFile from './choose-file';
import Record from './record';
import TextToSpeech from './text-to-speech';
import { options, TAB_CONSTANT } from '../constant';
import {
  capitalizeFirstLetter,
  convertBase64ToBlob,
  handleAlert,
  isAudioFile,
  loadAudioFileAsync,
  sanitizePlainTextInput,
} from '@/lib/utils';
import { createGreeting, mediaUploadUrl, textToSpeech } from '@/services/api';
import { AddGreetingProps, GreetingForm } from '@/interfaces/audio-interface';
import { Input } from '@/components/ui/input';
import CustomSelect from '@/components/custom/custom-select';

interface IAddgreetings extends AddGreetingProps {
  refetch?: () => void;
  isRefetchable?: boolean;
  /* Fires with the recording that was just made, so a caller that opened this
     drawer to fill one slot can select it straight away. Without it the drawer
     closes and the admin is left looking at the same empty dropdown, with the
     thing they just recorded somewhere in a list they now have to search. */
  onCreated?: (greeting: { label: string; value: string }) => void;
}

const AddGreeting: FC<IAddgreetings> = ({
  setDrawerState,
  greetingType,
  refetch = () => {},
  isRefetchable = true,
  onCreated,
}) => {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>(TAB_CONSTANT.CHOOSE_FILE);
  const [showLoader, setShowLoader] = useState(false);
  const formInstance = useForm<GreetingForm>({
    defaultValues: {
      greeting: '',
      greeting_type: greetingType,
      greetingFile: null,
      textToSpeech: '',
      textFile: null,
      textToSpeechLocale: null,
      textToSpeechVoice: null,
    },
  });
  const { watch, reset, setValue, register } = formInstance;
  /* The mutation's own success handler does not receive the payload that was
     sent, and the create endpoint answers with a message rather than the row.
     The name and filename are both known here at the moment of sending, so they
     are held for the handler rather than read back out of a later list fetch
     that may not have landed yet. */
  const lastCreated = useRef<{ label: string; value: string } | null>(null);
  const [WatchUploadFile, WatchTextFile] = watch(['greetingFile', 'textFile']);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  const { mutateAsync: uploadMediaMutate, isPending } = useMutation({
    mutationFn: mediaUploadUrl,
  });

  const { mutate: mutateTextToSpeech, isPending: isPendingTextToSpeech } = useMutation({
    mutationFn: textToSpeech,
    onSuccess: (data) => {
      const base64Data = data?.data?.data?.result;
      if (base64Data) {
        const file = createFileFromBase64(base64Data);
        setValue('textFile', file);
      }
    },
  });

  const { mutate: upsertGreetingsMutate, isPending: isPendingCreateGreeting } = useMutation({
    mutationFn: createGreeting,
    onSuccess: async (data) => {
      setActiveTab(TAB_CONSTANT.CHOOSE_FILE);
      if (isRefetchable) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['greetings'] }),
          queryClient.invalidateQueries({ queryKey: ['greetingList'] }),
        ]);
      }
      setShowLoader(false);
      setDrawerState(false);
      handleAlert({
        text: data?.data?.message || 'Greeting Created Successfully',
        type: 'success',
      });
      if (lastCreated.current) onCreated?.(lastCreated.current);
      lastCreated.current = null;
      refetch();
      // reset();
    },
    onError: () => {
      setShowLoader(false);
    },
  });

  const createFileFromBase64 = (base64String: string): File => {
    const blob = convertBase64ToBlob(base64String);
    return new File([blob], 'audio.mp3', { type: 'audio/mpeg' });
  };

  /* "Female - United States accent", from whichever voice is selected on the
     Text-to-speech tab.
   *
   * The voice option carries `gender` and a `locale` like "en-GB"; the region
   * half of that is turned into a country name by the browser's own
   * Intl.DisplayNames, so this needs no table of locales to fall out of date.
   * Returns '' for an upload or a microphone recording — there is no voice to
   * describe — and the caller keeps whatever name was typed in that case. */
  const describeSelectedVoice = (): string => {
    if (activeTab !== TAB_CONSTANT.TEXT_TO_SPEECH) return '';

    const voice = watch('textToSpeechVoice');
    const locale = String(voice?.locale || watch('textToSpeechLocale')?.value || '');
    const region = locale.split('-')[1];

    let accent = '';
    if (region) {
      try {
        accent = new Intl.DisplayNames(['en'], { type: 'region' }).of(region) || region;
      } catch {
        accent = region;
      }
    }

    const gender = String(voice?.gender || '').trim();
    const parts = [gender, accent ? `${accent} accent` : ''].filter(Boolean);
    return parts.join(' - ');
  };

  const handleCreateGreeting = async () => {
    if (showLoader) return;
    try {
      setShowLoader(true);
      const greetingFile = WatchUploadFile;
      const greetType =
        greetingType === 'all'
          ? watch('greeting_type')?.value?.toLowerCase()
          : greetingType?.toLowerCase();

      let fileToUpload: File | null = null;

      if (activeTab === TAB_CONSTANT.TEXT_TO_SPEECH) {
        fileToUpload = WatchTextFile;
      } else if (greetingFile) {
        fileToUpload = greetingFile;
      }

      if (!fileToUpload) {
        setShowLoader(false);
        return;
      }

      if (!isAudioFile(fileToUpload)) {
        handleAlert({ text: 'Please upload an audio file.', type: 'error' });
        setShowLoader(false);
        return;
      }

      /* Every recording is filed under `greeting` whatever its type, because
         that is the one folder the playback URLs read from - the library and
         the picker both build `<media>/<company>/greeting/<file>` regardless of
         type. Filing a voicemail under `voicemail` here would store it where
         nothing looks for it. (`deleteMedia` in the library does pass the row's
         own type, which is why deleting a voicemail leaves its file behind -
         a separate bug, in the other direction.) */
      const uploadMediaResponse = await uploadMediaMutate({
        uuid: user?.company_info?.uuid,
        type: 'greeting',
        file_name: fileToUpload?.name || 'audio.mp3',
      });

      const successResponse = uploadMediaResponse?.data?.data?.result;

      if (successResponse?.file_name && successResponse?.url) {
        const { url, file_name } = successResponse;

        const fileUrl = URL.createObjectURL(fileToUpload);
        const audioContext = new AudioContext();
        let duration = 0;

        try {
          const arrayBuffer: any = await loadAudioFileAsync(fileUrl);
          const decodedAudioData = await audioContext.decodeAudioData(arrayBuffer);
          duration = Math.ceil(decodedAudioData.duration);
        } finally {
          URL.revokeObjectURL(fileUrl);
          await audioContext.close().catch(() => undefined);
        }

        const greetingPayload = {
          /* Falls back to a description of the voice when the name is left
             blank — "Female - United States accent" rather than an empty
             entry in every picker that offers this recording. Only ever a
             fallback: anything typed wins, because a name someone chose says
             more than one derived from the voice. */
          name: sanitizePlainTextInput(watch('greeting'), 50) || describeSelectedVoice(),
          filename: file_name,
          size: fileToUpload.size || 0,
          duration: duration,
          type: greetType,
          is_default: false,
        };

        const uploadFileResponse = await fetch(url, {
          method: 'PUT',
          body: fileToUpload,
        });

        if (uploadFileResponse.status === 200) {
          lastCreated.current = { label: greetingPayload.name, value: file_name };
          upsertGreetingsMutate(greetingPayload);
        }
      }
    } catch (error) {
      setShowLoader(false);
      console.error(error);
    }
  };

  const handleTextToSpeech = () => {
    const payload: any = {
      text: watch('textToSpeech'),
      locale: watch('textToSpeechLocale')?.value,
      short_name: watch('textToSpeechVoice')?.value || '',
    };

    mutateTextToSpeech(payload);
  };

  return (
    <div className="w-full flex flex-col gap-2 justify-between h-full">
      <FormProvider {...formInstance}>
        <div className="flex flex-col gap-4 pr-1 flex-1 overflow-y-auto">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col w-full">
            <div className="border-b border-gray-200 w-full mb-4">
              <TabsList className="flex text-sm font-semibold text-center p-0 rounded-none h-auto justify-start bg-transparent gap-6">
                {Object.entries(TAB_CONSTANT).map(([key, value]) => (
                  <TabsTrigger
                    key={key}
                    value={value}
                    type="button"
                    onClick={(event) => event.stopPropagation()}
                    className="data-[state=active]:border-b-2 data-[state=active]:border-b-primary data-[state=active]:text-primary border-b-2 border-transparent px-1 pb-3 pt-2 text-gray-600 cursor-pointer rounded-none relative flex gap-1 bg-transparent font-semibold data-[state=active]:shadow-none hover:text-gray-900 transition-colors"
                  >
                    {value}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContent value={TAB_CONSTANT.CHOOSE_FILE}>
              <ChooseFile />
            </TabsContent>

            <TabsContent value={TAB_CONSTANT.RECORD}>
              <Record />
            </TabsContent>

            <TabsContent value={TAB_CONSTANT.TEXT_TO_SPEECH}>
              <TextToSpeech
                handleTextToSpeech={handleTextToSpeech}
                isPendingTextToSpeech={isPendingTextToSpeech}
              />
            </TabsContent>
          </Tabs>

          <Input
            {...register('greeting')}
            label={'Name'}
            placeholder={'Enter Name'}
            maxLength={50}
          />
          {greetingType === 'all' ? (
            <CustomSelect
              label={'Type'}
              options={options}
              handleChange={(value) => {
                setValue('greeting_type', value, { shouldValidate: true });
              }}
              value={watch(`greeting_type`)}
              placeholder="Select Type"
            />
          ) : (
            <Input label="Type" value={capitalizeFirstLetter(greetingType)} disabled={true} />
          )}
        </div>
        <div className="flex justify-end gap-2 pt-4 mt-auto">
          <Button
            variant="transparent"
            type="button"
            onClick={() => {
              reset();
              setDrawerState(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant={'outline'}
            type="button"
            onClick={handleCreateGreeting}
            disabled={
              showLoader ||
              !watch('greeting') ||
              (activeTab === TAB_CONSTANT.TEXT_TO_SPEECH ? !WatchTextFile : !WatchUploadFile)
            }
          >
            {isPending || isPendingCreateGreeting || showLoader ? (
              <div className="flex items-center justify-center p-5">
                <Loader variant="blue" size="sm" />
              </div>
            ) : (
              'Upload'
            )}
          </Button>
        </div>
      </FormProvider>
    </div>
  );
};

export default AddGreeting;
