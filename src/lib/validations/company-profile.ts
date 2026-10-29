import { z } from 'zod';
import type { CompanyProfileSectionId } from '@/lib/company-profile-sections';
import { optionalDateOnlySchema } from '@/lib/validations/date-only';
import {
  BIZFILE_ENTITY_TYPE_OPTIONS,
  BIZFILE_IDENTIFICATION_TYPE_OPTIONS,
  BIZFILE_OFFICER_ROLE_OPTIONS,
  BIZFILE_STATUS_OPTIONS,
} from '@/services/bizfile/canonical-values';
import { COMPANY_ALIAS_MAX_LENGTH } from '@/lib/company-display-label';

const optionalText = z.string().trim().nullable().optional();
const optionalDate = optionalDateOnlySchema;
const requiredText = z.string().trim().min(1);
const address = z.object({
  block: optionalText,
  streetName: requiredText,
  level: optionalText,
  unit: optionalText,
  buildingName: optionalText,
  postalCode: requiredText,
  country: requiredText,
  effectiveFrom: optionalDate,
});
const identityRecord = z.object({
  contactId: z.string().uuid().nullable().optional(),
  identificationType: z.enum(BIZFILE_IDENTIFICATION_TYPE_OPTIONS).nullable().optional(),
  identificationNumber: optionalText,
  nationality: optionalText,
  address: optionalText,
});

export const identitySectionSchema = z.object({
  uen: requiredText,
  name: requiredText,
  displayAlias: z.string().trim().max(COMPANY_ALIAS_MAX_LENGTH).nullable().optional(),
  entityType: z.enum(BIZFILE_ENTITY_TYPE_OPTIONS),
  status: z.enum(BIZFILE_STATUS_OPTIONS),
  statusDate: optionalDate,
  incorporationDate: optionalDate,
});
export const addressesSectionSchema = z.object({
  registered: address.nullable(),
  mailing: address.omit({ effectiveFrom: true }).nullable(),
});
export const activitiesSectionSchema = z.object({
  primary: z.object({ code: requiredText, description: requiredText }).nullable(),
  secondary: z.object({ code: requiredText, description: requiredText }).nullable(),
});
export const officersSectionSchema = z.object({
  officers: z.array(identityRecord.extend({
    id: z.string().optional(),
    name: requiredText,
    role: z.enum(BIZFILE_OFFICER_ROLE_OPTIONS),
    appointmentDate: optionalDate,
    cessationDate: optionalDate,
    isCurrent: z.boolean().optional(),
  })),
});
export const shareholdersSectionSchema = z.object({
  shareholders: z.array(identityRecord.extend({
    id: z.string().optional(),
    name: requiredText,
    shareholderType: z.enum(['INDIVIDUAL', 'CORPORATE']),
    isNominee: z.boolean().optional(),
    placeOfOrigin: optionalText,
    shareClass: requiredText,
    numberOfShares: z.number().int().nonnegative(),
    percentageHeld: z.number().min(0).max(100).nullable().optional(),
    currency: requiredText,
    isCurrent: z.boolean().optional(),
  })),
});
export const complianceSectionSchema = z.object({
  financialYearEndDay: z.number().int().min(1).max(31).nullable(),
  financialYearEndMonth: z.number().int().min(1).max(12).nullable(),
  fyeAsAtLastAr: optionalDate,
  homeCurrency: optionalText,
  lastAgmDate: optionalDate,
  lastArFiledDate: optionalDate,
  accountsDueDate: optionalDate,
  /**
   * First financial year end after incorporation. The first period runs from
   * incorporation to this date and its YA is the following year. Omitted by
   * BizFile sync, which leaves the stored period alone.
   */
  firstFinancialYearEndDate: optionalDate,
});
export const capitalSectionSchema = z.object({
  paidUpCapitalCurrency: optionalText,
  paidUpCapitalAmount: z.number().nonnegative().nullable(),
  issuedCapitalCurrency: optionalText,
  issuedCapitalAmount: z.number().nonnegative().nullable(),
  shareCapital: z.array(z.object({
    id: z.string().optional(),
    shareClass: requiredText,
    currency: requiredText,
    numberOfShares: z.number().int().nonnegative(),
    parValue: z.number().nonnegative().nullable().optional(),
    totalValue: z.number().nonnegative(),
    isPaidUp: z.boolean(),
    isTreasury: z.boolean(),
  })),
});
export const chargesSectionSchema = z.object({
  charges: z.array(z.object({
    id: z.string().optional(),
    chargeNumber: optionalText,
    chargeType: optionalText,
    description: optionalText,
    chargeHolderName: requiredText,
    amountSecured: z.number().nonnegative().nullable().optional(),
    amountSecuredText: optionalText,
    currency: optionalText,
    registrationDate: optionalDate,
    dischargeDate: optionalDate,
    isFullyDischarged: z.boolean().optional(),
  })),
});
export const additionalSectionSchema = z.object({
  formerName: optionalText,
  dateOfNameChange: optionalDate,
  registrationDate: optionalDate,
  formerNames: z.array(z.object({
    id: z.string().optional(),
    formerName: requiredText,
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: optionalDate,
  })),
  auditor: z.object({
    name: requiredText,
    address: optionalText,
    appointmentDate: optionalDate,
  }).nullable(),
});

/**
 * Profile fields that hold numbers. The section editor shows them as number
 * inputs even while blank (null), so a typed value is sent as a number.
 */
export const COMPANY_PROFILE_NUMBER_FIELDS: ReadonlySet<string> = new Set([
  'financialYearEndDay',
  'financialYearEndMonth',
  'paidUpCapitalAmount',
  'issuedCapitalAmount',
  'numberOfShares',
  'percentageHeld',
  'parValue',
  'totalValue',
  'amountSecured',
]);

export const companyProfileSectionSchemas = {
  identity: identitySectionSchema,
  addresses: addressesSectionSchema,
  activities: activitiesSectionSchema,
  officers: officersSectionSchema,
  shareholders: shareholdersSectionSchema,
  compliance: complianceSectionSchema,
  capital: capitalSectionSchema,
  charges: chargesSectionSchema,
  additional: additionalSectionSchema,
} satisfies Record<CompanyProfileSectionId, z.ZodTypeAny>;

export const sectionMutationEnvelopeSchema = z.object({
  ifMatchVersion: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).optional(),
  data: z.unknown(),
});

export type CompanyProfileSectionData = z.infer<(typeof companyProfileSectionSchemas)[CompanyProfileSectionId]>;