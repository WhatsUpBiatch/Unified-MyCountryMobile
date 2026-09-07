"""Insert the IP allowlist check into AuthController.login().

Same discipline as the fs-xml-api patches in this repo: anchor on exact text
taken from the real file, replace, and refuse (assert) if the anchor is not
found EXACTLY once. A patch that silently matches zero or many places is worse
than one that fails loudly.

WHERE IT GOES, AND WHY THERE. Right after `findCompany` is loaded and confirmed
to exist, and before the plan-status branches. The anchor includes the
attribute list of the query that loads `findCompany` (`"postal_code", "address",
"website_uuid"`) because the bare "if (!findCompany)" guard is NOT unique - the
sibling `loginCRM()` method a few hundred lines down has an identical-looking
guard after its own, differently-shaped, `Company.findOne`. The first version of
this patch matched both and its own assertion caught it - which is what that
assertion is for.

At that point the request has already survived password verification (so this never becomes a way to probe
which accounts exist - the response for "wrong password" and "right password,
wrong network" must not be distinguishable from outside), and already has
`findCompany.db_name` and `findCompany.uuid` loaded by an existing query this
patch does not duplicate.

Usage:
    python3 patch_login_ip_allowlist.py path/to/AuthController.ts
"""

import io
import sys

PATH = sys.argv[1]
with io.open(PATH, encoding="utf-8") as handle:
    text = handle.read()

IMPORT_ANCHOR = 'import { IAuth, IRequest } from "@/interfaces/IRequest";\n'
IMPORT_ADD = (
    'import { IAuth, IRequest } from "@/interfaces/IRequest";\n'
    'import { checkIpAllowlist } from "@/services/IpAllowlistService";\n'
    'import { ipAllowlistEnforcementEnabled } from "@/middlewares/ipAllowlistFeatureFlag";\n'
)

OLD = '''                        "postal_code",
                        "address",
                        "website_uuid",
                    ],
                });
                if (!findCompany) {
                    return super.sendError(res, "Company details not found.");
                }

                const loginWebsiteError = await this.validateLoginWebsiteAccess('''

NEW = '''                        "postal_code",
                        "address",
                        "website_uuid",
                    ],
                });
                if (!findCompany) {
                    return super.sendError(res, "Company details not found.");
                }

                if (ipAllowlistEnforcementEnabled()) {
                    const allowlistResult = await checkIpAllowlist({
                        dbName: findCompany.db_name,
                        companyUuid: findCompany.uuid,
                        clientIp,
                        userUuid: findUser.uuid,
            userRole: findUser.role,
                        emailAttempted: normalizedLoginEmail,
                    });
                    if (!allowlistResult.allowed) {
                        return res.status(403).json({
                            success: false,
                            message:
                                "Sign-in is not allowed from this network. Contact your admin if this is unexpected.",
                            error: { code: "IP_NOT_ALLOWED" },
                        });
                    }
                }

                const loginWebsiteError = await this.validateLoginWebsiteAccess('''

assert text.count(IMPORT_ANCHOR) == 1, "import anchor not found exactly once - has the file changed?"
assert text.count(OLD) == 1, (
    "login() anchor not found exactly once (found %d) - the surrounding code "
    "has moved since this patch was written; re-derive the anchor by hand "
    "rather than forcing this through" % text.count(OLD)
)

text = text.replace(IMPORT_ANCHOR, IMPORT_ADD)
text = text.replace(OLD, NEW)

with io.open(PATH, "w", encoding="utf-8") as handle:
    handle.write(text)
print("patched %s" % PATH)
