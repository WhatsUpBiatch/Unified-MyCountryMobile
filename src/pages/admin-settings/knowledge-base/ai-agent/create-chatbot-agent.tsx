import CustomAvatar from '@/components/custom/custom-avatar';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { formatFileSize, handleAlert } from '@/lib/utils';
import {
  sanitizeAiPlainText,
  sanitizeAiPromptText,
  sanitizeAiSearchText,
} from '@/lib/ai-input-security';
import {
  createAIAgent,
  CRMIsConnected,
  AIUserKnowledgeBase,
  cleanupKnowledgeBaseReviewJobs,
  getKnowledgeBaseReviewJob,
  getAIReceptionistList,
  getChatAgentList,
  getAIAgentType,
  siteList,
  siteCrawl,
  startKnowledgeBaseReviewJob,
  updateAIAgent,
  userAddContent,
  userIngestURL,
  uploadIngestPdf,
  type GenerateKnowledgeBaseFaqPayload,
  type SummarizeKnowledgeBasePayload,
} from '@/services/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  FileText,
  Folder,
  Globe2,
  Info,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Settings2,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { FormProvider, useForm } from 'react-hook-form';
import { OPERATIONAL_HOURS } from '@/components/common-settings/constants';
import { getWeeklyScheduleName } from '@/components/common-settings';
import { useGetExtensions, useGetQueueList } from '@/hooks/common';
import useDebounce from '@/hooks/use-debounce';
import { usePaginatedUsers } from '@/hooks/use-paginated-users';
import BussinessHoursModal from '@/components/custom/bussiness-hours-dialog';
import CustomSelect from '@/components/custom/custom-select';
import { getAi360WidgetKey, getChatWidgetColors } from './chat-agent-configure-modal';
import WebsiteScanProgressModal, {
  type WebsiteScanProgressStatus,
} from '../components/website-scan-progress-modal';
import WizardLeaveConfirmModal from '../components/wizard-leave-confirm-modal';
import { getConnectedCrmOptions, normalizeCrmValue } from '../crm-options';
import { Grid } from '@/assets/icons';
import AgentSiteSelection, {
  getAgentSiteId,
  getAgentSiteRegionalSettings,
  getAgentSiteTimezone,
  getPreferredAgentSiteId,
} from '../components/agent-site-selection';
import { Picker } from '@/components/mcm/picker';

type SourceStage = 1 | 2 | 3;

type EditAgentTab = 'overview' | 'brain' | 'website' | 'review' | 'handoff' | 'advanced';
type WizardEditAgentTab = Exclude<EditAgentTab, 'overview'>;
type SourceRecord = {
  id: string;
  title: string;
  source: string;
  type: string;
  detail: string;
};
type KnowledgeDocument = {
  id: string;
  title: string;
  copy: string;
  source: string;
  status: string;
  type?: string;
};
type KnowledgeFaq = {
  id: string;
  question: string;
  answer: string;
  source: string;
};
type ReviewKnowledgeItemType = 'document' | 'faq';
type ReviewKnowledgeEditModalState = {
  type: ReviewKnowledgeItemType;
  id: string;
  title: string;
  body: string;
};
type ReviewKnowledgeAddModalState = {
  type: ReviewKnowledgeItemType;
  mode: 'text' | 'upload';
  title: string;
  body: string;
  file: globalThis.File | null;
};
type ReviewKnowledgeSourceModalState = {
  type: ReviewKnowledgeItemType;
  title: string;
  body: string;
  source: string;
  status: string;
};
type PendingTextKnowledge = {
  id: string;
  title: string;
  text: string;
};
type PendingFileKnowledge = {
  id: string;
  file: globalThis.File;
};
type PickPageCategory = {
  id: string;
  title: string;
  subtitle: string;
  links: string[];
  stripLeadingSegments: number;
};
type PickPageKeywordCategory = {
  id: string;
  title: string;
  keywords: string[];
};
type KnowledgeBaseSourceType = 'text' | 'url' | 'pdf';
type ReusableKnowledgeAgent = {
  id: string;
  channel: 'chat' | 'voice';
  name: string;
  meta: string;
  documents: KnowledgeDocument[];
  faqs: KnowledgeFaq[];
  textIds: string[];
  urlIds: string[];
  pdfIds: string[];
};
type CreatedKnowledgeIds = {
  text: string[];
  url: string[];
  pdf: string[];
  faqTextId?: string;
};
type DetailField = 'name' | 'dob' | 'phone' | 'email' | 'address';
type UseCaseTemplateOption = {
  id: string;
  name: string;
  welcomeGreeting: string;
  systemPrompt: string;
};
type StepErrors = Partial<
  Record<
    | 'botName'
    | 'companyBrand'
    | 'welcomeMessage'
    | 'systemPrompt'
    | 'websiteUrl'
    | 'extraUrl'
    | 'knowledgeBase'
    | 'siteLocation'
    | 'queue'
    | 'manager',
    string
  >
>;

const MAX_AGENT_NAME_LENGTH = 70;
const AGENT_NAME_ALLOWED_PATTERN = /^[A-Za-z0-9 ]+$/;
const AGENT_NAME_INVALID_CHARS_PATTERN = /[^A-Za-z0-9 ]/g;

const sanitizeAgentName = (value: string) =>
  value.replace(AGENT_NAME_INVALID_CHARS_PATTERN, '').slice(0, MAX_AGENT_NAME_LENGTH);

const getAgentNameValidationError = (value: string, label: string) => {
  const trimmedValue = value.trim();
  if (!trimmedValue) return `${label} is required.`;
  if (value.length > MAX_AGENT_NAME_LENGTH) {
    return `${label} must be ${MAX_AGENT_NAME_LENGTH} characters or fewer.`;
  }
  if (!AGENT_NAME_ALLOWED_PATTERN.test(trimmedValue)) {
    return `${label} can only include letters, numbers, and spaces.`;
  }
  return '';
};

const getScrollParent = (element: HTMLElement): HTMLElement | null => {
  let parent = element.parentElement;

  while (parent) {
    const style = window.getComputedStyle(parent);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY);
    if (canScrollY && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }

  return null;
};

const scrollToFirstValidationError = (errors: Record<string, string | undefined>) => {
  const firstKey = Object.keys(errors).find((key) => Boolean(errors[key]));
  if (!firstKey || typeof window === 'undefined') return;

  window.requestAnimationFrame(() => {
    const element = document.querySelector(
      `[data-validation-key="${firstKey}"]`,
    ) as HTMLElement | null;
    if (!element) return;

    const scrollParent = getScrollParent(element);
    const rect = element.getBoundingClientRect();
    const visibleArea = scrollParent?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };
    const isVisible = rect.top >= visibleArea.top && rect.bottom <= visibleArea.bottom;

    if (!isVisible) {
      if (scrollParent) {
        const parentRect = scrollParent.getBoundingClientRect();
        const nextTop =
          scrollParent.scrollTop +
          rect.top -
          parentRect.top -
          scrollParent.clientHeight / 2 +
          rect.height / 2;
        scrollParent.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
      } else {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    const focusable = element.querySelector(
      'input, textarea, select, button',
    ) as HTMLElement | null;
    focusable?.focus({ preventScroll: true });
  });
};

const wizardSteps = [
  'Identity & Behavior',
  'Website',
  'Pick pages',
  'Review',
  'Handoff',
  'Advanced Settings',
];

const editTabToStep: Record<WizardEditAgentTab, number> = {
  brain: 1,
  website: 2,
  review: 2,
  handoff: 6,
  advanced: 7,
};
const editAgentTabs = ['overview', 'brain', 'website', 'review', 'handoff', 'advanced'] as const;
const isEditAgentTab = (value: unknown): value is EditAgentTab =>
  typeof value === 'string' && editAgentTabs.includes(value as EditAgentTab);
const isWizardEditAgentTab = (value: EditAgentTab): value is WizardEditAgentTab =>
  value !== 'overview';

const languageChoices = [
  { label: 'English', value: 'english' },
  { label: 'Spanish', value: 'spanish' },
  { label: 'Hindi', value: 'hindi' },
];

const DEFAULT_TEMPERATURE = 'Balanced';
const TEMPERATURE_MAP: Record<string, string> = {
  'Low (More consistent)': 'low',
  Balanced: 'medium',
  'High (More creative)': 'high',
};
const MAX_DURATION_SECONDS = 30 * 60;
const MAX_IDLE_REMINDER_RETRIES = 30;

const getGreetingText = (type: string, brandName: string) => {
  const brand = brandName || 'Example Business';
  switch (type) {
    case 'friendly':
      return "Hi there! 👋 I'm here to help with pricing, features, or anything else you need.";
    case 'professional':
      return `Hello! Welcome to ${brand}. How can I assist you with our services or support today?`;
    case 'triage':
      return "Hi! Please tell me what you're looking for, or choose one of the options below to get started.";
    case 'promo':
      return 'Welcome! Ask me about our current special promotions, pricing plans, or start a free trial.';
    default:
      return "Hi there! 👋 I'm here to help with pricing, features, or anything else you need.";
  }
};

const normalizeBoundedInteger = (
  value: unknown,
  fallback: number,
  max: number,
  min = 1,
): number => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numberValue)));
};

type BoundedIntegerInputValue = number | '';

const normalizeBoundedIntegerInput = (
  value: string,
  max: number,
  min = 1,
): BoundedIntegerInputValue => {
  if (value === '') return '';
  return normalizeBoundedInteger(value, min, max, min);
};

const DEFAULT_DETAILS_TO_COLLECT: DetailField[] = ['name', 'phone', 'email'];
const ALWAYS_ASKED_DETAIL_FIELDS = new Set<DetailField>(['name', 'phone']);

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

const getAgentTypeTemplateOptions = (agentTypeData: any): UseCaseTemplateOption[] => {
  const rawApiData = agentTypeData?.data?.result || agentTypeData?.data || agentTypeData || [];
  if (!Array.isArray(rawApiData)) return [];

  return rawApiData
    .map((item: any) => {
      const name = sanitizeAiPlainText(
        item?.label || item?.name || item?.title || item?.value || '',
      ).trim();
      const id = String(item?.value || item?.id || item?.uuid || name).trim();
      const welcomeGreeting = sanitizeAiPlainText(item?.welcome_greeting || '').trim();
      const systemPrompt = sanitizeAiPromptText(item?.systemPrompt || '').trim();
      return name ? { id: id || name, name, welcomeGreeting, systemPrompt } : null;
    })
    .filter(Boolean) as UseCaseTemplateOption[];
};

const ensureAlwaysAskedDetails = (details: DetailField[] = []) => {
  const set = new Set<DetailField>([...ALWAYS_ASKED_DETAIL_FIELDS, ...details]);
  return (['name', 'email', 'phone', 'dob', 'address'] as DetailField[]).filter((field) =>
    set.has(field),
  );
};

const getManagerExtensionRole = (extension: any) =>
  String(
    extension?.custom_role_data?.name ||
      extension?.customRoleData?.name ||
      extension?.role_data?.name ||
      extension?.roleData?.name ||
      extension?.role?.name ||
      extension?.role_name ||
      (typeof extension?.role === 'string' ? extension.role : ''),
  )
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-');

const getManagerExtensionId = (extension: any) =>
  String(
    extension?.uuid || extension?.id || extension?.user_uuid || extension?.userId || '',
  ).trim();

const normalizeLanguageValue = (value: unknown) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  const matched = languageChoices.find(
    (language) => language.value === normalized || language.label.toLowerCase() === normalized,
  );

  return matched?.value || languageChoices[0].value;
};

const isLikelyUrl = (value: string) => {
  if (!value.trim()) return true;

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    return Boolean(url.hostname.includes('.'));
  } catch {
    return false;
  }
};

