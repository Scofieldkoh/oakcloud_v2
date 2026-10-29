import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import type { CreateContactInput, UpdateContactInput, ContactSearchInput } from '@/lib/validations/contact';
import { Prisma } from '@/generated/prisma';
import type { Contact, ContactType } from '@/generated/prisma';
import type { ContactIdentityCandidate } from '@/types/contact-identity';
import { canonicalizeContactAlias, canonicalizeContactName } from '@/lib/contact-identity-normalization';

/**
 * Type for Prisma transaction client (interactive transaction)
 * Used to pass transaction context to service functions for data consistency
 */
export type PrismaTransactionClient = Prisma.TransactionClient;

export interface TenantAwareParams {
  tenantId: string;
  userId: string;
  /** Optional transaction client for atomic operations */
  tx?: PrismaTransactionClient;
}

function buildFullName(data: {
  contactType: ContactType;
  firstName?: string | null;
  lastName?: string | null;
  corporateName?: string | null;
}): string {
  if (data.contactType === 'CORPORATE') {
    return data.corporateName || 'Unknown Corporate';
  }
  const parts = [data.firstName, data.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Unknown';
}

function normalizeOptionalString(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createContact(
  data: CreateContactInput,
  params: TenantAwareParams
): Promise<Contact> {
  const { tenantId, userId, tx } = params;
  const db = tx || prisma;
  const fullName = buildFullName(data);
  const identificationNumber = normalizeOptionalString(data.identificationNumber);
  const corporateUen = normalizeOptionalString(data.corporateUen);

  const contact = await db.contact.create({
    data: {
      tenantId,
      contactType: data.contactType,
      firstName: data.firstName,
      lastName: data.lastName,
      fullName,
      canonicalName: canonicalizeContactName(fullName),
      alias: data.alias,
      canonicalAlias: canonicalizeContactAlias(data.alias),
      identificationType: data.identificationType,
      identificationNumber,
      nationality: data.nationality,
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
      corporateName: data.corporateName,
      corporateUen,
      fullAddress: data.fullAddress,
    },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'CREATE',
    entityType: 'Contact',
    entityId: contact.id,
    entityName: contact.fullName,
    summary: `Created contact "${contact.fullName}"`,
    changeSource: 'MANUAL',
    metadata: { fullName: contact.fullName },
  }, tx as Prisma.TransactionClient | undefined);

  return contact;
}

export async function updateContact(
  data: UpdateContactInput,
  params: TenantAwareParams
): Promise<Contact> {
  const { tenantId, userId, tx } = params;
  const db = tx ?? prisma;

  const existing = await db.contact.findFirst({
    where: { id: data.id, tenantId },
  });

  if (!existing) {
    throw new Error('Contact not found');
  }

  const updateData: Prisma.ContactUpdateInput = {};

  if (data.contactType !== undefined) updateData.contactType = data.contactType;
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if (data.alias !== undefined) {
    updateData.alias = data.alias;
    updateData.canonicalAlias = canonicalizeContactAlias(data.alias);
  }
  if (data.identificationType !== undefined) updateData.identificationType = data.identificationType;
  if (data.identificationNumber !== undefined)
    updateData.identificationNumber = normalizeOptionalString(data.identificationNumber);
  if (data.nationality !== undefined) updateData.nationality = data.nationality;
  if (data.dateOfBirth !== undefined)
    updateData.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
  if (data.corporateName !== undefined) updateData.corporateName = data.corporateName;
  if (data.corporateUen !== undefined)
    updateData.corporateUen = normalizeOptionalString(data.corporateUen);
  if (data.fullAddress !== undefined) updateData.fullAddress = data.fullAddress;

  // Rebuild full name if relevant fields changed
  const newFullName = buildFullName({
    contactType: data.contactType || existing.contactType,
    firstName: data.firstName !== undefined ? data.firstName : existing.firstName,
    lastName: data.lastName !== undefined ? data.lastName : existing.lastName,
    corporateName: data.corporateName !== undefined ? data.corporateName : existing.corporateName,
  });

  updateData.fullName = newFullName;
  updateData.canonicalName = canonicalizeContactName(newFullName);

  const contact = await db.contact.update({
    where: { id: data.id },
    data: updateData,
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'Contact',
    entityId: contact.id,
    entityName: contact.fullName,
    summary: `Updated contact "${contact.fullName}"`,
    changeSource: 'MANUAL',
  }, tx as Prisma.TransactionClient | undefined);

  return contact;
}

export async function findOrCreateContact(
  data: CreateContactInput,
  params: TenantAwareParams
): Promise<{ contact: Contact; isNew: boolean }> {
  if (!params.tenantId) {
    throw new Error('Tenant context required for findOrCreateContact');
  }
  const candidate: ContactIdentityCandidate = {
    source: 'MANUAL',
    contactType: data.contactType,
    firstName: data.firstName,
    lastName: data.lastName,
    corporateName: data.corporateName,
    alias: data.alias,
    identificationType: data.identificationType,
    identificationNumber: data.identificationNumber,
    corporateUen: data.corporateUen,
    nationality: data.nationality,
    dateOfBirth: data.dateOfBirth,
    fullAddress: data.fullAddress,
  };
  const { resolveOrCreateContact } = await import('@/services/contact-identity.service');
  const result = await resolveOrCreateContact(candidate, { action: 'AUTO' }, params);
  return { contact: result.contact, isNew: result.outcome === 'CREATED' };
}

/**
 * Search contacts with pagination
 * @param params - Search parameters
 * @param tenantId - Required tenant ID for security - all queries must be tenant-scoped
 * @throws Error if tenantId is not provided
 */
export async function searchContacts(
  params: ContactSearchInput,
  tenantId: string
): Promise<{
  contacts: Contact[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  // SECURITY: Tenant ID is required to prevent cross-tenant data access
  if (!tenantId) {
    throw new Error('Tenant ID is required for contact search');
  }

  const where: Prisma.ContactWhereInput = {
    deletedAt: null,
    tenantId, // Always filter by tenant
  };

  if (params.query) {
    const searchTerm = params.query.trim();
    where.OR = [
      { fullName: { contains: searchTerm, mode: 'insensitive' } },
      { identificationNumber: { contains: searchTerm, mode: 'insensitive' } },
      { corporateUen: { contains: searchTerm, mode: 'insensitive' } },
      // Search in contact details (email/phone are now in ContactDetail)
      { contactDetails: { some: { value: { contains: searchTerm, mode: 'insensitive' } } } },
    ];
  }

  if (params.contactType) {
    where.contactType = params.contactType;
  }

  if (params.companyId) {
    where.companyRelations = {
      some: {
        companyId: params.companyId,
      },
    };
  }

  // Handle special sort fields that don't map directly to Prisma fields
  // companyRelationsCount is a computed field - sort by fullName instead as fallback
  const sortField = params.sortBy === 'companyRelationsCount' ? 'fullName' : params.sortBy;
  const orderBy: Prisma.ContactOrderByWithRelationInput = {
    [sortField]: params.sortOrder,
  };

  const skip = (params.page - 1) * params.limit;

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy,
      skip,
      take: params.limit,
    }),
    prisma.contact.count({ where }),
  ]);

  return {
    contacts,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}

