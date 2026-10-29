/**
 * Company Service
 *
 * Business logic for company management including CRUD operations,
 * search, and statistics. Fully integrated with multi-tenancy support.
 */

import { prisma } from '@/lib/prisma';
import { createAuditLog, computeChanges } from '@/lib/audit';
import { canAddCompany, assertWorkspaceOwned } from '@/lib/workspace';
import { NotFoundError, ValidationError } from '@/lib/errors';
import type {
  CreateCompanyInput,
  CreateCompanyRequestInput,
  UpdateCompanyInput,
  CompanySearchInput,
} from '@/lib/validations/company';
import { mutateCompanyProfileSection } from '@/services/company/profile-sections';
import { COMPANY_PROFILE_SECTIONS } from '@/lib/company-profile-sections';
import { Prisma } from '@/generated/prisma';
import { clearDuplicateReferencesToDocument } from '@/services/duplicate-detection.service';
import type { Company } from '@/generated/prisma';
import type { TenantAwareParams } from '@/lib/types';
import type { TaskLaunchContext } from '@/services/tasks/types';
import { normalizeCompanyAlias } from '@/lib/company-display-label';
import { enqueueScheduleReconciliation } from '@/services/schedule-reconciliation';
import {
  safelyCaptureCompanyTaskStageIds,
  safelyReconcileCompanyTaskOutcomes,
  safelyReconcileTaskStageIds,
} from '@/services/tasks/integration.service';

type Decimal = Prisma.Decimal;

// ============================================================================
// Types
// ============================================================================

export interface CompanyWithRelations extends Company {
  sharePointFolderMapping?: {
    id: string;
    companyId: string;
    connectorId: string;
    driveId: string;
    folderItemId: string;
    folderName: string;
    folderWebUrl: string;
    lastVerifiedAt: Date | null;
  } | null;
  /** Optional user-facing label; null means derive initials from the legal name. */
  displayAlias: string | null;
  addresses?: Array<{
    id: string;
    addressType: string;
    fullAddress: string;
    isCurrent: boolean;
    effectiveFrom?: Date | null;
  }>;
  officers?: Array<{
    id: string;
    name: string;
    role: string;
    nationality?: string | null;
    address?: string | null;
    appointmentDate?: Date | null;
    cessationDate?: Date | null;
    isCurrent: boolean;
    contactId?: string | null;
    contact?: {
      id: string;
      email?: string | null;
      phone?: string | null;
    } | null;
  }>;
  shareholders?: Array<{
    id: string;
    name: string;
    shareholderType?: string | null;
    isNominee?: boolean;
    nationality?: string | null;
    placeOfOrigin?: string | null;
    address?: string | null;
    shareClass?: string | null;
    numberOfShares: number;
    percentageHeld: Decimal | null;
    currency?: string | null;
    allotmentDate?: Date | null;
    isCurrent: boolean;
    contactId?: string | null;
    contact?: {
      id: string;
      email?: string | null;
      phone?: string | null;
    } | null;
  }>;
  charges?: Array<{
    id: string;
    chargeNumber?: string | null;
    chargeType?: string | null;
    description?: string | null;
    chargeHolderName: string;
    amountSecured?: Decimal | null;
    amountSecuredText?: string | null;
    currency?: string | null;
    registrationDate?: Date | null;
    dischargeDate?: Date | null;
    isFullyDischarged: boolean;
  }>;
  auditor?: {
    name: string;
    address?: string | null;
    appointmentDate?: Date | null;
  } | null;
  _count?: {
    documents: number;
    officers: number;
    shareholders: number;
    charges: number;
  };
  /** Whether any linked contact is marked as Point of Contact */
  hasPoc: boolean;
  /** ACRA registry record (from the local data.gov.sg sync) for the company UEN. */
  acraRecord?: {
    /** Data-as-of timestamp of the synced ACRA collection. */
    dataAsOf: string;
    accountDueDate: string | null;
    annualReturnDate: string | null;
  } | null;
}

// Re-export shared type for backwards compatibility
export type { TenantAwareParams } from '@/lib/types';

// Fields tracked for audit logging
const TRACKED_FIELDS: (keyof Company)[] = [
  'name',
  'displayAlias',
  'formerName',
  'dateOfNameChange',
  'uen',
  'entityType',
  'status',
  'statusDate',
  'incorporationDate',
  'dateOfAddress',
  'primarySsicCode',
  'primarySsicDescription',
  'secondarySsicCode',
  'secondarySsicDescription',
  'financialYearEndDay',
  'financialYearEndMonth',
  'fyeAsAtLastAr',
  'lastAgmDate',
  'lastArFiledDate',
  'accountsDueDate',
  'homeCurrency',
  'paidUpCapitalAmount',
  'issuedCapitalAmount',
  'isGstRegistered',
  'gstRegistrationNumber',
];

// Shared relation select used when loading a child entity (officer, shareholder,
// charge, etc.) together with the minimal company fields needed for tenant
// authorization checks and audit-log metadata.
const COMPANY_SCOPE_INCLUDE = {
  company: { select: { id: true, tenantId: true, name: true, displayAlias: true } },
} as const;

/**
 * Normalize a stored alias at service boundaries while preserving every DTO
 * field returned by Prisma. Legacy rows may contain surrounding whitespace.
 */
function serializeCompany<T extends { displayAlias?: string | null }>(company: T): T {
  if (!Object.prototype.hasOwnProperty.call(company, 'displayAlias')) return company;
  return { ...company, displayAlias: normalizeCompanyAlias(company.displayAlias) };
}

