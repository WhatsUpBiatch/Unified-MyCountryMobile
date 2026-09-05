#!/usr/bin/env python3
"""Add the two registration routes to esl-manager's src/app.ts. Anchored,
idempotent. The two new files (src/utils/registrationFlush.ts,
src/controllers/RegistrationController.ts) are copied whole by apply.sh.

    python3 patch_app_registrations.py [/opt/esl-manager]
"""
import io, os, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/opt/esl-manager"
p = os.path.join(ROOT, "src/app.ts")
s = io.open(p, encoding="utf-8").read()
if "RegistrationController" in s:
    print("app.ts: already has the registration routes")
    sys.exit(0)

imp_anchor = 'import { AzureTranscriptController } from "./controllers/AzureTranscriptController";\n'
route_anchor = "// ============ TRANSCRIPTION ENDPOINTS ============"
for a in (imp_anchor, route_anchor):
    if s.count(a) != 1:
        sys.exit(f"ANCHOR MISSING OR NOT UNIQUE in app.ts: {a[:60]!r}")

s = s.replace(imp_anchor, imp_anchor + 'import { RegistrationController } from "./controllers/RegistrationController";\n', 1)
routes = '''// ============ REGISTRATIONS ============
// Drop a person's phone registrations the moment they are suspended or
// removed (default-api calls this; see backend-patches/suspend-followups).
// Same trust model as the routes below: loopback only. If
// ESL_MANAGER_API_TOKEN is set, the caller must send it as a Bearer token.

const registrationsAuthorised = (req: express.Request): boolean => {
  const token = (process.env.ESL_MANAGER_API_TOKEN || "").trim();
  if (!token) return true;
  const header = String(req.headers["authorization"] || "");
  return header === `Bearer ${token}`;
};

app.post("/registrations/flush", async (req, res) => {
  if (!registrationsAuthorised(req)) return res.status(401).json({ ok: false, error: "unauthorised" });
  const result = await RegistrationController.flush({ ...req.query, ...req.body });
  return res.status(result.error && !result.extension ? 400 : 200).json(result);
});

app.get("/registrations", async (req, res) => {
  if (!registrationsAuthorised(req)) return res.status(401).json({ ok: false, error: "unauthorised" });
  const result = await RegistrationController.list({ ...req.query });
  return res.status(result.ok ? 200 : 400).json(result);
});

'''
s = s.replace(route_anchor, routes + route_anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("app.ts: registration routes added")
