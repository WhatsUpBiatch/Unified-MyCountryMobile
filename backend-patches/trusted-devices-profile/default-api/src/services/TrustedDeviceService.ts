/* Database side of trusted devices. The decisions are in trustedDeviceLogic.ts;
   this file only fetches and deletes rows, always scoped to the one signed-in
   person. Nothing here can touch another user's rows: every query carries the
   caller's user_uuid or email from req.auth, never from the body. */

import { Op } from "sequelize";
import DeviceSecurity from "@/models/DeviceSecurityModel";
import Otp from "@/models/Otp";
import {
    SessionRow,
    TrustRow,
    TrustedDeviceEntry,
    emailVariants,
    mergeDevices,
    readTrustDays,
} from "./trustedDeviceLogic";

export const trustDays = (): number => readTrustDays(process.env.TRUSTED_DEVICE_DAYS, 30);

const otpSequelize = (): any => (Otp as any).sequelize;

/* The Otp model declares no created_at (timestamps: false) although the table
   has one, and sendOtp already reads it with raw SQL - the same is done here
   so the two agree on what "trusted" means. */
const verifiedDevicesFor = async (email: string, days: number): Promise<TrustRow[]> => {
    const emails = emailVariants(email);
    if (!emails.length) return [];
    const placeholders = emails.map(() => "?").join(", ");
    const [rows]: any = await otpSequelize().query(
        `select device_id, max(created_at) as verified_at
           from otp
          where otp_receiver in (${placeholders})
            and verified = 1
            and created_at >= (now() - interval ? day)
          group by device_id`,
        { replacements: [...emails, days] },
    );
    return (rows || []).map((r: any) => ({ device_id: r.device_id, verified_at: r.verified_at }));
};

const sessionsFor = async (userUuid: string): Promise<SessionRow[]> => {
    const rows = await DeviceSecurity.findAll({
        where: { user_uuid: userUuid },
        attributes: ["uuid", "device_id", "device_type", "ip_address", "user_agent", "version", "created_at", "updated_at"],
        order: [["updated_at", "DESC"]],
        raw: true,
    });
    return rows as unknown as SessionRow[];
};

export const listTrustedDevices = async (input: {
    userUuid: string;
    email: string;
    currentSessionUuid?: string | null;
}): Promise<TrustedDeviceEntry[]> => {
    const days = trustDays();
    const [sessions, trust] = await Promise.all([sessionsFor(input.userUuid), verifiedDevicesFor(input.email, days)]);
    return mergeDevices(sessions, trust, { trustDays: days, currentSessionUuid: input.currentSessionUuid });
};

/* Forget the trust for one device id. Both readers of "is this device
   trusted" - sendOtp's window query and login's verified-row lookup - read
   `otp` rows for this email + device_id, so deleting those rows is what makes
   the next sign-in ask for a code again. */
const forgetTrust = async (email: string, deviceId?: string): Promise<number> => {
    const emails = emailVariants(email);
    if (!emails.length) return 0;
    return Otp.destroy({
        where: {
            otp_receiver: { [Op.in]: emails },
            ...(deviceId ? { device_id: deviceId } : {}),
        },
    });
};

export interface RevokeResult {
    trust_removed: number;
    sessions_ended: number;
}

export const revokeDevice = async (input: {
    userUuid: string;
    email: string;
    deviceId: string;
    currentSessionUuid?: string | null;
}): Promise<RevokeResult> => {
    const trust_removed = await forgetTrust(input.email, input.deviceId);
    /* The current session stays signed in: the person is using it to press the
       button. Its trust is gone all the same, so the next sign-in from it asks
       for a code. */
    const sessions_ended = await DeviceSecurity.destroy({
        where: {
            user_uuid: input.userUuid,
            device_id: input.deviceId,
            ...(input.currentSessionUuid ? { uuid: { [Op.ne]: input.currentSessionUuid } } : {}),
        },
    });
    return { trust_removed, sessions_ended };
};

/* An old session row with no device id: nothing in `otp` can point at it, so
   ending the session is all there is to do. */
export const revokeSession = async (input: {
    userUuid: string;
    sessionUuid: string;
    currentSessionUuid?: string | null;
}): Promise<RevokeResult> => {
    if (input.currentSessionUuid && input.sessionUuid === input.currentSessionUuid) {
        return { trust_removed: 0, sessions_ended: 0 };
    }
    const sessions_ended = await DeviceSecurity.destroy({
        where: { user_uuid: input.userUuid, uuid: input.sessionUuid },
    });
    return { trust_removed: 0, sessions_ended };
};

export const revokeAllDevices = async (input: {
    userUuid: string;
    email: string;
    currentSessionUuid?: string | null;
}): Promise<RevokeResult> => {
    const trust_removed = await forgetTrust(input.email);
    const sessions_ended = await DeviceSecurity.destroy({
        where: {
            user_uuid: input.userUuid,
            ...(input.currentSessionUuid ? { uuid: { [Op.ne]: input.currentSessionUuid } } : {}),
        },
    });
    return { trust_removed, sessions_ended };
};
