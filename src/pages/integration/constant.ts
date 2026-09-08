import GoogleSheet from '@/assets/images/google-sheet.png';
import GoogleContact from '@/assets/images/google-contacts.png';
import McmLogo from '@/assets/images/LogoIcon.svg';
export { McmLogo };
import Hubspot from '@/assets/images/Hubspot.png';
import Pipedrive from '@/assets/images/Pipedrive.png';
import Zoho from '@/assets/images/zoho.png';
import Salesforce from '@/assets/images/Salesforce.png';
import MondayLogo from '@/assets/images/MondayLogo.png';
import Zendesk from '@/assets/images/Zendesk.jpg';
import Microsoft from '@/assets/images/Microsoft.png';
import MsTeams from '@/assets/images/MsTeams.png';
import * as yup from 'yup';
import { getEnv } from '@/lib/utils';

type MainSiteInfoWithSmallLogo = { small_logo?: unknown } | null | undefined;

export const getMcmLogoIcon = (mainSiteInfo?: MainSiteInfoWithSmallLogo): string => {
  return mainSiteInfo?.small_logo
    ? `${getEnv().VITE_API_BASE_URL}/${mainSiteInfo?.small_logo}`
    : McmLogo;
};

const AiIcon = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%236b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`;

export const getBelongsToIcons = (
  mainSiteInfo?: MainSiteInfoWithSmallLogo,
): Record<string, string> => {
  const dynamicMcmLogo = getMcmLogoIcon(mainSiteInfo);

  return {
    HUBSPOT: Hubspot,
    ZOHO: Zoho,
    PIPEDRIVE: Pipedrive,
    GOOGLE_CONTACTS: GoogleContact,
    GOOGLE_SHEETS: GoogleSheet,
    GOOGLE: GoogleContact,
    SALESFORCE: Salesforce,
    ZENDESK: Zendesk,
    MICROSOFT365: Microsoft,
    MSTEAMS: MsTeams,
    MONDAY: MondayLogo,
    AI: AiIcon,
    DEFAULT: dynamicMcmLogo,
  };
};

export const belongsToIcons: Record<string, string> = getBelongsToIcons();

export const BELONGS_TO_LABELS: Record<string, string> = {
  HUBSPOT: 'HubSpot',
  ZOHO: 'Zoho',
  PIPEDRIVE: 'Pipedrive',
  GOOGLE_CONTACTS: 'Google Contacts',
  GOOGLE_SHEETS: 'Google Sheets',
  SALESFORCE: 'Salesforce',
  ZENDESK: 'Zendesk',
  MICROSOFT365: 'Microsoft 365',
  MSTEAMS: 'MS TEAMS',
  AI: 'AI',
  DEFAULT: 'MCM',
};
export const generalSettings = [
  {
    id: 'createNewContacts',
    icon: 'ContactIcon',
    title: 'Create New Contacts',
    description: 'Add new contacts to the address book in {crmName}',
  },
  {
    id: 'contacts2WaySync',
    icon: 'Refresh',
    title: 'Contacts 2-Way Sync',
    description:
      'Contacts added and uploaded in UCAAS must synchronize in {crmName} and vice versa',
  },
  // {
  //   id: 'notesLogging',
  //   icon: 'NotebookLine',
  //   title: 'Notes Logging',
  //   description: 'Drop only notes in Call Details',
  // },
  // {
  //   id: 'phoneAsContactName',
  //   icon: 'MessageIcon',
  //   title: 'Phone Numbers as Contact Names',
  //   description: 'Create new contacts with phone numbers as their contact names',
  // },
  {
    id: 'syncCallLogs',
    icon: 'OutgoingCallStrokeIcon',
    title: 'Sync Calls',
    description: 'Log outgoing answered and unanswered calls',
  },
  // {
  //   id: 'incomingCalls',
  //   icon: 'IncomingCallStrokeIcon',
  //   title: 'Incoming Calls',
  //   description: 'Log incoming answered and unanswered calls',
  // },
  // {
  //   id: 'voicemail',
  //   icon: 'VoicemailLineIcon',
  //   title: 'Voicemail',
  //   description: 'Log voicemails',
  // },
];

export interface CRMConfigurationProps {
  drawerData: crmListProps | undefined;
  setDrawerState: (state: boolean) => void;
}
export type CRMConfigurationForm = {
  createNewContacts: boolean;
  contacts2WaySync: boolean;
  notesLogging: boolean;
  phoneAsContactName: boolean;
  syncCallLogs: boolean;
  incomingCalls: boolean;
  voicemail: boolean;
};
export const CRMConfigurationInitialValues = {
  createNewContacts: false,
  contacts2WaySync: false,
  notesLogging: false,
  phoneAsContactName: false,
  syncCallLogs: false,
  incomingCalls: false,
  voicemail: false,
};
export interface crmListProps {
  name: string;
  label: string;
  image: string;
  alt: string;
  description: string;
  comingSoon: boolean;
  id: string;
}

export const crmList: crmListProps[] = [
  {
    name: 'HubSpot',
    label: 'hubspot-crm',
    image: Hubspot,
    alt: 'HubSpot',
    description: 'Enable the flow of contact and activity.',
    comingSoon: false,
    id: 'HubSpot',
  },
  {
    name: 'Zoho',
    label: 'zoho-crm',
    image: Zoho,
    alt: 'Zoho',
    description: 'Connect with Zoho CRM to sync contacts and automate communication flows.',
    comingSoon: false,
    id: 'Zoho',
  },
  {
    name: 'Pipedrive',
    label: 'pipedrive-crm',
    image: Pipedrive,
    alt: 'Pipedrive',
    description: 'Get your Pipedrive CRM and other insights.',
    comingSoon: false,
    id: 'Pipedrive',
  },

  {
    name: 'SalesForce',
    label: 'salesforce-crm',
    image: Salesforce,
    alt: 'SalesForce',
    description: 'Enhance CRM functionality and improve overall business telephony operations.',
    comingSoon: false,
    id: 'SalesForce',
  },
  {
    name: 'Zendesk',
    label: 'zendesk-crm',
    image: Zendesk,
    alt: 'Zendesk',
    description:
      'Integrate Zendesk to manage customer support tickets and communication seamlessly.',
    comingSoon: true,
    id: 'Zendesk',
  },
  {
    name: 'Microsoft 365',
    label: 'microsoft365-crm',
    image: Microsoft,
    alt: 'Microsoft 365',
    description:
      'Connect with Microsoft 365 to sync contacts and streamline your productivity workflows.',
    comingSoon: true,
    id: 'Microsoft',
  },
  {
    name: 'MS Teams',
    label: 'MS_TEAMS',
    image: MsTeams,
    alt: 'MS Teams',
    description:
      'Enhance collaboration by integrating MS Teams for unified communication and team management.',
    comingSoon: false,
    id: 'MS_TEAMS',
  },
  {
    name: 'Monday',
    label: 'monday-crm',
    image: MondayLogo,
    alt: 'Monday',
    description:
      'Integrate Monday.com to streamline your workflows and manage customer interactions efficiently.',
    comingSoon: false,
    id: 'Monday',
  },
];

/* The prebuilt Zap templates offered per tool.
 *
 * `subtitle` is the direction the data flows and `icons` is that direction
 * drawn — source first. In the first two templates of every group both
 * disagreed with the template's own `label`: "Create contacts in UCaaS added
 * to Google Contacts" creates the contact in UCaaS, so it flows Google
 * Contacts → UCaaS, and the row said the opposite in both its arrow and its
 * icons. Eight of the twelve rows were affected, in the same way each time.
 *
 * The labels are what has been trusted here, being the more specific of the
 * two — "Create rows in Google Sheets for new contacts added to UCaaS" can
 * only mean one thing. The Zapier templates behind the URLs have not been
 * opened to confirm it; if any turns out to run the other way, correct the
 * label and the arrow together rather than one of them. */
export const crmZapData: Record<
  string,
  {
    title: string;
    zaps: {
      label: string;
      subtitle: string;
      icons: string[];
      url: string;
    }[];
  }
> = {
  google_contacts: {
    title: 'Google Contacts',
    zaps: [
      {
        label: 'Create contacts in UCaaS added to Google Contacts',
        subtitle: 'Google Contacts → UCaaS',
        icons: [GoogleContact, McmLogo],
        url: 'https://zapier.com/editor/313251219/draft/313251220/setup',
      },
      {
        label: 'Create new contacts in Google Contacts added to UCaaS',
        subtitle: 'UCaaS → Google Contacts',
        icons: [McmLogo, GoogleContact],
        url: 'https://zapier.com/editor/313272431/draft/313272431/setup',
      },
      {
        label: 'Trigger SMS sending from new Google Contact',
        subtitle: 'Google Contacts → UCaaS (Send SMS)',
        icons: [GoogleContact, McmLogo],
        url: 'https://zapier.com/editor/313251582/draft/313251583/setup',
      },
      // {
      //   label: 'Trigger MMS sending from new Google Contact',
      //   subtitle: 'Google Contacts → Ucaas (Send MMS)',
      //   icons: [GoogleContact, McmLogo],
      // url: 'url',
      // },
    ],
  },
  google_sheets: {
    title: 'Google Sheets',
    zaps: [
      {
        label: 'Create new contacts in UCaaS added to Google Sheets',
        subtitle: 'Google Sheets → UCaaS',
        icons: [GoogleSheet, McmLogo],
        url: 'https://zapier.com/editor/313251890/draft/313251891/setup',
      },
      {
        label: 'Create rows in Google Sheets for new contacts added to UCaaS',
        subtitle: 'UCaaS → Google Sheets',
        icons: [McmLogo, GoogleSheet],
        url: 'https://zapier.com/editor/313273038/draft/313273039/setup',
      },
      {
        label: 'Trigger SMS sending from new Google Sheet row',
        subtitle: 'Google Sheets → UCaaS (Send SMS)',
        icons: [GoogleSheet, McmLogo],
        url: 'https://zapier.com/editor/313251934/draft/313251935/setup',
      },
      // {
      //   label: 'Trigger MMS sending from new Google Sheet row',
      //   subtitle: 'Google Sheets → Ucaas (Send MMS)',
      //   icons: [GoogleSheet, McmLogo],
      // url: 'url',
      // },
    ],
  },
  pipedrive: {
    title: 'Pipedrive',
    zaps: [
      {
        label: 'Create contacts in UCaaS added to Pipedrive',
        subtitle: 'Pipedrive → UCaaS',
        icons: [Pipedrive, McmLogo],
        url: 'https://zapier.com/editor/313252061/draft/313252062/setup',
      },
      {
        label: 'Create new contacts in Pipedrive added to UCaaS',
        subtitle: 'UCaaS → Pipedrive',
        icons: [McmLogo, Pipedrive],
        url: 'https://zapier.com/editor/313273430/draft/313273431/setup',
      },
      {
        label: 'Send SMS from new contact added in Pipedrive',
        subtitle: 'Pipedrive → UCaaS (Send SMS)',
        icons: [Pipedrive, McmLogo],
        url: 'https://zapier.com/editor/313252124/draft/313252125/setup',
      },
      // {
      //   label: 'Send MMS from new contact added in Pipedrive',
      //   subtitle: 'Pipedrive → UCaaS (Send MMS)',
      //   icons: [Pipedrive, McmLogo],
      // url:'url',
      // },
    ],
  },
  hubSpot: {
    title: 'HubSpot',
    zaps: [
      {
        label: 'Create contacts in UCaaS added to HubSpot',
        subtitle: 'HubSpot → UCaaS',
        icons: [Hubspot, McmLogo],
        url: 'https://zapier.com/editor/313252488/draft/313252489/setup',
      },
      {
        label: 'Create new contacts in HubSpot added to UCaaS',
        subtitle: 'UCaaS → HubSpot',
        icons: [McmLogo, Hubspot],
        url: 'https://zapier.com/editor/313273732/draft/313273733/setup',
      },
      {
        label: 'Send SMS from new contact added in HubSpot',
        subtitle: 'HubSpot → UCaaS (Send SMS)',
        icons: [Hubspot, McmLogo],
        url: 'https://zapier.com/editor/313252609/draft/313252610/setup',
      },
      // {
      //   label: 'Send MMS from new contact added in HubSpot',
      //   subtitle: 'HubSpot → UCaaS (Send MMS)',
      //   icons: [Hubspot, McmLogo],
      // url:'url',
      // },
    ],
  },
};

export const crmTypes = [
  { label: 'Google Contacts', value: 'GOOGLE_CONTACTS' },
  { label: 'Google Sheets', value: 'GOOGLE_SHEETS' },
  { label: 'Pipedrive', value: 'PIPEDRIVE' },
  { label: 'Monday', value: 'MONDAY' },
  { label: 'HubSpot', value: 'HUBSPOT' },
  { label: 'Zendesk', value: 'ZENDESK' },
  { label: 'Microsoft 365', value: 'MICROSOFT365' },
  { label: 'MS Teams', value: 'MSTEAMS' },
];
export const initialState = {
  type: null,
  path: '',
};
export const validationSchema = yup.object().shape({
  type: yup
    .object({
      label: yup.string().required('Type label is required'),
      value: yup.string().required('Type is required'),
    })
    .nullable()
    .required('Type is required'),
  path: yup.string().required('Path is required'),
});
/* Sample rows for the Manage Webhook table.
 *
 * Named SAMPLE, exported from here rather than fetched, and shown behind a
 * notice on the screen itself, because there is no webhook API in this product
 * — no route, no service function, and the table's own fetcher is commented
 * out in the page. These exist so the table can be designed and reviewed
 * against realistic content; they are not this account's webhooks and nothing
 * posts to them.
 *
 * Delete this constant in the same change that adds the real endpoint. */
export const SAMPLE_WEBHOOKS = [
  {
    uuid: 'sample-1',
    type: 'HUBSPOT',
    path: 'https://hooks.zapier.com/hooks/catch/1849201/b7k2n4x/',
    created_at: '2026-08-14T09:12:00.000Z',
  },
  {
    uuid: 'sample-2',
    type: 'GOOGLE_SHEETS',
    path: 'https://hooks.zapier.com/hooks/catch/1849201/m3p9q1c/',
    created_at: '2026-07-30T16:45:00.000Z',
  },
  {
    uuid: 'sample-3',
    type: 'PIPEDRIVE',
    path: 'https://hooks.zapier.com/hooks/catch/1849201/j5t8w6z/',
    created_at: '2026-06-02T11:08:00.000Z',
  },
];

export interface editForm {
  isEdit: boolean;
  formData: any;
}
export interface ReportingDataProps {
  items: { title: string; description: string; icon: string; id: string }[];
}
export const reportingData: Record<string, ReportingDataProps> = {
  zapier: {
    items: [
      {
        title: 'Google Contacts',
        id: 'google_contacts',
        description:
          'Sync your Google Contacts with UCAAS to easily manage your customer list and enable seamless calling and messaging directly from your contact book.',
        icon: GoogleContact,
      },
      {
        title: 'Google Sheets',
        id: 'google_sheets',
        description:
          'Import your contacts from Google Sheets into UCAAS and track all incoming and outgoing SMS with your customers.',
        icon: GoogleSheet,
      },
      {
        title: 'Pipedrive',
        id: 'pipedrive',
        description:
          'Sync your contacts and log SMS activity between Pipedrive and UCAAS for streamlined communication.',
        icon: Pipedrive,
      },
      {
        title: 'HubSpot',
        id: 'hubSpot',
        description:
          'Automatically import contacts and record SMS/MMS history in HubSpot with UCAAS integration.',
        icon: Hubspot,
      },
    ],
  },
};
