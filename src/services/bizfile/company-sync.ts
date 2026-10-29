import type { PrismaTransactionClient } from '@/services/contact.service';
import type { CompanyProfileSectionId } from '@/lib/company-profile-sections';
import type { ExtractedBizFileData, OfficerAction } from './types';
import type { BizFileChange, BizFileChangePlan, BizFileCommandMode } from './change-plan';
import {
  mapCompanyStatus,
  mapContactType,
  mapEntityType,
  mapIdentificationType,
  mapOfficerRole,
} from './types';
import { buildFullAddress, normalizeExtractedData } from './normalizer';
import { normalizeCompanyAlias } from '@/lib/company-display-label';
import { enqueueScheduleReconciliation } from '@/services/schedule-reconciliation';

export interface SyncCompanyFromBizfileArgs {
  data: ExtractedBizFileData;
  documentId: string;
  tenantId: string;
  userId: string;
  existingCompanyId?: string;
  officerActions?: OfficerAction[];
  /** A canonical reviewed plan. Omitted only for the compatibility processor. */
  changePlan?: BizFileChangePlan;
  /** Explicit command mode used by the canonical adapter. */
  mode?: BizFileCommandMode;
  /** Prevent a plan from being applied to a different operation transaction. */
  operationId?: string;
}

export interface SyncCompanyFromBizfileResult {
  companyId: string;
  created: boolean;
  changedSections: CompanyProfileSectionId[];
}

type Officer = NonNullable<ExtractedBizFileData['officers']>[number];
type Shareholder = NonNullable<ExtractedBizFileData['shareholders']>[number];

export interface BizfileSyncDependencies {
  resolveContact?: (
    record: Officer | Shareholder,
    kind: 'officer' | 'shareholder',
    sourceIndex: number,
    companyId: string,
  ) => Promise<string | null>;
}

export interface CanonicalBizFileSyncResult extends SyncCompanyFromBizfileResult {
  selectedChanges: BizFileChange[];
  operationStatus: 'COMMITTED' | 'NO_CHANGE';
}

const changedSections: CompanyProfileSectionId[] = [
  'identity', 'addresses', 'activities', 'officers', 'shareholders',
  'compliance', 'capital', 'charges', 'additional',
];

function dateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function syncAddress(
  tx: PrismaTransactionClient,
  companyId: string,
  documentId: string,
  addressType: 'REGISTERED_OFFICE' | 'MAILING',
  address: ExtractedBizFileData['registeredAddress'] | ExtractedBizFileData['mailingAddress'],
) {
  if (!address) return;
  const current = await tx.companyAddress.findFirst({
    where: { companyId, addressType, isCurrent: true },
    select: { id: true },
  });
  const data = {
    block: address.block ?? null,
    streetName: address.streetName,
    level: address.level ?? null,
    unit: address.unit ?? null,
    buildingName: address.buildingName ?? null,
    postalCode: address.postalCode,
    country: address.country || 'Singapore',
    fullAddress: buildFullAddress(address),
    effectiveFrom: 'effectiveFrom' in address ? dateOrNull(address.effectiveFrom) : null,
    effectiveTo: null,
    isCurrent: true,
    sourceDocumentId: documentId,
  };
  if (current) {
    await tx.companyAddress.update({ where: { id: current.id }, data });
  } else {
    await tx.companyAddress.create({ data: { companyId, addressType, ...data } });
  }
}

/**
 * The single transaction-scoped persistence path for reviewed Bizfile company data.
 * Receipt metadata is deliberately excluded; the processor stores it on DocumentRevision.
 */
