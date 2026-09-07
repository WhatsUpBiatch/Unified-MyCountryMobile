"""Expose the AI conversation summary/Q&A routes in the message composer's header.

Applied to the COMPILED dist/routers/aiRoute.js on api2, alongside the new
dist/services/AiConversationService.js. Companion to
patch_ai_writing_route.py - separate script because this feature sends
message CONTENT to the model (a summary has no other way to work), which is
a materially different privacy shape than a one-shot rewrite, and keeping
them as separate patches keeps that distinction auditable.

Auth: the same AuthMiddleware every other /api/ai route uses. The company
comes from the session, never the request body, for the same reason as
AI Writing - it decides whose AI budget the call spends.
"""

import io
import sys

TARGET_DEFAULT = "/var/www/prod/default-api/dist/routers/aiRoute.js"

ANCHOR = 'const AiWritingService_1 = require("../services/AiWritingService");'

SERVICE_REQUIRE = (
    'const AiWritingService_1 = require("../services/AiWritingService");\n'
    'const AiConversationService_1 = require("../services/AiConversationService");\n'
)

ROUTE = '''
/* AI conversation summary - turns the messages already loaded in someone's
   open chat into a short bullet-point recap. Nothing is stored: the
   transcript comes from the request body (what the browser already has) and
   is discarded once the response is sent. */
aiRoute.post("/conversation/summarize", AuthMiddleware_1.default, (0, responseHelper_1.catchErrors)(async (req, res) => {
    const auth = req.auth || {};
    const companyUuid = String(auth.company_uuid || "").trim();
    const websiteUuid = String(auth.website_uuid || "").trim();
    try {
        const result = await AiConversationService_1.summarizeConversation({
            companyUuid,
            websiteUuid,
            messages: req.body?.messages,
        });
        return res.status(200).json({
            success: true,
            data: { message: "Success", result },
        });
    } catch (error) {
        return res.status(422).json({
            success: false,
            message: error?.message || "The summary could not be generated.",
            error: { code: "AI_CONVERSATION_SUMMARY_FAILED" },
        });
    }
}));

/* Answers a question grounded only in the same transcript. Kept as a
   separate call (rather than folded into summarize) so asking a second
   question doesn't require re-summarizing first. */
aiRoute.post("/conversation/ask", AuthMiddleware_1.default, (0, responseHelper_1.catchErrors)(async (req, res) => {
    const auth = req.auth || {};
    const companyUuid = String(auth.company_uuid || "").trim();
    const websiteUuid = String(auth.website_uuid || "").trim();
    try {
        const result = await AiConversationService_1.answerConversationQuestion({
            companyUuid,
            websiteUuid,
            messages: req.body?.messages,
            question: req.body?.question,
        });
        return res.status(200).json({
            success: true,
            data: { message: "Success", result },
        });
    } catch (error) {
        return res.status(422).json({
            success: false,
            message: error?.message || "The answer could not be generated.",
            error: { code: "AI_CONVERSATION_ASK_FAILED" },
        });
    }
}));
'''


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_DEFAULT
    text = io.open(target, encoding="utf-8").read()

    if "AiConversationService" in text:
        raise SystemExit("already applied - AiConversationService is referenced")

    if text.count(ANCHOR) != 1:
        raise SystemExit("anchor matched %d times, expected 1 - is patch_ai_writing_route.py applied first?" % text.count(ANCHOR))
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
