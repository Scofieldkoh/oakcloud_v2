import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import {
  acquireContactMergeBackupBarrier,
  CONTACT_MERGE_BACKUP_BARRIER_TIMEOUT_MS,
  readDatabaseClock,
} from '@/lib/contact-merge-backup-barrier';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';
import { acquireAuthorizationMutationGate } from '@/lib/authorization-mutation-gate';
import {
  buildContactIdentityFingerprint,
  canonicalizeContactAlias,
  canonicalizeContactName,
  normalizeContactDetailValue,
  normalizeContactIdentifier,
} from '@/lib/contact-identity-normalization';
import { scoreContactIdentityMatch } from '@/lib/contact-identity-matching';
import type { ContactIdentityCandidate, ContactIdentityRecord, ContactMatchReason } from '@/types/contact-identity';

const MERGE_FIELDS = [
  'firstName', 'lastName', 'alias', 'identificationType', 'identificationNumber',
  'nationality', 'dateOfBirth', 'corporateName', 'corporateUen', 'fullAddress',
] as const;
type MergeField = (typeof MERGE_FIELDS)[number];

export interface MergeContactsInput {
  idempotencyKey: string;
  masterContactId: string;
  sourceContactIds: string[];
  expectedUpdatedAt: Record<string, string>;
  expectedFingerprints: Record<string, string>;
  fieldDecisions: Partial<Record<MergeField, string | null>>;
}

export interface MergeContactsResult {
  ledgerId: string;
  survivingContactId: string;
  movedCounts: Record<string, number>;
  alreadyCompleted: boolean;
}

export class ContactMergeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactMergeConflictError';
  }
}

type MergeContact = {
  id: string; tenantId: string; contactType: 'INDIVIDUAL' | 'CORPORATE';
  firstName: string | null; lastName: string | null; fullName: string; canonicalName: string | null;
  alias: string | null; identificationType: 'NRIC' | 'FIN' | 'PASSPORT' | 'UEN' | 'OTHER' | null;
  identificationNumber: string | null; nationality: string | null; dateOfBirth: Date | null;
  corporateName: string | null; corporateUen: string | null; fullAddress: string | null;
  isActive: boolean; deletedAt: Date | null; createdAt: Date; updatedAt: Date;
  contactDetails: Array<{ detailType: 'EMAIL' | 'PHONE' | 'WEBSITE' | 'OTHER'; value: string; companyId: string | null }>;
};

type CompanyRelation = {
  id: string; contactId: string; companyId: string; relationship: string;
  isPrimary: boolean; isPoc: boolean; createdAt: Date; deletedAt: Date | null;
};
type ContactDetail = {
  id: string; tenantId: string; contactId: string | null; companyId: string | null;
  detailType: 'EMAIL' | 'PHONE' | 'WEBSITE' | 'OTHER'; value: string; purposes: string[];
  isPrimary: boolean; isPoc: boolean; createdAt: Date; deletedAt: Date | null;
};
type Alias = {
  id: string; normalizedContactId: string; tenantId: string; companyId: string | null;
  rawName: string; confidence: number; createdAt: Date; deletedAt?: Date | null;
};
type AliasDelegate = {
  findMany(args: object): Promise<Alias[]>;
  update(args: object): Promise<unknown>;
  deleteMany(args: object): Promise<unknown>;
};

const contactSelect = {
  id: true, tenantId: true, contactType: true, firstName: true, lastName: true, fullName: true,
  canonicalName: true, alias: true, identificationType: true, identificationNumber: true,
  nationality: true, dateOfBirth: true, corporateName: true, corporateUen: true, fullAddress: true,
  isActive: true, deletedAt: true, createdAt: true, updatedAt: true,
  contactDetails: { where: { deletedAt: null }, select: { detailType: true, value: true, companyId: true } },
} as const;

type CompletedLedger = { id: string; masterContactId: string; sourceContactIds?: string[]; movedRecordCounts: unknown };

function assertLedgerMembership(ledger: CompletedLedger, input: MergeContactsInput): void {
  if (!ledger.sourceContactIds) return;
  const requested = [...input.sourceContactIds].sort();
  const recorded = [...ledger.sourceContactIds].sort();
  if (ledger.masterContactId !== input.masterContactId || requested.length !== recorded.length || requested.some((id, index) => id !== recorded[index])) {
    throw new ContactMergeConflictError('Idempotency key was already used for different merge membership');
  }
}

