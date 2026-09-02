# Queues across voice and chat: the model, what we have, what is missing

Research 2 Sep 2026. Live system checked directly; the reference product's
behaviour taken from its own published documentation (sources at the end).

House rule: the reference product is never named in UI text or code comments.
It is named here because this is an internal brief and the source matters.

---

## 1. The model we should be building to

The reference product's whole idea is that **a queue is not a phone thing**. It
is one waiting line that any kind of contact joins, and one set of people who
answer it. Six ideas hold it together.

**1. One queue, many channels.** The same queue routes voice, chat, email,
callback, message and workitems. Same members, same routing method, same
reporting. A channel is a property of the *contact*, not a reason to build a
second queue.

**2. On duty or off duty.** Only someone on duty is offered anything. Everything
else — break, wrap-up, already busy — is a further reason they cannot take *this*
one.

**3. Capacity is per channel, and this is the part that matters.** Their
defaults: **1 voice call, 1 email, 1 callback, up to 4 chats, up to 4 messages.**
An agent is not "free" or "busy" — they are *"free for chat, full on voice"*.
Configurable per agent (max 50) or per organisation (max 25).

**4. Channels can interrupt each other.** You declare which. A voice call can be
set to interrupt someone mid-chat, because a caller will not wait while a chat
does.

**5. The waiting list is shown per channel.** The queue view lists what is
waiting right now, with an icon per channel, filterable by channel.

**6. The numbers are per channel too.** Service level =
`(Answered − SLA violations) / Total`. Abandon % = `Abandoned / Offered`. A queue
answering voice well and chat badly must be visible as exactly that.

---

## 2. What we have built, checked live

Better than expected in one place, absent in another.

### Voice routing is real

`/opt/queue-agent-service` genuinely decides who rings. Verified against the live
queue: it returns the real ring strategy and real membership, and an invented
queue id gets a different, correct answer.

**The duty-state model is genuinely close to the reference product** and is the
best-built thing here. It distinguishes five reasons a person cannot take a call
and says which, in plain words:

```
"Nobody can take it right now - 2 signed out."
"... 1 finishing notes, 1 on a call, 1 on a break, 1 passed over for missed calls."
```

Signed out, on a break, on a call, wrapping up, and passed over for too many
missed calls. That is idea 2 above, already done, and done well.

Five of six ring strategies work. The sixth is dead for want of a recorded
figure — see the ring-strategy section of `performance-reports-research.md`.

### Chat exists, but only as an AI product

29 AI agents, and **13 of them have `channel: 'chat'`** — customer-support-chat,
healthcare-chat, finance-banking-chat. 29 website widgets are registered.

So customers *can* already chat with us. **That chat can never reach a human
queue.** It goes to an AI agent and stops there.

The `chat-api` service is not the customer channel — it is staff messaging over
XMPP. The `chats`, `omni_chat_lists` and `omni_did_lists` collections are all
**empty**.

---

## 3. What is missing

Six gaps, in the order they block each other.

### 3.1 A queue has no channel. At all.

The full queue record has **no media type field of any kind**. Every field on it
is telephony: `extension`, `moh_sound`, `call_recording`, `auto_answer`,
`wrap_seconds`. The data model says "queue" and means "phone queue".

Nothing else on this list can be built until a queue can say what it handles.

### 3.2 An agent is free or busy, never "free for chat"

The agent picker has **zero** occurrences of `media`, `channel`, `chat`,
`capacity`, `concurrent`, `utilization` or `interruptible`. On a call means
unavailable, full stop.

That is correct for voice and fatal for chat. Without capacity, one chat blocks a
person as completely as a phone call, and the four-chats-at-once idea cannot
exist.

### 3.3 Chat has no waiting line

There is no chat interaction object, no pending state, nothing that could be
"waiting 40 seconds for a human". A pending chat cannot be shown on the queue
screen because there is nothing to show.

### 3.4 No handoff from AI chat to a person

All 29 AI agents carry `forward_call_actions`, but that block holds media and
language settings. There is no path from "the AI cannot help" to "join the human
queue".

This is the gap a customer feels most: they chat, the bot fails them, and there
is nowhere to go.

### 3.5 The Performance page has no channel dimension

