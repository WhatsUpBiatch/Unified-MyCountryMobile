import Country from "@/models/Country";
import Joi from "joi";

export const signupUser = Joi.object({
    plan_uuid: Joi.string().required(),
    licenses: Joi.number().required(),
    plan_duration: Joi.number().valid(1, 12).required(),
    first_name: Joi.string().required().min(3).max(20),
    last_name: Joi.string().required().min(1).max(20),
    phone: Joi.string().required().max(15),
    email: Joi.string().email().empty().required().max(60).trim(true).messages({
        "string.base": "Email should be a type of text.",
        "string.email": "Please enter valid email address.",
        "string.empty": "Email cannot be an empty field.",
        "any.required": "Email is a required field.",
    }),
    company_name: Joi.string().required().max(60),
    company_address: Joi.string().required().max(100),
    company_suite: Joi.string(),
    company_city: Joi.string().required().max(35),
    company_state: Joi.string().required().max(35),
    company_country: Joi.string().required().max(35),
    company_postal_code: Joi.string().required().max(35),
    timezone: Joi.string().trim().max(100).allow(null, "").optional(),
    tax_calculation_id: Joi.string().required().max(35),
    is_trial: Joi.string().required(),
    is_direct: Joi.string().optional(),
    device_id: Joi.string().trim().allow(null, "").optional(),
    otp: Joi.string().trim().allow(null, "").optional(),
    website_uuid: Joi.string().trim().allow(null, "").optional(),
    payment: Joi.object().allow(null, ""),

});
export const signupCompanyAdmin = Joi.object({
    plan_uuid: Joi.string().required(),
    licenses: Joi.number().required(),
    plan_duration: Joi.number().valid(1, 12).required(),
    first_name: Joi.string().required().min(3).max(20),
    last_name: Joi.string().required().min(1).max(20),
    phone: Joi.string().required().max(15),
    email: Joi.string().email().empty().required().max(60).trim(true).messages({
        "string.base": "Email should be a type of text.",
        "string.email": "Please enter valid email address.",
        "string.empty": "Email cannot be an empty field.",
        "any.required": "Email is a required field.",
    }),
    company_name: Joi.string().required().max(60),
    company_address: Joi.string().required().max(100),
    company_suite: Joi.string(),
    company_city: Joi.string().required().max(35),
    company_state: Joi.string().required().max(35),
    company_country: Joi.string().required().max(35),
    company_postal_code: Joi.string().required().max(35),
    timezone: Joi.string().trim().max(100).allow(null, "").optional(),
    is_trial: Joi.string().required(),
    is_direct: Joi.string().required().insensitive().valid('Y', 'N'),
    tax_calculation_id: Joi.alternatives().conditional('is_direct', {
        is: Joi.string().valid('N', 'n'),
        then: Joi.string().required().max(35),
        otherwise: Joi.string().allow(null, "").optional().max(35),
    }),
    payment: Joi.object().allow(null, ""),

});
export const loginUser = Joi.object({
    email: Joi.string().email().empty().required().max(60).trim(true).messages({
        "string.base": "Email should be a type of text.",
        "string.email": "Please enter valid email address.",
        "string.empty": "Email cannot be an empty field.",
        "any.required": "Email is a required field.",
    }),
    password: Joi.string().required(),
    phone: Joi.string(),
}).xor("email", "phone");

export const createUserValidatorAdmin = Joi.object({
    first_name: Joi.string().required().min(3).max(20),
    last_name: Joi.string().required().min(1).max(20),
    phone: Joi.string().required().max(15),
    email: Joi.string().email().empty().required().max(60).trim(true).messages({
        "string.base": "Email should be a type of text.",
        "string.email": "Please enter valid email address.",
        "string.empty": "Email cannot be an empty field.",
        "any.required": "Email is a required field.",
    }),
    extension: Joi.number().required().min(1000).max(9999),
    role: Joi.string().required(),
    role_uuid: Joi.string().allow(null, ""),
    custom_role_uuid: Joi.string().allow(null, ""),
    site_uuid: Joi.string().allow(null, ""),
    country: Joi.string().allow(null, ""),
    did: Joi.string().allow(null, ""),
    /* Optional since the platform admin's add-member sends an invite link
       (controllers/Admin/UserController.ts): no password means the person
       chooses their own through the link. A typed one still works as before. */
    password: Joi.string().min(6).max(30).allow(null, ""),
});
export const createUserValidator = Joi.object({
    first_name: Joi.string().required().min(3).max(20),
    last_name: Joi.string().required().min(1).max(20),
    phone: Joi.string().required().max(15),
    email: Joi.string().email().empty().required().max(60).trim(true).messages({
        "string.base": "Email should be a type of text.",
        "string.email": "Please enter valid email address.",
        "string.empty": "Email cannot be an empty field.",
        "any.required": "Email is a required field.",
    }),
    extension: Joi.number().required().min(1000).max(9999),
    role: Joi.string().required(),
    role_uuid: Joi.string().allow(null, ""),
    custom_role_uuid: Joi.string().allow(null, ""),
    site_uuid: Joi.string().allow(null, ""),
    password: Joi.string().required().min(6).max(30),
});

