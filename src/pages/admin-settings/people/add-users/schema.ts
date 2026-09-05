import {
  requiredAllString,
  requiredEmail,
  requiredExtension,
  requiredString,
} from '@/schema/common';
import * as yup from 'yup';

export const schemaValidationForAddUser = yup.object().shape({
  users: yup
    .array()
    .of(
      yup.object().shape({
        first_name: requiredString('First name', 3, 50),
        last_name: requiredString('Last name', 3, 50),
        email: requiredEmail(),
        role: yup
          .object({
            label: requiredString('Role'),
            value: requiredString('Role'),
          })
          .required('Role is required'),
        extension: requiredExtension(),
        phone: requiredAllString('Phone')
          .min(9, 'Invalid Number Format')
          .max(15, 'Invalid Number Format'),
      }),
    )
    .min(1, 'Add at least one person'),
  site: yup
    .object({
      label: requiredString('Location'),
      value: requiredString('Location'),
    })
    .required('Location is required'),
});

export const passwordValidationSchema = yup.object().shape({
  password: yup
    .string()
    .required('Password is required')
    .min(8, 'Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])/, 'Password must contain at least one lowercase letter')
    .matches(/^(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
    .matches(/^(?=.*\d)/, 'Password must contain at least one number')
    .matches(/^(?=.*[@$!%*?&])/, 'Password must contain at least one special character')
    .matches(/^\S*$/, 'Password must not contain spaces'),
  confirm_password: yup
    .string()
    .required('Confirm password is required')
    .oneOf([yup.ref('password')], 'Passwords must match'),
});

export const schemaValidationForAddIndividualPassword = yup.object().shape({
  users: yup
    .array()
    .of(
      yup.object().shape({
        password: yup
          .string()
          .required('Password is required')
          .min(8, 'Password must be at least 8 characters long')
          .matches(/^(?=.*[a-z])/, 'Password must contain at least one lowercase letter')
          .matches(/^(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
          .matches(/^(?=.*\d)/, 'Password must contain at least one number')
          .matches(/^(?=.*[@$!%*?&])/, 'Password must contain at least one special character')
          .matches(/^\S*$/, 'Password must not contain spaces'),
        confirm_password: yup
          .string()
          .required('Confirm password is required')
          .oneOf([yup.ref('password')], 'Passwords must match'),
      }),
    )
    .min(1, 'Add at least one person'),
});
