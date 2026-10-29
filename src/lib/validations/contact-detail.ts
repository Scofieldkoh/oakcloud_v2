import { z } from 'zod';
import { AUTOMATION_PURPOSES } from '@/lib/constants/automation-purposes';

// Contact detail types enum
export const contactDetailTypeEnum = z.enum(['EMAIL', 'PHONE', 'WEBSITE', 'OTHER']);
export type ContactDetailTypeEnum = z.infer<typeof contactDetailTypeEnum>;

// Available purposes for automation - derived from centralized constant
// To add/remove purposes, update AUTOMATION_PURPOSES in @/lib/constants/automation-purposes.ts
const purposeValues = AUTOMATION_PURPOSES.map(p => p.value) as [string, ...string[]];
export const contactPurposes = purposeValues;
export type ContactPurpose = typeof purposeValues[number];
export const contactPurposeEnum = z.enum(purposeValues);

// Email validation
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Phone validation (basic format allowing international)
const phoneRegex = /^[+]?[\d\s\-().]{6,20}$/;

// Website validation
const websiteRegex = /^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)$/;

// Validate value based on detail type
const validateValueForType = (value: string, type: ContactDetailTypeEnum): boolean => {
  switch (type) {
    case 'EMAIL':
      return emailRegex.test(value);
    case 'PHONE':
      return phoneRegex.test(value);
    case 'WEBSITE':
      return websiteRegex.test(value);
    case 'OTHER':
      return value.length > 0 && value.length <= 500;
    default:
      return true;
  }
};

// Create contact detail schema
export const createContactDetailSchema = z.object({
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  detailType: contactDetailTypeEnum,
  value: z.string().min(1, 'Value is required').max(500, 'Value too long'),
  label: z.string().max(100, 'Label too long').optional(),
  purposes: z.array(contactPurposeEnum).optional().default([]),
  description: z.string().max(500, 'Description too long').optional(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
  isPrimary: z.boolean().optional(),
  isPoc: z.boolean().optional(),
}).refine(
  (data) => data.contactId || data.companyId,
  { message: 'Must provide either contactId or companyId' }
).refine(
  (data) => validateValueForType(data.value, data.detailType),
  { message: 'Invalid value format for the selected type', path: ['value'] }
);

export type CreateContactDetailInput = z.infer<typeof createContactDetailSchema>;

// Update contact detail schema
export const updateContactDetailSchema = z.object({
  id: z.string().uuid(),
  detailType: contactDetailTypeEnum.optional(),
  value: z.string().min(1, 'Value is required').max(500, 'Value too long').optional(),
  label: z.string().max(100, 'Label too long').optional().nullable(),
  purposes: z.array(contactPurposeEnum).optional(),
  description: z.string().max(500, 'Description too long').optional().nullable(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
  isPrimary: z.boolean().optional(),
  isPoc: z.boolean().optional(),
});

export type UpdateContactDetailInput = z.infer<typeof updateContactDetailSchema>;

// Create contact with details schema (for creating a new contact linked to company)
export const createContactWithDetailsSchema = z.object({
  companyId: z.string().uuid(),
  relationship: z.string().min(1, 'Relationship is required').max(100),
  contact: z.object({
    contactType: z.enum(['INDIVIDUAL', 'CORPORATE']),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    corporateName: z.string().max(200).optional(),
    corporateUen: z.string().max(20).optional(),
    identificationType: z.enum(['NRIC', 'FIN', 'PASSPORT', 'UEN', 'OTHER']).optional(),
    identificationNumber: z.string().max(50).optional(),
    nationality: z.string().max(50).optional(),
    email: z.string().email().optional(),
    phone: z.string().regex(phoneRegex, 'Invalid phone number').optional(),
    fullAddress: z.string().max(500).optional(),
  }),
  contactDetails: z.array(z.object({
    detailType: contactDetailTypeEnum,
    value: z.string().min(1).max(500),
    label: z.string().max(100).optional(),
    purposes: z.array(contactPurposeEnum).optional().default([]),
    description: z.string().max(500).optional(),
    isPrimary: z.boolean().optional(),
  })).optional(),
});

export type CreateContactWithDetailsInput = z.infer<typeof createContactWithDetailsSchema>;

// Export companies contact details schema
export const exportContactDetailsSchema = z.object({
  companyIds: z.array(z.string().uuid()).min(1, 'At least one company must be selected').max(1000, 'Maximum 1000 companies allowed'),
});

export type ExportContactDetailsInput = z.infer<typeof exportContactDetailsSchema>;
