import BaseController from "../BaseController";
import { IQuery } from "@/interfaces/IQuery";
import { IRequestAdmin } from "@/interfaces/IRequest";
import { IRequestBody } from "@/interfaces/Admin/IRequestBody";
import Role from "@/models/Role";
import { paginate } from "@/utils/paginate";
import { Response } from "express";
import { Op, UniqueConstraintError } from "sequelize";
import { UserCreationAttributes } from "@/interfaces/IUser";
import { hash, genSalt } from "bcryptjs";
import User from "@/models/User";
import Company from "@/models/Company";
import CommonHelper from "@/helpers/CommonHelper";
import { createUserValidatorAdmin } from "@/validators/UserValidator";
import { randomTemporaryPassword } from "@/helpers/inviteToken";
import UserInviteService from "@/services/UserInviteService";
import DIDNumber from "@/models/DIDNumber";


export default class UserController extends BaseController {
    constructor() {
        super();
        this.roleList = this.roleList.bind(this);
        this.addMember = this.addMember.bind(this);
        this.assignDidNumberToUser = this.assignDidNumberToUser.bind(this);

    }

    public async addMember(req: IRequestAdmin, res: Response) {
        try {
            const { company_uuid } = req.params as IRequestBody;
            if (!company_uuid) {
                return super.sendError(res, "Company UUID is required.", 422);
            }

            const { error, value } = createUserValidatorAdmin.validate(req.body);
            if (error) {
                return super.sendError(res, error.details[0].message, 422);
            }

            const { email, first_name, last_name, phone, role, extension, site_uuid } = value;
            const sanitizedPhone = CommonHelper.sanitizePhoneNumber(phone);
            const normalizedEmail = String(email).trim().toLowerCase();

            /* Same rule as the tenant add-member (controllers/UserController.ts):
               the person gets an invite link and chooses their own password
               (services/UserInviteService.ts). No password typed -> the row
               carries a random one nobody ever sees and starts PENDING; login
               refuses anything but ACTIVE, and accepting the link flips it. A
               typed password keeps working as before (row ACTIVE) and that
               person gets the link too. Nothing below e-mails a password. */
            const typedPassword = String(value.password ?? "").trim();
            const inviteOnly = !typedPassword;
            if (!inviteOnly && (await CommonHelper.isBreachedPassword(typedPassword))) {
                return super.sendError(res, "This password has been found in a data breach. Please choose a different password.");
            }

            const salt = await genSalt(10);
            const hashedPassword = await hash(inviteOnly ? randomTemporaryPassword() : typedPassword, salt);
            const emailCheck = await User.findOne({
                where: {
                    [Op.or]: [
                        { email: normalizedEmail }, // Check for the provided email
                        { phone: sanitizedPhone }, // Check for the provided phone
                    ],
                },
                attributes: [
                    "email",
                    "phone",
                    "uuid"
                ],
                paranoid: false,
            });
            if (emailCheck) {
                return super.sendError(res, "Email or phone already exists.");
            }

            const extensionCheck = await User.count({
                where: {
                    extension: value.extension,
                    company_uuid,
                },
                paranoid: false,
            });
            if (extensionCheck > 0) {
                return super.sendError(res, "Extension already exists for this company.");

            }

            let totalUsers = await User.count({ where: { company_uuid } });

            let provisioned = await Company.findOne({
                where: { uuid: company_uuid },
                attributes: [
                    "licenses",
                    "plan_uuid",
                    "amount",
                    "plan_duration",
                    "stripe_token",
                    "plan_expiration_date",
                    "plan_status"
                ],
            });

            let licenses = provisioned?.licenses ?? 1;
            let licenses_remaining = licenses - totalUsers;
            if (licenses_remaining <= 0) {
                return super.sendError(res, "No licenses available for this company.");
            }

            const getRole = await Role.findOne({ where: { name: role ? role : 'ADMIN' }, attributes: ['uuid'] });

            const user = await User.create({
                email: normalizedEmail,
                password: hashedPassword, // store hashed password
                first_name,
                last_name,
                role,
                role_uuid: getRole?.uuid,
                extension,
                site_uuid,
                phone: sanitizedPhone,
                company_uuid,
                status: inviteOnly ? "PENDING" : "ACTIVE",
            });

            /* The invite link instead of a password in e-mail. A mail failure
               does not undo the person: the company's own administrators see
               "Resend invite" on their People list. */
            const admin: any = req.auth ?? {};
            const inviterName =
                `${admin?.first_name ?? ""} ${admin?.last_name ?? ""}`.trim() || String(admin?.name ?? "").trim() || null;
            let inviteSent = false;
            let inviteExpiresAt: Date | null = null;
            try {
                const invite = await UserInviteService.createInvite(user, admin?.uuid ?? null);
                inviteExpiresAt = invite.expiresAt;
                inviteSent = await UserInviteService.sendInviteEmail(user, invite.token, req, inviterName);
            } catch (inviteError: any) {
                console.error(`Admin addMember: invite for ${normalizedEmail} failed:`, inviteError?.message || inviteError);
            }

            /* The row comes back with the bcrypt hash; the browser has no use for it. */
            const created: any = typeof user?.get === "function" ? user.get({ plain: true }) : { ...user };
            delete created.password;

            const days = UserInviteService.TTL_HOURS / 24;
            const message = inviteSent
                ? `User added. We sent them a link to choose a password. It works for ${days} days.`
                : `User added, but the invite e-mail to ${normalizedEmail} could not be sent. A company administrator can use "Resend invite" on the People list.`;

            return super.sendSuccess(res, message, {
                ...created,
                invite: { sent: inviteSent, expires_at: inviteExpiresAt, status: created.status },
            });
        } catch (error: any) {
            if (error instanceof UniqueConstraintError) {
                const uniqueField = error?.errors?.[0]?.path;
                if (uniqueField === "email") {
                    return super.sendError(res, "Email already exists.");
                }
                if (uniqueField === "phone") {
                    return super.sendError(res, "Phone already exists.");
                }
                if (uniqueField === "extension") {
                    return super.sendError(res, "Extension already exists for this company.");
                }
                return super.sendError(res, "Duplicate value violates a unique constraint.");
            }

            console.error("Error in addMember:", error);
            return super.sendError(res, "Something went wrong while adding member.");
        }

    }

