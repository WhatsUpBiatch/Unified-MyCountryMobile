import express from "express";
import { catchErrors } from "../helpers/responseHelper";
import TrustedDeviceController from "../controllers/TrustedDeviceController";
import auth from "../middlewares/AuthMiddleware";

const { list, revoke, revokeAll } = new TrustedDeviceController();

const trustedDeviceRoute = express.Router();

trustedDeviceRoute.post("/list", auth, catchErrors(list));

trustedDeviceRoute.post("/revoke", auth, catchErrors(revoke));

trustedDeviceRoute.post("/revoke-all", auth, catchErrors(revokeAll));

export default trustedDeviceRoute;
