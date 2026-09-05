/* Your own trusted devices and the two-step sign-in status.
 *
 *   POST /api/security/devices/list
 *   POST /api/security/devices/revoke      { id }
 *   POST /api/security/devices/revoke-all
 *
 * Own rows only. The user and email come from the session (req.auth), never
 * from the body, so there is no way to list or revoke somebody else's devices
 * through here; an administrator ending another person's session is a
 * different act and lives on the People screens.
 *
 * Why this is separate from /api/user/device-securities: that endpoint lists
 * sessions. A trusted device is a different thing (see trustedDeviceLogic.ts)
 * and revoking one has to reach the `otp` rows the login path reads, which
 * the session endpoints never touch. */

import { Response } from "express";
import BaseController from "./BaseController";
import { sendSuccess } from "../helpers/responseHelper";
import { IAuth, IRequest } from "../interfaces/IRequest";
import { describeTwoStep, parseRevokeId } from "../services/trustedDeviceLogic";
import {
    listTrustedDevices,
    revokeAllDevices,
    revokeDevice,
    revokeSession,
    trustDays,
} from "../services/TrustedDeviceService";

export default class TrustedDeviceController extends BaseController {
    public async list(req: IRequest, res: Response) {
        const { uuid, email, current_device_uuid } = req.auth as IAuth;
        const devices = await listTrustedDevices({
            userUuid: uuid,
            email,
            currentSessionUuid: current_device_uuid ?? null,
        });
        return sendSuccess(res, "Success", {
            two_step: describeTwoStep(trustDays(), email),
            current_session_uuid: current_device_uuid ?? null,
            devices,
        });
    }

    public async revoke(req: IRequest, res: Response) {
        const { uuid, email, current_device_uuid } = req.auth as IAuth;
        const target = parseRevokeId(req.body?.id);
        if (target.kind === "invalid") {
            return super.sendError(res, target.reason, null, 422);
        }
        const result =
            target.kind === "device"
                ? await revokeDevice({
                      userUuid: uuid,
                      email,
                      deviceId: target.deviceId,
                      currentSessionUuid: current_device_uuid ?? null,
                  })
                : await revokeSession({
                      userUuid: uuid,
                      sessionUuid: target.sessionUuid,
                      currentSessionUuid: current_device_uuid ?? null,
                  });
        const message =
            result.trust_removed || result.sessions_ended
                ? "That device will be asked for a code next time."
                : "Nothing to revoke for that device.";
        return sendSuccess(res, message, { id: String(req.body?.id), ...result });
    }

    public async revokeAll(req: IRequest, res: Response) {
        const { uuid, email, current_device_uuid } = req.auth as IAuth;
        const result = await revokeAllDevices({
            userUuid: uuid,
            email,
            currentSessionUuid: current_device_uuid ?? null,
        });
        return sendSuccess(res, "Every other device is signed out and will be asked for a code next time.", result);
    }
}
