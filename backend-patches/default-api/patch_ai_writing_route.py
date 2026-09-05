"""Expose POST /api/ai/message/rewrite for AI Writing in the message composer.

Applied to the COMPILED dist/routers/aiRoute.js on api2, alongside the new
dist/services/AiWritingService.js.

The handler is written inline here rather than added to AIController because
AIController is a very large file that other work is actively editing; a small
self-contained route is far less likely to collide, and the logic it needs
already lives in the service.

Auth: the same AuthMiddleware every other /api/ai route uses, so the caller's
company is taken from the session rather than the request body. That matters -
the company decides which brand's LLM key is used, and letting the browser name
it would let one tenant spend another tenant's AI budget.
"""

import io
import sys

TARGET_DEFAULT = "/var/www/prod/default-api/dist/routers/aiRoute.js"

ANCHOR = "const aiRoute = express_1.default.Router();"

SERVICE_REQUIRE = (
    'const aiRoute = express_1.default.Router();\n'
    'const AiWritingService_1 = require("../services/AiWritingService");\n'
    'const database_1 = require("../config/database");\n'
)

ROUTE = '''
/* AI Writing - rewrite a draft message. Suggestion only: this returns text and
   never sends anything. See services/AiWritingService.js for why it calls the
   brand's own configured model rather than anything new. */
aiRoute.post("/message/rewrite", AuthMiddleware_1.default, (0, responseHelper_1.catchErrors)(async (req, res) => {
    /* req.auth, NOT req.user - AuthMiddleware attaches the signed-in user as
       `req.auth` (it merges the user row with its company row). Reading
       req.user gave undefined, and getAiDetails then rejected the call with
       "Either company_uuid or website_uuid is required." */
    const auth = req.auth || {};
    const companyUuid = String(auth.company_uuid || "").trim();
    const websiteUuid = String(auth.website_uuid || "").trim();
    try {
        const result = await AiWritingService_1.rewriteDraft({
            companyUuid,
            websiteUuid,
            text: req.body?.text,
            mode: req.body?.mode,
            instruction: req.body?.instruction,
        });
        return res.status(200).json({
            success: true,
            data: { message: "Success", result },
        });
    } catch (error) {
        /* The service throws messages that are already safe to show someone -
           "there is nothing to rewrite yet", "that message is too long". 422
           rather than 500 because every one of them is about the request. */
        return res.status(422).json({
            success: false,
            message: error?.message || "The rewrite could not be generated.",
            error: { code: "AI_REWRITE_FAILED" },
        });
    }
}));

/* Records a thumbs up/down on a rewrite.
 *
 * DELIBERATELY STORES NO MESSAGE TEXT - only which preset was used and whether
 * it was liked. The screen says "Rate this suggestion", and a rating that went
 * nowhere would make that a lie; but keeping the draft would turn a feedback
 * table into a store of customers' private messages, which is a far worse
 * trade than losing some analytical detail.
 *
 * Always answers 200. A rating is not worth failing a request over, and the
 * person has already moved on by the time it lands. */
aiRoute.post("/message/rewrite/feedback", AuthMiddleware_1.default, (0, responseHelper_1.catchErrors)(async (req, res) => {
    const auth = req.auth || {};
    const rating = String(req.body?.rating || "").trim().toLowerCase();
    const mode = String(req.body?.mode || "").trim().toLowerCase().slice(0, 20);
    if (rating === "up" || rating === "down") {
        try {
            await database_1.sequelize.query(
                "INSERT INTO ai_writing_feedback (company_uuid, user_uuid, mode, rating) VALUES (?, ?, ?, ?)",
                { replacements: [
                    String(auth.company_uuid || "") || null,
                    String(auth.uuid || "") || null,
                    mode || "unknown",
                    rating,
                ] },
            );
        } catch (error) {
            console.error("[AiWriting] feedback insert failed:", error?.message);
        }
    }
    return res.status(200).json({ success: true, data: { message: "Success" } });
}));
'''


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_DEFAULT
    text = io.open(target, encoding="utf-8").read()

    if "AiWritingService" in text:
        raise SystemExit("already applied - AiWritingService is referenced")

    if text.count(ANCHOR) != 1:
        raise SystemExit("router anchor matched %d times, expected 1" % text.count(ANCHOR))
    text = text.replace(ANCHOR, SERVICE_REQUIRE)

    marker = "exports.default = aiRoute;"
    if marker not in text:
        marker = "exports.default ="
    at = text.rindex(marker)
    text = text[:at] + ROUTE + "\n" + text[at:]

    io.open(target, "w", encoding="utf-8").write(text)
    print("patched %s" % target)


if __name__ == "__main__":
    main()