/**
 * Get a contact by ID
 * @param id - Contact ID
 * @param tenantId - Required tenant ID for security - all queries must be tenant-scoped
 * @throws Error if tenantId is not provided
 */
export async function getContactById(
  id: string,
  tenantId: string
): Promise<Contact | null> {
  // SECURITY: Tenant ID is required to prevent cross-tenant data access
  if (!tenantId) {
    throw new Error('Tenant ID is required for contact lookup');
  }

  return prisma.contact.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
}

// ============================================================================
// Contact Link Information (for delete confirmation)
// ============================================================================

export interface ContactLinkInfo {
  hasLinks: boolean;
  companyRelationCount: number;
  officerPositionCount: number;
  shareholdingCount: number;
  chargeHolderCount: number;
  totalLinks: number;
}

/**
 * Get information about a contact's linked data
 * Used to warn users before deletion
 */
export async function getContactLinkInfo(
  contactId: string,
  tenantId: string
): Promise<ContactLinkInfo> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId, deletedAt: null },
    select: {
      _count: {
        select: {
          companyRelations: true,
          officerPositions: true,
          shareholdings: true,
          chargeHoldings: true,
        },
      },
    },
  });

  if (!contact) {
    return {
      hasLinks: false,
      companyRelationCount: 0,
      officerPositionCount: 0,
      shareholdingCount: 0,
      chargeHolderCount: 0,
      totalLinks: 0,
    };
  }

  const { companyRelations, officerPositions, shareholdings, chargeHoldings } = contact._count;
  const totalLinks = companyRelations + officerPositions + shareholdings + chargeHoldings;

  return {
    hasLinks: totalLinks > 0,
    companyRelationCount: companyRelations,
    officerPositionCount: officerPositions,
    shareholdingCount: shareholdings,
    chargeHolderCount: chargeHoldings,
    totalLinks,
  };
}

