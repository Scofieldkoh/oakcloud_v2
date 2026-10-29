/**
 * Shared contact types used across services and hooks.
 * Centralizes type definitions to avoid duplication and ensure consistency.
 */

import type { Contact, ContactDetailType, ContactType, IdentificationType } from '@/generated/prisma';
import type { ContactIdentityConflict, ContactMatchReason } from '@/types/contact-identity';

// ============================================================================
// CONTACT RELATIONSHIPS
// ============================================================================

/**
 * Contact with all its relationships to companies.
 * Used when viewing a contact's full profile including linked companies.
 */
export interface ContactWithRelationships extends Contact {
  companyRelations: Array<{
    id: string;
    relationship: string;
    isPrimary: boolean;
    company: {
      id: string;
      name: string;
      uen: string;
      status: string;
      deletedAt: Date | string | null;
    };
  }>;
  officerPositions: Array<{
    id: string;
    role: string;
    appointmentDate: Date | string | null;
    cessationDate: Date | string | null;
    isCurrent: boolean;
    company: {
      id: string;
      name: string;
      uen: string;
    };
  }>;
  shareholdings: Array<{
    id: string;
    shareClass: string;
    numberOfShares: number;
    percentageHeld: number | null;
    isCurrent: boolean;
    company: {
      id: string;
      name: string;
      uen: string;
    };
  }>;
  /** Number of companies hidden due to RBAC (for company-scoped users) */
  hiddenCompanyCount?: number;
}

// ============================================================================
// CONTACT WITH COUNTS
// ============================================================================

/**
 * Contact with relation counts for list views.
 */
export interface ContactWithCount extends Contact {
  _count?: {
    companyRelations: number;
  };
}

/**
 * Contact with count and default contact details for table display.
 */
export interface ContactWithCountAndDetails extends ContactWithCount {
  /** Display email (default first, then company-specific fallback) */
  defaultEmail?: string | null;
  /** Display phone (default first, then company-specific fallback) */
  defaultPhone?: string | null;
}

// ============================================================================
// CONTACT DETAILS
// ============================================================================

/**
 * Contact detail record from the database.
 */
export interface ContactDetailRecord {
  id: string;
  tenantId: string;
  contactId: string | null;
  companyId: string | null;
  detailType: ContactDetailType;
  value: string;
  label: string | null;
  purposes: string[];
  description: string | null;
  displayOrder: number;
  isPrimary: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
  contact?: {
    id: string;
    fullName: string;
    contactType: string;
  } | null;
  company?: {
    id: string;
    name: string;
    uen: string;
  } | null;
}

/**
 * Contact with their associated details.
 * Used in company contact details view.
 */
export interface ContactWithDetails {
  contact: {
    id: string;
    fullName: string;
    contactType: string;
    relationship?: string;
  };
  details: ContactDetailRecord[];
  isCurrent: boolean;
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Search parameters for contacts.
 */
export interface ContactSearchParams {
  query?: string;
  contactType?: 'INDIVIDUAL' | 'CORPORATE';
  companyId?: string;
  page?: number;
  limit?: number;
  sortBy?: 'fullName' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  tenantId?: string;
}

/**
 * Search result for contacts.
 */
export interface ContactSearchResult<T = ContactWithCount> {
  contacts: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============================================================================
// LINK INFO
// ============================================================================

/**
 * Information about a contact's links to other entities.
 * Used for delete confirmation warnings.
 */
export interface ContactLinkInfo {
  hasLinks: boolean;
  companyRelationCount: number;
  officerPositionCount: number;
  shareholdingCount: number;
  chargeHolderCount: number;
  totalLinks: number;
}

// ============================================================================
// DUPLICATE REVIEW AND MERGE
// ============================================================================

export interface ContactDuplicatePreview {
  id: string;
  contactType: ContactType;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  corporateName: string | null;
  alias: string | null;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  corporateUen: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  fullAddress: string | null;
  contactDetails: Array<{ detailType: ContactDetailType; value: string; companyId: string | null }>;
  companies: Array<{ id: string; name: string; uen: string }>;
  referenceCounts: {
    companyRelations: number;
    officerPositions: number;
    shareholdings: number;
    chargeHoldings: number;
    contactDetails: number;
    noteTabs: number;
    documentRevisions: number;
    aliases: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ContactDuplicateGroup {
  contactIds: string[];
  contacts: ContactDuplicatePreview[];
  reasons: ContactMatchReason[];
  confidence: number;
  conflicts: ContactIdentityConflict[];
  blockedByIdentifierConflict: boolean;
  fingerprints: Record<string, string>;
  recommendedMasterId: string;
}

export interface ContactDuplicateGroupsResult {
  groups: ContactDuplicateGroup[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RejectContactDuplicateInput {
  leftContactId: string;
  rightContactId: string;
  leftFingerprint: string;
  rightFingerprint: string;
  reason: string;
}

export interface ContactMergeFieldDecisions {
  firstName?: string | null;
  lastName?: string | null;
  alias?: string | null;
  identificationType?: IdentificationType | null;
  identificationNumber?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  corporateName?: string | null;
  corporateUen?: string | null;
  fullAddress?: string | null;
}

export interface MergeContactsInput {
  idempotencyKey: string;
  masterContactId: string;
  sourceContactIds: string[];
  expectedUpdatedAt: Record<string, string>;
  expectedFingerprints: Record<string, string>;
  fieldDecisions: ContactMergeFieldDecisions;
}

export interface MergeContactsResult {
  ledgerId: string;
  survivingContactId: string;
  movedCounts: Record<string, number>;
  alreadyCompleted: boolean;
}