function dateKey(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function scheduleSourceChanged(data: UpdateCompanyInput, existing: Company): boolean {
  const scalarChanged = (key: keyof UpdateCompanyInput, existingKey: keyof Company = key as keyof Company) =>
    data[key] !== undefined && data[key] !== existing[existingKey];
  const dateChanged = (key: keyof UpdateCompanyInput, existingKey: keyof Company) =>
    data[key] !== undefined && dateKey(data[key]) !== dateKey(existing[existingKey]);

  return scalarChanged('entityType')
    || scalarChanged('financialYearEndDay')
    || scalarChanged('financialYearEndMonth')
    || dateChanged('accountsDueDate', 'accountsDueDate')
    || dateChanged('incorporationDate', 'incorporationDate');
}

// ============================================================================
// Create Company
// ============================================================================

export async function createCompany(
  data: CreateCompanyInput | CreateCompanyRequestInput,
  params: TenantAwareParams,
  taskIntegrationContext?: TaskLaunchContext,
): Promise<Company> {
  const { tenantId, userId } = params;

  // Check tenant company limit
  const canAdd = await canAddCompany(tenantId);
  if (!canAdd) {
    throw new Error('Tenant has reached the maximum number of companies');
  }

  // Check UEN uniqueness within tenant
  const existingUen = await prisma.company.findFirst({
    where: { tenantId, uen: data.uen.toUpperCase(), deletedAt: null },
  });

  if (existingUen) {
    throw new Error('A company with this UEN already exists');
  }

  // Validate financial year fields if provided
  if (data.financialYearEndMonth !== undefined && data.financialYearEndMonth !== null) {
    if (data.financialYearEndMonth < 1 || data.financialYearEndMonth > 12) {
      throw new Error('Financial year end month must be between 1 and 12');
    }
  }
  if (data.financialYearEndDay !== undefined && data.financialYearEndDay !== null) {
    const month = data.financialYearEndMonth;
    const day = data.financialYearEndDay;

    // Get max days for the month (if month is provided)
    let maxDays = 31;
    if (month !== undefined && month !== null) {
      // Months with 30 days: April (4), June (6), September (9), November (11)
      if ([4, 6, 9, 11].includes(month)) {
        maxDays = 30;
      }
      // February: allow up to 29 (for leap years)
      else if (month === 2) {
        maxDays = 29;
      }
    }

    if (day < 1 || day > maxDays) {
      throw new Error(`Financial year end day must be between 1 and ${maxDays} for the selected month`);
    }
  }

  const companyData: Prisma.CompanyUncheckedCreateInput = {
      tenantId,
      uen: data.uen.toUpperCase(),
      name: data.name,
      displayAlias: normalizeCompanyAlias(data.displayAlias),
      formerName: data.formerName,
      dateOfNameChange: data.dateOfNameChange ? new Date(data.dateOfNameChange) : null,
      entityType: data.entityType,
      status: data.status,
      statusDate: data.statusDate ? new Date(data.statusDate) : null,
      incorporationDate: data.incorporationDate ? new Date(data.incorporationDate) : null,
      registrationDate: data.registrationDate ? new Date(data.registrationDate) : null,
      dateOfAddress: data.dateOfAddress ? new Date(data.dateOfAddress) : null,
      primarySsicCode: data.primarySsicCode,
      primarySsicDescription: data.primarySsicDescription,
      secondarySsicCode: data.secondarySsicCode,
      secondarySsicDescription: data.secondarySsicDescription,
      financialYearEndDay: data.financialYearEndDay,
      financialYearEndMonth: data.financialYearEndMonth,
      fyeAsAtLastAr: data.fyeAsAtLastAr ? new Date(data.fyeAsAtLastAr) : null,
      lastAgmDate: data.lastAgmDate ? new Date(data.lastAgmDate) : null,
      lastArFiledDate: data.lastArFiledDate ? new Date(data.lastArFiledDate) : null,
      accountsDueDate: data.accountsDueDate ? new Date(data.accountsDueDate) : null,
      homeCurrency: data.homeCurrency,
      paidUpCapitalCurrency: data.paidUpCapitalCurrency,
      paidUpCapitalAmount: data.paidUpCapitalAmount,
      issuedCapitalCurrency: data.issuedCapitalCurrency,
      issuedCapitalAmount: data.issuedCapitalAmount,
      isGstRegistered: data.isGstRegistered,
      gstRegistrationNumber: data.gstRegistrationNumber,
      gstRegistrationDate: data.gstRegistrationDate ? new Date(data.gstRegistrationDate) : null,
      taskIntegrationContext: taskIntegrationContext
        ? {
          taskId: taskIntegrationContext.taskId,
          taskStageId: taskIntegrationContext.taskStageId,
          ...(taskIntegrationContext.returnTo
            ? { returnTo: taskIntegrationContext.returnTo }
            : {}),
        }
        : undefined,
  };

  const profileSections = 'profileSections' in data ? data.profileSections : undefined;
  const company = profileSections
    ? await prisma.$transaction(async (tx) => {
      const created = await tx.company.create({ data: companyData });
      for (const section of COMPANY_PROFILE_SECTIONS) {
        await mutateCompanyProfileSection(tx, created.id, section, profileSections[section]);
      }
      return tx.company.findUniqueOrThrow({ where: { id: created.id } });
    })
    : await prisma.company.create({ data: companyData });

  await createAuditLog({
    tenantId,
    userId,
    companyId: company.id,
    action: 'CREATE',
    entityType: 'Company',
    entityId: company.id,
    entityName: company.name,
    summary: `Created company "${company.name}" (UEN: ${company.uen})`,
    changeSource: 'MANUAL',
    metadata: { uen: company.uen, name: company.name },
  });
  await safelyReconcileCompanyTaskOutcomes(tenantId, company.id, userId);

  return serializeCompany(company);
}

// ============================================================================
// Update Company
// ============================================================================

export async function updateCompany(
  data: UpdateCompanyInput,
  params: TenantAwareParams,
  reason?: string
): Promise<Company> {
  const { tenantId, userId } = params;

  const existing = await prisma.company.findFirst({
    where: { id: data.id, tenantId, deletedAt: null },
  });

  if (!existing) {
    throw new Error('Company not found');
  }

  // Check UEN uniqueness if being changed
  if (data.uen && data.uen.toUpperCase() !== existing.uen) {
    const existingUen = await prisma.company.findFirst({
      where: {
        tenantId,
        uen: data.uen.toUpperCase(),
        deletedAt: null,
        NOT: { id: data.id },
      },
    });

    if (existingUen) {
      throw new Error('A company with this UEN already exists');
    }
  }

  // Validate financial year fields if provided
  const fyMonth = data.financialYearEndMonth !== undefined ? data.financialYearEndMonth : existing.financialYearEndMonth;
  const fyDay = data.financialYearEndDay !== undefined ? data.financialYearEndDay : existing.financialYearEndDay;

  if (fyMonth !== undefined && fyMonth !== null) {
    if (fyMonth < 1 || fyMonth > 12) {
      throw new Error('Financial year end month must be between 1 and 12');
    }
  }
  if (fyDay !== undefined && fyDay !== null) {
    let maxDays = 31;
    if (fyMonth !== undefined && fyMonth !== null) {
      if ([4, 6, 9, 11].includes(fyMonth)) {
        maxDays = 30;
      } else if (fyMonth === 2) {
        maxDays = 29;
      }
    }
    if (fyDay < 1 || fyDay > maxDays) {
      throw new Error(`Financial year end day must be between 1 and ${maxDays} for the selected month`);
    }
  }

  const updateData: Prisma.CompanyUpdateInput = {};

  if (data.uen !== undefined) updateData.uen = data.uen.toUpperCase();
  if (data.name !== undefined) updateData.name = data.name;
  if (data.displayAlias !== undefined) updateData.displayAlias = normalizeCompanyAlias(data.displayAlias);
  if (data.formerName !== undefined) updateData.formerName = data.formerName;
  if (data.dateOfNameChange !== undefined)
    updateData.dateOfNameChange = data.dateOfNameChange ? new Date(data.dateOfNameChange) : null;
  if (data.entityType !== undefined) updateData.entityType = data.entityType;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.statusDate !== undefined)
    updateData.statusDate = data.statusDate ? new Date(data.statusDate) : null;
  if (data.incorporationDate !== undefined)
    updateData.incorporationDate = data.incorporationDate ? new Date(data.incorporationDate) : null;
  if (data.registrationDate !== undefined)
    updateData.registrationDate = data.registrationDate ? new Date(data.registrationDate) : null;
  if (data.dateOfAddress !== undefined)
    updateData.dateOfAddress = data.dateOfAddress ? new Date(data.dateOfAddress) : null;
  if (data.primarySsicCode !== undefined) updateData.primarySsicCode = data.primarySsicCode;
  if (data.primarySsicDescription !== undefined)
    updateData.primarySsicDescription = data.primarySsicDescription;
  if (data.secondarySsicCode !== undefined) updateData.secondarySsicCode = data.secondarySsicCode;
  if (data.secondarySsicDescription !== undefined)
    updateData.secondarySsicDescription = data.secondarySsicDescription;
  if (data.financialYearEndDay !== undefined)
    updateData.financialYearEndDay = data.financialYearEndDay;
  if (data.financialYearEndMonth !== undefined)
    updateData.financialYearEndMonth = data.financialYearEndMonth;
  if (data.fyeAsAtLastAr !== undefined)
    updateData.fyeAsAtLastAr = data.fyeAsAtLastAr ? new Date(data.fyeAsAtLastAr) : null;
  if (data.lastAgmDate !== undefined)
    updateData.lastAgmDate = data.lastAgmDate ? new Date(data.lastAgmDate) : null;
  if (data.lastArFiledDate !== undefined)
    updateData.lastArFiledDate = data.lastArFiledDate ? new Date(data.lastArFiledDate) : null;
  if (data.accountsDueDate !== undefined)
    updateData.accountsDueDate = data.accountsDueDate ? new Date(data.accountsDueDate) : null;
  if (data.homeCurrency !== undefined) updateData.homeCurrency = data.homeCurrency;
  if (data.paidUpCapitalCurrency !== undefined)
    updateData.paidUpCapitalCurrency = data.paidUpCapitalCurrency;
  if (data.paidUpCapitalAmount !== undefined)
    updateData.paidUpCapitalAmount = data.paidUpCapitalAmount;
  if (data.issuedCapitalCurrency !== undefined)
    updateData.issuedCapitalCurrency = data.issuedCapitalCurrency;
  if (data.issuedCapitalAmount !== undefined)
    updateData.issuedCapitalAmount = data.issuedCapitalAmount;
  if (data.isGstRegistered !== undefined) updateData.isGstRegistered = data.isGstRegistered;
  if (data.gstRegistrationNumber !== undefined)
    updateData.gstRegistrationNumber = data.gstRegistrationNumber;
  if (data.gstRegistrationDate !== undefined)
    updateData.gstRegistrationDate = data.gstRegistrationDate
      ? new Date(data.gstRegistrationDate)
      : null;

  // Handle registered address update within a transaction
  const company = await prisma.$transaction(async (tx) => {
    // Update company fields
    const updatedCompany = await tx.company.update({
      where: { id: data.id },
      data: updateData,
    });

    // Handle registered address update if provided
    if (data.registeredAddress) {
      const addr = data.registeredAddress;
      // Check if we have meaningful address data
      const hasAddressData = addr.streetName || addr.postalCode || addr.block || addr.buildingName;

      if (hasAddressData) {
        // Build full address string
        const addressParts: string[] = [];
        if (addr.block) addressParts.push(addr.block);
        if (addr.streetName) addressParts.push(addr.streetName);
        if (addr.level || addr.unit) {
          const levelUnit = [addr.level, addr.unit].filter(Boolean).join('-');
          if (levelUnit) addressParts.push(`#${levelUnit}`);
        }
        if (addr.buildingName) addressParts.push(addr.buildingName);
        if (addr.country || 'Singapore') addressParts.push(addr.country || 'Singapore');
        if (addr.postalCode) addressParts.push(addr.postalCode);
        const fullAddress = addressParts.join(' ');

        // Find current registered office address
        const currentAddress = await tx.companyAddress.findFirst({
          where: {
            companyId: data.id,
            addressType: 'REGISTERED_OFFICE',
            isCurrent: true,
          },
        });

        if (currentAddress) {
          // Update existing address
          const oldFullAddress = currentAddress.fullAddress;
          await tx.companyAddress.update({
            where: { id: currentAddress.id },
            data: {
              block: addr.block ?? currentAddress.block,
              streetName: addr.streetName ?? currentAddress.streetName,
              level: addr.level ?? currentAddress.level,
              unit: addr.unit ?? currentAddress.unit,
              buildingName: addr.buildingName ?? currentAddress.buildingName,
              postalCode: addr.postalCode ?? currentAddress.postalCode,
              country: addr.country ?? currentAddress.country,
              fullAddress,
            },
          });

          // Log address change
          if (oldFullAddress !== fullAddress) {
            await createAuditLog({
              tenantId,
              userId,
              companyId: updatedCompany.id,
              action: 'UPDATE',
              entityType: 'CompanyAddress',
              entityId: currentAddress.id,
              entityName: 'Registered Office',
              summary: `Updated registered office address for "${updatedCompany.name}"`,
              changeSource: 'MANUAL',
              changes: {
                fullAddress: { old: oldFullAddress, new: fullAddress },
              },
              reason,
            });
          }
        } else {
          // Create new address
          const newAddress = await tx.companyAddress.create({
            data: {
              companyId: data.id,
              addressType: 'REGISTERED_OFFICE',
              block: addr.block,
              streetName: addr.streetName || '',
              level: addr.level,
              unit: addr.unit,
              buildingName: addr.buildingName,
              postalCode: addr.postalCode || '',
              country: addr.country || 'Singapore',
              fullAddress,
              isCurrent: true,
              effectiveFrom: new Date(),
            },
          });

          // Log address creation
          await createAuditLog({
            tenantId,
            userId,
            companyId: updatedCompany.id,
            action: 'CREATE',
            entityType: 'CompanyAddress',
            entityId: newAddress.id,
            entityName: 'Registered Office',
            summary: `Added registered office address for "${updatedCompany.name}"`,
            changeSource: 'MANUAL',
            reason,
          });
        }
      }
    }

    if (scheduleSourceChanged(data, existing)) {
      await enqueueScheduleReconciliation(tx, {
        tenantId,
        scopeType: 'COMPANY',
        scopeId: updatedCompany.id,
        triggerType: 'COMPANY_SOURCE_CHANGED',
        correlationId: `company-update-${updatedCompany.id}-${Date.now()}`,
        requestedById: userId,
      });
    }

    return updatedCompany;
  });

  const auditData = data.displayAlias === undefined
    ? data
    : { ...data, displayAlias: normalizeCompanyAlias(data.displayAlias) };
  const changes = computeChanges(existing as Record<string, unknown>, auditData, TRACKED_FIELDS as string[]);

  if (changes) {
    const changedFields = Object.keys(changes).join(', ');
    await createAuditLog({
      tenantId,
      userId,
      companyId: company.id,
      action: 'UPDATE',
      entityType: 'Company',
      entityId: company.id,
      entityName: company.name,
      summary: `Updated company "${company.name}" (${changedFields})`,
      changeSource: 'MANUAL',
      changes,
      reason,
    });
  }

  return serializeCompany(company);
}

