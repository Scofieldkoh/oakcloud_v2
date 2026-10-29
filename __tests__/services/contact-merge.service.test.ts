import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), ledgerFind: vi.fn(), barrier: vi.fn(), lock: vi.fn(), databaseClock: vi.fn(), contactFind: vi.fn(),
  contactUpdate: vi.fn(), contactUpdateMany: vi.fn(), contactDelete: vi.fn(), ledgerCreate: vi.fn(), auditCreate: vi.fn(),
  companyContactFind: vi.fn(), companyContactUpdate: vi.fn(), companyContactDelete: vi.fn(),
  detailFind: vi.fn(), detailUpdate: vi.fn(), detailDelete: vi.fn(),
  noteFind: vi.fn(), noteUpdate: vi.fn(), officerUpdate: vi.fn(), shareholderUpdate: vi.fn(),
  chargeUpdate: vi.fn(),
  revisionVendorUpdate: vi.fn(), revisionCustomerUpdate: vi.fn(),
  vendorAliasFind: vi.fn(), vendorAliasUpdate: vi.fn(), vendorAliasDelete: vi.fn(),
  customerAliasFind: vi.fn(), customerAliasUpdate: vi.fn(), customerAliasDelete: vi.fn(),
  counts: new Map<string, ReturnType<typeof vi.fn>>(),
}));

function delegate(name: string) {
  const count = vi.fn().mockResolvedValue(0);
  mocks.counts.set(name, count);
  return { count };
}

const tx = {
  $executeRaw: mocks.barrier,
  $queryRaw: vi.fn((query: { sql: string }) => query.sql.includes('clock_timestamp')
    ? mocks.databaseClock(query)
    : mocks.lock(query)),
  contact: { findMany: mocks.contactFind, update: mocks.contactUpdate, updateMany: mocks.contactUpdateMany, deleteMany: mocks.contactDelete },
  contactMergeOperation: { findUnique: mocks.ledgerFind, create: mocks.ledgerCreate },
  auditLog: { create: mocks.auditCreate },
  companyContact: { ...delegate('companyContact'), findMany: mocks.companyContactFind, update: mocks.companyContactUpdate, deleteMany: mocks.companyContactDelete },
  contactDetail: { ...delegate('contactDetail'), findMany: mocks.detailFind, update: mocks.detailUpdate, deleteMany: mocks.detailDelete },
  noteTab: { ...delegate('noteTab'), findMany: mocks.noteFind, update: mocks.noteUpdate },
  companyOfficer: { ...delegate('companyOfficer'), updateMany: mocks.officerUpdate },
  companyShareholder: { ...delegate('companyShareholder'), updateMany: mocks.shareholderUpdate },
  companyCharge: { ...delegate('companyCharge'), updateMany: mocks.chargeUpdate },
  documentRevision: { count: vi.fn().mockResolvedValue(0), updateMany: vi.fn() },
  vendorAlias: { ...delegate('vendorAlias'), findMany: mocks.vendorAliasFind, update: mocks.vendorAliasUpdate, deleteMany: mocks.vendorAliasDelete },
  customerAlias: { ...delegate('customerAlias'), findMany: mocks.customerAliasFind, update: mocks.customerAliasUpdate, deleteMany: mocks.customerAliasDelete },
};

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction, contactMergeOperation: { findUnique: mocks.ledgerFind } } }));

import { ContactMergeConflictError, mergeContacts } from '@/services/contact-merge.service';

