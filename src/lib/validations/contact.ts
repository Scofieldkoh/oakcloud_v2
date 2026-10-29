import { z } from 'zod';
import { contactDetailTypeEnum, contactPurposeEnum } from '@/lib/validations/contact-detail';

export const contactTypeEnum = z.enum(['INDIVIDUAL', 'CORPORATE']);

export const identificationTypeEnum = z.enum(['NRIC', 'FIN', 'PASSPORT', 'UEN', 'OTHER']);
const optionalIdentificationTypeSchema = z.preprocess(
  (val) => (val === '' ? null : val),
  identificationTypeEnum.optional().nullable()
);

// Base schema without refinements for partial operations
const contactBaseSchema = z.object({
  contactType: contactTypeEnum.default('INDIVIDUAL'),

  // Individual fields
  firstName: z.string().max(100).optional().nullable(),
  lastName: z.string().max(100).optional().nullable(),
  alias: z.string().max(100).optional().nullable(),
  identificationType: optionalIdentificationTypeSchema,
  identificationNumber: z.string().max(50).optional().nullable(),
  nationality: z.string().max(100).optional().nullable(),
  dateOfBirth: z.preprocess(
    (val) => (val === '' ? null : val),
    z
      .string()
      .datetime()
      .optional()
      .nullable()
      .refine(
        (val) => {
          if (!val) return true;
          const dob = new Date(val);
          const today = new Date();
          // Not in future
          if (dob > today) return false;
          // Not older than 150 years
          const age = today.getFullYear() - dob.getFullYear();
          if (age > 150) return false;
          return true;
        },
        { message: 'Date of birth must be valid and not in the future' }
      )
  ),

  // Corporate fields
  corporateName: z.string().max(200).optional().nullable(),
  corporateUen: z
    .string()
    .max(50)
    .optional()
    .nullable()
    .refine(
      (val) => {
        if (!val) return true;
        // Allow alphanumeric characters, hyphens, and spaces for overseas registration numbers
        return /^[A-Za-z0-9\-\s]+$/.test(val);
      },
      { message: 'UEN / Registration No. must contain only alphanumeric characters, hyphens, or spaces' }
    ),

  // Address
  fullAddress: z.string().max(500).optional().nullable(),
});

export const contactResolutionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('REUSE'),
    contactId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('CREATE_SEPARATE'),
    reason: z.string().trim().min(10, 'Reason must be at least 10 characters'),
  }),
]);

export const createContactSchema = contactBaseSchema.refine(
  (data) => {
    if (data.contactType === 'INDIVIDUAL') {
      return data.firstName || data.lastName;
    }
    return data.corporateName;
  },
  {
    message: 'Individual contacts require a name; Corporate contacts require a corporate name',
  }
);

const createContactDetailOnCreateSchema = z.object({
  detailType: contactDetailTypeEnum,
  value: z.string().trim().min(1, 'Value is required').max(500, 'Value too long'),
  label: z.string().trim().max(100, 'Label too long').optional(),
  purposes: z.array(contactPurposeEnum).optional().default([]),
  description: z.string().trim().max(500, 'Description too long').optional(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
  isPrimary: z.boolean().optional(),
  companyId: z.string().uuid().optional(),
});

export const createContactWithDetailsSchema = contactBaseSchema.extend({
  contactDetails: z.array(createContactDetailOnCreateSchema).optional(),
  resolution: contactResolutionSchema.optional(),
}).refine(
  (data) => {
    if (data.contactType === 'INDIVIDUAL') {
      return data.firstName || data.lastName;
    }
    return data.corporateName;
  },
  {
    message: 'Individual contacts require a name; Corporate contacts require a corporate name',
  }
);

export const updateContactSchema = contactBaseSchema.partial().extend({
  id: z.string().uuid(),
});

export const contactSearchSchema = z.object({
  query: z.string().optional(),
  fullName: z.string().optional(),
  contactType: contactTypeEnum.optional(),
  identificationType: identificationTypeEnum.optional(),
  identificationNumber: z.string().optional(),
  nationality: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  companyId: z.string().uuid().optional(),
  companiesMin: z.number().optional(),
  companiesMax: z.number().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(200).default(20),
  sortBy: z.enum(['fullName', 'contactType', 'nationality', 'companyRelationsCount', 'createdAt', 'updatedAt']).default('fullName'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type CreateContactWithDetailsInput = z.infer<typeof createContactWithDetailsSchema>;
export type ContactResolutionInput = z.infer<typeof contactResolutionSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ContactSearchInput = z.infer<typeof contactSearchSchema>;