// ============================================================================
// Delete Company
// ============================================================================

export async function deleteCompany(
  id: string,
  params: TenantAwareParams,
  reason: string
): Promise<Company> {
  const { tenantId, userId } = params;

  const existing = await prisma.company.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new Error('Company not found');
  }

  if (existing.deletedAt) {
    throw new Error('Company is already deleted');
  }

  const company = await prisma.company.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedReason: reason,
    },
  });

  await createAuditLog({
    tenantId,
    userId,
    companyId: company.id,
    action: 'DELETE',
    entityType: 'Company',
    entityId: company.id,
    entityName: company.name,
    summary: `Deleted company "${company.name}" (UEN: ${company.uen})`,
    changeSource: 'MANUAL',
    reason,
    metadata: { uen: company.uen, name: company.name },
  });
  await safelyReconcileCompanyTaskOutcomes(tenantId, company.id, userId);

  return company;
}

// ============================================================================
// Restore Company
// ============================================================================

export async function restoreCompany(
  id: string,
  params: TenantAwareParams
): Promise<Company> {
  const { tenantId, userId } = params;

  const existing = await prisma.company.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new Error('Company not found');
  }

  if (!existing.deletedAt) {
    throw new Error('Company is not deleted');
  }

  const company = await prisma.company.update({
    where: { id },
    data: {
      deletedAt: null,
      deletedReason: null,
    },
  });

  await createAuditLog({
    tenantId,
    userId,
    companyId: company.id,
    action: 'RESTORE',
    entityType: 'Company',
    entityId: company.id,
    entityName: company.name,
    summary: `Restored company "${company.name}" (UEN: ${company.uen})`,
    changeSource: 'MANUAL',
    metadata: { uen: company.uen, name: company.name },
  });
  await safelyReconcileCompanyTaskOutcomes(tenantId, company.id, userId);

  return company;
}

// ============================================================================
// Permanent Delete Company (hard delete — only for soft-deleted companies)
// ============================================================================

