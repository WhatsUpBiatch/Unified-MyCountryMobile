/* /api/invite - invite links for new people. See controllers/InviteController.ts. */

import express from "express";
import { catchErrors } from "../helpers/responseHelper";
import InviteController from "../controllers/InviteController";
import auth from "@/middlewares/AuthMiddleware";
import { RequireAdminRole } from "@/middlewares/RoleGuard";
import { RateLimit } from "@/middlewares/RateLimit";

const inviteRoute = express.Router();
const invite = new InviteController();

/* Public: the person holds the link, the link is the secret. Same per-IP
   limiter as /login and /forgot-password. */
inviteRoute.post("/inspect", RateLimit, catchErrors(invite.inspect));
inviteRoute.post("/accept", RateLimit, catchErrors(invite.accept));

/* Administrators only (same guard as add-member), own company only. */
inviteRoute.post("/resend", auth, RequireAdminRole, catchErrors(invite.resend));
inviteRoute.post("/pending", auth, RequireAdminRole, catchErrors(invite.pending));

export default inviteRoute;
