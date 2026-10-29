import type { Prisma } from '@/generated/prisma';
import type { PrismaTransactionClient } from '@/services/contact.service';
import type { CompanyProfileSectionId } from '@/lib/company-profile-sections';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';

import {
  assertBizFileChangePlan,
  assertSafeBizFileNumbers,
  selectedBizFileChanges,
  type BizFileChange,
  type BizFileChangePlan,
} from './change-plan';
import type { ExtractedBizFileData } from './types';
import {
  mapCompanyStatus,
  mapContactType,
  mapEntityType,
  mapIdentificationType,
  mapOfficerRole,
} from './types';
import { buildFullAddress } from './normalizer';

type Officer = NonNullable<ExtractedBizFileData['officers']>[number];
type Shareholder = NonNullable<ExtractedBizFileData['shareholders']>[number];

export interface CanonicalBizFileSyncDependencies {
  resolveContact?: (
    record: Officer | Shareholder,
    kind: 'officer' | 'shareholder',
    sourceIndex: number,
    companyId: string,
  ) => Promise<string | null>;
}

export interface CanonicalBizFileSyncArgs {
  data: ExtractedBizFileData;
  documentId: string;
  tenantId: string;
  userId: string;
  existingCompanyId?: string;
  plan: BizFileChangePlan;
}

export interface CanonicalBizFileSyncResult {
  companyId: string;
  created: boolean;
  beforeRevision: number;
  afterRevision: number;
  changedSections: CompanyProfileSectionId[];
  selectedChanges: BizFileChange[];
  operationStatus: 'COMMITTED' | 'NO_CHANGE';
}

type DelegateMethod = (...args: unknown[]) => Promise<unknown>;
type Delegate = Record<string, DelegateMethod | undefined>;

function delegate(tx: PrismaTransactionClient, name: string): Delegate | null {
  const value = (tx as unknown as Record<string, unknown>)[name];
  return value && typeof value === 'object' ? value as Delegate : null;
}

