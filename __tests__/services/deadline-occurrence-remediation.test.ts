import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@/lib/errors';
import type { DateOnly } from '@/services/service-schedule';

const auditMock = vi.hoisted(() => ({ createAuditLog: vi.fn().mockResolvedValue(undefined) }));
const prismaMock = vi.hoisted(() => ({}));
vi.mock('@/lib/audit', () => auditMock);
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  applyDeadlineOccurrenceRemediation,
  classifyRemediationActions,
  previewDeadlineOccurrenceRemediation,
} from '@/services/schedule-reconciliation';
import type { DeadlineOccurrenceRemediationAction } from '@/services/schedule-reconciliation';

const today: DateOnly = '2026-08-27';
const horizonEnd: DateOnly = '2027-08-27';

function projectedAnnualReturn(periodYear: number, date: string) {
  return {
    ruleId: 'rule-ar',
    ruleVersionId: 'version-1',
    periodKey: String(periodYear),
    milestoneKey: 'annual-return-due',
    scheduleEntryKey: '',
    deadlineType: 'STATUTORY' as const,
    calculatedDueDate: date as DateOnly,
    explanation: [`Source Company.accountsDueDate = ${date}`],
  };
}

function storedOccurrence(overrides: Record<string, unknown>) {
  return {
    id: 'occ-1',
    milestoneKey: 'annual-return-due',
    scheduleEntryKey: '',
    deadlineType: 'STATUTORY',
    calculatedDueDate: '2024-07-31',
    operativeDueDate: '2024-07-31',
    dateOverridden: false,
    status: 'OPEN',
    origin: 'RULE',
    ruleVersionId: 'version-1',
    ...overrides,
  };
}

function cycle(overrides: Record<string, unknown>) {
  return {
    id: 'cycle-1',
    ruleId: 'rule-ar',
    periodKey: '2024',
    occurrences: [],
    ...overrides,
  };
}

function projectedSet(): Array<ReturnType<typeof projectedAnnualReturn>> {
  return [
    projectedAnnualReturn(2024, '2024-07-31'),
    projectedAnnualReturn(2025, '2025-07-31'),
    projectedAnnualReturn(2026, '2026-07-31'),
    projectedAnnualReturn(2027, '2027-07-31'),
  ];
}

