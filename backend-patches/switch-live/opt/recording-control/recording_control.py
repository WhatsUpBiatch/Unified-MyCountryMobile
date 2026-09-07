#!/usr/bin/env python3
"""
Recording control — on-demand call recording triggered from the softphone Record
button (DTMF does not survive this WebRTC setup, so the button calls this).

Isolated service on 127.0.0.1:9100; nginx proxies one path to it. A bug here
cannot affect any other service.

POST /api/internal/recording-control/toggle
  Authorization: Bearer <the user's login JWT>
  { "sip_call_id": "<JsSIP Call-ID>", "action": "start"|"stop" }

Speed: every FreeSWITCH interaction costs a `docker exec` round-trip, so calls
are BATCHED — one exec to list channels, one to read sip_call_id + company_uuid
for all of them, one to run the record commands (announcement first, so it is
heard immediately).
"""
import base64, hashlib, hmac, json, subprocess, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ENV_PATH = "/var/www/prod/default-api/.env"
CONTAINER = "mcm-freeswitch"
SOUNDS = "/etc/freeswitch/sounds/mcm/"
RECDIR = "/opt/call-recordings/tmp/"
LISTEN = ("127.0.0.1", 9100)


def read_env(key):
    try:
        for line in open(ENV_PATH, encoding="utf-8"):
            line = line.strip()
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


JWT_SECRET = read_env("JWT_SECRET")


def b64url_decode(seg):
    seg += "=" * (-len(seg) % 4)
    return base64.urlsafe_b64decode(seg)


def verify_jwt(token):
    try:
        h, p, sig = token.split(".")
        expected = hmac.new(JWT_SECRET.encode(), (h + "." + p).encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, b64url_decode(sig)):
            return None
        claims = json.loads(b64url_decode(p))
        exp = claims.get("exp")
        if exp and time.time() > float(exp):
            return None
        return claims
    except Exception:
        return None


def fs_x(cmd):
    """One fs_cli command (one docker exec)."""
    try:
        return subprocess.run(["docker", "exec", CONTAINER, "fs_cli", "-x", cmd],
                              capture_output=True, text=True, timeout=15).stdout or ""
    except Exception:
        return ""


def fs_script(script):
    """Several shell/fs_cli commands in ONE docker exec."""
    try:
        return subprocess.run(["docker", "exec", CONTAINER, "sh", "-c", script],
                              capture_output=True, text=True, timeout=20).stdout or ""
    except Exception:
        return ""


def find_call(sip_call_id):
    """Return (uuid, company_uuid) for the channel whose sip_call_id matches, in
    two batched docker execs instead of one per channel."""
    raw = fs_x("show channels as json")
    try:
        rows = json.loads(raw).get("rows", []) if raw.strip() else []
    except Exception:
        rows = []
    uuids = [r.get("uuid") for r in rows if r.get("uuid")]
    if not uuids:
        return None, None
    # one exec: "uuid|sip_call_id|company_uuid" per channel
    parts = []
    for u in uuids:
        parts.append(
            "printf '%s|' '{u}'; fs_cli -x 'uuid_getvar {u} sip_call_id' | tr -d '\\n'; "
            "printf '|'; fs_cli -x 'uuid_getvar {u} company_uuid'".format(u=u)
        )
    out = fs_script(" ; ".join(parts))
    for line in out.splitlines():
        bits = line.split("|")
        if len(bits) >= 2 and bits[1].strip() == sip_call_id:
            company = bits[2].strip() if len(bits) >= 3 else ""
            if company in ("_undef_",):
                company = ""
            return bits[0].strip(), company
    return None, None


def start_recording(uuid, company):
    path = RECDIR + uuid + ".wav"
    cmds = [
        # announcement first so it is heard immediately
        "fs_cli -x 'uuid_broadcast {u} {s}recording-on-demand-start.wav both'".format(u=uuid, s=SOUNDS),
        "fs_cli -x 'uuid_setvar {u} recording_follow_transfer true'".format(u=uuid),
        "fs_cli -x 'uuid_record {u} start {p} both'".format(u=uuid, p=path),
        "fs_cli -x 'uuid_setvar {u} ondemand_recording true'".format(u=uuid),
    ]
    if company:
        cmds.insert(2, "fs_cli -x 'uuid_setvar {u} api_hangup_hook \"lua upload_recording.lua {u} {c}\"'".format(u=uuid, c=company))
    fs_script(" ; ".join(cmds))
    return {"path": path, "company": company}


def stop_recording(uuid):
    path = RECDIR + uuid + ".wav"
    cmds = [
        "fs_cli -x 'uuid_record {u} stop {p}'".format(u=uuid, p=path),
        "fs_cli -x 'uuid_broadcast {u} {s}recording-on-demand-stop.wav both'".format(u=uuid, s=SOUNDS),
        "fs_cli -x 'uuid_setvar {u} ondemand_recording false'".format(u=uuid),
    ]
    fs_script(" ; ".join(cmds))
    return {"stopped": True}


def call_status(uuid):
    """Whether this live call is recording, and whether it is locked (automatic).
    recording_follow_transfer is set whenever recording is on (automatic or
    on-demand); ondemand_recording is set only by an agent's on-demand toggle. So
    recording-on with no on-demand flag means automatic -> locked."""
    out = fs_script(
        "printf 'RFT='; fs_cli -x 'uuid_getvar {u} recording_follow_transfer'; "
        "printf 'OD='; fs_cli -x 'uuid_getvar {u} ondemand_recording'".format(u=uuid)
    )
    rft = od = ""
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("RFT="):
            rft = line[4:].strip()
        elif line.startswith("OD="):
            od = line[3:].strip()
    recording = (rft == "true") or (od == "true")
    locked = (rft == "true") and (od != "true")
    return {"recording": recording, "locked": locked}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.rstrip("/") != "/api/internal/recording-control/toggle":
            return self._send(404, {"success": False, "message": "not found"})
        auth = self.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if not token or verify_jwt(token) is None:
            return self._send(401, {"success": False, "message": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._send(400, {"success": False, "message": "bad json"})
        sip_call_id = str(data.get("sip_call_id") or "").strip()
        action = str(data.get("action") or "").strip().lower()
        if not sip_call_id or action not in ("start", "stop", "status"):
            return self._send(400, {"success": False, "message": "sip_call_id and action(start|stop|status) required"})
        uuid, company = find_call(sip_call_id)
        if not uuid:
            if action == "status":
                return self._send(200, {"success": True, "recording": False, "locked": False})
            return self._send(404, {"success": False, "message": "no live call for that id"})
        if action == "status":
            return self._send(200, dict({"success": True}, **call_status(uuid)))
        result = start_recording(uuid, company) if action == "start" else stop_recording(uuid)
        return self._send(200, {"success": True, "action": action, "uuid": uuid, "detail": result})


if __name__ == "__main__":
    if not JWT_SECRET:
        raise SystemExit("JWT_SECRET not found in %s" % ENV_PATH)
    ThreadingHTTPServer(LISTEN, Handler).serve_forever()