import type { OfficerRole } from '@/generated/prisma';

// Officer roles that create Officer records (legal positions that require ACRA registration)
const OFFICER_ROLES = ['Director', 'Nominee Director', 'Secretary', 'Auditor'];

// Map display name to OfficerRole enum
const OFFICER_ROLE_MAP: Record<string, OfficerRole> = {
  'Director': 'DIRECTOR',
  'Nominee Director': 'NOMINEE_DIRECTOR',
  'Secretary': 'SECRETARY',
  'Auditor': 'AUDITOR',
};

/**
 * Simple link that just creates a CompanyContact relationship
 * Used by bizfile service when Officer/Shareholder records are created separately
 */
export async function createCompanyContactRelation(
  contactId: string,
  companyId: string,
  relationship: string,
  isPrimary: boolean = false,
  tx?: PrismaTransactionClient
): Promise<void> {
  const db = tx || prisma;
  await db.companyContact.upsert({
    where: {
      companyId_contactId_relationship: {
        companyId,
        contactId,
        relationship,
      },
    },
    create: {
      companyId,
      contactId,
      relationship,
      isPrimary,
    },
    update: {
      isPrimary,
    },
  });
}

interface LinkContactOptions {
  isPrimary?: boolean;
  appointmentDate?: string;
  numberOfShares?: number;
  shareClass?: string;
  tenantId: string;
  userId: string;
  tx?: PrismaTransactionClient;
}

