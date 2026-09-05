import CustomSelect from '@/components/custom/custom-select';
import Flag, { toFlagNumber } from '@/components/flag';
import Loader from '@/components/custom/loader';
import { useUser } from '@/hooks/use-user';
import { cn, formatFileSize, getEnv, handleAlert } from '@/lib/utils';
import { mediaUploadUrl, sendFax } from '@/services/api';
import { yupResolver } from '@hookform/resolvers/yup';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import RecipientField from '../recipient-field';

const MAX_FAX_FILE_SIZE = 10 * 1024 * 1024;

const validationSchema = yup.object().shape({
  from: yup
    .object({
      label: yup.string().required(),
      value: yup.string().required(),
    })
    .nullable()
    .required('DID number is required'),
  to: yup.string().required('Phone number is required'),
});

const isPdfFile = (file: File) => {
  const mimeType = String(file.type || '').toLowerCase();
  const hasPdfExtension = String(file.name || '')
    .toLowerCase()
    .endsWith('.pdf');
  return hasPdfExtension && (!mimeType || mimeType === 'application/pdf');
};

const normalizePhoneNumber = (number: string) => {
  const normalizedNumber = String(number || '')
    .trim()
    .replace(/\s+/g, '');
  return normalizedNumber.startsWith('+') ? normalizedNumber : `+${normalizedNumber}`;
};

interface SendFaxModalProps {
  handleClose?: (sent?: boolean) => void;
  defaultNumber?: string;
  faxDIDOptions?: any[];
  selectedDID?: any;
  isFromDisabled?: boolean;
}

