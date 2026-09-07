import express from "express";
import { catchErrors } from "../helpers/responseHelper";
import { MediaController } from "@/controllers/Media/MediaController";
import { PrivateCallAuth } from "@/middlewares/PrivateCallAuth";
import auth from "@/middlewares/AuthMiddleware";
import { RequirePermission } from "@/middlewares/PermissionGuard";

const mediaRoute = express.Router();

const {
    getUploadSignedUrl,
    getUploadSignedUrlProsody,
    getMediaFile,
    getDirectMediaFile,
    getDefaultMediaFile,
    deleteFile,
    getBucketSize,
} = new MediaController();

mediaRoute.post("/upload/url", auth, catchErrors(getUploadSignedUrl));
mediaRoute.post("/direct/upload/url", PrivateCallAuth, catchErrors(getUploadSignedUrl));
mediaRoute.post("/upload/url/prosody", PrivateCallAuth, catchErrors(getUploadSignedUrlProsody));
/* Playing a call recording needs the "call recording listen" box in the
   caller's role tree - the same key every call-log page gates the play
   button on. Other media types are not the tree's business. */
mediaRoute.get(
    "/:uuid/:type/:file_name",
    auth,
    RequirePermission("reports.action.call_recording_listen", {
        when: (req) => String(req.params?.type ?? "").trim().toLowerCase() === "recording",
    }),
    catchErrors(getMediaFile),
);
// Media served with NO login at all. This route exists so an outside party can
// fetch a file, and only two kinds of file genuinely need that:
//   fax             - the URL is handed to the fax carrier, which has no token
//   video_recording - meeting links are opened by people with no account here
// Every other type used to be fetchable by anyone who knew a company uuid and a
// file name, call recordings included. Those now need a signed-in caller and the
// authenticated route above.
const DIRECT_PUBLIC_TYPES = new Set(["fax", "video_recording"]);

const directTypeGuard = (request: any, response: any, next: any) => {
    const type = String(request?.params?.type ?? "");
    if (DIRECT_PUBLIC_TYPES.has(type)) {
        return next();
    }
    return response.status(401).json({
        success: false,
        error: { message: "Authentication required", service: "MEDIA" },
    });
};

mediaRoute.get("/direct/:uuid/:type/:file_name", directTypeGuard, catchErrors(getDirectMediaFile));
mediaRoute.get("/default/:type/:file_name", auth, catchErrors(getDefaultMediaFile));
mediaRoute.delete("/delete", auth, catchErrors(deleteFile));
mediaRoute.post(`/get-bucket-size`, auth, catchErrors(getBucketSize));

// mediaRoute.post("/url", catchErrors(preAssignedUrlWasabi));
// mediaRoute.get("/url/:uuid/:type/:filename", catchErrors(download));

export default mediaRoute;
