/**
 * Document Revision Service
 *
 * Handles document revision workflow including creation, approval,
 * and lifecycle management as defined in Oakcloud_Document_Processing_Spec_v3.3.
 */

import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { Prisma } from '@/generated/prisma';
import {
  storage,
  generateApprovedDocumentFilename,
  getFileExtension,
  buildApprovedStorageKey,
} from '@/lib/storage';
import type { DocumentRevision, DocumentRevisionLineItem } from '@/generated/prisma';
import type {
  RevisionType,
  DocumentCategory,
  DocumentSubCategory,
  GstTreatment,
  ExchangeRateSource,
  ValidationStatus,
} from '@/generated/prisma';
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/client';
import { hashBlake3 } from '@/lib/encryption';
import { normalizeVendorName } from '@/lib/vendor-name';
import { jaroWinkler } from '@/lib/string-similarity';
import { getOrCreateVendorContact, learnVendorAlias } from './vendor-resolution.service';
import { getOrCreateCustomerContact, learnCustomerAlias } from './customer-resolution.service';
import { jaccardSimilarity, tokenizeEntityName } from '@/lib/entity-name';
import type { ContactIdentityCandidate } from '@/types/contact-identity';
import { z } from 'zod';
import { createAuditLog } from '@/lib/audit';

type Decimal = Prisma.Decimal;

const log = createLogger('document-revision');

/**
 * Sanitize a value for Decimal conversion
 * Removes thousands separators (commas) and handles parentheses for negative values
 */
function sanitizeDecimalValue(value: Decimal | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  let str = value.toString().trim();

  // Handle parentheses notation for negative values: (123.45) -> -123.45
  if (str.startsWith('(') && str.endsWith(')')) {
    str = '-' + str.slice(1, -1);
  }

  // Remove currency symbols and whitespace
  str = str.replace(/[$â‚¬ £ ¥\s]/g, '');

  // Remove thousands separators (commas)
  str = str.replace(/,/g, '');

  return str || null;
}

/**
 * Create a PrismaDecimal from a value, handling formatting issues
 */
function toDecimal(value: Decimal | number | string | null | undefined): PrismaDecimal | null {
  const sanitized = sanitizeDecimalValue(value);
  if (!sanitized) return null;

  try {
    return new PrismaDecimal(sanitized);
  } catch (error) {
    log.warn(`Failed to parse decimal value: "${value}" -> "${sanitized}"`, error);
    return null;
  }
}

/**
 * Create a PrismaDecimal from a value, with fallback to zero
 */
function toDecimalOrZero(value: Decimal | number | string | null | undefined): PrismaDecimal {
  return toDecimal(value) || new PrismaDecimal(0);
}

// ============================================================================
// Types
// ============================================================================

export interface CreateRevisionInput {
  processingDocumentId: string;
  revisionType: RevisionType;
  basedOnRevisionId?: string;
  extractionId?: string;
  createdById: string;

  // Classification
  documentCategory: DocumentCategory;
  documentSubCategory?: DocumentSubCategory;

  // Header fields
  vendorName?: string;
  vendorId?: string;
  customerName?: string;
  customerId?: string;
  counterpartyIdentity?: CounterpartyIdentityDraft;
  documentNumber?: string;
  documentDate?: Date;
  dueDate?: Date;

  // Amounts
  currency: string;
  subtotal?: Decimal | number | string;
  taxAmount?: Decimal | number | string;
  totalAmount: Decimal | number | string;

  // GST
  gstTreatment?: GstTreatment;
  supplierGstNo?: string;

  // Home currency conversion (extracted from document or calculated)
  homeCurrency?: string;
  homeExchangeRate?: Decimal | number | string;
  homeExchangeRateSource?: ExchangeRateSource;
  homeSubtotal?: Decimal | number | string;
  homeTaxAmount?: Decimal | number | string;
  homeEquivalent?: Decimal | number | string;

  // Evidence
  headerEvidenceJson?: Record<string, unknown>;

  // Line items
  items?: LineItemInput[];

  // Reason
  reason?: string;
}

export interface LineItemInput {
  lineNo: number;
  description: string;
  quantity?: Decimal | number | string;
  unitPrice?: Decimal | number | string;
  amount: Decimal | number | string;
  gstAmount?: Decimal | number | string;
  taxCode?: string;
  accountCode?: string;
  evidenceJson?: Record<string, unknown>;
  // Home currency fields
  homeAmount?: Decimal | number | string;
  homeGstAmount?: Decimal | number | string;
}

export interface RevisionPatchInput {
  set?: {
    vendorName?: string;
    vendorId?: string;
    customerName?: string;
    customerId?: string;
    counterpartyIdentity?: CounterpartyIdentityDraft;
    documentNumber?: string;
    documentDate?: Date;
    dueDate?: Date;
    currency?: string;
    subtotal?: Decimal | number | string;
    taxAmount?: Decimal | number | string;
    totalAmount?: Decimal | number | string;
    gstTreatment?: GstTreatment;
    supplierGstNo?: string;
    documentCategory?: DocumentCategory;
    documentSubCategory?: DocumentSubCategory;
  };
  itemsToUpsert?: LineItemInput[];
  itemsToDelete?: number[];
}

export interface CounterpartyIdentityDraft {
  identificationType?: 'NRIC' | 'FIN' | 'PASSPORT' | 'UEN' | 'OTHER';
  identificationNumber?: string;
  fullAddress?: string;
  email?: string;
  phone?: string;
  confidence: Partial<Record<'identificationNumber' | 'fullAddress' | 'email' | 'phone', number>>;
}

const IDENTIFICATION_TYPES = new Set(['NRIC', 'FIN', 'PASSPORT', 'UEN', 'OTHER']);

export interface CounterpartyIdentityValidationIssue {
  field: 'identificationType' | 'identificationNumber' | 'fullAddress' | 'email' | 'phone';
  message: string;
}

export class CounterpartyIdentityValidationError extends Error {
  constructor(public readonly issues: CounterpartyIdentityValidationIssue[]) {
    super('Invalid counterparty identity');
    this.name = 'CounterpartyIdentityValidationError';
  }
}

const optionalReviewerString = (max: number) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().max(max).optional(),
);

