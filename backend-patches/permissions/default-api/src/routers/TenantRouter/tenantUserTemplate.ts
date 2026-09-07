import express from "express";
import { catchErrors } from "../../helpers/responseHelper";
import auth from "@/middlewares/AuthMiddleware";
import TenantUserTemplateController from "@/controllers/Tenant/TenantUserTemplateController";
import { RequireAdminRole } from "@/middlewares/RoleGuard";
import { RequirePermission } from "@/middlewares/PermissionGuard";
const tenantUserTemplateRoute = express.Router();

const { list, upsert, remove, info } = new TenantUserTemplateController();
tenantUserTemplateRoute.post("/user/template/list", auth, catchErrors(list));
/* The company template (the "Company Default" rule, admin scopes, default
   role) is written by administrators only (helpers/roleGuard.ts), and only
   by a role whose tree ticks the phone-system edit box: the company pages
   that write this template sit behind phone_system_action on the website. */
const PHONE_SYSTEM_EDIT = "phone_system_action.action.edit";
tenantUserTemplateRoute.post("/user/template/upsert/:uuid?", auth, RequireAdminRole, RequirePermission(PHONE_SYSTEM_EDIT), catchErrors(upsert));
tenantUserTemplateRoute.delete("/user/template/delete/:uuid", auth, RequireAdminRole, RequirePermission(PHONE_SYSTEM_EDIT), catchErrors(remove));
tenantUserTemplateRoute.get("/user/template/info/:uuid", auth, catchErrors(info));


export default tenantUserTemplateRoute;
