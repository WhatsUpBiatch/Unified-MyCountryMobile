#!/usr/bin/env python3
"""Mount the two new routers in default-api's app file.

    python3 patch_app_routes.py /var/www/prod/default-api/dist/app.js
    python3 patch_app_routes.py /root/UCAAS/mcm-repos/default-api/src/app.ts

Works on the compiled dist/app.js and on src/app.ts (it tells them apart by
the extension). Two imports/requires and two app.use lines are inserted next
to the existing siteRoute ones; nothing else is touched. Safe to run twice:
if the routes are already mounted it says so and exits 0. The original is
kept as <file>.bak-trusted-devices-<timestamp>.

Why a script and not a diff: app.ts / app.js are edited by several changes
at once, and a unified diff carries whichever other hunks happened to be in
the working tree when it was cut. Four lines anchored on siteRoute are the
whole change.
"""
import re
import shutil
import sys
import time

if len(sys.argv) != 2:
    sys.exit(__doc__)

path = sys.argv[1]
src = open(path, encoding="utf-8").read()

if "trustedDeviceRoute" in src and "profileSelfRoute" in src:
    print(f"{path}: already mounted, nothing to do")
    sys.exit(0)

if path.endswith(".ts"):
    import_anchor = 'import siteRoute from "./routers/siteRoute";\n'
    imports = (
        'import profileSelfRoute from "./routers/profileSelfRoute";\n'
        + import_anchor
        + 'import trustedDeviceRoute from "./routers/trustedDeviceRoute";\n'
    )
    use_anchor = re.compile(r'(\n[ \t]*)app\.use\("/api/site", siteRoute\);\n')
    uses = (
        r'\g<0>'
        r'\1/* Own trusted devices + two-step status, and own five-field profile.'
        r'\1   Both read the caller from the session only. */'
        r'\1app.use("/api/security/devices", trustedDeviceRoute);'
        r'\1app.use("/api/profile", profileSelfRoute);\n'
    )
else:
    import_anchor = 'const siteRoute_1 = __importDefault(require("./routers/siteRoute"));\n'
    imports = (
        'const profileSelfRoute_1 = __importDefault(require("./routers/profileSelfRoute"));\n'
        + import_anchor
        + 'const trustedDeviceRoute_1 = __importDefault(require("./routers/trustedDeviceRoute"));\n'
    )
    use_anchor = re.compile(r'(\n[ \t]*)app\.use\("/api/site", siteRoute_1\.default\);\n')
    uses = (
        r'\g<0>'
        r'\1app.use("/api/security/devices", trustedDeviceRoute_1.default);'
        r'\1app.use("/api/profile", profileSelfRoute_1.default);\n'
    )

if src.count(import_anchor) != 1:
    sys.exit(f"{path}: expected exactly one siteRoute import, found {src.count(import_anchor)}; not touching it")
if len(use_anchor.findall(src)) != 1:
    sys.exit(f"{path}: expected exactly one app.use('/api/site'), not touching it")

out = src.replace(import_anchor, imports, 1)
out = use_anchor.sub(uses, out, count=1)

backup = f"{path}.bak-trusted-devices-{time.strftime('%Y%m%d%H%M%S')}"
shutil.copyfile(path, backup)
open(path, "w", encoding="utf-8").write(out)
print(f"{path}: mounted /api/security/devices and /api/profile (backup {backup})")
