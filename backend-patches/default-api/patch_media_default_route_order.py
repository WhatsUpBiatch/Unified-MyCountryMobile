"""Let the stock-recording route be reached at all.

Applied to the COMPILED dist/routers/mediaRoute.js on api2.

The bug
-------
Two routes overlap, and Express matches in registration order:

    GET /:uuid/:type/:file_name        <- registered first
    GET /default/:type/:file_name      <- registered later, never reached

`/api/media/default/recording/mcm-default-welcome.mp3` has three segments, so
it matches the FIRST pattern with `uuid = "default"`. That handler
(`getMediaFile`) then compares the caller's `company_uuid` against the `:uuid`
in the path - a real and correct authorisation check, protecting one company's
recordings from another's - and the literal string "default" is nobody's
company, so it refuses:

    403 {"success":false,"error":{"message":"That file does not belong to your company."}}

which is exactly the 82-byte body nginx was logging. The stock recordings
could therefore never be played by anyone, on any screen, while a company's
OWN recordings played fine - the symptom that made this look like a storage or
CORS problem when it was neither. Every other endpoint was unaffected, which
is why only this one path 403'd.

The fix is registration order: the specific literal path is registered before
the greedy three-segment one. Nothing about the ownership check changes, and
`/default/...` never carried a company id to check in the first place.

Keep this in mind when adding media routes: any new literal prefix
(`/shared/...`, `/system/...`) has to go above `/:uuid/:type/:file_name` or it
will be swallowed the same way.
"""

import io
import sys

TARGET_DEFAULT = "/var/www/prod/default-api/dist/routers/mediaRoute.js"

DEFAULT_ROUTE = (
    'mediaRoute.get("/default/:type/:file_name", AuthMiddleware_1.default, '
    '(0, responseHelper_1.catchErrors)(getDefaultMediaFile));'
)

GREEDY_ROUTE_START = 'mediaRoute.get("/:uuid/:type/:file_name", AuthMiddleware_1.default,'

BANNER = (
    "/* Registered BEFORE /:uuid/:type/:file_name on purpose: that pattern is\n"
    "   greedy enough to match /default/recording/x.mp3 with uuid=\"default\",\n"
    "   and its company-ownership check then refuses the request 403. Any new\n"
    "   literal media path has to go above it for the same reason. */\n"
)


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_DEFAULT
    text = io.open(target, encoding="utf-8").read()

    if BANNER.splitlines()[0] in text:
        raise SystemExit("already applied")

    if text.count(DEFAULT_ROUTE) != 1:
        raise SystemExit("default route not found exactly once")
    if text.count(GREEDY_ROUTE_START) != 1:
        raise SystemExit("greedy route not found exactly once")

    # Lift the default route out of its current position...
    text = text.replace(DEFAULT_ROUTE + "\n", "", 1)
    # ...and put it back immediately above the greedy one.
    text = text.replace(
        GREEDY_ROUTE_START,
        BANNER + DEFAULT_ROUTE + "\n" + GREEDY_ROUTE_START,
        1,
    )

    io.open(target, "w", encoding="utf-8").write(text)
    print("patched %s" % target)


if __name__ == "__main__":
    main()
