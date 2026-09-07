"""Insert the IP allowlist check into AuthMiddleware.ts's `auth()` — the
middleware that runs on EVERY authenticated request, not only login.

WHY THIS FILE EXISTS, SEPARATELY FROM patch_login_ip_allowlist.py. The login
patch answers "can this network start a new session". It does not answer "is
this network still allowed on the SECOND request of a session that started
before an admin changed the rule" - a person already signed in keeps a valid
token, and nothing about a company's allowlist changing invalidates a token
that was issued before the change. Every authenticated call in this codebase
passes through `auth()` here, so this is the one place a mid-session block
can actually take effect - on the very next request the blocked caller makes,
whichever endpoint it is: admin portal or API.

ON BLOCK: two things happen, not one. The request is refused with 403, AND the
DeviceSecurity session row is destroyed - the same action this file already
takes a few lines below when a company's plan lapses (see
`user?.company?.plan_status !== "ACTIVE"`), reused rather than reinvented. A
403-and-carry-on would leave a blocked session able to keep retrying every
request from the same disallowed network forever; destroying the session means
the NEXT attempt, from anywhere, has to go through login again - which is
itself gated by the same check (`patch_login_ip_allowlist.py` /
`patch_login_ip_allowlist_dist.py`).

WHERE IT GOES. Immediately after the existing "Un-authenticate or deleted
User" guard confirms `user.company` exists, and before the plan-status /
access-scope branches that follow it - the request is already known to belong
to a real, current session for a real company at that point, which is exactly
what `dbName` and `companyUuid` need.

Usage:
    python3 patch_auth_middleware_ip_allowlist.py path/to/AuthMiddleware.ts
"""

import io
import sys

PATH = sys.argv[1]
with io.open(PATH, encoding="utf-8") as handle:
    text = handle.read()

IMPORT_ANCHOR = 'import CommonHelper from "@/helpers/CommonHelper";\n'
IMPORT_ADD = (
    'import CommonHelper from "@/helpers/CommonHelper";\n'
    'import { checkIpAllowlist } from "@/services/IpAllowlistService";\n'
    'import { ipAllowlistEnforcementEnabled } from "@/middlewares/ipAllowlistFeatureFlag";\n'
)

OLD = '''            if (
                !sessionUserUuid ||
                sessionUserUuid !== decodedUserUuid ||
                !user ||
                !user.role ||
                !user.company
            ) {
                return res.status(401).json({ message: "Un-authenticate or deleted User" });
            }

            // (rest of your logic unchanged...)
            if (access_scope === PLAN_RENEW_SCOPE) {'''

NEW = '''            if (
                !sessionUserUuid ||
                sessionUserUuid !== decodedUserUuid ||
                !user ||
                !user.role ||
                !user.company
            ) {
                return res.status(401).json({ message: "Un-authenticate or deleted User" });
            }

            if (ipAllowlistEnforcementEnabled()) {
                const clientIp = await CommonHelper.getClientIp(req);
                const allowlistResult = await checkIpAllowlist({
                    dbName: user.company.db_name,
                    companyUuid: user.company_uuid,
                    clientIp,
                    userUuid: sessionUserUuid,
            userRole: user.role,
                });
                if (!allowlistResult.allowed) {
                    // Refuse this request AND end the session, so the next
                    // attempt - from anywhere - has to go through login again,
                    // which is gated by the identical check.
                    await DeviceSecurity.destroy({
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

assert text.count(IMPORT_ANCHOR) == 1, "import anchor not found exactly once - has the file changed?"
assert text.count(OLD) == 1, (
    "auth() guard anchor not found exactly once (found %d) - re-derive the "
    "anchor by hand against the CURRENT file rather than forcing this "
    "through" % text.count(OLD)
)

text = text.replace(IMPORT_ANCHOR, IMPORT_ADD)
text = text.replace(OLD, NEW)

with io.open(PATH, "w", encoding="utf-8") as handle:
    handle.write(text)
print("patched %s" % PATH)