const getPageTitle = (url: string) => {
  try {
    const parsed = new URL(normalizeUrl(url));
    const pathName = parsed.pathname.replace(/^\/|\/$/g, '').replace(/[-_]/g, ' ');
    return pathName || parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const normalizeUrl = (url: string) => {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};
const createLocalId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createWidgetKey = () =>
  `wgt_${(
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  ).replace(/[^a-zA-Z0-9]/g, '')}`;
const uniqueStrings = (values: string[]) =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
const getSelectedLinksAfterScan = (links: string[], currentSelectedLinks: string[]) => {
  const selectedLinkSet = new Set(
    currentSelectedLinks.map((url) => normalizeUrl(url)).filter(Boolean),
  );
  const matchedLinks = links.filter((link) => selectedLinkSet.has(normalizeUrl(link)));

  return matchedLinks.length ? matchedLinks : links.slice(0, 5);
};
const getKnowledgeReviewSourceKey = (type: 'url' | 'text' | 'pdf', value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (type === 'url' || isLikelyUrl(trimmed)) return `url:${normalizeUrl(trimmed)}`;
  return `${type}:${trimmed}`;
};
const getKnowledgeReviewItemSourceKey = (item: { source?: string }) => {
  const source = String(item?.source || '').trim();
  if (!source) return '';
  return getKnowledgeReviewSourceKey(isLikelyUrl(source) ? 'url' : 'text', source);
};
const getKnowledgeReviewPayloadEntries = (payload: SummarizeKnowledgeBasePayload) => [
  ...(payload.crawl_url ?? []).map((value) => ({ type: 'url' as const, value })),
  ...(payload.url ?? []).map((value) => ({ type: 'url' as const, value })),
  ...(payload.text ?? []).map((value) => ({ type: 'text' as const, value })),
  ...(payload.pdf ?? []).map((value) => ({ type: 'pdf' as const, value })),
];
const buildKnowledgeReviewPayload = (
  entries: Array<{ type: 'url' | 'text' | 'pdf'; value: string }>,
): SummarizeKnowledgeBasePayload => ({
  crawl_url: uniqueStrings(
    entries.filter((entry) => entry.type === 'url').map((entry) => entry.value),
  ),
  url: [],
  text: uniqueStrings(entries.filter((entry) => entry.type === 'text').map((entry) => entry.value)),
  pdf: uniqueStrings(entries.filter((entry) => entry.type === 'pdf').map((entry) => entry.value)),
});
const hasKnowledgeReviewPayloadInput = (payload: SummarizeKnowledgeBasePayload) =>
  Boolean(
    payload.crawl_url?.length || payload.url?.length || payload.text?.length || payload.pdf?.length,
  );
const getUrlPathSegments = (url: string) => {
  try {
    return new URL(normalizeUrl(url)).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
};
const decodeUrlSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};
const formatPickPageCategoryTitle = (segment: string) => {
  const title = decodeUrlSegment(segment)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  if (!title) return 'Main Pages';

  return title.replace(/\b\w/g, (char) => char.toUpperCase());
};
const pickPageKeywordCategories: PickPageKeywordCategory[] = [
  {
    id: 'pricing-plans',
    title: 'Pricing & Plans',
    keywords: [
      'pricing',
      'price',
      'prices',
      'plans',
      'plan',
      'packages',
      'package',
      'billing',
      'rates',
      'cost',
      'subscription',
      'subscriptions',
      'quote',
      'quotes',
    ],
  },
  {
    id: 'features-services',
    title: 'Features & Services',
    keywords: [
      'features',
      'feature',
      'services',
      'service',
      'products',
      'product',
      'solutions',
      'solution',
      'platform',
      'tools',
      'numbers',
      'virtual-numbers',
      'phone-system',
      'voip',
      'pbx',
      'contact-center',
      'call-center',
      'sms',
      'voice',
      'chat',
      'automation',
      'ai',
    ],
  },
  {
    id: 'help-contact',
    title: 'Help & Contact',
    keywords: [
      'help',
      'support',
      'contact',
      'contacts',
      'faq',
      'faqs',
      'knowledge-base',
      'kb',
      'docs',
      'documentation',
      'guide',
      'guides',
      'tutorial',
      'tutorials',
      'resource-center',
    ],
  },
  {
    id: 'company-info',
    title: 'Company Info',
    keywords: [
      'about',
      'about-us',
      'company',
      'team',
      'leadership',
      'careers',
      'career',
      'jobs',
      'partners',
      'partner',
      'customers',
      'customer',
      'case-studies',
      'case-study',
      'testimonials',
      'press',
      'news',
    ],
  },
  {
    id: 'blog',
    title: 'Blog',
    keywords: ['blog', 'blogs', 'article', 'articles', 'post', 'posts'],
  },
  {
    id: 'legal-trust',
    title: 'Legal & Trust',
    keywords: [
      'privacy',
      'terms',
      'terms-of-service',
      'security',
      'compliance',
      'gdpr',
      'hipaa',
      'cookies',
      'cookie-policy',
      'policy',
      'policies',
      'sla',
      'status',
    ],
  },
  {
    id: 'developers-integrations',
    title: 'Developers & Integrations',
    keywords: [
      'api',
      'apis',
      'developer',
      'developers',
      'integrations',
      'integration',
      'webhooks',
      'webhook',
      'sdk',
      'sdks',
      'apps',
      'marketplace',
      'crm',
    ],
  },
  {
    id: 'industries-use-cases',
    title: 'Industries & Use Cases',
    keywords: [
      'industries',
      'industry',
      'use-cases',
      'use-case',
      'customers',
      'real-estate',
      'healthcare',
      'finance',
      'education',
      'retail',
      'travel',
      'agency',
      'enterprise',
    ],
  },
];
const normalizePickPageKeyword = (value: string) =>
  decodeUrlSegment(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const doesPickPageKeywordMatch = (segment: string, keyword: string) =>
  segment === keyword ||
  segment.startsWith(`${keyword}-`) ||
  segment.endsWith(`-${keyword}`) ||
  segment.includes(`-${keyword}-`);
const getPickPageKeywordCategory = (segment: string) => {
  const normalizedSegment = normalizePickPageKeyword(segment);
  if (!normalizedSegment) return null;

  return (
    pickPageKeywordCategories.find((category) =>
      category.keywords.some((keyword) => doesPickPageKeywordMatch(normalizedSegment, keyword)),
    ) || null
  );
};
const formatPickPageCategorySubtitle = (linkCount: number, segment: string) => {
  const pageText = `${linkCount.toLocaleString()} ${linkCount === 1 ? 'page' : 'pages'}`;
  return segment ? `${pageText} under /${decodeUrlSegment(segment)}` : `${pageText} from top level`;
};
const getPickPageRowLabel = (url: string, stripLeadingSegments: number) => {
  const segments = getUrlPathSegments(url);
  const visibleSegments =
    stripLeadingSegments > 0 ? segments.slice(stripLeadingSegments) : segments;
  const labelSegment =
    visibleSegments[visibleSegments.length - 1] || segments[segments.length - 1] || '';

  if (labelSegment) return formatPickPageCategoryTitle(labelSegment);

  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const getPickPageRowPath = (url: string) => {
  try {
    const parsed = new URL(normalizeUrl(url));
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '') || '/';
    const host = parsed.hostname.replace(/^www\./, '');
    return path === '/' ? host : `${host}${path}`;
  } catch {
    return url;
  }
};
const buildPickPageCategories = (links: string[]): PickPageCategory[] => {
  const categoryMap = new Map<string, PickPageCategory>();
  const folderCategorySegments = new Set(
    uniqueStrings(links)
      .map((link) => getUrlPathSegments(link))
      .filter((segments) => segments.length > 1 && segments[0])
      .map((segments) => String(segments[0]).toLowerCase()),
  );

  uniqueStrings(links).forEach((link) => {
    const segments = getUrlPathSegments(link);
    const firstSegment = segments[0] || '';
    const hasFolderCategory = Boolean(
      firstSegment && folderCategorySegments.has(firstSegment.toLowerCase()),
    );
    const categorySegment = segments.length > 1 || hasFolderCategory ? firstSegment : '';
    const keywordCategory = categorySegment ? null : getPickPageKeywordCategory(firstSegment);
    const key =
      keywordCategory?.id || (categorySegment ? categorySegment.toLowerCase() : '__main__');
    const existing = categoryMap.get(key);

    if (existing) {
      existing.links.push(link);
      existing.subtitle = formatPickPageCategorySubtitle(existing.links.length, categorySegment);
      return;
    }

    const title =
      keywordCategory?.title ||
      (categorySegment ? formatPickPageCategoryTitle(categorySegment) : 'Main Pages');
    categoryMap.set(key, {
      id: key,
      title,
      subtitle: formatPickPageCategorySubtitle(1, categorySegment),
      links: [link],
      stripLeadingSegments: categorySegment ? 1 : 0,
    });
  });

  return Array.from(categoryMap.values()).sort((a, b) => {
    if (a.id === '__main__') return -1;
    if (b.id === '__main__') return 1;
    return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  });
};
const getPickPageCategoryIconClassName = (index: number) => {
  const colorClasses = [
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-violet-100 text-violet-700',
    'bg-cyan-100 text-cyan-700',
  ];
  return colorClasses[index % colorClasses.length];
};
const getKnowledgeBaseId = (item: any) => {
  if (item && typeof item === 'object') {
    return String(
      item.ingestionId || item.ingestion_id || item.uuid || item._id || item.id || item.value || '',
    ).trim();
  }
  return String(item || '').trim();
};
const normalizeKnowledgeBaseSelection = (value: unknown): string[] => {
  if (Array.isArray(value)) return uniqueStrings(value.map(getKnowledgeBaseId));
  if (typeof value === 'string') return uniqueStrings(value.split(','));
  if (value && typeof value === 'object') return uniqueStrings([getKnowledgeBaseId(value)]);
  return [];
};
const getKnowledgeBaseSelectionObjects = (value: unknown): any[] => {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
  if (value && typeof value === 'object') return [value];
  return [];
};
const getKnowledgeBaseFallbackLookup = (...values: unknown[]) => {
  const lookup = new Map<string, any>();
  values.flatMap(getKnowledgeBaseSelectionObjects).forEach((item) => {
    const id = getKnowledgeBaseId(item);
    if (id && !lookup.has(id)) lookup.set(id, item);
  });
  return lookup;
};
const getKnowledgeBaseTitle = (item: any, fallbackId: string) =>
  String(
    item?.name || item?.title || item?.label || fallbackId || 'Untitled knowledge base',
  ).trim();
const getKnowledgeBaseDataValues = (item: any): string[] => {
  const values: string[] = [];
  const addValue = (value: unknown, depth = 0) => {
    if (typeof value === 'string') {
      values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((nestedValue) => addValue(nestedValue, depth + 1));
      return;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      [
        'url',
        'urls',
        'link',
        'links',
        'href',
        'source_url',
        'sourceUrl',
        'file',
        'files',
        'file_url',
        'fileUrl',
        'public_url',
        'publicUrl',
        'pdf',
        'pdfs',
        'document',
        'documents',
        'text',
        'plain_text',
        'plainText',
        'content',
        'body',
        'summary',
        'description',
        'copy',
        'source',
        'value',
      ].forEach((key) => addValue(record[key], depth + 1));

      if (depth < 2) {
        ['data', 'payload', 'metadata', 'meta', 'details', 'resource'].forEach((key) =>
          addValue(record[key], depth + 1),
        );
      }
    }
  };

  ['urls', 'url', 'links', 'files', 'file', 'pdf', 'pdfs', 'documents', 'data'].forEach((key) => {
    const rawValue = item?.[key];
    addValue(rawValue);
  });
  [
    'text',
    'plain_text',
    'plainText',
    'url',
    'source_url',
    'sourceUrl',
    'file',
    'file_url',
    'fileUrl',
    'public_url',
    'publicUrl',
    'content',
    'body',
    'summary',
    'description',
    'copy',
    'source',
  ].forEach((key) => {
    if (typeof item?.[key] === 'string') values.push(item[key]);
  });

  return uniqueStrings(values);
};
const getKnowledgeBaseRows = (response: any): any[] => {
  const result =
    response?.data?.data?.result ||
    response?.data?.result ||
    response?.result ||
    response?.data?.data;

  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  if (Array.isArray(response?.data?.data?.rows)) return response.data.data.rows;
  return [];
};
const getAgentListRows = (response: any): any[] => {
  const result =
    response?.data?.data?.result ||
    response?.data?.result ||
    response?.result ||
    response?.data?.data;

  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
};
const getKnowledgeBaseSourceLabel = (item: any, type: string) => {
  const firstValue = getKnowledgeBaseDataValues(item)[0];
  if (firstValue) return firstValue;
  if (type === 'text') return 'Saved text knowledge base';
  if (type === 'url') return 'Saved URL knowledge base';
  if (type === 'pdf') return 'Saved PDF knowledge base';
  return 'Saved knowledge base';
};
const getKnowledgeBaseSourceType = (item: any): KnowledgeBaseSourceType => {
  const type = String(item?.type || item?.sourceType || item?.source_type || '').toLowerCase();
  if (type === 'pdf' || type.includes('pdf')) return 'pdf';
  if (type === 'text' || type.includes('text') || type.includes('custom')) return 'text';
  if (type === 'url' || type.includes('url') || type.includes('link')) return 'url';
  if (Array.isArray(item?.files) && item.files.length > 0) return 'pdf';
  if (item?.text || item?.plain_text || item?.plainText) return 'text';
  return 'url';
};
const getKnowledgeBaseTypeLabel = (type: string) => {
  if (type === 'text') return 'Existing text';
  if (type === 'url') return 'Existing URL';
  if (type === 'pdf') return 'Existing document';
  return 'Existing knowledge';
};
const getStoredKnowledgeBaseDocuments = (item: any): KnowledgeDocument[] => {
  const documents =
    item?.documents || item?.knowledgeDocuments || item?.knowledge_documents || item?.summaries;
  const normalizedDocuments = normalizeStoredKnowledgeDocuments(documents);
  if (normalizedDocuments.length) return normalizedDocuments;

  const summary = String(item?.summary || item?.summaryText || item?.summary_text || '').trim();
  if (!summary) return [];

  return normalizeStoredKnowledgeDocuments([
    {
      id: getKnowledgeBaseId(item) || 'saved-summary',
      title: getKnowledgeBaseTitle(item, 'Saved knowledge base'),
      copy: summary,
      source: getKnowledgeBaseSourceLabel(item, getKnowledgeBaseSourceType(item)),
      status: 'Attached',
      type: getKnowledgeBaseSourceType(item),
    },
  ]);
};
const getStoredKnowledgeBaseFaqs = (item: any): KnowledgeFaq[] => {
  const faqs = item?.faqs || item?.faq || item?.knowledgeFaqs || item?.knowledge_faqs;
  return normalizeStoredKnowledgeFaqs(Array.isArray(faqs) ? faqs : faqs ? [faqs] : []);
};
const getCreatedAgentId = (agent: any) =>
  String(
    agent?.agent_uuid || agent?.agentId || agent?.id || agent?.uuid || agent?._id || '',
  ).trim();
const getCreatedAgentName = (agent: any) =>
  String(agent?.agentName || agent?.name || 'Untitled agent').trim();
const getRelativeUpdatedLabel = (value: unknown) => {
  const time = new Date(String(value || '')).getTime();
  if (!Number.isFinite(time)) return 'updated recently';

  const diffMs = Date.now() - time;
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < hourMs) return 'updated within the hour';
  if (diffMs < dayMs) return `updated ${Math.max(1, Math.round(diffMs / hourMs))}h ago`;
  return `updated ${Math.max(1, Math.round(diffMs / dayMs))}d ago`;
};
const buildReusableKnowledgeAgent = (
  agent: any,
  channel: 'chat' | 'voice',
): ReusableKnowledgeAgent | null => {
  const id = getCreatedAgentId(agent);
  if (!id) return null;

  const forwardActions = agent?.forward_call_actions || agent?.forwardCallActions || {};
  const builder =
    channel === 'chat' ? forwardActions?.chatbot_builder : forwardActions?.receptionist_builder;
  const knowledgeState = channel === 'chat' ? builder : builder?.knowledge;
  const generated = channel === 'chat' ? builder?.generated : builder?.knowledge?.generated;
  const generatedTextId = String(
    channel === 'chat'
      ? generated?.faqKnowledgeBaseId || ''
      : generated?.generatedKnowledgeBaseId || '',
  ).trim();
  const selectedKnowledgeBase =
    knowledgeState?.sources?.selectedKnowledgeBase || knowledgeState?.selectedKnowledgeBase || {};
  const documents = normalizeStoredKnowledgeDocuments(generated?.documents);
  const summaryText = String(generated?.summaryText || generated?.summary || '').trim();
  const finalDocuments = documents.length
    ? documents
    : normalizeStoredKnowledgeDocuments(
        summaryText
          ? [
              {
                id: `${id}-summary`,
                title: 'Knowledge base summary',
                copy: summaryText,
                source: getCreatedAgentName(agent),
                status: 'Attached',
                type: 'text',
              },
            ]
          : [],
      );
  const faqs = normalizeStoredKnowledgeFaqs(generated?.faqs);
  const textIds = uniqueStrings([
    generatedTextId,
    ...normalizeKnowledgeBaseSelection(selectedKnowledgeBase?.text),
  ]);
  const urlIds = normalizeKnowledgeBaseSelection(selectedKnowledgeBase?.url);
  const pdfIds = normalizeKnowledgeBaseSelection(selectedKnowledgeBase?.pdf);
  const companyName = String(
    agent?.companyName || agent?.company_name || agent?.company || '',
  ).trim();
  const meta = [
    companyName,
    `${finalDocuments.length} docs`,
    `${faqs.length} FAQs`,
    getRelativeUpdatedLabel(
      agent?.updatedAt || agent?.updated_at || agent?.createdAt || agent?.created_at,
    ),
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    id: `${channel}-${id}`,
    channel,
    name: getCreatedAgentName(agent),
    meta,
    documents: finalDocuments,
    faqs,
    textIds,
    urlIds,
    pdfIds,
  };
};
const getMatchedKnowledgeBaseItems = (
  ids: string[],
  type: 'text' | 'url' | 'pdf',
  kbData: any[],
  fallbackLookup?: Map<string, any>,
) =>
  ids.map((id) => {
    const item =
      kbData.find((kbItem: any) => getKnowledgeBaseId(kbItem) === id) || fallbackLookup?.get(id);
    return { id, type, item };
  });
const createEmptyKnowledgeFaq = (): KnowledgeFaq => ({
  id: createLocalId('faq'),
  question: '',
  answer: '',
  source: 'Manual',
});
const normalizeStoredKnowledgeFaqs = (value: any): KnowledgeFaq[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value
    .map((item: any) => ({
      id: String(item?.id || createLocalId('faq')),
      question: String(item?.question || '').trim(),
      answer: String(item?.answer || '').trim(),
      source: String(item?.source || 'Generated').trim(),
    }))
    .filter((item) => {
      if (!item.question && !item.answer) return false;
      const key = [item.question, item.answer, item.source].join('|').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};
const normalizeStoredKnowledgeDocuments = (value: any): KnowledgeDocument[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value
    .map((item: any, index: number) => ({
      id: String(item?.id || item?.uuid || item?.url || item?.source || `document-${index}`),
      title: String(
        item?.title || item?.name || item?.url || item?.source || `Document ${index + 1}`,
      ).trim(),
      copy: String(item?.copy || item?.summary || item?.description || item?.content || '').trim(),
      source: String(item?.source || item?.url || item?.fileName || item?.file_name || '').trim(),
      status: String(item?.status || 'Just generated').trim(),
      type: String(item?.type || '').trim(),
    }))
    .filter((item) => {
      if (!item.title && !item.copy && !item.source) return false;
      const key = [item.title, item.source, item.copy].join('|').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};
const getKnowledgeBaseFaqResponseItems = (response: any): KnowledgeFaq[] => {
  const faqs =
    response?.data?.data?.faqs ||
    response?.data?.faqs ||
    response?.data?.data?.result?.faqs ||
    response?.data?.result?.faqs ||
    [];

  return normalizeStoredKnowledgeFaqs(faqs);
};
const getKnowledgeBaseSummaryResponseItems = (response: any): KnowledgeDocument[] => {
  const result = response?.data?.data || response?.data || response || {};
  const documents = Array.isArray(result?.documents) ? result.documents : [];

  if (documents.length) {
    return normalizeStoredKnowledgeDocuments(documents);
  }

  const summaries = result?.summaries || {};
  const rows: any[] = [];
  const crawlSummary = String(summaries?.crawl_url?.summary || '').trim();
  const crawlUrls = Array.isArray(summaries?.crawl_url?.urls) ? summaries.crawl_url.urls : [];

  if (crawlSummary) {
    rows.push({
      id: 'crawl-summary',
      title: 'Website crawl summary',
      copy: crawlSummary,
      source: crawlUrls.join(', '),
      status: 'Just generated',
      type: 'url',
    });
  }

  if (Array.isArray(summaries?.url)) {
    summaries.url.forEach((item: any, index: number) => {
      rows.push({
        id: `url-summary-${index}`,
        title: item?.title || getPageTitle(String(item?.url || item?.source || '')),
        copy: item?.summary,
        source: item?.url || item?.source,
        status: 'Just generated',
        type: 'url',
      });
    });
  }

  if (Array.isArray(summaries?.text)) {
    summaries.text.forEach((item: any, index: number) => {
      rows.push({
        id: `text-summary-${index}`,
        title: item?.title || item?.source || `Custom content ${index + 1}`,
        copy: item?.summary,
        source: item?.source || 'Pasted text',
        status: 'Just generated',
        type: 'text',
      });
    });
  }

  if (Array.isArray(summaries?.pdf)) {
    summaries.pdf.forEach((item: any, index: number) => {
      rows.push({
        id: `pdf-summary-${index}`,
        title: item?.title || item?.source || `PDF ${index + 1}`,
        copy: item?.summary,
        source: item?.source || 'PDF upload',
        status: 'Just generated',
        type: 'pdf',
      });
    });
  }

  return normalizeStoredKnowledgeDocuments(rows);
};
const getKnowledgeReviewJobId = (response: any) =>
  String(response?.data?.data?.jobId || response?.data?.jobId || response?.jobId || '').trim();
const getKnowledgeReviewJobStatus = (response: any) =>
  String(response?.data?.data?.status || response?.data?.status || response?.status || '').trim();
const getValidKnowledgeFaqs = (items: KnowledgeFaq[]) =>
  items.filter((item) => item.question.trim() && item.answer.trim());
const formatKnowledgeFaqText = (items: KnowledgeFaq[]) =>
  getValidKnowledgeFaqs(items)
    .map((item) =>
      [
        'FAQ priority knowledge. Use this first when the user question directly matches this FAQ.',
        `Q: ${item.question.trim()}`,
        `A: ${item.answer.trim()}`,
        item.source.trim() ? `Source: ${item.source.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
const formatKnowledgeSummaryText = (items: KnowledgeDocument[]) =>
  items
    .map((item) =>
      [
        'Summary fallback knowledge. Use this when no FAQ answer directly matches.',
        item.title.trim() ? `Title: ${item.title.trim()}` : '',
        item.copy.trim() ? `Summary: ${item.copy.trim()}` : '',
        item.source.trim() ? `Source: ${item.source.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n');
const formatGeneratedKnowledgeText = (faqs: KnowledgeFaq[], documents: KnowledgeDocument[]) => {
  const faqText = formatKnowledgeFaqText(faqs);
  const summaryText = formatKnowledgeSummaryText(documents);

  return [
    faqText ? `[FAQ Knowledge]\n${faqText}` : '',
    summaryText ? `[Summary Knowledge]\n${summaryText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();
};
const isSameGeneratedKnowledgeText = (left: string, right: string) =>
  left.replace(/\s+/g, ' ').trim() === right.replace(/\s+/g, ' ').trim();
const getIngestionIdFromResponse = (response: any) =>
  String(response?.data?.ingestionId || response?.data?.data?.ingestionId || '').trim();
const formatAgentDomain = (agent: any, websiteUrl: string) => {
  const rawUrl =
    websiteUrl || agent?.websiteUrl || agent?.website_url || agent?.domain || agent?.site_url || '';
  if (!rawUrl) return '';

  try {
    return new URL(normalizeUrl(rawUrl)).hostname.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
};
const getAgentResultFromResponse = (response: any) => {
  const candidates = [
    response?.data?.data?.result?.agent,
    response?.data?.data?.result?.data,
    response?.data?.data?.result,
    response?.data?.result,
    response?.data?.data,
    response?.data,
  ];

  return (
    candidates.find(
      (candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate),
    ) || {}
  );
};
const normalizeSourceStage = (value: unknown, fallback: SourceStage): SourceStage => {
  const numericValue = Number(value);
  return numericValue === 1 || numericValue === 2 || numericValue === 3 ? numericValue : fallback;
};

function CreateChatbotAgent() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { rowData = {}, agentData = null, readOnly = false } = (location.state || {}) as any;
  const initialData = rowData?.formData || agentData || {};
  const isEdit = Boolean(initialData?.id || initialData?.agent_uuid || rowData?.isEdit);
  const isReadOnly = Boolean(readOnly || rowData?.readOnly || rowData?.mode === 'view');
  const useWizardEdit = Boolean(rowData?.useWizard || rowData?.mode === 'configure');
  const requestedInitialTab = rowData?.initialTab;
  const forwardCallActions =
    initialData?.forward_call_actions || initialData?.forwardCallActions || {};
  const builderState = forwardCallActions?.chatbot_builder || {};
  const draftInitialEditTab: EditAgentTab = 'overview';
  const initialEditTab: EditAgentTab = isEditAgentTab(requestedInitialTab)
    ? requestedInitialTab
    : draftInitialEditTab;
  const storedKnowledgeDocuments = useMemo(
    () => normalizeStoredKnowledgeDocuments(builderState?.generated?.documents),
    [builderState?.generated?.documents],
  );
  const storedKnowledgeFaqs = useMemo(
    () => normalizeStoredKnowledgeFaqs(builderState?.generated?.faqs),
    [builderState?.generated?.faqs],
  );
  const storedFaqText = useMemo(
    () =>
      String(
        builderState?.generated?.generatedKnowledgeText ||
          builderState?.generated?.faqText ||
          formatGeneratedKnowledgeText(storedKnowledgeFaqs, storedKnowledgeDocuments),
      ).trim(),
    [
      builderState?.generated?.faqText,
      builderState?.generated?.generatedKnowledgeText,
      storedKnowledgeDocuments,
      storedKnowledgeFaqs,
    ],
  );
  const storedFaqKnowledgeBaseId = String(builderState?.generated?.faqKnowledgeBaseId || '').trim();
  const storedFaqSourceKey = String(builderState?.generated?.faqSourceKey || '').trim();
  const storedDocumentSourceKey = String(builderState?.generated?.documentSourceKey || '').trim();

  const formattedOperationalHours = useMemo(() => {
    const rawHours = forwardCallActions?.condition?.operational_hours;
    if (!rawHours) return OPERATIONAL_HOURS;
    const action = rawHours.closed_hour_action || {};
    return {
      ...rawHours,
      closed_hour_action: {
        enabled: action.enabled ?? false,
        personal: action.personal ?? true,
        type:
          typeof action.type === 'object'
            ? action.type
            : { value: action.type || '', label: action.type_label || action.type || '' },
        value:
          typeof action.value === 'object'
            ? action.value
            : { value: action.value || '', label: action.value_label || action.value || '' },
      },
    };
  }, [forwardCallActions]);

  const formInstance = useForm({
    defaultValues: {
      settings: {
        operational_hours: formattedOperationalHours,
      },
    },
    mode: 'onChange',
  });

  const operationalHours = formInstance.watch('settings.operational_hours');
  const [selectedLocationId, setSelectedLocationId] = useState(
    String(initialData?.site_uuid || builderState?.brain?.site_uuid || ''),
  );
  const { data: sites = [], isLoading: isLoadingSites } = useQuery({
    queryKey: ['siteList', 'ai-chatbot-v2'],
    queryFn: () => siteList({ page: 1, limit: 1000 }),
    select: (data: any) => data?.data?.data?.result?.rows || [],
  });
  const selectedLocation = useMemo(
    () => sites.find((site: any) => getAgentSiteId(site) === selectedLocationId),
    [selectedLocationId, sites],
  );

  useEffect(() => {
    if (!sites.length) return;
    const hasSelectedSite = sites.some((site: any) => getAgentSiteId(site) === selectedLocationId);
    if (hasSelectedSite) return;
    setSelectedLocationId(getPreferredAgentSiteId(sites));
  }, [selectedLocationId, sites]);

  useEffect(() => {
    if (!selectedLocation) return;
    const regionalFieldName = 'settings.operational_hours.regional' as const;
    formInstance.setValue(
      regionalFieldName,
      getAgentSiteRegionalSettings(selectedLocation, formInstance.getValues(regionalFieldName)),
      {
        shouldDirty: false,
        shouldValidate: true,
      },
    );
  }, [formInstance, selectedLocation]);

  const initialAgentName = sanitizeAgentName(
    String(
      initialData?.agentName ||
        initialData?.name ||
        builderState?.brain?.botName ||
        initialData?.initialTemplateName ||
        '',
    ),
  );
  const initialFirstMessage = sanitizeAiPlainText(
    initialData?.firstMessage ||
      initialData?.first_message ||
      builderState?.brain?.welcomeMessage ||
      '',
  );
  const initialSystemPrompt = sanitizeAiPromptText(
    initialData?.systemPrompt ||
      initialData?.system_prompt ||
      builderState?.brain?.systemPrompt ||
      '',
  );
  const initialTone = builderState?.brain?.tone || initialData?.tone || 'Friendly';
  const initialWebsiteUrl =
    builderState?.sources?.websiteUrl || initialData?.websiteUrl || initialData?.website_url || '';
  const initialExtraUrl = builderState?.sources?.extraUrl || '';
  const initialTextKnowledgeValue =
    builderState?.sources?.selectedKnowledgeBase?.text || initialData?.text_uuid;
  const initialUrlKnowledgeValue =
    builderState?.sources?.selectedKnowledgeBase?.url || initialData?.url_uuid;
  const initialPdfKnowledgeValue =
    builderState?.sources?.selectedKnowledgeBase?.pdf || initialData?.pdf_uuid;
  const initialTextKnowledgeIds = normalizeKnowledgeBaseSelection(initialTextKnowledgeValue).filter(
    (id) => id !== storedFaqKnowledgeBaseId,
  );
  const initialUrlKnowledgeIds = normalizeKnowledgeBaseSelection(initialUrlKnowledgeValue);
  const initialPdfKnowledgeIds = normalizeKnowledgeBaseSelection(initialPdfKnowledgeValue);
  const existingKnowledgeBaseFallbackItems = useMemo(
    () =>
      getKnowledgeBaseFallbackLookup(
        initialTextKnowledgeValue,
        initialUrlKnowledgeValue,
        initialPdfKnowledgeValue,
      ),
    [initialPdfKnowledgeValue, initialTextKnowledgeValue, initialUrlKnowledgeValue],
  );
  const savedSelectedPages = Array.isArray(builderState?.sources?.selectedPages)
    ? builderState.sources.selectedPages
    : [];
  const initialSelectedPages = [
    ...savedSelectedPages.map((item: any) => item?.url || item?.path),
    ...(Array.isArray(initialData?.selectedLinks) ? initialData.selectedLinks : []),
  ].filter(Boolean);
  const initialEditableSelectedPages = initialUrlKnowledgeIds.length ? [] : initialSelectedPages;
  const savedPendingUrls = Array.isArray(builderState?.sources?.pendingUrls)
    ? builderState.sources.pendingUrls
    : [];
  const initialEditablePendingUrls = initialUrlKnowledgeIds.length ? [] : savedPendingUrls;
  const initialDetails = useMemo(() => {
    const rawDetails =
      forwardCallActions?.data_agent?.details_to_collect || forwardCallActions?.detailsToCollect;
    if (!rawDetails) return DEFAULT_DETAILS_TO_COLLECT;
    if (Array.isArray(rawDetails)) return rawDetails;
    if (typeof rawDetails === 'object') {
      return Object.keys(rawDetails) as DetailField[];
    }
    return DEFAULT_DETAILS_TO_COLLECT;
  }, [forwardCallActions]);
  const normalizedInitialSourceStage = normalizeSourceStage(
    builderState?.sourceStage,
    isEdit ? 3 : 1,
  );
  const [activeStep, setActiveStep] = useState(
    isWizardEditAgentTab(initialEditTab) ? editTabToStep[initialEditTab] : 1,
  );
  const [editTab, setEditTab] = useState<EditAgentTab>(initialEditTab);
  const [sourceStage, setSourceStage] = useState<SourceStage>(
    initialEditTab === 'review' ? 3 : normalizedInitialSourceStage,
  );
  const [tone] = useState(initialTone);
  const [botName, setBotName] = useState(initialAgentName);
  const [companyBrand, setCompanyBrand] = useState(
    sanitizeAiPlainText(
      builderState?.brain?.companyBrand ||
        initialData?.companyBrand ||
        initialData?.company_name ||
        initialData?.company ||
        '',
    ),
  );

  const [selectedManagerId, setSelectedManagerId] = useState<string>(() => {
    const manager = forwardCallActions?.manager;
    if (manager && typeof manager === 'object') {
      return String(manager.id || manager.manager_id || manager.uuid || '');
    }
    return String(manager || '');
  });
  const [managerSearch, setManagerSearch] = useState('');
  const [enableCallbackScheduling, setEnableCallbackScheduling] = useState<boolean>(() => {
    return Boolean(
      forwardCallActions?.enableCallbackScheduling ??
      forwardCallActions?.enable_callback_scheduling ??
      true,
    );
  });
  const [isBusinessHoursModalOpen, setIsBusinessHoursModalOpen] = useState(false);
  const [bussinessHourError, setBussinessHourError] = useState<string | null>(null);

  const forwardCall = forwardCallActions?.call_handling?.business_hours || {};
  const [selectedQueueId, setSelectedQueueId] = useState<string>(() => {
    return forwardCall?.value?.value || forwardCall?.value || '';
  });
  const [selectedQueueLabel, setSelectedQueueLabel] = useState<string>(() => {
    return forwardCall?.label || forwardCall?.value?.label || '';
  });
  const [enableHumanHandoff, setEnableHumanHandoff] = useState<boolean>(() =>
    Boolean(
      forwardCallActions?.enableHumanHandoff ?? forwardCallActions?.enable_human_handoff ?? true,
    ),
  );
  const [roleUseCase, setRoleUseCase] = useState(
    sanitizeAiPlainText(
      builderState?.brain?.roleUseCase ||
        initialData?.roleUseCase ||
        initialData?.role ||
        initialData?.initialTemplateName ||
        '',
    ),
  );
  const [selectedLanguage, setSelectedLanguage] = useState(
    normalizeLanguageValue(initialData?.language || builderState?.brain?.language),
  );
  const [welcomeMessage, setWelcomeMessage] = useState(
    initialFirstMessage || 'Hi! How can I help you today?',
  );
  const [selectedGreetingType, setSelectedGreetingType] = useState<string>(() => {
    const savedType = builderState?.brain?.greetingType || forwardCallActions?.greetingType;
    if (savedType) return savedType;
    const brand =
      builderState?.brain?.companyBrand ||
      initialData?.companyBrand ||
      initialData?.company ||
      'Example Business';
    const msg = initialFirstMessage || 'Hi! How can I help you today?';
    if (msg === getGreetingText('friendly', brand)) return 'friendly';
    if (msg === getGreetingText('professional', brand)) return 'professional';
    if (msg === getGreetingText('triage', brand)) return 'triage';
    if (msg === getGreetingText('promo', brand)) return 'promo';
    return 'custom';
  });
  const [customGreetings] = useState<string[]>(() => {
    const saved = builderState?.brain?.customGreetings || forwardCallActions?.customGreetings;
    return Array.isArray(saved) ? saved.map((value) => sanitizeAiPlainText(value)) : [];
  });

  const handleSelectGreetingType = (type: string) => {
    const brand = companyBrand || 'Example Business';
    const text = getGreetingText(type, brand);
    setWelcomeMessage(text);
    setSelectedGreetingType(type);
    setStepErrors((prev) => ({ ...prev, welcomeMessage: '' }));
  };

  // const handleSaveAsCustomGreeting = () => {
  //   const currentText = welcomeMessage.trim();
  //   if (!currentText) return;
  //   if (customGreetings.includes(currentText)) {
  //     setSelectedGreetingType('custom');
  //     return;
  //   }
  //   setCustomGreetings((prev) => [...prev, currentText]);
  //   setSelectedGreetingType('custom');
  //   handleAlert({ text: 'Greeting saved to Custom templates!', type: 'success' });
  // };

  const [systemPrompt, setSystemPrompt] = useState(
    initialSystemPrompt || 'You are [bot name], the assistant for [company]. You help with...',
  );
  const widgetKeyRef = useRef(getAi360WidgetKey(initialData) || (!isEdit ? createWidgetKey() : ''));
  const [widgetColors] = useState(() => getChatWidgetColors(initialData));
  const [knowledgeWebsiteMode, setKnowledgeWebsiteMode] = useState<'picker' | 'scan'>(() =>
    initialWebsiteUrl || initialEditableSelectedPages.length ? 'scan' : 'picker',
  );
  const [knowledgeBaseSearch, setKnowledgeBaseSearch] = useState('');
  const [selectedReusableAgentId, setSelectedReusableAgentId] = useState('');
  const [scanWebsiteUrl, setScanWebsiteUrl] = useState(initialWebsiteUrl);
  const [extraUrl, setExtraUrl] = useState(initialExtraUrl);
  const [discoveredLinks, setDiscoveredLinks] = useState<string[]>(initialEditableSelectedPages);
  const [selectedLinks, setSelectedLinks] = useState<string[]>(initialEditableSelectedPages);
  const [websiteScanProgressStatus, setWebsiteScanProgressStatus] =
    useState<WebsiteScanProgressStatus>('idle');
  const websiteScanProgressCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allowWizardExitRef = useRef(false);
  const knowledgeReviewRequestKeyRef = useRef('');
  const knowledgeReviewJobIdRef = useRef('');
  const knowledgeReviewSessionIdRef = useRef(createLocalId('knowledge-review'));
  const knowledgeReviewJobIdsRef = useRef<Set<string>>(new Set());
  const knowledgeReviewPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFileInputRef = useRef<HTMLInputElement | null>(null);
  const reviewKnowledgeFileInputRef = useRef<HTMLInputElement | null>(null);
  const [customContentTitle, setCustomContentTitle] = useState('Custom Content');
  const [customContent, setCustomContent] = useState(
    initialData?.customContent || builderState?.sources?.customContent || '',
  );
  const customContentWordCount = customContent.trim()
    ? customContent.trim().split(/\s+/).length
    : 0;
  const [pendingUrls, setPendingUrls] = useState<string[]>(() =>
    uniqueStrings(initialEditablePendingUrls.map((url: string) => normalizeUrl(String(url)))),
  );
  const [pendingTextItems, setPendingTextItems] = useState<PendingTextKnowledge[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFileKnowledge[]>([]);
  const [selectedTextKnowledgeIds, setSelectedTextKnowledgeIds] =
    useState<string[]>(initialTextKnowledgeIds);
  const [selectedUrlKnowledgeIds, setSelectedUrlKnowledgeIds] =
    useState<string[]>(initialUrlKnowledgeIds);
  const [selectedPdfKnowledgeIds, setSelectedPdfKnowledgeIds] =
    useState<string[]>(initialPdfKnowledgeIds);
  const [isCreatingKnowledgeSources, setIsCreatingKnowledgeSources] = useState(false);
  const [isSummarizingKnowledgeBase, setIsSummarizingKnowledgeBase] = useState(false);
  const [knowledgeSummaryError, setKnowledgeSummaryError] = useState('');
  const [knowledgeDocumentSummaries, setKnowledgeDocumentSummaries] = useState<KnowledgeDocument[]>(
    () => storedKnowledgeDocuments,
  );
  const [isGeneratingKnowledgeFaqs, setIsGeneratingKnowledgeFaqs] = useState(false);
  const [knowledgeFaqError, setKnowledgeFaqError] = useState('');
  const [knowledgeFaqs, setKnowledgeFaqs] = useState<KnowledgeFaq[]>(() => storedKnowledgeFaqs);
  const [reviewKnowledgeTab, setReviewKnowledgeTab] = useState<'documents' | 'faqs'>('documents');
  const [reviewKnowledgeSearch, setReviewKnowledgeSearch] = useState('');
  const [openReviewKnowledgeMenu, setOpenReviewKnowledgeMenu] = useState('');
  const [showLeaveWizardModal, setShowLeaveWizardModal] = useState(false);
  const pendingWizardLeavePathRef = useRef('/admin-settings/knowledge/ai-agent');
  const shouldConfirmWizardLeave = !isEdit && !isReadOnly;
  const wizardLeaveBlocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!shouldConfirmWizardLeave || allowWizardExitRef.current) return false;
    if (currentLocation.pathname !== '/admin-settings/knowledge/create-agent') return false;
    return nextLocation.pathname !== currentLocation.pathname;
  });

  useEffect(() => {
    if (wizardLeaveBlocker.state === 'blocked') {
      setShowLeaveWizardModal(true);
    }
  }, [wizardLeaveBlocker.state]);

  const requestWizardLeave = (path = '/admin-settings/knowledge/ai-agent') => {
    if (!shouldConfirmWizardLeave) {
      navigate(path);
      return;
    }
    pendingWizardLeavePathRef.current = path;
    setShowLeaveWizardModal(true);
  };

  const cancelWizardLeave = () => {
    setShowLeaveWizardModal(false);
    if (wizardLeaveBlocker.state === 'blocked') {
      wizardLeaveBlocker.reset();
    }
  };

  const cleanupKnowledgeReviewWorkspace = async () => {
    const jobIds = Array.from(knowledgeReviewJobIdsRef.current);
    if (!jobIds.length) return;

    knowledgeReviewJobIdsRef.current.clear();
    try {
      await cleanupKnowledgeBaseReviewJobs(jobIds);
    } catch (error) {
      console.error('Cannot cleanup knowledge review jobs:', error);
    }
  };

  const confirmWizardLeave = async () => {
    await cleanupKnowledgeReviewWorkspace();
    allowWizardExitRef.current = true;
    setShowLeaveWizardModal(false);

    if (wizardLeaveBlocker.state === 'blocked') {
      wizardLeaveBlocker.proceed();
      return;
    }

    navigate(pendingWizardLeavePathRef.current);
  };
  const [reviewKnowledgeEditModal, setReviewKnowledgeEditModal] =
    useState<ReviewKnowledgeEditModalState | null>(null);
  const [reviewKnowledgeAddModal, setReviewKnowledgeAddModal] =
    useState<ReviewKnowledgeAddModalState | null>(null);
  const [reviewKnowledgeSourceModal, setReviewKnowledgeSourceModal] =
    useState<ReviewKnowledgeSourceModalState | null>(null);
  const isKnowledgeSummaryNavigationLocked =
    isGeneratingKnowledgeFaqs || isSummarizingKnowledgeBase;

  const [isDataCollectionEnabled, setIsDataCollectionEnabled] = useState<boolean>(() => {
    if (typeof forwardCallActions?.data_agent?.data_collection === 'boolean') {
      return forwardCallActions.data_agent.data_collection;
    }
    const details = forwardCallActions?.data_agent?.details_to_collect;
    if (details === undefined) {
      return builderState?.advanced?.isDataCollectionEnabled ?? true;
    }
    if (Array.isArray(details)) {
      return details.length > 0;
    }
    if (typeof details === 'object' && details !== null) {
      return Object.keys(details).length > 0;
    }
    return true;
  });
  const [detailsToCollect, setDetailsToCollect] = useState<DetailField[]>(() => {
    const details = initialDetails || builderState?.advanced?.detailsToCollect;
    return ensureAlwaysAskedDetails(Array.isArray(details) ? details : DEFAULT_DETAILS_TO_COLLECT);
  });
  const [detailsMandatory, setDetailsMandatory] = useState<
    Record<DetailField, 'mandatory' | 'optional'>
  >(() => {
    const saved =
      forwardCallActions?.data_agent?.details_mandatory ||
      (typeof forwardCallActions?.data_agent?.details_to_collect === 'object' &&
      !Array.isArray(forwardCallActions?.data_agent?.details_to_collect)
        ? forwardCallActions.data_agent.details_to_collect
        : null) ||
      builderState?.advanced?.detailsMandatory ||
      {};
    return {
      name: (saved.name as 'mandatory' | 'optional') || 'mandatory',
      email: (saved.email as 'mandatory' | 'optional') || 'mandatory',
      phone: 'mandatory',
      dob: (saved.dob as 'mandatory' | 'optional') || 'optional',
      address: (saved.address as 'mandatory' | 'optional') || 'optional',
    };
  });
  const [enableCallMonitoring, setEnableCallMonitoring] = useState<boolean>(() => {
    const savedValue =
      forwardCallActions?.ai_call_monitoring ??
      forwardCallActions?.data_agent?.crm_sync ??
      forwardCallActions?.data_agent?.crm_push_enabled ??
      true;
    return isDataCollectionEnabled ? Boolean(savedValue) : false;
  });
  const [selectedCrmPipeline, setSelectedCrmPipeline] = useState<string>(() => {
    return normalizeCrmValue(
      forwardCallActions?.data_agent?.crm ||
        forwardCallActions?.data_agent?.crm_pipeline ||
        builderState?.advanced?.selectedCrmPipeline ||
        '',
    );
  });

  const { data: connectedCrmOptions = [], isFetching: isFetchingConnectedCrms } = useQuery({
    queryKey: ['CRMIsConnected', 'chat-agent-builder'],
    queryFn: () => CRMIsConnected(),
    enabled: isDataCollectionEnabled && enableCallMonitoring,
    select: getConnectedCrmOptions,
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    if (!isDataCollectionEnabled && enableCallMonitoring) {
      setEnableCallMonitoring(false);
    }
  }, [enableCallMonitoring, isDataCollectionEnabled]);

  useEffect(() => {
    if (!isDataCollectionEnabled || !enableCallMonitoring || isFetchingConnectedCrms) return;
    if (!selectedCrmPipeline && connectedCrmOptions.length > 0) {
      setSelectedCrmPipeline(connectedCrmOptions[0].value);
      return;
    }
    if (
      selectedCrmPipeline &&
      !connectedCrmOptions.some((option) => option.value === selectedCrmPipeline)
    ) {
      setSelectedCrmPipeline('');
    }
  }, [
    connectedCrmOptions,
    enableCallMonitoring,
    isDataCollectionEnabled,
    isFetchingConnectedCrms,
    selectedCrmPipeline,
  ]);

  const toggleSingleDetail = (field: DetailField, checked: boolean) => {
    if (isReadOnly) return;

    if (ALWAYS_ASKED_DETAIL_FIELDS.has(field)) {
      setDetailsToCollect((prev) => ensureAlwaysAskedDetails(prev));
      return;
    }
    setDetailsToCollect((prev) => {
      const next = checked ? [...prev, field] : prev.filter((item) => item !== field);
      return ensureAlwaysAskedDetails(next);
    });
  };
  const temperature = DEFAULT_TEMPERATURE;
  const [maxSessionDuration, setMaxSessionDuration] = useState<BoundedIntegerInputValue>(() =>
    normalizeBoundedInteger(
      builderState?.advanced?.maxSessionDuration ??
        forwardCallActions?.maxSessionDuration ??
        forwardCallActions?.max_session_duration,
      300,
      MAX_DURATION_SECONDS,
    ),
  );
  const [idleReminder, setIdleReminder] = useState<BoundedIntegerInputValue>(() =>
    normalizeBoundedInteger(
      builderState?.advanced?.idleReminder ??
        forwardCallActions?.idleReminder ??
        forwardCallActions?.idle_reminder,
      60,
      MAX_DURATION_SECONDS,
    ),
  );
  const [idleReminderRetry, setIdleReminderRetry] = useState<BoundedIntegerInputValue>(() =>
    normalizeBoundedInteger(
      builderState?.advanced?.idleReminderRetry ??
        forwardCallActions?.idleReminderRetry ??
        forwardCallActions?.idle_reminder_retry,
      3,
      MAX_IDLE_REMINDER_RETRIES,
    ),
  );
  const [stepErrors, setStepErrors] = useState<StepErrors>({});

  const { data: extensionList = [] } = useGetExtensions({
    page: 1,
    limit: 9999,
    filters: [],
    search: '',
  });
  const debouncedManagerSearch = useDebounce(managerSearch, 300);
  const {
    users: managerUserList,
    fetchNextPage: fetchNextManagerPage,
    hasNextPage: hasNextManagerPage = false,
    isFetchingNextPage: isFetchingNextManagerPage,
    isLoading: isLoadingManagerUsers,
  } = usePaginatedUsers({
    search: debouncedManagerSearch,
    queryKey: ['chatAgentManagerUsers'],
    params: { role: ['MANAGER', 'SUB-ADMIN', 'ADMIN'] },
  });

  const { data: queueList = [] } = useGetQueueList({ displayType: 'dropdown' });

  const queueOptions = useMemo(() => {
    return queueList.map((q: any) => ({
      label: q.name || '',
      value: q.uuid || q._id || q.id || '',
    }));
  }, [queueList]);

  const selectedQueueOption = useMemo(() => {
    return queueOptions.find((opt: any) => opt.value === selectedQueueId) || null;
  }, [queueOptions, selectedQueueId]);

  const managerExtensions = useMemo(() => {
    const managers = managerUserList.filter((ext: any) =>
      ['MANAGER', 'SUB-ADMIN', 'ADMIN'].includes(getManagerExtensionRole(ext)),
    );
    const selectedManager = extensionList.find(
      (ext: any) => getManagerExtensionId(ext) === String(selectedManagerId),
    );
    if (
      selectedManager &&
      !managers.some(
        (ext: any) => getManagerExtensionId(ext) === getManagerExtensionId(selectedManager),
      )
    ) {
      managers.unshift(selectedManager);
    }
    return managers;
  }, [extensionList, managerUserList, selectedManagerId]);

  const managerOptions = useMemo(() => {
    return managerExtensions.map((ext: any) => ({
      label: `${ext.first_name || ''} ${ext.last_name || ''}`.trim(),
      value: getManagerExtensionId(ext),
      extension: ext.extension || '',
    }));
  }, [managerExtensions]);

  const selectedManagerOption = useMemo(() => {
    return (
      managerOptions.find((opt: any) => String(opt.value) === String(selectedManagerId)) || null
    );
  }, [managerOptions, selectedManagerId]);

  const knowledgeBaseSummaryResolverPayload = useMemo(() => ({ page: 1, limit: 1000 }), []);

  const { data: kbData = [] } = useQuery({
    queryKey: ['AIUserKnowledgeBase', 'summary-resolver', knowledgeBaseSummaryResolverPayload],
    queryFn: () => AIUserKnowledgeBase(knowledgeBaseSummaryResolverPayload),
    select: getKnowledgeBaseRows,
  });

  const { data: reusableChatAgentRows = [], isFetching: isFetchingReusableChatAgents } = useQuery({
    queryKey: ['getChatAgentList', 'knowledge-reuse-picker'],
    queryFn: () => getChatAgentList({ page: 1, limit: 1000, filters: [], search: '' }),
    select: getAgentListRows,
  });

  const { data: reusableReceptionistRows = [], isFetching: isFetchingReusableReceptionists } =
    useQuery({
      queryKey: ['getAIReceptionistList', 'knowledge-reuse-picker'],
      queryFn: () => getAIReceptionistList({ page: 1, limit: 1000, filters: [], search: '' }),
      select: getAgentListRows,
    });

  const reusableKnowledgeAgents = useMemo(
    () =>
      [
        ...reusableChatAgentRows.map((agent: any) => buildReusableKnowledgeAgent(agent, 'chat')),
        ...reusableReceptionistRows.map((agent: any) =>
          buildReusableKnowledgeAgent(agent, 'voice'),
        ),
      ].filter((agent): agent is ReusableKnowledgeAgent => Boolean(agent)),
    [reusableChatAgentRows, reusableReceptionistRows],
  );

  const filteredKnowledgeBaseRows = useMemo(() => {
    const search = knowledgeBaseSearch.trim().toLowerCase();
    if (!search) return reusableKnowledgeAgents;

    return reusableKnowledgeAgents.filter((agent) =>
      [agent.name, agent.meta, agent.channel].join(' ').toLowerCase().includes(search),
    );
  }, [reusableKnowledgeAgents, knowledgeBaseSearch]);

  const isFetchingReusableKnowledgeAgents =
    isFetchingReusableChatAgents || isFetchingReusableReceptionists;

  const selectedReusableAgent = useMemo(
    () => reusableKnowledgeAgents.find((agent) => agent.id === selectedReusableAgentId) || null,
    [reusableKnowledgeAgents, selectedReusableAgentId],
  );

  const selectedKnowledgeBaseItems = useMemo(
    () => [
      ...getMatchedKnowledgeBaseItems(
        selectedTextKnowledgeIds,
        'text',
        kbData,
        existingKnowledgeBaseFallbackItems,
      ),
      ...getMatchedKnowledgeBaseItems(
        selectedUrlKnowledgeIds,
        'url',
        kbData,
        existingKnowledgeBaseFallbackItems,
      ),
      ...getMatchedKnowledgeBaseItems(
        selectedPdfKnowledgeIds,
        'pdf',
        kbData,
        existingKnowledgeBaseFallbackItems,
      ),
    ],
    [
      existingKnowledgeBaseFallbackItems,
      kbData,
      selectedPdfKnowledgeIds,
      selectedTextKnowledgeIds,
      selectedUrlKnowledgeIds,
    ],
  );

  const selectedKnowledgeBaseFaqInput = useMemo(() => {
    const text = selectedKnowledgeBaseItems
      .filter((entry) => entry.type === 'text')
      .flatMap((entry) => getKnowledgeBaseDataValues(entry.item));
    const url = selectedKnowledgeBaseItems
      .filter((entry) => entry.type === 'url')
      .flatMap((entry) =>
        getKnowledgeBaseDataValues(entry.item).filter(isLikelyUrl).map(normalizeUrl),
      );

    return {
      text: uniqueStrings(text),
      url: uniqueStrings(url),
    };
  }, [selectedKnowledgeBaseItems]);

  const sourceRecords = useMemo<SourceRecord[]>(() => {
    const existingKnowledgeSources = selectedKnowledgeBaseItems.map(({ id, type, item }) => ({
      id: `knowledge-${type}-${id}`,
      title: getKnowledgeBaseTitle(item, id),
      source: getKnowledgeBaseSourceLabel(item, type),
      type: getKnowledgeBaseTypeLabel(type),
      detail: getKnowledgeBaseSourceLabel(item, type),
    }));
    const selectedLinkSet = new Set(selectedLinks);
    const scannedPages = selectedLinks.map((link) => ({
      id: link,
      title: getPageTitle(link),
      source: link,
      type: 'Scanned page',
      detail: scanWebsiteUrl ? `Scanned from ${scanWebsiteUrl}` : 'Scanned website page',
    }));
    const manualUrls = pendingUrls
      .filter((url) => !selectedLinkSet.has(url))
      .map((url) => ({
        id: `pending-url-${url}`,
        title: getPageTitle(url),
        source: url,
        type: 'Website link',
        detail: 'Will be created when the agent is saved.',
      }));
    const textSources = pendingTextItems.map((item) => ({
      id: item.id,
      title: item.title,
      source: 'Pasted text',
      type: 'Company details',
      detail: item.text,
    }));
    const fileSources = pendingFiles.map(({ id, file }) => ({
      id,
      title: file.name,
      source: formatFileSize(file.size),
      type: 'Document',
      detail: 'Will be uploaded when the agent is saved.',
    }));

    return [
      ...existingKnowledgeSources,
      ...scannedPages,
      ...manualUrls,
      ...textSources,
      ...fileSources,
    ];
  }, [
    pendingFiles,
    pendingTextItems,
    pendingUrls,
    scanWebsiteUrl,
    selectedKnowledgeBaseItems,
    selectedLinks,
  ]);
  const knowledgeDocuments = useMemo<KnowledgeDocument[]>(
    () => [
      ...selectedKnowledgeBaseItems.map(({ id, type, item }) => ({
        id: `knowledge-${type}-${id}`,
        title: getKnowledgeBaseTitle(item, id),
        copy: getKnowledgeBaseSourceLabel(item, type),
        source: 'Saved knowledge base',
        status: item ? 'Attached' : 'Missing',
        type,
      })),
      ...selectedLinks.map((link) => ({
        id: link,
        title: getPageTitle(link),
        copy: link,
        source: scanWebsiteUrl || link,
        status: 'Scanned',
        type: 'url',
      })),
      ...pendingUrls
        .filter((url) => !selectedLinks.includes(url))
        .map((url) => ({
          id: `pending-url-${url}`,
          title: getPageTitle(url),
          copy: url,
          source: url,
          status: 'Pending',
          type: 'url',
        })),
      ...pendingTextItems.map((item) => ({
        id: item.id,
        title: item.title,
        copy: item.text,
        source: 'Pasted text',
        status: 'Pending',
        type: 'text',
      })),
      ...pendingFiles.map(({ id, file }) => ({
        id,
        title: file.name,
        copy: formatFileSize(file.size),
        source: 'PDF upload',
        status: 'Pending',
        type: 'pdf',
      })),
    ],
    [
      pendingFiles,
      pendingTextItems,
      pendingUrls,
      scanWebsiteUrl,
      selectedKnowledgeBaseItems,
      selectedLinks,
    ],
  );
  const hasOnlyExistingKnowledgeBaseSelection = Boolean(
    (selectedReusableAgentId || selectedKnowledgeBaseItems.length > 0) &&
    !selectedLinks.length &&
    !pendingUrls.length &&
    !pendingTextItems.length &&
    !pendingFiles.length &&
    !customContent.trim(),
  );
  const selectedExistingKnowledgeBaseDocuments = useMemo(() => {
    if (selectedReusableAgent?.documents.length) return selectedReusableAgent.documents;

    const storedDocuments = selectedKnowledgeBaseItems.flatMap(({ id, type, item }) =>
      getStoredKnowledgeBaseDocuments(item).map((document) => ({
        ...document,
        id: `knowledge-${type}-${id}-${document.id}`,
      })),
    );
    if (storedDocuments.length) return storedDocuments;

    return knowledgeDocuments.filter((document) => document.id.startsWith('knowledge-'));
  }, [knowledgeDocuments, selectedKnowledgeBaseItems, selectedReusableAgent]);
  const selectedExistingKnowledgeBaseFaqs = useMemo(() => {
    if (selectedReusableAgent?.faqs.length) return selectedReusableAgent.faqs;

    return selectedKnowledgeBaseItems.flatMap(({ id, type, item }) =>
      getStoredKnowledgeBaseFaqs(item).map((faq) => ({
        ...faq,
        id: `knowledge-${type}-${id}-${faq.id}`,
      })),
    );
  }, [selectedKnowledgeBaseItems, selectedReusableAgent]);
  const knowledgeFaqPayload = useMemo<GenerateKnowledgeBaseFaqPayload>(
    () => ({
      crawl_url: uniqueStrings(selectedLinks.map((url) => normalizeUrl(url))),
      url: uniqueStrings([
        ...selectedKnowledgeBaseFaqInput.url,
        ...pendingUrls.map((url) => normalizeUrl(url)),
      ]),
      text: uniqueStrings([
        ...selectedKnowledgeBaseFaqInput.text,
        ...pendingTextItems.map((item) => item.text.trim()),
        customContent.trim(),
      ]),
    }),
    [customContent, pendingTextItems, pendingUrls, selectedKnowledgeBaseFaqInput, selectedLinks],
  );
  const knowledgeSummaryPayload = useMemo<SummarizeKnowledgeBasePayload>(
    () => ({
      crawl_url: knowledgeFaqPayload.crawl_url ?? [],
      url: knowledgeFaqPayload.url ?? [],
      text: knowledgeFaqPayload.text ?? [],
      pdf: [],
    }),
    [knowledgeFaqPayload],
  );
  const hasKnowledgeSummaryInput = Boolean(
    knowledgeSummaryPayload.crawl_url?.length ||
    knowledgeSummaryPayload.url?.length ||
    knowledgeSummaryPayload.text?.length ||
    knowledgeSummaryPayload.pdf?.length,
  );
  const knowledgeSummaryRequestKey = useMemo(
    () =>
      JSON.stringify({
        crawl_url: knowledgeSummaryPayload.crawl_url ?? [],
        url: knowledgeSummaryPayload.url ?? [],
        text: knowledgeSummaryPayload.text ?? [],
        pdf: knowledgeSummaryPayload.pdf ?? [],
      }),
    [knowledgeSummaryPayload],
  );
  const initialKnowledgeSummaryRequestKeyRef = useRef(knowledgeSummaryRequestKey);

  const agentDomain = formatAgentDomain(initialData, scanWebsiteUrl);

  const clearWebsiteScanProgressCloseTimeout = () => {
    if (!websiteScanProgressCloseTimeoutRef.current) return;
    clearTimeout(websiteScanProgressCloseTimeoutRef.current);
    websiteScanProgressCloseTimeoutRef.current = null;
  };

  const clearKnowledgeReviewPollTimeout = () => {
    if (!knowledgeReviewPollTimeoutRef.current) return;
    clearTimeout(knowledgeReviewPollTimeoutRef.current);
    knowledgeReviewPollTimeoutRef.current = null;
  };

  const finishWebsiteScanProgress = (
    status: Exclude<WebsiteScanProgressStatus, 'idle' | 'loading'>,
  ) => {
    clearWebsiteScanProgressCloseTimeout();
    setWebsiteScanProgressStatus(status);
    websiteScanProgressCloseTimeoutRef.current = setTimeout(
      () => {
        setWebsiteScanProgressStatus('idle');
        websiteScanProgressCloseTimeoutRef.current = null;
      },
      status === 'success' ? 750 : 550,
    );
  };

  useEffect(() => {
    return () => {
      if (websiteScanProgressCloseTimeoutRef.current) {
        clearTimeout(websiteScanProgressCloseTimeoutRef.current);
      }
      clearKnowledgeReviewPollTimeout();
    };
  }, []);

  useEffect(() => {
    const isReviewStep = activeStep === 2 && sourceStage === 3;

    if (!isReviewStep) {
      clearKnowledgeReviewPollTimeout();
      knowledgeReviewRequestKeyRef.current = '';
      knowledgeReviewJobIdRef.current = '';
      setIsSummarizingKnowledgeBase(false);
      setIsGeneratingKnowledgeFaqs(false);
      return;
    }
    if (hasOnlyExistingKnowledgeBaseSelection) {
      clearKnowledgeReviewPollTimeout();
      knowledgeReviewRequestKeyRef.current = 'existing-knowledge-base';
      knowledgeReviewJobIdRef.current = '';
      setKnowledgeDocumentSummaries(selectedExistingKnowledgeBaseDocuments);
      setKnowledgeFaqs(selectedExistingKnowledgeBaseFaqs);
      setKnowledgeSummaryError('');
      setKnowledgeFaqError('');
      setIsSummarizingKnowledgeBase(false);
      setIsGeneratingKnowledgeFaqs(false);
      return;
    }
    if (
      isEdit &&
      !hasKnowledgeSummaryInput &&
      (storedKnowledgeDocuments.length || storedKnowledgeFaqs.length)
    ) {
      clearKnowledgeReviewPollTimeout();
      knowledgeReviewRequestKeyRef.current = '';
      knowledgeReviewJobIdRef.current = '';
      setKnowledgeDocumentSummaries(storedKnowledgeDocuments);
      setKnowledgeFaqs(storedKnowledgeFaqs);
      setKnowledgeSummaryError('');
      setKnowledgeFaqError('');
      setIsSummarizingKnowledgeBase(false);
      setIsGeneratingKnowledgeFaqs(false);
      return;
    }
    if (!hasKnowledgeSummaryInput) {
      clearKnowledgeReviewPollTimeout();
      knowledgeReviewRequestKeyRef.current = '';
      knowledgeReviewJobIdRef.current = '';
      setKnowledgeDocumentSummaries([]);
      setKnowledgeFaqs([]);
      setKnowledgeSummaryError('');
      setKnowledgeFaqError('');
      setIsSummarizingKnowledgeBase(false);
      setIsGeneratingKnowledgeFaqs(false);
      return;
    }
    if (
      isEdit &&
      storedKnowledgeDocuments.length &&
      storedKnowledgeFaqs.length &&
      ((storedDocumentSourceKey === knowledgeSummaryRequestKey &&
        storedFaqSourceKey === knowledgeSummaryRequestKey) ||
        (!storedDocumentSourceKey &&
          !storedFaqSourceKey &&
          knowledgeSummaryRequestKey === initialKnowledgeSummaryRequestKeyRef.current))
    ) {
      clearKnowledgeReviewPollTimeout();
      knowledgeReviewRequestKeyRef.current = knowledgeSummaryRequestKey;
      knowledgeReviewJobIdRef.current = '';
      setKnowledgeDocumentSummaries(storedKnowledgeDocuments);
      setKnowledgeFaqs(storedKnowledgeFaqs);
      setKnowledgeSummaryError('');
      setKnowledgeFaqError('');
      setIsSummarizingKnowledgeBase(false);
      setIsGeneratingKnowledgeFaqs(false);
      return;
    }
    const currentSourceEntries = getKnowledgeReviewPayloadEntries(knowledgeSummaryPayload);
    const activeSourceKeys = new Set(
      currentSourceEntries
        .map((entry) => getKnowledgeReviewSourceKey(entry.type, entry.value))
        .filter(Boolean),
    );
    const baseKnowledgeDocuments = isEdit
      ? storedKnowledgeDocuments.filter((document) =>
          activeSourceKeys.has(getKnowledgeReviewItemSourceKey(document)),
        )
      : [];
    const baseKnowledgeFaqs = isEdit
      ? storedKnowledgeFaqs.filter((faq) =>
          activeSourceKeys.has(getKnowledgeReviewItemSourceKey(faq)),
        )
      : [];
    const coveredSourceKeys = new Set(
      [...baseKnowledgeDocuments, ...baseKnowledgeFaqs]
        .map((item) => getKnowledgeReviewItemSourceKey(item))
        .filter(Boolean),
    );
    const reviewPayload = isEdit
      ? buildKnowledgeReviewPayload(
          currentSourceEntries.filter(
            (entry) => !coveredSourceKeys.has(getKnowledgeReviewSourceKey(entry.type, entry.value)),
          ),
        )
      : knowledgeSummaryPayload;

    if (isEdit && !hasKnowledgeReviewPayloadInput(reviewPayload)) {
      clearKnowledgeReviewPollTimeout();
      knowledgeReviewRequestKeyRef.current = knowledgeSummaryRequestKey;
      knowledgeReviewJobIdRef.current = '';
      setKnowledgeDocumentSummaries(baseKnowledgeDocuments);
      setKnowledgeFaqs(baseKnowledgeFaqs);
      setKnowledgeSummaryError('');
      setKnowledgeFaqError('');
      setIsSummarizingKnowledgeBase(false);
      setIsGeneratingKnowledgeFaqs(false);
      return;
    }
    if (knowledgeReviewRequestKeyRef.current === knowledgeSummaryRequestKey) return;

    let isActive = true;
    knowledgeReviewRequestKeyRef.current = knowledgeSummaryRequestKey;
    knowledgeReviewJobIdRef.current = '';
    setKnowledgeDocumentSummaries(baseKnowledgeDocuments);
    setKnowledgeFaqs(baseKnowledgeFaqs);
    setKnowledgeSummaryError('');
    setKnowledgeFaqError('');
    setIsSummarizingKnowledgeBase(true);
    setIsGeneratingKnowledgeFaqs(true);

    const applyKnowledgeReviewJobResponse = (response: any) => {
      const documents = getKnowledgeBaseSummaryResponseItems(response);
      const faqs = getKnowledgeBaseFaqResponseItems(response);
      const status = getKnowledgeReviewJobStatus(response);
      const mergedDocuments = [...baseKnowledgeDocuments, ...documents];
      const mergedFaqs = [...baseKnowledgeFaqs, ...faqs];

      setKnowledgeDocumentSummaries(mergedDocuments);
      setKnowledgeFaqs(
        mergedFaqs.length ? mergedFaqs : status === 'failed' ? [createEmptyKnowledgeFaq()] : [],
      );

      if (status === 'completed' || status === 'failed') {
        setKnowledgeSummaryError(mergedDocuments.length ? '' : 'Cannot generate summary');
        setKnowledgeFaqError(mergedFaqs.length ? '' : 'Cannot generate FAQs');
        setIsSummarizingKnowledgeBase(false);
        setIsGeneratingKnowledgeFaqs(false);
        return true;
      }

      return false;
    };

    const pollKnowledgeReviewJob = async (jobId: string) => {
      try {
        const response = await getKnowledgeBaseReviewJob(jobId);
        if (!isActive) return;
        const isComplete = applyKnowledgeReviewJobResponse(response);
        if (!isComplete) {
          knowledgeReviewPollTimeoutRef.current = setTimeout(
            () => void pollKnowledgeReviewJob(jobId),
            2000,
          );
        }
      } catch (error) {
        if (!isActive) return;
        console.error('Cannot load knowledge base review job:', error);
        setKnowledgeDocumentSummaries([]);
        setKnowledgeFaqs([createEmptyKnowledgeFaq()]);
        setKnowledgeSummaryError('Cannot generate summary');
        setKnowledgeFaqError('Cannot generate FAQs');
        setIsSummarizingKnowledgeBase(false);
        setIsGeneratingKnowledgeFaqs(false);
      }
    };

    const startKnowledgeReviewJob = async () => {
      try {
        const response = await startKnowledgeBaseReviewJob({
          ...reviewPayload,
          reviewSessionId: knowledgeReviewSessionIdRef.current,
        });
        if (!isActive) return;
        const jobId = getKnowledgeReviewJobId(response);
        knowledgeReviewJobIdRef.current = jobId;
        if (jobId) knowledgeReviewJobIdsRef.current.add(jobId);
        const isComplete = applyKnowledgeReviewJobResponse(response);

        if (!isComplete && jobId) {
          knowledgeReviewPollTimeoutRef.current = setTimeout(
            () => void pollKnowledgeReviewJob(jobId),
            2000,
          );
        } else if (!isComplete) {
          setKnowledgeSummaryError('Cannot generate summary');
          setKnowledgeFaqError('Cannot generate FAQs');
          setIsSummarizingKnowledgeBase(false);
          setIsGeneratingKnowledgeFaqs(false);
        }
      } catch (error) {
        if (!isActive) return;
        console.error('Cannot start knowledge base review job:', error);
        setKnowledgeDocumentSummaries([]);
        setKnowledgeFaqs([createEmptyKnowledgeFaq()]);
        setKnowledgeSummaryError('Cannot generate summary');
        setKnowledgeFaqError('Cannot generate FAQs');
        setIsSummarizingKnowledgeBase(false);
        setIsGeneratingKnowledgeFaqs(false);
      }
    };

    void startKnowledgeReviewJob();

    return () => {
      isActive = false;
      clearKnowledgeReviewPollTimeout();
    };
  }, [
    activeStep,
    hasKnowledgeSummaryInput,
    hasOnlyExistingKnowledgeBaseSelection,
    knowledgeSummaryPayload,
    knowledgeSummaryRequestKey,
    selectedExistingKnowledgeBaseDocuments,
    selectedExistingKnowledgeBaseFaqs,
    sourceStage,
    isEdit,
    storedDocumentSourceKey,
    storedFaqSourceKey,
    storedKnowledgeDocuments,
    storedKnowledgeFaqs,
  ]);

  const { data: useCaseTemplateData, isLoading: isLoadingUseCaseTemplates } = useQuery({
    queryKey: ['getAIAgentType', 'chat'],
    queryFn: () => getAIAgentType({ type: 'chat' }),
  });

  const useCaseTemplateOptions = useMemo(() => {
    const options = getAgentTypeTemplateOptions(useCaseTemplateData);
    const uniqueOptions = Array.from(
      new Map(options.map((option) => [option.name.toLowerCase(), option])).values(),
    );
    const currentUseCase = roleUseCase.trim();

    if (
      currentUseCase &&
      !uniqueOptions.some((option) => option.name.toLowerCase() === currentUseCase.toLowerCase())
    ) {
      return [
        {
          id: `current-${currentUseCase}`,
          name: currentUseCase,
          welcomeGreeting: '',
          systemPrompt: '',
        },
        ...uniqueOptions,
      ];
    }

    return uniqueOptions;
  }, [roleUseCase, useCaseTemplateData]);

  const { mutateAsync: submitAgent, isPending: isSubmitting } = useMutation({
    mutationFn: isEdit ? updateAIAgent : createAIAgent,
    onSuccess: (response: any, submittedPayload: any) => {
      queryClient.invalidateQueries({ queryKey: ['getChatAgentList'] });
      handleAlert({
        text: `AI Agent ${isEdit ? 'updated' : 'created'} successfully!`,
        type: 'success',
      });
      void cleanupKnowledgeReviewWorkspace();
      allowWizardExitRef.current = true;
      if (isEdit) {
        navigate('/admin-settings/knowledge/ai-agent');
        return;
      }

      const responseAgent = getAgentResultFromResponse(response);
      const createdAgent = {
        ...submittedPayload,
        ...responseAgent,
        forward_call_actions:
          responseAgent?.forward_call_actions || submittedPayload?.forward_call_actions,
      };
      navigate('/admin-settings/knowledge/playground', {
        state: {
          activeTab: 'chat',
          selectedAgent: createdAgent,
          openAgentId: createdAgent?.agent_uuid || createdAgent?.agentId || createdAgent?.id,
        },
      });
    },
    onError: (err: any) => {
      console.error(`Failed to ${isEdit ? 'update' : 'create'} AI Agent:`, err);
      handleAlert({
        text: `Failed to ${isEdit ? 'update' : 'create'} AI Agent.`,
        type: 'error',
      });
    },
  });

  const { mutate: crawlSite, isPending: isCrawlingSite } = useMutation({
    mutationFn: siteCrawl,
    onSuccess: (response: any) => {
      const links = Array.isArray(response?.data) ? response.data : [];
      setDiscoveredLinks(links);
      setSelectedLinks(getSelectedLinksAfterScan(links, selectedLinks));
      setStepErrors((prev) => ({ ...prev, websiteUrl: '', knowledgeBase: '' }));
      finishWebsiteScanProgress('success');
      if (!links.length) {
        handleAlert({ text: 'No pages were found for this website.', type: 'warning' });
      }
      setSourceStage(2);
    },
    onError: (error: any) => {
      finishWebsiteScanProgress('error');
      handleAlert({
        text: error?.response?.data?.error || 'Failed to scan website. Please try again.',
        type: 'error',
      });
    },
  });

  const stepTitle = useMemo(() => {
    if (activeStep === 1) return 'Identity & Behavior';
    if (activeStep === 2) {
      if (sourceStage === 1) return 'Knowledge — your website';
      if (sourceStage === 2) return 'Pick pages & add documents';
      return 'Review knowledge';
    }
    if (activeStep === 6) return 'Handoff';
    return 'Advanced Settings';
  }, [activeStep, sourceStage]);

  const validateStep = (step: number): StepErrors => {
    const errors: StepErrors = {};

    if (step === 1) {
      const botNameError = getAgentNameValidationError(botName, 'Bot name');
      if (botNameError) errors.botName = botNameError;
      if (!companyBrand.trim()) errors.companyBrand = 'Company / Brand is required.';
      if (!welcomeMessage.trim()) errors.welcomeMessage = 'Welcome message is required.';
      if (!systemPrompt.trim()) errors.systemPrompt = 'System prompt is required.';
      if (!selectedLocationId || !selectedLocation) {
        errors.siteLocation = 'Please select a site.';
      } else if (!getAgentSiteTimezone(selectedLocation)) {
        errors.siteLocation =
          'The selected location does not have a timezone. Update it under Company & Locations.';
      }
    }

    if (step === 2) {
      const hasKnowledgeFaqText = Boolean(formatKnowledgeFaqText(knowledgeFaqs));
      const hasKnowledgeSummaryText = Boolean(
        formatKnowledgeSummaryText(knowledgeDocumentSummaries),
      );
      const hasSelectedKb =
        Boolean(selectedReusableAgentId) ||
        selectedTextKnowledgeIds.length > 0 ||
        selectedUrlKnowledgeIds.length > 0 ||
        selectedPdfKnowledgeIds.length > 0 ||
        selectedLinks.length > 0 ||
        pendingUrls.length > 0 ||
        pendingTextItems.length > 0 ||
        pendingFiles.length > 0 ||
        hasKnowledgeSummaryText ||
        hasKnowledgeFaqText;

      if (!hasSelectedKb) {
        errors.knowledgeBase = 'Add a scanned page, URL, text, PDF, or custom FAQ.';
      }

      const hasExistingKnowledgeBase =
        Boolean(selectedReusableAgentId) ||
        selectedTextKnowledgeIds.length > 0 ||
        selectedUrlKnowledgeIds.length > 0 ||
        selectedPdfKnowledgeIds.length > 0;

      if (
        !isEdit &&
        activeStep === 2 &&
        sourceStage === 3 &&
        !hasExistingKnowledgeBase &&
        !getValidKnowledgeFaqs(knowledgeFaqs).length
      ) {
        errors.knowledgeBase = 'Add at least one FAQ with a question and answer.';
      }

      if (extraUrl.trim() && !isLikelyUrl(extraUrl)) {
        errors.extraUrl = 'Enter a valid page URL.';
      }
    }

    if (step === 6) {
      if (enableHumanHandoff && !selectedQueueId) {
        errors.queue = 'Chat queue is required.';
      }
      if ((enableHumanHandoff || enableCallbackScheduling) && !selectedManagerId) {
        errors.manager = 'Manager selection is required.';
      }
    }

    return errors;
  };

  const handleStepperChange = async (targetActiveStep: number, targetSourceStage: SourceStage) => {
    if (isKnowledgeSummaryNavigationLocked) return;

    let currentStepId = 1;
    if (activeStep === 1) currentStepId = 1;
    else if (activeStep === 2) {
      if (sourceStage === 1) currentStepId = 2;
      else if (sourceStage === 2) currentStepId = 3;
      else if (sourceStage === 3) currentStepId = 4;
    } else if (activeStep === 6) currentStepId = 5;
    else if (activeStep === 7) currentStepId = 6;

    let targetStepId = 1;
    if (targetActiveStep === 1) targetStepId = 1;
    else if (targetActiveStep === 2) {
      if (targetSourceStage === 1) targetStepId = 2;
      else if (targetSourceStage === 2) targetStepId = 3;
      else targetStepId = 4;
    } else if (targetActiveStep === 6) targetStepId = 5;
    else if (targetActiveStep === 7) targetStepId = 6;
    const nextSourceStage: SourceStage = targetActiveStep === 2 ? targetSourceStage : 1;

    if (isReadOnly) {
      setStepErrors({});
      setActiveStep(targetActiveStep);
      if (targetActiveStep === 2) setSourceStage(nextSourceStage);
      return;
    }

    if (targetStepId <= currentStepId) {
      setStepErrors({});
      setActiveStep(targetActiveStep);
      if (targetActiveStep === 2) setSourceStage(nextSourceStage);
      return;
    }

    const mergedErrors: StepErrors = {};
    if (currentStepId >= 1 && targetStepId > 1) {
      Object.assign(mergedErrors, validateStep(1));
    }
    if (currentStepId >= 2 && targetStepId > 3) {
      Object.assign(mergedErrors, validateStep(2));
    }
    if (currentStepId >= 5 && targetStepId > 5) {
      Object.assign(mergedErrors, validateStep(6));
    }

    if (Object.keys(mergedErrors).length) {
      setStepErrors(mergedErrors);
      scrollToFirstValidationError(mergedErrors);
      return;
    }

    setStepErrors({});
    setActiveStep(targetActiveStep);
    if (targetActiveStep === 2) setSourceStage(nextSourceStage);
  };

  const handleEditTabChange = (tab: EditAgentTab) => {
    if (isKnowledgeSummaryNavigationLocked) return;

    setEditTab(tab);
    if (tab !== 'overview') {
      const step = editTabToStep[tab];
      setActiveStep(step);
      if (tab === 'website') setSourceStage(1);
      else if (tab === 'review') setSourceStage(3);
    }
  };

  useEffect(() => {
    if (!isEdit || editTab === 'overview') return;

    let nextTab: EditAgentTab = 'brain';
    if (activeStep === 1) nextTab = 'brain';
    else if (activeStep === 2) {
      if (sourceStage === 1) nextTab = 'website';
      else if (sourceStage === 3) nextTab = 'review';
    } else if (activeStep === 6) nextTab = 'handoff';
    else if (activeStep === 7) nextTab = 'advanced';

    if (nextTab && nextTab !== editTab) {
      setEditTab(nextTab);
    }
  }, [activeStep, sourceStage, editTab, isEdit]);

  useEffect(() => {
    if (activeStep === 3 || activeStep === 4 || activeStep === 5) {
      setActiveStep(2);
      setSourceStage(3);
    }
  }, [activeStep]);

  const handleSelectReusableKnowledgeAgent = async (agent: ReusableKnowledgeAgent) => {
    if (isReadOnly) return;

    await cleanupKnowledgeReviewWorkspace();
    setSelectedReusableAgentId(agent.id);
    setSelectedTextKnowledgeIds([]);
    setSelectedUrlKnowledgeIds([]);
    setSelectedPdfKnowledgeIds([]);
    setSelectedLinks([]);
    setPendingUrls([]);
    setPendingTextItems([]);
    setPendingFiles([]);
    setExtraUrl('');
    setCustomContent('');
    setKnowledgeDocumentSummaries(agent.documents);
    setKnowledgeFaqs(agent.faqs);
    setKnowledgeSummaryError('');
    setKnowledgeFaqError('');
    setStepErrors((prev) => ({ ...prev, knowledgeBase: '' }));
    setSourceStage(3);
  };

  const getAgentKnowledgeName = (suffix?: string) => {
    const baseName = sanitizeAgentName(botName).trim() || 'Chat Agent Knowledge Base';
    return suffix ? `${baseName} - ${suffix}` : baseName;
  };

  const createPendingKnowledgeSources = async (): Promise<CreatedKnowledgeIds> => {
    const createdIds: CreatedKnowledgeIds = { text: [], url: [], pdf: [] };
    if (hasOnlyExistingKnowledgeBaseSelection && !selectedReusableAgentId) return createdIds;

    const generatedKnowledgeText = formatGeneratedKnowledgeText(
      knowledgeFaqs,
      knowledgeDocumentSummaries,
    );

    if (generatedKnowledgeText) {
      if (
        isEdit &&
        !selectedReusableAgentId &&
        !pendingFiles.length &&
        storedFaqKnowledgeBaseId &&
        isSameGeneratedKnowledgeText(generatedKnowledgeText, storedFaqText)
      ) {
        createdIds.text.push(storedFaqKnowledgeBaseId);
        createdIds.faqTextId = storedFaqKnowledgeBaseId;
        return createdIds;
      }

      const faqPayload: any = {
        name: getAgentKnowledgeName('Generated Knowledge'),
        text: generatedKnowledgeText,
        scope: 'global',
        metadata: {
          source: 'generated_knowledge',
          documentSourceKey: knowledgeSummaryRequestKey,
          faqSourceKey: knowledgeSummaryRequestKey,
          documents: knowledgeDocumentSummaries,
          faqs: getValidKnowledgeFaqs(knowledgeFaqs),
        },
      };
      if (isEdit && storedFaqKnowledgeBaseId) {
        faqPayload.ingestionId = storedFaqKnowledgeBaseId;
      }

      const faqResponse = await userAddContent(faqPayload);
      const faqIngestionId = getIngestionIdFromResponse(faqResponse);
      if (!faqIngestionId) {
        throw new Error('Generated knowledge base was created without an ingestion ID.');
      }
      createdIds.text.push(faqIngestionId);
      createdIds.faqTextId = faqIngestionId;

      if (pendingFiles.length) {
        const formData = new FormData();
        formData.append('name', getAgentKnowledgeName('Files'));
        pendingFiles.forEach(({ file }) => formData.append('files', file, file.name));

        const pdfResponse = await uploadIngestPdf(formData);
        const pdfIngestionId = getIngestionIdFromResponse(pdfResponse);
        if (!pdfIngestionId) {
          throw new Error('PDF knowledge base was created without an ingestion ID.');
        }
        createdIds.pdf.push(pdfIngestionId);
      }

      return createdIds;
    }

    const urlsToCreate = uniqueStrings([...selectedLinks, ...pendingUrls].map(normalizeUrl));

    if (urlsToCreate.length) {
      const urlResponse = await userIngestURL({
        name: getAgentKnowledgeName('URLs'),
        urls: urlsToCreate,
        scope: 'global',
      });
      const urlIngestionId = getIngestionIdFromResponse(urlResponse);
      if (!urlIngestionId) {
        throw new Error('URL knowledge base was created without an ingestion ID.');
      }
      createdIds.url.push(urlIngestionId);
    }

    for (const item of pendingTextItems) {
      const textResponse = await userAddContent({
        name: getAgentKnowledgeName(item.title),
        text: item.text,
        scope: 'global',
      });
      const textIngestionId = getIngestionIdFromResponse(textResponse);
      if (!textIngestionId) {
        throw new Error('Text knowledge base was created without an ingestion ID.');
      }
      createdIds.text.push(textIngestionId);
    }

    if (pendingFiles.length) {
      const formData = new FormData();
      formData.append('name', getAgentKnowledgeName('Files'));
      pendingFiles.forEach(({ file }) => formData.append('files', file, file.name));

      const pdfResponse = await uploadIngestPdf(formData);
      const pdfIngestionId = getIngestionIdFromResponse(pdfResponse);
      if (!pdfIngestionId) {
        throw new Error('PDF knowledge base was created without an ingestion ID.');
      }
      createdIds.pdf.push(pdfIngestionId);
    }

    return createdIds;
  };

  const handleContinueFromKnowledgeBase = () => {
    if (isReadOnly) return;

    const errors = validateStep(2);
    if (Object.keys(errors).length) {
      setStepErrors(errors);
      return;
    }

    setStepErrors({});
    setSourceStage(3);
  };

  const handleContinueFromWebsite = () => {
    if (isReadOnly) return;

    const normalizedUrl = normalizeUrl(scanWebsiteUrl);
    if (!normalizedUrl) {
      setStepErrors((prev) => ({ ...prev, websiteUrl: 'Website URL is required.' }));
      return;
    }

    if (!isLikelyUrl(normalizedUrl)) {
      setStepErrors((prev) => ({ ...prev, websiteUrl: 'Enter a valid website URL.' }));
      return;
    }

    setStepErrors((prev) => ({ ...prev, websiteUrl: '' }));
    setScanWebsiteUrl(normalizedUrl);
    clearWebsiteScanProgressCloseTimeout();
    setWebsiteScanProgressStatus('loading');
    crawlSite({ site_url: normalizedUrl });
  };

  const handleUseManualKnowledgeMode = async () => {
    if (isReadOnly) return;

    await cleanupKnowledgeReviewWorkspace();
    clearKnowledgeReviewPollTimeout();
    knowledgeReviewRequestKeyRef.current = '';
    knowledgeReviewJobIdRef.current = '';
    knowledgeReviewSessionIdRef.current = createLocalId('knowledge-review');
    setSelectedReusableAgentId('');
    setSelectedTextKnowledgeIds([]);
    setSelectedUrlKnowledgeIds([]);
    setSelectedPdfKnowledgeIds([]);
    setDiscoveredLinks([]);
    setSelectedLinks([]);
    setPendingUrls([]);
    setExtraUrl('');
    setKnowledgeDocumentSummaries([]);
    setKnowledgeFaqs([]);
    setKnowledgeSummaryError('');
    setKnowledgeFaqError('');
    setStepErrors((prev) => ({ ...prev, extraUrl: '', knowledgeBase: '' }));
    setSourceStage(2);
  };

  const handleAddExtraUrl = () => {
    if (isReadOnly) return;

    const normalizedUrl = normalizeUrl(extraUrl);
    if (!normalizedUrl || !isLikelyUrl(normalizedUrl)) {
      setStepErrors((prev) => ({ ...prev, extraUrl: 'Enter a valid page URL.' }));
      return;
    }

    setPendingUrls((prev) => uniqueStrings([...prev, normalizedUrl]));
    setExtraUrl('');
    setStepErrors((prev) => ({ ...prev, extraUrl: '', knowledgeBase: '' }));
  };

  const handleRemovePendingUrl = (url: string) => {
    setPendingUrls((prev) => prev.filter((item) => item !== url));
  };

  const handleAddCustomContent = () => {
    if (isReadOnly) return;

    const content = customContent.trim();
    if (!content) {
      handleAlert({ text: 'Please add content before creating a knowledge base.', type: 'error' });
      return;
    }

    setPendingTextItems((prev) => [
      ...prev,
      {
        id: createLocalId('pending-text'),
        title:
          customContentTitle.trim() && customContentTitle.trim() !== 'Custom Content'
            ? customContentTitle.trim()
            : `Text ${prev.length + 1}`,
        text: content,
      },
    ]);
    setCustomContent('');
    setCustomContentTitle('Custom Content');
    setStepErrors((prev) => ({ ...prev, knowledgeBase: '' }));
  };

  const handleRemovePendingText = (id: string) => {
    setPendingTextItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handlePendingFilesSelected = (files: FileList | null) => {
    if (isReadOnly || !files?.length) return;

    const maxFileSize = 25 * 1024 * 1024;
    const selectedFiles = Array.from(files);
    const pdfFiles = selectedFiles.filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    );
    const validSizedFiles = pdfFiles.filter((file) => file.size <= maxFileSize);

    if (pdfFiles.length !== selectedFiles.length) {
      handleAlert({ text: 'Only PDF files can be added.', type: 'warning' });
    }
    if (validSizedFiles.length !== pdfFiles.length) {
      handleAlert({ text: 'PDF files must be 25 MB or smaller.', type: 'warning' });
    }

    setPendingFiles((prev) => {
      const existingKeys = new Set(
        prev.map(({ file }) => `${file.name}-${file.size}-${file.lastModified}`),
      );
      const nextFiles = validSizedFiles
        .filter((file) => !existingKeys.has(`${file.name}-${file.size}-${file.lastModified}`))
        .map((file) => ({ id: createLocalId('pending-file'), file }));
      const merged = [...prev, ...nextFiles].slice(0, 5);

      if (prev.length + nextFiles.length > 5) {
        handleAlert({ text: 'You can add up to 5 PDF files only.', type: 'warning' });
      }

      return merged;
    });
    setStepErrors((prev) => ({ ...prev, knowledgeBase: '' }));
  };

  const handleRemovePendingFile = (id: string) => {
    if (isReadOnly) return;
    setPendingFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const handleOpenReviewKnowledgeAdd = (type: ReviewKnowledgeItemType) => {
    if (isReadOnly) return;
    setOpenReviewKnowledgeMenu('');
    setReviewKnowledgeAddModal({
      type,
      mode: 'text',
      title: '',
      body: '',
      file: null,
    });
  };

  const handleConfirmReviewKnowledgeAdd = () => {
    if (isReadOnly || !reviewKnowledgeAddModal) return;

    const title = reviewKnowledgeAddModal.title.trim();
    const body = reviewKnowledgeAddModal.body.trim();
    const isUpload = reviewKnowledgeAddModal.mode === 'upload';
    const file = reviewKnowledgeAddModal.file;

    if (isUpload && !file) {
      handleAlert({ text: 'Choose a file or switch to Paste text.', type: 'warning' });
      return;
    }

    if (!isUpload && !title) {
      handleAlert({
        text:
          reviewKnowledgeAddModal.type === 'faq' ? 'Question is required.' : 'Title is required.',
        type: 'warning',
      });
      return;
    }

    if (reviewKnowledgeAddModal.type === 'document') {
      const documentTitle = isUpload && file ? file.name.replace(/\.[^.]+$/, '') : title;
      const documentBody =
        isUpload && file
          ? `Imported from ${file.name}. The chatbot will use this document content as review knowledge.`
          : body;

      setKnowledgeDocumentSummaries((prev) => [
        {
          id: createLocalId('document'),
          title: documentTitle,
          copy: documentBody,
          source: isUpload && file ? file.name : 'Manual',
          status: 'Just now',
          type: isUpload ? 'pdf' : 'text',
        },
        ...prev,
      ]);
    } else {
      setKnowledgeFaqs((prev) => [
        {
          id: createLocalId('faq'),
          question: isUpload && file ? file.name.replace(/\.[^.]+$/, '') : title,
          answer:
            isUpload && file
              ? `Imported from ${file.name}. The chatbot will use this file as FAQ knowledge.`
              : body,
          source: isUpload && file ? file.name : 'Manual',
        },
        ...prev,
      ]);
    }

    setReviewKnowledgeAddModal(null);
    setStepErrors((prev) => ({ ...prev, knowledgeBase: '' }));
    handleAlert({ text: 'Added to knowledge base.', type: 'success' });
  };

  const handleReviewKnowledgeAddFilePicked = (file: globalThis.File | null) => {
    if (!file || !reviewKnowledgeAddModal) return;
    setReviewKnowledgeAddModal((prev) => (prev ? { ...prev, file } : prev));
  };

  const handleOpenReviewKnowledgeEdit = (
    type: ReviewKnowledgeItemType,
    item: KnowledgeDocument | KnowledgeFaq,
  ) => {
    if (isReadOnly) return;
    setOpenReviewKnowledgeMenu('');
    setReviewKnowledgeEditModal(
      type === 'document'
        ? {
            type,
            id: item.id,
            title: (item as KnowledgeDocument).title,
            body: (item as KnowledgeDocument).copy,
          }
        : {
            type,
            id: item.id,
            title: (item as KnowledgeFaq).question,
            body: (item as KnowledgeFaq).answer,
          },
    );
  };

  const handleConfirmReviewKnowledgeEdit = () => {
    if (isReadOnly || !reviewKnowledgeEditModal) return;

    const title = reviewKnowledgeEditModal.title.trim();
    const body = reviewKnowledgeEditModal.body.trim();

    if (!title) {
      handleAlert({
        text:
          reviewKnowledgeEditModal.type === 'faq' ? 'Question is required.' : 'Title is required.',
        type: 'warning',
      });
      return;
    }

    if (reviewKnowledgeEditModal.type === 'document') {
      setKnowledgeDocumentSummaries((prev) =>
        prev.map((item) =>
          item.id === reviewKnowledgeEditModal.id ? { ...item, title, copy: body } : item,
        ),
      );
    } else {
      setKnowledgeFaqs((prev) =>
        prev.map((item) =>
          item.id === reviewKnowledgeEditModal.id
            ? { ...item, question: title, answer: body }
            : item,
        ),
      );
    }

    setReviewKnowledgeEditModal(null);
    setStepErrors((prev) => ({ ...prev, knowledgeBase: '' }));
    handleAlert({ text: 'Saved.', type: 'success' });
  };

  const handleDuplicateReviewKnowledgeItem = (
    type: ReviewKnowledgeItemType,
    item: KnowledgeDocument | KnowledgeFaq,
  ) => {
    if (isReadOnly) return;
    setOpenReviewKnowledgeMenu('');

    if (type === 'document') {
      const document = item as KnowledgeDocument;
      setKnowledgeDocumentSummaries((prev) => {
        const index = prev.findIndex((current) => current.id === document.id);
        const next = [...prev];
        next.splice(Math.max(index + 1, 0), 0, {
          ...document,
          id: createLocalId('document'),
          title: `${document.title} (copy)`,
          status: 'Just now',
        });
        return next;
      });
    } else {
      const faq = item as KnowledgeFaq;
      setKnowledgeFaqs((prev) => {
        const index = prev.findIndex((current) => current.id === faq.id);
        const next = [...prev];
        next.splice(Math.max(index + 1, 0), 0, {
          ...faq,
          id: createLocalId('faq'),
          question: `${faq.question} (copy)`,
        });
        return next;
      });
    }

    handleAlert({ text: 'Duplicated.', type: 'success' });
  };

  const handleDeleteReviewKnowledgeItem = (
    type: ReviewKnowledgeItemType,
    item: KnowledgeDocument | KnowledgeFaq,
  ) => {
    if (isReadOnly) return;
    setOpenReviewKnowledgeMenu('');

    const label = type === 'faq' ? 'FAQ' : 'document';
    if (!window.confirm(`Delete this ${label}?`)) return;

    if (type === 'document') {
      setKnowledgeDocumentSummaries((prev) => prev.filter((current) => current.id !== item.id));
    } else {
      setKnowledgeFaqs((prev) => prev.filter((current) => current.id !== item.id));
    }
    handleAlert({ text: 'Deleted.', type: 'success' });
  };

  const handleOpenReviewKnowledgeSource = (
    type: ReviewKnowledgeItemType,
    item: KnowledgeDocument | KnowledgeFaq,
  ) => {
    setOpenReviewKnowledgeMenu('');
    setReviewKnowledgeSourceModal(
      type === 'document'
        ? {
            type,
            title: (item as KnowledgeDocument).title,
            body: (item as KnowledgeDocument).copy,
            source: (item as KnowledgeDocument).source,
            status: (item as KnowledgeDocument).status,
          }
        : {
            type,
            title: (item as KnowledgeFaq).question,
            body: (item as KnowledgeFaq).answer,
            source: (item as KnowledgeFaq).source,
            status: 'Just generated',
          },
    );
  };

  const buildPayload = (
    knowledgeOverrides?: Partial<{
      textIds: string[];
      urlIds: string[];
      pdfIds: string[];
      faqTextId: string;
    }>,
  ) => {
    const safeBotName = sanitizeAgentName(botName).trim();
    const safeCompanyBrand = sanitizeAiPlainText(companyBrand).trim();
    const safeWelcomeMessage = sanitizeAiPlainText(welcomeMessage).trim();
    const safeSystemPrompt = sanitizeAiPromptText(systemPrompt).trim();
    const safeRoleUseCase = sanitizeAiPlainText(roleUseCase).trim();
    const safeCustomGreetings = customGreetings.map((value) => sanitizeAiPlainText(value).trim());
    const safeMaxSessionDuration = normalizeBoundedInteger(
      maxSessionDuration,
      1,
      MAX_DURATION_SECONDS,
    );
    const safeIdleReminder = normalizeBoundedInteger(idleReminder, 1, MAX_DURATION_SECONDS);
    const safeIdleReminderRetry = normalizeBoundedInteger(
      idleReminderRetry,
      1,
      MAX_IDLE_REMINDER_RETRIES,
    );
    const canPushToCrm =
      isDataCollectionEnabled && enableCallMonitoring && Boolean(selectedCrmPipeline);
    const textKnowledgeIds = uniqueStrings([
      ...selectedTextKnowledgeIds,
      ...(knowledgeOverrides?.textIds ?? []),
    ]);
    const urlKnowledgeIds = uniqueStrings([
      ...selectedUrlKnowledgeIds,
      ...(knowledgeOverrides?.urlIds ?? []),
    ]);
    const pdfKnowledgeIds = uniqueStrings([
      ...selectedPdfKnowledgeIds,
      ...(knowledgeOverrides?.pdfIds ?? []),
    ]);
    const dataCollectionFields = isDataCollectionEnabled
      ? ensureAlwaysAskedDetails(detailsToCollect)
      : (['name'] as DetailField[]);
    const faqText = formatKnowledgeFaqText(knowledgeFaqs);
    const summaryText = formatKnowledgeSummaryText(knowledgeDocumentSummaries);
    const generatedKnowledgeText = formatGeneratedKnowledgeText(
      knowledgeFaqs,
      knowledgeDocumentSummaries,
    );
    const faqKnowledgeBaseId = generatedKnowledgeText
      ? knowledgeOverrides?.faqTextId || storedFaqKnowledgeBaseId
      : '';

    return {
      ...(isEdit ? { agentId: initialData?.agent_uuid || initialData?.id } : {}),
      ...(isEdit ? { integration_uuid: initialData?.integration_uuid } : {}),
      widgetKey: widgetKeyRef.current,
      agentName: safeBotName,
      agentType: initialData?.agentType || 'chat',
      firstMessage: safeWelcomeMessage,
      systemPrompt: safeSystemPrompt,
      role: safeRoleUseCase,
      greetingType: selectedGreetingType,
      customGreetings: safeCustomGreetings,
      company: safeCompanyBrand,
      widgetBubbleBackground: widgetColors.bubbleBackground,
      widgetBubbleTextColor: widgetColors.bubbleText,
      widgetHeaderColor: widgetColors.headerBackground,
      widgetIconColor: widgetColors.chatIcon,
      widgetLoaderColor: widgetColors.loader,
      widgetSendButtonColor: widgetColors.sendButton,
      language: selectedLanguage,
      agentVoice: initialData?.agentVoice || 'alloy',
      text_uuid: textKnowledgeIds,
      url_uuid: urlKnowledgeIds,
      pdf_uuid: pdfKnowledgeIds,
      site_uuid: selectedLocationId,
      token: '',
      forward_call_actions: {
        ...forwardCallActions,
        greetingType: selectedGreetingType,
        customGreetings: safeCustomGreetings,
        condition: {
          ...(forwardCallActions?.condition || {}),
          operational_hours: formInstance.getValues('settings.operational_hours') || {},
          recording: forwardCallActions?.condition?.recording ?? {
            on_demand: {
              enabled: true,
              recording_on: 'ad98d65d-fcf8-4d4d-bc77-ee1426c34331.mp3',
              recording_Off: 'ad98d65d-fcf8-4d4d-bc77-ee1426c34332.mp3',
            },
            automatic: {
              enabled: true,
              label: 'All',
              value: 'all',
              recording_on: 'ad98d65d-fcf8-4d4d-bc77-ee1426c34333.mp3',
            },
          },
          display_number: forwardCallActions?.condition?.display_number ?? {
            incoming: { label: 'Yes', value: true },
            masking: { type: 'N', value: '', label: 'None' },
            show_number_if_blocked: 'NO',
          },
          caller_id: forwardCallActions?.condition?.caller_id ?? [],
        },
        manager: selectedManagerId || null,
        enableHumanHandoff: enableHumanHandoff,
        enableCallbackScheduling: enableCallbackScheduling,
        handoff: {
          ...(forwardCallActions?.handoff || {}),
          enabled: enableHumanHandoff,
          destination: enableCallbackScheduling ? 'schedule_callback' : 'live_agent_inbox',
          triggers: {
            visitor_asks_human: true,
            after_unhelpful_responses: true,
            unhelpful_response_limit: 3,
            refund_or_cancellation: true,
            outside_business_hours: true,
          },
        },
        call_handling: {
          ...(forwardCallActions?.call_handling || {}),
          business_hours: {
            type: 'QUEUE',
            value: selectedQueueId,
            label: selectedQueueLabel,
          },
        },
        media: forwardCallActions?.media ?? {
          welcome: { enabled: false, value: '' },
          hold: { enabled: false, value: '' },
          voicemail: { enabled: false, value: '' },
        },
        transcription: forwardCallActions?.transcription ?? true,
        ai_call_monitoring: canPushToCrm,
        temperature: TEMPERATURE_MAP[temperature] ?? 'medium',
        maxSessionDuration: safeMaxSessionDuration,
        idleReminder: safeIdleReminder,
        idleReminderRetry: safeIdleReminderRetry,
        data_agent: {
          ...(forwardCallActions?.data_agent || {}),
          data_collection: isDataCollectionEnabled,
          collectAtStart: true,
          data_agent_uuid: forwardCallActions?.data_agent?.data_agent_uuid || '',
          details_to_collect: (() => {
            const obj: Record<string, string> = {};
            dataCollectionFields.forEach((field) => {
              obj[field] = ALWAYS_ASKED_DETAIL_FIELDS.has(field)
                ? 'mandatory'
                : detailsMandatory[field] || 'optional';
            });
            return obj;
          })(),
          crm_sync: canPushToCrm,
          crm: canPushToCrm ? selectedCrmPipeline : '',
        },
        chatbot_builder: {
          version: 1,
          activeStep,
          sourceStage,
          brain: {
            botName: safeBotName,
            companyBrand: safeCompanyBrand,
            roleUseCase: safeRoleUseCase,
            tone,
            language: selectedLanguage,
            welcomeMessage: safeWelcomeMessage,
            systemPrompt: safeSystemPrompt,
            site_uuid: selectedLocationId,
            greetingType: selectedGreetingType,
            customGreetings: safeCustomGreetings,
            widgetColors,
          },
          sources: {
            websiteUrl: scanWebsiteUrl.trim(),
            extraUrl: extraUrl.trim(),
            customContent: customContent.trim(),
            selectedPages: selectedLinks.map((url) => ({ url })),
            pendingUrls,
            pendingTextItems: pendingTextItems.map((item) => ({
              id: item.id,
              title: item.title,
              text: item.text,
            })),
            pendingFiles: pendingFiles.map(({ id, file }) => ({
              id,
              name: file.name,
              size: file.size,
            })),
            selectedKnowledgeBase: {
              text: selectedTextKnowledgeIds,
              url: selectedUrlKnowledgeIds,
              pdf: selectedPdfKnowledgeIds,
            },
          },
          generated: {
            sources: sourceRecords,
            documents: knowledgeDocumentSummaries,
            documentSourceKey: knowledgeSummaryRequestKey,
            faqs: knowledgeFaqs,
            faqText,
            summaryText,
            generatedKnowledgeText,
            faqSourceKey: knowledgeSummaryRequestKey,
            faqKnowledgeBaseId,
            summary: {
              documents: knowledgeDocumentSummaries.length,
              faqs: knowledgeFaqs.length,
              sources: sourceRecords.length,
            },
          },
          handoff: {
            enabled: enableHumanHandoff,
            destination: enableCallbackScheduling ? 'schedule_callback' : 'live_agent_inbox',
            triggers: {
              visitor_asks_human: true,
              after_unhelpful_responses: true,
              unhelpful_response_limit: 3,
              refund_or_cancellation: true,
              outside_business_hours: true,
            },
            collectDetails: isDataCollectionEnabled,
          },
          advanced: {
            temperature,
            maxSessionDuration: safeMaxSessionDuration,
            idleReminder: safeIdleReminder,
            idleReminderRetry: safeIdleReminderRetry,
            greetingType: selectedGreetingType,
            customGreetings: safeCustomGreetings,
            isDataCollectionEnabled,
            detailsToCollect: dataCollectionFields,
            detailsMandatory,
            enableCallMonitoring: canPushToCrm,
            selectedCrmPipeline,
          },
        },
      },
    };
  };

  const handleFinish = async () => {
    if (isReadOnly || isKnowledgeSummaryNavigationLocked) return;

    const mergedErrors = { ...validateStep(1), ...validateStep(2), ...validateStep(6) };
    if (Object.keys(mergedErrors).length) {
      setStepErrors(mergedErrors);
      if (
        mergedErrors.botName ||
        mergedErrors.companyBrand ||
        mergedErrors.welcomeMessage ||
        mergedErrors.systemPrompt ||
        mergedErrors.siteLocation
      ) {
        setActiveStep(1);
      } else if (mergedErrors.queue || mergedErrors.manager) {
        setActiveStep(6);
      } else {
        setActiveStep(2);
      }
      scrollToFirstValidationError(mergedErrors);
      return;
    }

    try {
      const hasKnowledgeFaqText = Boolean(formatKnowledgeFaqText(knowledgeFaqs));
      const hasKnowledgeSummaryText = Boolean(
        formatKnowledgeSummaryText(knowledgeDocumentSummaries),
      );
      const generatedKnowledgeText = formatGeneratedKnowledgeText(
        knowledgeFaqs,
        knowledgeDocumentSummaries,
      );
      const canReuseGeneratedKnowledge =
        isEdit &&
        !selectedReusableAgentId &&
        !pendingFiles.length &&
        Boolean(storedFaqKnowledgeBaseId) &&
        Boolean(generatedKnowledgeText) &&
        isSameGeneratedKnowledgeText(generatedKnowledgeText, storedFaqText);
      const hasPendingKnowledge =
        hasKnowledgeFaqText ||
        hasKnowledgeSummaryText ||
        selectedLinks.length > 0 ||
        pendingUrls.length > 0 ||
        pendingTextItems.length > 0 ||
        pendingFiles.length > 0;
      const shouldCreateKnowledgeSources =
        hasPendingKnowledge &&
        !canReuseGeneratedKnowledge &&
        !(hasOnlyExistingKnowledgeBaseSelection && !selectedReusableAgentId);

      setIsCreatingKnowledgeSources(shouldCreateKnowledgeSources);
      const createdKnowledgeIds = hasPendingKnowledge
        ? await createPendingKnowledgeSources()
        : { text: [], url: [], pdf: [] };
      const payload = buildPayload({
        textIds: createdKnowledgeIds.text,
        urlIds: createdKnowledgeIds.url,
        pdfIds: createdKnowledgeIds.pdf,
      });
      if (!isEdit) {
        (payload as any).status = 'active';
      }
      payload.token = '';
      await submitAgent(payload);
    } catch (error) {
      console.error('Failed to prepare AI Agent:', error);
      handleAlert({ text: 'Failed to prepare AI Agent. Please try again.', type: 'error' });
    } finally {
      setIsCreatingKnowledgeSources(false);
    }
  };

  const renderStep = () => {
    if (activeStep === 1) {
      return (
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3 px-7">
          <SectionHeading
            title={stepTitle}
            subtitle="Who is the bot, what does it sound like, what should it talk about?"
          />

          {isEdit && !isReadOnly && (
            <div className="flex justify-end">
              <SecondaryButton
                onClick={() => {
                  setStepErrors({});
                  setActiveStep(2);
                  setSourceStage(3);
                  setEditTab('review');
                }}
              >
                <Plus className="h-4 w-4" />
                Manage custom FAQs
              </SecondaryButton>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-950">Identity</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Bot name *" error={stepErrors.botName} fieldKey="botName">
                <input
                  value={botName}
                  onChange={(event) => {
                    setBotName(sanitizeAgentName(event.target.value));
                    setStepErrors((prev) => ({ ...prev, botName: '' }));
                  }}
                  maxLength={MAX_AGENT_NAME_LENGTH}
                  readOnly={isReadOnly}
                  disabled={isReadOnly}
                  placeholder="e.g. Aria"
                  className={cx(
                    'h-9 w-full rounded-md border px-3 text-sm outline-none focus:border-primary',
                    stepErrors.botName ? 'border-red-400' : 'border-gray-300',
                    isReadOnly && 'cursor-not-allowed bg-gray-50 text-slate-600',
                  )}
                />
                <div className="mt-1 flex min-h-4 items-center justify-between gap-2 text-[11px]">
                  <span
                    className={
                      botName.length === MAX_AGENT_NAME_LENGTH ? 'text-amber-600' : 'text-slate-400'
                    }
                  >
                    {botName.length === MAX_AGENT_NAME_LENGTH
                      ? 'Maximum name length reached.'
                      : 'Letters, numbers, and spaces only.'}
                  </span>
                  <span
                    className={
                      botName.length === MAX_AGENT_NAME_LENGTH
                        ? 'font-semibold text-amber-600'
                        : 'text-slate-400'
                    }
                  >
                    {botName.length}/{MAX_AGENT_NAME_LENGTH}
                  </span>
                </div>
              </Field>
              <Field
                label="Company / Brand *"
                error={stepErrors.companyBrand}
                fieldKey="companyBrand"
              >
                <input
                  value={companyBrand}
                  onChange={(event) => {
                    setCompanyBrand(sanitizeAiPlainText(event.target.value));
                    setStepErrors((prev) => ({ ...prev, companyBrand: '' }));
                  }}
                  readOnly={isReadOnly}
                  disabled={isReadOnly}
                  placeholder="e.g. Example Business"
                  className={cx(
                    'h-9 w-full rounded-md border px-3 text-sm outline-none focus:border-primary',
                    stepErrors.companyBrand ? 'border-red-400' : 'border-gray-300',
                    isReadOnly && 'cursor-not-allowed bg-gray-50 text-slate-600',
                  )}
                />
              </Field>
              <Field label="Primary language">
                <Picker
                  label="Primary language"
                  showLabel={false}
                  className="mcm-field"
                  disabled={isReadOnly}
                  value={selectedLanguage}
                  options={languageChoices.map((language) => ({
                    label: String(language.label),
                    value: String(language.value),
                  }))}
                  onChange={(option) => setSelectedLanguage(option.value)}
                />
              </Field>
              <Field label="Role / use case">
                <Picker
                  label="Role / use case"
                  showLabel={false}
                  className="mcm-field"
                  disabled={isReadOnly || isLoadingUseCaseTemplates}
                  placeholder={
                    isLoadingUseCaseTemplates ? 'Loading templates…' : 'Select a template'
                  }
                  value={roleUseCase}
                  options={useCaseTemplateOptions.map((option) => ({
                    label: option.name,
                    value: option.name,
                  }))}
                  onChange={(picked) => {
                    const nextUseCase = picked.value;
                    const selectedTemplate = useCaseTemplateOptions.find(
                      (option) => option.name === nextUseCase,
                    );
                    setRoleUseCase(nextUseCase);
                    if (selectedTemplate?.welcomeGreeting) {
                      setWelcomeMessage(sanitizeAiPlainText(selectedTemplate.welcomeGreeting));
                      setSelectedGreetingType('custom');
                      setStepErrors((prev) => ({ ...prev, welcomeMessage: '' }));
                    }
                    setSystemPrompt(
                      selectedTemplate?.systemPrompt
                        ? sanitizeAiPromptText(selectedTemplate.systemPrompt)
                        : '',
                    );
                    setStepErrors((prev) => ({ ...prev, systemPrompt: '' }));
                  }}
                />
              </Field>
            </div>
          </div>

          <AgentSiteSelection
            sites={sites}
            selectedSiteId={selectedLocationId}
            onChange={(siteId) => {
              setSelectedLocationId(siteId);
              setStepErrors((prev) => ({ ...prev, siteLocation: '' }));
            }}
            error={stepErrors.siteLocation}
            disabled={isReadOnly}
            isLoading={isLoadingSites}
          />

          <div
            className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
            data-validation-key="welcomeMessage"
          >
            <h3 className="text-sm font-semibold text-gray-950">Greeting line *</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              The first thing every visitor sees when they open the widget.
            </p>
            <textarea
              value={welcomeMessage}
              onChange={(event) => {
                setWelcomeMessage(sanitizeAiPlainText(event.target.value));
                setStepErrors((prev) => ({ ...prev, welcomeMessage: '' }));
                setSelectedGreetingType('custom');
              }}
              readOnly={isReadOnly}
              disabled={isReadOnly}
              className={cx(
                'mt-4 min-h-[84px] w-full resize-y rounded-md border p-3 text-sm outline-none focus:border-primary',
                stepErrors.welcomeMessage ? 'border-red-400' : 'border-gray-300',
                isReadOnly && 'cursor-not-allowed bg-gray-50 text-slate-600',
              )}
            />
            {stepErrors.welcomeMessage && (
              <p className="mt-1 text-xs font-medium text-red-500">{stepErrors.welcomeMessage}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="flex items-center gap-1 text-slate-500 font-medium mr-1">
                <Sparkles className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                Try:
              </span>
              <button
                type="button"
                onClick={() => handleSelectGreetingType('friendly')}
                disabled={isReadOnly}
                className={cx(
                  'h-8 px-3 rounded-full border text-xs font-semibold cursor-pointer transition-colors',
                  selectedGreetingType === 'friendly' &&
                    welcomeMessage === getGreetingText('friendly', companyBrand)
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-gray-200 bg-white text-slate-600 hover:border-gray-300',
                  isReadOnly && 'cursor-not-allowed opacity-70',
                )}
              >
                Friendly greeting
              </button>
              <button
                type="button"
                onClick={() => handleSelectGreetingType('professional')}
                disabled={isReadOnly}
                className={cx(
                  'h-8 px-3 rounded-full border text-xs font-semibold cursor-pointer transition-colors',
                  selectedGreetingType === 'professional' &&
                    welcomeMessage === getGreetingText('professional', companyBrand)
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-gray-200 bg-white text-slate-600 hover:border-gray-300',
                  isReadOnly && 'cursor-not-allowed opacity-70',
                )}
              >
                Professional intro
              </button>
              <button
                type="button"
                onClick={() => handleSelectGreetingType('triage')}
                disabled={isReadOnly}
                className={cx(
                  'h-8 px-3 rounded-full border text-xs font-semibold cursor-pointer transition-colors',
                  selectedGreetingType === 'triage' &&
                    welcomeMessage === getGreetingText('triage', companyBrand)
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-gray-200 bg-white text-slate-600 hover:border-gray-300',
                  isReadOnly && 'cursor-not-allowed opacity-70',
                )}
              >
                Quick triage
              </button>
              <button
                type="button"
                onClick={() => handleSelectGreetingType('promo')}
                disabled={isReadOnly}
                className={cx(
                  'h-8 px-3 rounded-full border text-xs font-semibold cursor-pointer transition-colors',
                  selectedGreetingType === 'promo' &&
                    welcomeMessage === getGreetingText('promo', companyBrand)
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-gray-200 bg-white text-slate-600 hover:border-gray-300',
                  isReadOnly && 'cursor-not-allowed opacity-70',
                )}
              >
                Promo / offer
              </button>
              {customGreetings.map((text, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setWelcomeMessage(text);
                    setSelectedGreetingType('custom');
                    setStepErrors((prev) => ({ ...prev, welcomeMessage: '' }));
                  }}
                  disabled={isReadOnly}
                  className={cx(
                    'h-8 px-3 rounded-full border text-xs font-semibold cursor-pointer transition-colors',
                    welcomeMessage === text
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-gray-200 bg-white text-slate-600 hover:border-gray-300',
                    isReadOnly && 'cursor-not-allowed opacity-70',
                  )}
                >
                  Custom {idx + 1}
                </button>
              ))}
              {/* {!isReadOnly && (
                <button
                  type="button"
                  onClick={handleSaveAsCustomGreeting}
                  className="h-8 px-3 rounded-full border border-dashed border-primary/40 bg-white text-xs font-semibold text-primary hover:bg-primary/5 transition-colors cursor-pointer"
                >
                  + Save current as Custom
                </button>
              )} */}
            </div>
          </div>

          <div
            className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
            data-validation-key="systemPrompt"
          >
            <h3 className="text-sm font-semibold text-gray-950">System prompt</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Master instruction. Tell the bot who it is and what rules to follow.
            </p>
            <textarea
              value={systemPrompt}
              onChange={(event) => {
                setSystemPrompt(sanitizeAiPromptText(event.target.value));
                setStepErrors((prev) => ({ ...prev, systemPrompt: '' }));
              }}
              readOnly={isReadOnly}
              disabled={isReadOnly}
              className={cx(
                'mt-4 min-h-[130px] w-full resize-y rounded-md border p-3 text-sm outline-none focus:border-primary',
                stepErrors.systemPrompt ? 'border-red-400' : 'border-gray-300',
                isReadOnly && 'cursor-not-allowed bg-gray-50 text-slate-600',
              )}
            />
            {stepErrors.systemPrompt && (
              <p className="mt-1 text-xs font-medium text-red-500">{stepErrors.systemPrompt}</p>
            )}
          </div>

          {!isReadOnly && (
            <div className="flex items-center justify-between pt-2">
              <SecondaryButton
                onClick={() => requestWizardLeave('/admin-settings/knowledge/ai-agent')}
              >
                Cancel
              </SecondaryButton>
              <PrimaryButton onClick={() => void handleStepperChange(2, 1)}>Continue</PrimaryButton>
            </div>
          )}
        </div>
      );
    }

    if (activeStep === 2) {
      if (sourceStage === 3) {
        return renderSummaryStep(isReadOnly);
      }
      return (
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-7">
          <SectionHeading
            title={stepTitle}
            subtitle={
              sourceStage === 1
                ? 'Pick an existing knowledge base, or create a new one by scanning your website. AI turns pages and documents into Documents & FAQs.'
                : 'Choose which pages to use and add any custom content the bot should know.'
            }
          />
          {renderKnowledgeBaseStep()}
        </div>
      );
    }

    if (activeStep === 6) {
      return renderHandoffStep();
    }

    if (activeStep === 7) {
      return renderAdvancedStep();
    }

    return renderHandoffStep();
  };

  const renderKnowledgeBaseStep = () => {
    if (sourceStage === 1) {
      if (knowledgeWebsiteMode === 'picker') {
        return (
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-4 rounded-xl bg-gradient-to-r from-[#2947c9] to-[#2f7df2] px-6 py-5 text-white shadow-sm">
              <div className="flex min-w-0 items-center gap-4">
                <div className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-xl bg-white/15">
                  <FileText className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold">Create new knowledge base</h3>
                  <p className="mt-1 text-sm leading-5 text-white/85">
                    Scan a website, pick pages, upload docs — AI does the rest.
                  </p>
                </div>
              </div>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={async () => {
                    await cleanupKnowledgeReviewWorkspace();
                    clearKnowledgeReviewPollTimeout();
                    knowledgeReviewRequestKeyRef.current = '';
                    knowledgeReviewJobIdRef.current = '';
                    knowledgeReviewSessionIdRef.current = createLocalId('knowledge-review');
                    setSelectedReusableAgentId('');
                    setSelectedTextKnowledgeIds([]);
                    setSelectedUrlKnowledgeIds([]);
                    setSelectedPdfKnowledgeIds([]);
                    setKnowledgeDocumentSummaries([]);
                    setKnowledgeFaqs([]);
                    setKnowledgeSummaryError('');
                    setKnowledgeFaqError('');
                    setStepErrors((prev) => ({ ...prev, knowledgeBase: '' }));
                    setKnowledgeWebsiteMode('scan');
                  }}
                  className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-white px-5 text-sm font-bold text-primary shadow-sm transition hover:bg-white/95"
                >
                  Start
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
              <span className="h-px flex-1 bg-gray-200" />
              <span>Or pick an existing one</span>
              <span className="h-px flex-1 bg-gray-200" />
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="px-5 py-4">
                <h3 className="text-lg font-bold text-gray-950">Pick a knowledge base</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Search your existing knowledge bases or create a new one from a website.
                </p>
                <div className="relative mt-4">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={knowledgeBaseSearch}
                    onChange={(event) =>
                      setKnowledgeBaseSearch(sanitizeAiSearchText(event.target.value))
                    }
                    disabled={isReadOnly}
                    placeholder="Search knowledge bases..."
                    className="h-11 w-full rounded-lg border border-gray-200 bg-white pl-11 pr-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-gray-50"
                  />
                </div>
              </div>
              <div className="divide-y divide-gray-100 border-t border-gray-100">
                {isFetchingReusableKnowledgeAgents ? (
                  <div className="flex items-center gap-2 px-5 py-5 text-sm font-medium text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading agents...
                  </div>
                ) : filteredKnowledgeBaseRows.length ? (
                  filteredKnowledgeBaseRows.map((agent) => {
                    const checked = selectedReusableAgentId === agent.id;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => handleSelectReusableKnowledgeAgent(agent)}
                        className={cx(
                          'flex w-full items-center gap-4 px-5 py-4 text-left transition-colors',
                          checked ? 'bg-primary/[0.04]' : 'bg-white',
                          isReadOnly ? 'cursor-default' : 'hover:bg-slate-50',
                        )}
                      >
                        <span
                          className={cx(
                            'grid h-5 w-5 shrink-0 place-items-center rounded-full border',
                            checked ? 'border-primary' : 'border-slate-300',
                          )}
                        >
                          {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-gray-950">
                            {agent.name}
                          </span>
                          <span className="mt-1 block truncate text-sm text-slate-500">
                            {agent.meta}
                          </span>
                        </span>
                        <span
                          className={cx(
                            'shrink-0 rounded-md px-2.5 py-1 text-xs font-bold uppercase',
                            agent.channel === 'chat'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-emerald-100 text-emerald-700',
                          )}
                        >
                          {agent.channel === 'chat' ? 'Chat' : 'Voice'}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-5 py-5 text-sm text-slate-500">No created agents found.</div>
                )}
              </div>
            </div>

            {stepErrors.knowledgeBase && (
              <p className="text-sm font-medium text-red-500">{stepErrors.knowledgeBase}</p>
            )}

            {!isReadOnly && (
              <div className="mt-1 flex items-center justify-between">
                <SecondaryButton onClick={() => void handleStepperChange(1, 1)}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </SecondaryButton>
              </div>
            )}
          </div>
        );
      }

      return (
        <div className="flex flex-col gap-4">
          <div className="mx-auto mt-2 w-full max-w-[540px] rounded-xl border border-gray-200 bg-white px-7 py-9 text-center shadow-sm">
            <div className="mx-auto mb-3 grid h-[52px] w-[52px] place-items-center rounded-xl bg-primary/10 text-primary">
              <Globe2 className="h-[26px] w-[26px]" />
            </div>
            <h3 className="text-lg font-bold text-gray-950">What's your website?</h3>
            <p className="mx-auto mt-1 max-w-[420px] text-[13px] leading-5 text-slate-500">
              We'll scan it and group your Product, Service, and Contact pages — you pick what to
              use.
            </p>

            <div className="mx-auto mt-4 w-full max-w-[420px]">
              <input
                value={scanWebsiteUrl}
                onChange={(event) => {
                  setScanWebsiteUrl(event.target.value);
                  setStepErrors((prev) => ({ ...prev, websiteUrl: '' }));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleContinueFromWebsite();
                  }
                }}
                readOnly={isReadOnly}
                disabled={isReadOnly}
                placeholder="https://yourcompany.com"
                className={cx(
                  'w-full rounded-lg border px-3.5 py-[11px] text-[13px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-gray-50',
                  stepErrors.websiteUrl ? 'border-red-400' : 'border-gray-200',
                )}
              />
            </div>
            {stepErrors.websiteUrl && (
              <p className="mt-2 text-xs font-medium text-red-500">{stepErrors.websiteUrl}</p>
            )}
            {discoveredLinks.length > 0 && (
              <p className="mt-3 text-xs font-semibold text-emerald-600">
                {discoveredLinks.length.toLocaleString()} pages found. Continue to pick the pages to
                use.
              </p>
            )}
            {!isReadOnly && (
              <button
                type="button"
                onClick={handleUseManualKnowledgeMode}
                className="mt-3 text-xs font-semibold text-slate-500 underline underline-offset-2 hover:text-primary"
              >
                I'll add pages manually
              </button>
            )}
          </div>

          {!isReadOnly && (
            <div className="mt-2 flex items-center justify-between">
              <SecondaryButton onClick={() => setKnowledgeWebsiteMode('picker')}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </SecondaryButton>
              <PrimaryButton onClick={handleContinueFromWebsite} disabled={isCrawlingSite}>
                {isCrawlingSite ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Scanning
                  </>
                ) : (
                  <>
                    Continue to Pick pages
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </PrimaryButton>
            </div>
          )}
        </div>
      );
    }

    const togglePickPageLink = (link: string, checked: boolean) => {
      if (isReadOnly) return;

      setSelectedLinks((prev) => {
        if (checked) return uniqueStrings([...prev, link]);
        return prev.filter((item) => item !== link);
      });
      setStepErrors((prev) => ({ ...prev, knowledgeBase: '' }));
    };
    const scannedDomain = formatAgentDomain(initialData, scanWebsiteUrl) || 'your site';
    const pickPageCategories = buildPickPageCategories(discoveredLinks);

    return (
      <div className="flex flex-col gap-[14px]">
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
          {discoveredLinks.length > 0 ? (
            <>
              <Check className="h-4 w-4 shrink-0 stroke-[3]" />
              <span>
                Found {discoveredLinks.length.toLocaleString()} pages on {scannedDomain}. Picked the
                most useful ones below.
              </span>
            </>
          ) : (
            <>
              <Info className="h-4 w-4 shrink-0" />
              <span>
                Manual mode — add content and documents below. The chatbot will use these as its
                only knowledge base.
              </span>
            </>
          )}
        </div>

        {discoveredLinks.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {pickPageCategories.map((category, index) => (
              <div
                key={category.id}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white"
              >
                <div className="flex items-center gap-2.5 border-b border-gray-200 bg-slate-50 px-3.5 py-3">
                  <div
                    className={cx(
                      'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-xl',
                      getPickPageCategoryIconClassName(index),
                    )}
                  >
                    {category.stripLeadingSegments ? (
                      <Folder className="h-4 w-4" />
                    ) : (
                      <Globe2 className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-gray-950">{category.title}</h4>
                    <p className="mt-0.5 text-xs text-slate-500">{category.subtitle}</p>
                  </div>
                </div>
                <div className="max-h-[320px] overflow-y-auto bg-white">
                  {category.links.map((link) => {
                    const selected = selectedLinks.includes(link);
                    return (
                      <label
                        key={link}
                        className={cx(
                          'flex min-h-[34px] items-center gap-2.5 border-b border-gray-100 px-3.5 py-2 transition-colors last:border-b-0',
                          selected ? 'bg-primary/[0.04]' : 'bg-white',
                          isReadOnly ? 'cursor-default' : 'cursor-pointer hover:bg-slate-50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={isReadOnly}
                          onChange={(event) => togglePickPageLink(link, event.target.checked)}
                          className="h-[15px] w-[15px] rounded border-gray-300 text-primary focus:ring-primary disabled:cursor-not-allowed"
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-900">
                          {getPickPageRowLabel(link, category.stripLeadingSegments)}
                        </span>
                        <span
                          title={normalizeUrl(link)}
                          className="max-w-[420px] shrink truncate text-[11px] text-slate-500"
                        >
                          {getPickPageRowPath(link)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          {discoveredLinks.length > 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-3.5">
              <p className="text-sm font-bold text-gray-950">Add another URL</p>
              <p className="mt-1 text-xs text-slate-500">Paste any page not auto-detected.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={extraUrl}
                  onChange={(event) => {
                    setExtraUrl(event.target.value);
                    setStepErrors((prev) => ({ ...prev, extraUrl: '' }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleAddExtraUrl();
                    }
                  }}
                  readOnly={isReadOnly}
                  disabled={isReadOnly}
                  placeholder="https://yourcompany.com/page"
                  className={cx(
                    'h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-gray-50',
                    stepErrors.extraUrl ? 'border-red-400' : 'border-gray-200',
                  )}
                />
                {!isReadOnly && (
                  <PrimaryButton onClick={handleAddExtraUrl}>
                    <Plus className="h-4 w-4" />
                    Add
                  </PrimaryButton>
                )}
              </div>
              {stepErrors.extraUrl && (
                <p className="mt-2 text-sm text-red-500">{stepErrors.extraUrl}</p>
              )}
              {pendingUrls.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {pendingUrls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs"
                    >
                      <span className="min-w-0 truncate text-slate-600">{url}</span>
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => handleRemovePendingUrl(url)}
                          className="shrink-0 text-slate-400 hover:text-red-500"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white p-[22px] shadow-sm">
            <div className="mb-3.5">
              <h3 className="text-sm font-bold text-gray-950">Add content</h3>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                Type or paste the facts, policies, and answers your chatbot should know — pricing,
                hours, addresses, refund rules, FAQs, anything. Write it in plain language; the AI
                turns it into searchable knowledge. A blank line between topics helps keep things
                organized.
              </p>
            </div>
            <textarea
              value={customContent}
              onChange={(event) => setCustomContent(event.target.value)}
              readOnly={isReadOnly}
              disabled={isReadOnly}
              placeholder={`Type or paste anything your chatbot should know — write naturally, the AI organizes it into searchable answers.\n\nEXAMPLE\nBusiness hours: Monday-Friday, 9:00 AM to 6:00 PM EST. Closed weekends and US public holidays.\nPricing: Growth plan starts at $12 per user / month. Pro is $24 per user / month. Enterprise is custom-quoted - offer to connect the visitor with sales.\nOffice address: 123 Market Street, Suite 400, San Francisco, CA 94105.\nRefund policy: Full refund within 30 days of purchase. No refunds after 30 days.\nSupport contact: support@example.com or +1 (800) 555-0199.`}
              className="min-h-[220px] w-full resize-y rounded-lg border border-gray-200 p-3 text-sm leading-6 text-gray-800 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-gray-50"
            />
            <p className="mt-1 text-right text-[11px] font-medium text-slate-500">
              {customContentWordCount} {customContentWordCount === 1 ? 'word' : 'words'}
            </p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-1.5 text-[11px] leading-4 text-slate-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                Tip: one topic per paragraph. Include exact numbers, dates, and policies so the
                chatbot answers precisely instead of guessing.
              </p>
              {!isReadOnly && (
                <PrimaryButton onClick={handleAddCustomContent} disabled={!customContent.trim()}>
                  <Plus className="h-4 w-4" />
                  Add this content
                </PrimaryButton>
              )}
            </div>
            {pendingTextItems.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {pendingTextItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">{item.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-slate-500">{item.text}</p>
                    </div>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => handleRemovePendingText(item.id)}
                        className="shrink-0 text-slate-400 hover:text-red-500"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <input
              ref={pendingFileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              onChange={(event) => {
                handlePendingFilesSelected(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />
            {/*
            <button
              type="button"
              onClick={() => pendingFileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                handlePendingFilesSelected(event.dataTransfer.files);
              }}
              disabled={isReadOnly || pendingFiles.length >= 5}
              className="flex min-h-[96px] w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-5 py-5 text-center transition-colors hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2 text-sm font-bold text-gray-950">
                <UploadCloud className="h-5 w-5 text-slate-500" />
                Add documents to the knowledge base
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Drag & drop or click to browse · PDF up to 25 MB each
              </span>
            </button>
            */}
            {pendingFiles.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {pendingFiles.map(({ id, file }) => (
                  <div
                    key={id}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    <div className="grid h-7 w-7 shrink-0 place-items-center rounded bg-red-50 text-[10px] font-bold text-red-700">
                      PDF
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-gray-950">{file.name}</p>
                      <p className="text-xs text-slate-500">{formatFileSize(file.size)}</p>
                    </div>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => handleRemovePendingFile(id)}
                        className="shrink-0 p-1 text-slate-400 hover:text-red-500"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {stepErrors.knowledgeBase && (
          <p className="text-sm font-medium text-red-500">{stepErrors.knowledgeBase}</p>
        )}

        {!isReadOnly && (
          <div className="mt-2 flex items-center justify-between">
            <SecondaryButton onClick={() => void handleStepperChange(2, 1)}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </SecondaryButton>
            <PrimaryButton onClick={handleContinueFromKnowledgeBase}>
              Continue to Review
              <ArrowRight className="h-4 w-4" />
            </PrimaryButton>
          </div>
        )}
      </div>
    );
  };

  const renderReviewKnowledgeMenu = (
    type: ReviewKnowledgeItemType,
    item: KnowledgeDocument | KnowledgeFaq,
  ) => {
    if (isReadOnly) return null;

    const menuKey = `${type}-${item.id}`;
    const isOpen = openReviewKnowledgeMenu === menuKey;

    return (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpenReviewKnowledgeMenu(isOpen ? '' : menuKey);
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-xl text-lg leading-none text-slate-500 transition-colors hover:bg-slate-100 hover:text-gray-950"
          aria-label="Knowledge card actions"
        >
          ⋮
        </button>
        {isOpen && (
          <div className="absolute right-0 top-7 z-30 min-w-[170px] rounded-lg border border-gray-200 bg-white p-1.5 shadow-[0_6px_18px_rgba(0,0,0,0.08)]">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleOpenReviewKnowledgeSource(type, item);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-slate-800 hover:bg-slate-50"
            >
              📄 View Source Document
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleOpenReviewKnowledgeEdit(type, item);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-slate-800 hover:bg-slate-50"
            >
              ✎ Edit
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleDuplicateReviewKnowledgeItem(type, item);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-slate-800 hover:bg-slate-50"
            >
              ⎘ Duplicate
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleDeleteReviewKnowledgeItem(type, item);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-red-600 hover:bg-red-50"
            >
              🗑 Delete
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderReviewKnowledgeModals = () => {
    const sourcePath = reviewKnowledgeSourceModal?.source.trim() || 'Manual';
    const sourceHref =
      sourcePath && /^https?:\/\//i.test(sourcePath)
        ? sourcePath
        : sourcePath.includes('.') && !sourcePath.includes(' ')
          ? `https://${sourcePath.replace(/^\//, '')}`
          : '';

    return (
      <>
        {reviewKnowledgeSourceModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 px-3 py-6">
            <div className="max-h-[calc(100vh-48px)] w-full max-w-[620px] overflow-y-auto rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <h3 className="text-base font-bold text-gray-950">
                  {reviewKnowledgeSourceModal.type === 'faq'
                    ? '💬 Source for this FAQ'
                    : '📄 Source Document'}
                </h3>
                <button
                  type="button"
                  onClick={() => setReviewKnowledgeSourceModal(null)}
                  className="text-slate-400 hover:text-gray-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5">
                <div className="mb-3 grid gap-1.5 rounded-lg bg-slate-50 px-3.5 py-3 text-xs">
                  <div className="flex gap-3">
                    <span className="min-w-[120px] font-semibold text-slate-600">Title</span>
                    <span className="font-semibold text-gray-950">
                      {reviewKnowledgeSourceModal.title}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="min-w-[120px] font-semibold text-slate-600">Source</span>
                    <span className="min-w-0 break-all text-gray-950">{sourcePath}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="min-w-[120px] font-semibold text-slate-600">Imported</span>
                    <span className="text-gray-950">
                      {reviewKnowledgeSourceModal.status || 'Just now'}
                    </span>
                  </div>
                </div>
                <div className="max-h-[320px] overflow-y-auto rounded-lg border border-gray-200 bg-white px-4 py-3 text-[13px] leading-[1.65] text-slate-700">
                  {reviewKnowledgeSourceModal.body ? (
                    <p className="whitespace-pre-line">{reviewKnowledgeSourceModal.body}</p>
                  ) : (
                    <p className="text-slate-500">No content preview available.</p>
                  )}
                  <div className="mt-3 rounded-md border-l-[3px] border-primary bg-primary/5 px-3 py-2 text-xs leading-5 text-slate-700">
                    <b className="text-gray-950">Full summarized content shown above.</b> This is
                    the content the chatbot uses to answer related questions. To revise wording, use
                    Edit on the card.
                  </div>
                  {sourceHref && (
                    <div className="mt-2 text-right text-[13px] font-semibold">
                      <a
                        href={sourceHref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        🔗 Read more from the original source →
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {reviewKnowledgeEditModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 px-3 py-6">
            <div className="w-full max-w-[540px] rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <h3 className="text-base font-bold text-gray-950">
                  {reviewKnowledgeEditModal.type === 'faq' ? 'Edit FAQ' : 'Edit document'}
                </h3>
                <button
                  type="button"
                  onClick={() => setReviewKnowledgeEditModal(null)}
                  className="text-slate-400 hover:text-gray-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5">
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  {reviewKnowledgeEditModal.type === 'faq' ? 'Question' : 'Document title'}
                </label>
                <input
                  value={reviewKnowledgeEditModal.title}
                  onChange={(event) =>
                    setReviewKnowledgeEditModal((prev) =>
                      prev ? { ...prev, title: event.target.value } : prev,
                    )
                  }
                  className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-primary"
                />
                <label className="mb-1.5 mt-3 block text-xs font-semibold text-slate-700">
                  {reviewKnowledgeEditModal.type === 'faq' ? 'Answer' : 'Document content'}
                </label>
                <textarea
                  value={reviewKnowledgeEditModal.body}
                  onChange={(event) =>
                    setReviewKnowledgeEditModal((prev) =>
                      prev ? { ...prev, body: event.target.value } : prev,
                    )
                  }
                  className="min-h-[150px] w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
                <SecondaryButton onClick={() => setReviewKnowledgeEditModal(null)}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton onClick={handleConfirmReviewKnowledgeEdit}>
                  Save changes
                </PrimaryButton>
              </div>
            </div>
          </div>
        )}

        {reviewKnowledgeAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 px-3 py-6">
            <div className="w-full max-w-[540px] rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <h3 className="text-base font-bold text-gray-950">
                  {reviewKnowledgeAddModal.type === 'faq' ? 'Add FAQ' : 'Add document'}
                </h3>
                <button
                  type="button"
                  onClick={() => setReviewKnowledgeAddModal(null)}
                  className="text-slate-400 hover:text-gray-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5">
                <div className="mb-3.5 flex gap-1.5 border-b border-gray-100 pb-2.5">
                  {[
                    { value: 'text' as const, label: 'Paste text' },
                    // { value: 'upload' as const, label: 'Upload file' },
                  ].map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() =>
                        setReviewKnowledgeAddModal((prev) =>
                          prev ? { ...prev, mode: mode.value } : prev,
                        )
                      }
                      className={cx(
                        'flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
                        reviewKnowledgeAddModal.mode === mode.value
                          ? 'border-primary bg-primary text-white'
                          : 'border-gray-200 bg-slate-50 text-slate-700 hover:border-primary hover:text-primary',
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {reviewKnowledgeAddModal.mode === 'text' ? (
                  <>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                      {reviewKnowledgeAddModal.type === 'faq' ? 'Question' : 'Document title'}
                    </label>
                    <input
                      value={reviewKnowledgeAddModal.title}
                      onChange={(event) =>
                        setReviewKnowledgeAddModal((prev) =>
                          prev ? { ...prev, title: event.target.value } : prev,
                        )
                      }
                      placeholder={
                        reviewKnowledgeAddModal.type === 'faq'
                          ? 'e.g. How much does it cost?'
                          : 'e.g. Refund policy'
                      }
                      className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-primary"
                    />
                    <label className="mb-1.5 mt-3 block text-xs font-semibold text-slate-700">
                      {reviewKnowledgeAddModal.type === 'faq' ? 'Answer' : 'Document content'}
                    </label>
                    <textarea
                      value={reviewKnowledgeAddModal.body}
                      onChange={(event) =>
                        setReviewKnowledgeAddModal((prev) =>
                          prev ? { ...prev, body: event.target.value } : prev,
                        )
                      }
                      placeholder={
                        reviewKnowledgeAddModal.type === 'faq'
                          ? 'Type the answer the chatbot should give. Short, conversational answers work best.'
                          : 'Type or paste the content the chatbot should learn from. Short, factual paragraphs work best.'
                      }
                      className="min-h-[150px] w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
                    />
                  </>
                ) : (
                  <>
                    <input
                      ref={reviewKnowledgeFileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(event) => {
                        handleReviewKnowledgeAddFilePicked(event.currentTarget.files?.[0] || null);
                        event.currentTarget.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => reviewKnowledgeFileInputRef.current?.click()}
                      className="w-full rounded-xl border-2 border-dashed border-gray-200 px-7 py-7 text-center text-sm text-slate-600 transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      <UploadCloud className="mx-auto mb-2 h-8 w-8 text-slate-500" />
                      <b className="text-gray-950">Choose a file</b>
                      <span className="mt-1 block text-xs text-slate-500">
                        Upload a document to add it to this knowledge base.
                      </span>
                    </button>
                    {reviewKnowledgeAddModal.file && (
                      <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2">
                        <div className="rounded bg-primary px-2 py-1 text-[11px] font-bold text-white">
                          DOC
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-gray-950">
                            {reviewKnowledgeAddModal.file.name}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {formatFileSize(reviewKnowledgeAddModal.file.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setReviewKnowledgeAddModal((prev) =>
                              prev ? { ...prev, file: null } : prev,
                            )
                          }
                          className="text-slate-500 hover:text-red-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
                <SecondaryButton onClick={() => setReviewKnowledgeAddModal(null)}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton onClick={handleConfirmReviewKnowledgeAdd}>
                  Add to knowledge base
                </PrimaryButton>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  const renderSummaryStep = (readOnly: boolean) => {
    const validFaqCount = getValidKnowledgeFaqs(knowledgeFaqs).length;
    const normalizedSearch = reviewKnowledgeSearch.trim().toLowerCase();
    const filteredDocuments = normalizedSearch
      ? knowledgeDocumentSummaries.filter((document) =>
          [document.title, document.copy, document.source, document.status]
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearch),
        )
      : knowledgeDocumentSummaries;
    const filteredFaqs = normalizedSearch
      ? knowledgeFaqs.filter((faq) =>
          [faq.question, faq.answer, faq.source].join(' ').toLowerCase().includes(normalizedSearch),
        )
      : knowledgeFaqs;
    const isDocumentsTab = reviewKnowledgeTab === 'documents';
    const searchPlaceholder = isDocumentsTab ? 'Search documents…' : 'Search FAQs…';
    const reviewSourceCount = uniqueStrings([
      ...(knowledgeSummaryPayload.crawl_url ?? []),
      ...(knowledgeSummaryPayload.url ?? []),
      ...(knowledgeSummaryPayload.text ?? []),
      ...(knowledgeSummaryPayload.pdf ?? []),
    ]).length;
    const hasExistingKnowledgeSelection =
      Boolean(selectedReusableAgentId) ||
      selectedTextKnowledgeIds.length > 0 ||
      selectedUrlKnowledgeIds.length > 0 ||
      selectedPdfKnowledgeIds.length > 0;
    const reviewBackSourceStage: SourceStage = hasExistingKnowledgeSelection ? 1 : 2;

    return (
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3.5 text-left">
        <div>
          <h1 className="text-[22px] font-bold leading-7 text-gray-950">Review knowledge</h1>
          <p className="mt-1 text-sm leading-5 text-slate-500">
            Review what was generated. Edit, delete, or add Documents and FAQs before continuing.
          </p>
        </div>

        <div className="rounded-xl border border-[#BFDBFE] bg-gradient-to-br from-blue-50 to-emerald-50 px-[22px] py-[22px] text-center">
          <div className="mx-auto mb-2.5 grid h-12 w-12 place-items-center rounded-full bg-emerald-500 text-white">
            <Check className="h-[26px] w-[26px] stroke-[3]" />
          </div>
          <h2 className="text-[18px] font-bold leading-6 text-gray-950">
            Here's what your chatbot will know
          </h2>
          <p className="mt-0.5 text-[13px] leading-5 text-slate-600">
            Review what was auto-extracted. You can add more docs, custom text, or FAQs from the
            tabs below.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {[
            { label: 'Sources', value: reviewSourceCount },
            { label: 'Documents', value: knowledgeDocumentSummaries.length },
            { label: 'FAQs', value: validFaqCount },
            { label: 'Training', value: '~3 min', valueClassName: 'text-sm' },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-[11px] font-medium leading-4 text-slate-500">{item.label}</p>
              <p
                className={cx(
                  'mt-0.5 text-xl font-bold leading-6 text-gray-950',
                  item.valueClassName,
                )}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-1">
          <h2 className="text-[18px] font-bold leading-6 text-gray-950">Knowledge Base Summary</h2>
          <p className="mt-1 text-[13px] leading-5 text-slate-600">
            Here's what the AI chatbot will use. Edit anything, delete what shouldn't be there, add
            anything missing.
          </p>
        </div>

        <div className="inline-flex w-fit gap-[3px] rounded-lg bg-slate-100 p-1">
          {[
            {
              key: 'documents' as const,
              label: 'Documents',
              count: knowledgeDocumentSummaries.length,
              icon: <span className="text-sm leading-none">📄</span>,
            },
            {
              key: 'faqs' as const,
              label: 'FAQs',
              count: validFaqCount,
              icon: <span className="text-sm leading-none">💬</span>,
            },
          ].map((tab) => {
            const isSelected = reviewKnowledgeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setReviewKnowledgeTab(tab.key);
                  setReviewKnowledgeSearch('');
                }}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-md border border-transparent px-3.5 py-1.5 text-xs font-semibold transition-colors',
                  isSelected
                    ? 'bg-white text-gray-950 shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                    : 'bg-transparent text-slate-600 hover:bg-white hover:text-gray-950',
                )}
              >
                {tab.icon}
                {tab.label}
                <span className="ml-1 rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-slate-600">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mb-0.5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={reviewKnowledgeSearch}
              onChange={(event) =>
                setReviewKnowledgeSearch(sanitizeAiSearchText(event.target.value))
              }
              placeholder={searchPlaceholder}
              className="h-[38px] w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-[13px] outline-none focus:border-primary"
            />
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={() => handleOpenReviewKnowledgeAdd(isDocumentsTab ? 'document' : 'faq')}
              disabled={isKnowledgeSummaryNavigationLocked}
              className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {isDocumentsTab ? 'Add document' : 'Add FAQ'}
            </button>
          )}
        </div>

        {isDocumentsTab ? (
          <div className="flex flex-col gap-2.5">
            {isSummarizingKnowledgeBase ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-8 text-sm font-semibold text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating summary...
              </div>
            ) : (
              <>
                {knowledgeSummaryError && (
                  <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                    {knowledgeSummaryError}
                  </div>
                )}
                {filteredDocuments.length ? (
                  filteredDocuments.map((document) => {
                    const copy = document.copy.trim();
                    return (
                      <div
                        key={document.id}
                        className="rounded-xl border border-gray-200 bg-white px-[22px] py-[18px] shadow-sm transition-colors hover:border-gray-300 hover:shadow-[0_2px_6px_rgba(0,0,0,0.04)]"
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <h3 className="min-w-0 flex-1 break-words text-[15px] font-bold leading-5 text-gray-950">
                            {document.title}
                          </h3>
                          {renderReviewKnowledgeMenu('document', document)}
                        </div>
                        {copy && (
                          <p className="mt-3 whitespace-pre-line break-words text-[13px] leading-[1.6] text-slate-700">
                            {copy}
                          </p>
                        )}
                        <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                          <span className="min-w-0 truncate">
                            From {document.source || 'selected source'}
                          </span>
                          <span>{document.status || 'Ready'}</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                    No documents found.
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {isGeneratingKnowledgeFaqs ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-8 text-sm font-semibold text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating FAQs...
              </div>
            ) : (
              <>
                {knowledgeFaqError && (
                  <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                    {knowledgeFaqError}
                  </div>
                )}
                {filteredFaqs.length ? (
                  filteredFaqs.map((faq) => (
                    <div
                      key={faq.id}
                      className="rounded-xl border border-gray-200 bg-white px-[22px] py-[18px] shadow-sm transition-colors hover:border-gray-300 hover:shadow-[0_2px_6px_rgba(0,0,0,0.04)]"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <h3 className="min-w-0 flex-1 break-words text-[15px] font-bold leading-5 text-gray-950">
                          {faq.question || 'Untitled FAQ'}
                        </h3>
                        {renderReviewKnowledgeMenu('faq', faq)}
                      </div>
                      <p className="whitespace-pre-line break-words text-[13px] leading-[1.6] text-slate-700">
                        {faq.answer || 'No answer added yet.'}
                      </p>
                      <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                        <span className="min-w-0 truncate">
                          {faq.source ? `From ${faq.source}` : 'Manual'}
                        </span>
                        <span>Just generated</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                    No FAQs found. Add a custom FAQ to create knowledge manually.
                  </div>
                )}
              </>
            )}
            {stepErrors.knowledgeBase && (
              <p className="mt-3 text-sm font-medium text-red-500">{stepErrors.knowledgeBase}</p>
            )}
          </div>
        )}

        {isDocumentsTab && stepErrors.knowledgeBase && (
          <p className="text-sm font-medium text-red-500">{stepErrors.knowledgeBase}</p>
        )}

        {!isReadOnly && (
          <div className="mt-2 flex items-center justify-between">
            <SecondaryButton
              onClick={() => void handleStepperChange(2, reviewBackSourceStage)}
              disabled={isKnowledgeSummaryNavigationLocked}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </SecondaryButton>
            <PrimaryButton
              onClick={() => void handleStepperChange(6, 1)}
              disabled={isKnowledgeSummaryNavigationLocked}
            >
              Continue to Handoff
              <ArrowRight className="h-4 w-4" />
            </PrimaryButton>
          </div>
        )}
      </div>
    );
  };

  const renderHandoffStep = () => {
    const displayHours =
      operationalHours?.type === '24_hours'
        ? 'Open 24/7 — Monday to Sunday, all times'
        : getWeeklyScheduleName(operationalHours?.value) || 'Not configured';

    return (
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 text-left">
        <SectionHeading
          title="Handoff & availability"
          subtitle="When the bot can't help, when is your team available, and where should the conversation go?"
        />

        {/* Section 1: Business hours */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-baseline gap-1.5">
            <h3 className="text-sm font-bold text-gray-950">Business hours</h3>
            <span className="text-xs text-slate-400 font-normal">(optional)</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Set when your{' '}
            <span className="font-semibold text-slate-700">human agents are online</span> to take
            over a chat. During these hours the bot can hand off to a live agent.
          </p>

          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs text-primary leading-normal">
            <span className="text-sm shrink-0">ℹ</span>
            <p>
              <span className="font-bold">After hours are handled automatically.</span> Outside the
              hours you set, the assistant tells visitors you're closed and offers to schedule a
              callback with the assigned manager.
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="inline-flex h-10 items-center rounded-md border border-primary/20 bg-primary/10 px-4 text-sm font-semibold text-primary">
              {bussinessHourError || displayHours}
            </div>
            <button
              type="button"
              onClick={() => setIsBusinessHoursModalOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <span className="text-sm">⏰</span>
              Set business hours
            </button>
          </div>
        </div>

        {/* Section 2: Business hours behavior */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-950">Business hours behavior</h3>
          <p className="mt-1 text-xs text-slate-500">
            What should happen when visitors reach you{' '}
            <span className="font-semibold text-slate-700">during</span> business hours? The bot
            tries to answer; pick the live-agent fallback below.
          </p>

          <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-gray-900">Enable human handoff</p>
              <p className="mt-1 text-xs text-slate-500 leading-normal">
                When ON, the bot can transfer business-hours chats to a live queue.
              </p>
            </div>
            <Switch
              checked={enableHumanHandoff}
              onCheckedChange={(checked) => {
                const enabled = checked === true;
                setEnableHumanHandoff(enabled);
                if (!enabled) {
                  setStepErrors((prev) => ({ ...prev, queue: '' }));
                }
              }}
              disabled={isReadOnly}
              className="shrink-0 mt-1"
            />
          </div>

          {enableHumanHandoff && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Forward type
                </label>
                <input
                  type="text"
                  readOnly
                  value="Forward to Chat Queue"
                  className="mt-2 h-10 w-full rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-slate-500 cursor-not-allowed outline-none"
                />
                <p className="mt-1.5 text-[11px] text-slate-400 leading-normal">
                  Chatbot agents only hand off to a chat queue. Use an AI Receptionist for
                  phone-based forwarding.
                </p>
              </div>

              <div className="scroll-mt-24" data-validation-key="queue">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Chat queue
                </label>
                <div className="mt-2">
                  <CustomSelect
                    isDisabled={isReadOnly}
                    value={selectedQueueOption}
                    handleChange={(option: any) => {
                      const val = option?.value || '';
                      setSelectedQueueId(val);
                      setSelectedQueueLabel(option?.label || '');
                      setStepErrors((prev) => ({ ...prev, queue: '' }));
                    }}
                    options={queueOptions}
                    placeholder="Select a queue..."
                    error={stepErrors.queue}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Manager Configuration */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-950">Manager Configuration</h3>
          <p className="mt-1 text-xs text-slate-500">
            Select the manager who owns callback & escalation requests. The chosen manager receives
            the schedule details and may handle it personally or reassign it.
          </p>

          <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-gray-900">Enable scheduled callbacks</p>
              <p className="mt-1 text-xs text-slate-500 leading-normal">
                When ON, the bot can offer to schedule a callback and pass the request to a manager.
                When OFF, the selected manager still owns escalations, but the bot will not offer a
                callback.
              </p>
            </div>
            <Switch
              checked={enableCallbackScheduling}
              onCheckedChange={(checked) => setEnableCallbackScheduling(checked === true)}
              disabled={isReadOnly}
              className="shrink-0 mt-1"
            />
          </div>

          <div className="mt-4 scroll-mt-24" data-validation-key="manager">
            <span className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
              <span className="text-sm">👤</span>
              Manager who owns callbacks & escalations
            </span>
            <div className="mt-2">
              <CustomSelect
                isDisabled={isReadOnly}
                value={selectedManagerOption}
                handleChange={(option: any) => {
                  setSelectedManagerId(option?.value || '');
                  setStepErrors((prev) => ({ ...prev, manager: '' }));
                }}
                options={managerOptions}
                placeholder="Select a manager"
                error={stepErrors.manager}
                isLoading={isLoadingManagerUsers || isFetchingNextManagerPage}
                onInputChange={setManagerSearch}
                onMenuScrollToBottom={() => {
                  if (hasNextManagerPage && !isFetchingNextManagerPage) {
                    void fetchNextManagerPage();
                  }
                }}
                FormatOptionLabel={({ option }: any) => (
                  <div className="flex w-full items-center justify-between">
                    <div>{option?.label}</div>
                    {option?.extension && (
                      <div className="flex items-center gap-1">
                        <Grid className="w-4 h-4" />
                        {option?.extension || ''}
                      </div>
                    )}
                  </div>
                )}
              />
              {stepErrors.manager && (
                <p className="mt-1.5 text-xs font-medium text-red-500" role="alert">
                  {stepErrors.manager}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2 text-xs text-slate-500">
            <span className="text-sm shrink-0">📝</span>
            <p className="leading-normal">
              The selected manager receives visitor name, email, preferred callback time, and the
              chat transcript for every scheduled callback.
            </p>
          </div>
        </div>

        {!isReadOnly && (
          <div className="mt-2 flex items-center justify-between">
            <SecondaryButton onClick={() => void handleStepperChange(2, 3)}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </SecondaryButton>
            <PrimaryButton onClick={() => void handleStepperChange(7, 1)}>
              Continue to Advanced Settings
              <ArrowRight className="h-4 w-4" />
            </PrimaryButton>
          </div>
        )}
      </div>
    );
  };

  const renderAdvancedStep = () => {
    return (
      <div className="mx-auto flex w-full max-w-[800px] flex-col gap-4 text-left">
        <SectionHeading
          title={stepTitle}
          subtitle="Configure what the assistant collects from visitors and fine-tune its conversational behavior."
        />

        {/* Card 1: Data Collection */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-bold text-gray-950">Data Collection</h3>
            <p className="mt-1 text-xs text-slate-500">
              Choose what visitor details the bot politely asks for during the chat. Captured fields
              are saved on the conversation record.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            {/* Enable Data Collection Toggle */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-950">Enable Data Collection</h4>
                <p className="mt-1 text-xs text-slate-500 leading-normal">
                  Turn off to collect only the visitor name.
                </p>
              </div>
              <Switch
                checked={isDataCollectionEnabled}
                onCheckedChange={(checked) => setIsDataCollectionEnabled(checked === true)}
                disabled={isReadOnly}
              />
            </div>

            {/* Info Callout Tip */}
            {isDataCollectionEnabled && (
              <div className="mt-4 rounded-lg border border-primary/20 bg-primary/10 p-4">
                <p className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <span>💡</span>
                  Mandatory vs Optional — when to use each?
                </p>
                <div className="mt-2 text-xs leading-5 text-slate-600 flex flex-col gap-1.5">
                  <p>
                    <strong>Mandatory</strong> = the bot keeps politely re-asking until the visitor
                    answers. Use for must-haves like{' '}
                    <span className="font-semibold text-primary font-medium">Email</span> for
                    follow-up.
                  </p>
                  <p>
                    <strong>Optional</strong> = the bot asks once and moves on if skipped. Best for
                    nice-to-have data like{' '}
                    <span className="font-semibold text-primary font-medium">Date of birth</span> or{' '}
                    <span className="font-semibold text-primary font-medium">Address</span>.
                  </p>
                </div>
              </div>
            )}

            {/* Fields List Checklist */}
            <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
              {[
                {
                  key: 'name' as DetailField,
                  label: 'Name',
                  badge: 'Always asked',
                  disabled: true,
                },
                ...(isDataCollectionEnabled
                  ? [
                      { key: 'email' as DetailField, label: 'Email', badge: '', disabled: false },
                      {
                        key: 'phone' as DetailField,
                        label: 'Phone',
                        badge: 'Always asked',
                        disabled: true,
                      },
                      { key: 'dob' as DetailField, label: 'DOB', badge: '', disabled: false },
                      {
                        key: 'address' as DetailField,
                        label: 'Address',
                        badge: '',
                        disabled: false,
                      },
                    ]
                  : []),
              ].map(({ key, label, badge, disabled }) => {
                const isAlwaysAsked = disabled || ALWAYS_ASKED_DETAIL_FIELDS.has(key);
                const isChecked = isAlwaysAsked || detailsToCollect.includes(key);
                const mandatory = isAlwaysAsked ? 'mandatory' : detailsMandatory[key];
                return (
                  <div
                    key={key}
                    className={cx(
                      'flex items-center gap-4 border-b border-gray-100 px-5 py-3 last:border-b-0 transition-colors',
                      key === 'phone' && 'bg-amber-50/60',
                      key !== 'phone' && isChecked && 'bg-white',
                      key !== 'phone' && !isChecked && 'opacity-60 bg-white',
                    )}
                  >
                    <Checkbox
                      checked={isChecked}
                      disabled={isAlwaysAsked || isReadOnly}
                      onCheckedChange={(checked) => {
                        if (isAlwaysAsked) return;
                        toggleSingleDetail(key, checked === true);
                      }}
                      className="shrink-0"
                    />
                    <span
                      className={cx(
                        'flex-1 text-sm font-semibold',
                        isChecked ? 'text-gray-900' : 'text-slate-400',
                      )}
                    >
                      {label}
                      {badge && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                          {badge}
                        </span>
                      )}
                    </span>
                    {isAlwaysAsked ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        Mandatory
                      </span>
                    ) : (
                      <div className="flex items-center gap-5">
                        <label
                          className={cx(
                            'flex items-center gap-1.5 cursor-pointer',
                            !isChecked && 'pointer-events-none',
                          )}
                        >
                          <input
                            type="radio"
                            name={`field-mode-${key}`}
                            value="mandatory"
                            checked={mandatory === 'mandatory'}
                            disabled={!isChecked || isReadOnly}
                            onChange={() => {
                              setDetailsMandatory((prev) => ({ ...prev, [key]: 'mandatory' }));
                            }}
                            className="h-4 w-4 accent-primary cursor-pointer"
                          />
                          <span
                            className={cx(
                              'text-xs font-semibold',
                              isChecked ? 'text-gray-700' : 'text-slate-450',
                            )}
                          >
                            Mandatory
                          </span>
                        </label>
                        <label
                          className={cx(
                            'flex items-center gap-1.5 cursor-pointer',
                            !isChecked && 'pointer-events-none',
                          )}
                        >
                          <input
                            type="radio"
                            name={`field-mode-${key}`}
                            value="optional"
                            checked={mandatory === 'optional'}
                            disabled={!isChecked || isReadOnly}
                            onChange={() => {
                              setDetailsMandatory((prev) => ({ ...prev, [key]: 'optional' }));
                            }}
                            className="h-4 w-4 accent-primary cursor-pointer"
                          />
                          <span
                            className={cx(
                              'text-xs font-semibold',
                              isChecked ? 'text-gray-700' : 'text-slate-450',
                            )}
                          >
                            Optional
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Push to CRM Yellow Container */}
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/20 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2.5">
                  <span className="text-base mt-0.5">🎯</span>
                  <div>
                    <p className="text-sm font-bold text-gray-950">Push captured data to CRM</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      When enabled, the bot auto-creates a contact in your CRM using the fields
                      collected above, with the full chat transcript attached.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={enableCallMonitoring}
                  onCheckedChange={(checked) =>
                    setEnableCallMonitoring(isDataCollectionEnabled && checked === true)
                  }
                  disabled={isReadOnly || !isDataCollectionEnabled}
                />
              </div>
              {!isDataCollectionEnabled && (
                <p className="mt-3 text-xs font-medium text-amber-700">
                  Enable data collection before pushing captured data to CRM.
                </p>
              )}
              {isDataCollectionEnabled && enableCallMonitoring && (
                <div className="mt-3">
                  {/* The four legacy CRM entries under this were in a hidden
                      <optgroup>: unreachable markup naming pipelines nothing
                      reads. */}
                  <Picker
                    label="CRM pipeline"
                    showLabel={false}
                    className="mcm-field"
                    disabled={
                      isReadOnly || isFetchingConnectedCrms || connectedCrmOptions.length === 0
                    }
                    placeholder={
                      isFetchingConnectedCrms
                        ? 'Checking connected CRMs…'
                        : connectedCrmOptions.length > 0
                          ? 'Select a CRM…'
                          : 'No connected CRM available'
                    }
                    value={selectedCrmPipeline}
                    options={connectedCrmOptions.map((option) => ({
                      label: String(option.label),
                      value: String(option.value),
                    }))}
                    onChange={(option) => setSelectedCrmPipeline(option.value)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Advanced behavior */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-bold text-gray-950">Advanced behavior</h3>
            <p className="mt-1 text-xs text-slate-500">
              Configure session limits and idle handling.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <SettingsRow
              title="Max Session Duration"
              copy="End the chat automatically after this much total time."
              trailing={
                <div
                  className={cx(
                    'flex h-9 w-[180px] items-center rounded-md border border-gray-300 bg-white focus-within:border-primary',
                    isReadOnly && 'cursor-not-allowed bg-gray-50 text-slate-600',
                  )}
                >
                  <input
                    type="number"
                    value={maxSessionDuration}
                    min={1}
                    max={MAX_DURATION_SECONDS}
                    step={1}
                    aria-label="Maximum session duration in minutes"
                    onChange={(event) =>
                      setMaxSessionDuration(
                        normalizeBoundedIntegerInput(event.target.value, MAX_DURATION_SECONDS),
                      )
                    }
                    onBlur={() => setMaxSessionDuration((value) => (value === '' ? 1 : value))}
                    disabled={isReadOnly}
                    className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none disabled:cursor-not-allowed"
                  />
                  <span className="pr-3 text-xs text-slate-500" aria-hidden="true">
                    sec
                  </span>
                </div>
              }
            />

            <SettingsRow
              title="Idle Reminder"
              copy="How long to wait in silence before the bot nudges the visitor."
              trailing={
                <div
                  className={cx(
                    'flex h-9 w-[180px] items-center rounded-md border border-gray-300 bg-white focus-within:border-primary',
                    isReadOnly && 'cursor-not-allowed bg-gray-50 text-slate-655',
                  )}
                >
                  <input
                    type="number"
                    value={idleReminder}
                    min={1}
                    max={MAX_DURATION_SECONDS}
                    step={1}
                    aria-label="Idle reminder delay in minutes"
                    onChange={(event) =>
                      setIdleReminder(
                        normalizeBoundedIntegerInput(event.target.value, MAX_DURATION_SECONDS),
                      )
                    }
                    onBlur={() => setIdleReminder((value) => (value === '' ? 1 : value))}
                    disabled={isReadOnly}
                    className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none disabled:cursor-not-allowed"
                  />
                  <span className="pr-3 text-xs text-slate-500" aria-hidden="true">
                    sec
                  </span>
                </div>
              }
            />

            <SettingsRow
              title="Idle Reminder Retry"
              copy="How many reminders to send before closing the chat."
              trailing={
                <input
                  type="number"
                  value={idleReminderRetry}
                  min={1}
                  max={MAX_IDLE_REMINDER_RETRIES}
                  step={1}
                  aria-label="Idle reminder retry count"
                  onChange={(event) =>
                    setIdleReminderRetry(
                      normalizeBoundedIntegerInput(event.target.value, MAX_IDLE_REMINDER_RETRIES),
                    )
                  }
                  onBlur={() => setIdleReminderRetry((value) => (value === '' ? 1 : value))}
                  disabled={isReadOnly}
                  className={cx(
                    'h-9 w-[180px] rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:border-primary',
                    isReadOnly && 'cursor-not-allowed bg-gray-50 text-slate-655',
                  )}
                />
              }
            />
          </div>
        </div>

        {/* Navigation Buttons */}
        {!isReadOnly && (
          <div className="mt-2 flex items-center justify-between">
            <SecondaryButton onClick={() => void handleStepperChange(6, 1)}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </SecondaryButton>
            <PrimaryButton
              onClick={handleFinish}
              disabled={isSubmitting || isCreatingKnowledgeSources}
            >
              {isCreatingKnowledgeSources
                ? 'Creating knowledge...'
                : isSubmitting
                  ? 'Saving...'
                  : isEdit
                    ? 'Update agent'
                    : 'Create agent'}
              <Check className="h-4 w-4" />
            </PrimaryButton>
          </div>
        )}
      </div>
    );
  };

  const renderEditTabContent = () => {
    if (editTab === 'overview') {
      return (
        <EditAgentOverview
          documents={knowledgeDocuments}
          faqs={knowledgeFaqs}
          sourceCount={sourceRecords.length}
          companyDetailsCount={pendingTextItems.length}
          websiteSourceCount={pendingUrls.length + selectedLinks.length}
          documentSourceCount={pendingFiles.length}
          onManageKnowledge={isReadOnly ? undefined : () => handleEditTabChange('website')}
          onManageFaqs={isReadOnly ? undefined : () => handleEditTabChange('review')}
        />
      );
    }

    return renderStep();
  };

  if (isEdit && !useWizardEdit) {
    return (
      <FormProvider {...formInstance}>
        <EditChatbotAgentWorkspace
          agentName={botName || 'Untitled agent'}
          domain={agentDomain}
          avatarImage={String(
            initialData?.avatar ||
              initialData?.profile ||
              initialData?.image ||
              initialData?.agentAvatar ||
              '',
          ).trim()}
          activeTab={editTab}
          onTabChange={handleEditTabChange}
          onBack={() => navigate('/admin-settings/knowledge/ai-agent')}
          onSave={handleFinish}
          isSaving={isSubmitting || isCreatingKnowledgeSources}
          navigationDisabled={isKnowledgeSummaryNavigationLocked}
          readOnly={isReadOnly}
        >
          {renderEditTabContent()}
        </EditChatbotAgentWorkspace>
        <WebsiteScanProgressModal
          open={websiteScanProgressStatus !== 'idle'}
          status={websiteScanProgressStatus}
        />
        {renderReviewKnowledgeModals()}
        {!isReadOnly && isBusinessHoursModalOpen && (
          <BussinessHoursModal
            modalState={isBusinessHoursModalOpen}
            setModalState={setIsBusinessHoursModalOpen}
            setError={setBussinessHourError}
            data={{ settings: { operational_hours: operationalHours } }}
            aiMode={true}
          />
        )}
      </FormProvider>
    );
  }

  return (
    <FormProvider {...formInstance}>
      <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f3f4f6] text-[#07142f]">
        <div className="flex min-h-[72px] items-center border-b border-gray-200 bg-white px-3 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-slate-500">
            <button
              type="button"
              onClick={() => requestWizardLeave('/admin-settings/knowledge/ai-agent')}
              className="transition-colors hover:text-primary"
            >
              AI Agents
            </button>
            <span className="text-slate-400">/</span>
            <button
              type="button"
              onClick={() => requestWizardLeave('/admin-settings/knowledge/ai-agent')}
              className="transition-colors hover:text-primary"
            >
              AI Chatbot Agents
            </button>
            <span className="text-slate-400">/</span>
            <span className="font-semibold text-gray-950">
              {isEdit ? 'Update Agent' : 'New Agent'}
            </span>
          </div>
          <SecondaryButton onClick={() => requestWizardLeave('/admin-settings/knowledge/ai-agent')}>
            Cancel
          </SecondaryButton>
        </div>
        <WizardStepper
          activeStep={activeStep}
          sourceStage={sourceStage}
          onChange={handleStepperChange}
          disabled={isKnowledgeSummaryNavigationLocked}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-5">
          {renderStep()}
        </div>
      </section>
      {renderReviewKnowledgeModals()}
      {!isReadOnly && isBusinessHoursModalOpen && (
        <BussinessHoursModal
          modalState={isBusinessHoursModalOpen}
          setModalState={setIsBusinessHoursModalOpen}
          setError={setBussinessHourError}
          data={{ settings: { operational_hours: operationalHours } }}
          aiMode={true}
        />
      )}
      <WebsiteScanProgressModal
        open={websiteScanProgressStatus !== 'idle'}
        status={websiteScanProgressStatus}
      />
      <WizardLeaveConfirmModal
        open={showLeaveWizardModal}
        onStay={cancelWizardLeave}
        onDiscard={confirmWizardLeave}
      />
    </FormProvider>
  );
}

function WizardStepper({
  activeStep,
  sourceStage,
  onChange,
  disabled = false,
}: {
  activeStep: number;
  sourceStage: SourceStage;
  onChange: (step: number, stage: SourceStage) => void;
  disabled?: boolean;
}) {
  const currentVisual = useMemo(() => {
    if (activeStep === 1) return 0;
    if (activeStep === 2) {
      if (sourceStage === 1) return 1;
      if (sourceStage === 2) return 2;
      return 3;
    }
    if (activeStep === 6) return 4;
    if (activeStep === 7) return 5;
    return 3;
  }, [activeStep, sourceStage]);

  const stepMappings = [
    { step: 1, stage: 1 as SourceStage },
    { step: 2, stage: 1 as SourceStage },
    { step: 2, stage: 2 as SourceStage },
    { step: 2, stage: 3 as SourceStage },
    { step: 6, stage: 1 as SourceStage },
    { step: 7, stage: 1 as SourceStage },
  ];

  return (
    <div className="border-b border-gray-200 bg-white px-6 py-[22px]">
      <div className="relative mx-auto max-w-[1200px]">
        {/* Progress Line */}
        <div className="absolute left-[13%] right-[13%] top-[18px] z-0 h-0.5 -translate-y-1/2 bg-[#EAECF0]" />

        <div className="relative flex justify-between items-start z-10">
          {wizardSteps.map((label, index) => {
            const isComplete = index < currentVisual;
            const isActive = index === currentVisual;
            const target = stepMappings[index];

            return (
              <button
                key={label}
                type="button"
                onClick={() => onChange(target.step, target.stage)}
                disabled={disabled}
                className={cx(
                  'flex flex-col items-center gap-2 group focus:outline-none flex-1',
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                )}
              >
                <div
                  className={cx(
                    'flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition-all duration-200',
                    isComplete && 'border-emerald-500 bg-[#10b981] text-white',
                    isActive && 'border-primary bg-primary text-white',
                    !isComplete &&
                      !isActive &&
                      'border-gray-200 bg-white text-slate-400 group-hover:border-gray-300',
                  )}
                >
                  {isComplete ? <Check className="h-4 w-4 stroke-[3.5]" /> : index + 1}
                </div>
                <span
                  className={cx(
                    'px-1 text-center text-[13px] font-semibold transition-colors',
                    isActive ? 'text-primary' : 'text-slate-650 group-hover:text-slate-900',
                  )}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EditChatbotAgentWorkspace({
  agentName,
  domain,
  avatarImage,
  activeTab,
  onTabChange,
  onBack,
  onSave,
  isSaving,
  navigationDisabled = false,
  readOnly,
  children,
}: {
  agentName: string;
  domain: string;
  avatarImage?: string;
  activeTab: EditAgentTab;
  onTabChange: (tab: EditAgentTab) => void;
  onBack: () => void;
  onSave: () => void;
  isSaving: boolean;
  navigationDisabled?: boolean;
  readOnly: boolean;
  children: ReactNode;
}) {
  const tabIcons: Record<EditAgentTab, ReactNode> = {
    overview: <Settings2 className="h-4 w-4" />,
    brain: <Bot className="h-4 w-4" />,
    website: <FileText className="h-4 w-4" />,
    review: <Sparkles className="h-4 w-4" />,
    handoff: <ArrowRight className="h-4 w-4" />,
    advanced: <Settings2 className="h-4 w-4" />,
  };
  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: tabIcons.overview },
    { key: 'brain' as const, label: 'Identity & Behavior', icon: tabIcons.brain },
    { key: 'website' as const, label: 'Knowledge Base', icon: tabIcons.website },
    { key: 'review' as const, label: 'Review', icon: tabIcons.review },
    { key: 'handoff' as const, label: 'Handoff', icon: tabIcons.handoff },
    { key: 'advanced' as const, label: 'Advanced Settings', icon: tabIcons.advanced },
  ];

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f3f4f6] text-[#07142f]">
      <div className="border-b border-gray-200 bg-white px-4 pt-4 sm:px-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <button
                type="button"
                onClick={onBack}
                className="transition-colors hover:text-primary cursor-pointer"
              >
                AI Agents
              </button>
              <span>/</span>
              <button
                type="button"
                onClick={onBack}
                className="transition-colors hover:text-primary cursor-pointer"
              >
                AI Chatbot Agents
              </button>
              <span>/</span>
              <span className="text-slate-800">{agentName}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <CustomAvatar
                name={agentName}
                image={avatarImage}
                size="46"
                showPresence={false}
                isActivityInfo={false}
                textClass="text-base"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-lg font-bold text-gray-950">{agentName}</h1>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
                    Live
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-slate-500">
                  {domain && <span>{domain}</span>}
                </div>
              </div>
            </div>
          </div>

          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <PrimaryButton onClick={onSave} disabled={isSaving || navigationDisabled}>
                {isSaving ? 'Saving...' : 'Update agent'}
                <Check className="h-4 w-4" />
              </PrimaryButton>
            </div>
          )}
        </div>

        <div className=" flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              disabled={navigationDisabled}
              className={cx(
                'flex h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors',
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-slate-600 hover:text-primary',
                navigationDisabled && 'cursor-not-allowed opacity-60 hover:text-slate-600',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">{children}</div>
    </section>
  );
}

function EditAgentOverview({
  documents,
  faqs,
  sourceCount,
  companyDetailsCount,
  websiteSourceCount,
  documentSourceCount,
  onManageKnowledge,
  onManageFaqs,
}: {
  documents: KnowledgeDocument[];
  faqs: KnowledgeFaq[];
  sourceCount: number;
  companyDetailsCount: number;
  websiteSourceCount: number;
  documentSourceCount: number;
  onManageKnowledge?: () => void;
  onManageFaqs?: () => void;
}) {
  const knowledgeRows = [
    {
      label: 'Documents',
      value: documents.length,
      icon: <FileText className="h-4 w-4 text-violet-500" />,
    },
    {
      label: 'FAQs',
      value: faqs.length,
      icon: <MessageCircle className="h-4 w-4 text-primary" />,
    },
    {
      label: 'Custom answers',
      value: companyDetailsCount,
      icon: <Settings2 className="h-4 w-4 text-slate-500" />,
    },
    {
      label: 'Website sources',
      value: websiteSourceCount,
      icon: <Globe2 className="h-4 w-4 text-emerald-500" />,
    },
    {
      label: 'Uploaded docs',
      value: documentSourceCount,
      icon: <UploadCloud className="h-4 w-4 text-orange-500" />,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-4">
        <Metric label="Sources" value={String(sourceCount)} />
        <Metric label="Documents" value={String(documents.length)} />
        <Metric label="FAQs" value={String(faqs.length)} />
        <Metric label="Custom answers" value={String(companyDetailsCount)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <OverviewPanel
            title="FAQs"
            actionLabel={onManageFaqs ? 'Manage FAQs' : undefined}
            onAction={onManageFaqs}
          >
            {faqs.length ? (
              <div className="flex flex-col divide-y divide-gray-100">
                {faqs.slice(0, 5).map((faq) => (
                  <div key={faq.id} className="py-3">
                    <p className="text-sm font-semibold text-gray-950">{faq.question}</p>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">
                      {faq.answer}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">From {faq.source}</p>
                  </div>
                ))}
              </div>
            ) : (
              <NoDataAvailable />
            )}
          </OverviewPanel>

          <OverviewPanel title="Documents">
            {documents.length ? (
              <div className="flex flex-col divide-y divide-gray-100">
                {documents.slice(0, 5).map((document) => (
                  <div key={document.id} className="flex items-start gap-3 py-3">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-950">
                        {document.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">
                        {document.copy}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">From {document.source}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-emerald-600">
                      {document.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <NoDataAvailable />
            )}
          </OverviewPanel>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-gray-950">Knowledge base overview</h3>
            <div className="mt-4 flex flex-col divide-y divide-gray-100 text-sm">
              {knowledgeRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex min-w-0 items-center gap-2 text-slate-700">
                    {row.icon}
                    <span className="truncate">{row.label}</span>
                  </span>
                  <strong className="text-gray-950">{row.value}</strong>
                </div>
              ))}
            </div>
            {onManageKnowledge && (
              <button
                type="button"
                onClick={onManageKnowledge}
                className="mt-4 h-9 w-full rounded-md border border-gray-300 text-sm font-bold text-slate-700 transition-colors hover:border-primary hover:text-primary"
              >
                Manage knowledge
              </button>
            )}
          </div>

          <div className="rounded-lg bg-slate-900 p-5 text-white shadow-sm">
            <h3 className="text-base font-bold">AI Suggestion</h3>
            <p className="mt-2 text-sm leading-5 text-slate-300">
              Keep the knowledge base and FAQs updated so the chatbot can answer from current data.
            </p>
            {onManageFaqs && (
              <button
                type="button"
                onClick={onManageFaqs}
                className="mt-4 h-9 w-full rounded-md bg-primary text-sm font-bold text-white transition-colors hover:bg-primary/90"
              >
                Review FAQs
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewPanel({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-gray-950">{title}</h3>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="h-9 rounded-md border border-gray-300 px-4 text-sm font-bold text-slate-700 transition-colors hover:border-primary hover:text-primary"
          >
            {actionLabel}
          </button>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function NoDataAvailable() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-sm font-medium text-slate-500">
      No data Available
    </div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-[22px] font-bold leading-7 tracking-normal text-gray-950">{title}</h2>
      <p className="mt-1 text-sm leading-5 text-slate-500">{subtitle}</p>
    </div>
  );
}

function Field({
  label,
  helper,
  error,
  className,
  fieldKey,
  children,
}: {
  label: string;
  helper?: string;
  error?: string;
  className?: string;
  fieldKey?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx('block scroll-mt-24', className)} data-validation-key={fieldKey}>
      <span className="mb-1.5 block text-sm font-semibold text-gray-950">{label}</span>
      {helper && <span className="mb-2 block text-xs text-slate-500">{helper}</span>}
      {children}
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  );
}

function Metric({
  label,
  value,
  note,
  valueClassName,
}: {
  label: string;
  value: string;
  note?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx('text-2xl font-bold leading-7 text-gray-950', valueClassName)}>{value}</p>
      {note && <p className="mt-1 text-xs text-slate-400">{note}</p>}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-bold text-white transition-colors hover:bg-primary/90',
        disabled && 'cursor-not-allowed opacity-60 hover:bg-primary',
      )}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:border-gray-400',
        disabled && 'cursor-not-allowed opacity-60 hover:border-gray-300',
      )}
    >
      {children}
    </button>
  );
}

function SettingsRow({
  title,
  copy,
  trailing,
}: {
  title: string;
  copy: string;
  trailing: ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-4 text-gray-950">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{copy}</p>
      </div>
      {trailing}
    </div>
  );
}

export default CreateChatbotAgent;
