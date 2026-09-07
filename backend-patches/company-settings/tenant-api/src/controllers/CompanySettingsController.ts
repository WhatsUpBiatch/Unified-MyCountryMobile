/* The company settings endpoints.
 *
 *   POST user/company-settings/list      everyone signed in
 *   POST user/company-settings/get       everyone signed in    { section }
 *   POST user/company-settings/save      ADMIN only            { section, settings, version? }
 *   POST user/company-settings/history   everyone signed in    { section, limit? }
 *   POST user/company-settings/policy    everyone signed in    (the folded rules, for
 *                                                               the user update path)
 *
 * Responses use the same envelope as the rest of this service:
 * `{ success, data: { message, result } }`. A refused save carries the reason in
 * `error.message` and, for a version conflict, the current row in `error.current`.
 *
 * WHO MAY SAVE
 *
 * TenantAuthMiddleware puts the caller's role string on `request.user.roles`, copied
 * from the `X-User-role` header default-api sends. The only role that manages the
 * company is ADMIN; the string comparison is what every other authorisation check in
 * this service does (see DepartmentRepository), so it is what this one does too.
 */

import express, { Response } from "express";
import { BaseController } from "@/controllers/BaseController";
import { ApiErrors } from "@/constants/ApiErrors";
import { GlobalRequest } from "@/globalRequest";
import { ResponseModel } from "./ResponseModel";
import {
    CompanySettingsError,
    CompanySettingsRepository,
} from "@/repositories/CompanySettingsRepository";
import { isValidSectionName } from "@/helpers/companySettingsSections";
import { RULE_FIELDS, readRuleFlags } from "@/helpers/companyRuleFlags";

const isAdmin = (roles: unknown): boolean => String(roles || "").trim().toUpperCase() === "ADMIN";

export class CompanySettingsController extends BaseController {
    private fail(error: any, response: Response): void {
        if (error instanceof CompanySettingsError) {
            response.status(error.status).send(
                new ResponseModel({
                    success: false,
                    error: {
                        message: error.message,
                        current: error.current ?? undefined,
                        ...(error.detail ? { detail: error.detail } : {}),
                    },
                }),
            );
            return;
        }
        if (!super.isNull(error?.status)) {
            super.handleError(error, error, response);
        } else {
            super.handleError(ApiErrors.ServerError, error, response);
        }
    }

    public list = async (request: express.Request, response: Response): Promise<any> => {
        try {
            const globalReq = request as GlobalRequest;
            const result = await CompanySettingsRepository.list(globalReq.tenantDbName);
            return response.status(200).send(
                new ResponseModel({ success: true, data: { message: "Success", result } }),
            );
        } catch (error) {
            this.fail(error, response);
        }
    };

    public get = async (request: express.Request, response: Response): Promise<any> => {
        try {
            const globalReq = request as GlobalRequest;
            const section = request.body?.section;
            if (!isValidSectionName(section)) {
                throw new CompanySettingsError("Invalid section name", 400);
            }
            const row = await CompanySettingsRepository.get(globalReq.tenantDbName, section);
            if (!row) {
                throw new CompanySettingsError(`No settings saved for section "${section}"`, 404);
            }
            return response.status(200).send(
                new ResponseModel({ success: true, data: { message: "Success", result: row } }),
            );
        } catch (error) {
            this.fail(error, response);
        }
    };

    public save = async (request: express.Request, response: Response): Promise<any> => {
        try {
            const globalReq = request as GlobalRequest;
            const user = globalReq.user;

            if (!isAdmin(user?.roles)) {
                throw new CompanySettingsError("Only an admin can change company settings", 403);
            }

            const { section, settings, version } = request.body || {};
            if (!isValidSectionName(section)) {
                throw new CompanySettingsError("Invalid section name", 400);
            }

            /* default-api sends the caller's display name in X-User-name; it is
               "undefined undefined" when the auth record has no names, which is not a
               name worth keeping. */
            const rawName = String(request.headers["x-user-name"] || "").trim();
            const name = rawName && !/undefined/.test(rawName) ? rawName : null;

            const expectedVersion =
                version === undefined || version === null || version === "" ? null : Number(version);

            const row = await CompanySettingsRepository.save(
                globalReq.tenantDbName,
                section,
                settings,
                { uuid: user?.userUuid || null, name },
                expectedVersion,
            );

            return response.status(200).send(
                new ResponseModel({ success: true, data: { message: "Saved", result: row } }),
            );
        } catch (error) {
            this.fail(error, response);
        }
    };

    public history = async (request: express.Request, response: Response): Promise<any> => {
        try {
            const globalReq = request as GlobalRequest;
            const { section, limit } = request.body || {};
            if (!isValidSectionName(section)) {
                throw new CompanySettingsError("Invalid section name", 400);
            }
            const rows = await CompanySettingsRepository.history(globalReq.tenantDbName, section, limit);
            return response.status(200).send(
                new ResponseModel({ success: true, data: { message: "Success", result: { section, rows } } }),
            );
        } catch (error) {
            this.fail(error, response);
        }
    };

    /**
     * The folded company rules plus a per-rule flag summary, so another service
     * can seed or lock a person's settings without reading the tenant database
     * itself. Never fails on a missing record: that is "no rules".
     */
    public policy = async (request: express.Request, response: Response): Promise<any> => {
        try {
            const globalReq = request as GlobalRequest;
            const effective = await CompanySettingsRepository.effective(globalReq.tenantDbName);

            const rules: { [field: string]: { apply: boolean; locked: boolean; isLegacy: boolean } } = {};
            RULE_FIELDS.forEach((field) => {
                rules[field] = effective.source === "none" ? { apply: false, locked: false, isLegacy: false } : readRuleFlags(effective.settings, field);
            });

            return response.status(200).send(
                new ResponseModel({
                    success: true,
                    data: {
                        message: "Success",
                        result: {
                            source: effective.source,
                            settings: effective.settings,
                            greetings: effective.greetings,
                            rules,
                        },
                    },
                }),
            );
        } catch (error) {
            this.fail(error, response);
        }
    };
}
