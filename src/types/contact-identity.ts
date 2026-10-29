import type { ContactDetailType, IdentificationType } from '@/generated/prisma';

export type ContactIdentitySource =
  | 'MANUAL'
  | 'COMPANY_QUICK_CREATE'
  | 'BIZFILE'
  | 'DOCUMENT_VAULT';

export type ContactResolutionDecision =
  | { action: 'AUTO' }
  | { action: 'REUSE'; contactId: string }
  | { action: 'CREATE_SEPARATE'; reason: string };

export type ContactMatchReason =
  | 'IDENTIFIER'
  | 'CORPORATE_UEN'
  | 'APPROVED_ALIAS'
  | 'EXACT_CANONICAL_NAME'
  | 'CORPORATE_SUFFIX_VARIANT'
  | 'FUZZY_NAME';

export interface ContactIdentityConflict {
  field:
    | 'identificationNumber'
    | 'corporateUen'
    | 'identificationType'
    | 'alias'
    | 'nationality'
    | 'dateOfBirth'
    | 'fullAddress'
    | 'firstName'
    | 'lastName'
    | 'corporateName';
  incomingValue: string | null;
  existingValue: string | null;
}

export interface ContactIdentityDetail {
  detailType: ContactDetailType;
  value: string;
  companyId?: string;
  purposes?: string[];
  label?: string;
  description?: string;
  displayOrder?: number;
  isPrimary?: boolean;
  isPoc?: boolean;
}

export type ContactIdentityConfidenceField =
  | 'identificationNumber'
  | 'corporateUen'
  | 'fullAddress'
  | 'email'
  | 'phone';

export interface ContactIdentityCandidate {
  source: ContactIdentitySource;
  sourceRecordId?: string;
  contactType: 'INDIVIDUAL' | 'CORPORATE';
  firstName?: string | null;
  lastName?: string | null;
  corporateName?: string | null;
  alias?: string | null;
  identificationType?: IdentificationType | null;
  identificationNumber?: string | null;
  corporateUen?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  fullAddress?: string | null;
  contactDetails?: ContactIdentityDetail[];
  confidence?: Partial<Record<ContactIdentityConfidenceField, number>>;
}

export interface ContactIdentityRecord extends ContactIdentityCandidate {
  id: string;
  tenantId: string;
  canonicalName: string;
  createdAt: Date;
  updatedAt: Date;
  relationshipCount: number;
  populatedFieldCount: number;
}

export interface ContactMatchResult {
  contactId: string;
  score: number;
  automatic: boolean;
  blockedByIdentifierConflict: boolean;
  reasons: ContactMatchReason[];
  conflicts: ContactIdentityConflict[];
}

export interface ContactMatchPreview extends ContactMatchResult {
  contact: {
    id: string;
    fullName: string;
    identificationType: IdentificationType | null;
    identificationNumber: string | null;
    corporateUen: string | null;
    companies: Array<{ id: string; name: string; uen: string }>;
  } | null;
}

export type ContactIdentityFingerprint = string;
