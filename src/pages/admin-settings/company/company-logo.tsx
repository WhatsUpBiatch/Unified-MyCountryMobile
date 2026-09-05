/* The company logo, on the Company screen.
 *
 * Kept on the Company Default template beside the other company-level settings
 * rather than on the companies row, because that row is billing data owned by
 * platform staff and tenant writes to it are expected to be refused. See
 * src/lib/company-logo.ts for the full reasoning; the rules about what may be
 * uploaded live there too, tested, rather than in this file.
 */

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { SettingCard } from '@/components/mcm/setting-card';
import { Button } from '@/components/ui/button';
import { AuthenticatedImage } from '@/components/custom/authenticated-media';
import { useUser } from '@/hooks/use-user';
import { handleAlert, getEnv } from '@/lib/utils';
import { mediaUploadUrl } from '@/services/api';
import {
  COMPANY_DEFAULTS_QUERY_KEY,
  fetchCompanyDefaults,
  saveCompanyDefaults,
} from '@/lib/company-defaults';
import {
  ACCEPTED_LOGO_TYPES,
  LOGO_SETTINGS_KEY,
  buildStoredLogo,
  checkLogoFile,
  logoMediaUrl,
  readStoredLogo,
} from '@/lib/company-logo';

const CompanyLogo = () => {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const companyUuid = user?.company_info?.uuid || (user as any)?.company_uuid || '';

  const { data: companyDefaults } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
  });

  const fileName = readStoredLogo(companyDefaults?.settings);
  const src = logoMediaUrl({
    apiBaseUrl: getEnv().VITE_API_BASE_URL,
    companyUuid,
    fileName,
  });

  /* Saving merges into the existing settings rather than replacing them. The
     template is shared by every company-level screen, so writing the whole blob
     would quietly discard whatever another screen saved a moment ago. */
  const persist = async (storedFileName: string) => {
    await saveCompanyDefaults({
      uuid: companyDefaults?.uuid,
      settings: {
        ...(companyDefaults?.settings || {}),
        [LOGO_SETTINGS_KEY]: buildStoredLogo(storedFileName),
      },
      greetings: companyDefaults?.greetings || {},
      only: [LOGO_SETTINGS_KEY],
    });
    queryClient.invalidateQueries({ queryKey: COMPANY_DEFAULTS_QUERY_KEY });
  };

  const { mutate: removeLogo, isPending: removing } = useMutation({
    mutationFn: () => persist(''),
    onSuccess: () => handleAlert({ type: 'success', text: 'Logo removed.' }),
    onError: () =>
      handleAlert({ type: 'error', text: 'That could not be saved. Try again in a moment.' }),
  });

  const onChoose = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    /* Cleared straight away so choosing the same file twice still fires - a
       browser will not re-trigger change for an unchanged value, and somebody
       re-picking the file they just fixed is exactly the case that matters. */
    event.target.value = '';
    if (!file) return;

    const check = checkLogoFile(file);
    if (!check.ok) {
      handleAlert({ type: 'error', text: check.reason || 'That file cannot be used.' });
      return;
    }
    if (check.advice) {
      handleAlert({ type: 'info', text: check.advice });
    }

    setBusy(true);
    try {
      const response = await mediaUploadUrl({
        uuid: companyUuid,
        type: 'logo',
        file_name: file.name,
      });
      const result = response?.data?.data?.result;
      if (!result?.url || !result?.file_name) {
        throw new Error('No upload address came back');
      }

      const put = await fetch(result.url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      /* The upload goes straight to storage, so a failure here never reaches
         our own error handling - it has to be checked explicitly or a broken
         upload looks like a successful one. */
      if (!put.ok) {
        throw new Error(`Storage refused the file (${put.status})`);
      }

      await persist(result.file_name);
      handleAlert({ type: 'success', text: 'Logo updated.' });
    } catch {
      handleAlert({
        type: 'error',
        text: 'That did not upload. Check your connection and try again — nothing has changed.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingCard
      title="Company logo"
      description="Shown in the top corner of the app for everyone in your company."
      status="active"
      note="This one is live: whatever you upload here is what your team sees when they open the app."
    >
      <div className="flex flex-wrap items-center gap-4 py-2">
        <div className="flex h-16 w-40 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3">
          {src ? (
            <AuthenticatedImage
              src={src}
              alt="Your company logo"
              className="max-h-12 max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-gray-500">No logo yet</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? 'Uploading…' : fileName ? 'Replace' : 'Upload'}
            </Button>
            {fileName ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy || removing}
                onClick={() => removeLogo()}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-gray-600">
            A PNG, so the background stays transparent. It is shown small, so it does not need to be
            a large file.
          </p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_LOGO_TYPES.join(',')}
          className="hidden"
          onChange={onChoose}
        />
      </div>
    </SettingCard>
  );
};

export default CompanyLogo;
