import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@/lib/errors';

const prismaMock = vi.hoisted(() => ({
  deadlineRule: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  deadlineRuleVersion: {
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  clientServiceDeadlineRule: {
    findMany: vi.fn(),
  },
  serviceCycle: {
    findMany: vi.fn(),
  },
  deadlineOccurrence: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  serviceScheduleReconciliationRequest: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const evaluatorMock = vi.hoisted(() => ({
  evaluateDeadlineRule: vi.fn(),
}));

const auditMock = vi.hoisted(() => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/services/service-schedule/evaluator', () => evaluatorMock);
vi.mock('@/lib/audit', () => auditMock);

import {
  archiveDeadlineRule,
  previewDeadlineRuleImpact,
  publishDeadlineRule,
} from '@/services/deadline-rule';
import { enqueueScheduleReconciliation } from '@/services/schedule-reconciliation';

const actor = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
};

const ruleId = '33333333-3333-4333-8333-333333333333';
const currentVersionId = '44444444-4444-4444-8444-444444444444';
const draftId = '55555555-5555-4555-8555-555555555555';
const clientServiceId = '66666666-6666-4666-8666-666666666666';
const cycleId = '77777777-7777-4777-8777-777777777777';

const publishIdentity = {
  operation: 'PUBLISH' as const,
  expectedCurrentVersion: 2,
  expectedDraftRevision: 4,
  draftConfigHash: 'b'.repeat(64),
};

const archiveIdentity = {
  operation: 'ARCHIVE' as const,
  expectedCurrentVersion: 2,
  expectedDraftRevision: 4,
  draftConfigHash: 'b'.repeat(64),
};

const currentVersion = {
  id: currentVersionId,
  ruleId,
  version: 2,
  state: 'PUBLISHED' as const,
  schemaVersion: 1,
  recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
  applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
  configHash: 'a'.repeat(64),
  draftRevision: 1,
  parameterDefinitions: [],
  milestoneTemplates: [],
};

const draftVersion = {
  id: draftId,
  ruleId,
  version: 0,
  state: 'DRAFT' as const,
  schemaVersion: 1,
  recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
  applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
  configHash: 'b'.repeat(64),
  draftRevision: 4,
  parameterDefinitions: [],
  milestoneTemplates: [],
};

const rule = {
  id: ruleId,
  tenantId: actor.tenantId,
  code: 'SG_TEST',
  name: 'Test rule',
  description: null,
  isActive: true,
  archivedAt: null,
  archivedById: null,
  archiveReason: null,
  currentVersionId,
  currentVersion,
  draft: draftVersion as typeof draftVersion | null,
  versions: [draftVersion, currentVersion],
};

const cycle = {
  id: cycleId,
  tenantId: actor.tenantId,
  clientServiceId,
  ruleId,
  ruleVersionId: currentVersionId,
  companyId: '88888888-8888-4888-8888-888888888888',
  periodKey: '2026',
  periodStart: new Date('2026-01-01T00:00:00.000Z'),
  periodEnd: new Date('2026-12-31T00:00:00.000Z'),
  origin: 'RULE' as const,
  businessCalendarId: '99999999-9999-4999-8999-999999999999',
  businessCalendarRevision: 1,
};

const context = {
  tenantId: actor.tenantId,
  clientServiceId,
  ruleId,
  enabled: true,
  parameterValues: {},
  scheduleEntries: [],
  clientService: {
    tenantId: actor.tenantId,
    companyId: cycle.companyId,
    deletedAt: null,
    company: {},
  },
};

function occurrence(
  id: string,
  milestoneKey: string,
  dueDate: string,
  options: Record<string, unknown> = {},
) {
  return {
    id,
    tenantId: actor.tenantId,
    companyId: cycle.companyId,
    clientServiceId,
    cycleId,
    ruleVersionId: currentVersionId,
    milestoneKey,
    scheduleEntryKey: '',
    calculatedDueDate: new Date(`${dueDate}T00:00:00.000Z`),
    operativeDueDate: new Date(`${dueDate}T00:00:00.000Z`),
    dateOverridden: false,
    status: 'OPEN',
    origin: 'RULE',
    cycle,
    ...options,
  };
}

function arrangeImpactFixture() {
  prismaMock.deadlineRule.findFirst.mockResolvedValue(rule);
  prismaMock.clientServiceDeadlineRule.findMany.mockResolvedValue([context]);
  prismaMock.serviceCycle.findMany.mockResolvedValue([cycle]);
  prismaMock.deadlineOccurrence.findMany.mockResolvedValue([
    occurrence('occ-recalculate', 'recalculate', '2026-12-10'),
    occurrence('occ-preserve-date', 'preserve-date', '2026-12-11'),
    occurrence('occ-preserve-status', 'preserve-status', '2026-12-12', { status: 'COMPLETED' }),
    occurrence('occ-preserve-override', 'preserve-override', '2026-12-13', { dateOverridden: true }),
  ]);
  evaluatorMock.evaluateDeadlineRule.mockReturnValue({
    applicability: { state: 'APPLICABLE', reason: null },
    occurrences: [
      { milestoneKey: 'recalculate', scheduleEntryKey: '', type: 'CLIENT', calculatedDueDate: '2026-12-15', explanation: [] },
      { milestoneKey: 'preserve-date', scheduleEntryKey: '', type: 'CLIENT', calculatedDueDate: '2026-12-11', explanation: [] },
      { milestoneKey: 'created-one', scheduleEntryKey: '', type: 'CLIENT', calculatedDueDate: '2026-12-16', explanation: [] },
      { milestoneKey: 'created-two', scheduleEntryKey: '', type: 'CLIENT', calculatedDueDate: '2026-12-17', explanation: [] },
    ],
    byKey: {
      'recalculate:': { milestoneKey: 'recalculate', scheduleEntryKey: '', type: 'CLIENT', calculatedDueDate: '2026-12-15', explanation: [] },
      'preserve-date:': { milestoneKey: 'preserve-date', scheduleEntryKey: '', type: 'CLIENT', calculatedDueDate: '2026-12-11', explanation: [] },
      'created-one:': { milestoneKey: 'created-one', scheduleEntryKey: '', type: 'CLIENT', calculatedDueDate: '2026-12-16', explanation: [] },
      'created-two:': { milestoneKey: 'created-two', scheduleEntryKey: '', type: 'CLIENT', calculatedDueDate: '2026-12-17', explanation: [] },
    },
    sourceSnapshot: { source: 'fixture' },
    evaluationHash: 'c'.repeat(64),
  });
}

describe('deadline rule impact and publication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.deadlineRule.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.deadlineRuleVersion.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.serviceScheduleReconciliationRequest.findUnique.mockResolvedValue(null);
    prismaMock.serviceScheduleReconciliationRequest.upsert.mockResolvedValue({
      id: 'reconciliation-1',
      dedupeKey: 'dedupe-1',
    });
  });

  it('groups complete impact without writing occurrences', async () => {
    arrangeImpactFixture();

    const result = await previewDeadlineRuleImpact(ruleId, publishIdentity, actor);

    expect(result.counts).toEqual(expect.objectContaining({ recalculated: 1, preserved: 3 }));
    expect(result.counts.created).toBeGreaterThanOrEqual(2);
    expect(prismaMock.deadlineOccurrence.findMany).toHaveBeenCalled();
    expect(prismaMock.deadlineOccurrence.update).not.toHaveBeenCalled();
    expect(prismaMock.serviceScheduleReconciliationRequest.upsert).not.toHaveBeenCalled();
  });

  it('previews rolling-horizon CREATE identities for enabled services without cycles', async () => {
    arrangeImpactFixture();
    prismaMock.serviceCycle.findMany.mockResolvedValue([]);
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([]);

    const result = await previewDeadlineRuleImpact(ruleId, publishIdentity, actor);

    expect(result.counts.created).toBeGreaterThan(0);
    expect(result.samples).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'CREATE', clientServiceId }),
    ]));
    expect(evaluatorMock.evaluateDeadlineRule).toHaveBeenCalled();
  });

  it('uses the shared stored-FYE source for no-cycle preview decisions', async () => {
    arrangeImpactFixture();
    Object.assign(context.clientService, {
      company: { financialYearEndDay: 31, financialYearEndMonth: 12 },
    });
    prismaMock.serviceCycle.findMany.mockResolvedValue([]);
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([]);

    await previewDeadlineRuleImpact(ruleId, publishIdentity, actor, { now: () => '2026-08-18' });

    expect(evaluatorMock.evaluateDeadlineRule.mock.calls[0]?.[0].company)
      .toEqual(expect.objectContaining({ financialYearEnd: '2026-12-31' }));
  });

  it('hashes the full impact identity state even when samples are truncated', async () => {
    arrangeImpactFixture();
    const allOccurrences = Array.from({ length: 105 }, (_, index) => occurrence(
      `occ-${String(index).padStart(3, '0')}`,
      `milestone-${String(index).padStart(3, '0')}`,
      '2026-12-10',
    ));
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue(allOccurrences);
    evaluatorMock.evaluateDeadlineRule.mockReturnValue({
      applicability: { state: 'APPLICABLE', reason: null },
      occurrences: [],
      byKey: {},
      sourceSnapshot: {},
      evaluationHash: 'c'.repeat(64),
    });

    const first = await previewDeadlineRuleImpact(ruleId, publishIdentity, actor);
    allOccurrences[104] = occurrence('occ-104', 'milestone-104', '2026-12-11');
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue(allOccurrences);
    const second = await previewDeadlineRuleImpact(ruleId, publishIdentity, actor);

    expect(first.samples).toHaveLength(100);
    expect(second.samples).toHaveLength(100);
    expect(second.previewFingerprint).not.toBe(first.previewFingerprint);
  });

  it('rejects publish when the preview fingerprint changed and leaves the transaction untouched', async () => {
    arrangeImpactFixture();

    await expect(publishDeadlineRule(ruleId, {
      operation: 'PUBLISH',
      expectedCurrentVersion: 2,
      expectedDraftRevision: 4,
      draftConfigHash: 'a'.repeat(64),
      previewFingerprint: 'stale',
    }, actor)).rejects.toMatchObject({
      code: ErrorCodes.IMPACT_CHANGED,
      statusCode: 409,
      details: { impact: expect.any(Object) },
    });

    expect(prismaMock.deadlineRuleVersion.update).not.toHaveBeenCalled();
    expect(prismaMock.deadlineRule.update).not.toHaveBeenCalled();
    expect(prismaMock.serviceScheduleReconciliationRequest.upsert).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('deduplicates requests by tenant scope trigger and not-before minute while retaining the earliest attempt', async () => {
    const firstNotBefore = new Date('2026-08-18T01:02:03.000Z');
    const first = await enqueueScheduleReconciliation(prismaMock as never, {
      tenantId: actor.tenantId,
      scopeType: 'RULE',
      scopeId: ruleId,
      triggerType: 'RULE_PUBLISHED',
      correlationId: 'request-1',
      requestedById: actor.userId,
      notBefore: firstNotBefore,
    });
    prismaMock.serviceScheduleReconciliationRequest.findUnique.mockResolvedValueOnce({
      id: first.id,
      status: 'PENDING',
      nextAttemptAt: firstNotBefore,
    });
    const second = await enqueueScheduleReconciliation(prismaMock as never, {
      tenantId: actor.tenantId,
      scopeType: 'RULE',
      scopeId: ruleId,
      triggerType: 'RULE_PUBLISHED',
      correlationId: 'request-2',
      requestedById: actor.userId,
      notBefore: new Date('2026-08-18T01:02:59.000Z'),
    });

    expect(second.dedupeKey).toBe(first.dedupeKey);
    const create = prismaMock.serviceScheduleReconciliationRequest.upsert.mock.calls[0]?.[0]?.create;
    expect(create).toEqual(expect.objectContaining({ status: 'PENDING', tenantId: actor.tenantId }));
    const update = prismaMock.serviceScheduleReconciliationRequest.upsert.mock.calls[1]?.[0]?.update;
    expect(update).toEqual(expect.objectContaining({ nextAttemptAt: firstNotBefore }));
    expect(prismaMock.serviceScheduleReconciliationRequest.upsert).toHaveBeenCalledTimes(2);

    const third = await enqueueScheduleReconciliation(prismaMock as never, {
      tenantId: actor.tenantId,
      scopeType: 'RULE',
      scopeId: ruleId,
      triggerType: 'RULE_PUBLISHED',
      correlationId: 'request-3',
      requestedById: actor.userId,
      notBefore: new Date('2026-08-18T01:03:00.000Z'),
    });
    expect(third.dedupeKey).not.toBe(first.dedupeKey);
  });

  it('preserves a processing lease and creates durable follow-up work', async () => {
    prismaMock.serviceScheduleReconciliationRequest.findUnique.mockResolvedValue({
      id: 'processing-1',
      status: 'PROCESSING',
      nextAttemptAt: new Date('2026-08-18T01:02:03.000Z'),
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date('2026-08-18T01:07:03.000Z'),
    });
    prismaMock.serviceScheduleReconciliationRequest.upsert.mockResolvedValue({
      id: 'follow-up-1',
      dedupeKey: 'follow-up-key',
    });

    const result = await enqueueScheduleReconciliation(prismaMock as never, {
      tenantId: actor.tenantId,
      scopeType: 'RULE',
      scopeId: ruleId,
      triggerType: 'RULE_PUBLISHED',
      correlationId: 'follow-up-request',
      requestedById: actor.userId,
      notBefore: new Date('2026-08-18T01:02:59.000Z'),
    });

    expect(result.id).toBe('follow-up-1');
    expect(prismaMock.serviceScheduleReconciliationRequest.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'PENDING' }),
    }));
    expect(prismaMock.serviceScheduleReconciliationRequest.upsert.mock.calls.some((call) =>
      call[0]?.update?.leaseOwner === null)).toBe(false);
  });

  it('fails closed when the transactional queue delegate is unavailable', async () => {
    await expect(enqueueScheduleReconciliation({} as never, {
      tenantId: actor.tenantId,
      scopeType: 'RULE',
      scopeId: ruleId,
      triggerType: 'RULE_PUBLISHED',
      correlationId: 'missing-queue',
      requestedById: actor.userId,
    })).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it('archives a rule without deleting immutable versions or occurrences', async () => {
    arrangeImpactFixture();
    const impact = await previewDeadlineRuleImpact(ruleId, archiveIdentity, actor);

    prismaMock.deadlineRule.update.mockResolvedValue({ ...rule, isActive: false, archivedAt: new Date() });
    const result = await archiveDeadlineRule(ruleId, {
      operation: 'ARCHIVE',
      expectedCurrentVersion: 2,
      expectedDraftRevision: 4,
      draftConfigHash: 'b'.repeat(64),
      previewFingerprint: impact.previewFingerprint,
      reason: 'No longer offered',
    }, actor);

    expect(result).toMatchObject({ id: ruleId });
    expect(prismaMock.deadlineRule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: ruleId, tenantId: actor.tenantId }),
      data: expect.objectContaining({ isActive: false, archiveReason: 'No longer offered' }),
    }));
    expect(prismaMock.deadlineRuleVersion.update).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).toHaveBeenCalled();
  });

  it('archives only when the exact previewed draft identity is still mutable', async () => {
    arrangeImpactFixture();
    const impact = await previewDeadlineRuleImpact(ruleId, archiveIdentity, actor);

    await archiveDeadlineRule(ruleId, {
      ...archiveIdentity,
      previewFingerprint: impact.previewFingerprint,
      reason: 'Retired',
    }, actor);

    expect(prismaMock.deadlineRuleVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: draftId,
        tenantId: actor.tenantId,
        ruleId,
        state: 'DRAFT',
        version: 0,
        draftRevision: 4,
        configHash: 'b'.repeat(64),
      }),
    }));
  });

  it('previews archive cancellation for eligible rows and preserves immutable categories', async () => {
    arrangeImpactFixture();
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([
      occurrence('occ-recalculate', 'recalculate', '2026-12-10'),
      occurrence('occ-preserve-date', 'preserve-date', '2026-12-11'),
      occurrence('occ-completed', 'completed', '2026-12-12', { status: 'COMPLETED' }),
      occurrence('occ-cancelled', 'cancelled', '2026-12-13', { status: 'CANCELLED' }),
      occurrence('occ-overridden', 'overridden', '2026-12-14', { dateOverridden: true }),
      occurrence('occ-manual', 'manual', '2026-12-15', { origin: 'MANUAL_TRIGGER' }),
      occurrence('occ-historical', 'historical', '2025-12-15'),
    ]);

    const result = await previewDeadlineRuleImpact(ruleId, archiveIdentity, actor, {
      now: () => '2026-08-18',
    });

    expect(result.operation).toBe('ARCHIVE');
    expect(result.counts.cancelled).toBe(2);
    expect(result.counts.preserved).toBe(5);
    expect(result.samples.filter((sample) => sample.action === 'CANCEL')).toHaveLength(2);
  });

  it('rejects publish after an intervening archive with a fresh impact and no writes', async () => {
    arrangeImpactFixture();
    const preview = await previewDeadlineRuleImpact(ruleId, publishIdentity, actor);
    Object.assign(rule, {
      isActive: false,
      archivedAt: new Date('2026-08-18T02:00:00.000Z'),
      archivedById: actor.userId,
      archiveReason: 'Retired',
    });

    await expect(publishDeadlineRule(ruleId, {
      ...publishIdentity,
      previewFingerprint: preview.previewFingerprint,
    }, actor)).rejects.toMatchObject({
      code: ErrorCodes.IMPACT_CHANGED,
      statusCode: 409,
      details: { impact: expect.any(Object) },
    });
    expect(prismaMock.deadlineRule.update).not.toHaveBeenCalled();
    expect(prismaMock.deadlineRuleVersion.update).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('rejects archive after an intervening publish with a fresh impact and no writes', async () => {
    arrangeImpactFixture();
    const preview = await previewDeadlineRuleImpact(ruleId, archiveIdentity, actor);
    rule.currentVersionId = 'published-version-3';

    await expect(archiveDeadlineRule(ruleId, {
      ...archiveIdentity,
      previewFingerprint: preview.previewFingerprint,
      reason: 'Retired',
    }, actor)).rejects.toMatchObject({
      code: ErrorCodes.IMPACT_CHANGED,
      statusCode: 409,
      details: { impact: expect.any(Object) },
    });
    expect(prismaMock.deadlineRule.update).not.toHaveBeenCalled();
    expect(prismaMock.deadlineRuleVersion.update).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('normalizes a concurrently consumed draft to IMPACT_CHANGED with no writes', async () => {
    arrangeImpactFixture();
    const preview = await previewDeadlineRuleImpact(ruleId, publishIdentity, actor);
    rule.versions = [currentVersion];
    rule.draft = null;

    await expect(publishDeadlineRule(ruleId, {
      ...publishIdentity,
      previewFingerprint: preview.previewFingerprint,
    }, actor)).rejects.toMatchObject({
      code: ErrorCodes.IMPACT_CHANGED,
      statusCode: 409,
      details: { impact: expect.any(Object) },
    });
    expect(prismaMock.deadlineRule.update).not.toHaveBeenCalled();
    expect(prismaMock.deadlineRuleVersion.update).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });
});