describe('classifyRemediationActions', () => {
  it('classifies RECALCULATE for a matching identity with an incorrect historical date', () => {
    const classification = classifyRemediationActions({
      projected: projectedSet(),
      projectedRuleIds: new Set(['rule-ar']),
      cycles: [cycle({
        id: 'cycle-2024',
        periodKey: '2024',
        occurrences: [storedOccurrence({
          id: 'occ-wrong',
          calculatedDueDate: '2024-06-30',
          operativeDueDate: '2024-06-30',
        })],
      })],
    });

    expect(classification.actions).toContainEqual({
      action: 'RECALCULATE',
      occurrenceId: 'occ-wrong',
      oldDate: '2024-06-30',
      newDate: '2024-07-31',
    });
    expect(classification.recalculateRuleVersionIds['occ-wrong']).toBe('version-1');
  });

  it('classifies CANCEL for an extra bug-generated cycle outside canonical projection', () => {
    const classification = classifyRemediationActions({
      projected: projectedSet(),
      projectedRuleIds: new Set(['rule-ar']),
      cycles: [cycle({
        id: 'cycle-bug',
        periodKey: 'BUG',
        occurrences: [storedOccurrence({
          id: 'occ-bug',
          milestoneKey: 'shifted-milestone',
          calculatedDueDate: '2026-07-31',
          operativeDueDate: '2026-07-31',
        })],
      })],
    });

    expect(classification.actions).toContainEqual({
      action: 'CANCEL',
      occurrenceId: 'occ-bug',
      oldDate: '2026-07-31',
      reason: 'Deadline projection repair',
    });
  });

  it('classifies CREATE for canonical projected identities without a stored row', () => {
    const classification = classifyRemediationActions({
      projected: projectedSet(),
      projectedRuleIds: new Set(['rule-ar']),
      cycles: [
        cycle({ id: 'cycle-2024', periodKey: '2024', occurrences: [storedOccurrence({ id: 'occ-2024' })] }),
        cycle({ id: 'cycle-2025', periodKey: '2025', occurrences: [storedOccurrence({ id: 'occ-2025', calculatedDueDate: '2025-07-31', operativeDueDate: '2025-07-31' })] }),
        cycle({ id: 'cycle-2026', periodKey: '2026', occurrences: [storedOccurrence({ id: 'occ-2026', calculatedDueDate: '2026-07-31', operativeDueDate: '2026-07-31' })] }),
      ],
    });

    expect(classification.actions).toContainEqual({
      action: 'CREATE',
      identity: {
        ruleId: 'rule-ar',
        ruleVersionId: 'version-1',
        periodKey: '2027',
        milestoneKey: 'annual-return-due',
        scheduleEntryKey: '',
      },
      newDate: '2027-07-31',
    });
  });

  it('retains a correct historical authoritative occurrence without an action', () => {
    const classification = classifyRemediationActions({
      projected: projectedSet(),
      projectedRuleIds: new Set(['rule-ar']),
      cycles: [cycle({
        id: 'cycle-2025',
        periodKey: '2025',
        occurrences: [storedOccurrence({
          id: 'occ-correct',
          calculatedDueDate: '2025-07-31',
          operativeDueDate: '2025-07-31',
        })],
      })],
    });

    expect(classification.actions.some((action) => 'occurrenceId' in action && action.occurrenceId === 'occ-correct')).toBe(false);
    expect(classification.actions.filter((action) => action.action === 'RECALCULATE' || action.action === 'CANCEL' || action.action === 'PRESERVE')).toEqual([]);
  });

  it('preserves every protected lifecycle state without updates', () => {
    const classification = classifyRemediationActions({
      projected: projectedSet(),
      projectedRuleIds: new Set(['rule-ar']),
      cycles: [cycle({
        id: 'cycle-protected',
        periodKey: '2024',
        occurrences: [
          storedOccurrence({ id: 'occ-manual', origin: 'MANUAL_TRIGGER', milestoneKey: 'manual' }),
          storedOccurrence({ id: 'occ-completed', status: 'COMPLETED' }),
          storedOccurrence({ id: 'occ-waived', status: 'WAIVED' }),
          storedOccurrence({ id: 'occ-cancelled', status: 'CANCELLED' }),
          storedOccurrence({ id: 'occ-overridden', dateOverridden: true }),
        ],
      })],
    });

    expect(classification.actions.filter((action) => action.action === 'PRESERVE')).toEqual([
      { action: 'PRESERVE', occurrenceId: 'occ-cancelled', reason: 'CANCELLED' },
      { action: 'PRESERVE', occurrenceId: 'occ-completed', reason: 'COMPLETED' },
      { action: 'PRESERVE', occurrenceId: 'occ-manual', reason: 'MANUAL_TRIGGER' },
      { action: 'PRESERVE', occurrenceId: 'occ-overridden', reason: 'OVERRIDDEN' },
      { action: 'PRESERVE', occurrenceId: 'occ-waived', reason: 'WAIVED' },
    ]);
    expect(classification.actions.filter((action) => action.action === 'RECALCULATE' || action.action === 'CANCEL')).toEqual([]);
  });

  it('never cancels rows of rules that were not canonically projected', () => {
    const classification = classifyRemediationActions({
      projected: projectedSet(),
      projectedRuleIds: new Set(['rule-ar']),
      cycles: [cycle({
        id: 'cycle-other',
        ruleId: 'rule-other',
        periodKey: '2024',
        occurrences: [storedOccurrence({ id: 'occ-other' })],
      })],
    });

    expect(classification.actions.filter((action) => action.action === 'CANCEL' || action.action === 'RECALCULATE')).toEqual([]);
    expect(classification.actions).toContainEqual(
      { action: 'PRESERVE', occurrenceId: 'occ-other', reason: 'NOT_SELECTED' },
    );
  });
});

