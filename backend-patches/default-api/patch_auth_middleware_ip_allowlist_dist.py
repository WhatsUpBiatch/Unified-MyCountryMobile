"""Insert the IP allowlist check into the COMPILED, running
dist/middlewares/AuthMiddleware.js — no TypeScript rebuild.

The companion to `patch_login_ip_allowlist_dist.py`. Read that file's header
first — the same reason applies here: production's compiled files carry
hand-applied fixes not present in the TypeScript source mirror, so this edits
the already-running compiled JavaScript directly rather than rebuilding.

WHY THIS FILE MATTERS MOST OF THE TWO. `patch_login_ip_allowlist_dist.py`
blocks a NEW session from starting on a disallowed network. This one blocks
CONTINUED use of a session that already exists — the actual complaint this
patch set was written to answer ("admin blocks a user's IP and the user still
has an open account"). `auth()`, in this file, runs on every authenticated
request in the codebase, admin portal and API alike, so this is the one place
that can possibly be true.

Usage:
    python3 patch_auth_middleware_ip_allowlist_dist.py path/to/dist/middlewares/AuthMiddleware.js

Needs the same five files alongside it that patch_login_ip_allowlist_dist.py
does — see that file's own header for the list and where they come from.
"""

import io
import sys

PATH = sys.argv[1]
with io.open(PATH, encoding="utf-8") as handle:
    text = handle.read()

REQUIRE_ANCHOR = 'const CommonHelper_1 = __importDefault(require("../helpers/CommonHelper"));\n'
REQUIRE_ADD = (
    'const CommonHelper_1 = __importDefault(require("../helpers/CommonHelper"));\n'
    'const { checkIpAllowlist } = require("../services/IpAllowlistService");\n'
    'const { ipAllowlistEnforcementEnabled } = require("../middlewares/ipAllowlistFeatureFlag");\n'
)

# The exact block tsc emitted for the "Un-authenticate or deleted User" guard.
# Verified against the LIVE file, pulled with
# `ssh mcm-new cat dist/middlewares/AuthMiddleware.js`. This guard's shape is
# unique in the file (grepped before writing this), unlike the login() one in
# AuthController.js, which needed a wider anchor to avoid a sibling method.
OLD = '''            if (!sessionUserUuid ||
                sessionUserUuid !== decodedUserUuid ||
                !user ||
                !user.role ||
                !user.company) {
                return res.status(401).json({ message: "Un-authenticate or deleted User" });
            }
            // (rest of your logic unchanged...)
            if (access_scope === PLAN_RENEW_SCOPE) {'''

NEW = '''            if (!sessionUserUuid ||
                sessionUserUuid !== decodedUserUuid ||
                !user ||
                !user.role ||
                !user.company) {
                return res.status(401).json({ message: "Un-authenticate or deleted User" });
            }
            if (ipAllowlistEnforcementEnabled()) {
                const clientIp = yield CommonHelper_1.default.getClientIp(req);
                const allowlistResult = yield checkIpAllowlist({
                    dbName: user.company.db_name,
                    companyUuid: user.company_uuid,
                    clientIp,
                    userUuid: sessionUserUuid,
                });
                if (!allowlistResult.allowed) {
                    yield DeviceSecurityModel_1.default.destroy({
                        where: { user_uuid: sessionUserUuid },
                    });
                    return res.status(403).json({
                        message: "This session is no longer valid from this network. Please sign in again.",
                        error: { code: "IP_NOT_ALLOWED" },
                    });
                }
            }
            // (rest of your logic unchanged...)
            if (access_scope === PLAN_RENEW_SCOPE) {'''

assert text.count(REQUIRE_ANCHOR) == 1, "require anchor not found exactly once - has the file changed?"
assert text.count(OLD) == 1, (
    "auth() guard anchor not found exactly once (found %d) - re-derive the "
    "anchor by hand against the CURRENT live file rather than forcing this "
    "through" % text.count(OLD)
)

text = text.replace(REQUIRE_ANCHOR, REQUIRE_ADD)
text = text.replace(OLD, NEW)

with io.open(PATH, "w", encoding="utf-8") as handle:
    handle.write(text)
print("patched %s" % PATH)