const SendFaxModal = ({
  handleClose = () => undefined,
  defaultNumber = '',
  faxDIDOptions = [],
  selectedDID,
  isFromDisabled = false,
}: SendFaxModalProps) => {
  const { user } = useUser();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [faxFile, setFaxFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const queryClient = useQueryClient();

  const {
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitted },
  } = useForm<any>({
    mode: 'onChange',
    defaultValues: {
      from: selectedDID?.value ? selectedDID : faxDIDOptions[0] || null,
      to: defaultNumber,
    },
    resolver: yupResolver(validationSchema),
  });

  const [from, to] = watch(['from', 'to']);

  useEffect(() => {
    if (from?.value) return;
    const defaultFrom = selectedDID?.value ? selectedDID : faxDIDOptions[0];
    /* No validation on this hydration: it runs the whole schema and would
       report the empty To field before anyone has touched the form. */
    if (defaultFrom) setValue('from', defaultFrom);
  }, [faxDIDOptions, from?.value, selectedDID, setValue]);

  const { mutateAsync: sendFaxMutate, isPending } = useMutation({
    mutationFn: sendFax,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxList'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['faxToNumberList'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['getUsersDetails'], exact: false });
      handleAlert({ type: 'success', text: 'Fax sent successfully' });
      handleClose(true);
    },
    onError: ({ response }: any) => {
      handleAlert({
        type: 'error',
        text: response?.data?.error?.message || 'Failed to send fax',
      });
    },
  });

  const clearFile = () => {
    setFaxFile(null);
    setFileError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const selectFile = (file?: File | null) => {
    if (!file) return;

    if (!isPdfFile(file)) {
      clearFile();
      setFileError('Only PDF files are allowed');
      handleAlert({ type: 'error', text: 'Only PDF files are allowed' });
      return;
    }

    if (file.size > MAX_FAX_FILE_SIZE) {
      clearFile();
      setFileError('PDF file size must be 10MB or less');
      handleAlert({ type: 'error', text: 'PDF file size must be 10MB or less' });
      return;
    }

    setFileError('');
    setFaxFile(file);
  };

  const uploadFaxFile = async (file: File) => {
    const companyUuid = user?.company_info?.uuid || user?.company_uuid;
    if (!companyUuid) throw new Error('Company uuid not found');

    const uploadResponse = await mediaUploadUrl({
      uuid: companyUuid,
      type: 'fax',
      file_name: file.name,
    });
    const uploadResult = uploadResponse?.data?.data?.result;
    const uploadUrl = uploadResult?.url;
    const fileName = uploadResult?.file_name;

    if (!uploadUrl || !fileName) throw new Error('Failed to generate fax upload URL');

    const fileUploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
    });

    if (!fileUploadResponse.ok) throw new Error('Failed to upload PDF');
    const apiBaseUrl = String(getEnv().VITE_API_BASE_URL || '').replace(/\/+$/, '');
    if (!apiBaseUrl) throw new Error('API base URL is not configured');

    return `${apiBaseUrl}/api/media/direct/${encodeURIComponent(companyUuid)}/fax/${encodeURIComponent(fileName)}`;
  };

  const handleSendFax = async (values: any) => {
    if (isPending || isUploading) return;
    if (!faxFile) {
      setFileError('PDF file is required');
      return;
    }

    setIsUploading(true);
    try {
      const mediaUrl = await uploadFaxFile(faxFile);
      await sendFaxMutate({
        from: normalizePhoneNumber(values?.from?.value),
        to: normalizePhoneNumber(values?.to),
        mediaUrl,
        pageCount: 1,
        storePreview: true,
        previewFormat: 'pdf',
      });
    } catch (error: any) {
      if (!error?.response) {
        handleAlert({
          type: 'error',
          text: error?.message || 'Failed to upload PDF',
        });
      }
    } finally {
      setIsUploading(false);
    }
  };

  const isSubmitting = isPending || isUploading;
  const canSend = Boolean(from?.value && String(to || '').trim() && faxFile);

  return (
    <form
      className="mcm-col mcm-col-stage flex h-full w-full min-h-0 flex-col"
      onSubmit={handleSubmit(handleSendFax)}
    >
      {/* Same header a thread has — closing is the X. */}
      <div className="mcm-thread-head">
        <div className="min-w-0 flex-1">
          <div className="mcm-thread-name">New fax</div>
          <div className="mcm-thread-num">
            <span className="mcm-tag neu">FAX</span>
          </div>
        </div>
        <button
          type="button"
          className="mcm-iconbtn"
          onClick={() => handleClose()}
          aria-label="Close new fax"
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
            options={faxDIDOptions}
            value={from}
            placeholder="Select a fax number"
            handleChange={(value) => setValue('from', value, { shouldValidate: true })}
            isDisabled={isFromDisabled}
          />
        </span>
      </div>
      <div className="mcm-addr">
        <span className="mcm-addr-label">To:</span>
        <RecipientField
          value={String(to || '')}
          fromNumber={from?.value}
          onChange={(next) => setValue('to', next, { shouldValidate: true })}
          error={isSubmitted ? (errors?.to?.message as string) : ''}
          autoFocus={!isFromDisabled}
        />
      </div>

      <div className="mcm-compose-body">
        {faxFile ? (
          /* Still a label, so clicking the card swaps the PDF for another one
             without having to remove it first. */
          <label
            htmlFor="fax-file-upload"
            className="mcm-doc cursor-pointer"
            title="Choose a different PDF"
          >
            <span className="mcm-doc-ic">
              <FileText className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="mcm-doc-name block">{faxFile.name}</span>
              <span className="mcm-doc-sub block">{formatFileSize(faxFile.size)} · PDF</span>
            </span>
            <button
              type="button"
              className="mcm-iconbtn"
              onClick={(event) => {
                // inside a label: without this, removing also reopens the picker
                event.preventDefault();
                event.stopPropagation();
                clearFile();
              }}
              aria-label="Remove PDF"
              title="Remove PDF"
            >
              <X className="h-4 w-4" />
            </button>
          </label>
        ) : (
          <label
            htmlFor="fax-file-upload"
            className={cn('mcm-drop', isDragging && 'is-dragging', fileError && 'is-error')}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDragging(false);
              selectFile(event.dataTransfer.files?.[0]);
            }}
          >
            <Upload className="h-5 w-5" />
            <span className="mcm-drop-title">{isDragging ? 'Drop PDF here' : 'Upload a PDF'}</span>
            <span className="mcm-drop-sub">Drag one in, or click to choose · max 10MB</span>
          </label>
        )}

        <input
          ref={fileInputRef}
          id="fax-file-upload"
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onClick={(event) => {
            event.currentTarget.value = '';
          }}
          onChange={(event) => selectFile(event.target.files?.[0])}
        />

        {fileError ? (
          <p className="mcm-compose-hint" style={{ color: 'var(--mcm-crit)' }}>
            {fileError}
          </p>
        ) : null}
      </div>

      <div className="mcm-composer">
        <div className="mcm-composer-foot" style={{ marginTop: 0 }}>
          <span>A fax is one PDF. Attach it above, then send.</span>
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="mcm-btn sm"
              onClick={() => handleClose()}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="mcm-btn sm primary"
              disabled={!canSend || isSubmitting}
            >
              {isSubmitting ? <Loader variant="white" size="sm" /> : 'Send Fax'}
            </button>
          </span>
        </div>
      </div>
    </form>
  );
};

export default SendFaxModal;