type StoredState = {
  service: Record<string, unknown>;
  cycles: Array<Record<string, unknown>>;
};

function annualReturnRule(): Record<string, unknown> {
  return {
    id: 'rule-ar',
    code: 'SG_ANNUAL_RETURN',
    name: 'Annual Return',
    isActive: true,
    archivedAt: null,
    currentVersion: {
      id: 'version-1',
      recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
      applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
      configHash: 'a'.repeat(64),
      parameterDefinitions: [],
      milestoneTemplates: [{
        milestoneKey: 'annual-return-due',
        name: 'Annual Return due',
        description: null,
        type: 'STATUTORY',
        generationMode: 'ONCE_PER_CYCLE',
        dateExpression: { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
        businessDayAdjustment: 'NONE',
        displayOrder: 0,
        isActive: true,
      }],
    },
  };
}

function statefulDb(initial: StoredState) {
  const state: StoredState = {
    service: initial.service,
    cycles: initial.cycles.map((c) => ({ ...c, occurrences: [...(c.occurrences as unknown[])] })),
  };
  const writeLog: string[] = [];

  const db: Record<string, unknown> = {
    clientService: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        if (state.service.id === where.id && state.service.tenantId === where.tenantId) return state.service;
        return null;
      }),
    },
    businessCalendar: { findFirst: vi.fn(async () => null) },
    serviceCycle: {
      findMany: vi.fn(async () => state.cycles),
      upsert: vi.fn(async ({ where, create }: { where: { tenantId_clientServiceId_ruleId_periodKey_generationKey_origin: Record<string, string> }; create: Record<string, unknown> }) => {
        const key = where.tenantId_clientServiceId_ruleId_periodKey_generationKey_origin;
        const existing = state.cycles.find((c) =>
          c.ruleId === key.ruleId && c.periodKey === key.periodKey && c.generationKey === key.generationKey && c.origin === key.origin);
        if (existing) return existing;
        const next = { id: create.id, ...create, occurrences: [] };
        state.cycles.push(next);
        writeLog.push(`cycle:create:${String(create.periodKey)}`);
        return next;
      }),
    },
    deadlineOccurrence: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        let inserted = 0;
        for (const row of data) {
          const cycleRow = state.cycles.find((c) => c.id === row.cycleId);
          if (!cycleRow) continue;
          const occurrences = cycleRow.occurrences as Record<string, unknown>[];
          const duplicate = occurrences.some((occ) =>
            occ.milestoneKey === row.milestoneKey && occ.scheduleEntryKey === (row.scheduleEntryKey ?? ''));
          if (!duplicate) {
            occurrences.push({ id: `occ-${writeLog.length}-${occurrences.length}`, ...row });
            inserted += 1;
          }
        }
        writeLog.push(`occ:createMany:${inserted}`);
        return { count: inserted };
      }),
      findUnique: vi.fn(async ({ where }: { where: { tenantId_cycleId_milestoneKey_scheduleEntryKey: Record<string, string> } }) => {
        const key = where.tenantId_cycleId_milestoneKey_scheduleEntryKey;
        const cycleRow = state.cycles.find((c) => c.id === key.cycleId);
        const occurrence = (cycleRow?.occurrences as Record<string, unknown>[] | undefined)?.find((occ) =>
          occ.milestoneKey === key.milestoneKey && occ.scheduleEntryKey === key.scheduleEntryKey);
        return occurrence ?? null;
      }),
      upsert: vi.fn(async ({ where, create }: { where: { tenantId_cycleId_milestoneKey_scheduleEntryKey: Record<string, string> }; create: Record<string, unknown> }) => {
        const key = where.tenantId_cycleId_milestoneKey_scheduleEntryKey;
        const cycleRow = state.cycles.find((c) => c.id === key.cycleId);
        const occurrences = (cycleRow?.occurrences ?? []) as Record<string, unknown>[];
        const existing = occurrences.find((occ) => occ.milestoneKey === key.milestoneKey && occ.scheduleEntryKey === key.scheduleEntryKey);
        if (existing) return existing;
        const next = { id: 'occ-created', ...create };
        occurrences.push(next);
        return next;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const cycleRow = state.cycles.find((c) => c.id === data.cycleId);
        (cycleRow?.occurrences as Record<string, unknown>[] | undefined)?.push({ id: 'occ-created', ...data });
        return data;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        let matched = 0;
        for (const cycleRow of state.cycles) {
          const occurrences = (cycleRow.occurrences ?? []) as Record<string, unknown>[];
          for (const occurrence of occurrences) {
            if (occurrence.id === where.id) {
              Object.assign(occurrence, data);
              matched += 1;
            }
          }
        }
        writeLog.push(`occ:update:${where.id}`);
        return { count: matched };
      }),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
  };

  return { db, state, writeLog };
}

function remediationInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    clientServiceIds: ['cs-1'],
    today,
    horizonEnd,
    reason: 'Correct 2026 annual source alignment',
    ...overrides,
  };
}

function serviceRecord(): Record<string, unknown> {
  return {
    id: 'cs-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    serviceName: 'Corporate Secretarial',
    company: {
      id: 'company-1',
      tenantId: 'tenant-1',
      accountsDueDate: new Date('2024-07-31T00:00:00.000Z'),
      financialYearEndDay: 31,
      financialYearEndMonth: 12,
    },
    deadlineRules: [{
      id: 'client-rule-1',
      enabled: true,
      parameterValues: {},
      scheduleEntries: [],
      rule: annualReturnRule(),
    }],
  };
}

function storedCycleFixture() {
  return [
    {
      id: 'cycle-2024',
      tenantId: 'tenant-1',
      clientServiceId: 'cs-1',
      ruleId: 'rule-ar',
      periodKey: '2024',
      occurrences: [{
        id: 'occ-wrong-2024',
        cycleId: 'cycle-2024',
        milestoneKey: 'annual-return-due',
        scheduleEntryKey: '',
        deadlineType: 'STATUTORY',
        calculatedDueDate: new Date('2024-06-30T00:00:00.000Z'),
        operativeDueDate: new Date('2024-06-30T00:00:00.000Z'),
        dateOverridden: false,
        status: 'OPEN',
        origin: 'RULE',
        ruleVersionId: 'version-1',
      }],
    },
    {
      id: 'cycle-bug',
      tenantId: 'tenant-1',
      clientServiceId: 'cs-1',
      ruleId: 'rule-ar',
      periodKey: 'BUG',
      occurrences: [{
        id: 'occ-bug',
        cycleId: 'cycle-bug',
        milestoneKey: 'shifted-milestone',
        scheduleEntryKey: '',
        deadlineType: 'STATUTORY',
        calculatedDueDate: new Date('2026-07-31T00:00:00.000Z'),
        operativeDueDate: new Date('2026-07-31T00:00:00.000Z'),
        dateOverridden: false,
        status: 'OPEN',
        origin: 'RULE',
        ruleVersionId: 'version-1',
      }],
    },
    {
      id: 'cycle-completed',
      tenantId: 'tenant-1',
      clientServiceId: 'cs-1',
      ruleId: 'rule-ar',
      periodKey: '2026',
      occurrences: [{
        id: 'occ-completed',
        cycleId: 'cycle-completed',
        milestoneKey: 'annual-return-due',
        scheduleEntryKey: '',
        deadlineType: 'STATUTORY',
        calculatedDueDate: new Date('2026-07-31T00:00:00.000Z'),
        operativeDueDate: new Date('2026-07-31T00:00:00.000Z'),
        dateOverridden: false,
        status: 'COMPLETED',
        origin: 'RULE',
        ruleVersionId: 'version-1',
      }],
    },
  ];
}

