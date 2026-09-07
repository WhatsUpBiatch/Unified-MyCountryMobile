import { EmojiICon } from '@/assets/icons';
import CustomSelect from '@/components/custom/custom-select';
import Flag, { toFlagNumber } from '@/components/flag';
import useClickOutside from '@/hooks/use-click-outside';
import { useUser } from '@/hooks/use-user';
import useDebounce from '@/hooks/use-debounce';
import { mediaUploadUrl, sendSms, userSMSInfo } from '@/services/api';
import { yupResolver } from '@hookform/resolvers/yup';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import EmojiPicker from 'emoji-picker-react';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';

polyfillCountryFlagEmojis();
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { count } from 'sms-length';
import * as yup from 'yup';
import { checkPhoneNumberCountry, cn, getSmsAlert, handleAlert } from '@/lib/utils';
import { getDLCStatus } from '@/services/api';
import DLCVerificationPopup from '@/components/custom/dlc-verification-popup';
import countryList from '@/lib/countries.json';
import AlertConfirm from '@/components/custom/alert-confirm';
import { FileAudio2, FileText, FileVideo2, Loader2, Paperclip, Send, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useSmsRateCredits } from '@/hooks/use-sms-rate-credits';
import { useMessagingPermissions } from '@/hooks/use-messaging-permissions';
import RecipientField from '../recipient-field';

export const validationSchema = yup.object().shape({
  from: yup
    .object({
      label: yup.string().required(),
      value: yup.string().required(),
    })
    .nullable()
    .required('DID number is required')
    .test('has-value', 'DID number is required', (val) => {
      return val !== null && val !== undefined && !!val.value;
    }),
  to: yup.string().required('Phone number is required'),
  sms: yup.string().nullable(),
});

const isAllowedMMSFile = (file: File | null) => {
  if (!file) return false;
  const mimeType = String(file.type || '').toLowerCase();
  if (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/')
  ) {
    return true;
  }
  const lowerName = String(file.name || '').toLowerCase();
  return [
    '.gif',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.bmp',
    '.svg',
    '.mp4',
    '.mov',
    '.webm',
    '.m4v',
    '.mkv',
    '.avi',
    '.mp3',
    '.wav',
    '.m4a',
    '.aac',
    '.ogg',
    '.flac',
  ].some((ext) => lowerName.endsWith(ext));
};

const SMS_COUNT_LIMIT = 5;

const trimToSmsCountLimit = (value: string, maxMessages = SMS_COUNT_LIMIT) => {
  const normalizedValue = String(value || '');
  if (count(normalizedValue).messages <= maxMessages) return normalizedValue;

  let low = 0;
  let high = normalizedValue.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = normalizedValue.slice(0, mid);
    if (count(candidate).messages <= maxMessages) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
};