const reviewerCounterpartyIdentitySchema = z.object({
  identificationType: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.enum(['NRIC', 'FIN', 'PASSPORT', 'UEN', 'OTHER']).optional(),
  ),
  identificationNumber: optionalReviewerString(40),
  fullAddress: optionalReviewerString(500),
  email: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().email('Enter a valid email address').max(254).optional(),
  ),
  phone: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().regex(/^\+?[0-9][0-9\s()-]{6,20}$/, 'Enter a valid phone number').optional(),
  ),
  confidence: z.unknown().optional(),
}).superRefine((identity, context) => {
  if (identity.identificationType && !identity.identificationNumber) {
    context.addIssue({ code: 'custom', path: ['identificationNumber'], message: 'Identification number is required for the selected type' });
    return;
  }
  if (!identity.identificationType && identity.identificationNumber) {
    context.addIssue({ code: 'custom', path: ['identificationType'], message: 'Identification type is required when a number is provided' });
    return;
  }
  if (!identity.identificationType || !identity.identificationNumber) return;
  const number = identity.identificationNumber.toUpperCase().replace(/[\s-]/g, '');
  const valid = identity.identificationType === 'NRIC'
    ? /^[ST]\d{7}[A-Z]$/.test(number)
    : identity.identificationType === 'FIN'
      ? /^[FGM]\d{7}[A-Z]$/.test(number)
      : identity.identificationType === 'PASSPORT'
        ? /^[A-Z0-9]{5,20}$/.test(number)
        : identity.identificationType === 'UEN'
          ? /^[A-Z0-9]{8,20}$/.test(number)
          : /^[A-Z0-9][A-Z0-9 .()/+-]{2,39}$/i.test(identity.identificationNumber);
  if (!valid) {
    context.addIssue({ code: 'custom', path: ['identificationNumber'], message: `Enter a valid ${identity.identificationType} number` });
  }
});

export function parseReviewerCounterpartyIdentity(value: unknown): CounterpartyIdentityDraft {
  const parsed = reviewerCounterpartyIdentitySchema.safeParse(value);
  if (!parsed.success) {
    throw new CounterpartyIdentityValidationError(parsed.error.issues.map((issue) => ({
      field: (issue.path[0] ?? 'identificationNumber') as CounterpartyIdentityValidationIssue['field'],
      message: issue.message,
    })));
  }
  const { confidence: _ignoredConfidence, ...identity } = parsed.data;
  return {
    ...identity,
    confidence: {
      ...(identity.identificationNumber ? { identificationNumber: 1 } : {}),
      ...(identity.fullAddress ? { fullAddress: 1 } : {}),
      ...(identity.email ? { email: 1 } : {}),
      ...(identity.phone ? { phone: 1 } : {}),
    },
  };
}

export function normalizeCounterpartyIdentityDraft(value: unknown): CounterpartyIdentityDraft {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const confidenceInput = input.confidence && typeof input.confidence === 'object' && !Array.isArray(input.confidence)
    ? input.confidence as Record<string, unknown>
    : {};
  const clean = (field: string): string | undefined => {
    const raw = input[field];
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  };
  const confidence: CounterpartyIdentityDraft['confidence'] = {};
  for (const field of ['identificationNumber', 'fullAddress', 'email', 'phone'] as const) {
    const raw = confidenceInput[field];
    if (typeof raw === 'number' && Number.isFinite(raw)) confidence[field] = Math.max(0, Math.min(1, raw));
  }
  const rawType = clean('identificationType');
  return {
    ...(rawType && IDENTIFICATION_TYPES.has(rawType) ? { identificationType: rawType as CounterpartyIdentityDraft['identificationType'] } : {}),
    ...(clean('identificationNumber') ? { identificationNumber: clean('identificationNumber') } : {}),
    ...(clean('fullAddress') ? { fullAddress: clean('fullAddress') } : {}),
    ...(clean('email') ? { email: clean('email') } : {}),
    ...(clean('phone') ? { phone: clean('phone') } : {}),
    confidence,
  };
}

export function buildDocumentVaultContactCandidate(
  counterpartyName: string,
  identityValue: unknown,
  revisionId: string,
  companyId?: string,
): ContactIdentityCandidate {
  const identity = normalizeCounterpartyIdentityDraft(identityValue);
  const isUen = identity.identificationType === 'UEN';
  const contactDetails = [
    identity.email ? { detailType: 'EMAIL' as const, value: identity.email, companyId, isPrimary: true } : null,
    identity.phone ? { detailType: 'PHONE' as const, value: identity.phone, companyId, isPrimary: true } : null,
  ].filter((detail): detail is NonNullable<typeof detail> => detail !== null);
  return {
    source: 'DOCUMENT_VAULT',
    sourceRecordId: revisionId,
    contactType: 'CORPORATE',
    corporateName: counterpartyName.trim(),
    identificationType: isUen ? undefined : identity.identificationType,
    identificationNumber: isUen ? undefined : identity.identificationNumber,
    corporateUen: isUen ? identity.identificationNumber : undefined,
    fullAddress: identity.fullAddress,
    contactDetails,
    confidence: {
      ...(isUen
        ? { corporateUen: identity.confidence.identificationNumber }
        : { identificationNumber: identity.confidence.identificationNumber }),
      fullAddress: identity.confidence.fullAddress,
      email: identity.confidence.email,
      phone: identity.confidence.phone,
    },
  };
}

export interface ApproveRevisionInput {
  userId: string;
  homeCurrency?: string;
  exchangeRate?: Decimal | number | string;
  exchangeRateSource?: ExchangeRateSource;
  exchangeRateDate?: Date;
  overrideReason?: string;
  aliasLearning?: {
    vendor?: 'AUTO' | 'FORCE' | 'SKIP';
    customer?: 'AUTO' | 'FORCE' | 'SKIP';
  };
}

export interface RevisionWithItems extends DocumentRevision {
  items: DocumentRevisionLineItem[];
}

export interface ValidationIssue {
  code: string;
  severity: 'WARN' | 'ERROR';
  message: string;
  field?: string;
}