Every tab is voice-shaped. No channel filter, no channel icon, no per-channel
numbers, no waiting list.

And it shows **1 of 8 queues** for our busiest tenant, because the query filters
to `type: 'QUEUE'` while campaign queues are `type: 'CAMPAIGN'` in the same
collection.

### 3.6 Campaigns are half-visible

13 campaigns exist with real dial methods (7 preview, 3 progressive, 3
predictive). Their backing queues are hidden by 3.5. Whether a dialled campaign
call reaches `call_history` is **still unproven** — that test has not been run.

---

## 4. How to build it

Five stages. Each is useful alone, and each unlocks the next. Stages 1 and 2 are
most of the visible win for least work.

### Stage 1 — Make the voice picture honest (days)

No new concepts, just stop hiding things.

- Show campaign queues on Queues Activity: accept both `type` values and carry
  `type` through so the row can be labelled. 1 queue becomes 8.
- Repoint the DID that routes into a queue record that does not exist.
- Prove whether campaign calls reach `call_history`. **Do this before building
  anything that assumes they do.**

*Retest:* the tab lists 8 for TestersCompany2, each labelled; a tenant with only
real queues is unchanged.

### Stage 2 — Give a queue a channel (days)

- Add `channels: ['voice']` to the queue record. Default every existing queue to
  voice, so nothing changes on the day it ships.
- Carry it through the queue API and show it on the row.
- Add a channel filter to Queues Activity that only offers what the tenant
  actually has.

*Retest:* every existing queue still reads voice-only and behaves identically;
the filter with voice selected matches today's list exactly.

### Stage 3 — Capacity per channel (1-2 weeks)

The keystone. Replace "busy" with "how many of each can this person still take".

- Per-agent capacity, defaulting to **1 voice, 4 chats** — the reference
  product's own defaults, and sane.
- `duty_state()` becomes `capacity_for(channel)`. Keep the five reasons: they are
  good and customers understand them.
- Declare which channel interrupts which. Start with: voice interrupts chat,
  nothing interrupts voice.

*Retest:* an agent on a chat is still offered a call; an agent on a call is not
offered a second call; a fourth chat is offered and a fifth is not.

### Stage 4 — Chat reaches a human (2-3 weeks)

- A chat interaction object with the same lifecycle as a call: waiting, offered,
  accepted, wrapped.
- AI agents get a real handoff target — a queue — used when the bot cannot help
  or the customer asks for a person.
- The picker routes a waiting chat using the same strategies already written.
  They sort people; they do not care what is being routed.

*Retest:* a website chat that asks for a human joins the queue, shows as waiting,
and is offered to an agent who is already on a call.

### Stage 5 — One waiting list, all channels (1 week)

- Queues Activity gains a Waiting list: what is waiting, in which channel, how
  long, filterable by channel.
- Service level and abandon % per channel.

*Retest:* a pending chat and a waiting call appear in the same list with correct
ages, and the channel filter separates them.

---

## 5. What to hold on to

Two things here are already right and should survive the rebuild.

**The duty-state wording.** "1 finishing notes, 1 on a break, 2 signed out" is
better than most products manage. It says why, in words a supervisor can act on.
Extend it per channel; do not replace it.

**The ring strategies.** They sort *people*. Nothing in them is voice-specific,
so they carry over to chat unchanged. That is a real head start.

---

## 6. Honest limits of this research

- **No live call has been placed through a queue.** Code, data and names all line
  up. Nobody has watched five phones ring in order. Everything above about voice
  routing is "the machinery is right", not "it was seen working".
- **Campaign calls reaching `call_history` is unproven**, and Stage 1 says so.
- The reference product's capacity numbers are from its documentation, not from
  using it.

---

## Sources

- [About interaction routing (ACD)](https://help.genesys.cloud/articles/about-interaction-routing/)
- [Agent utilization](https://help.genesys.cloud/articles/utilization/)
- [Configure utilization at the org level](https://help.genesys.cloud/articles/configure-utilization-at-the-org-level/)
- [Queues Activity Summary view](https://help.genesys.cloud/articles/queues-activity-summary-view/)
- [Queues Activity Detail view](https://help.genesys.cloud/?p=185887)
- [Create and configure queues](https://help.genesys.cloud/articles/create-queues/)
