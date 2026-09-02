# The switch code that exists nowhere else

Copied off mcm-new (142.93.121.121) on 2 September 2026 and verified byte-for-byte
against the server at the time of copying.

Everything under a `running/` folder here is **the actual file in production**, not
a patch that reconstructs it. That distinction is the point of this directory:
there were already 32 patch scripts for `fs-xml-api`, but replaying 32 patches
against a 16 KB original to rebuild a 68 KB file is not a recovery plan.

## Why this exists

`dialplan_service.py` decides how every inbound call is routed. It is Python,
interpreted, so **the running file is the source**. There is no repository for it:
Bitbucket's `mycountry/fs-xml-api` (`e01b0c6`) is 52 Go files and zero Python — a
different implementation of the same idea. Same for `directory_service.py` against
`mycountry/fs-directory-manager` (`5f5294d`), 20 Go files, zero Python.

Until now its entire history was 29 `.bak-` files sitting beside it in `/opt`.

## What grew, and when

| Date | Size | |
|---|---|---|
| 28 Aug | 16,637 | the original |
| 29 Aug | 16,671 | **mcm-ucaas3 is frozen here** — byte-identical to `bak-prepatch` |
| 30 Aug | 39,129 | **mcm-switch is here** — three lines apart, all one rewrapped comment |
| 1 Sep | 68,491 | current on mcm-new |

One lineage, three points on it. The other two boxes did not diverge; they simply
never received the work. They are running dialplans with no business-hours or
holiday evaluation, no queue routing or queue exits, no call recording, no
per-customer concurrency limit and no queue media.

Three-way comparison verified independently by the `unified5-bb` session.

## Contents

| File | What it is |
|---|---|
| `fs-xml-api/running/dialplan_service.py` | The dialplan. Routes every inbound call. |
| `fs-xml-api/running/queue_media.py` + test | Queue audio, ring strategy, wrap-up, caller cap, queue hours. 30 tests. |
| `fs-xml-api/running/channel_limit.py` + test | Per-customer concurrent-call limit, numbers + 1. 13 tests. |
| `fs-xml-api/running/directory_service.py` | FreeSWITCH user lookups. Identical on all three boxes. |
| `freeswitch/running/callcenter-queue.lua` | The queue script: rings agents, holds callers, takes the exit. |
| `queue-agent-service/running/*` | Agent availability and ring ordering. |

## If you are restoring

Copy the file back to the path it came from and restart the unit — these are not
patches and need no application step:

    /opt/fs-xml-api-1.2.5/dialplan_service.py      → systemctl restart fs-xml-api
    /opt/fs-directory-manager/directory_service.py → systemctl restart fs-directory-manager
    /etc/freeswitch/scripts/callcenter-queue.lua   → no restart; FreeSWITCH reads it per call
    /opt/queue-agent-service/*.py                  → systemctl restart queue-agent-service

Check the lua before it goes live, because a syntax error there breaks every queue
call and there is no compiler to catch it. There is no `lua` binary in the
container, so run it through FreeSWITCH with a deliberately broken control file
first to prove the check can fail:

    docker exec mcm-freeswitch fs_cli -x "luarun /etc/freeswitch/scripts/copy.lua"

A syntax error is reported at load; a complaint about `session` being nil means it
compiled and only failed for want of a call, which is what a healthy script does
when run standalone.

## This is a copy, not a home

These files still live untracked in `/opt` on one machine. Preserving them here
stops a lost box being a lost dialplan; it does not make them versioned. The real
fix is source control the developers push to, and an answer to why the Go
implementation exists and is not what runs.
