import express from "express";
import { catchErrors } from "../helpers/responseHelper";
import CompanySelfController from "../controllers/CompanySelfController";
import auth from "../middlewares/AuthMiddleware";
import { RequireAdminRole } from "../middlewares/RoleGuard";

/* Both routes: a signed-in session, then an administrator's role. Reading is
   admin-only too, because the row carries the registered address that
   ordinary users have no screen for. */
const { self, updateSelf } = new CompanySelfController();

const companySelfRoute = express.Router();

companySelfRoute.post("/self", auth, RequireAdminRole, catchErrors(self));

companySelfRoute.post("/self/update", auth, RequireAdminRole, catchErrors(updateSelf));

export default companySelfRoute;