export async function linkContactToCompany(
  contactId: string,
  companyId: string,
  relationship: string,
  options: LinkContactOptions
): Promise<void> {
  const { isPrimary = false, appointmentDate, numberOfShares, shareClass, tenantId, userId, tx } = options;
  const db = tx ?? prisma;

  // Validate both contact and company belong to the same tenant
  const [contact, company] = await Promise.all([
    db.contact.findUnique({ where: { id: contactId }, select: { tenantId: true, fullName: true } }),
    db.company.findUnique({ where: { id: companyId }, select: { tenantId: true, name: true } }),
  ]);

  if (!contact || !company) {
    throw new Error('Contact or company not found');
  }

  if (contact.tenantId !== company.tenantId) {
    throw new Error('Contact and company must belong to the same tenant');
  }

  if (contact.tenantId !== tenantId) {
    throw new Error('Access denied');
  }

  // Determine the type of link to create
  const isOfficerRole = OFFICER_ROLES.includes(relationship);
  const isShareholder = relationship === 'Shareholder';

  if (isOfficerRole) {
    // Check for existing active officer with same role at this company
    const officerRole = OFFICER_ROLE_MAP[relationship] || 'DIRECTOR';
    const existingOfficer = await db.companyOfficer.findFirst({
      where: {
        companyId,
        contactId,
        role: officerRole,
        isCurrent: true,
      },
    });

    if (existingOfficer) {
      throw new Error(`Contact is already an active ${relationship} at this company`);
    }

    // Create CompanyOfficer record
    await db.companyOfficer.create({
      data: {
        companyId,
        contactId,
        name: contact.fullName,
        role: officerRole,
        appointmentDate: appointmentDate ? new Date(appointmentDate) : null,
        isCurrent: true,
      },
    });

    await createAuditLog({
      tenantId,
      userId,
      companyId,
      action: 'UPDATE',
      entityType: 'CompanyOfficer',
      entityId: companyId,
      entityName: contact.fullName,
      summary: `Linked "${contact.fullName}" as ${relationship} to "${company.name}"`,
      changeSource: 'MANUAL',
    }, tx as Prisma.TransactionClient | undefined);
  } else if (isShareholder) {
    // Create CompanyShareholder record
    if (!numberOfShares || numberOfShares <= 0) {
      throw new Error('Number of shares is required for shareholders');
    }

    // Check for existing active shareholding at this company
    const existingShareholder = await db.companyShareholder.findFirst({
      where: {
        companyId,
        contactId,
        isCurrent: true,
      },
    });

    if (existingShareholder) {
      throw new Error('Contact already has an active shareholding at this company');
    }

    await db.companyShareholder.create({
      data: {
        companyId,
        contactId,
        name: contact.fullName,
        shareholderType: 'INDIVIDUAL',
        shareClass: shareClass || 'Ordinary',
        numberOfShares,
        isCurrent: true,
      },
    });

    await createAuditLog({
      tenantId,
      userId,
      companyId,
      action: 'UPDATE',
      entityType: 'CompanyShareholder',
      entityId: companyId,
      entityName: contact.fullName,
      summary: `Linked "${contact.fullName}" as shareholder with ${numberOfShares} ${shareClass || 'Ordinary'} shares to "${company.name}"`,
      changeSource: 'MANUAL',
    }, tx as Prisma.TransactionClient | undefined);
  } else {
    // Create general CompanyContact relationship
    await db.companyContact.upsert({
      where: {
        companyId_contactId_relationship: {
          companyId,
          contactId,
          relationship,
        },
      },
      create: {
        companyId,
        contactId,
        relationship,
        isPrimary,
      },
      update: {
        isPrimary,
      },
    });

    await createAuditLog({
      tenantId,
      userId,
      companyId,
      action: 'UPDATE',
      entityType: 'CompanyContact',
      entityId: companyId,
      entityName: contact.fullName,
      summary: `Linked "${contact.fullName}" as ${relationship} to "${company.name}"`,
      changeSource: 'MANUAL',
    }, tx as Prisma.TransactionClient | undefined);
  }
}

export async function unlinkContactFromCompany(
  contactId: string,
  companyId: string,
  relationship: string,
  tenantId: string,
  userId?: string
): Promise<void> {
  // REQUIRED: Validate the company belongs to the tenant
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { tenantId: true, name: true },
  });

  if (!company || company.tenantId !== tenantId) {
    throw new Error('Company not found or access denied');
  }

  // Also validate that the contact belongs to the same tenant
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { tenantId: true, fullName: true },
  });

  if (!contact || contact.tenantId !== tenantId) {
    throw new Error('Contact not found or access denied');
  }

  await prisma.companyContact.delete({
    where: {
      companyId_contactId_relationship: {
        companyId,
        contactId,
        relationship,
      },
    },
  });

  const pocCount = await prisma.companyContact.count({
    where: { companyId, isPoc: true, deletedAt: null },
  });
  await prisma.company.update({
    where: { id: companyId },
    data: { hasPoc: pocCount > 0 },
  });

  // Create audit log for the unlink operation
  if (userId) {
    await createAuditLog({
      tenantId,
      userId,
      companyId,
      action: 'UPDATE',
      entityType: 'CompanyContact',
      entityId: `${companyId}-${contactId}`,
      entityName: contact.fullName,
      summary: `Unlinked contact "${contact.fullName}" from company "${company.name}" (${relationship})`,
      changeSource: 'MANUAL',
      metadata: {
        contactId,
        contactName: contact.fullName,
        companyName: company.name,
        relationship,
      },
    });
  }
}

export async function getContactsByCompany(
  companyId: string,
  tenantId: string
): Promise<
  Array<{
    contact: Contact;
    relationship: string;
    isPrimary: boolean;
  }>
> {
  // REQUIRED: Validate the company belongs to the tenant
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { tenantId: true },
  });

  if (!company || company.tenantId !== tenantId) {
    throw new Error('Company not found or access denied');
  }

  const relations = await prisma.companyContact.findMany({
    where: { companyId },
    include: {
      contact: true,
    },
  });

  return relations.map((r) => ({
    contact: r.contact,
    relationship: r.relationship,
    isPrimary: r.isPrimary,
  }));
}

