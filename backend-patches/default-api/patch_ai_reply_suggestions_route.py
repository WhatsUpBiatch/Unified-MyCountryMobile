"""Expose POST /api/ai/conversation/suggest-replies.

Applied to the COMPILED dist/routers/aiRoute.js on api2, alongside the new
dist/services/AiReplySuggestionsService.js. Third in the set, after
patch_ai_writing_route.py and patch_ai_conversation_route.py - anchors on
the conversation service require, so those must be applied first.

Auth: the same AuthMiddleware every other /api/ai route uses. The company
comes from the session, never the request body - it decides whose AI budget
the call spends.
"""

import io
import sys

TARGET_DEFAULT = "/var/www/prod/default-api/dist/routers/aiRoute.js"

ANCHOR = 'const AiConversationService_1 = require("../services/AiConversationService");'

SERVICE_REQUIRE = (
    'const AiConversationService_1 = require("../services/AiConversationService");\n'
    'const AiReplySuggestionsService_1 = require("../services/AiReplySuggestionsService");\n'
)

ROUTE = '''
/* Suggests replies someone could send next, from the messages already loaded
   in their open chat. Returns candidate strings and nothing else: the server
   never sends a message, so choosing one - or ignoring all of them - stays
   entirely the caller's decision. Nothing is stored. */
aiRoute.post("/conversation/suggest-replies", AuthMiddleware_1.default, (0, responseHelper_1.catchErrors)(async (req, res) => {
    const auth = req.auth || {};
    const companyUuid = String(auth.company_uuid || "").trim();
    const websiteUuid = String(auth.website_uuid || "").trim();
    try {
        const result = await AiReplySuggestionsService_1.suggestReplies({
            companyUuid,
            websiteUuid,
            messages: req.body?.messages,
            /* Present while someone is mid-sentence: suggestions then finish
               what they started rather than replacing it. */
            draft: req.body?.draft,
        });
        return res.status(200).json({
            success: true,
            data: { message: "Success", result },
        });
    } catch (error) {
        return res.status(422).json({
            success: false,
            message: error?.message || "Reply suggestions could not be generated.",
            error: { code: "AI_REPLY_SUGGESTIONS_FAILED" },
        });
    }
}));
'''


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_DEFAULT
    text = io.open(target, encoding="utf-8").read()

    if "AiReplySuggestionsService" in text:
        raise SystemExit("already applied - AiReplySuggestionsService is referenced")

    if text.count(ANCHOR) != 1:
        raise SystemExit(
            "anchor matched %d times, expected 1 - is patch_ai_conversation_route.py applied first?"
            % text.count(ANCHOR)
        )
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
