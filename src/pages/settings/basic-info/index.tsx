import FileCropper from '@/components/custom/file-cropper';
import Loader from '@/components/custom/loader';
import { Button } from '@/components/ui/button';
import { requiredString } from '@/lib/schema';
import { Icon } from '@/assets/icons/icon';
import { handleAlert, MAX_FILE_SIZE, validateFileSize } from '@/lib/utils';
import { invalidateGlobalUsersDirectory } from '@/lib/invalidate-global-users-directory';
import { basicInitialState } from '@/pages/admin-settings/constants';
import ProfileForm, { JOB_TITLE_MAX } from './profile-form';
import '@/components/mcm/mcm-page.css';
import { getUserDetails, mediaUploadUrl, userProfileUpdate } from '@/services/api';
import { yupResolver } from '@hookform/resolvers/yup';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import * as yup from 'yup';
import CustomAvatar from '@/components/custom/custom-avatar';
import HowCallsReachYou from './how-calls-reach-you';
import CallSetupGuide from './call-setup-guide';
import { buildProfileUpdatePayload } from './profile-update-payload';
import {
  SELF_PROFILE_QUERY_KEY,
  fetchSelfProfile,
  getSelfProfileStore,
  updateSelfProfile,
} from './profile-self-api';
import { DEFAULT_INTERFACE_LANGUAGE, PRONOUNS_MAX, cleanPronouns } from './interface-languages';

export const BasicInfoSettingSchema = yup.object().shape({
  basic: yup.object().shape({
    first_name: requiredString('First name', 2, 50),
    last_name: requiredString('Last name', 2, 50),
    /* The column is varchar(30) and the database is strict: one character
       over and the whole save fails, name and photo with it. The field stops
       typing at the limit; this catches a pasted value. */
    job_title: yup
      .string()
      .nullable()
      .max(JOB_TITLE_MAX, `Job title can be at most ${JOB_TITLE_MAX} characters`),
    /* users.pronouns is varchar(40); same strict-database reasoning. */
    pronouns: yup
      .string()
      .nullable()
      .max(PRONOUNS_MAX, `Pronouns can be at most ${PRONOUNS_MAX} characters`),
    interface_language: yup.string().nullable(),
  }),
});

