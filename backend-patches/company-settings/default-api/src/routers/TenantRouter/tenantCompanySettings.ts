import express from "express";
import { catchErrors } from "../../helpers/responseHelper";
import auth from "@/middlewares/AuthMiddleware";
import TenantCompanySettingsController from "@/controllers/Tenant/TenantCompanySettingsController";
const tenantCompanySettingsRoute = express.Router();

const { list, get, save, history, policy } = new TenantCompanySettingsController();
tenantCompanySettingsRoute.post("/user/company-settings/list", auth, catchErrors(list));
tenantCompanySettingsRoute.post("/user/company-settings/get", auth, catchErrors(get));
tenantCompanySettingsRoute.post("/user/company-settings/save", auth, catchErrors(save));
tenantCompanySettingsRoute.post("/user/company-settings/history", auth, catchErrors(history));
tenantCompanySettingsRoute.post("/user/company-settings/policy", auth, catchErrors(policy));

export default tenantCompanySettingsRoute;
