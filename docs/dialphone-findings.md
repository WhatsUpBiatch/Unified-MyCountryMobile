# Dialphone references found on the MyCountryMobile production server

**Server:** 142.93.121.121 (UCaaS-Live)
**Reviewed:** 2 September 2026
**Purpose:** to establish what is present, where, and to ask how it got there.

This is a record of what was found. It contains no conclusion about how or why,
because that cannot be determined from this server alone. Every item below can be
re-checked with the command given beside it.

---

## Summary

References to **Dialphone** — a competing UCaaS product — are present in four
places on this production server: in deployed backend code, in the live customer
database, in the AI knowledge base, and in a database migration dump.

No mechanism was found by which Dialphone could reach this platform. The
references are artefacts *from* a Dialphone build and dataset, present here.

---

## 1. Deployed backend code — four services

| File | Occurrences |
|---|---|
| `/var/www/prod/calendar-api/dist/src/index.js` | 15 |
| `/var/www/prod/video-api/dist/src/index.js` | 5 |
| `/var/www/prod/crm-integration-api/dist/src/index.js` | 3 |
| `/var/www/prod/campaign-api/dist/src/index.js` | 2 |

```
grep -rlio "dialphone" /var/www/prod/*/dist
```

Three kinds of reference:

**a. CORS allow-lists.** campaign-api permits browser origin
`https://portal.dialphone.ai`. calendar-api permits `http://dialphone:3000`.

```js
const allowedOrigins = ["http://localhost:3000", "https://portal.dialphone.ai"];
```

**b. A product branding switch**, which selects the product name at runtime:

```js
(process.env.MAIN_API_URL || "").toLowerCase().includes("dialphone")
  ? "Dialphone"
  : "MyCountryMobile"
```

**c. A validator** listing permitted deployment identifiers:

> `"Origin must be one of local, localhost, 127.0.0.1, qa, dialphone, ucaas or live"`

Taken together these indicate a single codebase written to serve both products,
with the product selected by environment variable.

**On this server the variable is set correctly.** `MAIN_API_URL` is
`http://127.0.0.1:3000` on all four services, so all four identify as
MyCountryMobile. No customer-facing text says otherwise.

---

## 2. Live customer database — 13 of 20 tenants

The `dispositions` collection (call outcome labels shown to agents) contains
**156 records across 13 tenant databases** whose author field reads `DialPhone`.

A record, verbatim, from tenant `mcm_1785312032037`:

```
_id              6a69b679bdcbb339e958b057
createdByName    DialPhone
disposition      { name: 'Resolved', description: 'The issue or query was fully addressed' }
dispositionType  AGENT
createdAt        2026-07-29 08:14:49
```

These are the twelve default labels seeded into each tenant — Resolved,
Interested, Not Interested, Sale Closed, Busy, No Answer and the rest.

Created between **27 July 2026** and **7 August 2026**.

```
db.dispositions.find({ createdByName: /dialphone/i })
```

---

## 3. AI knowledge base — database `ai-dev`

Two documents contain a knowledge base written for the Dialphone product,
including its pricing structure:

> "UCaaS AI Agent Knowledge Base (**Dialphone** Portal). 1. Overview — This
> document provides structured knowledge for training an AI agent on the
> **Dialphone** UCaaS platform... 4. Pricing Structure — **Dialphone** offers
> tier-based pricing: Basic Plan..."

- `ai-dev.chunks` — one document, created **8 May 2026**
- `ai-dev.sessions` — one document, created **23 June 2026**, sourced from a PDF
  titled `UCaaS_AI_Knowledge_Base`

---

## 4. Database migration dump

`/root/mongo-migration/dump/`, created **27 August 2026**, contains the same
material in `dispositions.bson` for seven tenants and in the `ai-dev` collections.

```
strings /root/mongo-migration/dump/*/dispositions.bson | grep -i dialphone
```

---

## What was checked and NOT found

No route by which Dialphone could access this platform was found.

| Checked | Result |
|---|---|
| Credentials, API keys or webhooks for dialphone in any `.env` | none |
| `/etc/hosts` entries or DNS overrides | none |
| Live network connections to `portal.dialphone.ai` (`172.67.164.233`, `104.21.57.164`) | none established |
| Whether campaign-api is reachable from the internet | **no** — port 3008, ufw default-deny, no nginx route; an external request from off the server received no response while the public website returned 200 |

The CORS entry for `portal.dialphone.ai` therefore has no effect today: no browser
can reach that service. It would only take effect if port 3008 were opened or
proxied.

---

## What this does not establish

- Which product was built first, or whether either reused the other
- Whether any permission or agreement covers the shared codebase
- Whether any MyCountryMobile data exists on Dialphone's systems — that cannot be
  determined from this server

---

## Questions for the development team

1. Is the MyCountryMobile backend built from a codebase that also serves
   Dialphone? The branding switch and the deployment-identifier validator suggest
   it is.
2. The default call dispositions in 13 live customer tenants record `DialPhone`
   as their author, created 27 July – 7 August 2026. Where did that seed data
   come from?
3. A Dialphone product knowledge base, including their pricing, is stored in the
   `ai-dev` database on this server. How did it get there, and should it be here?
4. `https://portal.dialphone.ai` and `http://dialphone:3000` are in the CORS
   allow-lists of services running in MyCountryMobile production. Please remove
   them from our build.
5. Has any MyCountryMobile code, configuration or customer data been used in, or
   copied to, the Dialphone deployment?

---

## Note on the source repositories

Separately, the source provided does not match what is running. Each service was
rebuilt from the supplied repository and the output compared against the deployed
artefact:

| Service | Result |
|---|---|
| contact-api, media-api, notification-api | identical |
| default-api | 338 of 341 files identical |
| security-api, crm-integration-api, campaign-api | near match (22, 85 and 246 differing fragments) |
| video-api, calendar-api, tenant-api | 4%, 6%, 9% divergent |
| chat-api, socket-api, sms-api | 14%, 27%, 41% divergent |
| socket-presence-api | a different build entirely |
| **recorder-portal** | **no repository supplied at all** |

Current source matching production is requested for the divergent services, and
any source at all for recorder-portal.
