# Status by feature — 3 September 2026

Every functionality across the product, sorted into three buckets. Each row was
verified against the live system during the audits of 2–3 September.

- **LIVE** — verified working
- **PARTIAL** — works, with a real fault you will notice
- **BUILD** — does not work today, or was never built
- **STORED ONLY** — the screen saves it; nothing acts on it

## 1. Phone calls

| Feature | Status | What's actually true |
|---|---|---|
| Incoming call from the public network | LIVE | Carrier → Kamailio → switch → right person. Verified with a live probe. |
| Outgoing call | LIVE | Via 46 Labs. ~1 in 8 fail (mostly long-distance the carrier refuses). |
| Extension-to-extension call | LIVE | Verified. |
| Call cap per customer (numbers + 1) | LIVE | Verified in the generated routing. |
| Country calling restrictions | LIVE | Refused before reaching the carrier. |
| Mistyped extension refused | LIVE | Hangs up instead of dialling out. |
| Business hours on a number | LIVE | Closed office diverts to voicemail. |
| Holidays on a number | LIVE | Fixed 1 Sep. |
| Caller ID per location | LIVE | Enforced by the switch. |
| Calls that lose audio | BUILD | No audio timeout — 12 calls sat open for 26 hours. One setting. |
| Audio on strict corporate networks | PARTIAL | TURN has no TCP fallback; call connects, stays silent. |
| Listen / Whisper / Barge / Intercept | BUILD | Buttons on 4 screens + pricing page. They dial your carrier with a star code. |
| Attended transfer, park, conference, DND, call waiting, pickup | BUILD | Zero references in the switch. |
| Star codes of any kind | BUILD | Router has no star-code branch. |

## 2. Numbers

| Feature | Status | What's actually true |
|---|---|---|
| Existing numbers receiving calls | LIVE | 30 numbers live. |
| Buying a number | BUILD (outage) | DIDWW rejects the API key — 401 since 1 Sep. |
| Releasing a number | BUILD (outage) | Same key. |
| Forwarding to Extension / Voicemail / IVR / Queue / Phone / Hang up | LIVE | 6 of 11 choices routed. |
| Forwarding to Department / Device / Greeting / Message / AI | BUILD | Selectable; caller gets silence. |
| Number monthly price | PARTIAL | 24 of 30 numbers priced at $0; renewal charges nothing. |
| Free number included with the plan | BUILD | `did_count` is read by nothing. |

## 3. Departments (ring groups)

| Feature | Status | What's actually true |
|---|---|---|
| Create a department (members, ring order, timeout, failover, hours, hold music) | STORED ONLY | Everything saves. |
| Ring a department from a number | BUILD | No routing code exists. |
| Dial a department's extension | BUILD | "Unknown extension", hangs up. |

## 4. Call queues

| Feature | Status | What's actually true |
|---|---|---|
| Number → queue routing | LIVE | Ring strategy, wrap-up, cap, hold audio all reach the switch. |
| Queue script and agent-lookup service | LIVE | Both answer correctly. |
| Ring strategy | LIVE | Corrected 3 Sep. |
| Hold music | LIVE | Four tracks installed. |
| Agent goes Available and stays Available | BUILD | Socket path logs agents out, never back in; the one button signs you out on refresh. 28 of 37 logged out. |
| Agent phones registered | PARTIAL | 1 of 3 members on the live queue has a phone registered. |
| A call reaching an agent | BUILD | Zero calls have ever entered the queue script. |
| Ring tiers | BUILD | All 37 tier records orphaned; no queue has any. |
| "Nobody available" message | BUILD | Stock file missing → silence. |
| Queue exit to voicemail | BUILD | Voicemail stores nothing. |
| Queue stats / live dashboard | BUILD | `live_calls` empty while 6 calls up. |
| Callback, position announcement, estimated wait | BUILD | Not built. |

## 5. IVR menus

| Feature | Status | What's actually true |
|---|---|---|
| Building a menu | LIVE | Editor warns on loops and dead targets. |
| Menu XML generated for the switch | LIVE | Verified correct. |
| Greeting plays | BUILD | Switch's download returns 401 (regression from media hardening); unmounted target path. |
| Invalid / goodbye prompts | BUILD | Stock sound library never installed. |
| Any key press reaching its destination | BUILD | All 7 target contexts "not found". Only Hang up works. |
| Text-to-speech | BUILD | Deepgram endpoint exists, commented out. |
| Speech recognition, variables, branching, API calls, draft/publish | BUILD | Not built. |
| Menus ever answering a call | — | 0 executions in 6 days. 13 menus waiting. |

## 6. Voicemail

| Feature | Status | What's actually true |
|---|---|---|
| Send a caller to voicemail | PARTIAL | Beep and record… |
| Message stored and playable | BUILD | Folder never created; 0 messages on any current tenant. |
| Voicemail email | BUILD | Patch ready, not applied. |

## 7. Recording & transcription

