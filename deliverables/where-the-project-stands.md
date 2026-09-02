# Where the project stands

Written 2 September 2026. Every number is measured, not estimated — the commands
are in the git history of this file's commit.
**Do not put a rival's name into product UI text or comments.**

---

## The size of what exists

| | |
|---|---|
| Front end | **292,000 lines**, 516 page files, 208 routes |
| Admin area alone | **111 screens** |
| Backend services | **15**, all running |
| Call path | FreeSWITCH + Kamailio, in Docker, plus 5 helper services |

This is not a prototype. It is a large, working product with a real switch behind
it, carrying live customers.

**The front end is not the problem.** It is the most finished part of the system.

---

## What actually works today

Calls connect. Numbers route. Voicemail records. Recording captures both legs and
uploads. Menus answer. People sign in, are given roles, are assigned numbers.
Companies have locations, hours, holidays. Billing takes card payments through
Stripe and renews plans on a schedule. There is a directory, chat, video,
campaigns, AI agents and a knowledge base.

A customer can be sold this product today and it will work.

---

## The thing that will decide the next six months

**70 controls, across 19 files, are drawn on screen and do nothing.**

Not broken — *inert*. They save, they load, and nothing acts on them. Every one is
honestly labelled "coming soon" or "saved, but not in effect", which is the right
call and was clearly a deliberate discipline. But the number is now large enough
to be the defining fact about the product.

They cluster in five places:

| Area | What is inert |
|---|---|
| **Call queues** | callback, place in line, expected wait, repeating greeting, wrap-up rule, last-agent routing, service level, tiered ringing — 8 settings, dropped before the request is even sent |
| **Company security** | MFA, IP allowlist, idle timeout, SSO — written to a JSON blob nothing reads |
| **Admin scope** | scoping an administrator to one location — saved, never enforced |
| **Company rules** | several settings the switch does not read |
| **Billing allowances** | SMS, MMS and AI allowances defined on the plan and never counted |

**Why this matters more than any missing feature:** a product where a third of the
settings do nothing is harder to sell honestly, harder to support, and harder to
test than one with fewer, working settings. And every one of these was *built* —
the effort is spent, the value is not banked.

---

## Why they are inert — one cause, not many

**12 of the 15 backend services ship as compiled output with no source code.**

| Have source | No source |
|---|---|
| `tenant-api`, `contact-api`, `security-api` | the other **12** |

Every area of work this week stopped at the same wall:

| I tried to | It needed | Source? |
|---|---|---|
| Restore a deleted user | `default-api` | no |
| Move somebody between sites | `default-api` | no |
| Per-tenant voicemail email | `notification-api` | no |
| Make queue settings save | `campaign-api` | no |
| Count SMS against an allowance | `default-api` | no |
| Check who may play a recording | `media-api` | no |
| Find whether calls stop at zero credit | `call-manager-api` | no |

None of these are hard problems. Restoring a deleted user is **two endpoints** —
the data is already kept, the row survives with a `deleted_at` stamp. It cannot be
done because the program that would do it cannot be rebuilt.

**This is one problem wearing seven hats.**

---

## What can be built without solving it

Real work, but it is all display over data that already exists:

* **Credit & payment** — cards can be listed, added, removed and charged; the
  endpoints are live and no screen uses them
* **Licences & resources** — seats, numbers and storage are on the company record
* **Invoices** — `billing/list` returns the charges; the work is presenting them
* **Modules & add-ons** — thin, probably one screen not two

That is perhaps two to three weeks of front-end work, and none of it makes a
single inert control work.

---

## What it would take, if the source were found

Rough sizes, assuming somebody who knows the services:

| Work | Size |
|---|---|
| Accept the 8 queue settings and act on them | 1–2 weeks |
| Usage counters for SMS, MMS, AI + the allowance-to-wallet switch | 2–3 weeks |
| Deleted users and restore | 1–2 days |
| Move a person between sites | days |
| Skills: model, assignment, routing | 2–3 weeks |
| Enforce MFA, IP allowlist, idle timeout, SSO | 2–4 weeks |
| Enforce admin scope | 1 week |
| Server-side check on who may play a recording | days — **and a live exposure until done** |

Call it **two to three months** to turn everything already drawn into everything
that works. Without the source, none of it is possible at any price.

---

## The security items, separately

Three of these are not features. They are open doors, and they should not wait
their turn behind product work:

1. **Recording playback is enforced in the browser only.** Any signed-in user can
   fetch any recording by asking the API directly.
2. **Billing has no server-side permission check at all.** Same shape.
3. **Five known holes in `default-api`**, including one where any signed-in user
   can end a colleague's sessions. A patch was written and could not be applied.

---

## The recommendation

**Finding the source code is worth more than any feature on any roadmap.**

It is not a technical task. Somebody built and deployed `default-api` 1.2.9 and
the rest; the source existed on whatever machine produced those `dist` folders.
Three places to look: whoever ran the last deploy, the build server or CI that
produced them, and any developer laptop that has ever built this.

If it truly cannot be found, that is a much larger conversation than a roadmap:
**12 services that nobody can fix, audit, patch or extend.** The realistic answer
then is to rewrite them one at a time, starting with `default-api`, which owns
login, users, roles, numbers, companies and billing — and that is a year of work,
not a sprint.

**Until that is settled, every plan is a guess.** The front end can keep improving
and the product will keep selling, but the gap between what the screens promise
and what the platform does will widen, not close.
