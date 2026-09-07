import express from "express";
import { catchErrors } from "../helpers/responseHelper";
import ProfileSelfController from "../controllers/ProfileSelfController";
import auth from "../middlewares/AuthMiddleware";

const { self, updateSelf } = new ProfileSelfController();

const profileSelfRoute = express.Router();

profileSelfRoute.post("/self", auth, catchErrors(self));

profileSelfRoute.post("/update-self", auth, catchErrors(updateSelf));

export default profileSelfRoute;