// Validation issue codes from Appendix F
const VALIDATION_CODES = {
  PARTIAL_EXTRACTION: { severity: 'WARN' as const, message: 'Extraction may be incomplete' },
  HEADER_ARITHMETIC_MISMATCH: {
    severity: 'WARN' as const,
    message: 'Header amounts do not compute correctly (subtotal + tax â‰  total)',
  },
  LINE_SUM_MISMATCH: {
    severity: 'WARN' as const,
    message: 'Sum of line items does not match subtotal',
  },
  LINE_GST_SUM_MISMATCH: {
    severity: 'WARN' as const,
    message: 'Sum of line item GST does not match tax amount',
  },
  FUTURE_DATE: { severity: 'WARN' as const, message: 'Document date is in the future' },
  INVALID_CURRENCY: { severity: 'ERROR' as const, message: 'Currency code is invalid' },
  MISSING_VENDOR: { severity: 'WARN' as const, message: 'Vendor name is missing' },
  GST_RATE_MISMATCH: { severity: 'WARN' as const, message: 'GST rate does not match expected' },
  GST_CODE_AMOUNT_MISMATCH: {
    severity: 'WARN' as const,
    message: 'GST code does not match the calculated GST percentage',
  },
  HEADER_HOME_LINE_TOTAL_MISMATCH: {
    severity: 'WARN' as const,
    message: 'Header home total does not match sum of line item home totals (amount + GST)',
  },
  CREDIT_NOTE_TOTAL_NOT_NEGATIVE: {
    severity: 'ERROR' as const,
    message: 'Credit note total must be negative',
  },
  // Phase 2: Home currency validation codes
  HOME_AMOUNT_SUM_MISMATCH: {
    severity: 'WARN' as const,
    message: 'Sum of line item home amounts does not match home subtotal',
  },
  HOME_GST_SUM_MISMATCH: {
    severity: 'WARN' as const,
    message: 'Sum of line item home GST does not match home tax amount',
  },
  HOME_TOTAL_MISMATCH: {
    severity: 'WARN' as const,
    message: 'Home currency total does not match subtotal + tax',
  },
  MISSING_EXCHANGE_RATE: {
    severity: 'WARN' as const,
    message: 'Exchange rate is required when document currency differs from home currency',
  },
  INVALID_EXCHANGE_RATE: {
    severity: 'ERROR' as const,
    message: 'Exchange rate must be a positive number',
  },
};

// ============================================================================
// Create Revision
// ============================================================================

/**
 * Create a new revision from extraction or user edit
 */
export async function createRevision(input: CreateRevisionInput): Promise<RevisionWithItems> {
  const {
    processingDocumentId,
    revisionType,
    basedOnRevisionId,
    extractionId,
    createdById,
    documentCategory,
    documentSubCategory,
    vendorName,
    vendorId,
    customerName,
    customerId,
    counterpartyIdentity,
    documentNumber,
    documentDate,
    dueDate,
    currency,
    subtotal,
    taxAmount,
    totalAmount,
    gstTreatment,
    supplierGstNo,
    // Home currency fields (extracted from document or provided)
    homeCurrency,
    homeExchangeRate,
    homeExchangeRateSource,
    homeSubtotal,
    homeTaxAmount,
    homeEquivalent,
    headerEvidenceJson,
    items = [],
    reason,
  } = input;

  log.info(`Creating revision for document ${processingDocumentId}, type: ${revisionType}`);

  // Get next revision number
  const lastRevision = await prisma.documentRevision.findFirst({
    where: { processingDocumentId },
    orderBy: { revisionNumber: 'desc' },
  });
  const revisionNumber = (lastRevision?.revisionNumber ?? 0) + 1;

  // Generate document key for duplicate detection
  const documentKey = generateDocumentKey({
    vendorName,
    documentNumber,
    documentDate,
    totalAmount,
    currency,
  });

  // Generate search text for full-text search
  const searchText = generateSearchText({
    vendorName,
    documentNumber,
    documentDate,
    totalAmount: totalAmount?.toString(),
    currency,
  });

  // Create revision with items in a transaction
  const revision = await prisma.$transaction(async (tx) => {
    const rev = await tx.documentRevision.create({
      data: {
        processingDocumentId,
        basedOnRevisionId,
        extractionId,
        revisionNumber,
        revisionType,
        status: 'DRAFT',
        reason,
        documentCategory,
        documentSubCategory,
        vendorName,
        vendorId,
        customerName,
        customerId,
        counterpartyIdentity: counterpartyIdentity
          ? normalizeCounterpartyIdentityDraft(counterpartyIdentity) as unknown as Prisma.InputJsonValue
          : undefined,
        documentNumber,
        documentDate,
        dueDate,
        currency,
        subtotal: toDecimal(subtotal),
        taxAmount: toDecimal(taxAmount),
        totalAmount: toDecimalOrZero(totalAmount),
        gstTreatment,
        supplierGstNo,
        // Home currency fields (from document extraction or provided)
        homeCurrency,
        homeExchangeRate: toDecimal(homeExchangeRate),
        homeExchangeRateSource,
        homeSubtotal: toDecimal(homeSubtotal),
        homeTaxAmount: toDecimal(homeTaxAmount),
        homeEquivalent: toDecimal(homeEquivalent),
        headerEvidenceJson: headerEvidenceJson as Prisma.InputJsonValue,
        documentKey,
        documentKeyVersion: '1',
        searchText,
        createdById,
        validationStatus: 'PENDING',
      },
    });

    // Create line items
    if (items.length > 0) {
      await tx.documentRevisionLineItem.createMany({
        data: items.map((item) => ({
          revisionId: rev.id,
          lineNo: item.lineNo,
          description: item.description,
          quantity: toDecimal(item.quantity),
          unitPrice: toDecimal(item.unitPrice),
          amount: toDecimalOrZero(item.amount),
          gstAmount: toDecimal(item.gstAmount),
          taxCode: item.taxCode,
          accountCode: item.accountCode,
          evidenceJson: item.evidenceJson as Prisma.InputJsonValue,
          // Home currency fields
          homeAmount: toDecimal(item.homeAmount),
          homeGstAmount: toDecimal(item.homeGstAmount),
        })),
      });
    }

    return rev;
  });

  // Validate the revision
  await validateRevision(revision.id);

  // Fetch the complete revision with items
  const completeRevision = await getRevision(revision.id);
  if (!completeRevision) {
    throw new Error('Failed to create revision');
  }

  log.info(`Created revision ${revision.id} (rev #${revisionNumber}) for document ${processingDocumentId}`);

  return completeRevision;
}