const stamp = new Date('2026-07-14T01:00:00.000Z');
const contacts = [
  { id: 'master', tenantId: 'tenant-1', contactType: 'INDIVIDUAL', firstName: 'Alice', lastName: null, fullName: 'Alice', canonicalName: 'alice', alias: null, identificationType: null, identificationNumber: null, nationality: null, dateOfBirth: null, corporateName: null, corporateUen: null, fullAddress: null, isActive: true, deletedAt: null, createdAt: new Date('2020-01-01'), updatedAt: stamp, contactDetails: [] },
  { id: 'source-1', tenantId: 'tenant-1', contactType: 'INDIVIDUAL', firstName: 'Alice', lastName: null, fullName: 'Alice', canonicalName: 'alice', alias: 'Al', identificationType: null, identificationNumber: null, nationality: 'SG', dateOfBirth: null, corporateName: null, corporateUen: null, fullAddress: null, isActive: true, deletedAt: null, createdAt: new Date('2021-01-01'), updatedAt: stamp, contactDetails: [] },
  { id: 'source-2', tenantId: 'tenant-1', contactType: 'INDIVIDUAL', firstName: 'Alice', lastName: null, fullName: 'Alice', canonicalName: 'alice', alias: null, identificationType: null, identificationNumber: null, nationality: null, dateOfBirth: null, corporateName: null, corporateUen: null, fullAddress: null, isActive: true, deletedAt: null, createdAt: new Date('2022-01-01'), updatedAt: stamp, contactDetails: [] },
];

function input() {
  return { idempotencyKey: 'merge-key', masterContactId: 'master', sourceContactIds: ['source-1', 'source-2'], expectedUpdatedAt: Object.fromEntries(contacts.map(c => [c.id, stamp.toISOString()])), expectedFingerprints: {}, fieldDecisions: {} };
}

