# Three plans — the spec

Settled with the user, 2 September 2026. Column names verified against the live
`Plan` and `Company` models on mcm-new, not written from memory.

---

## The plans

| | Starter | Growth | Scale |
|---|---|---|---|
| USA calling minutes | 5,000 | 5,000 | 5,000 |
| SMS | 20 | 40 | 80 |
| MMS | 20 | 40 | 80 |
| AI voice minutes | 20 | 40 | 80 |
| AI replies | 20 | 40 | 80 |
| Recording storage | 5 GB | 10 GB | 20 GB |

Storage in hours of recording, since that is what a customer is really buying:
roughly **85 / 170 / 340 hours**. Recordings are saved as `.wav`, which is
uncompressed — about 57 MB an hour. Storing MP3 instead would multiply every
figure by six and cut the bill; that is a change on the switch, not in the app,
and worth doing on its own merits.

Storage costs us about **$0.007 per GB per month** on Wasabi, so these three
tiers cost roughly **3¢, 7¢ and 14¢ per customer per month**. Storage is not
where the margin is. (Price from Wasabi's public rate card — worth checking
against an actual invoice, we may be on a committed tier.)

---

## Where each number is stored

Verified column names. Nothing here needs a schema change.

| Setting | Column | Notes |
|---|---|---|
| USA minutes | `company.call_duration` | **minutes**, not seconds — the summary screen renders it with `describeStoredAllowance(..., 'minutes')` |
| Minutes used | `company.call_duration_used` | already counted today |
| SMS | `plan.free_sms` | |
| MMS | `plan.free_outbound_mms` | |
| AI voice minutes | `plan.ai_call_free_minutes` | |
| AI replies | `plan.ai_message_free_reply` | |
| Storage | `plan.free_storage` | commented "Free storage in GB" |
| Storage used | `company.used_storage` | whole GB, refreshed by cron, not live |
| Extra storage bought | `company.extra_storage_space` | |
| Overage price | `plan.per_gb_price` | DECIMAL(10,2) |
| Which countries are included | `plan.call_countries`, `plan.sms_countries` | **US only** |

### Unlimited already exists — do not reinvent it

`UNLIMITED_STORED_THRESHOLD` in `src/lib/plan-catalogue.ts` is `999,999,999`.
Any allowance at or above it prints as "Unlimited". There is a full meter beside
it in `src/lib/allowance-meter.ts` distinguishing four cases — unknown,
unlimited, none, metered — and "unknown" is deliberately not "none".

We are using 5,000 rather than unlimited **on purpose**: a real number can be
tested and explained, and a customer can be told what happens at 5,001.

---

## The rule

1. Usage inside the plan's country list draws on the allowance.
2. When an allowance is exhausted, further usage is charged **per unit from the
   wallet** at the rate-card rate, and writes a `Balance Deduct` row.
3. **Anything outside the country list always comes from the wallet**, from the
   first unit. International is never covered by an allowance.
4. When the plan expires, **everything stops** — calls in and out, SMS, MMS, AI.

**Rule 3 is the one that protects the business.** "5,000 US minutes" becomes
"5,000 minutes to anywhere" the moment `call_countries` is wrong, and that is how
a telecom product loses money overnight. It wants checking twice when the plans
are seeded, and a test with a non-US destination before launch.

---

## What has to be built before any of this is real

The plans are data. **The meter is the work.**

| Piece | State |
|---|---|
| Storage | **Complete.** Allowance, per-GB overage, counter, purchasable extra, renewal, limit warning |
| Call minutes | Counted (`call_duration_used`) but **never compared** to the allowance — the value is only read and displayed |
| SMS / MMS | **Not counted at all.** No column, nothing writes one |
| AI voice / replies | **Not counted.** There is a wallet check that returns 402, but it reads the wallet, not the allowance |
| Allowance → wallet switch | **Does not exist.** `free_sms` appears only in the model and in commented-out code |
| `Balance Deduct` | The charge type exists in the schema. **Nothing writes one** |
| Expiry stops calls | Unknown — voice rating is in `/opt/call-manager-api`, a compiled binary with no source |

**Storage is the working example.** It has every part the others are missing.
Whoever builds the SMS and AI meters should copy its shape rather than invent one.

### Order

1. **Counters** — used SMS, MMS, AI minutes, AI replies, per company per period.
2. **The switch** — one rating function: covered by the allowance? If not, charge
   the wallet at the rate-card rate and write `Balance Deduct`.
3. **Confirm expiry blocks calls.** Either get into `call-manager-api`, or test
   it: expire a trial account and place a call.
4. **Then the screens.** Usage and Summary become real the moment 1 and 2 exist.

---

## Still open

- **Plan prices.** No `cost` values agreed yet.
- **Per-GB overage price.** `per_gb_price` has no figure.
- **When allowances reset** — the renewal date, or the calendar month? These
  differ for a customer who joined on the 20th.
- **Rollover** — does unused allowance carry over, or vanish?

The first two block seeding the plans. The second two block building the meter.
