> **Repo HEAD is NOT what is deployed** (verified by the unified5-bb session,
> 2 Sep 2026). The deployed bundle is dated **6 Aug**; the repo's only commit is
> **31 Aug** — the deploy predates it by ~3.5 weeks. Marker test on the live
> bundle: 6 of 7 distinctive source literals present, but
> `custom_jitsi_LVideo_container` (from `src/pages/.../local-track-container/`)
> is absent from both deployed bundles and the CSS, while its sibling
> `custom_jitsi_Screen_Video_container` is present. Same lineage, older source.
> No version string exists in the artifact. **Rebuilding from HEAD would change
> behaviour, not re-emit this bundle.**
>
> Also confirmed there: the deployed build is byte-identical on all three boxes,
> is served by no nginx config on any of them, and reads an XMPP password from
> the query string (`src/App.tsx:224` → `jitsi-context.tsx:950`).

> **CORRECTION, 2 Sep 2026 — the source is NOT gone.**
>
> It is at `git@bitbucket.org:mycountry/video-recorder-portal.git`, HEAD `3ec76b2`
> ("Initial commit", Furqan, 31 Aug 2026). A Vite + React app, 38 files,
> `package.json` name `jitsi-direct-join-vite` version 1.3.3.
>
> Confirmed it is the source for this build: the Tailwind class
> `absolute inset-0 animate-ping`, present in `src/`, appears in the deployed
> bundle. The conclusion below was drawn from the local `mcm-repos` folder only,
> which does not contain every repository. **Do not reverse-engineer the bundle —
> clone the repo.**

# recorder-portal — source recovery record

Recovered 2 Sep 2026. **The original source is gone and cannot be recovered.**
What is preserved here is the deployed build, plus everything that could be read
back out of it. Read the verdict at the bottom before planning any work on this.

## What it is

A Vite + React front end that joins a Jitsi meeting as a hidden recorder
participant. `index.html` titles it "MCM-Recorder". It carries its own copy of
`lib-jitsi-meet.min.js`. Single route: `/:meetingCode`.

It points at `meet.mycountrymobile.com`, which answers 200 — a real Jitsi host,
separate from the three API boxes.

## Where it was found

`/var/www/prod/recorder-portal/dist` on all three boxes — mcm-new, mcm-ucaas3,
mcm-switch. Byte-identical on all three: one build, copied three times.

    41b7314c6d5966db76099fe939828960  assets/index-Bqk6leU-.js     (older, superseded)
    9ef0317f79e8365b800489dac9e80c19  assets/index-DGapSkYW.js     (the one index.html loads)
    b1baf7b4de313c7b5a770247c2e1d9d2  assets/index-CZNJzgBj.css
    4b9564edf2514fa5296fbd1cfa3ce4e4  index.html
    e589353b5185414bf9e400c7814ec662  scripts/lib-jitsi-meet.min.js

The two JS bundles differ **only** in their baked-in Vite env block. The older
one has a stray trailing `;` inside every value (`"meet.mycountrymobile.com;"`),
which the newer one fixes. Nothing else changed between them.

## The source EXISTS — corrected 2 Sep 2026

An earlier version of this file said the source was unrecoverable. That was
wrong. It is at `git@bitbucket.org:mycountry/video-recorder-portal.git`, checked
out locally at `/root/UCAAS/mcm-repos/video-recorder-portal` — package name
`jitsi-direct-join-vite`, version 1.3.3, Vite + React 19 + react-router-dom 7.

Verified, not assumed: all **12** of the bundle's error strings appear in `src/`,
`env.example` lists the same **7** `VITE_*` variables the bundle bakes in, and
`src/App.tsx` contains the `xmpp_username_override` / `xmpp_password_override`
handling seen in the bundle.

**Why it was missed:** the repo was cloned into this shared working tree at
10:18 on 2 Sep by a parallel session, after the searches here had already run.
The lesson is in [[parallel-sessions-share-one-tree]] — re-check the tree before
concluding something is absent, because another session may have just added it.

This directory is still worth keeping. It holds the **exact artefact that is
deployed**, which the repo does not: the repo is source at 1.3.3, and what is on
the three boxes is one specific build of it.

## Two things worth acting on

**It is not served.** No nginx configuration on any of the three boxes mentions
`recorder-portal`, and no `root` directive points at that directory. nginx is
the only web server listening on 80/443 on mcm-new. The directory is sitting on
disk unreferenced — a leftover of a deploy script that copies everything, not a
running service.

**It takes XMPP credentials from the URL.** `xmpp_password_override` is read
straight off the query string. Anything that launches this app puts a password
in a URL, where it lands in browser history, in `Referer` headers and in any
access log along the path. If this app is ever revived, that is the first thing
to change.

## Verdict

Do not schedule a reconstruction — and not because the source is gone. It is
not gone: build from `video-recorder-portal` if this is ever wanted. Nothing
needs to be reversed out of the bundle.

What is worth knowing before reviving it: the only build that exists anywhere is
a **QA** build, **no nginx config serves it** on any box, and it takes an XMPP
password from the query string. Call recording has never produced a file for
anyone, so there is nothing for a recorder to do yet either.

This directory's job is narrow and still useful: it holds the exact artefact
running on the three boxes, which the repo does not.