const SendSMSModal = ({ handleClose = () => null, defaultNumber, selectedDID }: any) => {
  const { user } = useUser();
  const emojiContainerRef = useRef(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // const { setParam } = useSearchParamManager();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showDLCPopup, setShowDLCPopup] = useState(false);
  const [countryCode, seCountryCode] = useState('');
  const [sendMsgAlert, setSendMsgAlert] = useState<boolean>(false);
  const [mmsFile, setMmsFile] = useState<File | null>(null);
  const [mmsPreviewUrl, setMmsPreviewUrl] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const queryClient = useQueryClient();
  const allDIDNumbers = useMemo(() => user?.assigned_did || [], [user?.assigned_did]);
  const [country, setCountry] = useState<string>('');
  // const totalFunds = user?.company_info?.amount ? `$${user?.company_info?.amount}` : '00.00';
  const [dlsStatus, setDlsStatus] = useState(null);
  const { canSendTo } = useMessagingPermissions();
  const {
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitted },
  } = useForm<any>({
    mode: 'onChange',
    defaultValues: {
      from: null,
      to: defaultNumber,
      sms: '',
    },
    resolver: yupResolver(validationSchema),
  });

  const [from, sms = '', to] = watch(['from', 'sms', 'to']);
  const debouncedTo = useDebounce(to, 500);
  const isMMSMode = !!mmsFile;
  // const trimmedSms = String(sms || '').trim();
  const smsCountData = count((sms as string) || '');
  useEffect(() => {
    if (!mmsFile) {
      setMmsPreviewUrl('');
      return;
    }
    if (!String(mmsFile?.type || '').startsWith('image/')) {
      setMmsPreviewUrl('');
      return;
    }

    const objectUrl = URL.createObjectURL(mmsFile);
    setMmsPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [mmsFile]);
  useEffect(() => {
    if (to && to?.length > 0 && countryList && countryList?.length > 0) {
      const { countryCode = '' } = checkPhoneNumberCountry(to);
      seCountryCode(countryCode);

      const temp = countryList?.find((item: any) => item?.isoCode === countryCode)?.name || '';
      if (temp) {
        setCountry(temp);
      }
    }
  }, [to]);

  const { mutate: dlcStatus } = useMutation({
    mutationKey: ['getDLCStatus'],
    mutationFn: getDLCStatus,
    onSuccess: (data) => {
      setDlsStatus(data?.data?.data?.result?.verified);
    },
  });
  const { data: smsInfoData = [], refetch } = useQuery({
    queryKey: ['userSMSInfo', debouncedTo],
    queryFn: () =>
      userSMSInfo({
        filter: {
          key: 'DIALPREFIX',
          value: debouncedTo?.trim().replace(/\s+/g, ''),
        },
      }),
    select: (data) => data?.data?.data?.result || {},
    enabled: !!debouncedTo && debouncedTo?.length > 8,
  });

  const { allow_country = [], sms_rates = [], sms: freeSms = 0, sms_used = 0 } = smsInfoData || {};
  const isSmsFree =
    allow_country?.some(({ country_code_iso2 }: any) => country_code_iso2 === countryCode) &&
    freeSms > sms_used;
  const freeSmsLeft = isSmsFree ? freeSms - sms_used : 0;
  const balanceAmount = Number(user?.company_info?.amount || 0);
  const chargeableSmsCount = Math.max(smsCountData.messages - freeSmsLeft, 0);
  const smsRate = Number(sms_rates?.rate || 0);
  const chargeableAmount = chargeableSmsCount * smsRate;
  const { credits: smsCredits } = useSmsRateCredits({
    segment: smsCountData.messages,
    phone: debouncedTo,
    alpha2code: countryCode,
  });

  /* `sms_rates` is destructured with a default of `[]`, so `sms_rates.rate` is
     undefined whenever the response omits it — the old rate-card sum was then
     0, which the balance dialog read as "you cannot afford this" and refused a
     fully funded wallet. The applied cost from the rate service is the same
     figure shown on screen as "SMS Charges", so the dialog and the price now
     agree; the rate card is only the fallback. */
  const totalSmsCharges =
    smsCredits > 0 ? smsCredits : Number(sms_rates?.rate || 0) * smsCountData.messages;
  const [, setSearchParams] = useSearchParams();

  const { mutateAsync: sendSMSMutate, isPending } = useMutation({
    mutationFn: sendSms,
    onSuccess: (data) => {
      refetch();
      setSearchParams({ did_number: from?.value, chatId: data?.data?.data?.result?.chatId });
      queryClient.invalidateQueries({ queryKey: ['getSMSList'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['smsListViaDID'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['getUsersDetails'], exact: false });
      handleAlert({
        type: 'success',
        text: isMMSMode ? (
          'MMS sent successfully'
        ) : (
          <>
            Remaining SMS: {Math.max(0, freeSms - (sms_used + (smsCountData?.messages || 0)))}
            <br />
            SMS Charges: ${chargeableAmount.toFixed(2)}
          </>
        ),
      });
      handleClose(true);
    },
    onError: ({ response }: any) => {
      setSendMsgAlert(false);
      handleAlert({
        type: 'error',
        text: response?.data?.error?.message || 'Something went wrong',
      });
    },
  });

  const uploadMMSAttachment = async (file: File) => {
    const companyUuid = user?.company_info?.uuid || user?.company_uuid;
    if (!companyUuid) throw new Error('Company uuid not found');

    const uploadRes = await mediaUploadUrl({
      uuid: companyUuid,
      type: 'mms',
      file_name: file?.name,
    });
    const mediaUrl = uploadRes?.data?.data?.result?.url;
    const filename = uploadRes?.data?.data?.result?.file_name;
    if (!mediaUrl || !filename) throw new Error('Failed to generate media upload url');

    const uploadFileResponse = await fetch(mediaUrl, {
      method: 'PUT',
      body: file,
    });
    if (!uploadFileResponse.ok) throw new Error('Failed to upload media file');

    return { mediaUrl, filename };
  };

  async function handleSendMessage(values: any) {
    if (isPending || isSending) return;

    const fromNumber = values?.from?.value || '';
    const toNumber = values?.to || '';
    const normalizedText = String(values?.sms || '').trim();
    // Check if the receiver number is USA or international
    const toNumberFormatted = toNumber.startsWith('+') ? toNumber : `+${toNumber}`;
    const { isUSA } = checkPhoneNumberCountry(toNumberFormatted);

    // Check if DLC verification is required for US numbers
    if (isUSA && dlsStatus === false) {
      setShowDLCPopup(true);
      return;
    }

    /* Company messaging rules, after the registration check so a blocked number
       is refused once rather than twice. */
    const messagingCheck = canSendTo(toNumberFormatted, { dlcVerified: dlsStatus });
    if (!messagingCheck.allowed) {
      handleAlert({ type: 'error', text: messagingCheck.message || 'Texting is switched off.' });
      return;
    }
    if (messagingCheck.warning) {
      handleAlert({ type: 'warning', text: messagingCheck.warning });
    }
    if (!normalizedText && !mmsFile) {
      handleAlert({ type: 'error', text: 'Message or media attachment is required' });
      return;
    }

    const payload: any = {
      from: fromNumber.startsWith('+') ? fromNumber : `+${fromNumber}`,
      to: toNumberFormatted?.trim().replace(/\s+/g, ''),
      text: values?.sms || '',
      isMMS: isMMSMode,
    };

    setIsSending(true);
    try {
      if (isMMSMode && mmsFile) {
        const uploaded = await uploadMMSAttachment(mmsFile);
        payload.mediaUrl = uploaded.mediaUrl;
        payload.filename = uploaded.filename;
      }

      await sendSMSMutate(payload);
    } catch (error: any) {
      if (!error?.response) {
        handleAlert({
          type: 'error',
          text: error?.message || 'Failed to upload MMS attachment',
        });
      }
    } finally {
      setIsSending(false);
    }
  }

  useEffect(() => {
    const isPlusOne = String(to || '')
      .replace(/^\+/, '')
      .startsWith('1');
    if (country && (isPlusOne || countryCode === 'US' || countryCode === 'CA')) {
      dlcStatus({ country });
    }
  }, [country]);

  useEffect(() => {
    if (selectedDID) {
      setValue('from', {
        label: selectedDID?.label,
        value: selectedDID?.value,
      });
    }
  }, [selectedDID]);

  useClickOutside({ current: [emojiContainerRef.current] }, () => setEmojiOpen(false));

  const canSend = !isMMSMode ? Boolean(String(sms || '').trim()) : true;
  const isBusy = isPending || isSending;

  const submit = () => {
    if (isBusy) return;
    handleSubmit((values) => {
      const normalizedText = String(values?.sms || '').trim();
      if (!normalizedText && !mmsFile) {
        handleAlert({ type: 'error', text: 'Message or media attachment is required' });
        return;
      }
      if (!isMMSMode && smsCountData.messages > freeSmsLeft) {
        setSendMsgAlert(true);
      } else {
        handleSendMessage(values);
      }
    })();
  };

  return (
    <div className="mcm-col mcm-col-stage flex h-full w-full min-h-0 flex-col">
      {/* Same header a thread has — closing is the X, exactly as it is there. */}
      <div className="mcm-thread-head">
        <div className="min-w-0 flex-1">
          <div className="mcm-thread-name">New message</div>
          <div className="mcm-thread-num">
            <span className="mcm-tag neu">SMS / MMS</span>
          </div>
        </div>
        <button
          type="button"
          className="mcm-iconbtn"
          onClick={() => handleClose()}
          aria-label="Close new message"
          title="Close"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* addressing — lines, not boxes */}
      <div className="mcm-addr">
        <span className="mcm-addr-label">From:</span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {from?.value ? <Flag phoneNumber={toFlagNumber(from.value)} /> : null}
          <CustomSelect
            className="mcm-addr-select"
            options={
              allDIDNumbers && allDIDNumbers?.length > 0
                ? allDIDNumbers.map((number: any) => ({
                    label: number?.did_number,
                    value: number?.did_number,
                    icon: (
                      <span className="w-5">
                        <Flag phoneNumber={toFlagNumber(number?.did_number)} />
                      </span>
                    ),
                  }))
                : []
            }
            value={from}
            handleChange={(e) => setValue('from', e, { shouldValidate: true })}
            placeholder="Select a number"
          />
        </span>
      </div>
      <div className="mcm-addr">
        <span className="mcm-addr-label">To:</span>
        <RecipientField
          value={String(to || '')}
          fromNumber={from?.value}
          onChange={(next) => setValue('to', next, { shouldValidate: true })}
          /* Only after a send has actually been attempted. Validating the
             whole schema on mount lit up "Phone number is required" on an
             empty, untouched field before anyone had typed a character. While
             typing, RecipientField shows its own gentler hint instead. */
          error={isSubmitted ? (errors?.to?.message as string) : ''}
          autoFocus
        />
      </div>

      <div className="mcm-compose-body">
        <p className="mcm-compose-hint">
          {to
            ? 'This will start a new conversation.'
            : 'Type a name to find a saved contact, or a number to text someone new.'}
        </p>
      </div>

      <div className="mcm-composer">
        {mmsFile ? (
          <div className="mcm-attach">
            <div className="mcm-attach-thumb">
              {mmsPreviewUrl ? (
                <img src={mmsPreviewUrl} alt={mmsFile?.name || 'attachment'} />
              ) : String(mmsFile?.type || '').startsWith('video/') ? (
                <FileVideo2 className="h-5 w-5" />
              ) : String(mmsFile?.type || '').startsWith('audio/') ? (
                <FileAudio2 className="h-5 w-5" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="mcm-attach-name">{mmsFile?.name || 'Attachment'}</div>
              <div className="mcm-attach-sub">
                Sending as MMS
                {mmsFile?.size ? ` · ${(mmsFile.size / 1024 / 1024).toFixed(2)} MB` : ''}
              </div>
            </div>
            <button
              type="button"
              aria-label="Remove attachment"
              className="mcm-iconbtn"
              style={{ width: 26, height: 26 }}
              onClick={() => {
                setMmsFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div className={cn('mcm-composer-shell', isBusy && 'is-busy')}>
          <textarea
            rows={1}
            placeholder="Write a message…"
            value={String(sms)}
            disabled={isBusy}
            maxLength={700}
            onChange={(e) => {
              const value = e.target.value.replace(/^\s+/, '');
              setValue('sms', trimToSmsCountLimit(value), { shouldValidate: true });
            }}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a newline — as in a thread.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />

          <div className="mcm-composer-bar">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,audio/*,video/*"
              className="hidden"
              onClick={(e) => {
                (e.target as HTMLInputElement).value = '';
              }}
              onChange={(e) => {
                const selectedFile = e.target.files?.[0] || null;
                if (selectedFile && !isAllowedMMSFile(selectedFile)) {
                  handleAlert({
                    type: 'error',
                    text: 'Only image, audio, or video files are allowed',
                  });
                  setMmsFile(null);
                  (e.target as HTMLInputElement).value = '';
                  return;
                }
                setMmsFile(selectedFile);
              }}
            />
            <button
              type="button"
              title="Attach image, audio or video"
              aria-label="Attach image, audio or video"
              className="mcm-iconbtn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-[17px] w-[17px]" />
            </button>

            <div className="relative flex items-center">
              <div
                className="emoji-container absolute bottom-[2.75rem] left-0 z-20 max-w-[calc(100vw-2rem)]"
                ref={emojiContainerRef}
              >
                <EmojiPicker
                  className="border-gray-200"
                  lazyLoadEmojis
                  open={emojiOpen}
                  onEmojiClick={(data) => {
                    setValue('sms', trimToSmsCountLimit(`${sms || ''}${data?.emoji || ''}`), {
                      shouldValidate: true,
                    });
                    setEmojiOpen(false);
                  }}
                />
              </div>
              <button
                type="button"
                title="Insert emoji"
                aria-label="Insert emoji"
                className={cn('mcm-iconbtn', emojiOpen && 'is-on')}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEmojiOpen((prev) => !prev);
                }}
              >
                <EmojiICon className="h-[17px] w-[17px]" />
              </button>
            </div>

            {/* Sending is the arrow and closing is the header X, as in a thread —
                no Cancel/Send pair. */}
            <button
              type="button"
              className="mcm-sendbtn ml-auto"
              aria-label="Send message"
              title="Send message"
              disabled={isBusy || !canSend}
              onClick={submit}
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-[17px] w-[17px]" />
              )}
            </button>
          </div>
        </div>

        {/* One quiet line. This was three headings in a justify-between row that
            could not fit and pushed the SMS count off the edge. */}
        {!isMMSMode ? (
          <div className="mcm-composer-foot">
            <span className="hidden sm:inline">Enter to send · Shift + Enter for a new line</span>
            <span className="mcm-compose-stats ml-auto">
              <span className="mcm-num">
                {smsCountData.length} chars · {smsCountData.characterPerMessage}/SMS ·{' '}
                {smsCountData.messages}/{SMS_COUNT_LIMIT}
              </span>
              {freeSmsLeft > 0 ? (
                <span className="mcm-tag pos">
                  <span className="mcm-num">{freeSmsLeft}</span> free left
                </span>
              ) : null}
              <span>
                SMS Charges{' '}
                <span className="mcm-num" style={{ color: 'var(--mcm-ink-2)', fontWeight: 700 }}>
                  ${smsCredits.toFixed(2)}
                </span>
              </span>
            </span>
          </div>
        ) : null}
      </div>

      <DLCVerificationPopup open={showDLCPopup} setOpen={setShowDLCPopup} />
      {!isMMSMode && sendMsgAlert && (
        <AlertConfirm
          open={sendMsgAlert}
          setOpen={setSendMsgAlert}
          onConfirm={handleSubmit(handleSendMessage)}
          descriptionTextComp={getSmsAlert({
            freeSmsLeft,
            smsCount: smsCountData.messages,
            balanceAmount,
            totalSmsCharges,
          })}
          apiLoading={isPending || isSending}
          showButton={!(balanceAmount <= 0)}
          headerText={balanceAmount <= 0 ? 'Alert' : 'Confirm'}
        />
      )}
    </div>
  );
};

export default SendSMSModal;