const BasicInfoSettings = () => {
  const [image, setImage] = useState<any>(null);
  const [fileName, setFileName] = useState<any>(null);
  const [modalState, setModalState] = useState(false);
  const [loader, setLoader] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isImageRemoved, setIsImageRemoved] = useState(false);
  const cropperUploadRef = useRef<any>(null);
  const queryClient: any = useQueryClient();

  const methods = useForm<any>({
    mode: 'all',
    defaultValues: { basic: basicInitialState },
    resolver: yupResolver(BasicInfoSettingSchema),
  });

  const { handleSubmit, setValue, watch } = methods;

  const { data: userInfoData, isPending: PendingUserData } = useQuery({
    queryKey: ['getUserDetailsQueryFn'],
    queryFn: getUserDetails,
    select: (data) => data?.data?.data?.result,
  });

  /* Pronouns and interface language live on the new five-field endpoint;
     /api/user/info does not return them. `null` here means the server has no
     such endpoint, and the form is told so. Quiet probe: a missing endpoint
     is a state, not an error. */
  const { data: selfProfile, isPending: PendingSelfProfile } = useQuery({
    queryKey: SELF_PROFILE_QUERY_KEY,
    queryFn: fetchSelfProfile,
    retry: false,
  });
  const selfProfileAvailable: boolean | null = PendingSelfProfile ? null : selfProfile !== null;

  const afterSave = (message: string) => {
    handleAlert({ text: message, type: 'success' });
    queryClient.invalidateQueries(['getUsersDetails', 'getUserDetailsQueryFn'], {
      exact: true,
    });
    queryClient.invalidateQueries({ queryKey: SELF_PROFILE_QUERY_KEY });
    invalidateGlobalUsersDirectory(queryClient);
    setLoader(false);
  };

  /* The old whole-record write. Still the only way to save the photo, and the
     only way to save anything on a server without the five-field endpoint. */
  const { mutateAsync: mutateProfileUpdate, isPending: PendingProfileUpdate } = useMutation({
    mutationFn: userProfileUpdate,
  });

  const { mutateAsync: mutateSelfUpdate, isPending: PendingSelfUpdate } = useMutation({
    mutationFn: updateSelfProfile,
  });

  const handleChangeFile = (e: any) => {
    const file = e.target?.files?.[0];
    const fileSizeValid = validateFileSize(MAX_FILE_SIZE, file);
    if (!fileSizeValid) return;
    if (!file) return alert('something went wrong');
    if (!file?.type.startsWith('image/')) {
      return handleAlert({
        text: 'File type is invalid. Only jpg, jpeg and png file types are accepted.',
        type: 'error',
      });
    }
    setFileName(file?.name);
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result);
      setLoader(false);
    };
    reader.readAsDataURL(e.target.files[0]);
    setModalState(true);
  };
  const { mutateAsync: uploadMediaMutate, isPending: uploadMediaLoad } = useMutation({
    mutationFn: mediaUploadUrl,
  });

  const handleUpload = async () => {
    if (loader) return;
    if (!cropperUploadRef?.current) return;
    const blobUrl = cropperUploadRef?.current?.getCropData();
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: blob.type });

    setImagePreview(blobUrl);
    if (file) {
      try {
        const uploadMediaResponse = await uploadMediaMutate({
          uuid: userInfoData?.company_info?.uuid,
          type: 'profile',
          file_name: file?.name,
        });
        const result = uploadMediaResponse?.data?.data?.result;
        if (result?.file_name && result?.url) {
          setLoader(true);
          const { url = '', file_name = '' } = result || {};
          const uploadFileResponse = await fetch(url, {
            method: 'PUT',
            body: file,
          });
          if (uploadFileResponse.status === 200) {
            setValue('profile', file_name);
            /* A new picture undoes an earlier removal in the same session —
               without this the save would still send the removal. */
            setIsImageRemoved(false);
            setModalState(false);
          }
        }
      } catch (error) {
        console.log(error);
        setLoader(false);
      }
    }
  };

  /* Two saves, chosen by what the server offers and what changed.

     Server with /api/profile/update-self: the five fields go there (own row,
     no role, no email, nothing else touched). The photo is not one of the
     five, so a changed photo still goes through the old whole-record write -
     only when it changed, because that write resends the entire record.

     Server without it: the old write carries name and job title as before,
     and the page says pronouns and language were not saved rather than
     letting them vanish quietly. */
  const onSubmit = async () => {
    const basic = {
      first_name: watch('basic.first_name'),
      last_name: watch('basic.last_name'),
      job_title: watch('basic.job_title'),
    };
    const pronouns = cleanPronouns(watch('basic.pronouns'));
    const interfaceLanguage = String(watch('basic.interface_language') || DEFAULT_INTERFACE_LANGUAGE);
    const uploadedProfile = watch('profile');
    const photoChanged = !!uploadedProfile || isImageRemoved;

    const legacyPayload = buildProfileUpdatePayload({
      userInfoData,
      basic,
      uploadedProfile,
      isImageRemoved,
    });

    try {
      const outcome =
        getSelfProfileStore() === 'absent'
          ? ({ kind: 'absent' } as const)
          : await mutateSelfUpdate({
              ...basic,
              pronouns: pronouns || null,
              interface_language: interfaceLanguage,
            });

      if (outcome.kind === 'saved') {
        if (photoChanged) await mutateProfileUpdate(legacyPayload);
        afterSave(outcome.message);
        return;
      }

      const legacy: any = await mutateProfileUpdate(legacyPayload);
      afterSave(legacy?.data?.message || 'Profile updated successfully!');
      if (pronouns || interfaceLanguage !== DEFAULT_INTERFACE_LANGUAGE) {
        handleAlert({
          text: 'Name and job title saved. Pronouns and language are not saved on this server yet.',
          type: 'warning',
        });
      }
    } catch {
      /* The request layer has already shown the server's message. */
      setLoader(false);
    }
  };

  useEffect(() => {
    if (userInfoData?.user_info) {
      const user = userInfoData?.user_info;
      setValue('basic', {
        email: user.email || '',
        site: {
          label: user.site_detail?.name || 'Select',
          value: user.site_uuid || '',
        },
        extension: user.extension,
        phone: user.phone,
        caller_id: user.caller_id,
        job_title: user.job_title,
        first_name: user.first_name,
        last_name: user.last_name,
        profile: user.profile,
        pronouns: selfProfile?.pronouns || '',
        interface_language: selfProfile?.interface_language || DEFAULT_INTERFACE_LANGUAGE,
      });

      setIsImageRemoved(false);
    }
  }, [userInfoData, selfProfile]);

  return (
    <>
      <section className="flex h-full w-full flex-col overflow-hidden bg-gray-200/15">
        {/* <Breadcrumb breadcrumbs={breadcrumbData} /> */}
        <div className="flex items-center justify-between p-3 border-b border-gray-200 min-h-[65px] bg-white">
          <div>
            <p className="text-gray-900 font-semibold text-lg">Basic Info</p>
            <p className="text-gray-500 text-xs">
              Your name, job title and location as colleagues see them in the directory — and below,
              how calls actually reach you.
            </p>
          </div>
        </div>
        {PendingUserData ? (
          <div className="flex items-center justify-center p-5">
            <Loader variant="blue" size="sm" />
          </div>
        ) : (
          <div className="w-full flex-1 overflow-y-auto p-4">
            <div className="mx-auto mb-4 w-full md:max-w-[80%]">
              {/* Reads the extension and location off `user_info` and fetches
                  the person's own assigned numbers itself. */}
              <HowCallsReachYou userInfo={userInfoData?.user_info} />
            </div>
            <div className="mx-auto flex w-full flex-col gap-4 rounded-xl bg-white p-6 shadow-xs md:max-w-[80%]">
              <label htmlFor="file-upload" className="w-16 h-16 cursor-pointer mb-6">
                {imagePreview || watch('profile') ? (
                  <div className="relative w-20 h-20 rounded-full group">
                    <img
                      src={imagePreview || watch('profile')}
                      alt="Preview"
                      className="w-full h-full rounded-full border"
                      loading="lazy"
                    />
                    <span
                      title="Edit image"
                      className="absolute bottom-0 right-0 w-4 h-4 bg-primary rounded-full p-1"
                    >
                      <Icon name="EditIcon" className="text-white w-full h-full" />
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        setImagePreview('');
                        setValue('profile', '');
                        setIsImageRemoved(true);
                      }}
                      className="absolute cursor-pointer top-0 right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity p-0"
                      title="Remove image"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="relative w-20 h-20 rounded-full group">
                    <CustomAvatar
                      size="80"
                      name={`${userInfoData?.user_info?.first_name} ${userInfoData?.user_info?.last_name || ''}`}
                      showPresence={false}
                      extension={userInfoData?.user_info?.extension}
                      image={
                        isImageRemoved
                          ? null
                          : imagePreview || watch('profile') || userInfoData?.user_info?.profile
                      }
                      isActivityInfo={false}
                    />

                    <span
                      title="Edit image"
                      className="absolute bottom-0 right-0 w-4 h-4 bg-primary rounded-full p-1"
                    >
                      <Icon name="EditIcon" className="text-white w-full h-full" />
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        setImagePreview(null);
                        setValue('profile', '');
                        setIsImageRemoved(true);
                      }}
                      className="absolute cursor-pointer top-0 right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity p-0"
                      title="Remove image"
                    >
                      ×
                    </button>
                  </div>
                )}

                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleChangeFile}
                />
              </label>
              <div
                className="mcm-page"
                style={
                  {
                    display: 'block',
                    height: 'auto',
                    minHeight: 0,
                    overflow: 'visible',
                    background: 'transparent',
                    fontFamily: 'inherit',
                    fontSize: 'inherit',
                    lineHeight: 'inherit',
                    '--sans': 'inherit',
                    '--mono': 'inherit',
                  } as CSSProperties
                }
              >
                <FormProvider {...methods}>
                  <form onSubmit={handleSubmit(onSubmit)} className="flex w-full flex-col gap-5">
                    <ProfileForm selfProfile={selfProfileAvailable} />
                    {/* Always shown. This is the person's own name, title and
                        photo, and saving those is theirs to do. The button used
                        to hide behind the People-admin permission
                        (account_setting.USER.action.edit), which is the key that
                        gates editing OTHER people - so anyone without it saw a
                        form with no way to save it. */}
                    <div className="flex justify-end border-t border-gray-200 pt-4 mcm-stickyfoot">
                      <Button
                        variant={'primary'}
                        type="submit"
                        disabled={PendingProfileUpdate || PendingSelfUpdate}
                      >
                        {PendingProfileUpdate || PendingSelfUpdate ? 'Saving...' : 'Save profile'}
                      </Button>
                    </div>
                  </form>
                </FormProvider>

                {/* The profile above says who you are; this says what happens
                    when someone calls you, which is the part people arrive on
                    this page looking for and could not previously see. */}
                <CallSetupGuide userInfo={userInfoData} />
              </div>
            </div>
          </div>
        )}
        {modalState && (
          <FileCropper
            {...{
              image,
              handleUpload,
              modalState,
              setModalState,
              uploadMediaLoad,
              setLoader,
              loader,
            }}
            ref={cropperUploadRef}
          />
        )}
      </section>
    </>
  );
};

export default BasicInfoSettings;