export async function permanentDeleteCompany(
  id: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const existing = await prisma.company.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new Error('Company not found');
  }

  if (!existing.deletedAt) {
    throw new Error('Company must be soft-deleted before permanent deletion');
  }

  // Processing documents would otherwise survive with a nulled companyId and
  // become stuck in the Document Vault (visible, but no longer deletable via
  // company-scoped permissions). Soft-delete them so the vault stays clean.
  const processingDocumentsToArchive = await prisma.processingDocument.findMany({
    where: { document: { companyId: id } },
    select: { id: true },
  });

  const linkedTaskStageIds = await safelyCaptureCompanyTaskStageIds(tenantId, id);
  await prisma.$transaction(async (tx) => {
    await tx.companyCharge.deleteMany({ where: { companyId: id } });
    await tx.companyShareholder.deleteMany({ where: { companyId: id } });
    await tx.shareCapital.deleteMany({ where: { companyId: id } });
    await tx.companyOfficer.deleteMany({ where: { companyId: id } });
    await tx.companyAddress.deleteMany({ where: { companyId: id } });
    await tx.companyFormerName.deleteMany({ where: { companyId: id } });
    await tx.companyContact.deleteMany({ where: { companyId: id } });
    await tx.userCompanyAssignment.deleteMany({ where: { companyId: id } });
    await tx.userRoleAssignment.deleteMany({ where: { companyId: id } });
    if (processingDocumentsToArchive.length > 0) {
      await tx.processingDocument.updateMany({
        where: { id: { in: processingDocumentsToArchive.map((doc) => doc.id) } },
        data: {
          deletedAt: new Date(),
          deletedReason: 'COMPANY_PERMANENTLY_DELETED',
        },
      });
    }
    // AuditLog.companyId has no onDelete directive (defaults to Restrict).
    // Nullify the FK so the company row can be deleted; the audit history is
    // retained but the company reference is cleared.
    await tx.auditLog.updateMany({
      where: { companyId: id },
      data: { companyId: null },
    });
    // ChartOfAccount.companyId has no onDelete directive (defaults to Restrict).
    // Nullify the FK so the company row can be deleted; account definitions are
    // retained but unlinked from this company.
    await tx.chartOfAccount.updateMany({
      where: { companyId: id },
      data: { companyId: null },
    });
    // Documents and GeneratedDocuments linked to this company become unlinked
    // (not deleted). GeneratedDocument.companyId has no onDelete directive
    // (defaults to Restrict) so must be nullified before company.delete.
    await tx.document.updateMany({
      where: { companyId: id },
      data: { companyId: null },
    });
    await tx.generatedDocument.updateMany({
      where: { companyId: id },
      data: { companyId: null },
    });
    await tx.company.delete({ where: { id } });
  });

  for (const procDoc of processingDocumentsToArchive) {
    await clearDuplicateReferencesToDocument(procDoc.id);
  }

  // Audit log is written AFTER the transaction succeeds so there is no dangling
  // audit record if the transaction rolls back.
  await createAuditLog({
    tenantId,
    userId,
    companyId: undefined,
    action: 'DELETE',
    entityType: 'Company',
    entityId: existing.id,
    entityName: existing.name,
    summary: `Permanently deleted company "${existing.name}" (UEN: ${existing.uen})`,
    changeSource: 'MANUAL',
    reason: 'Permanent deletion to allow re-creation via BizFile upload',
    metadata: { uen: existing.uen, name: existing.name, permanent: true },
  });
  await safelyReconcileTaskStageIds(tenantId, linkedTaskStageIds, userId);
}

// ============================================================================
// Get Company
// ============================================================================

export interface GetCompanyOptions {
  includeDeleted?: boolean;
  /**
   * Skip tenant filtering - ONLY use for SUPER_ADMIN operations that need
   * cross-tenant access. Regular operations MUST always provide tenantId.
   */
  skipTenantFilter?: boolean;
}

export async function getCompanyById(
  id: string,
  tenantId: string | null,
  options: GetCompanyOptions = {}
): Promise<CompanyWithRelations | null> {
  const { includeDeleted = false, skipTenantFilter = false } = options;

  // Require tenantId unless explicitly skipping for SUPER_ADMIN
  if (!tenantId && !skipTenantFilter) {
    throw new Error('Workspace context is required for company queries');
  }

  const where: Prisma.CompanyWhereInput = { id };

  if (tenantId && !skipTenantFilter) {
    where.tenantId = tenantId;
  }

  if (!includeDeleted) {
    where.deletedAt = null;
  }

  const company = await prisma.company.findFirst({
    where,
    include: {
      // The first confirmed financial period (it may run over 12 months).
      financialPeriods: {
        where: { provenance: 'CONFIRMED' },
        orderBy: { periodEnd: 'asc' },
        take: 1,
        select: { periodStart: true, periodEnd: true, yearsOfAssessment: true },
      },
      addresses: {
        where: { isCurrent: true },
        select: {
          id: true,
          addressType: true,
          block: true,
          streetName: true,
          level: true,
          unit: true,
          buildingName: true,
          postalCode: true,
          country: true,
          fullAddress: true,
          isCurrent: true,
          effectiveFrom: true,
        },
      },
      officers: {
        where: { isCurrent: true },
        select: {
          id: true,
          name: true,
          role: true,
          identificationType: true,
          identificationNumber: true,
          nationality: true,
          address: true,
          appointmentDate: true,
          cessationDate: true,
          isCurrent: true,
          contactId: true,
          contact: {
            select: {
              id: true,
              fullName: true,
              nationality: true,
              fullAddress: true,
              identificationType: true,
              identificationNumber: true,
            },
          },
        },
        orderBy: { appointmentDate: 'desc' },
      },
      shareholders: {
        where: { isCurrent: true },
        select: {
          id: true,
          name: true,
          shareholderType: true,
          isNominee: true,
          identificationType: true,
          identificationNumber: true,
          nationality: true,
          placeOfOrigin: true,
          address: true,
          shareClass: true,
          numberOfShares: true,
          percentageHeld: true,
          currency: true,
          allotmentDate: true,
          isCurrent: true,
          contactId: true,
          contact: {
            select: {
              id: true,
              fullName: true,
              nationality: true,
              fullAddress: true,
              identificationType: true,
              identificationNumber: true,
              contactType: true,
              corporateUen: true,
            },
          },
        },
        orderBy: { numberOfShares: 'desc' },
      },
      auditor: { select: { name: true, address: true, appointmentDate: true } },
      charges: {
        where: { isFullyDischarged: false },
        select: {
          id: true,
          chargeNumber: true,
          chargeType: true,
          description: true,
          chargeHolderName: true,
          amountSecured: true,
          amountSecuredText: true,
          currency: true,
          registrationDate: true,
          dischargeDate: true,
          isFullyDischarged: true,
        },
        orderBy: { registrationDate: 'desc' },
      },
      _count: {
        select: {
          documents: true,
          officers: true,
          shareholders: true,
          charges: true,
        },
      },
    },
  });

  if (!company) return null;
  return attachAcraRecord(serializeCompany(company));
}

/**
 * Attach the locally synced ACRA registry record for the company UEN.
 * Failures (e.g., the acra_entity table not being provisioned yet) never
 * block company retrieval.
 */
async function attachAcraRecord<T extends { uen: string }>(
  company: T,
): Promise<T & { acraRecord?: CompanyWithRelations['acraRecord'] }> {
  if (!company.uen) return company;
  try {
    const acra = await prisma.acraEntity.findFirst({
      where: { uen: { equals: company.uen, mode: 'insensitive' } },
      select: { dataAsOf: true, accountDueDate: true, annualReturnDate: true },
    });
    if (!acra) return company;
    return { ...company, acraRecord: acra };
  } catch {
    return company;
  }
}

export async function getCompanyByUen(
  uen: string,
  tenantId: string | null,
  options: GetCompanyOptions = {}
): Promise<Company | null> {
  const { includeDeleted = false, skipTenantFilter = false } = options;

  // Require tenantId unless explicitly skipping for SUPER_ADMIN
  if (!tenantId && !skipTenantFilter) {
    throw new Error('Workspace context is required for company queries');
  }

  const where: Prisma.CompanyWhereInput = { uen: uen.toUpperCase() };

  if (tenantId && !skipTenantFilter) {
    where.tenantId = tenantId;
  }

  if (!includeDeleted) {
    where.deletedAt = null;
  }

  const company = await prisma.company.findFirst({ where });
  return company ? serializeCompany(company) : null;
}

// ============================================================================
// Search Companies
// ============================================================================

export interface SearchCompaniesOptions {
  /**
   * Skip tenant filtering - ONLY use for SUPER_ADMIN operations that need
   * cross-tenant access. Regular operations MUST always provide tenantId.
   */
  skipTenantFilter?: boolean;
  /**
   * Filter to specific company IDs - used for company-scoped users who have
   * access to multiple companies via role assignments.
   */
  companyIds?: string[];
}

