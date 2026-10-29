import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DateOnly } from '@/services/service-schedule';
import { hashConfiguration } from '@/services/service-schedule';
import {
  type BillingScheduleConfigV1,
  type EvaluatedBillingOccurrence,
  listBillingCoverage,
  reconcileBillingCoverage,
  billingCoverageIssueKey,
} from '@/services/billing';
import { evaluateBillingSchedule } from '@/services/billing/schedule';

const mocks = vi.hoisted(() => ({
  clientService: { findFirst: vi.fn(), count: vi.fn() },
  businessCalendar: { findFirst: vi.fn() },
  billingOccurrence: { findMany: vi.fn() },
  billingCoverageIssue: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));

const input = {
  tenantId: 'tenant-1',
  clientServiceId: 'service-1',
  today: '2026-08-18' as DateOnly,
  horizonEnd: '2027-08-18' as DateOnly,
  writeMode: 'APPLY' as const,
};

const baseService = {
  id: 'service-1',
  tenantId: 'tenant-1',
  companyId: 'company-1',
  status: 'ACTIVE',
  deletedAt: null,
  billingDisposition: 'UNREVIEWED',
  billingNotRequiredReason: null,
  feeLines: [],
};

function feeLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fee-1',
    description: 'Monthly support',
    amount: '100.00',
    currency: 'SGD',
    billingFrequency: 'MONTHLY',
    billingStartDate: new Date('2026-08-01T00:00:00.000Z'),
    scheduleConfig: {
      schemaVersion: 1,
      cadence: 'MONTHLY',
      startDate: '2026-08-01',
      customInterval: { unit: 'MONTH', count: 1 },
      scheduleEntries: [{
        key: 'default',
        label: 'Billing date',
        expression: { kind: 'DAY_OF_MONTH', day: 1 },
        businessDayAdjustment: 'NONE',
      }],
    },
    isActive: true,
    deletedAt: null,
    ...overrides,
  };
}

