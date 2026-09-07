import express from "express";
import { catchErrors } from "../helpers/responseHelper";
import auth from "../middlewares/AuthMiddleware";
import { RequireAdminRole } from "@/middlewares/RoleGuard";
import PersonStateController from "@/controllers/PersonStateController";

/* Mounted at /api/person (app.ts). Suspend and reactivate carry the same
   route-level gate as delete / list-deleted / restore; the per-target rules
   (never yourself, never the owner) run inside the service. */
const personStateRoute = express.Router();
const Main = new PersonStateController();

personStateRoute.post("/suspend/:uuid", auth, RequireAdminRole, catchErrors(Main.suspend));
personStateRoute.post("/reactivate/:uuid", auth, RequireAdminRole, catchErrors(Main.reactivate));
personStateRoute.post("/state/:uuid", auth, catchErrors(Main.state));
personStateRoute.post("/state", auth, catchErrors(Main.states));

export default personStateRoute;
