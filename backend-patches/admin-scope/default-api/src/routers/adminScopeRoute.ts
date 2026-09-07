import express from "express";
import { catchErrors } from "../helpers/responseHelper";
import auth from "../middlewares/AuthMiddleware";
import { RequireAdminRole } from "@/middlewares/RoleGuard";
import AdminScopeController from "@/controllers/AdminScopeController";

/* Mounted at /api/person (app.ts), beside personStateRoute. Setting a scope is
   an administrator's action (RequireAdminRole); the finer rules - only the
   owner or an account admin, never yourself, never the owner, only the owner
   for an account admin - run inside the service. Reading the list needs a
   login only: it is what the People list shows beside each role. */
const adminScopeRoute = express.Router();
const Main = new AdminScopeController();

adminScopeRoute.post("/scope/:uuid", auth, RequireAdminRole, catchErrors(Main.set));
adminScopeRoute.post("/scope", auth, catchErrors(Main.list));

export default adminScopeRoute;