function completedResult(ledger: CompletedLedger, input: MergeContactsInput): MergeContactsResult {
  assertLedgerMembership(ledger, input);
  return {
    ledgerId: ledger.id,
    survivingContactId: ledger.masterContactId,
    movedCounts: ledger.movedRecordCounts as Record<string, number>,
    alreadyCompleted: true,
  };
}

function identityRecord(contact: MergeContact) {
  return {
    source: 'MANUAL' as const,
    contactType: contact.contactType,
    firstName: contact.firstName,
    lastName: contact.lastName,
    corporateName: contact.corporateName,
    alias: contact.alias,
    identificationType: contact.identificationType,
    identificationNumber: contact.identificationNumber,
    corporateUen: contact.corporateUen,
    dateOfBirth: contact.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    fullAddress: contact.fullAddress,
    contactDetails: contact.contactDetails.map(detail => ({
      detailType: detail.detailType,
      value: detail.value,
      ...(detail.companyId ? { companyId: detail.companyId } : {}),
    })),
  };
}

function validateContacts(contacts: MergeContact[], input: MergeContactsInput, tenantId: string) {
  const ids = [input.masterContactId, ...input.sourceContactIds];
  if (new Set(ids).size !== ids.length || input.sourceContactIds.length === 0) {
    throw new ContactMergeConflictError('Merge contacts must be distinct');
  }
  const byId = new Map(contacts.map(contact => [contact.id, contact]));
  if (contacts.length !== ids.length || contacts.some(contact =>
    contact.tenantId !== tenantId || contact.deletedAt !== null || !contact.isActive)) {
    throw new ContactMergeConflictError('One or more contacts are unavailable');
  }
  for (const id of ids) {
    const contact = byId.get(id);
    if (!contact) throw new ContactMergeConflictError('One or more contacts are unavailable');
    const expectedUpdatedAt = input.expectedUpdatedAt[id];
    if (!expectedUpdatedAt || new Date(expectedUpdatedAt).getTime() !== contact.updatedAt.getTime()) {
      throw new ContactMergeConflictError('Duplicate recommendation is stale');
    }
    const expectedFingerprint = input.expectedFingerprints[id];
    if (expectedFingerprint && buildContactIdentityFingerprint(identityRecord(contact)) !== expectedFingerprint) {
      throw new ContactMergeConflictError('Duplicate recommendation is stale');
    }
  }

  for (const field of MERGE_FIELDS) {
    if (!Object.hasOwn(input.fieldDecisions, field)) continue;
    const selected = input.fieldDecisions[field];
    if (selected === null) continue;
    const comparable = (value: unknown) => field === 'dateOfBirth'
      ? new Date(value as string | Date).toISOString().slice(0, 10)
      : String(value);
    if (!contacts.some(contact => contact[field] != null && comparable(contact[field]) === comparable(selected))) {
      throw new ContactMergeConflictError(`Invalid field decision for ${field}: value is not present in the locked duplicate group`);
    }
  }

  const master = byId.get(input.masterContactId)!;
  const selectedIdentificationType = Object.hasOwn(input.fieldDecisions, 'identificationType')
    ? input.fieldDecisions.identificationType
    : master.identificationType ?? contacts.find(contact => contact.identificationType != null)?.identificationType ?? null;
  const selectedIdentificationNumber = Object.hasOwn(input.fieldDecisions, 'identificationNumber')
    ? input.fieldDecisions.identificationNumber
    : master.identificationNumber ?? contacts.find(contact => contact.identificationNumber != null)?.identificationNumber ?? null;
  const bothCleared = selectedIdentificationType === null && selectedIdentificationNumber === null;
  const pairBelongsToOneContact = selectedIdentificationType !== null && selectedIdentificationNumber !== null &&
    contacts.some(contact => contact.identificationType === selectedIdentificationType &&
      normalizeContactIdentifier(contact.identificationNumber, contact.identificationType) ===
        normalizeContactIdentifier(selectedIdentificationNumber, selectedIdentificationType));
  if (!bothCleared && !pairBelongsToOneContact) {
    throw new ContactMergeConflictError('Selected composite identifier pair must come from one locked contact or both values must be cleared');
  }

  const effectiveIdentificationNumbers = new Set(contacts.flatMap(contact => {
    const value = normalizeContactIdentifier(contact.identificationNumber, contact.identificationType);
    return value ? [value] : [];
  }));
  const effectiveUens = new Set(contacts.flatMap(contact => {
    const value = normalizeContactIdentifier(contact.corporateUen, 'UEN');
    return value ? [value] : [];
  }));
  if (effectiveIdentificationNumbers.size > 1 && !Object.hasOwn(input.fieldDecisions, 'identificationNumber')) {
    throw new ContactMergeConflictError('Unresolved strong identifier conflict');
  }
  if (effectiveUens.size > 1 && !Object.hasOwn(input.fieldDecisions, 'corporateUen')) {
    throw new ContactMergeConflictError('Unresolved strong identifier conflict');
  }
}

