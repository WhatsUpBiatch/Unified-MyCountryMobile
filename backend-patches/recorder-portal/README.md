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

## Why the source cannot be recovered

- No `.map` files exist anywhere on any of the three boxes.
- No `sourceMappingURL` comment in either JS bundle or the CSS.
- No repo on Bitbucket `mycountry` and none on GitHub `bideptart`.
- The only other copy on this machine, `/root/unified2-backend/recorder-portal`,
  is the same `dist` again — that import took the built output, not source.

The bundle is minified React: 345 KB across 129 lines, every local name reduced
to one or two letters. Beautifying it gives you working JavaScript, not the
original TypeScript. Component names, prop names, file boundaries and all
comments are gone and cannot be derived.

## What WAS recovered from the bundle

Enough to rebuild it from scratch without guessing at the integration.

**Config it expects (Vite env names, exact):**

    VITE_APP_DOMAIN                 meet.mycountrymobile.com
    VITE_APP_FOCUS                  focus.meet.mycountrymobile.com
    VITE_APP_MUC                    conference.meet.mycountrymobile.com
    VITE_APP_SERVICEURL             wss://meet.mycountrymobile.com/xmpp-websocket
    VITE_APP_WEBSOCKETKEEPALIVEURL  https://meet.mycountrymobile.com/_unlock
    VITE_WHITEBOARD_BASE_URL        https://qa.mycountrymobile.com/whiteboard
    VITE_APP_SLUG                   qa

**The deployed build is a QA build.** `VITE_APP_SLUG` is `qa` and the whiteboard
points at `qa.mycountrymobile.com`. Both bundles are QA. No production build of
this app exists on any box.

**Jitsi options it sets:** `enableP2P: false`, `useStunTurn: true`,
`useTurnUdp: false`, simulcast on, video capped at 720p (min 240), BOSH at
`https://<domain>/http-bind`, desktop sharing from screen and window. It joins
with the `iAmRecorder` flag — the Jitsi convention for a participant that
records and is hidden from the roster.

**Inputs it reads:** meeting code from the route or a `meetCode` query param,
plus `name`. It also accepts `xmpp_username_override` and
`xmpp_password_override` from **both** the query string and localStorage.

**Its error messages**, which map out its failure paths: "Meeting code is
missing in URL.", "No meeting code found in URL.", "Recorder credentials not
found in URL.", "Loading Jitsi library...", "Jitsi script is not loaded yet.",
"Connecting to Jitsi server...", "Joining meeting...", "Jitsi connection
failed.", "Failed to join the conference.", "Conference error occurred.",
"Meeting Whiteboard", "Whiteboard is unavailable right now."

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

Do not schedule a reconstruction. This is a QA build of a Jitsi recorder that
nothing currently serves, and call recording has never produced a file for
anyone. If the recorder is wanted later, rebuilding it fresh from the
integration notes above is cheaper and safer than trying to reverse the minified
bundle — and it avoids inheriting the credentials-in-the-URL design.

What matters is that the build is now in git. It was previously on three
disposable boxes and nowhere else.
