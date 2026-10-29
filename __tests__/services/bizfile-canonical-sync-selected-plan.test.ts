import { describe, expect, it, vi } from 'vitest';

import type { PrismaTransactionClient } from '@/services/contact.service';
import type { ExtractedBizFileData } from '@/services/bizfile/types';
import {
  applyBizFileChangePlanInTransaction,
  type CanonicalBizFileSyncArgs,
} from '@/services/bizfile/canonical-sync';
import {
  assertBizFileChangePlan,
  buildBizFileChangePlan,
  hashBizFileValue,
  type BizFileBaselineSnapshot,
  type BizFileChangePlan,
} from '@/services/bizfile/change-plan';

const tenantId = 'tenant-1';
const documentId = 'document-1';
const companyId = 'company-1';
const uen = '202400001A';

function reviewedData(name: string, displayAlias?: string | null): ExtractedBizFileData {
  const entityDetails: ExtractedBizFileData['entityDetails'] = {
    uen,
    name,
    entityType: 'PRIVATE_LIMITED',
    status: 'LIVE',
  };
  if (displayAlias !== undefined) entityDetails.displayAlias = displayAlias;
  return { entityDetails };
}

function baseline(overrides: Record<string, unknown> = {}): BizFileBaselineSnapshot {
  return {
    company: {
      id: companyId,
      tenantId,
      uen,
      name: 'Old Name Pte Ltd',
      displayAlias: 'OLD',
      entityType: 'PRIVATE_LIMITED',
      status: 'LIVE',
      aggregateRevision: 3,
      ...overrides,
    },
    // These rows make the scalar-only execution assertion meaningful. They
    // must remain untouched when their source sections are omitted.
    addresses: [{ id: 'address-1', addressType: 'REGISTERED_OFFICE', postalCode: '018989' }],
    officers: [{ id: 'officer-1', name: 'Existing Officer', role: 'DIRECTOR' }],
    shareholders: [{ id: 'shareholder-1', name: 'Existing Shareholder', numberOfShares: 10 }],
    shareCapital: [{ id: 'capital-1', shareClass: 'ORDINARY', numberOfShares: 10 }],
    formerNames: [{ id: 'former-name-1', name: 'Prior Name' }],
    charges: [{ id: 'charge-1', chargeNumber: 'CHG-1' }],
    auditor: { id: 'auditor-1', name: 'Existing Auditor' },
    expectedAggregateRevision: 3,
  };
}

function planFor(
  data: ExtractedBizFileData,
  selectedChangeIds?: string[],
  planOverrides: Partial<Parameters<typeof buildBizFileChangePlan>[0]> = {},
): BizFileChangePlan {
  return buildBizFileChangePlan({
    mode: 'UPDATE',
    tenantId,
    documentId,
    targetCompanyId: companyId,
    reviewedData: data,
    baseline: baseline(),
    expectedAggregateRevision: 3,
    selectedChangeIds,
    ...planOverrides,
  });
}

function transaction(currentCompany: Record<string, unknown> = {}) {
  const operation = () => vi.fn().mockResolvedValue(undefined);
  return {
    company: {
      findFirst: vi.fn().mockResolvedValue({
        id: companyId,
        tenantId,
        uen,
        aggregateRevision: 3,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...currentCompany,
      }),
      create: vi.fn().mockResolvedValue({ id: 'company-created' }),
      update: vi.fn().mockResolvedValue({ id: companyId }),
    },
    companyAddress: { findFirst: operation(), update: operation(), create: operation() },
    companyFormerName: { update: operation(), create: operation(), delete: operation() },
    shareCapital: { update: operation(), create: operation(), delete: operation() },
    companyOfficer: { update: operation(), create: operation(), count: vi.fn().mockResolvedValue(0) },
    companyShareholder: { update: operation(), create: operation(), count: vi.fn().mockResolvedValue(1) },
    companyAuditor: { upsert: operation(), deleteMany: operation() },
    companyCharge: { update: operation(), create: operation(), delete: operation() },
  };
}

function syncArgs(plan: BizFileChangePlan, data: ExtractedBizFileData = plan.reviewedData): CanonicalBizFileSyncArgs {
  return {
    data,
    documentId,
    tenantId,
    userId: 'user-1',
    existingCompanyId: companyId,
    plan,
  };
}

