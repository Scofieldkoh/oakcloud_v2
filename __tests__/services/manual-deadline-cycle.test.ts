import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  clientService: { findFirst: vi.fn() },
  businessCalendar: { findFirst: vi.fn() },
  serviceCycle: { create: vi.fn(), findFirst: vi.fn() },
  deadlineOccurrence: { create: vi.fn(), createMany: vi.fn(), findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
  workspace: { findUnique: vi.fn() },
  serviceScheduleReconciliationRequest: { upsert: vi.fn() },
  clientServiceFeeLine: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}));

const evaluatorMock = vi.hoisted(() => ({ evaluateDeadlineRule: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/services/service-schedule/evaluator', async () => {
  const actual = await vi.importActual<typeof import('@/services/service-schedule/evaluator')>('@/services/service-schedule/evaluator');
  return { ...actual, evaluateDeadlineRule: evaluatorMock.evaluateDeadlineRule };
});
vi.mock('@/lib/audit', () => ({ createAuditLog: prismaMock.auditLog.create }));

import {
  createManualDeadlineCycle,
  previewManualDeadlineCycle,
  type ManualDeadlineCycleInput,
} from '@/services/deadline/manual-cycle';

const tenantId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const companyId = '33333333-3333-4333-8333-333333333333';
const ruleId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';
const actor = { tenantId, userId: '66666666-6666-4666-8666-666666666666' };

const version = {
  id: versionId,
  tenantId,
  ruleId,
  version: 3,
  state: 'PUBLISHED',
  configHash: 'a'.repeat(64),
  recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
  applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
  parameterDefinitions: [],
  milestoneTemplates: [
    { tenantId, ruleVersionId: versionId, milestoneKey: 'client-records', name: 'Client records', description: null, type: 'CLIENT', generationMode: 'ONCE_PER_CYCLE', dateExpression: { kind: 'SOURCE', source: { kind: 'CYCLE_START' } }, businessDayAdjustment: 'NONE', displayOrder: 1, isActive: true },
    { tenantId, ruleVersionId: versionId, milestoneKey: 'statutory-filing', name: 'Statutory filing', description: null, type: 'STATUTORY', generationMode: 'ONCE_PER_CYCLE', dateExpression: { kind: 'SOURCE', source: { kind: 'CYCLE_END' } }, businessDayAdjustment: 'NONE', displayOrder: 2, isActive: true },
    { tenantId, ruleVersionId: versionId, milestoneKey: 'internal-review', name: 'Internal review', description: null, type: 'INTERNAL', generationMode: 'ONCE_PER_CYCLE', dateExpression: { kind: 'SOURCE', source: { kind: 'CYCLE_END' } }, businessDayAdjustment: 'NONE', displayOrder: 3, isActive: true },
  ],
};

const rawService = {
  id: serviceId,
  tenantId,
  companyId,
  serviceVariantId: '77777777-7777-4777-8777-777777777777',
  serviceName: 'Annual return',
  deletedAt: null,
  company: { id: companyId, tenantId, deletedAt: null, name: 'Example Pte Ltd', entityType: 'PRIVATE_LIMITED' },
  serviceVariant: { id: '77777777-7777-4777-8777-777777777777', tenantId },
  deadlineRules: [{
    id: '88888888-8888-4888-8888-888888888888',
    tenantId,
    clientServiceId: serviceId,
    ruleId,
    enabled: true,
    parameterValues: {},
    scheduleEntries: [],
    rule: { id: ruleId, tenantId, isActive: true, archivedAt: null, currentVersionId: versionId, versions: [version], currentVersion: version },
  }],
};

const input: ManualDeadlineCycleInput = {
  ruleVersionId: versionId,
  periodKey: '2024',
  periodStart: '2024-01-01',
  periodEnd: '2024-12-31',
  parameterOverrides: {},
  scheduleEntries: [],
  sourceValues: { financialYearEnd: '2024-12-31' },
};

describe('manual historical deadline cycles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.clientService.findFirst.mockResolvedValue(rawService);
    prismaMock.businessCalendar.findFirst.mockResolvedValue({ id: '99999999-9999-4999-8999-999999999999', tenantId, timeZone: 'Asia/Singapore', revision: 2, weekendDays: [0, 6], holidays: [] });
    prismaMock.workspace.findUnique.mockResolvedValue({ settings: { servicesWorkspace: { enabled: true, deadlineWritesEnabled: true } } });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.serviceCycle.findFirst.mockResolvedValue(undefined);
    prismaMock.serviceCycle.create.mockResolvedValue({ id: 'cycle-1' });
    prismaMock.deadlineOccurrence.create.mockResolvedValue({ id: 'occurrence-1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    evaluatorMock.evaluateDeadlineRule.mockReturnValue({
      applicability: { state: 'APPLICABLE', reason: null },
      occurrences: [
        { milestoneKey: 'client-records', scheduleEntryKey: '', type: 'CLIENT', calculatedDueDate: '2024-01-15', explanation: ['Cycle start plus 14 days'] },
        { milestoneKey: 'statutory-filing', scheduleEntryKey: '', type: 'STATUTORY', calculatedDueDate: '2024-02-01', explanation: ['Historical filing anchor'] },
        { milestoneKey: 'internal-review', scheduleEntryKey: '', type: 'INTERNAL', calculatedDueDate: '2024-02-15', explanation: ['Internal review follows filing'] },
      ],
      byKey: {},
      sourceSnapshot: { source: 'fixture' },
      evaluationHash: 'b'.repeat(64),
    });
  });

  it('previews a complete historical cycle without writes', async () => {
    const preview = await previewManualDeadlineCycle(serviceId, input, actor);

    expect(preview.milestones).toHaveLength(3);
    expect(preview.milestones[0]).toEqual(expect.objectContaining({ milestoneKey: 'client-records', explanation: ['Cycle start plus 14 days'] }));
    expect(preview.previewFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(prismaMock.serviceCycle.create).not.toHaveBeenCalled();
    expect(prismaMock.deadlineOccurrence.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('creates only selected manual deadlines and never billing occurrences', async () => {
    const preview = await previewManualDeadlineCycle(serviceId, input, actor);

    await createManualDeadlineCycle(serviceId, {
      ...input,
      previewFingerprint: preview.previewFingerprint,
      notes: 'Inherited 2024 filing work.',
      selections: [
        { milestoneKey: 'client-records', scheduleEntryKey: '', include: true, operativeDueDate: '2024-02-01', status: 'COMPLETED', completionDate: '2024-02-02' },
        { milestoneKey: 'statutory-filing', scheduleEntryKey: '', include: false },
        { milestoneKey: 'internal-review', scheduleEntryKey: '', include: false },
      ],
    }, actor);

    expect(prismaMock.serviceCycle.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ origin: 'MANUAL_TRIGGER', generationKey: expect.stringContaining('MANUAL_TRIGGER') }) }));
    expect(prismaMock.deadlineOccurrence.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ origin: 'MANUAL_TRIGGER', dateOverridden: true, status: 'COMPLETED', completedAt: expect.any(Date) }) }));
    expect(prismaMock.serviceScheduleReconciliationRequest.upsert).not.toHaveBeenCalled();
    expect(prismaMock.clientServiceFeeLine.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale fingerprint before any cycle, occurrence, or audit write', async () => {
    const preview = await previewManualDeadlineCycle(serviceId, input, actor);
    evaluatorMock.evaluateDeadlineRule.mockReturnValueOnce({
      applicability: { state: 'APPLICABLE', reason: null },
      occurrences: [{ milestoneKey: 'client-records', scheduleEntryKey: '', type: 'CLIENT', calculatedDueDate: '2024-01-15', explanation: ['Changed source'] }],
      byKey: {},
      sourceSnapshot: { source: 'changed' },
      evaluationHash: 'c'.repeat(64),
    });

    await expect(createManualDeadlineCycle(serviceId, {
      ...input,
      previewFingerprint: preview.previewFingerprint,
      notes: null,
      selections: [
        { milestoneKey: 'client-records', scheduleEntryKey: '', include: true, operativeDueDate: '2024-01-15', status: 'OPEN' },
        { milestoneKey: 'statutory-filing', scheduleEntryKey: '', include: false },
        { milestoneKey: 'internal-review', scheduleEntryKey: '', include: false },
      ],
    }, actor)).rejects.toMatchObject({ code: 'IMPACT_CHANGED', statusCode: 409 });
    expect(prismaMock.serviceCycle.create).not.toHaveBeenCalled();
    expect(prismaMock.deadlineOccurrence.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns the existing generation for an idempotent repeat without creating rows', async () => {
    const preview = await previewManualDeadlineCycle(serviceId, input, actor);
    prismaMock.serviceCycle.findFirst.mockResolvedValue({ id: 'cycle-existing', occurrences: [{ id: 'occ-existing', status: 'COMPLETED' }] });
    const result = await createManualDeadlineCycle(serviceId, {
      ...input,
      previewFingerprint: preview.previewFingerprint,
      notes: null,
      selections: [
        { milestoneKey: 'client-records', scheduleEntryKey: '', include: true, operativeDueDate: '2024-01-15', status: 'COMPLETED' },
        { milestoneKey: 'statutory-filing', scheduleEntryKey: '', include: false },
        { milestoneKey: 'internal-review', scheduleEntryKey: '', include: false },
      ],
    }, actor);

    expect(result).toEqual(expect.objectContaining({ cycleId: 'cycle-existing', includedCount: 1, excludedCount: 2, completedCount: 1 }));
    expect(prismaMock.serviceCycle.create).not.toHaveBeenCalled();
    expect(prismaMock.deadlineOccurrence.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses apply when the tenant deadline-write rollout gate is disabled', async () => {
    const preview = await previewManualDeadlineCycle(serviceId, input, actor);
    prismaMock.workspace.findUnique.mockResolvedValue({ settings: { servicesWorkspace: { enabled: true, deadlineWritesEnabled: false } } });

    await expect(createManualDeadlineCycle(serviceId, {
      ...input,
      previewFingerprint: preview.previewFingerprint,
      notes: null,
      selections: [
        { milestoneKey: 'client-records', scheduleEntryKey: '', include: true, operativeDueDate: '2024-01-15', status: 'OPEN' },
        { milestoneKey: 'statutory-filing', scheduleEntryKey: '', include: false },
        { milestoneKey: 'internal-review', scheduleEntryKey: '', include: false },
      ],
    }, actor)).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(prismaMock.serviceCycle.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('canonicalizes reordered selections with multiple schedule-entry identities', async () => {
    evaluatorMock.evaluateDeadlineRule.mockReturnValue({
      applicability: { state: 'APPLICABLE', reason: null },
      occurrences: [
        { milestoneKey: 'client-records', scheduleEntryKey: 'first-entry', type: 'CLIENT', calculatedDueDate: '2024-01-15', explanation: ['First'] },
        { milestoneKey: 'client-records', scheduleEntryKey: 'second-entry', type: 'CLIENT', calculatedDueDate: '2024-01-16', explanation: ['Second'] },
      ],
      byKey: {},
      sourceSnapshot: { source: 'fixture' },
      evaluationHash: 'd'.repeat(64),
    });
    const preview = await previewManualDeadlineCycle(serviceId, input, actor);
    prismaMock.serviceCycle.findFirst.mockResolvedValue(null);
    const selections = [
      { milestoneKey: 'client-records', scheduleEntryKey: 'first-entry', include: true, operativeDueDate: '2024-01-15', status: 'OPEN' as const },
      { milestoneKey: 'client-records', scheduleEntryKey: 'second-entry', include: true, operativeDueDate: '2024-01-16', status: 'COMPLETED' as const },
    ];
    await createManualDeadlineCycle(serviceId, { ...input, previewFingerprint: preview.previewFingerprint, notes: null, selections }, actor);
    const firstLookup = prismaMock.serviceCycle.findFirst.mock.calls[0]?.[0] as { where: { tenantId_clientServiceId_ruleId_periodKey_generationKey_origin: { generationKey: string } } };
    const firstGeneration = firstLookup.where.tenantId_clientServiceId_ruleId_periodKey_generationKey_origin.generationKey;
    prismaMock.serviceCycle.findFirst.mockImplementation(async (args: unknown) => {
      const lookup = args as { where: { tenantId_clientServiceId_ruleId_periodKey_generationKey_origin: { generationKey: string } } };
      return lookup.where.tenantId_clientServiceId_ruleId_periodKey_generationKey_origin.generationKey === firstGeneration
        ? { id: 'cycle-1', occurrences: [{ id: 'occurrence-1' }] }
        : null;
    });
    await createManualDeadlineCycle(serviceId, { ...input, previewFingerprint: preview.previewFingerprint, notes: null, selections: [...selections].reverse() }, actor);

    expect(prismaMock.serviceCycle.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a milestone template belongs to another tenant or version', async () => {
    const mismatched = structuredClone(rawService) as typeof rawService;
    const mismatchedRule = mismatched.deadlineRules[0].rule!;
    const mismatchedMilestone = { ...mismatchedRule.versions![0].milestoneTemplates![0], tenantId: '99999999-9999-4999-8999-999999999999', ruleVersionId: '99999999-9999-4999-8999-999999999999' };
    mismatchedRule.versions![0] = { ...mismatchedRule.versions![0], milestoneTemplates: [mismatchedMilestone] };
    mismatchedRule.currentVersion = { ...mismatchedRule.currentVersion!, milestoneTemplates: [mismatchedMilestone] };
    prismaMock.clientService.findFirst.mockResolvedValue(mismatched);

    await expect(previewManualDeadlineCycle(serviceId, input, actor)).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(prismaMock.serviceCycle.create).not.toHaveBeenCalled();
    expect(prismaMock.deadlineOccurrence.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('resolves a unique-key loser in a fresh transaction without querying the failed transaction', async () => {
    const preview = await previewManualDeadlineCycle(serviceId, input, actor);
    const failedFindFirst = vi.fn();
    const failedTx = { ...prismaMock, serviceCycle: { create: prismaMock.serviceCycle.create, findFirst: failedFindFirst } };
    const freshTx = { ...prismaMock, serviceCycle: { create: prismaMock.serviceCycle.create, findFirst: prismaMock.serviceCycle.findFirst } };
    prismaMock.serviceCycle.create.mockRejectedValueOnce({ code: 'P2002' });
    failedFindFirst.mockResolvedValue(null);
    prismaMock.serviceCycle.findFirst.mockResolvedValue({ id: 'race-winner', occurrences: [{ id: 'race-occurrence', status: 'OPEN' }] });
    prismaMock.$transaction.mockImplementationOnce(async (callback: (tx: typeof failedTx) => Promise<unknown>) => callback(failedTx)).mockImplementationOnce(async (callback: (tx: typeof freshTx) => Promise<unknown>) => callback(freshTx));

    const result = await createManualDeadlineCycle(serviceId, {
      ...input,
      previewFingerprint: preview.previewFingerprint,
      notes: null,
      selections: [
        { milestoneKey: 'client-records', scheduleEntryKey: '', include: true, operativeDueDate: '2024-01-15', status: 'OPEN' },
        { milestoneKey: 'statutory-filing', scheduleEntryKey: '', include: false },
        { milestoneKey: 'internal-review', scheduleEntryKey: '', include: false },
      ],
    }, actor);

    expect(result.cycleId).toBe('race-winner');
    expect(failedFindFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.serviceCycle.findFirst).toHaveBeenCalled();
  });
});