function method<T extends DelegateMethod>(value: Delegate | null, name: string): T | undefined {
  const candidate = value?.[name];
  return typeof candidate === 'function' ? candidate as T : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dateOrNull(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function changeAt(changes: BizFileChange[], path: string): BizFileChange | undefined {
  return changes.find((change) => change.path === path);
}

function changeValue(change: BizFileChange): unknown {
  return change.operation === 'CLEAR' ? null : change.after;
}

function companyScalarData(changes: BizFileChange[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const set = (path: string, field: string, transform: (value: unknown) => unknown = (value) => value) => {
    const change = changeAt(changes, path);
    if (change) data[field] = transform(changeValue(change));
  };
  set('entityDetails.name', 'name');
  set('entityDetails.displayAlias', 'displayAlias');
  set('entityDetails.formerName', 'formerName');
  set('entityDetails.dateOfNameChange', 'dateOfNameChange', dateOrNull);
  set('entityDetails.entityType', 'entityType', (value) => mapEntityType(typeof value === 'string' ? value : null));
  set('entityDetails.status', 'status', (value) => mapCompanyStatus(typeof value === 'string' ? value : null));
  set('entityDetails.statusDate', 'statusDate', dateOrNull);
  set('entityDetails.incorporationDate', 'incorporationDate', dateOrNull);
  set('entityDetails.registrationDate', 'registrationDate', dateOrNull);
  set('ssicActivities.primary.code', 'primarySsicCode');
  set('ssicActivities.primary.description', 'primarySsicDescription');
  set('ssicActivities.secondary.code', 'secondarySsicCode');
  set('ssicActivities.secondary.description', 'secondarySsicDescription');
  set('financialYear.endDay', 'financialYearEndDay');
  set('financialYear.endMonth', 'financialYearEndMonth');
  set('compliance.lastAgmDate', 'lastAgmDate', dateOrNull);
  set('compliance.lastArFiledDate', 'lastArFiledDate', dateOrNull);
  set('compliance.accountsDueDate', 'accountsDueDate', dateOrNull);
  set('compliance.fyeAsAtLastAr', 'fyeAsAtLastAr', dateOrNull);
  set('homeCurrency', 'homeCurrency');
  for (const path of ['paidUpCapital', 'issuedCapital']) {
    const change = changeAt(changes, path);
    if (!change) continue;
    const value = record(changeValue(change));
    const prefix = path === 'paidUpCapital' ? 'paidUpCapital' : 'issuedCapital';
    data[`${prefix}Amount`] = value.amount ?? null;
    data[`${prefix}Currency`] = value.currency ?? null;
  }
  return data;
}

function toAddressData(change: BizFileChange, documentId: string): Record<string, unknown> {
  const value = record(change.after);
  return {
    block: value.block ?? null,
    streetName: String(value.streetName ?? ''),
    level: value.level ?? null,
    unit: value.unit ?? null,
    buildingName: value.buildingName ?? null,
    postalCode: String(value.postalCode ?? ''),
    country: value.country || 'Singapore',
    fullAddress: buildFullAddress(value as { streetName: string; postalCode: string }),
    effectiveFrom: dateOrNull(value.effectiveFrom),
    effectiveTo: null,
    isCurrent: true,
    sourceDocumentId: documentId,
  };
}

function toFormerNameData(change: BizFileChange, companyId: string, documentId: string): Record<string, unknown> {
  const value = record(change.after);
  return {
    companyId,
    formerName: String(value.name ?? value.formerName ?? ''),
    effectiveFrom: dateOrNull(value.effectiveFrom) ?? new Date(),
    effectiveTo: dateOrNull(value.effectiveTo),
    sourceDocumentId: documentId,
  };
}

function toShareCapitalData(change: BizFileChange, companyId: string, documentId: string): Record<string, unknown> {
  const value = record(change.after);
  return {
    companyId,
    shareClass: String(value.shareClass ?? 'ORDINARY'),
    currency: String(value.currency ?? 'SGD'),
    numberOfShares: value.numberOfShares,
    parValue: value.parValue ?? null,
    totalValue: value.totalValue ?? 0,
    isPaidUp: value.isPaidUp !== false,
    isTreasury: Boolean(value.isTreasury),
    effectiveDate: dateOrNull(value.effectiveDate) ?? new Date(),
    sourceDocumentId: documentId,
  };
}

function toOfficerData(change: BizFileChange, companyId: string, documentId: string, contactId: string | null): Record<string, unknown> {
  const value = record(change.after);
  return {
    companyId,
    contactId,
    role: mapOfficerRole(typeof value.role === 'string' ? value.role : null),
    name: String(value.name ?? ''),
    identificationType: mapIdentificationType(typeof value.identificationType === 'string' ? value.identificationType : undefined),
    identificationNumber: value.identificationNumber ?? null,
    nationality: value.nationality ?? null,
    address: value.address ?? null,
    appointmentDate: dateOrNull(value.appointmentDate),
    cessationDate: dateOrNull(value.cessationDate),
    isCurrent: !value.cessationDate,
    sourceDocumentId: documentId,
  };
}

function toShareholderData(change: BizFileChange, companyId: string, documentId: string, contactId: string | null): Record<string, unknown> {
  const value = record(change.after);
  return {
    companyId,
    contactId,
    name: String(value.name ?? ''),
    shareholderType: mapContactType(typeof value.type === 'string' ? value.type : null),
    isNominee: Boolean(value.isNominee),
    identificationType: mapIdentificationType(typeof value.identificationType === 'string' ? value.identificationType : undefined),
    identificationNumber: value.identificationNumber ?? null,
    nationality: value.nationality ?? null,
    placeOfOrigin: value.placeOfOrigin ?? null,
    address: value.address ?? null,
    shareClass: String(value.shareClass ?? 'ORDINARY'),
    numberOfShares: value.numberOfShares,
    percentageHeld: value.percentageHeld ?? null,
    currency: value.currency ?? 'SGD',
    isCurrent: true,
    sourceDocumentId: documentId,
  };
}

function toChargeData(change: BizFileChange, companyId: string, documentId: string): Record<string, unknown> {
  const value = record(change.after);
  return {
    companyId,
    chargeNumber: value.chargeNumber ?? null,
    chargeType: value.chargeType ?? null,
    description: value.description ?? null,
    chargeHolderName: String(value.chargeHolderName ?? ''),
    amountSecured: value.amountSecured ?? null,
    amountSecuredText: value.amountSecuredText ?? null,
    currency: value.currency ?? null,
    registrationDate: dateOrNull(value.registrationDate),
    dischargeDate: dateOrNull(value.dischargeDate),
    isFullyDischarged: Boolean(value.dischargeDate),
    sourceDocumentId: documentId,
  };
}

async function lockAggregate(tx: PrismaTransactionClient, tenantId: string, companyId: string | undefined, uen: string): Promise<void> {
  const raw = tx as unknown as {
    $executeRaw?: (...args: unknown[]) => Promise<unknown>;
    $queryRawUnsafe?: (...args: unknown[]) => Promise<unknown>;
  };
  if (typeof raw.$executeRaw === 'function') {
    await acquireBusinessOperationBarrier(raw as Pick<Prisma.TransactionClient, '$executeRaw'>, tenantId, 'shared');
  }
  if (typeof raw.$queryRawUnsafe === 'function' && companyId) {
    await raw.$queryRawUnsafe('SELECT id FROM companies WHERE "tenantId" = $1 AND id = $2 FOR UPDATE', tenantId, companyId);
  } else if (typeof raw.$queryRawUnsafe === 'function') {
    await raw.$queryRawUnsafe(
      'SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended($1, 0))) AS aggregate_lock',
      `oakcloud:bizfile:create:${tenantId}:${uen}`,
    );
  }
}

async function resolveContact(
  change: BizFileChange,
  companyId: string,
  kind: 'officer' | 'shareholder',
  dependencies: CanonicalBizFileSyncDependencies,
): Promise<string | null> {
  const before = record(change.before);
  const after = record(change.after);
  const existing = typeof before.contactId === 'string' ? before.contactId : null;
  if (change.operation !== 'ADD' && !after.contactResolution) return existing;
  if (!dependencies.resolveContact) throw new Error(`Contact decision is required for ${change.sourceRecordId ?? change.id}`);
  const index = Number((change.sourceRecordId ?? '').split('.').at(-1) ?? 0);
  return dependencies.resolveContact(
    after as Officer | Shareholder,
    kind,
    Number.isFinite(index) ? index : 0,
    companyId,
  );
}

/**
 * Canonical selected-change application. Every domain write for an approved
 * plan passes through this function so UI and assistant callers share the
 * same operation vocabulary and stale/create checks.
 */
export async function applyBizFileChangePlanInTransaction(
  args: CanonicalBizFileSyncArgs,
  tx: PrismaTransactionClient,
  dependencies: CanonicalBizFileSyncDependencies = {},
): Promise<CanonicalBizFileSyncResult> {
  const plan = args.plan;
  assertBizFileChangePlan(plan);
  if (plan.tenantId !== args.tenantId || plan.documentId !== args.documentId) throw new Error('BizFile plan workspace or source mismatch');
  if (plan.reviewedData.entityDetails.uen !== args.data.entityDetails.uen) throw new Error('BizFile plan data mismatch');
  if (plan.mode === 'UPDATE' && (plan.targetCompanyId !== args.existingCompanyId || !args.existingCompanyId)) throw new Error('BizFile plan target mismatch');
  if (plan.mode === 'CREATE' && args.existingCompanyId) throw new Error('CREATE cannot target an existing company');
  assertSafeBizFileNumbers(plan.reviewedData);
  const selectedChanges = selectedBizFileChanges(plan);

  const company = delegate(tx, 'company');
  const findCompany = method<(input: unknown) => Promise<unknown>>(company, 'findFirst');
  const createCompany = method<(input: unknown) => Promise<unknown>>(company, 'create');
  const updateCompany = method<(input: unknown) => Promise<unknown>>(company, 'update');
  if (!findCompany || !updateCompany) throw new Error('Canonical BizFile sync requires company find/update delegates');
  await lockAggregate(tx, args.tenantId, plan.mode === 'UPDATE' ? plan.targetCompanyId : undefined, plan.reviewedData.entityDetails.uen);

  let companyId: string;
  let created = false;
  let beforeRevision = 0;
  let afterRevision = 0;
  if (plan.mode === 'CREATE') {
    const requiredCreatePaths = ['entityDetails.name', 'entityDetails.entityType', 'entityDetails.status'];
    const selectedPathSet = new Set(selectedChanges.map((change) => change.path));
    const missingRequiredPath = requiredCreatePaths.find((path) => !selectedPathSet.has(path));
    if (missingRequiredPath) {
      throw new Error(`CREATE requires the reviewed change ${missingRequiredPath}`);
    }
    const existing = record(await findCompany({ where: { tenantId: args.tenantId, uen: plan.reviewedData.entityDetails.uen }, select: { id: true, deletedAt: true } }));
    if (existing.id) throw new Error(`Cannot CREATE BizFile company: UEN ${plan.reviewedData.entityDetails.uen} already exists`);
    if (!createCompany) throw new Error('Canonical CREATE requires company.create');
    const createdCompany = record(await createCompany({
      data: {
        tenantId: args.tenantId,
        uen: plan.reviewedData.entityDetails.uen,
        name: plan.reviewedData.entityDetails.name,
        entityType: mapEntityType(plan.reviewedData.entityDetails.entityType),
        status: mapCompanyStatus(plan.reviewedData.entityDetails.status),
        aggregateRevision: 1,
        ...companyScalarData(selectedChanges),
      },
      select: { id: true },
    }));
    if (typeof createdCompany.id !== 'string') throw new Error('Canonical CREATE did not return a company ID');
    companyId = createdCompany.id;
    created = true;
    afterRevision = 1;
  } else {
    const current = record(await findCompany({ where: { id: plan.targetCompanyId, tenantId: args.tenantId, deletedAt: null }, select: { id: true, uen: true, updatedAt: true, aggregateRevision: true } }));
    if (!current.id) throw new Error('Company not found for canonical BizFile update');
    if (current.uen !== plan.reviewedData.entityDetails.uen) throw new Error(`UEN mismatch: expected ${String(current.uen)}, got ${plan.reviewedData.entityDetails.uen}`);
    companyId = String(current.id);
    beforeRevision = typeof current.aggregateRevision === 'number' ? current.aggregateRevision : 0;
    if (beforeRevision !== plan.expectedAggregateRevision) {
      throw new Error(`STALE_BIZFILE_PLAN: expected aggregate revision ${plan.expectedAggregateRevision}, found ${beforeRevision}`);
    }
    const expected = plan.expectedUpdatedAt ?? plan.baseline.updatedAt;
    if (expected && current.updatedAt) {
      const expectedTime = new Date(expected).getTime();
      const currentTime = new Date(String(current.updatedAt)).getTime();
      if (!Number.isNaN(expectedTime) && !Number.isNaN(currentTime) && expectedTime !== currentTime) throw new Error('STALE_BIZFILE_PLAN: company changed after preparation');
    }
    const updates = companyScalarData(selectedChanges);
    if (selectedChanges.length > 0) {
      afterRevision = beforeRevision + 1;
      updates.aggregateRevision = afterRevision;
      await updateCompany({ where: { id: companyId }, data: updates });
    } else {
      afterRevision = beforeRevision;
    }
  }

  const address = delegate(tx, 'companyAddress');
  const findAddress = method<(input: unknown) => Promise<unknown>>(address, 'findFirst');
  const updateAddress = method<(input: unknown) => Promise<unknown>>(address, 'update');
  const createAddress = method<(input: unknown) => Promise<unknown>>(address, 'create');
  for (const change of selectedChanges.filter((candidate) => candidate.path.startsWith('addresses.'))) {
    const addressType = change.path.endsWith('registered') ? 'REGISTERED_OFFICE' : 'MAILING';
    const current = findAddress ? record(await findAddress({ where: { companyId, addressType, isCurrent: true } })) : {};
    if (change.operation === 'REMOVE' || change.operation === 'CLEAR') {
      if (current.id && updateAddress) await updateAddress({ where: { id: current.id }, data: { isCurrent: false, effectiveTo: new Date() } });
    } else if (current.id && updateAddress) await updateAddress({ where: { id: current.id }, data: toAddressData(change, args.documentId) });
    else if (createAddress) await createAddress({ data: { companyId, addressType, ...toAddressData(change, args.documentId) } });
  }

  const formerNames = delegate(tx, 'companyFormerName');
  const createFormerName = method<(input: unknown) => Promise<unknown>>(formerNames, 'create');
  const updateFormerName = method<(input: unknown) => Promise<unknown>>(formerNames, 'update');
  const deleteFormerName = method<(input: unknown) => Promise<unknown>>(formerNames, 'delete');
  for (const change of selectedChanges.filter((candidate) => candidate.path === 'formerNames')) {
    if (change.operation === 'REMOVE') {
      if (change.targetId && deleteFormerName) await deleteFormerName({ where: { id: change.targetId } });
    } else if (change.operation === 'UPDATE' && change.targetId && updateFormerName) await updateFormerName({ where: { id: change.targetId }, data: toFormerNameData(change, companyId, args.documentId) });
    else if (change.operation === 'ADD' && createFormerName) await createFormerName({ data: toFormerNameData(change, companyId, args.documentId) });
  }

  const capital = delegate(tx, 'shareCapital');
  const createCapital = method<(input: unknown) => Promise<unknown>>(capital, 'create');
  const updateCapital = method<(input: unknown) => Promise<unknown>>(capital, 'update');
  const deleteCapital = method<(input: unknown) => Promise<unknown>>(capital, 'delete');
  for (const change of selectedChanges.filter((candidate) => candidate.path === 'shareCapital' || candidate.path === 'treasuryShares')) {
    if (change.operation === 'REMOVE') {
      if (change.targetId && deleteCapital) await deleteCapital({ where: { id: change.targetId } });
      continue;
    }
    const value = change.path === 'treasuryShares'
      ? { ...record(change.after), shareClass: 'TREASURY', isTreasury: true, totalValue: 0, isPaidUp: false }
      : change.after;
    const capitalChange = { ...change, after: value };
    if (change.operation === 'UPDATE' && change.targetId && updateCapital) await updateCapital({ where: { id: change.targetId }, data: toShareCapitalData(capitalChange, companyId, args.documentId) });
    else if (change.operation === 'ADD' && createCapital) await createCapital({ data: toShareCapitalData(capitalChange, companyId, args.documentId) });
  }

  const officers = delegate(tx, 'companyOfficer');
  const createOfficer = method<(input: unknown) => Promise<unknown>>(officers, 'create');
  const updateOfficer = method<(input: unknown) => Promise<unknown>>(officers, 'update');
  for (const change of selectedChanges.filter((candidate) => candidate.path === 'officers')) {
    const contactId = await resolveContact(change, companyId, 'officer', dependencies);
    if (change.operation === 'CEASE') {
      const cessationDate = dateOrNull(record(change.after).cessationDate);
      if (!cessationDate) throw new Error('The approved officer cessation has no explicit date');
      if (change.targetId && updateOfficer) await updateOfficer({ where: { id: change.targetId }, data: { isCurrent: false, cessationDate, sourceDocumentId: args.documentId } });
    } else if (change.operation === 'UPDATE' && change.targetId && updateOfficer) {
      const data = toOfficerData(change, companyId, args.documentId, contactId);
      delete data.companyId;
      await updateOfficer({ where: { id: change.targetId }, data });
    } else if (change.operation === 'ADD' && createOfficer) await createOfficer({ data: toOfficerData(change, companyId, args.documentId, contactId) });
  }

  const shareholders = delegate(tx, 'companyShareholder');
  const createShareholder = method<(input: unknown) => Promise<unknown>>(shareholders, 'create');
  const updateShareholder = method<(input: unknown) => Promise<unknown>>(shareholders, 'update');
  for (const change of selectedChanges.filter((candidate) => candidate.path === 'shareholders')) {
    const contactId = await resolveContact(change, companyId, 'shareholder', dependencies);
    if (change.operation === 'REMOVE') {
      if (change.targetId && updateShareholder) await updateShareholder({ where: { id: change.targetId }, data: { isCurrent: false } });
    } else if (change.operation === 'UPDATE' && change.targetId && updateShareholder) {
      const data = toShareholderData(change, companyId, args.documentId, contactId);
      delete data.companyId;
      await updateShareholder({ where: { id: change.targetId }, data });
    } else if (change.operation === 'ADD' && createShareholder) await createShareholder({ data: toShareholderData(change, companyId, args.documentId, contactId) });
  }

  const auditorChange = changeAt(selectedChanges, 'auditor');
  if (auditorChange) {
    const auditors = delegate(tx, 'companyAuditor');
    const upsertAuditor = method<(input: unknown) => Promise<unknown>>(auditors, 'upsert');
    const deleteAuditor = method<(input: unknown) => Promise<unknown>>(auditors, 'deleteMany');
    const value = auditorChange.after == null ? null : record(auditorChange.after);
    if (!value) {
      if (deleteAuditor) await deleteAuditor({ where: { companyId } });
    } else if (upsertAuditor) {
      const auditorData = { name: String(value.name ?? ''), address: value.address ?? null, appointmentDate: dateOrNull(value.appointmentDate), sourceDocumentId: args.documentId };
      await upsertAuditor({ where: { companyId }, create: { companyId, ...auditorData }, update: auditorData });
    }
  }

  const charges = delegate(tx, 'companyCharge');
  const createCharge = method<(input: unknown) => Promise<unknown>>(charges, 'create');
  const updateCharge = method<(input: unknown) => Promise<unknown>>(charges, 'update');
  const deleteCharge = method<(input: unknown) => Promise<unknown>>(charges, 'delete');
  for (const change of selectedChanges.filter((candidate) => candidate.path === 'charges')) {
    if (change.operation === 'REMOVE') {
      if (change.targetId && deleteCharge) await deleteCharge({ where: { id: change.targetId } });
    } else if (change.operation === 'UPDATE' && change.targetId && updateCharge) {
      const data = toChargeData(change, companyId, args.documentId);
      delete data.companyId;
      await updateCharge({ where: { id: change.targetId }, data });
    } else if (change.operation === 'ADD' && createCharge) await createCharge({ data: toChargeData(change, companyId, args.documentId) });
  }

  const counts: Record<string, number> = {};
  for (const [path, delegateName, field] of [
    ['officers', 'companyOfficer', 'currentOfficerCount'],
    ['shareholders', 'companyShareholder', 'currentShareholderCount'],
  ]) {
    if (!selectedChanges.some((change) => change.path === path)) continue;
    const count = method<(input: unknown) => Promise<number>>(delegate(tx, delegateName), 'count');
    if (!count) throw new Error(`Canonical ${path} count is unavailable`);
    counts[field] = await count({ where: { companyId, isCurrent: true } });
  }
  if (Object.keys(counts).length) await tx.company.update({ where: { id: companyId }, data: counts });

  return {
    companyId,
    created,
    beforeRevision,
    afterRevision,
    changedSections: [...new Set(selectedChanges.map((change) => change.section))] as CompanyProfileSectionId[],
    selectedChanges,
    operationStatus: created || selectedChanges.length > 0 ? 'COMMITTED' : 'NO_CHANGE',
  };
}