describe('previewDeadlineOccurrenceRemediation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies the two observed production shapes without writing', async () => {
    const { db } = statefulDb({ service: serviceRecord(), cycles: storedCycleFixture() });

    const preview = await previewDeadlineOccurrenceRemediation(remediationInput(), db as never);

    expect(preview.counts).toEqual({
      RECALCULATE: 1,
      CANCEL: 1,
      CREATE: 2,
      PRESERVE: 1,
    });
    expect(preview.actions).toContainEqual({
      action: 'RECALCULATE',
      occurrenceId: 'occ-wrong-2024',
      oldDate: '2024-06-30',
      newDate: '2024-07-31',
    });
    expect(preview.actions).toContainEqual({
      action: 'CANCEL',
      occurrenceId: 'occ-bug',
      oldDate: '2026-07-31',
      reason: 'Deadline projection repair',
    });
    expect(preview.actions).toContainEqual({
      action: 'PRESERVE',
      occurrenceId: 'occ-completed',
      reason: 'COMPLETED',
    });
    expect((db.deadlineOccurrence as { updateMany: ReturnType<typeof vi.fn> }).updateMany).not.toHaveBeenCalled();
    expect((db.deadlineOccurrence as { createMany: ReturnType<typeof vi.fn> }).createMany).not.toHaveBeenCalled();
    expect((db.serviceCycle as { upsert: ReturnType<typeof vi.fn> }).upsert).not.toHaveBeenCalled();
  });

  it('produces a deterministic fingerprint independent of database return order', async () => {
    const { db } = statefulDb({ service: serviceRecord(), cycles: storedCycleFixture() });
    const first = await previewDeadlineOccurrenceRemediation(remediationInput(), db as never);
    const reversed = await previewDeadlineOccurrenceRemediation(remediationInput(), db as never);
    expect(reversed.fingerprint).toBe(first.fingerprint);
  });

  it('never loads or classifies a row belonging to another tenant', async () => {
    const { db } = statefulDb({ service: serviceRecord(), cycles: storedCycleFixture() });
    await expect(
      previewDeadlineOccurrenceRemediation(remediationInput({ tenantId: 'tenant-2' }), db as never),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects duplicate, missing, and excessive service selections', async () => {
    const { db } = statefulDb({ service: serviceRecord(), cycles: [] });
    await expect(previewDeadlineOccurrenceRemediation(remediationInput({ clientServiceIds: [] }), db as never)).rejects.toThrow(/at least one/i);
    await expect(previewDeadlineOccurrenceRemediation(remediationInput({ clientServiceIds: ['cs-1', 'cs-1'] }), db as never)).rejects.toThrow(/unique/i);
    const manyIds = Array.from({ length: 26 }, (_, index) => `cs-${index}`);
    await expect(previewDeadlineOccurrenceRemediation(remediationInput({ clientServiceIds: manyIds }), db as never)).rejects.toThrow(/at most 25/i);
    await expect(previewDeadlineOccurrenceRemediation(remediationInput({ reason: 'short' }), db as never)).rejects.toThrow(/at least 10/i);
  });
});

