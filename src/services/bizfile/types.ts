/**
 * BizFile Service Type Definitions
 *
 * Shared types for the BizFile extraction and processing service.
 */

import type { EntityType, CompanyStatus, OfficerRole, ContactType, IdentificationType } from '@/generated/prisma';
import type { AIModel } from '@/lib/ai';
import type { ContactResolutionDecision } from '@/types/contact-identity';
import { canonicalizeCompanyStatus, canonicalizeEntityType, canonicalizeIdentificationType, canonicalizeOfficerRole } from './canonical-values';

// ============================================================================
// Extracted Data Types
// ============================================================================

/**
 * Extracted BizFile data structure
 * Represents all information that can be extracted from an ACRA BizFile document
 */
export interface ExtractedBizFileData {
  entityDetails: {
    uen: string;
    name: string;
    /** Short company alias extracted from or confirmed against the BizFile review. */
    displayAlias?: string | null;
    formerName?: string;
    dateOfNameChange?: string;
    formerNames?: Array<{ name: string; effectiveFrom?: string; effectiveTo?: string }>;
    entityType: string;
    status: string;
    statusDate?: string;
    incorporationDate?: string;
    registrationDate?: string;
  };
  ssicActivities?: {
    primary?: { code: string; description: string };
    secondary?: { code: string; description: string };
  };
  registeredAddress?: {
    block?: string;
    streetName: string;
    level?: string;
    unit?: string;
    buildingName?: string;
    postalCode: string;
    country?: string;
    effectiveFrom?: string;
  };
  mailingAddress?: {
    block?: string;
    streetName: string;
    level?: string;
    unit?: string;
    buildingName?: string;
    postalCode: string;
    country?: string;
  };
  /** Review-only intent used to keep the mailing address synchronized with the registered address. */
  mailingAddressSameAsRegistered?: boolean;
  paidUpCapital?: {
    amount: number;
    currency: string;
  };
  issuedCapital?: {
    amount: number;
    currency: string;
  };
  shareCapital?: Array<{
    shareClass: string;
    currency: string;
    numberOfShares: number;
    parValue?: number;
    totalValue: number;
    isPaidUp: boolean;
    isTreasury?: boolean;
    /** Review notes surfaced in the BizFile review UI (e.g., recalculated par values). */
    reviewFlags?: string[];
  }>;
  treasuryShares?: {
    numberOfShares: number;
    currency?: string;
  };
  shareholders?: Array<{
    name: string;
    type: 'INDIVIDUAL' | 'CORPORATE';
    isNominee?: boolean;
    identificationType?: string;
    identificationNumber?: string;
    nationality?: string;
    placeOfOrigin?: string;
    address?: string;
    shareClass: string;
    numberOfShares: number;
    percentageHeld?: number;
    currency?: string;
    contactResolution?: Exclude<ContactResolutionDecision, { action: 'AUTO' }>;
  }>;
  officers?: Array<{
    name: string;
    role: string;
    identificationType?: string;
    identificationNumber?: string;
    nationality?: string;
    address?: string;
    appointmentDate?: string;
    cessationDate?: string;
    contactResolution?: Exclude<ContactResolutionDecision, { action: 'AUTO' }>;
  }>;
  auditor?: {
    name: string;
    address?: string;
    appointmentDate?: string;
  };
  financialYear?: {
    endDay: number;
    endMonth: number;
  };
  homeCurrency?: string;
  compliance?: {
    lastAgmDate?: string;
    lastArFiledDate?: string;
    accountsDueDate?: string;
    fyeAsAtLastAr?: string;
  };
  charges?: Array<{
    chargeNumber?: string;
    chargeType?: string;
    description?: string;
    chargeHolderName: string;
    amountSecured?: number;
    amountSecuredText?: string;
    currency?: string;
    registrationDate?: string;
    dischargeDate?: string;
  }>;
  /** Document metadata from the BizFile receipt (at end of document) */
  documentMetadata?: {
    /** ACRA receipt number (e.g., 'ACRA250807001467') */
    receiptNo?: string;
    /** Date the BizFile was generated (YYYY-MM-DD format) */
    receiptDate?: string;
  };
}

// ============================================================================
// Extraction Options & Results
// ============================================================================

/**
 * Input for vision-based BizFile extraction
 */
export interface BizFileVisionInput {
  /** Base64-encoded file data */
  base64: string;
  /** MIME type of the file */
  mimeType: string;
}

/**
 * Options for BizFile extraction
 */
export interface BizFileExtractionOptions {
  /** AI model to use for extraction (optional, uses best available if not specified) */
  modelId?: AIModel | string;
  /** Original document bytes for OCR-first extraction when available */
  documentInput?: BizFileVisionInput;
  /** Additional context to provide to the AI for better extraction */
  additionalContext?: string;
  /** Tenant ID for connector-aware AI resolution (uses tenant's configured AI provider) */
  tenantId?: string | null;
  /** User ID who triggered the extraction (for usage tracking) */
  userId?: string;
  /** Company ID being extracted (for usage tracking) */
  companyId?: string;
  /** Document ID being processed (for usage tracking) */
  documentId?: string;
}