describe('reconcileBillingCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientService.findFirst.mockResolvedValue(baseService);
    mocks.clientService.count.mockResolvedValue(0);
    mocks.businessCalendar.findFirst.mockResolvedValue(null);
    mocks.billingOccurrence.findMany.mockResolvedValue([]);
    mocks.billingCoverageIssue.findMany.mockResolvedValue([]);
    mocks.billingCoverageIssue.create.mockResolvedValue({});
    mocks.billingCoverageIssue.update.mockResolvedValue({});
    mocks.billingCoverageIssue.updateMany.mockResolvedValue({ count: 0 });
  });

  it.each([
    ['UNREVIEWED', [], 'MISSING_DISPOSITION'],
    ['CONFIGURED', [], 'MISSING_FEE_LINES'],
  ] as const)('detects %s coverage as %s', async (disposition, feeLines, issueType) => {
    mocks.clientService.findFirst.mockResolvedValue({ ...baseService, billingDisposition: disposition, feeLines });

    const result = await reconcileBillingCoverage(input);

    expect(result.openIssues).toContainEqual(expect.objectContaining({ type: issueType }));
  });

  it.each([
    ['MISSING_START_DATE', [feeLine({ scheduleConfig: { ...feeLine().scheduleConfig, startDate: null } })]],
    ['INVALID_CUSTOM_SCHEDULE', [feeLine({
      scheduleConfig: { ...feeLine().scheduleConfig, cadence: 'CUSTOM', customInterval: { unit: 'MONTH', count: 0 } },
    })]],
    ['MISSING_SCHEDULE_PARAMETER', [feeLine({
      scheduleConfig: { ...feeLine().scheduleConfig, cadence: 'CUSTOM', customInterval: null },
    })]],
    ['OCCURRENCE_GAP', [feeLine()]],
    ['INVALID_AMOUNT_OR_CURRENCY', [feeLine({ amount: '-1.00' })]],
  ] as const)('detects the exact %s issue type', async (issueType, feeLines) => {
    mocks.clientService.findFirst.mockResolvedValue({ ...baseService, billingDisposition: 'CONFIGURED', feeLines });

    const result = await reconcileBillingCoverage(input);

    expect(result.openIssues.map((issue) => issue.type)).toContain(issueType);
  });

  it('requires a reason for Not required and creates no missing-fee issue', async () => {
    mocks.clientService.findFirst.mockResolvedValue({
      ...baseService,
      billingDisposition: 'NOT_REQUIRED',
      billingNotRequiredReason: 'Included in another engagement',
      feeLines: [],
    });

    const result = await reconcileBillingCoverage(input);

    expect(result.openIssues).toHaveLength(0);
    expect(mocks.billingCoverageIssue.create).not.toHaveBeenCalled();
  });

  it('uses a tenant and schedule-stable SHA-256 issue key and does not write in Observe mode', async () => {
    mocks.clientService.findFirst.mockResolvedValue({
      ...baseService,
      billingDisposition: 'CONFIGURED',
      feeLines: [feeLine({ amount: '-1.00' })],
    });

    const result = await reconcileBillingCoverage({ ...input, writeMode: 'OBSERVE' });
    const issue = result.openIssues.find((item) => item.type === 'INVALID_AMOUNT_OR_CURRENCY');

    expect(issue?.issueKey).toMatch(/^[a-f0-9]{64}$/);
    expect(issue?.issueKey).toBe(billingCoverageIssueKey({
      tenantId: 'tenant-1',
      clientServiceId: 'service-1',
      feeLineId: 'fee-1',
      type: 'INVALID_AMOUNT_OR_CURRENCY',
      scheduleKey: 'fee-line',
    }));
    expect(issue?.issueKey).toBe(hashConfiguration({
      tenantId: 'tenant-1',
      clientServiceId: 'service-1',
      feeLineId: 'fee-1',
      type: 'INVALID_AMOUNT_OR_CURRENCY',
      scheduleKey: 'fee-line',
    }));
    expect(mocks.billingCoverageIssue.create).not.toHaveBeenCalled();
    expect(mocks.billingCoverageIssue.update).not.toHaveBeenCalled();
    expect(mocks.billingCoverageIssue.updateMany).not.toHaveBeenCalled();
  });

  it('classifies a malformed business calendar as an invalid schedule', async () => {
    mocks.clientService.findFirst.mockResolvedValue({
      ...baseService,
      billingDisposition: 'CONFIGURED',
      feeLines: [feeLine()],
    });
    mocks.businessCalendar.findFirst.mockResolvedValue({
      id: 'malformed-calendar',
      timeZone: 'Asia/Singapore',
      revision: 1,
      weekendDays: [7],
      holidays: [],
    });

    const result = await reconcileBillingCoverage({ ...input, writeMode: 'OBSERVE' });

    expect(result.openIssues).toContainEqual(expect.objectContaining({
      type: 'INVALID_CUSTOM_SCHEDULE',
      feeLineId: 'fee-1',
    }));
    expect(mocks.billingOccurrence.findMany).toHaveBeenCalled();
    expect(mocks.billingCoverageIssue.create).not.toHaveBeenCalled();
  });

  it('retains existing issues for paused services without creating rolling-gap issues', async () => {
    mocks.clientService.findFirst.mockResolvedValue({ ...baseService, status: 'PAUSED' });
    mocks.billingCoverageIssue.findMany.mockResolvedValue([{
      issueKey: 'existing-key',
      type: 'MISSING_DISPOSITION',
      severity: 'ERROR',
      feeLineId: null,
      details: { message: 'Review billing disposition' },
    }]);

    const result = await reconcileBillingCoverage(input);

    expect(result.openIssues).toEqual([expect.objectContaining({ issueKey: 'existing-key' })]);
    expect(mocks.billingCoverageIssue.create).not.toHaveBeenCalled();
    expect(mocks.billingOccurrence.findMany).not.toHaveBeenCalled();
  });

  it('does not invent an issue for ended services with existing open occurrences', async () => {
    mocks.clientService.findFirst.mockResolvedValue({ ...baseService, status: 'ENDED' });
    mocks.billingOccurrence.findMany.mockResolvedValue([{
      feeLineId: 'fee-1',
      billingPeriodKey: '2026-08',
      scheduleEntryKey: 'default',
      generationKey: 'generation-1',
      status: 'OPEN',
    }]);

    const apply = await reconcileBillingCoverage(input);
    const observe = await reconcileBillingCoverage({ ...input, writeMode: 'OBSERVE' });

    expect(apply.openIssues).toHaveLength(0);
    expect(observe.openIssues).toHaveLength(0);
    expect(apply).toMatchObject({ opened: 0, refreshed: 0, resolved: 0 });
    expect(observe).toMatchObject({ opened: 0, refreshed: 0, resolved: 0 });
    expect(mocks.billingCoverageIssue.create).not.toHaveBeenCalled();
    expect(mocks.billingCoverageIssue.update).not.toHaveBeenCalled();
    expect(mocks.billingCoverageIssue.updateMany).not.toHaveBeenCalled();
  });

  it('retains genuine unresolved issues on ended services without refreshing them', async () => {
    mocks.clientService.findFirst.mockResolvedValue({ ...baseService, status: 'ENDED' });
    mocks.billingCoverageIssue.findMany.mockResolvedValue([{
      id: 'issue-ended',
      issueKey: 'ended-issue',
      type: 'MISSING_DISPOSITION',
      severity: 'ERROR',
      feeLineId: null,
      details: { message: 'Review billing disposition' },
    }]);

    const apply = await reconcileBillingCoverage(input);
    const observe = await reconcileBillingCoverage({ ...input, writeMode: 'OBSERVE' });

    expect(apply.openIssues).toEqual([expect.objectContaining({ issueKey: 'ended-issue' })]);
    expect(observe.openIssues).toEqual([expect.objectContaining({ issueKey: 'ended-issue' })]);
    expect(apply).toMatchObject({ opened: 0, refreshed: 0, resolved: 0 });
    expect(observe).toMatchObject({ opened: 0, refreshed: 0, resolved: 0 });
    expect(mocks.billingCoverageIssue.create).not.toHaveBeenCalled();
    expect(mocks.billingCoverageIssue.update).not.toHaveBeenCalled();
    expect(mocks.billingCoverageIssue.updateMany).not.toHaveBeenCalled();
  });

  it('resolves legacy synthetic ended-service gaps without exposing them as coverage issues', async () => {
    mocks.clientService.findFirst.mockResolvedValue({ ...baseService, status: 'ENDED' });
    const syntheticKey = billingCoverageIssueKey({
      tenantId: input.tenantId,
      clientServiceId: input.clientServiceId,
      feeLineId: null,
      type: 'OCCURRENCE_GAP',
      scheduleKey: 'ended-open-occurrences',
    });
    mocks.billingCoverageIssue.findMany.mockResolvedValue([{
      id: 'issue-synthetic',
      issueKey: syntheticKey,
      type: 'OCCURRENCE_GAP',
      severity: 'WARNING',
      feeLineId: null,
      details: { message: 'Expected billing occurrences are missing (1)' },
    }]);

    const observe = await reconcileBillingCoverage({ ...input, writeMode: 'OBSERVE' });
    mocks.billingCoverageIssue.updateMany.mockResolvedValue({ count: 1 });
    const apply = await reconcileBillingCoverage(input);

    expect(observe.openIssues).toHaveLength(0);
    expect(apply.openIssues).toHaveLength(0);
    expect(observe.resolved).toBe(1);
    expect(apply.resolved).toBe(1);
    expect(mocks.billingCoverageIssue.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each(['OPEN', 'BILLED', 'WAIVED'] as const)('counts %s occurrences toward rolling coverage', async (status) => {
    mocks.clientService.findFirst.mockResolvedValue({
      ...baseService,
      billingDisposition: 'CONFIGURED',
      feeLines: [feeLine()],
    });
    const expected: EvaluatedBillingOccurrence[] = evaluateBillingSchedule({
      config: feeLine().scheduleConfig as BillingScheduleConfigV1,
      feeLine: { id: 'fee-1', amount: '100.00', currency: 'SGD' },
      calendar: {
        id: 'default',
        timeZone: 'Asia/Singapore',
        revision: 1,
        weekendDays: new Set([0, 6]),
        holidays: new Set(),
      },
      from: input.today,
      to: input.horizonEnd,
      generationKey: `billing-v1-${hashConfiguration({ feeLineId: 'fee-1' })}`,
    });
    mocks.billingOccurrence.findMany.mockResolvedValue(expected.map((occurrence) => ({
      ...occurrence,
      status,
    })));

    const result = await reconcileBillingCoverage(input);

    expect(result.openIssues).toHaveLength(0);
  });

  it('reports a rolling gap when only cancelled occurrences match expected identities', async () => {
    mocks.clientService.findFirst.mockResolvedValue({
      ...baseService,
      billingDisposition: 'CONFIGURED',
      feeLines: [feeLine()],
    });
    const expected: EvaluatedBillingOccurrence[] = evaluateBillingSchedule({
      config: feeLine().scheduleConfig as BillingScheduleConfigV1,
      feeLine: { id: 'fee-1', amount: '100.00', currency: 'SGD' },
      calendar: {
        id: 'default',
        timeZone: 'Asia/Singapore',
        revision: 1,
        weekendDays: new Set([0, 6]),
        holidays: new Set(),
      },
      from: input.today,
      to: input.horizonEnd,
      generationKey: `billing-v1-${hashConfiguration({ feeLineId: 'fee-1' })}`,
    });
    mocks.billingOccurrence.findMany.mockResolvedValue(expected.map((occurrence) => ({ ...occurrence, status: 'CANCELLED' })));

    const result = await reconcileBillingCoverage(input);

    expect(result.openIssues).toContainEqual(expect.objectContaining({ type: 'OCCURRENCE_GAP' }));
    expect(mocks.billingCoverageIssue.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        details: expect.objectContaining({
          scheduleKey: 'rolling-horizon',
          missingCount: expected.length,
          firstMissingPeriod: expect.any(String),
        }),
      }),
    }));
  });

  it('refreshes detected issues and resolves open issues no longer present', async () => {
    mocks.clientService.findFirst.mockResolvedValue({ ...baseService, billingDisposition: 'UNREVIEWED' });
    mocks.billingCoverageIssue.findMany.mockResolvedValue([{
      id: 'issue-1',
      issueKey: 'old-key',
      type: 'MISSING_FEE_LINES',
      severity: 'ERROR',
      feeLineId: null,
      details: { message: 'Old issue' },
    }]);

    const result = await reconcileBillingCoverage(input);

    expect(result.openIssues).toContainEqual(expect.objectContaining({ type: 'MISSING_DISPOSITION' }));
    expect(mocks.billingCoverageIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        clientServiceId: 'service-1',
        resolvedAt: null,
        issueKey: { notIn: expect.arrayContaining([expect.any(String)]) },
      }),
      data: expect.objectContaining({ resolvedAt: expect.any(Date) }),
    }));
  });

  it('reports the same stale-resolution counts in Observe and Apply modes', async () => {
    mocks.clientService.findFirst.mockResolvedValue({ ...baseService, billingDisposition: 'UNREVIEWED' });
    const staleIssue = {
      id: 'issue-stale',
      issueKey: 'stale-key',
      type: 'MISSING_FEE_LINES',
      severity: 'ERROR',
      feeLineId: null,
      details: { message: 'Old issue' },
    };
    mocks.billingCoverageIssue.findMany.mockResolvedValue([staleIssue]);

    const observe = await reconcileBillingCoverage({ ...input, writeMode: 'OBSERVE' });
    mocks.billingCoverageIssue.updateMany.mockResolvedValue({ count: 1 });
    const apply = await reconcileBillingCoverage(input);

    expect(observe.resolved).toBe(1);
    expect(apply.resolved).toBe(1);
  });

  it('recovers a unique open-issue collision through the production conflict path', async () => {
    mocks.clientService.findFirst.mockResolvedValue({ ...baseService, billingDisposition: 'UNREVIEWED' });
    const concurrentIssue = {
      id: 'issue-concurrent',
      issueKey: billingCoverageIssueKey({
        tenantId: input.tenantId,
        clientServiceId: input.clientServiceId,
        feeLineId: null,
        type: 'MISSING_DISPOSITION',
        scheduleKey: 'service',
      }),
      type: 'MISSING_DISPOSITION',
      severity: 'ERROR',
      feeLineId: null,
      details: { message: 'Review billing disposition' },
    };
    mocks.billingCoverageIssue.findMany.mockImplementation(async (args?: unknown) => {
      const where = (args as { where?: { issueKey?: string } } | undefined)?.where;
      return where?.issueKey ? [concurrentIssue] : [];
    });
    mocks.billingCoverageIssue.create.mockRejectedValueOnce({ code: 'P2002' });

    const result = await reconcileBillingCoverage(input);

    expect(result).toMatchObject({ opened: 0, refreshed: 1, resolved: 0 });
    expect(mocks.billingCoverageIssue.create).toHaveBeenCalledTimes(1);
    expect(mocks.billingCoverageIssue.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'issue-concurrent', tenantId: input.tenantId }),
    }));
  });

  it('uses atomic issue upsert outcomes when a transactional raw client is available', async () => {
    mocks.clientService.findFirst.mockResolvedValue({ ...baseService, billingDisposition: 'UNREVIEWED' });
    const queryRaw = vi.fn().mockResolvedValue([{ inserted: true }]);
    const db = { ...mocks, $queryRaw: queryRaw };

    const opened = await reconcileBillingCoverage(input, db as never);
    queryRaw.mockResolvedValue([{ inserted: false }]);
    const refreshed = await reconcileBillingCoverage(input, db as never);

    expect(opened).toMatchObject({ opened: 1, refreshed: 0 });
    expect(refreshed).toMatchObject({ opened: 0, refreshed: 1 });
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.billingCoverageIssue.create).not.toHaveBeenCalled();
  });

  it.each([
    ['restricted', ['company-1'], { in: ['company-1'] }],
    ['all', undefined, undefined],
    ['empty', [], { in: [] }],
  ] as const)('keeps %s list queries tenant/company scoped in SQL', async (_label, companyIds, expectedCompanyFilter) => {
    const issueFindMany = vi.fn().mockResolvedValue([]);
    const serviceCount = vi.fn().mockResolvedValue(0);
    const db = {
      billingCoverageIssue: { findMany: issueFindMany },
      clientService: { count: serviceCount },
    };

    await listBillingCoverage({
      tenantId: 'tenant-1',
      companyIds,
      types: ['MISSING_DISPOSITION'],
      severities: ['ERROR'],
    }, db as never);

    const issueWhere = issueFindMany.mock.calls[0]?.[0].where as Record<string, unknown>;
    const countWhere = serviceCount.mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(issueWhere).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      resolvedAt: null,
      type: { in: ['MISSING_DISPOSITION'] },
      severity: { in: ['ERROR'] },
      company: expect.objectContaining({ tenantId: 'tenant-1', deletedAt: null }),
    }));
    expect(countWhere).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      company: expect.objectContaining({ tenantId: 'tenant-1', deletedAt: null }),
      billingCoverageIssues: { none: { tenantId: 'tenant-1', resolvedAt: null } },
    }));
    if (expectedCompanyFilter) {
      expect(issueWhere.companyId).toEqual(expectedCompanyFilter);
      expect((issueWhere.company as Record<string, unknown>).id).toEqual(expectedCompanyFilter);
      expect(countWhere.companyId).toEqual(expectedCompanyFilter);
      expect((countWhere.company as Record<string, unknown>).id).toEqual(expectedCompanyFilter);
    } else {
      expect(issueWhere).not.toHaveProperty('companyId');
      expect(issueWhere.company).not.toHaveProperty('id');
      expect(countWhere).not.toHaveProperty('companyId');
      expect(countWhere.company).not.toHaveProperty('id');
    }
  });
});
