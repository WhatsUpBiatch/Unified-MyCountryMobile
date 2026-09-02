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

## Overage rates — what happens past the allowance

Written as **dollars**. The user said "cents"; read literally every rate would sit
below cost — 0.02 cents is a fifth of a penny against an SMS that costs us about
0.8 of a penny to send. Dollars is the only reading that works, and each one then
carries a sensible margin. **Confirm before seeding.**

| Item | Charged | Roughly costs us | Margin |
|---|---|---|---|
| SMS (US) | **$0.02** each | ~$0.008 | ~2.5x |
| MMS (US) | **$0.03** each | ~$0.02 | ~1.5x |
| SMS / MMS (international) | **$0.10** each | varies widely | see below |
| AI voice | **$0.08** per minute | ~$0.02 | ~4x |
| AI reply | **$0.08** each | ~$0.01 | ~8x |
| Storage | **$0.30** per GB / month | ~$0.007 | ~43x |

Storage looks like a large multiple because the customer is buying retention,
retrieval and the player, not the disk. MMS is the thin one — 1.5x leaves little
room if carrier pricing moves, and it is the rate to revisit first.

### International messaging: flat $0.10, for now

| Destination | SMS | MMS |
|---|---|---|
| US (past the allowance) | $0.02 | $0.03 |
| **Everywhere else** | **$0.10** | **$0.10** |

International never draws on the allowance, so this applies from the first
message.

**A flat rate is a decision with a known risk, and "for now" is doing real work
in that sentence.** International SMS wholesale is not flat: cheap destinations
run a couple of cents, and expensive ones — parts of Africa, the Middle East,
and some island and satellite ranges — run well above $0.10 a message. On those
we would pay more to send than we charge, and the loss grows with volume rather
than showing up as a bad month.

This is fine while messaging abroad is rare and worth watching once it is not.
Two ways to stay safe without pricing every country:

* **Watch the top destinations by volume.** A handful will be most of the
  traffic; check those against what we pay and adjust.
* **Cap or block the expensive ranges** until they are priced properly, the same
  way premium-rate numbers are handled on the calling side.

The rate card can hold per-destination prices whenever that becomes worth doing —
that is exactly what it is for, so nothing has to be rebuilt to move off the flat
rate later.

### Minutes are the exception: they STOP

Past 5,000 US minutes the customer **cannot make or receive more US calls**. There
is no per-minute overage and nothing is taken from the wallet.

Everything else flows to the wallet; calling alone hits a wall. That is a
deliberate decision and it needs saying on screen well before it happens, because
a phone system that stops answering is the worst possible surprise. The warning
wants to arrive at 80% and again at 95%, not at 100%.

International calling is unaffected by this — it never used the allowance in the
first place and always draws on the wallet.

### Where these rates live

`plan.per_gb_price` already exists for storage. The other four have **no column**:
there is no `sms_rate`, `mms_rate` or AI overage price on the plan — only
`ai_call_rate` and `ai_message_rate`, which are the AI ones. SMS and MMS overage
prices have nowhere to be stored yet.

Options: put them on the plan as new columns, or express them as a rate card,
which is what `sms_rate_card_uuid` and `mms_rate_card_uuid` already point at. The
rate card is the better fit — it is per destination, so a US price and an
international price can differ, which they will.

---

## Price and billing cycle

| | Starter | Growth | Scale |
|---|---|---|---|
| Price | **$30** | **$40** | **$50** USD / month |

**No rollover.** Unused allowance vanishes at the end of the period; nothing
carries forward.

### "Everyone expires on the 29th" — three things to settle

**1. The backend does not bill this way today.** `company.plan_duration` is an
integer added to `plan_start_date`, so renewal is an *anniversary* of when the
customer joined — every customer on their own date. A single fixed date for
everybody is a different model and needs the renewal cron changed, not just a
configuration value.

**2. February has no 29th in three years out of four.** A rule keyed to the 29th
has to say what it does on 28 February 2027, 2029 and 2030. The usual answer is
"the last day of the month if the 29th does not exist", but it has to be written
down, or three years from now somebody's allowances silently do not reset.

**3. Somebody joining on the 28th gets one day for $30.** With a fixed cycle,
their first period is a single day and they still pay a full month unless the
first invoice is pro-rated. Two honest options:

* **Pro-rate the first month** — charge for the days remaining, then full price
  from the next 29th. Fairer, and standard.
* **Start their cycle on the day they join** — which is anniversary billing, i.e.
  what the code already does.

The second is free, because it is the existing behaviour. The first is a real
change to the renewal cron.

**Recommendation:** unless there is a finance reason for one company-wide billing
date, keep anniversary billing. It is already built, it has no February problem,
and it needs no pro-rating. A fixed 29th buys a tidier finance calendar and costs
a cron rewrite plus two edge cases.

---

## Still open

- **Fixed 29th, or anniversary billing?** See above. Anniversary is what the code
  already does; a fixed date needs the renewal cron changed and two edge cases
  answered.
- **If fixed: what happens in February**, and **is the first month pro-rated?**

Everything else needed to seed the three plans is now decided.