export async function deleteContact(
  id: string,
  reason: string,
  params: TenantAwareParams
): Promise<Contact> {
  const { tenantId, userId } = params;

  const existing = await prisma.contact.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      _count: {
        select: {
          companyRelations: true,
          officerPositions: true,
          shareholdings: true,
        },
      },
    },
  });

  if (!existing) {
    throw new Error('Contact not found');
  }

  const contact = await prisma.contact.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'DELETE',
    entityType: 'Contact',
    entityId: contact.id,
    entityName: contact.fullName,
    summary: `Deleted contact "${contact.fullName}"`,
    reason,
    changeSource: 'MANUAL',
    metadata: {
      companyRelations: existing._count.companyRelations,
      officerPositions: existing._count.officerPositions,
      shareholdings: existing._count.shareholdings,
    },
  });

  return contact;
}

export async function restoreContact(
  id: string,
  params: TenantAwareParams
): Promise<Contact> {
  const { tenantId, userId } = params;

  const existing = await prisma.contact.findFirst({
    where: { id, tenantId, deletedAt: { not: null } },
  });

  if (!existing) {
    throw new Error('Contact not found or not deleted');
  }

  const contact = await prisma.contact.update({
    where: { id },
    data: { deletedAt: null },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'RESTORE',
    entityType: 'Contact',
    entityId: contact.id,
    entityName: contact.fullName,
    summary: `Restored contact "${contact.fullName}"`,
    changeSource: 'MANUAL',
  });

  return contact;
}

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
      deletedAt: Date | null;
    };
  }>;
  officerPositions: Array<{
    id: string;
    role: string;
    appointmentDate: Date | null;
    cessationDate: Date | null;
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
}

interface ContactWithRelationshipsOptions {
  tenantId: string;  // Required for security
  companyIds?: string[];  // If provided, filter relationships to only these companies
}

/**
 * Get a contact with all its relationships (companies, officers, shareholders)
 * @param id - Contact ID
 * @param options - Options including required tenantId and optional companyIds filter
 * @throws Error if tenantId is not provided
 */