export async function searchCompanies(
  params: CompanySearchInput,
  tenantId: string | null,
  options: SearchCompaniesOptions = {}
): Promise<{
  companies: CompanyWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const { skipTenantFilter = false, companyIds } = options;

  // Require tenantId unless explicitly skipping for SUPER_ADMIN
  if (!tenantId && !skipTenantFilter) {
    throw new Error('Workspace context is required for company queries');
  }

  const where: Prisma.CompanyWhereInput = {
    deletedAt: null,
  };

  // Tenant scope
  if (tenantId && !skipTenantFilter) {
    where.tenantId = tenantId;
  }

  // Company IDs filter (for users with specific company role assignments)
  if (companyIds && companyIds.length > 0) {
    where.id = { in: companyIds };
  }

  // Text search across multiple fields
  if (params.query) {
    const searchTerm = params.query.trim();
    where.OR = [
      { uen: { contains: searchTerm, mode: 'insensitive' } },
      { name: { contains: searchTerm, mode: 'insensitive' } },
      { primarySsicCode: { contains: searchTerm, mode: 'insensitive' } },
      { primarySsicDescription: { contains: searchTerm, mode: 'insensitive' } },
      {
        officers: {
          some: {
            name: { contains: searchTerm, mode: 'insensitive' },
            isCurrent: true,
          },
        },
      },
      {
        shareholders: {
          some: {
            name: { contains: searchTerm, mode: 'insensitive' },
            isCurrent: true,
          },
        },
      },
      {
        addresses: {
          some: {
            fullAddress: { contains: searchTerm, mode: 'insensitive' },
            isCurrent: true,
          },
        },
      },
    ];
  }

  // UEN filter (exact match with contains for partial search)
  if (params.uen) {
    where.uen = { contains: params.uen, mode: 'insensitive' };
  }

  // Address filter
  if (params.address) {
    where.addresses = {
      some: {
        fullAddress: { contains: params.address, mode: 'insensitive' },
        isCurrent: true,
      },
    };
  }

  // Warnings filter (currently: warning = no FYE)
  if (params.hasWarnings === true) {
    where.financialYearEndMonth = null;
  } else if (params.hasWarnings === false) {
    where.financialYearEndMonth = { not: null };
  }

  // Filters
  if (params.entityType) {
    where.entityType = params.entityType;
  }

  if (params.status) {
    where.status = params.status;
  }

  if (params.incorporationDateFrom || params.incorporationDateTo) {
    where.incorporationDate = {};
    if (params.incorporationDateFrom) {
      where.incorporationDate.gte = new Date(params.incorporationDateFrom);
    }
    if (params.incorporationDateTo) {
      where.incorporationDate.lte = new Date(params.incorporationDateTo);
    }
  }

  if (params.hasCharges !== undefined) {
    where.hasCharges = params.hasCharges;
  }

  if (params.financialYearEndMonth) {
    where.financialYearEndMonth = params.financialYearEndMonth;
  }

  if (params.homeCurrency) {
    where.homeCurrency = params.homeCurrency;
  }

  // Paid-up capital range filter
  if (params.paidUpCapitalMin !== undefined || params.paidUpCapitalMax !== undefined) {
    where.paidUpCapitalAmount = {};
    if (params.paidUpCapitalMin !== undefined) {
      where.paidUpCapitalAmount.gte = params.paidUpCapitalMin;
    }
    if (params.paidUpCapitalMax !== undefined) {
      where.paidUpCapitalAmount.lte = params.paidUpCapitalMax;
    }
  }

  // Issued capital range filter
  if (params.issuedCapitalMin !== undefined || params.issuedCapitalMax !== undefined) {
    where.issuedCapitalAmount = {};
    if (params.issuedCapitalMin !== undefined) {
      where.issuedCapitalAmount.gte = params.issuedCapitalMin;
    }
    if (params.issuedCapitalMax !== undefined) {
      where.issuedCapitalAmount.lte = params.issuedCapitalMax;
    }
  }

  if (params.officersMin !== undefined || params.officersMax !== undefined) {
    where.currentOfficerCount = {};
    if (params.officersMin !== undefined) {
      where.currentOfficerCount.gte = params.officersMin;
    }
    if (params.officersMax !== undefined) {
      where.currentOfficerCount.lte = params.officersMax;
    }
  }

  if (params.shareholdersMin !== undefined || params.shareholdersMax !== undefined) {
    where.currentShareholderCount = {};
    if (params.shareholdersMin !== undefined) {
      where.currentShareholderCount.gte = params.shareholdersMin;
    }
    if (params.shareholdersMax !== undefined) {
      where.currentShareholderCount.lte = params.shareholdersMax;
    }
  }

  // Sorting - handle _count fields and address specially
  let orderBy: Prisma.CompanyOrderByWithRelationInput | Prisma.CompanyOrderByWithRelationInput[];
  let sortByAddress = false;

  if (params.sortBy === 'officersCount') {
    orderBy = { currentOfficerCount: params.sortOrder };
  } else if (params.sortBy === 'shareholdersCount') {
    orderBy = { currentShareholderCount: params.sortOrder };
  } else if (params.sortBy === 'address') {
    // Address sorting will be done post-query since it's on a related table
    orderBy = { name: params.sortOrder }; // Fallback sort
    sortByAddress = true;
  } else {
    orderBy = { [params.sortBy]: params.sortOrder };
  }

  // Pagination
  const skip = (params.page - 1) * params.limit;

  const [companiesRaw, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: {
        addresses: {
          where: { isCurrent: true, addressType: 'REGISTERED_OFFICE' },
          take: 1,
          select: {
            id: true,
            addressType: true,
            fullAddress: true,
            isCurrent: true,
          },
        },
      },
      orderBy,
      skip,
      take: params.limit,
    }),
    prisma.company.count({ where }),
  ]);

  let companies = companiesRaw.map((company) => ({
    ...serializeCompany(company),
    _count: {
      documents: company.documentCount,
      charges: company.activeChargeCount,
      officers: company.currentOfficerCount,
      shareholders: company.currentShareholderCount,
    },
  }));

  // Post-query sorting by address (since it's on a related table)
  if (sortByAddress) {
    companies = companies.sort((a, b) => {
      const addrA = a.addresses?.[0]?.fullAddress || '';
      const addrB = b.addresses?.[0]?.fullAddress || '';
      const cmp = addrA.localeCompare(addrB);
      return params.sortOrder === 'asc' ? cmp : -cmp;
    });
  }

  return {
    companies,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}

// ============================================================================
// Get Company Full Details
// ============================================================================