/**
 * Create a new revision by editing an existing one
 */
export async function createRevisionFromEdit(
  processingDocumentId: string,
  basedOnRevisionId: string,
  patch: RevisionPatchInput,
  createdById: string,
  reason: string = 'user_edit'
): Promise<RevisionWithItems> {
  log.info(`Creating edit revision based on ${basedOnRevisionId}`);

  // Get the base revision with items
  const baseRevision = await getRevision(basedOnRevisionId);
  if (!baseRevision) {
    throw new Error(`Base revision ${basedOnRevisionId} not found`);
  }

  // Apply patches to create new revision data
  const revisionData: CreateRevisionInput = {
    processingDocumentId,
    revisionType: 'USER_EDIT',
    basedOnRevisionId,
    createdById,
    reason,
    documentCategory: patch.set?.documentCategory ?? baseRevision.documentCategory,
    documentSubCategory: patch.set?.documentSubCategory ?? baseRevision.documentSubCategory ?? undefined,
    vendorName: patch.set?.vendorName ?? baseRevision.vendorName ?? undefined,
    vendorId: patch.set?.vendorId ?? baseRevision.vendorId ?? undefined,
    customerName: patch.set?.customerName ?? (baseRevision as unknown as { customerName?: string | null }).customerName ?? undefined,
    customerId: patch.set?.customerId ?? (baseRevision as unknown as { customerId?: string | null }).customerId ?? undefined,
    counterpartyIdentity: patch.set?.counterpartyIdentity
      ?? normalizeCounterpartyIdentityDraft(baseRevision.counterpartyIdentity),
    documentNumber: patch.set?.documentNumber ?? baseRevision.documentNumber ?? undefined,
    documentDate: patch.set?.documentDate ?? baseRevision.documentDate ?? undefined,
    dueDate: patch.set?.dueDate ?? baseRevision.dueDate ?? undefined,
    currency: patch.set?.currency ?? baseRevision.currency,
    subtotal: patch.set?.subtotal ?? baseRevision.subtotal ?? undefined,
    taxAmount: patch.set?.taxAmount ?? baseRevision.taxAmount ?? undefined,
    totalAmount: patch.set?.totalAmount ?? baseRevision.totalAmount,
    gstTreatment: patch.set?.gstTreatment ?? baseRevision.gstTreatment ?? undefined,
    supplierGstNo: patch.set?.supplierGstNo ?? baseRevision.supplierGstNo ?? undefined,
  };

  // Handle line items
  let items = [...baseRevision.items];

  // Delete specified items
  if (patch.itemsToDelete && patch.itemsToDelete.length > 0) {
    items = items.filter((item) => !patch.itemsToDelete!.includes(item.lineNo));
  }

  // Upsert items
  if (patch.itemsToUpsert && patch.itemsToUpsert.length > 0) {
    for (const upsertItem of patch.itemsToUpsert) {
      const existingIndex = items.findIndex((i) => i.lineNo === upsertItem.lineNo);
      if (existingIndex >= 0) {
        // Update existing
        items[existingIndex] = {
          ...items[existingIndex],
          description: upsertItem.description,
          quantity: toDecimal(upsertItem.quantity),
          unitPrice: toDecimal(upsertItem.unitPrice),
          amount: toDecimalOrZero(upsertItem.amount),
          gstAmount: toDecimal(upsertItem.gstAmount),
          taxCode: upsertItem.taxCode ?? null,
          accountCode: upsertItem.accountCode ?? items[existingIndex].accountCode ?? null,
        } as DocumentRevisionLineItem;
      } else {
        // Add new item
        items.push({
          id: '',
          revisionId: '',
          lineNo: upsertItem.lineNo,
          description: upsertItem.description,
          quantity: toDecimal(upsertItem.quantity),
          unitPrice: toDecimal(upsertItem.unitPrice),
          amount: toDecimalOrZero(upsertItem.amount),
          gstAmount: toDecimal(upsertItem.gstAmount),
          taxCode: upsertItem.taxCode ?? null,
          accountCode: upsertItem.accountCode ?? null,
          evidenceJson: upsertItem.evidenceJson as Prisma.JsonValue,
        } as DocumentRevisionLineItem);
      }
    }
  }

  // Renumber items sequentially
  items = items
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((item, index) => ({ ...item, lineNo: index + 1 }));

  revisionData.items = items.map((item) => ({
    lineNo: item.lineNo,
    description: item.description,
    quantity: item.quantity ?? undefined,
    unitPrice: item.unitPrice ?? undefined,
    amount: item.amount,
    gstAmount: item.gstAmount ?? undefined,
    taxCode: item.taxCode ?? undefined,
    accountCode: item.accountCode ?? undefined,
    evidenceJson: item.evidenceJson as Record<string, unknown> | undefined,
  }));

  return createRevision(revisionData);
}

// ============================================================================
// Approve Revision
// ============================================================================

/**
 * Approve a revision
 */