    public async roleList(req: IRequestAdmin, res: Response) {
        const { type } = req.params;
        const { search = null, page = 1, limit = 25, filter = [], company_uuid } = req.body as IRequestBody;

        const offset = (page - 1) * limit;
        let where: any = {};
        if (!type) {
            where = {
                uuid: {
                    [Op.ne]: "ADMIN"
                }
            };
        }

        if (Array.isArray(filter) && filter.length) {
            filter.forEach(_value => {
                const { key, value } = _value;
                where[key] = { [Op.like]: `${value}%` }
            });
        }

        if (search) {
            where['name'] = { [Op.like]: `${search}%` };
        };

        const model = await Role.findAndCountAll({
            where: {
                [Op.or]: [
                    {
                        company_uuid: "PREDEFINED"
                    },
                    {
                        company_uuid
                    }
                ],
                ...where
            },
            attributes: {
                exclude: ["id"]
            },
            order: [["created_at", "DESC"]],
            offset,
            limit
        });

        return super.sendSuccess(res, "Success", await paginate(req, model, { limit, page }))
    }

    public async assignDidNumberToUser(req: IRequestAdmin, res: Response) {
        const { user_uuid, did_number } = req.body as any;
        const user = await User.findOne({ where: { uuid: user_uuid } });
        if (!user) {
            return super.sendError(res, "User not found", 404);
        }
        //check did number exist
        const didNumber = await DIDNumber.findOne({ where: { did_number, user_uuid: null } });
        if (!didNumber) {
            return super.sendError(res, "DID number not found", 404);
        }
        await DIDNumber.update({ user_uuid }, { where: { did_number } });
        return super.sendSuccess(res, "DID number assigned successfully", user);
    }

}