export async function getCompanyFullDetails(
  id: string,
  tenantId: string | null,
  options: GetCompanyOptions = {}
): Promise<CompanyWithRelations | null> {
  const { skipTenantFilter = false } = options;

  // Require tenantId unless explicitly skipping for SUPER_ADMIN
  if (!tenantId && !skipTenantFilter) {
    throw new Error('Workspace context is required for company queries');
  }

  const where: Prisma.CompanyWhereInput = { id, deletedAt: null };

  if (tenantId && !skipTenantFilter) {
    where.tenantId = tenantId;
  }

  // OPTIMIZED: Run all queries in parallel instead of nested includes
  // Prisma's nested include runs separate queries sequentially (~180ms each)
  // Running them in parallel reduces total time from ~1.5s to ~200ms
  const [
    company,
    formerNames,
    addresses,
    officers,
    shareholders,
    shareCapital,
    charges,
    auditor,
    documents,
    sharePointFolderMapping,
    financialPeriods,
  ] = await Promise.all([
    // Main company data (minimal select for speed)
    prisma.company.findFirst({
      where,
    }),
    // Former names
    prisma.companyFormerName.findMany({
      where: { companyId: id },
      orderBy: { effectiveFrom: 'desc' },
      take: 5,
    }),
    // Current addresses only
    prisma.companyAddress.findMany({
      where: { companyId: id, isCurrent: true },
      orderBy: { addressType: 'asc' },
    }),
    // Officers with contact info (include ceased for detail page filters)
    prisma.companyOfficer.findMany({
      where: { companyId: id },
      orderBy: [
        { isCurrent: 'desc' },
        { appointmentDate: 'desc' },
      ],
      take: 100,
      include: {
        contact: {
          select: {
            id: true,
            fullName: true,
            nationality: true,
            fullAddress: true,
            identificationType: true,
            identificationNumber: true,
          },
        },
      },
    }),
    // Shareholders with contact info (include former for detail page filters)
    prisma.companyShareholder.findMany({
      where: { companyId: id },
      orderBy: [
        { isCurrent: 'desc' },
        { numberOfShares: 'desc' },
      ],
      take: 100,
      include: {
        contact: {
          select: {
            id: true,
            fullName: true,
            nationality: true,
            fullAddress: true,
            identificationType: true,
            identificationNumber: true,
          },
        },
      },
    }),
    // Share capital records
    prisma.shareCapital.findMany({
      where: { companyId: id },
      orderBy: { effectiveDate: 'desc' },
      take: 10,
    }),
    // Active charges only
    prisma.companyCharge.findMany({
      where: { companyId: id },
      orderBy: { registrationDate: 'desc' },
      take: 20,
    }),
    prisma.companyAuditor.findUnique({
      where: { companyId: id },
    }),
    // Recent documents
    prisma.document.findMany({
      where: { companyId: id, isLatest: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        documentType: true,
        originalFileName: true,
        extractionStatus: true,
        createdAt: true,
        uploadedBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    }),
    prisma.companySharePointFolder?.findUnique({
      where: { companyId: id },
      select: {
        id: true,
        companyId: true,
        connectorId: true,
        driveId: true,
        folderItemId: true,
        folderName: true,
        folderWebUrl: true,
        lastVerifiedAt: true,
      },
    }),
    // The first confirmed financial period, as getCompanyById loads it.
    prisma.companyFinancialPeriod.findMany({
      where: { companyId: id, provenance: 'CONFIRMED' },
      orderBy: { periodEnd: 'asc' },
      take: 1,
      select: { periodStart: true, periodEnd: true, yearsOfAssessment: true },
    }),
  ]);

  if (!company) return null;

  // Combine results into the expected shape
  // OPTIMIZED: Compute counts from already-fetched arrays instead of separate query
  return attachAcraRecord(serializeCompany({
    ...company,
    formerNames,
    addresses,
    officers,
    shareholders,
    shareCapital,
    charges,
    auditor,
    documents,
    sharePointFolderMapping,
    financialPeriods,
    _count: {
      documents: documents.length,
      officers: officers.length,
      shareholders: shareholders.length,
      charges: charges.length,
      auditLogs: 0, // Audit logs rarely needed on detail page, fetch separately if needed
    },
  } as CompanyWithRelations));
}

// ============================================================================
// Company Statistics
// ============================================================================

export interface GetCompanyStatsOptions {
  /**
   * Skip tenant filtering - ONLY use for SUPER_ADMIN operations that need
   * cross-tenant statistics. Regular operations MUST always provide tenantId.
   */
  skipTenantFilter?: boolean;
}

export async function getCompanyStats(
  tenantId: string | null,
  options: GetCompanyStatsOptions = {}
): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byEntityType: Record<string, number>;
  recentlyAdded: number;
  withOverdueFilings: number;
}> {
  const { skipTenantFilter = false } = options;

  // Require tenantId unless explicitly skipping for SUPER_ADMIN
  if (!tenantId && !skipTenantFilter) {
    throw new Error('Workspace context is required for company statistics');
  }

  const baseWhere: Prisma.CompanyWhereInput = { deletedAt: null };

  if (tenantId && !skipTenantFilter) {
    baseWhere.tenantId = tenantId;
  }

  const [total, byStatus, byEntityType, recentlyAdded, withOverdueFilings] = await Promise.all([
    prisma.company.count({ where: baseWhere }),
    prisma.company.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: true,
    }),
    prisma.company.groupBy({
      by: ['entityType'],
      where: baseWhere,
      _count: true,
    }),
    prisma.company.count({
      where: {
        ...baseWhere,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      },
    }),
    // Simplified overdue check - companies where AR is overdue
    prisma.company.count({
      where: {
        ...baseWhere,
        status: 'LIVE',
        accountsDueDate: {
          lt: new Date(),
        },
      },
    }),
  ]);

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    byEntityType: Object.fromEntries(byEntityType.map((e) => [e.entityType, e._count])),
    recentlyAdded,
    withOverdueFilings,
  };
}

export async function refreshCompanySummaryCounts(companyId?: string): Promise<{ updated: number }> {
  const companyFilter = companyId
    ? Prisma.sql`c2."id" = ${companyId} AND`
    : Prisma.empty;

  const updated = await prisma.$executeRaw`
    UPDATE "companies" c
    SET
      "current_officer_count" = COALESCE(o.count, 0),
      "current_shareholder_count" = COALESCE(s.count, 0),
      "active_charge_count" = COALESCE(ch.count, 0),
      "document_count" = COALESCE(d.count, 0),
      "has_poc" = COALESCE(p.has_poc, false)
    FROM "companies" c2
    LEFT JOIN (
      SELECT "companyId", COUNT(*)::INTEGER AS count
      FROM "company_officers"
      WHERE "isCurrent" = true
      GROUP BY "companyId"
    ) o ON o."companyId" = c2."id"
    LEFT JOIN (
      SELECT "companyId", COUNT(*)::INTEGER AS count
      FROM "company_shareholders"
      WHERE "isCurrent" = true
      GROUP BY "companyId"
    ) s ON s."companyId" = c2."id"
    LEFT JOIN (
      SELECT "companyId", COUNT(*)::INTEGER AS count
      FROM "company_charges"
      WHERE "isFullyDischarged" = false
      GROUP BY "companyId"
    ) ch ON ch."companyId" = c2."id"
    LEFT JOIN (
      SELECT "companyId", COUNT(*)::INTEGER AS count
      FROM "documents"
      WHERE "deleted_at" IS NULL
      GROUP BY "companyId"
    ) d ON d."companyId" = c2."id"
    LEFT JOIN (
      SELECT "companyId", true AS has_poc
      FROM "company_contacts"
      WHERE "isPoc" = true AND "deletedAt" IS NULL
      GROUP BY "companyId"
    ) p ON p."companyId" = c2."id"
    WHERE ${companyFilter} c."id" = c2."id"
  `;

  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW company_summary_counts');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW processing_document_summary_counts');

  return { updated };
}

// ============================================================================
// Company Link Information (for delete confirmation)
// ============================================================================

export interface CompanyLinkInfo {
  hasLinks: boolean;
  officerCount: number;
  shareholderCount: number;
  chargeCount: number;
  documentCount: number;
  totalLinks: number;
}

/**
 * Get information about a company's linked data
 * Used to warn users before deletion
 */
export async function getCompanyLinkInfo(
  companyId: string,
  tenantId: string
): Promise<CompanyLinkInfo> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId, deletedAt: null },
    select: {
      _count: {
        select: {
          officers: true,
          shareholders: true,
          charges: true,
          documents: true,
        },
      },
    },
  });

  if (!company) {
    return {
      hasLinks: false,
      officerCount: 0,
      shareholderCount: 0,
      chargeCount: 0,
      documentCount: 0,
      totalLinks: 0,
    };
  }

  const { officers, shareholders, charges, documents } = company._count;
  const totalLinks = officers + shareholders + charges + documents;

  return {
    hasLinks: totalLinks > 0,
    officerCount: officers,
    shareholderCount: shareholders,
    chargeCount: charges,
    documentCount: documents,
    totalLinks,
  };
}

// ============================================================================
// Officer Management
// ============================================================================

/**
 * Update an officer's details (appointment date, cessation date)
 */