describe('contact merge service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const count of mocks.counts.values()) count.mockResolvedValue(0);
    tx.documentRevision.count.mockResolvedValue(0);
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    mocks.ledgerFind.mockResolvedValue(null);
    mocks.barrier.mockResolvedValue(0);
    mocks.databaseClock.mockResolvedValue([{ cutoff: new Date('2026-07-14T01:01:00.000Z') }]);
    mocks.lock.mockResolvedValue(contacts.map(({ id, updatedAt }) => ({ id, updatedAt })));
    mocks.contactFind.mockResolvedValue(contacts);
    mocks.contactUpdate.mockResolvedValue(contacts[0]);
    mocks.contactUpdateMany.mockResolvedValue({ count: 0 });
    mocks.contactDelete.mockResolvedValue({ count: 2 });
    mocks.ledgerCreate.mockResolvedValue({ id: 'ledger-1' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
    mocks.companyContactFind.mockResolvedValue([
      { id: 'cc-master', contactId: 'master', companyId: 'co', relationship: 'CLIENT', isPrimary: false, isPoc: true, createdAt: new Date('2020-01-01'), deletedAt: null },
      { id: 'cc-source', contactId: 'source-1', companyId: 'co', relationship: 'CLIENT', isPrimary: true, isPoc: false, createdAt: new Date('2021-01-01'), deletedAt: null },
    ]);
    mocks.detailFind.mockResolvedValue([
      { id: 'd-master', tenantId: 'tenant-1', contactId: 'master', companyId: null, detailType: 'EMAIL', value: 'A@example.com', purposes: ['INVOICE'], isPrimary: true, isPoc: false, createdAt: new Date('2020-01-01'), deletedAt: null },
      { id: 'd-source', tenantId: 'tenant-1', contactId: 'source-1', companyId: null, detailType: 'EMAIL', value: 'a@EXAMPLE.com', purposes: ['GENERAL'], isPrimary: false, isPoc: true, createdAt: new Date('2021-01-01'), deletedAt: null },
    ]);
    mocks.noteFind.mockResolvedValue([
      { id: 'n-source', contactId: 'source-1', order: 0, createdAt: new Date('2021-01-01') },
      { id: 'n-master', contactId: 'master', order: 5, createdAt: new Date('2020-01-01') },
    ]);
    mocks.vendorAliasFind.mockResolvedValue([
      { id: 'va-master', normalizedContactId: 'master', tenantId: 'tenant-1', companyId: null, rawName: 'Acme, Pte.', confidence: 0.8, createdAt: new Date('2020-01-01') },
      { id: 'va-source', normalizedContactId: 'source-1', tenantId: 'tenant-1', companyId: null, rawName: 'ACME PTE', confidence: 0.95, createdAt: new Date('2021-01-01') },
    ]);
    mocks.customerAliasFind.mockResolvedValue([]);
    tx.documentRevision.updateMany
      .mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
  });

  it('atomically consolidates every relation, records ledger/audit, asserts references, and deletes last', async () => {
    const result = await mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' });

    expect(result).toMatchObject({ ledgerId: 'ledger-1', survivingContactId: 'master', alreadyCompleted: false });
    const barrierCalls = mocks.barrier.mock.calls.map(([query]) => query as { sql: string; values: unknown[] });
    expect(barrierCalls[0].sql).toMatch(/pg_advisory_xact_lock_shared/);
    expect(barrierCalls[0].values).toEqual(['oakcloud:business-operation:tenant-1']);
    expect(barrierCalls[1].sql).toMatch(/pg_advisory_xact_lock/);
    expect(barrierCalls[1].values).toEqual(['contact-merge-backup:tenant-1']);
    expect(barrierCalls[2].sql).toMatch(/pg_advisory_xact_lock/);
    expect(barrierCalls[2].values).toEqual(['oakcloud:authorization:global']);
    expect(mocks.barrier.mock.invocationCallOrder[2]).toBeLessThan(mocks.ledgerFind.mock.invocationCallOrder[1]);
    expect(mocks.barrier.mock.invocationCallOrder[2]).toBeLessThan(mocks.lock.mock.invocationCallOrder[0]);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 300_000,
    });
    const lock = mocks.lock.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(lock.sql).toMatch(/ORDER BY "id" FOR UPDATE/);
    expect(lock.values.indexOf('master')).toBeLessThan(lock.values.indexOf('source-1'));
    expect(mocks.companyContactUpdate).toHaveBeenCalledWith({ where: { id: 'cc-master' }, data: { isPrimary: true, isPoc: true } });
    expect(mocks.detailUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'd-master' }, data: expect.objectContaining({ purposes: ['GENERAL', 'INVOICE'], isPrimary: true, isPoc: true }) }));
    expect(mocks.noteUpdate).toHaveBeenCalledWith({ where: { id: 'n-master' }, data: { contactId: 'master', order: 0 } });
    expect(mocks.noteUpdate).toHaveBeenCalledWith({ where: { id: 'n-source' }, data: { contactId: 'master', order: 1 } });
    expect(mocks.officerUpdate).toHaveBeenCalledWith({ where: { contactId: { in: ['source-1', 'source-2'] } }, data: { contactId: 'master' } });
    expect(mocks.shareholderUpdate).toHaveBeenCalled();
    expect(mocks.chargeUpdate).toHaveBeenCalledWith({ where: { chargeHolderId: { in: ['source-1', 'source-2'] } }, data: { chargeHolderId: 'master' } });
    expect(tx.documentRevision.updateMany).toHaveBeenNthCalledWith(1, { where: { vendorId: { in: ['source-1', 'source-2'] } }, data: { vendorId: 'master' } });
    expect(tx.documentRevision.updateMany).toHaveBeenNthCalledWith(2, { where: { customerId: { in: ['source-1', 'source-2'] } }, data: { customerId: 'master' } });
    expect(mocks.vendorAliasUpdate).toHaveBeenCalledWith({ where: { id: 'va-source' }, data: { normalizedContactId: 'master' } });
    expect(mocks.vendorAliasDelete).toHaveBeenCalledWith({ where: { id: { in: ['va-master'] } } });
    for (const count of mocks.counts.values()) expect(count).toHaveBeenCalled();
    expect(tx.documentRevision.count).toHaveBeenCalledTimes(2);
    expect(mocks.ledgerCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-1', masterContactId: 'master', sourceContactIds: ['source-1', 'source-2'], approvedAt: new Date('2026-07-14T01:01:00.000Z') }) }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'MERGE', entityId: 'ledger-1' }) }));
    expect(mocks.contactDelete).toHaveBeenCalledWith({ where: { id: { in: ['source-1', 'source-2'] }, tenantId: 'tenant-1' } });
    expect(mocks.ledgerCreate.mock.invocationCallOrder[0]).toBeLessThan(mocks.contactDelete.mock.invocationCallOrder[0]);
    expect(mocks.auditCreate.mock.invocationCallOrder[0]).toBeLessThan(mocks.contactDelete.mock.invocationCallOrder[0]);
  });

  it('returns a completed ledger before locking or mutating', async () => {
    mocks.ledgerFind.mockResolvedValue({ id: 'old-ledger', masterContactId: 'master', movedRecordCounts: { notes: 2 } });
    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).resolves.toEqual({ ledgerId: 'old-ledger', survivingContactId: 'master', movedCounts: { notes: 2 }, alreadyCompleted: true });
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused with changed membership', async () => {
    mocks.ledgerFind.mockResolvedValue({ id: 'old-ledger', masterContactId: 'master', sourceContactIds: ['source-1'], movedRecordCounts: {} });
    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow(/idempotency/i);
  });

  it('rejects changed membership when the ledger appears inside the transaction', async () => {
    mocks.ledgerFind
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'old-ledger', masterContactId: 'master', sourceContactIds: ['source-1'], movedRecordCounts: {} });
    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow(/idempotency/i);
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it('rejects changed membership during post-conflict ledger recovery', async () => {
    mocks.ledgerFind
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'winner', masterContactId: 'master', sourceContactIds: ['source-1'], movedRecordCounts: {} });
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('serialization conflict'), { code: 'P2034' }));
    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow(/idempotency/i);
  });

  it('rejects stale, cross-tenant/unavailable, and unresolved strong-ID conflicts before mutation', async () => {
    mocks.lock.mockResolvedValueOnce(contacts.slice(0, 2));
    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow(ContactMergeConflictError);
    mocks.lock.mockResolvedValue(contacts.map(({ id, updatedAt }) => ({ id, updatedAt })));
    mocks.contactFind.mockResolvedValueOnce(contacts.map((c, index) => index === 1 ? { ...c, updatedAt: new Date('2026-07-14T02:00:00Z') } : c));
    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow(/stale/i);
    mocks.contactFind.mockResolvedValueOnce(contacts.map((c, index) => ({ ...c, identificationType: 'NRIC', identificationNumber: index === 0 ? 'S1234567A' : 'S7654321A' })));
    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow(/identifier/i);
    expect(mocks.contactDelete).not.toHaveBeenCalled();
  });

  it('recalculates recommendation membership after locking and rejects a disconnected group as stale', async () => {
    mocks.contactFind.mockResolvedValueOnce(contacts.map((contact, index) => index === 2 ? {
      ...contact, firstName: 'Completely', lastName: 'Different', fullName: 'Completely Different', canonicalName: 'completelydifferent',
    } : contact));

    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow(/stale/i);
    expect(mocks.companyContactFind).not.toHaveBeenCalled();
    expect(mocks.contactDelete).not.toHaveBeenCalled();
  });

  it('does not let field decisions manufacture recommendation connectivity', async () => {
    mocks.contactFind.mockResolvedValueOnce(contacts.map((contact, index) => index === 2 ? {
      ...contact, firstName: 'Mallory', fullName: 'Mallory', canonicalName: 'mallory',
    } : contact));
    await expect(mergeContacts({ ...input(), fieldDecisions: { firstName: 'Alice' } }, { tenantId: 'tenant-1', userId: 'user-1' }))
      .rejects.toThrow(/stale/i);
  });

  it('rejects injected field values that are absent from the locked group', async () => {
    await expect(mergeContacts({ ...input(), fieldDecisions: { nationality: 'INJECTED' } }, { tenantId: 'tenant-1', userId: 'user-1' }))
      .rejects.toThrow(/field decision/i);
  });

  it('rejects an identification type and number assembled from different locked contacts', async () => {
    const identifierContacts = contacts.map((contact, index) => index === 0 ? {
      ...contact, identificationType: 'NRIC', identificationNumber: 'S0000001A',
    } : index === 1 ? {
      ...contact, identificationType: 'PASSPORT', identificationNumber: 'P1234567',
    } : contact);
    mocks.contactFind.mockResolvedValueOnce(identifierContacts);

    await expect(mergeContacts({
      ...input(),
      fieldDecisions: { identificationType: 'NRIC', identificationNumber: 'P1234567' },
    }, { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow(/identifier pair/i);
  });

  it('rejects a selected number incompatible with the retained master identification type', async () => {
    const identifierContacts = contacts.map((contact, index) => index === 0 ? {
      ...contact, identificationType: 'NRIC', identificationNumber: 'S0000001A',
    } : index === 1 ? {
      ...contact, identificationType: 'PASSPORT', identificationNumber: 'P1234567',
    } : contact);
    mocks.contactFind.mockResolvedValueOnce(identifierContacts);

    await expect(mergeContacts({
      ...input(), fieldDecisions: { identificationNumber: 'P1234567' },
    }, { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow(/identifier pair/i);
  });

  it('rolls back by rejecting the transaction when a reference assertion fails', async () => {
    mocks.counts.get('companyOfficer')!.mockResolvedValueOnce(1);
    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow(/reference/i);
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
    expect(mocks.contactDelete).not.toHaveBeenCalled();
  });

  it('deletes a colliding master relationship before reassigning an older source survivor', async () => {
    mocks.companyContactFind.mockResolvedValue([
      { id: 'cc-source', contactId: 'source-1', companyId: 'co', relationship: 'CLIENT', isPrimary: true, isPoc: false, createdAt: new Date('2019-01-01'), deletedAt: null },
      { id: 'cc-master', contactId: 'master', companyId: 'co', relationship: 'CLIENT', isPrimary: false, isPoc: true, createdAt: new Date('2020-01-01'), deletedAt: null },
    ]);
    mocks.companyContactUpdate.mockImplementationOnce(async () => {
      if (mocks.companyContactDelete.mock.calls.length === 0) throw new Error('unique collision');
      return {};
    });

    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).resolves.toMatchObject({ survivingContactId: 'master' });
    expect(mocks.companyContactDelete.mock.invocationCallOrder[0]).toBeLessThan(mocks.companyContactUpdate.mock.invocationCallOrder[0]);
  });

  it('serializes immutable ledger snapshots and recovers a concurrent completed idempotency key', async () => {
    await mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' });
    const ledgerData = mocks.ledgerCreate.mock.calls[0][0].data;
    expect(ledgerData.masterSnapshot.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(ledgerData.sourceSnapshots[0].updatedAt).toBe(stamp.toISOString());

    vi.clearAllMocks();
    mocks.ledgerFind.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner', masterContactId: 'master', movedRecordCounts: { notes: 1 } });
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('serialization conflict'), { code: 'P2034' }));
    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).resolves.toEqual({
      ledgerId: 'winner', survivingContactId: 'master', movedCounts: { notes: 1 }, alreadyCompleted: true,
    });
  });

  it('rechecks the ledger outside a losing serializable snapshot when concurrent deletion wins', async () => {
    mocks.ledgerFind
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'winner', masterContactId: 'master', movedRecordCounts: { notes: 1 } });
    mocks.lock.mockResolvedValueOnce([]);

    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).resolves.toEqual({
      ledgerId: 'winner', survivingContactId: 'master', movedCounts: { notes: 1 }, alreadyCompleted: true,
    });
  });

  it('neutralizes a source composite identifier before enriching an empty master', async () => {
    const identifierContacts = contacts.map((contact, index) => index === 1 ? {
      ...contact, identificationType: 'NRIC', identificationNumber: 'S1234567A',
    } : contact);
    mocks.contactFind.mockResolvedValueOnce(identifierContacts);
    mocks.contactUpdate.mockImplementationOnce(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      if (where.id === 'master' && data.identificationNumber === 'S1234567A' && mocks.contactUpdateMany.mock.calls.length === 0) {
        throw new Error('unique constraint violation');
      }
      return identifierContacts[0];
    });

    await expect(mergeContacts(input(), { tenantId: 'tenant-1', userId: 'user-1' })).resolves.toMatchObject({ survivingContactId: 'master' });
    expect(mocks.contactUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['source-1'] }, tenantId: 'tenant-1', identificationType: 'NRIC', identificationNumber: 'S1234567A' },
      data: { identificationType: null, identificationNumber: null },
    });
    expect(mocks.contactUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.contactUpdate.mock.invocationCallOrder[0]);
    expect(mocks.ledgerCreate.mock.calls[0][0].data.sourceSnapshots[0]).toMatchObject({ identificationType: 'NRIC', identificationNumber: 'S1234567A' });
  });

  it('neutralizes only the source owning an explicitly selected identifier', async () => {
    const identifierContacts = contacts.map((contact, index) => index === 0 ? {
      ...contact, identificationType: 'NRIC', identificationNumber: 'S0000001A',
    } : index === 1 ? {
      ...contact, identificationType: 'NRIC', identificationNumber: 'S1234567A',
    } : {
      ...contact, identificationType: 'PASSPORT', identificationNumber: 'P7654321',
    });
    mocks.contactFind.mockResolvedValueOnce(identifierContacts);
    const selectedInput = {
      ...input(),
      fieldDecisions: { identificationType: 'NRIC', identificationNumber: 'S1234567A' },
    };

    await mergeContacts(selectedInput, { tenantId: 'tenant-1', userId: 'user-1' });

    expect(mocks.contactUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['source-1'] }, tenantId: 'tenant-1', identificationType: 'NRIC', identificationNumber: 'S1234567A' },
      data: { identificationType: null, identificationNumber: null },
    });
    expect(mocks.contactUpdateMany.mock.calls[0][0].where.id.in).not.toContain('source-2');
    expect(mocks.contactDelete.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.contactUpdateMany.mock.invocationCallOrder[0]);
  });

  it('orders reverse-lexical source note groups by submitted request order while locks stay sorted', async () => {
    const orderedContacts = [
      contacts[0],
      { ...contacts[1], id: 'source-z' },
      { ...contacts[2], id: 'source-a' },
    ];
    const orderedInput = {
      ...input(),
      sourceContactIds: ['source-z', 'source-a'],
      expectedUpdatedAt: Object.fromEntries(orderedContacts.map(contact => [contact.id, stamp.toISOString()])),
    };
    mocks.lock.mockResolvedValueOnce(orderedContacts.map(({ id, updatedAt }) => ({ id, updatedAt })));
    mocks.contactFind.mockResolvedValueOnce(orderedContacts);
    mocks.noteFind.mockResolvedValueOnce([
      { id: 'note-a', contactId: 'source-a', order: 0, createdAt: new Date('2021-01-01') },
      { id: 'note-master', contactId: 'master', order: 0, createdAt: new Date('2020-01-01') },
      { id: 'note-z', contactId: 'source-z', order: 0, createdAt: new Date('2022-01-01') },
    ]);

    await mergeContacts(orderedInput, { tenantId: 'tenant-1', userId: 'user-1' });

    const lock = mocks.lock.mock.calls[0][0] as { values: string[] };
    expect(lock.values.indexOf('source-a')).toBeLessThan(lock.values.indexOf('source-z'));
    expect(mocks.noteUpdate).toHaveBeenNthCalledWith(1, { where: { id: 'note-master' }, data: { contactId: 'master', order: 0 } });
    expect(mocks.noteUpdate).toHaveBeenNthCalledWith(2, { where: { id: 'note-z' }, data: { contactId: 'master', order: 1 } });
    expect(mocks.noteUpdate).toHaveBeenNthCalledWith(3, { where: { id: 'note-a' }, data: { contactId: 'master', order: 2 } });
  });
});
