import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewRaw = vi.hoisted(() => vi.fn());

const tx = {
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  contact: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  contactDetail: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  company: { findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
  contactDuplicateDecision: { create: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    $queryRaw: previewRaw,
    contact: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/services/contact-detail.service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/contact-detail.service')>(),
  createContactDetail: vi.fn(),
}));

import { createAuditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { createContactDetail } from '@/services/contact-detail.service';
import { createContact, updateContact } from '@/services/contact.service';
import {
  previewContactIdentity,
  resolveOrCreateContact,
} from '@/services/contact-identity.service';
import type { ContactIdentityCandidate } from '@/types/contact-identity';

const params = { tenantId: 'tenant-1', userId: 'user-1' };

function candidate(
  overrides: Partial<ContactIdentityCandidate> = {},
): ContactIdentityCandidate {
  return {
    source: 'MANUAL',
    contactType: 'INDIVIDUAL',
    firstName: '王小明',
    ...overrides,
  };
}

function existingContact(overrides: Record<string, unknown> = {}) {
  const createdAt = new Date('2020-01-01T00:00:00.000Z');
  return {
    id: 'contact-1',
    tenantId: 'tenant-1',
    contactType: 'INDIVIDUAL',
    firstName: '王小明',
    lastName: null,
    fullName: '王小明',
    canonicalName: '王小明',
    alias: null,
    identificationType: null,
    identificationNumber: null,
    nationality: null,
    dateOfBirth: null,
    corporateName: null,
    corporateUen: null,
    fullAddress: null,
    isActive: true,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    _count: {
      companyRelations: 0,
      officerPositions: 0,
      shareholdings: 0,
      contactDetails: 0,
    },
    contactDetails: [],
    ...overrides,
  };
}

describe('contact identity service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewRaw.mockResolvedValue([]);
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null);
    tx.contact.findMany.mockResolvedValue([]);
    tx.$queryRaw.mockResolvedValue([]);
    tx.contact.findFirst.mockResolvedValue(null);
    tx.contactDetail.findMany.mockResolvedValue([]);
    tx.contactDetail.update.mockImplementation(async ({ where, data }) => ({
      id: where.id,
      ...data,
      detailType: data.detailType ?? 'EMAIL',
      value: data.value ?? 'work@example.com',
      label: data.label ?? null,
    }));
    tx.contact.create.mockImplementation(async ({ data }) =>
      existingContact({ id: 'created-contact', ...data }),
    );
    tx.contact.update.mockImplementation(async ({ data }) =>
      existingContact({ ...data }),
    );
  });

  it('previews active contacts only within the requested tenant', async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      existingContact(),
    ] as never);

    const match = await previewContactIdentity(candidate(), 'tenant-1');

    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-1', contactType: 'INDIVIDUAL', deletedAt: null, isActive: true }),
        take: 100,
      }),
    );
    expect(match).toMatchObject({ contactId: 'contact-1', automatic: true });
  });

  it('lets the final scorer accept a candidate retrieved at DB similarity 0.5 below the 0.93 policy threshold', async () => {
    previewRaw.mockResolvedValueOnce([{ id: 'fuzzy-1', similarity: 0.5 }]);
    vi.mocked(prisma.contact.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([existingContact({
        id: 'fuzzy-1',
        firstName: 'Alexander Hamilto',
        fullName: 'Alexander Hamilto',
        canonicalName: 'alexanderhamilto',
      })] as never);

    const match = await previewContactIdentity(candidate({ firstName: 'Alexander Hamilton' }), 'tenant-1');

    const query = previewRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(query.sql).toMatch(/%[\s\S]*similarity\([\s\S]*>= 0\.3[\s\S]*LIMIT 20/);
    expect(query.values).toContain('tenant-1');
    expect(prisma.contact.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['fuzzy-1'] }, tenantId: 'tenant-1' }),
      take: 20,
    }));
    expect(match).toMatchObject({ contactId: 'fuzzy-1', automatic: false });
  });

  it('reuses a differently named contact through a formatting-equivalent normalized NRIC', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'contact-1' }]);
    tx.contact.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      existingContact({ firstName: 'Different', fullName: 'Different', canonicalName: 'different', identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
    ]);
    const result = await resolveOrCreateContact(candidate({ identificationType: 'NRIC', identificationNumber: 'S 1234-567 A' }), { action: 'AUTO' }, params);
    expect(result.outcome).toBe('REUSED_IDENTIFIER');
    expect(tx.$queryRaw.mock.calls[0][0].sql).toMatch(/regexp_replace[\s\S]*LIMIT 100/);
  });

  it('finds Unicode-folded aliases in both incoming-alias and existing-alias directions', async () => {
    tx.contact.findMany.mockResolvedValueOnce([existingContact({ firstName: 'A Tan', fullName: 'A Tan', canonicalName: 'atan' })]);
    await resolveOrCreateContact(candidate({ firstName: 'Other', alias: 'Ａ．Ｔａｎ' }), { action: 'AUTO' }, params);
    expect(tx.contact.findMany.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([{ canonicalName: 'atan' }]));

    tx.contact.findMany.mockResolvedValueOnce([existingContact({ alias: 'Ａ．Ｔａｎ', canonicalAlias: 'atan' })]);
    await resolveOrCreateContact(candidate({ firstName: 'A Tan' }), { action: 'AUTO' }, params);
    expect(tx.contact.findMany.mock.calls[1][0].where.OR).toEqual(expect.arrayContaining([
      { canonicalAlias: 'atan' },
    ]));
  });

  it('fails identity traffic actionably when a Unicode-variant Chinese legacy row is unbackfilled', async () => {
    tx.contact.findFirst.mockResolvedValueOnce({ id: 'legacy-contact' });
    tx.contact.findMany.mockResolvedValue([existingContact({ canonicalName: null })]);
    await expect(resolveOrCreateContact(candidate({ firstName: '　王 小明　' }), { action: 'AUTO' }, params))
      .rejects.toThrow(/canonical identity backfill.*before identity traffic/i);
    expect(tx.contact.findMany).not.toHaveBeenCalled();
  });

  it('caps exact matches independently before loading more than 100 older corporate-prefix candidates', async () => {
    const exact = existingContact({ id: 'exact-new', contactType: 'CORPORATE', corporateName: 'Acme', fullName: 'Acme', canonicalName: 'acme', createdAt: new Date('2026-01-01') });
    const prefixes = Array.from({ length: 100 }, (_, index) => existingContact({
      id: `prefix-${index}`, contactType: 'CORPORATE', corporateName: `Acme Holdings ${index}`, fullName: `Acme Holdings ${index}`, canonicalName: `acmeholdings${index}`,
    }));
    tx.contact.findMany.mockResolvedValueOnce([exact]).mockResolvedValueOnce(prefixes);

    const result = await resolveOrCreateContact(candidate({ contactType: 'CORPORATE', firstName: null, corporateName: 'Acme' }), { action: 'AUTO' }, params);

    expect(result.contact.id).toBe('exact-new');
    expect(tx.contact.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ take: 100 }));
    expect(tx.contact.findMany.mock.calls[0][0].where.OR).not.toEqual(expect.arrayContaining([
      { canonicalName: { startsWith: 'acme' } },
    ]));
    expect(tx.contact.findMany.mock.calls[1][0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ canonicalName: { startsWith: 'acme' } }),
      take: 100,
    }));
  });

  it('reuses and enriches an exact Chinese name-only contact', async () => {
    tx.contact.findMany.mockResolvedValue([existingContact()]);

    const result = await resolveOrCreateContact(
      candidate({ identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
      { action: 'AUTO' },
      params,
    );

    expect(result.outcome).toBe('REUSED_NAME');
    expect(tx.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'contact-1' },
        data: expect.objectContaining({
          identificationType: 'NRIC',
          identificationNumber: 'S1234567A',
        }),
      }),
    );
  });

  it('prioritizes an identifier match over a name match', async () => {
    tx.contact.findMany.mockResolvedValue([
      existingContact({ id: 'name-match' }),
      existingContact({
        id: 'id-match',
        firstName: 'Different',
        fullName: 'Different',
        canonicalName: 'different',
        identificationType: 'NRIC',
        identificationNumber: 'S1234567A',
      }),
    ]);

    const result = await resolveOrCreateContact(
      candidate({ identificationType: 'NRIC', identificationNumber: 'S 123-4567 A' }),
      { action: 'AUTO' },
      params,
    );

    expect(result.outcome).toBe('REUSED_IDENTIFIER');
    expect(result.contact.id).toBe('id-match');
  });

  it('blocks automatic reuse when exact names have conflicting strong identifiers', async () => {
    tx.contact.findMany.mockResolvedValue([
      existingContact({ identificationType: 'NRIC', identificationNumber: 'S7654321A' }),
    ]);

    const result = await resolveOrCreateContact(
      candidate({ identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
      { action: 'AUTO' },
      params,
    );

    expect(result.outcome).toBe('CREATED');
    expect(result.conflicts).toEqual([
      expect.objectContaining({ field: 'identificationNumber' }),
    ]);
    expect(tx.contact.update).not.toHaveBeenCalled();
  });

  it('requires a reason and records an explicit separate decision after creation', async () => {
    tx.contact.findMany.mockResolvedValue([existingContact()]);
    tx.contactDuplicateDecision.create.mockResolvedValue({ id: 'decision-1' });

    await expect(
      resolveOrCreateContact(candidate(), { action: 'CREATE_SEPARATE', reason: '  ' }, params),
    ).rejects.toThrow('reason');

    const result = await resolveOrCreateContact(
      candidate(),
      { action: 'CREATE_SEPARATE', reason: 'Different person confirmed by reviewer' },
      params,
    );

    expect(result.outcome).toBe('CREATED_SEPARATE');
    expect(tx.contactDuplicateDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        leftContactId: 'contact-1',
        rightContactId: 'created-contact',
        decision: 'CREATE_SEPARATE',
        reason: 'Different person confirmed by reviewer',
        decidedById: 'user-1',
      }),
    });
    expect(tx.contactDuplicateDecision.create.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.contact.create.mock.invocationCallOrder.at(-1)!,
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'created-contact',
        metadata: expect.objectContaining({
          outcome: 'CREATED_SEPARATE',
          duplicateDecisionId: 'decision-1',
          overrideReason: 'Different person confirmed by reviewer',
        }),
      }),
      tx,
    );
  });

  it('restores and reuses a soft-deleted contact with the same deterministic identifier', async () => {
    const deleted = existingContact({
      id: 'deleted-contact',
      firstName: '王小明',
      fullName: '王小明',
      canonicalName: '王小明',
      identificationType: 'NRIC',
      identificationNumber: 'S1234567A',
      deletedAt: new Date('2021-01-01T00:00:00.000Z'),
    });
    const restored = {
      ...deleted,
      deletedAt: null,
      isActive: true,
    };
    tx.contact.findFirst
      .mockResolvedValueOnce(null) // unbackfilled check
      .mockResolvedValueOnce(deleted) // raw identifier duplicate
      .mockResolvedValueOnce(restored); // post-restore reload
    tx.contact.findMany.mockResolvedValue([]);
    tx.$queryRaw.mockResolvedValue([]);

    const result = await resolveOrCreateContact(
      candidate({
        identificationType: 'NRIC',
        identificationNumber: 'S1234567A',
      }),
      { action: 'AUTO' },
      params,
    );

    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'deleted-contact' },
      data: { deletedAt: null, isActive: true },
    });
    expect(result.outcome).toBe('RESTORED');
    expect(result.contact.id).toBe('deleted-contact');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RESTORE',
        entityId: 'deleted-contact',
        changeSource: 'MANUAL',
      }),
      tx,
    );
  });

  it('fails clearly when the identifier is already used by a contact of the other type', async () => {
    const corporate = existingContact({
      id: 'corporate-contact',
      contactType: 'CORPORATE',
      corporateName: 'Acme Holdings Pte Ltd',
      fullName: 'Acme Holdings Pte Ltd',
      canonicalName: 'acmeholdingspteltd',
      identificationType: 'UEN',
      identificationNumber: '202400001A',
    });
    tx.contact.findFirst
      .mockResolvedValueOnce(null) // unbackfilled check
      .mockResolvedValueOnce(corporate); // raw identifier duplicate
    tx.contact.findMany.mockResolvedValue([]);
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      resolveOrCreateContact(
        candidate({
          identificationType: 'UEN',
          identificationNumber: '202400001A',
        }),
        { action: 'AUTO' },
        params,
      ),
    ).rejects.toThrow(/already exists as a CORPORATE contact/i);
    expect(tx.contact.create).not.toHaveBeenCalled();
  });

  it('does not assign an identifier to a selected name-only contact when another row holds it', async () => {
    const nameOnly = existingContact({
      id: 'name-only-contact',
      firstName: '王小明',
      fullName: '王小明',
      canonicalName: '王小明',
    });
    const holder = existingContact({
      id: 'identifier-holder',
      firstName: 'Different',
      fullName: 'Different',
      canonicalName: 'different',
      identificationType: 'NRIC',
      identificationNumber: 'S1234567A',
      deletedAt: new Date('2021-01-01T00:00:00.000Z'),
    });
    tx.contact.findFirst
      .mockResolvedValueOnce(null) // unbackfilled check
      .mockResolvedValueOnce(holder); // identifier duplicate before enrichment update
    tx.contact.findMany.mockResolvedValue([nameOnly]);
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      resolveOrCreateContact(
        candidate({
          identificationType: 'NRIC',
          identificationNumber: 'S1234567A',
        }),
        { action: 'AUTO' },
        params,
      ),
    ).rejects.toThrow(/already exists on contact/i);
    expect(tx.contact.update).not.toHaveBeenCalled();
  });

  it('fills empty fields without overwriting conflicting non-empty values', async () => {
    tx.contact.findMany.mockResolvedValue([
      existingContact({
        identificationType: 'NRIC',
        identificationNumber: 'S1234567A',
        nationality: '',
        fullAddress: 'Existing address',
      }),
    ]);

    const result = await resolveOrCreateContact(
      candidate({
        identificationType: 'NRIC',
        identificationNumber: 'S1234567A',
        nationality: 'Singaporean',
        fullAddress: 'Incoming address',
      }),
      { action: 'AUTO' },
      params,
    );

    expect(tx.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nationality: 'Singaporean' } }),
    );
    expect(result.enrichedFields).toEqual(['nationality']);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ field: 'fullAddress', existingValue: 'Existing address' }),
    ]);
  });

  it('creates only distinct normalized contact details through the same transaction', async () => {
    tx.contact.findMany.mockResolvedValue([
      existingContact({
        identificationType: 'NRIC',
        identificationNumber: 'S1234567A',
        contactDetails: [{ detailType: 'EMAIL', value: 'person@example.com', companyId: null }],
      }),
    ]);

    await resolveOrCreateContact(
      candidate({
        identificationType: 'NRIC',
        identificationNumber: 'S1234567A',
        contactDetails: [
          { detailType: 'EMAIL', value: ' Person@Example.COM ' },
          { detailType: 'PHONE', value: '+65 8123 4567' },
          { detailType: 'PHONE', value: '+65-8123-4567' },
        ],
      }),
      { action: 'AUTO' },
      params,
    );

    expect(createContactDetail).toHaveBeenCalledTimes(1);
    expect(createContactDetail).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact-1', detailType: 'PHONE' }),
      { ...params, tx },
    );
  });

  it('persists purposes and company detail metadata through identity enrichment', async () => {
    tx.contact.findMany.mockResolvedValue([existingContact()]);

    await resolveOrCreateContact(
      candidate({
        contactDetails: [{
          detailType: 'EMAIL',
          value: ' work@example.com ',
          companyId: 'company-1',
          purposes: ['FINANCE', 'HR'],
          label: 'Work',
          description: 'Company inbox',
          displayOrder: 2,
          isPrimary: true,
        }],
      }),
      { action: 'AUTO' },
      params,
    );

    expect(createContactDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'contact-1',
        companyId: 'company-1',
        value: 'work@example.com',
        purposes: ['FINANCE', 'HR'],
        label: 'Work',
        description: 'Company inbox',
        displayOrder: 2,
        isPrimary: true,
      }),
      { ...params, tx },
    );
  });

  it('combines purposes from duplicate normalized incoming details without duplicate writes', async () => {
    tx.contact.findMany.mockResolvedValue([existingContact()]);

    await resolveOrCreateContact(
      candidate({
        contactDetails: [
          { detailType: 'EMAIL', value: 'Work@Example.com', companyId: 'company-1', purposes: ['FINANCE'] },
          { detailType: 'EMAIL', value: ' work@example.COM ', companyId: 'company-1', purposes: ['HR'] },
        ],
      }),
      { action: 'AUTO' },
      params,
    );

    expect(createContactDetail).toHaveBeenCalledTimes(1);
    expect(createContactDetail).toHaveBeenCalledWith(
      expect.objectContaining({ purposes: ['FINANCE', 'HR'] }),
      { ...params, tx },
    );
  });

  it('enriches an existing normalized detail safely with transaction-bound update and audit', async () => {
    const existingDetail = {
      id: 'detail-1',
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      detailType: 'EMAIL',
      value: 'work@example.com',
      purposes: ['FINANCE'],
      label: null,
      description: '',
      displayOrder: 0,
      isPrimary: false,
      isPoc: false,
      deletedAt: null,
    };
    tx.contact.findMany.mockResolvedValue([existingContact({ contactDetails: [existingDetail] })]);
    tx.contactDetail.findFirst.mockResolvedValue(existingDetail);

    await resolveOrCreateContact(
      candidate({
        contactDetails: [{
          detailType: 'EMAIL',
          value: ' Work@Example.COM ',
          companyId: 'company-1',
          purposes: ['HR'],
          label: 'Work',
          description: 'Company inbox',
          displayOrder: 2,
          isPrimary: true,
        }],
      }),
      { action: 'AUTO' },
      params,
    );

    expect(tx.contactDetail.update).toHaveBeenCalledWith({
      where: { id: 'detail-1' },
      data: expect.objectContaining({
        purposes: ['FINANCE', 'HR'],
        label: 'Work',
        description: 'Company inbox',
        displayOrder: 2,
        isPrimary: true,
      }),
    });
    expect(tx.contactDetail.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        contactId: 'contact-1',
        companyId: 'company-1',
        detailType: 'EMAIL',
        isPrimary: true,
      }),
      data: { isPrimary: false },
    });
    expect(createContactDetail).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'ContactDetail', entityId: 'detail-1' }),
      tx,
    );
  });

  it('acquires canonical and usable identifier locks in sorted order before requerying', async () => {
    tx.contact.findMany.mockResolvedValue([]);

    await resolveOrCreateContact(
      candidate({
        identificationType: 'NRIC',
        identificationNumber: 'S 123-4567 A',
        corporateUen: '2024-00001-A',
      }),
      { action: 'AUTO' },
      params,
    );

    const lockKeys = tx.$executeRaw.mock.calls
      .map(([query]) => query.values[0])
      .filter((key): key is string => String(key).startsWith('contact-identity:'));
    const gateKeys = tx.$executeRaw.mock.calls
      .map(([query]) => query.values[0]);
    expect(gateKeys.slice(0, 2)).toEqual([
      'oakcloud:business-operation:tenant-1',
      'oakcloud:authorization:global',
    ]);
    expect(gateKeys.findIndex((key) => String(key).startsWith('contact-identity:'))).toBeGreaterThan(1);
    expect(lockKeys).toEqual([...lockKeys].sort());
    expect(lockKeys).toEqual(
      expect.arrayContaining([
        'contact-identity:tenant-1:INDIVIDUAL:name:王小明',
        'contact-identity:tenant-1:INDIVIDUAL:id:NRIC:S1234567A',
        'contact-identity:tenant-1:INDIVIDUAL:uen:202400001A',
      ]),
    );
    expect(tx.contact.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.$executeRaw.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('writes contact audit records through the same transaction', async () => {
    await resolveOrCreateContact(candidate(), { action: 'AUTO' }, params);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'Contact', entityId: 'created-contact' }),
      tx,
    );
  });

  it('audits pure reuse through the same transaction even without enrichment', async () => {
    tx.contact.findMany.mockResolvedValue([existingContact()]);
    const result = await resolveOrCreateContact(candidate(), { action: 'AUTO' }, params);

    expect(result.outcome).toBe('REUSED_NAME');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'contact-1',
        metadata: expect.objectContaining({ source: 'MANUAL', outcome: 'REUSED_NAME', matchReason: ['EXACT_CANONICAL_NAME'] }),
      }),
      tx,
    );
  });

  it('does not lock on or enrich from a low-confidence identifier', async () => {
    tx.contact.findMany.mockResolvedValue([existingContact()]);

    const result = await resolveOrCreateContact(
      candidate({
        identificationType: 'NRIC',
        identificationNumber: 'S1234567A',
        confidence: { identificationNumber: 0.5 },
      }),
      { action: 'AUTO' },
      params,
    );

    const lockKeys = tx.$executeRaw.mock.calls
      .map(([query]) => query.values[0])
      .filter((key): key is string => String(key).startsWith('contact-identity:'));
    expect(lockKeys.some((key) => key.includes(':id:'))).toBe(false);
    expect(tx.contact.update).not.toHaveBeenCalled();
    expect(result.enrichedFields).toEqual([]);
  });

  it('keeps legacy direct creation canonical-name writes consistent', async () => {
    vi.mocked(prisma.contact.create).mockResolvedValue(
      existingContact({ id: 'legacy-created' }) as never,
    );

    await createContact(
      { contactType: 'INDIVIDUAL', firstName: 'Ｗａｎｇ', lastName: ' 小明 ' },
      params,
    );

    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ canonicalName: 'wang小明' }),
    });
  });

  it('ignores unrelated contacts with different strong identifiers during preview', async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      existingContact({
        id: 'unrelated',
        firstName: 'Unrelated Person',
        fullName: 'Unrelated Person',
        canonicalName: 'unrelatedperson',
        identificationType: 'NRIC',
        identificationNumber: 'S7654321A',
      }),
    ] as never);

    await expect(
      previewContactIdentity(
        candidate({ identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
        'tenant-1',
      ),
    ).resolves.toBeNull();
  });

  it('does not attach unrelated identifier conflicts to a newly created contact', async () => {
    tx.contact.findMany.mockResolvedValue([
      existingContact({
        id: 'unrelated',
        firstName: 'Unrelated Person',
        fullName: 'Unrelated Person',
        canonicalName: 'unrelatedperson',
        identificationType: 'NRIC',
        identificationNumber: 'S7654321A',
      }),
    ]);

    const result = await resolveOrCreateContact(
      candidate({ identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
      { action: 'AUTO' },
      params,
    );

    expect(result.outcome).toBe('CREATED');
    expect(result.match).toBeNull();
    expect(result.conflicts).toEqual([]);
  });

  it('updates display and canonical names when identifier reuse fills a blank name', async () => {
    tx.contact.findMany.mockResolvedValue([
      existingContact({
        firstName: '',
        lastName: null,
        fullName: 'Unknown',
        canonicalName: '',
        identificationType: 'NRIC',
        identificationNumber: 'S1234567A',
      }),
    ]);

    await resolveOrCreateContact(
      candidate({ firstName: 'Ｗａｎｇ', lastName: '小明', identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
      { action: 'AUTO' },
      params,
    );

    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact-1' },
      data: expect.objectContaining({
        firstName: 'Ｗａｎｇ',
        lastName: '小明',
        fullName: 'Ｗａｎｇ 小明',
        canonicalName: 'wang小明',
      }),
    });
  });

  it('updates corporate display and canonical names when identifier reuse enriches corporateName', async () => {
    tx.contact.findMany.mockResolvedValue([
      existingContact({
        contactType: 'CORPORATE',
        firstName: null,
        corporateName: '',
        fullName: 'Unknown Corporate',
        canonicalName: '',
        corporateUen: '202400001A',
      }),
    ]);

    await resolveOrCreateContact(
      candidate({ contactType: 'CORPORATE', firstName: null, corporateName: 'Acme Pte Ltd', corporateUen: '202400001A' }),
      { action: 'AUTO' },
      params,
    );

    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact-1' },
      data: expect.objectContaining({ fullName: 'Acme Pte Ltd', canonicalName: 'acmepteltd' }),
    });
  });

  it('does not combine an incoming identification number with an incompatible existing type', async () => {
    tx.contact.findMany.mockResolvedValue([
      existingContact({ identificationType: 'PASSPORT', identificationNumber: null }),
    ]);

    const result = await resolveOrCreateContact(
      candidate({ identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
      { action: 'AUTO' },
      params,
    );

    expect(result.outcome).toBe('CREATED');
    expect(result.conflicts).toEqual([expect.objectContaining({ field: 'identificationNumber' })]);
    expect(tx.contact.update).not.toHaveBeenCalled();
  });

  it('fills a compatible missing identification half without changing the other half', async () => {
    tx.contact.findMany.mockResolvedValue([
      existingContact({ identificationType: 'NRIC', identificationNumber: null }),
    ]);

    await resolveOrCreateContact(
      candidate({ identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
      { action: 'AUTO' },
      params,
    );

    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact-1' },
      data: expect.objectContaining({ identificationNumber: 'S1234567A' }),
    });
    expect(tx.contact.update.mock.calls[0][0].data).not.toHaveProperty('identificationType');
  });

  it('locks explicit reuse by selected contact ID in sorted order and uses the post-lock requery', async () => {
    const stale = existingContact({ id: 'selected', nationality: null });
    const current = existingContact({ id: 'selected', nationality: 'Current value' });
    tx.contact.findMany.mockResolvedValue([stale]);
    tx.contact.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(current);

    const result = await resolveOrCreateContact(
      candidate({ nationality: 'Incoming value' }),
      { action: 'REUSE', contactId: 'selected' },
      params,
    );

    const lockKeys = tx.$executeRaw.mock.calls
      .map(([query]) => query.values[0])
      .filter((key): key is string => String(key).startsWith('contact-identity:'));
    expect(lockKeys).toContain('contact-identity:tenant-1:INDIVIDUAL:contact:selected');
    expect(lockKeys).toEqual([...lockKeys].sort());
    expect(tx.contact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'selected', tenantId: 'tenant-1', contactType: 'INDIVIDUAL', deletedAt: null, isActive: true },
      include: expect.objectContaining({ contactDetails: expect.anything() }),
    }));
    expect(result.conflicts).toEqual([]);
    expect(tx.contact.update).not.toHaveBeenCalled();
  });

  it('rejects explicit reuse when the selected contact gains a conflicting identifier after preview', async () => {
    const candidateWithId = candidate({
      identificationType: 'NRIC',
      identificationNumber: 'S1234567A',
    });
    tx.contact.findMany.mockResolvedValue([existingContact({ id: 'selected' })]);
    tx.contact.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(existingContact({
      id: 'selected',
      identificationType: 'NRIC',
      identificationNumber: 'S7654321A',
    }));

    await expect(
      resolveOrCreateContact(
        candidateWithId,
        { action: 'REUSE', contactId: 'selected' },
        params,
      ),
    ).rejects.toThrow(/no longer.*qualifying.*match/i);

    expect(tx.contact.update).not.toHaveBeenCalled();
    expect(createContactDetail).not.toHaveBeenCalled();
  });

  it('rejects stale create-separate decisions with no current review match', async () => {
    tx.contact.findMany.mockResolvedValue([]);

    await expect(
      resolveOrCreateContact(
        candidate(),
        { action: 'CREATE_SEPARATE', reason: 'Confirmed to be another person' },
        params,
      ),
    ).rejects.toThrow('review match');
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.contactDuplicateDecision.create).not.toHaveBeenCalled();
  });

  it('uses a supplied transaction for updateContact lookup, mutation, and audit', async () => {
    const current = existingContact({ firstName: 'Old', fullName: 'Old' });
    tx.contact.findFirst.mockResolvedValue(current);
    tx.contact.update.mockResolvedValue(existingContact({ firstName: 'New', fullName: 'New' }));

    await updateContact(
      { id: 'contact-1', firstName: 'New' },
      { ...params, tx: tx as never },
    );

    expect(tx.contact.findFirst).toHaveBeenCalledWith({ where: { id: 'contact-1', tenantId: 'tenant-1' } });
    expect(tx.contact.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'contact-1' } }));
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'contact-1' }), tx);
  });
});
