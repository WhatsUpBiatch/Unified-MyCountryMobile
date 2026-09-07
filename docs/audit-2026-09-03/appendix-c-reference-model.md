# Reference model: a person's own settings, the people directory, and roles

Extracted 2026-09-03 from local sources only. Two reference products. The point is the RULES that decide
where a capability sits, who may change it, and what is walled off from whom, not the feature list.

Sources read
- Dialpad: help corpus mirror at /root/dialpad-kb/articles/*.md. Every claim below cites the article filename.
- Genesys Cloud: the Platform API spec at /tmp/swagger.json (PureCloud Platform API v2, 2,178 paths) plus the
  study notes at /root/mycountrymobile-web/docs/genesys-cloud-reference.md. The Genesys help site is not readable
  offline, so Genesys claims are API-level facts (endpoint, required permission, model field). Where I describe
  what the Genesys UI does, it is marked as inference.

Marking convention
- "They do X" = stated in the cited article or visible in the spec.
- "I infer X" = my reading of why, or a gap I filled. Treat as a hypothesis.

Vocabulary in this file: I use each product's own words in sections 1-4 and translate in section 6.

---

## 1. Settings a PERSON controls on themselves

### 1A. Dialpad

Dialpad splits a person's own settings across two surfaces (your-dialpad-profile.md):
- "Your Settings" on dialpad.com (also reachable as Profile from the in-app menu): the durable account settings.
- The in-app avatar menu / "Preferences": status, DND, notifications and sounds (message-notifications.md,
  set-a-custom-status.md, set-do-not-disturb-mode.md).

Legend for the admin columns: See = admin can view it; Edit = admin can change it for the person; Lock = admin
can make it read-only for the person; Default = admin can set the starting/bulk value.

#### Profile (public information: "name, photo, job title, and pronouns" - your-dialpad-profile.md)

| Setting | Person | Admin See | Admin Edit | Admin Lock | Admin Default | Source |
|---|---|---|---|---|---|---|
| Name, job title, pronouns | Yes | Yes | Only via proxy login (logged) | No | No | make-changes-to-your-profile.md; use-the-enterprise-support-portal.md |
| Profile picture | Yes (or default to Google/O365 photo) | Yes | No | No | No | make-changes-to-your-profile.md |
| Email address | **No** | Yes | **Office Admin only** (Options > Admin > Edit Email Address); Google/M365 tenants change it in the suite | n/a | n/a | make-changes-to-your-profile.md; change-an-email-address.md |
| Direct phone number | **No** | Yes | **Not even the admin** - "either you and your Admin will need to contact our Customer Care Team" | n/a | n/a | make-changes-to-your-profile.md; number-assignment-faqs.md |
| App language | Yes | Yes | No | Yes (policy set "IVR, Voice and Ai Language" is the related lock; app language itself not listed) | Yes - "Office settings set a user's default language" | your-dialpad-profile.md; make-changes-to-your-profile.md |
| Timezone | Yes (default PST) | Yes | No | Yes (policy set "Timezone") | No explicit default beyond PST | your-dialpad-profile.md; user-settings-policies.md; set-your-office-timezone.md |
| Working location (personal E911, up to 10) | Yes | Yes | No ("Users can only update their personal working location details") | Yes (policy set "Location") | Yes - office E911 is the default for all members, admin can apply to existing/new members | e911-emergency-services.md; user-settings-policies.md |

They do: "All Dialpad users are able to change their name, job title, pronouns, profile picture, and language on
their own. Email addresses, however, can only be changed by the Office Admin." (make-changes-to-your-profile.md)

They do: "Do Office Admins have access to individual user settings? Nope. Office Admins can do things like assign
phone numbers to people and enable integrations, but they can't change your personal profile."
(admin-permissions-in-dialpad.md FAQ). The exception is proxy login, which must be separately granted, shows a red
banner, and is written to the user's Notes/changelog (manage-your-users.md; use-the-enterprise-support-portal.md).

#### Preferences / app (in-app avatar menu)

| Setting | Person | Admin See | Admin Edit | Admin Lock | Admin Default | Source |
|---|---|---|---|---|---|---|
| In-app notifications + sound | Yes (avatar > Preferences) | No | No | No | No | message-notifications.md |
| Per-shared-line notifications (messages, voicemail) | Yes, "done per user" | No | No | Yes (policy set "Notify me about - Office mainline, departments & cc activity") | No | message-notifications.md; user-settings-policies.md |
| Do Not Disturb (global) + timer | Yes | Yes (presence icon) | **No** - "Admins cannot control a user's global DND status" | No | No | set-do-not-disturb-mode.md; working-as-a-department-administrator.md |
| Auto DND (calendar / working hours) | Yes, opt-in | n/a | No | **Office admin gate**: Off (controls hidden, behaviour stops) or "On, turned off by default" | Off by default; office overrides company | auto-do-not-disturb-dnd.md |
| Custom status text + templates + timer | Yes | Yes | No | No | No | set-a-custom-status.md |
| Contact-centre off-duty status choice | Yes (picks from list) | Yes (Agents tab) | CC Admin yes by default; Supervisor only if granted | Per CC: "Allow agents to change their availability" (on by default) | Office admin defines the status list | custom-off-duty-status.md; manage-a-contact-center.md |
| Per-group Active toggle | Yes | Yes | Department/Office admin can toggle | No | No | call-center-dnd-vs-off-duty-toggle.md; working-as-a-department-administrator.md |
| Ringtone | Yes | No | No | Yes (policy set "Ringtone") | Office ringtone preference via ES portal | user-settings-policies.md; use-the-enterprise-support-portal.md |
| Audio devices (mic/speaker) | Yes, OS + app | No | No | No | No | adjust-your-dialpad-audio-settings.md |

#### Phone / calls ("Call Handling & Voicemail" on Your Settings)

| Setting | Person | Admin See | Admin Edit | Admin Lock | Admin Default | Source |
|---|---|---|---|---|---|---|
| Global caller ID (which of my numbers shows) | Yes, from the numbers they are entitled to | Yes | No | Yes (policy set "Caller ID Mask") | Yes (bulk setting "Caller ID"); office decides whether office/group numbers or "hide caller ID" are even offered | customize-your-caller-id.md; enable-office-wide-caller-id.md; bulk-user-settings.md |
| Incoming caller ID on forwarded calls | Yes | No | No | No | No | customize-your-caller-id.md |
| Ring duration | Yes (slider) | No | No | Yes (policy set) | Yes (bulk; capped at 45 s) | your-dialpad-profile.md; bulk-user-settings.md |
| Call handling when busy (call waiting / busy / advanced routing) | Yes | No | No | Yes | Yes (bulk) | your-dialpad-profile.md; bulk-user-settings.md |
| Advanced missed-call routing | Yes | No | No | Yes | Yes (bulk) | user-settings-policies.md; bulk-user-settings.md |
| Personal working hours (split shifts, up to 4/day) | Yes | No | No | Yes | Yes (bulk) | set-your-personal-working-hours.md; bulk-user-settings.md |
| Hold music | Only on Enterprise | No | No | Yes | Yes (bulk); otherwise inherited from Main Line | hold-music-faqs.md; bulk-user-settings.md |
| Individual call queue (size, wait, greeting, exit key) | Enterprise only | No | No | No | No | individual-call-queues-enterprise-accounts-only.md |
| Automatic call recording on/off for my calls | Yes, "if allowed by your Office Administrator" | Yes | Office admin enables per user or office-wide | Yes (by not allowing) | Yes | your-dialpad-profile.md; enable-office-wide-call-recording.md |
| Access to my own recordings | Only if "Allow users to access their personal call recordings" | Yes, only if "Allow admins to access personal user call recordings" (toggling this emails every non-admin) | n/a | n/a | Off | enable-office-wide-call-recording.md |
| Dialpad AI auto-start + show transcript | Yes | No | No | Yes (2 policy sets) | Yes (bulk) | your-dialpad-profile.md; user-settings-policies.md |
| IVR / voicemail / AI language | Yes ("If no language is set, it will default to the language set for the office") | No | No | Yes | Yes (bulk + office default) | ivr-and-voicemail-language.md |
| Devices: add desk phone, add up to 5 forwarding numbers, force logout | Yes | Yes (ES portal shows devices, SIP registration) | Admin adds desk phones; user self-provisioning only if office allows | Office toggle "Allow Team members to self-provision deskphones" | No | manage-your-dialpad-devices.md; manage-a-user-desk-phone.md |
| Executive-Assistant pairing | Can request; both sides confirm by email | Yes | Admin can create for anyone | No | No | assign-executive-assistant-pairings.md |
| SMS auto-reply, spam prevention, remote screen control | Yes | No | No | Remote control needs office enable | No | your-dialpad-profile.md; remote-access-control.md |
| Fax cover sheet | Yes | No | No | Yes | No | user-settings-policies.md |

#### Voicemail / greetings

| Setting | Person | Admin See | Admin Edit | Admin Lock | Admin Default | Source |
|---|---|---|---|---|---|---|
| Voicemail greeting (record / upload MP3 <=10 MB, <=45 s, or default) | Yes | Only via proxy | Only via proxy (logged) | Yes (policy set "Voicemail audio file") | Yes (bulk "Upload a new voicemail greeting") | manage-your-voicemail.md; use-the-enterprise-support-portal.md; bulk-user-settings.md |
| Voicemail email notification | Yes | No | No | No | No (but Department notification is a separate per-operator setting that overrides) | manage-your-voicemail.md; working-as-an-operator.md |
| Press-0 escape destination | Yes, limited to groups the person belongs to | No | No | No | No | your-dialpad-profile.md |
| User & voicemail PIN | Yes (auto-generated, user changes) | No | No | No | n/a | your-dialpad-profile.md |
| Voicemail drop (outbound canned VM) | Yes, if licensed | No | No | No | No | your-dialpad-profile.md |
| Cloud backup to Google Drive | Yes | No | No | No | No | manage-your-voicemail.md |
| Retention of my data | **No** | Yes | Company/Office admin per user (Options > Admin > Set retention policies); inherits office -> group -> user | n/a | Office policy inherited | data-retention-policy.md |

#### Security

| Setting | Person | Admin | Source |
|---|---|---|---|
| Password change (12+ chars, number, upper, symbol) | Yes, must supply current | Admin cannot set a password; SSO tenants change it in the suite | change-or-reset-your-password.md |
| MFA (email or SMS OTP) | Mandatory for non-SSO users; person cannot opt out | Company Admin enables; keeps an Exception List; unlocks a user after 5 bad codes (Office Settings > Users > Options > Admin > Unlock account access) | mfa.md |
| SSO enforcement | n/a | Company Admin: "Prevent users from logging in with other SSO providers" blocks Google/Microsoft and password login | authentication.md; scim-faqs.md |
| Devices / sessions | Person sees devices, deletes one, force-logs-out all | ES portal: view devices, SIP registration, delete a device | secure-your-dialpad-account.md; use-the-enterprise-support-portal.md |
| Audit of changes | Person reviews own call/message history | Company/Office admin exports the Event Changelog CSV | secure-your-dialpad-account.md; event-changelog.md |

The lock mechanism itself (user-settings-policies.md): a User Settings Policy is a checklist of 15 permission
sets ("Turn on Ai for my calls", "Show transcript when a call starts", "Personal Working Hours", "Voicemail audio
file", "Music on Hold", "Ring Duration", "Call Handling", "Advanced missed call routing", "Caller ID Mask", "IVR,
Voice and Ai Language", "Timezone", "Ringtone", "Location", "Fax Cover Sheet", "Notify me about - Office mainline,
departments & cc activity"). Unchecked = read-only for the person. Policies are set at Company, Office or User
level and "User policies override Office policies, which override Company policies". Early-adopter, ES portal only.

The default mechanism (bulk-user-settings.md): Bulk user settings writes a VALUE for the same family of settings to
every user under a Target Key (Company, Office, or Group = Contact Center / Coaching Team / Department). "If you
don't modify a field, settings will revert to the default setting." Super Admins only.

I infer: Dialpad's three admin levers on a personal setting are separate objects and stack as
default (bulk) -> allow (office-wide toggle that adds options to the person's dropdown) -> lock (policy that
greys out the field). The person's own value always wins until a lock removes the control.

### 1B. Genesys Cloud (from the API spec)

Genesys does not have a "Your Settings" article I can read; the API shows the split by which endpoints exist
under /users/me or need no permission versus those that need a directory:/telephony:/voicemail: permission.

#### Profile (User / UpdateUser models)

Writable fields on UpdateUser: name, preferredName, title, department, email, username, addresses (one entry per
media type: PHONE / EMAIL / SMS, each typed PRIMARY / WORK / HOME / MOBILE / MAIN / OTHER, or an internal
extension), images, manager, chat, certifications, biography (biography, interests, hobbies, spouse, education),
employerInfo (officialName, employeeId, employeeType, dateHire), profileSkills, locations, groups, acdAutoAnswer,
state. Read-only on User: state, division, presence, routingStatus, station, authorization (roles), skills,
languages, team, languagePreference, dateLastLogin, dateWelcomeSent, outOfOffice, geolocation.

- PATCH /api/v2/users/{userId} requires ANY of admin, directory:user:edit, directory:organization:admin; the
  note says "Updating some fields, like a user's extension, requires the telephony:extension:assign permission for
  the relevant division." So the profile PATCH is one door but the extension field has its own lock inside it.
- I infer (unverified offline): the Genesys web app lets a person edit their own profile card (photo, title,
  contact info, biography, skills) without directory:user:edit, governed by the org's FieldConfig
  (entityType person; each field has state, required, gdpr, customLabels, repeatable). The FieldConfig is the
  org-level "which profile fields exist and which are mandatory" control, which is the Genesys equivalent of a
  lock at field granularity. The spec exposes fieldConfigs on UserMe, which is consistent with the client using it
  to render the editable profile.
- Profile skills (directory:userProfile:edit, "what I say I know") are a different object from routing skills
  (routing:skill:assign, "what the ACD uses"). The person may claim the first; only an admin grants the second.

#### Preferences / presence

- Presence: PATCH /api/v2/users/{userId}/presences/{sourceId} and .../presences/purecloud carry **no** required
  permission (self). A separate permission presence:userPresence:edit exists (and presence:userPresence:inject)
  for setting someone else's. The person picks from org-defined Presence Definitions (System or User type, each
  mapped to a systemPresence: Available, Away, Busy, Offline, Idle, OnQueue, Meal, Training, Meeting, Break; can be
  per-division and deactivated) and may add a free-text message. Definitions need presence:presenceDefinition:add/edit.
  Rule visible: the person chooses a state; the org owns the vocabulary of states.
- Routing status (On Queue / Off Queue): PUT /api/v2/users/{userId}/routingstatus has no listed permission.
  Values: OFF_QUEUE, IDLE, INTERACTING, NOT_RESPONDING, COMMUNICATING.
- Queue membership vs activation: PATCH /users/{userId}/queues "Join or unjoin a set of queues" needs
  routing:queue:join (self activation) OR routing:queueMember:manage (admin). "Users can only be joined to queues
  where they have membership." Membership is admin; joining is the person, if permitted.
- Out of office: PUT /users/{userId}/outofoffice (startDate, endDate, indefinite, active) - no permission listed.
- Language preference: User.languagePreference is read-only and no /languagepreference endpoint exists.
  I infer it is a client-side app preference, not org data.
- ACD auto-answer: acdAutoAnswer is on UpdateUser and there is a PATCH /users/bulk to set it for up to 50 users
  (directory:user:edit) - so it is an admin lever applied to people, not a personal preference.

#### Phone / station

- telephony:selfStationAssociation:view/edit vs telephony:otherStationAssociation:view/edit, and
  telephony:station:disassociateSelf vs telephony:station:disassociate. A person logs INTO a station (associated
  station); an admin sets the DEFAULT station (telephony:phone:assign). UserStations reports associated, default,
  effective and lastAssociated.
- Call forwarding: PUT /users/{userId}/callforwarding needs conversation:callForwarding:edit for self and other
  alike (no self/other split here). Model: enabled, ordered calls[] routes, voicemail = PURECLOUD | LASTCALL | NONE.
- Agent greeting (the greeting played when the agent connects): telephony:selfAgentGreeting:edit vs
  telephony:otherAgentGreeting:edit.

#### Voicemail / greetings

- Three policy layers: VoicemailOrganizationPolicy (PUT /voicemail/policy, telephony:plugin:all) holds the
  defaults - alertTimeoutSeconds, pinRequired + pinConfiguration, voicemailExtension (*86), sendEmailNotifications,
  includeEmailTranscriptions, disableEmailPii, maximumRecordingTimeSeconds. VoicemailGroupPolicy per group
  (voicemail:groupPolicy:edit). VoicemailUserPolicy per person: PATCH /voicemail/me/policy has no permission
  (self) and exposes only alertTimeoutSeconds, pin, sendEmailNotifications; `enabled` is read-only at the user
  level. Editing someone else's needs voicemail:userPolicy:viewOther.
- Greetings: Greeting.ownerType USER | ORGANIZATION | GROUP, type STATION | VOICEMAIL | NAME. User greeting
  endpoints (/users/{userId}/greetings, /greetings/defaults) carry no permission; downloading needs
  greetings:greeting:download. A DefaultGreetingList exists at each owner level, so the org greeting is the default
  and the person's greeting overrides it.
- Mailbox: /voicemail/me/mailbox and /voicemail/me/messages are self; voicemail:mailbox:viewOther and
  voicemail:voicemail:viewOther gate other people's.

#### Security

- POST /users/me/password requires oldPassword and no permission; POST /users/{userId}/password requires only
  newPassword and directory:user:setPassword. The same permission also gates sending the invite/activation email.
- MFA verifiers: GET /users/{userId}/verifiers needs mfa:verifier:view.
- Roles are read-only on the User object; changing them is authorization:grant:add / :delete, never self.

---

## 2. Admin tiers and the rule that separates them

### 2A. Dialpad

Tiers (admin-permissions-in-dialpad.md, admin-types-in-dialpad.md):

| Tier | Made by | Scope | Can do to a person's record |
|---|---|---|---|
| **Company Admin** | first sign-up; Google/M365 admin equals it; later ones only by another Company Admin | whole company, every office | everything an Office Admin can, plus: add/transfer licences across offices, transfer users between offices, proxy login (plan-gated), change CNAM, MFA policy + exception list + unlock, SSO/SCIM config, retention, roles, billing |
| **Regional Admin** | Company Admin (My Company > Administrators > Make Regional Administrator) | a chosen set of offices | Office-Admin powers in each of those offices; cross-office user search needs Customer Care |
| **Office Admin** | Company Admin, or another Office Admin | one office | add/remove users, change email, resend invite, unlock, buy devices, assign numbers/extensions/fax/licence type, make other Office Admins, make people operators/agents, grant scorecard/proxy/international/analytics privileges, set retention per user, delete, restore within 72 h, enable integrations. **Cannot** edit the person's profile settings or global DND. |
| **Department Admin** | Company or Office Admin | one or more departments | assign operators, give operators Dept-Admin, toggle operator Active state, listen/whisper/barge, numbers/routing/hours/hold music for the department, department analytics + recordings |
| **Contact Center Admin** | Company or Office Admin | one or more contact centres | assign agents/admins/supervisors, queue handling, hours, hold music, AI playbooks; change agent global status by default |
| **Contact Center Supervisor** | Company, Office or CC Admin (must already be an agent) | one or more contact centres | listen, barge/take over, set agents available/unavailable (only if granted), view CC analytics and recordings, assign calls (if granted). No configuration. |
| **Coaching Team Coach** | Company/Office/CC admin with Sell licence | a coaching team | listen/barge, coach cards, trainee recordings |
| **Analytics Manager / Call QA Analyst / Conversation Design Manager / User Manager** | Company/Office admin, Enterprise | office(s) | read-and-manage slices: dashboards; recordings/transcripts + curated lists; IVR/AI flows; user management + phone assignment + department ops |
| **Super Admin** (ES portal) | Customer Care | company | feature flags, bulk user settings, user settings policies, CC access-control policies, CSV bulk add, proxy, number swap/remove |

They do: "You must be a Company Admin to assign additional Company Admin permissions." and "Before editing any user
permissions, make sure that your users have: accepted their emailed Dialpad invites, logged into Dialpad at least
once." (add-remove-user-permissions.md)

They do: Meetings Secondary Admins "do not have the ability to make any purchases or modify billing information"
(add-a-secondary-admin.md). A delegate "cannot change your password, access your payment method or history, or add
other linked users" (delegate-a-user.md).

The separating rules, as they show up in the articles:
1. **Identity vs membership.** Email, phone number, licence type, office = identity; owned by Office/Company
   Admin (phone number not even by them). Operator/agent/coach = membership in a group; owned by the group's admin.
   A Department Admin can make someone an operator but cannot change their email.
2. **Configuration vs supervision.** Admin (of any group) edits the line: numbers, routing, hours, hold music.
   Supervisor acts on live calls and live people: listen, barge, take over, flip availability. The article
   literally lists no configuration verbs for Supervisor. Supervisors' one write on a person (global status) is
   "disabled by default" and must be granted by an Office/Company Admin (manage-a-contact-center.md).
3. **Money vs operations.** Billing, licence purchase/removal/transfer sit with Company Admin; Office Admins may
   buy for their office only on non-contracted plans (manage-dialpad-license-billing.md). Every user needs a
   licence, including admins (manage-team-accounts-faqs.md).
4. **Data scope: own vs everyone.** Agents/operators get four separate checkboxes per group: access own
   recordings; access all; delete own; delete all - "By default, agents cannot access, manage, or delete Contact
   Center call recordings or call data" (agent-permission-changes.md; manage-a-contact-center.md). Search results
   are filtered to calls the person participated in. Admin access to personal recordings is itself a toggle that
   notifies every user (enable-office-wide-call-recording.md).
5. **The person's whole-life state is off-limits to admins.** Global DND cannot be set by any admin; per-group
   Active can be toggled by the group's admin; contact-centre duty status can be set by CC Admin (default) or
   Supervisor (if granted). (working-as-a-department-administrator.md; manage-a-contact-center.md)
6. **Carrier truth sits above the customer's top admin.** Changing a direct number, adding an international
   office, enabling extensions or regional cross-office search all route to Customer Care
   (make-changes-to-your-profile.md; add-and-manage-multiple-offices.md; add-edit-and-remove-extensions.md;
   admin-types-in-dialpad.md).

### 2B. Genesys Cloud

Genesys has no named tiers; it has permissions in the form domain:entity:action (1,430 of them per the study
notes), bundled into roles, granted per division. The tiering is visible in how the permissions are cut:

| Level | Permission family | What it can do to a person |
|---|---|---|
| Org owner | directory:organization:admin, `admin` | everything on the user record; PUT /organizations/me; authorization settings |
| People admin | directory:user:add / edit / delete / view / setPassword, directory:userStateChange:view | create, patch profile, set state active/inactive/deleted (+ reason), send invite, set password without the old one, custom attributes, external IDs |
| Access admin | authorization:role:add/edit/delete, authorization:grant:add/delete, authorization:division:* | build roles, grant (subject, division, role), move objects between divisions (POST /authorization/divisions/{id}/objects/USER) |
| Routing admin | routing:skill:assign, routing:language:assign, routing:queueMember:manage | give/remove ACD skills with proficiency, queue membership |
| Telephony admin | telephony:phone:assign, telephony:extension:assign, telephony:plugin:all, telephony:otherStationAssociation:edit | default station, extension, org voicemail policy |
| Supervisor | realtimeMonitor:screen:monitorAgent, conversation:recording:pauseOthers, presence:userPresence:edit, routing:queue:join (for others via queueMember:manage), voicemail:*:viewOther | watch and nudge live people; no profile writes |
| Self | no permission on /users/me/*, presences, routingstatus, outofoffice, greetings, voicemail/me/*, selfStationAssociation, selfAgentGreeting, users/me/password | own state, own greetings, own voicemail prefs, own station login, own password |

They do (spec): the same field can require different permissions depending on target - self vs other station,
self vs other agent greeting, own vs other voicemail policy, own password (needs old) vs other's password (needs
setPassword). Extension inside the user PATCH needs telephony:extension:assign "for the relevant division".

They do (spec): permissions carry `divisionAware` and `allowsConditions`; a role's permissionPolicies can include a
resourceConditionNode, so a grant can be narrowed to a condition. Roles carry baseLicense and addonLicenses.

I infer the Genesys rule: **there is no "admin" person, only a set of verbs on a set of nouns, each verb granted in
a division.** Supervisor, admin and agent are just names the customer gives to bundles.

---

## 3. The roles model

| Question | Dialpad | Genesys |
|---|---|---|
| Fixed or custom roles? | Fixed. "Custom roles are not supported at this time." Five standard roles (Admin, Analytics Manager, Call QA Analyst, Conversation Design Manager, User Manager) plus the six admin permission types. (role-based-access-control.md) | Custom. POST /authorization/roles; default roles ship and can be restored (POST/PUT /authorization/roles/default, "does not have an effect on custom roles"); roles flagged `default` / `base`, carry defaultRoleId and can be diffed against the default (comparedefault). |
| Permission granularity | Role = named bundle. Below the role there are two finer systems, both EAP/ES-portal: Contact Center Access Control with 38 permission sets (24 listed: ANALYTICS, SUPERVISOR_SETTINGS_WRITE, NUMBERS_SETTINGS_WRITE, AGENTS_ADMINS_MANAGE_AGENTS_WRITE, AGENTS_ADMINS_SKILL_LEVEL_WRITE, BUSINESS_HOURS_WRITE, CALL_ROUTING_HOURS_WRITE, HOLIDAY_HOURS_WRITE, ... SCORECARD_GRADING_WRITE) bundled into named "user policies" (role-based-access-control-for-contact-centers.md); and User Settings Policies with 15 sets that control what the person may edit on themselves (user-settings-policies.md). Plus one-off privileges on the user row: scorecard access, proxy access, international service, multi-CC settings access, view analytics (add-remove-user-permissions.md). | Atomic permission strings domain:entity:action (view 446, edit 281, add 247, delete 203, then search/assign/upload/execute/publish/manage). Self vs other are separate strings. Some permissions are divisionAware, some allow conditions. |
| Scoping | Office is the unit: Company / Regional (chosen offices) / Office. Roles are assigned "to which office(s)". Group-level scoping: "Not yet, but we're working on adding group and shared line granularity." The CC Access Control policies do scope to Company, Office or one Contact Center via a Target Key. WFM has its own admin/agent roles with per-team View / View-and-Edit, and "doesn't sync permissions from Dialpad". (role-based-access-control.md; wfm-roles-and-permissions.md) | Division is the unit: a grant is (subject, division, role) via POST /authorization/subjects/{s}/divisions/{d}/roles/{r}. Every major object (user, queue, flow, team, campaign, schedule, extension pool, skill group, script...) has a division. There is one homeDivision. Group objects can have `rolesEnabled` so a role can be granted to a group as subject. |
| Supervisor vs admin | Supervisor = live-ops verbs on a contact centre they are an agent in (listen, barge, take over, set available/unavailable if granted, view CC analytics/recordings, assign calls if granted). Admin = configuration. Admin/supervisor powers are further toggled per contact centre: "Disable the ability for admins and supervisors to listen in on calls", "Disable the ability for supervisors to change agent's DND status", "Allow supervisors to see details of scorecards", "Allow supervisors to assign calls". (admin-permissions-in-dialpad.md; manage-a-contact-center.md) | No built-in distinction in the spec; supervisor is whatever bundle contains realtimeMonitor:*, conversation:recording:pauseOthers, presence:userPresence:edit, routing:queueMember:manage and analytics:*:view without directory:user:edit / routing:queue:edit. |
| "Default permissions for new users"? | No explicit object. New users get a licence type (SCIM licenseType, or picked at add) and nothing else. What they may change on themselves comes from the office-wide toggles + any User Settings Policy at Company/Office level; what values they start with come from Bulk user settings and office defaults (language, E911, hold music). (manage-users-with-okta-scim.md; user-settings-policies.md; bulk-user-settings.md; manage-an-office.md) | CreateUser takes divisionId and state ("Active if invites are sent, otherwise Inactive"). Default roles exist as objects (the restore endpoint). I infer (recollection, unverified offline) that a default employee-type role is auto-granted to new users; the spec does not say. AuthorizationSettings lets the org run unused-role/permission analysis (analysisEnabled, analysisDays), and User.authorization exposes unusedRoles / unusedPermissions - so roles are meant to be trimmed to actual use. |
| Who can change another person's role | Company Admin only for Company Admin. Company or Office Admin for Office Admin and the five standard roles (from Company Settings > Access Control, or Office Settings > Users > Roles column). Company/Office/CC Admin can make an agent a Supervisor. Department Admin can give operators Department Admin. Target must have accepted the invite and logged in once. Bulk: select users > Manage user roles. (add-remove-user-permissions.md; role-based-access-control.md; working-as-a-department-administrator.md) | Anyone holding authorization:grant:add (and :delete to remove), scoped by division. Bulk: /subjects/{id}/bulkadd, bulkremove, bulkreplace; POST /roles/{roleId} to grant one role to many subjects+divisions. authorization:audit:view for the trail. |
| Licence and role | Separate. Licence is bought (Company/Office) and swapped inline on the user row; role is granted separately; changing licence auto-removes the person from groups the new licence does not allow. (manage-your-users.md) | Joined. DomainOrganizationRole.baseLicense + addonLicenses, authorization:license:view; granting a role is what consumes entitlement. |

I infer the shared design: **a role is a bundle of verbs; scope is a property of the grant, not of the role.**
Dialpad expresses scope as office(s) on the assignment; Genesys as division on the grant. Neither product creates a
new role name per location.

---

## 4. The user-directory admin

### 4A. Dialpad (Office Settings > Users)

Tabs (manage-your-users.md): **Active or Pending Users** (default), **Reserved Numbers** (unassigned numbers, who
had them, which office, when unassigned), **Deleted Users** (72 h window).

Facts on a user record (manage-your-users.md; export-a-user-list.md; use-the-enterprise-support-portal.md):
name, primary + secondary emails, state (active / invited / pending / suspended / deleted; "Pending" only for the
account creator, everyone else is "Invited" until active), office, country, date added, departments (IDs + names),
phone numbers, fax number, extension, licence type, office_admin flag, company_admin flag, cc_on-duty_status, Roles
column, app versions + devices (ES portal). Search "for specific users, or users with specific permissions or
licenses".

Row actions, grouped into four menus (add-remove-user-permissions.md):
- **Calling**: add Meetings, add fax line, add desk phone, add extension, swap phone number, configure
  integrations, manage phone numbers.
- **Groups**: view user's analytics, make contact-centre agent, make department operator.
- **Privileges**: scorecard access (three scopes), proxy access, international service, multi-CC settings access.
- **Admin**: set retention policies, add/remove admin privileges, transfer user, delete user, edit email address,
  proxy login, resend invite, unlock account access.
Plus inline: licence-type dropdown (arrow beside the licence), Roles column "Assign role".

Add (add-remove-team-members.md; manage-team-accounts-faqs.md; manage-users-with-okta-scim.md):
- Email must be in the company domain, or picked from the Google/M365 directory; choose a number from suggested
  or unassigned; confirm billing; invite email sent; row shows Pending until accepted.
- "You can only create user accounts for as many licenses as you have available." Every user, including admins,
  consumes a licence. Users cannot add themselves; a same-domain person can request to join and all office admins
  are emailed.
- SCIM creates users from the IdP: office picked by officeName / department / country attribute with a
  configurable fallback; number auto-assigned from the reserved pool then by the office's area code; licenseType
  attribute sets the licence; Contact Center licences do not get a DID by default.
- ES portal: bulk add via CSV.

Edit: profile fields are NOT editable by the admin (section 1A). Admin edits: email, number swap, extension,
licence type, office (transfer), groups, privileges, roles, retention, devices.

Transfer between offices (manage-your-users.md): Company Admin, Advanced/Premium plans; "they keep the license,
phone number, and settings they had previously"; cross-country transfer strips local/fax numbers and assigns a new
one; only between offices at the same price level. Licences transfer only when unassigned.

Licence change (manage-your-users.md): inline; "When a user's license is changed, they are automatically unassigned
from any groups that are no longer eligible"; Connect -> Sell/Support drops the DID unless a local-number licence
is bought.

Deactivate / suspend: the corpus shows a "suspended" state in the export and says SCIM "would handle suspending the
Dialpad account for the deleted Google Workspace user" (manage-team-accounts-faqs.md). I found no manual
"suspend user" action in the admin UI articles; the manual path is delete-with-grace. On-hold / suspended at the
ACCOUNT level is a billing state (on-hold-suspended-accounts.md).

Delete (add-remove-team-members.md; manage-your-users.md; analytics-for-deleted-users.md; manage-an-office.md):
- Offered an export of their usage first; choose to keep or remove the licence.
- Goes to Deleted Users for 72 h; restorable with number and data; "During the grace period, the number cannot be
  reassigned"; Permanently Delete frees it immediately; a never-accepted invite is deleted immediately and
  cannot be restored.
- After 72 h "all records associated with those users will be anonymized" and Dialpad cannot restore them.
- Numbers go to the Reserved Pool (fee applies); an office-wide setting can forward calls to a deleted member's
  number to the main line instead of "out of service".
- An admin's own direct number can be neither reassigned nor removed (number-assignment-faqs.md).
- Analytics keep the stats under "(deleted)" + user ID; call history shows the name with a "deactivated" badge
  until the retention policy anonymises it; recordings stay reachable in shared-line tabs but AI summary and
  transcript are gone; exports drop the name/email.
- Cannot delete the last user of the only office.
- Deleting then re-inviting is the documented way to "delete a user's data before changing their email"
  (change-an-email-address.md).

Voicemails on delete: not stated separately; they fall under "call-related data" covered by the retention policy
and the 72 h anonymisation. I infer: voicemails follow the same path as recordings.

Bulk model (manage-your-users.md; add-remove-user-permissions.md; bulk-user-settings.md;
centralized-office-management.md; add-edit-and-remove-extensions.md):
- In the Users table: checkbox -> Delete users, Manage user roles (Office Admin, Analytics Manager, Call QA
  Analyst, Conversation Design Manager, User Manager), Remove admin. That is the whole in-product bulk set.
- Everything else bulk is ES-portal: bulk user settings by Target Key (Company / Office / Group), bulk
  extensions by CSV, bulk add by CSV, user-settings policies by target.
- Offices themselves have a bulk table (Centralized Office Management) for three toggles; "Bulk actions apply
  immediately and can't be undone" and are written to the Admin Audit Log.

### 4B. Genesys Cloud (from the spec)

- Create: POST /users (directory:user:add) with name, email (= username), password, divisionId, department,
  title, addresses, state. If password config fails, POST /users/{id}/password re-attempts. POST /users/{id}/invite
  sends the welcome email; dateWelcomeSent and dateLastLogin are read-only facts on the record.
- Read: GET /users and GET /users/{id} need no permission (any signed-in person can see the directory);
  search needs directory:user:view; GET /users/{id}/profile is deprecated in favour of /users.
- Edit: PATCH /users/{id} with a `version` (optimistic locking, "Required when updating a user"); extension
  needs telephony:extension:assign in that division; custom attributes per schema; externalid mapping to an
  authority (SCIM/HR id, "Limit 1" per authority).
- State: PUT /users/{id}/state - active | inactive | deleted, with stateChangeReason Voluntary | Seasonal | Leave
  | Performance | Conduct | Unknown and stateChangeDate. UpdateUser.state "can be used to restore a deleted user or
  transition between active and inactive. If specified, it is the only modifiable field." So delete is a state,
  and reactivation is a state write, not a re-create.
- Delete: DELETE /users/{id} (directory:user:delete). Combined with the above, deletion is soft.
- Division move: POST /authorization/divisions/{divisionId}/objects/USER with a list of IDs (bulk).
- Membership: groups[] (many; official or social; visibility public/owners/members; owners; rolesEnabled;
  callsEnabled; dynamic rules), team (exactly one, division-scoped), queues (membership by admin, join by person;
  queue memberGroups keep queue membership in sync with group membership).
- Routing: skills and languages each with proficiency 0.0-5.0 and state; bulk PUT replaces, bulk PATCH merges,
  max 50.
- Licence: carried by the role (baseLicense/addonLicenses); the licence view is authorization:license:view.
- Bulk: /users/bulk (acdAutoAnswer, 50), role bulkadd/bulkremove/bulkreplace per subject, POST /roles/{id} for
  many subjects, division objects move, skills bulk.
- Station: default station set by admin, associated station by the person.

---

## 5. Distilled rules

Written so a feature the references do not have can still be placed.

1. **Identity sits above preference because billing, routing and audit key on identity.** Email/username,
   phone number, extension, licence, office/division and roles are admin-owned (phone number is vendor-owned in
   Dialpad). Name, photo, title, pronouns, language, timezone, greeting, ring behaviour are person-owned. If a new
   field is something another system looks a person up by, it is identity; put it under Admin. If it only changes
   the person's own experience, put it under My Account. (make-changes-to-your-profile.md; change-an-email-address.md;
   Genesys UpdateUser vs read-only fields)

2. **Self and other are different permissions, even on the same field, because "edit me" and "edit anyone" are
   different risks.** Genesys spells it: selfStationAssociation vs otherStationAssociation, voicemail/me/policy vs
   userpolicies/{id}, users/me/password (needs old password) vs users/{id}/password (needs setPassword). Dialpad
   spells it as paired checkboxes: own recordings vs all recordings, delete own vs delete all. Any new capability
   that can target a person should ship as two switches, never one. (agent-permission-changes.md; spec)

3. **Admins set the envelope; the person picks inside it; a lock is a read-only field, not a hidden page.**
   Three separate levers stack: a default value (bulk settings, office default language/E911), an allow-list that
   adds options to the person's control (office-wide caller-ID options, hide caller ID, self-provision desk
   phones, auto DND, recording toggle), and a policy that greys the control out (User Settings Policy). Most
   specific scope wins: User > Office > Company. Genesys does the same with org -> group -> user voicemail policies
   and org -> group -> user greeting defaults. A new personal setting should be born with all three hooks, even
   if only the default is wired at first. (user-settings-policies.md; bulk-user-settings.md;
   enable-office-wide-caller-id.md; auto-do-not-disturb-dnd.md; VoicemailOrganizationPolicy / UserPolicy)

4. **Configuration sits above supervision, and supervision above participation, because each layer changes a
   wider blast radius.** Admin edits the line (numbers, routing, hours, music, membership). Supervisor acts on live
   calls and live people (listen, barge, take over, flip availability, assign a call) and gets no configuration
   verbs. Agent changes only their own state. Seeing data (analytics, recordings, scorecards) is a separate axis
   granted on its own, because reading is not configuring. A new feature that watches or nudges people is a
   supervisor feature; one that changes how calls flow is an admin feature; one that changes what I can see is an
   analytics grant. (admin-permissions-in-dialpad.md; manage-a-contact-center.md; role-based-access-control.md)

5. **Scope is a property of the grant, not of the role, because the same job exists in every location.**
   Dialpad: one "Admin" role with Company / Regional / Office scope chosen at assignment; Genesys: (subject,
   division, role). Do not create "Delhi Supervisor"; create Supervisor and grant it in Delhi. Design any new
   permission so it can be evaluated against the scope of the object being touched.

6. **The more a state belongs to the person's whole life, the less an admin may touch it; the more it belongs to
   a queue, the more the queue's admin may.** Global DND: nobody but the person. Per-group Active toggle: that
   group's admin. Contact-centre duty status: CC admin by default, supervisor only if granted, and even then
   toggleable per contact centre. Personal working hours: person, but they stop applying to contact-centre calls.
   Put any new availability control on this ladder by asking whose calls it silences.
   (working-as-a-department-administrator.md; manage-a-contact-center.md;
   agent-global-dnd-and-personal-working-hours-behavior-change.md)

7. **Money is walled off from operations because purchasing and assigning are different acts.** Buying, removing
   and transferring licences and paying bills are Company Admin (Office Admin only on non-contracted plans);
   assigning a licence to a person is a row action; a secondary/Meetings admin or a delegate explicitly cannot buy
   or see payment. Genesys ties the licence to the role so the entitlement check happens at grant time. A new
   paid add-on needs a buy step (company) and an assign step (people), never one button.
   (manage-dialpad-license-billing.md; add-a-secondary-admin.md; delegate-a-user.md; DomainOrganizationRole)

8. **Deletion is a state with a grace period, and data outlives the person, because numbers, recordings and
   analytics belong to the company.** 72 h restorable, number parked in a reserved pool and unassignable until
   permanent delete, licence kept or released as a separate choice, analytics kept under "(deleted)", history
   badged "deactivated" until the retention policy anonymises it. Genesys: state = deleted with a reason, restorable
   by writing state back. So a Delete button should really be Deactivate, with a scheduled purge, a number-return
   step and a licence-return step. (add-remove-team-members.md; analytics-for-deleted-users.md; UserState)

9. **Anything that changes carrier or contract truth sits above the customer's own top admin.** Changing a
   direct number, an international office, extension length, cross-office search for regional admins: Customer
   Care. I infer the placement rule: if the change has to be pushed to a carrier or alters a billing contract,
   it is a support-desk or vendor action with an audit note, not a self-serve admin action.
   (make-changes-to-your-profile.md; add-and-manage-multiple-offices.md; add-edit-and-remove-extensions.md)

---

## 6. Vocabulary map

Target vocabulary is the checked-in table in /root/mycountrymobile-web/src/pages/directory/NAMING.md:
Location / Group / Person / Extension / Contact / Company. Rows marked NEW have no row in NAMING.md yet and, by
its rule 2, need one before a label ships.

| Their word (Dialpad) | Their word (Genesys) | Likely word in our product | Note |
|---|---|---|---|
| Company | Organization | **Company** | the tenant |
| Office; Regional (set of offices) | Location + Site (Site carries timezone, caller ID, media); Division (permission slice) | **Location** | Dialpad's Office is both the address and the permission scope. Genesys splits them. We have Location for the address; we have no scope object. If we add scoping, it is a NEW row, closest to "Location scope". |
| Department, Contact Center, Coaching Team, Main Line ("shared line") | Queue (routing), Group (official/social directory group), Team (one per person) | **Group** | in NAMING.md a Group is "a team; a person can be in several". A queue/shared line is a Group with a number and routing. Genesys Team (exactly one per person, division-scoped) has no equivalent; treat as a Group flagged primary if needed. |
| User, Team member | User | **Person / People** | never "Extension" for a human |
| Operator (in a Department), Agent (in a Contact Center), Trainee (Coaching Team) | Queue member (membership) vs joined (activation) | **Person's role in a Group** (member) | Operator/Agent are not roles of the Person; they are the Person's standing inside one Group. Keep as membership, not as a global role. |
| Executive / Assistant pairing | (no direct equivalent; delegation via roles) | Person-to-Person pairing | NEW concept if built |
| Extension | Contact.extension, Extension Pool | **Extension** | the number, never the human |
| Contact (Dialpad contacts) | External Contact | **Contact** | outside the org |
| Direct number / Dialpad number; Reserved / Unassigned numbers | DID, DID Pool | Number; Number pool (NEW label) | reserved pool = numbers owned but not assigned |
| Your Settings / Profile | (user menu) Preferences + profile | **My Account** | the person's own screen |
| Admin Settings / Admin Portal; Office Settings > Users | Admin | Admin ▸ People | the directory admin |
| Enterprise Support (ES) portal, Super Admin, Target Key | (no equivalent; done through permissions) | Support / vendor console; scope id | vendor-side console; do not surface to customers |
| Company Admin | directory:organization:admin holder | Company admin | top customer role |
| Office Admin / Regional Admin | role granted in a division | Location admin (scoped grant) | scope on the grant |
| Department / Contact Center Admin | routing:queue:edit + routing:queueMember:manage in a division | Group admin | configures the Group |
| Contact Center Supervisor | bundle of realtimeMonitor:*, presence:userPresence:edit, recording:pauseOthers | Supervisor | live-ops on a Group, no configuration |
| Analytics Manager / Call QA Analyst / "View user's analytics" | analytics:*:view, recording:*:view, quality:* | Reports viewer / QA | separate data axis |
| User Manager | directory:user:edit + telephony:phone:assign | People admin | edits identity, not preferences |
| Licence (Connect / Sell / Support) | baseLicense / addonLicenses on the role | Licence / plan seat | buy at Company, assign per Person |
| User Settings Policy | FieldConfig (profile fields) + permission absence | Settings lock | read-only flag per personal setting |
| Bulk user settings | org/group policy defaults (voicemail, greetings) | Defaults | value applied under a scope |
| Personal Working Hours | (no direct; Out of Office + schedules) | Personal hours | person-owned, group-hours are separate |
| Global DND | Presence (Busy/DND definitions) | Do not disturb | person-only |
| Active toggle (per shared line) | joined (per queue) | Active in Group | admin of that Group may toggle |
| On Duty / Off Duty; custom off-duty statuses | Routing status On Queue / Off Queue; Presence definitions (Meal, Break, Training...) | Duty status; status list | list owned by Location/Company, choice owned by Person |
| Proxy login | (impersonation not in public API) | Support sign-in as | logged, separately granted |
| Deleted Users (72 h) | state = deleted / inactive with reason | Deactivated People | soft state with grace |
| Event Changelog / Admin Audit Log | authorization:audit:view, audits API | Audit log | |
| Desk phone / forwarding number / device | Station (default vs associated), Phone | Device | NEW row if a label is needed; Station-as-login has no equivalent here |

---

## What I could not verify offline

- Genesys UI behaviour (what a person sees under Preferences, whether new users get a default role automatically,
  what the profile editor allows). Only the API surface was available. Every Genesys "self" claim above rests on
  an endpoint having no required permission or living under /users/me.
- Dialpad's suspend action: the "suspended" state appears in the CSV export and SCIM notes, but no article in
  the mirror shows a manual suspend button. Treat manual suspension as absent.
- Dialpad app-language lock: the policy list has "IVR, Voice and Ai Language" and "Timezone" but no separate
  "app language" set; I read app language as unlockable.
