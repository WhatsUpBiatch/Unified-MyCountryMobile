#!/usr/bin/env python3
"""Serves callcenter.conf so FreeSWITCH's queue module can start.

WHY THIS EXISTS

Call queues do not work, and this is the bottom of the chain. FreeSWITCH is
configured to load mod_callcenter, the module is present on disk, and it fails
every time:

    [ERR]  mod_callcenter.c:1512 Open of callcenter.conf failed
    [CRIT] Error Loading module mod_callcenter.so

Like the dialplan and the directory, the module fetches its configuration over
HTTP rather than from a file. The service that answers those requests returns
HTTP 400 for callcenter.conf while answering ivr.conf and sofia.conf normally,
and its own log says why: it falls through to a "not found" template whose path
was never set, so it cannot even render its own error. The module gets a broken
answer, refuses to load, and every queue feature above it is dead.

That service is a stripped binary with no source anywhere on the machine, so the
fix cannot be made there.

WHAT THIS DOES INSTEAD

It sits where that service used to sit and answers exactly one question itself -
callcenter.conf - passing every other request straight through to the original,
unchanged, on a new port. Nothing else about the system moves.

A shim rather than a replacement is deliberate. The original answers directory
and IVR requests that work today; reimplementing those to fix one broken answer
would put every working call at risk to repair a broken one.

WHAT IT ANSWERS WITH

A valid, empty queue list. That is enough for the module to load, which is the
whole blockage: mod_callcenter reads this once at startup, and queues are added
afterwards at runtime. Rendering the real queues here instead would need a
database driver this machine does not have, and would still not be read again
until a reload - so it would add a dependency and fix nothing extra.

The <settings> block is left empty exactly as the original template has it, so
the module keeps its own defaults rather than inheriting opinions from here.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import datetime

LISTEN_ADDR = os.environ.get("SHIM_LISTEN_ADDR", "localhost:9002")
# Where the original service now lives. It keeps answering everything else.
UPSTREAM = os.environ.get("SHIM_UPSTREAM", "http://localhost:9012")
UPSTREAM_TIMEOUT = float(os.environ.get("SHIM_UPSTREAM_TIMEOUT", "5"))

# The one request this service answers itself.
OWNED_KEY = "callcenter.conf"

CALLCENTER_CONF = """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
<section name="configuration">
    <configuration name="callcenter.conf" description="CallCenter">
        <settings>
        </settings>
        <queues>
        </queues>
    </configuration>
</section>
</document>"""

# What FreeSWITCH expects when a lookup genuinely finds nothing. Returning this
# rather than an error is the difference between "no such thing" and "the
# service is broken" - the second is what stopped the module loading.
NOT_FOUND = """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
    <section name="result">
        <result status="not found" />
    </section>
</document>"""


def log(level, msg, **kwargs):
    entry = {
        "level": level,
        "@timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "msg": msg,
    }
    entry.update(kwargs)
    print(json.dumps(entry), flush=True)


def wanted_key(body):
    """The configuration file being asked for, or '' if the request is not one.

    FreeSWITCH sends form-encoded fields; the file name arrives as key_value.
    """
    try:
        fields = urllib.parse.parse_qs(body.decode("utf-8", errors="replace"))
    except Exception:
        return ""
    return (fields.get("key_value") or [""])[0].strip()


class Handler(BaseHTTPRequestHandler):
    # The default handler logs a line per request to stderr in Apache format,
    # which would bury the JSON lines this service actually wants to say.
    def log_message(self, fmt, *args):
        return

    def _send(self, status, payload, content_type="text/xml"):
        body = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        key = wanted_key(body)

        if key == OWNED_KEY:
            log("info", "served callcenter.conf", path=self.path)
            self._send(200, CALLCENTER_CONF)
            return

        self._proxy(body)

    def do_GET(self):
        self._proxy(b"")

    def _proxy(self, body):
        """Hand the request to the original service, unchanged.

        If it cannot be reached, answer with FreeSWITCH's own "not found" rather
        than an error page. An error here would break directory and IVR lookups
        that work today, which is the one thing this shim must never do.
        """
        url = UPSTREAM.rstrip("/") + self.path
        request = urllib.request.Request(
            url,
            data=body or None,
            method=self.command,
            headers={
                "Content-Type": self.headers.get("Content-Type", "application/x-www-form-urlencoded"),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT) as answer:
                payload = answer.read()
                self.send_response(answer.status)
                self.send_header(
                    "Content-Type", answer.headers.get("Content-Type", "text/xml")
                )
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as e:
            # The original said no. Pass its answer along verbatim - it may be a
            # legitimate 404 that FreeSWITCH knows how to handle.
            payload = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "text/xml"))
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as e:
            log("error", "upstream unreachable, answering not found", url=url, error=str(e))
            self._send(200, NOT_FOUND)


def main():
    host, _, port = LISTEN_ADDR.rpartition(":")
    server = ThreadingHTTPServer((host or "localhost", int(port)), Handler)
    log("info", "callcenter config shim listening", addr=LISTEN_ADDR, upstream=UPSTREAM)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