export async function approveRevision(
  revisionId: string,
  input: ApproveRevisionInput
): Promise<RevisionWithItems> {
  const { userId, homeCurrency, exchangeRate, exchangeRateSource, exchangeRateDate, overrideReason } = input;

  log.info(`Approving revision ${revisionId} by user ${userId}`);

  const revision = await getRevision(revisionId);
  if (!revision) {
    throw new Error(`Revision ${revisionId} not found`);
  }

  // Check revision is in DRAFT status
  if (revision.status !== 'DRAFT') {
    throw new Error(`Cannot approve revision in status ${revision.status}`);
  }

  // Check for blocking validation errors
  const validationIssues = revision.validationIssues as { issues?: ValidationIssue[] } | null;
  const errors = validationIssues?.issues?.filter((i) => i.severity === 'ERROR') ?? [];
  if (errors.length > 0 && !overrideReason) {
    throw new Error(`Cannot approve revision with validation errors: ${errors.map((e) => e.code).join(', ')}`);
  }

  // Fetch processing context (tenant/company) for vendor canonicalization + file rename
  const processingDoc = await prisma.processingDocument.findUnique({
    where: { id: revision.processingDocumentId },
    include: {
      document: {
        select: {
          id: true,
          tenantId: true,
          companyId: true,
          fileName: true,
          storageKey: true,
        },
      },
    },
  });

  const tenantId = processingDoc?.document?.tenantId;
  const companyId = processingDoc?.document?.companyId;
  const isReceivable = revision.documentCategory === 'ACCOUNTS_RECEIVABLE';
  const vendorAliasMode = input.aliasLearning?.vendor ?? 'AUTO';
  const customerAliasMode = input.aliasLearning?.customer ?? 'AUTO';
  const counterpartyIdentity = normalizeCounterpartyIdentityDraft(revision.counterpartyIdentity);

  const approval = await prisma.$transaction(async (tx) => {
    // Stabilize counterparty identity and all approval DB writes atomically.
    let approvedVendorName: string | null | undefined = revision.vendorName;
    let approvedVendorId: string | null | undefined = revision.vendorId;
    let approvedCustomerName: string | null | undefined = (revision as unknown as { customerName?: string | null }).customerName;
    let approvedCustomerId: string | null | undefined = (revision as unknown as { customerId?: string | null }).customerId;

  if (revision.vendorName && tenantId && companyId && !isReceivable) {
    try {
      const vendor = await getOrCreateVendorContact({
        tenantId,
        companyId,
        rawVendorName: revision.vendorName,
        createdById: userId,
        counterpartyIdentity,
        sourceRecordId: revision.id,
        tx,
      });

      if (vendor.vendorId && vendor.vendorName) {
        approvedVendorId = vendor.vendorId;
        approvedVendorName = vendor.vendorName;
      }

      if (approvedVendorId && revision.extractionId) {
        const extraction = await tx.documentExtraction.findUnique({
          where: { id: revision.extractionId },
          select: { rawJson: true },
        });

        const rawJson = extraction?.rawJson as unknown as { vendorName?: { value?: string } } | null;
        const extractedVendorName = rawJson?.vendorName?.value?.trim();

        if (extractedVendorName) {
          const tokenSim = jaccardSimilarity(
            tokenizeEntityName(extractedVendorName),
            tokenizeEntityName(approvedVendorName ?? extractedVendorName)
          );
          const confidence =
            tokenSim < 0.8
              ? 0
              : jaroWinkler(
                  normalizeVendorName(extractedVendorName),
                  normalizeVendorName(approvedVendorName ?? extractedVendorName)
                );

          const shouldLearn =
            vendorAliasMode === 'FORCE' ? true : vendorAliasMode === 'SKIP' ? false : confidence >= 0.93;

          // Safety: do not "learn" clearly wrong extractions (e.g., person's name)
          // into vendor aliases just because a user corrected the field (unless explicitly forced).
          if (shouldLearn) {
            await learnVendorAlias({
              tenantId,
              companyId,
              rawName: extractedVendorName,
              vendorId: approvedVendorId,
              confidence: vendorAliasMode === 'FORCE' ? 1.0 : confidence,
              createdById: userId,
              tx,
            });
          }
        }
      }
    } catch (e) {
      log.warn(`Vendor canonicalization failed for revision ${revisionId}`, e);
      throw e;
    }
  }

  // Stabilize customer identity/name on approval for AR documents.
  // Note: for AR we currently store the counterparty in `vendorName` for UI/backward compatibility.
  const rawCustomerName = (revision as unknown as { customerName?: string | null }).customerName ?? revision.vendorName;
  if (rawCustomerName && tenantId && companyId && isReceivable) {
    try {
      const customer = await getOrCreateCustomerContact({
        tenantId,
        companyId,
        rawCustomerName,
        createdById: userId,
        counterpartyIdentity,
        sourceRecordId: revision.id,
        tx,
      });

      if (customer.customerId && customer.customerName) {
        approvedCustomerId = customer.customerId;
        approvedCustomerName = customer.customerName;

        // Keep vendorName aligned for existing UI/duplicate detection.
        approvedVendorName = customer.customerName;
        approvedVendorId = null;
      }

      if (approvedCustomerId && revision.extractionId) {
        const extraction = await tx.documentExtraction.findUnique({
          where: { id: revision.extractionId },
          select: { rawJson: true },
        });

        const rawJson = extraction?.rawJson as unknown as { vendorName?: { value?: string } } | null;
        const extractedCustomerName = rawJson?.vendorName?.value?.trim();

        if (extractedCustomerName) {
          const tokenSim = jaccardSimilarity(
            tokenizeEntityName(extractedCustomerName),
            tokenizeEntityName(approvedCustomerName ?? extractedCustomerName)
          );
          const confidence =
            tokenSim < 0.8
              ? 0
              : jaroWinkler(
                  normalizeVendorName(extractedCustomerName),
                  normalizeVendorName(approvedCustomerName ?? extractedCustomerName)
                );

          const shouldLearn =
            customerAliasMode === 'FORCE' ? true : customerAliasMode === 'SKIP' ? false : confidence >= 0.93;

          if (shouldLearn) {
            await learnCustomerAlias({
              tenantId,
              companyId,
              rawName: extractedCustomerName,
              customerId: approvedCustomerId,
              confidence: customerAliasMode === 'FORCE' ? 1.0 : confidence,
              createdById: userId,
              tx,
            });
          }
        }
      }
    } catch (e) {
      log.warn(`Customer canonicalization failed for revision ${revisionId}`, e);
      throw e;
    }
  }

  // Determine final values - preserve existing revision values if not explicitly overridden
  const finalHomeCurrency = homeCurrency ?? revision.homeCurrency ?? revision.currency;
  const finalExchangeRate = exchangeRate ?? revision.homeExchangeRate;
  const finalExchangeRateSource = exchangeRateSource ?? revision.homeExchangeRateSource;
  const finalExchangeRateDate = exchangeRateDate ?? revision.exchangeRateDate;

  // Calculate home currency equivalent if needed
  let homeEquivalent: Decimal | null = null;
  if (finalHomeCurrency && finalHomeCurrency !== revision.currency && finalExchangeRate) {
    const rate = toDecimal(finalExchangeRate);
    homeEquivalent = rate ? new PrismaDecimal(revision.totalAmount.toString()).mul(rate) : null;
  } else if (!finalHomeCurrency || finalHomeCurrency === revision.currency) {
    homeEquivalent = revision.totalAmount;
  } else {
    // Preserve existing homeEquivalent if no exchange rate to recalculate
    homeEquivalent = revision.homeEquivalent;
  }

  // Prepare data for atomic transaction
  const approvalData = {
    status: 'APPROVED' as const,
    approvedById: userId,
    approvedAt: new Date(),
    vendorName: approvedVendorName ?? revision.vendorName,
    vendorId: approvedVendorId ?? revision.vendorId,
    customerName: approvedCustomerName ?? (revision as unknown as { customerName?: string | null }).customerName ?? undefined,
    customerId: approvedCustomerId ?? (revision as unknown as { customerId?: string | null }).customerId ?? undefined,
    homeCurrency: finalHomeCurrency,
    homeExchangeRate: toDecimal(finalExchangeRate),
    homeExchangeRateSource: finalExchangeRateSource,
    exchangeRateDate: finalExchangeRateDate,
    homeEquivalent,
  };

    await tx.documentRevision.updateMany({
      where: { processingDocumentId: revision.processingDocumentId, status: 'APPROVED' },
      data: { status: 'SUPERSEDED', supersededAt: new Date() },
    });
    await tx.documentRevision.updateMany({
      where: {
        processingDocumentId: revision.processingDocumentId,
        status: 'DRAFT',
        id: { not: revisionId },
      },
      data: { status: 'SUPERSEDED', supersededAt: new Date() },
    });
    await tx.documentRevision.update({ where: { id: revisionId }, data: approvalData });
    await tx.processingDocument.update({
      where: { id: revision.processingDocumentId },
      data: { currentRevisionId: revisionId, lockVersion: { increment: 1 } },
    });
    await createAuditLog({
      tenantId: tenantId!,
      userId,
      companyId: companyId!,
      action: 'UPDATE',
      entityType: 'DocumentRevision',
      entityId: revisionId,
      summary: `Approved revision #${revision.revisionNumber}`,
      changeSource: 'MANUAL',
      metadata: {
        revisionNumber: revision.revisionNumber,
        totalAmount: revision.totalAmount.toString(),
        currency: revision.currency,
        homeEquivalent: homeEquivalent?.toString(),
        counterpartyIdentityCaptured: Boolean(revision.counterpartyIdentity),
      },
    }, tx);
    const approvedRevision = await tx.documentRevision.findUnique({
      where: { id: revisionId },
      include: { items: { orderBy: { lineNo: 'asc' } } },
    });
    if (!approvedRevision) throw new Error(`Approved revision ${revisionId} not found`);
    return { approvedRevision, approvedVendorName, approvedCustomerName };
  });

  const { approvedRevision, approvedVendorName, approvedCustomerName } = approval;

  // Storage movement remains best-effort after the atomic database approval.
  if (processingDoc?.document?.storageKey) {
    const document = processingDoc.document;

    // Generate new filename based on revision data
    // Use customer name for AR documents, vendor name for AP documents
    const contactName = isReceivable
      ? (approvedCustomerName ?? approvedVendorName ?? revision.vendorName)
      : (approvedVendorName ?? revision.vendorName);

    const extension = getFileExtension(document.fileName || document.storageKey);
    const newFilename = generateApprovedDocumentFilename({
      documentSubCategory: revision.documentSubCategory,
      documentDate: revision.documentDate,
      contactName,
      documentNumber: revision.documentNumber,
      currency: revision.currency,
      totalAmount: revision.totalAmount,
      originalExtension: extension,
    });

    // Build new storage key (preserves directory structure)
    const newStorageKey = buildApprovedStorageKey(document.storageKey, newFilename);

    // Only rename if the key is actually different
    if (newStorageKey !== document.storageKey) {
      try {
        // Check if source file exists before attempting move
        const fileExists = await storage.exists(document.storageKey);

        if (fileExists) {
          // Copy first so the recorded source remains valid until metadata is durable.
          await storage.copy(document.storageKey, newStorageKey);
          try {
            await prisma.document.update({
              where: { id: document.id },
              data: {
                fileName: newFilename,
                storageKey: newStorageKey,
              },
            });
          } catch (metadataError) {
            try {
              await storage.delete(newStorageKey);
            } catch (cleanupError) {
              log.error(
                `Failed to remove copied document "${newStorageKey}" after metadata update failure; `
                + `both copies remain and the database still points to "${document.storageKey}": ${cleanupError}`,
              );
            }
            throw metadataError;
          }

          try {
            await storage.delete(document.storageKey);
          } catch (deleteError) {
            log.warn(
              `Document metadata now points to "${newStorageKey}", but old source `
              + `"${document.storageKey}" could not be deleted and was retained: ${deleteError}`,
            );
          }
          log.info(`Recorded approved document at "${newStorageKey}" (previous key: "${document.storageKey}")`);
        } else {
          // File doesn't exist (e.g., extraction-only document without physical file)
          log.info(`Skipping file rename - source file does not exist: ${document.storageKey}`);

          // Still update the filename for display purposes
          await prisma.document.update({
            where: { id: document.id },
            data: {
              fileName: newFilename,
            },
          });
        }
      } catch (error) {
        // Log error but don't fail the approval
        log.error(`Failed to rename document file: ${error}`);
        // Continue with approval even if rename fails
      }
    }
  }

  log.info(`Revision ${revisionId} approved`);

  return approvedRevision;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a revision and update validation status
 */
export async function validateRevision(revisionId: string): Promise<{
  status: ValidationStatus;
  issues: ValidationIssue[];
}> {
  const revision = await getRevision(revisionId);
  if (!revision) {
    throw new Error(`Revision ${revisionId} not found`);
  }

  const issues: ValidationIssue[] = [];

  // Check for missing vendor
  if (!revision.vendorName) {
    issues.push({
      code: 'MISSING_VENDOR',
      ...VALIDATION_CODES.MISSING_VENDOR,
    });
  }

  // Check for future date
  if (revision.documentDate && revision.documentDate > new Date()) {
    issues.push({
      code: 'FUTURE_DATE',
      ...VALIDATION_CODES.FUTURE_DATE,
      field: 'documentDate',
    });
  }

  // Check credit note total is negative (credit notes are now sub-categories)
  const isCreditNote =
    revision.documentSubCategory === 'VENDOR_CREDIT_NOTE' ||
    revision.documentSubCategory === 'SALES_CREDIT_NOTE';
  if (isCreditNote && revision.totalAmount.greaterThan(0)) {
    issues.push({
      code: 'CREDIT_NOTE_TOTAL_NOT_NEGATIVE',
      ...VALIDATION_CODES.CREDIT_NOTE_TOTAL_NOT_NEGATIVE,
      field: 'totalAmount',
    });
  }

  // Check line item sum matches subtotal
  if (revision.items.length > 0) {
    const lineSum = revision.items.reduce((sum, item) => sum.add(item.amount), new PrismaDecimal(0));

    // Compare against subtotal if available, otherwise against total (when no tax)
    if (revision.subtotal) {
      // Allow small rounding difference (0.01)
      const diff = lineSum.sub(revision.subtotal).abs();
      if (diff.greaterThan(new PrismaDecimal('0.01'))) {
        issues.push({
          code: 'LINE_SUM_MISMATCH',
          ...VALIDATION_CODES.LINE_SUM_MISMATCH,
          field: 'subtotal',
          message: `Header subtotal (${revision.subtotal.toFixed(2)}) does not match line item subtotal (${lineSum.toFixed(2)})`,
        });
      }
    }

    // Check line item GST sum matches tax amount
    const lineGstSum = revision.items.reduce(
      (sum, item) => sum.add(item.gstAmount || new PrismaDecimal(0)),
      new PrismaDecimal(0)
    );
    if (revision.taxAmount) {
      const gstDiff = lineGstSum.sub(revision.taxAmount).abs();
      if (gstDiff.greaterThan(new PrismaDecimal('0.01'))) {
        issues.push({
          code: 'LINE_GST_SUM_MISMATCH',
          ...VALIDATION_CODES.LINE_GST_SUM_MISMATCH,
          field: 'taxAmount',
          message: `Header tax (${revision.taxAmount.toFixed(2)}) does not match line item tax (${lineGstSum.toFixed(2)})`,
        });
      }
    }

    // Check GST code matches actual GST percentage for each line item
    const gstCodeRates: Record<string, number> = {
      'SR': 0.09,   // 9%
      'SR8': 0.08,  // 8%
      'SR7': 0.07,  // 7%
      'ZR': 0,      // 0%
      'ES': 0,      // Exempt
      'OS': 0,      // Out of scope
      'NA': 0,      // Not applicable
    };

    for (const item of revision.items) {
      if (item.taxCode && item.gstAmount !== null && item.amount) {
        const amount = parseFloat(item.amount.toString());
        const gstAmount = parseFloat(item.gstAmount.toString());
        const expectedRate = gstCodeRates[item.taxCode] ?? null;

        // Handle both positive and negative amounts (credit notes)
        if (amount !== 0 && expectedRate !== null) {
          const expectedGst = amount * expectedRate;
          const amountTolerance = 0.01; // $0.01 absolute tolerance for rounding

          // Flag if GST amount differs from expected by more than $0.01
          if (Math.abs(gstAmount - expectedGst) > amountTolerance) {
            const actualRate = gstAmount / amount;
            issues.push({
              code: 'GST_CODE_AMOUNT_MISMATCH',
              ...VALIDATION_CODES.GST_CODE_AMOUNT_MISMATCH,
              field: 'lineItems',
              message: `Line ${item.lineNo}: GST code ${item.taxCode} expects ${expectedGst.toFixed(2)} (${(expectedRate * 100).toFixed(0)}%) but actual is ${gstAmount.toFixed(2)} (${(actualRate * 100).toFixed(1)}%)`,
            });
          }
        }
      }
    }
  }

  // Check header arithmetic: subtotal + tax = total
  // This check runs if we have subtotal OR taxAmount (not just both)
  if (revision.subtotal || revision.taxAmount) {
    const subtotal = revision.subtotal || new PrismaDecimal(0);
    const tax = revision.taxAmount || new PrismaDecimal(0);
    const expected = subtotal.add(tax);
    // Allow small rounding difference (0.01)
    const diff = expected.sub(revision.totalAmount).abs();
    if (diff.greaterThan(new PrismaDecimal('0.01'))) {
      issues.push({
        code: 'HEADER_ARITHMETIC_MISMATCH',
        ...VALIDATION_CODES.HEADER_ARITHMETIC_MISMATCH,
        field: 'totalAmount',
        message: `Header total (${revision.totalAmount.toFixed(2)}) does not match subtotal + tax (${expected.toFixed(2)})`,
      });
    }
  }

  // ============ HOME CURRENCY VALIDATION (Phase 2) ============

  // Check for exchange rate when currencies differ
  if (revision.homeCurrency && revision.homeCurrency !== revision.currency) {
    if (!revision.homeExchangeRate) {
      issues.push({
        code: 'MISSING_EXCHANGE_RATE',
        ...VALIDATION_CODES.MISSING_EXCHANGE_RATE,
        field: 'homeExchangeRate',
      });
    } else if (revision.homeExchangeRate.lessThanOrEqualTo(0)) {
      issues.push({
        code: 'INVALID_EXCHANGE_RATE',
        ...VALIDATION_CODES.INVALID_EXCHANGE_RATE,
        field: 'homeExchangeRate',
      });
    }
  }

  // Check home amount line item sum matches home subtotal
  if (revision.homeSubtotal && revision.items.length > 0) {
    const homeLineSum = revision.items.reduce(
      (sum, item) => sum.add(item.homeAmount || new PrismaDecimal(0)),
      new PrismaDecimal(0)
    );
    const homeDiff = homeLineSum.sub(revision.homeSubtotal).abs();
    if (homeDiff.greaterThan(new PrismaDecimal('0.01'))) {
      issues.push({
        code: 'HOME_AMOUNT_SUM_MISMATCH',
        ...VALIDATION_CODES.HOME_AMOUNT_SUM_MISMATCH,
        field: 'homeSubtotal',
        message: `Header home subtotal (${revision.homeSubtotal.toFixed(2)}) does not match line item home subtotal (${homeLineSum.toFixed(2)})`,
      });
    }
  }

  // Check home GST line item sum matches home tax amount
  if (revision.homeTaxAmount && revision.items.length > 0) {
    const homeGstSum = revision.items.reduce(
      (sum, item) => sum.add(item.homeGstAmount || new PrismaDecimal(0)),
      new PrismaDecimal(0)
    );
    const homeGstDiff = homeGstSum.sub(revision.homeTaxAmount).abs();
    if (homeGstDiff.greaterThan(new PrismaDecimal('0.01'))) {
      issues.push({
        code: 'HOME_GST_SUM_MISMATCH',
        ...VALIDATION_CODES.HOME_GST_SUM_MISMATCH,
        field: 'homeTaxAmount',
        message: `Header home tax (${revision.homeTaxAmount.toFixed(2)}) does not match line item home tax (${homeGstSum.toFixed(2)})`,
      });
    }
  }

  // Note: HOME_TOTAL_MISMATCH validation removed because:
  // 1. The UI now calculates and displays homeSubtotal + homeTaxAmount as the total
  // 2. The stored homeEquivalent field may contain stale/legacy values
  // 3. HEADER_HOME_LINE_TOTAL_MISMATCH already validates header vs line items

  // Check header home total matches sum of line item home totals (amount + GST)
  // This validation runs when we have line items AND stored home amounts
  const hasStoredHomeAmounts = !!(revision.homeSubtotal || revision.homeTaxAmount);
  const shouldCheckHomeTotal = revision.items.length > 0 && hasStoredHomeAmounts;

  if (shouldCheckHomeTotal) {
    // Use stored home amounts
    const headerHomeSubtotal = revision.homeSubtotal
      ? new PrismaDecimal(revision.homeSubtotal.toString())
      : new PrismaDecimal(0);
    const headerHomeTax = revision.homeTaxAmount
      ? new PrismaDecimal(revision.homeTaxAmount.toString())
      : new PrismaDecimal(0);
    const headerHomeTotal = headerHomeSubtotal.add(headerHomeTax);

    // Calculate sum of line item home amounts including GST (using stored values)
    const lineHomeTotal = revision.items.reduce((sum, item) => {
      const homeAmount = item.homeAmount
        ? new PrismaDecimal(item.homeAmount.toString())
        : new PrismaDecimal(0);
      const homeGst = item.homeGstAmount
        ? new PrismaDecimal(item.homeGstAmount.toString())
        : new PrismaDecimal(0);
      return sum.add(homeAmount).add(homeGst);
    }, new PrismaDecimal(0));

    const headerLineDiff = lineHomeTotal.sub(headerHomeTotal).abs();

    // No tolerance - any mismatch should be flagged as a warning
    if (headerLineDiff.greaterThan(new PrismaDecimal('0.001'))) {
      issues.push({
        code: 'HEADER_HOME_LINE_TOTAL_MISMATCH',
        ...VALIDATION_CODES.HEADER_HOME_LINE_TOTAL_MISMATCH,
        field: 'homeEquivalent',
        message: `Header home total (${headerHomeTotal.toFixed(2)}) does not match line item home total (${lineHomeTotal.toFixed(2)})`,
      });
    }
  }

  // Determine validation status
  let validationStatus: ValidationStatus = 'VALID';
  if (issues.some((i) => i.severity === 'ERROR')) {
    validationStatus = 'INVALID';
  } else if (issues.length > 0) {
    validationStatus = 'WARNINGS';
  }

  // Update revision with validation results
  await prisma.documentRevision.update({
    where: { id: revisionId },
    data: {
      validationStatus,
      validationIssues: { issues } as unknown as Prisma.InputJsonValue,
    },
  });

  return { status: validationStatus, issues };
}

// ============================================================================
// Retrieval
// ============================================================================

/**
 * Get a revision with items
 */
export async function getRevision(revisionId: string): Promise<RevisionWithItems | null> {
  const revision = await prisma.documentRevision.findUnique({
    where: { id: revisionId },
    include: {
      items: {
        orderBy: { lineNo: 'asc' },
      },
    },
  });

  return revision;
}

/**
 * Get current approved revision for a document
 */
export async function getCurrentRevision(processingDocumentId: string): Promise<RevisionWithItems | null> {
  const doc = await prisma.processingDocument.findUnique({
    where: { id: processingDocumentId },
    select: { currentRevisionId: true },
  });

  if (!doc?.currentRevisionId) {
    return null;
  }

  return getRevision(doc.currentRevisionId);
}

/**
 * Get revision history for a document
 */
export async function getRevisionHistory(processingDocumentId: string): Promise<DocumentRevision[]> {
  return prisma.documentRevision.findMany({
    where: { processingDocumentId },
    orderBy: { revisionNumber: 'desc' },
  });
}

/**
 * Get latest draft revision for a document
 */
export async function getLatestDraftRevision(processingDocumentId: string): Promise<RevisionWithItems | null> {
  const revision = await prisma.documentRevision.findFirst({
    where: {
      processingDocumentId,
      status: 'DRAFT',
    },
    orderBy: { revisionNumber: 'desc' },
    include: {
      items: {
        orderBy: { lineNo: 'asc' },
      },
    },
  });

  return revision;
}

// ============================================================================
// Document Key & Search
// ============================================================================

/**
 * Generate document key for duplicate detection (per Appendix B)
 */
function generateDocumentKey(input: {
  vendorName?: string | null;
  documentNumber?: string | null;
  documentDate?: Date | null;
  totalAmount: Decimal | number | string;
  currency: string;
}): string {
  const components = [
    normalizeVendorName(input.vendorName ?? ''),
    input.documentNumber?.toLowerCase() ?? '',
    input.documentDate?.toISOString().split('T')[0] ?? '',
    input.totalAmount.toString(),
    input.currency,
  ].filter(Boolean);

  return hashBlake3(components.join('|'));
}

/**
 * Normalize vendor name for comparison (per Appendix B)
 */

/**
 * Generate search text for full-text search
 */
function generateSearchText(input: {
  vendorName?: string | null;
  documentNumber?: string | null;
  documentDate?: Date | null;
  totalAmount?: string | null;
  currency?: string | null;
}): string {
  return [
    input.vendorName,
    input.documentNumber,
    input.documentDate?.toISOString().split('T')[0],
    input.totalAmount,
    input.currency,
  ]
    .filter(Boolean)
    .join(' ');
}

// Export helper functions for use in other modules
export { generateDocumentKey, generateSearchText };
