import express from "express";
import { catchErrors } from "../helpers/responseHelper";
import UserController from "../controllers/UserController";
import auth from "../middlewares/AuthMiddleware";
import roleRoute from "./rolesRoute";
const userRoute = express.Router();
import {
    assignBulkRoleByRoleId,
    rateDetailValidation,
    rateV2Validation,
    updateCallerId,
    updateLowBalanceSettings,
    validateUser,
} from "@/validators/UserValidator";
import { validate } from "@/middlewares/validator";
import { PrivateCallAuth } from "@/middlewares/PrivateCallAuth";
import { CompanyPolicyLock } from "@/middlewares/CompanyPolicyLock";
import { RequireAdminRole } from "@/middlewares/RoleGuard";
import { RequirePermission } from "@/middlewares/PermissionGuard";

/* The role's own permission tree (Roles > Add role), read on the server for
   the first time. Keys under account_setting.access.USER.action.* are the
   ones the People page reads. Report mode by default: see
   middlewares/PermissionGuard.ts and PERMISSION_ENFORCE. */
const PEOPLE = "account_setting.access.USER.action";

const Main = new UserController();

/** Zapier Routes **/
userRoute.get("/me", catchErrors(Main.me));
userRoute.get("/send-message", catchErrors(Main.sendMessage));
userRoute.get("/get-virtual-number", catchErrors(Main.getVirtualNumber));
userRoute.post("/contacts", catchErrors(Main.addZapierContact));

userRoute.get("/info", auth, catchErrors(Main.info));
userRoute.post("/info-by-id", PrivateCallAuth, catchErrors(Main.userInfoById));
userRoute.post(
    "/forwarded-assignments",
    auth,
    catchErrors(Main.forwardedAssignments),
);
userRoute.get("/detail/:uuid", auth, catchErrors(Main.getUserDetail));
userRoute.post("/info/via/email", catchErrors(Main.infoViaEmail));
userRoute.post("/list", auth, RequirePermission(`${PEOPLE}.view`), catchErrors(Main.list));
userRoute.post("/list/chat", PrivateCallAuth, catchErrors(Main.listChat));
/* Administrators only (helpers/roleGuard.ts). The handler adds the per-target
   rules: not yourself, not the account owner. */
userRoute.delete("/delete/:uuid", auth, RequireAdminRole, RequirePermission(`${PEOPLE}.delete`), catchErrors(Main.delete));
/* Removed in the last 72 hours, and bringing one back. */
userRoute.post("/list-deleted", auth, RequireAdminRole, catchErrors(Main.listDeleted));
userRoute.post("/restore/:uuid", auth, RequireAdminRole, catchErrors(Main.restore));
userRoute.get("/cards", auth, catchErrors(Main.cardListing));

userRoute.post("/add-member", auth, RequireAdminRole, RequirePermission(`${PEOPLE}.add`), catchErrors(Main.addMember));
userRoute.put(
    "/update-settings/",
    auth,
    catchErrors(Main.upateNotificationSettings),
);
/* No uuid means "myself"; editing yourself never needs the edit box. */
userRoute.post(
    "/update/:uuid?",
    auth,
    RequirePermission(`${PEOPLE}.edit`, { target: (req) => req.params?.uuid || req.auth?.uuid }),
    CompanyPolicyLock,
    catchErrors(Main.update),
);
userRoute.post("/update-auto-recharge-settings", auth, catchErrors(Main.updateAutoRecharge));
userRoute.post("/update-low-balance-settings", auth, validate(updateLowBalanceSettings), catchErrors(Main.updateLowBalanceSettings));

userRoute.post(
    "/assign-role-bulk-users",
    auth,
    RequireAdminRole,
    /* The tree has no "assign role" box; changing a person's role is an edit. */
    RequirePermission(`${PEOPLE}.edit`),
    validate(assignBulkRoleByRoleId),
    catchErrors(Main.assignBulkRoleToUser),
);
userRoute.use("/role", roleRoute);
// userRoute.post("/roles", auth, catchErrors(Main.roles));
userRoute.post(
    "/rates",
    auth,
    validate(rateV2Validation),
    catchErrors(Main.ratesV2),
);
userRoute.post(
    "/rates/detail",
    validate(rateDetailValidation),
    auth,
    catchErrors(Main.rateDetail),
);
userRoute.get("/rates/search", auth, catchErrors(Main.getCountryRateList));

userRoute.get("/temp-user/:uuid", catchErrors(Main.tempUser));
userRoute.post(
    "/validate",
    auth,
    validate(validateUser),
    catchErrors(Main.validateUser),
);
userRoute.post("/update-status", auth, catchErrors(Main.updateUserStatus));
userRoute.post(
    "/update-caller-id",
    validate(updateCallerId),
    auth,
    catchErrors(Main.updateCallerId),
);

userRoute.post("/licenses", auth, catchErrors(Main.companyLicenseList));
userRoute.post("/revoke-license", auth, catchErrors(Main.revokeCompanyLicense));
userRoute.post("/buy-license", auth, catchErrors(Main.buyCompanyLicense));
userRoute.post(
    "/device-securities",
    auth,
    catchErrors(Main.getDeviceSecurities),
);
userRoute.post(
    "/current-plan-detail",
    auth,
    catchErrors(Main.userCurrentPlanDetail),
);
userRoute.post("/sms-info", auth, catchErrors(Main.smsInfo));

export default userRoute;
