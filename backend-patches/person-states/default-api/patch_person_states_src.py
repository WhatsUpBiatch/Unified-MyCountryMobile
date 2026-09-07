"""The source-tree hunks for person states, for whoever rebuilds default-api
from /root/UCAAS/mcm-repos/default-api one day. Four files, five hunks; the
new files (services/PersonStateService.ts, controllers/PersonStateController.ts,
routers/personStateRoute.ts, helpers/roleGuard.ts, the migration) are copied
whole from the src/ and migrations/ folders beside this script.

Usage: python3 patch_person_states_src.py <path to the default-api checkout>

Anchored and idempotent, like the dist script. The 3 Sep working tree already
carries these hunks (they are where the dist was compiled from); this script
exists so the change survives a fresh checkout.
"""

import io
import os
import sys

ROOT = sys.argv[1]

EDITS = {
    "src/app.ts": [
        ('import userRoute from "./routers/userRoute";\n',
         'import userRoute from "./routers/userRoute";\nimport personStateRoute from "./routers/personStateRoute";\n'),
        ('    app.use("/api/user", userRoute);\n',
         '    app.use("/api/user", userRoute);\n    app.use("/api/person", personStateRoute);\n'),
    ],
    "src/interfaces/IUser.ts": [
        ('  status: "EXPIRED" | "ACTIVE" | "INACTIVE" | "PENDING";\n',
         '  status: "EXPIRED" | "ACTIVE" | "INACTIVE" | "PENDING" | "SUSPENDED";\n'),
    ],
    "src/models/User.ts": [
        ("    public status!: 'EXPIRED' | 'ACTIVE' | 'INACTIVE' | 'PENDING';\n",
         "    public status!: 'EXPIRED' | 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'SUSPENDED';\n"),
        ("        status: { type: DataTypes.ENUM('EXPIRED', 'ACTIVE', 'INACTIVE', 'PENDING'), defaultValue: 'PENDING' },\n",
         "        /* SUSPENDED added 3 Sep 2026 (person states): login, API and the phone\n"
         "           are all refused. The live column is widened on first use by\n"
         "           services/PersonStateService.ts and by the migration of the same day. */\n"
         "        status: { type: DataTypes.ENUM('EXPIRED', 'ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED'), defaultValue: 'PENDING' },\n"),
    ],
    "src/middlewares/AuthMiddleware.ts": [
        ('            } else if (user?.status !== "ACTIVE") {\n'
         '                return res.status(403).json({ message: "Your account is currently restricted and cannot perform this action." });\n'
         '            }',
         '            } else if (user?.status !== "ACTIVE") {\n'
         '                /* Person states (3 Sep 2026): say which state it is, in plain\n'
         '                   words. A suspended person\'s sessions are destroyed when they\n'
         '                   are suspended, so this is mostly reached by a request that\n'
         '                   was already in flight, or by a token minted before the\n'
         '                   change. */\n'
         '                const restricted: Record<string, string> = {\n'
         '                    SUSPENDED: "Your account has been suspended. Ask your administrator to reactivate it.",\n'
         '                    PENDING: "Your account is waiting to be activated. Accept your invitation or ask your administrator.",\n'
         '                };\n'
         '                return res.status(403).json({\n'
         '                    message: restricted[String(user?.status ?? "")] || "Your account is currently restricted and cannot perform this action.",\n'
         '                });\n'
         '            }'),
    ],
}
MARKERS = {
    "src/app.ts": "personStateRoute",
    "src/interfaces/IUser.ts": '"SUSPENDED"',
    "src/models/User.ts": "'SUSPENDED'",
    "src/middlewares/AuthMiddleware.ts": "Your account has been suspended",
}

failed = False
for rel, edits in EDITS.items():
    path = os.path.join(ROOT, rel)
    with io.open(path, encoding="utf-8") as handle:
        text = handle.read()
    if MARKERS[rel] in text:
        print("already applied: %s" % rel)
        continue
    bad = [(old, text.count(old)) for old, _new in edits if text.count(old) != 1]
    if bad:
        failed = True
        for old, count in bad:
            print("%s: anchor found %d time(s), expected 1 - file left alone" % (rel, count))
        continue
    for old, new in edits:
        text = text.replace(old, new)
    with io.open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    print("patched %s" % rel)
raise SystemExit(1 if failed else 0)
