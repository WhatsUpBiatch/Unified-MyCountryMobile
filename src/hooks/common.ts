import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  callQueueList,
  getAssignDidList,
  getDepartmentList,
  getGreetings,
  getUserList,
  ivrList,
  siteList,
  fetchContact,
  cardList,
  getGroupList,
  getPlans,
  getMyPlanDetails,
} from '@/services/api'; // adjust this

// Types
type GreetingType = 'greeting' | 'voicemail' | 'prompt';

export interface GreetingItem {
  id: string;
  name: string;
  type: GreetingType;
  [key: string]: any;
}

interface RawGreetingResponse {
  data: {
    data: {
      result: { rows: GreetingItem[] };
    };
  };
}

interface GetExtensionsPayload {
  page?: number;
  limit?: number;
  filters?: { key: string; value: unknown }[];
  search?: string;
  role?: string[];
  displayType?: 'dropdown';
}

export const useGetGreetings = (params?: any) => {
  const { data: greetingData } = useQuery<RawGreetingResponse, Error, GreetingItem[]>({
    queryKey: ['greetings', params],
    queryFn: () => getGreetings({ page: 1, limit: 1000, search: '', type: 'all', ...params }),
    select: (res) => res?.data?.data?.result?.rows ?? [],
  });

  const greetingList = useMemo(() => {
    return greetingData?.filter((item) => item.type === 'greeting') ?? [];
  }, [greetingData]);

  const voicemailList = useMemo(() => {
    return greetingData?.filter((item) => item.type === 'voicemail') ?? [];
  }, [greetingData]);

  const promptList = useMemo(() => {
    return greetingData?.filter((item) => item.type === 'prompt') ?? [];
  }, [greetingData]);

  return {
    ...greetingData,
    /* Every recording, unfiltered. The lists above answer "what may go in a
       greeting slot"; this answers "what exists", which is what a screen needs
       when it wants only the recordings made for one particular slot. */
    allGreetings: greetingData ?? [],
    greetingList,
    voicemailList,
    promptList,
  };
};

export const useGetAssignedDIDNumbers = (uuid?: string) => {
  return useQuery({
    // The uuid goes into the request body, so it has to go into the key too:
    // without it every caller shares one cache entry and an admin looking at a
    // second person's numbers is served the first person's. `null` keeps the
    // no-argument (own numbers) call on a stable key of its own.
    queryKey: ['getAssignedDIDNumbersQuery', uuid ?? null],
    queryFn: () =>
      getAssignDidList({
        page: 1,
        limit: 1000,
        filters: [],
        search: '',
        ...(uuid && { user_uuid: uuid || '' }),
      }),
    select: (data) => data?.data?.data?.result?.rows,
  });
};

export const useGetExtensions = (
  payload: GetExtensionsPayload = {
    page: 1,
    limit: 25,
    filters: [],
    search: '',
  },
) => {
  return useQuery({
    queryKey: ['getExtensions', payload],
    queryFn: () => getUserList(payload),
    select: (data) => data?.data?.data?.result?.rows || [],
  });
};

export const useGetSite = () => {
  const res = useQuery({
    queryKey: ['useGetSite'],
    queryFn: siteList,
    select: (data) => data?.data?.data?.result?.rows || [],
  });
  return res;
};

export const useGetSavedCards = (enabled = true) => {
  return useQuery({
    queryKey: ['useGetSavedCards'],
    queryFn: () => cardList(),
    select: (data) => data?.data?.data?.result?.rows || [],
    enabled: enabled,
  });
};
export const useGetDepartment = (params?: any) => {
  const { isEnabled = true, ...rest } = params || {};
  return useQuery({
    queryKey: ['getDepartmentList', rest],
    queryFn: () => getDepartmentList(rest),
    select: (data) => data?.data?.data?.result?.rows || [],
    enabled: isEnabled,
  });
};

export const useGetIVR = (params?: any) => {
  return useQuery({
    queryKey: ['getIVRList', params],
    queryFn: () => ivrList({ page: 1, limit: 9999, filters: [], search: '', ...params }),
    select: (data) => data?.data?.data?.result?.rows || [],
  });
};

export const useGetQueueList = (params?: any) => {
  return useQuery({
    queryKey: ['getCallQueueListQuery', params],
    queryFn: () => callQueueList({ page: 1, limit: 1000, ...params }),
    select: (data) => data?.data?.data?.result?.rows || [],
  });
};
/* Every caller of this hook looks the result up as data[number] - a
   number-keyed map of saved contacts, not a page of rows. The endpoint
   returns Mongo contact documents (`name.first/last`, `contact.phone`), and
   phone numbers are saved in whatever form the user typed them, so each
   contact is indexed under several forms of its number: as saved, digits
   only, and with a leading "+". That way a direct single-key lookup (inbox,
   contact-call-log-content) and the fallback-scanning lookup in the console
   (findContact) both land on the same contact. */
const contactKeyVariants = (raw: string): string[] => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [];
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return [trimmed];
  return [trimmed, digits, `+${digits}`];
};

export const useFetchContact = (payload?: any) => {
  return useQuery({
    queryKey: ['fetchContact', payload],
    queryFn: () => fetchContact(payload),
    select: (data) => {
      const rows = data?.data?.data?.result?.rows || [];
      const map: Record<string, any> = {};
      rows.forEach((row: any) => {
        const phone = row?.contact?.phone;
        if (!phone) return;
        const value = {
          id: row?._id || row?.id,
          first_name: row?.name?.first || '',
          last_name: row?.name?.last || '',
          name: `${row?.name?.first || ''} ${row?.name?.last || ''}`.trim(),
        };
        contactKeyVariants(phone).forEach((key) => {
          map[key] = value;
        });
      });
      return map;
    },
  });
};

export const useGetGroupList = (type?: any) => {
  return useQuery({
    queryKey: ['getGroupListQuery', type],
    queryFn: () => getGroupList({ page: 1, limit: 1000, ...type }),
    select: (data) => data?.data?.data?.result?.rows || [],
  });
};

export const useGetPlans = (enabled = true) => {
  return useQuery({
    queryKey: ['useGetPlans'],
    queryFn: getPlans,
    select: (data) => data?.data?.data?.result?.rows || [],
    enabled,
  });
};

export const useGetMyPlanDetails = (data?: any, isEnabled?: boolean) => {
  return useQuery({
    queryKey: ['useGetMyPlanDetails'],
    queryFn: () => getMyPlanDetails(data),
    select: (data) => data?.data?.data?.result || {},
    enabled: isEnabled,
  });
};