/**
 * Result of BizFile extraction including metadata
 */
export interface BizFileExtractionResult {
  data: ExtractedBizFileData;
  modelUsed: string;
  providerUsed: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    pagesProcessed?: number;
    docSizeBytes?: number | null;
  };
}

// ============================================================================
// Diff Types
// ============================================================================

/**
 * Field difference entry for BizFile update comparison
 */
export interface BizFileDiffEntry {
  field: string;
  label: string;
  oldValue: string | number | null | undefined;
  newValue: string | number | null | undefined;
  category: 'entity' | 'ssic' | 'address' | 'compliance' | 'capital' | 'additional' | 'charges';
}

/**
 * Extracted officer from BizFile
 */
export interface ExtractedOfficerData {
  name: string;
  role: string;
  identificationType?: string;
  identificationNumber?: string;
  nationality?: string;
  address?: string;
  appointmentDate?: string;
  cessationDate?: string;
  contactResolution?: Exclude<ContactResolutionDecision, { action: 'AUTO' }>;
}

/**
 * Extracted shareholder from BizFile
 */
export interface ExtractedShareholderData {
  name: string;
  type: 'INDIVIDUAL' | 'CORPORATE';
  isNominee?: boolean;
  identificationType?: string;
  identificationNumber?: string;
  nationality?: string;
  placeOfOrigin?: string;
  address?: string;
  shareClass: string;
  numberOfShares: number;
  percentageHeld?: number;
  currency?: string;
  contactResolution?: Exclude<ContactResolutionDecision, { action: 'AUTO' }>;
}

/**
 * Officer diff entry for BizFile update comparison
 */
export interface OfficerDiffEntry {
  type: 'added' | 'updated' | 'potentially_ceased';
  officerId?: string;
  sourceRecordId?: string;
  name: string;
  role: OfficerRole;
  changes?: Array<{ field: string; label: string; oldValue: string | null; newValue: string | null }>;
  extractedData?: ExtractedOfficerData;
  matchConfidence?: 'high' | 'medium' | 'low';
}

/**
 * Shareholder diff entry for BizFile update comparison
 */
export interface ShareholderDiffEntry {
  type: 'added' | 'removed' | 'updated';
  shareholderId?: string;
  sourceRecordId?: string;
  name: string;
  shareholderType: 'INDIVIDUAL' | 'CORPORATE';
  changes?: Array<{ field: string; label: string; oldValue: string | number | null; newValue: string | number | null }>;
  shareholdingChanges?: {
    shareClass?: { old: string; new: string };
    numberOfShares?: { old: number; new: number };
  };
  extractedData?: ExtractedShareholderData;
  matchConfidence?: 'high' | 'medium' | 'low';
}

/**
 * Officer action from UI for processing updates
 */
export interface OfficerAction {
  officerId: string;
  action: 'cease' | 'follow_up';
  cessationDate?: string;
}

/**
 * Extended diff result including officers and shareholders
 */
export interface ExtendedBizFileDiffResult {
  hasDifferences: boolean;
  differences: BizFileDiffEntry[];
  existingCompany: { name: string; uen: string };
  officerDiffs: OfficerDiffEntry[];
  shareholderDiffs: ShareholderDiffEntry[];
  summary: {
    officersAdded: number;
    officersUpdated: number;
    officersPotentiallyCeased: number;
    shareholdersAdded: number;
    shareholdersUpdated: number;
    shareholdersRemoved: number;
  };
}

// ============================================================================
// Processing Result Types
// ============================================================================

/**
 * Result of selective BizFile processing
 */
export interface SelectiveProcessingResult {
  companyId: string;
  created: boolean;
  updatedFields: string[];
  officerChanges: { added: number; updated: number; ceased: number; followUp: number };
  shareholderChanges: { added: number; updated: number; removed: number };
}

/**
 * Result of full BizFile processing
 */
export interface ProcessingResult {
  companyId: string;
  created: boolean;
  operationReceiptId?: string;
}

// ============================================================================
// Entity Type Mappings
// ============================================================================

/**
 * Map extracted entity type string to Prisma EntityType enum
 */
