# IVR — how to start, without colliding with the call and queue work

3 September 2026. The developers are editing `dialplan_service.py` (licence /
channel counting, person states) and `queue_agent_service.py` (agent states)
today. IVR's blockers sit elsewhere, except one small piece.

## What IVR depends on, and who owns each piece today

| IVR needs | Lives in | Being edited now? | Owner |
|---|---|---|---|
| B1 Greeting download fixed | Go config service + one media route in default-api | No | Free |
| B2 Sound library installed | `/etc/freeswitch/sounds` + `vars.xml` | No | Free — voicemail and queue prompts need the same fix |
| B3 Router answers the 7 key-press contexts | `dialplan_service.py` — same file, different region (`do_POST`) | Yes, but in other functions | Router developer, by brief |
| Source in a repo | The 6 server-only files | No | Free, urgent |

## Start today — three tracks that touch nobody's work

**Track A — put the switch files in a repo (½ day, first).**
Router, queue Lua, agent service, shim, directory service, ingesters. Every
change below needs a file with history.

**Track B — sound library (hours).**
One tarball into `/etc/freeswitch/sounds/en/`, `sounds_dir` in `vars.xml`,
`reloadxml`. Unblocks IVR prompts, voicemail goodbye, queue "nobody available".
Test: `docker exec mcm-freeswitch ls /etc/freeswitch/sounds/en/us/callie/ivr/`.

**Track C — greeting fetch (1 day).**
Preferred: copy the queue path — read Wasabi directly with the media API's
credentials, write to `/etc/freeswitch/sounds/ivr/<company>/`; change
`freeSwitchSoundsPath` in `httpapi.go:19`; rebuild and deploy the binary.
Alternative: send `PRIVATE_CALL_SECRET` from Go, accept it on the direct route
for `greeting`.
Test: after one menu request, the greeting file exists under the mounted path.

After A+B+C a caller hears the greeting and prompts. Still cannot press anything.

## Track D — the router change, handed to the router developer as a brief

Add a context dispatch to `do_POST`. Today: `internal`/`default` and `public`.
Add: when `Caller-Context` is one of `extension · ivr · queue · voicemail ·
number · message · department · ai`, route to the existing branch for that
target type:

| Context from the IVR key | Send to |
|---|---|
| `extension` | existing internal user-bridge branch |
| `ivr` | existing `route_type == "IVR"` branch |
| `queue` | existing `QUEUE` branch |
| `voicemail` | existing `VOICEMAIL` branch |
| `number` | existing outbound branch (applies country rules) |
| `message` | new: play the file, hang up — small |
| `department` | new: ring-group branch from the fix list — larger, can land later |
| `ai` | whatever the AI receptionist route becomes |

Test before and after, with a control: the seven probes return an
`extension name=`; `Caller-Context=internal dest=1731` still returns
`user-1731`. Then one real call, press 1, and
`grep -c "EXECUTE.*ivr("` on the switch log goes above zero for the first time.

Lands in `do_POST` plus one new function; the developer's current work is in
`company_licence_count` and person rules — should merge cleanly. One commit on
Track A's repo, not a `.bak`.

## Order, with a gate at each step

1. Track A → `git log` shows the six files.
2. Track B → sound files visible inside the container.
3. Track C → greeting file under the mounted path after one menu request.
4. Track D → seven probes pass, control passes, a real call presses 1 and reaches a person.
5. Small finishes (½ day each): refuse to delete a menu a number points at;
   carry `ivr_digit_pressed` into the call record; uncomment the Deepgram TTS
   route and add the language picker.
6. Only then the flow builder — draft/publish first, then steps. 2–3 months;
   a product decision.

## Who does what

| Track | Who | Why |
|---|---|---|
| A — repo | Owner or auditor | Nobody's code changes |
| B — sounds | Auditor, today | One command, verified with a control |
| C — greeting fetch | Auditor | Untouched by developers; auditor caused the regression |
| D — router contexts | Router developer, from the brief | Their file, their day |
| 5 — small finishes | Frontend developer | Portal and tenant-api only |
| 6 — flow builder | Decide first | Product call |

Say to the developers now: stop making `.bak` copies and start committing.

Detail: `ivr-vs-reference-2026-09-03.html`, `status-by-feature-2026-09-03.md`.