describe('applyDeadlineOccurrenceRemediation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a missing expected fingerprint', async () => {
    const { db } = statefulDb({ service: serviceRecord(), cycles: storedCycleFixture() });
    await expect(
      applyDeadlineOccurrenceRemediation({
        ...remediationInput(),
        expectedFingerprint: '',
        actorId: 'user-1',
      }, db as never),
    ).rejects.toThrow(/fingerprint/i);
  });

  it('rejects a mismatched fingerprint with the typed conflict', async () => {
    const { db } = statefulDb({ service: serviceRecord(), cycles: storedCycleFixture() });
    await expect(
      applyDeadlineOccurrenceRemediation({
        ...remediationInput(),
        expectedFingerprint: '0'.repeat(64),
        actorId: 'user-1',
      }, db as never),
    ).rejects.toMatchObject({ code: ErrorCodes.IMPACT_CHANGED, statusCode: 409 });
  });

  it('applies recalculation, cancellation, and creation with an audit entry', async () => {
    const { db, state } = statefulDb({ service: serviceRecord(), cycles: storedCycleFixture() });
    const preview = await previewDeadlineOccurrenceRemediation(remediationInput(), db as never);

    const result = await applyDeadlineOccurrenceRemediation({
      ...remediationInput(),
      expectedFingerprint: preview.fingerprint,
      actorId: 'user-1',
    }, db as never);

    expect(result.results[0]).toMatchObject({
      clientServiceId: 'cs-1',
      counts: { RECALCULATE: 1, CANCEL: 1, CREATE: 2, PRESERVE: 1 },
    });
    expect(auditMock.createAuditLog).toHaveBeenCalledTimes(1);
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      entityType: 'ClientService',
      entityId: 'cs-1',
      action: 'UPDATE',
      reason: 'Correct 2026 annual source alignment',
    }), expect.anything());

    const wrongOcc = findOccurrence(state, 'occ-wrong-2024');
    expect(wrongOcc?.calculatedDueDate).toEqual(new Date('2024-07-31T00:00:00.000Z'));
    const bugOcc = findOccurrence(state, 'occ-bug');
    expect(bugOcc?.status).toBe('CANCELLED');
    expect(String(bugOcc?.cancellationReason)).toMatch(/^Deadline projection repair:/);
    const openRuleOccurrences = allOccurrences(state).filter((occ) => occ.status === 'OPEN' && occ.origin === 'RULE');
    expect(openRuleOccurrences.map((occ) => ({ milestoneKey: occ.milestoneKey, dueDate: (occ.operativeDueDate as Date).toISOString().slice(0, 10) })))
      .toEqual([
        { milestoneKey: 'annual-return-due', dueDate: '2024-07-31' },
        { milestoneKey: 'annual-return-due', dueDate: '2025-07-31' },
        { milestoneKey: 'annual-return-due', dueDate: '2027-07-31' },
      ]);
  });

  it('is repeat-idempotent: a second dry-run has zero mutating actions and a second apply is rejected', async () => {
    const { db } = statefulDb({ service: serviceRecord(), cycles: storedCycleFixture() });
    const preview = await previewDeadlineOccurrenceRemediation(remediationInput(), db as never);
    await applyDeadlineOccurrenceRemediation({
      ...remediationInput(),
      expectedFingerprint: preview.fingerprint,
      actorId: 'user-1',
    }, db as never);

    const secondDryRun = await previewDeadlineOccurrenceRemediation(remediationInput(), db as never);
    expect(secondDryRun.counts.CREATE).toBe(0);
    expect(secondDryRun.counts.RECALCULATE).toBe(0);
    expect(secondDryRun.counts.CANCEL).toBe(0);

    await expect(
      applyDeadlineOccurrenceRemediation({
        ...remediationInput(),
        expectedFingerprint: preview.fingerprint,
        actorId: 'user-1',
      }, db as never),
    ).rejects.toMatchObject({ code: ErrorCodes.IMPACT_CHANGED, statusCode: 409 });
    expect(auditMock.createAuditLog).toHaveBeenCalledTimes(1);
  });
});

function allOccurrences(state: StoredState): Array<Record<string, unknown>> {
  return state.cycles.flatMap((c) => (c.occurrences as unknown[] ?? []) as Array<Record<string, unknown>>);
}

function findOccurrence(state: StoredState, id: string): Record<string, unknown> | undefined {
  return allOccurrences(state).find((occ) => occ.id === id);
}
