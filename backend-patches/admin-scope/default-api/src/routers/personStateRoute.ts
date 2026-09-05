import express from "express";
import { catchErrors } from "../helpers/responseHelper";
import auth from "../middlewares/AuthMiddleware";
import { RequireAdminRole } from "@/middlewares/RoleGuard";
import { IRequest } from "@/interfaces/IRequest";
import PersonStateController from "@/controllers/PersonStateController";
import { RequireInScope } from "@/middlewares/PermissionGuard";

/* Mounted at /api/person (app.ts). Suspend and reactivate carry the same
   route-level gate as delete / list-deleted / restore; the per-target rules
   (never yourself, never the owner) run inside the service. Neither has a
   tree key (there is no "suspend" box), so only the scope question is asked:
   is that person inside the caller's admin scope? */
const personStateRoute = express.Router();
const Main = new PersonStateController();

const SCOPE_TARGET = (req: IRequest) => req.params?.uuid;
personStateRoute.post("/suspend/:uuid", auth, RequireAdminRole, RequireInScope("person.suspend", SCOPE_TARGET), catchErrors(Main.suspend));
personStateRoute.post("/reactivate/:uuid", auth, RequireAdminRole, RequireInScope("person.reactivate", SCOPE_TARGET), catchErrors(Main.reactivate));
personStateRoute.post("/state/:uuid", auth, catchErrors(Main.state));
personStateRoute.post("/state", auth, catchErrors(Main.states));

export default personStateRoute;