export async function updateOfficer(
  officerId: string,
  companyId: string,
  params: TenantAwareParams,
  data: { appointmentDate?: string | null; cessationDate?: string | null }
): Promise<{ id: string; appointmentDate: Date | null; cessationDate: Date | null; isCurrent: boolean }> {
  const { tenantId, userId } = params;

  const officer = await prisma.companyOfficer.findFirst({
    where: { id: officerId, companyId },
    include: COMPANY_SCOPE_INCLUDE,
  });
  assertWorkspaceOwned(officer, officer?.company.tenantId, tenantId, 'Officer not found');

  const oldValues = {
    appointmentDate: officer.appointmentDate,
    cessationDate: officer.cessationDate,
    isCurrent: officer.isCurrent,
  };

  // Determine final dates (considering both new and existing values)
  const appointmentDate = data.appointmentDate !== undefined
    ? (data.appointmentDate ? new Date(data.appointmentDate) : null)
    : officer.appointmentDate;
  const cessationDate = data.cessationDate !== undefined
    ? (data.cessationDate ? new Date(data.cessationDate) : null)
    : officer.cessationDate;
  const isCurrent = cessationDate === null;

  if (appointmentDate && cessationDate && cessationDate < appointmentDate) {
    throw new ValidationError('Cessation date must be after appointment date');
  }

  // Update officer
  const updated = await prisma.companyOfficer.update({
    where: { id: officerId },
    data: {
      appointmentDate: data.appointmentDate !== undefined ? appointmentDate : undefined,
      cessationDate: cessationDate,
      isCurrent,
    },
    select: {
      id: true,
      appointmentDate: true,
      cessationDate: true,
      isCurrent: true,
    },
  });

  // Log the action
  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'CompanyOfficer',
    entityId: officerId,
    summary: `Updated officer "${officer.name}" details`,
    changeSource: 'MANUAL',
    changes: {
      appointmentDate: { old: oldValues.appointmentDate, new: updated.appointmentDate },
      cessationDate: { old: oldValues.cessationDate, new: updated.cessationDate },
      isCurrent: { old: oldValues.isCurrent, new: updated.isCurrent },
    },
    metadata: {
      companyId: officer.company.id,
      companyName: officer.company.name,
      officerName: officer.name,
    },
  });

  return updated;
}

/**
 * Link an officer to a contact
 */
export async function linkOfficerToContact(
  officerId: string,
  contactId: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const officer = await prisma.companyOfficer.findFirst({
    where: { id: officerId },
    include: COMPANY_SCOPE_INCLUDE,
  });
  assertWorkspaceOwned(officer, officer?.company.tenantId, tenantId, 'Officer not found');

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId, deletedAt: null },
    select: { id: true, fullName: true },
  });
  if (!contact) {
    throw new NotFoundError('Contact not found');
  }

  // Update officer with contact link
  await prisma.companyOfficer.update({
    where: { id: officerId },
    data: { contactId },
  });

  // Log the action
  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'CompanyOfficer',
    entityId: officerId,
    summary: `Linked officer "${officer.name}" to contact "${contact.fullName}"`,
    changeSource: 'MANUAL',
    metadata: {
      companyId: officer.company.id,
      companyName: officer.company.name,
      contactId,
      contactName: contact.fullName,
    },
  });
}

/**
 * Unlink an officer from a contact
 */
export async function unlinkOfficerFromContact(
  officerId: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const officer = await prisma.companyOfficer.findFirst({
    where: { id: officerId },
    include: {
      company: { select: { id: true, tenantId: true, name: true, displayAlias: true } },
      contact: { select: { id: true, fullName: true } },
    },
  });
  assertWorkspaceOwned(officer, officer?.company.tenantId, tenantId, 'Officer not found');

  if (!officer.contactId) {
    throw new ValidationError('Officer is not linked to any contact');
  }

  const previousContactName = officer.contact?.fullName || 'Unknown';

  // Remove contact link
  await prisma.companyOfficer.update({
    where: { id: officerId },
    data: { contactId: null },
  });

  // Log the action
  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'CompanyOfficer',
    entityId: officerId,
    summary: `Unlinked officer "${officer.name}" from contact "${previousContactName}"`,
    changeSource: 'MANUAL',
    metadata: {
      companyId: officer.company.id,
      companyName: officer.company.name,
      previousContactId: officer.contactId,
      previousContactName,
    },
  });
}

/**
 * Remove an officer (mark as ceased)
 */
export async function removeOfficer(
  officerId: string,
  companyId: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const officer = await prisma.companyOfficer.findFirst({
    where: { id: officerId, companyId },
    include: COMPANY_SCOPE_INCLUDE,
  });
  assertWorkspaceOwned(officer, officer?.company.tenantId, tenantId, 'Officer not found');

  // Mark as ceased
  await prisma.companyOfficer.update({
    where: { id: officerId },
    data: {
      isCurrent: false,
      cessationDate: officer.cessationDate || new Date(),
    },
  });

  // Log the action
  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'CompanyOfficer',
    entityId: officerId,
    summary: `Removed officer "${officer.name}" from company "${officer.company.name}"`,
    changeSource: 'MANUAL',
    changes: {
      isCurrent: { old: true, new: false },
    },
    metadata: {
      companyId: officer.company.id,
      companyName: officer.company.name,
      officerName: officer.name,
      role: officer.role,
    },
  });
}

/**
 * Delete an officer record (hard delete)
 */
export async function deleteOfficer(
  officerId: string,
  companyId: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const officer = await prisma.companyOfficer.findFirst({
    where: { id: officerId, companyId },
    include: COMPANY_SCOPE_INCLUDE,
  });
  assertWorkspaceOwned(officer, officer?.company.tenantId, tenantId, 'Officer not found');

  await prisma.companyOfficer.delete({
    where: { id: officerId },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'DELETE',
    entityType: 'CompanyOfficer',
    entityId: officerId,
    summary: `Deleted officer "${officer.name}" from company "${officer.company.name}"`,
    changeSource: 'MANUAL',
    metadata: {
      companyId: officer.company.id,
      companyName: officer.company.name,
      officerName: officer.name,
      role: officer.role,
    },
  });
}

// ============================================================================
// Shareholder Management
// ============================================================================

/**
 * Update a shareholder's details (number of shares, share class)
 */
export async function updateShareholder(
  shareholderId: string,
  companyId: string,
  params: TenantAwareParams,
  data: { numberOfShares?: number; shareClass?: string }
): Promise<{ id: string; numberOfShares: number; shareClass: string | null; percentageHeld: number | null }> {
  const { tenantId, userId } = params;

  const shareholder = await prisma.companyShareholder.findFirst({
    where: { id: shareholderId, companyId },
    include: COMPANY_SCOPE_INCLUDE,
  });
  assertWorkspaceOwned(shareholder, shareholder?.company.tenantId, tenantId, 'Shareholder not found');

  const oldValues = {
    numberOfShares: shareholder.numberOfShares,
    shareClass: shareholder.shareClass,
  };

  // Wrap update and percentage recalculation in transaction to prevent race conditions
  const finalUpdated = await prisma.$transaction(async (tx) => {
    // Update shareholder
    await tx.companyShareholder.update({
      where: { id: shareholderId },
      data: {
        numberOfShares: data.numberOfShares !== undefined ? data.numberOfShares : undefined,
        shareClass: data.shareClass !== undefined ? data.shareClass : undefined,
      },
      select: {
        id: true,
        numberOfShares: true,
        shareClass: true,
        percentageHeld: true,
      },
    });

    // If numberOfShares changed, recalculate percentages for all current shareholders
    if (data.numberOfShares !== undefined && data.numberOfShares !== oldValues.numberOfShares) {
      // Get all current shareholders
      const allShareholders = await tx.companyShareholder.findMany({
        where: { companyId, isCurrent: true },
        select: { id: true, numberOfShares: true },
      });

      // Calculate total shares
      const totalShares = allShareholders.reduce((sum, sh) => sum + sh.numberOfShares, 0);

      // Update percentages for all shareholders
      if (totalShares > 0) {
        for (const sh of allShareholders) {
          const percentage = (sh.numberOfShares / totalShares) * 100;
          await tx.companyShareholder.update({
            where: { id: sh.id },
            data: { percentageHeld: percentage },
          });
        }
      } else {
        // If no shares remain, set all percentages to null
        await tx.companyShareholder.updateMany({
          where: { companyId, isCurrent: true },
          data: { percentageHeld: null },
        });
      }
    }

    // Re-fetch the updated shareholder with new percentage
    return tx.companyShareholder.findUnique({
      where: { id: shareholderId },
      select: {
        id: true,
        numberOfShares: true,
        shareClass: true,
        percentageHeld: true,
      },
    });
  });

  // Log the action
  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'CompanyShareholder',
    entityId: shareholderId,
    summary: `Updated shareholder "${shareholder.name}" details`,
    changeSource: 'MANUAL',
    changes: {
      numberOfShares: { old: oldValues.numberOfShares, new: finalUpdated!.numberOfShares },
      shareClass: { old: oldValues.shareClass, new: finalUpdated!.shareClass },
    },
    metadata: {
      companyId: shareholder.company.id,
      companyName: shareholder.company.name,
      shareholderName: shareholder.name,
    },
  });

  return {
    id: finalUpdated!.id,
    numberOfShares: finalUpdated!.numberOfShares,
    shareClass: finalUpdated!.shareClass,
    percentageHeld: finalUpdated!.percentageHeld ? Number(finalUpdated!.percentageHeld) : null,
  };
}