export const registerUser = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().empty().required().max(60).trim(true).messages({
        "string.base": "Email should be a type of text.",
        "string.email": "Please enter valid email address.",
        "string.empty": "Email cannot be an empty field.",
        "any.required": "Email is a required field.",
    }),
    phone: Joi.string().required(),
    country: Joi.string().required(),
});

export const validateUser = Joi.object({
    type: Joi.string()
        .valid('extension', 'phone', 'email')
        .required()
        .messages({
            'any.required': 'Type is required',
            'any.only': 'Type must be one of: extension, phone, or email',
            'string.base': 'Type must be a string'
        }),

    value: Joi.alternatives()
        .conditional('type', [
            {
                is: 'email',
                then: Joi.string()
                    .email()
                    .required()
                    .messages({
                        'any.required': 'Email is required when type is email',
                        'string.email': 'Value must be a valid email address',
                        'string.empty': 'Email cannot be empty',
                        'string.base': 'Email must be a string'
                    }),
            },
            {
                is: Joi.valid('phone', 'extension'),
                then: Joi.string()
                    .required()
                    .messages({
                        'any.required': 'Phone or extension value is required',
                        'string.empty': 'Phone or extension cannot be empty',
                        'string.base': 'Phone or extension must be a string'
                    }),
            },
        ])
});

export const velidateNotificationSettings = Joi.object({
    voicemail: Joi.object(),
    missed: Joi.object(),
    sms: Joi.object(),
    forgot_password: Joi.object()
});

export const updateLowBalanceSettings = Joi.object({
    enabled: Joi.boolean().required().messages({
        "boolean.base": "Enabled must be a boolean value",
        "any.required": "Enabled is required",
    }),
    on_amount: Joi.string()
        .trim()
        .pattern(/^\d+(\.\d{1,2})?$/)
        .required()
        .messages({
            "string.base": "On amount must be a string",
            "string.empty": "On amount can not be empty",
            "string.pattern.base": "On amount must be a valid amount",
            "any.required": "On amount is required",
        }),
}).unknown(false);


export const rateDetailValidation = Joi.object({
    dialprefix: Joi.string().required().messages({
        "string.base": "dialprefix should be of type string",
        "string.empty": "dialprefix can not be empty",
        "any.required": "dialprefix is required",
    })
});

export const rateV2Validation = Joi.object({
    filter: Joi.object({
        key: Joi.string()
            .valid("DIALPREFIX", "COUNTRY")
            .required()
            .messages({
                "string.base": "key should be of type string",
                "any.only": "key must be either 'DIALPREFIX' or 'COUNTRY'",
                "any.required": "key is required",
            }),
        value: Joi.string()
            .required()
            .messages({
                "string.base": "value should be of type string",
                "string.empty": "value can not be empty",
                "any.required": "value is required",
            }),
    }).required(),
});

export const updateCallerId = Joi.object({
    caller_id: Joi.string().required().messages({
        "string.base": "Caller ID should be of type string",
        "string.empty": "Caller ID can not be empty",
        "any.required": "Caller ID is required",
    })
});

export const assignDidToUserValidator = Joi.object({
    user_uuid: Joi.string().required().messages({
        "string.base": "User UUID should be of type string",
        "string.empty": "User UUID can not be empty",
        "any.required": "User UUID is required",
    }),
    did_number: Joi.string().required().messages({
        "string.base": "DID Number should be of type string",
        "string.empty": "DID Number can not be empty",
        "any.required": "DID Number is required",
    }),
});

export const assignBulkRoleByRoleId = Joi.object({
    role_uuid: Joi.string().trim().required().messages({
        "string.base": "Role UUID should be a type of text.",
        "string.empty": "Role UUID cannot be an empty field.",
        "any.required": "Role UUID is a required field.",
    }),
    users: Joi.array().items(
        Joi.string().trim().required().messages({
            "string.base": "User UUID should be a type of text.",
            "string.empty": "User UUID cannot be empty.",
        })
    ).min(1).required().messages({
        "array.base": "Users must be an array.",
        "array.min": "Users must contain at least one user.",
        "any.required": "Users is a required field.",
    }),
});
