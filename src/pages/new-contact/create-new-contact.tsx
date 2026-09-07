import React, { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import moment from 'moment';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { AuthenticatedImage } from '@/components/custom/authenticated-media';
import { Button } from '@/components/ui/button';
import {
  validateFileSize,
  capitalizeFirstLetter,
  MEDIA_URL,
  handleAlert,
  MAX_FILE_SIZE,
} from '@/lib/utils';
import { mediaUploadUrl, addContact, upsertContact } from '@/services/api';
import { useUser } from '@/hooks/use-user';
import { Icon } from '@/assets/icons/icon';
import CustomSelect from '@/components/custom/custom-select';
import { ContactFormValues, CreateNewContactProps } from '@/interfaces/contact-interface';
import PhoneInput from 'react-phone-input-2';
import countryList from '@/lib/countries.json';
import { yupResolver } from '@hookform/resolvers/yup';
import ErrorTooltip from '@/components/custom/error-tooltip';
import { useNavigate } from 'react-router-dom';
import Loader from '@/components/custom/loader';
import { Label } from '@/components/ui/label';
import { newContactValidationSchema } from './schema';
import { useGetGroupList } from '@/hooks/common';
import CustomAvatar from '@/components/custom/custom-avatar';
import Select, { components } from 'react-select';
import { getBelongsToIcons } from '../integration/constant';
import { X } from 'lucide-react';
import { contactsInitialValues, genderOptions } from './const';
import { useOrganization } from '@/hooks/use-organisation';

const CreateContactNew: React.FC<CreateNewContactProps> = ({
  contactData = null,
  setTabData = () => {},
  setDrawerState = () => {},
  isDisable = true,
  setIsDisable = () => true,
  keepFormDataAfterSave = false,
  handleClose = () => {},
  isLead = false,
  prefillPhone = '',
  hideCancelButton = false,
}) => {
  const { user } = useUser();
  const navigate = useNavigate();
  const { mainSiteInfo } = useOrganization();
  const belongsToIcons = getBelongsToIcons(mainSiteInfo);
  const { data: groupList = [] } = useGetGroupList({
    type: !isLead ? 'CONTACT' : 'LEAD',
    page: 0,
    generatedBy: !isLead ? 'COMPANY' : null,
    displayType: 'dropdown',
  });
  const queryClient = useQueryClient();
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showLoader, setShowLoader] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    getValues,
    formState: { errors },
  } = useForm<any>({
    defaultValues: contactsInitialValues,
    resolver: yupResolver(newContactValidationSchema),
    mode: 'all',
  });

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const { mutateAsync: uploadMediaMutate, isPending: PendingImageUpload } = useMutation({
    mutationFn: mediaUploadUrl,
  });

  const { mutateAsync: addUserContact, isPending: PendingAddContact } = useMutation({
    mutationKey: ['addContact'],
    mutationFn: addContact,
    onSuccess: (data, variables: any) => {
      setShowLoader(false);
      handleAlert({
        text: data?.data?.data?.message || `${isLead ? 'Lead' : 'Contact'} Updated successfully`,
        type: 'success',
      });
      queryClient.invalidateQueries({
        queryKey: [!isLead ? 'getContactList' : 'getGroupContactsById'],
      });
      queryClient.invalidateQueries({ queryKey: ['getContactListById'] });
      queryClient.invalidateQueries({ queryKey: ['getParticularUserDetail'] });
      queryClient.invalidateQueries({ queryKey: ['contactList'] });
      handleClose();
      const createdContact = data?.data?.data?.result;
      const mergedContactData = keepFormDataAfterSave
        ? {
            ...createdContact,
            firstName: createdContact?.firstName || variables?.name?.first || '',
            lastName: createdContact?.lastName || variables?.name?.last || '',
            email: createdContact?.email ?? variables?.contact?.email ?? '',
            phone: createdContact?.phone ?? variables?.contact?.phone ?? '',
            gender: createdContact?.gender ?? variables?.profile?.gender ?? '',
            dob: createdContact?.dob ?? variables?.profile?.dob ?? '',
            company: createdContact?.company ?? variables?.profile?.company ?? '',
            webpage: createdContact?.webpage ?? variables?.profile?.webpage ?? '',
            title: createdContact?.title ?? variables?.profile?.title ?? '',
            social: createdContact?.social || variables?.social || [],
            address: createdContact?.address || variables?.address || [],
            contactPic: createdContact?.contactPic || variables?.profile?.contactPic || '',
          }
        : createdContact;
      setTabData?.(mergedContactData);
      if (!keepFormDataAfterSave) {
        navigate(`/contact/${createdContact?.uuid}`);
        setDrawerState(false);
        reset();
        setValue('avatar', null);
      }
    },
    onError: () => {
      setShowLoader(false);
    },
  });

  const { mutateAsync: upsertUserContact, isPending: PendingUpdateContact } = useMutation({
    mutationKey: ['upsertContact'],
    mutationFn: upsertContact,
    onSuccess: (data, variables: any) => {
      setShowLoader(false);
      handleAlert({
        text: data?.data?.data?.message || `${isLead ? 'Lead' : 'Contact'} Updated successfully`,
        type: 'success',
      });
      handleClose();
      queryClient.invalidateQueries({
        queryKey: [!isLead ? 'getContactList' : 'getGroupContactsById'],
      });
      queryClient.invalidateQueries({ queryKey: ['getContactListById'] });
      queryClient.invalidateQueries({ queryKey: ['getParticularUserDetail'] });
      queryClient.invalidateQueries({ queryKey: ['contactList'] });
      if (keepFormDataAfterSave) {
        const updatedContact = data?.data?.data?.result || {};
        setTabData?.({
          ...(contactData && typeof contactData === 'object' ? contactData : {}),
          ...updatedContact,
          firstName:
            updatedContact?.firstName ||
            variables?.name?.first ||
            contactData?.firstName ||
            contactData?.first_name ||
            '',
          lastName:
            updatedContact?.lastName ||
            variables?.name?.last ||
            contactData?.lastName ||
            contactData?.last_name ||
            '',
          email: updatedContact?.email ?? variables?.contact?.email ?? contactData?.email ?? '',
          phone: updatedContact?.phone ?? variables?.contact?.phone ?? contactData?.phone ?? '',
          gender: updatedContact?.gender ?? variables?.profile?.gender ?? contactData?.gender ?? '',
          dob: updatedContact?.dob ?? variables?.profile?.dob ?? contactData?.dob ?? '',
          company:
            updatedContact?.company ?? variables?.profile?.company ?? contactData?.company ?? '',
          webpage:
            updatedContact?.webpage ?? variables?.profile?.webpage ?? contactData?.webpage ?? '',
          title: updatedContact?.title ?? variables?.profile?.title ?? contactData?.title ?? '',
          social: updatedContact?.social || variables?.social || contactData?.social || [],
          address: updatedContact?.address || variables?.address || contactData?.address || [],
          contactPic:
            updatedContact?.contactPic ||
            variables?.profile?.contactPic ||
            contactData?.contactPic ||
            '',
        });
      }
      if (!keepFormDataAfterSave) {
        setDrawerState(false);
        setIsDisable(true);
        setImagePreview(null);
        setValue('avatar', null);
      }
    },
    onError: () => {
      setShowLoader(false);
    },
  });

  const [avatar] = watch(['avatar']);
  const belongsToErrorMessage =
    (errors?.belongsTo as any)?.message || (errors?.belongsTo as any)?.value?.message || '';
  const existingProfilePic = contactData?.profile?.contactPic || contactData?.contactPic || '';
  const hasSelectedNewImage = avatar instanceof File || !!imagePreview;
  const showExistingCustomAvatar =
    !!contactData?._id && !!existingProfilePic && !hasSelectedNewImage;
  const today = new Date().toISOString().split('T')[0];
  const normalizedPrefillPhone = typeof prefillPhone === 'string' ? prefillPhone.trim() : '';
  const isEditMode = Boolean(contactData?._id);
  const isSystemGenerated =
    contactData &&
    Array.isArray(contactData.groupMeta) &&
    contactData.groupMeta.some((g: any) => g?.generatedBy === 'SYSTEM');
  const filteredGroupList = isLead
    ? groupList?.filter((group: any) => String(group?.generatedBy || '').toUpperCase() !== 'SYSTEM')
    : groupList;
  const groupOptions = (filteredGroupList || [])?.map((group: any) => {
    const groupName = group?.groupName || '';
    const groupId = group?._id || group?.id || groupName;
    const iconUrl = belongsToIcons[groupName.toUpperCase()] || belongsToIcons['DEFAULT'] || '';
    return {
      label: groupName,
      value: groupId,
      iconUrl,
    };
  });
  const findGroupOptionByToken = (token: string) => {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) return null;

    const matchedById = groupOptions?.find(
      (option: any) => String(option?.value || '') === normalizedToken,
    );
    if (matchedById) return matchedById;

    return (
      groupOptions?.find(
        (option: any) =>
          String(option?.label || '').toLowerCase() === normalizedToken.toLowerCase(),
      ) || null
    );
  };

  useEffect(() => {
    setImagePreview(null);
    const safeContactData = contactData && typeof contactData === 'object' ? contactData : null;

    if (safeContactData) {
      setValue('id', safeContactData?._id || safeContactData?.uuid || '');
      const currentValues = getValues();
      const firstName =
        safeContactData?.name?.first ||
        safeContactData?.firstName ||
        safeContactData?.first_name ||
        '';
      const lastName =
        safeContactData?.name?.last ||
        safeContactData?.lastName ||
        safeContactData?.last_name ||
        '';
      const email = safeContactData?.contact?.email || safeContactData?.email;
      const phone = safeContactData?.contact?.phone || safeContactData?.phone;
      const dob = safeContactData?.profile?.dob || safeContactData?.dob;
      const gender = safeContactData?.profile?.gender || safeContactData?.gender;
      const company = safeContactData?.profile?.company || safeContactData?.company;
      const webpage = safeContactData?.profile?.webpage || safeContactData?.webpage;
      const title = safeContactData?.profile?.title || safeContactData?.title;
      const contactPic = safeContactData?.profile?.contactPic || safeContactData?.contactPic;
      const belongsToValue = safeContactData?.belongsTo;
      const groupMetaList = Array.isArray(safeContactData?.groupMeta)
        ? safeContactData.groupMeta
        : [];

      const hasProfilePic = !!contactPic;
      const imageSrcUrl =
        hasProfilePic && user?.company_info?.uuid
          ? contactPic?.startsWith('http')
            ? contactPic
            : `${MEDIA_URL}/${user?.company_info?.uuid}/contact/${encodeURIComponent(contactPic)}`
          : '';
      console.log(imageSrcUrl, 'imageSrcUrl construction debug');

      const genderValue = genderOptions?.find((option) => option?.value === gender);

      setValue(
        'first_name',
        capitalizeFirstLetter(
          firstName || (keepFormDataAfterSave ? currentValues?.first_name : ''),
        ),
      );
      setValue('last_name', lastName || (keepFormDataAfterSave ? currentValues?.last_name : ''));
      setValue('email', email ?? (keepFormDataAfterSave ? currentValues?.email : ''));
      setValue('phone', phone ?? (keepFormDataAfterSave ? currentValues?.phone : ''));
      setValue('dob', dob?.split('T')[0] || (keepFormDataAfterSave ? currentValues?.dob : ''));
      setValue(
        'gender',
        genderValue || (keepFormDataAfterSave ? currentValues?.gender || null : null),
      );
      setValue('company', company ?? (keepFormDataAfterSave ? currentValues?.company : ''));
      setValue('webpage', webpage ?? (keepFormDataAfterSave ? currentValues?.webpage : ''));
      setValue('title', title ?? (keepFormDataAfterSave ? currentValues?.title : ''));

      if (safeContactData?._id) {
        const selectedGroupsFromMeta = groupMetaList
          ?.map((item: any) => {
            // Supports both old shape: { id: { _id, groupName } }
            // and new shape: { _id, groupName, generatedBy }
            const groupName = item?.groupName || item?.id?.groupName || '';
            const groupId = item?._id || item?.id?._id || '';
            const matchedOption =
              (groupId ? findGroupOptionByToken(groupId) : null) ||
              (groupName ? findGroupOptionByToken(groupName) : null);

            if (matchedOption) return matchedOption;
            if (!groupName && !groupId) return null;

            const iconUrl =
              belongsToIcons[groupName.toUpperCase()] || belongsToIcons['DEFAULT'] || '';
            return {
              label: groupName || String(groupId || ''),
              value: groupId || groupName || '',
              iconUrl,
            };
          })
          ?.filter((group: any) => Boolean(group?.value || group?.label));

        if (selectedGroupsFromMeta?.length) {
          setValue('belongsTo', selectedGroupsFromMeta);
        } else if (belongsToValue) {
          const fallbackGroupNames = String(belongsToValue)
            .split(',')
            .map((groupName) => groupName.trim())
            .filter(Boolean);
          const fallbackGroups = fallbackGroupNames
            .map((groupName) => {
              const matchedOption = findGroupOptionByToken(groupName);
              if (matchedOption) return matchedOption;

              const iconUrl =
                belongsToIcons[groupName.toUpperCase()] || belongsToIcons['DEFAULT'] || '';
              return {
                label: groupName,
                value: groupName,
                iconUrl,
              };
            })
            ?.filter((group: any) => Boolean(group?.value || group?.label));
          setValue('belongsTo', fallbackGroups);
        }
      } else if (belongsToValue) {
        const firstGroup = String(belongsToValue).split(',')?.[0]?.trim() || '';
        if (firstGroup) {
          const matchedOption = findGroupOptionByToken(firstGroup);
          if (matchedOption) {
            setValue('belongsTo', matchedOption);
          } else {
            const iconUrl =
              belongsToIcons[firstGroup.toUpperCase()] || belongsToIcons['DEFAULT'] || '';
            setValue('belongsTo', {
              label: firstGroup,
              value: firstGroup,
              iconUrl,
            });
          }
        }
      }

      if (
        safeContactData?.social &&
        typeof safeContactData.social === 'object' &&
        !Array.isArray(safeContactData.social)
      ) {
        Object.entries(safeContactData.social).forEach(([key, value]) => {
          setValue(key, value ?? (keepFormDataAfterSave ? currentValues?.[key] : ''));
        });
      }

      if (
        safeContactData?.address &&
        typeof safeContactData.address === 'object' &&
        !Array.isArray(safeContactData.address)
      ) {
        Object.entries(safeContactData.address).forEach(([key, value]) => {
          if (key === 'country') {
            let countryVal = value;
            if (typeof value === 'object' && value !== null) {
              countryVal = (value as any).value || (value as any).label;
            }
            setValue(
              'country',
              countryVal
                ? { label: countryVal, value: countryVal }
                : keepFormDataAfterSave
                  ? currentValues?.country
                  : null,
            );
          } else {
            setValue(key, value ?? (keepFormDataAfterSave ? currentValues?.[key] : ''));
          }
        });
      }

      setValue(
        'avatar',
        imageSrcUrl || (keepFormDataAfterSave ? currentValues?.avatar || null : ''),
      );
      return;
    }

    reset({
      ...contactsInitialValues,
      phone: normalizedPrefillPhone,
    });
    setValue('avatar', null);
  }, [
    contactData,
    getValues,
    keepFormDataAfterSave,
    normalizedPrefillPhone,
    reset,
    setValue,
    user?.company_info?.uuid,
  ]);

  const onSubmit = async (data: ContactFormValues) => {
    if (showLoader) return;

    const {
      first_name,
      last_name,
      email,
      phone,
      gender,
      dob,
      avatar,
      company,
      webpage,
      twitter,
      facebook,
      linkedin,
      whatsapp,
      instagram,
      telegram,
      street,
      city,
      state,
      zipcode,
      country,
      belongsTo,
      // notes,
      ...rest
    } = data;
    const selectedBelongsTo = Array.isArray(belongsTo)
      ? belongsTo
          ?.map((item: any) => item?.value)
          ?.filter((value: string) => Boolean(value))
          ?.join(',')
      : belongsTo?.value || '';

    const socialHandles = Object.fromEntries(
      Object.entries({ twitter, facebook, linkedin, whatsapp, instagram, telegram })
        .map(([key, value]) => [key, String(value ?? '').trim()])
        .filter(([, value]) => Boolean(value)),
    );

    const payload: Record<string, any> = {
      name: {
        first: first_name || '',
        last: last_name || '',
      },
      contact: {
        email: email || '',
        phone: phone?.includes('+') ? phone : `+${phone}`,
      },
      profile: {
        gender: gender?.value || '',
        dob: dob ? moment(dob).format('YYYY-MM-DD') : '',
        title: rest.title || '',
        company: company || '',
        webpage: webpage || '',
        contactPic: contactData?.contactPic || '',
      },
      address: {
        street: street || '',
        city: city || '',
        state: state || '',
        zipcode: zipcode || '',
        ...(country?.value ? { country: country } : {}),
      },
      /* Only handles that were actually filled in. Sending every key with an
         empty string made the API reject the whole save with `"social.whatsapp"
         is not allowed`, so no contact could be created at all — with or
         without a WhatsApp. When none are filled the key is omitted entirely. */
      ...(Object.keys(socialHandles).length ? { social: socialHandles } : {}),
      type: isLead ? 'LEAD' : 'CONTACT',
      ...(selectedBelongsTo ? { belongsTo: selectedBelongsTo } : {}),
    };

    if (contactData?._id) payload.contact_uuid = contactData._id;
    try {
      setShowLoader(true);

      if ((!contactData?.contactPic && avatar) || avatar instanceof File) {
        const uploadMediaResponse = await uploadMediaMutate({
          uuid: user?.company_info?.uuid,
          type: 'contact',
          file_name: (avatar as File).name || 'contact_avatar',
        });
        const result = uploadMediaResponse?.data?.data?.result;
        if (result?.file_name && result?.url) {
          payload.profile.contactPic = result.file_name;
          const uploadFileResponse = await fetch(result.url, {
            method: 'PUT',
            body: avatar as File,
          });
          if (uploadFileResponse.status === 200) {
            if (contactData?._id) {
              upsertUserContact(payload);
            } else {
              addUserContact(payload);
            }
          }
        }
      } else if (contactData?.contactPic && !avatar) {
        payload.profile.contactPic = null;
        if (contactData?._id) {
          upsertUserContact(payload);
        } else addUserContact(payload);
      } else {
        if (contactData?._id) {
          upsertUserContact(payload);
        } else {
          addUserContact(payload);
        }
      }
    } catch (error) {
      setShowLoader(false);
      return error;
    }
  };

  return (
    <form
      className="w-full flex flex-col gap-2 justify-between h-full min-h-0"
      onSubmit={handleSubmit(onSubmit)}
    >
      {/* <div className={`flex flex-col gap-4 ${isDisable?'h-[calc(100vh_-_10rem)]':'h-[calc(100vh_-_14rem)]'} overflow-auto pr-3`}> */}
      {/* px-1.5 is not decoration: this container scrolls, so it clips anything
          that reaches outside it. The focus ring sits 2px off a field and is
          2px wide, and with no left padding at all its left edge was sliced
          straight off. 6px each side clears the ring and makes the two sides
          symmetric — it used to have 4px on the right and none on the left. */}
      <div className="flex flex-col flex-1 min-h-0 overflow-auto gap-4 px-1.5 pt-2 pb-4">
        {!isDisable && (
          <label
            htmlFor="file-upload"
            className="rounded-full border border-gray-200 relative w-14 h-14 cursor-pointer"
          >
            {watch('avatar') || imagePreview || avatar ? (
              <div className="h-full w-full rounded-full relative group">
                {showExistingCustomAvatar ? (
                  <CustomAvatar
                    name={`${watch('first_name') || ''} ${watch('last_name') || ''}`.trim()}
                    image={existingProfilePic}
                    size="56"
                    type="contact"
                    isActivityInfo={false}
                  />
                ) : (
                  <AuthenticatedImage
                    src={
                      imagePreview ||
                      (watch('avatar') instanceof File
                        ? URL.createObjectURL(watch('avatar'))
                        : typeof avatar === 'string'
                          ? avatar
                          : '')
                    }
                    alt="Preview"
                    className="rounded-full object-cover h-14 w-14"
                    loading="lazy"
                  />
                )}
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
                    setValue('avatar', null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                  className="absolute cursor-pointer top-0 right-0 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove image"
                >
                  <X className="text-white size-3" />
                </button>
              </div>
            ) : (
              <div className="h-14 w-14 bg-gray-500 rounded-full flex items-center justify-center">
                <Icon name="User" className="text-white w-10 h-10" />
              </div>
            )}

            <input
              ref={fileInputRef}
              id="file-upload"
              type="file"
              className="hidden"
              accept="image/*"
              onClick={(e) => {
                e.currentTarget.value = '';
              }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file || !validateFileSize(MAX_FILE_SIZE, file)) return;
                setValue('avatar', file);
                setImagePreview(URL.createObjectURL(file));
              }}
              disabled={isDisable}
            />
          </label>
        )}

        <div className="flex gap-4 flex-col">
          <div className="flex gap-4 flex-wrap">
            <Input
              label={'First Name'}
              {...register('first_name')}
              placeholder="Enter first name"
              type="text"
              error={errors?.first_name?.message}
              disabled={isDisable}
              maxLength={50}
            />

            <Input
              label={'Last Name'}
              {...register('last_name')}
              placeholder="Enter last name"
              type="text"
              error={errors?.last_name?.message}
              disabled={isDisable}
              maxLength={50}
            />
          </div>
          <div className="flex gap-4 flex-wrap">
            <Input
              {...register('email')}
              placeholder="Enter email"
              type="email"
              label={'Email'}
              error={errors?.email?.message}
              disabled={isDisable}
            />
            <div className="flex flex-col gap-1.5 w-full">
              <div className="flex items-center justify-between">
                <Label>Phone Number</Label>
                {errors?.phone?.message && <ErrorTooltip text={errors?.phone?.message} />}
              </div>
              <div className="flex gap-1">
                <PhoneInput
                  country={'us'}
                  value={watch('phone')}
                  onChange={(value) => {
                    setValue('phone', value, {
                      shouldValidate: true,
                    });
                  }}
                  containerClass={errors?.phone?.message ? 'phone-error' : ''}
                  disabled={isDisable}
                />
              </div>
            </div>
          </div>
          <div className="flex gap-4 flex-wrap">
            <CustomSelect
              label={'Gender'}
              options={genderOptions}
              handleChange={(value: any) =>
                setValue(
                  `gender`,
                  {
                    value: value?.value,
                    label: value?.label,
                  },
                  {
                    shouldValidate: true,
                  },
                )
              }
              value={watch('gender')}
              isDisabled={isDisable}
            />
            <div className="flex flex-col gap-1.5 w-full">
              <Input
                type="date"
                {...register('dob')}
                label="Birth Date"
                error={errors?.dob?.message}
                disabled={isDisable}
                max={today}
              />
            </div>
          </div>
          <div className="flex gap-4 flex-wrap">
            <Input
              placeholder="Enter company"
              {...register('company')}
              label="Company"
              error={errors?.company?.message}
              disabled={isDisable}
              maxLength={50}
            />
            <Input
              placeholder="Enter webpage"
              {...register('webpage')}
              label="Webpage"
              error={errors?.webpage?.message}
              disabled={isDisable}
              maxLength={150}
            />
          </div>
          <div className="flex gap-4 flex-wrap">
            <Input
              placeholder="Enter title"
              {...register('title')}
              label="Title"
              error={errors?.title?.message}
              disabled={isDisable}
              maxLength={50}
            />
            <Input
              placeholder="Enter twitter ID"
              {...register('twitter')}
              label="Twitter ID"
              error={errors?.twitter?.message}
              disabled={isDisable}
              // maxLength={150}
            />
          </div>

          <div className="flex gap-4 flex-wrap">
            <Input
              placeholder="Enter facebook ID"
              {...register('facebook')}
              label="Facebook ID"
              error={errors?.facebook?.message}
              disabled={isDisable}
            />
            <Input
              placeholder="Enter linkedin ID"
              {...register('linkedin')}
              label="Linkedin ID"
              error={errors?.linkedin?.message}
              disabled={isDisable}
            />
          </div>

          {/* The channels this contact can be reached on. They live in the same
              `social` map as the profiles above — the server takes whatever
              keys it is given — so Directory can offer a real action per
              channel instead of only dialling a number. */}
          <div className="flex gap-4 flex-wrap">
            <Input
              placeholder="e.g. +1 256 808 1010"
              {...register('whatsapp')}
              label="WhatsApp number"
              error={errors?.whatsapp?.message}
              disabled={isDisable}
            />
            <Input
              placeholder="e.g. @acme"
              {...register('instagram')}
              label="Instagram handle"
              error={errors?.instagram?.message}
              disabled={isDisable}
            />
          </div>

          <div className="flex gap-4 flex-wrap">
            <Input
              placeholder="e.g. @acme"
              {...register('telegram')}
              label="Telegram handle"
              error={errors?.telegram?.message}
              disabled={isDisable}
            />
          </div>

          <div className="flex flex-col w-full gap-4">
            <p className="font-semibold text-gray-900">Address Information</p>
            <div className="flex gap-4 flex-wrap">
              <Input
                placeholder="Enter street"
                {...register('street')}
                label="Street"
                error={errors?.street?.message}
                disabled={isDisable}
                // maxLength={120}
              />
              <Input
                placeholder="Enter city"
                {...register('city')}
                label="City"
                error={errors?.city?.message}
                disabled={isDisable}
                maxLength={50}
              />
            </div>
            <div className="flex gap-4 flex-wrap">
              <Input
                placeholder="Enter state"
                {...register('state')}
                label="State"
                error={errors?.state?.message}
                disabled={isDisable}
                maxLength={50}
              />
              <Input
                placeholder="Enter zipcode"
                {...register('zipcode')}
                label="ZIP Code"
                error={errors?.zipcode?.message}
                disabled={isDisable}
                maxLength={10}
              />
            </div>
            <div className="flex gap-4 flex-wrap relative">
              <CustomSelect
                label={'Country'}
                options={countryList?.map((country: any) => ({
                  label: country?.name || '',
                  value: country?.name || '',
                }))}
                handleChange={(value) => {
                  setValue('country', value, { shouldValidate: true });
                }}
                value={watch('country')}
                placeholder={'Select Country'}
                error={errors?.country?.message}
                isDisabled={isDisable}
              />
            </div>

            {!isSystemGenerated && (
              <div className="flex gap-4 flex-wrap relative">
                <div className="flex flex-col gap-1.5 w-full">
                  <div className="flex items-center justify-between">
                    <Label>Select Group</Label>
                    {belongsToErrorMessage && <ErrorTooltip text={belongsToErrorMessage} />}
                  </div>
                  <div className="flex w-full selectBox">
                    <Select
                      isDisabled={isDisable}
                      isMulti={isEditMode}
                      closeMenuOnSelect={!isEditMode}
                      isClearable={false}
                      classNamePrefix="select-group"
                      value={
                        isEditMode
                          ? watch('belongsTo') || []
                          : watch('belongsTo') && typeof watch('belongsTo')?.value !== 'undefined'
                            ? watch('belongsTo')
                            : null
                      }
                      onChange={(value) => {
                        setValue('belongsTo', value, { shouldValidate: true });
                      }}
                      options={groupOptions}
                      placeholder="Select Group"
                      className={`w-full ${belongsToErrorMessage ? 'select-group-control-error' : ''}`}
                      menuPlacement="top"
                      formatOptionLabel={(option: any) => (
                        <div className="flex items-center gap-2 min-w-0">
                          {/* {option?.iconUrl ? (
                                                        <img
                                                            src={option?.iconUrl}
                                                            alt={option?.label || 'Group'}
                                                            className="w-4 h-4 rounded-full object-contain shrink-0"
                                                            onError={(e) => {
                                                                e.currentTarget.style.display = 'none';
                                                            }}
                                                        />
                                                    ) : null} */}
                          <span className="truncate">{option?.label}</span>
                        </div>
                      )}
                      menuPortalTarget={document.body}
                      menuShouldBlockScroll={true}
                      menuShouldScrollIntoView={true}
                      styles={{
                        menuPortal: (base) => ({
                          ...base,
                          zIndex: 9999,
                          pointerEvents: 'auto',
                        }),
                        menu: (base) => ({
                          ...base,
                          position: 'relative',
                          zIndex: 9999,
                        }),
                      }}
                      components={{
                        Menu: (props) => (
                          <components.Menu
                            {...props}
                            innerProps={{
                              ...props.innerProps,
                              onWheel: (e) => e.stopPropagation(),
                            }}
                          />
                        ),
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* <div className="flex flex-col w-full gap-4">
            <p className="font-semibold text-gray-900">Notes Information</p>
            <div className="flex gap-4 relative">
              <div className="flex flex-col gap-1.5 w-full">
                <div className="flex items-center justify-between">
                  <Label>Notes</Label>
                </div>
                <div className="relative w-full">
                  <div className="flex">
                    <textarea
                      className="border normal-case focus:outline-none disabled:bg-gray-300 disabled:text-slate-500 disabled:border-gray-200 disabled:shadow-none text-gray-700 placeholder:text-gray-700 bg-white shadow-sm text-sm rounded-xl w-full p-3 min-h-10 border-gray-300 focus:shadow-secondary/5 focus:ring-white shadow-secondary/5 focus:border-primary hover:border-primary resize-none"
                      placeholder="Enter notes"
                      rows={4}
                      {...register(`notes`)}
                      disabled={isDisable}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div> */}
        </div>
      </div>
      {!isDisable && (
        <div className="flex shrink-0 pt-2 justify-end gap-2 border-t border-gray-100 bg-white">
          {!hideCancelButton ? (
            <Button
              type="button"
              variant="transparent"
              onClick={() => {
                handleClose?.();
                setIsDisable((prevState) => !prevState);
                setDrawerState(false);
              }}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            variant={'primary'}
            type="submit"
            disabled={showLoader || PendingAddContact || PendingUpdateContact || PendingImageUpload}
          >
            {PendingAddContact || PendingUpdateContact || PendingImageUpload || showLoader ? (
              <div className="flex items-center justify-center p-5">
                <Loader variant="blue" size="sm" />
              </div>
            ) : (
              'Submit'
            )}
          </Button>
        </div>
      )}
    </form>
  );
};

export default CreateContactNew;
