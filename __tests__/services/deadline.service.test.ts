import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@/lib/errors';
import type { DeadlineDb } from '@/services/deadline';

const prismaMock = vi.hoisted(() => ({
  deadlineOccurrence: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const auditMock = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => auditMock);

import {
  deriveDeadlineTiming,
  deriveDeadlineTimingBucket,
  getDeadlineOccurrence,
  listDeadlines,
  resetDeadlineDateOverride,
  toDeadlineDto,
  updateDeadlineOccurrence,
} from '@/services/deadline';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };
const occurrence = {
  id: 'deadline-1',
  tenantId: actor.tenantId,
  companyId: 'company-1',
  clientServiceId: 'service-1',
  cycleId: 'cycle-1',
  ruleVersionId: 'version-1',
  milestoneKey: 'annual-return',
  scheduleEntryKey: '',
  deadlineType: 'STATUTORY' as const,
  calculatedDueDate: new Date('2026-08-18T00:00:00.000Z'),
  operativeDueDate: new Date('2026-08-18T00:00:00.000Z'),
  dateOverridden: false,
  dateOverride: null,
  dateOverrideReason: null,
  dateOverriddenById: null,
  dateOverriddenAt: null,
  status: 'OPEN' as const,
  completedAt: null,
  completedById: null,
  waivedAt: null,
  waivedById: null,
  waiverReason: null,
  cancelledAt: null,
  cancelledById: null,
  cancellationReason: null,
  origin: 'RULE' as const,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-10T00:00:00.000Z'),
  company: { id: 'company-1', name: 'Example Pte. Ltd.', displayAlias: null },
  clientService: { id: 'service-1', serviceName: 'Annual Return', familyName: 'Corporate' },
  cycle: { id: 'cycle-1', periodKey: '2026', periodStart: new Date('2026-01-01T00:00:00.000Z'), periodEnd: new Date('2026-12-31T00:00:00.000Z') },
};

const search = {
  from: '2026-08-01',
  to: '2026-08-31',
  mode: 'TABLE' as const,
  types: ['STATUTORY', 'CLIENT', 'INTERNAL'] as const,
  familyIds: [],
  companyIds: [],
  statuses: [],
  timing: [],
  openOnly: true,
  page: 1,
  limit: 50,
  sortBy: 'dueDate' as const,
  sortOrder: 'asc' as const,
};

describe('deadline service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([occurrence]);
    prismaMock.deadlineOccurrence.count.mockResolvedValue(1);
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue(occurrence);
    prismaMock.deadlineOccurrence.updateMany.mockResolvedValue({ count: 1 });
    auditMock.createAuditLog.mockResolvedValue(undefined);
  });

  it.each([
    ['2026-08-18', 'UPCOMING'],
    ['2026-08-17', 'DUE'],
    ['2026-08-16', 'OVERDUE'],
  ] as const)('derives %s as %s', (dueDate, timingState) => {
    expect(deriveDeadlineTiming('OPEN', dueDate, '2026-08-17')).toBe(timingState);
  });

  it('does not derive timing for a non-open occurrence', () => {
    expect(deriveDeadlineTiming('COMPLETED', '2026-08-16', '2026-08-17')).toBeNull();
  });

  it('rejects edits to a cancelled occurrence', async () => {
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({ ...occurrence, status: 'CANCELLED' });

    await expect(updateDeadlineOccurrence('deadline-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'OPEN',
      reason: 'Reopen for correction',
    }, actor)).rejects.toMatchObject({ code: ErrorCodes.OCCURRENCE_IMMUTABLE });
    expect(prismaMock.deadlineOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it('uses tenant and accessible-company predicates inside the occurrence query', async () => {
    await listDeadlines(search, { ...actor, companyIds: ['company-1'] });

    expect(prismaMock.deadlineOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: actor.tenantId,
        companyId: { in: ['company-1'] },
        operativeDueDate: { gte: new Date('2026-08-01T00:00:00.000Z'), lte: new Date('2026-08-31T00:00:00.000Z') },
      }),
    }));
  });

  it('applies a requested company filter for all-company access', async () => {
    const requestedCompanyId = '44444444-4444-4444-8444-444444444444';
    await listDeadlines({ ...search, companyIds: [requestedCompanyId] }, actor);

    expect(prismaMock.deadlineOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: { in: [requestedCompanyId] } }),
    }));
  });

  it('preserves all accessible companies when all-company access has no requested filter', async () => {
    await listDeadlines(search, { ...actor, companyIds: undefined });

    const [args] = prismaMock.deadlineOccurrence.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).not.toHaveProperty('companyId');
  });

  it('omits the due-date predicate for an unbounded table request', async () => {
    await listDeadlines({ ...search, from: undefined, to: undefined }, { ...actor, companyIds: undefined });

    const [args] = prismaMock.deadlineOccurrence.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).not.toHaveProperty('operativeDueDate');
  });

  it('intersects requested company IDs with restricted access in SQL', async () => {
    const accessibleCompanyIds = [
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    await listDeadlines({ ...search, companyIds: [accessibleCompanyIds[1]!, '66666666-6666-4666-8666-666666666666'] }, {
      ...actor,
      companyIds: accessibleCompanyIds,
    });

    expect(prismaMock.deadlineOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: { in: [accessibleCompanyIds[1]] } }),
    }));
  });

  it('short-circuits when requested companies have no accessible intersection', async () => {
    const result = await listDeadlines({ ...search, companyIds: ['66666666-6666-4666-8666-666666666666'] }, {
      ...actor,
      companyIds: ['44444444-4444-4444-8444-444444444444'],
    });

    expect(result).toMatchObject({ mode: 'TABLE', items: [], total: 0, totalPages: 0 });
    expect(prismaMock.deadlineOccurrence.findMany).not.toHaveBeenCalled();
    expect(prismaMock.deadlineOccurrence.count).not.toHaveBeenCalled();
  });

  it('adds same-tenant predicates for every required related record', async () => {
    await listDeadlines(search, actor);

    const [args] = prismaMock.deadlineOccurrence.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where.company).toEqual({ tenantId: actor.tenantId, deletedAt: null });
    expect(args.where.OR).toEqual([
      { ownershipScope: 'COMPANY', clientServiceId: null },
      {
        ownershipScope: 'SERVICE',
        clientService: expect.objectContaining({
          tenantId: actor.tenantId,
          serviceVariant: expect.objectContaining({
            tenantId: actor.tenantId,
            family: { tenantId: actor.tenantId },
          }),
        }),
      },
    ]);
    expect(args.where.cycle).toEqual({ tenantId: actor.tenantId });
    expect(args.where.ruleVersion).toEqual({ tenantId: actor.tenantId });
  });

  it('matches company-owned obligations by their covering service when filtering by service or family', async () => {
    await listDeadlines({ ...search, serviceQuery: 'Tax' }, actor);

    const [args] = prismaMock.deadlineOccurrence.findMany.mock.calls[0] as [{ where: { OR: Array<Record<string, unknown>> } }];
    const serviceFilter = expect.objectContaining({ serviceName: { contains: 'Tax', mode: 'insensitive' } });
    expect(args.where.OR).toHaveLength(2);
    expect(args.where.OR[0]).toMatchObject({
      ownershipScope: 'COMPANY',
      OR: [
        { deliveryClientService: serviceFilter },
        { deliveryClientServiceId: null, coverageLinks: { some: { releasedAt: null, coverage: { is: { clientService: { is: serviceFilter } } } } } },
      ],
    });
    expect(args.where.OR[1]).toMatchObject({ ownershipScope: 'SERVICE', clientService: serviceFilter });
  });

  it('filters by a timing bucket without overlapping the next bucket', async () => {
    await listDeadlines({ ...search, timingBucket: 'WITHIN_3_MONTHS' }, actor, prismaMock, { today: '2026-09-28' });

    const [args] = prismaMock.deadlineOccurrence.findMany.mock.calls[0] as [{ where: { AND: Array<Record<string, unknown>> } }];
    expect(args.where.AND).toContainEqual({
      status: 'OPEN',
      operativeDueDate: { gt: new Date('2026-10-28T00:00:00.000Z'), lte: new Date('2026-12-28T00:00:00.000Z') },
    });
  });

  it('buckets open deadlines by how far away they are', () => {
    const today = '2026-09-28';
    expect(deriveDeadlineTimingBucket('OPEN', '2026-09-27', today)).toBe('OVERDUE');
    expect(deriveDeadlineTimingBucket('OPEN', '2026-09-27', today, true)).toBe('TAKEOVER_REVIEW');
    expect(deriveDeadlineTimingBucket('OPEN', '2026-09-28', today)).toBe('DUE_TODAY');
    expect(deriveDeadlineTimingBucket('OPEN', '2026-10-28', today)).toBe('WITHIN_1_MONTH');
    expect(deriveDeadlineTimingBucket('OPEN', '2026-10-29', today)).toBe('WITHIN_3_MONTHS');
    expect(deriveDeadlineTimingBucket('OPEN', '2027-03-28', today)).toBe('WITHIN_6_MONTHS');
    expect(deriveDeadlineTimingBucket('OPEN', '2027-09-28', today)).toBe('WITHIN_12_MONTHS');
    expect(deriveDeadlineTimingBucket('OPEN', '2027-09-29', today)).toBe('OVER_12_MONTHS');
    expect(deriveDeadlineTimingBucket('COMPLETED', '2027-09-29', today)).toBeNull();
  });

  it('shows a company-owned obligation under the service that files it, else the service monitoring it', async () => {
    const taxService = {
      id: 'tax-service',
      tenantId: actor.tenantId,
      serviceName: 'Tax Compliance',
      familyName: 'Tax',
      serviceVariant: { id: 'variant-1', tenantId: actor.tenantId, name: 'Standard', family: { id: 'family-tax', tenantId: actor.tenantId, name: 'Tax', displayColor: '#123456' } },
    };
    const companyRow = {
      ...occurrence,
      ownershipScope: 'COMPANY',
      clientServiceId: null,
      clientService: null,
      milestoneKey: 'eci-due',
      obligationCode: 'SG_ECI',
      obligationPeriodKey: 'YA2027',
    };

    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({ ...companyRow, deliveryClientServiceId: 'tax-service', deliveryClientService: taxService, coverageLinks: [] });
    await expect(getDeadlineOccurrence('deadline-1', actor)).resolves.toMatchObject({
      clientServiceId: null,
      service: { id: 'tax-service', name: 'Tax Compliance', familyName: 'Tax' },
      family: { id: 'family-tax', name: 'Tax', displayColor: '#123456' },
    });

    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({ ...companyRow, deliveryClientServiceId: null, deliveryClientService: null, coverageLinks: [{ coverage: { clientService: taxService } }] });
    await expect(getDeadlineOccurrence('deadline-1', actor)).resolves.toMatchObject({
      service: { id: 'tax-service', name: 'Tax Compliance' },
      family: { name: 'Tax' },
    });
  });

  it('maps a company-owned obligation without a service and marks earlier filings for review', async () => {
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({
      ...occurrence,
      ownershipScope: 'COMPANY',
      clientServiceId: null,
      clientService: null,
      obligationCode: 'SG_FORM_C',
      obligationPeriodKey: 'YA2026',
      financialPeriodStart: new Date('2025-01-01T00:00:00.000Z'),
      financialPeriodEnd: new Date('2025-12-31T00:00:00.000Z'),
      yearOfAssessment: 2026,
      periodProvisional: false,
      filingResponsibility: 'UNCONFIRMED',
      deliveryClientServiceId: null,
      coverageTiming: 'BEFORE_START',
      filingStatusUnconfirmed: true,
      status: 'OPEN',
      operativeDueDate: new Date('2020-11-30T00:00:00.000Z'),
      calculatedDueDate: new Date('2020-11-30T00:00:00.000Z'),
    });

    const dto = await getDeadlineOccurrence('deadline-1', actor);

    expect(dto).toMatchObject({
      ownershipScope: 'COMPANY',
      clientServiceId: null,
      service: null,
      timingState: 'REVIEW',
      timingBucket: 'TAKEOVER_REVIEW',
      family: { id: null, name: '' },
      obligation: { code: 'SG_FORM_C', periodKey: 'YA2026', yearOfAssessment: 2026, filingStatusUnconfirmed: true },
    });
  });

  it('returns not found for a detail row with a mismatched related tenant', async () => {
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({
      ...occurrence,
      clientService: { ...occurrence.clientService, tenantId: 'tenant-2' },
    });

    await expect(getDeadlineOccurrence('deadline-1', actor)).rejects.toMatchObject({ code: ErrorCodes.NOT_FOUND });
  });

  it.each([
    ['company', { company: { ...occurrence.company, tenantId: 'tenant-2' } }],
    ['service variant', { clientService: { ...occurrence.clientService, serviceVariant: { tenantId: 'tenant-2', family: { tenantId: actor.tenantId } } } }],
    ['service family', { clientService: { ...occurrence.clientService, serviceVariant: { tenantId: actor.tenantId, family: { tenantId: 'tenant-2' } } } }],
    ['cycle', { cycle: { ...occurrence.cycle, tenantId: 'tenant-2' } }],
  ])('returns not found for a mismatched %s relation', async (_relation, mismatch) => {
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({ ...occurrence, ...mismatch });

    await expect(getDeadlineOccurrence('deadline-1', actor)).rejects.toMatchObject({ code: ErrorCodes.NOT_FOUND });
  });

  it('returns not found for a mismatched DeadlineRuleVersion tenant', async () => {
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({
      ...occurrence,
      ruleVersion: { tenantId: 'tenant-2' },
    });

    await expect(getDeadlineOccurrence('deadline-1', actor)).rejects.toMatchObject({ code: ErrorCodes.NOT_FOUND });
  });

  it('rejects update when a required relation has another tenant without writing or auditing', async () => {
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({
      ...occurrence,
      ruleVersion: { tenantId: 'tenant-2' },
    });

    await expect(updateDeadlineOccurrence('deadline-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'COMPLETED',
      reason: 'Filed',
    }, actor)).rejects.toMatchObject({ code: ErrorCodes.NOT_FOUND });
    expect(prismaMock.deadlineOccurrence.updateMany).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('rejects reset when a required relation has another tenant without writing or auditing', async () => {
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({
      ...occurrence,
      cycle: { ...occurrence.cycle, tenantId: 'tenant-2' },
    });

    await expect(resetDeadlineDateOverride('deadline-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      reason: 'Reset',
    }, actor)).rejects.toMatchObject({ code: ErrorCodes.NOT_FOUND });
    expect(prismaMock.deadlineOccurrence.updateMany).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('filters a malformed related tenant from list DTOs defensively', async () => {
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([
      { ...occurrence, company: { ...occurrence.company, tenantId: 'tenant-2' } },
    ]);

    const result = await listDeadlines(search, actor);

    expect(result.items).toEqual([]);
  });

  it('returns persisted notes in the occurrence DTO', () => {
    expect(toDeadlineDto({ ...occurrence, notes: 'Bring signed copy' })).toMatchObject({ notes: 'Bring signed copy' });
  });

  it('persists notes and audits every changed lifecycle field', async () => {
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({ ...occurrence, notes: 'Old note' });

    const result = await updateDeadlineOccurrence('deadline-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'COMPLETED',
      completionDate: '2026-08-19',
      notes: 'Filed with signed copy',
      reason: 'Filing completed',
    }, actor);

    expect(result.notes).toBe('Filed with signed copy');
    expect(prismaMock.deadlineOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notes: 'Filed with signed copy', completedById: actor.userId }),
    }));
    const [audit] = auditMock.createAuditLog.mock.calls[0] as [{ changes: Record<string, unknown> }];
    expect(audit.changes).toEqual(expect.objectContaining({
      status: expect.any(Object),
      completedAt: expect.any(Object),
      completedById: expect.any(Object),
      waivedAt: expect.any(Object),
      waiverReason: expect.any(Object),
      dateOverrideReason: expect.any(Object),
      notes: { old: 'Old note', new: 'Filed with signed copy' },
    }));
  });

  it('rolls back the occurrence write when the audit transaction fails', async () => {
    let persistedStatus: string = occurrence.status;
    let stagedStatus: string = persistedStatus;
    const txUpdateMany = vi.fn(async ({ data }: { data: { status?: string } }) => {
      stagedStatus = data.status ?? stagedStatus;
      return { count: 1 };
    });
    const tx = {
      deadlineOccurrence: {
        findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(),
        updateMany: txUpdateMany,
      },
    } as unknown as DeadlineDb;
    const db = {
      deadlineOccurrence: {
        findMany: vi.fn(), count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(occurrence),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (transaction: DeadlineDb) => Promise<unknown>) => {
        try {
          const result = await callback(tx);
          persistedStatus = stagedStatus;
          return result;
        } catch (error) {
          stagedStatus = persistedStatus;
          throw error;
        }
      }),
    } as unknown as DeadlineDb;
    auditMock.createAuditLog.mockRejectedValueOnce(new Error('audit write failed'));

    await expect(updateDeadlineOccurrence('deadline-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(), status: 'COMPLETED', reason: 'Filed',
    }, actor, db)).rejects.toThrow('audit write failed');
    expect(txUpdateMany).toHaveBeenCalledTimes(1);
    expect(persistedStatus).toBe('OPEN');
    expect(stagedStatus).toBe('OPEN');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not constrain deadline type when every type is deselected', async () => {
    const result = await listDeadlines({ ...search, types: [] }, actor);

    expect(result).toMatchObject({ mode: 'TABLE', total: 1, totalPages: 1 });
    expect(prismaMock.deadlineOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ deadlineType: expect.anything() }),
    }));
    expect(prismaMock.deadlineOccurrence.count).toHaveBeenCalled();
  });

  it('rejects direct transitions between completed and waived', async () => {
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({ ...occurrence, status: 'COMPLETED' });

    await expect(updateDeadlineOccurrence('deadline-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'WAIVED',
      reason: 'Incorrect lifecycle action',
    }, actor)).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
    expect(prismaMock.deadlineOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it('requires a reason when reopening a completed occurrence', async () => {
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({ ...occurrence, status: 'COMPLETED' });

    await expect(updateDeadlineOccurrence('deadline-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'OPEN',
    }, actor)).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
    expect(prismaMock.deadlineOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it('limits calendar results to 5,000 occurrences and reports truncation', async () => {
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, (_, index) => ({ ...occurrence, id: `deadline-${index}` })),
    );

    const result = await listDeadlines({ ...search, mode: 'CALENDAR' }, actor);

    expect(result).toMatchObject({ mode: 'CALENDAR', truncated: true, warning: expect.any(String) });
    expect(result.items).toHaveLength(5000);
    expect(prismaMock.deadlineOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5001 }));
  });

  it('does not mark exactly 5,000 calendar rows as truncated', async () => {
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue(
      Array.from({ length: 5000 }, (_, index) => ({ ...occurrence, id: `deadline-${index}` })),
    );

    const result = await listDeadlines({ ...search, mode: 'CALENDAR' }, actor);

    expect(result).toMatchObject({ mode: 'CALENDAR', truncated: false });
    expect(result.items).toHaveLength(5000);
  });

  it('uses table pagination, deterministic sorting, and Singapore timing predicates', async () => {
    await listDeadlines({ ...search, page: 3, limit: 10, sortBy: 'company', sortOrder: 'desc', timing: ['DUE'] }, actor, prismaMock, { today: '2026-08-17' });

    const [findManyArgs] = prismaMock.deadlineOccurrence.findMany.mock.calls[0] as [{ where: unknown; skip: number; take: number; orderBy: unknown }];
    const [countArgs] = prismaMock.deadlineOccurrence.count.mock.calls[0] as [{ where: unknown }];
    expect(findManyArgs.skip).toBe(20);
    expect(findManyArgs.take).toBe(10);
    expect(findManyArgs.orderBy).toEqual([{ company: { name: 'desc' } }, { operativeDueDate: 'asc' }, { id: 'asc' }]);
    expect(findManyArgs.where).toEqual(countArgs.where);
    expect(findManyArgs.where).toEqual(expect.objectContaining({
      AND: [
        expect.objectContaining({ status: 'OPEN', OR: [{ operativeDueDate: new Date('2026-08-17T00:00:00.000Z') }] }),
        // Open means ours to file: Managed externally company rows count as Waived.
        expect.objectContaining({ status: 'OPEN', OR: expect.arrayContaining([{ ownershipScope: 'SERVICE' }]) }),
      ],
    }));
  });

  it('turns an optimistic update miss into a version conflict without an audit', async () => {
    prismaMock.deadlineOccurrence.updateMany.mockResolvedValue({ count: 0 });

    await expect(updateDeadlineOccurrence('deadline-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(), status: 'COMPLETED', reason: 'Filed',
    }, actor)).rejects.toMatchObject({ code: ErrorCodes.VERSION_CONFLICT });
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('resets an override to the calculated due date with an optimistic timestamp', async () => {
    const overridden = {
      ...occurrence,
      dateOverridden: true,
      dateOverride: new Date('2026-08-20T00:00:00.000Z'),
      dateOverrideReason: 'Temporary client request',
      dateOverriddenById: actor.userId,
      dateOverriddenAt: new Date('2026-08-10T00:00:00.000Z'),
      operativeDueDate: new Date('2026-08-20T00:00:00.000Z'),
    };
    prismaMock.deadlineOccurrence.findFirst.mockResolvedValue(overridden);

    await resetDeadlineDateOverride('deadline-1', {
      expectedUpdatedAt: overridden.updatedAt.toISOString(),
      reason: 'Use rule-calculated due date',
    }, actor);

    expect(prismaMock.deadlineOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'deadline-1', tenantId: actor.tenantId, status: { not: 'CANCELLED' } }),
      data: expect.objectContaining({
        operativeDueDate: overridden.calculatedDueDate,
        dateOverridden: false,
        dateOverride: null,
        dateOverrideReason: null,
      }),
    }));
    expect(auditMock.createAuditLog).toHaveBeenCalled();
  });
});
