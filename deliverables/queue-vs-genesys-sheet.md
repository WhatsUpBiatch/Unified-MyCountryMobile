# Call queue — us against Genesys

Refreshed 2 September 2026. Supersedes the queue half of
`docs/call-queues-and-ivr-sheet.md`, which was written on 29 August and is now
stale in three places.

Genesys side taken from the `Queue` object in their public API spec, not from
prose. Our side taken from the live form and the payload it actually sends.
**Do not put a rival's name into product UI text or comments.**

---

## What changed since the last sheet

1. **`mod_callcenter` is loaded now.** It was not. The config endpoint that used
   to return 400 returns 200, and the dialplan has a QUEUE branch.
2. **Eight settings were added and then stopped being sent.** The backend's queue
   schema rejects unknown keys, so sending them failed the whole save — an admin
   renaming a queue was told it did not work. They stay on screen marked "coming
   soon" because nothing acts on them either way.
3. **We have seven ring strategies, not two.** The 29 August sheet said two. That
   was wrong, from grepping one file instead of reading the constants.

---

## How each side thinks about a queue

**Theirs is one object with everything on it.** A queue carries its own routing
rules, its per-channel settings, its escalation rings, its wrap-up policy and the
flows that play while somebody waits. Change the queue, change the behaviour.

**Ours is a form over a settings blob**, and the parts that decide behaviour live
in different places: ring strategy on the queue, business hours on the queue but
also on the company, recording on the queue and on the company, greetings on the
queue and on the company.

That difference is why a change here can be undone by a change somewhere else,
and theirs cannot.

---

## Sheet

### Who gets rung

| | Genesys | Us | |
|---|---|---|---|
| Distribution method | not a list — skill evaluation plus rings | **7 strategies**: ring all, longest idle, round robin, top down, least talk time, fewest calls, random | **we lead** |
| Members | users and groups | users, with a required manager | ok |
| Skills + proficiency | skills, ratings, skill groups, validated expressions | none — **though the backend accepts a `skills` field we never send** | gap |
| Escalate to more people over time | bullseye rings, each with a timer, and a ring may drop a skill | built, not sent, marked coming soon | gap |
| Send a repeat caller to their last agent | 3 modes | built, not sent | gap |
| Ring one named person, then a backup queue | yes | no | gap |
| Cap on concurrent work per agent | per media type | no | gap |
| Auto-answer | per media | no | gap |

### How long they wait

| | Genesys | Us | |
|---|---|---|---|
| Per-agent ring time | per media | per member, seeded from the company | ok |
| Max time in queue | flow-driven | 10 s – 300 min | ok |
| Max callers waiting | no cap of this shape | 1 – 500 | ok |
| Leave if nobody is on duty | flow logic | yes | ok |

### What the caller hears

| | Genesys | Us | |
|---|---|---|---|
| Welcome / hold / waiting / ring tone | in-queue flow | four separate slots | ok |
| No agent available / all agents busy | flow branch | both | ok |
| Whisper to the agent before connecting | yes | no | gap |
| Message repeating on a timer | in-queue loop | built, not sent | gap |
| Place in the queue | yes | built, not sent | gap |
| Expected wait | per queue and per channel | built, not sent | gap |

### When nobody answers

| | Genesys | Us | |
|---|---|---|---|
| Where the call goes at timeout | flow-driven | **11 destinations** incl. queue, menu, AI agent | **we lead** |
| Overflow while still waiting | conditional, on a threshold | only at timeout | gap |
| Callback keeping their place | callback media, agent-owned | built, not sent | gap |
| Voicemail | yes | personal or shared | ok |

### After the call

| | Genesys | Us | |
|---|---|---|---|
| Wrap-up time | yes | 0 – 3600 s | ok |
| Wrap-up rule | **5 modes** | built, not sent — a timer only | gap |
| Dispositions | wrap-up codes | **required, minimum one** | **we lead** |
| Recording | org and queue policy | automatic and on-demand | ok |
| Transcription | yes | yes | ok |
| Listen in / whisper / barge | yes | monitoring module | ok |

### Measuring, and hours

| | Genesys | Us | |
|---|---|---|---|
| Service level target | on the queue, per channel | built, not sent | gap |
| Channels | 5 — voice, callback, chat, email, message | voice only | gap |
| Opening hours | schedules with a recurrence rule | 24 h or per weekday, per queue | ok |
| Holidays | holiday schedule in a group | per queue | ok |
| Timezone per queue | inherited from the site | **own override** | **we lead** |
| Emergency override | emergency groups | no | gap |

---

## The count

**Five things we do better:** more ring strategies, eleven timeout destinations
including an AI agent, dispositions that are actually required, caller ID masking,
and a per-queue timezone.

**Eleven real gaps.** Eight of them are already built and switched off, waiting
for the backend to accept them. Three are not built at all: skills, whisper to the
agent, and channels other than voice.

**The one to do first is skills.** It is the only gap where the backend is already
ahead of us — the queue schema accepts a `skills` field and we never send one. It
also unlocks the two biggest routing gaps, because bullseye rings and skill
evaluation both need skills to exist first.

---

## The honest summary

The queue **configuration** is close to theirs and beats it in places. What is
missing is not screens.

Eight settings are drawn, saved by the form, and then deliberately dropped before
the request goes out, because the backend refuses keys it does not know. Until its
queue schema accepts them, those controls are decoration — and a third of that
form is decoration today.

So the next queue work is not a page. It is teaching the backend to accept eight
fields, then sending them again in the same change.
