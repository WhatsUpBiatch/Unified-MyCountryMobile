# What source we hold, and what production runs that we do not

Deep audit, 2 Sep 2026, against all four live boxes. Every line below was
checked directly. Where a claim turned out to be wrong, it says so and shows the
check.

**Short answer to "do we have access?": yes, to almost all of it.** All 14
production API services have full TypeScript source in `/root/UCAAS/mcm-repos`.
The gaps are small, specific, and two of them genuinely matter.

---

## 1. What we hold

15 repositories, all TypeScript, no JavaScript-only projects:

| Repo | .ts files | Runs in production? |
|---|---|---|
| default-api | 341 | yes, all 3 API boxes |
| campaign-api | 128 | yes |
| chat-api | 87 | yes |
| tenant-api | 76 | yes |
| socket-presence-api | 63 | yes |
| contact-api / sms-api | 60 each | yes |
| calendar-api | 51 | yes |
| crm-integration-api | 49 | yes |
| video-api | 40 | yes |
| notification-api / security-api | 29 each | yes |
| socket-api | 20 | yes |
| media-api | 17 | yes |
| esl-manager | 15 | on the switch, not pm2 |

Production runs exactly those 14 API services on api2 and api4. api3 runs the
same 14 **plus one extra** — see 3.4.

---

## 2. Claims that hold up

### 2.1 tenant-api really is missing five files — and they are the important ones

**Verified exactly: 5 of 81 production files have no `.ts` source.** Control on
the same method: `CallListRepository` was found in both. The five names appear
**zero** times anywhere in the tenant-api source tree, so they are not renamed or
inlined — they are simply absent.

| File | Lines | What it is |
|---|---|---|
| `helpers/recordingAccess.js` | 262 | *"Who is allowed to hear a recorded call back"* |
| `helpers/companyDefaults.js` | 234 | Reads the company's own rules from its own database |
| `middlewares/RecordingAccessFilter.js` | 106 | *"Stop a recording's file name leaving this service when the company has said it should not"* |
| `middlewares/DBMiddleware.js` | 28 | required by **0** files — dead in production |
| `helpers/mediaHelper.js` | 22 | required by **0** files — dead in production |

**Three of the five are live and load-bearing.** `RecordingAccessFilter` is
applied with `this.router.use(...)` in `routers/api.js` — it runs on **every**
tenant-api route. `companyDefaults` is required by two other files.

**This is the single most important item in this audit**, and not for the reason
the original note gave. These files are the **server-side recording permission
gate** — the thing the recording audit repeatedly recorded as missing. It is not
missing; it exists, it is live, and **it has no source.**

The first person to rebuild tenant-api from the repository will silently delete
the control that decides who may hear a recorded call.

### 2.2 sms-api really is ahead — and it is the fax feature

Checked every function name in the production bundle against the whole source
tree. **75 checked, 13 genuinely absent:**

```
sendFaxByTelnyx   handleFaxWebhook   faxList   faxToNumberList   deleteContactName
connectDB   getMainDB   getTenantDB   getTenantDBFromUser
connectMainBaseDB   connectTenantBaseDB   cleanupIdleTenantDbs   closeAllConnections
```

Two groups: **the whole fax feature**, and a **tenant-database connection layer**.

A rebuild from source deletes fax entirely. Worth knowing alongside the standing
"fax has an issue we are going to fix" — part of the reason may be that the
running fax code is not in the repository at all.

### 2.3 recorder-portal has no source — but it is an orphan

True that no source exists. But it is **not a service**: it is a small static
site (`index.html` + assets + `lib-jitsi-meet.min.js`, titled *MCM-Recorder*),
built 6 Aug, and **served by nothing**. `grep -rl recorder-portal /etc/nginx/`
returns nothing on **all four boxes**. It is not under pm2 either.

So it is worth one question to the developer — "what was this, is it wanted?" —
and it is **not top of the list**. Nobody can reach it.

---

## 3. Claims that do not hold up

### 3.1 "socket-presence-api, socket-api, chat-api — production is substantially ahead"

**Wrong for all three.** Method: extract every `async name(` from the production
bundle, then check each name against the entire source tree.

| Service | prod functions checked | genuinely absent from source |
|---|---|---|
| socket-presence-api | 36 | **0** |
| socket-api | 12 | **0** |
| chat-api | 123 | **0** |
| campaign-api | 132 | **0** |
| sms-api | 75 | **13** |

Only sms-api drifts. The likely cause of the original mistake: these services are
**webpack bundles** — one `.js` file each, with modules inlined and renamed.
Counting differing "fragments" between a bundle and its source will always show
large differences that are bundling artefacts, not missing code.

I made the same mistake once during this audit: a first pass using a narrower
regex reported 80 missing functions for campaign-api. Checking each name against
the whole tree brought that to **zero**. The narrow method was wrong, not the
repository.

### 3.2 "campaign-api CORS is blocking your ring tiers"

The CORS difference is **real**:

```
production : ["http://localhost:3000", "https://portal.dialphone.ai"]
our source : ["http://localhost:3000"]
```

**But it cannot be blocking anything in this product.** The portal never calls
campaign-api from the browser. `default-api` calls it server-to-server with
`axios` from Node (`CampaignApiService`), and a Node request carries **no Origin
header**. The code's own first condition is `if (!origin || allowed...)` — no
origin is always allowed.

CORS only governs a browser at `portal.dialphone.ai` calling campaign-api
directly, which is a different product. Whatever is wrong with ring tiers, this
is not it.

### 3.3 default-api has no source

**Long since false, and worth stating because it was believed for a while.**
**0 of 341** production files lack a `.ts` source. Complete.

### 3.4 Not in the original list: api3 runs a service we have no repository for

`kallus-api` → `/home/KallUsPortal-main/server/index.js`, running on api3 only.
**98 JavaScript files, 0 TypeScript, and no git repository at all.** It has its
own `api/`, `marketing-site/` and an image called `nixxy-ai.png`, so it is a
separate product parked on that box rather than one of ours.

Its source is on disk but under no version control, so it exists exactly once and
a disk loss ends it.

---

## 4. What to actually ask the developer for

Ranked by what it costs us to not have it.

1. **tenant-api: the five files** — `recordingAccess.ts`, `companyDefaults.ts`,
   `RecordingAccessFilter.ts`, and (if they were ever real) `DBMiddleware.ts`,
   `mediaHelper.ts`. **Ask first.** Three are live and one of them is the
   recording privacy gate. A rebuild from the repo removes it silently.
2. **sms-api: the fax and tenant-database code** — 13 functions. A rebuild
   deletes fax. Ask alongside the fax problem already known about.
3. **kallus-api** — should this be in version control at all, and whose is it?
   Right now it exists in one place with no backup.
4. **recorder-portal** — what was it for, and should it still exist? Low
   urgency: nothing serves it.
5. **campaign-api CORS** — one line, and it blocks nothing. Mention it, do not
   lead with it.

**Do not ask for:** socket-api, socket-presence-api, chat-api or campaign-api
source. We have all of it.

---

## 5. How each of these was checked

So the developer can repeat it rather than take it on trust.

- **Per-file services** (default-api, tenant-api compile file-by-file): every
  `.js` under `dist`, basename matched against a `.ts` under `src`. Controls
  passed both ways.
- **Bundled services** (everything else is one webpack file): every
  `async name(` extracted from the bundle, then each name checked against the
  whole source tree with `grep -r`. Names, unlike structure, survive bundling.
- **Absence claims** were only accepted after the same search found a control
  known to be present. The one search that returned zero without a control —
  the first `dialphone` check — was wrong, and re-running it against the real
  bundle path found the string immediately.
