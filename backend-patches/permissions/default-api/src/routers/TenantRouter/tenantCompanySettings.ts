import express from "express";
import { catchErrors } from "../../helpers/responseHelper";
import auth from "@/middlewares/AuthMiddleware";
import TenantCompanySettingsController from "@/controllers/Tenant/TenantCompanySettingsController";
import { RequirePermission } from "@/middlewares/PermissionGuard";
const tenantCompanySettingsRoute = express.Router();

const { list, get, save, history, policy } = new TenantCompanySettingsController();
tenantCompanySettingsRoute.post("/user/company-settings/list", auth, catchErrors(list));
tenantCompanySettingsRoute.post("/user/company-settings/get", auth, catchErrors(get));
/* Saving a company section needs the phone-system edit box in the caller's
   role tree (tenant-api separately refuses a non-admin role string). */
tenantCompanySettingsRoute.post(
    "/user/company-settings/save",
    auth,
    RequirePermission("phone_system_action.action.edit"),
    catchErrors(save),
);
tenantCompanySettingsRoute.post("/user/company-settings/history", auth, catchErrors(history));
tenantCompanySettingsRoute.post("/user/company-settings/policy", auth, catchErrors(policy));

export default tenantCompanySettingsRoute;
