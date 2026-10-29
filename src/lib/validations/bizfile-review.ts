import { z } from 'zod';
import { contactResolutionSchema } from '@/lib/validations/contact';
import type { ExtractedBizFileData } from '@/services/bizfile/types';
import { COMPANY_ALIAS_MAX_LENGTH } from '@/lib/company-display-label';
import { BIZFILE_ENTITY_TYPE_OPTIONS, BIZFILE_IDENTIFICATION_TYPE_OPTIONS, BIZFILE_OFFICER_ROLE_OPTIONS, BIZFILE_STATUS_OPTIONS, canonicalizeCompanyStatus, canonicalizeEntityType, canonicalizeIdentificationType, canonicalizeOfficerRole } from '@/services/bizfile/canonical-values';
export { BIZFILE_ENTITY_TYPE_OPTIONS, BIZFILE_IDENTIFICATION_TYPE_OPTIONS, BIZFILE_OFFICER_ROLE_OPTIONS, BIZFILE_STATUS_OPTIONS } from '@/services/bizfile/canonical-values';

export const BIZFILE_REVIEW_SECTIONS = [
  'entity', 'addresses', 'activities', 'capital', 'officers',
  'shareholders', 'auditor', 'compliance', 'charges', 'document',
] as const;

export type BizFileReviewSectionId = typeof BIZFILE_REVIEW_SECTIONS[number];
type ReviewDraftValue<T> = T extends number
  ? number | undefined
  : T extends Array<infer Item>
    ? Array<ReviewDraftValue<Item>>
    : T extends object
      ? { [Key in keyof T]: ReviewDraftValue<T[Key]> }
      : T;

/** Editable extraction data can temporarily hold blank required numeric controls. */
export type BizFileReviewDraft = ReviewDraftValue<ExtractedBizFileData>;
export interface BizFileReviewIssue { path: string; message: string; section: BizFileReviewSectionId }
export interface BizFileReviewValidation {
  isValid: boolean;
  issues: BizFileReviewIssue[];
  issuesBySection: Record<BizFileReviewSectionId, BizFileReviewIssue[]>;
}

function emptyIssuesBySection(): Record<BizFileReviewSectionId, BizFileReviewIssue[]> {
  return BIZFILE_REVIEW_SECTIONS.reduce((sections, section) => {
    sections[section] = [];
    return sections;
  }, {} as Record<BizFileReviewSectionId, BizFileReviewIssue[]>);
}

const requiredString = z.string().trim().min(1, 'Required');
const reviewString = z.string().trim();
const optionalString = z.string().trim().optional();
const nonNegativeNumber = z.number().finite('Must be finite').nonnegative('Must be non-negative');
const percentage = nonNegativeNumber.max(100, 'Must be at most 100');
const isoDate = z.string().trim().superRefine((value, context) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a valid date (YYYY-MM-DD)' });
    return;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a valid calendar date' });
  }
});
const optionalDate = z.preprocess(
  (value) => value == null || (typeof value === 'string' && value.trim() === '') ? undefined : value,
  isoDate.optional(),
);

export const BIZFILE_ENTITY_TYPE_ALIASES = [
  'PRIVATE LIMITED', 'PRIVATE COMPANY LIMITED BY SHARES', 'EXEMPTED PRIVATE LIMITED', 'EXEMPT PRIVATE LIMITED',
  'EXEMPT PRIVATE COMPANY LIMITED BY SHARES', 'EXEMPTED PRIVATE COMPANY LIMITED BY SHARES', 'PUBLIC LIMITED',
  'PUBLIC COMPANY LIMITED BY SHARES', 'SOLE PROPRIETORSHIP', 'LIMITED PARTNERSHIP', 'LLP', 'FOREIGN COMPANY', 'VCC',
] as const;
export const BIZFILE_STATUS_ALIASES = ['LIVE COMPANY', 'STRUCK OFF', 'WINDING UP', 'IN LIQUIDATION', 'IN RECEIVERSHIP'] as const;
export const BIZFILE_OFFICER_ROLE_ALIASES = ['MANAGING DIRECTOR', 'ALTERNATE DIRECTOR', 'NOMINEE DIRECTOR', 'COMPANY SECRETARY', 'CHIEF EXECUTIVE OFFICER', 'CHIEF FINANCIAL OFFICER', 'JUDICIAL MANAGER'] as const;
const accepted = <T extends readonly string[]>(values: T, canonicalizer: (value: unknown) => unknown) => z.preprocess(canonicalizer, z.string().trim().refine((value) => values.includes(value as T[number]), 'Unsupported value'));
const optionalAccepted = <T extends readonly string[]>(values: T, canonicalizer: (value: unknown) => unknown) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : canonicalizer(value),
  z.string().trim().refine((value) => values.includes(value as T[number]), 'Unsupported value').optional(),
);