describe('selected BizFile change plans', () => {
  it('binds cessation to an explicit date and updates only the selected officer', async () => {
    const plan = planFor(reviewedData('Old Name Pte Ltd'), undefined, {
      officerActions: [{ officerId: 'officer-1', action: 'cease', cessationDate: '2026-09-08' }],
    });
    const change = plan.changes.find((entry) => entry.operation === 'CEASE')!;
    expect(change).toMatchObject({ targetId: 'officer-1', after: { cessationDate: '2026-09-08' } });
    const tx = transaction();
    await applyBizFileChangePlanInTransaction(syncArgs(plan), tx as unknown as PrismaTransactionClient);
    expect(tx.companyOfficer.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'officer-1' },
      data: { isCurrent: false, cessationDate: new Date('2026-09-08T00:00:00.000Z'), sourceDocumentId: documentId } });
    expect(tx.company.update).toHaveBeenCalledWith({ where: { id: companyId }, data: { currentOfficerCount: 0 } });
    expect(tx.companyShareholder.update).not.toHaveBeenCalled();

    const excluded = planFor(reviewedData('Old Name Pte Ltd'), [], { officerActions: plan.officerActions });
    const untouched = transaction();
    await applyBizFileChangePlanInTransaction(syncArgs(excluded), untouched as unknown as PrismaTransactionClient);
    expect(untouched.companyOfficer.update).not.toHaveBeenCalled();
    expect(untouched.companyOfficer.count).not.toHaveBeenCalled();
  });

  it.each(['', '2026-02-30'])('rejects missing or invalid explicit cessation date %s', (cessationDate) => {
    expect(() => planFor(reviewedData('Old Name Pte Ltd'), undefined, {
      officerActions: [{ officerId: 'officer-1', action: 'cease', cessationDate }],
    })).toThrow('valid explicit cessation date');
  });

  it('does not silently claim unsupported follow-up work was prepared', () => {
    expect(() => planFor(reviewedData('Old Name Pte Ltd'), undefined, {
      officerActions: [{ officerId: 'officer-1', action: 'follow_up' }],
    })).toThrow('Create follow-up work separately');
  });
  it('updates only a selected scalar and leaves omitted child sections untouched', async () => {
    const plan = planFor(reviewedData('Renamed Pte. Ltd.'));
    const nameChange = plan.changes.find((change) => change.path === 'entityDetails.name');
    expect(nameChange).toBeDefined();

    const selectedPlan = planFor(reviewedData('Renamed Pte. Ltd.'), [nameChange!.id]);
    const tx = transaction();

    const result = await applyBizFileChangePlanInTransaction(
      syncArgs(selectedPlan),
      tx as unknown as PrismaTransactionClient,
    );

    expect(result.selectedChanges.map((change) => change.path)).toEqual(['entityDetails.name']);
    expect(tx.company.update).toHaveBeenCalledTimes(1);
    expect(tx.company.update).toHaveBeenCalledWith({
      where: { id: companyId },
      data: { name: selectedPlan.reviewedData.entityDetails.name, aggregateRevision: 4 },
    });
    expect(tx.companyAddress.findFirst).not.toHaveBeenCalled();
    expect(tx.companyAddress.update).not.toHaveBeenCalled();
    expect(tx.companyAddress.create).not.toHaveBeenCalled();
    expect(tx.companyOfficer.update).not.toHaveBeenCalled();
    expect(tx.companyOfficer.create).not.toHaveBeenCalled();
    expect(tx.companyShareholder.update).not.toHaveBeenCalled();
    expect(tx.companyShareholder.create).not.toHaveBeenCalled();
    expect(tx.shareCapital.update).not.toHaveBeenCalled();
    expect(tx.shareCapital.create).not.toHaveBeenCalled();
    expect(tx.companyFormerName.update).not.toHaveBeenCalled();
    expect(tx.companyFormerName.create).not.toHaveBeenCalled();
    expect(tx.companyFormerName.delete).not.toHaveBeenCalled();
    expect(tx.companyAuditor.upsert).not.toHaveBeenCalled();
    expect(tx.companyAuditor.deleteMany).not.toHaveBeenCalled();
    expect(tx.companyCharge.update).not.toHaveBeenCalled();
    expect(tx.companyCharge.create).not.toHaveBeenCalled();
    expect(tx.companyCharge.delete).not.toHaveBeenCalled();
  });

  it('treats an omitted scalar as KEEP and an explicit null as CLEAR', async () => {
    const omittedPlan = planFor(reviewedData('Old Name Pte Ltd'));
    expect(omittedPlan.changes.some((change) => change.path === 'entityDetails.displayAlias')).toBe(false);

    const omittedTx = transaction();
    await applyBizFileChangePlanInTransaction(
      syncArgs(omittedPlan),
      omittedTx as unknown as PrismaTransactionClient,
    );
    expect(omittedTx.company.update).not.toHaveBeenCalled();

    const clearPlan = planFor(reviewedData('Old Name Pte Ltd', null));
    const clearChange = clearPlan.changes.find((change) => change.path === 'entityDetails.displayAlias');
    expect(clearChange).toMatchObject({ operation: 'CLEAR', before: 'OLD', after: null });

    const clearTx = transaction();
    await applyBizFileChangePlanInTransaction(
      syncArgs(clearPlan),
      clearTx as unknown as PrismaTransactionClient,
    );
    expect(clearTx.company.update).toHaveBeenCalledWith({
      where: { id: companyId },
      data: { displayAlias: null, aggregateRevision: 4 },
    });
  });

  it('rejects applying a CREATE plan against an existing company', async () => {
    const createPlan = buildBizFileChangePlan({
      mode: 'CREATE',
      tenantId,
      documentId,
      reviewedData: reviewedData('New Company Pte. Ltd.'),
      baseline: baseline(),
      expectedAggregateRevision: 3,
    });
    const tx = transaction();

    await expect(applyBizFileChangePlanInTransaction(
      syncArgs(createPlan),
      tx as unknown as PrismaTransactionClient,
    )).rejects.toThrow('CREATE cannot target an existing company');
    expect(tx.company.create).not.toHaveBeenCalled();
  });

  it('acquires the CREATE advisory lock without returning PostgreSQL void', async () => {
    const createPlan = buildBizFileChangePlan({
      mode: 'CREATE',
      tenantId,
      documentId,
      reviewedData: reviewedData('New Company Pte. Ltd.'),
    });
    const queryRawUnsafe = vi.fn(async (query: string) => {
      if (/^SELECT pg_advisory_xact_lock/.test(query)) {
        throw new Error("Failed to deserialize column of type 'void'");
      }
      return [{ locked: 1 }];
    });
    const tx = {
      ...transaction(),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRawUnsafe: queryRawUnsafe,
    };
    tx.company.findFirst.mockResolvedValue(null);

    await expect(applyBizFileChangePlanInTransaction({
      data: createPlan.reviewedData,
      documentId,
      tenantId,
      userId: 'user-1',
      plan: createPlan,
    }, tx as unknown as PrismaTransactionClient)).resolves.toMatchObject({
      companyId: 'company-created',
      created: true,
    });

    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/^SELECT 1 AS locked FROM/),
      `oakcloud:bizfile:create:${tenantId}:${uen}`,
    );
  });

  it('rejects selecting a change without its declared dependency', () => {
    const initial = planFor(reviewedData('Renamed Pte. Ltd.', 'NEW'));
    const nameChange = initial.changes.find((change) => change.path === 'entityDetails.name');
    const aliasChange = initial.changes.find((change) => change.path === 'entityDetails.displayAlias');
    expect(nameChange).toBeDefined();
    expect(aliasChange).toBeDefined();

    const changes = initial.changes.map((change) => change.id === nameChange!.id
      ? { ...change, dependencyIds: [aliasChange!.id] }
      : change);
    const unsignedPlan = {
      ...initial,
      changes,
      selectedChangeIds: [nameChange!.id],
    };
    const dependentPlan = {
      ...unsignedPlan,
      canonicalHash: hashBizFileValue(unsignedPlan),
    } as BizFileChangePlan;

    expect(() => assertBizFileChangePlan(dependentPlan)).toThrow('requires an additional reviewed change');
  });
});