function selectedMasterData(master: MergeContact, sources: MergeContact[], decisions: MergeContactsInput['fieldDecisions']) {
  const data: Record<string, string | Date | null> = {};
  for (const field of MERGE_FIELDS) {
    const decided = Object.hasOwn(decisions, field);
    const value = decided ? decisions[field] : master[field] ?? sources.find(source => source[field] != null)?.[field] ?? null;
    if (value !== master[field]) data[field] = field === 'dateOfBirth' && typeof value === 'string' ? new Date(value) : value as string | null;
  }
  const firstName = (data.firstName as string | null | undefined) ?? master.firstName;
  const lastName = (data.lastName as string | null | undefined) ?? master.lastName;
  const corporateName = (data.corporateName as string | null | undefined) ?? master.corporateName;
  if ('firstName' in data || 'lastName' in data || 'corporateName' in data) {
    const fullName = master.contactType === 'CORPORATE' ? corporateName ?? master.fullName : [firstName, lastName].filter(Boolean).join(' ');
    data.fullName = fullName;
    data.canonicalName = canonicalizeContactName(fullName);
  }
  if ('alias' in data) data.canonicalAlias = canonicalizeContactAlias(data.alias as string | null);
  return data;
}

function recalculateRecommendation(contacts: MergeContact[], input: MergeContactsInput) {
  const candidates = contacts.map(contact => ({ ...identityRecord(contact) } satisfies ContactIdentityCandidate));
  const parents = contacts.map((_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const reasonsByContact = new Map<string, Set<ContactMatchReason>>();
  for (let left = 0; left < contacts.length; left += 1) {
    for (let right = left + 1; right < contacts.length; right += 1) {
      const rightRecord: ContactIdentityRecord = {
        ...candidates[right], id: contacts[right].id, tenantId: contacts[right].tenantId,
        canonicalName: contacts[right].canonicalName ?? canonicalizeContactName(contacts[right].fullName), createdAt: contacts[right].createdAt,
        updatedAt: contacts[right].updatedAt, relationshipCount: 0, populatedFieldCount: 0,
      };
      const match = scoreContactIdentityMatch(candidates[left], rightRecord);
      const exactNameConflict = match.blockedByIdentifierConflict &&
        canonicalizeContactName(contacts[left].fullName) === canonicalizeContactName(contacts[right].fullName);
      if (match.score < 0.93 && !exactNameConflict) continue;
      parents[find(right)] = find(left);
      const discoveryReasons = exactNameConflict
        ? (['EXACT_CANONICAL_NAME'] as ContactMatchReason[])
        : match.reasons;
      for (const index of [left, right]) {
        const contactReasons = reasonsByContact.get(contacts[index].id) ?? new Set<ContactMatchReason>();
        discoveryReasons.forEach(reason => contactReasons.add(reason));
        reasonsByContact.set(contacts[index].id, contactReasons);
      }
    }
  }
  if (contacts.some((_, index) => find(index) !== find(0))) {
    throw new ContactMergeConflictError('Duplicate recommendation is stale');
  }
  return contacts.filter(contact => contact.id !== input.masterContactId).map(contact => ({
    sourceContactId: contact.id,
    reasons: [...(reasonsByContact.get(contact.id) ?? [])].sort(),
  }));
}

async function consolidateCompanyRelations(tx: Prisma.TransactionClient, ids: string[], masterId: string, sourceIds: string[]) {
  const rows = await tx.companyContact.findMany({ where: { contactId: { in: ids } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) as CompanyRelation[];
  const groups = new Map<string, CompanyRelation[]>();
  for (const row of rows.filter(row => !row.deletedAt)) {
    const key = `${row.companyId}\0${row.relationship}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const deleted = new Set<string>();
  let moved = 0;
  for (const group of groups.values()) {
    const survivor = group[0];
    const duplicateIds = group.slice(1).map(row => row.id);
    if (duplicateIds.length) {
      await tx.companyContact.deleteMany({ where: { id: { in: duplicateIds } } });
      duplicateIds.forEach(id => deleted.add(id));
    }
    await tx.companyContact.update({ where: { id: survivor.id }, data: {
      ...(survivor.contactId === masterId ? {} : { contactId: masterId }),
      isPrimary: group.some(row => row.isPrimary), isPoc: group.some(row => row.isPoc),
    } });
    if (survivor.contactId !== masterId) moved += 1;
  }
  const discardedSourceIds = rows
    .filter(row => sourceIds.includes(row.contactId) && row.deletedAt && !deleted.has(row.id))
    .map(row => row.id);
  if (discardedSourceIds.length) {
    await tx.companyContact.deleteMany({ where: { id: { in: discardedSourceIds } } });
    discardedSourceIds.forEach(id => deleted.add(id));
  }
  return moved + deleted.size;
}

async function consolidateDetails(tx: Prisma.TransactionClient, ids: string[], masterId: string, sourceIds: string[], tenantId: string) {
  const rows = await tx.contactDetail.findMany({
    where: { tenantId, contactId: { in: ids } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }) as ContactDetail[];
  const activeByScope = new Map<string, ContactDetail[]>();
  for (const row of rows.filter(row => !row.deletedAt)) {
    const scope = `${row.companyId ?? ''}\0${row.detailType}`;
    activeByScope.set(scope, [...(activeByScope.get(scope) ?? []), row]);
  }
  const deleted = new Set<string>();
  let moved = 0;
  for (const scopeRows of activeByScope.values()) {
    const primary = scopeRows.find(row => row.contactId === masterId && row.isPrimary)
      ?? scopeRows.find(row => row.isPrimary);
    const values = new Map<string, ContactDetail[]>();
    for (const row of scopeRows) {
      const key = normalizeContactDetailValue(row.detailType, row.value);
      values.set(key, [...(values.get(key) ?? []), row]);
    }
    for (const duplicates of values.values()) {
      const survivor = duplicates.find(row => row.contactId === masterId) ?? duplicates[0];
      await tx.contactDetail.update({ where: { id: survivor.id }, data: {
        ...(survivor.contactId === masterId ? {} : { contactId: masterId }),
        purposes: [...new Set(duplicates.flatMap(row => row.purposes))].sort(),
        isPrimary: primary ? duplicates.some(row => row.id === primary.id) : false,
        isPoc: duplicates.some(row => row.isPoc),
      } });
      if (survivor.contactId !== masterId) moved += 1;
      duplicates.filter(row => row.id !== survivor.id).forEach(row => deleted.add(row.id));
    }
  }
  rows.filter(row => sourceIds.includes(row.contactId ?? '') && row.deletedAt).forEach(row => deleted.add(row.id));
  if (deleted.size) await tx.contactDetail.deleteMany({ where: { id: { in: [...deleted] } } });
  return moved + deleted.size;
}

async function moveNotes(tx: Prisma.TransactionClient, ids: string[], masterId: string, sourceIds: string[]) {
  const notes = await tx.noteTab.findMany({ where: { contactId: { in: ids } }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
  const sourceOrder = new Map(sourceIds.map((id, index) => [id, index]));
  notes.sort((left, right) => {
    const leftGroup = left.contactId === masterId ? -1 : sourceOrder.get(left.contactId ?? '') ?? sourceIds.length;
    const rightGroup = right.contactId === masterId ? -1 : sourceOrder.get(right.contactId ?? '') ?? sourceIds.length;
    return leftGroup - rightGroup || left.order - right.order || left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id);
  });
  for (let order = 0; order < notes.length; order += 1) {
    await tx.noteTab.update({ where: { id: notes[order].id }, data: { contactId: masterId, order } });
  }
  return notes.filter(note => note.contactId !== masterId).length;
}

async function consolidateAliases(
  delegate: AliasDelegate,
  ids: string[], masterId: string, tenantId: string,
) {
  const rows = await delegate.findMany({
    where: { tenantId, normalizedContactId: { in: ids } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }) as Alias[];
  const groups = new Map<string, Alias[]>();
  for (const row of rows.filter(row => !row.deletedAt)) {
    const key = `${row.companyId ?? ''}\0${canonicalizeContactName(row.rawName)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const deleted = new Set(rows.filter(row => row.deletedAt).map(row => row.id));
  let moved = 0;
  for (const group of groups.values()) {
    const survivor = [...group].sort((left, right) => right.confidence - left.confidence || left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))[0];
    if (survivor.normalizedContactId !== masterId) {
      await delegate.update({ where: { id: survivor.id }, data: { normalizedContactId: masterId } });
      moved += 1;
    }
    group.filter(row => row.id !== survivor.id).forEach(row => deleted.add(row.id));
  }
  if (deleted.size) await delegate.deleteMany({ where: { id: { in: [...deleted] } } });
  return moved + deleted.size;
}

async function assertNoReferences(tx: Prisma.TransactionClient, sourceIds: string[], tenantId: string) {
  const checks = await Promise.all([
    tx.companyContact.count({ where: { contactId: { in: sourceIds } } }),
    tx.contactDetail.count({ where: { tenantId, contactId: { in: sourceIds } } }),
    tx.noteTab.count({ where: { contactId: { in: sourceIds } } }),
    tx.companyOfficer.count({ where: { contactId: { in: sourceIds } } }),
    tx.companyShareholder.count({ where: { contactId: { in: sourceIds } } }),
    tx.companyCharge.count({ where: { chargeHolderId: { in: sourceIds } } }),
    tx.documentRevision.count({ where: { vendorId: { in: sourceIds } } }),
    tx.documentRevision.count({ where: { customerId: { in: sourceIds } } }),
    tx.vendorAlias.count({ where: { tenantId, normalizedContactId: { in: sourceIds } } }),
    tx.customerAlias.count({ where: { tenantId, normalizedContactId: { in: sourceIds } } }),
  ]);
  if (checks.some(count => count !== 0)) throw new Error('Source contact reference assertion failed');
}

export async function mergeContacts(
  input: MergeContactsInput,
  params: { tenantId: string; userId: string },
): Promise<MergeContactsResult> {
  const existing = await prisma.contactMergeOperation.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: params.tenantId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return completedResult(existing, input);

  try {
    return await prisma.$transaction(async tx => {
      await acquireBusinessOperationBarrier(tx, params.tenantId, 'shared');
      await acquireContactMergeBackupBarrier(tx, params.tenantId);
      await acquireAuthorizationMutationGate(tx);
      const approvedAt = await readDatabaseClock(tx);
      const alreadyStarted = await tx.contactMergeOperation.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: params.tenantId, idempotencyKey: input.idempotencyKey } },
      });
      if (alreadyStarted) return completedResult(alreadyStarted, input);

    const sortedIds = [input.masterContactId, ...input.sourceContactIds].sort();
    const locked = await tx.$queryRaw<Array<{ id: string; updatedAt: Date }>>(
      Prisma.sql`SELECT "id", "updatedAt" FROM "contacts" WHERE "tenantId" = ${params.tenantId} AND "id" IN (${Prisma.join(sortedIds)}) ORDER BY "id" FOR UPDATE`,
    );
    if (locked.length !== sortedIds.length) {
      const completed = await tx.contactMergeOperation.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: params.tenantId, idempotencyKey: input.idempotencyKey } },
      });
      if (completed) return completedResult(completed, input);
      throw new ContactMergeConflictError('One or more contacts are unavailable');
    }

    const contacts = await tx.contact.findMany({
      where: { id: { in: sortedIds }, tenantId: params.tenantId, deletedAt: null, isActive: true },
      select: contactSelect, orderBy: { id: 'asc' },
    }) as MergeContact[];
    validateContacts(contacts, input, params.tenantId);
    const matchingReasons = recalculateRecommendation(contacts, input);
    const byId = new Map(contacts.map(contact => [contact.id, contact]));
    const master = byId.get(input.masterContactId)!;
    const sources = input.sourceContactIds.map(id => byId.get(id)!);
    const submittedSourceIds = [...input.sourceContactIds];
    const sourceIds = [...input.sourceContactIds].sort();
    const snapshots = JSON.parse(JSON.stringify(
      contacts.map(({ contactDetails: _contactDetails, ...contact }) => contact),
    )) as Array<Record<string, unknown>>;
    const masterData = selectedMasterData(master, sources, input.fieldDecisions);
    const selectedIdentificationType = Object.hasOwn(masterData, 'identificationType')
      ? masterData.identificationType as MergeContact['identificationType']
      : master.identificationType;
    const selectedIdentificationNumber = Object.hasOwn(masterData, 'identificationNumber')
      ? masterData.identificationNumber as string | null
      : master.identificationNumber;
    if (selectedIdentificationType && selectedIdentificationNumber) {
      const conflictingSourceIds = sources
        .filter(source => source.identificationType === selectedIdentificationType
          && source.identificationNumber === selectedIdentificationNumber)
        .map(source => source.id);
      if (conflictingSourceIds.length) {
        await tx.contact.updateMany({
          where: {
            id: { in: conflictingSourceIds },
            tenantId: params.tenantId,
            identificationType: selectedIdentificationType,
            identificationNumber: selectedIdentificationNumber,
          },
          data: { identificationType: null, identificationNumber: null },
        });
      }
    }

    await tx.contact.update({ where: { id: master.id }, data: masterData });
    const movedCounts: Record<string, number> = {};
    movedCounts.companyContacts = await consolidateCompanyRelations(tx, sortedIds, master.id, sourceIds);
    movedCounts.contactDetails = await consolidateDetails(tx, sortedIds, master.id, sourceIds, params.tenantId);
    movedCounts.notes = await moveNotes(tx, sortedIds, master.id, submittedSourceIds);
    const officers = await tx.companyOfficer.updateMany({ where: { contactId: { in: sourceIds } }, data: { contactId: master.id } });
    const shareholders = await tx.companyShareholder.updateMany({ where: { contactId: { in: sourceIds } }, data: { contactId: master.id } });
    const charges = await tx.companyCharge.updateMany({ where: { chargeHolderId: { in: sourceIds } }, data: { chargeHolderId: master.id } });
    const vendorRevisions = await tx.documentRevision.updateMany({ where: { vendorId: { in: sourceIds } }, data: { vendorId: master.id } });
    const customerRevisions = await tx.documentRevision.updateMany({ where: { customerId: { in: sourceIds } }, data: { customerId: master.id } });
    movedCounts.companyOfficers = officers?.count ?? 0;
    movedCounts.companyShareholders = shareholders?.count ?? 0;
    movedCounts.companyCharges = charges?.count ?? 0;
    movedCounts.documentRevisionVendors = vendorRevisions?.count ?? 0;
    movedCounts.documentRevisionCustomers = customerRevisions?.count ?? 0;
    movedCounts.vendorAliases = await consolidateAliases(tx.vendorAlias as unknown as AliasDelegate, sortedIds, master.id, params.tenantId);
    movedCounts.customerAliases = await consolidateAliases(tx.customerAlias as unknown as AliasDelegate, sortedIds, master.id, params.tenantId);

    await assertNoReferences(tx, sourceIds, params.tenantId);
    const fingerprints = Object.fromEntries(contacts.map(contact => [contact.id, buildContactIdentityFingerprint(identityRecord(contact))]));
    const ledger = await tx.contactMergeOperation.create({ data: {
      tenantId: params.tenantId, idempotencyKey: input.idempotencyKey, masterContactId: master.id,
      masterSnapshot: snapshots.find(contact => contact.id === master.id) as Prisma.InputJsonValue,
      sourceContactIds: sourceIds,
      sourceSnapshots: snapshots.filter(contact => contact.id !== master.id) as Prisma.InputJsonValue,
      fingerprints: fingerprints as Prisma.InputJsonValue,
      fieldDecisions: input.fieldDecisions as Prisma.InputJsonValue,
      movedRecordCounts: movedCounts as Prisma.InputJsonValue,
      matchingReasons: matchingReasons as Prisma.InputJsonValue,
      approvedById: params.userId,
      approvedAt,
    } });
    await tx.auditLog.create({ data: {
      tenantId: params.tenantId, userId: params.userId, action: 'MERGE',
      entityType: 'ContactMergeOperation', entityId: ledger.id,
      summary: `Merged ${sourceIds.length} duplicate contacts into ${master.id}`,
      metadata: { masterContactId: master.id, sourceContactIds: sourceIds, movedRecordCounts: movedCounts },
    } });
    await tx.contact.deleteMany({ where: { id: { in: sourceIds }, tenantId: params.tenantId } });
    return { ledgerId: ledger.id, survivingContactId: master.id, movedCounts, alreadyCompleted: false };
    }, {
      isolationLevel: 'Serializable',
      timeout: CONTACT_MERGE_BACKUP_BARRIER_TIMEOUT_MS,
    });
  } catch (error) {
    const serializationFailure = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034';
    if (serializationFailure || error instanceof ContactMergeConflictError) {
      const completed = await prisma.contactMergeOperation.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: params.tenantId, idempotencyKey: input.idempotencyKey } },
      });
      if (completed) return completedResult(completed, input);
      if (serializationFailure) throw new ContactMergeConflictError('Duplicate recommendation is stale');
    }
    throw error;
  }
}