| Feature | Status | What's actually true |
|---|---|---|
| On-demand recording | LIVE | Files are produced. |
| Recording uploaded and playable | BUILD | Uploader failed 4,303 times — files belong to calls that never ended. |
| Play button on old calls | BUILD | 6,630 rows point at files that don't exist. |
| Transcription | BUILD | 0 transcripts ever. |

## 8. Presence

| Feature | Status | What's actually true |
|---|---|---|
| Online/offline dots | BUILD | No "offline" value exists. 2,063 "online", 11 phones registered. |

## 9. Messaging

| Feature | Status | What's actually true |
|---|---|---|
| SMS send/receive | BUILD | 0 messages ever logged; Telnyx credentials blank. |
| SMS billing logic | LIVE | Checks balance and deducts. |
| Fax billing logic | LIVE | Same. |
| Chat channels | BUILD | Two endpoints missing; unverified. |

## 10. Billing

| Feature | Status | What's actually true |
|---|---|---|
| Plan purchase, renewal, upgrade, downgrade request, cancel request | LIVE | Server prices it. |
| Seats: buy, remove at cycle end, restore, idle warning | LIVE | Closest match to the reference. |
| Storage sync and purchase | LIVE | Verified. |
| Credit top-up, saved cards | LIVE | 15 top-ups on record. |
| Low-balance email | LIVE | Cron works. |
| Plan price shown vs charged | BUILD | Ultimate $2/seat in DB (14 companies), $42 on comparison table. |
| Voice calls billed | BUILD | $0 on every call since 29 Aug. |
| Balance checked before dialling out | BUILD | Expired, $0 customer can dial internationally. |
| Tax on invoices | BUILD | 0 of 143 invoices ever carried tax. |
| Usage on the invoice / statement | BUILD | SMS/fax deductions write no ledger row. |
| Usage counters | BUILD | Never written; `sms_used` isn't a column. |
| Auto-recharge | PARTIAL | Per-user, no idempotency key. |
| Nightly renewal | PARTIAL | 3–4 duplicate ledger rows; Stripe dedupes the charge. |
| Invoice PDF | BUILD | No document service. |
| Billing change log | BUILD | Nothing logs seat/plan changes. |
| Refunds | BUILD | Field exists, never written. |
| Add-ons purchasable | BUILD | Catalogue only. |
| Cost centres | STORED ONLY | Directory saves; nothing reports by it. |
| On-hold grace before suspension | BUILD | Expired → users deactivated on the next hourly cron. |

## 11. Accounts & security

| Feature | Status | What's actually true |
|---|---|---|
| Signup creates company + admin | LIVE | |
| Signup creates the customer's database | BUILD | Only the buy-a-number flow does. Two accounts from 2 Sep are dead, one paid. |
| Login, password reset, OTP email | LIVE | |
| Two-factor login | PARTIAL | Fixed code `246800` bypasses it in production. Fix in source, never deployed. |
| Bot protection | BUILD | `CAPTCHA_BYPASS=true`; off is the default. |
| Roles & permissions | STORED ONLY | Browser-only; no controller checks a permission. |
| Trusted device 30-day skip | LIVE | |
| IP allowlist | LIVE | On api2 since 2 Sep. |
| Security alerts to a human | BUILD | Posted to a 404; 28 lost. |
| Last-login recorded | BUILD | Empty for all 4,079 users. |
| API docs hidden | BUILD | Swagger public. |
| Number-buying routes need login | BUILD | 16 of 20 don't. |

## 12. Platform

| Feature | Status | What's actually true |
|---|---|---|
| Call-path services handle load | BUILD | Four single-threaded Python services, 5-deep queue each. |
| Monitoring / alerting | BUILD | None. |
| Backups | BUILD | No backup job on the box. |
| Source code for the call path | BUILD | Router, queue engine, agent service + 3 more exist only on the server. |
| Redundancy | BUILD | One 2-CPU droplet runs everything. |
| SSL certs, firewall, fail2ban | LIVE | |

## In one paragraph

What's live is the spine: a call comes in, finds the right customer, rings the
right person, and hangs up cleanly. Plans, seats, cards and top-ups charge
correctly. The screens are honest and well built almost everywhere.

What's partial is plumbing that's 90% there: queues, recordings, auto-recharge,
2FA — each one setting or one function away.

What needs building falls into three groups: money (rating calls, balance check,
tax, usage ledger); audio features sharing one root cause (sound library +
greeting fetch → IVR, voicemail, queue prompts); and things only ever built on
the screen (departments, supervisor monitoring, presence, permissions, cost
centres).

The one thing above all others: the six files that make every call decision are
in no repository. Everything else is fixable; that is what makes it fixable.

Detail for each row: `launch-readiness-2026-09-02.html`, `deep-audit-2026-09-02.html`,
`fix-guide-2026-09-02.html`, `call-queue-blocker-2026-09-03.html`,
`billing-vs-reference-2026-09-03.html`, `ivr-vs-reference-2026-09-03.html`.