export async function syncCompanyFromBizfileInTransaction(
  args: SyncCompanyFromBizfileArgs,
  tx: PrismaTransactionClient,
  dependencies: BizfileSyncDependencies = {},
): Promise<SyncCompanyFromBizfileResult> {
  const data = normalizeExtractedData(args.data);
  const { entityDetails } = data;
  const aliasUpdate = entityDetails.displayAlias === undefined
    ? {}
    : { displayAlias: normalizeCompanyAlias(entityDetails.displayAlias) };
  const createAlias = normalizeCompanyAlias(entityDetails.displayAlias);
  const created = !args.existingCompanyId;
  const company = created
    ? await tx.company.upsert({
        where: { tenantId_uen: { tenantId: args.tenantId, uen: entityDetails.uen } },
        create: {
          tenantId: args.tenantId,
          uen: entityDetails.uen,
          name: entityDetails.name,
          displayAlias: createAlias,
          entityType: mapEntityType(entityDetails.entityType),
          status: mapCompanyStatus(entityDetails.status),
        },
        update: {},
        select: { id: true },
      })
    : { id: args.existingCompanyId! };
  const companyId = company.id;
  const existingSource = !created && typeof tx.company.findFirst === 'function'
    ? await tx.company.findFirst({
        where: { id: companyId, tenantId: args.tenantId, deletedAt: null },
        select: {
          entityType: true,
          incorporationDate: true,
          financialYearEndDay: true,
          financialYearEndMonth: true,
          accountsDueDate: true,
        },
      })
    : null;
  const scheduleSourceChanged = created || !existingSource || existingSource.entityType !== mapEntityType(entityDetails.entityType)
    || dateKey(existingSource.incorporationDate) !== dateKey(entityDetails.incorporationDate)
    || existingSource.financialYearEndDay !== (data.financialYear?.endDay ?? null)
    || existingSource.financialYearEndMonth !== (data.financialYear?.endMonth ?? null)
    || dateKey(existingSource.accountsDueDate) !== dateKey(data.compliance?.accountsDueDate);

  await tx.company.update({
    where: { id: companyId },
    data: {
      uen: entityDetails.uen,
      name: entityDetails.name,
      ...aliasUpdate,
      formerName: entityDetails.formerName ?? null,
      dateOfNameChange: dateOrNull(entityDetails.dateOfNameChange),
      entityType: mapEntityType(entityDetails.entityType),
      status: mapCompanyStatus(entityDetails.status),
      statusDate: dateOrNull(entityDetails.statusDate),
      incorporationDate: dateOrNull(entityDetails.incorporationDate),
      registrationDate: dateOrNull(entityDetails.registrationDate),
      dateOfAddress: dateOrNull(data.registeredAddress?.effectiveFrom),
      primarySsicCode: data.ssicActivities?.primary?.code ?? null,
      primarySsicDescription: data.ssicActivities?.primary?.description ?? null,
      secondarySsicCode: data.ssicActivities?.secondary?.code ?? null,
      secondarySsicDescription: data.ssicActivities?.secondary?.description ?? null,
      financialYearEndDay: data.financialYear?.endDay ?? null,
      financialYearEndMonth: data.financialYear?.endMonth ?? null,
      fyeAsAtLastAr: dateOrNull(data.compliance?.fyeAsAtLastAr),
      homeCurrency: data.homeCurrency ?? null,
      lastAgmDate: dateOrNull(data.compliance?.lastAgmDate),
      lastArFiledDate: dateOrNull(data.compliance?.lastArFiledDate),
      accountsDueDate: dateOrNull(data.compliance?.accountsDueDate),
      paidUpCapitalCurrency: data.paidUpCapital?.currency ?? null,
      paidUpCapitalAmount: data.paidUpCapital?.amount ?? null,
      issuedCapitalCurrency: data.issuedCapital?.currency ?? null,
      issuedCapitalAmount: data.issuedCapital?.amount ?? null,
      hasCharges: Boolean(data.charges?.some((charge) => !charge.dischargeDate)),
    },
  });

  await tx.companyFormerName.deleteMany({ where: { companyId } });
  for (const formerName of entityDetails.formerNames ?? []) {
    const effectiveFrom = dateOrNull(formerName.effectiveFrom)
      ?? dateOrNull(formerName.effectiveTo)
      ?? dateOrNull(entityDetails.dateOfNameChange)
      ?? dateOrNull(entityDetails.registrationDate);
    if (!formerName.name.trim() || !effectiveFrom) continue;
    await tx.companyFormerName.create({ data: {
      companyId,
      formerName: formerName.name.trim(),
      effectiveFrom,
      effectiveTo: dateOrNull(formerName.effectiveTo),
      sourceDocumentId: args.documentId,
    } });
  }

  await syncAddress(tx, companyId, args.documentId, 'REGISTERED_OFFICE', data.registeredAddress);
  await syncAddress(tx, companyId, args.documentId, 'MAILING', data.mailingAddress);

  await tx.shareCapital.deleteMany({ where: { companyId } });
  for (const capital of data.shareCapital ?? []) {
    await tx.shareCapital.create({ data: {
      companyId,
      shareClass: capital.shareClass,
      currency: capital.currency,
      numberOfShares: capital.numberOfShares,
      parValue: capital.parValue ?? null,
      totalValue: capital.totalValue,
      isPaidUp: capital.isPaidUp,
      isTreasury: Boolean(capital.isTreasury),
      effectiveDate: new Date(),
      sourceDocumentId: args.documentId,
    } });
  }
  if (data.treasuryShares?.numberOfShares) {
    await tx.shareCapital.create({ data: {
      companyId,
      shareClass: 'TREASURY',
      currency: data.treasuryShares.currency || data.homeCurrency || 'SGD',
      numberOfShares: data.treasuryShares.numberOfShares,
      parValue: null,
      totalValue: 0,
      isPaidUp: false,
      isTreasury: true,
      effectiveDate: new Date(),
      sourceDocumentId: args.documentId,
    } });
  }

  await tx.companyOfficer.updateMany({
    where: { companyId, isCurrent: true },
    data: { isCurrent: false },
  });
  for (const [index, officer] of (data.officers ?? []).entries()) {
    const contactId = await dependencies.resolveContact?.(officer, 'officer', index, companyId) ?? null;
    await tx.companyOfficer.create({ data: {
      companyId,
      contactId,
      role: mapOfficerRole(officer.role),
      name: officer.name,
      identificationType: mapIdentificationType(officer.identificationType),
      identificationNumber: officer.identificationNumber ?? null,
      nationality: officer.nationality ?? null,
      address: officer.address ?? null,
      appointmentDate: dateOrNull(officer.appointmentDate),
      cessationDate: dateOrNull(officer.cessationDate),
      isCurrent: !officer.cessationDate,
      sourceDocumentId: args.documentId,
    } });
  }

  await tx.companyShareholder.updateMany({
    where: { companyId, isCurrent: true },
    data: { isCurrent: false },
  });
  for (const [index, shareholder] of (data.shareholders ?? []).entries()) {
    const contactId = await dependencies.resolveContact?.(shareholder, 'shareholder', index, companyId) ?? null;
    await tx.companyShareholder.create({ data: {
      companyId,
      contactId,
      name: shareholder.name,
      shareholderType: mapContactType(shareholder.type),
      isNominee: Boolean(shareholder.isNominee),
      identificationType: mapIdentificationType(shareholder.identificationType),
      identificationNumber: shareholder.identificationNumber ?? null,
      nationality: shareholder.nationality ?? null,
      placeOfOrigin: shareholder.placeOfOrigin ?? null,
      address: shareholder.address ?? null,
      shareClass: shareholder.shareClass,
      numberOfShares: shareholder.numberOfShares,
      percentageHeld: shareholder.percentageHeld ?? null,
      currency: shareholder.currency || data.homeCurrency || 'SGD',
      isCurrent: true,
      sourceDocumentId: args.documentId,
    } });
  }

  if (data.auditor) {
    await tx.companyAuditor.upsert({
      where: { companyId },
      create: {
        companyId,
        name: data.auditor.name,
        address: data.auditor.address ?? null,
        appointmentDate: dateOrNull(data.auditor.appointmentDate),
        sourceDocumentId: args.documentId,
      },
      update: {
        name: data.auditor.name,
        address: data.auditor.address ?? null,
        appointmentDate: dateOrNull(data.auditor.appointmentDate),
        sourceDocumentId: args.documentId,
      },
    });
  } else {
    await tx.companyAuditor.deleteMany({ where: { companyId } });
  }

  await tx.companyCharge.deleteMany({ where: { companyId } });
  for (const charge of data.charges ?? []) {
    await tx.companyCharge.create({ data: {
      companyId,
      chargeNumber: charge.chargeNumber ?? null,
      chargeType: charge.chargeType ?? null,
      description: charge.description ?? null,
      chargeHolderName: charge.chargeHolderName,
      amountSecured: charge.amountSecured ?? null,
      amountSecuredText: charge.amountSecuredText ?? null,
      currency: charge.currency ?? null,
      registrationDate: dateOrNull(charge.registrationDate),
      dischargeDate: dateOrNull(charge.dischargeDate),
      isFullyDischarged: Boolean(charge.dischargeDate),
      sourceDocumentId: args.documentId,
    } });
  }

  await tx.company.update({
    where: { id: companyId },
    data: {
      currentOfficerCount: (data.officers ?? []).filter((officer) => !officer.cessationDate).length,
      currentShareholderCount: data.shareholders?.length ?? 0,
      activeChargeCount: (data.charges ?? []).filter((charge) => !charge.dischargeDate).length,
    },
  });

  if (scheduleSourceChanged) {
    await enqueueScheduleReconciliation(tx, {
      tenantId: args.tenantId,
      scopeType: 'COMPANY',
      scopeId: companyId,
      triggerType: 'BIZFILE_SOURCE_CHANGED',
      correlationId: args.documentId,
      requestedById: args.userId,
    });
  }

  await tx.auditLog.createMany({
    data: changedSections.map((section) => ({
      tenantId: args.tenantId,
      userId: args.userId,
      companyId,
      action: created ? 'CREATE' as const : 'UPDATE' as const,
      entityType: 'CompanyProfileSection',
      entityId: `${companyId}:${section}`,
      entityName: entityDetails.name,
      changeSource: 'BIZFILE_UPLOAD' as const,
      summary: `${created ? 'Created' : 'Updated'} ${section} from Bizfile`,
      metadata: { documentId: args.documentId, section },
    })),
  });

  return { companyId, created, changedSections: [...changedSections] };
}