const addressSchema = z.object({
  block: optionalString,
  streetName: requiredString,
  level: optionalString,
  unit: optionalString,
  buildingName: optionalString,
  postalCode: requiredString,
  country: optionalString,
});

export const bizFileReviewSchema = z.object({
  entityDetails: z.object({
    uen: reviewString,
    name: reviewString,
    displayAlias: z.string().trim().max(COMPANY_ALIAS_MAX_LENGTH).nullable().optional(),
    formerName: optionalString,
    dateOfNameChange: optionalDate,
    formerNames: z.array(z.object({ name: requiredString, effectiveFrom: optionalDate, effectiveTo: optionalDate })).optional(),
    entityType: accepted(BIZFILE_ENTITY_TYPE_OPTIONS, canonicalizeEntityType),
    status: accepted(BIZFILE_STATUS_OPTIONS, canonicalizeCompanyStatus),
    statusDate: optionalDate,
    incorporationDate: optionalDate,
    registrationDate: optionalDate,
  }).superRefine((entity, context) => {
    for (const field of ['uen', 'name', 'entityType', 'status'] as const) {
      if (!entity[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Required' });
    }
  }),
  ssicActivities: z.object({
    primary: z.object({ code: requiredString, description: requiredString }).optional(),
    secondary: z.object({ code: requiredString, description: requiredString }).optional(),
  }).optional(),
  registeredAddress: addressSchema.extend({ effectiveFrom: optionalDate }).optional(),
  mailingAddress: addressSchema.optional(),
  mailingAddressSameAsRegistered: z.boolean().optional(),
  paidUpCapital: z.object({ amount: nonNegativeNumber, currency: requiredString }).optional(),
  issuedCapital: z.object({ amount: nonNegativeNumber, currency: requiredString }).optional(),
  shareCapital: z.array(z.object({
    shareClass: requiredString,
    currency: requiredString,
    numberOfShares: nonNegativeNumber,
    parValue: nonNegativeNumber.optional(),
    totalValue: nonNegativeNumber,
    isPaidUp: z.boolean(),
    isTreasury: z.boolean().optional(),
  })).optional(),
  treasuryShares: z.object({ numberOfShares: nonNegativeNumber, currency: optionalString }).optional(),
  shareholders: z.array(z.object({
    name: reviewString,
    type: z.enum(['INDIVIDUAL', 'CORPORATE']),
    isNominee: z.boolean().optional(),
    identificationType: optionalAccepted(BIZFILE_IDENTIFICATION_TYPE_OPTIONS, canonicalizeIdentificationType),
    identificationNumber: optionalString,
    nationality: optionalString,
    placeOfOrigin: optionalString,
    address: optionalString,
    shareClass: reviewString,
    numberOfShares: nonNegativeNumber,
    percentageHeld: percentage.optional(),
    currency: optionalString,
    contactResolution: contactResolutionSchema.optional(),
  }).superRefine((shareholder, context) => {
    for (const field of ['name', 'shareClass'] as const) {
      if (!shareholder[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Required' });
    }
  })).optional(),
  officers: z.array(z.object({
    name: requiredString,
    role: accepted(BIZFILE_OFFICER_ROLE_OPTIONS, canonicalizeOfficerRole),
    identificationType: optionalAccepted(BIZFILE_IDENTIFICATION_TYPE_OPTIONS, canonicalizeIdentificationType),
    identificationNumber: optionalString,
    nationality: optionalString,
    address: optionalString,
    appointmentDate: optionalDate,
    cessationDate: optionalDate,
    contactResolution: contactResolutionSchema.optional(),
  })).optional(),
  auditor: z.object({ name: requiredString, address: optionalString, appointmentDate: optionalDate }).optional(),
  financialYear: z.object({
    endDay: z.number().finite().int().min(1).max(31),
    endMonth: z.number().finite().int().min(1).max(12),
  }).superRefine(({ endDay, endMonth }, context) => {
    if (endDay > new Date(Date.UTC(2000, endMonth, 0)).getUTCDate()) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDay'], message: 'Must be a valid day for the selected month' });
  }).optional(),
  homeCurrency: optionalString,
  compliance: z.object({
    lastAgmDate: optionalDate,
    lastArFiledDate: optionalDate,
    accountsDueDate: optionalDate,
    fyeAsAtLastAr: optionalDate,
  }).optional(),
  charges: z.array(z.object({
    chargeNumber: optionalString,
    chargeType: optionalString,
    description: optionalString,
    chargeHolderName: requiredString,
    amountSecured: nonNegativeNumber.optional(),
    amountSecuredText: optionalString,
    currency: optionalString,
    registrationDate: optionalDate,
    dischargeDate: optionalDate,
  })).optional(),
  documentMetadata: z.object({ receiptNo: optionalString, receiptDate: optionalDate }).optional(),
});

const sectionForPath: Record<string, BizFileReviewSectionId> = {
  entityDetails: 'entity', registeredAddress: 'addresses', mailingAddress: 'addresses',
  ssicActivities: 'activities', paidUpCapital: 'capital', issuedCapital: 'capital',
  shareCapital: 'capital', treasuryShares: 'capital', homeCurrency: 'capital',
  officers: 'officers', shareholders: 'shareholders', auditor: 'auditor',
  financialYear: 'compliance', compliance: 'compliance', charges: 'charges',
  documentMetadata: 'document',
};

export function issuesFromZodError(error: z.ZodError): BizFileReviewValidation {
  const issuesBySection = emptyIssuesBySection();
  const issues = error.issues.map((issue) => {
    const path = issue.path.join('.');
    const section = sectionForPath[String(issue.path[0])] ?? 'entity';
    const mapped = { path, message: issue.message, section };
    issuesBySection[section].push(mapped);
    return mapped;
  });
  return { isValid: false, issues, issuesBySection };
}

function isBlank(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return value !== null && typeof value === 'object' && Object.values(value).every(isBlank);
}

function normalize(value: unknown, root = false): unknown {
  if (value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (Array.isArray(value)) return value.length === 0 && !root ? undefined : value.map((item) => normalize(item, true));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = normalize(child);
      if (normalized !== undefined) result[key] = normalized;
    }
    return !root && isBlank(result) ? undefined : result;
  }
  return value;
}

export function normalizeBizFileReviewDraft(draft: BizFileReviewDraft): ExtractedBizFileData {
  const normalized = normalize(draft, true) as ExtractedBizFileData;
  normalized.entityDetails = normalize(draft.entityDetails, true) as ExtractedBizFileData['entityDetails'];
  // Keep an explicitly edited blank alias distinguishable from an omitted field.
  // The sync layer uses omission to preserve existing aliases and blank/null to clear them.
  if (draft.entityDetails.displayAlias === undefined) {
    delete normalized.entityDetails.displayAlias;
  } else {
    normalized.entityDetails.displayAlias = draft.entityDetails.displayAlias == null
      ? null
      : draft.entityDetails.displayAlias.trim();
  }
  normalized.entityDetails.entityType = canonicalizeEntityType(normalized.entityDetails.entityType) as string;
  normalized.entityDetails.status = canonicalizeCompanyStatus(normalized.entityDetails.status) as string;
  normalized.officers?.forEach((officer) => { officer.role = canonicalizeOfficerRole(officer.role) as string; if (officer.identificationType) officer.identificationType = canonicalizeIdentificationType(officer.identificationType) as string; });
  normalized.shareholders?.forEach((shareholder) => { if (shareholder.identificationType) shareholder.identificationType = canonicalizeIdentificationType(shareholder.identificationType) as string; });
  normalized.mailingAddressSameAsRegistered = draft.mailingAddressSameAsRegistered ?? !normalized.mailingAddress;
  if (normalized.mailingAddressSameAsRegistered && normalized.registeredAddress) {
    const { effectiveFrom: _effectiveFrom, ...mailingAddress } = normalized.registeredAddress;
    normalized.mailingAddress = mailingAddress;
  }
  return normalized;
}

export function createEmptyBizFileReviewDraft(): BizFileReviewDraft {
  return { entityDetails: { uen: '', name: '', entityType: '', status: '' } };
}

export function validateBizFileReview(draft: BizFileReviewDraft): BizFileReviewValidation {
  const result = bizFileReviewSchema.safeParse(normalizeBizFileReviewDraft(draft));
  if (!result.success) return issuesFromZodError(result.error);
  const issuesBySection = emptyIssuesBySection();
  return { isValid: true, issues: [], issuesBySection };
}
