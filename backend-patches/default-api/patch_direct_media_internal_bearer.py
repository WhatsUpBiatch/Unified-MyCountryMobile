"""Let the switch fetch greetings through the direct media route again.

patch_direct_media_auth.py closed /api/media/direct/:uuid/:type/:file_name to
everything except fax and video_recording. Correct for strangers, but it also
locked out fs-configuration-manager - the service that builds every IVR menu -
which downloads each menu's greeting through this exact route with no
credentials. Proved 3 Sep 2026: greeting -> 401, fax (control) -> 404.

Fix: keep the allow-list, and additionally let a caller through when it
presents the internal secret as a bearer token - the same check PrivateCallAuth
performs for /api/internal/call-recording, which the switch already uses.
Nothing is reopened to the public: a caller without the secret still gets 401
for every type but the two public ones.

Run:  python3 patch_direct_media_internal_bearer.py <path-to-dist/routers/mediaRoute.js>
Idempotent: exits 0 saying "already patched" if the bearer check is present.
Asserts a single match, so it either applies cleanly or writes nothing.
"""
import sys

OLD = '''    if (DIRECT_PUBLIC_TYPES.has(type)) {
        return next();
    }
    return response.status(401).json({'''

NEW = '''    if (DIRECT_PUBLIC_TYPES.has(type)) {
        return next();
    }
    // The switch (fs-configuration-manager, the lua scripts) proves who it is
    // with the internal secret as a bearer token - the same check
    // PrivateCallAuth does for the other internal routes. Accept it here so a
    // menu's greeting can still be fetched by the one caller that must fetch it.
    const expectedSecret = String(process.env.PRIVATE_CALL_SECRET || "").trim();
    const parts = String((request && request.headers && request.headers.authorization) || "").trim().split(/\\s+/);
    if (expectedSecret && parts.length === 2 && parts[0].toLowerCase() === "bearer" && parts[1] === expectedSecret) {
        return next();
    }
    return response.status(401).json({'''


def main():
    path = sys.argv[1]
    src = open(path, encoding="utf-8").read()
    if "PRIVATE_CALL_SECRET" in src:
        print("already patched")
        return 0
    n = src.count(OLD)
    if n != 1:
        print(f"expected exactly one match, found {n}; nothing written")
        return 1
    open(path, "w", encoding="utf-8").write(src.replace(OLD, NEW))
    print("patched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