export async function getContactWithRelationships(
  id: string,
  options: ContactWithRelationshipsOptions
): Promise<(ContactWithRelationships & { hiddenCompanyCount?: number }) | null> {
  const { tenantId, companyIds } = options;

  // SECURITY: Tenant ID is required to prevent cross-tenant data access
  if (!tenantId) {
    throw new Error('Tenant ID is required for contact lookup');
  }

  const where: Prisma.ContactWhereInput = { id, tenantId, deletedAt: null };

  const contact = await prisma.contact.findFirst({
    where,
    include: {
      companyRelations: {
        include: {
          company: {
            select: {
              id: true,
              name: true,
              uen: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      },
      officerPositions: {
        include: {
          company: {
            select: {
              id: true,
              name: true,
              uen: true,
              deletedAt: true,
            },
          },
        },
      },
      shareholdings: {
        include: {
          company: {
            select: {
              id: true,
              name: true,
              uen: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });

  if (!contact) {
    return null;
  }

  // First, filter out relationships to deleted companies
  let filteredCompanyRelations = contact.companyRelations.filter(r => !r.company.deletedAt);
  let filteredOfficerPositions = contact.officerPositions.filter(o => !o.company.deletedAt);
  let filteredShareholdings = contact.shareholdings.filter(s => !s.company.deletedAt);
  let hiddenCompanyCount = 0;

  // If companyIds filter is provided (for company-scoped users), further filter relationships
  if (companyIds && companyIds.length >= 0) {
    const companyIdSet = new Set(companyIds);

    // Count unique companies that will be hidden (from non-deleted companies only)
    const allCompanyIds = new Set<string>();
    filteredCompanyRelations.forEach(r => allCompanyIds.add(r.company.id));
    filteredOfficerPositions.forEach(o => allCompanyIds.add(o.company.id));
    filteredShareholdings.forEach(s => allCompanyIds.add(s.company.id));

    const hiddenCompanyIds = new Set<string>();
    allCompanyIds.forEach(cid => {
      if (!companyIdSet.has(cid)) {
        hiddenCompanyIds.add(cid);
      }
    });
    hiddenCompanyCount = hiddenCompanyIds.size;

    // Filter to only show relationships for accessible companies
    filteredCompanyRelations = filteredCompanyRelations.filter(r => companyIdSet.has(r.company.id));
    filteredOfficerPositions = filteredOfficerPositions.filter(o => companyIdSet.has(o.company.id));
    filteredShareholdings = filteredShareholdings.filter(s => companyIdSet.has(s.company.id));
  }

  return {
    ...contact,
    companyRelations: filteredCompanyRelations.map((r) => ({
      id: r.id,
      relationship: r.relationship,
      isPrimary: r.isPrimary,
      company: r.company,
    })),
    officerPositions: filteredOfficerPositions.map((o) => ({
      id: o.id,
      role: o.role,
      appointmentDate: o.appointmentDate,
      cessationDate: o.cessationDate,
      isCurrent: o.isCurrent,
      company: o.company,
    })),
    shareholdings: filteredShareholdings.map((s) => ({
      id: s.id,
      shareClass: s.shareClass,
      numberOfShares: s.numberOfShares,
      percentageHeld: s.percentageHeld ? Number(s.percentageHeld) : null,
      isCurrent: s.isCurrent,
      company: s.company,
    })),
    hiddenCompanyCount,
  };
}

export interface SearchContactsOptions {
  /**
   * Optional array of company IDs to filter by (for company-scoped users)
   */
  companyIds?: string[];
  /**
   * Skip tenant filter - ONLY for SUPER_ADMIN operations that require
   * cross-tenant access. Regular operations MUST always provide tenantId.
   */
  skipTenantFilter?: boolean;
}

/**
 * Calculate exact unique company counts for a list of contacts across:
 * - company_contacts
 * - company_officers
 * - company_shareholders
 */
async function getUniqueCompanyCountsForContacts(
  contactIds: string[],
  companyIds?: string[]
): Promise<Map<string, number>> {
  const normalizeRelationship = (value: string) =>
    value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const OFFICER_ROLE_VALUES = new Set([
    'director',
    'managing director',
    'alternate director',
    'nominee director',
    'secretary',
    'ceo',
    'cfo',
    'auditor',
    'liquidator',
    'receiver',
    'judicial manager',
  ]);
  const isPositionRelationship = (relationship: string) => {
    const normalized = normalizeRelationship(relationship);
    if (OFFICER_ROLE_VALUES.has(normalized)) return true;
    if (normalized === 'shareholder') return true;
    return normalized.endsWith('shareholder');
  };

  const counts = new Map<string, number>();

  if (contactIds.length === 0) {
    return counts;
  }

  const companyIdFilter =
    companyIds && companyIds.length > 0 ? { companyId: { in: companyIds } } : {};

  const [companyRelations, officerPositions, shareholdings] = await Promise.all([
    prisma.companyContact.findMany({
      where: {
        deletedAt: null,
        contactId: { in: contactIds },
        company: { deletedAt: null },
        ...companyIdFilter,
      },
      select: {
        contactId: true,
        companyId: true,
        relationship: true,
      },
    }),
    prisma.companyOfficer.findMany({
      where: {
        contactId: { in: contactIds },
        isCurrent: true,
        cessationDate: null,
        company: { deletedAt: null },
        ...companyIdFilter,
      },
      select: {
        contactId: true,
        companyId: true,
      },
    }),
    prisma.companyShareholder.findMany({
      where: {
        contactId: { in: contactIds },
        isCurrent: true,
        company: { deletedAt: null },
        ...companyIdFilter,
      },
      select: {
        contactId: true,
        companyId: true,
      },
    }),
  ]);

  const uniqueCompanyIdsByContact = new Map<string, Set<string>>();
  const addCompanyForContact = (contactId: string | null, companyId: string) => {
    if (!contactId) return;

    let uniqueCompanyIds = uniqueCompanyIdsByContact.get(contactId);
    if (!uniqueCompanyIds) {
      uniqueCompanyIds = new Set<string>();
      uniqueCompanyIdsByContact.set(contactId, uniqueCompanyIds);
    }
    uniqueCompanyIds.add(companyId);
  };

  companyRelations
    .filter((rel) => !isPositionRelationship(rel.relationship))
    .forEach(({ contactId, companyId }) => addCompanyForContact(contactId, companyId));
  officerPositions.forEach(({ contactId, companyId }) => addCompanyForContact(contactId, companyId));
  shareholdings.forEach(({ contactId, companyId }) => addCompanyForContact(contactId, companyId));

  uniqueCompanyIdsByContact.forEach((companyIdsSet, contactId) => {
    counts.set(contactId, companyIdsSet.size);
  });

  return counts;
}

/**
 * Search contacts with company relation counts
 * @param params - Search parameters
 * @param tenantId - Tenant ID for security (required unless skipTenantFilter is true)
 * @param options - Optional search options including companyIds and skipTenantFilter
 * @throws Error if tenantId is not provided and skipTenantFilter is false
 */
export async function searchContactsWithCounts(
  params: ContactSearchInput,
  tenantId: string | null,
  options: SearchContactsOptions = {}
): Promise<{
  contacts: Array<Contact & {
    _count: { companyRelations: number };
    defaultEmail: string | null;
    defaultPhone: string | null;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const { companyIds, skipTenantFilter = false } = options;

  // SECURITY: Tenant ID is required to prevent cross-tenant data access unless explicitly skipped for SUPER_ADMIN
  if (!tenantId && !skipTenantFilter) {
    throw new Error('Tenant ID is required for contact search');
  }

  // For company-scoped users with no assignments, return empty result early
  if (companyIds && companyIds.length === 0) {
    return {
      contacts: [],
      total: 0,
      page: params.page,
      limit: params.limit,
      totalPages: 0,
    };
  }

  const andConditions: Prisma.ContactWhereInput[] = [
    { deletedAt: null },
  ];

  // Tenant scope (skip for SUPER_ADMIN cross-tenant operations)
  if (tenantId && !skipTenantFilter) {
    andConditions.push({ tenantId });
  }

  if (params.query) {
    const searchTerm = params.query.trim();
    andConditions.push({
      OR: [
        { fullName: { contains: searchTerm, mode: 'insensitive' } },
        { identificationNumber: { contains: searchTerm, mode: 'insensitive' } },
        { corporateUen: { contains: searchTerm, mode: 'insensitive' } },
        // Search in contact details (email/phone are now in ContactDetail)
        { contactDetails: { some: { value: { contains: searchTerm, mode: 'insensitive' } } } },
      ],
    });
  }

  // Full name filter (separate from query for inline filter)
  if (params.fullName) {
    andConditions.push({ fullName: { contains: params.fullName, mode: 'insensitive' } });
  }

  if (params.contactType) {
    andConditions.push({ contactType: params.contactType });
  }

  // Identification type filter
  if (params.identificationType) {
    andConditions.push({ identificationType: params.identificationType });
  }

  // Identification number filter
  if (params.identificationNumber) {
    andConditions.push({
      OR: [
        { identificationNumber: { contains: params.identificationNumber, mode: 'insensitive' } },
        { corporateUen: { contains: params.identificationNumber, mode: 'insensitive' } },
      ],
    });
  }

  // Nationality filter
  if (params.nationality) {
    andConditions.push({ nationality: { contains: params.nationality, mode: 'insensitive' } });
  }

  // Email filter (search in contact details)
  if (params.email) {
    andConditions.push({
      contactDetails: {
        some: {
          detailType: 'EMAIL',
          value: { contains: params.email, mode: 'insensitive' },
        },
      },
    });
  }

  // Phone filter (search in contact details)
  if (params.phone) {
    andConditions.push({
      contactDetails: {
        some: {
          detailType: 'PHONE',
          value: { contains: params.phone, mode: 'insensitive' },
        },
      },
    });
  }

  // Filter by specific company IDs (for company-scoped users)
  // This filters contacts linked to any of the user's assigned companies
  if (companyIds && companyIds.length > 0) {
    andConditions.push({
      OR: [
        // Contacts linked via company relations
        { companyRelations: { some: { companyId: { in: companyIds } } } },
        // Contacts linked as officers
        { officerPositions: { some: { companyId: { in: companyIds } } } },
        // Contacts linked as shareholders
        { shareholdings: { some: { companyId: { in: companyIds } } } },
      ],
    });
  }

  if (params.companyId) {
    andConditions.push({
      companyRelations: {
        some: {
          companyId: params.companyId,
        },
      },
    });
  }

  const where: Prisma.ContactWhereInput = {
    AND: andConditions,
  };

  const needsCountFilter = params.companiesMin !== undefined || params.companiesMax !== undefined;
  let filteredContactIds: string[] | undefined;
  let filteredCompanyCounts: Map<string, number> | undefined;

  if (needsCountFilter) {
    const candidateContacts = await prisma.contact.findMany({
      where,
      select: { id: true },
    });
    filteredCompanyCounts = await getUniqueCompanyCountsForContacts(
      candidateContacts.map((contact) => contact.id),
      companyIds,
    );

    filteredContactIds = candidateContacts
      .filter((contact) => {
        const companyCount = filteredCompanyCounts?.get(contact.id) || 0;
        if (params.companiesMin !== undefined && companyCount < params.companiesMin) return false;
        if (params.companiesMax !== undefined && companyCount > params.companiesMax) return false;
        return true;
      })
      .map((contact) => contact.id);

    andConditions.push({ id: { in: filteredContactIds } });
  }

  // Sorting - handle _count fields specially
  let orderBy: Prisma.ContactOrderByWithRelationInput | Prisma.ContactOrderByWithRelationInput[];

  if (params.sortBy === 'companyRelationsCount') {
    orderBy = {
      companyRelations: {
        _count: params.sortOrder,
      },
    };
  } else {
    orderBy = { [params.sortBy]: params.sortOrder };
  }

  const skip = (params.page - 1) * params.limit;

  const contactsPromise = prisma.contact.findMany({
    where,
    orderBy,
    skip,
    take: params.limit,
    include: {
      _count: {
        select: {
          companyRelations: { where: { company: { deletedAt: null } } },
        },
      },
      // Fetch email/phone details to display (prefer default, then company-specific)
      contactDetails: {
        where: {
          detailType: { in: ['EMAIL', 'PHONE'] },
          deletedAt: null,
        },
        select: {
          detailType: true,
          value: true,
          isPrimary: true,
          companyId: true,
          displayOrder: true,
          createdAt: true,
        },
        orderBy: [
          { companyId: 'asc' }, // Default (null) first, then company-specific
          { isPrimary: 'desc' },
          { displayOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      },
    },
  });
  const [contacts, total] = await Promise.all([
    contactsPromise,
    filteredContactIds ? Promise.resolve(filteredContactIds.length) : prisma.contact.count({ where }),
  ]);

  // Calculate exact unique company count across relations per contact.
  const uniqueCompanyCounts = filteredCompanyCounts ?? await getUniqueCompanyCountsForContacts(
    contacts.map((contact) => contact.id),
    companyIds,
  );

  const contactsWithCompanyCount = contacts.map((contact) => {
    return {
      ...contact,
      _count: {
        companyRelations: uniqueCompanyCounts.get(contact.id) || 0,
      },
    };
  });

  // Map contacts to include defaultEmail and defaultPhone
  const contactsWithDetails = contactsWithCompanyCount.map((contact) => {
    const details = contact.contactDetails;
    const getDetailValue = (type: 'EMAIL' | 'PHONE') => {
      const defaultDetail = details.find((d) => !d.companyId && d.detailType === type);
      if (defaultDetail?.value) return defaultDetail.value;
      const companyDetail = details.find((d) => d.companyId && d.detailType === type);
      return companyDetail?.value || null;
    };

    // Remove contactDetails from the response (counts are kept in _count)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { contactDetails, ...contactWithoutDetails } = contact;

    return {
      ...contactWithoutDetails,
      defaultEmail: getDetailValue('EMAIL'),
      defaultPhone: getDetailValue('PHONE'),
    };
  });

  return {
    contacts: contactsWithDetails,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}