/**
 * Link a shareholder to a contact
 */
export async function linkShareholderToContact(
  shareholderId: string,
  contactId: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const shareholder = await prisma.companyShareholder.findFirst({
    where: { id: shareholderId },
    include: COMPANY_SCOPE_INCLUDE,
  });
  assertWorkspaceOwned(shareholder, shareholder?.company.tenantId, tenantId, 'Shareholder not found');

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId, deletedAt: null },
    select: { id: true, fullName: true },
  });
  if (!contact) {
    throw new NotFoundError('Contact not found');
  }

  // Update shareholder with contact link
  await prisma.companyShareholder.update({
    where: { id: shareholderId },
    data: { contactId },
  });

  // Log the action
  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'CompanyShareholder',
    entityId: shareholderId,
    summary: `Linked shareholder "${shareholder.name}" to contact "${contact.fullName}"`,
    changeSource: 'MANUAL',
    metadata: {
      companyId: shareholder.company.id,
      companyName: shareholder.company.name,
      contactId,
      contactName: contact.fullName,
    },
  });
}

/**
 * Unlink a shareholder from a contact
 */
export async function unlinkShareholderFromContact(
  shareholderId: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const shareholder = await prisma.companyShareholder.findFirst({
    where: { id: shareholderId },
    include: {
      company: { select: { id: true, tenantId: true, name: true, displayAlias: true } },
      contact: { select: { id: true, fullName: true } },
    },
  });
  assertWorkspaceOwned(shareholder, shareholder?.company.tenantId, tenantId, 'Shareholder not found');

  if (!shareholder.contactId) {
    throw new ValidationError('Shareholder is not linked to any contact');
  }

  const previousContactName = shareholder.contact?.fullName || 'Unknown';

  // Remove contact link
  await prisma.companyShareholder.update({
    where: { id: shareholderId },
    data: { contactId: null },
  });

  // Log the action
  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'CompanyShareholder',
    entityId: shareholderId,
    summary: `Unlinked shareholder "${shareholder.name}" from contact "${previousContactName}"`,
    changeSource: 'MANUAL',
    metadata: {
      companyId: shareholder.company.id,
      companyName: shareholder.company.name,
      previousContactId: shareholder.contactId,
      previousContactName,
    },
  });
}

/**
 * Remove a shareholder (mark as former)
 * SECURITY: Uses transaction to prevent race conditions in percentage recalculation
 */
export async function removeShareholder(
  shareholderId: string,
  companyId: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const shareholder = await prisma.companyShareholder.findFirst({
    where: { id: shareholderId, companyId },
    include: COMPANY_SCOPE_INCLUDE,
  });
  assertWorkspaceOwned(shareholder, shareholder?.company.tenantId, tenantId, 'Shareholder not found');

  // Use transaction to ensure atomicity of removal and percentage recalculation
  await prisma.$transaction(async (tx) => {
    // Mark as former (not current)
    await tx.companyShareholder.update({
      where: { id: shareholderId },
      data: {
        isCurrent: false,
      },
    });

    // Recalculate percentages for remaining current shareholders
    const remainingShareholders = await tx.companyShareholder.findMany({
      where: { companyId, isCurrent: true },
      select: { id: true, numberOfShares: true },
    });

    const totalShares = remainingShareholders.reduce((sum, sh) => sum + sh.numberOfShares, 0);

    if (totalShares > 0) {
      // Update all percentages within the same transaction
      await Promise.all(
        remainingShareholders.map((sh) => {
          const percentage = (sh.numberOfShares / totalShares) * 100;
          return tx.companyShareholder.update({
            where: { id: sh.id },
            data: { percentageHeld: percentage },
          });
        })
      );
    }
  });

  // Log the action (outside transaction - non-critical)
  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'CompanyShareholder',
    entityId: shareholderId,
    summary: `Removed shareholder "${shareholder.name}" from company "${shareholder.company.name}"`,
    changeSource: 'MANUAL',
    changes: {
      isCurrent: { old: true, new: false },
    },
    metadata: {
      companyId: shareholder.company.id,
      companyName: shareholder.company.name,
      shareholderName: shareholder.name,
      numberOfShares: shareholder.numberOfShares,
    },
  });
}

/**
 * Reactivate a former shareholder (mark as current)
 * SECURITY: Uses transaction to prevent race conditions in percentage recalculation
 */
export async function reactivateShareholder(
  shareholderId: string,
  companyId: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const shareholder = await prisma.companyShareholder.findFirst({
    where: { id: shareholderId, companyId },
    include: COMPANY_SCOPE_INCLUDE,
  });
  assertWorkspaceOwned(shareholder, shareholder?.company.tenantId, tenantId, 'Shareholder not found');

  if (shareholder.isCurrent) {
    throw new ValidationError('Shareholder is already active');
  }

  // Use transaction to ensure atomicity of reactivation and percentage recalculation
  await prisma.$transaction(async (tx) => {
    // Mark as current
    await tx.companyShareholder.update({
      where: { id: shareholderId },
      data: {
        isCurrent: true,
      },
    });

    // Recalculate percentages for all current shareholders (including reactivated one)
    const currentShareholders = await tx.companyShareholder.findMany({
      where: { companyId, isCurrent: true },
      select: { id: true, numberOfShares: true },
    });

    const totalShares = currentShareholders.reduce((sum, sh) => sum + sh.numberOfShares, 0);

    if (totalShares > 0) {
      await Promise.all(
        currentShareholders.map((sh) => {
          const percentage = (sh.numberOfShares / totalShares) * 100;
          return tx.companyShareholder.update({
            where: { id: sh.id },
            data: { percentageHeld: percentage },
          });
        })
      );
    }
  });

  // Log the action (outside transaction - non-critical)
  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'CompanyShareholder',
    entityId: shareholderId,
    summary: `Reactivated shareholder "${shareholder.name}" in company "${shareholder.company.name}"`,
    changeSource: 'MANUAL',
    changes: {
      isCurrent: { old: false, new: true },
    },
    metadata: {
      companyId: shareholder.company.id,
      companyName: shareholder.company.name,
      shareholderName: shareholder.name,
      numberOfShares: shareholder.numberOfShares,
    },
  });
}

/**
 * Delete a shareholder record (hard delete)
 */
export async function deleteShareholder(
  shareholderId: string,
  companyId: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const shareholder = await prisma.companyShareholder.findFirst({
    where: { id: shareholderId, companyId },
    include: COMPANY_SCOPE_INCLUDE,
  });
  assertWorkspaceOwned(shareholder, shareholder?.company.tenantId, tenantId, 'Shareholder not found');

  await prisma.companyShareholder.delete({
    where: { id: shareholderId },
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'DELETE',
    entityType: 'CompanyShareholder',
    entityId: shareholderId,
    summary: `Deleted shareholder "${shareholder.name}" from company "${shareholder.company.name}"`,
    changeSource: 'MANUAL',
    metadata: {
      companyId: shareholder.company.id,
      companyName: shareholder.company.name,
      shareholderName: shareholder.name,
      numberOfShares: shareholder.numberOfShares,
    },
  });
}
