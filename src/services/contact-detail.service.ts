import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { normalizeContactDetailValue } from '@/lib/contact-identity-normalization';
import type { ContactDetail, ContactDetailType, Prisma } from '@/generated/prisma';

/**
 * Type for Prisma transaction client (interactive transaction)
 */
export type PrismaTransactionClient = Prisma.TransactionClient;

export interface TenantAwareParams {
  tenantId: string;
  userId: string;
  tx?: PrismaTransactionClient;
}

// ============================================================================
// TYPES
// ============================================================================

export interface CreateContactDetailInput {
  contactId?: string;
  companyId?: string;
  detailType: ContactDetailType;
  value: string;
  label?: string;
  purposes?: string[];
  description?: string;
  displayOrder?: number;
  isPrimary?: boolean;
  isPoc?: boolean;
}

export interface UpdateContactDetailInput {
  id: string;
  detailType?: ContactDetailType;
  value?: string;
  label?: string | null;
  purposes?: string[];
  description?: string | null;
  displayOrder?: number;
  isPrimary?: boolean;
  isPoc?: boolean;
}

export interface ContactDetailSearchParams {
  contactId?: string;
  companyId?: string;
  detailType?: ContactDetailType;
  includeDeleted?: boolean;
}

export interface ContactDetailWithRelations extends ContactDetail {
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

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Create a new contact detail
 */
export async function createContactDetail(
  data: CreateContactDetailInput,
  params: TenantAwareParams
): Promise<ContactDetail> {
  const { tenantId, userId, tx } = params;
  const db = tx || prisma;

  // Validate that at least one of contactId or companyId is provided
  if (!data.contactId && !data.companyId) {
    throw new Error('Contact detail must be linked to either a contact or a company');
  }

  // Validate contact belongs to tenant if contactId is provided
  if (data.contactId) {
    const contact = await db.contact.findFirst({
      where: { id: data.contactId, tenantId, deletedAt: null },
    });
    if (!contact) {
      throw new Error('Contact not found');
    }
  }

  // Validate company belongs to tenant if companyId is provided
  if (data.companyId) {
    const company = await db.company.findFirst({
      where: { id: data.companyId, tenantId, deletedAt: null },
    });
    if (!company) {
      throw new Error('Company not found');
    }
  }

  // Consolidate equal normalized details while allowing genuinely distinct values per scope.
  const isCompanyLevelDetail = !data.contactId && data.companyId;

  if (!isCompanyLevelDetail && (data.detailType === 'EMAIL' || data.detailType === 'PHONE')) {
    const existingDetails = await db.contactDetail.findMany({
      where: {
        tenantId,
        detailType: data.detailType,
        contactId: data.contactId || null,
        companyId: data.companyId || null,
        deletedAt: null,
      },
    });
    const normalizedValue = normalizeContactDetailValue(data.detailType, data.value);
    const duplicate = existingDetails.find(
      (detail) => normalizeContactDetailValue(detail.detailType, detail.value) === normalizedValue,
    );
    if (duplicate) {
      return duplicate;
    }
  }

  // If isPrimary is true, unset other primary details of the same type
  if (data.isPrimary) {
    const where: Prisma.ContactDetailWhereInput = {
      tenantId,
      detailType: data.detailType,
      isPrimary: true,
      deletedAt: null,
    };
    if (data.contactId) where.contactId = data.contactId;
    if (data.companyId) where.companyId = data.companyId;

    await db.contactDetail.updateMany({
      where,
      data: { isPrimary: false },
    });
  }

  const contactDetail = await db.contactDetail.create({
    data: {
      tenantId,
      contactId: data.contactId,
      companyId: data.companyId,
      detailType: data.detailType,
      value: data.value,
      label: data.label,
      purposes: data.purposes ?? [],
      description: data.description,
      displayOrder: data.displayOrder ?? 0,
      isPrimary: data.isPrimary ?? false,
      isPoc: data.isPoc ?? false,
    },
  });

  // Create audit log
  const entityName = data.label || `${data.detailType}: ${data.value}`;
  await createAuditLog({
    tenantId,
    userId,
    companyId: data.companyId,
    action: 'CREATE',
    entityType: 'ContactDetail',
    entityId: contactDetail.id,
    entityName,
    summary: `Created ${data.detailType.toLowerCase()} contact detail "${data.value}"`,
    changeSource: 'MANUAL',
    metadata: {
      detailType: data.detailType,
      value: data.value,
      contactId: data.contactId,
      companyId: data.companyId,
    },
  }, tx as Prisma.TransactionClient | undefined);

  return contactDetail;
}

/**
 * Update a contact detail
 */
export async function updateContactDetail(
  data: UpdateContactDetailInput,
  params: TenantAwareParams
): Promise<ContactDetail> {
  const { tenantId, userId, tx } = params;
  const db = tx || prisma;

  const existing = await db.contactDetail.findFirst({
    where: { id: data.id, tenantId, deletedAt: null },
  });

  if (!existing) {
    throw new Error('Contact detail not found');
  }

  // If isPrimary is being set to true, unset other primary details of the same type
  if (data.isPrimary && !existing.isPrimary) {
    const where: Prisma.ContactDetailWhereInput = {
      tenantId,
      detailType: data.detailType || existing.detailType,
      isPrimary: true,
      deletedAt: null,
      id: { not: data.id },
    };
    if (existing.contactId) where.contactId = existing.contactId;
    if (existing.companyId) where.companyId = existing.companyId;

    await db.contactDetail.updateMany({
      where,
      data: { isPrimary: false },
    });
  }

  const contactDetail = await db.contactDetail.update({
    where: { id: data.id },
    data: {
      detailType: data.detailType,
      value: data.value,
      label: data.label,
      purposes: data.purposes,
      description: data.description,
      displayOrder: data.displayOrder,
      isPrimary: data.isPrimary,
      isPoc: data.isPoc,
    },
  });

  // Create audit log
  const entityName = contactDetail.label || `${contactDetail.detailType}: ${contactDetail.value}`;
  await createAuditLog({
    tenantId,
    userId,
    companyId: existing.companyId || undefined,
    action: 'UPDATE',
    entityType: 'ContactDetail',
    entityId: contactDetail.id,
    entityName,
    summary: `Updated ${contactDetail.detailType.toLowerCase()} contact detail`,
    changeSource: 'MANUAL',
  }, tx as Prisma.TransactionClient | undefined);

  return contactDetail;
}

/**
 * Delete a contact detail (soft delete)
 */
export async function deleteContactDetail(
  id: string,
  params: TenantAwareParams
): Promise<ContactDetail> {
  const { tenantId, userId, tx } = params;
  const db = tx || prisma;

  const existing = await db.contactDetail.findFirst({
    where: { id, tenantId, deletedAt: null },
  });

  if (!existing) {
    throw new Error('Contact detail not found');
  }

  const contactDetail = await db.contactDetail.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  // Create audit log
  const entityName = existing.label || `${existing.detailType}: ${existing.value}`;
  await createAuditLog({
    tenantId,
    userId,
    companyId: existing.companyId || undefined,
    action: 'DELETE',
    entityType: 'ContactDetail',
    entityId: id,
    entityName,
    summary: `Deleted ${existing.detailType.toLowerCase()} contact detail "${existing.value}"`,
    changeSource: 'MANUAL',
  }, tx as Prisma.TransactionClient | undefined);

  return contactDetail;
}

// ============================================================================
// QUERY OPERATIONS
// ============================================================================

/**
 * Get contact details for a company
 * Includes both company-level details and details of linked contacts
 * POC status is company-specific (stored on CompanyContact)
 */
export async function getCompanyContactDetails(
  companyId: string,
  tenantId: string
): Promise<{
  companyDetails: ContactDetailWithRelations[];
  contactDetails: Array<{
    contact: {
      id: string;
      fullName: string;
      contactType: string;
      relationship?: string;
    };
    details: ContactDetailWithRelations[];
    isPoc: boolean; // Company-specific POC status from CompanyContact
    isCurrent: boolean; // Whether contact has an active relationship to the company
  }>;
  hasPoc: boolean;
}> {
  const normalizeRelationship = (value: string) =>
    value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  // Validate company belongs to tenant
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId, deletedAt: null },
  });

  if (!company) {
    throw new Error('Company not found');
  }

  // Get company-level contact details (directly linked to company, not via contact)
  const companyDetails = await prisma.contactDetail.findMany({
    where: {
      tenantId,
      companyId,
      contactId: null, // Only company-level details
      deletedAt: null,
    },
    orderBy: [
      { detailType: 'asc' },
      { displayOrder: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  // Get all contacts linked to this company (via CompanyContact, officers, shareholders)
  // For officers, exclude those with cessation dates (ceased officers)
  const linkedContacts = await prisma.contact.findMany({
    where: {
      tenantId,
      deletedAt: null,
      OR: [
        { companyRelations: { some: { companyId, deletedAt: null } } },
        { officerPositions: { some: { companyId } } },
        { shareholdings: { some: { companyId } } },
      ],
    },
    include: {
      companyRelations: {
        where: { companyId, deletedAt: null },
        select: { id: true, relationship: true, isPoc: true },
      },
      officerPositions: {
        where: { companyId },
        select: { role: true, isCurrent: true, cessationDate: true },
      },
      shareholdings: {
        where: { companyId },
        select: { shareClass: true, isCurrent: true },
      },
      contactDetails: {
        where: { deletedAt: null },
        orderBy: [
          { detailType: 'asc' },
          { displayOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      },
    },
  });

  // Format contact details with relationships and company-specific POC status
  const contactDetails = linkedContacts.map((contact) => {
    const currentOfficerPositions = contact.officerPositions.filter(
      (pos) => pos.isCurrent && !pos.cessationDate
    );
    const pastOfficerPositions = contact.officerPositions.filter(
      (pos) => !pos.isCurrent || pos.cessationDate
    );
    const currentShareholdings = contact.shareholdings.filter((sh) => sh.isCurrent);
    const pastShareholdings = contact.shareholdings.filter((sh) => !sh.isCurrent);

    const officerRoleSet = new Set(contact.officerPositions.map((pos) => normalizeRelationship(pos.role)));
    const shareholderRoleSet = new Set(
      contact.shareholdings.map((sh) => normalizeRelationship(`${sh.shareClass ?? 'Ordinary'} Shareholder`))
    );
    shareholderRoleSet.add('shareholder');

    const isPositionRelation = (relationship: string) => {
      const normalized = normalizeRelationship(relationship);
      return officerRoleSet.has(normalized) || shareholderRoleSet.has(normalized);
    };

    const hasActiveNonPositionRelation = contact.companyRelations.some(
      (rel) => rel.relationship && !isPositionRelation(rel.relationship)
    );

    const hasActiveRelationship =
      hasActiveNonPositionRelation ||
      currentOfficerPositions.length > 0 ||
      currentShareholdings.length > 0;

    // Determine the relationship
    const relationships: string[] = [];
    contact.companyRelations.forEach((r) => relationships.push(r.relationship));
    if (hasActiveRelationship) {
      currentOfficerPositions.forEach((o) => relationships.push(o.role));
      currentShareholdings.forEach((s) => relationships.push(`${s.shareClass ?? 'Ordinary'} Shareholder`));
    } else {
      pastOfficerPositions.forEach((o) => relationships.push(o.role));
      pastShareholdings.forEach((s) => relationships.push(`${s.shareClass ?? 'Ordinary'} Shareholder`));
    }

    // Get POC status from CompanyContact (company-specific)
    const isPoc = contact.companyRelations.some((r) => r.isPoc);

    return {
      contact: {
        id: contact.id,
        fullName: contact.fullName,
        contactType: contact.contactType,
        relationship: relationships.join(', ') || undefined,
      },
      details: contact.contactDetails as ContactDetailWithRelations[],
      isPoc,
      isCurrent: hasActiveRelationship,
    };
  });

  // Check if any linked contact is marked as POC for this company
  const hasPoc = contactDetails.some((c) => c.isPoc);

  return {
    companyDetails: companyDetails as ContactDetailWithRelations[],
    contactDetails,
    hasPoc,
  };
}

/**
 * Toggle POC status for a contact linked to a company
 * This sets isPoc on the CompanyContact relationship
 * If the contact is linked via Officer/Shareholder but no CompanyContact exists,
 * a CompanyContact entry will be created with relationship "Point of Contact"
 */
export async function toggleContactPoc(
  companyId: string,
  contactId: string,
  isPoc: boolean,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId, tx } = params;
  const db = tx || prisma;

  const syncCompanyHasPoc = async () => {
    const pocCount = await db.companyContact.count({
      where: { companyId, isPoc: true, deletedAt: null },
    });
    await db.company.update({
      where: { id: companyId },
      data: { hasPoc: pocCount > 0 },
    });
  };

  // Validate company belongs to tenant
  const company = await db.company.findFirst({
    where: { id: companyId, tenantId, deletedAt: null },
  });

  if (!company) {
    throw new Error('Company not found');
  }

  // Get the contact info
  const contact = await db.contact.findFirst({
    where: { id: contactId, tenantId, deletedAt: null },
    select: { fullName: true },
  });

  if (!contact) {
    throw new Error('Contact not found');
  }

  // Find all CompanyContact relationships for this contact + company
  const companyContacts = await db.companyContact.findMany({
    where: {
      companyId,
      contactId,
      deletedAt: null,
    },
    select: { id: true, relationship: true },
  });

  // If no CompanyContact exists, verify the contact is linked via other means
  // (officer or shareholder), then create a CompanyContact for POC tracking
  // Only create when setting POC to true; if turning off, there's nothing to clear.
  if (companyContacts.length === 0) {
    if (!isPoc) {
      return;
    }
    const hasOfficerRole = await db.companyOfficer.findFirst({
      where: { companyId, contactId, isCurrent: true, cessationDate: null },
    });
    const hasShareholding = await db.companyShareholder.findFirst({
      where: { companyId, contactId, isCurrent: true },
    });

    if (!hasOfficerRole && !hasShareholding) {
      throw new Error('Contact is not linked to this company');
    }

    // Create a CompanyContact entry for POC tracking
    const companyContact = await db.companyContact.create({
      data: {
        companyId,
        contactId,
        relationship: 'Point of Contact',
        isPoc: true,
      },
    });
    // Create audit log for creation + POC set
    await createAuditLog({
      tenantId,
      userId,
      companyId,
      action: 'UPDATE',
      entityType: 'CompanyContact',
      entityId: companyContact.id,
      entityName: contact.fullName || 'Contact',
      summary: `Set ${contact.fullName} as Point of Contact`,
      changeSource: 'MANUAL',
      metadata: { isPoc, contactId },
    }, tx as Prisma.TransactionClient | undefined);
    await syncCompanyHasPoc();
    return;
  }

  // Update all CompanyContact rows for this contact + company to keep POC consistent
  await db.companyContact.updateMany({
    where: { companyId, contactId, deletedAt: null },
    data: { isPoc },
  });

  // Create audit log
  const auditEntity = companyContacts.find((rel) => rel.relationship === 'Point of Contact') ?? companyContacts[0];
  await createAuditLog({
    tenantId,
    userId,
    companyId,
    action: 'UPDATE',
    entityType: 'CompanyContact',
    entityId: auditEntity.id,
    entityName: contact.fullName || 'Contact',
    summary: isPoc
      ? `Set ${contact.fullName} as Point of Contact`
      : `Removed ${contact.fullName} as Point of Contact`,
    changeSource: 'MANUAL',
    metadata: { isPoc, contactId },
  }, tx as Prisma.TransactionClient | undefined);
  await syncCompanyHasPoc();
}

/**
 * Get contact details for a specific contact
 */
export async function getContactDetails(
  contactId: string,
  tenantId: string
): Promise<ContactDetailWithRelations[]> {
  // Validate contact belongs to tenant
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId, deletedAt: null },
  });

  if (!contact) {
    throw new Error('Contact not found');
  }

  const details = await prisma.contactDetail.findMany({
    where: {
      tenantId,
      contactId,
      deletedAt: null,
    },
    orderBy: [
      { detailType: 'asc' },
      { displayOrder: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  return details as ContactDetailWithRelations[];
}

/**
 * Get contact details for a contact, grouped by company
 * Returns default details (not company-specific) and company-specific details
 */
export async function getContactDetailsGrouped(
  contactId: string,
  tenantId: string
): Promise<{
  defaultDetails: ContactDetailWithRelations[];
  companyDetails: Array<{
    companyId: string;
    companyName: string;
    companyUen: string;
    details: ContactDetailWithRelations[];
  }>;
}> {
  // Validate contact belongs to tenant
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId, deletedAt: null },
  });

  if (!contact) {
    throw new Error('Contact not found');
  }

  // Get all contact details for this contact
  const details = await prisma.contactDetail.findMany({
    where: {
      tenantId,
      contactId,
      deletedAt: null,
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          uen: true,
        },
      },
    },
    orderBy: [
      { detailType: 'asc' },
      { displayOrder: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  // Separate default details (no companyId) from company-specific details
  const defaultDetails: ContactDetailWithRelations[] = [];
  const companyDetailsMap = new Map<string, {
    companyId: string;
    companyName: string;
    companyUen: string;
    details: ContactDetailWithRelations[];
  }>();

  for (const detail of details) {
    if (!detail.companyId) {
      // Default detail (contact-only, no company)
      defaultDetails.push(detail as ContactDetailWithRelations);
    } else if (detail.company) {
      // Company-specific detail
      if (!companyDetailsMap.has(detail.companyId)) {
        companyDetailsMap.set(detail.companyId, {
          companyId: detail.company.id,
          companyName: detail.company.name,
          companyUen: detail.company.uen,
          details: [],
        });
      }
      companyDetailsMap.get(detail.companyId)!.details.push(detail as ContactDetailWithRelations);
    }
  }

  return {
    defaultDetails,
    companyDetails: Array.from(companyDetailsMap.values()),
  };
}

/**
 * Get a single contact detail by ID
 */
export async function getContactDetailById(
  id: string,
  tenantId: string
): Promise<ContactDetailWithRelations | null> {
  return prisma.contactDetail.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      contact: {
        select: {
          id: true,
          fullName: true,
          contactType: true,
        },
      },
      company: {
        select: {
          id: true,
          name: true,
          uen: true,
        },
      },
    },
  });
}

// ============================================================================
// EXPORT OPERATIONS
// ============================================================================

export interface ExportContactDetail {
  companyName: string;
  companyUen: string;
  contactName: string | null;
  relationship: string | null;
  isPoc: boolean;
  detailType: string;
  value: string;
  label: string | null;
  purposes: string[];
}

/**
 * Format relationship/role to proper case with special handling for acronyms
 * E.g., "MANAGING_DIRECTOR" -> "Managing Director", "CEO" -> "CEO", "ORDINARY" -> "Ordinary"
 */
function formatRole(role: string): string {
  // List of acronyms that should stay uppercase
  const acronyms = ['CEO', 'CFO', 'COO', 'CTO', 'CIO'];

  return role
    .split('_')
    .map(word => {
      const upper = word.toUpperCase();
      if (acronyms.includes(upper)) {
        return upper;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Get all contact details for export for multiple companies
 */
export async function getContactDetailsForExport(
  companyIds: string[],
  tenantId: string
): Promise<ExportContactDetail[]> {
  // Get all companies with their contact details
  const companies = await prisma.company.findMany({
    where: {
      id: { in: companyIds },
      tenantId,
      deletedAt: null,
    },
    include: {
      // Company-level contact details
      contactDetails: {
        where: { deletedAt: null, contactId: null },
        orderBy: [{ detailType: 'asc' }, { displayOrder: 'asc' }],
      },
      // Linked contacts via CompanyContact
      contacts: {
        where: { deletedAt: null },
        include: {
          contact: {
            include: {
              contactDetails: {
                where: { deletedAt: null },
                orderBy: [{ detailType: 'asc' }, { displayOrder: 'asc' }],
              },
            },
          },
        },
      },
      // Officers (exclude those with cessation dates)
      officers: {
        where: { isCurrent: true, cessationDate: null },
        include: {
          contact: {
            include: {
              contactDetails: {
                where: { deletedAt: null },
                orderBy: [{ detailType: 'asc' }, { displayOrder: 'asc' }],
              },
            },
          },
        },
      },
      // Shareholders
      shareholders: {
        where: { isCurrent: true },
        include: {
          contact: {
            include: {
              contactDetails: {
                where: { deletedAt: null },
                orderBy: [{ detailType: 'asc' }, { displayOrder: 'asc' }],
              },
            },
          },
        },
      },
    },
  });

  const exportDetails: ExportContactDetail[] = [];

  for (const company of companies) {
    // Add company-level contact details
    for (const detail of company.contactDetails) {
      exportDetails.push({
        companyName: company.name,
        companyUen: company.uen,
        contactName: null,
        relationship: null,
        isPoc: false,
        detailType: detail.detailType,
        value: detail.value,
        label: detail.label,
        purposes: detail.purposes,
      });
    }

    // Track processed contacts to avoid duplicates
    const processedContactIds = new Set<string>();

    // Add contact details from CompanyContact relations
    // Note: A contact can have multiple relationships to the same company
    for (const rel of company.contacts) {
      if (!rel.contact) continue;

      const relationship = formatRole(rel.relationship);

      // Add all contact details from ContactDetail records
      for (const detail of rel.contact.contactDetails) {
        exportDetails.push({
          companyName: company.name,
          companyUen: company.uen,
          contactName: rel.contact.fullName,
          relationship,
          isPoc: rel.isPoc,
          detailType: detail.detailType,
          value: detail.value,
          label: detail.label,
          purposes: detail.purposes,
        });
      }

      // Track processed contact+relationship combinations
      processedContactIds.add(`${rel.contact.id}-${rel.relationship}`);
    }

    // Add contact details from officers
    for (const officer of company.officers) {
      if (!officer.contact) continue;
      // Skip if already processed with this role via CompanyContact
      const roleKey = `${officer.contact.id}-${officer.role}`;
      if (processedContactIds.has(roleKey)) continue;
      processedContactIds.add(roleKey);

      const relationship = formatRole(officer.role);

      for (const detail of officer.contact.contactDetails) {
        exportDetails.push({
          companyName: company.name,
          companyUen: company.uen,
          contactName: officer.contact.fullName,
          relationship,
          isPoc: false,
          detailType: detail.detailType,
          value: detail.value,
          label: detail.label,
          purposes: detail.purposes,
        });
      }
    }

    // Add contact details from shareholders
    for (const shareholder of company.shareholders) {
      if (!shareholder.contact) continue;
      // Skip if already processed with this share class via CompanyContact
      const shareKey = `${shareholder.contact.id}-${shareholder.shareClass || 'Ordinary'}_SHAREHOLDER`;
      if (processedContactIds.has(shareKey)) continue;
      processedContactIds.add(shareKey);

      // Format share class properly (e.g., "ORDINARY" -> "Ordinary")
      const shareClass = formatRole(shareholder.shareClass || 'Ordinary');
      const relationship = `${shareClass} Shareholder`;

      for (const detail of shareholder.contact.contactDetails) {
        exportDetails.push({
          companyName: company.name,
          companyUen: company.uen,
          contactName: shareholder.contact.fullName,
          relationship,
          isPoc: false,
          detailType: detail.detailType,
          value: detail.value,
          label: detail.label,
          purposes: detail.purposes,
        });
      }
    }
  }

  return exportDetails;
}

// ============================================================================
// AUTOMATION HELPERS
// ============================================================================

/**
 * Get contact details for a company filtered by purpose
 * Used for automation to find the right contact for specific purposes (e.g., invoicing)
 */
export async function getContactDetailsByPurpose(
  companyId: string,
  purpose: string,
  tenantId: string
): Promise<ContactDetailWithRelations[]> {
  // Get all contact details for this company (both company-level and contact-level)
  const { companyDetails, contactDetails } = await getCompanyContactDetails(companyId, tenantId);

  // Filter by purpose
  const matchingDetails: ContactDetailWithRelations[] = [];

  // Check company-level details
  for (const detail of companyDetails) {
    if (detail.purposes.includes(purpose)) {
      matchingDetails.push(detail);
    }
  }

  // Check contact-level details
  for (const contactData of contactDetails) {
    for (const detail of contactData.details) {
      if (detail.purposes.includes(purpose)) {
        // Attach contact info to the detail for context
        matchingDetails.push({
          ...detail,
          contact: {
            id: contactData.contact.id,
            fullName: contactData.contact.fullName,
            contactType: contactData.contact.contactType,
          },
        });
      }
    }
  }

  // Sort by isPrimary (primary first), then by displayOrder
  matchingDetails.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.displayOrder - b.displayOrder;
  });

  return matchingDetails;
}

/**
 * Get the primary contact detail for a specific purpose and type
 * Returns the first matching detail (prioritized by isPrimary, then displayOrder)
 */
export async function getPrimaryContactForPurpose(
  companyId: string,
  purpose: string,
  detailType: ContactDetailType,
  tenantId: string
): Promise<ContactDetailWithRelations | null> {
  const matchingDetails = await getContactDetailsByPurpose(companyId, purpose, tenantId);

  // Filter by type and return the first match
  const filtered = matchingDetails.filter((d) => d.detailType === detailType);
  return filtered[0] || null;
}
