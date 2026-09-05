export const routes = {
  GLOBAL_SEARCH: {
    METHOD: 'POST',
    URL: '/api/global/search',
  },
  USER_DETAILS: {
    METHOD: 'GET',
    URL: '/api/user/info',
  },
  LOGIN: {
    METHOD: 'POST',
    URL: '/api/login',
  },
  GOOGLE_LOGIN: {
    METHOD: 'POST',
    URL: '/api/auth/google',
  },
  FORGET_PASSWORD: {
    METHOD: 'POST',
    URL: '/api/forgot-password',
  },
  NEW_PASSWORD: {
    METHOD: 'POST',
    URL: '/api/verify-password',
  },
  /* Invite links for new people (backend-patches/invites). */
  INVITE_INSPECT: {
    METHOD: 'POST',
    URL: '/api/invite/inspect',
  },
  INVITE_ACCEPT: {
    METHOD: 'POST',
    URL: '/api/invite/accept',
  },
  INVITE_RESEND: {
    METHOD: 'POST',
    URL: '/api/invite/resend',
  },
  INVITE_PENDING: {
    METHOD: 'POST',
    URL: '/api/invite/pending',
  },

  DASHBOARD_STATS: {
    METHOD: 'POST',
    URL: '/api/tenant/calls/graph',
  },

  CALL_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/report/call-list',
  },
  LOCAL_CALL_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/local-call-list',
  },
  CALL_LIST_BY_ID: {
    METHOD: 'POST',
    URL: '/api/tenant/report/history',
  },

  CALL_INBOUND_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/report/inbound-calls',
  },

  CALL_VOLUME_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/report/call-volume',
  },

  CALL_REPORT_AGENT_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/report/agents',
  },

  CALL_LOG_QUEUE_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/report/call-queue/list',
  },

  CALL_LOG_QUEUE_REPORT_DETAIL: {
    METHOD: 'POST',
    URL: '/api/tenant/report/call-queue',
  },

  CALL_LOG_ANALYTICS_DATA: {
    METHOD: 'POST',
    URL: '/api/tenant/report/call-analytics',
  },

  //Billing
  BILLING_LIST: {
    METHOD: 'POST',
    URL: '/api/billing/list',
  },

  //User List
  USER_LIST: {
    METHOD: 'POST',
    URL: '/api/user/list',
  },

  //Role List
  ROLE_LIST: {
    METHOD: 'POST',
    URL: '/api/user/role/list',
  },
  /* Rewrites a draft message. Returns text and never sends anything - what
     happens to the suggestion is entirely the composer's decision. */
  AI_MESSAGE_REWRITE: {
    METHOD: 'POST',
    URL: '/api/ai/message/rewrite',
  },
  /* Records a thumbs up/down. Stores which preset was rated, never the
     message itself - see the route's own comment for why. */
  AI_MESSAGE_REWRITE_FEEDBACK: {
    METHOD: 'POST',
    URL: '/api/ai/message/rewrite/feedback',
  },
  /* Summarizes the messages already loaded in an open conversation. Nothing
     is stored - the transcript is sent in the request body and discarded
     once the response comes back. */
  AI_CONVERSATION_SUMMARIZE: {
    METHOD: 'POST',
    URL: '/api/ai/conversation/summarize',
  },
  /* Answers a question grounded only in that same transcript. */
  AI_CONVERSATION_ASK: {
    METHOD: 'POST',
    URL: '/api/ai/conversation/ask',
  },
  /* Suggests replies someone could send next. Returns candidate strings -
     nothing is sent, so picking one stays the composer's decision. */
  AI_CONVERSATION_SUGGEST_REPLIES: {
    METHOD: 'POST',
    URL: '/api/ai/conversation/suggest-replies',
  },
  GET_URL_TYPE_LIST: {
    METHOD: 'POST',
    URL: '/api/ai/agent/list',
  },
  GET_URL_TYPE_CHAT_AGENT_LIST: {
    METHOD: 'POST',
    URL: '/api/ai/chat-agent/list',
  },
  GET_AI_RECEPTIONIST_LIST: {
    METHOD: 'POST',
    URL: '/api/ai/receptionist/list',
  },
  GET_AI_RECEPTIONIST_METRICS: {
    METHOD: 'POST',
    URL: '/api/ai/receptionist/metrics',
  },
  ADD_RECEPTIONIST_DID: {
    METHOD: 'POST',
    URL: '/api/ai/receptionist/add-did',
  },
  GET_RECEPTIONIST_ANALYTICS: {
    METHOD: 'POST',
    URL: '/api/ai/receptionist/analytics',
  },
  GET_CHAT_AGENT_ANALYTICS: {
    METHOD: 'POST',
    URL: '/api/ai/chat-agent/analytics',
  },
  GET_CHAT_AGENT_METRICS: {
    METHOD: 'POST',
    URL: '/api/ai/chat-agent/metrics',
  },
  //Admin Setting

  SITE_LIST: {
    METHOD: 'POST',
    URL: '/api/site/list',
  },
  UPSERT_SITE: {
    METHOD: 'POST',
    URL: '/api/site/upsert',
  },
  SITE_DELETE: {
    METHOD: 'DELETE',
    URL: '/api/site/delete',
  },
  // CAMPAIGN DASHBOARD
  CAMPAIGN_AGENT_ACTIVITY: {
    URL: '/api/campaign/agent/get-activity',
    METHOD: 'POST',
  },
  CAMPAIGN_ACTIVITY: {
    URL: '/api/campaign/get-activity',
    METHOD: 'POST',
  },
  // contact
  CONTACT_LIST: {
    URL: '/api/contact/list',
    // URL: '/contact/list',
    METHOD: 'POST',
  },
  ADD_CONTACT: {
    // URL: '/api/contact/add',
    URL: '/api/contact/upsert',
    METHOD: 'POST',
  },
  UPSERT_CONTACT: {
    URL: '/api/contact/upsert',
    // URL: '/api/contact/update',
    METHOD: 'POST',
  },
  BULK_UPSERT_CONTACT: {
    URL: '/api/contact/bulk/upsert',
    METHOD: 'POST',
  },
  /* Bringing contacts in from an outside address book. Unlike bulk upsert this
     one matches on the phone number, so importing the same address book twice
     updates the people already stored instead of saving them a second time. It
     also links past calls from that number to the contact it just saved. */
  SYNC_CONTACTS: {
    URL: '/api/contact/sync',
    METHOD: 'POST',
  },
  DELETE_CONTACT: {
    URL: '/api/contact/delete',
    METHOD: 'DELETE',
  },
  CONTACT_DETAIL: {
    URL: '/api/contact/detail',
    METHOD: 'POST',
  },
  GROUP_CONTACT_LEAD_LIST: {
    URL: '/api/contact/group/contact-lead/list',
    METHOD: 'POST',
  },
  /* Was pointed at the call-list report endpoint, whose rows were never
     keyed by number - every screen reading fetchContact()[number] (call
     history, inbox, contact-call-log-content) always got undefined,
     regardless of whether the number was really saved. This is the actual
     contacts endpoint the Contacts page itself uses. */
  FETCH_CONTACT: {
    URL: '/api/contact/list',
    METHOD: 'POST',
  },
  FETCH_ALL_PHONE: {
    URL: '/api/tenant/report/phone-call-list',
    METHOD: 'POST',
  },
  CONTACT_ACTIVITY: {
    URL: '/api/contact/activity/list',
    METHOD: 'POST',
  },
  MEDIA_UPLOAD_URL: {
    METHOD: 'POST',
    URL: '/api/media/upload/url',
  },
  // Template List
  TEMPLATE_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/user/template/list',
  },

  //user - department
  DEPARTMENT_LIST: {
    URL: '/api/tenant/department/list',
    METHOD: 'POST',
  },
  GET_DEPARTMENT_AND_CALL_LOGS: {
    URL: '/api/tenant/xml/call-logs',
    METHOD: 'POST',
  },
  CREATE_DEPARTMENT: {
    URL: '/api/tenant/department/upsert',
    METHOD: 'POST',
  },
  DELETE_DEPARTMENT: {
    URL: '/api/tenant/department/delete',
    METHOD: 'DELETE',
  },

  //user-role
  ROLES_LIST: {
    METHOD: 'POST',
    URL: '/api/user/role/list',
  },
  CAMPAIGN_NAME_LIST: {
    METHOD: 'POST',
    URL: '/api/campaign/campaign-contact/summery',
  },

  // number - all
  ALL_NUMBERS_LIST: {
    METHOD: 'POST',
    // URL: '/api/didw/list',
    URL: '/api/numbers/list',
  },

  FORWARDING_ACTION_TYPE: {
    METHOD: 'POST',
    URL: '/api/tenant/forwarding-action/type',
  },

  //Greeting
  GREETING_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/greeting/list',
  },
  // Assign DID
  ASSIGNED_DIDS: {
    METHOD: 'POST',
    URL: '/api/did/user-assigned',
  },
  // dialer
  PHONE_INFO: {
    METHOD: 'POST',
    URL: '/api/contact/dialer-phone-info',
  },
  PHONE_INFO_EXT: {
    METHOD: 'POST',
    URL: '/api/contact/info',
  },
  PHONE_INFO_V1: {
    METHOD: 'POST',
    URL: '/api/contact/info/1',
  },
  // Update Member Forwarding
  UPDATE_MEMBER: {
    METHOD: 'POST',
    URL: '/api/user/update',
  },

  MEETING_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/listing',
  },

  // CALENDAR_MEETING_LIST: {
  //   METHOD: 'POST',
  //   URL: '/api/v1/meeting/calendar',
  // },
  CALENDAR_MEETING_LIST: {
    METHOD: 'POST',
    URL: '/api/calendar/event-task/list',
  },
  SYNC_WITH_GOOGLE_AND_OUTLOOK: {
    METHOD: 'POST',
    URL: '/api/calendar/connect',
  },
  DISCONNECT_WITH_GOOGLE_AND_OUTLOOK: {
    METHOD: 'POST',
    URL: '/api/calendar/disconnect',
  },
  SAVE_CALENDAR_ACCESS_TOKEN: {
    METHOD: 'POST',
    URL: '/api/calendar/save-access-token',
  },
  GET_CALENDAR_ACCESS_TOKEN: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/get-access-token',
  },

  //Buy DID
  COUNTRY_LIST: {
    METHOD: 'GET',
    URL: '/api/didw/country-list',
  },
  DID_COUNTRY_LIST: {
    METHOD: 'POST',
    URL: '/api/did/country-list-V2',
  },
  DID_GROUP_TYPES: {
    METHOD: 'GET',
    URL: '/api/didw/group-types',
  },
  DID_REGION_LIST: {
    METHOD: 'POST',
    URL: '/api/didw/region-list',
  },
  GET_AREA_CODE: {
    METHOD: 'GET',
    URL: '/api/did/city-list',
  },
  DID_PREFIXES: {
    METHOD: 'POST',
    URL: '/api/didw/nanpa/prefix',
  },
  DID_GROUP: {
    METHOD: 'POST',
    URL: '/api/didw/group',
  },
  DID_AVAILABLE: {
    METHOD: 'POST',
    URL: '/api/didw/available',
  },
  FAX_DID_COUNTRY_LIST: {
    METHOD: 'POST',
    URL: '/api/fax/did/country/list',
  },
  FAX_DID_AVAILABLE: {
    METHOD: 'POST',
    URL: '/api/fax/available-did-numbers',
  },
  FAX_RESERVE_DID_NUMBER: {
    METHOD: 'POST',
    URL: '/api/fax/reserve-did-number',
  },
  FAX_BUY_DID_NUMBERS: {
    METHOD: 'POST',
    URL: '/api/fax/buy-did-numbers',
  },
  DID_BILLING_DETAILS: {
    METHOD: 'POST',
    URL: '/api/did/billing-details',
  },
  BILLING_STORAGE: {
    METHOD: 'POST',
    URL: '/api/plan/get-bucket-size',
  },
  BUY_EXTRA_STORAGE: {
    METHOD: 'POST',
    URL: '/api/plan/buy-extra-storage',
  },
  GET_PRORATED_COST: {
    METHOD: 'POST',
    URL: '/api/plan/get-prorated-cost',
  },
  RESERVE_DID: {
    METHOD: 'POST',
    URL: '/api/didw/reservation/general',
  },
  RESERVE_DID_QUANTITY: {
    METHOD: 'POST',
    URL: '/api/didw/reservation/quantity',
  },
  CARDS_LIST: {
    METHOD: 'POST',
    URL: '/api/card/list',
  },
  ADD_CARD: {
    METHOD: 'POST',
    URL: '/api/card/add',
  },
  DID_CREATE_ORDER: {
    METHOD: 'POST',
    URL: '/api/didw/create-order',
  },
  DID_COMPLETE_PROCESS: {
    METHOD: 'POST',
    URL: '/api/did/complete-did-process',
  },
  USER_UPDATE_STATUS: {
    METHOD: 'POST',
    URL: '/api/user/update-status',
  },
  MEETING_USER_FEEDBACK: {
    METHOD: 'POST',
    URL: '/api/video/meeting/feedback/save',
  },
  VALIDATE_MEETING: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/validate',
  },
  VALIDATE_MEETING_PASSWORD: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/validate/password',
  },
  GUEST_LOGIN: {
    METHOD: 'POST',
    URL: '/api/guest-login',
  },
  HASH_DECODE: {
    METHOD: 'POST',
    URL: '/api/video/meeting/hash/decode',
  },

  // Ivr
  UPSERT_IVR: {
    METHOD: 'POST',
    URL: '/api/tenant/ivr/upsert',
  },
  IVR_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/ivr/list',
  },
  IVR_DELETE: {
    METHOD: 'DELETE',
    URL: '/api/tenant/ivr/delete',
  },
  // Call Queue List
  CALL_QUEUE_LIST: {
    METHOD: 'POST',
    URL: '/api/call-queue/list',
  },
  SMS_DID_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/sms/did-list',
  },

  // video- meetings
  JOIN_MEETING: {
    METHOD: 'POST',
    URL: '/api/meeting/join',
  },
  CREATE_MEETING: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/save',
  },
  GET_SMS_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/sms/list',
  },
  SEND_SMS: {
    METHOD: 'POST',
    URL: '/api/v1/sms/send',
  },
  SEND_FAX: {
    METHOD: 'POST',
    URL: '/api/fax/send',
  },
  FAX_ASSIGNED_DID_NUMBERS: {
    METHOD: 'POST',
    URL: '/api/fax/did/number/assigned',
  },
  FAX_TO_NUMBER_LIST: {
    METHOD: 'POST',
    URL: '/api/fax/to-number-list',
  },
  FAX_LIST: {
    METHOD: 'POST',
    URL: '/api/fax/list',
  },
  USER_SMS_INFO: {
    METHOD: 'POST',
    URL: '/api/user/sms-info',
  },
  END_MEETING: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/end',
  },
  MEETING_DETAIL_INFO: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/detail',
  },
  SEND_INVITE: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/send-invite',
  },
  DELETE_MEETING: {
    METHOD: 'DELETE',
    URL: '/api/v1/meeting',
  },
  // CALENDAR
  CREATE_EVENT_AND_TASK: {
    METHOD: 'POST',
    URL: '/api/calendar/event-task/save',
  },
  GET_EVENT_AND_TASK_DETAILS: {
    METHOD: 'GET',
    URL: '/api/calendar/event-task',
  },
  DELETE_EVENT_AND_TASK: {
    METHOD: 'DELETE',
    URL: '/api/calendar/event-task/remove',
  },
  UPDATE_EVENT_TASK_STATUS: {
    METHOD: 'POST',
    URL: '/api/calendar/event-task/update-status',
  },
  ASSIGN_MEMBERS: {
    METHOD: 'POST',
    URL: '/api/calendar/event-task/assign-members',
  },
  RECORDING_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/recording-list',
  },
  ADD_MEMBER: {
    METHOD: 'POST',
    URL: '/api/user/add-member',
  },
  CREATE_CALL_QUEUE: {
    METHOD: 'POST',
    URL: '/api/call-queue/save',
  },
  UPDATE_CAMPAIGN_STATUS: {
    METHOD: 'POST',
    URL: '/api/campaign/change-state',
  },
  CAMPAIGN_JOIN_UPSERT: {
    METHOD: 'POST',
    URL: '/api/campaign/join/upsert',
  },
  DELETE_CAMPAIGN: {
    METHOD: 'DELETE',
    URL: '/api/campaign/delete',
  },
  CAMPAIGN_LIST: {
    METHOD: 'POST',
    URL: '/api/campaign/list',
  },
  DROPDOWN_LIST: {
    METHOD: 'POST',
    URL: '/api/campaign/dropdown/list',
  },
  CAMPAIGN_USER_LIST: {
    METHOD: 'POST',
    URL: '/api/campaign/lead-list',
  },
  CAMPAIGN_DETAIL: {
    METHOD: 'POST',
    URL: '/api/campaign/detail',
  },
  CAMPAIGN_ANALYTICS: {
    METHOD: 'POST',
    URL: '/api/campaign/analytics',
  },
  GROUP_LIST: {
    METHOD: 'POST',
    URL: '/api/contact/group/list',
  },
  // GROUP_LIST: {
  //   METHOD: 'POST',
  //   URL: '/api/campaign/group/list',
  // },
  CREATE_CAMPAIGN: {
    METHOD: 'POST',
    URL: '/api/campaign/upsert',
  },
  DELETE_GREETING: {
    METHOD: 'DELETE',
    URL: '/api/tenant/greeting/delete',
  },
  DELETE_MEDIA: {
    METHOD: 'DELETE',
    URL: '/api/media/delete',
  },
  CREATE_GREETING: {
    METHOD: 'POST',
    URL: '/api/tenant/greeting/create',
  },
  UPDATE_GREETING: {
    METHOD: 'POST',
    URL: '/api/tenant/greeting/update',
  },
  TEXT_TO_SPEECH: {
    METHOD: 'POST',
    URL: '/api/tenant/greeting/upload-v2',
  },
  GREETING_VOICE_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/greeting/voice-list',
  },
  // Lead Group
  CREATE_LEAD_GROUP: {
    METHOD: 'POST',
    URL: '/api/contact/group/upsert',
    // URL: '/api/campaign/group/add',
  },
  UPDATE_LEAD_GROUP: {
    METHOD: 'POST',
    // URL: '/api/campaign/group/update',
    URL: '/api/contact/group/upsert',
  },
  DELETE_LEAD_GROUP: {
    METHOD: 'POST',
    // URL: '/api/campaign/group/delete',
    URL: '/api/contact/group/delete',
  },
  UPLOAD_CONTACT: {
    METHOD: 'POST',
    URL: '/api/contact/upload',
  },
  EXPORT_CONTACT: {
    METHOD: 'GET',
    URL: '/api/contact/export',
  },
  ADD_LEAD_CONTACT: {
    METHOD: 'POST',
    URL: '/api/campaign/lead/add',
  },
  UPDATE_CONTACT: {
    METHOD: 'POST',
    URL: '/api/campaign/lead/update',
  },
  DELETE_LEAD_CONTACT: {
    METHOD: 'DELETE',
    URL: '/api/campaign/lead/delete',
  },
  GROUP_INFO: {
    METHOD: 'POST',
    URL: '/api/campaign/group/listById',
  },
  GET_DNC_COMPLAINTS: {
    METHOD: 'POST',
    URL: '/api/dnc/complaints',
  },
  ADD_DNC_CAMPAIGN: {
    METHOD: 'POST',
    URL: '/api/campaign/dnc/add',
  },
  UPLOAD_DNC_CAMPAIGN: {
    METHOD: 'POST',
    URL: '/api/campaign/dnc/upload',
  },
  DNC_CAMPAIGN_LIST: {
    METHOD: 'POST',
    URL: '/api/campaign/dnc/list',
  },
  DNC_CAMPAIGN_LIST_DELETE: {
    METHOD: 'DELETE',
    URL: '/api/campaign/dnc/remove',
  },
  GROUP_CONTACTS_LIST: {
    METHOD: 'POST',
    URL: '/api/campaign/group/lead-list',
  },
  // User
  USER_PROFILE_UPDATE: {
    METHOD: 'POST',
    URL: '/api/user/update',
  },
  UPDATE_USER_SETTINGS: {
    METHOD: 'POST',
    URL: '/api/update-user-setting',
  },
  GENERATE_PRIVATE_MEETING_LINK: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/generate-private-link',
  },
  GET_PRIVATE_MEETING_LINK: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/permanent-link',
  },

  VALIDATE_USER: {
    METHOD: 'POST',
    URL: '/api/user/validate',
  },

  //Billing
  ADD_FUND: {
    METHOD: 'POST',
    URL: '/api/payment/add-fundV2',
  },
  UPSERT_CALL_HANDLING_TEMPLATE: {
    URL: '/api/tenant/call-handling/template/upsert',
    METHOD: 'POST',
  },
  CALL_FORWARDING: {
    METHOD: 'POST',
    URL: '/api/did/call-forwarding',
  },
  CALL_HANDLING_LIST: {
    URL: '/api/tenant/call-handling/template/list',
    METHOD: 'POST',
  },
  AUTO_PURCHASE_PLAN: {
    METHOD: 'POST',
    URL: '/api/user/update-auto-recharge-settings',
  },
  UPDATE_LOW_BALANCE_SETTINGS: {
    METHOD: 'POST',
    URL: '/api/user/update-low-balance-settings',
  },
  DELETE_CARD: {
    METHOD: 'POST',
    URL: '/api/card/delete',
  },
  SET_DEFAULT_CARD: {
    METHOD: 'POST',
    URL: '/api/card/set-default',
  },
  // Assign DID
  ASSIGN_DID_NUMBER: {
    METHOD: 'POST',
    URL: '/api/did/assign-did',
  },
  REMOVE_ASSIGN: {
    METHOD: 'POST',
    URL: '/api/did/remove-assign-did',
  },
  // Delete Call Queue
  DELETE_CALL_QUEUE: {
    METHOD: 'DELETE',
    URL: '/api/call-queue/remove',
  },
  MONITORING_DEPARTMENT_LIST: {
    METHOD: 'GET',
    URL: '/api/tenant/department/role-based-list',
  },
  MONITORING_QUEUE_LIST: {
    METHOD: 'POST',
    URL: '/api/call-queue/role-based-queue',
  },
  GET_INVOICE: {
    METHOD: 'POST',
    URL: '/api/billing/list',
  },
  GET_INVOICE_DETAILS: {
    METHOD: 'GET',
    URL: '/api/payment/info',
  },
  DELETE_INVOICE: {
    METHOD: 'DELETE',
    URL: '/api/payment/delete',
  },
  SMS_LOG_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/sms/logs',
  },
  SMS_LOG_GRAPH: {
    METHOD: 'POST',
    URL: '/api/v1/sms/graph',
  },
  /* Numbers released back to the company. Already served by default-api and
     unused by the front end until now — it is the only place that records who a
     number was last assigned to before it was let go. GET, query params. */
  RELEASED_NUMBERS_LIST: {
    METHOD: 'GET',
    URL: '/api/did/released-number-listing',
  },
  DELETE_MEMBER: {
    METHOD: 'DELETE',
    URL: '/api/user/delete',
  },
  /* Person states (3 Sep 2026). Suspend / reactivate are served by default-api's
     personStateRoute (administrators only, never yourself, never the owner);
     PERSON_STATES returns every person's state, because /api/user/list does
     not carry `status`. List-deleted / restore are the 72-hour removal window. */
  PERSON_SUSPEND: {
    METHOD: 'POST',
    URL: '/api/person/suspend',
  },
  PERSON_REACTIVATE: {
    METHOD: 'POST',
    URL: '/api/person/reactivate',
  },
  PERSON_STATES: {
    METHOD: 'POST',
    URL: '/api/person/state',
  },
  /* Admin scope: who an administrator may act on. SET writes one person's
     scope (owner or account admin only); SCOPES lists everybody's resolved
     role and scope, joined by uuid on the People list. */
  PERSON_SCOPE_SET: {
    METHOD: 'POST',
    URL: '/api/person/scope',
  },
  PERSON_SCOPES: {
    METHOD: 'POST',
    URL: '/api/person/scope',
  },
  LIST_DELETED_MEMBERS: {
    METHOD: 'POST',
    URL: '/api/user/list-deleted',
  },
  RESTORE_MEMBER: {
    METHOD: 'POST',
    URL: '/api/user/restore',
  },
  GET_PLANS: {
    METHOD: 'GET',
    URL: '/api/plan/list',
  },
  GET_PLAN_INFO: {
    METHOD: 'GET',
    URL: '/api/plan/info',
  },
  CHECK_PLAN_RATES: {
    METHOD: 'POST',
    URL: '/api/plan/get-rate',
  },
  GET_SMS_RATE: {
    METHOD: 'POST',
    URL: '/api/plan/get-sms-rate',
  },
  UPGRADE_REQUEST_PLAN: {
    METHOD: 'POST',
    URL: '/api/plan/change/request',
  },
  CANCEL_UPGRADE_REQUEST_PLAN: {
    METHOD: 'GET',
    URL: '/api/plan/cancel/request',
  },
  UPGRADE_TRIAL_PLAN: {
    METHOD: 'POST',
    URL: '/api/payment/upgrade-trial-plan',
  },
  PAYMENT_CHARGE: {
    METHOD: 'POST',
    URL: '/api/payment/charge',
  },
  GET_OMNI_CHATS: {
    METHOD: 'POST',
    URL: '/api/v1/sms/omni/did-list',
  },

  // Department Monitor
  MONITOR_DEPARTMENT_LIST: {
    METHOD: 'GET',
    URL: '/api/tenant/department/role-based-list',
  },
  // Remove Forwarding
  REMOVE_FORWARDING: {
    METHOD: 'POST',
    URL: '/api/did/remove-forward-call-actions',
  },
  RELEASE_FORWARDING: {
    METHOD: 'GET',
    URL: '/api/did/release-forwarding',
  },
  /* Giving a number back to the carrier. Distinct from RELEASE_FORWARDING
     above, which only unwires forwarding in our own database and never
     contacts the carrier. */
  RELEASE_DID_TO_CARRIER: {
    METHOD: 'DELETE',
    URL: '/api/did/delete-did',
  },
  // User Template
  UPSERT_TEMPLATE: {
    METHOD: 'POST',
    URL: '/api/tenant/user/template/upsert',
  },
  TEMPLATE_DELETE: {
    METHOD: 'DELETE',
    URL: '/api/tenant/user/template/delete',
  },
  // Company settings, one section per former top-level key of the template blob
  COMPANY_SETTINGS_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/user/company-settings/list',
  },
  COMPANY_SETTINGS_GET: {
    METHOD: 'POST',
    URL: '/api/tenant/user/company-settings/get',
  },
  COMPANY_SETTINGS_SAVE: {
    METHOD: 'POST',
    URL: '/api/tenant/user/company-settings/save',
  },
  COMPANY_SETTINGS_HISTORY: {
    METHOD: 'POST',
    URL: '/api/tenant/user/company-settings/history',
  },
  // Delete Call Handling Template
  DELETE_CALL_HANDLING_TEMPLATE: {
    URL: '/api/tenant/call-handling/template/delete/',
    METHOD: 'DELETE',
  },

  CALLING_RATES_LIST: {
    METHOD: 'POST',
    URL: '/api/user/rates',
  },

  CHANGE_PASSWORD: {
    METHOD: 'POST',
    URL: '/api/change-password',
  },
  ASSIGN_NUMBER: {
    METHOD: 'POST',
    URL: '/api/did/assign-number',
  },
  ASSIGN_NUMBER_USER: {
    METHOD: 'POST',
    URL: '/api/did/assign-did',
  },

  // sign up
  SIGNUP: {
    METHOD: 'POST',
    URL: '/api/signup',
  },
  SIGNUP_ON_TRIAL: {
    METHOD: 'POST',
    URL: '/api/signup-on-trial',
  },
  SEND_OTP: {
    METHOD: 'POST',
    URL: '/api/send-otp',
  },
  SEND_OTP_FOR_SIGNUP: {
    METHOD: 'POST',
    URL: '/api/send-otp-signup',
  },
  VERIFY_OTP: {
    METHOD: 'POST',
    URL: '/api/verify-otp',
  },
  REQUEST_CUSTOMIZE_PLAN: {
    METHOD: 'POST',
    URL: '/api/plan/customize-plan',
  },
  ACCOUNT: {
    METHOD: 'POST',
    URL: '/api/validator/account',
  },

  CALL_RATE_DETAIL: {
    METHOD: 'POST',
    URL: '/api/user/rates/detail',
  },
  BUY_VIRTUAL_DID: {
    METHOD: 'POST',
    URL: '/api/did/buy-virtual-did',
  },
  INITIAL_PLAN_PAYMENT: {
    METHOD: 'POST',
    URL: '/api/payment/initial-plan-payment',
  },
  PARTICULAR_USER_DETAIL: {
    METHOD: 'GET',
    URL: '/api/user/detail',
  },
  UPSERT_CUSTOM_ROLE: {
    METHOD: 'POST',
    URL: '/api/user/role/custom/upsert',
  },
  ASSIGN_ROLE_BULK_USERS: {
    METHOD: 'POST',
    URL: '/api/user/assign-role-bulk-users',
  },
  DELETE_CUSTOM_ROLE: {
    METHOD: 'DELETE',
    URL: '/api/user/role/custom/remove/',
  },
  CRM_GET_TOKEN: {
    METHOD: 'POST',
    URL: '/api/crm/get-token',
  },
  HUB_SPOT_AUTH: {
    METHOD: 'GET',
    URL: '/api/crm/auth',
  },
  CRM_HUBSPOT_IS_CONNECTED: {
    METHOD: 'GET',
    URL: '/api/crm/is-connected',
  },
  CRM_HUBSPOT_DISCONNECT: {
    METHOD: 'POST',
    URL: '/api/crm/disconnect',
  },
  SAVE_CRM_SETTINGS: {
    METHOD: 'POST',
    URL: '/api/crm/settings',
  },
  GET_CRM_SETTINGS: {
    METHOD: 'GET',
    URL: '/api/crm/settings',
  },
  UPDATE_USER_DID: {
    METHOD: 'POST',
    URL: '/api/user/update-caller-id',
  },

  UPSERT_CALL_SCRIPT: {
    METHOD: 'POST',
    URL: '/api/campaign/call-script/upsert',
  },
  CALL_SCRIPT_LIST: {
    METHOD: 'POST',
    URL: '/api/campaign/call-script/list',
  },
  GET_CALL_SCRIPT_DETAIL: {
    METHOD: 'POST',
    URL: 'api/calls/call-script/detail',
  },
  CALL_SCRIPT_DELETE: {
    METHOD: 'DELETE',
    URL: '/api/campaign/call-script/delete',
  },

  DISPOSITION_LIST: {
    METHOD: 'POST',
    URL: '/api/campaign/disposition/list',
  },
  DISPOSITION_UPSERT: {
    METHOD: 'POST',
    URL: '/api/campaign/disposition/upsert',
  },
  DISPOSITION_DELETE: {
    METHOD: 'DELETE',
    URL: '/api/campaign/disposition/delete',
  },
  RUNNING_CAMPIGN_LIST: {
    METHOD: 'POST',
    URL: '/api/campaign/member-based',
  },
  CAMPAIGN_VALIDATE_LEAD_ASSIGNMENT: {
    METHOD: 'POST',
    URL: '/api/campaign/lead/validate-assignment',
  },
  RUNNING_CAMPIGN_CONTACTS: {
    METHOD: 'POST',
    URL: '/api/campaign/random-contacts',
  },
  ADD_DISPOSITION_FOR_LEAD: {
    METHOD: 'POST',
    URL: '/api/campaign/notes-disposition/save',
  },
  ADD_NOTE_DISPOSITION_FOR_LEAD: {
    METHOD: 'POST',
    URL: '/api/contact/activity-note/save',
  },
  // Campaign Summary
  CAMPAIGN_SUMMARY: {
    METHOD: 'POST',
    URL: '/api/campaign/summary',
  },
  // Leads/Contact activity
  CONATCT_CAMPAIGN_ACTIVITY_LIST: {
    METHOD: 'POST',
    URL: '/api/contact/campaign-activity/list',
  },

  CONTACT_TAG_UPDATE: {
    METHOD: 'POST',
    URL: '/api/contact/tag',
  },
  CAMPAIGN_CALL_LOGS: {
    METHOD: 'POST',
    URL: '/api/campaign/call/statistics',
  },
  CAMPAIGN_RETRY_CALL_LOG: {
    METHOD: 'POST',
    URL: '/api/campaign/retry/call-log',
  },
  GET_ALL_NOTES: {
    METHOD: 'POST',
    URL: '/api/contact/call-notes',
  },
  CALL_QUEUE_NOTES_LIST: {
    METHOD: 'POST',
    URL: '/api/call-queue/notes/list',
  },
  ADD_LEAD_IN_EXISTING_GROUP: {
    METHOD: 'POST',
    URL: '/api/campaign/groups/update',
  },
  USER_BASED_DEPARTMENT_LIST: {
    METHOD: 'POST',
    URL: '/api/tenant/user/involvement',
  },
  CALLQUEUE_INVOLVEMENT: {
    METHOD: 'POST',
    URL: '/api/call-queue/queue-involvement',
  },
  MAKE_CALLQUEUE_AVAILABLE: {
    METHOD: 'POST',
    URL: '/api/call-queue/agent/status',
  },
  USER_BASED_CAMPAIGNS_LIST: {
    METHOD: 'POST',
    URL: '/api/campaign/user-campaigns',
  },
  CAMPAIGN_DISPOSITION_SUMMARY: {
    METHOD: 'POST',
    URL: '/api/campaign/disposition/summary',
  },
  DISPOSITION_LOGS_SUMMARY: {
    METHOD: 'POST',
    URL: '/api/campaign/disposition/general-summary',
  },
  DISPOSITION_LOG_SINGAL_SUMMARY: {
    METHOD: 'POST',
    URL: '/api/campaign/disposition/general-single-summary',
  },
  GET_WHATSAPP_TEMPLATE: {
    METHOD: 'POST',
    URL: '/api/omni/whatsapp/message-templates',
  },
  SEND_WHATSAPP_MESSAGE: {
    METHOD: 'POST',
    URL: '/api/v1/sms/send-omni',
  },
  GET_WHATSAPP_CHATS: {
    METHOD: 'POST',
    URL: '/api/v1/sms/omni/did-list',
  },
  GET_WHATSAPP_MESSAGES: {
    METHOD: 'POST',
    URL: '/api/v1/sms/omni/list',
  },
  LICENSE_PURCHASE: {
    METHOD: 'POST',
    URL: '/api/user/buy-license',
  },
  ALL_OMNI_CHANNELS_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/omni/list',
  },
  OMNI_CHANGE_STATUS: {
    METHOD: 'POST',
    URL: '/api/omni/change-status',
  },
  LICENSE_USER_LIST: {
    METHOD: 'POST',
    URL: '/api/user/licenses',
  },
  REVOKE_LICENSE: {
    METHOD: 'POST',
    URL: '/api/user/revoke-license',
  },
  SHARE_RECORDING: {
    METHOD: 'POST',
    URL: '/api/video/meeting/shared-video',
  },
  ADD_RUNNING_CAMPAIGN_EVENT: {
    METHOD: 'POST',
    URL: '/api/campaign/agent/save-activity',
  },
  GET_CAMPAIGN_ACTIVITY_RECORDS: {
    METHOD: 'POST',
    URL: '/api/campaign/get-activity-records',
  },
  GET_CAMPAIGN_AGENT_ACTIVITY_RECORDS: {
    METHOD: 'POST',
    URL: '/api/campaign/agent/get-activity-records',
  },
  VIDEO_DASHBOARD_STATS: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/summary',
  },
  DEVICE_SECURITY: {
    METHOD: 'POST',
    URL: '/api/user/device-securities',
  },
  LOGOUT: {
    METHOD: 'POST',
    URL: '/api/logout',
  },
  RENEW_PLAN: {
    METHOD: 'POST',
    URL: '/api/payment/plan-renew',
  },
  AI_USER_KNOWLEDGE_BASE: {
    METHOD: 'POST',
    URL: '/api/ai/user/knowledge-base',
  },
  SITE_CRAWL: {
    METHOD: 'POST',
    URL: '/api/ai/chat-agent/site-crawl',
  },
  AI_SUMMARIZE_KNOWLEDGE_BASE: {
    METHOD: 'POST',
    URL: '/api/ai/summarize/knowledge-base',
  },
  AI_KNOWLEDGE_BASE_REVIEW_JOB: {
    METHOD: 'POST',
    URL: '/api/ai/knowledge-base/review-job',
  },
  AI_KNOWLEDGE_BASE_REVIEW_JOB_STATUS: {
    METHOD: 'POST',
    URL: '/api/ai/knowledge-base/review-job/status',
  },
  AI_KNOWLEDGE_BASE_REVIEW_JOB_CLEANUP: {
    METHOD: 'POST',
    URL: '/api/ai/knowledge-base/review-job/cleanup',
  },
  AI_KNOWLEDGE_BASE_REVIEW_PDF_TEXT: {
    METHOD: 'POST',
    URL: '/api/ai/knowledge-base/review-pdf-text',
  },
  AI_GENERATE_KNOWLEDGE_BASE_FAQ: {
    METHOD: 'POST',
    URL: '/api/ai/knowledge-base/generate-faq',
  },
  GET_AI_AGENT_ATTACHED_LIST: {
    METHOD: 'POST',
    URL: '/api/ai/agent/attached-list',
  },
  AI_AGENT_CREATE: {
    METHOD: 'POST',
    URL: '/api/ai/chat-agent/create',
  },
  AI_AGENT_DRAFT_CREATE: {
    METHOD: 'POST',
    URL: '/api/ai/chat-agent/draft/create',
  },
  CREATE_AI_RECEPTIONIST: {
    METHOD: 'POST',
    URL: '/api/ai/receptionist/create',
  },
  CREATE_AI_RECEPTIONIST_DRAFT: {
    METHOD: 'POST',
    URL: '/api/ai/receptionist/draft/create',
  },
  UPDATE_AI_RECEPTIONIST: {
    METHOD: 'POST',
    URL: '/api/ai/receptionist/update',
  },
  AI_AGENT_UPDATE: {
    METHOD: 'POST',
    URL: '/api/ai/chat-agent/update',
  },
  AI_AGENT_STATUS_UPDATE: {
    METHOD: 'POST',
    URL: '/api/ai/agent/status',
  },
  AI_AGENT_TYPE: {
    METHOD: 'POST',
    URL: '/api/ai/agent-type',
  },
  AI_USER_INGEST_URL: {
    METHOD: 'POST',
    URL: '/api/ai/user/ingest/url',
  },
  AI_USER_ADD_CONTENT: {
    METHOD: 'POST',
    URL: '/api/ai/user/add-content',
  },
  AI_AGENT_GET_KNOWLEDGE_BASE: {
    METHOD: 'POST',
    URL: '/api/ai/agent/get-knowledge-base',
  },
  DELETE_AI_AGENT_KNOWLEDGE_BASE: {
    METHOD: 'POST',
    URL: '/api/ai/agent/delete-knowledge-base',
  },
  AI_AGENT_DELETE: {
    METHOD: 'POST',
    URL: '/api/ai/chat-agent/delete',
  },
  DELETE_AI_RECEPTIONIST: {
    METHOD: 'POST',
    URL: '/api/ai/receptionist/delete',
  },
  AI_VOICE_LIST: {
    METHOD: 'POST',
    URL: '/api/ai/voice/list',
  },
  AI_VOICE_PREVIEW: {
    METHOD: 'POST',
    URL: '/api/ai/voice/preview',
  },
  GET_AI_DOMAIN_LIST: {
    METHOD: 'POST',
    URL: '/api/ai/agent/get-integrations-list',
  },
  AI_ADD_DOMAIN: {
    METHOD: 'POST',
    URL: '/api/ai/agent/add-integration',
  },
  ADD_GLOBAL_INGESTION: {
    METHOD: 'POST',
    URL: '/api/ai/agent/attach-ingestion',
  },
  ADD_GLOBAL_KNOWLEDGE_BASE: {
    METHOD: 'POST',
    URL: '/api/ai/agent/attach-multi-ingestion',
  },
  AI_DOMAIN_DELETE: {
    METHOD: 'POST',
    URL: '/api/ai/agent/delete-integration',
  },
  AI_SETTINGS: {
    METHOD: 'POST',
    URL: '/api/ai/setting',
  },
  GET_AI_SETTINGS: {
    METHOD: 'GET',
    URL: '/api/ai/setting/list',
  },
  GET_UPLOAD_PDF_URL: {
    METHOD: 'POST',
    URL: '/api/upload',
  },
  GET_SUMMARY_UPLOAD_PDF_URL: {
    METHOD: 'POST',
    URL: '/api/upload/temp',
  },
  UPLOAD_INGEST_PDF: {
    METHOD: 'POST',
    URL: '/api/ai/user/ingest/pdf',
  },
  DOWNLOAD_PDF: {
    METHOD: 'POST',
    URL: '/api/download',
  },

  GET_AGENT_LIST: {
    METHOD: 'GET',
    URL: '/api/agent',
  },

  GET_SESSION_LIST: {
    METHOD: 'POST',
    URL: '/api/ai/agent/session',
  },

  GET_SESSION_CHAT: {
    METHOD: 'POST',
    URL: '/api/ai/agent/session/get',
  },
  // My Plan Details
  MY_PLAN_DETAILS: {
    METHOD: 'POST',
    URL: '/api/user/current-plan-detail',
  },
  // CREATE IDENTITY
  GET_IDENTITY_REQUIREMENTS: {
    METHOD: 'GET',
    URL: '/api/identity/requirements',
  },
  GET_IDENTITY_PROOF_TYPE: {
    METHOD: 'POST',
    URL: '/api/identity/proof/types',
  },
  GET_IDENTITY_SUPPORTING_DOCUMENT_TEMPLATE: {
    METHOD: 'GET',
    URL: '/api/identity/supporting/document/templates',
  },
  GET_IDENTITY_LIST: {
    METHOD: 'POST',
    URL: '/api/identity/list',
  },
  CREATE_IDENTITY: {
    METHOD: 'POST',
    URL: '/api/identity/create',
  },
  UPDATE_IDENTITY: {
    METHOD: 'POST',
    URL: '/api/identity/update',
  },
  DELETE_IDENTITY: {
    METHOD: 'DELETE',
    URL: '/api/identity/delete',
  },
  UPLOAD_IDENTITY_PROOF: {
    METHOD: 'POST',
    URL: '/api/identity/upload/proof',
  },
  UPLOAD_IDENTITY_SUPPORTING_DOCUMENTS: {
    METHOD: 'POST',
    URL: 'api/identity/upload/supporting/document',
  },
  GET_ADDRESS_LIST: {
    METHOD: 'POST',
    URL: '/api/identity/address/list',
  },
  CREATE_ADDRESS: {
    METHOD: 'POST',
    URL: '/api/identity/address/create',
  },
  UPDATE_ADDRESS: {
    METHOD: 'POST',
    URL: '/api/identity/address/update',
  },
  DELETE_ADDRESS: {
    METHOD: 'DELETE',
    URL: '/api/identity/address/delete',
  },
  UPLOAD_ADDRESS_PROOF: {
    METHOD: 'POST',
    URL: '/api/identity/address/upload/proof',
  },
  GET_VERIFICATION_LIST: {
    METHOD: 'POST',
    URL: '/api/identity/did/identity/verification/list',
  },
  DID_ASSIGN: {
    METHOD: 'POST',
    URL: '/api/identity/did/assign',
  },
  DELETE_UPLOADED_FILE: {
    METHOD: 'DELETE',
    URL: '/api/identity/address/delete/proof',
  },
  GET_DLC_STATUS: {
    METHOD: 'POST',
    URL: '/api/v1/ten-dlc/brand-verified',
  },

  //10DLC
  BRAND_CREATE: {
    METHOD: 'POST',
    URL: '/api/v1/brand/create',
  },
  BRAND_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/brand/list',
  },
  BRAND_DELETE: {
    METHOD: 'POST',
    URL: '/api/v1/brand/delete',
  },

  //USE-CASE
  USE_CASE_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/get-all-usecase',
  },

  //CAMPAIGN
  ADD_CAMPAIGN: {
    METHOD: 'POST',
    URL: '/api/v1/brand/campaign-create',
  },

  CAMPAIGN_DELETE: {
    METHOD: 'POST',
    /* Had a trailing space, which encodes to %20 and never matches the backend
       route — so deleting a 10DLC campaign always 404'd, and the confirm dialog
       never closed because it only closes on success. */
    URL: '/api/v1/brand/campaign-delete',
  },

  CAMPAIGN_10DLC: {
    METHOD: 'POST',
    URL: '/api/v1/brand/campaign-list',
  },

  TERMS_PREVIEW_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/mno-check-brand-qulification-usecase',
  },

  RESELLER_CREATE: {
    METHOD: 'POST',
    URL: '/api/v1/brand/reseller-create',
  },
  RESELLER_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/brand/reseller-list',
  },
  RESELLER_DELETE: {
    METHOD: 'POST',
    URL: '/api/v1/brand/reseller-delete',
  },
  GCP_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/get-connectivity-partners',
  },
  // SOCIAL MEDIA CHANNELS
  INTEGRATE_SOCIAL_MEDIA_CHANNEL: {
    METHOD: 'POST',
    URL: '/api/v1/sms/integrate/social-media-channel',
  },
  GET_SOCIAL_MEDIA_CHANNEL_LIST: {
    METHOD: 'POST',
    URL: '/api/v1/sms/omni-channel-list',
  },
  OMNI_DELETE: {
    METHOD: 'DELETE',
    URL: '/api/omni/delete',
  },
  GET_NUMBERS_COUNT: {
    METHOD: 'GET',
    URL: '/api/did/numbers',
  },
  // SINGUP-TAX-CALCULATION
  GET_TAXES_AND_FEES: {
    METHOD: 'POST',
    URL: '/api/plan/calculate-tax',
  },

  // VIDEO-RECORDING
  START_STOP_RECORDING: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/record',
  },
  MEETING_DETAILS: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/detail',
  },

  /* Returns the whole company record. The user-details endpoint builds
     company_info from a fixed attribute list that leaves out name, city, state,
     country and postal code — which is why the company name could not be shown
     from it. This one returns every column. */
  COMPANY_INFO: {
    METHOD: 'GET',
    URL: '/api/admin/company/info',
  },
  /* Updates the company's own record — name and postal address. The endpoint
     existed all along; nothing in the app had ever called it, which is why the
     company name was set at signup and never editable again. */
  COMPANY_UPSERT: {
    METHOD: 'POST',
    URL: '/api/admin/company/upsert',
  },
  /* The company's own record, read and written by its own admins. The company
     is taken from the session on the server, never from the body. These two
     are the tenant-scoped doors that COMPANY_INFO and COMPANY_UPSERT never
     were: those sit under /api/admin behind the platform-staff check. */
  COMPANY_SELF: {
    METHOD: 'POST',
    URL: '/api/company/self',
  },
  COMPANY_SELF_UPDATE: {
    METHOD: 'POST',
    URL: '/api/company/self/update',
  },
  // MAIN SITE INFO
  MAIN_SITE_INFO: {
    METHOD: 'POST',
    URL: '/api/admin/organisation/get-meta-data',
  },
  //  Leave meeting
  LEAVE_MEETING: {
    METHOD: 'POST',
    URL: '/api/v1/meeting/leave-meeting',
  },
  // Chat Channel
  CREATE_CHANNEL: {
    METHOD: 'POST',
    URL: '/api/chat/channel/create',
  },
  UPDATE_CHANNEL: {
    METHOD: 'POST',
    URL: '/api/chat/channel/update',
  },
  CALL_QUEUE_DETAIL: {
    METHOD: 'POST',
    URL: '/api/call-queue/info',
  },
  CALL_QUEUE_DISPOSITION: {
    METHOD: 'POST',
    URL: '/api/call-queue/notes-disposition/save',
  },
  FACEBOOK_AUTH_START: {
    METHOD: 'GET',
    URL: '/api/omni/auth/facebook/start',
  },
  FACEBOOK_AUTH_CALLBACK: {
    METHOD: 'GET',
    URL: '/api/omni/auth/facebook/callback',
  },
};