export function mapEntityType(type: string | null | undefined): EntityType {
  if (!type) return 'OTHER';
  const mapping: Record<string, EntityType> = {
    PRIVATE_LIMITED: 'PRIVATE_LIMITED',
    'PRIVATE LIMITED': 'PRIVATE_LIMITED',
    'PRIVATE COMPANY LIMITED BY SHARES': 'PRIVATE_LIMITED',
    EXEMPTED_PRIVATE_LIMITED: 'EXEMPTED_PRIVATE_LIMITED',
    'EXEMPTED PRIVATE LIMITED': 'EXEMPTED_PRIVATE_LIMITED',
    'EXEMPT PRIVATE LIMITED': 'EXEMPTED_PRIVATE_LIMITED',
    'EXEMPT PRIVATE COMPANY LIMITED BY SHARES': 'EXEMPTED_PRIVATE_LIMITED',
    'EXEMPTED PRIVATE COMPANY LIMITED BY SHARES': 'EXEMPTED_PRIVATE_LIMITED',
    PUBLIC_LIMITED: 'PUBLIC_LIMITED',
    'PUBLIC LIMITED': 'PUBLIC_LIMITED',
    'PUBLIC COMPANY LIMITED BY SHARES': 'PUBLIC_LIMITED',
    PUBLIC_COMPANY_LIMITED_BY_GUARANTEE: 'PUBLIC_COMPANY_LIMITED_BY_GUARANTEE',
    SOLE_PROPRIETORSHIP: 'SOLE_PROPRIETORSHIP',
    'SOLE PROPRIETORSHIP': 'SOLE_PROPRIETORSHIP',
    PARTNERSHIP: 'PARTNERSHIP',
    LIMITED_PARTNERSHIP: 'LIMITED_PARTNERSHIP',
    'LIMITED PARTNERSHIP': 'LIMITED_PARTNERSHIP',
    LIMITED_LIABILITY_PARTNERSHIP: 'LIMITED_LIABILITY_PARTNERSHIP',
    LLP: 'LIMITED_LIABILITY_PARTNERSHIP',
    FOREIGN_COMPANY: 'FOREIGN_COMPANY',
    'FOREIGN COMPANY': 'FOREIGN_COMPANY',
    VARIABLE_CAPITAL_COMPANY: 'VARIABLE_CAPITAL_COMPANY',
    VCC: 'VARIABLE_CAPITAL_COMPANY',
  };
  const canonical = canonicalizeEntityType(type) as string;
  return mapping[canonical] ?? 'OTHER';
}

/**
 * Map extracted status string to Prisma CompanyStatus enum
 */
export function mapCompanyStatus(status: string | null | undefined): CompanyStatus {
  if (!status) return 'OTHER';
  const mapping: Record<string, CompanyStatus> = {
    LIVE: 'LIVE',
    'LIVE COMPANY': 'LIVE',
    STRUCK_OFF: 'STRUCK_OFF',
    'STRUCK OFF': 'STRUCK_OFF',
    WINDING_UP: 'WINDING_UP',
    'WINDING UP': 'WINDING_UP',
    DISSOLVED: 'DISSOLVED',
    IN_LIQUIDATION: 'IN_LIQUIDATION',
    'IN LIQUIDATION': 'IN_LIQUIDATION',
    IN_RECEIVERSHIP: 'IN_RECEIVERSHIP',
    'IN RECEIVERSHIP': 'IN_RECEIVERSHIP',
    AMALGAMATED: 'AMALGAMATED',
    CONVERTED: 'CONVERTED',
  };
  const canonical = canonicalizeCompanyStatus(status) as string;
  return mapping[canonical] ?? 'OTHER';
}

/**
 * Map extracted officer role to Prisma OfficerRole enum
 */
export function mapOfficerRole(role: string | null | undefined): OfficerRole {
  if (!role) return 'DIRECTOR';
  const mapping: Record<string, OfficerRole> = {
    DIRECTOR: 'DIRECTOR',
    MANAGING_DIRECTOR: 'MANAGING_DIRECTOR',
    'MANAGING DIRECTOR': 'MANAGING_DIRECTOR',
    ALTERNATE_DIRECTOR: 'ALTERNATE_DIRECTOR',
    'ALTERNATE DIRECTOR': 'ALTERNATE_DIRECTOR',
    NOMINEE_DIRECTOR: 'NOMINEE_DIRECTOR',
    'NOMINEE DIRECTOR': 'NOMINEE_DIRECTOR',
    SECRETARY: 'SECRETARY',
    'COMPANY SECRETARY': 'SECRETARY',
    CEO: 'CEO',
    'CHIEF EXECUTIVE OFFICER': 'CEO',
    CFO: 'CFO',
    'CHIEF FINANCIAL OFFICER': 'CFO',
    AUDITOR: 'AUDITOR',
    LIQUIDATOR: 'LIQUIDATOR',
    RECEIVER: 'RECEIVER',
    JUDICIAL_MANAGER: 'JUDICIAL_MANAGER',
    'JUDICIAL MANAGER': 'JUDICIAL_MANAGER',
  };
  const canonical = canonicalizeOfficerRole(role) as string;
  return mapping[canonical] ?? 'DIRECTOR';
}

/**
 * Map contact type string to Prisma ContactType enum
 */
export function mapContactType(type: string | null | undefined): ContactType {
  if (!type) return 'INDIVIDUAL';
  return type.toUpperCase() === 'CORPORATE' ? 'CORPORATE' : 'INDIVIDUAL';
}

/**
 * Map identification type string to Prisma IdentificationType enum
 */
export function mapIdentificationType(type: string | undefined): IdentificationType | null {
  if (!type) return null;
  const mapping: Record<string, IdentificationType> = {
    NRIC: 'NRIC',
    FIN: 'FIN',
    PASSPORT: 'PASSPORT',
    UEN: 'UEN',
  };
  const canonical = canonicalizeIdentificationType(type) as string;
  return mapping[canonical] ?? 'OTHER';
}
