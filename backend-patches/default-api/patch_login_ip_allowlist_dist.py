"""Insert the IP allowlist check directly into the COMPILED, running
dist/controllers/AuthController.js — no TypeScript rebuild.

READ THIS FIRST. `patch_login_ip_allowlist.py` (this directory) patches the TS
SOURCE and is the one to use if a full rebuild-and-redeploy of default-api is
ever going to happen anyway. This script exists because, as of this writing,
one is not: production's `AuthController.js` carries at least one hand-applied
fix that is not in the source mirror at all (the trusted-device "Device
already verified" string), and a second production box's `stunHelper.js` /
`mediaRoute.js` changes exist only in this repo's uncommitted working tree, not
in a fresh checkout. A `tsc` rebuild from anywhere except that exact working
tree silently drops what is live today. See the project memory notes
`default-api-source-unrecoverable` and `default-api-source-vs-production-drift`
for the full history — they are why this script exists instead of a normal
build pipeline.

So: this patches the compiled JavaScript that is ALREADY RUNNING, the same way
those two existing hand-patches were made, and touches nothing else in the
file. `dist/*.js` in this directory were compiled from the TypeScript in
`src/` using this project's own `tsc` and its own installed dependencies
(`npx tsc -p tsconfig.json`) — not hand-written — so what ships is exactly what
the TypeScript says, just without a server-side build step.

Usage:
    python3 patch_login_ip_allowlist_dist.py path/to/dist/controllers/AuthController.js

Then copy alongside it (paths relative to the dist/ root the target file lives
under):
    dist/lib/ip-allowlist.js
    dist/services/IpAllowlistService.js
    dist/middlewares/ipAllowlistFeatureFlag.js
    dist/models/CompanySecurityAuditLog.js

`IpAllowlistApiGuard.js` is also provided but is not required by this patch and
is not referenced by it — see that file's own header for why it is not wired
in automatically.
"""

import io
import sys

PATH = sys.argv[1]
with io.open(PATH, encoding="utf-8") as handle:
    text = handle.read()

REQUIRE_ANCHOR = 'const wwConfig_1 = require("../config/wwConfig");\n'
REQUIRE_ADD = (
    'const wwConfig_1 = require("../config/wwConfig");\n'
    'const { checkIpAllowlist } = require("../services/IpAllowlistService");\n'
    'const { ipAllowlistEnforcementEnabled } = require("../middlewares/ipAllowlistFeatureFlag");\n'
)

# The exact block tsc emitted for login()'s Company.findOne + its immediate
# !findCompany guard. Verified against the LIVE file, not a locally recompiled
# guess: pulled with `ssh mcm-new cat dist/controllers/AuthController.js`. A
# bare `if (!findCompany)` guard is NOT unique in this file - loginCRM(), a
# few hundred lines down, compiles to an identical-looking guard after its
# own, differently-shaped, Company lookup, and this script's first draft
# matched both until its own assertion caught it. The anchor therefore
# includes the "postal_code" / "address" attribute pair that only login()'s
# query selects.
OLD = '''                            "postal_code",
                            "address",
                            "website_uuid",
                        ],
                    });
                    if (!findCompany) {
                        return _super.sendError.call(this, res, "Company details not found.");
                    }
                    const loginWebsiteError = yield this.validateLoginWebsiteAccess(req, findCompany === null || findCompany === void 0 ? void 0 : findCompany.website_uuid);'''

NEW = '''                            "postal_code",
                            "address",
                            "website_uuid",
                        ],
                    });
                    if (!findCompany) {
                        return _super.sendError.call(this, res, "Company details not found.");
                    }
                    if (ipAllowlistEnforcementEnabled()) {
                        const allowlistResult = yield checkIpAllowlist({
                            dbName: findCompany.db_name,
                            companyUuid: findCompany.uuid,
                            clientIp,
                            userUuid: findUser.uuid,
                            emailAttempted: normalizedLoginEmail,
                        });
                        if (!allowlistResult.allowed) {
                            return res.status(403).json({
                                success: false,
                                message: "Sign-in is not allowed from this network. Contact your admin if this is unexpected.",
                                error: { code: "IP_NOT_ALLOWED" },
                            });
                        }
                    }
                    const loginWebsiteError = yield this.validateLoginWebsiteAccess(req, findCompany === null || findCompany === void 0 ? void 0 : findCompany.website_uuid);'''

assert text.count(REQUIRE_ANCHOR) == 1, "require anchor not found exactly once - has the file changed?"
assert text.count(OLD) == 1, (
    "login() guard anchor not found exactly once (found %d) - a near-identical "
    "block exists elsewhere in this file (a different method's Company lookup); "
    "re-derive the anchor by hand against the CURRENT live file rather than "
    "forcing this through" % text.count(OLD)
)

text = text.replace(REQUIRE_ANCHOR, REQUIRE_ADD)
text = text.replace(OLD, NEW)

with io.open(PATH, "w", encoding="utf-8") as handle:
    handle.write(text)
print("patched %s" % PATH)
