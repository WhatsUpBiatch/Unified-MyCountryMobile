import { FC, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { UploadGreetingProps } from '@/interfaces/audio-interface';
import { Controller, useFormContext } from 'react-hook-form';
import CustomSelect from '@/components/custom/custom-select';
import { useMutation, useQuery } from '@tanstack/react-query';
import { COMPANY_DEFAULTS_QUERY_KEY, fetchCompanyDefaults } from '@/lib/company-defaults';
import { getGreetingVoiceList } from '@/services/api';
import ReadyAudio from '@/components/custom/ready-audio';

/* The voices this screen can reach.
 *
 * The list of voices comes from the server, but only for a locale asked for by
 * name — so a locale missing here is a locale whose voices nobody can choose,
 * however many the provider offers. British English was missing, which is why
 * an account could end up holding a British recording it had no way to make a
 * second of, and why every voice on offer was American.
 *
 * British English added for that reason. The two are listed together, most
 * asked-for first. */
const LANGUAGE_OPTIONS = [
  { label: 'English (United States)', value: 'en-US' },
  { label: 'English (United Kingdom)', value: 'en-GB' },
  { label: 'Hindi (India)', value: 'hi-IN' },
  { label: 'Spanish (Spain)', value: 'es-ES' },
  { label: 'Arabic (Saudi Arabia)', value: 'ar-SA' },
];

const sanitizeTextByLocale = (text: string, locale: string) => {
  if (!locale) return '';

  const filters: Record<string, RegExp> = {
    'hi-IN': /[^\p{Script=Devanagari}0-9\s.,!?;:'"()\-_/&@#%+*=]/gu,
    'en-US': /[^A-Za-z0-9\s.,!?;:'"()\-_/&@#%+*=]/g,
    /* Same alphabet as en-US. Without an entry the filter is skipped entirely
       and whatever is typed goes to the provider unchecked, which is the one
       thing this function exists to prevent. */
    'en-GB': /[^A-Za-z0-9\s.,!?;:'"()\-_/&@#%+*=]/g,
    'es-ES':
      /[^A-Za-z0-9\u00C1\u00C9\u00CD\u00D3\u00DA\u00DC\u00D1\u00E1\u00E9\u00ED\u00F3\u00FA\u00FC\u00F1\s.,!?;:'"()\-_/&@#%+*=]/g,
    'ar-SA': /[^\p{Script=Arabic}0-9\s.,!?;:'"()\-_/&@#%+*=]/gu,
  };

  const filter = filters[locale];
  if (!filter) return text;
  return text.replace(filter, '');
};

/* Which language a voice actually speaks.
 *
 * The provider's own field is `Locale`, capitalised, and whatever hands it to
 * this screen may pass it through as-is, lower-case it, or drop it. The filter
 * used to read `voice.locale` alone and let anything without that exact key
 * through, so on a response where the key is spelled any other way NOTHING was
 * ever filtered: choosing English (United Kingdom) returned the American list,
 * and the voice picked from it did not sound British because it was not.
 *
 * The identifier is the reliable answer. Every voice name from this provider
 * starts with its locale — `en-GB-RyanNeural` — so when no field carries it,
 * the name does. */
const voiceLocale = (voice: any): string => {
  const named = voice?.locale || voice?.Locale || voice?.locale_name || voice?.LocaleName;
  if (typeof named === 'string' && named) return named;

  const id = voice?.short_name || voice?.ShortName || voice?.voice_name || voice?.name || '';
  const match = /^([a-z]{2}-[A-Z]{2})/.exec(String(id));
  return match ? match[1] : '';
};

const voiceGender = (voice: any): string =>
  String(voice?.gender || voice?.Gender || '').toLowerCase();

/* One female and one male per language, named.
 *
 * Asked for a British voice a customer means a British-sounding one, and the
 * provider's list for a locale runs to dozens — most of them variants, some
 * multilingual models that carry an accent from wherever the text came from.
 * These are the plain neural voices for each locale, one of each gender.
 *
 * It is a preference, not a whitelist: anything not on this list still shows if
 * the preferred ones are absent, so a provider change cannot empty the picker. */
const PREFERRED_VOICES: Record<string, string[]> = {
  'en-US': ['en-US-JennyNeural', 'en-US-GuyNeural'],
  'en-GB': ['en-GB-SoniaNeural', 'en-GB-RyanNeural'],
};

const getVoiceOptions = (response: any, locale: string) => {
  const voices =
    response?.data?.data?.voices ||
    response?.data?.data?.result?.voices ||
    response?.data?.data?.result?.rows ||
    response?.data?.data?.result ||
    [];

  if (!Array.isArray(voices)) return [];

  const mapped = voices
    .filter((voice: any) => {
      if (!locale) return true;
      const its = voiceLocale(voice);
      /* Only a voice whose language cannot be established at all is given the
         benefit of the doubt. One that says it speaks another is dropped. */
      return !its || its === locale;
    })
    .map((voice: any, index: number) => {
      const baseLabel =
        voice?.display_name ||
        voice?.local_name ||
        voice?.label ||
        voice?.name ||
        `Voice ${index + 1}`;
      const gender = voice?.gender || voice?.Gender;
      const genderSuffix = gender ? ` (${gender})` : '';
      const value =
        voice?.short_name ||
        voice?.ShortName ||
        voice?.voice_name ||
        voice?.value ||
        voice?.id ||
        voice?.uuid ||
        String(index);

      return { ...voice, label: `${baseLabel}${genderSuffix}`, value };
    });

  /* The provider ships several variants under one display name — Jenny and
     Jenny Multilingual are both "Jenny (Female)" — so the picker showed the
     same name twice with no way to tell which was which. One entry per name. */
  const seen = new Set<string>();
  const unique = mapped.filter((option: any) => {
    const key = option.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const preferred = PREFERRED_VOICES[locale];
  if (!preferred) return unique;

  const chosen = preferred
    .map((name) => unique.find((option: any) => option.value === name))
    .filter(Boolean);
  if (chosen.length === preferred.length) return chosen;

  /* Not the named ones — take the first of each gender instead, so the list is
     still one voice each rather than the whole catalogue. */
  const female = unique.find((option: any) => voiceGender(option) === 'female');
  const male = unique.find((option: any) => voiceGender(option) === 'male');
  const fallback = [female, male].filter(Boolean);
  return fallback.length ? fallback : unique;
};

const TextToSpeech: FC<UploadGreetingProps> = ({ handleTextToSpeech, isPendingTextToSpeech }) => {
  const { watch, control, setValue } = useFormContext();
  const WatchTextFile = watch('textFile');
  const selectedLocale = watch('textToSpeechLocale');
  const selectedVoice = watch('textToSpeechVoice');
  const [voiceOptions, setVoiceOptions] = useState<any[]>([]);

  /* Start in the company's chosen language instead of making every admin pick
     it again for every greeting. Only pre-selects when that language actually
     has voices here — the company setting offers more languages than this
     screen can speak, and silently switching someone to a language they did
     not choose would be worse than leaving the field empty. */
  const { data: companyDefaults } = useQuery({
    queryKey: COMPANY_DEFAULTS_QUERY_KEY,
    queryFn: fetchCompanyDefaults,
    staleTime: 5 * 60 * 1000,
  });
  const companyLanguage = companyDefaults?.settings?.company_policies?.default_language;

  const { mutate: mutateVoiceList, isPending: isVoiceListLoading } = useMutation({
    mutationFn: getGreetingVoiceList,
    onSuccess: (data, variables) => {
      const options = getVoiceOptions(data, variables?.locale || '');
      setVoiceOptions(options);
      setValue('textToSpeechVoice', options[0] || null, { shouldDirty: true });
    },
    onError: () => {
      setVoiceOptions([]);
      setValue('textToSpeechVoice', null, { shouldDirty: true });
    },
  });

  /* Pre-selects the company language once, and only if it is empty. */
  useEffect(() => {
    if (selectedLocale?.value || !companyLanguage) return;
    const match = LANGUAGE_OPTIONS.find((option) => option.value === companyLanguage);
    if (!match) return;
    setValue('textToSpeechLocale', match, { shouldDirty: false });
    mutateVoiceList({ locale: match.value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyLanguage, selectedLocale?.value]);

  const audioUrl = useMemo(() => {
    return WatchTextFile ? URL.createObjectURL(WatchTextFile) : null;
  }, [WatchTextFile]);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  return (
    <div className={`flex flex-col gap-4 pt-2 w-full `}>
      <CustomSelect
        label={'Language'}
        options={LANGUAGE_OPTIONS}
        value={selectedLocale}
        placeholder="Select language"
        handleChange={(option) => {
          setValue('textToSpeechLocale', option, { shouldDirty: true, shouldValidate: true });
          setValue('textToSpeech', '');
          setValue('textFile', null);
          setValue('textToSpeechVoice', null);
          setVoiceOptions([]);

          if (option?.value) {
            mutateVoiceList({ locale: option.value });
          }
        }}
      />
      <CustomSelect
        label={'Voice'}
        options={voiceOptions}
        value={selectedVoice}
        placeholder={selectedLocale ? 'Select voice' : 'Select language first'}
        isDisabled={!selectedLocale}
        isLoading={isVoiceListLoading}
        handleChange={(option) => {
          setValue('textToSpeechVoice', option, { shouldDirty: true, shouldValidate: true });
          setValue('textFile', null);
        }}
      />
      <label className="flex items-center gap-2 text-sm leading-none font-medium group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
        Enter the text you want to convert into speech.
      </label>
      <Controller
        name="textToSpeech"
        control={control}
        render={({ field }) => (
          <textarea
            rows={5}
            value={field.value || ''}
            onChange={(event) => {
              const locale = selectedLocale?.value || '';
              const sanitizedText = sanitizeTextByLocale(event.target.value, locale);
              field.onChange(sanitizedText);
              setValue('textFile', null);
            }}
            placeholder={selectedLocale ? 'Type your text here...' : 'Select language first'}
            className=" border border-gray-300 rounded-xl text-sm min-h-[86px]  p-3 hover:border-primary focus:border-primary focus-visible:border-primary focus-visible:outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
            maxLength={500}
            disabled={!selectedLocale}
          />
        )}
      />
      <p className="text-xs text-gray-500">
        {selectedLocale
          ? 'You can type only characters from the selected language script.'
          : 'Choose a language to enable typing.'}
      </p>

      <div className="flex justify-center">
        <Button
          variant={'outline'}
          type="button"
          onClick={handleTextToSpeech}
          disabled={!watch('textToSpeech') || !selectedLocale || isPendingTextToSpeech}
        >
          Text to Speech
        </Button>
      </div>
      {WatchTextFile && audioUrl && <ReadyAudio controls src={audioUrl} />}
    </div>
  );
};

export default TextToSpeech;
