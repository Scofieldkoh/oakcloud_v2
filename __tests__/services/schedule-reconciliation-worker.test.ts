import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    clientService: { findMany: vi.fn() },
    workspace: { findMany: vi.fn() },
    serviceScheduleReconciliationRequest: { updateMany: vi.fn() },
  },
  flags: vi.fn(),
  reconcile: vi.fn(),
  billingReconcile: vi.fn(),
  coverageReconcile: vi.fn(),
  enqueue: vi.fn(),
  monitoredCompanyIds: vi.fn(),
  reconcileCompany: vi.fn(),
  logger: { info: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/logger', () => ({ createLogger: () => mocks.logger }));
vi.mock('@/services/schedule-reconciliation/settings', () => ({
  getServiceWorkspaceFlagsForTenant: mocks.flags,
}));
vi.mock('@/services/schedule-reconciliation/deadline-reconciler', () => ({
  reconcileClientServiceDeadlines: mocks.reconcile,
}));
vi.mock('@/services/billing', () => ({
  reconcileClientServiceBilling: mocks.billingReconcile,
  reconcileBillingCoverage: mocks.coverageReconcile,
}));
vi.mock('@/services/compliance-monitoring/writer', () => ({
  monitoredCompanyIds: mocks.monitoredCompanyIds,
  reconcileCompanyObligations: mocks.reconcileCompany,
}));
vi.mock('@/services/schedule-reconciliation/queue', () => ({
  enqueueScheduleReconciliation: mocks.enqueue,
}));

import {
  buildReconciliationLogEvent,
  enqueueDailyRollingHorizonRequests,
  processScheduleReconciliationBatch,
  reconcileClientServiceThroughWorkerTransaction,
} from '@/services/schedule-reconciliation/worker';

const request = {
  id: 'request-1', tenantId: 'tenant-1', scopeType: 'CLIENT_SERVICE', scopeId: 'service-1',
  triggerType: 'CLIENT_SERVICE_CREATED', correlationId: 'corr-1', requestedById: null, attemptCount: 0,
};

function queryText(value: unknown): string {
  const shape = value as { sql?: string; strings?: readonly string[] };
  return [shape.sql, ...(shape.strings ?? [])].filter(Boolean).join(' ');
}

function expectCompleteReconciliationEvent(event: Record<string, unknown>): void {
  expect(Object.keys(event).sort()).toEqual([
    'attempt',
    'billing',
    'billingPreservedByReason',
    'correlationId',
    'counts',
    'coverage',
    'durationMs',
    'event',
    'metrics',
    'preservedByReason',
    'requestId',
    'tenantId',
    'warnings',
    'writeMode',
  ]);
  expect(event.event).toBe('reconciliation_request');
  expect(typeof event.tenantId).toBe('string');
  expect(typeof event.requestId).toBe('string');
  expect(typeof event.correlationId).toBe('string');
  expect(typeof event.durationMs).toBe('number');
  expect(typeof event.attempt).toBe('number');
  expect(Array.isArray(event.warnings)).toBe(true);
  expect(Object.keys(event.counts as Record<string, unknown>).sort()).toEqual([
    'cancelled', 'created', 'noChange', 'preserved', 'recalculated',
  ]);
  expect(Object.keys(event.preservedByReason as Record<string, unknown>).sort()).toEqual([
    'CANCELLED', 'COMPLETED', 'HISTORICAL', 'MANUAL_TRIGGER', 'OVERRIDDEN', 'WAIVED',
  ]);
  expect(Object.keys(event.billing as Record<string, unknown>).sort()).toEqual([
    'cancelled', 'created', 'preserved', 'recalculated',
  ]);
  expect(Object.keys(event.billingPreservedByReason as Record<string, unknown>).sort()).toEqual([
    'BILLED', 'CANCELLED', 'HISTORICAL', 'MANUAL_TRIGGER', 'OVERRIDDEN', 'WAIVED',
  ]);
  expect(Object.keys(event.coverage as Record<string, unknown>).sort()).toEqual([
    'openIssueCount', 'opened', 'refreshed', 'resolved',
  ]);
  expect(Object.keys(event.metrics as Record<string, unknown>).sort()).toEqual([
    'billing', 'coverage', 'invalidScheduleCount', 'occurrenceGaps', 'servicesMissingDisposition',
  ]);
}

describe('schedule reconciliation worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logger.info.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'));
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma));
    mocks.prisma.$queryRaw.mockResolvedValue([request]);
    mocks.prisma.serviceScheduleReconciliationRequest.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.clientService.findMany.mockResolvedValue([{ id: 'service-1' }]);
    mocks.prisma.workspace.findMany.mockResolvedValue([{ id: 'tenant-1' }]);
    mocks.flags.mockResolvedValue({ workspaceEnabled: true, deadlineWritesEnabled: false, companyMonitoringWritesEnabled: false });
    mocks.monitoredCompanyIds.mockResolvedValue([]);
    mocks.reconcileCompany.mockResolvedValue({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      writeMode: 'OBSERVE',
      counts: { created: 2, recalculated: 0, cancelled: 0, preserved: 0, noChange: 0 },
      preservedByReason: { MANUAL_TRIGGER: 0, HISTORICAL: 0, COMPLETED: 0, WAIVED: 0, CANCELLED: 0, OVERRIDDEN: 0 },
      links: { attached: 2, released: 0 },
      responsibilityChanges: 2,
      issues: { opened: 1, refreshed: 0, resolved: 0, open: 1 },
      projection: null,
    });
    mocks.reconcile.mockResolvedValue({
      tenantId: 'tenant-1', clientServiceId: 'service-1', reconciliationRequestId: 'request-1',
      writeMode: 'OBSERVE',
      counts: { created: 0, recalculated: 0, cancelled: 0, preserved: 0, noChange: 1 },
      preservedByReason: { MANUAL_TRIGGER: 0, HISTORICAL: 0, COMPLETED: 0, WAIVED: 0, CANCELLED: 0, OVERRIDDEN: 0 },
      warnings: [],
    });
    mocks.billingReconcile.mockResolvedValue({
      clientServiceId: 'service-1',
      created: 0,
      recalculated: 0,
      cancelled: 0,
      preserved: 0,
      preservedByReason: {
        MANUAL_TRIGGER: 0,
        HISTORICAL: 0,
        BILLED: 0,
        WAIVED: 0,
        CANCELLED: 0,
        OVERRIDDEN: 0,
      },
      warnings: [],
    });
    mocks.coverageReconcile.mockResolvedValue({
      clientServiceId: 'service-1',
      opened: 0,
      refreshed: 0,
      resolved: 0,
      openIssues: [],
    });
  });

  it('claims with a five-minute lease and SKIP LOCKED, then completes the request', async () => {
    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    const claimSql = queryText(mocks.prisma.$queryRaw.mock.calls[0]?.[0]);
    expect(claimSql).toContain('FOR UPDATE');
    expect(claimSql).toContain('SKIP LOCKED');
    expect(mocks.reconcile.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      tenantId: 'tenant-1', clientServiceId: 'service-1', writeMode: 'OBSERVE', horizonEnd: '2027-08-18',
    }));
    expect(mocks.billingReconcile).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', clientServiceId: 'service-1', writeMode: 'OBSERVE', horizonEnd: '2027-08-18',
      reconciliationRequestId: 'request-1', includeHistoricalStart: true, cancellationActorId: null,
    }), expect.anything());
    expect(mocks.prisma.serviceScheduleReconciliationRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'request-1', tenantId: 'tenant-1', status: 'PROCESSING' }),
      data: expect.objectContaining({ status: 'COMPLETED', leaseOwner: null, leaseExpiresAt: null }),
    }));
    expect(mocks.prisma.serviceScheduleReconciliationRequest.updateMany.mock.calls.filter(([call]) => (
      call.where?.leaseOwner !== undefined && call.data?.leaseExpiresAt instanceof Date
    ))).not.toHaveLength(0);
  });

  it('reconciles monitored company obligations after the service loop without billing', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ ...request, scopeType: 'COMPANY', scopeId: 'company-1' }]);
    mocks.prisma.clientService.findMany.mockResolvedValue([]);
    mocks.monitoredCompanyIds.mockResolvedValue(['company-1', 'company-2']);
    mocks.flags.mockResolvedValue({ workspaceEnabled: true, deadlineWritesEnabled: true, companyMonitoringWritesEnabled: false });

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(mocks.reconcileCompany).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileCompany).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', companyId: 'company-1', writeMode: 'OBSERVE', today: '2026-08-18',
    }), expect.anything());
    expect(mocks.billingReconcile).not.toHaveBeenCalled();
    expect(mocks.coverageReconcile).not.toHaveBeenCalled();
    expect(mocks.prisma.serviceScheduleReconciliationRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        summary: expect.objectContaining({
          companyMonitoring: expect.objectContaining({ writeMode: 'OBSERVE', companyCount: 1, links: { attached: 2, released: 0 } }),
        }),
      }),
    }));
  });

  it('applies company obligations only when company monitoring writes are enabled', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ ...request, scopeType: 'TENANT', scopeId: 'tenant-1' }]);
    mocks.monitoredCompanyIds.mockResolvedValue(['company-1']);
    mocks.flags.mockResolvedValue({ workspaceEnabled: true, deadlineWritesEnabled: false, companyMonitoringWritesEnabled: true });

    await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(mocks.reconcileCompany).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-1', writeMode: 'APPLY' }), expect.anything());
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({ writeMode: 'OBSERVE', companyMonitoringEnabled: true }), expect.anything());
  });

  it('runs deadlines then billing through one leased service transaction', async () => {
    let leaseCalls = 0;

    const summary = await reconcileClientServiceThroughWorkerTransaction(mocks.prisma as never, {
      tenantId: 'tenant-1',
      clientServiceId: 'service-1',
      operation: 'PUBLISH',
      today: '2026-08-18',
      horizonEnd: '2027-08-18',
      writeMode: 'APPLY',
      reconciliationRequestId: 'request-1',
      cancellationActorId: null,
      assertLease: async () => { leaseCalls += 1; },
    });

    expect(leaseCalls).toBe(1);
    expect(summary).toEqual(expect.objectContaining({ deadlines: expect.any(Object), billing: expect.any(Object), coverage: expect.any(Object) }));
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(mocks.billingReconcile.mock.invocationCallOrder[0]!);
    expect(mocks.billingReconcile.mock.invocationCallOrder[0]).toBeLessThan(mocks.coverageReconcile.mock.invocationCallOrder[0]!);
    expect(mocks.coverageReconcile).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', clientServiceId: 'service-1', writeMode: 'APPLY', horizonEnd: '2027-08-18',
    }), expect.anything());
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('reclaims expired processing work and completes permanent missing-input outcomes with warnings', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ ...request, attemptCount: 1 }]);
    mocks.reconcile.mockResolvedValueOnce({
      tenantId: 'tenant-1', clientServiceId: 'service-1', reconciliationRequestId: 'request-1',
      writeMode: 'OBSERVE',
      counts: { created: 0, recalculated: 0, cancelled: 0, preserved: 0, noChange: 0 },
      preservedByReason: { MANUAL_TRIGGER: 0, HISTORICAL: 0, COMPLETED: 0, WAIVED: 0, CANCELLED: 0, OVERRIDDEN: 0 },
      warnings: [{
        code: 'MISSING_INPUT', message: 'Company.entityType is required', ruleId: 'rule-1',
        missingFields: ['entityType'], permanent: true,
      }],
    });

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(mocks.prisma.serviceScheduleReconciliationRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date), leaseOwner: null }),
    }));
    expect(mocks.prisma.serviceScheduleReconciliationRequest.updateMany.mock.calls.at(-1)?.[0].data.summary)
      .toEqual(expect.objectContaining({ warnings: [expect.objectContaining({ code: 'MISSING_INPUT', permanent: true })] }));
    expect(mocks.logger.info).toHaveBeenCalledTimes(1);
    const event = mocks.logger.info.mock.calls[0]?.[1] as Record<string, unknown>;
    expectCompleteReconciliationEvent(event);
    expect(event).toMatchObject({ event: 'reconciliation_request', attempt: 2, writeMode: 'OBSERVE' });
    expect(event.metrics).toBeDefined();
    expect(JSON.stringify(event)).not.toContain('Company.entityType is required');
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });

  it('completes a thrown permanent error with one complete safe event while the lease remains valid', async () => {
    const permanentError = new Error('customer free text must never be emitted') as Error & { code?: string };
    permanentError.code = 'MISSING_RULE_INPUT';
    mocks.reconcile.mockRejectedValueOnce(permanentError);

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0, leaseLost: 0 });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      clientServiceId: 'service-1',
      reconciliationRequestId: 'request-1',
      writeMode: 'OBSERVE',
    }));

    expect(mocks.logger.info).toHaveBeenCalledTimes(1);
    const event = mocks.logger.info.mock.calls[0]?.[1] as Record<string, unknown>;
    expectCompleteReconciliationEvent(event);
    expect(event).toMatchObject({
      tenantId: 'tenant-1',
      requestId: 'request-1',
      correlationId: 'corr-1',
      attempt: 1,
      writeMode: 'OBSERVE',
    });
    expect(event.warnings).toEqual([{ code: 'MISSING_RULE_INPUT', permanent: true }]);
    expect(event.metrics).toEqual({
      billing: { created: 0, recalculated: 0, cancelled: 0, preserved: 0 },
      coverage: { opened: 0, resolved: 0 },
      servicesMissingDisposition: 0,
      invalidScheduleCount: 0,
      occurrenceGaps: 0,
    });
    expect(JSON.stringify(event)).not.toContain('customer free text must never be emitted');

    const finalUpdate = mocks.prisma.serviceScheduleReconciliationRequest.updateMany.mock.calls.at(-1)?.[0] as {
      where?: Record<string, unknown>;
      data?: Record<string, unknown>;
    };
    expect(finalUpdate).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        id: 'request-1',
        tenantId: 'tenant-1',
        status: 'PROCESSING',
        leaseOwner: expect.any(String),
      }),
      data: expect.objectContaining({
        status: 'COMPLETED',
        completedAt: expect.any(Date),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: 'MISSING_RULE_INPUT',
        lastErrorMessage: 'Reconciliation request completed with a permanent configuration error',
        nextAttemptAt: expect.any(Date),
        summary: { warnings: [{ code: 'MISSING_RULE_INPUT', permanent: true }], permanent: true },
      }),
    }));
    expect(JSON.stringify(finalUpdate.data)).not.toContain('customer free text must never be emitted');
  });

  it('backs off transient failures using the bounded retry schedule', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ ...request, attemptCount: 1 }]);
    mocks.reconcile.mockRejectedValueOnce(new Error('temporary dependency failure'));

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1, leaseLost: 0 });
    expect(mocks.prisma.serviceScheduleReconciliationRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', nextAttemptAt: new Date('2026-08-18T00:05:00.000Z') }),
    }));
  });

  it('retries when coverage fails after billing in the shared transaction', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ ...request, attemptCount: 1 }]);
    mocks.coverageReconcile.mockRejectedValueOnce(new Error('coverage dependency failure'));

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1, leaseLost: 0 });
    expect(mocks.billingReconcile).toHaveBeenCalledTimes(1);
    expect(mocks.coverageReconcile).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.serviceScheduleReconciliationRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', nextAttemptAt: new Date('2026-08-18T00:05:00.000Z') }),
    }));
  });

  it('does not let a throwing logger turn a completed request into a failed execution', async () => {
    mocks.logger.info.mockImplementation(() => {
      throw new Error('log sink unavailable');
    });

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0, leaseLost: 0 });
  });

  it('emits one bounded allowlisted metrics object with billing and coverage counts', async () => {
    mocks.billingReconcile.mockResolvedValueOnce({
      clientServiceId: 'service-1',
      created: 2,
      recalculated: 3,
      cancelled: 4,
      preserved: 5,
      preservedByReason: {
        MANUAL_TRIGGER: 0,
        HISTORICAL: 0,
        BILLED: 0,
        WAIVED: 0,
        CANCELLED: 0,
        OVERRIDDEN: 0,
      },
      warnings: [],
    });
    mocks.coverageReconcile.mockResolvedValueOnce({
      clientServiceId: 'service-1',
      opened: 6,
      refreshed: 0,
      resolved: 7,
      openIssues: [
        { issueKey: 'missing-disposition', type: 'MISSING_DISPOSITION', severity: 'ERROR', feeLineId: null, message: 'private note' },
        { issueKey: 'invalid-custom', type: 'INVALID_CUSTOM_SCHEDULE', severity: 'ERROR', feeLineId: 'fee-1', message: 'uploaded document' },
        { issueKey: 'missing-parameter', type: 'MISSING_SCHEDULE_PARAMETER', severity: 'ERROR', feeLineId: 'fee-2', message: 'customer content' },
        { issueKey: 'gap', type: 'OCCURRENCE_GAP', severity: 'ERROR', feeLineId: 'fee-3', message: 'secret reference' },
      ],
    });

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0, leaseLost: 0 });
    expect(mocks.logger.info).toHaveBeenCalledTimes(1);
    const event = mocks.logger.info.mock.calls[0]?.[1] as Record<string, unknown>;
    expectCompleteReconciliationEvent(event);
    const metrics = event.metrics as Record<string, unknown>;
    expect(Object.keys(metrics).sort()).toEqual([
      'billing',
      'coverage',
      'invalidScheduleCount',
      'occurrenceGaps',
      'servicesMissingDisposition',
    ]);
    expect(metrics).toEqual({
      billing: { created: 2, recalculated: 3, cancelled: 4, preserved: 5 },
      coverage: { opened: 6, resolved: 7 },
      servicesMissingDisposition: 1,
      invalidScheduleCount: 2,
      occurrenceGaps: 1,
    });
    expect(event).toMatchObject({ tenantId: 'tenant-1', requestId: 'request-1', correlationId: 'corr-1', attempt: 1, writeMode: 'OBSERVE' });
    expect(JSON.stringify(event)).not.toContain('private note');
    expect(JSON.stringify(event)).not.toContain('uploaded document');
    expect(JSON.stringify(event)).not.toContain('customer content');
    expect(JSON.stringify(event)).not.toContain('secret reference');
  });

  it('emits exactly one redacted event when a request retries after a failure', async () => {
    mocks.reconcile.mockRejectedValueOnce(new Error('retry note must not be logged'));

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1, leaseLost: 0 });
    expect(mocks.logger.info).toHaveBeenCalledTimes(1);
    const event = mocks.logger.info.mock.calls[0]?.[1] as Record<string, unknown>;
    expectCompleteReconciliationEvent(event);
    expect(event).toMatchObject({ tenantId: 'tenant-1', requestId: 'request-1', correlationId: 'corr-1', attempt: 1, writeMode: 'OBSERVE' });
    expect(JSON.stringify(event)).not.toContain('retry note must not be logged');
    expect(event.metrics).toEqual({
      billing: { created: 0, recalculated: 0, cancelled: 0, preserved: 0 },
      coverage: { opened: 0, resolved: 0 },
      servicesMissingDisposition: 0,
      invalidScheduleCount: 0,
      occurrenceGaps: 0,
    });
  });

  it('bounds every variable event field while retaining the fixed schema', () => {
    const oversized = 'customer-free-text-'.repeat(100);
    const event = buildReconciliationLogEvent({
      tenantId: oversized,
      requestId: oversized,
      correlationId: oversized,
      durationMs: Number.POSITIVE_INFINITY,
      counts: {
        created: Number.MAX_SAFE_INTEGER,
        recalculated: Number.MAX_SAFE_INTEGER,
        cancelled: Number.MAX_SAFE_INTEGER,
        preserved: Number.MAX_SAFE_INTEGER,
        noChange: Number.MAX_SAFE_INTEGER,
      },
      preservedByReason: {
        MANUAL_TRIGGER: Number.MAX_SAFE_INTEGER,
        HISTORICAL: Number.MAX_SAFE_INTEGER,
        COMPLETED: Number.MAX_SAFE_INTEGER,
        WAIVED: Number.MAX_SAFE_INTEGER,
        CANCELLED: Number.MAX_SAFE_INTEGER,
        OVERRIDDEN: Number.MAX_SAFE_INTEGER,
      },
      warnings: Array.from({ length: 100 }, () => ({
        code: 'MISSING_INPUT',
        message: oversized,
        ruleId: oversized,
        ruleVersionId: oversized,
        missingFields: Array.from({ length: 100 }, () => oversized),
        feeLineId: oversized,
        permanent: true,
      })),
      billing: { created: Number.MAX_SAFE_INTEGER, recalculated: Number.MAX_SAFE_INTEGER, cancelled: Number.MAX_SAFE_INTEGER, preserved: Number.MAX_SAFE_INTEGER },
      billingPreservedByReason: {
        MANUAL_TRIGGER: Number.MAX_SAFE_INTEGER,
        HISTORICAL: Number.MAX_SAFE_INTEGER,
        BILLED: Number.MAX_SAFE_INTEGER,
        WAIVED: Number.MAX_SAFE_INTEGER,
        CANCELLED: Number.MAX_SAFE_INTEGER,
        OVERRIDDEN: Number.MAX_SAFE_INTEGER,
      },
      coverage: { opened: Number.MAX_SAFE_INTEGER, refreshed: Number.MAX_SAFE_INTEGER, resolved: Number.MAX_SAFE_INTEGER, openIssueCount: Number.MAX_SAFE_INTEGER },
      metrics: {
        billing: { created: Number.MAX_SAFE_INTEGER, recalculated: Number.MAX_SAFE_INTEGER, cancelled: Number.MAX_SAFE_INTEGER, preserved: Number.MAX_SAFE_INTEGER },
        coverage: { opened: Number.MAX_SAFE_INTEGER, resolved: Number.MAX_SAFE_INTEGER },
        servicesMissingDisposition: Number.MAX_SAFE_INTEGER,
        invalidScheduleCount: Number.MAX_SAFE_INTEGER,
        occurrenceGaps: Number.MAX_SAFE_INTEGER,
      },
      attempt: Number.MAX_SAFE_INTEGER,
      writeMode: 'APPLY',
    });

    expect(Object.keys(event).sort()).toEqual([
      'attempt',
      'billing',
      'billingPreservedByReason',
      'correlationId',
      'counts',
      'coverage',
      'durationMs',
      'event',
      'metrics',
      'preservedByReason',
      'requestId',
      'tenantId',
      'warnings',
      'writeMode',
    ]);
    expect(event.tenantId).toHaveLength(200);
    expect(event.durationMs).toBe(86_400_000);
    expect(event.attempt).toBe(1_000_000);
    expect((event.counts as Record<string, number>).created).toBe(1_000_000);
    expect((event.billing as Record<string, number>).created).toBe(1_000_000);
    expect((event.coverage as Record<string, number>).openIssueCount).toBe(1_000_000);
    expect((event.warnings as Array<Record<string, unknown>>)).toHaveLength(50);
    expect((event.warnings as Array<Record<string, unknown>>)[0]?.ruleId).toHaveLength(200);
    expect(((event.warnings as Array<Record<string, unknown>>)[0]?.missingFields as string[])).toHaveLength(20);
    expect(((event.warnings as Array<Record<string, unknown>>)[0]?.missingFields as string[])[0]).toHaveLength(200);
    expect(JSON.stringify(event)).not.toContain(oversized);
  });

  it('emits one complete bounded event for an exhausted retry', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ ...request, attemptCount: 5 }]);
    mocks.reconcile.mockRejectedValueOnce(new Error('exhausted customer note'));

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1, leaseLost: 0 });
    expect(mocks.logger.info).toHaveBeenCalledTimes(1);
    const event = mocks.logger.info.mock.calls[0]?.[1] as Record<string, unknown>;
    expectCompleteReconciliationEvent(event);
    expect(event).toMatchObject({ event: 'reconciliation_request', attempt: 6, writeMode: 'OBSERVE' });
    expect(event.metrics).toBeDefined();
    expect(JSON.stringify(event)).not.toContain('exhausted customer note');
  });

  it('does not let a throwing logger replace a retryable failure outcome', async () => {
    mocks.reconcile.mockRejectedValueOnce(new Error('transient dependency failure: secret-note'));
    mocks.logger.info.mockImplementation(() => {
      throw new Error('log sink unavailable');
    });

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1, leaseLost: 0 });
  });

  it('does not let a throwing logger replace a lease-loss outcome', async () => {
    let renewals = 0;
    mocks.prisma.serviceScheduleReconciliationRequest.updateMany.mockImplementation(async (args?: unknown) => {
      const value = args as { where?: { leaseOwner?: string } } | undefined;
      if (value?.where?.leaseOwner !== undefined) {
        renewals += 1;
        return { count: renewals === 1 ? 1 : 0 };
      }
      return { count: 1 };
    });
    mocks.logger.info.mockImplementation(() => {
      throw new Error('log sink unavailable');
    });

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 0, leaseLost: 1 });
  });

  it('retains counts and warnings from committed services when a later service fails', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{
      ...request,
      scopeType: 'TENANT',
      scopeId: 'tenant-1',
    }]);
    mocks.prisma.clientService.findMany.mockResolvedValue([{ id: 'service-1' }, { id: 'service-2' }]);
    mocks.reconcile
      .mockResolvedValueOnce({
        tenantId: 'tenant-1', clientServiceId: 'service-1', reconciliationRequestId: 'request-1',
        writeMode: 'OBSERVE',
        counts: { created: 2, recalculated: 1, cancelled: 0, preserved: 3, noChange: 4 },
        preservedByReason: { MANUAL_TRIGGER: 1, HISTORICAL: 0, COMPLETED: 0, WAIVED: 0, CANCELLED: 0, OVERRIDDEN: 0 },
        warnings: [{ code: 'MISSING_INPUT', message: 'secret rule wording', missingFields: ['fye'] }],
      })
      .mockRejectedValueOnce(new Error('later service failed: private-note'));

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });
    const event = mocks.logger.info.mock.calls.at(-1)?.[1] as Record<string, unknown>;

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1, leaseLost: 0 });
    expect(event).toMatchObject({
      counts: { created: 2, recalculated: 1, cancelled: 0, preserved: 3, noChange: 4 },
      preservedByReason: { MANUAL_TRIGGER: 1 },
    });
    expect(event.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_INPUT' }),
      expect.objectContaining({ code: 'RECONCILIATION_FAILED' }),
    ]));
    expect(JSON.stringify(event)).not.toContain('secret rule wording');
    expect(JSON.stringify(event)).not.toContain('private-note');
  });

  it('retains counts and warnings from committed services when a later lease check fails', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{
      ...request,
      scopeType: 'TENANT',
      scopeId: 'tenant-1',
    }]);
    mocks.prisma.clientService.findMany.mockResolvedValue([{ id: 'service-1' }, { id: 'service-2' }]);
    mocks.reconcile.mockResolvedValueOnce({
      tenantId: 'tenant-1', clientServiceId: 'service-1', reconciliationRequestId: 'request-1',
      writeMode: 'OBSERVE',
      counts: { created: 1, recalculated: 0, cancelled: 1, preserved: 0, noChange: 0 },
      preservedByReason: { MANUAL_TRIGGER: 0, HISTORICAL: 1, COMPLETED: 0, WAIVED: 0, CANCELLED: 0, OVERRIDDEN: 0 },
      warnings: [{ code: 'RULE_WARNING', message: 'secret document content' }],
    });
    let renewals = 0;
    mocks.prisma.serviceScheduleReconciliationRequest.updateMany.mockImplementation(async (args?: unknown) => {
      const value = args as { where?: { leaseOwner?: string } } | undefined;
      if (value?.where?.leaseOwner !== undefined) {
        renewals += 1;
        return { count: renewals <= 2 ? 1 : 0 };
      }
      return { count: 1 };
    });

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });
    const event = mocks.logger.info.mock.calls.at(-1)?.[1] as Record<string, unknown>;

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 0, leaseLost: 1 });
    expect(event).toMatchObject({
      counts: { created: 1, recalculated: 0, cancelled: 1, preserved: 0, noChange: 0 },
      preservedByReason: { HISTORICAL: 1 },
    });
    expect(event.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RULE_WARNING' }),
      expect.objectContaining({ code: 'LEASE_LOST' }),
    ]));
    expect(JSON.stringify(event)).not.toContain('secret document content');
  });

  it('persists a stable safe error instead of arbitrary dependency text', async () => {
    mocks.reconcile.mockRejectedValueOnce(new Error('secret document note: do-not-store-this'));

    await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    const update = mocks.prisma.serviceScheduleReconciliationRequest.updateMany.mock.calls
      .map(([args]) => args as { data?: { lastErrorCode?: string; lastErrorMessage?: string; summary?: { warnings?: Array<{ message?: string }> } } })
      .filter((args) => args.data?.lastErrorCode !== undefined)
      .at(-1) as {
      data?: { lastErrorMessage?: string; summary?: { warnings?: Array<{ message?: string }> } };
    };
    expect(update.data?.lastErrorMessage).toBe('Reconciliation failed and will retry');
    expect(update.data?.lastErrorMessage).not.toContain('do-not-store-this');
    expect(update.data?.summary?.warnings?.[0]?.message).toBeUndefined();
  });

  it('does not count a permanent completion when the lease was handed off', async () => {
    const error = new Error('required evaluator input is missing');
    (error as { code?: string }).code = 'MISSING_RULE_INPUT';
    mocks.reconcile.mockRejectedValueOnce(error);
    mocks.prisma.serviceScheduleReconciliationRequest.updateMany.mockImplementation(async (args?: unknown) => {
      const status = (args as { data?: { status?: string }} | undefined)?.data?.status;
      return { count: status === 'COMPLETED' ? 0 : 1 };
    });

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 0, leaseLost: 1 });
  });

  it('does not count a transient failure when the lease was handed off', async () => {
    mocks.reconcile.mockRejectedValueOnce(new Error('temporary dependency failure'));
    mocks.prisma.serviceScheduleReconciliationRequest.updateMany.mockImplementation(async (args?: unknown) => {
      const status = (args as { data?: { status?: string }} | undefined)?.data?.status;
      return { count: status === 'PENDING' || status === 'FAILED' ? 0 : 1 };
    });

    const result = await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 0, leaseLost: 1 });
  });

  it('enqueues one tenant rolling-horizon request per active workspace', async () => {
    vi.setSystemTime(new Date('2026-08-18T16:00:00.000Z'));
    const result = await enqueueDailyRollingHorizonRequests();

    expect(result).toBe(1);
    expect(mocks.enqueue).toHaveBeenCalledWith(mocks.prisma, expect.objectContaining({
      tenantId: 'tenant-1', scopeType: 'TENANT', scopeId: 'tenant-1', triggerType: 'ROLLING_HORIZON',
    }));
  });

  it('carries RULE_ARCHIVED operation and rule identity into reconciliation', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{
      ...request,
      scopeType: 'RULE',
      scopeId: 'rule-1',
      triggerType: 'RULE_ARCHIVED',
    }]);
    mocks.prisma.clientService.findMany.mockResolvedValue([{ id: 'service-1' }]);

    await processScheduleReconciliationBatch({ limit: 1, concurrency: 1 });

    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      ruleId: 'rule-1',
      operation: 'ARCHIVE',
    }), expect.anything());
  });
});
